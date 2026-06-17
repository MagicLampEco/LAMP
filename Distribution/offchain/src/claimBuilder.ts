// LampDistribution claimBuilder — committee 2/3 confirm → tạo/cập nhật ClaimAccount.
// CONTRACT v2 "Capped Drop": Claim cấp/tăng entitlement E (committee confirm activity).
//
//   CREATE: account chưa có → datum {owner, entitlement=amount, redeemed=0,
//           start_epoch=current, drops_per_epoch}.
//   UPDATE: account đã có → entitlement += amount; redeemed/start_epoch/dpe bất biến.
//
// SOLVENCY ON-CHAIN (C-SOLV-*): MỌI Claim PHẢI co-spend treasury UTxO (GrantEntitlement):
//   treasury.cumulative_entitlement += amount, ép cumulative_entitlement ≤ pool LAMP.
//   → bất biến global Σ(E−redeemed) ≤ pool ép được PER-TX qua sổ cái singleton (NFT "TRSY").
//   Đây thay thế chốt off-chain assertClaimSolvency (vẫn giữ làm pre-flight cảnh báo sớm).
//
// Invariants:
//   C-CLAIM-1  ≥ ⌈2N/3⌉ committee signatures.
//   C-CLAIM-2  out.entitlement = in.entitlement + amount; amount > 0.
//   C-CLAIM-3  out.owner == in.owner; redeemed/start_epoch/drops_per_epoch unchanged.
//   C-SOLV-1   treasury.cumulative_entitlement_out = cum_in + amount (co-spend bắt buộc).
//   C-SOLV-2   cumulative_entitlement_out ≤ treasury pool LAMP (ép on-chain ở treasury).
//   C-MINT-0   tx.mint == 0 (builder không gọi .mintAssets).
//   C-VAL-0    assets bảo toàn (lovelace + dust) — chỉ datum đổi; treasury pool bất biến.

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@lucid-evolution/lucid";

import type { ClaimAccountDatum, TreasuryDatum } from "./types.js";
import {
  claimAccountDatumToCbor, claimRedeemerToCbor, decodeClaimAccountDatum,
  decodeTreasuryDatum, treasuryDatumToCbor, grantEntitlementRedeemerToCbor,
} from "./datum.js";
import { assertCommitteeSigners } from "./committee.js";
import { DEFAULT_DROPS_PER_EPOCH, TREASURY_NFT_ASSET_NAME } from "./constants.js";

export interface ClaimParams {
  lucid:        LucidEvolution;
  /** Applied claim_account validator (định nghĩa script address). */
  claimScript:  Validator;
  network:      Network;

  /** PKH chủ ví (hex 28-byte) được committee xác nhận. */
  ownerPkh:     string;
  /** Số oil entitlement cấp thêm lần này (> 0). */
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

  /**
   * TREASURY CO-SPEND (BẮT BUỘC on-chain solvency, C-SOLV-*). Mọi Claim spend treasury
   * UTxO với GrantEntitlement: cumulative_entitlement += amount, pool LAMP bất biến.
   * Treasury validator ép cumulative_entitlement ≤ pool → over-grant vượt quỹ FAIL on-chain.
   * Bỏ trống CHỈ cho unit test off-chain thuần (live tx KHÔNG validate được nếu thiếu).
   */
  treasury?: {
    /** Treasury UTxO hiện tại (mang NFT "TRSY", inline TreasuryDatum). */
    utxo:        UTxO;
    /** Applied treasury validator (định nghĩa treasury address). */
    script:      Validator;
    /** Treasury authenticity NFT policy id (compile-time param). */
    nftPolicy:   string;
    /** NFT asset-name hex; mặc định "TRSY". */
    nftAssetName?: string;
  };

  /** Danh sách committee key-hash (hex). */
  committeeKeyHashes: string[];
  threshold?:        number;
  signerKeyHashes?:  string[];

  /**
   * SOLVENCY GUARD (over-collateralization) — chặn committee cấp E vượt quỹ.
   * Khi cung cấp `solvency`, builder ép `Σ(entitlement − redeemed) sau Claim ≤ treasuryLamp`.
   * Đây là chốt off-chain pre-flight TẠI LÚC cấp E (cảnh báo sớm, mạnh hơn REDEEM-012
   * vốn chỉ chặn lúc redeem). KHÔNG còn là chốt duy nhất: on-chain treasury validator
   * ĐÃ ép cumulative_entitlement ≤ pool (C-SOLV-2) qua treasury co-spend bắt buộc.
   */
  solvency?: {
    /** LAMP (oil) hiện có trong treasury pool. */
    treasuryLamp: bigint;
    /**
     * Tổng (entitlement − redeemed) của MỌI ClaimAccount ĐANG MỞ KHÁC (không gồm
     * account đang Claim này — account đó tính lại từ amount + datum cũ). oil.
     */
    otherOutstanding: bigint;
  };

  /**
   * POSIX ms cho lower_bound validity_range (BẮT BUỘC live tx CREATE: validator
   * get_epoch đọc lower_bound → start_epoch). Bỏ trống → KHÔNG set (unit test off-chain).
   */
  validFromMs?: bigint;
}

