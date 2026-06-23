// ISPO offchain types (§6.3). LAMP = oil; ADA contribution = lovelace.

/** Cấu hình pool (spo_registry NFT): SPO tự đặt bonus-rate. */
export interface PoolConfig {
  poolId: string;
  /** payment-credential hash (pkh hex) ví nhận LAMP của SPO (= owner leaf bonus). */
  spoRewardOwner: string;
  /** bonus rate (basis points, 0..MAX_RATE_BP). SPO tự đặt. */
  bonusRateBp: bigint;
  /** rate chỉ HIỆU LỰC từ epoch này (đã qua cooldown — chống bait-and-switch). */
  rateEffectiveFromEpoch: bigint;
}

/** 1 lần delegator redirect reward-ADA vào pot (đo on-chain qua ispo_pot). */
export interface Contribution {
  /** payment-credential hash (pkh hex) — đích nhận LAMP. */
  owner: string;
  poolId: string;
  /** ADA reward đã redirect (lovelace). */
  contributedLovelace: bigint;
  /** epoch GÓP — chỉ tính cho phân phối epoch > epoch này (chống front-run snapshot). */
  epoch: bigint;
}

/** Tham số phân phối 1 epoch. */
export interface DistributeParams {
  /** LAMP_e — ngân sách epoch (oil). Mặc định PER_EPOCH_OIL. */
  perEpochOil: bigint;
  /** Trần ADA góp mỗi delegator/pool (lovelace) — chống whale méo. null = không cap. */
  maxContribLovelace: bigint | null;
}

/** Entitlement 1 owner trong 1 epoch (gộp vai trò delegator + SPO bonus nếu trùng ví). */
export interface IspoEntitlement {
  owner: string;
  /** Phân bổ epoch NÀY (oil). */
  wonThisEpoch: bigint;
  /** Cộng dồn qua mọi epoch ≤ hiện tại (oil) — giá trị leaf Merkle. */
  wonCumulative: bigint;
}

export interface DistributeResult {
  entitlements: IspoEntitlement[];
  /** oil không phân bổ (Σ_all == 0 epoch đó) — về treasury. */
  leftover: bigint;
  distributed: bigint;
}
