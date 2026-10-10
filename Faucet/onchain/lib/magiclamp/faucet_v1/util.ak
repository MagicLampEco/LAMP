// Faucet v1 helpers — BẢN ĐÓNG BĂNG cho validator `faucet_v1.ak`.
//
// Vì sao không dùng chung `magiclamp/faucet/util` (của v3): script hash của faucet v1 là mã đã
// biên dịch của MỌI hàm nó gọi. Dùng chung thì một lần v3 sửa `own_address`/`is_at_script`
// sẽ đổi hash v1 trong im lặng ⇒ địa chỉ pool đã nạp tiền thành địa chỉ khác. Tách module để
// hash v1 chỉ đổi khi chính tệp này đổi.
//
// Nguồn: `git show 3d00a6a^:Faucet/onchain/lib/magiclamp/faucet/util.ak`, chỉ giữ các hàm
// v1 gọi (bỏ epoch + NFT-beacon + is_owned_by — v1 không dùng). Thân hàm giữ NGUYÊN văn.
//
// Double-satisfaction guards theo SCRIPT HASH (không full-address) như Distribution/util.ak.
// Cùng script hash + khác stake cred = address khác nhưng đều là UTxO của script → phải đếm
// theo hash.

use aiken/collection/list
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference}

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
