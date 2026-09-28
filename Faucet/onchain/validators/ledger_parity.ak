// Đối chiếu off-chain ↔ on-chain cho sổ `PoolDatum.opened_root` (INV-ONE-ACCT, v3.1).
//
// Mọi gốc và bằng chứng dưới đây do SDK off-chain sinh ra (`Faucet/offchain/src/
// openedLedger.ts`, thư viện JS `@aiken-lang/merkle-patricia-forestry` 1.3.1) và được ghim
// Y NGUYÊN ở ca vitest `Faucet/tests/openedLedger.test.ts` (`PARITY_STEPS`). Ở đây chúng được
// đưa qua CHÍNH phép tính validator chạy (`mpf.insert` / `mpf.delete` với `did_key` +
// `did_leaf_value`) và phải ra đúng gốc JS. Hai phía ghim cùng một bộ số ⇒ một bên đổi cách
// băm, cách mã hoá bằng chứng, hay cách dựng khoá là một trong hai bộ kiểm đỏ.
//
// Kịch bản (4 DID, đủ ba loại bước Branch · Fork · Leaf, có bằng chứng sâu 2 bước):
//   R0 = rỗng
//   R1 = R0 + a11ce0            bằng chứng []                 (ClaimOpen trên sổ rỗng)
//   R2 = R1 + b0b0b0            [Leaf]
//   R3 = R2 + d1d00b            [Leaf, Leaf skip 1]           (sâu 2: d1d00b chung nibble "d0" với b0b0b0)
//   R4 = R3 + c0ffee            [Branch]
//   R5 = R4 − b0b0b0            [Branch, Leaf skip 1]         (Reclaim, sâu 2)
//   R4 = R5 + b0b0b0            mở lại cùng DID ⇒ về ĐÚNG gốc R4
//   R6 = R3 − a11ce0            [Fork]
//   R0 = R1 − a11ce0            []                            (Reclaim trên sổ đúng một khoá)
//
// Tệp này chỉ chứa ca kiểm, không có validator ⇒ không đổi hash nào trong `plutus.json`.

use aiken/merkle_patricia_forestry as mpf
use magiclamp/faucet/ledger.{did_key, did_leaf_value, empty_opened_root}

const did_a: ByteArray = #"a11ce0"

const did_b: ByteArray = #"b0b0b0"

const did_c: ByteArray = #"c0ffee"

const did_d: ByteArray = #"d1d00b"

const root_0: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

const root_1: ByteArray =
  #"d17aaecb43b2f5229b3b163921eafc6f2c1af10ff102b6cd277869014038fd48"

const root_2: ByteArray =
  #"39aee9a9c9492c009a88558975464e83350db686ecb198c4278d5085f966d305"

const root_3: ByteArray =
  #"30f653bc7ab7e3a6b81cd15919b3e0149639c4da99a30b92780f1180642795b8"

const root_4: ByteArray =
  #"867a1716015707e1fc42e0084ec7eba77a62e26c483d3582ee10f74fc5b5c5ef"

const root_5: ByteArray =
  #"01e416575100d4079f95da707328e093e8bfb6f0f7e97de9f055368444f71de3"

const root_6: ByteArray =
  #"fc4b3b12c97d2bb3afecf0554c67f6e866f2e46eeec7506efd208fa1b930ff4f"

/// `blake2b_256(did_leaf_value)` — giá trị lá đã băm như thư viện đặt vào bước Leaf.
const leaf_value_hash: ByteArray =
  #"0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"

fn proof_insert_b() -> mpf.Proof {
  [
    mpf.Leaf {
      skip: 0,
      key: #"15d3c3ce67a0f09819f3b25fb056035b067ac44b4c2232f82c08ab47e824ca29",
      value: leaf_value_hash,
    },
  ]
}

fn proof_insert_d() -> mpf.Proof {
  [
    mpf.Leaf {
      skip: 0,
      key: #"15d3c3ce67a0f09819f3b25fb056035b067ac44b4c2232f82c08ab47e824ca29",
      value: leaf_value_hash,
    },
    mpf.Leaf {
      skip: 1,
      key: #"d0e16cfe782fcdebb70870590cf6f601a6ad9896850983ebeb559a12f77c8749",
      value: leaf_value_hash,
    },
  ]
}

