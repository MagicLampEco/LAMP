// LampDistribution vested math — CONTRACT v2 "Capped Drop" §1.
// Tất định, O(1), PHẢI khớp byte-perfect với validator on-chain.
//
//   vested(t)  = min( entitlement , D · drops_per_epoch · max(0, t − start_epoch) )
//   redeemable = vested − redeemed
//
// Bất biến (CONTRACT §7):
//   - vested đơn điệu tăng theo t, cap entitlement (không vượt E).
//   - đa-claim: redeemed cộng dồn, redeemable ≥ 0, tổng nhận ≤ E.
//   - entitlement bảo toàn: bỏ lỡ epoch KHÔNG mất quyền (vested cộng dồn).
//   - D, drops_per_epoch là tham số (committee/DAO), KHÔNG hardcode.

import type { ClaimAccountDatum } from "./types.js";

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * vested(t) = min(E, D · dpe · max(0, t − t0)).
 * @param entitlement   E (oildrop)
 * @param dropValue     D (oildrop/drop) — đọc từ DropParam beacon
 * @param dropsPerEpoch drops_per_epoch (datum)
 * @param startEpoch    t0
 * @param currentEpoch  t
 */
export function vested(
  entitlement:   bigint,
  dropValue:     bigint,
  dropsPerEpoch: bigint,
  startEpoch:    bigint,
  currentEpoch:  bigint,
): bigint {
  if (entitlement < 0n)   throw new Error("VESTED-000: entitlement must be ≥ 0");
  if (dropValue < 0n)     throw new Error("VESTED-001: dropValue (D) must be ≥ 0");
  if (dropsPerEpoch < 0n) throw new Error("VESTED-002: dropsPerEpoch must be ≥ 0");

  const elapsed = currentEpoch - startEpoch;
  if (elapsed <= 0n) return 0n;             // max(0, t − t0)

  const linear = dropValue * dropsPerEpoch * elapsed;
  return minBig(entitlement, linear);       // cap E
}

/** redeemable = vested(t) − redeemed (clamp ≥ 0). */
export function redeemable(
  datum:        ClaimAccountDatum,
  dropValue:    bigint,
  currentEpoch: bigint,
): bigint {
  const v = vested(
    datum.entitlement, dropValue, datum.drops_per_epoch,
    datum.start_epoch, currentEpoch,
  );
  const r = v - datum.redeemed;
  return r > 0n ? r : 0n;
}

/**
 * Số epoch (kể từ t0) để vested đạt full entitlement = ⌈E / (D·dpe)⌉.
 * D·dpe = 0 → không bao giờ mở khoá (trả về null).
 */
export function epochsToFull(
  entitlement:   bigint,
  dropValue:     bigint,
  dropsPerEpoch: bigint,
): bigint | null {
  const perEpoch = dropValue * dropsPerEpoch;
  if (perEpoch <= 0n) return null;
  if (entitlement <= 0n) return 0n;
  return (entitlement + perEpoch - 1n) / perEpoch;   // ⌈E / (D·dpe)⌉
}
