// Sổ kế toán dùng chung cho Collect + Release + Seed (gom primitive, tránh trùng).
//
// CANONICAL SỔ (đợt hardening v1 — chống bloat + chống âm):
//   C-POS   mọi dòng amount > 0           (KHÔNG dòng 0 = không bloat; KHÔNG âm = không drain)
//   C-SORT  sổ strict-sorted theo khóa (bucket_id, policy, name)
//           → loại trùng khóa O(n) (thay no_dup_lines O(n²)); cho so in↔out tuyến tính.
//   C-LINES trần SỐ DÒNG (`max_ledger_lines`) — xem khối lý do + số đo ngay dưới.
//   Bất biến nền T3 GIỮ NGUYÊN: ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a).
//   Dòng số dư 0 KHÔNG ghi (prune) → ledger_value bỏ nó vẫn đúng (đóng góp 0).

use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets.{Value}
use magiclamp/treasury/types.{LedgerEntry}

// ══════════════════════════════════════════════════════════════════════════════
// C-LINES — TRẦN SỐ DÒNG SỔ (CONTRACT §9 T3 + §10 H3 "van tạm = trần N_max đo-thực")
// ══════════════════════════════════════════════════════════════════════════════
//
// LỖ ĐƯỢC BỊT: `C-POS` + `C-SORT` nói về HÌNH DẠNG của sổ, không nói gì về KÍCH CỠ.
// Sổ là một `List` trong datum, và mọi nhánh nạp (`Collect` permissionless theo
// `accepted_assets`, `MigrateIn`, `StakeRewardIn`) đều CỘNG dòng. Mỗi dòng mới làm
// mọi lần tiêu kho SAU đó đắt hơn theo BẬC HAI (`each_out_line_ok` và
// `each_in_line_settled` đều duyệt sổ lồng trong `ledger.get`/`line_present`).
// Không trần ⇒ kẻ tấn công bơm dòng rác cho tới lúc MỌI giao dịch tiêu kho vượt trần
// ExUnit ⇒ kho KHOÁ VĨNH VIỄN, và LAMP không burn được nên đó là phá huỷ cung thật.
// Cùng họ lỗ với `namespace-freeze` đã gặp ở một kho khác: accumulator-list trong datum
// + đường ghi permissionless + không trần = đóng băng.
//
// VÌ SAO ĐẶT Ở ĐÂY, TRONG `is_canonical`, chứ không rải ra từng nhánh:
//   `is_canonical` là cổng DUY NHẤT mà cả năm đường ghi sổ đều đi qua —
//   `collect.ledger_ok`, `release.ledger_ok`, `migrate.ledger_ok` (và
//   `stake_reward.ledger_ok` gọi lại migrate), `custody_seed` ▸ S-LEDGER-0. Đặt một
//   dòng ở đây khiến nhánh ghi sổ viết SAU NÀY không thể ra đời mà thiếu trần.
//   Giá phải trả, nói thẳng: một đột biến gỡ vế này làm ĐỎ bài của cả năm nhánh cùng
//   lúc — bảng đột biến phải đọc theo nghĩa "một biểu thức phục vụ năm đường", không
//   đọc thành năm chốt độc lập.
//   Trần chỉ áp cho sổ ĐẦU RA (và sổ genesis). Sổ đầu vào không cần kiểm: genesis đã
//   bị chặn và mọi lượt sau đều ép đầu ra ≤ trần ⇒ theo quy nạp không trạng thái tới
//   được nào vượt trần.
//
// ── SỐ ĐO (2026-09-26, `aiken check` v1.1.21, mock `Transaction`) ──
// Đo trên bản chép ở thư mục nháp, bài `zbench_ledger` sinh sổ N dòng rồi gọi chính
// `custody.custody.spend`. Con số dưới đây là RÒNG = (bài gọi validator) − (bài dựng
// đúng fixture đó nhưng KHÔNG gọi validator), nên đã trừ chi phí dựng mock.
//
// Hình dạng đo: HÌNH DẠNG NẶNG NHẤT mà sổ canonical còn chấp nhận — N dòng CÙNG
// `bucket_id`, CÙNG `policy` 28 byte, khác `name` 32 byte. Mọi phép so khoá ở
// `key_lt`/`get`/`line_present` phải chạy `bytearray.compare` hết 28+32 byte.
// Hình dạng "tiêu biểu" (khác `bucket_id`, cùng asset) RẺ HƠN ~40%: Collect N=24 đo
// 6,03 M mem so với 9,86 M — ghi cả hai để 40% đệm không bị hình dạng gánh ngầm.
//
//   N   | Collect (mem / cpu)  | Release (mem / cpu)   ← Release là nhánh NẶNG NHẤT
//   ----+----------------------+----------------------
//   16  |  5,21 M / 1,739 B    |  5,36 M / 1,807 B
//   20  |  7,35 M / 2,465 B    |  7,48 M / 2,523 B
//   21  |  7,94 M / 2,660 B    |  8,08 M / 2,717 B
//   24  |  9,86 M / 3,312 B    |  9,98 M / 3,359 B
//   28  | 12,74 M / 4,278 B    |        —
//   32  | 15,99 M / 5,384 B    | 16,10 M / 5,431 B   ← ĐÃ VƯỢT trần mem 14 M
//
//   Cùng N=20, hai nhánh nạp còn lại nhẹ hơn Release: `StakeRewardIn` 6,79 M / 2,281 B;
//   `custody_seed` ▸ mint genesis 5,04 M / 1,629 B.
//
// ── CHỌN TRẦN = 20 ──
// Trần giao dịch Preprod/mainnet: mem 14.000.000 · steps 10.000.000.000 · tx 16.384 B.
// Yêu cầu dư ≥ 40% ⇒ ngân sách dùng được: mem ≤ 8.400.000 · steps ≤ 6.000.000.000.
//   N=20, nhánh nặng nhất (Release): mem 7,48 M = 53,4% trần ⇒ DƯ 46,6% ✓
//                                    steps 2,523 B = 25,2% trần ⇒ DƯ 74,8% ✓
//                                    datum CBOR 2.846 B = 17,4% trần tx ⇒ DƯ 82,6% ✓
//   N=21 vẫn đạt nhưng chỉ còn DƯ 42,3% mem — tức trần này CÁCH ngưỡng đúng MỘT bậc,
//   không phải cách xa. Đó là lý do lấy 20 chứ không lấy số đo sát biên:
//   phép đo trên mock `Transaction` KHÔNG gồm chi phí giải mã `ScriptContext` thật,
//   nên mọi con số trên là CẬN DƯỚI của chi phí on-chain.
//   N=22 KHÔNG đo trực tiếp (nội suy ~8,7 M ⇒ dư ~38%, dưới yêu cầu).
//
// ⚠ Đổi hằng này ⇒ đổi script hash của `custody` VÀ `custody_seed`. Đo lại theo đúng
// cách trên trước khi đổi; đừng suy bằng đường khớp (bậc hai khớp tốt ở N nhỏ vẫn khai
// trần sai ở N lớn).
//
// ⚠ Bài kiểm KHÔNG ghim được con số này bằng màu đỏ. `validators/ledger_cap_test.ak`
// lấy trần+1 từ chính hằng, nên nâng hằng lên 1000 không làm bài nào đỏ — nó làm bộ
// kiểm TREO (bài âm sinh sổ 1001 dòng trên nhánh bậc hai). Đã đo 2026-09-26. Cái ghim
// giá trị là `cap_constant_value_pinned`, và nó chỉ ghim theo nghĩa "đổi hằng thì phải
// sửa cả bài đó" — căn cứ cho CON SỐ vẫn chỉ là khối số đo trên.
pub const max_ledger_lines: Int = 20

