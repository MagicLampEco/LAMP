# LampDistribution — Capped Drop phân bổ LAMP

Triển khai cơ chế phân bổ LAMP theo **Capped Drop** — tất định, O(1), permissionless.
Mỗi account có entitlement `E`, mở khoá nhỏ giọt theo từng cửa sổ (epoch Cardano) tới hết, account
tự rút on-chain không cần proof/committee. Core engine **DID-agnostic** — dùng cho mọi Cardano team.

> **Đã thay cơ chế.** Bản cũ dùng **Probabilistic Drop Lottery** (random + Merkle + committee
> nonce), có 2 lỗ hổng (proof hết hạn → mất quyền redeem; committee nonce grinding). Capped
> Drop bỏ random/merkle/committee-chọn-winner.

Nguồn chuẩn (interface contract): **[capped-drop/CONTRACT.md](./capped-drop/CONTRACT.md)**.
Đặc tả đầy đủ: **[SPEC.md](./SPEC.md)** · hành vi **[capped-drop/Feat-Spec.md](./capped-drop/Feat-Spec.md)** ·
chứng minh **[capped-drop/Math-Spec.md](./capped-drop/Math-Spec.md)** ·
kỹ thuật **[capped-drop/Tech-Spec.md](./capped-drop/Tech-Spec.md)** ·
triển khai **[capped-drop/Exec-Spec.md](./capped-drop/Exec-Spec.md)**.

> **Đây là kho A-DEST canonical.** `treasury.ak` của module này là kho mà `DistributionVest`
> bắt buộc rót LAMP vào — xem [`Genesis/kho-a-dest.md`](../Genesis/kho-a-dest.md).
> Vì vậy nó giữ **sổ cái solvency** `outstanding_entitlement` (§C-SOLV-1..5) = **số còn nợ**
> `Σ(entitlement − redeemed)`: tăng khi cấp, giảm khi trả, và luôn bị ép ≤ LAMP thật trong kho
> tại từng lượt Claim.

## Công thức trung tâm

```
A_span     = A(bây giờ) − a0                       // A: chỉ số cộng dồn do beacon giữ; a0: giá trị lúc mở tài khoản
vested     = min( E , dpe · √E · A_span )          // dpe = drops_per_epoch, ghim bằng 1
redeemable = vested − redeemed
```

- Tốc độ mở khoá **lõm theo cỡ**: pot lớn mở khoá chậm hơn theo tỉ lệ, nên tách một pot thành nhiều
  tài khoản không làm tổng tốc độ tăng theo số phần.
- Bỏ lỡ cửa sổ **không mất quyền** — `A` cộng dồn và không bao giờ giảm.
- Mỗi lượt redeem còn bị **cắt ngọn** theo tổng đã phát (`total_redeemed`) của kho.

Công thức chi tiết, lý do chọn dạng căn và các hằng số: `capped-drop/CONTRACT.md` v3 §1, §3, §4
(v3 duyệt 2026-09-22). Bản v2 (`D · dpe · (t − t0)`) đã bị thay.

## Kiểm tra (1 lệnh)

```bash
bash Distribution/verify.sh
```

## Cấu trúc

```
Distribution/
  capped-drop/CONTRACT.md        # interface contract (xương sống — bám file này)
  SPEC.md                       # spec tổng hợp (mô hình + datum + redeem + invariants)
  capped-drop/Feat-Spec.md       # hành vi: entitlement → drip → redeem, ví nhỏ/lớn, hooks DAO
  capped-drop/Math-Spec.md       # chứng minh: đơn điệu, cap E, ⌈E/D⌉, đa-claim, bảo toàn
  FundPot.md                    # rót trọn một phân bổ từ kho vào một pot script (nhánh FundPot của treasury.ak)
  pot-vault/                    # két trung gian của kênh pot 8 — đã dựng (aiken), CHƯA triển khai trên mạng nào
  onchain/                      # Aiken (Plutus V3)
    lib/magiclamp/lampdist/
      constants.ak  types.ak  math.ak
      util.ak                   # helper + chống double-satisfaction (payment-hash count)
    validators/
      claim_account.ak          # Redeem (vested tất định, không proof) + co-spend kho (C-SOLV-1)
      beacon.ak                 # post DropParam (committee, NFT-auth)
      beacon_nft.ak             # NFT authenticity beacon (one-shot theo genesis_ref)
      treasury.ak               # kho: GrantEntitlement · ReleaseForRedeem · Refill · FundPot + sổ cái solvency
      treasury_nft.ak           # NFT "TREASURY" authenticity kho (one-shot) — chống kho giả
  offchain/src/                 # TypeScript (Lucid Evolution)
    datum.ts committee.ts            # codec Data + committee threshold
    beaconBuilder.ts claimBuilder.ts redeemBuilder.ts   # tx builders (redeem tính vested)
  tests/                        # vitest (foundation + builders + integration)
```

**Gỡ bỏ so với v0.1:** `merkle.ak`, randomness logic, `lottery.ts`, `merkle.ts`, `pparam.ts`.

## Luồng

```
GÁN ENTITLEMENT ───▶ DRIP (tự mở khoá theo cửa sổ) ───▶ REDEEM (owner tự rút)
(committee gán E      vested = min(E, dpe·√E·A_span)       amount ≤ vested − redeemed,
 qua treasury)        không cần giao dịch                  treasury nhả đúng amount
```

1. **Gán entitlement** — committee mở/cấp thêm tài khoản qua `treasury` ▸ `GrantEntitlement`
   (ClaimAccount UTxO mang `E`, chỉ số khởi đầu, `redeemed=0`).
2. **Drip** — `vested` tự tăng theo chỉ số cộng dồn `A` của beacon (thuần toán), dừng ở `E`. Không ai
   phải làm gì.
3. **Redeem** — owner spend `ClaimAccount` và xin một `amount`; validator **kẹp** nó theo `vested`
   (suy từ datum + beacon làm reference input + validity range) và theo phép cắt ngọn; nhả
   `amount` LAMP; cập nhật `redeemed`. Chi tiết: `capped-drop/CONTRACT.md` v3 §4.

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

## Trạng thái triển khai

- **Preprod:** kho `treasury`, `claim_account`, `beacon` đã chạy trên cụm canonical `ACTIVE`
  (policy: `Genesis/offchain/src/lampPolicies.ts` ▸ `activeLampPolicyId("preprod")`), kèm nhánh
  `FundPot` (bằng chứng lối ra kho đầu tiên: `Genesis/treasury-exit-proof.json`, khoá Preprod).
  Trạng thái Redeem thật trên cụm này: chưa xác minh.
- **`pot-vault/`:** đã dựng, chưa triển khai trên mạng nào.
- **Mainnet:** chưa có — policy LAMP chính thức chưa phát hành (`../README.md`).

## Hooks DAO (post-MVP — chừa chỗ)

> Ở v3 `drops_per_epoch` bị **ghim bằng 1** (`capped-drop/CONTRACT.md` v3 §1b), nên hook "multi-drop"
> dưới đây chưa dùng được; hook "pause" chưa được kiểm lại theo v3 (chưa xác minh).

- **Multi-drop per-DID:** DAO tăng `drops_per_epoch` cho DID uy tín → rút nhanh hơn, vẫn cap `E`.
- **Pause/penalty:** DAO đặt `drops_per_epoch = 0` trong `N` epoch → vested đứng yên, không tịch thu.

Cả 2 không phá đơn điệu/cap (chứng minh [capped-drop/Math-Spec.md](./capped-drop/Math-Spec.md) §5).
