// TIGER per-epoch attribution — phân rã entitlement E_i ra TỪNG epoch lịch sử.
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO (mục tiêu minh bạch cho delegator)
//
//   `computeEntitlements` (entitlement.ts) cộng dồn stake qua mọi snapshot rồi chỉ
//   trả con số CUỐI E_i. Delegator muốn KIỂM TRA: "mỗi epoch lịch sử, pot TIGER
//   được bao nhiêu LAMP, và TÔI nhận bao nhiêu trong epoch đó?". File này phân rã.
//
//   Bài toán (tất định, bảo toàn oil):
//     grandTotal     = Σ_o accStake_o = Σ_e totalStake_e
//     totalStake_e   = Σ_o stake_{o,e}                       (tổng stake epoch e)
//     potOil_e       ∝ totalStake_e   → Σ_e potOil_e = distributed   (tổng pot epoch e)
//     ownerShare_e   ∝ stake_{i,e}    → Σ_e ownerShare_e = E_i        (phần ví i epoch e)
//
//   ownerShare CHIA TỪ E_i THẬT (đầu ra computeEntitlements, đã gồm cap + dư floor),
//   nên Σ_e ownerShare_e == E_i CHÍNH XÁC kể cả khi ví bị cap — bảng cộng đúng số
//   on-chain delegator sẽ nhận. potOil chia từ `distributed` (Σ E_i) nên Σ = distributed.
//
//   Chia số nguyên: phương pháp DƯ-LỚN-NHẤT (Hamilton) — floor theo tỉ lệ rồi rải
//   phần dư cho các mục có phần thập phân lớn nhất (tie → epoch sớm hơn). Tất định,
//   bảo toàn tuyệt đối (Σ phần == total), không tạo/huỷ oil.

import { computeEntitlements } from "./entitlement.js";
import type {
  EntitlementParams,
  SnapshotSet,
} from "./types.js";

/** Chia `total` (oil) theo `weights` (≥0) → mảng số nguyên Σ == total (Hamilton).
 *  weights toàn 0 hoặc total ≤ 0 → mảng 0. Tie phần-dư → chỉ-số NHỎ hơn trước. */
export function apportion(total: bigint, weights: bigint[]): bigint[] {
  const n = weights.length;
  const out = new Array<bigint>(n).fill(0n);
  if (total <= 0n || n === 0) return out;
  let W = 0n;
  for (const w of weights) {
    if (w < 0n) throw new Error("ATTR-000: weight phải ≥ 0");
    W += w;
  }
  if (W === 0n) return out;

  // floor + giữ phần dư = total*w mod W để xếp hạng.
  const rema: { idx: number; rem: bigint }[] = [];
  let assigned = 0n;
  for (let i = 0; i < n; i++) {
    const num = total * weights[i]!;
    const q = num / W;
    out[i] = q;
    assigned += q;
    rema.push({ idx: i, rem: num - q * W });
  }
  let dust = total - assigned; // số đơn-vị còn phải rải (0 ≤ dust < n)
  if (dust > 0n) {
    // dư lớn nhất trước; tie → idx nhỏ hơn (epoch sớm hơn) trước — tất định.
    rema.sort((a, b) => (a.rem !== b.rem ? (a.rem > b.rem ? -1 : 1) : a.idx - b.idx));
    for (let k = 0; dust > 0n && k < rema.length; k++, dust--) {
      const t = rema[k]!.idx;
      out[t] = out[t]! + 1n;
    }
  }
  return out;
}

/** 1 dòng phân rã của 1 epoch cho 1 ví. */
export interface EpochAttribution {
  /** Nhãn epoch (số epoch thật nếu cấp, không thì chỉ-số snapshot). */
  epoch: bigint;
  /** Stake (lovelace) ví này uỷ thác trong epoch. */
  ownerStake: bigint;
  /** Tổng stake (lovelace) MỌI ví đủ tư cách trong epoch. */
  totalStake: bigint;
  /** Tổng LAMP (oil) pot TIGER "thuộc về" epoch này (∝ totalStake). */
  potOil: bigint;
  /** Phần LAMP (oil) ví này nhận TỪ epoch này (∝ ownerStake, chia từ E_i thật). */
  ownerShareOil: bigint;
  /** Cộng dồn ownerShareOil tới hết epoch này (kết thúc = E_i). */
  cumulativeOil: bigint;
}

/** Kết quả phân rã đầy đủ cho 1 ví. */
export interface OwnerBreakdown {
  owner: string;
  /** Ví có trong snapshot (đủ tư cách, stake > 0, không bị loại) không. */
  found: boolean;
  /** Entitlement cuối E_i (oil) — KHỚP số on-chain redeem (gồm cap + dư floor). */
  entitlementOil: bigint;
  /** Tổng stake tích lũy (lovelace·epoch). */
  accStake: bigint;
  /** E_i có bị cap chạm trần không. */
  capped: boolean;
  /** Phân rã từng epoch (theo thứ tự nhãn epoch tăng dần). */
  epochs: EpochAttribution[];
  /** Σ ownerShareOil — PHẢI == entitlementOil (bất biến, assert ở test). */
  sumOwnerShareOil: bigint;
}

