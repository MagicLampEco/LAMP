// Deposits datum/redeemer codec — Plutus Data (Lucid Evolution).
//
// PHẢI khớp byte-perfect với onchain types.ak. Constr index = thứ tự khai báo.
//
//   AssetKey{policy,name}                       = Constr(0, [bytes, bytes])
//   Credential VerificationKey(h)=Constr(0,[bytes]); Script(h)=Constr(1,[bytes])
//   OutputReference{txHash,index}               = Constr(0, [bytes, int])
//   DepositTier{asset_type,value_tier,lifecycle_class,base_deposit}
//                                               = Constr(0, [int,int,int,int])
//   DepositParam{tiers,demand_mult,m_min,m_max,epoch}
//                                               = Constr(0, [List,int,int,int,int])
//   DepositLine{entity_id,depositor,policy,name,amount,epoch,asset_type,value_tier,lifecycle_class}
//                                               = Constr(0, [bytes×4, int×5])
//   PotDatum{instance_id,accepted_assets,lifecycle_authority,reserved_min_ada,
//            deposit_param_policy,deposit_param_name,deposit_param_script_hash,
//            treasury_credential,escheat_after_epoch,ms_per_epoch,ledger,epoch}
//                                               = Constr(0, [bytes,List,Cred,int,bytes,bytes,bytes,Cred,int,int,List,int])
//   DepositsRedeemer:
//     Deposit{entity_id,depositor,policy,name,asset_type,value_tier,lifecycle_class,deposit_ref}
//                                               = Constr(0, [bytes×4, int×3, OutRef])
//     Refund {entity_id,depositor,policy,name}  = Constr(1, [bytes×4])
//     Escheat{entity_id,depositor,policy,name}  = Constr(2, [bytes×4])
//
// Dùng duck-type Constr (như Treasury datum.ts) để tránh lỗi `instanceof` khi có 2
// bản @lucid-evolution/lucid khác class identity (offchain vs scripts).

import { Constr, Data } from "@lucid-evolution/lucid";
import type {
  AssetKey, Credential, DepositLine, DepositParam, DepositsRedeemer,
  DepositTier, OutRef, PotDatum,
} from "./types.js";

export const DEPOSITS_REDEEMER = { Deposit: 0, Refund: 1, Escheat: 2 } as const;

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

// ── OutputReference ──

export function encodeOutRef(o: OutRef): Constr<Data> {
  return new Constr(0, [normHex(o.txHash), o.index]);
}

export function decodeOutRef(d: Data): OutRef {
  const c = asConstr(d, "OutRef");
  if (c.index !== 0) throw new Error(`DDATUM-060: OutRef expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`DDATUM-061: OutRef expects 2 fields, got ${c.fields.length}`);
  return { txHash: asBytes(c.fields[0]!, "OutRef.txHash"), index: asInt(c.fields[1]!, "OutRef.index") };
}

// ── DepositTier ──

export function encodeDepositTier(t: DepositTier): Constr<Data> {
  return new Constr(0, [t.asset_type, t.value_tier, t.lifecycle_class, t.base_deposit]);
}

export function decodeDepositTier(d: Data): DepositTier {
  const c = asConstr(d, "DepositTier");
  if (c.index !== 0) throw new Error(`DDATUM-070: DepositTier expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 4) throw new Error(`DDATUM-071: DepositTier expects 4 fields, got ${c.fields.length}`);
  return {
    asset_type:      asInt(c.fields[0]!, "DepositTier.asset_type"),
    value_tier:      asInt(c.fields[1]!, "DepositTier.value_tier"),
    lifecycle_class: asInt(c.fields[2]!, "DepositTier.lifecycle_class"),
    base_deposit:    asInt(c.fields[3]!, "DepositTier.base_deposit"),
  };
}

// ── DepositParam ──

export function encodeDepositParam(p: DepositParam): Constr<Data> {
  return new Constr(0, [
    p.tiers.map(encodeDepositTier), p.demand_mult, p.m_min, p.m_max, p.epoch,
  ]);
}

export function decodeDepositParam(d: Data): DepositParam {
  const c = asConstr(d, "DepositParam");
  if (c.index !== 0) throw new Error(`DDATUM-080: DepositParam expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`DDATUM-081: DepositParam expects 5 fields, got ${c.fields.length}`);
  return {
    tiers:       asList(c.fields[0]!, "DepositParam.tiers").map(decodeDepositTier),
    demand_mult: asInt(c.fields[1]!, "DepositParam.demand_mult"),
    m_min:       asInt(c.fields[2]!, "DepositParam.m_min"),
    m_max:       asInt(c.fields[3]!, "DepositParam.m_max"),
    epoch:       asInt(c.fields[4]!, "DepositParam.epoch"),
  };
}

export function depositParamToCbor(p: DepositParam): string {
  return Data.to(encodeDepositParam(p));
}

export function depositParamFromCbor(cbor: string): DepositParam {
  return decodeDepositParam(Data.from(cbor));
}

// ── DepositLine ──

export function encodeDepositLine(e: DepositLine): Constr<Data> {
  return new Constr(0, [
    normHex(e.entity_id), normHex(e.depositor), normHex(e.policy), normHex(e.name),
    e.amount, e.epoch, e.asset_type, e.value_tier, e.lifecycle_class,
  ]);
}

export function decodeDepositLine(d: Data): DepositLine {
  const c = asConstr(d, "DepositLine");
  if (c.index !== 0) throw new Error(`DDATUM-030: DepositLine expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 9) throw new Error(`DDATUM-031: DepositLine expects 9 fields, got ${c.fields.length}`);
  return {
    entity_id:       asBytes(c.fields[0]!, "DepositLine.entity_id"),
    depositor:       asBytes(c.fields[1]!, "DepositLine.depositor"),
    policy:          asBytes(c.fields[2]!, "DepositLine.policy"),
    name:            asBytes(c.fields[3]!, "DepositLine.name"),
    amount:          asInt(c.fields[4]!, "DepositLine.amount"),
    epoch:           asInt(c.fields[5]!, "DepositLine.epoch"),
    asset_type:      asInt(c.fields[6]!, "DepositLine.asset_type"),
    value_tier:      asInt(c.fields[7]!, "DepositLine.value_tier"),
    lifecycle_class: asInt(c.fields[8]!, "DepositLine.lifecycle_class"),
  };
}

