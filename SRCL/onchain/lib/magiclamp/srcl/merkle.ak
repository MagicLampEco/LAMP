// SRCL Merkle — leaf/marker hashing + xác thực proof. blake2b_256 (32 byte).
//
// ─────────────────────────────────────────────────────────────────────────
// SƠ ĐỒ HASH — SCHEMA C (chống second-preimage + cross-epoch/campaign/role replay)
// ─────────────────────────────────────────────────────────────────────────
//   leaf = blake2b_256( 0x00 ++ campaign_id[32] ++ epoch_be8 ++ role[1] ++ owner ++ amount_be8 )
//   node = blake2b_256( 0x01 ++ left ++ right )
//   marker_name = blake2b_256( epoch_be8 ++ owner )   (slot/tên NFT — GIỮ, KHÔNG campaign)
//
// - Tiền tố domain 0x00 (leaf) / 0x01 (node): chống "leaf giả làm node" — kẻ tấn
//   công KHÔNG thể trình 1 node nội bộ như thể là leaf hợp lệ.
// - campaign_id[32] (= blake2b_256(tên_chiến_dịch)) + role[1] BAKE làm PARAM
//   validator → proof pot này KHÔNG dùng lại cho pot campaign/role khác (leaf khác
//   → root khác). SPO/SRCL role = 0x04 (spec §1 — CẤM đổi số role).
// - epoch nằm TRONG leaf → proof epoch e KHÔNG dùng lại cho epoch khác (root mỗi
//   epoch khác nhau, và leaf cũng nhúng epoch → khoá kép).
// - Mọi trường fixed-width (campaign 32B, epoch 8B, role 1B, amount 8B) → raw-concat
//   KHÔNG nhập nhằng biên. owner = credential-hash (SRCL/SPO = stake key-hash 28B).
// - marker_name/slot GIỮ NGUYÊN (epoch ++ owner) — slot chỉ để sort + đặt tên NFT
//   claim-slot, KHÔNG cô lập theo campaign (spec §1). Cô lập pot nằm ở LEAF.
//
// MerkleStep.left = anh-em ở BÊN TRÁI: True  → node = h(0x01 ++ sib ++ cur)
//                                       False → node = h(0x01 ++ cur ++ sib)
// Off-chain merkle.ts dựng cây theo ĐÚNG quy ước này (vị trí trái/phải giữ nguyên,
// KHÔNG sort cặp — để on-chain rẻ và xác định).

use aiken/builtin
use aiken/crypto.{blake2b_256}
use magiclamp/srcl/types.{MerkleStep}

const leaf_tag: ByteArray = #"00"

const node_tag: ByteArray = #"01"

/// Nối 2 bytearray.
fn ba(a: ByteArray, b: ByteArray) -> ByteArray {
  builtin.append_bytearray(a, b)
}

