// Reserve meter logic (offchain) — tính transition meter + kiểm draw cho phép.
// Mirror nhánh Draw/Reset của reserve_meter.ak (KHÔNG ký, permissionless).

import {
  approvedCumulative,
  maxDrawPerEpoch,
} from "./release.js";
import type { ReserveMeter, ReservePolicy } from "./types.js";

export interface DrawContext {
  policy:          ReservePolicy;
  reserveCap:      bigint;   // từ SupplyState
  currentEpoch:    bigint;
  velocityPresent: boolean;
  smaRatioBps:     bigint;   // 0 nếu bypass
}

/** approved_cumulative(epoch) từ policy + context. */
export function approvedAt(ctx: DrawContext): bigint {
  return approvedCumulative(
    ctx.currentEpoch,
    ctx.policy.genesis_release_epoch,
    ctx.policy.reserve_release_base,
    ctx.policy.annual_growth_bps,
    ctx.policy.epochs_per_year,
    ctx.reserveCap,
    ctx.velocityPresent,
    ctx.smaRatioBps,
    ctx.policy.demand_floor_bps,
  );
}

/** max_draw_per_epoch(epoch) từ policy + context. */
export function maxDrawAt(ctx: DrawContext): bigint {
  return maxDrawPerEpoch(
    ctx.currentEpoch,
    ctx.policy.genesis_release_epoch,
    ctx.policy.reserve_release_base,
    ctx.policy.annual_growth_bps,
    ctx.policy.epochs_per_year,
    ctx.reserveCap,
  );
}

/**
 * δ tối đa rút được TẠI epoch hiện tại, cho meter + reserve_minted hiện tại:
 *   δ ≤ approved − reserve_minted          (C-10')
 *   δ ≤ max_draw − meter.drawn_in_epoch    (C-8', nếu cùng epoch)
 * Trả về 0 nếu không còn room. Reset (epoch mới) → drawn_in_epoch coi như 0.
 */
export function maxDeltaNow(
  meter: ReserveMeter,
  reserveMinted: bigint,
  ctx: DrawContext,
): bigint {
  const approved = approvedAt(ctx);
  const maxDraw = maxDrawAt(ctx);
  const roomCumulative = approved - reserveMinted;
  const sameEpoch = meter.epoch === ctx.currentEpoch;
  const drawnSoFar = sameEpoch ? meter.drawn_in_epoch : 0n;
  const roomRate = maxDraw - drawnSoFar;
  const room = roomCumulative < roomRate ? roomCumulative : roomRate;
  return room > 0n ? room : 0n;
}

/** Transition meter cho Draw (cùng epoch). */
export function applyDraw(meter: ReserveMeter, delta: bigint): ReserveMeter {
  if (delta <= 0n) throw new Error("RM-DRAW-000: delta must be > 0");
  return { epoch: meter.epoch, drawn_in_epoch: meter.drawn_in_epoch + delta };
}

/** Transition meter cho Reset (sang epoch mới — drawn bắt đầu = delta). */
export function applyReset(newEpoch: bigint, delta: bigint): ReserveMeter {
  if (delta <= 0n) throw new Error("RM-RESET-000: delta must be > 0");
  return { epoch: newEpoch, drawn_in_epoch: delta };
}

/**
 * Chọn route Draw vs Reset cho 1 tx, kiểm hợp lệ. Trả về { route, meterOut }.
 * Reject (throw) nếu δ vượt biên (giống validator).
 */
export function planDraw(
  meter: ReserveMeter,
  reserveMinted: bigint,
  delta: bigint,
  ctx: DrawContext,
): { route: "Draw" | "Reset"; meterOut: ReserveMeter; reserveMintedOut: bigint } {
  if (delta <= 0n) throw new Error("RM-PLAN-000: delta must be > 0");
  const approved = approvedAt(ctx);
  const maxDraw = maxDrawAt(ctx);
  const reserveMintedOut = reserveMinted + delta;
  if (reserveMintedOut > approved) {
    throw new Error(
      `RM-PLAN-010: reserve_minted_out ${reserveMintedOut} > approved ${approved} (C-10')`,
    );
  }
  if (meter.epoch === ctx.currentEpoch) {
    const meterOut = applyDraw(meter, delta);
    if (meterOut.drawn_in_epoch > maxDraw) {
      throw new Error(
        `RM-PLAN-008: drawn ${meterOut.drawn_in_epoch} > max_draw ${maxDraw} (C-8')`,
      );
    }
    return { route: "Draw", meterOut, reserveMintedOut };
  }
  if (ctx.currentEpoch <= meter.epoch) {
    throw new Error("RM-PLAN-012: Reset requires current_epoch > meter.epoch (C-12)");
  }
  const meterOut = applyReset(ctx.currentEpoch, delta);
  if (meterOut.drawn_in_epoch > maxDraw) {
    throw new Error(
      `RM-PLAN-014: delta ${delta} > max_draw ${maxDraw} (C-14)`,
    );
  }
  return { route: "Reset", meterOut, reserveMintedOut };
}
