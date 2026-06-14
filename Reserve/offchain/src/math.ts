// LAMP Reserve math — vested/draw thuần BigInt (mirror onchain math.ak).
// Logic PHẢI khớp byte-perfect: floor division, min clamp, max(0, elapsed).

import { EPOCHS } from "./constants.js";
import type { ReserveState } from "./types.js";

/**
 * vested(t) = phần đã tới hạn tại epoch t (oil).
 *   t ≤ start          → 0
 *   start < t < +1001  → total_oil * (t-start) / 1001  (floor)
 *   t ≥ start + 1001   → total_oil  (clamp bởi min)
 */
export function vested(startEpoch: bigint, totalOil: bigint, t: bigint): bigint {
  const elapsed = t > startEpoch ? t - startEpoch : 0n;
  const raw = (totalOil * elapsed) / EPOCHS; // BigInt / = floor (elapsed ≥ 0)
  return raw > totalOil ? totalOil : raw;
}

/** draw(t) = vested(t) − drawn_oil (≥ 0 vì vested đơn điệu theo t). */
export function draw(
  startEpoch: bigint,
  totalOil: bigint,
  drawnOil: bigint,
  t: bigint,
): bigint {
  return vested(startEpoch, totalOil, t) - drawnOil;
}

export class ReserveDrawError extends Error {}

/**
 * Tính ReserveState mới sau khi draw tại epoch t (fail-fast TRƯỚC khi tốn phí onchain).
 * Ép đúng luật validator: draw > 0; start_epoch + total_oil bất biến; drawn_oil đơn điệu.
 * Throw ReserveDrawError nếu không có gì để nhả (draw == 0) — tránh tx chắc chắn reject.
 */
export function applyDraw(s: ReserveState, t: bigint): { next: ReserveState; drawn: bigint } {
  const d = draw(s.start_epoch, s.total_oil, s.drawn_oil, t);
  if (d <= 0n) {
    throw new ReserveDrawError(
      `RMATH-001: không có phần tới hạn để nhả tại epoch ${t} ` +
        `(vested ${vested(s.start_epoch, s.total_oil, t)} ≤ drawn ${s.drawn_oil})`,
    );
  }
  return {
    next: { ...s, drawn_oil: s.drawn_oil + d },
    drawn: d,
  };
}
