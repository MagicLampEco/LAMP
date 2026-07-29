// TIGER/offchain/src/check.ts — LÕI THUẦN tra cứu 1 địa chỉ (KHÔNG I/O).
//
// Dùng cho trang ETD (affiso.net/launch/magiclamp → ETD): người dùng dán địa chỉ,
// thấy lịch sử stake mọi epoch, lọc riêng epoch stake vào pool TIGER + số LAMP nhận.
// Entitlement math là CANONICAL LAMP-side (P8) — frontend chỉ hiển thị, không tự tính.

import type { SnapshotSet, TigerEntitlement } from "./types.js";
import { computeEntitlements } from "./entitlement.js";

/** 1 dòng lịch sử từ Blockfrost /accounts/{stake_addr}/history. */
export interface HistoryEntry {
  active_epoch: number;
  amount: string;          // active stake (lovelace)
  pool_id: string | null;  // bech32 pool1...; null = không ủy thác epoch đó
}

/** 1 dòng đã chuẩn hoá cho hiển thị. */
export interface StakeRow {
  epoch: bigint;
  pool_id: string | null;
  stake: bigint;           // lovelace
  is_tiger: boolean;
}

export interface AnalyzeOpts {
  tigerPoolId: string;
  /** chỉ tính epoch < cutoff cho accStake TIGER (nửa mở). null = không cắt. */
  cutoffEpoch?: bigint | null;
}

export interface AnalyzeResult {
  /** toàn bộ lịch sử (mọi pool), sort epoch tăng dần. */
  rows: StakeRow[];
  /** chỉ epoch stake vào TIGER và < cutoff. */
  tigerRows: StakeRow[];
  /** Σ stake TIGER qua các epoch hợp lệ (lovelace·epoch) — mẫu số cá nhân. */
  tigerAccStake: bigint;
}

/** Chuẩn hoá + lọc lịch sử. THUẦN, tất định. */
export function analyzeHistory(history: HistoryEntry[], opts: AnalyzeOpts): AnalyzeResult {
  const tiger = opts.tigerPoolId;
  const cutoff = opts.cutoffEpoch ?? null;

  const rows: StakeRow[] = history
    .map((h) => ({
      epoch: BigInt(h.active_epoch),
      pool_id: h.pool_id,
      stake: BigInt(h.amount),
      is_tiger: h.pool_id === tiger,
    }))
    .sort((a, b) => (a.epoch < b.epoch ? -1 : a.epoch > b.epoch ? 1 : 0));

  const tigerRows = rows.filter(
    (r) => r.is_tiger && r.stake > 0n && (cutoff === null || r.epoch < cutoff),
  );
  const tigerAccStake = tigerRows.reduce((s, r) => s + r.stake, 0n);

  return { rows, tigerRows, tigerAccStake };
}

export interface LampProjection {
  /** entitlement chính xác (oildrop) nếu tìm thấy owner trong entitlements đã tính. */
  amountOildrop: bigint | null;
  accStake: bigint;
  capped: boolean;
  /** true nếu chưa có snapshot chốt (cutoff/registration) → con số là ước tính/thiếu. */
  provisional: boolean;
}

/**
 * Tra LAMP cho 1 owner từ danh sách entitlement ĐÃ tính (nguồn: computeEntitlements
 * trên snapshot chốt). Không tự đoán mẫu số — chỉ tra bảng chính thức.
 */
export function lookupLamp(
  entitlements: TigerEntitlement[],
  owner: string,
  provisional = false,
): LampProjection {
  const e = entitlements.find((x) => x.owner === owner);
  if (!e) return { amountOildrop: null, accStake: 0n, capped: false, provisional };
  return { amountOildrop: e.amount, accStake: e.accStake, capped: e.capped, provisional };
}

/**
 * Tiện ích: tính entitlements từ SnapshotSet rồi tra 1 owner (khi có snapshot đầy đủ
 * trong tay). Cho phép trang ETD hiển thị số LAMP chính xác sau khi snapshot chốt.
 */
export function projectLampFromSnapshot(
  snapshot: SnapshotSet,
  owner: string,
  budgetOildrop: bigint,
  capOildrop: bigint | null = null,
): LampProjection {
  const { entitlements } = computeEntitlements(snapshot, { budgetOildrop, capOildrop });
  return lookupLamp(entitlements, owner, false);
}
