// Test off-chain seed invariant — mirror onchain custody_seed validator (hardening v1).
// Bất biến nền: ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a) − NFT.
// value seed = ledgerValue ⊕ reserved_min_ada ⊕ 1 NFT (seed_policy, instance_id).
// Các hàm này để off-chain DỰNG đúng seed + tự kiểm trước khi build genesis tx.

import { describe, it, expect } from "vitest";
import {
  type AssetMap, assetKey,
  ledgerValue, seedValue, seedValueOk, allLinesAccepted, seedDatumOk,
  isCanonical, canonicalizeLedger,
} from "../offchain/src/collect.js";
import { planSeed } from "../offchain/src/seedBuilder.js";
import type { CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

const LAMP_POLICY = "aabb".repeat(14); // 56 hex = 28 byte
const LAMP_NAME = "4c414d50";
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");

// seed_policy (PolicyId NFT authenticity) + instance_id = NFT name.
const SEED_POLICY = "11ee".repeat(14); // 28-byte hex
const INSTANCE_ID = "abcd";
const nftK = assetKey(SEED_POLICY, INSTANCE_ID);

function datum(ledger: LedgerEntry[], over: Partial<CustodyDatum> = {}): CustodyDatum {
  return {
    instance_id: INSTANCE_ID,
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

// Sổ mẫu CANONICAL (sorted theo (bucket, policy, name)): ADA bucket1, LAMP bucket1, LAMP bucket2.
// Khóa: lovelace policy "" < LAMP policy aabb… nên ở bucket 1, ADA đứng trước LAMP.
const happyLedger: LedgerEntry[] = canonicalizeLedger([
  { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n },
  { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n },
  { bucket_id: 1n, policy: "", name: "", amount: 3_000_000n },
]);

// value seed kỳ vọng cho happyLedger với reserved 2_000_000: sổ ⊕ reserved ⊕ NFT.
function okValueFor(reserved: bigint): AssetMap {
  return {
    [lampK]: 1500n,
    [adaK]: 3_000_000n + reserved,
    [nftK]: 1n,
  };
}

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

describe("seedValue — ledgerValue ⊕ reserved_min_ada ⊕ NFT", () => {
  it("cộng reserved vào lovelace + NFT qty 1", () => {
    expect(seedValue(happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toEqual({
      [lampK]: 1500n,
      [adaK]: 5_000_000n,
      [nftK]: 1n,
    });
  });
  it("reserved=0 → ledgerValue ⊕ NFT", () => {
    expect(seedValue(happyLedger, 0n, SEED_POLICY, INSTANCE_ID)).toEqual({
      [lampK]: 1500n,
      [adaK]: 3_000_000n,
      [nftK]: 1n,
    });
  });
});

describe("seedValueOk — ÉP bất biến nền sổ↔value (gồm NFT authenticity)", () => {
  it("seed đúng (value = sổ ⊕ reserved ⊕ NFT) → true", () => {
    expect(seedValueOk(okValueFor(2_000_000n), happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(true);
  });
  it("THIẾU NFT authenticity → false", () => {
    const noNft: AssetMap = { [lampK]: 1500n, [adaK]: 5_000_000n }; // không có NFT
    expect(seedValueOk(noNft, happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(false);
  });
  it("NFT qty ≠ 1 (qty 2) → false", () => {
    const bad: AssetMap = { [lampK]: 1500n, [adaK]: 5_000_000n, [nftK]: 2n };
    expect(seedValueOk(bad, happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(false);
  });
  it("thiếu lovelace reserved → false", () => {
    const bad: AssetMap = { [lampK]: 1500n, [adaK]: 3_000_000n, [nftK]: 1n };
    expect(seedValueOk(bad, happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(false);
  });
  it("thừa asset không booked (LAMP 2000 > sổ 1500) → false", () => {
    const bad: AssetMap = { [lampK]: 2000n, [adaK]: 5_000_000n, [nftK]: 1n };
    expect(seedValueOk(bad, happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(false);
  });
  it("booked thiếu value (LAMP 1000 < sổ 1500) → false", () => {
    const bad: AssetMap = { [lampK]: 1000n, [adaK]: 5_000_000n, [nftK]: 1n };
    expect(seedValueOk(bad, happyLedger, 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(false);
  });
  it("reserved âm → false", () => {
    expect(seedValueOk(okValueFor(2_000_000n), happyLedger, -1n, SEED_POLICY, INSTANCE_ID)).toBe(false);
  });
  it("sổ rỗng + reserved + NFT = value (custody chỉ giữ min-ADA + NFT)", () => {
    expect(seedValueOk({ [adaK]: 2_000_000n, [nftK]: 1n }, [], 2_000_000n, SEED_POLICY, INSTANCE_ID)).toBe(true);
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

describe("seedDatumOk — gương đủ custody_seed validator (hardening v1)", () => {
  it("seed hợp lệ toàn phần → true", () => {
    expect(seedDatumOk(okValueFor(2_000_000n), datum(happyLedger), 2_000_000n, SEED_POLICY)).toBe(true);
  });

  it("THIẾU NFT trong value → false", () => {
    const noNft: AssetMap = { [lampK]: 1500n, [adaK]: 5_000_000n };
    expect(seedDatumOk(noNft, datum(happyLedger), 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("cut_bps > 10000 (S-CUT-0) → false", () => {
    const d = datum(happyLedger, { cut_bps: 10001n });
    expect(seedDatumOk(okValueFor(2_000_000n), d, 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("cut_bps < 0 (S-CUT-0, cut âm drain) → false", () => {
    const d = datum(happyLedger, { cut_bps: -1n });
    expect(seedDatumOk(okValueFor(2_000_000n), d, 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("cut_bps = 0 và = 10000 biên hợp lệ → true", () => {
    for (const cb of [0n, 10000n]) {
      const d = datum(happyLedger, { cut_bps: cb });
      expect(seedDatumOk(okValueFor(2_000_000n), d, 2_000_000n, SEED_POLICY)).toBe(true);
    }
  });

  it("instance_id rỗng (S-ID-0) → false", () => {
    // instance_id="" ⇒ NFT name="" ⇒ nftK đổi. Value khớp NFT name="" vẫn fail S-ID-0.
    const d = datum(happyLedger, { instance_id: "" });
    const nk = assetKey(SEED_POLICY, "");
    const v: AssetMap = { [lampK]: 1500n, [adaK]: 5_000_000n, [nk]: 1n };
    expect(seedDatumOk(v, d, 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("accepted_assets rỗng (S-ACC-1) → false", () => {
    // sổ rỗng để qua S-ACC-0, nhưng accepted=[] fail S-ACC-1.
    const v: AssetMap = { [adaK]: 2_000_000n, [nftK]: 1n };
    const d = datum([], { accepted_assets: [] });
    expect(seedDatumOk(v, d, 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("consumed_proposals != [] (S-CONSUMED-0, seed pre-mark né replay) → false", () => {
    const d = datum(happyLedger, { consumed_proposals: ["dead"] });
    expect(seedDatumOk(okValueFor(2_000_000n), d, 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("sổ KHÔNG canonical: dòng trùng khóa → false", () => {
    const dup: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 750n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 750n },
    ];
    const v: AssetMap = { [lampK]: 1500n, [adaK]: 2_000_000n, [nftK]: 1n };
    expect(seedDatumOk(v, datum(dup), 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("sổ KHÔNG canonical: chưa sort theo khóa → false", () => {
    // bucket 2 đứng trước bucket 1 → strict_sorted false.
    const unsorted: LedgerEntry[] = [
      { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n },
    ];
    const v: AssetMap = { [lampK]: 1500n, [adaK]: 2_000_000n, [nftK]: 1n };
    expect(seedDatumOk(v, datum(unsorted), 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("sổ KHÔNG canonical: có dòng 0 (chưa prune) → false", () => {
    const withZero: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 0n },
    ];
    const v: AssetMap = { [adaK]: 2_000_000n, [nftK]: 1n };
    expect(seedDatumOk(v, datum(withZero), 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("dòng không accepted → false", () => {
    const bad: LedgerEntry[] = [{ bucket_id: 1n, policy: "dead", name: "beef", amount: 10n }];
    expect(seedDatumOk({ ["dead|beef"]: 10n, [adaK]: 2_000_000n, [nftK]: 1n }, datum(bad), 2_000_000n, SEED_POLICY)).toBe(false);
  });

  it("sổ≠value → false", () => {
    const bad: AssetMap = { [lampK]: 2000n, [adaK]: 5_000_000n, [nftK]: 1n };
    expect(seedDatumOk(bad, datum(happyLedger), 2_000_000n, SEED_POLICY)).toBe(false);
  });
});

describe("planSeed — orchestration genesis (mirror custody_seed validator)", () => {
  it("happy: dựng datum canonical + value gồm NFT + consumed=[]", () => {
    // sổ thô chưa sort + có dòng 0 — planSeed canonical hoá.
    const raw: LedgerEntry[] = [
      { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n },
      { bucket_id: 1n, policy: "", name: "", amount: 3_000_000n },
      { bucket_id: 9n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 0n }, // prune
    ];
    const d = datum(raw, { consumed_proposals: [] });
    const plan = planSeed(d, SEED_POLICY, 2_000_000n);

    expect(isCanonical(plan.datum.ledger)).toBe(true);
    expect(plan.datum.ledger.some((e) => e.amount === 0n)).toBe(false); // pruned
    expect(plan.datum.consumed_proposals).toEqual([]);
    expect(plan.seedPolicy).toBe(SEED_POLICY);
    expect(plan.nftName).toBe(INSTANCE_ID);
    expect(plan.custodyValue[nftK]).toBe(1n);
    expect(plan.custodyValue[lampK]).toBe(1500n);
    expect(plan.custodyValue[adaK]).toBe(5_000_000n);
    // tự kiểm gương validator
    expect(seedDatumOk(plan.custodyValue, plan.datum, 2_000_000n, SEED_POLICY)).toBe(true);
  });

  it("ép consumed=[] kể cả datum đầu vào có pre-mark", () => {
    const d = datum(happyLedger, { consumed_proposals: ["beef"] });
    const plan = planSeed(d, SEED_POLICY, 2_000_000n);
    expect(plan.datum.consumed_proposals).toEqual([]);
  });

  it("ném lỗi khi sổ có dòng ÂM (không canonical hoá được)", () => {
    const neg: LedgerEntry[] = [
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: -5n },
    ];
    expect(() => planSeed(datum(neg), SEED_POLICY, 2_000_000n)).toThrow(/LEDGER-NEG/);
  });

  it("ném SEED-001 khi cut_bps ngoài [0,10000]", () => {
    const d = datum(happyLedger, { cut_bps: 20000n });
    expect(() => planSeed(d, SEED_POLICY, 2_000_000n)).toThrow(/SEED-001/);
  });

  it("ném SEED-002 khi reserved âm", () => {
    expect(() => planSeed(datum(happyLedger), SEED_POLICY, -1n)).toThrow(/SEED-002/);
  });
});
