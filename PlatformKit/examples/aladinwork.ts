// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ VÍ DỤ THAM CHIẾU — KHÔNG phải lõi framework.                                ║
// ║ Mỗi platform tự viết config + pricing của mình TƯƠNG TỰ file này.           ║
// ║ Số liệu/giá ở đây là MINH HOẠ (stub) — Aladin/DAO chốt tham số production.   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Ví dụ: AladinWork (GenieTask, L3) — marketplace đặt-việc nông nghiệp.
// Trả lời §C của AladinWork/Specs/Catalog/CROSS-PLATFORM-REQUESTS.md (+ §7B Farm-W1).
//
// HAI TẦNG PHÍ (§7B) — KHÔNG nhầm lẫn:
//   ① App định giá (PriceFn ở đây): fee = (base[type] + value×bps) × demand × anchor_tier_mult,
//      cap "rẻ hơn truyền thống". Thu LAMP/ADA.
//   ② Protocol cut (Treasury): cut = fee × cutBps/10000 → Treasury bucket (value bảo toàn,
//      LAMP 36 tỷ KHÔNG burn); residual → provider (Genie/dispute pool). Đây là buildCollectTx.
//
//   ⛔ KHÁC HẲN phí mạng on-chain: khi gọi ESCROW redeemer (MutualRelease/Forfeit/PartialSettle)
//      thì MAGIC bị ĐỐT (ConsumeMAGIC, phí mạng). Đó là tầng RIÊNG, cộng thêm — KHÔNG qua PriceFn
//      này, KHÔNG qua Treasury Collect. PriceFn dưới CHỈ lo tầng ① (phí hạ tầng marketplace = LAMP).
//
//   Giá dịch vụ (công thợ) = VND hai bên tự thương lượng off-chain — KHÔNG phải LAMP/MAGIC.
//
// RANH GIỚI: repo AladinWork CHỈ ĐỌC. Ở đây MIRROR công thức (chỉ TÍNH amount LAMP). Settlement
// do Treasury Collect (caller cấp ví + fund). Định danh cây gọi OriLife; escrow/Pledge gọi AladinWork.

import type { PlatformConfig } from "../offchain/src/types.js";
import type { FeeEvent, PriceFn, PricedItem } from "../offchain/src/collectAdapter.js";
import { ADA, asciiToHex, padHash28 } from "../offchain/src/encoding.js";
import { usdToOildrop, LAMP_USD_DEFAULT } from "./orilife.js";

// ── Bucket map marketplace (kế toán custody) ─────────────────────────────────
export const ALADINWORK_BUCKETS = {
  PROTOCOL: 0n,   // cut giao thức AladinWork (vận hành matching/lịch/orchestrator)
  DISPUTE:  1n,   // quỹ tranh chấp/bảo hiểm (LAMP Pledge forfeit chảy về đây — §7B)
  ANCHOR:   2n,   // neo Cardano (A16 task completion MMR root)
} as const;

// ── Tham số DAO-governed — STUB minh hoạ (Aladin chốt) ───────────────────────
// 5 event chuẩn (§7B): tree.identify · task.post · task.complete · residue.test · drone.spray.

/** Phí cơ sở danh nghĩa mỗi event (USD). */
export const TASK_BASE_FEE_USD: Record<string, number> = {
  "tree.identify": 0.004,   // ORL-04 định danh cây — infra OriLife identify (phẳng).
  "task.post":     0.010,   // đăng task — anti-spam + listing.
  "task.complete": 0.020,   // settlement + neo A16 — hoa hồng chính (value-based).
  "residue.test":  0.050,   // ORL-05 lab test — cao hơn (có A12 đối chiếu MRL + A14).
  "drone.spray":   0.030,   // ORL-03 buổi xịt — value theo diện tích.
};

/** bps trên giá trị khai (declaredValueUsd) — chỉ event value-based; còn lại 0. */
export const TASK_VALUE_BPS: Record<string, number> = {
  "task.post":     5,      // 0.05% ngân sách khai (listing nhỏ).
  "task.complete": 300,    // 3% giá trị deal — hoa hồng marketplace chính.
  "drone.spray":   100,    // 1% theo giá trị buổi xịt (diện tích × đơn giá khai).
};

