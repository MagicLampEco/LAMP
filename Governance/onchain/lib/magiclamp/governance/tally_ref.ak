// Đọc Tally accumulator từ một danh sách UTxO — MỘT nguồn cho cả bốn chỗ cần nó
// (`nullifier`, `vote`, `tally`, `governance`).
//
// Nhận diện bằng TOKEN `(tally_policy, proposal_id)`, KHÔNG bằng script hash: ba
// validator kia không có `tally_script_hash` trong apply-param, và thêm nó vào là
// tạo vòng phụ thuộc hash (`tally` nhận `vote_script_hash`). `tally_policy` là
// one-shot theo `H(seed)` nên một tên token ứng đúng một proposal trong cả đời
// pha — đó là thứ làm phép nhận diện theo token đủ chắc.
//
// ════════════════════════════════════════════════════════════
// HAI MỨC ĐỌC — và vì sao mức LÁT CẮT không nới một chốt nào
// ════════════════════════════════════════════════════════════
//
// `TallyDatum` có 15 trường, trong đó trường 8 (`top_did_vp`) là một DANH SÁCH dài
// tới `bft_floor − 1` mục. Giải chặt (`expect td: TallyDatum = d`) duyệt trọn danh
// sách đó. Đo 2026-09-29 với heap 20 mục: MỘT lần giải chặt ≈ 313 000 mem. Trong
// một giao dịch `SumBatch` k phiếu, `vote` giải hai lần MỖI phiếu (cổng V4 trên
// input + V5 trên output) và `nullifier` một lần ⇒ `2k + 1` lần, ~6,6 M mem ở
// k = 10. Không cổng nào trong số đó ĐỌC một trường nào của heap.
//
//   • `tally_view` — LÁT CẮT bốn trường đường nóng cần (`proposal_id`,
//     `vote_open_epoch`, `vote_close_epoch`, `voted_root`), đọc THEO CHỈ SỐ, mỗi
//     trường fail-closed riêng. Trường 8 không bao giờ bị ép ⇒ chi phí không phụ
//     thuộc cỡ heap. Dùng ở `vote` và `nullifier`.
//   • `expect_tally_at` — giải CHẶT trọn `TallyDatum`. Dùng ở `governance
//     ▸ FinalizeProposal`, nơi `tally_lib.pass` đọc sáu trường đếm và `phase`.
//
// **Vì sao lát cắt KHÔNG nới chốt nào** — tập datum mà nó nhận rộng hơn tập giải
// chặt đúng ở một chỗ: hình dạng của 11 trường KHÔNG được đọc. Ba vế còn giữ
// nguyên (Constr chỉ số 0 · ĐÚNG 15 trường · bốn trường đọc đúng kiểu). Và chỗ
// rộng thêm đó không mở đường nào, vì mọi Tally UTxO chia làm đúng hai loại:
//
//   1. **Tại `Script(tally_script_hash)`.** Datum của nó chỉ do hai nhánh ghi ra
//      được, và CẢ HAI đã giải chặt trọn `TallyDatum` trước khi cho qua:
//      `governance ▸ OpenProposal` (O5, `expect ts: TallyDatum`) lúc tạo, và
//      `tally.spend ▸ out_datum` ở mọi lượt ghi sau. Nên một Tally hợp lệ LUÔN
//      có trọn 15 trường đúng kiểu — lát cắt và giải chặt nhận cùng một tập.
//   2. **Ngoài `Script(tally_script_hash)`** — đường `[TALLY-TOKEN-OUTSIDE-OPEN]`
//      (SPEC §v2.10): một token `tally_policy` đúc lẻ dựng được Tally UTxO có
//      datum BỊA tại địa chỉ bất kỳ. Ở đó kẻ dựng viết được datum tuỳ ý, nên nó
//      viết một `TallyDatum` HỢP KHUÔN cũng dễ đúng bằng viết một cái méo. Phép
//      giải chặt không chặn được gì ở loại 2, nên bỏ nó cũng không mất gì.
//
// Tức chốt thật của `vote` V4/V5 và của `nullifier` là TÊN TOKEN one-shot cộng
// với việc `tally.spend` phải chạy trong cùng giao dịch khi Tally bị tiêu — không
// phải phép giải chặt datum. Hở loại 2 vẫn nguyên như trước lượt này, không rộng
// thêm một ly, và ràng buộc tạm của nó vẫn là phép xác minh off-chain khai ở SPEC.

