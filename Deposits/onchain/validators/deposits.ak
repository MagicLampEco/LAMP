// Deposits pot validator — bond HOÀN-LẠI chống rác (CONTRACT; SPEC §2).
// v1: 2 nhánh Deposit / Refund. v2 (anh chốt 2026-06-08): GIỮ mọi bất biến v1, THÊM
//   - Deposit ĐỘNG: amount ÉP khớp DepositParam beacon (reference input) theo phân
//     loại (asset_type, value_tier, lifecycle_class) — KHÔNG tin client mớm amount.
//   - Escheat: DID mồ côi quá escheat_after → value về Treasury → xóa dòng.
// Pot giữ value đa-asset; mỗi cọc là 1 dòng sổ trong datum (KHÔNG mỗi entity 1 UTxO).
// Refund/Escheat XÓA dòng → chống double.
//
// DEPOSIT ÉP (v2):
//   C-DEP-0  KHÔNG mint/burn (tx.mint == 0).
//   C-DEP-1  ĐÚNG 1 pot input + 1 pot output theo PAYMENT SCRIPT HASH (chống double-sat).
//   C-DEP-2  params bảo toàn (mọi field ngoài ledger+epoch); epoch không lùi; pot output ở Script.
//   C-DEP-3  asset ∈ accepted_assets.
//   C-DEP-4  depositor PHẢI ký (extra_signatories) — sổ trung thực.
//   C-DEP-7  **amount = required(beacon, asset_type, value_tier, lifecycle_class)** —
//            đọc DepositParam qua deposit_ref (reference input mang NFT xác thực),
//            valid_param(beacon), phân loại PHẢI có trong bảng (None → fail).
//            amount > 0 KHÔNG còn bắt buộc: cọc 0 hợp lệ (dưa leo). amount ≥ 0 + nếu
//            > 0 thì ghi dòng; nếu == 0 thì KHÔNG ghi dòng (không value, không sổ).
//   C-DEP-5  value: pot_out.value == pot_in.value ⊕ {asset: amount} (đẳng thức tuyệt đối).
//   C-DEP-6  sổ: dòng đích += amount (cộng dồn 1 dòng); dòng khác giữ nguyên; > 0; không dup.
//
// REFUND ÉP: như v1 (C-REF-0..7).
//
// ESCHEAT ÉP (v2):
//   C-ESC-0  KHÔNG mint/burn.
//   C-ESC-1  ĐÚNG 1 pot input + 1 pot output theo PAYMENT SCRIPT HASH.
//   C-ESC-2  params bảo toàn; epoch không lùi; pot output ở Script.
//   C-ESC-3  dòng đích PHẢI tồn tại; escheat_amount = số dư dòng (> 0).
//   C-ESC-4  current_epoch ≥ line.epoch + escheat_after_epoch (chưa tới hạn → fail).
//   C-ESC-5  value: pot_out.value == pot_in.value ⊖ {asset: escheat_amount}.
//   C-ESC-6  sổ: dòng đích XÓA; dòng khác giữ NGUYÊN (chống double + chống ăn dòng khác).
//   C-ESC-7  người nhận: Σ output value(asset) tới treasury_credential ≥ escheat_amount
//            (tiền ÉP về Treasury, KHÔNG về ví attacker).

use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/deposits/ledger
use magiclamp/deposits/schedule
use magiclamp/deposits/types.{
  Deposit, DepositParam, DepositsRedeemer, Escheat, PotDatum, Refund,
}
use magiclamp/deposits/util

