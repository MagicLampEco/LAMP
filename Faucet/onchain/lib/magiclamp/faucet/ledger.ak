// Faucet v2 onchain types — self-serve, DID-gated, rate-limited, tự thu hồi.
//
// ─────────────────────────────────────────────────────────────────────────
// KIẾN TRÚC NFT-BEACON (phá vòng hash-param chéo)
// ─────────────────────────────────────────────────────────────────────────
// BÀI HỌC: KHÔNG truyền script-hash của pool ↔ account làm compile-time param
// (channel_budget(claim_account_hash) ↔ claim_account(channel_budget_hash) = vòng
// tròn không deploy được). GIẢI: dùng one-shot/beacon NFT.
//
// 1 minting policy `faucet_nft` (param: genesis_ref) đúc 2 loại token:
//   - POOL NFT  ("POOL", #"504f4f4c", qty 1) — one-shot, nhận diện faucet pool UTxO.
//   - ACCT NFT  ("ACCT", #"41434354", qty ≥1) — nhận diện faucet-account UTxO.
//
// Pool validator nhận diện account qua "output mang ACCT NFT cùng faucet_nft_policy".
// Account validator nhận diện pool qua "output mang POOL NFT cùng faucet_nft_policy".
// CẢ HAI chỉ tham chiếu `faucet_nft_policy` (1 param chung, tính từ genesis_ref ở
// deploy) — KHÔNG bên nào ôm hash của bên kia → KHÔNG vòng tròn.
//
// ─────────────────────────────────────────────────────────────────────────
// ĐƠN VỊ + HẰNG (1 tLAMP = 10^6 oil)
//   drip   = 1001 tLAMP = 1_001_000_000 oil mỗi claim.
//   cooldown = 36 epoch giữa 2 claim của cùng 1 DID.
//   reclaim  = 1001 epoch idle → ai cũng thu hồi account về pool.
// Các hằng này truyền qua FaucetConfig (datum pool) để chỉnh không cần recompile.

/// Asset name POOL NFT = "POOL" (#"504f4f4c"). One-shot, đánh dấu faucet pool.
pub const pool_nft_name: ByteArray = #"504f4f4c"

/// Asset name ACCT NFT = "ACCT" (#"41434354"). Đánh dấu faucet-account per-DID.
pub const acct_nft_name: ByteArray = #"41434354"

/// Cấu hình Faucet — đặt trên POOL UTxO (inline datum). Tham số hoá runtime:
/// chỉnh drip/cooldown/reclaim không cần redeploy validator.
///
///   FaucetConfig{drip_oil, cooldown_epochs, reclaim_epochs} = Constr(0, [int,int,int])
pub type FaucetConfig {
  /// tLAMP (oil) nhả mỗi claim. Chuẩn = 1_001_000_000 (1001 tLAMP).
  drip_oil: Int,
  /// Số epoch tối thiểu giữa 2 claim của cùng 1 DID. Chuẩn = 36.
  cooldown_epochs: Int,
  /// Số epoch idle để account bị thu hồi (permissionless). Chuẩn = 1001.
  reclaim_epochs: Int,
}

/// Datum của faucet-account UTxO (per-DID). Giữ tLAMP đã claim + định danh DID.
///
///   FaucetAccount{did_name, last_epoch} = Constr(0, [bytes, int])
pub type FaucetAccount {
  /// Asset name của DID NFT = định danh per-DID (rate-limit theo đây).
  did_name: ByteArray,
  /// Epoch của lần claim/dùng gần nhất. Mốc tính cooldown + reclaim.
  last_epoch: Int,
}

/// Redeemer của faucet pool (spend).
pub type PoolRedeemer {
  /// Claimer mang DID NFT → tạo/cập nhật 1 account, nhận drip tLAMP từ pool.
  Claim
  /// Nhận tLAMP trả về từ account idle bị thu hồi (pool tăng).
  Reclaim
}

/// Redeemer của faucet-account (spend).
pub type AccountRedeemer {
  /// Chủ DID spend account để DÙNG tLAMP test → cập nhật last_epoch.
  Use
  /// Account idle ≥ reclaim_epochs → ai cũng thu hồi, trả tLAMP về pool.
  ReclaimIdle
}

/// Redeemer của faucet_nft minting policy.
pub type FaucetNftRedeemer {
  /// Đúc POOL NFT one-shot (deploy pool). Bắt buộc consume genesis_ref.
  MintPool
  /// Đúc ACCT NFT (lúc Claim). Bắt buộc tx có POOL NFT (pool đang được spend).
  MintAccount
}
