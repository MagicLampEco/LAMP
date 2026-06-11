# Reserve — MATH (công thức hàm nhả + chứng minh bounded + test vectors)

**Nguồn bám:** `Reserve/onchain/lib/magiclamp/reserve/release.ak` (canonical);
`Reserve/offchain/src/release.ts` (P8 mirror); `Distribution/SPEC-CappedDrop-MATH.md` (drip pattern gốc);
`Genesis/onchain/lib/magiclamp/genesis/constants.ak` (cap hằng).

Mọi số là `Int` (Aiken bigint) / `bigint` (TS) — KHÔNG `Number`. Chia = floor-toward-zero
(input ≥ 0 → floor = trunc). Aiken `/` và BigInt `/` của JS khớp nhau trên miền này (P8).

---

## 1. Đơn vị + tham số

| Ký hiệu | Nghĩa | Khởi điểm |
|---|---|---|
| `oil_per_lamp` | `1_000_000` | hằng |
| `reserve_cap` | trần cứng tuyệt đối Reserve (oil) | `1_800_000_000_000_000` (5%); cấu hình tới `32_400_000_000_000_000` (90%) |
| `t_g` | `genesis_release_epoch` | epoch deploy + buffer |
| `R0` | `reserve_release_base` (oil, năm 0) | `2_000_000_000_000` (2 triệu LAMP) — CHỐT council |
| `g_bps` | `annual_growth_bps` (clamp [300,500]) | `300` (3%/năm) — CHỐT council |
| `E_y` | `epochs_per_year` | `73` |
| `floor_bps` | `demand_floor_bps` (sàn allowance) | `2000` (20%) |
| `bps_denom` | `10000` (= 100%) | hằng |

---

## 2. Hàm nhả `cap_release(epoch)` (tầng 1)

Gọi `e = epoch − t_g` ; `y = ⌊e / E_y⌋` ; `f = e mod E_y`.

**Trần năm (lãi kép rời rạc, floor-mỗi-bước — tránh `pow` on-chain):**
```
year_cap(0)   = R0
year_cap(k+1) = ⌊ year_cap(k) · (10000 + g_bps) / 10000 ⌋
```
Tính lặp `k` lần (mỗi năm 1 phép nhân-chia). Floor-mỗi-bước ≤ pow-rồi-chia-1-lần
⟹ an toàn về phía DƯỚI (không bao giờ nhả nhiều hơn lãi kép thật). TS lặp `y` chốt cùng cách (P8).

**Nội suy tuyến tính trong năm (drip mượt từng epoch):**
```
cap_release(epoch) =
    0                                                            nếu e < 0
    min( reserve_cap,
         year_cap(y) + ⌊ (year_cap(y+1) − year_cap(y)) · f / E_y ⌋ )   nếu e ≥ 0
```

Đây là **drip pattern Capped Drop** (`vested = min(E, D·n)`) nâng cấp: `D` tăng-kép-theo-năm,
cap tuyệt đối `E = reserve_cap`. Mọi định lý Capped Drop (đơn điệu, bounded, bỏ-lỡ-không-mất-quyền) áp dụng.

**Derivation tăng 3–5%/năm:** `year_cap(y+1)/year_cap(y) = (1 + g_bps/10000) = 1.03` khi `g_bps=300`
⟹ tổng tích lũy được phép nhả tăng đúng `g_bps/10000`/năm. Vì `reserve_minted ≤ cap_release` (gate ép),
**tốc độ tăng cung lưu hành từ Reserve ≤ g_bps/10000 /năm**.

---

## 3. `max_draw_per_epoch(epoch)` (đạo hàm rời rạc — chống nhả giật)

```
max_draw_per_epoch(epoch) = max(0, cap_release(epoch) − cap_release(epoch − 1))
```
Với nội suy tuyến tính trong năm: `≈ ⌊(year_cap(y+1) − year_cap(y)) / E_y⌋ = ⌊year_cap(y)·g_bps/10000/E_y⌋`
⟹ trần rút mỗi epoch tăng cùng nhịp `g_bps`/năm. KHÔNG hằng DAO — dẫn xuất từ `cap_release`.

---

## 4. `demand_allowance(epoch)` (tầng 2 — chỉ làm chậm)

Input duy nhất: `sma_ratio_bps ∈ [0, 10000]` = velocity LAMP đo on-chain (SMA `K` epoch) so mức tham chiếu (≤100%).
```
demand_allowance(epoch) =
    cap_release(epoch)                                          nếu velocity_present = False  (bypass MVP)
    ⌊ cap_release(epoch) · clamp(sma_ratio, floor_bps, 10000) / 10000 ⌋   nếu True
```
Velocity cao → allowance LÊN tới `cap_release` (KHÔNG vượt, clamp trên = 10000). Velocity thấp → kéo XUỐNG `floor_bps`.

```
approved_cumulative(epoch) = min( cap_release(epoch) , demand_allowance(epoch) )
```

---

## 5. Bounded proof (3 cận)

**(B1) Cận trên cứng — không bao giờ vượt reserve_cap.**
`cap_release = min(reserve_cap, …) ≤ reserve_cap`. `demand_allowance ≤ cap_release` (clamp trên = 10000 ⟹ ratio ≤ 1).
`approved = min(cap, demand) ≤ cap_release ≤ reserve_cap`. Kết hợp gate C-10' (`reserve_minted ≤ approved`) + tlamp_mint luật 7 ⟹ R-I1 + defense-in-depth 2 lớp. ∎

