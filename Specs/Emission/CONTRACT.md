# Luật phát hành LAMP — nguồn duy nhất

> **Tệp này là nguồn chân lý của luật phát hành LAMP.** Mọi tài liệu khác trong kho trỏ về đây và
> **không** phát biểu lại luật. Bản trước đó của luật này nằm rải ở bốn nơi và đã trôi khỏi nhau;
> §7 ghi lại các câu bị thay và vì sao.

Phạm vi: cung tổng, cách đúc, luật nhả của quỹ Reserve, và cổng cầu ở Treasury. Không bao gồm
luật phân bổ giữa các quỹ (xem `Papers/pot-catalog.md`) và không bao gồm quyền biểu quyết
(xem `Governance/VotingPower/CONTRACT.md`).

---

## 1. Đơn vị

| Đại lượng | Giá trị |
|---|---|
| 1 LAMP | `1_000_000` oildrop (10⁶) |
| tên đơn vị con | `oildrop` (vai trò như `lovelace` của ADA) |
| `decimals` (trường metadata token) | `6` — cùng một dữ kiện với dòng trên, viết theo trường mà ví và explorer đọc |
| 1 epoch | epoch Cardano — 5 ngày; ≈73 epoch/năm |

Mọi con số on-chain tính bằng **oildrop**. Bảng dưới ghi cả hai đơn vị ở chỗ dễ đọc nhầm.

---

## 2. Cung tổng — TRẦN, không phải số đã đúc

**36 tỷ LAMP là TRẦN được ép trên chuỗi. LAMP đúc dần (lazy-mint). LAMP KHÔNG BAO GIỜ bị đốt.**

| Hằng | oildrop | LAMP |
|---|---|---|
| `dist_cap` | `26_370_000_000_000_000` | 26,37 tỷ |
| `reserve_cap` (`E`) | `9_630_000_000_000_000` | 9,63 tỷ |
| tổng trần | `36_000_000_000_000_000` | **36 tỷ** |

Ba câu dưới đây phải đi cùng nhau; tách một câu ra là đổi nghĩa:

1. **Trần 36 tỷ** — ép bởi validator mint, không phải một lời hứa trong tài liệu.
2. **Đúc dần** — số đã đúc tại một thời điểm đọc từ `SupplyState` on-chain, KHÔNG đọc từ tài liệu.
3. **Không đốt** — giảm lưu hành nghĩa là **chuyển vào Treasury** (một bút toán), không phải huỷ.

> ⚠️ Câu rút gọn *"LAMP cố định 36 tỷ"* đọc thành *"36 tỷ đã lưu hành"*. Dùng
> **"trần 36 tỷ, đúc dần, không đốt"**.

### 2.1 `SupplyState` — bộ đếm đúc

UTxO duy nhất, ghim bởi thread NFT one-shot, mang inline datum **4 trường**:
`dist_minted` · `reserve_minted` · `dist_cap` · `reserve_cap`.

Validator mint ép **mọi** giao dịch mint phải tiêu và tạo lại đúng UTxO này, và cấm giao dịch
mint chạm tới thread NFT. Hệ quả dùng được: mọi giao dịch mint đều **đã** cầm `SupplyState` trong
tay, nên đọc số cung không tốn thêm UTxO đầu vào nào.

### 2.2 Lưu hành `C` — định nghĩa on-chain

```
C = (dist_minted + reserve_minted) − parked_custody
```

`parked_custody` = số LAMP đang nằm trong kho Treasury. Phần đã đúc mà còn nằm trong kho thì
**đã đúc nhưng chưa lưu hành**, nên phải trừ ra. Đây là định nghĩa duy nhất của `C` dùng trong
tệp này.

---

## 3. Reserve — luật nhả có HAI vế, bổ sung nhau

Reserve là **lớp đệm phát hành sau cùng**: 9,63 tỷ LAMP đi từ vùng chưa-đúc vào kho Treasury.
Điều tiết cung-cầu hai chiều thuộc **Treasury**, không thuộc Reserve — Reserve chỉ lo nhịp, trần,
và đích đến.

Hai vế trả lời **hai câu hỏi khác nhau**. Đây là chỗ các bản trước đã đọc thành loại trừ nhau:

| Vế | Trả lời | Ép ở đâu |
|---|---|---|
| **A — TRẦN NHỊP** | *nhả tối đa bao nhiêu trong một epoch* | module Reserve |
| **B — CỔNG CẦU** | *epoch này có được nhả hay không* | module Treasury |

