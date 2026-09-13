// Logic thuần cho nhánh MIGRATE-IN (C-MIG-*) — nạp Δ LAMP vừa mint vào KHO,
// VÀO VALUE **VÀ** VÀO SỔ trong CÙNG một giao dịch.
//
// VÌ SAO PHẢI CÓ NHÁNH NÀY (nguyên nhân gốc, không phải tính năng thêm):
//   Reserve nhả Δ bằng cách MINT (LAMP lazy-mint, Genesis `lamp_mint` đường ReserveDraw).
//   Hai nhánh cũ của custody đều ép `assets.is_zero(tx.mint)` ⇒ không hình dạng giao dịch
//   nào đưa Δ vào kho được:
//     • cùng tx (rút + nạp) → chết ở `is_zero(tx.mint)` của Collect/Release;
//     • hai tx → tx1 để lại UTxO KHÔNG datum ở địa chỉ custody, tiêu lại không được.
//   Kết quả là Δ bị đóng băng ngoài sổ — về kế toán, đóng băng ngoài sổ = ĐỐT, chỉ khác tên,
//   trong khi bất biến sản phẩm nói LAMP KHÔNG đốt: giảm lưu hành = CHUYỂN VÀO KHO.
//
// NGUYÊN TẮC: đích không phải một ĐỊA CHỈ, mà là một DÒNG SỔ. Rót đúng địa chỉ mà không
// ghi sổ thì Release không bao giờ rút lại được — kho phình value mà số dư bucket vẫn 0.
//
// Bất biến ÉP (điểm gọi ở `validators/custody.ak` nhánh `MigrateIn`):
//   C-MIG-6  mint: tx.mint chứa ĐÚNG (lamp_policy, token_name), Δ > 0        → `mint_ok`
//   C-MIG-7  value: cust_out.value == cust_in.value ⊕ Δ, asset khác NGUYÊN   → `value_ok`
//   C-MIG-8  sổ: ledger_out == ledger_in + Δ tại ĐÚNG MỘT (bucket, asset)    → `ledger_ok`
//   C-MIG-9  (lamp_policy, token_name) ∈ accepted_assets                      → `asset_accepted`

use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use magiclamp/treasury/ledger
use magiclamp/treasury/types.{AssetKey, LedgerEntry}

// ── C-MIG-8: CHỌN `category` cho dòng sổ (quyết định thiết kế, ghi rõ lý do) ──
//
// Ba phương án đã cân:
//   (a) lấy bucket từ redeemer (người dựng tx chọn) — LOẠI: bucket là thứ Governance đọc
//       để ra ngưỡng chi; cho người gọi chọn bucket = cho người gọi chọn luật chi sau này.
//   (b) thêm một PARAM validator cho bucket — LOẠI: đổi bucket ⇒ đổi script hash ⇒ đúc lại
//       custody; mà bucket là chuyện KẾ TOÁN, không đáng nướng vào định danh script.
//   (c) HẰNG dành riêng cho nguồn Reserve, và `source` trong redeemer phải KHỚP hằng đó.
//       CHỌN (c): fail-closed, không tham số nào do người gọi điều khiển, và mọi Δ từ
//       Reserve nằm gọn một dòng nên kiểm toán đọc được "kho đã nhận bao nhiêu từ Reserve"
//       bằng đúng một phép tra sổ.
//
// `source` do đó KHÔNG mang thông tin định tuyến — nó là NHÃN bị ghim. Giữ trường lại vì
// nó đã nằm trong `CustodyRedeemer` (index Constr phải ổn định với off-chain), và vì nó
// làm ý định của tx đọc được ngay trên redeemer.

