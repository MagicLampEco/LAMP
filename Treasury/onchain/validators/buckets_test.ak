// Bài ĐƠN VỊ cho `lib/magiclamp/treasury/buckets.ak` (C-COL-CAT · S-BUCKETS-*).
//
// VÌ SAO CẦN TẦNG ĐƠN VỊ, khi đã có bài ở tầng validator:
//   1. Hai vế `category != <id dành riêng>` trong `collect.all_items_valid` là PHÒNG THỦ
//      THEO CHIỀU SÂU nằm SAU một cổng mạnh hơn (`is_declared`). Với một instance gieo hợp
//      lệ, `config_ok` đã loại hai id ấy khỏi `buckets`, nên không ca kiểm TỰ NHIÊN nào ở
//      tầng validator chạm tới chúng. Ghim được chúng phải dựng ca mà cổng mạnh hơn CHO QUA
//      — ở đây là gọi thẳng hàm với `buckets` CHỨA id dành riêng.
//   2. `config_ok` là hợp của ba vế mà ba vế ấy KHÔNG suy được từ nhau. Bài validator
//      (`custody_seed_test` ▸ bài 21-25) chứng minh cổng seed từ chối từng cực, nhưng nó
//      không chứng minh được TẬP ĐẠT của mỗi vế — một bài đơn vị hai cực thì có.
//
// Nguyên tắc chung: mỗi vị từ phải có ca ĐẠT và ca TRƯỢT trong CÙNG một bài, vì một bài chỉ
// khẳng định `!p(x)` cũng xanh khi `p` trả `False` với mọi đầu vào.

use magiclamp/treasury/buckets
use magiclamp/treasury/collect
use magiclamp/treasury/migrate
use magiclamp/treasury/stake_reward
use magiclamp/treasury/types.{AssetKey, CollectItem}

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

fn accepted() -> List<AssetKey> {
  [AssetKey { policy: lamp_policy, name: lamp_name }]
}

fn item(category: Int) -> CollectItem {
  CollectItem {
    app_id: #"0001",
    policy: lamp_policy,
    name: lamp_name,
    amount: 1000,
    category: category,
  }
}

// ── is_declared ────────────────────────────────────────────────────────────

test bucket_is_declared_two_poles() {
  buckets.is_declared([1, 2, 5], 5) && !buckets.is_declared([1, 2, 5], 4)
}

/// Danh sách RỖNG không khai gì cả — vế này là lý do `config_ok` phải loại `[]` riêng.
test bucket_is_declared_empty_declares_nothing() {
  !buckets.is_declared([], 0) && !buckets.is_declared([], 1)
}

// ── strictly_ascending ─────────────────────────────────────────────────────

/// Bốn ca trong một bài, để thấy rõ TĂNG NGẶT mạnh hơn "không trùng": ca `[1, 1]` phải
/// TRƯỢT (một cổng `<=` cho nó qua), ca `[2, 1]` phải TRƯỢT (một cổng `all_distinct` cho nó
/// qua). Chỉ hai ca cùng trượt mới phân biệt được "tăng ngặt" với hai phép yếu hơn đó.
test bucket_strictly_ascending_poles() {
  buckets.strictly_ascending([1, 2, 3]) && buckets.strictly_ascending([7]) && buckets.strictly_ascending(
    [],
  ) && !buckets.strictly_ascending([1, 1]) && !buckets.strictly_ascending([2, 1]) && !buckets.strictly_ascending(
    [1, 3, 2],
  )
}

/// Số ÂM là thứ tự Int hợp lệ, không phải ca lỗi: vị từ so theo `<`, không theo dấu. Ghi ra
/// để không ai "sửa" nó thành `> 0` rồi khoá mất một lớp đánh số hợp lệ. Nếu về sau có
/// quyết định cấm bucket âm thì đó là một chốt MỚI, có tên riêng, không phải hệ quả ở đây.
test bucket_strictly_ascending_allows_negative() {
  buckets.strictly_ascending([-5, -1, 0, 3])
}

// ── no_reserved ────────────────────────────────────────────────────────────

