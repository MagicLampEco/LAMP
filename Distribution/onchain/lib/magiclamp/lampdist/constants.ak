// LampDistribution constants — Capped Drop v3.
// Đơn vị: oildrop (1 LAMP = 10^6 oildrop). Q-format: Q = 10^9.
//
// ⚠ ĐÃ BỎ 2026-09-22 (v3): `drop_value_genesis` · `drop_value_min` · `drop_value_max` ·
// `max_drop_delta_q` · `drops_per_epoch_max`. Bốn cái đầu là biên của `drop_value`, trường
// mà v3 đã gỡ khỏi `BeaconDatum`; cái cuối là trần của `drops_per_epoch`, tham số mà v3
// ghim cứng `== 1` (C-ACC-DPE). Giữ một hằng không có cơ chế tương ứng là giữ một lời hứa
// về hành vi mà không mã nào thực hiện — đúng lý do `p_ema_window` đã bị bỏ ngày 2026-09-16.

pub const q: Int = 1_000_000_000

// ── Biên của `rate_root` (w, gốc tốc độ — W := w²) ───────────────────────────
// `beacon.ak` C-BCN-5b ép mọi giá trị post lên beacon nằm trong [min, max].
//
// 🔴 HAI CON SỐ DƯỚI ĐÂY CHƯA ĐƯỢC CHỐT — đặc tả v3 nói "biên cứng giữ nguyên" nhưng
// KHÔNG nêu giá trị ở bất cứ đâu (đo 2026-09-22 bằng
// `grep -rn "rate_root_min\|rate_root_max" Distribution/` → chỉ 4 dòng, đều là dòng NHẮC
// TÊN, không dòng nào cho số). Và "giữ nguyên" KHÔNG đọc được thành "dùng lại số của
// `drop_value`": `drop_value_min` cũ là 10^7 trong khi giá trị hiệu chỉnh của `w` là
// 77.460 — bê nguyên số cũ thì genesis nằm DƯỚI sàn.
//
// Giá trị dưới đây giữ ĐÚNG HÌNH DẠNG dải cũ quanh mốc hiệu chỉnh `w = 77.460`
// (`Math-Spec.md` v3 §7): sàn = w/10, trần = w×100 — y hệt tỉ lệ mà dải `drop_value` cũ
// dùng quanh mốc 100 LAMP. Đổi chúng ĐÒI ĐÚC LẠI SCRIPT, nên chúng phải qua một vòng chốt
// trước mainnet, cùng vòng với `trim_floor`.
pub const rate_root_min: Int = 7_746
//                             w/10 — SÀN CỨNG. Bị C-BCN-5' (chỉ-nới) bao trùm trên một
//                             chuỗi hợp lệ: genesis ≥ sàn và mọi lượt post chỉ tăng ⇒
//                             không giao dịch nào trên chuỗi chạm được nó. Giữ vì nó là
//                             chân của Định lý 1 (`w_k > 0` ⇒ A không giảm) và vì nó chặn
//                             một beacon khởi tạo sai.

pub const rate_root_max: Int = 7_746_000
//                             w×100 — TRẦN CỨNG. Đây là biên chịu lực thật: nó nói "không
//                             ai làm pot mở khoá nhanh hơn 1/100 lịch hiệu chỉnh", trong
//                             khi C-BCN-5a chỉ chặn TỐC ĐỘ đi tới đó (~49 cửa sổ post liên
//                             tiếp ở +10%).

// ── Biên của MỘT LƯỢT NỚI `rate_root` ────────────────────────────────────────
// `beacon.ak` C-BCN-5a ép (w_mới − w_cũ) · q ≤ w_cũ · max_rate_root_delta_q, tức +10% mỗi
// lượt post. KHÁC v2 ở CHIỀU: v2 dùng `abs_diff` — một hàm ĐỐI XỨNG — nên trần ±10% chặn
// tốc độ mà KHÔNG chặn chiều, và committee hạ được 10% mỗi lượt. Với công thức v2 một lượt
// −10% khoá vĩnh viễn mọi tài khoản đã chạy ≥ 9 cửa sổ (CONTRACT v3 §0). v3 bỏ hẳn chiều
// giảm bằng C-BCN-5'; hằng này chỉ còn gác chiều NỚI.
// Chỉ có nghĩa khi mỗi cửa sổ post được tối đa một lượt — `beacon.ak` ép điều đó bằng
// C-BCN-2 (`epoch` đơn điệu TĂNG) đi cặp với C-BCN-3 (`epoch` == cửa sổ hiện tại).
pub const max_rate_root_delta_q: Int = 100_000_000
//                                     0,10 × q

// ── Sàn cắt ngọn (C-RDM-TRIM-FLOOR) ──────────────────────────────────────────
// `amount ≤ max(trim_floor, total_redeemed · trim_num / trim_den)`.
//
// BẮT BUỘC, không phải tuỳ chọn: không có nó, `total_redeemed = 0` là một ĐIỂM HẤP THỤ —
// trần bằng 0 ⇒ không ai rút được ⇒ `total_redeemed` mãi bằng 0 ⇒ hệ không bao giờ khởi
// động (`Math-Spec.md` v3 §5 HQ 4.1).
//
// VÌ SAO LÀ HẰNG Ở ĐÂY CHỨ KHÔNG PHẢI TRƯỜNG DATUM — khác hẳn `trim_num`/`trim_den` ngay
// bên cạnh nó về HƯỚNG HỎNG: siết `trim_num` chỉ hoãn một lượt rút, còn hạ `trim_floor` về
// 0 dựng lại đúng điểm hấp thụ mà chính nó sinh ra để phá, và hệ chết theo kiểu không ai
// kêu (mọi bất biến vẫn đúng, giao dịch chỉ đơn giản bị từ chối). Một tham số mà MỘT ĐẦU
// của miền giá trị là một cái bẫy thì không đưa vào datum. Giá phải trả: đổi nó đòi script
// hash mới — chấp nhận được vì nó là SÀN AN TOÀN, không phải NÚM ĐIỀU TIẾT.
pub const trim_floor: Int = 1_000_000_000
//                          1.000 LAMP — suy từ yêu cầu "ví 1.000 LAMP xong trong một cửa sổ"
