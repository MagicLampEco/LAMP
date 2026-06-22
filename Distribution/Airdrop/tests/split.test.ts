// Airdrop split 20:100 — số liệu chốt + bất biến ngân sách.
import { describe, it, expect } from "vitest";
import { splitEpoch, totalAcrossEpochs, assertBudgetInvariant } from "../offchain/src/split.js";
import { PER_EPOCH_OIL, AIRDROP_TOTAL_OIL, lampToOil } from "../offchain/src/constants.js";

describe("Airdrop split 20:100", () => {
  it("B_spo = 4.000 nghìn LAMP, B_del = 20.000 nghìn LAMP (oil)", () => {
    const { spoBudgetOil, delegatorBudgetOil } = splitEpoch();
    expect(spoBudgetOil).toBe(lampToOil(4_000_000n));        // 4.000 nghìn = 4M LAMP
    expect(delegatorBudgetOil).toBe(lampToOil(20_000_000n)); // 20.000 nghìn = 20M LAMP
  });

  it("B_spo + B_del == PER_EPOCH", () => {
    const s = splitEpoch();
    expect(s.spoBudgetOil + s.delegatorBudgetOil).toBe(PER_EPOCH_OIL);
  });

  it("tổng 5 epoch == AIRDROP_TOTAL (120.000 nghìn LAMP)", () => {
    expect(totalAcrossEpochs()).toBe(AIRDROP_TOTAL_OIL);
  });

  it("assertBudgetInvariant không throw", () => {
    expect(() => assertBudgetInvariant()).not.toThrow();
  });

  it("dư floor → Delegator; tổng bảo toàn với budget lẻ", () => {
    const odd = 1_000_000_007n; // không chia hết cho 120
    const { spoBudgetOil, delegatorBudgetOil } = splitEpoch(odd);
    expect(spoBudgetOil + delegatorBudgetOil).toBe(odd);
    expect(spoBudgetOil).toBe((odd * 20n) / 120n);
  });
});
