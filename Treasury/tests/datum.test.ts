import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  encodeAssetKey, decodeAssetKey,
  encodeLedgerEntry, decodeLedgerEntry,
  encodeCollectItem, decodeCollectItem,
  encodeCustodyDatum, decodeCustodyDatum,
  custodyDatumToCbor, custodyDatumFromCbor,
  encodeCollectRedeemer, collectRedeemerToCbor,
  encodeCustodyRedeemer, custodyRedeemerToCbor,
  CUSTODY_REDEEMER,
} from "../offchain/src/datum.js";
import type {
  AssetKey, CollectItem, CustodyDatum, LedgerEntry,
} from "../offchain/src/types.js";

function asConstr(cbor: string): Constr<Data> {
  const d = Data.from(cbor);
  if (!(d instanceof Constr)) throw new Error("not a Constr");
  return d;
}

describe("AssetKey", () => {
  const sample: AssetKey = { policy: "aabbcc".repeat(2), name: "4c414d50" };

  it("round-trips encode→decode", () => {
    expect(decodeAssetKey(encodeAssetKey(sample))).toEqual(sample);
  });

  it("Constr(0, [bytes, bytes])", () => {
    const c = encodeAssetKey(sample);
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([sample.policy, sample.name]);
  });

  it("normalizes 0x + uppercase", () => {
    const c = encodeAssetKey({ policy: "0xAABB", name: "CCDD" });
    expect(c.fields).toEqual(["aabb", "ccdd"]);
  });
});

describe("LedgerEntry", () => {
  const sample: LedgerEntry = { bucket_id: 3n, policy: "", name: "", amount: 1_000_000n };

  it("round-trips (lovelace = empty policy/name)", () => {
    expect(decodeLedgerEntry(encodeLedgerEntry(sample))).toEqual(sample);
  });

  it("Constr(0, [int, bytes, bytes, int]) declared order", () => {
    const c = encodeLedgerEntry({ bucket_id: 1n, policy: "aa", name: "bb", amount: 7n });
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([1n, "aa", "bb", 7n]);
  });
});

describe("CollectItem", () => {
  const sample: CollectItem = {
    app_id: "deadbeef", policy: "aabb", name: "4c414d50", amount: 500n, category: 2n,
  };

  it("round-trips encode→decode", () => {
    expect(decodeCollectItem(encodeCollectItem(sample))).toEqual(sample);
  });

  it("Constr(0, [bytes, bytes, bytes, int, int]) declared order", () => {
    const c = encodeCollectItem(sample);
    expect(c.index).toBe(0);
    expect(c.fields).toEqual(["deadbeef", "aabb", "4c414d50", 500n, 2n]);
  });
});

describe("CustodyDatum", () => {
  const sample: CustodyDatum = {
    instance_id: "01020304",
    accepted_assets: [
      { policy: "", name: "" },                  // lovelace
      { policy: "aabb".repeat(14), name: "4c414d50" },
    ],
    ledger: [
      { bucket_id: 0n, policy: "", name: "", amount: 2_000_000n },
      { bucket_id: 1n, policy: "aabb".repeat(14), name: "4c414d50", amount: 999n },
    ],
    cut_bps: 250n,
    governance_ref: "cafe".repeat(14),
    epoch: 42n,
  };

  it("round-trips encode→decode", () => {
    expect(decodeCustodyDatum(encodeCustodyDatum(sample))).toEqual(sample);
  });

  it("round-trips via CBOR", () => {
    expect(custodyDatumFromCbor(custodyDatumToCbor(sample))).toEqual(sample);
  });

  it("Constr(0, [bytes, List, List, int, bytes, int]) declared order", () => {
    const c = asConstr(custodyDatumToCbor(sample));
    expect(c.index).toBe(0);
    expect(c.fields).toHaveLength(6);
    expect(c.fields[0]).toBe(sample.instance_id);          // instance_id
    expect(Array.isArray(c.fields[1])).toBe(true);         // accepted_assets
    expect(Array.isArray(c.fields[2])).toBe(true);         // ledger
    expect(c.fields[3]).toBe(250n);                        // cut_bps
    expect(c.fields[4]).toBe(sample.governance_ref);       // governance_ref
    expect(c.fields[5]).toBe(42n);                         // epoch
  });

  it("round-trips empty lists", () => {
    const d: CustodyDatum = { ...sample, accepted_assets: [], ledger: [] };
    expect(custodyDatumFromCbor(custodyDatumToCbor(d))).toEqual(d);
  });

  it("rejects wrong field count / wrong constr", () => {
    expect(() => decodeCustodyDatum(new Constr(0, ["aa", [], []]))).toThrow();
    expect(() => decodeCustodyDatum(new Constr(1, ["aa", [], [], 0n, "bb", 0n]))).toThrow();
  });
});

describe("CustodyRedeemer", () => {
  const items: CollectItem[] = [
    { app_id: "aa", policy: "", name: "", amount: 100n, category: 0n },
  ];

  it("Collect = Constr(0, [List<CollectItem>])", () => {
    expect(CUSTODY_REDEEMER.Collect).toBe(0);
    const c = asConstr(collectRedeemerToCbor(items));
    expect(c.index).toBe(0);
    expect(Array.isArray(c.fields[0])).toBe(true);
    expect((c.fields[0] as Data[]).length).toBe(1);
  });

  it("encodeCustodyRedeemer Collect matches encodeCollectRedeemer", () => {
    const a = custodyRedeemerToCbor({ kind: "Collect", items });
    const b = collectRedeemerToCbor(items);
    expect(a).toBe(b);
  });

  it("Release=1, Rebalance=2, MigrateIn=3 (index ổn định cho onchain)", () => {
    expect(encodeCustodyRedeemer({ kind: "Release", draws: [] }).index).toBe(1);
    expect(encodeCustodyRedeemer({ kind: "Rebalance", moves: [] }).index).toBe(2);
    const mig = encodeCustodyRedeemer({ kind: "MigrateIn", source: "0xABCD" });
    expect(mig.index).toBe(3);
    expect(mig.fields).toEqual(["abcd"]);
  });
});
