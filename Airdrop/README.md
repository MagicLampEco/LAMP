# Airdrop — Merkle-airdrop (bộ máy on-chain dùng chung)

> **MODEL HIỆN HÀNH = v2 (chốt 2026-07-10).** Đặc tả tổng: **`AIRDROP-V2-SPEC-Vi.md`**.
> Airdrop v2 = **120 triệu LAMP**, chia 3 pot (Delegator · SPO · CS) dưới **cùng** bộ máy Merkle-airdrop dưới đây:
> - **Pot Delegator = 100M LAMP** — delegator **PHẢI ĐĂNG KÝ** (ký reward stake key), thưởng
>   **∝stake ở bất kỳ pool Cardano**, cửa sổ snapshot mới, giữ ≥ N epoch. Xem `AIRDROP-V2-SPEC-Vi.md` §1.
> - **Pot SPO/CS = 20M LAMP** = **SPO (Staking Pool Operator) 5M** (tư cách pool hợp lệ, chia
>   đều) + **CS (Community Supporter) 15M** (đo qua AffiSo, cần DID) — KHÔNG theo stake. Xem
>   `SPO-CS-SPEC-Vi.md`.
>
> **ĐỪNG NHẦM với ETD** (module `TIGER/`): ETD = pot RIÊNG 12M, hồi tố, **chỉ pool TIGER**,
> KHÔNG đăng ký. Bảng phân biệt: `AIRDROP-V2-SPEC-Vi.md` §3.
>
> Phần dưới mô tả **cơ chế on-chain dùng chung** (pool NFT + CLAIM marker nullifier +
> Sweep→Treasury + leaf encoding byte-perfect). v2 tái dùng nguyên, KHÔNG viết validator mới.
> Ghi chú lịch sử: đoạn văn dưới nêu con số 100M/pool TIGER là mô tả bản v1 gốc; số/đối tượng
> hiệu lực lấy theo `AIRDROP-V2-SPEC-Vi.md`.

Bộ máy Merkle-airdrop dùng chung: mỗi địa chỉ/DID claim đúng phần snapshot của mình bằng chứng
minh Merkle, **không double-claim**; phần dư không ai claim hoàn về **Treasury**.

Số lượng và đối tượng của từng pot lấy theo `AIRDROP-V2-SPEC-Vi.md` (Delegator 100M + SPO/CS 20M
= **120 triệu LAMP**) và `SPO-CS-SPEC-Vi.md`. Đơn vị: **1 LAMP = 10⁶ oildrop**.

---

## 1. Cơ chế (Merkle-airdrop chuẩn)

```
Snapshot {address, amount}  ──►  cây Merkle  ──►  merkle_root
   (off-chain, tất định)                              │
                                                      ▼
                              datum AirdropPool đặt trên POOL UTxO
                              { merkle_root, deadline_epoch,
                                treasury_dest, marker_dest, claimed_count }
```

- **POOL UTxO** mang: `APOOL` NFT (one-shot beacon) + kho LAMP + datum `AirdropPool`.
- **Claim**: claimer trình Merkle proof `(address, amount, proof)`. Validator verify
  proof dẫn tới `merkle_root` → nhả đúng `amount` LAMP cho địa chỉ claimer, đúc 1
  **CLAIM marker NFT** (name = leaf) làm nullifier.
- **Sweep**: sau `deadline_epoch` → toàn bộ LAMP dư về `treasury_dest`. Permissionless.

### Leaf encoding (byte-perfect 2 phía)

```
leaf = blake2b_256( 0x00 ++ cbor.serialise(address) ++ amount_be8 )
node = blake2b_256( 0x01 ++ left ++ right )
```

- `cbor.serialise(address)`: Plutus-Data canonical CBOR của Aiken `Address` Constr.
  Off-chain dựng cùng cây Data (`Data.to(addressToPlutusData)`) → **cùng bytes**.
- `amount_be8`: amount (oil) big-endian 8 byte (u64) — cố định độ dài, chống nhập nhằng.
- Prefix `0x00` (leaf) / `0x01` (node): **domain-separation** chống second-preimage.

> Parity được khoá bằng 1 vector regression ở **cả** `onchain/.../merkle.ak`
> (`parity_offchain_leaf`) **và** `offchain/tests/merkle.test.ts`:
> `leaf(28×0xa0, 100) = 3aeee537…b6b8`. Nếu một phía đổi encoding, test gãy ngay.

### Cây Merkle nhị phân thường (KHÔNG MPF)

Snapshot CỐ ĐỊNH (tính 1 lần off-chain, không insert/delete on-chain) → cây nhị phân
hash-chain là đủ và rẻ hơn Merkle-Patricia-Forestry. Node lẻ cuối tầng → **carry** lên
nguyên vẹn (không tự-hash) để off-chain/on-chain nhất quán. Snapshot được **sort theo
leaf hash** → root tất định, không phụ thuộc thứ tự nhập.

---

## 2. Chống double-claim — CLAIM-marker NFT làm nullifier

**Cơ chế đã chọn:** mỗi leaf (= `hash(address|amount)`) có **1 CLAIM marker NFT**
`name = leaf`, đúc lúc Claim và gửi vào `marker_dest` — một **script KHÔNG có spend
path** → marker bị **khóa vĩnh viễn** = nullifier bất biến.

```
Claim(leaf):  mint CLAIM(name=leaf, +1)  ──►  marker_dest (no-spend script)
              pool nhả đúng `amount` LAMP, claimed_count += 1
```

**Lý do chọn marker-NFT thay nullifier-set / accumulator trong datum:**