/** Sàn giá trị chống khai thấp (USD) — chỉ event value-based. */
export const TASK_FLOOR_VALUE_USD: Record<string, number> = {
  "task.post":     5,
  "task.complete": 20,
  "drone.spray":   10,
};

/** Chi phí truyền thống cho event PHẲNG (USD) — để cap "rẻ hơn ≤ MAX_FRACTION". */
export const TASK_TRADITIONAL_FLAT_USD: Record<string, number> = {
  "tree.identify": 0.30,   // thẻ tai/QR + sổ tay thủ công.
  "residue.test":  3.00,   // gửi mẫu phòng lab truyền thống.
};

/** Hoa hồng môi giới truyền thống (bps trên giá trị deal) — để cap event value-based.
 *  Môi giới lao động nông nghiệp VN ~15%; ta cap ở MAX_FRACTION của mức này (rẻ hơn ≥ 1/2). */
export const TRADITIONAL_BROKER_BPS = 1500;

export const MAX_FRACTION_OF_TRADITIONAL = 0.50;
export const ANCHOR_TIER_MULT: Record<string, number> = {
  no_anchor: 0.3, batch_daily: 1.0, milestone: 1.8, immediate: 6.0,
};
export const DEMAND_MIN = 0.5;
export const DEMAND_MAX = 3.0;

/** Event nào tính theo giá trị (value-based) — còn lại phẳng. */
function isValueBased(eventType: string): boolean {
  return eventType in TASK_VALUE_BPS;
}

/**
 * Phí USD một event marketplace — mirror cấu trúc OriLife estimateFeeUsd, thích nghi cap.
 *   value_add  = (event value-based) ? effectiveValue × bps/10000 : 0
 *   raw        = (base[type] + value_add) × demand × anchor_tier_mult
 *   cap        = value-based ? effectiveValue × TRADITIONAL_BROKER_BPS/10000 × MAX_FRACTION
 *                            : TRADITIONAL_FLAT[type] × MAX_FRACTION
 *   fee        = min(raw, cap)                                   (cap "rẻ hơn truyền thống")
 * effectiveValue = max(declared, floor[type]) — sàn chống khai thấp.
 */
export function estimateTaskFeeUsd(args: {
  eventType: string;
  declaredValueUsd?: number;
  anchorTier?: string;
  demandFactor?: number;
}): number {
  const base = TASK_BASE_FEE_USD[args.eventType];
  if (base === undefined) throw new Error(`estimateTaskFeeUsd: event lạ '${args.eventType}'`);

  const declared = args.declaredValueUsd ?? 0;
  const demand = args.demandFactor ?? 1.0;
  const tier = (args.anchorTier ?? "batch_daily").toLowerCase();
  if (!Number.isFinite(declared) || declared < 0) throw new Error("declaredValueUsd phải hữu hạn ≥ 0");
  if (!Number.isFinite(demand)) throw new Error("demandFactor phải hữu hạn");

  const df = Math.max(DEMAND_MIN, Math.min(DEMAND_MAX, demand));
  const tierMult = ANCHOR_TIER_MULT[tier] ?? 1.0;

  let valueAdd = 0;
  let ceiling: number;
  if (isValueBased(args.eventType)) {
    const effectiveValue = Math.max(declared, TASK_FLOOR_VALUE_USD[args.eventType] ?? 0);
    valueAdd = effectiveValue * (TASK_VALUE_BPS[args.eventType]! / 10_000.0);
    // cap = % hoa hồng truyền thống × MAX_FRACTION (rẻ hơn môi giới ≥ 1/2).
    ceiling = effectiveValue * (TRADITIONAL_BROKER_BPS / 10_000.0) * MAX_FRACTION_OF_TRADITIONAL;
  } else {
    ceiling = (TASK_TRADITIONAL_FLAT_USD[args.eventType] ?? base * 4) * MAX_FRACTION_OF_TRADITIONAL;
  }

  const raw = (base + valueAdd) * df * tierMult;
  return Math.min(raw, ceiling);
}

