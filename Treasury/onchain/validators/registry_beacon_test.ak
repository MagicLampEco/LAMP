// Validator tests cho registry_beacon (minting policy — đăng ký Platform vào registry).
// Phủ: đăng ký đúng (pass); thiếu chữ ký authority (fail); mint qty 2 (fail);
//      mint 2 asset name (fail); output mang NFT ở ví thường (fail);
//      entry.platform_id ≠ NFT name (fail); entry KHÔNG well-formed các kiểu (fail);
//      burn (mint âm) bị else/qty chặn (fail).
//
// Phong cách mirror custody_seed_test.ak: mint test + self-ref NFT, placeholder tx,
// authority vkh đặt trong extra_signatories.

use cardano/assets
use cardano/transaction.{Input, Output, Transaction, placeholder}
use magiclamp/treasury/platform.{Active, Paused, PlatformEntry, RegisterPlatform}
use registry_beacon
use magiclamp/treasury/types.{AssetKey}
use magiclamp/treasury/util

// ── Hằng số test ──
const beacon_policy: assets.PolicyId = #"b3ac"

// registry_authority (committee→DAO) — vkh ký mỗi đăng ký.
const authority: ByteArray = #"a07a01"

// script hash registry validator (entry UTxO sống ở đây).
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

// Entry well-formed mặc định (happy): platform_id == NFT name, mọi định danh khác rỗng,
// cut_bps∈[0,10000], accepted khác [], status Active.
fn entry() -> PlatformEntry {
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

// Mint beacon NFT name=name, qty.
fn beacon_mint(name: ByteArray, qty: Int) -> assets.Value {
  assets.add(assets.zero, beacon_policy, name, qty)
}

// Value entry mang beacon NFT (beacon_policy, name) qty 1 + min-ADA.
fn with_nft(name: ByteArray) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(beacon_policy, name, 1)
}

// Output entry ở SCRIPT (registry validator) mang NFT name + datum.
fn entry_output(name: ByteArray, e: PlatformEntry) -> Output {
  util.mk_output(util.script_address(reg_sh), with_nft(name), e)
}

// Reference input custody (R-BIND): UTxO ở Script(sh) mang authenticity NFT
// (sp, iid) qty 1. Custody phải seed TRƯỚC đăng ký (onboard 2 bước).
fn custody_ref(sh: ByteArray, sp: ByteArray, iid: ByteArray) -> Input {
  let value = assets.from_lovelace(2_000_000) |> assets.add(sp, iid, 1)
  util.mk_input(util.mk_ref(9), util.mk_output_no_datum(util.script_address(sh), value))
}

// Reference custody hợp lệ cho entry mặc định: Script(custody_hash) mang (seed_policy, instance_id).
fn custody_ref_ok() -> Input {
  custody_ref(custody_hash, seed_policy, instance_id)
}

// Dựng tx đăng ký: mint NFT, outputs, reference custody, ký authority (extra_signatories).
fn reg_tx(
  mint    : assets.Value,
  outputs : List<Output>,
  refs    : List<Input>,
  signers : List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    outputs: outputs,
    reference_inputs: refs,
    mint: mint,
    extra_signatories: signers,
  }
}

fn run(tx: Transaction) -> Bool {
  registry_beacon.registry_beacon.mint(authority, RegisterPlatform, beacon_policy, tx)
}

