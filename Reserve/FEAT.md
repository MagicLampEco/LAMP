# Reserve — FEAT (hành vi + bất biến)

**Trạng thái:** SPEC (chờ EXEC sau 3 quyết định trong DESIGN doc).
**Nguồn bám:** `docs/DESIGN-fee-paymaster-reserve.md §C`; `Genesis/CONTRACT.md §2–§8`;
`Genesis/onchain/validators/tlamp_mint.ak`; `Genesis/onchain/lib/magiclamp/genesis/types.ak`.

---

## 1. Mục đích

Reserve = **quota CHƯA mint** 5% tổng cung (1.8 tỷ LAMP = `1_800_000_000_000_000` oil).
Nó là một con số (`reserve_minted`) và một trần (`reserve_cap`) nằm trong `SupplyState` —
KHÔNG phải UTxO chứa token, không phải pool vật lý.

Mục tiêu thiết kế:
- Giữ khả năng phát hành khẩn cấp / chiến lược trong khuôn khổ fixed-supply 36 tỷ.
- Mọi lần rút (`ReserveDraw`) phải đi qua gate DAO — không insider tự mint.
- Minh bạch on-chain: mọi lần rút đều ghi vào `SupplyState` datum (audit bất kỳ ai).
- Rate-limit / epoch chống rug-pull 1.8 tỷ trong một tx.

**Độc lập hoàn toàn với Treasury**: Treasury = custody nhận tLAMP đã mint;
Reserve = quota mint chưa phát hành. Không cần thêm UTxO mới ngoài Genesis.

---

## 2. Actors

| Actor | Vai trò |
|---|---|
| **DAO** | Phê duyệt `approved_cumulative` mới thông qua Governance Proposal; cấp `ReservePolicy` beacon |
| **Reserve Executor** | Ký tx `ReserveDraw` sau khi DAO đã phê duyệt; có thể là DAO multi-sig hoặc committee |
| **Bất kỳ** | Đọc `SupplyState` để kiểm toán `reserve_minted`, `reserve_cap` |
| **Genesis Contract** | `tlamp_mint` validator thực thi gate onchain (tầng 2, không thể bypass) |

---

## 3. Happy-path flow

### 3.1 Phê duyệt (offchain → Governance)

1. DAO tạo Proposal loại `ReserveDraw` với `new_cumulative` (tổng tích lũy mới ≤ `reserve_cap`).
2. Proposal pass ngưỡng vote (Governance Model A, `status == Executed`).
3. DAO cập nhật `ReservePolicy` beacon: `approved_cumulative = new_cumulative`, `epoch = now`.
4. `ReserveMeter` thread NFT (1/epoch) được tạo / reset cho epoch hiện tại.

### 3.2 Thực thi mint (tx on-chain)

1. Executor đọc `SupplyState` UTxO (mang `SUPPLY` thread NFT).
2. Tính `delta = new_cumulative − reserve_minted_current` (lượng cho phép còn lại của lần phê duyệt).
3. Giới hạn `delta ≤ max_draw_per_epoch − drawn_in_epoch` (rate-limit epoch).
4. Dựng tx:
   - **Input**: `SupplyState` UTxO (redeemer `Advance`) + `ReserveMeter` UTxO (cùng epoch).
   - **Mint**: `delta` oil tLAMP, redeemer `ReserveDraw`.
   - **Output**:
     - `SupplyState'`: `reserve_minted += delta`, caps bất biến, cùng địa chỉ script.
     - `ReserveMeter'`: `drawn_in_epoch += delta`, `epoch` giữ nguyên.
     - `recipient` nhận `delta` tLAMP (ví DAO / Treasury / địa chỉ chỉ định).
   - **Signatories**: `reserve_authority` keys đủ `auth_threshold`.
5. Onchain: `tlamp_mint` validator ép toàn bộ bất biến (xem §5 Genesis/CONTRACT.md).

### 3.3 Nhiều lần rút trong epoch

