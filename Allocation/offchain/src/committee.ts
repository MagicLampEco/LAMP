// LAMP Allocation committee helpers — M-of-N native multisig.
//
// Claim (cấp entitlement) + ChannelBudget Decrement đều đòi ≥ threshold chữ ký committee
// (claim_account.ak + channel_budget.ak: util.committee_approved(committee, threshold, sigs)).
// Redeem KHÔNG cần committee (chỉ owner sign — permissionless).
//
// threshold là THAM SỐ COMPILE-TIME của validator (committee.ak bake List + threshold).
// Default gợi ý = ⌈2N/3⌉ (Byzantine 2/3) — caller override khi validator dùng giá trị khác.

/** ⌈2N/3⌉ — số chữ ký committee tối thiểu cho Byzantine 2/3 (default gợi ý). */
export function committeeThreshold(committeeSize: number): number {
  if (committeeSize <= 0) throw new Error("COMMITTEE-000: committeeSize must be > 0");
  return Math.ceil((2 * committeeSize) / 3);
}

/**
 * Kiểm tra subset signer đạt threshold + mọi signer thuộc committee. Trả threshold đã dùng.
 * threshold KHÔNG truyền → ⌈2N/3⌉ (chỉ tiện cho test; live phải truyền đúng param validator).
 */
export function assertCommitteeSigners(
  committeeKeyHashes: string[],
  signerKeyHashes:    string[],
  threshold?:         number,
): number {
  if (committeeKeyHashes.length === 0) {
    throw new Error("COMMITTEE-001: committeeKeyHashes must be non-empty");
  }
  // Đếm theo NGƯỜI, không theo mục — khớp `committee_approved` on-chain
  // (util.ak: list.count(list.unique(committee), …)). Đếm theo mục thì committee
  // `[c1,c1,c2]` hoặc signer `[c1,c1]` qua được ở đây rồi fail phase-2, tức cháy
  // collateral thay vì lỗi pre-flight sạch.
  // (Vòng lặp COMMITTEE-003 bên dưới ép mọi signer ∈ committee, nên đếm signer
  // duy nhất ở đây là đúng bằng phép đếm on-chain.)
  const uniqCommittee = new Set(committeeKeyHashes).size;
  const uniqSigners = new Set(signerKeyHashes).size;
  const th = threshold ?? committeeThreshold(uniqCommittee);
  if (uniqSigners < th) {
    throw new Error(`COMMITTEE-002: need ≥ ${th} signers, got ${uniqSigners}`);
  }
  for (const s of signerKeyHashes) {
    if (!committeeKeyHashes.includes(s)) {
      throw new Error(`COMMITTEE-003: signer ${s} not in committee set`);
    }
  }
  return th;
}
