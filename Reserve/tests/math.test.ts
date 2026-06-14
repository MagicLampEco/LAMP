// Reserve math mirror — vested/draw BigInt khớp onchain math.ak (biên giống aiken tests).

import { describe, it, expect } from "vitest";
import { vested, draw, applyDraw, ReserveDrawError } from "../offchain/src/math.js";
import { RESERVE_TOTAL_OIL, EPOCHS } from "../offchain/src/constants.js";
import type { ReserveState } from "../offchain/src/types.js";

const E = RESERVE_TOTAL_OIL; // 7_899_000_000_000_000n
const S0 = 100n;

describe("vested — biên (mirror math.ak)", () => {
  it("t < start → 0 (chưa mở cửa)", () => {
    expect(vested(S0, E, 50n)).toBe(0n);
  });

  it("t == start → 0 (KHÔNG cliff)", () => {
    expect(vested(S0, E, S0)).toBe(0n);
  });

  it("t = start+1 → E/1001 (floor)", () => {
    expect(vested(S0, E, S0 + 1n)).toBe(E / EPOCHS);
  });

  it("t = start+500 → E*500/1001 (floor)", () => {
    expect(vested(S0, E, S0 + 500n)).toBe((E * 500n) / EPOCHS);
  });

  it("t = start+1000 → chưa đầy (< E)", () => {
    const v = vested(S0, E, S0 + 1000n);
    expect(v).toBe((E * 1000n) / EPOCHS);
    expect(v < E).toBe(true);
  });

  it("t = start+1001 → E (đầy chính xác)", () => {
    expect(vested(S0, E, S0 + EPOCHS)).toBe(E);
  });

  it("t > start+1001 → clamp tại E (min ép)", () => {
    expect(vested(S0, E, S0 + 5000n)).toBe(E);
  });

  it("floor: không vượt cap giữa chừng", () => {
    expect(vested(S0, E, S0 + 999n) <= E).toBe(true);
  });
});

describe("draw — vested(t) − drawn_oil", () => {
  it("chưa nhả, t giữa → draw == vested", () => {
    expect(draw(S0, E, 0n, S0 + 500n)).toBe(vested(S0, E, S0 + 500n));
  });

  it("incremental: vested(600) − vested(500)", () => {
    const drawn = vested(S0, E, S0 + 500n);
    expect(draw(S0, E, drawn, S0 + 600n)).toBe(
      vested(S0, E, S0 + 600n) - drawn,
    );
  });

  it("đã caught up → draw 0", () => {
    const v = vested(S0, E, S0 + 300n);
    expect(draw(S0, E, v, S0 + 300n)).toBe(0n);
  });

  it("full-drain tại t ≥ +1001 → E", () => {
    expect(draw(S0, E, 0n, S0 + EPOCHS)).toBe(E);
  });

  it("t ≤ start chưa nhả → draw 0", () => {
    expect(draw(S0, E, 0n, S0)).toBe(0n);
  });
});

describe("applyDraw — transition fail-fast", () => {
  const fresh: ReserveState = { start_epoch: S0, total_oil: E, drawn_oil: 0n };

  it("happy: drawn_oil += draw; start/total bất biến", () => {
    const { next, drawn } = applyDraw(fresh, S0 + 500n);
    expect(drawn).toBe(vested(S0, E, S0 + 500n));
    expect(next.start_epoch).toBe(S0);
    expect(next.total_oil).toBe(E);
    expect(next.drawn_oil).toBe(fresh.drawn_oil + drawn);
  });

  it("full drain tại +1001 → drawn_oil == E", () => {
    const { next, drawn } = applyDraw(fresh, S0 + EPOCHS);
    expect(drawn).toBe(E);
    expect(next.drawn_oil).toBe(E);
  });

  it("draw 0 (t == start) → throw (chống tx rỗng)", () => {
    expect(() => applyDraw(fresh, S0)).toThrow(ReserveDrawError);
  });

  it("draw 0 (đã caught up) → throw", () => {
    const caught: ReserveState = {
      start_epoch: S0, total_oil: E, drawn_oil: vested(S0, E, S0 + 300n),
    };
    expect(() => applyDraw(caught, S0 + 300n)).toThrow(/không có phần tới hạn/);
  });
});
