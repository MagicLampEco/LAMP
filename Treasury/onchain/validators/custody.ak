// Custody validator — Treasury instance giữ value đa-asset + sổ bucket trong datum.
// v1: triển khai nhánh COLLECT (CONTRACT §3, §9 T2/T3; TECH §4) + RELEASE
// (CONTRACT §4, §9 T1/T5 — Model A; TECH §7).
//
// Nhánh COLLECT ÉP:
//   C-MINT-0  KHÔNG mint/burn (LAMP fixed-supply — value chỉ chuyển trạng thái).
//   C-COL-1   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH
//             (chống double-satisfaction qua stake cred — bài học C1/C2 Distribution).
//   C-COL-2   Custody address TÁCH ví: không output custody nào trùng địa chỉ ví thường,
//             và params instance (id, accepted, governance_ref, cut_bps) bảo toàn.
//   C-COL-3   Sổ: ledger_out == ledger_in + Σcut tại đúng (category, asset) — đơn-bucket.
//   C-COL-4   Value: custody_out.value == custody_in.value ⊕ cut_value(items) — Σout=Σin
//             per-asset (KHÔNG drain ADA/token; KHÔNG burn).
//   C-COL-5   Mọi item: amount ≥ 0 + asset ∈ accepted_assets; epoch không lùi.
//
// Nhánh RELEASE ÉP (Model A — Treasury KHÔNG tự tính ngưỡng; đọc cờ Governance):
//   C-REL-10  KHÔNG mint/burn.
//   C-REL-4   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH.
//   C-REL-1   reference input tại proposal_ref mang ĐÚNG 1 Proposal NFT (one-shot).
//   C-REL-2   ProposalResult.status == Executed (CHỈ Executed — Governance đã ép ngưỡng).
//   C-REL-3   spend_spec_hash(draws) == proposal.spend_spec_hash (khóa đích chi ai/bao nhiêu).
//   C-REL-8   current_epoch ≥ proposal.execute_after_epoch (time-lock; epoch từ validity_range).
//   C-REL-5   Value: custody_out.value == custody_in.value ⊖ Σdraw — Σout=Σin per-asset.
//   C-REL-6   Sổ: ledger_out[(b,a)] == ledger_in[(b,a)] − Σdraw(b,a) ∧ draw ≤ số dư bucket.
//   C-REL-7   Người nhận: Σ output tới `to` ≥ Σ draw(to,asset) ∧ to ≠ custody (tổng-khớp).
//   C-REL-9   SINGLE-USE proposal: proposal_id ∉ consumed_proposals_in ∧ out append đúng id
//             (chống replay / chi vượt ngưỡng duyệt — két KHÓA tổng, không chỉ số dư bucket).
//   (params instance + consumed_proposals bảo toàn ở Collect; epoch sổ không lùi.)

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
///   ms_per_epoch    — quy đổi POSIX ms → epoch (time-lock C-REL-8; mirror Distribution).
validator custody(proposal_policy: assets.PolicyId, ms_per_epoch: Int) {
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
        // epoch không lùi (chống replay sổ).
        expect out_datum.epoch >= datum.epoch
        // Collect KHÔNG đụng marker single-use proposal — bảo toàn nguyên (chỉ Release ghi).
        expect out_datum.consumed_proposals == datum.consumed_proposals

        // C-COL-2 (custody tách ví): output custody phải ở SCRIPT, không phải ví thường.
        // (cust_out đã chọn theo script hash → payment_credential là Script; khẳng định lại
        //  để rõ ý đồ + chặn nếu refactor đổi cách chọn.)
        expect !util.is_vk(cust_out.address)

        // C-COL-5: mọi item hợp lệ + asset được nhận.
        expect collect.all_items_valid(items, datum.accepted_assets)

        // C-COL-3: sổ tăng đúng Σcut tại (category, asset) — đơn-bucket, incremental.
        expect
          collect.ledger_ok(datum.ledger, out_datum.ledger, items, datum.cut_bps)

        // C-COL-4: value bảo toàn Σout=Σin per-asset, custody nhận đúng Σcut.
        expect collect.value_ok(cust_in.value, cust_out.value, items, datum.cut_bps)

        True
      }

      Release { proposal_ref, draws } -> {
        // C-REL-10: tuyệt đối không mint/burn (LAMP fixed-supply — release không tạo/đốt).
        expect assets.is_zero(tx.mint)

        // C-REL-4: đúng 1 custody input + 1 custody output theo SCRIPT HASH (chống double-sat).
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

        let cust_in = util.input_at_script(tx.inputs, own_hash)
        let cust_out = util.output_at_script(tx.outputs, own_hash)

        // Params instance bảo toàn (chỉ ledger + epoch được đổi) — mirror C-COL-2.
        expect InlineDatum(od) = cust_out.datum
        expect out_datum: CustodyDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.governance_ref == datum.governance_ref
        expect out_datum.cut_bps == datum.cut_bps
        expect out_datum.epoch >= datum.epoch
        // custody output ở SCRIPT, không ví thường.
        expect !util.is_vk(cust_out.address)

        // C-REL-1: đọc + xác thực ProposalResult qua reference input mang Proposal NFT.
        let proposal =
          release.read_proposal(tx.reference_inputs, proposal_ref, proposal_policy)

        // C-REL-2: CHỈ chi khi status == Executed (Governance đã ép ngưỡng + Tallied→Executed).
        expect proposal.status == Executed

        // C-REL-3: hash canonical draws thực tế == spend_spec_hash đã duyệt (khóa đích chi).
        expect release.spend_spec_hash(draws) == proposal.spend_spec_hash

        // C-REL-8: time-lock — epoch hiện tại (từ validity_range) ≥ execute_after_epoch.
        let current_epoch = util.get_epoch(tx, ms_per_epoch)
        expect current_epoch >= proposal.execute_after_epoch

        // C-REL-9: SINGLE-USE proposal (chống replay / chi vượt ngưỡng duyệt — HARD BLOCKER
        // finding 7). proposal_id CHƯA chi (∉ consumed_proposals_in) + out append đúng id.
        // v1 KHÔNG vesting: spec_hash khóa Σdraws cố định ⇒ một Release dùng hết proposal.
        expect
          release.proposal_is_fresh(datum.consumed_proposals, proposal.proposal_id)
        expect
          release.consumed_appended_ok(
            datum.consumed_proposals,
            out_datum.consumed_proposals,
            proposal.proposal_id,
          )

        // C-REL-6: sổ giảm đúng bucket + draw ≤ số dư bucket (incremental, không over-draw).
        expect release.ledger_ok(datum.ledger, out_datum.ledger, draws)

        // C-REL-5: value bảo toàn Σout=Σin per-asset, custody RA đúng Σdraw (no drain).
        expect release.value_ok(cust_in.value, cust_out.value, draws)

        // C-REL-7: người nhận đúng — tổng-khớp per (to,asset), to ≠ custody (chống double-sat).
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
