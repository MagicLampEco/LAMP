// LampDistribution shared validator helpers (SPEC §6 invariants).

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference, Transaction}
use magiclamp/lampdist/types.{BeaconKind, DropParam}

/// Epoch từ validity_range lower_bound (POSIX ms). ms_per_epoch network-specific.
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

/// Address của chính UTxO đang spend.
pub fn own_address(own_ref: OutputReference, inputs: List<Input>) -> Address {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output.address
}

/// Đếm input tại 1 address (chống double-satisfaction).
pub fn count_inputs_at(inputs: List<Input>, addr: Address) -> Int {
  list.count(inputs, fn(x) { x.output.address == addr })
}

pub fn count_outputs_at(outputs: List<Output>, addr: Address) -> Int {
  list.count(outputs, fn(x) { x.address == addr })
}

pub fn output_at(outputs: List<Output>, addr: Address) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { x.address == addr })
  o
}

pub fn input_at(inputs: List<Input>, addr: Address) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { x.output.address == addr })
  i.output
}

// ── Đếm/tìm theo PAYMENT CREDENTIAL (script hash) — CHỐNG double-satisfaction
// qua stake credential (audit C1/C2). Full-address equality KHÔNG đủ vì cùng
// script hash + khác stake cred = address khác nhưng đều là UTxO của script.

/// Script hash của chính validator đang chạy.
pub fn own_script_hash(own_addr: Address) -> ByteArray {
  expect Script(h) = own_addr.payment_credential
  h
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

/// Committee M-of-N đã ký đủ chưa (Byzantine). THAY `count_committee_sigs` cũ —
/// hàm đó trả Int nên ngưỡng phải kiểm ở call site, và không ai kiểm.
///
/// Hai lỗ nó bỏ (issue #21 B1):
///   • `list.count(committee, …)` đếm **phần tử danh sách**, không đếm **người**.
///     Committee bake nhầm `[c1, c1, c2]` threshold 2 → riêng c1 ký là đủ.
///   • `threshold` không chặn cận: `threshold ≤ 0` thì 0 chữ ký cũng qua.
///
/// Cả hai là lỗi lúc DEPLOY (committee/threshold là param validator, không phải
/// datum) — không ai bên ngoài bịa được. Vẫn ép on-chain thay vì trông vào script
/// deploy: script deploy sửa được sau, param đã bake thì không.
/// Mẫu gốc: `Genesis/onchain/lib/magiclamp/genesis/registry.ak:96-101`.
pub fn committee_approved(
  committee   : List<ByteArray>,
  threshold   : Int,
  signatories : List<ByteArray>,
) -> Bool {
  // chặn ExUnit DoS + bound chi phí list.unique (O(n²)).
  expect list.length(committee) <= 16
  let uniq = list.unique(committee)
  and {
    threshold >= 1,
    threshold <= list.length(uniq),
    list.count(uniq, fn(k) { list.has(signatories, k) }) >= threshold,
  }
}

/// payment credential của address có phải VerificationKey(pkh) không.
pub fn is_owned_by(addr: Address, pkh: ByteArray) -> Bool {
  when addr.payment_credential is {
    VerificationKey(h) -> h == pkh
    _ -> False
  }
}

/// payment credential của address có phải Script(hash) không.
pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

/// Tổng LAMP (oildrop) các output trả về cho owner PKH.
pub fn lamp_to_owner(
  outputs    : List<Output>,
  owner      : ByteArray,
  lamp_policy: PolicyId,
  lamp_name  : AssetName,
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

/// Asset name của beacon NFT theo kind (authenticity token).
pub fn beacon_name(kind: BeaconKind) -> AssetName {
  when kind is {
    DropParam -> #"44524f50"  // "DROP"
  }
}

/// Asset name treasury authenticity NFT — singleton sổ cái solvency.
/// "TRSY". claim_account đọc treasury (cum_entitlement) qua NFT này → chống treasury giả.
pub fn treasury_nft_name() -> AssetName {
  #"54525359"  // "TRSY"
}

// ── Tests cho helper thuần ────────────────────────────────────

test committee_sig_count() {
  committee_approved([#"a1", #"b2", #"c3"], 2, [#"a1", #"c3", #"ff"])
}

test committee_sig_none() {
  !committee_approved([#"a1", #"b2"], 1, [#"ff"])
}

/// B1 (issue #21) — committee trùng khoá KHÔNG được phá ngưỡng.
/// `[c1, c1, c2]` threshold 2: chỉ c1 ký thì bản cũ `list.count` ra 2 ⇒ pass.
/// Ở module này nó gác cả `treasury.ak:122,192` (đường thả LAMP).
test committee_dup_key_cannot_meet_threshold() {
  !committee_approved([#"c1", #"c1", #"c2"], 2, [#"c1"])
}

/// Cùng committee đó, ĐỦ hai người thật thì vẫn phải qua.
test committee_dup_key_two_real_signers_pass() {
  committee_approved([#"c1", #"c1", #"c2"], 2, [#"c1", #"c2"])
}

/// B1 — threshold ≤ 0 thì KHÔNG chữ ký nào cũng qua ở bản cũ.
test committee_threshold_zero_rejected() {
  !committee_approved([#"c1", #"c2", #"c3"], 0, [])
}

/// threshold vượt số NGƯỜI thật (sau dedupe) = khoá chết, chặn ngay lúc kiểm.
test committee_threshold_above_unique_rejected() {
  !committee_approved([#"c1", #"c1"], 2, [#"c1"])
}

test beacon_name_dropparam() {
  beacon_name(DropParam) == #"44524f50"
}

// ── Test-support builders (mock UTxO/tx) cho validator tests ──

/// Address của script (stake cred None).
pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

/// Address của script với stake credential (để test double-satisfaction).
pub fn script_address_staked(hash: ByteArray, stake_pkh: ByteArray) -> Address {
  Address {
    payment_credential: Script(hash),
    stake_credential: Some(Inline(VerificationKey(stake_pkh))),
  }
}

/// Address ví thường (VerificationKey).
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

// AUDIT C1 — chứng minh fix double-satisfaction qua stake credential.
// 2 UTxO cùng script hash, KHÁC stake credential → 2 Address khác nhau.
// count theo full-address: mỗi addr chỉ thấy 1 → KHÔNG phát hiện (lỗ hổng cũ).
// count theo script-hash: thấy CẢ 2 → phát hiện double (fix mới).
fn mk_input_at(addr: Address) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"00", output_index: 0 },
    output: Output {
      address: addr,
      value: assets.zero,
      datum: NoDatum,
      reference_script: None,
    },
  }
}

test script_count_catches_stake_cred_double() {
  let sh = #"deadbeef"
  let addr_a = Address { payment_credential: Script(sh), stake_credential: None }
  let addr_b =
    Address {
      payment_credential: Script(sh),
      stake_credential: Some(Inline(VerificationKey(#"aa"))),
    }
  let inputs = [mk_input_at(addr_a), mk_input_at(addr_b)]
  // full-address: chỉ đếm 1 cho addr_a → BỎ SÓT double (chứng minh lỗ hổng cũ)
  let by_addr = count_inputs_at(inputs, addr_a)
  // script-hash: đếm cả 2 → CHẶN double (fix C1)
  let by_script = count_inputs_at_script(inputs, sh)
  by_addr == 1 && by_script == 2
}
