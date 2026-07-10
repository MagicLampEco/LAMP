// faucet_pool — UTxO kho tLAMP + POOL NFT. Self-serve, DID-gated, rate-limited.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM (KHÔNG hash-param chéo — xem ledger.ak)
//   faucet_nft_policy : policy id đúc POOL + ACCT NFT (nhận diện pool/account).
//   did_nft_policy    : policy id của DID NFT (testnet: DID test; mainnet: PhoenixKey).
//   lamp_policy       : policy id tLAMP.
//   lamp_name         : asset name tLAMP.
//   ms_per_epoch      : ms mỗi epoch (network-specific) → quy đổi epoch.
//
// ─────────────────────────────────────────────────────────────────────────
// CLAIM (permissionless, DID-gated):
//   - đúng 1 POOL input + 1 POOL output (theo POOL NFT authenticity).
//   - FaucetConfig (drip/cooldown/reclaim) bảo toàn ở pool output.
//   - pool.value bảo toàn TUYỆT ĐỐI trừ −drip_oil tLAMP (giữ POOL NFT + ADA + dust).
//   - tx có input mang DID NFT (did_nft_policy, did_name) qty ≥1 → định danh DID.
//   - đúng 1 account output (mang ACCT NFT) datum {did_name, last_epoch=now},
//     nhận ĐÚNG drip_oil tLAMP. did_name account == did_name của DID NFT.
//   - COOLDOWN: nếu tx có account INPUT cùng did_name (re-claim) → ép
//     now ≥ old.last_epoch + cooldown_epochs. (First-claim: không có account input.)
//   - 1 account/DID: re-claim consume account cũ, account validator burn ACCT cũ
//     (xem faucet_account.ak Use→relocate); pool chỉ ép cooldown + cấp drip.
//
// RECLAIM (nhận tLAMP từ account idle bị thu hồi):
//   - pool output value = pool input + (tLAMP account trả về). FaucetConfig bảo
//     toàn. Pool chỉ cần đảm bảo POOL NFT ở lại + config bất biến + pool KHÔNG
//     mất tLAMP. Account validator (ReclaimIdle) ép toàn bộ tLAMP về pool.

use aiken/interval
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction, placeholder}
use magiclamp/faucet/ledger.{
  Claim, FaucetAccount, FaucetConfig, PoolRedeemer, Reclaim, acct_nft_name,
  pool_nft_name,
}
use magiclamp/faucet/util

