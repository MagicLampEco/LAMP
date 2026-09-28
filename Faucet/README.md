# Faucet tLAMP — self-serve, DID-gated, rate-limited, tự thu hồi

> **Phiên bản:** v3.1 — 2026-09-28. Bump từ v3.0 vì mã thêm sổ một-DID-một-account
> (`PoolDatum.opened_root`, bất biến INV-ONE-ACCT), `ClaimOpen`/`Reclaim` mang bằng chứng MPF, và
> ngưỡng thu hồi hạ 1001 → 72 cửa sổ. v3.1 **chưa deploy**.
> Bản v3.0 nâng cấp từ bản tả v2 vì v2 sai ở bốn chỗ mã đã đổi:
> `FaucetConfig` không còn `reclaim_epochs`, datum POOL nay là `PoolDatum` (có bộ đếm tốc độ),
> `PoolRedeemer` 4 nhánh chứ không 2, và `ACCT` NFT không còn là một asset name cố định.
> **Vai:** điểm vào của module — chỉ dẫn tìm đường, KHÔNG phải nguồn chân lý. Khi lệch với mã
> trong `onchain/`, **mã thắng**.

Faucet cấp tLAMP test cho dev/máy dựng trên Cardano. **Self-serve permissionless** (ai cũng claim
qua SDK, kể cả bot), nhưng **mọi lượt claim phải mang một DID NFT**, và **mỗi DID có tối đa một
account đang sống**. Pool hữu hạn được giữ bằng **hai tầng chặn khác mục tiêu** — trần tốc độ toàn
cục và cooldown per-DID — cộng với **tự thu hồi token nằm không**.

## Hằng số và tham số cấu hình

| Tham số | Giá trị chuẩn | Nơi giữ | Đổi được sau deploy? |
|---|---|---|---|
| `drip_oildrop` | `1_001_000_000` (1001 tLAMP) | `FaucetConfig` trong datum POOL | **Không** — C-CFG-1 đóng băng |
| `cooldown_epochs` | `36` cửa sổ | `FaucetConfig` | **Không** — C-CFG-1 đóng băng |
| `max_claims_per_window` | deploy Preprod: `20`; trần cứng `100` | `FaucetConfig` | **Không** — C-CFG-1 đóng băng |
| ngưỡng thu hồi | `72` cửa sổ (≈ 360 ngày với cửa sổ 5 ngày; 72 ngày trên Preview) | hằng compile-time `reclaim_epochs_const` ở `lib/magiclamp/faucet/handlers.ak` | Không — phải biên dịch lại |
| `ms_per_epoch` | theo mạng | tham số compile-time của cả ba script | Không — phải biên dịch lại |

**`FaucetConfig` KHÔNG còn chỉnh được sau deploy.** Bản v2 ghi "chỉnh không cần redeploy" — điều đó
sai với mã hiện tại: `faucet_pool.spend` ép `out_pd.cfg == cfg` ở mọi lượt spend (C-CFG-1), và POOL
NFT là one-shot nên không có đường đúc lại datum. Cổng DUY NHẤT còn ép được cấu hình là lúc đúc
POOL NFT (`handlers.nft_mint` ▸ `MintPool`, các chốt C-MP-1..8).

**Ngưỡng thu hồi chỉ có MỘT nơi giữ.** Bản v2 để một bản sao `reclaim_epochs` trong
`FaucetConfig`; bản sao đó không được cưỡng chế ở đâu cả nên đã bỏ. Nay `reclaim_epochs_const` ở
`handlers.ak` là nguồn duy nhất; `RECLAIM` trong `offchain/src/constants.ts` là **bản chép có nhãn**
dùng để offchain tự tính "đã đủ idle chưa" trước khi dựng tx, và có ca kiểm đọc thẳng hằng on-chain
để bản chép không lệch im lặng.

**Vì sao 72 chứ không 1001.** Từ v3.1, thu hồi là đường DUY NHẤT trả một DID về trạng thái "chưa có
account" trong sổ `opened_root`. 1001 cửa sổ (≈ 13,7 năm) trên thực tế là không bao giờ; 72 nằm trong
tầm đời một mạng test.

