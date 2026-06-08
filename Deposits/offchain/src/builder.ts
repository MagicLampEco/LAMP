// Deposits builder — dựng tx Deposit / Refund (CONTRACT; deposits.ak).
//
// Deposit: depositor cấp `amount` từ ví → pot output value = pot_in ⊕ amount; sổ thêm/
//   cộng dồn dòng (entity,depositor,asset). depositor PHẢI ký.
// Refund: trả TRỌN số dư dòng về depositor; sổ XÓA dòng; pot output value = pot_in ⊖ amount.
//   authority: depositor ký HOẶC lifecycle_authority thỏa.
//
// Builder tự kiểm bất biến onchain trước khi dựng tx (fail-fast — tránh phí submit hỏng).

import {
  Data, credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder, type Assets,
} from "@lucid-evolution/lucid";
import type { Network } from "@lucid-evolution/lucid";

import type { DepositLine, PotDatum } from "./types.js";
import { decodePotDatum, potDatumToCbor, depositsRedeemerToCbor } from "./datum.js";
import {
  type AssetMap, assetAccepted, findLine, lineAmount,
  planDepositLedger, applyDepositValue, depositLedgerOk, depositValueOk,
  planRefundLedger, applyRefundValue, refundLedgerOk, refundValueOk,
} from "./ledger.js";

// ── Cầu nối Value: lucid Assets ↔ AssetMap ──

export function assetsToMap(a: Assets): AssetMap {
  const out: AssetMap = {};
  for (const [unit, amt] of Object.entries(a)) {
    const k = unit === "lovelace" ? "|" : `${unit.slice(0, 56).toLowerCase()}|${unit.slice(56).toLowerCase()}`;
    out[k] = (out[k] ?? 0n) + amt;
  }
  return out;
}

export function mapToAssets(m: AssetMap): Assets {
  const out: Assets = {};
  for (const [k, amt] of Object.entries(m)) {
    if (amt === 0n) continue;
    const [policy, name] = k.split("|");
    const unit = policy === "" ? "lovelace" : `${policy}${name ?? ""}`;
    out[unit] = amt;
  }
  return out;
}

// ════════════════════════════════════════════════════════════
// DEPOSIT
// ════════════════════════════════════════════════════════════

export interface DepositParams {
  lucid:   LucidEvolution;
  network: Network;
  potUtxo:    UTxO;       // pot UTxO (inline PotDatum)
  potScript:  Validator;
  entityId:   string;     // hex
  depositor:  string;     // hex pkh — PHẢI là ví đang ký tx
  policy:     string;     // hex asset (LAMP); "" cho ADA
  name:       string;     // hex
  amount:     bigint;     // > 0 (oil; 1 LAMP = 10^6)
  newEpoch?:  bigint;
}

export interface DepositResult {
  tx:        TxSignBuilder;
  newDatum:  PotDatum;
  potAfter:  AssetMap;
  summary:   string;
}

/** Plan thuần (không lucid) — test trực tiếp + tự kiểm bất biến. */
export function planDeposit(
  datum: PotDatum, valueIn: AssetMap,
  entityId: string, depositor: string, policy: string, name: string, amount: bigint, newEpoch?: bigint,
): { newDatum: PotDatum; potAfter: AssetMap } {
  if (amount <= 0n) throw new Error(`DEP-001: amount phải > 0 (got ${amount})`);
  if (!assetAccepted(policy, name, datum.accepted_assets)) {
    throw new Error("DEP-002: asset ∉ accepted_assets");
  }
  const epoch = newEpoch ?? datum.epoch;
  if (epoch < datum.epoch) throw new Error(`DEP-003: epoch lùi (${epoch} < ${datum.epoch})`);

  const ledgerOut = planDepositLedger(datum.ledger, entityId, depositor, policy, name, amount, epoch);
  const potAfter = applyDepositValue(valueIn, policy, name, amount);
  const newDatum: PotDatum = { ...datum, ledger: ledgerOut, epoch };

  if (!depositLedgerOk(datum.ledger, ledgerOut, entityId, depositor, policy, name, amount)) {
    throw new Error("DEP-004: ledger_out vi phạm deposit_ledger_ok");
  }
  if (!depositValueOk(valueIn, potAfter, policy, name, amount)) {
    throw new Error("DEP-005: value_out vi phạm deposit_value_ok");
  }
  return { newDatum, potAfter };
}

export async function buildDepositTx(params: DepositParams): Promise<DepositResult> {
  const { lucid, network, potUtxo, potScript, entityId, depositor, policy, name, amount } = params;
  if (!potUtxo.datum) throw new Error("DEP-000: potUtxo has no inline datum");
  const datum = decodePotDatum(Data.from(potUtxo.datum));
  const valueIn = assetsToMap(potUtxo.assets);
  const { newDatum, potAfter } = planDeposit(datum, valueIn, entityId, depositor, policy, name, amount, params.newEpoch);

  const potAddress = credentialToAddress(network, scriptHashToCredential(validatorToScriptHash(potScript)));
  const redeemer = depositsRedeemerToCbor({ kind: "Deposit", entity_id: entityId, depositor, policy, name, amount });

  const tx = await lucid
    .newTx()
    .collectFrom([potUtxo], redeemer)
    .attach.SpendingValidator(potScript)
    .addSignerKey(depositor)              // C-DEP-4 depositor PHẢI ký
    .pay.ToAddressWithData(
      potAddress,
      { kind: "inline", value: potDatumToCbor(newDatum) },
      mapToAssets(potAfter),
    )
    .complete();

  const label = policy === "" ? "lovelace" : `${policy}.${name}`;
  const summary = [
    `═══ Deposit ═══`,
    `Instance:  ${datum.instance_id}`,
    `Entity:    ${entityId}`,
    `Depositor: ${depositor}`,
    `Asset:     ${label}  +${amount}`,
    `Epoch:     ${datum.epoch} → ${newDatum.epoch}`,
  ].join("\n");

  return { tx, newDatum, potAfter, summary };
}

