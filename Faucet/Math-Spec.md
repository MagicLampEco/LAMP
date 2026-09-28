# tLAMP + Faucet — MATH (Cơ sở toán)

> **Phiên bản:** v3.0 — 2026-09-28. Nâng cấp từ draft 2026-06-09 vì §3–§6 của bản đó chứng minh các
> vị từ `F0..F3` của `faucet.ak` — validator đã bị xoá khỏi cây mã. Bản này chứng minh các bất biến
> của ba validator hiện tại, trong đó có hai tính chất bản cũ **không có**: trần tốc độ theo cửa sổ
> và tính "thời gian không giả được".
> **Vai:** chứng minh hình thức các bất biến mà [CONTRACT](./CONTRACT.md) v3.0 phát biểu. Khi lệch với
> mã trong `onchain/`, **mã thắng** — một chứng minh không khớp mã là một chứng minh cho hệ khác.

> Mọi số nguyên là **BigInt thuần** (không float). Đơn vị nhỏ nhất = **oildrop**,
> `1 LAMP = 10^6 oildrop` (decimals 6, khớp `Distribution/constants`).

---

## 0. Ký hiệu

| Ký hiệu | Nghĩa |
|---|---|
| `T` | tổng cung tLAMP (oildrop) = `36_000_000_000 × 10^6` = `3.6e16` |
| `d` | `cfg.drip_oildrop` — lượng nhả mỗi claim (chuẩn `1_001_000_000`) |
| `K` | `cfg.max_claims_per_window` — trần claim mỗi cửa sổ, `0 < K ≤ 100` |
| `L` | `cfg.cooldown_epochs` — số cửa sổ tối thiểu giữa hai claim của cùng một chuỗi account |
| `R` | `handlers.reclaim_epochs_const` = `1001` cửa sổ |
| `m` | `ms_per_epoch` — độ dài một cửa sổ, tính bằng ms |
| `e(s)` | nhãn cửa sổ của một mốc POSIX-ms `s`, bằng `⌊s / m⌋` |
| `w`, `k` | `PoolDatum.window_epoch`, `PoolDatum.claims_in_window` |
| `p`, `n` | policy id và asset name của tLAMP (`n = #"744c414d50"`) |
| `V(v, p, n)` | `assets.quantity_of(v, p, n)` |
| `g` | `genesis_ref : OutputReference` (tham số one-shot) |
| `an(x)` | `ledger.acct_name(x)` = `"ACCT" ‖ blake2b_224(x)`, 32 byte |

Quy ước value: `assets.add(v, p, n, q)` = `v` với entry `(p,n)` cộng thêm `q`; kết quả 0 thì entry
**biến mất** (tính chất của `Value` stdlib, dùng ở §2.2).

---

## 1. Bất biến nền — phát biểu

- **(I-SUPPLY)** Tổng tLAMP tồn tại = `T`, bất biến sau bước mint ban đầu; không bao giờ tăng
  (re-mint) hay giảm (burn).
- **(I-CONSERVE)** Mỗi thao tác Faucet chỉ **di chuyển** tLAMP; `Σ_out = Σ_in` cho **mọi** asset, kể
  cả ADA và dust của pool.
- **(I-CFG)** `FaucetConfig` bất biến từ giây đúc POOL NFT tới vĩnh viễn.
- **(I-RATE)** Trong một cửa sổ **thật**, số lượt claim thành công ≤ `K`. Đây là bất biến duy nhất
  chặn vét pool, và nó không phụ thuộc số DID.
- **(I-COOLDOWN)** Hai lượt claim liên tiếp trên **cùng một chuỗi account** cách nhau ≥ `L` cửa sổ.
- **(I-RECOVER)** Token của một account bị thu hồi quay về pool **trọn vẹn**, và ACCT NFT của nó bị
  đốt.

`I-SUPPLY` độc lập với chuẩn metadata (native FT, không CIP-68). `I-RATE` và `I-COOLDOWN` **không
thay thế nhau**: `I-RATE` chặn tổng, `I-COOLDOWN` chặn một chuỗi — xem §6.

---

## 2. `tlamp_policy` — one-shot + đúng tổng cung

Vị từ của `tlamp_policy.mint`:

