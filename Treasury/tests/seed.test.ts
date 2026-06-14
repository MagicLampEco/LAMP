// Test off-chain seed invariant — mirror onchain custody_seed validator.
// Bất biến nền: ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a).
// Các hàm này để off-chain DỰNG đúng seed + tự kiểm trước khi build genesis tx.

import { describe, it, expect } from "vitest";
import {
  type AssetMap, assetKey,
  ledgerValue, seedValue, seedValueOk, allLinesAccepted, seedDatumOk,
  valueWithoutPolicy,
} from "../offchain/src/collect.js";
import type { CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "4c414d50";
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");

// Custody NFT one-shot (authenticity) — BẮT BUỘC nằm trong custody.value on-chain.
// seedValueOk PHẢI trừ policy này trước khi đối chiếu sổ.
const NFT_POLICY = "cccc".repeat(14); // 56 hex
const INSTANCE_ID = "abcd";
const nftK = assetKey(NFT_POLICY, INSTANCE_ID);
/** Thêm 1 custody NFT vào value (mô phỏng custody UTxO trung thực on-chain). */
function withNft(v: AssetMap): AssetMap {
  return { ...v, [nftK]: 1n };
}

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

describe("valueWithoutPolicy — trừ custody NFT khỏi value", () => {
  it("trừ đúng policy NFT, giữ nguyên LAMP/ADA", () => {
    const v = withNft({ [lampK]: 1500n, [adaK]: 5_000_000n });
    expect(valueWithoutPolicy(v, NFT_POLICY)).toEqual({ [lampK]: 1500n, [adaK]: 5_000_000n });
  });
  it("policy rỗng → no-op (không trừ lovelace)", () => {
    expect(valueWithoutPolicy({ [adaK]: 5_000_000n }, "")).toEqual({ [adaK]: 5_000_000n });
  });
});

describe("seedValueOk — ÉP bất biến nền sổ↔value (TRỪ custody NFT)", () => {
  // value TRUNG THỰC: luôn KÈM custody NFT (đúng như on-chain). seedValueOk trừ NFT.
  const okValue: AssetMap = withNft({ [lampK]: 1500n, [adaK]: 5_000_000n });

  it("seed đúng — NFT trong value + sổ đúng → true (fix trừ NFT)", () => {
    expect(seedValueOk(okValue, happyLedger, 2_000_000n, NFT_POLICY)).toBe(true);
  });
  it("KHÔNG trừ NFT (policy rỗng) → false — chứng minh fix cần thiết", () => {
    // value dư đúng 1 NFT so với sổ → nếu không trừ thì lệch → false.
    expect(seedValueOk(okValue, happyLedger, 2_000_000n)).toBe(false);
  });
  it("thiếu lovelace reserved → false", () => {
    expect(seedValueOk(withNft({ [lampK]: 1500n, [adaK]: 3_000_000n }), happyLedger, 2_000_000n, NFT_POLICY)).toBe(false);
  });
  it("thừa asset không booked (LAMP 2000 > sổ 1500) → false", () => {
    expect(seedValueOk(withNft({ [lampK]: 2000n, [adaK]: 5_000_000n }), happyLedger, 2_000_000n, NFT_POLICY)).toBe(false);
  });
  it("booked thiếu value (LAMP 1000 < sổ 1500) → false", () => {
    expect(seedValueOk(withNft({ [lampK]: 1000n, [adaK]: 5_000_000n }), happyLedger, 2_000_000n, NFT_POLICY)).toBe(false);
  });
  it("book NFT thành 1 dòng sổ → false (NFT không phải tài sản kế toán)", () => {
    // ai đó cố né bằng cách ghi NFT vào sổ; accounted (đã trừ NFT) thiếu so với sổ → false.
    const ledgerWithNft: LedgerEntry[] = [
      ...happyLedger,
      { bucket_id: 1n, policy: NFT_POLICY, name: INSTANCE_ID, amount: 1n },
    ];
    expect(seedValueOk(okValue, ledgerWithNft, 2_000_000n, NFT_POLICY)).toBe(false);
  });
  it("reserved âm → false", () => {
    expect(seedValueOk(okValue, happyLedger, -1n, NFT_POLICY)).toBe(false);
  });
  it("sổ rỗng + reserved = value (custody chỉ giữ min-ADA + NFT)", () => {
    expect(seedValueOk(withNft({ [adaK]: 2_000_000n }), [], 2_000_000n, NFT_POLICY)).toBe(true);
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

describe("seedDatumOk — gương đủ custody_seed validator (value KÈM NFT)", () => {
  const okValue: AssetMap = withNft({ [lampK]: 1500n, [adaK]: 5_000_000n });

  it("seed hợp lệ toàn phần → true", () => {
    expect(seedDatumOk(okValue, datum(happyLedger), 2_000_000n, NFT_POLICY)).toBe(true);
  });
  it("dòng trùng khóa (no_dup_lines fail) → false", () => {
    const dup: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 750n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 750n },
    ];
    // tổng = 1500 = value nên seedValueOk pass, nhưng noDupLines fail → seedDatumOk false.
    expect(seedDatumOk(withNft({ [lampK]: 1500n, [adaK]: 2_000_000n }), datum(dup), 2_000_000n, NFT_POLICY)).toBe(false);
  });
  it("dòng không accepted → false", () => {
    const bad: LedgerEntry[] = [{ bucket_id: 1n, policy: "dead", name: "beef", amount: 10n }];
    expect(seedDatumOk(withNft({ ["dead|beef"]: 10n, [adaK]: 2_000_000n }), datum(bad), 2_000_000n, NFT_POLICY)).toBe(false);
  });
  it("sổ≠value → false", () => {
    expect(seedDatumOk(withNft({ [lampK]: 2000n, [adaK]: 5_000_000n }), datum(happyLedger), 2_000_000n, NFT_POLICY)).toBe(false);
  });
});
