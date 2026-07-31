// TIGER Airdrop offchain types — mirror onchain ledger.ak.

/** 1 bản ghi snapshot: 1 địa chỉ delegator + phần airdrop (oildrop). */
export interface SnapshotEntry {
  /** Địa chỉ Cardano (bech32) của delegator TIGER pool. */
  address: string;
  /** Lượng LAMP (oildrop) địa chỉ này được airdrop. */
  amount: bigint;
}

/** Tham số cô lập leaf theo schema C (v2). Bake vào validator (PARAM) — off-chain
 *  PHẢI truyền đúng cùng bộ để leaf khớp byte-perfect on-chain.
 *  Nguồn: SCHEMA-MERKLE-V2-Tech-Spec.md §1. */
export interface MerkleParams {
  /** blake2b_256(tên_chiến_dịch_utf8), hex 32 byte. VD DELEGATOR_CAMPAIGN_ID. */
  campaignId: string;
  /** epoch snapshot (Delegator = E_cut hằng). big-endian u64 trong leaf. */
  epoch: bigint;
  /** Delegator=1, MCS=2, Engage=3, SPO=4. 1 byte (0..255). CẤM đổi số. */
  role: number;
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
