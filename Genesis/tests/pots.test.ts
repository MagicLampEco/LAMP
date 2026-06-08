// Test planGenesisPots — G-SUM + G-SEED (seedDatumOk) + 4 instance_id phân biệt +
// đòn #2 (Reserve tách) + #6 (seed sổ≠value) + #7 (NFT trùng).

import { describe, it, expect } from "vitest";
import { planGenesisPots, TLAMP_ASSET_NAME, GENESIS_BUCKET } from "../offchain/src/pots.js";
import { POT_ID, TOTAL_SUPPLY_OIL, OIL_PER_LAMP } from "../offchain/src/split.js";
import { assetKey, ledgerValue } from "@magiclamp/treasury-sdk";

const A = TOTAL_SUPPLY_OIL;
const TLAMP_POLICY = "ab".repeat(28); // 28-byte hex
const tlamp = { policy: TLAMP_POLICY, name: TLAMP_ASSET_NAME };
const RESERVED = 2_000_000n; // min-ADA mỗi custody

function plan() {
  return planGenesisPots({
    tlamp,
    governanceRef:  "9999",
    cutBps:         1_000n,
    epoch:          0n,
    reservedMinAda: RESERVED,
  });
}

describe("planGenesisPots — 4 pot datum", () => {
  const plans = plan();

  it("đúng 4 pot D/R/T/Dep", () => {
    expect(plans.map((p) => p.pot)).toEqual(["Distribution", "Reserve", "Treasury", "Deposits"]);
  });

  it("instance_id = POT_ID, 4 cái phân biệt (đòn #7)", () => {
    expect(plans.map((p) => p.instanceId)).toEqual([
      POT_ID.Distribution, POT_ID.Reserve, POT_ID.Treasury, POT_ID.Deposits,
    ]);
    expect(new Set(plans.map((p) => p.datum.instance_id)).size).toBe(4);
  });

  it("value: Distribution 34.2 tỷ, Reserve 1.8 tỷ, Treasury+Deposits 0 (oil)", () => {
    expect(plans[0]!.value).toBe(34_200_000_000n * OIL_PER_LAMP);
    expect(plans[1]!.value).toBe(1_800_000_000n * OIL_PER_LAMP);
    expect(plans[2]!.value).toBe(0n);
    expect(plans[3]!.value).toBe(0n);
  });

  it("G-SUM: Σ 4 pot value == A", () => {
    expect(plans.reduce((s, p) => s + p.value, 0n)).toBe(A);
  });
});

describe("G-SEED — sổ↔value mỗi pot (đòn #6: seed sổ≠value)", () => {
  const plans = plan();

  it("pot có token: sổ 1 dòng tLAMP = share; expectedValue = tLAMP + reserved", () => {
    const dist = plans[0]!;
    expect(dist.datum.ledger).toHaveLength(1);
    expect(dist.datum.ledger[0]).toEqual({
      bucket_id: GENESIS_BUCKET, policy: TLAMP_POLICY, name: TLAMP_ASSET_NAME,
      amount: 34_200_000_000n * OIL_PER_LAMP,
    });
    expect(dist.expectedValue[assetKey(TLAMP_POLICY, TLAMP_ASSET_NAME)]).toBe(dist.value);
    expect(dist.expectedValue[assetKey("", "")]).toBe(RESERVED);
  });

  it("pot rỗng (Treasury/Deposits): sổ tLAMP rỗng, chỉ reserved lovelace", () => {
    const tre = plans[2]!;
    expect(tre.datum.ledger).toHaveLength(0);
    expect(ledgerValue(tre.datum.ledger)).toEqual({});
    expect(tre.expectedValue[assetKey("", "")]).toBe(RESERVED);
    expect(tre.expectedValue[assetKey(TLAMP_POLICY, TLAMP_ASSET_NAME)]).toBeUndefined();
  });

  it("accepted_assets = [ADA, tLAMP] mọi pot", () => {
    for (const p of plans) {
      expect(p.datum.accepted_assets).toEqual([
        { policy: "", name: "" },
        { policy: TLAMP_POLICY, name: TLAMP_ASSET_NAME },
      ]);
    }
  });

  it("consumed_proposals rỗng + cut_bps/governance_ref/epoch đúng", () => {
    for (const p of plans) {
      expect(p.datum.consumed_proposals).toEqual([]);
      expect(p.datum.cut_bps).toBe(1_000n);
      expect(p.datum.governance_ref).toBe("9999");
      expect(p.datum.epoch).toBe(0n);
    }
  });
});

describe("đòn #2 — Reserve TÁCH thật khỏi Treasury (4 datum riêng)", () => {
  it("Reserve + Treasury là 2 datum khác instance_id, sổ độc lập", () => {
    const plans = plan();
    const reserve = plans.find((p) => p.pot === "Reserve")!;
    const treasury = plans.find((p) => p.pot === "Treasury")!;
    expect(reserve.datum.instance_id).not.toBe(treasury.datum.instance_id);
    // Reserve giữ 1.8 tỷ, Treasury 0 — value vật lý tách (4 UTxO/4 hash on-chain).
    expect(reserve.value).toBe(1_800_000_000n * OIL_PER_LAMP);
    expect(treasury.value).toBe(0n);
  });
});

describe("chặn input sai", () => {
  it("cut_bps ngoài [0,10000] → throw", () => {
    expect(() => planGenesisPots({
      tlamp, governanceRef: "99", cutBps: 10_001n, epoch: 0n, reservedMinAda: RESERVED,
    })).toThrow(/POTS-001/);
  });
  it("reserved_min_ada < 0 → throw", () => {
    expect(() => planGenesisPots({
      tlamp, governanceRef: "99", cutBps: 0n, epoch: 0n, reservedMinAda: -1n,
    })).toThrow(/POTS-002/);
  });
  it("reserved=0 hợp lệ (pot rỗng vẫn seed ok)", () => {
    const plans = planGenesisPots({
      tlamp, governanceRef: "99", cutBps: 0n, epoch: 0n, reservedMinAda: 0n,
    });
    expect(plans).toHaveLength(4);
    expect(plans[2]!.expectedValue).toEqual({}); // Treasury rỗng, reserved 0 → value rỗng
  });
});
