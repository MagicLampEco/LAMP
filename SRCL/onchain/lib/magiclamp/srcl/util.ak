// SRCL shared helpers — double-satisfaction guards theo SCRIPT HASH + NFT-beacon
// (mẫu Faucet/Allocation). Cùng script hash + khác stake cred = address khác
// nhưng đều là UTxO của script → đếm theo hash.

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction}

/// Address của chính UTxO đang spend.
pub fn own_address(own_ref: OutputReference, inputs: List<Input>) -> Address {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output.address
}

pub fn own_script_hash(own_addr: Address) -> ByteArray {
  expect Script(h) = own_addr.payment_credential
  h
}

pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

pub fn count_inputs_at_script(inputs: List<Input>, script_hash: ByteArray) -> Int {
  list.count(inputs, fn(x) { is_at_script(x.output.address, script_hash) })
}

pub fn count_outputs_at_script(outputs: List<Output>, script_hash: ByteArray) -> Int {
  list.count(outputs, fn(x) { is_at_script(x.address, script_hash) })
}

// ── Epoch (validity_range lower_bound, POSIX ms) ──────────────────
// "now" = cận DƯỚI: claimer/sweeper KHÔNG thể giả "now" lớn hơn thực. Sweep ép
// now > end_epoch → cận dưới khiến chỉ quét được khi CHẮC CHẮN đã hết SRCL.

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

pub fn get_epoch(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  s / ms_per_epoch
}

// ── NFT-beacon helpers ────────────────────────────────────────────

pub fn has_nft(out: Output, policy: PolicyId, name: AssetName) -> Bool {
  assets.quantity_of(out.value, policy, name) == 1
}

pub fn count_inputs_with_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.count(inputs, fn(x) { has_nft(x.output, policy, name) })
}

pub fn count_outputs_with_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.count(outputs, fn(x) { has_nft(x, policy, name) })
}

pub fn input_with_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { has_nft(x.output, policy, name) })
  i.output
}

pub fn output_with_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { has_nft(x, policy, name) })
  o
}

/// Đếm input mang NFT (policy,name) ĐỒNG THỜI ở địa chỉ Script(script_hash).
/// Dùng ép slot phải đến TỪ registry (chống slot tự chế ở ví bất kỳ).
pub fn count_inputs_with_nft_at_script(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
  script_hash: ByteArray,
) -> Int {
  list.count(
    inputs,
    fn(x) { has_nft(x.output, policy, name) && is_at_script(x.output.address, script_hash) },
  )
}

/// Đếm output mang NFT (policy,name) ĐỒNG THỜI ở địa chỉ Script(script_hash).
/// Dùng ép bộ slot lúc SetRoot phải gửi vào registry.
pub fn count_outputs_with_nft_at_script(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
  script_hash: ByteArray,
) -> Int {
  list.count(
    outputs,
    fn(x) { has_nft(x, policy, name) && is_at_script(x.address, script_hash) },
  )
}

/// Tổng qty token (policy) trong 1 output (mọi name của policy đó).
pub fn policy_qty_in_output(out: Output, policy: PolicyId) -> Int {
  list.foldl(
    assets.flatten(out.value),
    0,
    fn(t, acc) {
      let (p, _n, q) = t
      if p == policy {
        acc + q
      } else {
        acc
      }
    },
  )
}

/// Tổng qty token (policy) ở MỌI output KHÔNG thuộc Script(script_hash).
/// SetRoot dùng ép slot KHÔNG rò rỉ ra ngoài registry (= 0 ngoài registry).
pub fn policy_qty_outside_script(
  outputs: List<Output>,
  policy: PolicyId,
  script_hash: ByteArray,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if is_at_script(o.address, script_hash) {
        acc
      } else {
        acc + policy_qty_in_output(o, policy)
      }
    },
  )
}

/// LAMP (oildrop) tới owner (VerificationKey(pkh)) — cộng dồn mọi output của owner.
pub fn lamp_to_owner(
  outputs: List<Output>,
  owner: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if is_owned_by(o.address, owner) {
        acc + assets.quantity_of(o.value, lamp_policy, lamp_name)
      } else {
        acc
      }
    },
  )
}

/// LAMP (oildrop) tới Treasury (Script(treasury_dest)) — cộng dồn.
pub fn lamp_to_script(
  outputs: List<Output>,
  dest_hash: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if is_at_script(o.address, dest_hash) {
        acc + assets.quantity_of(o.value, lamp_policy, lamp_name)
      } else {
        acc
      }
    },
  )
}

