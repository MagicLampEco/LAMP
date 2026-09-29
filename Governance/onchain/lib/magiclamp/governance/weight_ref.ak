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
// ════════════════════════════════════════════════════════════
// Cổng D8 ở đâu — và vì sao đường NÓNG không cần chạy lại nó
// ════════════════════════════════════════════════════════════
//
// D8 được ép ở BỐN chỗ, không chỗ nào trong số đó là `SumBatch`:
//
//   1. `weight_param_nft` ▸ `mint` — CỔNG THẬT, nơi bảng được SINH RA. Nó ép
//      `d8_ok` cùng với bộ ngưỡng (θ ∈ [1/2, 1], `bft_floor` kẹp hai đầu, sàn
//      quorum theo người). Ba vế ngưỡng đó CHỈ có ở đây, không có ở phép đọc.
//   2. `governance ▸ OpenProposal` — chỗ một proposal CAM KẾT `weight_param_ref`.
//   3. `governance ▸ FinalizeProposal` — chỗ ngưỡng đi vào phán quyết.
//   4. `tally ▸ Finalize` — chỗ `bft_floor` đi vào clamp.
//
// `tally ▸ SumBatch` dùng `read_weight_param_skip_d8`. Vì sao ĐÓNG:
//
//   • **Một bảng vi phạm D8 không TỒN TẠI được.** `weight_param_nft` là one-shot
//     theo `seed_ref` (`expect list.any(inputs, _ == seed_ref)`) và mỗi lượt đúc
//     ép `dict.size(tokens(mint, policy)) == 1` ∧ `quantity_of(mint, policy,
//     phase_tag) == 1` ∧ `length(policies(mint)) == 1`. Nên trong cả đời một pha,
//     policy đó phát hành ĐÚNG MỘT đơn vị của ĐÚNG MỘT tên.
//   • **Datum của nó bất biến.** Lượt đúc ép đích `Script(policy_id)` — địa chỉ có
//     payment credential bằng hash CHÍNH script ấy. Script ấy không có nhánh
//     `spend` và `else(_) { fail }`, nên KHÔNG giao dịch nào tiêu lại được UTxO
//     đó ⇒ không giao dịch nào đặt được một datum khác lên token đó.
//   • **Phép đọc dưới đây khoá đúng vào UTxO ấy**: `output_reference ==
//     weight_param_ref` (ref đã cam kết lúc Open) ∧ đúng một TÊN tài sản của
//     policy ∧ số lượng 1. Tổng cung là một đơn vị của một tên ⇒ chỉ có một UTxO
//     trên đời thoả, và nó là beacon đã qua cổng ở gạch 1.
//
// Điều kiện duy nhất mà lập luận trên dựa vào là `weight_param_policy` được apply
// ĐÚNG bằng hash của `weight_param_nft` đã dựng. Nhưng cổng D8 ở phép đọc KHÔNG
// che được ca sai điều kiện đó: nó không kiểm `bft_floor`, không kiểm θ, không
// kiểm sàn quorum — ba thứ mà một policy giả điều khiển được để lật thẳng kết
// quả. Tức nó chặt hơn ở chỗ không ai tấn công, và bằng 0 ở chỗ bị tấn công.
//
// Số đo (2026-09-29, bảng 8 mốc, heap 20 mục): `d8_ok` tốn 3 645 089 mem mỗi lượt
// `SumBatch` — 26% trọn trần mem của một giao dịch, nhiều hơn mọi khoản khác.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, OutputReference}
use magiclamp/governance/types.{WeightParam}
use magiclamp/governance/weight_guard

/// Reference input tại ĐÚNG `weight_param_ref` đã cam kết, mang đúng một TÊN tài
/// sản của `weight_param_policy` với số lượng 1, datum giải được thành
/// `WeightParam`. Thiếu bất cứ vế nào ⇒ `fail`. **KHÔNG chạy cổng D8** — xem khối
/// đầu tệp để biết vì sao đường nóng không cần nó và bốn chỗ nào đang ép nó.
///
/// Ghim theo `OutputReference` chứ không chỉ theo token là có lý do: `weight_param`
/// là NFT một-lần-một-pha nên chỉ có một UTxO mang nó, nhưng vế ghim ref là thứ
/// buộc `tally` và `governance` đọc ĐÚNG bảng mà proposal đã cam kết lúc Open —
/// không phải một bảng nào khác tình cờ có mặt trong reference inputs.
///
/// Dùng hàm này CHỈ ở `tally ▸ SumBatch`. Mọi nơi khác gọi `read_weight_param`.
pub fn read_weight_param_skip_d8(
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
  wp
}

/// `read_weight_param_skip_d8` + cổng D8. Đây là bản MẶC ĐỊNH: mọi nhánh CHẠY MỘT
/// LẦN cho một proposal (`governance ▸ OpenProposal`, `governance
/// ▸ FinalizeProposal`, `tally ▸ Finalize`) dùng bản này.
///
/// Định nghĩa bằng phép hợp thành, không chép lại phép đọc: hai bản sao của cùng
/// một phép đọc sẽ biên dịch được, chạy xanh, và trôi khỏi nhau — đó là lý do tệp
/// này tồn tại, và nó không được tự phạm chính điều nó chống.
pub fn read_weight_param(
  reference_inputs: List<Input>,
  weight_param_policy: PolicyId,
  weight_param_ref: OutputReference,
) -> WeightParam {
  let wp =
    read_weight_param_skip_d8(
      reference_inputs,
      weight_param_policy,
      weight_param_ref,
    )
  expect weight_guard.d8_ok(wp.k1, wp.k2, wp.k3, wp.k4)
  wp
}
