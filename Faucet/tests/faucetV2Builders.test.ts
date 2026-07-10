// Faucet v2 builder logic — mock tx-builder ghi lại call → assert drip/datum/value.
// KHÔNG submit thật. Kiểm: drip đúng 1001, pool −drip, account +drip + datum,
// DID NFT collect, reclaim trả token về pool.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator, MintingPolicy } from "@lucid-evolution/lucid";

import { buildClaimDidTx } from "../offchain/src/claimDidBuilder.js";
import { buildUseTx } from "../offchain/src/useBuilder.js";
import { buildReclaimTx } from "../offchain/src/reclaimBuilder.js";
import {
  faucetConfigToCbor, faucetAccountToCbor,
  poolClaimRedeemerToCbor, mintAccountRedeemerToCbor,
  accountReclaimIdleRedeemerToCbor, poolReclaimRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  DRIP_OIL, COOLDOWN, RECLAIM, TLAMP_ASSET_NAME, ACCT_NFT_NAME,
} from "../offchain/src/constants.js";

interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer?: string | undefined }[];
  mint: { assets: Record<string, bigint>; redeemer: string }[];
  attachMint: MintingPolicy[];
  attachSpend: Validator[];
  payData: { address: string; datum: string; assets: Record<string, bigint> }[];
}

function mockLucid(walletAddress: string): { lucid: any; rec: Recorded } {
  const rec: Recorded = { collectFrom: [], mint: [], attachMint: [], attachSpend: [], payData: [] };
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
    validFrom() { return txb; },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = { newTx() { return txb; }, wallet() { return { address: async () => walletAddress }; } };
  return { lucid, rec };
}

const NETWORK = "Preview" as const;
const POOL_SCRIPT: Validator = { type: "PlutusV3", script: "49480100002221200101" };
const ACCT_SCRIPT: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const NFT_POLICY: MintingPolicy = { type: "PlutusV3", script: "49480100002221200199" };

const TLAMP_POLICY = "aa".repeat(28);
const NFT_POLICY_ID = "bb".repeat(28);
const DID_POLICY_ID = "cc".repeat(28);
const DID_NAME = "a11ce0";

const TLAMP_UNIT = toUnit(TLAMP_POLICY, TLAMP_ASSET_NAME);
const ACCT_NFT_UNIT = toUnit(NFT_POLICY_ID, ACCT_NFT_NAME);
const DID_UNIT = toUnit(DID_POLICY_ID, DID_NAME);
const POOL_NFT_UNIT = toUnit(NFT_POLICY_ID, "504f4f4c");

function addr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

const CFG = { drip_oil: DRIP_OIL, cooldown_epochs: COOLDOWN, reclaim_epochs: RECLAIM };

function poolUtxo(tlampOil: bigint): UTxO {
  return {
    txHash: "cd".repeat(32), outputIndex: 0, address: addr(POOL_SCRIPT),
    assets: { lovelace: 10_000_000n, [POOL_NFT_UNIT]: 1n, [TLAMP_UNIT]: tlampOil },
    datum: faucetConfigToCbor(CFG),
  };
}

function didUtxo(): UTxO {
  return {
    txHash: "de".repeat(32), outputIndex: 0, address: "addr_user",
    assets: { lovelace: 2_000_000n, [DID_UNIT]: 1n },
  };
}

function accountUtxo(tlampOil: bigint, lastEpoch: bigint): UTxO {
  return {
    txHash: "ef".repeat(32), outputIndex: 0, address: addr(ACCT_SCRIPT),
    assets: { lovelace: 2_000_000n, [ACCT_NFT_UNIT]: 1n, [TLAMP_UNIT]: tlampOil },
    datum: faucetAccountToCbor({ did_name: DID_NAME, last_epoch: lastEpoch }),
  };
}

