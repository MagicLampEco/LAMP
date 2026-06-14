// LAMP Genesis constants — lazy-mint (CONTRACT §2). Đơn vị: oil (1 tLAMP = 10^6 oil).
//
// fixed-supply = mint cumulative ≤ CAP, đơn điệu, KHÔNG burn. Token chưa mint =
// không tồn tại on-chain. Pure Int (Aiken Int đã là bigint vô hạn — KHÔNG tràn).

/// 1 tLAMP = 10^6 oil (khớp Distribution).
pub const oil_per_lamp: Int = 1_000_000

/// asset name tLAMP — "tLAMP" (giữ khớp 02_mint_test_lamp.ts).
pub const tlamp_name: ByteArray = #"744c414d50"

/// asset name thread NFT SupplyState — "SUPPLY".
pub const supply_name: ByteArray = #"535550504c59"

/// CAP Distribution: 28.101 tỷ LAMP × 10^6 (oil) — khớp allocation v3 (tất cả trừ Reserve).
pub const dist_cap_oil: Int = 28_101_000_000_000_000

/// CAP Reserve: 7.899 tỷ LAMP × 10^6 (oil) — khớp allocation v3 (engine linear 1001 epoch).
pub const reserve_cap_oil: Int = 7_899_000_000_000_000

/// CAP tổng = 36 tỷ LAMP × 10^6 — BẤT BIẾN.
pub const total_cap_oil: Int = 36_000_000_000_000_000

test caps_sum_to_total() {
  dist_cap_oil + reserve_cap_oil == total_cap_oil
}

test total_is_36b_lamp() {
  total_cap_oil == 36_000_000_000 * oil_per_lamp
}
