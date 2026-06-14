# Faucet tLAMP — self-serve, DID-gated, rate-limited, tự thu hồi

Faucet cấp tLAMP test cho dev/Agent xây trên Cardano. **Self-serve permissionless**
(ai cũng claim qua SDK, kể cả bot), nhưng **chống sybil bằng DID NFT** + **rate-limit
per-DID** + **tự thu hồi token idle** để bảo toàn pool hữu hạn.

## Hằng số (1 tLAMP = 10^6 oil)

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `drip_oil` | `1_001_000_000` (1001 tLAMP) | lượng nhả mỗi claim |
| `cooldown_epochs` | `36` | tối thiểu giữa 2 claim của cùng 1 DID |
| `reclaim_epochs` | `1001` | account idle đủ lâu → ai cũng thu hồi |

Cả 3 nằm trong `FaucetConfig` (datum POOL) → chỉnh không cần redeploy.

## Cơ chế NFT-beacon (phá vòng hash-param chéo)

**Bài học đã tránh:** KHÔNG truyền script-hash của pool ↔ account làm compile-time
param (vòng tròn không deploy được). Thay vào đó dùng **NFT authenticity**:

1 minting policy `faucet_nft` (param `genesis_ref`) đúc 2 token:
- **POOL NFT** `"POOL"` (`504f4f4c`, one-shot) — nhận diện faucet pool UTxO.
- **ACCT NFT** `"ACCT"` (`41434354`) — nhận diện faucet-account per-DID.

- Pool validator nhận diện account qua **"output mang ACCT NFT cùng `faucet_nft_policy`"**.
- Account validator nhận diện pool qua **"output mang POOL NFT cùng `faucet_nft_policy`"**.

Cả hai chỉ tham chiếu **1 param chung `faucet_nft_policy`** (tính từ `genesis_ref`
ở deploy) — KHÔNG bên nào ôm hash bên kia → KHÔNG vòng tròn.

## Validators (onchain, Aiken)

| File | Loại | Vai trò |
|---|---|---|
| `validators/faucet_nft.ak` | mint | `MintPool` (one-shot POOL NFT) + `MintAccount` (đúc ACCT khi pool spend) |
| `validators/faucet_pool.ak` | spend | kho tLAMP + POOL NFT. `Claim` / `Reclaim` |
| `validators/faucet_account.ak` | spend | account per-DID + ACCT NFT. `Use` / `ReclaimIdle` |
| `lib/magiclamp/faucet/ledger.ak` | types | `FaucetConfig`, `FaucetAccount`, redeemers, NFT names |
| `lib/magiclamp/faucet/util.ak` | helpers | epoch (validity_range), NFT-beacon count/find, double-sat guards |

> `validators/faucet.ak` + `tlamp_policy.ak` (v1) giữ làm **legacy** (pool nhả 100
> tLAMP không DID-gated). Không phá; v2 độc lập.

### Param signature

```
faucet_nft(genesis_ref)
faucet_pool(faucet_nft_policy, did_nft_policy, lamp_policy, lamp_name, ms_per_epoch)
faucet_account(faucet_nft_policy, did_nft_policy, lamp_policy, lamp_name, ms_per_epoch)
```

- `did_nft_policy`: testnet truyền policy DID **test**; mainnet truyền **PhoenixKey DID**.
  Định danh per-DID = **asset name** của DID NFT (`did_name`).
- `(lamp_policy, lamp_name)`: nhận diện tLAMP (testnet dùng tLAMP của Faucet/Genesis).

## Flow

### Claim (DID-gated, permissionless)

```
inputs:  POOL UTxO (Claim) + DID-NFT UTxO [+ account cũ nếu re-claim]
mint:    ACCT NFT +1 (MintAccount)
outputs: pool' = pool − drip tLAMP   (POOL NFT + ADA + FaucetConfig bảo toàn)
         account mới: ACCT NFT + drip tLAMP + datum{did_name, last_epoch=now}
         DID NFT trả lại ví claimer
```

Onchain ép: drip đúng `drip_oil`; `account.last_epoch == now`; `did_name` account
khớp DID NFT trong input; nếu có account cũ cùng `did_name` → `now ≥ old.last_epoch
+ cooldown_epochs`. `now` = `validity_range.lower_bound / ms_per_epoch` → builder
PHẢI set `validFrom = bây giờ`.

### Use (chủ DID gia hạn + dùng tLAMP)

```
inputs:  account UTxO (Use) + DID-NFT UTxO
outputs: account': ACCT NFT + did_name bất biến + last_epoch=now, tLAMP ≤ cũ
```

Cập nhật `last_epoch` → tránh bị reclaim. Cho phép rút bớt tLAMP để dùng (không tự bơm).

### ReclaimIdle (keeper thu hồi, permissionless)

```
inputs:  account idle (ReclaimIdle) + POOL UTxO (Reclaim)
outputs: pool' = pool + account.tLAMP   (POOL NFT + ADA + config bảo toàn)
```

Onchain ép: `now ≥ last_epoch + reclaim_epochs (1001)`; **toàn bộ** tLAMP account →
pool (`Δ pool tLAMP ≥ account tLAMP`). KHÔNG cần DID NFT → ai cũng làm keeper. Bảo
toàn cung: token idle quay lại pool, không bốc hơi, không vào ví keeper.

## Offchain SDK (`offchain/src/`)

- `constants.ts` — `DRIP_OIL`, `COOLDOWN`, `RECLAIM`, NFT names, `MS_PER_EPOCH_PREVIEW`.
- `datum.ts` — codec `FaucetConfig` / `FaucetAccount` + redeemers (PoolRedeemer,
  AccountRedeemer, FaucetNftRedeemer).
- `claimDidBuilder.ts` — `buildClaimDidTx` (claim dùng DID NFT, re-claim tùy chọn).
- `useBuilder.ts` — `buildUseTx`.
- `reclaimBuilder.ts` — `buildReclaimTx`.
- `mintBuilder.ts` + `claimBuilder.ts` — legacy v1.

## Test

```
cd Faucet/onchain && aiken check          # 55/55 pass (v2: 28)
cd Faucet/offchain && npx vitest run        # 40/40 pass (v2: 23)
```

## Điểm cần orchestrator chốt

1. **Bind DID owner ↔ DID NFT.** Hiện `Use`/`Claim` chứng minh quyền sở hữu DID
   bằng **mang DID NFT trong input** (không ràng buộc khóa ký riêng). Đủ cho testnet.
   Nếu PhoenixKey DID dùng khóa sinh trắc gắn cứng → cân nhắc thêm `extra_signatories`
   check ở mainnet.
2. **1 account/DID không cưỡng chế tuyệt đối.** ACCT NFT đúc khi `MintAccount`; pool
   ép account mới có `did_name` + drip đúng, nhưng KHÔNG ép account output phải nằm ở
   `faucet_account` script (chỉ "mang ACCT NFT"). Kẻ xấu có thể đúc ACCT về ví mình →
   né cooldown lần sau. Token vẫn hữu hạn (pool −drip mỗi lần) nên không drain vô hạn,
   nhưng cooldown best-effort. Nếu cần cứng: thêm param/ràng buộc account address ở
   pool (cân nhắc tái sinh vòng hash — dùng NFT cho account script hash thay vì param).
3. **`reclaim_epochs` hằng compile-time ở `faucet_account.ak`** (= 1001) để keeper
   khỏi đọc FaucetConfig. Nếu muốn chỉnh runtime → phải đọc config pool qua reference
   input (thêm I/O). Chốt: giữ hằng cho đơn giản.
