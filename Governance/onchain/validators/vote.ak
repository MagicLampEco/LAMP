// Validator 2 — Vote v2. Một phiếu = một UTxO mang đúng một token nullifier.
//
// ┌─ Ba nhánh, ba CỬA SỔ THỜI GIAN rời nhau ────────────────────────────────────┐
// │ RetractVote      e < vote_close                    (đổi lựa chọn tại chỗ)   │
// │ ConsumeForTally  e ≥ vote_close  (do `tally.SumBatch` cùng tx ép)           │
// │ ReclaimVote      e ≥ vote_close + tally_window     (thu hồi phiếu chết)     │
// │                                                                             │
// │ Tính rời nhau là SỐ HỌC, không phải một luật thêm: `e` là MỘT số (khuôn hai │
// │ đầu `util.get_epoch_bounded`), nên `e < close` và `e ≥ close` không cùng     │
// │ đúng. Nhờ đó "rút phiếu trong cùng giao dịch với lượt gộp" chết không cần    │
// │ chốt riêng.                                                                 │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ĐỔI BẢN CHẤT so với v1:
//  • BỎ nhánh `CastVote`. Phiếu được TẠO bằng một giao dịch đúc nullifier —
//    `nullifier.MintNullifier` là nơi giữ cổng WHO (anchor TAAD + A-PERSON + hai
//    chữ ký). Một nhánh `spend` không thể gác việc tạo ra chính UTxO của nó.
//  • BỎ apply-param `proposal_policy` (nhận là sinh vòng qua `tally_script_hash`)
//    và BỎ `committee` (`did_stub` không còn nằm trên đường biểu quyết).
//  • THÊM `taad_policy` (chứng thực chủ phiếu ở `RetractVote`/`ReclaimVote`) và
//    `tally_window_epochs` (cửa sổ thu hồi).
//  • Cap `c*_capped` KHÔNG kiểm ở đây nữa: datum của một UTxO phiếu do bên dựng
//    giao dịch viết, nên kiểm ở `vote` không chặn được phiếu tạo trực tiếp. Cap
//    được kiểm LẠI ở `tally.SumBatch` — chỗ duy nhất số đó đi vào phép tính.
//
// Tham số hoá: tally_policy, nullifier_policy, taad_policy, ms_per_epoch,
//              tally_window_epochs.

use aiken/collection/dict
use aiken/collection/list
use aiken/merkle_patricia_forestry as mpf
use aiken/merkle_patricia_forestry.{Proof}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/governance/anchor_view
use magiclamp/governance/names.{nullifier_name}
use magiclamp/governance/tally_ref
use magiclamp/governance/types.{VoteDatum}
use magiclamp/governance/util

pub type VoteRedeemer {
  /// `book_proof` = chứng minh MPF rằng `(did_commit → nullifier)` CÓ TRONG sổ
  /// `voted_root` của Tally OUTPUT trong cùng giao dịch. Bên dựng lô sinh nó
  /// off-chain từ trạng thái sổ SAU khi chèn cả lô.
  ConsumeForTally { book_proof: Proof }
  RetractVote
  ReclaimVote
}