// ── CLAIM ──────────────────────────────────────────────────────────────
describe("buildClaimDidTx — DID-gated drip 1001", () => {
  it("drips exactly DRIP_OIL, pool −drip, account +drip + datum{now}, mints ACCT, collects DID", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const POOL_BEFORE = 5_000_000_000n;
    const res = await buildClaimDidTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(POOL_BEFORE), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY,
      currentEpoch: 100n,
    });
    expect(res.drip).toBe(DRIP_OIL);
    expect(res.poolAfter).toBe(POOL_BEFORE - DRIP_OIL);

    // pool spent (Claim) + DID collected; ACCT minted.
    expect(rec.collectFrom.some((c) => c.redeemer === poolClaimRedeemerToCbor())).toBe(true);
    expect(rec.collectFrom.some((c) => c.utxos[0]!.assets[DID_UNIT] === 1n)).toBe(true);
    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets[ACCT_NFT_UNIT]).toBe(1n);
    expect(rec.mint[0]!.redeemer).toBe(mintAccountRedeemerToCbor());

    // pool output: tLAMP −drip, POOL NFT + ADA + config preserved.
    const poolOut = rec.payData.find((p) => p.address === addr(POOL_SCRIPT))!;
    expect(poolOut.assets[TLAMP_UNIT]).toBe(POOL_BEFORE - DRIP_OIL);
    expect(poolOut.assets[POOL_NFT_UNIT]).toBe(1n);
    expect(poolOut.assets.lovelace).toBe(10_000_000n);
    expect(poolOut.datum).toBe(faucetConfigToCbor(CFG));

    // account output: ACCT NFT + exactly drip tLAMP + datum{did_name, last_epoch=now}.
    const acctOut = rec.payData.find((p) => p.address === addr(ACCT_SCRIPT))!;
    expect(acctOut.assets[ACCT_NFT_UNIT]).toBe(1n);
    expect(acctOut.assets[TLAMP_UNIT]).toBe(DRIP_OIL);
    expect(acctOut.datum).toBe(faucetAccountToCbor({ did_name: DID_NAME, last_epoch: 100n }));

    // bảo toàn cung: poolOut tLAMP + acctOut tLAMP == pool_in.
    expect(poolOut.assets[TLAMP_UNIT]! + acctOut.assets[TLAMP_UNIT]!).toBe(POOL_BEFORE);
  });

  it("rejects when didUtxo missing DID NFT", async () => {
    const { lucid } = mockLucid("addr_user");
    const badDid: UTxO = { ...didUtxo(), assets: { lovelace: 2_000_000n } };
    await expect(buildClaimDidTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(5_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: badDid, didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, currentEpoch: 100n,
    })).rejects.toThrow(/không chứa DID NFT/);
  });

  it("rejects when pool drained below drip", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildClaimDidTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(DRIP_OIL - 1n), faucetPoolScript: POOL_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, currentEpoch: 100n,
    })).rejects.toThrow(/Pool cạn/);
  });
});

// ── USE ────────────────────────────────────────────────────────────────
describe("buildUseTx — gia hạn last_epoch", () => {
  it("updates last_epoch, keeps ACCT NFT + did_name, allows withdraw", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const res = await buildUseTx({
      lucid, network: NETWORK,
      accountUtxo: accountUtxo(DRIP_OIL, 100n), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicyId: NFT_POLICY_ID,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, currentEpoch: 200n,
      withdrawOil: 1_000_000n,
    });
    expect(res.newAccountDatum.last_epoch).toBe(200n);
    expect(res.accountLampAfter).toBe(DRIP_OIL - 1_000_000n);
    const acctOut = rec.payData.find((p) => p.address === addr(ACCT_SCRIPT))!;
    expect(acctOut.assets[ACCT_NFT_UNIT]).toBe(1n);
    expect(acctOut.assets[TLAMP_UNIT]).toBe(DRIP_OIL - 1_000_000n);
    expect(acctOut.datum).toBe(faucetAccountToCbor({ did_name: DID_NAME, last_epoch: 200n }));
  });

  it("rejects withdraw > account balance", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildUseTx({
      lucid, network: NETWORK,
      accountUtxo: accountUtxo(DRIP_OIL, 100n), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicyId: NFT_POLICY_ID,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, currentEpoch: 200n,
      withdrawOil: DRIP_OIL + 1n,
    })).rejects.toThrow(/> account tLAMP/);
  });
});

// ── RECLAIM ─────────────────────────────────────────────────────────────
describe("buildReclaimTx — thu hồi idle về pool", () => {
  it("returns all account tLAMP to pool, spends both with right redeemers", async () => {
    const { lucid, rec } = mockLucid("addr_keeper");
    const POOL_BEFORE = 3_000_000_000n;
    // last_epoch=100, reclaim=1001 → idle đủ ở epoch 1101.
    const res = await buildReclaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(POOL_BEFORE), faucetPoolScript: POOL_SCRIPT,
      accountUtxo: accountUtxo(DRIP_OIL, 100n), faucetAccountScript: ACCT_SCRIPT,
      tlampPolicyId: TLAMP_POLICY, currentEpoch: 1101n,
    });
    expect(res.reclaimed).toBe(DRIP_OIL);
    expect(res.poolAfter).toBe(POOL_BEFORE + DRIP_OIL);

    expect(rec.collectFrom.some((c) => c.redeemer === accountReclaimIdleRedeemerToCbor())).toBe(true);
    expect(rec.collectFrom.some((c) => c.redeemer === poolReclaimRedeemerToCbor())).toBe(true);

    const poolOut = rec.payData.find((p) => p.address === addr(POOL_SCRIPT))!;
    expect(poolOut.assets[TLAMP_UNIT]).toBe(POOL_BEFORE + DRIP_OIL);
    expect(poolOut.assets[POOL_NFT_UNIT]).toBe(1n);
    expect(poolOut.datum).toBe(faucetConfigToCbor(CFG));
  });

  it("rejects when account not idle long enough", async () => {
    const { lucid } = mockLucid("addr_keeper");
    await expect(buildReclaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(3_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      accountUtxo: accountUtxo(DRIP_OIL, 100n), faucetAccountScript: ACCT_SCRIPT,
      tlampPolicyId: TLAMP_POLICY, currentEpoch: 1100n,  // < 100+1001
    })).rejects.toThrow(/chưa idle đủ/);
  });
});
