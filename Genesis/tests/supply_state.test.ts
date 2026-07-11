// Bất biến then chốt: codec supply_state PHẢI khớp ĐÚNG BYTE với datum ĐÃ XÁC MINH
// trên MAINNET (tx genesis db0610c2…, policy 55d3e01b…180f0). Nếu test này đỏ →
// codec lệch với on-chain → mọi builder mint dựa trên nó SAI. 1 LAMP = 10⁶ oildrop.

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  encodeSupplyState,
  decodeSupplyState,
  MAINNET_SUPPLY_STATE_CBOR,
} from "../offchain/src/supply_state.js";
import type { SupplyState } from "../offchain/src/types.js";

// Đúng 4 field oildrop của supply_state genesis mainnet:
//   dist_minted=1e12 (1.000.000 LAMP) · reserve_minted=0
//   dist_cap=26,37B · reserve_cap=9,63B  (26,37B + 9,63B = 36B)
const MAINNET_STATE: SupplyState = {
  dist_minted:    1_000_000_000_000n,
  reserve_minted: 0n,
  dist_cap:       26_370_000_000_000_000n,
  reserve_cap:    9_630_000_000_000_000n,
};

describe("supply_state codec ↔ mainnet CBOR", () => {
  it("encode(state mainnet) === CBOR mainnet (byte-perfect)", () => {
    expect(encodeSupplyState(MAINNET_STATE)).toBe(MAINNET_SUPPLY_STATE_CBOR);
  });

  it("decode(CBOR mainnet) === state mainnet", () => {
    expect(decodeSupplyState(MAINNET_SUPPLY_STATE_CBOR)).toEqual(MAINNET_STATE);
  });

  it("round-trip decode → encode giữ nguyên byte", () => {
    const back = decodeSupplyState(MAINNET_SUPPLY_STATE_CBOR);
    expect(encodeSupplyState(back)).toBe(MAINNET_SUPPLY_STATE_CBOR);
  });

  it("round-trip encode → decode giữ nguyên giá trị", () => {
    const sample: SupplyState = {
      dist_minted:    513_000_000n * 1_000_000n, // 513M LAMP (ETD+Airdrop+SRCL)
      reserve_minted: 42n,
      dist_cap:       26_370_000_000_000_000n,
      reserve_cap:    9_630_000_000_000_000n,
    };
    expect(decodeSupplyState(encodeSupplyState(sample))).toEqual(sample);
  });

  it("cap tổng = 36 tỷ LAMP (bất biến allocation v17)", () => {
    const s = decodeSupplyState(MAINNET_SUPPLY_STATE_CBOR);
    expect(s.dist_cap + s.reserve_cap).toBe(36_000_000_000n * 1_000_000n);
  });
});

describe("supply_state codec — kiểm lỗi", () => {
  it("decode từ chối Constr sai index", () => {
    const wrong = Data.to(new Constr(1, [0n, 0n, 0n, 0n]));
    expect(() => decodeSupplyState(wrong)).toThrow(/Constr 0/);
  });

  it("decode từ chối sai số field", () => {
    const wrong = Data.to(new Constr(0, [0n, 0n, 0n]));
    expect(() => decodeSupplyState(wrong)).toThrow(/4 field/);
  });
});
