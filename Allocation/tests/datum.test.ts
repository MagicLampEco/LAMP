// Datum/redeemer codec tests — round-trip + Constr index/field-count byte-perfect.
// Khớp onchain types.ak (Constr index = thứ tự khai báo, từ 0).

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  // ClaimAccount
  encodeClaimAccountDatum, decodeClaimAccountDatum,
  claimAccountDatumToCbor, claimAccountDatumFromCbor,
  encodeClaimRedeemer, encodeRedeemRedeemer,
  claimRedeemerToCbor, redeemRedeemerToCbor,
  CLAIM_ACCOUNT_REDEEMER,
  // ChannelBudget
  encodeChannelBudgetDatum, decodeChannelBudgetDatum,
  channelBudgetDatumToCbor, channelBudgetDatumFromCbor,
  encodeDecrementRedeemer, decrementRedeemerToCbor, CHANNEL_BUDGET_REDEEMER,
  // Treasury
  encodeTreasuryDatum, decodeTreasuryDatum,
  treasuryDatumToCbor, treasuryDatumFromCbor,
  encodeTreasuryRedeemer,
  // BudgetNft
  encodeBudgetNftRedeemer,
} from "../offchain/src/datum.js";
import type {
  ChannelBudgetDatum, ClaimAccountDatum, TreasuryDatum,
} from "../offchain/src/types.js";
import { CHANNEL_TEAM } from "./helpers.js";

/** parse cbor → Constr để soi index/fields đúng thứ tự types.ak. */
function asConstr(cbor: string): Constr<Data> {
  const d = Data.from(cbor);
  if (!(d instanceof Constr)) throw new Error("not a Constr");
  return d;
}

// ── ClaimAccountDatum = Constr(0, [bytes,int,int,int,int,bytes]) ────────
describe("ClaimAccountDatum (channel_id field CUỐI)", () => {
  const sample: ClaimAccountDatum = {
    owner:           "aabbccddeeff00112233445566778899aabbccddeeff001122334455",
    entitlement:     250_000_000n,
    redeemed:        100_000_000n,
    start_epoch:     42n,
    drops_per_epoch: 1n,
    channel_id:      CHANNEL_TEAM,
  };

  it("round-trips encode→decode", () => {
    expect(decodeClaimAccountDatum(encodeClaimAccountDatum(sample))).toEqual(sample);
  });

  it("round-trips via CBOR", () => {
    expect(claimAccountDatumFromCbor(claimAccountDatumToCbor(sample))).toEqual(sample);
  });

  it("Constr index 0 with [bytes,int,int,int,int,bytes] declared order", () => {
    const c = asConstr(claimAccountDatumToCbor(sample));
    expect(c.index).toBe(0);
    expect(c.fields).toHaveLength(6);
    expect(c.fields[0]).toBe(sample.owner);            // owner (bytes)
    expect(c.fields[1]).toBe(sample.entitlement);      // int
    expect(c.fields[2]).toBe(sample.redeemed);         // int
    expect(c.fields[3]).toBe(sample.start_epoch);      // int
    expect(c.fields[4]).toBe(sample.drops_per_epoch);  // int
    expect(c.fields[5]).toBe(sample.channel_id);       // channel_id (bytes) CUỐI
  });

  it("normalizes 0x-prefixed + uppercase owner/channel hex", () => {
    const d: ClaimAccountDatum = { ...sample, owner: "0xAABB", channel_id: "0xCAFE" };
    const c = asConstr(claimAccountDatumToCbor(d));
    expect(c.fields[0]).toBe("aabb");
    expect(c.fields[5]).toBe("cafe");
  });

  it("rejects wrong field count / wrong constr", () => {
    expect(() => decodeClaimAccountDatum(new Constr(0, ["aa", 1n, 2n, 3n, 4n]))).toThrow(); // 5 fields
    expect(() => decodeClaimAccountDatum(new Constr(1, ["aa", 1n, 2n, 3n, 4n, "bb"]))).toThrow();
  });

  it("rejects shape mismatch (int where bytes expected)", () => {
    // channel_id phải bytes, đặt int → reject.
    expect(() => decodeClaimAccountDatum(new Constr(0, ["aa", 1n, 2n, 3n, 4n, 5n]))).toThrow();
  });
});

