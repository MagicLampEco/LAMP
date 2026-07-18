# SRCL — Reward-Redirect cho LAMP

> Tên hiển thị canonical: **SRCL (Staking Reward Contribution Launch)**. Thư mục/code module
> giữ tên `ISPO` (cố ý, để lịch sử git rõ) — cùng một cơ chế.

> ⚠️ **Cơ chế canonical = bản B** (đóng-góp-phần-thưởng, trustless). Tài liệu này mô tả **bản A**
> (chia LAMP **∝ stake**, 2 cty thu margin OFF-CHAIN, tin-operator) — biến thể vận-hành **cũ**.
> Nguồn sự thật cơ chế: [`SPEC/SRCL-Spec-Vi.md`](../SPEC/SRCL-Spec-Vi.md) + validator
> `srcl_stake.ak` (bản B): vốn gốc **bất khả xâm phạm on-chain**, LAMP chia **∝ phần thưởng đã
> đóng góp**. Phần **hạ tầng phân phối** dưới đây (`ispo_pool` — SetRoot/Claim/Sweep, Merkle,
> chống double-claim) **DÙNG CHUNG** cho cả A và B; chỉ **nguồn entitlement** khác (∝stake → ∝reward).
> Đọc mọi mô tả "∝ stake" / "native-margin" bên dưới như đặc tả **bản A**.

Module phân phối **1 tỷ LAMP** cho delegator của pool ISPO theo **tỷ lệ stake**, đều
trong **36 epoch** (~27,78 triệu LAMP/epoch), bằng cơ chế Merkle distribution per-epoch.

---

## Cơ chế reward-redirect

SRCL (Staking Reward Contribution Launch) kiểu **reward-redirect**:

- Delegator ủy thác ADA vào pool ISPO do **2 công ty** vận hành.
- Reward ADA (margin) của các epoch **do 2 cty thu** (đây là "redirect").
- ĐỔI LẠI, delegator nhận **LAMP** theo tỷ lệ stake, mỗi epoch.

### Phần OFF-CHAIN (thao tác 2 cty — KHÔNG nằm trong contract)

- Vận hành node SPO, đăng ký pool, giữ pledge.
- **Thu reward ADA** mỗi epoch (margin/fix-fee theo cấu hình pool).
- **Snapshot stake** mỗi epoch (xem "Nguồn stake" bên dưới).

### Phần ON-CHAIN (module này build)

Cơ chế **phân phối LAMP cho delegator theo snapshot stake mỗi epoch**:

1. Mỗi epoch `e` (0..35): snapshot stake → tính `entitlement_e[addr]` → dựng cây
   Merkle → `root_e`.
2. Admin nạp `root_e` vào pool (redeemer `SetRoot`).
3. Delegator tự **Claim** LAMP của mình ở epoch `e` bằng Merkle proof (permissionless).
4. Sau epoch 36, LAMP dư được **Sweep về Treasury**.

---

## Toán phân phối (tất định, tỷ lệ stake)

```
TỔNG       = 1_000_000_000 LAMP × 10^6 = 1e15 oil
EPOCHS     = 36  (epoch 0..35)
budget_e   = floor(1e15 / 36) = 27_777_777_777_777 oil  ≈ 27.777.777,78 LAMP
entitlement_e[i] = floor( budget_e × stake_i / Σ stake )   (oil)
```

- Dư do `floor` (budget − Σ entitlement) → dồn cho ví **stake lớn nhất** (xác định,
  không mất oil). Tổng entitlement mỗi epoch == `budget_e` chính xác.
- Phần dư lẻ toàn cục `1e15 − 36 × budget_e` (= `REMAINDER_OIL`) gộp vào **epoch cuối**.
- Đơn vị: **oil** (1 LAMP = 10^6 oil), mọi số học BigInt.

---

## Kiến trúc on-chain

### `ispo_nft` (minting policy, param `genesis_ref`)

1 policy đúc 2 loại token (mẫu NFT-beacon như Faucet — **phá vòng hash-param chéo**):

- **POOL NFT** (`"ISPO"`, one-shot, qty 1) — nhận diện ISPO pool UTxO.
- **MARKER NFT** (name = `blake2b_256(epoch ‖ owner)`, qty 1) — biên-lai claim per
  `(epoch, owner)`.

### `ispo_pool` (spend, param `ispo_nft_policy`, `lamp_policy`, `lamp_name`, `admin`, `admin_threshold`)

UTxO mang POOL NFT + kho LAMP + `IspoDatum`:

```
IspoDatum {
  epoch_roots:       List<ByteArray>,  // root_e theo epoch (index = epoch)
  distributed_total: Int,              // oil đã phát (sổ kế toán)
  end_epoch:         Int,              // = 35
  treasury_dest:     ByteArray,        // payment-cred Treasury (đích Sweep)
  ms_per_epoch:      Int,
}
```

3 redeemer:

