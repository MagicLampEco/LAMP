// Genesis split — chia tổng cung 36 tỷ tLAMP vào các pot theo bps (95/5).
// Pure Int/BigInt. Đơn vị oil (1 tLAMP = 10^6 oil). Mirror onchain split.ak.
//
// Bất biến lõi (G-SUM): Σ shares == total TUYỆT ĐỐI — KHÔNG rơi token lẻ.
// Cách: floor từng share rồi DỒN remainder vào pot ĐẦU (Distribution). Chứng minh
// remainder ≥ 0 (vì Σbps ≤ 10000 ⇒ assigned ≤ total) — xem SPEC §SPLIT.

export const OIL_PER_LAMP = 1_000_000n;

/** Tổng cung tLAMP (nguyên token) — fixed-supply 36 tỷ, BẤT BIẾN. */
export const TOTAL_SUPPLY_LAMP = 36_000_000_000n;

/** Tổng cung oil = 36e9 × 1e6. Mọi value on-chain tính bằng oil. */
export const TOTAL_SUPPLY_OIL = TOTAL_SUPPLY_LAMP * OIL_PER_LAMP;

export const BPS_DENOM = 10_000n;

/** Phân bổ genesis: chỉ Distribution + Reserve có value (team/community NẰM TRONG
 *  Distribution — LAMP-Distribution.md). Treasury + Deposits khởi tạo 0. */
export const DISTRIBUTION_BPS = 9_500n; // 95%
export const RESERVE_BPS      = 500n;   // 5%

/** Định danh pot (instance_id = NFT name on-chain). Hex ASCII 2 byte. */
export const POT_ID = {
  Distribution: "4452", // "DR"
  Reserve:      "5256", // "RV"
  Treasury:     "5452", // "TR"
  Deposits:     "4450", // "DP"
} as const;

export type PotName = keyof typeof POT_ID;

/** Một mục phân bổ: pot nhận `bps` phần-vạn của tổng. */
export interface Allocation {
  pot: PotName;
  bps: bigint;
}

/** Phân bổ genesis chuẩn MagicLamp (thứ tự QUAN TRỌNG: pot[0]=Distribution nhận remainder). */
export const GENESIS_ALLOCATION: Allocation[] = [
  { pot: "Distribution", bps: DISTRIBUTION_BPS },
  { pot: "Reserve",      bps: RESERVE_BPS },
];

/** Một pot sau khi chia: tên + value (oil). */
export interface PotShare {
  pot:   PotName;
  value: bigint; // oil
}

/**
 * Chia `total` (oil) theo `allocation` (bps). Floor từng share rồi dồn remainder
 * vào pot ĐẦU. Hậu điều kiện: Σ shares == total (G-SUM tuyệt đối).
 *
 * @throws nếu total < 0, bps âm, hoặc Σ bps > 10000 (phân bổ vượt 100%).
 */
export function splitGenesis(total: bigint, allocation: Allocation[]): PotShare[] {
  if (total < 0n) throw new Error("SPLIT-001: total < 0");
  if (allocation.length === 0) throw new Error("SPLIT-002: allocation rỗng");

  let bpsSum = 0n;
  for (const a of allocation) {
    if (a.bps < 0n) throw new Error(`SPLIT-003: bps âm cho pot ${a.pot}`);
    bpsSum += a.bps;
  }
  if (bpsSum > BPS_DENOM) {
    throw new Error(`SPLIT-004: Σ bps = ${bpsSum} > 10000 (phân bổ vượt 100%)`);
  }

  const shares: PotShare[] = allocation.map((a) => ({
    pot:   a.pot,
    value: (total * a.bps) / BPS_DENOM, // floor (BigInt trunc; total ≥ 0 ⇒ == floor)
  }));

  const assigned = shares.reduce((s, x) => s + x.value, 0n);
  const remainder = total - assigned; // ≥ 0 vì Σbps ≤ 10000 ⇒ assigned ≤ total
  // Dồn lẻ vào pot ĐẦU (Distribution) → Σ == total tuyệt đối.
  shares[0]!.value += remainder;

  return shares;
}

/**
 * Trả ĐẦY ĐỦ 4 pot (oil) cho genesis: Distribution + Reserve theo split, Treasury +
 * Deposits = 0. Σ 4 pot == total (G-SUM). Thứ tự cố định: D, R, T, Dep.
 */
export function genesisPots(total: bigint = TOTAL_SUPPLY_OIL): PotShare[] {
  const split = splitGenesis(total, GENESIS_ALLOCATION);
  const byName = new Map<PotName, bigint>(split.map((s) => [s.pot, s.value]));
  return [
    { pot: "Distribution", value: byName.get("Distribution") ?? 0n },
    { pot: "Reserve",      value: byName.get("Reserve") ?? 0n },
    { pot: "Treasury",     value: 0n },
    { pot: "Deposits",     value: 0n },
  ];
}

/** Σ value của danh sách pot (oil). */
export function sumPots(pots: PotShare[]): bigint {
  return pots.reduce((s, p) => s + p.value, 0n);
}
