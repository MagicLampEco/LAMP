// LAMP Allocation claimBuilder — committee cấp/tăng entitlement (Capped Drop + hard-cap).
//
// CO-SPEND 2 UTxO trong CÙNG tx (khoá chéo claim_account ↔ channel_budget):
//   IN  ClaimAccount  (Claim{amount})     → entitlement += amount; field khác bất biến.
//   IN  ChannelBudget (Decrement{amount})  → remaining_oildrop -= amount; NFT+value+channel bất biến.
//   OUT ClaimAccount' (cùng addr, value == in) + ChannelBudget' (cùng addr, value == in).
//   SIGN ≥ threshold committee (cả 2 validator đòi).
//   tx.mint == 0 (builder không gọi .mintAssets).
//
// Invariants ép TRƯỚC build (fail-fast offchain, khớp luật onchain):
//   C-CLM-1  amount > 0.
//   C-CLM-2  account.channel_id == budget.channel_id (cùng kênh — khoá chéo).
//   C-CLM-3  budget.remaining_oildrop ≥ amount (Lớp A: không cấp vượt budget).
//   C-CLM-4  out.entitlement = in.entitlement + amount; owner/redeemed/start/dpe/channel bất biến.
//   C-CLM-5  budget NFT (policy, name=channel_id) qty 1 trên beacon UTxO (authenticity).
//   C-CLM-6  ≥ threshold committee signers.
//   C-VAL-0  value 2 UTxO bảo toàn tuyệt đối (chỉ datum đổi).

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type Network, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import type { ChannelBudgetDatum, ClaimAccountDatum } from "./types.js";
import {
  decodeClaimAccountDatum, decodeChannelBudgetDatum,
  claimAccountDatumToCbor, channelBudgetDatumToCbor,
  claimRedeemerToCbor, decrementRedeemerToCbor,
} from "./datum.js";
import { assertCommitteeSigners } from "./committee.js";

/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface ClaimParams {
  lucid:        LucidEvolution;
  network:      Network;

  /** ClaimAccount UTxO của owner (inline datum bắt buộc) — spend Claim{amount}. */
  claimAccountUtxo: UTxO;
  claimScript:      Validator;

  /** ChannelBudget beacon UTxO cùng kênh (inline datum + NFT) — spend Decrement{amount}. */
  budgetUtxo:       UTxO;
  budgetScript:     Validator;

  /** Budget NFT policy id (compile-time param; name = channel_id). */
  budgetNftPolicy:  string;

  /** Oildrop entitlement cấp thêm lần này (> 0). */
  amount:           bigint;

  /** Committee key-hash (hex) + threshold (= param validator) + subset ký. */
  committeeKeyHashes: string[];
  threshold?:         number;
  signerKeyHashes?:   string[];
}

