// Reserve shared helpers + test-support builders. Mirror tối thiểu của Genesis util.ak
// (Reserve module độc lập — không import chéo branch Genesis).

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction}

/// current_epoch từ validity_range lower bound (POSIX ms) / ms_per_epoch.
pub fn get_epoch(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  s / ms_per_epoch
}

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// Lượng tLAMP mint trong tx (oil) = Δ.
pub fn minted_qty(mint: Value, policy: PolicyId, name: AssetName) -> Int {
  assets.quantity_of(mint, policy, name)
}

/// Đếm OUTPUT mang đúng 1 thread NFT.
pub fn count_holding_nft(outputs: List<Output>, policy: PolicyId, name: AssetName) -> Int {
  list.count(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
}

/// Đếm INPUT mang đúng 1 thread NFT.
pub fn count_inputs_holding_nft(inputs: List<Input>, policy: PolicyId, name: AssetName) -> Int {
  list.count(inputs, fn(i) { assets.quantity_of(i.output.value, policy, name) == 1 })
}

/// Output DUY NHẤT mang thread NFT (gọi sau khi expect count == 1).
pub fn output_holding_nft(outputs: List<Output>, policy: PolicyId, name: AssetName) -> Output {
  expect Some(o) = list.find(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
  o
}

/// Input DUY NHẤT mang thread NFT.
pub fn input_holding_nft(inputs: List<Input>, policy: PolicyId, name: AssetName) -> Output {
  expect Some(i) = list.find(inputs, fn(i) { assets.quantity_of(i.output.value, policy, name) == 1 })
  i.output
}

/// Tìm reference input mang đúng 1 NFT policy (beacon authenticity). None nếu không có.
pub fn find_ref_holding_nft(
  ref_inputs: List<Input>,
  policy: PolicyId,
) -> Option<Output> {
  list.find(ref_inputs, fn(i) { has_policy(i.output.value, policy) })
    |> option_map_output
}

fn option_map_output(o: Option<Input>) -> Option<Output> {
  when o is {
    Some(i) -> Some(i.output)
    None -> None
  }
}

/// value có ≥1 token của policy (qty>0 bất kỳ name).
pub fn has_policy(v: Value, policy: PolicyId) -> Bool {
  list.has(assets.policies(v), policy)
}

/// InlineDatum → Data.
pub fn inline_datum(o: Output) -> Data {
  expect InlineDatum(d) = o.datum
  d
}

/// value chỉ gồm lovelace + ĐÚNG 1 thread NFT (policy + name, qty == 1) (D3 — output sạch).
/// Siết: kiểm cả asset NAME đúng và qty == 1 (chống nhồi name khác cùng policy NFT,
/// hoặc qty>1). Thread NFT one-shot làm name-giả khó xảy ra, nhưng ép ở đây cho chặt.
pub fn value_only_nft_and_ada(v: Value, nft_policy: PolicyId, nft_name: AssetName) -> Bool {
  let pols = assets.policies(v)
  list.length(pols) == 2 && list.has(pols, nft_policy) && assets.quantity_of(
    v,
    nft_policy,
    nft_name,
  ) == 1
}

// ── Test-support builders ────────────────────────────────────────────────

pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
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

test has_policy_true() {
  let v = assets.from_lovelace(2_000_000) |> assets.add(#"aa", #"01", 1)
  has_policy(v, #"aa")
}

test has_policy_false() {
  has_policy(assets.from_lovelace(2_000_000), #"aa") == False
}
