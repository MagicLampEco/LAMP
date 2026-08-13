// LAMP Reserve math — trần CỨNG mỗi epoch BigInt (mirror onchain math.ak).
// Logic PHẢI khớp byte-perfect: floor division, min kẹp trần & pot.

import { RELEASE_EPOCHS } from "./constants.js";
import type { ReserveState } from "./types.js";

/** max_per_epoch = total / 1000 — trần CỨNG nhả mỗi epoch (chia chẵn cho E hiện hành). */
export function maxPerEpoch(totalOildrop: bigint): bigint {
  return totalOildrop / RELEASE_EPOCHS; // BigInt / = floor; E ⋮ 1000 → dư 0
}

/**
 * drawable = min(requested, min(max_per_epoch(total), total − drawn))
 *   — KHÔNG vượt trần epoch, KHÔNG vượt pot còn lại, KHÔNG vượt cầu thực (requested).
 */
export function drawable(totalOildrop: bigint, drawnOildrop: bigint, requested: bigint): bigint {
  const cap = maxPerEpoch(totalOildrop);
  const remaining = totalOildrop - drawnOildrop;
  const ceil = cap < remaining ? cap : remaining;
  return requested < ceil ? requested : ceil;
}

export class ReserveDrawError extends Error {}

/**
 * Tính ReserveState mới sau khi Treasury kéo `requested` oildrop tại epoch t
 * (fail-fast TRƯỚC khi tốn phí onchain). Ép đúng luật validator:
 *   - t > last_epoch          (≤1 draw/epoch);
 *   - delta = drawable(...) > 0 (có phần để nhả, ≤ trần & ≤ pot);
 *   - start_epoch + total_oildrop bất biến; drawn_oildrop += delta; last_epoch := t.
 * `requested` = lượng Treasury muốn kéo (mặc định = trần → kéo tối đa).
 * Throw ReserveDrawError nếu t ≤ last_epoch hoặc delta == 0 (tx chắc reject).
 */
export function applyDraw(
  s: ReserveState,
  t: bigint,
  requested: bigint = maxPerEpoch(s.total_oildrop),
): { next: ReserveState; drawn: bigint } {
  if (t <= s.last_epoch) {
    throw new ReserveDrawError(
      `RMATH-002: epoch ${t} ≤ last_epoch ${s.last_epoch} ` +
        `(đã có draw trong/sau epoch này — tối đa 1 draw/epoch)`,
    );
  }
  const d = drawable(s.total_oildrop, s.drawn_oildrop, requested);
  if (d <= 0n) {
    throw new ReserveDrawError(
      `RMATH-001: không có phần để nhả tại epoch ${t} ` +
        `(pot còn ${s.total_oildrop - s.drawn_oildrop}, requested ${requested})`,
    );
  }
  return {
    next: { ...s, drawn_oildrop: s.drawn_oildrop + d, last_epoch: t },
    drawn: d,
  };
}
