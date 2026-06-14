// Airdrop shared helpers — NFT-beacon authenticity + double-satisfaction guards
// theo SCRIPT HASH (không full-address). Mượn mẫu Faucet/util.ak + Allocation/util.ak.

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction}

// ── Own-UTxO resolution ───────────────────────────────────────────

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

// ── Epoch (validity_range lower_bound, POSIX ms) ──────────────────
// "now" = cận DƯỚI. Claim ép now < deadline (an toàn: chỉ claim khi CHẮC còn hạn).
// Sweep ép now ≥ deadline (an toàn: chỉ quét khi CHẮC đã hết hạn).

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// Epoch hiện tại (cận dưới) = lower_bound (POSIX ms) / ms_per_epoch.
pub fn get_epoch_lower(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  s / ms_per_epoch
}

/// Epoch (cận TRÊN) = upper_bound (POSIX ms) / ms_per_epoch. Dùng cho Claim:
/// claimer phải CHẮC CHẮN còn trong hạn → ép upper_bound < deadline.
pub fn get_epoch_upper(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(s) = tx.validity_range.upper_bound.bound_type |> get_finite
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

// ── Test-support builders (mock UTxO/tx) ──────────────────────────

pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

/// Cùng script hash, khác stake cred → address khác (test double-satisfaction).
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
  Output {
    address: addr,
    value: value,
    datum: InlineDatum(datum),
    reference_script: None,
  }
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
