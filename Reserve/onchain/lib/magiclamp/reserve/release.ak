// Reserve RELEASE math — hàm nhả tự động (cap_release + demand_gate).
//
// FIRST-PRINCIPLES (4 trục):
//   (a) định hướng dài hạn: trần cứng cap_release cho mọi team Cardano cam kết
//       kiểm chứng on-chain "Reserve KHÔNG nhả nhanh hơn g%/năm", bất kể ai trigger.
//   (b) first-principles: mở rộng TỰ NHIÊN của bất biến reserve_minted đơn điệu
//       (R-I2) bằng 1 hàm đơn điệu cap_release(epoch).
//   (c) tối ưu eUTXO/ExUnit: số học nguyên O(1), không pow trực tiếp (lặp năm),
//       velocity đọc qua 1 reference input beacon — không oracle, không vòng lặp.
//   (d) lợi ích user + bền vững: drip nhỏ giọt, tham số chỉnh được qua Governance,
//       KHÔNG ai "rút tay" — chỉ đổi THAM SỐ của hàm.
//
// KIẾN TRÚC 2 TẦNG:
//   Tầng 1 — cap_release(epoch): trần tích lũy TẤT ĐỊNH, đơn điệu, độc lập thị
//            trường, lãi kép rời rạc g_bps/năm. "Mái che cứng" chống lạm phát cung.
//   Tầng 2 — demand_allowance(epoch): 1 biến phản hồi (velocity LAMP) CHỈ làm CHẬM
//            nhả trong biên [floor·cap_release, cap_release]. KHÔNG BAO GIỜ vượt cap.
//
//   approved_cumulative = min( cap_release , demand_allowance )  (luôn ≤ cap_release).
//
// BigInt mọi nơi (Aiken Int = bigint vô hạn). KHÔNG Number, KHÔNG float.

use magiclamp/reserve/constants

/// clamp x vào [lo, hi].
pub fn clamp(x: Int, lo: Int, hi: Int) -> Int {
  if x < lo {
    lo
  } else if x > hi {
    hi
  } else {
    x
  }
}

/// min nguyên.
pub fn min2(a: Int, b: Int) -> Int {
  if a < b {
    a
  } else {
    b
  }
}

/// year_cap(y) = R0 · (10000+g)^y / 10000^y  — lãi kép y năm trọn, floor.
///
/// Tính LẶP (mỗi năm 1 phép nhân-chia floor) tránh pow lớn on-chain:
///   c_0 = R0 ;  c_{k+1} = ⌊ c_k · (10000+g) / 10000 ⌋
/// Đơn điệu: g ≥ 0 ⟹ c_{k+1} ≥ c_k. Bounded: c_k ≤ R0·(1+g/10000)^k.
///
/// LƯU Ý floor-mỗi-bước ≤ pow-rồi-chia-1-lần (sai số floor cộng dồn nhỏ, an toàn
/// về phía DƯỚI — KHÔNG bao giờ nhả nhiều hơn lãi kép thật). TS mirror PHẢI lặp y
/// chốt cùng cách (P8 bit-identical).
pub fn year_cap(base: Int, growth_bps: Int, years: Int) -> Int {
  year_cap_go(base, growth_bps, years)
}

fn year_cap_go(acc: Int, growth_bps: Int, years_left: Int) -> Int {
  if years_left <= 0 {
    acc
  } else {
    let next = acc * ( constants.bps_denom + growth_bps ) / constants.bps_denom
    year_cap_go(next, growth_bps, years_left - 1)
  }
}

/// cap_release(epoch) — trần tích lũy tất định tại epoch.
///
/// e = epoch − t_g (epoch trôi từ khi bật nhả; e<0 → 0).
/// y = e / E_y (năm trọn) ; f = e mod E_y (epoch lẻ trong năm).
/// cap_release = min( reserve_cap ,
///                    year_cap(y) + (year_cap(y+1) − year_cap(y))·f / E_y )
///
/// Nội suy tuyến tính trong năm → drip mượt từng epoch (không bậc thang).
pub fn cap_release(
  epoch: Int,
  genesis_release_epoch: Int,
  base: Int,
  growth_bps: Int,
  epochs_per_year: Int,
  reserve_cap: Int,
) -> Int {
  let e = epoch - genesis_release_epoch
  if e < 0 {
    0
  } else {
    let y = e / epochs_per_year
    let f = e % epochs_per_year
    let cap_y = year_cap(base, growth_bps, y)
    let cap_y1 = year_cap(base, growth_bps, y + 1)
    let interp = cap_y + ( cap_y1 - cap_y ) * f / epochs_per_year
    min2(reserve_cap, interp)
  }
}

