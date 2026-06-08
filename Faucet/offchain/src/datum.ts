// Faucet datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain types.ak. Constr index = thứ tự khai báo.
//
//   FaucetDatum{claim_amount}        = Constr(0, [int])
//   FaucetRedeemer: Claim            = Constr(0, [])
//   TLampRedeemer:  MintGenesis      = Constr(0, [])

import { Constr, Data } from "@lucid-evolution/lucid";
import type { FaucetDatum } from "./types.js";

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

// ── Redeemers ──────────────────────────────────────────────────────────

/** FaucetRedeemer: Claim = Constr(0, []). */
export function claimRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

/** TLampRedeemer: MintGenesis = Constr(0, []). */
export function mintGenesisRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
