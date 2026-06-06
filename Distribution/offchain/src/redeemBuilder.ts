// LampDistribution redeemBuilder — user redeem LAMP đã vested (CONTRACT v2 §4).
//
// Tất định, permissionless: account tự tính vested on-chain, không proof/committee.
//
// Input:
//   - ClaimAccount UTxO (của owner) — spend với Redeem redeemer (Constr 1, no fields).
//   - Treasury UTxO (giữ LAMP pool) — spend với ReleaseForRedeem redeemer.
// Reference input:
//   - DropParam beacon UTxO (read-only) — cung cấp D (drop_value).
// Output:
//   - ClaimAccount': redeemed' = redeemed + amount; field khác bất biến.
//   - Treasury': LAMP giảm đúng `amount`; committee_hash + dust bảo toàn.
//   - User: nhận đúng `amount` LAMP.
//
//   vested  = min(E, D · drops_per_epoch · max(0, current_epoch − start_epoch))
//   amount  = vested − redeemed   (yêu cầu > 0)
//
// Invariants (CONTRACT §4/§7):
//   C-RDM-1  amount = vested − redeemed > 0.
//   C-RDM-2  vested ≤ entitlement (cap E — đã bảo đảm bởi vested()).
//   C-RDM-3  user nhận đúng `amount` LAMP.
//   C-RDM-4  out.redeemed == redeemed + amount; field khác unchanged.
//   C-RDM-6  owner signs.
//   C-TRE-1  treasury_out.value = treasury_in.value − amount (bảo toàn, không burn).
//   C-TRE-2  treasury datum (committee_hash) bảo toàn.
//   C-MINT-0 tx.mint == 0.
//   C-VAL-0  mọi assets khác bảo toàn (audit dust lesson — không drop token nào).

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/protocol-utils";

import type { ClaimAccountDatum, TreasuryDatum } from "./types.js";
import {
  decodeClaimAccountDatum, decodeBeaconDatum,
  claimAccountDatumToCbor, redeemRedeemerToCbor,
  decodeTreasuryDatum, treasuryDatumToCbor, treasuryRedeemerToCbor,
} from "./datum.js";
import { vested } from "./vested.js";

const DEFAULT_LAMP_ASSET_NAME = "4c414d50"; // "LAMP"

/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface RedeemParams {
  lucid:        LucidEvolution;
  network:      Network;

  /** ClaimAccount UTxO của owner (inline datum bắt buộc). */
  claimAccountUtxo: UTxO;
  claimScript:      Validator;

  /** Treasury UTxO giữ LAMP pool (inline datum bắt buộc). */
  treasuryUtxo:     UTxO;
  treasuryScript:   Validator;

  /**
   * DropParam beacon UTxO — dùng làm REFERENCE input (read-only).
   * Datum phải là BeaconDatum{kind: DropParam}; cung cấp D = drop_value.
   */
  dropBeaconUtxo:   UTxO;

  /**
   * Epoch hiện tại t (caller tính off-chain từ validity range).
   * Validator đọc current_epoch từ validity_range → truyền `validFromMs` để khớp.
   */
  currentEpoch:     bigint;

  /**
   * POSIX ms cho lower_bound validity_range (BẮT BUỘC live tx).
   * Validator get_epoch đọc lower_bound = current_epoch · ms_per_epoch.
   * Bỏ trống → KHÔNG set (chỉ unit test off-chain; live sẽ fail get_epoch).
   */
  validFromMs?:     bigint;

  /** LAMP policy + asset-name. */
  lampPolicyId:   string;
  lampAssetName?: string;

  /** Nơi nhận LAMP redeem. Mặc định = ví owner (lucid wallet). */
  destinationAddress?: string;
}

export interface RedeemResult {
  tx:            TxSignBuilder;
  amount:        bigint;     // released = vested − redeemed
  vested:        bigint;     // vested(t) đã tính
  newClaimDatum: ClaimAccountDatum;
  treasuryAfter: bigint;     // LAMP còn lại trên treasury output
  summary:       string;
}

