// LAMP Genesis datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain types.ak (Constr index = thứ tự khai báo, từ 0).
//
//   SupplyState{dist_minted, reserve_minted, dist_cap, reserve_cap}
//                                    = Constr(0, [int, int, int, int])
//   TLampMintRedeemer: DistributionVest=Constr(0,[]); ReserveDraw=Constr(1,[])
//   ThreadNftRedeemer: MintGenesis    = Constr(0,[])
//   SupplyStateRedeemer: Advance      = Constr(0,[])
//
// Duck-type Constr (như Treasury/Distribution datum.ts) để tránh lỗi `instanceof`
// khi có 2 bản @lucid-evolution/lucid khác class identity (offchain vs scripts).

import { Constr, Data } from "@lucid-evolution/lucid";
import type { MintRoute, SupplyState } from "./types.js";

// ── Redeemer constructor index map (mirror types.ak) ───────────────────
export const MINT_ROUTE = {
  DistributionVest: 0,
  ReserveDraw:      1,
} as const;

// ── helpers ────────────────────────────────────────────────────────────

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`GDATUM-000: expected Constr for ${ctx}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`GDATUM-002: expected int for ${ctx}`);
  return d;
}

// ── SupplyState ────────────────────────────────────────────────────────
// Constr(0, [dist_minted:int, reserve_minted:int, dist_cap:int, reserve_cap:int])

export function encodeSupplyState(s: SupplyState): Constr<Data> {
  return new Constr(0, [s.dist_minted, s.reserve_minted, s.dist_cap, s.reserve_cap]);
}

export function decodeSupplyState(d: Data): SupplyState {
  const c = asConstr(d, "SupplyState");
  if (c.index !== 0) throw new Error(`GDATUM-010: SupplyState expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 4) throw new Error(`GDATUM-011: SupplyState expects 4 fields, got ${c.fields.length}`);
  return {
    dist_minted:    asInt(c.fields[0]!, "SupplyState.dist_minted"),
    reserve_minted: asInt(c.fields[1]!, "SupplyState.reserve_minted"),
    dist_cap:       asInt(c.fields[2]!, "SupplyState.dist_cap"),
    reserve_cap:    asInt(c.fields[3]!, "SupplyState.reserve_cap"),
  };
}

export function supplyStateToCbor(s: SupplyState): string {
  return Data.to(encodeSupplyState(s));
}

export function supplyStateFromCbor(cbor: string): SupplyState {
  return decodeSupplyState(Data.from(cbor));
}

// ── Redeemers ──────────────────────────────────────────────────────────

export function encodeMintRoute(r: MintRoute): Constr<Data> {
  return new Constr(MINT_ROUTE[r], []);
}

export function mintRouteToCbor(r: MintRoute): string {
  return Data.to(encodeMintRoute(r));
}

/** ThreadNftRedeemer.MintGenesis = Constr(0, []). */
export function threadNftRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

/** SupplyStateRedeemer.Advance = Constr(0, []). */
export function supplyStateRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
