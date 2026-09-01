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
- Vì sao **NHÂN** (geometric) chứ không **CỘNG** (additive) — chứng minh additive cho phép **bỏ
  hẳn** một yếu tố mà vẫn đạt `1 − w_3/Σw` (= 3/4 khi weight đều), geometric thì một yếu tố thấp
  kéo sụp tất cả. Đây là mệnh đề về **thay thế**, không phải về "mua được bằng tiền" — xem §5.2.
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

### 5.2 Định lý "bỏ uy tín vẫn đạt 3/4" — additive vỡ vì cho THAY THẾ

**Phát biểu.** Với mô hình additive, một kẻ tấn công **bỏ hẳn** yếu tố khó mua nhất (giả sử
`C3` = uy tín) vẫn đạt tỷ lệ VP

```
VP^{add} / VP^{add}_max  =  1 − w_3 / Σ_k w_k
```

của trần. Nếu `w_3` chỉ là một phần tư tổng trọng số thì kẻ tấn công mua 3 yếu tố còn lại tới
trần vẫn đạt **3/4 quyền lực tối đa** mà **không cần một chút uy tín nào**.

**Chứng minh.** Đặt `ŷ_3 = 0` (bỏ uy tín), `ŷ_k = 1` cho `k≠3` (mua tới trần). Khi đó
`VP^{add} = Σ_{k≠3} w_k = (Σ_k w_k) − w_3`. Chia cho `VP^{add}_max = Σ_k w_k`. ∎

→ Additive cho phép **thay thế** (substitution) hoàn toàn giữa các yếu tố: uy tín (`C3`) trở nên
**không bắt buộc**, và phần `1 − w_3/Σw` vẫn đạt được. Đó là lỗ hổng, và nó **không** phụ thuộc
vào việc yếu tố nào mua được — chỉ cần chúng thay thế nhau.

Đó **đủ** để bác additive, và đừng thêm gì nữa vào đây. Cụ thể **đừng nhập D8**: D8 là bất biến của
mô hình **geometric** đang triển khai, còn mục này đang bác mô hình **additive**. Nhập vào thì vô
tình *cứu* chính con rơm ("additive thì tiền cũng chỉ mua được một nửa") — làm yếu đúng lập luận
mục này cần.

Và con số `(w_2+w_4)/Σw ≤ 1/2` suy từ D8 là chặn trên **ĐỘ CO GIÃN BIÊN** (§6B.3), **không** phải
chặn trên phần quyền lực đạt được. Ở geometric, kẻ chỉ có tiền (`C1 = C3 = 0`) được `VP = **0**`,
không phải một nửa. Mang "1/2" sang geometric là **đánh giá THẤP** mức bảo vệ thật. Đây đúng là
cảnh báo trong CONTRACT §1.

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
giảm tốc tích tụ**. Khuyến nghị nằm trong §12.1 (tham số mở), không ép.

---

## 6B. Ràng buộc weight chống đòn bẩy mua-bằng-tiền (BẤT BIẾN — D8)

### 6B.1 Phát biểu — ràng buộc cứng trên tổng weight