/** Toàn cảnh pot + tham số dùng để tính (phục vụ hiển thị/đối chiếu). */
export interface AttributionContext {
  budgetOil: bigint;
  distributedOil: bigint;
  leftoverOil: bigint;
  grandTotalStake: bigint;
  /** Tổng pot (oil) "thuộc về" mỗi epoch (∝ totalStake_e), Σ == distributed. */
  potPerEpoch: { epoch: bigint; totalStake: bigint; potOil: bigint }[];
}

function normHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

/** Nhãn epoch: dùng `epochs[i]` nếu cấp đúng độ dài, không thì BigInt(i). */
function epochLabels(snapshots: SnapshotSet, epochs?: bigint[]): bigint[] {
  if (epochs && epochs.length === snapshots.length) return epochs;
  return snapshots.map((_, i) => BigInt(i));
}

/** Tổng stake mỗi epoch (sau loại excluded, bỏ stake ≤ 0) + grandTotal.
 *  Áp dụng cùng quy tắc toàn-vẹn như accumulate (1 owner 1 dòng/snapshot). */
function epochTotals(
  snapshots: SnapshotSet,
  excluded: Set<string>,
): { totals: bigint[]; grandTotal: bigint } {
  const totals = new Array<bigint>(snapshots.length).fill(0n);
  let grandTotal = 0n;
  for (let i = 0; i < snapshots.length; i++) {
    const seen = new Set<string>();
    for (const { owner, stake } of snapshots[i]!) {
      const o = normHex(owner);
      if (seen.has(o))
        throw new Error(
          `TIGER-002: owner ${o} trùng trong snapshot #${i} — lỗi toàn vẹn dữ liệu`,
        );
      seen.add(o);
      if (excluded.has(o)) continue;
      if (stake <= 0n) continue;
      totals[i] = totals[i]! + stake;
      grandTotal += stake;
    }
  }
  return { totals, grandTotal };
}

/** Toàn cảnh pot per-epoch (không phụ thuộc ví nào). */
export function attributionContext(
  snapshots: SnapshotSet,
  params: Partial<EntitlementParams> = {},
  epochs?: bigint[],
): AttributionContext {
  const excluded = new Set([...(params.excluded ?? [])].map(normHex));
  const labels = epochLabels(snapshots, epochs);
  const { totals, grandTotal } = epochTotals(snapshots, excluded);
  const res = computeEntitlements(snapshots, params);
  // pot mỗi epoch ∝ totalStake_e, chia từ `distributed` (Σ E_i) → Σ == distributed.
  const potParts = apportion(res.distributed, totals);
  const potPerEpoch = labels.map((epoch, i) => ({
    epoch,
    totalStake: totals[i]!,
    potOil: potParts[i]!,
  }));
  return {
    budgetOil: res.distributed + res.leftover,
    distributedOil: res.distributed,
    leftoverOil: res.leftover,
    grandTotalStake: grandTotal,
    potPerEpoch,
  };
}

/** Phân rã entitlement của 1 ví (owner = payment-cred pkh hex) ra từng epoch.
 *  ownerShare chia TỪ E_i THẬT → Σ == E_i kể cả khi cap. found=false ⇒ E_i=0. */
export function ownerBreakdown(
  snapshots: SnapshotSet,
  ownerPkh: string,
  params: Partial<EntitlementParams> = {},
  epochs?: bigint[],
): OwnerBreakdown {
  const owner = normHex(ownerPkh);
  const excluded = new Set([...(params.excluded ?? [])].map(normHex));
  const labels = epochLabels(snapshots, epochs);
  const { totals } = epochTotals(snapshots, excluded);

  const res = computeEntitlements(snapshots, params);
  const ent = res.entitlements.find((e) => normHex(e.owner) === owner);
  const entitlementOil = ent?.amount ?? 0n;
  const accStake = ent?.accStake ?? 0n;

  // stake của ví theo từng epoch (excluded/stake≤0 → 0).
  const ownerStakes = snapshots.map((snap, i) => {
    if (excluded.has(owner)) return 0n;
    let s = 0n;
    for (const e of snap)
      if (normHex(e.owner) === owner && e.stake > 0n) s += e.stake;
    return s;
  });

  // chia E_i thật theo ownerStakes → Σ == entitlementOil chính xác.
  const shareParts = apportion(entitlementOil, ownerStakes);
  // pot mỗi epoch ∝ totalStake (cùng cách attributionContext).
  const potParts = apportion(res.distributed, totals);

  let cum = 0n;
  const epochsOut: EpochAttribution[] = labels.map((epoch, i) => {
    cum += shareParts[i]!;
    return {
      epoch,
      ownerStake: ownerStakes[i]!,
      totalStake: totals[i]!,
      potOil: potParts[i]!,
      ownerShareOil: shareParts[i]!,
      cumulativeOil: cum,
    };
  });
  // sắp theo nhãn epoch tăng dần (snapshot có thể vào không thứ tự).
  epochsOut.sort((a, b) => (a.epoch < b.epoch ? -1 : a.epoch > b.epoch ? 1 : 0));

  const sumOwnerShareOil = shareParts.reduce((s, v) => s + v, 0n);
  return {
    owner,
    found: ent !== undefined,
    entitlementOil,
    accStake,
    capped: ent?.capped ?? false,
    epochs: epochsOut,
    sumOwnerShareOil,
  };
}