**(B2) Đơn điệu không giảm.** `e` tăng theo `epoch`; `year_cap(y)` tăng theo `y` (g≥0, R0>0);
số hạng nội suy `≥ 0` và liên tục tại biên năm (`f=E_y−1 → ≈ year_cap(y+1)`; `f=0` năm sau → đúng `year_cap(y+1)`).
Hợp 2 hàm không giảm + `min` hằng ⟹ `cap_release` đơn điệu không giảm ⟹ `approved` tương thích R-I2. ∎

**(B3) Cận trên mỗi epoch.** `max_draw_per_epoch ≈ ⌊year_cap(y)·g_bps/10000/E_y⌋` bị chặn (nội suy tuyến tính) ⟹ không epoch nào nhả nhảy vọt. Gate C-8' ép `drawn ≤ max_draw`. ∎

---

## 6. Test vectors (số thật — VERIFIED trong release.ak + release.ts)

Hằng chung (CHỐT council): `R0=2_000_000_000_000`, `g=300`, `E_y=73`, `reserve_cap=1_800_000_000_000_000`, `t_g=1000`.

### TV-AR01 — cap_release đầu năm 0, epoch lẻ (nội suy)
```
epoch=1036 → e=36, y=0, f=36
year_cap(0)=2_000_000_000_000 ; year_cap(1)=⌊2e12·10300/10000⌋=2_060_000_000_000
cap_release = 2e12 + ⌊60_000_000_000·36/73⌋ = 2e12 + 29_589_041_095 = 2_029_589_041_095 oil
```
✓ `tv_ar01_cap_release_interp` (aiken) + `release.test.ts`.

### TV-AR02 — max_draw_per_epoch năm 0
```
cap(1036)=2_029_589_041_095 ; cap(1035)= 2e12+⌊2_100_000_000_000/73⌋=2_028_767_123_287
max_draw = 2_029_589_041_095 − 2_028_767_123_287 = 821_917_808 oil  (≈ 822 LAMP/epoch)
```
✓ `tv_ar02_max_draw`. Chống rug: không epoch nào mint > ~822 LAMP từ Reserve năm 0.

### TV-AR03 — demand_gate kéo allowance xuống (velocity 30%)
```
cap=2_029_589_041_095 ; floor=2000 ; sma_ratio=3000
demand_allowance = ⌊cap·3000/10000⌋ = 608_876_712_328 oil
approved = min(cap, demand) = 608_876_712_328
→ ế → nhả chậm; phần chưa nhả KHÔNG mất, mở lại khi velocity hồi (M-KEEP). reserve_minted ≤ approved ≤ cap.
```
✓ `tv_ar03_demand_low` + `tv_ar03_approved_low`.

### TV-AR04 — bypass MVP (velocity_source_policy = #"")
```
velocity_present=False → demand_gate skip → approved = cap_release = 2_029_589_041_095
```
✓ `tv_ar04_bypass`. Testnet chạy ngay không cần Treasury beacon.

### TV-AR05 — chạm cap tuyệt đối (năm xa)
```
1.03^y ≥ 900 → y ≥ ln(900)/ln(1.03) ≈ 231 năm
epoch=22900 (y=300 ≫ 231) → cap_release = min(reserve_cap, year_cap(300)) = reserve_cap
→ Reserve cạn dần ~231 năm (R0=2tr, g=3%), KHÔNG bao giờ vượt 1.8 tỷ.
```
✓ `tv_ar05_hits_absolute_cap` + `yearsToCap` (TS: 150–152 năm @5%; 220–230 năm @90%).

### Negative (VERIFIED reject)
| Vector | Kỳ vọng | Test |
|---|---|---|
| velocity bơm sma_ratio=99999 | clamp 10000 → = cap (không vượt) | `demand_pump_cannot_exceed_cap` |
| `reserve_minted_out > approved` | reject | `reserve_minted_exceeds_approved` (validator) |
| `drawn > max_draw` | reject | `draw_exceeds_max_draw` |
| meter epoch cũ (Draw) | reject | `draw_stale_epoch` |
| Reset không tiến epoch | reject | `reset_not_advancing` |
| recipient sai (ví trigger) | reject | `recipient_wrong_lock` |
| `g_bps` ngoài [300,500] | reject | `policy_growth_too_high` |
| epoch < t_g, δ>0 | reject (approved=0) | `draw_before_genesis_release` |

---

## 7. Liên kết SupplyState transition (Genesis — KHÔNG sửa)

`reserve_meter` ép NHỊP; `tlamp_mint` ép TRANSITION quota:
```
S' = S { reserve_minted := S.reserve_minted + δ }   (dist_minted, caps giữ nguyên)
guard: δ>0 ; S.reserve_minted+δ ≤ reserve_cap ; caps neo hằng genesis ; monotonic
```
Hai tầng độc lập, defense-in-depth. `reserve_meter` thêm: `reserve_minted_out ≤ approved_cumulative(epoch)` (C-10') — đây là điều SPEC v1 để DAO làm tay, nay là HÀM.
