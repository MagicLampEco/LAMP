# Capped Drop — SPEC MATH (chứng minh)

**Doctype:** MagicLamp Protocol — Onchain Spec (Math/Proofs)
**Version:** v3 "Capped Drop" — chỉ số cộng dồn + trần lõm + cắt ngọn
**Updated:** 2026-09-22
**Nguồn chuẩn (interface contract):** [`capped-drop/CONTRACT.md`](./CONTRACT.md) v3
**Hành vi:** [`capped-drop/Feat-Spec.md`](./Feat-Spec.md)

> **Vì sao bump v2 → v3.** v2 chứng minh `vested` đơn điệu **với `D` cố định**. Giả thiết đó
> không đúng trong hệ đang chạy: `D` là tham số beacon và nó đổi được **hai chiều**. Bỏ giả thiết
> ấy ra, mọi định lý của v2 vẫn đúng như đã viết nhưng **không còn nói gì về hệ thật** — và
> khoảng trống đó là một lỗ đang sống, không phải một khiếm khuyết trình bày (CONTRACT v3 §0).
> v3 chứng minh đơn điệu **không cần giả thiết tham số cố định**, và tách ra điều kiện chính xác
> để một thừa số mới được phép thêm vào công thức.

Mọi đại lượng là số nguyên không âm (oildrop) trừ khi nói khác. `⌊·⌋` là chia nguyên của máy.

---

## 1. Định nghĩa

**Chỉ số cộng dồn toàn cục.** Beacon giữ bộ ba `(epoch_k, index_k, w_k)` ở lượt post thứ `k`,
với `w_k ∈ ℤ₊` là **gốc tốc độ** (rate root). Luật nối hai lượt (C-BCN-6):

```
index_{k+1} = index_k + w_k · (epoch_{k+1} − epoch_k)                       (1)
```

Đọc được tại một cửa sổ `t` bất kỳ, **không cần ai post gì**:

```
A(t) = index_k + w_k · (t − epoch_k),   với k là lượt post gần nhất có epoch_k ≤ t        (2)
```

**Tài khoản.** `E ∈ ℤ₊` entitlement; `a₀ = A(t_open)` chụp lúc mở (`index_at_start`);
`r = drops_per_epoch`, **ghim `r = 1`** ở v3 (C-ACC-DPE, CONTRACT §1b) — giữ ký hiệu để các định
lý dưới đây vẫn phát biểu được cho `r` tổng quát, vì đúng cái tổng quát ấy chỉ ra vì sao phải ghim.

```
S(t)      = A(t) − a₀                    (span; §2 chứng minh S ≥ 0 và không giảm)        (3)
vested(t) = min( E , r · ⌊√E⌋ · S(t) )                                                    (4)
```

**Validator KHÔNG tính (4).** Nó kẹp con số người dựng tx xin (CONTRACT §4 mục 2):

```
(redeemed + amount)²  ≤  r² · E · S(t)²        ∧        redeemed + amount ≤ E             (5)
```

§6 chứng minh (5) tương đương (4) trên số nguyên, nên không có `√` nào phải tính on-chain.

**Cắt ngọn.** Với `C = total_redeemed` (sổ kho), `κ = trim_num/trim_den`, `F = trim_floor`:

```
amount ≤ max( F , ⌊C · κ · g⌋ ),     g ∈ [g_min, 1],  g_min > 0                           (6)
```

---

## 2. Định lý 1 — `A` đơn điệu không giảm, và (2) nhất quán với (1)

**Phát biểu.** Với `t' ≥ t`: `A(t') ≥ A(t)`. Và giá trị (2) đọc tại `t = epoch_{k+1}` bằng đúng
`index_{k+1}` mà (1) ghi — tức chỉ số **không nhảy** tại mốc post.

**Chứng minh.**

*(a) Nhất quán tại mốc.* Đặt `t = epoch_{k+1}` trong (2) với lượt gần nhất là `k`:
`A = index_k + w_k·(epoch_{k+1} − epoch_k)`, đúng vế phải của (1). ∎

*(b) Đơn điệu trong một khoảng.* Trên `[epoch_k, epoch_{k+1})`, (2) là hàm afin của `t` với hệ số
góc `w_k ≥ 0` (biên cứng ép `w_k ≥ rate_root_min > 0`), nên không giảm.