use aiken/builtin
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use magiclamp/governance/types.{Summing, TallyDatum}
use magiclamp/governance/util

// ════════════════════════════════════════════════════════════
// Lát cắt đường nóng — đọc `TallyDatum` THEO CHỈ SỐ
// ════════════════════════════════════════════════════════════

/// Bốn trường của `TallyDatum` mà `vote` và `nullifier` thật sự đọc. Tên trường
/// giữ NGUYÊN tên của `TallyDatum` để nơi gọi không phải đổi chữ nào.
pub type TallyView {
  proposal_id: ByteArray,
  vote_open_epoch: Int,
  vote_close_epoch: Int,
  voted_root: ByteArray,
}

/// Lát cắt bốn trường từ một `Data`. Không phải Constr, sai chỉ số Constr, sai số
/// trường, hoặc một trong bốn trường sai kiểu ⟹ `None`. KHÔNG bao giờ `fail`.
///
/// Khuôn danh sách 15 ô viết THẲNG ra thay vì bốn lần `list.at`: một `when` trên
/// danh sách có độ dài cố định biên dịch thành 15 bước đi-đuôi thuần, KHÔNG số học
/// chỉ số và KHÔNG cấp phát `Option` trung gian, và nó ép luôn "đúng 15 trường"
/// miễn phí. Đo 2026-09-29: bản `list.at` ×4 + `list.length` tốn ~129 000 mem mỗi
/// lượt đọc, bản khuôn này ~7 000 — chênh 18 lần cho cùng một kết quả.
///
/// Thứ tự ô PHẢI khớp thứ tự khai báo `types.TallyDatum` (15 trường):
///   0 proposal_id · 1 phase · 2 weight_param_ref · 3 yes_power_raw ·
///   4 no_power_raw · 5 abstain_power_raw · 6 voters_acc · 7 yes_voters_acc ·
///   8 top_did_vp · 9 yes_power_eff · 10 no_power_eff · 11 abstain_power_eff ·
///   12 vote_open_epoch · 13 vote_close_epoch · 14 voted_root.
/// Đổi thứ tự trường ở `types.ak` mà quên khuôn này là lỗi ÂM THẦM — ca
/// `tv_khop_tally_datum_that` giữ chỗ đó bằng cách dựng một `TallyDatum` THẬT rồi
/// đối chiếu từng trường của lát cắt.
pub fn tally_view(data: Data) -> Option<TallyView> {
  if builtin.choose_data(data, True, False, False, False, False) {
    let pair = builtin.un_constr_data(data)
    if pair.1st != 0 {
      None
    } else {
      when pair.2nd is {
        [
          f_proposal_id, _phase, _weight_param_ref, _yes_power_raw,
          _no_power_raw, _abstain_power_raw, _voters_acc, _yes_voters_acc,
          _top_did_vp, _yes_power_eff, _no_power_eff, _abstain_power_eff,
          f_vote_open_epoch, f_vote_close_epoch, f_voted_root,
        ] ->
          if f_proposal_id is pid: ByteArray {
            if f_vote_open_epoch is vo: Int {
              if f_vote_close_epoch is vc: Int {
                if f_voted_root is root: ByteArray {
                  Some(
                    TallyView {
                      proposal_id: pid,
                      vote_open_epoch: vo,
                      vote_close_epoch: vc,
                      voted_root: root,
                    },
                  )
                } else {
                  None
                }
              } else {
                None
              }
            } else {
              None
            }
          } else {
            None
          }
        _ -> None
      }
    }
  } else {
    None
  }
}

