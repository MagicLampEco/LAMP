// Logic thuần sổ cọc + value — mirror onchain lib/magiclamp/deposits/ledger.ak.
// Tách khỏi builder để test đơn vị + tự kiểm trước khi submit (fail-fast).
//
// Khóa dòng = (entity_id, depositor, policy, name). Bất biến:
//   Deposit: dòng đích += amount (cộng dồn nếu trùng khóa); dòng khác giữ nguyên.
//   Refund:  dòng đích bị XÓA; dòng khác giữ nguyên (chống double-refund).
//   value:   pot_out == pot_in ⊕/⊖ {asset: amount} (đẳng thức tuyệt đối).

import type { AssetKey, DepositLine } from "./types.js";

/** Đơn vị value đa-asset offchain: key "policy|name" → amount. "" cho lovelace. */
export type AssetMap = Record<string, bigint>;

/** Khóa chuẩn hoá cho 1 asset. */
export function assetKey(policy: string, name: string): string {
  return `${policy.toLowerCase()}|${name.toLowerCase()}`;
}

/** Khóa dòng (entity, depositor, asset). */
export function lineKey(entity: string, depositor: string, policy: string, name: string): string {
  return `${entity.toLowerCase()}|${depositor.toLowerCase()}|${assetKey(policy, name)}`;
}

function keyOf(e: DepositLine): string {
  return lineKey(e.entity_id, e.depositor, e.policy, e.name);
}

export function sameKey(a: DepositLine, b: DepositLine): boolean {
  return keyOf(a) === keyOf(b);
}

export function findLine(
  ledger: DepositLine[], entity: string, depositor: string, policy: string, name: string,
): DepositLine | undefined {
  const k = lineKey(entity, depositor, policy, name);
  return ledger.find((e) => keyOf(e) === k);
}

export function lineAmount(
  ledger: DepositLine[], entity: string, depositor: string, policy: string, name: string,
): bigint {
  const e = findLine(ledger, entity, depositor, policy, name);
  return e ? e.amount : 0n;
}

// ── Bất biến chung ──

export function noDupLines(ledger: DepositLine[]): boolean {
  return ledger.every((e, i) => ledger.findIndex((o) => sameKey(e, o)) === i);
}

export function allLinesPositive(ledger: DepositLine[]): boolean {
  return ledger.every((e) => e.amount > 0n);
}

export function assetAccepted(policy: string, name: string, accepted: AssetKey[]): boolean {
  const k = assetKey(policy, name);
  return accepted.some((a) => assetKey(a.policy, a.name) === k);
}

// ── value ↔ sổ ──

export function ledgerValue(ledger: DepositLine[]): AssetMap {
  const out: AssetMap = {};
  for (const e of ledger) {
    const k = assetKey(e.policy, e.name);
    out[k] = (out[k] ?? 0n) + e.amount;
  }
  return out;
}

const LOVELACE_KEY = assetKey("", "");

/** Value seed/state kỳ vọng = ledgerValue ⊕ reserved_min_ada (lovelace). */
export function potValue(ledger: DepositLine[], reservedMinAda: bigint): AssetMap {
  const out = ledgerValue(ledger);
  if (reservedMinAda !== 0n) out[LOVELACE_KEY] = (out[LOVELACE_KEY] ?? 0n) + reservedMinAda;
  return out;
}

