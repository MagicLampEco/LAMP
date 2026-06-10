// Reserve RELEASE — P8 bit-identical vectors (khớp release.ak tests TV-AR01..AR05).
import { describe, it, expect } from "vitest";
import {
  approvedCumulative,
  capRelease,
  demandAllowance,
  maxDrawPerEpoch,
  yearCap,
  yearsToCap,
} from "../offchain/src/release.js";

// Hằng dùng chung (khớp release.ak).
const R0 = 5_000_000_000_000n;
const G = 400n;
const EY = 73n;
const RCAP = 1_800_000_000_000_000n;
const TG = 1000n;

describe("yearCap — lãi kép rời rạc floor-mỗi-bước (P8)", () => {
  it("year 0 = R0", () => {
    expect(yearCap(R0, G, 0n)).toBe(R0);
  });
  it("year 1 = ⌊R0·10400/10000⌋ = 5_200_000_000_000", () => {
    expect(yearCap(R0, G, 1n)).toBe(5_200_000_000_000n);
  });
  it("year 2 = 5_408_000_000_000", () => {
    expect(yearCap(R0, G, 2n)).toBe(5_408_000_000_000n);
  });
});

describe("capRelease", () => {
  it("TV-AR01: epoch 1036 → 5_098_630_136_986 (nội suy f=36)", () => {
    expect(capRelease(1036n, TG, R0, G, EY, RCAP)).toBe(5_098_630_136_986n);
  });
  it("e<0 (epoch 999) → 0", () => {
    expect(capRelease(999n, TG, R0, G, EY, RCAP)).toBe(0n);
  });
  it("e=0 (epoch 1000) → year_cap(0) = R0", () => {
    expect(capRelease(1000n, TG, R0, G, EY, RCAP)).toBe(R0);
  });
  it("đầu năm 1 (epoch 1073) → year_cap(1)", () => {
    expect(capRelease(1073n, TG, R0, G, EY, RCAP)).toBe(5_200_000_000_000n);
  });
  it("đơn điệu không giảm", () => {
    expect(capRelease(1100n, TG, R0, G, EY, RCAP) >= capRelease(1099n, TG, R0, G, EY, RCAP)).toBe(true);
  });
  it("TV-AR05: năm xa (epoch 15600, y=200) → chạm reserve_cap", () => {
    expect(capRelease(15600n, TG, R0, G, EY, RCAP)).toBe(RCAP);
  });
});

describe("maxDrawPerEpoch", () => {
  it("TV-AR02: epoch 1036 năm 0 → 2_739_726_028 oil", () => {
    expect(maxDrawPerEpoch(1036n, TG, R0, G, EY, RCAP)).toBe(2_739_726_028n);
  });
  it("≥ 0 luôn", () => {
    expect(maxDrawPerEpoch(1036n, TG, R0, G, EY, RCAP) >= 0n).toBe(true);
  });
});

describe("demandAllowance (tầng 2 — chỉ làm chậm)", () => {
  it("TV-AR03: velocity 30% (sma=3000) → 1_529_589_041_095", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, true, 3000n, 2000n)).toBe(1_529_589_041_095n);
  });
  it("floor clamp lên: sma=500 < floor 2000 → 1_019_726_027_397", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, true, 500n, 2000n)).toBe(1_019_726_027_397n);
  });
  it("velocity cao (sma=10000) → = cap (không vượt)", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, true, 10000n, 2000n)).toBe(cap);
  });
  it("bơm vô lý (sma=99999) → clamp về 10000 → vẫn = cap", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, true, 99999n, 2000n)).toBe(cap);
  });
  it("TV-AR04: bypass MVP (velocityPresent=false) → cap", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, false, 0n, 2000n)).toBe(cap);
  });
});

describe("approvedCumulative = min(cap, demand) — trần cứng thắng", () => {
  it("TV-AR03: velocity thấp → approved = demand 1_529_589_041_095", () => {
    expect(approvedCumulative(1036n, TG, R0, G, EY, RCAP, true, 3000n, 2000n)).toBe(1_529_589_041_095n);
  });
  it("TV-AR04: bypass → approved = cap_release", () => {
    expect(approvedCumulative(1036n, TG, R0, G, EY, RCAP, false, 0n, 2000n)).toBe(
      capRelease(1036n, TG, R0, G, EY, RCAP),
    );
  });
  it("B1 bounded: approved ≤ cap_release mọi velocity", () => {
    const cap = capRelease(2000n, TG, R0, G, EY, RCAP);
    expect(approvedCumulative(2000n, TG, R0, G, EY, RCAP, true, 99999n, 2000n) <= cap).toBe(true);
  });
  it("B1: approved ≤ reserve_cap (năm xa)", () => {
    expect(approvedCumulative(15600n, TG, R0, G, EY, RCAP, true, 10000n, 2000n) <= RCAP).toBe(true);
  });
});

describe("yearsToCap (minh hoạ cạn Reserve)", () => {
  it("R0=5tr, g=4%, cap=1.8 tỷ → ~150 năm (≥150, ≤152)", () => {
    const y = yearsToCap(R0, G, RCAP);
    expect(y).not.toBeNull();
    expect(y! >= 150n && y! <= 152n).toBe(true);
  });
  it("Reserve 90% (cap=32.4e15) → ~225 năm (≥220, ≤230)", () => {
    const y = yearsToCap(R0, G, 32_400_000_000_000_000n);
    expect(y).not.toBeNull();
    expect(y! >= 220n && y! <= 230n).toBe(true);
  });
});