/// Hai id dành riêng phải có hai ca RIÊNG: một bài gộp chúng vào một danh sách sẽ xanh y
/// nguyên khi chỉ MỘT trong hai vế còn sống.
test bucket_no_reserved_reserve_inflow() {
  buckets.no_reserved([1, 2]) && !buckets.no_reserved(
    [1, migrate.reserve_inflow_bucket_id],
  )
}

test bucket_no_reserved_stake_reward() {
  buckets.no_reserved([1, 2]) && !buckets.no_reserved(
    [1, stake_reward.stake_reward_bucket_id],
  )
}

// ── config_ok ──────────────────────────────────────────────────────────────

/// Ba vế của `config_ok`, mỗi vế một cực TRƯỢT, cộng một ca ĐẠT. Gỡ bất kỳ vế nào trong
/// `config_ok` làm bài này đỏ, và nó nói rõ vế nào bằng chính giá trị trong biểu thức.
test bucket_config_ok_rejects_each_pole() {
  buckets.config_ok([1, 2, 3]) && !buckets.config_ok([]) && !buckets.config_ok(
    [2, 1],
  ) && !buckets.config_ok([1, migrate.reserve_inflow_bucket_id]) && !buckets.config_ok(
    [1, stake_reward.stake_reward_bucket_id],
  )
}

// ── all_items_valid: ba vế của C-COL-CAT + hai vế id dành riêng ─────────────

/// C-COL-CAT ở tầng đơn vị: `category` ngoài danh sách khai → TRƯỢT, trong danh sách → ĐẠT.
test items_valid_category_must_be_declared() {
  collect.all_items_valid([item(2)], accepted(), [1, 2]) && !collect.all_items_valid(
    [item(3)],
    accepted(),
    [1, 2],
  )
}

/// Danh sách khai RỖNG ⇒ KHÔNG item nào hợp lệ. Đây là hệ quả phải nói ra, vì nó là lý do
/// `custody_seed` ▸ S-BUCKETS-NONEMPTY tồn tại: một instance `buckets == []` không khoá kho
/// (Release vẫn chi), nó chỉ làm `Collect` thôi thu được gì — một cái kho câm một nửa.
test items_valid_empty_buckets_rejects_all() {
  !collect.all_items_valid([item(0)], accepted(), []) && !collect.all_items_valid(
    [item(1)],
    accepted(),
    [],
  )
}

/// GHIM vế `category != migrate.reserve_inflow_bucket_id` — ca mà `is_declared` CHO QUA.
/// Ở tầng validator ca này không dựng được từ một instance gieo hợp lệ, nên nếu chỉ có bài
/// validator thì gỡ vế ấy đi không làm gì đỏ. Đây là chỗ duy nhất ghim được nó.
test items_valid_reserved_reserve_inflow_even_if_declared() {
  let bkts = [migrate.reserve_inflow_bucket_id]
  buckets.is_declared(bkts, migrate.reserve_inflow_bucket_id) && !collect.all_items_valid(
    [item(migrate.reserve_inflow_bucket_id)],
    accepted(),
    bkts,
  )
}

/// Đối xứng, cho id thứ hai. Hai bài riêng: gộp lại thì một vế chết mà bài vẫn xanh.
test items_valid_reserved_stake_reward_even_if_declared() {
  let bkts = [stake_reward.stake_reward_bucket_id]
  buckets.is_declared(bkts, stake_reward.stake_reward_bucket_id) && !collect.all_items_valid(
    [item(stake_reward.stake_reward_bucket_id)],
    accepted(),
    bkts,
  )
}

/// `list.all` ⇒ MỘT item lạ trong lô làm cả lô TRƯỢT. Ca đối chứng ĐẠT nằm cùng bài để
/// thấy hai bên phân biệt được nhau.
test items_valid_one_bad_item_sinks_batch() {
  collect.all_items_valid([item(1), item(2)], accepted(), [1, 2]) && !collect.all_items_valid(
    [item(1), item(9)],
    accepted(),
    [1, 2],
  )
}
