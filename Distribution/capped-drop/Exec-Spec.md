# Capped Drop — SPEC EXEC (Deploy + Test + ISPO)

**Doctype:** MagicLamp Protocol — Execution / Operations Spec
**Version:** v3 "Capped Drop"
**Updated:** 2026-09-22
**Nguồn chuẩn:** [`CONTRACT.md`](./CONTRACT.md) — **v3**
**Phụ thuộc đặc tả:** [`Math-Spec.md`](./Math-Spec.md) — **v3** · [`Feat-Spec.md`](./Feat-Spec.md) — **v3** · [`Tech-Spec.md`](./Tech-Spec.md) — **v3**

**Vì sao bump v2 → v3:** tham số đóng băng lúc genesis đổi hoàn toàn. Beacon không còn `drop_value`;
luật rút đổi từ "validator tự tính `amount`" sang "người dựng tx XIN, validator KẸP"; thêm cắt ngọn
theo `total_redeemed`. Bản v2 của tệp này hướng dẫn đặt một tham số (`D`) nay không còn tồn tại, nên
nó không chỉ lỗi thời mà còn **chạy được và ra sai** — đó là lý do phải viết lại chứ không đính chính.

> ⚠ **TRẠNG THÁI MÃ (đo 2026-09-22) — MÃ TRONG KHO HIỆN LÀ v2, KHÔNG PHẢI v3.**
> `grep -rn "rate_root\|trim_num\|trim_den\|trim_floor\|index_at_start\|total_redeemed"` trên
> `Distribution/onchain/` + `Distribution/offchain/` + `Distribution/scripts/` cho **0 kết quả trong
> tệp mã** (chỉ khớp trong `capped-drop/*.md`). Ngược lại `drop_value` còn sống ở
> `Distribution/onchain/validators/claim_account.ak:139,152` · `Distribution/onchain/validators/beacon.ak` ·
> `Distribution/onchain/lib/magiclamp/lampdist/constants.ak:24-31` · `Distribution/offchain/src/datum.ts`.
>
> ⟹ **Tệp này mô tả TRẠNG THÁI ĐÍCH của lượt đúc v3, không mô tả thứ chạy được hôm nay.** Mỗi mục
> còn lệch mã mang nhãn `CHƯA CÓ TRONG MÃ` kèm con trỏ. Đừng đọc một lệnh ở đây thành một lệnh đã
> kiểm; phần nào đã kiểm thì nói rõ đã kiểm bằng gì.
>
> ⚠ **v3 ĐÒI MỘT GENESIS MỚI, không nâng cấp tại chỗ được.** `ClaimAccountDatum` thêm
> `index_at_start` và `TreasuryDatum` thêm `total_redeemed`; Aiken giải mã nghiêm ngặt **số trường**
> nên mọi UTxO tài khoản và kho đang sống đều không đọc được bằng validator v3, và cụm này **không có
> redeemer nâng cấp** (CONTRACT v3 §2). Không có đường di trú nào ngoài đúc lại từ bước 1.1.

---

## 1. Deploy steps (thứ tự bắt buộc)

Mỗi bước ghi kết quả vào `Distribution/scripts/deployed.json` (gitignored).
Bước sau đọc bước trước qua file đó. Không bỏ qua thứ tự.

> **Đường dẫn đã sửa ở v3.** Bản v2 của tệp này ghi thư mục gốc là `LampDistribution/`. Thư mục đó
> **không tồn tại trong kho** (`Glob "**/validators/*.ak"`, 2026-09-22); đường thật là
> `Distribution/`. Mọi con trỏ dưới đây đã đổi theo.

### 1.0 Chuẩn bị môi trường

Tạo `Distribution/scripts/.env` (KHÔNG commit):

