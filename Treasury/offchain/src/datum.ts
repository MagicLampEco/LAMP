// Treasury datum/redeemer codec — Plutus Data (Lucid Evolution).
//
// PHẢI khớp byte-perfect với onchain types.ak. Constr index = thứ tự khai báo
// (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).
//
//   AssetKey{policy, name}                       = Constr(0, [bytes, bytes])
//   LedgerEntry{bucket_id, policy, name, amount} = Constr(0, [int, bytes, bytes, int])
//   CollectItem{app_id, policy, name, amount, category}
//                                                = Constr(0, [bytes, bytes, bytes, int, int])
//   CustodyDatum{instance_id, accepted_assets, ledger, cut_bps, governance_ref, epoch, consumed_proposals}
//                                                = Constr(0, [bytes, List, List, int, bytes, int, List<bytes>])
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
  Address, AssetKey, BucketMove, CollectItem, Credential, CustodyDatum,
  CustodyRedeemer, LedgerEntry, OutputReference, ProposalResult, ProposalStatus,
  ReleaseDraw, StakeCredential,
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
//            governance_ref:bytes, epoch:int, consumed_proposals:List<bytes>])

export function encodeCustodyDatum(d: CustodyDatum): Constr<Data> {
  return new Constr(0, [
    normHex(d.instance_id),
    d.accepted_assets.map(encodeAssetKey),
    d.ledger.map(encodeLedgerEntry),
    d.cut_bps,
    normHex(d.governance_ref),
    d.epoch,
    d.consumed_proposals.map(normHex),
  ]);
}

export function decodeCustodyDatum(d: Data): CustodyDatum {
  const c = asConstr(d, "CustodyDatum");
  if (c.index !== 0) throw new Error(`TDATUM-040: CustodyDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 7) throw new Error(`TDATUM-041: CustodyDatum expects 7 fields, got ${c.fields.length}`);
  return {
    instance_id:     asBytes(c.fields[0]!, "CustodyDatum.instance_id"),
    accepted_assets: asList(c.fields[1]!, "CustodyDatum.accepted_assets").map(decodeAssetKey),
    ledger:          asList(c.fields[2]!, "CustodyDatum.ledger").map(decodeLedgerEntry),
    cut_bps:         asInt(c.fields[3]!, "CustodyDatum.cut_bps"),
    governance_ref:  asBytes(c.fields[4]!, "CustodyDatum.governance_ref"),
    epoch:           asInt(c.fields[5]!, "CustodyDatum.epoch"),
    consumed_proposals: asList(c.fields[6]!, "CustodyDatum.consumed_proposals")
      .map((x, i) => asBytes(x, `CustodyDatum.consumed_proposals[${i}]`)),
  };
}

export function custodyDatumToCbor(d: CustodyDatum): string {
  return Data.to(encodeCustodyDatum(d));
}

export function custodyDatumFromCbor(cbor: string): CustodyDatum {
  return decodeCustodyDatum(Data.from(cbor));
}

// ── Credential / StakeCredential / Address ─────────────────────────────
// Mirror cardano/address (Plutus). Khóa CHÍNH XÁC để byte-perfect với on-chain
// `to: Address` trong ReleaseDraw (vào spend_spec_hash).
//   Credential: VerificationKey(h)=Constr(0,[bytes]); Script(h)=Constr(1,[bytes]).
//   StakeCredential.Inline(c)=Constr(0,[Credential]) ; (Pointer = Constr(1,..) — không dùng).
//   Address = Constr(0,[PaymentCredential, Option<StakeCredential>]).
//   Option: Some(x)=Constr(0,[x]); None=Constr(1,[]).

export function encodeCredential(c: Credential): Constr<Data> {
  const idx = c.kind === "VerificationKey" ? 0 : 1;
  return new Constr(idx, [normHex(c.hash)]);
}

export function decodeCredential(d: Data): Credential {
  const c = asConstr(d, "Credential");
  if (c.fields.length !== 1) throw new Error(`TDATUM-050: Credential expects 1 field, got ${c.fields.length}`);
  const hash = asBytes(c.fields[0]!, "Credential.hash");
  if (c.index === 0) return { kind: "VerificationKey", hash };
  if (c.index === 1) return { kind: "Script", hash };
  throw new Error(`TDATUM-051: Credential expects Constr 0|1, got ${c.index}`);
}

export function encodeStakeCredential(s: StakeCredential): Constr<Data> {
  // Inline(Credential) = Constr(0, [Credential]).
  return new Constr(0, [encodeCredential(s.credential)]);
}

export function decodeStakeCredential(d: Data): StakeCredential {
  const c = asConstr(d, "StakeCredential");
  if (c.index !== 0) throw new Error(`TDATUM-052: StakeCredential expects Inline=Constr 0, got ${c.index}`);
  if (c.fields.length !== 1) throw new Error(`TDATUM-053: Inline expects 1 field, got ${c.fields.length}`);
  return { kind: "Inline", credential: decodeCredential(c.fields[0]!) };
}

export function encodeAddress(a: Address): Constr<Data> {
  const stake: Data = a.stake_credential === null
    ? new Constr(1, [])                                // None
    : new Constr(0, [encodeStakeCredential(a.stake_credential)]); // Some(stake)
  return new Constr(0, [encodeCredential(a.payment_credential), stake]);
}

export function decodeAddress(d: Data): Address {
  const c = asConstr(d, "Address");
  if (c.index !== 0) throw new Error(`TDATUM-060: Address expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`TDATUM-061: Address expects 2 fields, got ${c.fields.length}`);
  const payment = decodeCredential(c.fields[0]!);
  const opt = asConstr(c.fields[1]!, "Address.stake_option");
  let stake: StakeCredential | null;
  if (opt.index === 1) {
    stake = null;                                       // None
  } else if (opt.index === 0) {
    if (opt.fields.length !== 1) throw new Error(`TDATUM-062: Some expects 1 field, got ${opt.fields.length}`);
    stake = decodeStakeCredential(opt.fields[0]!);
  } else {
    throw new Error(`TDATUM-063: Option expects Constr 0|1, got ${opt.index}`);
  }
  return { payment_credential: payment, stake_credential: stake };
}