// ── ClaimAccountRedeemer ────────────────────────────────────────────────
describe("ClaimAccountRedeemer", () => {
  it("Claim{amount} = Constr(0, [int])", () => {
    expect(CLAIM_ACCOUNT_REDEEMER.Claim).toBe(0);
    const c = asConstr(claimRedeemerToCbor(123_000_000n));
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([123_000_000n]);
    expect(encodeClaimRedeemer(7n).index).toBe(0);
  });

  it("Redeem = Constr(1, []) — không field", () => {
    expect(CLAIM_ACCOUNT_REDEEMER.Redeem).toBe(1);
    const c = asConstr(redeemRedeemerToCbor());
    expect(c.index).toBe(1);
    expect(c.fields).toEqual([]);
    expect(encodeRedeemRedeemer().index).toBe(1);
  });
});

// ── ChannelBudgetDatum = Constr(0, [bytes,int]) ─────────────────────────
describe("ChannelBudgetDatum", () => {
  const sample: ChannelBudgetDatum = { channel_id: CHANNEL_TEAM, remaining_oil: 1_000_000_000n };

  it("round-trips via CBOR", () => {
    expect(channelBudgetDatumFromCbor(channelBudgetDatumToCbor(sample))).toEqual(sample);
  });

  it("Constr(0, [bytes,int]) declared order", () => {
    const c = asConstr(channelBudgetDatumToCbor(sample));
    expect(c.index).toBe(0);
    expect(c.fields).toHaveLength(2);
    expect(c.fields[0]).toBe(sample.channel_id);     // channel_id (bytes)
    expect(c.fields[1]).toBe(sample.remaining_oil);  // remaining_oil (int)
  });

  it("decode object form matches", () => {
    expect(decodeChannelBudgetDatum(encodeChannelBudgetDatum(sample))).toEqual(sample);
  });

  it("rejects wrong field count", () => {
    expect(() => decodeChannelBudgetDatum(new Constr(0, [CHANNEL_TEAM]))).toThrow();
    expect(() => decodeChannelBudgetDatum(new Constr(1, [CHANNEL_TEAM, 1n]))).toThrow();
  });
});

// ── ChannelBudgetRedeemer ───────────────────────────────────────────────
describe("ChannelBudgetRedeemer", () => {
  it("Decrement{amount} = Constr(0, [int])", () => {
    expect(CHANNEL_BUDGET_REDEEMER.Decrement).toBe(0);
    const c = asConstr(decrementRedeemerToCbor(300_000_000n));
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([300_000_000n]);
    expect(encodeDecrementRedeemer(1n).index).toBe(0);
  });
});

// ── TreasuryDatum = Constr(0, [bytes,bytes]) ────────────────────────────
describe("TreasuryDatum (committee_hash + channel_id)", () => {
  const sample: TreasuryDatum = { committee_hash: "deadbeef".repeat(4), channel_id: CHANNEL_TEAM };

  it("round-trips via CBOR", () => {
    expect(treasuryDatumFromCbor(treasuryDatumToCbor(sample))).toEqual(sample);
  });

  it("Constr(0, [bytes,bytes]) declared order", () => {
    const c = asConstr(treasuryDatumToCbor(sample));
    expect(c.index).toBe(0);
    expect(c.fields).toHaveLength(2);
    expect(c.fields[0]).toBe(sample.committee_hash);  // committee_hash (bytes)
    expect(c.fields[1]).toBe(sample.channel_id);      // channel_id (bytes)
  });

  it("decode object form matches", () => {
    expect(decodeTreasuryDatum(encodeTreasuryDatum(sample))).toEqual(sample);
  });

  it("rejects wrong field count", () => {
    expect(() => decodeTreasuryDatum(new Constr(0, ["aa"]))).toThrow();
  });
});

// ── unit redeemers (no fields) ──────────────────────────────────────────
describe("unit redeemers (Constr(0, []))", () => {
  it("TreasuryRedeemer ReleaseForRedeem = Constr(0, [])", () => {
    const c = encodeTreasuryRedeemer();
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([]);
  });

  it("BudgetNftRedeemer MintGenesis = Constr(0, [])", () => {
    const c = encodeBudgetNftRedeemer();
    expect(c.index).toBe(0);
    expect(c.fields).toEqual([]);
  });
});
