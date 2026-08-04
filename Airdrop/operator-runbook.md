# TIGER Airdrop — Operator Runbook

Hướng dẫn đầy đủ để operator deploy và vận hành TIGER Airdrop từ đầu đến cuối.

---

## Tổng quan

> **Model 3-pot (chốt 2026-07-11):** tổng 120M LAMP = Delegator **100M** (∝stake, mọi pool) +
> SPO (Staking Pool Operator) **5M** (∝ Σ stake delegator đã đăng ký chảy vào pool) + CS (Community
> Supporter) **15M** (∝ Σ stake của delegator đã bình chọn; đo qua AffiSo). Cả hai ∝ trọng số stake.
> Đặc tả: `CONTRACT.md` (tổng) + `spo-cs.md` (SPO+CS).

```
Bước 1: Chọn cửa sổ snapshot → build snapshot delegator (∝stake, Blockfrost)
Bước 2: Collect SPO registrations → cổng đủ-điều-kiện (SPO 5M) + đo CS qua AffiSo (CS 15M)
Bước 3: Merge snapshot delegator + SPO/CS → final snapshot
Bước 4: Build Merkle tree + generate slot NFTs
Bước 5: Deploy Airdrop (compile Aiken, tạo genesis UTxO, SETUP tx)
Bước 6: Phân phối proof file cho người nhận (website/JSON API)
Bước 7: Monitor claim + sweep sau deadline
```

**Phụ thuộc:**
- Node.js ≥ 20
- Aiken ≥ 1.1.0 (để compile onchain)
- Blockfrost API key (Preview hoặc Mainnet)
- Ví operator có đủ ADA (SETUP tx tốn ~150 ADA min-ADA + phí)
- LAMP token (100M delegator + 5M SPO + 15M CS = 120M LAMP) trong ví operator

---

## Yêu cầu môi trường

Tạo `Airdrop/scripts/.env` (KHÔNG commit file này):

```env
# Network: Preview | Preprod | Mainnet
NETWORK=Preview

# Blockfrost project ID cho network trên
BLOCKFROST_KEY=previewXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX   # blockfrost.io — KHÔNG commit key thật

# Seed phrase ví operator (15 hoặc 24 từ)
WALLET_SEED="word1 word2 ... word15"

# Pool TIGER ID (bech32)
TIGER_POOL_ID=pool1xs2yx67vxuygadnjflj5u5dv6cqf6t0u6jke9z9jzj2svfuxmqq

# LAMP policy ID (sau khi deploy LAMP)
LAMP_POLICY_ID=

# LAMP asset name hex
LAMP_ASSET_NAME=744c414d50
```

---

## Bước 1: Build snapshot delegator

> ⚠️ Dùng `build_delegator_snapshot.ts` (v2). Bản cũ `build_airdrop_snapshot.ts` đã **DEPRECATED**:
> nó dựng lá Merkle từ `stake_address`, mà `claim` trả LAMP về địa chỉ dựng từ **payment key hash** —
> snapshot v1 tạo ra bản ghi **claim được nhưng không trả được tiền cho ai**. Đừng chạy cho phân phối thật.

```bash
cd Airdrop/scripts
npm install

# 1a. Verify đăng ký trước (3 lớp fail-closed: chữ ký Ed25519, pubkey↔stake khớp khai báo,
#     có lịch sử stake thật). Đầu ra là input bắt buộc của bước 1b.
npx tsx verify_delegator.ts --in registrations/ --out verified.json

# 1b. Dựng snapshot. `--excluded` FAIL-CLOSED: buộc chọn một trong hai, không có mặc định ngầm.
npx tsx build_delegator_snapshot.ts \
  --reg verified.json \
  --no-excluded \
  --n 2 \
  --e-open 620 \
  --e-cut 637 \
  --budget-lamp 100000000 \
  --out delegator_snapshot.json

# Xem tóm tắt
npx tsx check_airdrop.ts --snapshot delegator_snapshot.json --summary

# Xem top 20
npx tsx check_airdrop.ts --snapshot delegator_snapshot.json --top 20
```

Ba khác biệt so với v1, đều là lỗ đã vá: `owner` là **payment key hash** join từ đăng ký đã verify
(không phải `stake_address`) · cộng stake qua **mọi pool** theo `/accounts/{stake}/history`
(không chỉ một `--pool`) · chỉ tính epoch nằm trong chuỗi giữ delegation **≥N liên tiếp** (§1.5).
Cửa sổ phải thoả `E_cut − E_open ≥ N+1`, nếu không builder ném lỗi.

