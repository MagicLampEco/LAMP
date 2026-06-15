// PlatformKit · PhoenixKey config hợp lệ + collect adapter map sự kiện DID.

import { describe, it, expect } from "vitest";
import {
  phoenixKeyConfig, makePhoenixKeyPriceFn, PHOENIXKEY_BUCKETS,
} from "../platforms/phoenixkey.js";
import { entryWellFormed, planRegister } from "../offchain/src/registrationBuilder.js";
import { eventToCollectItem } from "../offchain/src/collectAdapter.js";
import { asciiToHex } from "../platforms/_common.js";

const opts = {
  lampPolicy: "ab".repeat(28),
  magicPolicy: "cd".repeat(28),
  registryAuthority: "ef".repeat(28),
  msPerEpoch: 86_400_000n,
  reservedMinAda: 2_000_000n,
  genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
};

describe("phoenixKeyConfig hợp lệ", () => {
  it("accepted = [ADA, LAMP, MAGIC], 3 bucket, cutBps 500", () => {
    const cfg = phoenixKeyConfig(opts);
    expect(cfg.acceptedAssets.length).toBe(3);
    expect(cfg.acceptedAssets[0]).toEqual({ policy: "", name: "" });   // ADA.
    expect(cfg.acceptedAssets[1]!.name).toBe(asciiToHex("LAMP"));
    expect(cfg.acceptedAssets[2]!.name).toBe(asciiToHex("MAGIC"));
    expect(cfg.cutBps).toBe(500n);
    expect(cfg.buckets.map((b) => b.label)).toEqual(["ops", "community", "emergency"]);
  });

  it("config dẫn tới entry well-formed qua planRegister", () => {
    const cfg = phoenixKeyConfig(opts);
    const seedPolicy = "56".repeat(28);
    const plan = planRegister({
      config: cfg,
      beaconPolicy: "12".repeat(28),
      custodyHash: "34".repeat(28),
      seedPolicy,
      createdEpoch: 5n,
      // R-BIND: custody UTxO mang NFT authenticity (seedPolicy, instanceId) @ Script(custodyHash).
      custodyUtxo: {
        value: { [`${seedPolicy}|${cfg.instanceId.toLowerCase()}`]: 1n, "|": 2_000_000n },
        scriptHash: "34".repeat(28),
      },
    });
    expect(entryWellFormed(plan.entry)).toBe(true);
    expect(plan.entry.platform_id).toBe(asciiToHex("PhoenixKey"));
  });
});

describe("PhoenixKey collect adapter (STUB pricing)", () => {
  const priceFn = makePhoenixKeyPriceFn(opts.magicPolicy);

  it("createDID → ADA 1.5, bucket OPS", () => {
    const item = eventToCollectItem({ eventType: "createDID", payer: "11".repeat(28) }, priceFn);
    expect(item!.policy).toBe("");                    // ADA.
    expect(item!.amount).toBe(1_500_000n);
    expect(item!.category).toBe(PHOENIXKEY_BUCKETS.OPS);
  });

  it("rotateKey → MAGIC 0.5, bucket COMMUNITY", () => {
    const item = eventToCollectItem({ eventType: "rotateKey", payer: "11".repeat(28) }, priceFn);
    expect(item!.policy).toBe(opts.magicPolicy);
    expect(item!.name).toBe(asciiToHex("MAGIC"));
    expect(item!.amount).toBe(500_000_000n);
    expect(item!.category).toBe(PHOENIXKEY_BUCKETS.COMMUNITY);
  });

  it("recovery → ADA 3.0, bucket EMERGENCY", () => {
    const item = eventToCollectItem({ eventType: "recovery", payer: "11".repeat(28) }, priceFn);
    expect(item!.amount).toBe(3_000_000n);
    expect(item!.category).toBe(PHOENIXKEY_BUCKETS.EMERGENCY);
  });

  it("event lạ → null", () => {
    expect(eventToCollectItem({ eventType: "nope", payer: "11".repeat(28) }, priceFn)).toBeNull();
  });
});
