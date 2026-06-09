# Reserve — TECH (Aiken types · Plutus Data · validator logic · eUTXO flow · deploy deps)

**Nguồn bám:**
- `Genesis/onchain/validators/tlamp_mint.ak` — validator tầng 2 (cổng mint tLAMP)
- `Genesis/onchain/validators/supply_state.ak` — validator tầng 3 (giữ SupplyState UTxO)
- `Genesis/onchain/lib/magiclamp/genesis/types.ak` — Aiken types + Plutus Data encoding
- `Genesis/onchain/lib/magiclamp/genesis/constants.ak` — hằng số oil
- `Genesis/onchain/lib/magiclamp/genesis/util.ak` — helpers (count, sigs, value_only)
- `Genesis/offchain/src/types.ts` — TypeScript mirror (byte-perfect Constr index)
- `Genesis/offchain/src/mintBuilder.ts` — tx builder (`buildMintTx`)
- `Genesis/offchain/src/supplyState.ts` — offchain math (`applyMint`, invariants)
- `docs/DESIGN-fee-paymaster-reserve.md §C` — schema `ReservePolicy` / `ReserveMeter`

---

## 1. Aiken types (Genesis đã có — Reserve dùng lại)

### 1.1 SupplyState (đã có, không thêm field)

```aiken
// Genesis/onchain/lib/magiclamp/genesis/types.ak
pub type SupplyState {
  dist_minted    : Int,   // Constr(0,[int,int,int,int]) field 0
  reserve_minted : Int,   //   field 1
  dist_cap       : Int,   //   field 2
  reserve_cap    : Int,   //   field 3
}
```

Plutus Data encoding: `Constr(0, [dist_minted, reserve_minted, dist_cap, reserve_cap])`.
TypeScript mirror: `Genesis/offchain/src/types.ts:SupplyState` (thứ tự field = thứ tự Constr).

### 1.2 TLampMintRedeemer (đã có)

```aiken
// Genesis/onchain/lib/magiclamp/genesis/types.ak
pub type TLampMintRedeemer {
  DistributionVest   // Constr(0, [])
  ReserveDraw        // Constr(1, [])
}
```

`ReserveDraw = Constr(1, [])`. TypeScript: `MintRoute = "DistributionVest" | "ReserveDraw"`.

### 1.3 Types mới cho gate layer (Reserve-specific)

```aiken
// Genesis/onchain/lib/magiclamp/genesis/reserve_types.ak  [FILE MỚI]

/// ReservePolicy beacon — tham số DAO phê duyệt.
/// = Constr(0, [Int, Int, ByteArray, Int])
pub type ReservePolicy {
  max_draw_per_epoch   : Int,       // field 0: trần oil/epoch
  approved_cumulative  : Int,       // field 1: tổng reserve_minted DAO phê duyệt (≤ reserve_cap)
  governance_ref       : ByteArray, // field 2: policy id Proposal NFT đã Executed (bytes)
  epoch                : Int,       // field 3: epoch DAO phê duyệt lần này
}

/// ReserveMeter — thread state 1/epoch (reset sang epoch mới).
/// = Constr(0, [Int, Int])
pub type ReserveMeter {
  epoch           : Int,   // field 0: epoch hiện tại meter
  drawn_in_epoch  : Int,   // field 1: tổng oil đã rút trong epoch này
}

/// Redeemer reserve_meter spend.
pub type ReserveMeterRedeemer {
  Draw   // Constr(0, [])  — rút trong epoch
  Reset  // Constr(1, [])  — reset sang epoch mới
}
```

Plutus Data:
- `ReservePolicy = Constr(0, [int, int, bytes, int])`
- `ReserveMeter  = Constr(0, [int, int])`
- `ReserveMeterRedeemer.Draw  = Constr(0, [])`
- `ReserveMeterRedeemer.Reset = Constr(1, [])`

**P8 (bit-identical):** TypeScript mirror phải khai báo đúng thứ tự field trên.

---

## 2. Validator logic per redeemer

### 2.1 `tlamp_mint` — nhánh `ReserveDraw` (đã có trong Genesis)

File: `Genesis/onchain/validators/tlamp_mint.ak`.

