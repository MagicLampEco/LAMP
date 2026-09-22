# Capped Drop — SPEC FEAT (hành vi)

**Doctype:** MagicLamp Protocol — Onchain Spec (Feature/Behavior)
**Version:** v3 "Capped Drop" — chỉ số cộng dồn + trần lõm + cắt ngọn
**Updated:** 2026-09-22
**Nguồn chuẩn (interface contract):** [`capped-drop/CONTRACT.md`](./CONTRACT.md) — **v3**
**Chứng minh toán:** [`capped-drop/Math-Spec.md`](./Math-Spec.md) — **v3**

---

## 0. Vì sao v2 → v3

v2 tính `vested = tốc_độ(bây_giờ) × số_cửa_sổ_đã_trôi`. Dạng đó có một tính chất không ai muốn:
**mọi thừa số giảm được đều hạ `vested` HỒI TỐ**, xuống dưới phần đã rút, và khoá tài khoản lại.
Tham số tốc độ là tham số đổi được hai chiều, nên đó không phải rủi ro lý thuyết — một lượt hạ
10% khoá mọi tài khoản đã chạy từ 9 cửa sổ trở lên, trong khi không bất biến nào vỡ.

v3 đổi ba thứ ở tầng hành vi:

| v2 | v3 |
|---|---|
| tốc độ tuyệt đối `D` cho mọi cỡ pot | tốc độ **lõm theo cỡ**: pot to mở khoá chậm hơn theo tỉ lệ |
| `vested` tính lại từ tốc độ HIỆN TẠI | `vested` đọc từ một **chỉ số cộng dồn**, quá khứ định giá bằng tốc độ CŨ |
| rút bao nhiêu cũng được, miễn đã vested | thêm **cắt ngọn**: một lượt rút không vượt một tỉ lệ của lượng LAMP đang lưu hành |

---

## 1. Khái niệm

| Tên | Ký hiệu | Ý nghĩa |
|---|---|---|
| Entitlement | `E` | Tổng LAMP một tài khoản được phân bổ. Chỉ tăng, không giảm. |
| Cửa sổ | `t` | Đơn vị thời gian mở khoá. **Không phải "ngày"** — xem §1.1. |
| Chỉ số cộng dồn | `A(t)` | Một con số toàn cục chỉ tăng, beacon giữ. Thay cho "tốc độ hiện tại". |
| Gốc tốc độ | `w` | `rate_root` — nhịp tăng của `A` mỗi cửa sổ. **Chỉ được NỚI, không được siết.** |
| Mốc mở tài khoản | `a₀` | `index_at_start` — giá trị `A` chụp lúc tài khoản được mở. |
| Quãng | `A_span` | `A(t) − a₀`. Thứ thay cho "số cửa sổ đã trôi" của v2. |
| Vested | `vested(t)` | Tổng đã mở khoá. Đơn điệu không giảm, trần `E`. |
| Redeemed | `redeemed` | Tổng đã rút ra ví, tích luỹ. |
| Lưu hành | `C` | `total_redeemed` — tổng LAMP đã phát ra toàn hệ, mọi đợt cộng lại. |
| Cắt ngọn | `κ` | `trim_num/trim_den`, mặc định `1/1000`. Trần cho **một lượt rút**. |
| Sàn cắt ngọn | `trim_floor` | 1.000 LAMP. Hằng, không đổi được bằng tham số. |

Mọi giá trị LAMP là số nguyên **oildrop**: 1 LAMP = 1.000.000 oildrop.

### 1.1 "Cửa sổ" dài bao nhiêu — đọc kỹ, nó không phải ngày

`Utils/src/index.ts` ▸ `MS_PER_EPOCH_BY_NETWORK`:

| mạng | một cửa sổ |
|---|---|
| Preview | 86.400.000 ms = **1 ngày** |
| Preprod | 432.000.000 ms = **5 ngày** |
| Mainnet | 432.000.000 ms = **5 ngày** |

Nên **cùng một con số cửa sổ cho hai lịch khác nhau gấp 5 lần** tuỳ mạng. Mọi ví dụ dưới đây
quy ra thời gian theo Mainnet (5 ngày/cửa sổ, ≈73 cửa sổ một năm). Giá trị này đi vào **script
hash** qua apply-param, nên một lần đặt sai ở genesis không sửa được bằng cập nhật tham số.

