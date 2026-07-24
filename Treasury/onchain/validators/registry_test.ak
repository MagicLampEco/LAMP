// Validator tests cho registry (spend validator — cập nhật entry platform đã đăng ký).
// Phủ: cập nhật đúng (pass); thiếu chữ ký authority (fail); đổi identity bất biến (fail);
//      out KHÔNG mang beacon NFT (fail); tx có mint≠0 (fail); 2 entry input cùng script (fail);
//      mutable invalid cut_bps>10000 (fail); entry out ở ví thường (fail).
//
// Phong cách mirror custody_seed_test.ak: placeholder tx, beacon NFT trong value,
// authority vkh đặt trong extra_signatories.

use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/treasury/platform.{Active, Paused, Retired, PlatformEntry, UpdateEntry}
use registry
use magiclamp/treasury/types.{AssetKey}
use magiclamp/treasury/util

// ── Hằng số test ──
const beacon_policy: assets.PolicyId = #"b3ac"

const authority: ByteArray = #"a07a01"

// script hash registry validator (param own_ref trỏ vào input ở đây).
const reg_sh: ByteArray = #"4e6f"

const platform_id: ByteArray = #"706b"

const instance_id: ByteArray = #"abcd"

const custody_hash: ByteArray = #"c0c0c0c0"

const seed_policy: ByteArray = #"5eed"

const governance_ref: ByteArray = #"9999"

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

fn accepted() -> List<AssetKey> {
  [AssetKey { policy: #"", name: #"" }, AssetKey { policy: lamp_policy, name: lamp_name }]
}

// Entry input (đã đăng ký, status Active).
fn entry_in() -> PlatformEntry {
  PlatformEntry {
    platform_id: platform_id,
    instance_id: instance_id,
    custody_hash: custody_hash,
    seed_policy: seed_policy,
    governance_ref: governance_ref,
    accepted_assets: accepted(),
    cut_bps: 1000,
    created_epoch: 5,
    status: Active,
  }
}

// own_ref: tham chiếu UTxO entry đang spend.
fn own_ref() -> OutputReference {
  util.mk_ref(0)
}

// Value entry mang beacon NFT (beacon_policy, platform_id) qty 1 + min-ADA (U-NFT).
fn with_nft(name: ByteArray) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(beacon_policy, name, 1)
}

// Input entry ở SCRIPT registry (mang beacon NFT + datum).
fn reg_input(ref: OutputReference, name: ByteArray, e: PlatformEntry) -> Input {
  util.mk_input(ref, util.mk_output(util.script_address(reg_sh), with_nft(name), e))
}

// Output entry ở SCRIPT registry (mang beacon NFT + datum).
fn reg_output(name: ByteArray, e: PlatformEntry) -> Output {
  util.mk_output(util.script_address(reg_sh), with_nft(name), e)
}

// Dựng tx cập nhật: inputs, outputs, mint, ký authority (extra_signatories).
fn upd_tx(
  inputs   : List<Input>,
  outputs  : List<Output>,
  mint     : assets.Value,
  signers  : List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: inputs,
    outputs: outputs,
    mint: mint,
    extra_signatories: signers,
  }
}

fn run(datum: PlatformEntry, tx: Transaction) -> Bool {
  registry.registry.spend(
    authority, beacon_policy, Some(datum), UpdateEntry, own_ref(), tx,
  )
}

