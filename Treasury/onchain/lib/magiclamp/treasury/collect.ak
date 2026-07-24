// Logic thuần cho nhánh COLLECT (CONTRACT §3; TECH §4 C-COL-*).
// Tách khỏi validator để test đơn vị + giữ validator mỏng.
//
// Bất biến ÉP (đơn-bucket, incremental — CONTRACT §9 T2+T3):
//   cut(item)              = ⌊ item.amount × cut_bps / 10000 ⌋     (C-COL-4)
//   ledger_out            = ledger_in với MỖI (category, asset) += Σ cut của item đúng (category,asset)
//   ∀ asset a có Δ:        Σ_b Δledger[(b,a)] == Σ_{item.asset=a} cut(item) == Δvalue(a)   (C-COL-5)
//   ∀ asset a KHÔNG đụng:  custody_out.value(a) == custody_in.value(a)                       (T3)
//   sổ out CANONICAL:      strict-sorted ∧ mọi dòng > 0 (C-SORT/C-POS — ledger.ak)
//
// KHÔNG burn: value bảo toàn TUYỆT ĐỐI per-asset. Cách ép value mạnh nhất + rẻ ExUnit:
//   custody_out.value == custody_in.value ⊕ cut_value(items)
// — một đẳng thức Value khóa CẢ hai chiều: asset trong items tăng đúng cut, asset không
// đụng giữ nguyên (Σout=Σin). Residual amount−cut do CALLER trả thẳng provider ngoài custody.

use aiken/collection/list
use cardano/assets.{Value}
use magiclamp/treasury/ledger
use magiclamp/treasury/types.{AssetKey, CollectItem, LedgerEntry}

/// cut của 1 item = floor(amount × cut_bps / 10000). amount ≥ 0, cut_bps ∈ [0,10000]
/// (ÉP range tại seed S-CUT-0 — bất biến đời instance, không nhánh nào đổi ở v1).
pub fn item_cut(amount: Int, cut_bps: Int) -> Int {
  amount * cut_bps / 10000
}

// ── Kiểm tra mỗi item hợp lệ: amount ≥ 0, asset ∈ accepted_assets ──

pub fn item_accepted(item: CollectItem, accepted: List<AssetKey>) -> Bool {
  list.any(accepted, fn(a) { a.policy == item.policy && a.name == item.name })
}

pub fn all_items_valid(items: List<CollectItem>, accepted: List<AssetKey>) -> Bool {
  list.all(
    items,
    fn(it) { it.amount >= 0 && item_accepted(it, accepted) },
  )
}

// ── Δ kỳ vọng cho sổ ──

/// Tổng cut kỳ vọng cho 1 dòng (bucket=category, asset) từ items.
pub fn expected_line_delta(
  items     : List<CollectItem>,
  cut_bps   : Int,
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
) -> Int {
  list.foldl(
    items,
    0,
    fn(it, acc) {
      if it.category == bucket_id && it.policy == policy && it.name == name {
        acc + item_cut(it.amount, cut_bps)
      } else {
        acc
      }
    },
  )
}

// ── ÉP bất biến sổ: ledger_out == ledger_in + Σcut tại (category,asset), CANONICAL ──
// Kiểm để chống thêm/bớt/xóa dòng lén:
//   (1) ledger.is_canonical(out): strict-sorted (loại trùng O(n)) ∧ mọi dòng > 0
//       (chống nhồi dòng trùng/0/âm để né kiểm hoặc bơm sổ).
//   (2) each_out_line_ok: mỗi dòng out == get(in) + Δkỳvọng(items).
//   (3) each_in_line_settled: mọi dòng in còn trong out, TRỪ khi số dư mới == 0 (prune).
//   (4) each_item_has_target: mọi item có cut > 0 phải có dòng đích trong out (cut vào sổ).

pub fn each_out_line_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  items      : List<CollectItem>,
  cut_bps    : Int,
) -> Bool {
  list.all(
    ledger_out,
    fn(e) {
      let want =
        ledger.get(ledger_in, e.bucket_id, e.policy, e.name) + expected_line_delta(
          items,
          cut_bps,
          e.bucket_id,
          e.policy,
          e.name,
        )
      e.amount == want
    },
  )
}