Một lượt nhả hợp lệ phải thoả **cả hai**.

### 3.1 Vế A — trần nhịp

```
max_per_epoch = E / release_epochs        release_epochs = 1000
              = 9_630_000_000_000 oildrop = 9.630.000 LAMP
```

- Trần **cứng** mỗi epoch. Không phụ thuộc thời gian trôi.
- **Không cộng dồn.** Epoch không nhả thì phần đó **ở lại quỹ**, không tạo cục catch-up cho epoch sau.
- Tối đa **một** lượt nhả mỗi epoch (bộ đếm ép epoch tiến nghiêm ngặt).
- Không vượt phần quỹ còn lại.

Bất biến số học: `max_per_epoch × release_epochs == E` — chia chẵn, dư 0.

### 3.2 Vế B — cổng cầu

Reserve **chỉ** nhả khi kho Treasury xuống **dưới sàn**. Treasury dồi dào mà vẫn nhả thì Reserve
mất ý nghĩa làm đệm.

Cổng đo **trạng thái TRƯỚC giao dịch** của kho, và là một ngưỡng **nhị phân**: dưới sàn thì mở,
từ sàn trở lên thì đóng. Không có dải nội suy.

```
sàn = 1% × C
cổng MỞ   ⟺  parked_custody × 100 < C
cổng ĐÓNG ⟺  parked_custody × 100 ≥ C
```

Phát biểu bằng lời: **kho Treasury phải giữ một khoản đệm ít nhất bằng 1% lượng LAMP đang lưu
hành; xuống dưới mức đó thì Reserve tiếp tế.**

Sàn là một **tỷ lệ của lưu hành**, không phải một hằng số tuyệt đối. Hệ quả cố ý:

- Sàn **tự co giãn** theo quy mô hệ, nên không bao giờ cần sửa — và vì không cần sửa nên việc nó
  bị nướng vào định danh của script không tạo ra nợ.
- Ở giai đoạn đầu, `C` nhỏ ⟹ sàn nhỏ ⟹ kho dễ nằm trên sàn ⟹ cổng **đóng**. Đúng như mong muốn:
  chưa có cầu thật thì Reserve không tiếp tế.
- So sánh dùng **phép nhân**, không dùng phép chia — tránh mất mát do chia số nguyên.

### 3.3 Không có epoch kết thúc

Hệ quả trực tiếp của hai vế trên, và là điểm hay bị ghi sai:

- **Cận dưới:** nếu mọi epoch đều nhả đúng trần thì quỹ cạn sau **1000 epoch** (≈13,7 năm).
- **Không có cận trên.** Mỗi epoch bị cổng cầu đóng lại đẩy thời điểm cạn ra xa. Về lý thuyết
  **hầu hết epoch sẽ không nhả**, nên **không ấn định được một epoch kết thúc cụ thể**.

Nói *"Reserve cạn sau 1000 epoch"* là **sai** — 1000 là cận dưới, không phải lịch.

### 3.4 Tốc độ nhả năm — SUY RA, không phải tham số đầu vào

Tốc độ nhả tối đa trong một năm là **hệ quả** của trần nhịp, không phải một con số được đặt:

```
trần nhả năm = max_per_epoch × 73 epoch/năm ÷ tổng trần
             = 9.630.000 × 73 ÷ 36.000.000.000 ≈ 1,95% TỔNG TRẦN mỗi năm
```

Đây là **trường hợp xấu nhất tuyệt đối** — mọi epoch đều nhả đúng trần. Với cổng cầu hoạt động,
con số thực tế nằm dưới xa và không có đáy cố định.

> ⚠️ **`1,95%` không phải một tỷ lệ lạm phát.** Mẫu số của nó là **tổng trần 36 tỷ**, không phải
> lưu hành `C` (§2.2). Lạm phát và pha loãng đo theo lưu hành, và ở giai đoạn đầu `C` nhỏ nên
> **cùng lượng nhả đó là một tỷ lệ lớn hơn nhiều**. Gọi nó là "trần lạm phát" là đọc một con số
> theo một mẫu số nó không có.
>
> Tệp này **không** phát biểu một con số lạm phát — kho này không định nghĩa đại lượng đó, và
> trạng thái ấy được khai ở `EMIT-INFLATION-DENOM` (§6) cùng ràng buộc đang có hiệu lực.

