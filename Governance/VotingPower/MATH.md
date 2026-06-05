# MATH — Đặc tả toán học của Voting Power

**Trạng thái:** bản nháp 2026-06-05. Bám **CONTRACT.md** (mô hình anh đã duyệt). Không mâu thuẫn
4 nguyên lý trong CONTRACT §2 và công thức trong CONTRACT §1.

> File này CHỈ đặc tả phần toán: định nghĩa hình thức của VP, chứng minh tính chất, mô hình chi
> phí thâu tóm, xử lý biên và ổn định số học. Mọi tham số số cụ thể (cap, weight, độ dài cửa sổ)
> là **tham số mở do DAO định** — file này không tự chốt con số cuối, chỉ chốt *hình thức* và
> *ràng buộc* mà con số phải thỏa.

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

Đặc tả chặt chẽ, ở mức toán học, hàm Voting Power

```
VP_i = ∏_k  min( C_{k,i}, cap_k )^( w_k )
```

sao cho mọi spec khác (TECH triển khai on-chain, EXEC lộ trình, FEAT hành vi) có một định nghĩa
**duy nhất, không mơ hồ** để bám. Đồng thời chứng minh bằng toán các khẳng định mà CONTRACT §2
nêu ra dưới dạng nguyên lý:

- VP **bị chặn trên** (bounded) — token nhiều bao nhiêu cũng không phá trần.
- VP **đơn điệu tăng** (monotonic) theo từng yếu tố đóng góp — đóng góp thật luôn được thưởng.
- Vì sao **NHÂN** (geometric) chứ không **CỘNG** (additive) — chứng minh additive cho phép mua
  3/4 yếu tố bằng tiền, geometric thì một yếu tố thấp kéo sụp tất cả.
- **Chi phí thâu tóm = chi phí đóng góp thật** — định lượng bằng mô hình chi phí sybil/collusion.

### 0.2 KHÔNG thuộc phạm vi spec này (thuộc spec khác)

| Nội dung | Thuộc spec |
|---|---|
| Cách đo từng `C_k` thực tế (đọc UTxO nào, cửa sổ epoch nào, sự kiện on-chain nào) | TECH (đo C1–C4 qua reference input) |
| Datum/redeemer, validator, chống double-vote, tích hợp DID proof | TECH |
| Vòng đời cử tri, loại quyết định, luồng proposal/vote/recall, quy tắc recall | FEAT |
| Lộ trình, mốc, thứ tự build, deploy Preview, bootstrap DAO | EXEC |
| Con số cuối của cap/weight/cửa sổ | DAO bỏ phiếu (governance) — không spec nào tự chốt |

File MATH chỉ giả định mỗi `C_{k,i}` là **một số thực không âm đã đo được** (`C_{k,i} ≥ 0`).
Cách đo là việc của TECH.

---

## 1. Ký hiệu và định nghĩa hình thức

### 1.1 Tập yếu tố và tham số

- `i` — chỉ số cử tri (mỗi cử tri = đúng 1 PhoenixKey DID, xem CONTRACT §1).
- `k ∈ {1, …, K}` — chỉ số yếu tố đóng góp. CONTRACT khởi đầu với `K ≥ 4`:
  - `C1` = MAGIC tiêu thụ trong cửa sổ quá khứ (engagement đã chứng minh).
  - `C2` = LAMP cam kết trong ScheduleGen, cửa sổ tương lai (cam kết tương lai).
  - `C3` = uy tín cộng đồng (lịch sử quyết định đúng).
  - `C4` = LAMP nắm giữ hiện tại (vốn hiện tại), **cap = 100 triệu** (CONTRACT §1, §2.3).
  - DAO có thể bổ sung yếu tố → `K` tăng. Công thức không đổi hình thức.
- `C_{k,i} ≥ 0` — giá trị thô của yếu tố `k` cho cử tri `i`.
- `cap_k > 0` — trần (ngưỡng bão hòa) của yếu tố `k`. **Tham số mở (DAO định)**, trừ
  `cap_4 = 100 000 000` LAMP đã chốt trong CONTRACT.
- `w_k ≥ 0` — trọng số của yếu tố `k`. **Tham số mở (DAO định)**.

### 1.2 Giá trị đã chặn (clamped)

Định nghĩa giá trị yếu tố sau khi áp trần:

```
x_{k,i} = min( C_{k,i}, cap_k )            (1)
```

Tính chất hiển nhiên: `0 ≤ x_{k,i} ≤ cap_k`. Mọi đóng góp vượt trần bị **bỏ qua** — đây là cơ
chế chống tích tụ quyền lực (xem §3, §5).

### 1.3 Định nghĩa Voting Power

```
VP_i = ∏_{k=1}^{K}  x_{k,i}^{ w_k }
     = ∏_{k=1}^{K}  ( min( C_{k,i}, cap_k ) )^{ w_k }      (2)
```

Đây là một **trung bình nhân có trọng số chưa chuẩn hóa** (weighted geometric mean dạng tích).
Tài liệu nền: trung bình nhân có trọng số — <https://en.wikipedia.org/wiki/Weighted_geometric_mean>.

### 1.4 Quy ước biên (bắt buộc để (2) xác định tốt)

- `0^{w} = 0` với mọi `w > 0`. (Một yếu tố bằng 0 → toàn bộ tích bằng 0.)
- `x^{0} = 1` với mọi `x ≥ 0` kể cả `x = 0`. (Yếu tố trọng số 0 không ảnh hưởng — bị tắt.)
  Đây là quy ước chuẩn để trung bình nhân có trọng số xác định khi `w_k = 0`; xem
  <https://en.wikipedia.org/wiki/Zero_to_the_power_of_zero> (mục "in combinatorics/analysis,
  `0^0 = 1` thường được lấy làm quy ước").
- Hệ quả: nếu **bất kỳ** `x_{k,i} = 0` với `w_k > 0` thì `VP_i = 0`. Người mới chưa có yếu tố
  nào (mọi `C_{k,i}=0`) có `VP_i = 0` — đúng tinh thần "mô hình tập sự" của CONTRACT §2.1.

---

## 2. Dạng log — nền tảng cho chứng minh và cho cài đặt

Vì `VP_i` là tích các lũy thừa, lấy logarit biến nó thành **tổ hợp tuyến tính** — dễ chứng minh,
và là cách cài đặt ổn định số học (xem §9).

Trên miền `x_{k,i} > 0`:

```
ln VP_i = Σ_{k=1}^{K}  w_k · ln( x_{k,i} )      (3)
```

Đặt `L_i = ln VP_i`. Khi đó `L_i` là **hàm tuyến tính theo các `ln x_{k,i}`** với hệ số `w_k ≥ 0`.
Mọi tính chất "đơn điệu" và "đánh đổi giữa các yếu tố" đọc trực tiếp từ dạng (3).

> Ghi chú miền: (3) chỉ đúng khi mọi `x_{k,i} > 0`. Trường hợp có `x_{k,i} = 0` thì `VP_i = 0`
> (mục §1.4) và `ln VP_i = -∞` — ta xử lý riêng như một nhánh biên, không dùng (3).

---

## 3. Tính chất 1 — VP bị chặn trên (bounded)

### 3.1 Phát biểu

Với mọi cử tri `i`:

```
0 ≤ VP_i ≤ VP_max = ∏_{k=1}^{K}  cap_k^{ w_k }      (4)
```

`VP_max` là **hằng số toàn hệ** (chỉ phụ thuộc cap và weight, không phụ thuộc cử tri).

### 3.2 Chứng minh

Từ (1): `0 ≤ x_{k,i} ≤ cap_k`. Hàm `t ↦ t^{w_k}` với `w_k ≥ 0` là không-giảm trên `[0, ∞)`.
Do đó `x_{k,i}^{w_k} ≤ cap_k^{w_k}`. Tích các số không âm bảo toàn bất đẳng thức từng thừa số:

```
VP_i = ∏_k x_{k,i}^{w_k} ≤ ∏_k cap_k^{w_k} = VP_max.
```

Cận dưới `VP_i ≥ 0` hiển nhiên vì mọi thừa số không âm. ∎

### 3.3 Ý nghĩa (vì sao đây là cột sống chống thâu tóm)

`VP_max` không phụ thuộc số LAMP/MAGIC một cá nhân nắm. Cụ thể với `C4` (vốn hiện tại):

- Cử tri giữ `100 triệu` LAMP → `x_4 = cap_4 = 100 triệu`.
- Cử tri giữ `12 tỷ` LAMP → `x_4 = min(12 000 000 000, 100 000 000) = 100 triệu`. **Bằng nhau.**

Toàn bộ phần vốn vượt `cap_4` **không sinh thêm một chút VP nào**. Đây chính là nguyên lý
CONTRACT §2.3 "token đơn thuần vô hiệu hóa", phát biểu lại dưới dạng định lý: hàm VP **bão hòa**
theo từng yếu tố tại `cap_k`.

---

## 4. Tính chất 2 — đơn điệu (monotonic) theo từng yếu tố

