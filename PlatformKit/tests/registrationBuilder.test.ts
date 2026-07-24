// PlatformKit · planRegister happy + R-WF reject; planUpdateEntry identity tamper reject.

import { describe, it, expect } from "vitest";
import {
  planRegister, planUpdateEntry, entryWellFormed,
  identityPreserved, mutableFieldsValid, verifyCustodyBinding,
} from "../offchain/src/registrationBuilder.js";
import { decodePlatformEntry } from "../offchain/src/registryDatum.js";
import { Data } from "@lucid-evolution/lucid";
import type { PlatformConfig, PlatformEntry } from "../offchain/src/types.js";
import { asciiToHex } from "../offchain/src/encoding.js";

const baseConfig = (over: Partial<PlatformConfig> = {}): PlatformConfig => ({
  platformId: asciiToHex("TestPlat"),
  instanceId: asciiToHex("test-instance-v1"),
  acceptedAssets: [{ policy: "", name: "" }],
  buckets: [{ id: 0n, label: "ops" }],
  cutBps: 300n,
  governanceRef: "cc".repeat(28),
  msPerEpoch: 86_400_000n,
  reservedMinAda: 2_000_000n,
  registryAuthority: "ab".repeat(28),
  genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
  ...over,
});

const CUSTODY_HASH = "34".repeat(28);
const SEED_POLICY  = "56".repeat(28);

/** Custody UTxO HỢP LỆ cho R-BIND: mang đúng 1 NFT (seedPolicy, instanceId) @ Script(custodyHash). */
const okCustody = (cfg: PlatformConfig) => ({
  value: { [`${SEED_POLICY}|${cfg.instanceId.toLowerCase()}`]: 1n, "|": 2_000_000n },
  scriptHash: CUSTODY_HASH,
  txHash: "dd".repeat(32),
  outputIndex: 0,
});

const regParams = (cfg: PlatformConfig) => ({
  config: cfg,
  beaconPolicy: "12".repeat(28),
  custodyHash: CUSTODY_HASH,
  seedPolicy: SEED_POLICY,
  createdEpoch: 10n,
  custodyUtxo: okCustody(cfg),
});

describe("planRegister happy", () => {
  it("dựng entry well-formed + NFT name == platform_id + datum decode round-trip", () => {
    const cfg = baseConfig();
    const plan = planRegister(regParams(cfg));
    expect(entryWellFormed(plan.entry)).toBe(true);
    expect(plan.nftName).toBe(asciiToHex("TestPlat"));
    expect(plan.entry.platform_id).toBe(plan.nftName);
    expect(plan.entry.status).toBe("Active");
    // value output mang đúng 1 beacon NFT.
    expect(plan.entryValue[`${"12".repeat(28)}|${asciiToHex("TestPlat")}`]).toBe(1n);
    // requiredSigner = authority.
    expect(plan.requiredSigner).toBe("ab".repeat(28));
    // datum CBOR decode lại == entry.
    const back: PlatformEntry = decodePlatformEntry(Data.from(plan.entryDatumCbor));
    expect(back).toEqual(plan.entry);
    // R-BIND: custody ref được mang theo plan (caller readFrom).
    expect(plan.custodyRef.scriptHash).toBe(CUSTODY_HASH);
    expect(plan.custodyRef.txHash).toBe("dd".repeat(32));
  });

  it("config.seedPolicy ưu tiên hơn params.seedPolicy", () => {
    const cfg = baseConfig({ seedPolicy: "99".repeat(28) });
    // seed_policy hiệu lực = config "99..." → custody NFT phải dùng đúng policy đó (R-BIND).
    const plan = planRegister({
      ...regParams(cfg),
      custodyUtxo: {
        value: { [`${"99".repeat(28)}|${cfg.instanceId.toLowerCase()}`]: 1n, "|": 2_000_000n },
        scriptHash: CUSTODY_HASH,
      },
    });
    expect(plan.entry.seed_policy).toBe("99".repeat(28));
  });
});

describe("planRegister R-WF reject", () => {
  it("cut_bps > 10000 → ném REG-WF", () => {
    const cfg = baseConfig({ cutBps: 10001n });
    expect(() => planRegister(regParams(cfg))).toThrow(/REG-WF/);
  });
  it("accepted_assets rỗng → ném REG-WF", () => {
    const cfg = baseConfig({ acceptedAssets: [] });
    expect(() => planRegister(regParams(cfg))).toThrow(/REG-WF/);
  });
  it("governance_ref rỗng → ném REG-WF", () => {
    const cfg = baseConfig({ governanceRef: "" });
    expect(() => planRegister(regParams(cfg))).toThrow(/REG-WF/);
  });
  it("platform_id rỗng → ném REG-WF", () => {
    const cfg = baseConfig({ platformId: "" });
    expect(() => planRegister(regParams(cfg))).toThrow(/REG-WF/);
  });
  it("seed_policy rỗng (cả config & params) → ném REG-WF", () => {
    const cfg = baseConfig();
    expect(() => planRegister({ ...regParams(cfg), seedPolicy: "" })).toThrow(/REG-WF/);
  });
});

