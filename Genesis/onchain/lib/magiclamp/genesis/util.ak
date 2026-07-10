// LAMP Genesis shared helpers + test-support builders (CONTRACT §3, §5).

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference}

// ── Asset / thread helpers ───────────────────────────────────────────────

/// Lượng tLAMP mint trong tx (oil). Δ trong luật mint.
pub fn minted_qty(mint: Value, policy: PolicyId, name: AssetName) -> Int {
  assets.quantity_of(mint, policy, name)
}

/// Đếm UTxO mang đúng 1 thread NFT (policy,name,qty==1) trong list output.
pub fn count_holding_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.count(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
}

/// Đếm INPUT mang đúng 1 thread NFT.
pub fn count_inputs_holding_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.count(inputs, fn(i) { assets.quantity_of(i.output.value, policy, name) == 1 })
}

/// Output DUY NHẤT mang thread NFT (gọi sau khi đã expect count == 1).
pub fn output_holding_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(o) =
    list.find(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
  o
}

/// Input DUY NHẤT mang thread NFT.
pub fn input_holding_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(i) =
    list.find(inputs, fn(i) { assets.quantity_of(i.output.value, policy, name) == 1 })
  i.output
}

/// Số asset name của 1 policy trong value (để ép "đúng 1 name").
pub fn policy_name_count(v: Value, policy: PolicyId) -> Int {
  dict.size(assets.tokens(v, policy))
}

/// Value chỉ gồm lovelace + đúng 1 policy NFT (không token rác). (D3 — continuing output sạch.)
/// assets.policies(v) gồm cả ada policy (#""), nên hợp lệ ⟺ tập policy == {ada, nft_policy}.
pub fn value_only_nft_and_ada(v: Value, nft_policy: PolicyId) -> Bool {
  let pols = assets.policies(v)
  list.length(pols) == 2 && list.has(pols, nft_policy)
}

/// Tổng lượng (policy,name) đi tới các output có payment_credential == Script(dest_hash).
/// A-DEST: ép DistributionVest chỉ rót LAMP vào KHO Distribution treasury (dest_hash) —
/// 2-of-3 KHÔNG mint thẳng về ví cá nhân được (chống "cầm 2 khóa rút về cho mình").
/// Mirror reserve_draw Luật 9 (qty_to_credential) — mẫu đã audit. So theo payment_credential
/// (bỏ qua stake) nên kho có thể staked. Chỉ tính output là Script (ví VK → không tính).
pub fn qty_to_script(
  outputs: List<Output>,
  dest_hash: ByteArray,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      when o.address.payment_credential is {
        Script(h) ->
          if h == dest_hash {
            acc + assets.quantity_of(o.value, policy, name)
          } else {
            acc
          }
        _ -> acc
      }
    },
  )
}

/// Đếm chữ ký authority có mặt (M-of-N stub) — ĐẾM THEO TẬP KEY PHÂN BIỆT (D2-#3).
/// Dedupe authority trước khi đếm → key trùng trong danh sách authority chỉ tính 1 lần
/// (chống nhồi cùng 1 key để phình N giả / vượt threshold bằng 1 chữ ký duy nhất).
pub fn count_sigs(authority: List<ByteArray>, signatories: List<ByteArray>) -> Int {
  list.count(list.unique(authority), fn(k) { list.has(signatories, k) })
}

/// Lấy InlineDatum của output → Data (expect inline).
pub fn inline_datum(o: Output) -> Data {
  expect InlineDatum(d) = o.datum
  d
}

// ── Own-address helpers (cho spending validator) ─────────────────────────

/// payment credential của addr có phải Script(hash) không (bỏ qua stake cred).
pub fn is_at_script(addr: Address, hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == hash
    _ -> False
  }
}

/// Output bị spend (own input) — tìm theo own OutputReference.
pub fn own_input(own_ref: OutputReference, inputs: List<Input>) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output
}