```
(M1) list.any(tx.inputs, λi. i.output_reference == g)     -- consume genesis
(M2) dict.size(assets.tokens(mint, p)) == 1                -- đúng 1 asset name
(M3) V(mint, p, n) == T                                    -- đúng tổng cung
else → fail                                                -- mọi mint khác
```

### 2.1 Định lý ONE-SHOT

**Mệnh đề.** Với `g` cố định, không tồn tại hai transaction hợp lệ phân biệt `tx₁ ≠ tx₂` mà cả hai
cùng mint dưới policy `p` thành công.

**Chứng minh.** Theo (M1), mỗi tx phải có một input với `output_reference == g`. Trong sổ cái eUTXO,
một `OutputReference` chỉ bị consume tối đa một lần (luật no-double-spend: UTxO đã chi không còn
trong UTxO set). Vậy không thể có hai tx riêng biệt cùng consume `g`. ⇒ `tx₁ = tx₂`. ∎

**Hệ quả (I-SUPPLY, nửa "không re-mint").** Sau tx mint đầu tiên, `g` đã bị tiêu → mọi mint sau fail
tại (M1). Tổng tLAMP không bao giờ vượt `T`.

Đây là bất biến mạnh nhất đạt được **không cần state on-chain** — nó neo vào tính no-double-spend của
ledger. Ca kiểm: `mint_without_genesis`, `rt_mint_genesis_wrong_index` (off-by-one `output_index` cũng
fail vì `OutputReference` so cả hai trường).

### 2.2 Định lý ĐÚNG TỔNG CUNG

**Mệnh đề.** Tx mint hợp lệ ⇒ `V(mint,p,n) = T` **và** policy `p` không mint asset name nào khác `n`.

**Chứng minh.** (M3) cho trực tiếp `V(mint,p,n) = T`. (M2) cho `dict.size(tokens(mint,p)) = 1`: đúng
một entry asset name dưới `p`. Kết hợp (M3) — entry đó là `n` với lượng `T ≠ 0` nên nó **tồn tại**
trong dict — suy ra entry duy nhất chính là `(n, T)`. ∎

**Ba góc đã đóng:**
- Mint `n` đúng `T` + một name lạ qty âm (giả "burn" để né `dict.size`): `add(…, name', −1)` **vẫn tạo
  entry** ⇒ `dict.size = 2` ⇒ fail (M2). Ca kiểm `rt_mint_lamp_plus_negative_other`.
- Mint `n` qty 0: `add(p,n,0)` **không tạo entry** ⇒ `dict.size = 0` ⇒ fail (M2). Ca `rt_mint_zero_qty`.
- Mint chỉ name lạ qty `T` (mạo danh): `dict.size = 1` qua (M2) nhưng `V(mint,p,n) = 0 ≠ T` ⇒ fail
  (M3). Ca `rt_mint_only_fake_name`.

### 2.3 Định lý KHÔNG BURN

**Mệnh đề.** Không tồn tại tx hợp lệ với `V(mint,p,n) < 0`.

**Chứng minh.** (M3) đòi `V(mint,p,n) = T > 0`; giá trị âm vi phạm (M3). Mọi nhánh khác rơi vào
`else → fail`. ∎ Ca `mint_negative_burn`.

> **Liên hệ định hướng dài hạn:** LAMP mainnet fixed-supply 36 tỷ BẤT BIẾN, không bao giờ burn. tLAMP
> phản chiếu đúng tính chất đó.

---

## 3. Pool là một singleton — tiền đề cho mọi định lý sau

**Mệnh đề (POOL-SINGLETON).** Tại mọi thời điểm sau deploy, tồn tại **đúng một** UTxO mang POOL NFT,
và nó nằm ở địa chỉ mà tx `MintPool` đã đặt.

**Chứng minh.** Ba vế.
1. *Tồn tại tối đa một bản.* `faucet_nft.mint ▸ MintPool` đòi consume `genesis_ref` (one-shot, §2.1),
   `dict.size(own_tokens) == 1` và `quantity_of(POOL) == 1` ⇒ tổng cung POOL NFT = 1 vĩnh viễn. Nhánh
   `MintAccount` ép `quantity_of(tx.mint, policy, POOL) == 0` nên không đúc thêm qua đường đó; nhánh
   `BurnAccount` ép tên có tiền tố `"ACCT"` và độ dài 32 byte, còn `"POOL"` dài 4 byte ⇒ không đốt POOL
   NFT qua đường đó.
