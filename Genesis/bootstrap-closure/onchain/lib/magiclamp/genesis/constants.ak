// LAMP Genesis constants — lazy-mint (CONTRACT §2). Đơn vị: oil (1 LAMP = 10^6 oil).
//
// fixed-supply = mint cumulative ≤ CAP, đơn điệu, KHÔNG burn. Token chưa mint =
// không tồn tại on-chain. Pure Int (Aiken Int đã là bigint vô hạn — KHÔNG tràn).

/// 1 LAMP = 10^6 oil (khớp Distribution).
pub const oil_per_lamp: Int = 1_000_000

/// Asset name LAMP MẶC ĐỊNH cho TEST — "tLAMP" (#"744c414d50").
///
/// LƯU Ý — KHÔNG còn là asset name CỐ ĐỊNH của validator. Asset name LAMP nay là
/// PARAM của lamp_mint (apply-param lúc deploy): testnet truyền "tLAMP", mainnet
/// truyền "LAMP" (#"4c414d50"). Cùng 1 code deploy được cả 2 network.
///
/// Token = PolicyID + AssetName. token_name là param của lamp_mint → policyId KHÁC
/// nhau giữa tLAMP và LAMP (đúng: 2 token độc lập). AssetName chỉ là NHÃN; tính DUY
/// NHẤT nằm ở PolicyID (neo bởi genesis_ref one-shot của thread_nft). Hằng này chỉ
/// dùng làm token_name mặc định trong TEST, validator KHÔNG tham chiếu nó.
pub const default_token_name: ByteArray = #"744c414d50"

/// asset name thread NFT SupplyState — "SUPPLY".
pub const supply_name: ByteArray = #"535550504c59"

/// CAP Distribution: 26,370 tỷ LAMP × 10^6 (oil) — khớp allocation v17 (tất cả trừ Reserve).
pub const dist_cap_oil: Int = 26_370_000_000_000_000

/// CAP Reserve: 9,630 tỷ LAMP × 10^6 (oil) — khớp allocation v17 (engine trần E/1000/epoch, Treasury-pull gated, ~1001 epoch).
pub const reserve_cap_oil: Int = 9_630_000_000_000_000

/// CAP tổng = 36 tỷ LAMP × 10^6 — BẤT BIẾN.
pub const total_cap_oil: Int = 36_000_000_000_000_000

test caps_sum_to_total() {
  dist_cap_oil + reserve_cap_oil == total_cap_oil
}

test total_is_36b_lamp() {
  total_cap_oil == 36_000_000_000 * oil_per_lamp
}

/// "tLAMP" (testnet) và "LAMP" (mainnet) là 2 asset name hợp lệ truyền vào lamp_mint.
/// default_token_name == "tLAMP" để khớp test mặc định.
test default_token_name_is_tlamp() {
  default_token_name == #"744c414d50"
}
