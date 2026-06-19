// PlatformKit registry_beacon — minting policy: đăng ký một Platform vào registry.
// Mỗi platform = 1 beacon NFT (name = platform_id) dưới policy CHUNG này → "tất cả
// platform" discoverable = tập UTxO mang token policy này.
//
// AUTHORITY-GATED (không permissionless): registry_authority (committee→DAO) PHẢI ký
// mỗi đăng ký → đảm bảo platform_id DUY NHẤT (authority không ký trùng) + kiểm duyệt
// onboarding (chống chiếm tên/rác). Phá vòng beacon↔registry bằng self-ref NFT.
//
// ÉP:
//   R-MINT-1  mint ĐÚNG 1 token policy này, qty +1 (name = platform_id).
//   R-SIG     tx ký bởi registry_authority.
//   R-OUT-1   ĐÚNG 1 output mang NFT đó (self-ref), Ở SCRIPT (registry validator) + datum.
//   R-WF      PlatformEntry well-formed (định danh khác rỗng, cut_bps∈[0,10000], Active).
//   R-NAME    entry.platform_id == NFT name.
// BURN — CẤM (else fail): beacon sống suốt vòng đời platform; retire = status trong datum.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Transaction}
use magiclamp/treasury/platform.{PlatformEntry, RegistryBeaconRedeemer}
use magiclamp/treasury/util

validator registry_beacon(registry_authority: ByteArray) {
  mint(_redeemer: RegistryBeaconRedeemer, policy_id: PolicyId, tx: Transaction) {
    // R-SIG: authority ký (kiểm duyệt + đảm bảo platform_id duy nhất).
    expect list.has(tx.extra_signatories, registry_authority)

    // R-MINT-1: mint đúng 1 token, qty 1.
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect [Pair(platform_id, qty)] = dict.to_pairs(own_tokens)
    expect qty == 1
    // R-MINT-2 (F5): tx đăng ký KHÔNG gánh mint policy NGOÀI (least-authority — beacon
    // không ngầm cho phép đồng-mint token lạ trong cùng tx).
    expect list.length(assets.policies(tx.mint)) == 1

    // R-OUT-1: đúng 1 output mang NFT đó (self-ref), ở Script (registry), + datum.
    expect util.count_outputs_with_token(tx.outputs, policy_id, platform_id) == 1
    let entry_out = util.output_with_token(tx.outputs, policy_id, platform_id)
    expect !util.is_vk(entry_out.address)

    expect InlineDatum(od) = entry_out.datum
    expect entry: PlatformEntry = od

    // R-NAME: datum khai báo đúng platform_id đã mint.
    expect entry.platform_id == platform_id

    // R-WF: entry well-formed.
    expect platform.entry_well_formed(entry)

    // R-BIND: entry PHẢI trỏ custody THẬT (chống entry "nói dối" trỏ custody giả —
    // audit #6). Reference input custody mang đúng 1 NFT authenticity (seed_policy,
    // instance_id) Ở ĐÚNG địa chỉ Script(custody_hash). Custody phải seed TRƯỚC khi
    // đăng ký (khớp onboard 2 bước: seed → register).
    expect Some(cust_ref) =
      list.find(
        tx.reference_inputs,
        fn(i) {
          assets.quantity_of(i.output.value, entry.seed_policy, entry.instance_id) == 1
        },
      )
    expect Script(custody_h) = cust_ref.output.address.payment_credential
    expect custody_h == entry.custody_hash

    True
  }

  else(_) {
    fail
  }
}
