// Test helpers cho LAMP Tokenomics (Capped Drop · hard-cap kênh).
export { OIL_PER_LAMP, DEFAULT_DROPS_PER_EPOCH, DEFAULT_MIN_ADA } from "../offchain/src/constants.js";

/** LAMP → oil (1 LAMP = 10^6 oil). */
export function lampOil(lamp: bigint): bigint {
  return lamp * 1_000_000n;
}

/** "TEAM" hex. */
export const CHANNEL_TEAM = "5445414d";
/** "RESERVE\0" hex (8 byte như onchain const). */
export const CHANNEL_RESERVE = "5245534552564500";
