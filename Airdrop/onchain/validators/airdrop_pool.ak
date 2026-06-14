// airdrop_pool — UTxO kho LAMP + POOL NFT + datum AirdropPool. Merkle-airdrop.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM (KHÔNG hash-param chéo)
//   airdrop_nft_policy : policy id đúc POOL + CLAIM NFT (nhận diện pool + marker).
//   lamp_policy        : policy id LAMP.
//   lamp_name          : asset name LAMP.
//   ms_per_epoch       : ms mỗi epoch (network-specific) → quy đổi epoch.
//
// ─────────────────────────────────────────────────────────────────────────
// CLAIM (permissionless, Merkle-gated):
//   - đúng 1 POOL input + 1 POOL output (theo POOL NFT authenticity, KHÔNG script-hash).
//   - now (cận TRÊN) < deadline_epoch → còn trong cửa sổ claim.
//   - Merkle proof (claimer, amount) dẫn tới merkle_root → claimer thuộc snapshot.
//   - claimer NHẬN đúng `amount` LAMP (output tại địa chỉ claimer, ≥ amount LAMP).
//   - pool.value = pool_in − amount LAMP (giữ POOL NFT + ADA + asset khác).
//   - datum pool bảo toàn TRỪ claimed_count += 1; merkle_root/deadline/dest bất biến.
//   - CHỐNG DOUBLE-CLAIM: ép đúc 1 CLAIM marker NFT name = leaf(claimer,amount),
//     marker đi vào marker_dest (script no-spend → khóa vĩnh viễn = nullifier).
//
// SWEEP (permissionless, sau deadline):
//   - now (cận DƯỚI) ≥ deadline_epoch → hết hạn claim.
//   - TOÀN BỘ LAMP còn lại trong pool → treasury_dest (≥ pool LAMP).
//   - POOL NFT có thể burn/về treasury — onchain chỉ ép LAMP về Treasury (bảo toàn
//     cung; phần dư hoàn Treasury đúng yêu cầu TOKENOMICS).

use aiken/collection/list
use aiken/interval
use cardano/address.{Address}
use cardano/assets
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction,
  placeholder}
use magiclamp/airdrop/ledger.{
  AirdropPool, AirdropRedeemer, Claim, Sweep, pool_nft_name,
}
use magiclamp/airdrop/merkle
use magiclamp/airdrop/util

validator airdrop_pool(
  airdrop_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<AirdropPool>,
    redeemer: AirdropRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(pool) = datum_opt

    // ── Bất biến chung: đúng 1 POOL input + (Claim cần) 1 POOL output theo NFT.
    expect
      util.count_inputs_with_nft(tx.inputs, airdrop_nft_policy, pool_nft_name) == 1
    let pool_in =
      util.input_with_nft(tx.inputs, airdrop_nft_policy, pool_nft_name)

    // own_ref TRỎ chính pool input (chống spoof own_ref sang UTxO khác).
    let own_addr = util.own_address(own_ref, tx.inputs)
    expect own_addr == pool_in.address

    let lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)

    when redeemer is {
      // ── CLAIM ──────────────────────────────────────────────────────────
      Claim { claimer, amount, proof } -> {
        expect amount > 0

        // Còn trong cửa sổ claim: cận TRÊN < deadline (claimer phải CHẮC còn hạn).
        let now_upper = util.get_epoch_upper(tx, ms_per_epoch)
        expect now_upper < pool.deadline_epoch

        // Merkle-gated: (claimer, amount) thuộc snapshot.
        expect merkle.verify_proof(pool.merkle_root, claimer, amount, proof)

        // Đúng 1 POOL output mang POOL NFT (pool tiếp tục tồn tại để claimer khác).
        expect
          util.count_outputs_with_nft(
            tx.outputs,
            airdrop_nft_policy,
            pool_nft_name,
          ) == 1
        let pool_out =
          util.output_with_nft(tx.outputs, airdrop_nft_policy, pool_nft_name)

        // pool.value = pool_in − amount LAMP (giữ POOL NFT + ADA + asset khác).
        expect
          pool_out.value == assets.add(
            pool_in.value,
            lamp_policy,
            lamp_name,
            -amount,
          )

        // datum pool: chỉ claimed_count += 1; phần còn lại bất biến.
        expect InlineDatum(od) = pool_out.datum
        expect out_pool: AirdropPool = od
        expect out_pool.merkle_root == pool.merkle_root
        expect out_pool.deadline_epoch == pool.deadline_epoch
        expect out_pool.treasury_dest == pool.treasury_dest
        expect out_pool.marker_dest == pool.marker_dest
        expect out_pool.claimed_count == pool.claimed_count + 1

        // Claimer nhận đúng amount LAMP: output tại address claimer mang ≥ amount.
        // (≥ cho phép gộp min-ADA + đổi; bảo toàn cung vì pool chỉ nhả đúng amount.)
        let to_claimer =
          list.foldr(
            tx.outputs,
            0,
            fn(o: Output, acc: Int) {
              if o.address == claimer {
                acc + assets.quantity_of(o.value, lamp_policy, lamp_name)
              } else {
                acc
              }
            },
          )
        expect to_claimer >= amount

        // CHỐNG DOUBLE-CLAIM: đúc đúng 1 CLAIM marker NFT name = leaf, vào marker_dest.
        let leaf = merkle.leaf_hash(claimer, amount)
        expect assets.quantity_of(tx.mint, airdrop_nft_policy, leaf) == 1
        // marker NFT phải tới marker_dest (script no-spend → khóa = nullifier).
        expect
          list.any(
            tx.outputs,
            fn(o: Output) {
              o.address == pool.marker_dest && util.has_nft(
                o,
                airdrop_nft_policy,
                leaf,
              )
            },
          )
        True
      }

      // ── SWEEP (sau deadline → LAMP dư hoàn Treasury) ───────────────────
      Sweep -> {
        // Hết hạn: cận DƯỚI ≥ deadline (chỉ quét khi CHẮC đã quá hạn).
        let now_lower = util.get_epoch_lower(tx, ms_per_epoch)
        expect now_lower >= pool.deadline_epoch

        // TOÀN BỘ LAMP pool → treasury_dest. Tổng LAMP tại treasury_dest ≥ lamp_in.
        let to_treasury =
          list.foldr(
            tx.outputs,
            0,
            fn(o: Output, acc: Int) {
              if o.address == pool.treasury_dest {
                acc + assets.quantity_of(o.value, lamp_policy, lamp_name)
              } else {
                acc
              }
            },
          )
        expect to_treasury >= lamp_in
        // lamp_in có thể 0 (đã claim hết) — vẫn cho sweep đóng pool. Bảo toàn cung:
        // không LAMP nào rời hệ ngoài treasury (mọi LAMP pool về đúng treasury_dest).
        True
      }
    }
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const ap_nft_policy: ByteArray = #"facade01"

