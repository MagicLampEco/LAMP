# Treasury — MATH (Cơ sở toán)

**Trạng thái:** draft 2026-06-05 (chờ anh duyệt). Một trong 4 spec FEAT/MATH/TECH/EXEC của hệ Treasury.
Bám **`Treasury/CONTRACT.md`** (xương sống) — tài liệu này KHÔNG mâu thuẫn nó; nó chỉ **chứng minh hình thức**
các bất biến mà CONTRACT phát biểu.

---

## 0. Mục tiêu + phạm vi

### 0.1 Mục tiêu

Đặt nền toán học chặt chẽ cho Treasury, đủ để 2 nhóm còn lại (TECH viết validator, EXEC tích hợp caller)
suy ra mã từ định lý chứ không từ trực giác. Cụ thể chứng minh:

1. **Bảo toàn value tuyệt đối** trên mọi giao dịch Treasury: `Σ_out = Σ_in` cho **mọi** asset — KHÔNG có
   nhánh nào làm giảm tổng cung (không burn). (CONTRACT §5.)
2. **Định nghĩa hình thức `circulating`** = tổng cung − Σ balance các instance Treasury − LAMP chưa phát hành
   (undistributed, còn trong Distribution). "Giảm lưu hành" là **đại lượng kế toán**, không phải đốt on-chain.
3. **Số học split** của `collectToTreasury`: `cut = ⌊amount × cut_bps / 10000⌋`, tái dùng họ số nguyên
   BigInt của `Utils`. Chốt chủ đích làm tròn: **floor cut = ưu ái người nộp/provider** (treasury
   giữ ≤ phần lý thuyết, crumb <1 oil nghiêng về phía RA). An toàn của hệ KHÔNG đến từ hướng làm tròn mà từ
   **bảo toàn value** (`==` đẳng thức + TOTAL-CONSERVE — vá lần 2 F9; trước là `≥`) — xem §2.3, §3.1.
4. **Bất biến theo lô (batch):** gộp N lệnh `collect` trong một settlement tx vẫn bảo toàn tổng và đúng
   tổng cut.
5. **Cổng release = vị từ boolean `pass(P)`** đọc từ Governance (Treasury KHÔNG tự kiểm ngưỡng — T5/T1/D3;
   ngưỡng + clamp BFT do Governance ép trước) + **tính chất chống drain** (không tx nào rút value vượt phần
   được phép).

### 0.2 KHÔNG thuộc spec này (ranh giới)

- **Định giá phí** (bao nhiêu LAMP cho 1 hành động, bò ≠ gà): thuộc **app** (OriLife `animal_fee`,
  MAGIC AppEconomics). MATH chỉ nhận `amount` đã chốt. (CONTRACT §3.5.)
- **Quy đổi LAMP↔USD/ADA** (oracle TWAP): thuộc app/caller, NGOÀI Treasury. (CONTRACT §7.)
- **Cú pháp datum / layout UTxO / chữ ký validator**: thuộc **TECH**. MATH nói "tồn tại đại lượng X trong
  trạng thái", TECH nói "X mã hoá ở field nào".
- **Số cuối của tham số mở** (`cut_bps`, ngưỡng từng bucket, kích thước lô): **DAO định**. MATH cho **dạng**
  + **ràng buộc miền giá trị**, không bịa số.
- **Logic governance vote** (cách tính Voting Power): thuộc hệ Governance đã chốt; MATH chỉ dùng **kết quả**
  (một vị từ boolean "proposal P đã pass") qua reference input.

---

## 1. Ký hiệu + miền giá trị

Mọi đại lượng value là **số nguyên không âm**, đơn vị nhỏ nhất on-chain (lovelace cho ADA; **oil** cho
LAMP, `1 LAMP = 10^6 oil` — `Utils`: `OIL_PER_LAMP = 1_000_000`). KHÔNG dùng số thực ở mọi nơi
ảnh hưởng value (nguyên tắc `Utils`: "ALL arithmetic BigInt. No Number for oil/nanogic/Q values").

| Ký hiệu | Nghĩa |
|---|---|
| `A` | tập asset (mỗi asset = cặp `(policy_id, asset_name)`; ADA = `(∅, ∅)` / lovelace) |
| `Value` | hàm `A → ℤ≥0` (multiset); cộng theo từng asset (Cardano `cardano/assets.Value`) |
| `v(a)` | lượng asset `a` trong `Value v` |
| `S_total(a)` | tổng cung cố định của asset `a`. LAMP: `S_LAMP_TOTAL = 36×10^15 oil` (cố định **tuyệt đối**) |
| `T` | tập **instance** Treasury (đa thuê bao). MagicLamp = một phần tử |
| `bal_I(a)` | tổng lượng asset `a` đang nằm trong custody của instance `I ∈ T` |
| `cut_bps` | tỷ lệ cắt protocol, đơn vị **basis point** (1 bp = 1/10000). Tham số mở |
| `Q` | hằng Q-format `= 10^9` (`Utils.Q`), dùng cho tỷ lệ phần-bucket nếu cần độ phân giải cao |

**Quy ước phép cộng Value** (theo `cardano/assets`): `(u + w)(a) = u(a) + w(a)` ∀a. Giá trị có thể
khuyết một asset ⇔ lượng asset đó = 0 (multiset rút gọn). Tham chiếu: Aiken stdlib `cardano/assets`
<https://aiken-lang.github.io/stdlib/cardano/assets.html>.

---

## 2. Bảo toàn value tuyệt đối (bất biến lõi)

### 2.1 Tiên đề nền: bảo toàn của sổ cái Cardano

Cardano ledger **bắt buộc** mọi giao dịch hợp lệ thoả, cho **mọi** asset `a`:

```
Σ_{i ∈ inputs} i.value(a) + mint(a)  =  Σ_{o ∈ outputs} o.value(a) + fee·[a = ADA]
```