// ════════════════════════════════════════════════════════════
// REFUND
// ════════════════════════════════════════════════════════════

export interface RefundParams {
  lucid:   LucidEvolution;
  network: Network;
  potUtxo:    UTxO;
  potScript:  Validator;
  entityId:   string;
  depositor:  string;     // hex pkh — người được hoàn (ghi trong sổ)
  policy:     string;
  name:       string;
  /** signer thực tế ký tx: depositor (tự rút) HOẶC lifecycle_authority (VK). */
  signerPkh:  string;
  /** nếu authority là Script: UTxO chứng kiến (input/ref) — caller cấp ngoài builder. */
  newEpoch?:  bigint;
}

export interface RefundResult {
  tx:           TxSignBuilder;
  newDatum:     PotDatum;
  potAfter:     AssetMap;
  refundAmount: bigint;
  summary:      string;
}

export function planRefund(
  datum: PotDatum, valueIn: AssetMap,
  entityId: string, depositor: string, policy: string, name: string, newEpoch?: bigint,
): { newDatum: PotDatum; potAfter: AssetMap; refundAmount: bigint } {
  const line: DepositLine | undefined = findLine(datum.ledger, entityId, depositor, policy, name);
  if (!line) throw new Error("REF-001: dòng (entity,depositor,asset) không tồn tại — refund-chưa-deposit");
  const refundAmount = line.amount;
  if (refundAmount <= 0n) throw new Error(`REF-002: refund_amount phải > 0 (got ${refundAmount})`);

  const epoch = newEpoch ?? datum.epoch;
  if (epoch < datum.epoch) throw new Error(`REF-003: epoch lùi (${epoch} < ${datum.epoch})`);

  const ledgerOut = planRefundLedger(datum.ledger, entityId, depositor, policy, name);
  const potAfter = applyRefundValue(valueIn, policy, name, refundAmount);
  const newDatum: PotDatum = { ...datum, ledger: ledgerOut, epoch };

  if (!refundLedgerOk(datum.ledger, ledgerOut, entityId, depositor, policy, name)) {
    throw new Error("REF-004: ledger_out vi phạm refund_ledger_ok (xóa dòng/giữ dòng khác)");
  }
  if (!refundValueOk(valueIn, potAfter, policy, name, refundAmount)) {
    throw new Error("REF-005: value_out vi phạm refund_value_ok");
  }
  return { newDatum, potAfter, refundAmount };
}

export async function buildRefundTx(params: RefundParams): Promise<RefundResult> {
  const { lucid, network, potUtxo, potScript, entityId, depositor, policy, name, signerPkh } = params;
  if (!potUtxo.datum) throw new Error("REF-000: potUtxo has no inline datum");
  const datum = decodePotDatum(Data.from(potUtxo.datum));
  const valueIn = assetsToMap(potUtxo.assets);
  const { newDatum, potAfter, refundAmount } =
    planRefund(datum, valueIn, entityId, depositor, policy, name, params.newEpoch);

  const potAddress = credentialToAddress(network, scriptHashToCredential(validatorToScriptHash(potScript)));
  const depositorAddress = credentialToAddress(network, { type: "Key", hash: depositor });
  const redeemer = depositsRedeemerToCbor({ kind: "Refund", entity_id: entityId, depositor, policy, name });

  // refund value tới depositor (asset bond). lovelace min-UTxO do lucid tự thêm.
  const refundAssets = mapToAssets({ [`${policy}|${name}`]: refundAmount });

  const tx = await lucid
    .newTx()
    .collectFrom([potUtxo], redeemer)
    .attach.SpendingValidator(potScript)
    .addSignerKey(signerPkh)              // depositor tự rút HOẶC authority VK ký
    .pay.ToAddressWithData(
      potAddress,
      { kind: "inline", value: potDatumToCbor(newDatum) },
      mapToAssets(potAfter),
    )
    .pay.ToAddress(depositorAddress, refundAssets)   // C-REF-7 tiền về depositor
    .complete();

  const label = policy === "" ? "lovelace" : `${policy}.${name}`;
  const summary = [
    `═══ Refund ═══`,
    `Instance:  ${datum.instance_id}`,
    `Entity:    ${entityId}`,
    `Depositor: ${depositor}  (nhận hoàn)`,
    `Signer:    ${signerPkh}`,
    `Asset:     ${label}  −${refundAmount}`,
    `Epoch:     ${datum.epoch} → ${newDatum.epoch}`,
  ].join("\n");

  return { tx, newDatum, potAfter, refundAmount, summary };
}

// Re-export lineAmount cho caller tiện tra số dư trước refund.
export { lineAmount };
