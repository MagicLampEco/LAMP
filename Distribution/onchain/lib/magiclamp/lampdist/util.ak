// LampDistribution shared validator helpers (SPEC §6 invariants).

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference, Transaction}
use magiclamp/lampdist/types.{BeaconDatum, BeaconKind, DropParam}

/// Epoch từ validity_range lower_bound (POSIX ms). ms_per_epoch network-specific.
///
/// ⚠ ĐẠI LƯỢNG NÀY CHỈ CHẶN ĐƯỢC MỘT CHIỀU. Sổ cái nhận tx khi `lower ≤ now ≤ upper`,
/// nên `lower` đặt LÙI bao xa cũng hợp lệ — người dựng tx tự chọn được một epoch NHỎ
/// hơn epoch thật. Dùng hàm này ở chỗ mà epoch nhỏ đi thì người dựng THIỆT (nhánh
/// `Redeem`: epoch nhỏ ⇒ `elapsed` nhỏ ⇒ vested nhỏ). Ở chỗ mà epoch nhỏ đi thì người
/// dựng LỢI — mọi chỗ GHI `start_epoch`, và mọi chỗ dán nhãn thời điểm — phải dùng
/// `get_epoch_strict` bên dưới.
pub fn get_epoch(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  s / ms_per_epoch
}

