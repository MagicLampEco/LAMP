// Genesis util — đếm/tìm UTxO theo PAYMENT SCRIPT HASH (chống double-satisfaction qua
// stake credential — bài học audit Distribution/Treasury). Mirror Treasury util.ak.

use aiken/collection/list
use cardano/address.{Address, Script, VerificationKey}
use cardano/transaction.{Output}

pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

pub fn is_vk(addr: Address) -> Bool {
  when addr.payment_credential is {
    VerificationKey(_) -> True
    _ -> False
  }
}

pub fn count_outputs_at_script(outputs: List<Output>, script_hash: ByteArray) -> Int {
  list.count(outputs, fn(x) { is_at_script(x.address, script_hash) })
}

pub fn output_at_script(outputs: List<Output>, script_hash: ByteArray) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { is_at_script(x.address, script_hash) })
  o
}
