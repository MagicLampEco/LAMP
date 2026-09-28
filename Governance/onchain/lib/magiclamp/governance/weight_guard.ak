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

/// `c` tăng NGHIÊM NGẶT và `pow` KHÔNG GIẢM, đi từ một mốc cho trước.
fn monotone_from(prev: Knot, rest: List<Knot>) -> Bool {
  when rest is {
    [] -> True
    [k, ..tl] -> k.c > prev.c && k.pow >= prev.pow && monotone_from(k, tl)
  }
}

/// (G0) Bảng knots HỢP KHUÔN — tiền đề cho MỌI phép suy trong tệp này.
///
/// Vì sao nó phải là một cổng riêng chứ không phải một giả định: cả `interp` lẫn
/// `dominates` được chứng minh đúng DỰA TRÊN việc bảng là một hàm nội suy tuyến
/// tính đơn điệu trên `[0, cap]`. Bảng không hợp khuôn thì hai hàm đó vẫn TRẢ VỀ
/// một số — và số đó không nói về `w_k` nào cả, nên cổng D8 in xanh cho một thứ nó
/// không đo được. Ca `d8_bac_bang_cap_bang_khong` giữ chỗ này.
///
/// Sáu vế, ghép AND:
///   • `length >= 2`      — một mốc thì không có đoạn nào để nội suy;
///   • `first.c == 0`     — miền phải bắt đầu ở 0, không thì `interp` ngoại suy;
///   • `c` tăng NGHIÊM NGẶT — hai mốc cùng `c` là một đoạn có độ dài 0 (chia cho 0
///     về mặt toán, và về mặt cổng thì nó làm cap tụt xuống 0);
///   • `pow` KHÔNG GIẢM   — `c ↦ c^w` đồng biến với `w ≥ 0`, bảng giảm không ứng
///     với `w` nào;
///   • `first.pow == 0`   — xem đoạn dưới;
///   • `last_c >= 1`      — cap phải nằm TRONG miền `[1, …]` mà `dominates` so, không
///     thì miền chung rỗng.
///
/// **`first.pow == 0` là vế ĐẮT nhất, nên viết rõ nó ép cái gì.** `pow_k(0) = 0`
/// nghĩa là một cử tri có `c_k = 0` thì thừa số thứ k bằng 0, và vì VP là công thức
/// NHÂN (geometric) nên VP của họ bằng 0. Đó KHÔNG phải tác dụng phụ — nó chính là
/// bất biến `VotingPower/CONTRACT.md` §1 ("yếu một tham số là kéo sụp toàn bộ VP")
/// và §2 nguyên lý 1 (người mới VP ≈ 0 là TÍNH NĂNG). Một bảng có `pow(0) = SCALE`
/// biến thừa số thiếu thành 1, tức làm yếu tố đó VÔ HẠI thay vì kéo sụp — nó lật
/// đúng tính chất mà geometric tồn tại để có. Hệ quả hiện thời phải nói thẳng: khi
/// `[C1-C2-C4-SOURCE]` còn treo (c1 = c2 = c4 bị ép 0) thì MỌI VP bằng 0, nên Pha
/// 1/2 chỉ ghi được `Rejected` — xem `[VP-ZERO-FACTOR]`.
pub fn knots_wellformed(knots: List<Knot>) -> Bool {
  when knots is {
    [] -> False
    [_] -> False
    [first, ..rest] -> and {
        first.c == 0,
        first.pow == 0,
        monotone_from(first, rest),
        // ĐỘT BIẾN TƯƠNG ĐƯƠNG — BẤT KHẢ GHIM, đo 2026-09-29: gỡ vế này thì 343/343
        // bài vẫn xanh, và không dựng được đầu vào nào cho nó đỏ. Lý do là một định
        // lý, không phải "chưa viết bài": nhánh này chỉ nhận bảng ≥ 2 mốc (hai nhánh
        // `[]`/`[_]` ở trên đã bắt bảng ngắn), nên `rest` khác rỗng; cộng
        // `first.c == 0` với `c` tăng NGHIÊM NGẶT thì mốc cuối ≥ 1 theo số học. Giữ
        // lại làm phòng thủ chiều sâu — ai nới `c` về "không giảm" sau này thì vế
        // này là thứ chặn cap = 0. KHÔNG đọc `g0_last_c_bang_khong_va_bang_bi_bac`
        // thành bằng chứng rằng vế này đang được canh.
        last_c(knots) >= 1,
      }
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
  // MIỀN CHUNG RỖNG ⇒ `False`, KHÔNG phải `True`.
  // `list.all` trên danh sách rỗng trả `True` — đúng về logic ("đúng rỗng") và SAI
  // về cổng: nó biến "không so được" thành "đã so và đạt". Với `hi < 1` thì không có
  // điểm nào để so, nên câu trả lời đúng là "tôi không đo được", và chiều hỏng của
  // một cổng khẳng định phải là fail-closed. Đây là chỗ PoC 3 đi lọt: một bảng `k3`
  // có cap = 0 làm `dominates(k3, k4)` trả `True` vô điều kiện ⇒ D8 không được ép.
  if hi < 1 {
    False
  } else {
    let points =
      list.concat(list.map(a, fn(k) { k.c }), list.map(b, fn(k) { k.c }))
        |> list.filter(fn(c) { c >= 1 && c <= hi })
    // Luôn kiểm thêm chính mốc `hi` — nó là đầu mút phải của miền chung và có thể
    // không trùng mốc nào của bảng kia.
    list.all([hi, ..points], fn(c) { interp(a, c) >= interp(b, c) })
  }
}

/// Cổng D8 đầy đủ — G0 ∧ G1 ∧ G2 ∧ G3. Gọi ở mọi chỗ đọc `WeightParam`.
///
/// G0 (`knots_wellformed`) đứng TRƯỚC và là điều kiện để ba vế sau có nghĩa; gộp nó
/// vào đây thay vì bắt mỗi nơi gọi tự kiểm là cố ý — `read_weight_param` là đường
/// DUY NHẤT đọc `WeightParam`, nên một cổng là một nguồn.
///
/// Trả `False` là bảng weight KHÔNG hợp lệ; nơi gọi phải `expect` để giao dịch fail.
pub fn d8_ok(
  k1: List<Knot>,
  k2: List<Knot>,
  k3: List<Knot>,
  k4: List<Knot>,
) -> Bool {
  and {
    knots_wellformed(k1),
    knots_wellformed(k2),
    knots_wellformed(k3),
    knots_wellformed(k4),
    is_live(k1),
    is_live(k2),
    is_live(k3),
    is_live(k4),
    dominates(k1, k2),
    dominates(k3, k4),
  }
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

// ── (G0) bảng hợp khuôn — mỗi ca lật ĐÚNG một vế ──

test g0_nhan_bang_chuan() {
  knots_wellformed(k_w1()) && knots_wellformed(k_w05())
}

/// `first.pow = SCALE` ⇒ thừa số thiếu thành 1 thay vì 0 ⇒ lật bất biến tích nhân
/// (`VotingPower/CONTRACT.md` §1). Đây là bảng mà PoC 4 dùng để C3 lái được VP.
test g0_bac_first_pow_khac_khong() {
  !knots_wellformed(k_w0()) && !d8_ok(k_w1(), k_w1(), k_w1(), k_w0())
}

/// Mốc đầu không ở `c = 0` ⇒ `interp` phải ngoại suy dưới mốc đầu.
test g0_bac_moc_dau_khong_o_khong() {
  !knots_wellformed([Knot { c: 1, pow: 0 }, Knot { c: 100, pow: 100 * scale }])
}

/// `c` KHÔNG tăng nghiêm ngặt — đây là bảng `k3` của PoC 3 (hai mốc đều ở `c = 0`).
/// Nó vừa làm cap = 0 (miền chung rỗng) vừa là một đoạn độ dài 0.
test g0_bac_bang_cap_bang_khong() {
  let k3_cap_0 = [Knot { c: 0, pow: 0 }, Knot { c: 0, pow: 7 * scale }]
  and {
    !knots_wellformed(k3_cap_0),
    // và `dominates` giờ fail-closed thay vì đúng-rỗng:
    !dominates(k3_cap_0, k_w1()),
    !d8_ok(k_w1(), k_w1(), k3_cap_0, k_w1()),
  }
}

/// `c` GIẢM.
test g0_bac_c_giam() {
  !knots_wellformed(
    [
      Knot { c: 0, pow: 0 },
      Knot { c: 100, pow: 5 * scale },
      Knot { c: 50, pow: 10 * scale },
    ],
  )
}

/// `pow` GIẢM ⇒ không ứng với `w ≥ 0` nào.
test g0_bac_pow_giam() {
  !knots_wellformed(
    [
      Knot { c: 0, pow: 0 },
      Knot { c: 50, pow: 10 * scale },
      Knot { c: 100, pow: 5 * scale },
    ],
  )
}

/// `pow` ÂM.
test g0_bac_pow_am() {
  !knots_wellformed([Knot { c: 0, pow: -1 }, Knot { c: 100, pow: 100 * scale }])
}

/// Bảng một mốc / rỗng ⇒ không có đoạn nào để nội suy.
test g0_bac_bang_qua_ngan() {
  !knots_wellformed([]) && !knots_wellformed([Knot { c: 0, pow: 0 }])
}

/// Bảng cap-0 bị bác, và `last_c` của nó ĐÚNG là 0 — ca này ghim phép tính `last_c`,
/// KHÔNG ghim vế `last_c >= 1` của `knots_wellformed`. Bản trước của docstring này
/// khẳng định ngược lại ("ca này ghim rằng vế `last_c >= 1` KHÔNG dư"); đo đột biến
/// 2026-09-29 cho thấy khẳng định đó sai: gỡ vế `last_c >= 1` thì 343/343 vẫn xanh,
/// vì bảng cap-0 đã bị vế `c` tăng nghiêm ngặt bác trước. Xem chú thích tại chính vế
/// đó trong `knots_wellformed`.
test g0_last_c_bang_khong_va_bang_bi_bac() {
  let cap_0 = [Knot { c: 0, pow: 0 }, Knot { c: 0, pow: 7 * scale }]
  and {
    last_c(cap_0) == 0,
    !knots_wellformed(cap_0),
  }
}

/// `c` TRÙNG Ở GIỮA bảng, cap vẫn ≥ 1. Đây là ca DUY NHẤT ghim được vế "c tăng NGHIÊM
/// NGẶT": `g0_bac_bang_cap_bang_khong` không ghim nó, vì bảng cap-0 của ca đó bị vế
/// `last_c >= 1` bác song song ⇒ đột biến `k.c > prev.c` → `k.c >= prev.c` cho 343/343
/// xanh (đo 2026-09-29). Mọi vế khác của ca này thoả: mốc đầu ở `c = 0`, `pow` đầu 0,
/// `pow` không giảm, cap = 100.
///
/// Vì sao vế đó phải sống: hai mốc cùng `c` là một đoạn nội suy độ dài 0, và `interp`
/// chia cho hiệu hai mốc — lập luận "kiểm tại các knot là ĐỦ" ở đầu tệp tựa vào việc
/// mỗi đoạn có độ dài dương.
test g0_bac_c_trung_o_giua_bang() {
  let dup =
    [
      Knot { c: 0, pow: 0 },
      Knot { c: 50, pow: 10 * scale },
      Knot { c: 50, pow: 20 * scale },
      Knot { c: 100, pow: 30 * scale },
    ]
  and {
    last_c(dup) == 100,
    !knots_wellformed(dup),
  }
}

/// Đối chứng PoC 3b, MỘT biến: chỉ đổi cap của `k3` từ 0 sang 10^6 ⇒ D8 vẫn chặn vì
/// `w_3 < w_4`, không vì bảng sai khuôn. Hai lý do bác phải phân biệt được.
test g0_doi_chung_cap_binh_thuong_thi_d8_chan_vi_w3_thap() {
  let k3_ok = [Knot { c: 0, pow: 0 }, Knot { c: 100, pow: 7 * scale }]
  let k4_cao = [Knot { c: 0, pow: 0 }, Knot { c: 100, pow: 100 * scale }]
  and {
    knots_wellformed(k3_ok),
    knots_wellformed(k4_cao),
    !dominates(k3_ok, k4_cao),
    !d8_ok(k_w1(), k_w1(), k3_ok, k4_cao),
  }
}
