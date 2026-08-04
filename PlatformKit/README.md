# PlatformKit — đặc tả đã chuyển sang kho Registry, mã còn ở đây

**Nguồn sự thật của đặc tả PlatformKit/Registry nay là kho riêng:**
<https://github.com/MagicLampNetwork/Registry> → `Specs/{CONTRACT,TECH,FEAT,EXEC,ONBOARDING}.md`

Năm tệp đặc tả từng nằm ở thư mục này (`CONTRACT.md`, `Tech-Spec.md`, `Feat-Spec.md`, `Exec-Spec.md`,
`onboarding.md`) đã chuyển vào
[`Legacy/platformkit-spec-da-chuyen-Registry-2026-08-04/`](../Legacy/platformkit-spec-da-chuyen-Registry-2026-08-04/)
ngày **2026-08-04**. Đọc bản Legacy chỉ để tra lịch sử; **đừng sửa** — sửa ở kho Registry.

Vì sao chuyển: hai bản đã bắt đầu trôi khác nhau (LAMP đổi "niêm yết" → "đăng bạ" và đổi tên tệp theo
chuẩn StandardSpec; Registry vá theo hướng riêng). Hai bản song song thì ai vớ nhầm bản nào cũng thấy
hợp lý — đó là chỗ sinh lỗi. Đối chiếu trước khi chuyển: khác biệt **chỉ nằm ở đường dẫn tham chiếu
chéo và tên tệp**, không có khác biệt nội dung chuẩn tắc (đo 2026-08-04: CONTRACT 41/311 dòng,
TECH 24/412, FEAT 30/299, EXEC 26/261, ONBOARDING 29/171 — soát tay, toàn bộ là đường dẫn/tên tệp).

## Phần CÒN Ở LAMP (chưa chuyển, vẫn dùng)

| Thư mục | Nội dung | Vì sao chưa chuyển |
|---|---|---|
| `offchain/` | SDK PlatformKit | phụ thuộc SDK Treasury bằng đường dẫn tương đối; cách gỡ (phát hành gói npm hay đảo chiều phụ thuộc) **chưa chốt** |
| `examples/` | cấu hình mẫu (OriLife, PhoenixKey…) | đi kèm SDK |
| `scripts/` | script triển khai | đi kèm SDK |
| `tests/` | test SDK | đi kèm SDK |

Phần on-chain (`registry.ak`, `registry_beacon.ak`, `platform.ak`) đã sống ở kho Registry; bản trong
`Treasury/onchain/` bên LAMP là **cùng một nguồn** — Registry đã đối chiếu script hash trùng từng bit ở
ba chiều ngày 2026-08-04 (`registry b3b4c26a…`, `registry_beacon bc3b9041…`).

## Lưu ý về từ vựng — CHƯA CHỐT

Ba kho đang dùng ba từ cho cùng một khái niệm: whitepaper "đăng ký", LAMP "đăng bạ", Registry
"niêm yết". Chọn từ nào là quyết định của anh Aladin; khi có quyết định thì cả ba kho đổi một lượt.

— LAMP agent
