# tLAMP + Faucet — EXEC: Lộ trình build / test / deploy

> **Phiên bản:** v3.0 — 2026-09-28. Nâng cấp từ draft 2026-06-09 vì bảng trạng thái của bản đó khai
> `faucet.ak` và `types.ak` là "code xong, test pass" — **cả hai đã bị xoá khỏi cây mã**; bản đó cũng
> chép một con số ca kiểm cố định và một mốc M4 "chưa chạy" trong khi hai mạng test đã có pool sống từ
> lâu.
> **Vai:** thứ tự build, cách đo, tham số deploy, việc còn lại. KHÔNG định nghĩa lại datum/bất biến
> (việc của [CONTRACT](./CONTRACT.md) v3.0 và [TECH](./Tech-Spec.md) v3.0). Khi lệch với mã hoặc với
> [`deployed-artifacts.md`](./deployed-artifacts.md), **bên kia thắng**.

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Đưa Faucet v3 từ mã tới **chạy thật trên Preprod**: deploy một pool tLAMP có POOL NFT + trần tốc độ,
rồi mọi dev có DID test tự claim được. Phục vụ mục tiêu cuối **làm LAMP có giá trị** (open SDK: một
policy id tLAMP dùng chung toàn mạng test cho mọi Cardano team — [CONTRACT](./CONTRACT.md) v3.0 §6).

### 0.2 Thuộc EXEC

- Trạng thái thật hiện tại, neo vào tệp mã chứ vào trí nhớ.
- Lộ trình build M0…M5 + thứ tự phụ thuộc.
- Cách đo (lệnh, và đọc kết quả ở đâu) — kể cả lớp ca kiểm "hai validator một tx" và kỷ luật đột biến.
- Tham số deploy Preprod + **kỷ luật nạp pool hai bước**.
- Việc còn lại.

### 0.3 KHÔNG thuộc EXEC

| Hạng mục | Thuộc |
|---|---|
| Datum/redeemer, danh sách bất biến | [CONTRACT](./CONTRACT.md) v3.0 §3–§4 |
| Chốt nào ở tệp/hàm nào, ngữ nghĩa helper | [TECH](./Tech-Spec.md) v3.0 |
| Chứng minh one-shot / trần tốc độ / bảo toàn value | [MATH](./Math-Spec.md) v3.0 |
| Vai caller, luồng, trạng thái trước/sau | [FEAT](./Feat-Spec.md) v3.0 |
| Tx hash, policy id, địa chỉ pool của bản **đang chạy** | [`deployed-artifacts.md`](./deployed-artifacts.md) |

---

## 1. Trạng thái thật hiện tại

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| `lib/magiclamp/faucet/ledger.ak` | code xong — `FaucetConfig` 3 trường, `PoolDatum`, `FaucetAccount` 3 trường, ba nhóm redeemer, `max_claims_ceiling` | [tệp](./onchain/lib/magiclamp/faucet/ledger.ak) |
| `lib/magiclamp/faucet/util.ak` | code xong — có cả `get_epoch` và `get_epoch_pinned` | [tệp](./onchain/lib/magiclamp/faucet/util.ak) |
| `lib/magiclamp/faucet/handlers.ak` | code xong — `account_spend`, `nft_mint`, `reclaim_epochs_const` | [tệp](./onchain/lib/magiclamp/faucet/handlers.ak) |
| `validators/faucet_nft.ak` | code xong — `MintPool` / `MintAccount` / `BurnAccount` | [tệp](./onchain/validators/faucet_nft.ak) |
| `validators/faucet_pool.ak` | code xong — `ClaimOpen` / `ClaimAgain` / `Reclaim` / `TopUpPool` | [tệp](./onchain/validators/faucet_pool.ak) |
| `validators/faucet_account.ak` | code xong — `Use` / `TopUp` / `ReclaimIdle` | [tệp](./onchain/validators/faucet_account.ak) |
| `validators/tlamp_policy.ak` | code xong, **không bị bản vá v3 chạm tới** | [tệp](./onchain/validators/tlamp_policy.ak) |
| `validators/faucet.ak` + `lib/.../types.ak` (v1) | **ĐÃ XOÁ** khỏi cây làm việc | không còn trong `onchain/` |
| Bộ kiểm on-chain | có, gồm lớp ca "hai validator một tx" | §3.1 — đọc số ở `Summary` của `aiken check`, tài liệu không chép |
| SDK off-chain | code xong theo codec v3 (6 builder + codec + `epochWindow`) | [`offchain/src/index.ts`](./offchain/src/index.ts) |
| Bộ kiểm off-chain | có | §3.2 |
| Harness vận hành đánh số `00_preflight` / `01_mint_pool` / `02_claim` (v1) | **ĐÃ XOÁ** — chúng gọi validator `faucet.ak` v1 | không còn trong `scripts/` |
| Script chạy thật còn lại | `scripts/demo_faucet_v2.ts` (nội dung v3, tên còn nhãn cũ) + `scripts/config.ts` (env + `SUBMIT`) | [`scripts/`](./scripts/) |
| Deploy v3 | ❌ **chưa deploy trên mạng nào** | [`deployed-artifacts.md`](./deployed-artifacts.md) |
| Pool đang sống Preprod + Preview | **bản v1** (`claim_amount`, không POOL NFT, không DID-gate) | [`deployed-artifacts.md`](./deployed-artifacts.md) |