validator faucet_pool(
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<FaucetConfig>,
    redeemer: PoolRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(cfg) = datum_opt

    // ── Bất biến chung: đúng 1 POOL input + 1 POOL output (POOL NFT authenticity).
    // KHÔNG đếm theo script-hash mà theo NFT → pool chính danh = pool mang NFT.
    expect
      util.count_inputs_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name) == 1
    expect
      util.count_outputs_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name) == 1

    let pool_in = util.input_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name)
    let pool_out = util.output_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name)

    // own_ref phải TRỎ chính pool input (chống spoof own_ref sang UTxO khác).
    let own_addr = util.own_address(own_ref, tx.inputs)
    expect own_addr == pool_in.address

    // FaucetConfig bảo toàn (drip/cooldown/reclaim không bị đổi để drain).
    expect InlineDatum(od) = pool_out.datum
    expect out_cfg: FaucetConfig = od
    expect out_cfg == cfg

    // Hằng hợp lệ.
    expect cfg.drip_oil > 0
    expect cfg.cooldown_epochs >= 0
    expect cfg.reclaim_epochs > 0

    when redeemer is {
      // ── CLAIM ──────────────────────────────────────────────────────────
      Claim -> {
        let now = util.get_epoch(tx, ms_per_epoch)

        // pool.value = pool_in − drip tLAMP (giữ POOL NFT + ADA + mọi asset khác).
        expect
          pool_out.value == assets.add(
            pool_in.value,
            lamp_policy,
            lamp_name,
            -cfg.drip_oil,
          )

        // Đúng 1 account output mang ACCT NFT (account chính danh mới).
        expect
          util.count_outputs_with_nft(tx.outputs, faucet_nft_policy, acct_nft_name) == 1
        let acct_out =
          util.output_with_nft(tx.outputs, faucet_nft_policy, acct_nft_name)
        expect InlineDatum(ad) = acct_out.datum
        expect acct: FaucetAccount = ad

        // last_epoch của account mới = now (mốc cooldown/reclaim kế tiếp).
        expect acct.last_epoch == now

        // Account nhận ĐÚNG drip tLAMP (không hơn không kém → bảo toàn cung).
        expect
          assets.quantity_of(acct_out.value, lamp_policy, lamp_name) == cfg.drip_oil

        // DID-gated: tx có input mang DID NFT (did_nft_policy, did_name=acct.did_name)
        // qty ≥1. did_name account PHẢI khớp DID NFT → chống claim hộ DID khác.
        expect
          util.count_inputs_with_nft(tx.inputs, did_nft_policy, acct.did_name) >= 1

        // COOLDOWN: nếu có account INPUT cùng did_name (re-claim) → ép cooldown.
        // First-claim: không account input cùng did_name → cooldown bỏ qua.
        when find_account_input_epoch(tx, faucet_nft_policy, acct.did_name) is {
          Some(old_epoch) -> now >= old_epoch + cfg.cooldown_epochs
          None -> True
        }
      }

      // ── RECLAIM (nhận tLAMP từ account idle) ───────────────────────────
      Reclaim -> {
        // Pool KHÔNG được mất tLAMP: pool_out tLAMP ≥ pool_in tLAMP. (Account
        // validator ReclaimIdle ép TOÀN BỘ tLAMP account → pool, nên pool tăng.)
        let lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)
        let lamp_out = assets.quantity_of(pool_out.value, lamp_policy, lamp_name)
        expect lamp_out >= lamp_in
        // POOL NFT + ADA bảo toàn (pool_out = pool_in + Δ tLAMP, Δ ≥ 0). Kiểm
        // bằng value-eq: pool_out == pool_in cộng đúng (lamp_out − lamp_in) tLAMP.
        expect
          pool_out.value == assets.add(
            pool_in.value,
            lamp_policy,
            lamp_name,
            lamp_out - lamp_in,
          )
        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// Tìm account INPUT (mang ACCT NFT) có did_name khớp → trả last_epoch của nó.
/// Dùng cho cooldown ở Claim (re-claim consume account cũ cùng DID).
/// Trả None nếu không có account input cùng DID (first-claim).
fn find_account_input_epoch(
  tx: Transaction,
  faucet_nft_policy: ByteArray,
  did_name: ByteArray,
) -> Option<Int> {
  list_find_map(
    tx.inputs,
    fn(i) {
      if util.has_nft(i.output, faucet_nft_policy, acct_nft_name) {
        when i.output.datum is {
          InlineDatum(d) -> {
            expect acct: FaucetAccount = d
            if acct.did_name == did_name {
              Some(acct.last_epoch)
            } else {
              None
            }
          }
          _ -> None
        }
      } else {
        None
      }
    },
  )
}

/// list.find_map thuần (viết inline để tránh phụ thuộc thêm import).
fn list_find_map(xs: List<a>, f: fn(a) -> Option<b>) -> Option<b> {
  when xs is {
    [] -> None
    [x, ..rest] ->
      when f(x) is {
        Some(v) -> Some(v)
        None -> list_find_map(rest, f)
      }
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const fp_nft_policy: ByteArray = #"facade01"

const fp_did_policy: ByteArray = #"d1dd1d"

const fp_lamp_policy: ByteArray = #"1a3b"

const fp_lamp_name: ByteArray = #"744c414d50"

const fp_pool_sh: ByteArray = #"facade"

const fp_ms_per_epoch: Int = 432_000_000

// drip 1001 tLAMP, cooldown 36, reclaim 1001.
const fp_drip: Int = 1_001_000_000

const fp_cooldown: Int = 36

const fp_reclaim: Int = 1001

const fp_did_name: ByteArray = #"a11ce0"

fn fp_cfg() -> FaucetConfig {
  FaucetConfig {
    drip_oil: fp_drip,
    cooldown_epochs: fp_cooldown,
    reclaim_epochs: fp_reclaim,
  }
}

/// pool value: lovelace + POOL NFT + tLAMP qty.
fn fp_pool_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fp_nft_policy, pool_nft_name, 1)
    |> assets.add(fp_lamp_policy, fp_lamp_name, tlamp)
}

/// account value: lovelace + ACCT NFT + tLAMP qty.
fn fp_acct_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fp_nft_policy, acct_nft_name, 1)
    |> assets.add(fp_lamp_policy, fp_lamp_name, tlamp)
}