Đừng đảo chiều suy luận này: **trần nhịp là số gốc**, tốc độ nhả năm là số dẫn xuất. Đặt tốc độ nhả
làm đầu vào rồi suy ngược ra trần nhịp là đi ngược luật.

### 3.5 Đích đến

**Luật:** Reserve chỉ nhả **vào kho Treasury**, không nhả vào bất kỳ địa chỉ nào khác.

**Cách ép luật đó khác nhau giữa hai đường phát hành, và đường Reserve đang ở giữa một lần đổi
cách.** Ghi rõ ra vì đây đúng là chỗ dễ đọc nhầm một câu mô tả *đích mong muốn* thành một câu mô tả
*cơ chế đang chạy*:

| Đường | Nhận diện kho bằng | Đo cái gì | Ép ở |
|---|---|---|---|
| Distribution | **NFT chính danh của kho** (hash kho đọc động từ reference input) | **độ tăng ròng** LAMP tại script kho | `Genesis/onchain/validators/lamp_mint.ak`, nhánh `DistributionVest` — `script_hash_of_holder` + `qty_delta_at_script` |
| Reserve — bản đang trên nhánh chính | **địa chỉ** (tham số nướng vào script hash) | **tổng mặt output** LAMP tới credential đó | `Reserve/onchain/validators/reserve_draw.ak`, Luật 9 — `qty_to_credential` |
| Reserve — bản đã có mã, chưa vào nhánh chính | **NFT chính danh của kho** + payment credential của `custody` | không đo đích; ép giao dịch phải **tiêu** đúng một UTxO mang kho NFT, để chính validator kho ép Δ vào sổ | `reserve_draw.ak` sau khi đổi, xem `EMIT-DEST-NFT` ở §6 |

Vì sao đổi: **rót đúng địa chỉ không phải rót vào sổ.** Một UTxO hạ cánh đúng địa chỉ kho nhưng
sai hình dạng (không datum kho đòi) thì nằm **trong sân** kho và **ngoài sổ** kho — không giao dịch
nào tiêu lại được, tức là đốt trá hình, trái `EMIT-NOBURN`. Đo **tổng mặt output** còn cho phép tái
chế: kho đang giữ sẵn `X ≥ delta`, trả lại đúng `X`, phần mới đi ra ví.

Bản đang trên nhánh chính vẫn **an toàn**, nhưng nhờ một lập luận hẹp hơn chứ không nhờ phép đo:
output giữ trạng thái không ôm LAMP và `Δmint == delta`, nên không còn nguồn LAMP nào khác để phép
đo tổng bị lợi dụng. Lập luận đó không sống sót qua một thay đổi ở chỗ khác — đó là lý do phải đổi
cách ép, không phải đổi câu chữ.

---

## 4. Bất biến

| Mã | Bất biến |
|---|---|
| `EMIT-CAP` | `dist_minted ≤ dist_cap` và `reserve_minted ≤ reserve_cap` tại mọi thời điểm |
| `EMIT-NOBURN` | không giao dịch nào làm giảm `dist_minted` hay `reserve_minted` |
| `EMIT-EPOCH` | tối đa một lượt nhả Reserve mỗi epoch |
| `EMIT-RATE` | mỗi lượt nhả ≤ `max_per_epoch` |
| `EMIT-POT` | mỗi lượt nhả ≤ `reserve_cap − reserve_minted` |
| `EMIT-GATE` | nhả ⟺ kho Treasury dưới sàn **trước** giao dịch |
| `EMIT-DEST` | LAMP nhả ra chỉ hạ cánh vào kho Treasury (cách ép khác nhau giữa hai đường — §3.5) |
| `EMIT-STATE` | mọi giao dịch mint tiêu và tạo lại đúng một `SupplyState`; thread NFT không bị chạm |

---

## 5. Ở đâu ép cái gì

| Bất biến | Module ép | Neo |
|---|---|---|
| `EMIT-CAP`, `EMIT-NOBURN`, `EMIT-STATE` | Genesis | `validators/lamp_mint.ak` |
| `EMIT-DEST` — đường **Distribution** | Genesis | `validators/lamp_mint.ak`, nhánh `DistributionVest` (`script_hash_of_holder`, `qty_delta_at_script`) |
| `EMIT-DEST` — đường **Reserve** | Reserve | `validators/reserve_draw.ak` (Luật 9). Nhánh `ReserveDraw` của `lamp_mint.ak` **không** ép đích — nó chỉ ép giao dịch đi qua đúng một meter NFT |
| `EMIT-EPOCH`, `EMIT-RATE`, `EMIT-POT` | Reserve | `validators/reserve_draw.ak`, hằng ở `lib/magiclamp/reserve/math.ak` (`release_epochs`, `max_per_epoch`) |
| `EMIT-GATE` | Treasury | validator giữ cổng cầu — xem `Treasury/reserve-pull.md` |