2. *Bản đó ở script pool.* `C-MP-1` ép `pool_out.address.payment_credential` là `Script(_)`, `C-MP-2`
   ép không stake credential.
3. *Nó ở lại đúng chỗ đó.* Prelude của `faucet_pool.spend` ép đúng một POOL NFT input và đúng một POOL
   NFT output, `C-POOL-IN-1` ép input đó ở chính script đang chạy, `C-POOL-OUT-1` ép output ở **địa chỉ
   đầy đủ** của input. Nếu POOL NFT lạc ra một địa chỉ không script thì `faucet_pool.spend` không được
   gọi nữa — và khi đó `C-ACCT-POOLADDR-1` trong `ReclaimIdle` là cổng còn lại ép pool_out về đúng địa
   chỉ pool_in. ∎

Ca kiểm: `mint_pool_happy`, `mint_pool_without_genesis`, `mint_pool_wrong_qty`,
`mint_pool_with_extra_acct`, `mintpool_nft_vao_vi`, `mintpool_stake_credential`,
`mint_account_touches_pool_nft`, `burn_account_lan_prefix_pool`, `poc_pool_nft_input_not_at_own_script`,
`poc_claim_pool_to_wallet`, `poc_reclaim_pool_to_wallet`, `poc_reclaim_pool_stake_hijack`.

**Hệ quả (I-CFG).** `C-CFG-1` ép `out_pd.cfg == cfg` ở **mọi** lượt spend, và theo POOL-SINGLETON
không có đường nào tạo một pool thứ hai với `cfg` khác. Vậy `cfg` đóng băng từ tx `MintPool`. Cổng duy
nhất còn ép được giá trị khởi tạo là `C-MP-4..7`. Ca `cfg_bi_doi_o_output`, `cfg_max_claims_khong_duong`,
`mintpool_max_vuot_tran`, `mintpool_max_bang_tran` (ca dương song sinh), `mintpool_max_bang_0`.

---

## 4. Định lý THỜI GIAN KHÔNG GIẢ ĐƯỢC (tiền đề của I-RATE)

Hai hàm đọc thời gian:

```
get_epoch(tx, m)        = ⌊lo / m⌋                          -- chỉ cận dưới
get_epoch_pinned(tx, m) = e  với  e = ⌊lo/m⌋  và  ⌊hi/m⌋ = e -- ép cả hai cận
```

**Mệnh đề.** Gọi `s` là slot/mốc thời gian mà ledger dùng để xác nhận tx. Nếu tx hợp lệ với ledger và
validator gọi `get_epoch_pinned(tx, m) = e`, thì `e(s) = e` — giá trị trả về là cửa sổ **thật**.

**Chứng minh.** Ledger chỉ chấp nhận tx khi `s ∈ [lo, hi]`. `get_epoch_pinned` đòi cả hai cận hữu hạn
và `⌊lo/m⌋ = ⌊hi/m⌋ = e`, tức `[lo, hi]` nằm trọn trong một cửa sổ `e`. Vậy `s ∈ [lo,hi] ⊆` cửa sổ `e`
⇒ `e(s) = e`. ∎

**Đối chiếu với `get_epoch`.** Ledger chỉ đòi `lo ≤ s`, nên `⌊lo/m⌋ ≤ e(s)` và người dựng tx đặt `lo`
nhỏ tuỳ ý. `get_epoch` vì thế **chỉ** dùng được ở chốt mà "khai nhỏ hơn thật" gây bất lợi cho chính
người dựng tx — trong toàn bộ mã đúng một chỗ: `ReclaimIdle` (khai nhỏ ⇒ `now ≥ last_touch + R` khó
thoả hơn ⇒ tự mình không thu hồi được).

**Vì sao không dùng một hàm cho cả hai:** hai họ chốt **ngược dấu**. Cooldown cần "không khai `now`
LỚN hơn thật"; `window_epoch` cần "không khai `now` NHỎ hơn thật". Cận dưới chỉ trả lời vế đầu.