### 4.1 Phát biểu

Cố định mọi yếu tố `j ≠ k`. Khi `C_{k,i}` tăng, `VP_i` **không giảm**; và **tăng thực sự** chừng
nào `C_{k,i} < cap_k` (chưa chạm trần) và mọi yếu tố khác đều dương và `w_k > 0`. Khi
`C_{k,i} ≥ cap_k`, `VP_i` **phẳng** (không tăng nữa) — vùng bão hòa.

### 4.2 Chứng minh

Xét `x_{k,i} = min(C_{k,i}, cap_k)`. Hàm `C ↦ min(C, cap_k)` không-giảm. Hàm `x ↦ x^{w_k}`
(`w_k ≥ 0`) không-giảm. Các thừa số khác cố định và không âm. Hợp các hàm không-giảm là
không-giảm → `VP_i` không-giảm theo `C_{k,i}`.

Trên vùng chưa bão hòa (`C_{k,i} < cap_k`, nên `x_{k,i} = C_{k,i}`), nếu mọi `x_{j,i} > 0` và
`w_k > 0`, đạo hàm riêng (dùng (3)):

```
∂ VP_i / ∂ x_{k,i} = VP_i · ( w_k / x_{k,i} ) > 0.      (5)
```

dương ngặt → đơn điệu tăng thực sự. Trên vùng bão hòa, `x_{k,i} = cap_k` hằng → đạo hàm 0. ∎

### 4.3 Ý nghĩa

Đóng góp thật **luôn được thưởng** cho tới khi chạm trần — không có vùng "đóng thêm bị phạt".
Sau trần thì đóng thêm yếu tố đó vô ích (khuyến khích đa dạng hóa sang yếu tố khác, xem §5–§6).

---

## 5. Tính chất 3 — vì sao NHÂN (geometric) chứ không CỘNG (additive)

Đây là quyết định thiết kế **cốt lõi** của CONTRACT §1 (dòng "Công thức NHÂN, không CỘNG"). Mục
này chứng minh bằng toán vì sao additive vỡ và geometric đứng.

### 5.1 Hai mô hình đối chiếu

Chuẩn hóa mỗi yếu tố về `[0,1]` cho dễ so sánh: `ŷ_{k,i} = x_{k,i} / cap_k ∈ [0,1]`.

- **Additive (cộng):**  `VP^{add}_i = Σ_k w_k · ŷ_{k,i}`.
- **Geometric (nhân):** `VP^{geo}_i = ∏_k ŷ_{k,i}^{w_k}`  (đây là (2) đã chuẩn hóa, sai khác
  một hằng số `∏_k cap_k^{w_k}`).

### 5.2 Định lý "mua 3/4 yếu tố" — additive vỡ

**Phát biểu.** Với mô hình additive, một kẻ tấn công **bỏ hẳn** yếu tố khó mua nhất (giả sử
`C3` = uy tín) vẫn đạt tỷ lệ VP

```
VP^{add} / VP^{add}_max  =  1 − w_3 / Σ_k w_k
```

của trần. Nếu `w_3` chỉ là một phần tư tổng trọng số thì kẻ tấn công mua 3 yếu tố còn lại tới
trần vẫn đạt **3/4 quyền lực tối đa** mà **không cần một chút uy tín nào**.

**Chứng minh.** Đặt `ŷ_3 = 0` (bỏ uy tín), `ŷ_k = 1` cho `k≠3` (mua tới trần). Khi đó
`VP^{add} = Σ_{k≠3} w_k = (Σ_k w_k) − w_3`. Chia cho `VP^{add}_max = Σ_k w_k`. ∎

→ Additive cho phép **thay thế** (substitution) hoàn toàn giữa các yếu tố: tiền mua được `C4`,
đốt LAMP đẩy `C1`, khóa LAMP đẩy `C2` — ba yếu tố này mua được, gánh trọn phần `1 − w_3/Σw`.
Uy tín (`C3`) trở nên **không bắt buộc**. Đây đúng là cảnh báo trong CONTRACT §1 dòng 30.

### 5.3 Định lý "một yếu tố thấp kéo sụp" — geometric đứng

**Phát biểu.** Với mô hình geometric, nếu yếu tố `C3` chỉ đạt tỷ lệ `ŷ_3 = ε` (nhỏ) trong khi
mọi yếu tố khác đạt trần (`ŷ_k = 1`), thì

```
VP^{geo} / VP^{geo}_max  =  ε^{ w_3 }  → 0  khi ε → 0.
```

Và nếu `ŷ_3 = 0` thì `VP^{geo} = 0` tuyệt đối (mục §1.4).

**Chứng minh.** `VP^{geo} = ∏_k ŷ_k^{w_k} = 1·…·ε^{w_3}·…·1 = ε^{w_3}`. `VP^{geo}_max` đạt khi
mọi `ŷ_k=1`, bằng 1. Tỷ lệ là `ε^{w_3}`, dần 0 khi `ε→0`. ∎

→ Geometric **không cho thay thế**: thiếu một yếu tố là sụp toàn bộ, không tiền nào bù được.
Đây là **tính bổ trợ** (complementarity) — bản chất hàm Cobb–Douglas; nền kinh tế học:
<https://en.wikipedia.org/wiki/Cobb%E2%80%93Douglas_production_function> (các đầu vào bổ trợ,
một đầu vào bằng 0 → sản lượng 0).

### 5.4 Ví dụ số minh họa (giả định weight để minh họa — KHÔNG phải số chốt)

Lấy `K=4`, `w_k = 1` cho mọi `k` (chỉ để minh họa; **DAO sẽ định weight thật**). Một kẻ tấn công
giàu mua tối đa `C1, C2, C4` nhưng uy tín chỉ đạt `ŷ_3 = 0.01` (1% trần):

| Mô hình | VP / VP_max | Diễn giải |
|---|---|---|
| Additive | `(1+1+0.01+1)/4 = 0.7525` → **75%** quyền lực | mua được phần lớn |
| Geometric | `1·1·0.01·1 = 0.01` → **1%** quyền lực | uy tín thấp kéo sụp |

Cùng một kẻ tấn công, additive cho 75%, geometric cho 1%. Đây là lý do chọn nhân. ∎

### 5.5 Tổng quát: vị trí trong họ trung bình lũy thừa và độ co giãn thay thế

Hai cách tham số hóa khác nhau, KHÔNG được trộn lẫn — tách rõ:

**(a) Theo bậc trung bình lũy thừa `p` (power-mean exponent).** Trung bình nhân có trọng số là
trường hợp **`p = 0`** của họ trung bình lũy thừa (power mean / generalized mean). Nó **không**
phải biên dưới của họ này: theo chính trang tham chiếu, geometric mean nằm **GIỮA** dãy — lớn hơn
các trung bình bậc âm (`p < 0`: harmonic `p=−1`, min `p→−∞`) và nhỏ hơn các bậc dương (`p = 1`
arithmetic/additive, max `p→+∞`). Geometric chỉ là **một điểm** (`p=0`) trên dải, không phải cận
dưới. Tài liệu (mục special cases, `p=0` cho geometric mean):
<https://en.wikipedia.org/wiki/Generalized_mean#Special_cases>.

**(b) Theo độ co giãn thay thế `σ` (CES elasticity).** Trong khung **CES** (constant elasticity of
substitution), trung bình nhân tương ứng giới hạn **`σ → 1`** (dạng Cobb–Douglas), additive
(thay thế hoàn hảo) ứng với **`σ → ∞`**. Quan hệ giữa hai cách: tham số CES `ρ = 1 − 1/σ`, với
geometric `ρ → 0` (`σ=1`) và linear `ρ = 1` (`σ→∞`). LƯU Ý: bậc power-mean `p` ở (a) và elasticity
`σ` ở (b) là **hai trục khác nhau**, đừng đồng nhất `p` với `σ`; chỉ trùng nhau ở các điểm mốc
geometric (`p=0`, `σ=1`) và additive (`p=1`, `σ→∞`). Tài liệu CES / Cobb–Douglas:
<https://en.wikipedia.org/wiki/Constant_elasticity_of_substitution> và
<https://en.wikipedia.org/wiki/Cobb%E2%80%93Douglas_production_function>.

**Hệ quả thiết kế.** Chọn geometric = chọn `σ=1` (các yếu tố **bổ trợ chứ không thay thế**) — phát
biểu định lượng của "không có đường tắt" (CONTRACT §2.2). Nếu sau này DAO muốn "chống thay thế
mạnh hơn nữa", chuyển sang trung bình lũy thừa **bậc âm** (`p < 0`, tương ứng `σ < 1`) — ghi ở §14
Câu hỏi còn treo. Đánh đổi: `p<0` an toàn hơn nhưng `ln`/`exp` nguyên on-chain phức tạp hơn.

---

## 6. Tính chất 4 — lợi suất biên giảm dần (lõm theo biến gốc khi `w_k<1`)

### 6.1 Phát biểu

