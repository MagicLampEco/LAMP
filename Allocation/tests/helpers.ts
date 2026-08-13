// Test helpers cho LAMP Allocation (Capped Drop · hard-cap kênh).
export { OILDROP_PER_LAMP, DEFAULT_DROPS_PER_EPOCH, DEFAULT_MIN_ADA } from "../offchain/src/constants.js";

/** LAMP → oildrop (1 LAMP = 10^6 oildrop). */
export function lampOildrop(lamp: bigint): bigint {
  return lamp * 1_000_000n;
}

/** "TEAM" hex. */
export const CHANNEL_TEAM = "5445414d";
/** "RESERVE\0" hex (8 byte như onchain const). */
export const CHANNEL_RESERVE = "5245534552564500";
