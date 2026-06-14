// LAMP Reserve shared helpers — self-contained (KHÔNG import chéo module Tokenomics/Genesis).
// Tái dùng MẪU helper Tokenomics/util.ak + Genesis/util.ak (epoch, NFT count, mint delta,
// test builders). Giữ nội bộ Reserve để apply-param + audit độc lập.

use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference}

// ── Epoch ────────────────────────────────────────────────────

/// Epoch từ validity_range lower_bound (POSIX ms). ms_per_epoch network-specific (param).
/// Dùng lower_bound: cận DƯỚI bảo thủ — không cho tx "tua tới tương lai" để nhả sớm.
pub fn get_epoch(lower: IntervalBoundType, ms_per_epoch: Int) -> Int {
  expect Some(ms) = get_finite(lower)
  ms / ms_per_epoch
}

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

// ── Mint delta ───────────────────────────────────────────────

/// Lượng (policy, name) mint trong tx (âm = burn). Dùng đo Δ tLAMP route ReserveDraw.
pub fn minted_qty(mint: Value, policy: PolicyId, name: AssetName) -> Int {
  assets.quantity_of(mint, policy, name)
}

/// Số asset name PHÂN BIỆT của 1 policy trong value (ép "đúng 1 name").
/// Dùng cho one-shot reserve thread: chống đúc kèm name lạ cùng policy.
pub fn policy_name_count(v: Value, policy: PolicyId) -> Int {
  dict.size(assets.tokens(v, policy))
}

// ── NFT authenticity (policy + name) ─────────────────────────

/// Đếm input mang NFT (policy, name) qty == 1 (authenticity reserve thread).
pub fn count_inputs_with_nft(
  inputs : List<Input>,
  policy : PolicyId,
  name   : AssetName,
) -> Int {
  list.count(inputs, fn(i) { assets.quantity_of(i.output.value, policy, name) == 1 })
}

/// Đếm output mang NFT (policy, name) qty == 1.
pub fn count_outputs_with_nft(
  outputs : List<Output>,
  policy  : PolicyId,
  name    : AssetName,
) -> Int {
  list.count(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
}

/// Output đầu tiên mang NFT (policy, name). FAIL nếu không có.
pub fn output_with_nft(
  outputs : List<Output>,
  policy  : PolicyId,
  name    : AssetName,
) -> Output {
  expect Some(o) =
    list.find(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
  o
}

// ── Double-satisfaction theo script hash ─────────────────────

pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

/// Script hash của chính validator đang chạy (từ own input address).
pub fn own_script_hash(own_addr: Address) -> ByteArray {
  expect Script(h) = own_addr.payment_credential
  h
}

/// Đếm input nằm ở script_hash (chống double-satisfaction: chỉ 1 ReserveState/tx).
pub fn count_inputs_at_script(inputs: List<Input>, script_hash: ByteArray) -> Int {
  list.count(inputs, fn(x) { is_at_script(x.output.address, script_hash) })
}

// ── Đếm tLAMP tới ĐÚNG dest (chống rò rỉ) ────────────────────

/// Tổng (policy, name) trong các output có payment_credential == dest_cred.
/// dest có thể là Script (Treasury) hoặc VerificationKey (thị trường) — so credential.
pub fn qty_to_credential(
  outputs : List<Output>,
  dest    : Address,
  policy  : PolicyId,
  name    : AssetName,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address.payment_credential == dest.payment_credential {
        acc + assets.quantity_of(o.value, policy, name)
      } else {
        acc
      }
    },
  )
}

// ── Datum đọc inline ─────────────────────────────────────────

pub fn inline_datum(o: Output) -> Data {
  expect InlineDatum(d) = o.datum
  d
}

// ══════════════════════════════════════════════════════════════
// Test-support builders (mock UTxO/tx)
// ══════════════════════════════════════════════════════════════

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
