// Deposits builder — dựng tx Deposit / Refund / Escheat (CONTRACT; deposits.ak).
//
// v2 (anh chốt 2026-06-08):
//   - Deposit ĐỘNG: amount KHÔNG do caller mớm — TÍNH từ DepositParam beacon (reference
//     input) theo (asset_type, value_tier, lifecycle_class). Mirror validator C-DEP-7.
//   - Escheat: DID mồ côi quá escheat_after → value ÉP về Treasury → xóa dòng.
//
// Builder tự kiểm bất biến onchain trước khi dựng tx (fail-fast — tránh phí submit hỏng).

import {
  Data, credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder, type Assets,
} from "@lucid-evolution/lucid";
import type { Network } from "@lucid-evolution/lucid";

import type { Credential, DepositLine, DepositParam, OutRef, PotDatum } from "./types.js";
import {
  decodePotDatum, decodeDepositParam, potDatumToCbor, depositsRedeemerToCbor,
} from "./datum.js";
import {
  type AssetMap, assetAccepted, findLine, lineAmount,
  planDepositLedger, applyDepositValue, depositLedgerOk, depositValueOk,
  planRefundLedger, applyRefundValue, refundLedgerOk, refundValueOk,
} from "./ledger.js";
import { validParam, requiredFor } from "./schedule.js";

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

/** Credential → lucid Credential (cho địa chỉ đích escheat/refund). */
function toLucidCred(c: Credential): { type: "Key" | "Script"; hash: string } {
  return c.kind === "VerificationKey" ? { type: "Key", hash: c.hash } : { type: "Script", hash: c.hash };
}

// ════════════════════════════════════════════════════════════
// DEPOSIT (ĐỘNG — amount từ beacon)
// ════════════════════════════════════════════════════════════

export interface DepositParams {
  lucid:   LucidEvolution;
  network: Network;
  potUtxo:    UTxO;       // pot UTxO (inline PotDatum)
  potScript:  Validator;
  paramUtxo:  UTxO;       // DepositParam beacon UTxO (reference input, mang NFT)
  entityId:   string;     // hex
  depositor:  string;     // hex pkh người TẠO — PHẢI là ví đang ký tx
  policy:     string;     // hex asset (LAMP); "" cho ADA
  name:       string;     // hex
  assetType:      bigint;
  valueTier:      bigint;
  lifecycleClass: bigint;
  newEpoch?:  bigint;
}

export interface DepositResult {
  tx:        TxSignBuilder;
  newDatum:  PotDatum;
  potAfter:  AssetMap;
  amount:    bigint;       // amount ÉP từ beacon (KHÔNG từ caller)
  summary:   string;
}

/** Plan thuần (không lucid) — amount LẤY TỪ beacon, tự kiểm bất biến.
 *  Trả amount để caller biết phí cọc thực sự (có thể 0 cho dưa leo). */
export function planDeposit(
  datum: PotDatum, valueIn: AssetMap, beacon: DepositParam,
  entityId: string, depositor: string, policy: string, name: string,
  assetType: bigint, valueTier: bigint, lifecycleClass: bigint, newEpoch?: bigint,
): { newDatum: PotDatum; potAfter: AssetMap; amount: bigint } {
  if (!assetAccepted(policy, name, datum.accepted_assets)) {
    throw new Error("DEP-002: asset ∉ accepted_assets");
  }
  // C-DEP-7: amount TÍNH từ beacon (KHÔNG tin caller).
  if (!validParam(beacon)) throw new Error("DEP-006: DepositParam beacon vi phạm bất biến (clamp/base<0)");
  const amount = requiredFor(beacon, assetType, valueTier, lifecycleClass);
  if (amount === undefined) {
    throw new Error("DEP-007: phân loại (asset_type,value_tier,lifecycle_class) không có trong bảng beacon");
  }
  if (amount < 0n) throw new Error(`DEP-008: required âm (${amount}) — beacon rác`);

  const epoch = newEpoch ?? datum.epoch;
  if (epoch < datum.epoch) throw new Error(`DEP-003: epoch lùi (${epoch} < ${datum.epoch})`);

  const ledgerOut = planDepositLedger(
    datum.ledger, entityId, depositor, policy, name, amount, epoch, assetType, valueTier, lifecycleClass,
  );
  const potAfter = applyDepositValue(valueIn, policy, name, amount);
  const newDatum: PotDatum = { ...datum, ledger: ledgerOut, epoch };

  if (!depositLedgerOk(datum.ledger, ledgerOut, entityId, depositor, policy, name, amount)) {
    throw new Error("DEP-004: ledger_out vi phạm deposit_ledger_ok");
  }
  if (!depositValueOk(valueIn, potAfter, policy, name, amount)) {
    throw new Error("DEP-005: value_out vi phạm deposit_value_ok");
  }
  return { newDatum, potAfter, amount };
}

