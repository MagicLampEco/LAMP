# Capped Drop — SPEC EXEC (Deploy + Test + ISPO)

**Doctype:** MagicLamp Protocol — Execution / Operations Spec
**Version:** v2 "Capped Drop"
**Updated:** 2026-06-10
**Nguồn chuẩn:** [`CONTRACT-CappedDrop.md`](./CONTRACT-CappedDrop.md)
**Phụ thuộc đặc tả:** [`SPEC-CappedDrop-FEAT.md`](./SPEC-CappedDrop-FEAT.md) · [`SPEC-CappedDrop-MATH.md`](./SPEC-CappedDrop-MATH.md)

---

## 1. Deploy steps (thứ tự bắt buộc)

Mỗi bước ghi kết quả vào `LampDistribution/scripts/deployed.json` (gitignored).
Bước sau đọc bước trước qua file đó. Không bỏ qua thứ tự.

### 1.0 Chuẩn bị môi trường

Tạo `LampDistribution/scripts/.env` (KHÔNG commit):

```
# Blockfrost Preview project key
BLOCKFROST_KEY=previewXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Ví deploy (chọn 1 trong 2 — ưu tiên WALLET_SEED cho dễ nhớ)
WALLET_SEED="word1 word2 ... word24"
# PRIVATE_KEY=ed25519_sk1...

# Committee (production: CSV 3 keyhash 28-byte hex; tự động threshold=⌈2N/3⌉)
# Bỏ trống → self-test committee 1-of-1 bằng ví deploy (không cần field này cho Preview self-test)
# COMMITTEE_KEYHASHES=keyhash1,keyhash2,keyhash3
# COMMITTEE_THRESHOLD=2

# LAMP token (production: policy tLAMP thật; bỏ trống → self-test native sig của ví deploy)
# LAMP_POLICY_ID=28e916b097be13ed955330f00710bd93e2ea74bbc89aa5f5cd0f12b4
# LAMP_ASSET_NAME=744c414d50

# Beacon NFT (bỏ trống → native sig policy của ví deploy — tự động nhất quán)
# BEACON_NFT_POLICY=<hash minting validator beacon_nft khi ship>

# Tham số tùy chỉnh genesis (tùy chọn — có default an toàn)
# TREASURY_FUND_OIL=500000000000   # 500_000 LAMP (oil) — default
# DROP_VALUE_OIL=100000000         # 100 LAMP/drop·epoch (D) — default D_GENESIS

# Ví B test (tùy chọn — bỏ trống → placeholder PKH, chỉ demo account không redeem được)
# PRIVATE_KEY_B=ed25519_sk1...
# WALLET_SEED_B="..."

# Network
NETWORK=Preview
```

**Verify ví có tADA:**
```bash
# Lấy faucet nếu cần: https://docs.cardano.org/cardano-testnet/tools/faucet
curl "https://cardano-preview.blockfrost.io/api/v0/addresses/$(cat addr.txt)" \
  -H "project_id: $BLOCKFROST_KEY"
```

### 1.1 Compile Aiken (bắt buộc trước deploy)

```bash
cd LampDistribution/onchain
aiken build
# Tạo onchain/plutus.json — 01_deploy.ts đọc file này.
```

Kiểm tra 3 validator có trong `plutus.json`:
- `claim_account.claim_account.spend`
- `beacon.beacon.spend`
- `treasury.treasury.spend`

Env vars ảnh hưởng bước này: không có.
Output: `LampDistribution/onchain/plutus.json`

### 1.2 Bước 1: Apply params (01_deploy.ts)

```bash
cd LampDistribution/scripts
npm install
npm run deploy
```

Script đọc (`config.ts`):
- `LAMP_POLICY_ID` / `LAMP_ASSET_NAME` — mặc định native sig policy của ví deploy
- `BEACON_NFT_POLICY` — mặc định native sig policy của ví deploy
- `COMMITTEE_KEYHASHES` / `COMMITTEE_THRESHOLD` — mặc định self-test 1-of-1

Output `deployed.json`:
```json
{
  "claimAccount": { "hash": "...", "address": "addr_test1w..." },
  "beacon":       { "hash": "...", "address": "addr_test1w..." },
  "treasury":     { "hash": "...", "address": "addr_test1w..." },
  "params": {
    "msPerEpoch": "86400000",
    "lampPolicy": "...",
    "lampName":   "4c414d50",
    "beaconNftPolicy": "...",
    "claimAccountHash": "..."
  }
}
```

