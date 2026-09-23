// LampDistribution math helpers (SPEC §3, §4)

/// Ceiling division ⌈a / b⌉ cho b > 0, a ≥ 0.
/// D = ceil(remaining / P) — số drops/tickets.
pub fn ceil_div(a: Int, b: Int) -> Int {
  ( a + b - 1 ) / b
}

/// clamp x vào [lo, hi]
pub fn clamp(x: Int, lo: Int, hi: Int) -> Int {
  if x < lo {
    lo
  } else if x > hi {
    hi
  } else {
    x
  }
}

/// min(a, b)
pub fn min(a: Int, b: Int) -> Int {
  if a < b {
    a
  } else {
    b
  }
}

/// max(a, b)
pub fn max(a: Int, b: Int) -> Int {
  if a > b {
    a
  } else {
    b
  }
}
// ⚠ ĐÃ BỎ 2026-09-22 (v3): `abs_diff`. Nó là hàm ĐỐI XỨNG, và chính tính đối xứng ấy là
// nguyên nhân của lỗ đang sống mà v3 sinh ra để diệt: `beacon.ak` C-BCN-5 cũ ép
// `abs_diff(D_mới, D_cũ) · q ≤ D_cũ · max_delta`, tức chặn TỐC ĐỘ mà không chặn CHIỀU, nên
// committee hạ được D 10% mỗi lượt (CONTRACT v3 §0). Luật mới có HƯỚNG (`rate_root` chỉ
// được nới), và để một trợ thủ đối xứng nằm cạnh một luật một chiều là đúng cái bẫy
// "đọc-là-tin" mà `constants.ak` đã trả giá một lần.

test ceil_div_exact() {
  ceil_div(200, 100) == 2
}

test ceil_div_round_up() {
  ceil_div(243, 100) == 3
}

test ceil_div_one() {
  ceil_div(1, 100) == 1
}

test ceil_div_zero() {
  ceil_div(0, 100) == 0
}

test clamp_within() {
  clamp(50, 10, 100) == 50
}

test clamp_low() {
  clamp(5, 10, 100) == 10
}

test clamp_high() {
  clamp(500, 10, 100) == 100
}

test min_left() {
  min(10, 100) == 10
}

test min_right() {
  min(100, 10) == 10
}

test min_equal() {
  min(10, 10) == 10
}

test max_left() {
  max(100, 10) == 100
}

test max_right() {
  max(10, 100) == 100
}

test max_equal() {
  max(10, 10) == 10
}
