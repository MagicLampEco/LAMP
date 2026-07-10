// LAMP Reserve math — trần CỨNG mỗi epoch (demand-gated, KHÔNG cộng dồn catch-up).
//
// FIRST-PRINCIPLES — Reserve = lớp đệm sau cùng:
//   max_per_epoch = total / 1000 — trần CỨNG, KHÔNG phụ thuộc thời gian trôi.
//   Mỗi epoch Treasury kéo TỐI ĐA max_per_epoch (gate sàn ở Treasury). Phần không
//   kéo (gate / không cần) Ở LẠI pot → nhả ở epoch sau. Tối đa cạn pot trong 1000
//   epoch nhả liên tục; bị gate càng nhiều → kéo dài càng lâu (>1000 epoch).
//
// Aiken Int = bigint vô hạn → KHÔNG tràn dù total ≈ 7.9e15.

/// Số epoch tối thiểu để cạn pot khi nhả liên tục đúng trần. Hằng thiết kế (CONTRACT).
/// total / max_per_epoch == 1000. Chia chẵn (E = 9_630_000_000_000_000 ⋮ 1000).
pub const release_epochs: Int = 1000

/// Trần CỨNG nhả mỗi epoch = total / 1000 (chia chẵn cho E hiện hành).
/// KHÔNG dùng /1001 — chia chẵn cho tổng kế toán sạch (dư = 0).
pub fn max_per_epoch(total: Int) -> Int {
  total / release_epochs
}

/// Phần được phép nhả trong MỘT draw, given pot còn lại + lượng yêu cầu:
///   drawable = min(requested, min(max_per_epoch(total), total − drawn))
/// — KHÔNG vượt trần epoch, KHÔNG vượt pot còn lại, KHÔNG vượt cầu thực (requested).
/// Dùng offchain để tính delta tối ưu; onchain ép từng vế riêng (xem reserve_draw).
pub fn drawable(total: Int, drawn: Int, requested: Int) -> Int {
  let cap = max_per_epoch(total)
  let remaining = total - drawn
  let ceil =
    if cap < remaining {
      cap
    } else {
      remaining
    }
  if requested < ceil {
    requested
  } else {
    ceil
  }
}

// ══════════════════════════════════════════════════════════════
// Unit tests — biên (CONTRACT Reserve §math)
// ══════════════════════════════════════════════════════════════

// E = 9,630 tỷ LAMP = 9_630_000_000_000_000 oil (cap reserve allocation v17).
const e: Int = 9_630_000_000_000_000

// ── max_per_epoch ────────────────────────────────────────────

test max_per_epoch_exact_division() {
  // E ⋮ 1000 → chia chẵn, dư == 0 (kế toán sạch).
  max_per_epoch(e) == 9_630_000_000_000 && e % release_epochs == 0
}

test max_per_epoch_times_1000_eq_total() {
  // trần × 1000 == total (nhả liên tục đúng trần cạn pot trong 1000 epoch).
  max_per_epoch(e) * release_epochs == e
}

test release_epochs_is_1000() {
  // hằng = 1000 (KHÔNG 1001).
  release_epochs == 1000
}

// ── drawable: trần CỨNG ──────────────────────────────────────

test drawable_capped_by_max_per_epoch() {
  // requested > trần, pot dư → kẹp về trần.
  drawable(e, 0, e) == max_per_epoch(e)
}

test drawable_requested_below_cap() {
  // requested < trần, pot dư → trả đúng requested (partial draw).
  let req = max_per_epoch(e) - 1_000_000
  drawable(e, 0, req) == req
}

test drawable_capped_by_pot_remaining() {
  // pot còn lại < trần → kẹp về pot còn lại (epoch cuối cạn).
  let drawn = e - 5_000_000
  drawable(e, drawn, e) == 5_000_000
}

test drawable_pot_empty() {
  // pot cạn (drawn == total) → drawable 0.
  drawable(e, e, e) == 0
}

test drawable_exact_cap_boundary() {
  // requested == trần đúng → trả trần (biên ==, không kẹp oan).
  drawable(e, 0, max_per_epoch(e)) == max_per_epoch(e)
}

test drawable_pot_remaining_eq_cap() {
  // pot còn lại == trần đúng → trả trần (biên kép).
  let drawn = e - max_per_epoch(e)
  drawable(e, drawn, e) == max_per_epoch(e)
}
