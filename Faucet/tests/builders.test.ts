// Faucet builder logic tests — KHÔNG submit thật. Mock tx-builder chain ghi lại
// call → assert datum/value preservation + claim amount + validation errors.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator, MintingPolicy } from "@lucid-evolution/lucid";

import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import { buildMintPoolTx } from "../offchain/src/mintBuilder.js";
import { faucetDatumToCbor } from "../offchain/src/datum.js";
import {
  CLAIM_AMOUNT_OILDROP, TOTAL_SUPPLY_OILDROP, TLAMP_ASSET_NAME, lampToOildrop,
} from "../offchain/src/constants.js";

// ── Mock Lucid tx-builder ──────────────────────────────────────────────
interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer?: string | undefined }[];
  mint:        { assets: Record<string, bigint>; redeemer: string }[];
  attachMint:  MintingPolicy[];
  attachSpend: Validator[];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  payAddr:     { address: string; assets: Record<string, bigint> }[];
}

function mockLucid(walletAddress: string): { lucid: any; rec: Recorded } {
  const rec: Recorded = {
    collectFrom: [], mint: [], attachMint: [], attachSpend: [], payData: [], payAddr: [],
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
      ToAddress(address: string, assets: Record<string, bigint>) {
        rec.payAddr.push({ address, assets }); return txb;
      },
    },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = {
    newTx() { return txb; },
    wallet() { return { address: async () => walletAddress }; },
  };
  return { lucid, rec };
}

const NETWORK = "Preview" as const;
const FAKE_FAUCET:  Validator      = { type: "PlutusV3", script: "49480100002221200101" };
const FAKE_POLICY:  MintingPolicy  = { type: "PlutusV3", script: "49480100002221200199" };
const POLICY_ID = "aa".repeat(28);
const TLAMP_UNIT = toUnit(POLICY_ID, TLAMP_ASSET_NAME);

function scriptAddr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

function genesisUtxo(): UTxO {
  return {
    txHash: "ab".repeat(32), outputIndex: 0,
    address: "addr_deploy",
    assets: { lovelace: 100_000_000n },
  };
}

function poolUtxo(tlampOildrop: bigint, extra: Record<string, bigint> = {}, lovelace = 5_000_000n): UTxO {
  return {
    txHash: "cd".repeat(32), outputIndex: 0,
    address: scriptAddr(FAKE_FAUCET),
    assets: { lovelace, [TLAMP_UNIT]: tlampOildrop, ...extra },
    datum: faucetDatumToCbor({ claim_amount: CLAIM_AMOUNT_OILDROP }),
  };
}

// ── buildMintPoolTx (deploy) ───────────────────────────────────────────
describe("buildMintPoolTx — one-shot deploy", () => {
  it("mints full supply, consumes genesis, sends all tLAMP to pool with datum", async () => {
    const { lucid, rec } = mockLucid("addr_deploy");
    const res = await buildMintPoolTx({
      lucid, network: NETWORK,
      tlampPolicy: FAKE_POLICY, tlampPolicyId: POLICY_ID,
      faucetScript: FAKE_FAUCET, genesisUtxo: genesisUtxo(),
    });
    // genesis consumed (one-shot)
    expect(rec.collectFrom).toHaveLength(1);
    expect(rec.collectFrom[0]!.utxos[0]!.txHash).toBe("ab".repeat(32));
    // mint = total supply
    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets[TLAMP_UNIT]).toBe(TOTAL_SUPPLY_OILDROP);
    expect(rec.attachMint).toContain(FAKE_POLICY);
    // pool output gets ALL tLAMP + datum
    expect(rec.payData).toHaveLength(1);
    expect(rec.payData[0]!.address).toBe(scriptAddr(FAKE_FAUCET));
    expect(rec.payData[0]!.assets[TLAMP_UNIT]).toBe(TOTAL_SUPPLY_OILDROP);
    expect(rec.payData[0]!.datum).toBe(faucetDatumToCbor({ claim_amount: CLAIM_AMOUNT_OILDROP }));
    expect(res.totalSupply).toBe(TOTAL_SUPPLY_OILDROP);
    // 36e9 LAMP × 1e6 = 3.6e16 oildrop
    expect(res.totalSupply).toBe(36_000_000_000_000_000n);
  });

  it("rejects claimAmount > totalSupply", async () => {
    const { lucid } = mockLucid("addr_deploy");
    await expect(buildMintPoolTx({
      lucid, network: NETWORK,
      tlampPolicy: FAKE_POLICY, tlampPolicyId: POLICY_ID,
      faucetScript: FAKE_FAUCET, genesisUtxo: genesisUtxo(),
      totalSupplyOildrop: 100n, claimAmountOildrop: 200n,
    })).rejects.toThrow(/claimAmount > totalSupply/);
  });
});

