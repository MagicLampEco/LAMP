// Reserve datum codec round-trip + byte-perfect Constr index (mirror types.ak).

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  encodeReserveState, decodeReserveState,
  reserveStateToCbor, reserveStateFromCbor,
  drawRedeemerToCbor,
} from "../offchain/src/datum.js";
import { RESERVE_TOTAL_OIL } from "../offchain/src/constants.js";
import type { ReserveState } from "../offchain/src/types.js";

const sample: ReserveState = {
  start_epoch: 100n,
  total_oil:   RESERVE_TOTAL_OIL,
  drawn_oil:   123_000_000n,
  last_epoch:  142n,
};

describe("ReserveState codec", () => {
  it("encode → Constr(0, [int×4])", () => {
    const c = encodeReserveState(sample);
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([100n, RESERVE_TOTAL_OIL, 123_000_000n, 142n]);
  });

  it("round-trip object → cbor → object", () => {
    const back = reserveStateFromCbor(reserveStateToCbor(sample));
    expect(back).toEqual(sample);
  });

  it("decode rejects wrong Constr index", () => {
    expect(() => decodeReserveState(new Constr(1, [0n, 0n, 0n, 0n]))).toThrow(/Constr 0/);
  });

  it("decode rejects wrong field count", () => {
    expect(() => decodeReserveState(new Constr(0, [0n, 0n, 0n]))).toThrow(/4 fields/);
  });

  it("decode rejects non-int field", () => {
    expect(() => decodeReserveState(new Constr(0, ["aa", 0n, 0n, 0n]))).toThrow(/int/);
  });
});

describe("ReserveRedeemer codec (byte-perfect)", () => {
  it("Draw = Constr(0,[])", () => {
    expect(drawRedeemerToCbor()).toBe(Data.to(new Constr(0, [])));
  });
});