**Lưu ý thứ tự apply:** treasury cần `claimAccountHash` → apply `claim_account` trước để lấy hash → sau đó apply `treasury`. Script tự làm đúng thứ tự (`01_deploy.ts:64-94`).

### 1.3 Bước 2: Mint test-LAMP (02_mint_test_lamp.ts)

Bỏ qua nếu dùng tLAMP thật (production) — fund treasury thủ công bằng token đó rồi nhảy sang 1.4.

```bash
npm run mint-lamp
# Tùy chọn: TEST_LAMP_MINT=2000000 npm run mint-lamp  (default 1_000_000 LAMP)
```

Env vars:
- `TEST_LAMP_MINT` — số LAMP mint (không phải oil); mặc định 1_000_000.

Ghi vào `deployed.json`: `testLamp.policyId`, `testLamp.assetName`, `testLamp.minted`.

### 1.4 Bước 3: Genesis (03_genesis.ts)

Tạo toàn bộ state on-chain trong 1 tx:
- Mint 1 beacon NFT (DropParam, asset name `DROP = 44524f50`)
- 1 beacon UTxO tại beacon address (giữ NFT + `BeaconDatum{epoch, DropParam, drop_value=D}`)
- 1 treasury UTxO (pool LAMP + `TreasuryDatum{committee_hash}`)
- 2 ClaimAccount UTxO (ví A + ví B, `entitlement=0, redeemed=0`)

```bash
npm run genesis
# Tùy chọn:
# DROP_VALUE_OIL=100000000 npm run genesis   # D = 100 LAMP/drop·epoch (default D_GENESIS)
# TREASURY_FUND_OIL=1000000000000 npm run genesis  # 1_000_000 LAMP
```

Env vars:
- `DROP_VALUE_OIL` — D (oil); mặc định `D_GENESIS = 100_000_000` (100 LAMP).
- `TREASURY_FUND_OIL` — oil fund treasury; mặc định `500_000 × 10^6`.
- `PRIVATE_KEY_B` / `WALLET_SEED_B` — ví B thật (tùy chọn); bỏ trống → placeholder PKH.

Ghi vào `deployed.json`: `genesis.dropParamBeacon`, `genesis.treasuryUtxo`, `genesis.claimAccountA/B`, `wallets.aPkh/bPkh`.

**Verify genesis on-chain:**
```bash
# Xem beacon UTxO
curl "https://cardano-preview.blockfrost.io/api/v0/addresses/<beacon_address>/utxos" \
  -H "project_id: $BLOCKFROST_KEY" | jq '.[].tx_hash'
```

### 1.5 Bước 4: E2E (04_e2e.ts)

Chạy toàn bộ flow capped-drop:
1. Claim — committee cấp entitlement E cho A (250 LAMP) + B (1000 LAMP).
2. Post DropParam beacon — committee cập nhật D cho epoch hiện tại.
3. Redeem — A tự tính vested(t) on-chain, nhận LAMP.
4. Verify — so sánh redeemed on-chain vs amount đã redeem.

```bash
npm run e2e
# Tùy chọn: DROP_VALUE_OIL=100000000 npm run e2e
```

**Lưu ý epoch:** `vested(t) = min(E, D·dpe·(t−t0))`. Nếu `t = t0` (genesis + e2e cùng epoch) thì `elapsed=0 → vested=0 → redeem fail`. Đợi sang epoch kế (≥1 ngày Preview) hoặc chạy `03_genesis.ts` với `start_epoch` nhỏ hơn (tùy chỉnh qua `GENESIS_START_EPOCH_OFFSET`).

Script `04_e2e.ts:208-212` tự phát hiện và in cảnh báo nếu `redeemEpoch <= start_epoch`.

### 1.6 LAMP_ASSET_NAME quan trọng (LIVE record)

Theo `LIVE_DEPLOY_PREVIEW.md`:
- test-LAMP hiện tại trên Preview: policy `28e916b097be...`, name `4c414d50` ("LAMP").
- Sau khi tích hợp tLAMP canonical (`fix/lamp-name-canonical`): name đổi thành `744c414d50` ("tLAMP").
- Khi đổi token → thay `LAMP_POLICY_ID` + `LAMP_ASSET_NAME` trong `.env` → deploy lại từ bước 1.2 (script address đổi vì param đổi).

