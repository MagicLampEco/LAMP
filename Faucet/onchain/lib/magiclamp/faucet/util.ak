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

// ── Epoch (validity_range, POSIX ms) ──────────────────────────────
// HAI hàm, KHÔNG thay thế cho nhau. Chọn sai hàm là một lỗ, không phải một
// chi tiết phong cách:
//
//   get_epoch        — chỉ đọc cận DƯỚI. Cận dưới do người dựng tx đặt và ledger
//                      chỉ đòi `lower_bound ≤ slot hiện tại` ⇒ giá trị trả về
//                      LUÔN ≤ bucket thật, đặt nhỏ tuỳ ý. Chỉ dùng được cho chốt
//                      mà "nói nhỏ hơn thật" là bất lợi cho chính người dựng tx
//                      (ReclaimIdle: lùi thời gian thì tự mình không thu hồi được).
//   get_epoch_pinned — neo vào thời gian THẬT. Ép cả hai cận hữu hạn và cùng một
//                      bucket ⇒ slot hiện tại ∈ [lo, hi] ⊂ bucket ⇒ giá trị trả
//                      về là bucket THẬT. Mọi chốt tốc độ, cooldown, mọi lần ghi
//                      `last_*` và datum khởi tạo đều PHẢI dùng hàm này.
//
// Vì sao phải viết ra: chốt cooldown và chốt trần-tốc-độ NGƯỢC DẤU nhau.
// Cooldown cần "không nói now lớn hơn thật"; `window_epoch` cần "không nói now
// NHỎ hơn thật". Cận dưới chỉ trả lời vế đầu, và dùng chung một hàm cho cả hai
// là cách trần tốc độ bị leo thang theo bậc thang mà mọi ca kiểm vẫn xanh.

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// Bucket suy từ cận DƯỚI. ĐỌC CHÚ THÍCH TRÊN trước khi dùng.
pub fn get_epoch(tx: Transaction, ms_per_epoch: Int, window_origin_ms: Int) -> Int {
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  // WIN-ORIGIN-1 (Specs/Window/CONTRACT.md v1.0).
  ( s - window_origin_ms ) / ms_per_epoch
}

/// Bucket của tx, ĐƯỢC NEO VÀO THỜI GIAN THẬT: cả hai cận hữu hạn và cùng bucket.
/// Nghĩa vụ off-chain đi kèm: builder đặt `lo = now_ms`,
/// `hi = min(now_ms + ttl, o + ((lo − o) / ms_per_epoch + 1) × ms_per_epoch − 1)` với
/// `o = window_origin_ms` (WIN-ORIGIN-2); nếu phần
/// còn lại của bucket ngắn hơn ttl tối thiểu thì CHỜ sang bucket sau, không nới `hi`.
pub fn get_epoch_pinned(
  tx: Transaction,
  ms_per_epoch: Int,
  window_origin_ms: Int,
) -> Int {
  expect Some(lo) = tx.validity_range.lower_bound.bound_type |> get_finite
  expect Some(hi) = tx.validity_range.upper_bound.bound_type |> get_finite
  let e = ( lo - window_origin_ms ) / ms_per_epoch
  expect ( hi - window_origin_ms ) / ms_per_epoch == e
  e
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

/// Địa chỉ enterprise (KHÔNG stake credential) của một script hash. Dùng trong
/// mã sản xuất để so ĐỊA CHỈ ĐẦY ĐỦ: `count/output_at_script` chỉ so payment
/// credential nên stake credential là trường tự do nếu không ghim.
pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

// ── Test-support builders (mock UTxO/tx) ──────────────────────────

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

/// Output CÓ đính reference script — chỉ dùng cho ca kiểm cổng cấm script-carrier.
/// `mk_output`/`mk_output_no_datum` luôn đặt `reference_script: None`, nên mọi ca
/// dựng bằng chúng KHÔNG phân biệt được hai bên của cổng đó (cổng không được kiểm).
pub fn mk_output_with_ref_script(
  addr: Address,
  value: Value,
  datum: Data,
  script_hash: ByteArray,
) -> Output {
  Output {
    address: addr,
    value: value,
    datum: InlineDatum(datum),
    reference_script: Some(script_hash),
  }
}

pub fn mk_input(ref: OutputReference, out: Output) -> Input {
  Input { output_reference: ref, output: out }
}

pub fn mk_ref(ix: Int) -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: ix }
}
