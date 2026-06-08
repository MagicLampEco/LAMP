// Deposits datum/redeemer codec — Plutus Data (Lucid Evolution).
//
// PHẢI khớp byte-perfect với onchain types.ak. Constr index = thứ tự khai báo.
//
//   AssetKey{policy,name}                       = Constr(0, [bytes, bytes])
//   Credential VerificationKey(h)=Constr(0,[bytes]); Script(h)=Constr(1,[bytes])
//   DepositLine{entity_id,depositor,policy,name,amount,epoch}
//                                               = Constr(0, [bytes,bytes,bytes,bytes,int,int])
//   PotDatum{instance_id,accepted_assets,lifecycle_authority,reserved_min_ada,ledger,epoch}
//                                               = Constr(0, [bytes,List,Credential,int,List,int])
//   DepositsRedeemer:
//     Deposit{entity_id,depositor,policy,name,amount} = Constr(0, [bytes,bytes,bytes,bytes,int])
//     Refund {entity_id,depositor,policy,name}        = Constr(1, [bytes,bytes,bytes,bytes])
//
// Dùng duck-type Constr (như Treasury datum.ts) để tránh lỗi `instanceof` khi có 2
// bản @lucid-evolution/lucid khác class identity (offchain vs scripts).

import { Constr, Data } from "@lucid-evolution/lucid";
import type {
  AssetKey, Credential, DepositLine, DepositsRedeemer, PotDatum,
} from "./types.js";

export const DEPOSITS_REDEEMER = { Deposit: 0, Refund: 1 } as const;

// ── helpers ──

function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`DDATUM-000: expected Constr for ${ctx}`);
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`DDATUM-001: expected bytes for ${ctx}`);
  return d;
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`DDATUM-002: expected int for ${ctx}`);
  return d;
}

function asList(d: Data, ctx: string): Data[] {
  if (!Array.isArray(d)) throw new Error(`DDATUM-003: expected list for ${ctx}`);
  return d;
}

// ── AssetKey ──

export function encodeAssetKey(a: AssetKey): Constr<Data> {
  return new Constr(0, [normHex(a.policy), normHex(a.name)]);
}

export function decodeAssetKey(d: Data): AssetKey {
  const c = asConstr(d, "AssetKey");
  if (c.index !== 0) throw new Error(`DDATUM-010: AssetKey expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`DDATUM-011: AssetKey expects 2 fields, got ${c.fields.length}`);
  return { policy: asBytes(c.fields[0]!, "AssetKey.policy"), name: asBytes(c.fields[1]!, "AssetKey.name") };
}

// ── Credential ──

export function encodeCredential(c: Credential): Constr<Data> {
  const idx = c.kind === "VerificationKey" ? 0 : 1;
  return new Constr(idx, [normHex(c.hash)]);
}

export function decodeCredential(d: Data): Credential {
  const c = asConstr(d, "Credential");
  if (c.fields.length !== 1) throw new Error(`DDATUM-020: Credential expects 1 field, got ${c.fields.length}`);
  const hash = asBytes(c.fields[0]!, "Credential.hash");
  if (c.index === 0) return { kind: "VerificationKey", hash };
  if (c.index === 1) return { kind: "Script", hash };
  throw new Error(`DDATUM-021: Credential expects Constr 0|1, got ${c.index}`);
}

// ── DepositLine ──

export function encodeDepositLine(e: DepositLine): Constr<Data> {
  return new Constr(0, [
    normHex(e.entity_id), normHex(e.depositor), normHex(e.policy), normHex(e.name), e.amount, e.epoch,
  ]);
}

export function decodeDepositLine(d: Data): DepositLine {
  const c = asConstr(d, "DepositLine");
  if (c.index !== 0) throw new Error(`DDATUM-030: DepositLine expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 6) throw new Error(`DDATUM-031: DepositLine expects 6 fields, got ${c.fields.length}`);
  return {
    entity_id: asBytes(c.fields[0]!, "DepositLine.entity_id"),
    depositor: asBytes(c.fields[1]!, "DepositLine.depositor"),
    policy:    asBytes(c.fields[2]!, "DepositLine.policy"),
    name:      asBytes(c.fields[3]!, "DepositLine.name"),
    amount:    asInt(c.fields[4]!, "DepositLine.amount"),
    epoch:     asInt(c.fields[5]!, "DepositLine.epoch"),
  };
}

