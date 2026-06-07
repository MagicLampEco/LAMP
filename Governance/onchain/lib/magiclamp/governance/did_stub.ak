// DID verifier STUB (committee multisig) — để build/test KHÔNG chờ PhoenixKey.
//
// CONTRACT §3 + TECH §7: DID sinh trắc + zk-proof "1 DID = 1 người" thuộc backend
// PhoenixKey, NGOÀI repo LAMP (Claude KHÔNG sửa), là BLOCKER tiên quyết. Governance
// chỉ TIÊU THỤ proof. TECH §7.1 chốt v1 dùng cách (b) registry pattern: PhoenixKey
// duy trì on-chain registry các did_commit đã chứng thực (committee ký), Vote chỉ
// đọc + kiểm membership rẻ.
//
// STUB v1: thay verifier zk-SNARK thật bằng COMMITTEE MULTISIG — proof hợp lệ khi
// có ≥ threshold chữ ký committee trong tx.extra_signatories. Khi PhoenixKey chốt
// định dạng proof thật → thay thân hàm này, GIỮ NGUYÊN signature (verify_did) để
// validator phụ thuộc không đổi. Đây là ranh giới sạch: stub ↔ thật cùng interface.

use aiken/collection/list

/// Committee verifier params — tham số hóa vào Vote validator (như TECH §1: validator
/// biết hash/khóa các thực thể liên quan).
pub type DidCommittee {
  signers: List<ByteArray>,
  // pubkey hash các thành viên committee PhoenixKey
  threshold: Int,
}

// số chữ ký tối thiểu (M-of-N)

/// Đếm số signer committee có mặt trong extra_signatories của tx.
fn count_committee_sigs(
  committee: DidCommittee,
  signatories: List<ByteArray>,
) -> Int {
  list.count(committee.signers, fn(s) { list.has(signatories, s) })
}

/// verify_did — STUB: did_commit "được chứng thực" khi committee ký đủ threshold.
/// signature ỔN ĐỊNH: (committee, did_commit, signatories) → Bool. PhoenixKey thật
/// sau này verify zk-proof gắn did_commit; v1 verify multisig.
///
/// Lưu ý: stub KHÔNG ràng buộc chữ ký theo did_commit cụ thể (committee ký nguyên tx).
/// Đây là chủ đích cho v1 test — chống-mượn-DID thật thực thi bằng (b) registry khi
/// PhoenixKey sẵn sàng. Đánh dấu rõ ở báo cáo cho audit soi.
pub fn verify_did(
  committee: DidCommittee,
  _did_commit: ByteArray,
  signatories: List<ByteArray>,
) -> Bool {
  count_committee_sigs(committee, signatories) >= committee.threshold
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

fn cmt() -> DidCommittee {
  DidCommittee { signers: [#"a1", #"a2", #"a3"], threshold: 2 }
}

test did_verify_enough_sigs() {
  verify_did(cmt(), #"deadbeef", [#"a1", #"a2"])
}

test did_verify_threshold_exact() {
  verify_did(cmt(), #"deadbeef", [#"a3", #"a1"])
}

test did_verify_too_few_sigs() fail {
  expect verify_did(cmt(), #"deadbeef", [#"a1"])
  True
}

test did_verify_non_committee_sigs_ignored() fail {
  // chữ ký ngoài committee không tính → chỉ 1 hợp lệ < 2.
  expect verify_did(cmt(), #"deadbeef", [#"a1", #"ff", #"ee"])
  True
}