---

## 2. Công thức trung tâm

**Mở khoá** (tích luỹ, không ai phải làm gì):

```
A(t)       = index + rate_root · (t − epoch)        ← đọc từ beacon, dạng đóng
A_span     = A(t) − index_at_start
vested(t)  = min( E , √E · A_span )
```

**Rút** (mỗi lượt, trần riêng):

```
amount ≤ vested(t) − redeemed
amount ≤ max( trim_floor , C · κ )
```

Hai dòng cuối là **hai trần khác nhau, chặn hai thứ khác nhau**: dòng trên chặn *đã mở khoá
được bao nhiêu*, dòng dưới chặn *một lượt được mang đi bao nhiêu*. Vượt trần dưới **không mất
phần thừa** — nó ở lại và rút được ở lượt sau.

> **Vì sao có `√`.** Nếu tốc độ không phụ thuộc cỡ pot thì tách một pot thành `n` phần làm tổng
> tốc độ nhân `n` — trần tự huỷ. Luật căn làm nó chỉ nhân `√n`. Chứng minh:
> [`Math-Spec.md`](./Math-Spec.md) §8.

> **Validator không tính `vested`.** Người dựng giao dịch **XIN** một con số, validator **KẸP**
> bằng phép so sánh số nguyên `(redeemed + amount)² ≤ E · A_span²`, không có phép khai căn nào
> chạy on-chain. Xem [`Math-Spec.md`](./Math-Spec.md) §6.

---

## 3. Hành vi cốt lõi: entitlement → tích luỹ → rút

### 3.1 Mở tài khoản (cấp entitlement)

Committee M-of-N xác nhận một ví đáng nhận `E` LAMP, tạo `ClaimAccount` UTxO:

```
ClaimAccount {
  owner            = PKH ví,
  entitlement      = E,
  redeemed         = 0,
  start_epoch      = cửa sổ hiện tại,
  drops_per_epoch  = 1,          // GHIM == 1, không còn là núm điều chỉnh (§5.1)
  index_at_start   = A(bây giờ), // MỐC. Bất biến suốt đời tài khoản
}
```

`index_at_start` là trường **mới ở v3** và là thứ dễ hiện thực sai nhất: nó phải nằm trong danh
sách trường bị ép bất biến khi rút, không phải được suy ra là bất biến. Ghi đè được nó nghĩa là
người rút **tự đặt lại gốc thời gian của chính mình**.

### 3.2 Mở khoá (KHÔNG cần giao dịch, KHÔNG cần ai còn sống)

`vested` tự tăng theo `A`, và `A` đọc được ở **dạng đóng** từ beacon gần nhất. Hệ quả hành vi:

- **Bỏ lỡ cửa sổ không mất gì.** Tích luỹ từ `index_at_start`, không có nhánh nào làm `A` giảm.
- **Committee ngừng post cũng không làm ai đứng lại.** Giữa hai lượt post, `A` vẫn chạy tiếp với
  `rate_root` đã post lần cuối. Đây là khác biệt hành vi lớn so với mọi thiết kế cần một giao
  dịch mỗi cửa sổ: **không có phụ thuộc liveness**.
- **Tốc độ chỉ được nới.** Committee tăng `rate_root` thì mọi người nhanh hơn kể từ cửa sổ đó;
  họ **không** hạ được. Quyền siết nằm ở kênh cắt ngọn, nơi nó chỉ hoãn chứ không xoá.

### 3.3 Rút (permissionless)

Owner ký giao dịch tiêu `ClaimAccount`, **kèm số tiền muốn rút**. Validator ép:

1. Phần xin không vượt phần đã mở khoá — kẹp bằng bình phương, không khai căn.
2. Phần xin không vượt trần cắt ngọn của lượt này.
3. Out datum: `redeemed' = redeemed + amount`; `owner`, `entitlement`, `start_epoch`,
   `drops_per_epoch`, **`index_at_start`** bất biến.
4. Kho nhả đúng `amount` cho owner; `tre_out.value = tre_in.value − amount`. **Không burn.**
5. Sổ lưu hành tăng đúng `amount`: `total_redeemed' = total_redeemed + amount`.
6. Chống double-satisfaction: đếm theo payment script hash.