Phân loại bốn yếu tố theo **có mua được bằng tiền tức thì hay không** (CONTRACT §1 cột "Mua bằng
tiền?", §10.3 bảng bản chất chi phí):

- **Yếu tố cần-thời-gian (không nén bằng tiền):** `C1` (MAGIC tiêu thụ qua ~18 epoch quá khứ),
  `C3` (uy tín — công nhận xã hội qua thời gian). Gọi nhóm `TIME = {1, 3}`.
- **Yếu tố mua-được-bằng-tiền (nén bằng vốn):** `C2` (khóa LAMP cam kết tương lai), `C4` (LAMP nắm
  giữ hiện tại). Gọi nhóm `MONEY = {2, 4}`.

CONTRACT D8 ghim **ràng buộc cứng** (KHÔNG phải khuyến nghị) lên trọng số:

```
w_2 + w_4  ≤  w_1 + w_3 .      (W1)   [tổng weight nhóm MONEY ≤ tổng weight nhóm TIME]
```

Mọi bảng weight DAO duyệt PHẢI thỏa (W1); bảng vi phạm là **không hợp lệ**, validator tham số từ
chối (TECH ép lúc nạp bảng weight). Tổng quát `K>4`: `Σ_{k∈MONEY} w_k ≤ Σ_{k∈TIME} w_k`, với việc
phân loại mỗi yếu tố mới vào `MONEY`/`TIME` do DAO định khi thêm yếu tố.

### 6B.2 Vì sao (W1) — chặn đòn bẩy mua quyền lực (first-principles)

Geometric (§5) đã cấm **thay thế hoàn toàn** (thiếu một yếu tố là sụp). Nhưng nó KHÔNG tự giới hạn
**ảnh hưởng biên tương đối** của nhóm mua-được-bằng-tiền: từ dạng log (3),
`∂ ln VP / ∂ ln x_k = w_k` — weight chính là **độ co giãn** của VP theo từng yếu tố. Nếu DAO (vô
tình hoặc bị phe vốn chi phối) đặt `w_2, w_4` lớn so với `w_1, w_3`, thì một kẻ có vốn — dù vẫn
phải vượt qua sàn dương `C1,C3>0` (rẻ, chỉ cần chạm mốc tối thiểu) — có thể **đẩy VP lên nhanh**
chủ yếu bằng `C2,C4` (khóa + giữ LAMP), biến tiền thành đòn bẩy power **trong vùng các yếu tố thời
gian chỉ vừa đủ dương**. (W1) chặn kịch bản đó: tổng độ co giãn theo nhóm mua-được-bằng-tiền không
bao giờ vượt tổng độ co giãn theo nhóm cần-thời-gian → **biên kéo VP của tiền ≤ biên kéo VP của
thời gian/uy tín**. Đây là phát biểu định lượng của CONTRACT §2.2 ("không có đường tắt") **ở tầng
trọng số**, bổ trợ cho cap (§3) ở tầng giá trị và geometric (§5) ở tầng dạng hàm.

### 6B.3 Hệ quả

- **Trần đòn bẩy vốn.** Tỷ lệ ảnh hưởng nhóm MONEY trên tổng: `(w_2+w_4)/Σw_k ≤ 1/2` (chia (W1) cho
  `Σw_k = (w_1+w_3)+(w_2+w_4)`). Vốn KHÔNG bao giờ chiếm quá nửa độ co giãn VP, dù DAO chỉnh thế nào.
- **Kết hợp bốn lớp.** (W1) [tầng weight] + cap C4 100 triệu [tầng giá trị, §3] + geometric [tầng dạng,
  §5] + clamp BFT [tầng tally, §8B] = bốn lớp độc lập cùng chặn "tiền → quyền lực". Mỗi lớp đóng một
  vector khác nhau; (W1) đóng vector "DAO bị phe vốn dụ nâng weight nhóm MONEY".
- **C2 phải là chi-phí-thời-gian, không phải khóa-tức-thì** — xem §6B.4 (ràng buộc đo C2).

### 6B.4 C2 chỉ tính nếu LAMP ĐÃ KHÓA qua đủ N epoch (biến C2 thành chi-phí-thời-gian)

(W1) xếp `C2` vào nhóm MONEY (mua được một phần bằng khóa LAMP). Để (W1) đủ chặt, D8 thêm ràng buộc
**đo C2**: `C2` của một cử tri **chỉ được tính dương** nếu lượng LAMP cam kết đã **khóa thật** trong
ScheduleGen và **duy trì khóa qua ít nhất `N_2` epoch tương lai** (cửa sổ cam kết, CONTRACT §1
~24 epoch). Khóa tức-thời (khóa rồi rút ngay) **KHÔNG** sinh `C2`:

```
C2_i  =  ( LAMP cam kết trong ScheduleGen )  NẾU khóa duy trì ≥ N_2 epoch ;
         0                                   NẾU không (khóa tức-thời / chưa đủ N_2 epoch).      (W2)
```

**Lý do (first-principles).** Nếu `C2` tính ngay khi khóa, kẻ có vốn khóa LAMP một mốc để bơm `C2`
rồi rút — y hệt flash-fill của `C4` (§10.5), biến `C2` thành **vốn hoàn lại tức thì** chứ không phải
**chi-phí-cơ-hội-thời-gian**. Ràng buộc (W2) biến `C2` thành **chi phí khóa vốn qua `N_2` epoch
thật** — cùng bản chất "trễ thời gian không mua tắt được" như `C1` (§10.3b). Khi đó, dù `C2∈MONEY`
trong (W1), phần "mua bằng tiền" của nó đã mang **thành tố thời gian** (khóa `N_2` epoch), nên đòn
bẩy vốn yếu hơn nhiều so với mua tức thời. `N_2` là **tham số mở (DAO định)**, ràng buộc `N_2 ≥ 1`
(gợi ý theo cửa sổ ~24 epoch CONTRACT §1); MATH chốt rằng `C2` đo **trên cửa sổ khóa**, KHÔNG đo
khóa-một-mốc. TECH ép (W2) khi đọc beacon C2 từ MAGIC (CONTRACT D9: beacon C2 nhúng `did_commit` +
mốc khóa để kiểm thời hạn khóa byte-perfect on-chain).

> Quan hệ với §10.3 bảng bản chất chi phí: với (W2), `C2` chuyển từ "khóa vốn hoàn lại **một phần,
> tức thời**" sang "khóa vốn qua `N_2` epoch" — phần chi phí cơ hội `c_lock` của `C2` nay gắn **độ
> dài khóa thật**, không còn nén về một mốc. Cùng với `C4` đo trên cửa sổ ổn định (§10.5), cả hai
> yếu tố MONEY đều mang thành tố thời gian khi đo đúng.

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

## 8B. Clamp BFT khi kiểm phiếu — sàn phi tập trung Byzantine (nguyên lý 5)

Mục này đặc tả toán cho **CONTRACT §2 nguyên lý 5** ("sàn phi tập trung Byzantine"). Cap mỗi yếu tố
(§3) chỉ chặn **một** cá nhân tích tụ qua **một** trục đóng góp; nó KHÔNG chặn một **nhóm nhỏ** DID
hợp lệ (mỗi DID `VP_i` cao) gộp lại chiếm đa số. Nguyên lý 5 thêm một **clamp ở tầng tally** (giữa
các cử tri), bổ trợ cho cap ở tầng cá nhân (bên trong một cử tri). Hai tầng độc lập: cap (§3) áp
**bên trong** công thức (2); clamp (§8B) áp **sau** khi đã có `VP_i`, lúc gom phe (6).

### 8B.1 Định nghĩa hình thức — VP hiệu dụng (effective VP)

Đặt `F = BFT_FLOOR` là **sàn Byzantine** (tham số DAO định, mặc định `F = 21`). Gọi tổng VP thô của
phe **tham gia** `P` là `ΣVP = W(P) = Σ_{i∈P} VP_i` (6). Trần một-DID khi tally:

```
τ = ΣVP / F .      (11)   [τ = "ceiling" một DID, theo phe tham gia P]
```

VP **hiệu dụng** của mỗi cử tri là VP thô bị kẹp trần `τ`:

```
VP_eff_i = min( VP_i , ΣVP / F ) = min( VP_i , τ ) .      (12)
```

Mọi sức nặng phe ở §8 (7a, 7b, 8.2b) khi áp nguyên lý 5 **dùng `VP_eff_i` thay cho `VP_i`**:

```
W_eff(X) = Σ_{i∈X} VP_eff_i ,   X ∈ {S, O, A, P} .      (12')
```

> **Lưu ý điểm cố định (self-reference).** `τ` định nghĩa qua `ΣVP` = tổng **VP thô** `W(P)` (mẫu
> số dùng VP trước clamp), KHÔNG phải tổng `VP_eff`. Đây là lựa chọn có chủ đích để (12) là **một
> bước hàm đơn**, không phải phương trình điểm cố định: nếu lấy mẫu số = `Σ VP_eff` thì clamp lại
> đổi mẫu số → đổi `τ` → lặp vô hạn. Dùng `ΣVP` thô làm mẫu số cho `τ` khiến clamp **đơn định một
> lượt**, dễ kiểm trên chuỗi (TECH §5.x sẽ chốt). Hệ quả: `Σ_i VP_eff_i ≤ ΣVP` (clamp chỉ hạ, không
> nâng), nên tỷ lệ `W_eff(S)/W_eff(base)` của một phe bị chặn như §8B.3.

### 8B.2 Tính chất cơ bản của clamp (đơn điệu, bị chặn, idempotent)

**(P1) Bị chặn (bounded).** `0 ≤ VP_eff_i ≤ τ = ΣVP/F`. Trực tiếp từ (12). Mỗi DID đóng góp tối đa
`1/F` tổng VP thô.

**(P2) Đơn điệu (monotonic).** Giữ `ΣVP` cố định, `VP_i ↦ min(VP_i, τ)` là hàm không-giảm theo
`VP_i` (cận trên hằng `τ`). Đóng góp thật vẫn được thưởng cho tới khi chạm trần tally — không có
vùng phạt ngược. (So §4: đây là phiên bản tầng-tally của tính đơn điệu tầng-cá-nhân.)

**(P3) Idempotent trên trần cố định.** Với `τ` cố định, `min(min(VP_i,τ),τ) = min(VP_i,τ)`. Áp
clamp hai lần không đổi kết quả — clamp là **phép chiếu** lên đoạn `[0, τ]`.

**(P4) Tương thích cận trên cá nhân.** Vì `VP_i ≤ VP_max` (§3.1) và `VP_eff_i ≤ VP_i`, ta có
`VP_eff_i ≤ min(VP_max, τ)`. Clamp BFT chỉ **siết thêm**, không nới cận trên §3.

### 8B.3 Bổ đề trần tỷ lệ — "không tập con < ⌈t·F⌉ DID nào đạt tỷ lệ t"

**Phát biểu.** Cho phe tham gia `P`, tổng thô `ΣVP > 0`, sàn `F`. Với bất kỳ tập con `G ⊆ P` và
mục tiêu tỷ lệ `t ∈ (0,1]`, nếu `G` đạt (hoặc vượt) tỷ lệ `t` của tổng thô bằng VP **hiệu dụng**:

```
Σ_{i∈G} VP_eff_i  ≥  t · ΣVP ,
```

thì số DID trong `G` thỏa

```
|G|  ≥  ⌈ t · F ⌉ .      (13)
```

Tương đương (đảo đề): **mọi** tập con có `|G| < ⌈t·F⌉` DID **KHÔNG** thể đạt tỷ lệ `t`.

**Chứng minh.** Từ (P1), mỗi `VP_eff_i ≤ τ = ΣVP/F`. Cộng trên `G`:

```
Σ_{i∈G} VP_eff_i  ≤  |G| · τ  =  |G| · ΣVP / F .
```

Giả thiết `Σ_{i∈G} VP_eff_i ≥ t·ΣVP`. Kết hợp:

```
t · ΣVP  ≤  |G| · ΣVP / F .
```

Chia hai vế cho `ΣVP > 0`: `t ≤ |G|/F`, tức `|G| ≥ t·F`. Vì `|G|` nguyên, `|G| ≥ ⌈t·F⌉`. ∎

**Hệ quả số (với `F = 21`).** Trần một-DID là `τ = ΣVP/21 ≈ 4,76%` tổng. Suy trực tiếp từ (13):

| Mục tiêu `t` | `⌈t·F⌉` (số DID tối thiểu để **đạt** t) | Diễn giải BFT |
|---|---|---|
| `t = 1/3` | `⌈21/3⌉ = 7` | 7 DID đạt **đúng** 1/3; cần **≥ 8** để **VƯỢT** ngưỡng phủ quyết 1/3 (xem ghi chú) |
| `t = 2/3` | `⌈42/3⌉ = 14` | siêu đa số 2/3 cần **đúng 14** DID độc lập (đã max-clamp) |
| `t = 1` | `⌈21⌉ = 21` | đạt 100% cần **TỐI THIỂU 21** DID (mỗi DID phải max-clamp); `⌈t·F⌉` là số DID tối thiểu, KHÔNG bảo đảm đủ |

> **Mẫu số của bảng = `ΣVP = W(P)` (toàn phe THAM GIA), KHÔNG phải `W(base)` ngưỡng §8.2.** Bổ đề
> (13) định tỷ lệ `t` **trên `ΣVP = W(P)`** (tổng VP thô toàn phe tham gia, gồm cả TRẮNG). Khi ánh
> xạ sang ngưỡng thông qua/phủ quyết §8.2, nếu DAO chọn `W(base) = W(S)+W(O)` (TRẮNG **ngoài** mẫu
> số, FEAT §4.5) thì `W(base) ≤ W(P)` khi có phiếu TRẮNG (`W(A)>0`) — và số DID THUẬN tối thiểu để
> đạt `θ` của `W(base)` có thể **NHỎ hơn `⌈θ·F⌉`**, vì mẫu số thông qua nhỏ hơn tổng phe tham gia.
> Con số 7/14/21 là cận chặt **CHỈ khi `W(base) = W(P)`** (không TRẮNG, hoặc TRẮNG vào mẫu số). Đây
> là điểm dễ nhầm giữa §8B.3 và §8.2/I-3: cùng ký hiệu `t` nhưng **hai mẫu số khác nhau** khi có
> TRẮNG. Chặn số-DID độc lập theo **mẫu số thông qua** là việc của **sàn cứng `|S|≥F` (14)** — sàn
> cứng đếm người trên phe THUẬN, không qua mẫu số nên không bị TRẮNG làm lệch. Tóm: bảng §8B.3 đọc
> đúng với giả định mẫu số `= W(P)`; sàn cứng (14) mới là chốt chặn rời rạc bất kể TRẮNG.

> **Ghi chú dấu "đạt" vs "vượt" cho phủ quyết (khớp §8.2b).** Bổ đề (13) là điều kiện để **đạt**
> `Σ_{G} VP_eff ≥ t·ΣVP` (dấu `≥`). Phủ quyết §8.2b dùng dấu **chặt** `W_eff(O) > (1−θ)·W(base)`.
> Với `θ=2/3`, ngưỡng phủ quyết là `> 1/3`: 7 DID (đã max-clamp) đạt **đúng** `1/3 = 7·(1/21)`,
> CHƯA **vượt** → cần **≥ 8** DID để vượt ngưỡng `>1/3` (trừ khi các DID chưa max-clamp, thấy
> §8B.5). Hai số 7 (đạt đúng) và 8 (vượt) khớp dữ kiện CONTRACT §2 nguyên lý 5.
>
> **Ghi chú dòng `t=1` (cận dưới, điều kiện CẦN — không phải ĐỦ).** "Đạt 100% của `ΣVP`" về toán
> đòi **mọi** DID trong `P` đều max-clamp (mỗi `VP_eff_i = τ = ΣVP/F`) VÀ `|P| = F` đúng. Nếu
> `|P| > F` mà phân bố không đều thì KHÔNG tập 21 DID nào gom đủ 100% `W(P)` (còn phần dư của các
> DID khác). Vậy "100% cần 21 DID" chỉ đúng theo nghĩa **cận dưới**: `⌈t·F⌉` là số DID **tối thiểu**
> để đạt `t` (đúng theo bổ đề (13), điều kiện CẦN), KHÔNG phải "có 21 DID là gom đủ 100%" (điều kiện
> ĐỦ). Đọc nhất quán với câu mở §8B.3: "số DID tối thiểu để **đạt** `t`".

### 8B.4 Sàn cứng số-DID — ràng buộc RỜI RẠC (đếm người, không cộng VP)

Ngoài clamp liên tục (12), nguyên lý 5 đặt một **sàn cứng rời rạc**: một quyết định **trọng yếu**
chỉ hợp lệ khi **số DID** bỏ THUẬN đạt sàn `F`, độc lập với sức nặng VP:

```
|S|  ≥  F      (sàn cứng số-DID, BFT_FLOOR) .      (14)
```

Đây là ràng buộc trên **lực lượng tập (cardinality)** `|S|`, KHÔNG trên tổng VP — một **cổng thứ
ba** bên cạnh quorum (7a) và siêu đa số (7b). Lý do first-principles: clamp (12) bảo đảm **không ai
vượt 1/F**, nhưng về lý thuyết một phe đông VP-thấp vẫn có thể gom đủ tỷ lệ với ít hơn `F` DID nếu
các DID **chưa** max-clamp (VP_i < τ). Sàn cứng (14) đóng kẽ đó: buộc **tối thiểu `F` con người
độc lập** đồng thuận cho quyết định trọng yếu — đúng tinh thần "không thực thể nào, kể cả nhóm nhỏ,
quyết thay cộng đồng". Chưa đủ `F` DID thuận → quyết định **khóa**, hệ về **chế độ hội đồng bảo
trợ** (EXEC bootstrap; CONTRACT §2 nguyên lý 5).

**Quan hệ (13) ↔ (14).** Bổ đề (13) cho cận dưới `|G| ≥ ⌈t·F⌉` **khi mọi DID max-clamp**; sàn cứng
(14) ép `|S| ≥ F` **luôn**, kể cả khi DID chưa max-clamp. Hai ràng buộc cùng hướng (đều buộc đủ
người), (14) chặt hơn cho `t<1` và là **độc lập VP** nên không bị thao túng bằng bơm VP. Quyết định
loại nào là "trọng yếu" (áp (14)) do **FEAT** định theo loại quyết định.

### 8B.5 Khi clamp KHÔNG ràng buộc — Nakamoto coefficient và trưởng thành hệ

Clamp (12) chỉ **cắn** (binding) khi có DID `VP_i > τ`, tức khi VP tập trung. Nếu phe tham gia đã
**phân tán đủ** (mọi `VP_i ≤ τ`) thì `VP_eff_i = VP_i` mọi `i` → clamp **vô hiệu**, tally chạy như
§8 thường.

> **Định lượng ngưỡng cắn — nối cap C4 (trong-cá-nhân) ↔ clamp BFT (giữa-cá-nhân).** Cap C4 (§3)
> chặn tích tụ **trong một** cử tri nhưng **KHÔNG** chặn một **nhóm nhỏ** DID, mỗi DID đã max cả 4
> yếu tố (mỗi DID `VP_i = VP_max`); clamp BFT (§8B) là cơ chế **DUY NHẤT** chặn trường hợp đó. Cụ
> thể: gọi `m` = số DID cùng đạt `VP_i = VP_max`. Khi đó `ΣVP ≥ m·VP_max`, nên `τ = ΣVP/F`. Clamp
> **bắt đầu cắn** lên các DID max-VP khi `VP_max > τ`, tức khi `m < F` (vì lúc đó, nếu cả phe chỉ
> gồm `m` DID max-VP, `ΣVP = m·VP_max < F·VP_max → τ = ΣVP/F < VP_max`). Clamp **ngừng cắn** lên
> chúng khi `≥ F` DID cùng đạt `VP_max` (`τ ≥ VP_max → VP_eff_i = VP_i` mọi DID max-VP). Diễn giải:
> cap C4 một mình để **một** DID max-VP vẫn lọt; phải có **≥ F** DID độc lập cùng max-VP thì trần
> `1/F` mới hết cắn — đúng tinh thần câu mở §8B (dòng 456–460), nay định lượng ngưỡng `m = F`. Đo độ phân tán này bằng **Nakamoto coefficient** — số thực thể tối thiểu để đạt một
ngưỡng kiểm soát (vd 1/3 hoặc 1/2); xem
[Quantifying Decentralization](https://news.earn.com/quantifying-decentralization-e39db233c28e).

Gọi `NC_t(P)` = số DID tối thiểu mà tổng VP **thô** của họ đạt tỷ lệ `t`. Bổ đề (13) áp lên VP hiệu
dụng cho: **sau clamp**, không nhóm `< ⌈t·F⌉` DID nào đạt `t` — tức clamp **ép Nakamoto coefficient
hiệu dụng `≥ ⌈t·F⌉`** dù phân bố thô lệch tới đâu. Khi hệ **trưởng thành**, `NC_t(P)` thô tự vượt
`⌈t·F⌉` (cộng đồng đông + phân tán) → clamp ngừng cắn → trần `1/F` **tự nới**, không còn ràng buộc
(CONTRACT §2 nguyên lý 5: "hệ trưởng thành Nakamoto coefficient ≫ 21"). `F` là **đáy an toàn lúc
non trẻ**, không phải mục tiêu cố định.

### 8B.6 Quan hệ với chuẩn BFT `n ≥ 3f+1` — vì sao F=21 là SÀN, không phải ghế cố định

Lý thuyết đồng thuận Byzantine cổ điển: hệ `n` thực thể chịu được tối đa `f` thực thể độc hại khi
`n ≥ 3f+1`, tức an toàn nếu phần độc hại **`< 1/3`**. Nền tảng:
[Practical Byzantine Fault Tolerance (Castro–Liskov, OSDI 1999)](https://pmg.csail.mit.edu/papers/osdi99.pdf)
và họ giao thức kế thừa (vd
[Tendermint BFT](https://docs.cometbft.com/v0.38/spec/consensus/consensus)). Clamp (12) + ngưỡng
§8.2 tái hiện đúng biên `1/3` này ở tầng **bỏ phiếu người-thật**: với `θ=2/3`, một phe chống `< 1/3`
KHÔNG phủ quyết được (§8.2b), và trần `1/F` bảo đảm cần **nhiều** DID độc lập mới chạm `1/3`.

**Vì sao `21` (không khớp chính xác `3f+1`).** Họ `n=3f+1` cho các giá trị rời rạc `4, 7, 10, 13,
16, 19, 22, …`. Số **21 KHÔNG nằm** trong dãy (gần nhất: `f=6 → 19`, `f=7 → 22`). Với `n=21`:
`⌊(21−1)/3⌋ = ⌊20/3⌋ = 6`, nên `n=21` chịu **`f=6`** độc hại (cần `n≥3·6+1=19`, thừa 2 ghế dự
phòng), CHƯA đủ cho `f=7` (đòi `n≥22`). Con số `f=6` khớp cả hai cách phát biểu chuẩn an toàn:
(i) `3f+1`: `f=6 → n≥19 ≤ 21`; (ii) "phần độc hại `< 1/3`": `6/21 < 1/3 ≤ 7/21`, tức `7/21 = 1/3`
đúng **ranh giới** — khớp bảng §8B.3 (7 DID = đúng `1/3` = đúng ngưỡng một phe độc hại bắt đầu phủ
quyết được), nên chịu an toàn tối đa `f=6 < 7`. Vậy `F=21` chọn vì:

- Là **sàn tối thiểu hào phóng**: chịu ít nhất `f=6` thực thể độc hại, dư biên so với `19`.
- KHÔNG phải "đúng `3f+1`" vì đây là **sàn động**, không phải số ghế cố định. Cố định đúng `n=3f+1`
  ghế dẫn tới **bẫy oligarchy** kiểu 21 block-producer của EOS (số validator khóa cứng → tập trung
  quyền lực). MagicLamp tránh bẫy đó: `F` chỉ là **đáy** số người-thật tối thiểu; hệ trưởng thành
  có Nakamoto coefficient `≫ F` (§8B.5), lúc đó biên `1/3` được bảo đảm bởi **phân tán thực tế**,
  không bởi con số `21` khóa cứng.
- `F` là **tham số DAO định** (mặc định 21): DAO nâng `F` khi cộng đồng lớn lên để siết trần `1/F`
  chặt hơn, hoặc giữ làm đáy an toàn.

### 8B.7 Thứ tự áp dụng (cap C4 trước, clamp BFT sau) — bất biến

Hai cơ chế chặn tích tụ áp ở **hai tầng khác nhau, theo đúng thứ tự**:

```
bước 1 (tầng cá nhân):  x_{k,i} = min(C_{k,i}, cap_k)   →   VP_i = ∏_k x_{k,i}^{w_k}     (cap, §3)
bước 2 (tầng tally):    VP_eff_i = min( VP_i , ΣVP/F )                                    (clamp, §8B)
bước 3 (gom phe):       W_eff(X) = Σ_{i∈X} VP_eff_i ; kiểm (7a),(7b),(14) trên W_eff/|S|
```

Clamp BFT (12) **PHẢI** áp **SAU** khi `VP_i` đã tính xong từ tích (2) (gồm cap C4 ở bước 1), KHÔNG
trộn vào trong tích. Lý do: `τ = ΣVP/F` cần biết **toàn phe** mới tính được (mẫu số là tổng), trong
khi cap C4 thuần **cục bộ** một cử tri. Đảo thứ tự (clamp trước cap) vô nghĩa vì chưa có `VP_i` để
tính `ΣVP`. Ràng buộc thứ tự này được nâng thành **Bất biến I-4** (§12.2).

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
| `C2` (LAMP cam kết tương lai) | **khóa vốn qua `N_2` epoch** (cơ hội-thời-gian) — LAMP khóa trong ScheduleGen, chỉ tính nếu duy trì khóa ≥ `N_2` epoch (D8/W2, §6B.4) | một phần (khi mãn hạn) | một phần (khóa LAMP, NHƯNG phải qua `N_2` epoch — không khóa-tức-thời) |
| `C3` (uy tín) | **thời gian + công nhận xã hội** | KHÔNG | KHÔNG (cộng đồng phải công nhận) |
| `C4` (LAMP nắm giữ hiện tại) | **vốn HOÀN LẠI** — chỉ là chi phí cơ hội của khóa vốn trong cửa sổ snapshot | **CÓ** (rút ngay sau snapshot) | có (xem §10.6 flash-fill) |

**Định nghĩa `c_DID` (chi phí đạt `VP_max` cho một DID).** Tách hai phần:

```
c_DID  =  c_sunk  +  c_lock ,
   c_sunk = chi_phí_con_người + cost_C1(cap_1) + cost_C3(cap_3)   (phần CHÌM, không hoàn lại)
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
1. **Để 120 người đó có VP>0**, kẻ thuê vẫn phải khiến mỗi người **đóng góp thật** (lịch sử `C1`,
   uy tín `C3`) — tức vẫn trả đủ `c_DID` mỗi người. Thuê người không bỏ qua được chi phí đóng
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
   vốn hoàn lại** → đừng tính vào lập luận "chi phí chìm cao"; sức mạnh chống thâu tóm dồn **trọn vẹn** vào
   `C1,C3` (thời gian), KHÔNG vào `C4` — xem §10.5b vì sao không còn số hạng chìm nào khác.

`N` (độ dài cửa sổ ổn định cho `C4`) là **tham số mở (DAO định)**; MATH chốt rằng đo một-mốc thì
`C4` không đóng góp vào cận dưới chi phí chìm.

### 10.5b Vì sao KHÔNG có số hạng "đốt LAMP" trong `c_sunk` — và vì sao đừng thêm lại

Bản trước của mục này liệt "đốt LAMP" thành một dòng trong bảng §10.3 và một số hạng `LAMP_đốt`
trong `c_sunk`. **Đã gỡ 2026-09-01.** Bốn lý do độc lập, mỗi lý do đủ để gỡ:

1. **Nó phá bất biến cung của LAMP.** LAMP **không burn** — giảm lưu hành là **chuyển vào Treasury**,
   một bút toán, không phải một lần đốt (`Treasury/CONTRACT.md §5`; và chính module này đã ghi đúng
   ở `Exec-Spec.md:441`, `Tech-Spec.md:1087`, `Feat-Spec.md:852`, và §16 dưới đây). Một cận dưới an
   ninh tựa lên thao tác mà hệ **không có** thì không phải cận dưới.
2. **Nó không phải một tham số VP.** Công thức là `VP_i = ∏_k min(C_k, cap_k)^{w_k}` với **bốn**
   yếu tố `C1..C4`. "Đốt LAMP" không có đầu vào nào: không validator nào đo nó, không datum nào
   mang nó. Bảng chi phí liệt **năm** dòng cho một công thức **bốn** yếu tố — dòng thứ năm là dòng
   duy nhất không nối vào đâu.
3. **Phương án thay thế "đốt-tương-đương" cũng KHÔNG dùng được.** Đề xuất tự nhiên là chuyển một
   chiều vào Treasury để giữ tính chìm mà không phá bất biến. Đặt `γ` = phần giá trị kẻ tấn công
   thu lại được từ khoản đã nộp: đốt cho `γ = 0`; **gửi-Treasury cho `γ` nằm giữa 0 và 1, và tiến
   tới 1 đúng theo mức được chi tiêu Treasury** — mà chi tiêu Treasury do chính quản trị này quyết
   (CONTRACT D2/D3). Nên khoản ấy hoàn lại **có điều kiện là kẻ tấn công thắng**. Một lập luận an
   toàn tựa lên nó thì **tự tham chiếu: mạnh khi hệ còn an toàn, yếu đi đúng lúc bị tấn công.**
   Không phải chi phí chìm. *(Khung `γ` do MAGIC agent đề xuất 2026-09-01.)*

   **Phạm vi của lập luận này, phải nói rõ kẻo đọc quá mạnh:** `γ` ở đây là `γ` **điều kiện theo
   kết cục THẮNG**, và đó đúng là điều kiện mà (9a) cần — vì (9a) chặn dưới chi phí của một tấn
   công **thành công**. Trong khung *răn đe kỳ vọng* thì khoản nộp vẫn tốn `X·(1 − p·γ_thắng)` với
   `p = P(thắng) < 1`, tức **vẫn dương**. Ai đọc mục này thành "nộp Treasury không tốn gì" là đọc
   sai. Và `γ_thắng < 1` **ngặt** (còn thừa số chiết khấu theo độ trễ và phần chia với người trung
   thực còn lại), nên "tiến tới 1" là mô tả chiều, không phải đạt tới.

   ⇒ Hệ quả cho câu "đừng thêm lại": phát biểu đúng là **đừng thêm lại nếu KHÔNG có trần `γ̄ < 1`
   chứng minh được**. Nếu sau này có luật kho ép được trần đó (vd chi ≤ x%/epoch, đề xuất chi phải
   loại người gửi khỏi `W(base)`), thì `(1 − γ̄)·X` là phần chắc chắn không hoàn lại và **hợp lệ**
   vào `c_sunk` — cùng chuẩn §10.5 đã dùng để loại `C4`. **Hiện chưa có trần nào.**
4. **Nó là số hạng DUY NHẤT nén được bằng tiền tức thì** — đốt xong trong đúng một giao dịch.
   §10.3b khẳng định *"`c_sunk` không nén được bằng tiền"*. Còn số hạng đó thì khẳng định ấy **sai
   một phần**; gỡ đi thì nó thành **đúng trọn**. Đây là lý do mạnh nhất, và nó là lý do duy nhất
   khiến việc gỡ **cải thiện** một mệnh đề chứ không chỉ sửa một mệnh đề.

**Hệ quả phải nói thẳng, và bản trước của chính mục này nói quá nhẹ.** `c_sunk` mất một số hạng.
Bản đầu (cùng ngày) viết *"đây là sửa một phép đếm sai, không phải hạ tiêu chuẩn"* và giao phần
chống-mua-bằng-tiền cho **D8**. Hội đồng phản biện bác cả hai vế, và bác đúng:

- **D8 KHÔNG lấp được chỗ trống.** Số hạng bị gỡ là **chi phí chìm cộng dồn theo `N`** — mỗi danh
  tính giả thêm vào phải trả thêm. D8 là **ràng buộc tỷ lệ số mũ bên trong một công thức**, không
  phụ thuộc `N` chút nào, và không làm tăng chi phí biên của một DID Sybil. Hai **trục** khác nhau;
  giao việc của trục này cho trục kia là lỗi phạm trù. (Ba giới hạn khác của D8: CONTRACT §5.)
- **"Chỉ là sửa phép đếm" là cách đọc quá dễ dãi.** Cách đọc đúng nằm ở §10.5c.

**Câu đứng được sau khi gỡ, và chỉ câu này:** số hạng bị gỡ là **hư cấu**, nên việc gỡ không làm
mất một lớp bảo vệ có thật — nó **phơi ra** rằng chỗ đó vốn đã trống. Sửa một bản đồ vẽ sai không
làm địa hình xấu đi; nó chỉ thôi nói dối về địa hình.

**Cảnh báo cho lần rà sau:** `grep 'đốt'` trần trong module này trả ~40 kết quả về **đốt nullifier
token** (§6.4, `nullifier.ak`, `tally.ak`, `vote.ak`) — chống bỏ phiếu hai lần, **đúng và phải giữ**.
Rà bất biến cung phải lọc `đốt.*LAMP`, đừng lọc `đốt`.

### 10.5c Sau khi gỡ thì `c_sunk` thật sự còn gì — soát từng hạng, và bảy chỗ CHƯA đóng

Mục này tồn tại vì một lý do: bản đầu của §10.5b thay một khẳng định an toàn sai bằng một khẳng
định an toàn khác chưa kiểm. Hội đồng phản biện đo lại từng hạng, và kết quả đủ nghiêm để phải
viết ra thay vì để người đọc sau tự phát hiện.

**Soát từng hạng của `c_DID` (đo 2026-09-01, kho MAGIC đọc trực tiếp):**

| Hạng | Đo được | Chìm thật? |
|---|---|---|
| `cost_C4` | §10.5 đã loại — vốn hoàn lại | **không** |
| `cost_C2` | LAMP **khoá**, `lamp_balance` bất biến, chỉ lật `is_locked` (`MAGIC/ScheduleGen`) | **không** — hoàn lại sau `N_2` epoch |
| `cost_C1` qua InstantGen | **"LAMP đứng yên trong vault"** (I-ACT-7), không có khoản LAMP thanh toán (`MAGIC/InstantGen/MATH.md` I-ACT-7) | **vốn hoàn lại**; cái mất là *credit MAGIC* |
| `cost_C1` qua GetMAGIC | mua quyền nhận MAGIC **bằng tiền pháp định** (`MAGIC/GetMAGIC/FEAT.md:8`) | **CÓ** — và đây là hạng chìm thật duy nhất mà spec cũ không biết là mình có |
| `cost_C3` | cơ chế đo **chưa định nghĩa** (`Tech-Spec.md` §5.5 "câu hỏi treo"; `Feat-Spec.md` §8 "tham số mở") | **chưa có nội dung** |
| chi phí con người | tiền thuê / tiền mua danh tính | **CÓ** |

⇒ **Cách đọc đúng, thay cho "chỉ là sửa phép đếm":** sau khi gỡ, không hạng nào mất quá vài phần
trăm giá trị vốn trên mỗi cửa sổ, và vốn gốc quay về ví. Tấn công chuyển từ **"trả giá"** sang
**"chờ và thuê"**. Phần chống thâu tóm còn lại nằm trọn ở hai chỗ: **khan hiếm người thật** (có
thật, do DID sinh trắc) và **độ dài cửa sổ tích luỹ**. Nói "ba lớp" là vẫn còn rộng tay — `C3`
chưa có cơ chế nên thực chất đang là **hai**.

**Bảy chỗ CHƯA đóng — liệt ở đây để lần rà sau không phải tìm lại, KHÔNG chỗ nào được coi là đã
chặn cho tới khi có bằng chứng:**

1. **`C1` đo bằng TỔNG, không theo phân bố.** §10.3b tự đặt điều kiện *"không thể dồn một epoch
   **nếu** TECH đo theo phân bố thời gian, không chỉ tổng"*. `Tech-Spec.md` §5.2 đo **tổng** MAGIC
   tiêu trong cửa sổ ⇒ **điều kiện KHÔNG thoả**. Kẻ tấn công nằm im rồi dồn tiêu ở 1–2 epoch cuối
   trước mốc chốt. Độ trễ hiệu dụng `T_1` sụp về ~1 epoch, và "cửa sổ để cộng đồng phát hiện"
   biến mất. **Đây là lỗ nặng nhất, và nó vô hiệu hoá phần lớn §10.3b.**
   Dạng vá: `C1 = Σ_e min(consumed_e, cap_mỗi_epoch)` — khi đó chạm `cap_1` **chứng minh được**
   cần `≥ T_1` epoch. Cần mở rộng D9: beacon C1 phơi vector theo epoch, không phơi tổng thô.
2. **`cap_1`, `cap_3` không có sàn cứng.** Bảng §12.1 ràng duy nhất `> 0`, trạng thái "mở". Một
   đề xuất hạ `cap_1`/`cap_3` xuống mức chạm được trong một epoch làm **cả hai số hạng còn lại**
   của `c_sunk` sụp về ~0. (9a) vẫn đúng về toán, nhưng vế phải tiến tới 0 ⇒ cận dưới mất nghĩa.
   D8 không cứu được: nó ép tỷ lệ số mũ, không ép giá trị `cap`.
3. **D8 chưa có chủ ép, và dạng TỔNG cho phép `w_3 = 0`.** Chi tiết CONTRACT §5.
4. **`C3` là nợ thiết kế.** Chừng nào chưa có cơ chế đo phi tập trung thì mọi câu "C3 rất khó mua"
   mới là chốt về **nguyên tắc** (chống herding), chưa chốt về **cơ chế**.
5. **Chợ danh tính.** Xác thực DID lúc bỏ phiếu là **registry-membership tĩnh** (`Tech-Spec.md`
   §7.1), không phải sinh trắc mỗi lần bỏ phiếu. Mua khoá riêng của một DID **đã chín** biến
   `N_min · c_sunk` trải `T` epoch tương lai thành **một khoản trả ngay** cho lịch sử đã có sẵn.
   §10.4 "lộ thiên on-chain" **không bắt được** kiểu này: đó là các DID hiện hữu, rải rác, không
   tương quan thời gian — khác hẳn "`N` DID mới cùng lúc". Lỗ này nằm ở **tầng PhoenixKey**, ngoài
   phạm vi sửa của repo này; ghi lại để không ai tưởng nó đã được (9a) tính vào.
6. **Cơ chế phát hiện collusion chưa được đặc tả.** §10.4 dựa vào "cộng đồng phát hiện + phản
   ứng", nhưng không validator tương quan nào, không chấm điểm nguồn vốn nào được đặc tả, và kênh
   trừng phạt là `C3` thì rơi vào (4).
7. **`BFT_FLOOR = 21` là hằng số, không co giãn theo quy mô cử tri.** Nên 21 vừa là sàn chính
   danh **vừa là số danh tính kẻ tấn công cần mua**. DAO càng lớn thì hằng số này càng **không**
   an toàn hơn.

**Một câu hỏi thủ tục, không phải câu hỏi toán, và nó thuộc về chủ dự án chứ không thuộc MATH:**
khung này được duyệt 2026-06-05, và bản được duyệt lúc đó **chứa** khẳng định "bốn lớp". Nếu có
tham số nào đã chốt (`BFT_FLOOR = 21`, `cap_4 = 100 triệu`, `N_min`) từng được hiệu chỉnh dựa một
phần vào lớp thứ tư hư cấu, thì việc gỡ **không** kết thúc ở sửa văn bản. MATH không tự trả lời
được câu này — nó cần người đã duyệt xác nhận.


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

Mỗi DID đòi lịch sử nhiều epoch (`C1`) + uy tín (`C3`) → chi phí **thời gian** (không
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

## 11. Ổn định số học và THUẬT TOÁN VP ON-CHAIN (chốt khả thi — D7)

### 11.1 Vấn đề

Cài (2) trực tiếp đòi **mũ thực** `x^{w_k}` với `w_k` không nguyên — trên Aiken **không có float
gốc** và **không có hàm mũ/log thực** sẵn. Aiken `Int` là số nguyên **độ dài tùy ý** (bignum) nên
**KHÔNG sợ tràn** khi nhân nhiều số lớn, nhưng phải tính `x^{w_k}` (mũ phân số) bằng số nguyên.
Tài liệu Aiken: <https://aiken-lang.org/language-tour/primitive-types#int> (Int độ dài tùy ý,
không float gốc).

> Trước đây mục này nghiêng về hướng **log-sum / exp** (tính `L=Σ w_k·ln x_k` rồi khôi phục
> `exp`). Hướng đó cần xấp xỉ `ln` **và** `exp` nguyên (hai hàm), tốn ExUnit và khó kiểm sai số khi
> gom phe. **CONTRACT D7 đã CHỐT** một hướng đơn giản, đơn định hơn: **bảng tra 1-chiều mỗi yếu tố +
> nội suy tuyến tính**, rồi nhân bốn giá trị bảng. Mục này đặc tả hướng đã chốt; hướng log-sum chỉ
> còn là ghi chú phương án thay thế (§11.6), KHÔNG phải đường cài đặt v1.

### 11.2 Thuật toán đã chốt (D7) — bảng `pow_k` + nội suy tuyến tính + tích chia `SCALE^3`

**Ý tưởng first-principles.** Phần khó duy nhất là `x^{w_k}` (mũ phân số). Thay vì tính tại chỗ,
**precompute** giá trị này thành một **bảng tra 1-chiều** cho từng yếu tố `k`, lưu ở thang nguyên
`SCALE`. On-chain chỉ còn **tra bảng + nội suy tuyến tính + nhân số nguyên** — toàn phép nguyên,
đơn định, rẻ ExUnit.

**Định nghĩa bảng.** Với mỗi yếu tố `k` và mỗi giá trị đã chặn `c = x_{k,i} ∈ [0, cap_k]`:

```
pow_k[c] = round( c^{w_k} · SCALE )      (T1)   [giá trị nguyên, thang SCALE]
```

`SCALE` là **hằng số thang fixed-point chung** (lũy thừa 10 hoặc 2; TECH chốt giá trị, khuyến nghị
`SCALE = 10^9` để cân giữa độ phân giải và độ rộng số — xem §11.4). Bảng KHÔNG lưu mọi `c` (cap tới
hàng trăm triệu → bảng khổng lồ): chỉ lưu tại một tập **mốc** (knots) `c_0=0 < c_1 < … < c_M = cap_k`
và **nội suy tuyến tính** giữa hai mốc kề:

```
với c ∈ [c_j, c_{j+1}]:
  pow_k(c) = pow_k[c_j] + ( pow_k[c_{j+1}] − pow_k[c_j] ) · (c − c_j) / (c_{j+1} − c_j)      (T2)
```

Phép chia ở (T2) là **chia nguyên** (làm tròn xuống) — sai số nội suy giới hạn ở §11.3. Vì `c↦c^{w_k}`
với `w_k∈(0,1]` là **lõm** (§6.2), dây cung (nội suy tuyến tính) luôn **nằm dưới** đường cong thật →
`pow_k(c) ≤ round(c^{w_k}·SCALE)`: nội suy **không vượt** giá trị thật (an toàn, không thổi phồng VP).

**Công thức VP nguyên.** Với `K=4` yếu tố (mở rộng `K>4` ở §11.5):

```
power_i = ( pow_1(x_{1,i}) · pow_2(x_{2,i}) · pow_3(x_{3,i}) · pow_4(x_{4,i}) ) / SCALE^3      (T3)
```

Chia `SCALE^3` (không phải `SCALE^4`) vì bốn thừa số mỗi cái mang một thừa số `SCALE`; tích có
`SCALE^4`, ta muốn `power_i` ở **một** thang `SCALE` → chia `SCALE^3`. Kết quả `power_i ≈ VP_i·SCALE`,
một số nguyên Aiken `Int` đại diện VP ở thang `SCALE`. Mọi so sánh ngưỡng §8.2, clamp BFT §8B, gom
phe (6) chạy **trực tiếp trên `power_i` nguyên** (cùng thang `SCALE` → so sánh/cộng nguyên hợp lệ).

> **Vì sao chia `SCALE^3` an toàn (không mất bậc).** `power_i` giữ thang `SCALE` (≈9 chữ số thập
> phân nếu `SCALE=10^9`), đủ phân giải để so ngưỡng. Phép chia nguyên cuối làm tròn xuống một lần,
> sai số tuyệt đối `< 1` đơn vị thang `SCALE` (tức `< 1/SCALE` ở thang VP) — nhỏ hơn nhiều sai số
> nội suy §11.3. Aiken `Int` bignum giữ tích `pow_1·pow_2·pow_3·pow_4` (cỡ `SCALE^4 ≈ 10^36`) **không
> tràn** — đây chính là lý do D7 chọn nhân-rồi-chia thay vì log-sum.

### 11.3 Đặc tả SCALE + sai số (knots, nội suy, làm tròn)

Ba nguồn sai số, mỗi nguồn chặn được:

1. **Sai số lượng tử hóa thang `SCALE`.** `pow_k[c]` làm tròn `c^{w_k}·SCALE` về số nguyên → sai số
   tuyệt đối `≤ 1/2` đơn vị thang, tức `≤ 1/(2·SCALE)` ở thang VP. Với `SCALE=10^9`: `≤ 5·10^{−10}`.
2. **Sai số nội suy tuyến tính (knots).** Trên `[c_j,c_{j+1}]`, sai số dây cung của hàm lõm `c^{w_k}`
   bị chặn bởi độ cong: `|pow_k(c) − c^{w_k}·SCALE| ≤ (1/8)·|f''(ξ)|·(c_{j+1}−c_j)^2·SCALE`, với
   `f(c)=c^{w_k}`, `f''(c)=w_k(w_k−1)c^{w_k−2}` (§6.2). Sai số **giảm bậc hai** theo khoảng cách
   mốc → đặt mốc **dày hơn ở vùng `c` nhỏ** (nơi `|f''|` lớn) để cân sai số. TECH chốt lưới mốc sao
   cho sai số tương đối `≤ ε_tab` (khuyến nghị `ε_tab ≤ 10^{−4}`, tức ≤ 0,01%).
3. **Sai số chia nguyên ở (T2) và (T3).** Mỗi phép chia nguyên làm tròn xuống `< 1` đơn vị thang.
   Tổng cộng qua (T2) (một lần/yếu tố) + (T3) (một lần) là `O(K)` đơn vị thang `SCALE` → `O(K/SCALE)`
   ở thang VP, **bỏ qua được** so với (2).

**Cận sai số tổng (tương đối).** Vì `power_i` là **tích** bốn thừa số, sai số tương đối **cộng dồn**:
`|power_i/(VP_i·SCALE) − 1| ⪅ Σ_k ε_k + O(K/SCALE)`, với `ε_k` là sai số tương đối của `pow_k`
(gồm lượng tử hóa + nội suy). Đặt mỗi `ε_k ≤ ε_tab` → tổng `⪅ K·ε_tab`. Với `K=4`, `ε_tab=10^{−4}`:
sai số VP `⪅ 4·10^{−4}` (≤ 0,04%) — **dưới ngưỡng ảnh hưởng thứ tự** cho mọi so sánh ngưỡng thực tế.

**Ràng buộc thang `SCALE` (TECH chốt số):** `SCALE` đủ lớn để `(1/SCALE) ≪ ε_tab` (lượng tử hóa không
lấn sai số nội suy) — `SCALE=10^9` thỏa với `ε_tab=10^{−4}`. `SCALE` là **lũy thừa cố định**, **khóa
theo kỳ** như weight (Bất biến I-1) để hai phiếu cùng proposal dùng cùng thang.

### 11.4 Property test bắt buộc (VP_int vs VP_float)

TECH PHẢI có bộ test so khớp **bắt buộc** trước khi coi thuật toán đạt:

- **PT1 — sai số tương đối bị chặn.** Sinh ngẫu nhiên `(x_1,…,x_4) ∈ [0,cap]^4` (gồm biên: 0, cap,
  sát mốc, giữa hai mốc). Tính `VP_float = ∏ x_k^{w_k}` (double/rational ngoài chuỗi) và
  `power_int` (T3). Khẳng định `|power_int/(VP_float·SCALE) − 1| ≤ K·ε_tab` (§11.3).
- **PT2 — bảo toàn thứ tự (quan trọng nhất cho governance).** Với mọi cặp `(a,b)` sinh ngẫu nhiên:
  `VP_float(a) < VP_float(b)` ⇒ `power_int(a) ≤ power_int(b)` (cho phép bằng tại biên sai số). Đảm
  bảo lượng tử hóa KHÔNG lật thứ tự cử tri — tính chất §4 (đơn điệu) được bảo toàn ở bản nguyên.
- **PT3 — biên geometric.** Bất kỳ `x_k=0` ⇒ `power_int=0` (khớp §1.4, §9.2). `pow_k[0]=0` phải nằm
  trong bảng (mốc `c_0=0`).
- **PT4 — nội suy không vượt đường cong.** Với `w_k∈(0,1]` (lõm), `pow_k(c) ≤ round(c^{w_k}·SCALE)`
  mọi `c` (dây cung dưới đường cong, §11.2) — chống thổi phồng VP.
- **PT5 — đơn điệu bảng.** `c < c'` ⇒ `pow_k(c) ≤ pow_k(c')` (bảng + nội suy không-giảm) — giữ §4
  ở tầng cài đặt.

### 11.5 Mở rộng `K > 4` yếu tố

Khi DAO thêm yếu tố (`K>4`, CONTRACT §1), (T3) tổng quát: `power_i = (∏_{k=1}^{K} pow_k(x_{k,i})) /
SCALE^{K−1}` — tích `K` thừa số chia `SCALE^{K−1}` (mỗi thừa số một `SCALE`, giữ kết quả ở một thang
`SCALE`). Aiken bignum vẫn không tràn; chỉ ExUnit tăng tuyến tính theo `K`. Bảng `pow_k` thêm một
hàng/yếu tố, công thức không đổi hình thức.

### 11.6 Phương án thay thế (KHÔNG dùng v1) — log-sum / exp

Giữ lại để truy vết: có thể tính `L_i=Σ_k w_k·ln x_k` rồi khôi phục `exp` (log-sum-exp ổn định:
`Σ_i exp(L_i)=exp(L*)·Σ_i exp(L_i−L*)`, <https://en.wikipedia.org/wiki/LogSumExp>). Ưu: so sánh
**từng cặp** chỉ cần `L_i`, không exp. Nhược: **cộng VP một phe** (6) vẫn cần khôi phục `exp(L_i)`
(không cộng `L_i` được), tức cần **cả** `ln` lẫn `exp` nguyên → hai hàm xấp xỉ, ExUnit cao, sai số
khó kiểm hơn bảng tra. **D7 chọn bảng tra (§11.2)** vì đơn định, một nguồn sai số chính (nội suy),
ExUnit thấp. Nếu sau này `K` rất lớn hoặc cần `w_k` đổi liên tục, DAO có thể cân nhắc lại log-sum.

### 11.7 Xử lý `x_{k,i}=0` và cố định thang (khóa theo kỳ)

`x_{k,i}=0` → `pow_k[0]=0` (mốc đầu bảng) → tích (T3) `=0` → `power_i=0`, đúng nhánh biên §9.2 (cử
tri VP=0 đóng góp 0 vào (6), loại khỏi mọi phép cộng phe). Không cần xử lý `ln(0)=−∞` như hướng
log-sum cũ — đây là một ưu điểm nữa của bảng tra. `SCALE`, bảng `pow_k`, lưới mốc đều **khóa theo kỳ
governance** (Bất biến I-1) và trỏ qua tham số UTxO lúc Proposal Open (TECH §5.6) để mọi phiếu cùng
proposal tính trên cùng bảng.

---

## 12. Tham số mở (DAO định) và BẤT BIẾN CỨNG (mọi spec phải ép)

### 12.1 Tham số mở

| Ký hiệu | Ý nghĩa | Ràng buộc MATH bắt buộc | Đã chốt? |
|---|---|---|---|
| `cap_1, cap_2, cap_3` | trần C1/C2/C3 | `> 0` | **mở** |
| `cap_4` | trần C4 (LAMP nắm giữ) | `> 0` | **= 100 triệu** (CONTRACT) |
| `w_k` | trọng số mỗi yếu tố | `≥ 0`; **BẤT BIẾN (W1): `w_2+w_4 ≤ w_1+w_3`** (D8, §6B, I-5); khuyến nghị `∈(0,1]` (§6); cố định **một** chuẩn hóa, khuyến nghị `Σw_k=1` (§7) | **mở** (trong ràng buộc W1) |
| Độ dài cửa sổ C1 | ~18 epoch (gợi ý CONTRACT) | cửa sổ quá khứ cố định; định `T_1>0` (§10.3b) | **mở** (gợi ý 18) |
| Độ dài cửa sổ C2 | ~24 epoch (gợi ý CONTRACT) | cửa sổ tương lai cố định | **mở** (gợi ý 24) |
| `N` (cửa sổ ổn định C4) | số epoch giữ ổn định để tính C4 (chống flash-fill §10.5) | `≥ 1`; nếu đo một-mốc thì C4 KHÔNG vào cận dưới chìm | **mở** → TECH chốt |
| `N_2` (cửa sổ khóa C2) | số epoch LAMP phải duy trì khóa để C2 tính dương (D8/W2, §6B.4) | `≥ 1`; khóa-tức-thời (< `N_2`) → `C2=0` | **mở** (gợi ý ~24 epoch) → TECH chốt |
| `SCALE` | thang fixed-point thuật toán bảng (D7, §11.2) | lũy thừa cố định; `1/SCALE ≪ ε_tab`; khóa theo kỳ (I-1) | **mở** (gợi ý `10^9`) → TECH |
| Lưới mốc + `ε_tab` | knots bảng `pow_k` + ngưỡng sai số nội suy (§11.3) | sai số tương đối mỗi yếu tố `≤ ε_tab` | **mở** (gợi ý `ε_tab ≤ 10^{−4}`) → TECH |
| `θ` (ngưỡng siêu đa số) | phần VP cần để thông qua | `∈(1/2,1]`; dùng `≥`; mẫu số = `W(base)` phe tham gia (§8.2) | **mở** (gợi ý 2/3 hiến chương) |
| Mẫu số `W(base)` | xử lý TRẮNG | `W(S)+W(O)` hoặc `W(P)` (§8.2, FEAT §4.5) | **mở** → DAO/FEAT |
| `q` (quorum) | sàn VP tham gia | `≥ 0`; cổng độc lập với θ (§8.2) | **mở** |
| `F` (`BFT_FLOOR`) | sàn Byzantine: trần một-DID khi tally `τ=ΣVP/F` (§8B.1) + sàn cứng số-DID `|S|≥F` (§8B.4) | nguyên `≥ 4`; clamp áp SAU cap (I-4); là SÀN, không phải ghế cố định (§8B.6) | **mở** (mặc định 21) |
| `K` | số yếu tố | `≥ 4` (CONTRACT) | mở để tăng |
| `floor_k` (tùy chọn) | sàn dương bootstrap (§9.2) | `≥ 0`; mặc định 0 | **mở** (mặc định tắt) |
| `floor_3` | sàn uy tín cho cử tri hợp lệ (§9.4 phương án a) | `> 0` nếu chọn (a) để giữ đơn điệu phạt | **mở** → FEAT/TECH |
| Thuật toán VP nguyên (bảng `pow_k` + nội suy, D7 §11.2) | tính VP on-chain | `power=(∏pow_k)/SCALE^{K−1}`; so khớp PT1–PT5 (§11.4) | **chốt D7**; số (`SCALE`/mốc/`ε_tab`) → TECH |

**Khuyến nghị MATH (không ép, để DAO cân nhắc):** `Σw_k = 1`; `w_k∈(0,1]`; `θ=2/3` với `≥` cho
quyết định hiến chương; đo `C4` trên cửa sổ ổn định `N≥1` (không một-mốc) nếu muốn `C4` góp vào
chi phí chìm; đo `C2` trên cửa sổ khóa `N_2≥1` (không khóa-tức-thời, W2). **Lưu ý: `w_2+w_4 ≤
w_1+w_3` (W1) KHÔNG phải khuyến nghị mà là BẤT BIẾN I-5 — mọi bảng weight phải thỏa.**

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

**I-4 (Thứ tự cap → clamp BFT, và sàn cứng số-DID).** Khi áp nguyên lý 5: (i) clamp BFT
`VP_eff_i = min(VP_i, ΣVP/F)` (§8B.1) **PHẢI** áp **SAU** khi `VP_i` đã tính xong từ tích (2) (gồm
cap C4), KHÔNG trộn clamp vào trong tích — vì `τ=ΣVP/F` cần tổng toàn phe (§8B.7). (ii) Mẫu số của
`τ` là tổng VP **thô** `ΣVP=W(P)`, KHÔNG phải `ΣVP_eff` (tránh điểm cố định, §8B.1). (iii) Quyết
định **trọng yếu** (loại do FEAT định) phải thỏa **sàn cứng rời rạc** `|S| ≥ F` (§8B.4) — ràng buộc
trên **số DID** thuận, độc lập VP, là cổng thứ ba bên cạnh quorum (7a) + siêu đa số (7b). Chưa đủ →
khóa, về chế độ hội đồng bảo trợ (EXEC). Thực thi: **TECH** (tính `VP_eff`, đếm `|S|`, thứ tự
on-chain) + **FEAT** (định loại quyết định trọng yếu áp (14) + chế độ hội đồng bảo trợ khi khóa).

**I-5 (Trần weight nhóm mua-bằng-tiền + C2 phải khóa-thời-gian — D8).** (i) Mọi bảng weight phải
thỏa **`w_2 + w_4 ≤ w_1 + w_3`** (W1, §6B.1) — tổng trọng số nhóm mua-được-bằng-tiền `MONEY={2,4}`
KHÔNG vượt tổng trọng số nhóm cần-thời-gian `TIME={1,3}` (tổng quát `K>4`:
`Σ_{MONEY} w_k ≤ Σ_{TIME} w_k`). Bảng vi phạm là **không hợp lệ** → validator tham số từ chối.
(ii) `C2` **chỉ tính dương nếu LAMP cam kết đã khóa thật và duy trì khóa ≥ `N_2` epoch** (W2,
§6B.4); khóa-tức-thời → `C2 = 0`. Biến C2 từ vốn-hoàn-lại-tức-thời thành chi-phí-cơ-hội-thời-gian
(như C1). Lý do: §6B.2 (weight = độ co giãn VP; chặn đòn bẩy vốn) + §10.5 (chống flash-fill). Thực
thi: **TECH** (ép W1 lúc nạp bảng weight; ép W2 khi đọc beacon C2 — kiểm thời hạn khóa byte-perfect,
CONTRACT D9) + **FEAT** (quy trình DAO đổi weight phải kiểm W1 trước khi đưa ra bỏ phiếu) +
**EXEC/MAGIC** (beacon C2 nhúng mốc khóa để on-chain xác thực `N_2`, CONTRACT D9). Không spec nào
được nới I-5.

---

## 13. Phụ thuộc

- **CONTRACT.md** (file này bám sát; không mâu thuẫn §1, §2, §3).
- **PhoenixKey DID sinh trắc + zk-proof "1 DID = 1 người"** — *blocker tiên quyết*. MATH giả định
  mỗi `i` ứng đúng một người thật; nếu DID không bảo đảm 1-người-1-DID thì mô hình chi phí §10 sụp
  (sybil rẻ). Thuộc backend PhoenixKey, ngoài repo LAMP (CONTRACT §3).
- **TECH** — đo `C1,C2,C4` (cross-repo MAGIC + LAMP qua reference input), chốt `SCALE` + lưới mốc +
  `ε_tab` cho **bảng tra `pow_k` (D7, §11.2)** + chạy property test PT1–PT5 (§11.4), datum/redeemer,
  chống double-vote; **ép W1 (`w_2+w_4≤w_1+w_3`) lúc nạp bảng weight + ép W2 (C2 khóa ≥`N_2` epoch)
  khi đọc beacon C2 (D8, I-5)**; **tính `VP_eff` (clamp BFT §8B) đúng thứ tự cap→clamp (I-4), đếm
  `|S|` cho sàn cứng (14)**.
- **FEAT** — vòng đời tập sự, định nghĩa các loại quyết định gắn `θ` khác nhau, recall, gom phiếu;
  **định loại quyết định "trọng yếu" áp sàn cứng `|S|≥F` (§8B.4) + chế độ hội đồng bảo trợ khi khóa**.
- **EXEC** — bootstrap (xử lý §9.2: cả hệ VP=0 lúc chưa có uy tín → bật `w_3` dần hoặc floor tạm);
  **chế độ hội đồng bảo trợ khi chưa đủ `F` DID (§8B.4)**.
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
3. **[ĐÃ GỠ TREO — chốt bởi D7]** Thuật toán VP on-chain: KHÔNG dùng log-sum/exp nữa. Chốt
   **bảng tra `pow_k[c]=round(c^{w_k}·SCALE)` + nội suy tuyến tính + `power=(∏pow_k)/SCALE^{K−1}`**
   trên Aiken `Int` bignum (§11.2). Không cần khôi phục `exp` (tích nguyên không tràn). Còn lại
   **TECH chốt**: giá trị `SCALE`, lưới mốc + `ε_tab`, và chạy property test PT1–PT5 (§11.4).
4. **Khóa weight trong kỳ (Bất biến I-1, §12.2):** đã nâng thành **bất biến cứng**. Câu treo còn
   lại: ranh giới "một kỳ governance" định nghĩa thế nào (theo epoch? theo proposal?) để TECH §5.6
   + FEAT §10 câu 4 thực thi nhất quán. **FEAT/EXEC/TECH.**
5. **[ĐÃ NÂNG THÀNH RÀNG BUỘC — chốt bởi D8]** `C2` mua một phần bằng tiền (khóa LAMP) nay bị chặn
   bằng **hai ràng buộc cứng** (Bất biến I-5, §6B): (W1) `w_2+w_4 ≤ w_1+w_3` — trần trọng số nhóm
   mua-được-bằng-tiền; và (W2) `C2` chỉ tính dương nếu LAMP **đã khóa ≥ `N_2` epoch** (chi-phí-thời-
   gian, không khóa-tức-thời). Còn lại **DAO định**: giá trị `cap_2`, `N_2`, và bảng weight cụ thể
   (miễn thỏa W1).
6. **Xác nhận tokenomics 36 tỷ / 24 tỷ** với file canonical (Foundation-Bootstrap / SPEC). CHỈ
   ảnh hưởng khối minh họa §8.3b; §8.3 ("12 tỷ → 120 DID") độc lập với việc này (chỉ dựa `cap_4`).
7. **Cửa sổ ổn định `C4` (`N` epoch) chống flash-fill (§10.5):** TECH chốt v1 dùng snapshot
   một-mốc (đơn giản) hay đo `C4` qua `N` epoch / yêu cầu khóa? Nếu một-mốc, MATH ép `C4` không
   vào cận dưới chi phí chìm. **TECH/DAO.**
8. **Ngữ nghĩa `C3` sau phạt (§9.4):** chọn (a) sàn `floor_3>0` giữ đơn điệu phạt, hay (b) `C3=0`
   khi recall (khóa VP)? Đồng bộ MATH §9.4 ↔ FEAT §6 ↔ TECH §5.5. **FEAT/TECH.**
9. **Giá trị `F` (`BFT_FLOOR`) và lịch nâng (§8B):** giữ mặc định 21 (chịu `f=6` độc hại, §8B.6)
   hay DAO nâng theo độ lớn cộng đồng? Cần lịch nâng `F` khi Nakamoto coefficient thực vượt
   `⌈t·F⌉` (§8B.5) để trần `1/F` tự nới. **DAO/EXEC.**
10. **Loại quyết định "trọng yếu" áp sàn cứng `|S|≥F` (§8B.4):** FEAT định danh sách loại + chế độ
    hội đồng bảo trợ khi khóa. **FEAT/EXEC.**

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

### Vòng audit nguyên lý 5 (clamp BFT §8B) — 2026-06-05

Audit phản biện riêng cho mục §8B (sàn phi tập trung Byzantine) nêu 5 finding; xử lý:

1. **[major, đã sửa]** Bảng §8B.3 tính 7/14/21 DID trên mẫu số `ΣVP = W(P)` (toàn phe tham gia,
   gồm TRẮNG), nhưng ngưỡng §8.2 cho phép `W(base) = W(S)+W(O)` (TRẮNG **ngoài** mẫu số) — hai mẫu
   số khác nhau khi có TRẮNG. Bổ đề (13) chỉ ràng buộc `|G|` theo tỷ lệ của `ΣVP=W(P)`, KHÔNG trực
   tiếp suy "cần 14 DID để đạt 2/3 của `W(base)`". Khi `W(base) < W(P)`, một phe THUẬN có thể đạt
   `θ` trên `W(base)` với **ít hơn** `⌈θ·F⌉` DID. **Đã sửa:** thêm khối ghi chú ngay dưới bảng
   §8B.3 nêu rõ mẫu số bảng = `W(P)`, cảnh báo `W(base) ≤ W(P)` làm số DID thuận tối thiểu nhỏ hơn
   `⌈θ·F⌉`; con số 7/14/21 là cận chặt **chỉ khi `W(base)=W(P)`**; sàn cứng `|S|≥F` (14) mới là chốt
   chặn rời rạc bất kể TRẮNG (đếm người trên phe THUẬN, không qua mẫu số).
2. **[minor, đã sửa]** Dòng `t=1` của bảng ("100% cần 21 DID") dễ đọc nhầm thành điều kiện ĐỦ.
   "100% của `ΣVP`" về toán đòi mọi DID trong `P` max-clamp VÀ `|P|=F`; nếu `|P|>F` phân bố không
   đều thì không tập 21 DID nào gom đủ 100%. **Đã sửa:** đổi diễn giải dòng `t=1` sang nghĩa cận
   dưới (điều kiện CẦN, "tối thiểu 21 DID, mỗi DID phải max-clamp; `⌈t·F⌉` không bảo đảm đủ") + thêm
   ghi chú riêng, nhất quán câu mở §8B.3 ("số DID tối thiểu để **đạt** `t`").
3. **[minor, đã sửa]** Tương tác clamp BFT ↔ cap C4 ở trường hợp biên chưa định lượng: cap C4 chặn
   trong-một-cử-tri, KHÔNG chặn **nhóm nhỏ** DID mỗi DID đã max cả 4 yếu tố; clamp BFT là cơ chế
   DUY NHẤT chặn trường hợp đó. **Đã sửa:** thêm khối định lượng ở §8B.5 — clamp **bắt đầu cắn** lên
   các DID max-VP khi số DID đạt `VP_max` còn `< F` (khi đó `τ=ΣVP/F < VP_max`), và **ngừng cắn**
   khi `≥ F` DID cùng đạt `VP_max` (`τ ≥ VP_max`). Nối tường minh cap C4 (§3, trong-cá-nhân) ↔
   clamp (§8B, giữa-cá-nhân), định lượng ngưỡng `m = F`.
4. **[nit, KHÔNG sửa nội dung]** Hai link nền BFT không tự verify được trong môi trường sandbox:
   PBFT (`https://pmg.csail.mit.edu/papers/osdi99.pdf`) trả ECONNREFUSED; Nakamoto coefficient
   (`https://news.earn.com/quantifying-decentralization-e39db233c28e`) lỗi chứng chỉ TLS. **Cả hai
   là URL kinh điển có thật** (Castro–Liskov OSDI 1999; bài Balaji trên news.earn.com), lỗi do
   sandbox mạng/chứng chỉ chứ KHÔNG phải link bịa. Link Tendermint/CometBFT, Wikipedia
   (Generalized_mean, CES, Cobb–Douglas, Supermajority, LogSumExp, Weighted_geometric_mean,
   Zero_to_the_power_of_zero), Aiken Int, Cardano epoch đều là nguồn chuẩn thật. **Việc cần làm khi
   có mạng sạch:** chạy lại verify hai link PBFT + Nakamoto một lượt; cân nhắc thêm mirror
   archive.org cho bài Nakamoto (domain earn.com là domain cũ Coinbase, có thể redirect) để bền lâu.
5. **[nit, đã sửa]** §8B.6 tính `⌊20/3⌋=6` đúng nhưng có thể nối chặt hơn với bảng §8B.3. **Đã
   sửa:** thêm nửa câu nối — `f=6` khớp cả hai cách phát biểu ((i) `3f+1`; (ii) phần độc hại `<1/3`,
   `6/21<1/3≤7/21`), và `7/21=1/3` là **đúng ranh giới** = bảng §8B.3 (7 DID = đúng `1/3` = ngưỡng
   một phe độc hại bắt đầu phủ quyết được), nên chịu an toàn tối đa `f=6 < 7`. Củng cố nhất quán nội
   bộ f=6 ↔ ngưỡng 7-DID.

**Ghi chú anchor (không phải bất đồng, chỉ chỉnh dẫn chiếu cho đúng):** finding #3 đề nghị trỏ
"FEAT §10 câu 4 (khóa weight trong kỳ)". Khi đối chiếu file FEAT thực tế, **FEAT §10 câu 4** hiện
nói về quy trình đổi **cap C4** (hai vòng bỏ phiếu), KHÔNG phải khóa weight; câu treo về snapshot/
khóa luật giữa chừng nằm rải ở FEAT §4.4 + §10 câu 2. Bất biến khóa-weight được neo chắc nhất vào
**TECH §5.6** (`weight_param_ref` khóa bảng weight theo proposal). MATH giữ dẫn chiếu tới TECH §5.6
làm trụ, và ghi FEAT §10 câu 4 như điểm cần FEAT bổ sung mục "khóa weight trong kỳ" cho khớp I-1.
→ Đề nghị FEAT thêm một câu treo riêng cho khóa-weight để ba spec khớp tường minh (KHÔNG phải lỗi
MATH, là việc đồng bộ liên-spec).

---

## 16. Phản hồi reconcile 2026-06-05 (áp D7 + D8 từ CONTRACT §5)

Vòng reconcile interface (CONTRACT §5) áp hai quyết định ghim cứng vào MATH; truy vết sửa:

**Áp D7 — thuật toán VP khả thi on-chain (bảng tra, KHÔNG log-sum).**
- Viết lại toàn bộ **§11** từ "ổn định số học / hướng log-sum-exp" sang **thuật toán đã chốt**:
  bảng 1-chiều `pow_k[c]=round(c^{w_k}·SCALE)` (T1) + nội suy tuyến tính giữa mốc (T2) +
  `power_i=(∏_{k} pow_k(x_{k,i}))/SCALE^{K−1}` (T3) trên Aiken `Int` bignum (không tràn). Cite D7.
- §11.3 đặc tả **SCALE + ba nguồn sai số** (lượng tử hóa thang, nội suy knots bậc hai theo độ cong,
  chia nguyên) + cận sai số tương đối tổng `⪅ K·ε_tab`; khuyến nghị `SCALE=10^9`, `ε_tab≤10^{−4}`.
- §11.4 thêm **property test bắt buộc PT1–PT5** (sai số chặn, bảo toàn thứ tự, biên geometric,
  nội suy-không-vượt-đường-cong lõm, đơn điệu bảng) — so `VP_int` với `VP_float`.
- §11.6 hạ hướng **log-sum/exp xuống "phương án thay thế, KHÔNG dùng v1"** (giữ truy vết).
- **Gỡ treo §14 câu 3**: từ câu hỏi mở "có cần exp không" → đã chốt bảng tra; chỉ còn TECH chốt
  `SCALE`/lưới mốc/`ε_tab` + chạy PT1–PT5.

**Áp D8 — chống đòn bẩy mua-bằng-tiền (C2+C4).**
- Thêm **§6B** (Bất biến): ràng buộc cứng **(W1) `w_2+w_4 ≤ w_1+w_3`** — tổng weight nhóm
  mua-được-bằng-tiền `MONEY={2,4}` ≤ tổng weight nhóm cần-thời-gian `TIME={1,3}`. Chứng minh
  first-principles (§6B.2): weight = độ co giãn VP theo log (`∂lnVP/∂ln x_k=w_k`) → (W1) chặn biên
  đòn bẩy vốn ≤ 1/2 (§6B.3).
- §6B.4 thêm **(W2)**: `C2` chỉ tính dương nếu LAMP **đã khóa ≥ `N_2` epoch** (chi-phí-thời-gian,
  như C1) — khóa-tức-thời → `C2=0`. Chống flash-fill kiểu §10.5 cho C2.
- Nâng W1+W2 thành **Bất biến cứng I-5 (§12.2)**; thêm `N_2` + ràng buộc W1 vào bảng tham số mở
  §12.1; cập nhật §10.3 bảng bản chất chi phí dòng `C2` (khóa qua `N_2` epoch).
- **Nâng §14 câu 5** từ treo ("cần định lượng cap_2") thành **ràng buộc đã chốt** (W1+W2); chỉ còn
  `cap_2`, `N_2`, bảng weight cụ thể là DAO định (miễn thỏa W1).
- §13 cập nhật phụ thuộc TECH: ép W1 lúc nạp bảng weight + ép W2 khi đọc beacon C2 (gắn CONTRACT D9
  — beacon C2 nhúng mốc khóa để xác thực `N_2` byte-perfect on-chain).

**Giữ nguyên (không đụng):** §8.2 ngưỡng `≥θ` làm chuẩn (D1) — mọi mục VP_eff/gom phe vẫn chạy trên
`power_i` nguyên thang `SCALE`, không đổi định nghĩa ngưỡng. Bất biến I-1 (khóa weight theo kỳ) nay
phủ thêm `SCALE`/bảng `pow_k`/lưới mốc (khóa cùng kỳ, §11.7). LAMP không burn + per-capita +
clamp BFT 1/21 + định giá ở app: KHÔNG đụng.

---

*Hết MATH. Phần TECH sẽ chốt `SCALE` + lưới mốc + `ε_tab` cho bảng tra `pow_k` (D7) + chạy property
test PT1–PT5, cách đo C_k (gồm ép W1/W2 của D8), datum/redeemer on-chain, và cách tính VP_eff
(clamp BFT §8B) đúng thứ tự cap→clamp + đếm `|S|` cho sàn cứng số-DID.*