*(c) Đơn điệu qua mốc.* Theo (a) hàm liên tục tại mốc, và mỗi khoảng không giảm. Hợp lại, `A`
không giảm trên toàn miền. ∎

**Hệ quả 1.1 (không phụ thuộc liveness).** Nếu không có lượt post nào sau `k`, (2) vẫn xác định
với mọi `t > epoch_k` và vẫn tăng với nhịp `w_k`. Committee im lặng **không** làm `A` dừng.

**Hệ quả 1.2 (quá khứ bất khả xâm phạm).** Với `t ≤ epoch_{k+1}`, giá trị `A(t)` chỉ phụ thuộc
`(epoch_j, w_j)` với `j ≤ k`. Một lượt post mới **không** đổi được `A` tại bất kỳ điểm quá khứ
nào, vì (1) ép `index_{k+1}` bằng một biểu thức chỉ chứa dữ liệu đã có trước đó. ∎

---

## 3. Định lý 2 (TRUNG TÂM) — `vested` không bao giờ giảm

**Phát biểu.** Với `t' ≥ t ≥ t_open`: `vested(t) ≤ vested(t') ≤ E`.

**Chứng minh.** `S(t) = A(t) − a₀` với `a₀` **hằng số của tài khoản** (CONTRACT §4 mục 3 ép
`index_at_start` bất biến). Theo Định lý 1, `A` không giảm ⟹ `S` không giảm; và `S(t_open) = 0`
⟹ `S ≥ 0`. Trong (4), `r` bất biến (C-ACC-DPE) và `E` **chỉ tăng** (`GrantEntitlement` ép
`granted > 0`). Vậy `r·⌊√E⌋·S(t)` là tích của ba thừa số không âm, mỗi thừa số không giảm theo
`t` ⟹ tích không giảm. `min(E, ·)` đơn điệu không giảm theo cả hai đối số, và `E` không giảm,
nên `vested` không giảm. Chặn trên `≤ E` hiển nhiên từ `min`. ∎

**Ba chân của chứng minh, và điều gì gãy nếu mất một chân:**

| chân | ép ở đâu | mất thì sao |
|---|---|---|
| `A` không giảm | Định lý 1 + `w ≥ rate_root_min` | `vested` tụt dưới `redeemed`, `expect amount > 0` khoá tài khoản |
| `a₀` bất biến | CONTRACT §4 mục 3 | người rút tự đặt lại gốc thời gian của mình |
| `E` không giảm | `granted > 0` | hạ `E` cho tài khoản đã rút gần hết ⟹ khoá phần còn lại |

---

## 4. Định lý 3 — TRONG tổng hay NGOÀI tổng: điều kiện chính xác để thêm một thừa số

Đây là định lý dùng làm **luật thiết kế**, không phải một nhận xét.

**Phát biểu.** Cho một thừa số `φ` có thể **giảm** theo thời gian. Xét hai cách đặt:

```
(I)  TRONG tổng:  vested(t) = min(E, c · Σ_{i<t} φ_i )        (φ_i chốt tại cửa sổ i)
(II) NGOÀI tổng:  vested(t) = min(E, c · φ(t) · Σ_{i<t} 1 )
```

(I) giữ `vested` không giảm **với mọi quỹ đạo của `φ`**. (II) thì **không** — và lượng tụt tỉ lệ
với toàn bộ lịch sử: hạ `φ` từ `φ₀` xuống `λφ₀` (`λ < 1`) đưa `vested` về `λ` lần giá trị cũ, tức
mất `(1−λ)` phần của **mọi** cửa sổ đã qua.

**Chứng minh.** (I): tổng dồn các số hạng `φ_i ≥ 0` không giảm khi thêm số hạng, bất kể giá trị
số hạng mới; `min(E, ·)` bảo toàn tính không giảm. (II): tại `t` cố định, `vested` là hàm tăng
của `φ(t)`; `φ` giảm ⟹ `vested` giảm. ∎