(Cân bằng "value preservation" / POV — Preservation Of Value của ledger spec. Tham chiếu: Cardano Ledger
Shelley spec, "Preservation of Value"; CIP chung về ledger
<https://github.com/IntersectMBO/cardano-ledger>.)

Với token đã **đóng băng policy** (LAMP one-shot mint xong, không mint thêm — mẫu beacon/one-shot ở
Distribution), `mint(LAMP) = 0` trong **mọi** tx sau giai đoạn phát hành. Do đó với LAMP:

```
Σ_{inputs} i.value(LAMP)  =  Σ_{outputs} o.value(LAMP)        (POV-LAMP)
```

ADA có thêm số hạng `fee`; nhưng **fee đi vào** reward pot / kho bạc Cardano (theo tham số tiền tệ Shelley),
KHÔNG đốt ADA — tổng cung ADA toàn mạng bảo toàn ở tầng ledger. (Nguồn đúng cho mệnh đề fee là **Shelley
ledger / monetary policy**, KHÔNG phải CIP-1694: CIP-1694 là governance Conway, không chứng minh cơ chế fee.
Tham chiếu: Cardano Ledger Shelley spec — fee/reward & POV <https://github.com/IntersectMBO/cardano-ledger>.
CIP-1694 chỉ dùng cho phần treasury donation/withdrawal ở §5.2.) Phần dưới chỉ xét **delta nội bộ Treasury**,
nơi ta không trả fee từ custody (fee trả từ ví người gửi — xem §6).

### 2.2 Bất biến Treasury (phát biểu hình thức)

Gọi một giao dịch Treasury `tx` có:
- `IN_I` = tập input thuộc instance `I` (lọc theo **payment script hash** của `I`, xem §6),
- `OUT_I` = tập output thuộc instance `I`.

Định nghĩa **delta custody** của instance `I` cho asset `a`:

```
Δ_I(a)  :=  Σ_{o ∈ OUT_I} o.value(a)  −  Σ_{i ∈ IN_I} i.value(a)
```

**Bất biến BIV-1 (bảo toàn tổng):** không tồn tại nhánh nào trong validator Treasury làm
`Σ_{a} (tổng cung của a) giảm`. Mã hoá: validator **không bao giờ** đặt `mint(a) < 0` cho asset thuộc
`accepted_assets` (CONTRACT §5: "KHÔNG có nhánh burn, không có `deflation_bps`"). On-chain test đã chốt ở
Distribution: `expect assets.is_zero(tx.mint)` (treasury.ak C-MINT-0).

**Định lý 1 (bảo toàn tuyệt đối, dạng collect).** Trong một tx `collect` hợp lệ, với mọi asset `a`:

```
Σ_{outputs} o.value(a)  =  Σ_{inputs} i.value(a)          (TOTAL-CONSERVE)
```

*Chứng minh.* Từ POV (2.1) với `mint(a)=0` (BIV-1: không burn, không mint) và `fee` chỉ trừ ở ADA do **ví
người gửi** trả, không trừ ở phần custody. Phần value chuyển từ output-ví-người-gửi sang output-Treasury là
**tái phân bổ giữa các output cùng tx**, không tạo/huỷ value. Vế trái = vế phải. ∎

**Hệ quả (không drain bằng collect).** `collect` chỉ **làm tăng** `bal_I` (Δ_I(a) ≥ 0 cho asset được thu),
không thể rút custody — vì validator collect không cho phép nhánh `Δ_I(a) < 0` (xem §3.3, INV-COLLECT).

### 2.3 Bất biến chiều thu (tổng quát hoá generators)

CONTRACT §3.2 nâng cấp bất biến `treasury_receives_lamp ≥ lamp_paid` (đã có ở generators MAGIC) thành: với
mọi asset `a` được thu trong tx,

```
Σ_{o ∈ OUT_I} o.value(a)  ==  Σ_{i ∈ IN_I} i.value(a)  +  cut(a)       (INV-COLLECT — đẳng thức, vá lần 2 F9)
```

tức `Δ_I(a) == cut(a) ≥ 0`. **Vá lần 2 (F9) — đổi `≥` → `==` cho khớp code an toàn hơn.** `collect.value_ok`
thực tế ép **đẳng thức TUYỆT ĐỐI** `custody_out.value == merge(custody_in.value, cut_value(items))` cho MỌI
asset (`collect.ak` L177-179): custody nhận ĐÚNG `Σcut`, không dư không thiếu. Đẳng thức an toàn HƠN `≥`:
nó loại **"tip"** (nộp dư asset thu — vd tip LAMP) vốn làm `custody.value(a) > Σ Δsổ` ⇒ vỡ vế phải bất biến
sổ↔value (TECH §3). Phần `rest = amount − cut` (kể cả min-ADA của UTxO mới do CALLER trả) định tuyến RA
provider/ví caller NGOÀI custody trong cùng tx — KHÔNG cộng vào custody.value, nên đẳng thức không cấm caller
trả min-ADA (nó nằm ở output khác, không phải output custody). Kết hợp Định lý 1 (TOTAL-CONSERVE), thu
**đúng** `cut`.

> Đối chiếu code thật: chiều **release** dùng đẳng thức `custody_out.value == merge(custody_in.value,
> negate(drawn_value(draws)))` (`release.ak value_ok`) — bảo toàn TUYỆT ĐỐI mọi asset (chống drain M1).
> Chiều **collect** NAY cũng dùng đẳng thức `==` (vá lần 2 F9), KHÔNG `≥`: hai chiều cùng dấu đẳng thức,
> nhất quán, đều khóa cả hai đầu (asset thu tăng đúng cut, asset không đụng giữ nguyên).
>
> **Đối chiếu TECH §4.2 C-COL-2 (ghi rõ mâu thuẫn cũ):** C-COL-2 mô tả `≥` cho riêng ADA (min-ADA overhead).
> Code `value_ok` thực tế dùng `==` cho MỌI asset kể cả ADA — chặt hơn — vì min-ADA của UTxO custody mới
> được hạch toán qua bucket ADA reserved trong sổ (`seed_value_ok`/`reserved_min_ada`), KHÔNG để value vượt
> sổ. MATH (tài liệu chứng minh) đồng bộ về `==` theo CODE; TECH C-COL-2 nên đọc theo `==` thực thi (nếu một
> instance thật cần ADA dư ngoài sổ thì phải hạch toán reserved tương ứng để giữ đẳng thức).

---

## 3. Số học split (`collectToTreasury`)

### 3.1 Công thức cut

```
cut  =  ⌊ amount × cut_bps / 10000 ⌋            (SPLIT)
```

- `amount`, `cut_bps`, `cut` đều **số nguyên** (oil cho LAMP). `cut_bps ∈ [0, 10000]` (0% … 100%) —
  **tham số mở (DAO định)**.
- Phép chia là **chia nguyên cắt sàn** (floor). Cùng họ floor-division số nguyên BigInt với
  `Utils.mulQ(a,b)=a*b/Q` — chỉ **khác mẫu số**: bps dùng `10000`, không phải `Q=10^9`.
  > **Chú ý helper (finding 8):** `Utils` hiện CHỈ có `mulQ` (mẫu `Q`), KHÔNG có sẵn `mulBps`.
  > Cut theo bps cần helper mới `mulBps(a, bps) = a × bps / 10000` (floor) — off-chain bổ sung, đối xứng
  > với on-chain. Đừng giả định `mulQ` dùng trực tiếp được cho bps (mẫu số khác → kết quả khác).

**Hai lập luận TÁCH BẠCH — đừng trộn (finding 1).** Trước đây prose trộn vai "người rút" (release) với
"cut" (collect) và kết luận sai "floor cut ⟹ an toàn cho hệ". Phân rạch ròi:

**(1) An toàn THỰC của chiều collect KHÔNG đến từ hướng làm tròn.** Nó đến từ **bảo toàn value**:
INV-COLLECT dùng `==` (§2.3 — vá lần 2 F9; trước là `≥`) kết hợp TOTAL-CONSERVE (Định lý 1) ⟹ không oil nào
sinh ra hay biến mất; crumb làm tròn chỉ **dịch chỗ** giữa custody và provider trong cùng tx, **hệ không mất
gì**. Đây là nguồn an toàn, không phụ thuộc floor hay ceil.

**(2) Hướng làm tròn là một CHỦ ĐÍCH KINH TẾ, phải chốt rõ — không suy ra "an toàn hệ".**
- `cut` = phần protocol GIỮ LẠI vào bucket; `rest = amount − cut` định tuyến **RA** app/provider.
- **Floor `cut`** (lựa chọn hiện tại) ⟹ treasury giữ phần ≤ lý thuyết, crumb `<1 oil` rơi về phía **RA**
  (provider). Tức floor cut **ưu ái người nộp/provider**, và **bất lợi nhẹ cho HỆ** (treasury thu hụt `<1 oil`
  so với mục tiêu thu lý thuyết). KHÔNG được gọi đây là "an toàn cho hệ" — đó là mệnh đề SAI cho chiều collect.
- **Ceil `cut`** (`cut = ⌈amount·bps/10000⌉`, dùng `ceil_div` đã có ở Distribution `math.ak`) ⟹ ngược hẳn:
  treasury KHÔNG bao giờ thu hụt, crumb `<1 oil` rơi về phía người nộp.
- **Chốt (4 trục — lợi ích người dùng + đơn giản):** giữ **floor cut** (ưu ái payer). Lý do: (a) sai lệch ≤
  `1 oil = 10^{-6} LAMP` mỗi item — không đáng kể về kinh tế; (b) ưu ái người nộp hợp định hướng "lợi ích
  người dùng"; (c) bảo toàn value (lập luận 1) đã bảo đảm hệ không mất gì, nên không cần ceil để "chống hụt".
  Nếu một instance cần **đảm bảo treasury không hụt** (vd phí sàn tối thiểu), đổi sang `ceil_div` — đây là
  lựa chọn của instance đó, KHÔNG phải mặc định.

### 3.2 Phân rã không mất dư (định tuyến phần còn lại)

Đặt `rest = amount − cut`. Vì `cut = ⌊amount·bps/10000⌋ ≤ amount` (do `bps ≤ 10000`), nên `rest ≥ 0` và:

```
cut + rest  =  amount        (PARTITION, đẳng thức số nguyên chính xác — KHÔNG mất oil nào)
```

`cut` → bucket(s) (xem §3.2.1); `rest` → tuyến app (provider/node — caller chỉ định, NGOÀI Treasury). Vì
`cut + rest = amount` đúng tuyệt đối (không phải xấp xỉ), **không có oil rơi rớt** trong split. Đây là điểm
mấu chốt: ta định nghĩa `rest` bằng **phép trừ** (`amount − cut`), KHÔNG bằng `⌊amount·(10000−bps)/10000⌋`
độc lập — cách thứ hai có thể lệch `1 oil` so với `amount` (lỗi double-rounding). **Luôn lấy một phần bằng
floor rồi phần kia bằng phép trừ.**

### 3.2.1 Phân `cut` về bucket — dạng CHÍNH đơn-bucket; PARTITION-MULTI là tùy chọn

**Áp T2 (CONTRACT §9).** Dạng **mặc định + chính** là **đơn-bucket**: `cut` vào **đúng một** bucket =
`item.category`. KHÔNG có double-floor, không cần kỹ thuật phân hoạch:

```
Δ_bucket(category)  ==  cut                              (PARTITION-SINGLE — dạng chính, mặc định)
```

Đây là dạng Treasury dùng theo mặc định. Mỗi `collect` chỉ ghi `cut` vào một field bucket (`category`) trong
sổ datum, không chia nhỏ.

> **Lịch sử (finding 2 + T2):** một bản MATH trước nâng `split_table` (đa-bucket) lên thành dạng chính và đẩy
> đơn-bucket xuống "trường hợp đặc biệt". T2 đảo lại: **đơn-bucket là đường mặc định**; `split_table`
> (đa-bucket) **CHỈ là tùy chọn instance**, không phải dạng chính. Hết cite chéo ngược TECH↔MATH. Phần dưới
> đây giữ lại PARTITION-MULTI chỉ như **tùy chọn đa-bucket** cho instance nào tự bật.

**Tùy chọn đa-bucket (chỉ khi instance bật `split_table`).** Một instance CÓ THỂ khai báo
`split_table = [(b_1, w_1), …, (b_m, w_m)]` với `Σ_{i=1}^{m} w_i = 10000` bps để chia `cut` về `m` bucket
theo trọng số `w_i`. Khi đó phải tránh **double-floor**: cách ngây thơ `part_i = ⌊cut · w_i / 10000⌋` cho
mỗi bucket khiến `Σ part_i = cut − k` với `0 ≤ k ≤ m−1` — **mất tới `m−1` oil** mỗi item, phá bất biến
sổ↔value (TECH §3). Khắc phục bằng "phần cuối = phép trừ":

```
part_i  =  ⌊ cut × w_i / 10000 ⌋            với i = 1 … m−1
part_m  =  cut  −  Σ_{i=1}^{m−1} part_i      (phần dư — KHÔNG floor)            (PARTITION-MULTI, tùy chọn)
```

**Định lý 2′ (PARTITION-MULTI — khi bật tùy chọn đa-bucket).** Với định nghĩa trên,
**Σ_{i=1}^{m} part_i = cut** đúng tuyệt đối (số nguyên), KHÔNG mất oil nào.

*Chứng minh.* `Σ_{i=1}^{m} part_i = (Σ_{i=1}^{m−1} part_i) + part_m = (Σ_{i=1}^{m−1} part_i) + cut −
(Σ_{i=1}^{m−1} part_i) = cut`. ∎ Mỗi `part_i` (i<m) là floor nên `≥ 0`; `part_m = cut − Σ part_i ≥ 0` vì
`Σ_{i<m} ⌊cut·w_i/10000⌋ ≤ ⌊cut·(Σ_{i<m} w_i)/10000⌋ ≤ ⌊cut·(10000−w_m)/10000⌋ ≤ cut` (do `w_m ≥ 0`). Vậy
mọi phần không âm và tổng đúng `cut`. Đây là **cùng kỹ thuật** "một phần bằng floor, phần cuối bằng phép trừ"
đã dùng cho `cut/rest` ở §3.2. Đơn-bucket (PARTITION-SINGLE) là `m = 1`: `part_1 = cut`, không floor — hiển
nhiên đúng.

> **Lưu ý thứ tự xác định (chỉ áp khi bật đa-bucket):** `part_m` (bucket cuối theo thứ tự `split_table`) hấp
> thụ toàn bộ crumb làm tròn `≤ m−1` oil. Off-chain + on-chain phải dùng **cùng thứ tự** `split_table` để
> byte-perfect (TECH chốt thứ tự canonical). Crumb dồn vào một bucket xác định ⟹ vẫn audit được, không
> "bốc hơi". Dạng đơn-bucket mặc định không có crumb nên không gặp vấn đề này.

### 3.3 Bất biến validator collect (INV-COLLECT chi tiết)

Validator collect kiểm 3 điều, tất cả là so sánh số nguyên:

```
(C1)  cut          == amount × cut_bps / 10000        // floor, đúng SPLIT
(C2)  Δ_bucket(category) == cut                        // dạng chính đơn-bucket, PARTITION-SINGLE (§3.2.1)
(C3)  Σ_{o∈OUT_I} o.value(a)  ==  Σ_{i∈IN_I} i.value(a) + cut   // INV-COLLECT đẳng thức, §2.3 (vá lần 2 F9)
```

`C2` thao tác trên **sổ trong datum** (bucket = field, KHÔNG phải UTxO riêng — CONTRACT §1, chống bloat),
nên không tạo UTxO mới mỗi collect. Dạng mặc định: `cut` vào đúng một bucket = `item.category`, đẳng thức
chính xác ⟹ bất biến sổ↔value của TECH §3 KHÔNG vỡ. `C3` thao tác trên **value vật lý** của custody UTxO,
**đẳng thức `==`** (vá lần 2 F9 — loại tip làm `value > Σ sổ`; mirror chiều release).

> **Tùy chọn đa-bucket (chỉ khi instance bật `split_table`):** C2 thay bằng PARTITION-MULTI (§3.2.1):
> `Δ_bucket(b_i) == part_i  ∀i=1…m` với `Σ_i part_i == cut` (`part_m = cut − Σ_{i<m} part_i`, bucket cuối
> hấp thụ crumb). Đây KHÔNG phải đường mặc định (T2) — instance phải tự bật. Đơn-bucket là `split_table =
> [(category, 10000)]` ⟹ thu về đúng C2 chính.

---

## 4. Bất biến theo lô (batch)

### 4.1 Vì sao batch (first-principles)

Micro-fee on-chain từng cái là **bất khả thi**: mỗi UTxO cần min-ADA (~1 ADA, protocol param
`coinsPerUTxOByte` — CIP-55 / ledger) + phí mạng > giá trị một micro-fee. Nên gộp `N` lệnh collect logic
thành **một** settlement tx. (CONTRACT §3.3.)

### 4.2 Tính cộng được của split

Cho lô `N` lệnh, mỗi lệnh `j` có `amount_j`, cùng `cut_bps`, cùng asset `a`. Cut mỗi lệnh
`cut_j = ⌊amount_j · bps / 10000⌋`. Tổng cut của lô:

```
CUT_batch  =  Σ_{j=1}^{N} cut_j  =  Σ_j ⌊amount_j · bps / 10000⌋        (BATCH-CUT)
```

**Lưu ý (không phân phối được qua floor):** nói chung
`Σ_j ⌊amount_j·bps/10000⌋  ≤  ⌊(Σ_j amount_j)·bps/10000⌋`. Cận lệch (finding 5): hiệu hai vế
`= ⌊Σ_j frac_j⌋` với `frac_j = (amount_j·bps mod 10000)/10000 < 1` là phần lẻ mỗi hạng ⟹ **tối đa `N−1` oil**.
**Cận `N−1` là TỐI ĐA, đạt khi mọi `(amount_j·bps mod 10000)` lớn nhất** (gần `10000−1`); thực tế thường nhỏ
hơn nhiều. Điểm cốt lõi KHÔNG phải độ lớn lệch mà là: tính gộp trên tổng `amount` thì phần lệch **không quy
được về từng receipt** → phá audit. Vì vậy **bất biến lô phải tính cut PER-LỆNH rồi cộng** (`BATCH-CUT`),
KHÔNG tính một lần trên tổng `amount` rồi gán.

**Định lý 2 (bảo toàn + đúng tổng cut theo lô).** Một settlement tx hợp lệ gộp `N` lệnh thoả:

```
(B1)  Σ_{outputs} o.value(a) = Σ_{inputs} i.value(a)              ∀a     (TOTAL-CONSERVE toàn lô)
(B2)  Δ_I(a)  ==  CUT_batch(a)  =  Σ_j cut_j(a)                           (INV-COLLECT cộng dồn — đẳng thức, F9)
(B3)  Δ_bucket(b)  =  Σ_j part_{j,b}   ∀ bucket b                          (PARTITION cộng dồn)
        với  Σ_b Δ_bucket(b)  =  Σ_j cut_j  =  CUT_batch                   (tổng các bucket = tổng cut)
```

*Chứng minh.* (B1) là Định lý 1 áp cho tx lô (POV không phụ thuộc N). (B2): áp INV-COLLECT (đẳng thức, vá
lần 2 F9) cho từng lệnh rồi cộng `N` đẳng thức → tổng vẫn đẳng thức `Δ_I(a) == Σ_j cut_j(a)`. (B3): dạng mặc định **đơn-bucket** (§3.2.1
PARTITION-SINGLE) — mỗi lệnh `j` đóng toàn bộ `cut_j` vào đúng bucket `category_j`, tức `part_{j,b} = cut_j`
nếu `b = category_j` và `0` ngược lại; cộng theo lệnh ⟹ mỗi bucket nhận đúng tổng các `cut_j` cùng category,
và `Σ_b Δ_bucket(b) = Σ_j cut_j = CUT_batch`. (Nếu instance bật tùy chọn **đa-bucket**, thay bằng
PARTITION-MULTI với `Σ_b part_{j,b} = cut_j` đúng tuyệt đối — Định lý 2′; tổng vẫn `= CUT_batch`.) Cả hai
trường hợp **tổng sổ toàn lô = tổng cut toàn lô** — bất biến sổ↔value (TECH §3) giữ qua cả lô. ∎

### 4.3 Receipt + audit

Mỗi lệnh `j` ghi receipt `(app_id_j, asset, amount_j, cut_j, epoch)` (CONTRACT §3.4). Vì `cut_j` tính
per-lệnh (§4.2), Σ receipt khớp `Δ_bucket` và khớp `CUT_batch` → audit trail đối soát được từng lệnh. Đây là
lý do **không** được tính cut gộp.

---

## 5. `circulating` — định nghĩa hình thức

### 5.1 Định nghĩa

`circulating` của asset `a` tại thời điểm bất kỳ:

```
circulating(a)  :=  S_total(a)  −  Σ_{I ∈ T} bal_I(a)  −  undistributed(a)        (CIRC)
```

với:
- `S_total(LAMP) = 36×10^15 oil` **cố định tuyệt đối** (`Utils.S_LAMP_TOTAL`).
- `bal_I(a)` = tổng value asset `a` trong toàn bộ UTxO custody của instance `I` (custody chính + shard +
  emergency bucket tách physical — CONTRACT §1).
- `undistributed(a)` = LAMP **chưa phát hành / chưa redeem** còn nằm trong các validator Distribution (genesis
  pool + phần `claim_account` đã `claimed` nhưng `redeemed_cumulative` chưa rút). **[cần verify với Distribution]**
  con số chính xác (genesis pool − Σ redeemed). LAMP trong các UTxO Distribution chưa redeem **KHÔNG phải
  circulating** theo nghĩa kinh tế, cũng KHÔNG nằm trong `bal_I` của Treasury (finding 4).

> **Vì sao thêm `undistributed` (finding 4):** công thức cũ `circulating = S_total − Σ bal_I` coi MỌI LAMP
> ngoài Treasury là circulating ⟹ **đếm thừa lưu hành** trong giai đoạn phân phối chưa xong (LAMP còn khóa
> trong genesis/Distribution bị tính nhầm là đang lưu hành). Hai cách dùng:
> - **(a) thu hẹp phạm vi:** nếu chỉ cần CIRC SAU khi phân phối hoàn tất (`undistributed = 0`, toàn bộ
>   `S_total` đã rời genesis) thì `undistributed` triệt tiêu và công thức về dạng cũ.
> - **(b) tổng quát (đang dùng):** trừ thêm `undistributed(a)` để CIRC đúng ở MỌI giai đoạn, kể cả khi phân
>   phối chưa xong.

### 5.2 Tính chất

**Mệnh đề 3 (giảm lưu hành = kế toán, không đốt).** `collect` lượng `x` của asset `a` vào instance `I` (từ
LAMP **đã lưu hành**, không phải từ pool chưa phát hành) làm:
- `bal_I(a)` tăng `x` (custody nhận thêm),
- `S_total(a)` **không đổi** (BIV-1, không burn), `undistributed(a)` không đổi (collect lấy từ LAMP đã lưu hành),
- ⟹ `circulating(a)` **giảm `x`** — **thuần do số hạng `Σ bal_I` tăng**, KHÔNG do `S_total` giảm.

`release` (§6) làm ngược lại: `bal_I` giảm, `circulating` tăng. Việc **phát hành ban đầu** (redeem từ
Distribution) làm `undistributed` giảm và `circulating` tăng — vẫn không đụng `S_total`. Tổng `S_total` luôn
cố định. ∎

Đây đúng mô hình **kho bạc Cardano**: ADA vào treasury **không bị đốt**, chỉ rời circulating; governance chi
lại sau (CIP-1694 — treasury withdrawals; ADA vào/ra treasury bảo toàn tổng cung)
<https://cips.cardano.org/cip/CIP-1694>.

### 5.3 Bất biến toàn cục (hằng đẳng thức tổng cung)

Tại **mọi** thời điểm:

```
S_total(a)  =  circulating(a)  +  Σ_{I ∈ T} bal_I(a)  +  undistributed(a)   (luôn đúng, theo CIRC)
```

Vì `collect`/`release` chỉ **dịch chuyển** giữa `circulating` và `Σ bal_I`, còn redeem từ Distribution dịch
giữa `undistributed` và `circulating` — không thao tác nào đụng `S_total` (cố định) — đẳng thức ba số hạng này
là **bất biến** qua mọi giao dịch. Không tồn tại tx hợp lệ phá nó (vì phá nó ⟺ có nhánh mint/burn asset thuộc
`accepted_assets`, đã cấm bởi BIV-1).

---

## 6. Ngưỡng release + chống drain

### 6.1 Cổng governance = vị từ boolean `pass(P)` (Treasury KHÔNG tự kiểm ngưỡng)

**Áp T5 (CONTRACT §9) + T1 + D3 (VotingPower CONTRACT §5).** Release-gate là **Model A**: Treasury KHÔNG
tính lại bất kỳ bất đẳng thức ngưỡng nào. Nó **chỉ đọc một vị từ boolean** `pass(P)` đã được Governance ép
xong qua `ExecuteProposal` (`status == Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`).
Toàn bộ ngưỡng — gồm nhân-chéo `≥`, sàn cứng BFT, clamp `VP_eff` — do **Governance** ép TRƯỚC; Treasury chỉ
nhận kết quả.

```
release(P) hợp lệ   ⟹   pass(P) == True                 (GATE — vị từ boolean, đọc từ Governance)
```

với `pass(P)` đọc qua reference input / Proposal NFT (CONTRACT §4 + T1). **Không có** bất đẳng thức
`approval × denom ≥ total × numer` ở tầng Treasury — đặt nó ở đây là **lặp logic Governance** + mở lỗ hổng
"release bỏ qua clamp" (GAME-1). MATH bản trước tự-kiểm ngưỡng ở Treasury → **đã bỏ** theo T5/T1/D3.

> **Ngữ nghĩa `pass(P)` (chỉ để hiểu, KHÔNG implement lại ở Treasury) — cross-ref VotingPower MATH §8B + D1:**
> Governance dựng `pass(P)` từ `approval = Σ VP_eff(thuận)` **đã clamp** (mỗi DID đã bị
> `min(VP_i, ΣVP/BFT_FLOOR)` — VotingPower CONTRACT §2 nguyên lý 5) và `total = Σ VP-tham-gia GỐC` (power
> thô, chưa clamp, làm mẫu số). KÈM sàn cứng `số DID thuận ≥ BFT_FLOOR`. **Đừng** đọc nhầm `total` thành tổng
> đã clamp, và **đừng** dùng power thô cho tử số — đó là việc của Governance, không phải Treasury. Đóng GAME-1:
> vì `approval` đã clamp ở Governance, không tx release nào "lách" được trần BFT.

### 6.2 Giới hạn rút (cap release theo proposal)

Proposal P chốt `amount_P(a)` = lượng asset `a` được phép chi. Validator release kiểm — **mọi ràng buộc áp cho
DELTA NỘI BỘ custody của instance `I`** (lọc theo payment script hash của `I`, dùng `IN_I/OUT_I` như §2.2),
KHÔNG phải Σ toàn-tx:

```
(R1)  −Δ_I(a)  =  Σ_{IN_I} i.value(a) − Σ_{OUT_I} o.value(a)  ≤  amount_P(a)   ∀a    (CAP)
(R2)  Σ_{OUT_I} o.value(a)  =  Σ_{IN_I} i.value(a)  −  draw_P(a)               ∀a    (custody bảo toàn − chi)
(R3)  với asset KHÔNG được P cho phép chi (`draw_P(a)=0`):  Δ_I(a) = 0          (giữ nguyên, chống drain — M1)
```

với `draw_P(a) = Σ_{draw.asset=a} draw.amount ≤ amount_P(a)` (tổng thực rút theo proposal).

> **Nguồn fee + min-ADA (finding 3 — phát biểu rõ như §2.1):** fee mạng + min-ADA của output người nhận và
> custody-out mới **trả TỪ ví council / người build tx, KHÔNG từ custody**. Vì vậy R2/R3 áp cho **delta nội bộ
> custody** (`IN_I/OUT_I` lọc theo payment script hash của `I`), KHÔNG phải `Σ` toàn-tx. Toàn-tx vẫn theo POV
> ledger (§2.1) có số hạng `+fee` cho ADA — nhưng số hạng đó nằm ở ví council, ngoài `IN_I/OUT_I`. Điều này
> KHỚP §2.2 (collect cũng dùng `OUT_I/IN_I`, không phải Σ toàn tx); bản trước viết R2 dạng `Σ_outputs/Σ_inputs`
> toàn-tx là **bất nhất phạm vi** với §2.2 — đã sửa.
>
> Hệ quả ADA reserve (CONTRACT §6): nếu custody giữ ADA cho free-ops mà ADA KHÔNG trong proposal, R3 ép
> `Δ_I(ADA)=0` ⟹ custody KHÔNG đóng góp ADA cho fee/min-ADA — **đúng chủ đích** (fee từ ví council). Đây là lý
> do tách nguồn fee: bảo vệ ADA reserve khỏi bị bào mòn qua mỗi tx release.

`R1` cho phép chi **≤** mức duyệt (chi đúng hoặc ít hơn). `R3` là đẳng thức chặt cho mọi asset ngoài phạm vi
proposal — đối chiếu code thật Distribution `treasury.ak`:
`tre_out.value == add(tre_in.value, LAMP, −released)` giữ ADA + token khác **nguyên si** (M1 drain test
`fail`).

### 6.3 Chống double-satisfaction (đếm theo payment script hash)

Bài học audit C1/C2/M1 Distribution: nếu đếm "treasury input" theo **địa chỉ đầy đủ** (gồm stake cred), kẻ
tấn công tạo nhiều UTxO cùng payment script khác stake cred để **release N lần** trên một proposal. Khắc phục
(đã có code, treasury.ak C-TRE-1):

```
count_inputs_at_payment_script_hash(tx, h_I)   == 1
count_outputs_at_payment_script_hash(tx, h_I)  == 1
```

với `h_I` = **payment script hash** của instance (bỏ qua stake cred). Bảo đảm **đúng một** cặp custody
in/out cho instance trong tx → mỗi proposal release **đúng một lần**, không nhân bản.

**Định lý 4 (không drain).** Với một proposal P pass, tổng asset `a` rời instance `I` qua release `≤
amount_P(a)`, và mọi asset ngoài phạm vi P bảo toàn tuyệt đối.

*Chứng minh.* Đúng một cặp custody (6.3) ⟹ `Δ_I(a)` xác định đơn trị trong tx. `R1` chặn trên bởi
`amount_P(a)`. `R3` ⟹ asset ngoài phạm vi giữ `Δ=0`. `R2` (bảo toàn custody − chi, dạng `IN_I/OUT_I`) ⟹ phần
custody giảm đúng `draw_P(a)`; kết hợp POV ledger toàn-tx (§2.1) ⟹ value rút ra đi vào output người nhận
(C-REL-7), không biến mất/nhân lên — fee/min-ADA do ví council bù, ngoài `IN_I/OUT_I`. Cộng lại: không nhánh
nào rút quá mức duyệt, không nhánh nào rút asset không được duyệt. ∎

### 6.4 Tách địa chỉ Treasury khỏi ví (điều kiện cần)

Bất biến `treasury_receives ≥ X` (INV-COLLECT) và `CAP` (R1) **chỉ có nghĩa** khi
`payment_script_hash(Treasury) ≠ payment_script_hash(ví tạo output cùng tx)`. Nếu trùng, các output gộp
chung → bất biến "treasury nhận ≥ X" **thoả mãn rỗng** (vacuously true) vì đếm cả value của ví. Đây là bài
học Preview generators (CONTRACT §6). **Điều kiện cần khởi tạo:** instance Treasury phải ở script address
tách biệt mọi ví caller.

---

## 7. Tổng hợp bất biến (bảng tra cho TECH)

| Mã | Phát biểu | Dạng | Nguồn |
|---|---|---|---|
| BIV-1 | Không nhánh burn/mint asset accepted | `mint(a)=0` | CONTRACT §5; treasury.ak C-MINT-0 |
| TOTAL-CONSERVE | `Σ_out(a) = Σ_in(a)` ∀a | đẳng thức | Định lý 1; POV ledger |
| INV-COLLECT | `Δ_I(a) == cut(a)` | đẳng thức (vá lần 2 F9 — code `value_ok`) | §2.3; collect.ak |
| SPLIT | `cut = ⌊amount·bps/10000⌋` | floor số nguyên | §3.1 |
| PARTITION | `cut + rest = amount` | đẳng thức (rest = amount−cut) | §3.2 |
| PARTITION-SINGLE | `Δ_bucket(category) = cut` | đẳng thức, cut → 1 bucket (mặc định) | §3.2.1 |
| PARTITION-MULTI | `Σ_i part_i = cut` (part cuối = cut − Σ trước) | đẳng thức, chia cut → m bucket (**tùy chọn**) | §3.2.1 |
| BATCH-CUT | `CUT_batch = Σ_j cut_j` (per-lệnh) | tổng floor per-lệnh | §4.2 |
| CIRC | `circulating = S_total − Σ bal_I − undistributed` | định nghĩa | §5.1 |
| GATE | `release(P) ⟹ pass(P) == True` (đọc từ Governance, đã clamp) | vị từ boolean | §6.1 |
| CAP | `−Δ_I(a) ≤ amount_P(a)` (delta nội bộ `IN_I/OUT_I`) | bất đẳng thức ≤ | §6.2 |
| NO-DRAIN | đúng 1 cặp custody theo payment script hash | đếm = 1 | §6.3; treasury.ak C-TRE-1 |

---

## 8. Tham số mở (DAO định)

Không bịa số cuối — đây là **dạng + miền**:

- `cut_bps ∈ [0, 10000]` (protocol cut, bps). Tham số instance.
- **Ngưỡng + sàn BFT KHÔNG phải tham số Treasury** (T5/T1): cặp `(numer_k, denom_k)`, `BFT_FLOOR`, clamp
  `VP_eff` thuộc **Governance**; Treasury chỉ đọc vị từ `pass(P)` đã ép xong (§6.1). Vd khung community/
  emergency `2/3`, ops `1/2` (CONTRACT §4) là tham số **Governance**, không Treasury.
- Kích thước lô `N_max` mỗi settlement tx: bị chặn trên bởi ngân sách ExUnit + kích thước tx (protocol
  param `maxTxExUnits`, `maxTxSize`). Tham số vận hành.
- Time-lock release (`execute_after_epoch`): chốt ở Proposal (Governance D2); Treasury chỉ kiểm mốc.
- `split_table` weights `[(b_i, w_i)]` với `Σ w_i = 10000` bps — **CHỈ khi instance bật tùy chọn đa-bucket**
  (§3.2.1); mặc định đơn-bucket không dùng. bps đủ độ phân giải; không cần `Q`-resolution trừ khi DAO muốn
  tỷ lệ mịn hơn 1/10000 (chưa cần).
- `mulBps(a, bps) = a × bps / 10000` (floor) — helper off-chain CẦN BỔ SUNG (`Utils` hiện chỉ có
  `mulQ`); đối xứng on-chain. KHÔNG phải tham số, là ghi chú triển khai (finding 8).
- Danh sách `accepted_assets[]` mỗi instance.

## 9. Phụ thuộc

- **`Treasury/CONTRACT.md`** — xương sống interface (tài liệu này chứng minh các bất biến của nó).
- **`Distribution/onchain/validators/treasury.ak`** — mẫu code thật cho release + chống drain (C-TRE-1,
  C-MINT-0, M1) — TECH mở rộng từ đây.
- **`Distribution/onchain/lib/magiclamp/lampdist/math.ak`** — `ceil_div`, `clamp` (tái dùng cho làm tròn an
  toàn-hệ-thống).
- **`Utils` (`src/index.ts`)** — `Q=10^9`, `mulQ`, `clamp`, `S_LAMP_TOTAL`, `OIL_PER_LAMP`,
  nguyên tắc BigInt-only. Off-chain mirror của số học on-chain. **Chưa có `mulBps`** — cut theo bps cần bổ
  sung `mulBps(a,bps)=a*bps/10000` (finding 8).
- **Distribution** — cung cấp `undistributed(LAMP)` (genesis pool chưa redeem) cho công thức CIRC §5.1.
  **[cần verify]** cách đọc chính xác (genesis pool − Σ `redeemed_cumulative`).
- **Governance** — cung cấp vị từ "proposal P pass" + `approval/total` (qua reference input/beacon). Voting
  Power model NGOÀI spec này.
- **Oracle** (app-side) — định giá; NGOÀI Treasury.
- Tham chiếu ngoài: Cardano Ledger value preservation
  <https://github.com/IntersectMBO/cardano-ledger>; CIP-1694 (Conway governance + treasury)
  <https://cips.cardano.org/cip/CIP-1694>; Aiken `cardano/assets`
  <https://aiken-lang.github.io/stdlib/cardano/assets.html>; Aiken `aiken/math/rational` (nếu cần tỷ lệ
  hữu tỷ thay floor) <https://aiken-lang.github.io/stdlib/aiken/math/rational.html>.

