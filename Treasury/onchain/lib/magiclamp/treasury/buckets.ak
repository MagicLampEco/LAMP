// Cấu hình DANH SÁCH ĐÓNG các bucket kế toán của một instance (`CustodyDatum.buckets`).
//
// LỖ ĐƯỢC BỊT (C-COL-CAT). `CollectItem.category` là một `Int` do NGƯỜI DỰNG TX đặt, và
// `Collect` là nhánh PERMISSIONLESS (`CONTRACT.md §3` mục 6). Bản trước chỉ loại HAI id
// dành riêng (`migrate.reserve_inflow_bucket_id`, `stake_reward.stake_reward_bucket_id`),
// nên mọi `Int` khác đi qua — và mỗi `(category, asset)` mới sinh MỘT dòng sổ. Ghép với
// trần số dòng `C-LINES` (20), đòn tấn công là: chạy `Collect` với cut nhỏ nhất có thể vào
// 20 category rác ⇒ sổ đầy ⇒ MỌI dòng hợp lệ mới bị từ chối vĩnh viễn. Trần chặn được
// "phình vô hạn" nhưng biến chính nó thành tài nguyên hữu hạn mà ai cũng chiếm được; danh
// sách đóng là vế còn thiếu để tài nguyên đó chỉ người gieo instance mới cấp phát.
//
// VÌ SAO Ở DATUM, không ở param validator: `CONTRACT.md §1` đã chốt
// `(governance_ref, accepted_assets[], buckets[], protocol_cut_bps)` nằm ở DATUM để DAO
// chỉnh mà không đổi script hash. Nướng `buckets` vào hash thì mở một bucket mới = đúc lại
// custody = di trú toàn bộ tài sản.
//
// VÌ SAO "TĂNG NGHIÊM NGẶT" thay vì "không trùng": cùng lý lẽ đã dùng cho sổ
// (`ledger.strict_sorted`) — `all_distinct` là O(n²/2), dãy tăng ngặt là MỘT lượt so cặp
// liền kề O(n) và nó MẠNH HƠN (tăng ngặt ⇒ không trùng). Chi phí dồn về người gieo: sắp
// danh sách đúng một lần, lúc seed. Lợi kèm: thứ tự là bất biến đọc được bằng mắt trên
// datum, còn "ba số này có trùng nhau không" thì phải đọc chéo.

use aiken/collection/list
use magiclamp/treasury/migrate
use magiclamp/treasury/stake_reward

/// C-COL-CAT: `category` có nằm trong danh sách bucket instance đã khai không.
///
/// Đây là vế THAY THẾ cho "category là Int tự do". Nó KHÔNG thay hai vế loại id dành riêng
/// ở `collect.all_items_valid`: hai vế ấy là phòng thủ theo chiều sâu cho ca `buckets` lọt
/// một id dành riêng — không xảy ra với instance gieo hợp lệ (`config_ok` chặn), nhưng vị
/// từ này nhận `buckets` làm tham số nên nó không tự biết điều đó.
pub fn is_declared(buckets: List<Int>, category: Int) -> Bool {
  list.has(buckets, category)
}

/// S-BUCKETS-SORTED: dãy tăng NGHIÊM NGẶT ⇒ không trùng, một lượt duyệt.
pub fn strictly_ascending(buckets: List<Int>) -> Bool {
  when buckets is {
    [] -> True
    [_] -> True
    [a, b, ..rest] -> a < b && strictly_ascending([b, ..rest])
  }
}

/// S-BUCKETS-RESERVED: danh sách khai KHÔNG được chứa bucket dành riêng.
///
/// Hai id ấy chỉ có nghĩa khi MỌI số dư trong chúng đến từ đúng nhánh sinh ra chúng
/// (`MigrateIn` / `StakeRewardIn`). Khai chúng vào `buckets` là mở lại đúng đường mà
/// `collect.all_items_valid` đóng: "kho đã nhận bao nhiêu từ Reserve / bao nhiêu thưởng uỷ
/// quyền" thôi đọc được bằng một phép tra sổ. Đếm ở đây phải BẰNG đếm ở
/// `collect.all_items_valid` và ở `custody_seed.no_reserved_bucket_lines`: HAI.
pub fn no_reserved(buckets: List<Int>) -> Bool {
  list.all(
    buckets,
    fn(b) {
      b != migrate.reserve_inflow_bucket_id && b != stake_reward.stake_reward_bucket_id
    },
  )
}

/// Cấu hình bucket hợp lệ ⇔ khác rỗng ∧ tăng nghiêm ngặt ∧ không chứa id dành riêng.
///
/// `buckets == []` phải bị loại RIÊNG, không suy được từ hai vế kia: `strictly_ascending([])`
/// và `no_reserved([])` đều `True` (đúng ngữ nghĩa của chúng), nên một instance rỗng sẽ lọt
/// và trở thành kho chỉ NHẬN qua MigrateIn/StakeRewardIn mà không `Collect` nào ghi được —
/// cùng họ với `S-ACC-1` ("không instance câm").
///
/// Gọi ở ĐÚNG MỘT chỗ: `custody_seed` lúc gieo. Sau đó `buckets` là bất biến đời instance
/// (mọi nhánh tiêu kho ghim `out.buckets == in.buckets`), nên kiểm lại ở nhánh tiêu là trả
/// tiền mỗi lượt cho một thứ đã đúng theo quy nạp.
pub fn config_ok(buckets: List<Int>) -> Bool {
  buckets != [] && strictly_ascending(buckets) && no_reserved(buckets)
}
