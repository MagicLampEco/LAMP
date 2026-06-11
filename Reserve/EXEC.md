# Reserve — EXEC (lộ trình build · test · deploy testnet thật)

**Doctype:** MagicLamp Protocol — Reserve Spec (EXEC).
**Trạng thái:** onchain + offchain code DONE, test PASS thật (aiken 41 / offchain 46). Genesis `tlamp_mint` ReserveDraw đã nối vào reserve_meter (permissionless thật — §5, cần anh duyệt trước merge). Deploy Preview = outline + harness.
**Bám:** [`FEAT.md`](./FEAT.md), [`MATH.md`](./MATH.md), [`TECH.md`](./TECH.md). EXEC KHÔNG định nghĩa lại datum/bất biến — chỉ **thứ tự build/test/deploy + DoD + rủi ro**.

Mục tiêu cuối: **làm LAMP có giá trị** — Reserve = monetary policy tất định, không thao túng, cho mọi Cardano team kiểm chứng on-chain.

---

## 0. Trạng thái thật hiện tại (bằng chứng)

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| `release.ak` (hàm nhả) | DONE | aiken test pass (TV-AR01..AR05 + bounded) |
| `reserve_meter.ak` (validator) | DONE | aiken test pass (Draw/Reset + negative MECE) |
| `constants.ak` / `util.ak` | DONE | test pass |
| Reserve `plutus.json` | DONE | `aiken build` exit 0, validator `reserve_meter.spend`; `aiken check` = 41/41 |
| Genesis `tlamp_mint.ak` ReserveDraw → spend ReserveMeter | DONE (cần anh duyệt) | `aiken check` = 55/55, build exit 0 |
| offchain `release.ts`/`reserveMeter.ts`/`datum.ts` | DONE | 46/46 vitest pass (P8 vectors khớp aiken) |
| `reserveDrawBuilder.ts` (permissionless) | DONE | src typecheck clean (lucid) |
| Deploy Preview | OUTLINE | harness 01..04 bên dưới |
| Genesis authority gate đổi permissionless | DONE — đã sửa (chạm canonical Genesis, cần anh DUYỆT trước merge) | xem §5 |

Chạy lại bằng chứng:
```bash
cd Reserve/onchain && aiken check                  # 41/41 pass, 0 errors
cd Reserve/offchain && npm install && npm test     # 46 passed
# Genesis side (nhánh feat/genesis-lazymint):
cd Genesis/onchain && aiken check && aiken build    # 55/55 pass, build exit 0
cd Genesis/offchain && npm test                     # 34 passed
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
reserve_release_base   = 2_000_000_000_000       # 2 triệu LAMP/năm 0 (oil) — CHỐT council
annual_growth_bps      = 300                      # 3%/năm — CHỐT council
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

## 5. Phụ thuộc Genesis — ĐÃ SỬA (chạm canonical, CẦN ANH DUYỆT trước merge)

**Vấn đề gốc (council MAINNET-BLOCK #1+#2):** trước fix, `tlamp_mint.ak` luật 8 nhánh `ReserveDraw`
đòi `reserve_authority` ký. `reserve_meter` (tầng gate nhịp) là validator RỜI, KHÔNG bị Genesis
bắt buộc tham gia → người giữ `reserve_authority` mint thẳng tới `reserve_cap` trong 1 tx, BỎ QUA
toàn bộ `cap_release`/`max_draw`/`approved_cumulative`. "Nhả-thuật-toán không ai rút tay" KHÔNG
được ép on-chain.

**Đã sửa (commit chờ duyệt):** nhánh `ReserveDraw` của `tlamp_mint.ak` đổi gate từ pubkey-sig →
ÉP `tx.inputs` mang đúng 1 ReserveMeter NFT (`count_inputs_holding_nft(meter_nft_policy,
meter_nft_name) == 1`) + meter NFT KHÔNG mint/burn trong tx. Bỏ hẳn `reserve_authority` param.
Đường `DistributionVest` giữ nguyên pubkey-sig M-of-N.
- Hệ quả: MỌI ReserveDraw BẮT BUỘC spend ReserveMeter UTxO → `reserve_meter.spend` chạy →
  C-8' (δ ≤ max_draw) + C-10' (reserve_minted ≤ approved) LUÔN ép. Bypass rate-limit bị bịt.
- Permissionless thật: không chữ ký, ai dựng tx đúng lịch cũng được.
- Test thêm onchain: `reservedraw_no_meter`, `reservedraw_sig_alone_insufficient`,
  `reservedraw_two_meters`, `reservedraw_meter_minted_in_tx` (tất cả pass).

**Tham số mới `tlamp_mint`:** `(thread_nft_policy, thread_nft_name, dist_authority, auth_threshold,
meter_nft_policy, meter_nft_name)` — bỏ `reserve_authority`. Deploy script `01_deploy_lazymint.ts`
đã cập nhật thứ tự apply-param.

**KHÔNG vòng phụ thuộc apply-param** (tuyến tính): ReserveMeter NFT là one-shot độc lập (mint ở
Reserve M2, param genesis_ref riêng) → `meter_nft_policy` biết TRƯỚC khi apply-param `tlamp_mint`.
Thứ tự: (M2) mint meter NFT → meter_nft_policy; (M1/Genesis) apply `tlamp_mint(...,meter_nft_policy)`
→ tlamp_policy; (M4) apply `reserve_meter(tlamp_policy,...)`. `reserve_meter` phụ thuộc `tlamp_policy`,
`tlamp_mint` phụ thuộc `meter_nft_policy`, không cái nào phụ thuộc ngược → DAG, apply-param được.

**ĐIỀU KIỆN DEPLOY BẮT BUỘC (mainnet):** ReserveMeter UTxO khởi tạo (M6) PHẢI đặt meter NFT TẠI
địa chỉ script `reserve_meter` (KHÔNG ví thường). Lý do: `tlamp_mint` chỉ kiểm "có input mang meter
NFT", còn việc "spend input đó kích hoạt reserve_meter validator" chỉ đúng khi meter NFT ngồi ở script
reserve_meter. Bất biến này sau đó được CHÍNH reserve_meter tự giữ mãi (`m_out.address == m_in.address`,
thread 1-in/1-out) — meter NFT one-shot không rời script được. Nên chỉ cần khởi tạo đúng MỘT lần.

Việc chạm Genesis cần anh duyệt vì sửa validator đã audit (nhánh `feat/genesis-lazymint`).

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

- [x] Reserve `aiken check` 41/41 pass, `aiken build` plutus.json.
- [x] offchain 46/46 pass, P8 vectors khớp aiken bit-identical.
- [x] FEAT/MATH/TECH/EXEC bám code thật.
- [x] Genesis `tlamp_mint` ReserveDraw → spend ReserveMeter (permissionless thật). Genesis aiken 55/55 + build exit 0. **Cần anh DUYỆT trước merge** (chạm canonical — §5).
- [ ] Harness 01..04 chạy Preview (cần `.env` credential).
- [ ] Reserve >90%: chốt con số cuối + reconcile Foundation-Bootstrap §7.1 (cần anh duyệt doc canonical).
