// faucet_account — UTxO per-DID mang ACCT NFT, giữ tLAMP đã claim.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM
//   faucet_nft_policy : policy id POOL/ACCT NFT (nhận diện pool qua POOL NFT).
//   did_nft_policy    : policy id DID NFT (chủ DID phải mang để Use).
//   lamp_policy       : policy id tLAMP.
//   lamp_name         : asset name tLAMP.
//   ms_per_epoch      : ms mỗi epoch.
//
// Datum: FaucetAccount{did_name, last_epoch}.
//
// ─────────────────────────────────────────────────────────────────────────
// USE (chủ DID dùng tLAMP test):
//   - tx có input mang DID NFT (did_nft_policy, did_name) qty ≥1 → chứng minh
//     quyền sở hữu DID (chủ DID nắm NFT). KHÔNG cần khóa riêng → bám DID NFT,
//     khớp mô hình DID-gated của Claim.
//   - account output mang ACCT NFT, did_name BẤT BIẾN, last_epoch cập nhật = now
//     (gia hạn idle → tránh bị reclaim). KHÔNG truy đòi pool (độc lập).
//   - C-ACCT-ADDR-1 acct_out.address == acct_in.address (ĐỊA CHỈ ĐẦY ĐỦ —
//     `count/output_at_script` chỉ so payment credential nên stake credential
//     của account là trường tự do nếu không ghim).
//   - C-ACCT-REF-1  acct_out.reference_script == None.
//
// RECLAIM IDLE (permissionless thu hồi account chết):
//   - now ≥ last_epoch + reclaim_epochs → ai cũng spend (KHÔNG cần DID NFT).
//   - TOÀN BỘ tLAMP của account PHẢI về pool (output mang POOL NFT nhận đủ).
//     → bảo toàn cung: token idle quay lại pool, không bốc hơi, không vào ví keeper.
//   - C-ACCT-POOLADDR-1 pool_out.address == pool_in.address. `output_with_nft`
//     định vị pool_out thuần bằng POOL NFT; không ghim thì keeper trả đủ token
//     nhưng đưa kho sang ví mình. KHÔNG trông vào `faucet_pool` ép hộ: validator
//     đó chỉ chạy khi pool CÒN ở script pool.
//   - ACCT NFT có thể burn hoặc gửi đâu tùy (không ràng buộc — pool nhận token là đủ).

use aiken/interval
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/faucet/ledger.{
  AccountRedeemer, FaucetAccount, ReclaimIdle, Use, acct_nft_name, pool_nft_name,
}
use magiclamp/faucet/util