> **Hai điều phải đọc cùng nhau, đừng tách:** (1) bản v3 chưa deploy ⇒ mọi tính chất an toàn chứng minh
> ở [MATH](./Math-Spec.md) v3.0 **chưa có hiệu lực trên chuỗi**; (2) pool đang sống là v1, và v1 có
> đúng cái lỗ vét kho mà trần tốc độ ở v3 dựng ra để đóng. Đọc một vế mà bỏ vế kia dẫn tới kết luận
> ngược nhau.
>
> **Và một hệ quả vận hành:** mã nguồn v1 không còn trong cây làm việc, nên dựng tx cho pool đang
> sống phải lấy lại `validators/faucet.ak` từ lịch sử git. `deployed-artifacts.md` nhắc tên tệp đó như
> một tệp đang tồn tại — đúng lúc nó được viết, sai từ lượt xoá v1.

---

## 2. Lộ trình build — mốc M0…M5

| Mốc | Nội dung | Phụ thuộc | Trạng thái |
|---|---|---|---|
| **M0** | Kiểu + helper: datum, redeemer, `acct_name`, đếm theo script hash, hai hàm epoch | — | ✅ xong |
| **M1** | `tlamp_policy.mint` one-shot + ca kiểm mint/phá | M0 | ✅ xong |
| **M2** | `faucet_nft.mint` — ba nhánh + `C-MP-1..7` ép datum khởi tạo | M0 | ✅ xong |
| **M3** | `faucet_account.spend` — `Use` / `TopUp` / `ReclaimIdle` | M0 | ✅ xong |
| **M4** | `faucet_pool.spend` — bốn nhánh + trần tốc độ + lớp ca "hai validator một tx" | M2, M3 | ✅ xong |
| **M5** | SDK off-chain theo codec v3 (6 builder + `pinnedEpochWindow`) | M4 | ✅ code xong |
| **M6** | Deploy Preprod v3 theo §4, đối chiếu datum on-chain | M5 + credential + tLAMP | ❌ **chưa chạy** |

Thứ tự M2 → M3 → M4 **không đảo được**: nó chính là thứ tự áp tham số (`faucet_nft_policy` →
`account_script_hash` → pool). Đảo lại là dựng một vòng phụ thuộc hash.

---

## 3. Cách đo

### 3.1 Bộ kiểm on-chain

```
cd Faucet/onchain
aiken check       # đọc dòng `Summary N checks, E errors, W warnings`
aiken build       # sinh plutus.json; đọc dòng `Summary 0 errors`
```

**Tài liệu cố ý KHÔNG chép số ca kiểm.** Đó là một tập đang lớn dần; một con số chép vào đây sẽ sai
lặng lẽ, và bản draft trước đã sai đúng kiểu đó (nó ghi hai con số khác nhau ở hai mục cho cùng một
bộ kiểm). Số thật đọc ở `Summary` của chính lệnh trên.

**Ba lớp ca, mỗi lớp đo một thứ khác nhau — bỏ lớp nào là mất đúng một họ lỗi:**

1. **Ca đơn vị một validator.** Mỗi ca âm đổi **đúng một** trường so với ca dương song sinh, dựng bằng
   **cùng một builder**. Hai cực khác nhau ở một chỗ thì ca đó mới phân biệt được hai bên của cổng.
2. **Ca dương song sinh cho mỗi cổng "có trần".** Ví dụ `mintpool_max_bang_tran` đứng cạnh
   `mintpool_max_vuot_tran`: không có ca dương ở đúng trần thì một cổng siết quá cũng xanh.