Không cần proof, không cần committee, không cần chờ ai.

---

## 4. Ba hồ sơ ví

Tốc độ mỗi cửa sổ là `w · ⌊√E⌋`; số cửa sổ để hết là `⌈√E / w⌉`. Với `w = 77.460`:

| pot | mỗi cửa sổ | số cửa sổ | thời gian (Mainnet) | cắt ngọn có ráo không? |
|---|---|---|---|---|
| 1.000 LAMP | 2.449 LAMP | **1** | 5 ngày | không |
| 1 triệu LAMP | 77.460 LAMP | **13** | ~2 tháng | không |
| 2.379.930 LAMP (ETD-max) | 119.497,70 LAMP | **20** | ~100 ngày | không |
| 6 tỷ LAMP | 6.000.025,73 LAMP | **1.000** | ~13,7 năm | **có** |

### 4.1 Ví nhỏ — xong trong một cửa sổ

Tốc độ lõm nên ví nhỏ **nhanh tương đối**: 1.000 LAMP mở khoá 2.449 LAMP ngay cửa sổ đầu, tức
trọn `E`. Đây cũng là chỗ `trim_floor = 1.000 LAMP` được suy ra — nó phải đủ để một ví cỡ này
mang hết đi trong một lượt, kể cả khi lưu hành còn bằng 0.

### 4.2 Ví lớn — cắt ngọn bắt đầu ráo từ đâu

Cắt ngọn chỉ ráo khi tốc độ mỗi cửa sổ vượt trần một lượt rút, tức `w·√E > κ·C`. Ở lưu hành
1 tỷ LAMP (`κ = 1/1000` ⟹ trần 1 triệu LAMP/lượt), ngưỡng là **`E > ≈167 triệu LAMP`**.

Nghĩa là: **mọi pot dưới 167 triệu LAMP không bao giờ chạm cắt ngọn ở mức lưu hành đó** — kể cả
ETD-max. Cắt ngọn là cơ chế chỉ nói chuyện với pot rất lớn.

> Ví dụ đúng bản chất: pot 6 tỷ mở khoá ~6 triệu LAMP một cửa sổ, nhưng một lượt rút chỉ mang
> được 1 triệu. Xin 3 triệu thì **nhận 1 triệu, không phải bị từ chối** — 2 triệu còn lại vẫn là
> quyền, rút ở lượt sau. Muốn lấy hết phần của một cửa sổ thì rút nhiều lượt.

### 4.3 Đa-claim — v3 KHÔNG còn độc lập lộ trình

Ở v2, rút nhiều lần hay một lần cho **cùng một tổng**. Ở v3 **không còn đúng**: cắt ngọn chặn
từng lượt, nên dồn tất cả vào một lần rút cuối có thể nhận ít hơn rút đều mỗi cửa sổ.

Đây là hệ quả cố ý, nhưng nó là một **cái bẫy giao diện**: người dùng không tự đoán ra. Giao
diện **bắt buộc** tách hai con số và đừng gộp:

- *"rút được lượt này"* = `min(vested − redeemed, trần_cắt_ngọn)`
- *"còn lại tổng"* = `E − redeemed`

Không tách thì mỗi lần cắt ngọn bị đọc như một lần tịch thu, trong khi không đồng nào mất.

---

## 5. Hooks — cái gì đóng hẳn, cái gì chừa chỗ

### 5.1 Multi-drop per-account — ĐÃ ĐÓNG, không còn là hook

v2 chừa `drops_per_epoch` cho DAO chỉnh. v3 **ghim `= 1`**. Lý do: nó nhân thẳng vào tốc độ và
nằm **ngoài** tổng tích luỹ, nên hạ nó viết lại toàn bộ lịch sử (`= 0` khoá tài khoản vĩnh viễn);
và phép hiệu chỉnh tốc độ đã giả định `= 1` từ đầu, nên để nó tự do là cấp hai núm cho cùng một
đại lượng, núm thứ hai thì per-account và tuỳ nghi.

Trường vẫn giữ trong datum — một cửa sau bị khoá bằng một mệnh đề ép thì rõ hơn một cửa sau bị
xoá. Mở lại ở v4 thì phải kèm một **cơ sở đo được trên chuỗi** để phân biệt tài khoản; hôm nay
không có cơ sở nào như thế.

