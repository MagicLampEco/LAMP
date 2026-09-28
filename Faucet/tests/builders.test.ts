// Faucet v3 builder logic — buildClaimOpenTx (claimBuilder.ts) + buildMintPoolTx
// (mintBuilder.ts). Mock tx-builder chain ghi lại call → assert datum/value/validity-range.
// KHÔNG submit thật.
//
// v1 (`buildClaimTx` không-DID, validator `faucet.ak`) đã XOÁ khỏi tệp này cùng lúc on-chain
// xoá validator — không còn gì để test (không có analog on-chain).

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator, MintingPolicy } from "@lucid-evolution/lucid";

import { buildClaimOpenTx } from "../offchain/src/claimBuilder.js";
import { buildMintPoolTx } from "../offchain/src/mintBuilder.js";
import { poolDatumToCbor, poolDatumFromCbor } from "../offchain/src/datum.js";
import {
  DRIP_OILDROP, COOLDOWN, MAX_CLAIMS_CEILING, TLAMP_ASSET_NAME, POOL_NFT_NAME, ACCT_NFT_NAME,
  acctName, lampToOildrop,
} from "../offchain/src/constants.js";
import { epochAt } from "../offchain/src/epochWindow.js";

// ── Mock Lucid tx-builder ──────────────────────────────────────────────
interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer?: string | undefined }[];
  mint:        { assets: Record<string, bigint>; redeemer: string }[];
  attachMint:  MintingPolicy[];
  attachSpend: Validator[];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  validFrom?:  number;
  validTo?:    number;
}

function mockLucid(): { lucid: any; rec: Recorded } {
  const rec: Recorded = {
    collectFrom: [], mint: [], attachMint: [], attachSpend: [], payData: [],
  };
  const txb: any = {
    collectFrom(utxos: UTxO[], redeemer?: string) { rec.collectFrom.push({ utxos, redeemer }); return txb; },
    mintAssets(assets: Record<string, bigint>, redeemer: string) { rec.mint.push({ assets, redeemer }); return txb; },
    attach: {
      MintingPolicy(p: MintingPolicy) { rec.attachMint.push(p); return txb; },
      SpendingValidator(v: Validator) { rec.attachSpend.push(v); return txb; },
    },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Record<string, bigint>) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
    },
    validFrom(ms: number) { rec.validFrom = ms; return txb; },
    validTo(ms: number) { rec.validTo = ms; return txb; },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = { newTx() { return txb; }, wallet() { return { address: async () => "addr_wallet" }; } };
  return { lucid, rec };
}

const NETWORK = "Preview" as const;
const MS_PER_EPOCH = 86_400_000n; // Preview

const POOL_SCRIPT: Validator = { type: "PlutusV3", script: "49480100002221200101" };
const ACCT_SCRIPT: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const NFT_POLICY: MintingPolicy = { type: "PlutusV3", script: "49480100002221200199" };
const TLAMP_POLICY_SCRIPT: MintingPolicy = { type: "PlutusV3", script: "49480100002221200198" };

const TLAMP_POLICY = "aa".repeat(28);
const NFT_POLICY_ID = "bb".repeat(28);
const DID_POLICY_ID = "cc".repeat(28);
const DID_NAME = "a11ce0";

const TLAMP_UNIT = toUnit(TLAMP_POLICY, TLAMP_ASSET_NAME);
const DID_UNIT = toUnit(DID_POLICY_ID, DID_NAME);
const POOL_NFT_UNIT = toUnit(NFT_POLICY_ID, POOL_NFT_NAME);
const ACCT_NFT_UNIT = toUnit(NFT_POLICY_ID, acctName(DID_NAME));

function addr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

const CFG = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, max_claims_per_window: 20n };

const NOW_MS = 100 * Number(MS_PER_EPOCH) + 12_345; // giữa bucket 100, dư thừa TTL

