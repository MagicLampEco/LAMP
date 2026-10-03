// Logic thuần cho NFT con trỏ governance (Treasury/GovernancePointer.md v0.1).
//
// Hai bên dùng:
//   • `validators/governance_pointer.ak` — gác chính UTxO con trỏ (đúc một lần, đổi theo luật).
//   • `validators/custody.ak` ▸ `Release`  — ĐỌC con trỏ qua reference input để biết governance
//     nào đang có quyền duyệt chi (`read_governance`).
//
// Policy id của NFT con trỏ == script hash của `governance_pointer` (validator hai mục đích
// `mint` + `spend`). Nhờ vậy custody không cần thêm tham số "hash script con trỏ": NFT thật
// chỉ tồn tại đúng một (one-shot theo hạt giống) và nhánh `spend` giữ nó ở địa chỉ
// `Script(policy)` mãi mãi ⇒ "token policy P nằm ở Script(P)" là định danh đủ, không vòng hash.

use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{InlineDatum, Input}
use magiclamp/treasury/types.{PointerDatum}

/// Tên asset của NFT con trỏ: "GOVPOINTER".
pub const pointer_name: ByteArray = "GOVPOINTER"

/// Trần cỡ committee — chặn chi phí `list.unique`/đếm chữ ký (O(n²)).
pub const max_committee: Int = 16

/// Hash proposal cam kết việc đổi con trỏ: blake2b_256(0x04 ‖ pointer_policy ‖ new_hash).
/// Domain tag 0x04 tách khỏi 0x03 của Release (`release.spend_spec_hash`): một proposal chi
/// tiền không bao giờ băm ra hash đổi con trỏ, và ngược lại. `pointer_policy` (28 byte) và
/// `new_hash` (28 byte) đều cố định độ dài ⇒ ghép không nhập nhằng biên byte.
pub fn pointer_spec_hash(pointer_policy: ByteArray, new_hash: ByteArray) -> ByteArray {
  crypto.blake2b_256(
    #"04"
      |> bytearray.concat(pointer_policy)
      |> bytearray.concat(new_hash),
  )
}

/// Committee hợp lệ lúc ĐÚC (sau đó mọi nhánh giữ nguyên committee/threshold):
/// khác rỗng, ≤ max_committee, mỗi khoá 28 byte, không trùng, 1 ≤ threshold ≤ |committee|.
pub fn committee_wellformed(committee: List<ByteArray>, threshold: Int) -> Bool {
  let n = list.length(committee)
  and {
    n >= 1,
    n <= max_committee,
    list.all(committee, fn(k) { bytearray.length(k) == 28 }),
    list.length(list.unique(committee)) == n,
    threshold >= 1,
    threshold <= n,
  }
}

/// Đủ `threshold` chữ ký từ committee. Committee không trùng (ép lúc đúc, giữ nguyên mọi
/// nhánh) nên đếm trực tiếp không bị một khoá trùng đếm hai lần; vẫn `unique` để hàm đúng
/// độc lập với giả định đó (khuôn `Distribution` ▸ `util.committee_approved`, B1 issue #21).
pub fn committee_approved(
  committee   : List<ByteArray>,
  threshold   : Int,
  signatories : List<ByteArray>,
) -> Bool {
  let uniq = list.unique(committee)
  and {
    threshold >= 1,
    threshold <= list.length(uniq),
    list.count(uniq, fn(k) { list.has(signatories, k) }) >= threshold,
  }
}

/// C-REL-PTR: đọc governance hiện hành từ NFT con trỏ qua REFERENCE INPUT.
///   (a) reference input mang ĐÚNG 1 token (pointer_policy, GOVPOINTER);
///   (b) nằm ở địa chỉ có payment credential `Script(pointer_policy)`;
///   (c) datum inline giải mã được thành `PointerDatum`;
///   (d) `governance_hash` dài 28 byte — con trỏ rỗng ⇒ Release bị từ chối.
/// Fail (expect) nếu thiếu / sai bất kỳ vế nào.
pub fn read_governance(
  reference_inputs : List<Input>,
  pointer_policy   : ByteArray,
) -> ByteArray {
  expect Some(ptr) =
    list.find(
      reference_inputs,
      fn(i) { assets.quantity_of(i.output.value, pointer_policy, pointer_name) == 1 },
    )
  expect Script(h) = ptr.output.address.payment_credential
  expect h == pointer_policy
  expect InlineDatum(d) = ptr.output.datum
  expect pd: PointerDatum = d
  expect bytearray.length(pd.governance_hash) == 28
  pd.governance_hash
}