### 5.2 Hệ số tiêu thụ MAGIC — CHỪA CHỖ, để RỖNG ở lượt đúc này

Beacon mang một danh sách policy (`speed_policies`) hiện **rỗng**. Khi bật, mức tiêu thụ MAGIC
của một người nâng trần **cắt ngọn** của họ — tức ở kênh chỉ-hoãn, không phải kênh tốc độ.

🔴 **Điều kiện CHẶN, không phải một mục cần cân nhắc:** cam kết DID mà mọi bản ghi tiêu thụ dựa
vào **không được xác thực**. Nó là một hash nằm công khai trên chuỗi, ai đọc cũng chép được vào
vault hoặc thread của mình, nên nó dùng được để **quy kết** nhưng không dùng được cho thứ mà nói
dối có lợi — và một hệ số nâng trần rút **chính là** phân bổ phần thưởng. Giới hạn này giống nhau
ở **cả hai** đường tiêu thụ, nên đổi đường không cứu. Móc chỉ bật được sau khi có một **liên kết
được xác thực** giữa tài khoản phân phối và bản ghi tiêu thụ, và việc đó đổi validator.

Ba ràng buộc còn lại, chốt trước khi bật vì chúng đổi cả hành vi:

1. **Là HỆ SỐ, không phải CỔNG.** Tài khoản tiêu 0 MAGIC vẫn phải vest đúng lịch của nó. Nhóm
   ETD được chọn bằng snapshot uỷ thác ADA nên tiêu 0 MAGIC **theo cấu tạo** — một cổng ở đây
   biến pot được thiết kế để phát trước thành pot chậm nhất hệ.
2. **Phải BÃO HOÀ.** Một người mở được nhiều thread và tự chọn thread nào để trỏ vào, nên hệ số
   không được là hàm tăng không chặn — nếu không thì dồn hoạt động vào một thread là một trục để
   chơi, và nó miễn phí.
3. **Không có đại lượng "tổng tiêu thụ".** Hai bộ đếm nằm ở hai module rời nhau, không mệnh đề nào
   đọc trường của bên kia. Mọi câu về tiêu thụ phải nói rõ **đường nào**.

### 5.3 Pause / penalty — BỎ, không chuyển sang v3

v2 định cho DAO đặt tốc độ `= 0` trong `N` cửa sổ như hình phạt. Ở v3 điều đó **không hiện thực
được mà không phá bất biến trung tâm**: mọi đường hạ tốc độ đều nằm ở kênh chỉ-nới. Cần cơ chế
phạt thì phải thiết kế ở kênh cắt ngọn và phải chứng minh nó không đẩy ai về điểm hấp thụ.

---

## 6. Giữ nguyên từ v2

ClaimAccount per-wallet UTxO · `treasury.ak` + ba bản vá audit · bộ e2e · codec datum nền · luồng
cấp entitlement bằng committee M-of-N.

---

## 7. Bất biến hành vi (đặt tên để test truy vết)

