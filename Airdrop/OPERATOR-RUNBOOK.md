# TIGER Airdrop — Operator Runbook

Hướng dẫn đầy đủ để operator deploy và vận hành TIGER Airdrop từ đầu đến cuối.

---

## Tổng quan

```
Bước 1: Chọn epoch snapshot → build snapshot (Blockfrost)
Bước 2: Collect SPO registrations (20M phần SPO)
Bước 3: Merge snapshot delegator + SPO → final snapshot
Bước 4: Build Merkle tree + generate slot NFTs
Bước 5: Deploy Airdrop (compile Aiken, tạo genesis UTxO, SETUP tx)
Bước 6: Phân phối proof file cho delegator (website/JSON API)
Bước 7: Monitor claim + sweep sau deadline
```

**Phụ thuộc:**
- Node.js ≥ 20
- Aiken ≥ 1.1.0 (để compile onchain)
- Blockfrost API key (Preview hoặc Mainnet)
- Ví operator có đủ ADA (SETUP tx tốn ~150 ADA min-ADA + phí)
- LAMP token (100M + 20M = 120M LAMP) trong ví operator

---

## Yêu cầu môi trường

Tạo `Airdrop/scripts/.env` (KHÔNG commit file này):

```env
# Network: Preview | Preprod | Mainnet
NETWORK=Preview

# Blockfrost project ID cho network trên
BLOCKFROST_KEY=previewXiSuNb7gzGiR3zgkC8fm07jqaPcmJR0t

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

```bash
cd Airdrop/scripts
npm install

# Chọn epoch snapshot — epoch đã qua, có đủ dữ liệu trên Blockfrost
# Ví dụ: 3 epoch liên tiếp
npx tsx build_airdrop_snapshot.ts \
  --epoch 580 \
  --epoch 581 \
  --epoch 582 \
  --pool pool1xs2yx... \
  --budget 100000000 \
  --out delegator_snapshot.json

# Xem tóm tắt
npx tsx check_airdrop.ts --snapshot delegator_snapshot.json --summary

# Xem top 20
npx tsx check_airdrop.ts --snapshot delegator_snapshot.json --top 20
```

**Verify output:** file `delegator_snapshot.json` với trường `meta` + `entries[]`.

---

## Bước 2: Collect SPO registrations

Xem `SPO-REGISTRATION.md` để hướng dẫn SPO operator.

Sau khi nhận file `spo_registration.json` từ SPO:

```bash
# Xác minh chữ ký (manual với cardano-signer hoặc cardano-cli):
# 1. Reconstruct message:
#    TIGER-AIRDROP-SPO-REGISTRATION:pool_id:<pool_id>:payment_address:<payment_address>
# 2. Verify signature vs publicKey vs message
# 3. Verify publicKey tương ứng stake address (bech32)

# Sau khi xác minh, tạo spo_snapshot.json thủ công:
# [
#   { "address": "addr1q... (payment_address của SPO)", "amount_lamp": "20000000" }
# ]
```

Phần SPO hiện cần xử lý **thủ công** (20M LAMP). Tool tự động sẽ có ở phiên bản sau.

---

## Bước 3: Merge snapshot cuối

Gộp `delegator_snapshot.json` + SPO entries thủ công:

```bash
# Merge bằng script nhỏ (Node.js):
node -e "
const d = JSON.parse(require('fs').readFileSync('delegator_snapshot.json','utf8'));
const spo = [
  { address: 'addr1q...spo_payment_address...', amount_lamp: '20000000' }
];
const entries = [
  ...d.entries.map(e => ({ address: e.address, amount: BigInt(e.amount_oil).toString() })),
  ...spo.map(e => ({ address: e.address, amount: (BigInt(e.amount_lamp) * 1_000_000n).toString() }))
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
const tree = buildSnapshotTree(rows, { amountField: "amount", isOil: true });

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
npx tsx _balcheck.ts   # (hoặc xem ví trong Eternl)
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

- [ ] Snapshot đã verify: tổng phân bổ = 100M LAMP (delegator) + 20M LAMP (SPO)
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