- Lần đầu: `drawn_in_epoch = delta1`.
- Lần hai cùng epoch: `drawn_in_epoch = delta1 + delta2 ≤ max_draw_per_epoch`.
- Sang epoch mới: `ReserveMeter` reset `drawn_in_epoch = 0`, `epoch = new_epoch`.

---

## 4. Edge cases (MECE)

| Tình huống | Hành vi |
|---|---|
| `delta = reserve_cap − reserve_minted` (rút hết còn lại) | Hợp lệ nếu ≤ `approved_cumulative` và ≤ rate-limit |
| `reserve_minted == reserve_cap` (quota cạn) | Mọi `ReserveDraw` reject (luật 7 `tlamp_mint.ak`) |
| DAO phê duyệt `new_cumulative < reserve_minted` hiện tại | Không có lượng nào được rút (`delta ≤ 0` → reject luật 2) |
| Rút vượt `approved_cumulative` | Validator `reserve_meter.ak` reject (`drawn_total > approved_cumulative`) |
| Rút vượt `max_draw_per_epoch` | `ReserveMeter` validator reject |
| Beacon giả (không do DAO mint) | `authenticity NFT` check trên beacon → reject |
| Meter epoch cũ (dùng lại ReserveMeter epoch trước) | `epoch` lock trong meter validator → reject |
| Double-meter (2 ReserveMeter input) | Thread NFT one-in/one-out ép đúng 1 → reject |
| Rút mà không cập nhật `reserve_minted` đúng | `tlamp_mint` luật 5 (quota lock) reject |
| Caps thay đổi qua transition | `tlamp_mint` luật 4 reject (`reserve_cap` bất biến) |

---

## 5. Bất biến (Invariants)

| ID | Phát biểu | Nguồn code |
|---|---|---|
| **R-I1** | `reserve_minted ≤ reserve_cap = 1_800_000_000_000_000` oil (mọi lúc) | `tlamp_mint.ak` luật 7 |
| **R-I2** | `reserve_minted` đơn điệu không giảm | `tlamp_mint.ak` luật 6 |
| **R-I3** | `reserve_cap` bất biến qua mọi transition | `tlamp_mint.ak` luật 4 |
| **R-I4** | `dist_minted + reserve_minted ≤ total_cap_oil = 36_000_000_000_000_000` | `tlamp_mint.ak` D7-#2 |
| **R-I5** | Mọi ReserveDraw phải có `reserve_authority` ký đủ `auth_threshold` | `tlamp_mint.ak` luật 8 |
| **R-I6** | `reserve_minted` trong datum tăng đúng bằng `delta` tx.mint (không lệch) | `tlamp_mint.ak` luật 5 + dùng cùng biến `delta` |
| **R-I7** | `drawn_in_epoch ≤ max_draw_per_epoch` trong epoch đang chạy | `reserve_meter.ak` (lớp gate mới) |
| **R-I8** | `reserve_minted_total ≤ approved_cumulative` sau mọi draw | `reserve_meter.ak` |
| **R-I9** | SupplyState thread NFT không rời script, không burn | `tlamp_mint.ak` luật 1 + `supply_state.ak` |

---

## 6. Out-of-scope (KHÔNG thuộc Reserve)

- **Cách DAO biểu quyết**: Governance module (Voting Power CONTRACT, `Governance/`) — Reserve chỉ đọc `status == Executed`.
- **Oracle giá LAMP↔USD**: không cần cho Reserve (LAMP-only).
- **Phân phối tLAMP sau khi mint**: tuỳ DAO (vào Treasury / airdrop / grant) — ngoài phạm vi spec này.
- **Capped Drop / DistributionVest**: quota Distribution 95% — mô-đun riêng.
- **Treasury custody**: nhận tLAMP đã mint, không liên quan đến Reserve quota.
- **Reserve 5% trong Foundation-Bootstrap.md §7.1**: cần reconcile thêm 1 dòng phân định (§7.1 chia Distribution 95% nội bộ; Reserve 5% nằm ngoài § đó). Hành động: báo anh trước khi sửa doc canonical (theo DESIGN doc §C).
