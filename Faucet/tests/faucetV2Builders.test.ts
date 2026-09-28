// Faucet v3 builder logic — buildClaimAgainTx / buildUseTx / buildReclaimTx / buildTopUpPoolTx.
// Mock tx-builder ghi lại call → assert drip/datum/value/validity-range. KHÔNG submit thật.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator, MintingPolicy } from "@lucid-evolution/lucid";

import { buildClaimAgainTx } from "../offchain/src/claimDidBuilder.js";
import { buildUseTx } from "../offchain/src/useBuilder.js";
import { buildReclaimTx } from "../offchain/src/reclaimBuilder.js";
import { buildTopUpPoolTx } from "../offchain/src/topUpPoolBuilder.js";
import {
  poolDatumToCbor, poolDatumFromCbor, faucetAccountToCbor,
  poolClaimAgainRedeemerToCbor, accountTopUpRedeemerToCbor,
  accountReclaimIdleRedeemerToCbor, poolReclaimRedeemerToCbor, burnAccountRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  DRIP_OILDROP, COOLDOWN, RECLAIM, MAX_CLAIMS_CEILING, TLAMP_ASSET_NAME, POOL_NFT_NAME,
  acctName,
} from "../offchain/src/constants.js";
import { epochAt } from "../offchain/src/epochWindow.js";

interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer?: string | undefined }[];
  mint: { assets: Record<string, bigint>; redeemer: string }[];
  attachMint: MintingPolicy[];
  attachSpend: Validator[];
  payData: { address: string; datum: string; assets: Record<string, bigint> }[];
  validFrom?: number;
  validTo?: number;
}

function mockLucid(): { lucid: any; rec: Recorded } {
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
    validFrom(ms: number) { rec.validFrom = ms; return txb; },
    validTo(ms: number) { rec.validTo = ms; return txb; },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = { newTx() { return txb; }, wallet() { return { address: async () => "addr_user" }; } };
  return { lucid, rec };
}

const NETWORK = "Preview" as const;
const MS_PER_EPOCH = 86_400_000n; // Preview
const POOL_SCRIPT: Validator = { type: "PlutusV3", script: "49480100002221200101" };
const ACCT_SCRIPT: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const NFT_POLICY: MintingPolicy = { type: "PlutusV3", script: "49480100002221200199" };

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

const CFG = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, max_claims_per_window: MAX_CLAIMS_CEILING };
const NOW_MS = 200 * Number(MS_PER_EPOCH) + 5_000;
const EPOCH = epochAt(NOW_MS, Number(MS_PER_EPOCH));

function poolUtxo(tlampOildrop: bigint, windowEpoch = EPOCH, claims = 0n): UTxO {
  return {
    txHash: "cd".repeat(32), outputIndex: 0, address: addr(POOL_SCRIPT),
    assets: { lovelace: 10_000_000n, [POOL_NFT_UNIT]: 1n, [TLAMP_UNIT]: tlampOildrop },
    datum: poolDatumToCbor({ cfg: CFG, window_epoch: windowEpoch, claims_in_window: claims }),
  };
}

function didUtxo(): UTxO {
  return {
    txHash: "de".repeat(32), outputIndex: 0, address: "addr_user",
    assets: { lovelace: 2_000_000n, [DID_UNIT]: 1n },
  };
}

function accountUtxo(tlampOildrop: bigint, lastClaim: bigint, lastTouch: bigint): UTxO {
  return {
    txHash: "ef".repeat(32), outputIndex: 0, address: addr(ACCT_SCRIPT),
    assets: { lovelace: 2_000_000n, [ACCT_NFT_UNIT]: 1n, [TLAMP_UNIT]: tlampOildrop },
    datum: faucetAccountToCbor({ did_name: DID_NAME, last_claim_epoch: lastClaim, last_touch_epoch: lastTouch }),
  };
}