export interface ClaimResult {
  tx:            TxSignBuilder;
  claimAddress:  string;
  budgetAddress: string;
  newClaimDatum: ClaimAccountDatum;
  newBudgetDatum: ChannelBudgetDatum;
  summary:       string;
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, network, claimAccountUtxo, claimScript,
    budgetUtxo, budgetScript, budgetNftPolicy, amount, committeeKeyHashes,
  } = params;

  if (amount <= 0n) throw new Error(`CLAIM-001: amount must be > 0 (got ${amount})`); // C-CLM-1

  const signers   = params.signerKeyHashes ?? committeeKeyHashes;
  const threshold = assertCommitteeSigners(committeeKeyHashes, signers, params.threshold); // C-CLM-6

  // ── Decode datums ──────────────────────────────────────────────────
  if (!claimAccountUtxo.datum) throw new Error("CLAIM-002: claimAccountUtxo has no inline datum");
  const claim = decodeClaimAccountDatum(Data.from(claimAccountUtxo.datum));

  if (!budgetUtxo.datum) throw new Error("CLAIM-003: budgetUtxo has no inline datum");
  const budget = decodeChannelBudgetDatum(Data.from(budgetUtxo.datum));

  // C-CLM-2: cùng kênh (khoá chéo channel_id).
  if (normHex(claim.channel_id) !== normHex(budget.channel_id)) {
    throw new Error(
      `CLAIM-004: channel mismatch — account ${claim.channel_id} ≠ budget ${budget.channel_id}`,
    );
  }

  // C-CLM-3: Lớp A — không cấp vượt remaining (channel_budget.ak: remaining ≥ amount).
  if (budget.remaining_oildrop < amount) {
    throw new Error(
      `CLAIM-005: amount ${amount} > remaining_oildrop ${budget.remaining_oildrop} (vượt budget kênh)`,
    );
  }

  // C-CLM-5: budget NFT authenticity (name = channel_id) trên beacon UTxO.
  const nftUnit = toUnit(budgetNftPolicy, normHex(budget.channel_id));
  const nftQty  = budgetUtxo.assets[nftUnit] ?? 0n;
  if (nftQty !== 1n) {
    throw new Error(
      `CLAIM-006: budget UTxO must hold exactly 1 NFT (${nftUnit}); got ${nftQty}`,
    );
  }

  // ── Output datums (khớp luật onchain) ──────────────────────────────
  // ClaimAccount': entitlement += amount; field khác (kể cả channel_id) bất biến (C-CLM-4).
  const newClaimDatum: ClaimAccountDatum = {
    owner:           claim.owner,
    entitlement:     claim.entitlement + amount,   // C-CLM-4
    redeemed:        claim.redeemed,
    start_epoch:     claim.start_epoch,
    drops_per_epoch: claim.drops_per_epoch,
    channel_id:      claim.channel_id,
  };
  // ChannelBudget': remaining -= amount; channel_id bất biến.
  const newBudgetDatum: ChannelBudgetDatum = {
    channel_id:    budget.channel_id,
    remaining_oildrop: budget.remaining_oildrop - amount,
  };

  // ── Addresses ──────────────────────────────────────────────────────
  const claimAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(claimScript)),
  );
  const budgetAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(budgetScript)),
  );

  // ── Value bảo toàn TUYỆT ĐỐI cả 2 UTxO (C-VAL-0) — clone toàn bộ assets ──
  const claimOutAssets:  Record<string, bigint> = { ...claimAccountUtxo.assets };
  const budgetOutAssets: Record<string, bigint> = { ...budgetUtxo.assets };

  // ── Build tx (co-spend account + budget) ───────────────────────────
  let txb = lucid
    .newTx()
    .collectFrom([claimAccountUtxo], claimRedeemerToCbor(amount))
    .attach.SpendingValidator(claimScript)
    .collectFrom([budgetUtxo], decrementRedeemerToCbor(amount))
    .attach.SpendingValidator(budgetScript)
    .pay.ToAddressWithData(
      claimAddress,
      { kind: "inline", value: claimAccountDatumToCbor(newClaimDatum) },
      claimOutAssets,
    )
    .pay.ToAddressWithData(
      budgetAddress,
      { kind: "inline", value: channelBudgetDatumToCbor(newBudgetDatum) },
      budgetOutAssets,
    );

  for (const k of signers) txb = txb.addSignerKey(k);

  const tx = await txb.complete();

  const summary = [
    `═══ Claim (Capped Drop · hard-cap kênh) ═══`,
    `Owner:        ${normHex(claim.owner)}`,
    `Channel:      ${normHex(claim.channel_id)}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oildrop)`,
    `Entitlement:  ${claim.entitlement} → ${newClaimDatum.entitlement} oildrop`,
    `Remaining:    ${budget.remaining_oildrop} → ${newBudgetDatum.remaining_oildrop} oildrop`,
    `Committee:    ${signers.length}/${committeeKeyHashes.length} signers (need ${threshold})`,
    `Claim addr:   ${claimAddress}`,
    `Budget addr:  ${budgetAddress}`,
  ].join("\n");

  return { tx, claimAddress, budgetAddress, newClaimDatum, newBudgetDatum, summary };
}