**Phản ví dụ cụ thể, tái lập được lỗ đang sống.** (II) với `φ = D`, `c = r`, `Σ 1 = t`: sau `t`
cửa sổ `redeemed = D₀·r·t`. Một lượt hạ `D₁ = 0,9·D₀` cho `vested = 0,9·D₀·r·(t+1)`. Điều kiện
còn rút được là `0,9(t+1) > t ⟺ t < 9`. **Mọi tài khoản đã chạy ≥ 9 cửa sổ bị khoá bởi MỘT lượt
post**, và `redeemed ≤ vested ≤ E` vẫn đúng suốt nên không bất biến nào báo. ∎

**Luật suy ra (CONTRACT §7).** Trước khi thêm bất kỳ thừa số nào vào công thức rút, trả lời:
*"nó giảm được không, và nó ở kênh nào?"*

| | trong tổng (kênh **tốc độ tích luỹ**) | ngoài tổng, nhưng chỉ chặn MỘT LƯỢT (kênh **cắt ngọn**) |
|---|---|---|
| thừa số chỉ tăng | an toàn | an toàn |
| thừa số giảm được | **CẤM** | an toàn — §5 |

Ba tham số của v3 xếp đúng theo bảng: `w` ở kênh tốc độ ⟹ **chỉ được nới**. `κ` và `g` ở kênh
cắt ngọn ⟹ **giảm thoải mái**. `r` nằm **ngoài** tổng và **không** chỉ chặn một lượt ⟹ nó rơi vào
ô CẤM, và đó là chứng minh cho việc ghim `r ≡ 1` thay vì để nó thành một tham số điều hành.

---

## 5. Định lý 4 — cắt ngọn chỉ HOÃN, không bao giờ làm mất

**Phát biểu.** Với `F > 0` và `C` không giảm, dãy redeem dưới ràng buộc (6) đạt `redeemed = E`
sau hữu hạn lượt, và tổng nhận vẫn bằng `vested` tại lượt cuối.

**Chứng minh.** (6) chặn **`amount` của một lượt**, không chặn `vested`. Theo Định lý 3, `vested`
không giảm; theo (6), mỗi lượt rút được ít nhất `min(F, vested − redeemed) > 0` khi còn phần chưa
rút. Vậy `redeemed` tăng ít nhất `min(F, ·)` mỗi lượt ⟹ sau nhiều nhất `⌈E/F⌉` lượt thì
`redeemed = E`. ∎

**Hệ quả 4.1 (vì sao `F > 0` là BẮT BUỘC).** Nếu `F = 0` thì tại `C = 0` ràng buộc (6) cho
`amount ≤ 0`, mâu thuẫn `amount > 0` ⟹ không ai rút được ⟹ `C` đứng yên ở 0 mãi mãi. `C = 0` là
**điểm hấp thụ** của hệ. `F > 0` phá nó. ∎

**Hệ quả 4.2 (giá của cắt ngọn là SỐ LƯỢT).** Số lượt cần tăng khi `κ` giảm; mỗi lượt là một
giao dịch tiêu UTxO kho, mà kho là singleton ⟹ **toàn hệ tối đa một `Redeem` mỗi block**. Cắt
ngọn không làm mất LAMP, nó chuyển chi phí sang **thông lượng**. Đại lượng phải đo trước mainnet:
số lượt `Redeem` cần mỗi cửa sổ ở tải dự kiến, so với số block mỗi cửa sổ. **CHƯA ĐO.**

---

## 6. Định lý 5 — phép kẹp bình phương (5) tương đương (4), không cần `√`

**Phát biểu.** Với số nguyên không âm và `x = redeemed + amount`:

```
x ≤ r · √E · S      ⟺      x² ≤ r² · E · S²
```

**Chứng minh.** Cả hai vế không âm; `y ↦ y²` đơn điệu tăng nghiêm ngặt trên `ℤ₊`, nên bảo toàn cả
`≤` lẫn chiều ngược. ∎

**Chú ý — (5) dùng `√E` THẬT, (4) dùng `⌊√E⌋`.** (5) chặt hơn hoặc bằng (4), chênh dưới một đơn vị
của `x`. Đây là chiều an toàn, và nó **không** tạo đuôi bụi, vì ràng buộc chạm `E` là ràng buộc
thứ hai `x ≤ E` — xem §7.

