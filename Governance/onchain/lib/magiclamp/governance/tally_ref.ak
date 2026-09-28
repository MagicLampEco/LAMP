// Đọc Tally accumulator từ một danh sách UTxO — MỘT nguồn cho cả bốn chỗ cần nó
// (`nullifier`, `vote`, `tally`, `governance`).
//
// Nhận diện bằng TOKEN `(tally_policy, proposal_id)`, KHÔNG bằng script hash: ba
// validator kia không có `tally_script_hash` trong apply-param, và thêm nó vào là
// tạo vòng phụ thuộc hash (`tally` nhận `vote_script_hash`). `tally_policy` là
// one-shot theo `H(seed)` nên một tên token ứng đúng một proposal trong cả đời
// pha — đó là thứ làm phép nhận diện theo token đủ chắc.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, Output}
use magiclamp/governance/types.{TallyDatum}

/// Đúng MỘT UTxO trong `inputs` mang 1 đơn vị `(tally_policy, proposal_id)`,
/// datum inline giải được thành `TallyDatum` có `proposal_id` khớp.
/// Thiếu/thừa/đọc không được ⟹ `None`.
pub fn find_tally(
  inputs: List<Input>,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
) -> Option<TallyDatum> {
  when
    list.filter(
      inputs,
      fn(i) {
        assets.quantity_of(i.output.value, tally_policy, proposal_id) == 1
      },
    )
  is {
    [t] ->
      when t.output.datum is {
        InlineDatum(d) ->
          if d is td: TallyDatum {
            if td.proposal_id == proposal_id {
              Some(td)
            } else {
              None
            }
          } else {
            None
          }
        _ -> None
      }
    _ -> None
  }
}

/// Như `find_tally` nhưng `fail` khi không tìm được — dùng ở chỗ sự vắng mặt của
/// tally là lỗi chứ không phải một nhánh.
pub fn expect_tally(
  inputs: List<Input>,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
) -> TallyDatum {
  expect Some(td) = find_tally(inputs, tally_policy, proposal_id)
  td
}

/// Tally bị TIÊU trong giao dịch, KHÔNG pin `proposal_id` — chỉ dùng ở chỗ danh
/// tính proposal đã được pin bởi một chốt khác trong cùng nhánh. Đúng một UTxO
/// mang đúng một TÊN token của `tally_policy`.
pub fn find_tally_any(
  inputs: List<Input>,
  tally_policy: PolicyId,
) -> Option<TallyDatum> {
  when
    list.filter(
      inputs,
      fn(i) { dict.size(assets.tokens(i.output.value, tally_policy)) == 1 },
    )
  is {
    [t] ->
      when t.output.datum is {
        InlineDatum(d) ->
          if d is td: TallyDatum {
            Some(td)
          } else {
            None
          }
        _ -> None
      }
    _ -> None
  }
}

/// Tally OUTPUT của đúng proposal — tìm bằng TOKEN, KHÔNG bằng
/// `tally_script_hash`. Đây là vế làm `vote` kiểm được "phiếu này ĐÃ ĐƯỢC GHI
/// VÀO SỔ" mà không cần biết hash của `tally` (biết là sinh vòng apply-param).
pub fn find_tally_output(
  outputs: List<Output>,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
) -> Option<TallyDatum> {
  when
    list.filter(
      outputs,
      fn(o) { assets.quantity_of(o.value, tally_policy, proposal_id) == 1 },
    )
  is {
    [o] ->
      when o.datum is {
        InlineDatum(d) ->
          if d is td: TallyDatum {
            if td.proposal_id == proposal_id {
              Some(td)
            } else {
              None
            }
          } else {
            None
          }
        _ -> None
      }
    _ -> None
  }
}
