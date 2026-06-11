# Reserve — FEAT (hành vi + bất biến) — THUẬT TOÁN NHẢ TỰ ĐỘNG (D2)

**Trạng thái:** SPEC v2 — thuật toán nhả tự động, accounting-pot, permissionless trigger, KHÔNG ai rút tay.
**Nguồn bám:** `docs/DESIGN-fee-paymaster-reserve.md §C`; `Genesis/CONTRACT.md §2–§8`;
`Genesis/onchain/validators/tlamp_mint.ak` (nhánh `ReserveDraw`); `Distribution/SPEC-CappedDrop-MATH.md` (drip pattern tái dùng);
`Treasury/CONTRACT.md §3.4` (nguồn velocity).
**Code:** `Reserve/onchain/` (validator `reserve_meter.ak` + lib `release.ak`), `Reserve/offchain/` (P8 mirror).

---

## 0. Thay đổi so với SPEC v1 (đọc trước)

SPEC v1 để **DAO phê duyệt `approved_cumulative` bằng tay** + **Reserve Executor ký** mỗi lần rút.
SPEC v2 **xoá cả hai**:

- `approved_cumulative` không còn là con số DAO chỉnh tay → trở thành **HÀM TẤT ĐỊNH của epoch** (`release.ak`).
- KHÔNG còn `reserve_authority` ký đường ReserveDraw → **permissionless trigger** (bất kỳ ai, giống UMKeeper).
- DAO chỉ đổi được **THAM SỐ của hàm** (`ReservePolicy` beacon) qua Governance proposal — validator LUÔN ép đúng hàm.

⟹ "KHÔNG ai rút tay": không tồn tại đường nào để một người/uỷ ban quyết con số nhả. Con số nhả = `f(epoch, velocity)`.

---

## 1. Mục đích

Reserve = **quota CHƯA mint** (mặc định 5% = 1.8 tỷ LAMP; **cấu hình được tới >90%**). Là con số
(`reserve_minted`) + trần (`reserve_cap`) trong `SupplyState` — KHÔNG token chứa sẵn, KHÔNG pool vật lý.

Mục tiêu thiết kế:
- **Monetary policy giống ADA**: nhả theo hàm tất định, dự đoán được, không thao túng được.
- **Trần cứng chống lạm phát cung**: tốc độ vào lưu hành từ Reserve ≤ `g_bps`/năm (CHỐT 3%).
- **Phản ứng thị trường có cận**: velocity LAMP chỉ làm CHẬM nhả (không bao giờ vượt trần).
- **Permissionless + minh bạch**: bất kỳ ai trigger; mọi lần rút ghi `SupplyState` + `ReserveMeter`.
- **Sửa được khi sai nhịp**: đổi tham số qua Governance, KHÔNG cần "đặc cách rút".

---

## 2. Kiến trúc 2 tầng

| Tầng | Hàm | Vai trò |
|---|---|---|
| **Tầng 1** | `cap_release(epoch)` | Trần tích lũy TẤT ĐỊNH, đơn điệu, độc lập thị trường. Lãi kép rời rạc `g_bps`/năm. "Mái che cứng". |
| **Tầng 2** | `demand_allowance(epoch)` | 1 biến phản hồi (velocity LAMP) CHỈ làm CHẬM nhả trong `[floor·cap, cap]`. KHÔNG vượt cap. |

```
approved_cumulative(epoch) = min( cap_release(epoch) , demand_allowance(epoch) )
```
`demand_allowance ≤ cap_release` theo xây dựng ⟹ **trần cứng luôn thắng**.

---

## 3. Actors

| Actor | Vai trò |
|---|---|
| **Bất kỳ ai (trigger)** | Dựng tx `ReserveDraw`. KHÔNG cần quyền. δ ép bằng hàm; recipient ép = địa chỉ tất định. |
| **DAO / Governance** | Đổi **THAM SỐ** `ReservePolicy` (R0, g_bps, floor…) qua proposal Executed. KHÔNG quyết con số nhả. |
| **Treasury collect** | Cập nhật `TreasuryFlowBeacon.sma_ratio_bps` (velocity) mỗi settlement. (Tuỳ chọn — MVP bypass.) |
| **Genesis `tlamp_mint`** | Tầng mint ép `reserve_minted += δ ≤ reserve_cap`, đơn điệu, no-burn (đã có). |
| **`reserve_meter`** | Tầng GATE NHỊP: ép `reserve_minted_out ≤ approved`, `drawn ≤ max_draw`, recipient lock. |

