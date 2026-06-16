// PlatformKit · onboard 2-bước plan: seed (Treasury) → register (PlatformKit) + dependency.

import { describe, it, expect } from "vitest";
import { onboardPlatform } from "../offchain/src/onboard.js";
import { entryWellFormed } from "../offchain/src/registrationBuilder.js";
import { seedDatumOk } from "../../Treasury/offchain/src/collect.js";
import { phoenixKeyConfig } from "../examples/phoenixkey.js";
import { oriLifeConfig } from "../examples/orilife.js";
import { exampleConfig, makeExamplePriceFn } from "../examples/_template.js";
import { eventToCollectItem } from "../offchain/src/collectAdapter.js";
import { asciiToHex } from "../offchain/src/encoding.js";

const seedPolicy = "56".repeat(28);
const onboardArgs = (config: ReturnType<typeof phoenixKeyConfig>) => ({
  config,
  beaconPolicy: "12".repeat(28),
  custodyHash:  "34".repeat(28),
  seedPolicy,
  createdEpoch: 7n,
});

describe("onboardPlatform — 2 bước plan", () => {
  const cfg = phoenixKeyConfig({
    lampPolicy: "ab".repeat(28),
    magicPolicy: "cd".repeat(28),
    registryAuthority: "ef".repeat(28),
    msPerEpoch: 86_400_000n,
    reservedMinAda: 2_000_000n,
    genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
  });

  it("trả seed + register, cả hai tự-kiểm gương validator", () => {
    const plan = onboardPlatform(onboardArgs(cfg));

    // BƯỚC 1 — seed: datum custody hợp lệ (gương đủ custody_seed).
    expect(
      seedDatumOk(plan.seed.custodyValue, plan.seed.datum, cfg.reservedMinAda, seedPolicy),
    ).toBe(true);
    expect(plan.seed.datum.consumed_proposals).toEqual([]);
    // NFT authenticity (seed_policy, instance_id) qty 1 trong custody value.
    expect(plan.seed.custodyValue[`${seedPolicy}|${cfg.instanceId}`]).toBe(1n);

    // BƯỚC 2 — register: entry well-formed.
    expect(entryWellFormed(plan.register.entry)).toBe(true);
    expect(plan.register.entry.platform_id).toBe(asciiToHex("PhoenixKey"));
  });

  it("dependency: entry.seed_policy == custody seed_policy; instance_id khớp", () => {
    const plan = onboardPlatform(onboardArgs(cfg));
    expect(plan.register.entry.seed_policy).toBe(seedPolicy);
    expect(plan.register.entry.instance_id).toBe(plan.seed.datum.instance_id.toLowerCase());
  });

  it("R-BIND: register.custodyRef suy từ seed (NFT authenticity @ Script(custodyHash))", () => {
    const plan = onboardPlatform({
      ...onboardArgs(cfg),
      custodyOutRef: { txHash: "ab".repeat(32), outputIndex: 2 },
    });
    const ref = plan.register.custodyRef;
    // custody value = seed.custodyValue (mang NFT authenticity qty 1).
    expect(ref.value[`${seedPolicy}|${cfg.instanceId.toLowerCase()}`]).toBe(1n);
    expect(ref.scriptHash).toBe("34".repeat(28));
    // custodyOutRef chảy qua để caller readFrom sau submit BƯỚC 1.
    expect(ref.txHash).toBe("ab".repeat(32));
    expect(ref.outputIndex).toBe(2);
  });

  it("summary nêu rõ thứ tự BƯỚC 1 trước BƯỚC 2 + R-BIND", () => {
    const plan = onboardPlatform(onboardArgs(cfg));
    expect(plan.summary).toMatch(/BƯỚC 1 PHẢI SUBMIT trước BƯỚC 2/);
    expect(plan.summary).toMatch(/R-BIND/);
  });

  it("OriLife onboard cũng dựng plan hợp lệ", () => {
    const ori = oriLifeConfig({
      lampPolicy: "ab".repeat(28),
      registryAuthority: "ef".repeat(28),
      msPerEpoch: 86_400_000n,
      reservedMinAda: 2_000_000n,
      genesisRef: { transaction_id: "ee".repeat(32), output_index: 1n },
    });
    const plan = onboardPlatform({
      config: ori, beaconPolicy: "12".repeat(28), custodyHash: "34".repeat(28),
      seedPolicy, createdEpoch: 3n,
    });
    expect(entryWellFormed(plan.register.entry)).toBe(true);
    expect(plan.register.entry.cut_bps).toBe(700n);
    expect(seedDatumOk(plan.seed.custodyValue, plan.seed.datum, ori.reservedMinAda, seedPolicy)).toBe(true);
  });

  // TEMPLATE (examples/_template.ts) — khung generic team copy & điền. Test này CHỨNG MINH
  // template typecheck + dựng plan hợp lệ qua đúng SDK thật (onboardPlatform/eventToCollectItem),
  // để team có mẫu chạy được làm mốc.
  it("_template: exampleConfig dựng onboard plan hợp lệ + PriceFn sinh CollectItem", () => {
    const cfg = exampleConfig({
      registryAuthority: "ef".repeat(28),
      msPerEpoch: 86_400_000n,
      reservedMinAda: 2_000_000n,
      genesisRef: { transaction_id: "dd".repeat(32), output_index: 0n },
    });
    const plan = onboardPlatform({
      config: cfg, beaconPolicy: "12".repeat(28), custodyHash: "34".repeat(28),
      seedPolicy, createdEpoch: 1n,
    });
    expect(entryWellFormed(plan.register.entry)).toBe(true);
    expect(plan.register.entry.platform_id).toBe(asciiToHex("ExamplePlatform"));

    // PriceFn mẫu: event hỗ trợ → CollectItem; event lạ → null.
    const priceFn = makeExamplePriceFn({});
    const item = eventToCollectItem({ eventType: "example.action", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(1_000_000n);              // 1 ADA = 1 × LOVELACE.
    expect(item!.category).toBe(0n);                    // EXAMPLE_BUCKETS.MAIN.
    expect(eventToCollectItem({ eventType: "nope", payer: "11".repeat(28) }, priceFn)).toBeNull();
  });
});
