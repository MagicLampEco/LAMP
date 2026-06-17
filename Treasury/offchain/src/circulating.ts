// Circulating supply — KẾ TOÁN thuần (LAMP fixed-supply 36 tỷ, KHÔNG burn).
//
// FIRST-PRINCIPLES (CONTRACT §5):
//   LAMP tổng cung là BẤT BIẾN. "Thu về Treasury" KHÔNG đốt token — chỉ CHUYỂN
//   TRẠNG THÁI một lượng LAMP từ UTxO lưu hành (circulating) sang accounting trong
//   custody Treasury. Value on-chain LUÔN bảo toàn tuyệt đối (Σout = Σin per-asset).
//
//   Do đó "circulating" KHÔNG phải một con số on-chain riêng, cũng KHÔNG phải kết
//   quả của burn. Nó là THUỘC TÍNH KẾ TOÁN suy ra:
//
//       circulating(asset) = total_supply(asset) − Σ balance custody Treasury(asset)
//
//   Σ balance lấy trên TẤT CẢ custody UTxO của instance (hỗ trợ shard-by-asset,
//   CONTRACT §9 T4: nhiều UTxO custody độc lập, off-chain cộng tổng cho circulating).
//
// Các hàm dưới THUẦN (pure) + BigInt (không float). Không hàm nào mint/burn, không
// hàm nào giả định tổng cung thay đổi — total_supply là tham số CỐ ĐỊNH do caller
// truyền (36 tỷ × 10^decimals cho LAMP). Đổi circulating = đổi Σ custody, KHÔNG
// đụng total.

import type { CustodyDatum } from "./types.js";
import type { AssetMap } from "./collect.js";
import { assetKey } from "./collect.js";

// UTxO chỉ cần phần value (assets) — tách khỏi @lucid-evolution/lucid để hàm thuần,
// test không cần dựng UTxO đầy đủ. Tương thích cấu trúc UTxO của Lucid (có .assets).
export interface ValueUtxo {
  assets: Record<string, bigint>;   // unit hex ("lovelace" cho ADA) → quantity
}

/** unit Lucid (policy+name nối, "lovelace" cho ADA) của 1 (policy,name). */
function unitOf(policy: string, name: string): string {
  const p = policy.toLowerCase();
  const n = name.toLowerCase();
  return p === "" ? "lovelace" : `${p}${n}`;
}

/**
 * Số dư của ĐÚNG 1 asset (policy,name) trong value của 1 UTxO.
 * Đọc trực tiếp theo unit → KHÔNG cộng nhầm asset khác (chống double-count khi
 * UTxO đa-asset: chỉ lấy đúng key, mọi asset khác bị bỏ qua).
 */
export function utxoAssetAmount(utxo: ValueUtxo, policy: string, name: string): bigint {
  return utxo.assets[unitOf(policy, name)] ?? 0n;
}

/**
 * treasuryHeld — Σ quantity của 1 asset trên TẤT CẢ custody UTxO (đa shard).
 *
 * Chỉ cộng ĐÚNG asset (policy,name); mọi asset khác trong cùng UTxO (ADA min-UTxO,
 * NFT authenticity, token khác) KHÔNG bị tính → không double-count đa-asset.
 * Mỗi UTxO đóng góp tối đa 1 lần cho asset này (utxoAssetAmount đọc 1 key).
 */
export function treasuryHeld(custodyUtxos: ValueUtxo[], policy: string, name: string): bigint {
  let held = 0n;
  for (const u of custodyUtxos) held += utxoAssetAmount(u, policy, name);
  return held;
}

/**
 * circulatingSupply = total_supply − treasuryHeld (thuộc tính KẾ TOÁN, KHÔNG burn).
 *
 * Bất biến nền: 0 ≤ treasuryHeld ≤ total_supply. Nếu treasuryHeld > total_supply
 * → sổ tổng vỡ (không thể giữ nhiều hơn tổng cung khi fixed-supply không mint) →
 * NÉM lỗi thay vì trả số âm im lặng (an toàn vốn + phát hiện desync sớm).
 *
 * total_supply do caller truyền (cố định, vd 36 tỷ × 10^dec). Hàm KHÔNG đổi total.
 */
export function circulatingSupply(
  totalSupply: bigint,
  custodyUtxos: ValueUtxo[],
  policy: string,
  name: string,
): bigint {
  if (totalSupply < 0n) {
    throw new Error(`CIRC-001: totalSupply âm (${totalSupply}) — tổng cung phải ≥ 0`);
  }
  const held = treasuryHeld(custodyUtxos, policy, name);
  if (held > totalSupply) {
    throw new Error(
      `CIRC-002: treasuryHeld (${held}) > totalSupply (${totalSupply}) — bất biến tổng vỡ `
        + `(custody giữ nhiều hơn tổng cung; LAMP fixed-supply KHÔNG mint thêm). `
        + `Kiểm tra: đúng instance? đúng policy/name? trùng đếm UTxO?`,
    );
  }
  return totalSupply - held;   // ≥ 0 đã đảm bảo
}

