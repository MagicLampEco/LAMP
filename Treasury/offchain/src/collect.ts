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
  // CANONICAL hoá: prune dòng 0 + sort theo khóa (khớp is_canonical on-chain).
  // Collect chỉ cộng cut ≥ 0 nên không sinh dòng âm; canonicalizeLedger reject nếu có.
  return canonicalizeLedger(out);
}

// ── Kiểm tra bất biến (mirror ledger_ok onchain) — dùng cho test + tự kiểm builder ──

function sameKey(a: LedgerEntry, b: LedgerEntry): boolean {
  return a.bucket_id === b.bucket_id && assetKey(a.policy, a.name) === assetKey(b.policy, b.name);
}

/** Sổ không có dòng trùng khóa (bucket,policy,name). (Hệ quả của strictSorted.) */
export function noDupLines(ledger: LedgerEntry[]): boolean {
  return ledger.every((e, i) => ledger.findIndex((o) => sameKey(e, o)) === i);
}

// ── CANONICAL SỔ (hardening v1) — mirror onchain ledger.ak ──────────────────
// is_canonical(out) = strict_sorted ∧ all_positive. Off-chain PHẢI dựng sổ canonical
// (sort + prune dòng 0 + reject âm) trước khi ghi datum, và fail-fast nếu lệch.
//
// THỨ TỰ SẮP XẾP khớp on-chain key_lt:
//   khóa = (bucket_id:Int, policy:ByteArray, name:ByteArray)
//   bucket_id so theo Int tăng; policy/name so theo bytearray.compare = so byte
//   lexicographic. Off-chain giữ policy/name là HEX trần (lowercase) → so từng KÝ TỰ
//   HEX char-by-char ≡ so byte (mỗi byte = 2 hex char, 00..ff cùng thứ tự; prefix
//   ngắn hơn = Less, khớp bytearray.compare). KHÔNG so chuỗi unicode của name đã decode.

/** So 2 hex string (lowercase, even-length) như bytearray.compare on-chain:
 *  −1 nếu a<b, 0 nếu ==, +1 nếu a>b. Lexicographic theo byte (= theo cặp hex char). */
export function compareHexBytes(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  // So từng cặp hex char (1 byte). Prefix ngắn hơn = Less (khớp bytearray.compare).
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 2) {
    const bx = x.slice(i, i + 2);
    const by = y.slice(i, i + 2);
    if (bx < by) return -1;
    if (bx > by) return 1;
  }
  if (x.length < y.length) return -1;
  if (x.length > y.length) return 1;
  return 0;
}

/** key_lt on-chain: a < b theo (bucket_id, policy, name). */
export function keyLt(a: LedgerEntry, b: LedgerEntry): boolean {
  if (a.bucket_id !== b.bucket_id) return a.bucket_id < b.bucket_id;
  const cp = compareHexBytes(a.policy, b.policy);
  if (cp !== 0) return cp < 0;
  return compareHexBytes(a.name, b.name) < 0;
}

/** strict_sorted on-chain: mỗi cặp liền kề khóa tăng NGHIÊM NGẶT (⇒ không trùng khóa). */
export function strictSorted(ledger: LedgerEntry[]): boolean {
  for (let i = 1; i < ledger.length; i++) {
    if (!keyLt(ledger[i - 1]!, ledger[i]!)) return false;
  }
  return true;
}

/** all_positive on-chain: mọi dòng amount > 0 (KHÔNG dòng 0, KHÔNG âm). */
export function allPositive(ledger: LedgerEntry[]): boolean {
  return ledger.every((e) => e.amount > 0n);
}

/** is_canonical on-chain: strict_sorted ∧ all_positive. */
export function isCanonical(ledger: LedgerEntry[]): boolean {
  return strictSorted(ledger) && allPositive(ledger);
}

/** Sắp xếp sổ theo khóa canonical (bucket_id, policy, name) — khớp key_lt. KHÔNG đổi amount. */
export function sortLedger(ledger: LedgerEntry[]): LedgerEntry[] {
  return [...ledger].sort((a, b) => {
    if (a.bucket_id !== b.bucket_id) return a.bucket_id < b.bucket_id ? -1 : 1;
    const cp = compareHexBytes(a.policy, b.policy);
    if (cp !== 0) return cp;
    return compareHexBytes(a.name, b.name);
  });
}

/** Bỏ dòng số dư == 0 (prune) — canonical KHÔNG ghi dòng 0. */
export function pruneZeroLines(ledger: LedgerEntry[]): LedgerEntry[] {
  return ledger.filter((e) => e.amount !== 0n);
}

/** Dựng sổ CANONICAL từ sổ thô: prune dòng 0 → sort theo khóa.
 *  Ném lỗi nếu sinh dòng ÂM (sổ không thể canonical hoá — phá bất biến C-POS). */