**Verify output:** file `delegator_snapshot.json` với trường `meta` + `entries[]`.

---

## Bước 2: Collect SPO registrations → SPO 5M + CS 15M

Xem `spo-registration.md` để hướng dẫn SPO operator, `spo-cs.md` cho công thức.

Model 3-pot: đăng ký SPO **không** còn chia theo stake. Hai phần:

- **SPO 5M** — chia ĐỀU cho mọi SPO qua **cổng đủ-điều-kiện** (đã sản xuất block ≥1 trong 5
  epoch, tuổi pool ≥3 epoch, pledge ≥ ngưỡng, dedupe owner, ký reward stake key). Mỗi SPO qua
  cổng = `5.000.000 / N` LAMP.
- **CS 15M** — theo điểm Community Supporter đo qua **AffiSo/ProofChat** (số DID được SPO
  mời thực delegate và giữ ≥2 epoch, hỗ trợ được-xác-nhận, giới thiệu, retention), log-dampen +
  water-filling + cổng kích hoạt. Tính bằng `cs_score.ts`, cần **DID sinh trắc**.

Sau khi nhận file `spo_registration.json` từ SPO:

```bash
# Xác minh chữ ký (manual với cardano-signer hoặc cardano-cli):
# 1. Reconstruct message (theo message trong spo_registration.json — do spo_register.ts sinh)
# 2. Verify signature vs publicKey vs message
# 3. Verify publicKey tương ứng reward stake address (bech32) của pool

# Áp cổng đủ-điều-kiện §3 (SPO-CS-SPEC) → danh sách N SPO hợp lệ.
# SPO 5M: chia ∝ Σ stake delegator đã đăng ký chảy vào pool (splitSpoPot → splitByStake).
# CS 15M: chạy cs_score.ts với metric CS xuất từ AffiSo → reward_i mỗi SPO.
# Gộp base + cs của mỗi SPO thành 1 entry {address = payment_address, amount_lamp}.
```

Phần SPO/CS hiện cần phối hợp **AffiSo (metric CS) + cs_score.ts**. Tool gộp tự động sẽ hoàn thiện sau.

---

## Bước 3: Merge snapshot cuối

Gộp `delegator_snapshot.json` (100M ∝stake) + entries SPO/CS (base 5M + CS 15M, mỗi SPO 1
entry `base + cs` gộp — xuất từ `cs_score.ts`):

```bash
# Merge bằng script nhỏ (Node.js). Mỗi SPO có amount_lamp riêng (KHÔNG phải 20M chia đều/∝stake):
node -e "
const d = JSON.parse(require('fs').readFileSync('delegator_snapshot.json','utf8'));
// spoCs[] xuất từ cs_score.ts: mỗi SPO qua cổng = { address: payment_address, amount_lamp: base+cs }
// Tổng Σ amount_lamp của spoCs = 5.000.000 (SPO) + 15.000.000 (CS) = 20.000.000 LAMP.
const spoCs = JSON.parse(require('fs').readFileSync('spo_cs_snapshot.json','utf8'));
const entries = [
  ...d.entries.map(e => ({ address: e.address, amount: BigInt(e.amount_oildrop).toString() })),
  ...spoCs.map(e => ({ address: e.address, amount: (BigInt(e.amount_lamp) * 1_000_000n).toString() }))
];
require('fs').writeFileSync('final_snapshot.json', JSON.stringify(entries, null, 2));
console.log('Entries:', entries.length);
"
```

Format `final_snapshot.json` dùng cho `snapshotTool.parseSnapshot()`:
```json
[
  { "address": "stake1...", "amount": "100000000000000" },
  ...
]
```

---

## Bước 4: Build Merkle tree

```typescript
// Trong deploy script của anh (hoặc thêm vào demo_airdrop.ts):
import { buildSnapshotTree, exportClaims } from "../offchain/src/snapshotTool.js";
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("final_snapshot.json", "utf8"));
const tree = buildSnapshotTree(rows, { amountField: "amount", isOildrop: true });

console.log("Merkle root:", tree.root);
console.log("Entries:", tree.entries.length);

// Export claim proofs (file này cấp cho delegator qua API/website)
const claims = exportClaims(tree);
writeFileSync("claims.json", JSON.stringify(claims, null, 2));
```

---

## Bước 5: Deploy Airdrop

### 5a. Compile Aiken validators

