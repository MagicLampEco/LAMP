// Faucet datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain types.ak. Constr index = thứ tự khai báo.
//
//   FaucetDatum{claim_amount}        = Constr(0, [int])
//   FaucetRedeemer: Claim            = Constr(0, [])
//   TLampRedeemer:  MintGenesis      = Constr(0, [])

import { Constr, Data } from "@lucid-evolution/lucid";
import type { FaucetDatum, FaucetConfig, FaucetAccount } from "./types.js";

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`FAUCET-DATUM-000: expected Constr for ${ctx}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`FAUCET-DATUM-002: expected int for ${ctx}`);
  return d;
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`FAUCET-DATUM-003: expected bytes for ${ctx}`);
  return d;
}

// ── FaucetDatum ────────────────────────────────────────────────────────

export function encodeFaucetDatum(d: FaucetDatum): Constr<Data> {
  return new Constr(0, [d.claim_amount]);
}

export function decodeFaucetDatum(d: Data): FaucetDatum {
  const c = asConstr(d, "FaucetDatum");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-020: FaucetDatum expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 1) throw new Error(`FAUCET-DATUM-021: FaucetDatum expects 1 field, got ${c.fields.length}`);
  return { claim_amount: asInt(c.fields[0]!, "claim_amount") };
}

export function faucetDatumToCbor(d: FaucetDatum): string {
  return Data.to(encodeFaucetDatum(d));
}

export function faucetDatumFromCbor(cbor: string): FaucetDatum {
  return decodeFaucetDatum(Data.from(cbor));
}

// ── FaucetConfig (v2 pool datum) ────────────────────────────────────────
//   Constr(0, [drip_oildrop, cooldown_epochs, reclaim_epochs])

export function encodeFaucetConfig(c: FaucetConfig): Constr<Data> {
  return new Constr(0, [c.drip_oildrop, c.cooldown_epochs, c.reclaim_epochs]);
}

export function decodeFaucetConfig(d: Data): FaucetConfig {
  const c = asConstr(d, "FaucetConfig");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-030: FaucetConfig expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 3) throw new Error(`FAUCET-DATUM-031: FaucetConfig expects 3 fields, got ${c.fields.length}`);
  return {
    drip_oildrop: asInt(c.fields[0]!, "drip_oildrop"),
    cooldown_epochs: asInt(c.fields[1]!, "cooldown_epochs"),
    reclaim_epochs: asInt(c.fields[2]!, "reclaim_epochs"),
  };
}

export function faucetConfigToCbor(c: FaucetConfig): string {
  return Data.to(encodeFaucetConfig(c));
}

export function faucetConfigFromCbor(cbor: string): FaucetConfig {
  return decodeFaucetConfig(Data.from(cbor));
}

// ── FaucetAccount (v2 account datum) ────────────────────────────────────
//   Constr(0, [did_name, last_epoch])

export function encodeFaucetAccount(a: FaucetAccount): Constr<Data> {
  return new Constr(0, [a.did_name, a.last_epoch]);
}

export function decodeFaucetAccount(d: Data): FaucetAccount {
  const c = asConstr(d, "FaucetAccount");
  if (c.index !== 0) throw new Error(`FAUCET-DATUM-040: FaucetAccount expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 2) throw new Error(`FAUCET-DATUM-041: FaucetAccount expects 2 fields, got ${c.fields.length}`);
  return {
    did_name: asBytes(c.fields[0]!, "did_name"),
    last_epoch: asInt(c.fields[1]!, "last_epoch"),
  };
}

export function faucetAccountToCbor(a: FaucetAccount): string {
  return Data.to(encodeFaucetAccount(a));
}

export function faucetAccountFromCbor(cbor: string): FaucetAccount {
  return decodeFaucetAccount(Data.from(cbor));
}

// ── Redeemers ──────────────────────────────────────────────────────────

/** [LEGACY] FaucetRedeemer v1: Claim = Constr(0, []). */
export function claimRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

/** TLampRedeemer: MintGenesis = Constr(0, []). */
export function mintGenesisRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

// PoolRedeemer (v2): Claim = Constr(0,[]), Reclaim = Constr(1,[]).
export function poolClaimRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
export function poolReclaimRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}

// AccountRedeemer (v2): Use = Constr(0,[]), ReclaimIdle = Constr(1,[]).
export function accountUseRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
export function accountReclaimIdleRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}

// FaucetNftRedeemer: MintPool = Constr(0,[]), MintAccount = Constr(1,[]).
export function mintPoolRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
export function mintAccountRedeemerToCbor(): string {
  return Data.to(new Constr(1, []));
}
