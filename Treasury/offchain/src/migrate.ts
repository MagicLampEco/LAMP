// Logic thuần nhánh MIGRATE-IN — gương của onchain `lib/magiclamp/treasury/migrate.ak`
// (đối xứng `collect.ts` ↔ `collect.ak`, `release.ts` ↔ `release.ak`).
//
// VÌ SAO CÓ NHÁNH NÀY: Reserve nhả Δ LAMP bằng cách MINT. Bản cũ rót Δ vào ĐỊA CHỈ kho
// bằng `.pay.ToAddress(...)`, sinh một UTxO KHÔNG datum; validator giữ kho lại đòi datum
// ⇒ số LAMP đó nằm TRONG SÂN kho mà NGOÀI SỔ kho, không giao dịch nào tiêu lại được.
// Về kế toán, đóng băng ngoài sổ = ĐỐT, chỉ khác tên — trong khi bất biến sản phẩm nói
// LAMP KHÔNG đốt (`Treasury/CONTRACT.md §5`).
//
// NGUYÊN TẮC: đích không phải một ĐỊA CHỈ, mà là một DÒNG SỔ.
//
// Bất biến ÉP (điểm gọi onchain: `validators/custody.ak` nhánh `MigrateIn`):
//   C-MIG-6  mint  — tx.mint chứa ĐÚNG (lamp_policy, token_name), Δ > 0   → `mintOk`
//   C-MIG-7  value — cust_out == cust_in ⊕ Δ, asset khác NGUYÊN           → `valueOk`
//   C-MIG-8  sổ    — ledger_out == ledger_in + Δ tại ĐÚNG MỘT (bucket,asset) → `ledgerOk`
//   C-MIG-9  asset — (lamp_policy, token_name) ∈ accepted_assets          → `assetAccepted`

import { assetKey, isCanonical, ledgerGet, sortLedger, type AssetMap } from "./collect.js";
import { RESERVE_INFLOW_BUCKET_ID, RESERVE_SOURCE_TAG } from "./constants.js";
import type { CustodyDatum, LedgerEntry } from "./types.js";

export { RESERVE_INFLOW_BUCKET_ID, RESERVE_SOURCE_TAG };

// ── C-MIG-9 ────────────────────────────────────────────────────────────────

/** (policy, name) có nằm trong `accepted_assets` không. Kho không nhận asset mà nó
 *  không khai là biết cách chi. Mirror `migrate.asset_accepted`. */
export function assetAccepted(
  accepted: CustodyDatum["accepted_assets"], policy: string, name: string,
): boolean {
  const k = assetKey(policy, name);
  return accepted.some((a) => assetKey(a.policy, a.name) === k);
}

// ── C-MIG-6 ────────────────────────────────────────────────────────────────

/** tx.mint chứa ĐÚNG một cặp (policy, name) với lượng `delta` > 0.
 *
 *  Mirror `migrate.mint_ok`, vốn viết bằng MỘT đẳng thức Value để khoá bốn chiều cùng lúc:
 *  không policy khác · không asset-name khác dưới cùng policy · không lượng âm ở bất kỳ
 *  đâu · không mint rỗng. Ở đây `mint` là AssetMap nên đẳng thức thành "đúng một khoá".
 *
 *  Lovelace bị GỠ trước khi so (Plutus V3 không đặt ada vào trường mint) — phòng thủ cho
 *  biến thể biểu diễn, vô hại vì ada không mint được. */
export function mintOk(mint: AssetMap, policy: string, name: string, delta: bigint): boolean {
  if (delta <= 0n) return false;
  const target = assetKey(policy, name);
  const lovelace = assetKey("", "");
  const entries = Object.entries(mint).filter(([k, v]) => k !== lovelace && v !== 0n);
  return entries.length === 1 && entries[0]![0] === target && entries[0]![1] === delta;
}

// ── C-MIG-7 ────────────────────────────────────────────────────────────────

/** Phần PHI-LOVELACE của value ra khớp TUYỆT ĐỐI value vào ⊕ Δ; lovelace chỉ được TĂNG.
 *
 *  Mirror `migrate.value_ok`. Vế phi-lovelace giữ đẳng thức nên khoá cả hai chiều: asset
 *  đích tăng ĐÚNG Δ, mọi asset khác (NFT authenticity, token thuê bao khác) giữ NGUYÊN.
 *
 *  VÌ SAO LOVELACE LÀ `>=` CHỨ KHÔNG PHẢI `==` (F5): lượt `MigrateIn` ĐẦU TIÊN thêm một
 *  asset MỚI vào value VÀ một dòng vào datum ⇒ min-UTxO của output tăng. Khoá cứng bằng
 *  đẳng thức thì seed thiếu dư địa ADA làm `MigrateIn` bất khả thi VĨNH VIỄN, kéo theo
 *  `ReserveDraw` bất khả thi ⇒ pot khoá. Cái mất, nói thẳng: ADA bơm thêm trong lượt
 *  migrate là phần KHÔNG GHI SỔ, `Release` không rút nó ra được. */
export function valueOk(
  valueIn: AssetMap, valueOut: AssetMap, policy: string, name: string, delta: bigint,
): boolean {
  const lovelace = assetKey("", "");
  if ((valueOut[lovelace] ?? 0n) < (valueIn[lovelace] ?? 0n)) return false;

  const want: AssetMap = {};
  for (const [k, v] of Object.entries(valueIn)) if (k !== lovelace && v !== 0n) want[k] = v;
  const target = assetKey(policy, name);
  want[target] = (want[target] ?? 0n) + delta;

  const keys = new Set([...Object.keys(valueOut), ...Object.keys(want)]);
  for (const k of keys) {
    if (k === lovelace) continue;
    if ((valueOut[k] ?? 0n) !== (want[k] ?? 0n)) return false;
  }
  return true;
}