Trích theo **tên hằng và tên hàm**, không theo số dòng: số dòng trôi khi có người chèn một dòng
phía trên, và trôi **im lặng** vì con trỏ vẫn trỏ vào một dòng có thật.

---

## 6. Điểm còn treo

| Mã | Treo cái gì | Ràng buộc TẠM đang có hiệu lực | Khai ở |
|---|---|---|---|
| `EMIT-FLOOR-IMPL` | Cổng cầu chưa ép sàn ở dạng **tỷ lệ** `1%·C` (§3.2); bản đang có dùng một ngưỡng tuyệt đối | Fail-closed theo cả hai cách đọc: không thoả sàn thì **không** nhả. Ngưỡng dùng trong kịch bản diễn tập **không phải** giá trị vận hành. | tham số triển khai module Treasury |
| `EMIT-INFLATION-DENOM` | Kho này không định nghĩa đại lượng "lạm phát"/"pha loãng" — không mẫu số nào được khai cho nó | Tệp này chỉ phát biểu tốc độ nhả theo mẫu số **tổng trần**, và gọi đúng tên mẫu số đó (§3.4). Không tài liệu nào trong kho được phát biểu một tỷ lệ lạm phát chừng nào đại lượng đó còn chưa có định nghĩa. | §3.4 tệp này |
| `EMIT-DEST-NFT` | Đường Reserve chưa nhận diện kho bằng **NFT chính danh** trên nhánh chính; bản trên nhánh chính nhận diện bằng **địa chỉ** và đo tổng mặt output (§3.5). Bản đổi cách đã có mã nhưng chưa vào nhánh chính | Fail-closed ở cả hai bản: không chứng minh được `delta` đã tới kho thì **không** nhả. Mọi tham số của `reserve_draw` là apply-param, và ràng buộc `RSV-PARAM-FREEZE` ở `Reserve/CONTRACT.md` giữ **chưa gửi meter NFT vào instance nào** — nên chưa instance nào của bản cũ đang giữ quota. | `Reserve/onchain/validators/reserve_draw.ak` (Luật 9) |

Danh mục này ghi **trạng thái hiện thực**, không ghi lựa chọn đang cân nhắc. Luật thì đã đủ ở §3;
chỗ còn lại là mã đuổi theo luật, và mọi bước trung gian đều nghiêng về phía không nhả.

---

## 7. Các câu ĐÃ BỊ THAY

Ghi lại để người đọc bản cũ không kết luận ngược. Ba câu dưới đây từng nằm trong kho và **đã bị
thay bởi tệp này**:

| Câu cũ | Vì sao bị thay |
|---|---|
| *"Gate nhịp Reserve = theo mức Treasury, **KHÔNG theo epoch**"* | Vế cổng cầu đúng và được giữ (§3.2). Vế *"không theo epoch"* sai: nó phủ nhận trần nhịp, mà trần nhịp là vế trả lời một câu hỏi khác. Hai vế bổ sung nhau, không loại trừ nhau. |
| *"Reserve module hiện tại (trần E/1000/epoch) là thiết kế **CŨ** — cần thiết kế lại"* | Sai. Trần E/1000 là vế A của luật hiện hành và là phần **đã có mã, đã chạy xanh trên mạng thử**. Không có gì phải viết lại. |
| *"nhả theo một **hàm nội suy** giữa sàn và trần (1%·C → 2%·C)"* | Không được giữ. Cổng cầu là **một ngưỡng nhị phân** (§3.2). Dải nội suy đòi hai tham số và một hàm chưa từng được định nghĩa; không có mã nào hiện thực nó. |

Một câu cũ khác — *"§7b chưa định nghĩa `C` đo bằng gì on-chain"* — nay **hết hiệu lực**: `C` đã
có định nghĩa ở §2.2, và `SupplyState` đã bắt buộc có mặt trong mọi giao dịch mint (§2.1).
