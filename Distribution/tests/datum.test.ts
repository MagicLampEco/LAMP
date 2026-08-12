import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  // ClaimAccount
  encodeClaimAccountDatum, decodeClaimAccountDatum,
  claimAccountDatumToCbor, claimAccountDatumFromCbor,
  // redeemers
  encodeClaimRedeemer, encodeRedeemRedeemer,
  claimRedeemerToCbor, redeemRedeemerToCbor,
  CLAIM_ACCOUNT_REDEEMER,
  // beacon
  encodeBeaconKind, decodeBeaconKind, BEACON_KIND_INDEX,
  encodeBeaconDatum, decodeBeaconDatum,
  beaconDatumToCbor, beaconDatumFromCbor,
  encodeBeaconRedeemer,
  // treasury
  encodeTreasuryDatum, decodeTreasuryDatum,
  treasuryDatumToCbor, treasuryDatumFromCbor,
  encodeTreasuryRedeemer, encodeGrantEntitlementRedeemer,
} from "../offchain/src/datum.js";
import type {
  ClaimAccountDatum, BeaconDatum, BeaconKind, TreasuryDatum,
} from "../offchain/src/types.js";

// helper: parse cbor → Constr để soi index/fields đúng thứ tự types.ak.
function asConstr(cbor: string): Constr<Data> {
  const d = Data.from(cbor);
  if (!(d instanceof Constr)) throw new Error("not a Constr");
  return d;
}

describe("ClaimAccountDatum (Capped Drop)", () => {
  const sample: ClaimAccountDatum = {
    owner:           "aabbccddeeff00112233445566778899aabbccddeeff001122334455",
    entitlement:     250_000_000n,
    redeemed:        100_000_000n,
    start_epoch:     42n,
    drops_per_epoch: 1n,
  };

  it("round-trips encode→decode", () => {
    const back = decodeClaimAccountDatum(encodeClaimAccountDatum(sample));
    expect(back).toEqual(sample);
  });

  it("round-trips via CBOR", () => {
    expect(claimAccountDatumFromCbor(claimAccountDatumToCbor(sample))).toEqual(sample);
  });

  it("Constr index 0 with [bytes, int, int, int, int] in declared order", () => {
    const c = asConstr(claimAccountDatumToCbor(sample));
    expect(c.index).toBe(0);
    expect(c.fields).toHaveLength(5);
    expect(c.fields[0]).toBe(sample.owner);            // owner (bytes)
    expect(c.fields[1]).toBe(sample.entitlement);      // int
    expect(c.fields[2]).toBe(sample.redeemed);         // int
    expect(c.fields[3]).toBe(sample.start_epoch);      // int
    expect(c.fields[4]).toBe(sample.drops_per_epoch);  // int
  });

  it("normalizes 0x-prefixed + uppercase owner hex", () => {
    const d: ClaimAccountDatum = { ...sample, owner: "0xAABB" };
    const c = asConstr(claimAccountDatumToCbor(d));
    expect(c.fields[0]).toBe("aabb");
  });

  it("rejects wrong field count / wrong constr", () => {
    expect(() => decodeClaimAccountDatum(new Constr(0, [1n, 2n]))).toThrow();
    expect(() => decodeClaimAccountDatum(new Constr(1, ["aa", 1n, 2n, 3n, 4n]))).toThrow();
  });
});

describe("ClaimAccountRedeemer (Capped Drop)", () => {
  it("Claim = Constr(0, [int])", () => {
    expect(CLAIM_ACCOUNT_REDEEMER.Claim).toBe(0);
    const c = asConstr(claimRedeemerToCbor(123_000_000n));
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([123_000_000n]);
    const e = encodeClaimRedeemer(123_000_000n);
    expect(e.index).toBe(0);
    expect(e.fields).toEqual([123_000_000n]);
  });

  it("Redeem = Constr(1, []) — tất định, không field", () => {
    expect(CLAIM_ACCOUNT_REDEEMER.Redeem).toBe(1);
    const c = asConstr(redeemRedeemerToCbor());
    expect(c.index).toBe(1);
    expect(c.fields).toEqual([]);
    const e = encodeRedeemRedeemer();
    expect(e.index).toBe(1);
    expect(e.fields).toEqual([]);
  });
});

describe("BeaconKind (DropParam only)", () => {
  it("DropParam=0", () => {
    expect(BEACON_KIND_INDEX).toEqual({ DropParam: 0 });
  });

  it("round-trips DropParam + verifies index", () => {
    const enc = encodeBeaconKind("DropParam");
    expect(enc.index).toBe(0);
    expect(enc.fields).toEqual([]);
    expect(decodeBeaconKind(enc)).toBe("DropParam");
  });

  it("rejects kind with fields / unknown index", () => {
    expect(() => decodeBeaconKind(new Constr(0, ["aa"]))).toThrow();
    expect(() => decodeBeaconKind(new Constr(9, []))).toThrow();
  });
});

describe("BeaconDatum (DropParam{D})", () => {
  const samples: BeaconDatum[] = [
    { epoch: 10n, kind: "DropParam", drop_value: 100_000_000n },
    { epoch: 11n, kind: "DropParam", drop_value: 1n },
  ];

  it("round-trips via CBOR", () => {
    for (const s of samples) {
      expect(beaconDatumFromCbor(beaconDatumToCbor(s))).toEqual(s);
    }
  });

  it("Constr(0, [int, BeaconKind, int]) declared order", () => {
    const s = samples[0]!;
    const c = asConstr(beaconDatumToCbor(s));
    expect(c.index).toBe(0);
    expect(c.fields).toHaveLength(3);
    expect(c.fields[0]).toBe(10n);                          // epoch
    expect(c.fields[1]).toBeInstanceOf(Constr);
    expect((c.fields[1] as Constr<Data>).index).toBe(0);   // kind = DropParam
    expect(c.fields[2]).toBe(100_000_000n);                // drop_value (int)
  });

  it("decode object form matches", () => {
    const s = samples[1]!;
    expect(decodeBeaconDatum(encodeBeaconDatum(s))).toEqual(s);
  });
});

describe("TreasuryDatum", () => {
  const sample: TreasuryDatum = {
    committee_hash: "deadbeef".repeat(4),
    outstanding_entitlement: 123_456_789n,
  };

  it("round-trips via CBOR", () => {
    expect(treasuryDatumFromCbor(treasuryDatumToCbor(sample))).toEqual(sample);
  });

  it("Constr(0, [bytes, int]) — outstanding_entitlement ở CUỐI", () => {
    const c = asConstr(treasuryDatumToCbor(sample));
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([sample.committee_hash, sample.outstanding_entitlement]);
  });

  it("decode object form matches", () => {
    expect(decodeTreasuryDatum(encodeTreasuryDatum(sample))).toEqual(sample);
  });
});

describe("unit redeemers (no fields)", () => {
  it("BeaconRedeemer PostBeacon = Constr(0, [])", () => {
    const c = encodeBeaconRedeemer();
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([]);
  });

  it("TreasuryRedeemer ReleaseForRedeem = Constr(0, [])", () => {
    const c = encodeTreasuryRedeemer();
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([]);
  });

  it("TreasuryRedeemer GrantEntitlement = Constr(1, [])", () => {
    const c = encodeGrantEntitlementRedeemer();
    expect(c.index).toBe(1);
    expect(c.fields).toEqual([]);
  });
});