**Biên bit (đo, không ước lượng).** Với `E = 6×10⁹ LAMP = 6×10¹⁵ oildrop`, `w = 77.460`,
`S = w·1000 = 7,746×10⁷`, `r = 1`:

| vế | bit |
|---|---|
| `x²` | **105** |
| `r²·E·S²` | **105** |

Nếu `r` được để tự do tới 100 thì vế phải lên **119 bit**. Plutus dùng số nguyên độ chính xác tuỳ
ý nên không vế nào tràn; con số này để định cỡ ExUnits, không phải để lo tràn.

---

## 7. Định lý 6 (HIỆU CHỈNH) — `w` là nguyên thuỷ, `W` là suy ra. Chênh MỘT đơn vị quyết định tài khoản có bao giờ xong không

Đặt `W := w²`. Khi đó `r·√E·S = r·√E·w·n` sau `n` cửa sổ, và điều kiện đạt `E`:

```
√E · w · n ≥ E   ⟺   n ≥ √E / w   ⟺   n* = ⌈√E / w⌉                                      (7)
```

**Vì sao KHÔNG được định nghĩa ngược lại** (chọn `W` trước rồi lấy `w = ⌊√W⌋`): phép cắt làm `w`
nhỏ hơn `√W` một chút, và sai số ấy **cộng dồn mỗi cửa sổ**, nên vế phải của (5) đứng mãi dưới
`E²`. Tài khoản tiệm cận `E` mà **không bao giờ chạm**; `expect amount > 0` khiến phần đuôi không
rút nổi — một khoản khoá vốn vĩnh viễn, có hệ thống, và **không bài kiểm ngắn nào thấy**.

Đo tại mốc hiệu chỉnh thứ nhất, `E = 6×10⁹ LAMP`, mục tiêu `n* = 1000`:

| `w` | `x²_max / E²` sau 1000 cửa sổ | chạm `E`? |
|---|---|---|
| `⌊√(6000·10⁶)⌋ = 77.459` | 0,9999828 | **KHÔNG BAO GIỜ** |
| `⌈√(6000·10⁶)⌉ = 77.460` | 1,0000086 | **có, đúng cửa sổ 1000** |

**Chọn `w = 77.460`**, suy ra `W = w² = 6.000.051.600 oildrop = 6.000,0516 LAMP`.

**Kiểm chéo mốc thứ hai** (không tham gia việc chọn `w`, nên nó là một phép đo độc lập): với cùng
`w = 77.460` và `E = 2.379.930 LAMP` (ETD-max), (7) cho `√E/w = 19,916` ⟹ `n* = 20`, đúng mốc
hiệu chỉnh thứ hai.

**Số mũ bị ÉP, không được chọn.** Hai mốc trên cho `T*(E) ∝ E^{1−p}` với

```
1 − p = ln(1000/20) / ln(6×10⁹ / 2.379.930) = ln 50 / ln 2521,0826 = 0,499464
⟹ p = 0,500536
```

lệch **0,107%** so với luật căn `p = ½`. Và nếu áp thẳng `p = ½` thì ETD-max xong sau **19,916**
cửa sổ thay vì 20 — lệch **0,42%**. Hai mốc hiệu chỉnh **tự chúng đã chọn luật căn**; không còn
bậc tự do nào để hiệu chỉnh thêm.

---

## 8. Định lý 7 — kháng tách tài khoản

**Phát biểu.** Cho luật tốc độ `ρ(E)`, đặt `S(n) = n · ρ(E/n) / ρ(E)` là **hệ số lợi** khi tách
một suất `E` thành `n` suất bằng nhau. Với họ luỹ thừa `ρ(E) = c·E^p`:

```
S(n) = n · (E/n)^p / E^p = n^{1−p}                                                        (8)
```

**Hệ quả.**

| luật | `p` | `S(n)` | đọc |
|---|---|---|---|
| tuyệt đối (`ρ = D`, v2) | 0 | `n` | **trần tự huỷ** — tách 100 thì nhanh gấp 100 |
| **căn (v3)** | ½ | `√n` | tách 100 thì nhanh gấp 10 |
| tuyến tính | 1 | `1` | trung lập hoàn toàn, nhưng xoá mọi khác biệt theo cỡ |