/// C-LINES: sổ không vượt trần số dòng. Tách thành hàm có tên để bất biến đọc được và
/// để bài kiểm gọi trực tiếp được (đừng gọi `list.length` rải rác ở chỗ khác).
pub fn within_line_cap(ledger: List<LedgerEntry>) -> Bool {
  list.length(ledger) <= max_ledger_lines
}

/// Số dư của (bucket,policy,name) trong sổ; 0 nếu chưa có dòng (canonical: dòng 0 bị prune).
pub fn get(
  ledger    : List<LedgerEntry>,
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
) -> Int {
  when
    list.find(
      ledger,
      fn(e) { e.bucket_id == bucket_id && e.policy == policy && e.name == name },
    )
  is {
    Some(e) -> e.amount
    None -> 0
  }
}

/// Khóa a < khóa b theo thứ tự từ điển (bucket_id, policy, name).
pub fn key_lt(a: LedgerEntry, b: LedgerEntry) -> Bool {
  if a.bucket_id != b.bucket_id {
    a.bucket_id < b.bucket_id
  } else if a.policy != b.policy {
    bytearray.compare(a.policy, b.policy) == Less
  } else {
    bytearray.compare(a.name, b.name) == Less
  }
}

/// Sổ strict-sorted theo khóa: mỗi cặp liền kề khóa tăng NGHIÊM NGẶT.
/// strict ⇒ KHÔNG trùng khóa (thay no_dup_lines O(n²) bằng O(n)).
pub fn strict_sorted(ledger: List<LedgerEntry>) -> Bool {
  when ledger is {
    [] -> True
    [_] -> True
    [a, b, ..rest] -> key_lt(a, b) && strict_sorted([b, ..rest])
  }
}

/// Mọi dòng amount > 0 (C-POS): không dòng 0 (chống bloat), không âm (chống drain/sổ-dối).
pub fn all_positive(ledger: List<LedgerEntry>) -> Bool {
  list.all(ledger, fn(e) { e.amount > 0 })
}

/// Một dòng (theo khóa) có hiện diện trong sổ không.
pub fn line_present(ledger: List<LedgerEntry>, e: LedgerEntry) -> Bool {
  list.any(
    ledger,
    fn(o) { o.bucket_id == e.bucket_id && o.policy == e.policy && o.name == e.name },
  )
}

/// Value gồm toàn bộ số dư sổ (per-asset, gộp mọi bucket). policy=#"" name=#"" = lovelace.
pub fn value_of(ledger: List<LedgerEntry>) -> Value {
  list.foldl(
    ledger,
    assets.zero,
    fn(e, acc) { assets.add(acc, e.policy, e.name, e.amount) },
  )
}

/// Sổ canonical ⇔ trần số dòng (C-LINES) ∧ strict-sorted (C-SORT) ∧ mọi dòng > 0 (C-POS).
///
/// `within_line_cap` đứng TRƯỚC hai vế kia có chủ ý: nó là phép rẻ nhất (một lượt duyệt
/// đếm) và nó chặn đúng cái làm hai vế sau đắt. Sổ quá dài thì từ chối trước khi bỏ tiền
/// chạy `bytearray.compare` trên từng cặp khoá.
pub fn is_canonical(ledger: List<LedgerEntry>) -> Bool {
  within_line_cap(ledger) && strict_sorted(ledger) && all_positive(ledger)
}
