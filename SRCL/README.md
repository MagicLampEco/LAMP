# SRCL — Reward-Redirect cho LAMP

> Tên canonical: **SRCL (Staking Reward Contribution Launch)** — phương thức launch đánh-đổi-nguồn-lực:
> delegator tự nguyện **chuyển hướng phần thưởng staking (ADA reward)** lấy token, vốn gốc bất khả xâm phạm
> on-chain, tuân thủ pháp lý (MiCA). Toàn module (thư mục + validator + type + NFT name) mang tên SRCL.

> ⚠️ **Cơ chế canonical = bản B** (đóng-góp-phần-thưởng, trustless). Tài liệu này mô tả **bản A**
> (chia LAMP **∝ stake**, 2 cty thu margin OFF-CHAIN, tin-operator) — biến thể vận-hành **cũ**.
> Nguồn sự thật cơ chế: [`SPEC/SRCL-Spec-Vi.md`](../SPEC/SRCL-Spec-Vi.md) + validator
> `srcl_stake.ak` (bản B): vốn gốc **bất khả xâm phạm on-chain**, LAMP chia **∝ phần thưởng đã
> đóng góp**. Phần **hạ tầng phân phối** dưới đây (`srcl_pool` — SetRoot/Claim/Sweep, Merkle,
> chống double-claim) **DÙNG CHUNG** cho cả A và B; chỉ **nguồn entitlement** khác (∝stake → ∝reward).
> Đọc mọi mô tả "∝ stake" / "native-margin" bên dưới như đặc tả **bản A**.

Module phân phối **360 triệu LAMP** (pot SRCL trong bảng 18-pot, `Specs/LAMP-POT-CATALOG.md`)
cho delegator của pool SRCL theo **tỷ lệ stake**, đều trong **36 epoch**
(**10 triệu LAMP/epoch** chẵn), bằng cơ chế Merkle distribution per-epoch.

---

## Cơ chế reward-redirect

SRCL (Staking Reward Contribution Launch) kiểu **reward-redirect**:

