// ispo_pool — UTxO kho LAMP + POOL NFT cho ISPO reward-redirect.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM (KHÔNG hash-param chéo — xem types.ak)
//   ispo_nft_policy : policy id đúc POOL + MARKER NFT (nhận diện pool + đánh dấu
//                     claim). Tính từ genesis_ref ở deploy. Pool 1 mình tham
//                     chiếu param này → KHÔNG vòng tròn với ispo_nft.
//   lamp_policy     : policy id LAMP.
//   lamp_name       : asset name LAMP.
//   admin           : List pkh admin (SetRoot cần ngưỡng admin_threshold).
//   admin_threshold : số chữ ký admin tối thiểu để SetRoot.
//
// ─────────────────────────────────────────────────────────────────────────
// 3 REDEEMER
//   SetRoot{root} — admin nạp Merkle root cho epoch KẾ TIẾP (append epoch_roots).
//                   pool.value bảo toàn TUYỆT ĐỐI (không rút LAMP). Chỉ epoch_roots
//                   tăng đúng 1 phần tử; field khác bất biến.
//   Claim{claim}  — delegator chứng minh (epoch, owner, amount) ∈ root[epoch] qua
//                   Merkle proof → owner nhận đúng `amount` LAMP. CHỐNG DOUBLE-CLAIM
//                   per (epoch,owner): ép đúc đúng 1 MARKER NFT name=H(epoch||owner)
//                   gửi owner. distributed_total += amount. pool.value = in − amount LAMP.
//   Sweep         — sau end_epoch: quét LAMP dư về Treasury (treasury_dest). POOL NFT
//                   + epoch_roots + sổ bất biến (pool đóng băng); LAMP còn lại → Treasury.
//
// ─────────────────────────────────────────────────────────────────────────
// CHỐNG DOUBLE-CLAIM per (epoch, owner) — MARKER NFT
//   marker_name = blake2b_256(epoch_be8 || owner) (merkle.marker_name).
//   Claim ép: đúc ĐÚNG 1 (ispo_nft_policy, marker_name) qty 1, gửi tới owner.
//   Marker là biên-lai per (epoch,owner): off-chain indexer + ví KHÔNG re-present.
//   Tầng on-chain ép: name đúng (gắn chặt epoch+owner), qty=1, recipient=owner.
//   (Ghi chú soundness ở README: marker = mẫu airdrop chuẩn; chốt chặn double-claim
//    toàn cục = indexer off-chain từ chối ký-lại + marker hiện diện ở ví owner.)

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction,
  placeholder}
use magiclamp/ispo/merkle
use magiclamp/ispo/types.{
  Claim, ClaimProof, IspoDatum, IspoRedeemer, MerkleStep, SetRoot, Sweep,
  pool_nft_name,
}
use magiclamp/ispo/util