/// Mã hoá Int → big-endian 8 byte (giả định 0 ≤ n < 2^64, đủ cho oildrop/epoch).
pub fn int_to_be8(n: Int) -> ByteArray {
  do_be(n, 8, #"")
}

/// Mã hoá Int → big-endian 1 byte (role: 0 ≤ n < 256). Fixed-width 1B cho role tag.
pub fn int_to_be1(n: Int) -> ByteArray {
  do_be(n, 1, #"")
}

fn do_be(n: Int, k: Int, acc: ByteArray) -> ByteArray {
  if k == 0 {
    acc
  } else {
    let byte = n % 256
    // prepend byte (xây từ chữ-số-thấp lên cao → bytearray big-endian)
    do_be(n / 256, k - 1, builtin.cons_bytearray(byte, acc))
  }
}

/// Hash của leaf SCHEMA C: 0x00 ++ campaign_id[32] ++ epoch_be8 ++ role[1] ++
/// owner ++ amount_be8. campaign_id + role BAKE (param validator) → cô lập pot.
pub fn leaf_hash(
  campaign_id: ByteArray,
  epoch: Int,
  role: Int,
  owner: ByteArray,
  amount: Int,
) -> ByteArray {
  blake2b_256(
    ba(leaf_tag, campaign_id)
      |> ba(int_to_be8(epoch))
      |> ba(int_to_be1(role))
      |> ba(owner)
      |> ba(int_to_be8(amount)),
  )
}

/// Asset name của MARKER NFT cho (epoch, owner). Thuần hàm → 1 cặp = 1 name.
pub fn marker_name(epoch: Int, owner: ByteArray) -> ByteArray {
  blake2b_256(ba(int_to_be8(epoch), owner))
}

/// Gộp cur với anh-em theo hướng → hash node cha.
pub fn combine(cur: ByteArray, step: MerkleStep) -> ByteArray {
  let joined =
    if step.left {
      ba(node_tag, step.hash) |> ba(cur)
    } else {
      ba(node_tag, cur) |> ba(step.hash)
    }
  blake2b_256(joined)
}

/// Đi từ leaf lên root theo proof → root tính được.
pub fn root_from(leaf: ByteArray, proof: List<MerkleStep>) -> ByteArray {
  when proof is {
    [] -> leaf
    [step, ..rest] -> root_from(combine(leaf, step), rest)
  }
}

/// Xác thực (campaign_id, epoch, role, owner, amount) thuộc cây có gốc `root`.
pub fn verify(
  root: ByteArray,
  campaign_id: ByteArray,
  epoch: Int,
  role: Int,
  owner: ByteArray,
  amount: Int,
  proof: List<MerkleStep>,
) -> Bool {
  root_from(leaf_hash(campaign_id, epoch, role, owner, amount), proof) == root
}

/// Hash 1 node cha từ 2 con (trái, phải) — helper test dựng cây tham chiếu.
pub fn node_hash(left: ByteArray, right: ByteArray) -> ByteArray {
  blake2b_256(ba(node_tag, left) |> ba(right))
}

// ══════════════════════════════════════════════════════════════
// Tests (cây nhỏ, đối chiếu off-chain merkle.ts)
// ══════════════════════════════════════════════════════════════

test int_to_be8_zero() {
  int_to_be8(0) == #"0000000000000000"
}

test int_to_be8_one() {
  int_to_be8(1) == #"0000000000000001"
}

test int_to_be8_256() {
  int_to_be8(256) == #"0000000000000100"
}

test int_to_be8_big() {
  // 27_780_000 (oildrop) = 0x1A7E3A0
  int_to_be8(27_780_000) == #"0000000001a7e3a0"
}

test int_to_be1_role() {
  // role SPO = 4 → 1 byte 0x04.
  int_to_be1(4) == #"04" && int_to_be1(1) == #"01"
}

// campaign_id mẫu (32B) + role SPO cho test cây (self-consistent).
const tc: ByteArray =
  #"5286f2c03f9f7c8b4e0d7da40f325ed5ecdc5d3eaf858efaf297aaefa6f1aedd"

const tr: Int = 4

// 2-leaf tree: L0=leaf(0,a,100), L1=leaf(0,b,200). root = node(L0,L1).
test verify_two_leaf_left() {
  let l0 = leaf_hash(tc, 0, tr, #"aa", 100)
  let l1 = leaf_hash(tc, 0, tr, #"bb", 200)
  let root = node_hash(l0, l1)
  // proof cho L0: anh-em L1 ở BÊN PHẢI (left=False).
  verify(root, tc, 0, tr, #"aa", 100, [MerkleStep { hash: l1, left: False }])
}

test verify_two_leaf_right() {
  let l0 = leaf_hash(tc, 0, tr, #"aa", 100)
  let l1 = leaf_hash(tc, 0, tr, #"bb", 200)
  let root = node_hash(l0, l1)
  // proof cho L1: anh-em L0 ở BÊN TRÁI (left=True).
  verify(root, tc, 0, tr, #"bb", 200, [MerkleStep { hash: l0, left: True }])
}

test verify_wrong_amount_fails() {
  let l0 = leaf_hash(tc, 0, tr, #"aa", 100)
  let l1 = leaf_hash(tc, 0, tr, #"bb", 200)
  let root = node_hash(l0, l1)
  !verify(root, tc, 0, tr, #"aa", 999, [MerkleStep { hash: l1, left: False }])
}

test verify_wrong_epoch_fails() {
  // leaf cùng (addr,amount) nhưng epoch khác → root khác → reject.
  let l0 = leaf_hash(tc, 0, tr, #"aa", 100)
  let l1 = leaf_hash(tc, 0, tr, #"bb", 200)
  let root = node_hash(l0, l1)
  !verify(root, tc, 1, tr, #"aa", 100, [MerkleStep { hash: l1, left: False }])
}

test verify_wrong_campaign_fails() {
  // proof pot campaign X KHÔNG dùng lại cho campaign Y (campaign_id khác → leaf
  // khác → root mismatch). Cô lập theo chiến dịch (schema C).
  let l0 = leaf_hash(tc, 0, tr, #"aa", 100)
  let l1 = leaf_hash(tc, 0, tr, #"bb", 200)
  let root = node_hash(l0, l1)
  let other_campaign =
    #"0000000000000000000000000000000000000000000000000000000000000000"
  !verify(root, other_campaign, 0, tr, #"aa", 100, [MerkleStep { hash: l1, left: False }])
}

test verify_wrong_role_fails() {
  // proof vai SPO(4) KHÔNG dùng lại cho vai khác (role byte khác → leaf khác).
  let l0 = leaf_hash(tc, 0, tr, #"aa", 100)
  let l1 = leaf_hash(tc, 0, tr, #"bb", 200)
  let root = node_hash(l0, l1)
  !verify(root, tc, 0, 1, #"aa", 100, [MerkleStep { hash: l1, left: False }])
}

// 4-leaf tree.
test verify_four_leaf() {
  let a = leaf_hash(tc, 3, tr, #"a1", 10)
  let b = leaf_hash(tc, 3, tr, #"b2", 20)
  let c = leaf_hash(tc, 3, tr, #"c3", 30)
  let d = leaf_hash(tc, 3, tr, #"d4", 40)
  let ab = node_hash(a, b)
  let cd = node_hash(c, d)
  let root = node_hash(ab, cd)
  // proof cho c: c là leaf trái của cd. anh-em d (phải), rồi ab (trái).
  verify(
    root, tc, 3, tr, #"c3", 30,
    [MerkleStep { hash: d, left: False }, MerkleStep { hash: ab, left: True }],
  )
}

test marker_name_deterministic() {
  marker_name(5, #"abcd") == marker_name(5, #"abcd")
}

test marker_name_distinct_epoch() {
  marker_name(5, #"abcd") != marker_name(6, #"abcd")
}

// ── ĐỐI CHIẾU BYTE-PERFECT (schema C) — vector canonical tính TỪ on-chain ──
// Vector dưới đây tính bằng blake2b_256 độc lập (python hashlib, digest_size=32) —
// off-chain merkle.ts + AffiSo reward-engine PHẢI dựng lại KHỚP CHÍNH hash này
// (spec §5). marker unchanged (schema B==C) nên vector marker cũ vẫn hợp lệ.
// tc = blake2b_256("LAMP-SRCL-1"); role = 4 (SPO).

test leaf_matches_offchain_vector() {
  leaf_hash(tc, 0, tr, #"aa", 100) == #"fbe7c0dcae6d34a785caac569c1fa8d0da5ed4dfc41ab99abc247937ad61dc52"
}

test node_matches_offchain_vector() {
  node_hash(leaf_hash(tc, 0, tr, #"aa", 100), leaf_hash(tc, 0, tr, #"bb", 200)) == #"a14cbb19a33fde70831c68ede724a160daf80432cbc9c2531f5e5b9b251f9362"
}

test marker_matches_offchain_vector() {
  marker_name(5, #"abcd") == #"adaf6061f0752090bdbf0778255175cf02efa0b27b66351af8a70de586a2adbd"
}

// ── PARITY VECTOR CHUẨN schema C (spec §5) ──
// campaign_id = blake2b_256("LAMP-SRCL-1")  (bytes utf8 = #"4c414d502d5352434c2d31")
// epoch=100, role=4 (SPO), owner = 28B #"bb..bb", amount = 27_780_000 oildrop.
// Đây là leaf hex CANONICAL để off-chain/AffiSo neo vào.
test parity_v2_leaf() {
  let campaign_id = blake2b_256(#"4c414d502d5352434c2d31")
  // campaign_id phải == hằng tc (đối chiếu giá trị bake).
  expect campaign_id == tc
  let owner = #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let leaf = leaf_hash(campaign_id, 100, 4, owner, 27_780_000)
  trace @"parity_v2_leaf(campaign_id=LAMP-SRCL-1, epoch=100, role=4, owner=bb*28, amount=27780000)"
  trace leaf
  leaf == #"e47d8183552d5c21de639b5ddf9a82bcc6d4648c3fad2bc0959e2cd1826f03ba"
}
