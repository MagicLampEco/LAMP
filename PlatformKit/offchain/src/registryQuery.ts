// PlatformKit registryQuery — discover: "tất cả platform" = tập UTxO mang beacon NFT
// dưới registry_beacon policy. Mỗi platform = 1 beacon NFT (name = platform_id).
//
// THUẦN (không cần chain thật): nhận utxos[] (đã fetch từ provider/blockfrost) → lọc UTxO
// mang token policy beacon → decode inline datum PlatformEntry → trả danh sách platform.
// Caller cấp utxos (vd lucid.utxosAt(registryAddress) hoặc utxosAtWithUnit).
//
// ─── MÔ HÌNH TIN CẬY (audit — đọc kỹ trước khi route phí) ───────────────────
// #2 UNIQUENESS = authority-curated. On-chain KHÔNG ép platform_id duy nhất: registry_beacon
//   chỉ ép R-MINT-1 (mint đúng 1 token/tx) — KHÔNG biết platform_id đã mint trước đó. Tính
//   duy nhất dựa vào registry_authority (committee→DAO) KHÔNG ký 2 lần cùng platform_id.
//   discoverPlatforms.findDuplicatePlatformIds = VAN dedup off-chain: nếu authority lỗi/bị
//   lậm thì vẫn phát hiện được 2 entry trùng id → KHÔNG im lặng chọn cái đầu.
// #3 entry ở script LẠ: beacon NFT có thể nằm ở UTxO ngoài registry validator (vd kẻ tấn công
//   gửi NFT tới địa chỉ khác). Cấp registryScriptHash → cảnh báo entry không ở registry thật.
// #4 AUTHORITY NÊN là MULTISIG/COMMITTEE, KHÔNG 1 vkh. registry_beacon hiện param 1 ByteArray
//   (1 key-hash) → single point of failure (1 khoá rò = chiếm tên/onboard rác). KNOWN-GAP:
//   nâng authority lên native/Plutus multisig (M-of-N) hoặc DAO gate trước mainnet.
// #6 entry "nói dối" custody: discover CHỈ đọc datum — KHÔNG đủ tin. Phải verifyEntryAgainstCustody
//   với UTxO custody THẬT (NFT authenticity @ Script(custody_hash)) trước khi tin entry trỏ
//   đúng custody. On-chain R-BIND ép lúc ĐĂNG KÝ; nhưng reader hậu kỳ nên đối soát lại.

import { Data } from "@lucid-evolution/lucid";
import type { PlatformEntry, PlatformStatus } from "./types.js";
import { decodePlatformEntry } from "./registryDatum.js";

/** Abstraction UTxO tối thiểu (subset của lucid UTxO) — đủ để query thuần. */
export interface QueryUtxo {
  /** value: unit (policyId‖assetNameHex, "lovelace" cho ADA) → amount. */
  assets: Record<string, bigint>;
  /** inline datum CBOR hex (undefined nếu không có). */
  datum?: string | null;
  /** payment credential script hash của địa chỉ UTxO (hex 28-byte). Tuỳ chọn — cấp để
   *  đối soát audit #3 (entry ở script lạ) + verifyEntryAgainstCustody (== custody_hash). */
  scriptHash?: string;
  /** ngữ cảnh tham chiếu (tuỳ chọn — caller giữ để spend sau). */
  txHash?: string;
  outputIndex?: number;
}

/** Một platform đã discover: entry decode + UTxO gốc (để spend khi UpdateEntry). */
export interface DiscoveredPlatform {
  entry: PlatformEntry;
  /** unit beacon NFT mang entry này (policy‖platform_id). */
  nftUnit: string;
  utxo: QueryUtxo;
  /** TRUE nếu platform_id này xuất hiện ≥2 lần trong lô discover (audit #2 — không tin mù). */
  duplicate: boolean;
  /** TRUE nếu cấp registryScriptHash VÀ utxo.scriptHash != registryScriptHash (audit #3). */
  foreignScript?: boolean;
}

function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

/** Quantity của (policy, name) trong value UTxO. unit = policy‖name (hex). */
function quantityOf(assets: Record<string, bigint>, policy: string, name: string): bigint {
  const unit = normHex(policy) + normHex(name);
  return assets[unit] ?? 0n;
}

