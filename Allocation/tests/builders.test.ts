// Builder logic tests — KHÔNG submit thật (không Blockfrost/compiled validator).
// Mock tx-builder chain ghi lại các call → assert datum/redeemer/asset preservation
// + validation errors. Capped Drop · hard-cap kênh 2 lớp.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit,
} from "@lucid-evolution/lucid";
import type { MintingPolicy, UTxO, Validator } from "@lucid-evolution/lucid";

import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";
import { buildSetupChannelTx } from "../offchain/src/setupBuilder.js";
import {
  claimAccountDatumToCbor, channelBudgetDatumToCbor, treasuryDatumToCbor,
} from "../offchain/src/datum.js";
import { committeeThreshold } from "../offchain/src/committee.js";
import { lampOildrop, CHANNEL_TEAM, CHANNEL_RESERVE } from "./helpers.js";

// ── Mock Lucid tx-builder ──────────────────────────────────────────────
interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer?: string }[];
  attachSpend: Validator[];
  attachMint:  MintingPolicy[];
  mint:        { assets: Record<string, bigint>; redeemer: string }[];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  payAddr:     { address: string; assets: Record<string, bigint> }[];
  signers:     string[];
  validFrom:   number[];
}

function mockLucid(walletAddress: string): { lucid: any; rec: Recorded } {
  const rec: Recorded = {
    collectFrom: [], attachSpend: [], attachMint: [], mint: [],
    payData: [], payAddr: [], signers: [], validFrom: [],
  };
  const txb: any = {
    collectFrom(utxos: UTxO[], redeemer?: string) {
      rec.collectFrom.push(redeemer === undefined ? { utxos } : { utxos, redeemer });
      return txb;
    },
    mintAssets(assets: Record<string, bigint>, redeemer: string) { rec.mint.push({ assets, redeemer }); return txb; },
    attach: {
      SpendingValidator(v: Validator) { rec.attachSpend.push(v); return txb; },
      MintingPolicy(v: MintingPolicy) { rec.attachMint.push(v); return txb; },
    },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Record<string, bigint>) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
      ToAddress(address: string, assets: Record<string, bigint>) {
        rec.payAddr.push({ address, assets }); return txb;
      },
    },
    addSignerKey(k: string) { rec.signers.push(k); return txb; },
    validFrom(ms: number) { rec.validFrom.push(ms); return txb; },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = {
    newTx() { return txb; },
    wallet() { return { address: async () => walletAddress }; },
  };
  return { lucid, rec };
}

// fake applied validators — chỉ cần CBOR hợp lệ để derive script hash/address.
const FAKE_CLAIM:    Validator = { type: "PlutusV3", script: "49480100002221200101" };
const FAKE_BUDGET:   Validator = { type: "PlutusV3", script: "49480100002221200102" };
const FAKE_TREASURY: Validator = { type: "PlutusV3", script: "49480100002221200103" };
const FAKE_NFT_POLICY: MintingPolicy = { type: "PlutusV3", script: "49480100002221200104" };

const NETWORK = "Preview" as const;
const OWNER   = "aabbccddeeff00112233445566778899aabbccddeeff001122334455";
const COMMITTEE_HASH = "ee".repeat(28);
const LAMP_POLICY = "ff".repeat(28);
const LAMP_UNIT   = toUnit(LAMP_POLICY, "4c414d50");
const NFT_POLICY  = "cd".repeat(28);
const D = lampOildrop(100n);
/** ms mỗi epoch (Preview demo) — phải khớp ms_per_epoch bake vào claim_account. */
const MS_PER_EPOCH = 86_400_000n;
/** lower_bound ms cho epoch t (đầu epoch) — get_epoch = floor(ms/MS_PER_EPOCH). */
function epochMs(t: bigint): bigint { return t * MS_PER_EPOCH; }

// committee 3 keys, threshold 2 (⌈2·3/3⌉)
const COMMITTEE = ["11".repeat(28), "22".repeat(28), "33".repeat(28)];

function scriptAddr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