validator ispo_pool(
  ispo_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  admin: List<ByteArray>,
  admin_threshold: Int,
) {
  spend(
    datum_opt: Option<IspoDatum>,
    redeemer: IspoRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d) = datum_opt

    // Đúng 1 POOL input + 1 POOL output theo POOL NFT (authenticity, chống
    // double-satisfaction). Pool chính danh = pool mang POOL NFT.
    expect util.count_inputs_with_nft(tx.inputs, ispo_nft_policy, pool_nft_name) == 1

    let pool_in = util.input_with_nft(tx.inputs, ispo_nft_policy, pool_nft_name)

    // own_ref phải TRỎ chính pool input (chống spoof own_ref).
    let own_addr = util.own_address(own_ref, tx.inputs)
    expect own_addr == pool_in.address

    let lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)

    when redeemer is {
      // ── SETROOT (admin nạp root epoch kế tiếp) ────────────────────────
      SetRoot { root } -> {
        expect util.count_outputs_with_nft(tx.outputs, ispo_nft_policy, pool_nft_name) == 1
        let pool_out = util.output_with_nft(tx.outputs, ispo_nft_policy, pool_nft_name)
        expect InlineDatum(od) = pool_out.datum
        expect out_d: IspoDatum = od

        // Ngưỡng admin.
        expect util.count_committee_sigs(admin, tx.extra_signatories) >= admin_threshold

        // pool.value bảo toàn TUYỆT ĐỐI (SetRoot không đụng LAMP/ADA/NFT).
        expect pool_out.value == pool_in.value

        // epoch_roots tăng đúng 1 phần tử (append root ở CUỐI). Field khác bất biến.
        expect out_d.epoch_roots == list.concat(d.epoch_roots, [root])
        expect out_d.distributed_total == d.distributed_total
        expect out_d.end_epoch == d.end_epoch
        expect out_d.treasury_dest == d.treasury_dest
        expect out_d.ms_per_epoch == d.ms_per_epoch

        // Không vượt 36 epoch (0..end_epoch) → tối đa end_epoch+1 root.
        expect list.length(out_d.epoch_roots) <= d.end_epoch + 1
        True
      }

      // ── CLAIM (delegator nhận LAMP epoch e) ───────────────────────────
      Claim { claim } -> {
        let ClaimProof { epoch, owner, amount, proof } = claim
        expect amount > 0
        expect epoch >= 0

        expect util.count_outputs_with_nft(tx.outputs, ispo_nft_policy, pool_nft_name) == 1
        let pool_out = util.output_with_nft(tx.outputs, ispo_nft_policy, pool_nft_name)
        expect InlineDatum(od) = pool_out.datum
        expect out_d: IspoDatum = od

        // root của epoch lấy từ epoch_roots[epoch]. Phải đã được admin nạp.
        expect Some(root) = util.list_at(d.epoch_roots, epoch)

        // Merkle: (epoch, owner, amount) ∈ root[epoch].
        expect merkle.verify(root, epoch, owner, amount, proof)

        // pool.value = pool_in − amount LAMP (giữ POOL NFT + ADA + asset khác).
        expect
          pool_out.value == assets.add(pool_in.value, lamp_policy, lamp_name, -amount)

        // owner nhận ≥ amount LAMP (ví owner = VerificationKey(owner)).
        expect util.lamp_to_owner(tx.outputs, owner, lamp_policy, lamp_name) >= amount

        // Sổ kế toán: distributed_total += amount; epoch_roots + cấu hình bất biến.
        expect out_d.epoch_roots == d.epoch_roots
        expect out_d.distributed_total == d.distributed_total + amount
        expect out_d.end_epoch == d.end_epoch
        expect out_d.treasury_dest == d.treasury_dest
        expect out_d.ms_per_epoch == d.ms_per_epoch

        // CHỐNG DOUBLE-CLAIM (epoch,owner): đúc ĐÚNG 1 MARKER NFT name=H(epoch||owner).
        let mname = merkle.marker_name(epoch, owner)
        expect assets.quantity_of(tx.mint, ispo_nft_policy, mname) == 1
        // Marker phải tới ví owner (biên-lai per claim). Đúng 1 marker output.
        expect util.count_outputs_with_nft(tx.outputs, ispo_nft_policy, mname) == 1
        let marker_out = util.output_with_nft(tx.outputs, ispo_nft_policy, mname)
        expect util.is_owned_by(marker_out.address, owner)

        // KHÔNG đúc POOL NFT thêm (POOL bất biến). Marker là token DUY NHẤT được đúc.
        expect assets.quantity_of(tx.mint, ispo_nft_policy, pool_nft_name) == 0
        True
      }

      // ── SWEEP (sau end_epoch → LAMP dư về Treasury) ───────────────────
      Sweep -> {
        // now > end_epoch (cận dưới validity_range → chỉ quét khi CHẮC hết ISPO).
        let now = util.get_epoch(tx, d.ms_per_epoch)
        expect now > d.end_epoch

        // Toàn bộ LAMP còn trong pool → Treasury (treasury_dest, Script). POOL NFT
        // KHÔNG cần re-output (pool có thể đóng); chỉ ép LAMP về đúng đích.
        expect
          util.lamp_to_script(tx.outputs, d.treasury_dest, lamp_policy, lamp_name) >= lamp_in
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

const ip_nft_policy: ByteArray = #"15f00d"

const ip_lamp_policy: ByteArray = #"1a3b"

const ip_lamp_name: ByteArray = #"4c414d50"

const ip_pool_sh: ByteArray = #"facade"

const ip_admin: List<ByteArray> = [#"ad01", #"ad02", #"ad03"]

const ip_admin_threshold: Int = 2

const ip_treasury: ByteArray = #"7a7a7a7a"

const ip_mspe: Int = 432_000_000

const ip_end_epoch: Int = 35

// owner A/B (pkh ví).
const owner_a: ByteArray = #"0a0a"

const owner_b: ByteArray = #"0b0b"

// ── Merkle fixtures (cây 2 leaf cho epoch 0) ──────────────────────
// L0 = leaf(0, owner_a, 1000); L1 = leaf(0, owner_b, 2000). root0 = node(L0,L1).
// proof(A) = [L1 phải]; proof(B) = [L0 trái].

fn leaf_a() -> ByteArray {
  merkle.leaf_hash(0, owner_a, 1000)
}

fn leaf_b() -> ByteArray {
  merkle.leaf_hash(0, owner_b, 2000)
}

fn root0() -> ByteArray {
  merkle.node_hash(leaf_a(), leaf_b())
}

fn ip_datum(roots: List<ByteArray>, dist: Int) -> IspoDatum {
  IspoDatum {
    epoch_roots: roots,
    distributed_total: dist,
    end_epoch: ip_end_epoch,
    treasury_dest: ip_treasury,
    ms_per_epoch: ip_mspe,
  }
}

/// pool value: lovelace + POOL NFT + LAMP qty.
fn ip_pool_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(ip_nft_policy, pool_nft_name, 1)
    |> assets.add(ip_lamp_policy, ip_lamp_name, lamp)
}

// ── CLAIM tests ───────────────────────────────────────────────────

fn marker_mint(epoch: Int, owner: ByteArray, qty: Int) -> assets.Value {
  assets.zero |> assets.add(ip_nft_policy, merkle.marker_name(epoch, owner), qty)
}

/// Dựng tx Claim: pool in/out + owner nhận LAMP + marker tới owner.
fn claim_tx(
  in_roots: List<ByteArray>,
  in_dist: Int,
  out_dist: Int,
  epoch: Int,
  owner: ByteArray,
  _amount: Int,
  pool_lamp_in: Int,
  pool_lamp_out: Int,
  owner_lamp_out: Int,
  marker_qty: Int,
  marker_to: ByteArray,
  extra_outs: List<Output>,
) -> Transaction {
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, pool_lamp_in), ip_datum(in_roots, in_dist)))
  let pool_out =
    util.mk_output(pool_addr, ip_pool_val(10_000_000, pool_lamp_out), ip_datum(in_roots, out_dist))
  let mname = merkle.marker_name(epoch, owner)
  let owner_val =
    assets.from_lovelace(2_000_000)
      |> assets.add(ip_lamp_policy, ip_lamp_name, owner_lamp_out)
      |> assets.add(ip_nft_policy, mname, 1)
  let owner_out = util.mk_output(util.vk_address(marker_to), owner_val, leaf_a())
  Transaction {
    ..placeholder,
    inputs: [pool_in],
    outputs: list.concat([pool_out, owner_out], extra_outs),
    mint: marker_mint(epoch, owner, marker_qty),
  }
}

