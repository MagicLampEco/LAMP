# Genesis — phát hành LAMP (lazy-mint, trần 36 tỷ ép trên chuỗi)

> **Policy mainnet duy nhất của module này, `55d3e01b…180f0` (bản mồi), ĐÃ ĐÓNG VĨNH VIỄN
> 2026-09-27** — quota cạn, toàn bộ LAMP của nó nằm ở `lock_vault`. Bản ghi + hai tx:
> `offchain/src/deployed.ts` khối `LAMP_MAINNET.closure`; công cụ: `bootstrap-closure/`.
> Policy chính thức chưa phát hành. Mọi module khác chưa deploy, hoặc chỉ chạy ở mạng thử
> nghiệm. Đọc mục "Trạng thái thật" ở cuối trước khi dùng.

| | |
|---|---|
| **Policy bản mồi (mainnet, ĐÃ ĐÓNG)** | `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` |
| **Asset name** | `4c414d50` = "LAMP" (testnet dùng `744c414d50` = "tLAMP" — hai token độc lập) |
| **Trần Distribution** | 26.370.000.000 LAMP |
| **Trần Reserve** | 9.630.000.000 LAMP |
| **Tổng** | 36.000.000.000 LAMP — **cố định, không đốt** |

## Ý tưởng gốc: cung cố định KHÔNG cần mint sẵn

"Cung cố định" **không** đòi 36 tỷ token phải nằm sẵn trên chuỗi. Nó đòi **tổng phát hành
lịch sử ≤ trần**. Một bộ đếm đơn điệu chặn tại trần thoả điều đó, và thoả mạnh hơn: token
chưa mint thì **không tồn tại** — không bị tấn công, không khoá min-ADA, không cần ai canh giữ.

Bộ đếm đó là **`SupplyState`** — một UTxO duy nhất trên chuỗi, nhận diện bằng thread NFT
one-shot tên `SUPPLY`. Datum 4 trường:

```
dist_minted · reserve_minted · dist_cap · reserve_cap
```

Mọi giao dịch mint LAMP **bắt buộc** tiêu và tái tạo `SupplyState`. Lượng mint Δ bị ép vào
**đúng một** quota theo redeemer, phải ≤ trần, phải đơn điệu tăng, và **không có đường burn**.

## Ba tầng, tuyến tính — không vòng phụ thuộc

| Tầng | Validator | Vai |
|---|---|---|
| 1 | `thread_nft.ak` | mint one-shot NFT `SUPPLY` (param: `genesis_ref`) — neo tính duy nhất |
| 2 | `lamp_mint.ak` | minting policy LAMP, **14 param** (nguồn: chữ ký `validator lamp_mint(`; bảng đầy đủ ở `Genesis/CONTRACT.md §4`), ép toàn bộ luật cung |
| 3 | `supply_state.ak` | spend validator giữ UTxO `SupplyState` |

Tầng 3 chỉ biết policy của tầng 2; tầng 2 chỉ biết policy/name của tầng 1; tầng 1 chỉ biết
`genesis_ref`. Tuyến tính nên apply-param được. Nếu tầng 2 ghim ngược script-hash của tầng 3
thì thành vòng tròn, không deploy nổi — đó là lý do định danh `SupplyState` neo bằng **NFT**,
không bằng script-hash.

Hai validator của đời mồi mainnet — `dist_treasury.ak` (kho 1-pkh nhận LAMP sau khi mint) và
`lock_vault.ak` (kho khoá vĩnh viễn) — nằm ở `bootstrap-closure/onchain/validators/`, cùng công
cụ đã dùng để đóng policy mồi. Chúng không thuộc cụm canonical.

## Hai đường mint

- **`DistributionVest`** — rót vào rổ Distribution. Bị **A-DEST** ép: LAMP phải chảy vào kho
  on-chain đọc từ NFT kho, **không ra ví thường**.
- **`ReserveDraw`** — rút từ rổ Reserve. **Không đòi chữ ký** (permissionless thật): thay vì
  hỏi "ai ký", nó ép giao dịch phải tiêu đúng UTxO mang meter NFT, và nhịp nhả do module
  `Reserve/` chặn ở trần cứng E/1000 mỗi epoch. Nghĩa là kể cả người giữ khoá cũ cũng không
  rút tay được.

**WHO-gate** đi qua Registry NFT: `lamp_mint` đọc bảng registry và lấy authority theo `token_tag`.
Đây là bản canonical **v2/registry-gate**. Bản v1/anchor (`CountMint`, datum 3 trường) đã lỗi
thời. Thư mục `Legacy/` đã gỡ khỏi cây làm việc 2026-08-12 — tra bằng
`git show be14728:Legacy/Tokenomics-v1-anchor/`.

## Asset name là tham số, không phải hằng

`token_name` truyền lúc apply-param: testnet `"tLAMP"`, mainnet `"LAMP"`. Cùng một mã nguồn
deploy được cả hai mạng mà không mint nhầm nhãn.

Hệ quả phải nắm: **đổi `token_name` ⇒ đổi policy id ⇒ token khác hẳn.** Tính duy nhất của
token nằm ở policy id (neo bởi `genesis_ref` one-shot), không nằm ở nhãn.

## Tự kiểm chứng trần 36 tỷ — không cần khoá, không cần tin ai

Trần **không nằm trong tài liệu này**. Nó nằm trong datum của UTxO trên chuỗi. Đọc trực tiếp:

```bash
cd Genesis/scripts && npx tsx verify_mainnet_supply.ts
```

Script chỉ đọc (Koios), không ký gì, không cần khoá.

## Cấu trúc

```
Genesis/
├── onchain/
│   ├── lib/magiclamp/genesis/     # constants · types · util · registry
│   └── validators/                # thread_nft · lamp_mint · supply_state
├── bootstrap-closure/             # đóng policy mồi mainnet: dist_treasury · lock_vault + công cụ
├── offchain/src/                  # datum codec · mintBuilder · supplyState · circulating
├── scripts/                       # deploy · mint · verify (verify_mainnet_supply.ts là bản đọc-chỉ-đọc)
├── CONTRACT.md
├── kho-a-dest.md
└── mainnet-deploy-plan.md
```

## Chạy test

```bash
cd Genesis/onchain && aiken check      # 71 pass / 0 fail (đo 2026-07-29)
cd Genesis/offchain && npm install && npx vitest run   # 71 pass / 0 fail (đo 2026-08-16)
```

## Trạng thái thật — đọc trước khi dùng

- **Policy mồi mainnet đã đóng (2026-09-27).** Kho A-DEST của nó là `dist_treasury` 1-pkh
  (`bootstrap-closure/onchain/validators/dist_treasury.ak`). Quota đã cạn, và toàn bộ LAMP của
  policy mồi đã gom vào `lock_vault` (spend luôn `False`). Số lượng và hai tx nằm ở
  `offchain/src/deployed.ts` khối `LAMP_MAINNET.closure`; nhật ký đo nằm ở
  [`bootstrap-closure/REHEARSAL.md`](./bootstrap-closure/REHEARSAL.md). Không còn khoá đơn nào
  rút được LAMP mainnet.
- **Policy chính thức chưa phát hành trên mainnet.** Kho A-DEST của nó phải là kho vesting,
  không được là ví 1-pkh. Lý do và ràng buộc: [`kho-a-dest.md`](./kho-a-dest.md). Điều kiện
  trước khi phát hành (đối chiếu byte script với mã nguồn, dạng authority của Registry):
  [`mainnet-deploy-plan.md`](./mainnet-deploy-plan.md).
