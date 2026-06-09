# Reserve — MATH (công thức + chứng minh + test vectors)

**Nguồn bám:** `Genesis/onchain/lib/magiclamp/genesis/constants.ak`;
`Genesis/onchain/validators/tlamp_mint.ak` (luật 2–8);
`Genesis/offchain/src/supplyState.ts` (`applyMint`, `reserveRemaining`).

---

## 1. Định nghĩa hình thức

### 1.1 Đơn vị

| Ký hiệu | Giá trị | Nguồn |
|---|---|---|
| `oil_per_lamp` | `1_000_000` | `constants.ak:3` |
| `dist_cap_oil` | `34_200_000_000_000_000` | `constants.ak:dist_cap_oil` |
| `reserve_cap_oil` | `1_800_000_000_000_000` | `constants.ak:reserve_cap_oil` |
| `total_cap_oil` | `36_000_000_000_000_000` | `constants.ak:total_cap_oil` |

Kiểm tra: `dist_cap_oil + reserve_cap_oil = total_cap_oil` — test `caps_sum_to_total()` trong `constants.ak`.

Tất cả số đều là `Int` (Aiken bigint) / `bigint` (TypeScript) — KHÔNG dùng `Number`.

### 1.2 Trạng thái SupplyState

```
S = { dist_minted: Int, reserve_minted: Int, dist_cap: Int, reserve_cap: Int }
  = Constr(0, [int, int, int, int])
```
Nguồn: `Genesis/onchain/lib/magiclamp/genesis/types.ak` khai báo `SupplyState`.

### 1.3 Tiền điều kiện (hợp lệ của trạng thái)

```
valid(S) ⟺
  S.dist_cap    = dist_cap_oil                    (R-I3, neo hằng — D7-#1)
  S.reserve_cap = reserve_cap_oil                 (R-I3)
  S.dist_minted    ≥ 0                            (D7-#10)
  S.reserve_minted ≥ 0                            (D7-#10)
  S.dist_minted    ≤ S.dist_cap                   (R-I1)
  S.reserve_minted ≤ S.reserve_cap                (R-I1)
```

---

## 2. Transition ReserveDraw

### 2.1 Đầu vào

- `S` : SupplyState hiện tại (đọc từ UTxO đang spend)
- `δ` : lượng tLAMP mint trong tx, đơn vị oil (`δ = tx.mint[tlamp_policy, tLAMP_name]`)

### 2.2 Điều kiện cần (guard — reject nếu sai bất kỳ)

```
(G1)  δ > 0                                      (tlamp_mint.ak luật 2)
(G2)  policy chỉ mint đúng 1 name = tLAMP        (luật 3)
(G3)  S.reserve_cap = reserve_cap_oil            (luật 4 + D7-#1)
(G4)  S.reserve_minted ≥ 0                       (D7-#10)
(G5)  S.reserve_minted + δ ≤ S.reserve_cap       (luật 7)
(G6)  S.dist_minted + S.reserve_minted + δ ≤ total_cap_oil   (D7-#2, defense-in-depth)
(G7)  reserve_authority ký đủ auth_threshold     (luật 8)
(G8)  SupplyState thread NFT: 1 input, 1 output cùng địa chỉ, qty_thread_in_mint = 0   (luật 1)
(G9)  S'.reserve_cap = S.reserve_cap             (luật 4)
(G10) S'.dist_cap    = S.dist_cap                (luật 4)
```

### 2.3 Transition function

Khi tất cả guard đạt:

```
S' = S { reserve_minted := S.reserve_minted + δ }
       (dist_minted, dist_cap, reserve_cap giữ nguyên)
```

Nguồn: `tlamp_mint.ak` luật 5 nhánh `ReserveDraw` + `supplyState.ts:applyMint`.

### 2.4 Hậu điều kiện

```
(P1)  S'.reserve_minted = S.reserve_minted + δ  (đơn điệu, monotonic)
(P2)  S'.dist_minted = S.dist_minted            (Distribution không đổi)
(P3)  S'.reserve_minted ≤ reserve_cap_oil       (R-I1)
(P4)  S'.dist_minted + S'.reserve_minted ≤ total_cap_oil   (R-I4)
```

---

## 3. Hàm kế toán Reserve

### 3.1 Quota còn lại

```
reserve_remaining(S) = S.reserve_cap − S.reserve_minted
```

