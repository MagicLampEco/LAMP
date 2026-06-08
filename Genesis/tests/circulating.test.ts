// Test circulating đa pot — C-INV (0 ≤ circ ≤ A) + 3 trạng thái (genesis/vest/thu-phí).

import { describe, it, expect } from "vitest";
import { genesisPots, TOTAL_SUPPLY_OIL, OIL_PER_LAMP, type PotShare } from "../offchain/src/split.js";
import {
  circulating, circulatingLamp, sumPotBalances, applyPotDelta, potBalance,
} from "../offchain/src/circulating.js";

const A = TOTAL_SUPPLY_OIL;

describe("circulating @genesis = 0 (G-CIRC-0)", () => {
  const pots = genesisPots();
  it("Σ pots == A ⇒ circulating == 0", () => {
    expect(sumPotBalances(pots)).toBe(A);
    expect(circulating(pots)).toBe(0n);
  });
  it("circulatingLamp == 0", () => {
    expect(circulatingLamp(pots)).toBe(0n);
  });
});

describe("sau VEST (Distribution chi ra ví user) → circulating tăng đúng lượng", () => {
  it("vest 100 tLAMP từ Distribution → circulating = 100 tLAMP, A bất biến", () => {
    const D = 100n * OIL_PER_LAMP;
    const after = applyPotDelta(genesisPots(), "Distribution", -D);
    expect(circulating(after)).toBe(D);
    expect(circulatingLamp(after)).toBe(100n);
    // tổng cung không đổi (token rời pot, vào lưu hành — KHÔNG burn/mint).
    expect(sumPotBalances(after) + circulating(after)).toBe(A);
  });
});

describe("sau THU PHÍ (Treasury nhận tLAMP) → circulating giảm (rời lưu hành, KHÔNG burn)", () => {
  it("vest 1000 rồi thu 300 về Treasury → circulating = 700, A bất biến", () => {
    const vest = 1_000n * OIL_PER_LAMP;
    const fee  = 300n * OIL_PER_LAMP;
    let pots: PotShare[] = applyPotDelta(genesisPots(), "Distribution", -vest); // circ=1000
    pots = applyPotDelta(pots, "Treasury", fee);                                // circ=700
    expect(circulating(pots)).toBe(vest - fee);
    expect(sumPotBalances(pots) + circulating(pots)).toBe(A);
  });
});

describe("sau BOND vào Deposits → circulating giảm tạm thời, hoàn lại tăng lại", () => {
  it("vest 500, bond 200 vào Deposits, rồi hoàn 200 → circ về 500", () => {
    const vest = 500n * OIL_PER_LAMP;
    const bond = 200n * OIL_PER_LAMP;
    let pots = applyPotDelta(genesisPots(), "Distribution", -vest);
    pots = applyPotDelta(pots, "Deposits", bond);
    expect(circulating(pots)).toBe(vest - bond);
    pots = applyPotDelta(pots, "Deposits", -bond); // hoàn lại
    expect(circulating(pots)).toBe(vest);
  });
});

describe("C-INV + chặn kế toán hỏng (đòn #3: circulating sai)", () => {
  it("0 ≤ circulating ≤ A ở mọi bước", () => {
    let pots = genesisPots();
    for (const d of [-1_000n, -5_000n, 2_000n]) {
      pots = applyPotDelta(pots, "Distribution", d * OIL_PER_LAMP);
      const c = circulating(pots);
      expect(c >= 0n && c <= A).toBe(true);
    }
  });
  it("Σ pots > total → throw (vi phạm bảo toàn)", () => {
    const bad: PotShare[] = [{ pot: "Distribution", value: A + 1n }];
    expect(() => circulating(bad)).toThrow(/CIRC-003/);
  });
  it("pot âm sau delta → throw", () => {
    expect(() => applyPotDelta(genesisPots(), "Treasury", -1n)).toThrow(/CIRC-004/);
  });
  it("pot không tồn tại → throw", () => {
    // @ts-expect-error test runtime guard với tên pot sai
    expect(() => applyPotDelta(genesisPots(), "Nope", 1n)).toThrow(/CIRC-005/);
  });
  it("potBalance = value pot", () => {
    expect(potBalance({ pot: "Reserve", value: 42n })).toBe(42n);
  });
});