fn run_claim(in_d: IspoDatum, claim: ClaimProof, tx: Transaction) -> Bool {
  ispo_pool.spend(
    ip_nft_policy, ip_lamp_policy, ip_lamp_name, ip_admin, ip_admin_threshold,
    Some(in_d), Claim { claim }, util.mk_ref(0), tx,
  )
}

fn proof_a() -> ClaimProof {
  ClaimProof {
    epoch: 0,
    owner: owner_a,
    amount: 1000,
    proof: [MerkleStep { hash: leaf_b(), left: False }],
  }
}

test claim_happy_epoch0() {
  // owner_a claim 1000 LAMP epoch 0.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 1, owner_a, [])
  run_claim(in_d, proof_a(), tx)
}

test claim_multi_epoch() {
  // Cùng owner_a claim ở 2 epoch khác nhau (0 và 1). Mỗi epoch root riêng →
  // entitlement riêng. epoch 1 = cây 1-leaf (root = leaf, proof rỗng), amount 500.
  let root1 = merkle.leaf_hash(1, owner_a, 500)
  let roots = [root0(), root1]
  let in_d = ip_datum(roots, 0)
  // claim epoch 0 (amount 1000).
  let r0 =
    run_claim(in_d, proof_a(), claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 1, owner_a, []))
  // claim epoch 1 (amount 500, proof rỗng).
  let claim1 = ClaimProof { epoch: 1, owner: owner_a, amount: 500, proof: [] }
  let r1 =
    run_claim(in_d, claim1, claim_tx(roots, 0, 500, 1, owner_a, 500, 100_000, 99_500, 500, 1, owner_a, []))
  r0 && r1
}