`S(n) = 1` chỉ đạt ở `p = 1`, và `p = 1` nghĩa là thời gian mở khoá **không phụ thuộc cỡ pot** —
mất luôn thứ cả cơ chế được dựng ra để có. Luật căn là điểm thoả hiệp duy nhất vừa kháng tách vừa
còn phân biệt cỡ. ∎

**Giới hạn phải khai:** `√n` không miễn nhiễm. Với `E = 6×10⁹`, tách `n = 36` đưa thời gian từ
23,7 năm xuống ≈ 2,3 năm. Kháng tách **không** thay được một trần trên `n`; đó là việc của
CONTRACT §4d (sổ tên NFT), và §4d chỉ đóng được tách-theo-**khoá**, không đóng
tách-theo-**người**.

---

## 9. Định lý 8 — điều kiện để `g` là HỆ SỐ chứ không phải CỔNG

**Phát biểu.** Gọi `E_test` là suất lớn nhất trong nhóm mà hệ **biết trước** là có `consumed = 0`,
và `C_launch` là lưu hành lúc bật móc. Nếu

```
g_min · κ · C_launch  ≥  r · w · √E_test                                                  (9)
```

thì với mọi tài khoản của nhóm ấy, ràng buộc cắt ngọn (6) **không bao giờ ráo**, nên `g` không đổi
lịch vesting của họ dù bằng `g_min`.

**Chứng minh.** Vế phải là lượng mở khoá mỗi cửa sổ theo (4). Nếu trần (6) ≥ lượng ấy thì mỗi cửa
sổ rút trọn phần mới mở; ràng buộc ráo là (5), không phải (6). ∎

**Áp số.** Nhóm ETD được chọn bằng snapshot hồi tố stake tích luỹ — tiêu chí là uỷ thác ADA, nên
nhóm này **tiêu 0 MAGIC theo cấu tạo**, không phải do lười.

```
r·w·⌊√E_test⌋ = 1 · 77.460 · 1.542.702 = 119.497,70 LAMP / cửa sổ
κ · C_launch  = 10⁻³ · 10⁹ = 1.000.000 LAMP
⟹ g_min ≥ 119.497,70 / 1.000.000 = 0,1194977     ⟹  CHỌN g_min = 1/8 = 0,125
```

Tại `g_min = 1/8` trần là 125.000 > 119.497,70 ⟹ (9) thoả, biên dư 4,6%. ∎

**Hệ quả 9.1 (phép thử phải chạy trên mọi ứng viên công thức).** *"Một tài khoản có `consumed = 0`
và mãi bằng 0 thì vest hết suất trong bao lâu? Nếu 'không bao giờ' hoặc 'lâu hơn đời dự án' thì số
hạng ấy là một CỔNG, không phải một HỆ SỐ."*

**Hệ quả 9.2 (`g` phải BÃO HOÀ).** `consumed_nanogic` là số của **một thread**, không phải của
**một người**: đúc thread là permissionless và một người mở được `N` thread cùng một `did_commit`,
không có đường on-chain nào cộng chúng lại. Reference input trỏ vào thread nào là do người dựng tx
chọn ⟹ họ chọn thread cao nhất và dồn hoạt động vào đúng nó. Vì `g` là **thưởng** chứ không phải
**cổng**, chiều đọc-thiếu **không** nghiêng về phía an toàn: ai rải thật ra `N` thread thì thiệt,
ai dồn một thread thì lợi. Nên `g` không được là hàm tăng không chặn của `consumed`; nó phải chạm
trần `g = 1` ở một mức đặt được, để việc dồn thread chỉ giúp tới mức ấy rồi thôi. ∎

---

## 10. Định lý 9 — đa-claim cộng dồn (giữ từ v2, phát biểu lại cho (5))

**Phát biểu.** Với dãy redeem tại `t_open ≤ τ₁ ≤ … ≤ τ_m`, tổng nhận
`Σ aᵢ = redeemed_cuối ≤ min(E, vested(τ_m))`, độc lập số lần rút.

