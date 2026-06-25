// Test helpers cho LampDistribution (Capped Drop).
export { OILDROP_PER_LAMP, D_GENESIS, DEFAULT_DROPS_PER_EPOCH } from "../offchain/src/constants.js";

/** LAMP → oildrop (1 LAMP = 10^6 oildrop). */
export function lampOildrop(lamp: bigint): bigint {
  return lamp * 1_000_000n;
}
