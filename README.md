# LAMP — token core của MagicLamp Network

Hợp đồng thông minh và đặc tả của **LAMP**, token của hệ sinh thái MagicLamp trên **Cardano**.
Viết bằng [Aiken](https://aiken-lang.org/) (Plutus V3), off-chain bằng TypeScript
([lucid-evolution](https://github.com/Anastasia-Labs/lucid-evolution)).

| | |
|---|---|
| **Policy LAMP (mainnet)** | `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` |
| **Asset** | `55d3e01b….4c414d50` — tên hiển thị **MagicLamp**, mã **LAMP** |
| **Tổng cung** | 36.000.000.000 LAMP — **cố định, không đốt** |
| **Đơn vị con** | 1 LAMP = 1.000.000 **oildrop** (decimals 6) |
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
- **Không đặt cọc để nhận token, không phí tham gia.** Người tham gia phân phối không nộp gì cả.
  (Cơ chế quản trị có yêu cầu **ký quỹ LAMP hoàn lại** khi khởi xướng đề xuất/recall, để chống quấy
  rối — đó là việc nội bộ giữa các thành viên đã có LAMP, không phải điều kiện để nhận LAMP. Xem
  [`Governance/`](Governance/).)
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
Repo MAGIC: <https://github.com/MagicLampEco/MAGIC>

## Bắt đầu đọc từ đâu

| Bạn muốn biết | Đọc |
|---|---|
| LAMP là gì, cung ra sao, ai quản trị | [`Papers/Whitepaper.md`](Papers/Whitepaper.md) — kèm 100 câu hỏi thường gặp |
| 36 tỷ chia thế nào | [`Papers/pot-catalog.md`](Papers/pot-catalog.md) · [`Papers/distribution.md`](Papers/distribution.md) |
| Cơ chế ra mắt (Launch) | [`Papers/launch-framework.md`](Papers/launch-framework.md) · [`Papers/srcl.md`](Papers/srcl.md) |
| Mint LAMP qua OrgDID | [`Genesis/mint-core-adapter.md`](Genesis/mint-core-adapter.md) |

## Cấu trúc

Quy ước đặt tên + phân biệt Spec/Paper: [`CONVENTIONS.md`](CONVENTIONS.md) (theo chuẩn StandardSpec).

**Tài liệu đối ngoại**

| Thư mục | Nội dung |
|---|---|
| `Papers/` | Tài liệu dành cho người ngoài — định vị, giải thích cơ chế. Khi mâu thuẫn với bất kỳ chỗ nào khác trong repo, **`Papers/` đúng**. Một số file còn nhãn DRAFT — nhãn nằm ngay đầu file. Đây là **bản đối ngoại**, không phải nơi đội build lấy chi tiết kỹ thuật |

**Đặc tả nội bộ** nằm trong từng thư mục module dưới đây (`CONTRACT.md`, `Feat-Spec.md`,
`Math-Spec.md`, `Tech-Spec.md`, `Exec-Spec.md`) — INTERNAL mặc định theo StandardSpec Rule 6.

**Hợp đồng on-chain + SDK off-chain**

| Thư mục | Nội dung | Mã nguồn | Đã deploy? |
|---|---|---|---|
| `Utils/` | Primitive dùng chung (Q-format, epoch math, clamp, Merkle helper) | ổn định | — |
| `Genesis/` | Phát hành lazy-mint: `SupplyState`, trần/quota/no-burn, A-DEST | ổn định | **mainnet** |
| `Allocation/` | Phân bổ ra kênh (hard-cap mỗi kênh, Capped Drop, account NFT committee-gated) | ổn định | chưa |
| `Distribution/` | Engine Capped Drop (claim → vesting → redeem) + treasury pool | ổn định | Preview |
| `Treasury/` | Kho bạc custody sổ-kế-toán đa-bucket (collect / release theo quản trị) | đang phát triển | chưa |
| `Reserve/` | Đệm phát hành, trần mỗi epoch, demand-gated qua Treasury-pull | ổn định | chưa |
| `Airdrop/` | Bộ máy Merkle-airdrop dùng chung (pool NFT, nullifier, sweep) | ổn định | chưa |
| `TIGER/` | ETD — pot hồi tố cho người đã ủy thác pool TIGER | ổn định (còn tham số placeholder) | chưa |
| `Faucet/` | Vòi tLAMP cho dev (chỉ testnet) | ổn định | chỉ testnet |
| `Governance/` | Voting Power on-chain v1 (cử tri = cá nhân, ≥4 tham số có cap). iVoteSpace · bầu 3 hội đồng · Recall mới có spec | VP: ổn định · phần còn lại: spec | chưa |
| `PlatformKit/` | Bộ ráp cho bên tích hợp — **đang chuyển sang repo `Registry`**, xem `PlatformKit/README.md` | spec + adapter off-chain | chưa |
| `LaunchAPI/` | API + UI tham chiếu cho đợt ra mắt (`src/server.ts`, `src/etd.ts`, `reference-ui/`) | có mã chạy, chưa ổn định | chưa |
| ~~`Legacy/`~~ | **ĐÃ GỠ khỏi cây làm việc 2026-08-12.** Bản đã bị thay thế + tài liệu nội bộ giai đoạn đầu. Vẫn còn nguyên trong lịch sử git để làm bằng chứng — tra bằng `git show be14728:Legacy/<đường-dẫn>` hoặc `git log --diff-filter=D -- Legacy/`. Mọi dẫn chiếu `Legacy/…` còn lại trong repo đọc theo lối đó. |

## Trạng thái thật — đọc trước khi dùng

Repo này ưu tiên nói thật hơn nói đẹp:

- **Kho giữ LAMP trên mainnet hiện là ví một-chữ-ký.** `dist_treasury` là script **khởi tạo**, mã
  nguồn tự khai `BOOTSTRAP: authority = 1 pkh` — một chữ ký chuyển được LAMP ra khỏi kho. Đang giữ
  1.000.000 LAMP (0,0028% tổng cung, chưa phân phối). **Phải thay bằng `treasury.ak` trước khi mint
  thêm giá trị** — xem [`Genesis/kho-a-dest.md`](Genesis/kho-a-dest.md).
- **`SRCL/` KHÔNG còn trong repo này** (gỡ 2026-08-30). Bản hiện thực SRCL được duy trì ở nơi
  khác, và bản từng nằm ở đây có lỗ mở nên giữ lại chỉ tạo ra một bản thứ hai để người ta lỡ
  dựng pot từ đó. Repo này vẫn mô tả **cơ chế** SRCL ở [`Papers/srcl.md`](Papers/srcl.md) và
  vẫn giữ pot SRCL trong bảng 18 pot — chỉ không giữ mã. Bản cũ tra được bằng
  `git show 6df96ae:SRCL/<đường-dẫn>`.
- **Mã script `lamp_mint` đang chạy trên mainnet chưa được đối chiếu từng byte** với mã nguồn
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