export async function buildRedeemTx(params: RedeemParams): Promise<RedeemResult> {
  const {
    lucid, network, claimAccountUtxo, claimScript,
    treasuryUtxo, treasuryScript, dropBeaconUtxo,
    currentEpoch, lampPolicyId,
  } = params;
  const lampAssetName = params.lampAssetName ?? DEFAULT_LAMP_ASSET_NAME;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);

  // ── Decode ClaimAccount datum ──────────────────────────────────────
  if (!claimAccountUtxo.datum) throw new Error("REDEEM-001: claimAccountUtxo has no inline datum");
  const claim = decodeClaimAccountDatum(Data.from(claimAccountUtxo.datum));
  const owner = normHex(claim.owner);

  // ── Đọc D từ DropParam beacon (reference input) ────────────────────
  if (!dropBeaconUtxo.datum) throw new Error("REDEEM-004: dropBeaconUtxo has no inline datum");
  const beacon = decodeBeaconDatum(Data.from(dropBeaconUtxo.datum));
  if (beacon.kind !== "DropParam") {
    throw new Error(`REDEEM-005: beacon kind must be DropParam, got ${beacon.kind}`);
  }
  const D = beacon.drop_value;

  // ── vested(t) = min(E, D · dpe · max(0, t − t0)); amount = vested − redeemed ──
  const vestedNow = vested(
    claim.entitlement, D, claim.drops_per_epoch, claim.start_epoch, currentEpoch,
  );                                                                // C-RDM-2
  const amount = vestedNow - claim.redeemed;                        // C-RDM-1
  if (amount <= 0n) {
    throw new Error(
      `REDEEM-002: redeemable ≤ 0 (vested=${vestedNow}, redeemed=${claim.redeemed}). ` +
      `Chưa tới epoch mở khoá thêm, hoặc đã redeem hết phần vested.`,
    );
  }

  // ── Decode Treasury datum + đảm bảo đủ LAMP (C-TRE-1) ──────────────
  if (!treasuryUtxo.datum) throw new Error("REDEEM-011: treasuryUtxo has no inline datum");
  const treasury: TreasuryDatum = decodeTreasuryDatum(Data.from(treasuryUtxo.datum));
  const treasuryLamp = treasuryUtxo.assets[lampUnit] ?? 0n;
  if (treasuryLamp < amount) {
    throw new Error(
      `REDEEM-012: treasury UTxO chỉ có ${treasuryLamp} oil LAMP < amount ${amount}. ` +
      `Chọn treasury UTxO khác hoặc tách.`,
    );
  }

  // ── Addresses ──────────────────────────────────────────────────────
  const claimAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(claimScript)),
  );
  const treasuryAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(treasuryScript)),
  );
  const destination = params.destinationAddress ?? (await lucid.wallet().address());

  // ── Output datums ──────────────────────────────────────────────────
  // ClaimAccount': redeemed' = redeemed + amount; field khác unchanged (C-RDM-4).
  const newClaimDatum: ClaimAccountDatum = {
    owner:           claim.owner,
    entitlement:     claim.entitlement,
    redeemed:        claim.redeemed + amount,        // C-RDM-4
    start_epoch:     claim.start_epoch,
    drops_per_epoch: claim.drops_per_epoch,
  };
  // Treasury': datum bảo toàn (C-TRE-2).
  const newTreasuryDatum: TreasuryDatum = { committee_hash: treasury.committee_hash };

  // ── Output assets: bảo toàn TẤT CẢ (audit dust lesson, C-VAL-0) ────
  // ClaimAccount: chỉ datum đổi → clone toàn bộ assets.
  const claimOutAssets: Record<string, bigint> = { ...claimAccountUtxo.assets };

  // Treasury: clone toàn bộ rồi trừ đúng `amount` LAMP (giữ lovelace + dust).
  const treasuryOutAssets: Record<string, bigint> = { ...treasuryUtxo.assets };
  const treasuryAfter = treasuryLamp - amount;
  if (treasuryAfter > 0n) treasuryOutAssets[lampUnit] = treasuryAfter;
  else delete treasuryOutAssets[lampUnit];          // hết LAMP → bỏ unit, giữ lovelace+dust

  // ── Redeemers ──────────────────────────────────────────────────────
  const claimRedeemer    = redeemRedeemerToCbor();   // Constr(1, [])
  const treasuryRedeemer = treasuryRedeemerToCbor();

  // ── Build tx ───────────────────────────────────────────────────────
  let txb = lucid
    .newTx()
    .collectFrom([claimAccountUtxo], claimRedeemer)
    .attach.SpendingValidator(claimScript)
    .collectFrom([treasuryUtxo], treasuryRedeemer)
    .attach.SpendingValidator(treasuryScript)
    .readFrom([dropBeaconUtxo])                       // reference input (read-only)
    .pay.ToAddressWithData(
      claimAddress,
      { kind: "inline", value: claimAccountDatumToCbor(newClaimDatum) },
      claimOutAssets,
    )
    .pay.ToAddressWithData(
      treasuryAddress,
      { kind: "inline", value: treasuryDatumToCbor(newTreasuryDatum) },
      treasuryOutAssets,
    )
    .pay.ToAddress(destination, { [lampUnit]: amount })   // C-RDM-3: user nhận đúng amount
    .addSignerKey(owner);                            // C-RDM-6: owner signs

  // validity_range lower_bound → validator get_epoch khớp currentEpoch.
  if (params.validFromMs !== undefined) {
    txb = txb.validFrom(Number(params.validFromMs));
  }

  const tx = await txb.complete();

  const summary = [
    `═══ Redeem (Capped Drop) ═══`,
    `Owner:          ${owner}`,
    `Entitlement E:  ${claim.entitlement} oil`,
    `Redeemed before:${claim.redeemed} oil`,
    `Drop value D:   ${D} oil  · drops/epoch ${claim.drops_per_epoch}`,
    `Epoch:          t0=${claim.start_epoch} → t=${currentEpoch}`,
    `Vested(t):      ${vestedNow} oil`,
    `Amount:         ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Treasury LAMP:  ${treasuryLamp} → ${treasuryAfter} oil`,
    `Destination:    ${destination}`,
  ].join("\n");

  return { tx, amount, vested: vestedNow, newClaimDatum, treasuryAfter, summary };
}
