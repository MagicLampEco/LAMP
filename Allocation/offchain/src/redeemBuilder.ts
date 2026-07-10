// LAMP Allocation redeemBuilder — user redeem LAMP đã vested (permissionless, tất định).
//
// CO-SPEND 2 UTxO cùng kênh trong CÙNG tx (claim_account ↔ treasury con):
//   IN  ClaimAccount (Redeem)            → redeemed += amount; field khác bất biến.
//   IN  Treasury con (ReleaseForRedeem)  → LAMP giảm ĐÚNG amount; datum (committee+channel) bất biến.
//   OUT ClaimAccount' (cùng addr, value == in) + Treasury' (cùng addr, LAMP -= amount).
//   OUT User nhận ĐÚNG amount LAMP (claim_account: lamp_to_owner ≥ amount).
//   SIGN owner (datum.owner). KHÔNG cần committee.
//   tx.mint == 0.
//
//   vested  = min(E, D · drops_per_epoch · max(0, current_epoch − start_epoch))
//   amount  = vested − redeemed   (yêu cầu > 0)
//
// D (drop_value) là COMPILE-TIME param của claim_account (KHÔNG beacon ref input).
// Caller PHẢI truyền đúng D đã bake vào validator (`dropValue`).
//
// EPOCH TỰ SUY (F1+F2): caller truyền `validFromMs` (lower_bound POSIX ms) + `msPerEpoch`
//   (= ms_per_epoch đã bake vào claim_account). current_epoch = floor(validFromMs/msPerEpoch)
//   — ĐÚNG byte-perfect get_epoch on-chain → out.redeemed LUÔN khớp, KHÔNG thể lệch epoch.
//   validFromMs BẮT BUỘC + .validFrom() LUÔN set (lower_bound Finite) → get_epoch không fail cứng.
//
// Invariants (khớp claim_account.ak Redeem + treasury.ak):
//   C-RDM-1  amount = vested − redeemed > 0.
//   C-RDM-2  vested ≤ E (cap — bảo đảm bởi vested()).
//   C-RDM-3  user nhận đúng amount LAMP.
//   C-RDM-4  out.redeemed = redeemed + amount; owner/E/start/dpe/channel bất biến.
//   C-RDM-5  account.channel_id == treasury.channel_id (cùng kênh — Lớp B).
//   C-TRE-1  treasury_out.value = treasury_in.value − amount LAMP (bảo toàn, no-burn).
//   C-TRE-2  treasury datum (committee_hash + channel_id) bảo toàn.
//   C-RDM-6  owner signs.   C-MINT-0  tx.mint == 0.   C-VAL-0  assets khác bảo toàn.

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type Network, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import type { ClaimAccountDatum, TreasuryDatum } from "./types.js";
import {
  decodeClaimAccountDatum, decodeTreasuryDatum,
  claimAccountDatumToCbor, treasuryDatumToCbor,
  redeemRedeemerToCbor, treasuryRedeemerToCbor,
} from "./datum.js";
import { vested } from "./math.js";
import { LAMP_NAME, DEFAULT_MIN_ADA } from "./constants.js";

/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface RedeemParams {
  lucid:        LucidEvolution;
  network:      Network;

  /** ClaimAccount UTxO của owner (inline datum bắt buộc) — spend Redeem. */
  claimAccountUtxo: UTxO;
  claimScript:      Validator;

  /** Treasury con CÙNG kênh giữ LAMP pool (inline datum bắt buộc) — spend ReleaseForRedeem. */
  treasuryUtxo:     UTxO;
  treasuryScript:   Validator;

  /** D (drop_value, oil/drop·epoch) — COMPILE-TIME param của claim_account validator. */
  dropValue:        bigint;

  /**
   * ms mỗi epoch — PHẢI KHỚP `ms_per_epoch` đã bake vào claim_account validator.
   * On-chain: get_epoch = lower_bound / ms_per_epoch (floor). Dùng để TỰ SUY currentEpoch.
   */
  msPerEpoch:       bigint;

  /**
   * POSIX ms cho lower_bound validity_range — BẮT BUỘC.
   * On-chain get_epoch đọc lower_bound (Finite); nếu vô hạn → fail cứng.
   * currentEpoch TỰ SUY = floor(validFromMs / msPerEpoch) → loại lệch epoch off↔on-chain (F1+F2).
   */
  validFromMs:      bigint;

  /** LAMP policy + asset-name (mặc định "LAMP"). */
  lampPolicyId:   string;
  lampAssetName?: string;

  /** Nơi nhận LAMP redeem. Mặc định = ví owner (lucid wallet). */
  destinationAddress?: string;
}

export interface RedeemResult {
  tx:            TxSignBuilder;
  amount:        bigint;     // released = vested − redeemed
  vested:        bigint;
  newClaimDatum: ClaimAccountDatum;
  treasuryAfter: bigint;     // LAMP còn lại trên treasury output
  summary:       string;
}

