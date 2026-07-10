// Merkle proof verify — hash-chain đơn giản (KHÔNG cần aiken stdlib MPF).
//
// FIRST-PRINCIPLES: airdrop snapshot CỐ ĐỊNH (tính 1 lần off-chain), KHÔNG cập
// nhật incremental → cây Merkle nhị phân thường (binary hash tree) là đủ, rẻ hơn
// Merkle-Patricia-Forestry (MPF dành cho map có insert/delete on-chain). Verify =
// fold proof từ leaf lên root, mỗi bước hash 2 con theo thứ tự (is_left).
//
// ─────────────────────────────────────────────────────────────────────────
// LEAF ENCODING (PHẢI khớp byte-perfect off-chain merkle.ts)
//   leaf = blake2b_256( cbor.serialise(address) ++ amount_be_8 )
//     - cbor.serialise(address): mã hoá Plutus-Data của Address (Constr) — tất
//       định, off-chain dựng cùng Data → cùng bytes.
//     - amount_be_8: amount (oil) big-endian 8 byte (u64). Cố định độ dài →
//       chống nhập nhằng (ambiguity) khi nối chuỗi.
//   Domain-separation: leaf prefix 0x00, node prefix 0x01 → chống second-preimage
//   (kẻ tấn công không thể trình 1 node trung gian làm leaf).
// ─────────────────────────────────────────────────────────────────────────

use aiken/cbor
use aiken/crypto.{blake2b_256}
use aiken/primitive/bytearray
use cardano/address.{Address}
use magiclamp/airdrop/ledger.{ProofStep}

/// Prefix domain-separation.
pub const leaf_prefix: ByteArray = #"00"

pub const node_prefix: ByteArray = #"01"

/// Hash 1 leaf từ (address, amount). Khớp off-chain merkle.ts::leafHash.
pub fn leaf_hash(address: Address, amount: Int) -> ByteArray {
  let addr_bytes = cbor.serialise(address)
  let amount_bytes = bytearray.from_int_big_endian(amount, 8)
  let payload = bytearray.concat(addr_bytes, amount_bytes)
  blake2b_256(bytearray.concat(leaf_prefix, payload))
}

/// Hash 1 node nội = blake2b_256(node_prefix ++ left ++ right).
fn node_hash(left: ByteArray, right: ByteArray) -> ByteArray {
  blake2b_256(
    bytearray.concat(node_prefix, bytearray.concat(left, right)),
  )
}

/// Fold proof từ leaf lên: mỗi bước nối sibling theo is_left rồi hash.
pub fn root_from_proof(leaf: ByteArray, proof: List<ProofStep>) -> ByteArray {
  when proof is {
    [] -> leaf
    [step, ..rest] -> {
      let parent =
        if step.is_left {
          // sibling bên TRÁI → parent = hash(sibling | current)
          node_hash(step.hash, leaf)
        } else {
          // sibling bên PHẢI → parent = hash(current | sibling)
          node_hash(leaf, step.hash)
        }
      root_from_proof(parent, rest)
    }
  }
}

/// Verify: leaf(address,amount) + proof có dẫn tới root không.
pub fn verify_proof(
  root: ByteArray,
  address: Address,
  amount: Int,
  proof: List<ProofStep>,
) -> Bool {
  let leaf = leaf_hash(address, amount)
  root_from_proof(leaf, proof) == root
}

// ══════════════════════════════════════════════════════════════
// Unit tests — Merkle round-trip + reject
// ══════════════════════════════════════════════════════════════

fn t_addr(pkh: ByteArray) -> Address {
  Address {
    payment_credential: address.VerificationKey(pkh),
    stake_credential: None,
  }
}

// Cây 2 leaf: L0 = leaf(addrA, 100), L1 = leaf(addrB, 200). root = node(L0, L1).
test merkle_two_leaf_left() {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let l0 = leaf_hash(a, 100)
  let l1 = leaf_hash(b, 200)
  let root = node_hash(l0, l1)
  // proof cho L0: sibling L1 bên PHẢI (is_left=False).
  let proof = [ProofStep { is_left: False, hash: l1 }]
  verify_proof(root, a, 100, proof)
}

