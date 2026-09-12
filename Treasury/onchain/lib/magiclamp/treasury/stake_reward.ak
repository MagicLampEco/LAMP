// Logic thuần cho nhánh STAKE-REWARD-IN (C-STK-*) — nạp Δ ADA phần thưởng uỷ quyền
// của CHÍNH kho vào VALUE **VÀ** vào SỔ trong cùng một giao dịch.
//
// VÌ SAO PHẢI CÓ NHÁNH NÀY (nguyên nhân gốc, không phải tính năng thêm):
//   Kho được gieo với địa chỉ (payment: Script(custody), stake: Script(treasury_stake)).
//   Toàn bộ ADA trong kho sinh thưởng uỷ quyền, và `treasury_stake` ép thưởng về một ĐÍCH
//   tham số hoá (`reward_cred`). Muốn đích đó là chính kho thì phải tồn tại một hình dạng
//   giao dịch đưa ADA vào kho ĐÚNG SỔ. Ba nhánh cũ đều không làm được:
//     • `Collect` — `collect.value_ok` là ĐẲNG THỨC tuyệt đối
//       (`lib/magiclamp/treasury/collect.ak` ▸ `value_ok`): mọi ADA lạ rơi vào output kho
//       làm Collect bị từ chối. Và cut là một CÔNG THỨC (`item_cut`), không nhận được một
//       khoản thưởng có sẵn.
//     • `MigrateIn` — `migrate.value_ok` nới lovelace thành `>=`, nhưng docstring của chính
//       nó khai phần ADA bơm thêm là KHÔNG GHI SỔ, tức `Release` không rút ra được. Nhánh
//       ấy còn ĐÒI mint (C-MIG-6 `delta > 0`), mà thưởng staking không đi kèm mint nào.
//     • `Release` — chi RA, không nạp vào.
//   Không có nhánh này thì `reward_cred` buộc phải là một ví ngoài ⇒ thưởng của DAO đi qua
//   tay người vận hành trước khi (may ra) quay về kho.
//
// NGUYÊN TẮC: đích không phải một ĐỊA CHỈ, mà là một DÒNG SỔ. Rót đúng địa chỉ mà không
// ghi sổ thì `Release` (đọc sổ để chi) không bao giờ rút lại được — kho phình value mà số
// dư bucket vẫn 0, tức đốt trá hình.
//
// Bất biến ÉP (điểm gọi ở `validators/custody.ak` nhánh `StakeRewardIn`):
//   C-STK-7  value: lovelace_out == lovelace_in + Δ (ĐẲNG THỨC), asset khác NGUYÊN → `value_ok`
//   C-STK-8  sổ:    ledger_out == ledger_in + Δ tại ĐÚNG (bucket hằng, ADA)        → `ledger_ok`
//
// VÌ SAO LOVELACE Ở ĐÂY LÀ `==` CHỨ KHÔNG PHẢI `>=` NHƯ `migrate.value_ok`:
//   `>=` mở lại đúng cái lỗ mà `migrate.ak` đã khai nhận bằng chữ — phần chênh giữa độ
//   tăng thực và Δ khai là ADA nằm trong kho mà KHÔNG có dòng sổ nào, nên `Release` không
//   rút ra được. Ở `MigrateIn` khoản chênh ấy là giá phải trả để lượt migrate ĐẦU TIÊN dựng
//   được (thêm asset mới ⇒ min-UTxO tăng ⇒ khoá cứng lovelace là khoá chết pot). Nhánh này
//   KHÔNG có sức ép đó: nó chỉ cộng lovelace, không thêm asset mới vào value, và dòng sổ
//   mới nó tạo là dòng DUY NHẤT — dư địa min-UTxO cho một dòng datum đã có từ lượt đầu,
//   còn mọi lượt sau thì dòng ấy đã tồn tại nên kích thước datum không đổi. Không có lý do
//   nào bắt phải nới, nên không nới.

use cardano/assets.{Value}
use magiclamp/treasury/migrate
use magiclamp/treasury/types.{LedgerEntry}

