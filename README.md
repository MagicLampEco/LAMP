# LAMP — token core của MagicLamp Network

Hợp đồng thông minh và đặc tả của **LAMP**, token của hệ sinh thái MagicLamp trên **Cardano**.
Viết bằng [Aiken](https://aiken-lang.org/) (Plutus V3), off-chain bằng TypeScript
([lucid-evolution](https://github.com/Anastasia-Labs/lucid-evolution)).

| | |
|---|---|
| **Policy LAMP chính thức (mainnet)** | **chưa phát hành** — đang diễn tập trên mạng thử nghiệm |
| **Tổng cung** | 36.000.000.000 LAMP — **cố định, không đốt** |
| **Đơn vị con** | 1 LAMP = 1.000.000 **oildrop** (decimals 6) |
| **Giấy phép mã nguồn** | Apache-2.0 |

> **Policy bản mồi `55d3e01b…180f0` ĐÃ ĐÓNG VĨNH VIỄN (2026-09-27).** Đây là policy khởi tạo
> đúc năm 2026-06-18, **không phải** token LAMP sẽ lưu hành. Hai giao dịch đóng:
> [`9d0724bd…`](https://cexplorer.io/tx/9d0724bd9865b14a6e77cf4495bdf73c41489689f38264e43e7ea2757dcff275)
> đúc nốt quota, rồi
> [`8cb8e9ab…`](https://cexplorer.io/tx/8cb8e9abfe318d74cd5f4faaf6e28dd0dd7479e0231f181efa10a1c3bd7ebf9c)
> chuyển toàn bộ 26,37 tỷ LAMP của policy này sang `lock_vault` — một địa chỉ script không ai tiêu
> được. Nó không đúc thêm được, và không ai giữ token của nó. Nguồn: bản ghi `closure` trong
> [`Genesis/offchain/src/deployed.ts`](Genesis/offchain/src/deployed.ts). Chi tiết:
> [`Genesis/bootstrap-closure/`](Genesis/bootstrap-closure/).

Trạng thái trên chuỗi **không nằm trong tài liệu** — nó nằm trong datum của một UTxO mang thread
NFT `SUPPLY` và trong danh sách địa chỉ giữ token. Tự kiểm chứng, không cần khoá, không cần tin ai:

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
   • Trần cung 36 tỷ, đúc dần     • 4 generator (Snapshot/Instant/Vacuum/Schedule)
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
| `Specs/` | Đặc tả cộng đồng: luật phát hành (`Emission`), luật cửa sổ thời gian (`Window`), sổ nguồn dữ kiện — xem `Specs/README.md` | đặc tả (không phải mã) | — |
| `Utils/` | Primitive dùng chung (Q-format, epoch math, clamp, Merkle helper) | ổn định | — |
| `Genesis/` | Phát hành lazy-mint: `SupplyState`, trần/quota/no-burn, A-DEST | ổn định | **Mainnet: chỉ bản mồi, đã đóng 2026-09-27.** **Preprod:** cụm canonical `ACTIVE` (genesis + đúc vào kho) |
| `Allocation/` | Phân bổ ra kênh (hard-cap mỗi kênh, Capped Drop, account NFT committee-gated) | ổn định | chưa — không có bản ghi triển khai trong kho |
| `Distribution/` | Engine Capped Drop (claim → vesting → redeem) + treasury pool | ổn định | **Preprod** (cụm `ACTIVE`): kho `treasury`, `claim_account`, `beacon`, nhánh `FundPot`. Redeem thật: chưa xác minh. Preview: không có bản `ACTIVE` |
| `Treasury/` | Kho bạc custody sổ-kế-toán đa-bucket (collect / release theo quản trị) | đang phát triển | **Preprod** (cụm `ACTIVE`): con trỏ governance và custody dựng ở genesis. Collect / Release: chưa xác minh đã chạy |
| `Reserve/` | Đệm phát hành, trần mỗi epoch, demand-gated qua Treasury-pull | ổn định | **Preprod** (cụm `ACTIVE`): METER và quyền rút đặt vào script ở genesis. `ReserveDraw` trên cụm này: chưa xác minh. Mainnet: nhánh này đã chết từ lúc deploy (`meter_nft_policy` = 28 byte 0) |
| `Faucet/` | Vòi tLAMP cho dev (chỉ testnet) | ổn định | chưa trên bản `ACTIVE`; pool hiện có còn trên policy cũ `SUPERSEDED` — xem `Faucet/deployed-artifacts.md` |
| `Governance/` | Voting Power on-chain v1 (cử tri = cá nhân, ≥4 tham số có cap). iVoteSpace · bầu 3 hội đồng · Recall mới có spec | VP: ổn định · phần còn lại: spec | chưa |
| `PlatformKit/` | Bộ ráp cho bên tích hợp — **đang chuyển sang repo `Registry`**, xem `PlatformKit/README.md` | spec + adapter off-chain | chưa |

Cột "Đã deploy?" lấy trạng thái từ sổ policy
[`Genesis/offchain/src/lampPolicies.ts`](Genesis/offchain/src/lampPolicies.ts) (đọc bản `ACTIVE`
bằng `activeLampPolicyId("<mạng>")`; phần mainnet: `Genesis/offchain/src/deployed.ts`). "Chưa xác
minh" nghĩa là kho không có giao dịch hay sổ nào để đối chiếu — không phải "chắc chắn chưa chạy".
Token trên mạng thử nghiệm là tLAMP, không có giá trị.
| ~~`Airdrop/` `TIGER/` `LaunchAPI/` `SRCL/`~~ | **ĐÃ BÀN GIAO ra ngoài repo này** — SRCL 2026-08-30, ba module còn lại 2026-09-01. Bốn cơ chế **chạy một vài lần rồi thôi** (một đợt phát hành có ngày kết thúc), nên chúng thuộc về kho chiến dịch chứ không thuộc kho token core — kho này giữ thứ chạy lâu dài. Lịch sử còn nguyên: tra bằng `git show 6df96ae:<đường-dẫn>` cho `TIGER/` `LaunchAPI/` `SRCL/`, và **`git show adf2a0e:<đường-dẫn>` cho `Airdrop/`** — `Airdrop/` còn nhận một lượt vá SAU `6df96ae` (cổng `AIRDROP-CAP` cấm đặt trần trên pot chia-theo-stake, `930480e`), nên neo cũ trả về bản THIẾU cổng đó. Neo không phụ thuộc sha: `git log --diff-filter=D -- Airdrop TIGER LaunchAPI SRCL`. Mọi dẫn chiếu tới bốn đường đó còn lại trong repo đọc theo lối đó. |
| ~~`Legacy/`~~ | **ĐÃ GỠ khỏi cây làm việc 2026-08-12.** Bản đã bị thay thế + tài liệu nội bộ giai đoạn đầu. Vẫn còn nguyên trong lịch sử git để làm bằng chứng — tra bằng `git show be14728:Legacy/<đường-dẫn>` hoặc `git log --diff-filter=D -- Legacy/`. Mọi dẫn chiếu `Legacy/…` còn lại trong repo đọc theo lối đó. |

## Trạng thái thật — đọc trước khi dùng

Repo này ưu tiên nói thật hơn nói đẹp:

- **Mainnet không còn kho một-chữ-ký giữ LAMP.** Bản mồi từng dùng `dist_treasury` — script
  **khởi tạo**, mã nguồn tự khai `BOOTSTRAP: authority = 1 pkh`. Từ tx close-lock 2026-09-27,
  toàn bộ 26,37 tỷ LAMP của policy mồi nằm ở `lock_vault` (spend luôn trả `False`, không tham số),
  và kiểm tra sau đóng ghi `LAMP ở nơi khác: 0`. Nguồn: `deployed.ts` ▸ `LAMP_MAINNET.closure`;
  output thô ở [`Genesis/bootstrap-closure/REHEARSAL.md`](Genesis/bootstrap-closure/REHEARSAL.md) §5.
  Thiết kế kho cho policy chính thức sau này: [`Genesis/kho-a-dest.md`](Genesis/kho-a-dest.md).
- **`SRCL/` KHÔNG còn trong repo này** (gỡ 2026-08-30). Bản hiện thực SRCL được duy trì ở nơi
  khác, và bản từng nằm ở đây có lỗ mở nên giữ lại chỉ tạo ra một bản thứ hai để người ta lỡ
  dựng pot từ đó. Repo này vẫn mô tả **cơ chế** SRCL ở [`Papers/srcl.md`](Papers/srcl.md) và
  vẫn giữ pot SRCL trong bảng 18 pot — chỉ không giữ mã. Bản cũ tra được bằng
  `git show 6df96ae:SRCL/<đường-dẫn>`.
- **Ba script mainnet bản mồi: hai đã đối chiếu TỪNG BYTE, một đối chiếu bằng HASH tại thời điểm
  ghi sổ.** Số đo và lý do ở [`Genesis/offchain/src/deployed.ts`](Genesis/offchain/src/deployed.ts)
  khối `provenance` — đó là nguồn duy nhất, đừng chép số sang chỗ khác.
  - `lamp_mint` (`55d3e01b…180f0`) — dựng lại từ `457f312`, áp 8 tham số, **CBOR trùng byte**.
  - `supply_state` (`84f6d84f…34084`) — cùng commit nguồn, **trùng byte**, 528 byte trên chuỗi.
  - `dist_treasury` (`d5e80c9a…edbb6`) — sổ `provenance` vẫn ghi `byteMatch: false`,
    `onChainSize: null` (đo 2026-08-12, lúc kho chưa từng bị tiêu nên chưa có byte trên chuỗi để
    so). Đối chiếu bằng hash: dựng `dist_treasury.ak` từ `60f7e3a` rồi áp authority ⇒ ra đúng
    `d5e80c9a…`. Kho này bị tiêu lần đầu ở tx close-lock 2026-09-27, nên byte của nó có thể đã lên
    chuỗi từ đó; **đối chiếu byte sau thời điểm đó chưa xác minh**.

  Policy mồi đã đóng nên không còn lần mint nào để cổng đối chiếu này phải chặn.
- **Trên mainnet, chỉ `Genesis/` (bản mồi, đã đóng) từng chạy.** Các module còn lại chạy ở mạng
  thử nghiệm (Preprod) hoặc chưa chạy — xem cột "Đã deploy?" ở bảng trên. Token ở mạng thử nghiệm
  là tLAMP, không có giá trị.

## Chạy test

```bash
cd <Module>/onchain && aiken check
cd <Module>/offchain && npm install && npx vitest run
```

## Đóng góp

Mở issue hoặc pull request. Báo lỗi bảo mật: mở issue có nhãn `security`, đừng đăng chi tiết khai
thác trước khi vá.
