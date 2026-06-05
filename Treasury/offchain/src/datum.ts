// Treasury datum/redeemer codec — Plutus Data (Lucid Evolution).
//
// PHẢI khớp byte-perfect với onchain types.ak. Constr index = thứ tự khai báo
// (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).
//
//   AssetKey{policy, name}                       = Constr(0, [bytes, bytes])
//   LedgerEntry{bucket_id, policy, name, amount} = Constr(0, [int, bytes, bytes, int])
//   CollectItem{app_id, policy, name, amount, category}
//                                                = Constr(0, [bytes, bytes, bytes, int, int])
//   CustodyDatum{instance_id, accepted_assets, ledger, cut_bps, governance_ref, epoch}
//                                                = Constr(0, [bytes, List, List, int, bytes, int])
//
//   CustodyRedeemer:
//     Collect   {items}  = Constr(0, [List<CollectItem>])
//     Release   {draws}  = Constr(1, [List<ReleaseDraw>])
//     Rebalance {moves}  = Constr(2, [List<BucketMove>])
//     MigrateIn {source} = Constr(3, [bytes])
//
// Dùng duck-type Constr (như Distribution datum.ts) để tránh lỗi `instanceof`
// khi có 2 bản @lucid-evolution/lucid khác class identity (offchain vs scripts).

import { Constr, Data } from "@lucid-evolution/lucid";
import type {
  AssetKey, CollectItem, CustodyDatum, CustodyRedeemer, LedgerEntry,
} from "./types.js";

// ── Redeemer constructor index map (mirror types.ak) ───────────────────
export const CUSTODY_REDEEMER = {
  Collect:   0,
  Release:   1,
  Rebalance: 2,
  MigrateIn: 3,
} as const;

// ── helpers ────────────────────────────────────────────────────────────

/** Strip leading `0x` + lowercase (Plutus bytes là hex trần). */
function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  // Robust với 2 bản @lucid-evolution/lucid (khác class identity) — duck-type.
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`TDATUM-000: expected Constr for ${ctx}`);
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`TDATUM-001: expected bytes for ${ctx}`);
  return d;
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`TDATUM-002: expected int for ${ctx}`);
  return d;
}

function asList(d: Data, ctx: string): Data[] {
  if (!Array.isArray(d)) throw new Error(`TDATUM-003: expected list for ${ctx}`);
  return d;
}

// ── AssetKey ───────────────────────────────────────────────────────────
// Constr(0, [policy:bytes, name:bytes])

export function encodeAssetKey(a: AssetKey): Constr<Data> {
  return new Constr(0, [normHex(a.policy), normHex(a.name)]);
}

export function decodeAssetKey(d: Data): AssetKey {
  const c = asConstr(d, "AssetKey");
  if (c.index !== 0) throw new Error(`TDATUM-010: AssetKey expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`TDATUM-011: AssetKey expects 2 fields, got ${c.fields.length}`);
  return {
    policy: asBytes(c.fields[0]!, "AssetKey.policy"),
    name:   asBytes(c.fields[1]!, "AssetKey.name"),
  };
}

// ── LedgerEntry ────────────────────────────────────────────────────────
// Constr(0, [bucket_id:int, policy:bytes, name:bytes, amount:int])

export function encodeLedgerEntry(e: LedgerEntry): Constr<Data> {
  return new Constr(0, [e.bucket_id, normHex(e.policy), normHex(e.name), e.amount]);
}

export function decodeLedgerEntry(d: Data): LedgerEntry {
  const c = asConstr(d, "LedgerEntry");
  if (c.index !== 0) throw new Error(`TDATUM-020: LedgerEntry expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 4) throw new Error(`TDATUM-021: LedgerEntry expects 4 fields, got ${c.fields.length}`);
  return {
    bucket_id: asInt(c.fields[0]!, "LedgerEntry.bucket_id"),
    policy:    asBytes(c.fields[1]!, "LedgerEntry.policy"),
    name:      asBytes(c.fields[2]!, "LedgerEntry.name"),
    amount:    asInt(c.fields[3]!, "LedgerEntry.amount"),
  };
}