Tính chất hữu ích là: theo **biến gốc** `x_k` (KHÔNG phải theo `ln x_k`), mỗi yếu tố có **lợi suất
biên giảm dần** khi `0 < w_k < 1` — đóng góp đầu tiên đáng giá hơn đóng góp thứ một triệu.

> Ghi chú (tránh nhầm): theo véc-tơ `(ln x_1, …, ln x_K)` thì `L_i = ln VP_i` **tuyến tính** (dạng
> (3)) nên vừa lõm vừa lồi (không lõm ngặt) → KHÔNG cho lợi suất giảm dần. Tính chất giảm dần chỉ
> xuất hiện theo **biến gốc** `x_k`. Vì vậy mục này không dùng từ "log-lõm".

### 6.2 Chứng minh (lợi suất giảm dần khi `w_k<1`)

Xét một yếu tố, giữ các yếu tố khác cố định (gộp vào hằng `A>0`): `f(x) = A·x^{w_k}`. Đạo hàm bậc
hai `f''(x) = A·w_k(w_k−1)x^{w_k−2}`. Với `0 < w_k < 1`, `w_k−1<0` → `f''<0` → **lõm** → lợi suất
biên giảm dần. Với `w_k=1` tuyến tính; `w_k>1` lồi (lợi suất tăng dần — DAO nên tránh trừ khi cố
ý). ∎

### 6.3 Ý nghĩa

Đặt `w_k ∈ (0,1]` (khuyến nghị MATH) làm cho mỗi yếu tố **bão hòa mềm** trước cả khi chạm cap
cứng: đóng góp đầu tiên đáng giá hơn đóng góp thứ một triệu. Cùng với cap cứng (§3) tạo **hai lớp
giảm tốc tích tụ**. Khuyến nghị nằm trong §11 (tham số mở), không ép.

---

## 7. Chuẩn hóa trọng số (Σ w_k)

### 7.1 Vấn đề

VP tuyệt đối không có ý nghĩa nội tại — chỉ **thứ tự** và **tỷ lệ giữa các cử tri** mới quan
trọng (bỏ phiếu là so sánh tổng VP các bên). Nhân mọi `VP_i` với một hằng số dương chung không
đổi kết quả bỏ phiếu. Do đó **chuẩn hóa weight là tùy chọn về mặt kết quả**, nhưng **bắt buộc về
mặt diễn giải và ổn định số học**.

### 7.2 Hai quy ước

- **Chuẩn hóa tổng-1:** ràng buộc `Σ_k w_k = 1`. Khi đó `VP_i` là **trung bình nhân có trọng số
  đúng nghĩa** (weighted geometric mean), và `VP_max = ∏ cap_k^{w_k}` có thứ nguyên "trung bình"
  của các cap → dễ đọc. Đây là **khuyến nghị MATH** cho diễn giải.
- **Không chuẩn hóa:** để `w_k` tự do `≥0`. Kết quả bỏ phiếu giống hệt (vì chỉ khác hằng số mũ
  chung khi mọi `w` nhân cùng hệ số? — KHÔNG: nhân mọi `w_k` với `c` biến `VP_i` thành `VP_i^c`,
  một phép **đơn điệu tăng**, nên **bảo toàn thứ tự** giữa các cử tri). Xem §7.3.

### 7.3 Bổ đề bảo toàn thứ tự dưới phép co giãn weight

**Phát biểu.** Với `c>0`, thay `w_k → c·w_k` mọi `k` thì `VP_i → VP_i^{c}`. Vì `t ↦ t^{c}` đơn
điệu tăng trên `[0,∞)`, thứ tự `VP_a < VP_b` được bảo toàn, và **mọi so sánh tổng-VP theo ngưỡng
cũng cần co ngưỡng tương ứng**. Hệ quả thực hành: DAO có thể chuẩn hóa `Σw_k=1` mà không mất tổng
quát; ngưỡng siêu đa số (§8) định trên thang VP đã chuẩn hóa.

> **CẢNH BÁO (vector thao túng — KHÔNG chỉ là ghi chú):** phép `VP_i → VP_i^c` bảo toàn thứ tự
> **từng cặp** nhưng KHÔNG bảo toàn **tỷ lệ tổng** `Σ VP` giữa hai phe (vì `(a+b)^c ≠ a^c+b^c`).
> Vì biểu quyết cộng VP các cử tri cùng phe (6), **co giãn weight có thể LẬT kết quả một cuộc bỏ
> phiếu theo ngưỡng tổng** (8.2). Đây là tính chất gây **bất ổn governance thật**: một phe kiểm
> soát đề xuất chỉnh-weight có thể tinh chỉnh `c` (hoặc đổi từng `w_k`) để đẩy kết quả các cuộc
> vote tổng **khác** đang/ sắp diễn ra → vector thao túng. KHÔNG được để DAO đổi weight giữa kỳ và
> áp hồi tố lên proposal đang chạy.

