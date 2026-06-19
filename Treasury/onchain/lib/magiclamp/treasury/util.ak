// Treasury shared helpers — tái dùng phong cách Distribution/onchain/util.ak.
// Trọng tâm: đếm/tìm UTxO theo PAYMENT SCRIPT HASH (chống double-satisfaction
// qua stake credential — bài học audit C1/C2/M1 Distribution), KHÔNG so full Address.

use aiken/collection/list
use aiken/interval.{Finite, IntervalBound, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction}

/// Address của chính UTxO đang spend.
pub fn own_address(own_ref: OutputReference, inputs: List<Input>) -> Address {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output.address
}

/// Script hash của chính validator đang chạy.
pub fn own_script_hash(own_addr: Address) -> ByteArray {
  expect Script(h) = own_addr.payment_credential
  h
}

/// payment credential của address có phải Script(hash) không.
pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

/// payment credential của address có phải VerificationKey(pkh) không (= ví thường).
pub fn is_vk(addr: Address) -> Bool {
  when addr.payment_credential is {
    VerificationKey(_) -> True
    _ -> False
  }
}

// ── Đếm/tìm theo SCRIPT HASH (chống double-satisfaction) ──

pub fn count_inputs_at_script(inputs: List<Input>, script_hash: ByteArray) -> Int {
  list.count(inputs, fn(x) { is_at_script(x.output.address, script_hash) })
}

pub fn count_outputs_at_script(outputs: List<Output>, script_hash: ByteArray) -> Int {
  list.count(outputs, fn(x) { is_at_script(x.address, script_hash) })
}

pub fn input_at_script(inputs: List<Input>, script_hash: ByteArray) -> Output {
  expect Some(i) =
    list.find(inputs, fn(x) { is_at_script(x.output.address, script_hash) })
  i.output
}

pub fn output_at_script(outputs: List<Output>, script_hash: ByteArray) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { is_at_script(x.address, script_hash) })
  o
}

// ── Tìm output mang 1 token (policy,name) — seed self-ref NFT (custody_seed) ──
// Genesis chọn output custody bằng CHÍNH NFT vừa mint (không cần custody_hash trong
// param → phá vòng phụ thuộc seed↔custody). NFT bất khả phân (qty 1) ⇒ nằm trong
// đúng 1 output.

pub fn count_outputs_with_token(
  outputs : List<Output>,
  policy  : ByteArray,
  name    : ByteArray,
) -> Int {
  list.count(outputs, fn(o) { assets.quantity_of(o.value, policy, name) >= 1 })
}

pub fn output_with_token(
  outputs : List<Output>,
  policy  : ByteArray,
  name    : ByteArray,
) -> Output {
  expect Some(o) =
    list.find(outputs, fn(o) { assets.quantity_of(o.value, policy, name) >= 1 })
  o
}

// ── Epoch từ validity_range (time-lock C-REL-8 — mirror Distribution util.get_epoch) ──
// Ledger ép validity_range; lower_bound Finite(posix_ms) chia ms_per_epoch ⇒ epoch
// hiện tại tin cậy (không cần oracle). Release dùng để so execute_after_epoch.

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

pub fn get_epoch(tx: Transaction, ms_per_epoch: Int) -> Int {
  let IntervalBound { bound_type, .. } = tx.validity_range.lower_bound
  expect Some(s) = get_finite(bound_type)
  s / ms_per_epoch
}

/// F4: epoch CÓ CHẶN — ép validity_range nằm GỌN trong 1 epoch (lower & upper hữu hạn,
/// cùng epoch). Chống "đóng băng" epoch field: nếu range trải nhiều epoch, kẻ đặt lower
/// ở epoch cũ rồi submit muộn → epoch sổ tụt hậu thời gian thật. Ép upper hữu hạn + cùng
/// epoch ⇒ tx chỉ hợp lệ TRONG đúng epoch đó ⇒ get_epoch == epoch submit thật (audit thật).
pub fn get_epoch_bounded(tx: Transaction, ms_per_epoch: Int) -> Int {
  let IntervalBound { bound_type: lo, .. } = tx.validity_range.lower_bound
  let IntervalBound { bound_type: hi, .. } = tx.validity_range.upper_bound
  expect Some(lo_ms) = get_finite(lo)
  expect Some(hi_ms) = get_finite(hi)
  let e = lo_ms / ms_per_epoch
  // upper PHẢI cùng epoch với lower (range không trải qua biên epoch).
  expect hi_ms / ms_per_epoch == e
  e
}

// ── Test-support builders (mock UTxO/tx) ──

pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

/// Address script với stake credential (test double-satisfaction qua stake cred).
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
