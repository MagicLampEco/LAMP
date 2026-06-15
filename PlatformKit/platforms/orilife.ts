// PlatformKit · Platform config: OriLife (truy xuất nguồn gốc sinh vật/cây/quả).
//
// OriLife thu phí value-based theo loài/giá trị (mirror OriLifeTrace/field-reid/animal_fee.py
// + orilife-fee/src/tasks.ts). Treasury custody của OriLife nhận phí (LAMP + ADA), chia về 3
// bucket mirror hệ OriLife: PROTOCOL / LAMPNET_REWARD / ANCHOR. cutBps = 700 (7%).
//
// RANH GIỚI: repo OriLife CHỈ ĐỌC — KHÔNG đụng. Ở đây MIRROR công thức pricing (chỉ TÍNH
// amount). Settlement on-chain do Treasury Collect (caller cấp ví + fund).
//
// PRICING: mirror animal_fee.estimate_fee (value-based, có SÀN chống khai thấp, cap theo
// truyền thống). Đây vẫn là STUB ở mức TỈ GIÁ + tham số DAO: số USD chuyển sang LAMP qua
// lampUsd. WIRE THẬT sau: đọc SPECIES_* params + tỉ giá từ on-chain governance/oracle.

import type { PlatformConfig } from "../offchain/src/types.js";
import type { FeeEvent, PriceFn, PricedItem } from "../offchain/src/collectAdapter.js";
import { ADA, asciiToHex, padHash28 } from "./_common.js";

// ── Bucket map (mirror hệ 3-bucket OriLife) ──────────────────────────────────
export const ORILIFE_BUCKETS = {
  PROTOCOL:       0n,   // cut giao thức (orchestrator + anchor) — PROTOCOL_CUT animal_fee.py
  LAMPNET_REWARD: 1n,   // thưởng node LampNet đóng góp phần cứng (Mirage/Cave/Beam/Probe)
  ANCHOR:         2n,   // neo Cardano (MMR root, NFT CIP-68)
} as const;

// ── Tham số DAO-governed — MIRROR animal_fee.py (mặc định) ────────────────────
// Mirror các bảng SPECIES_* để tính amount KHỚP estimate_fee. Đây là MIRROR THUẦN
// (chỉ tính phí) — KHÔNG import từ repo OriLife. DAO production cập nhật on-chain.

export const SPECIES_BASE_FEE_USD: Record<string, number> = {
  cattle: 0.10, pig: 0.05, goat: 0.04, duck: 0.012, chicken: 0.008, dog: 0.05, unknown: 0.02,
};
export const TRADITIONAL_COST_USD: Record<string, number> = {
  cattle: 3.00, pig: 2.00, goat: 1.50, duck: 0.80, chicken: 0.50, dog: 5.00, unknown: 1.00,
};
export const VALUE_FEE_BPS: Record<string, number> = {
  cattle: 1.0, pig: 1.5, goat: 2.0, duck: 3.0, chicken: 4.0, dog: 1.5, unknown: 2.0,
};
export const SPECIES_FLOOR_VALUE_USD: Record<string, number> = {
  cattle: 400.0, pig: 80.0, goat: 60.0, duck: 4.0, chicken: 2.5, dog: 100.0, unknown: 20.0,
};
export const MAX_FRACTION_OF_TRADITIONAL = 0.50;
export const ANCHOR_TIER_MULT: Record<string, number> = {
  no_anchor: 0.3, batch_daily: 1.0, milestone: 1.8, immediate: 6.0,
};
export const DEMAND_MIN = 0.5;
export const DEMAND_MAX = 3.0;
export const LAMP_USD_DEFAULT = 0.01;   // 1 LAMP = $0.01 (oracle TWAP production).

function speciesKey(s: string): string {
  const k = (s || "unknown").toLowerCase();
  return k in SPECIES_BASE_FEE_USD ? k : "unknown";
}

