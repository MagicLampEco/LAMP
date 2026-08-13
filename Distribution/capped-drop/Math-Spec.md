# Capped Drop — SPEC MATH (chứng minh)

**Doctype:** MagicLamp Protocol — Onchain Spec (Math/Proofs)
**Version:** v2 "Capped Drop"
**Updated:** 2026-06-06
**Nguồn chuẩn (interface contract):** [`capped-drop/CONTRACT.md`](./CONTRACT.md)
**Hành vi:** [`capped-drop/Feat-Spec.md`](./Feat-Spec.md)

Chứng minh các bất biến của Capped Drop: vested **đơn điệu** + **bị chặn** (cap `E`); số
epoch để hết = `⌈E/D⌉`; **đa-claim cộng dồn** đúng; **entitlement bảo toàn** (bỏ lỡ epoch
không mất quyền). Mọi đại lượng là số nguyên không âm (oildrop), trừ khi nói khác.

---

## 1. Định nghĩa và giả thiết

Cho một `ClaimAccount` với hằng số:

- `E ∈ ℤ₊` — entitlement (cố định sau genesis).
- `D ∈ ℤ₊` — drop value, `D ≥ 1` (DropParam beacon).
- `r ∈ ℤ₊` — `drops_per_epoch`, MVP `r = 1`; `r ≥ 1` ở chế độ thường (`r = 0` chỉ ở hook pause, §5).
- `t0 ∈ ℤ` — start_epoch.
- `t ∈ ℤ`, `t ≥ t0` — epoch hiện tại (từ validity range).

Đặt `n(t) = max(0, t − t0)` (số epoch đã trôi từ `t0`, `n ∈ ℤ₊`). Định nghĩa:

```
raw(t)    = D · r · n(t)                    (1)
vested(t) = min( E , raw(t) )               (2)
```

Hàm redeem tại lần thứ `i` rút `aᵢ = vested(tᵢ) − redeemedᵢ` với `redeemed₀ = 0`,
`redeemedᵢ₊₁ = redeemedᵢ + aᵢ`, và yêu cầu validator `aᵢ > 0` (FEAT §3.3).

---

## 2. Định lý 1 — vested đơn điệu không giảm và bị chặn bởi `E`

**Phát biểu.** Với `t' ≥ t ≥ t0`: `vested(t) ≤ vested(t') ≤ E`. (F-VEST-2, F-VEST-3)

**Chứng minh.**

*(a) Bị chặn trên.* Theo (2), `vested(t) = min(E, raw(t)) ≤ E` với mọi `t`. ∎(cap)

*(b) Đơn điệu.* `n(t) = max(0, t−t0)` không giảm theo `t` (hàm `max(0, ·)` của một hàm tuyến
tính tăng). Vì `D·r ≥ 0`, `raw(t) = D·r·n(t)` không giảm theo `t`. Hàm `min(E, ·)` đơn điệu
không giảm theo đối số. Hợp thành hai hàm không giảm là không giảm, nên:

```
t' ≥ t  ⇒  raw(t') ≥ raw(t)  ⇒  min(E,raw(t')) ≥ min(E,raw(t))  ⇒  vested(t') ≥ vested(t).
```

Kết hợp (a): `vested(t) ≤ vested(t') ≤ E`. ∎

**Hệ quả (gradient ≥ 0).** Khi `r ≥ 1` và `raw(t) < E`: `vested(t+1) − vested(t) = D·r > 0`
(còn nhỏ giọt). Khi `raw(t) ≥ E`: `vested(t+1) − vested(t) = 0` (đã cap). Không bao giờ âm.

---

## 3. Định lý 2 — số epoch để vest hết = `⌈E/D⌉` (với `r = 1`)

**Phát biểu.** Với `r = 1`, gọi `T*` = số epoch nhỏ nhất kể từ `t0` để `vested = E`, tức
`T* = min { n ∈ ℤ₊ : D·n ≥ E }`. Khi đó `T* = ⌈E/D⌉`, và epoch đạt cap là `t = t0 + ⌈E/D⌉`.

**Chứng minh.** `vested = E ⟺ min(E, D·n) = E ⟺ D·n ≥ E ⟺ n ≥ E/D`. Vì `n` nguyên, số
nguyên nhỏ nhất thỏa `n ≥ E/D` là `⌈E/D⌉`. Vậy `T* = ⌈E/D⌉`. ∎