describe("planRegister R-BIND reject (custody binding)", () => {
  it("thiếu custodyUtxo → ném REG-BIND", () => {
    const cfg = baseConfig();
    const { custodyUtxo, ...rest } = regParams(cfg);
    void custodyUtxo;
    // @ts-expect-error — cố tình bỏ custodyUtxo để kiểm fail-fast.
    expect(() => planRegister(rest)).toThrow(/REG-BIND/);
  });

  it("custody UTxO thiếu NFT authenticity → ném REG-BIND", () => {
    const cfg = baseConfig();
    const bad = { ...regParams(cfg), custodyUtxo: { value: { "|": 2_000_000n }, scriptHash: CUSTODY_HASH } };
    expect(() => planRegister(bad)).toThrow(/REG-BIND/);
  });

  it("custody UTxO NFT sai instance_id → ném REG-BIND", () => {
    const cfg = baseConfig();
    const bad = {
      ...regParams(cfg),
      custodyUtxo: { value: { [`${SEED_POLICY}|${asciiToHex("other-instance")}`]: 1n }, scriptHash: CUSTODY_HASH },
    };
    expect(() => planRegister(bad)).toThrow(/REG-BIND/);
  });

  it("custody address script hash != custody_hash → ném REG-BIND", () => {
    const cfg = baseConfig();
    const bad = { ...regParams(cfg), custodyUtxo: { ...okCustody(cfg), scriptHash: "00".repeat(28) } };
    expect(() => planRegister(bad)).toThrow(/REG-BIND/);
  });

  it("verifyCustodyBinding trả {ok:false, reason} khi sai hash (không ném)", () => {
    const cfg = baseConfig();
    const r = verifyCustodyBinding(
      { ...okCustody(cfg), scriptHash: "00".repeat(28) },
      SEED_POLICY, cfg.instanceId, CUSTODY_HASH,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/custody_hash/);
  });
});

describe("planUpdateEntry", () => {
  const entryIn = (): PlatformEntry => planRegister(regParams(baseConfig())).entry;

  it("cập nhật field khả biến hợp lệ — identity giữ nguyên", () => {
    const plan = planUpdateEntry(
      entryIn(),
      { status: "Paused", cut_bps: 800n, governance_ref: "dd".repeat(28) },
      "12".repeat(28), "ab".repeat(28),
    );
    expect(plan.entryOut.status).toBe("Paused");
    expect(plan.entryOut.cut_bps).toBe(800n);
    expect(plan.entryOut.governance_ref).toBe("dd".repeat(28));
    // identity bất biến.
    expect(identityPreserved(entryIn(), plan.entryOut)).toBe(true);
    expect(mutableFieldsValid(plan.entryOut)).toBe(true);
    // beacon NFT giữ ở output.
    expect(plan.entryValue[`${"12".repeat(28)}|${asciiToHex("TestPlat")}`]).toBe(1n);
  });

  it("Retire = đổi status (KHÔNG burn NFT) — value vẫn mang NFT", () => {
    const plan = planUpdateEntry(entryIn(), { status: "Retired" }, "12".repeat(28), "ab".repeat(28));
    expect(plan.entryOut.status).toBe("Retired");
    expect(plan.entryValue[`${"12".repeat(28)}|${asciiToHex("TestPlat")}`]).toBe(1n);
  });

  it("U-TERMINAL reject: entryIn đã Retired → không update/revive", () => {
    const retired: PlatformEntry = { ...entryIn(), status: "Retired" };
    // Cố revive Retired→Active.
    expect(() => planUpdateEntry(retired, { status: "Active" }, "12".repeat(28), "ab".repeat(28)))
      .toThrow(/UPD-TERMINAL/);
    // Cả update field khác (không đổi status) cũng bị chặn khi entryIn Retired.
    expect(() => planUpdateEntry(retired, { cut_bps: 500n }, "12".repeat(28), "ab".repeat(28)))
      .toThrow(/UPD-TERMINAL/);
  });

  it("U-MUT reject: cut_bps > 10000", () => {
    expect(() => planUpdateEntry(entryIn(), { cut_bps: 10001n }, "12".repeat(28), "ab".repeat(28)))
      .toThrow(/UPD-MUT/);
  });
  it("U-MUT reject: accepted rỗng", () => {
    expect(() => planUpdateEntry(entryIn(), { accepted_assets: [] }, "12".repeat(28), "ab".repeat(28)))
      .toThrow(/UPD-MUT/);
  });

  it("identityPreserved bắt tamper custody_hash", () => {
    const a = entryIn();
    const b = { ...a, custody_hash: "00".repeat(28) };
    expect(identityPreserved(a, b)).toBe(false);
  });
  it("identityPreserved bắt tamper created_epoch", () => {
    const a = entryIn();
    const b = { ...a, created_epoch: a.created_epoch + 1n };
    expect(identityPreserved(a, b)).toBe(false);
  });
});