Bất biến ép khi redeemer = `ReserveDraw`:

| ID | Bất biến | Dòng logic trong tlamp_mint.ak |
|---|---|---|
| W-1 | Consume + recreate SupplyState (thread NFT 1-in/1-out, qty_thread_in_mint = 0) | Luật 1 (`count_inputs_holding_nft`, `count_holding_nft`, `assets.quantity_of(tx.mint, thread_nft_policy, ...) == 0`) |
| W-2 | `s_out.address == s_in.address` (thread không rời script) | Ngay sau `output_holding_nft` |
| W-3 | Caps neo hằng genesis: `s.dist_cap == constants.dist_cap_oil`, `s.reserve_cap == constants.reserve_cap_oil` | D7-#1 |
| W-4 | Counter input không âm: `s.dist_minted >= 0`, `s.reserve_minted >= 0` | D7-#10 |
| W-5 | `delta > 0` (không burn, không no-op) | Luật 2 |
| W-6 | `policy_name_count(tx.mint, policy_id) == 1` (đúng 1 name = tLAMP) | Luật 3 |
| W-7 | `s2.dist_cap == s.dist_cap`, `s2.reserve_cap == s.reserve_cap` | Luật 4 |
| W-8 | `s2.reserve_minted == s.reserve_minted + delta`, `s2.dist_minted == s.dist_minted` | Luật 5 nhánh ReserveDraw |
| W-9 | `s2.reserve_minted >= s.reserve_minted`, `s2.dist_minted >= s.dist_minted` | Luật 6 (monotonic) |
| W-10 | `s2.reserve_minted <= s2.reserve_cap` | Luật 7 |
| W-11 | `s2.dist_minted + s2.reserve_minted <= constants.total_cap_oil` | D7-#2 (defense-in-depth) |
| W-12 | `assets.quantity_of(s_out.value, policy_id, tLAMP_name) == 0` (output SupplyState sạch tLAMP) | D3-#1 |
| W-13 | `s_out.reference_script == None` | D3-#3 |
| W-14 | `value_only_nft_and_ada(s_out.value, thread_nft_policy)` (không token rác bám state) | D3 |
| W-15 | `count_sigs(reserve_authority, tx.extra_signatories) >= auth_threshold` | Luật 8 |
| W-16 | `auth_threshold >= 1`, `auth_threshold <= list.length(list.unique(reserve_authority))` | D2-#1/#2 |

### 2.2 `supply_state` spend — ủy quyền (đã có)

File: `Genesis/onchain/validators/supply_state.ak`.

| ID | Bất biến |
|---|---|
| C-1 | UTxO bị spend mang đúng thread NFT qty==1 (`D8-#3`) |
| C-2 | `delta = minted_qty(tx.mint, tlamp_policy, tLAMP_name) > 0` (ủy quyền cho tlamp_mint) |

### 2.3 `reserve_meter` spend — validator mới (lớp gate)

File mới: `Genesis/onchain/validators/reserve_meter.ak`.

Bất biến khi redeemer = `Draw`:

| ID | Bất biến | Mục đích |
|---|---|---|
| C-3 | Meter input và output trong cùng tx (thread NFT 1-in/1-out) | RS-4 chống double-meter |
| C-4 | `meter_out.epoch == meter_in.epoch` (không tự thay epoch khi Draw) | RS-5 chống dùng meter cũ |
| C-5 | `meter_in.epoch == current_epoch` (chỉ meter đúng epoch hiện tại) | RS-5 |
| C-6 | `delta = tx.mint[tlamp_policy, tLAMP_name]` (đọc tx.mint thật, không tin redeemer) | Tránh khai delta giả |
| C-7 | `meter_out.drawn_in_epoch == meter_in.drawn_in_epoch + delta` | Ghi đúng |
| C-8 | `meter_out.drawn_in_epoch <= policy.max_draw_per_epoch` | RS-2 rate-limit |
| C-9 | Đọc `ReservePolicy` qua reference input (beacon DAO): `policy.approved_cumulative` | RS-1 chống mint không qua DAO |
| C-10 | `reserve_minted_out <= policy.approved_cumulative` (đọc SupplyState output trong cùng tx) | RS-1 |
| C-11 | `policy` beacon có authenticity NFT (policy id DAO) | RS-6 chống beacon giả |