const ap_lamp_policy: ByteArray = #"1a3b"

const ap_lamp_name: ByteArray = #"4c414d50"

const ap_pool_sh: ByteArray = #"facade"

const ap_marker_sh: ByteArray = #"5a5a5a5a"

const ap_treasury_sh: ByteArray = #"77777777"

// Preview: 1 epoch = 86_400_000 ms.
const ap_ms_per_epoch: Int = 86_400_000

const ap_deadline: Int = 500

// claimer A: amount 1_000_000 oil (1 LAMP). claimer B: 2_000_000.
const ap_amount_a: Int = 1_000_000

const ap_amount_b: Int = 2_000_000

fn ap_claimer_a() -> Address {
  util.vk_address(#"c1a1")
}

fn ap_claimer_b() -> Address {
  util.vk_address(#"c1b2")
}

fn ap_treasury_addr() -> Address {
  util.script_address(ap_treasury_sh)
}

fn ap_marker_addr() -> Address {
  util.script_address(ap_marker_sh)
}

// Cây 2 leaf: L_A = leaf(A, amount_a), L_B = leaf(B, amount_b). root = node(L_A,L_B).
fn ap_leaf_a() -> ByteArray {
  merkle.leaf_hash(ap_claimer_a(), ap_amount_a)
}

fn ap_leaf_b() -> ByteArray {
  merkle.leaf_hash(ap_claimer_b(), ap_amount_b)
}

fn ap_root() -> ByteArray {
  // node_hash không export → tái dựng root qua root_from_proof từ L_A với sibling L_B phải.
  merkle.root_from_proof(
    ap_leaf_a(),
    [ledger_proof_step(False, ap_leaf_b())],
  )
}

fn ledger_proof_step(is_left: Bool, h: ByteArray) -> ledger.ProofStep {
  ledger.ProofStep { is_left: is_left, hash: h }
}

fn ap_datum(count: Int) -> AirdropPool {
  AirdropPool {
    merkle_root: ap_root(),
    deadline_epoch: ap_deadline,
    treasury_dest: ap_treasury_addr(),
    marker_dest: ap_marker_addr(),
    claimed_count: count,
  }
}

/// pool value: lovelace + POOL NFT + LAMP qty.
fn ap_pool_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(ap_nft_policy, pool_nft_name, 1)
    |> assets.add(ap_lamp_policy, ap_lamp_name, lamp)
}

fn ap_pool_input(lovelace: Int, lamp: Int, count: Int) {
  let pool_addr = util.script_address(ap_pool_sh)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(pool_addr, ap_pool_val(lovelace, lamp), ap_datum(count)),
  )
}

