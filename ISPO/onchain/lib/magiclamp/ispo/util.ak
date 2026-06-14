// ISPO shared helpers — double-satisfaction guards theo SCRIPT HASH + NFT-beacon
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
// now > end_epoch → cận dưới khiến chỉ quét được khi CHẮC CHẮN đã hết ISPO.

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

/// LAMP (oil) tới owner (VerificationKey(pkh)) — cộng dồn mọi output của owner.
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

/// LAMP (oil) tới Treasury (Script(treasury_dest)) — cộng dồn.
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

/// Đếm chữ ký committee/admin có mặt trong extra_signatories.
pub fn count_committee_sigs(
  committee: List<ByteArray>,
  sigs: List<ByteArray>,
) -> Int {
  list.count(committee, fn(c) { list.has(sigs, c) })
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
