// Logic thuần cho sổ cọc + value (CONTRACT §5; SPEC §2). Tách khỏi validator để
// test đơn vị + giữ validator mỏng (mẫu Treasury collect.ak/release.ak).
//
// Khóa dòng = (entity_id, depositor, policy, name). Bất biến:
//   INV-LEDGER:  ∀a  pot.value(a) − reserved_min_ada(a) == Σ_dòng ledger[a]
//   Deposit: dòng đích += amount (cộng dồn nếu trùng khóa); dòng khác giữ nguyên.
//   Refund:  dòng đích bị XÓA; dòng khác giữ nguyên (chống double-refund).
//
// Value preservation: đẳng thức Value TUYỆT ĐỐI (rẻ ExUnit + khóa 2 chiều):
//   Deposit: pot_out.value == pot_in.value ⊕ {asset: amount}
//   Refund:  pot_out.value == pot_in.value ⊖ {asset: refund_amount}

use aiken/collection/list
use cardano/assets.{Value}
use magiclamp/deposits/types.{AssetKey, DepositLine}

// ── Khóa dòng + tra cứu ──────────────────────────────────────────────────

/// 2 dòng cùng khóa (entity_id, depositor, policy, name)?
pub fn same_key(a: DepositLine, b: DepositLine) -> Bool {
  a.entity_id == b.entity_id && a.depositor == b.depositor && a.policy == b.policy && a.name == b.name
}

/// Dòng khớp khóa (entity, depositor, asset)?
pub fn line_matches(
  e         : DepositLine,
  entity_id : ByteArray,
  depositor : ByteArray,
  policy    : ByteArray,
  name      : ByteArray,
) -> Bool {
  e.entity_id == entity_id && e.depositor == depositor && e.policy == policy && e.name == name
}

/// Tìm dòng theo khóa.
pub fn find_line(
  ledger    : List<DepositLine>,
  entity_id : ByteArray,
  depositor : ByteArray,
  policy    : ByteArray,
  name      : ByteArray,
) -> Option<DepositLine> {
  list.find(ledger, fn(e) { line_matches(e, entity_id, depositor, policy, name) })
}

/// Số dư dòng theo khóa; 0 nếu chưa có.
pub fn line_amount(
  ledger    : List<DepositLine>,
  entity_id : ByteArray,
  depositor : ByteArray,
  policy    : ByteArray,
  name      : ByteArray,
) -> Int {
  when find_line(ledger, entity_id, depositor, policy, name) is {
    Some(e) -> e.amount
    None -> 0
  }
}

// ── Bất biến chung sổ ─────────────────────────────────────────────────────

/// Sổ không có dòng trùng khóa.
pub fn no_dup_lines(ledger: List<DepositLine>) -> Bool {
  list.all(
    ledger,
    fn(e) { list.count(ledger, fn(o) { same_key(e, o) }) == 1 },
  )
}

/// Mọi dòng amount > 0 (không dòng âm/0 — refund xóa hẳn dòng).
pub fn all_lines_positive(ledger: List<DepositLine>) -> Bool {
  list.all(ledger, fn(e) { e.amount > 0 })
}

/// Mọi dòng thuộc accepted_assets.
pub fn all_lines_accepted(ledger: List<DepositLine>, accepted: List<AssetKey>) -> Bool {
  list.all(
    ledger,
    fn(e) {
      list.any(accepted, fn(a) { a.policy == e.policy && a.name == e.name })
    },
  )
}

/// asset (policy,name) ∈ accepted_assets?
pub fn asset_accepted(policy: ByteArray, name: ByteArray, accepted: List<AssetKey>) -> Bool {
  list.any(accepted, fn(a) { a.policy == policy && a.name == name })
}

// ── Value ↔ sổ (INV-LEDGER, dùng cho seed + tự kiểm) ──────────────────────

/// Value gồm toàn bộ số dư sổ (per-asset, gộp mọi dòng cùng asset).
pub fn ledger_value(ledger: List<DepositLine>) -> Value {
  list.foldl(
    ledger,
    assets.zero,
    fn(e, acc) { assets.add(acc, e.policy, e.name, e.amount) },
  )
}

/// Pot seed/state hợp lệ ⇔ value == ledger_value ⊕ reserved_min_ada (lovelace).
pub fn pot_value_ok(value: Value, ledger: List<DepositLine>, reserved_min_ada: Int) -> Bool {
  let expected =
    assets.merge(ledger_value(ledger), assets.from_lovelace(reserved_min_ada))
  value == expected
}

// ── DEPOSIT: dòng đích += amount; dòng khác giữ nguyên (C-DEP-6) ───────────
// Kiểm 4 chiều (mirror Treasury):
//   (1) no_dup_lines(out)
//   (2) all_lines_positive(out)  — mọi dòng > 0 (chặn dòng âm/0)
//   (3) each_out_line_ok         — mỗi dòng out:
//          dòng đích  → == get(in,key) + amount
//          dòng khác  → == get(in, key) (giữ nguyên, không sửa)
//   (4) each_in_line_present     — mọi dòng in còn trong out (không xóa dòng người khác)
//       + có ĐÚNG 1 dòng đích trong out (cộng dồn, không tạo 2 dòng).

/// Δ kỳ vọng cho 1 dòng out khi Deposit: +amount nếu là dòng đích, 0 nếu khác.
fn deposit_delta(
  e         : DepositLine,
  entity_id : ByteArray,
  depositor : ByteArray,
  policy    : ByteArray,
  name      : ByteArray,
  amount    : Int,
) -> Int {
  if line_matches(e, entity_id, depositor, policy, name) {
    amount
  } else {
    0
  }
}