/**
 * treasuryHeldByBucket — Σ số dư SỔ theo bucket cho 1 asset, gộp mọi custody datum
 * (đa shard). Trả Map<bucket_id, amount>.
 *
 * Đây là góc nhìn KẾ TOÁN (đọc ledger trong datum), khác treasuryHeld (đọc VALUE
 * thực trên UTxO). So 2 góc nhìn này = đối soát sổ↔value (xem reconcileHeld bên dưới).
 */
export function treasuryHeldByBucket(
  custodyDatums: CustodyDatum[],
  policy: string,
  name: string,
): Map<bigint, bigint> {
  const k = assetKey(policy, name);
  const byBucket = new Map<bigint, bigint>();
  for (const d of custodyDatums) {
    for (const e of d.ledger) {
      if (assetKey(e.policy, e.name) !== k) continue;
      byBucket.set(e.bucket_id, (byBucket.get(e.bucket_id) ?? 0n) + e.amount);
    }
  }
  return byBucket;
}

/** Σ toàn bộ sổ (mọi bucket) của 1 asset, gộp mọi custody datum. */
export function ledgerHeld(
  custodyDatums: CustodyDatum[],
  policy: string,
  name: string,
): bigint {
  const byBucket = treasuryHeldByBucket(custodyDatums, policy, name);
  let total = 0n;
  for (const v of byBucket.values()) total += v;
  return total;
}

// ── Đối soát sổ ↔ value (bất biến nền CONTRACT) ───────────────────────────

export interface ReconcileResult {
  /** Σ ledger(asset) trong datum (mọi bucket). */
  ledgerTotal: bigint;
  /** value(asset) thực trên UTxO − reserved_min_ada (cho lovelace). */
  valueNet: bigint;
  /** valueNet − ledgerTotal (0 nếu khớp). */
  diff: bigint;
  ok: boolean;
}

/**
 * reconcileCustody — kiểm bất biến nền (custody_seed S-SEED-0) cho 1 (utxo, datum):
 *
 *     Σ_b ledger[(b, asset)] == value(asset) − reserved_min_ada(asset)
 *
 * reserved_min_ada CHỈ áp lovelace (policy=""): phần ADA giữ cho min-UTxO, KHÔNG
 * ghi sổ. Mọi asset khác: reserved = 0 → ledgerTotal phải == value.
 *
 * Lệch (diff ≠ 0) = sổ sai (Release sẽ over/under-draw) → phát hiện sớm off-chain.
 */
export function reconcileCustody(
  utxo: ValueUtxo,
  datum: CustodyDatum,
  policy: string,
  name: string,
  reservedMinAda = 0n,
): ReconcileResult {
  const isLovelace = policy === "";
  const reserved = isLovelace ? reservedMinAda : 0n;

  const valueNet = utxoAssetAmount(utxo, policy, name) - reserved;
  const ledgerTotal = ledgerHeld([datum], policy, name);
  const diff = valueNet - ledgerTotal;
  return { ledgerTotal, valueNet, diff, ok: diff === 0n };
}

/**
 * reconcileHeld — đối soát Σ VALUE (treasuryHeld) với Σ SỔ (ledgerHeld) trên toàn
 * bộ custody (đa shard), cho 1 asset. Khác reconcileCustody (1 UTxO): đây là kiểm
 * TỔNG hệ thống.
 *
 * Với lovelace: value gồm reserved_min_ada mỗi shard → trừ Σ reserved (mặc định 0
 * nếu caller không truyền — phù hợp asset ≠ ADA). Trả diff = valueNet − ledgerTotal.
 */
export function reconcileHeld(
  custodyUtxos: ValueUtxo[],
  custodyDatums: CustodyDatum[],
  policy: string,
  name: string,
  totalReservedMinAda = 0n,
): ReconcileResult {
  const reserved = policy === "" ? totalReservedMinAda : 0n;
  const valueNet = treasuryHeld(custodyUtxos, policy, name) - reserved;
  const ledgerTotal = ledgerHeld(custodyDatums, policy, name);
  const diff = valueNet - ledgerTotal;
  return { ledgerTotal, valueNet, diff, ok: diff === 0n };
}

/**
 * snapshot circulating đa-asset (tiện cho dashboard). totalSupplyByAsset: key
 * "policy|name" (như AssetMap) → tổng cung cố định. Trả AssetMap circulating.
 * Mỗi asset độc lập (per-asset), không trộn.
 */
export function circulatingByAsset(
  totalSupplyByAsset: AssetMap,
  custodyUtxos: ValueUtxo[],
): AssetMap {
  const out: AssetMap = {};
  for (const [k, total] of Object.entries(totalSupplyByAsset)) {
    const [policy = "", name = ""] = k.split("|");
    out[k] = circulatingSupply(total, custodyUtxos, policy, name);
  }
  return out;
}
