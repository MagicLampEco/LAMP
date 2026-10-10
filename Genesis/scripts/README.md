# Genesis lazy-mint — deploy Preview (đường cũ, 01–03)

> **Đường `01`–`03` dưới đây (8 tham số, Preview) đã lỗi thời.** Đường hiện hành là cụm canonical
> với `lamp_mint` 14 tham số: `20_canonical_genesis.ts` … `32_etd_claim.ts`, thứ tự chạy ở
> [`../canonical-preprod-runbook.md`](../canonical-preprod-runbook.md). Policy `ACTIVE` của từng
> mạng lấy từ `../offchain/src/lampPolicies.ts` (`activeLampPolicyId`), không từ tài liệu này.
> Biến bí mật đặt ngay trước lệnh chạy, không đặt trong tệp `.env` ở gốc kho như đoạn "Chuẩn bị"
> bên dưới mô tả.

Deploy + mint thử lazy-mint tLAMP trên Cardano Preview. Mặc định **SUBMIT=false**
(build tx + eval script + in CBOR, KHÔNG gửi chain — an toàn, kiểm logic trước khi
tốn tADA).

## Chuẩn bị

(Đường cũ) `.env` ở repo root (`../../.env`):

```
NETWORK=Preview
BLOCKFROST_KEY=preview...        # https://blockfrost.io
WALLET_SEED="word1 word2 ..."    # HOẶC PRIVATE_KEY=ed25519_sk... (ví testnet)
```

Ví cần ≥ 10 tADA (faucet: https://docs.cardano.org/cardano-testnet/tools/faucet).

## Chạy

> `01_deploy_lazymint.ts` (`npm run deploy`) áp 8 tham số cho `lamp_mint`, lệch chữ ký hiện hành 14
> tham số (`validator lamp_mint(` trong `Genesis/onchain/validators/lamp_mint.ak`) — chỉ giữ để tra lịch
> sử, không dùng để dựng policy mới. Cụm canonical đi qua `20_canonical_genesis.ts` … (runbook
> `Genesis/canonical-preprod-runbook.md`).

```bash
npm install
npm run deploy                  # SUBMIT=false — build + eval, KHÔNG gửi
SUBMIT=true npm run deploy       # gửi thật lên Preview
```

## Luồng (3 tầng tuyến tính — CONTRACT §3)

1. `thread_nft` policy = apply(genesis_ref) — one-shot SUPPLY NFT (đảm bảo SupplyState DUY NHẤT).
2. `lamp_mint` policy = apply(thread_pid, SUPPLY, token_name, [auth], 1, dist_dest, meter_pid, meter_nm) — gate cap/quota. `dist_dest` = hash KHO Distribution treasury (A-DEST: DistributionVest rót toàn bộ LAMP vào kho, không ra ví cá nhân).
3. `supply_state` spend = apply(tlamp_pid, thread_pid, token_name) — giữ SupplyState UTxO.

- **Tx A**: consume genesis seed → mint 1 SUPPLY NFT → tạo SupplyState UTxO (dist_minted=0).
- **Tx B**: spend SupplyState (Advance) + mint Δ tLAMP (DistributionVest) → recreate
  SupplyState' (dist_minted += Δ) + trả Δ cho ví. Authority stub = ví deploy (1-of-1).

`TEST_MINT_OILDROP` (env, mặc định 100_000_000 = 100 tLAMP) — lượng mint thử ở Tx B.

## Apply-param (BẮT BUỘC qua env — không hard-code)

Mọi biến dưới bị **nướng vào policy-id / script-hash**: sai một byte là một token/kho
KHÁC, mà LAMP **không burn** ⇒ không có đường quay lui. `_guards.ts` chặn thiếu biến,
sai dạng hex, sai độ dài, và giá trị chết (toàn `0` / toàn `f`).

| Biến | Dạng | Dùng ở | Ghi chú |
|---|---|---|---|
| `GENESIS_REF_HASH` | 64 hex (tx-hash 32 byte) | `02`, `03` | Neo one-shot của `thread_nft` → sinh `threadPid` → apply-param của **cả** `lamp_mint` lẫn `supply_state`. Trước đây là literal Preview nướng cứng. |
| `GENESIS_REF_IDX` | số nguyên ≥ 0 | `02`, `03` | Nửa còn lại của `OutputReference`. Quên biến **không** mặc định về 0 — script dừng. |
| `DIST_DEST` | 56 hex (script-hash) | `01`, `02`, `03` | A-DEST: kho Distribution nhận toàn bộ LAMP mint ra. |
| `METER_NFT_POLICY` | 56 hex (policy-id) | `01`, `02`, `03` | Gate `ReserveDraw`. |
| `METER_NFT_NAME` | hex, độ dài chẵn | `01`, `02`, `03` | Cùng cặp với `METER_NFT_POLICY`. |
| `TOKEN_NAME` | hex, độ dài chẵn | `config.ts` | **Override tuỳ chọn.** Bỏ trống = `tLAMP` testnet / `LAMP` mainnet. Đặt `TOKEN_NAME=LAMP` (ASCII) là sai — phải là hex `4c414d50`. |

`01_deploy_lazymint.ts` chạy `SUBMIT=false` thì `DIST_DEST`/`METER_*` được thay bằng
placeholder kèm cảnh báo (chỉ để dựng tx xem CBOR); `SUBMIT=true` thì bắt buộc có thật.
`02`/`03` **luôn gửi**, nên không có chế độ nới.
