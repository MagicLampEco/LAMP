# [NHÁP — ANH DUYỆT TRƯỚC KHI GỬI]

---

Chào team AffiSo,

Mình gửi yêu cầu xây dựng trang **`affiso.net/launch/MagicLamp`** — trang ra mắt chính thức của hệ sinh thái MagicLamp trên nền tảng AffiSo. Đây là trang trung tâm hiển thị tất cả các đợt ra mắt của **toàn dự án MagicLamp** (không bao gồm các dự án con như LampNet, AladinWork, VeData — các dự án đó có trang riêng sau).

---

## Tài liệu cần đọc

| Tài liệu | Mô tả | Link |
|---|---|---|
| Launch Framework | Khung ra mắt dùng chung, nguyên lý, vòng đời, vai trò | [Launch-Framework](https://github.com/MagicLampNetwork/LAMP/blob/feat/lamp-mint-compose-anchor-cap/SPEC/Launch-Framework-Vi.md) |
| SRCL Spec | Cơ chế SRCL (staking reward → LAMP) đầy đủ | [SRCL-Spec](https://github.com/MagicLampNetwork/LAMP/blob/feat/lamp-mint-compose-anchor-cap/SPEC/SRCL-Spec-Vi.md) |
| AffiSo Requirements | Yêu cầu chức năng FR-L1..L6 và FR-S1..S5 | [AffiSo-Requirements](https://github.com/MagicLampNetwork/LAMP/blob/feat/lamp-mint-compose-anchor-camp/SPEC/AffiSo-Launch-Requirements-Vi.md) |
| Launch API | Backend API đã viết sẵn (source of truth nội dung) | [LaunchAPI/](https://github.com/MagicLampNetwork/LAMP/tree/feat/lamp-mint-compose-anchor-cap/LaunchAPI) |
| Data Model | Types cho LaunchCampaign, Phase, Stats | [types.ts](https://github.com/MagicLampNetwork/LAMP/blob/feat/lamp-mint-compose-anchor-cap/LaunchAPI/src/types.ts) |
| Campaigns hiện tại | 2 đợt khởi đầu: SRCL-1 + TIGER Airdrop | [campaigns.json](https://github.com/MagicLampNetwork/LAMP/blob/feat/lamp-mint-compose-anchor-cap/LaunchAPI/data/campaigns.json) |

> Các file spec sẽ được merge vào `main` trước khi trang đi live. Link trên là branch hiện tại.

---

## Trang cần xây: `affiso.net/launch/MagicLamp`

### Mô tả tổng quan

Trang liệt kê **tất cả các đợt ra mắt** của MagicLamp. Mỗi đợt có:
- Tên + cơ chế (SRCL / Airdrop / TGE / ...)
- Trạng thái (upcoming / active / ended)
- Số tiền LAMP phân bổ
- Thời gian (epoch bắt đầu / kết thúc)
- Nút tham gia → vào trang đợt cụ thể

### Layout gợi ý

```
affiso.net/launch/MagicLamp
├── Hero: logo + tagline MagicLamp + nút "Xem tất cả đợt"
├── Filter: [Tất cả] [Đang diễn ra] [Sắp tới] [Đã kết thúc]
├── Grid / List các đợt launch:
│   ├── Card: SRCL Đợt 1 — GreenSun   [ACTIVE]  360M LAMP
│   ├── Card: TIGER Airdrop            [UPCOMING] 120M LAMP
│   └── ...
└── Footer: link magiclamp.network, chat SuperApp

affiso.net/launch/MagicLamp/srcl-1        ← trang đợt cụ thể
affiso.net/launch/MagicLamp/tiger-airdrop ← trang đợt cụ thể
```

### Dữ liệu lấy từ đâu

Tất cả nội dung lấy từ **Launch API** (mình host):

```
Base URL: https://api.magiclamp.network/launch  (sẽ cấp sau khi deploy)
Dev URL:  http://localhost:3210  (chạy local: git clone LAMP repo → cd LaunchAPI → npm install && npm run dev)

GET /v1/campaigns                      → list tất cả đợt
GET /v1/campaigns/:id                  → nội dung 1 đợt (title, description_md, phases, stats)
GET /v1/campaigns/:id/stats            → live stats (participants, total_contribution_lovelace, lamp_distributed)
GET /events?campaign_id=<id>           → SSE stream: real-time update (dùng cho live countdown, stats)
```

Khi mình cập nhật nội dung (content, stats, trạng thái) → API tự push webhook tới AffiSo backend. AffiSo cập nhật cache → trang tự refresh. Không cần AffiSo poll liên tục.

**Cấu hình webhook nhận push:**
```
POST https://affiso.net/webhooks/launch   ← AffiSo tạo endpoint này
Header: X-Launch-Signature: sha256=<hmac>  ← verify để chặn fake push
Body: { event, campaign_id, campaign, timestamp }
```

Mình sẽ cấp `webhook_secret` khi đăng ký.

---

## Tích hợp hệ thống AffiSo (affiso.net + SuperApp)

Dưới đây là những gì AffiSo cần tích hợp cho trang này và cho mỗi đợt launch. Mình phân theo trang để dễ track:

### A. Trang `affiso.net/launch/MagicLamp` (trang tổng)

| # | Chức năng | Mô tả |
|---|---|---|
| A1 | Hiển thị danh sách đợt | Fetch từ `GET /v1/campaigns`, render card theo trạng thái |
| A2 | Filter trạng thái | upcoming / active / ended, client-side |
| A3 | Real-time stats | Connect SSE `/events`, cập nhật số người tham gia + LAMP phân bổ không cần reload |
| A4 | Referral link | Mỗi user đăng nhập có link `?ref=<affiso_uid>` tự động gắn vào nút "Tham gia" |

### B. Trang `affiso.net/launch/MagicLamp/:campaign_id` (trang đợt cụ thể)

| # | Chức năng | Mô tả |
|---|---|---|
| B1 | Nội dung đợt | Render `description_md` (Markdown → HTML), hiển thị phases timeline |
| B2 | Kết nối ví | Nút "Kết nối ví Cardano" → Eternl / Lace / Vespr (CIP-0030 standard) |
| B3 | Tạo / liên kết PhoenixKey DID | Nếu user chưa có DID → hướng dẫn tạo PhoenixKey. Nếu có → link DID vào tài khoản AffiSo |
| B4 | Đăng ký tham gia | Form xác nhận + ký một lần (SRCL: ký nối phần ủy thác; Airdrop: verify địa chỉ trong snapshot) |
| B5 | Theo dõi phần thưởng | Bảng cá nhân: mỗi epoch — đóng góp của tôi / LAMP nhận được / tổng tích lũy |
| B6 | Claim LAMP | Nút claim → ký giao dịch Cardano qua ví đã kết nối → PhoenixKey ký claim phần cuối |
| B7 | Chia sẻ referral | "Chia sẻ link giới thiệu" → copy link có `?ref=<uid>` → tracker AffiSo quy kết |
| B8 | Kênh cộng đồng | Nút "Vào nhóm Launch" → deep link sang Chat trong SuperApp (nhóm đợt tương ứng) |

### C. SuperApp (mobile)

| # | Chức năng | Mô tả |
|---|---|---|
| C1 | Tab "Launch" | Hiển thị danh sách đợt (cùng data từ API), tích hợp native |
| C2 | Push notification | Khi có campaign mới / phase bắt đầu / sắp hết hạn claim → notify user đã đăng ký |
| C3 | Bảng cá nhân | Xem epoch-by-epoch contribution + LAMP balance |
| C4 | Claim trong app | Ký claim trực tiếp trong SuperApp (ví tích hợp) |
| C5 | Chat nhóm Launch | Chat nhóm của từng đợt trong tab Chat |

---

## Ràng buộc bắt buộc

1. **Không ký mù** — mọi giao dịch ký phải hiển thị ý định rõ ràng phía client (phân tích tx trước khi user ký, không chỉ tin chuỗi mô tả từ backend).
2. **Không phụ thuộc ngoài** — chat dùng nhóm trong SuperApp (ProofChat), không dùng Telegram/Discord/X. Tracking dùng AffiSo nội bộ.
3. **Một người một DID** — mọi khâu nhận thưởng và quy kết referral đều gắn PhoenixKey DID (sinh trắc, một người không thể có hai DID).
4. **Webhook verify** — phải verify `X-Launch-Signature` trước khi xử lý push từ LaunchAPI (chặn fake push).

---

## Ngoài phạm vi của AffiSo (bên khác lo)

| Việc | Ai lo |
|---|---|
| Thuật toán phân bổ LAMP ∝ đóng góp + kho + claim on-chain | Token-side (LAMP team) |
| Script reward-only Cardano (`did_stake.ak`) | PhoenixKey team |
| Ký uỷ quyền Cardano + ký claim cuối | PhoenixKey (rust_core) |
| Xác thực đóng góp chống gian lận | VeData |
| Hosting Launch API | LAMP team (mình host) |

---

## Để bắt đầu

1. Clone [LAMP repo](https://github.com/MagicLampNetwork/LAMP) nhánh `feat/lamp-mint-compose-anchor-cap`
2. `cd LaunchAPI && npm install && npm run dev` → server lên tại `http://localhost:3210`
3. Test `GET /v1/campaigns` → xem 2 đợt mẫu
4. Xây frontend với data này, sau đó mình đăng ký webhook để tự động sync

Câu hỏi và phản hồi: kênh **#magiclamp-launch** trong Chat của SuperApp.

Trân trọng,
AladinContract