3. **Ca gọi HAI script trên CÙNG một `Transaction`.** Đây là phép đo duy nhất bắt được lớp lỗi "hai
   validator đòi hai điều trái nhau" — một luồng có thể xanh ở mọi bài đơn vị mà **không có hình dạng
   giao dịch nào tiêu được nó**, tức nó là mã chết trong khi bộ kiểm vẫn 100% xanh. Lớp này là lý do
   `handlers.ak` tồn tại ([TECH](./Tech-Spec.md) v3.0 §0). Hai luồng **không** có ca loại này và đó là
   tính chất của thiết kế: `Use` cấm POOL NFT input, `TopUpPool` cấm account input — với chúng, cực đối
   xứng là một ca đỏ chứng minh tx ghép đôi bị từ chối.

**Kỷ luật đột biến — điều kiện để được nói "chốt X đã được ghim".** Một ca đỏ mang đúng tên chốt X
**không** chứng minh ca đó ghim X: nó có thể trượt xuống chốt kế tiếp và chết ở đó, với đúng màu và
đúng tên. Phép đo đúng là **gỡ hẳn chốt X rồi chạy TRỌN bộ kiểm**: còn xanh hết ⇒ không ca nào canh
X. Chưa chạy phép đó thì phát biểu đúng mức là *"có ca đỏ ở chốt X"*. Không bắt buộc chạy đột biến cho
mọi thay đổi — chỉ cấm phát biểu "đã được ghim" khi chưa chạy nó.

Ưu tiên gỡ thử các chốt mà **mất chúng là bất khả hồi**: `C-RATE-0`, `C-RECL-0`, `C-RECL-2`,
`C-AGAIN-2`, `C-TOP-5`, `C-TOP-DID-1`, `C-MP-6`.

> ⚠ `aiken check` gọi qua công cụ không có TTY có thể trả mã thoát 1 **mà không in lỗi nào** — đọc kết
> quả ở dòng `Summary`, đừng đọc ở mã thoát của một đường ống. Cần mã thoát đáng tin thì bọc pty.

### 3.2 Bộ kiểm off-chain

```
cd Faucet/offchain && npx vitest run      # đọc dòng `Tests N passed`
```

Phủ: codec round-trip cho `FaucetConfig` / `PoolDatum` / `FaucetAccount` + từng constructor redeemer
([`tests/datum.test.ts`](./tests/datum.test.ts)), builder trên tx-builder mock
([`tests/builders.test.ts`](./tests/builders.test.ts), [`tests/faucetV2Builders.test.ts`](./tests/faucetV2Builders.test.ts),
[`tests/faucetV2.test.ts`](./tests/faucetV2.test.ts)), và cửa sổ hiệu lực
([`tests/epochWindow.test.ts`](./tests/epochWindow.test.ts)).

**Ba ca off-chain mà on-chain KHÔNG đo hộ được — cả ba đã có, đừng để ai gỡ:**
1. `pinnedEpochWindow` **ném** khi phần bucket còn lại ngắn hơn `MIN_PINNED_WINDOW_MS`, và **không** tự
   nới `hi` sang bucket sau. Ca `"sát biên cuối bucket, còn dư DƯỚI ngưỡng tối thiểu: NÉM lỗi có mã,
   không tự nới hi"` — kèm ca dương song sinh ở đúng ngưỡng (`"còn dư ĐÚNG bằng ngưỡng tối thiểu:
   KHÔNG ném"`), nếu không thì một cổng siết quá cũng xanh.
2. `acctName(did_name)` cho ra đúng 32 byte, deterministic, và khớp `ledger.acct_name` — đối chiếu cả
   với vector BLAKE2b-224 của RFC 7693, không chỉ với chính thư viện đang dùng.
3. `assertMsPerEpochMatchesNetwork` ném khi `ms_per_epoch` lệch mạng (`FAUCET-EPOCH-001`). Lỗi này
   **không** làm tx fail — validator nhận cùng con số — nó chỉ làm cooldown và ngưỡng thu hồi dài hoặc
   ngắn đi vài lần mà không ai thấy. Đây là lớp lỗi duy nhất trong module mà on-chain **không có cách
   nào** phát hiện.

---

## 4. Deploy Preprod v3 — tham số + kỷ luật nạp pool

