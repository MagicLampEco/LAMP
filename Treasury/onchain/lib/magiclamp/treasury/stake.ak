// Logic thuần cho STAKE CREDENTIAL của kho custody (S-STK-*).
// Tách khỏi validator để test đơn vị + giữ validator mỏng (mirror collect.ak/migrate.ak).
//
// BỐI CẢNH: địa chỉ kho = (payment: Script(custody_hash), stake: Script(treasury_stake)).
// Phần thưởng uỷ quyền của TOÀN BỘ ADA trong kho dồn về reward-account của stake
// credential này. Ai cũng dựng được giao dịch rút (`withdraw` là permissionless theo
// thiết kế ledger — không có chữ ký nào bảo vệ reward-account), nên thứ duy nhất giữ
// được tiền là ĐÍCH RÚT bị khoá trong chính script.
//
// Bất biến ÉP (điểm gọi ở `validators/treasury_stake.ak`):
//   S-STK-ACC   account đang rút phải có mặt trong tx.withdrawals        → `account_is_withdrawing`
//   S-STK-DEST  đích rút = `reward_cred`, không cred nào khác            → `lovelace_to_cred`
//   S-STK-NET   ép NET (Σ out→đích − Σ in-từ-đích), KHÔNG ép GROSS       → `net_to_cred`
//   S-STK-SUM   ép Σ MỌI withdrawal của tx, không chỉ phần của account   → `sum_withdrawals`
//   S-STK-CERT-DEREG  cấm tuyệt đối deregister                           → `certificate_ok`
//   S-STK-CERT-SIG    register/delegate đòi chữ ký admin                 → `certificate_ok`

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Credential}
use cardano/assets.{lovelace_of}
use cardano/certificate.{
  Certificate, DelegateCredential, RegisterAndDelegateCredential,
  RegisterCredential, UnregisterCredential,
}
use cardano/transaction.{Input, Output}

// ── S-STK-DEST: Σ lovelace mọi OUTPUT tới đích rút ──

/// Σ lovelace của mọi output có payment_credential == `cred`.
/// So theo PAYMENT credential (không so full address) — cùng lý do với
/// `util.count_outputs_at_script`: stake credential của đích là thứ người dựng tx đặt
/// tự do, ràng vào full address chỉ làm giao dịch hợp lệ bị từ chối mà không chặn thêm
/// được đường rò nào.
pub fn lovelace_to_cred(outputs: List<Output>, cred: Credential) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address.payment_credential == cred {
        acc + lovelace_of(o.value)
      } else {
        acc
      }
    },
  )
}

/// Σ lovelace của mọi INPUT đến TỪ `cred`.
pub fn lovelace_from_cred(inputs: List<Input>, cred: Credential) -> Int {
  list.foldl(
    inputs,
    0,
    fn(i, acc) {
      if i.output.address.payment_credential == cred {
        acc + lovelace_of(i.output.value)
      } else {
        acc
      }
    },
  )
}

/// S-STK-NET: lượng ADA đích THỰC SỰ nhận thêm = Σ out→đích − Σ in-từ-đích.
///
/// VÌ SAO KHÔNG ĐƯỢC ÉP GROSS (chỉ đếm output): người crank tự chọn input của tx. Chỉ
/// cần đồng-tiêu một UTxO đang nằm sẵn ở đích rồi trả nó về nguyên vẹn là GROSS đã thoả
/// mà đích không nhận thêm đồng nào — phần thưởng đi thẳng vào output change của người
/// crank. Trừ input-từ-đích ép phần TĂNG RÒNG.
pub fn net_to_cred(
  inputs  : List<Input>,
  outputs : List<Output>,
  cred    : Credential,
) -> Int {
  lovelace_to_cred(outputs, cred) - lovelace_from_cred(inputs, cred)
}

// ── S-STK-SUM: Σ MỌI withdrawal trong tx ──

/// Σ lovelace của MỌI withdrawal trong tx.
///
/// VÌ SAO KHÔNG CHỈ ĐẾM PHẦN CỦA `account` NÀY: một tx gộp N reward-account cùng rút chỉ
/// chạy validator một lần cho mỗi account, và mỗi lần đó chỉ nhìn thấy phần của mình.
/// Ép theo phần riêng ⇒ đích chỉ cần nhận đúng MAX thay vì TỔNG, phần chênh rò về change.
/// Ép theo tổng là bảo thủ: tx trộn withdrawal ngoài kho cũng bị đòi nộp về đích nên sẽ
/// bị từ chối — over-require chỉ gây REJECT, không gây mất tiền.
pub fn sum_withdrawals(withdrawals: Pairs<Credential, Int>) -> Int {
  list.foldl(withdrawals, 0, fn(p, acc) { acc + p.2nd })
}