## 10. Câu hỏi còn treo

1. **`rest` định tuyến** (provider/node) — phần này rời Treasury ngay trong tx collect, hay Treasury cũng
   giữ tạm rồi mới chuyển? Ảnh hưởng số UTxO output. (TECH cần chốt; ưu tiên: rời ngay, ít UTxO hơn.)
2. **[ĐÃ CHỐT — T2 CONTRACT §9]** Bucket dạng **CHÍNH = đơn-bucket**: `cut → đúng item.category` (một
   bucket), MATH §3.2.1 dạng `Δ_bucket(category) == cut` (PARTITION-SINGLE). `split_table` (đa-bucket) CHỈ là
   **tùy chọn instance**, không phải đường mặc định; khi instance bật, dùng PARTITION-MULTI (Σ phần = cut,
   "phần cuối = cut − Σ phần trước" để không lệch floor). Đơn-bucket là `split_table = [(category, 10000)]`.
   Hết cite chéo ngược TECH↔MATH. (Một bản trước đẩy đa-bucket lên dạng chính — T2 đảo lại. Finding 2 + T2
   đã xử lý.)
3. **Emergency bucket tách physical** — có cần bất biến cô lập riêng (không cho release emergency rút từ
   custody chính)? Nếu có, thêm ràng buộc `h_emergency ≠ h_main` ở mức instance. (TECH.)