/** OutRef từ lucid UTxO. */
export function utxoToOutRef(u: UTxO): OutRef {
  return { txHash: u.txHash, index: BigInt(u.outputIndex) };
}

export async function buildDepositTx(params: DepositParams): Promise<DepositResult> {
  const {
    lucid, network, potUtxo, potScript, paramUtxo,
    entityId, depositor, policy, name, assetType, valueTier, lifecycleClass,
  } = params;
  if (!potUtxo.datum) throw new Error("DEP-000: potUtxo has no inline datum");
  if (!paramUtxo.datum) throw new Error("DEP-009: paramUtxo (beacon) has no inline datum");
  const datum = decodePotDatum(Data.from(potUtxo.datum));
  const beacon = decodeDepositParam(Data.from(paramUtxo.datum));
  const valueIn = assetsToMap(potUtxo.assets);
  const { newDatum, potAfter, amount } = planDeposit(
    datum, valueIn, beacon, entityId, depositor, policy, name,
    assetType, valueTier, lifecycleClass, params.newEpoch,
  );

  const potAddress = credentialToAddress(network, scriptHashToCredential(validatorToScriptHash(potScript)));
  const depositRef = utxoToOutRef(paramUtxo);
  const redeemer = depositsRedeemerToCbor({
    kind: "Deposit", entity_id: entityId, depositor, policy, name,
    asset_type: assetType, value_tier: valueTier, lifecycle_class: lifecycleClass, deposit_ref: depositRef,
  });

  const tx = await lucid
    .newTx()
    .collectFrom([potUtxo], redeemer)
    .readFrom([paramUtxo])                 // beacon reference input (CIP-31 — không tiêu)
    .attach.SpendingValidator(potScript)
    .addSignerKey(depositor)               // C-DEP-4 depositor PHẢI ký
    .pay.ToAddressWithData(
      potAddress,
      { kind: "inline", value: potDatumToCbor(newDatum) },
      mapToAssets(potAfter),
    )
    .complete();

  const label = policy === "" ? "lovelace" : `${policy}.${name}`;
  const summary = [
    `═══ Deposit (động — beacon) ═══`,
    `Instance:  ${datum.instance_id}`,
    `Entity:    ${entityId}`,
    `Depositor: ${depositor}`,
    `Phân loại: asset_type=${assetType} value_tier=${valueTier} lifecycle_class=${lifecycleClass}`,
    `Asset:     ${label}  +${amount}  (phí từ beacon, KHÔNG client mớm)`,
    `Epoch:     ${datum.epoch} → ${newDatum.epoch}`,
  ].join("\n");

  return { tx, newDatum, potAfter, amount, summary };
}

// ════════════════════════════════════════════════════════════
// REFUND (creator-refund: tiền về depositor = người tạo)
// ════════════════════════════════════════════════════════════

export interface RefundParams {
  lucid:   LucidEvolution;
  network: Network;
  potUtxo:    UTxO;
  potScript:  Validator;
  entityId:   string;
  depositor:  string;     // hex pkh người TẠO — người được hoàn (ghi trong sổ)
  policy:     string;
  name:       string;
  signerPkh:  string;     // depositor (tự rút) HOẶC lifecycle_authority (VK)
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
    `═══ Refund (creator-refund) ═══`,
    `Instance:  ${datum.instance_id}`,
    `Entity:    ${entityId}`,
    `Depositor: ${depositor}  (người tạo — nhận hoàn)`,
    `Signer:    ${signerPkh}`,
    `Asset:     ${label}  −${refundAmount}`,
    `Epoch:     ${datum.epoch} → ${newDatum.epoch}`,
  ].join("\n");

  return { tx, newDatum, potAfter, refundAmount, summary };
}

// ════════════════════════════════════════════════════════════
// ESCHEAT (DID mồ côi quá hạn → value về Treasury)
// ════════════════════════════════════════════════════════════

export interface EscheatParams {
  lucid:   LucidEvolution;
  network: Network;
  potUtxo:    UTxO;
  potScript:  Validator;
  entityId:   string;
  depositor:  string;
  policy:     string;
  name:       string;
  currentEpoch: bigint;   // caller cấp (đặt validity_range tương ứng)
  signerPkh?: string;     // bất kỳ ai trigger được (public-good); mặc định = ví đang ký
  newEpoch?:  bigint;
}

export interface EscheatResult {
  tx:            TxSignBuilder;
  newDatum:      PotDatum;
  potAfter:      AssetMap;
  escheatAmount: bigint;
  summary:       string;
}