export function potValueOk(value: AssetMap, ledger: DepositLine[], reservedMinAda: bigint): boolean {
  if (reservedMinAda < 0n) return false;
  const want = potValue(ledger, reservedMinAda);
  const keys = new Set([...Object.keys(value), ...Object.keys(want)]);
  for (const k of keys) if ((value[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  return true;
}

// ── DEPOSIT: plan ledger_out + value_out ──

/** Dựng ledger_out cho Deposit: dòng đích += amount (cộng dồn), dòng khác giữ nguyên.
 *  v2: dòng mới mang classification (asset_type, value_tier, lifecycle_class). amount=0
 *  (cọc dưa leo) → KHÔNG ghi dòng (sổ giữ nguyên — khớp validator nhánh amount==0). */
export function planDepositLedger(
  ledgerIn: DepositLine[], entity: string, depositor: string,
  policy: string, name: string, amount: bigint, epoch: bigint,
  assetType: bigint, valueTier: bigint, lifecycleClass: bigint,
): DepositLine[] {
  if (amount === 0n) return ledgerIn.map((e) => ({ ...e }));
  const k = lineKey(entity, depositor, policy, name);
  let found = false;
  const out: DepositLine[] = ledgerIn.map((e) => {
    if (keyOf(e) === k) {
      found = true;
      return { ...e, amount: e.amount + amount };
    }
    return { ...e };
  });
  if (!found) {
    out.push({
      entity_id: entity, depositor, policy, name, amount, epoch,
      asset_type: assetType, value_tier: valueTier, lifecycle_class: lifecycleClass,
    });
  }
  return out;
}

/** value_out = value_in ⊕ {asset: amount}. */
export function applyDepositValue(valueIn: AssetMap, policy: string, name: string, amount: bigint): AssetMap {
  const out: AssetMap = { ...valueIn };
  const k = assetKey(policy, name);
  out[k] = (out[k] ?? 0n) + amount;
  return out;
}

/** Mirror deposit_ledger_ok onchain. amount==0 (cọc dưa leo) → sổ phải GIỮ NGUYÊN. */
export function depositLedgerOk(
  ledgerIn: DepositLine[], ledgerOut: DepositLine[],
  entity: string, depositor: string, policy: string, name: string, amount: bigint,
): boolean {
  if (amount === 0n) {
    // nhánh validator: out_datum.ledger == datum.ledger (không thêm dòng khống).
    if (ledgerOut.length !== ledgerIn.length) return false;
    return ledgerIn.every((e, i) => sameKey(e, ledgerOut[i]!) && e.amount === ledgerOut[i]!.amount);
  }
  if (!noDupLines(ledgerOut)) return false;
  if (!allLinesPositive(ledgerOut)) return false;
  const tk = lineKey(entity, depositor, policy, name);
  // each_out_line_ok: dòng đích == get(in)+amount; dòng khác == get(in).
  for (const e of ledgerOut) {
    const base = lineAmount(ledgerIn, e.entity_id, e.depositor, e.policy, e.name);
    const delta = keyOf(e) === tk ? amount : 0n;
    if (e.amount !== base + delta) return false;
  }
  // each_in_line_present.
  for (const e of ledgerIn) if (!ledgerOut.some((o) => sameKey(o, e))) return false;
  // target present exactly once.
  if (ledgerOut.filter((o) => keyOf(o) === tk).length !== 1) return false;
  return true;
}

/** Mirror deposit_value_ok onchain. */
export function depositValueOk(
  valueIn: AssetMap, valueOut: AssetMap, policy: string, name: string, amount: bigint,
): boolean {
  const want = applyDepositValue(valueIn, policy, name, amount);
  const keys = new Set([...Object.keys(valueIn), ...Object.keys(valueOut), ...Object.keys(want)]);
  for (const k of keys) if ((valueOut[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  return true;
}

// ── REFUND: plan ledger_out + value_out ──

/** Dựng ledger_out cho Refund: XÓA dòng đích; dòng khác giữ nguyên. */
export function planRefundLedger(
  ledgerIn: DepositLine[], entity: string, depositor: string, policy: string, name: string,
): DepositLine[] {
  const k = lineKey(entity, depositor, policy, name);
  return ledgerIn.filter((e) => keyOf(e) !== k).map((e) => ({ ...e }));
}

/** value_out = value_in ⊖ {asset: refundAmount}. */
export function applyRefundValue(valueIn: AssetMap, policy: string, name: string, refundAmount: bigint): AssetMap {
  const out: AssetMap = { ...valueIn };
  const k = assetKey(policy, name);
  out[k] = (out[k] ?? 0n) - refundAmount;
  return out;
}

/** Mirror refund_ledger_ok onchain. */
export function refundLedgerOk(
  ledgerIn: DepositLine[], ledgerOut: DepositLine[],
  entity: string, depositor: string, policy: string, name: string,
): boolean {
  if (!noDupLines(ledgerOut)) return false;
  if (!allLinesPositive(ledgerOut)) return false;
  const tk = lineKey(entity, depositor, policy, name);
  // target absent.
  if (ledgerOut.some((o) => keyOf(o) === tk)) return false;
  // each_out_is_untouched_in: mỗi dòng out == dòng in cùng khóa, hệt nhau.
  for (const o of ledgerOut) {
    const i = ledgerIn.find((x) => sameKey(x, o));
    if (!i) return false;
    if (i.amount !== o.amount || i.epoch !== o.epoch) return false;
  }
  // each_in_nontarget_present.
  for (const i of ledgerIn) {
    if (keyOf(i) === tk) continue;
    if (!ledgerOut.some((o) => sameKey(o, i))) return false;
  }
  return true;
}

/** Mirror refund_value_ok onchain. */
export function refundValueOk(
  valueIn: AssetMap, valueOut: AssetMap, policy: string, name: string, refundAmount: bigint,
): boolean {
  const want = applyRefundValue(valueIn, policy, name, refundAmount);
  const keys = new Set([...Object.keys(valueIn), ...Object.keys(valueOut), ...Object.keys(want)]);
  for (const k of keys) if ((valueOut[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  return true;
}