export async function buildRedeemTx(params: RedeemParams): Promise<RedeemResult> {
  const {
    lucid, network, claimAccountUtxo, claimScript,
    treasuryUtxo, treasuryScript, dropValue, msPerEpoch, validFromMs, lampPolicyId,
  } = params;
  const lampAssetName = params.lampAssetName ?? LAMP_NAME;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);

  // ── F1+F2: epoch TỰ SUY từ validFromMs — ĐÚNG byte-perfect get_epoch on-chain ──
  // On-chain: current_epoch = get_epoch(tx, ms_per_epoch) = lower_bound / ms_per_epoch (floor).
  // Tự suy ở đây (thay vì nhận currentEpoch rời) → out.redeemed LUÔN khớp on-chain.
  if (msPerEpoch <= 0n) throw new Error(`REDEEM-003: msPerEpoch must be > 0 (got ${msPerEpoch})`);
  if (validFromMs < 0n) throw new Error(`REDEEM-004: validFromMs must be ≥ 0 (got ${validFromMs})`);
  const currentEpoch = validFromMs / msPerEpoch;   // BigInt floor (mirror get_epoch)

  // ── Decode ClaimAccount ────────────────────────────────────────────
  if (!claimAccountUtxo.datum) throw new Error("REDEEM-001: claimAccountUtxo has no inline datum");
  const claim = decodeClaimAccountDatum(Data.from(claimAccountUtxo.datum));
  const owner = normHex(claim.owner);

  // ── vested(t) = min(E, D·dpe·max(0,t−t0)); amount = vested − redeemed ──
  const vestedNow = vested(
    claim.entitlement, dropValue, claim.drops_per_epoch, claim.start_epoch, currentEpoch,
  );                                                                // C-RDM-2
  const amount = vestedNow - claim.redeemed;                        // C-RDM-1
  if (amount <= 0n) {
    throw new Error(
      `REDEEM-002: redeemable ≤ 0 (vested=${vestedNow}, redeemed=${claim.redeemed}). ` +
      `Chưa tới epoch mở khoá thêm, hoặc đã redeem hết phần vested.`,
    );
  }

  // ── Decode Treasury + check cùng kênh + đủ LAMP ────────────────────
  if (!treasuryUtxo.datum) throw new Error("REDEEM-011: treasuryUtxo has no inline datum");
  const treasury: TreasuryDatum = decodeTreasuryDatum(Data.from(treasuryUtxo.datum));

  // C-RDM-5: cùng kênh (treasury.ak ép ca.channel_id == datum.channel_id).
  if (normHex(claim.channel_id) !== normHex(treasury.channel_id)) {
    throw new Error(
      `REDEEM-013: channel mismatch — account ${claim.channel_id} ≠ treasury ${treasury.channel_id}`,
    );
  }

  const treasuryLamp = treasuryUtxo.assets[lampUnit] ?? 0n;
  if (treasuryLamp < amount) {
    throw new Error(
      `REDEEM-012: treasury con chỉ có ${treasuryLamp} oil LAMP < amount ${amount} ` +
      `(Lớp B vật lý: hết ngân sách kênh).`,
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
  // ClaimAccount': redeemed += amount; field khác bất biến (C-RDM-4).
  const newClaimDatum: ClaimAccountDatum = {
    owner:           claim.owner,
    entitlement:     claim.entitlement,
    redeemed:        claim.redeemed + amount,        // C-RDM-4
    start_epoch:     claim.start_epoch,
    drops_per_epoch: claim.drops_per_epoch,
    channel_id:      claim.channel_id,
  };
  // Treasury': datum bảo toàn (committee_hash + channel_id) (C-TRE-2).
  const newTreasuryDatum: TreasuryDatum = {
    committee_hash: treasury.committee_hash,
    channel_id:     treasury.channel_id,
  };

  // ── Output assets: bảo toàn TẤT CẢ (C-VAL-0) ───────────────────────
  const claimOutAssets: Record<string, bigint> = { ...claimAccountUtxo.assets };

  // Treasury: clone toàn bộ rồi trừ ĐÚNG amount LAMP (giữ lovelace + dust) (C-TRE-1).
  const treasuryOutAssets: Record<string, bigint> = { ...treasuryUtxo.assets };
  const treasuryAfter = treasuryLamp - amount;
  if (treasuryAfter > 0n) treasuryOutAssets[lampUnit] = treasuryAfter;
  else delete treasuryOutAssets[lampUnit];

  // ── Build tx (co-spend account + treasury) ─────────────────────────
  const txb = lucid
    .newTx()
    .collectFrom([claimAccountUtxo], redeemRedeemerToCbor())     // Constr(1, [])
    .attach.SpendingValidator(claimScript)
    .collectFrom([treasuryUtxo], treasuryRedeemerToCbor())
    .attach.SpendingValidator(treasuryScript)
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
    // F4: output native-asset BẮT BUỘC kèm min-ADA. Thêm tường minh để an toàn
    // (không phụ thuộc auto-bù của lucid). Ví owner phải đủ ADA bù khoản này.
    .pay.ToAddress(destination, { lovelace: DEFAULT_MIN_ADA, [lampUnit]: amount }) // C-RDM-3
    .addSignerKey(owner)                                          // C-RDM-6
    // F2: LUÔN set lower_bound Finite → on-chain get_epoch không fail cứng (vô hạn).
    .validFrom(Number(validFromMs));

  const tx = await txb.complete();

  const summary = [
    `═══ Redeem (Capped Drop · treasury con kênh) ═══`,
    `Owner:          ${owner}`,
    `Channel:        ${normHex(claim.channel_id)}`,
    `Entitlement E:  ${claim.entitlement} oil`,
    `Redeemed:       ${claim.redeemed} → ${newClaimDatum.redeemed} oil`,
    `Drop value D:   ${dropValue} oil  · drops/epoch ${claim.drops_per_epoch}`,
    `Epoch:          t0=${claim.start_epoch} → t=${currentEpoch}`,
    `Vested(t):      ${vestedNow} oil`,
    `Amount:         ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Treasury LAMP:  ${treasuryLamp} → ${treasuryAfter} oil`,
    `Destination:    ${destination}`,
  ].join("\n");

  return { tx, amount, vested: vestedNow, newClaimDatum, treasuryAfter, summary };
}