function poolUtxo(tlampOildrop: bigint, windowEpoch: bigint, claimsInWindow: bigint): UTxO {
  return {
    txHash: "cd".repeat(32), outputIndex: 0, address: addr(POOL_SCRIPT),
    assets: { lovelace: 10_000_000n, [POOL_NFT_UNIT]: 1n, [TLAMP_UNIT]: tlampOildrop },
    datum: poolDatumToCbor({ cfg: CFG, window_epoch: windowEpoch, claims_in_window: claimsInWindow }),
  };
}

function didUtxo(): UTxO {
  return {
    txHash: "de".repeat(32), outputIndex: 0, address: "addr_user",
    assets: { lovelace: 2_000_000n, [DID_UNIT]: 1n },
  };
}

// ── buildClaimOpenTx ─────────────────────────────────────────────────────
describe("buildClaimOpenTx — mở account mới, DID-gated, pinned validity range", () => {
  it("drips drip_oildrop, mints ACCT NFT neo DID, pool -drip + cửa sổ tiến 1 bước", async () => {
    const { lucid, rec } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    const POOL_BEFORE = lampToOildrop(1_000_000n);
    const res = await buildClaimOpenTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(POOL_BEFORE, epoch, 3n), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    });
    expect(res.drip).toBe(DRIP_OILDROP);
    expect(res.poolAfter).toBe(POOL_BEFORE - DRIP_OILDROP);
    expect(res.epoch).toBe(epoch);

    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets[ACCT_NFT_UNIT]).toBe(1n);
    // account mới: cả hai mốc = now.
    expect(res.accountDatum.last_claim_epoch).toBe(epoch);
    expect(res.accountDatum.last_touch_epoch).toBe(epoch);

    const poolOut = rec.payData.find((p) => p.address === addr(POOL_SCRIPT))!;
    expect(poolOut.assets[TLAMP_UNIT]).toBe(POOL_BEFORE - DRIP_OILDROP);
    expect(poolOut.assets[POOL_NFT_UNIT]).toBe(1n);

    const acctOut = rec.payData.find((p) => p.address === addr(ACCT_SCRIPT))!;
    expect(acctOut.assets[ACCT_NFT_UNIT]).toBe(1n);
    expect(acctOut.assets[TLAMP_UNIT]).toBe(DRIP_OILDROP);

    // validity range: pinned (cả hai cận, cùng bucket).
    expect(rec.validFrom).toBe(NOW_MS);
    expect(Math.floor(rec.validFrom! / Number(MS_PER_EPOCH))).toBe(Math.floor(rec.validTo! / Number(MS_PER_EPOCH)));

    // bảo toàn cung.
    expect(poolOut.assets[TLAMP_UNIT]! + acctOut.assets[TLAMP_UNIT]!).toBe(POOL_BEFORE);
  });

  it("cửa sổ SANG bucket mới → claims_in_window reset về 1, không cộng dồn số cũ", async () => {
    const { lucid, rec } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    await buildClaimOpenTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(lampToOildrop(1_000_000n), epoch - 1n, 20n), // cửa sổ TRƯỚC đã đầy
      faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    });
    const poolOut = rec.payData.find((p) => p.address === addr(POOL_SCRIPT))!;
    const pdOut = poolDatumFromCbor(poolOut.datum);
    expect(pdOut.window_epoch).toBe(epoch);
    expect(pdOut.claims_in_window).toBe(1n);   // reset, KHÔNG phải 21n
  });

  it("rejects khi didUtxo thiếu DID NFT", async () => {
    const { lucid } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    const badDid: UTxO = { ...didUtxo(), assets: { lovelace: 2_000_000n } };
    await expect(buildClaimOpenTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(lampToOildrop(1_000_000n), epoch, 0n), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: badDid, didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/CLAIM-OPEN-003/);
  });

  it("rejects khi pool cạn dưới drip", async () => {
    const { lucid } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    await expect(buildClaimOpenTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(DRIP_OILDROP - 1n, epoch, 0n), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/CLAIM-OPEN-004/);
  });

  it("rejects khi hết quota cửa sổ (đã dùng == max_claims_per_window)", async () => {
    const { lucid } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    await expect(buildClaimOpenTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(lampToOildrop(1_000_000n), epoch, CFG.max_claims_per_window),
      faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/CLAIM-OPEN-006/);
  });

  it("rejects khi msPerEpoch không khớp mạng (FAUCET-EPOCH-001)", async () => {
    const { lucid } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    await expect(buildClaimOpenTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(lampToOildrop(1_000_000n), epoch, 0n), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: 432_000_000n, // Preprod số trên Preview
    })).rejects.toThrow(/FAUCET-EPOCH-001/);
  });
});

