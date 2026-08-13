// LampDistribution claimBuilder — committee 2/3 confirm → tạo/cập nhật ClaimAccount.
// CONTRACT v2 "Capped Drop": Claim cấp/tăng entitlement E (committee confirm activity).
//
//   CREATE: account chưa có → datum {owner, entitlement=amount, redeemed=0,
//           start_epoch=current, drops_per_epoch}.
//   UPDATE: account đã có → entitlement += amount; redeemed/start_epoch/dpe bất biến.
//
// Invariants:
//   C-CLAIM-1  ≥ ⌈2N/3⌉ committee signatures.
//   C-CLAIM-2  out.entitlement = in.entitlement + amount; amount > 0.
//   C-CLAIM-3  out.owner == in.owner; redeemed/start_epoch/drops_per_epoch unchanged.
//   C-MINT-0   tx.mint == 0 (builder không gọi .mintAssets).
//   C-VAL-0    assets bảo toàn (lovelace + dust) — chỉ datum đổi.

import {
  Data,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import type { ClaimAccountDatum } from "./types.js";
import {
  claimAccountDatumToCbor, claimRedeemerToCbor, decodeClaimAccountDatum,
} from "./datum.js";
import { assertCommitteeSigners } from "./committee.js";
import { DEFAULT_DROPS_PER_EPOCH } from "./constants.js";

export interface ClaimParams {
  lucid:        LucidEvolution;
  /** Applied claim_account validator (định nghĩa script address). */
  claimScript:  Validator;
  network:      Network;

  /** PKH chủ ví (hex 28-byte) được committee xác nhận. */
  ownerPkh:     string;
  /** Số oildrop entitlement cấp thêm lần này (> 0). */
  amount:       bigint;
  /** Epoch hiện tại (committee tính off-chain từ validity range). */
  currentEpoch: bigint;

  /**
   * ClaimAccount UTxO hiện tại của owner (UPDATE path). Bỏ trống → CREATE path
   * (account đầu tiên cho owner này): start_epoch = currentEpoch.
   */
  claimAccountUtxo?: UTxO;

  /** drops_per_epoch cho account mới (CREATE). Mặc định 1 (MVP). */
  dropsPerEpoch?: bigint;

  /** Min-ADA cho ClaimAccount UTxO mới (CREATE path). Mặc định 2 ADA. */
  accountLovelace?: bigint;

  /** Danh sách committee key-hash (hex). */
  committeeKeyHashes: string[];
  threshold?:        number;
  signerKeyHashes?:  string[];

  /**
   * POSIX ms cho lower_bound validity_range (BẮT BUỘC live tx CREATE: validator
   * get_epoch đọc lower_bound → start_epoch). Bỏ trống → KHÔNG set (unit test off-chain).
   */
  validFromMs?: bigint;
}

export interface ClaimResult {
  tx:              TxSignBuilder;
  claimAddress:    string;
  newDatum:        ClaimAccountDatum;
  mode:            "create" | "update";
  summary:         string;
}

const DEFAULT_ACCOUNT_LOVELACE = 2_000_000n;

/** Strip leading 0x + lowercase (so sánh owner). */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, claimScript, network, ownerPkh, amount, currentEpoch,
    claimAccountUtxo, committeeKeyHashes,
  } = params;

  if (amount <= 0n) throw new Error(`CLAIM-001: amount must be > 0 (got ${amount})`); // C-CLAIM-2

  const signers   = params.signerKeyHashes ?? committeeKeyHashes;
  const threshold = assertCommitteeSigners(committeeKeyHashes, signers, params.threshold); // C-CLAIM-1

  const claimAddress = credentialToAddress(
    network,
    scriptHashToCredential(validatorToScriptHash(claimScript)),
  );

  const owner = normHex(ownerPkh);

  let txb = lucid.newTx();
  let newDatum: ClaimAccountDatum;
  let mode: "create" | "update";
  let outAssets: Record<string, bigint>;

  if (claimAccountUtxo) {
    // ── UPDATE path ────────────────────────────────────────────────
    mode = "update";
    if (!claimAccountUtxo.datum) {
      throw new Error("CLAIM-002: claimAccountUtxo has no inline datum");
    }
    const prev = decodeClaimAccountDatum(Data.from(claimAccountUtxo.datum));

    if (normHex(prev.owner) !== owner) {
      throw new Error(
        `CLAIM-003: ownerPkh mismatch — datum owner ${prev.owner} ≠ ${owner}`, // C-CLAIM-3
      );
    }

    newDatum = {
      owner:           prev.owner,                       // C-CLAIM-3
      entitlement:     prev.entitlement + amount,        // C-CLAIM-2
      redeemed:        prev.redeemed,                    // C-CLAIM-3 (unchanged)
      start_epoch:     prev.start_epoch,                 // C-CLAIM-3 (unchanged)
      drops_per_epoch: prev.drops_per_epoch,             // C-CLAIM-3 (unchanged)
    };

    // Bảo toàn TẤT CẢ assets (lovelace + bất kỳ dust) — chỉ datum đổi (C-VAL-0).
    outAssets = { ...claimAccountUtxo.assets };

    txb = txb
      .collectFrom([claimAccountUtxo], claimRedeemerToCbor(amount))
      .attach.SpendingValidator(claimScript);
  } else {
    // ── CREATE path ────────────────────────────────────────────────
    mode = "create";
    const accountLovelace = params.accountLovelace ?? DEFAULT_ACCOUNT_LOVELACE;
    newDatum = {
      owner,
      entitlement:     amount,
      redeemed:        0n,
      start_epoch:     currentEpoch,
      drops_per_epoch: params.dropsPerEpoch ?? DEFAULT_DROPS_PER_EPOCH,
    };
    outAssets = { lovelace: accountLovelace };
  }

  txb = txb.pay.ToAddressWithData(
    claimAddress,
    { kind: "inline", value: claimAccountDatumToCbor(newDatum) },
    outAssets,
  );

  for (const k of signers) txb = txb.addSignerKey(k);

  // validity_range lower_bound → validator get_epoch (CREATE start_epoch). Live tx bắt buộc.
  if (params.validFromMs !== undefined) {
    txb = txb.validFrom(Number(params.validFromMs));
  }

  const tx = await txb.complete();

  const summary = [
    `═══ Claim (${mode}) ═══`,
    `Owner:        ${owner}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oildrop)`,
    `Entitlement:  ${newDatum.entitlement} oildrop`,
    `Redeemed:     ${newDatum.redeemed} oildrop`,
    `Start epoch:  ${newDatum.start_epoch}  · drops/epoch ${newDatum.drops_per_epoch}`,
    `Committee:    ${signers.length}/${committeeKeyHashes.length} signers (need ${threshold})`,
    `Claim addr:   ${claimAddress}`,
  ].join("\n");

  return { tx, claimAddress, newDatum, mode, summary };
}