**Hệ quả:** việc khóa chuẩn hóa weight được nâng thành **bất biến cứng** — xem §12 (Bất biến I-1),
KHÔNG chỉ khuyến nghị. Liên kết ba spec: TECH §5.6 (`weight_param_ref` khóa bảng weight theo
proposal lúc Open), FEAT §3.1 (ngưỡng cố định theo loại quyết định) + FEAT §10 câu 4 (treo "khóa
weight trong kỳ"), MATH §12 I-1. Cả ba phải cùng ép bất biến này.

---

## 8. Ngưỡng siêu đa số — MỘT mô hình ngưỡng duy nhất, định nghĩa "≥", và phủ quyết là phần bù

### 8.1 Tổng VP của các phe

Một quyết định gom phiếu thành ba phe rời nhau theo phiếu của cử tri: `S` = tập DID bỏ **THUẬN**,
`O` = tập **CHỐNG**, `A` = tập **TRẮNG** (abstain). Sức nặng mỗi phe là tổng VP:

```
W(S) = Σ_{i ∈ S} VP_i ;   W(O) = Σ_{i ∈ O} VP_i ;   W(A) = Σ_{i ∈ A} VP_i .      (6)
```

Tập **tham gia** (participating) `P = S ∪ O ∪ A`, sức nặng `W(P) = W(S)+W(O)+W(A)`.

(Lưu ý: gom bằng **CỘNG VP giữa các cử tri** — geometric là *bên trong* một cử tri, additive là
*giữa* các cử tri. Hai tầng khác nhau, không mâu thuẫn: nhân để ép mỗi cá nhân phải đa dạng;
cộng để dân chủ giữa các cá nhân.)

### 8.2 Định nghĩa ngưỡng — CHỐT MỘT mô hình (mẫu số = phe tham gia, kèm quorum)

MATH chốt **một** mô hình ngưỡng duy nhất để TECH/FEAT/EXEC cùng bám; mọi mục sau (§10) phải dùng
đúng định nghĩa này. Mô hình gồm **hai cổng độc lập** (khớp FEAT §3.3, §4.5):

**Cổng 1 — Quorum.** Vòng bỏ phiếu chỉ hợp lệ nếu tổng VP tham gia đạt sàn quorum `q`:

```
W(P)  ≥  q .      (7a)   [q = tham số mở (DAO định), FEAT §3.3]
```

**Cổng 2 — Siêu đa số phần `θ`.** Khi quorum đạt, quyết định **THÔNG QUA** khi:

```
W(S)  ≥  θ · W(base) ,      (7b)
```

trong đó **mẫu số `W(base)` là sức nặng của phe THAM GIA**, KHÔNG phải "toàn cử tri đủ điều kiện".
Cách xử lý phiếu TRẮNG trong mẫu số là **tham số mở (DAO định)** (FEAT §4.5, §10 câu 1), chọn một
trong hai:

```
W(base) = W(S) + W(O)            (TRẮNG KHÔNG vào mẫu số — TRẮNG ≠ chống) ;
W(base) = W(P) = W(S)+W(O)+W(A)  (TRẮNG vào mẫu số — TRẮNG ngầm như chống) .
```

với `θ ∈ (1/2, 1]` là **tham số mở (DAO định)** theo loại quyết định (vd `θ = 2/3` cho hiến chương,
`θ = 3/4` cho hiến pháp — FEAT §3.1). Mẫu số là **động** (theo phe tham gia của chính cuộc bỏ phiếu
đó), KHÔNG cố định theo toàn cử tri — đây là điểm chốt thống nhất, thay cho định nghĩa cũ
`W(toàn cử tri đủ điều kiện)`.

> **Vì sao mẫu số = phe tham gia, không phải toàn cử tri đủ điều kiện?** (first-principles)
> Toàn cử tri gồm cả tập sự VP≈0 và người vắng mặt. Lấy mẫu số = toàn cử tri biến quorum thành
> ngầm định trong ngưỡng và làm "vắng mặt" ngầm thành "chống" — sai ngữ nghĩa và khó tách bạch.
> Tách **quorum (7a)** lo tính chính danh (đủ người tham gia) khỏi **tỷ lệ (7b)** lo ý chí của
> người đã tham gia. Hai cổng độc lập, dễ suy luận và khớp thực hành DAO (FEAT §3.3, §4.5).

Dùng dấu **`≥`** (lớn hơn hoặc bằng) ở cả (7a) và (7b), không phải `>`: đạt **đúng** ngưỡng là
**thông qua**. Lý do chọn `≥` (first-principles):

- Quy tắc phải **đơn định** và **không nhạy với sai số làm tròn về phía chặn**: nếu dùng `>` thì
  một phe đạt **đúng** `2/3` bị trượt vì thiếu một đơn vị vô cùng nhỏ — bất công và phụ thuộc
  cách làm tròn. `≥` làm ranh giới **đóng**, kết quả ổn định.
- Quy ước phổ biến trong định nghĩa siêu đa số ("at least two-thirds"):
  <https://en.wikipedia.org/wiki/Supermajority> (diễn đạt chuẩn là "ít nhất", tức `≥`).

### 8.2b Phủ quyết là PHẦN BÙ của thông qua (giữ nhất quán dấu)

"Phủ quyết" (chặn) KHÔNG phải một ngưỡng riêng đặt trên mẫu số khác — nó đúng là **phủ định của
điều kiện thông qua (7b)**. Phe chống chặn được khi phe thuận **không** đạt (7b):

```
W(S) < θ · W(base)   ⇔   W(O) > (1 − θ) · W(base)      (khi W(base)=W(S)+W(O), tức TRẮNG ngoài mẫu số).
```

Với `θ = 2/3`: phe chống phủ quyết khi `W(O) > 1/3 · W(base)`. Lưu ý dấu: thông qua dùng `≥`
(ranh giới đóng cho phe thuận), nên phủ quyết — phần bù chặt — dùng `>` (giữ `W(S) ≥ θ·W(base)` và
`W(O) > (1−θ)·W(base)` loại trừ lẫn nhau, không cả hai cùng đúng tại điểm biên). Đây thay cho phát
biểu **bản cũ** ("θ=1/3 cần >1/3 tổng", nay là ví dụ §10.6) vốn dùng mẫu số "tổng" mâu thuẫn — nay
mọi tỷ lệ đều trên **cùng một mẫu số `W(base)`**.

### 8.3 Ý nghĩa với cap C4: "12 tỷ → 120 DID" (suy trực tiếp từ CONTRACT, KHÔNG cần tokenomics)

Kết quả cốt lõi của mục này **chỉ phụ thuộc `cap_4 = 100 triệu`** (CONTRACT §2.3 đã chốt), KHÔNG
phụ thuộc tổng cung. Câu hỏi: **token có dịch thành quyền phủ quyết không?** Trả lời bằng toán:

1. **Token KHÔNG trực tiếp thành VP.** VP tính trên DID người-thật, và `C4` (LAMP nắm giữ) bị
   **cap 100 triệu/ DID** (§3.3). Một khối `B` LAMP, nếu nằm trong **một** ví/một DID, chỉ tính
   như `x_4 = 100 triệu` — đúng một cử tri. Để `B` "biến thành" power phải chia cho `B / cap_4` DID
   người-thật riêng biệt (mỗi DID còn phải có `C1,C2,C3` dương, nếu không VP=0 do geometric). Với
   `B = 12 tỷ` → `12 000 000 000 / 100 000 000 = ` **120 DID** (khớp CONTRACT §2.3, dòng "12 tỷ →
   120 cử tri"). Con số 120 này suy trực tiếp từ `cap_4`, **không** cần biết tổng cung. Xem §10.

2. **Quan hệ token→VP bị bẻ gãy có chủ đích.** Token chỉ là `C4` đã bị cap, một trong ≥4 yếu tố
   **nhân** với nhau. Vậy "phần token" KHÔNG đồng nghĩa "phần VP": dù một bên giữ phần lớn token,
   sau cap + geometric phần VP của họ bị chặn. Đây là tính năng, không phải lỗi.

3. **Chọn `θ` để không phe nào tự thông qua (tham số mở).** Theo §8.2 (mẫu số = phe tham gia), nếu
   DAO muốn bảo đảm "không phe nào tự thông qua quyết định hiến chương", chọn `θ` sao cho
   `θ > max_phe ( phần VP dự kiến của phe đó trong W(base) )`. Con số `θ` cụ thể là **DAO định**;
   MATH chỉ nêu ràng buộc + giữ đúng mẫu số `W(base)` của §8.2.

### 8.3b [cần verify] Minh họa tokenomics nền — KHỐI PHỤ THUỘC XÁC NHẬN

> **CẢNH BÁO:** toàn bộ khối này (và mọi kết luận dựa vào nó) phụ thuộc xác nhận tokenomics với
> file canonical **Foundation-Bootstrap / SPEC** (§14 câu 6). Nếu số thật khác, khối này lệch —
> nhưng kết quả §8.3 ("12 tỷ → 120 DID") ở trên KHÔNG bị ảnh hưởng vì chỉ dựa `cap_4`.

Giả định minh họa (CHƯA xác nhận): **Team 12 tỷ LAMP ≈ 1/3, Cộng đồng 24 tỷ ≈ 2/3, tổng 36 tỷ.**
Con số `12 tỷ` có gốc CONTRACT (§2.3); con số `36 tỷ tổng` và `24 tỷ cộng đồng` là MATH tự thêm để
minh họa — **[cần verify]**. Với giả định này và `θ = 2/3` (mẫu số `W(base)` theo §8.2): nếu mỗi
phe quy tụ đúng phần VP tương ứng phần đóng góp thật của mình thì Team **một mình không thông qua**
quyết định lớn (cần Cộng đồng), còn Cộng đồng (nếu đoàn kết) **thông qua được mà không cần** Team.
Nhấn lại: quan hệ này về **VP thực** sau cap+geometric, KHÔNG về số token (xem §8.3 điểm 2). Mọi ví
dụ số ở §10 chỉ dùng cho minh họa và KHÔNG được phụ thuộc các con số 36/24 tỷ chưa xác nhận này.

---

## 9. Xử lý biên

### 9.1 Người mới — `C_{k,i}=0` mọi `k` → `VP_i = 0`

Đây là **đặc tả đúng**, không phải lỗi (CONTRACT §2.1, "mô hình tập sự"). Người vừa có DID:
mọi yếu tố `0` → mọi `x_k = 0` → tích `= 0` → `VP=0`. Họ **vẫn được bỏ phiếu** (quyền tham gia),
nhưng **trọng số 0** cho tới khi tích lũy. FEAT mô tả vòng đời tập sự; MATH chỉ xác nhận VP=0 là
giá trị đúng.

### 9.2 Thiếu **một** yếu tố — `x_{j,i}=0` với `w_j>0` → `VP_i=0`

Hệ quả trực tiếp của geometric (§5.3, §1.4). Một cử tri rất mạnh ở `C1,C2,C4` nhưng **chưa có**
uy tín (`C3=0`) vẫn `VP=0`. Đây là **lá chắn chống mua quyền lực bằng tiền**: không thể bỏ qua
bất kỳ yếu tố nào. **Cảnh báo thiết kế** cho DAO: nếu một yếu tố quá khó đạt `>0` ở giai đoạn đầu
(vd uy tín khi hệ chưa có lịch sử) thì **cả hệ VP=0 toàn cục** → governance tê liệt. Hai lối ra,
**DAO định**:
- (a) Đặt `w_3 = 0` ở giai đoạn bootstrap (tắt yếu tố uy tín) rồi bật dần khi có dữ liệu; hoặc
- (b) Dùng **sàn dương** (floor) `x_{k,i} ← max(x_{k,i}, floor_k)` với `floor_k>0` nhỏ để tránh
  triệt tiêu tuyệt đối trong giai đoạn đầu. Đánh đổi: floor làm yếu tính "thiếu-là-sụp"; chỉ nên
  dùng tạm thời. Ghi ở §14 Câu hỏi còn treo.

### 9.3 Một yếu tố vượt trần — `C_{k,i} > cap_k`

`x_{k,i} = cap_k` (§1.2). Phần vượt bị bỏ. Không lỗi, là tính năng (§3.3).

### 9.4 Giá trị âm — không hợp lệ, và NGỮ NGHĨA của uy tín bị trừ (`C3` sau phạt)

Mọi `C_{k,i} ≥ 0` theo giả định §0.2. TECH phải bảo đảm phép đo không trả số âm; nếu (2) nhận mũ
thực thì cơ số phải `≥ 0`. Nhưng `C3` (uy tín) **có thể bị TRỪ** khi cử tri bỏ phiếu sai hoặc bị
recall (FEAT §2.4, §6). Cách kẹp về `≥0` ảnh hưởng tính đơn điệu của hình phạt — phải chốt ngữ
nghĩa, KHÔNG kẹp mù bằng `max(0,·)`.

**Vấn đề với `C3 = max(0, điểm)`.** Nếu mọi điểm âm đều bị kẹp về `0` thì mọi cử tri bị phạt nặng
**về cùng `C3=0` → VP=0**, KHÔNG phân biệt mức phạt (mất thông tin, mất đơn điệu của hình phạt:
phạt nhẹ và phạt rất nặng cho cùng kết quả). MATH chốt **một** trong hai ngữ nghĩa, đồng bộ FEAT
§6 + TECH §5.5:

- **(a) Sàn dương cho cử tri hợp lệ — hình phạt GIẢM dần, KHÔNG về 0.** Đặt
  `C3 = max(floor_3, base + điểm)` với `floor_3 > 0` nhỏ cho cử tri **chưa bị recall**. Hình phạt
  hạ `C3` (→ hạ VP do geometric, FEAT §2.4 "C3 sụp kéo VP sụp") nhưng **giữ phân biệt mức phạt**
  và không tự động khóa VP. Dùng khi muốn răn đe **tỷ lệ thuận** mức sai phạm.
- **(b) `C3 = 0` (→ VP=0) là hệ quả CỐ Ý của recall.** Khi cử tri **bị recall** (FEAT §6, hệ quả
  "giảm/khóa VP"), đặt `C3 = 0` **có chủ đích** → `VP=0` (khóa lực, vẫn giữ quyền tham gia). Đây
  KHÔNG phải mất thông tin mà là **hành động kỷ luật rời rạc** (bật/tắt), khác với phạt liên tục
  ở (a).

**Khuyến nghị MATH:** kết hợp — dùng (a) cho dao động uy tín thường ngày (giữ đơn điệu hình phạt),
dùng (b) **chỉ** khi recall chính thức đạt ngưỡng (FEAT §6.1, `≥2/3`). Ranh giới giữa "phạt liên
tục" và "khóa rời rạc" do **FEAT §6 + TECH §5.5** chốt; MATH chỉ ép: cơ số đưa vào (2) phải `≥0`,
và nếu chọn (a) thì `floor_3 > 0` để không nuốt thông tin mức phạt. Ghi §12 ràng buộc, §14 treo.

---

## 10. Mô hình chi phí thâu tóm = chi phí đóng góp thật (sybil / collusion)

Mục này định lượng nguyên lý CONTRACT §2.2–§2.4. Mục tiêu: chứng minh **không có đường tắt** —
chi phí để có `P` phần quyền lực tỷ lệ với chi phí đóng góp thật để tạo ra `P` phần đó.

### 10.1 Đặt bài toán tấn công (dùng ĐÚNG mẫu số `W(base)` của §8.2)

Kẻ tấn công muốn **thông qua** một quyết định (hoặc đối xứng: **phủ quyết**). Theo §8.2, thông qua
cần `W(S) ≥ θ · W(base)`, với `W(base)` là sức nặng phe **tham gia** của chính cuộc bỏ phiếu đó —
KHÔNG dùng công thức cũ `θ/(1−θ)·W_honest` (vốn suy từ mẫu số "kẻ tấn công + honest", mâu thuẫn
§8.2; nay bỏ).

Gọi `W_att = W(S ∩ kẻ-điều-khiển)` là VP kẻ tấn công tạo ra, `W_honest` là VP phe trung thực **tham
gia** và bỏ CHỐNG. Khi mọi phiếu tham gia chỉ thuộc hai phe này (`W(base) = W_att + W_honest`, tức
TRẮNG ngoài mẫu số — chọn FEAT §4.5), điều kiện thông qua `W_att ≥ θ·(W_att + W_honest)` tương
đương:

```
W_att  ≥  ( θ / (1 − θ) ) · W_honest .      (8a)
```

Lưu ý: hệ số `θ/(1−θ)` ở đây **suy ra TỪ** định nghĩa `W(base)` của §8.2 (không phải một ngưỡng
độc lập), vì mẫu số `W(base)` chứa **cả** `W_att`. Đây là điểm sửa so với bản cũ — cùng một mô hình
ngưỡng. Phủ quyết là phần bù (§8.2b): chặn cần `W_att > (1−θ)·W(base)`.

### 10.2 Trần một DID và số DID tối thiểu

Một DID có VP tối đa `VP_max = ∏_k cap_k^{w_k}` (§3). Từ (8a), số DID **người-thật** tối thiểu để
thông qua:

```
N_min  ≥  ⌈ ( θ / (1 − θ) ) · W_honest / VP_max ⌉ .      (8)
```

Riêng từ ràng buộc vốn (`C4` cap 100 triệu): muốn "dùng hết" `B` LAMP làm vốn bỏ phiếu cần
`B / cap_4` DID. Với `B = 12 tỷ`, `cap_4 = 100 triệu` → **120 DID** (khớp CONTRACT §2.3, suy trực
tiếp từ `cap_4`, không phụ thuộc tokenomics — §8.3).

### 10.3 Cận dưới chi phí tấn công — tách phần CHÌM và phần HOÀN LẠI

Mỗi DID, để `VP>0` (geometric), phải có **mọi** yếu tố `w_k>0` đều `>0`. Phân loại bản chất chi phí
từng yếu tố — đây là điểm cốt lõi: **không phải mọi yếu tố đều là chi phí chìm**:

| Yếu tố | Bản chất chi phí | Hoàn lại được? | Nén bằng tiền tức thì? |
|---|---|---|---|
| `C1` (MAGIC tiêu thụ, cửa sổ quá khứ) | **chìm + thời gian** — phải tiêu MAGIC qua nhiều epoch | KHÔNG | KHÔNG (cần thời gian thật) |
| `C2` (LAMP cam kết tương lai) | **khóa vốn** (cơ hội) — LAMP bị khóa trong ScheduleGen | một phần (khi mãn hạn) | một phần (mua bằng khóa LAMP) |
| `C3` (uy tín) | **thời gian + công nhận xã hội** | KHÔNG | KHÔNG (cộng đồng phải công nhận) |
| đốt LAMP | **chìm tuyệt đối** | KHÔNG | có tiền là đốt được, nhưng mất hẳn |
| `C4` (LAMP nắm giữ hiện tại) | **vốn HOÀN LẠI** — chỉ là chi phí cơ hội của khóa vốn trong cửa sổ snapshot | **CÓ** (rút ngay sau snapshot) | có (xem §10.6 flash-fill) |

**Định nghĩa `c_DID` (chi phí đạt `VP_max` cho một DID).** Tách hai phần:

```
c_DID  =  c_sunk  +  c_lock ,
   c_sunk = chi_phí_con_người + cost_C1(cap_1) + cost_C3(cap_3) + LAMP_đốt   (phần CHÌM, không hoàn lại)
   c_lock = chi_phí_cơ_hội( khóa LAMP cho C2 + khóa C4 tới cap trong cửa sổ snapshot )  (HOÀN LẠI)
```

trong đó `cost_k(cap_k)` là **chi phí biên thật** để đẩy yếu tố `k` tới trần `cap_k`.

**Bổ đề (cận dưới chi phí tấn công — phần định lượng được).** Vì geometric **cấm thay thế** (§5.3),
kẻ tấn công KHÔNG thể dồn tiền bù yếu tố thiếu (không mua `C3` bằng `C4`). Do đó mỗi DID phải trả
ĐỦ `c_DID`, và:

```
Cost_attack  ≥  N_min · c_sunk      (cận dưới CHẮC CHẮN — chỉ tính phần chìm)      (9a)
             ≈  N_min · c_DID       (xấp xỉ — gồm cả chi phí cơ hội khóa vốn)       (9b)
```

(9a) là **cận dưới chặt và an toàn**: ngay cả khi bỏ qua toàn bộ phần hoàn lại (`c_lock`, đặc biệt
`C4`), chi phí tấn công vẫn `≥ N_min · c_sunk`. Phần `c_sunk` chứa **C1 và C3 — hai yếu tố KHÔNG
nén được bằng tiền và cần thời gian thật** (xem §10.3b định lượng thời gian). Đây là phát biểu định
lượng của CONTRACT §2.2 "chi phí thâu tóm = chi phí đóng góp thật".

### 10.3b Định lượng phần KHÔNG nén được (C1, C3 cần thời gian)

Tách rõ vì sao `c_sunk` không nén được bằng tiền (mô hình thời-gian/chi-phí, tham số mở DAO định):

- **`C1` cần nhiều epoch.** `C1` đo MAGIC tiêu thụ trong **cửa sổ quá khứ ~18 epoch** (CONTRACT
  §1). Để đạt `cap_1` phải tiêu MAGIC **trải** qua cửa sổ đó — không thể dồn một epoch (nếu TECH
  đo theo phân bố thời gian, không chỉ tổng). Gọi `T_1 = ` số epoch tối thiểu để `C1` chạm
  `cap_1`. Một epoch Cardano ≈ 5 ngày ([Cardano docs — epoch](https://docs.cardano.org/about-cardano/learn/eras/));
  `T_1` là **độ trễ không mua tắt được**. → mọi tấn công chịu trễ ≥ `T_1` epoch.
- **`C3` cần công nhận xã hội qua thời gian.** Uy tín chỉ tăng khi cộng đồng ghi nhận quyết định
  đúng qua nhiều vòng (FEAT §2.4). Gọi `T_3 = ` số epoch tối thiểu để `C3` chạm `cap_3`. Không có
  giao dịch nào mua thẳng `C3` (TECH §5.5 — registry cập nhật phi tập trung). → trễ ≥ `T_3` epoch.
- **Hệ quả thời gian.** Tấn công cần `N_min` DID, mỗi DID chịu trễ tích lũy `≥ max(T_1, T_3)`
  epoch **trước khi** có `VP>0`. Trong cửa sổ đó hành vi tích lũy đồng loạt của `N_min` DID là
  **lộ thiên on-chain** (§10.4) → cộng đồng có thời gian phát hiện + phản ứng. `T_1, T_3` là
  **tham số mở (DAO định)** qua `cap_1, cap_3` và độ dài cửa sổ; MATH chốt rằng chúng `> 0` và
  KHÔNG nén được bằng vốn.

> Mức tuyên bố: §10.3 + §10.3b là **lập luận cấu trúc + cận dưới định lượng phần chìm** (9a), KHÔNG
> phải "định lý khép kín" định lượng trọn `c_DID` (vì `cost_k(cap_k)` và `T_k` là tham số mở DAO
> định). Đã hạ khỏi từ "định lý" để không phóng đại — xem §10.7 và "Phản hồi audit" finding #4.

### 10.4 Vì sao collusion (thuê 120 người vote hộ) không phải lỗ hổng

Hai lớp, theo CONTRACT §2.2:
1. **Để 120 người đó có VP>0**, kẻ thuê vẫn phải khiến mỗi người **đóng góp thật** (lịch sử, uy
   tín, đốt LAMP) — tức vẫn trả đủ `c_DID` mỗi người. Thuê người không bỏ qua được chi phí đóng
   góp; nó chỉ chuyển ai trả.
2. **Lộ thiên on-chain:** 120 DID cùng phục vụ một thực thể để lại dấu vết tương quan (cùng nguồn
   LAMP nạp, cùng nhịp vote) — cộng đồng phát hiện và phản ứng (recall, xem FEAT). Và đối thủ
   cũng **huy động được người** đối trọng. → Không có ưu thế chi phí bất đối xứng.

### 10.5 Tấn công flash / snapshot lên `C4` — vì sao `C4` KHÔNG vào cận dưới chi phí chìm

Đây là điểm first-principles bản cũ **im lặng**. TECH §5.4 (v1) đọc `C4` qua **reference input ví +
snapshot tại epoch mở proposal**. Hệ quả: `C4` chỉ là ảnh chụp **một thời điểm**, KHÔNG đo việc giữ
ổn định.

**Vector tấn công flash-fill.** Kẻ tấn công có thể **mượn** (flash-borrow) hoặc **dồn** LAMP vào
nhiều ví (mỗi ví gắn một DID) **ngay trước** mốc snapshot để đẩy `C4` tới `cap_4 = 100 triệu` cho
nhiều DID cùng lúc, rồi **rút LAMP ra ngay sau** snapshot. Vì `C4` hoàn lại được (§10.3 bảng), chi
phí thực của bước này **không** phải `cap_4` LAMP cho mỗi DID — chỉ là **chi phí cơ hội** của việc
khóa vốn trong **một cửa sổ snapshot ngắn** (cộng phí vay flash nếu mượn). Do đó:

- Tính `cost_C4(cap_4) = cap_4` LAMP vào `c_DID` như bản cũ là **quá lạc quan** — nó coi vốn hoàn
  lại như chi phí chìm. Bản sửa: `C4` chỉ vào `c_lock` (hoàn lại), KHÔNG vào cận dưới chắc chắn
  `c_sunk` (9a).
- **Nhưng** `C4` đơn độc KHÔNG đủ thắng: vì geometric, `VP>0` còn cần `C1,C2,C3 > 0` — mà
  `C1,C3` không flash được (§10.3b, cần thời gian). Flash-fill chỉ tối đa hóa **một** thừa số; ba
  thừa số kia vẫn chặn. Đây là lý do cap+geometric vẫn đứng dù `C4` bị flash.

**Yêu cầu ràng buộc sang TECH/FEAT (MATH nêu, hai spec kia ép).** Để `cap_4` không bị flash-fill
vô hiệu:

1. **Đo `C4` trên cửa sổ giữ ổn định**, KHÔNG snapshot tức thời: vd `C4 = min` (hoặc trung bình)
   số LAMP giữ qua **N epoch** liên tục, hoặc yêu cầu **khóa** LAMP một số epoch để được tính. Cận
   dưới đúng khi đó là chi phí cơ hội khóa qua **N epoch** thật, không phải một mốc.
2. Nếu TECH giữ snapshot một-mốc cho v1 (đơn giản, ít UTxO), MATH cảnh báo rõ: **`C4` phần này là
   vốn hoàn lại** → đừng tính vào lập luận "chi phí chìm cao"; sức mạnh chống thâu tóm dồn vào
   `C1,C3` (thời gian) + đốt LAMP (chìm), KHÔNG vào `C4`.

`N` (độ dài cửa sổ ổn định cho `C4`) là **tham số mở (DAO định)**; MATH chốt rằng đo một-mốc thì
`C4` không đóng góp vào cận dưới chi phí chìm.

### 10.6 Ví dụ số minh họa (dùng ĐÚNG mẫu số `W(base)` của §8.2 — KHÔNG dùng "tổng")

Giả sử (chỉ minh họa, KHÔNG phụ thuộc tokenomics 36/24 tỷ — §8.3b) `VP_max` chuẩn hóa = 1; trong
một cuộc bỏ phiếu, phe trung thực **tham gia và chống** có `W_honest = 1000` đơn vị VP. Kẻ tấn công
muốn **thông qua** với `θ = 2/3`, mẫu số `W(base) = W_att + W_honest` (TRẮNG ngoài mẫu số). Theo
(8a): cần `W_att ≥ (θ/(1−θ))·W_honest = (2/3 ÷ 1/3)·1000 = 2·1000 = 2000`. Với mỗi DID tối đa VP=1
→ cần **≥ 2000 DID người-thật** đạt `VP_max`.

Đối xứng, muốn **phủ quyết** một đề xuất `θ=2/3` (chặn để đối phương không đạt): theo §8.2b cần
`W_att > (1−θ)·W(base) = 1/3·W(base)`. Nếu phe thuận trung thực có `1000`, thì
`W(base)=W_att+1000`, giải `W_att > 1/3(W_att+1000)` → `W_att > 500` → cần **> 500 DID** đạt
`VP_max`. (Lưu ý: con số phụ thuộc mẫu số `W(base)` của §8.2 — KHÔNG dùng "tổng toàn cử tri" như
bản cũ.)

Mỗi DID đòi lịch sử nhiều epoch (`C1`) + uy tín (`C3`) + đốt LAMP → chi phí **thời gian** (không
rút ngắn bằng tiền, §10.3b) làm tấn công **chậm và lộ**. So với token-weighted (mua token là phủ
quyết tức thì), mô hình này nâng chi phí từ "một giao dịch mua token" lên "hàng trăm–nghìn con
người thật, nhiều epoch, không mua tắt". ∎

### 10.7 Mức độ tuyên bố — lập luận cấu trúc, không phải định lý khép kín

Tóm tắt phạm vi chứng minh §10 (để không phóng đại):

- **Đã định lượng:** số DID tối thiểu `N_min` (8), cận dưới chi phí chìm `Cost_attack ≥ N_min·c_sunk`
  (9a), và phần KHÔNG nén được bằng tiền (`C1,C3` cần `T_1,T_3` epoch, §10.3b).
- **Phụ thuộc tham số mở DAO:** giá trị tuyệt đối `cost_k(cap_k)`, `T_k`, `c_sunk` — MATH chốt
  *hình thức* và *dấu* (`>0`, không nén được), không chốt con số.
- **Là "lập luận cấu trúc", KHÔNG là "định lý" theo nghĩa chứng minh khép kín** một bất đẳng thức
  số tuyệt đối. Đã đổi nhãn từ "định lý không đường tắt" (bản cũ) sang **mệnh đề cấu trúc + bổ đề
  cận dưới** để dùng từ "định lý" nhất quán với §3/§4/§5 (nơi có chứng minh đầy đủ).

---

## 11. Ổn định số học (tránh tràn, tránh mất chính xác)

### 11.1 Vấn đề

Cài (2) trực tiếp dễ **tràn** (overflow) vì tích các lũy thừa số lớn (cap tới hàng trăm triệu),
và mũ thực `w_k` không nguyên. On-chain Cardano/Aiken làm **số nguyên** — không có dấu phẩy động
gốc. Tài liệu Aiken: <https://aiken-lang.org/language-tour/primitive-types#int> (Int là số nguyên
độ dài tùy ý; không có float gốc).

### 11.2 Hướng cài đặt — log-sum (dạng (3))

Thay vì tính tích, tính **tổng log** rồi so sánh:

```
L_i = Σ_k  w_k · ln( x_{k,i} ).      (3 lặp lại)
```

So sánh hai cử tri / cộng VP một phe **chỉ cần thứ tự**, mà `ln` đơn điệu nên so sánh trên `L_i`
tương đương so sánh trên `VP_i` (cho phép so sánh từng-cặp). **Lưu ý quan trọng:** cộng VP một
phe (6) là cộng `VP_i` (không cộng `L_i`!) → vẫn cần khôi phục `exp(L_i)` khi gom phe. Do đó:

- **So sánh hai cá nhân** (vd xếp hạng): dùng `L_i` trực tiếp — không cần exp, không tràn.
- **Tổng VP một phe** (7): cần giá trị `VP_i = exp(L_i)`; dùng **số nguyên thang cố định**
  (fixed-point): biểu diễn `VP_i` ở đơn vị nhỏ (vd 10^−9), tính `exp` qua bảng/khai triển trên
  số nguyên. TECH chốt độ chính xác fixed-point và thuật toán `ln`/`exp` nguyên.

### 11.3 Mẹo log-sum-exp khi cộng phe (tránh tràn ở bước exp)

Khi cộng `Σ_i exp(L_i)`, rút thừa số lớn nhất `L* = max_i L_i`:

```
Σ_i exp(L_i) = exp(L*) · Σ_i exp(L_i − L*) .      (10)
```

Mọi `L_i − L* ≤ 0` → `exp(·) ∈ (0,1]` → không tràn ở tổng; chỉ một thừa số `exp(L*)` chung. So
sánh ngưỡng `W(S) ≥ θ·W(base)` (§8.2) chia cho thừa số chung → có thể so trên thang đã rút. Kỹ thuật
chuẩn: <https://en.wikipedia.org/wiki/LogSumExp> (log-sum-exp, ổn định số). TECH quyết có cần
exp hay so sánh tỷ lệ trực tiếp trên miền log.

### 11.4 Xử lý `ln(0)`

`x_{k,i}=0` → `ln(0)=−∞`. Cài đặt: gắn cờ "VP=0" cho cử tri đó (nhánh biên §9.2), bỏ khỏi tổng
log; cử tri VP=0 đóng góp 0 vào (6), loại sạch khỏi mọi phép cộng phe.

### 11.5 Cố định thang
TECH phải cố định: đơn vị fixed-point, cách xấp xỉ `ln`/`exp` nguyên, độ chính xác (số bit phân
số), và **kiểm thử so khớp** với tính chính xác (so VP_int với VP_float trong dải sai số). Ghi
§12.

---

## 12. Tham số mở (DAO định) và BẤT BIẾN CỨNG (mọi spec phải ép)

### 12.1 Tham số mở

| Ký hiệu | Ý nghĩa | Ràng buộc MATH bắt buộc | Đã chốt? |
|---|---|---|---|
| `cap_1, cap_2, cap_3` | trần C1/C2/C3 | `> 0` | **mở** |
| `cap_4` | trần C4 (LAMP nắm giữ) | `> 0` | **= 100 triệu** (CONTRACT) |
| `w_k` | trọng số mỗi yếu tố | `≥ 0`; khuyến nghị `∈(0,1]` (§6); cố định **một** chuẩn hóa, khuyến nghị `Σw_k=1` (§7) | **mở** |
| Độ dài cửa sổ C1 | ~18 epoch (gợi ý CONTRACT) | cửa sổ quá khứ cố định; định `T_1>0` (§10.3b) | **mở** (gợi ý 18) |
| Độ dài cửa sổ C2 | ~24 epoch (gợi ý CONTRACT) | cửa sổ tương lai cố định | **mở** (gợi ý 24) |
| `N` (cửa sổ ổn định C4) | số epoch giữ ổn định để tính C4 (chống flash-fill §10.5) | `≥ 1`; nếu đo một-mốc thì C4 KHÔNG vào cận dưới chìm | **mở** → TECH chốt |
| `θ` (ngưỡng siêu đa số) | phần VP cần để thông qua | `∈(1/2,1]`; dùng `≥`; mẫu số = `W(base)` phe tham gia (§8.2) | **mở** (gợi ý 2/3 hiến chương) |
| Mẫu số `W(base)` | xử lý TRẮNG | `W(S)+W(O)` hoặc `W(P)` (§8.2, FEAT §4.5) | **mở** → DAO/FEAT |
| `q` (quorum) | sàn VP tham gia | `≥ 0`; cổng độc lập với θ (§8.2) | **mở** |
| `K` | số yếu tố | `≥ 4` (CONTRACT) | mở để tăng |
| `floor_k` (tùy chọn) | sàn dương bootstrap (§9.2) | `≥ 0`; mặc định 0 | **mở** (mặc định tắt) |
| `floor_3` | sàn uy tín cho cử tri hợp lệ (§9.4 phương án a) | `> 0` nếu chọn (a) để giữ đơn điệu phạt | **mở** → FEAT/TECH |
| Thang fixed-point, thuật toán `ln`/`exp` nguyên | ổn định số học | so khớp sai số với chính xác | **mở** → TECH chốt |

**Khuyến nghị MATH (không ép, để DAO cân nhắc):** `Σw_k = 1`; `w_k∈(0,1]`; `θ=2/3` với `≥` cho
quyết định hiến chương; đo `C4` trên cửa sổ ổn định `N≥1` (không một-mốc) nếu muốn `C4` góp vào
chi phí chìm.

### 12.2 Bất biến CỨNG (KHÔNG phải khuyến nghị — mọi spec phải thực thi)

**I-1 (Khóa chuẩn hóa weight trong một kỳ governance).** Một chuẩn hóa weight (khuyến nghị
`Σw_k=1`) **PHẢI** được cố định và **khóa trong toàn bộ một kỳ governance**. Mọi đề xuất đổi weight
(hoặc đổi chuẩn hóa) chỉ có hiệu lực cho proposal mở **SAU** khi đổi; **KHÔNG hồi tố** lên proposal
đang chạy. Lý do: §7.3 — co giãn/đổi weight không bảo toàn tỷ lệ tổng `Σ VP` giữa hai phe nên có
thể **lật** kết quả vote tổng (vector thao túng). Thực thi ba lớp: **TECH §5.6** (`weight_param_ref`
trỏ bảng weight lúc Proposal Open, mọi phiếu dùng đúng bảng đó), **FEAT §3.1 + §10 câu 4** (ngưỡng
+ weight cố định theo loại quyết định / theo kỳ), **MATH §7.3 + I-1** (cơ sở toán). Không spec nào
được nới bất biến này.

**I-2 (Cơ số phép mũ luôn `≥0`).** Mọi `x_{k,i}` đưa vào (2) phải `≥ 0` (§9.4). Đặc biệt `C3` sau
phạt: nếu chọn phương án sàn (§9.4-a) thì `floor_3 > 0`; nếu chọn khóa-recall (§9.4-b) thì `C3=0`
là **cố ý**. Một chuẩn hóa ngữ nghĩa C3-âm phải nhất quán giữa MATH §9.4 ↔ FEAT §6 ↔ TECH §5.5.

**I-3 (Mẫu số ngưỡng thống nhất).** Mọi tỷ lệ thông qua / phủ quyết dùng **cùng một mẫu số**
`W(base)` của §8.2 (phe tham gia), KHÔNG trộn "tổng toàn cử tri" với "tham gia". Quorum (7a) là
cổng **độc lập**, không gộp vào ngưỡng (7b).

---

## 13. Phụ thuộc

- **CONTRACT.md** (file này bám sát; không mâu thuẫn §1, §2, §3).
- **PhoenixKey DID sinh trắc + zk-proof "1 DID = 1 người"** — *blocker tiên quyết*. MATH giả định
  mỗi `i` ứng đúng một người thật; nếu DID không bảo đảm 1-người-1-DID thì mô hình chi phí §10 sụp
  (sybil rẻ). Thuộc backend PhoenixKey, ngoài repo LAMP (CONTRACT §3).
- **TECH** — đo `C1,C2,C4` (cross-repo MAGIC + LAMP qua reference input), chốt fixed-point,
  thuật toán `ln`/`exp` nguyên, datum/redeemer, chống double-vote.
- **FEAT** — vòng đời tập sự, định nghĩa các loại quyết định gắn `θ` khác nhau, recall, gom phiếu.
- **EXEC** — bootstrap (xử lý §9.2: cả hệ VP=0 lúc chưa có uy tín → bật `w_3` dần hoặc floor tạm).
- **Tokenomics / Foundation-Bootstrap** — **[cần verify]** tổng cung 36 tỷ và phân bổ Cộng đồng
  24 tỷ (2/3) — CHỈ ảnh hưởng khối minh họa §8.3b. Con số `12 tỷ` (gốc CONTRACT §2.3) và kết quả
  "12 tỷ → 120 DID" (§8.3) KHÔNG phụ thuộc xác nhận này (chỉ dựa `cap_4`).

---

## 14. Câu hỏi còn treo

1. **Bootstrap uy tín:** giai đoạn đầu chưa cử tri nào có `C3>0` → toàn hệ VP=0 (§9.2). Chọn
   (a) tắt `w_3` rồi bật dần, hay (b) floor tạm? Đánh đổi an toàn vs hoạt động được. **DAO/EXEC.**
2. **Độ co giãn thay thế:** giữ geometric (`p=0`, `σ=1`) hay cho DAO chọn trung bình lũy thừa
   **bậc âm** (`p<0`, tương ứng `σ<1`, chống thay thế mạnh hơn)? (§5.5). Đánh đổi: `p<0` an toàn
   hơn nhưng `ln`/`exp` nguyên phức tạp hơn.
3. **Fixed-point `exp` on-chain:** có thực sự cần khôi phục `exp(L_i)` để cộng phe (§11.2) không,
   hay TECH đổi cách gom phiếu để chỉ làm trên miền log? Ảnh hưởng ExUnit. **TECH.**
4. **Khóa weight trong kỳ (Bất biến I-1, §12.2):** đã nâng thành **bất biến cứng**. Câu treo còn
   lại: ranh giới "một kỳ governance" định nghĩa thế nào (theo epoch? theo proposal?) để TECH §5.6
   + FEAT §10 câu 4 thực thi nhất quán. **FEAT/EXEC/TECH.**
5. **`C2` mua một phần bằng tiền** (khóa LAMP): vì geometric vẫn cần các yếu tố khác, nhưng cần
   định lượng `cap_2` đủ thấp để khóa LAMP không thành đòn bẩy power. **DAO định cap_2.**
6. **Xác nhận tokenomics 36 tỷ / 24 tỷ** với file canonical (Foundation-Bootstrap / SPEC). CHỈ
   ảnh hưởng khối minh họa §8.3b; §8.3 ("12 tỷ → 120 DID") độc lập với việc này (chỉ dựa `cap_4`).
7. **Cửa sổ ổn định `C4` (`N` epoch) chống flash-fill (§10.5):** TECH chốt v1 dùng snapshot
   một-mốc (đơn giản) hay đo `C4` qua `N` epoch / yêu cầu khóa? Nếu một-mốc, MATH ép `C4` không
   vào cận dưới chi phí chìm. **TECH/DAO.**
8. **Ngữ nghĩa `C3` sau phạt (§9.4):** chọn (a) sàn `floor_3>0` giữ đơn điệu phạt, hay (b) `C3=0`
   khi recall (khóa VP)? Đồng bộ MATH §9.4 ↔ FEAT §6 ↔ TECH §5.5. **FEAT/TECH.**

---

## 15. Phản hồi audit (truy vết sửa theo từng finding)

Vòng audit 2026-06-05 nêu 9 finding; xử lý như sau (đánh số trùng audit):

1. **[major, đã sửa]** Mâu thuẫn mô hình ngưỡng §8.2 ↔ §10.1 ↔ §10.5. Đã CHỐT một mô hình duy nhất
   ở **§8.2**: thông qua khi `W(S) ≥ θ·W(base)` với mẫu số `W(base)` = phe **tham gia** (TRẮNG
   xử lý theo FEAT §4.5), kèm **quorum (7a)** là cổng độc lập. Viết lại §10.1: hệ số `θ/(1−θ)` nay
   **suy ra TỪ** `W(base)` (không phải ngưỡng độc lập). Thêm **§8.2b**: phủ quyết là **phần bù**
   của thông qua, thống nhất dấu (`≥` thông qua / `>` phủ quyết, loại trừ lẫn nhau tại biên). §10.6
   ví dụ số nay dùng đúng `W(base)`, bỏ phát biểu cũ "θ=1/3 cần >1/3 tổng".
2. **[major, đã sửa]** §5.5. Bỏ chữ "biên dưới" (SAI). Viết lại: geometric = power mean tại **p=0**,
   nằm **giữa** dải (link `#Special_cases`). Tách rõ **hai trục**: bậc power-mean `p` vs CES
   elasticity `σ` (quan hệ `ρ=1−1/σ`), gắn link CES + Cobb–Douglas riêng, không gộp với
   Generalized_mean.
3. **[major, đã sửa]** §7.3 nâng từ ghi chú lên **Bất biến cứng I-1 (§12.2)**: khóa chuẩn hóa
   weight toàn kỳ, đổi weight chỉ hiệu lực cho proposal mở sau, không hồi tố. Liên kết tường minh
   TECH §5.6 + FEAT §10 câu 4 + MATH §7.3. (Ghi chú anchor: xem mục cuối phần này.)
4. **[major, đã sửa một phần + hạ tuyên bố]** §10.3 thêm **bổ đề cận dưới định lượng** tách
   `c_DID = c_sunk + c_lock`, cận dưới chắc chắn `Cost_attack ≥ N_min·c_sunk` (9a); §10.3b định
   lượng phần KHÔNG nén được (`C1,C3` cần `T_1,T_3` epoch, mô hình thời-gian). Vì `cost_k(cap_k)`,
   `T_k` là tham số mở DAO, KHÔNG thể chốt một bất đẳng thức số tuyệt đối → đã **hạ nhãn** "định lý"
   xuống "mệnh đề cấu trúc + bổ đề cận dưới" (§10.7), dùng từ "định lý" nhất quán với §3/§4/§5.
5. **[major, đã sửa]** Thêm **§10.5** mô hình flash/snapshot lên `C4`: tách `C4` là **vốn HOÀN
   LẠI** (không chìm) → chỉ vào `c_lock`, KHÔNG vào cận dưới chìm (9a); chỉ tính chi phí cơ hội
   khóa trong cửa sổ snapshot. Nêu **yêu cầu sang TECH/FEAT**: đo `C4` trên cửa sổ ổn định `N`
   epoch / yêu cầu khóa, KHÔNG snapshot tức thời. Thêm tham số `N` (§12.1) + câu treo §14 câu 7.
6. **[minor, đã sửa]** §8.3 tách bạch: giữ "12 tỷ → 120 DID" (chỉ dựa `cap_4`, không cần
   tokenomics); cô lập "36 tỷ / 24 tỷ" thành khối **§8.3b [cần verify]** với cảnh báo phụ thuộc;
   §10.6 không còn phụ thuộc con số đó. §14 câu 6 + §13 cập nhật phạm vi ảnh hưởng.
7. **[minor, đã sửa]** §9.4 đặc tả ngữ nghĩa `C3` sau phạt: phương án (a) sàn `floor_3>0` giữ đơn
   điệu hình phạt, hoặc (b) `C3=0` là hệ quả CỐ Ý của recall (khóa VP). Chốt: cơ số `≥0` (Bất biến
   I-2), đồng bộ FEAT §6 + TECH §5.5; thêm câu treo §14 câu 8.
8. **[minor, đã sửa]** §6 đổi tiêu đề thành "Lợi suất biên giảm dần (lõm theo biến gốc khi
   `w_k<1`)"; bỏ câu "log-lõm? không hẳn" gây nhiễu, chuyển thành ghi chú ngắn (tuyến tính theo
   `ln x_k` → không cho lợi suất giảm; tính giảm dần chỉ theo biến gốc `x_k`).
9. **[nit, đã rà]** Phân biệt "định lý" (có chứng minh) vs "quy ước/mệnh đề": §1.4 `0^0=1` là
   **quy ước** (giữ nguyên — đã đúng); §10.3 "định lý không đường tắt" hạ xuống "mệnh đề cấu trúc"
   (trùng finding #4). Các mục §3/§4/§5 giữ "định lý" vì có chứng minh đầy đủ.

**Ghi chú anchor (không phải bất đồng, chỉ chỉnh dẫn chiếu cho đúng):** finding #3 đề nghị trỏ
"FEAT §10 câu 4 (khóa weight trong kỳ)". Khi đối chiếu file FEAT thực tế, **FEAT §10 câu 4** hiện
nói về quy trình đổi **cap C4** (hai vòng bỏ phiếu), KHÔNG phải khóa weight; câu treo về snapshot/
khóa luật giữa chừng nằm rải ở FEAT §4.4 + §10 câu 2. Bất biến khóa-weight được neo chắc nhất vào
**TECH §5.6** (`weight_param_ref` khóa bảng weight theo proposal). MATH giữ dẫn chiếu tới TECH §5.6
làm trụ, và ghi FEAT §10 câu 4 như điểm cần FEAT bổ sung mục "khóa weight trong kỳ" cho khớp I-1.
→ Đề nghị FEAT thêm một câu treo riêng cho khóa-weight để ba spec khớp tường minh (KHÔNG phải lỗi
MATH, là việc đồng bộ liên-spec).

---

*Hết MATH. Phần TECH sẽ chốt cách đo C_k, fixed-point, thuật toán số nguyên cho ln/exp, và
datum/redeemer on-chain.*