/// DID NFT value (did_nft_policy, did_name, 1).
fn fp_did_val(name: ByteArray) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(fp_did_policy, name, 1)
}

fn fp_acct_datum(name: ByteArray, ep: Int) -> FaucetAccount {
  FaucetAccount { did_name: name, last_epoch: ep }
}

/// validity range với lower_bound = epoch × ms_per_epoch (POSIX ms).
/// entirely_after(ms) → lower_bound Finite(ms) → get_epoch = epoch.
fn fp_tx_at(epoch: Int, base: Transaction) -> Transaction {
  let ms = epoch * fp_ms_per_epoch
  Transaction { ..base, validity_range: interval.entirely_after(ms) }
}

// ── CLAIM tests ──────────────────────────────────────────────────

/// Dựng tx Claim cơ bản (first-claim, không account input).
fn claim_tx_first(now_epoch: Int, did_name: ByteArray, acct_epoch: Int) -> Transaction {
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), fp_cfg())
  let acct_out =
    util.mk_output(
      util.script_address(#"acc0"),
      fp_acct_val(2_000_000, fp_drip),
      fp_acct_datum(did_name, acct_epoch),
    )
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(did_name)))
  let base =
    Transaction {
      ..placeholder,
      inputs: [pool_in, did_in],
      outputs: [pool_out, acct_out],
    }
  fp_tx_at(now_epoch, base)
}

test claim_happy_first() {
  let tx = claim_tx_first(100, fp_did_name, 100)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_no_did_nft() fail {
  // Không DID NFT input → count == 0 → reject (DID-gated).
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), fp_cfg())
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(fp_did_name, 100))
  let base = Transaction { ..placeholder, inputs: [pool_in], outputs: [pool_out, acct_out] }
  let tx = fp_tx_at(100, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_wrong_drip() fail {
  // account nhận 500 tLAMP thay vì drip → reject.
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), fp_cfg())
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, 500_000_000), fp_acct_datum(fp_did_name, 100))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(fp_did_name)))
  let base = Transaction { ..placeholder, inputs: [pool_in, did_in], outputs: [pool_out, acct_out] }
  let tx = fp_tx_at(100, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_pool_drain_extra() fail {
  // pool nhả nhiều hơn drip (pool_out tLAMP thấp hơn in − drip) → value-eq lệch.
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - 2 * fp_drip), fp_cfg())
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(fp_did_name, 100))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(fp_did_name)))
  let base = Transaction { ..placeholder, inputs: [pool_in, did_in], outputs: [pool_out, acct_out] }
  let tx = fp_tx_at(100, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_last_epoch_not_now() fail {
  // account.last_epoch ≠ now → reject (chống bịa mốc để né cooldown sau).
  let tx = claim_tx_first(100, fp_did_name, 50)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_did_name_mismatch() fail {
  // account did_name khác DID NFT name → count DID NFT (theo acct.did_name) == 0 → reject.
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), fp_cfg())
  // account khai did_name = bob nhưng tx chỉ có DID NFT của alice.
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(#"b0b0", 100))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(fp_did_name)))
  let base = Transaction { ..placeholder, inputs: [pool_in, did_in], outputs: [pool_out, acct_out] }
  let tx = fp_tx_at(100, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

/// Dựng tx re-claim: có account input cũ (cùng did_name, last_epoch=old_ep).
fn reclaim_tx(now_epoch: Int, old_ep: Int) -> Transaction {
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), fp_cfg())
  let old_acct_in =
    util.mk_input(
      util.mk_ref(3),
      util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(fp_did_name, old_ep)),
    )
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(fp_did_name, now_epoch))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(fp_did_name)))
  let base =
    Transaction { ..placeholder, inputs: [pool_in, old_acct_in, did_in], outputs: [pool_out, acct_out] }
  fp_tx_at(now_epoch, base)
}