Ca kiểm: `rate_upper_bound_vo_han` (cận trên vô hạn ⇒ đỏ), `use_upper_bound_vo_han`,
`rate_leo_thang_bac_thang` (khoảng **trải hai bucket** — hình dạng duy nhất còn lại để khai một bucket
quá khứ, vì một khoảng nằm trọn trong quá khứ bị chính **ledger** từ chối, không phải validator),
`reclaim_idle_too_early`.

---

## 5. Định lý TRẦN TỐC ĐỘ (I-RATE)

Vị từ trong `check_claim` (chạy cho cả `ClaimOpen` và `ClaimAgain`), với `pd` là datum vào, `out_pd`
datum ra:

```
(R0) now = get_epoch_pinned(tx, m)
(R1) now ≥ pd.window_epoch
(R2) used + 1 ≤ K,    used = if now == pd.window_epoch then pd.claims_in_window else 0
(R3) out_pd.window_epoch == now
(R4) out_pd.claims_in_window == used + 1
```

và ở hai nhánh không-claim:

```
(P1) Reclaim:   out_pd.window_epoch == pd.window_epoch  ∧  out_pd.claims_in_window == pd.claims_in_window
(P2) TopUpPool: y hệt (P1)
```

**Mệnh đề (I-RATE).** Với mỗi nhãn cửa sổ `e`, số tx claim thành công có `e(s) = e` không vượt `K`.

**Chứng minh.** Theo POOL-SINGLETON, mọi tx claim tạo thành một **chuỗi tuyến tính** trên pool UTxO;
gọi `(w_i, k_i)` là datum sau tx thứ `i` của chuỗi. Theo §4 và (R0), mỗi tx claim có `now = e(s)`, tức
cửa sổ thật của chính nó — không giả được.

Xét các tx claim có `e(s) = e`, theo thứ tự chuỗi. Với tx đầu tiên trong nhóm đó, gọi `(w, k)` là datum
vào. (R1) cho `e ≥ w`.
- Nếu `w < e`: `used = 0`, và (R3)/(R4) cho datum ra `(e, 1)`.
- Nếu `w = e`: `used = k`, datum ra `(e, k+1)`, với `k+1 ≤ K` theo (R2).

Với mọi tx claim tiếp theo trong cùng nhóm, datum vào đã có `w = e` (nó là datum ra của tx trước, hoặc
đã đi qua các tx `Reclaim`/`TopUpPool` mà theo (P1)/(P2) **bảo toàn** `(w, k)`). Vậy `used = k` và mỗi
tx làm `k` tăng đúng 1, trong khi (R2) đòi `k + 1 ≤ K`. Dãy `k` trong cửa sổ `e` do đó tăng đơn vị một
và bị chặn trên bởi `K`; khi `k = K` thì (R2) không thoả và không tx claim nào trong cửa sổ `e` đi qua
được nữa. Số tx claim với `e(s) = e` ≤ `K`. ∎

**Ba đường phá mà chứng minh này phụ thuộc — gỡ một cái là mất định lý:**
1. Không có (R0) thì `now` khai được ở một bucket quá khứ, mỗi bucket chưa dùng là một quota mới, và
   một chuỗi tx nối nhau **trong cùng một cửa sổ thật** vượt trần tuyệt đối (leo thang bậc thang).
2. Không có (R1) thì `w` lùi được so với datum, cho lại quota đã tiêu.
3. Không có (P1) thì xen một `Reclaim` reset bộ đếm miễn phí — và `Reclaim` là permissionless.

Ca kiểm: `rate_claim_thu_max_pass` (ca dương ở đúng trần), `poc_vet_N_lan_trong_mot_cua_so`,
`rate_cua_so_moi_reset` (ca dương: sang cửa sổ mới thì bộ đếm tính lại), `rate_window_lui_ve_qua_khu`,
`rate_out_claims_khong_tang`, `rate_out_window_gia_mao`, `rate_upper_bound_vo_han`,
`rate_leo_thang_bac_thang`, `reclaim_reset_bo_dem`, `reclaim_doi_window`, `topuppool_doi_bo_dem`,
`mintpool_window_khong_phai_now`, `mintpool_claims_khac_0`.