function claimUtxo(
  datum: { entitlement: bigint; redeemed: bigint; start_epoch?: bigint; dpe?: bigint; channel?: string },
  extra: Record<string, bigint> = {},
): UTxO {
  return {
    txHash: "11".repeat(32), outputIndex: 0,
    address: scriptAddr(FAKE_CLAIM),
    assets: { lovelace: 2_000_000n, ...extra },
    datum: claimAccountDatumToCbor({
      owner: OWNER, entitlement: datum.entitlement, redeemed: datum.redeemed,
      start_epoch: datum.start_epoch ?? 0n, drops_per_epoch: datum.dpe ?? 1n,
      channel_id: datum.channel ?? CHANNEL_TEAM,
    }),
  };
}

function budgetUtxo(remaining: bigint, channel = CHANNEL_TEAM, withNft = true): UTxO {
  const nftUnit = toUnit(NFT_POLICY, channel);
  return {
    txHash: "22".repeat(32), outputIndex: 0,
    address: scriptAddr(FAKE_BUDGET),
    assets: withNft ? { lovelace: 2_000_000n, [nftUnit]: 1n } : { lovelace: 2_000_000n },
    datum: channelBudgetDatumToCbor({ channel_id: channel, remaining_oildrop: remaining }),
  };
}

function treasuryUtxo(lamp: bigint, channel = CHANNEL_TEAM, extra: Record<string, bigint> = {}): UTxO {
  return {
    txHash: "33".repeat(32), outputIndex: 0,
    address: scriptAddr(FAKE_TREASURY),
    assets: { lovelace: 5_000_000n, [LAMP_UNIT]: lamp, ...extra },
    datum: treasuryDatumToCbor({ committee_hash: COMMITTEE_HASH, channel_id: channel }),
  };
}

// ── committeeThreshold ──────────────────────────────────────────────────
describe("committeeThreshold ⌈2N/3⌉", () => {
  it("Byzantine 2/3", () => {
    expect(committeeThreshold(3)).toBe(2);
    expect(committeeThreshold(4)).toBe(3);
    expect(committeeThreshold(7)).toBe(5);
    expect(committeeThreshold(1)).toBe(1);
  });
});

// ── buildClaimTx (co-spend account + budget) ────────────────────────────
describe("buildClaimTx — cấp entitlement + trừ remaining (khoá chéo)", () => {
  const base = {
    network: NETWORK, claimScript: FAKE_CLAIM, budgetScript: FAKE_BUDGET,
    budgetNftPolicy: NFT_POLICY, committeeKeyHashes: COMMITTEE,
  };

  it("entitlement += amount, remaining -= amount, value 2 UTxO bảo toàn, no mint", async () => {
    const { lucid, rec } = mockLucid("addr_committee");
    const DUST = toUnit("ab".repeat(28), "cafe");
    const res = await buildClaimTx({
      ...base, lucid, amount: lampOildrop(300n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(100n), redeemed: lampOildrop(40n) }, { [DUST]: 7n }),
      budgetUtxo: budgetUtxo(lampOildrop(1000n)),
    });
    // datums
    expect(res.newClaimDatum.entitlement).toBe(lampOildrop(400n));   // 100 + 300
    expect(res.newClaimDatum.redeemed).toBe(lampOildrop(40n));       // bất biến
    expect(res.newClaimDatum.channel_id).toBe(CHANNEL_TEAM);     // bất biến
    expect(res.newBudgetDatum.remaining_oildrop).toBe(lampOildrop(700n)); // 1000 − 300

    // co-spend 2 input, attach 2 validator
    expect(rec.collectFrom).toHaveLength(2);
    expect(rec.attachSpend).toEqual(expect.arrayContaining([FAKE_CLAIM, FAKE_BUDGET]));
    expect(rec.mint).toHaveLength(0);                            // C-MINT-0

    // 2 output script, value bảo toàn (clone toàn bộ assets in)
    const claimOut  = rec.payData.find(p => p.address === scriptAddr(FAKE_CLAIM))!;
    const budgetOut = rec.payData.find(p => p.address === scriptAddr(FAKE_BUDGET))!;
    expect(claimOut.assets).toEqual({ lovelace: 2_000_000n, [DUST]: 7n });
    expect(budgetOut.assets).toEqual({ lovelace: 2_000_000n, [toUnit(NFT_POLICY, CHANNEL_TEAM)]: 1n });

    // ≥ threshold signers
    expect(rec.signers.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects amount ≤ 0", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildClaimTx({
      ...base, lucid, amount: 0n,
      claimAccountUtxo: claimUtxo({ entitlement: 0n, redeemed: 0n }),
      budgetUtxo: budgetUtxo(lampOildrop(1000n)),
    })).rejects.toThrow(/amount must be > 0/);
  });

  it("rejects channel mismatch (account TEAM vs budget RESERVE)", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildClaimTx({
      ...base, lucid, amount: lampOildrop(10n),
      claimAccountUtxo: claimUtxo({ entitlement: 0n, redeemed: 0n, channel: CHANNEL_TEAM }),
      budgetUtxo: budgetUtxo(lampOildrop(1000n), CHANNEL_RESERVE),
    })).rejects.toThrow(/channel mismatch/);
  });

  it("rejects amount > remaining_oildrop (vượt budget kênh — Lớp A)", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildClaimTx({
      ...base, lucid, amount: lampOildrop(101n),
      claimAccountUtxo: claimUtxo({ entitlement: 0n, redeemed: 0n }),
      budgetUtxo: budgetUtxo(lampOildrop(100n)),
    })).rejects.toThrow(/vượt budget/);
  });

  it("rejects budget UTxO thiếu NFT authenticity", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildClaimTx({
      ...base, lucid, amount: lampOildrop(10n),
      claimAccountUtxo: claimUtxo({ entitlement: 0n, redeemed: 0n }),
      budgetUtxo: budgetUtxo(lampOildrop(1000n), CHANNEL_TEAM, false),
    })).rejects.toThrow(/exactly 1 NFT/);
  });

  it("rejects below-threshold signers", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildClaimTx({
      ...base, lucid, amount: lampOildrop(10n),
      claimAccountUtxo: claimUtxo({ entitlement: 0n, redeemed: 0n }),
      budgetUtxo: budgetUtxo(lampOildrop(1000n)),
      signerKeyHashes: [COMMITTEE[0]!],   // 1 < 2
    })).rejects.toThrow(/need ≥ 2 signers/);
  });

  it("exact drain: amount == remaining → remaining 0 (biên hợp lệ)", async () => {
    const { lucid } = mockLucid("addr_committee");
    const res = await buildClaimTx({
      ...base, lucid, amount: lampOildrop(500n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(100n), redeemed: 0n }),
      budgetUtxo: budgetUtxo(lampOildrop(500n)),
    });
    expect(res.newBudgetDatum.remaining_oildrop).toBe(0n);
    expect(res.newClaimDatum.entitlement).toBe(lampOildrop(600n));
  });
});