**Trường hợp riêng ví nhỏ (F-SMALL-1).** Nếu `E ≤ D` thì `⌈E/D⌉ = 1` (vì `0 < E/D ≤ 1`).
Tại `t = t0 + 1`: `vested = min(E, D·1) = E`. Rút trọn `E` ngay epoch đầu. ∎

**Lượng mở mỗi epoch (drip step).** Với `1 ≤ n ≤ ⌈E/D⌉`:

```
Δ(n) = vested(t0+n) − vested(t0+n−1) = min(E, D·n) − min(E, D·(n−1))
     = D                          nếu  D·n ≤ E         (chưa cap)
     = E − D·(n−1)  ( ≤ D )       nếu  n = ⌈E/D⌉       (epoch cap, phần dư)
     = 0                          nếu  n > ⌈E/D⌉       (đã hết)
```

Tổng `Σ_{n=1}^{⌈E/D⌉} Δ(n) = E` (telescoping: `vested(t0+⌈E/D⌉) − vested(t0) = E − 0 = E`).
Đây là bảng nhỏ giọt ví lớn trong FEAT §4.2 (`E=350, D=100`: 100+100+100+50 = 350). ∎

**Tổng quát `r ≥ 1`.** `vested = E ⟺ D·r·n ≥ E ⟺ n ≥ E/(D·r) ⟺ n ≥ ⌈E/(D·r)⌉`. Số epoch
giảm còn `⌈E/(D·r)⌉` — đúng ý hook multi-drop (FEAT §5.1): tăng `r` rút nhanh hơn nhưng tổng
vẫn cap `E`.

---

## 4. Định lý 3 — đa-claim cộng dồn đúng (tổng nhận = vested cuối ≤ E)

**Phát biểu.** Với dãy redeem tại các epoch `t0 ≤ τ₁ ≤ τ₂ ≤ … ≤ τ_m`, tổng nhận
`Σᵢ aᵢ = vested(τ_m) ≤ E`, độc lập số lần rút và thời điểm rút trung gian. (F-SUM-1)

**Chứng minh.** Theo quy tắc cập nhật `redeemedᵢ₊₁ = redeemedᵢ + aᵢ` và `aᵢ = vested(τᵢ) −
redeemedᵢ`:

```
redeemedᵢ₊₁ = redeemedᵢ + (vested(τᵢ) − redeemedᵢ) = vested(τᵢ).
```

Tức **sau mỗi lần redeem, `redeemed` được đặt đúng bằng `vested` tại epoch đó** (out datum
F-RDM-2: `redeemed' = redeemed + amount = vested(τᵢ)`). Bằng quy nạp, sau lần cuối `m`:

```
redeemed_cuối = vested(τ_m).
```

Tổng nhận `Σᵢ aᵢ = redeemed_cuối − redeemed₀ = vested(τ_m) − 0 = vested(τ_m)`. Theo Định lý 1,
`vested(τ_m) ≤ E`. ∎

**Tính hợp lệ từng bước (`aᵢ ≥ 0`).** `aᵢ = vested(τᵢ) − redeemedᵢ = vested(τᵢ) −
vested(τᵢ₋₁)` (vì `redeemedᵢ = vested(τᵢ₋₁)` theo trên). Do `τᵢ ≥ τᵢ₋₁` và Định lý 1,
`vested(τᵢ) ≥ vested(τᵢ₋₁)`, nên `aᵢ ≥ 0`. Validator ép thêm `aᵢ > 0` để loại tx rỗng
(redeem khi chưa có gì mới mở → reject). ∎

**Bất biến luôn đúng giữa các lần:** `0 ≤ redeemed ≤ vested(t) ≤ E`. (đặt làn ranh để test
mock-tx kiểm tra mọi state).

**Độc lập lộ trình (path-independence).** Tổng `vested(τ_m)` chỉ phụ thuộc `τ_m` (epoch lần
rút cuối), KHÔNG phụ thuộc số lần rút hay các `τᵢ` trung gian. Rút mỗi epoch một lần, hay dồn
tất cả vào một lần ở `τ_m`, đều cho cùng tổng. Đây là cơ sở "đa-claim tự do" FEAT §4.3. ∎