/// bucket_id DÀNH RIÊNG cho Δ rút từ Reserve chảy vào kho.
///
/// F4 — hằng này nay được CƯỠNG CHẾ, không còn là quy ước off-chain:
///   • `collect.all_items_valid` từ chối mọi `CollectItem` mang `category` == id này
///     ⇒ không đường `Collect` nào ghi lén vào dòng sổ Reserve-inflow;
///   • `custody_seed` (S-LEDGER-RESERVED) từ chối sổ genesis chứa dòng mang bucket này
///     ⇒ không seed nào khai khống một số dư Reserve-inflow chưa từng rút.
/// ⟹ dòng sổ ở bucket này CHỈ do `MigrateIn` tạo ra, nên "kho đã nhận bao nhiêu từ
/// Reserve" đọc được bằng đúng một phép tra sổ.
pub const reserve_inflow_bucket_id: Int = 1_000_000

/// Nhãn nguồn BẮT BUỘC trong `MigrateIn { source }`. Ghim cứng → không đường nào dùng
/// `MigrateIn` để nạp vào một bucket khác.
pub const reserve_source_tag: ByteArray = "reserve-draw"

// ── C-MIG-9: asset phải nằm trong accepted_assets ──

/// (policy, name) có nằm trong danh sách asset instance chấp nhận không.
/// Không chấp nhận thì từ chối: kho không nhận asset mà nó không khai là biết cách chi.
pub fn asset_accepted(
  accepted : List<AssetKey>,
  policy   : ByteArray,
  name     : ByteArray,
) -> Bool {
  list.any(accepted, fn(a) { a.policy == policy && a.name == name })
}

// ── C-MIG-6: mint CÓ KIỂM SOÁT, không mở toang ──

/// tx.mint chứa ĐÚNG một cặp (policy, name) với lượng `delta` > 0.
///
/// Một đẳng thức Value khoá cả bốn chiều cùng lúc — đây là chỗ dễ mở lỗ nhất nên viết
/// bằng đẳng thức chứ không bằng vài phép so lẻ:
///   • không policy khác          (dict Value có thêm khoá ⇒ khác)
///   • không asset-name khác dưới CÙNG policy (dict trong cũng khác)
///   • không lượng âm ở bất kỳ đâu (mọi mục âm là một mục thừa ⇒ khác; còn chính cặp
///     đang xét đã bị `delta > 0` chặn)
///   • không mint rỗng / no-op    (`delta > 0`)
///
/// `without_lovelace`: Plutus V3 không đặt ada vào trường mint; gỡ ada ra là phòng thủ
/// cho biến thể biểu diễn, vô hại vì ada không mint được.
pub fn mint_ok(
  mint   : Value,
  policy : PolicyId,
  name   : ByteArray,
  delta  : Int,
) -> Bool {
  delta > 0 && assets.without_lovelace(mint) == assets.from_asset(
    policy,
    name,
    delta,
  )
}

// ── C-MIG-7: value ──

/// cust_out.value: phần PHI-LOVELACE khớp tuyệt đối cust_in ⊕ Δ; lovelace chỉ được TĂNG.
///
/// Vế phi-lovelace giữ đẳng thức (mirror `collect.value_ok`) nên vẫn khoá cả hai chiều:
/// asset đích tăng ĐÚNG Δ; mọi asset khác — NFT authenticity, token của thuê bao khác —
/// giữ NGUYÊN. Không rút được token, không nhét được token rác.
///
/// VÌ SAO LOVELACE PHẢI NỚI THÀNH `>=` (F5 — đảo chỉ dẫn của vòng trước):
///   Lượt `MigrateIn` ĐẦU TIÊN thêm một asset MỚI (LAMP) vào value VÀ một dòng vào datum
///   ⇒ min-UTxO của output tăng. Khoá cứng lovelace bằng đẳng thức ⇒ nếu `reserved_min_ada`
///   lúc seed không dư đủ thì ledger từ chối output ⇒ `MigrateIn` bất khả thi VĨNH VIỄN ⇒
///   kéo theo `ReserveDraw` bất khả thi (lamp_mint đòi kho tăng ròng ≥ Δ) ⇒ pot khoá.
///   Đường cứu duy nhất là một `Collect` mang item ADA, mà nó CHỈ tồn tại nếu ADA nằm
///   trong `accepted_assets` — thứ là bất biến đời instance, không nhánh nào đổi được.
///   Seed thiếu ADA = không có đường sửa. Đó là lý do nới, không phải tiện tay.
///
/// CÁI MẤT, nói thẳng: ADA bơm thêm trong lượt migrate là phần KHÔNG GHI SỔ — nó ứng xử
/// đúng như `reserved_min_ada`, tức `Release` (đọc sổ để chi) không rút nó ra được. Đây
/// là đánh đổi có chủ ý: đổi một khoản ADA kẹt lấy việc `MigrateIn` dựng được.
/// Đã kiểm: `reserved_min_ada` KHÔNG phải trường của `CustodyDatum` (`types.ak` —
/// `CustodyDatum` chỉ có instance_id/accepted_assets/ledger/cut_bps/governance_ref/epoch/
/// consumed_proposals) mà chỉ là tham số redeemer `SeedGenesis` của `custody_seed`, nên
/// KHÔNG có phép kiểm on-chain nào sau seed bị vế nới này phá.
pub fn value_ok(
  v_in   : Value,
  v_out  : Value,
  policy : PolicyId,
  name   : ByteArray,
  delta  : Int,
) -> Bool {
  assets.lovelace_of(v_out) >= assets.lovelace_of(v_in) && assets.without_lovelace(v_out) == assets.add(
    assets.without_lovelace(v_in),
    policy,
    name,
    delta,
  )
}