```
# Blockfrost Preview project key
BLOCKFROST_KEY=previewXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Ví deploy (chọn 1 trong 2 — ưu tiên WALLET_SEED cho dễ nhớ)
WALLET_SEED="word1 word2 ... word24"
# PRIVATE_KEY=ed25519_sk1...

# Committee (production: CSV 3 keyhash 28-byte hex; tự động threshold=⌈2N/3⌉)
# Bỏ trống → self-test committee 1-of-1 bằng ví deploy (CHỈ non-Mainnet; Mainnet FAIL-CLOSED).
# GUARD: threshold phải 1 ≤ threshold ≤ N; cảnh báo nếu < ⌈2N/3⌉ (mất Byzantine 2/3).
# COMMITTEE_KEYHASHES=keyhash1,keyhash2,keyhash3
# COMMITTEE_THRESHOLD=2
# COMMITTEE_THRESHOLD_ACK=1   # xác nhận khi cố ý đặt threshold < ⌈2N/3⌉ (Mainnet bắt buộc)

# LAMP token (production: policy tLAMP thật; bỏ trống → self-test native sig của ví deploy)
# LAMP_POLICY_ID=28e916b097be13ed955330f00710bd93e2ea74bbc89aa5f5cd0f12b4
# LAMP_ASSET_NAME=744c414d50

# Beacon NFT — chọn 1 trong 3 (ưu tiên trên xuống):
#   (1) BEACON_NFT_POLICY=<policy mint ngoài> — operator tự kiểm soát supply.
#   (2) ONE-SHOT Aiken beacon_nft (Mainnet TỰ bật; testnet bật BEACON_NFT_ONESHOT=1):
#       01_deploy chọn 1 UTxO ví làm genesis_ref → policy id one-shot bake vào claim_account/beacon;
#       03_genesis mint qua Plutus + consume đúng genesis_ref → supply = 1 TUYỆT ĐỐI, KHÔNG re-mint.
#   (3) native-sig fallback — CHỈ Preview self-test (re-mint được). Mainnet FAIL-CLOSED.
# BEACON_NFT_POLICY=<policy mint ngoài, nếu có>
# BEACON_NFT_ONESHOT=1

# Mainnet no-undo: sau khi đối chiếu PREFLIGHT CHECKSUM (committee+3 hash) ở 01_deploy,
# đặt DEPLOY_ACK=<checksum 16-hex in ra> để xác nhận genesis không thể hoàn tác.
# DEPLOY_ACK=<checksum>

# Tham số tùy chỉnh genesis (tùy chọn — có default an toàn)
# TREASURY_FUND_OILDROP=500000000000   # 500_000 LAMP (oildrop) — default
#
# ── Tham số beacon v3 — TÊN ĐỀ XUẤT, CHƯA CÓ TRONG MÃ ────────────────────────
# RATE_ROOT=77460    # w — gốc tốc độ. NGUYÊN THUỶ (§1.4a). W := w² = 6_000_051_600 oildrop
# TRIM_NUM=1         # κ tử  ┐ cắt ngọn, CONTRACT v3 §4 mục 4
# TRIM_DEN=1000      # κ mẫu ┘
#
# `DROP_VALUE_OILDROP` ĐÃ CHẾT ở v3 — beacon không còn trường `drop_value`.

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

#### 1.0a Tham số v3 — cái nào là env, cái nào KHÔNG THỂ là env

Bảng này thay toàn bộ vai trò của `DROP_VALUE_OILDROP` ở v2. Cột cuối là trạng thái mã đo
2026-09-22; **không tên nào trong cột "env" đã tồn tại**, nên chúng là tên ĐỀ XUẤT cho lượt đúc v3.

| tham số v3 | giá trị lượt đúc này | env | trạng thái mã |
|---|---|---|---|
| `rate_root` (`w`) | **77460** | `RATE_ROOT` (đề xuất) | **CHƯA CÓ TRONG MÃ.** `03_genesis.ts:52` hiện đọc `DROP_VALUE_OILDROP`, dựng `BeaconDatum{epoch, kind, drop_value}` (`03_genesis.ts:154`) |
| `index` (`A` tại genesis) | **0** | — (không nên là env: nó là mốc gốc, đặt sai một lần là sai vĩnh viễn) | CHƯA CÓ TRONG MÃ |
| `trim_num` (κ tử) | **1** | `TRIM_NUM` (đề xuất) | CHƯA CÓ TRONG MÃ |
| `trim_den` (κ mẫu) | **1000** | `TRIM_DEN` (đề xuất) | CHƯA CÓ TRONG MÃ |
| `speed_policies` | **`[]`** (danh sách RỖNG) | — (móc mở rộng, bật bằng một lượt post beacon, không bằng env) | CHƯA CÓ TRONG MÃ |
| `trim_floor` | **1.000 LAMP = 1_000_000_000 oildrop** | **KHÔNG CÓ env, và KHÔNG ĐƯỢC CÓ** | CHƯA CÓ TRONG MÃ — `constants.ak` hiện chỉ có `drop_value_genesis/min/max` (`constants.ak:24-31`) |

**`trim_floor` không có env là một ràng buộc, không phải một thiếu sót.** CONTRACT v3 §4 mục 4
(`C-RDM-TRIM-FLOOR`) đặt nó là **hằng trong `constants.ak`**, tức nằm trong script hash. Lý do là
hướng hỏng: hạ nó về 0 dựng lại đúng điểm hấp thụ mà nó sinh ra để phá (`total_redeemed = 0` ⟹ trần
0 ⟹ không ai rút được ⟹ `total_redeemed` mãi bằng 0), và hệ chết theo kiểu không ai kêu — mọi bất
biến vẫn đúng, mọi giao dịch chỉ đơn giản bị từ chối. Đưa nó ra env là biến một lượt đúc lại thành
một dòng cấu hình. Đổi `trim_floor` **phải** đổi script hash.

**`rate_root = 77460` là số NGUYÊN THUỶ, không suy ra từ `W`.** `W := rate_root² = 6.000.051.600
oildrop`. Không được chốt `W` trước rồi lấy căn: `⌊√(6000·10⁶)⌋ = 77459` làm `n* = ⌈√E/w⌉` trượt
lên một cửa sổ — pot 6 tỷ xong ở cửa sổ **1001** thay vì 1000, tức lệch mốc hiệu chỉnh. Với
ETD-max thì hai giá trị cho cùng `n* = 20`. Chứng minh + bảng hai giá trị:
[`Math-Spec.md`](./Math-Spec.md) v3 §7 (M-ROOT-CEIL). Ca kiểm bắt buộc: §2.1 P-6 dưới đây.

> ⚠ Không đọc chỗ này thành *"tài khoản không bao giờ chạm `E`"*. `A_span` tăng tuyến tính không
> chặn nên vế phải phép kẹp cũng tăng không chặn — không có tiệm cận, không có đuôi bụi vĩnh viễn.
> Giá của chiều sai là **một cửa sổ**, không phải một khoản khoá vốn.

### 1.1 Compile Aiken (bắt buộc trước deploy)

```bash
cd Distribution/onchain
aiken build
# Tạo onchain/plutus.json — 01_deploy.ts đọc file này.
```

Kiểm tra 3 validator có trong `plutus.json`:
- `claim_account.claim_account.spend`
- `beacon.beacon.spend`
- `treasury.treasury.spend`

Kho còn 3 validator nữa trong cùng thư mục mà bản v2 không kê, và cả ba đều tham gia genesis:
`beacon_nft.ak` · `treasury_nft.ak` · `claim_account_nft.ak` (đo bằng `Glob` trên
`Distribution/onchain/validators/`, 2026-09-22). `claim_account_nft` là chốt C-ACC-0 —
`claim_account.ak:79-82` ép mọi tài khoản phải mang NFT tên `blake2b_256(owner)`, nên một tài khoản
không có NFT thì KHÔNG tiêu được.

Env vars ảnh hưởng bước này: không có.
Output: `Distribution/onchain/plutus.json`

### 1.2 Bước 1: Apply params (01_deploy.ts)

```bash
cd Distribution/scripts
npm install
npm run deploy
```

Script đọc (`config.ts`):
- `LAMP_POLICY_ID` / `LAMP_ASSET_NAME` — mặc định native sig policy của ví deploy
- `BEACON_NFT_POLICY` — mặc định native sig policy của ví deploy
- `COMMITTEE_KEYHASHES` / `COMMITTEE_THRESHOLD` — mặc định self-test 1-of-1

Output `deployed.json` (khối `params` theo `01_deploy.ts:307-316`):
```json
{
  "claimAccount": { "hash": "...", "address": "addr_test1w..." },
  "beacon":       { "hash": "...", "address": "addr_test1w..." },
  "treasury":     { "hash": "...", "address": "addr_test1w..." },
  "params": {
    "msPerEpoch": "86400000",
    "lampPolicy": "...",
    "lampName":   "4c414d50",
    "beaconNftPolicy":   "...",
    "treasuryNftPolicy": "...",
    "accountNftPolicy":  "...",
    "claimAccountHash":  "..."
  }
}
```

Bản v2 của tệp này kê thiếu `treasuryNftPolicy` và `accountNftPolicy` trong khối `params` — hai
policy đó có thật và script có ghi ra (`01_deploy.ts:310-315`); đã bổ sung.

**Lưu ý thứ tự apply:** có một chuỗi phụ thuộc, không phải một bước. `treasury_nft` cần một
`genesis_ref` (`01_deploy.ts:179-185`) → `account_nft_policy` suy ra từ `committee + threshold +
treasuryNftPolicy` (`01_deploy.ts:199`) → `claim_account` mới apply đủ 8 tham số → `treasury` cần
`claimAccountHash`. Script tự làm đúng thứ tự; bản v2 dẫn `01_deploy.ts:64-94` cho việc này, dải
dòng đó **không còn chứa logic thứ tự** (đo 2026-09-22) nên con trỏ đã đổi sang mốc có tên.

**8 tham số của `claim_account`** (`claim_account.ak:23-34`), kê ra vì v3 không đổi danh sách này
và một lượt đúc lại phải khớp đúng thứ tự: `committee`, `threshold`, `ms_per_epoch`, `lamp_policy`,
`lamp_name`, `beacon_nft_policy`, `treasury_nft_policy`, `account_nft_policy`.

### 1.3 Bước 2: Mint test-LAMP (02_mint_test_lamp.ts)

Bỏ qua nếu dùng tLAMP thật (production) — fund treasury thủ công bằng token đó rồi nhảy sang 1.4.

```bash
npm run mint-lamp
# Tùy chọn: TEST_LAMP_MINT=2000000 npm run mint-lamp  (default 1_000_000 LAMP)
```

Env vars:
- `TEST_LAMP_MINT` — số LAMP mint (không phải oildrop); mặc định 1_000_000.

Ghi vào `deployed.json`: `testLamp.policyId`, `testLamp.assetName`, `testLamp.minted`.

### 1.4 Bước 3: Genesis (03_genesis.ts)

Tạo toàn bộ state on-chain trong 1 tx:
- Mint 1 beacon NFT (DropParam, asset name `DROP = 44524f50`)
- 1 beacon UTxO tại beacon address (giữ NFT + `BeaconDatum` **7 trường v3**, xem dưới)
- 1 treasury UTxO (pool LAMP + `TreasuryDatum{committee_hash, outstanding_entitlement, total_redeemed}`)
- 2 ClaimAccount UTxO (ví A + ví B, `entitlement=0, redeemed=0, index_at_start=0`) + NFT tài khoản

**`BeaconDatum` đóng băng ở lượt đúc này** (CONTRACT v3 §3):

```
BeaconDatum {
  epoch          = <cửa sổ chạy tx genesis>   // C-BCN-3 ép == cửa sổ hiện tại
  kind           = DropParam
  index          = 0                          // A tại mốc genesis
  rate_root      = 77460                      // w — NGUYÊN THUỶ, xem §1.0a
  trim_num       = 1
  trim_den       = 1000
  speed_policies = []                         // RỖNG — móc mở rộng, CONTRACT v3 §5
}
```

`speed_policies = []` có một hệ quả kiểm được và phải kiểm: tx `Redeem` **không đòi reference input
nào ngoài beacon**. Đo số reference input, đừng đo kết quả rút (§2.1 P-7).

```bash
npm run genesis
# Tùy chọn:
# TREASURY_FUND_OILDROP=1000000000000 npm run genesis  # 1_000_000 LAMP
```

Env vars:
- `TREASURY_FUND_OILDROP` — oildrop fund treasury; mặc định `500_000 × 10^6` (`03_genesis.ts:49`).
- `PRIVATE_KEY_B` / `WALLET_SEED_B` — ví B thật (tùy chọn); bỏ trống → placeholder PKH.
- `RATE_ROOT` / `TRIM_NUM` / `TRIM_DEN` — **tên đề xuất, CHƯA CÓ TRONG MÃ** (§1.0a). Script hiện
  đọc `DROP_VALUE_OILDROP` (`03_genesis.ts:52`) và dựng datum 3 trường
  `{epoch, kind, drop_value}` (`03_genesis.ts:154`, qua `beaconDatumToCbor`). Đổi sang 7 trường v3
  là việc của lượt đúc, chưa làm.

> ⚠ **`DROP_VALUE_OILDROP` / `D` / `D_GENESIS` là khái niệm CHẾT ở v3** — beacon không còn trường
> `drop_value`, và tốc độ không còn là một con số tuyệt đối đặt được. Thứ thay nó **không phải một
> env khác cùng vai**: `rate_root` là hằng thang TOÀN CỤC, còn tốc độ thật của một tài khoản do
> **cỡ pot** quyết định (`√E`). Xem §3.3 — đây là đổi về BẢN CHẤT, không phải đổi tên biến.

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
2. Post beacon — committee cập nhật `index`/`rate_root`/`trim_*` cho cửa sổ hiện tại (C-BCN-6).
3. Redeem — A **XIN** một `amount`, validator **KẸP** nó (v3 đổi vai, xem dưới), nhận LAMP.
4. Verify — so sánh `redeemed` on-chain vs `amount` đã nhận, và `total_redeemed` của kho.

```bash
npm run e2e
```

**Đổi vai ở v3 — đây là chỗ runbook v2 sai nhất.** v2: validator TỰ TÍNH
`amount = vested − redeemed` rồi ép bằng (`claim_account.ak:152-157`, còn nguyên trong mã hôm nay).
v3: người dựng tx xin một `amount`, validator chỉ chồng bất đẳng thức lên:

```
(redeemed + amount)² ≤ dpe² · entitlement · A_span²        và   redeemed + amount ≤ entitlement
amount ≤ max( trim_floor , total_redeemed · trim_num / trim_den )
amount > 0
với  A_span = (index + rate_root·(cửa_sổ_hiện_tại − epoch)) − index_at_start
```

Hệ quả vận hành phải nắm trước khi đọc log e2e: **xin nhiều hơn trần thì KHÔNG phải lỗi.** Xin 3
triệu khi trần là 1 triệu ⟹ nhận 1 triệu, phần thừa còn nguyên quyền, chờ lượt sau (CONTRACT v3 §4).
Một kịch bản e2e viết theo phản xạ v2 sẽ khẳng định "reject" ở đúng chỗ v3 phải "nhận một phần" — ca
đó xanh ở v2 và sai ở v3 mà thông điệp lỗi không nói gì về nguyên nhân.

**Lưu ý cửa sổ:** `A_span = 0` (genesis + e2e cùng cửa sổ) ⟹ vế phải phép kẹp bằng 0 ⟹ `amount > 0`
không thoả ⟹ redeem fail. Đợi sang cửa sổ kế (≥1 ngày Preview).

> ⚠ **`GENESIS_START_EPOCH_OFFSET` KHÔNG TỒN TẠI.** Bản v2 của tệp này bảo "tùy chỉnh qua
> `GENESIS_START_EPOCH_OFFSET`". `grep -rn` trên toàn kho LAMP (2026-09-22) cho **đúng một kết quả:
> chính tệp này**. Không tệp mã nào đọc tên đó. Đây là một tên tự phát minh cho một thứ chưa tồn
> tại — đã gỡ khỏi hướng dẫn thay vì để người vận hành đi tìm. Cần lùi mốc bắt đầu thì hôm nay
> không có núm nào: `treasury.ak` nhánh CREATE ép `start_epoch` == cửa sổ hiện tại, và `Claim`
> **rebase** `start_epoch` về cửa sổ chạy tx (`claim_account.ak:115`).

Script in cảnh báo khi chưa có gì để rút: `04_e2e.ts:278` (`"⏸ Chưa có gì để rút"`), kèm
`start_epoch`, `redeemed`, cửa sổ hiện tại. Bản v2 dẫn `04_e2e.ts:208-212` — dải dòng đó không còn
chứa phép kiểm này (đo 2026-09-22).

> **CHƯA KIỂM:** `04_e2e.ts` hiện dựng theo hình dạng v2 (`DROP_VALUE` ở `04_e2e.ts:43`, công thức
> `vested = min(E, D·dpe·elapsed)` ở `04_e2e.ts:11`). Kịch bản e2e cho v3 **chưa được viết**, nên
> chưa có output thật nào của luồng v3 để dẫn ở đây.

### 1.6 LAMP_ASSET_NAME quan trọng (LIVE record)

Theo [`../scripts/live-deploy-preview.md`](../scripts/live-deploy-preview.md):
- test-LAMP hiện tại trên Preview: policy `28e916b097be...`, name `4c414d50` ("LAMP").
- Sau khi tích hợp tLAMP canonical (`fix/lamp-name-canonical`): name đổi thành `744c414d50` ("tLAMP").
- Khi đổi token → thay `LAMP_POLICY_ID` + `LAMP_ASSET_NAME` trong `.env` → deploy lại từ bước 1.2 (script address đổi vì param đổi).

---

## 2. Test plan (MECE)

Ký hiệu dùng suốt §2 (CONTRACT v3 §1 · [`Math-Spec.md`](./Math-Spec.md) v3 §1). **1 LAMP = 1.000.000
oildrop**; mọi con số dưới đây là oildrop trừ khi ghi "LAMP".

```
A_span = (index + rate_root·(cửa_sổ_hiện_tại − epoch)) − index_at_start
trần tích luỹ :  (redeemed + amount)² ≤ dpe²·E·A_span²   ∧   redeemed + amount ≤ E
trần cắt ngọn :  amount ≤ max( trim_floor , total_redeemed · trim_num / trim_den )
                 amount > 0