---

## 5. Định lý 4 — entitlement bảo toàn; hook pause không phá đơn điệu

### 5.1 Bỏ lỡ epoch không mất quyền
**Phát biểu.** Nếu user không redeem ở các epoch `τ ∈ (t0, t)`, phần vested của các epoch đó
**không mất**: tại epoch `t`, redeemable `= vested(t) − redeemed` vẫn tính trọn từ `t0`.

**Chứng minh.** `vested(t)` chỉ phụ thuộc `t` (qua `n(t) = max(0,t−t0)`), KHÔNG phụ thuộc lịch
sử có redeem hay không ở epoch trung gian. Không redeem ⇒ `redeemed` đứng yên ⇒ redeemable
`= vested(t) − redeemed` chỉ tăng theo `t` (Định lý 1). Quyền tích lũy đầy đủ, không "dùng
hoặc mất". Đây chính là điểm vá lỗ hổng "proof hết hạn" của Lottery (FEAT §0). ∎

### 5.2 Hook pause (`r = 0` trong vài epoch) giữ đơn điệu
**Phát biểu.** Cho `r(τ) ≥ 0` thay đổi theo epoch (DAO chỉnh, FEAT §5.2), tổng-tích `raw(t)
= D · Σ_{τ=t0}^{t−1} r(τ)` (mở khoá `D·r(τ)` mỗi epoch). Khi đó `vested(t) = min(E, raw(t))`
vẫn đơn điệu không giảm và cap `E`.

**Chứng minh.** `Σ_{τ=t0}^{t−1} r(τ)` là tổng dồn các số hạng `r(τ) ≥ 0`, nên không giảm theo
`t` (thêm số hạng ≥ 0). Suy ra `raw(t)` không giảm. Lập lại lý luận Định lý 1 (min của hàm
không giảm với hằng `E`) ⇒ `vested` không giảm và `≤ E`. Riêng các epoch pause (`r(τ)=0`):
số hạng thêm = 0 ⇒ `vested(t+1) = vested(t)` (đứng yên, không lùi). ∎

**Hệ quả an toàn hook.** Pause chỉ làm gradient = 0 tạm thời, không bao giờ âm ⇒ không tịch
thu phần đã vested, không phá bất biến `redeemed ≤ vested ≤ E`. Multi-drop (`r > 1`) chỉ tăng
gradient, rút nhanh hơn, vẫn cap `E`. Cả 2 hook DAO an toàn về toán.

> MVP `r ≡ 1` là trường hợp riêng của 5.2 với `r(τ) = 1 ∀τ`, cho `raw(t) = D·(t−t0)` đúng (1).

---

## 6. Bảng bất biến (đối chiếu test)

| ID | Phát biểu toán | Định lý |
|---|---|---|
| **M-MONO** | `t' ≥ t ⇒ vested(t') ≥ vested(t)` | §2 |
| **M-CAP** | `vested(t) ≤ E ∀t` | §2(a) |
| **M-EPOCHS** | hết sau `⌈E/(D·r)⌉` epoch; `r=1 ⇒ ⌈E/D⌉` | §3 |
| **M-SMALL** | `E ≤ D ⇒ vested(t0+1) = E` | §3 |
| **M-SUM** | `Σ aᵢ = vested(τ_m) ≤ E`, path-independent | §4 |
| **M-STEP** | `aᵢ = vested(τᵢ) − vested(τᵢ₋₁) ≥ 0`; ép `> 0` | §4 |
| **M-INV** | `0 ≤ redeemed ≤ vested(t) ≤ E` mọi state | §4 |
| **M-KEEP** | bỏ lỡ epoch không mất quyền (vested ⊥ lịch sử redeem) | §5.1 |
| **M-PAUSE** | hook `r(τ)≥0` giữ đơn điệu + cap | §5.2 |

Các ID này map 1-1 sang Aiken mock-tx test + vitest (M-MONO/M-CAP/M-SUM/M-SMALL bắt buộc).
Bảo toàn value treasury (`tre_out = tre_in − Σ aᵢ`, không burn) là bất biến on-chain riêng,
chứng minh ở CONTRACT §4/§7 và test C1/C2/M1 (không thuộc phạm vi math thuần này).
