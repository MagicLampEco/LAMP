// governance_pointer — NFT con trỏ governance cho kho custody (Treasury/GovernancePointer.md v0.1).
//
// VÌ SAO CÓ: custody từng nướng hash governance vào datum + tham số; governance phải dựng lại
// (bật C2/C4, đổi engage_policies, đổi tally) thì nhánh Release của custody chết vĩnh viễn.
// Nay `CustodyDatum.governance_ref` = policy id của NFT con trỏ; custody đọc
// `PointerDatum.governance_hash` qua reference input (`pointer.read_governance`).
//
// MỘT VALIDATOR, HAI MỤC ĐÍCH (`mint` + `spend`) ⇒ policy id NFT == script hash validator.
//   • Phá vòng hash: custody chỉ cần biết policy (đã có trong datum), không cần tham số "hash
//     script con trỏ" riêng. `governance_pointer` không phụ thuộc custody ⇒ không vòng.
//   • Nhánh `spend` lấy `pointer_policy` từ CHÍNH địa chỉ input (own hash) — không phải một
//     tham số người deploy có thể đặt sai.
// Tham số: `seed` (oref hạt giống one-shot), `change_delay_ms` (trễ đổi con trỏ qua committee).
//
// LUẬT ĐÚC (P-MINT-*):
//   P-MINT-SEED   tiêu đúng hạt giống `seed` ⇒ đúc được đúng một lần trong đời policy.
//   P-MINT-ONLY   tx.mint chỉ chứa policy này, đúng {GOVPOINTER: 1} (không đốt, không tên khác).
//   P-MINT-OUT    đúng 1 output mang NFT, ở `Script(policy)`, value = ADA + đúng NFT, không
//                 đính script tham chiếu, datum inline `PointerDatum`.
//   P-MINT-DATUM  governance_hash rỗng hoặc 28 byte; committee hợp lệ
//                 (`pointer.committee_wellformed`); sealed == False; pending == None.
//   P-MINT-DELAY  change_delay_ms > 0 (trễ 0 = committee đổi tức thì, mất ý nghĩa trễ).
//
// LUẬT CHI (P-SPEND-*, mọi nhánh):
//   P-NFT-IN      input đang chi mang NFT con trỏ (UTxO rác ở địa chỉ này không chi được).
//   P-ONE         đúng 1 input + 1 output tại script này (chống double-satisfaction).
//   P-ADDR        output về CHÍNH địa chỉ input, kể cả stake credential.
//   P-VALUE       output value = ADA + đúng NFT con trỏ (không nhồi token rác).
//   P-REFSCRIPT   output không đính script tham chiếu.
//   P-NOMINT      tx.mint == 0 (không đúc, không đốt — kể cả NFT con trỏ).
//   P-DATUM       datum ra inline, == datum vào với ĐÚNG các trường nhánh được đổi.
// Nhánh:
//   CommitteePropose(new_hash)  chưa niêm phong ∧ committee duyệt ∧ |new_hash| = 28 ⇒
//                               pending = Some{new_hash, upper_bound + change_delay_ms}.
//   ApplyPending                ai cũng gọi ∧ pending = Some(p) ∧ lower_bound ≥ p.effective ⇒
//                               governance_hash = p.new_hash, pending = None.
//   CommitteeCancel             chưa niêm phong ∧ committee duyệt ∧ pending = Some ⇒ pending = None.
//   Seal                        chưa niêm phong ∧ committee duyệt ∧ |governance_hash| = 28 ∧
//                               pending = None ⇒ sealed = True (một chiều).
//   GovernanceSet(new_hash, r)  |governance_hash| = 28 ∧ |new_hash| = 28 ∧ proposal tại r:
//                               ở Script(g), đúng 1 token policy g tên == proposal_id,
//                               status == Executed, spend_spec_hash ==
//                               blake2b_256(0x04 ‖ pointer_policy ‖ new_hash) ⇒
//                               governance_hash = new_hash, pending = None. Chạy cả khi đã niêm phong.
//
// ⚠ LỆCH CÓ CHỦ Ý SO VỚI SPEC v0.1 (bản chặt hơn, ghi để spec cập nhật):
//   • `CommitteePropose` tính hạn từ CẬN TRÊN validity range, không từ cận dưới. Cận dưới do
//     người dựng tx tự chọn và được phép nằm tuỳ ý trong QUÁ KHỨ (ledger chỉ đòi cận dưới ≤
//     giờ thật). Lấy cận dưới thì một committee bị chiếm đặt cận dưới = 0 ⇒ hạn = change_delay_ms
//     (năm 1970) ⇒ `ApplyPending` ngay lượt sau — trễ bị vô hiệu. Cận trên ≥ giờ thật (ledger
//     đòi giờ thật < cận trên) ⇒ hạn ≥ giờ thật + change_delay_ms, đúng lời hứa của trễ.
//   • `GovernanceSet` mang thêm `proposal_ref` (spec ghi `GovernanceSet(new_hash)`) — để tra
//     proposal tất định như `release.read_proposal`, không quét mọi reference input.
//   • `CommitteeCancel` đòi pending đang có (không cho lượt no-op).

