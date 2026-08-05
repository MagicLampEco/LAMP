# LampDistribution — Capped Drop phân bổ LAMP

Triển khai cơ chế phân bổ LAMP theo **Capped Drop** — tất định, O(1), permissionless.
Mỗi account có entitlement `E`, mở khoá nhỏ giọt `D`/epoch tới hết, account tự rút on-chain
không cần proof/committee. Core engine **DID-agnostic** — dùng cho mọi Cardano team.

> **Đã thay cơ chế.** Bản cũ dùng **Probabilistic Drop Lottery** (random + Merkle + committee
> nonce), có 2 lỗ hổng (proof hết hạn → mất quyền redeem; committee nonce grinding). Capped
> Drop bỏ random/merkle/committee-chọn-winner.

Nguồn chuẩn (interface contract): **[CONTRACT-CappedDrop.md](./CONTRACT-CappedDrop.md)**.
Đặc tả đầy đủ: **[SPEC.md](./SPEC.md)** · hành vi **[SPEC-CappedDrop-FEAT.md](./SPEC-CappedDrop-FEAT.md)** ·
chứng minh **[SPEC-CappedDrop-MATH.md](./SPEC-CappedDrop-MATH.md)** ·
kỹ thuật **[SPEC-CappedDrop-TECH.md](./SPEC-CappedDrop-TECH.md)** ·
triển khai **[SPEC-CappedDrop-EXEC.md](./SPEC-CappedDrop-EXEC.md)**.

> **Đây là kho A-DEST canonical.** `treasury.ak` của module này là kho mà `DistributionVest`
> bắt buộc rót LAMP vào — xem [`Genesis/DEV-NOTE-kho-A-DEST-canonical.md`](../Genesis/DEV-NOTE-kho-A-DEST-canonical.md).
> Vì vậy nó giữ **sổ cái solvency** `cumulative_entitlement` (§C-SOLV-1..4): mọi entitlement
> đã cấp không bao giờ vượt LAMP thật trong kho, ép on-chain tại từng lượt Claim.

## Công thức trung tâm

```
vested(t)  = min( E , D · drops_per_epoch · max(0, t − t0) )   // t0 = start_epoch, MVP drops_per_epoch=1
redeemable = vested(t) − redeemed
```

- `E ≤ D` → ví nhỏ nhận hết ngay epoch đầu.
- `E > D` → ví lớn nhỏ giọt `D`/epoch, hết sau `⌈E/D⌉` epoch.
- Bỏ lỡ epoch **không mất quyền** (vested cộng dồn từ `t0`).

## Kiểm tra (1 lệnh)

```bash
bash Distribution/verify.sh
```

## Cấu trúc

```
Distribution/
  CONTRACT-CappedDrop.md        # interface contract (xương sống — bám file này)
  SPEC.md                       # spec tổng hợp (mô hình + datum + redeem + invariants)
  SPEC-CappedDrop-FEAT.md       # hành vi: entitlement → drip → redeem, ví nhỏ/lớn, hooks DAO
  SPEC-CappedDrop-MATH.md       # chứng minh: đơn điệu, cap E, ⌈E/D⌉, đa-claim, bảo toàn
  onchain/                      # Aiken (Plutus V3)
    lib/magiclamp/lampdist/
      constants.ak  types.ak  math.ak
      util.ak                   # helper + chống double-satisfaction (payment-hash count)
    validators/
      claim_account.ak          # Redeem (vested tất định, không proof) + co-spend kho (C-SOLV-1)
      beacon.ak                 # post DropParam (committee, NFT-auth)
      beacon_nft.ak             # NFT authenticity beacon (one-shot theo genesis_ref)
      treasury.ak               # release LAMP cho redeem + sổ cái solvency (cum ≤ pool)
      treasury_nft.ak           # NFT "TRSY" authenticity kho (one-shot) — chống kho giả
  offchain/src/                 # TypeScript (Lucid Evolution)
    datum.ts committee.ts            # codec Data + committee threshold
    beaconBuilder.ts claimBuilder.ts redeemBuilder.ts   # tx builders (redeem tính vested)
  tests/                        # vitest (foundation + builders + integration)
```

**Gỡ bỏ so với v0.1:** `merkle.ak`, randomness logic, `lottery.ts`, `merkle.ts`, `pparam.ts`.

## Luồng

```
GÁN ENTITLEMENT ───▶ DRIP (tự mở khoá theo epoch) ───▶ REDEEM (owner tự rút)
(committee M/N        vested(t)=min(E, D·r·(t−t0))      amount=vested−redeemed,
 gán E vào datum)     không cần giao dịch                treasury nhả đúng amount
```

1. **Gán entitlement** — committee M-of-N tạo `ClaimAccount` UTxO với `E`, `t0`, `redeemed=0`.
2. **Drip** — vested tự tăng theo epoch (thuần toán), dừng ở `E`. Không ai phải làm gì.
3. **Redeem** — owner spend `ClaimAccount`, validator tính `vested` từ datum + `DropParam`
   beacon (reference input) + validity range; nhả `vested − redeemed` LAMP; cập nhật `redeemed`.

## An toàn (giữ 3 fix audit treasury)

- **C1** double-satisfaction qua stake credential → đếm theo **payment script hash**.
- **C2** treasury N× release → ràng đúng 1 treasury/tx theo script hash.
- **M1** treasury drain ADA → `tre_out.value == tre_in.value − amount` (bảo toàn mọi asset khác).

LAMP **không burn** (fixed-supply 36 tỷ bất biến); giảm lưu hành chỉ qua Treasury accounting.

## MVP — phạm vi & defer

| Có (build + test) | Defer (lý do trong SPEC / CONTRACT §5) |
|---|---|
| ClaimAccount Redeem (vested tất định) / DropParam beacon / Treasury | 7 validator riêng từng kênh (SRCL/Scavenger/…) |
| Datum codec + tx builders + test | PhoenixKey on-chain DID proof (anti-sybil ở tầng committee) |
| Aiken mock-tx + vitest | Cơ chế DAO chỉnh `drops_per_epoch` (multi-drop/pause) — hooks chừa chỗ |

## Hooks DAO (post-MVP — chừa chỗ)

- **Multi-drop per-DID:** DAO tăng `drops_per_epoch` cho DID uy tín → rút nhanh hơn, vẫn cap `E`.
- **Pause/penalty:** DAO đặt `drops_per_epoch = 0` trong `N` epoch → vested đứng yên, không tịch thu.

Cả 2 không phá đơn điệu/cap (chứng minh [SPEC-CappedDrop-MATH.md](./SPEC-CappedDrop-MATH.md) §5).