**Chặn trên của thiệt hại.** Kể cả khi một người điều khiển nhiều DID, họ không lấy được quá `K × d`
oildrop mỗi cửa sổ. Đó là lý do `I-RATE` — không phải cooldown — là chốt chống vét pool.

---

## 6. Định lý COOLDOWN, và giới hạn CHÍNH XÁC của nó

```
(C1) ClaimAgain: now ≥ old.last_claim_epoch + L         -- đọc mốc COOLDOWN
(C2) ClaimAgain: đúng 1 account input ở account_script_hash, mang ACCT NFT an(did_name)
(C3) ClaimOpen:  0 account input
(C4) Use:        out.last_claim_epoch == acct.last_claim_epoch
(C5) TopUp:      out.last_claim_epoch == now  ∧  tx mang DID NFT của did_name
```

**Mệnh đề (I-COOLDOWN).** Trên một **chuỗi account** (dãy UTxO nối nhau mang cùng ACCT NFT), hai lượt
`ClaimAgain` liên tiếp có nhãn cửa sổ cách nhau ≥ `L`.

**Chứng minh.** Lượt claim thứ `i` ghi `last_claim_epoch = now_i` (`C-ACCTOUT-4` cho `ClaimOpen`,
`C-TOP-6` cho `TopUp` ở `ClaimAgain`). Lượt thứ `i+1` đọc chính UTxO đó làm input — (C2) buộc account
cũ phải có mặt và mang đúng ACCT NFT — rồi (C1) đòi `now_{i+1} ≥ now_i + L`. Theo §4, cả `now_i` và
`now_{i+1}` là cửa sổ thật. (C4) đảm bảo không lượt `Use` nào chen vào giữa để dịch mốc đó, và (C5)
đảm bảo không ai **khác** dịch được nó. ∎

**Giới hạn — đây là phần quan trọng hơn cả định lý.** `I-COOLDOWN` nói về một **chuỗi account**, không
nói về một **người** và cũng không nói về một `did_name`. (C3) chỉ đòi tx `ClaimOpen` không có account
input trong **chính tx đó** — nó không đòi "DID này chưa có account nào ở bất kỳ đâu". Nên một
`did_name` mở được nhiều chuỗi account song song, mỗi chuỗi có mốc cooldown riêng, và tổng số lượt của
chúng chỉ bị chặn bởi `I-RATE`.

⇒ **Cooldown là tiện lợi kế toán, KHÔNG phải cơ chế công bằng.** Điểm treo `[FAUCET-ACCT-UNIQUE]`
([README](./README.md) v3.0 §Điểm còn treo) ghi đúng giới hạn này cùng ràng buộc tạm đang chặn thiệt
hại (`I-RATE` + `max_claims_ceiling`). Ca kiểm cho vế đã đóng của nó:
`poc_duc_account_thu_hai_cung_name` (đúc account thứ hai **trong cùng tx** với account cũ ⇒ đỏ),
`poc_claim_khong_kem_account_cu`, `again_hai_account_input`, `again_cooldown_thieu_1_epoch`,
`again_happy_sau_cooldown` (ca dương), `use_doi_last_claim_epoch`, `use_gia_han_khong_doi_cooldown`
(ca dương song sinh), `topup_khong_did_nft`, `topup_griefing_hai_validator`.

---

## 7. Định lý BẢO TOÀN VALUE (I-CONSERVE)

### 7.1 Claim — đẳng thức bao trùm

```
(D1) pool_out.value == assets.add(pool_in.value, p, n, −d)
```

**Mệnh đề.** Với claim hợp lệ, với **mọi** asset `(p',n')`:

```
V(pool_out, p',n') = V(pool_in, p',n') − d · [ (p',n') = (p,n) ]
```

**Chứng minh.** (D1) là đẳng thức `Value`: `assets.add(v,p,n,−d)` thay đổi **duy nhất** entry `(p,n)`,
giữ nguyên mọi entry khác. `Value` so sánh per-entry ⇒ với `(p',n') ≠ (p,n)` thì hai bên bằng nhau, và
với `(p,n)` thì lệch đúng `−d`. ∎

**Hệ quả 1 — không rút ADA / asset khác.** Đặt `(p',n')` = lovelace hay bất kỳ dust: bảo toàn. Pool
**được phép** ôm asset phụ; đẳng thức chỉ cấm **thay đổi** nó. Ca `claim_pool_drain_extra`,
`reclaim_steal_ada`.