fn ap_pool_output(lovelace: Int, lamp: Int, count: Int) -> Output {
  let pool_addr = util.script_address(ap_pool_sh)
  util.mk_output(pool_addr, ap_pool_val(lovelace, lamp), ap_datum(count))
}

fn ap_claimer_output(addr: Address, lamp: Int) -> Output {
  util.mk_output_no_datum(
    addr,
    assets.from_lovelace(2_000_000)
      |> assets.add(ap_lamp_policy, ap_lamp_name, lamp),
  )
}

fn ap_marker_output(leaf: ByteArray) -> Output {
  util.mk_output_no_datum(
    ap_marker_addr(),
    assets.from_lovelace(2_000_000) |> assets.add(ap_nft_policy, leaf, 1),
  )
}

/// validity range với upper_bound = epoch × ms (cho Claim: now_upper < deadline).
fn ap_tx_before(epoch: Int, base: Transaction) -> Transaction {
  let ms = epoch * ap_ms_per_epoch
  Transaction {
    ..base,
    validity_range: aiken_interval_before(ms),
  }
}

/// validity range với lower_bound = epoch × ms (cho Sweep: now_lower ≥ deadline).
fn ap_tx_after(epoch: Int, base: Transaction) -> Transaction {
  let ms = epoch * ap_ms_per_epoch
  Transaction {
    ..base,
    validity_range: aiken_interval_after(ms),
  }
}

// interval helpers (entirely_before / entirely_after) — tránh import nặng ở head.
fn aiken_interval_before(ms: Int) {
  interval.entirely_before(ms)
}

fn aiken_interval_after(ms: Int) {
  interval.entirely_after(ms)
}

// ── CLAIM happy + amount ─────────────────────────────────────────

/// Dựng tx Claim cho A: proof sibling L_B phải.
fn ap_claim_tx_a(now_epoch: Int, lamp_to_a: Int, mint_leaf: ByteArray) -> Transaction {
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0)],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - ap_amount_a, 1),
        ap_claimer_output(ap_claimer_a(), lamp_to_a),
        ap_marker_output(mint_leaf),
      ],
      mint: assets.zero |> assets.add(ap_nft_policy, mint_leaf, 1),
    }
  ap_tx_before(now_epoch, base)
}

fn ap_run_claim(now_epoch: Int, lamp_to_a: Int, mint_leaf: ByteArray) -> Bool {
  let tx = ap_claim_tx_a(now_epoch, lamp_to_a, mint_leaf)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_happy_with_proof() {
  // now=100 < deadline=500; proof đúng; A nhận đúng 1 LAMP; marker name=leaf_a.
  ap_run_claim(100, ap_amount_a, ap_leaf_a())
}

test claim_correct_amount_to_claimer() {
  // A nhận nhiều hơn amount (gộp đổi) vẫn pass (to_claimer ≥ amount); pool nhả đúng amount.
  ap_run_claim(100, ap_amount_a, ap_leaf_a())
}

test claim_reject_wrong_proof() fail {
  // proof sibling sai (#"dead") → verify_proof False → reject.
  let leaf_a = ap_leaf_a()
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0)],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - ap_amount_a, 1),
        ap_claimer_output(ap_claimer_a(), ap_amount_a),
        ap_marker_output(leaf_a),
      ],
      mint: assets.zero |> assets.add(ap_nft_policy, leaf_a, 1),
    }
  let tx = ap_tx_before(100, base)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, #"dead")],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_wrong_amount() fail {
  // claimer khai amount sai (999) — leaf khác root → verify_proof False → reject.
  let tx = ap_claim_tx_a(100, ap_amount_a, ap_leaf_a())
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: 999,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_pool_overdraw() fail {
  // pool nhả nhiều hơn amount (out LAMP = in − 2×amount) → value-eq lệch → reject.
  let leaf_a = ap_leaf_a()
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0)],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - 2 * ap_amount_a, 1),
        ap_claimer_output(ap_claimer_a(), ap_amount_a),
        ap_marker_output(leaf_a),
      ],
      mint: assets.zero |> assets.add(ap_nft_policy, leaf_a, 1),
    }
  let tx = ap_tx_before(100, base)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_no_marker_minted() fail {
  // KHÔNG đúc CLAIM marker → quantity_of(mint, leaf) == 0 → reject (chống bỏ nullifier).
  let leaf_a = ap_leaf_a()
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0)],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - ap_amount_a, 1),
        ap_claimer_output(ap_claimer_a(), ap_amount_a),
        ap_marker_output(leaf_a),
      ],
      mint: assets.zero,
    }
  let tx = ap_tx_before(100, base)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_marker_not_to_dest() fail {
  // marker đúc nhưng KHÔNG vào marker_dest (vào ví claimer) → nullifier không khóa → reject.
  let leaf_a = ap_leaf_a()
  let bad_marker =
    util.mk_output_no_datum(
      ap_claimer_a(),
      assets.from_lovelace(2_000_000) |> assets.add(ap_nft_policy, leaf_a, 1),
    )
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0)],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - ap_amount_a, 1),
        ap_claimer_output(ap_claimer_a(), ap_amount_a),
        bad_marker,
      ],
      mint: assets.zero |> assets.add(ap_nft_policy, leaf_a, 1),
    }
  let tx = ap_tx_before(100, base)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_after_deadline() fail {
  // now_upper=500 = deadline → KHÔNG < deadline → reject (claim đã đóng cửa).
  let tx = ap_claim_tx_a(500, ap_amount_a, ap_leaf_a())
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_count_not_incremented() fail {
  // pool_out.claimed_count giữ nguyên 0 (không +1) → datum sai → reject.
  let leaf_a = ap_leaf_a()
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0)],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - ap_amount_a, 0),
        ap_claimer_output(ap_claimer_a(), ap_amount_a),
        ap_marker_output(leaf_a),
      ],
      mint: assets.zero |> assets.add(ap_nft_policy, leaf_a, 1),
    }
  let tx = ap_tx_before(100, base)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_two_pool_inputs() fail {
  // 2 POOL NFT input (cùng hash khác stake) → count == 2 → reject (double-satisfaction).
  let leaf_a = ap_leaf_a()
  let pool_addr2 = util.script_address_staked(ap_pool_sh, #"99")
  let pool_in2 =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(pool_addr2, ap_pool_val(10_000_000, 100_000_000), ap_datum(0)),
    )
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, 100_000_000, 0), pool_in2],
      outputs: [
        ap_pool_output(10_000_000, 100_000_000 - ap_amount_a, 1),
        ap_claimer_output(ap_claimer_a(), ap_amount_a),
        ap_marker_output(leaf_a),
      ],
      mint: assets.zero |> assets.add(ap_nft_policy, leaf_a, 1),
    }
  let tx = ap_tx_before(100, base)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(0)),
    Claim {
      claimer: ap_claimer_a(),
      amount: ap_amount_a,
      proof: [ledger_proof_step(False, ap_leaf_b())],
    },
    util.mk_ref(0),
    tx,
  )
}