validator deposits {
  spend(
    datum_opt : Option<PotDatum>,
    redeemer  : DepositsRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    when redeemer is {
      Deposit {
        entity_id,
        depositor,
        policy,
        name,
        asset_type,
        value_tier,
        lifecycle_class,
        deposit_ref,
      } -> {
        // C-DEP-0
        expect assets.is_zero(tx.mint)

        // LỖ test phòng thủ: sổ IN không có dòng trùng khóa (seed/state sạch). deposit_*
        // logic giả định khóa duy nhất; nếu ledger_in đã dup (do bug seed) thì find/cộng
        // dồn nhập nhằng. Rẻ (1 lượt), khóa invariant từ đầu nhánh.
        expect ledger.no_dup_lines(datum.ledger)

        // C-DEP-1: đúng 1 pot input + 1 pot output theo SCRIPT HASH.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let pot_in = util.input_at_script(tx.inputs, own_hash)
        let pot_out = util.output_at_script(tx.outputs, own_hash)

        // C-DEP-2: params bảo toàn, epoch không lùi, output ở Script.
        expect InlineDatum(od) = pot_out.datum
        expect out_datum: PotDatum = od
        expect params_preserved(datum, out_datum)
        expect out_datum.epoch >= datum.epoch
        expect !util.is_vk(pot_out.address)

        // C-DEP-3: asset accepted.
        expect ledger.asset_accepted(policy, name, datum.accepted_assets)

        // C-DEP-4: depositor PHẢI ký.
        expect util.signed_by(tx.extra_signatories, depositor)

        // F4+F5: bất biến PotDatum trước khi đọc đồng hồ (ms_per_epoch chia 0 / escheat âm).
        // LỖ-3: escheat_after_epoch > 0 (KHÔNG ==0) → cọc tồn ≥ 1 epoch trước khi escheat
        // được; ==0 cho phép escheat NGAY trong epoch gửi (cướp cọc vừa nạp).
        expect datum.ms_per_epoch > 0
        expect datum.escheat_after_epoch > 0

        // F1 + LỖ-1: epoch tx (đóng dấu dòng MỚI) — KẸP CỬA SỔ HẸP < 1 epoch (cả 2 cận
        // hữu hạn). Chống đặt lower_bound=0 quá khứ → dòng đóng dấu epoch giả → escheat sớm.
        let dep_epoch = util.get_deposit_epoch(tx, datum.ms_per_epoch)

        // C-DEP-7: ĐỌC DepositParam beacon qua reference input (NFT xác thực + F3 địa chỉ)
        // → ÉP amount. KHÔNG tin client mớm amount: amount LẤY TỪ beacon theo phân loại.
        let pp_data =
          util.read_beacon_datum(
            tx.reference_inputs,
            deposit_ref,
            datum.deposit_param_policy,
            datum.deposit_param_name,
            datum.deposit_param_script_hash,
          )
        expect pp: DepositParam = pp_data
        expect schedule.valid_param(pp)
        // LỖ-2: freshness beacon — beacon.epoch PHẢI ≥ min_param_epoch (chống bind bảng
        // phí CŨ khi DAO đã nâng: attacker tham chiếu beacon epoch thấp để cọc ít hơn lịch).
        expect pp.epoch >= datum.min_param_epoch
        // phân loại PHẢI có trong bảng (tier giả → None → fail; chống né phí).
        expect Some(amount) =
          schedule.required_for(pp, asset_type, value_tier, lifecycle_class)

        // C-DEP-5: value pot tăng đúng amount (asset khác giữ nguyên). amount=0 → value giữ.
        expect ledger.deposit_value_ok(pot_in.value, pot_out.value, policy, name, amount)

        // C-DEP-6: sổ. amount > 0 → ghi/cộng dồn dòng (kèm classification + epoch F1/F2).
        // amount == 0 → KHÔNG ghi dòng (cọc 0: không value, không sổ → sổ giữ NGUYÊN).
        if amount > 0 {
          ledger.deposit_ledger_ok(
            datum.ledger,
            out_datum.ledger,
            entity_id,
            depositor,
            policy,
            name,
            amount,
            dep_epoch,
            asset_type,
            value_tier,
            lifecycle_class,
          )
        } else {
          // cọc 0: sổ out == sổ in (không thêm dòng khống).
          out_datum.ledger == datum.ledger
        }
      }

      Refund { entity_id, depositor, policy, name } -> {
        // C-REF-0
        expect assets.is_zero(tx.mint)

        // C-REF-1
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let pot_in = util.input_at_script(tx.inputs, own_hash)
        let pot_out = util.output_at_script(tx.outputs, own_hash)

        // C-REF-2: params bảo toàn, epoch không lùi, output ở Script.
        expect InlineDatum(od) = pot_out.datum
        expect out_datum: PotDatum = od
        expect params_preserved(datum, out_datum)
        expect out_datum.epoch >= datum.epoch
        expect !util.is_vk(pot_out.address)

        // C-REF-3: dòng đích PHẢI tồn tại; refund_amount = số dư dòng (>0).
        expect Some(line) =
          ledger.find_line(datum.ledger, entity_id, depositor, policy, name)
        let refund_amount = line.amount
        expect refund_amount > 0

        // C-REF-4: authority — depositor ký HOẶC lifecycle_authority thỏa.
        let depositor_signed = util.signed_by(tx.extra_signatories, depositor)
        let authority_signed =
          util.authority_ok(
            datum.lifecycle_authority,
            tx.extra_signatories,
            tx.inputs,
            tx.reference_inputs,
          )
        expect depositor_signed || authority_signed

        // C-REF-6: sổ — dòng đích XÓA; dòng khác giữ nguyên.
        expect
          ledger.refund_ledger_ok(
            datum.ledger,
            out_datum.ledger,
            entity_id,
            depositor,
            policy,
            name,
          )

        // C-REF-5: value pot giảm đúng refund_amount.
        expect
          ledger.refund_value_ok(
            pot_in.value,
            pot_out.value,
            policy,
            name,
            refund_amount,
          )

        // C-REF-7: tiền về ĐÚNG depositor (creator-refund) — tổng-khớp tới VK(depositor).
        util.output_sum_to_pkh(tx.outputs, depositor, policy, name) >= refund_amount
      }

      Escheat { entity_id, depositor, policy, name } -> {
        // C-ESC-0
        expect assets.is_zero(tx.mint)

        // C-ESC-1
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let pot_in = util.input_at_script(tx.inputs, own_hash)
        let pot_out = util.output_at_script(tx.outputs, own_hash)

        // C-ESC-2: params bảo toàn, epoch không lùi, output ở Script.
        expect InlineDatum(od) = pot_out.datum
        expect out_datum: PotDatum = od
        expect params_preserved(datum, out_datum)
        expect out_datum.epoch >= datum.epoch
        expect !util.is_vk(pot_out.address)

        // C-ESC-3: dòng đích PHẢI tồn tại; escheat_amount = số dư dòng (>0).
        expect Some(line) =
          ledger.find_line(datum.ledger, entity_id, depositor, policy, name)
        let escheat_amount = line.amount
        expect escheat_amount > 0

        // F4+F5: bất biến PotDatum trước khi đọc đồng hồ (ms_per_epoch chia 0 / escheat âm).
        // LỖ-3: escheat_after_epoch > 0 (cọc tồn ≥ 1 epoch).
        expect datum.ms_per_epoch > 0
        expect datum.escheat_after_epoch > 0

        // C-ESC-4: ĐÃ tới hạn — current_epoch ≥ deposit_epoch + escheat_after.
        // current_epoch lấy từ validity_range (caller đặt); deposit_epoch = line.epoch.
        let current_epoch = util.get_epoch(tx, datum.ms_per_epoch)
        expect current_epoch >= line.epoch + datum.escheat_after_epoch

        // C-ESC-6: sổ — dòng đích XÓA; dòng khác giữ nguyên (tái dùng refund_ledger_ok).
        expect
          ledger.refund_ledger_ok(
            datum.ledger,
            out_datum.ledger,
            entity_id,
            depositor,
            policy,
            name,
          )

        // C-ESC-5: value pot giảm đúng escheat_amount.
        expect
          ledger.refund_value_ok(
            pot_in.value,
            pot_out.value,
            policy,
            name,
            escheat_amount,
          )

        // C-ESC-7: tiền ÉP về Treasury custody (KHÔNG về ví attacker).
        util.output_sum_to_credential(
          tx.outputs,
          datum.treasury_credential,
          policy,
          name,
        ) >= escheat_amount
      }
    }
  }

  else(_) {
    fail
  }
}

/// Mọi PARAM (mọi field ngoài ledger + epoch) bảo toàn qua tx. Gom 1 chỗ để 3 nhánh
/// dùng chung — thêm param mới chỉ sửa đây (tránh sót field, bài học audit).
fn params_preserved(d_in: PotDatum, d_out: PotDatum) -> Bool {
  and {
    d_out.instance_id == d_in.instance_id,
    d_out.accepted_assets == d_in.accepted_assets,
    d_out.lifecycle_authority == d_in.lifecycle_authority,
    d_out.reserved_min_ada == d_in.reserved_min_ada,
    d_out.deposit_param_policy == d_in.deposit_param_policy,
    d_out.deposit_param_name == d_in.deposit_param_name,
    d_out.deposit_param_script_hash == d_in.deposit_param_script_hash,
    d_out.treasury_credential == d_in.treasury_credential,
    d_out.escheat_after_epoch == d_in.escheat_after_epoch,
    d_out.ms_per_epoch == d_in.ms_per_epoch,
    d_out.min_param_epoch == d_in.min_param_epoch,
  }
}
