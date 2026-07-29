// SRCL Merkle — leaf/marker hashing + xác thực proof. blake2b_256 (32 byte).
//
// ─────────────────────────────────────────────────────────────────────────
// SƠ ĐỒ HASH (chống second-preimage + cross-epoch replay)
// ─────────────────────────────────────────────────────────────────────────
//   leaf   = blake2b_256( 0x00 ++ epoch_be8 ++ owner ++ amount_be8 )
//   node   = blake2b_256( 0x01 ++ left ++ right )
//   marker_name = blake2b_256( epoch_be8 ++ owner )   (asset name, ngắn hơn dùng)
//
// - Tiền tố domain 0x00 (leaf) / 0x01 (node): chống "leaf giả làm node" — kẻ tấn
//   công KHÔNG thể trình 1 node nội bộ như thể là leaf hợp lệ.
// - epoch nằm TRONG leaf → proof epoch e KHÔNG dùng lại cho epoch khác (root mỗi
//   epoch khác nhau, và leaf cũng nhúng epoch → khoá kép).
// - Int mã hoá big-endian 8 byte (cố định) → KHÔNG nhập nhằng độ dài khi nối.
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

fn do_be(n: Int, k: Int, acc: ByteArray) -> ByteArray {
  if k == 0 {
    acc
  } else {
    let byte = n % 256
    // prepend byte (xây từ chữ-số-thấp lên cao → bytearray big-endian)
    do_be(n / 256, k - 1, builtin.cons_bytearray(byte, acc))
  }
}

/// Hash của leaf (epoch, owner, amount).
pub fn leaf_hash(epoch: Int, owner: ByteArray, amount: Int) -> ByteArray {
  blake2b_256(
    ba(leaf_tag, int_to_be8(epoch)) |> ba(owner) |> ba(int_to_be8(amount)),
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

/// Xác thực (epoch, owner, amount) thuộc cây có gốc `root`.
pub fn verify(
  root: ByteArray,
  epoch: Int,
  owner: ByteArray,
  amount: Int,
  proof: List<MerkleStep>,
) -> Bool {
  root_from(leaf_hash(epoch, owner, amount), proof) == root
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

// 2-leaf tree: L0=leaf(0,a,100), L1=leaf(0,b,200). root = node(L0,L1).
test verify_two_leaf_left() {
  let l0 = leaf_hash(0, #"aa", 100)
  let l1 = leaf_hash(0, #"bb", 200)
  let root = node_hash(l0, l1)
  // proof cho L0: anh-em L1 ở BÊN PHẢI (left=False).
  verify(root, 0, #"aa", 100, [MerkleStep { hash: l1, left: False }])
}

test verify_two_leaf_right() {
  let l0 = leaf_hash(0, #"aa", 100)
  let l1 = leaf_hash(0, #"bb", 200)
  let root = node_hash(l0, l1)
  // proof cho L1: anh-em L0 ở BÊN TRÁI (left=True).
  verify(root, 0, #"bb", 200, [MerkleStep { hash: l0, left: True }])
}

test verify_wrong_amount_fails() {
  let l0 = leaf_hash(0, #"aa", 100)
  let l1 = leaf_hash(0, #"bb", 200)
  let root = node_hash(l0, l1)
  !verify(root, 0, #"aa", 999, [MerkleStep { hash: l1, left: False }])
}

test verify_wrong_epoch_fails() {
  // leaf cùng (addr,amount) nhưng epoch khác → root khác → reject.
  let l0 = leaf_hash(0, #"aa", 100)
  let l1 = leaf_hash(0, #"bb", 200)
  let root = node_hash(l0, l1)
  !verify(root, 1, #"aa", 100, [MerkleStep { hash: l1, left: False }])
}

// 4-leaf tree.
test verify_four_leaf() {
  let a = leaf_hash(3, #"a1", 10)
  let b = leaf_hash(3, #"b2", 20)
  let c = leaf_hash(3, #"c3", 30)
  let d = leaf_hash(3, #"d4", 40)
  let ab = node_hash(a, b)
  let cd = node_hash(c, d)
  let root = node_hash(ab, cd)
  // proof cho c: [b? no] — c là leaf trái của cd. anh-em d (phải), rồi ab (trái).
  verify(
    root, 3, #"c3", 30,
    [MerkleStep { hash: d, left: False }, MerkleStep { hash: ab, left: True }],
  )
}

test marker_name_deterministic() {
  marker_name(5, #"abcd") == marker_name(5, #"abcd")
}

test marker_name_distinct_epoch() {
  marker_name(5, #"abcd") != marker_name(6, #"abcd")
}

// ── ĐỐI CHIẾU BYTE-PERFECT với off-chain merkle.ts (@noble/hashes blake2b-256) ──
// Giá trị tính từ SRCL/offchain/src/merkle.ts cho CÙNG input → phải trùng tuyệt
// đối, chứng minh on-chain ↔ off-chain tạo cùng leaf/node/marker (proof tương thích).

test leaf_matches_offchain_vector() {
  leaf_hash(0, #"aa", 100) == #"3240bdb52621ea1d6563c2ab5bd677fdb0eeed3dccd6c1d253db7869b2777d14"
}

test node_matches_offchain_vector() {
  node_hash(leaf_hash(0, #"aa", 100), leaf_hash(0, #"bb", 200)) == #"a45ea13d2d404e73947ecf12b510db81d4deb6814c44524399e123841d1b927f"
}

test marker_matches_offchain_vector() {
  marker_name(5, #"abcd") == #"adaf6061f0752090bdbf0778255175cf02efa0b27b66351af8a70de586a2adbd"
}
