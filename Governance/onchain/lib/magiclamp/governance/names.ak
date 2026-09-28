// Tên tài sản canonical của đường biểu quyết — MỘT nguồn cho cả `nullifier`,
// `vote` và `tally`.
//
// Vì sao tách ra: v1 có HAI bản `nullifier_name` (một ở `validators/nullifier.ak`,
// một ở `validators/vote.ak`). Hai bản sao của cùng một công thức băm là đúng lớp
// bản-sao-chết-im-lặng: sửa một bên thì bên kia vẫn biên dịch, vẫn xanh, và hai
// validator hiểu khác nhau về cùng một token.

use aiken/cbor
use aiken/crypto
use aiken/primitive/bytearray
use cardano/transaction.{OutputReference}

/// `proposal_id = H(seed)` — danh tính một proposal, và ĐỒNG THỜI tên tài sản của
/// cả hai token của nó: `(governance_policy, proposal_id)` và
/// `(tally_policy, proposal_id)`.
///
/// Vì sao một hàm dùng chung: hai policy ĐỘC LẬP (không policy nào nhận hash của
/// policy kia làm tham số — đó là cách tránh vòng phụ thuộc, `SPEC.md` §v2.4)
/// phải suy ra CÙNG một tên từ CÙNG một hạt giống. Hai bản sao của công thức này
/// sẽ biên dịch được, chạy xanh, và sinh hai tên khác nhau ⇒ giao dịch Open không
/// bao giờ dựng nổi mà không dòng nào nói vì sao.
///
/// `seed` là một `OutputReference`, tiêu được ĐÚNG MỘT LẦN trong cả lịch sử chuỗi
/// ⇒ `proposal_id` duy nhất trong cả đời một pha, không cần sổ tên nào.
pub fn proposal_id_of(seed: OutputReference) -> ByteArray {
  crypto.blake2b_256(cbor.serialise(seed))
}

/// name nullifier = blake2b_256(did_commit ‖ proposal_id).
///
/// Token này KHÔNG mang tính duy nhất (token cùng `(policy, name)` là đồng nhất);
/// nó chỉ buộc một UTxO phiếu vào đúng một cặp `(DID, proposal)`. Tính "mỗi DID
/// đếm tối đa một lần" nằm ở sổ MPF `TallyDatum.voted_root`.
pub fn nullifier_name(
  did_commit: ByteArray,
  proposal_id: ByteArray,
) -> ByteArray {
  crypto.blake2b_256(bytearray.concat(did_commit, proposal_id))
}

test nl_name_on_dinh() {
  // Neo giá trị: đổi công thức băm là đổi mọi token đã đúc.
  nullifier_name(#"11", #"22") == #"bb946cc46da7b64b2a76e743f2de7f1a2054fea3652b4670023024776b4878b7"
}

test nl_name_phan_biet_proposal() {
  nullifier_name(#"11", #"22") != nullifier_name(#"11", #"23")
}

test nl_name_phan_biet_did() {
  nullifier_name(#"11", #"22") != nullifier_name(#"12", #"22")
}

/// Ghép chuỗi KHÔNG có dấu phân cách, nên phải kiểm rằng hai cách cắt khác nhau
/// của cùng một chuỗi byte không cho cùng tên — nếu cho, một DID dài hơn đúc
/// được nullifier của một cặp (DID, proposal) khác.
test nl_name_ghep_khong_nhap_nhang_la_gia_dinh_can_biet() {
  // ĐÂY LÀ MỘT HỞ ĐÃ BIẾT, không phải một bảo đảm: `H(a‖b)` nhập nhằng theo cách
  // cắt. Nó vô hại vì `did_commit` luôn là tên một token TAAD 32 byte và
  // `proposal_id` luôn là `H(seed)` 32 byte — hai độ dài CỐ ĐỊNH, nên chỉ có một
  // cách cắt. Ca này ghim chính điều kiện đó: hai cặp có cùng chuỗi ghép mà khác
  // cách cắt ra CÙNG tên.
  nullifier_name(#"1122", #"33") == nullifier_name(#"11", #"2233")
}
