// Genesis seed — bất biến nền sổ↔value tại genesis (mirror Treasury collect.seed_value_ok
// + no_dup_lines, đã audit). Tách hash mỗi pot + one-shot mint tái dùng các vị từ này.
//
// Bất biến nền (G-SEED): ∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a).
//   reserved_min_ada chỉ áp lovelace. Dựng Value kỳ vọng từ SỔ rồi so đẳng thức TUYỆT
//   ĐỐI với value seed — khóa cả hai chiều (không thiếu, không thừa).

use aiken/collection/list
use cardano/assets.{Value}
use magiclamp/genesis/types.{AssetKey, LedgerEntry}

/// Value gồm toàn bộ số dư sổ (per-asset, gộp mọi bucket cùng asset).
pub fn ledger_value(ledger: List<LedgerEntry>) -> Value {
  list.foldl(
    ledger,
    assets.zero,
    fn(e, acc) { assets.add(acc, e.policy, e.name, e.amount) },
  )
}

/// Seed hợp lệ ⇔ value == ledger_value(ledger) ⊕ reserved_min_ada (lovelace).
pub fn seed_value_ok(
  value            : Value,
  ledger           : List<LedgerEntry>,
  reserved_min_ada : Int,
) -> Bool {
  let expected =
    assets.merge(ledger_value(ledger), assets.from_lovelace(reserved_min_ada))
  value == expected
}

/// Sổ không có dòng trùng khóa (bucket,policy,name) — chống nhồi né incremental về sau.
pub fn no_dup_lines(ledger: List<LedgerEntry>) -> Bool {
  list.all(
    ledger,
    fn(e) {
      list.count(
        ledger,
        fn(o) {
          o.bucket_id == e.bucket_id && o.policy == e.policy && o.name == e.name
        },
      ) == 1
    },
  )
}

/// Mọi dòng sổ thuộc accepted_assets.
pub fn all_lines_accepted(
  ledger   : List<LedgerEntry>,
  accepted : List<AssetKey>,
) -> Bool {
  list.all(
    ledger,
    fn(e) {
      list.any(accepted, fn(a) { a.policy == e.policy && a.name == e.name })
    },
  )
}

/// Seed datum hợp lệ TOÀN PHẦN (gương đủ custody_seed): value↔sổ ∧ no_dup ∧ accepted.
pub fn seed_datum_ok(
  value            : Value,
  ledger           : List<LedgerEntry>,
  accepted         : List<AssetKey>,
  reserved_min_ada : Int,
) -> Bool {
  reserved_min_ada >= 0 && seed_value_ok(value, ledger, reserved_min_ada) && no_dup_lines(
    ledger,
  ) && all_lines_accepted(ledger, accepted)
}

// ── Tests ──────────────────────────────────────────────────────

const lamp_policy: ByteArray = #"744c414d50744c414d50744c414d50744c414d50744c414d50744c414d"

const lamp_name: ByteArray = #"744c414d50"

fn lamp_ledger(amount: Int) -> List<LedgerEntry> {
  [LedgerEntry { bucket_id: 1, policy: lamp_policy, name: lamp_name, amount }]
}

fn accepted() -> List<AssetKey> {
  [
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

test t_seed_value_ok_with_token() {
  // value = 1000 tLAMP + 2_000_000 reserved lovelace.
  let v =
    assets.zero
      |> assets.add(lamp_policy, lamp_name, 1_000)
      |> assets.add(#"", #"", 2_000_000)
  seed_value_ok(v, lamp_ledger(1_000), 2_000_000)
}

test t_seed_value_bad_extra() fail {
  // value tLAMP 2000 > sổ 1000 → thừa, fail (expect True nhưng là False).
  let v =
    assets.zero
      |> assets.add(lamp_policy, lamp_name, 2_000)
      |> assets.add(#"", #"", 2_000_000)
  seed_value_ok(v, lamp_ledger(1_000), 2_000_000)
}

test t_seed_empty_pot() {
  // pot rỗng (Treasury/Deposits): sổ rỗng, chỉ reserved lovelace.
  let v = assets.from_lovelace(2_000_000)
  seed_value_ok(v, [], 2_000_000)
}

test t_no_dup_true() {
  no_dup_lines(lamp_ledger(1_000))
}

test t_no_dup_false() {
  !no_dup_lines(
    [
      LedgerEntry { bucket_id: 1, policy: lamp_policy, name: lamp_name, amount: 500 },
      LedgerEntry { bucket_id: 1, policy: lamp_policy, name: lamp_name, amount: 500 },
    ],
  )
}

test t_seed_datum_ok_full() {
  let v =
    assets.zero
      |> assets.add(lamp_policy, lamp_name, 1_000)
      |> assets.add(#"", #"", 2_000_000)
  seed_datum_ok(v, lamp_ledger(1_000), accepted(), 2_000_000)
}

test t_seed_datum_unaccepted_false() {
  let bad = [LedgerEntry { bucket_id: 1, policy: #"dead", name: #"beef", amount: 10 }]
  let v =
    assets.zero
      |> assets.add(#"dead", #"beef", 10)
      |> assets.add(#"", #"", 2_000_000)
  !seed_datum_ok(v, bad, accepted(), 2_000_000)
}