/// max_draw_per_epoch(epoch) = cap_release(epoch) − cap_release(epoch−1).
///
/// Đạo hàm rời rạc → trần rút mỗi epoch, chống nhả giật. Tăng cùng nhịp g_bps/năm
/// (tỷ lệ year_cap(y)). KHÔNG hằng DAO — dẫn xuất từ chính cap_release.
pub fn max_draw_per_epoch(
  epoch: Int,
  genesis_release_epoch: Int,
  base: Int,
  growth_bps: Int,
  epochs_per_year: Int,
  reserve_cap: Int,
) -> Int {
  let cur =
    cap_release(epoch, genesis_release_epoch, base, growth_bps, epochs_per_year, reserve_cap)
  let prev =
    cap_release(epoch - 1, genesis_release_epoch, base, growth_bps, epochs_per_year, reserve_cap)
  let d = cur - prev
  if d < 0 {
    0
  } else {
    d
  }
}

/// demand_allowance(epoch) = cap_release · clamp(sma_ratio, floor_bps, 10000) / 10000.
///
/// sma_ratio ∈ [0, 10000] (≤100%) đo velocity LAMP on-chain (SMA K epoch). Velocity
/// cao → allowance LÊN tới cap_release (KHÔNG vượt). Velocity thấp → kéo XUỐNG
/// floor_bps. KHÔNG có hướng "bơm để vượt trần" (clamp trên = 10000).
///
/// bypass MVP: velocity_present == False → trả về cap_release (tầng 1 thuần).
pub fn demand_allowance(
  cap_release_val: Int,
  velocity_present: Bool,
  sma_ratio_bps: Int,
  demand_floor_bps: Int,
) -> Int {
  if !velocity_present {
    cap_release_val
  } else {
    let ratio = clamp(sma_ratio_bps, demand_floor_bps, constants.bps_denom)
    cap_release_val * ratio / constants.bps_denom
  }
}

/// approved_cumulative(epoch) = min( cap_release , demand_allowance ).
/// Trần cứng LUÔN thắng (demand_allowance ≤ cap_release theo xây dựng).
pub fn approved_cumulative(
  epoch: Int,
  genesis_release_epoch: Int,
  base: Int,
  growth_bps: Int,
  epochs_per_year: Int,
  reserve_cap: Int,
  velocity_present: Bool,
  sma_ratio_bps: Int,
  demand_floor_bps: Int,
) -> Int {
  let cap =
    cap_release(epoch, genesis_release_epoch, base, growth_bps, epochs_per_year, reserve_cap)
  let dem = demand_allowance(cap, velocity_present, sma_ratio_bps, demand_floor_bps)
  min2(cap, dem)
}

// ══════════════════════════════════════════════════════════════
// TESTS — số thật từ tham số CHỐT council (TV-AR01..AR05) + đơn điệu/bounded
// Hằng dùng chung: R0=2_000_000_000_000 (2tr LAMP), g=300 (3%/năm), E_y=73,
//                  reserve_cap=1_800_000_000_000_000, t_g=1000.
// ══════════════════════════════════════════════════════════════

const r0: Int = 2_000_000_000_000

const g: Int = 300

const ey: Int = 73

const rcap: Int = 1_800_000_000_000_000

const tg: Int = 1000

// year_cap floor-iter: year_cap(1) = ⌊2e12 · 10300 / 10000⌋ = 2_060_000_000_000.
test year_cap_zero() {
  year_cap(r0, g, 0) == r0
}

test year_cap_one() {
  year_cap(r0, g, 1) == 2_060_000_000_000
}

test year_cap_two() {
  // ⌊2_060_000_000_000 · 10300 / 10000⌋ = 2_121_800_000_000
  year_cap(r0, g, 2) == 2_121_800_000_000
}

// TV-AR01 — cap_release đầu năm 0, epoch lẻ (nội suy).
// epoch=1036 → e=36, y=0, f=36.
// interp = 2e12 + (2.06e12 − 2e12)·36/73 = 2e12 + 60_000_000_000·36/73
//        = 2e12 + ⌊2_160_000_000_000/73⌋ = 2e12 + 29_589_041_095 = 2_029_589_041_095.
test tv_ar01_cap_release_interp() {
  cap_release(1036, tg, r0, g, ey, rcap) == 2_029_589_041_095
}

