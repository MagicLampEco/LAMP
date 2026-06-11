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

// Hằng dùng chung (khớp release.ak — tham số CHỐT council R0=2tr, g=3%).
const R0 = 2_000_000_000_000n;
const G = 300n;
const EY = 73n;
const RCAP = 1_800_000_000_000_000n;
const TG = 1000n;

describe("yearCap — lãi kép rời rạc floor-mỗi-bước (P8)", () => {
  it("year 0 = R0", () => {
    expect(yearCap(R0, G, 0n)).toBe(R0);
  });
  it("year 1 = ⌊R0·10300/10000⌋ = 2_060_000_000_000", () => {
    expect(yearCap(R0, G, 1n)).toBe(2_060_000_000_000n);
  });
  it("year 2 = 2_121_800_000_000", () => {
    expect(yearCap(R0, G, 2n)).toBe(2_121_800_000_000n);
  });
});

describe("capRelease", () => {
  it("TV-AR01: epoch 1036 → 2_029_589_041_095 (nội suy f=36)", () => {
    expect(capRelease(1036n, TG, R0, G, EY, RCAP)).toBe(2_029_589_041_095n);
  });
  it("e<0 (epoch 999) → 0", () => {
    expect(capRelease(999n, TG, R0, G, EY, RCAP)).toBe(0n);
  });
  it("e=0 (epoch 1000) → year_cap(0) = R0", () => {
    expect(capRelease(1000n, TG, R0, G, EY, RCAP)).toBe(R0);
  });
  it("đầu năm 1 (epoch 1073) → year_cap(1)", () => {
    expect(capRelease(1073n, TG, R0, G, EY, RCAP)).toBe(2_060_000_000_000n);
  });
  it("đơn điệu không giảm", () => {
    expect(capRelease(1100n, TG, R0, G, EY, RCAP) >= capRelease(1099n, TG, R0, G, EY, RCAP)).toBe(true);
  });
  it("TV-AR05: năm xa (epoch 22900, y=300) → chạm reserve_cap", () => {
    expect(capRelease(22900n, TG, R0, G, EY, RCAP)).toBe(RCAP);
  });
});

describe("maxDrawPerEpoch", () => {
  it("TV-AR02: epoch 1036 năm 0 → 821_917_808 oil", () => {
    expect(maxDrawPerEpoch(1036n, TG, R0, G, EY, RCAP)).toBe(821_917_808n);
  });
  it("≥ 0 luôn", () => {
    expect(maxDrawPerEpoch(1036n, TG, R0, G, EY, RCAP) >= 0n).toBe(true);
  });
});

describe("demandAllowance (tầng 2 — chỉ làm chậm)", () => {
  it("TV-AR03: velocity 30% (sma=3000) → 608_876_712_328", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, true, 3000n, 2000n)).toBe(608_876_712_328n);
  });
  it("floor clamp lên: sma=500 < floor 2000 → 405_917_808_219", () => {
    const cap = capRelease(1036n, TG, R0, G, EY, RCAP);
    expect(demandAllowance(cap, true, 500n, 2000n)).toBe(405_917_808_219n);
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
  it("TV-AR03: velocity thấp → approved = demand 608_876_712_328", () => {
    expect(approvedCumulative(1036n, TG, R0, G, EY, RCAP, true, 3000n, 2000n)).toBe(608_876_712_328n);
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
    expect(approvedCumulative(22900n, TG, R0, G, EY, RCAP, true, 10000n, 2000n) <= RCAP).toBe(true);
  });
});

describe("yearsToCap (minh hoạ cạn Reserve)", () => {
  it("R0=2tr, g=3%, cap=1.8 tỷ → ~231 năm (≥230, ≤233)", () => {
    const y = yearsToCap(R0, G, RCAP);
    expect(y).not.toBeNull();
    expect(y! >= 230n && y! <= 233n).toBe(true);
  });
  it("Reserve 90% (cap=32.4e15) → ~328 năm (≥325, ≤331)", () => {
    const y = yearsToCap(R0, G, 32_400_000_000_000_000n);
    expect(y).not.toBeNull();
    expect(y! >= 325n && y! <= 331n).toBe(true);
  });
});
