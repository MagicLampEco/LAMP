// deploy/redeemer codec — đối chiếu SETUP one-shot + BurnSlot với onchain.

import { describe, it, expect } from "vitest";
import { mintPoolRedeemerToCbor, burnSlotRedeemerToCbor } from "../src/datum.js";
import { SETUP_AUTHORITY_NAME } from "../src/deployBuilder.js";
import { POOL_NFT_NAME } from "../src/constants.js";

describe("SETUP authority + asset name parity (byte-perfect onchain)", () => {
  it('SETUP_AUTHORITY_NAME = hex("ASETUP") = 415345545550', () => {
    expect(SETUP_AUTHORITY_NAME).toBe("415345545550");
    expect(Buffer.from("ASETUP", "ascii").toString("hex")).toBe(SETUP_AUTHORITY_NAME);
  });

  it('POOL_NFT_NAME = hex("APOOL") = 41504f4f4c', () => {
    expect(POOL_NFT_NAME).toBe("41504f4f4c");
    expect(Buffer.from("APOOL", "ascii").toString("hex")).toBe(POOL_NFT_NAME);
  });

  it("3 asset name (POOL / SETUP / leaf) phân biệt → không đụng namespace", () => {
    // leaf = blake2b 32 byte (64 hex) → không trùng POOL (10 hex) / SETUP (12 hex).
    expect(POOL_NFT_NAME).not.toBe(SETUP_AUTHORITY_NAME);
    expect(POOL_NFT_NAME.length).toBe(10);
    expect(SETUP_AUTHORITY_NAME.length).toBe(12);
  });
});

describe("AirdropNftRedeemer SETUP/BurnSlot codec (GIỮ Constr index)", () => {
  it("MintPool (SETUP one-shot) = Constr0 = d87980", () => {
    expect(mintPoolRedeemerToCbor()).toBe("d87980");
  });

  it("BurnSlot (Claim/Sweep) = Constr1 = d87a80 — index khớp MintClaim cũ", () => {
    expect(burnSlotRedeemerToCbor()).toBe("d87a80");
  });
});
