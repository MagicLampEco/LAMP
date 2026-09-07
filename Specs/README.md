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
