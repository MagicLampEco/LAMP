// Deposits pot validator — bond HOÀN-LẠI chống rác (CONTRACT; SPEC §2).
// v1: 2 nhánh Deposit / Refund. Pot giữ value đa-asset; mỗi cọc là 1 dòng sổ trong
// datum (KHÔNG mỗi entity 1 UTxO). Refund XÓA dòng → chống double-refund.
//
// DEPOSIT ÉP:
//   C-DEP-0  KHÔNG mint/burn (tx.mint == 0).
//   C-DEP-1  ĐÚNG 1 pot input + 1 pot output theo PAYMENT SCRIPT HASH (chống double-sat).
//   C-DEP-2  params bảo toàn (instance_id, accepted_assets, lifecycle_authority,
//            reserved_min_ada); epoch không lùi; pot output ở Script (!is_vk).
//   C-DEP-3  amount > 0 ∧ asset ∈ accepted_assets.
//   C-DEP-4  depositor PHẢI ký (extra_signatories) — sổ trung thực.
//   C-DEP-5  value: pot_out.value == pot_in.value ⊕ {asset: amount} (đẳng thức tuyệt đối).
//   C-DEP-6  sổ: dòng đích += amount (cộng dồn 1 dòng); dòng khác giữ nguyên; > 0; không dup.
//
// REFUND ÉP:
//   C-REF-0  KHÔNG mint/burn.
//   C-REF-1  ĐÚNG 1 pot input + 1 pot output theo PAYMENT SCRIPT HASH.
//   C-REF-2  params bảo toàn; epoch không lùi; pot output ở Script.
//   C-REF-3  dòng đích (entity,depositor,asset) PHẢI tồn tại in; refund_amount = số dư (>0).
//   C-REF-4  authority: depositor ký HOẶC lifecycle_authority thỏa (VK ký / Script chứng kiến).
//   C-REF-5  value: pot_out.value == pot_in.value ⊖ {asset: refund_amount} (đẳng thức tuyệt đối).
//   C-REF-6  sổ: dòng đích bị XÓA; dòng khác giữ NGUYÊN; > 0; không dup (chống double-refund).
//   C-REF-7  người nhận: Σ output value(asset) tới depositor ≥ refund_amount ∧ depositor ≠ pot.

use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/deposits/ledger
use magiclamp/deposits/types.{Deposit, PotDatum, DepositsRedeemer, Refund}
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
      Deposit { entity_id, depositor, policy, name, amount } -> {
        // C-DEP-0
        expect assets.is_zero(tx.mint)

        // C-DEP-1: đúng 1 pot input + 1 pot output theo SCRIPT HASH.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let pot_in = util.input_at_script(tx.inputs, own_hash)
        let pot_out = util.output_at_script(tx.outputs, own_hash)

        // C-DEP-2: params bảo toàn, epoch không lùi, output ở Script.
        expect InlineDatum(od) = pot_out.datum
        expect out_datum: PotDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.lifecycle_authority == datum.lifecycle_authority
        expect out_datum.reserved_min_ada == datum.reserved_min_ada
        expect out_datum.epoch >= datum.epoch
        expect !util.is_vk(pot_out.address)

        // C-DEP-3: amount > 0 + asset accepted.
        expect amount > 0
        expect ledger.asset_accepted(policy, name, datum.accepted_assets)

        // C-DEP-4: depositor PHẢI ký.
        expect util.signed_by(tx.extra_signatories, depositor)

        // C-DEP-6: sổ — dòng đích += amount; dòng khác giữ nguyên.
        expect
          ledger.deposit_ledger_ok(
            datum.ledger,
            out_datum.ledger,
            entity_id,
            depositor,
            policy,
            name,
            amount,
          )

        // C-DEP-5: value pot tăng đúng amount (asset khác giữ nguyên).
        expect ledger.deposit_value_ok(pot_in.value, pot_out.value, policy, name, amount)

        True
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
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.lifecycle_authority == datum.lifecycle_authority
        expect out_datum.reserved_min_ada == datum.reserved_min_ada
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

        // C-REF-7: tiền về ĐÚNG depositor ∧ depositor ≠ pot (tiền thật rời pot).
        // depositor là pkh ví thường (VerificationKey). pot ở Script hash own_hash —
        // depositor pkh không thể trùng script hash chính nó về ngữ nghĩa, nhưng ép
        // tổng-khớp tới VerificationKey(depositor): Σ out tới pkh depositor ≥ refund_amount.
        expect
          util.output_sum_to_pkh(tx.outputs, depositor, policy, name) >= refund_amount

        True
      }
    }
  }

  else(_) {
    fail
  }
}
