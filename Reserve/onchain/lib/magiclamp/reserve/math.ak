// LAMP Reserve math — vested/draw thuần (linear 1001 epoch, floor division).
//
// Aiken Int = bigint vô hạn → KHÔNG tràn dù total_oil ≈ 7.9e15 × t ≈ 1e3 = 7.9e18.
// (vẫn dưới 2^63 nhưng không cần lo: Int không có biên.)

/// Số epoch của cửa sổ nhả tuyến tính. Hằng thiết kế (CONTRACT Reserve).
pub const release_epochs: Int = 1001

/// vested(t) = phần đã tới hạn tại epoch t (oil).
///   t ≤ start          → 0          (chưa mở cửa)
///   start < t < +1001  → tuyến tính, floor
///   t ≥ start + 1001   → total_oil  (đầy, clamp bởi min)
///
/// Công thức: min(total_oil, total_oil * max(0, t - start) / 1001).
/// floor division: phần dư rơi vào epoch cuối → tổng cộng dồn == total_oil tại t≥+1001.
pub fn vested(start_epoch: Int, total_oil: Int, t: Int) -> Int {
  let elapsed =
    if t > start_epoch {
      t - start_epoch
    } else {
      0
    }
  let raw = total_oil * elapsed / release_epochs
  if raw > total_oil {
    total_oil
  } else {
    raw
  }
}

/// draw(t) = phần chưa nhả tới hạn tại t = vested(t) − drawn_oil.
/// Luôn ≥ 0 vì drawn_oil ≤ vested(t_trước) ≤ vested(t) (vested đơn điệu theo t).
pub fn draw(start_epoch: Int, total_oil: Int, drawn_oil: Int, t: Int) -> Int {
  vested(start_epoch, total_oil, t) - drawn_oil
}

// ══════════════════════════════════════════════════════════════
// Unit tests — biên (CONTRACT Reserve §math)
// ══════════════════════════════════════════════════════════════

// E = 7.899 tỷ LAMP = 7_899_000_000_000_000 oil (cap reserve allocation v3).
const e: Int = 7_899_000_000_000_000

const s0: Int = 100

// ── vested biên ──────────────────────────────────────────────

test vested_before_start() {
  // t < start → 0 (chưa mở cửa).
  vested(s0, e, 50) == 0
}

test vested_at_start() {
  // t == start → elapsed 0 → 0 (KHÔNG cliff).
  vested(s0, e, s0) == 0
}

test vested_first_epoch() {
  // t = start+1 → E*1/1001 (floor).
  vested(s0, e, s0 + 1) == e / 1001
}

test vested_mid() {
  // t = start+500 → E*500/1001 (floor).
  vested(s0, e, s0 + 500) == e * 500 / 1001
}

test vested_one_before_full() {
  // t = start+1000 → E*1000/1001 (chưa đầy, floor < E).
  let v = vested(s0, e, s0 + 1000)
  v == e * 1000 / 1001 && v < e
}

test vested_exact_full() {
  // t = start+1001 → E*1001/1001 == E (đầy chính xác).
  vested(s0, e, s0 + 1001) == e
}

test vested_after_full_capped() {
  // t > start+1001 → clamp tại E (min ép, không vượt cap).
  vested(s0, e, s0 + 5000) == e
}

test vested_floor_no_overshoot() {
  // floor: tổng các phần ≤ E tại mọi t < +1001 (không phát quá cap giữa chừng).
  vested(s0, e, s0 + 999) <= e
}

// ── draw ─────────────────────────────────────────────────────

test draw_fresh_mid() {
  // chưa nhả gì (drawn 0), t giữa → draw == vested.
  draw(s0, e, 0, s0 + 500) == vested(s0, e, s0 + 500)
}

test draw_incremental() {
  // đã nhả tới epoch 500, nhả tiếp tới 600 → draw = vested(600) - vested(500).
  let drawn = vested(s0, e, s0 + 500)
  draw(s0, e, drawn, s0 + 600) == vested(s0, e, s0 + 600) - drawn
}

test draw_zero_when_caught_up() {
  // drawn == vested(t) → draw == 0 (không còn gì tới hạn).
  let v = vested(s0, e, s0 + 300)
  draw(s0, e, v, s0 + 300) == 0
}

test draw_full_drain_at_end() {
  // chưa nhả gì, t ≥ +1001 → draw == E (rút toàn bộ một lần).
  draw(s0, e, 0, s0 + 1001) == e
}

test draw_before_start_zero() {
  // t ≤ start, chưa nhả → draw 0.
  draw(s0, e, 0, s0) == 0
}
