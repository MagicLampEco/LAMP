// Custody validator — Treasury instance giữ value đa-asset + sổ bucket trong datum.
// v1: triển khai nhánh COLLECT (CONTRACT §3, §9 T2/T3; TECH §4) + RELEASE
// (CONTRACT §4, §9 T1/T5 — Model A; TECH §7).
//
// AUTHENTICITY (C-NFT, đợt hardening #5): custody "thật" của instance = UTxO MANG
//   đúng 1 NFT (seed_policy, instance_id) do custody_seed mint one-shot. Cả hai nhánh
//   ép NFT hiện diện ở cust_in VÀ cust_out → chống dựng custody-GIẢ tại địa chỉ script
//   (địa chỉ công khai) với datum bịa (vd cut_bps né, sổ bịa) để spend.
//
// Nhánh COLLECT ÉP:
//   C-MINT-0  KHÔNG mint/burn (LAMP fixed-supply — value chỉ chuyển trạng thái).
//   C-NFT     cust_in/out mang đúng 1 NFT (seed_policy, instance_id).
//   C-COL-1   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH.
//   C-COL-2   params instance (id, accepted, governance_ref, cut_bps) bảo toàn.
//   C-COL-3   Sổ: ledger_out == ledger_in + Σcut tại đúng (category, asset), CANONICAL.
//   C-COL-4   Value: custody_out.value == custody_in.value ⊕ cut_value(items) — Σout=Σin.
//   C-COL-5   Mọi item: amount ≥ 0 + asset ∈ accepted_assets.
//   C-EPOCH   out.epoch == get_epoch(tx) ∧ get_epoch(tx) ≥ in.epoch (neo chain, audit thật).
//
// Nhánh RELEASE ÉP (Model A — Treasury KHÔNG tự tính ngưỡng; đọc cờ Governance):
//   C-REL-10  KHÔNG mint/burn.
//   C-NFT     cust_in/out mang đúng 1 NFT (seed_policy, instance_id).
//   C-REL-4   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH.
//   C-REL-1   reference input tại proposal_ref Ở ĐÚNG governance_ref + mang ĐÚNG 1 Proposal NFT.
//   C-REL-2   ProposalResult.status == Executed.
//   C-REL-3   spend_spec_hash(draws) == proposal.spend_spec_hash (khóa đích chi).
//   C-REL-8   current_epoch ≥ proposal.execute_after_epoch (time-lock).
//   C-REL-5   Value: custody_out.value == custody_in.value ⊖ Σdraw — Σout=Σin per-asset.
//   C-REL-6   Sổ: ledger_out[(b,a)] == ledger_in[(b,a)] − Σdraw(b,a) ∧ draw ≤ số dư, CANONICAL.
//   C-REL-7   Người nhận: Σ output tới `to` ≥ Σ draw(to,asset) ∧ to ≠ custody.
//   C-REL-9   SINGLE-USE proposal (chống replay / chi vượt ngưỡng duyệt).
//   C-EPOCH   out.epoch == get_epoch(tx) ∧ get_epoch(tx) ≥ in.epoch.

use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/collect
use magiclamp/treasury/release
use magiclamp/treasury/types.{
  Collect, CustodyDatum, CustodyRedeemer, Executed, Release,
}
use magiclamp/treasury/util

