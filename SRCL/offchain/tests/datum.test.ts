// SRCL datum/redeemer codec — round-trip + Constr-shape khớp onchain types.ak.

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  srclDatumToCbor, srclDatumFromCbor, decodeSrclDatum,
  encodeMerkleStep, decodeMerkleStep,
  encodeClaimProof, decodeClaimProof,
  setRootRedeemerToCbor, claimRedeemerToCbor, sweepRedeemerToCbor,
  mintPoolRedeemerToCbor, mintSlotsRedeemerToCbor, burnSlotRedeemerToCbor,
} from "../src/datum.js";
import { END_EPOCH, MS_PER_EPOCH_MAINNET } from "../src/constants.js";
import type { SrclDatum, ClaimProof, MerkleStep } from "../src/types.js";

const sampleDatum: SrclDatum = {
  epoch_roots: ["aa", "bb"],
  distributed_total: 10_000_000_000_000n,
  end_epoch: END_EPOCH,
  treasury_dest: "7a7a7a7a",
  ms_per_epoch: MS_PER_EPOCH_MAINNET,
};

describe("SrclDatum codec", () => {
  it("round-trips", () => {
    expect(srclDatumFromCbor(srclDatumToCbor(sampleDatum))).toEqual(sampleDatum);
  });

  it("encodes as Constr(0, [list, int, int, bytes, int])", () => {
    const back = decodeSrclDatum(Data.from(srclDatumToCbor(sampleDatum)));
    expect(back.epoch_roots).toEqual(["aa", "bb"]);
    expect(back.distributed_total).toBe(10_000_000_000_000n);
    expect(back.end_epoch).toBe(35n);
  });

  it("epoch_roots rỗng round-trips", () => {
    const d = { ...sampleDatum, epoch_roots: [] as string[] };
    expect(srclDatumFromCbor(srclDatumToCbor(d))).toEqual(d);
  });

  it("rejects wrong field count", () => {
    // Constr(0, []) → 0 fields → reject (cần 5).
    expect(() => decodeSrclDatum(Data.from("d87980"))).toThrow(/5 field/);
  });
});

describe("MerkleStep codec — bool = Constr0/Constr1", () => {
  it("left=true → bool Constr(1,[])", () => {
    const s: MerkleStep = { hash: "ab", left: true };
    const enc = encodeMerkleStep(s);
    expect(enc.fields[1]).toEqual(new Constr(1, []));
    expect(decodeMerkleStep(enc)).toEqual(s);
  });
  it("left=false → bool Constr(0,[])", () => {
    const s: MerkleStep = { hash: "cd", left: false };
    const enc = encodeMerkleStep(s);
    expect(enc.fields[1]).toEqual(new Constr(0, []));
    expect(decodeMerkleStep(enc)).toEqual(s);
  });
});

describe("ClaimProof codec", () => {
  it("round-trips với proof nhiều bước", () => {
    const p: ClaimProof = {
      epoch: 3n,
      owner: "0a0a",
      amount: 1000n,
      proof: [
        { hash: "de", left: false },
        { hash: "ad", left: true },
      ],
    };
    expect(decodeClaimProof(encodeClaimProof(p))).toEqual(p);
  });
  it("proof rỗng round-trips", () => {
    const p: ClaimProof = { epoch: 0n, owner: "0b0b", amount: 1n, proof: [] };
    expect(decodeClaimProof(encodeClaimProof(p))).toEqual(p);
  });
});

describe("redeemers — Constr index khớp onchain", () => {
  it("SetRoot = Constr(0, [root])", () => {
    const cbor = setRootRedeemerToCbor("aa");
    const d = Data.from(cbor) as Constr<Data>;
    expect(d.index).toBe(0);
    expect(d.fields).toEqual(["aa"]);
  });
  it("Claim = Constr(1, [ClaimProof])", () => {
    const p: ClaimProof = { epoch: 0n, owner: "0a0a", amount: 1000n, proof: [] };
    const d = Data.from(claimRedeemerToCbor(p)) as Constr<Data>;
    expect(d.index).toBe(1);
  });
  it("Sweep = Constr(2, []) = d87b80", () => {
    expect(sweepRedeemerToCbor()).toBe("d87b80");
  });
  it("MintPool = Constr(0, []) = d87980", () => {
    expect(mintPoolRedeemerToCbor()).toBe("d87980");
  });
  it("MintSlots = Constr(1, []) = d87a80", () => {
    expect(mintSlotsRedeemerToCbor()).toBe("d87a80");
  });
  it("BurnSlot = Constr(2, []) = d87b80", () => {
    expect(burnSlotRedeemerToCbor()).toBe("d87b80");
  });
});
