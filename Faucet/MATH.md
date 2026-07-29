# tLAMP + Faucet — MATH (Cơ sở toán)

**Trạng thái:** draft 2026-06-09. Bám **[CONTRACT.md](./CONTRACT.md)** (xương sống) — tài liệu này
KHÔNG mâu thuẫn nó; nó **chứng minh hình thức** các bất biến mà CONTRACT phát biểu, và mỗi định lý
truy được về **dòng code thật** ([`tlamp_policy.ak`](./onchain/validators/tlamp_policy.ak),
[`faucet.ak`](./onchain/validators/faucet.ak)).

> Mọi số nguyên là **BigInt thuần** (không float). Đơn vị nhỏ nhất = **oil**, `1 LAMP = 10^6 oil`
> (decimals 6, khớp `Distribution/constants` — [CONTRACT §0](./CONTRACT.md),
> [`constants.ts:4`](./offchain/src/constants.ts)).

---

## 0. Ký hiệu

| Ký hiệu | Nghĩa |
|---|---|
| `T` | tổng cung tLAMP (oil) = `36_000_000_000 × 10^6 = 36_000_000_000_000_000` = `3.6e16` |
| `c` | `claim_amount` (oil) — lượng nhả mỗi claim; MVP = `100 × 10^6 = 1e8` |
| `p` | policy id tLAMP; `n` = asset name = `#"744c414d50"` |
| `V` | hàm value: `V(tx, p, n)` = số lượng asset `(p,n)` trong value |
| `g` | `genesis_ref : OutputReference` (param one-shot) |
| `qty(v,p,n)` | `assets.quantity_of(v, p, n)` |
| `mint` | `tx.mint` (Value, có thể âm = burn) |

Quy ước value: `assets.add(v, p, n, q)` = `v` với entry `(p,n)` cộng thêm `q`; nếu kết quả = 0 thì
entry **biến mất** (đây là tính chất của `Value` stdlib, dùng ở chứng minh §2.3 và §4).

---

## 1. Bất biến tổng — phát biểu

Module có **2 bất biến nền** (CONTRACT §1):

- **(I-SUPPLY) Fixed-supply trung thực:** tổng tLAMP tồn tại = `T`, **bất biến** sau bước mint
  ban đầu; KHÔNG bao giờ tăng (re-mint) hay giảm (burn).
- **(I-CONSERVE) Bảo toàn value tuyệt đối khi claim:** mỗi claim chỉ **di chuyển** tLAMP từ pool
  sang dev, `Σ_out = Σ_in` cho **mọi** asset.

Hai bất biến này độc lập với chuẩn metadata (native FT, không CIP-68 — [CONTRACT §2](./CONTRACT.md)).
Phần dưới chứng minh chúng từ luật validator.

---

## 2. tLAMP policy — định lý one-shot + đúng tổng cung

Validator mint chạy đúng các vị từ ([`tlamp_policy.ak:43-55`](./onchain/validators/tlamp_policy.ak)):

```
(M1) list.any(tx.inputs, λi. i.output_reference == g)          -- consume genesis
(M2) dict.size(assets.tokens(mint, p)) == 1                     -- đúng 1 asset name
(M3) qty(mint, p, n) == T                                       -- đúng tổng cung
else → fail                                                     -- mọi mint khác
```

### 2.1 Định lý ONE-SHOT (policy chạy tối đa 1 lần trong lịch sử chain)

**Mệnh đề.** Với `g` cố định, **không tồn tại 2 transaction hợp lệ phân biệt** `tx₁ ≠ tx₂` mà cả
hai cùng mint dưới policy `p` thành công.

**Chứng minh.** Giả sử cả `tx₁`, `tx₂` mint thành công. Theo (M1), mỗi tx phải có một input với
`output_reference == g`. Trong sổ cái eUTXO, **một `OutputReference` chỉ bị consume tối đa 1 lần**
(luật no-double-spend của ledger Cardano — một UTxO đã chi không còn trong UTxO set). Vậy không thể
có 2 tx riêng biệt cùng consume `g`. ⇒ `tx₁ = tx₂`. ∎

**Hệ quả (I-SUPPLY, nửa "không re-mint").** Sau tx mint đầu tiên, `g` đã bị tiêu → mọi mint sau
fail tại (M1). Tổng tLAMP **không bao giờ tăng** quá `T`.