**"Cửa sổ" (window) KHÔNG phải epoch Cardano.** Nó là bucket `posix_ms / ms_per_epoch`; biên bucket
không trùng biên epoch mạng. Xem chú thích đầu `lib/magiclamp/faucet/ledger.ak`.

## Hai tầng chặn — mục tiêu KHÁC nhau, đừng đọc tầng hai rộng hơn nó làm

| Tầng | Cơ chế | Chốt trong mã | Chặn được gì |
|---|---|---|---|
| **Trần tốc độ toàn cục** | `PoolDatum{window_epoch, claims_in_window}` so với `cfg.max_claims_per_window` | `faucet_pool.ak` ▸ `check_claim` (C-RATE-0..4) | vét pool. Cứng, không phụ thuộc số DID |
| **Cooldown** | `cfg.cooldown_epochs` giữa hai claim của cùng MỘT account | `faucet_pool.ak` ▸ nhánh `ClaimAgain` (C-COOL-1) | spam của một DID — vì mỗi DID chỉ có một account sống (INV-ONE-ACCT) |

Tầng cooldown ràng theo DID nhờ **INV-ONE-ACCT**: `PoolDatum.opened_root` là gốc một Merkle Patricia
Forestry chứa khoá `blake2b_224(did_name)` của mọi DID đang có account. `ClaimOpen` phải chứng minh
khoá VẮNG rồi chèn nó (C-OPEN-UNIQ-1), `Reclaim` phải chứng minh khoá CÓ rồi xoá nó và đốt ACCT NFT
(C-RECL-UNIQ-1, C-RECL-BURN-1), `ClaimAgain` và `TopUpPool` giữ nguyên gốc (C-ROOT-KEEP-1), `MintPool`
khởi tạo gốc rỗng (C-MP-8). Sổ đó chỉ có nghĩa khi ACCT NFT không đúc được ở đường khác, nên ba chốt
`C-MINT-ONLY-OPEN-1` (`ClaimAgain`) · `C-MINT-ONLY-OPEN-2` (`TopUpPool`) · `C-RECL-BURN-2` (`Reclaim`)
ép `tx.mint` dưới `faucet_nft_policy` ở ba nhánh còn lại. Nội dung đầy đủ:
[`CONTRACT.md`](./CONTRACT.md) v3.1 §3.3a. Mỗi DID vẫn
là một người **theo giả định của lớp DID**, không theo cơ chế faucet — một người giữ nhiều DID test
vẫn mở được nhiều account, và trần tốc độ toàn cục là thứ chặn trường hợp đó.

## Cơ chế NFT-beacon + thứ tự áp tham số (không vòng)

KHÔNG truyền script-hash chéo HAI CHIỀU làm tham số compile-time (pool ↔ account = vòng tròn không
deploy được). Một chiều thì không vòng, và thứ tự áp tham số là một dãy thẳng:

```
faucet_nft(genesis_ref, ms_per_epoch)                          → faucet_nft_policy
faucet_account(faucet_nft_policy, did_nft_policy,
               lamp_policy, lamp_name, ms_per_epoch)           → account_script_hash
faucet_pool(faucet_nft_policy, did_nft_policy,
            lamp_policy, lamp_name, ms_per_epoch,
            account_script_hash)                               → pool_script_hash
```

Dãy acyclic vì `faucet_account` và `faucet_nft` **không bên nào ôm hash pool** — chúng nhận diện
pool bằng POOL NFT.

Một minting policy `faucet_nft` đúc hai loại token:
- **POOL NFT** `"POOL"` (`504f4f4c`), one-shot — nhận diện faucet pool UTxO.
- **ACCT NFT** `"ACCT" ‖ blake2b_224(did_name)` = **32 byte** — neo account vào ĐÚNG một DID mà
  không cần state toàn cục. Đây KHÔNG còn là hằng `41434354`; mọi nơi ghép chuỗi tay là đang dựng
  sai asset name. Hàm: `ledger.acct_name` (on-chain) · `constants.acctName` (off-chain).

