# Reserve — TECH (Aiken types · Plutus Data · validator · eUTXO flow · deploy deps)

**Code canonical:**
- `Reserve/onchain/lib/magiclamp/reserve/release.ak` — hàm `cap_release`/`max_draw`/`demand`/`approved`
- `Reserve/onchain/lib/magiclamp/reserve/types.ak` — `ReservePolicy`/`ReserveMeter`/`TreasuryFlowBeacon`/`SupplyState`
- `Reserve/onchain/lib/magiclamp/reserve/constants.ak` + `util.ak`
- `Reserve/onchain/validators/reserve_meter.ak` — GATE validator (permissionless)
- `Reserve/offchain/src/{release,types,datum,reserveMeter,reserveDrawBuilder,constants}.ts` — P8 mirror + builder

**Dependency (Genesis branch `feat/genesis-lazymint` — KHÔNG sửa ở module này):**
- `Genesis/onchain/validators/tlamp_mint.ak` (nhánh `ReserveDraw`), `supply_state.ak`, `types.ak:SupplyState/TLampMintRedeemer`.
- Reserve **mirror** `SupplyState` trong `reserve/types.ak` (cùng Constr layout) để đọc độc lập module. KHÔNG import chéo branch.

---

## 1. Aiken types (Plutus Data — Constr index = thứ tự khai báo)

```aiken
// SupplyState = Constr(0, [Int,Int,Int,Int]) — mirror Genesis, KHÔNG sửa Genesis.
pub type SupplyState { dist_minted, reserve_minted, dist_cap, reserve_cap : Int }

// ReservePolicy = Constr(0, [Int,Int,Int,Int,Int,Int,ByteArray,ByteArray]) — 8 field.
pub type ReservePolicy {
  genesis_release_epoch  : Int,   // 0
  reserve_release_base   : Int,   // 1 (R0 oil)
  annual_growth_bps      : Int,   // 2 (g, clamp [300,500])
  epochs_per_year        : Int,   // 3
  demand_floor_bps       : Int,   // 4
  velocity_window        : Int,   // 5 (K, metadata keeper)
  velocity_source_policy : ByteArray, // 6 (#"" = bypass MVP)
  governance_ref         : ByteArray, // 7 (proposal NFT đổi tham số)
}

// TreasuryFlowBeacon = Constr(0, [Int, Int]) — velocity feed (reference).
pub type TreasuryFlowBeacon { window_start_epoch, sma_ratio_bps : Int }

// ReserveMeter = Constr(0, [Int, Int]) — thread state 1/epoch.
pub type ReserveMeter { epoch, drawn_in_epoch : Int }

// Redeemer: Draw=Constr(0,[]) | Reset=Constr(1,[]).
pub type ReserveMeterRedeemer { Draw  Reset }
```

**P8:** `Reserve/offchain/src/types.ts` + `datum.ts` mirror đúng thứ tự field. THÊM field → CUỐI.

`approved_cumulative` / `max_draw_per_epoch` **KHÔNG còn là field datum** — chúng là **hàm dẫn xuất**
validator tính từ `(ReservePolicy, current_epoch, velocity)`. ⟹ không ai chỉnh con số cuối.

---

## 2. Validator `reserve_meter` (param + logic)

```aiken
validator reserve_meter(
  tlamp_policy, supply_nft_policy, supply_nft_name,
  meter_nft_policy, meter_nft_name, reserve_policy_nft_policy,
  recipient_lock,        // payment cred hash đích nhả (Treasury/sink) — KHÔNG ví trigger
  ms_per_epoch,          // derive current_epoch từ validity_range
) { spend(datum: Option<ReserveMeter>, r: ReserveMeterRedeemer, _ref, tx) { … } }
```

Bất biến ép (chung cho Draw + Reset):

