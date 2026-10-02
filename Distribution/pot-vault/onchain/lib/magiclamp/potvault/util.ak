// Helper dùng chung cho `pot_vault`. Cùng khuôn với `Faucet/onchain/lib/magiclamp/
// faucet/util.ak`: đếm theo SCRIPT HASH (bộ lọc rộng), rồi ghim ĐỊA CHỈ ĐẦY ĐỦ ở
// đúng chỗ cần ghim nơi đến.
//
// VÌ SAO TÁCH HAI VIỆC: thu hẹp bộ lọc về địa chỉ đầy đủ ngay tại chỗ ĐẾM làm một
// output "dời nhà" (cùng payment credential, thêm stake credential) rơi hẳn ra
// khỏi danh sách ⇒ phép đếm thấy 0 và cho qua đúng cái nó phải chặn.

use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}

// ── Định vị UTxO đang spend ───────────────────────────────────────

/// Output đã resolve của `own_ref`.
pub fn own_output(own_ref: OutputReference, inputs: List<Input>) -> Output {
  expect Some(i) = list.find(inputs, fn(x) { x.output_reference == own_ref })
  i.output
}

/// Script hash của address đang chạy.
pub fn own_script_hash(own_addr: Address) -> ByteArray {
  expect Script(h) = own_addr.payment_credential
  h
}

// ── Lọc / đếm theo script hash ────────────────────────────────────

pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

pub fn count_inputs_at_script(
  inputs: List<Input>,
  script_hash: ByteArray,
) -> Int {
  list.count(inputs, fn(x) { is_at_script(x.output.address, script_hash) })
}

pub fn count_outputs_at_script(
  outputs: List<Output>,
  script_hash: ByteArray,
) -> Int {
  list.count(outputs, fn(x) { is_at_script(x.address, script_hash) })
}

/// Output đầu tiên ở script hash đó. Caller phải đã ép "đúng 1".
pub fn output_at_script(outputs: List<Output>, script_hash: ByteArray) -> Output {
  expect Some(o) =
    list.find(outputs, fn(x) { is_at_script(x.address, script_hash) })
  o
}

// ── Lọc / đếm theo NFT ────────────────────────────────────────────

/// Output có mang đúng 1 NFT (policy, name) không.
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

