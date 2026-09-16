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

/// |a − b| — khoảng cách tuyệt đối giữa hai số nguyên.
/// Dùng ở `beacon.ak` C-BCN-5 để chặn tốc độ đổi D theo CẢ HAI chiều bằng một mệnh đề:
/// viết thành hai bất đẳng thức có hướng thì mỗi lần thêm một chiều lại phải nhớ chiều kia.
pub fn abs_diff(a: Int, b: Int) -> Int {
  if a > b {
    a - b
  } else {
    b - a
  }
}

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

test abs_diff_up() {
  abs_diff(110, 100) == 10
}

test abs_diff_down() {
  abs_diff(100, 110) == 10
}

test abs_diff_equal() {
  abs_diff(100, 100) == 0
}
