// Logic thuần cho "hàm điều tiết cung-cầu" — chia LAMP thu được về ≥2 người
// nhận theo TRỌNG SỐ, mỗi người nhận là custody Accounting (script hash, KHÔNG
// ví PKH). MVP: 20% MagicLamp / 80% App. (CONTRACT §3.1.)
//
// Bất biến CỨNG (chứng minh bằng aiken test):
//   (S1) Σ parts == total          — value bảo toàn TUYỆT ĐỐI, KHÔNG rơi oil khi
//                                     chia lẻ (floor + remainder dồn recipient ĐẦU).
//   (S2) part_i == ⌊ total × weight_i / 10000 ⌋  cho i ≥ 1; part_0 = floor_0 + remainder.
//   (S3) total ≥ min_oil           — chống bụi + buộc gộp lô (mỗi settlement ≥ min_oil).
//   (S4) Σ weight_bps == 10000      — không tạo/mất trọng số.
//
// THIẾT KẾ remainder (4 trục): floor luôn ≤ phần thực ⇒ Σ floor ≤ total, phần dư
// r = total − Σ floor ∈ [0, |recipients|). Dồn r vào recipient ĐẦU (MagicLamp) để
// protocol KHÔNG thiệt khi chia lẻ (lợi ích hệ thống + đơn giản 1 chỗ, rẻ ExUnit).
// KHÔNG float — chỉ Int (eUTXO determinism).

use aiken/collection/list
use aiken/primitive/bytearray

/// Một người nhận trong split: custody Accounting (script hash 28 byte) + trọng số bps.
/// weight_bps ∈ [0,10000]; Σ qua mọi recipient == 10000 (param_valid ép).
pub type Recipient {
  custody_hash : ByteArray,   // payment SCRIPT hash của custody đích (KHÔNG ví PKH)
  weight_bps   : Int,
}

/// Tham số split (governance beacon hoặc param). recipients ≥ 2; Σ weight == 10000.
/// min_oil ≥ 0 — mỗi settlement total PHẢI ≥ min_oil (MVP 360).
pub type SplitParam {
  recipients : List<Recipient>,
  min_oil    : Int,
}

/// Σ weight_bps qua mọi recipient.
pub fn weights_sum(recipients: List<Recipient>) -> Int {
  list.foldl(recipients, 0, fn(r, acc) { acc + r.weight_bps })
}

/// Mọi weight_bps ∈ [0,10000] (không âm, không vượt trần).
pub fn all_weights_nonneg(recipients: List<Recipient>) -> Bool {
  list.all(recipients, fn(r) { r.weight_bps >= 0 && r.weight_bps <= 10000 })
}

/// custody_hash đúng độ dài script hash blake2b-224 = 28 byte (chống nhồi hash rác /
/// địa chỉ ví dạng khác). KHÔNG phân biệt script↔vk chỉ từ hash — SCRIPT-ness được ép
/// ở tầng output address (orchestrator + splitter v1.x), đây chỉ là sanity độ dài.
pub fn all_hashes_sized(recipients: List<Recipient>) -> Bool {
  list.all(recipients, fn(r) { bytearray.length(r.custody_hash) == 28 })
}

/// Param hợp lệ: ≥2 recipient, mọi weight ∈ [0,10000], Σ weight == 10000,
/// min_oil ≥ 0, mọi custody_hash đúng 28 byte.
pub fn param_valid(param: SplitParam) -> Bool {
  list.length(param.recipients) >= 2 && all_weights_nonneg(param.recipients) && weights_sum(
    param.recipients,
  ) == 10000 && param.min_oil >= 0 && all_hashes_sized(param.recipients)
}

/// total ≥ min_oil (S3). Biên: min_oil-1 fail, min_oil pass.
pub fn min_oil_ok(total: Int, min_oil: Int) -> Bool {
  total >= min_oil
}

/// floor part theo weight: ⌊ total × weight_bps / 10000 ⌋. total ≥ 0, weight ≥ 0
/// ⇒ phép chia Aiken (trunc-toward-zero) == floor.
pub fn floor_part(total: Int, weight_bps: Int) -> Int {
  total * weight_bps / 10000
}

/// Danh sách floor part theo thứ tự recipients (CHƯA dồn remainder).
pub fn floor_parts(total: Int, recipients: List<Recipient>) -> List<Int> {
  list.map(recipients, fn(r) { floor_part(total, r.weight_bps) })
}

/// split_amounts(total, recipients) -> List<Int> theo thứ tự recipients.
/// = floor_parts với REMAINDER (total − Σ floor) dồn vào phần tử ĐẦU (MagicLamp).
/// Bất biến S1: Σ kết quả == total. S2: phần tử i≥1 == floor_i.
///
/// recipients rỗng → [] (param_valid đã chặn ở tầng gọi; ở đây an toàn trả []).
pub fn split_amounts(total: Int, recipients: List<Recipient>) -> List<Int> {
  let floors = floor_parts(total, recipients)
  let assigned = list.foldl(floors, 0, fn(p, acc) { acc + p })
  let remainder = total - assigned
  when floors is {
    [] -> []
    [head, ..rest] -> [head + remainder, ..rest]
  }
}

/// Σ của một List<Int> (helper test bất biến S1).
pub fn sum_ints(xs: List<Int>) -> Int {
  list.foldl(xs, 0, fn(x, acc) { acc + x })
}