| Redeemer | Ai | Ràng buộc chính |
|---|---|---|
| `SetRoot{root}` | admin (≥ threshold) | append `root` vào `epoch_roots`; pool.value bảo toàn tuyệt đối; ≤ 36 root |
| `Claim{ClaimProof}` | delegator (permissionless) | Merkle verify `(epoch,owner,amount) ∈ epoch_roots[epoch]`; owner nhận `amount` LAMP; đúc đúng 1 MARKER tới owner; `distributed_total += amount`; pool − `amount` LAMP |
| `Sweep` | bất kỳ, sau `end_epoch` | `now > end_epoch`; toàn bộ LAMP dư → Treasury |

---

## Chống double-claim per `(epoch, addr)`

`marker_name = blake2b_256(epoch_be8 ‖ owner)` — **hàm thuần** của `(epoch, owner)`.

`Claim` ép:
- đúc **đúng 1** `(ispo_nft_policy, marker_name)` qty 1,
- marker gửi **tới ví owner**,
- name gắn chặt `epoch + owner` (1 cặp → 1 name).

Mỗi cặp `(epoch, owner)` có biên-lai marker duy nhất. Đây là **mẫu marker chuẩn của
airdrop**: chốt chặn double-claim toàn cục dựa trên **indexer off-chain từ chối ký lại**
khi marker `(epoch, owner)` đã tồn tại ở ví owner. Tầng on-chain ép tính toàn vẹn của
marker (name đúng, qty 1, đúng người nhận) + bảo toàn value pool, nên không thể rút quá
`amount` đã được Merkle root cam kết.

> Lưu ý kỹ thuật eUTXO: ledger Cardano cho phép re-mint cùng một asset name, nên chốt
> chặn "1 lần duy nhất" toàn cục là trách nhiệm của indexer off-chain (chuẩn airdrop).
> Nếu cần bất biến on-chain tuyệt đối, nâng cấp: đưa marker vào một **registry script
> bất tử** (spend luôn `fail`) — đã chừa đường mở rộng, không đổi interface datum.

---

## Chống các vector khác

- **Double-satisfaction**: đếm POOL NFT input/output == 1 (theo NFT authenticity, không
  theo full-address) → 2 pool input cùng script-hash khác stake-cred bị chặn.
- **Spoof own_ref**: ép `own_ref` trỏ đúng pool input mang POOL NFT.
- **Drain pool**: `pool_out.value == pool_in.value − amount LAMP` (value-eq tuyệt đối).
- **Sweep sớm**: `now` lấy từ `validity_range.lower_bound` (cận dưới) → chỉ quét khi
  CHẮC CHẮN `now > end_epoch`.
- **Cross-epoch replay**: `epoch` nhúng trong leaf + root mỗi epoch khác nhau → proof
  epoch `e` không dùng lại cho epoch khác.
- **Second-preimage Merkle**: domain tag `0x00` (leaf) / `0x01` (node).

---

## Off-chain SDK (`offchain/src/`)

| File | Vai trò |
|---|---|
| `constants.ts` | `ISPO_TOTAL_OIL=1e15`, `EPOCHS=36`, `PER_EPOCH_OIL`, `POOL_NFT_NAME`, … |
| `types.ts` | `IspoDatum`, `ClaimProof`, `MerkleStep`, `Entitlement`, `StakeEntry` |
| `datum.ts` | codec Plutus Data **byte-perfect** với onchain |
| `merkle.ts` | blake2b-256 (`@noble/hashes`), `MerkleTree`, proof — khớp onchain |
| `snapshotTool.ts` | stake list → entitlement per epoch → roots |
| `claimBuilder.ts` | dựng tx Claim (lucid-evolution) |
| `sweepBuilder.ts` | dựng tx Sweep → Treasury |
| `index.ts` | public exports |

Cây Merkle off-chain ↔ on-chain được **đối chiếu byte-perfect** bằng vector cố định
(test `*_matches_offchain_vector` trong `merkle.ak`).

---

## Nguồn stake (điểm cấn)

`stake[addr]` của 1 epoch = ADA delegator ủy thác vào pool ISPO tại snapshot epoch đó.
Lấy từ **Blockfrost**:

- `GET /pools/{pool_id}/delegators` — delegator + live stake hiện tại.
- `GET /epochs/{number}/stakes/{pool_id}` — active stake theo epoch lịch sử.

Sau đó **resolve** `stake_address → payment-credential hash (pkh)` của ví nhận LAMP
(`owner` trong leaf). Việc resolve này là **chính sách 2 cty** (ví đăng ký nhận), KHÔNG
nằm trong contract. `snapshotTool` nhận sẵn list `{ owner(pkh), stake }` của mỗi epoch.

---

## Chạy test

```bash
# On-chain (Aiken) — 42 checks, 0 errors
cd ISPO/onchain && aiken check

# Off-chain (vitest) — 42 tests
cd ISPO/offchain && npm install && npx vitest run
```