4. **Đa-asset trong một proposal** — `amount_P` là vector (nhiều asset/tx release) hay vô hướng (một asset)?
   `CAP`/`R3` viết dạng vector để tổng quát; FEAT cần xác nhận có dùng tới không.
5. **Shard custody** (nhiều UTxO custody một instance để song song hoá) — nếu cho phép, NO-DRAIN "đúng 1 cặp"
   phải nới thành "đúng K cặp đã khai báo" + bảo toàn tổng qua K. Hiện giả định **1 custody UTxO** (đơn giản,
   chống double-satisfaction dễ chứng minh). **[cần verify với TECH nếu cần throughput cao]**

---

## 11. Phản hồi audit (vòng 2026-06-05)

| # | Mức | Tóm tắt | Xử lý |
|---|---|---|---|
| 1 | major | §3.1 lập luận floor cut "an toàn cho hệ" tự mâu thuẫn, trộn vai người-rút với cut | **Nhận.** §0.1(3) + §3.1 viết lại: tách 2 lập luận (an toàn THỰC = bảo toàn value `≥`+TOTAL-CONSERVE, KHÔNG từ hướng làm tròn); chốt chủ đích **floor cut = ưu ái payer** theo 4 trục, bỏ câu "an toàn cho hệ" gắn với floor. Nêu ceil là tùy chọn instance. |
| 2 | major | MATH §3.3 (`Δ_bucket==cut`, 1 bucket) ≠ TECH §4.2 (cut chia đa-bucket theo split_table) → double-floor phá bất biến sổ | **Nhận.** Chốt **đa-bucket** (TECH là authority kiến trúc). Thêm §3.2.1 + Định lý 2′ PARTITION-MULTI (phần cuối = cut − Σ trước, không lệch floor). Sửa C2 (§3.3) + B3 (§4.2) + bảng §7. "1 bucket" = trường hợp đặc biệt. §10.2 hết treo. |
| 3 | major | §6.2 R2/R3 phạm vi Σ-toàn-tx ≠ §2.2 (`IN_I/OUT_I`); im lặng nguồn fee/min-ADA | **Nhận.** R2 viết lại trên `IN_I/OUT_I` (= custody bảo toàn − chi). Thêm mệnh đề rõ: fee+min-ADA trả từ ví council, KHÔNG từ custody; R2/R3 = delta nội bộ. Cập nhật proof Định lý 4 + bảng CAP. |
| 4 | minor | §5.1 CIRC bỏ sót LAMP chưa redeem trong Distribution → đếm thừa lưu hành | **Nhận.** CIRC = `S_total − Σ bal_I − undistributed`. Cập nhật §0.1(2), §5.1/5.2/5.3, bảng §7, phụ thuộc Distribution. Đánh dấu `[cần verify]` cách đọc `undistributed`. |
| 5 | minor | §4.2 cận N−1 oil chưa chặt (chưa nêu điều kiện đạt) | **Nhận.** Thêm: cận N−1 là TỐI ĐA, đạt khi mọi `(amount_j·bps mod 10000)` lớn nhất; thực tế nhỏ hơn; điểm cốt lõi là lệch không quy được về receipt → buộc per-lệnh. |
| 6 | minor | §2.1 gắn CIP-1694 sai cho mệnh đề fee (đúng nguồn là Shelley monetary) | **Nhận.** Đổi nguồn fee sang Shelley ledger/monetary policy; giữ CIP-1694 cho treasury donation §5.2. |
| 7 | nit | §6.1 THRESHOLD-k biên `total=0` → `0≥0` pass-rỗng; thiếu sàn BFT của EXEC | **Nhận.** Thêm `total(P)>0` ∧ `approval(P)≥BFT_FLOOR` (mặc định 21, đồng bộ EXEC §6.1 + VotingPower). Cập nhật bảng + §8. |
| 8 | nit | §3.1 ngụ ý `mulQ` dùng được cho bps; thực tế chưa có `mulBps` | **Nhận.** Ghi chú: `Utils` chỉ có `mulQ` (mẫu Q); bps cần `mulBps(a,bps)=a*bps/10000` mới — off-chain bổ sung. Thêm vào §3.1, §8, phụ thuộc. |