pub fn deposit_each_out_line_ok(
  ledger_in  : List<DepositLine>,
  ledger_out : List<DepositLine>,
  entity_id  : ByteArray,
  depositor  : ByteArray,
  policy     : ByteArray,
  name       : ByteArray,
  amount     : Int,
) -> Bool {
  list.all(
    ledger_out,
    fn(e) {
      let base = line_amount(ledger_in, e.entity_id, e.depositor, e.policy, e.name)
      let want = base + deposit_delta(e, entity_id, depositor, policy, name, amount)
      // dòng khác đích: want == base (delta 0) → giữ nguyên.
      // dòng đích: want == base + amount.
      // entity/epoch của dòng out phải khớp KHÓA (đã đảm bảo qua e.* tự thân).
      e.amount == want
    },
  )
}

/// Mọi dòng IN còn trong OUT (chống xóa dòng người khác trong Deposit).
pub fn each_in_line_present(
  ledger_in  : List<DepositLine>,
  ledger_out : List<DepositLine>,
) -> Bool {
  list.all(
    ledger_in,
    fn(e) { list.any(ledger_out, fn(o) { same_key(o, e) }) },
  )
}

/// Có ĐÚNG 1 dòng đích trong out (cộng dồn về 1 dòng, không tách 2).
pub fn target_line_present_once(
  ledger_out : List<DepositLine>,
  entity_id  : ByteArray,
  depositor  : ByteArray,
  policy     : ByteArray,
  name       : ByteArray,
) -> Bool {
  list.count(
    ledger_out,
    fn(o) { line_matches(o, entity_id, depositor, policy, name) },
  ) == 1
}

pub fn deposit_ledger_ok(
  ledger_in  : List<DepositLine>,
  ledger_out : List<DepositLine>,
  entity_id  : ByteArray,
  depositor  : ByteArray,
  policy     : ByteArray,
  name       : ByteArray,
  amount     : Int,
) -> Bool {
  no_dup_lines(ledger_out) && all_lines_positive(ledger_out) && deposit_each_out_line_ok(
    ledger_in,
    ledger_out,
    entity_id,
    depositor,
    policy,
    name,
    amount,
  ) && each_in_line_present(ledger_in, ledger_out) && target_line_present_once(
    ledger_out,
    entity_id,
    depositor,
    policy,
    name,
  )
}

/// value pot tăng ĐÚNG amount của asset (đẳng thức tuyệt đối — asset khác giữ nguyên).
pub fn deposit_value_ok(
  v_in   : Value,
  v_out  : Value,
  policy : ByteArray,
  name   : ByteArray,
  amount : Int,
) -> Bool {
  v_out == assets.add(v_in, policy, name, amount)
}

// ── REFUND: xóa dòng đích; dòng khác giữ nguyên (C-REF-6) ──────────────────
// Kiểm:
//   (1) no_dup_lines(out)
//   (2) all_lines_positive(out)
//   (3) dòng đích KHÔNG còn trong out (XÓA → chống double-refund)
//   (4) mọi dòng out là dòng in KHÔNG phải đích, giữ nguyên amount
//       (each_out_is_untouched_in) — chống sửa lén dòng khác / thêm dòng khống.
//   (5) mọi dòng in KHÁC đích còn trong out (each_in_nontarget_present) —
//       chống xóa lén dòng người khác.

/// Dòng đích đã bị XÓA khỏi out.
pub fn target_absent(
  ledger_out : List<DepositLine>,
  entity_id  : ByteArray,
  depositor  : ByteArray,
  policy     : ByteArray,
  name       : ByteArray,
) -> Bool {
  !list.any(
    ledger_out,
    fn(o) { line_matches(o, entity_id, depositor, policy, name) },
  )
}

/// Mỗi dòng OUT là 1 dòng IN không-phải-đích, giữ NGUYÊN amount (entity/epoch/amount khớp).
/// Chống: thêm dòng khống, sửa amount dòng khác, đổi epoch.
pub fn each_out_is_untouched_in(
  ledger_in  : List<DepositLine>,
  ledger_out : List<DepositLine>,
) -> Bool {
  list.all(
    ledger_out,
    fn(o) {
      when list.find(ledger_in, fn(i) { same_key(i, o) }) is {
        Some(i) -> i == o
        None -> False
      }
    },
  )
}

/// Mọi dòng IN KHÁC đích còn trong out (chống xóa lén dòng người khác).
pub fn each_in_nontarget_present(
  ledger_in  : List<DepositLine>,
  ledger_out : List<DepositLine>,
  entity_id  : ByteArray,
  depositor  : ByteArray,
  policy     : ByteArray,
  name       : ByteArray,
) -> Bool {
  list.all(
    ledger_in,
    fn(i) {
      if line_matches(i, entity_id, depositor, policy, name) {
        True
      } else {
        list.any(ledger_out, fn(o) { same_key(o, i) })
      }
    },
  )
}

pub fn refund_ledger_ok(
  ledger_in  : List<DepositLine>,
  ledger_out : List<DepositLine>,
  entity_id  : ByteArray,
  depositor  : ByteArray,
  policy     : ByteArray,
  name       : ByteArray,
) -> Bool {
  no_dup_lines(ledger_out) && all_lines_positive(ledger_out) && target_absent(
    ledger_out,
    entity_id,
    depositor,
    policy,
    name,
  ) && each_out_is_untouched_in(ledger_in, ledger_out) && each_in_nontarget_present(
    ledger_in,
    ledger_out,
    entity_id,
    depositor,
    policy,
    name,
  )
}

/// value pot giảm ĐÚNG refund_amount của asset (đẳng thức tuyệt đối).
pub fn refund_value_ok(
  v_in   : Value,
  v_out  : Value,
  policy : ByteArray,
  name   : ByteArray,
  refund_amount : Int,
) -> Bool {
  v_out == assets.add(v_in, policy, name, -refund_amount)
}
