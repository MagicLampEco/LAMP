// TIGER Airdrop offchain types — mirror onchain ledger.ak.

/** 1 bản ghi snapshot: 1 địa chỉ delegator + phần airdrop (oildrop). */
export interface SnapshotEntry {
  /** Địa chỉ Cardano (bech32) của delegator TIGER pool. */
  address: string;
  /** Lượng LAMP (oildrop) địa chỉ này được airdrop. */
  amount: bigint;
}

/** 1 bước Merkle proof. Khớp ledger.ProofStep = Constr(0, [bool, bytes]).
 *  is_left=true  → sibling bên TRÁI: parent = hash(sibling | current).
 *  is_left=false → sibling bên PHẢI: parent = hash(current | sibling). */
export interface ProofStep {
  is_left: boolean;
  /** Hash anh em (hex 32 byte). */
  hash: string;
}

/** Datum airdrop POOL UTxO. Khớp ledger.AirdropPool
 *  = Constr(0, [merkle_root, deadline_epoch, treasury_dest, marker_dest, claimed_count]). */
export interface AirdropPool {
  /** Gốc Merkle (hex 32 byte). */
  merkle_root: string;
  /** Epoch hết hạn claim = (epoch 29/7) + 360. */
  deadline_epoch: bigint;
  /** Địa chỉ Treasury custody (bech32) — Sweep hoàn LAMP dư về đây. */
  treasury_dest: string;
  /** Địa chỉ marker script no-spend (bech32) — CLAIM marker khóa vĩnh viễn. */
  marker_dest: string;
  /** Số leaf đã claim (sổ kế toán; +1 mỗi Claim). */
  claimed_count: bigint;
}

/** Cây Merkle đã dựng từ snapshot (output snapshotTool/merkle.buildTree). */
export interface MerkleTree {
  /** Gốc (hex). */
  root: string;
  /** Mọi leaf hash theo thứ tự snapshot (hex). */
  leaves: string[];
  /** Snapshot đã chuẩn hoá (sort + dedup) — thứ tự khớp leaves. */
  entries: SnapshotEntry[];
}