/// Mọi dòng IN còn hiện diện trong OUT, TRỪ khi số dư mới == 0 thì được prune (vắng).
/// (Collect chỉ cộng cut ≥ 0 nên số dư chỉ tăng → thực tế không prune; giữ tổng quát.)
pub fn each_in_line_settled(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  items      : List<CollectItem>,
  cut_bps    : Int,
) -> Bool {
  list.all(
    ledger_in,
    fn(e) {
      let new_bal =
        e.amount + expected_line_delta(
          items,
          cut_bps,
          e.bucket_id,
          e.policy,
          e.name,
        )
      if new_bal == 0 {
        True
      } else {
        ledger.line_present(ledger_out, e)
      }
    },
  )
}

pub fn each_item_has_target(
  ledger_out : List<LedgerEntry>,
  items      : List<CollectItem>,
  cut_bps    : Int,
) -> Bool {
  list.all(
    items,
    fn(it) {
      // Item cut == 0 không đổi sổ → không bắt buộc dòng đích.
      if item_cut(it.amount, cut_bps) == 0 {
        True
      } else {
        list.any(
          ledger_out,
          fn(o) {
            o.bucket_id == it.category && o.policy == it.policy && o.name == it.name
          },
        )
      }
    },
  )
}

pub fn ledger_ok(
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  items      : List<CollectItem>,
  cut_bps    : Int,
) -> Bool {
  ledger.is_canonical(ledger_out) && each_out_line_ok(
    ledger_in,
    ledger_out,
    items,
    cut_bps,
  ) && each_in_line_settled(ledger_in, ledger_out, items, cut_bps) && each_item_has_target(
    ledger_out,
    items,
    cut_bps,
  )
}

// ── ÉP bất biến value: custody_out.value == custody_in.value ⊕ cut_value(items) ──
// Một Value cộng dồn cut của mọi item; so đẳng thức TUYỆT ĐỐI với Value đầu/cuối.

/// Value gồm đúng phần cut của mọi item (per-asset). policy=#"" name=#"" = lovelace.
pub fn cut_value(items: List<CollectItem>, cut_bps: Int) -> Value {
  list.foldl(
    items,
    assets.zero,
    fn(it, acc) {
      assets.add(acc, it.policy, it.name, item_cut(it.amount, cut_bps))
    },
  )
}

/// custody_out.value KHỚP TUYỆT ĐỐI custody_in.value + Σcut. Khóa Σout=Σin per-asset.
pub fn value_ok(v_in: Value, v_out: Value, items: List<CollectItem>, cut_bps: Int) -> Bool {
  v_out == assets.merge(v_in, cut_value(items, cut_bps))
}

// ── ÉP bất biến NỀN tại GENESIS (seed custody) — CONTRACT types.ak ──
// Bất biến nền:  ∀a  Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a)
//   reserved_min_ada chỉ áp cho lovelace (#""/#"") — phần ADA giữ cho min-UTxO,
//   KHÔNG ghi sổ. Mọi asset khác booked đầy đủ (reserved = 0).
//
// Cách ép MẠNH NHẤT + rẻ ExUnit (mirror value_ok): dựng Value kỳ vọng từ SỔ rồi
// so đẳng thức TUYỆT ĐỐI với value seed. Một đẳng thức Value khóa CẢ hai chiều:
//   (1) mọi asset booked PHẢI hiện diện đúng lượng trong custody (không thiếu);
//   (2) KHÔNG asset nào nằm trong custody mà thiếu dòng sổ (không thừa → Release
//       đọc sổ sẽ không over/under-draw). Lovelace = Σ sổ lovelace + reserved.

/// Seed custody hợp lệ ⇔ value == sổ ⊕ reserved_min_ada (lovelace) ⊕ authenticity NFT.
/// Hai thành phần KHÔNG ghi sổ: reserved_min_ada (ADA giữ cho min-UTxO) + 1 NFT
/// (nft_policy, nft_name) chứng thực custody (custody_seed mint, custody.ak ép hiện diện).
pub fn seed_value_ok(
  value           : Value,
  ledger_lines    : List<LedgerEntry>,
  reserved_min_ada: Int,
  nft_policy      : ByteArray,
  nft_name        : ByteArray,
) -> Bool {
  let expected =
    ledger.value_of(ledger_lines)
      |> assets.merge(assets.from_lovelace(reserved_min_ada))
      |> assets.add(nft_policy, nft_name, 1)
  value == expected
}
