// ISPO constants — pot "ISPO redirect" (LAMP-DISTRIBUTION-SPEC §6.3).
//
// Tổng 360.000 nghìn LAMP = 360.000.000 LAMP, phát 36 epoch × 10.000 nghìn/epoch.
// Delegator tự nguyện redirect %reward-ADA (Franken) đổi LAMP; chủ repo thu ADA.
// DECOUPLED: tỉ lệ chỉ phụ thuộc TỔNG ADA mỗi pool đã góp; SPO là người NHẬN, không gác cổng.
//
// Mọi tiền LAMP = oil (1 LAMP = 10^6 oil); ADA = lovelace. BigInt tuyệt đối (C-OVERFLOW).

/** 1 LAMP = 10^6 oil. */
export const OIL_PER_LAMP = 1_000_000n;

/** 1 "nghìn LAMP" = 1.000 LAMP. */
export const LAMP_PER_THOUSAND = 1_000n;

/** Tổng pot = 360.000 nghìn LAMP = 360.000.000 LAMP. */
export const ISPO_TOTAL_LAMP = 360_000n * LAMP_PER_THOUSAND; // 360_000_000
export const ISPO_TOTAL_OIL = ISPO_TOTAL_LAMP * OIL_PER_LAMP;

/** Số epoch phát (36). */
export const ISPO_EPOCHS = 36n;

/** Ngân sách mỗi epoch = 10.000 nghìn LAMP = 10.000.000 LAMP. */
export const PER_EPOCH_LAMP = 10_000n * LAMP_PER_THOUSAND; // 10_000_000
export const PER_EPOCH_OIL = PER_EPOCH_LAMP * OIL_PER_LAMP;

/** Basis-points denominator (rate_bp / 10000). */
export const BP_DENOM = 10_000n;

/** Trần bonus-rate SPO tự đặt (≤ 10% = 1000 bp) — chống SPO ăn hết (§6.3 spo_registry). */
export const MAX_RATE_BP = 1_000n;

/** Cooldown đổi rate (epoch) — bait-and-switch: rate mới chỉ áp epoch SAU khi qua cooldown. */
export const RATE_COOLDOWN_EPOCHS = 2n;

// ── Merkle domain separation (byte-perfect onchain merkle.ak; RFC 6962). ──
export const MERKLE_LEAF_PREFIX = 0x00;
export const MERKLE_NODE_PREFIX = 0x01;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}
