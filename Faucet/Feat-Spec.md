# tLAMP + Faucet — FEAT (Đặc tả tính năng / hành vi)

> **Phiên bản:** v3.2 — 2026-10-04. Bump từ v3.1 vì định nghĩa cửa sổ đổi sang lưới gốc epoch
> Cardano (`Specs/Window/CONTRACT.md` v1.1 §1): trên Mainnet/Preprod cửa sổ = epoch Cardano; Preview
> chưa có gốc nên bỏ số ngày Preview (§1, §6).
> v3.1 — 2026-09-28. Bump từ v3.0 vì hành vi người dùng đổi ở hai chỗ: **mỗi DID tối đa
> một account đang sống** (mở account thứ hai bị từ chối; bị thu hồi thì mở lại được), và **account
> nằm không bị thu hồi sau 72 cửa sổ** thay vì 1001. v3.1 chưa deploy.
> Bản v3.0 nâng cấp từ draft 2026-06-09 vì bản đó tả hai vai (người deploy
> + dev claim) và hai luồng (mint pool, claim 100 tLAMP permissionless) của một validator đã bị xoá.
> Mã hiện tại có **bốn vai** và **sáu luồng**, và luồng claim không còn permissionless trần.
> **Vai:** hành vi nhìn thấy được — ai làm gì, trạng thái trước/sau, cái gì bị từ chối. Khi lệch với
> mã trong `onchain/`, **mã thắng**.

Bám [`CONTRACT.md`](./CONTRACT.md) v3.1 — KHÔNG mâu thuẫn. KHÔNG đi sâu công thức/chứng minh (xem
[MATH](./Math-Spec.md) v3.1) hay bản đồ chốt ↔ tệp mã (xem [TECH](./Tech-Spec.md) v3.1) hay lộ trình
build/test/deploy (xem [EXEC](./Exec-Spec.md) v3.1).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