Giá trị lượt đúc này: rate_root = 77460 · dpe ≡ 1 · trim_num/trim_den = 1/1000
                     trim_floor = 1_000_000_000 (1.000 LAMP)
```

Với `index = 0` và beacon post ở cửa sổ mở tài khoản, sau `n` cửa sổ: `A_span = 77460·n`, và trần
tích luỹ cho `x = redeemed + amount` là `x ≤ A_span·√E` (số nguyên lớn nhất thoả `x² ≤ E·A_span²`).

> **Hai trần ráo ở hai chế độ khác nhau — ca kiểm phải nói rõ ca của mình đang bị trần NÀO chặn.**
> Ngay sau khi mở sổ, `total_redeemed` còn nhỏ nên **cắt ngọn** là trần ráo với hầu hết ví; về sau
> nó nới ra và **trần tích luỹ** mới là trần ráo. Một ca không ghim `total_redeemed` sẽ đổi chế độ
> theo thứ tự chạy của các ca khác trong cùng bộ, và khi đó nó xanh/đỏ vì lý do không ai viết ra.

### 2.1 Positive — happy path

**P-1: Claim → tích luỹ → redeem (trần TÍCH LUỸ là trần ráo)**

```
Setup:  E = 1_000_000_000_000 oildrop (1.000.000 LAMP) ⟹ √E = 1_000_000 chẵn.
        dpe = 1, index_at_start = 0, rate_root = 77460.
        GHIM total_redeemed = 300_000_000_000_000 (300 triệu LAMP đã phát) để cắt ngọn KHÔNG ráo:
          trần cắt ngọn = max(1e9, 3e14/1000) = 300_000_000_000 = 300.000 LAMP.
Cửa sổ thứ 3: A_span = 3·77460 = 232_380.
  trần tích luỹ = 232_380 · 1_000_000 = 232_380_000_000 oildrop = 232.380 LAMP.
  232.380 < 300.000 ⟹ TRẦN RÁO LÀ TRẦN TÍCH LUỸ. Xin amount = 232_380_000_000.
Kỳ vọng:
  - TX confirm; xin đúng trần thì được trọn.
  - ClaimAccount out: redeemed = 232_380_000_000; owner/entitlement/start_epoch/
    drops_per_epoch/index_at_start BẤT BIẾN (CONTRACT v3 §4 mục 3).
  - Ví A nhận +232_380_000_000 oildrop.
  - Treasury: pool giảm đúng ngần ấy; total_redeemed TĂNG đúng ngần ấy (C-RDM-TOTAL);
    outstanding_entitlement GIẢM đúng ngần ấy (C-SOLV-3).
  - Xin 232_380_000_001 ⟹ TỪ CHỐI (lệch ĐÚNG 1 oildrop — xem N-1).
```

**P-2: Rút nhiều lượt, và lượt sau KHÔNG mất phần lượt trước**

```
Setup như P-1. Rút ở cửa sổ 1, 2, 3.
  Cửa sổ 1: A_span =  77_460 → trần tích luỹ =  77_460_000_000. redeemed 0 → xin 77_460_000_000.
  Cửa sổ 2: A_span = 154_920 → trần = 154_920_000_000. redeemed = 77_460_000_000
            → xin thêm 77_460_000_000 (trần trừ redeemed).
  Cửa sổ 3: A_span = 232_380 → trần = 232_380_000_000 → xin thêm 77_460_000_000.
Kỳ vọng: redeemed sau 3 lượt = 232_380_000_000 — BẰNG ĐÚNG P-1 rút một lượt.
  (M-SUM, Math-Spec v3 §10.)
```

> ⚠ **P-2 chỉ bằng P-1 khi cắt ngọn KHÔNG ráo ở lượt nào.** v3 **KHÔNG** có độc lập lộ trình —
> Math-Spec v3 §10 nói thẳng: cắt ngọn chặn từng lượt, nên rút một lần duy nhất ở cuối **có thể
> nhận ít hơn** rút đều mỗi cửa sổ. Ca này phải ghim `total_redeemed` đủ lớn; bỏ ghim thì nó thành
> một ca đo tính chất mà v3 cố ý không có, và nó sẽ đỏ vì đúng lý do thiết kế.

**P-3: Bỏ lỡ nhiều cửa sổ KHÔNG mất quyền**

```
Setup như P-1, nhưng không rút gì tới cửa sổ 13.
  A_span = 13·77460 = 1_006_980 > √E = 1_000_000
  ⟹ trần tích luỹ = 1_006_980_000_000 > E = 1_000_000_000_000 ⟹ vế `≤ E` là vế ráo.
  Xin amount = E = 1_000_000_000_000.
Kỳ vọng: nhận TRỌN E trong một lượt (nếu cắt ngọn không ráo).
  Cửa sổ chạm E: n* = ⌈√E / rate_root⌉ = ⌈1_000_000/77_460⌉ = ⌈12,91⌉ = 13. Kiểm cả n = 12
  (chưa đủ: trần 929_520_000_000 < E) và n = 13. Chỉ kiểm n = 13 thì không phân biệt được
  n* = 13 với bất kỳ n* ≤ 13 nào.
```

**P-4: Ví nhỏ — xong trong MỘT cửa sổ, và nó rơi ĐÚNG vào `trim_floor`**

```
Setup:  E = 1_000_000_000 oildrop (1.000 LAMP) = ĐÚNG trim_floor. total_redeemed = 0.
Cửa sổ 1: A_span = 77_460; √E = 31_622,77…
  trần tích luỹ = 77_460 · 31_622,77… ≈ 2_449_500_000_000  ≫ E ⟹ vế `≤ E` ráo.
  trần cắt ngọn = max( 1_000_000_000 , 0/1000 ) = 1_000_000_000 = ĐÚNG E.
  ⟹ amount = 1_000_000_000. Rút trọn trong một lượt.
Kỳ vọng: nhận trọn E ở cửa sổ 1. Mọi lượt sau: amount = 0 ⟹ TỪ CHỐI.
Vì sao ca này phải có: nó là ca hiệu chỉnh của chính trim_floor (CONTRACT v3 §4 mục 4 suy
  trim_floor từ yêu cầu "ví 1.000 LAMP xong trong một cửa sổ"). Nó chạy ở total_redeemed = 0,
  tức ĐÚNG điểm hấp thụ mà trim_floor sinh ra để phá. Đặt trim_floor = 0 rồi chạy lại: phải ĐỎ.
  Không đỏ ⟹ ca này không canh trim_floor.
```

**P-5: Committee cấp thêm entitlement — `Claim` là REBASE, không phải cộng dồn**

```
Setup: account A đang có E = 500_000_000_000, redeemed = 200_000_000_000.
  Claim tx: committee đủ ngưỡng ký, amount = 250_000_000_000.
Mã hiện tại ép (claim_account.ak:112-117):
  out.entitlement     == E − redeemed + amount = 550_000_000_000
  out.redeemed        == 0
  out.start_epoch     == cửa sổ chạy tx (get_epoch_strict — cận HAI phía)
  out.drops_per_epoch == vào (giữ nguyên)
