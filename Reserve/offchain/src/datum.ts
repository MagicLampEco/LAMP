// LAMP Reserve datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect onchain types.ak (Constr index = thứ tự khai báo, từ 0).
//
//   ReserveState{start_epoch, total_oil, drawn_oil, last_epoch} = Constr(0, [int×4])
//   ReserveRedeemer: Draw                                       = Constr(0, [])
//
// Duck-type Constr (như Genesis/Distribution datum.ts) để tránh lỗi `instanceof`
// khi có 2 bản @lucid-evolution/lucid khác class identity.

import { Constr, Data } from "@lucid-evolution/lucid";
import type { ReserveState } from "./types.js";

// ── helpers ────────────────────────────────────────────────────────────

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null &&
    typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error(`RDATUM-000: expected Constr for ${ctx}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`RDATUM-002: expected int for ${ctx}`);
  return d;
}

// ── ReserveState ────────────────────────────────────────────────────────
// Constr(0, [start_epoch:int, total_oil:int, drawn_oil:int, last_epoch:int])

export function encodeReserveState(s: ReserveState): Constr<Data> {
  return new Constr(0, [s.start_epoch, s.total_oil, s.drawn_oil, s.last_epoch]);
}

export function decodeReserveState(d: Data): ReserveState {
  const c = asConstr(d, "ReserveState");
  if (c.index !== 0) throw new Error(`RDATUM-010: ReserveState expects Constr 0, got ${c.index}`);
  if (c.fields.length !== 4)
    throw new Error(`RDATUM-011: ReserveState expects 4 fields, got ${c.fields.length}`);
  return {
    start_epoch: asInt(c.fields[0]!, "ReserveState.start_epoch"),
    total_oil:   asInt(c.fields[1]!, "ReserveState.total_oil"),
    drawn_oil:   asInt(c.fields[2]!, "ReserveState.drawn_oil"),
    last_epoch:  asInt(c.fields[3]!, "ReserveState.last_epoch"),
  };
}

export function reserveStateToCbor(s: ReserveState): string {
  return Data.to(encodeReserveState(s));
}

export function reserveStateFromCbor(cbor: string): ReserveState {
  return decodeReserveState(Data.from(cbor));
}

// ── Redeemer ────────────────────────────────────────────────────────────

/** ReserveRedeemer.Draw = Constr(0, []). */
export function drawRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}
