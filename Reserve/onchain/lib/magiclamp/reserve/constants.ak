// Reserve constants — đơn vị oil (1 LAMP = 10^6 oil). Khớp Genesis/constants.ak.
//
// FIRST-PRINCIPLES: Reserve = quota CHƯA mint, đơn điệu. Tầng nhả tự động chỉ
// thêm 1 hàm đơn điệu cap_release(epoch) trên chính bất biến đó. KHÔNG token,
// KHÔNG burn. Pure Int (Aiken Int = bigint vô hạn → KHÔNG tràn).

/// 1 LAMP = 10^6 oil (khớp Genesis + Distribution).
pub const oil_per_lamp: Int = 1_000_000

/// asset name tLAMP — "tLAMP" (khớp Genesis constants.tlamp_name).
pub const tlamp_name: ByteArray = #"744c414d50"

/// asset name thread NFT SupplyState — "SUPPLY" (khớp Genesis).
pub const supply_name: ByteArray = #"535550504c59"

/// CAP Distribution mặc định: 34.2 tỷ LAMP × 10^6 = 95% (oil). Cấu hình được (xem
/// constants_reserve90 nếu chốt Reserve >90%). Tổng dist+reserve = total LUÔN giữ.
pub const dist_cap_oil: Int = 34_200_000_000_000_000

/// CAP Reserve mặc định: 1.8 tỷ LAMP × 10^6 = 5% (oil).
pub const reserve_cap_oil: Int = 1_800_000_000_000_000

/// CAP tổng = 36 tỷ LAMP × 10^6 — BẤT BIẾN (fixed-supply 36 tỷ).
pub const total_cap_oil: Int = 36_000_000_000_000_000

/// Mẫu số bps (basis points) — 10000 = 100%.
pub const bps_denom: Int = 10_000

// ── Tham số khởi điểm nhỏ giọt (testnet) — cấu hình qua ReservePolicy datum ────
// Đây là KHỞI ĐIỂM ĐỀ XUẤT, không phải hằng ép on-chain (validator đọc từ
// ReservePolicy beacon). Ghi ở đây để TS mirror + test dùng chung 1 nguồn.

/// R0 CHỐT (council): 2 triệu LAMP/năm 0 = 2_000_000 × 10^6 oil.
pub const default_release_base_oil: Int = 2_000_000_000_000

/// g_bps CHỐT (council): 300 = 3%/năm (clamp on-chain [300, 500]).
pub const default_growth_bps: Int = 300

/// epoch/năm Cardano (~5 ngày/epoch).
pub const default_epochs_per_year: Int = 73

/// Sàn allowance khi velocity = 0 (20%) — bootstrap.
pub const default_demand_floor_bps: Int = 2_000

/// Cửa sổ SMA velocity (epoch) — chống bơm 1 epoch.
pub const default_velocity_window: Int = 12

/// Biên hợp lệ growth_bps ép on-chain (chống DAO đột ngột mở Reserve).
pub const min_growth_bps: Int = 300

pub const max_growth_bps: Int = 500

test caps_sum_to_total() {
  dist_cap_oil + reserve_cap_oil == total_cap_oil
}

test total_is_36b_lamp() {
  total_cap_oil == 36_000_000_000 * oil_per_lamp
}

test growth_bounds_sane() {
  min_growth_bps <= default_growth_bps && default_growth_bps <= max_growth_bps
}