validator vote(
  tally_policy: PolicyId,
  nullifier_policy: PolicyId,
  taad_policy: PolicyId,
  ms_per_epoch: Int,
  tally_window_epochs: Int,
  // THÊM 2026-10-02 (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-3) — ĐẶT CUỐI theo khuôn các
  // tham số đã thêm trước. Gốc lưới cửa sổ: cửa sổ = (t − window_origin_ms) / ms_per_epoch,
  // nên chỉ số cửa sổ = số epoch Cardano của mạng. Đổi hash validator này.
  window_origin_ms: Int,
) {
  spend(
    datum_opt: Option<VoteDatum>,
    redeemer: VoteRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(vd) = datum_opt
    let inp = util.own_input(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(inp.address)

    when redeemer is {
      // ── ConsumeForTally: phiếu bị gộp vào Tally ──
      ConsumeForTally { book_proof } -> {
        // (V1) token BUỘC vào datum: đúng một tên token nullifier, đúng 1 đơn vị,
        //      tên = H(did‖prop). Không có vế này thì một UTxO phiếu mang token
        //      của DID khác vẫn được cộng cho `vd.did_commit`.
        expect vd.nullifier == nullifier_name(vd.did_commit, vd.proposal_id)
        expect
          assets.quantity_of(inp.value, nullifier_policy, vd.nullifier) == 1
        expect dict.size(assets.tokens(inp.value, nullifier_policy)) == 1
        // (V2) ĐỐT trong cùng giao dịch.
        expect assets.quantity_of(tx.mint, nullifier_policy, vd.nullifier) == -1
        // (V3) TIÊU HẲN: không output nào ở script này còn giữ nullifier này.
        //      (V2) một mình không đủ — đốt một đơn vị mà giữ lại một đơn vị khác
        //      cùng tên thì phiếu sống tiếp.
        expect
          list.all(
            tx.outputs,
            fn(o) {
              !util.is_at_script(o.address, own_hash) || assets.quantity_of(
                o.value,
                nullifier_policy,
                vd.nullifier,
              ) == 0
            },
          )
        // (V4) Tally của ĐÚNG proposal này bị TIÊU cùng tx (không phải reference).
        expect
          tally_ref.find_tally(tx.inputs, tally_policy, vd.proposal_id) != None
        // (V5) phiếu ĐƯỢC GHI VÀO SỔ. Đây là vế làm việc "huỷ phiếu chưa đếm"
        //      bất khả về cấu trúc: không có nó, một giao dịch tiêu k phiếu của
        //      phe chống rồi `Finalize` ngay là hợp lệ — phiếu bị phá huỷ vĩnh
        //      viễn mà không bao giờ vào tally.
        //      Tìm Tally OUTPUT bằng TOKEN nên `vote` không cần biết
        //      `tally_script_hash` ⇒ không sinh vòng apply-param.
        expect Some(td_out) =
          tally_ref.find_tally_output(tx.outputs, tally_policy, vd.proposal_id)
        mpf.has(
          mpf.from_root(td_out.voted_root),
          vd.did_commit,
          vd.nullifier,
          book_proof,
        )
      }

      // ── RetractVote: đổi lựa chọn TẠI CHỖ, giữ nullifier, TRƯỚC khi đóng phiếu ──
      RetractVote -> {
        // (R1) đúng 1 input + 1 output tại script này — chống gộp nhiều phiếu
        //      trong một lần rút (một chữ ký thoả cho nhiều phiếu).
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let out = util.output_at_script(tx.outputs, own_hash)
        // (R2) TRƯỚC khi đóng phiếu.
        let td =
          tally_ref.expect_tally(
            tx.reference_inputs,
            tally_policy,
            vd.proposal_id,
          )
        expect util.get_epoch_bounded(tx, ms_per_epoch, window_origin_ms) < td.vote_close_epoch
        // (R3) chứng thực CHỦ phiếu: anchor TAAD của `did_commit`, Active, Person
        //      gốc, hai chữ ký. v1 KHÔNG có vế này — ai cũng đổi được lựa chọn
        //      của người khác.
        expect
          anchor_view.person_owner_signed_ref(
            tx.reference_inputs,
            taad_policy,
            vd.did_commit,
            tx.extra_signatories,
          )
        // (R4) bảo toàn value TUYỆT ĐỐI + đúng địa chỉ đầy đủ + không đính script.
        //      Giữ riêng token nullifier là chưa đủ: người rút giữ token, ghi datum
        //      đúng, rồi hút hết ADA của phiếu ra ví mình.
        expect out.value == inp.value
        expect out.address == inp.address
        expect out.reference_script == None
        expect InlineDatum(od) = out.datum
        expect ov: VoteDatum = od
        // (R5) CHỈ `choice` được đổi, và PHẢI đổi thật.
        and {
          ov.proposal_id == vd.proposal_id,
          ov.did_commit == vd.did_commit,
          ov.nullifier == vd.nullifier,
          ov.c1_capped == vd.c1_capped,
          ov.c2_capped == vd.c2_capped,
          ov.c3_capped == vd.c3_capped,
          ov.c4_capped == vd.c4_capped,
          ov.choice != vd.choice,
          // không đúc/đốt gì trong lượt rút — chặn cả đường lén đốt nullifier.
          tx.mint == assets.zero,
        }
      }

      // ── ReclaimVote: lấy lại min-ADA của phiếu KHÔNG được ai gom ──
      //    Không có nhánh này thì sau `Finalize` mọi phiếu chưa gom chết vĩnh
      //    viễn (min-ADA + token nullifier), và "không gom phiếu của một nhóm"
      //    trở thành đòn bẩy: nhóm đó mất phiếu VÀ mất cọc.
      ReclaimVote -> {
        // (C1) đúng 1 input tại script này — một chữ ký chỉ thu hồi một phiếu.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        // (C2) cửa sổ gom đã đóng. Đọc qua REFERENCE input: sau `Finalize` Tally
        //      không còn nhánh nào tiêu được nó.
        let td =
          tally_ref.expect_tally(
            tx.reference_inputs,
            tally_policy,
            vd.proposal_id,
          )
        expect
          util.get_epoch_bounded(tx, ms_per_epoch, window_origin_ms) >= td.vote_close_epoch + tally_window_epochs
        // (C3) CHỈ chủ phiếu thu hồi.
        expect
          anchor_view.person_owner_signed_ref(
            tx.reference_inputs,
            taad_policy,
            vd.did_commit,
            tx.extra_signatories,
          )
        // (C4) nullifier PHẢI bị đốt — không để token phiếu sống ra ngoài script,
        //      nơi không validator nào gác nó nữa.
        expect assets.quantity_of(tx.mint, nullifier_policy, vd.nullifier) == -1
        // (C5) và không output nào ở script này giữ lại nó.
        list.all(
          tx.outputs,
          fn(o) {
            !util.is_at_script(o.address, own_hash) || assets.quantity_of(
              o.value,
              nullifier_policy,
              vd.nullifier,
            ) == 0
          },
        )
      }
    }
  }

  else(_) {
    fail
  }
}