Nguồn: `Genesis/offchain/src/supplyState.ts:reserveRemaining`.

### 3.2 Circulating tLAMP

```
minted_total(S) = S.dist_minted + S.reserve_minted
circulating      = minted_total(S) − Σ(Treasury + Deposits tLAMP held)
```

Nguồn: `Genesis/CONTRACT.md §6`; `Genesis/offchain/src/circulating.ts`.

### 3.3 Rate-limit (lớp gate thêm — ReserveMeter)

```
ReserveMeter = { epoch: Int, drawn_in_epoch: Int }

draw_allowed(meter, policy, delta) ⟺
  meter.epoch = current_epoch
  delta ≤ policy.max_draw_per_epoch − meter.drawn_in_epoch
  S.reserve_minted + delta ≤ policy.approved_cumulative
```

`policy = ReservePolicy { max_draw_per_epoch, approved_cumulative, governance_ref, epoch }`.

Sau tx: `meter' = { epoch: meter.epoch, drawn_in_epoch: meter.drawn_in_epoch + delta }`.

Sang epoch mới: `meter' = { epoch: new_epoch, drawn_in_epoch: delta }`.

---

## 4. Boundary conditions

| Điều kiện | Kết quả |
|---|---|
| `δ = 1` (tối thiểu) | Hợp lệ nếu `reserve_minted + 1 ≤ reserve_cap_oil` |
| `δ = reserve_cap_oil − reserve_minted` (rút toàn bộ còn lại) | Hợp lệ: `reserve_minted' = reserve_cap_oil` (biên bằng được phép, luật 7 `≤`) |
| `δ = reserve_cap_oil − reserve_minted + 1` (vượt 1 oil) | Reject: `reserve_minted' > reserve_cap_oil` |
| `reserve_minted = reserve_cap_oil` (quota cạn) | Mọi δ>0 đều reject (không còn chỗ) |
| `dist_minted = dist_cap_oil`, `reserve_minted = reserve_cap_oil` (cả 2 đầy) | Reject tổng `total_cap_oil + δ > total_cap_oil` |
| `S.reserve_minted < 0` | Reject ngay D7-#10 (guard G4) |
| `δ ≤ 0` | Reject luật 2 (G1) |

---

## 5. Test vectors (số thật verifiable)

### TV-R01 — Rút thông thường (từ trạng thái zero)

```
Input:
  S = { dist_minted: 0, reserve_minted: 0,
        dist_cap: 34_200_000_000_000_000, reserve_cap: 1_800_000_000_000_000 }
  δ = 100_000_000_000_000   // 100 triệu tLAMP (oil)

Guards đạt:
  G1: δ=100e12 > 0  ✓
  G5: 0 + 100_000_000_000_000 = 100_000_000_000_000 ≤ 1_800_000_000_000_000  ✓
  G6: 0 + 0 + 100e12 = 100e12 ≤ 36_000_000_000_000_000  ✓

Output:
  S'.reserve_minted = 100_000_000_000_000
  S'.dist_minted    = 0
  reserve_remaining = 1_800_000_000_000_000 − 100_000_000_000_000
                    = 1_700_000_000_000_000  (còn 1.7 tỷ tLAMP)
```

### TV-R02 — Rút đúng biên cap (hợp lệ)

```
Input:
  S = { dist_minted: 20_000_000_000_000_000,  // 20 tỷ dist đã mint
        reserve_minted: 1_799_999_999_999_997,  // còn đúng 3 oil
        dist_cap: 34_200_000_000_000_000, reserve_cap: 1_800_000_000_000_000 }
  δ = 3   // 3 oil = 0.000003 tLAMP

Guards đạt:
  G5: 1_799_999_999_999_997 + 3 = 1_800_000_000_000_000 ≤ 1_800_000_000_000_000  ✓  (biên =)
  G6: 20e15 + 1.8e15 = 21.8e15 ≤ 36e15  ✓

Output:
  S'.reserve_minted = 1_800_000_000_000_000  // = reserve_cap (hết quota)
  reserve_remaining = 0
```

### TV-R03 — Vượt cap (reject)

```
Input:
  S = { dist_minted: 0, reserve_minted: 1_800_000_000_000_000,
        dist_cap: 34_200_000_000_000_000, reserve_cap: 1_800_000_000_000_000 }
  δ = 1   // bất kỳ δ > 0

Guard G5 fail:
  1_800_000_000_000_000 + 1 = 1_800_000_000_000_001 > 1_800_000_000_000_000  ✗
  → tlamp_mint.ak luật 7: REJECT
```