// ── buildClaimTx (claim 100) ───────────────────────────────────────────
describe("buildClaimTx — nhả đúng 100 tLAMP", () => {
  it("releases exactly claim_amount, preserves pool ADA + dust + datum, no mint", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const DUST = toUnit("dd".repeat(28), "f00d");
    const POOL_BEFORE = lampToOildrop(1_000_000n);  // 1M LAMP pool
    const res = await buildClaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(POOL_BEFORE, { [DUST]: 9n }),
      faucetScript: FAKE_FAUCET, tlampPolicyId: POLICY_ID,
    });
    // amount = 100 LAMP
    expect(res.amount).toBe(CLAIM_AMOUNT_OILDROP);
    expect(res.amount).toBe(lampToOildrop(100n));
    // pool spent, no mint
    expect(rec.collectFrom).toHaveLength(1);
    expect(rec.mint).toHaveLength(0);
    expect(rec.attachSpend).toContain(FAKE_FAUCET);
    // pool output: tLAMP −100, ADA + dust + datum preserved
    const poolOut = rec.payData[0]!;
    expect(poolOut.assets[TLAMP_UNIT]).toBe(POOL_BEFORE - CLAIM_AMOUNT_OILDROP);
    expect(poolOut.assets.lovelace).toBe(5_000_000n);
    expect(poolOut.assets[DUST]).toBe(9n);
    expect(poolOut.datum).toBe(faucetDatumToCbor({ claim_amount: CLAIM_AMOUNT_OILDROP }));
    // claimer receives exactly 100 tLAMP
    expect(rec.payAddr).toHaveLength(1);
    expect(rec.payAddr[0]!.address).toBe("addr_user");
    expect(rec.payAddr[0]!.assets[TLAMP_UNIT]).toBe(CLAIM_AMOUNT_OILDROP);
    // fixed-supply: pool_out + claimer == pool_in
    expect(poolOut.assets[TLAMP_UNIT]! + rec.payAddr[0]!.assets[TLAMP_UNIT]!).toBe(POOL_BEFORE);
  });

  it("uses explicit destinationAddress when provided", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    await buildClaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(lampToOildrop(1000n)),
      faucetScript: FAKE_FAUCET, tlampPolicyId: POLICY_ID,
      destinationAddress: "addr_other",
    });
    expect(rec.payAddr[0]!.address).toBe("addr_other");
  });

  it("drops tLAMP unit from pool output when pool drained to exactly claim_amount", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const res = await buildClaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(CLAIM_AMOUNT_OILDROP),   // pool == exactly 100
      faucetScript: FAKE_FAUCET, tlampPolicyId: POLICY_ID,
    });
    expect(res.poolAfter).toBe(0n);
    expect(rec.payData[0]!.assets[TLAMP_UNIT]).toBeUndefined();  // unit removed
    expect(rec.payData[0]!.assets.lovelace).toBe(5_000_000n);     // ADA kept
  });

  it("rejects when pool tLAMP < claim_amount (drained)", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildClaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(CLAIM_AMOUNT_OILDROP - 1n),  // 99.999999 LAMP
      faucetScript: FAKE_FAUCET, tlampPolicyId: POLICY_ID,
    })).rejects.toThrow(/< claim_amount/);
  });

  it("rejects pool with no datum", async () => {
    const { lucid } = mockLucid("addr_user");
    const bad: UTxO = { ...poolUtxo(lampToOildrop(1000n)), datum: null as any };
    await expect(buildClaimTx({
      lucid, network: NETWORK,
      poolUtxo: bad, faucetScript: FAKE_FAUCET, tlampPolicyId: POLICY_ID,
    })).rejects.toThrow(/no inline datum/);
  });

  it("rejects pool datum claim_amount = 0", async () => {
    const { lucid } = mockLucid("addr_user");
    const bad: UTxO = {
      ...poolUtxo(lampToOildrop(1000n)),
      datum: faucetDatumToCbor({ claim_amount: 0n }),
    };
    await expect(buildClaimTx({
      lucid, network: NETWORK,
      poolUtxo: bad, faucetScript: FAKE_FAUCET, tlampPolicyId: POLICY_ID,
    })).rejects.toThrow(/claim_amount must be > 0/);
  });
});
