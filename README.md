# LAMP — token core của MagicLamp Network

Hợp đồng thông minh và đặc tả của **LAMP**, token của hệ sinh thái MagicLamp trên **Cardano**.
Viết bằng [Aiken](https://aiken-lang.org/) (Plutus V3), off-chain bằng TypeScript
([lucid-evolution](https://github.com/Anastasia-Labs/lucid-evolution)).

| | |
|---|---|
| **Policy LAMP (mainnet)** | `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` |
| **Asset** | `55d3e01b….4c414d50` — tên hiển thị **MagicLamp**, mã **LAMP** |
| **Tổng cung** | 36.000.000.000 LAMP — **cố định, không đốt** |
| **Đơn vị con** | 1 LAMP = 1.000.000 oildrop (decimals 6) |
| **Tra cứu** | [cexplorer.io/policy/55d3e01b…](https://cexplorer.io/policy/55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0) |
| **Giấy phép mã nguồn** | Apache-2.0 |

Trần 36 tỷ **không nằm trong tài liệu** — nó nằm trong datum của một UTxO trên chuỗi mang thread
NFT `SUPPLY`. Tự kiểm chứng, không cần khoá, không cần tin ai:

```bash
cd Genesis/scripts && npx tsx verify_mainnet_supply.ts
```

## LAMP không phải cái gì

- **Không bán token.** Không ICO, không IDO, không presale, không nhận tiền của ai đổi lấy LAMP.
- **Không hứa giá, không hứa lợi nhuận, không cam kết niêm yết.**
- **Không đặt cọc, không phí tham gia.** Người tham gia không nộp gì cả.
- **Quản trị không theo số token nắm giữ** — cử tri là **cá nhân** định danh qua PhoenixKey DID;
  nắm nhiều token không mua được nhiều quyền.

LAMP được **ghi nhận cho đóng góp đã xảy ra**, theo công thức tất định và công khai — ai cũng
tính lại ra cùng kết quả.

Pháp nhân phát hành: **GreenSun Tech Inc** (Việt Nam).

## Ranh giới với repo MAGIC

```
   LAMP (repo này)                      MAGIC (repo khác)
   ────────────────                     ─────────────────
   • Cung cố định 36 tỷ                 • 4 generator (Snapshot/Instant/Vacuum/Schedule)
   • Phát hành + phân bổ                • Vault sinh MAGIC từ LAMP
   • Kho bạc                            • AppEconomics / ConsumeMAGIC
   • Quản trị                           • Integrator SDK (DID-agnostic)
                            ▲
        MAGIC phụ thuộc LAMP (cần LAMP mới sinh MAGIC) — MỘT chiều
```

LAMP = giá trị nền + quản trị. MAGIC = tiêu dùng ở tầng ứng dụng.
Repo MAGIC: <https://github.com/MagicLampNetwork/MAGIC>

## Bắt đầu đọc từ đâu

| Bạn muốn biết | Đọc |
|---|---|
| LAMP là gì, cung ra sao, ai quản trị | [`Specs/LAMP-POLICY-EXPLAINER.md`](Specs/LAMP-POLICY-EXPLAINER.md) — kèm 100 câu hỏi thường gặp |
| 36 tỷ chia thế nào | [`Specs/LAMP-POT-CATALOG.md`](Specs/LAMP-POT-CATALOG.md) · [`Specs/LAMP-DISTRIBUTION-SPEC.md`](Specs/LAMP-DISTRIBUTION-SPEC.md) |
| Cơ chế ra mắt (Launch) | [`Specs/LAUNCH-FRAMEWORK-Vi.md`](Specs/LAUNCH-FRAMEWORK-Vi.md) · [`Specs/SRCL-SPEC-Vi.md`](Specs/SRCL-SPEC-Vi.md) |
| Mint LAMP qua OrgDID | [`Specs/lamp-mint-core-adapter.md`](Specs/lamp-mint-core-adapter.md) |

## Cấu trúc

**Đặc tả công khai**

| Thư mục | Nội dung |
|---|---|
| `Specs/` | Đặc tả dành cho công chúng — nguồn sự thật khi mô tả LAMP ra bên ngoài |

**Hợp đồng on-chain + SDK off-chain**

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `Utils/` | Primitive dùng chung (Q-format, epoch math, clamp, Merkle helper) | ổn định |
| `Genesis/` | Phát hành lazy-mint: `SupplyState`, trần/quota/no-burn, A-DEST | **live mainnet** |
| `Allocation/` | Phân bổ ra kênh (hard-cap mỗi kênh, Capped Drop, account NFT committee-gated) | ổn định |
| `Distribution/` | Engine Capped Drop (claim → vesting → redeem) + treasury pool | live Preview |
| `Treasury/` | Kho bạc custody sổ-kế-toán đa-bucket (collect / release theo quản trị) | đang phát triển |
| `Reserve/` | Đệm phát hành, trần mỗi epoch, demand-gated qua Treasury-pull | ổn định |
| `Airdrop/` | Bộ máy Merkle-airdrop dùng chung (pool NFT, nullifier, sweep) | ổn định |
| `TIGER/` | ETD — pot hồi tố cho người đã ủy thác pool TIGER | ổn định |
| `SRCL/` | Hạ tầng phân phối cho cơ chế ra mắt SRCL | ⚠️ **có lỗi mở, xem bên dưới** |
| `Faucet/` | Vòi tLAMP cho dev (chỉ testnet) | ổn định |
| `Governance/` | iVoteSpace, bầu 3 hội đồng, Voting Power, Recall | mới có spec |
| `PlatformKit/` | Bộ ráp cho bên tích hợp | spec |
| `LaunchAPI/` | API + UI tham chiếu cho đợt ra mắt | spec |
| `Legacy/` | Bản đã bị thay thế + tài liệu nội bộ giai đoạn đầu — **giữ để truy vết, KHÔNG dùng lại** |

## Trạng thái thật — đọc trước khi dùng

Repo này ưu tiên nói thật hơn nói đẹp:

- **`SRCL/` có một lỗi CRITICAL đang mở (S1).** Cửa `Sweep` so epoch POSIX tuyệt đối với
  `end_epoch` tương đối nên **mở sẵn từ ngày đầu** và không đòi chữ ký — bất kỳ ai cũng đẩy sạch
  pot về treasury. **Đừng nạp LAMP thật vào SRCL pot trước khi vá.** Chi tiết + cách vá:
  [`SRCL/README.md`](SRCL/README.md).
- **Bản script `lamp_mint` đang chạy trên mainnet chưa được đối chiếu từng byte** với mã nguồn
  trong repo. Việc đó phải xong trước khi mint thêm bất kỳ lượng nào có giá trị.
- **Chưa module nào ngoài `Genesis/` chạy trên mainnet.** Những chỗ ghi "live Preview" là mạng
  thử nghiệm, token ở đó là tLAMP, không có giá trị.

## Chạy test

```bash
cd <Module>/onchain && aiken check
cd <Module>/offchain && npm install && npx vitest run
```

## Đóng góp

Mở issue hoặc pull request. Báo lỗi bảo mật: mở issue có nhãn `security`, đừng đăng chi tiết khai
thác trước khi vá.
