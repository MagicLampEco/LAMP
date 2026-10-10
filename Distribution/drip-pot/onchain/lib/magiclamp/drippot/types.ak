// Kiểu on-chain của két drip pot (Distribution/drip-pot/CONTRACT.md v0.3 §2).
//
// THỨ TỰ CONSTRUCTOR = CHỈ SỐ Constr TRÊN CHUỖI. Đổi thứ tự là đổi định dạng dữ liệu
// mà kho Treasury (`FundPot`, inline `d87980`) và bộ dựng off-chain đang ghi ra.
//
// ĐƠN VỊ: mọi con số LAMP ở đây là oildrop (decimals 6).

use cardano/address.{Address}

/// Asset name của token xác thực tài khoản = "account" (`6163636f756e74`).
/// Policy = hash của CHÍNH script két (validator đa mục đích).
pub const account_token_name: ByteArray = "account"

/// Trần độ rộng validity range của `MintAccounts` (`epoch_pinned`, §3): 1 giờ (ms).
pub const max_range_ms: Int = 3_600_000

/// Datum của mọi UTxO ở két.
pub type DripDatum {
  /// Constr 0 [] — CBOR `d87980`. LAMP chờ committee mở tài khoản.
  Reserve
  /// Constr 1 [vault, entitlement, claimed, start_epoch].
  Account {
    /// Đích nhận LAMP, cố định suốt đời tài khoản (so bằng toàn bộ Address).
    vault: Address,
    /// E — tổng quyền nhận, oildrop, > 0.
    entitlement: Int,
    /// Đã nhả, 0 ≤ claimed < E.
    claimed: Int,
    /// Cửa sổ đầu tiên được tính vào lịch nhả.
    start_epoch: Int,
  }
}

/// Redeemer spend.
pub type SpendRedeemer {
  /// Constr 0 — committee mở tài khoản từ `Reserve`.
  Seed
  /// Constr 1 — nhả phần đã đến hạn của MỘT tài khoản. Ai cũng gọi được.
  Claim
  /// Constr 2 (v0.3) — committee trả LAMP của MỘT `Reserve` về kho Distribution
  /// (payment credential `Script(return_script)`), output gắn thẻ như DP-CLAIM-4.
  Return
}

/// Redeemer mint.
pub type MintRedeemer {
  /// Constr 0 — đúc q > 0 token, mỗi token đi cùng một `Account` đúng hình.
  MintAccounts
  /// Constr 1 — đốt đúng 1 token ở lượt `Claim` cuối.
  BurnAccount
}