| ID | Bất biến | Mục đích |
|---|---|---|
| C-3 | meter thread NFT 1-in/1-out, không mint/burn, output sạch | RS-4 chống double-meter |
| C-6 | `δ = tx.mint[tlamp_policy, tLAMP]` (đọc tx.mint thật) | A8 không lệch |
| C-9 | đọc `ReservePolicy` qua reference input | RS-1 |
| C-11 | `ReservePolicy` beacon mang authenticity NFT (`reserve_policy_nft_policy`) | RS-6 beacon giả |
| C-pol | `g_bps ∈ [300,500]`, `E_y>0`, `R0>0`, `floor ∈ [0,10000]` | chống DAO mở Reserve qua tham số |
| C-vel | velocity: `velocity_source_policy=#""` → bypass; else đọc `TreasuryFlowBeacon.sma_ratio_bps` | tầng 2 |
| C-10' | `reserve_minted_out ≤ approved_cumulative(epoch, velocity)` (đọc SupplyState output) | **THAY DAO tay** |
| C-rec | `Σ tLAMP tới Script(recipient_lock) == δ` và `Σ tLAMP toàn outputs == δ` (không rò) | R-I10 permissionless an toàn |

Nhánh `Draw` (cùng epoch): `meter_out.epoch==meter_in.epoch` (C-4), `meter_in.epoch==current` (C-5),
`drawn_out==drawn_in+δ` (C-7), `drawn_out ≤ max_draw_per_epoch(epoch)` (C-8').

Nhánh `Reset` (epoch mới): `meter_out.epoch==current` && `current>meter_in.epoch` (C-12),
`drawn_out==δ` (C-13), `δ ≤ max_draw_per_epoch(epoch)` (C-14).

**KHÔNG kiểm chữ ký** — permissionless. δ ép bằng hàm + recipient lock ⟹ người trigger không lợi gì.

---

## 3. eUTXO flow

### 3.1 Deploy (thứ tự tuyến tính)
```
1. thread_nft (SUPPLY one-shot) → supply_nft_policy           [Genesis]
2. mint meter thread NFT (one-shot) → meter_nft_policy        [Reserve]  ← PHẢI trước (3)
3. tlamp_mint apply-param (thread_nft_policy, supply_name, dist_authority,
      auth_threshold, meter_nft_policy, meter_name) → tlamp_policy        [Genesis]
4. supply_state apply-param (tlamp_policy, thread_nft_policy)  [Genesis]
5. reserve_meter apply-param (tlamp_policy, supply_nft_policy, supply_name,
      meter_nft_policy, meter_name, reserve_policy_nft_policy, recipient_lock, ms_per_epoch)
6. deploy ReservePolicy beacon (mint authenticity NFT, datum = tham số khởi điểm)
7. deploy ReserveMeter UTxO TẠI script reserve_meter (datum = { epoch: e0, drawn_in_epoch: 0 })
```
DAG apply-param (KHÔNG vòng): `tlamp_mint` ← {thread_nft, meter_nft}; `supply_state` ← tlamp_mint;
`reserve_meter` ← {tlamp_mint, …}. meter_nft là one-shot độc lập (param genesis_ref riêng) nên
biết trước (3). Chi tiết EXEC §5.

### 3.2 ReserveDraw tx (permissionless)
```
Inputs:           SupplyState (Advance) + ReserveMeter (Draw|Reset)
Reference inputs: ReservePolicy beacon  [+ TreasuryFlowBeacon nếu velocity bật]
Mint:             tlamp_policy → (tLAMP, +δ)  redeemer ReserveDraw → tlamp_mint W-1..W-14
Outputs:          SupplyState' (reserve_minted+=δ) + ReserveMeter' (drawn+=δ|=δ)
                  + recipient (δ tLAMP tại Script(recipient_lock))
Signatories:      chỉ ví trả phí (KHÔNG authority)
```

### 3.3 Double-satisfaction guard
`tlamp_mint` luật 1 ép đúng 1 SupplyState in/out (SUPPLY NFT unique). `reserve_meter` C-3 ép đúng 1 meter in/out (meter NFT unique). recipient lock ép δ không rò. → chống double-satisfaction + value-leak.

---

## 4. Đối xứng Aiken ↔ TypeScript (P8)

| Aiken | TypeScript |
|---|---|
| `release.cap_release/max_draw/demand_allowance/approved_cumulative` | `release.ts:capRelease/maxDrawPerEpoch/demandAllowance/approvedCumulative` |
| `year_cap` (lặp floor-mỗi-bước) | `release.ts:yearCap` (vòng for floor-mỗi-bước) |
| `ReservePolicy`/`ReserveMeter`/`TreasuryFlowBeacon`/`SupplyState` Constr | `datum.ts` `*ToData`/`*FromData` |
| `Draw=Constr(0,[])`/`Reset=Constr(1,[])` | `datum.ts:reserveMeterRedeemerToData` (`d87980`/`d87a80`) |
| nhánh Draw/Reset validator | `reserveMeter.ts:planDraw/applyDraw/applyReset/maxDeltaNow` |

---

## 5. eUTXO / ExUnit

- `reserve_meter` spend = O(1): datum nhỏ (2 field), `year_cap` lặp `y` lần (≤ ~150 vòng cả đời, mỗi vòng 1 nhân-chia). `cap_release` gọi 2 lần (epoch, epoch−1) cho max_draw → ~4·y phép. ExUnit ổn định, không phụ thuộc batch.
- Velocity đọc 1 reference input — không oracle, không vòng lặp trên list lớn.
- Contention: SupplyState + ReserveMeter là UTxO đơn → 1 ReserveDraw/block (tuần tự). Chấp nhận được (Reserve nhả không thường xuyên).

---

## 6. Attack surface (mapping bất biến)

| Mã | Tấn công | Bất biến chặn |
|---|---|---|
| RS-1 | Mint không qua hàm/policy | C-9, C-10' (approved từ hàm tất định) |
| RS-2 | Rug 1.8 tỷ 1 tx | C-8' (max_draw_per_epoch) |
| RS-3 | Nới reserve_cap | W-3/W-7 Genesis (neo hằng) |
| RS-4 | Double-meter | C-3 |
| RS-5 | Meter epoch cũ | C-4, C-5 |
| RS-6 | Beacon ReservePolicy giả | C-11 |
| RS-7 | DAO mở Reserve qua tham số bịa | C-pol (g_bps∈[300,500], R0>0) |
| RS-8 | Velocity bơm vượt trần | B1 + clamp 10000 (demand ≤ cap) |
| RS-9 | δ tới ví trigger (permissionless lạm dụng) | C-rec (recipient lock) |
| RS-10 | δ rò ra output khác | C-rec (Σ tLAMP == δ) |

---

## 7. Files

| File | Vai trò | Trạng thái |
|---|---|---|
| `onchain/aiken.toml` | plutus v3, stdlib v3.1.0 | mới |
| `onchain/lib/.../constants.ak` | cap + tham số khởi điểm | mới |
| `onchain/lib/.../release.ak` | hàm nhả (18 test) | mới |
| `onchain/lib/.../types.ak` | 5 type | mới |
| `onchain/lib/.../util.ak` | helpers + get_epoch (2 test) | mới |
| `onchain/validators/reserve_meter.ak` | GATE validator | mới (aiken 41/41 toàn module) |
| `offchain/src/*.ts` | P8 mirror + builder | mới |
| `tests/*.test.ts` | release/reserveMeter/datum/recipientLock (46 test) | mới |

**KHÔNG sửa (Genesis branch):** `supply_state.ak`, Genesis `types.ak`/`constants.ak`.

**ĐÃ sửa Genesis (cần anh DUYỆT trước merge — chạm canonical):** `tlamp_mint.ak` luật 8 nhánh ReserveDraw
đổi gate từ pubkey-sig (`reserve_authority`) → ÉP tx spend đúng 1 ReserveMeter NFT + meter NFT không
mint/burn. Bỏ param `reserve_authority`; thêm param `meter_nft_policy`/`meter_nft_name`. Đường
DistributionVest giữ nguyên pubkey-sig. ⟹ mọi ReserveDraw BẮT BUỘC đi qua `reserve_meter` → C-8'/C-10'
luôn ép, rate-limit không bypass được, permissionless thật. Genesis aiken 55/55 + build exit 0; deploy
script `01_deploy_lazymint.ts` đã đồng bộ thứ tự apply-param. Điều kiện deploy: ReserveMeter NFT khởi tạo
TẠI script reserve_meter (xem EXEC §5). Chi tiết + lý do không-vòng apply-param: EXEC.md §5.
