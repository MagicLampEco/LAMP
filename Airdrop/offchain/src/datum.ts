// TIGER Airdrop datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain ledger.ak. Constr index = thứ tự khai báo.
//
//   AirdropPool{merkle_root, deadline_epoch, treasury_dest, marker_dest, claimed_count}
//     = Constr(0, [bytes, int, Address, Address, int])
//   ProofStep{is_left, hash}        = Constr(0, [bool, bytes])
//   AirdropRedeemer: Claim{claimer, amount, proof} = Constr(0, [Address, int, [ProofStep]])
//                    Sweep                          = Constr(1, [])
//   AirdropNftRedeemer: MintPool=Constr0, BurnSlot=Constr1 (GIỮ index — codec không lệch).

import { Constr, Data, getAddressDetails } from "@lucid-evolution/lucid";
import { addressToPlutusData } from "./merkle.js";
import type { AirdropPool, ProofStep, SnapshotEntry } from "./types.js";

// ── guards ───────────────────────────────────────────────────────────────

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`AIRDROP-DATUM-000: expected Constr for ${ctx}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`AIRDROP-DATUM-002: expected int for ${ctx}`);
  return d;
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`AIRDROP-DATUM-003: expected bytes for ${ctx}`);
  return d;
}

// ── bool ⇄ Plutus Data (Aiken Bool: False=Constr0, True=Constr1) ──────────

function boolToData(b: boolean): Constr<Data> {
  return new Constr(b ? 1 : 0, []);
}

function dataToBool(d: Data, ctx: string): boolean {
  const c = asConstr(d, ctx);
  if (c.index !== 0 && c.index !== 1) throw new Error(`AIRDROP-DATUM-004: bad Bool for ${ctx}`);
  return c.index === 1;
}

// ── Address ⇄ Data (decode đối xứng addressToPlutusData) ──────────────────

function dataToCredentialHash(d: Data, ctx: string): { hash: string; isScript: boolean } {
  const c = asConstr(d, ctx);
  return { hash: asBytes(c.fields[0]!, ctx), isScript: c.index === 1 };
}

/** Decode Address Data → bech32 (cần network để dựng lại; lưu raw nếu cần). */
export function addressDataToHash(d: Data): {
  payment: { hash: string; isScript: boolean };
  stake?: { hash: string; isScript: boolean };
} {
  const c = asConstr(d, "Address");
  const payment = dataToCredentialHash(c.fields[0]!, "payment_credential");
  const stakeField = asConstr(c.fields[1]!, "stake_credential");
  if (stakeField.index === 1) {
    return { payment };
  }
  // Some(Inline(cred)) = Constr(0,[Constr(0,[cred])]).
  const inline = asConstr(stakeField.fields[0]!, "stake Inline");
  const stake = dataToCredentialHash(inline.fields[0]!, "stake_credential");
  return { payment, stake };
}

// ── ProofStep ─────────────────────────────────────────────────────────────

export function encodeProofStep(s: ProofStep): Constr<Data> {
  return new Constr(0, [boolToData(s.is_left), s.hash]);
}

export function decodeProofStep(d: Data): ProofStep {
  const c = asConstr(d, "ProofStep");
  if (c.index !== 0) throw new Error(`AIRDROP-DATUM-070: ProofStep expects Constr 0`);
  if (c.fields.length !== 2) throw new Error(`AIRDROP-DATUM-071: ProofStep expects 2 fields`);
  return { is_left: dataToBool(c.fields[0]!, "is_left"), hash: asBytes(c.fields[1]!, "hash") };
}

// ── AirdropPool datum ───────────────────────────────────────────────────

export function encodeAirdropPool(p: AirdropPool): Constr<Data> {
  return new Constr(0, [
    p.merkle_root,
    p.deadline_epoch,
    addressToPlutusData(p.treasury_dest),
    addressToPlutusData(p.marker_dest),
    p.claimed_count,
  ]);
}

export function airdropPoolToCbor(p: AirdropPool): string {
  return Data.to(encodeAirdropPool(p));
}

/** Decode pool datum. treasury_dest/marker_dest trả về dạng {payment,stake} hash
 *  (caller dựng lại bech32 với network nếu cần) — đủ để đối chiếu/kế toán. */
export function decodeAirdropPoolRaw(d: Data): {
  merkle_root: string;
  deadline_epoch: bigint;
  treasury_dest: ReturnType<typeof addressDataToHash>;
  marker_dest: ReturnType<typeof addressDataToHash>;
  claimed_count: bigint;
} {
  const c = asConstr(d, "AirdropPool");
  if (c.index !== 0) throw new Error(`AIRDROP-DATUM-080: AirdropPool expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 5) throw new Error(`AIRDROP-DATUM-081: AirdropPool expects 5 fields, got ${c.fields.length}`);
  return {
    merkle_root: asBytes(c.fields[0]!, "merkle_root"),
    deadline_epoch: asInt(c.fields[1]!, "deadline_epoch"),
    treasury_dest: addressDataToHash(c.fields[2]!),
    marker_dest: addressDataToHash(c.fields[3]!),
    claimed_count: asInt(c.fields[4]!, "claimed_count"),
  };
}

export function airdropPoolFromCbor(cbor: string): ReturnType<typeof decodeAirdropPoolRaw> {
  return decodeAirdropPoolRaw(Data.from(cbor));
}

// ── Redeemers ──────────────────────────────────────────────────────────

/** Claim{claimer, amount, proof} = Constr(0, [Address, int, [ProofStep]]). */
export function claimRedeemerToCbor(
  entry: SnapshotEntry,
  proof: ProofStep[],
): string {
  // claimer = address của entry (khớp leaf onchain).
  void getAddressDetails; // address validity kiểm qua addressToPlutusData
  return Data.to(
    new Constr(0, [
      addressToPlutusData(entry.address),
      entry.amount,
      proof.map(encodeProofStep),
    ]),
  );
}

/** Sweep = Constr(1, []). */
export function sweepRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}

/** AirdropNftRedeemer: MintPool = Constr(0,[]). SETUP one-shot (POOL + N slot). */
export function mintPoolRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

/** AirdropNftRedeemer: BurnSlot = Constr(1,[]). Tiêu + burn slot lúc Claim/Sweep.
 *  (GIỮ Constr index 1 — đổi tên từ MintClaim, codec không lệch.) */
export function burnSlotRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}

/** @deprecated Đổi ngữ nghĩa: đúc marker → burn slot. Dùng burnSlotRedeemerToCbor. */
export const mintClaimRedeemerToCbor = burnSlotRedeemerToCbor;