// ── S-STK-ACC ──

/// Credential đang chạy handler phải thật sự nằm trong danh sách withdrawal của tx.
pub fn account_is_withdrawing(
  withdrawals : Pairs<Credential, Int>,
  account     : Credential,
) -> Bool {
  when pairs.get_first(withdrawals, account) is {
    Some(_) -> True
    None -> False
  }
}

// ── Gộp: điều kiện của nhánh `withdraw` ──

/// S-STK-ACC ∧ S-STK-DEST ∧ S-STK-NET ∧ S-STK-SUM.
pub fn withdraw_ok(
  inputs      : List<Input>,
  outputs     : List<Output>,
  withdrawals : Pairs<Credential, Int>,
  account     : Credential,
  reward_cred : Credential,
) -> Bool {
  account_is_withdrawing(withdrawals, account) && net_to_cred(
    inputs,
    outputs,
    reward_cred,
  ) >= sum_withdrawals(withdrawals)
}

// ── S-STK-CERT-*: certificate ──

pub fn admin_signed(
  extra_signatories : List<VerificationKeyHash>,
  admin             : VerificationKeyHash,
) -> Bool {
  list.has(extra_signatories, admin)
}

/// Danh sách TRẮNG certificate, fail-closed.
///
/// S-STK-CERT-DEREG — `UnregisterCredential` bị cấm TUYỆT ĐỐI, kể cả có chữ ký admin.
///   Conway hoàn stake-deposit vào value-pool của tx. Handler `withdraw` chỉ ép được
///   phần ADA tương ứng Σ withdrawals; khoản hoàn deposit không nằm trong đó nên nó
///   chảy thẳng vào output change của người dựng tx. Cấm ở đây rẻ hơn mọi cách đếm.
///
/// S-STK-CERT-SIG — register/delegate đòi chữ ký `delegation_admin`.
///   Đây là chỗ Treasury PHẢI chặt hơn bản tham chiếu SRCL (ở SRCL ai cũng delegate được
///   vì vốn gốc là của chính người dùng). Kho Treasury giữ ADA của DAO: để delegate
///   permissionless thì bất kỳ ai cũng trỏ toàn bộ stake của kho sang pool của mình —
///   thưởng vẫn bị `withdraw` ép về đích, nhưng kẻ tấn công ăn margin pool, và trỏ vào
///   pool không sản xuất block là kho mất sạch thưởng với chi phí một phí tx.
///
/// Mọi certificate khác (DRep, stake pool, uỷ ban hiến pháp) → False: stake credential
/// của một cái kho không có việc gì với các vai đó, và nới ra thì phải chứng minh từng
/// cái vô hại.
///
/// GHI CHÚ TRUNG THỰC về S-STK-CERT-DEREG (đo bằng đột biến, không phải phỏng đoán):
/// gỡ HẲN dòng `UnregisterCredential { .. } -> False` thì 207/207 bài vẫn XANH, vì nhánh
/// `_ -> False` bắt luôn nó. Dòng ấy do đó KHÔNG mua thêm hành vi nào — nó mua việc lệnh
/// cấm đọc được ngay tại chỗ, và mua bảo hiểm cho lần ai đó đổi `_ -> False` thành
/// `_ -> admin_signed(..)`. Phép đo có nghĩa cho chốt này là đột biến "coi deregister như
/// một cert được phép khi có chữ ký", và phép đo đó làm đỏ đúng một bài:
/// `n10_deregister_even_signed_rejected`.
pub fn certificate_ok(
  certificate       : Certificate,
  extra_signatories : List<VerificationKeyHash>,
  admin             : VerificationKeyHash,
) -> Bool {
  when certificate is {
    UnregisterCredential { .. } -> False
    RegisterCredential { .. } -> admin_signed(extra_signatories, admin)
    DelegateCredential { .. } -> admin_signed(extra_signatories, admin)
    RegisterAndDelegateCredential { .. } -> admin_signed(extra_signatories, admin)
    _ -> False
  }
}