Bất biến khi redeemer = `Reset` (sang epoch mới):

| ID | Bất biến |
|---|---|
| C-12 | `meter_out.epoch = current_epoch > meter_in.epoch` |
| C-13 | `meter_out.drawn_in_epoch = delta` (bắt đầu từ 0 + delta lần đầu) |
| C-14 | `delta ≤ policy.max_draw_per_epoch` |
| C-15 | C-9, C-10, C-11 giống nhánh Draw |

---

## 3. eUTXO flow

### 3.1 Deploy (1 lần, theo thứ tự tuyến tính)

```
[genesis_ref UTxO]
    │  (1) tx thread_nft: spend genesis_ref, mint (SUPPLY,+1)
    ▼
[SupplyState UTxO tại supply_state_script]
    │  datum = { dist_minted:0, reserve_minted:0, dist_cap:34.2e15, reserve_cap:1.8e15 }
    │  value = 2 tADA + 1 SUPPLY NFT
    │
    │  (2) tx deploy ReservePolicy beacon (DAO): mint authenticity NFT + set datum
    ▼
[ReservePolicy UTxO] (reference input — không spend khi draw thông thường)
    │
    │  (3) tx deploy ReserveMeter: mint meter thread NFT, datum = { epoch: e0, drawn_in_epoch: 0 }
    ▼
[ReserveMeter UTxO]
```

Phụ thuộc deploy:
1. `thread_nft` phải deploy trước → cho ra `thread_nft_policy`.
2. `tlamp_mint` tham số hóa bằng `(thread_nft_policy, supply_name, dist_authority, reserve_authority, auth_threshold)`.
3. `supply_state` tham số hóa bằng `(tlamp_policy, thread_nft_policy)`.
4. `reserve_meter` tham số hóa bằng `(tlamp_policy, reserve_policy_nft_policy, reserve_meter_nft_policy)`.

### 3.2 ReserveDraw tx (sau khi DAO đã phê duyệt)

```
Inputs:
  [SupplyState UTxO]   redeemer: Advance    → supply_state.ak (C-1, C-2)
  [ReserveMeter UTxO]  redeemer: Draw|Reset → reserve_meter.ak (C-3..C-15)

Reference Inputs:
  [ReservePolicy UTxO]  (DAO beacon, không bị spend)

Mint:
  tlamp_policy → (tLAMP, +delta)  redeemer: ReserveDraw
    → tlamp_mint.ak (W-1..W-16)

Outputs:
  [SupplyState' UTxO]   addr=supply_state_script, value=2tADA+SUPPLY NFT,
                        datum={ ..., reserve_minted: old+delta }
  [ReserveMeter' UTxO]  addr=reserve_meter_script, value=2tADA+meter NFT,
                        datum={ epoch: e, drawn_in_epoch: old_drawn+delta }
  [recipient UTxO]      addr=DAO/Treasury, value=delta tLAMP (+ lovelace)

Extra signatories:
  reserve_authority keys (≥ auth_threshold)
```

### 3.3 Double-satisfaction guard

`tlamp_mint.ak` luật 1 ép đúng 1 SupplyState input và 1 output (qua SUPPLY NFT unique).
`reserve_meter.ak` C-3 ép đúng 1 meter input/output (qua meter thread NFT unique).
→ Không thể có 2 UTxO đi qua cùng lần; chống double-satisfaction.

---

## 4. Đối xứng Aiken ↔ TypeScript (P8)

| Aiken | TypeScript | Ghi chú |
|---|---|---|
| `SupplyState` Constr(0,[...]) | `SupplyState` interface (`types.ts`) | 4 field đúng thứ tự |
| `TLampMintRedeemer.ReserveDraw` Constr(1,[]) | `MintRoute = "ReserveDraw"` → `mintRouteToCbor` | `datum.ts` |
| `SupplyStateRedeemer.Advance` Constr(0,[]) | `supplyStateRedeemerToCbor()` | `datum.ts` |
| `applyMint(s, "ReserveDraw", δ)` | Mirror luật 5 nhánh ReserveDraw | `supplyState.ts:applyMint` |
| `assertInvariants(s)` | Mirror luật 6+7 | `supplyState.ts:assertInvariants` |
| `ReservePolicy` Constr(0,[int,int,bytes,int]) | `ReservePolicy` interface [mới] | `reserve_types.ts` [mới] |
| `ReserveMeter` Constr(0,[int,int]) | `ReserveMeter` interface [mới] | `reserve_types.ts` [mới] |