### 4.1 Tham số cho lượt deploy Preprod

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| `drip_oildrop` | `1_001_000_000` (1001 tLAMP) | vĩnh viễn sau deploy |
| `cooldown_epochs` | `36` cửa sổ | vĩnh viễn sau deploy |
| `max_claims_per_window` | `20` | vĩnh viễn sau deploy; trần cứng `100` (`C-MP-7`) |
| `ms_per_epoch` | lấy từ `msPerEpoch(network)` của `@magiclamp/utils` | **không gõ tay**; cổng `assertMsPerEpochMatchesNetwork` chặn lượt nạp lệch |
| `(lamp_policy, lamp_name)` | tLAMP đang dùng của mạng đó | policy id đọc bằng `activeLampPolicyId(network)` (`Genesis/offchain/src/lampPolicies.ts`), KHÔNG chép sang tệp khác |
| `did_nft_policy` | policy DID **test** của Preprod | mainnet mới truyền PhoenixKey DID |
| `genesis_ref` | một UTxO của ví deploy | bị consume ⇒ POOL NFT one-shot |

`max_claims_per_window = 20` với `drip = 1001` tLAMP nghĩa là trần **20 020 tLAMP mỗi cửa sổ** —
chặn trên của thiệt hại kể cả khi một người điều khiển nhiều DID.

### 4.2 Nạp pool HAI BƯỚC — không nạp khối lớn ở lượt deploy

```bash
cd Faucet/onchain && aiken build                 # sinh plutus.json
# 1. deploy kèm lượng tLAMP NHỎ (đủ cho vài lượt claim thử)
#    → buildMintPoolTx: đúc POOL NFT + PoolDatum{claims_in_window: 0, window_epoch: bucket THẬT}
# 2. chạy THẬT một ClaimOpen và một ClaimAgain (tức một TopUp) trên pool đó
# 3. ĐỐI CHIẾU datum on-chain: cfg đúng ba giá trị · window_epoch đúng bucket · claims_in_window đúng số lượt
# 4. chỉ khi bước 3 khớp mới TopUpPool khối lớn
```

**Vì sao hai bước, không phải một.** `FaucetConfig` và `window_epoch` khởi tạo là **bất khả hồi**:
sau tx `MintPool`, `C-CFG-1` đóng băng `cfg` vĩnh viễn và POOL NFT one-shot nên không có đường đúc lại
datum. Một con số sai ở giây deploy không có cách sửa nào ngoài deploy pool mới — và nếu khối tLAMP lớn
đã nằm trong pool đó thì nó **nằm lại đó**, chỉ ra được qua `drip` từng lượt hoặc không ra được (ví dụ
`max_claims_per_window` hoặc `drip_oildrop` bị gõ thành giá trị khoá chết prelude).

Nạp lượng nhỏ trước biến một sai sót bất khả hồi thành một sai sót **rẻ**: mất một pool rỗng, deploy
lại. Đây là lý do `C-MP-1..7` tồn tại, và bước đối chiếu datum là phần mà `C-MP-1` **không đo được** —
`faucet_nft` không kiểm được `pool_out` đúng là script `faucet_pool` (kiểm được thì lại là vòng hash),
nó chỉ kiểm được "có phải một script nào đó". Phần dư đó đóng bằng mắt người, sau deploy, trên chuỗi.

**Không còn harness đánh số để chạy bốn bước trên.** Bộ `00_preflight` / `01_mint_pool` / `02_claim` đã
bị xoá cùng validator v1 mà nó gọi, nên bốn bước ở trên hiện phải chạy bằng cách gọi builder trực tiếp:
bước 1 dùng `buildMintPoolTx`, bước 2 dùng `buildClaimOpenTx` rồi `buildClaimAgainTx`, bước 4 dùng
`buildTopUpPoolTx` ([`offchain/src/topUpPoolBuilder.ts`](./offchain/src/topUpPoolBuilder.ts)). Script
chạy thật hiện có là `scripts/demo_faucet_v2.ts` (nội dung v3, tên còn nhãn cũ) — nó chưa phải một
harness deploy có kiểm tra trước, xem G2.

Env + cờ gửi tx đọc từ [`scripts/config.ts`](./scripts/config.ts): `BLOCKFROST_KEY`, `WALLET_SEED`, và
`SUBMIT` mặc định `false` (chỉ build + log). `SUBMIT=true` mới gửi thật. Credential nhận qua biến môi
trường đặt **ngay trước lệnh**, không ghi vào tệp nào.

### 4.3 Đối chiếu on-chain sau deploy (bắt buộc, trước khi nạp khối lớn)