validator faucet_account(
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<FaucetAccount>,
    redeemer: AccountRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(acct) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // Đúng 1 account input + 1 account output (theo SCRIPT HASH) — chống
    // double-satisfaction qua stake credential.
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    let acct_in = util.input_at_script(tx.inputs, own_hash)

    let now = util.get_epoch(tx, ms_per_epoch)
    let acct_lamp = assets.quantity_of(acct_in.value, lamp_policy, lamp_name)

    when redeemer is {
      // ── USE (chủ DID gia hạn + dùng tLAMP) ─────────────────────────────
      Use -> {
        // đúng 1 account output cùng script.
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let acct_out = util.output_at_script(tx.outputs, own_hash)

        // ── C-ACCT-ADDR-1: acct_out ở ĐÚNG địa chỉ của acct_in ─────────────
        // `count_outputs_at_script`/`output_at_script` chỉ so PAYMENT credential ⇒
        // phần stake credential của account là trường TỰ DO mà không dòng nào canh:
        // cùng script hash + khác stake credential = Address khác nhưng cùng
        // validator. Hệ quả: phần thưởng uỷ quyền trên ADA của account chảy về khoá
        // stake kẻ dựng tx, và địa chỉ bech32 của account đổi sau mỗi lượt Use nên
        // bên index theo địa chỉ mất dấu. Ghim bởi `use_acct_out_stake_hijack`.
        expect acct_out.address == acct_in.address

        // ── C-ACCT-REF-1: account KHÔNG biến thành script-carrier ──────────
        // Ghim bởi `use_acct_out_script_carrier`.
        expect acct_out.reference_script == None

        expect InlineDatum(od) = acct_out.datum
        expect out_acct: FaucetAccount = od

        // Chủ DID: tx mang DID NFT (did_nft_policy, acct.did_name) qty ≥1.
        expect
          util.count_inputs_with_nft(tx.inputs, did_nft_policy, acct.did_name) >= 1

        // did_name bất biến; last_epoch cập nhật = now (gia hạn idle).
        expect out_acct.did_name == acct.did_name
        expect out_acct.last_epoch == now

        // ACCT NFT ở lại account; account giữ ≥ tLAMP cũ trừ phần đã tiêu hợp lệ?
        // CHỐT đơn giản: account KHÔNG được tăng tLAMP một cách lén (chống bơm),
        // nhưng cho phép GIẢM (chủ DID rút ra dùng). Chỉ ép: ACCT NFT vẫn trên
        // account_out + tLAMP_out ≤ tLAMP_in (không tự bơm), và ≥ 0.
        expect util.has_nft(acct_out, faucet_nft_policy, acct_nft_name)
        let out_lamp = assets.quantity_of(acct_out.value, lamp_policy, lamp_name)
        expect out_lamp >= 0
        expect out_lamp <= acct_lamp
        True
      }

      // ── RECLAIM IDLE (permissionless) ──────────────────────────────────
      ReclaimIdle -> {
        // Idle đủ lâu: now ≥ last_epoch + reclaim_epochs_const. Dùng hằng
        // compile-time (= FaucetConfig.reclaim_epochs chuẩn 1001) để keeper KHÔNG
        // phải đọc FaucetConfig của pool khi thu hồi → ít reference input, đơn giản.
        expect now >= acct.last_epoch + reclaim_epochs_const

        // POOL phải có mặt trong tx (đúng 1 POOL input + 1 POOL output): pool
        // validator Reclaim chạy cùng tx, ép value bảo toàn (POOL NFT + ADA ở lại).
        expect
          util.count_inputs_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name) == 1
        expect
          util.count_outputs_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name) == 1
        let pool_in =
          util.input_with_nft(tx.inputs, faucet_nft_policy, pool_nft_name)
        let pool_out =
          util.output_with_nft(tx.outputs, faucet_nft_policy, pool_nft_name)

        // ── C-ACCT-POOLADDR-1: pool_out ở ĐÚNG địa chỉ của pool_in ─────────
        // `output_with_nft` định vị pool_out THUẦN bằng POOL NFT — không nói gì về
        // nơi đến. Đây KHÔNG phải kiểm trùng với `faucet_pool` C-POOL-OUT-1: dòng
        // bên kia chỉ chạy khi pool CÒN ở script pool. Nếu POOL NFT đã lạc ra ví
        // (hoặc lạc lúc deploy), `faucet_pool.spend` không được gọi và nhánh này là
        // cổng DUY NHẤT còn đứng. POOL NFT one-shot (`faucet_nft.ak` MintPool tiêu
        // genesis_ref, MintAccount cấm đụng POOL NFT) ⇒ mất chỗ là mất vĩnh viễn.
        // Ghim bởi `reclaim_idle_pool_to_wallet` · `reclaim_idle_pool_stake_hijack`.
        //
        // KHÔNG ghim `pool_out.reference_script` ở đây: hình dạng của UTxO pool là
        // thẩm quyền của `faucet_pool` (C-POOL-OUT-2), chép lại là dựng bản sao sẽ
        // trôi. Ghim địa chỉ thì khác — nó trả lời đúng câu "validator pool có chạy
        // hay không", câu mà bên kia theo định nghĩa không tự trả lời được.
        expect pool_out.address == pool_in.address

        // TOÀN BỘ tLAMP account PHẢI về pool: Δ pool tLAMP ≥ acct_lamp. So sánh
        // DELTA (out − in) chứ không so tuyệt đối → keeper không thể "đếm sẵn"
        // tLAMP có sẵn trong pool để né. Bảo toàn cung: token idle → pool, KHÔNG
        // bốc hơi, KHÔNG vào ví keeper.
        let pool_lamp_in =
          assets.quantity_of(pool_in.value, lamp_policy, lamp_name)
        let pool_lamp_out =
          assets.quantity_of(pool_out.value, lamp_policy, lamp_name)
        expect pool_lamp_out - pool_lamp_in >= acct_lamp
        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// Ngưỡng reclaim (epoch) — hằng protocol = 1001. Account dùng hằng compile-time
/// để keeper KHÔNG phải đọc FaucetConfig của pool khi thu hồi (đơn giản, ít
/// reference input). Khớp FaucetConfig.reclaim_epochs chuẩn = 1001.
const reclaim_epochs_const: Int = 1001

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const fa_nft_policy: ByteArray = #"facade01"

const fa_did_policy: ByteArray = #"d1dd1d"

const fa_lamp_policy: ByteArray = #"1a3b"

const fa_lamp_name: ByteArray = #"744c414d50"

const fa_acct_sh: ByteArray = #"acc0"

const fa_pool_sh: ByteArray = #"facade"

const fa_ms_per_epoch: Int = 432_000_000

const fa_drip: Int = 1_001_000_000

const fa_did_name: ByteArray = #"a11ce0"

fn fa_acct_datum(name: ByteArray, ep: Int) -> FaucetAccount {
  FaucetAccount { did_name: name, last_epoch: ep }
}

/// account value: lovelace + ACCT NFT + tLAMP.
fn fa_acct_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fa_nft_policy, acct_nft_name, 1)
    |> assets.add(fa_lamp_policy, fa_lamp_name, tlamp)
}