// ── ClaimAgain ─────────────────────────────────────────────────────────
describe("buildClaimAgainTx — nạp thêm drip vào account đã có (DID-gated, pinned)", () => {
  it("account +drip, pool -drip, cả hai mốc → now, ACCT NFT giữ nguyên (không mint)", async () => {
    const { lucid, rec } = mockLucid();
    const oldClaim = EPOCH - COOLDOWN - 1n; // hết cooldown
    const res = await buildClaimAgainTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(5_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      oldAccountUtxo: accountUtxo(DRIP_OILDROP, oldClaim, oldClaim), faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      faucetNftPolicyId: NFT_POLICY_ID, tlampPolicyId: TLAMP_POLICY,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    });
    expect(res.drip).toBe(DRIP_OILDROP);
    expect(res.accountDatum.last_claim_epoch).toBe(EPOCH);
    expect(res.accountDatum.last_touch_epoch).toBe(EPOCH);

    // KHÔNG mint gì (C-AGAIN-1) — chuỗi account cũ đi tiếp, không đúc lại ACCT NFT.
    expect(rec.mint).toHaveLength(0);

    expect(rec.collectFrom.some((c) => c.redeemer === poolClaimAgainRedeemerToCbor())).toBe(true);
    expect(rec.collectFrom.some((c) => c.redeemer === accountTopUpRedeemerToCbor())).toBe(true);
    // DID NFT có mặt trong input (C-DID-1 + C-TOP-DID-1).
    expect(rec.collectFrom.some((c) => c.utxos[0]!.assets[DID_UNIT] === 1n)).toBe(true);

    const acctOut = rec.payData.find((p) => p.address === addr(ACCT_SCRIPT))!;
    expect(acctOut.assets[TLAMP_UNIT]).toBe(DRIP_OILDROP + DRIP_OILDROP);
    expect(acctOut.assets[ACCT_NFT_UNIT]).toBe(1n);

    expect(rec.validFrom).toBe(NOW_MS);
    expect(rec.validTo).toBeDefined();
  });

  it("rejects khi didUtxo KHÔNG mang DID NFT — ném NGAY, không dựng tx (C-TOP-DID-1)", async () => {
    const { lucid } = mockLucid();
    const oldClaim = EPOCH - COOLDOWN - 1n;
    const badDid: UTxO = { ...didUtxo(), assets: { lovelace: 2_000_000n } };
    await expect(buildClaimAgainTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(5_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      oldAccountUtxo: accountUtxo(DRIP_OILDROP, oldClaim, oldClaim), faucetAccountScript: ACCT_SCRIPT,
      didUtxo: badDid, didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      faucetNftPolicyId: NFT_POLICY_ID, tlampPolicyId: TLAMP_POLICY,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/CLAIM-AGAIN-000/);
  });

  it("rejects khi CHƯA hết cooldown", async () => {
    const { lucid } = mockLucid();
    const oldClaim = EPOCH; // vừa claim ở CHÍNH cửa sổ này — chưa qua cooldown
    await expect(buildClaimAgainTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(5_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      oldAccountUtxo: accountUtxo(DRIP_OILDROP, oldClaim, oldClaim), faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      faucetNftPolicyId: NFT_POLICY_ID, tlampPolicyId: TLAMP_POLICY,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/CLAIM-AGAIN-009/);
  });

  it("rejects khi oldAccountUtxo.did_name khác didName truyền vào", async () => {
    const { lucid } = mockLucid();
    const oldClaim = EPOCH - COOLDOWN - 1n;
    const wrongAcct: UTxO = accountUtxo(DRIP_OILDROP, oldClaim, oldClaim);
    wrongAcct.datum = faucetAccountToCbor({ did_name: "b0b0b0", last_claim_epoch: oldClaim, last_touch_epoch: oldClaim });
    await expect(buildClaimAgainTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(5_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      oldAccountUtxo: wrongAcct, faucetAccountScript: ACCT_SCRIPT,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      faucetNftPolicyId: NFT_POLICY_ID, tlampPolicyId: TLAMP_POLICY,
      nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/CLAIM-AGAIN-004/);
  });
});

// ── Use ────────────────────────────────────────────────────────────────
describe("buildUseTx — gia hạn last_touch_epoch, last_claim_epoch BẤT BIẾN", () => {
  it("updates last_touch_epoch, giữ last_claim_epoch, cho phép rút một phần", async () => {
    const { lucid, rec } = mockLucid();
    const res = await buildUseTx({
      lucid, network: NETWORK,
      accountUtxo: accountUtxo(DRIP_OILDROP, 50n, 100n), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicyId: NFT_POLICY_ID,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
      withdrawOildrop: 1_000_000n,
    });
    expect(res.newAccountDatum.last_touch_epoch).toBe(EPOCH);
    expect(res.newAccountDatum.last_claim_epoch).toBe(50n);   // BẤT BIẾN — C-USE-CLAIMFIX-1
    expect(res.accountLampAfter).toBe(DRIP_OILDROP - 1_000_000n);

    const acctOut = rec.payData.find((p) => p.address === addr(ACCT_SCRIPT))!;
    expect(acctOut.assets[ACCT_NFT_UNIT]).toBe(1n);
    expect(acctOut.assets[TLAMP_UNIT]).toBe(DRIP_OILDROP - 1_000_000n);
    expect(rec.validFrom).toBe(NOW_MS);
  });

  it("rejects rút quá số dư account", async () => {
    const { lucid } = mockLucid();
    await expect(buildUseTx({
      lucid, network: NETWORK,
      accountUtxo: accountUtxo(DRIP_OILDROP, 50n, 100n), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicyId: NFT_POLICY_ID,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
      withdrawOildrop: DRIP_OILDROP + 1n,
    })).rejects.toThrow(/USE-005/);
  });

  it("rejects khi mốc idle sẽ LÙI (C-USE-MONO-1) — account đã touch ở epoch tương lai giả", async () => {
    const { lucid } = mockLucid();
    await expect(buildUseTx({
      lucid, network: NETWORK,
      accountUtxo: accountUtxo(DRIP_OILDROP, 50n, EPOCH + 1_000n), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicyId: NFT_POLICY_ID,
      didUtxo: didUtxo(), didNftPolicyId: DID_POLICY_ID, didName: DID_NAME,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/USE-007/);
  });
});

// ── Reclaim ─────────────────────────────────────────────────────────────
describe("buildReclaimTx — thu hồi idle về pool + ĐỐT ACCT NFT, cận dưới (không pinned)", () => {
  it("returns all account tLAMP to pool, burns ACCT NFT, bảo toàn bộ đếm tốc độ", async () => {
    const { lucid, rec } = mockLucid();
    const lastTouch = EPOCH - RECLAIM - 1n; // idle đủ lâu
    const res = await buildReclaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(3_000_000_000n, EPOCH, 5n), faucetPoolScript: POOL_SCRIPT,
      accountUtxo: accountUtxo(DRIP_OILDROP, lastTouch, lastTouch), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    });
    expect(res.reclaimed).toBe(DRIP_OILDROP);
    expect(res.poolAfter).toBe(3_000_000_000n + DRIP_OILDROP);

    expect(rec.collectFrom.some((c) => c.redeemer === accountReclaimIdleRedeemerToCbor())).toBe(true);
    expect(rec.collectFrom.some((c) => c.redeemer === poolReclaimRedeemerToCbor())).toBe(true);
    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets[ACCT_NFT_UNIT]).toBe(-1n);          // ĐỐT — C-BURN-1
    expect(rec.mint[0]!.redeemer).toBe(burnAccountRedeemerToCbor());

    const poolOut = rec.payData.find((p) => p.address === addr(POOL_SCRIPT))!;
    const pdOut = poolDatumFromCbor(poolOut.datum);
    expect(pdOut.window_epoch).toBe(EPOCH);
    expect(pdOut.claims_in_window).toBe(5n);   // bảo toàn — C-RECL-1/2

    // ReclaimIdle: KHÔNG pinned — chỉ validFrom, không validTo.
    expect(rec.validFrom).toBe(NOW_MS);
    expect(rec.validTo).toBeUndefined();
  });

  it("rejects khi account chưa idle đủ", async () => {
    const { lucid } = mockLucid();
    const lastTouch = EPOCH - RECLAIM + 10n; // chưa đủ
    await expect(buildReclaimTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(3_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      accountUtxo: accountUtxo(DRIP_OILDROP, lastTouch, lastTouch), faucetAccountScript: ACCT_SCRIPT,
      faucetNftPolicy: NFT_POLICY, faucetNftPolicyId: NFT_POLICY_ID,
      tlampPolicyId: TLAMP_POLICY, nowMs: NOW_MS, msPerEpoch: MS_PER_EPOCH,
    })).rejects.toThrow(/RECLAIM-004/);
  });
});