// e<0 → 0.
test cap_release_before_genesis() {
  cap_release(999, tg, r0, g, ey, rcap) == 0
}

// e=0 → đúng year_cap(0) = R0.
test cap_release_at_genesis() {
  cap_release(1000, tg, r0, g, ey, rcap) == r0
}

// đầu năm 1 (e=73) → đúng year_cap(1).
test cap_release_year1_start() {
  cap_release(1073, tg, r0, g, ey, rcap) == 2_060_000_000_000
}

// TV-AR02 — max_draw_per_epoch năm 0.
// cap_release(1036) − cap_release(1035):
//   cap(1036)=2_029_589_041_095 ; cap(1035): f=35 → 2e12+⌊2_100_000_000_000/73⌋
//   = 2e12 + 28_767_123_287 = 2_028_767_123_287.
//   max_draw = 2_029_589_041_095 − 2_028_767_123_287 = 821_917_808.
test tv_ar02_max_draw() {
  max_draw_per_epoch(1036, tg, r0, g, ey, rcap) == 821_917_808
}

// đơn điệu: cap_release(e) ≥ cap_release(e−1).
test cap_release_monotone() {
  cap_release(1100, tg, r0, g, ey, rcap) >= cap_release(1099, tg, r0, g, ey, rcap)
}

// TV-AR03 — demand_gate kéo allowance xuống khi velocity thấp.
// cap=2_029_589_041_095, floor=2000, sma_ratio=3000 (velocity 30%).
// allowance = ⌊2_029_589_041_095 · 3000 / 10000⌋ = 608_876_712_328.
test tv_ar03_demand_low() {
  let cap = cap_release(1036, tg, r0, g, ey, rcap)
  demand_allowance(cap, True, 3000, 2000) == 608_876_712_328
}

// approved = min(cap, demand) = demand (0.61e12 < 2.03e12).
test tv_ar03_approved_low() {
  approved_cumulative(1036, tg, r0, g, ey, rcap, True, 3000, 2000) == 608_876_712_328
}

// demand floor ép sàn: sma_ratio=500 < floor 2000 → clamp lên 2000.
// allowance = ⌊cap · 2000 / 10000⌋ = ⌊2_029_589_041_095 / 5⌋ = 405_917_808_219.
test demand_floor_clamps_up() {
  let cap = cap_release(1036, tg, r0, g, ey, rcap)
  demand_allowance(cap, True, 500, 2000) == 405_917_808_219
}

// velocity cao (sma_ratio=10000) → allowance = cap (KHÔNG vượt).
test demand_high_caps_at_release() {
  let cap = cap_release(1036, tg, r0, g, ey, rcap)
  demand_allowance(cap, True, 10000, 2000) == cap
}

// velocity bơm vô lý (sma_ratio=99999) → clamp về 10000 → vẫn = cap (chống thao túng).
test demand_pump_cannot_exceed_cap() {
  let cap = cap_release(1036, tg, r0, g, ey, rcap)
  demand_allowance(cap, True, 99999, 2000) == cap
}

// TV-AR04 — bypass MVP (velocity_present=False) → approved = cap_release.
test tv_ar04_bypass() {
  approved_cumulative(1036, tg, r0, g, ey, rcap, False, 0, 2000) == cap_release(1036, tg, r0, g, ey, rcap)
}

// TV-AR05 — chạm cap tuyệt đối (năm xa y=300 ≫ ~231). cap_release = reserve_cap.
test tv_ar05_hits_absolute_cap() {
  // epoch = t_g + 300·E_y = 1000 + 21900 = 22900, f=0 → year_cap(300) ≫ rcap → min = rcap.
  cap_release(22900, tg, r0, g, ey, rcap) == rcap
}

// approved KHÔNG bao giờ vượt cap_release (bounded B1), mọi velocity.
test approved_never_exceeds_cap() {
  let cap = cap_release(2000, tg, r0, g, ey, rcap)
  approved_cumulative(2000, tg, r0, g, ey, rcap, True, 99999, 2000) <= cap
}

// approved ≤ reserve_cap mọi lúc (B1 + cap tuyệt đối).
test approved_le_reserve_cap() {
  approved_cumulative(22900, tg, r0, g, ey, rcap, True, 10000, 2000) <= rcap
}