// ════════════════════════════════════════════════════════════
// 1. ĐĂNG KÝ ĐÚNG (pass) — authority ký, mint 1 NFT name=platform_id,
//    1 output ở Script mang NFT + datum well-formed (platform_id==name).
// ════════════════════════════════════════════════════════════
test register_happy() {
  let tx =
    reg_tx(
      beacon_mint(platform_id, 1),
      [entry_output(platform_id, entry())],
      [custody_ref_ok()],
      [authority],
    )
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 2. THIẾU CHỮ KÝ AUTHORITY (fail) — extra_signatories không có vkh authority (R-SIG).
//    Fail SỚM hơn R-BIND → không cần reference custody.
// ════════════════════════════════════════════════════════════
test register_no_authority_sig() fail {
  let tx =
    reg_tx(
      beacon_mint(platform_id, 1),
      [entry_output(platform_id, entry())],
      [],
      [#"deadbeef"],
    )
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 3. MINT QTY 2 (fail) — supply phải 1 (R-MINT-1).
// ════════════════════════════════════════════════════════════
test register_mint_two() fail {
  // output mang đủ 2 NFT để qua R-OUT-1 (count==1) → cô lập nguyên nhân = qty.
  let value = assets.from_lovelace(2_000_000) |> assets.add(beacon_policy, platform_id, 2)
  let out = util.mk_output(util.script_address(reg_sh), value, entry())
  let tx = reg_tx(beacon_mint(platform_id, 2), [out], [], [authority])
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 4. MINT 2 ASSET NAME CÙNG POLICY (fail) — dict.size > 1 (R-MINT-1).
// ════════════════════════════════════════════════════════════
test register_mint_two_names() fail {
  let mint = beacon_mint(platform_id, 1) |> assets.add(beacon_policy, #"ffff", 1)
  let tx = reg_tx(mint, [entry_output(platform_id, entry())], [], [authority])
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 5. OUTPUT MANG NFT Ở VÍ THƯỜNG (fail) — entry không ở Script (R-OUT-1, !is_vk).
// ════════════════════════════════════════════════════════════
test register_output_not_script() fail {
  let wallet_out =
    util.mk_output(util.vk_address(#"a0"), with_nft(platform_id), entry())
  let tx = reg_tx(beacon_mint(platform_id, 1), [wallet_out], [], [authority])
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 6. NFT NAME ≠ entry.platform_id (fail) — R-NAME.
//    Mint name=#"ffff" (output mang đúng nó qua R-OUT-1) nhưng datum.platform_id=#"706b".
// ════════════════════════════════════════════════════════════
test register_name_mismatch() fail {
  // output mang NFT name=#"ffff" (khớp mint → R-OUT-1 pass), datum vẫn platform_id thật.
  let tx =
    reg_tx(
      beacon_mint(#"ffff", 1),
      [entry_output(#"ffff", entry())],
      [],
      [authority],
    )
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 7. ENTRY KHÔNG WELL-FORMED (fail) — R-WF, từng field vi phạm.
//    Mỗi ca giữ platform_id == NFT name (qua R-NAME) để cô lập nguyên nhân = R-WF.
// ════════════════════════════════════════════════════════════
// 7a. instance_id rỗng.
test register_not_wellformed_instance_empty() fail {
  let e = PlatformEntry { ..entry(), instance_id: #"" }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7b. custody_hash rỗng.
test register_not_wellformed_custody_empty() fail {
  let e = PlatformEntry { ..entry(), custody_hash: #"" }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7c. seed_policy rỗng.
test register_not_wellformed_seed_empty() fail {
  let e = PlatformEntry { ..entry(), seed_policy: #"" }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7d. governance_ref rỗng.
test register_not_wellformed_gov_empty() fail {
  let e = PlatformEntry { ..entry(), governance_ref: #"" }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7e. accepted_assets rỗng.
test register_not_wellformed_accepted_empty() fail {
  let e = PlatformEntry { ..entry(), accepted_assets: [] }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7f. cut_bps âm.
test register_not_wellformed_cut_negative() fail {
  let e = PlatformEntry { ..entry(), cut_bps: -1 }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7g. cut_bps > 10000.
test register_not_wellformed_cut_over() fail {
  let e = PlatformEntry { ..entry(), cut_bps: 10001 }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// 7h. status ≠ Active (Paused) — entry_well_formed ép status == Active.
test register_not_wellformed_status_paused() fail {
  let e = PlatformEntry { ..entry(), status: Paused }
  let tx = reg_tx(beacon_mint(platform_id, 1), [entry_output(platform_id, e)], [], [authority])
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 8. BURN (fail) — mint âm (qty -1) bị else/qty chặn (beacon sống suốt vòng đời).
//    qty == 1 fail trong nhánh mint; burn-only redeemer cũng rơi else fail.
// ════════════════════════════════════════════════════════════
test register_burn_rejected() fail {
  // output mang NFT qty 1 để qua R-OUT-1 → cô lập nguyên nhân = qty == -1.
  let tx =
    reg_tx(
      beacon_mint(platform_id, -1),
      [entry_output(platform_id, entry())],
      [],
      [authority],
    )
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 9. R-BIND — entry phải trỏ custody THẬT (reference input custody mang đúng
//    1 NFT authenticity (seed_policy, instance_id) ở Script(custody_hash)).
// ════════════════════════════════════════════════════════════
// 9a. KHÔNG có reference custody (fail) — đủ authority/mint/well-formed nhưng
//     reference_inputs rỗng → list.find không thấy → R-BIND fail.
test register_no_custody_ref() fail {
  let tx =
    reg_tx(
      beacon_mint(platform_id, 1),
      [entry_output(platform_id, entry())],
      [],
      [authority],
    )
  run(tx)
}

// 9b. Custody mang đúng NFT nhưng SAI script hash (fail) — Script ≠ entry.custody_hash
//     → custody_h == entry.custody_hash fail.
test register_custody_wrong_hash() fail {
  let bad = custody_ref(#"deadc0de", seed_policy, instance_id)
  let tx =
    reg_tx(
      beacon_mint(platform_id, 1),
      [entry_output(platform_id, entry())],
      [bad],
      [authority],
    )
  run(tx)
}

// 9c. Custody ở đúng hash nhưng value KHÔNG mang (seed_policy, instance_id) NFT (fail)
//     → list.find không thấy input nào quantity_of == 1 → R-BIND fail.
test register_custody_missing_nft() fail {
  // NFT khác policy/name (không khớp seed_policy/instance_id của entry).
  let no_auth =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output_no_datum(
        util.script_address(custody_hash),
        assets.from_lovelace(2_000_000) |> assets.add(#"beef", #"00", 1),
      ),
    )
  let tx =
    reg_tx(
      beacon_mint(platform_id, 1),
      [entry_output(platform_id, entry())],
      [no_auth],
      [authority],
    )
  run(tx)
}

// ════════════════════════════════════════════════════════════
// 10. MINT POLICY LẠ KÈM ĐĂNG KÝ (fail) — [F5 R-MINT-2] least-authority.
//   tx mint beacon NFT (đúng) + token policy NGOÀI (#"f0f0") trong CÙNG tx →
//   policies(tx.mint) = 2 ≠ 1 → R-MINT-2 chặn. Đăng ký beacon KHÔNG ngầm cho phép
//   đồng-mint token lạ (chống beacon "gánh" mint policy khác để né kiểm soát supply).
//   authority ký + mint beacon đúng + custody_ref đủ → cô lập F5.
// ════════════════════════════════════════════════════════════
test register_mint_foreign_policy() fail {
  // mint = beacon NFT (1 policy) + token policy lạ #"f0f0" (policy thứ 2) → length==2.
  let mint = beacon_mint(platform_id, 1) |> assets.add(#"f0f0", #"00", 1)
  let tx =
    reg_tx(
      mint,
      [entry_output(platform_id, entry())],
      [custody_ref_ok()],
      [authority],
    )
  run(tx)
}