pub fn is_owned_by(addr: Address, pkh: ByteArray) -> Bool {
  when addr.payment_credential is {
    VerificationKey(h) -> h == pkh
    _ -> False
  }
}

/// Committee/admin M-of-N đã ký đủ chưa. THAY `count_committee_sigs` cũ — hàm đó
/// trả Int nên ngưỡng phải kiểm ở call site, và không ai kiểm.
///
/// Hai lỗ nó bỏ (issue #21 B1):
///   • `list.count(committee, …)` đếm **phần tử danh sách**, không đếm **người**.
///     Admin bake nhầm `[a1, a1, a2]` threshold 2 → riêng a1 ký là đủ.
///   • `threshold` không chặn cận: `threshold ≤ 0` thì 0 chữ ký cũng qua.
///
/// Cả hai là lỗi lúc DEPLOY (admin/admin_threshold là param validator, không phải
/// datum) — không ai bên ngoài bịa được. Vẫn ép on-chain thay vì trông vào script
/// deploy: script deploy sửa được sau, param đã bake thì không.
/// Mẫu gốc: `Genesis/onchain/lib/magiclamp/genesis/registry.ak:96-101`.
pub fn committee_approved(
  committee: List<ByteArray>,
  threshold: Int,
  sigs: List<ByteArray>,
) -> Bool {
  // chặn ExUnit DoS + bound chi phí list.unique (O(n²)).
  expect list.length(committee) <= 16
  let uniq = list.unique(committee)
  and {
    threshold >= 1,
    threshold <= list.length(uniq),
    list.count(uniq, fn(c) { list.has(sigs, c) }) >= threshold,
  }
}

/// Phần tử thứ i của list (0-index). None nếu vượt độ dài.
pub fn list_at(xs: List<a>, i: Int) -> Option<a> {
  when xs is {
    [] -> None
    [x, ..rest] ->
      if i == 0 {
        Some(x)
      } else {
        list_at(rest, i - 1)
      }
  }
}

// ── Test-support builders ─────────────────────────────────────────

pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

pub fn script_address_staked(hash: ByteArray, stake_pkh: ByteArray) -> Address {
  Address {
    payment_credential: Script(hash),
    stake_credential: Some(Inline(VerificationKey(stake_pkh))),
  }
}

pub fn vk_address(pkh: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(pkh), stake_credential: None }
}

pub fn mk_output(addr: Address, value: Value, datum: Data) -> Output {
  Output { address: addr, value: value, datum: InlineDatum(datum), reference_script: None }
}

pub fn mk_output_no_datum(addr: Address, value: Value) -> Output {
  Output { address: addr, value: value, datum: NoDatum, reference_script: None }
}

pub fn mk_input(ref: OutputReference, out: Output) -> Input {
  Input { output_reference: ref, output: out }
}

pub fn mk_ref(ix: Int) -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: ix }
}

// ── Tests: committee_approved (issue #21 B1) ──────────────────

test committee_happy() {
  committee_approved([#"a1", #"b2", #"c3"], 2, [#"a1", #"c3", #"ff"])
}

test committee_not_enough() {
  !committee_approved([#"a1", #"b2"], 1, [#"ff"])
}

/// Admin trùng khoá KHÔNG được phá ngưỡng: `[a1, a1, a2]` threshold 2, chỉ a1 ký
/// thì bản cũ `list.count` ra 2 ⇒ pass.
test committee_dup_key_cannot_meet_threshold() {
  !committee_approved([#"a1", #"a1", #"a2"], 2, [#"a1"])
}

/// Cùng admin đó, đủ hai người thật thì vẫn phải qua.
test committee_dup_key_two_real_signers_pass() {
  committee_approved([#"a1", #"a1", #"a2"], 2, [#"a1", #"a2"])
}

/// threshold ≤ 0 thì KHÔNG chữ ký nào cũng qua ở bản cũ.
test committee_threshold_zero_rejected() {
  !committee_approved([#"a1", #"a2", #"a3"], 0, [])
}

/// threshold vượt số NGƯỜI thật (sau dedupe) = khoá chết, chặn ngay lúc kiểm.
test committee_threshold_above_unique_rejected() {
  !committee_approved([#"a1", #"a1"], 2, [#"a1"])
}
