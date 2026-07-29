# [NHÁP — ANH DUYỆT TRƯỚC KHI GỬI / TẠO REPO]

# Bàn giao AffiSo — Module Launch (repo `AffiSo/Launch`)

Chào team AffiSo,

Mình bàn giao yêu cầu + code để team dựng **module Launch** cho MagicLamp, hiển thị ở
`affiso.net/launch/magiclamp`. Repo của module: **`github.com/AffiSo/Launch`**.

Ranh giới: **AffiSo dựng frontend + module Launch**; **LAMP cung cấp API dữ liệu + toán
phân bổ (canonical)**. AffiSo KHÔNG tự tính entitlement — chỉ render JSON từ Launch API
(để số LAMP luôn khớp on-chain, nguyên tắc P8 một-nguồn-sự-thật).

---

## 1. Trang tổng `affiso.net/launch/magiclamp`

Danh sách **4 đợt launch** (không gồm dự án con LampNet/AladinWork):

| Đợt | Cơ chế | Nguồn dữ liệu |
|---|---|---|
| **ETD** — Early TIGER Delegator | retroactive theo stake tích lũy pool TIGER, drip 36 epoch | Launch API (mục 3) |
| **Airdrop** | đăng-ký (SPO+Delegator) + tạo PhoenixKey DID, chia theo stake người đăng ký | Launch API |
| **SRCL** — Staking Reward Contribution Launch | góp reward ADA (không góp gốc) → LAMP | Launch API |
| **Joinnet** | thưởng góp tài nguyên thiết bị vào hạ tầng LampNet | Launch API |

Danh sách lấy từ `GET /v1/campaigns` (đã có). Mỗi card: tên + cơ chế + trạng thái
(upcoming/active/ended) + LAMP phân bổ + thời gian. Filter client-side theo trạng thái.

---

## 2. Trang ETD `affiso.net/launch/magiclamp/etd` — UX bắt buộc

1. **Nội dung đợt** — render `description_md` từ `GET /v1/campaigns/etd`.
2. **Khung search địa chỉ** — người dùng dán địa chỉ ví (payment `addr1...`/`addr_test1...`
   hoặc stake `stake1...`).
3. **Kết quả** (gọi `GET /v1/launch/etd/check?address=<addr>`):
   - **Bảng lịch sử stake mọi epoch**: epoch · pool · stake · cờ ★ nếu là pool TIGER.
   - **Nút "Chỉ hiện epoch TIGER"** → lọc còn các epoch stake vào TIGER (đã áp cutoff),
     mỗi epoch kèm số stake tương ứng.
   - **accStake TIGER** (tổng stake·epoch — mẫu số cá nhân, minh bạch kiểm toán).
   - **Số LAMP sẽ nhận** — lấy từ trường `lamp.amount_lamp`. Nếu `lamp.provisional=true`
     (snapshot chưa chốt) → hiển thị "đang tạm tính / chốt sau mốc cắt", KHÔNG hiển thị số.

> LAMP là kết quả toán phân bổ trên TOÀN snapshot (mẫu số = Σ accStake mọi người) — nên
> chỉ chính xác sau khi snapshot chốt. Frontend chỉ đọc `lamp.amount_lamp`, không tự tính.

---

## 3. Launch API (LAMP host) — hợp đồng dữ liệu

Base: `https://api.magiclamp.network/launch` (cấp sau deploy) · Dev: `http://localhost:3210`.

### `GET /v1/campaigns` — danh sách đợt (đã có)
### `GET /v1/campaigns/:id` — nội dung 1 đợt (title, description_md, phases, stats)

### `GET /v1/launch/etd/check?address=<addr|stake_addr>` — MỚI (cho trang ETD)

Trả JSON:
```jsonc
{
  "ok": true,
  "data": {
    "address": "addr1...",
    "stake_address": "stake1...",
    "network": "Preview",
    "pool_tiger": "pool1q9kwa675j2z53jecrs6pn3fqsc9ypxrsypu5dgu6hammqkagy22",
    "cutoff_epoch": "512",                // null nếu chưa cắt
    "history": [                          // MỌI epoch, sort tăng dần
      { "epoch": "500", "pool_id": "pool1other", "stake_lovelace": "1000000000", "is_tiger": false },
      { "epoch": "501", "pool_id": "pool1q9k...", "stake_lovelace": "2000000000", "is_tiger": true }
    ],
    "tiger": [                            // chỉ epoch TIGER < cutoff (cho nút lọc)
      { "epoch": "501", "stake_lovelace": "2000000000" }
    ],
    "tiger_acc_stake": "2000000000",
    "lamp": { "amount_lamp": "1234", "capped": false, "provisional": false }
  }
}
```
Lỗi: `{ "ok": false, "error": "..." }` (400 thiếu address · 502 lỗi Blockfrost/địa-chỉ).
Mọi số lớn là **string** (BigInt-safe) — parse ở client khi cần.

---

## 4. Tích hợp lõi AffiSo (như các trang khác)
Referral `?ref=<uid>` · tạo/liên kết PhoenixKey DID · kết nối ví (Lace, Eternl, ...) ·
theo dõi thưởng · claim · chat nhóm Launch trong SuperApp. (Chi tiết như message trước.)

## 5. Ràng buộc
- Không ký mù · webhook verify `X-Launch-Signature` · một-người-một-DID ·
  chat/tracking nội bộ (không Telegram/Discord).

## 6. Tài liệu + code tham chiếu (LAMP repo)
| Thứ | Link |
|---|---|
| Launch API | `MagicLampNetwork/LAMP` · `LaunchAPI/` (endpoint ETD: `src/etd.ts`) |
| Toán entitlement TIGER (canonical) | `TIGER/offchain/src/` (`entitlement.ts`, `snapshot.ts`, `check.ts`) |
| CLI kiểm chứng | `TIGER/scripts/tiger_check.ts` (`npm run check -- <addr>`) |
| Danh sách đợt | `LaunchAPI/data/campaigns.json` |

## 7. Còn chờ LAMP chốt (ảnh hưởng số LAMP hiển thị, KHÔNG chặn dựng UI)
- **Cutoff epoch** (mốc 18/6 UTC = epoch nào) + **snapshot chốt**.
- **Owner mapping** ETD qua mô hình đăng-ký (delegator khai payment pkh/DID) — trước đó
  `lamp.provisional=true`.

Để bắt đầu: clone LAMP repo nhánh `feat/lamp-mint-compose-anchor-cap` → `cd LaunchAPI`
→ `npm install && npm start` → thử `GET /v1/launch/etd/check?address=stake1...` (cần
`BLOCKFROST_KEY` trong env). Câu hỏi: kênh **#magiclamp-launch** trong SuperApp.

Trân trọng,
AladinContract