| ID | Phát biểu | Neo |
|---|---|---|
| **F-VEST-1** | `vested(t) = min(E, √E · A_span)`, tất định từ datum + beacon + validity range | Math §1 |
| **F-VEST-2** | `vested` đơn điệu không giảm theo `t`, **không cần giả thiết tham số cố định** | Math §3 |
| **F-VEST-3** | `vested ≤ E` mọi `t` | Math §3 |
| **F-VEST-4** | Committee ngừng post ⟹ `vested` vẫn tăng đúng nhịp `rate_root` cuối | Math §2 HQ 1.1 |
| **F-VEST-5** | Một lượt post mới KHÔNG đổi `vested` của bất kỳ ai tại thời điểm quá khứ | Math §2 HQ 1.2 |
| **F-RDM-1** | Người rút XIN `amount`; validator KẸP. `amount > 0` | CONTRACT §4 |
| **F-RDM-2** | Out datum: `redeemed' = redeemed + amount`; `owner`/`entitlement`/`start_epoch`/`drops_per_epoch`/**`index_at_start`** bất biến | CONTRACT §4 |
| **F-RDM-3** | Kho nhả đúng `amount`; `tre_out.value = tre_in.value − amount`; không burn | CONTRACT §4 |
| **F-RDM-4** | Owner ký. Permissionless với owner | CONTRACT §4 |
| **F-RDM-5** | Đúng 1 ClaimAccount input + 1 output cùng payment script hash | CONTRACT §4 |
| **F-TRIM-1** | `amount ≤ max(trim_floor, C·κ)`; vượt trần ⟹ **cắt xuống, KHÔNG từ chối** | CONTRACT §4 |
| **F-TRIM-2** | Phần bị cắt KHÔNG mất — vẫn rút được ở lượt sau; hoàn tất sau hữu hạn lượt | Math §5 |
| **F-TRIM-3** | `C = 0` vẫn rút được nhờ `trim_floor > 0` | Math §5 HQ 4.1 |
| **F-SUM-1** | Tổng nhận `= redeemed_cuối ≤ min(E, vested(t_cuối))` | Math §10 |
| **F-SUM-2** | ⚠ Tổng nhận **PHỤ THUỘC LỘ TRÌNH** — rút đều có thể nhiều hơn dồn một lần | Math §10 |
| **F-SMALL-1** | `E = 1.000 LAMP` ⟹ rút trọn trong **1** cửa sổ | §4.1 |
| **F-LARGE-1** | Hết sau đúng `⌈√E / w⌉` cửa sổ | Math §7 |
| **F-LARGE-2** | Tách `E` thành `n` phần chỉ nhanh gấp `√n`, không phải `n` | Math §8 |
| **F-DPE-1** | `drops_per_epoch == 1` với **mọi** tài khoản; mở với giá trị khác ⟹ từ chối | CONTRACT §1b |

---

## 8. Luồng kiểm hành vi

```
1.  Mở: A nhận E=1.000 LAMP; B nhận E=6.000.000.000 LAMP. Cả hai dpe=1, index_at_start=A(bây giờ).
2.  Ví nhỏ A: cửa sổ 1 → vested = E → rút trọn 1.000. Xong. (F-SMALL-1)
3.  A rút lại cùng cửa sổ → amount = 0 → từ chối. (F-RDM-1)
4.  Ví lớn B, lưu hành C = 1 tỷ: cửa sổ 1 mở ~6.000.025 LAMP, nhưng XIN 3.000.000
    → NHẬN 1.000.000, không phải bị từ chối. (F-TRIM-1)
5.  B rút tiếp trong cùng cửa sổ → lại 1.000.000. Phần bị cắt không mất. (F-TRIM-2)
6.  Committee KHÔNG post gì suốt 10 cửa sổ → B vẫn vest đúng nhịp. (F-VEST-4)
7.  Committee post rate_root THẤP HƠN → PHẢI bị từ chối. (CONTRACT §3b)
8.  Committee post rate_root cao hơn → vested của B tại một cửa sổ QUÁ KHỨ không đổi. (F-VEST-5)
9.  Sửa index_at_start trong out datum → từ chối. (F-RDM-2)
10. B chạy tới cửa sổ 1000 → redeemed chạm ĐÚNG E. Với rate_root = 77.459 thì
    cửa sổ 1000 CHƯA chạm, và chạm ở cửa sổ 1001 — trễ đúng một cửa sổ, KHÔNG
    phải "không bao giờ". Kiểm cả hai mốc. Phải chạy tới 1000 thật: ở n nhỏ hai
    giá trị cho kết quả GIỐNG HỆT NHAU. (F-LARGE-1, Math M-ROOT-CEIL)
11. Mở tài khoản với dpe = 2 → từ chối. (F-DPE-1)
12. Lưu hành C = 0, ví 1.000 LAMP vẫn rút được. (F-TRIM-3)
13. Bảo toàn: Σ amount ≤ Σ E; tre_out = tre_in − Σ amount; mint == 0;
    total_redeemed tăng đúng Σ amount.
14. Double-satisfaction: 2 ClaimAccount input chung stake credential trong 1 tx → từ chối.
```

Bước 10 là bước dễ bỏ nhất — một bài kiểm ngắn xanh ở **cả hai** giá trị `rate_root`, nên nó
không kiểm gì. Chứng minh số học: [`Math-Spec.md`](./Math-Spec.md) §7.
