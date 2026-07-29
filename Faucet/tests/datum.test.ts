// Faucet datum codec round-trip + constant sanity.

import { describe, it, expect } from "vitest";
import { Data } from "@lucid-evolution/lucid";
import {
  faucetDatumToCbor, faucetDatumFromCbor, decodeFaucetDatum,
  claimRedeemerToCbor, mintGenesisRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  TOTAL_SUPPLY_OILDROP, CLAIM_AMOUNT_OILDROP, OILDROP_PER_LAMP, TLAMP_ASSET_NAME,
} from "../offchain/src/constants.js";

describe("FaucetDatum codec", () => {
  it("round-trips claim_amount", () => {
    const d = { claim_amount: CLAIM_AMOUNT_OILDROP };
    expect(faucetDatumFromCbor(faucetDatumToCbor(d))).toEqual(d);
  });

  it("encodes as Constr(0, [int])", () => {
    const cbor = faucetDatumToCbor({ claim_amount: 100_000_000n });
    const back = decodeFaucetDatum(Data.from(cbor));
    expect(back.claim_amount).toBe(100_000_000n);
  });

  it("rejects wrong field count (Constr 0 with 0 fields)", () => {
    // d87980 = Constr(0, []) → 0 fields → reject (FaucetDatum needs 1).
    expect(() => decodeFaucetDatum(Data.from("d87980"))).toThrow(/1 field/);
  });
});

describe("redeemers", () => {
  it("Claim = Constr(0, []) = d87980", () => {
    expect(claimRedeemerToCbor()).toBe("d87980");
  });
  it("MintGenesis = Constr(0, []) = d87980", () => {
    expect(mintGenesisRedeemerToCbor()).toBe("d87980");
  });
});

describe("constants — decimals 6, supply 36e9", () => {
  it("OILDROP_PER_LAMP = 10^6", () => {
    expect(OILDROP_PER_LAMP).toBe(1_000_000n);
  });
  it("total supply = 36e9 LAMP × 1e6 = 3.6e16 oildrop", () => {
    expect(TOTAL_SUPPLY_OILDROP).toBe(36_000_000_000_000_000n);
  });
  it("claim = 100 LAMP = 1e8 oildrop", () => {
    expect(CLAIM_AMOUNT_OILDROP).toBe(100_000_000n);
  });
  it("asset name tLAMP = 744c414d50", () => {
    expect(TLAMP_ASSET_NAME).toBe("744c414d50");
  });
});
