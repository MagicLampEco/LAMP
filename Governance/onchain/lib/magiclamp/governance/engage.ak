// Đọc C1 — MAGIC đã tiêu thụ — từ các thread Engage của repo MAGIC. TECH §5.2.
//
// Đưa lên mã hiện hành từ nhánh cục bộ `feat/c1-tong-tren-danh-sach-phieu-khai`
// (ff4563a · 86569e5 · 32cd137), CHỈNH theo kiến trúc v2: v2 đã bỏ nhánh `CastVote`,
// nên chỗ đọc C1 không còn ở `vote` mà ở cổng nguồn `tally.SumBatch ▸ c_sources_ok`
// (`Governance/SPEC.md` §v2.8 `R-C-SOURCE`) — chỗ DUY NHẤT `c*_capped` đi vào phép tính.
//
// ════════════════════════════════════════════════════════════════════════════════════
// KHÔNG CÓ "BEACON C1". Bản đặc tả trước đặt tên cho một thứ không tồn tại, và mọi hệ
// quả dựng trên cái tên đó (một UTxO tổng-hợp cho mỗi DID, một con trỏ ref duy nhất)
// đều sai theo. Nguồn có thẩm quyền là datum của UTxO **thread Engage** tại script
// `consume` của MAGIC, đọc bằng reference input.
//
// HAI KHUÔN GIỐNG NHAU GẦN ĐÚNG, KHÔNG THAY THẾ NHAU ĐƯỢC — đây là chỗ dễ sai nhất:
//   · chứng thực C3 (`tally.ak ▸ attested_c3`): định danh nằm trong TÊN TÀI SẢN.
//   · thread Engage (tệp này):                   định danh nằm trong TRƯỜNG DATUM
//     `did_commit`. Tên tài sản của thread là `blake2b_256(cbor(seed))` — nó định danh
//     THREAD, không định danh người. Dùng nhầm khuôn thì phép so khớp vẫn chạy và vẫn
//     trả Bool.
//
// VÌ SAO MỘT PHÉP KIỂM ĐỦ CHO CẢ XÁC THỰC LẪN ĐỊA CHỈ:
// ở `ConsumeMAGIC/onchain/validators/consume.ak`, policy của thread NFT **chính là
// script hash** của validator `consume` (khối `validate_mint_engage_id`: `policy_id ==
// script hash`), và NFT bị neo vào `Address { payment_credential: Script(policy_id),
// stake_credential: None }` ngay lúc đúc; nhánh spend giữ `out.address == in.address`
// nên địa chỉ lúc sinh là địa chỉ vĩnh viễn. Hệ quả: "UTxO mang đúng 1 token qty 1 dưới
// policy P" đã hàm ý "UTxO nằm ở địa chỉ script P". Không cần kiểm địa chỉ riêng.
//
// 🔴 ĐIỀU KIỆN NGẦM CỦA SUY LUẬN TRÊN — `stake_credential: None` (MAGIC agent xác nhận
// 2026-09-21, thư `mg0921lamp-b`). Suy luận đúng VÌ thread không mang stake credential.
// Ngày nào thread mang stake credential (vd để nhận thưởng stake) thì ĐỊA CHỈ đổi trong
// khi policy NFT KHÔNG đổi — và `carries_thread_nft` dưới đây vẫn xanh trong lúc thứ nó
// bảo vệ đã hở. MAGIC chưa có kế hoạch nào như thế và nhận nghĩa vụ báo nếu có; ghi ra
// đây vì đó là một điều kiện, không phải một dòng mã ai cũng thấy.
//
// VÌ SAO `engage_policies` LÀ DANH SÁCH: `consume` nhận `vault_script_hash` làm
// apply-param ⇒ mỗi loại vault sinh MỘT script hash khác nhau ⇒ một người có thread
// nằm ở nhiều policy. Ở v2 danh sách là apply-param CUỐI của `tally`, cùng khuôn với
// `c3_policy`: bảng `WeightParam` là beacon khoá vĩnh viễn theo pha
// (`weight_param_nft.ak`), nên công nhận thêm một policy ở đâu cũng là dựng pha mới —
// đặt ở apply-param thì không đổi định dạng nhị phân của `WeightParam`.
//
// VÌ SAO KHÔNG CÒN DANH SÁCH CON TRỎ `c1_thread_refs`: bản v1 nhận con trỏ trong
// redeemer `CastVote` và phải tự kiểm "đôi một khác nhau" (sổ cái coi reference inputs
// là TẬP, con trỏ lặp cộng một thread n lần). Ở đây ta QUÉT chính tập reference inputs:
// tập không có phần tử lặp, nên đường "cộng một thread n lần" không tồn tại bằng cấu
// trúc, không cần phép kiểm nào thêm.
// ════════════════════════════════════════════════════════════════════════════════════

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input}

