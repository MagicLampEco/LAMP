// Vitest seedBuilder — genesis seed custody (mirror custody_seed validator hardening v1).
// Kiểm: redeemer CBOR, apply param genesis_ref (qua plutus.json THẬT), seed_policy id,
// planSeed canonical + NFT, tự kiểm seedDatumOk.

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";

import {
  encodeSeedRedeemer, seedRedeemerToCbor, applyCustodySeed, seedPolicyId, planSeed,
} from "../offchain/src/seedBuilder.js";
import { assetKey, seedDatumOk, isCanonical } from "../offchain/src/collect.js";
import type { CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

// vitest chạy với cwd = offchain/ → plutus.json ở ../onchain/plutus.json.
const PLUTUS_JSON = new URL("../onchain/plutus.json", `file://${process.cwd()}/`).pathname;

const LAMP_POLICY = "aabb".repeat(14);
const LAMP_NAME = "4c414d50";
const INSTANCE_ID = "abcd";

function loadCustodySeedCode(): string {
  const pj = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const v = pj.validators.find((x: { title: string }) => x.title === "custody_seed.custody_seed.mint");
  if (!v) throw new Error("custody_seed.custody_seed.mint không có trong plutus.json — chạy aiken build");
  return v.compiledCode as string;
}

function baseDatum(ledger: LedgerEntry[], over: Partial<CustodyDatum> = {}): CustodyDatum {
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

describe("custody_seed redeemer SeedGenesis{reserved_min_ada} = Constr(0,[int])", () => {
  it("encode index 0 + 1 field int", () => {
    const c = encodeSeedRedeemer(2_000_000n);
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([2_000_000n]);
  });
  it("CBOR khớp Constr(0,[2000000]) = d8799f1a001e8480ff", () => {
    expect(seedRedeemerToCbor(2_000_000n).toLowerCase()).toBe("d8799f1a001e8480ff");
  });
  it("round-trip qua CBOR", () => {
    const cbor = seedRedeemerToCbor(123n);
    const d = Data.from(cbor) as Constr<Data>;
    expect(d.index).toBe(0);
    expect(d.fields[0]).toBe(123n);
  });
  it("reserved âm → ném", () => {
    expect(() => encodeSeedRedeemer(-1n)).toThrow(/SEED-RED/);
  });
});

describe("applyCustodySeed + seedPolicyId (qua plutus.json THẬT)", () => {
  const code = loadCustodySeedCode();

  it("apply genesis_ref → Validator PlutusV3 + policy id 28-byte", () => {
    const seed = applyCustodySeed(code, { transaction_id: "ab".repeat(32), output_index: 0n });
    expect(seed.type).toBe("PlutusV3");
    const pid = seedPolicyId(seed);
    expect(pid).toMatch(/^[0-9a-f]{56}$/);
  });

  it("genesis_ref KHÁC → policy id KHÁC (one-shot deterministic)", () => {
    const a = seedPolicyId(applyCustodySeed(code, { transaction_id: "ab".repeat(32), output_index: 0n }));
    const b = seedPolicyId(applyCustodySeed(code, { transaction_id: "ab".repeat(32), output_index: 1n }));
    expect(a).not.toBe(b);
  });
});

describe("planSeed — happy (canonical + NFT + tự kiểm seedDatumOk)", () => {
  const code = loadCustodySeedCode();
  const seedPolicy = seedPolicyId(applyCustodySeed(code, { transaction_id: "cd".repeat(32), output_index: 3n }));
  const nftK = assetKey(seedPolicy, INSTANCE_ID);

  it("dựng datum canonical (prune+sort) + value gồm NFT + consumed=[]", () => {
    const raw: LedgerEntry[] = [
      { bucket_id: 2n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 500n },
      { bucket_id: 1n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 1000n },
      { bucket_id: 1n, policy: "", name: "", amount: 3_000_000n },
      { bucket_id: 9n, policy: LAMP_POLICY, name: LAMP_NAME, amount: 0n }, // prune
    ];
    const plan = planSeed(baseDatum(raw), seedPolicy, 2_000_000n);

    expect(isCanonical(plan.datum.ledger)).toBe(true);
    expect(plan.datum.ledger.length).toBe(3);            // dòng 0 pruned
    expect(plan.datum.consumed_proposals).toEqual([]);
    expect(plan.seedPolicy).toBe(seedPolicy);
    expect(plan.nftName).toBe(INSTANCE_ID);
    expect(plan.custodyValue[nftK]).toBe(1n);
    expect(plan.custodyValue[assetKey(LAMP_POLICY, LAMP_NAME)]).toBe(1500n);
    expect(plan.custodyValue[assetKey("", "")]).toBe(5_000_000n);
    // gương đủ validator
    expect(seedDatumOk(plan.custodyValue, plan.datum, 2_000_000n, seedPolicy)).toBe(true);
  });

  it("reject cut_bps ngoài [0,10000] → SEED-001", () => {
    expect(() => planSeed(baseDatum([], { cut_bps: 10001n }), seedPolicy, 2_000_000n)).toThrow(/SEED-001/);
  });

  it("reject sổ có dòng âm → LEDGER-NEG", () => {
    const neg: LedgerEntry[] = [{ bucket_id: 1n, policy: "", name: "", amount: -1n }];
    expect(() => planSeed(baseDatum(neg), seedPolicy, 2_000_000n)).toThrow(/LEDGER-NEG/);
  });
});