test claim_owner_b() {
  // owner_b claim 2000 LAMP epoch 0 (proof khác hướng).
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let proof_b =
    ClaimProof {
      epoch: 0, owner: owner_b, amount: 2000,
      proof: [MerkleStep { hash: leaf_a(), left: True }],
    }
  let tx = claim_tx(roots, 0, 2000, 0, owner_b, 2000, 100_000, 98_000, 2000, 1, owner_b, [])
  run_claim(in_d, proof_b, tx)
}

test claim_amount_proportional() {
  // amount đúng tỷ lệ stake: A có entitlement 1000, B có 2000 (tỷ lệ 1:2 khớp
  // stake snapshot off-chain). Cả 2 claim đúng amount của mình → cùng pass.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let proof_b =
    ClaimProof {
      epoch: 0, owner: owner_b, amount: 2000,
      proof: [MerkleStep { hash: leaf_a(), left: True }],
    }
  let ra = run_claim(in_d, proof_a(), claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 1, owner_a, []))
  let rb = run_claim(in_d, proof_b, claim_tx(roots, 0, 2000, 0, owner_b, 2000, 100_000, 98_000, 2000, 1, owner_b, []))
  ra && rb
}

test claim_wrong_amount_rejected() fail {
  // sai amount (claim 1500 thay 1000) → leaf khác → root mismatch → reject (crash).
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let bad =
    ClaimProof {
      epoch: 0, owner: owner_a, amount: 1500,
      proof: [MerkleStep { hash: leaf_b(), left: False }],
    }
  let tx = claim_tx(roots, 0, 1500, 0, owner_a, 1500, 100_000, 98_500, 1500, 1, owner_a, [])
  run_claim(in_d, bad, tx)
}

test claim_wrong_proof_rejected() fail {
  // proof sai (anh-em hash bịa) → root mismatch → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let bad =
    ClaimProof {
      epoch: 0, owner: owner_a, amount: 1000,
      proof: [MerkleStep { hash: #"deadbeef", left: False }],
    }
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 1, owner_a, [])
  run_claim(in_d, bad, tx)
}

test claim_no_marker_rejected() fail {
  // KHÔNG đúc marker (qty 0) → reject (double-claim guard).
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 0, owner_a, [])
  run_claim(in_d, proof_a(), tx)
}

test claim_double_marker_rejected() fail {
  // đúc 2 marker (mưu toan double-claim trong 1 tx) → qty 2 ≠ 1 → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 2, owner_a, [])
  run_claim(in_d, proof_a(), tx)
}

test claim_marker_wrong_recipient() fail {
  // marker gửi ví khác (không phải owner) → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 99_000, 1000, 1, #"cccc", [])
  run_claim(in_d, proof_a(), tx)
}

test claim_pool_overdrain_rejected() fail {
  // pool nhả nhiều hơn amount (pool_out LAMP thấp hơn in − amount) → value-eq lệch.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 1000, 100_000, 98_000, 1000, 1, owner_a, [])
  run_claim(in_d, proof_a(), tx)
}

test claim_dist_total_tamper() fail {
  // distributed_total không tăng đúng amount → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 0, 0, owner_a, 1000, 100_000, 99_000, 1000, 1, owner_a, [])
  run_claim(in_d, proof_a(), tx)
}

test claim_epoch_no_root() fail {
  // claim epoch 1 nhưng epoch_roots chỉ có root epoch 0 → list_at None → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let bad =
    ClaimProof {
      epoch: 1, owner: owner_a, amount: 1000,
      proof: [MerkleStep { hash: leaf_b(), left: False }],
    }
  let tx = claim_tx(roots, 0, 1000, 1, owner_a, 1000, 100_000, 99_000, 1000, 1, owner_a, [])
  run_claim(in_d, bad, tx)
}