/// Release validator parameterized bởi:
///   proposal_policy — PolicyId của Proposal authenticity NFT (Governance one-shot).
///   seed_policy     — PolicyId của custody authenticity NFT (custody_seed one-shot).
///   ms_per_epoch    — quy đổi POSIX ms → epoch (time-lock C-REL-8 + neo C-EPOCH).
validator custody(
  proposal_policy: assets.PolicyId,
  seed_policy: assets.PolicyId,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt : Option<CustodyDatum>,
    redeemer  : CustodyRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    when redeemer is {
      Collect { items } -> {
        // C-MINT-0: tuyệt đối không mint/burn.
        expect assets.is_zero(tx.mint)

        // C-COL-1: đúng 1 custody input + 1 custody output theo SCRIPT HASH.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

        let cust_in = util.input_at_script(tx.inputs, own_hash)
        let cust_out = util.output_at_script(tx.outputs, own_hash)

        // C-COL-2: datum params instance bảo toàn (chỉ ledger + epoch được đổi).
        expect InlineDatum(od) = cust_out.datum
        expect out_datum: CustodyDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.governance_ref == datum.governance_ref
        expect out_datum.cut_bps == datum.cut_bps
        // Collect KHÔNG đụng marker single-use proposal — bảo toàn nguyên.
        expect out_datum.consumed_proposals == datum.consumed_proposals

        // C-NFT: cust_in/out mang đúng 1 NFT authenticity (seed_policy, instance_id).
        // Chống custody-GIẢ (không NFT) dựng tại địa chỉ script với datum bịa.
        expect
          assets.quantity_of(cust_in.value, seed_policy, datum.instance_id) == 1
        expect
          assets.quantity_of(cust_out.value, seed_policy, out_datum.instance_id) == 1

        // C-EPOCH: neo epoch vào chain GỌN 1 epoch (audit thật, không lùi, không đóng băng).
        let cur = util.get_epoch_bounded(tx, ms_per_epoch)
        expect cur >= datum.epoch
        expect out_datum.epoch == cur

        // C-COL-2 (custody tách ví): output custody ở SCRIPT, không ví thường.
        expect !util.is_vk(cust_out.address)

        // C-COL-5: mọi item hợp lệ + asset được nhận.
        expect collect.all_items_valid(items, datum.accepted_assets)

        // C-COL-11 (F3): Collect PHẢI sinh cut > 0 (custody thực sự nhận value). Chống
        // griefing no-op: items rỗng / mọi cut=0 → respend miễn phí mỗi block gây
        // contention chặn settlement thật. Buộc mỗi Collect có ích (Σcut per-asset > 0).
        expect !assets.is_zero(collect.cut_value(items, datum.cut_bps))

        // C-COL-3: sổ tăng đúng Σcut tại (category, asset) — canonical, incremental.
        expect
          collect.ledger_ok(datum.ledger, out_datum.ledger, items, datum.cut_bps)

        // C-COL-4: value bảo toàn Σout=Σin per-asset, custody nhận đúng Σcut.
        expect collect.value_ok(cust_in.value, cust_out.value, items, datum.cut_bps)

        True
      }

      Release { proposal_ref, draws } -> {
        // C-REL-10: tuyệt đối không mint/burn (LAMP fixed-supply).
        expect assets.is_zero(tx.mint)

        // C-REL-4: đúng 1 custody input + 1 custody output theo SCRIPT HASH.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

        let cust_in = util.input_at_script(tx.inputs, own_hash)
        let cust_out = util.output_at_script(tx.outputs, own_hash)

        // Params instance bảo toàn (chỉ ledger + epoch + consumed được đổi) — mirror C-COL-2.
        expect InlineDatum(od) = cust_out.datum
        expect out_datum: CustodyDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.governance_ref == datum.governance_ref
        expect out_datum.cut_bps == datum.cut_bps
        // custody output ở SCRIPT, không ví thường.
        expect !util.is_vk(cust_out.address)

        // C-NFT: cust_in/out mang đúng 1 NFT authenticity (seed_policy, instance_id).
        expect
          assets.quantity_of(cust_in.value, seed_policy, datum.instance_id) == 1
        expect
          assets.quantity_of(cust_out.value, seed_policy, out_datum.instance_id) == 1

        // C-EPOCH: neo epoch vào chain GỌN 1 epoch (không lùi, không đóng băng).
        let cur = util.get_epoch_bounded(tx, ms_per_epoch)
        expect cur >= datum.epoch
        expect out_datum.epoch == cur

        // C-REL-13 (F2): draws KHÔNG rỗng — proposal rỗng chỉ nhồi consumed_proposals
        // (phình datum → kẹt) mà không chi gì. Một Release phải chi thật.
        expect draws != []

        // C-REL-1: đọc + xác thực ProposalResult — proposal Ở ĐÚNG governance_ref +
        // mang đúng Proposal NFT (chống NFT dời sang datum giả / replay chéo instance).
        let proposal =
          release.read_proposal(
            tx.reference_inputs,
            proposal_ref,
            proposal_policy,
            datum.governance_ref,
          )

        // C-REL-2: CHỈ chi khi status == Executed.
        expect proposal.status == Executed

        // C-REL-3: hash canonical (instance_id, draws) thực tế == spend_spec_hash đã duyệt.
        // F10/#1B: gồm instance_id → proposal của instance A KHÔNG dùng được cho instance B
        // dù CÙNG governance_ref (spec_hash khác instance ⇒ không khớp).
        expect
          release.spend_spec_hash(datum.instance_id, draws) == proposal.spend_spec_hash

        // C-REL-8: time-lock — epoch hiện tại ≥ execute_after_epoch.
        expect cur >= proposal.execute_after_epoch

        // C-REL-9: SINGLE-USE proposal (chống replay). proposal_id CHƯA chi + append đúng.
        expect
          release.proposal_is_fresh(datum.consumed_proposals, proposal.proposal_id)
        expect
          release.consumed_appended_ok(
            datum.consumed_proposals,
            out_datum.consumed_proposals,
            proposal.proposal_id,
          )

        // C-REL-6: sổ giảm đúng bucket + draw ≤ số dư, canonical (prune dòng cạn 0).
        expect release.ledger_ok(datum.ledger, out_datum.ledger, draws)

        // C-REL-5: value bảo toàn Σout=Σin per-asset, custody RA đúng Σdraw (no drain).
        expect release.value_ok(cust_in.value, cust_out.value, draws)

        // C-REL-7: người nhận đúng — tổng-khớp per (to,asset), to ≠ custody.
        expect release.recipients_ok(tx.outputs, draws, own_hash)

        True
      }

      // v1 triển khai Collect + Release; Rebalance/MigrateIn thêm ở v1.x.
      _ -> fail
    }
  }

  else(_) {
    fail
  }
}