// ── buildRedeemTx (co-spend account + treasury con) ─────────────────────
describe("buildRedeemTx — vested = min(E, D·dpe·Δ), rút treasury cùng kênh", () => {
  const base = {
    network: NETWORK, claimScript: FAKE_CLAIM, treasuryScript: FAKE_TREASURY,
    lampPolicyId: LAMP_POLICY, dropValue: D, msPerEpoch: MS_PER_EPOCH,
  };

  it("releases vested−redeemed, treasury LAMP -= amount, datum+dust bảo toàn, redeemed+=amount", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const DUST = toUnit("dd".repeat(28), "f00d");
    // E=250, D=100, dpe=1, t0=0, t=3 → vested=min(250,300)=250; redeemed=100 → amount=150.
    const res = await buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(3n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: lampOildrop(100n) }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n), CHANNEL_TEAM, { [DUST]: 3n }),
    });
    expect(res.vested).toBe(lampOildrop(250n));
    expect(res.amount).toBe(lampOildrop(150n));
    expect(res.newClaimDatum.redeemed).toBe(lampOildrop(250n));
    expect(res.newClaimDatum.entitlement).toBe(lampOildrop(250n));   // bất biến
    expect(res.newClaimDatum.channel_id).toBe(CHANNEL_TEAM);     // bất biến

    expect(rec.collectFrom).toHaveLength(2);                     // account + treasury
    expect(rec.attachSpend).toEqual(expect.arrayContaining([FAKE_CLAIM, FAKE_TREASURY]));
    expect(rec.mint).toHaveLength(0);

    // treasury output: LAMP 1000→850, dust + lovelace + datum bảo toàn
    const tOut = rec.payData.find(p => p.address === scriptAddr(FAKE_TREASURY))!;
    expect(tOut.assets[LAMP_UNIT]).toBe(lampOildrop(850n));
    expect(tOut.assets.lovelace).toBe(5_000_000n);
    expect(tOut.assets[DUST]).toBe(3n);
    expect(tOut.datum).toBe(treasuryDatumToCbor({ committee_hash: COMMITTEE_HASH, channel_id: CHANNEL_TEAM }));

    // user nhận đúng amount + min-ADA tường minh (F4); owner ký
    expect(rec.payAddr).toHaveLength(1);
    expect(rec.payAddr[0]!.assets[LAMP_UNIT]).toBe(lampOildrop(150n));
    expect(rec.payAddr[0]!.assets.lovelace).toBe(2_000_000n);   // F4 min-ADA
    expect(rec.payAddr[0]!.address).toBe("addr_user");
    expect(rec.signers).toContain(OWNER);
    // F2: lower_bound LUÔN set (Finite) — get_epoch không fail cứng
    expect(rec.validFrom).toEqual([Number(epochMs(3n))]);
  });

  it("drip t=1 chỉ mở 1 drop D", async () => {
    const { lucid } = mockLucid("addr_user");
    const res = await buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(1n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
    });
    expect(res.amount).toBe(lampOildrop(100n));
  });

  it("exact full drain treasury (released == LAMP có)", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    // E=100, t=5 → vested=100; treasury chỉ 100 LAMP → out 0, bỏ unit.
    const res = await buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(5n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(100n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(100n)),
    });
    expect(res.amount).toBe(lampOildrop(100n));
    expect(res.treasuryAfter).toBe(0n);
    const tOut = rec.payData.find(p => p.address === scriptAddr(FAKE_TREASURY))!;
    expect(tOut.assets[LAMP_UNIT]).toBeUndefined();   // hết LAMP → bỏ unit
    expect(tOut.assets.lovelace).toBe(5_000_000n);
  });

  it("F2: LUÔN set validFrom = validFromMs (lower_bound Finite)", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    await buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(2n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
    });
    expect(rec.validFrom).toEqual([Number(epochMs(2n))]);
  });

  it("F1: epoch TỰ SUY = floor(validFromMs/msPerEpoch) — validFromMs lệch GIỮA epoch vẫn đúng", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    // validFromMs = 3.7 epoch (lệch giữa epoch). On-chain get_epoch floor → epoch 3.
    // E=250, D=100, dpe=1, t0=0 → vested=min(250, 100·3)=250; redeemed=0 → amount=250.
    // Nếu off-chain dùng 3.7 (làm tròn lên 4) → vested=250 vẫn, nhưng chứng minh floor:
    // dùng t=2.9 epoch để raw khác hẳn giữa floor(2)=200 và round(3)=300.
    const validFromMs = (29n * MS_PER_EPOCH) / 10n;   // 2.9 epoch
    const res = await buildRedeemTx({
      ...base, lucid, validFromMs,
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(1000n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(5000n)),
    });
    // floor(2.9) = epoch 2 → vested = 100·1·2 = 200 (KHÔNG phải 290 hay 300).
    expect(res.vested).toBe(lampOildrop(200n));
    expect(res.amount).toBe(lampOildrop(200n));
    // validFrom set ĐÚNG ms gốc (Finite), không phải epoch đã floor.
    expect(rec.validFrom).toEqual([Number(validFromMs)]);
  });

  it("F1: epoch tự suy KHỚP get_epoch — biên đầu epoch (validFromMs = đúng bội msPerEpoch)", async () => {
    const { lucid } = mockLucid("addr_user");
    // validFromMs = 4·msPerEpoch → epoch 4 chẵn. E=1000 → vested=100·4=400.
    const res = await buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(4n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(1000n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(5000n)),
    });
    expect(res.vested).toBe(lampOildrop(400n));
  });

  it("rejects double-redeem (redeemable ≤ 0)", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(1n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: lampOildrop(100n) }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
    })).rejects.toThrow(/redeemable ≤ 0/);
  });

  it("rejects t ≤ t0 (chưa mở khoá)", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(5n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: 0n, start_epoch: 5n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
    })).rejects.toThrow(/redeemable ≤ 0/);
  });

  it("rejects channel mismatch account vs treasury (cross-channel — Lớp B)", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(3n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: 0n, channel: CHANNEL_TEAM }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n), CHANNEL_RESERVE),
    })).rejects.toThrow(/channel mismatch/);
  });

  it("rejects treasury LAMP không đủ (Lớp B vật lý)", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, validFromMs: epochMs(1n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(50n)),
    })).rejects.toThrow(/< amount/);
  });

  it("F2: rejects msPerEpoch ≤ 0", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, msPerEpoch: 0n, validFromMs: epochMs(3n),
      claimAccountUtxo: claimUtxo({ entitlement: lampOildrop(250n), redeemed: 0n }),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
    })).rejects.toThrow(/msPerEpoch must be > 0/);
  });
});