/** Tất cả token (name → qty) dưới một policy trong value UTxO. */
function tokensOfPolicy(assets: Record<string, bigint>, policy: string): Map<string, bigint> {
  const pol = normHex(policy);
  const out = new Map<string, bigint>();
  for (const [unit, amt] of Object.entries(assets)) {
    if (unit === "lovelace") continue;
    if (unit.slice(0, 56).toLowerCase() === pol) {
      out.set(unit.slice(56).toLowerCase(), amt);
    }
  }
  return out;
}

/**
 * Discover tất cả platform từ một lô UTxO của registry, theo beacon policy.
 * Lọc UTxO mang đúng 1 token policy này (name = platform_id) + có inline datum →
 * decode PlatformEntry. Bỏ qua UTxO không mang token / không datum / datum sai cấu trúc
 * (theo `strict`: false = bỏ qua im lặng; true = ném lỗi khi decode fail).
 *
 * KIỂM tính toàn vẹn: entry.platform_id PHẢI khớp NFT name (như on-chain R-NAME). UTxO lệch
 * (datum khai platform_id khác token name) bị loại — chống entry "giả".
 *
 * AUDIT #2 (duplicate): on-chain KHÔNG ép platform_id duy nhất (xem header). Sau khi gom,
 * đánh dấu MỌI entry trùng platform_id `duplicate=true` — KHÔNG im lặng chọn cái đầu. Caller
 * route phí PHẢI tự xử lý (vd từ chối, hoặc đối soát custody để chọn entry thật).
 * AUDIT #3 (script lạ): nếu cấp opts.registryScriptHash, đánh dấu entry mà utxo.scriptHash
 * khác registry thật `foreignScript=true` (beacon NFT bị gửi ra ngoài registry validator).
 */