- Delegator ủy thác ADA vào pool SRCL do **2 công ty** vận hành.
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
TỔNG       = 360_000_000 LAMP × 10^6 = 3,6e14 oil
EPOCHS     = 36  (epoch 0..35)
budget_e   = 3,6e14 / 36 = 10_000_000_000_000 oil = 10.000.000 LAMP  (chia hết, dư 0)
entitlement_e[i] = floor( budget_e × stake_i / Σ stake )   (oil)
```

- Dư do `floor` (budget − Σ entitlement) → dồn cho ví **stake lớn nhất** (xác định,
  không mất oil). Tổng entitlement mỗi epoch == `budget_e` chính xác.
- Phần dư lẻ toàn cục `3,6e14 − 36 × budget_e` (= `REMAINDER_OIL`) gộp vào **epoch cuối**;
  với 360 triệu thì `REMAINDER_OIL = 0` (360M chia hết 36).
- Đơn vị: **oil** (1 LAMP = 10^6 oil), mọi số học BigInt.

---

## Kiến trúc on-chain

### `srcl_nft` (minting policy, param `genesis_ref`)

1 policy đúc 2 loại token (mẫu NFT-beacon như Faucet — **phá vòng hash-param chéo**):

- **POOL NFT** (`"SRCL"`, one-shot, qty 1) — nhận diện SRCL pool UTxO.
- **SLOT NFT** (name = `blake2b_256(epoch ‖ owner)`, qty 1) — **claim-slot** per
  `(epoch, owner)`: `SetRoot` đúc cả bộ và gửi vào registry, `Claim` tiêu + **đốt**.

### `srcl_pool` (spend, param `srcl_nft_policy`, `lamp_policy`, `lamp_name`, `admin`, `admin_threshold`, `slot_registry_hash`)

UTxO mang POOL NFT + kho LAMP + `SrclDatum`:

```
SrclDatum {
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
| `SetRoot{root}` | admin (≥ threshold) | append `root` vào `epoch_roots`; pool.value bảo toàn tuyệt đối; ≤ 36 root; bộ SLOT mới KHÔNG rò khỏi registry |
| `Claim{ClaimProof}` | delegator (permissionless) | Merkle verify `(epoch,owner,amount) ∈ epoch_roots[epoch]`; owner nhận `amount` LAMP; tiêu đúng 1 SLOT `(epoch,owner)` **từ registry** + đốt (qty −1); `distributed_total += amount`; pool − `amount` LAMP |
| `Sweep` | bất kỳ, sau `end_epoch` | `now > end_epoch`; toàn bộ LAMP dư → Treasury — ⚠️ **đang lỗi, xem S1 dưới** |

---

## Chống double-claim per `(epoch, addr)`

`slot_name = blake2b_256(epoch_be8 ‖ owner)` — **hàm thuần** của `(epoch, owner)`.

Mô hình **claim-slot spend-once** (KHÔNG còn dựa indexer off-chain):

- `SetRoot` epoch `e` đúc bộ slot `{(srcl_nft_policy, slot_name(e, owner)) : owner ∈ e}`
  và ép chúng nằm ở `Script(slot_registry_hash)` — slot không rò ra ví admin.
- `Claim` ép: tiêu **đúng 1** slot `(epoch, owner)` **từ registry** + **đốt** nó (`mint = −1`).

Slot tiêu 1 lần là hết ⇒ cặp `(epoch, owner)` không claim lại được. Tính duy-nhất dựa
**spend-once của ledger eUTXO**, độc lập indexer.

> **Giới hạn (đã ghi trong `srcl_pool.ak` §GIỚI HẠN):** on-chain KHÔNG kiểm được tên slot
> thuộc đúng epoch đang append (tên là hash, validator không có preimage). Admin đủ ngưỡng,
> nếu cấu kết, có thể đúc lại slot của epoch cũ đã đốt → mở lại double-claim epoch đó. Vậy
> chống double-claim ở mức **tin cậy admin-threshold**, không tuyệt đối. Test
> `setroot_remint_burned_slot_admin_trusted` ghim đúng giả định này.

---

## Chống các vector khác

- **Double-satisfaction**: đếm POOL NFT input/output == 1 (theo NFT authenticity, không
  theo full-address) → 2 pool input cùng script-hash khác stake-cred bị chặn.
- **Spoof own_ref**: ép `own_ref` trỏ đúng pool input mang POOL NFT.
- **Drain pool**: `pool_out.value == pool_in.value − amount LAMP` (value-eq tuyệt đối).
- ⚠️ **S1 — Sweep sớm: CHƯA chặn được (lỗi mở).** `util.get_epoch` trả **epoch POSIX
  tuyệt đối** (`lower_bound_ms / ms_per_epoch` ≈ **4132** ở thời điểm hiện tại), trong khi
  `end_epoch = 35` là epoch **tương đối của chiến dịch**. `4132 > 35` ⇒ cửa Sweep **mở ngay
  từ ngày đầu**, không cần chữ ký. Bất kỳ ai cũng đẩy sạch pot về `treasury_dest` → chiến
  dịch chết ở epoch 0 (không mất tiền — tiền về Treasury — nhưng delegator hết claim được).
  Test hiện có qua được chỉ vì fixture đặt `validity_range` theo epoch *tương đối*.
  **Cần sửa trước khi nạp LAMP thật vào pot.**
- **Cross-epoch replay**: `epoch` nhúng trong leaf + root mỗi epoch khác nhau → proof
  epoch `e` không dùng lại cho epoch khác.
- **Second-preimage Merkle**: domain tag `0x00` (leaf) / `0x01` (node).

---

## Off-chain SDK (`offchain/src/`)

| File | Vai trò |
|---|---|
| `constants.ts` | `SRCL_TOTAL_OIL=3,6e14`, `EPOCHS=36`, `PER_EPOCH_OIL`, `POOL_NFT_NAME`, … |
| `types.ts` | `SrclDatum`, `ClaimProof`, `MerkleStep`, `Entitlement`, `StakeEntry` |
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

`stake[addr]` của 1 epoch = ADA delegator ủy thác vào pool SRCL tại snapshot epoch đó.
Lấy từ **Blockfrost**:

- `GET /pools/{pool_id}/delegators` — delegator + live stake hiện tại.
- `GET /epochs/{number}/stakes/{pool_id}` — active stake theo epoch lịch sử.

Sau đó **resolve** `stake_address → payment-credential hash (pkh)` của ví nhận LAMP
(`owner` trong leaf). Việc resolve này là **chính sách 2 cty** (ví đăng ký nhận), KHÔNG
nằm trong contract. `snapshotTool` nhận sẵn list `{ owner(pkh), stake }` của mỗi epoch.

> **Điều kiện tham gia CHƯA được cài ở đâu.** Chủ trương: delegator có **≥ 1000 ADA** trong
> stake **và đã đăng ký** thì tham gia (KHÔNG bắt đặt cọc). Hiện `computeEntitlements` chỉ
> lọc `stake > 0` — không có ngưỡng 1000 ADA, không có danh sách đăng ký. Đây là **bộ lọc
> off-chain lúc snapshot**, phải cài ở tầng dựng `StakeEntry[]` trước khi vào `snapshotTool`.

---

## Chạy test

```bash
# On-chain (Aiken) — 55 test pass, 0 fail
cd SRCL/onchain && aiken check

# Off-chain (vitest) — 43 test pass (3 file)
cd SRCL/offchain && npm install && npx vitest run
```
