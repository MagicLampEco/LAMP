// LAMP Allocation committee helpers — M-of-N native multisig.
//
// Claim (cấp entitlement) + ChannelBudget Decrement đều đòi ≥ threshold chữ ký committee
// (claim_account.ak + channel_budget.ak: count_committee_sigs ≥ threshold).
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
  const th = threshold ?? committeeThreshold(committeeKeyHashes.length);
  if (signerKeyHashes.length < th) {
    throw new Error(`COMMITTEE-002: need ≥ ${th} signers, got ${signerKeyHashes.length}`);
  }
  for (const s of signerKeyHashes) {
    if (!committeeKeyHashes.includes(s)) {
      throw new Error(`COMMITTEE-003: signer ${s} not in committee set`);
    }
  }
  return th;
}