---

## 2. Test plan (MECE)

### 2.1 Positive — happy path

**P-1: Claim → drip → redeem (ví lớn, E > D)**

```
Setup:  E = 1_000_000_000 oil (1000 LAMP), D = 100_000_000 oil (100 LAMP), dpe = 1, t0 = 100.
Epoch 103 (elapsed=3): vested = min(1000, 100·3) = 300 LAMP → redeem 300.
Kỳ vọng:
  - TX on-chain confirm.
  - ClaimAccount out: redeemed = 300_000_000, field khác unchanged.
  - Ví A nhận +300_000_000 oil LAMP.
  - Treasury giảm đúng 300_000_000 oil.
Kiểm tra: decodeClaimAccountDatum(accA_out) + lucid.utxosAt(treasuryAddr).assets[lampUnit].
```

**P-2: Partial redeem rồi redeem tiếp (đa-claim cộng dồn)**

```
Setup:  E = 350_000_000 oil (350 LAMP), D = 100_000_000, dpe = 1, t0 = 100.
  Lần 1 (epoch 102): vested=200, redeemed=0 → amount=200 LAMP. Sau: redeemed=200.
  Lần 2 (epoch 103): vested=300, redeemed=200 → amount=100 LAMP. Sau: redeemed=300.
  Lần 3 (epoch 110): vested=min(350, 1000)=350, redeemed=300 → amount=50 LAMP. Sau: redeemed=350=E.
  Lần 4 (epoch 120): vested=350, redeemed=350 → amount=0 → expect reject (xem N-1).
Kỳ vọng: tổng 3 lần = 200+100+50 = 350 = E (cap chính xác). Kiểm tra: MATH §4.
```

**P-3: Multi-epoch wait rồi redeem 1 lần (bỏ lỡ epoch không mất quyền)**

```
Setup:  E = 500_000_000 oil (500 LAMP), D = 100_000_000, dpe = 1, t0 = 100.
User không redeem epoch 101→104. Epoch 115:
  elapsed = 15, raw = 100·1·15 = 1500 LAMP, vested = min(500, 1500) = 500 LAMP.
  amount = 500 − 0 = 500 LAMP → redeem full E trong 1 lần.
Kỳ vọng: 1 tx nhận 500 LAMP. Verify F-VEST-3 (vested≤E), F-SUM-1 (redeemed_cuối=E).
```

**P-4: Ví nhỏ (E ≤ D) — nhận hết epoch đầu**

```
Setup:  E = 40_000_000 oil (40 LAMP), D = 100_000_000, dpe = 1, t0 = 100.
Epoch 101: elapsed=1, raw=100, vested=min(40,100)=40 → amount=40 LAMP.
Kỳ vọng: rút trọn E ngay epoch đầu (F-SMALL-1). Mọi redeem sau: amount=0 → reject.
```

**P-5: Committee cấp thêm entitlement (Claim redeemer)**

```
Setup: account A genesis E=0.
  Claim tx: committee 2/3 ký → entitlement += 250_000_000.
  Out datum: entitlement=250_000_000, redeemed=0, field khác bất biến.
Kỳ vọng: TX confirm. decodeClaimAccountDatum(accA_out).entitlement == 250_000_000.
Verify: C-CLAIM-1 (sig đếm), C-CLAIM-2/3/4 (field invariant).
```

### 2.2 Negative — edge + attack

**N-1: Over-cap (amount > vested−redeemed) → reject**

```
out_datum.redeemed = redeemed + (vested + 1) trong TX.
Validator: amount = (vested+1) − redeemed = correct_amount + 1 → out.redeemed sai.
Vì out.redeemed = redeemed + amount và validator check amount = vested − in.redeemed,
tx khai amount lớn hơn → C-RDM-4 fail (out.redeemed không khớp tính toán).
Ref: claim_account.ak:100 `expect out_datum.redeemed == datum.redeemed + amount`.
```

**N-2: Zero-redeem (amount = 0) → reject**

```
Kịch bản A: t = t0 (elapsed=0 → vested=0 → amount=0).
Kịch bản B: redeemed đã = vested (đã rút hết phần mở khoá).
Validator: `expect amount > 0` (claim_account.ak:95) → fail cả 2.
```

**N-3: Không có chữ ký owner (no-owner-sig) → reject**

