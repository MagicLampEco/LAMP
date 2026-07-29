// LAMP Allocation setupBuilder — khởi tạo 1 kênh ngân sách (genesis, committee chạy 1 lần).
//
// Dựng tx ONE-SHOT đặt nền hard-cap 2 lớp cho 1 kênh:
//   CONSUME genesis_ref UTxO (one-shot: budget_nft chỉ mint hợp lệ khi tx spend đúng UTxO này).
//   MINT  1 budget NFT (policy budgetNftPolicy, name = channel_id, qty +1) — redeemer MintGenesis.
//   OUT   ChannelBudget beacon  → channel_budget script, value = min-ADA + NFT,
//         datum {channel_id, remaining_oil = budgetOil} (Lớp A kế toán).
//   OUT   Treasury con           → treasury script, value = min-ADA + budgetOil LAMP,
//         datum {committee_hash, channel_id} (Lớp B vật lý, value = ĐÚNG budget kênh).
//
// budget_nft.ak (sau PHÁ VÒNG) ÉP: ĐÚNG 1 output mang NFT genesis + ChannelBudgetDatum
// (beacon), VÀ ĐÚNG 1 treasury con output cùng channel_id với LAMP == remaining_oil (VIỆC 2:
// Lớp A == Lớp B tại genesis). Builder PHẢI trả NFT + beacon datum vào budgetAddress (channel_budget
// script) và nạp treasury con LAMP = budgetOil. budget_nft KHÔNG còn tham số channel_budget_hash
// (đã phá vòng) — nhận diện beacon = output mang NFT, treasury = output mang TreasuryDatum cùng kênh.
//
// Caller chuẩn bị:
//   - budgetNftPolicy: MintingPolicy đã apply (genesis_ref, channel_id, lamp_policy, lamp_name)
//     + policy id hex tương ứng. (KHÔNG còn channel_budget_hash — phá vòng.)
//   - genesisUtxo: UTxO chính xác đã bake làm genesis_ref (builder collectFrom nó).
//     Builder assert genesisUtxo == genesisRef trước build (F3 fail-fast).
//   - LAMP funding: ví caller cung cấp budgetOil LAMP để nạp treasury (Lucid auto-select input).
//
// Invariants ép TRƯỚC build:
//   C-SET-1  budgetOil > 0.
//   C-SET-2  mint đúng 1 NFT (policy, name=channel_id).
//   C-SET-3  NFT ra channel_budget script (cùng UTxO beacon).
//   C-SET-4  treasury con value LAMP = budgetOil (= remaining_oil khởi tạo).

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type Assets, type LucidEvolution, type MintingPolicy, type Network,
  type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import type { ChannelBudgetDatum, TreasuryDatum } from "./types.js";
import {
  channelBudgetDatumToCbor, treasuryDatumToCbor, budgetNftRedeemerToCbor,
} from "./datum.js";
import { DEFAULT_MIN_ADA, LAMP_NAME } from "./constants.js";

/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface SetupChannelParams {
  lucid:   LucidEvolution;
  network: Network;

  /** channel_id hex (= NFT name = budget/treasury datum channel_id). */
  channelId: string;

  /** Ngân sách kênh (oil) — remaining_oil khởi tạo VÀ LAMP nạp treasury con. */
  budgetOil: bigint;

  /** committee_hash hex (TreasuryDatum). */
  committeeHash: string;

  /** budget_nft minting policy đã apply (genesis_ref, channel_id, lamp_policy, lamp_name) + policy id. */
  budgetNftPolicy:   MintingPolicy;
  budgetNftPolicyId: string;

  /** UTxO genesis đã bake làm genesis_ref của budget_nft (BẮT BUỘC consume). */
  genesisUtxo: UTxO;

  /**
   * genesis_ref ĐÃ BAKE vào budget_nft policy (one-shot). F3: assert genesisUtxo KHỚP
   * trước build → fail-fast nếu lệch (tránh mint policy id khác → tx fail trên chain).
   */
  genesisRef: { txHash: string; outputIndex: number };

  /** channel_budget spend validator (đích NFT beacon). */
  budgetScript: Validator;
  /** treasury spend validator (giữ LAMP pool kênh). */
  treasuryScript: Validator;

  /** LAMP policy + asset-name (mặc định "LAMP") — token nạp treasury. */
  lampPolicyId:   string;
  lampAssetName?: string;

  /** min-ADA mỗi UTxO script (mặc định 2 ADA). */
  minAda?: bigint;
}