// ── C-MIG-8 ────────────────────────────────────────────────────────────────

/** Δ kỳ vọng cho MỘT dòng sổ: `delta` nếu dòng đúng khoá đích, 0 nếu không.
 *  Mirror `migrate.line_delta`. */
export function lineDelta(
  e: LedgerEntry, bucketId: bigint, policy: string, name: string, delta: bigint,
): bigint {
  return e.bucket_id === bucketId && assetKey(e.policy, e.name) === assetKey(policy, name)
    ? delta
    : 0n;
}

/** Mỗi dòng OUT == số dư IN của chính khoá đó + Δ kỳ vọng. Mirror `migrate.each_out_line_ok`. */
export function eachOutLineOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[],
  bucketId: bigint, policy: string, name: string, delta: bigint,
): boolean {
  return ledgerOut.every((e) =>
    e.amount === ledgerGet(ledgerIn, e.bucket_id, e.policy, e.name)
      + lineDelta(e, bucketId, policy, name, delta),
  );
}

/** Mọi dòng IN còn hiện diện ở OUT — `MigrateIn` chỉ CỘNG nên không dòng nào cạn về 0,
 *  không có nhánh prune ở đây. Chặn xoá lén một dòng để rút value ra sau này.
 *  Mirror `migrate.each_in_line_settled`. */
export function eachInLineSettled(ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[]): boolean {
  return ledgerIn.every((e) =>
    ledgerOut.some((o) => o.bucket_id === e.bucket_id
      && assetKey(o.policy, o.name) === assetKey(e.policy, e.name)),
  );
}

/** Dòng đích (bucket, asset) PHẢI có mặt trong sổ ra — Δ > 0 nên nó không được phép vắng.
 *
 *  Thiếu vế này thì tx "value tăng, sổ không đổi" LỌT: `eachOutLineOk` chỉ soi những dòng
 *  ĐANG CÓ, nó không biết dòng nào đáng lẽ phải xuất hiện. Mirror `migrate.target_line_present`. */
export function targetLinePresent(
  ledgerOut: LedgerEntry[], bucketId: bigint, policy: string, name: string,
): boolean {
  return ledgerOut.some((e) =>
    e.bucket_id === bucketId && assetKey(e.policy, e.name) === assetKey(policy, name));
}

/** Sổ ra == sổ vào + Δ tại ĐÚNG MỘT (bucket_id, policy, name), dạng canonical.
 *  Mirror `migrate.ledger_ok`. */
export function ledgerOk(
  ledgerIn: LedgerEntry[], ledgerOut: LedgerEntry[],
  bucketId: bigint, policy: string, name: string, delta: bigint,
): boolean {
  return isCanonical(ledgerOut)
    && eachOutLineOk(ledgerIn, ledgerOut, bucketId, policy, name, delta)
    && eachInLineSettled(ledgerIn, ledgerOut)
    && targetLinePresent(ledgerOut, bucketId, policy, name);
}

// ── Bộ dựng: sổ ra + datum ra cho một lượt MigrateIn ───────────────────────

/** Sổ SAU khi nạp Δ vào dòng (RESERVE_INFLOW_BUCKET_ID, policy, name), dạng canonical.
 *
 *  Cộng vào dòng đã có, hoặc THÊM dòng mới nếu chưa có — rồi sắp lại theo thứ tự canonical
 *  mà `isCanonical` (strict-sorted) đòi. Không prune: Δ > 0 nên không dòng nào về 0. */
export function planMigrateLedger(
  ledgerIn: LedgerEntry[], policy: string, name: string, delta: bigint,
): LedgerEntry[] {
  if (delta <= 0n) {
    throw new Error(`TMIG-001: delta phải > 0 (nhận ${delta}) — C-MIG-6 từ chối mint rỗng.`);
  }
  const target = assetKey(policy, name);
  let hit = false;
  const out = ledgerIn.map((e) => {
    if (e.bucket_id === RESERVE_INFLOW_BUCKET_ID && assetKey(e.policy, e.name) === target) {
      hit = true;
      return { ...e, amount: e.amount + delta };
    }
    return { ...e };
  });
  if (!hit) {
    out.push({
      bucket_id: RESERVE_INFLOW_BUCKET_ID,
      policy: policy.toLowerCase(),
      name: name.toLowerCase(),
      amount: delta,
    });
  }
  return sortLedger(out);
}

/** Datum custody SAU lượt MigrateIn: chỉ `ledger` và `epoch` được đổi (C-MIG-3).
 *
 *  Mọi trường khác — instance_id, accepted_assets, governance_ref, cut_bps,
 *  consumed_proposals — bảo toàn NGUYÊN. `consumed_proposals` đặc biệt quan trọng:
 *  `MigrateIn` KHÔNG được làm đường vòng cho `Release`, nên marker single-use giữ y nguyên. */
export function planMigrateDatum(
  datumIn: CustodyDatum, policy: string, name: string, delta: bigint, epoch: bigint,
): CustodyDatum {
  if (!assetAccepted(datumIn.accepted_assets, policy, name)) {
    throw new Error(
      `TMIG-002: (${policy}, ${name}) KHÔNG nằm trong accepted_assets của kho — C-MIG-9 sẽ từ chối. ` +
      `Kho phải khai là nhận asset này trước khi Δ Reserve chảy vào.`,
    );
  }
  if (epoch < datumIn.epoch) {
    throw new Error(
      `TMIG-003: epoch ra (${epoch}) < epoch vào (${datumIn.epoch}) — C-MIG-4 ép epoch không lùi.`,
    );
  }
  return {
    ...datumIn,
    ledger: planMigrateLedger(datumIn.ledger, policy, name, delta),
    epoch,
  };
}
