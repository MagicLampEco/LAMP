// Faucet v3 onchain types — self-serve, DID-gated, rate-limited, tự thu hồi.
//
// ─────────────────────────────────────────────────────────────────────────
// KIẾN TRÚC NFT-BEACON (phá vòng hash-param chéo)
// ─────────────────────────────────────────────────────────────────────────
// BÀI HỌC: KHÔNG truyền script-hash CHÉO HAI CHIỀU làm compile-time param
// (channel_budget(claim_account_hash) ↔ claim_account(channel_budget_hash) = vòng
// tròn không deploy được). Nhưng MỘT CHIỀU thì KHÔNG vòng, và thứ tự áp tham số
// của Faucet v3 là một dãy thẳng:
//
//   faucet_nft(genesis_ref, ms_per_epoch)                    → faucet_nft_policy
//   faucet_account(faucet_nft_policy, …)                     → account_script_hash
//   faucet_pool(faucet_nft_policy, …, account_script_hash)   → pool_script_hash
//
// `faucet_account` và `faucet_nft` KHÔNG bên nào ôm hash của pool — chúng nhận
// diện pool bằng POOL NFT ⇒ dãy trên acyclic.
//
// 1 minting policy `faucet_nft` (param: genesis_ref, ms_per_epoch) đúc 2 loại token:
//   - POOL NFT  ("POOL", #"504f4f4c", qty 1) — one-shot, nhận diện faucet pool UTxO.
//   - ACCT NFT  (prefix "ACCT" + blake2b_224(did_name) = 32 byte) — neo account
//     vào ĐÚNG một DID mà không cần state toàn cục.
//
// ─────────────────────────────────────────────────────────────────────────
// ĐƠN VỊ + HẰNG (1 tLAMP = 10^6 oildrop)
//   drip     = 1001 tLAMP = 1_001_000_000 oildrop mỗi claim.
//   cooldown = 36 cửa sổ giữa 2 claim của cùng 1 DID.
//   reclaim  = 1001 cửa sổ idle → ai cũng thu hồi account về pool (hằng
//              compile-time ở faucet_account, KHÔNG còn bản sao trong datum).
// "Cửa sổ" (window) = bucket `posix_ms / ms_per_epoch`, mặc định 5 ngày. Đây
// KHÔNG phải epoch Cardano — biên bucket không trùng biên epoch mạng.

use aiken/crypto
use aiken/primitive/bytearray

/// Asset name POOL NFT = "POOL" (#"504f4f4c"). One-shot, đánh dấu faucet pool.
pub const pool_nft_name: ByteArray = #"504f4f4c"

/// Tiền tố asset name của ACCT NFT = "ACCT" (#"41434354"), 4 byte.
pub const acct_name_prefix: ByteArray = #"41434354"

/// Trần compile-time cho `FaucetConfig.max_claims_per_window`, ép ở `MintPool`
/// (C-MP-7). Datum pool bị đóng băng vĩnh viễn bởi C-CFG-1 nên đây là cổng DUY
/// NHẤT còn tồn tại để chặn một con số gõ nhầm ở giây deploy.
pub const max_claims_ceiling: Int = 100

/// ACCT asset name neo vào DID: prefix 4B + blake2b_224(did_name) 28B = 32B
/// (đúng trần asset name của Cardano).
pub fn acct_name(did_name: ByteArray) -> ByteArray {
  bytearray.concat(acct_name_prefix, crypto.blake2b_224(did_name))
}

/// Cấu hình Faucet — nằm trong datum POOL. BẤT BIẾN qua mọi lượt spend (C-CFG-1),
/// nên mọi giá trị ở đây là vĩnh viễn từ giây deploy.
///
///   FaucetConfig{drip_oildrop, cooldown_epochs, max_claims_per_window}
///     = Constr(0, [int, int, int])
pub type FaucetConfig {
  /// tLAMP (oildrop) nhả mỗi claim. Chuẩn = 1_001_000_000 (1001 tLAMP).
  drip_oildrop: Int,
  /// Số cửa sổ tối thiểu giữa 2 claim của cùng 1 chuỗi account. Chuẩn = 36.
  cooldown_epochs: Int,
  /// Trần claim mỗi cửa sổ, toàn cục. Đây là chốt DUY NHẤT chặn vét pool.
  max_claims_per_window: Int,
}

/// Datum của POOL UTxO. Tách `cfg` (bất biến) khỏi 2 trường biến thiên để
/// `out_pd.cfg == cfg` vẫn là MỘT đẳng thức, không bị nới ra thành nhiều dòng.
///
///   PoolDatum{cfg, window_epoch, claims_in_window}
///     = Constr(0, [Constr(0,[int,int,int]), int, int])
pub type PoolDatum {
  cfg: FaucetConfig,
  /// Cửa sổ đang đếm. Đơn điệu không lùi (C-RATE-1).
  window_epoch: Int,
  /// Số claim đã tiêu trong `window_epoch`.
  claims_in_window: Int,
}

/// Datum của faucet-account UTxO (per-DID).
///
///   FaucetAccount{did_name, last_claim_epoch, last_touch_epoch}
///     = Constr(0, [bytes, int, int])
pub type FaucetAccount {
  /// Asset name của DID NFT = định danh per-DID.
  did_name: ByteArray,
  /// Mốc COOLDOWN — chỉ ClaimOpen/ClaimAgain/TopUp được đổi. `Use` KHÔNG đụng.
  last_claim_epoch: Int,
  /// Mốc IDLE — `Use` gia hạn được. `ReclaimIdle` đọc trường này.
  last_touch_epoch: Int,
}

/// Redeemer của faucet pool (spend). Thứ tự constructor = thứ tự Constr index.
pub type PoolRedeemer {
  /// Mở account MỚI cho một DID: đúc ACCT NFT, 0 account input.
  ClaimOpen
  /// Nạp thêm drip vào account ĐÃ CÓ: 1 account input, không đúc, ép cooldown.
  ClaimAgain
  /// Nhận tLAMP trả về từ account idle bị thu hồi. Đòi đúng 1 account input.
  Reclaim
  /// Nạp tLAMP vào pool (ops/deploy). Cấm account input, đòi nạp thật.
  TopUpPool
}

/// Redeemer của faucet-account (spend). `TopUp` XEN GIỮA → index của
/// `ReclaimIdle` dịch từ 1 sang 2 so với v2.
pub type AccountRedeemer {
  /// Chủ DID spend account để DÙNG tLAMP test → gia hạn `last_touch_epoch`.
  Use
  /// Account nhận thêm drip trong tx `ClaimAgain` của pool.
  TopUp
  /// Account idle ≥ reclaim_epochs → ai cũng thu hồi, trả tLAMP về pool.
  ReclaimIdle
}

/// Redeemer của faucet_nft minting policy.
pub type FaucetNftRedeemer {
  /// Đúc POOL NFT one-shot (deploy pool). Bắt buộc consume genesis_ref và ép
  /// hình dạng datum khởi tạo của pool (C-MP-1..7).
  MintPool
  /// Đúc ACCT NFT (lúc ClaimOpen). Bắt buộc tx có POOL NFT input.
  MintAccount
  /// Đốt ACCT NFT (lúc ReclaimIdle). Không đòi POOL input — account validator
  /// mới là nơi ép điều kiện thu hồi.
  BurnAccount
}