use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{IntervalBound}
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/pointer
use magiclamp/treasury/release
use magiclamp/treasury/types.{
  ApplyPending, CommitteeCancel, CommitteePropose, Executed, GovernanceSet, Pending,
  PointerDatum, PointerRedeemer, Seal,
}
use magiclamp/treasury/util

validator governance_pointer(seed: OutputReference, change_delay_ms: Int) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    // P-MINT-DELAY
    expect change_delay_ms > 0
    // P-MINT-SEED
    expect list.any(tx.inputs, fn(i) { i.output_reference == seed })
    // P-MINT-ONLY
    expect assets.policies(tx.mint) == [policy_id]
    expect
      dict.to_pairs(assets.tokens(tx.mint, policy_id)) == [
        Pair(pointer.pointer_name, 1),
      ]
    // P-MINT-OUT
    expect
      util.count_outputs_with_token(tx.outputs, policy_id, pointer.pointer_name) == 1
    let out = util.output_with_token(tx.outputs, policy_id, pointer.pointer_name)
    expect Script(h) = out.address.payment_credential
    expect h == policy_id
    expect
      assets.without_lovelace(out.value) == assets.from_asset(
        policy_id,
        pointer.pointer_name,
        1,
      )
    expect out.reference_script == None
    // P-MINT-DATUM
    expect InlineDatum(d) = out.datum
    expect pd: PointerDatum = d
    let gl = bytearray.length(pd.governance_hash)
    expect gl == 0 || gl == 28
    expect pointer.committee_wellformed(pd.committee, pd.threshold)
    expect !pd.sealed
    expect pd.pending == None
    True
  }

  spend(
    datum_opt : Option<PointerDatum>,
    redeemer  : PointerRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(d_in) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)
    expect Some(own_in) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })

    // P-NFT-IN
    expect
      assets.quantity_of(own_in.output.value, own_hash, pointer.pointer_name) == 1
    // P-ONE
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
    let out = util.output_at_script(tx.outputs, own_hash)
    // P-ADDR
    expect out.address == own_addr
    // P-VALUE
    expect
      assets.without_lovelace(out.value) == assets.from_asset(
        own_hash,
        pointer.pointer_name,
        1,
      )
    // P-REFSCRIPT
    expect out.reference_script == None
    // P-NOMINT
    expect assets.is_zero(tx.mint)
    // P-DATUM (giải mã; so sánh theo từng nhánh bên dưới)
    expect InlineDatum(od) = out.datum
    expect d_out: PointerDatum = od

    when redeemer is {
      CommitteePropose { new_hash } -> {
        expect !d_in.sealed
        expect
          pointer.committee_approved(
            d_in.committee,
            d_in.threshold,
            tx.extra_signatories,
          )
        expect bytearray.length(new_hash) == 28
        let IntervalBound { bound_type: hi, .. } = tx.validity_range.upper_bound
        expect Some(hi_ms) = util.get_finite(hi)
        d_out == PointerDatum {
          ..d_in,
          pending: Some(
            Pending { new_hash, effective_after_ms: hi_ms + change_delay_ms },
          ),
        }
      }

      ApplyPending -> {
        expect Some(p) = d_in.pending
        let IntervalBound { bound_type: lo, .. } = tx.validity_range.lower_bound
        expect Some(lo_ms) = util.get_finite(lo)
        expect lo_ms >= p.effective_after_ms
        d_out == PointerDatum {
          ..d_in,
          governance_hash: p.new_hash,
          pending: None,
        }
      }

      CommitteeCancel -> {
        expect !d_in.sealed
        expect
          pointer.committee_approved(
            d_in.committee,
            d_in.threshold,
            tx.extra_signatories,
          )
        expect Some(_) = d_in.pending
        d_out == PointerDatum { ..d_in, pending: None }
      }

      Seal -> {
        expect !d_in.sealed
        expect
          pointer.committee_approved(
            d_in.committee,
            d_in.threshold,
            tx.extra_signatories,
          )
        expect bytearray.length(d_in.governance_hash) == 28
        expect d_in.pending == None
        d_out == PointerDatum { ..d_in, sealed: True }
      }

      GovernanceSet { new_hash, proposal_ref } -> {
        let g = d_in.governance_hash
        expect bytearray.length(g) == 28
        expect bytearray.length(new_hash) == 28
        // Proposal ở Script(g), đúng 1 token policy g, tên == proposal_id (khuôn C-REL-1).
        let proposal = release.read_proposal(tx.reference_inputs, proposal_ref, g, g)
        expect proposal.status == Executed
        expect
          proposal.spend_spec_hash == pointer.pointer_spec_hash(own_hash, new_hash)
        d_out == PointerDatum { ..d_in, governance_hash: new_hash, pending: None }
      }
    }
  }

  else(_) {
    fail
  }
}
