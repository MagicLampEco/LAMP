// Logic thuần nhánh COLLECT — mirror onchain lib/magiclamp/treasury/collect.ak.
// Tách khỏi tx builder để test đơn vị + giữ builder mỏng.
//
// Bất biến ÉP (đơn-bucket, incremental — CONTRACT §9 T2+T3):
//   cut(item)   = ⌊ amount × cut_bps / 10000 ⌋          (C-COL-4 onchain)
//   ledger_out  = ledger_in với MỖI (category, asset) += Σ cut item đúng (category,asset)
//   ∀ asset a có Δ:       Σ_b Δledger[(b,a)] == Σcut == Δvalue(a)
//   ∀ asset a KHÔNG đụng: value_out(a) == value_in(a)   (T3 — Σout=Σin)
//
// KHÔNG burn: value bảo toàn TUYỆT ĐỐI per-asset:
//   value_out == value_in ⊕ cut_value(items)
// Residual (amount − cut) do CALLER trả thẳng provider ngoài custody.

import type { CollectItem, CustodyDatum, LedgerEntry } from "./types.js";

/** Đơn vị value đa-asset offchain: key "policy|name" → amount. "" cho lovelace. */
export type AssetMap = Record<string, bigint>;

const BPS_DENOM = 10_000n;

/** Khóa chuẩn hoá cho 1 asset trong AssetMap / sổ. */
export function assetKey(policy: string, name: string): string {
  return `${policy.toLowerCase()}|${name.toLowerCase()}`;
}

/** cut của 1 item = floor(amount × cut_bps / 10000). amount ≥ 0, cut_bps ∈ [0,10000]. */
export function itemCut(amount: bigint, cutBps: bigint): bigint {
  // BigInt chia là trunc-toward-zero; amount ≥ 0 ⇒ == floor.
  return (amount * cutBps) / BPS_DENOM;
}

/** Asset của item ∈ accepted_assets? */
export function itemAccepted(item: CollectItem, accepted: CustodyDatum["accepted_assets"]): boolean {
  const k = assetKey(item.policy, item.name);
  return accepted.some((a) => assetKey(a.policy, a.name) === k);
}

/** Mọi item hợp lệ: amount ≥ 0 + asset ∈ accepted_assets. */
export function allItemsValid(items: CollectItem[], accepted: CustodyDatum["accepted_assets"]): boolean {
  return items.every((it) => it.amount >= 0n && itemAccepted(it, accepted));
}

/** Số dư (bucket,policy,name) trong sổ; 0 nếu chưa có dòng. */
export function ledgerGet(
  ledger: LedgerEntry[], bucketId: bigint, policy: string, name: string,
): bigint {
  const k = assetKey(policy, name);
  const e = ledger.find((x) => x.bucket_id === bucketId && assetKey(x.policy, x.name) === k);
  return e ? e.amount : 0n;
}

/** Value gồm đúng phần cut của mọi item (per-asset). Mirror cut_value onchain. */
export function cutValue(items: CollectItem[], cutBps: bigint): AssetMap {
  const out: AssetMap = {};
  for (const it of items) {
    const c = itemCut(it.amount, cutBps);
    if (c === 0n) continue;
    const k = assetKey(it.policy, it.name);
    out[k] = (out[k] ?? 0n) + c;
  }
  return out;
}

/** value_out = value_in ⊕ cut_value(items). Σout = Σin per-asset (KHÔNG burn). */
export function applyCut(valueIn: AssetMap, items: CollectItem[], cutBps: bigint): AssetMap {
  const out: AssetMap = { ...valueIn };
  const cuts = cutValue(items, cutBps);
  for (const [k, c] of Object.entries(cuts)) {
    out[k] = (out[k] ?? 0n) + c;
  }
  return out;
}

/**
 * Dựng ledger_out từ ledger_in: cộng Σcut vào ĐÚNG MỘT bucket = item.category,
 * tại đúng (category, asset). Đơn-bucket (T2). Giữ nguyên thứ tự dòng cũ, thêm
 * dòng mới (cho (category,asset) chưa có) ở cuối — không trùng khóa (no_dup_lines).
 */
export function planLedgerOut(
  ledgerIn: LedgerEntry[], items: CollectItem[], cutBps: bigint,
): LedgerEntry[] {
  // Σcut theo (bucket=category, asset).
  const deltas = new Map<string, bigint>();
  const meta = new Map<string, { bucket: bigint; policy: string; name: string }>();
  for (const it of items) {
    const c = itemCut(it.amount, cutBps);
    if (c === 0n) continue;
    const k = `${it.category}|${assetKey(it.policy, it.name)}`;
    deltas.set(k, (deltas.get(k) ?? 0n) + c);
    if (!meta.has(k)) meta.set(k, { bucket: it.category, policy: it.policy, name: it.name });
  }

  const used = new Set<string>();
  const out: LedgerEntry[] = ledgerIn.map((e) => {
    const k = `${e.bucket_id}|${assetKey(e.policy, e.name)}`;
    const d = deltas.get(k);
    if (d === undefined) return { ...e };
    used.add(k);
    return { ...e, amount: e.amount + d };
  });

  // Dòng mới cho (category,asset) chưa tồn tại trong sổ.
  for (const [k, d] of deltas) {
    if (used.has(k)) continue;
    const m = meta.get(k)!;
    out.push({ bucket_id: m.bucket, policy: m.policy, name: m.name, amount: d });
  }
  return out;
}

// ── Kiểm tra bất biến (mirror ledger_ok onchain) — dùng cho test + tự kiểm builder ──

