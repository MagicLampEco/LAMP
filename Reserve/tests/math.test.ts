// Reserve math mirror — max_per_epoch/drawable BigInt khớp onchain math.ak (biên giống aiken).

import { describe, it, expect } from "vitest";
import { maxPerEpoch, drawable, applyDraw, ReserveDrawError } from "../offchain/src/math.js";
import { RESERVE_TOTAL_OIL, MAX_PER_EPOCH, RELEASE_EPOCHS } from "../offchain/src/constants.js";
import type { ReserveState } from "../offchain/src/types.js";

const E = RESERVE_TOTAL_OIL; // 9_630_000_000_000_000n
const CAP = MAX_PER_EPOCH; // E / 1000 = 9_630_000_000_000n
const S0 = 100n;

describe("maxPerEpoch — trần CỨNG (mirror math.ak)", () => {
  it("E ⋮ 1000 → chia chẵn (dư 0)", () => {
    expect(E % RELEASE_EPOCHS).toBe(0n);
    expect(maxPerEpoch(E)).toBe(9_630_000_000_000n);
  });

  it("trần × 1000 == total (cạn pot trong 1000 epoch)", () => {
    expect(maxPerEpoch(E) * RELEASE_EPOCHS).toBe(E);
  });

  it("RELEASE_EPOCHS == 1000 (KHÔNG 1001)", () => {
    expect(RELEASE_EPOCHS).toBe(1000n);
  });

  it("MAX_PER_EPOCH hằng == maxPerEpoch(E)", () => {
    expect(CAP).toBe(maxPerEpoch(E));
  });
});

describe("drawable — min(requested, min(trần, pot))", () => {
  it("requested > trần, pot dư → kẹp về trần", () => {
    expect(drawable(E, 0n, E)).toBe(CAP);
  });

  it("requested < trần → trả đúng requested (partial)", () => {
    const req = CAP - 1_000_000n;
    expect(drawable(E, 0n, req)).toBe(req);
  });

  it("pot còn < trần → kẹp về pot còn lại", () => {
    const drawn = E - 5_000_000n;
    expect(drawable(E, drawn, E)).toBe(5_000_000n);
  });

  it("pot cạn (drawn == total) → 0", () => {
    expect(drawable(E, E, E)).toBe(0n);
  });

  it("requested == trần đúng → trả trần (biên ==)", () => {
    expect(drawable(E, 0n, CAP)).toBe(CAP);
  });

  it("pot còn == trần đúng → trả trần (biên kép)", () => {
    const drawn = E - CAP;
    expect(drawable(E, drawn, E)).toBe(CAP);
  });
});

describe("applyDraw — transition fail-fast", () => {
  const fresh: ReserveState = {
    start_epoch: S0, total_oil: E, drawn_oil: 0n, last_epoch: S0,
  };

  it("happy: kéo tối đa (mặc định = trần); drawn += trần; last_epoch := t", () => {
    const { next, drawn } = applyDraw(fresh, S0 + 1n);
    expect(drawn).toBe(CAP);
    expect(next.start_epoch).toBe(S0);
    expect(next.total_oil).toBe(E);
    expect(next.drawn_oil).toBe(fresh.drawn_oil + CAP);
    expect(next.last_epoch).toBe(S0 + 1n);
  });

  it("partial: requested < trần → kéo đúng requested", () => {
    const req = CAP - 2_000_000n;
    const { next, drawn } = applyDraw(fresh, S0 + 1n, req);
    expect(drawn).toBe(req);
    expect(next.drawn_oil).toBe(req);
  });

  it("epoch cuối: pot còn < trần → kéo nốt remaining", () => {
    const near: ReserveState = {
      start_epoch: S0, total_oil: E, drawn_oil: E - 3_000_000n, last_epoch: S0 + 999n,
    };
    const { next, drawn } = applyDraw(near, S0 + 1000n, E);
    expect(drawn).toBe(3_000_000n);
    expect(next.drawn_oil).toBe(E);
    expect(next.last_epoch).toBe(S0 + 1000n);
  });

  it("t == last_epoch (re-draw cùng epoch) → throw", () => {
    const used: ReserveState = {
      start_epoch: S0, total_oil: E, drawn_oil: CAP, last_epoch: S0 + 5n,
    };
    expect(() => applyDraw(used, S0 + 5n)).toThrow(ReserveDrawError);
  });

  it("t < last_epoch (tua lùi) → throw", () => {
    const used: ReserveState = {
      start_epoch: S0, total_oil: E, drawn_oil: CAP, last_epoch: S0 + 5n,
    };
    expect(() => applyDraw(used, S0 + 3n)).toThrow(/last_epoch/);
  });

  it("pot cạn → throw (không tx rỗng)", () => {
    const empty: ReserveState = {
      start_epoch: S0, total_oil: E, drawn_oil: E, last_epoch: S0 + 999n,
    };
    expect(() => applyDraw(empty, S0 + 1000n)).toThrow(/không có phần để nhả/);
  });
});