// ════════════════════════════════════════════════════════════
// 1. CẬP NHẬT ĐÚNG (pass) — authority ký, 1 entry in + 1 out theo script hash,
//    beacon NFT bảo toàn in&out, identity bất biến, đổi status Active→Paused
//    (mutable hợp lệ: governance_ref/accepted/cut_bps vẫn ok).
// ════════════════════════════════════════════════════════════
test update_happy() {
  let e_out = PlatformEntry { ..entry_in(), status: Paused }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [authority],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 2. THIẾU CHỮ KÝ AUTHORITY (fail) — U-SIG.
// ════════════════════════════════════════════════════════════
test update_no_authority_sig() fail {
  let e_out = PlatformEntry { ..entry_in(), status: Paused }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [#"deadbeef"],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 3. ĐỔI IDENTITY BẤT BIẾN (fail) — U-ID (identity_preserved).
//    Đổi instance_id ở out → identity_preserved fail.
//    Out vẫn mang beacon NFT name=platform_id (giữ U-NFT) để cô lập = U-ID.
// ════════════════════════════════════════════════════════════
test update_identity_tamper() fail {
  let e_out = PlatformEntry { ..entry_in(), instance_id: #"ffff" }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [authority],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 4. OUT KHÔNG MANG BEACON NFT (fail) — U-NFT (has_one_nft out).
//    Out ở đúng script hash + datum hợp lệ nhưng value KHÔNG có beacon NFT.
// ════════════════════════════════════════════════════════════
test update_drop_beacon_nft() fail {
  let e_out = PlatformEntry { ..entry_in(), status: Paused }
  let out =
    util.mk_output(util.script_address(reg_sh), assets.from_lovelace(2_000_000), e_out)
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [out],
      assets.zero,
      [authority],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 5. TX CÓ MINT ≠ 0 (fail) — U-MINT-0 (update không đụng beacon supply).
// ════════════════════════════════════════════════════════════
test update_mint_rejected() fail {
  let e_out = PlatformEntry { ..entry_in(), status: Paused }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [reg_output(platform_id, e_out)],
      assets.add(assets.zero, beacon_policy, #"ffff", 1),
      [authority],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 6. 2 ENTRY INPUT CÙNG SCRIPT HASH (fail) — U-SINGLE (count_inputs_at_script == 1).
// ════════════════════════════════════════════════════════════
test update_double_entry() fail {
  let e_out = PlatformEntry { ..entry_in(), status: Paused }
  let in1 = reg_input(own_ref(), platform_id, entry_in())
  let in2 = reg_input(util.mk_ref(1), platform_id, entry_in())
  let tx =
    upd_tx([in1, in2], [reg_output(platform_id, e_out)], assets.zero, [authority])
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 7. MUTABLE INVALID (fail) — U-MUT (mutable_fields_valid): cut_bps > 10000 ở out.
//    Identity bất biến (giữ 5 field) để cô lập = U-MUT.
// ════════════════════════════════════════════════════════════
test update_mutable_invalid() fail {
  let e_out = PlatformEntry { ..entry_in(), cut_bps: 10001 }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [authority],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 8. ENTRY OUT Ở VÍ THƯỜNG (fail) — U-SINGLE/!is_vk.
//    Out mang beacon NFT + datum hợp lệ nhưng ở địa chỉ ví (VerificationKey).
//    count_outputs_at_script(reg_sh) == 0 → output_at_script fail (chống NFT lạc khỏi registry).
// ════════════════════════════════════════════════════════════
test update_out_not_script() fail {
  let e_out = PlatformEntry { ..entry_in(), status: Paused }
  let out = util.mk_output(util.vk_address(#"a0"), with_nft(platform_id), e_out)
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [out],
      assets.zero,
      [authority],
    )
  run(entry_in(), tx)
}

// ════════════════════════════════════════════════════════════
// 9. U-TERMINAL — Retired là trạng thái CUỐI (chống revive Retired→*).
// ════════════════════════════════════════════════════════════
// 9a. entry_in Retired → thử update (sang Active) FAIL — entry_in.status != Retired.
//     Mọi ràng buộc khác giữ hợp lệ để cô lập nguyên nhân = U-TERMINAL.
test update_retired_terminal() fail {
  let e_in = PlatformEntry { ..entry_in(), status: Retired }
  let e_out = PlatformEntry { ..entry_in(), status: Active }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, e_in)],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [authority],
    )
  run(e_in, tx)
}

// 9b. entry_in Active → out Retired PASS — đây là ĐƯỜNG retire hợp lệ
//     (entry_in chưa Retired nên qua U-TERMINAL; identity bất biến + NFT bảo toàn).
test update_active_to_retired() {
  let e_out = PlatformEntry { ..entry_in(), status: Retired }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, entry_in())],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [authority],
    )
  run(entry_in(), tx)
}

// 9c. entry_in Paused → out Active PASS — revive từ Paused vẫn cho phép
//     (chỉ Retired là cuối; Paused chưa terminal).
test update_paused_to_active() {
  let e_in = PlatformEntry { ..entry_in(), status: Paused }
  let e_out = PlatformEntry { ..entry_in(), status: Active }
  let tx =
    upd_tx(
      [reg_input(own_ref(), platform_id, e_in)],
      [reg_output(platform_id, e_out)],
      assets.zero,
      [authority],
    )
  run(e_in, tx)
}