// ── C-STK-8: CHỌN `bucket_id` cho dòng sổ (soi gương `migrate.reserve_inflow_bucket_id`) ──
//
// Cùng ba phương án, cùng kết luận: bucket là HẰNG dành riêng, không lấy từ redeemer
// (người gọi chọn bucket = người gọi chọn luật chi sau này) và không thành param validator
// (bucket là chuyện KẾ TOÁN, không đáng nướng vào định danh script).

/// bucket_id DÀNH RIÊNG cho thưởng uỷ quyền của chính kho chảy vào kho.
///
/// Cưỡng chế ở hai đầu, y như `migrate.reserve_inflow_bucket_id`:
///   • `collect.all_items_valid` từ chối mọi `CollectItem` mang `category` == id này
///     ⇒ không đường `Collect` nào ghi lén vào dòng sổ thưởng staking;
///   • `custody_seed` (S-LEDGER-RESERVED) từ chối sổ genesis chứa dòng mang bucket này
///     ⇒ không seed nào khai khống một số dư thưởng chưa từng nhận.
/// ⟹ dòng sổ ở bucket này CHỈ do `StakeRewardIn` tạo ra, nên "kho đã thu bao nhiêu thưởng
/// uỷ quyền" đọc được bằng đúng một phép tra sổ.
pub const stake_reward_bucket_id: Int = 1_000_001

/// Khoá asset của dòng sổ thưởng: ADA (lovelace) — `policy = #""`, `name = #""`
/// theo quy ước sổ ở `types.ak` ▸ `LedgerEntry`.
///
/// Không lấy từ redeemer và không lấy từ param: thưởng uỷ quyền là ADA theo ledger
/// Cardano, không có biến thể nào khác. Một tham số ở đây chỉ mở thêm bề mặt cho người
/// dựng tx chọn, mà không mua được gì.
pub const reward_policy: ByteArray = #""

pub const reward_name: ByteArray = #""

// ── C-STK-7: value ──

/// cust_out.value: lovelace tăng ĐÚNG Δ; phần PHI-LOVELACE khớp TUYỆT ĐỐI cust_in.
///
/// Hai vế khoá hai hướng khác nhau, cả hai đều cần:
///   • đẳng thức lovelace — chặn cả "Δ khai lớn hơn thực nhận" (kho ghi sổ nhiều hơn tiền
///     thật ⇒ `Release` rút vượt) LẪN "thực nhận lớn hơn Δ khai" (ADA không ghi sổ, kẹt
///     ngoài sổ vĩnh viễn);
///   • đẳng thức phi-lovelace — chặn dùng nhánh này làm đường rút LAMP hoặc gỡ NFT
///     authenticity ra khỏi kho, và chặn nhét token rác làm phình UTxO.
pub fn value_ok(v_in: Value, v_out: Value, delta: Int) -> Bool {
  assets.lovelace_of(v_out) == assets.lovelace_of(v_in) + delta && assets.without_lovelace(
    v_out,
  ) == assets.without_lovelace(v_in)
}

// ── C-STK-8: sổ ──

/// Sổ ra == sổ vào + Δ tại ĐÚNG MỘT (stake_reward_bucket_id, ADA), dạng canonical.
///
/// Tái dùng `migrate.ledger_ok` chứ KHÔNG chép lại: phép "cộng Δ vào đúng một dòng sổ, mọi
/// dòng khác nguyên, sổ ra canonical, dòng đích phải có mặt" là CÙNG MỘT phép, chỉ khác
/// khoá đích. Chép lại bốn hàm phụ của nó sang đây là tạo nguồn thứ hai cho cùng một luật —
/// và bản sao đó sẽ chết im lặng ở lần đầu tiên ai đó siết `migrate.ledger_ok`.
pub fn ledger_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  delta      : Int,
) -> Bool {
  migrate.ledger_ok(
    ledger_in,
    ledger_out,
    stake_reward_bucket_id,
    reward_policy,
    reward_name,
    delta,
  )
}
