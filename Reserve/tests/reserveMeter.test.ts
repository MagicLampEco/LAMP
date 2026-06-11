// Reserve meter plan logic — mirror nhánh Draw/Reset reserve_meter.ak.
import { describe, it, expect } from "vitest";
import {
  applyDraw,
  applyReset,
  approvedAt,
  maxDeltaNow,
  maxDrawAt,
  planDraw,
  type DrawContext,
} from "../offchain/src/reserveMeter.js";
import type { ReserveMeter, ReservePolicy } from "../offchain/src/types.js";

const basePolicy: ReservePolicy = {
  genesis_release_epoch: 1000n,
  reserve_release_base: 2_000_000_000_000n,
  annual_growth_bps: 300n,
  epochs_per_year: 73n,
  demand_floor_bps: 2000n,
  velocity_window: 12n,
  velocity_source_policy: "",
  governance_ref: "deadbeef",
};

const RCAP = 1_800_000_000_000_000n;

function ctxAt(epoch: bigint, velocity = false, sma = 0n): DrawContext {
  return {
    policy: basePolicy,
    reserveCap: RCAP,
    currentEpoch: epoch,
    velocityPresent: velocity,
    smaRatioBps: sma,
  };
}

describe("approvedAt / maxDrawAt", () => {
  it("epoch 1036 bypass → approved = cap_release", () => {
    expect(approvedAt(ctxAt(1036n))).toBe(2_029_589_041_095n);
  });
  it("epoch 1036 → max_draw = 821_917_808", () => {
    expect(maxDrawAt(ctxAt(1036n))).toBe(821_917_808n);
  });
});

describe("applyDraw / applyReset", () => {
  it("Draw cộng δ vào drawn, epoch giữ nguyên", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 100n };
    expect(applyDraw(m, 50n)).toEqual({ epoch: 1036n, drawn_in_epoch: 150n });
  });
  it("Reset drawn = δ, epoch mới", () => {
    expect(applyReset(1037n, 200n)).toEqual({ epoch: 1037n, drawn_in_epoch: 200n });
  });
  it("Draw δ≤0 throw", () => {
    expect(() => applyDraw({ epoch: 1n, drawn_in_epoch: 0n }, 0n)).toThrow();
  });
});

describe("maxDeltaNow", () => {
  it("epoch 1036, reserve_minted=0, meter mới → room = min(approved, max_draw) = max_draw", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 0n };
    // approved 2.03e12 ≫ max_draw 8.22e8 → room = max_draw.
    expect(maxDeltaNow(m, 0n, ctxAt(1036n))).toBe(821_917_808n);
  });
  it("đã rút sát max_draw → room nhỏ lại", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 821_917_800n };
    expect(maxDeltaNow(m, 0n, ctxAt(1036n))).toBe(8n); // 821_917_808 − 821_917_800
  });
  it("velocity thấp kéo approved xuống → room bị approved chặn", () => {
    // velocity 30% → approved ≈ 0.61e12. reserve_minted = approved → room cumul = 0.
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 0n };
    const ctx = ctxAt(1036n, true, 3000n);
    const approved = approvedAt(ctx);
    expect(maxDeltaNow(m, approved, ctx)).toBe(0n);
  });
});

describe("planDraw — route + ép biên (giống validator)", () => {
  it("cùng epoch, δ hợp lệ → Draw", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 0n };
    const r = planDraw(m, 0n, 500_000_000n, ctxAt(1036n));
    expect(r.route).toBe("Draw");
    expect(r.meterOut).toEqual({ epoch: 1036n, drawn_in_epoch: 500_000_000n });
    expect(r.reserveMintedOut).toBe(500_000_000n);
  });
  it("epoch mới → Reset, drawn = δ", () => {
    const m: ReserveMeter = { epoch: 1035n, drawn_in_epoch: 999n };
    const r = planDraw(m, 0n, 500_000_000n, ctxAt(1036n));
    expect(r.route).toBe("Reset");
    expect(r.meterOut).toEqual({ epoch: 1036n, drawn_in_epoch: 500_000_000n });
  });
  it("δ vượt max_draw (C-8') → throw", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 0n };
    expect(() => planDraw(m, 0n, 900_000_000n, ctxAt(1036n))).toThrow(/C-8'/);
  });
  it("reserve_minted_out vượt approved (C-10', velocity thấp) → throw", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 0n };
    const ctx = ctxAt(1036n, true, 3000n); // approved ≈ 0.61e12
    expect(() => planDraw(m, 2_000_000_000_000n, 1_000n, ctx)).toThrow(/C-10'/);
  });
  it("Reset không tiến epoch (current ≤ meter) → throw (C-12)", () => {
    // meter epoch 1037 > current 1036, không cùng epoch → nhánh Reset, current ≤ meter.
    const m: ReserveMeter = { epoch: 1037n, drawn_in_epoch: 0n };
    expect(() => planDraw(m, 0n, 1_000_000_000n, ctxAt(1036n))).toThrow(/C-12/);
  });
  it("δ≤0 → throw", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 0n };
    expect(() => planDraw(m, 0n, 0n, ctxAt(1036n))).toThrow();
  });
});