test merkle_two_leaf_right() {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let l0 = leaf_hash(a, 100)
  let l1 = leaf_hash(b, 200)
  let root = node_hash(l0, l1)
  // proof cho L1: sibling L0 bên TRÁI (is_left=True).
  let proof = [ProofStep { is_left: True, hash: l0 }]
  verify_proof(root, b, 200, proof)
}

test merkle_reject_wrong_amount() fail {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let l0 = leaf_hash(a, 100)
  let l1 = leaf_hash(b, 200)
  let root = node_hash(l0, l1)
  let proof = [ProofStep { is_left: False, hash: l1 }]
  // claim amount 999 thay vì 100 → leaf khác → root khác → False → fail.
  expect verify_proof(root, a, 999, proof)
  Void
}

test merkle_reject_wrong_address() fail {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let c = t_addr(#"c0")
  let l0 = leaf_hash(a, 100)
  let l1 = leaf_hash(b, 200)
  let root = node_hash(l0, l1)
  let proof = [ProofStep { is_left: False, hash: l1 }]
  // address C không có trong cây → fail.
  expect verify_proof(root, c, 100, proof)
  Void
}

test merkle_reject_tampered_proof() fail {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let l0 = leaf_hash(a, 100)
  let l1 = leaf_hash(b, 200)
  let root = node_hash(l0, l1)
  // sibling sai (#"dead" thay vì l1) → root sai → fail.
  let proof = [ProofStep { is_left: False, hash: #"dead" }]
  expect verify_proof(root, a, 100, proof)
  Void
}

// Cây 4 leaf: root = node( node(L0,L1), node(L2,L3) ). Proof cho L0 = [L1 phải, R23 phải].
test merkle_four_leaf() {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let c = t_addr(#"c0")
  let d = t_addr(#"d0")
  let l0 = leaf_hash(a, 10)
  let l1 = leaf_hash(b, 20)
  let l2 = leaf_hash(c, 30)
  let l3 = leaf_hash(d, 40)
  let left = node_hash(l0, l1)
  let right = node_hash(l2, l3)
  let root = node_hash(left, right)
  // L0: bước 1 sibling L1 phải; bước 2 sibling `right` phải.
  let proof =
    [
      ProofStep { is_left: False, hash: l1 },
      ProofStep { is_left: False, hash: right },
    ]
  verify_proof(root, a, 10, proof)
}

test merkle_four_leaf_inner() {
  let a = t_addr(#"a0")
  let b = t_addr(#"b0")
  let c = t_addr(#"c0")
  let d = t_addr(#"d0")
  let l0 = leaf_hash(a, 10)
  let l1 = leaf_hash(b, 20)
  let l2 = leaf_hash(c, 30)
  let l3 = leaf_hash(d, 40)
  let left = node_hash(l0, l1)
  let right = node_hash(l2, l3)
  let root = node_hash(left, right)
  // L2: bước 1 sibling L3 phải; bước 2 sibling `left` TRÁI.
  let proof =
    [
      ProofStep { is_left: False, hash: l3 },
      ProofStep { is_left: True, hash: left },
    ]
  verify_proof(root, c, 30, proof)
}

// PARITY (regression) — đối chiếu BYTE-PERFECT với off-chain merkle.ts::leafHash.
// Vector cố định: address = VerificationKey(28×0xa0, no stake), amount = 100 oil.
// Off-chain (Lucid Data.to(addressToPlutusData) + blake2b) cho RA CHÍNH hash này
// → khẳng định leaf encoding 2 phía khớp tuyệt đối (cbor address + amount_be8 + prefix).
// Nếu test này gãy: leaf encoding lệch → proof off-chain KHÔNG verify on-chain.
test parity_offchain_leaf() {
  let pkh =
    #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"
  let addr = t_addr(pkh)
  leaf_hash(addr, 100) == #"3aeee537bfa5dfeef78128313f5c92a052479458627b316d5f4452215181b6b8"
}