/// Input duy nhất mang NFT (policy, name). Caller phải đã ép "đúng 1".
/// Trả về cả `Input` (không chỉ `Output`) vì nhánh UTxO lạc cần `output_reference`
/// của nó để tra redeemer trong `tx.redeemers`.
pub fn input_with_nft(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Input {
  expect Some(i) = list.find(inputs, fn(x) { has_nft(x.output, policy, name) })
  i
}

/// Output duy nhất mang NFT (policy, name). Caller phải đã ép "đúng 1".
pub fn output_with_nft(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Output {
  expect Some(o) = list.find(outputs, fn(x) { has_nft(x, policy, name) })
  o
}

// ── Địa chỉ ───────────────────────────────────────────────────────

/// Địa chỉ enterprise (KHÔNG stake credential) của một script hash. Dùng cho MỌI
/// phép ghim nơi đến: `is_at_script` chỉ so payment credential nên stake
/// credential là trường tự do nếu không so địa chỉ đầy đủ — và phần thưởng uỷ
/// quyền trên min-ADA của két sẽ chảy về khoá stake của kẻ dựng tx.
pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

// ── Cửa sổ thời gian ──────────────────────────────────────────────

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// Cửa sổ (bucket) của tx, NEO VÀO THỜI GIAN THẬT.
///
/// Khác `Faucet.get_epoch_pinned` ở HAI điểm, cả hai đều là siết:
///   1. xử đúng cận MỞ (`is_inclusive == False`): cận dưới mở ⇒ thời điểm sớm
///      nhất là `lo + 1`; cận trên mở ⇒ muộn nhất là `hi − 1`. Không quy đổi thì
///      một tx `after_exclusive(t)` bị đọc bucket của `t` trong khi nó chỉ chạy
///      được từ `t+1` — sai một bucket ở đúng biên.
///   2. trần độ rộng `max_range_ms`: "hai cận cùng bucket" cho phép trượt `now`
///      trong cả bề rộng bucket (5 ngày ở Preprod). Trần 1 giờ kẹp sai lệch lại.
///
/// Nghĩa vụ off-chain: đặt `lo = now_ms`,
/// `hi = min(now_ms + ttl, o + ((lo − o) / ms_per_epoch + 1) × ms_per_epoch − 1)`,
/// `o = window_origin_ms` (WIN-ORIGIN-2), với
/// `ttl ≤ max_range_ms`; phần còn lại của bucket ngắn hơn ttl tối thiểu thì CHỜ
/// sang bucket sau, KHÔNG nới `hi`.
pub fn get_epoch_pinned(
  tx: Transaction,
  ms_per_epoch: Int,
  window_origin_ms: Int,
  max_range_ms: Int,
) -> Int {
  let lower = tx.validity_range.lower_bound
  let upper = tx.validity_range.upper_bound
  expect Some(lo_raw) = lower.bound_type |> get_finite
  expect Some(hi_raw) = upper.bound_type |> get_finite
  let lo =
    if lower.is_inclusive {
      lo_raw
    } else {
      lo_raw + 1
    }
  let hi =
    if upper.is_inclusive {
      hi_raw
    } else {
      hi_raw - 1
    }
  // Khoảng rỗng (`lo > hi`) không phải tx hợp lệ; và số âm làm phép chia đổi
  // nghĩa ⇒ chặn cả hai, fail-closed.
  // Chặn âm đặt trên SỐ BỊ CHIA (`lo − gốc`), không trên `lo` thô: với gốc = 0 hai
  // vế trùng nhau; với gốc > 0 đây mới là vế giữ đúng nghĩa "chia sàn không đổi dấu".
  expect lo - window_origin_ms >= 0
  expect lo <= hi
  expect hi - lo <= max_range_ms
  // WIN-ORIGIN-1 (Specs/Window/CONTRACT.md v1.0).
  let e = ( lo - window_origin_ms ) / ms_per_epoch
  expect ( hi - window_origin_ms ) / ms_per_epoch == e
  e
}

// ── Giá trị (Value) ───────────────────────────────────────────────

/// Value chỉ gồm ADA + (tuỳ) NFT (nft_policy, nft_name) + (tuỳ) LAMP.
///
/// Dựng lại value từ đúng ba thành phần rồi SO BẰNG, thay vì liệt kê thứ phải
/// vắng mặt: cách liệt kê không bao giờ đóng hết, còn phép so bằng đóng mọi
/// token chưa được nêu tên — kể cả token do kẻ dựng tx tự đúc.
pub fn only_ada_nft_lamp(
  v: Value,
  nft_policy: PolicyId,
  nft_name: AssetName,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
) -> Bool {
  let rebuilt =
    assets.from_lovelace(assets.lovelace_of(v))
      |> assets.add(
          nft_policy,
          nft_name,
          assets.quantity_of(v, nft_policy, nft_name),
        )
      |> assets.add(
          lamp_policy,
          lamp_name,
          assets.quantity_of(v, lamp_policy, lamp_name),
        )
  rebuilt == v
}

/// KHÔNG đúc và KHÔNG đốt gì dưới `policy` trong tx này.
pub fn no_mint_under(tx: Transaction, policy: PolicyId) -> Bool {
  dict.is_empty(assets.tokens(tx.mint, policy))
}

/// Tổng LAMP của mọi UTxO LẠC trong input — input ở địa chỉ script `script_hash`
/// mà KHÔNG mang NFT pot.
pub fn stray_lamp_total(
  inputs: List<Input>,
  script_hash: ByteArray,
  nft_name: AssetName,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
) -> Int {
  list.foldl(
    inputs,
    0,
    fn(i, acc) {
      if and {
        is_at_script(i.output.address, script_hash),
        !has_nft(i.output, script_hash, nft_name),
      } {
        acc + assets.quantity_of(i.output.value, lamp_policy, lamp_name)
      } else {
        acc
      }
    },
  )
}

// ── Test-support builders (mock UTxO/tx) ──────────────────────────

/// Cùng script hash, KHÁC stake credential → Address khác nhưng cùng validator.
/// Đây là ca DUY NHẤT tách được cổng "so địa chỉ đầy đủ" khỏi cổng
/// "payment credential là Script(x)".
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
    value,
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

pub fn mk_output_no_datum(addr: Address, value: Value) -> Output {
  Output { address: addr, value, datum: NoDatum, reference_script: None }
}

/// Output CÓ đính reference script — chỉ dùng cho ca kiểm cổng cấm script-carrier.
/// `mk_output`/`mk_output_no_datum` luôn đặt `reference_script: None`, nên mọi ca
/// dựng bằng chúng KHÔNG phân biệt được hai bên của cổng đó.
pub fn mk_output_with_ref_script(
  addr: Address,
  value: Value,
  datum: Data,
  script_hash: ByteArray,
) -> Output {
  Output {
    address: addr,
    value,
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