// ── buildSetupChannelTx (genesis: mint NFT + beacon + treasury) ──────────
describe("buildSetupChannelTx — khởi tạo kênh hard-cap 2 lớp", () => {
  const genesisUtxo: UTxO = {
    txHash: "aa".repeat(32), outputIndex: 7,
    address: "addr_genesis", assets: { lovelace: 100_000_000n },
  };
  const genesisRef = { txHash: "aa".repeat(32), outputIndex: 7 };   // khớp genesisUtxo
  const base = {
    network: NETWORK, budgetScript: FAKE_BUDGET, treasuryScript: FAKE_TREASURY,
    budgetNftPolicy: FAKE_NFT_POLICY, budgetNftPolicyId: NFT_POLICY,
    lampPolicyId: LAMP_POLICY, committeeHash: COMMITTEE_HASH, genesisUtxo, genesisRef,
  };

  it("consume genesis, mint 1 NFT name=channel, beacon+treasury đúng datum/value", async () => {
    const { lucid, rec } = mockLucid("addr_committee");
    const res = await buildSetupChannelTx({
      ...base, lucid, channelId: CHANNEL_TEAM, budgetOildrop: lampOildrop(1000n),
    });
    // consume genesis
    expect(rec.collectFrom).toHaveLength(1);
    expect(rec.collectFrom[0]!.utxos[0]!.txHash).toBe("aa".repeat(32));

    // mint đúng 1 NFT name = channel_id
    const nftUnit = toUnit(NFT_POLICY, CHANNEL_TEAM);
    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets).toEqual({ [nftUnit]: 1n });
    expect(rec.attachMint).toContain(FAKE_NFT_POLICY);

    // beacon output: NFT → channel_budget script, datum {channel, remaining=budget}
    const bOut = rec.payData.find(p => p.address === scriptAddr(FAKE_BUDGET))!;
    expect(bOut.assets[nftUnit]).toBe(1n);
    expect(bOut.datum).toBe(channelBudgetDatumToCbor({ channel_id: CHANNEL_TEAM, remaining_oildrop: lampOildrop(1000n) }));

    // treasury output: LAMP = budgetOildrop, datum {committee, channel}
    const tOut = rec.payData.find(p => p.address === scriptAddr(FAKE_TREASURY))!;
    expect(tOut.assets[LAMP_UNIT]).toBe(lampOildrop(1000n));
    expect(tOut.datum).toBe(treasuryDatumToCbor({ committee_hash: COMMITTEE_HASH, channel_id: CHANNEL_TEAM }));

    expect(res.nftUnit).toBe(nftUnit);
  });

  it("rejects budgetOildrop ≤ 0", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildSetupChannelTx({
      ...base, lucid, channelId: CHANNEL_TEAM, budgetOildrop: 0n,
    })).rejects.toThrow(/budgetOildrop must be > 0/);
  });

  it("F3: rejects genesisUtxo lệch genesis_ref (sai outputIndex)", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildSetupChannelTx({
      ...base, lucid, channelId: CHANNEL_TEAM, budgetOildrop: lampOildrop(1000n),
      genesisRef: { txHash: "aa".repeat(32), outputIndex: 0 },   // utxo là #7 → lệch
    })).rejects.toThrow(/TSETUP-001: genesisUtxo không khớp genesis_ref/);
  });

  it("F3: rejects genesisUtxo lệch genesis_ref (sai txHash)", async () => {
    const { lucid } = mockLucid("addr_committee");
    await expect(buildSetupChannelTx({
      ...base, lucid, channelId: CHANNEL_TEAM, budgetOildrop: lampOildrop(1000n),
      genesisRef: { txHash: "bb".repeat(32), outputIndex: 7 },   // tx khác → lệch
    })).rejects.toThrow(/TSETUP-001/);
  });
});