Kỳ vọng: TX confirm, bốn đẳng thức trên đúng từng cái.
Ca âm đi kèm (đã có trong mã): claim_topup_entitlement_ignoring_redeemed_rejected
  (claim_account.ak:390) · claim_topup_keeping_redeemed_rejected (:397) ·
  claim_topup_keeping_old_start_rejected (:404) · claim_topup_future_start_rejected (:411) ·
  redeem_right_after_rebased_topup_rejected (:434).
```

> ⚠ **BẢN v2 CỦA TỆP NÀY MÔ TẢ SAI `Claim`.** Nó viết *"entitlement += 250_000_000, field khác
> bất biến"*. Mã ép **rebase**: `entitlement` trừ đi `redeemed` trước khi cộng, `redeemed` về 0, và
> `start_epoch` **BẮT BUỘC ĐỔI** sang cửa sổ hiện tại. Một ca viết theo bản v2 sẽ khẳng định
> `start_epoch` bất biến ở đúng chỗ mã đòi nó phải đổi.

> ⚠ **`index_at_start` lúc `Claim` — KHÔNG ĐO ĐƯỢC, và ca P-5 CHƯA khép kín vì điều đó.**
> CONTRACT v3 §2 nói `index_at_start` là "`A` chụp LÚC MỞ"; §4 mục 3 ép nó bất biến **ở nhánh
> `Redeem`**. Không mục nào của CONTRACT v3 nói nó thành gì ở nhánh **`Claim`**. Hai cách đọc cho
> hai hệ thống khác nhau, và không cách nào tự lộ ra là sai:
>   (1) **giữ nguyên** ⟹ tài khoản già được cấp thêm sẽ có `A_span` lớn sẵn, nên vest trọn lô
>       mới gần như tức thì — đúng cái lỗ mà rebase `start_epoch` được dựng ra để bịt, chỉ là ở
>       kênh khác;
>   (2) **rebase về `A(bây giờ)`** ⟹ nhất quán với rebase `start_epoch`, nhưng nó là một đẳng
>       thức PHẢI ÉP trong validator, không phải thứ suy ra được.
> P-5 chạy được, nhưng nó **không kết luận được gì về `index_at_start`**, và phải nói thế thay vì
> để ca xanh đọc thành "đã kiểm". Điểm treo + ràng buộc tạm đang có hiệu lực:
> **`ISPO-IDXSTART-CLAIM-01`**, §3.5a.

**P-6: `rate_root = 77460` — pot 6 tỷ chạm ĐÚNG `E` ở cửa sổ 1000 (CA BẮT BUỘC)**

```
Setup:  E = 6_000_000_000 LAMP = 6_000_000_000_000_000 oildrop (pot sáng lập).
        dpe = 1, index_at_start = 0, index = 0, cửa sổ mở = 0.
        Cắt ngọn KHÔNG được ráo trong ca này — ghim total_redeemed đủ lớn, hoặc tắt vế cắt ngọn
        ở tầng bài kiểm đơn vị. Không ghim thì ca đo lẫn hai trần và kết luận không quy về đâu.
Cực A (rate_root = 77460) — PHẢI chạm:
  A_span(1000) = 77_460_000
  A_span² = 6_000_051_600 · 10⁶  ⟹  A_span²/E = 1,0000086  ⟹  trần ≥ E
  ⟹ ở cửa sổ 1000 rút được TRỌN E, redeemed cuối == E, phần dư == 0.
Cực B (rate_root = 77459) — PHẢI CÒN DƯ:
  A_span(1000) = 77_459_000
  A_span² = 5_999_896_681 · 10⁶  ⟹  A_span²/E = 0,99998278
  ⟹ x_max = ⌊√(E·A_span²)⌋ = 0,99999139 · E
  ⟹ phần KHÔNG rút được ở cửa sổ 1000 ≈ 8,61·10⁻⁶ · E ≈ 51_660_000_000 oildrop ≈ 51.660 LAMP.
Khẳng định phải kiểm: cực A đuôi == 0; cực B đuôi > 0 và xấp xỉ 51.660 LAMP.
```

**Vì sao ca này dễ bỏ sót hơn mọi ca khác trong bộ — và vì sao nó đắt nhất nếu bỏ.**

1. **Ở vài cửa sổ đầu, hai cực cho kết quả GIỐNG HỆT NHAU.** Ở `n = 1`, chênh giữa hai trần là
   `√E · 1 = 77.459.666` oildrop trên một trần cỡ `6·10¹²` — dưới `1,3·10⁻⁵`. Mọi khẳng định kiểu
   "rút được đúng số mong đợi" ở `n` nhỏ đều **xanh ở CẢ HAI cực**. Theo
   `Forall §Kỷ luật phát ngôn mục 6`: đầu vào không phân biệt được hai bên đột biến thì ca đó không
   kiểm gì — và ở đây nó không kiểm gì trong khi mang đúng tên của thứ nó định kiểm.
2. **Bài kiểm phải chạy tới `n = 1000` THẬT.** Không được ngoại suy từ `n` nhỏ, không được thay
   bằng một phép so sánh đại số trên giấy. Đây là ca mà sai số cắt nguyên **cộng dồn**, nên chỉ
   phần đuôi mới phân biệt được hai cực.
3. **Cả hai cực đều giữ nguyên mọi bất biến.** `redeemed ≤ vested ≤ E` đúng ở cả hai; không mệnh đề
   nào trong bộ vỡ. Cực B chỉ đơn giản **không bao giờ để ai rút nốt phần cuối** ở mốc hiệu chỉnh,
   và `amount > 0` biến phần đuôi thành khoá vốn. Không có ca này thì không ca nào trong bộ đỏ.
4. **Phép đo phải cắm dấu riêng.** Đổi `rate_root` 77460 → 77459 rồi thấy bài đỏ **chưa** đủ: phải
   xác nhận bài đỏ vì **phần đuôi khác 0**, không phải vì một chuỗi hằng số nào đó biến mất khỏi
   mã. Giữ nguyên tên hằng, chỉ đổi GIÁ TRỊ, rồi đọc đúng trường "đuôi còn lại".

> **ĐÃ KHÉP (2026-09-22).** Cách đọc *"không bao giờ chạm"* là **SAI** và đã được sửa ở cả
> [`Math-Spec.md`](./Math-Spec.md) v3 §7 lẫn CONTRACT v3 §1. Đo lại bằng số nguyên, `E = 6×10¹⁵`
> oildrop: với `rate_root = 77459` tỉ số `E·S²/E²` là `0,99998278` ở `n = 1000` và `1,00198375` ở
> `n = 1001` ⟹ **chạm ở cửa sổ 1001**, đúng như công thức (7). Nguyên nhân của phát biểu sai: một
> phép đo tại **một** giá trị `n` bị suy thành một lượng từ toàn xưng. `A_span = w·n` tăng tuyến
> tính không chặn nên không tồn tại tiệm cận nào.
>
> ⟹ Ca P-6 nay khẳng định **cả hai mốc**: `77460` chạm ở 1000, `77459` chưa chạm ở 1000 và chạm ở
> 1001. Đừng viết ca kiểm nào mang kỳ vọng "không bao giờ chạm" — nó sẽ xanh vì lý do sai.

**P-7: `speed_policies = []` ⟹ `Redeem` KHÔNG đòi reference input nào ngoài beacon**

```
Setup: beacon genesis với speed_policies = [] (§1.4).
Dựng tx Redeem hợp lệ, KHÔNG kèm reference input nào ngoài beacon UTxO.
Kỳ vọng: TX confirm.
Phép đo đúng là ĐẾM reference input của tx, KHÔNG phải đọc số LAMP nhận được — một hiện thực
  đòi thêm reference input mà vẫn trả đúng số tiền sẽ đi lọt phép đo thứ hai.
Ca đối xứng: speed_policies = [<1 policy>] ⟹ tx thiếu reference input tương ứng phải TỪ CHỐI.
  Không có ca đối xứng thì ca trên xanh cả khi móc chưa được nối vào đâu cả.
```

### 2.2 Negative — edge + attack

> **Con trỏ dòng trong §2.2 đã đo lại 2026-09-22 trên `Distribution/onchain/validators/claim_account.ak`.**
> Bản v2 của tệp này dẫn một bộ số dòng **lệch hẳn ~50 dòng** (vd `claim_account.ak:95` cho
> `expect amount > 0`, thực tế `:158`), và mọi con trỏ sai ấy vẫn trỏ vào một dòng CÓ THẬT — hỏng
> ở chiều im lặng nhất. Nơi nào tham chiếu cần sống lâu hơn một lần sửa thì neo bằng **tên hàm**.

**N-1: Xin quá trần tích luỹ → TỪ CHỐI (lệch ĐÚNG 1 oildrop)**

```
Từ P-1: trần tích luỹ ở cửa sổ 3 là 232_380_000_000. Xin 232_380_000_001.
Validator: (0 + 232_380_000_001)² > 1·E·A_span² → vế bình phương fail.
Biên phải là ±1 oildrop. Ca xin "gấp đôi trần" cũng đỏ, nhưng nó đỏ ở mọi hiện thực sai-lệch-hằng
  nên nó không định vị được chốt; chỉ ca lệch 1 mới phân biệt `≤` với `<`.
Ca đối xứng BẮT BUỘC: xin đúng 232_380_000_000 phải XANH. Thiếu vế này thì một hiện thực
  từ-chối-tất-cả cũng qua được N-1.
