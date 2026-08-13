// TIGER offchain types.

/** 1 dòng snapshot stake delegator của 1 epoch (nguồn: Blockfrost/Koios stake API).
 *  owner = payment-credential hash (pkh hex) của ví NHẬN LAMP — resolve stake_address
 *  → payment cred do off-chain quyết (chính sách SPO), KHÔNG nằm trong contract. */
export interface StakeEntry {
  /** payment-credential hash (pkh hex) — đích nhận LAMP. */
  owner: string;
  /** stake (lovelace) ví ủy thác trong epoch của snapshot này. */
  stake: bigint;
}

/** Tập snapshot trước cutoff: mỗi phần tử = danh sách stake của 1 epoch.
 *  Thứ tự không quan trọng cho tích lũy (chỉ cộng tổng). */
export type SnapshotSet = StakeEntry[][];

/** Kết quả entitlement 1 ví: E_i (oildrop) sau khi cộng dồn stake + áp cap. */
export interface TigerEntitlement {
  /** payment-credential hash (pkh hex). */
  owner: string;
  /** Tổng stake tích lũy qua mọi snapshot (lovelace·epoch) — minh bạch kiểm toán. */
  accStake: bigint;
  /** Entitlement cuối (oildrop LAMP). */
  amount: bigint;
  /** true nếu E_i bị cap chạm trần (cap/ví). */
  capped: boolean;
}

/** Tham số sinh entitlement. */
export interface EntitlementParams {
  /** Ngân sách pot (oildrop). Mặc định TIGER_TOTAL_OILDROP. */
  budgetOildrop: bigint;
  /** Trần mỗi ví (oildrop). null = không cap. */
  capOildrop: bigint | null;
  /** Ví bị loại (self-dealing: sáng lập/đối tác). pkh hex, so khớp chính xác. */
  excluded: Set<string>;
}

/** Datum ClaimAccount (mirror Distribution types.ClaimAccountDatum). Mọi field oildrop/epoch. */
export interface ClaimAccountDatum {
  owner: string;
  entitlement: bigint;
  redeemed: bigint;
  start_epoch: bigint;
  drops_per_epoch: bigint;
}
