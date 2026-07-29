# SRCL — Staking Reward Contribution Launch

> Một cơ chế ra-mắt của hệ sinh thái MagicLamp: người đang ủy thác ADA trên Cardano **đóng góp phần thưởng staking** của mình cho một đợt Launch, và nhận lại **LAMP** theo tỉ lệ đóng góp. Vốn ADA gốc luôn thuộc về người tham gia. Một cơ chế của khung [Launch](./LAUNCH-FRAMEWORK-Vi.md).

---

## 1. Hiểu trong một phút

Khi bạn ủy thác (delegate) ADA vào một stake pool trên Cardano, mỗi epoch (khoảng một ngày) mạng trả cho bạn một khoản **phần thưởng staking** — một ít ADA, sinh ra từ việc bạn góp phần bảo mật mạng. Vốn ADA bạn ủy thác **không đi đâu cả**, vẫn nằm trong ví bạn.

SRCL cho phép bạn **đóng góp phần thưởng staking đó** (không phải vốn gốc) cho một đợt Launch. Hệ đo phần thưởng bạn đóng góp mỗi epoch, và trả lại cho bạn **LAMP** theo tỉ lệ. Bạn ký uỷ quyền **một lần**, sau đó mỗi epoch hệ tự động ghi nhận.

> Bạn không bỏ vốn, không mua gì. Bạn đóng góp phần thưởng tương lai của việc staking, và được ghi nhận bằng LAMP.

---

## 2. Vì sao vốn gốc an toàn

Một địa chỉ Cardano có hai phần: phần **chi tiêu** (payment) và phần **ủy thác** (stake). SRCL chỉ chạm phần ủy thác:

- **Phần chi tiêu** vẫn là khoá của bạn → chỉ bạn mới tiêu được ADA gốc.
- **Phần ủy thác** được nối tới một script chỉ làm một việc: chuyển phần thưởng staking về pot của đợt Launch.

Mạng Cardano trả phần thưởng vào "tài khoản thưởng" gắn với phần ủy thác. Script rút phần thưởng đó về pot. Vì script **chỉ điều khiển phần thưởng, không điều khiển phần chi tiêu**, nên dù script có lỗi hay bị tấn công, **không ai chạm được vốn gốc của bạn**.

---

## 3. Cơ chế

```
Vốn ADA gốc        →  ở lại ví bạn (không đụng)
Phần thưởng staking →  mỗi epoch, mạng trả vào tài khoản thưởng → script chuyển về pot đợt Launch
LAMP               →  hệ chia cho bạn ∝ phần thưởng bạn đã đóng góp, nhả dần theo lịch
```

**Đo lường:** mỗi epoch, hệ ghi nhận số ADA phần-thưởng mỗi người đóng góp. Đây là đại lượng đo đóng góp.

**Phân bổ:** pot LAMP của đợt được chia cho người tham gia theo tỉ lệ phần thưởng họ đóng góp, **tất định** (ai cũng tính lại ra cùng kết quả) và **bảo toàn** (tổng LAMP chia ra đúng bằng pot). Cách chia dùng phương pháp số nguyên dư-lớn-nhất nên không tạo hay mất một đơn vị nào.

**Nhận:** người tham gia nhận LAMP, nhả dần theo lịch của đợt (ví dụ đều trong N epoch). Mỗi lần nhận, người tham gia ký qua PhoenixKey.

---

## 4. Cấu hình mỗi đợt

SRCL chạy **nhiều đợt**, mỗi đợt một pot riêng. Tuy cùng một cơ chế (đóng phần thưởng staking → nhận LAMP), các đợt khác nhau ở:

| Tham số | Ý nghĩa |
|---|---|
| `pot_lamp` | Số LAMP của đợt |
| `lamp_source` | LAMP lấy từ nguồn nào (quỹ nào trong hệ) |
| `duration_epochs` | Đợt kéo dài bao nhiêu epoch |
| `beneficiary` | ADA phần-thưởng thu về **đi đâu** |
| `operator` | Ai vận hành / có quyền với ADA thu về |
| `rules` | Quy chế riêng của đợt (trần mỗi người, cổng tham gia, vùng pháp lý) |

---

## 5. Hai đợt ví dụ

**Đợt 1 — GreenSun:**
- `pot_lamp` = 360.000.000 LAMP
- `duration_epochs` = 36
- `beneficiary` = pool GST; `operator` = GreenSun Tech Inc (pháp nhân Việt Nam). ADA phần-thưởng
  thu về là **doanh thu vận hành stake pool** của pháp nhân — hạch toán và chịu thuế như mọi
  doanh thu khác, **tách bạch** với việc phân bổ LAMP.
