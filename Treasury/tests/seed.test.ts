// Test off-chain seed invariant — mirror onchain custody_seed validator.
// Bất biến nền: ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a).
// Các hàm này để off-chain DỰNG đúng seed + tự kiểm trước khi build genesis tx.

import { describe, it, expect } from "vitest";
import {
  type AssetMap, assetKey,
  ledgerValue, seedValue, seedValueOk, allLinesAccepted, seedDatumOk,
} from "../offchain/src/collect.js";
import type { CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "4c414d50";
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");

function datum(ledger: LedgerEntry[], over: Partial<CustodyDatum> = {}): CustodyDatum {
  return {
    instance_id: "abcd",
    accepted_assets: [
      { policy: "", name: "" },
      { policy: LAMP_POLICY, name: LAMP_NAME },
    ],
    ledger,
    cut_bps: 1000n,
    governance_ref: "9999",
    epoch: 0n,
    consumed_proposals: [],
    ...over,
  };
}

// Sổ mẫu: ops LAMP 1000, community LAMP 500, ops ADA 3_000_000.
const happyLedger: LedgerEntry[] = [
  { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n },
  { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n },
  { bucket_id: 1n, policy: "", name: "", amount: 3_000_000n },
];

describe("ledgerValue — gộp sổ per-asset", () => {
  it("gộp LAMP 2 bucket + ADA", () => {
    expect(ledgerValue(happyLedger)).toEqual({
      [lampK]: 1500n,
      [adaK]: 3_000_000n,
    });
  });
  it("sổ rỗng → {}", () => {
    expect(ledgerValue([])).toEqual({});
  });
});

describe("seedValue — ledgerValue ⊕ reserved_min_ada", () => {
  it("cộng reserved vào lovelace", () => {
    expect(seedValue(happyLedger, 2_000_000n)).toEqual({
      [lampK]: 1500n,
      [adaK]: 5_000_000n,
    });
  });
  it("reserved=0 → đúng ledgerValue", () => {
    expect(seedValue(happyLedger, 0n)).toEqual(ledgerValue(happyLedger));
  });
});

describe("seedValueOk — ÉP bất biến nền sổ↔value", () => {
  const okValue: AssetMap = { [lampK]: 1500n, [adaK]: 5_000_000n };

  it("seed đúng (value = sổ ⊕ reserved) → true", () => {
    expect(seedValueOk(okValue, happyLedger, 2_000_000n)).toBe(true);
  });
  it("thiếu lovelace reserved → false", () => {
    expect(seedValueOk({ [lampK]: 1500n, [adaK]: 3_000_000n }, happyLedger, 2_000_000n)).toBe(false);
  });
  it("thừa asset không booked (LAMP 2000 > sổ 1500) → false", () => {
    expect(seedValueOk({ [lampK]: 2000n, [adaK]: 5_000_000n }, happyLedger, 2_000_000n)).toBe(false);
  });
  it("booked thiếu value (LAMP 1000 < sổ 1500) → false", () => {
    expect(seedValueOk({ [lampK]: 1000n, [adaK]: 5_000_000n }, happyLedger, 2_000_000n)).toBe(false);
  });
  it("reserved âm → false", () => {
    expect(seedValueOk(okValue, happyLedger, -1n)).toBe(false);
  });
  it("sổ rỗng + reserved = value (custody chỉ giữ min-ADA)", () => {
    expect(seedValueOk({ [adaK]: 2_000_000n }, [], 2_000_000n)).toBe(true);
  });
});

describe("allLinesAccepted", () => {
  const acc = datum([]).accepted_assets;
  it("mọi dòng LAMP/ADA accepted → true", () => {
    expect(allLinesAccepted(happyLedger, acc)).toBe(true);
  });
  it("dòng policy lạ → false", () => {
    const bad: LedgerEntry[] = [{ bucket_id: 1n, policy: "dead", name: "beef", amount: 10n }];
    expect(allLinesAccepted(bad, acc)).toBe(false);
  });
});

describe("seedDatumOk — gương đủ custody_seed validator", () => {
  const okValue: AssetMap = { [lampK]: 1500n, [adaK]: 5_000_000n };

  it("seed hợp lệ toàn phần → true", () => {
    expect(seedDatumOk(okValue, datum(happyLedger), 2_000_000n)).toBe(true);
  });
  it("dòng trùng khóa (no_dup_lines fail) → false", () => {
    const dup: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 750n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 750n },
    ];
    // tổng = 1500 = value nên seedValueOk pass, nhưng noDupLines fail → seedDatumOk false.
    expect(seedDatumOk({ [lampK]: 1500n, [adaK]: 2_000_000n }, datum(dup), 2_000_000n)).toBe(false);
  });
  it("dòng không accepted → false", () => {
    const bad: LedgerEntry[] = [{ bucket_id: 1n, policy: "dead", name: "beef", amount: 10n }];
    expect(seedDatumOk({ ["dead|beef"]: 10n, [adaK]: 2_000_000n }, datum(bad), 2_000_000n)).toBe(false);
  });
  it("sổ≠value → false", () => {
    expect(seedDatumOk({ [lampK]: 2000n, [adaK]: 5_000_000n }, datum(happyLedger), 2_000_000n)).toBe(false);
  });
});