```

> ⚠ **N-1 của bản v2 mô tả một CƠ CHẾ KHÁC và nó không còn tồn tại.** Bản cũ nói tx "khai `amount`
> lớn hơn" rồi bị bắt ở chỗ `out.redeemed` không khớp con số validator TỰ TÍNH. v3 không có con số
> tự tính nào để khớp — validator chỉ kẹp. Đây là chỗ khác nhau về hình dạng, không phải về số.

**N-2: `amount = 0` hoặc âm → TỪ CHỐI**

```
Kịch bản A: A_span = 0 (rút ngay cửa sổ mở) → trần tích luỹ = 0 → không có amount > 0 nào hợp lệ.
Kịch bản B: redeemed đã == E (rút hết) → mọi amount > 0 vỡ vế `redeemed + amount ≤ E`.
Kịch bản C: xin amount âm (kiểm rõ ràng — số nguyên Plutus có dấu, và một `amount` âm ĐI QUA
  được vế bình phương). Đây là ca bản v2 không có.
Chốt: `expect amount > 0` — hôm nay ở claim_account.ak:158 (nhánh Redeem).
```

**N-3: Không có chữ ký owner → TỪ CHỐI**

```
TX redeem không có PKH datum.owner trong extra_signatories.
Chốt: `expect list.has(tx.extra_signatories, datum.owner)` — claim_account.ak:136.
Test đã có: redeem_no_owner_sig() fail — claim_account.ak:628.
```

**N-4: Double-satisfaction (2 ClaimAccount output cùng script hash) → TỪ CHỐI**

```
TX chứa 2 output tại script hash claim_account (stake cred khác nhau để bypass stake check).
Chốt: `expect util.count_outputs_at_script(tx.outputs, own_hash) == 1` — claim_account.ak:52
  (và count_inputs_at_script == 1 ở :51).
Cơ chế: đếm theo PAYMENT script hash, không phải toàn địa chỉ.
Test đã có: redeem_double_satisfaction() fail — claim_account.ak:640.
```

**N-5: Beacon giả (wrong-beacon / datum hijack) → TỪ CHỐI**

```
Kịch bản 1: reference input đúng địa chỉ nhưng KHÔNG mang beacon NFT → tra cứu trả None → fail.
Kịch bản 2: có NFT nhưng `kind ≠ DropParam` → `expect bd.kind == DropParam` fail.
Chốt: hàm tra cứu beacon trong claim_account.ak (hôm nay tên là `find_drop_value`, :195-207).
```

> ⚠ **CHƯA CÓ TRONG MÃ — tên hàm ở N-5 sẽ đổi.** `find_drop_value` trả về `drop_value`, trường v3
> đã bỏ. Hiện thực v3 cần một hàm trả về `(index, epoch, rate_root, trim_num, trim_den,
> speed_policies)`. Ca N-5 vẫn đúng về NỘI DUNG (authenticity qua NFT + `kind`), chỉ con trỏ tên
> hàm là thứ phải sửa lại sau lượt đúc.

**N-6: Tamper value của ClaimAccount UTxO → TỪ CHỐI**

```
TX output ClaimAccount mang thêm token ngoài, hoặc thiếu NFT tài khoản.
Chốt: `expect acc_out.value == acc_in.value` — claim_account.ak:61 (bảo toàn value tuyệt đối),
  cộng hai mệnh đề NFT tài khoản ở claim_account.ak:79-82 (tên NFT == blake2b_256(owner)).
Test đã có: claim_value_tamper() fail — claim_account.ak:456.
```

**N-7: Mint trong TX redeem → TỪ CHỐI**

```
TX kèm mint ≠ 0 (bất kỳ asset nào).
Chốt: `expect assets.is_zero(tx.mint)` — claim_account.ak:47.
Test đã có: redeem_mint_rejected() fail — claim_account.ak:655.
```

**N-8: Đổi field bất biến trong out datum ở nhánh `Redeem` → TỪ CHỐI**

```
Đổi từng field MỘT LẦN MỘT, mỗi field một ca riêng — gộp vào một ca thì một field bị quên
  vẫn đỏ nhờ field khác:
  owner · entitlement · start_epoch · drops_per_epoch · index_at_start
Chốt hôm nay: claim_account.ak:172-176 (bốn field đầu).
```

> ⚠ **`index_at_start` CHƯA CÓ TRONG MÃ, và nó là ca dễ hụt nhất trong N-8.** CONTRACT v3 §4 mục 3
> nói rõ nó phải **nằm trong danh sách ép bất biến**, không phải được suy ra là bất biến: ghi đè
> được `index_at_start` thì người rút **tự đặt lại gốc thời gian của chính mình** — đặt về một giá
> trị nhỏ là tự cấp `A_span` lớn tuỳ ý, tức bỏ qua toàn bộ lịch vesting trong một giao dịch. Vì bốn
> field kia đã có mệnh đề sẵn, một hiện thực quên đúng field thứ năm vẫn qua mọi ca N-8 viết theo
> bản v2.

**N-11: Mở tài khoản với `drops_per_epoch ≠ 1` → TỪ CHỐI**

```
Nhánh CREATE (treasury.ak) với dpe = 2 → TỪ CHỐI (C-ACC-DPE, CONTRACT v3 §1b).
Kiểm CẢ dpe = 0 (biên dưới) VÀ dpe = 100 (giá trị v2 còn cho qua — constants.ak:45
  drops_per_epoch_max = 100). Chỉ kiểm dpe = 2 thì một hiện thực ép `dpe ≤ 1` cũng qua,
  và nó khác `dpe == 1` ở đúng ca dpe = 0.
Vì sao phải có: v2 cho qua MỌI giá trị trong [1, 100], nên đây là chốt MỚI hoàn toàn —
  không ca cũ nào canh nó.
```

> ⚠ **CHƯA CÓ TRONG MÃ.** `constants.ak:39-45` còn `drops_per_epoch_max = 100`; chốt `== 1` chưa
> tồn tại ở đâu.

**N-12: `total_redeemed` ra sai → TỪ CHỐI (kiểm CẢ HAI chiều)**

```
Chiều thiếu:  total_redeemed_out = total_redeemed_in            (không cộng)
Chiều thừa:   total_redeemed_out = total_redeemed_in + amount + 1
Cả hai phải TỪ CHỐI (C-RDM-TOTAL, CONTRACT v3 §4 mục 6).
Đi CẶP: outstanding_entitlement_out == outstanding_entitlement_in − amount (C-SOLV-3).
  Kiểm cặp này riêng — hai vế dùng cùng một `amount` theo hai chiều ngược nhau, và thiếu MỘT vế
  làm mẫu số của phép cắt ngọn trôi khỏi sự thật mà không dòng nào kêu.
Chiều thiếu là chiều nguy hiểm hơn và nó KHÔNG tự lộ: total_redeemed đứng yên chỉ làm trần cắt
  ngọn siết hơn thật, tức mọi giao dịch vẫn hợp lệ, chỉ đơn giản nhỏ dần.
```

> ⚠ **CHƯA CÓ TRONG MÃ.** `TreasuryDatum` hôm nay không có trường `total_redeemed`.

**N-13: Cắt ngọn — xin quá trần thì NHẬN MỘT PHẦN, KHÔNG phải lỗi**

```
Setup: total_redeemed = 1_000_000_000_000_000 (1 tỷ LAMP) ⟹ trần cắt ngọn
       = max(1e9, 1e15/1000) = 1_000_000_000_000 = 1.000.000 LAMP.
       Tài khoản có trần tích luỹ dư sức cho 3.000.000 LAMP.
