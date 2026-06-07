// Quy đổi c*_capped → VP power THÔ (D7 — TECH §11.2). On-chain THUẦN số nguyên:
// bảng pow_k tại các knots + nội suy tuyến tính + tích chia SCALE^3. KHÔNG float,
// KHÔNG exp/ln on-chain (QĐ-T1) — Tally chỉ tra bảng số nguyên.
//
//   pow_k[c]  = round( c^{w_k} · SCALE )            (T1)  giá trị nguyên thang SCALE
//   pow_k(c)  = nội suy tuyến tính giữa hai knot kề  (T2)  chia nguyên (làm tròn xuống)
//   power_i   = (pow1·pow2·pow3·pow4) / SCALE^3     (T3)  một thang SCALE, ≈ VP_i·SCALE
//
// Bảng knots NẰM TRONG UTxO tham số (DAO-param NFT, trỏ bởi weight_param_ref) — DAO
// chỉnh w_k mà không redeploy validator (TECH §5.6). Module này chỉ chốt THUẬT TOÁN
// tra bảng; bảng cụ thể truyền vào dạng List<Knot> (mỗi yếu tố một bảng).
//
// Tính an toàn (TECH §11.2): c↦c^{w_k} với w_k∈(0,1] LÕM → dây cung nội suy NẰM DƯỚI
// đường cong thật → pow_k(c) KHÔNG vượt giá trị thật → KHÔNG thổi phồng VP.

/// Thang fixed-point chung (TECH §11.4 khuyến nghị 10^9).
pub const scale: Int = 1_000_000_000

/// SCALE^3 — mẫu số của (T3).
pub const scale_cubed: Int = 1_000_000_000_000_000_000_000_000_000

/// Một mốc (knot) của bảng pow_k: (giá trị đầu vào c, giá trị bảng pow = round(c^w·SCALE)).
/// Bảng = List<Knot> SẮP TĂNG theo `c`, c_0=0, c_M=cap_k.
pub type Knot {
  c: Int,
  pow: Int,
}

/// Nội suy tuyến tính (T2) trên bảng knots cho một giá trị x (đã cap về [0, cap_k]).
/// Yêu cầu: knots sắp tăng theo `c`, phần tử đầu có c=0. Trả pow_k(x) thang SCALE.
///
/// Tìm đoạn [c_j, c_{j+1}] chứa x rồi nội suy:
///   pow(x) = pow[c_j] + (pow[c_{j+1}] − pow[c_j])·(x − c_j)/(c_{j+1} − c_j)
/// Nếu x ≥ c_M (knot cuối) → trả pow[c_M] (đã cap, không ngoại suy lên).
/// Nếu x ≤ 0 → trả pow tại knot đầu (thường 0).
pub fn interp(knots: List<Knot>, x: Int) -> Int {
  when knots is {
    [] -> 0
    [only] -> only.pow
    [lo, hi, ..rest] ->
      if x <= lo.c {
        lo.pow
      } else if x < hi.c {
        // x nằm trong [lo.c, hi.c) → nội suy tuyến tính, chia nguyên (làm tròn xuống).
        lo.pow + ( hi.pow - lo.pow ) * ( x - lo.c ) / ( hi.c - lo.c )
      } else {
        // x ≥ hi.c → tiến sang đoạn kế tiếp.
        interp([hi, ..rest], x)
      }
  }
}

/// VP THÔ của một cử tri (T3): tích bốn giá trị bảng chia SCALE^3.
/// Mỗi cN_capped đã cap về [0, cap_N] ở Vote (verify từ ref input) — power CHỈ tra bảng.
/// power = (pow1·pow2·pow3·pow4) / SCALE^3. Aiken Int bignum: tích ~SCALE^4 (~10^36) KHÔNG overflow.
/// Quy ước biên (MATH §1.4): yếu tố = 0 → pow = 0 (knot đầu) → tích = 0 → power = 0 (geometric).
pub fn vp_raw(
  k1: List<Knot>,
  c1: Int,
  k2: List<Knot>,
  c2: Int,
  k3: List<Knot>,
  c3: Int,
  k4: List<Knot>,
  c4: Int,
) -> Int {
  let p1 = interp(k1, c1)
  let p2 = interp(k2, c2)
  let p3 = interp(k3, c3)
  let p4 = interp(k4, c4)
  p1 * p2 * p3 * p4 / scale_cubed
}

// ════════════════════════════════════════════════════════════
// Tests — interp + vp_raw
// ════════════════════════════════════════════════════════════

/// Bảng minh họa w=1.0: pow[c] = round(c^1·SCALE) = c·SCALE → tuyến tính chuẩn.
/// Knots tại 0, 100. interp giữa = đúng x·SCALE (vì hàm vốn tuyến tính, dây cung = đường thật).
fn lin_knots() -> List<Knot> {
  [Knot { c: 0, pow: 0 }, Knot { c: 100, pow: 100 * scale }]
}

test interp_at_knot_lo() {
  interp(lin_knots(), 0) == 0
}

test interp_at_knot_hi() {
  interp(lin_knots(), 100) == 100 * scale
}

test interp_midpoint() {
  // x=50 → 50·SCALE (tuyến tính).
  interp(lin_knots(), 50) == 50 * scale
}

test interp_clamp_above_cap() {
  // x ≥ cap (knot cuối) → pow[cap], không ngoại suy.
  interp(lin_knots(), 999) == 100 * scale
}

test interp_below_zero() {
  interp(lin_knots(), -5) == 0
}

/// Bảng lõm (w<1) ba knot: minh họa dây cung nội suy NẰM DƯỚI đường cong (an toàn).
/// c^0.5·SCALE: tại c=0→0, c=4→2·SCALE, c=16→4·SCALE (sqrt). Đường thật tại c=9 là 3·SCALE;
/// nội suy trên đoạn [4,16]: 2·SCALE + (4−2)·SCALE·(9−4)/(16−4) = 2·SCALE + 2·SCALE·5/12.
fn concave_knots() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 4, pow: 2 * scale },
    Knot { c: 16, pow: 4 * scale },
  ]
}

test interp_concave_below_truth() {
  let got = interp(concave_knots(), 9)
  let truth = 3 * scale
  // sqrt(9)·SCALE
  // nội suy ≤ giá trị thật (dây cung dưới đường lõm) — KHÔNG thổi phồng.
  got <= truth && got == 2 * scale + 2 * scale * 5 / 12
}

test interp_concave_second_segment() {
  // x trong đoạn 2 [4,16] được chọn đúng (không kẹt ở đoạn 1).
  interp(concave_knots(), 16) == 4 * scale
}

test vp_raw_all_linear() {
  // 4 yếu tố w=1, mỗi c=100 → pow=100·SCALE; tích=(100·SCALE)^4; /SCALE^3 = 100^4·SCALE = 10^8·SCALE.
  let v =
    vp_raw(
      lin_knots(),
      100,
      lin_knots(),
      100,
      lin_knots(),
      100,
      lin_knots(),
      100,
    )
  v == 100 * 100 * 100 * 100 * scale
}

test vp_raw_one_zero_collapses() {
  // Một yếu tố = 0 → power = 0 (geometric: thiếu một yếu tố sụp toàn bộ — MATH §1.4).
  let v =
    vp_raw(lin_knots(), 100, lin_knots(), 0, lin_knots(), 100, lin_knots(), 100)
  v == 0
}
