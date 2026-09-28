// Kiểu on-chain của két pot 8 (pot vault).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO `reserve_hash` NẰM TRONG DATUM, KHÔNG PHẢI THAM SỐ BIÊN DỊCH
//   Két swap (Feecover) nhận `pot_return = địa chỉ script pot` làm tham số của nó
//   ⇒ hash(két) phụ thuộc hash(pot). Nếu pot lại nhận `reserve_hash` làm tham số
//   thì hash(pot) phụ thuộc hash(két) ⇒ điểm bất động blake2b ⇒ KHÔNG dựng được
//   cặp nào cả. Một chiều thì không vòng: pot phát hiện két lúc chạy, qua NFT két
//   ghi trong datum của chính nó, và datum đó bị đóng băng ngay lúc đúc (M-4).
//
// ĐƠN VỊ: mọi con số LAMP ở đây là oildrop (decimals 6). 1 LAMP = 10^6 oildrop.

/// Asset name của NFT pot = rỗng. Policy của nó = hash của CHÍNH script pot, nên
/// cặp (own_hash, "") là định danh duy nhất của két pot.
pub const pot_nft_name: ByteArray = #""

/// Asset name của NFT két swap. CÙNG GIÁ TRỊ với `pot_nft_name` nhưng là một
/// khái niệm KHÁC (nó thuộc policy của két, không thuộc policy của pot) — giữ hai
/// hằng riêng để một lần đổi bên nào không lặng lẽ đổi bên kia.
pub const reserve_nft_name: ByteArray = #""

/// Trần độ rộng validity range của một lượt `Feed`: 1 giờ (ms).
///
/// Chỉ ép "hai cận cùng bucket" là chưa đủ neo: bucket rộng 5 ngày, nên người
/// dựng tx được tự do trượt `now` bất kỳ đâu trong 5 ngày đó. Với trần 1 giờ,
/// `now` sai lệch tối đa 1 giờ so với thời gian thật.
pub const max_range_ms: Int = 3_600_000

/// Độ dài bắt buộc của một script hash Cardano (blake2b-224).
pub const script_hash_length: Int = 28

/// Datum của UTxO pot.
///
///   PotDatum{reserve_hash, drawn_total, last_window}
///     = Constr(0, [bytes, int, int])
pub type PotDatum {
  /// Script hash của két swap (Feecover) — 28 byte, GHI MỘT LẦN lúc đúc, bất
  /// biến sau đó (F-2 và A-1 đều ép giữ nguyên).
  reserve_hash: ByteArray,
  /// Tổng LAMP đã rót sang két, tính GỘP và CHỈ TĂNG. LAMP trả về từ két (qua
  /// `Absorb`) KHÔNG hoàn lại trần này.
  drawn_total: Int,
  /// Cửa sổ của lượt `Feed` gần nhất. Khởi tạo −1 (chưa có lượt nào), tăng NGẶT
  /// mỗi lượt ⇒ tối đa một lượt `Feed` mỗi cửa sổ.
  last_window: Int,
}

/// Redeemer spend. Thứ tự constructor = Constr index.
pub type PotRedeemer {
  /// 0 — rót LAMP từ pot sang két swap. Ai cũng gọi được, không đòi chữ ký.
  Feed
  /// 1 — hút LAMP của các UTxO lạc ở địa chỉ pot vào pot. Ai cũng gọi được.
  Absorb
}

/// Redeemer mint. Chỉ một nhánh ⇒ không có đường đốt NFT pot.
pub type PotMintRedeemer {
  /// 0 — đúc NFT pot one-shot và ép toàn bộ trạng thái khởi tạo (M-1..M-7).
  MintPot
}