- Pool UTxO ở địa chỉ `faucet_pool`: có **đúng một** POOL NFT, inline datum decode được thành
  `PoolDatum`, `claims_in_window == 0`, `window_epoch` == bucket của chính tx deploy.
- `cfg` đọc ra đúng ba giá trị ở §4.1 — đọc từ chuỗi, không từ tệp state.
- Sau một `ClaimOpen` thật: pool giảm đúng `drip`, `claims_in_window` tăng đúng 1; account UTxO xuất
  hiện ở địa chỉ `faucet_account` với ACCT NFT 32 byte và hai mốc đều bằng bucket hiện tại.
- Sau một `ClaimAgain` thật: account tăng đúng `drip`, cả hai mốc bằng bucket hiện tại; pool giảm đúng
  `drip` và bộ đếm tăng đúng 1.
- Genesis UTxO biến mất ⇒ thử đúc POOL NFT lần hai phải fail.

---

## 5. Việc còn lại

| # | Việc | Loại | Ưu tiên |
|---|---|---|---|
| G1 | **Deploy Preprod v3** theo §4 (hai bước) — chưa chạy | deploy (cần credential + tLAMP) | cao |
| G2 | **Đường đi cho pool v1 đang sống**: cả validator v1 **và** harness `00/01/02` gọi nó đều đã xoá khỏi cây, chỉ còn trong lịch sử git. Cần quyết dứt điểm: dừng pool v1 sau khi v3 chạy, hay giữ song song và lấy lại các tệp đó | quyết định + dọn | cao |
| G2b | **Chưa có harness deploy v3 có kiểm tra trước.** Bốn bước ở §4.2 hiện phải gọi builder bằng tay; thiếu bước preflight (ví đủ tADA, `plutus.json` có đủ ba validator, `ms_per_epoch` khớp mạng) nên một sai sót bất khả hồi ở giây deploy không có gì chặn trước | code | cao |
| G3 | **Đo ExUnit trên tx THẬT** — số đo hiện có là trên tx mock của bộ kiểm, không có input phí / output trả lại / witness | đo | trung |
| G4 | **Ca kiểm chuỗi claim tới cạn pool** (`P → P−d → … < d`) chưa có on-chain | test | trung |
| G5 | **Nhãn `V2` còn sót trong mã** — tên tệp bộ kiểm (`tests/faucetV2.test.ts`, `tests/faucetV2Builders.test.ts`), tiêu đề khối trong `offchain/src/constants.ts`, và tên `scripts/demo_faucet_v2.ts` — nội dung đã là v3. Đổi tên là sửa mọi chỗ tham chiếu, làm một lượt | dọn | thấp |
| G6 | **CIP-25 metadata (label 721)** cho tên/logo tLAMP ở ví/explorer — chưa đính, MVP chưa bắt buộc | nice-to-have | thấp |
| G7 | **Trỏ module test khác** (Distribution/Treasury/Governance) sang nguồn policy id ở `Genesis/offchain/src/lampPolicies.ts` | tích hợp | trung |

---

## 6. Tiêu chí "xong" (DoD)

- [x] Ba validator v3 + `tlamp_policy` code xong, build sạch (`aiken build` 0 errors).
- [x] Mã v1 (`faucet.ak`, `types.ak`) đã xoá, không còn chỗ nào import.
- [x] SDK off-chain theo codec v3: 6 builder + codec + `pinnedEpochWindow`.
- [x] Bộ kiểm có cả ba lớp ở §3.1, gồm lớp "hai validator một tx".
- [ ] Đã gỡ-thử từng chốt bất khả hồi ở §3.1 và xác nhận mỗi lần đều có ca đỏ (G1 phụ thuộc điều này).
- [ ] Deploy Preprod **bước 1** (lượng nhỏ) + đối chiếu datum on-chain theo §4.3 (G1).
- [ ] `ClaimOpen` + `ClaimAgain` thật, đối chiếu bộ đếm và hai mốc trên chuỗi (G1).
- [ ] `TopUpPool` khối lớn — **chỉ sau khi** hai gạch trên xanh.
- [ ] Quyết dứt điểm đường đi cho pool v1 (G2).

**Hiện trạng:** on-chain và off-chain đã sang v3 và khép kín trong cây mã. Không tuyên bố "live" cho
v3 tới khi có tx hash thật trên explorer và datum on-chain đã được đối chiếu bằng mắt.
