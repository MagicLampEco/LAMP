# LampDistribution — Deploy + E2E live test (Cardano Preview / Preprod theo `NETWORK`)

Chạy full flow THẬT trên mạng thử nghiệm: beacon → grant → redeem (Capped Drop v3; cơ chế
lottery đã gỡ). Không giả lập — mỗi bước in tx hash + link explorer để kiểm chứng.

> **Phạm vi của bộ script này.** Nó dựng một cụm Distribution tự chứa (test-LAMP riêng), không
> phải cụm canonical đang chạy trên Preprod. Cụm canonical (kho, claim_account, beacon áp tham
> số theo genesis `ACTIVE`) đi qua `Genesis/scripts/20`…`32` — xem
> `Genesis/canonical-preprod-runbook.md`. Gốc cửa sổ lấy theo mạng (`Specs/Window/CONTRACT.md` v1.2 §2;
> hàm `windowOrigin()` trong `config.ts`); Preview cũng có gốc, nhưng cụm canonical chỉ có trên Preprod,
> nên chạy với `NETWORK=Preprod`.

## Chuẩn bị biến môi trường

`config.ts` không đọc tệp `.env` nào. Đặt các biến dưới đây ngay trước lệnh `tsx <tệp>.ts`, để
bí mật chỉ sống trong một tiến trình. `NETWORK` chỉ nhận `Preview | Preprod | Mainnet`. Tối thiểu:

```bash
NETWORK=Preprod
BLOCKFROST_KEY=preprodXXXXXXXXXXXXXXXXXXXXXXXXXXXX   # blockfrost.io, project cùng mạng với NETWORK
PRIVATE_KEY=ed25519_sk1...                           # HOẶC WALLET_SEED="word1 word2 ..."
```

Ví deploy cần ≥ 10 tADA (faucet: https://docs.cardano.org/cardano-testnet/tools/faucet).

### Tuỳ chọn (đều có mặc định self-contained)

| Key | Ý nghĩa | Mặc định |
|---|---|---|
| `WALLET_SEED` | seed phrase (thay PRIVATE_KEY) | — |
| `COMMITTEE_KEYHASHES` | CSV N keyhash hex (28-byte) committee | ví deploy (1-of-1 self-test) |
| `COMMITTEE_THRESHOLD` | override threshold | ⌈2N/3⌉ |
| `LAMP_POLICY_ID` / `LAMP_ASSET_NAME` | dùng token LAMP ngoài (vd tLAMP) thay test-LAMP | native sig của ví deploy |
| `BEACON_NFT_POLICY` | policy NFT beacon (khi agent beacon_nft ship) | native sig của ví deploy |
| `WALLET_SEED_B` / `PRIVATE_KEY_B` | ví B test (claim account thứ 2) | placeholder PKH |
| `TEST_LAMP_MINT` | LAMP mint (02), số nguyên | 1_000_000 |
| `TREASURY_FUND_OILDROP` | LAMP fund treasury (03), oildrop | 500_000 LAMP |

> **Committee self-test:** mặc định committee = 1 ví deploy (threshold 1) để demo full
> flow bằng 1 ví. Production: truyền `COMMITTEE_KEYHASHES` 3 keyhash. Lưu ý khi đó cần
> multi-sign thật (ngoài phạm vi runner 1-ví này).

## Chạy

```bash
npm install
npm run deploy      # 01: apply params 3 validator → deployed.json
npm run mint-lamp   # 02: mint test-LAMP fund treasury
npm run genesis     # 03: mint 3 beacon NFT + tạo beacon/treasury/2 claim-account UTxO
npm run e2e         # 04: grant → beacon → redeem → verify on-chain
# hoặc gộp:
npm run all
```

State giữa các bước nằm ở `deployed.json` (tự sinh, gitignore).

## Kiểm tra

```bash
npm run typecheck   # tsc --noEmit, phải sạch
```

## Ghi chú kiến trúc

- **test-LAMP vs tLAMP:** runner self-contained — mint test-LAMP riêng (native sig của
  ví deploy), KHÔNG phụ thuộc tLAMP. Dùng tLAMP: set `LAMP_POLICY_ID` +
  `LAMP_ASSET_NAME` ở 01, fund treasury thủ công, bỏ qua 02.
- **beacon_nft policy:** blueprint hiện chưa có validator minting beacon_nft. Runner
  mint NFT bằng native one-shot sig policy (policy id deterministic theo keyhash ví →
  01 bake được vào claim_account/beacon trước khi 03 mint NFT thật). Khi agent kia ship
  beacon_nft minting validator: set `BEACON_NFT_POLICY` + thay `nativeSigPolicy` ở 03.
- **cửa sổ (epoch):** validator tính cửa sổ từ validity_range POSIX ms theo
  `(posix_ms − window_origin_ms) / ms_per_epoch`; trên Preprod/Mainnet đó chính là số epoch Cardano
  (`Specs/Window/CONTRACT.md` v1.2). Runner dùng cùng công thức (`config.ts`, tính ở `Utils` ▸
  `windowOf`), và `window_origin_ms` là tham số CUỐI của `claim_account`, `beacon`, `treasury`.
