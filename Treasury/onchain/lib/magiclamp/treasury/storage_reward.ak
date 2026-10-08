// Logic thuần cho validator trả thưởng lưu trữ LampNet (Treasury/storage-reward/CONTRACT.md v0.1).
//
// Một ĐỢT (batch) = một UTxO ở địa chỉ `storage_reward`, mang đúng 1 token chứng thực
// (policy = hash chính validator, tên `batch_token_name`) và datum `Active`. Token chỉ đúc được
// dưới chữ ký M-of-N (nhánh mint `MintBatch`), nên "UTxO có token" ⇔ "datum ban đầu do hội đồng
// viết". UTxO KHÔNG có token (kể cả output do `Release` của custody tạo ra) là UTxO CHƯA MỞ: datum
// của nó không được đọc, chỉ có hai lối ra — `Open` (hội đồng) hoặc `Close` về custody (hội đồng).

use aiken/builtin
use aiken/collection/list
use aiken/crypto
use aiken/math
use aiken/primitive/bytearray
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/assets.{Value}

/// Tên token chứng thực đợt.
pub const batch_token_name: ByteArray = "SRPBATCH"

/// Tag miền của lá. Đã tránh 0x00/0x01 (merkle Distribution), 0x03 (Release spend_spec_hash),
/// 0x04 (pointer_spec_hash), 0x10/0x11.
pub const leaf_tag: ByteArray = #"20"

/// Tag miền của nút trong.
pub const node_tag: ByteArray = #"21"

/// s ≤ 0,5 (quyết định chủ dự án 2026-10-08) — viết bằng bps.
pub const max_share_bps: Int = 5000

pub const bps_denominator: Int = 10000

/// Trần số lá một epoch ⇒ bitmap ≤ 512 byte trong datum.
pub const max_leaves: Int = 4096

/// Số epoch chờ sau epoch dịch vụ cuối rồi mới cho đóng đợt không cần chữ ký.
pub const close_grace_epochs: Int = 1

/// Trạng thái vòng trả của MỘT epoch dịch vụ.
pub type Round {
  epoch: Int,
  root: ByteArray,
  leaf_count: Int,
  paid: Int,
  claimed: ByteArray,
}

pub type PayoutDatum {
  Active {
    start_epoch: Int,
    epoch_fees: List<Int>,
    share_bps: Int,
    round: Option<Round>,
  }
  Tombstone
}

pub type ClaimItem {
  index: Int,
  amount: Int,
  proof: List<ByteArray>,
}

pub type PayoutAction {
  Open
  PostRoot { epoch: Int, root: ByteArray, leaf_count: Int }
  Claim { claims: List<ClaimItem> }
  Close
  Burn
}

pub type BatchMint {
  MintBatch
  BurnBatch
}

// ── Định dạng lá ──

/// 1 byte loại + 28 byte hash. VerificationKey = 0x00, Script = 0x01.
pub fn payment_bytes(c: Credential) -> ByteArray {
  when c is {
    VerificationKey(h) -> bytearray.push(h, 0)
    Script(h) -> bytearray.push(h, 1)
  }
}

/// Không có = 0x00; Inline VerificationKey = 0x01 ‖ hash; Inline Script = 0x02 ‖ hash.
/// Stake credential dạng con trỏ (Pointer) bị từ chối — lá không mã hoá được nó.
pub fn stake_bytes(addr: Address) -> ByteArray {
  when addr.stake_credential is {
    None -> #"00"
    Some(Inline(VerificationKey(h))) -> bytearray.push(h, 1)
    Some(Inline(Script(h))) -> bytearray.push(h, 2)
    Some(_) -> fail @"SRP-LEAF-ADDR: stake pointer"
  }
}

/// leaf = blake2b_256(0x20 ‖ u64be(epoch) ‖ u32be(index) ‖ u64be(amount) ‖ payment ‖ stake)
pub fn leaf_hash(epoch: Int, index: Int, amount: Int, addr: Address) -> ByteArray {
  crypto.blake2b_256(
    leaf_tag
      |> bytearray.concat(bytearray.from_int_big_endian(epoch, 8))
      |> bytearray.concat(bytearray.from_int_big_endian(index, 4))
      |> bytearray.concat(bytearray.from_int_big_endian(amount, 8))
      |> bytearray.concat(payment_bytes(addr.payment_credential))
      |> bytearray.concat(stake_bytes(addr)),
  )
}

/// node = blake2b_256(0x21 ‖ min(a,b) ‖ max(a,b)) — cặp đã sắp, bằng chứng không cần bit hướng.
pub fn node_hash(a: ByteArray, b: ByteArray) -> ByteArray {
  if builtin.less_than_equals_bytearray(a, b) {
    crypto.blake2b_256(node_tag |> bytearray.concat(a) |> bytearray.concat(b))
  } else {
    crypto.blake2b_256(node_tag |> bytearray.concat(b) |> bytearray.concat(a))
  }
}

pub fn root_from(leaf: ByteArray, proof: List<ByteArray>) -> ByteArray {
  list.foldl(proof, leaf, fn(sibling, acc) { node_hash(acc, sibling) })
}

// ── Trần theo epoch ──

/// cap(e) = ⌊F_e · s_bps / 10000⌋, F_e = epoch_fees[e − start]. Ngoài đợt ⇒ fail.
pub fn cap_of(
  epoch_fees: List<Int>,
  start_epoch: Int,
  epoch: Int,
  share_bps: Int,
) -> Int {
  expect epoch >= start_epoch
  expect Some(f) = list.at(epoch_fees, epoch - start_epoch)
  f * share_bps / bps_denominator
}

pub fn total_caps(epoch_fees: List<Int>, share_bps: Int) -> Int {
  list.foldl(epoch_fees, 0, fn(f, acc) { acc + f * share_bps / bps_denominator })
}

// ── Bitmap chống trả trùng: bit i = byte i/8, bit (7 − i%8) (MSB trước) ──

pub fn empty_bitmap(leaf_count: Int) -> ByteArray {
  bytearray.from_int_big_endian(0, ( leaf_count + 7 ) / 8)
}

pub fn is_claimed(bitmap: ByteArray, index: Int) -> Bool {
  bytearray.test_bit(bitmap, index)
}

/// Bật bit `index`. Tiền điều kiện: bit đang tắt (người gọi đã kiểm `is_claimed`).
pub fn set_claimed(bitmap: ByteArray, index: Int) -> ByteArray {
  let j = index / 8
  let b = builtin.index_bytearray(bitmap, j)
  let nb = b + math.pow2(7 - index % 8)
  bytearray.concat(
    bytearray.take(bitmap, j),
    bytearray.push(bytearray.drop(bitmap, j + 1), nb),
  )
}

// ── Hình dạng value của UTxO đợt: CHỈ lovelace + CARP + token đợt ──

pub fn batch_value(
  lovelace: Int,
  carp_policy: ByteArray,
  carp_name: ByteArray,
  carp_qty: Int,
  own_policy: ByteArray,
  token_qty: Int,
) -> Value {
  assets.from_lovelace(lovelace)
    |> assets.add(carp_policy, carp_name, carp_qty)
    |> assets.add(own_policy, batch_token_name, token_qty)
}