> **Lưu ý:** finding 2 (chốt đa-bucket) + finding 7 (THRESHOLD-k + sàn BFT ở Treasury) ở bảng trên **đã bị
> ĐẢO** bởi vòng reconcile §12 (T2, T5). Đọc §12 là trạng thái mới nhất.

### 11.1 Vá audit lần 2 (2026-06-15)

| # | Mức | Tóm tắt | Xử lý |
|---|---|---|---|
| **F9** | doc-drift | MATH ghi `≥` cho chiều collect (INV-COLLECT), nhưng CODE `collect.value_ok` dùng `==` (đẳng thức tuyệt đối, an toàn hơn — loại tip làm vỡ sổ) | **Nhận — đồng bộ MATH về `==`.** §2.3 INV-COLLECT đổi `≥`→`==` + giải thích loại tip + min-ADA định tuyến ngoài custody; §3.3 C3 `==`; §4.2 B2 `==` (cộng N đẳng thức) + proof; §0.1(3) sửa `≥`→`==`; bảng §7 INV-COLLECT `Δ_I(a)==cut(a)` nguồn `collect.ak`. Ghi rõ đối chiếu TECH §4.2 C-COL-2 (`≥` cho ADA) — code chặt hơn dùng `==` mọi asset, min-ADA hạch toán qua bucket reserved. |

