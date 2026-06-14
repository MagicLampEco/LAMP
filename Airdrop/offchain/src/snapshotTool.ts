// snapshotTool — đọc danh sách {address, amount} → cây Merkle (root + leaves).
// Dùng khi chuẩn bị deploy airdrop: nhập snapshot delegator TIGER → ra merkle_root
// đặt vào datum pool + sinh proof cho từng claimer.
//
// HỖ TRỢ:
//   - parseSnapshot: từ JSON ({address, amount} với amount LAMP hoặc oil) → SnapshotEntry[].
//   - buildSnapshotTree: → MerkleTree (root + leaves + entries chuẩn hoá).
//   - exportClaims: sinh map address → {amount, proof, leaf} cho frontend claim.

import { buildTree, buildProof } from "./merkle.js";
import { lampToOil } from "./constants.js";
import type { SnapshotEntry, MerkleTree, ProofStep } from "./types.js";

/** 1 dòng snapshot thô (JSON). amount theo LAMP (mặc định) hoặc oil. */
export interface RawSnapshotRow {
  address: string;
  /** Lượng airdrop. Theo `unit` (mặc định "lamp"). */
  amount: number | string | bigint;
}

export interface ParseOptions {
  /** Đơn vị amount trong snapshot thô. "lamp" → ×10^6 ra oil; "oil" → giữ nguyên. */
  unit?: "lamp" | "oil";
}

/** JSON rows → SnapshotEntry[] (amount luôn quy về oil). */
export function parseSnapshot(rows: RawSnapshotRow[], opts: ParseOptions = {}): SnapshotEntry[] {
  const unit = opts.unit ?? "lamp";
  return rows.map((r) => {
    const raw = typeof r.amount === "bigint" ? r.amount : BigInt(r.amount);
    if (raw <= 0n) throw new Error(`SNAPSHOT-001: amount ≤ 0 cho ${r.address}`);
    return { address: r.address, amount: unit === "lamp" ? lampToOil(raw) : raw };
  });
}

/** Tổng oil của snapshot (đối chiếu với AIRDROP_TOTAL_OIL trước deploy). */
export function totalOil(entries: SnapshotEntry[]): bigint {
  return entries.reduce((s, e) => s + e.amount, 0n);
}

/** Dựng cây từ rows thô (parse + build trong 1 bước). */
export function buildSnapshotTree(rows: RawSnapshotRow[], opts: ParseOptions = {}): MerkleTree {
  return buildTree(parseSnapshot(rows, opts));
}

/** Sinh bảng claim {address → {amount, leaf, proof}} cho mọi entry — frontend dùng. */
export interface ClaimRecord {
  address: string;
  amount: bigint;
  leaf: string;
  proof: ProofStep[];
}

export function exportClaims(tree: MerkleTree): ClaimRecord[] {
  return tree.entries.map((e, i) => ({
    address: e.address,
    amount: e.amount,
    leaf: tree.leaves[i]!,
    proof: buildProof(tree, i),
  }));
}
