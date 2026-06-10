// reserveDrawBuilder — dựng tx ReserveDraw PERMISSIONLESS.
//
// Bất kỳ ai dựng tx. KHÔNG ký authority. δ ép đúng bằng hàm release; recipient ép =
// địa chỉ tất định (recipientAddress = Treasury/sink). Validator reserve_meter +
// tlamp_mint (Genesis) ép mọi bất biến on-chain.
//
// Builder này dependency-inject Lucid (LucidEvolution) để test math/plan độc lập mạng.

import type { LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import { Constr, Data, getAddressDetails } from "@lucid-evolution/lucid";
import {
  reserveMeterRedeemerToData,
  reserveMeterToData,
  supplyStateToData,
} from "./datum.js";
import { planDraw, type DrawContext } from "./reserveMeter.js";
import type { ReserveMeter, SupplyState } from "./types.js";

export interface ReserveDrawParams {
  lucid:            LucidEvolution;
  /** UTxO mang ReserveMeter thread NFT (spend). */
  meterUtxo:        UTxO;
  meterDatum:       ReserveMeter;
  /** UTxO mang SupplyState SUPPLY NFT (spend qua supply_state validator). */
  supplyUtxo:       UTxO;
  supplyDatum:      SupplyState;
  /** UTxO ReservePolicy beacon (reference input). */
  policyRefUtxo:    UTxO;
  /** UTxO TreasuryFlowBeacon (reference input) — undefined nếu bypass. */
  flowRefUtxo?:     UTxO;
  /** δ oil muốn nhả (≤ maxDeltaNow). */
  delta:            bigint;
  /** Địa chỉ đích nhả (Treasury/sink) — KHÔNG ví trigger. Phải khớp recipient_lock param. */
  recipientAddress: string;
  /**
   * recipient_lock hash (hex) mà validator reserve_meter được tham số hoá. Builder ÉP
   * recipientAddress phải decode ra Script-cred KHỚP hash này — tránh dựng tx CHẮC
   * CHẮN FAIL on-chain (validator chỉ đếm tLAMP tại output có payment_credential is
   * Script(recipient_lock), bỏ qua nhánh VerificationKey).
   */
  recipientLockHash: string;
  meterScriptAddress: string;
  supplyScriptAddress: string;
  /** policy id + asset name (hex) tLAMP để mint. */
  tlampMintingPolicy: string;
  tlampAssetNameHex:  string;
  /** validator scripts (CBOR) đính cho spend/mint. */
  meterValidatorCbor:  string;
  supplyValidatorCbor: string;
  tlampMintCbor:       string;
  /** redeemer cho tlamp_mint ReserveDraw = Constr(1,[]). */
  supplyRedeemerData:  string; // Advance
  ctx:                 DrawContext;
}

/**
 * Dựng tx ReserveDraw. Tính route + meter out qua planDraw (ép C-8'/C-10'/C-12/C-14).
 * Trả về Lucid TxComplete chưa ký (permissionless — ký bởi bất kỳ ví trả phí).
 */
export async function buildReserveDrawTx(p: ReserveDrawParams) {
  // GUARD: recipientAddress phải là Script-cred khớp recipient_lock validator param.
  // Validator recipient_gets_delta CHỈ đếm tLAMP tại Script(recipient_lock); ví base/
  // enterprise (key-cred) → to_recipient=0 → tx fail toàn bộ. Bắt sớm ở builder.
  assertRecipientScriptLock(p.recipientAddress, p.recipientLockHash);

  const plan = planDraw(p.meterDatum, p.supplyDatum.reserve_minted, p.delta, p.ctx);

  const meterOut: ReserveMeter = plan.meterOut;
  const supplyOut: SupplyState = {
    ...p.supplyDatum,
    reserve_minted: plan.reserveMintedOut,
  };

  const tlampUnit = p.tlampMintingPolicy + p.tlampAssetNameHex;
  const meterRedeemer = reserveMeterRedeemerToData(plan.route);
  // tlamp_mint ReserveDraw redeemer = Constr(1,[]).
  const mintRedeemer = Data.to(new Constr(1, []));

  const refs = p.flowRefUtxo
    ? [p.policyRefUtxo, p.flowRefUtxo]
    : [p.policyRefUtxo];

  const meterNftUnit = extractNftUnit(p.meterUtxo);
  const supplyNftUnit = extractNftUnit(p.supplyUtxo);

  const tx = p.lucid
    .newTx()
    .collectFrom([p.meterUtxo], meterRedeemer)
    .collectFrom([p.supplyUtxo], p.supplyRedeemerData)
    .readFrom(refs)
    .attach.SpendingValidator({ type: "PlutusV3", script: p.meterValidatorCbor })
    .attach.SpendingValidator({ type: "PlutusV3", script: p.supplyValidatorCbor })
    .attach.MintingPolicy({ type: "PlutusV3", script: p.tlampMintCbor })
    .mintAssets({ [tlampUnit]: p.delta }, mintRedeemer)
    // meter continuing output (thread NFT + ada)
    .pay.ToContract(
      p.meterScriptAddress,
      { kind: "inline", value: reserveMeterToData(meterOut) },
      { [meterNftUnit]: 1n },
    )
    // SupplyState continuing output (SUPPLY NFT + ada, reserve_minted += δ)
    .pay.ToContract(
      p.supplyScriptAddress,
      { kind: "inline", value: supplyStateToData(supplyOut) },
      { [supplyNftUnit]: 1n },
    )
    // recipient nhận δ tLAMP (địa chỉ tất định)
    .pay.ToAddress(p.recipientAddress, { [tlampUnit]: p.delta });

  return { tx, plan, meterOut, supplyOut };
}

/**
 * Ép recipientAddress decode ra Script-cred khớp recipientLockHash (hex).
 * Throw nếu address là key-cred (base/enterprise) hoặc hash không khớp — tránh
 * dựng tx chắc-chắn-fail ở validator (recipient_gets_delta chỉ nhận Script(lock)).
 */
export function assertRecipientScriptLock(
  recipientAddress: string,
  recipientLockHash: string,
): void {
  const details = getAddressDetails(recipientAddress);
  const cred = details.paymentCredential;
  if (!cred) {
    throw new Error("RDB-010: recipientAddress không decode được payment credential");
  }
  if (cred.type !== "Script") {
    throw new Error(
      `RDB-011: recipientAddress phải là Script-cred (validator bỏ qua VerificationKey); nhận type=${cred.type}`,
    );
  }
  const want = recipientLockHash.toLowerCase();
  const got = cred.hash.toLowerCase();
  if (got !== want) {
    throw new Error(
      `RDB-012: recipientAddress script hash ${got} ≠ recipient_lock ${want} (validator)`,
    );
  }
}

/** Lấy unit (policy+name) của NFT thread trong UTxO (phần value ≠ lovelace, qty 1). */
function extractNftUnit(utxo: UTxO): string {
  for (const [unit, qty] of Object.entries(utxo.assets)) {
    if (unit !== "lovelace" && qty === 1n) return unit;
  }
  throw new Error("RDB-000: no thread NFT (qty=1) found in utxo");
}
