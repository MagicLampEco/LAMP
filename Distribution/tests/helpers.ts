// Test helpers cho LampDistribution (Capped Drop).
// `D_GENESIS` là khái niệm CHẾT ở v3 — beacon không còn trường `drop_value`. Thay bằng
// `RATE_ROOT_GENESIS` (w), nguyên thuỷ của tốc độ tích luỹ.
export {
  OILDROP_PER_LAMP, RATE_ROOT_GENESIS, DEFAULT_DROPS_PER_EPOCH, TRIM_FLOOR,
  TRIM_NUM_GENESIS, TRIM_DEN_GENESIS,
} from "../offchain/src/constants.js";

/** LAMP → oildrop (1 LAMP = 10^6 oildrop). */
export function lampOildrop(lamp: bigint): bigint {
  return lamp * 1_000_000n;
}