> Đây là bất biến mạnh nhất đạt được **không cần state on-chain** — anchor vào tính no-double-spend
> của ledger ([`tlamp_policy.ak:7-11`](./onchain/validators/tlamp_policy.ak)). Test bằng chứng:
> `mint_without_genesis`, `rt_mint_genesis_wrong_index` (off-by-one output_index cũng fail vì
> `OutputReference` so cả 2 field).

### 2.2 Định lý ĐÚNG TỔNG CUNG (mint đúng `T`, không thừa/thiếu/âm)

**Mệnh đề.** Tx mint hợp lệ ⇒ `qty(mint, p, n) = T` **và** policy `p` không mint asset name nào
khác `n`.

**Chứng minh.** (M3) cho trực tiếp `qty(mint,p,n) = T`. (M2) cho `dict.size(tokens(mint,p)) = 1`:
chỉ đúng **1** entry asset name dưới policy `p`. Kết hợp với (M3) (entry đó là `n` với lượng `T ≠ 0`,
nên nó **tồn tại** trong dict), suy ra entry duy nhất chính là `(n, T)`. Vậy không asset name lạ nào
cùng policy được mint. ∎

**Các góc cạnh đã đóng (red-team):**

- **Mint `n` đúng `T` + name lạ qty âm** (giả "burn" để né dict.size): `assets.add(..., name', -1)`
  vẫn **tạo entry** `(name', -1)` → `dict.size = 2 ≠ 1` → fail (M2). Test `rt_mint_lamp_plus_negative_other`.
- **Mint `n` qty = 0:** `assets.add(p, n, 0)` **không tạo entry** → `tokens(mint,p)` rỗng →
  `dict.size = 0 ≠ 1` → fail (M2). Test `rt_mint_zero_qty`.
- **Mint chỉ name lạ qty = `T`** (mạo danh): `dict.size = 1` qua (M2) NHƯNG `qty(mint,p,n) = 0 ≠ T`
  → fail (M3). Test `rt_mint_only_fake_name`.

### 2.3 Định lý KHÔNG BURN

**Mệnh đề.** Không tồn tại tx hợp lệ với `qty(mint, p, n) < 0`.

**Chứng minh.** (M3) đòi `qty(mint,p,n) = T > 0`. Một giá trị âm vi phạm (M3) → fail. Mọi nhánh mint
khác (purpose ≠ mint, hay mint không qua các vị từ trên) rơi vào `else → fail`
([`:58`](./onchain/validators/tlamp_policy.ak)). ∎ Test `mint_negative_burn`.

> **Liên hệ định hướng dài hạn:** LAMP mainnet fixed-supply 36 tỷ BẤT BIẾN, KHÔNG bao giờ burn.
> tLAMP phản chiếu đúng tính chất đó — mọi cửa thay đổi tổng cung bị đóng sau mint
> ([CONTRACT §1](./CONTRACT.md)).

---

## 3. Faucet — định lý bảo toàn value khi claim

Validator spend chạy đúng các vị từ ([`faucet.ak:41-69`](./onchain/validators/faucet.ak)), với
`pool_in`, `pool_out` là input/output **duy nhất** tại script hash:

```
(F0) assets.is_zero(tx.mint)                                                -- không mint
(F+) datum.claim_amount > 0                                                 -- claim hợp lệ
(F1) count_inputs_at_script == 1  ∧  count_outputs_at_script == 1           -- 1 pool in/out
(F2) pool_out.claim_amount == pool_in.claim_amount                          -- datum giữ
(F3) pool_out.value == assets.add(pool_in.value, p, n, -c)                  -- value-eq
```

### 3.1 Định lý VALUE-EQ (đẳng thức bao trùm mọi gian lận)

**Mệnh đề.** Với claim hợp lệ: với **mọi** asset `(p',n')`,

```
V(pool_out, p',n') = V(pool_in, p',n') − c·[ (p',n') = (p,n) ]
```

(nghĩa là: tLAMP `(p,n)` giảm đúng `c`; **mọi asset khác bất biến**).

**Chứng minh.** (F3) là đẳng thức `Value`: `pool_out.value = pool_in.value + add(p,n,−c)`. Hàm
`assets.add(v,p,n,−c)` thay đổi **duy nhất** entry `(p,n)` (trừ `c`), giữ nguyên mọi entry khác.
Vì `Value` so sánh per-entry, đẳng thức ⇒ với `(p',n') ≠ (p,n)` thì `V(pool_out)=V(pool_in)`, và
với `(p,n)` thì `V(pool_out)=V(pool_in)−c`. ∎

