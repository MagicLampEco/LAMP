// Merkle proof verify — hash-chain đơn giản (KHÔNG cần aiken stdlib MPF).
//
// FIRST-PRINCIPLES: airdrop snapshot CỐ ĐỊNH (tính 1 lần off-chain), KHÔNG cập
// nhật incremental → cây Merkle nhị phân thường (binary hash tree) là đủ, rẻ hơn
// Merkle-Patricia-Forestry (MPF dành cho map có insert/delete on-chain). Verify =
// fold proof từ leaf lên root, mỗi bước hash 2 con theo thứ tự (is_left).
//
// ─────────────────────────────────────────────────────────────────────────
// LEAF ENCODING — SCHEMA C (role-tag). PHẢI khớp byte-perfect off-chain merkle.ts
// và SCHEMA-MERKLE-V2-Tech-Spec.md §1.
//
//   leaf = blake2b_256(
//     0x00 ‖ campaign_id[32] ‖ epoch_be8[8] ‖ role[1] ‖ owner[28] ‖ amount_be8[8]
//   )                                    (payload trước hash = 78 byte)
//   node = blake2b_256( 0x01 ‖ left[32] ‖ right[32] )
//
//   - campaign_id[32] = blake2b_256(tên_chiến_dịch_utf8), bake PARAM validator →
//     cô lập proof theo chiến dịch (pot khác campaign KHÔNG chia sẻ leaf hợp lệ).
//   - epoch_be8       = epoch snapshot big-endian u64 (8 byte cố định).
//   - role[1]         = 1 byte vai (Delegator=0x01, MCS=0x02, Engage=0x03, SPO=0x04)
//     → cô lập proof theo vai trong cùng chiến dịch.
//   - owner[28]       = credential-hash (blake2b_224). Delegator = payment key-hash.
//   - amount_be8      = lượng oildrop (1 LAMP = 10^6 oildrop) big-endian u64.
//   Mọi trường fixed-width ⇒ nối thẳng (raw-concat) KHÔNG mập mờ biên (không cần
//   length-prefix). Domain-sep: leaf prefix 0x00, node prefix 0x01 → chống second-
//   preimage (kẻ tấn công không thể trình 1 node trung gian làm leaf).
// ─────────────────────────────────────────────────────────────────────────

use aiken/crypto.{blake2b_256}
use aiken/primitive/bytearray
use magiclamp/airdrop/ledger.{ProofStep}

/// Prefix domain-separation.
pub const leaf_prefix: ByteArray = #"00"

pub const node_prefix: ByteArray = #"01"