/**
 * Phí USD value-based — MIRROR animal_fee.estimate_fee.
 *   effective_value = max(declared, floor[sp])
 *   value_add       = effective_value × (value_bps[sp] / 10000)
 *   event_mult      = 1 + 0.15 × log2(max(1, lifecycle_events))
 *   raw             = (base[sp] + value_add) × demand × tier_mult × event_mult
 *   fee             = min(raw, traditional[sp] × MAX_FRACTION_OF_TRADITIONAL)   (cap "rẻ hơn")
 */
export function estimateFeeUsd(args: {
  species: string;
  declaredValueUsd?: number;
  lifecycleEvents?: number;
  anchorTier?: string;
  demandFactor?: number;
}): number {
  const declared = args.declaredValueUsd ?? 0;
  const lifecycle = args.lifecycleEvents ?? 1;
  const tier = (args.anchorTier ?? "batch_daily").toLowerCase();
  const demand = args.demandFactor ?? 1.0;

  if (!Number.isFinite(declared) || declared < 0) throw new Error("declaredValueUsd phải hữu hạn ≥ 0");
  if (lifecycle < 1) throw new Error("lifecycleEvents phải ≥ 1");
  if (!Number.isFinite(demand)) throw new Error("demandFactor phải hữu hạn");

  const sp = speciesKey(args.species);
  const df = Math.max(DEMAND_MIN, Math.min(DEMAND_MAX, demand));
  const tierMult = ANCHOR_TIER_MULT[tier] ?? 1.0;

  const base = SPECIES_BASE_FEE_USD[sp]!;
  const effectiveValue = Math.max(declared, SPECIES_FLOOR_VALUE_USD[sp]!);   // P0-2 sàn.
  const valueAdd = effectiveValue * (VALUE_FEE_BPS[sp]! / 10_000.0);
  const eventMult = 1.0 + 0.15 * Math.log2(Math.max(1, lifecycle));
  const raw = (base + valueAdd) * df * tierMult * eventMult;

  const ceiling = TRADITIONAL_COST_USD[sp]! * MAX_FRACTION_OF_TRADITIONAL;
  return Math.min(raw, ceiling);
}

/** USD → oil (LAMP × 10^6, đơn vị nhỏ nhất LAMP). lamp = usd / lampUsd; oil = lamp × 10^6. */
export function usdToOil(feeUsd: number, lampUsd: number = LAMP_USD_DEFAULT): bigint {
  if (!Number.isFinite(lampUsd) || lampUsd <= 0) throw new Error("lampUsd phải hữu hạn, dương");
  const lamp = feeUsd / lampUsd;
  // oil = round(lamp × 10^6). Floor sau khi nhân để giữ BigInt (đơn vị nhỏ nhất).
  return BigInt(Math.round(lamp * 1_000_000));
}

// ── Map sự kiện OriLife → loài/giá trị để định giá ───────────────────────────
// Sự kiện hỗ trợ: tree.verify_add, animal.enroll, animal.verify, fruit.lifecycle.
// Mỗi event mang extra.declaredValueUsd / extra.species / extra.lifecycleEvents / extra.anchorTier.

/** Phí cố định nhỏ (USD) cho sự kiện KHÔNG value-based (verify/scan) — mirror tasks.ts base. */
const FLAT_FEE_USD: Record<string, number> = {
  "tree.verify_add": 0.02,    // ghi thêm cây vào vườn (đăng ký) — value-based qua extra nếu có.
  "animal.verify":   0.008,   // quét định danh sinh vật (không value-based).
  "fruit.lifecycle": 0.006,   // ghi sự kiện vòng đời quả (không value-based).
};

/**
 * Tạo PriceFn OriLife (cần LAMP policy thật + tỉ giá lampUsd runtime).
 * - animal.enroll: value-based theo loài (extra.species/declaredValueUsd) → estimateFeeUsd → oil LAMP.
 * - tree.verify_add: value-based nếu extra.species/declaredValueUsd có; nếu không → phí phẳng.
 * - animal.verify / fruit.lifecycle: phí phẳng nhỏ (không value-based).
 * Thu bằng LAMP (oil), cut về bucket PROTOCOL (orchestrator + anchor).
 *
 * STUB ở tỉ giá lampUsd + tham số DAO. WIRE THẬT: bơm params on-chain + oracle TWAP.
 */
