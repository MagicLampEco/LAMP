// Faucet offchain types — mirror onchain ledger.ak (v3, self-serve/DID-gated/rate-limited).
//
// v1 (FaucetDatum{claim_amount}, validator `faucet.ak`) và v2 (FaucetConfig 3 trường
// reclaim_epochs, FaucetAccount 2 trường last_epoch) đã bị XOÁ khỏi on-chain — không còn
// validator nào khớp hai hình dạng đó. KHÔNG khai lại chúng ở đây (bản chép chết không tự
// báo — xem Forall §Một nguồn nhiều con trỏ).

// ── Faucet v3 (DID-gated, rate-limited, tự thu hồi) ─────────────────────

/** Cấu hình Faucet — nằm TRONG datum POOL (PoolDatum.cfg). BẤT BIẾN qua mọi lượt spend
 *  (C-CFG-1 on-chain) nên mọi giá trị ở đây là vĩnh viễn từ giây deploy.
 *  Khớp ledger.FaucetConfig: Constr(0, [drip_oildrop, cooldown_epochs, max_claims_per_window]). */
export interface FaucetConfig {
  /** tLAMP (oildrop) nhả mỗi claim. Chuẩn = 1_001_000_000 (1001 tLAMP). */
  drip_oildrop: bigint;
  /** Số cửa sổ tối thiểu giữa 2 claim của CÙNG một chuỗi account. Chuẩn = 36. */
  cooldown_epochs: bigint;
  /** Trần claim mỗi cửa sổ, TOÀN CỤC — chốt DUY NHẤT chặn vét pool. ≤ MAX_CLAIMS_CEILING (100). */
  max_claims_per_window: bigint;
}

/** Datum của POOL UTxO. Tách `cfg` (bất biến) khỏi ba trường biến thiên.
 *  Khớp ledger.PoolDatum: Constr(0, [FaucetConfig, window_epoch, claims_in_window, opened_root]). */
export interface PoolDatum {
  cfg: FaucetConfig;
  /** Cửa sổ đang đếm. Đơn điệu không lùi (C-RATE-1). */
  window_epoch: bigint;
  /** Số claim đã tiêu trong `window_epoch`. */
  claims_in_window: bigint;
  /** Gốc MPF (hex, đúng 32 byte) của tập `did_key(did_name)` các DID ĐANG có account
   *  (INV-ONE-ACCT). Chỉ `ClaimOpen` (chèn) và `Reclaim` (xoá) được đổi; `MintPool` đặt gốc
   *  rỗng; `ClaimAgain`/`TopUpPool` giữ nguyên. Dựng lại + sinh bằng chứng: `openedLedger.ts`. */
  opened_root: string;
}

// ── Bằng chứng Merkle Patricia Forestry (aiken-lang/merkle-patricia-forestry v2.1.0) ──
// Khớp `aiken/merkle_patricia_forestry.{Proof, ProofStep, Neighbor}` trong `onchain/plutus.json`:
//   Proof     = List<ProofStep>
//   Branch    = Constr(0, [skip, neighbors])          neighbors = 4 × 32 byte
//   Fork      = Constr(1, [skip, Neighbor])
//   Neighbor  = Constr(0, [nibble, prefix, root])
//   Leaf      = Constr(2, [skip, key, value])         key/value ĐÃ BĂM (32 byte mỗi trường)
// Bằng chứng do thư viện JS `@aiken-lang/merkle-patricia-forestry` sinh — đừng dựng tay.

export interface MpfNeighbor {
  nibble: bigint;
  /** hex — các nibble tiền tố của nút láng giềng (mỗi nibble một byte). */
  prefix: string;
  /** hex, 32 byte. */
  root: string;
}

export type MpfProofStep =
  | { kind: "Branch"; skip: bigint; /** hex, 128 byte. */ neighbors: string }
  | { kind: "Fork"; skip: bigint; neighbor: MpfNeighbor }
  | {
      kind: "Leaf"; skip: bigint;
      /** hex, 32 byte — ĐƯỜNG ĐI của lá láng giềng (khoá đã băm). */ key: string;
      /** hex, 32 byte — giá trị lá láng giềng đã băm. */ value: string;
    };

export type MpfProof = MpfProofStep[];

/** Redeemer của faucet pool. Khớp ledger.PoolRedeemer: ClaimOpen 0 · ClaimAgain 1 · Reclaim 2
 *  · TopUpPool 3; hai nhánh đổi sổ mang bằng chứng MPF. */
export type PoolRedeemer =
  | { kind: "ClaimOpen"; proof: MpfProof }
  | { kind: "ClaimAgain" }
  | { kind: "Reclaim"; proof: MpfProof }
  | { kind: "TopUpPool" };

/** Datum faucet-account per-DID. HAI mốc, hai nghĩa — KHÔNG gộp làm một (xem
 *  `handlers.ak` đầu tệp: gộp là lỗ đã ghi thành sự cố).
 *  Khớp ledger.FaucetAccount: Constr(0, [did_name, last_claim_epoch, last_touch_epoch]). */
export interface FaucetAccount {
  /** Asset name (hex) của DID NFT = định danh per-DID. */
  did_name: string;
  /** Mốc COOLDOWN — chỉ ClaimOpen/ClaimAgain/TopUp được đổi. `Use` KHÔNG đụng. */
  last_claim_epoch: bigint;
  /** Mốc IDLE — `Use` gia hạn được. `ReclaimIdle` đọc trường này. */
  last_touch_epoch: bigint;
}
