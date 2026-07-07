# TOKEN METADATA — LAMP (DRAFT chờ anh duyệt, 19/6)

> Nội dung CÔNG KHAI (hiện trên ví/explorer). Anh duyệt trước khi em gắn/đăng ký.

## Trường metadata

| Trường | Giá trị | Ghi chú |
|---|---|---|
| **name** (tên hiển thị) | `MagicLamp` | giống "Cardano" của ADA, "Ethereum" của ETH |
| **ticker** | `LAMP` | mã giao dịch |
| **asset name on-chain** | `LAMP` (#`4c414d50`) | tên kỹ thuật, KHÔNG đổi |
| **decimals** | `6` | 1 LAMP = 10⁶ đơn-vị-con |
| **đơn vị con** | `oil` | giống `lovelace` của ADA, `wei` của ETH. 1 LAMP = 1.000.000 oil |
| **url** | `https://magiclamp.network/` | |
| **logo** | `MagicLamp Logo.jpeg` → PNG 64×64 (base64) | em chuẩn bị |
| **description** | (chọn 1 bên dưới) | |

> Lưu ý: chuẩn Cardano token registry KHÔNG có trường "đơn vị con" riêng — `oil` là quy ước
> tài liệu (như lovelace/wei), em ghi vào description + docs, không phải field ví đọc.

## Description — 3 phương án (học cách NIGHT diễn đạt: điềm đạm, nói công dụng, không hứa giá)

**P1 — sát ý anh, gọn:**
> Token chính thức của hệ sinh thái MagicLamp. https://magiclamp.network/

**P2 — lịch sự hơn (khuyến nghị), tiếng Việt:**
> LAMP là token chính thức của hệ sinh thái MagicLamp — hạ tầng tiện ích và quản trị mở
> trên Cardano. Tìm hiểu thêm tại https://magiclamp.network/

**✅ CHỐT P3 (EN) + cơ chế sinh MAGIC — bản chất đúng + tuân thủ:**
> LAMP is the official token of the MagicLamp ecosystem — open utility and governance
> infrastructure on Cardano. Each epoch, LAMP generates MAGIC, a non-transferable utility
> credit consumed within ecosystem applications. Learn more at https://magiclamp.network/

**Bản ngắn (nếu registry giới hạn ký tự):**
> LAMP is the official token of the MagicLamp ecosystem on Cardano. Each epoch it generates
> MAGIC, a non-transferable utility credit consumed across ecosystem applications.
> https://magiclamp.network/

### Vì sao diễn đạt vậy (TUÂN THỦ + ĐÚNG BẢN CHẤT)
- **MAGIC = "non-transferable utility credit", "consumed"** — đúng: MAGIC là datum kế toán,
  KHÔNG phải token, không chuyển nhượng, tiêu hết khi dùng. KHÔNG mô tả MAGIC như coin.
- **TRÁNH "earn / reward / yield / passive income / returns"** — các từ này ngụ ý lợi nhuận
  tài chính → rủi ro bị xếp là chứng khoán (Howey). Dùng "generates ... consumed for utility".
- **"governance"** giữ được vì governance MagicLamp = cá nhân (PhoenixKey DID), KHÔNG token-weighted.

*(NIGHT của Midnight viết "the utility token of the Midnight network" — giữ tinh thần
official + công dụng + link, diễn đạt riêng, không sao chép.)*

## Cơ chế gắn metadata — 2 lựa chọn

| Chuẩn | Nơi ở | Sửa logo/ghi chú sau? | Ví hỗ trợ |
|---|---|---|---|
| **CIP-68** (reference NFT, datum on-chain) | on-chain | ✅ sửa bằng spend ref NFT | đang lan rộng |
| **CIP-26** (Cardano Token Registry, GitHub) | off-chain | ✅ PR ký lại | Eternl/Lace/explorer đọc rộng nhất |

→ **Khuyến nghị: làm CẢ HAI** — CIP-26 cho ví hiển thị rộng (decimals/logo/ticker), CIP-68
cho metadata on-chain mutable. Cả hai cập nhật được sau, không đụng policy LAMP.

## Chờ anh chốt
1. Description: P1 / P2 / P3 (hay VN+EN cả hai)?
2. decimals=6 + đơn vị con "oil" + name "MagicLamp" + ticker "LAMP" — đúng ý anh chứ?
3. Logo: dùng `MagicLamp Logo.jpeg` (em resize PNG chuẩn). Anh có bản vuông/nền trong tốt hơn không?
