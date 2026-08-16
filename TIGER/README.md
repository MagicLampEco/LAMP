# TIGER — Early TIGER Delegator pot (12.000.000 LAMP)

Phân bổ **retroactive** cho delegator sớm theo **stake tích lũy** qua mọi snapshot
TRƯỚC mốc cắt (18/6 UTC), rồi **nhỏ giọt kiểu B** (đều N epoch, có cliff) — NGANG
cộng đồng, không rút một cục. Pot "Early TIGER Deleg 12" = 0,03% của 36 tỷ LAMP.

> Mọi tiền tính bằng **oildrop** (1 LAMP = 10⁶ oildrop). BigInt tuyệt đối (C-OVERFLOW).

## Thuật toán (off-chain, tất định, bảo toàn oildrop)

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

Hiện thực số nguyên: **D = 1 oildrop** (beacon dùng chung) + **r_i = ceil(E_i/N)** per-account.

| Bảo đảm | Cơ chế |
|---|---|
| cliff (t ≤ cliff ⇒ vested=0) | `max(0, t−start_epoch)` trong validator |
| full **đúng** N epoch | `ceil(E/N)·N ≥ E` ⇒ vested(cliff+N)=E |
| không vượt E | `min(E, ·)` |
| đơn điệu + cộng dồn + bỏ-lỡ-không-mất | kế thừa §SPEC-CappedDrop-MATH (kiểu A) |

Sai khác kiểu-B-lý-tưởng: `ceil` mở **nhanh hơn ≤ 1 đơn-vị-rate/epoch** (không bao giờ
chậm hơn, không bao giờ vượt E). Ví E_i < N oildrop (cực nhỏ, dưới ngưỡng thực tế) xong
sớm hơn N; ví thực (E_i ≥ N) xong đúng N.

> ⚠ **PREMISE (audit HIGH):** bit-identity chỉ đúng khi beacon `drop_value == 1`.
> Account TIGER phải tham chiếu beacon D=1; deploy genesis với `DROP_VALUE_OILDROP=1`.
> Demo `05_tiger_redeem.ts` ASSERT D==1 trước redeem.

## Cấu trúc

```
TIGER/offchain/src/
├── constants.ts     # budget 12M LAMP, N=36, D=1, OILDROP_PER_LAMP, CUTOFF_EPOCH
├── types.ts         # StakeEntry, SnapshotSet, TigerEntitlement, ClaimAccountDatum
├── entitlement.ts   # accumulate + computeEntitlements (cap water-filling)
├── dripB.ts         # dripBParams, tigerDatum, vested (bit-identical on-chain), vestedIdealB
└── snapshot.ts      # LÕI THUẦN dựng SnapshotSet từ rows Blockfrost (test-được, không I/O)
TIGER/scripts/
├── config.ts               # Blockfrost helpers (bf/bfAll/currentEpoch) — chỉ đọc chain
└── build_tiger_snapshot.ts # CLI fetch /epochs/{E}/stakes → SnapshotSet JSON (chạy tsx)
TIGER/tests/         # entitlement + dripB + snapshot  (41 test)
```

On-chain: tái dùng `Distribution/onchain/validators/claim_account.ak` (đã audit) —
TIGER KHÔNG thêm validator. Off-chain redeem qua `Distribution` builders.

## Dựng snapshot THẬT (thay mock trong 05)

```bash
cd TIGER/offchain && npm install
npx tsx ../scripts/build_tiger_snapshot.ts \
  --pool <pool_id> --from <A> --to <B> --cutoff <CUTOFF> \
  [--registry reg.json] [--exclude <sa|pkh> ...] --out tiger_snapshot.json
```

Đầu ra `SnapshotSet` (JSON-safe) → `parseSnapshotFile()` → `computeEntitlements()`.
`--registry` map `stake_address → payment_pkh` để owner khớp `claim_account.owner`.

## Test

```bash
cd TIGER/offchain && npm install && npm test     # 47/47 pass (đo 2026-08-16)
# check 6 · entitlement 15 · dripB 19 · snapshot 7
```

Preview e2e (rút thật): `Distribution/scripts/05_tiger_redeem.ts` — create account
TIGER-shaped → committee Claim E_i → redeem → verify `on-chain redeemed == off-chain vested`.
(Hiện `05` dùng snapshot MOCK; thay bằng `tiger_snapshot.json` ở deploy thật — xem "Còn thiếu".)

## Còn thiếu để deploy THẬT (không phải bug — là quyết định + wiring)

1. **owner resolution — ĐÃ CHỐT CÁCH LÀM (2026-07-30).** `claim_account.owner` = payment pkh ký
   redeem, nhưng chain chỉ cho `stake_address`, và 1 stake ↔ nhiều payment nên **không suy ra được**.
   Bằng chứng ràng buộc: `Distribution/onchain/lib/magiclamp/lampdist/util.ak:102-114` ép
   `lamp_to_owner(...) >= amount`, lọc output bằng `is_owned_by(o.address, owner)`; `util.ak:158`
   dựng địa chỉ `VerificationKey(pkh)`. ⇒ cần **bảng đăng-ký** (`--registry`) map
   stake_address → payment pkh, dùng lại cơ chế `delegator_register.ts`.

   **Đọc cho đúng:** đây là bước **ràng buộc nơi trả**, KHÔNG phải điều kiện để đủ tư cách. Tư cách
   ETD hồi tố tuyệt đối — bước ký diễn ra SAU cutoff nên không thể làm ai trở nên đủ điều kiện.
   Câu cũ ở đây ("ETD thật COUPLE với registration") đọc như trái với "ETD không đăng ký" ở
   `Airdrop/CONTRACT.md §3`; hai câu nói về hai tầng khác nhau, nay đã ghi rõ ở cả hai chỗ.

   Đã bác phương án `owner` = stake key hash: về mật mã chạy được, nhưng ví chuẩn dẫn xuất payment
   key ở `1852'/1815'/0'/0/i` và stake key ở `…/2/0`, nên Lace/Eternl không hiện và không tiêu được
   địa chỉ enterprise dựng từ stake key hash — tiền về đó là tiền kẹt.
2. **Tham số:** `CUTOFF_EPOCH` **đã chốt = 637** (dẫn giải trong `offchain/src/constants.ts`).
   `TIGER_POOL_ID` vẫn phải xác nhận trước deploy thật.
3. **Seed nhiều account.** `05` mới seed 1 account demo; deploy thật lặp seed ClaimAccount
   cho MỌI owner trong snapshot + committee cấp entitlement từng người (batch).

## Trạng thái audit

Kiểm toán đối nghịch (5.000 ca fuzz entitlement + 3.000 ca fuzz drip + bit-identity
với `claim_account.ak`): **SẠCH** về value-leak / cap-break / non-determinism.
Đã vá: guard owner-trùng-snapshot (`TIGER-002`), assert D=1 ở demo.
Bảo toàn `distributed + leftover == budget` đúng tuyệt đối.

## Tham số đổi được (tầng 2/3, không strand LAMP)

`budget`, `cap/ví`, `excluded`, `N` (drip epochs), `cliff` — đều là tham số vận hành,
DAO/committee đổi được. Entitlement tính lại + tạo account mới, KHÔNG đụng policy LAMP.
