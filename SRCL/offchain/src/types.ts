// SRCL offchain types — mirror onchain types.ak (byte-perfect codec ở datum.ts).

/** Một bước Merkle proof. left = anh-em ở BÊN TRÁI (True) hay PHẢI (False).
 *  Khớp onchain types.MerkleStep = Constr(0, [bytes, bool]). */
export interface MerkleStep {
  /** hash (hex) của anh-em ở bước này. */
  hash: string;
  /** anh-em ở bên trái (True) → node = h(0x01 ++ sib ++ cur). */
  left: boolean;
}

/** Datum SRCL pool. Khớp onchain types.SrclDatum
 *  = Constr(0, [list<bytes>, int, int, bytes, int]). */
export interface SrclDatum {
  /** Merkle root mỗi epoch (hex). Index = epoch. Admin append qua SetRoot. */
  epoch_roots: string[];
  /** Tổng LAMP (oildrop) đã phân phối (sổ kế toán, chỉ tăng). */
  distributed_total: bigint;
  /** Epoch cuối SRCL (= 35). */
  end_epoch: bigint;
  /** payment-credential hash (hex) của Treasury — đích Sweep. */
  treasury_dest: string;
  /** ms mỗi epoch. */
  ms_per_epoch: bigint;
}

/** Một entitlement: (epoch, owner) nhận amount LAMP (oildrop). */
export interface Entitlement {
  /** Epoch (0..35). */
  epoch: number;
  /** payment-credential hash (pkh hex) của delegator. */
  owner: string;
  /** Lượng LAMP (oildrop). */
  amount: bigint;
}

/** Mục claim đầy đủ (entitlement + proof). Khớp onchain types.ClaimProof
 *  = Constr(0, [int, bytes, int, list<MerkleStep>]). */
export interface ClaimProof {
  epoch: bigint;
  owner: string;
  amount: bigint;
  proof: MerkleStep[];
}

/** 1 dòng snapshot stake delegator của 1 epoch (nguồn: Blockfrost stake API). */
export interface StakeEntry {
  /** payment-credential hash (pkh hex) — đích nhận LAMP (= owner trong leaf). */
  owner: string;
  /** stake (lovelace) delegator ủy thác trong epoch đó. */
  stake: bigint;
}
