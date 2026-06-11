// Reserve constants (TS mirror of onchain/lib/magiclamp/reserve/constants.ak).
// BigInt mọi amount. Đơn vị oil (1 LAMP = 10^6 oil).

export const OIL_PER_LAMP = 1_000_000n;

/** asset name tLAMP = "tLAMP" (hex). */
export const TLAMP_NAME_HEX = "744c414d50";
/** asset name SUPPLY thread NFT (hex). */
export const SUPPLY_NAME_HEX = "535550504c59";

export const DIST_CAP_OIL    = 34_200_000_000_000_000n; // 95% mặc định
export const RESERVE_CAP_OIL =  1_800_000_000_000_000n; // 5% mặc định
export const TOTAL_CAP_OIL   = 36_000_000_000_000_000n;

export const BPS_DENOM = 10_000n;

// ── Tham số khởi điểm nhỏ giọt (đề xuất, set vào ReservePolicy datum) ──
export const DEFAULT_RELEASE_BASE_OIL = 2_000_000_000_000n; // 2 triệu LAMP/năm 0 (council)
export const DEFAULT_GROWTH_BPS       = 300n;               // 3%/năm (council)
export const DEFAULT_EPOCHS_PER_YEAR  = 73n;
export const DEFAULT_DEMAND_FLOOR_BPS = 2_000n;             // 20%
export const DEFAULT_VELOCITY_WINDOW  = 12n;

export const MIN_GROWTH_BPS = 300n;
export const MAX_GROWTH_BPS = 500n;