**Hệ quả 2 — nhả đúng `d`.** Nhả `> d` ⇒ pool_out thiếu; nhả `< d` ⇒ pool_out thừa; cả hai lệch đẳng
thức. Ca `claim_wrong_drip`.

**Hệ quả 3 — POOL NFT không rời pool.** POOL NFT là một entry của `pool_in.value`, nên (D1) giữ nó lại
cùng lúc với ADA. Không cần một dòng riêng.

### 7.2 Token tới đúng ĐÍCH, không chỉ đúng SỐ LƯỢNG

Đẳng thức (D1) nói pool **mất** đúng `d`; nó **không** nói `d` đi đâu. Vế đích do bốn chốt khác đóng:
`C-ACCTOUT-1` (đúng một output ở `account_script_hash`), `C-ACCTOUT-2` (địa chỉ đó là địa chỉ
enterprise của chính hash ấy), `C-ACCTOUT-3` (không reference script), `C-OPEN-3`/`C-AGAIN-5` (số tLAMP
ở output đó đúng bằng `d`, hoặc `cũ + d`).

**Vì sao vế đích phải có chốt riêng, và vì sao nó không phải phòng thủ thừa:** một output đúng số
lượng nhưng sai đích là một tài sản **nằm ngoài mọi luật**. Nếu account ra ví, chủ nó né được cooldown
(lượt sau mở chuỗi mới) **và** `ReclaimIdle` không bao giờ chạm tới được số tLAMP đó — pool chảy một
chiều, và không validator nào trong module này đúc lại được. So **địa chỉ đầy đủ** chứ không chỉ payment
credential:
cùng script hash + khác stake credential là hai Address khác nhau nhưng cùng validator, và phần thưởng
uỷ quyền trên ADA của UTxO đó chảy về khoá stake của kẻ dựng tx.

Ca kiểm: `claim_acct_out_ra_vi`, `claim_acct_out_script_khac`, `claim_acct_out_stake_hijack`,
`claim_acct_out_script_carrier`, `claim_name_khong_khop_did`, `claim_hai_acct_nft_cung_name`.

### 7.3 Account — hai chiều ngược nhau, hai nhánh rời nhau

```
(U1) Use:   0 ≤ V(acct_out) ≤ V(acct_in)                    -- giảm được, tăng thì không
(U2) Use:   0 POOL NFT input trong tx
(T1) TopUp: V(acct_out) == V(acct_in) + pd.cfg.drip_oildrop  -- pd đọc từ POOL input
(T2) TopUp: đúng 1 POOL NFT input
```

**Mệnh đề.** `Use` và `TopUp` **rời nhau**: không tồn tại tx nào cả hai nhánh cùng chấp nhận.

**Chứng minh.** (U2) đòi 0 POOL NFT input, (T2) đòi đúng 1. Hai điều kiện loại trừ nhau. ∎

**Vì sao cần mệnh đề này.** (U1) cấm tăng, (T1) bắt buộc tăng. Nếu hai nhánh không rời nhau, một tx
`pool.ClaimAgain` chọn được nhánh `Use` cho account input, và khi đó **cả hai** chốt mất nghĩa: chốt
"account không tự bơm" bị lách bằng cách dùng nhánh kia, còn chốt "account nhận đúng drip" bị lách
bằng cách dùng nhánh này. Ca `again_account_dung_redeemer_Use` (đỏ), `use_co_pool_input` (đỏ),
`again_happy_hai_validator` (ca dương: cùng một tx, pool `ClaimAgain` + account `TopUp`, **cả hai**
xanh).

**Mệnh đề (số tiền không do bên pool tự khai).** (T1) đọc `drip_oildrop` từ **datum của POOL input**,
định vị bằng POOL NFT. Không có vế đó, một tx `pool.Reclaim` + `acct.TopUp` rút sạch tLAMP của một
account mà **không cần** DID NFT của nó: `Reclaim` chỉ đòi đúng một account input và `lamp_out ≥
lamp_in`, cả hai đều thoả khi Δ = 0. Ca `topup_rut_bot_tlamp`, `topup_nhan_hon_drip`,
`topup_khong_co_pool_input`, `topup_happy` (ca dương).