export interface SetupChannelResult {
  tx:             TxSignBuilder;
  budgetAddress:  string;
  treasuryAddress: string;
  nftUnit:        string;
  budgetDatum:    ChannelBudgetDatum;
  treasuryDatum:  TreasuryDatum;
  summary:        string;
}

export async function buildSetupChannelTx(params: SetupChannelParams): Promise<SetupChannelResult> {
  const {
    lucid, network, budgetOil, budgetNftPolicy, budgetNftPolicyId,
    genesisUtxo, genesisRef, budgetScript, treasuryScript, lampPolicyId,
  } = params;

  if (budgetOil <= 0n) throw new Error(`SETUP-001: budgetOil must be > 0 (got ${budgetOil})`); // C-SET-1

  // F3: fail-fast — genesisUtxo PHẢI khớp genesis_ref đã bake vào budget_nft policy.
  // Lệch → policy id derive khác → NFT mint sai policy → tx fail trên chain (one-shot).
  if (
    genesisUtxo.txHash !== genesisRef.txHash ||
    genesisUtxo.outputIndex !== genesisRef.outputIndex
  ) {
    throw new Error(
      `TSETUP-001: genesisUtxo không khớp genesis_ref đã bake — ` +
      `utxo ${genesisUtxo.txHash}#${genesisUtxo.outputIndex} ≠ ` +
      `ref ${genesisRef.txHash}#${genesisRef.outputIndex}`,
    );
  }

  const channelId    = normHex(params.channelId);
  const committeeHash = normHex(params.committeeHash);
  const lampAssetName = params.lampAssetName ?? LAMP_NAME;
  const minAda        = params.minAda ?? DEFAULT_MIN_ADA;

  const nftUnit  = toUnit(budgetNftPolicyId, channelId);   // name = channel_id (C-SET-2)
  const lampUnit = toUnit(lampPolicyId, lampAssetName);

  // ── Addresses ──────────────────────────────────────────────────────
  const budgetAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(budgetScript)),
  );
  const treasuryAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(treasuryScript)),
  );

  // ── Output datums ──────────────────────────────────────────────────
  const budgetDatum: ChannelBudgetDatum = {
    channel_id:    channelId,
    remaining_oil: budgetOil,
  };
  const treasuryDatum: TreasuryDatum = {
    committee_hash: committeeHash,
    channel_id:     channelId,
  };

  // ── Output values ──────────────────────────────────────────────────
  // Beacon: min-ADA + 1 NFT (ra channel_budget script — C-SET-3).
  const budgetValue: Assets = { lovelace: minAda, [nftUnit]: 1n };
  // Treasury con: min-ADA + budgetOil LAMP (= budget vật lý kênh — C-SET-4).
  const treasuryValue: Assets = { lovelace: minAda, [lampUnit]: budgetOil };

  // ── Build tx: consume genesis + mint NFT + 2 outputs ───────────────
  const txb = lucid
    .newTx()
    .collectFrom([genesisUtxo])                                  // one-shot genesis_ref
    .mintAssets({ [nftUnit]: 1n }, budgetNftRedeemerToCbor())    // MintGenesis (C-SET-2)
    .attach.MintingPolicy(budgetNftPolicy)
    .pay.ToAddressWithData(
      budgetAddress,
      { kind: "inline", value: channelBudgetDatumToCbor(budgetDatum) },
      budgetValue,                                               // NFT → channel_budget (C-SET-3)
    )
    .pay.ToAddressWithData(
      treasuryAddress,
      { kind: "inline", value: treasuryDatumToCbor(treasuryDatum) },
      treasuryValue,                                             // LAMP = budgetOil (C-SET-4)
    );

  const tx = await txb.complete();

  const summary = [
    `═══ Setup channel (genesis · hard-cap 2 lớp) ═══`,
    `Channel:        ${channelId}`,
    `Budget:         ${budgetOil / 1_000_000n} LAMP (${budgetOil} oil)`,
    `NFT:            ${nftUnit}`,
    `Genesis ref:    ${genesisUtxo.txHash}#${genesisUtxo.outputIndex}`,
    `Budget addr:    ${budgetAddress}  (remaining_oil = ${budgetOil})`,
    `Treasury addr:  ${treasuryAddress}  (LAMP = ${budgetOil})`,
  ].join("\n");

  return { tx, budgetAddress, treasuryAddress, nftUnit, budgetDatum, treasuryDatum, summary };
}
