// Treasury reserve-pull builder — test CẤU TRÚC (offline, không cần lucid network).
//
// Phủ phần thuần (không cần provider/UTxO thật):
//   - mintAuthRedeemerToCbor / voidCbor: redeemer + datum Void = Constr(0,[]) = "d87980".
//   - parkedOf: đọc LAMP từ custody UTxO assets.
//   - attachGateSpend fail-fast: parked ≥ floor → ném RGATE-001; auth qty ≠ 1 → RGATE-002.
//
// Phần dựng TX đầy đủ (.complete()) cần lucid provider + UTxO ví thật → KHÔNG test offline
// ở đây (TODO: integration test với emulator khi có harness). Logic onchain đã phủ ở
// reserve_auth.ak / reserve_gate.ak (aiken check: 74 checks xanh).

import { describe, it, expect } from "vitest";
import type { UTxO } from "@lucid-evolution/lucid";
import { toUnit } from "@lucid-evolution/lucid";
import { mintAuthRedeemerToCbor } from "../offchain/src/reserveAuthBuilder.js";
import {
  voidCbor, parkedOf, attachGateSpend,
  type ReserveGateSpendParams,
} from "../offchain/src/reserveGateBuilder.js";

// ── Fixtures ───────────────────────────────────────────────────────────
const LAMP_POLICY = "77".repeat(28);       // 56 hex
const LAMP_NAME = "744c414d50";            // "tLAMP"
const AUTH_POLICY = "a1".repeat(28);
const AUTH_NAME = "5450554c4c";            // "TPULL"
const CUST_POLICY = "c0".repeat(28);
const CUST_NAME = "435553";                // "CUS"

const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);
const authUnit = toUnit(AUTH_POLICY, AUTH_NAME);
const custUnit = toUnit(CUST_POLICY, CUST_NAME);

function custodyUtxo(parkedLamp: bigint): UTxO {
  return {
    txHash: "ab".repeat(32),
    outputIndex: 0,
    address: "addr_test1xxx",
    assets: { lovelace: 2_000_000n, [custUnit]: 1n, [lampUnit]: parkedLamp },
    datum: undefined,
    datumHash: undefined,
    scriptRef: undefined,
  };
}

function authUtxo(authQty: bigint): UTxO {
  return {
    txHash: "cd".repeat(32),
    outputIndex: 1,
    address: "addr_test1gate",
    assets: authQty === 0n
      ? { lovelace: 2_000_000n }
      : { lovelace: 2_000_000n, [authUnit]: authQty },
    datum: undefined,
    datumHash: undefined,
    scriptRef: undefined,
  };
}

// `lucid` thật không cần — attachGateSpend fail-fast TRƯỚC khi đụng txb.
function gateParams(over: Partial<ReserveGateSpendParams> = {}): ReserveGateSpendParams {
  return {
    lucid: {} as any,
    authUtxo: authUtxo(1n),
    gateScript: { type: "PlutusV3", script: "00" } as any,
    gateAddress: "addr_test1gate",
    authPolicyId: AUTH_POLICY,
    authName: AUTH_NAME,
    custodyUtxo: custodyUtxo(50n),
    lampPolicyId: LAMP_POLICY,
    tokenName: LAMP_NAME,
    floorOildrop: 100n,
    ...over,
  };
}

// ── Redeemer / datum codec ──────────────────────────────────────────────
describe("Void codec — MintAuth + gate datum/redeemer = Constr(0,[])", () => {
  it("mintAuthRedeemerToCbor == d87980", () => {
    expect(mintAuthRedeemerToCbor()).toBe("d87980");
  });
  it("voidCbor == d87980 (đồng nhất MintAuth)", () => {
    expect(voidCbor()).toBe("d87980");
  });
});

// ── parkedOf ────────────────────────────────────────────────────────────
describe("parkedOf — đọc LAMP parked từ custody UTxO", () => {
  it("đọc đúng số LAMP trong value", () => {
    expect(parkedOf(custodyUtxo(123n), LAMP_POLICY, LAMP_NAME)).toBe(123n);
  });
  it("custody cạn LAMP → 0n", () => {
    expect(parkedOf(custodyUtxo(0n), LAMP_POLICY, LAMP_NAME)).toBe(0n);
  });
  it("unit LAMP không có → 0n (không ném)", () => {
    const u: UTxO = { ...custodyUtxo(0n), assets: { lovelace: 2_000_000n, [custUnit]: 1n } };
    expect(parkedOf(u, LAMP_POLICY, LAMP_NAME)).toBe(0n);
  });
});

// ── attachGateSpend fail-fast (khớp G-FLOOR-1 / G-AUTH-1 onchain) ────────
describe("attachGateSpend — fail-fast ép sàn + auth NFT trước khi build", () => {
  it("parked < floor → KHÔNG ném ở bước kiểm sàn (đi tiếp tới txb)", () => {
    // lucid rỗng → ném ở .collectFrom (TypeError), KHÔNG phải RGATE-001/002.
    // Khẳng định: lỗi NÉM RA không phải lỗi sàn/auth → 2 kiểm fail-fast đã qua.
    let msg = "";
    try {
      attachGateSpend({} as any, gateParams({ custodyUtxo: custodyUtxo(50n) }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toMatch(/RGATE-001/);
    expect(msg).not.toMatch(/RGATE-002/);
  });

  it("parked == floor → RGATE-001 (sàn là cận chặt, không kéo)", () => {
    expect(() =>
      attachGateSpend({} as any, gateParams({ custodyUtxo: custodyUtxo(100n), floorOildrop: 100n })),
    ).toThrow(/RGATE-001/);
  });

  it("parked > floor → RGATE-001 (trên sàn, không cần kéo)", () => {
    expect(() =>
      attachGateSpend({} as any, gateParams({ custodyUtxo: custodyUtxo(150n), floorOildrop: 100n })),
    ).toThrow(/RGATE-001/);
  });

  it("auth UTxO không mang đúng 1 auth NFT → RGATE-002", () => {
    expect(() =>
      attachGateSpend({} as any, gateParams({ authUtxo: authUtxo(0n) })),
    ).toThrow(/RGATE-002/);
  });

  it("auth UTxO mang 2 auth NFT → RGATE-002 (phải đúng 1)", () => {
    expect(() =>
      attachGateSpend({} as any, gateParams({ authUtxo: authUtxo(2n) })),
    ).toThrow(/RGATE-002/);
  });
});