/**
 * PriceFn AladinWork (cần LAMP policy thật + tỉ giá lampUsd runtime).
 * Chỉ tầng ① — phí hạ tầng marketplace bằng LAMP, cut về bucket PROTOCOL.
 * extra: declaredValueUsd (ngân sách/giá trị deal), anchorTier, demandFactor.
 *
 * STUB ở tỉ giá lampUsd + bảng tham số. WIRE THẬT: params on-chain governance + oracle TWAP.
 */
export function makeAladinWorkPriceFn(opts: {
  lampPolicy: string;
  lampUsd?: number;
}): PriceFn {
  const lampUsd = opts.lampUsd ?? LAMP_USD_DEFAULT;
  const lamp = { policy: opts.lampPolicy.toLowerCase(), name: asciiToHex("LAMP") };

  return (event: FeeEvent): PricedItem | null => {
    if (!(event.eventType in TASK_BASE_FEE_USD)) return null;   // event không thu qua adapter này.

    const ex = event.extra ?? {};
    const declaredValueUsd = typeof ex.declaredValueUsd === "number" ? ex.declaredValueUsd : 0;
    const anchorTier = typeof ex.anchorTier === "string" ? ex.anchorTier : undefined;
    const demandFactor = typeof ex.demandFactor === "number" ? ex.demandFactor : undefined;

    const feeUsd = estimateTaskFeeUsd({
      eventType: event.eventType,
      declaredValueUsd,
      ...(anchorTier !== undefined ? { anchorTier } : {}),
      ...(demandFactor !== undefined ? { demandFactor } : {}),
    });

    const amount = usdToOildrop(feeUsd, lampUsd);
    if (amount <= 0n) return null;
    return { asset: lamp, amount, bucketCategory: ALADINWORK_BUCKETS.PROTOCOL };
  };
}

/**
 * PlatformConfig AladinWork.
 * accepted = [LAMP, ADA]. cutBps = 1000 (10%) — ĐỀ XUẤT (Aladin/DAO chốt).
 *   Lý do đề xuất 10% (so OriLife 700bps infra / PhoenixKey 500bps danh tính):
 *   marketplace cấp NHIỀU hơn (escrow + dispute + matching + lịch + reputation Jem) → cut cao
 *   hơn hợp lý; vẫn ≪ hoa hồng môi giới truyền thống (~15%). residual → Genie/dispute pool.
 * governanceRef = committee bootstrap placeholder (WIRE: hash DAO/committee thật).
 */
export function aladinWorkConfig(opts: {
  lampPolicy: string;
  registryAuthority: string;
  msPerEpoch: bigint;
  reservedMinAda: bigint;
  genesisRef: { transaction_id: string; output_index: bigint };
  seedPolicy?: string;
  governanceRef?: string;
  cutBps?: bigint;
}): PlatformConfig {
  return {
    platformId: asciiToHex("AladinWork"),
    instanceId: asciiToHex("aladinwork-custody-v1"),
    acceptedAssets: [
      { policy: opts.lampPolicy.toLowerCase(), name: asciiToHex("LAMP") },
      { ...ADA },
    ],
    buckets: [
      { id: ALADINWORK_BUCKETS.PROTOCOL, label: "protocol" },
      { id: ALADINWORK_BUCKETS.DISPUTE,  label: "dispute" },
      { id: ALADINWORK_BUCKETS.ANCHOR,   label: "anchor" },
    ],
    cutBps: opts.cutBps ?? 1000n,                   // 10% — ĐỀ XUẤT, Aladin/DAO chốt.
    governanceRef: opts.governanceRef ?? padHash28(asciiToHex("aladinwork-committee")),
    ...(opts.seedPolicy !== undefined ? { seedPolicy: opts.seedPolicy } : {}),
    msPerEpoch: opts.msPerEpoch,
    reservedMinAda: opts.reservedMinAda,
    registryAuthority: opts.registryAuthority.toLowerCase(),
    genesisRef: opts.genesisRef,
  };
}