**Hệ quả 1 — không drain ADA/asset khác.** Đặt `(p',n') = (lovelace)` hay bất kỳ dust: value bảo
toàn ⇒ dev **không rút** ADA hay asset phụ của pool. Test `claim_drain_ada`, `claim_steal_other_asset`,
`rt_steal_dust`. Ngược lại pool **được phép ôm** asset phụ hợp lệ (test `rt_happy_with_dust`).

**Hệ quả 2 — nhả đúng `c`, không hơn không kém.** `V(pool_out,p,n) = V(pool_in,p,n) − c`. Nhả `>c`
⇒ pool_out thiếu → lệch → fail (`claim_too_much`). Nhả `<c` ⇒ pool_out thừa → lệch → fail
(`claim_too_little`).

### 3.2 Định lý CONSERVE (Σ tLAMP bất biến mỗi claim)

**Mệnh đề.** `V(pool_out,p,n) + (dev nhận) = V(pool_in,p,n)`.

**Chứng minh.** Theo §3.1, pool_out chứa `V(pool_in,p,n) − c` tLAMP. Theo luật bảo toàn value
**toàn tx** của ledger Cardano (`Σ inputs + mint = Σ outputs`), và (F0) `mint = 0`, phần `c` tLAMP
"thiếu" ở pool_out phải xuất hiện ở output khác — chính là output dev
([`claimBuilder.ts:95`](./offchain/src/claimBuilder.ts) trả đúng `c`). ∎ Test
`claim_happy` (onchain), `builders.test.ts:148` (`pool_out + claimer == pool_in`).

> **Lưu ý ranh giới:** validator KHÔNG đọc output dev (nó chỉ ép pool_in→pool_out). Việc dev nhận
> đúng `c` được bảo đảm **bằng tổ hợp**: pool mất đúng `c` (F3) + `mint=0` (F0) + bảo toàn value
> ledger ⇒ `c` tLAMP đi đâu đó ngoài pool. Builder offchain đặt nó vào ví dev; nếu builder lỗi đặt
> nơi khác, dev không nhận — nhưng **không ai drain được** (đó là tính chất an toàn validator cần
> bảo đảm). Đây là lựa chọn tối ưu eUTXO: không bắt validator quét toàn outputs.

### 3.3 Định lý KHÔNG MINT khi claim

**Mệnh đề.** Claim hợp lệ ⇒ `tx.mint = 0` (không tạo/đốt token nào, kể cả policy khác).

**Chứng minh.** (F0) `assets.is_zero(tx.mint)` đòi value mint rỗng tuyệt đối. Mint thêm tLAMP
(`claim_mint_rejected`) hay NFT rác policy khác (`rt_mint_other_policy`) đều làm `tx.mint ≠ 0` →
fail. ∎ Kết hợp với §2 (one-shot), tổng cung tLAMP **không đường nào** tăng sau deploy.

### 3.4 Định lý DATUM-PRESERVE (chống drain trễ)

**Mệnh đề.** `pool_out.claim_amount = pool_in.claim_amount`, và pool_out **có** inline datum hợp lệ.

**Chứng minh.** `expect InlineDatum(od) = pool_out.datum` ([`faucet.ak:55`](./onchain/validators/faucet.ak))
fail nếu pool_out không có inline datum (test `rt_pool_out_no_datum`). `expect out_datum.claim_amount
== datum.claim_amount` (F2) ép giá trị giữ nguyên (test `claim_datum_tamper`: đổi 100→1000 fail). ∎

**Ý nghĩa:** không kẻ nào nâng `claim_amount` ở pool mới để **claim sau** rút nhiều hơn. `claim_amount`
là hằng số đời pool.

### 3.5 Định lý POSITIVITY (chống `claim_amount ≤ 0` bơm pool)

**Mệnh đề.** Claim hợp lệ ⇒ `c > 0`.

**Chứng minh.** (F+) `expect datum.claim_amount > 0` đứng **trước** (F3)
([`faucet.ak:45`](./onchain/validators/faucet.ak)). Nếu `c ≤ 0`:
- `c = 0`: (F+) fail (test `claim_zero_amount_datum`).
- `c < 0`: (F+) fail (test `rt_negative_claim_amount`). Quan trọng — nếu không có (F+), một `c < 0`
  biến `add(p,n,−c) = add(p,n,+|c|)` thành **bơm token vào pool** (claim ngược). (F+) đóng cửa này
  **trước** khi value-eq dùng `−c`. ∎

