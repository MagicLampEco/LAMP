// Genesis datum codec round-trip + byte-perfect Constr index (mirror types.ak).

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  encodeSupplyState, decodeSupplyState, supplyStateToCbor, supplyStateFromCbor,
  encodeMintRoute, mintRouteToCbor, threadNftRedeemerToCbor, supplyStateRedeemerToCbor,
  MINT_ROUTE,
} from "../offchain/src/datum.js";
import { DIST_CAP_OILDROP, RESERVE_CAP_OILDROP } from "../offchain/src/constants.js";
import type { SupplyState } from "../offchain/src/types.js";

const sample: SupplyState = {
  dist_minted:    123_000_000n,
  reserve_minted: 7_000_000n,
  dist_cap:       DIST_CAP_OILDROP,
  reserve_cap:    RESERVE_CAP_OILDROP,
};

describe("SupplyState codec", () => {
  it("encode → Constr(0, [int×4])", () => {
    const c = encodeSupplyState(sample);
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([
      123_000_000n, 7_000_000n, DIST_CAP_OILDROP, RESERVE_CAP_OILDROP,
    ]);
  });

  it("round-trip object → cbor → object", () => {
    const back = supplyStateFromCbor(supplyStateToCbor(sample));
    expect(back).toEqual(sample);
  });

  it("decode rejects wrong Constr index", () => {
    expect(() => decodeSupplyState(new Constr(1, [0n, 0n, 0n, 0n]))).toThrow(/Constr 0/);
  });

  it("decode rejects wrong field count", () => {
    expect(() => decodeSupplyState(new Constr(0, [0n, 0n, 0n]))).toThrow(/4 fields/);
  });

  it("decode rejects non-int field", () => {
    expect(() => decodeSupplyState(new Constr(0, ["aa", 0n, 0n, 0n]))).toThrow(/int/);
  });
});

describe("Redeemer codec (Constr index byte-perfect)", () => {
  it("DistributionVest = Constr(0,[])", () => {
    expect(MINT_ROUTE.DistributionVest).toBe(0);
    expect(encodeMintRoute("DistributionVest")).toEqual(new Constr(0, []));
  });

  it("ReserveDraw = Constr(1,[])", () => {
    expect(MINT_ROUTE.ReserveDraw).toBe(1);
    expect(encodeMintRoute("ReserveDraw")).toEqual(new Constr(1, []));
  });

  it("mintRouteToCbor matches Data.to", () => {
    expect(mintRouteToCbor("ReserveDraw")).toBe(Data.to(new Constr(1, [])));
  });

  it("ThreadNftRedeemer.MintGenesis = Constr(0,[])", () => {
    expect(threadNftRedeemerToCbor()).toBe(Data.to(new Constr(0, [])));
  });

  it("SupplyStateRedeemer.Advance = Constr(0,[])", () => {
    expect(supplyStateRedeemerToCbor()).toBe(Data.to(new Constr(0, [])));
  });
});