/// pool value (POOL NFT) nhận token reclaim.
fn fa_pool_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fa_nft_policy, pool_nft_name, 1)
    |> assets.add(fa_lamp_policy, fa_lamp_name, tlamp)
}

fn fa_did_val(name: ByteArray) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(fa_did_policy, name, 1)
}

fn fa_tx_at(epoch: Int, base: Transaction) -> Transaction {
  let ms = epoch * fa_ms_per_epoch
  Transaction { ..base, validity_range: interval.entirely_after(ms) }
}

// ── USE tests ────────────────────────────────────────────────────

test use_happy_updates_epoch() {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(util.mk_ref(0), util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)))
  let acct_out =
    util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 150))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fa_did_val(fa_did_name)))
  let base = Transaction { ..placeholder, inputs: [acct_in, did_in], outputs: [acct_out] }
  let tx = fa_tx_at(150, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), Use, util.mk_ref(0), tx,
  )
}

test use_no_did_nft() fail {
  // Use mà không có DID NFT → reject (chỉ chủ DID mới được dùng).
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(util.mk_ref(0), util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)))
  let acct_out =
    util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 150))
  let base = Transaction { ..placeholder, inputs: [acct_in], outputs: [acct_out] }
  let tx = fa_tx_at(150, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), Use, util.mk_ref(0), tx,
  )
}

test use_epoch_not_now() fail {
  // last_epoch out ≠ now → reject.
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(util.mk_ref(0), util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)))
  let acct_out =
    util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 999))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fa_did_val(fa_did_name)))
  let base = Transaction { ..placeholder, inputs: [acct_in, did_in], outputs: [acct_out] }
  let tx = fa_tx_at(150, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), Use, util.mk_ref(0), tx,
  )
}

test use_self_inflate_tlamp() fail {
  // account_out tLAMP > in → bơm token vào account → reject.
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(util.mk_ref(0), util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)))
  let acct_out =
    util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip + 1), fa_acct_datum(fa_did_name, 150))
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fa_did_val(fa_did_name)))
  let base = Transaction { ..placeholder, inputs: [acct_in, did_in], outputs: [acct_out] }
  let tx = fa_tx_at(150, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), Use, util.mk_ref(0), tx,
  )
}

// ── RECLAIM IDLE tests ───────────────────────────────────────────
// Mô hình: pool_in 5_000_000_000 tLAMP. Reclaim trả account về pool →
// pool_out = 5_000_000_000 + Δ. Δ ≥ acct_lamp (= fa_drip) là hợp lệ.

const fa_pool_base: Int = 5_000_000_000

fn fa_pool_input() -> Input {
  util.mk_input(
    util.mk_ref(1),
    util.mk_output(util.script_address(fa_pool_sh), fa_pool_val(10_000_000, fa_pool_base), fa_acct_datum(fa_did_name, 0)),
  )
}

fn fa_acct_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(fa_acct_sh), fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)),
  )
}

/// pool output với tLAMP = base + delta.
fn fa_pool_out(delta: Int) -> Output {
  util.mk_output(util.script_address(fa_pool_sh), fa_pool_val(10_000_000, fa_pool_base + delta), fa_acct_datum(fa_did_name, 0))
}

test reclaim_idle_happy() {
  // now=1101 ≥ 100+1001; pool nhận đủ Δ=fa_drip (toàn bộ tLAMP account) → pass.
  let base = Transaction { ..placeholder, inputs: [fa_acct_input(), fa_pool_input()], outputs: [fa_pool_out(fa_drip)] }
  let tx = fa_tx_at(1101, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), ReclaimIdle, util.mk_ref(0), tx,
  )
}

test reclaim_idle_too_early() fail {
  // now=1100 < 100+1001=1101 → reject (chưa đủ idle).
  let base = Transaction { ..placeholder, inputs: [fa_acct_input(), fa_pool_input()], outputs: [fa_pool_out(fa_drip)] }
  let tx = fa_tx_at(1100, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), ReclaimIdle, util.mk_ref(0), tx,
  )
}

test reclaim_idle_token_not_to_pool() fail {
  // pool nhận Δ = fa_drip − 1 < acct_lamp (keeper cuỗm 1 token) → reject.
  let base = Transaction { ..placeholder, inputs: [fa_acct_input(), fa_pool_input()], outputs: [fa_pool_out(fa_drip - 1)] }
  let tx = fa_tx_at(1101, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), ReclaimIdle, util.mk_ref(0), tx,
  )
}