/// Bản sao hình dạng datum thread Engage của repo MAGIC.
///
/// 🔴 CHỈ SỐ TRƯỜNG LÀ HỢP ĐỒNG NHỊ PHÂN, và bản gốc thuộc repo MAGIC
/// (`ConsumeMAGIC/onchain/lib/magiclamp/consume/types.ak` ▸ `EngageDatum`). Đổi thứ tự
/// ở đây là đọc sai trường mà KHÔNG lỗi decode — mọi trường quanh đó đều là số nguyên
/// hoặc ByteArray, nên một hoán vị sai vẫn decode trót lọt và trả về một con số trông
/// hợp lý. Đây là lý do bản sao này khai đủ CẢ NĂM trường chứ không chỉ hai trường dùng
/// tới.
///
/// ⛔ `consumed_count` (chỉ số 1) KHÔNG phải C1: nó đếm SỐ THAO TÁC, không đếm lượng
/// MAGIC. Chênh tới ~10¹⁰ so với `consumed_nanogic`.
///
/// ⚠ BẢN SAO NÀY GHIM `EngageDatum`, KHÔNG ghim "datum của MAGIC". Repo MAGIC có nhiều
/// lược đồ datum và chúng đổi độc lập; `VaultDatum` ở đó là một lược đồ KHÁC, và đổi số
/// trường của nó KHÔNG chạm vế đọc C1. Hai cái tên đọc lướt là một, nên lần sau nghe
/// "MAGIC đổi datum" thì hỏi ĐỔI CÁI NÀO trước khi tra lại cả vế đọc C1.
///
/// Cố ý KHÔNG ghi số trường của `VaultDatum` ở đây: một con số của kho khác chép sang đây
/// là bản sao không có đường về nguồn — nó chết im lặng khi bên kia đổi hướng, mà câu văn
/// vẫn đọc trôi chảy. (Đã suýt xảy ra: thư `mg0921lamp-c`, 2026-09-21.)
pub type EngageDatum {
  owner: ByteArray,
  consumed_count: Int,
  last_epoch: Int,
  did_commit: ByteArray,
  consumed_nanogic: Int,
}

/// Một UTxO mang đúng 1 token qty 1 dưới MỘT policy trong danh sách cho phép?
fn carries_thread_nft(input: Input, engage_policies: List<PolicyId>) -> Bool {
  list.any(
    engage_policies,
    fn(p) {
      let toks = assets.tokens(input.output.value, p)
      when dict.to_pairs(toks) is {
        [Pair(_, qty)] -> qty == 1
        _ -> False
      }
    },
  )
}

/// Mọi thread Engage được công nhận có mặt trong reference inputs, dạng
/// `(did_commit, consumed_nanogic)`. Tính MỘT lần cho cả lô, không phải mỗi phiếu
/// một lần: số datum phải giải mã bằng số thread, không bằng `phiếu × thread`.
///
/// UTxO không mang thread NFT bị bỏ qua (đó là beacon `WeightParam`, chứng thực C3…).
/// UTxO MANG thread NFT mà datum không phải `EngageDatum` inline thì `fail`: theo
/// `consume.ak` điều đó không xảy ra trên chuỗi thật, và reference inputs do chính bên
/// dựng lô chọn — fail-closed không mở đường từ chối dịch vụ nào cho bên thứ ba.
pub fn thread_credits(
  reference_inputs: List<Input>,
  engage_policies: List<PolicyId>,
) -> List<Pair<ByteArray, Int>> {
  list.foldr(
    reference_inputs,
    [],
    fn(inp, acc) {
      if carries_thread_nft(inp, engage_policies) {
        expect InlineDatum(d) = inp.output.datum
        expect ed: EngageDatum = d
        [Pair(ed.did_commit, ed.consumed_nanogic), ..acc]
      } else {
        acc
      }
    },
  )
}

/// C1 CHỨNG THỰC cho một DID = TỔNG `consumed_nanogic` trên các thread của DID đó CÓ MẶT
/// trong giao dịch (TECH §5.2).
///
/// KHÔNG phải "tổng trên mọi thread tồn tại": không cấu trúc nào trên chuỗi liệt kê
/// được mọi thread của một DID, nên tính đầy đủ không chứng minh được từ reference
/// input. Đây là CHẶN DƯỚI của C1 thật — dùng nó làm trần cho số khai
/// (`attested ≥ c1_capped`) chặn đúng đường cần chặn: khai THỪA. Khai THIẾU không phải
/// đường tấn công — `VP` đơn điệu tăng theo `C1`.
///
/// Khớp theo BYTE với `did_commit` của phiếu — thiếu vế này là MƯỢN C1 của người khác
/// (audit #8). Lưu ý giới hạn ở `tally.ak ▸ c_sources_ok`: vế này KHÔNG chặn thread tự
/// đúc mang `did_commit` tự chọn (CONTRACT §5 D9).
pub fn attested_c1(
  credits: List<Pair<ByteArray, Int>>,
  did_commit: ByteArray,
) -> Int {
  list.foldl(
    credits,
    0,
    fn(c, acc) {
      let Pair(d, n) = c
      if d == did_commit {
        acc + n
      } else {
        acc
      }
    },
  )
}