---

## 4. Happy-path flow (permissionless)

1. Bất kỳ ai đọc `SupplyState` (`reserve_minted` hiện tại) + `ReservePolicy` beacon + (tuỳ chọn) `TreasuryFlowBeacon`.
2. Tính `current_epoch` (validity range), `approved = approved_cumulative(epoch, velocity)`, `max_draw = max_draw_per_epoch(epoch)`.
3. Chọn `δ ≤ min(approved − reserve_minted, max_draw − drawn_in_epoch)` (offchain `maxDeltaNow`).
4. Dựng tx:
   - **Inputs**: `SupplyState` (redeemer `Advance`) + `ReserveMeter` (redeemer `Draw`/`Reset`).
   - **Reference inputs**: `ReservePolicy` beacon (+ `TreasuryFlowBeacon` nếu velocity bật).
   - **Mint**: `δ` oil tLAMP, redeemer `ReserveDraw`.
   - **Outputs**: `SupplyState'` (`reserve_minted += δ`), `ReserveMeter'` (`drawn += δ`), `recipient` nhận `δ` tLAMP tại **địa chỉ tất định** (Treasury/sink).
   - **KHÔNG extra_signatories bắt buộc** (chỉ ví trả phí ký, permissionless).
5. Onchain: `reserve_meter` (C-3..C-15) + `tlamp_mint` (W-1..W-14) ép toàn bộ bất biến.

---

## 5. Edge cases (MECE)

