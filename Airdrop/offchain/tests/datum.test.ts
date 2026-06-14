// Datum/redeemer codec round-trip — đối chiếu Constr index onchain ledger.ak.

import { describe, it, expect } from "vitest";
import { Data, credentialToAddress, keyHashToCredential, scriptHashToCredential } from "@lucid-evolution/lucid";
import {
  airdropPoolToCbor, airdropPoolFromCbor,
  encodeProofStep, decodeProofStep,
  claimRedeemerToCbor, sweepRedeemerToCbor,
  mintPoolRedeemerToCbor, mintClaimRedeemerToCbor,
  addressDataToHash,
} from "../src/datum.js";
import { addressToPlutusData } from "../src/merkle.js";
import type { AirdropPool, ProofStep, SnapshotEntry } from "../src/types.js";

const TREASURY = credentialToAddress("Preview", scriptHashToCredential("77".repeat(28)));
const MARKER = credentialToAddress("Preview", scriptHashToCredential("5a".repeat(28)));
const CLAIMER = credentialToAddress("Preview", keyHashToCredential("c1".repeat(28)));

describe("AirdropPool datum codec", () => {
  const pool: AirdropPool = {
    merkle_root: "ab".repeat(32),
    deadline_epoch: 860n,
    treasury_dest: TREASURY,
    marker_dest: MARKER,
    claimed_count: 0n,
  };

  it("round-trips merkle_root/deadline/count", () => {
    const back = airdropPoolFromCbor(airdropPoolToCbor(pool));
    expect(back.merkle_root).toBe(pool.merkle_root);
    expect(back.deadline_epoch).toBe(860n);
    expect(back.claimed_count).toBe(0n);
  });

  it("treasury_dest + marker_dest decode về đúng script hash", () => {
    const back = airdropPoolFromCbor(airdropPoolToCbor(pool));
    expect(back.treasury_dest.payment.isScript).toBe(true);
    expect(back.treasury_dest.payment.hash).toBe("77".repeat(28));
    expect(back.marker_dest.payment.hash).toBe("5a".repeat(28));
  });

  it("encode là Constr(0, [bytes,int,Address,Address,int])", () => {
    const d = Data.from(airdropPoolToCbor(pool)) as any;
    expect(d.index).toBe(0);
    expect(d.fields.length).toBe(5);
    expect(typeof d.fields[0]).toBe("string"); // merkle_root bytes
    expect(typeof d.fields[1]).toBe("bigint"); // deadline
    expect(typeof d.fields[4]).toBe("bigint"); // count
  });

  it("từ chối sai field count", () => {
    // Constr(0,[1]) = d8799f01ff → 1 field → reject.
    expect(() => airdropPoolFromCbor("d8799f01ff")).toThrow(/5 field/);
  });
});

describe("ProofStep codec (Bool: False=Constr0, True=Constr1)", () => {
  it("round-trips is_left true/false", () => {
    const s1: ProofStep = { is_left: true, hash: "11".repeat(32) };
    const s2: ProofStep = { is_left: false, hash: "22".repeat(32) };
    expect(decodeProofStep(encodeProofStep(s1))).toEqual(s1);
    expect(decodeProofStep(encodeProofStep(s2))).toEqual(s2);
  });

  it("is_left=false mã hoá Bool Constr 0 ; true → Constr 1", () => {
    const sFalse = encodeProofStep({ is_left: false, hash: "00".repeat(32) }) as any;
    const sTrue = encodeProofStep({ is_left: true, hash: "00".repeat(32) }) as any;
    expect((sFalse.fields[0] as any).index).toBe(0);
    expect((sTrue.fields[0] as any).index).toBe(1);
  });
});

describe("AirdropRedeemer Claim/Sweep", () => {
  const entry: SnapshotEntry = { address: CLAIMER, amount: 1_000_000n };
  const proof: ProofStep[] = [{ is_left: false, hash: "ab".repeat(32) }];

  it("Claim = Constr(0,[Address,int,[ProofStep]])", () => {
    const d = Data.from(claimRedeemerToCbor(entry, proof)) as any;
    expect(d.index).toBe(0);
    expect(d.fields.length).toBe(3);
    // field 0 = Address Constr; field 1 = amount int; field 2 = proof list.
    expect(typeof d.fields[1]).toBe("bigint");
    expect(d.fields[1]).toBe(1_000_000n);
    expect(Array.isArray(d.fields[2])).toBe(true);
    // claimer address decode về đúng key hash.
    const addr = addressDataToHash(d.fields[0]);
    expect(addr.payment.hash).toBe("c1".repeat(28));
    expect(addr.payment.isScript).toBe(false);
  });

  it("Sweep = Constr(1,[]) = d87a80", () => {
    expect(sweepRedeemerToCbor()).toBe("d87a80");
  });
});

describe("AirdropNftRedeemer", () => {
  it("MintPool=Constr0 (d87980), MintClaim=Constr1 (d87a80)", () => {
    expect(mintPoolRedeemerToCbor()).toBe("d87980");
    expect(mintClaimRedeemerToCbor()).toBe("d87a80");
  });
});

describe("Address Data ⇄ hash đối xứng", () => {
  it("key address: payment key hash + no stake", () => {
    const back = addressDataToHash(addressToPlutusData(CLAIMER));
    expect(back.payment.hash).toBe("c1".repeat(28));
    expect(back.stake).toBeUndefined();
  });

  it("script address giữ isScript=true", () => {
    const back = addressDataToHash(addressToPlutusData(TREASURY));
    expect(back.payment.isScript).toBe(true);
  });

  it("address có stake → decode cả stake credential", () => {
    const withStake = credentialToAddress(
      "Preview",
      keyHashToCredential("c1".repeat(28)),
      keyHashToCredential("e5".repeat(28)),
    );
    const back = addressDataToHash(addressToPlutusData(withStake));
    expect(back.stake?.hash).toBe("e5".repeat(28));
  });
});
