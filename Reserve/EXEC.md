# Reserve — EXEC (lộ trình build · test · deploy testnet thật)

**Doctype:** MagicLamp Protocol — Reserve Spec (EXEC).
**Trạng thái:** onchain + offchain code DONE, test PASS thật (aiken 36 / offchain 42). Deploy Preview = outline + harness.
**Bám:** [`FEAT.md`](./FEAT.md), [`MATH.md`](./MATH.md), [`TECH.md`](./TECH.md). EXEC KHÔNG định nghĩa lại datum/bất biến — chỉ **thứ tự build/test/deploy + DoD + rủi ro**.

Mục tiêu cuối: **làm LAMP có giá trị** — Reserve = monetary policy tất định, không thao túng, cho mọi Cardano team kiểm chứng on-chain.

---

## 0. Trạng thái thật hiện tại (bằng chứng)

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| `release.ak` (hàm nhả) | DONE | 18/18 aiken test pass (TV-AR01..AR05 + bounded) |
| `reserve_meter.ak` (validator) | DONE | 13/13 aiken test pass (Draw/Reset + 10 negative) |
| `constants.ak` / `util.ak` | DONE | 3 + 2 test pass |
| `plutus.json` | DONE | `aiken build` exit 0, validator `reserve_meter.spend` |
| offchain `release.ts`/`reserveMeter.ts`/`datum.ts` | DONE | 42/42 vitest pass (P8 vectors khớp aiken) |
| `reserveDrawBuilder.ts` (permissionless) | DONE | src typecheck clean (lucid) |
| Deploy Preview | OUTLINE | harness 01..04 bên dưới |
| Genesis authority gate đổi permissionless | PENDING — cần anh duyệt | chạm canonical Genesis (xem §5) |

Chạy lại bằng chứng:
```bash
cd Reserve/onchain && aiken check > full.log 2>&1; grep Summary full.log     # 36 checks, 0 errors
cd Reserve/offchain && npm install && npm test                               # 42 passed
```

---

## 1. Build order (phụ thuộc tuyến tính)

```
M0  aiken build → plutus.json (reserve_meter)                       [DONE]
M1  Genesis deploy: SUPPLY thread NFT + tlamp_mint + supply_state   [Genesis branch — dependency]
M2  mint ReserveMeter thread NFT (one-shot) → meter_nft_policy
M3  mint ReservePolicy authenticity NFT → reserve_policy_nft_policy
M4  apply-param reserve_meter(
       tlamp_policy, supply_nft_policy, supply_name,
       meter_nft_policy, meter_name, reserve_policy_nft_policy,
       recipient_lock = hash(Treasury/sink addr), ms_per_epoch)
M5  deploy ReservePolicy beacon UTxO (datum = tham số khởi điểm §3)
M6  deploy ReserveMeter UTxO (datum = { epoch: e0, drawn_in_epoch: 0 })
M7  (tuỳ chọn) deploy TreasuryFlowBeacon — nếu bật velocity. MVP bỏ qua (#"" bypass).
```

---

## 2. Test strategy

| Lớp | Lệnh | Kỳ vọng |
|---|---|---|
| Unit Aiken (math + validator) | `cd Reserve/onchain && aiken check` | 36 checks, 0 errors |
| P8 mirror (TS = aiken bit-identical) | `cd Reserve/offchain && npm test` | 42 passed |
| Property bounded | có trong test (`approved_never_exceeds_cap`, `demand_pump_cannot_exceed_cap`) | reject vượt cap |
| e2e Preview | harness 01..04 (§4) | draw on-chain, verify reserve_minted += δ |

Lệnh capture aiken (stdout bị nuốt qua pipe):
```bash
cd Reserve/onchain && script -q /dev/null aiken check 2>&1 | grep -E 'tests \||Summary'
```

---

## 3. Tham số khởi điểm nhỏ giọt (ReservePolicy datum testnet)