| Tình huống | Hành vi |
|---|---|
| `epoch < genesis_release_epoch` | `cap_release = 0` → `approved = 0` → mọi `δ > 0` reject (C-10') |
| `δ` vượt `max_draw_per_epoch` | reject (C-8') — chống nhả giật |
| `reserve_minted + δ > approved_cumulative` | reject (C-10') — velocity thấp/trần cứng chặn |
| velocity bơm vô lý (sma_ratio > 100%) | clamp về 10000 → allowance = cap (KHÔNG vượt) |
| `velocity_source_policy = #""` (bypass MVP) | `demand_gate` skip → `approved = cap_release` (tầng 1 thuần) |
| Sang epoch mới, meter epoch cũ | redeemer `Reset`: `meter.epoch := current`, `drawn := δ` |
| Draw nhưng meter epoch ≠ current | reject (C-4/C-5) |
| `reserve_minted = reserve_cap` (quota cạn) | mọi `δ > 0` reject (tlamp_mint luật 7) |
| recipient ≠ địa chỉ tất định (ví trigger) | reject (recipient lock) — permissionless an toàn |
| Double-meter (2 ReserveMeter input) | reject (C-3, thread NFT 1-in/1-out) |
| Beacon `ReservePolicy` giả | reject (C-11, authenticity NFT) |
| `growth_bps` ngoài `[300,500]` trong policy | reject — chống DAO đột ngột mở Reserve qua tham số |

---

## 6. Bất biến (Invariants)

| ID | Phát biểu | Nguồn code |
|---|---|---|
| **R-I1** | `reserve_minted ≤ reserve_cap` (mọi lúc) | `tlamp_mint.ak` luật 7 |
| **R-I2** | `reserve_minted` đơn điệu không giảm | `tlamp_mint.ak` luật 6 |
| **R-I3** | `reserve_cap` bất biến qua mọi transition | `tlamp_mint.ak` luật 4 + D7-#1 |
| **R-I4** | `dist_minted + reserve_minted ≤ total_cap_oil = 36e15` | `tlamp_mint.ak` D7-#2 |
| **R-I5 (mới)** | `reserve_minted ≤ approved_cumulative(epoch)` sau mọi draw | `reserve_meter.ak` C-10' |
| **R-I6 (mới)** | `approved_cumulative(epoch) ≤ cap_release(epoch) ≤ reserve_cap` (bounded B1) | `release.ak` (min + cap tuyệt đối) |
| **R-I7 (mới)** | `cap_release` đơn điệu không giảm theo epoch (B2) | `release.ak` |
| **R-I8 (mới)** | `drawn_in_epoch ≤ max_draw_per_epoch(epoch)` trong epoch (B3, chống giật) | `reserve_meter.ak` C-8' |
| **R-I9** | SupplyState/Meter thread NFT không rời script, không burn | `tlamp_mint.ak` luật 1 + `reserve_meter.ak` C-3 |
| **R-I10 (mới)** | δ tLAMP tới đúng `recipient_lock` (Treasury/sink), KHÔNG ví trigger | `reserve_meter.ak` recipient_gets_delta |
| **R-I11 (mới)** | `g_bps ∈ [300,500]`, `epochs_per_year > 0`, `reserve_release_base > 0` | `reserve_meter.ak` (policy bound check) |

---

## 7. Chống thao túng (tầng phản hồi không mở cửa rộng hơn trần)

Mối nguy: kẻ tấn công bơm velocity giả (tự thu phí qua app → đẩy LAMP vào Treasury) ép Reserve nhả nhiều.

5 lớp chặn:
1. **Trần cứng thắng tuyệt đối**: dù velocity bơm tới vô hạn, `approved ≤ cap_release`. Bơm KHÔNG bao giờ vượt `g_bps`/năm.
2. **SMA dài (lag)**: `sma_ratio_bps` trung bình `K` epoch (đề xuất 12). Bơm 1–2 epoch bị pha loãng.
3. **Clamp tốc độ**: `drawn` mỗi epoch ≤ `max_draw_per_epoch` (đạo hàm cap_release). Velocity chỉ quyết "có mở tới max hay không".
4. **Bơm tốn LAMP thật**: phí thu = LAMP rời ví kẻ bơm vào custody. Bất lợi kinh tế thuần.
5. **Velocity là cận TRÊN, không phải mục tiêu**: `demand_allowance = cap · clamp(sma, floor, 10000)/10000`, clamp trên = cap.

---

## 8. Tham số khởi điểm nhỏ giọt (cấu hình qua ReservePolicy)

| Tham số | Khởi điểm testnet | Đổi thế nào |
|---|---|---|
| `reserve_release_base` (R0) | 2 triệu LAMP/năm 0 = `2_000_000_000_000` oil (CHỐT council) | Governance proposal (đơn điệu: chỉ tăng) |
| `annual_growth_bps` (g) | `300` (3%/năm — CHỐT council) | proposal, clamp `[300,500]` on-chain (chỉ tăng) |
| `epochs_per_year` | `73` | hằng mạng |
| `demand_floor_bps` | `2000` (20%) | proposal |
| `velocity_window` (K) | `12` epoch | proposal |
| `velocity_source_policy` | `#""` (bypass MVP) | đặt policy id khi Treasury flow beacon live |
| `genesis_release_epoch` | epoch_deploy + buffer | proposal (chỉ lùi để hoãn) |

---

## 9. Tác động khi Reserve > 90% (Distribution co lại)

Đổi 2 hằng trong `Reserve/onchain/lib/magiclamp/reserve/constants.ak` (tổng vẫn = 36 tỷ):
```
dist_cap_oil    =  3_600_000_000_000_000   // 10%
reserve_cap_oil = 32_400_000_000_000_000   // 90%
```
Tác động (cần anh chốt con số cuối):
1. **Distribution co tương ứng**: Σ entitlement các ClaimAccount ≤ `dist_cap` mới. Cần rà `Foundation-Bootstrap §7.1` → **báo anh trước khi sửa doc canonical**.
2. **Reserve thành đường phát hành CHÍNH**: 90% cung đi qua `cap_release(epoch)` → hàm nhả = monetary policy thực của LAMP. R0 + g_bps quyết toàn bộ tốc độ → đặt R0 nhỏ giọt thật, g_bps ≤ 5%.
3. **Cạn-cap dài hơn**: với `reserve_cap = 32.4e15`, R0=2tr, g=3% → ~328 năm tới cap (test `yearsToCap`).
4. **Bất biến giữ nguyên**: R-I1..R-I11 không đổi phát biểu, chỉ đổi giá trị `reserve_cap`.

---

## 10. Out-of-scope

- Cách DAO biểu quyết: `Governance/` — Reserve chỉ đọc `ReservePolicy` Executed.
- Oracle giá LAMP↔USD: không cần (LAMP-only; velocity đo on-chain).
- Phân phối tLAMP sau khi tới recipient: tuỳ DAO (vào Treasury / grant).
- Capped Drop / DistributionVest: quota Distribution — mô-đun riêng.
- `TreasuryFlowBeacon` cập nhật SMA: thuộc Treasury (Reserve chỉ đọc reference). MVP bypass.