// ── TopUpPool ─────────────────────────────────────────────────────────
describe("buildTopUpPoolTx — nạp thêm tLAMP vào pool, không đụng bộ đếm/account", () => {
  it("pool +deposit, bộ đếm bảo toàn, không validity range", async () => {
    const { lucid, rec } = mockLucid();
    const res = await buildTopUpPoolTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(1_000_000_000n, EPOCH, 7n), faucetPoolScript: POOL_SCRIPT,
      tlampPolicyId: TLAMP_POLICY, depositOildrop: DRIP_OILDROP,
    });
    expect(res.poolAfter).toBe(1_000_000_000n + DRIP_OILDROP);
    const poolOut = rec.payData[0]!;
    const pdOut = poolDatumFromCbor(poolOut.datum);
    expect(pdOut.window_epoch).toBe(EPOCH);
    expect(pdOut.claims_in_window).toBe(7n);
    expect(rec.attachSpend).toContain(POOL_SCRIPT);
    expect(rec.validFrom).toBeUndefined();
    expect(rec.validTo).toBeUndefined();
  });

  it("rejects nạp dưới 1 drip (C-TUP-1: cấm spend rỗng)", async () => {
    const { lucid } = mockLucid();
    await expect(buildTopUpPoolTx({
      lucid, network: NETWORK,
      poolUtxo: poolUtxo(1_000_000_000n), faucetPoolScript: POOL_SCRIPT,
      tlampPolicyId: TLAMP_POLICY, depositOildrop: DRIP_OILDROP - 1n,
    })).rejects.toThrow(/TOPUP-POOL-001/);
  });
});