/// Epoch CHỨNG MINH ĐƯỢC — "Luật 2b": ép CẢ HAI đầu validity range rơi cùng một epoch,
/// rồi trả epoch đó. Đây là đại lượng duy nhất trong tx mà người dựng không nói dối được.
///
/// Vì sao phải có cả hai đầu, mỗi đầu chặn một chiều:
///   `now ≥ lower` ⇒ `get_epoch(lower) ≤ epoch thật`  — chặn đặt nhãn ở TƯƠNG LAI
///   `now ≤ upper` ⇒ `get_epoch(upper) ≥ epoch thật`  — chặn đặt nhãn ở QUÁ KHỨ
/// Ép hai epoch đó BẰNG NHAU ⟹ giá trị trả về kẹp đúng epoch thật từ hai phía.
///
/// Đầu vô hạn (`PositiveInfinity`/`NegativeInfinity`) làm `get_finite` trả `None` và
/// `expect` ném — đúng chiều fail-closed: một tx không tự khai nổi khoảng thời gian của
/// nó thì không được phép đóng dấu thời gian lên bất cứ thứ gì.
///
/// Khuôn này KHÔNG mới trong kho: `reserve_draw` bên Genesis đã ép đúng nó (xem
/// `Genesis/scripts/_reserve_layer2.ts`, hàm `drawWindow` — chú thích "Luật 2b"), và
/// bên dựng tx ở đó kéo `hi` về sát cuối epoch khi cửa sổ mặc định vắt qua biên.
pub fn get_epoch_strict(tx: Transaction, ms_per_epoch: Int) -> Int {
  expect Some(lo) = tx.validity_range.lower_bound.bound_type |> get_finite
  expect Some(hi) = tx.validity_range.upper_bound.bound_type |> get_finite
  let e = lo / ms_per_epoch
  expect hi / ms_per_epoch == e
  e
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
/// hàm đó trả Int nên ngưỡng phải kiểm ở call site: mọi call site ĐỀU kiểm
/// (`expect count_committee_sigs(…) >= threshold`), nhưng phép kiểm rời rạc đó
/// không nói gì về hai lỗ dưới, và mỗi call site mới là một cơ hội quên.
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
  let uniq = list.unique(committee)
  and {
    // Bound chi phí list.unique (O(n²)). KHÔNG phải chống DoS: `committee` là param
    // compile-time của validator, ngoài không bơm dài được. Là điều kiện chứ không
    // `expect` — hàm phải TỔNG, trả False, không abort (xem did_stub.ak: signature
    // `-> Bool` là hợp đồng cho verifier PhoenixKey thật sau này).
    list.length(committee) <= 16,
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
  // `BeaconKind` hiện chỉ có MỘT hằng tử, nên `when` một nhánh là thừa (aiken cảnh báo).
  // `let` giữ nguyên tính vét cạn: thêm một hằng tử mới vào `BeaconKind` thì dòng này đỏ
  // ngay, đúng chỗ phải quyết tên tài sản cho hằng tử đó.
  let DropParam = kind
  #"44524f50"  // "DROP"
}

/// Đọc trọn `BeaconDatum` từ reference input mang beacon NFT (kind = DropParam).
/// Authenticity qua NFT → chống datum hijacking (beacon giả ở cùng address).
///
/// ⚠ v3 TRẢ TRỌN BỘ, không trả một trường. v2 có `find_drop_value` trả đúng `drop_value` và
/// **cố ý bỏ qua** `epoch`. Ở v3 `epoch` ĐI VÀO phép tính — `A(t) = index + rate_root·(t −
/// epoch)` — nên một hiện thực quên nó sẽ tính `A_now` bằng `index` trần và chỉ số ĐỨNG YÊN
/// MÃI: mọi tài khoản mở sau lượt post gần nhất có `A_span = 0` và không bao giờ rút được.
///
/// Hai bên gọi (`claim_account` ▸ Redeem để tính `A_now`, `treasury` ▸ GrantEntitlement để
/// ghim `index_at_start`) dùng CHUNG hàm này: hai đường đọc cùng một sự thật thì phải đi qua
/// cùng một mệnh đề xác thực, nếu không chúng trôi độc lập.
pub fn find_beacon(
  ref_inputs        : List<Input>,
  beacon_nft_policy : ByteArray,
) -> BeaconDatum {
  let drop_name = beacon_name(DropParam)
  expect Some(ri) =
    list.find(
      ref_inputs,
      fn(i) { assets.quantity_of(i.output.value, beacon_nft_policy, drop_name) == 1 },
    )
  expect InlineDatum(d) = ri.output.datum
  expect bd: BeaconDatum = d
  expect bd.kind == DropParam
  bd
}

/// `A(window) = index + rate_root · (window − epoch)` — dạng ĐÓNG của chỉ số cộng dồn.
///
/// Không đòi ai post gì: giữa hai lượt post chỉ số tự chạy tiếp ở `rate_root` đã post lần
/// cuối. Đó là lý do committee im lặng KHÔNG đóng băng vesting (`Math-Spec.md` v3 §2 HQ 1.1).
///
/// `window < bd.epoch` nằm NGOÀI miền của công thức (beacon gần nhất phải có `epoch ≤ t`).
/// Nó chỉ xảy ra khi người dựng tx tự dán một nhãn cửa sổ lùi về trước lượt post gần nhất —
/// và khi đó giá trị trả về NHỎ đi, tức chính họ thiệt. Không chặn riêng ở đây vì chốt
/// `A_span ≥ 0` bên gọi đã fail-closed cho mọi ca đi quá xa.
pub fn beacon_index_at(bd: BeaconDatum, window: Int) -> Int {
  bd.index + bd.rate_root * ( window - bd.epoch )
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

/// Cap 16: quá cap trả **False**, KHÔNG abort. Đây là điều đang được khoá lại —
/// `expect` ở đây làm hàm thành riêng phần, phá hợp đồng `-> Bool` mà `did_stub`
/// hứa giữ cho verifier PhoenixKey thật. 16 người vẫn phải qua (cận trên đúng bằng 16).
test committee_over_cap_returns_false_not_abort() {
  let over =
    [
      #"01", #"02", #"03", #"04", #"05", #"06", #"07", #"08", #"09", #"0a",
      #"0b", #"0c", #"0d", #"0e", #"0f", #"10", #"11",
    ]
  !committee_approved(over, 1, [#"01"])
}

test committee_exactly_16_still_passes() {
  let at_cap =
    [
      #"01", #"02", #"03", #"04", #"05", #"06", #"07", #"08", #"09", #"0a",
      #"0b", #"0c", #"0d", #"0e", #"0f", #"10",
    ]
  committee_approved(at_cap, 2, [#"01", #"10"])
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