export function makeOriLifePriceFn(opts: {
  lampPolicy: string;
  lampUsd?: number;
}): PriceFn {
  const lampUsd = opts.lampUsd ?? LAMP_USD_DEFAULT;
  const lampName = asciiToHex("LAMP");
  const lamp = { policy: opts.lampPolicy.toLowerCase(), name: lampName };

  return (event: FeeEvent): PricedItem | null => {
    const ex = event.extra ?? {};
    const species = typeof ex.species === "string" ? ex.species : "unknown";
    const declaredValueUsd = typeof ex.declaredValueUsd === "number" ? ex.declaredValueUsd : 0;
    const lifecycleEvents = typeof ex.lifecycleEvents === "number" ? ex.lifecycleEvents : 1;
    const anchorTier = typeof ex.anchorTier === "string" ? ex.anchorTier : undefined;

    let feeUsd: number;
    switch (event.eventType) {
      case "animal.enroll":
        // value-based đầy đủ (loài + giá trị + sàn + cap).
        feeUsd = estimateFeeUsd({
          species, declaredValueUsd, lifecycleEvents,
          ...(anchorTier !== undefined ? { anchorTier } : {}),
        });
        break;
      case "tree.verify_add":
        // value-based nếu khai species/value; nếu species "unknown" + value 0, estimateFeeUsd
        // vẫn cho phí theo sàn unknown — nhưng tác vụ cây dùng phí phẳng làm SÀN tối thiểu.
        feeUsd = Math.max(
          FLAT_FEE_USD["tree.verify_add"]!,
          declaredValueUsd > 0
            ? estimateFeeUsd({ species, declaredValueUsd, lifecycleEvents,
                ...(anchorTier !== undefined ? { anchorTier } : {}) })
            : 0,
        );
        break;
      case "animal.verify":
        feeUsd = FLAT_FEE_USD["animal.verify"]!;
        break;
      case "fruit.lifecycle":
        feeUsd = FLAT_FEE_USD["fruit.lifecycle"]!;
        break;
      default:
        return null;   // sự kiện không thu phí qua adapter này.
    }

    const amount = usdToOil(feeUsd, lampUsd);
    if (amount <= 0n) return null;   // phí 0 (làm tròn) → bỏ qua (không sinh CollectItem rỗng).
    return { asset: lamp, amount, bucketCategory: ORILIFE_BUCKETS.PROTOCOL };
  };
}

/**
 * PlatformConfig OriLife.
 * accepted = [LAMP, ADA]. cutBps = 700 (7% — mirror PROTOCOL_CUT animal_fee.py).
 * governanceRef = committee bootstrap placeholder (WIRE: hash DAO/committee thật).
 */
export function oriLifeConfig(opts: {
  lampPolicy: string;
  registryAuthority: string;
  msPerEpoch: bigint;
  reservedMinAda: bigint;
  genesisRef: { transaction_id: string; output_index: bigint };
  seedPolicy?: string;
  governanceRef?: string;
}): PlatformConfig {
  return {
    platformId: asciiToHex("OriLife"),
    instanceId: asciiToHex("orilife-custody-v1"),
    acceptedAssets: [
      { policy: opts.lampPolicy.toLowerCase(), name: asciiToHex("LAMP") },
      { ...ADA },
    ],
    buckets: [
      { id: ORILIFE_BUCKETS.PROTOCOL,       label: "protocol" },
      { id: ORILIFE_BUCKETS.LAMPNET_REWARD, label: "lampnet_reward" },
      { id: ORILIFE_BUCKETS.ANCHOR,         label: "anchor" },
    ],
    cutBps: 700n,                                   // 7% (PROTOCOL_CUT mirror).
    governanceRef: opts.governanceRef ?? padHash28(asciiToHex("orilife-committee")),
    ...(opts.seedPolicy !== undefined ? { seedPolicy: opts.seedPolicy } : {}),
    msPerEpoch: opts.msPerEpoch,
    reservedMinAda: opts.reservedMinAda,
    registryAuthority: opts.registryAuthority.toLowerCase(),
    genesisRef: opts.genesisRef,
  };
}