export function planEscheat(
  datum: PotDatum, valueIn: AssetMap,
  entityId: string, depositor: string, policy: string, name: string,
  currentEpoch: bigint, newEpoch?: bigint,
): { newDatum: PotDatum; potAfter: AssetMap; escheatAmount: bigint } {
  const line: DepositLine | undefined = findLine(datum.ledger, entityId, depositor, policy, name);
  if (!line) throw new Error("ESC-001: dòng (entity,depositor,asset) không tồn tại — escheat-phantom");
  const escheatAmount = line.amount;
  if (escheatAmount <= 0n) throw new Error(`ESC-002: escheat_amount phải > 0 (got ${escheatAmount})`);

  // C-ESC-4: đã tới hạn.
  if (currentEpoch < line.epoch + datum.escheat_after_epoch) {
    throw new Error(
      `ESC-004: chưa tới hạn escheat (cur ${currentEpoch} < ${line.epoch} + ${datum.escheat_after_epoch})`,
    );
  }

  const epoch = newEpoch ?? datum.epoch;
  if (epoch < datum.epoch) throw new Error(`ESC-003: epoch lùi (${epoch} < ${datum.epoch})`);

  // sổ + value: đối xứng refund (xóa dòng, value −amount).
  const ledgerOut = planRefundLedger(datum.ledger, entityId, depositor, policy, name);
  const potAfter = applyRefundValue(valueIn, policy, name, escheatAmount);
  const newDatum: PotDatum = { ...datum, ledger: ledgerOut, epoch };

  if (!refundLedgerOk(datum.ledger, ledgerOut, entityId, depositor, policy, name)) {
    throw new Error("ESC-006: ledger_out vi phạm (xóa dòng/giữ dòng khác)");
  }
  if (!refundValueOk(valueIn, potAfter, policy, name, escheatAmount)) {
    throw new Error("ESC-005: value_out vi phạm");
  }
  return { newDatum, potAfter, escheatAmount };
}

export async function buildEscheatTx(params: EscheatParams): Promise<EscheatResult> {
  const { lucid, network, potUtxo, potScript, entityId, depositor, policy, name, currentEpoch } = params;
  if (!potUtxo.datum) throw new Error("ESC-000: potUtxo has no inline datum");
  const datum = decodePotDatum(Data.from(potUtxo.datum));
  const valueIn = assetsToMap(potUtxo.assets);
  const { newDatum, potAfter, escheatAmount } =
    planEscheat(datum, valueIn, entityId, depositor, policy, name, currentEpoch, params.newEpoch);

  const potAddress = credentialToAddress(network, scriptHashToCredential(validatorToScriptHash(potScript)));
  // C-ESC-7: tiền ÉP về Treasury custody (VK hoặc Script).
  const treasuryAddress = credentialToAddress(network, toLucidCred(datum.treasury_credential));
  const redeemer = depositsRedeemerToCbor({ kind: "Escheat", entity_id: entityId, depositor, policy, name });
  const escheatAssets = mapToAssets({ [`${policy}|${name}`]: escheatAmount });

  // validity_range: lower bound = currentEpoch × ms_per_epoch (để validator get_epoch khớp).
  const lowerMs = Number(currentEpoch * datum.ms_per_epoch);

  let txb = lucid
    .newTx()
    .collectFrom([potUtxo], redeemer)
    .attach.SpendingValidator(potScript)
    .validFrom(lowerMs)
    .pay.ToAddressWithData(
      potAddress,
      { kind: "inline", value: potDatumToCbor(newDatum) },
      mapToAssets(potAfter),
    )
    .pay.ToAddress(treasuryAddress, escheatAssets);   // value về Treasury
  if (params.signerPkh) txb = txb.addSignerKey(params.signerPkh);

  const tx = await txb.complete();

  const label = policy === "" ? "lovelace" : `${policy}.${name}`;
  const treasuryDesc = datum.treasury_credential.kind === "Script"
    ? `Script(${datum.treasury_credential.hash})`
    : `VK(${datum.treasury_credential.hash})`;
  const summary = [
    `═══ Escheat (DID mồ côi → Treasury) ═══`,
    `Instance:  ${datum.instance_id}`,
    `Entity:    ${entityId}`,
    `Depositor: ${depositor}  (mồ côi)`,
    `Asset:     ${label}  −${escheatAmount} → Treasury ${treasuryDesc}`,
    `Epoch:     deposit + escheat_after ≤ cur ${currentEpoch}`,
  ].join("\n");

  return { tx, newDatum, potAfter, escheatAmount, summary };
}

// Re-export lineAmount cho caller tiện tra số dư trước refund/escheat.
export { lineAmount };
