// Deposits schedule — phí cọc CÓ THẨM QUYỀN tính từ DepositParam beacon.
// Mirror onchain lib/magiclamp/deposits/schedule.ak. Pure BigInt, KHÔNG float.
//
//   required(asset_type, value_tier, lifecycle_class)
//     = base_deposit[hàng khớp] × demand_mult / Q   (Q=1e9, floor division)
//
// base_deposit = 0 hợp lệ → cọc ≈ 0 (dưa leo). Phân loại không có trong bảng → null
// (offchain tự kiểm trước khi build → fail-fast, không submit tx hỏng).

import type { DepositParam, DepositTier } from "./types.js";

/** Scale factor Q (1.0× = 1e9). */
export const Q = 1_000_000_000n;

/** Tìm base_deposit cho khóa (asset_type, value_tier, lifecycle_class). */
export function lookupBase(
  tiers: DepositTier[], assetType: bigint, valueTier: bigint, lifecycleClass: bigint,
): bigint | undefined {
  const t = tiers.find(
    (x) => x.asset_type === assetType && x.value_tier === valueTier && x.lifecycle_class === lifecycleClass,
  );
  return t ? t.base_deposit : undefined;
}

/** Bất biến datum DepositParam: 0 ≤ m_min ≤ demand_mult ≤ m_max; mọi base_deposit ≥ 0. */
export function validParam(pp: DepositParam): boolean {
  return (
    pp.m_min >= 0n &&
    pp.m_min <= pp.m_max &&
    pp.demand_mult >= pp.m_min &&
    pp.demand_mult <= pp.m_max &&
    pp.tiers.every((t) => t.base_deposit >= 0n)
  );
}

/** Phí cọc bắt buộc cho phân loại (oil). Floor division (BigInt). undefined nếu
 *  phân loại không có trong bảng (chống tier giả né phí). */
export function requiredFor(
  pp: DepositParam, assetType: bigint, valueTier: bigint, lifecycleClass: bigint,
): bigint | undefined {
  const base = lookupBase(pp.tiers, assetType, valueTier, lifecycleClass);
  if (base === undefined) return undefined;
  return (base * pp.demand_mult) / Q;
}
