# MagicLamp Launch — Khung ra-mắt dùng chung toàn hệ sinh thái

> Launch là nền tảng ra-mắt của hệ sinh thái MagicLamp: bất kỳ dự án nào cũng có thể ra mắt bằng cách mời cộng đồng **đóng góp một nguồn lực của họ** để nhận lại **một token mới** — đồng thời tiếp cận người dùng cuối, thu hút ban quản trị và cố vấn kỹ thuật. Vận hành trên AffiSo tại `affiso.net/launch`.

---

## 1. Launch là gì

Launch là hành động **ra mắt một dự án hoặc một token** trong hệ sinh thái. Người tham gia đóng góp một nguồn lực mà họ đang có hoặc sẽ tạo ra (sức tính toán, dung lượng lưu trữ, dữ liệu, sức lao động, hoặc phần thưởng staking), và nhận lại token của đợt ra mắt.

Một đợt Launch phục vụ bốn việc:

1. **Tiếp cận người dùng cuối** — đưa sản phẩm tới người dùng thật ngay từ đầu.
2. **Thu hút ban quản trị** — mời người đóng góp tham gia điều hành dự án.
3. **Mời cố vấn kỹ thuật** — mở diễn đàn đánh giá, phản biện thiết kế.
4. **Ghi nhận đóng góp bằng token** — theo công thức tất định, công khai.

> **Launch KHÔNG phải hoạt động gọi vốn và KHÔNG bán token.** Người tham gia không nộp tiền,
> không mua gì, không đặt cọc, không giao vốn gốc cho ai. Token được ghi nhận cho phần đóng góp
> **đã xảy ra**, không phải vật đối ứng cho một khoản nộp vào.

---

## 2. Nguyên lý chung

Người tham gia **đóng góp nguồn lực, không giao vốn gốc**. Họ giữ toàn quyền sở hữu tài sản gốc; chỉ đóng góp phần **giá trị họ tạo ra hoặc phần thưởng tương lai** của tài sản đó. Đóng góp đó được **ghi nhận bằng token mới** theo công thức tất định, minh bạch, ai cũng tính lại được — token là **ghi nhận việc đã xảy ra**, không phải hàng đổi hàng.

Mỗi đợt Launch cấu hình theo các trục:

| Trục | Ý nghĩa | Ví dụ |
|---|---|---|
| Nguồn đóng góp | nguồn lực người tham gia đưa vào | phần thưởng staking · sức tính toán · dữ liệu · sức lao động |
| Phận của nguồn | nguồn đã về tay bên vận hành thì dùng làm gì | phục vụ vận hành · làm tài sản đảm bảo · quy đổi trên thị trường mở với bên thứ ba |
| Token nhận | token người tham gia nhận lại | LAMP · MAGIC · WORK |
| Cách đo | đo đóng góp bằng đại lượng nào | số ADA thưởng · số byte phục vụ · số bản ghi dữ liệu |
| Phân bổ | chia token theo tỉ lệ nào | theo đóng góp · theo thời gian gắn bó |
| Thời hạn | đợt kéo dài bao lâu | số epoch cố định · tới khi đạt trần |
| Bên hưởng thụ | nguồn đóng góp về đâu | quỹ dự án · quỹ phòng-thủ chung |
| Cổng tham gia | ai tham gia được | mở · theo DID · theo vùng pháp lý |

---

## 3. Các cơ chế Launch

Mỗi loại nguồn lực có một **cơ chế Launch riêng với giải pháp kỹ thuật riêng**, nhưng dùng chung khung này và nền tảng AffiSo:

| Cơ chế | Nguồn đóng góp | Token nhận | Trạng thái |
|---|---|---|---|
| **SRCL** (Staking Reward Contribution Launch) | phần thưởng staking (đo bằng ADA) | LAMP | spec riêng: `SRCL-SPEC-Vi.md` |
| **LampNet Launch** | sức tính toán + lưu trữ thiết bị | LAMP | (sẽ thiết kế) |
| **VeData Launch** | dữ liệu thực để kiểm thử hệ thống | LAMP | (sẽ thiết kế) |
| **AladinWork Launch** | sức lao động / khả năng chi trả lao động | WORK / MAGIC | (sẽ thiết kế) |

