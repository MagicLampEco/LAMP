// Airdrop shared helpers — NFT-beacon authenticity + double-satisfaction guards
// theo SCRIPT HASH (không full-address). Mượn mẫu Faucet/util.ak + Allocation/util.ak.

use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction}
use magiclamp/airdrop/ledger.{AirdropPool}

// ── Own-UTxO resolution ───────────────────────────────────────────

/// Address của chính UTxO đang spend (resolve own_ref trong inputs).
pub fn own_address(own_ref: OutputReference, inputs: List<Input>) -> Address {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output.address
}

/// Output (đầy đủ value/datum) của chính UTxO đang spend (resolve own_ref).
pub fn own_output(own_ref: OutputReference, inputs: List<Input>) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output
}

/// Tên (AssetName) của ĐÚNG 1 token thuộc `policy` trong value. Dùng cho claim-slot
/// UTxO: slot mang đúng 1 NFT (policy, leaf, qty 1) → trả `leaf`. Ép qty == 1 +
/// đúng 1 name (chống slot rác mang nhiều/0 token policy → marker không xác định).
pub fn sole_policy_name(value: Value, policy: PolicyId) -> AssetName {
  let toks = assets.tokens(value, policy)
  expect dict.size(toks) == 1
  expect [name] = dict.keys(toks)
  expect assets.quantity_of(value, policy, name) == 1
  name
}

/// Script hash của address đang chạy.
pub fn own_script_hash(own_addr: Address) -> ByteArray {
  expect Script(h) = own_addr.payment_credential
  h
}

/// 28-byte payment credential-hash của address (VerificationKey(h) | Script(h) → h).
/// Dùng dựng owner[28] của leaf schema C (Delegator = payment key-hash). Cả hai
/// biến thể credential đều là blake2b_224 hash 28 byte → trích trực tiếp.
pub fn payment_credential_hash(addr: Address) -> ByteArray {
  when addr.payment_credential is {
    VerificationKey(h) -> h
    Script(h) -> h
  }
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

// ── Đọc trạng thái claim của POOL (cho mint policy gate slot) ──────
// Mint policy KHÔNG có own datum của pool → phải tự định vị UTxO mang POOL NFT
// trong tập output (genesis: pool vừa tạo) hoặc input/reference_input (continuation:
// pool đã tồn tại) rồi giải mã inline datum lấy claimed_count. Đây là KHOÁ trustless
// phía CLAIMER: khi claimed_count > 0 (đã có ≥1 claim) thì cấm đúc slot → slot đã burn
// KHÔNG BAO GIỜ tái sinh, dù kẻ tấn công cầm authority token.

/// claimed_count của AirdropPool mang trong inline datum của 1 output (POOL NFT).
/// fail nếu không phải inline datum hoặc decode sai → an toàn (mặc định reject).
pub fn output_claimed_count(out: Output) -> Int {
  expect InlineDatum(d) = out.datum
  expect pool: AirdropPool = d
  pool.claimed_count
}

/// Tìm Output mang POOL NFT trong inputs HOẶC reference_inputs (continuation: pool
/// đã tồn tại, mint policy tham chiếu nó qua input thường hoặc reference input).
/// fail nếu không tìm thấy → an toàn (continuation buộc phải tham chiếu pool).
pub fn pool_from_inputs_or_refs(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  let all = list.concat(inputs, reference_inputs)
  expect Some(i) = list.find(all, fn(x) { has_nft(x.output, policy, name) })
  i.output
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
