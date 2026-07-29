// LAMP Genesis — supply_state datum codec (CBOR-hex API).
//
// Codec ĐÚNG byte với datum supply_state ĐÃ XÁC MINH trên MAINNET
// (tx genesis db0610c2…, policy 55d3e01b…180f0, NFT "SUPPLY"):
//
//   SupplyState = Constr(0, [dist_minted, reserve_minted, dist_cap, reserve_cap])
//                 (4 int oildrop, đơn điệu tăng, ≤ 36B, chống mint đôi)
//
//   CBOR mainnet (inline datum, constructor 0):
//     d8799f 1b000000e8d4a51000 00 1b005daf6012ba2000 1b0022366f192fe000 ff
//     └Constr0┘ dist=1e12       │  dist_cap=26,37B     reserve_cap=9,63B  └break
//                          reserve=0
//
// API dạng chuỗi CBOR-hex (khác datum.ts vốn trả Constr<Data>): thuận cho verify
// on-chain (so trực tiếp với inline_datum hex koios) + snapshot bất biến trong test.
//
// PHẢI khớp byte-perfect onchain lib/magiclamp/genesis/types.ak — Constr index =
// thứ tự khai báo (từ 0). Đơn vị: 1 LAMP = 10⁶ oildrop, BigInt tuyệt đối (C-OVERFLOW).

import { Constr, Data } from "@lucid-evolution/lucid";
import type { SupplyState } from "./types.js";

/** Constr index của SupplyState trong types.ak (biến thể đầu tiên). */
export const SUPPLY_STATE_CONSTR = 0 as const;

/**
 * CBOR-hex datum supply_state ĐÃ XÁC MINH trên MAINNET (genesis db0610c2…).
 * Dùng làm bất biến then chốt trong test + đối chiếu với inline_datum koios.
 * dist_minted=1e12 · reserve_minted=0 · dist_cap=26,37B · reserve_cap=9,63B (×10⁶ oildrop).
 */
export const MAINNET_SUPPLY_STATE_CBOR =
  "d8799f1b000000e8d4a51000001b005daf6012ba20001b0022366f192fe000ff";

// ── helpers (duck-type Constr để tránh lỗi `instanceof` khi có 2 bản lucid) ──

function asConstr(d: Data): Constr<Data> {
  if (d instanceof Constr) return d;
  if (
    d !== null && typeof d === "object" &&
    typeof (d as { index?: unknown }).index === "number" &&
    Array.isArray((d as { fields?: unknown }).fields)
  ) {
    return d as unknown as Constr<Data>;
  }
  throw new Error("SUPPLY-DATUM-000: datum không phải Constr");
}

function asInt(d: Data, field: string): bigint {
  if (typeof d !== "bigint") throw new Error(`SUPPLY-DATUM-002: field ${field} phải là int`);
  return d;
}

// ── encode / decode (CBOR-hex) ───────────────────────────────────────────

/** SupplyState → CBOR hex (Constr(0, [int×4]), byte-perfect onchain). */
export function encodeSupplyState(s: SupplyState): string {
  return Data.to(
    new Constr(SUPPLY_STATE_CONSTR, [
      s.dist_minted,
      s.reserve_minted,
      s.dist_cap,
      s.reserve_cap,
    ]),
  );
}

/** CBOR hex → SupplyState (kiểm Constr index 0, đúng 4 field int). */
export function decodeSupplyState(hex: string): SupplyState {
  const c = asConstr(Data.from(hex));
  if (c.index !== SUPPLY_STATE_CONSTR) {
    throw new Error(`SUPPLY-DATUM-010: SupplyState cần Constr ${SUPPLY_STATE_CONSTR}, gặp ${c.index}`);
  }
  if (c.fields.length !== 4) {
    throw new Error(`SUPPLY-DATUM-011: SupplyState cần 4 field, gặp ${c.fields.length}`);
  }
  return {
    dist_minted:    asInt(c.fields[0]!, "dist_minted"),
    reserve_minted: asInt(c.fields[1]!, "reserve_minted"),
    dist_cap:       asInt(c.fields[2]!, "dist_cap"),
    reserve_cap:    asInt(c.fields[3]!, "reserve_cap"),
  };
}
