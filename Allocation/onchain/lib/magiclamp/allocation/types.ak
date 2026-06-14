// LAMP Allocation onchain types — HARD-CAP PER-CHANNEL (vá lỗ committee cấp vượt ngân sách).
//
// Thiết kế 2 lớp phòng thủ độc lập (defense-in-depth):
//   Lớp A (kế toán, soft): ChannelBudget beacon mang `remaining_oil`. Mỗi Claim
//     PHẢI consume + re-create beacon, trừ remaining_oil; reject khi amount > remaining.
//     → Σ entitlement đã cấp của kênh ≤ budget gốc (bất biến số học).
//   Lớp B (vật lý, hard): treasury con PER-CHANNEL, value LAMP = ĐÚNG budget kênh.
//     Cạn UTxO = hết ngân sách vật lý, bất khả vượt kể cả Lớp A lỗi.
//
// Khoá chéo: claim_account ↔ channel_budget BẮT BUỘC cùng tx — không bên nào bỏ qua được.
//
// Mọi giá trị là oil (1 LAMP = 10^6 oil). Tổng cung CỐ ĐỊNH 36e15 oil, no-burn.
// Constr index theo thứ tự khai báo (byte-perfect với offchain types.ts).

/// Per-wallet account tại claim_account script — "Capped Drop" tất định.
/// Bất biến: 0 ≤ redeemed ≤ entitlement; vested cộng dồn cap E.
///   vested(t) = min(entitlement, D · drops_per_epoch · max(0, t − start_epoch))
///   redeemable = vested − redeemed
/// `channel_id` MỚI (cuối record): kênh ngân sách account này thuộc về.
pub type ClaimAccountDatum {
  owner           : ByteArray,   // PKH chủ ví
  entitlement     : Int,         // E — tổng LAMP được phân bổ
  redeemed        : Int,         // đã nhận tích lũy
  start_epoch     : Int,         // t0 (đặt lùi = "cliff", không cần field riêng)
  drops_per_epoch : Int,         // nhịp nhả
  channel_id      : ByteArray,   // kênh: "TEAM","RESERVE",... (bind vào budget NFT name)
}

pub type ClaimAccountRedeemer {
  // committee threshold confirm → entitlement += amount; PHẢI kèm budget beacon đúng kênh.
  Claim { amount: Int }
  // user tự tính vested on-chain, rút redeemable từ treasury con cùng kênh (permissionless).
  Redeem
}

/// Beacon ngân sách kênh (Lớp A). Authenticity = NFT riêng (name = channel_id).
/// remaining_oil giảm dần mỗi Claim; cạn = hết ngân sách CẤP-MỚI của kênh.
pub type ChannelBudgetDatum {
  channel_id    : ByteArray,   // định danh kênh (bind vào budget NFT name)
  remaining_oil : Int,         // oil còn được phép CẤP (entitlement) cho kênh
}

pub type ChannelBudgetRedeemer {
  // trừ remaining khi 1 Claim cấp entitlement amount cho account cùng kênh.
  Decrement { amount: Int }
}

/// Treasury con per-channel (Lớp B). Giữ LAMP pool ĐÚNG budget kênh.
/// `channel_id` ép account redeem từ treasury đúng kênh.
pub type TreasuryDatum {
  committee_hash : ByteArray,
  channel_id     : ByteArray,
}

pub type TreasuryRedeemer {
  // release LAMP cho các Redeem cùng tx (kích bởi 1 Redeem hợp lệ).
  ReleaseForRedeem
}