- Đóng góp phần thưởng staking trong 36 epoch được **ghi nhận** bằng LAMP từ pot 360 triệu, chia
  theo công thức tất định ∝ đóng góp. Công thức **không phụ thuộc** doanh thu hay lãi lỗ của
  GreenSun — nên đây không phải quan hệ góp vốn, không chia sẻ kết quả kinh doanh.

**Đợt 2 — kế tiếp:**
- `pot_lamp` = hơn 21.000.000 LAMP, nguồn từ pot **RedBack** (pot #17)
- `beneficiary` = pot **RedBack** (quỹ phòng-thủ-peg của MAGIC); `operator` = tự động, không ai rút
- ADA phần-thưởng vào thẳng quỹ phòng-thủ chung. (Nguồn LAMP và bên hưởng thụ cùng là RedBack — kho RedBack cấp LAMP mở thanh khoản, ADA thưởng quay về nuôi quỹ.)

Hai đợt cùng cơ chế, khác pot / nguồn LAMP / bên hưởng thụ / quy chế.

---

## 6. Người tham gia làm gì

1. Vào trang đợt Launch tại `affiso.net/launch/<đợt>` — đọc tài liệu, vào kênh chat (nhóm Launch trên Chat của SuperApp).
2. **Ký một lần** trên ví hiện có (Lace, Eternl, ...) để uỷ quyền: nối phần ủy thác của mình tới script của đợt, và uỷ quyền cho PhoenixKey ký các bước sau. Vốn gốc không chuyển đi đâu.
3. Mỗi epoch, hệ tự ghi nhận phần thưởng đóng góp. Không cần thao tác thêm.
4. Nhận LAMP theo lịch — PhoenixKey ký claim. Số dư hiển thị trong Chat SuperApp; thông báo trên AffiSo.

---

## 7. Bất biến (điều luôn đúng)

- **Vốn gốc bất khả xâm phạm** — cơ chế không bao giờ chi tiêu phần chi tiêu của người tham gia.
- **Một người một DID** — mỗi người nhận LAMP gắn một DID PhoenixKey sinh trắc; không ai claim hai lần.
- **Ghi nhận theo việc đã xảy ra** — LAMP chia theo phần thưởng đã đóng góp thật, không theo cam kết tương lai.
- **Bảo toàn** — tổng LAMP chia ra + phần còn dư = đúng pot; LAMP không bị đốt, phần dư về kho.
- **Duy nhất một lần** — tính duy nhất của mỗi lần nhận được ép trên chuỗi.

---

## 8. Pháp lý

- Tài sản mã hoá được công nhận là **tài sản** tại Việt Nam (Luật Công nghiệp Công nghệ số, hiệu lực 01/01/2026).
- ADA phần-thưởng về tay bên vận hành là **doanh thu vận hành stake pool** — nghiệp vụ SPO tiêu
  chuẩn của Cardano, tồn tại độc lập với LAMP. Khi quy đổi số ADA đó trên thị trường mở với bên
  thứ ba, doanh nghiệp Việt Nam kê khai và nộp thuế như mọi doanh thu khác. Đây là **định đoạt tài
  sản của chính mình**, khác hẳn với vận hành sàn giao dịch (cần giấy phép riêng).
  > Văn bản dẫn chiếu: **Thông tư 32/2026/TT-BTC** (ký 27/3/2026) hướng dẫn thuế GTGT, TNDN, TNCN
  > với giao dịch tài sản mã hoá, và **Thông tư 15/2026/TT-BTC** (ký 04/3/2026) hướng dẫn kế toán.
  > Hai văn bản này đã xác minh là có thật. **Mức thuế cụ thể áp cho trường hợp này thì chưa** —
  > đừng lấy con số nào ở đây đi lập kế hoạch tài chính khi chưa hỏi kế toán/luật sư.
- Phần thưởng staking sinh từ hành vi vận hành mạng; LAMP chia ra là **ghi nhận đóng góp theo việc đã xảy ra**, không phải bán token đổi vốn.
- Phần phân phối LAMP áp **giới hạn theo vùng pháp lý** (geofence) tuỳ quy chế từng đợt.

---

## 9. Tài nguyên hệ sinh thái dùng

| Chức năng | Dùng |
|---|---|
| Trang đợt + thông báo | AffiSo (`affiso.net/launch/<đợt>`) |
| Định danh + ký uỷ quyền + ký claim | PhoenixKey |
| Đo lường + xác định phần thưởng | AffiSo + Launch engine |
| Phân bổ + nhả LAMP | Launch engine (kho + claim đã kiểm) |
| Hiển thị số dư / địa chỉ | ProofChat trong Chat của SuperApp |
| Chi tiết token + diễn đàn | magiclamp.network + magiclamp.network/forum |
| Cộng đồng đợt | nhóm Launch trên Chat của SuperApp |

Không dùng Telegram, X, hay nền tảng ngoài.