// ════════════════════════════════════════════════════════════
// Tìm Tally theo TOKEN
// ════════════════════════════════════════════════════════════

/// Đúng MỘT UTxO trong `inputs` mang 1 đơn vị `(tally_policy, proposal_id)`,
/// datum inline đọc được lát cắt và có `proposal_id` khớp.
/// Thiếu/thừa/đọc không được ⟹ `None`.
pub fn find_tally(
  inputs: List<Input>,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
) -> Option<TallyView> {
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
          when tally_view(d) is {
            Some(tv) ->
              if tv.proposal_id == proposal_id {
                Some(tv)
              } else {
                None
              }
            None -> None
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
) -> TallyView {
  expect Some(tv) = find_tally(inputs, tally_policy, proposal_id)
  tv
}

/// Như `expect_tally` nhưng GHIM THÊM địa chỉ (UTxO tally phải nằm tại
/// `Script(tally_script_hash)`) và giải CHẶT trọn `TallyDatum`.
///
/// Chỉ `governance` dùng được hàm này — nó là validator DUY NHẤT có
/// `tally_script_hash` trong apply-param (`SPEC.md` §v2.4: chuỗi phụ thuộc hash đi
/// một chiều `tally → governance`, nên `vote`/`nullifier`/`tally` không biết hash
/// đó và phải nhận diện bằng token).
///
/// Vì sao `governance` phải ghim thêm địa chỉ dù token đã duy nhất (`R-TALLY-HASH`):
/// token `(tally_policy, proposal_id)` duy nhất, nhưng `tally_policy` KHÔNG kiểm nơi
/// đến của nó (`[TALLY-TOKEN-OUTSIDE-OPEN]`). Vế địa chỉ là chỗ `governance` từ chối
/// đọc một Tally nằm ngoài script tally, và nó là vế RẺ nhất trong hai vế
/// `R-PIN-TWO` đòi — không được gộp với vế token thành một phép kiểm.
///
/// Vì sao chỗ này GIỮ phép giải chặt trong khi `vote`/`nullifier` chuyển sang lát
/// cắt: `tally_lib.pass` đọc `yes_power_eff`, `no_power_eff`, `abstain_power_eff`,
/// `voters_acc`, `yes_voters_acc` và `phase` — sáu trường, rải khắp record. Lát cắt
/// ở đây không tiết kiệm gì (chỉ né được trường 8) mà lại thêm sáu hằng chỉ số phải
/// giữ đồng bộ. Và nhánh này chạy MỘT lần cho cả đời proposal.
pub fn expect_tally_at(
  inputs: List<Input>,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
  tally_script_hash: ByteArray,
) -> TallyDatum {
  expect [t] =
    list.filter(
      inputs,
      fn(i) {
        assets.quantity_of(i.output.value, tally_policy, proposal_id) == 1
      },
    )
  expect util.is_at_script(t.output.address, tally_script_hash)
  expect InlineDatum(d) = t.output.datum
  expect td: TallyDatum = d
  expect td.proposal_id == proposal_id
  td
}

/// Tally OUTPUT của đúng proposal — tìm bằng TOKEN, KHÔNG bằng
/// `tally_script_hash`. Đây là vế làm `vote` kiểm được "phiếu này ĐÃ ĐƯỢC GHI
/// VÀO SỔ" mà không cần biết hash của `tally` (biết là sinh vòng apply-param).
pub fn find_tally_output(
  outputs: List<Output>,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
) -> Option<TallyView> {
  when
    list.filter(
      outputs,
      fn(o) { assets.quantity_of(o.value, tally_policy, proposal_id) == 1 },
    )
  is {
    [o] ->
      when o.datum is {
        InlineDatum(d) ->
          when tally_view(d) is {
            Some(tv) ->
              if tv.proposal_id == proposal_id {
                Some(tv)
              } else {
                None
              }
            None -> None
          }
        _ -> None
      }
    _ -> None
  }
}

// ════════════════════════════════════════════════════════════
// Tests — `tally_view`
// ════════════════════════════════════════════════════════════
//
// Hai nhóm, hai mục đích khác nhau:
//   • `tv_khop_tally_datum_that` GHIM KHUÔN vào kiểu thật. Nó dựng một `TallyDatum`
//     bằng literal record rồi so từng trường lát cắt với chính bộ truy cập record
//     — đổi thứ tự trường ở `types.ak` làm hai bên lệch một ô và ca đỏ. Ba giá trị
//     mốc (`vote_open_epoch`, `vote_close_epoch`) cố ý KHÁC NHAU: bằng nhau thì
//     hoán vị hai ô không phân biệt được.
//   • Bốn ca `_tra_none` ghim từng vế FAIL-CLOSED của khuôn. Chúng dựng `Data` thô
//     từ CHÍNH `TallyDatum` ở trên (không gõ tay 15 ô), nên một lượt nối trường sau
//     này không để chúng lặng lẽ đo sai ô.

fn tv_td() -> TallyDatum {
  TallyDatum {
    proposal_id: #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    phase: Summing,
    weight_param_ref: OutputReference { transaction_id: #"bb", output_index: 7 },
    yes_power_raw: 11,
    no_power_raw: 22,
    abstain_power_raw: 33,
    voters_acc: 44,
    yes_voters_acc: 55,
    top_did_vp: [],
    yes_power_eff: 66,
    no_power_eff: 77,
    abstain_power_eff: 88,
    vote_open_epoch: 100,
    vote_close_epoch: 102,
    voted_root: #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
  }
}

fn tv_fields() -> List<Data> {
  let d: Data = tv_td()
  builtin.un_constr_data(d).2nd
}

test tv_khop_tally_datum_that() {
  let td = tv_td()
  let d: Data = td
  expect Some(tv) = tally_view(d)
  and {
    tv.proposal_id == td.proposal_id,
    tv.vote_open_epoch == td.vote_open_epoch,
    tv.vote_close_epoch == td.vote_close_epoch,
    tv.voted_root == td.voted_root,
    // Khuôn 15 ô trong `tally_view` phụ thuộc đúng con số này.
    list.length(tv_fields()) == 15,
  }
}

/// Thiếu một trường ⟹ khuôn 15 ô không khớp ⟹ `None` (KHÔNG `fail`).
test tv_thieu_truong_tra_none() {
  let d: Data = builtin.constr_data(0, list.take(tv_fields(), 14))
  tally_view(d) == None
}

/// THỪA một trường cũng bị bác — giữ tập nhận của lát cắt sát tập nhận của phép
/// giải chặt, để chênh lệch giữa hai phép chỉ còn ở hình dạng 11 trường không đọc.
test tv_thua_truong_tra_none() {
  let extra: Data = 0
  let d: Data = builtin.constr_data(0, list.concat(tv_fields(), [extra]))
  tally_view(d) == None
}

/// Constr chỉ số khác 0 ⟹ không phải `TallyDatum`.
test tv_sai_chi_so_constr_tra_none() {
  let d: Data = builtin.constr_data(1, tv_fields())
  tally_view(d) == None
}

/// Ô `voted_root` sai kiểu (Int thay ByteArray) ⟹ `None`. Không có vế kiểu này thì
/// `mpf.from_root` nhận một thứ không phải 32 byte.
test tv_voted_root_sai_kieu_tra_none() {
  let bad: Data = 9
  let d: Data =
    builtin.constr_data(0, list.concat(list.take(tv_fields(), 14), [bad]))
  tally_view(d) == None
}

/// Datum không phải Constr (một Int trần) ⟹ `None`, không `fail`.
test tv_khong_phai_constr_tra_none() {
  let d: Data = 7
  tally_view(d) == None
}
