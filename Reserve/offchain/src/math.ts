// LAMP Reserve math — trần CỨNG mỗi epoch BigInt (mirror onchain math.ak).
// Logic PHẢI khớp byte-perfect: floor division, min kẹp trần & pot.

import { RELEASE_EPOCHS } from "./constants.js";
import type { ReserveState } from "./types.js";

/** max_per_epoch = total / 1000 — trần CỨNG nhả mỗi epoch (chia chẵn cho E hiện hành). */
export function maxPerEpoch(totalOil: bigint): bigint {
  return totalOil / RELEASE_EPOCHS; // BigInt / = floor; E ⋮ 1000 → dư 0
}

/**
 * drawable = min(requested, min(max_per_epoch(total), total − drawn))
 *   — KHÔNG vượt trần epoch, KHÔNG vượt pot còn lại, KHÔNG vượt cầu thực (requested).
 */
export function drawable(totalOil: bigint, drawnOil: bigint, requested: bigint): bigint {
  const cap = maxPerEpoch(totalOil);
  const remaining = totalOil - drawnOil;
  const ceil = cap < remaining ? cap : remaining;
  return requested < ceil ? requested : ceil;
}

export class ReserveDrawError extends Error {}

/**
 * Tính ReserveState mới sau khi Treasury kéo `requested` oil tại epoch t
 * (fail-fast TRƯỚC khi tốn phí onchain). Ép đúng luật validator:
 *   - t > last_epoch          (≤1 draw/epoch);
 *   - delta = drawable(...) > 0 (có phần để nhả, ≤ trần & ≤ pot);
 *   - start_epoch + total_oil bất biến; drawn_oil += delta; last_epoch := t.
 * `requested` = lượng Treasury muốn kéo (mặc định = trần → kéo tối đa).
 * Throw ReserveDrawError nếu t ≤ last_epoch hoặc delta == 0 (tx chắc reject).
 */
export function applyDraw(
  s: ReserveState,
  t: bigint,
  requested: bigint = maxPerEpoch(s.total_oil),
): { next: ReserveState; drawn: bigint } {
  if (t <= s.last_epoch) {
    throw new ReserveDrawError(
      `RMATH-002: epoch ${t} ≤ last_epoch ${s.last_epoch} ` +
        `(đã có draw trong/sau epoch này — tối đa 1 draw/epoch)`,
    );
  }
  const d = drawable(s.total_oil, s.drawn_oil, requested);
  if (d <= 0n) {
    throw new ReserveDrawError(
      `RMATH-001: không có phần để nhả tại epoch ${t} ` +
        `(pot còn ${s.total_oil - s.drawn_oil}, requested ${requested})`,
    );
  }
  return {
    next: { ...s, drawn_oil: s.drawn_oil + d, last_epoch: t },
    drawn: d,
  };
}