Faucet là **vòi cấp token test tLAMP** cho mọi dev Cardano trên Preview/Preprod, hệt như
[tADA faucet chính chủ Cardano](https://docs.cardano.org/cardano-testnet/tools/faucet): ai có một DID
test cũng tự lấy được tLAMP để test mọi tính năng LAMP mainnet (claim Distribution, nộp Treasury, bỏ
phiếu Governance…) mà không phải tự mint token rời rạc.

Mục tiêu cuối của cả dự án: **làm cho LAMP có giá trị** bằng cách mở SDK cho mọi Cardano team. Faucet
phục vụ mục tiêu đó bằng **một token test dùng chung** (một policy id chia sẻ toàn mạng test) — dev
của bất kỳ team nào đều dùng chung tLAMP để test SDK MagicLamp, thay vì mỗi ví mint một policy id
khác nhau ([CONTRACT](./CONTRACT.md) v3.1 §6).

### 0.2 Khác biệt cốt lõi so với faucet "mint-on-demand"

Faucet **KHÔNG mint mỗi claim** — nó chuyển token từ pool sang account của dev. Σ tLAMP **bất biến**
sau mọi claim. Hệ quả trực tiếp và đây là thứ chi phối cả thiết kế: **pool hữu hạn, và Faucet không có
đường nào tự đúc thêm** — mọi validator ở đây chỉ chuyển token, không tạo token. Vì thế v3 có ba thứ mà
một faucet mint-on-demand không cần: trần tốc độ toàn cục, cooldown, và đường thu hồi token nằm không.

> **Đúng mức về vế "bất khả hồi":** pool cạn là bất khả hồi **khi** token nạp vào pool là token đúc bởi
> `tlamp_policy` (one-shot, không đúc lại được). Pool nhận `(lamp_policy, lamp_name)` qua tham số nên
> token tới từ đâu không quan trọng với validator — nếu nó là token đúc bởi một policy **còn đúc được**
> thì việc nạp lại pool là chuyện vận hành, không phải bất khả hồi. Policy nào đang giữ vai đó trên mỗi
> mạng: [CONTRACT](./CONTRACT.md) v3.1 §2 (khối phạm vi) và `Genesis/offchain/src/lampPolicies.ts`. Đọc
> vế này sai một chiều thì đánh giá rủi ro lệch hẳn, nên nó phải nằm ngay cạnh câu trên.

### 0.3 Thuộc spec này

- Bốn vai: người deploy · chủ DID claim · chủ DID dùng token · keeper thu hồi (và một vai vận hành
  nạp pool).
- Sáu luồng: `MintPool` · `ClaimOpen` · `ClaimAgain` · `Use` · `ReclaimIdle` · `TopUpPool`.
- Trạng thái pool + account trước/sau mỗi thao tác; điều kiện pool cạn.
- Cái gì bị từ chối ở mỗi luồng.

### 0.4 KHÔNG thuộc spec này

| Chủ đề | Thuộc |
|---|---|
| Công thức + chứng minh (trần tốc độ, bảo toàn value, one-shot) | [MATH](./Math-Spec.md) v3.1 |
| Danh sách bất biến theo redeemer | [CONTRACT](./CONTRACT.md) v3.1 §3.5–§3.9 |
| Chốt nào nằm ở tệp/hàm nào, ngữ nghĩa helper | [TECH](./Tech-Spec.md) v3.1 |
| Codec byte-perfect | [CONTRACT](./CONTRACT.md) v3.1 §4 |
| Lộ trình build/test/deploy, gaps | [EXEC](./Exec-Spec.md) v3.1 |
| Token LAMP **thật** mainnet | LAMP mainnet — tLAMP chỉ là test surrogate |

---

## 1. Vai và actor

| Vai | Ai | Tần suất | Cần gì |
|---|---|---|---|
| **Người deploy** | một ví test của MagicLamp | **đúng 1 lần** cho mỗi pool | 1 UTxO làm genesis + tADA |
| **Chủ DID claim** | bất kỳ ai giữ một DID NFT | lần đầu `ClaimOpen`, sau đó `ClaimAgain` mỗi `cooldown_epochs` cửa sổ, trong hạn trần tốc độ | DID NFT trong ví + tADA phí |
| **Chủ DID dùng token** | chủ của chính account đó | bao nhiêu lần cũng được | DID NFT trong ví |
| **Keeper thu hồi** | bất kỳ ai | khi có account nằm không ≥ 72 cửa sổ | chỉ tADA phí — KHÔNG cần DID |
| **Vận hành nạp pool** | bất kỳ ai có tLAMP | khi pool vơi | tLAMP ≥ `drip_oildrop` |

**Không có vai admin.** Không committee, không whitelist, không khoá nào sửa được cấu hình pool sau
deploy. Ba vai cuối đều permissionless — cái chặn lạm dụng là ràng buộc dòng tiền và bộ đếm, không
phải danh sách người được phép.

**"Chủ DID" nghĩa là gì trong v3:** người **mang DID NFT trong input của tx**. Không có ràng buộc
khoá ký riêng — đủ cho testnet, còn treo ở `[FAUCET-DID-OWNERSHIP]`
([README](./README.md) v3.1 §Điểm còn treo).

**Mỗi DID tối đa MỘT account đang sống (INV-ONE-ACCT, [CONTRACT](./CONTRACT.md) v3.1 §3.3a).** Nhìn
từ phía người dùng:

- DID chưa có account → `ClaimOpen` mở account và nhận drip đầu tiên.
- DID đã có account → `ClaimOpen` lần hai **bị từ chối**; muốn nhận thêm thì `ClaimAgain` vào đúng
  account đó (chịu cooldown). SDK báo sớm bằng `CLAIM-OPEN-007`, trước khi dựng tx.
- Account bị thu hồi (nằm không ≥ 72 cửa sổ) → DID trở lại trạng thái "chưa có account" và
  `ClaimOpen` lại được. Thu hồi **không** cấm DID vĩnh viễn; nó chỉ trả tLAMP nằm không về pool.
- Account đã rút sạch tLAMP vẫn là account đang sống: nó giữ chỗ của DID cho tới khi bị thu hồi.

Ràng buộc này theo DID, không theo người: một người giữ nhiều DID test vẫn có nhiều account, và thứ
chặn trường hợp đó là trần tốc độ toàn cục. Đường tạo account thứ hai cho cùng DID **không** qua
`ClaimOpen` (đúc ACCT NFT trong tx `TopUpPool` hoặc `ClaimAgain`) ĐÃ ĐÓNG: `C-MINT-ONLY-OPEN-1` ·
`C-MINT-ONLY-OPEN-2` · `C-RECL-BURN-2` ([MATH](./Math-Spec.md) v3.1 §6a.1).

**Ngưỡng thu hồi ra thời gian:** `72 × ms_per_epoch`. Cửa sổ = `(posix_ms − window_origin_ms) /
ms_per_epoch` (`Specs/Window/CONTRACT.md` v1.1 §1). Trên Mainnet/Preprod (`ms_per_epoch` =
432 000 000, cửa sổ 5 ngày) chỉ số cửa sổ = số epoch Cardano, biên cửa sổ trùng biên epoch ⇒ 72 cửa
sổ ≈ **360 ngày**. Preview: chưa có gốc cửa sổ (WIN-PREVIEW, `Utils/src/index.ts` ▸
`windowOriginMs` ném lỗi) ⇒ pool v3 chưa dựng được trên Preview, nên không nêu số ngày cho Preview.

---

## 2. Luồng A — Deploy pool (`MintPool`)

**Caller:** người deploy. **Script chạy:** `faucet_nft.mint` với `MintPool`. **Builder:**
`buildMintPoolTx` ([`mintBuilder.ts`](./offchain/src/mintBuilder.ts)).

### 2.1 Trạng thái trước

- Chưa có POOL NFT nào của `faucet_nft_policy` (policy one-shot, chưa từng chạy).
- Ví deploy có ≥ 1 UTxO để làm genesis + đủ tADA.
- Có nguồn tLAMP để nạp: hoặc đúc trong cùng tx bằng `tlamp_policy` (đường mà `buildMintPoolTx` đi),
  hoặc tLAMP đã có sẵn trong ví.

### 2.2 Hành vi

Một giao dịch làm bốn việc:

1. **Consume genesis UTxO** — chính UTxO đã dùng để parameterize `faucet_nft`.
2. **Đúc đúng một POOL NFT** (`"POOL"`, qty 1) và **không đúc gì khác** dưới policy đó.
3. **Đúc tLAMP** (khi đi đường `tlamp_policy`: đúng toàn bộ tổng cung, một lần duy nhất trong lịch sử).
   Phần không nạp vào pool nằm lại ví deploy để nạp dần qua `TopUpPool`.
4. **Gửi POOL NFT + phần tLAMP khởi tạo vào pool UTxO** ở địa chỉ enterprise của `faucet_pool`, kèm
   inline `PoolDatum{cfg, window_epoch = cửa sổ THẬT, claims_in_window = 0, opened_root = sổ rỗng}`.

### 2.3 Trạng thái sau

- Một pool UTxO tại địa chỉ `faucet_pool`: value = `{ lovelace, POOL NFT, tLAMP }`, inline
  `PoolDatum`.
- Genesis UTxO biến mất → **POOL NFT khoá vĩnh viễn**, không ai đúc pool thứ hai.
- `FaucetConfig` **đóng băng vĩnh viễn** từ giây này. Không có đường nào sửa nó.

### 2.4 Cái gì bị từ chối (người deploy không làm bậy được)

| Mưu đồ / sai sót | Bị chặn bởi |
|---|---|
| Đúc mà không consume genesis (đúc pool thứ hai) | one-shot |
| Đúc 2 POOL NFT, hoặc đúc kèm một ACCT NFT trong cùng tx | `dict.size == 1` + `quantity_of(POOL) == 1` |
| Đúc POOL NFT **thẳng vào ví** | `C-MP-1` — nếu không chặn, `faucet_pool.spend` không bao giờ chạy và pool không có luật nào |
| Pool khởi tạo ở địa chỉ có stake credential lạ | `C-MP-2` |
| Pool khởi tạo mang reference script | `C-MP-3` |
| Datum sai hình dạng / không có datum | `C-MP-4` — datum sai làm prelude gãy với MỌI redeemer ⇒ khoá chết toàn bộ tLAMP |
| `claims_in_window` khởi tạo ≠ 0 | `C-MP-5` |
| `window_epoch = 0` (mặc định tự nhiên khi viết builder) | `C-MP-6` — mỗi bucket chưa dùng là một quota cộng dồn, nên `0` cho sẵn hàng nghìn bậc thang dùng được ngay |
| `max_claims_per_window = 0` | `C-MP-7` — `0` làm prelude pool gãy với mọi redeemer ⇒ khoá chết tLAMP |
| `max_claims_per_window` gõ nhầm rất lớn | `C-MP-7` trần `max_claims_ceiling = 100` |
| Sổ account khởi tạo **không rỗng** (khai sẵn DID "đã có account" dù chưa đúc ACCT nào) | `C-MP-8` — DID đó không bao giờ `ClaimOpen` được, và không có ACCT nào để thu hồi mà trả khoá về |

Năm hàng cuối đều **bất khả hồi**: sau tx này không còn cổng nào ép được datum pool.

---

## 3. Luồng B — `ClaimOpen`: mở account cho một DID chưa có account

**Caller:** chủ DID. **Script chạy:** `faucet_pool.spend` (`ClaimOpen`) + `faucet_nft.mint`
(`MintAccount`). **Builder:** `buildClaimOpenTx` ([`claimBuilder.ts`](./offchain/src/claimBuilder.ts)).

### 3.1 Trạng thái trước

- Pool UTxO tồn tại với `tLAMP ≥ drip_oildrop`.
- Trần tốc độ còn chỗ trong cửa sổ hiện tại: `claims_in_window + 1 ≤ max_claims_per_window` (nếu
  đang ở cùng cửa sổ; sang cửa sổ mới thì bộ đếm tính lại từ 0).
- Người claim có DID NFT trong ví.
- DID này **chưa có account đang sống** — chưa từng mở, hoặc account cũ đã bị thu hồi. Nếu đã có,
  đường đúng là `ClaimAgain` (§4).

### 3.2 Hành vi

```
inputs:  POOL UTxO (ClaimOpen{proof}) + DID-NFT UTxO  (0 account input)
mint:    ACCT NFT("ACCT" ‖ blake2b_224(did_name)) +1
outputs: pool'   = pool − drip tLAMP; PoolDatum{cfg giữ, window_epoch = now, claims = used+1,
                                                opened_root = sổ + DID này}
         account = ACCT NFT + drip tLAMP
                   FaucetAccount{did_name, last_claim_epoch = now, last_touch_epoch = now}
                   ở ĐÚNG địa chỉ enterprise của `account_script_hash`
         DID NFT trả về ví người claim
```

`now` = cửa sổ **thật**, suy từ validity range bị neo hai đầu trong cùng một bucket. Builder phải
đặt cửa sổ đó đúng cách, nếu không tx trượt ở biên bucket — xem
[CONTRACT](./CONTRACT.md) v3.1 §5.

`proof` là bằng chứng rằng DID **chưa** có trong sổ account; builder tự sinh nó từ danh sách account
đang sống (tham số `openedLedger`). Người dùng không phải dựng tay.

### 3.3 Trạng thái sau

| | tLAMP | POOL/ACCT NFT | datum |
|---|---|---|---|
| Pool trước | `P` | POOL NFT | `{cfg, w, k, sổ S}` |
| Pool sau | `P − drip` | POOL NFT (giữ) | `{cfg giữ, now, used+1, sổ S ∪ {DID}}` |
| Account (mới) | `drip` | ACCT NFT của DID này | `{did_name, now, now}` |

ADA và mọi asset khác của pool **bảo toàn tuyệt đối** (một đẳng thức `Value`).

### 3.4 Cái gì bị từ chối

| Mưu đồ | Bị chặn bởi |
|---|---|
| Claim không mang DID NFT | `C-DID-1` |
| Account mới đặt `did_name` khác DID NFT trong input | `C-NAME-1` + `C-DID-1` |
| Nhả > `drip` / < `drip` / rút ADA / cuỗm asset khác của pool | `C-DRIP-1` (đẳng thức `Value`) |
| Đẩy account ra **ví mình** (né cooldown và né thu hồi vĩnh viễn) | `C-ACCTOUT-1/2` |
| Đẩy account sang **script khác** | `C-ACCTOUT-2` |
| Cùng script hash nhưng khác stake credential | `C-ACCTOUT-2` (so địa chỉ đầy đủ) |
| Account mới mang reference script | `C-ACCTOUT-3` |
| Ghi mốc `last_*` lùi về quá khứ để thoả cooldown ngay lượt sau | `C-ACCTOUT-4/5` + `C-RATE-0` |
| Dùng validity range cận trên vô hạn để tự chọn `now` | `C-RATE-0` |
| Khai một bucket quá khứ để mở thêm quota (leo thang bậc thang) | `C-RATE-0` + `C-RATE-1` |
| Claim khi bộ đếm đã đầy | `C-RATE-2` |
| Ghi bộ đếm ra output sai (không tăng, hoặc cửa sổ giả) | `C-RATE-3/4` |
| Đúc hai ACCT NFT, hoặc đúc kèm POOL NFT | `C-OPEN-1`, `C-MA-1/2`, `quantity_of(POOL) == 0` |
| Đúc ACCT NFT mà không có pool nào bị spend | `C-MA-1` (đòi POOL NFT input) |
| Mở account thứ hai **trong cùng tx** với account cũ | `C-OPEN-2` |
| Mở account thứ hai cho DID **đã có account ở tx khác** (né cooldown bằng account mới) | `C-OPEN-UNIQ-1` — không có bằng chứng "vắng" hợp lệ cho khoá đã có trong sổ |
| Ghi sổ ra output sai (không chèn DID, hoặc chèn DID khác) | `C-OPEN-UNIQ-1` |
| Hai pool input (double-satisfaction) | prelude: đúng 1 input mang POOL NFT |
| POOL NFT input không nằm ở chính script pool | `C-POOL-IN-1` |
| Đưa pool ra ví / sang địa chỉ khác | `C-POOL-OUT-1` |
| Sửa `FaucetConfig` ở pool output | `C-CFG-1` |

---

## 4. Luồng C — `ClaimAgain`: nạp thêm drip vào account đã có

**Caller:** chủ DID. **Script chạy:** `faucet_pool.spend` (`ClaimAgain`) **và**
`faucet_account.spend` (`TopUp`) trên cùng một tx. **Builder:** `buildClaimAgainTx`
([`claimDidBuilder.ts`](./offchain/src/claimDidBuilder.ts)).

### 4.1 Trạng thái trước

- Pool còn tLAMP và còn chỗ trong trần tốc độ.
- Account của DID đó tồn tại với `last_claim_epoch` đủ cũ: `now ≥ last_claim_epoch + cooldown_epochs`.
- DID NFT trong ví.

### 4.2 Hành vi

```
inputs:  POOL UTxO (ClaimAgain) + account cũ (TopUp) + DID-NFT UTxO
mint:    (không đúc gì)
outputs: pool'    = pool − drip; bộ đếm tiến một bước; sổ account GIỮ NGUYÊN
         account' = account + drip tLAMP; cả hai mốc = now; địa chỉ và did_name bất biến
```

**Hai validator chia việc, không kiểm trùng:** `faucet_pool` ép cooldown và dòng tiền của pool;
`faucet_account` ▸ `TopUp` ép số tiền cộng vào ĐÚNG `drip_oildrop` **đọc từ datum của POOL input**,
và ép người dựng tx phải cầm DID NFT của chính account đó.

### 4.3 Trạng thái sau

| | tLAMP | datum |
|---|---|---|
| Pool | `P − drip` | `{cfg giữ, now, used+1}` |
| Account | `A + drip` | `{did_name giữ, now, now}` |

### 4.4 Cái gì bị từ chối

| Mưu đồ | Bị chặn bởi |
|---|---|
| Claim lại **trước** khi hết cooldown | `C-COOL-1` |
| **Không đưa account cũ vào input** để cooldown biến mất | `C-AGAIN-2` |
| Đưa **hai** account input (tiêu account người khác kèm theo) | `C-AGAIN-2` |
| Account input không mang ACCT NFT của DID này | `C-AGAIN-3` |
| Đổi `did_name` giữa input và output | `C-AGAIN-4`, `C-TOP-2` |
| Đúc thêm một ACCT NFT trong lượt claim lại | `C-MINT-ONLY-OPEN-1` |
| Đúc ACCT NFT của một DID **khác** trong lượt claim lại | `C-MINT-ONLY-OPEN-1` |
| Đúc ACCT NFT trong lượt **nạp tLAMP vào pool** | `C-MINT-ONLY-OPEN-2` |
| Đốt ACCT NFT trong lượt claim lại / lượt nạp pool | `C-TOP-4` / `C-MINT-ONLY-OPEN-2` |
| Thu hồi một account mà tiện tay ĐÚC ACCT NFT của DID khác | `C-RECL-BURN-2` |
| Bỏ rơi số tLAMP cũ của account (chỉ để lại drip mới) | `C-AGAIN-5` |
| Account nhận **nhiều hơn** drip mà pool khai | `C-TOP-5` |
| Account **rút bớt** tLAMP trong khi mang danh "nhận thêm drip" | `C-TOP-5` |
| Dựng tx `TopUp` mà không có POOL input (không nguồn nào khai drip) | `C-TOP-POOL-1` |
| Tiêu account của **người khác** bằng `TopUp` để đẩy mốc cooldown của họ | `C-TOP-DID-1` |
| Dùng redeemer `Use` cho account input trong tx `ClaimAgain` | `C-USE-NOPOOL-1` (cấm POOL NFT input) |
| Không cập nhật mốc cooldown (làm claim này "không tính") | `C-TOP-6` |
| Sửa sổ account trong lượt claim lại (xoá DID của mình rồi `ClaimOpen` lại né cooldown) | `C-ROOT-KEEP-1` |

**Về hàng "tiêu account của người khác":** thiệt hại không phải mất tLAMP — `C-TOP-5` khoá dòng tiền
nên kẻ dựng tx phải **tự bỏ** `drip` vào. Cái nó lấy được là quyền **ghi mốc** `last_claim_epoch` của
nạn nhân, tức hoãn lần claim kế tiếp của họ thêm `cooldown_epochs` cửa sổ, và hoãn cả `ReclaimIdle`.
Chốt canh nằm ở `faucet_account`, KHÔNG ở pool: `faucet_pool.Reclaim` cho hình dạng tx đó đi qua (nó
không mất gì nên mọi ràng buộc của pool đều thoả). Đừng "tối giản" `C-TOP-DID-1` với lý do "pool đã
kiểm".

---

## 5. Luồng D — `Use`: chủ DID dùng tLAMP test

**Caller:** chủ DID. **Script chạy:** `faucet_account.spend` (`Use`). **Builder:** `buildUseTx`
([`useBuilder.ts`](./offchain/src/useBuilder.ts)).

```
inputs:  account UTxO (Use) + DID-NFT UTxO            (CẤM POOL NFT input)
outputs: account': did_name bất biến
                   last_claim_epoch BẤT BIẾN
                   last_touch_epoch = now, và KHÔNG được lùi
                   tLAMP ≤ cũ (rút ra dùng được)
         phần tLAMP rút ra → đi đâu người dùng tự quyết
```

Hai việc trong một luồng: **gia hạn** mốc idle (để account không bị thu hồi) và **rút** tLAMP ra
dùng. Account được phép về 0 tLAMP mà vẫn tồn tại.

| Mưu đồ | Bị chặn bởi |
|---|---|
| Spend account mà không có DID NFT của nó | cổng DID trong nhánh `Use` |
| `Use` đẩy mốc **cooldown** lên `now` (reset/né cooldown) | `C-USE-CLAIMFIX-1` |
| `Use` **lùi** mốc idle về quá khứ (account bị thu hồi sớm hơn chủ tưởng) | `C-USE-MONO-1` |
| Ghi mốc idle khác `now` | `C-USE-TOUCH-1` |
| Cận trên vô hạn để tự chọn `now` | `C-USE-EPOCH-1` |
| **Bơm** tLAMP vào account | `out ≤ in` |
| Đưa account ra ví / đổi stake credential / gắn reference script | `C-ACCT-ADDR-1`, `C-ACCT-REF-1` |
| Đúc thêm hoặc **đốt** ACCT NFT trong lượt `Use` (thoát script không qua `ReclaimIdle`) | `C-USE-2` |
| Ghép một tx `ClaimAgain` nhưng dùng redeemer `Use` cho account | `C-USE-NOPOOL-1` |

`Use` cố ý **không** có hình dạng tx nào chạy cùng `faucet_pool` — đó là tính chất, không phải chỗ
thiếu: `Use` cấm tLAMP tăng, `TopUp` bắt buộc tăng; không rời nhau thì cả hai chốt mất nghĩa.

---

## 6. Luồng E — `ReclaimIdle`: thu hồi account nằm không

**Caller:** keeper bất kỳ (permissionless). **Script chạy:** `faucet_account.spend` (`ReclaimIdle`) +
`faucet_pool.spend` (`Reclaim`) + `faucet_nft.mint` (`BurnAccount`). **Builder:** `buildReclaimTx`
([`reclaimBuilder.ts`](./offchain/src/reclaimBuilder.ts)).

```
inputs:  account idle (ReclaimIdle) + POOL UTxO (Reclaim{proof})
mint:    ACCT NFT −1
outputs: pool' = pool + TOÀN BỘ tLAMP của account (có thể là 0)
                 window_epoch và claims_in_window GIỮ NGUYÊN; sổ account bỏ DID này
```

Điều kiện: `now ≥ last_touch_epoch + 72` cửa sổ — tức `72 × ms_per_epoch`: ≈ **360 ngày** trên
Preprod/Mainnet (cửa sổ 5 ngày, trùng epoch Cardano); Preview chưa có gốc cửa sổ (WIN-PREVIEW, §1). Đọc mốc **IDLE**, không
phải mốc cooldown: chủ DID gọi `Use` là gia hạn. KHÔNG cần DID NFT ⇒ ai cũng làm keeper được.

**Sau thu hồi, DID được mở lại.** Thu hồi bỏ DID khỏi sổ account, nên chủ DID `ClaimOpen` lại được
như người mới — đây là hệ quả cố ý: thu hồi thu **token nằm không**, không phạt **người**. Account đã
rút sạch (0 tLAMP) cũng thu hồi được; không có đường đó thì một DID đã dùng hết token giữ chỗ trong sổ
mãi mà không lượt thu hồi nào trả được.

Nhánh này cố ý đọc **cận dưới** của validity range: keeper lùi thời gian thì chỉ tự mình không đủ
điều kiện, không ai khác thiệt.

| Mưu đồ | Bị chặn bởi |
|---|---|
| Thu hồi **sớm** hơn ngưỡng | điều kiện idle |
| Keeper cuỗm một phần tLAMP của account | `pool_out − pool_in ≥ acct_lamp` (so **delta**, không so tuyệt đối) |
| Trả đủ tLAMP nhưng đưa **pool** sang ví mình | `C-ACCT-POOLADDR-1` |
| Cùng script hash pool, khác stake credential | `C-ACCT-POOLADDR-1` |
| Không đốt ACCT NFT (giữ nó làm vé tái dùng vĩnh viễn) | `C-BURN-1` |
| Đốt ACCT NFT của DID **khác** (giữ lại vé của chính mình) | `C-BURN-1` |
| Xen `Reclaim` để **reset bộ đếm** tốc độ | `C-RECL-1/2` |
| `Reclaim` **spend rỗng** (không account input, Δ = 0) — DoS trên một singleton giá một phí tx | `C-RECL-0` |
| Bỏ DID khỏi sổ mà **không** đốt ACCT NFT của nó (DID có hai account) | `C-RECL-BURN-1` |
| Xoá khỏi sổ DID **khác** DID của account bị thu hồi | `C-RECL-UNIQ-1` |

**Bảo toàn cung:** token nằm không quay lại pool, không bốc hơi, không vào ví keeper.

---

## 7. Luồng F — `TopUpPool`: nạp tLAMP vào pool

**Caller:** bất kỳ ai có tLAMP (vận hành). **Script chạy:** `faucet_pool.spend` (`TopUpPool`).
**Builder:** `buildTopUpPoolTx` ([`topUpPoolBuilder.ts`](./offchain/src/topUpPoolBuilder.ts)).

```
inputs:  POOL UTxO (TopUpPool) + nguồn tLAMP của người nạp   (CẤM account input)
outputs: pool' = pool + Δ tLAMP, với Δ ≥ drip_oildrop
                 window_epoch và claims_in_window GIỮ NGUYÊN
```

| Mưu đồ | Bị chặn bởi |
|---|---|
| "Nạp" Δ = 0 (spend rỗng đội lốt nạp tiền) | `C-TUP-1` |
| Mượn đường nạp để tiêu một account input | 0 account input |
| Nạp tiền mà tiện tay reset bộ đếm tốc độ | `C-TUP-2/3` |
| Rút ADA hoặc asset khác của pool trong lượt nạp | đẳng thức `Value` trên delta |

---

## 8. Pool cạn — điều gì xảy ra

Pool nhả `drip` mỗi claim. Khi `tLAMP_pool < drip`, `C-DRIP-1` không thoả được nữa ⇒ mọi tx claim
**fail on-chain**, và builder nên chặn trước ở off-chain thay vì để người dùng trả phí cho một tx
chắc chắn trượt.

Đường phục hồi là `TopUpPool` (nạp thêm) hoặc `ReclaimIdle` (thu token nằm không về). **Không
validator nào của Faucet đúc thêm tLAMP** — đó là điểm của thiết kế, không phải hạn chế. Nguồn tLAMP
cho `TopUpPool` đến từ ngoài module (xem §0.2).

---

## 9. Tóm tắt trạng thái — bảng chuyển

| Thao tác | Caller | Trước | Sau | Bất biến giữ |
|---|---|---|---|---|
| `MintPool` | người deploy (1 lần) | chưa có POOL NFT | pool + POOL NFT khoá + cfg đóng băng, sổ account rỗng | POOL NFT one-shot, `claims = 0`, `window = now` |
| `ClaimOpen` | chủ DID chưa có account | pool `P`, bộ đếm `k`, sổ `S` (DID ∉ S) | pool `P−drip`, `k+1`, sổ `S ∪ {DID}`; account mới `drip` | Σ tLAMP, ADA + asset khác của pool, cfg, mỗi DID ≤ 1 account |
| `ClaimAgain` | chủ DID đã có account | pool `P`, account `A` | pool `P−drip`, account `A+drip` | Σ tLAMP, cooldown, cfg, sổ |
| `Use` | chủ DID | account `A` | account `≤ A`, mốc idle = now | mốc cooldown, `did_name`, ACCT NFT ở lại |
| `ReclaimIdle` | keeper bất kỳ | account `A ≥ 0` idle ≥ 72 cửa sổ, DID ∈ S | pool `+A`, ACCT NFT bị đốt, sổ `S \ {DID}` | Σ tLAMP, bộ đếm tốc độ, mỗi DID ≤ 1 account |
| `TopUpPool` | ai có tLAMP | pool `P` | pool `P+Δ`, `Δ ≥ drip` | bộ đếm tốc độ, cfg, sổ |
| `ClaimOpen` lần hai cùng DID | chủ DID | DID ∈ S | (reject) | mỗi DID ≤ 1 account |
| claim khi pool `< drip` | chủ DID | pool cạn | (reject) | — |
| claim khi bộ đếm đầy | chủ DID | `k = max` | (reject) | trần tốc độ |

Mọi thao tác **không bao giờ** đúc thêm hay đốt tLAMP — fixed-supply trung thực, phản chiếu đúng LAMP
mainnet 36 tỷ bất biến.