```
TX redeem không có PKH datum.owner trong extra_signatories.
Validator: `expect list.has(tx.extra_signatories, datum.owner)` (claim_account.ak:73) → fail.
Test: redeem_no_owner_sig() fail trong claim_account.ak:351.
```

**N-4: Double-satisfaction (2 ClaimAccount output cùng script hash) → reject**

```
TX chứa 2 output tại script hash claim_account (stake cred khác nhau để bypass stake check).
Validator: `expect util.count_outputs_at_script(tx.outputs, own_hash) == 1` (claim_account.ak:44) → fail.
Cơ chế: count theo PAYMENT script hash, không phải toàn địa chỉ — fix audit C1.
Test: redeem_double_satisfaction() fail trong claim_account.ak:362.
```

**N-5: Fake beacon (wrong-beacon / datum hijack) → reject**

```
TX dùng reference input là UTxO fake: địa chỉ đúng nhưng KHÔNG mang beacon NFT (beacon_nft_policy).
Validator find_drop_value (claim_account.ak:120): list.find theo `assets.quantity_of(…, beacon_nft_policy, drop_name) == 1`.
Fake UTxO không có NFT → find trả None → expect Some fail.
Kịch bản 2: UTxO có NFT nhưng datum.kind ≠ DropParam → `expect bd.kind == DropParam` fail.
```

**N-6: Tamper giá trị ClaimAccount UTxO (thêm token lạ) → reject**

```
TX output ClaimAccount mang thêm token ngoài (LAMP hoặc asset khác).
Validator: `expect acc_out.value == acc_in.value` (claim_account.ak:53) — bảo toàn value tuyệt đối.
Test: claim_value_tamper() fail trong claim_account.ak:214.
```

**N-7: Mint trong TX redeem → reject**

```
TX kèm mint ≠ 0 (bất kỳ asset nào).
Validator: `expect assets.is_zero(tx.mint)` (claim_account.ak:39) → fail.
Test: redeem_mint_rejected() fail trong claim_account.ak:376.
```

**N-8: Thay đổi field bất biến trong out datum (entitlement/start_epoch/drops_per_epoch) → reject**

```
Kẻ tấn công thay out_datum.entitlement = entitlement + extra (tự tăng E).
Validator: `expect out_datum.entitlement == datum.entitlement` (claim_account.ak:99) → fail.
Tương tự cho owner, start_epoch, drops_per_epoch.
```

**N-9: Committee không đủ threshold cho Claim → reject**

```
Claim TX chỉ 1 committee sig khi threshold=2.
Validator: `expect util.count_committee_sigs(...) >= threshold` (claim_account.ak:60) → fail.
Test: claim_insufficient_committee() fail trong claim_account.ak:203.
```

**N-10: Treasury thiếu LAMP (pool cạn) → offchain reject trước on-chain**

```
treasury UTxO có < amount LAMP.
Off-chain: redeemBuilder.ts:137 `if (treasuryLamp < amount) throw REDEEM-012`.
On-chain: treasury.ak kiểm tra treasury_out = treasury_in − amount → fail nếu không đủ.
Thao tác: operator phải nạp thêm LAMP vào treasury UTxO (fund thủ công bằng tx ADA+LAMP).
```

### 2.3 Chạy test Aiken (on-chain unit tests)

```bash
cd LampDistribution/onchain
aiken check
# Kỳ vọng: tất cả test pass (xem list test claim_account.ak dưới đây)
```

Test list trong `claim_account.ak` (validators/claim_account.ak:192-386):

| Test | Loại | Mô tả |
|---|---|---|
| `claim_happy_path` | positive | committee cấp E |
| `claim_insufficient_committee` | negative (fail) | 1 sig < threshold 2 |
| `claim_value_tamper` | negative (fail) | token lạ trong output |
| `redeem_happy` | positive | E=1000, D=100, epoch=3 → amount=300 |
| `redeem_small_entitlement_full_first_epoch` | positive | E=50<D=100, epoch 1 → amount=50 |
| `redeem_multi_claim_accumulate` | positive | 3 đợt: 200+300+500=1000=E |
| `redeem_vested_capped_at_E` | positive | epoch xa, cap E=1000 |
| `redeem_over_cap_rejected` | negative (fail) | out.redeemed=1500>E=1000 |
| `redeem_nothing_vested_rejected` | negative (fail) | amount=0 |
| `redeem_no_owner_sig` | negative (fail) | thiếu chữ ký owner |
| `redeem_double_satisfaction` | negative (fail) | 2 output cùng script hash |
| `redeem_mint_rejected` | negative (fail) | tx.mint ≠ 0 |