Khớp test `mint_exceed_reserve_cap() fail` trong `tlamp_mint.ak`.

### TV-R04 — Distribution không đổi khi ReserveDraw

```
Input:
  S = { dist_minted: 5_000_000_000_000_000, reserve_minted: 500_000_000_000_000,
        dist_cap: 34_200_000_000_000_000, reserve_cap: 1_800_000_000_000_000 }
  δ = 200_000_000_000_000   // 200 triệu tLAMP

Output:
  S'.reserve_minted = 700_000_000_000_000   // = 500e12 + 200e12
  S'.dist_minted    = 5_000_000_000_000_000 // KHÔNG THAY ĐỔI (luật 5 nhánh ReserveDraw)
```

Khớp test `reservedraw_touches_dist() fail` (nếu dist thay đổi → reject).

### TV-R05 — Rate-limit ReserveMeter (lớp gate thêm)

```
Input:
  policy.max_draw_per_epoch = 180_000_000_000_000   // 180 triệu tLAMP/epoch
  policy.approved_cumulative = 500_000_000_000_000  // tổng DAO phê duyệt
  meter = { epoch: 500, drawn_in_epoch: 100_000_000_000_000 }  // đã rút 100 triệu epoch 500
  S.reserve_minted = 200_000_000_000_000
  δ = 80_000_000_000_000   // thêm 80 triệu

draw_allowed:
  drawn_after = 100e12 + 80e12 = 180e12 ≤ 180e12  ✓ (biên =)
  reserve_after = 200e12 + 80e12 = 280e12 ≤ 500e12  ✓
  → HỢP LỆ

Nếu δ = 80_000_000_000_001:
  drawn_after = 180_000_000_000_001 > 180_000_000_000_000  ✗ → REJECT rate-limit
```

### TV-R06 — Tổng cap defense-in-depth (cả 2 nhánh gần đầy)

```
Input:
  S = { dist_minted: 34_200_000_000_000_000,   // dist đầy cap
        reserve_minted: 1_799_999_999_999_999,  // reserve còn 1 oil
        dist_cap: 34_200_000_000_000_000, reserve_cap: 1_800_000_000_000_000 }
  δ = 1

G5: 1_799_999_999_999_999 + 1 = 1_800_000_000_000_000 ≤ 1_800_000_000_000_000  ✓
G6: 34_200_000_000_000_000 + 1_800_000_000_000_000 = 36_000_000_000_000_000 ≤ 36_000_000_000_000_000  ✓

Output: S'.reserve_minted = 1_800_000_000_000_000  (tổng = total_cap, biên = được phép)
```

Khớp test `total_cap_double_boundary_ok()` trong `tlamp_mint.ak`.

---

## 6. Chứng minh bất biến R-I4 (tổng cap)

**Luận điểm:** Với mọi tx `ReserveDraw` hợp lệ, nếu `valid(S)` thì `valid(S')` và
`S'.dist_minted + S'.reserve_minted ≤ total_cap_oil`.

**Chứng minh:**
1. `valid(S)` ⟹ `S.dist_minted + S.reserve_minted ≤ dist_cap_oil + reserve_cap_oil = total_cap_oil`.
2. Transition: `S'.reserve_minted = S.reserve_minted + δ`, `S'.dist_minted = S.dist_minted`.
3. Guard G5: `S.reserve_minted + δ ≤ reserve_cap_oil`.
4. Suy ra: `S'.dist_minted + S'.reserve_minted = S.dist_minted + S.reserve_minted + δ`.
5. Từ (1) và (3): `S'.dist_minted + S'.reserve_minted ≤ dist_cap_oil + reserve_cap_oil = total_cap_oil`. ∎

D7-#2 trong `tlamp_mint.ak` ép thêm guard G6 trực tiếp — defense-in-depth ngay cả khi G5 sai.

---

## 7. Không có công thức float / Q-format

Reserve là kế toán đơn giản (cộng oil nguyên). Không dùng Q-format, không nhân/chia lớn,
không rủi ro tràn (Aiken `Int` = arbitrary precision bigint, TypeScript `bigint`).
Không có oracle, không tỷ lệ phần trăm tính động — tất cả hằng số ghim cứng lúc genesis.
