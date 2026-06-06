// Test helpers cho LampDistribution (Capped Drop).
export { OIL_PER_LAMP, D_GENESIS, DEFAULT_DROPS_PER_EPOCH } from "../offchain/src/constants.js";

/** LAMP → oil (1 LAMP = 10^6 oil). */
export function lampOil(lamp: bigint): bigint {
  return lamp * 1_000_000n;
}
