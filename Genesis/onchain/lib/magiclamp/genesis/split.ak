// Genesis split — chứng minh bất biến chia tổng cung vào pot (pure Int).
// Mirror offchain split.ts. Bất biến lõi G-SUM: Σ shares == total TUYỆT ĐỐI.
//
// FIRST-PRINCIPLES: floor từng share rồi DỒN remainder vào pot ĐẦU. remainder ≥ 0 vì
// Σbps ≤ 10000 ⇒ assigned ≤ total. KHÔNG rơi token lẻ (value bảo toàn — fixed-supply).

use aiken/collection/list

pub const bps_denom: Int = 10_000

pub const oil_per_lamp: Int = 1_000_000

/// Tổng cung tLAMP nguyên — 36 tỷ, BẤT BIẾN.
pub const total_supply_lamp: Int = 36_000_000_000

/// Tổng cung oil = 36e9 × 1e6 = 36e15.
pub const total_supply_oil: Int = total_supply_lamp * oil_per_lamp

pub const distribution_bps: Int = 9_500

pub const reserve_bps: Int = 500

/// share floor của 1 phân bổ = ⌊total × bps / 10000⌋. total ≥ 0, bps ≥ 0.
pub fn floor_share(total: Int, bps: Int) -> Int {
  total * bps / bps_denom
}

/// Σ floor_share của danh sách bps.
pub fn assigned(total: Int, bps_list: List<Int>) -> Int {
  list.foldl(bps_list, 0, fn(b, acc) { acc + floor_share(total, b) })
}

/// remainder = total − Σ floor_share. ≥ 0 ⇔ Σbps ≤ 10000.
pub fn remainder(total: Int, bps_list: List<Int>) -> Int {
  total - assigned(total, bps_list)
}

/// Danh sách share cuối: floor mỗi share, DỒN remainder vào phần tử ĐẦU.
/// post: Σ split_shares == total (khi Σbps ≤ 10000 ∧ total ≥ 0).
pub fn split_shares(total: Int, bps_list: List<Int>) -> List<Int> {
  let floors = list.map(bps_list, fn(b) { floor_share(total, b) })
  let r = total - list.foldl(floors, 0, fn(x, acc) { acc + x })
  when floors is {
    [] -> []
    [head, ..rest] -> [head + r, ..rest]
  }
}

/// G-SUM: Σ split_shares == total. Vị từ kiểm trực tiếp (dùng trong test + validator).
pub fn shares_sum_ok(total: Int, bps_list: List<Int>) -> Bool {
  list.foldl(split_shares(total, bps_list), 0, fn(x, acc) { acc + x }) == total
}

/// Σbps ≤ 10000 (không phân bổ vượt 100%) — điều kiện để remainder ≥ 0.
pub fn bps_within_100(bps_list: List<Int>) -> Bool {
  list.foldl(bps_list, 0, fn(b, acc) { acc + b }) <= bps_denom
}

// ══════════════════════════════════════════════════════════════
// Tests — G-SUM + dồn remainder + cấu hình 95/5
// ══════════════════════════════════════════════════════════════

test t_total_supply_oil() {
  total_supply_oil == 36_000_000_000_000_000
}

test t_distribution_share() {
  // 36e15 × 9500 / 10000 = 34.2e15 (chia hết → remainder 0).
  floor_share(total_supply_oil, distribution_bps) == 34_200_000_000_000_000
}

test t_reserve_share() {
  floor_share(total_supply_oil, reserve_bps) == 1_800_000_000_000_000
}

test t_genesis_remainder_zero() {
  remainder(total_supply_oil, [distribution_bps, reserve_bps]) == 0
}

test t_genesis_sum_ok() {
  // G-SUM cấu hình thật: Σ == total.
  shares_sum_ok(total_supply_oil, [distribution_bps, reserve_bps])
}

test t_genesis_split_values() {
  split_shares(total_supply_oil, [distribution_bps, reserve_bps]) == [
    34_200_000_000_000_000, 1_800_000_000_000_000,
  ]
}

test t_remainder_to_first_odd() {
  // tỉ lệ lẻ 3333/3333/3334 trên 100: floor 33,33,33=99; remainder 1 → pot[0]=34.
  split_shares(100, [3_333, 3_333, 3_334]) == [34, 33, 33]
}

test t_remainder_sum_odd() {
  shares_sum_ok(100, [3_333, 3_333, 3_334])
}

test t_prime_total_sum() {
  // total nguyên tố 9973 với 95/5: floor 9474,498=9972; remainder 1 → pot[0]=9475.
  split_shares(9_973, [distribution_bps, reserve_bps]) == [9_475, 498] && shares_sum_ok(
    9_973,
    [distribution_bps, reserve_bps],
  )
}

test t_partial_alloc_sum() {
  // chỉ phân bổ 80% → remainder 20% dồn pot đầu, Σ == total.
  split_shares(total_supply_oil, [8_000]) == [total_supply_oil] && shares_sum_ok(
    total_supply_oil,
    [8_000],
  )
}

test t_zero_total() {
  shares_sum_ok(0, [distribution_bps, reserve_bps])
}

test t_bps_within_100_true() {
  bps_within_100([distribution_bps, reserve_bps])
}

test t_bps_over_100_false() {
  !bps_within_100([9_500, 600])
}

test t_empty_shares() {
  split_shares(100, []) == []
}
