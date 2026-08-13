// TIGER drip kiểu B — nhỏ giọt ĐỀU N epoch, có cliff, TRÊN validator claim_account
// ĐÃ AUDIT (không cần validator mới).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG VIẾT VALIDATOR MỚI (first-principles)
//
//   claim_account tính (kiểu A, rate cố định):
//       vested_A(t) = min( E , D · r · max(0, t − t0) )            (đã chứng minh §SPEC-MATH)
//   Kiểu B (đều N epoch) muốn:
//       vested_B(t) = E · min( 1 , max(0, t − cliff) / N )
//                   = min( E , (E/N) · max(0, t − cliff) )
//   ⇒ Kiểu B = kiểu A với MỨC MỞ MỖI EPOCH (D·r) = E/N, t0 = cliff.
//
//   Hiện thực số nguyên: đặt D = 1 oildrop (beacon CHUNG), r_i = ceil(E_i / N) per-account.
//       vested(t) = min( E_i , ceil(E_i/N) · (t − cliff) ).
//   Bảo đảm:
//     • cliff:        t ≤ cliff ⇒ vested = 0   (max(0, ·) trong validator).
//     • full đúng-hạn: t = cliff + N ⇒ ceil(E/N)·N ≥ E ⇒ vested = E (xong ĐÚNG N epoch).
//     • không vượt:   vested ≤ E mọi t (cap min).
//     • đơn điệu + cộng dồn + bỏ-lỡ-không-mất: kế thừa nguyên §SPEC-MATH (kiểu A).
//   Sai khác kiểu-B-lý-tưởng: ceil mở NHANH HƠN ≤ 1 đơn-vị-rate/epoch (không bao giờ
//   chậm hơn, không bao giờ vượt E) → an toàn user. Ví E_i < N oildrop (cực nhỏ, dưới
//   ngưỡng thực tế) xong sớm hơn N; ví thực (E_i ≥ N) xong đúng N.

import { DROP_VALUE_OILDROP } from "./constants.js";
import type { ClaimAccountDatum } from "./types.js";

/** ceil(a/b) cho BigInt dương. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error("DRIPB-000: N (epoch) phải > 0");
  if (a <= 0n) return 0n;
  return (a + b - 1n) / b;
}

/** Tham số drip kiểu B per-account cho claim_account.
 *  drop_value D = DROP_VALUE_OILDROP (beacon CHUNG); ở đây trả drops_per_epoch + start. */
export interface DripBParams {
  /** r_i = ceil(E_i / N) — drops_per_epoch ghi vào datum. */
  dropsPerEpoch: bigint;
  /** t0 = cliff — start_epoch ghi vào datum. */
  startEpoch: bigint;
  /** D = DROP_VALUE_OILDROP — beacon dùng chung (echo lại để builder dùng). */
  dropValue: bigint;
}

/** Sinh tham số kiểu B cho 1 ví: r = ceil(E/N), t0 = cliff. */
export function dripBParams(
  entitlementOildrop: bigint,
  dripEpochs: bigint,
  cliffEpoch: bigint,
): DripBParams {
  if (entitlementOildrop < 0n) throw new Error("DRIPB-001: E phải ≥ 0");
  if (cliffEpoch < 0n) throw new Error("DRIPB-002: cliff phải ≥ 0");
  return {
    dropsPerEpoch: ceilDiv(entitlementOildrop, dripEpochs),
    startEpoch: cliffEpoch,
    dropValue: DROP_VALUE_OILDROP,
  };
}

/** Datum ClaimAccount khởi tạo cho 1 ví TIGER (redeemed = 0). */
export function tigerDatum(
  owner: string,
  entitlementOildrop: bigint,
  dripEpochs: bigint,
  cliffEpoch: bigint,
): ClaimAccountDatum {
  const p = dripBParams(entitlementOildrop, dripEpochs, cliffEpoch);
  return {
    owner,
    entitlement: entitlementOildrop,
    redeemed: 0n,
    start_epoch: p.startEpoch,
    drops_per_epoch: p.dropsPerEpoch,
  };
}

/** vested kiểu A — BIT-IDENTICAL với claim_account on-chain (P8).
 *  vested(t) = min(E, D · r · max(0, t − t0)). */
export function vested(
  entitlement: bigint,
  dropValue: bigint,
  dropsPerEpoch: bigint,
  startEpoch: bigint,
  currentEpoch: bigint,
): bigint {
  const elapsed = currentEpoch - startEpoch;
  if (elapsed <= 0n) return 0n;
  const raw = dropValue * dropsPerEpoch * elapsed;
  return raw < entitlement ? raw : entitlement;
}

/** vested của 1 datum TIGER tại epoch t (dùng D = DROP_VALUE_OILDROP chung). */
export function vestedAt(d: ClaimAccountDatum, currentEpoch: bigint): bigint {
  return vested(
    d.entitlement,
    DROP_VALUE_OILDROP,
    d.drops_per_epoch,
    d.start_epoch,
    currentEpoch,
  );
}

/** redeemable = vested(t) − redeemed (clamp ≥ 0). */
export function redeemable(d: ClaimAccountDatum, currentEpoch: bigint): bigint {
  const r = vestedAt(d, currentEpoch) - d.redeemed;
  return r > 0n ? r : 0n;
}

/** Kiểu B LÝ TƯỞNG (đối chiếu): floor(E · min(N, max(0,t−cliff)) / N). */
export function vestedIdealB(
  entitlement: bigint,
  dripEpochs: bigint,
  cliffEpoch: bigint,
  currentEpoch: bigint,
): bigint {
  if (dripEpochs <= 0n) throw new Error("DRIPB-000: N phải > 0");
  let n = currentEpoch - cliffEpoch;
  if (n <= 0n) return 0n;
  if (n > dripEpochs) n = dripEpochs;
  return (entitlement * n) / dripEpochs;
}

/** Epoch (kể từ cliff) để vested chạm full = ceil(E / r). Bảo đảm ≤ N. */
export function fullyVestedAfter(
  entitlementOildrop: bigint,
  dripEpochs: bigint,
): bigint {
  const r = ceilDiv(entitlementOildrop, dripEpochs);
  if (r <= 0n) return 0n;
  return ceilDiv(entitlementOildrop, r);
}