Bổ trợ: ngay cả khi `c > 0`, mưu "bơm ngược" bằng cách đặt pool_out **nhiều** tLAMP hơn pool_in vẫn
fail value-eq (`rt_negative_effective_claim`).

---

## 4. Định lý CHỐNG DOUBLE-SATISFACTION

Đếm theo **payment script hash**, không full-address ([`util.ak:29-35`](./onchain/lib/magiclamp/faucet/util.ak)).

**Mệnh đề.** Claim hợp lệ ⇒ **đúng 1** input và **đúng 1** output mang payment credential `Script(own_hash)`.

**Chứng minh.** (F1) `count_inputs_at_script == 1 ∧ count_outputs_at_script == 1` với
`count_*_at_script` đếm UTxO có `payment_credential == Script(own_hash)` **bất kể stake credential**.
∎

**Vì sao theo hash, không theo address.** Cùng script hash + **khác** stake credential = address
khác nhau nhưng **đều là UTxO của script**. Nếu đếm theo full-address, kẻ tấn công đặt 2 pool UTxO
khác stake cred, thỏa value-eq trên 1 cái, "ăn" cái kia
([`util.ak:1-3,53-59`](./onchain/lib/magiclamp/faucet/util.ak)). Đếm theo hash đóng cửa này.

**Hai biến thể đã đóng:**

- **2 pool INPUT** (1 output trả): `count_inputs == 2` → fail (test `claim_double_satisfaction`).
  Nếu không có guard này, value-eq chỉ ràng buộc 1 cặp in/out, pool thứ 2 bị drain toàn bộ.
- **2 pool OUTPUT** (1 input, chẻ pool né value-eq): `count_outputs == 2` → fail (test
  `rt_two_pool_outputs`). Chẻ pool ra 2 output để mỗi cái lách đẳng thức cũng bị đếm bắt.

**Bổ trợ — own_ref phải là script.** `own_script_hash` ép `expect Script(h) = own_addr.payment_credential`
([`util.ak:17-20`](./onchain/lib/magiclamp/faucet/util.ak)); nếu `own_ref` trỏ UTxO ví thường thì fail
(test `rt_own_ref_not_script`). Chống spoof own_ref sang non-script.

---

## 5. Bảng truy vết property ↔ test (đã có, đã pass)

27 test Aiken, **toàn bộ pass** (`aiken check`, exit 0 — xem [EXEC](./EXEC.md)).

| # | Property (định lý) | Onchain test |
|---|---|---|
| 1 | one-shot — consume genesis | `mint_without_genesis`, `rt_mint_genesis_wrong_index` |
| 2 | đúng tổng cung `T` | `mint_full_supply_happy`, `mint_wrong_quantity_less/more` |
| 3 | dict.size == 1 (no extra name) | `mint_extra_asset_name`, `rt_mint_lamp_plus_negative_other`, `rt_mint_zero_qty` |
| 4 | no fake mint | `rt_mint_only_fake_name` |
| 5 | no-burn | `mint_negative_burn` |
| 6 | value-eq happy | `claim_happy`, `rt_happy_with_dust` |
| 7 | nhả đúng `c` | `claim_too_much`, `claim_too_little` |
| 8 | no drain ADA/asset | `claim_drain_ada`, `claim_steal_other_asset`, `rt_steal_dust` |
| 9 | no negative effective claim | `rt_negative_effective_claim` |
| 10 | no mint khi claim | `claim_mint_rejected`, `rt_mint_other_policy` |
| 11 | datum preserve + có datum | `claim_datum_tamper`, `rt_pool_out_no_datum` |
| 12 | positivity `c > 0` | `claim_zero_amount_datum`, `rt_negative_claim_amount` |
| 13 | anti double-sat (in) | `claim_double_satisfaction` |
| 14 | anti double-sat (out) | `rt_two_pool_outputs` |
| 15 | own_ref là script | `rt_own_ref_not_script` |

---

## 6. Property còn THIẾU test (gap → EXEC)

- **CONSERVE end-to-end onchain** (`dev nhận đúng c`): hiện chỉ test ở builder offchain
  (`builders.test.ts:148`). Validator KHÔNG kiểm output dev (cố ý, §3.2). Property đầy đủ chỉ
  verify được ở **e2e Preview** (claim thật → đọc UTxO ví dev). Ghi ở [EXEC](./EXEC.md).
- **claim lặp tới cạn** (monotonic giảm `P → P−c → … → 0`): logic đúng theo §3.1 nhưng chưa có
  test chuỗi nhiều claim liên tiếp onchain. MVP chấp nhận; e2e Preview phủ.