test claim_reclaim_after_cooldown() {
  // old.last_epoch=100, cooldown=36 → now=136 OK.
  let tx = reclaim_tx(136, 100)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_before_cooldown() fail {
  // now=135 < 100+36=136 → reject.
  let tx = reclaim_tx(135, 100)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_config_tamper() fail {
  // pool_out config đổi drip → out_cfg ≠ cfg → reject.
  let pool_addr = util.script_address(fp_pool_sh)
  let bad_cfg = FaucetConfig { drip_oil: 1, cooldown_epochs: 0, reclaim_epochs: 1 }
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), bad_cfg)
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(fp_did_name, 100))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(fp_did_name)))
  let base = Transaction { ..placeholder, inputs: [pool_in, did_in], outputs: [pool_out, acct_out] }
  let tx = fp_tx_at(100, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

test claim_two_pool_inputs() fail {
  // 2 POOL NFT input → count == 2 → reject (double-satisfaction).
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_in2 =
    util.mk_input(util.mk_ref(1), util.mk_output(util.script_address_staked(fp_pool_sh, #"99"), fp_pool_val(10_000_000, 5_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 5_000_000_000 - fp_drip), fp_cfg())
  let acct_out =
    util.mk_output(util.script_address(#"acc0"), fp_acct_val(2_000_000, fp_drip), fp_acct_datum(fp_did_name, 100))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fp_did_val(fp_did_name)))
  let base = Transaction { ..placeholder, inputs: [pool_in, pool_in2, did_in], outputs: [pool_out, acct_out] }
  let tx = fp_tx_at(100, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Claim, util.mk_ref(0), tx,
  )
}

// ── RECLAIM tests (pool nhận token về) ───────────────────────────

test reclaim_pool_gains() {
  // account trả fp_drip về pool → pool_out tLAMP = in + drip. pool_in tLAMP=1000.
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 1_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 1_000_000_000 + fp_drip), fp_cfg())
  let base = Transaction { ..placeholder, inputs: [pool_in], outputs: [pool_out] }
  let tx = fp_tx_at(2000, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Reclaim, util.mk_ref(0), tx,
  )
}

test reclaim_pool_loses() fail {
  // pool_out tLAMP < pool_in → lamp_out < lamp_in → reject (chống rút pool qua Reclaim).
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 1_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(10_000_000, 1_000_000_000 - fp_drip), fp_cfg())
  let base = Transaction { ..placeholder, inputs: [pool_in], outputs: [pool_out] }
  let tx = fp_tx_at(2000, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Reclaim, util.mk_ref(0), tx,
  )
}

test reclaim_steal_ada() fail {
  // Reclaim mà rút ADA (pool_out lovelace < in) → value-eq lệch → reject.
  let pool_addr = util.script_address(fp_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, fp_pool_val(10_000_000, 1_000_000_000), fp_cfg()))
  let pool_out =
    util.mk_output(pool_addr, fp_pool_val(2_000_000, 1_000_000_000 + fp_drip), fp_cfg())
  let base = Transaction { ..placeholder, inputs: [pool_in], outputs: [pool_out] }
  let tx = fp_tx_at(2000, base)
  faucet_pool.spend(
    fp_nft_policy, fp_did_policy, fp_lamp_policy, fp_lamp_name, fp_ms_per_epoch,
    Some(fp_cfg()), Reclaim, util.mk_ref(0), tx,
  )
}