1. **Song song hoá** (eUTXO first-principles): pool permissionless, NHIỀU claimer
   cùng lúc. Nếu nullifier nằm trong datum pool (accumulator) → mỗi claim phải spend
   pool tuần tự → 1 claim/block → nghẽn cổ chai. Marker NFT cho phép claim **song song**:
   mỗi tx đúc marker riêng, không khóa pool theo thứ tự (pool vẫn single-thread cho phần
   trừ LAMP, nhưng marker là bằng chứng claim độc lập per-leaf).
2. **Nullifier bền, không cần global-scan** (vốn bất khả thi trong eUTXO): marker khóa
   ở script no-spend → tồn tại vĩnh viễn → indexer luôn thấy → off-chain từ chối build
   claim thứ 2 cho cùng leaf.
3. **Bảo toàn cung tuyệt đối**: pool chỉ nhả đúng `amount` mỗi marker MỚI đúc; marker
   policy ép `name == leaf` + `qty == +1` + KHÔNG đụng POOL NFT.

### GHI CHÚ REPLAY (giới hạn đã biết + cách bịt)

Ledger Cardano **không** cấm đúc lại 1 token cùng `(policy, name)` ở giao dịch sau —
nên về lý thuyết kẻ tấn công có thể submit tx claim thứ 2 cho cùng leaf nếu nó tự build.
Hai lớp chặn:

- **Lớp indexer/off-chain (thực thi):** `claimBuilder` (và frontend) PHẢI kiểm marker
  `(policy, leaf)` chưa tồn tại trước khi build. Marker khóa vĩnh viễn → kiểm tra này
  tin cậy.
- **Lớp on-chain trustless (khuyến nghị production):** nâng `marker_dest` thành validator
  có spend-path **luôn `fail`**, và bổ sung ràng buộc "không input/reference nào mang
  CLAIM(leaf)" — biến marker thành nullifier cưỡng chế hoàn toàn on-chain. Bản hiện tại
  ép **đúc + khóa** marker (đủ cho launch có indexer kiểm soát build); phần cưỡng chế
  reference-input để mở rộng sau, KHÔNG đụng interface datum.

> Đây là đánh đổi có chủ đích: ưu tiên **song song + đơn giản + bảo toàn cung** cho
> launch, ghi rõ điểm cấn để hậu kiểm. Xem `onchain/.../ledger.ak` mục CHỐNG DOUBLE-CLAIM.

---

## 3. Cửa sổ claim 360 epoch + Sweep → Treasury

- `deadline_epoch` (datum) = **epoch(29/7) + 360**. Tính từ POSIX-ms validity_range.
- **Claim** ép `upper_bound_epoch < deadline_epoch` (cận TRÊN) → claimer chỉ claim khi
  **CHẮC CHẮN** còn trong hạn (an toàn: node đã xác thực khoảng [lower, upper]).
- **Sweep** ép `lower_bound_epoch ≥ deadline_epoch` (cận DƯỚI) → chỉ quét khi **CHẮC
  CHẮN** đã quá hạn. Toàn bộ LAMP dư (kể cả 0) → `treasury_dest`. Permissionless.

---

## 4. Cấu trúc

```
Airdrop/
├── onchain/
│   ├── aiken.toml
│   ├── lib/magiclamp/airdrop/
│   │   ├── ledger.ak     # types + constants (AirdropPool, AirdropRedeemer, ProofStep)
│   │   ├── merkle.ak     # leaf/node hash + verify_proof + parity regression
│   │   └── util.ak       # NFT-beacon + double-sat guards + epoch + test builders
│   └── validators/
│       ├── airdrop_nft.ak    # mint policy one-shot POOL NFT + CLAIM marker
│       └── airdrop_pool.ak   # spend: Claim (Merkle-gated) + Sweep (sau deadline)
└── offchain/
    ├── src/
    │   ├── constants.ts      # AIRDROP_TOTAL_OIL, CLAIM_WINDOW_EPOCHS, names, ms/epoch
    │   ├── types.ts          # SnapshotEntry, ProofStep, AirdropPool, MerkleTree
    │   ├── merkle.ts         # dựng cây + proof + leaf encoding (byte-perfect)
    │   ├── datum.ts          # codec datum/redeemer (Plutus Data)
    │   ├── snapshotTool.ts   # {address,amount} → root + exportClaims
    │   ├── claimBuilder.ts   # lucid-evolution: build tx Claim
    │   └── sweepBuilder.ts   # lucid-evolution: build tx Sweep
    └── tests/                # merkle round-trip, datum codec, claim logic
```

---

## 5. Kiến trúc NFT-beacon (phá vòng hash-param chéo)

1 minting policy `airdrop_nft(genesis_ref)` đúc 2 loại token: **POOL NFT** (`APOOL`,
one-shot) + **CLAIM marker** (name = leaf). `airdrop_pool` chỉ tham chiếu
`airdrop_nft_policy` (1 param chung) — KHÔNG ôm script-hash chéo → KHÔNG vòng tròn
(bài học Faucet/Allocation). `MintClaim` ủy quyền cho pool: "có POOL NFT input ⇒ pool
validator đã chạy + kiểm proof".

---

## 6. Chạy test

```bash
# Onchain — 47 checks PASS (đo 2026-07-29)
cd Airdrop/onchain && aiken check

# Offchain — 65 tests PASS (đo 2026-07-29)
cd Airdrop/offchain && npm install && npx vitest run
```

**Bất biến chính:** bảo toàn cung LAMP (Claim nhả đúng amount; Sweep dồn dư về
Treasury), chống double-satisfaction (đếm POOL/treasury theo NFT + script-hash),
chống double-claim (CLAIM marker nullifier), khóa cửa sổ 360 epoch.