export function discoverPlatforms(
  utxos: QueryUtxo[], beaconPolicy: string,
  opts: { strict?: boolean; registryScriptHash?: string } = {},
): DiscoveredPlatform[] {
  const strict = opts.strict ?? false;
  const regHash = opts.registryScriptHash !== undefined ? normHex(opts.registryScriptHash) : undefined;
  const pol = normHex(beaconPolicy);
  const out: DiscoveredPlatform[] = [];

  for (const u of utxos) {
    const tokens = tokensOfPolicy(u.assets, pol);
    if (tokens.size === 0) continue;                  // không mang beacon NFT → không phải entry.

    // Mỗi entry UTxO mang đúng 1 beacon NFT (R-MINT-1/R-OUT-1). Nếu >1 → cấu trúc lạ, bỏ/ném.
    if (tokens.size !== 1) {
      if (strict) throw new Error(`QUERY-001: UTxO mang ${tokens.size} token beacon (kỳ vọng 1)`);
      continue;
    }
    const [nftName, qty] = [...tokens.entries()][0]!;
    if (qty !== 1n) {
      if (strict) throw new Error(`QUERY-002: beacon NFT '${nftName}' qty ${qty} (kỳ vọng 1)`);
      continue;
    }
    if (!u.datum) {
      if (strict) throw new Error(`QUERY-003: entry UTxO '${nftName}' thiếu inline datum`);
      continue;
    }

    let entry: PlatformEntry;
    try {
      entry = decodePlatformEntry(Data.from(u.datum));
    } catch (e) {
      if (strict) throw e;
      continue;
    }

    // R-NAME gương: entry.platform_id == NFT name. Lệch = entry giả → loại.
    if (normHex(entry.platform_id) !== nftName) {
      if (strict) {
        throw new Error(
          `QUERY-004: entry.platform_id (${entry.platform_id}) != NFT name (${nftName})`,
        );
      }
      continue;
    }

    // AUDIT #3: entry ở script lạ (NFT beacon nằm ngoài registry validator thật).
    // Chỉ set foreignScript khi cấp registryScriptHash (tránh undefined dưới exactOptional).
    const base = { entry, nftUnit: pol + nftName, utxo: u, duplicate: false };
    if (regHash !== undefined) {
      const foreignScript = u.scriptHash === undefined || normHex(u.scriptHash) !== regHash;
      out.push({ ...base, foreignScript });
    } else {
      out.push(base);
    }
  }

  // AUDIT #2: đánh dấu MỌI entry có platform_id trùng (≥2 lần) trong lô — không tin mù.
  const counts = new Map<string, number>();
  for (const p of out) {
    const id = normHex(p.entry.platform_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const p of out) {
    if ((counts.get(normHex(p.entry.platform_id)) ?? 0) > 1) p.duplicate = true;
  }

  return out;
}

/**
 * AUDIT #2 — trả map platform_id (hex) → các DiscoveredPlatform TRÙNG (≥2). Rỗng = sạch.
 * Caller route phí PHẢI kiểm map này khác rỗng trước khi tin findPlatform (findPlatform trả
 * cái ĐẦU — không an toàn khi có trùng). Nguồn trùng: authority lỗi/bị lậm (xem header #2).
 */
export function findDuplicatePlatformIds(
  platforms: DiscoveredPlatform[],
): Map<string, DiscoveredPlatform[]> {
  const groups = new Map<string, DiscoveredPlatform[]>();
  for (const p of platforms) {
    const id = normHex(p.entry.platform_id);
    const g = groups.get(id) ?? [];
    g.push(p);
    groups.set(id, g);
  }
  const dups = new Map<string, DiscoveredPlatform[]>();
  for (const [id, g] of groups) {
    if (g.length > 1) dups.set(id, g);
  }
  return dups;
}

/**
 * AUDIT #6 — ĐỐI SOÁT entry với custody UTxO THẬT. discover chỉ đọc datum → KHÔNG đủ tin:
 * entry có thể khai custody_hash/seed_policy/instance_id BẤT KỲ. Hàm này kiểm entry trỏ đúng
 * custody thật, GƯƠNG R-BIND on-chain (registry_beacon.ak):
 *   1. quantity_of(custodyUtxo.value, entry.seed_policy, entry.instance_id) == 1  (NFT authenticity)
 *   2. custodyUtxo payment credential (script hash) == entry.custody_hash         (đúng địa chỉ)
 * Trả {ok, reason}. KHÔNG tin entry để route phí tới custody NẾU chưa verify against custody thật.
 *
 * custodyUtxo.scriptHash phải được caller điền từ địa chỉ UTxO custody (payment credential).
 */
export function verifyEntryAgainstCustody(
  entry: PlatformEntry, custodyUtxo: QueryUtxo,
): { ok: boolean; reason?: string } {
  const qty = quantityOf(custodyUtxo.assets, entry.seed_policy, entry.instance_id);
  if (qty !== 1n) {
    return {
      ok: false,
      reason: `custody UTxO mang ${qty} NFT authenticity (seed_policy=${normHex(entry.seed_policy)}, `
        + `instance_id=${normHex(entry.instance_id)}) — kỳ vọng đúng 1 (R-BIND #1)`,
    };
  }
  if (custodyUtxo.scriptHash === undefined) {
    return {
      ok: false,
      reason: "custodyUtxo.scriptHash trống — không đối soát được với entry.custody_hash (R-BIND #2)",
    };
  }
  if (normHex(custodyUtxo.scriptHash) !== normHex(entry.custody_hash)) {
    return {
      ok: false,
      reason: `custody address script hash (${normHex(custodyUtxo.scriptHash)}) != `
        + `entry.custody_hash (${normHex(entry.custody_hash)}) — entry trỏ custody SAI (R-BIND #2)`,
    };
  }
  return { ok: true };
}

/** Lọc platform theo status (vd chỉ Active để route phí). */
export function filterByStatus(
  platforms: DiscoveredPlatform[], status: PlatformStatus,
): DiscoveredPlatform[] {
  return platforms.filter((p) => p.entry.status === status);
}

/** Tìm 1 platform theo platform_id (hex). undefined nếu không có. */
export function findPlatform(
  platforms: DiscoveredPlatform[], platformId: string,
): DiscoveredPlatform | undefined {
  const id = normHex(platformId);
  return platforms.find((p) => normHex(p.entry.platform_id) === id);
}

/** Tiện ích: quantity beacon NFT của 1 platform trong UTxO (kiểm hiện diện). */
export function platformNftPresent(
  u: QueryUtxo, beaconPolicy: string, platformId: string,
): boolean {
  return quantityOf(u.assets, beaconPolicy, platformId) === 1n;
}