### 7.4 Thu hồi (I-RECOVER)

```
(G1) now ≥ acct.last_touch_epoch + R,  now = get_epoch(tx, m)   -- cận dưới, cố ý
(G2) pool_lamp_out − pool_lamp_in ≥ V(acct_in, p, n)
(G3) pool_out.address == pool_in.address
(G4) V(tx.mint, faucet_nft_policy, an(did_name)) == −1
```

**Mệnh đề.** Thu hồi hợp lệ ⇒ toàn bộ tLAMP của account về pool, và ACCT NFT của nó bị đốt.

**Chứng minh.** (G2) so **delta** của pool chứ không so tuyệt đối ⇒ keeper không "đếm sẵn" số tLAMP
đang có trong pool để né; delta ≥ số tLAMP của account nghĩa là không thiếu một đơn vị nào. (G3) buộc
delta đó rơi vào đúng pool UTxO chứ không vào một địa chỉ khác mang POOL NFT. (G4) đốt đúng một đơn vị
ACCT NFT của **chính** `did_name` này. ∎

**Vì sao (G4) không bỏ được:** không đốt thì ACCT NFT ra khỏi script và thành **vé tái dùng vĩnh
viễn** — ai giữ nó dựng được một UTxO "account" ở ví với datum tự đặt. Và cổng này chỉ đứng ở
`faucet_account`: `faucet_pool.Reclaim` **không** canh `tx.mint`, nên một tx thu hồi thiếu bước đốt vẫn
làm pool xanh. Ca `reclaim_idle_khong_burn_hai_validator` ghim đúng cặp đó (pool xanh, account đỏ) —
đừng trông vào pool. Ca khác: `reclaim_idle_happy` (dương), `reclaim_idle_happy_hai_validator` (dương,
hai validator), `reclaim_idle_token_not_to_pool`, `reclaim_idle_no_pool_output`,
`reclaim_idle_khong_burn_acct`, `reclaim_idle_burn_name_khac`, `reclaim_idle_pool_to_wallet`,
`reclaim_idle_pool_stake_hijack`.

**Vì sao (G1) dùng cận dưới là an toàn:** khai `now` nhỏ hơn thật chỉ làm `now ≥ last_touch + R` khó
thoả hơn ⇒ keeper tự chặn chính mình. Không ai khác thiệt.

### 7.5 `Reclaim` và `TopUpPool` không phải cửa spend rỗng

`Reclaim` đòi **đúng một** account input (`C-RECL-0`); `TopUpPool` đòi `Δ ≥ d` (`C-TUP-1`) và **0**
account input. Không có hai chốt đó, mỗi nhánh là một cửa spend rỗng **permissionless trên một
singleton**: giá một phí tx, lặp mỗi block ⇒ mọi claim của người thật trượt vĩnh viễn, và với `Reclaim`
thì việc giữ `window_epoch` đứng im còn nuôi thêm đường leo thang quota. Ca `reclaim_spend_rong`,
`topuppool_delta_0`, `topuppool_co_account_input`.

---

## 8. Định lý CHỐNG DOUBLE-SATISFACTION

Đếm theo **payment script hash**, không theo full-address (`util.count_*_at_script`,
`util.count_*_with_nft`).

**Mệnh đề.** Mỗi lượt spend hợp lệ có **đúng một** input và **đúng một** output mang beacon tương ứng
(POOL NFT cho pool; script hash của chính nó cho account), và số account input/output ở
`account_script_hash` bị ghim chính xác theo từng nhánh (`ClaimOpen`: 0 · `ClaimAgain`: 1 · `Reclaim`:
1 · `TopUpPool`: 0).

**Vì sao đếm theo hash, không theo address.** Cùng script hash + khác stake credential = address khác
nhau nhưng **đều là UTxO của script**. Đếm theo full-address thì kẻ tấn công đặt hai UTxO khác stake
credential, thoả ràng buộc trên một cái và "ăn" cái kia.

**Vì sao ĐÍCH ĐẾN lại phải so full-address.** Hai câu trên không mâu thuẫn: phép **đếm** phải rộng
(bắt hết mọi UTxO của script), phép **ghim đích** phải chặt (không cho trường stake credential tự do).
Dùng lẫn hai phép là cách sinh ra đúng hai lớp lỗ ngược nhau.

