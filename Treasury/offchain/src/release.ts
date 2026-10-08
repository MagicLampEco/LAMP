// Logic thuần nhánh RELEASE — mirror onchain lib/magiclamp/treasury/release.ak.
// Tách khỏi tx builder để test đơn vị + tự kiểm bất biến TRƯỚC khi dựng tx
// (fail-fast trước khi submit tốn phí). Model A (CONTRACT §4,§9 T1/T5; TECH §7).
//
// BẤT BIẾN ÉP (khớp release.ak):
//   C-REL-3  spend_spec_hash(seed_policy, instance_id, draws) == proposal.spend_spec_hash
//   C-REL-5  ∀a custody_out.value(a) == custody_in.value(a) − Σdraw(a)  (Σout=Σin, KHÔNG burn)
//   C-REL-6  ledger_out[(b,a)] == ledger_in[(b,a)] − Σdraw(b,a) ∧ draw ≤ số dư bucket
//   C-REL-7  Σ output tới `to` value(a) == Σ draw(to,a) ∧ to ≠ custody  (tổng-khớp). On-chain đo
//            RÒNG (trừ input cùng payment credential, CONTRACT §17) — builder không tiêu input tại
//            `to` (`drawAtSpenderCredential`) nên mirror chỉ-output ở đây khớp.
//
// spend_spec_hash = blake2b_256( 0x03 ‖ blake2b_256(seed_policy) ‖ blake2b_256(instance_id)
//                                     ‖ blake2b_256(cbor.serialise(draws)) )
// F10/#1B gắn instance_id; P7 gắn thêm seed_policy (định danh DUY NHẤT của kho) — xem
// `spendSpecHash`. Ba thành phần blake2b đều 32 byte → ghép KHÔNG nhập nhằng biên byte
// (mirror `release.ak` ▸ `spend_spec_hash`). drawsCbor = Data.to(encodeReleaseDraw[]).
// Vector kiểm chéo aiken↔TS: `release_test.ak` ▸ `spend_spec_hash_vector_*` và
// `release.test.ts` khối "spend_spec_hash canonical" dùng CHUNG một hex.

import { Data } from "@lucid-evolution/lucid";
import { blake2b } from "@noble/hashes/blake2b";

import type { Address, LedgerEntry, ReleaseDraw } from "./types.js";
import { encodeAddress, encodeReleaseDraw } from "./datum.js";
import {
  type AssetMap, assetKey, ledgerGet, isCanonical, canonicalizeLedger,
} from "./collect.js";

// Domain tag 0x03 — tách khỏi merkle leaf(0x00)/node(0x01) và khỏi bản trước 0x02 (chưa gắn
// seed_policy), để một spec_hash tính theo công thức cũ không bao giờ khớp công thức mới.
export const SPEND_SPEC_PREFIX = 0x03;