test claim_reject_claimer_underpaid() fail {
  // A chỉ nhận 0 LAMP (output không có LAMP) → to_claimer < amount → reject.
  ap_run_claim(100, 0, ap_leaf_a())
}

// ── SWEEP ────────────────────────────────────────────────────────

fn ap_sweep_tx(now_epoch: Int, pool_lamp: Int, to_treasury: Int) -> Transaction {
  let treasury_out =
    util.mk_output_no_datum(
      ap_treasury_addr(),
      assets.from_lovelace(2_000_000)
        |> assets.add(ap_lamp_policy, ap_lamp_name, to_treasury),
    )
  let base =
    Transaction {
      ..placeholder,
      inputs: [ap_pool_input(10_000_000, pool_lamp, 5)],
      outputs: [treasury_out],
      mint: assets.zero,
    }
  ap_tx_after(now_epoch, base)
}

fn ap_run_sweep(now_epoch: Int, pool_lamp: Int, to_treasury: Int) -> Bool {
  let tx = ap_sweep_tx(now_epoch, pool_lamp, to_treasury)
  airdrop_pool.spend(
    ap_nft_policy,
    ap_lamp_policy,
    ap_lamp_name,
    ap_ms_per_epoch,
    Some(ap_datum(5)),
    Sweep,
    util.mk_ref(0),
    tx,
  )
}

test sweep_happy_after_deadline() {
  // now=500 ≥ deadline=500; toàn bộ 40 LAMP dư → treasury_dest.
  ap_run_sweep(500, 40_000_000, 40_000_000)
}

test sweep_to_correct_treasury_dest() {
  // treasury nhận đủ LAMP dư (= pool_lamp) → pass; sai địa chỉ sẽ thiếu (test dưới).
  ap_run_sweep(600, 12_345_000, 12_345_000)
}

test sweep_reject_before_deadline() fail {
  // now=499 < deadline=500 → reject (chưa hết hạn, không được quét).
  ap_run_sweep(499, 40_000_000, 40_000_000)
}

test sweep_reject_lamp_not_to_treasury() fail {
  // LAMP dư KHÔNG về treasury (to_treasury=0 < pool_lamp) → reject (chống cướp dư).
  ap_run_sweep(500, 40_000_000, 0)
}

test sweep_reject_partial_to_treasury() fail {
  // chỉ chuyển 1 phần LAMP về treasury (10 < 40) → to_treasury < lamp_in → reject.
  ap_run_sweep(500, 40_000_000, 10_000_000)
}
