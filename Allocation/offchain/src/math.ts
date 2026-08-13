// LAMP Allocation vested math — Capped Drop tất định. O(1), BigInt.
// PHẢI khớp byte-perfect với claim_account.ak (Redeem branch) + math.ak.
//
//   vested(t)  = clamp( D · drops_per_epoch · max(0, t − start_epoch) , 0 , entitlement )
//              = min( entitlement , D · dpe · max(0, t − t0) )
//   redeemable = vested − redeemed     (yêu cầu > 0 khi Redeem)
//
// D (drop_value) là THAM SỐ COMPILE-TIME của claim_account validator (KHÔNG đọc beacon
// ref input như Distribution v1). Caller phải truyền đúng D đã bake vào validator.
//
// Bất biến (types.ak §): vested đơn điệu tăng theo t, cap entitlement; bỏ lỡ epoch
// KHÔNG mất quyền (vested cộng dồn); redeemed cộng dồn, tổng nhận ≤ E.

import type { ClaimAccountDatum } from "./types.js";

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** clamp x vào [lo, hi] — mirror math.ak clamp. */
export function clamp(x: bigint, lo: bigint, hi: bigint): bigint {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/** ⌈a / b⌉ cho b > 0, a ≥ 0 — mirror math.ak ceil_div. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * vested(t) = min(E, D · dpe · max(0, t − t0)).
 * @param entitlement   E (oildrop)
 * @param dropValue     D (oildrop/drop·epoch) — compile-time param của claim_account
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

  // elapsed = max(0, t − t0) — onchain: if current_epoch > start_epoch then Δ else 0.
  const elapsed = currentEpoch > startEpoch ? currentEpoch - startEpoch : 0n;
  const raw = dropValue * dropsPerEpoch * elapsed;
  return minBig(entitlement, raw);   // clamp(raw, 0, E) với raw ≥ 0
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
 * D·dpe = 0 → không bao giờ mở khoá (null).
 */
export function epochsToFull(
  entitlement:   bigint,
  dropValue:     bigint,
  dropsPerEpoch: bigint,
): bigint | null {
  const perEpoch = dropValue * dropsPerEpoch;
  if (perEpoch <= 0n) return null;
  if (entitlement <= 0n) return 0n;
  return ceilDiv(entitlement, perEpoch);
}
