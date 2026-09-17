// LampDistribution constants — Capped Drop v2.
// Đơn vị: oildrop (1 LAMP = 10^6 oildrop). Q-format: Q = 10^9.
//
// ⚠ ĐỔI TÊN 2026-09-16 (vá Issue #72, lỗ 3). Bốn hằng dưới đây trước mang tiền tố `p_`
// và thuộc thiết kế **P-beacon** — thiết kế đã bị Capped Drop v2 thay (`CONTRACT.md:58`
// nay chỉ còn nhắc nó như quá khứ: "như P-beacon cũ"). Từ lúc bị thay tới nay chúng
// KHÔNG được validator nào đọc: đo bằng `grep -rn "p_min\|p_max\|max_p_delta_q"` trên
// `validators/` + `lib/` cho ra đúng ba dòng khai báo, không dòng dùng nào.
//
// Một bộ hằng mang tên của thiết kế đã chết, không ai đọc, nằm cạnh thiết kế đang sống
// là thứ đọc-là-tin: người sau mở `constants.ak` thấy có sàn/trần thì tin rằng D bị
// chặn. Nay chúng mang tên của đại lượng thật (`drop_value`) VÀ được `beacon.ak` đọc,
// nên cái tên và cái thực khớp nhau.
//
// CON SỐ thì thừa kế nguyên từ P, chưa qua một vòng chốt nào cho D — ghi ra để người
// đọc sau không tưởng đây là số đã cân. Đổi chúng là đổi biên độ điều hành, không phải
// đổi cơ chế: cơ chế nằm ở `beacon.ak`, ba dòng `expect` mang mã C-BCN-2/3/4.

pub const q: Int = 1_000_000_000

// ── Biên của D (drop_value, oildrop/drop·epoch) ──────────────────────────────
// `beacon.ak` ép mọi giá trị post lên beacon nằm trong [min, max].

pub const drop_value_genesis: Int = 100_000_000
//                                  100 LAMP — giá trị beacon mở sổ

pub const drop_value_min: Int = 10_000_000
//                              10 LAMP — SÀN CỨNG. Committee không đóng băng được
//                              vesting của tài khoản đang mở dở bằng cách hạ D về ~0.

pub const drop_value_max: Int = 10_000_000_000
//                              10_000 LAMP — TRẦN CỨNG của D. Một mình nó KHÔNG ghim
//                              được lịch vesting: tốc độ mở khoá là `D · drops_per_epoch`,
//                              và thừa số thứ hai do cùng committee đặt lúc mở tài khoản.
//                              Câu "lịch vesting ràng buộc cả bên phát hành" chỉ đứng
//                              được khi có ĐỦ trần D, trần dpe (dưới), và C-ACC-2/3 ở
//                              `treasury.ak` ghim mốc bắt đầu.

// ── Trần `drops_per_epoch` của một tài khoản ─────────────────────────────────
// `treasury.ak` C-ACC-4 ép `1 ≤ dpe ≤ trần` ở nhánh CREATE; `claim_account` giữ dpe bất
// biến ở `Claim`. Tốc độ mở khoá tối đa = `drop_value_max · drops_per_epoch_max`.
// GIÁ TRỊ TẠM cho Preprod — chốt trước mainnet cùng bộ biên D ở trên. 100 chứa được
// giá trị vận hành đang dùng (`Genesis/scripts/28_beacon_grant_redeem.ts`, hằng
// `DROPS_PER_EPOCH`, mặc định 21).
pub const drops_per_epoch_max: Int = 100

// ── Biên của MỘT LẦN đổi D ───────────────────────────────────────────────────
// `beacon.ak` ép |D_mới − D_cũ| · q ≤ D_cũ · max_drop_delta_q, tức ±10% mỗi lượt post.
// Chỉ có nghĩa khi mỗi cửa sổ post được tối đa một lượt — `beacon.ak` ép điều đó bằng
// C-BCN-2 (`epoch` đơn điệu TĂNG) đi cặp với C-BCN-3 (`epoch` == cửa sổ hiện tại).
// Bỏ một trong hai thì trần này vô hiệu: post n lượt trong một cửa sổ ⇒ đổi 1,1^n lần.
pub const max_drop_delta_q: Int = 100_000_000
//                                0,10 × q

// ĐÃ BỎ 2026-09-16: `p_ema_window` (α = 0.5). Nó là tham số của vòng làm trơn EMA trong
// P-beacon; Capped Drop không có vòng đó. Giữ lại một hằng không có cơ chế tương ứng là
// giữ một lời hứa về hành vi mà không mã nào thực hiện.
