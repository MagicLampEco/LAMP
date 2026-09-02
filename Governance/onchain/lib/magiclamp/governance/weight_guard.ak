// Cổng D8 — ép ràng buộc "yếu tố MUA ĐƯỢC không nặng hơn yếu tố PHẢI KIẾM" NGAY TRÊN CHUỖI.
//
// Vì sao có tệp này: `types.ak` từng ghi "Ràng D8 thực thi off-chain khi DAO dựng bảng knots".
// Thư mục `Governance/offchain/` KHÔNG tồn tại ⇒ D8 không được ép ở đâu cả. Một bất biến chỉ
// sống trong văn bản thì bảng weight vi phạm vẫn nạp được, và không phép đo nào đỏ.
//
// ════════════════════════════════════════════════════════════
// Vì sao kiểm được mà KHÔNG cần thêm w_k vào datum
// ════════════════════════════════════════════════════════════
//
// `WeightParam` chỉ mang bảng knots, không mang w_k dạng số. Nhưng D8 nói về QUAN HỆ giữa các
// w_k, và quan hệ đó đọc thẳng ra được từ bảng — không cần luỹ thừa on-chain:
//
//   pow_k(c) = c^{w_k} · SCALE  ⇒  với c ≥ 1:   w_a ≥ w_b  ⟺  pow_a(c) ≥ pow_b(c)
//
// (c ↦ c^w đồng biến theo w khi c ≥ 1.) Nên "w_3 ≥ w_4" thành "bảng 3 nằm TRÊN bảng 4".
//
// **Vì sao kiểm tại các knot là ĐỦ, không phải xấp xỉ:** gộp mốc c của cả hai bảng lại thì trên
// mỗi đoạn giữa hai mốc kề nhau, CẢ HAI hàm đều tuyến tính (đó là định nghĩa của nội suy tuyến
// tính theo mốc). Một hàm tuyến tính ≥ một hàm tuyến tính khác tại HAI ĐẦU đoạn thì ≥ trên trọn
// đoạn. Vậy kiểm tại tập mốc gộp ⇒ kết luận cho mọi c. Không có kẽ hở giữa các mốc.
//
// ════════════════════════════════════════════════════════════
// Vì sao dùng dạng TỪNG CẶP, không dùng dạng TỔNG
// ════════════════════════════════════════════════════════════
//
// Dạng tổng `w_2 + w_4 ≤ w_1 + w_3` có lỗ: bảng `w = (0.5, 0, 0, 0.5)` THOẢ nó (`0.5 ≤ 0.5`),
// nhưng `w_3 = 0` làm thừa số C3 bằng 1 với MỌI cử tri ⇒ lớp uy tín tắt hẳn, và geometric mất
// đúng tính chất "một yếu tố thấp kéo sụp tất cả" mà nó tồn tại để có.
//
// Dạng từng cặp đóng lỗ đó, và nó CHẶT HƠN dạng tổng (`w_1 ≥ w_2` ∧ `w_3 ≥ w_4` ⟹
// `w_2 + w_4 ≤ w_1 + w_3`; chiều ngược lại sai — chính là phản ví dụ trên). Cộng sàn dương cho
// cả bốn yếu tố:
//
//   G1  w_1 ≥ w_2   — C1 (lịch sử, cần thời gian)  ≥  C2 (khoá LAMP, mua được)
//   G2  w_3 ≥ w_4   — C3 (uy tín, cần công nhận)   ≥  C4 (vốn, mua được)
//   G3  w_k > 0 ∀k  — không yếu tố nào bị tắt
//
// Nguồn: `Governance/VotingPower/CONTRACT.md` §5 (D8 + ba giới hạn) và `Feat-Spec.md` §2.5
// (quy tắc "w_3 không lép vế w_4" — trước nay chỉ là văn xuôi, nay máy kiểm).

use aiken/collection/list
use magiclamp/governance/power.{Knot, interp}

/// Mốc cuối của bảng (cap_k). Bảng rỗng → 0.
fn last_c(knots: List<Knot>) -> Int {
  when knots is {
    [] -> 0
    [only] -> only.c
    [_, ..rest] -> last_c(rest)
  }
}

/// pow tại mốc cuối. Bảng rỗng → 0.
fn last_pow(knots: List<Knot>) -> Int {
  when knots is {
    [] -> 0
    [only] -> only.pow
    [_, ..rest] -> last_pow(rest)
  }
}

/// (G3) `w_k > 0` — bảng phải TĂNG THẬT: pow tại cap phải lớn hơn pow tại mốc đầu.
/// `w_k = 0` cho pow hằng (c^0 = 1 với mọi c) ⇒ thừa số bằng nhau với mọi cử tri ⇒ yếu tố tắt.
pub fn is_live(knots: List<Knot>) -> Bool {
  when knots is {
    [] -> False
    [_] -> False
    [first, ..] -> last_pow(knots) > first.pow
  }
}

