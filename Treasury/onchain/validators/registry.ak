// PlatformKit registry — spend validator: cập nhật một entry platform đã đăng ký.
// Entry UTxO mang beacon NFT (registry_beacon policy) + datum PlatformEntry, sống ở
// địa chỉ validator này. Discoverable qua beacon policy; mỗi entry độc lập (no contention).
//
// ÉP (UpdateEntry — authority-gated):
//   U-SIG     tx ký bởi registry_authority.
//   U-SINGLE  ĐÚNG 1 entry input + 1 entry output theo SCRIPT HASH (chống double-sat).
//   U-NFT     beacon NFT (beacon_policy, platform_id) bảo toàn ở in & out.
//   U-ID      identity bất biến: platform_id, instance_id, custody_hash, seed_policy, created_epoch.
//   U-MUT     field khả biến sau cập nhật vẫn hợp lệ (governance_ref, accepted, cut_bps).
//   U-MINT-0  KHÔNG mint/burn (update không đụng beacon supply).
// else fail — KHÔNG xóa entry (retire = status, không spend-burn).

use aiken/collection/list
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/platform.{PlatformEntry, Retired, RegistryRedeemer, UpdateEntry}
use magiclamp/treasury/util

/// registry parameterized bởi (registry_authority, beacon_policy).
/// beacon_policy = hash(registry_beacon(authority)) — chỉ phụ thuộc authority → không
/// vòng với registry hash. Dùng để ép beacon NFT bảo toàn.
validator registry(registry_authority: ByteArray, beacon_policy: assets.PolicyId) {
  spend(
    datum_opt : Option<PlatformEntry>,
    redeemer  : RegistryRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(entry_in) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // Chỉ một action (UpdateEntry).
    let UpdateEntry = redeemer

    // U-MINT-0: không mint/burn.
    expect assets.is_zero(tx.mint)

    // U-SIG: authority ký.
    expect list.has(tx.extra_signatories, registry_authority)

    // U-SINGLE: đúng 1 entry input + 1 output theo SCRIPT HASH.
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
    let reg_in = util.input_at_script(tx.inputs, own_hash)
    let reg_out = util.output_at_script(tx.outputs, own_hash)
    expect !util.is_vk(reg_out.address)

    expect InlineDatum(od) = reg_out.datum
    expect entry_out: PlatformEntry = od

    // U-TERMINAL: Retired là trạng thái CUỐI — không revive (audit: chống Retired→Active).
    expect entry_in.status != Retired

    // U-ID: identity bất biến.
    expect platform.identity_preserved(entry_in, entry_out)
    // U-MUT: field khả biến hợp lệ.
    expect platform.mutable_fields_valid(entry_out)

    // U-NFT: beacon NFT bảo toàn ở in & out (entry "thật" mang NFT).
    expect platform.has_one_nft(reg_in.value, beacon_policy, entry_in.platform_id)
    expect platform.has_one_nft(reg_out.value, beacon_policy, entry_out.platform_id)

    True
  }

  else(_) {
    fail
  }
}
