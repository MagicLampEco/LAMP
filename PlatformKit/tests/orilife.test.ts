// PlatformKit · OriLife pricing khớp animal_fee.py (cattle floor, chicken, ...) + adapter.

import { describe, it, expect } from "vitest";
import {
  estimateFeeUsd, usdToOil, makeOriLifePriceFn, oriLifeConfig, ORILIFE_BUCKETS,
} from "../platforms/orilife.js";
import { eventToCollectItem } from "../offchain/src/collectAdapter.js";
import { asciiToHex } from "../platforms/_common.js";

// Ca tham chiếu tính từ animal_fee.estimate_fee (lifecycle=1, batch_daily, demand=1.0):
//   cattle declared 0     → 0.14   (theo SÀN 400 USD)
//   cattle declared 1000  → 0.20
//   chicken declared 0    → 0.009
//   pig declared 100      → 0.065
describe("estimateFeeUsd mirror animal_fee.py", () => {
  it("cattle floor (declared 0) = 0.14", () => {
    expect(estimateFeeUsd({ species: "cattle", declaredValueUsd: 0 })).toBeCloseTo(0.14, 9);
  });
  it("cattle declared 1000 = 0.20", () => {
    expect(estimateFeeUsd({ species: "cattle", declaredValueUsd: 1000 })).toBeCloseTo(0.20, 9);
  });
  it("chicken = 0.009 (theo sàn 2.5)", () => {
    expect(estimateFeeUsd({ species: "chicken", declaredValueUsd: 0 })).toBeCloseTo(0.009, 9);
  });
  it("pig declared 100 = 0.065", () => {
    expect(estimateFeeUsd({ species: "pig", declaredValueUsd: 100 })).toBeCloseTo(0.065, 9);
  });
  it("SÀN chống khai thấp: cattle declared 0 == declared dưới sàn (vd 100)", () => {
    // declared 100 < sàn 400 → cùng dùng sàn 400 → cùng phí.
    expect(estimateFeeUsd({ species: "cattle", declaredValueUsd: 100 }))
      .toBeCloseTo(estimateFeeUsd({ species: "cattle", declaredValueUsd: 0 }), 9);
  });
  it("cap rẻ hơn truyền thống: con giá trị siêu cao vẫn ≤ traditional×0.5", () => {
    const fee = estimateFeeUsd({ species: "cattle", declaredValueUsd: 1_000_000 });
    expect(fee).toBeLessThanOrEqual(3.0 * 0.5);
  });
  it("loài lạ → fallback unknown", () => {
    expect(estimateFeeUsd({ species: "xyz", declaredValueUsd: 0 }))
      .toBeCloseTo(estimateFeeUsd({ species: "unknown", declaredValueUsd: 0 }), 9);
  });
});

describe("usdToOil (USD → oil LAMP×10^6)", () => {
  it("0.14 USD @ 0.01 USD/LAMP = 14 LAMP = 14_000_000 oil", () => {
    expect(usdToOil(0.14, 0.01)).toBe(14_000_000n);
  });
  it("lampUsd ≤ 0 → ném lỗi", () => {
    expect(() => usdToOil(1, 0)).toThrow(/dương/);
  });
});

describe("OriLife PriceFn adapter", () => {
  const lampPolicy = "ab".repeat(28);
  const priceFn = makeOriLifePriceFn({ lampPolicy, lampUsd: 0.01 });

  it("animal.enroll cattle → CollectItem LAMP, amount = oil(0.14), bucket PROTOCOL", () => {
    const item = eventToCollectItem(
      { eventType: "animal.enroll", payer: "11".repeat(28),
        extra: { species: "cattle", declaredValueUsd: 0 } },
      priceFn,
    );
    expect(item).not.toBeNull();
    expect(item!.policy).toBe(lampPolicy);
    expect(item!.name).toBe(asciiToHex("LAMP"));
    expect(item!.amount).toBe(14_000_000n);
    expect(item!.category).toBe(ORILIFE_BUCKETS.PROTOCOL);
  });

  it("animal.verify → phí phẳng 0.008 USD = 800_000 oil", () => {
    const item = eventToCollectItem(
      { eventType: "animal.verify", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(usdToOil(0.008, 0.01));
    expect(item!.amount).toBe(800_000n);
  });

  it("fruit.lifecycle → phí phẳng 0.006 USD", () => {
    const item = eventToCollectItem(
      { eventType: "fruit.lifecycle", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(usdToOil(0.006, 0.01));
  });

  it("tree.verify_add không value → ≥ phí phẳng 0.02 USD", () => {
    const item = eventToCollectItem(
      { eventType: "tree.verify_add", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(usdToOil(0.02, 0.01));
  });

  it("event lạ → null", () => {
    expect(eventToCollectItem({ eventType: "nope", payer: "11".repeat(28) }, priceFn)).toBeNull();
  });
});

describe("oriLifeConfig", () => {
  it("accepted = [LAMP, ADA], cutBps 700, 3 bucket", () => {
    const cfg = oriLifeConfig({
      lampPolicy: "ab".repeat(28),
      registryAuthority: "cd".repeat(28),
      msPerEpoch: 86_400_000n,
      reservedMinAda: 2_000_000n,
      genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
    });
    expect(cfg.cutBps).toBe(700n);
    expect(cfg.acceptedAssets.length).toBe(2);
    expect(cfg.acceptedAssets[0]!.name).toBe(asciiToHex("LAMP"));
    expect(cfg.acceptedAssets[1]).toEqual({ policy: "", name: "" });   // ADA.
    expect(cfg.buckets.map((b) => b.label)).toEqual(["protocol", "lampnet_reward", "anchor"]);
  });
});
