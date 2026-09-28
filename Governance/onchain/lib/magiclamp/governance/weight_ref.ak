// Đọc + xác thực `WeightParam` qua reference input — MỘT nguồn cho cả `tally` và
// `governance`.
//
// Vì sao tách ra khỏi `validators/tally.ak`: từ v2 có HAI validator đọc bảng tham
// số. `tally.SumBatch`/`Finalize` đọc nó để tính VP và clamp; `governance
// ▸ FinalizeProposal` đọc nó để lấy `bft_floor`, hai quorum và θ. Hai bản sao của
// cùng một phép đọc sẽ biên dịch được, chạy xanh, và trôi khỏi nhau — và nếu bản
// nào trôi mất vế `d8_ok` thì một bảng weight vi phạm D8 đi vào đúng chỗ quyết
// định thông qua hay không, mà không phép đo nào đỏ.
//
// Cổng D8 nằm TRONG hàm này, không ở nơi gọi: đây là đường DUY NHẤT bảng knots và
// bộ ngưỡng đi vào phép tính, nên chỗ ép đúng là chỗ đọc.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, OutputReference}
use magiclamp/governance/types.{WeightParam}
use magiclamp/governance/weight_guard

/// Reference input tại ĐÚNG `weight_param_ref` đã cam kết, mang đúng một TÊN tài
/// sản của `weight_param_policy` với số lượng 1, datum giải được thành
/// `WeightParam`, và bảng thoả cổng D8. Thiếu bất cứ vế nào ⇒ `fail`.
///
/// Ghim theo `OutputReference` chứ không chỉ theo token là có lý do: `weight_param`
/// là NFT một-lần-một-pha nên chỉ có một UTxO mang nó, nhưng vế ghim ref là thứ
/// buộc `tally` và `governance` đọc ĐÚNG bảng mà proposal đã cam kết lúc Open —
/// không phải một bảng nào khác tình cờ có mặt trong reference inputs.
pub fn read_weight_param(
  reference_inputs: List<Input>,
  weight_param_policy: PolicyId,
  weight_param_ref: OutputReference,
) -> WeightParam {
  expect Some(ref) =
    list.find(
      reference_inputs,
      fn(i) {
        and {
          i.output_reference == weight_param_ref,
          dict.size(assets.tokens(i.output.value, weight_param_policy)) == 1,
        }
      },
    )
  expect [Pair(_, qty)] =
    dict.to_pairs(assets.tokens(ref.output.value, weight_param_policy))
  expect qty == 1
  expect InlineDatum(d) = ref.output.datum
  expect wp: WeightParam = d
  // Cổng D8 — ÉP TẠI ĐÂY.
  expect weight_guard.d8_ok(wp.k1, wp.k2, wp.k3, wp.k4)
  wp
}