// ── C-MIG-8: sổ ──

/// Δ kỳ vọng cho MỘT dòng sổ: `delta` nếu dòng đúng khoá đích, 0 nếu không.
pub fn line_delta(
  e         : LedgerEntry,
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
  delta     : Int,
) -> Int {
  if e.bucket_id == bucket_id && e.policy == policy && e.name == name {
    delta
  } else {
    0
  }
}

/// Mỗi dòng OUT == số dư IN của chính khoá đó + Δ kỳ vọng.
/// Chặn luôn dòng khống: dòng mới không phải khoá đích có `get(in) + 0 == 0`, mà
/// `is_canonical` đòi mọi dòng > 0 ⇒ không nhồi được dòng nào.
pub fn each_out_line_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  bucket_id  : Int,
  policy     : ByteArray,
  name       : ByteArray,
  delta      : Int,
) -> Bool {
  list.all(
    ledger_out,
    fn(e) {
      e.amount == ledger.get(ledger_in, e.bucket_id, e.policy, e.name) + line_delta(
        e,
        bucket_id,
        policy,
        name,
        delta,
      )
    },
  )
}

/// Mọi dòng IN còn hiện diện ở OUT (MigrateIn chỉ CỘNG nên không dòng nào cạn về 0
/// — không có nhánh prune ở đây). Chặn xoá lén một dòng để rút value ra sau này.
pub fn each_in_line_settled(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
) -> Bool {
  list.all(ledger_in, fn(e) { ledger.line_present(ledger_out, e) })
}

/// Dòng đích (bucket, asset) PHẢI có mặt trong sổ ra — Δ > 0 nên nó không được phép vắng.
/// Thiếu vế này thì tx "value tăng, sổ không đổi" lọt qua: `each_out_line_ok` chỉ soi
/// những dòng ĐANG CÓ, nó không biết dòng nào đáng lẽ phải xuất hiện.
pub fn target_line_present(
  ledger_out : List<LedgerEntry>,
  bucket_id  : Int,
  policy     : ByteArray,
  name       : ByteArray,
) -> Bool {
  list.any(
    ledger_out,
    fn(e) { e.bucket_id == bucket_id && e.policy == policy && e.name == name },
  )
}

/// Sổ ra == sổ vào + Δ tại ĐÚNG MỘT (bucket_id, policy, name), dạng canonical.
pub fn ledger_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  bucket_id  : Int,
  policy     : ByteArray,
  name       : ByteArray,
  delta      : Int,
) -> Bool {
  ledger.is_canonical(ledger_out) && each_out_line_ok(
    ledger_in,
    ledger_out,
    bucket_id,
    policy,
    name,
    delta,
  ) && each_in_line_settled(ledger_in, ledger_out) && target_line_present(
    ledger_out,
    bucket_id,
    policy,
    name,
  )
}