**Chứng minh.** `redeemed_{i+1} = redeemed_i + a_i` theo CONTRACT §4 mục 3, nên
`Σ aᵢ = redeemed_cuối − 0`. Mỗi lượt (5) ép `redeemed_{i+1} ≤ min(E, r·√E·S(τᵢ))`, và theo Định lý
3 vế phải không giảm. Vậy `redeemed_cuối ≤ min(E, vested(τ_m))`. ∎

**Khác v2 một điểm phải nêu.** v2 có **độc lập lộ trình**: `Σ aᵢ` chỉ phụ thuộc `τ_m`. v3 **KHÔNG**
giữ tính chất đó, vì (6) chặn từng lượt: rút một lần duy nhất ở `τ_m` có thể nhận ít hơn rút đều
mỗi cửa sổ. Đây là hệ quả cố ý của cắt ngọn, và nó là lý do CONTRACT §10 đòi giao diện tách **"rút
được cửa sổ này"** khỏi **"còn lại tổng"** — người dùng phải thấy được rằng rút đều thì có lợi,
nếu không họ sẽ đọc mỗi lần cắt ngọn như một lần tịch thu.

---

## 11. Bảng bất biến (đối chiếu test)

| ID | Phát biểu toán | Định lý | ghi chú v2 → v3 |
|---|---|---|---|
| **M-INDEX-MONO** | `t' ≥ t ⇒ A(t') ≥ A(t)`; `A` liên tục tại mốc post | §2 | MỚI |
| **M-INDEX-LIVE** | không post thêm ⇒ `A` vẫn tăng nhịp `w_k` | §2 HQ 1.1 | MỚI |
| **M-INDEX-PAST** | lượt post mới không đổi `A(t)` với `t` quá khứ | §2 HQ 1.2 | MỚI |
| **M-MONO** | `t' ≥ t ⇒ vested(t') ≥ vested(t)` | §3 | v2 cần `D` cố định; v3 **không cần** |
| **M-CAP** | `vested(t) ≤ E ∀t` | §3 | giữ |
| **M-CHANNEL** | thừa số giảm được + ngoài tổng ⇒ tụt hồi tố | §4 | MỚI — luật thiết kế |
| **M-TRIM-FINITE** | cắt ngọn ⇒ xong sau ≤ `⌈E/F⌉` lượt | §5 | MỚI |
| **M-TRIM-FLOOR** | `F = 0` ⇒ `C = 0` là điểm hấp thụ | §5 HQ 4.1 | MỚI |
| **M-SQUARE** | `(5) ⟺ (4)` trên `ℤ₊` | §6 | MỚI |
| **M-ROOT-CEIL** | `w = ⌊√W⌋` ⇒ không bao giờ chạm `E`; `⌈·⌉` thì chạm | §7 | MỚI — **ca kiểm bắt buộc** |
| **M-SPLIT** | `S(n) = n^{1−p}`; `p = ½ ⇒ √n` | §8 | MỚI |
| **M-GATE** | (9) thoả ⇒ `g` không đổi lịch của nhóm `consumed = 0` | §9 | MỚI |
| **M-SUM** | `Σ aᵢ = redeemed_cuối ≤ min(E, vested(τ_m))` | §10 | v2 có độc lập lộ trình; v3 **KHÔNG** |
| **M-INV** | `0 ≤ redeemed ≤ vested(t) ≤ E` mọi state | §3 + §10 | giữ |

**M-ROOT-CEIL là ca dễ bỏ sót nhất trong bảng** và đắt nhất nếu bỏ: hai giá trị `w` cách nhau
**đúng một đơn vị** cho hai hệ quả là *"tài khoản xong sau 1000 cửa sổ"* và *"tài khoản không bao
giờ xong"*. Bài kiểm phải chạy tới `n = n*` thật, không được dừng ở vài cửa sổ đầu — ở vài cửa sổ
đầu hai giá trị `w` cho kết quả **giống hệt nhau**, nên một bài ngắn xanh ở cả hai cực và do đó
không kiểm gì.

Bảo toàn value treasury (`tre_out = tre_in − Σ aᵢ`, không burn) và sổ `total_redeemed` tăng đúng
`amount` là bất biến on-chain riêng — chứng minh ở CONTRACT §4/§7, không thuộc phạm vi math thuần.