/// `bảng a nằm TRÊN bảng b` trên miền chung — tương đương `w_a ≥ w_b`.
///
/// Miền chung là `[1, min(cap_a, cap_b)]`: dưới 1 thì quan hệ luỹ thừa đảo chiều nên bỏ; trên
/// cap nhỏ hơn thì một trong hai bảng đã bão hoà nên phép so không còn nói về w.
/// Kiểm tại tập mốc GỘP của cả hai bảng nằm trong miền đó (xem lập luận đầu tệp).
pub fn dominates(a: List<Knot>, b: List<Knot>) -> Bool {
  let hi =
    if last_c(a) < last_c(b) {
      last_c(a)
    } else {
      last_c(b)
    }
  let points =
    list.concat(list.map(a, fn(k) { k.c }), list.map(b, fn(k) { k.c }))
      |> list.filter(fn(c) { c >= 1 && c <= hi })
  // Luôn kiểm thêm chính mốc `hi` — nó là đầu mút phải của miền chung và có thể không
  // trùng mốc nào của bảng kia.
  let all_points =
    if hi >= 1 {
      [hi, ..points]
    } else {
      points
    }
  list.all(all_points, fn(c) { interp(a, c) >= interp(b, c) })
}

/// Cổng D8 đầy đủ — G1 ∧ G2 ∧ G3. Gọi ở mọi chỗ đọc `WeightParam`.
///
/// Trả `False` là bảng weight KHÔNG hợp lệ; nơi gọi phải `expect` để giao dịch fail.
pub fn d8_ok(
  k1: List<Knot>,
  k2: List<Knot>,
  k3: List<Knot>,
  k4: List<Knot>,
) -> Bool {
  is_live(k1) && is_live(k2) && is_live(k3) && is_live(k4) && dominates(k1, k2) && dominates(
    k3,
    k4,
  )
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

const scale: Int = 1_000_000_000

/// Bảng w = 1.0 trên [0, 100]: pow[c] = c·SCALE.
fn k_w1() -> List<Knot> {
  [Knot { c: 0, pow: 0 }, Knot { c: 100, pow: 100 * scale }]
}

/// Bảng w = 0.5 trên [0, 100]: pow[c] = √c·SCALE. Mốc 0, 25, 100 → 0, 5, 10.
fn k_w05() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 25, pow: 5 * scale },
    Knot { c: 100, pow: 10 * scale },
  ]
}

/// Bảng w = 0 trên [0, 100]: pow hằng = SCALE (c^0 = 1). Yếu tố bị TẮT.
fn k_w0() -> List<Knot> {
  [Knot { c: 0, pow: scale }, Knot { c: 100, pow: scale }]
}

test live_true_for_growing_table() {
  is_live(k_w1()) && is_live(k_w05())
}

test live_false_for_flat_table() {
  // w = 0 → bảng phẳng → yếu tố tắt → phải bị chặn.
  !is_live(k_w0())
}

test live_false_for_degenerate_tables() {
  !is_live([]) && !is_live([Knot { c: 0, pow: 0 }])
}

test dominates_reflexive() {
  dominates(k_w1(), k_w1()) && dominates(k_w05(), k_w05())
}

test dominates_higher_w_over_lower() {
  // w=1.0 nằm trên w=0.5 với mọi c ≥ 1.
  dominates(k_w1(), k_w05())
}

test dominates_rejects_lower_w_over_higher() {
  // w=0.5 KHÔNG nằm trên w=1.0 → phải False.
  !dominates(k_w05(), k_w1())
}

test dominates_checks_between_knots() {
  // Bảng b có mốc riêng (50) không trùng mốc nào của a. Tập mốc gộp phải bắt được nó.
  // b tại c=50 cao hơn a tại c=50 (a=50·SCALE, b=60·SCALE) ⇒ a KHÔNG trội b.
  let a = k_w1()
  let b =
    [
      Knot { c: 0, pow: 0 },
      Knot { c: 50, pow: 60 * scale },
      Knot { c: 100, pow: 100 * scale },
    ]
  !dominates(a, b)
}

test d8_ok_when_earned_outweighs_bought() {
  // w = (1.0, 0.5, 1.0, 0.5): w_1 ≥ w_2 và w_3 ≥ w_4, cả bốn > 0 → hợp lệ.
  d8_ok(k_w1(), k_w05(), k_w1(), k_w05())
}

test d8_rejects_bought_outweighing_earned() {
  // w_4 (vốn) > w_3 (uy tín) → tiền nặng hơn uy tín → phải chặn.
  !d8_ok(k_w1(), k_w05(), k_w05(), k_w1())
}

test d8_rejects_c1_bought_outweighing() {
  // w_2 (khoá LAMP) > w_1 (lịch sử) → phải chặn.
  !d8_ok(k_w05(), k_w1(), k_w1(), k_w05())
}

test d8_rejects_the_sum_form_loophole() {
  // ĐÂY LÀ CA CHÍNH: w = (0.5, 0, 0, 0.5).
  // Dạng TỔNG chấp nhận (w_2 + w_4 = 0.5 ≤ w_1 + w_3 = 0.5) nhưng w_3 = 0 tắt hẳn lớp uy tín.
  // Dạng từng cặp + sàn dương phải CHẶN.
  !d8_ok(k_w05(), k_w0(), k_w0(), k_w05())
}
