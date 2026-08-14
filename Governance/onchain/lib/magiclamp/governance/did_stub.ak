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

/// Committee đã ký đủ ngưỡng chưa. THAY `count_committee_sigs` cũ (trả Int, ngưỡng
/// kiểm ở call site và không ai kiểm cận).
///
/// Hai lỗ nó bỏ (issue #21 B1):
///   • `list.count(committee.signers, …)` đếm **phần tử danh sách**, không đếm
///     **người**: `[a1, a1, a2]` threshold 2 → riêng a1 ký là đủ.
///   • `threshold` không chặn cận: `threshold ≤ 0` thì 0 chữ ký cũng qua.
///
/// Ở đây nghiêm hơn ba module kia: hàm này gác cổng "1 DID = 1 người" của
/// governance. `DidCommittee` là param của `vote` validator (`vote.ak:73`) nên vẫn
/// là lỗi deploy chứ không phải datum bịa được — nhưng bất biến nó giữ thì cốt lõi.
/// Mẫu gốc: `Genesis/onchain/lib/magiclamp/genesis/registry.ak:96-101`.
fn committee_approved(
  committee: DidCommittee,
  signatories: List<ByteArray>,
) -> Bool {
  // chặn ExUnit DoS + bound chi phí list.unique (O(n²)).
  expect list.length(committee.signers) <= 16
  let uniq = list.unique(committee.signers)
  and {
    committee.threshold >= 1,
    committee.threshold <= list.length(uniq),
    list.count(uniq, fn(s) { list.has(signatories, s) }) >= committee.threshold,
  }
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
  committee_approved(committee, signatories)
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

// ── issue #21 B1 — dedupe + cận threshold ────────────────────

/// Committee trùng khoá KHÔNG được phá ngưỡng. `[a1, a1, a2]` threshold 2, chỉ a1
/// ký: bản cũ `list.count` ra 2 ⇒ pass ⇒ MỘT người tự thoả cổng "1 DID = 1 người".
test did_dup_key_cannot_meet_threshold() {
  let c = DidCommittee { signers: [#"a1", #"a1", #"a2"], threshold: 2 }
  !verify_did(c, #"deadbeef", [#"a1"])
}

/// Cùng committee đó, đủ hai người thật thì vẫn phải qua.
test did_dup_key_two_real_signers_pass() {
  let c = DidCommittee { signers: [#"a1", #"a1", #"a2"], threshold: 2 }
  verify_did(c, #"deadbeef", [#"a1", #"a2"])
}

/// threshold ≤ 0 thì KHÔNG chữ ký nào cũng qua ở bản cũ.
test did_threshold_zero_rejected() {
  let c = DidCommittee { signers: [#"a1", #"a2", #"a3"], threshold: 0 }
  !verify_did(c, #"deadbeef", [])
}

/// threshold vượt số NGƯỜI thật (sau dedupe) = khoá chết, chặn ngay lúc kiểm.
test did_threshold_above_unique_rejected() {
  let c = DidCommittee { signers: [#"a1", #"a1"], threshold: 2 }
  !verify_did(c, #"deadbeef", [#"a1"])
}

test did_verify_non_committee_sigs_ignored() fail {
  // chữ ký ngoài committee không tính → chỉ 1 hợp lệ < 2.
  expect verify_did(cmt(), #"deadbeef", [#"a1", #"ff", #"ee"])
  True
}
