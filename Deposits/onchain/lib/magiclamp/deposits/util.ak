// Deposits shared helpers — tái dùng phong cách Treasury/Distribution util.ak.
// Trọng tâm: đếm/tìm UTxO theo PAYMENT SCRIPT HASH (chống double-satisfaction qua
// stake credential — bài học audit C1/C2/M1 Distribution), KHÔNG so full Address.

use aiken/collection/list
use aiken/interval.{Finite, IntervalBound, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey, Credential}
use cardano/assets.{Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference, Transaction}

/// Address của chính UTxO đang spend.
pub fn own_address(own_ref: OutputReference, inputs: List<Input>) -> Address {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output.address
}

// ── Epoch từ validity range (v2 — escheat + đọc beacon stale, mẫu ConsumeMAGIC) ──

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// current_epoch = lower_bound(validity_range) / ms_per_epoch. Tx PHẢI có
/// lower bound hữu hạn (caller đặt validity_range) → không giả epoch.
pub fn get_epoch(tx: Transaction, ms_per_epoch: Int) -> Int {
  let IntervalBound { bound_type, .. } = tx.validity_range.lower_bound
  expect Some(s) = get_finite(bound_type)
  s / ms_per_epoch
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

/// payment credential là VerificationKey (= ví thường)?
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

// ── Người nhận refund (tổng-khớp per asset, chống double-satisfaction) ──
// KHÔNG dùng "tồn tại MỘT output ≥ amount": gộp Σ output value(asset) tới address.

/// Tổng value(asset) của mọi output GỬI tới VerificationKey(pkh) — ví thường depositor.
pub fn output_sum_to_pkh(
  outputs : List<Output>,
  pkh     : ByteArray,
  policy  : ByteArray,
  name    : ByteArray,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      when o.address.payment_credential is {
        VerificationKey(h) ->
          if h == pkh {
            acc + assets.quantity_of(o.value, policy, name)
          } else {
            acc
          }
        _ -> acc
      }
    },
  )
}

/// Tổng value(asset) của mọi output GỬI tới 1 Credential bất kỳ (VK hoặc Script).
/// Dùng cho ESCHEAT: tiền ÉP về treasury_credential (Treasury có thể là Script).
pub fn output_sum_to_credential(
  outputs : List<Output>,
  cred    : Credential,
  policy  : ByteArray,
  name    : ByteArray,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address.payment_credential == cred {
        acc + assets.quantity_of(o.value, policy, name)
      } else {
        acc
      }
    },
  )
}

// ── Beacon DepositParam reader (v2 — reference input mang NFT xác thực) ──
// CIP-31: đọc datum từ reference input, KHÔNG tiêu beacon. Xác thực = NFT one-shot
// (đúng 1 token policy/name) → không UTxO giả nào mạo danh bảng phí governance.

/// Đọc datum `T` từ reference input tại `ref`, mang ĐÚNG 1 NFT (policy,name) VÀ ở
/// ĐÚNG địa chỉ Script(script_hash) — F3.
/// Fail nếu: không tìm thấy ref / NFT ≠ 1 / SAI địa chỉ beacon / datum không inline.
/// F3: chỉ NFT-qty==1 KHÔNG đủ — kẻ tấn công có thể gửi NFT tới UTxO địa chỉ tùy ý
/// (ví thường / script khác) mang datum giả định giá cọc = 0. ÉP địa chỉ == validator
/// deposit_param khóa beacon về đúng nguồn governance.
pub fn read_beacon_datum(
  ref_inputs  : List<Input>,
  ref         : OutputReference,
  nft_policy  : ByteArray,
  nft_name    : ByteArray,
  script_hash : ByteArray,
) -> Data {
  expect Some(beacon) =
    list.find(ref_inputs, fn(i) { i.output_reference == ref })
  expect is_at_script(beacon.output.address, script_hash)
  expect assets.quantity_of(beacon.output.value, nft_policy, nft_name) == 1
  expect InlineDatum(d) = beacon.output.datum
  d
}

// ── Authority (C-REF-4) ──

/// pkh có nằm trong extra_signatories?
pub fn signed_by(signatories: List<ByteArray>, pkh: ByteArray) -> Bool {
  list.has(signatories, pkh)
}

/// Có input HOẶC reference_input tại payment = Script(hash)? (chứng kiến validator lifecycle).
pub fn witnessed_by_script(
  inputs           : List<Input>,
  reference_inputs : List<Input>,
  script_hash      : ByteArray,
) -> Bool {
  list.any(inputs, fn(i) { is_at_script(i.output.address, script_hash) }) || list.any(
    reference_inputs,
    fn(i) { is_at_script(i.output.address, script_hash) },
  )
}

/// lifecycle_authority thỏa: VK → ký; Script → chứng kiến input/ref-input.
pub fn authority_ok(
  authority        : Credential,
  signatories      : List<ByteArray>,
  inputs           : List<Input>,
  reference_inputs : List<Input>,
) -> Bool {
  when authority is {
    VerificationKey(pkh) -> signed_by(signatories, pkh)
    Script(hash) -> witnessed_by_script(inputs, reference_inputs, hash)
  }
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

pub fn mk_ref_id(id: ByteArray, ix: Int) -> OutputReference {
  OutputReference { transaction_id: id, output_index: ix }
}