---

## 3. ISPO Integration Guide

Hướng dẫn operator (stake pool/launchpad) thiết lập `E` (entitlement) cho delegators.

### 3.1 Mô hình ISPO

Mỗi delegator nhận `E` LAMP tỷ lệ với ADA stake tích lũy trong N epoch. Operator tính `E` off-chain từ snapshot stake, rồi dùng committee M-of-N ký Claim TX để gán `E` vào ClaimAccount. Sau đó delegator tự redeem theo vested schedule (D LAMP/epoch, cap E).

### 3.2 Tính E cho delegator

```
E_delegator (oil) = (ada_delegated / ada_total_pool) × TOTAL_ISPO_FUND × participation_epochs / N
```

Ví dụ: pool tổng 1_000_000 ADA, ISPO fund 50_000_000 LAMP, N=10 epoch, delegator A stake 10_000 ADA trong 8 epoch:

```
E_A = (10_000 / 1_000_000) × 50_000_000 × (8/10)
    = 0.01 × 50_000_000 × 0.8
    = 400_000 LAMP = 400_000_000_000 oil
```

### 3.3 Thiết lập D (drop value)

D kiểm soát tốc độ nhỏ giọt. Operator post DropParam beacon với D theo chiến lược:

| Chiến lược | D | Thời gian nhỏ giọt ⌈E/D⌉ |
|---|---|---|
| Instant unlock | D = E_max (LAMP tối đa) | 1 epoch |
| 30-epoch linear | D = E_avg / 30 | ~30 epoch |
| 90-epoch linear | D = E_avg / 90 | ~90 epoch |

D là THAM SỐ beacon — operator thay đổi bất cứ lúc nào qua PostBeacon TX (committee M-of-N ký). Thay D ảnh hưởng tất cả account chưa rút hết (vì validator đọc D từ beacon ref input mỗi lần redeem). Operator cần thông báo trước khi thay D.

### 3.4 Flow operator thiết lập ISPO

```
1. Chụp snapshot stake (off-chain, ngoài protocol).
2. Tính E cho từng delegator (bước 3.2).
3. Tạo ClaimAccount UTxO cho từng delegator (03_genesis.ts hoặc script riêng):
   - Tạo TX multi-output: mỗi delegator 1 ClaimAccount {owner=PKH, entitlement=0, redeemed=0,
     start_epoch=t_ispo_end, drops_per_epoch=1}.
   - Giới hạn: Cardano max output ~15-20/tx tuỳ script cost.
   - KHÔNG cần Plutus script cho genesis (chỉ pay-to-address) nếu committee tạo UTxO chứa
     datum inline.
4. Sau ISPO kết thúc: committee cấp entitlement (Claim TX) theo danh sách E đã tính.
   - Mỗi Claim TX: 1 account (do validator enforce count_inputs==1, count_outputs==1, C-RDM-7).
   - Số TX = số delegator.
5. Post DropParam beacon với D đã chọn (bước 3.3).
6. Delegator tự redeem từ start_epoch+1 trở đi.
```

### 3.5 Chọn start_epoch

- `start_epoch` nằm trong datum account. Operator set khi tạo account.
- Nên set `start_epoch = epoch_ispo_end` để vesting bắt đầu ngay sau ISPO kết thúc.
- Delegator không có vested trước `start_epoch+1` → không redeem được trước thời điểm đó.

### 3.6 Treasury

Treasury là UTxO duy nhất giữ toàn bộ LAMP pool. Operator phải:
1. Fund treasury đủ `Σ E_delegator` trước khi delegator redeem.
2. Nếu treasury cạn trước (thiếu LAMP): off-chain builder throw `REDEEM-012`. Operator fund thêm bằng TX thủ công (pay LAMP vào treasury address — không cần Plutus).
3. Không burn: `treasury_out = treasury_in − amount` (CONTRACT §7, `treasury.ak`).

### 3.7 Multi-account genesis batch

Script `03_genesis.ts` tạo 2 account (A + B) làm mẫu. ISPO thật có hàng trăm delegator: operator viết script riêng để batch.

