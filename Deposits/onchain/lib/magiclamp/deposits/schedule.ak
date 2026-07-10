// Deposits schedule — phí cọc CÓ THẨM QUYỀN tính từ DepositParam beacon.
// NORMATIVE: CONTRACT §3 (v2) + SPEC §A. Pure BigInt, KHÔNG float. Mẫu: ConsumeMAGIC
// pricing.ak (validator CHỈ tin bảng beacon, KHÔNG tin amount client mớm).
//
//   required(asset_type, value_tier, lifecycle_class)
//     = base_deposit[hàng khớp] × demand_mult / Q          (Q=1e9, scale)
//
// base_deposit = 0 hợp lệ → cọc ≈ 0 cho tài sản giá trị thấp + vòng đời ngắn (dưa
// leo): min-ADA Cardano đã chống rác. Tài sản cao/dài → base_deposit lớn.

use aiken/collection/list
use magiclamp/deposits/types.{DepositParam, DepositTier}

/// Scale factor Q (1.0× = 1e9), khớp ProtocolUtils.Q / ConsumeMAGIC.
pub const q: Int = 1_000_000_000

/// Tìm base_deposit cho khóa (asset_type, value_tier, lifecycle_class).
/// None nếu KHÔNG có hàng khớp → Deposit phải fail (không tự định giá hàng ngoài bảng:
/// chống "tier giả để cọc=0" — tier giả KHÔNG có trong bảng → reject, không né phí).
pub fn lookup_base(
  tiers           : List<DepositTier>,
  asset_type      : Int,
  value_tier      : Int,
  lifecycle_class : Int,
) -> Option<Int> {
  when
    list.find(
      tiers,
      fn(t) {
        t.asset_type == asset_type && t.value_tier == value_tier && t.lifecycle_class == lifecycle_class
      },
    )
  is {
    Some(t) -> Some(t.base_deposit)
    None -> None
  }
}

/// Bất biến datum DepositParam (defense-in-depth, mọi giá trị ≥ 0):
///   0 ≤ m_min ≤ m_max ; m_min ≤ demand_mult ≤ m_max ; MỌI base_deposit ≥ 0.
/// base_deposit âm → required âm → "deposit khống/rút ngược" → reject beacon rác.
pub fn valid_param(pp: DepositParam) -> Bool {
  and {
    pp.m_min >= 0,
    pp.m_min <= pp.m_max,
    pp.demand_mult >= pp.m_min,
    pp.demand_mult <= pp.m_max,
    list.all(pp.tiers, fn(t) { t.base_deposit >= 0 }),
  }
}

/// Phí cọc bắt buộc cho 1 phân loại theo beacon (oil). Floor division (BigInt).
/// None nếu phân loại không có trong bảng. required ≥ 0 (base ≥ 0, mult ≥ 0).
pub fn required_for(
  pp              : DepositParam,
  asset_type      : Int,
  value_tier      : Int,
  lifecycle_class : Int,
) -> Option<Int> {
  when lookup_base(pp.tiers, asset_type, value_tier, lifecycle_class) is {
    Some(base) -> Some(base * pp.demand_mult / q)
    None -> None
  }
}

// ── Tests thuần (số học phí cọc) ──────────────────────────────────
fn pp_demo(mult: Int) -> DepositParam {
  DepositParam {
    tiers: [
      // dưa leo: asset_type=1 (cây), value_tier=0 (thấp), lifecycle_class=0 (ngắn) → cọc 0.
      DepositTier { asset_type: 1, value_tier: 0, lifecycle_class: 0, base_deposit: 0 },
      // bò: asset_type=0 (con vật), value_tier=2 (cao), lifecycle_class=2 (dài) → 50 LAMP.
      DepositTier { asset_type: 0, value_tier: 2, lifecycle_class: 2, base_deposit: 50_000_000 },
    ],
    demand_mult: mult,
    m_min: 500_000_000,
    m_max: 2_000_000_000,
    epoch: 100,
  }
}

test schedule_cucumber_zero() {
  // dưa leo → cọc ≈ 0 ở mọi mult (0 × mult = 0).
  required_for(pp_demo(q), 1, 0, 0) == Some(0) && required_for(pp_demo(2_000_000_000), 1, 0, 0) == Some(0)
}

test schedule_cattle_high() {
  // bò mult 1.0× → 50 LAMP.
  required_for(pp_demo(q), 0, 2, 2) == Some(50_000_000)
}

test schedule_demand_scales() {
  // mult 2.0× → bò 100 LAMP (DAO scale toàn bảng).
  required_for(pp_demo(2_000_000_000), 0, 2, 2) == Some(100_000_000)
}

test schedule_unknown_tier_none() {
  // phân loại không có trong bảng → None (chống tier giả né phí).
  required_for(pp_demo(q), 9, 9, 9) == None
}

test schedule_valid_param_ok() {
  valid_param(pp_demo(q))
}

test schedule_valid_param_out_of_clamp() {
  // demand_mult > m_max → datum không hợp lệ.
  !valid_param(pp_demo(3_000_000_000))
}

test schedule_valid_param_negative_base_fail() {
  let bad =
    DepositParam {
      tiers: [DepositTier { asset_type: 0, value_tier: 0, lifecycle_class: 0, base_deposit: -1 }],
      demand_mult: q,
      m_min: 500_000_000,
      m_max: 2_000_000_000,
      epoch: 1,
    }
  !valid_param(bad)
}