// ── PotDatum ──

export function encodePotDatum(d: PotDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.instance_id),
    d.accepted_assets.map(encodeAssetKey),
    encodeCredential(d.lifecycle_authority),
    d.reserved_min_ada,
    d.ledger.map(encodeDepositLine),
    d.epoch,
  ]);
}

export function decodePotDatum(d: Data): PotDatum {
  const c = asConstr(d, "PotDatum");
  if (c.index !== 0) throw new Error(`DDATUM-040: PotDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 6) throw new Error(`DDATUM-041: PotDatum expects 6 fields, got ${c.fields.length}`);
  return {
    instance_id:         asBytes(c.fields[0]!, "PotDatum.instance_id"),
    accepted_assets:     asList(c.fields[1]!, "PotDatum.accepted_assets").map(decodeAssetKey),
    lifecycle_authority: decodeCredential(c.fields[2]!),
    reserved_min_ada:    asInt(c.fields[3]!, "PotDatum.reserved_min_ada"),
    ledger:              asList(c.fields[4]!, "PotDatum.ledger").map(decodeDepositLine),
    epoch:               asInt(c.fields[5]!, "PotDatum.epoch"),
  };
}

export function potDatumToCbor(d: PotDatum): string {
  return Data.to(encodePotDatum(d));
}

export function potDatumFromCbor(cbor: string): PotDatum {
  return decodePotDatum(Data.from(cbor));
}

// ── DepositsRedeemer ──

export function encodeDepositsRedeemer(r: DepositsRedeemer): Constr<Data> {
  switch (r.kind) {
    case "Deposit":
      return new Constr(DEPOSITS_REDEEMER.Deposit, [
        normHex(r.entity_id), normHex(r.depositor), normHex(r.policy), normHex(r.name), r.amount,
      ]);
    case "Refund":
      return new Constr(DEPOSITS_REDEEMER.Refund, [
        normHex(r.entity_id), normHex(r.depositor), normHex(r.policy), normHex(r.name),
      ]);
  }
}

export function depositsRedeemerToCbor(r: DepositsRedeemer): string {
  return Data.to(encodeDepositsRedeemer(r));
}

export function decodeDepositsRedeemer(d: Data): DepositsRedeemer {
  const c = asConstr(d, "DepositsRedeemer");
  switch (c.index) {
    case DEPOSITS_REDEEMER.Deposit: {
      if (c.fields.length !== 5) throw new Error(`DDATUM-050: Deposit expects 5 fields, got ${c.fields.length}`);
      return {
        kind: "Deposit",
        entity_id: asBytes(c.fields[0]!, "Deposit.entity_id"),
        depositor: asBytes(c.fields[1]!, "Deposit.depositor"),
        policy:    asBytes(c.fields[2]!, "Deposit.policy"),
        name:      asBytes(c.fields[3]!, "Deposit.name"),
        amount:    asInt(c.fields[4]!, "Deposit.amount"),
      };
    }
    case DEPOSITS_REDEEMER.Refund: {
      if (c.fields.length !== 4) throw new Error(`DDATUM-051: Refund expects 4 fields, got ${c.fields.length}`);
      return {
        kind: "Refund",
        entity_id: asBytes(c.fields[0]!, "Refund.entity_id"),
        depositor: asBytes(c.fields[1]!, "Refund.depositor"),
        policy:    asBytes(c.fields[2]!, "Refund.policy"),
        name:      asBytes(c.fields[3]!, "Refund.name"),
      };
    }
    default:
      throw new Error(`DDATUM-052: DepositsRedeemer unknown Constr ${c.index}`);
  }
}
