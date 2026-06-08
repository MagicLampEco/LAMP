// Test splitGenesis + genesisPots — G-SUM (Σ==total) + dồn remainder + cấu hình 95/5.

import { describe, it, expect } from "vitest";
import {
  splitGenesis, genesisPots, sumPots, type Allocation,
  TOTAL_SUPPLY_OIL, TOTAL_SUPPLY_LAMP, OIL_PER_LAMP,
  DISTRIBUTION_BPS, RESERVE_BPS, GENESIS_ALLOCATION, POT_ID,
} from "../offchain/src/split.js";

const A = TOTAL_SUPPLY_OIL; // 36e9 × 1e6

describe("hằng số tổng cung", () => {
  it("36 tỷ tLAMP, 10^6 oil/LAMP", () => {
    expect(TOTAL_SUPPLY_LAMP).toBe(36_000_000_000n);
    expect(OIL_PER_LAMP).toBe(1_000_000n);
    expect(A).toBe(36_000_000_000_000_000n); // 36e15
  });
});

describe("splitGenesis — cấu hình MagicLamp 95/5", () => {
  it("Distribution 34.2 tỷ, Reserve 1.8 tỷ (oil), chia hết → remainder 0", () => {
    const s = splitGenesis(A, GENESIS_ALLOCATION);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ pot: "Distribution", value: 34_200_000_000n * OIL_PER_LAMP });
    expect(s[1]).toEqual({ pot: "Reserve",      value:  1_800_000_000n * OIL_PER_LAMP });
  });

  it("G-SUM: Σ shares == total (tuyệt đối)", () => {
    expect(sumPots(splitGenesis(A, GENESIS_ALLOCATION))).toBe(A);
  });

  it("bps đúng 9500/500", () => {
    expect(DISTRIBUTION_BPS).toBe(9_500n);
    expect(RESERVE_BPS).toBe(500n);
    expect(DISTRIBUTION_BPS + RESERVE_BPS).toBe(10_000n);
  });
});

describe("splitGenesis — dồn remainder vào pot ĐẦU (đòn #1: rơi token lẻ)", () => {
  it("tỉ lệ lẻ 3333/3333/3334 trên 100 → Σ==100, lẻ vào pot[0]", () => {
    const alloc: Allocation[] = [
      { pot: "Distribution", bps: 3_333n },
      { pot: "Reserve",      bps: 3_333n },
      { pot: "Treasury",     bps: 3_334n },
    ];
    const s = splitGenesis(100n, alloc);
    // floor: 33,33,33 = 99; remainder 1 → pot[0] = 34.
    expect(s[0]!.value).toBe(34n);
    expect(s[1]!.value).toBe(33n);
    expect(s[2]!.value).toBe(33n);
    expect(sumPots(s)).toBe(100n);
  });

  it("total nguyên tố 9973 với 95/5 → Σ==9973 (floor cắt, remainder dồn)", () => {
    const s = splitGenesis(9_973n, GENESIS_ALLOCATION);
    // 9973×9500/10000 = 9474.35 → 9474 ; 9973×500/10000 = 498.65 → 498 ; assigned 9972 ; r=1.
    expect(s[0]!.value).toBe(9_474n + 1n); // remainder vào Distribution
    expect(s[1]!.value).toBe(498n);
    expect(sumPots(s)).toBe(9_973n);
  });

  it("total=0 → mọi share 0, Σ==0", () => {
    const s = splitGenesis(0n, GENESIS_ALLOCATION);
    expect(sumPots(s)).toBe(0n);
    expect(s.every((x) => x.value === 0n)).toBe(true);
  });

  it("Σbps < 10000 (chỉ phân bổ 80%) → remainder lớn dồn pot[0], Σ==total", () => {
    const alloc: Allocation[] = [{ pot: "Distribution", bps: 8_000n }];
    const s = splitGenesis(A, alloc);
    expect(s[0]!.value).toBe(A); // 80% floor + remainder 20% = 100% vào pot đầu
    expect(sumPots(s)).toBe(A);
  });
});

describe("splitGenesis — chặn input sai", () => {
  it("total < 0 → throw", () => {
    expect(() => splitGenesis(-1n, GENESIS_ALLOCATION)).toThrow(/SPLIT-001/);
  });
  it("allocation rỗng → throw", () => {
    expect(() => splitGenesis(A, [])).toThrow(/SPLIT-002/);
  });
  it("bps âm → throw", () => {
    expect(() => splitGenesis(A, [{ pot: "Distribution", bps: -1n }])).toThrow(/SPLIT-003/);
  });
  it("Σbps > 10000 → throw (vượt 100%)", () => {
    const alloc: Allocation[] = [
      { pot: "Distribution", bps: 9_500n },
      { pot: "Reserve",      bps: 600n },
    ];
    expect(() => splitGenesis(A, alloc)).toThrow(/SPLIT-004/);
  });
});

describe("genesisPots — 4 pot đầy đủ", () => {
  const pots = genesisPots();

  it("đúng 4 pot, thứ tự D/R/T/Dep", () => {
    expect(pots.map((p) => p.pot)).toEqual(["Distribution", "Reserve", "Treasury", "Deposits"]);
  });

  it("Distribution 34.2 tỷ, Reserve 1.8 tỷ, Treasury+Deposits 0 (oil)", () => {
    expect(pots[0]!.value).toBe(34_200_000_000n * OIL_PER_LAMP);
    expect(pots[1]!.value).toBe(1_800_000_000n * OIL_PER_LAMP);
    expect(pots[2]!.value).toBe(0n);
    expect(pots[3]!.value).toBe(0n);
  });

  it("G-SUM: Σ 4 pot == A", () => {
    expect(sumPots(pots)).toBe(A);
  });

  it("POT_ID phân biệt 4 instance_id (đòn #7: NFT trùng)", () => {
    const ids = [POT_ID.Distribution, POT_ID.Reserve, POT_ID.Treasury, POT_ID.Deposits];
    expect(new Set(ids).size).toBe(4);
  });
});