```
genesis_release_epoch  = <epoch_deploy + 5>      # buffer ổn định
reserve_release_base   = 5_000_000_000_000       # 5 triệu LAMP/năm 0 (oil)
annual_growth_bps      = 400                      # 4%/năm
epochs_per_year        = 73
demand_floor_bps       = 2000                     # 20%
velocity_window        = 12
velocity_source_policy = ""                       # bypass MVP (tầng 1 thuần)
governance_ref         = <proposal NFT policy id>
```
Đổi tham số = Governance proposal Executed → cập nhật ReservePolicy beacon. R0/g_bps chỉ tăng có giới hạn (g_bps clamp [300,500] ép on-chain).

---

## 4. Harness deploy Preview (bám mẫu Distribution scripts/)

```
scripts/01_mint_meter_nft.ts       # ReserveMeter thread NFT one-shot (param genesis_ref)
scripts/02_mint_policy_nft.ts      # ReservePolicy authenticity NFT one-shot
scripts/03_apply_deploy_meter.ts   # apply-param reserve_meter + deploy Policy + Meter UTxO
scripts/04_reserve_draw.ts         # permissionless ReserveDraw: build qua reserveDrawBuilder.ts
scripts/verify_onchain.ts          # đọc SupplyState + Meter sau draw, assert reserve_minted += δ
```
`.env`: `BLOCKFROST_KEY`, `PRIVATE_KEY`, `NETWORK=Preview`, + hashes/policy ids điền sau mỗi bước.

`04_reserve_draw.ts` minh hoạ permissionless: ví BẤT KỲ (chỉ trả phí) dựng tx. δ tính `maxDeltaNow`, recipient ép = sink address.

---

## 5. Phụ thuộc Genesis (cần anh duyệt — chạm canonical, KHÔNG làm trong module này)

Genesis `tlamp_mint.ak` luật 8 nhánh `ReserveDraw` hiện đòi `reserve_authority` ký. Để permissionless THẬT:
- **Phương án khuyến nghị:** đổi gate authority nhánh ReserveDraw từ pubkey-sig → "tx phải spend ReserveMeter hợp lệ (mang meter NFT đúng)". Script-cred thay pubkey. Sửa nhỏ DUY NHẤT chạm Genesis.
- **MVP testnet (không chạm Genesis):** deploy `tlamp_mint` với `reserve_authority` = keyhash ví keeper permissionless tạm; keeper ký mọi draw. Mất tính "ai cũng trigger" nhưng giữ "không ai quyết con số nhả" (vẫn ép bằng hàm).

Ghi rõ: việc đổi Genesis cần anh duyệt vì chạm validator đã audit. Reserve module chạy độc lập tới M6 mà KHÔNG cần đổi Genesis (bypass velocity + dùng MVP authority).

---

## 6. Rủi ro + giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Velocity beacon chưa có ở Treasury | `velocity_source_policy=#""` bypass → tầng 1 thuần, không block testnet |
| DAO đặt g_bps quá cao | clamp `[300,500]` ép on-chain (C-pol) |
| Contention SupplyState (1 draw/block) | Reserve nhả không thường xuyên — chấp nhận |
| Sai nhịp tham số khởi điểm | đổi qua proposal, KHÔNG cần đặc cách rút |
| ExUnit year_cap lặp y lần | y ≤ ~150 cả đời; mỗi vòng 1 nhân-chia → rẻ, O(1) thực tế |

---

## 7. Definition of Done

- [x] `aiken check` 36/36 pass, `aiken build` plutus.json.
- [x] offchain 42/42 pass, P8 vectors khớp aiken bit-identical.
- [x] FEAT/MATH/TECH/EXEC bám code thật.
- [ ] Harness 01..04 chạy Preview (cần `.env` credential).
- [ ] Genesis authority gate permissionless (cần anh duyệt — §5).
- [ ] Reserve >90%: chốt con số cuối + reconcile Foundation-Bootstrap §7.1 (cần anh duyệt doc canonical).