// ── byte helpers (no Buffer — portable) ──

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error(`RELEASE-000: odd hex length: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`RELEASE-001: invalid hex: ${hex}`);
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ── C-REL-3: spend_spec_hash canonical ──

/** CBOR canonical của danh sách draw (Plutus Data) — khớp aiken cbor.serialise(draws). */
export function drawsCbor(draws: ReleaseDraw[]): string {
  // Lucid serialise List<Data> như indefinite-array (9f..ff) — khớp Aiken List.
  return Data.to(draws.map(encodeReleaseDraw));
}

/**
 * spend_spec_hash = blake2b_256( 0x03 ‖ blake2b_256(seed_policy) ‖ blake2b_256(instance_id)
 *                                     ‖ blake2b_256(cbor(draws)) ).
 * Khóa CẢ kho đích lẫn đích chi. Mirror BYTE-PERFECT release.ak
 * spend_spec_hash(seed_policy, instance_id, draws):
 *   custody_h = blake2b_256(seedPolicyBytes)         — 32 byte
 *   id_h      = blake2b_256(instanceIdBytes)         — 32 byte
 *   draws_h   = blake2b_256(drawsCbor)               — 32 byte
 *   preimage  = 0x03 ‖ custody_h ‖ id_h ‖ draws_h    — 1 + 3×32 = 97 byte (biên cố định)
 *   hash      = blake2b_256(preimage)
 *
 * `seedPolicy` là policy id của NFT chứng thực kho (tham số apply `seed_policy` của custody).
 * Nó phải có vì `instance_id` do người gieo tự đặt và KHÔNG duy nhất: hai kho khác hạt giống
 * trùng `instance_id` từng cùng khớp một proposal và bị tiêu chung một tx để chi 2× (P7). Lý
 * lẽ chọn `seed_policy` thay cho script hash của custody: `release.ak` ▸ `spend_spec_hash`.
 *
 * Hex → bytes (KHÔNG hash chuỗi hex). Rỗng hoặc không phải hex thì NÉM — một seedPolicy rỗng
 * vẫn băm ra được một hash hợp lệ về hình dạng, và hash đó không khớp kho nào.
 */
export function spendSpecHash(seedPolicy: string, instanceId: string, draws: ReleaseDraw[]): string {
  if (!/^[0-9a-fA-F]+$/.test(seedPolicy) || seedPolicy.length % 2 !== 0) {
    throw new Error(
      `RELEASE-SEED: seedPolicy = "${seedPolicy}" — cần policy id hex của NFT chứng thực kho ` +
      `(tham số seed_policy của custody). spend_spec_hash gắn kho đích qua trường này.`,
    );
  }
  const custodyH = blake2b(hexToBytes(seedPolicy), { dkLen: 32 });
  const idH = blake2b(hexToBytes(instanceId), { dkLen: 32 });
  const drawsH = blake2b(hexToBytes(drawsCbor(draws)), { dkLen: 32 });
  const pre = new Uint8Array(1 + custodyH.length + idH.length + drawsH.length);
  pre[0] = SPEND_SPEC_PREFIX;                          // 0x03 ‖ custody_h ‖ id_h ‖ draws_h
  pre.set(custodyH, 1);
  pre.set(idH, 1 + custodyH.length);
  pre.set(drawsH, 1 + custodyH.length + idH.length);
  return bytesToHex(blake2b(pre, { dkLen: 32 }));
}

// ── Σ draw aggregations (mirror drawn_of_asset / drawn_of_line / drawn_value) ──

/** Tổng rút của 1 asset trên mọi draw (gộp mọi bucket). */
export function drawnOfAsset(draws: ReleaseDraw[], policy: string, name: string): bigint {
  const k = assetKey(policy, name);
  return draws.reduce((acc, d) => (assetKey(d.policy, d.name) === k ? acc + d.amount : acc), 0n);
}

/** Tổng rút của (bucket, asset) — Δ kỳ vọng cho 1 dòng sổ. */
export function drawnOfLine(
  draws: ReleaseDraw[], bucketId: bigint, policy: string, name: string,
): bigint {
  const k = assetKey(policy, name);
  return draws.reduce(
    (acc, d) =>
      (d.bucket_id === bucketId && assetKey(d.policy, d.name) === k ? acc + d.amount : acc),
    0n,
  );
}

/** Value gồm đúng Σ draw per-asset (để dựng đẳng thức value). */
export function drawnValue(draws: ReleaseDraw[]): AssetMap {
  const out: AssetMap = {};
  for (const d of draws) {
    const k = assetKey(d.policy, d.name);
    out[k] = (out[k] ?? 0n) + d.amount;
  }
  return out;
}

// ── C-REL-5: value bảo toàn ĐÚNG số rút (đẳng thức tuyệt đối, KHÔNG burn/drain) ──
// custody_out.value == custody_in.value ⊖ drawn_value(draws).

/** value_out kỳ vọng = value_in ⊖ Σdraw (per-asset). Dùng để BUILD custody output. */
export function applyDraws(valueIn: AssetMap, draws: ReleaseDraw[]): AssetMap {
  const out: AssetMap = { ...valueIn };
  const drawn = drawnValue(draws);
  for (const [k, amt] of Object.entries(drawn)) {
    out[k] = (out[k] ?? 0n) - amt;
  }
  return out;
}

/** value_ok onchain: value_out KHỚP TUYỆT ĐỐI value_in ⊖ Σdraw (Σout=Σin per-asset). */
export function valueOk(valueIn: AssetMap, valueOut: AssetMap, draws: ReleaseDraw[]): boolean {
  const want = applyDraws(valueIn, draws);
  const keys = new Set([...Object.keys(valueIn), ...Object.keys(valueOut), ...Object.keys(want)]);
  for (const k of keys) {
    if ((valueOut[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  }
  return true;
}

// ── C-REL-6: sổ giảm đúng bucket + draw ≤ số dư bucket ──

export function allDrawsNonneg(draws: ReleaseDraw[]): boolean {
  return draws.every((d) => d.amount >= 0n);
}

/**
 * Dựng ledger_out CANONICAL từ ledger_in: trừ Σdraw tại đúng (bucket,asset), PRUNE dòng
 * cạn về 0, SORT theo khóa (khớp is_canonical on-chain — strict-sorted ∧ mọi dòng > 0).
 * Đơn-bucket incremental. Dòng draw không khớp dòng nào ⇒ over-draw từ 0 → canonicalize
 * sinh dòng âm → ném LEDGER-NEG (ledgerOk/over-draw reject sớm). Dòng cạn về 0 bị prune.
 */
export function planLedgerOut(ledgerIn: LedgerEntry[], draws: ReleaseDraw[]): LedgerEntry[] {
  const raw = ledgerIn.map((e) => {
    const delta = drawnOfLine(draws, e.bucket_id, e.policy, e.name);
    return delta === 0n ? { ...e } : { ...e, amount: e.amount - delta };
  });
  return canonicalizeLedger(raw);
}

/** Mọi dòng out == get(in) − Σdraw(bucket,asset). */
export function eachOutLineOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], draws: ReleaseDraw[],
): boolean {
  return ledgerOut.every((e) => {
    const want = ledgerGet(ledgerIn, e.bucket_id, e.policy, e.name)
      - drawnOfLine(draws, e.bucket_id, e.policy, e.name);
    return e.amount === want;
  });
}

/** Mọi dòng in còn trong out (chống xóa dòng = drain sổ ngược). */
export function eachInLinePresent(ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[]): boolean {
  return ledgerIn.every((e) =>
    ledgerOut.some(
      (o) => o.bucket_id === e.bucket_id && assetKey(o.policy, o.name) === assetKey(e.policy, e.name),
    ),
  );
}

/** each_in_line_settled on-chain: mọi dòng IN còn trong OUT, TRỪ khi số dư mới
 *  (in − Σdraw) == 0 thì được prune (vắng). */
export function eachInLineSettled(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], draws: ReleaseDraw[],
): boolean {
  return ledgerIn.every((e) => {
    const newBal = e.amount - drawnOfLine(draws, e.bucket_id, e.policy, e.name);
    if (newBal === 0n) return true;
    return ledgerOut.some(
      (o) => o.bucket_id === e.bucket_id && assetKey(o.policy, o.name) === assetKey(e.policy, e.name),
    );
  });
}

/** Mọi draw rút KHÔNG quá số dư bucket: Σdraw(b,a) ≤ ledger_in[(b,a)]. */
export function drawsWithinBalance(ledgerIn: LedgerEntry[], draws: ReleaseDraw[]): boolean {
  return draws.every(
    (d) => drawnOfLine(draws, d.bucket_id, d.policy, d.name)
      <= ledgerGet(ledgerIn, d.bucket_id, d.policy, d.name),
  );
}

/** ledger_ok onchain: all_draws_nonneg ∧ is_canonical(out) ∧ each_out_line_ok ∧
 *  each_in_line_settled ∧ draws_within_balance. is_canonical = strict-sorted ∧ mọi dòng > 0
 *  (loại trùng khóa O(n) + chống dòng 0/âm; dòng cạn về 0 bị prune). */
export function ledgerOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[], draws: ReleaseDraw[],
): boolean {
  return allDrawsNonneg(draws)
    && isCanonical(ledgerOut)
    && eachOutLineOk(ledgerIn, ledgerOut, draws)
    && eachInLineSettled(ledgerIn, ledgerOut, draws)
    && drawsWithinBalance(ledgerIn, draws);
}

// ── C-REL-7: người nhận đúng (tổng-khớp per (to,asset), to ≠ custody) ──
// Khóa địa chỉ tất định: serialise Address → CBOR hex làm khóa gộp (mirror so == on-chain).

/** Khóa tất định cho 1 Address (serialise CBOR — so sánh == như on-chain o.address == to). */
export function addressKey(a: Address): string {
  return Data.to(encodeAddress(a));
}

/** to là chính custody script hash? (chống rút vòng về kho né C-REL-5). */
export function toIsCustody(to: Address, custodyHash: string): boolean {
  return to.payment_credential.kind === "Script"
    && to.payment_credential.hash.toLowerCase() === custodyHash.toLowerCase();
}

/** Σ draw tới (to,asset). */
export function drawnTo(draws: ReleaseDraw[], toKey: string, policy: string, name: string): bigint {
  const ak = assetKey(policy, name);
  return draws.reduce(
    (acc, d) => (addressKey(d.to) === toKey && assetKey(d.policy, d.name) === ak ? acc + d.amount : acc),
    0n,
  );
}

/** Một output (off-chain hình thức) tới 1 address với value đa-asset. */
export interface RecipientOutput {
  to:    Address;
  value: AssetMap;
}

/** Σ value(asset) của mọi output GỬI tới `toKey`. */
export function outputSumTo(
  outputs: RecipientOutput[], toKey: string, policy: string, name: string,
): bigint {
  const ak = assetKey(policy, name);
  return outputs.reduce(
    (acc, o) => (addressKey(o.to) === toKey ? acc + (o.value[ak] ?? 0n) : acc),
    0n,
  );
}

/**
 * Gương off-chain của recipients_ok: mỗi draw — Σ output tới `to` ≥ Σ draw(to,asset) ∧ to ≠ custody.
 * On-chain đo RÒNG (trừ input cùng payment credential với `to`, CONTRACT §17); hàm này chỉ thấy
 * output nên khớp on-chain khi giao dịch không tiêu input nào cùng credential với `to` — builder
 * chặn ca đó bằng RELEASE-007c (`drawAtSpenderCredential`).
 * (Off-chain BUILDER dựng output đúng Σ nên đẳng thức; ép ≥ để mirror on-chain.)
 */
export function recipientsOk(
  outputs: RecipientOutput[], draws: ReleaseDraw[], custodyHash: string,
): boolean {
  return draws.every((d) => {
    if (toIsCustody(d.to, custodyHash)) return false;
    const toKey = addressKey(d.to);
    return outputSumTo(outputs, toKey, d.policy, d.name) >= drawnTo(draws, toKey, d.policy, d.name);
  });
}

/**
 * C-REL-7 đo RÒNG (CONTRACT §17): on-chain trừ Σ MỌI input có cùng payment credential với
 * `to`. `recipientsOk` ở trên chỉ nhìn output nên chỉ đúng khi tx KHÔNG tiêu input nào tại
 * credential của một `to`. Builder chỉ tiêu custody + UTxO của ví dựng tx, nên điều kiện đó
 * tương đương: payment credential của ví dựng tx ≠ mọi `to`. Trả về draw đầu tiên trùng
 * (để báo lỗi), hoặc `undefined`. So theo hash (VK và script cùng hash 28 byte coi như trùng —
 * bảo thủ).
 */
export function drawAtSpenderCredential(
  spenderPaymentHash: string, draws: ReleaseDraw[],
): ReleaseDraw | undefined {
  const h = spenderPaymentHash.toLowerCase();
  return draws.find((d) => d.to.payment_credential.hash.toLowerCase() === h);
}

// ── Plan recipient outputs: gộp Σ draw theo (to,asset) → 1 output/recipient ──
// Đầu ra để builder dựng + tự kiểm recipients_ok. Σ output == Σ draw (đẳng thức,
// khớp C-REL-5 value rời custody). KHÔNG gộp 2 recipient khác address.

export function planRecipientOutputs(draws: ReleaseDraw[]): RecipientOutput[] {
  const byAddr = new Map<string, { to: Address; value: AssetMap }>();
  for (const d of draws) {
    const k = addressKey(d.to);
    let rec = byAddr.get(k);
    if (!rec) {
      rec = { to: d.to, value: {} };
      byAddr.set(k, rec);
    }
    const ak = assetKey(d.policy, d.name);
    rec.value[ak] = (rec.value[ak] ?? 0n) + d.amount;
  }
  return [...byAddr.values()];
}