// ── ReleaseDraw ────────────────────────────────────────────────────────
// Constr(0, [bucket_id:int, policy:bytes, name:bytes, amount:int, to:Address])

export function encodeReleaseDraw(x: ReleaseDraw): Constr<Data> {
  return new Constr(0, [
    x.bucket_id, normHex(x.policy), normHex(x.name), x.amount, encodeAddress(x.to),
  ]);
}

export function decodeReleaseDraw(d: Data): ReleaseDraw {
  const c = asConstr(d, "ReleaseDraw");
  if (c.index !== 0) throw new Error(`TDATUM-070: ReleaseDraw expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`TDATUM-071: ReleaseDraw expects 5 fields, got ${c.fields.length}`);
  return {
    bucket_id: asInt(c.fields[0]!, "ReleaseDraw.bucket_id"),
    policy:    asBytes(c.fields[1]!, "ReleaseDraw.policy"),
    name:      asBytes(c.fields[2]!, "ReleaseDraw.name"),
    amount:    asInt(c.fields[3]!, "ReleaseDraw.amount"),
    to:        decodeAddress(c.fields[4]!),
  };
}

// ── OutputReference ────────────────────────────────────────────────────
// Constr(0, [transaction_id:bytes, output_index:int])

export function encodeOutputReference(r: OutputReference): Constr<Data> {
  return new Constr(0, [normHex(r.transaction_id), r.output_index]);
}

export function decodeOutputReference(d: Data): OutputReference {
  const c = asConstr(d, "OutputReference");
  if (c.index !== 0) throw new Error(`TDATUM-080: OutputReference expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`TDATUM-081: OutputReference expects 2 fields, got ${c.fields.length}`);
  return {
    transaction_id: asBytes(c.fields[0]!, "OutputReference.transaction_id"),
    output_index:   asInt(c.fields[1]!, "OutputReference.output_index"),
  };
}

// ── ProposalStatus / ProposalResult ────────────────────────────────────
// ProposalStatus Constr index theo thứ tự khai báo: Open=0,Tallied=1,Executed=2,Rejected=3.

export const PROPOSAL_STATUS = {
  Open:     0,
  Tallied:  1,
  Executed: 2,
  Rejected: 3,
} as const;

const STATUS_BY_INDEX: ProposalStatus[] = ["Open", "Tallied", "Executed", "Rejected"];

export function encodeProposalStatus(s: ProposalStatus): Constr<Data> {
  return new Constr(PROPOSAL_STATUS[s], []);
}

