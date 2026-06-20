# TIGER — Early TIGER Delegator pot (12.000.000 LAMP)

Phân bổ **retroactive** cho delegator sớm theo **stake tích lũy** qua mọi snapshot
TRƯỚC mốc cắt (18/6 UTC), rồi **nhỏ giọt kiểu B** (đều N epoch, có cliff) — NGANG
cộng đồng, không rút một cục. Pot "Early TIGER Deleg 12" = 0,03% của 36 tỷ LAMP.

> Mọi tiền tính bằng **oil** (1 LAMP = 10⁶ oil). BigInt tuyệt đối (C-OVERFLOW).

## Thuật toán (off-chain, tất định, bảo toàn oil)

1. **Tích lũy** `accStake[o] = Σ_snapshot stake(o)` — cộng stake qua mọi epoch < cutoff.
   - Ví stake X qua k epoch nhận k·X "stake·epoch" → **thưởng lòng trung thành theo
     thời gian** (KHÔNG token-weighted governance — đây là phân bổ pot).
   - **Loại ví self-dealing** (sáng lập/đối tác) TRƯỚC khi tính mẫu số (chống tư lợi).
   - Toàn vẹn dữ liệu: 1 owner chỉ 1 dòng/snapshot, trùng → THROW (`TIGER-002`).
2. **Tỷ lệ** `E_i = floor(budget × accStake_i / Σ accStake)`.
3. **Cap/ví** (water-filling, tùy chọn): ví chạm trần → ghim cap, phần dôi chia lại
   cho ví chưa-cap; lặp tới ổn định. Chống cá voi.
4. **Dư floor** → ví chưa-cap stake lớn nhất (tie → owner hex nhỏ nhất), tôn trọng cap.

**Bất biến:** `0 ≤ E_i ≤ cap`; `Σ E_i + leftover = budget` (cap=null ⇒ leftover=0).

## Drip kiểu B — KHÔNG cần validator mới

Kiểu B muốn `vested_B(t) = E·min(1, (t−cliff)/N)`. Đây CHÍNH là kiểu A của
`claim_account` (đã audit) với **mức mở mỗi epoch = E/N**:

```
vested_A(t) = min(E, D·r·max(0, t−t0))          (validator claim_account)
vested_B(t) = min(E, (E/N)·max(0, t−cliff))      ⇒  D·r = E/N, t0 = cliff
```

Hiện thực số nguyên: **D = 1 oil** (beacon dùng chung) + **r_i = ceil(E_i/N)** per-account.

| Bảo đảm | Cơ chế |
|---|---|
| cliff (t ≤ cliff ⇒ vested=0) | `max(0, t−start_epoch)` trong validator |
| full **đúng** N epoch | `ceil(E/N)·N ≥ E` ⇒ vested(cliff+N)=E |
| không vượt E | `min(E, ·)` |
| đơn điệu + cộng dồn + bỏ-lỡ-không-mất | kế thừa §SPEC-CappedDrop-MATH (kiểu A) |

Sai khác kiểu-B-lý-tưởng: `ceil` mở **nhanh hơn ≤ 1 đơn-vị-rate/epoch** (không bao giờ
chậm hơn, không bao giờ vượt E). Ví E_i < N oil (cực nhỏ, dưới ngưỡng thực tế) xong
sớm hơn N; ví thực (E_i ≥ N) xong đúng N.

> ⚠ **PREMISE (audit HIGH):** bit-identity chỉ đúng khi beacon `drop_value == 1`.
> Account TIGER phải tham chiếu beacon D=1; deploy genesis với `DROP_VALUE_OIL=1`.
> Demo `05_tiger_redeem.ts` ASSERT D==1 trước redeem.

## Cấu trúc

```
TIGER/offchain/src/
├── constants.ts     # budget 12M LAMP, N=36, D=1, OIL_PER_LAMP
├── types.ts         # StakeEntry, SnapshotSet, TigerEntitlement, ClaimAccountDatum
├── entitlement.ts   # accumulate + computeEntitlements (cap water-filling)
└── dripB.ts         # dripBParams, tigerDatum, vested (bit-identical on-chain), vestedIdealB
TIGER/tests/         # entitlement.test.ts + dripB.test.ts  (34 test)
```

On-chain: tái dùng `Distribution/onchain/validators/claim_account.ak` (đã audit) —
TIGER KHÔNG thêm validator. Off-chain redeem qua `Distribution` builders.

## Test

```bash
cd TIGER/offchain && npm install && npm test     # 34/34 pass
```

Preview e2e (rút thật): `Distribution/scripts/05_tiger_redeem.ts` — create account
TIGER-shaped → committee Claim E_i → redeem → verify `on-chain redeemed == off-chain vested`.

## Trạng thái audit

Kiểm toán đối nghịch (5.000 ca fuzz entitlement + 3.000 ca fuzz drip + bit-identity
với `claim_account.ak`): **SẠCH** về value-leak / cap-break / non-determinism.
Đã vá: guard owner-trùng-snapshot (`TIGER-002`), assert D=1 ở demo.
Bảo toàn `distributed + leftover == budget` đúng tuyệt đối.

## Tham số đổi được (tầng 2/3, không strand LAMP)

`budget`, `cap/ví`, `excluded`, `N` (drip epochs), `cliff` — đều là tham số vận hành,
DAO/committee đổi được. Entitlement tính lại + tạo account mới, KHÔNG đụng policy LAMP.