// ── buildMintPoolTx ────────────────────────────────────────────────────
describe("buildMintPoolTx — mint tLAMP + MintPool one-shot, datum khởi tạo pinned", () => {
  function genesisUtxo(): UTxO {
    return { txHash: "ab".repeat(32), outputIndex: 0, address: "addr_deploy", assets: { lovelace: 100_000_000n } };
  }

  it("mints total supply + POOL NFT, seeds pool datum với window_epoch pinned + claims=0", async () => {
    const { lucid, rec } = mockLucid();
    const epoch = epochAt(NOW_MS, Number(MS_PER_EPOCH));
    const res = await buildMintPoolTx({
      lucid, network: NETWORK,
      tlampPolicy: TLAMP_POLICY_SCRIPT, tlampPolicyId: TLAMP_POLICY,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      faucetPoolScript: POOL_SCRIPT, genesisUtxo: genesisUtxo(),
      maxClaimsPerWindow: MAX_CLAIMS_CEILING,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    });
    expect(res.epoch).toBe(epoch);
    expect(res.poolDatum.claims_in_window).toBe(0n);
    expect(res.poolDatum.window_epoch).toBe(epoch);

    expect(rec.collectFrom).toHaveLength(1);
    expect(rec.mint).toHaveLength(2);
    const tlampMint = rec.mint.find((m) => m.assets[TLAMP_UNIT] !== undefined)!;
    expect(tlampMint.assets[TLAMP_UNIT]).toBe(res.totalSupply);
    const poolMint = rec.mint.find((m) => m.assets[POOL_NFT_UNIT] !== undefined)!;
    expect(poolMint.assets[POOL_NFT_UNIT]).toBe(1n);
    expect(rec.attachMint).toContain(TLAMP_POLICY_SCRIPT);
    expect(rec.attachMint).toContain(NFT_POLICY);

    const poolOut = rec.payData[0]!;
    expect(poolOut.address).toBe(addr(POOL_SCRIPT));
    expect(poolOut.assets[POOL_NFT_UNIT]).toBe(1n);
    expect(poolOut.assets[TLAMP_UNIT]).toBe(res.poolInitial);

    expect(rec.validFrom).toBe(NOW_MS);
  });

  it("rejects maxClaimsPerWindow > MAX_CLAIMS_CEILING (C-MP-7)", async () => {
    const { lucid } = mockLucid();
    await expect(buildMintPoolTx({
      lucid, network: NETWORK,
      tlampPolicy: TLAMP_POLICY_SCRIPT, tlampPolicyId: TLAMP_POLICY,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      faucetPoolScript: POOL_SCRIPT, genesisUtxo: genesisUtxo(),
      maxClaimsPerWindow: MAX_CLAIMS_CEILING + 1n,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/MINT-POOL-006/);
  });

  it("rejects poolInitialTlampOildrop > totalSupplyOildrop", async () => {
    const { lucid } = mockLucid();
    await expect(buildMintPoolTx({
      lucid, network: NETWORK,
      tlampPolicy: TLAMP_POLICY_SCRIPT, tlampPolicyId: TLAMP_POLICY,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      faucetPoolScript: POOL_SCRIPT, genesisUtxo: genesisUtxo(),
      totalSupplyOildrop: 100n, poolInitialTlampOildrop: 200n,
      maxClaimsPerWindow: MAX_CLAIMS_CEILING,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/MINT-POOL-003/);
  });
});