export function decodeProposalStatus(d: Data): ProposalStatus {
  const c = asConstr(d, "ProposalStatus");
  if (c.fields.length !== 0) throw new Error(`TDATUM-090: ProposalStatus expects 0 fields, got ${c.fields.length}`);
  const s = STATUS_BY_INDEX[c.index];
  if (s === undefined) throw new Error(`TDATUM-091: ProposalStatus unknown Constr ${c.index}`);
  return s;
}

// ProposalResult Constr(0, [proposal_id:bytes, status, spend_spec_hash:bytes,
//                           execute_after_epoch:int, released_cumulative:int])

export function encodeProposalResult(p: ProposalResult): Constr<Data> {
  return new Constr(0, [
    normHex(p.proposal_id),
    encodeProposalStatus(p.status),
    normHex(p.spend_spec_hash),
    p.execute_after_epoch,
    p.released_cumulative,
  ]);
}

export function decodeProposalResult(d: Data): ProposalResult {
  const c = asConstr(d, "ProposalResult");
  if (c.index !== 0) throw new Error(`TDATUM-100: ProposalResult expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`TDATUM-101: ProposalResult expects 5 fields, got ${c.fields.length}`);
  return {
    proposal_id:         asBytes(c.fields[0]!, "ProposalResult.proposal_id"),
    status:              decodeProposalStatus(c.fields[1]!),
    spend_spec_hash:     asBytes(c.fields[2]!, "ProposalResult.spend_spec_hash"),
    execute_after_epoch: asInt(c.fields[3]!, "ProposalResult.execute_after_epoch"),
    released_cumulative: asInt(c.fields[4]!, "ProposalResult.released_cumulative"),
  };
}

export function proposalResultToCbor(p: ProposalResult): string {
  return Data.to(encodeProposalResult(p));
}

export function proposalResultFromCbor(cbor: string): ProposalResult {
  return decodeProposalResult(Data.from(cbor));
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
      // Release { proposal_ref: OutputReference, draws: List<ReleaseDraw> }
      return new Constr(CUSTODY_REDEEMER.Release, [
        encodeOutputReference(r.proposal_ref),
        r.draws.map(encodeReleaseDraw),
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

function decodeBucketMove(d: Data): BucketMove {
  const c = asConstr(d, "BucketMove");
  if (c.index !== 0) throw new Error(`TDATUM-110: BucketMove expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`TDATUM-111: BucketMove expects 5 fields, got ${c.fields.length}`);
  return {
    from_bucket: asInt(c.fields[0]!, "BucketMove.from_bucket"),
    to_bucket:   asInt(c.fields[1]!, "BucketMove.to_bucket"),
    policy:      asBytes(c.fields[2]!, "BucketMove.policy"),
    name:        asBytes(c.fields[3]!, "BucketMove.name"),
    amount:      asInt(c.fields[4]!, "BucketMove.amount"),
  };
}

/** Decode CustodyRedeemer (mirror encodeCustodyRedeemer — 4 nhánh theo Constr index). */
export function decodeCustodyRedeemer(d: Data): CustodyRedeemer {
  const c = asConstr(d, "CustodyRedeemer");
  switch (c.index) {
    case CUSTODY_REDEEMER.Collect: {
      if (c.fields.length !== 1) throw new Error(`TDATUM-120: Collect expects 1 field, got ${c.fields.length}`);
      return { kind: "Collect", items: asList(c.fields[0]!, "Collect.items").map(decodeCollectItem) };
    }
    case CUSTODY_REDEEMER.Release: {
      if (c.fields.length !== 2) throw new Error(`TDATUM-121: Release expects 2 fields, got ${c.fields.length}`);
      return {
        kind: "Release",
        proposal_ref: decodeOutputReference(c.fields[0]!),
        draws:        asList(c.fields[1]!, "Release.draws").map(decodeReleaseDraw),
      };
    }
    case CUSTODY_REDEEMER.Rebalance: {
      if (c.fields.length !== 1) throw new Error(`TDATUM-122: Rebalance expects 1 field, got ${c.fields.length}`);
      return { kind: "Rebalance", moves: asList(c.fields[0]!, "Rebalance.moves").map(decodeBucketMove) };
    }
    case CUSTODY_REDEEMER.MigrateIn: {
      if (c.fields.length !== 1) throw new Error(`TDATUM-123: MigrateIn expects 1 field, got ${c.fields.length}`);
      return { kind: "MigrateIn", source: asBytes(c.fields[0]!, "MigrateIn.source") };
    }
    default:
      throw new Error(`TDATUM-124: CustodyRedeemer unknown Constr ${c.index}`);
  }
}
