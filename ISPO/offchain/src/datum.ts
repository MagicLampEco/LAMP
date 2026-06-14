// ISPO datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain types.ak. Constr index = thứ tự khai báo.
//
//   IspoDatum  = Constr(0, [list<bytes>, int, int, bytes, int])
//   MerkleStep = Constr(0, [bytes, bool])        // bool: False=Constr0, True=Constr1
//   ClaimProof = Constr(0, [int, bytes, int, list<MerkleStep>])
//   IspoRedeemer:    SetRoot=Constr(0,[bytes]), Claim=Constr(1,[ClaimProof]), Sweep=Constr(2,[])
//   IspoNftRedeemer: MintPool=Constr(0,[]), MintSlots=Constr(1,[]), BurnSlot=Constr(2,[])

import { Constr, Data } from "@lucid-evolution/lucid";
import type { IspoDatum, ClaimProof, MerkleStep } from "./types.js";

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`ISPO-DATUM-000: expected Constr for ${ctx}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`ISPO-DATUM-002: expected int for ${ctx}`);
  return d;
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`ISPO-DATUM-003: expected bytes for ${ctx}`);
  return d;
}

function asList(d: Data, ctx: string): Data[] {
  if (!Array.isArray(d)) throw new Error(`ISPO-DATUM-004: expected list for ${ctx}`);
  return d;
}

// ── Bool (aiken) ────────────────────────────────────────────────────────
//   False = Constr(0, []), True = Constr(1, []).
function encodeBool(b: boolean): Constr<Data> {
  return new Constr(b ? 1 : 0, []);
}

function decodeBool(d: Data, ctx: string): boolean {
  const c = asConstr(d, ctx);
  if (c.index !== 0 && c.index !== 1) throw new Error(`ISPO-DATUM-005: bool index ${c.index} for ${ctx}`);
  return c.index === 1;
}

// ── MerkleStep ──────────────────────────────────────────────────────────

export function encodeMerkleStep(s: MerkleStep): Constr<Data> {
  return new Constr(0, [s.hash, encodeBool(s.left)]);
}

export function decodeMerkleStep(d: Data): MerkleStep {
  const c = asConstr(d, "MerkleStep");
  if (c.index !== 0) throw new Error(`ISPO-DATUM-010: MerkleStep expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`ISPO-DATUM-011: MerkleStep expects 2 fields, got ${c.fields.length}`);
  return { hash: asBytes(c.fields[0]!, "step.hash"), left: decodeBool(c.fields[1]!, "step.left") };
}

// ── ClaimProof ──────────────────────────────────────────────────────────

export function encodeClaimProof(p: ClaimProof): Constr<Data> {
  return new Constr(0, [p.epoch, p.owner, p.amount, p.proof.map(encodeMerkleStep)]);
}

export function decodeClaimProof(d: Data): ClaimProof {
  const c = asConstr(d, "ClaimProof");
  if (c.index !== 0) throw new Error(`ISPO-DATUM-020: ClaimProof expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 4) throw new Error(`ISPO-DATUM-021: ClaimProof expects 4 fields, got ${c.fields.length}`);
  return {
    epoch: asInt(c.fields[0]!, "epoch"),
    owner: asBytes(c.fields[1]!, "owner"),
    amount: asInt(c.fields[2]!, "amount"),
    proof: asList(c.fields[3]!, "proof").map(decodeMerkleStep),
  };
}

// ── IspoDatum ───────────────────────────────────────────────────────────

export function encodeIspoDatum(d: IspoDatum): Constr<Data> {
  return new Constr(0, [
    d.epoch_roots as Data[],
    d.distributed_total,
    d.end_epoch,
    d.treasury_dest,
    d.ms_per_epoch,
  ]);
}

export function decodeIspoDatum(d: Data): IspoDatum {
  const c = asConstr(d, "IspoDatum");
  if (c.index !== 0) throw new Error(`ISPO-DATUM-030: IspoDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`ISPO-DATUM-031: IspoDatum expects 5 fields, got ${c.fields.length}`);
  return {
    epoch_roots: asList(c.fields[0]!, "epoch_roots").map((x) => asBytes(x, "root")),
    distributed_total: asInt(c.fields[1]!, "distributed_total"),
    end_epoch: asInt(c.fields[2]!, "end_epoch"),
    treasury_dest: asBytes(c.fields[3]!, "treasury_dest"),
    ms_per_epoch: asInt(c.fields[4]!, "ms_per_epoch"),
  };
}

export function ispoDatumToCbor(d: IspoDatum): string {
  return Data.to(encodeIspoDatum(d));
}

export function ispoDatumFromCbor(cbor: string): IspoDatum {
  return decodeIspoDatum(Data.from(cbor));
}

// ── IspoRedeemer (pool spend) ───────────────────────────────────────────

export function setRootRedeemerToCbor(root: string): string {
  return Data.to(new Constr(0, [root]));
}

export function claimRedeemerToCbor(p: ClaimProof): string {
  return Data.to(new Constr(1, [encodeClaimProof(p)]));
}

export function sweepRedeemerToCbor(): string {
  return Data.to(new Constr(2, []));
}

// ── IspoNftRedeemer (mint) ──────────────────────────────────────────────

export function mintPoolRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

/** MintSlots = Constr(1, []) — đúc bộ claim-slot lúc SetRoot. */
export function mintSlotsRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}

/** BurnSlot = Constr(2, []) — burn 1 claim-slot lúc Claim. */
export function burnSlotRedeemerToCbor(): string {
  return Data.to(new Constr(2, []));
}
