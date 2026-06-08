// Genesis circulating supply — minted_total − Σ(Treasury + Deposits held) (CONTRACT §6).

import { describe, it, expect } from "vitest";
import { circulating, CirculatingError, type PotHolding } from "../offchain/src/circulating.js";
import { genesisSupplyState } from "../offchain/src/supplyState.js";
import type { SupplyState } from "../offchain/src/types.js";

const minted: SupplyState = {
  ...genesisSupplyState(),
  dist_minted:    100_000_000n,
  reserve_minted: 20_000_000n,
};

describe("circulating", () => {
  it("không pot giữ → circulating = minted_total", () => {
    expect(circulating(minted, [])).toBe(120_000_000n);
  });

  it("trừ Treasury + Deposits held", () => {
    const pots: PotHolding[] = [
      { label: "Treasury", held: 30_000_000n },
      { label: "Deposits", held: 5_000_000n },
    ];
    expect(circulating(minted, pots)).toBe(85_000_000n);
  });

  it("Reserve KHÔNG trừ (quota ẢO chưa mint → không trong minted_total)", () => {
    // reserve_minted (đã mint) ĐÃ nằm trong minted_total; reserve_cap (chưa mint) KHÔNG.
    // circulating chỉ phụ thuộc minted + pots, không phụ thuộc cap → cap không ảnh hưởng.
    const big: SupplyState = { ...minted, reserve_cap: minted.reserve_cap };
    expect(circulating(big, [])).toBe(120_000_000n);
  });

  it("toàn bộ minted nằm trong pot → circulating = 0", () => {
    expect(circulating(minted, [{ label: "Treasury", held: 120_000_000n }])).toBe(0n);
  });

  it("Σ held > minted → throw (bất khả thi)", () => {
    expect(() => circulating(minted, [{ label: "Treasury", held: 120_000_001n }]))
      .toThrow(CirculatingError);
  });

  it("pot held âm → throw", () => {
    expect(() => circulating(minted, [{ label: "X", held: -1n }])).toThrow(/âm/);
  });
});