/// Hash 1 leaf schema C từ (campaign_id, epoch, role, owner, amount). Khớp
/// off-chain merkle.ts::leafHash. Không ràng độ dài từng trường on-chain (biên do
/// off-chain/builder giữ đúng width theo spec §1) — validator dựng owner từ
/// payment-cred (28 byte) + bake campaign_id/epoch/role nên byte layout tất định.
pub fn leaf_hash_v2(
  campaign_id: ByteArray,
  epoch: Int,
  role: Int,
  owner: ByteArray,
  amount: Int,
) -> ByteArray {
  let epoch_bytes = bytearray.from_int_big_endian(epoch, 8)
  let role_byte = bytearray.from_int_big_endian(role, 1)
  let amount_bytes = bytearray.from_int_big_endian(amount, 8)
  let payload =
    campaign_id
      |> bytearray.concat(epoch_bytes)
      |> bytearray.concat(role_byte)
      |> bytearray.concat(owner)
      |> bytearray.concat(amount_bytes)
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

/// Verify: leaf (ĐÃ tính schema C) + proof có dẫn tới root không. Caller tự dựng
/// leaf bằng leaf_hash_v2 rồi dùng CHÍNH leaf đó cho cả verify lẫn tên slot-NFT.
pub fn verify(root: ByteArray, leaf: ByteArray, proof: List<ProofStep>) -> Bool {
  root_from_proof(leaf, proof) == root
}

// ══════════════════════════════════════════════════════════════
// Unit tests — Merkle round-trip + reject (schema C)
// ══════════════════════════════════════════════════════════════

// Vector test dùng chung: campaign_id 32 byte mẫu, epoch 637, role 1 (Delegator).
const t_campaign: ByteArray =
  #"f5beb28d9ac6330b590fd5cc060d7e7fdbe2433130a4f1ffe93bb0deeb72db54"

const t_epoch: Int = 637

const t_role: Int = 1

fn t_leaf(owner: ByteArray, amount: Int) -> ByteArray {
  leaf_hash_v2(t_campaign, t_epoch, t_role, owner, amount)
}

// Cây 2 leaf: L0 = leaf(ownerA, 100), L1 = leaf(ownerB, 200). root = node(L0, L1).
test merkle_two_leaf_left() {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  // proof cho L0: sibling L1 bên PHẢI (is_left=False).
  let proof = [ProofStep { is_left: False, hash: l1 }]
  verify(root, l0, proof)
}

test merkle_two_leaf_right() {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  // proof cho L1: sibling L0 bên TRÁI (is_left=True).
  let proof = [ProofStep { is_left: True, hash: l0 }]
  verify(root, l1, proof)
}

test merkle_reject_wrong_amount() fail {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  let proof = [ProofStep { is_left: False, hash: l1 }]
  // claim amount 999 thay vì 100 → leaf khác → root khác → False → fail.
  expect verify(root, t_leaf(#"a0", 999), proof)
  Void
}

test merkle_reject_wrong_owner() fail {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  let proof = [ProofStep { is_left: False, hash: l1 }]
  // owner C không có trong cây → fail.
  expect verify(root, t_leaf(#"c0", 100), proof)
  Void
}

test merkle_reject_wrong_campaign() fail {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  let proof = [ProofStep { is_left: False, hash: l1 }]
  // CÙNG owner/amount NHƯNG campaign_id khác → leaf khác → cô lập chiến dịch.
  let other_campaign = #"deadbeef"
  let leaf_other = leaf_hash_v2(other_campaign, t_epoch, t_role, #"a0", 100)
  expect verify(root, leaf_other, proof)
  Void
}

test merkle_reject_wrong_role() fail {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  let proof = [ProofStep { is_left: False, hash: l1 }]
  // CÙNG campaign/owner/amount NHƯNG role khác (2 = MCS) → leaf khác → cô lập vai.
  let leaf_other = leaf_hash_v2(t_campaign, t_epoch, 2, #"a0", 100)
  expect verify(root, leaf_other, proof)
  Void
}

test merkle_reject_tampered_proof() fail {
  let l0 = t_leaf(#"a0", 100)
  let l1 = t_leaf(#"b0", 200)
  let root = node_hash(l0, l1)
  // sibling sai (#"dead" thay vì l1) → root sai → fail.
  let proof = [ProofStep { is_left: False, hash: #"dead" }]
  expect verify(root, l0, proof)
  Void
}

// Cây 4 leaf: root = node( node(L0,L1), node(L2,L3) ). Proof cho L0 = [L1 phải, R23 phải].
test merkle_four_leaf() {
  let l0 = t_leaf(#"a0", 10)
  let l1 = t_leaf(#"b0", 20)
  let l2 = t_leaf(#"c0", 30)
  let l3 = t_leaf(#"d0", 40)
  let left = node_hash(l0, l1)
  let right = node_hash(l2, l3)
  let root = node_hash(left, right)
  // L0: bước 1 sibling L1 phải; bước 2 sibling `right` phải.
  let proof =
    [
      ProofStep { is_left: False, hash: l1 },
      ProofStep { is_left: False, hash: right },
    ]
  verify(root, l0, proof)
}

test merkle_four_leaf_inner() {
  let l0 = t_leaf(#"a0", 10)
  let l1 = t_leaf(#"b0", 20)
  let l2 = t_leaf(#"c0", 30)
  let l3 = t_leaf(#"d0", 40)
  let left = node_hash(l0, l1)
  let right = node_hash(l2, l3)
  let root = node_hash(left, right)
  // L2: bước 1 sibling L3 phải; bước 2 sibling `left` TRÁI.
  let proof =
    [
      ProofStep { is_left: False, hash: l3 },
      ProofStep { is_left: True, hash: left },
    ]
  verify(root, l2, proof)
}

// PARITY (regression) — đối chiếu BYTE-PERFECT với off-chain merkle.ts + AffiSo
// reward-engine. Vector chuẩn SCHEMA-MERKLE-V2-Tech-Spec.md §5:
//   campaign_id = blake2b_256("LAMP-Delegator-Airdrop-1")
//   epoch = 637, role = 0x01 (Delegator), owner = 28×0xa0, amount = 27_780_000 oildrop
// Giá trị leaf + slot dưới đây do aiken TỰ tính (blake2b_256) — off-chain PHẢI khớp
// CHÍNH các hash này. Test gãy = leaf/slot encoding lệch → proof off-chain không
// verify on-chain (hoặc slot NFT name lệch → không consume được slot).
test parity_v2_leaf() {
  // campaign_id = blake2b_256(utf8 "LAMP-Delegator-Airdrop-1").
  let campaign_id =
    blake2b_256(#"4c414d502d44656c656761746f722d41697264726f702d31")
  expect
    campaign_id == #"f5beb28d9ac6330b590fd5cc060d7e7fdbe2433130a4f1ffe93bb0deeb72db54"
  let owner =
    #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"
  let leaf = leaf_hash_v2(campaign_id, 637, 1, owner, 27_780_000)
  // slot = blake2b_256(epoch_be8 ‖ owner).
  let epoch_be8 = bytearray.from_int_big_endian(637, 8)
  let slot = blake2b_256(bytearray.concat(epoch_be8, owner))
  and {
    leaf == #"5f254c5f27c62040e8b4e23793368afb807ccf58c0cd69fe681a358cca3b7cc7",
    slot == #"bfc18829cdf063850a82d88b5e8a6a8161fe480630a5d12c6381b657521ce45b",
  }
}
