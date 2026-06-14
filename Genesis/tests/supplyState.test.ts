// Genesis SupplyState cap math — mirror onchain lamp_mint luật 4-7.
// Happy (2 đường, biên cap) + NEGATIVE (mọi vector A1/A4/A5/A6/A9 offchain).

import { describe, it, expect } from "vitest";
import {
  genesisSupplyState, applyMint, mintedTotal, distRemaining, reserveRemaining,
  assertInvariants, SupplyMintError,
} from "../offchain/src/supplyState.js";
import { DIST_CAP_OIL, RESERVE_CAP_OIL, TOTAL_CAP_OIL } from "../offchain/src/constants.js";
import type { SupplyState } from "../offchain/src/types.js";

describe("genesisSupplyState + caps", () => {
  it("genesis: chưa mint, caps chuẩn", () => {
    const s = genesisSupplyState();
    expect(s.dist_minted).toBe(0n);
    expect(s.reserve_minted).toBe(0n);
    expect(s.dist_cap).toBe(DIST_CAP_OIL);
    expect(s.reserve_cap).toBe(RESERVE_CAP_OIL);
  });

  it("dist_cap + reserve_cap == 36 tỷ × 10^6", () => {
    expect(DIST_CAP_OIL + RESERVE_CAP_OIL).toBe(TOTAL_CAP_OIL);
  });

  it("remaining quota tại genesis = full cap", () => {
    const s = genesisSupplyState();
    expect(distRemaining(s)).toBe(DIST_CAP_OIL);
    expect(reserveRemaining(s)).toBe(RESERVE_CAP_OIL);
  });
});

describe("applyMint — HAPPY (lazy-mint dần)", () => {
  it("DistributionVest cộng đúng dist_minted, reserve không đổi (A5)", () => {
    const s = genesisSupplyState();
    const s2 = applyMint(s, "DistributionVest", 1_000_000n);
    expect(s2.dist_minted).toBe(1_000_000n);
    expect(s2.reserve_minted).toBe(0n);
    expect(mintedTotal(s2)).toBe(1_000_000n);
  });

  it("ReserveDraw cộng đúng reserve_minted, dist không đổi (A5)", () => {
    const s = genesisSupplyState();
    const s2 = applyMint(s, "ReserveDraw", 5_000_000n);
    expect(s2.reserve_minted).toBe(5_000_000n);
    expect(s2.dist_minted).toBe(0n);
  });

  it("mint dần tích lũy đơn điệu", () => {
    let s = genesisSupplyState();
    s = applyMint(s, "DistributionVest", 100_000_000n);
    s = applyMint(s, "DistributionVest", 50_000_000n);
    expect(s.dist_minted).toBe(150_000_000n);
  });

  it("mint tới ĐÚNG cap (biên dưới-bằng) hợp lệ", () => {
    const s: SupplyState = { ...genesisSupplyState(), dist_minted: DIST_CAP_OIL - 7n };
    const s2 = applyMint(s, "DistributionVest", 7n);
    expect(s2.dist_minted).toBe(DIST_CAP_OIL);
    expect(distRemaining(s2)).toBe(0n);
  });

  it("ReserveDraw tới ĐÚNG reserve_cap hợp lệ", () => {
    const s: SupplyState = { ...genesisSupplyState(), reserve_minted: RESERVE_CAP_OIL - 3n };
    const s2 = applyMint(s, "ReserveDraw", 3n);
    expect(s2.reserve_minted).toBe(RESERVE_CAP_OIL);
  });

  it("không mutate input (immutable transition)", () => {
    const s = genesisSupplyState();
    applyMint(s, "DistributionVest", 1_000_000n);
    expect(s.dist_minted).toBe(0n);
  });
});

describe("applyMint — NEGATIVE (vector tấn công)", () => {
  it("A1 vượt dist_cap → throw", () => {
    const s: SupplyState = { ...genesisSupplyState(), dist_minted: DIST_CAP_OIL - 5n };
    expect(() => applyMint(s, "DistributionVest", 6n)).toThrow(SupplyMintError);
    expect(() => applyMint(s, "DistributionVest", 6n)).toThrow(/dist_cap/);
  });

  it("A1 vượt reserve_cap → throw", () => {
    const s: SupplyState = { ...genesisSupplyState(), reserve_minted: RESERVE_CAP_OIL };
    expect(() => applyMint(s, "ReserveDraw", 1n)).toThrow(/reserve_cap/);
  });

  it("A6 burn (Δ<0) → throw", () => {
    expect(() => applyMint(genesisSupplyState(), "DistributionVest", -1n)).toThrow(/Δ phải > 0/);
  });

  it("A6 no-op (Δ=0) → throw", () => {
    expect(() => applyMint(genesisSupplyState(), "ReserveDraw", 0n)).toThrow(/Δ phải > 0/);
  });

  it("mint vượt total qua dist alone bị chặn bởi dist_cap (không tràn sang reserve)", () => {
    const s: SupplyState = { ...genesisSupplyState(), dist_minted: DIST_CAP_OIL };
    // dist đã đầy; mint thêm dist → vượt cap dù total < 36 tỷ.
    expect(() => applyMint(s, "DistributionVest", 1n)).toThrow(/dist_cap/);
  });
});

describe("assertInvariants — audit offchain", () => {
  it("genesis hợp lệ", () => {
    expect(() => assertInvariants(genesisSupplyState())).not.toThrow();
  });

  it("minted âm → throw", () => {
    expect(() => assertInvariants({ ...genesisSupplyState(), dist_minted: -1n })).toThrow(/âm/);
  });

  it("A1 dist_minted > cap → throw", () => {
    expect(() => assertInvariants({ ...genesisSupplyState(), dist_minted: DIST_CAP_OIL + 1n }))
      .toThrow(/dist_cap/);
  });

  it("A1 reserve_minted > cap → throw", () => {
    expect(() => assertInvariants({ ...genesisSupplyState(), reserve_minted: RESERVE_CAP_OIL + 1n }))
      .toThrow(/reserve_cap/);
  });
});