**`account_script_hash` là tham số compile-time, không phải trường datum.** Trong datum thì cổng
duy nhất kiểm được nó là "đủ 28 byte" — một phép kiểm ĐỘ DÀI đứng thay phép kiểm ĐỊNH DANH; một
hash đủ dài nhưng sai làm mọi drip rót vào địa chỉ không có script, không nhánh nào tiêu lại được,
và mọi kiểm tra on-chain vẫn xanh. Lý lẽ đầy đủ ở đầu `onchain/validators/faucet_pool.ak`.

## Validators (onchain, Aiken)

| Tệp | Loại | Vai |
|---|---|---|
| `validators/faucet_nft.ak` | mint | `MintPool` (one-shot POOL NFT + ép datum khởi tạo) · `MintAccount` · `BurnAccount` |
| `validators/faucet_pool.ak` | spend | kho tLAMP + POOL NFT. `ClaimOpen` · `ClaimAgain` · `Reclaim` · `TopUpPool` |
| `validators/faucet_account.ak` | spend | account per-DID + ACCT NFT. `Use` · `TopUp` · `ReclaimIdle` |
| `validators/tlamp_policy.ak` | mint | policy tLAMP one-shot fixed-supply (độc lập với ba tệp trên) |
| `lib/magiclamp/faucet/ledger.ak` | types | `FaucetConfig`, `PoolDatum` (4 trường, có `opened_root`), `FaucetAccount`, ba nhóm redeemer, tên NFT, `max_claims_ceiling`, `did_key` / `did_leaf_value` / `empty_opened_root` |
| `lib/magiclamp/faucet/util.ak` | helpers | `get_epoch` / `get_epoch_pinned`, NFT-beacon count/find, chống double-satisfaction |
| `lib/magiclamp/faucet/handlers.ak` | thân handler | `account_spend` + `nft_mint` + `reclaim_epochs_const` |
| `validators/ledger_parity.ak` | chỉ ca kiểm | ghim gốc + bằng chứng sổ do SDK JS sinh — đối chiếu chéo off-chain ↔ on-chain |

Sổ dùng thư viện `aiken-lang/merkle-patricia-forestry` v2.1.0; `faucet_pool` compiled ≈ 6,2 KB.

`handlers.ak` tồn tại vì Aiken **không xuất handler của validator ra ngoài module**, mà lớp ca kiểm
gọi HAI script trên CÙNG một `Transaction` bắt buộc phải gọi được chúng từ `faucet_pool.ak`. Lý do
ghi ở đầu tệp đó — đừng gộp lại.

