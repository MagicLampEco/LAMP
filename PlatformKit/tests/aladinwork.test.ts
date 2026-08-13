// PlatformKit · AladinWork marketplace pricing (§7B Farm-W1) — 2 tầng phí, 5 event.

import { describe, it, expect } from "vitest";
import {
  estimateTaskFeeUsd, makeAladinWorkPriceFn, aladinWorkConfig, ALADINWORK_BUCKETS,
} from "../examples/aladinwork.js";
import { usdToOildrop } from "../examples/orilife.js";
import { eventToCollectItem } from "../offchain/src/collectAdapter.js";
import { asciiToHex } from "../offchain/src/encoding.js";

// Ca tham chiếu (demand=1.0, anchorTier=batch_daily → tier_mult=1.0):
//   tree.identify  → 0.004                       (phẳng base)
//   residue.test   → 0.05                         (phẳng base, cao hơn)
//   task.post d=0  → 0.0125  (base 0.01 + sàn5×5bps=0.0025)
//   task.complete d=100 → 3.02  (base 0.02 + 100×300bps=3.0) = 3% hoa hồng
//   drone.spray d=50    → 0.53  (base 0.03 + 50×100bps=0.5)
describe("estimateTaskFeeUsd (§7B công thức 2 tầng)", () => {
  it("tree.identify phẳng = 0.004", () => {
    expect(estimateTaskFeeUsd({ eventType: "tree.identify" })).toBeCloseTo(0.004, 9);
  });
  it("residue.test phẳng = 0.05", () => {
    expect(estimateTaskFeeUsd({ eventType: "residue.test" })).toBeCloseTo(0.05, 9);
  });
  it("task.post sàn (declared 0) = 0.0125", () => {
    expect(estimateTaskFeeUsd({ eventType: "task.post", declaredValueUsd: 0 })).toBeCloseTo(0.0125, 9);
  });
  it("task.complete declared 100 = 3.02 (3% hoa hồng)", () => {
    expect(estimateTaskFeeUsd({ eventType: "task.complete", declaredValueUsd: 100 })).toBeCloseTo(3.02, 9);
  });
  it("drone.spray declared 50 = 0.53", () => {
    expect(estimateTaskFeeUsd({ eventType: "drone.spray", declaredValueUsd: 50 })).toBeCloseTo(0.53, 9);
  });
  it("SÀN chống khai thấp: task.complete declared 5 == declared 0 (cùng sàn 20)", () => {
    expect(estimateTaskFeeUsd({ eventType: "task.complete", declaredValueUsd: 5 }))
      .toBeCloseTo(estimateTaskFeeUsd({ eventType: "task.complete", declaredValueUsd: 0 }), 9);
  });
  it("cap rẻ hơn truyền thống: demand cao + anchor immediate vẫn ≤ 7.5% giá trị deal", () => {
    // declared 1000, demand 3, immediate(×6): raw rất lớn → cap = 1000×15%×0.5 = 75.
    const fee = estimateTaskFeeUsd({
      eventType: "task.complete", declaredValueUsd: 1000, demandFactor: 3, anchorTier: "immediate",
    });
    expect(fee).toBeLessThanOrEqual(1000 * 0.15 * 0.5);   // 75
    expect(fee).toBeCloseTo(75, 6);
  });
  it("event lạ → ném lỗi", () => {
    expect(() => estimateTaskFeeUsd({ eventType: "nope" })).toThrow(/event lạ/);
  });
});

describe("AladinWork PriceFn adapter (tầng ① — LAMP cut Treasury)", () => {
  const lampPolicy = "ab".repeat(28);
  const priceFn = makeAladinWorkPriceFn({ lampPolicy, lampUsd: 0.01 });

  it("task.complete → CollectItem LAMP, amount = oildrop(3.02), bucket PROTOCOL", () => {
    const item = eventToCollectItem(
      { eventType: "task.complete", payer: "11".repeat(28), extra: { declaredValueUsd: 100 } },
      priceFn,
    );
    expect(item).not.toBeNull();
    expect(item!.policy).toBe(lampPolicy);
    expect(item!.name).toBe(asciiToHex("LAMP"));
    expect(item!.amount).toBe(usdToOildrop(3.02, 0.01));
    expect(item!.amount).toBe(302_000_000n);
    expect(item!.category).toBe(ALADINWORK_BUCKETS.PROTOCOL);
  });

  it("tree.identify phẳng → oildrop(0.004) = 400_000", () => {
    const item = eventToCollectItem(
      { eventType: "tree.identify", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(400_000n);
  });

  it("residue.test phẳng → oildrop(0.05) = 5_000_000", () => {
    const item = eventToCollectItem(
      { eventType: "residue.test", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(5_000_000n);
  });

  it("event ngoài 5 loại → null (không thu qua adapter này)", () => {
    expect(eventToCollectItem({ eventType: "createDID", payer: "11".repeat(28) }, priceFn)).toBeNull();
  });
});

describe("aladinWorkConfig", () => {
  it("accepted = [LAMP, ADA], cutBps 1000 (đề xuất), 3 bucket protocol/dispute/anchor", () => {
    const cfg = aladinWorkConfig({
      lampPolicy: "ab".repeat(28),
      registryAuthority: "cd".repeat(28),
      msPerEpoch: 86_400_000n,
      reservedMinAda: 2_000_000n,
      genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
    });
    expect(cfg.cutBps).toBe(1000n);
    expect(cfg.acceptedAssets.length).toBe(2);
    expect(cfg.acceptedAssets[1]).toEqual({ policy: "", name: "" });   // ADA.
    expect(cfg.buckets.map((b) => b.label)).toEqual(["protocol", "dispute", "anchor"]);
  });
  it("cutBps override được (Aladin/DAO chốt)", () => {
    const cfg = aladinWorkConfig({
      lampPolicy: "ab".repeat(28), registryAuthority: "cd".repeat(28),
      msPerEpoch: 86_400_000n, reservedMinAda: 2_000_000n,
      genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
      cutBps: 800n,
    });
    expect(cfg.cutBps).toBe(800n);
  });
});