fn proof_insert_c() -> mpf.Proof {
  [
    mpf.Branch {
      skip: 0,
      neighbors: #"f8dc35465d8fb8b0d20910b018dd9e7031bb59133ae0c2ec69098ad2619eae4585c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b10eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f9761804336a4123bb891ac3e26cce26e39ee47e9e79ae2110965962b571f46786c40",
    },
  ]
}

/// Bằng chứng của b0b0b0 trong R4 — dùng cho CẢ xoá (R4 → R5) lẫn chèn lại (R5 → R4):
/// bằng chứng MPF không phụ thuộc chính khoá được chứng minh, chỉ phụ thuộc láng giềng.
fn proof_b_in_r4() -> mpf.Proof {
  [
    mpf.Branch {
      skip: 0,
      neighbors: #"f8dc35465d8fb8b0d20910b018dd9e7031bb59133ae0c2ec69098ad2619eae4585c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b10eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f9761e9cbc5bc6a89e89ce8523ee14a0bcdd7a1c48ed253bc25519842a3a218835844",
    },
    mpf.Leaf {
      skip: 1,
      key: #"d020c99f467e8a5a000c6d0d55012ca281381969c7e8212e9a2c3a2229328ca3",
      value: leaf_value_hash,
    },
  ]
}

fn proof_a_in_r3() -> mpf.Proof {
  [
    mpf.Fork {
      skip: 0,
      neighbor: mpf.Neighbor {
        nibble: 13,
        prefix: #"00",
        root: #"b183c6e6a3f0804d71b7ab4e85fdeef4296a9538359387bd88a21980e4f1ade8",
      },
    },
  ]
}

fn ins(root: ByteArray, did: ByteArray, proof: mpf.Proof) -> ByteArray {
  mpf.insert(mpf.from_root(root), did_key(did), did_leaf_value, proof)
    |> mpf.root
}

fn del(root: ByteArray, did: ByteArray, proof: mpf.Proof) -> ByteArray {
  mpf.delete(mpf.from_root(root), did_key(did), did_leaf_value, proof)
    |> mpf.root
}

/// Gốc rỗng on-chain (`mpf.root(mpf.empty)`) = hằng `OPENED_ROOT_EMPTY` phía SDK. SDK không
/// lấy được hằng này từ thư viện JS (trie rỗng của nó có `hash === null`), nên bài này là
/// nơi DUY NHẤT xác nhận cầu nối `null` → 32 byte không.
test ledger_parity_empty_root() {
  empty_opened_root() == root_0
}

/// Chuỗi chèn từ sổ rỗng tới 4 khoá: mỗi gốc on-chain = gốc JS.
test ledger_parity_insert_chain() {
  and {
    ins(root_0, did_a, []) == root_1,
    ins(root_1, did_b, proof_insert_b()) == root_2,
    ins(root_2, did_d, proof_insert_d()) == root_3,
    ins(root_3, did_c, proof_insert_c()) == root_4,
  }
}

/// Thu hồi bằng bằng chứng sâu 2 bước (Branch + Leaf) rồi mở lại cùng DID ⇒ về đúng gốc cũ.
test ledger_parity_delete_then_reopen() {
  and {
    del(root_4, did_b, proof_b_in_r4()) == root_5,
    ins(root_5, did_b, proof_b_in_r4()) == root_4,
  }
}

/// Bước Fork (láng giềng duy nhất là một nút nhánh) + thu hồi trên sổ đúng một khoá.
test ledger_parity_fork_and_single() {
  and {
    del(root_3, did_a, proof_a_in_r3()) == root_6,
    del(root_1, did_a, []) == root_0,
  }
}

/// Đường phải-bị-từ-chối: chèn một khoá ĐÃ CÓ (b0b0b0 vào R4) — `mpf.insert` phải đánh
/// trượt vì gốc-không-có-khoá tính từ bằng chứng ≠ R4. Không có bài này thì bộ trên xanh
/// cả khi thư viện bỏ qua bước kiểm "chưa tồn tại".
test ledger_parity_insert_existing_fails() fail {
  ins(root_4, did_b, proof_b_in_r4()) == root_4
}

/// Đường phải-bị-từ-chối: xoá khoá KHÔNG có (b0b0b0 khỏi R5).
test ledger_parity_delete_missing_fails() fail {
  del(root_5, did_b, proof_b_in_r4()) == root_5
}