`validators/faucet.ak` và `lib/magiclamp/faucet/types.ak` (bản v1: pool nhả 100 tLAMP, không
DID-gated) **đã bị xoá khỏi cây mã**. Hệ quả cần biết trước khi dựng tx cho pool đang sống: xem
mục [Trạng thái deploy](#trạng-thái-deploy) dưới đây.

## Luồng

### ClaimOpen — mở account cho một DID chưa có account

```
inputs:  POOL UTxO (ClaimOpen{proof}) + DID-NFT UTxO    (0 account input)
mint:    ACCT NFT +1  (faucet_nft ▸ MintAccount)
outputs: pool'    = pool − drip tLAMP, PoolDatum{cfg giữ, window_epoch=now, claims+1,
                                                 opened_root = chèn did_key vào sổ}
         account  = ACCT NFT + drip tLAMP
                    FaucetAccount{did_name, last_claim_epoch=now, last_touch_epoch=now}
                    ở ĐÚNG địa chỉ enterprise của `account_script_hash`
```

`proof` chứng minh khoá của DID **chưa** có trong sổ. DID đã có account thì không có bằng chứng nào
hợp lệ — dùng `ClaimAgain`. SDK kiểm trước và ném `CLAIM-OPEN-007` trỏ sang `buildClaimAgainTx`.

### ClaimAgain — nạp thêm drip vào chuỗi account đã có

```
inputs:  POOL UTxO (ClaimAgain) + account cũ (AccountRedeemer::TopUp) + DID-NFT UTxO
mint:    (không đúc gì)
outputs: pool'    = pool − drip tLAMP, bộ đếm tiến một bước, opened_root GIỮ NGUYÊN
         account' = account + drip tLAMP, cả hai mốc = now
```

Hai script chạy trong cùng một tx: `faucet_pool` ép cooldown (`now ≥ old.last_claim_epoch +
cooldown_epochs`), `faucet_account` ▸ `TopUp` ép số tiền cộng vào ĐÚNG `drip_oildrop` đọc từ datum
POOL — không để bên pool tự khai.

### Use — chủ DID dùng tLAMP test

```
inputs:  account UTxO (Use) + DID-NFT UTxO              (CẤM POOL NFT input)
outputs: account': did_name bất biến · last_claim_epoch BẤT BIẾN · last_touch_epoch = now
                   tLAMP ≤ cũ (rút ra dùng được, bơm vào thì không)
```

`Use` KHÔNG đụng mốc cooldown. Gộp hai mốc làm một là một lỗ: ai dùng tLAMP đúng cách lại bị đẩy
cooldown ra xa, còn kẻ chỉ claim rồi bỏ đó thì không chịu gì.

### ReclaimIdle — ai cũng thu hồi được account nằm không

```
inputs:  account idle (ReclaimIdle) + POOL UTxO (Reclaim{proof})
mint:    ACCT NFT −1  (faucet_nft ▸ BurnAccount)
outputs: pool' = pool + toàn bộ tLAMP của account; bộ đếm tốc độ GIỮ NGUYÊN;
                 opened_root = xoá did_key khỏi sổ
```

Điều kiện: `now ≥ last_touch_epoch + 72` cửa sổ. KHÔNG cần DID NFT ⇒ ai cũng làm keeper. ACCT NFT
**phải** bị đốt — không đốt thì nó thành vé tái dùng vĩnh viễn; và xoá khoá khỏi sổ mà không đốt thì
một DID có hai account. Sau thu hồi, DID đó `ClaimOpen` lại được, và sổ về đúng gốc trước lượt mở.

### TopUpPool — nạp tLAMP vào pool (vận hành)

```
inputs:  POOL UTxO (TopUpPool) + nguồn tLAMP của người nạp   (CẤM account input)
outputs: pool' = pool + Δ tLAMP, Δ ≥ drip_oildrop; bộ đếm tốc độ + opened_root GIỮ NGUYÊN
```

Tách khỏi `Reclaim` vì hai ý định khác nhau, và để nhánh nạp không mượn được đường thu hồi.

## Nghĩa vụ của builder off-chain — cửa sổ hiệu lực PINNED

Mọi nhánh trừ `ReclaimIdle` đọc thời gian qua `util.get_epoch_pinned`, hàm này đòi **cả hai cận
hữu hạn và cùng một bucket**. Builder phải đặt `lo = now_ms`,
`hi = min(now_ms + ttl, (⌊lo / ms_per_epoch⌋ + 1) × ms_per_epoch − 1)`; phần bucket còn lại ngắn hơn
TTL tối thiểu thì **chờ sang bucket sau, KHÔNG nới `hi`**. Hàm thuần: `epochWindow.pinnedEpochWindow`
(ném `FAUCET-WINDOW-001`).

`ReclaimIdle` cố ý đọc cận dưới (`util.get_epoch`): người thu hồi lùi thời gian thì chỉ tự mình
không đủ điều kiện, không ai khác thiệt.

Tx `ClaimAgain` còn phải mang DID NFT của chính account đó trong input — `faucet_account` ▸ `TopUp`
ép điều này (C-TOP-DID-1), không chỉ `faucet_pool`.

## Offchain SDK (`offchain/src/`)

| Tệp | Xuất ra |
|---|---|
| `constants.ts` | `DRIP_OILDROP`, `COOLDOWN`, `RECLAIM`, `POOL_NFT_NAME`, `MAX_CLAIMS_CEILING`, `acctName()`, cổng `assertMsPerEpochMatchesNetwork` (`FAUCET-EPOCH-001`) |
| `types.ts` · `datum.ts` | codec `FaucetConfig` / `PoolDatum` / `FaucetAccount` + ba nhóm redeemer + bằng chứng MPF (`encodeMpfProof` / `decodeMpfProof`) |
| `openedLedger.ts` | `OpenedLedger` — dựng lại sổ từ danh sách account sống, đối chiếu gốc (`FAUCET-LEDGER-001`), sinh bằng chứng chèn/xoá; `didKey`, `OPENED_ROOT_EMPTY` |
| `epochWindow.ts` | `epochAt`, `windowAt`, `pinnedEpochWindow`, `WINDOW_TTL_MS`, `MIN_PINNED_WINDOW_MS` |
| `mintBuilder.ts` | `buildMintPoolTx` — đúc POOL NFT + datum khởi tạo (gốc sổ rỗng) |
| `claimBuilder.ts` | `buildClaimOpenTx` — nhận `openedLedger` |
| `claimDidBuilder.ts` | `buildClaimAgainTx` |
| `useBuilder.ts` | `buildUseTx` |
| `reclaimBuilder.ts` | `buildReclaimTx` — nhận `openedLedger` |
| `topUpPoolBuilder.ts` | `buildTopUpPoolTx` |

**`openedLedger` là tham số bắt buộc** của `buildClaimOpenTx` và `buildReclaimTx`: một `OpenedLedger`
đã dựng, hoặc danh sách `{acctAssetName}` / `{didName}` của **mọi** account đang sống dưới policy
`faucet_nft`. SDK không đọc chuỗi hộ; danh sách thiếu hay thừa thì gốc dựng lại lệch datum và SDK ném
`FAUCET-LEDGER-001` thay vì dựng một tx chắc chắn bị từ chối. Gói `@aiken-lang/merkle-patricia-forestry`
chỉ chạy trên Node.

## Test

```
cd Faucet/onchain  && aiken check       # đọc dòng `Summary` của chính lệnh này
cd Faucet/offchain && npx vitest run    # đọc dòng `Tests N passed`
```

Tài liệu **cố ý không chép số ca kiểm**: đó là một tập đang lớn dần, nên con số chép ra đây sẽ sai
lặng lẽ. Bảng "bất biến ↔ ca kiểm ghim nó" ở [`Math-Spec.md`](./Math-Spec.md) §5.

## Trạng thái deploy

**Bản v3.1 (ba validator, `PoolDatum` 4 trường, trần tốc độ, sổ `opened_root`) CHƯA deploy trên mạng
nào** — không có địa chỉ hay tx mới; hash chưa áp tham số của v3.1 ghi ở
[`deployed-artifacts.md`](./deployed-artifacts.md). Pool đang sống trên
Preprod và Preview là **bản v1** — datum chỉ có `claim_amount`, không POOL NFT, không DID-gate, và
nó có đúng cái lỗ vét kho mà trần tốc độ ở v3 dựng ra để đóng. Tx hash, địa chỉ pool và policy id
của bản đang chạy: [`deployed-artifacts.md`](./deployed-artifacts.md).

Mã nguồn validator v1 **không còn trong cây làm việc** (`validators/faucet.ak` đã xoá) ⇒ dựng tx
cho pool v1 phải lấy lại tệp đó từ lịch sử git. Đây là điều phải biết trước khi đọc
`deployed-artifacts.md`, vì tệp đó trỏ tên `faucet.ak` như một tệp đang tồn tại.

## Điểm còn treo — danh mục trạng thái

Danh mục này chỉ ghi TRẠNG THÁI: mã định danh · treo cái gì · ràng buộc tạm đang có hiệu lực
(luôn fail-closed) · khai ở tệp nào. Nó không phải nơi bàn phương án.

| Mã | Treo cái gì | Ràng buộc tạm đang có hiệu lực | Khai ở |
|---|---|---|---|
| `[FAUCET-DID-OWNERSHIP]` | Quyền sở hữu DID chứng minh bằng **có DID NFT trong input**, không ràng buộc khoá ký riêng. Đủ cho testnet; DID PhoenixKey dùng khoá sinh trắc thì có thể cần thêm cổng `extra_signatories` ở mainnet. | Mọi nhánh GHI mốc của một account đều đòi DID NFT khớp `did_name`: `check_claim` (C-DID-1) · `account_spend` ▸ `Use` · `account_spend` ▸ `TopUp` (C-TOP-DID-1). Không có nhánh nào ghi được mốc của người khác. | `onchain/validators/faucet_pool.ak` ▸ `check_claim` · `lib/magiclamp/faucet/handlers.ak` ▸ `account_spend` |
| `[FAUCET-DEPLOY-V3]` | v3.1 chưa deploy; hai mạng test đang chạy v1 có lỗ vét kho. | Không có bản v3.1 nào trên chuỗi ⇒ không có tài sản nào chịu rủi ro của v3.1. Kỷ luật nạp pool hai bước khi deploy: [`Exec-Spec.md`](./Exec-Spec.md) v3.1 §4. | [`deployed-artifacts.md`](./deployed-artifacts.md) |

Điểm treo ĐÓNG ở v3.1, ghi lại để không ai mở lại:

- `[FAUCET-ACCT-UNIQUE]` — *"một `did_name` mở được nhiều chuỗi account"*. **ĐÓNG.** Đường qua
  `ClaimOpen` đóng bằng INV-ONE-ACCT (sổ `opened_root`, xem [Hai tầng chặn](#hai-tầng-chặn--mục-tiêu-khác-nhau-đừng-đọc-tầng-hai-rộng-hơn-nó-làm)):
  `faucet_pool.ak` ▸ nhánh `ClaimOpen` (C-OPEN-UNIQ-1) và nhánh `Reclaim` (C-RECL-UNIQ-1,
  C-RECL-BURN-1). Đường đúc ACCT NFT ngoài `ClaimOpen` đóng cùng lượt với
  `[FAUCET-ACCT-MINT-GATE]` bên dưới.
- `[FAUCET-ACCT-MINT-GATE]` — *"ACCT NFT đúc được ngoài `ClaimOpen`"*. **ĐÓNG.** Ba chốt mới trong
  `faucet_pool.ak`: `C-MINT-ONLY-OPEN-1` (`ClaimAgain`: `tx.mint` dưới `faucet_nft_policy` rỗng) ·
  `C-MINT-ONLY-OPEN-2` (`TopUpPool`: cùng thế) · `C-RECL-BURN-2` (`Reclaim`: đúng một mục, và
  `C-RECL-BURN-1` ép mục đó là −1 của ACCT bị thu hồi). Chốt đặt trong pool chứ không trong mint
  policy: pool biết nhánh của chính nó, còn mint policy thì phải đọc `PoolRedeemer` trong
  `tx.redeemers` và thành nguồn thứ hai cho cùng một sự thật. PoC dựng lại thành ca âm:
  `topuppool_duc_acct_hai_validator` · `again_duc_acct_did_khac_ba_validator` · `topuppool_dot_acct` ·
  `reclaim_dot_va_duc_them`, mỗi ca kèm một ca DƯƠNG khẳng định các script KHÁC chấp nhận đúng tx đó
  (`topuppool_duc_acct_mint_policy_chap_nhan` · `again_duc_acct_did_khac_hai_script_kia_chap_nhan`).
  Cùng lượt: `C-TOP-3` và `C-TOP-4` được cấp ca ghim đầu tiên (`topup_acct_out_khong_mang_nft` ·
  `topup_dot_acct` · `topup_duc_acct`) — gỡ hai chốt đó ra, bộ kiểm cũ 142/142 vẫn xanh.

Hai điểm treo của bản v2 đã ĐÓNG, ghi lại để không ai mở lại:

- *"Không ép account output nằm ở script `faucet_account`"* — nay bị ép: `check_claim` đòi đúng một
  output ở `account_script_hash`, và địa chỉ đó phải là địa chỉ enterprise của chính hash ấy
  (C-ACCTOUT-1..3). Đường "đúc ACCT về ví mình rồi né cooldown" đã đóng.
- *"`reclaim_epochs` nên là hằng compile-time hay trường runtime"* — đã chốt hằng compile-time, và
  bản sao trong `FaucetConfig` đã bỏ (`handlers.reclaim_epochs_const`).