```bash
cd Airdrop/onchain
aiken build
# → tạo plutus.json
```

### 5b. Chọn genesis UTxO

```bash
# Lấy danh sách UTxO của ví operator
npx tsx _balcheck.ts   # (hoặc xem ví trong Lace/Eternl)
# Chọn 1 UTxO bất kỳ làm genesis_ref (sẽ bị tiêu trong SETUP)
```

### 5c. Tính validator addresses

```typescript
// Trong deploy script (xem demo_airdrop.ts để tham khảo):
// 1. apply airdrop_nft policy với genesis_ref → policyId
// 2. apply airdrop_pool với (policyId, lamp_policy, lamp_name, ms_per_epoch)
// 3. apply airdrop_marker với (policyId)
// → pool_address, marker_address
```

### 5d. Chạy SETUP transaction

Nếu snapshot ≤ ~50 entries: 1 tx SETUP dùng `buildDeployTx()`.
Nếu snapshot > 50 entries: multi-tx dùng `buildSetupSlotBatchTx()`.

```bash
# Xem demo_airdrop.ts để chạy full flow
# Cập nhật ENV_PATH trước (xem lưu ý bên dưới)
npx tsx demo_airdrop.ts
```

**Lưu ý ENV_PATH:** `demo_airdrop.ts` hiện có hardcode path cũ. Sửa trước khi chạy:

```typescript
// Dòng ~15 của demo_airdrop.ts:
// const ENV_PATH = "/Users/ductiger/Projects/LAMP-launch-wt/.env";  // CŨ
const ENV_PATH = new URL(".env", import.meta.url).pathname;         // MỚI
```

### 5e. Verify SETUP

```bash
# Kiểm tra POOL NFT đã mint:
# Blockfrost: /assets/{policyId}41504f4f4c/transactions (APOOL)
# hoặc dùng cardanoscan.io

# Kiểm tra claim-slot NFTs đang ở marker_address:
# cardanoscan.io → address → UTxOs
```

---

## Bước 6: Phân phối proof file

Sau SETUP, delegator cần:
1. `claims.json` — file chứa Merkle proof cho từng địa chỉ
2. Pool address và airdrop NFT policy ID
3. Merkle root để tự verify

Phân phối qua:
- Website magiclamp.network/airdrop (API endpoint `/proof/{stake_address}`)
- GitHub release (public JSON)

---

## Bước 7: Monitor + Sweep

```bash
# Theo dõi số lượng claim:
# Đọc claimed_count từ datum của POOL UTxO
# cardanoscan.io → contract address → datum → claimed_count field

# Sweep sau deadline (permissionless — bất kỳ ai cũng chạy được):
# Xem sweepBuilder.ts để build tx
# validFromMs = (deadline_epoch × ms_per_epoch) + buffer
```

---

## Checklist trước khi go-live

- [ ] Snapshot đã verify: tổng = 100M (Delegator) + 5M (SPO) + 15M (CS) = 120M LAMP — cả 3 ∝ trọng số stake
- [ ] Merkle root đã công bố công khai trước SETUP
- [ ] Aiken validators đã compile: `Airdrop/onchain/plutus.json` tồn tại
- [ ] Ví operator có đủ ADA (≥ 200 ADA buffer) + đủ LAMP (120M + 10M dự phòng phí)
- [ ] Genesis UTxO đã chọn (chưa bị tiêu)
- [ ] SETUP authority token sẽ bị BURN ngay sau khi tất cả slots được mint
- [ ] Claims.json đã chuẩn bị, API hoặc release đã lên kế hoạch
- [ ] Sweep date đã thông báo (epoch deadline)
- [ ] ENV_PATH trong demo_airdrop.ts đã cập nhật đúng

---

## Xử lý sự cố thường gặp

**SETUP tx fail: "UTxO not found"**
→ Genesis UTxO đã bị tiêu. Chọn UTxO khác, tính lại addresses (genesis_ref thay đổi = addresses thay đổi).

**Claim fail: "slot UTxO not found at marker_address"**
→ Slot chưa được mint đủ. Kiểm tra SETUP đã hoàn thành toàn bộ hay chưa (multi-tx case).

**Claim fail: "Merkle proof invalid"**
→ Claims.json không khớp snapshot đã dùng để SETUP. Verify merkle_root trong datum pool.

**Blockfrost 429**
→ Config.ts đã có retry tự động (1.2s × attempt). Nếu vẫn fail, tăng `attempt < 6` lên 10.