// ── PotDatum ──

export function encodePotDatum(d: PotDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.instance_id),
    d.accepted_assets.map(encodeAssetKey),
    encodeCredential(d.lifecycle_authority),
    d.reserved_min_ada,
    normHex(d.deposit_param_policy),
    normHex(d.deposit_param_name),
    normHex(d.deposit_param_script_hash),
    encodeCredential(d.treasury_credential),
    d.escheat_after_epoch,
    d.ms_per_epoch,
    d.ledger.map(encodeDepositLine),
    d.epoch,
  ]);
}

export function decodePotDatum(d: Data): PotDatum {
  const c = asConstr(d, "PotDatum");
  if (c.index !== 0) throw new Error(`DDATUM-040: PotDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 12) throw new Error(`DDATUM-041: PotDatum expects 12 fields, got ${c.fields.length}`);
  return {
    instance_id:               asBytes(c.fields[0]!, "PotDatum.instance_id"),
    accepted_assets:           asList(c.fields[1]!, "PotDatum.accepted_assets").map(decodeAssetKey),
    lifecycle_authority:       decodeCredential(c.fields[2]!),
    reserved_min_ada:          asInt(c.fields[3]!, "PotDatum.reserved_min_ada"),
    deposit_param_policy:      asBytes(c.fields[4]!, "PotDatum.deposit_param_policy"),
    deposit_param_name:        asBytes(c.fields[5]!, "PotDatum.deposit_param_name"),
    deposit_param_script_hash: asBytes(c.fields[6]!, "PotDatum.deposit_param_script_hash"),
    treasury_credential:       decodeCredential(c.fields[7]!),
    escheat_after_epoch:       asInt(c.fields[8]!, "PotDatum.escheat_after_epoch"),
    ms_per_epoch:              asInt(c.fields[9]!, "PotDatum.ms_per_epoch"),
    ledger:                    asList(c.fields[10]!, "PotDatum.ledger").map(decodeDepositLine),
    epoch:                     asInt(c.fields[11]!, "PotDatum.epoch"),
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
        normHex(r.entity_id), normHex(r.depositor), normHex(r.policy), normHex(r.name),
        r.asset_type, r.value_tier, r.lifecycle_class, encodeOutRef(r.deposit_ref),
      ]);
    case "Refund":
      return new Constr(DEPOSITS_REDEEMER.Refund, [
        normHex(r.entity_id), normHex(r.depositor), normHex(r.policy), normHex(r.name),
      ]);
    case "Escheat":
      return new Constr(DEPOSITS_REDEEMER.Escheat, [
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
      if (c.fields.length !== 8) throw new Error(`DDATUM-050: Deposit expects 8 fields, got ${c.fields.length}`);
      return {
        kind: "Deposit",
        entity_id:       asBytes(c.fields[0]!, "Deposit.entity_id"),
        depositor:       asBytes(c.fields[1]!, "Deposit.depositor"),
        policy:          asBytes(c.fields[2]!, "Deposit.policy"),
        name:            asBytes(c.fields[3]!, "Deposit.name"),
        asset_type:      asInt(c.fields[4]!, "Deposit.asset_type"),
        value_tier:      asInt(c.fields[5]!, "Deposit.value_tier"),
        lifecycle_class: asInt(c.fields[6]!, "Deposit.lifecycle_class"),
        deposit_ref:     decodeOutRef(c.fields[7]!),
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
    case DEPOSITS_REDEEMER.Escheat: {
      if (c.fields.length !== 4) throw new Error(`DDATUM-053: Escheat expects 4 fields, got ${c.fields.length}`);
      return {
        kind: "Escheat",
        entity_id: asBytes(c.fields[0]!, "Escheat.entity_id"),
        depositor: asBytes(c.fields[1]!, "Escheat.depositor"),
        policy:    asBytes(c.fields[2]!, "Escheat.policy"),
        name:      asBytes(c.fields[3]!, "Escheat.name"),
      };
    }
    default:
      throw new Error(`DDATUM-052: DepositsRedeemer unknown Constr ${c.index}`);
  }
}
