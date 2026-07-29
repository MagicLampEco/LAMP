// buildAccountGenesisTx — genesis account committee-gated (C-ACC).
// Mock tx-builder chain: assert mint 1 NFT name=accountNftName(owner‖channel),
// output claim_account datum redeemed==0, committee signers, validation errors.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit,
} from "@lucid-evolution/lucid";
import type { MintingPolicy, Validator } from "@lucid-evolution/lucid";

import { buildAccountGenesisTx } from "../offchain/src/accountGenesisBuilder.js";
import { accountNftRedeemerToCbor } from "../offchain/src/datum.js";
import { accountNftName } from "../offchain/src/accountNft.js";
import { lampOil, CHANNEL_TEAM } from "./helpers.js";

interface Recorded {
  mint:    { assets: Record<string, bigint>; redeemer: string }[];
  attachMint: MintingPolicy[];
  payData: { address: string; datum: string; assets: Record<string, bigint> }[];
  signers: string[];
}
function mockLucid(): { lucid: any; rec: Recorded } {
  const rec: Recorded = { mint: [], attachMint: [], payData: [], signers: [] };
  const txb: any = {
    mintAssets(assets: Record<string, bigint>, redeemer: string) { rec.mint.push({ assets, redeemer }); return txb; },
    attach: { MintingPolicy(v: MintingPolicy) { rec.attachMint.push(v); return txb; } },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Record<string, bigint>) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
    },
    addSignerKey(k: string) { rec.signers.push(k); return txb; },
    async complete() { return { __mockTx: true }; },
  };
  return { lucid: { newTx() { return txb; } }, rec };
}

const FAKE_CLAIM: Validator = { type: "PlutusV3", script: "49480100002221200101" };
const FAKE_NFT_POLICY: MintingPolicy = { type: "PlutusV3", script: "49480100002221200104" };
const NETWORK = "Preview" as const;
const OWNER = "aabbccddeeff00112233445566778899aabbccddeeff001122334455";
const NFT_POLICY = "cd".repeat(28);
const COMMITTEE = ["11".repeat(28), "22".repeat(28), "33".repeat(28)];
const D = lampOil(100n);

function scriptAddr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

function baseParams(over: Record<string, unknown> = {}) {
  return {
    lucid: undefined as any,
    network: NETWORK,
    owner: OWNER,
    channelId: CHANNEL_TEAM,
    entitlement: lampOil(1000n),
    startEpoch: 5n,
    dropsPerEpoch: D,
    accountNftPolicy: FAKE_NFT_POLICY,
    accountNftPolicyId: NFT_POLICY,
    claimAccountScript: FAKE_CLAIM,
    committeeKeyHashes: COMMITTEE,
    threshold: 2,
    ...over,
  };
}

describe("buildAccountGenesisTx — genesis account committee-gated", () => {
  it("mint 1 NFT name=blake2b(owner‖channel), output claim_account redeemed==0, committee signers", async () => {
    const { lucid, rec } = mockLucid();
    await buildAccountGenesisTx({ ...baseParams(), lucid });

    const name = accountNftName(OWNER, CHANNEL_TEAM);
    const unit = toUnit(NFT_POLICY, name);

    // đúng 1 NFT mint, redeemer MintAccount
    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets).toEqual({ [unit]: 1n });
    expect(rec.mint[0]!.redeemer).toBe(accountNftRedeemerToCbor());

    // output ra claim_account script, mang NFT
    const out = rec.payData.find(p => p.address === scriptAddr(FAKE_CLAIM))!;
    expect(out).toBeTruthy();
    expect(out.assets[unit]).toBe(1n);

    // ≥ threshold committee signers khai báo
    expect(rec.signers.length).toBeGreaterThanOrEqual(2);
    for (const s of rec.signers) expect(COMMITTEE).toContain(s);
  });

  it("rejects dropsPerEpoch ≤ 0", async () => {
    const { lucid } = mockLucid();
    await expect(buildAccountGenesisTx({ ...baseParams({ dropsPerEpoch: 0n }), lucid }))
      .rejects.toThrow();
  });

  it("rejects below-threshold signers", async () => {
    const { lucid } = mockLucid();
    await expect(buildAccountGenesisTx({ ...baseParams({ signerKeyHashes: [COMMITTEE[0]] }), lucid }))
      .rejects.toThrow();
  });
});
