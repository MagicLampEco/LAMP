// LAMP Allocation constants — mirror onchain (oil units). ALL arithmetic BigInt.

/** oil mỗi LAMP. 1 LAMP = 10^6 oil. */
export const OIL_PER_LAMP = 1_000_000n;

/** LAMP asset-name mặc định — "LAMP" (hex). */
export const LAMP_NAME = "4c414d50";

/** drops_per_epoch mặc định cho account mới (datum field; DAO override per-DID v.sau). */
export const DEFAULT_DROPS_PER_EPOCH = 1n;

/** min-ADA mặc định cho mỗi script UTxO (ClaimAccount / ChannelBudget / Treasury). */
export const DEFAULT_MIN_ADA = 2_000_000n;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}