Ràng buộc per-TX:
- 1 account input + 1 output (validator enforce, C-CLAIM-5/C-RDM-7).
- Genesis UTxO (tạo mới, không spend Plutus): nhiều output/TX được — giới hạn là fee và max output size Cardano (~90 KB).
- Claim TX (cấp E): mỗi TX chỉ 1 account → N delegator cần N Claim TX.

---

## 4. Known limits

| ID | Giới hạn | Ảnh hưởng | Workaround |
|---|---|---|---|
| KL-1 | 1 Claim TX = 1 account (C-CLAIM-5/C-RDM-7) | ISPO 1000 delegator = 1000 TX cấp E | Batch off-chain: submit liên tục, 1 TX/5 giây tránh queue. |
| KL-2 | 1 treasury UTxO — 1 redeem TX at a time | Không concurrent redeem nhiều account cùng block nếu dùng cùng treasury UTxO | Operator tách nhiều treasury UTxO (mỗi UTxO 1 lô delegator). treasury.ak không giới hạn số UTxO. |
| KL-3 | start_epoch cố định trong datum (không sửa sau genesis) | Nếu muốn delay vesting → phải tạo lại account | Chọn start_epoch đúng ngay khi genesis. |
| KL-4 | D áp dụng đồng nhất cho tất cả account | Không per-account D ở MVP | drops_per_epoch là field datum → DAO có thể override per-account (post-MVP, CONTRACT §5). |
| KL-5 | drops_per_epoch = 1 MVP (không thay đổi được ở MVP) | Tất cả account cùng tốc độ nhỏ giọt | Cơ chế DAO chỉnh drops_per_epoch defer sang v.sau (CONTRACT §5). |
| KL-6 | Không cancel/refund entitlement sau Claim | Sau khi Claim TX confirm, redeemed không bị trừ lại | Operator phải kiểm tra kỹ E trước khi Claim. Không có undo. |
| KL-7 | Native sig beacon NFT (MVP) | Policy id gắn với ví deploy → nếu ví mất thì KHÔNG post beacon mới | Production: ship beacon_nft Aiken minting validator (one-shot UTxO) thay native sig. |
| KL-8 | LAMP_ASSET_NAME hardcode `4c414d50` trong DEFAULT | Khi đổi sang tLAMP canonical (`744c414d50`) phải update .env + redeploy | Luôn truyền LAMP_ASSET_NAME qua .env trong production. |

---

## 5. v-next (post-MVP)

Theo CONTRACT §5 và FEAT §5:

| Tính năng | Mô tả | Chờ |
|---|---|---|
| **DAO multi-drop per-DID** | DAO tăng `drops_per_epoch` cho DID uy tín/Org (CONTRACT §5.1). Gắn Governance VP + PhoenixKey DID sinh trắc (chống sybil). | Governance VP (`LAMP/Governance/VotingPower/CONTRACT.md`), PhoenixKey DID. |
| **Pause/penalty** | DAO đặt `drops_per_epoch = 0` trong N epoch (CONTRACT §5.2). Phần vested trước đó không mất. | DAO governance on-chain. |
| **Beacon NFT one-shot Aiken policy** | Thay native sig beacon NFT bằng Aiken minting validator (one-shot UTxO), tăng bảo mật và tách khỏi ví deploy (KL-7). | `beacon_nft` module ship. |
| **Batch Claim (nhiều account/TX)** | Giảm số TX cần để cấp E cho ISPO lớn (KL-1). Cần thay đổi `count_inputs/outputs` guard. | Spec + audit lại double-satisfaction. |
| **Treasury multi-UTxO (auto-split)** | Auto tách treasury pool ra N UTxO để hỗ trợ concurrent redeem (KL-2). | Off-chain builder + treasury.ak update. |
| **Entitlement revoke (với DID penalty)** | Gắn với governance — DAO thu hồi entitlement theo verdict. Chỉ rút về treasury phần chưa rút. | Governance penalty flow. |
| **tLAMP canonical** | Đổi LAMP_ASSET_NAME từ `4c414d50` sang `744c414d50` khi tLAMP ship mainnet. Redeploy toàn bộ (KL-8). | `fix/lamp-name-canonical` merge main. |

---

*Mọi phát biểu trong file này có dẫn chứng code (`claim_account.ak:line` hoặc `file.ts:line`). Không bịa tính năng không có trong code.*
