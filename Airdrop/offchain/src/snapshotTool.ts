// snapshotTool — đọc danh sách {address, amount} → cây Merkle (root + leaves).
// Dùng khi chuẩn bị deploy airdrop: nhập snapshot delegator TIGER → ra merkle_root
// đặt vào datum pool + sinh proof cho từng claimer.
//
// HỖ TRỢ:
//   - parseSnapshot: từ JSON ({address, amount} với amount LAMP hoặc oildrop) → SnapshotEntry[].
//   - buildSnapshotTree: → MerkleTree (root + leaves + entries chuẩn hoá).
//   - exportClaims: sinh map address → {amount, proof, leaf} cho frontend claim.

import { buildTree, buildProof } from "./merkle.js";
import { lampToOildrop } from "./constants.js";
import type { SnapshotEntry, MerkleTree, ProofStep, MerkleParams } from "./types.js";

/** 1 dòng snapshot thô (JSON). amount theo LAMP (mặc định) hoặc oildrop. */
export interface RawSnapshotRow {
  address: string;
  /** Lượng airdrop. Theo `unit` (mặc định "lamp"). */
  amount: number | string | bigint;
}

export interface ParseOptions {
  /** Đơn vị amount trong snapshot thô. "lamp" → ×10^6 ra oildrop; "oildrop" → giữ nguyên. */
  unit?: "lamp" | "oildrop";
}

/** JSON rows → SnapshotEntry[] (amount luôn quy về oildrop). */
export function parseSnapshot(rows: RawSnapshotRow[], opts: ParseOptions = {}): SnapshotEntry[] {
  const unit = opts.unit ?? "lamp";
  return rows.map((r) => {
    const raw = typeof r.amount === "bigint" ? r.amount : BigInt(r.amount);
    if (raw <= 0n) throw new Error(`SNAPSHOT-001: amount ≤ 0 cho ${r.address}`);
    return { address: r.address, amount: unit === "lamp" ? lampToOildrop(raw) : raw };
  });
}

/** Tổng oildrop của snapshot (đối chiếu với AIRDROP_TOTAL_OILDROP trước deploy). */
export function totalOildrop(entries: SnapshotEntry[]): bigint {
  return entries.reduce((s, e) => s + e.amount, 0n);
}

/** Dựng cây từ rows thô (parse + build trong 1 bước). params = schema C (campaign/epoch/role). */
export function buildSnapshotTree(
  rows: RawSnapshotRow[],
  params: MerkleParams,
  opts: ParseOptions = {},
): MerkleTree {
  return buildTree(parseSnapshot(rows, opts), params);
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