export function canonicalizeLedger(ledger: LedgerEntry[]): LedgerEntry[] {
  for (const e of ledger) {
    if (e.amount < 0n) {
      throw new Error(
        `LEDGER-NEG: dòng âm (bucket=${e.bucket_id}, ${e.policy}|${e.name}, amount=${e.amount}) — không thể canonical hoá`,
      );
    }
  }
  return sortLedger(pruneZeroLines(ledger));
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

/** each_in_line_settled on-chain: mọi dòng IN còn trong OUT, TRỪ khi số dư mới == 0
 *  (in + Δcut) thì được prune (vắng). Collect chỉ cộng cut ≥ 0 nên thực tế không prune. */
export function eachInLineSettled(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], items: CollectItem[], cutBps: bigint,
): boolean {
  return ledgerIn.every((e) => {
    const newBal = e.amount + expectedLineDelta(items, cutBps, e.bucket_id, e.policy, e.name);
    if (newBal === 0n) return true;
    return ledgerOut.some((o) => sameKey(e, o));
  });
}

/** Mọi item có dòng đích trong out (cut phải vào sổ). */
export function eachItemHasTarget(ledgerOut: LedgerEntry[], items: CollectItem[]): boolean {
  return items.every((it) =>
    ledgerOut.some((o) =>
      o.bucket_id === it.category && assetKey(o.policy, o.name) === assetKey(it.policy, it.name),
    ),
  );
}

/** ledger_ok onchain: is_canonical(out) ∧ each_out_line_ok ∧ each_in_line_settled ∧
 *  each_item_has_target. is_canonical = strict_sorted (loại trùng O(n)) ∧ mọi dòng > 0. */
export function ledgerOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], items: CollectItem[], cutBps: bigint,
): boolean {
  return isCanonical(ledgerOut)
    && eachOutLineOk(ledgerIn, ledgerOut, items, cutBps)
    && eachInLineSettled(ledgerIn, ledgerOut, items, cutBps)
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

// ── GENESIS (seed custody) — mirror collect.ak seed_value_ok (hardening v1) ─
// Bất biến nền:  ∀a  Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a) − NFT
//   reserved_min_ada chỉ áp lovelace (key ""|""). NFT authenticity (seed_policy,
//   instance_id) qty 1 KHÔNG ghi sổ. custody_seed validator ép on-chain; các hàm dưới
//   để off-chain DỰNG đúng seed + tự kiểm trước khi build genesis tx.

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

/** Value kỳ vọng của seed (hardening v1):
 *    value == ledgerValue(ledger) ⊕ reserved_min_ada(lovelace) ⊕ 1 NFT (nftPolicy,nftName).
 *  NFT authenticity (seed_policy, instance_id) qty 1 — custody_seed mint, custody.ak ép
 *  hiện diện khi spend. Dùng để BUILD seed output. */
export function seedValue(
  ledger: LedgerEntry[], reservedMinAda: bigint, nftPolicy: string, nftName: string,
): AssetMap {
  const out = ledgerValue(ledger);
  if (reservedMinAda !== 0n) {
    out[LOVELACE_KEY] = (out[LOVELACE_KEY] ?? 0n) + reservedMinAda;
  }
  const nk = assetKey(nftPolicy, nftName);
  out[nk] = (out[nk] ?? 0n) + 1n;
  return out;
}

/** seed_value_ok on-chain (hardening v1):
 *    value == ledgerValue(ledger) ⊕ reserved_min_ada ⊕ 1 NFT (nftPolicy,nftName).
 *  nftPolicy = seed_policy (PolicyId), nftName = instance_id. */
export function seedValueOk(
  value: AssetMap, ledger: LedgerEntry[], reservedMinAda: bigint,
  nftPolicy: string, nftName: string,
): boolean {
  if (reservedMinAda < 0n) return false;
  const want = seedValue(ledger, reservedMinAda, nftPolicy, nftName);
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
 * Seed datum hợp lệ TOÀN PHẦN (gương ĐỦ custody_seed validator — hardening v1):
 *   S-PARAM-0   datum.instance_id == nftName (NFT name = instance_id)
 *   S-ID-0      instance_id != ""              (định danh thật)
 *   S-ACC-1     accepted_assets.length > 0     (không instance "câm")
 *   S-CUT-0     0 ≤ cut_bps ≤ 10000            (chống cut âm drain / >100%)
 *   S-SEED-0    value == ledgerValue ⊕ reserved_min_ada ⊕ 1 NFT (seed_policy,instance_id)
 *   S-LEDGER-0  sổ CANONICAL (strict-sorted ∧ mọi dòng > 0)
 *   S-ACC-0     mọi dòng sổ thuộc accepted_assets
 *   S-CONSUMED-0 consumed_proposals == []
 * Off-chain GỌI trước khi build genesis tx — chặn seed sai ngay từ off-chain.
 * @param nftPolicy seed_policy (PolicyId của custody authenticity NFT).
 */
export function seedDatumOk(
  value: AssetMap, datum: CustodyDatum, reservedMinAda: bigint, nftPolicy: string,
): boolean {
  const nftName = datum.instance_id;   // NFT name = instance_id (S-PARAM-0)
  return datum.instance_id !== ""                                    // S-ID-0
    && datum.accepted_assets.length > 0                              // S-ACC-1
    && datum.cut_bps >= 0n && datum.cut_bps <= 10000n               // S-CUT-0
    && seedValueOk(value, datum.ledger, reservedMinAda, nftPolicy, nftName) // S-SEED-0
    && isCanonical(datum.ledger)                                     // S-LEDGER-0
    && allLinesAccepted(datum.ledger, datum.accepted_assets)         // S-ACC-0
    && datum.consumed_proposals.length === 0;                        // S-CONSUMED-0
}
