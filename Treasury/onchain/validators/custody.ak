// Custody validator — Treasury instance giữ value đa-asset + sổ bucket trong datum.
// v1: triển khai nhánh COLLECT (CONTRACT §3, §9 T2/T3; TECH §4).
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

use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/collect
use magiclamp/treasury/types.{Collect, CustodyDatum, CustodyRedeemer}
use magiclamp/treasury/util

validator custody {
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

      // v1 chỉ triển khai Collect; các nhánh khác sẽ thêm ở v1.x (Release/Rebalance/Migrate).
      _ -> fail
    }
  }

  else(_) {
    fail
  }
}
