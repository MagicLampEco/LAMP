// LampDistribution committee helpers — M-of-N native multisig (SPEC §5/§7).
//
// COMMITTEE_THRESHOLD = ⌈2N/3⌉ (Byzantine 2/3). Dùng cho Claim + mọi beacon post
// + treasury release. Redeem KHÔNG cần committee (chỉ owner sign).

/** Cận trên số thành viên — khớp `committee_approved` (util.ak: bound list.unique O(n²)). */
export const COMMITTEE_MAX = 16;

/**
 * Ép committee ĐÚNG hình dạng mà `committee_approved` on-chain chấp nhận, TRƯỚC khi
 * nó bị bake vào param validator.
 *
 * Vì sao gác ở đây chứ không chỉ tin script deploy: committee + threshold là
 * apply-param, nên chúng nằm TRONG script hash của claim_account / treasury /
 * claim_account_nft. Lệch một cận là bake ra 3 hash mà không bộ chữ ký nào thoả —
 * phát hiện được thì LAMP đã nằm trong kho, và không có đường đúc lại.
 */
export function assertCommitteeShape(committeeKeyHashes: string[]): void {
  if (committeeKeyHashes.length === 0) {
    throw new Error("COMMITTEE-001: committeeKeyHashes must be non-empty");
  }
  const uniq = new Set(committeeKeyHashes).size;
  if (uniq !== committeeKeyHashes.length) {
    throw new Error(
      `COMMITTEE-004: committee có keyhash TRÙNG (${committeeKeyHashes.length} mục, ` +
      `${uniq} người). On-chain đếm theo NGƯỜI (list.unique), nên threshold hợp lệ ` +
      `theo số mục có thể vượt số người thật ⇒ không bao giờ đủ chữ ký.`,
    );
  }
  if (committeeKeyHashes.length > COMMITTEE_MAX) {
    throw new Error(
      `COMMITTEE-005: committee ${committeeKeyHashes.length} thành viên, tối đa ` +
      `${COMMITTEE_MAX}. Quá cap thì committee_approved trả False ⇒ mọi đường ` +
      `committee (Claim / beacon post / treasury release) fail vĩnh viễn.`,
    );
  }
}

/** ⌈2N/3⌉ — số chữ ký committee tối thiểu cho Byzantine 2/3. */
export function committeeThreshold(committeeSize: number): number {
  if (committeeSize <= 0) throw new Error("COMMITTEE-000: committeeSize must be > 0");
  return Math.ceil((2 * committeeSize) / 3);
}

/**
 * Kiểm tra subset signer có đạt threshold không + mọi signer thuộc committee.
 * Trả về threshold đã dùng (để log).
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
  // (util.ak: list.count(list.unique(committee), …)). Đếm theo mục thì
  // committee `[c1,c1,c2]` hoặc signer `[c1,c1]` qua được ở đây rồi fail phase-2,
  // tức cháy collateral thay vì lỗi pre-flight sạch.
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