Ca kiểm: `claim_two_pool_inputs`, `again_hai_account_input`, `poc_pool_nft_input_not_at_own_script`,
`claim_acct_out_stake_hijack`, `use_acct_out_stake_hijack`, `poc_reclaim_pool_stake_hijack`,
`reclaim_idle_pool_stake_hijack`, `poc_reclaim_pool_script_carrier`, `use_acct_out_script_carrier`,
`mintpool_script_carrier`.

---

## 9. Hình dạng asset name — phân vai giữa mint policy và pool

```
(N1) MintAccount: dict.size(own_tokens) == 1  ∧  qty == 1
(N2) MintAccount: take(name,4) == "ACCT"  ∧  length(name) == 32
(N3) MintAccount: đòi ≥ 1 POOL NFT input  ∧  qty(POOL) == 0
(N4) pool:        has_nft(acct_out, faucet_nft_policy, an(did_name))
(N5) pool:        count_outputs_with_nft(tx.outputs, faucet_nft_policy, an(did_name)) == 1
```

**Mệnh đề.** ACCT NFT được đúc trong một tx claim luôn có **hình dạng** hợp lệ và **tên khớp đúng
`did_name`** của account được tạo.

**Chứng minh.** (N2) cho hình dạng (tiền tố + 32 byte). (N4) cho tên khớp: `an` tính từ chính
`did_name` trong datum của account output, và `C-DID-1` buộc `did_name` đó có DID NFT tương ứng trong
input. (N3) cho tính uỷ quyền: không tx nào đúc ACCT NFT mà không có pool bị spend, tức pool validator
đã chạy và mọi ràng buộc trên đã áp. (N1) + (N5) cho tính duy nhất trong tx. ∎

**Phân vai, không kiểm trùng:** mint policy ép **hình dạng** (nó không biết `did_name` nào là hợp lệ —
biết được thì lại là một vòng phụ thuộc); pool ép **tên khớp DID** và toàn bộ dòng tiền. Ca
`mint_account_name_dung_32b` (dương), `mint_account_name_thieu_prefix`, `mint_account_name_31b`,
`mint_account_qty_2`, `mint_account_hai_name`, `mint_account_no_pool_input`,
`burn_account_happy` (dương), `burn_account_qty_minus_2`, `burn_account_qty_duong`.

---

## 10. Property còn THIẾU phép đo (gap → EXEC)

- **Người claim nhận đúng `d` ở nơi họ muốn dùng** — validator ép account output nhận đúng `d`, nhưng
  chuyện chủ DID **rút ra** rồi dùng ở đâu thì nằm ngoài luật (đúng thiết kế). Chỉ e2e trên mạng test
  đo được đường đi đầy đủ.
- **Chuỗi claim tới cạn** (`P → P−d → … < d`): logic suy ra từ §7.1 nhưng chưa có ca kiểm chạy nhiều
  claim liên tiếp trên một chuỗi pool duy nhất.
- **Chi phí thực thi trên tx THẬT.** Số ExUnit đo trên tx mock của bộ kiểm không phải số trên mạng: tx
  thật có thêm input phí, output trả lại, và witness. Phải đo lại sau lượt deploy đầu.
- **Ngưỡng `R = 1001` cửa sổ chưa từng bị vượt trong một phép đo nào** — với cửa sổ 5 ngày, đó là ≈
  13,7 năm. Nhánh `ReclaimIdle` vì thế chỉ được kiểm bằng ca dựng thời gian giả trong bộ kiểm, không
  bằng quan sát.

**Kỷ luật phát ngôn cho bảng ca kiểm ở các mục trên:** "chốt X **có ca đỏ**" và "chốt X **đã được
ghim**" là hai câu khác nhau. Câu thứ hai chỉ được phát sau khi **gỡ hẳn chốt X rồi chạy trọn bộ
kiểm** và thấy có ca đỏ — một ca đỏ đúng tên chốt không chứng minh nó ghim được chốt đó, vì ca có thể
trượt xuống chốt kế tiếp và chết ở đó với đúng màu, đúng tên.