test claim_double_satisfaction() fail {
  // 2 pool input cùng hash (khác stake) → count_inputs_with_nft==2 → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, 100_000), ip_datum(roots, 0)))
  let pool_in2 =
    util.mk_input(util.mk_ref(1), util.mk_output(util.script_address_staked(ip_pool_sh, #"99"), ip_pool_val(10_000_000, 100_000), ip_datum(roots, 0)))
  let pool_out =
    util.mk_output(pool_addr, ip_pool_val(10_000_000, 99_000), ip_datum(roots, 1000))
  let mname = merkle.marker_name(0, owner_a)
  let owner_val =
    assets.from_lovelace(2_000_000)
      |> assets.add(ip_lamp_policy, ip_lamp_name, 1000)
      |> assets.add(ip_nft_policy, mname, 1)
  let owner_out = util.mk_output(util.vk_address(owner_a), owner_val, leaf_a())
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_in, pool_in2],
      outputs: [pool_out, owner_out],
      mint: marker_mint(0, owner_a, 1),
    }
  run_claim(in_d, proof_a(), tx)
}

// ── SETROOT tests ─────────────────────────────────────────────────

fn setroot_tx(
  in_roots: List<ByteArray>,
  out_roots: List<ByteArray>,
  sigs: List<ByteArray>,
  pool_val_out: assets.Value,
) -> Transaction {
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, 100_000), ip_datum(in_roots, 0)))
  let pool_out = util.mk_output(pool_addr, pool_val_out, ip_datum(out_roots, 0))
  Transaction {
    ..placeholder,
    inputs: [pool_in],
    outputs: [pool_out],
    extra_signatories: sigs,
  }
}

fn run_setroot(in_d: IspoDatum, root: ByteArray, tx: Transaction) -> Bool {
  ispo_pool.spend(
    ip_nft_policy, ip_lamp_policy, ip_lamp_name, ip_admin, ip_admin_threshold,
    Some(in_d), SetRoot { root }, util.mk_ref(0), tx,
  )
}

test setroot_happy() {
  // append root epoch 0 (roots rỗng → [root0]). 2 admin sig.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 100_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_insufficient_admin() fail {
  // chỉ 1 admin sig < threshold 2 → reject.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0()], [#"ad01"], ip_pool_val(10_000_000, 100_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_drains_lamp() fail {
  // SetRoot mưu toan rút LAMP (pool_out LAMP < in) → value bảo toàn lệch → reject.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 50_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_wrong_append() fail {
  // out_roots không phải append đúng (thêm 2 root cùng lúc) → reject.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0(), root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 100_000))
  run_setroot(in_d, root0(), tx)
}

// ── SWEEP tests ───────────────────────────────────────────────────

fn sweep_tx(now_epoch: Int, lamp_in: Int, lamp_to_treasury: Int) -> Transaction {
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, lamp_in), ip_datum([root0()], 0)))
  // LAMP về Treasury (Script(treasury_dest)).
  let tre_val = assets.from_lovelace(2_000_000) |> assets.add(ip_lamp_policy, ip_lamp_name, lamp_to_treasury)
  let tre_out = util.mk_output(util.script_address(ip_treasury), tre_val, leaf_a())
  Transaction {
    ..placeholder,
    inputs: [pool_in],
    outputs: [tre_out],
    validity_range: interval.entirely_after(now_epoch * ip_mspe),
  }
}


fn run_sweep(in_d: IspoDatum, tx: Transaction) -> Bool {
  ispo_pool.spend(
    ip_nft_policy, ip_lamp_policy, ip_lamp_name, ip_admin, ip_admin_threshold,
    Some(in_d), Sweep, util.mk_ref(0), tx,
  )
}

test sweep_after_end() {
  // now=36 > end_epoch=35 → quét toàn bộ LAMP về Treasury.
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(36, 50_000, 50_000)
  run_sweep(in_d, tx)
}

test sweep_before_end_rejected() fail {
  // now=35 == end_epoch (chưa > end) → reject (sweep sớm).
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(35, 50_000, 50_000)
  run_sweep(in_d, tx)
}

test sweep_to_treasury_full() {
  // toàn bộ LAMP dư phải về Treasury (≥ lamp_in). 50_000 in → 50_000 Treasury.
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(40, 50_000, 50_000)
  run_sweep(in_d, tx)
}

test sweep_skims_lamp_rejected() fail {
  // sweep mà giữ lại LAMP (Treasury nhận < lamp_in) → reject.
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(40, 50_000, 10_000)
  run_sweep(in_d, tx)
}