> Các lỗ F1–F5, F10 của vá lần 2 là **on-chain validator** (TECH §11.1) — không đụng MATH. F9 là lỗ duy
> nhất chạm MATH (doc-drift dấu bất đẳng thức). Đã đồng bộ về `==` theo code.

---

## 12. Phản hồi reconcile 2026-06-05 (interface KHÓA — CONTRACT §9 + VotingPower §5)

Áp các quyết định ghim cứng của `Treasury/CONTRACT.md §9` + `Governance/VotingPower/CONTRACT.md §5`. Mục này
**override** phần liên quan ở bảng §11 khi mâu thuẫn.

| Quyết định | Đã sửa gì | Cite |
|---|---|---|
| **T5 + T1 + D3** — release-gate = Model A; Treasury KHÔNG tự kiểm ngưỡng | §6.1 viết lại: **BỎ** bất đẳng thức tự-kiểm `approval×denom ≥ total×numer` (cùng `total>0`, sàn BFT cũ — finding 7). Chỉ giữ vị từ boolean `GATE: release(P) ⟹ pass(P)==True` đọc từ Governance (đã clamp). Ngữ nghĩa ghi rõ `approval = Σ VP_eff(thuận)` **đã clamp**, `total = Σ VP-tham-gia GỐC` — cross-ref VotingPower MATH §8B + D1. §0.1(5) sửa "ngưỡng ≥" → "vị từ boolean". Bảng §7: `THRESHOLD-k` → `GATE`. **Đóng GAME-1**: `approval` đã clamp ở Governance ⟹ không release nào lách trần BFT. | CONTRACT §9 T5/T1; VP CONTRACT §5 D3; VP MATH §8B + D1 |
| **T2** — collect ĐƠN-BUCKET mặc định | §3.2.1 viết lại: dạng **chính + mặc định** = đơn-bucket `Δ_bucket(category) == cut` (PARTITION-SINGLE). PARTITION-MULTI (đa-bucket theo `split_table`) **hạ xuống "tùy chọn instance"**, không phải đường mặc định. C2 (§3.3) đổi về `Δ_bucket(category) == cut` (đa-bucket là ghi chú tùy chọn). B3 (§4.2) viết lại quanh đơn-bucket (đa-bucket là nhánh phụ). Bảng §7: thêm `PARTITION-SINGLE`, đánh dấu `PARTITION-MULTI` **(tùy chọn)**. §10.2 sửa lời chốt (đơn-bucket là chính). Hết cite chéo ngược TECH↔MATH. | CONTRACT §9 T2 |