function sameKey(a: LedgerEntry, b: LedgerEntry): boolean {
  return a.bucket_id === b.bucket_id && assetKey(a.policy, a.name) === assetKey(b.policy, b.name);
}

/** Sổ không có dòng trùng khóa (bucket,policy,name). */
export function noDupLines(ledger: LedgerEntry[]): boolean {
  return ledger.every((e, i) => ledger.findIndex((o) => sameKey(e, o)) === i);
}

/** Σcut kỳ vọng cho 1 dòng (bucket=category, asset). */
export function expectedLineDelta(
  items: CollectItem[], cutBps: bigint, bucketId: bigint, policy: string, name: string,
): bigint {
  const k = assetKey(policy, name);
  return items.reduce((acc, it) => {
    if (it.category === bucketId && assetKey(it.policy, it.name) === k) {
      return acc + itemCut(it.amount, cutBps);
    }
    return acc;
  }, 0n);
}

/** Mọi dòng out == get(in) + Δkỳvọng(items). */
export function eachOutLineOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], items: CollectItem[], cutBps: bigint,
): boolean {
  return ledgerOut.every((e) => {
    const want = ledgerGet(ledgerIn, e.bucket_id, e.policy, e.name)
      + expectedLineDelta(items, cutBps, e.bucket_id, e.policy, e.name);
    return e.amount === want;
  });
}

/** Mọi dòng in còn trong out (chống xóa dòng = drain sổ). */
export function eachInLinePresent(ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[]): boolean {
  return ledgerIn.every((e) => ledgerOut.some((o) => sameKey(e, o)));
}

/** Mọi item có dòng đích trong out (cut phải vào sổ). */
export function eachItemHasTarget(ledgerOut: LedgerEntry[], items: CollectItem[]): boolean {
  return items.every((it) =>
    ledgerOut.some((o) =>
      o.bucket_id === it.category && assetKey(o.policy, o.name) === assetKey(it.policy, it.name),
    ),
  );
}

/** ledger_ok onchain: 4 kiểm gộp. */
export function ledgerOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], items: CollectItem[], cutBps: bigint,
): boolean {
  return noDupLines(ledgerOut)
    && eachOutLineOk(ledgerIn, ledgerOut, items, cutBps)
    && eachInLinePresent(ledgerIn, ledgerOut)
    && eachItemHasTarget(ledgerOut, items);
}

/** value_ok onchain: value_out KHỚP TUYỆT ĐỐI value_in ⊕ cut_value. */
export function valueOk(
  valueIn: AssetMap, valueOut: AssetMap, items: CollectItem[], cutBps: bigint,
): boolean {
  const want = applyCut(valueIn, items, cutBps);
  const keys = new Set([...Object.keys(valueIn), ...Object.keys(valueOut), ...Object.keys(want)]);
  for (const k of keys) {
    if ((valueOut[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  }
  return true;
}

// ── GENESIS (seed custody) — mirror collect.ak seed_value_ok ──────────────
// Bất biến nền:  ∀a  Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a)
//   reserved_min_ada chỉ áp lovelace (key ""|""). custody_seed validator ép on-chain;
//   các hàm dưới để off-chain DỰNG đúng seed + tự kiểm trước khi build genesis tx.

const LOVELACE_KEY = assetKey("", "");

/** Value gồm toàn bộ số dư sổ (per-asset, gộp mọi bucket cùng asset). */
export function ledgerValue(ledger: LedgerEntry[]): AssetMap {
  const out: AssetMap = {};
  for (const e of ledger) {
    const k = assetKey(e.policy, e.name);
    out[k] = (out[k] ?? 0n) + e.amount;
  }
  return out;
}

/** Value kỳ vọng của seed = ledgerValue ⊕ reserved_min_ada (lovelace). Dùng để BUILD. */
export function seedValue(ledger: LedgerEntry[], reservedMinAda: bigint): AssetMap {
  const out = ledgerValue(ledger);
  if (reservedMinAda !== 0n) {
    out[LOVELACE_KEY] = (out[LOVELACE_KEY] ?? 0n) + reservedMinAda;
  }
  return out;
}

/** seed_value_ok on-chain: value == ledgerValue(ledger) ⊕ reserved_min_ada. */
export function seedValueOk(
  value: AssetMap, ledger: LedgerEntry[], reservedMinAda: bigint,
): boolean {
  if (reservedMinAda < 0n) return false;
  const want = seedValue(ledger, reservedMinAda);
  const keys = new Set([...Object.keys(value), ...Object.keys(want)]);
  for (const k of keys) {
    if ((value[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  }
  return true;
}

/** Mọi dòng sổ thuộc accepted_assets (mirror all_lines_accepted on-chain). */
export function allLinesAccepted(
  ledger: LedgerEntry[], accepted: CustodyDatum["accepted_assets"],
): boolean {
  return ledger.every((e) =>
    accepted.some((a) => assetKey(a.policy, a.name) === assetKey(e.policy, e.name)),
  );
}

/**
 * Seed datum hợp lệ TOÀN PHẦN (gương đủ custody_seed validator):
 *   value == ledgerValue ⊕ reserved_min_ada  ∧  no_dup_lines  ∧  mọi dòng accepted.
 * Off-chain GỌI trước khi build genesis tx — chặn seed sổ≠value ngay từ off-chain.
 */
export function seedDatumOk(
  value: AssetMap, datum: CustodyDatum, reservedMinAda: bigint,
): boolean {
  return seedValueOk(value, datum.ledger, reservedMinAda)
    && noDupLines(datum.ledger)
    && allLinesAccepted(datum.ledger, datum.accepted_assets);
}