Quy tắc: **thêm field → thêm đúng vị trí cuối cùng** (không reorder — Constr index = thứ tự khai báo).

---

## 5. Files cần tạo mới (chưa có trong genesis branch)

| File | Vai trò |
|---|---|
| `Genesis/onchain/lib/magiclamp/genesis/reserve_types.ak` | `ReservePolicy`, `ReserveMeter`, `ReserveMeterRedeemer` |
| `Genesis/onchain/validators/reserve_meter.ak` | Spend validator ReserveMeter (C-3..C-15) |
| `Genesis/offchain/src/reserve_types.ts` | TypeScript mirror `ReservePolicy` + `ReserveMeter` |
| `Genesis/offchain/src/reserveMeter.ts` | Offchain math: `applyDraw`, `applyReset`, `drawAllowed` |
| `Genesis/offchain/src/reserveMintBuilder.ts` | `buildReserveDrawTx` (mở rộng `mintBuilder.ts`) |
| `Genesis/tests/reserveMeter.test.ts` | Test vectors TV-R01..TV-R06 + negative MECE |

**Files đã có — KHÔNG sửa** (Reserve tái dùng nguyên vẹn):
- `Genesis/onchain/validators/tlamp_mint.ak` — đã có nhánh `ReserveDraw` đầy đủ.
- `Genesis/onchain/validators/supply_state.ak` — đã đủ.
- `Genesis/onchain/lib/magiclamp/genesis/types.ak` — `SupplyState`, `TLampMintRedeemer` đã đủ.
- `Genesis/onchain/lib/magiclamp/genesis/constants.ak` — `reserve_cap_oil` đã đúng.
- `Genesis/offchain/src/supplyState.ts` — `applyMint` nhánh ReserveDraw đã đúng.

---

## 6. Ghi chú eUTXO / ExUnit

- `tlamp_mint.ak` chạy 1 lần duy nhất per tx (mint policy) — ExUnit trả 1 lần.
- `supply_state.ak` spend = O(1): chỉ kiểm thread NFT + `delta > 0`, không fold datum.
- `reserve_meter.ak` spend = O(1): datum nhỏ (2 field), đọc reference input policy.
- Không có vòng lặp trên list trong đường ReserveDraw — ExUnit ổn định, không phụ thuộc batch size.
- Contention: SupplyState là 1 UTxO → 1 ReserveDraw/block (tuần tự). Chấp nhận được vì
  Reserve rút không thường xuyên (không phải per-user per-second như generators).

---

## 7. Attack surface đã đóng (mapping sang bất biến)

| Mã | Tấn công | Bất biến chặn |
|---|---|---|
| RS-1 | Insider mint không qua DAO | C-9, C-10 (approved_cumulative từ Proposal Executed) |
| RS-2 | Rug 1.8 tỷ 1 tx | C-8 (max_draw_per_epoch) |
| RS-3 | Nới reserve_cap | W-3 (neo hằng genesis), W-7 (bất biến qua transition) |
| RS-4 | Double-meter (2 ReserveMeter input) | C-3 (thread NFT 1-in/1-out) |
| RS-5 | Meter epoch cũ | C-4, C-5 (epoch lock) |
| RS-6 | Beacon giả | C-11 (authenticity NFT check) |
| A1 | Mint vượt reserve_cap | W-10 |
| A4 | Rollback reserve_minted | W-9 (monotonic) |
| A5 | ReserveDraw đụng dist_minted | W-8 (quota lock) |
| A8 | Δ datum ≠ Δ tx.mint | W-8 (dùng cùng biến `delta` = `minted_qty(tx.mint,...)`) |
| A10 | Thiếu chữ ký reserve_authority | W-15 |
