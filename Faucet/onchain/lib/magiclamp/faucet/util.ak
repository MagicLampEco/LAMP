// Faucet shared helpers — double-satisfaction guards theo SCRIPT HASH
// (không full-address) như Distribution/util.ak. Cùng script hash + khác stake
// cred = address khác nhưng đều là UTxO của script → phải đếm theo hash.

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction}

/// Address của chính UTxO đang spend (resolve own_ref trong inputs).
pub fn own_address(own_ref: OutputReference, inputs: List<Input>) -> Address {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output.address
}

/// Script hash của address đang chạy.
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

pub fn input_at_script(inputs: List<Input>, script_hash: ByteArray) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { is_at_script(x.output.address, script_hash) })
  i.output
}

pub fn output_at_script(outputs: List<Output>, script_hash: ByteArray) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { is_at_script(x.address, script_hash) })
  o
}

// ── Epoch (validity_range lower_bound, POSIX ms) ──────────────────
// CHỐT THIẾT KẾ: "now" lấy từ lower_bound (cận DƯỚI). Cooldown ép
// now ≥ last + cooldown → dùng cận dưới khiến claimer KHÔNG thể giả "now" lớn
// hơn thực (validator chỉ tin khoảng [lower, upper] node đã xác thực). Reclaim
// ép now ≥ last + reclaim → cũng cận dưới: account chỉ bị thu hồi khi CHẮC CHẮN
// đã quá hạn (an toàn cho chủ DID).

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// Epoch hiện tại = lower_bound (POSIX ms) / ms_per_epoch.
pub fn get_epoch(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  s / ms_per_epoch
}

// ── NFT-beacon helpers ────────────────────────────────────────────

/// Output có mang đúng 1 NFT (policy, name) không.
pub fn has_nft(out: Output, policy: PolicyId, name: AssetName) -> Bool {
  assets.quantity_of(out.value, policy, name) == 1
}

/// Đếm input mang NFT (policy, name) — chống nhiều beacon trong 1 tx.
pub fn count_inputs_with_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.count(inputs, fn(x) { has_nft(x.output, policy, name) })
}

/// Đếm output mang NFT (policy, name).
pub fn count_outputs_with_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.count(outputs, fn(x) { has_nft(x, policy, name) })
}

/// Input duy nhất mang NFT (policy, name). Caller phải đảm bảo đúng 1.
pub fn input_with_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { has_nft(x.output, policy, name) })
  i.output
}

/// Output duy nhất mang NFT (policy, name).
pub fn output_with_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { has_nft(x, policy, name) })
  o
}

/// payment credential của address có phải VerificationKey(pkh) không.
pub fn is_owned_by(addr: Address, pkh: ByteArray) -> Bool {
  when addr.payment_credential is {
    VerificationKey(h) -> h == pkh
    _ -> False
  }
}

// ── Test-support builders (mock UTxO/tx) ──────────────────────────

pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

/// Cùng script hash, khác stake cred → address khác (test double-sat C-FAU-1).
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
