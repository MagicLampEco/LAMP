// Reserve RELEASE math — P8 BIT-IDENTICAL mirror của onchain/lib/magiclamp/reserve/release.ak.
//
// Hàm nhả tự động 2 tầng:
//   Tầng 1 cap_release(epoch): trần tích lũy tất định, đơn điệu, lãi kép rời rạc g/năm.
//   Tầng 2 demand_allowance: velocity LAMP CHỈ làm chậm nhả trong [floor·cap, cap].
//   approved_cumulative = min(cap_release, demand_allowance) ≤ cap_release LUÔN.
//
// BigInt mọi nơi. Phép chia BigInt của JS = floor về 0 cho số dương → khớp Aiken `/`
// (Aiken Int division cũng floor-toward-zero). Mọi input ở đây ≥ 0 nên floor = trunc.

import { BPS_DENOM } from "./constants.js";

export function clamp(x: bigint, lo: bigint, hi: bigint): bigint {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function min2(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * year_cap(y) = R0 · (10000+g)^y / 10000^y, tính LẶP floor-mỗi-bước (khớp Aiken).
 *   c_0 = R0 ; c_{k+1} = ⌊ c_k · (10000+g) / 10000 ⌋
 */
export function yearCap(base: bigint, growthBps: bigint, years: bigint): bigint {
  if (years < 0n) throw new Error("REL-000: years must be ≥ 0");
  let acc = base;
  for (let k = 0n; k < years; k++) {
    acc = (acc * (BPS_DENOM + growthBps)) / BPS_DENOM;
  }
  return acc;
}

/**
 * cap_release(epoch) — trần tích lũy tất định. e<0 → 0. Nội suy tuyến tính trong năm.
 */
export function capRelease(
  epoch: bigint,
  genesisReleaseEpoch: bigint,
  base: bigint,
  growthBps: bigint,
  epochsPerYear: bigint,
  reserveCap: bigint,
): bigint {
  const e = epoch - genesisReleaseEpoch;
  if (e < 0n) return 0n;
  const y = e / epochsPerYear;
  const f = e % epochsPerYear;
  const capY = yearCap(base, growthBps, y);
  const capY1 = yearCap(base, growthBps, y + 1n);
  const interp = capY + ((capY1 - capY) * f) / epochsPerYear;
  return min2(reserveCap, interp);
}

/**
 * max_draw_per_epoch(epoch) = cap_release(epoch) − cap_release(epoch−1) (≥ 0).
 */
export function maxDrawPerEpoch(
  epoch: bigint,
  genesisReleaseEpoch: bigint,
  base: bigint,
  growthBps: bigint,
  epochsPerYear: bigint,
  reserveCap: bigint,
): bigint {
  const cur = capRelease(epoch, genesisReleaseEpoch, base, growthBps, epochsPerYear, reserveCap);
  const prev = capRelease(epoch - 1n, genesisReleaseEpoch, base, growthBps, epochsPerYear, reserveCap);
  const d = cur - prev;
  return d < 0n ? 0n : d;
}

/**
 * demand_allowance = cap · clamp(sma_ratio, floor, 10000) / 10000.
 * velocityPresent=false → bypass MVP (trả cap_release, tầng 1 thuần).
 */
export function demandAllowance(
  capReleaseVal: bigint,
  velocityPresent: boolean,
  smaRatioBps: bigint,
  demandFloorBps: bigint,
): bigint {
  if (!velocityPresent) return capReleaseVal;
  const ratio = clamp(smaRatioBps, demandFloorBps, BPS_DENOM);
  return (capReleaseVal * ratio) / BPS_DENOM;
}

/**
 * approved_cumulative(epoch) = min(cap_release, demand_allowance).
 * Trần cứng cap_release LUÔN thắng.
 */
export function approvedCumulative(
  epoch: bigint,
  genesisReleaseEpoch: bigint,
  base: bigint,
  growthBps: bigint,
  epochsPerYear: bigint,
  reserveCap: bigint,
  velocityPresent: boolean,
  smaRatioBps: bigint,
  demandFloorBps: bigint,
): bigint {
  const cap = capRelease(epoch, genesisReleaseEpoch, base, growthBps, epochsPerYear, reserveCap);
  const dem = demandAllowance(cap, velocityPresent, smaRatioBps, demandFloorBps);
  return min2(cap, dem);
}

/**
 * Số năm để cap_release chạm reserve_cap (cạn Reserve). null nếu growth=0 & base<cap.
 * Tiện tính minh hoạ ("Reserve cạn trong ~N năm").
 */
export function yearsToCap(
  base: bigint,
  growthBps: bigint,
  reserveCap: bigint,
): bigint | null {
  if (base >= reserveCap) return 0n;
  if (growthBps <= 0n) return null;
  let y = 0n;
  let c = base;
  while (c < reserveCap) {
    c = (c * (BPS_DENOM + growthBps)) / BPS_DENOM;
    y++;
    if (y > 100_000n) return null; // safety
  }
  return y;
}