Mỗi cơ chế có thể chạy **nhiều đợt**, mỗi đợt một **pot** riêng với thời điểm, nguồn token, và quy chế khác nhau.

---

## 4. Vận hành trên AffiSo

Mọi đợt Launch đăng ký và hiển thị tại `affiso.net/launch`. Mỗi dự án có một trang riêng `affiso.net/launch/<project>` (ví dụ `affiso.net/launch/lampnet`) nơi người tham gia tìm thấy:

- Mọi tài liệu của dự án.
- Kênh chat của dự án.
- Mọi thông báo của đợt Launch.

AffiSo cung cấp cho đợt Launch: cơ chế xác định phần thưởng cho người tham gia, đo lường đóng góp + quy kết giới thiệu, và tiếp cận cộng đồng người đóng góp của nền tảng.

---

## 5. Ràng buộc: dùng tài nguyên hệ sinh thái

Toàn bộ tiến trình của một đợt Launch **phải dùng tài nguyên nội bộ của hệ sinh thái MagicLamp**, không phụ thuộc nền tảng ngoài:

| Chức năng | Dùng | KHÔNG dùng |
|---|---|---|
| Chat / cộng đồng | nhóm Launch trên tính năng Chat của **SuperApp** (tích hợp ProofChat) | Telegram, X, Discord |
| Thông báo đợt Launch | **AffiSo** tại `affiso.net/launch` | — |
| Chi tiết token + hệ sinh thái | **magiclamp.network** | — |
| Diễn đàn đánh giá / cố vấn | **magiclamp.network/forum** | — |
| Định danh + ký | **PhoenixKey** | ví ngoài đứng riêng |
| Xác thực đóng góp | **VeData** | bên thứ ba ngoài hệ |

---

## 6. Vai trò các component

| Component | Vai trò trong Launch |
|---|---|
| **AffiSo** | nền tảng Launch (`affiso.net/launch`) + cơ chế xác định phần thưởng + đo lường + cộng đồng |
| **Launch engine (token)** | thuật toán phân bổ LAMP/MAGIC ∝ đóng góp, tất định bảo toàn; tái dùng kho + claim đã kiểm |
| **PhoenixKey** | định danh DID (một người một DID) + ký uỷ quyền + ký claim |
| **VeData** | xác thực đóng góp thật (chống gian lận, chống Sybil ở khâu xác thực) |
| **ProofChat** | hiển thị số dư / địa chỉ trong tin nhắn nhóm chat |
| **SuperApp** | giao diện người dùng (frontend) + ví + chat |
| **magiclamp.network** | trang thông tin token + hệ sinh thái + diễn đàn |

---

## 7. Vòng đời một đợt Launch

1. **Đăng ký** — dự án đăng ký đợt Launch trên AffiSo (`affiso.net/launch/<project>`): chọn cơ chế, cấu hình các trục §2, công bố tài liệu + kênh chat.
2. **Đóng góp** — người tham gia ký uỷ quyền một lần (qua PhoenixKey) để đóng góp nguồn lực; hệ tự ghi nhận theo từng kỳ.
3. **Đo lường** — đóng góp được đo + xác thực (VeData / đo on-chain), quy kết giới thiệu qua AffiSo.
4. **Phân bổ** — Launch engine chia token đích ∝ đóng góp, tất định bảo toàn.
5. **Nhận** — người tham gia nhận token (PhoenixKey ký claim), nhả theo lịch của đợt.
6. **Hiển thị + thông báo** — số dư trong Chat SuperApp; thông báo trên AffiSo; chi tiết trên magiclamp.network; thảo luận tại forum + nhóm Launch.