export interface ClaimResult {
  tx:               TxSignBuilder;
  claimAddress:     string;
  newDatum:         ClaimAccountDatum;
  mode:             "create" | "update";
  /** Treasury datum mới (cumulative_entitlement += amount) — chỉ khi co-spend treasury. */
  newTreasuryDatum?: TreasuryDatum | undefined;
  summary:          string;
}

const DEFAULT_ACCOUNT_LOVELACE = 2_000_000n;

/** Strip leading 0x + lowercase (so sánh owner). */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

/**
 * Over-collateralization invariant (off-chain, lúc cấp E):
 *   Σ(entitlement − redeemed) toàn hệ thống SAU Claim ≤ treasuryLamp.
 * `thisOutstandingAfter` = entitlement_after − redeemed của account đang Claim.
 * Ném CLAIM-010 nếu vi phạm. Pure → unit-testable.
 */
export function assertClaimSolvency(
  treasuryLamp: bigint,
  otherOutstanding: bigint,
  thisOutstandingAfter: bigint,
): void {
  const totalOutstanding = otherOutstanding + thisOutstandingAfter;
  if (totalOutstanding > treasuryLamp) {
    throw new Error(
      `CLAIM-010: solvency — Σ(entitlement−redeemed) sau Claim = ${totalOutstanding} oil ` +
      `> treasury ${treasuryLamp} oil. Cấp E vượt quỹ (under-collateralized). ` +
      `Fund thêm treasury ≥ ${totalOutstanding} oil TRƯỚC khi Claim, hoặc giảm amount.`,
    );
  }
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

  // SOLVENCY GUARD (off-chain pre-flight, over-collateralization) — cảnh báo sớm.
  // KHÔNG còn là chốt duy nhất: on-chain treasury validator ép cum ≤ pool (C-SOLV-2).
  if (params.solvency) {
    const thisOutstandingAfter = newDatum.entitlement - newDatum.redeemed;
    assertClaimSolvency(
      params.solvency.treasuryLamp,
      params.solvency.otherOutstanding,
      thisOutstandingAfter,
    );
  }

  txb = txb.pay.ToAddressWithData(
    claimAddress,
    { kind: "inline", value: claimAccountDatumToCbor(newDatum) },
    outAssets,
  );

  // ── TREASURY CO-SPEND (C-SOLV-1/2): cumulative_entitlement += amount ≤ pool ───
  let newTreasuryDatum: TreasuryDatum | undefined;
  if (params.treasury) {
    const t = params.treasury;
    if (!t.utxo.datum) throw new Error("CLAIM-020: treasury.utxo has no inline datum");
    const treasuryAddress = credentialToAddress(
      network, scriptHashToCredential(validatorToScriptHash(t.script)),
    );
    const prevTreasury = decodeTreasuryDatum(Data.from(t.utxo.datum));

    // Authenticity: treasury UTxO PHẢI mang đúng 1 NFT "TRSY" (chống treasury giả).
    const nftUnit = toUnit(t.nftPolicy, t.nftAssetName ?? TREASURY_NFT_ASSET_NAME);
    const nftQty = t.utxo.assets[nftUnit] ?? 0n;
    if (nftQty !== 1n) {
      throw new Error(
        `CLAIM-021: treasury UTxO phải giữ đúng 1 NFT authenticity (${nftUnit}); got ${nftQty}`,
      );
    }

    newTreasuryDatum = {
      committee_hash:         prevTreasury.committee_hash,                       // C-TRE-2
      cumulative_entitlement: prevTreasury.cumulative_entitlement + amount,      // C-SOLV-1
    };

    // C-SOLV-2: on-chain treasury validator ép cum_out ≤ pool LAMP (over-grant → fail).
    // Pool LAMP + mọi asset BẤT BIẾN khi grant (chỉ datum đổi) — C-VAL-0.
    const treasuryOutAssets: Record<string, bigint> = { ...t.utxo.assets };

    txb = txb
      .collectFrom([t.utxo], grantEntitlementRedeemerToCbor())
      .attach.SpendingValidator(t.script)
      .pay.ToAddressWithData(
        treasuryAddress,
        { kind: "inline", value: treasuryDatumToCbor(newTreasuryDatum) },
        treasuryOutAssets,
      );
  }

  for (const k of signers) txb = txb.addSignerKey(k);

  // validity_range lower_bound → validator get_epoch (CREATE start_epoch). Live tx bắt buộc.
  if (params.validFromMs !== undefined) {
    txb = txb.validFrom(Number(params.validFromMs));
  }

  const tx = await txb.complete();

  const summary = [
    `═══ Claim (${mode}) ═══`,
    `Owner:        ${owner}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Entitlement:  ${newDatum.entitlement} oil`,
    `Redeemed:     ${newDatum.redeemed} oil`,
    `Start epoch:  ${newDatum.start_epoch}  · drops/epoch ${newDatum.drops_per_epoch}`,
    `Committee:    ${signers.length}/${committeeKeyHashes.length} signers (need ${threshold})`,
    `Cumulative E: ${newTreasuryDatum ? `${newTreasuryDatum.cumulative_entitlement} oil (treasury co-spend)` : "(off-chain only — no treasury co-spend)"}`,
    `Claim addr:   ${claimAddress}`,
  ].join("\n");

  return { tx, claimAddress, newDatum, mode, newTreasuryDatum, summary };
}