// ── CollectItem ────────────────────────────────────────────────────────
// Constr(0, [app_id:bytes, policy:bytes, name:bytes, amount:int, category:int])

export function encodeCollectItem(it: CollectItem): Constr<Data> {
  return new Constr(0, [
    normHex(it.app_id),
    normHex(it.policy),
    normHex(it.name),
    it.amount,
    it.category,
  ]);
}

export function decodeCollectItem(d: Data): CollectItem {
  const c = asConstr(d, "CollectItem");
  if (c.index !== 0) throw new Error(`TDATUM-030: CollectItem expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`TDATUM-031: CollectItem expects 5 fields, got ${c.fields.length}`);
  return {
    app_id:   asBytes(c.fields[0]!, "CollectItem.app_id"),
    policy:   asBytes(c.fields[1]!, "CollectItem.policy"),
    name:     asBytes(c.fields[2]!, "CollectItem.name"),
    amount:   asInt(c.fields[3]!, "CollectItem.amount"),
    category: asInt(c.fields[4]!, "CollectItem.category"),
  };
}

// ── CustodyDatum ───────────────────────────────────────────────────────
// Constr(0, [instance_id:bytes, accepted_assets:List, ledger:List, cut_bps:int,
//            governance_ref:bytes, epoch:int])

export function encodeCustodyDatum(d: CustodyDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.instance_id),
    d.accepted_assets.map(encodeAssetKey),
    d.ledger.map(encodeLedgerEntry),
    d.cut_bps,
    normHex(d.governance_ref),
    d.epoch,
  ]);
}

export function decodeCustodyDatum(d: Data): CustodyDatum {
  const c = asConstr(d, "CustodyDatum");
  if (c.index !== 0) throw new Error(`TDATUM-040: CustodyDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 6) throw new Error(`TDATUM-041: CustodyDatum expects 6 fields, got ${c.fields.length}`);
  return {
    instance_id:     asBytes(c.fields[0]!, "CustodyDatum.instance_id"),
    accepted_assets: asList(c.fields[1]!, "CustodyDatum.accepted_assets").map(decodeAssetKey),
    ledger:          asList(c.fields[2]!, "CustodyDatum.ledger").map(decodeLedgerEntry),
    cut_bps:         asInt(c.fields[3]!, "CustodyDatum.cut_bps"),
    governance_ref:  asBytes(c.fields[4]!, "CustodyDatum.governance_ref"),
    epoch:           asInt(c.fields[5]!, "CustodyDatum.epoch"),
  };
}

export function custodyDatumToCbor(d: CustodyDatum): string {
  return Data.to(encodeCustodyDatum(d));
}

export function custodyDatumFromCbor(cbor: string): CustodyDatum {
  return decodeCustodyDatum(Data.from(cbor));
}

// ── CustodyRedeemer ────────────────────────────────────────────────────

export function encodeCollectRedeemer(items: CollectItem[]): Constr<Data> {
  return new Constr(CUSTODY_REDEEMER.Collect, [items.map(encodeCollectItem)]);
}

export function encodeCustodyRedeemer(r: CustodyRedeemer): Constr<Data> {
  switch (r.kind) {
    case "Collect":
      return new Constr(CUSTODY_REDEEMER.Collect, [r.items.map(encodeCollectItem)]);
    case "Release":
      return new Constr(CUSTODY_REDEEMER.Release, [
        r.draws.map((x) =>
          new Constr(0, [x.bucket_id, normHex(x.policy), normHex(x.name), x.amount]),
        ),
      ]);
    case "Rebalance":
      return new Constr(CUSTODY_REDEEMER.Rebalance, [
        r.moves.map((x) =>
          new Constr(0, [
            x.from_bucket, x.to_bucket, normHex(x.policy), normHex(x.name), x.amount,
          ]),
        ),
      ]);
    case "MigrateIn":
      return new Constr(CUSTODY_REDEEMER.MigrateIn, [normHex(r.source)]);
  }
}

export function collectRedeemerToCbor(items: CollectItem[]): string {
  return Data.to(encodeCollectRedeemer(items));
}

export function custodyRedeemerToCbor(r: CustodyRedeemer): string {
  return Data.to(encodeCustodyRedeemer(r));
}
