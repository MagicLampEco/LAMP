# `Specs/` — đặc tả cộng đồng của LAMP

Thư mục này giữ **đặc tả dành cho người đọc ngoài đội**: bên tích hợp, chuyên gia soi hợp đồng,
người muốn kiểm chứng luật kinh tế của LAMP mà không có quyền vào hệ.

Kho `MagicLampEco/LAMP` là kho **công khai**. Mọi tệp trong `Specs/` được viết ra như một bản
công khai ngay từ đầu — **không** sinh ra bằng cách lọc bớt một bản nội bộ.

## Được phép nằm ở đây

- Hợp đồng giao diện, bất biến, phương thức định danh.
- Bố cục dữ liệu **đã nằm trên chuỗi**.
- Test vector, chứng minh của cơ chế **đã triển khai**.
- Mô hình đe doạ **đã vá**.

## KHÔNG được nằm ở đây

- Tham số **chưa chốt** — chỉ được ghi ở dạng **danh mục trạng thái**: treo cái gì · ràng buộc
  tạm đang có hiệu lực (luôn fail-closed) · khai ở tệp nào. Không ghi giá trị đang cân nhắc.
- Mô hình đe doạ **chưa vá** — đó là một lỗ hổng đang sống, không phải một đặc tả.
- Vận hành, xoay khoá, lịch trình nội bộ, lý do chọn phương án, hiện trạng đội.

## Quan hệ với `Papers/` và với spec module

| Nơi | Vai | Người đọc |
|---|---|---|
| `Specs/` | **nguồn chân lý** của một luật vắt ngang nhiều module | bên ngoài đội, đã quen kỹ thuật |
| `Papers/` | bản phái sinh phổ thông — diễn giải, không định nghĩa | công chúng |
| `<Module>/CONTRACT.md` | hợp đồng + bất biến **riêng của một module** | đội build |

Luật một chiều: `Papers/` và `<Module>/CONTRACT.md` **trỏ** về `Specs/`, không chép lại luật.
Thấy hai nơi cùng phát biểu một luật ⟹ một trong hai đang là bản sao sẽ chết im lặng.

## Nội dung

| Đường | Giữ luật gì |
|---|---|
| [`Emission/CONTRACT.md`](Emission/CONTRACT.md) | Luật phát hành LAMP: trần cung, lazy-mint, no-burn, trần nhịp Reserve, cổng cầu Treasury |

---

# Sổ nguồn — dữ kiện nào LAMP sở hữu, và ở đâu

Kho LAMP **sở hữu** định nghĩa của token LAMP. Kho khác trong hệ sinh thái được **trích dẫn**, và
**không** được định nghĩa lại. Bảng này là địa chỉ chính thức để trích.

| Dữ kiện | Nguồn duy nhất | Trích bằng |
|---|---|---|
| Trần cung, lazy-mint, no-burn, lưu hành `C` | `Specs/Emission/CONTRACT.md` §2 | §, không phải số dòng |
| Đơn vị: 1 LAMP = 1.000.000 oildrop | `Specs/Emission/CONTRACT.md` §1 | § |
| Luật nhả Reserve (trần nhịp + cổng cầu) | `Specs/Emission/CONTRACT.md` §3 | § |
| Bất biến phát hành `EMIT-*` | `Specs/Emission/CONTRACT.md` §4 | mã bất biến |
| Mô hình quyền biểu quyết (KHÔNG token-weighted) | `Governance/VotingPower/CONTRACT.md` | § |
| Kế toán Treasury — giảm lưu hành = chuyển vào kho, không đốt | `Treasury/CONTRACT.md` | § |
| Hằng `dist_cap` / `reserve_cap` dùng trong mã | `Genesis/onchain/lib/magiclamp/genesis/constants.ak` | **tên hằng** |
| Phân bổ 18 pot | *chưa có nguồn* — xem "Khoảng trống" bên dưới | — |

## Ba mức trích, theo thứ tự ưu tiên

1. **TRỎ** — dẫn đường tới nguồn, **không nhắc lại giá trị**. Mặc định.
2. **SINH** — bắt buộc phải có giá trị tại chỗ (mã cần hằng số) thì **sinh từ nguồn** lúc build,
   đừng gõ tay.
3. **CHÉP CÓ NHÃN** — khi 1 và 2 đều không được. Bản chép phải kèm **(a)** con trỏ tới nguồn và
   **(b)** mốc thời gian hoặc commit lúc chép. Thiếu một trong hai thì không được chép.

**Trích bằng TÊN — tên hằng, tên hàm, số mục — không bằng số dòng.** Tên sống qua refactor; số dòng
thì không, và nó hỏng **im lặng**: chèn một dòng phía trên là mọi con trỏ bên dưới trỏ sai mà vẫn
trỏ vào một dòng có thật.

**Phép thử một dòng, tự soát TRƯỚC khi gõ một con số:**
*"Con số này, khi nguồn của nó đổi, ai báo cho chỗ này biết?"* Không trả lời được thì đang tạo một
bản sao sẽ chết im lặng — quay về mức 1 hoặc 2.

## Vì sao viết ra thành luật

Đo trong kho này (bỏ `node_modules/` và thư mục build): hằng `reserve_cap` được **khai báo độc lập
8 lần** ở 8 tệp, trong đó hai lần nằm trong **cùng một module** — một ở thư viện, một trong chính
validator dùng thư viện đó. `dist_cap` khai 4 lần. Không lần nào trỏ về lần nào.

Các bản sao đó hiện đang **khớp giá trị**. Vấn đề không phải hôm nay chúng sai, mà là **không có gì
kêu lên vào ngày một bản đổi** — và một bản sao chết im lặng nguy hiểm hơn một chỗ thiếu thông tin,
vì người đọc tin nó.

## Khoảng trống đã biết

| Dữ kiện | Tình trạng |
|---|---|
| Con số phân bổ 18 pot | Chỉ tồn tại trong `Papers/`, mà `Papers/` là bản **phái sinh** — nên dữ kiện này hiện **không có nguồn định nghĩa**. Grep toàn bộ `*.ak` và `*.ts` (bỏ `node_modules/`, build): 0 kết quả. |
| Hằng cap trong mã | 8 + 4 khai báo độc lập như trên; chưa có một module nào được chỉ định là nơi khai duy nhất để các nơi khác `import`. |

Ghi ra để người đọc không nhầm một khoảng trống thành một nguồn.