Xin amount = 3_000_000_000_000 (3 triệu LAMP) ⟹ TỪ CHỐI (vượt trần cắt ngọn).
Xin amount = 1_000_000_000_000 (1 triệu LAMP) ⟹ XANH, và phần còn lại GIỮ NGUYÊN QUYỀN.
Rồi ở cửa sổ sau xin tiếp ⟹ XANH.
```

> ⚠ **Ca này dễ viết sai thành "reject rồi thôi".** Ngữ nghĩa cắt ngọn là **hoãn**, không phải
> **tịch thu** (Math-Spec v3 §5, M-TRIM-FINITE). Phép kiểm phải đi tới lượt sau và xác nhận phần
> thừa vẫn rút được; dừng ở lượt bị từ chối thì ca xanh với cả một hiện thực làm mất phần thừa.

**N-14: `rate_root` giảm ở lượt post beacon → TỪ CHỐI**

```
Beacon in: rate_root = 77460. Post out: rate_root = 77459 ⟹ TỪ CHỐI (C-BCN-5', CONTRACT v3 §3b).
Ca đối xứng: post out rate_root = 77461 ⟹ XANH (chỉ-nới là hợp lệ).
Vì sao phải có: v2 dùng `abs_diff` — ĐỐI XỨNG — nên nó chặn TỐC ĐỘ đổi mà KHÔNG chặn CHIỀU.
  Một ca chỉ kiểm "đổi quá 10% thì đỏ" XANH ở cả hai chiều và không canh gì ở đây.
Và ca cộng dồn: index_out == index_in + rate_root_in·(epoch_out − epoch_in) (C-BCN-6) —
  dùng rate_root VÀO, không phải rate_root RA. Ca dùng nhầm vế chỉ lộ khi hai giá trị khác nhau,
  nên ca này phải chạy ở một lượt post CÓ đổi rate_root.
```

> ⚠ **CHƯA CÓ TRONG MÃ.** `constants.ak:47-52` còn `max_drop_delta_q` với chú thích nói rõ nó ép
> `|D_mới − D_cũ|`, tức còn đối xứng.

**N-9: Committee không đủ threshold cho Claim → reject**

```
Claim TX chỉ 1 committee sig khi threshold=2.
Chốt: `expect util.committee_approved(committee, threshold, tx.extra_signatories)` — claim_account.ak:95.
Test đã có: claim_insufficient_committee() fail — claim_account.ak:445.
```

**N-10: Cấp `E` vượt pool → TỪ CHỐI ON-CHAIN (không chỉ off-chain)**

```
Ca on-chain (tầng ĐÚNG, và bản v2 không có ca này):
  Claim với granted làm outstanding_entitlement_out > pool LAMP của kho ⟹ TỪ CHỐI.
  Chốt: C-SOLV-2 (CONTRACT v3 §4b mục 3), ép trong treasury.ak nhánh GrantEntitlement.
  Biên: outstanding_entitlement_out == pool phải XANH; == pool + 1 phải ĐỎ.
Ca off-chain (giữ, vì nó cho thông báo đọc được thay vì một tx bị từ chối không rõ lý do):
  claimBuilder solvency guard → CLAIM-010 khi under-collateralized.
  redeemBuilder.ts:168 — throw `REDEEM-012` khi treasury pool < amount.
Verify chủ động: `npm run verify-solvency` (05_verify_solvency.ts) — query kho + MỌI account,
  assert treasury_lamp ≥ Σ(E−redeemed). BẮT BUỘC PASS trước khi mở Claim trên mainnet.
```

> ⚠ **BẢN v2 GHI SAI TRẠNG THÁI Ở DÒNG CUỐI N-10.** Nó viết *"bất biến solvency CHƯA ép on-chain ở
> tầng validator"*. Điều đó **không còn đúng**: `outstanding_entitlement` có trong `TreasuryDatum`
> và C-SOLV-1/2 chạy ở `treasury.ak`. Một ca kiểm viết theo câu cũ sẽ kỳ vọng "cấp vượt pool thì
> qua được on-chain, chỉ off-chain chặn" — tức nó sẽ **đỏ vì hệ đã đúng**, và người đọc kết quả rất
> dễ chữa ca thay vì chữa nhận định. Xem §4.2.

### 2.3 Chạy test Aiken (on-chain unit tests)

```bash
cd Distribution/onchain
aiken check
```

`claim_account.ak` hiện có **29 bài** (`grep -c '^test ' `, 2026-09-22), trải từ dòng 352 tới cuối
tệp. Bản v2 của tệp này kê **12 bài** và ghi dải `:192-386` — cả số bài lẫn dải dòng đều đã lệch,
nên bảng liệt kê tay đó đã bị gỡ: **một bản sao danh sách bài kiểm chép bằng tay không có đường
nào biết nguồn của nó đã đổi.** Lấy danh sách thật bằng một lệnh, đừng đọc bảng:

```bash
grep -n '^test ' Distribution/onchain/validators/claim_account.ak
```

**Bài kiểm v3 phải có — đối chiếu CONTRACT v3 §8b và §2.1/§2.2 ở trên.** Danh sách bài hiện tại
bám hình dạng v2 (`redeem_happy` ở `claim_account.ak:530` dùng `E=1000, D=100`), nên sau lượt đúc
v3 **không bài nào trong 29 bài đó còn biên dịch được** — `ClaimAccountDatum` đổi số trường. Đây là
việc viết lại, không phải việc cập nhật.

> **Đừng phát biểu "chốt X đã được ghim" chỉ vì có một bài ĐỎ ở chốt X.** Bài có thể trượt xuống
> chốt kế tiếp và chết ở đó — đúng tên, đúng màu. Phép đo đúng là **gỡ hẳn chốt X rồi chạy trọn bộ
> kiểm**: còn xanh ⟹ không bài nào canh. Chưa chạy phép đó thì mức phát biểu đúng là *"có bài đỏ ở
> chốt X"*. Áp riêng cho P-6 (`rate_root`): xem mục 4 của P-6 về việc cắm dấu riêng.

---

## 3. ISPO Integration Guide

Hướng dẫn operator (stake pool/launchpad) thiết lập `E` (entitlement) cho delegators.

### 3.1 Mô hình ISPO

Mỗi delegator nhận `E` LAMP tỷ lệ với ADA stake tích lũy trong N epoch. Operator tính `E` off-chain từ snapshot stake, rồi dùng committee M-of-N ký Claim TX để gán `E` vào ClaimAccount. Sau đó delegator tự redeem: mỗi cửa sổ mở thêm `√E · rate_root` oildrop, cap `E`.

### 3.2 Tính E cho delegator

```
E_delegator (oildrop) = (ada_delegated / ada_total_pool) × TOTAL_ISPO_FUND × participation_epochs / N
```

Ví dụ: pool tổng 1_000_000 ADA, ISPO fund 50_000_000 LAMP, N=10 epoch, delegator A stake 10_000 ADA trong 8 epoch:

```
E_A = (10_000 / 1_000_000) × 50_000_000 × (8/10)
    = 0.01 × 50_000_000 × 0.8
    = 400_000 LAMP = 400_000_000_000 oildrop
```

### 3.3 `rate_root` — hằng thang TOÀN CỤC, KHÔNG phải núm đặt theo đợt

**Đây là thay đổi về BẢN CHẤT so với v2, không phải đổi tên một tham số.** Ở v2, `D` là tốc độ
tuyệt đối và operator đặt được cho từng đợt ISPO: muốn nhỏ giọt 30 cửa sổ thì đặt `D = E_avg/30`.
Ở v3, **núm đó không còn tồn tại.**

```
mỗi cửa sổ mở thêm:  dpe · √E · rate_root      với dpe ≡ 1, rate_root = 77460
số cửa sổ để chạm E:  n* = ⌈ √E / rate_root ⌉
```

`rate_root` không nằm trong công thức theo kiểu một tốc độ đặt được cho một nhóm — nó là **thang
đo chung của toàn hệ**, đúng một giá trị cho mọi tài khoản của mọi đợt. Thứ quyết định một suất
rút nhanh hay chậm là **cỡ của chính suất đó**:

| `E` | `n*` = số cửa sổ để rút hết | ghi chú |
|---|---|---|
| 1.000 LAMP | **1** | `√E/w = 0,41` — xong trong cửa sổ đầu (mốc hiệu chỉnh của `trim_floor`) |
| 1.000.000 LAMP | **13** | `√E/w = 12,91` |
| 2.379.930 LAMP (ETD-max) | **20** | `√E/w = 19,916` — **mốc hiệu chỉnh 1** |
| 6.000.000.000 LAMP (pot sáng lập) | **1.000** | `√E/w = 1000,0000` — **mốc hiệu chỉnh 2** |

Hai mốc hiệu chỉnh ấy **ép ra** `rate_root`, chứ không phải được chọn sau khi có nó
([`Math-Spec.md`](./Math-Spec.md) v3 §7). Nên **operator KHÔNG có "chiến lược nhỏ giọt" để chọn**:
đặt lịch vesting của một đợt ISPO = đặt **cỡ pot**, không phải đặt một tham số beacon.

**Ba hệ quả vận hành, đều ngược với thói quen v2:**

1. **`rate_root` CHỈ ĐƯỢC NỚI** (C-BCN-5′, CONTRACT v3 §3b). Không có đường siết. v2 cho đổi `D`
   hai chiều trong biên ±10%/lượt, và chiều giảm ấy hạ `vested` **hồi tố** xuống dưới `redeemed`
   đã lưu, khoá tài khoản lại. Muốn điều tiết theo thị trường thì dùng **kênh cắt ngọn**
   (`trim_num`/`trim_den`) — kênh đó siết thoải mái vì nó chỉ hoãn một lượt rút, không bao giờ hạ
   `vested`.
2. **Tách một suất lớn thành nhiều suất nhỏ thì NHANH HƠN, theo `√n`.** Tách `E` thành `n` phần
   bằng nhau cho tổng tốc độ `√n` lần (M-SPLIT, Math-Spec v3 §8). Pot 6 tỷ tách 36 phần đi từ 23,7
   năm xuống ≈2,3 năm. Với ISPO điều này có nghĩa: **danh sách delegator càng vụn thì tổng LAMP ra
   thị trường mỗi cửa sổ càng lớn**, và operator phải tính con số đó TRƯỚC khi mở Claim, không
   phải phát hiện sau. Luật căn kháng tách chứ không miễn nhiễm; nó **không thay được** một trần
   trên số tài khoản (CONTRACT v3 §4d).
3. **Ngay sau khi mở sổ, cắt ngọn mới là trần ráo, không phải trần tích luỹ.** Với
   `total_redeemed` còn nhỏ, trần mỗi lượt là `trim_floor = 1.000 LAMP`. Một delegator suất
   1.000.000 LAMP mở khoá 77.460 LAMP ở cửa sổ đầu nhưng **chỉ rút được 1.000 LAMP mỗi lượt** cho
   tới khi `total_redeemed` toàn hệ lên đủ cao. Đây là hành vi đúng theo thiết kế, **nhưng nó sẽ
   bị đọc như một lần tịch thu nếu giao diện không tách "rút được cửa sổ này" khỏi "còn lại tổng"**
   (CONTRACT v3 §10). Với ISPO, phải nói rõ điều này với delegator TRƯỚC đợt, không phải sau lượt
   rút đầu tiên.

**Operator KHÔNG post `rate_root` theo đợt.** Lượt post beacon sau genesis chỉ để (a) đẩy `index`
tiến theo C-BCN-6, (b) nới `rate_root` nếu có quyết định nới, (c) chỉnh `trim_num`/`trim_den`.
Không lượt nào trong ba việc đó là "cấu hình một đợt ISPO".

> ⚠ **CHƯA CÓ TRONG MÃ.** `beacon.ak` hôm nay post `drop_value` và ép biên bằng `abs_diff`
> (`constants.ak:47-52`). Không có `rate_root`, không có `index`, không có C-BCN-6.

### 3.4 Flow operator thiết lập ISPO

```
1. Chụp snapshot stake (off-chain, ngoài protocol).
2. Tính E cho từng delegator (bước 3.2).
3. Tính TRƯỚC tổng thông lượng: Σ(√Eᵢ)·rate_root oildrop mở khoá mỗi cửa sổ, và số lượt Redeem
   cần thiết sau khi áp cắt ngọn (§3.3 hệ quả 2 + 3, và KL-9 ở §4).
4. Mở tài khoản cho từng delegator qua `treasury.spend` nhánh CREATE — **KHÔNG phải pay-to-address
   thuần**. Mỗi tài khoản phải mang NFT `claim_account_nft` tên `blake2b_256(owner)`, nếu không nó
   không tiêu được (`claim_account.ak:79-82`). Datum v3:
   `{owner, entitlement, redeemed=0, start_epoch=<cửa sổ này>, drops_per_epoch=1, index_at_start=A(bây giờ)}`.
5. Committee cấp entitlement (Claim TX) theo danh sách E đã tính.
   - Mỗi Claim TX: 1 account (validator ép `count_inputs_at_script == 1` và
     `count_outputs_at_script == 1`, `claim_account.ak:51-52`). Số TX = số delegator.
   - **Mọi Claim BẮT BUỘC co-spend treasury** (C-SOLV-1, `claim_account.ak:124-128`) ⟹ mọi Claim
     nối tiếp nhau qua MỘT UTxO kho, không song song được.
6. Delegator tự redeem từ cửa sổ kế trở đi.
```

> ⚠ **Bước 4 của bản v2 sai ở một chỗ có hậu quả.** Nó viết *"KHÔNG cần Plutus script cho genesis
> (chỉ pay-to-address) nếu committee tạo UTxO chứa datum inline"*. Cardano **không chạy validator
> lúc TẠO output**, nên một tài khoản dựng kiểu đó mang datum do người tạo tự viết mà kho chưa từng
> ghi khoản nợ ấy vào sổ. Đó đúng là lỗ C-ACC-0 và mã đã vá: `claim_account.ak:79-82` đòi NFT tài
> khoản, mà lối vào duy nhất của NFT đó là một tx có committee ký VÀ có input TRSY — tức khoản nợ
> ĐÃ VÀO SỔ. Làm theo câu cũ thì tài khoản dựng ra **không tiêu được**, và điều đó chỉ lộ ra ở lượt
> redeem đầu tiên.

### 3.5 `start_epoch` và `index_at_start`

- `start_epoch` **KHÔNG còn tham gia phép tính `vested`** ở v3 (CONTRACT v3 §2). Nó giữ lại làm
  dữ kiện kiểm toán. Thứ mang thời gian vào phép tính là `index_at_start`. **Cấm** dùng
  `start_epoch` thay `index_at_start`.
- Operator **không chọn được** `start_epoch`: nhánh CREATE của `treasury.ak` và nhánh `Claim` đều
  ép nó == cửa sổ chạy tx (`claim_account.ak:115`, `get_epoch_strict` — cận HAI phía: không lùi để
  mang tuổi sang, không tiến để khỏi thành bẫy một chiều). Muốn vesting bắt đầu sau ISPO thì **mở
  tài khoản sau ISPO**, không phải đặt một con số.

### 3.5a Điểm treo ảnh hưởng lịch ISPO — danh mục trạng thái

| mã định danh | treo cái gì | ràng buộc TẠM đang có hiệu lực (fail-closed) | khai ở file nào |
|---|---|---|---|
| ISPO-IDXSTART-CLAIM-01 | **ĐÃ ĐÓNG 2026-09-22.** CONTRACT v3 §4b nay mang `C-CLAIM-8`: `out_datum.index_at_start == A(cửa_sổ_hiện_tại)` ở nhánh `Claim`. Nhánh `Claim` là REBASE toàn phần (`redeemed → 0`, `start_epoch →` cửa sổ hiện tại), nên trường mang ngữ nghĩa thời gian phải rebase theo; giữ nguyên thì lô cấp thêm vest gần như tức thì vì nó thừa hưởng `A_span` của lô cũ | Ràng buộc tạm ĐÃ GỠ — cấp thêm `E` cho tài khoản đã chạy là hợp lệ khi validator ép `C-CLAIM-8`. Trước khi mã có mệnh đề đó thì ràng buộc tạm vẫn hiệu lực: chỉ mở tài khoản MỚI | `capped-drop/CONTRACT.md` v3 §4b ▸ `C-CLAIM-8` |

### 3.6 Treasury

Treasury là UTxO duy nhất giữ toàn bộ LAMP pool. Operator phải:
1. **Fund treasury ≥ `Σ E_delegator` TRƯỚC khi mở Claim** (over-collateralization). Sau khi fund + cấp E, chạy `npm run verify-solvency` — PHẢI PASS (treasury_lamp ≥ Σ(E−redeemed)) mới mở redeem cho delegator. Trên mainnet đây là bước gate bắt buộc.
2. Khi cấp E qua Claim: truyền `solvency` cho `buildClaimTx` (treasuryLamp + Σ outstanding các account khác) → builder ném `CLAIM-010` nếu cấp E vượt quỹ (chặn under-collateralized từ gốc, không để first-come-first-served lúc redeem).
3. Nếu treasury cạn (thiếu LAMP): off-chain builder throw `REDEEM-012`. Operator fund thêm bằng TX thủ công (pay LAMP vào treasury address — không cần Plutus).
4. Không burn: `treasury_out = treasury_in − amount` (CONTRACT v3 §7, `treasury.ak`).
5. **Fund cho CẢ đợt, không fund theo lô.** Kho là singleton (KL-2) nên không có "quỹ của lô này";
   `C-SOLV-2` ép `outstanding_entitlement ≤ pool` trên **toàn bộ** số còn nợ của mọi pot dùng chung
   kho. Cấp `E` cho đợt mới khi pool chưa đủ sẽ bị chặn tại chỗ, không phải lúc delegator đi rút.

### 3.7 Multi-account genesis batch

Script `03_genesis.ts` tạo 2 account (A + B) làm mẫu. ISPO thật có hàng trăm delegator: operator viết script riêng để batch.

Ràng buộc per-TX:
- 1 account input + 1 output (`claim_account.ak:51-52`).
- Claim TX (cấp E): mỗi TX chỉ 1 account **và** phải co-spend kho singleton
  (`claim_account.ak:124-128`) → N delegator cần N Claim TX, và chúng **nối tiếp nhau**, không
  song song được. Đây là cùng một nút cổ chai với KL-9 dưới đây, ở chiều Claim thay vì chiều Redeem.
- Mở tài khoản: đi qua `treasury.spend` nhánh CREATE để có NFT tài khoản — xem cảnh báo ở §3.4.

---

## 4. Known limits

| ID | Giới hạn | Ảnh hưởng | Workaround |
|---|---|---|---|
| KL-1 | 1 Claim TX = 1 account (`claim_account.ak:51-52`) | ISPO 1000 delegator = 1000 TX cấp E | Batch off-chain: submit liên tục. Giới hạn thật là KL-9, không phải tốc độ submit. |
| KL-2 | **Kho là SINGLETON TOÀN CỤC** — 1 UTxO mang NFT "TRSY" | Xem KL-9. | **Không có workaround.** Bản v2 ghi "operator tách nhiều treasury UTxO" — cách đó ĐÃ BỊ ĐÓNG, xem ghi chú dưới bảng. |
| KL-3 | `start_epoch` do validator ép == cửa sổ chạy tx, operator không đặt được | Không delay được vesting bằng một tham số | Mở tài khoản đúng lúc muốn bắt đầu (§3.5). |
| KL-4 | `rate_root` là hằng thang TOÀN CỤC, không per-account, không per-đợt | Không có "chiến lược nhỏ giọt" theo đợt ISPO | Lịch vesting đặt bằng **cỡ pot** (§3.3). |
| KL-5 | `drops_per_epoch` GHIM == 1 cho mọi tài khoản (C-ACC-DPE, CONTRACT v3 §1b) | Không có núm per-account nào chạm được kênh tốc độ | Cố ý, không phải hạn chế tạm. Mở lại đòi một cơ sở đo được trên chuỗi để phân biệt tài khoản; hôm nay không có cơ sở nào như thế. |
| KL-6 | Không cancel/refund entitlement sau Claim | Sau khi Claim TX confirm, không có undo | Kiểm kỹ E trước khi Claim. |
| KL-7 | ~~Native sig beacon NFT~~ ĐÃ SỬA | One-shot Aiken `beacon_nft` đã nối vào 01_deploy/03_genesis (mode `oneshot`, mặc định trên Mainnet). Supply NFT = 1 tuyệt đối, tách khỏi ví deploy, không re-mint. native-sig chỉ còn cho Preview self-test (Mainnet fail-closed). | Đặt `BEACON_NFT_ONESHOT=1` để bật trên testnet; Mainnet tự bật. |
| KL-8 | LAMP_ASSET_NAME hardcode `4c414d50` trong DEFAULT | Khi đổi sang tLAMP canonical (`744c414d50`) phải update .env + redeploy | Luôn truyền LAMP_ASSET_NAME qua .env trong production. |
| **KL-9** | **Toàn hệ tối đa MỘT `Redeem` mỗi block** | Xem §4.1 — đại lượng CHƯA ĐO | Không có. Đây là cái giá của sổ cái solvency ép được per-tx. |
| KL-10 | Tách một suất thành `n` tài khoản cho tổng tốc độ `√n` lần (M-SPLIT) | Trần lõm kháng tách chứ không miễn nhiễm: pot 6 tỷ tách 36 phần đi từ 23,7 năm xuống ≈2,3 năm | Sổ tên NFT đã đúc (CONTRACT v3 §4d) đóng được tách theo KHOÁ, **không** đóng được tách theo NGƯỜI. Không có đường on-chain nào cho việc đó hôm nay. |

> **KL-2 đã ĐẢO NGHĨA so với bản v2 — đọc nhầm chỗ này là dựng sai cả kiến trúc vận hành.** Bản v2
> ghi workaround *"operator tách nhiều treasury UTxO (mỗi UTxO 1 lô delegator); `treasury.ak` không
> giới hạn số UTxO"*. Ở v3 **không còn làm thế được**: kho mang NFT authenticity "TRSY" một-bản
> tuyệt đối và hàm tra kho ép `expect [i]` — đúng MỘT UTxO kho trong inputs
> (`claim_account.ak` ▸ `find_treasury_in`, :231-246). Chính tính singleton đó là thứ làm
> `total_redeemed` đo được **chính xác tuyệt đối không cần quét chuỗi**, tức là thứ làm phép cắt
> ngọn rẻ bằng một phép nhân. Không thể vừa giữ cắt ngọn vừa tách kho.

### 4.1 KL-9 — thông lượng `Redeem`, đại lượng CHƯA ĐO

**Kho là singleton toàn cục ⟹ toàn hệ tối đa MỘT `Redeem` mỗi block.** Hàm tra kho ép `expect [i]`
(`claim_account.ak:231-246`), và chỉ có một UTxO mang NFT "TRSY". Mọi `Redeem` của mọi tài khoản
thuộc mọi pot đều co-spend đúng UTxO đó, nên chúng **nối tiếp tuyệt đối**. Cùng thế với `Claim`
(C-SOLV-1). Đây **không phải lỗi mới của v3** — nó là cái giá của việc có một sổ cái solvency ép
được per-tx, và v3 nhận nó có ý thức (CONTRACT v3 §4).

**Cái v3 làm nặng thêm: cắt ngọn làm TĂNG số lượt rút cần thiết.** Trần mỗi lượt là
`max(trim_floor, total_redeemed·trim_num/trim_den)`, nên một suất lớn không rút được trong một
lượt to mà phải chia thành nhiều lượt nhỏ. Càng sớm sau khi mở sổ (`total_redeemed` còn nhỏ) thì
trần càng sát `trim_floor = 1.000 LAMP`, tức số lượt càng nhiều. Hai sức ép cùng chiều: **số lượt
cần tăng, trong khi sức chứa vẫn là một lượt mỗi block.**

**ĐẠI LƯỢNG CHƯA ĐO — cả ba, không có con số nào ở đây được lấy từ một phép đo:**

| cần đo | đo bằng cách nào |
|---|---|
| Số lượt `Redeem` **cần** mỗi cửa sổ ở tải dự kiến | Mô phỏng: với danh sách `Eᵢ` thật của đợt và quỹ đạo `total_redeemed`, đếm số lượt để rút hết phần mở khoá của cửa sổ đó. Phụ thuộc mạnh vào `total_redeemed` ban đầu — chạy ở CẢ mốc `total_redeemed = 0` (chặt nhất) lẫn mốc vận hành. |
| Số block **có** mỗi cửa sổ | Tham số mạng Cardano, tra từ mạng đích. Không gõ tay — cửa sổ của cụm này là `ms_per_epoch`, không nhất thiết trùng epoch Cardano. |
| Cửa sổ nào trần bắt đầu ráo | Tỉ số hai số trên vượt 1 ở cửa sổ nào. |

**Không suy ra được từ những gì đã có, và cũng không đoán ở đây.** Cho tới khi có ba con số đó,
phát biểu đúng mức là *"KL-9 là một trần thông lượng đã biết, chưa biết nó có ráo ở tải dự kiến
không"* — không phải *"đủ dùng"*, cũng không phải *"sẽ nghẽn"*.

**Một hệ quả về an ninh đã biết, không cần chờ đo:** ai muốn bóp nghẹt đường rút chỉ cần chen một
`Redeem` nhỏ của chính mình mỗi block; chi phí là phí mạng. Không có cơ chế chống việc đó trong
thiết kế hiện tại.

### 4.2 NỢ-CROSS — solvency on-chain: trạng thái

Bất biến `Σ(E − redeemed) ≤ pool` **đã được ép on-chain ở v3** qua sổ cái
`outstanding_entitlement` trong `TreasuryDatum` + tính singleton của kho (C-SOLV-1/2,
CONTRACT v3 §4b). Bản v2 của tệp này xếp đây là điểm treo và đề xuất giữ ba lớp off-chain; **mục
treo đó đã đóng** — cái v2 gọi là "đánh đổi phải chọn" thì v3 đã chọn: nhận nút cổ chai (KL-9) để
đổi lấy solvency ép được per-tx.

Ba lớp off-chain **vẫn giữ** và vẫn chạy trước, vì chúng cho thông báo lỗi sớm và đọc được thay vì
một tx bị từ chối không rõ lý do: `CLAIM-010` (claim-time guard) · `REDEEM-012` (redeem-time
guard) · `npm run verify-solvency`.

**Phạm vi của câu "đã ép on-chain" — đúng một vế, không phải cả hai.** `TreasuryDatum` hôm nay có
**đúng 2 trường**: `committee_hash` và `outstanding_entitlement`
(`Distribution/onchain/lib/magiclamp/lampdist/types.ak:51-53`). `total_redeemed` **CHƯA CÓ TRONG
MÃ**. Nên:

| vế | trạng thái |
|---|---|
| solvency (`Σ(E − redeemed) ≤ pool`) | **ĐÃ ÉP ON-CHAIN** — `types.ak:51-53` + C-SOLV-1/2 ở `treasury.ak` |
| cắt ngọn (`amount ≤ max(trim_floor, total_redeemed·κ)`) | **CHƯA CÓ GÌ ĐỂ ÉP** — không có trường mang mẫu số, không có hằng `trim_floor` |

---

## 5. v-next (post-MVP)

Theo CONTRACT v3 §5 và §10.

**Đã ĐÓNG ở v3 — gỡ khỏi danh sách chờ, và ghi ra vì sao, để không ai mở lại:**

| mục v2 | trạng thái ở v3 |
|---|---|
| ~~DAO multi-drop per-DID~~ (DAO tăng `drops_per_epoch` cho DID uy tín) | **ĐÓNG.** `C-ACC-DPE` ghim `dpe ≡ 1` cho mọi tài khoản (CONTRACT v3 §1b). `dpe` nhân thẳng vào tốc độ nên để nó tự do là một cửa sau xuyên thủng chính trần lõm, và tỉ lệ lợi **không đổi dù siết `trim_num` bao nhiêu** — nó nằm ở kênh tốc độ, không ở kênh cắt ngọn. Mở lại ở v4 đòi một cơ sở đo được **trên chuỗi** để phân biệt tài khoản; hôm nay không có. |
| ~~Pause/penalty qua `drops_per_epoch = 0`~~ | **ĐÓNG cùng lý do trên.** Ngoài ra `dpe = 0` là một thừa số GIẢM ĐƯỢC ngoài tổng — đúng lớp lỗi hồi tố mà v3 sinh ra để vá (M-CHANNEL, Math-Spec v3 §4). Muốn điều tiết thì dùng `trim_num`/`trim_den`: chúng chỉ chạm lượt rút tương lai. |
| ~~Beacon NFT one-shot Aiken policy~~ | **ĐÃ SHIP** — `beacon_nft.ak` có trong kho, nối vào `01_deploy`/`03_genesis` (KL-7). |
| ~~Treasury multi-UTxO (auto-split)~~ | **ĐÓNG, và nó ĐỐI LẬP với v3.** Kho phải là singleton để `total_redeemed` đo được chính xác không cần quét chuỗi — xem ghi chú dưới bảng KL. Tách kho là bỏ cắt ngọn. |

**Còn chờ:**

| Tính năng | Mô tả | Chờ |
|---|---|---|
| **Nối `consumed MAGIC` (`speed_policies`)** | Móc đã cắm ở CONTRACT v3 §5, RỖNG ở lượt đúc này. Bật là một lượt post beacon. Ràng buộc bắt buộc lên `g_min` (CONTRACT v3 §5a): `g` phải là HỆ SỐ, không được thành một CỔNG — tài khoản `consumed = 0` vẫn phải vest hết đúng lịch. | Quyết định giá trị `g_min`; Math-Spec v3 §9 cho `g_min ≥ 0,1194977`, đề xuất `1/8`. |
| **Batch Claim (nhiều account/TX)** | Giảm số TX cấp E cho ISPO lớn (KL-1). Cần đổi guard `count_inputs/outputs`. | Spec + audit lại double-satisfaction. Lưu ý: **không gỡ được KL-9** — co-spend kho vẫn nối tiếp. |
| **Trần theo NGƯỜI (chống tách tài khoản)** | KL-10. Sổ tên NFT đã đúc (CONTRACT v3 §4d) đóng tách-theo-KHOÁ; tách-theo-NGƯỜI thì không có đường on-chain nào hôm nay. | Điểm treo `Governance/VotingPower/CONTRACT.md §3 [IDENT-ONE-PERSON]`. |
| **Giao diện tách "rút được cửa sổ này" khỏi "còn lại tổng"** | Off-chain, nhưng CONTRACT v3 §10 xếp là **bắt buộc trước khi có người dùng thật**: không có nó thì mỗi lần cắt ngọn sẽ đọc như một lần tịch thu. | Đội giao diện. |
| **Entitlement revoke (với DID penalty)** | DAO thu hồi entitlement theo verdict; chỉ rút về kho phần chưa rút. | Governance penalty flow. |
| **tLAMP canonical** | Đổi LAMP_ASSET_NAME từ `4c414d50` sang `744c414d50` khi tLAMP ship mainnet. Redeploy toàn bộ (KL-8). | `fix/lamp-name-canonical` merge main. |

---

*Mọi phát biểu về trạng thái mã trong tệp này neo `tệp:dòng` hoặc tên hàm, đo 2026-09-22 trên
`Distribution/`. Chỗ chưa có mã thì mang nhãn `CHƯA CÓ TRONG MÃ`; chỗ chưa đo được thì mang nhãn
`CHƯA ĐO` hoặc `CHƯA KIỂM`. Không nhãn nào trong ba nhãn đó được đọc thành "đã kiểm, sạch".*
