// Sổ kế toán dùng chung cho Collect + Release + Seed (gom primitive, tránh trùng).
//
// CANONICAL SỔ (đợt hardening v1 — chống bloat + chống âm):
//   C-POS   mọi dòng amount > 0           (KHÔNG dòng 0 = không bloat; KHÔNG âm = không drain)
//   C-SORT  sổ strict-sorted theo khóa (bucket_id, policy, name)
//           → loại trùng khóa O(n) (thay no_dup_lines O(n²)); cho so in↔out tuyến tính.
//   Bất biến nền T3 GIỮ NGUYÊN: ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a).
//   Dòng số dư 0 KHÔNG ghi (prune) → ledger_value bỏ nó vẫn đúng (đóng góp 0).

use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets.{Value}
use magiclamp/treasury/types.{LedgerEntry}

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

/// Sổ canonical ⇔ strict-sorted ∧ mọi dòng > 0.
pub fn is_canonical(ledger: List<LedgerEntry>) -> Bool {
  strict_sorted(ledger) && all_positive(ledger)
}