/// script hash của own input (đòi payment credential là Script).
pub fn own_script_hash(o: Output) -> ByteArray {
  expect Script(h) = o.address.payment_credential
  h
}

/// Đếm input tại 1 script hash (theo payment cred, bỏ qua stake cred) —
/// chống double-satisfaction qua nhiều UTxO khác stake cred.
pub fn count_inputs_at_script(inputs: List<Input>, hash: ByteArray) -> Int {
  list.count(inputs, fn(i) { is_at_script(i.output.address, hash) })
}

/// script hash của UTxO mang đúng 1 NFT (policy,name) trong danh sách (reference) input.
/// Dùng cho A-DEST ĐỊNH-DANH-KHO bằng NFT: lamp_mint bake (kho_nft_policy, kho_nft_name)
/// — KHÔNG bake hash kho → kho (tự-bound, param theo lamp_policy) KHÔNG tạo VÒNG. Đọc
/// hash kho ĐỘNG từ ref input mang kho NFT.
///
/// ⚠ AN TOÀN (audit HIGH 19/6): kho_nft_policy PHẢI là policy ONE-SHOT 1-of-1 THẬT
/// (mẫu thread_nft/beacon_nft, mint đúng 1 lần vào địa chỉ kho). Nếu là policy tùy ý,
/// attacker đúc token khớp đặt ở SCRIPT của hắn → route LAMP về hắn (phá A-DEST). Validator
/// KHÔNG tự đảm bảo one-shot — đây là bất biến DEPLOY. Phòng thủ chiều sâu: ép ĐÚNG 1
/// carrier (filter + expect [single]) chống mơ hồ ≥2 ref (first-match) ngay cả khi NFT lỗi.
pub fn script_hash_of_holder(inputs: List<Input>, policy: PolicyId, name: AssetName) -> ByteArray {
  let carriers =
    list.filter(inputs, fn(x) { assets.quantity_of(x.output.value, policy, name) == 1 })
  expect [single] = carriers
  expect Script(h) = single.output.address.payment_credential
  h
}

// ── Test-support builders (mock UTxO/tx) ─────────────────────────────────

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

// ── Tests cho helper thuần ───────────────────────────────────────────────

test sigs_count() {
  count_sigs([#"a1", #"b2", #"c3"], [#"a1", #"c3", #"ff"]) == 2
}

test sigs_none() {
  count_sigs([#"a1"], [#"ff"]) == 0
}

test sigs_dedup_authority() {
  // D2-#3: authority có #"a1" trùng 2 lần; chỉ 1 chữ ký #"a1" → đếm == 1 (không 2).
  count_sigs([#"a1", #"a1", #"b2"], [#"a1"]) == 1
}

test name_count_one() {
  let v = assets.zero |> assets.add(#"5050", #"744c414d50", 5)
  policy_name_count(v, #"5050") == 1
}

test name_count_two() {
  let v =
    assets.zero
      |> assets.add(#"5050", #"744c414d50", 5)
      |> assets.add(#"5050", #"9999", 1)
  policy_name_count(v, #"5050") == 2
}

test qty_to_script_counts_only_dest() {
  // 1 output kho (Script #"d35a") giữ 7 LAMP + 1 output ví VK giữ 3 LAMP.
  // Chỉ tính phần tới kho → 7 (KHÔNG cộng 3 ở ví). Chứng minh rò rỉ ra ví không được tính.
  let to_kho =
    mk_output_no_datum(script_address(#"d35a"),
      assets.from_lovelace(2_000_000) |> assets.add(#"5050", #"744c414d50", 7))
  let to_wallet =
    mk_output_no_datum(vk_address(#"baad"),
      assets.from_lovelace(2_000_000) |> assets.add(#"5050", #"744c414d50", 3))
  qty_to_script([to_kho, to_wallet], #"d35a", #"5050", #"744c414d50") == 7
}