test reclaim_idle_no_pool_output() fail {
  // không có POOL NFT output → count_outputs_with_nft == 0 → reject (token không về pool).
  let bad_out =
    util.mk_output_no_datum(util.vk_address(#"ee"), assets.from_lovelace(2_000_000) |> assets.add(fa_lamp_policy, fa_lamp_name, fa_drip))
  let base = Transaction { ..placeholder, inputs: [fa_acct_input(), fa_pool_input()], outputs: [bad_out] }
  let tx = fa_tx_at(1101, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), ReclaimIdle, util.mk_ref(0), tx,
  )
}

// ══════════════════════════════════════════════════════════════
// ĐÍCH — ca kiểm ĐỔI ĐỊA CHỈ (cùng lớp với faucet_pool)
// ══════════════════════════════════════════════════════════════
// Mọi ca phía trên dựng acct_out/pool_out bằng cùng một hằng địa chỉ ở cả hai cực
// ⇒ không ca nào phân biệt được nơi đến. Bốn ca dưới giữ nguyên value + datum,
// chỉ đổi ĐỊA CHỈ / reference_script.

const fa_thief_pkh: ByteArray = #"a77ac6"

/// Use: acct_out CÙNG script hash, KHÁC stake credential. `count_outputs_at_script`
/// chỉ so payment credential nên nó đi lọt — chủ DID (hoặc bất kỳ ai dựng hộ tx có
/// DID NFT trong input) lái phần thưởng uỷ quyền trên ADA của account đi, và địa chỉ
/// bech32 của account đổi mỗi lượt Use nên bên index mất dấu.
test use_acct_out_stake_hijack() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(util.mk_ref(0), util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)))
  let acct_out =
    util.mk_output(
      util.script_address_staked(fa_acct_sh, fa_thief_pkh),
      fa_acct_val(2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 150),
    )
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fa_did_val(fa_did_name)))
  let base = Transaction { ..placeholder, inputs: [acct_in, did_in], outputs: [acct_out] }
  let tx = fa_tx_at(150, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), Use, util.mk_ref(0), tx,
  )
}

/// Use: acct_out đúng chỗ, đúng value, nhưng đính reference script → min-ADA của
/// account nhảy vọt, mọi lượt Use/ReclaimIdle sau gánh thêm phí.
test use_acct_out_script_carrier() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(util.mk_ref(0), util.mk_output(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 100)))
  let acct_out =
    util.mk_output_with_ref_script(acct_addr, fa_acct_val(2_000_000, fa_drip), fa_acct_datum(fa_did_name, 150), #"beef")
  let did_in =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(#"c1"), fa_did_val(fa_did_name)))
  let base = Transaction { ..placeholder, inputs: [acct_in, did_in], outputs: [acct_out] }
  let tx = fa_tx_at(150, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), Use, util.mk_ref(0), tx,
  )
}

/// ReclaimIdle: pool_out định vị THUẦN bằng POOL NFT. Keeper trả đủ tLAMP nhưng
/// đưa pool sang VÍ mình → kho ra khỏi script, và POOL NFT one-shot không đúc lại
/// được. Sau vá, dòng ghim địa chỉ ở faucet_account chặn ngay tại đây — không phải
/// đợi faucet_pool.Reclaim chạy (nó chỉ chạy khi pool CÒN ở script pool).
test reclaim_idle_pool_to_wallet() fail {
  let pool_out =
    util.mk_output(
      util.vk_address(fa_thief_pkh),
      fa_pool_val(10_000_000, fa_pool_base + fa_drip),
      fa_acct_datum(fa_did_name, 0),
    )
  let base = Transaction { ..placeholder, inputs: [fa_acct_input(), fa_pool_input()], outputs: [pool_out] }
  let tx = fa_tx_at(1101, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), ReclaimIdle, util.mk_ref(0), tx,
  )
}

/// ReclaimIdle: pool_out cùng script hash, khác stake credential — biến thể mà mọi
/// phép so theo payment credential đều cho đi qua.
test reclaim_idle_pool_stake_hijack() fail {
  let pool_out =
    util.mk_output(
      util.script_address_staked(fa_pool_sh, fa_thief_pkh),
      fa_pool_val(10_000_000, fa_pool_base + fa_drip),
      fa_acct_datum(fa_did_name, 0),
    )
  let base = Transaction { ..placeholder, inputs: [fa_acct_input(), fa_pool_input()], outputs: [pool_out] }
  let tx = fa_tx_at(1101, base)
  faucet_account.spend(
    fa_nft_policy, fa_did_policy, fa_lamp_policy, fa_lamp_name, fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100)), ReclaimIdle, util.mk_ref(0), tx,
  )
}
