# LAMP Reserve — Demand-Gated Draw Engine (v3, ghim)

Mô hình **đệm phát hành demand-gated** (allocation v3, đông kết 2026-06-14). Reserve là
**lớp đệm phát hành SAU CÙNG** của LAMP: 9,630 tỷ LAMP (26,75%) nhả từ U-space (chưa mint)
vào Treasury theo **trần cứng E/1000 mỗi epoch**, CHỈ khi Treasury thực sự "kéo" (pull).

> **Reserve KHÔNG nhả theo lịch thời gian.** Không cộng dồn catch-up. Mỗi epoch tối đa 1 draw
> ≤ E/1000. Token chưa nhả = chưa mint = không tồn tại on-chain (đúng mô hình lazy-mint Genesis).

---

## 1. Nguyên lý (first-principles)

Reserve giải đúng MỘT việc: đưa quota Reserve (U-space) vào lưu thông một cách **đơn điệu,
có nhịp, không ai rút tay**. Điều tiết cung-cầu 2 chiều (C↔T) thuộc **Treasury**, KHÔNG thuộc
Reserve (no-burn cấm token quay lại U). Reserve chỉ lo *nhịp phát hành* + *trần* + *đích = Treasury*.

- **Trần CỨNG mỗi epoch = E/1000** — không phụ thuộc thời gian trôi, không cục catch-up.
- **Demand-gated:** mỗi draw đòi Treasury co-spend authority NFT → Reserve nhả ⟺ Treasury
  thực sự dưới sàn (logic sàn `parked < floor` nằm Ở TREASURY — `reserve_gate`, xem §quan hệ).
- **Rollover:** epoch bị gate / không cần → dư ở lại pot, nhả epoch sau → tổng kéo dài tối
  thiểu ~1000 epoch (cạn liên tục), thực tế ~1001+ epoch (có epoch bị gate).

Bộ đếm = **ReserveState UTxO** (duy nhất, ghim bởi `reserve_thread` NFT one-shot).

---

## 2. Đơn vị + hằng số

| Hằng | Giá trị | Ghi chú |
|---|---|---|
| 1 LAMP | `1_000_000` oildrop | 10^6, khớp Genesis/Distribution |
| `E` (total_oildrop) | `9_630_000_000_000_000` oildrop | 9,630 tỷ LAMP — cap Reserve allocation v17 |
| `release_epochs` | `1000` | hằng thiết kế (`math.ak:13`); `E ⋮ 1000` → chia chẵn, dư = 0 |
| `max_per_epoch` | `E / 1000 = 9_630_000_000_000` oildrop | trần CỨNG mỗi epoch (`math.ak:17`) |

`max_per_epoch(E) × 1000 == E` (`math.ak:55` test). Cạn pot liên tục đúng trần ⇒ 1000 epoch.

---

## 3. ReserveState datum (interface contract — byte-perfect onchain ↔ offchain)

```
ReserveState {
  start_epoch : Int,   // epoch khởi tạo (BẤT BIẾN)
  total_oildrop   : Int,   // E = tổng quota Reserve (BẤT BIẾN)
  drawn_oildrop   : Int,   // oildrop đã nhả tích lũy (đơn điệu tăng, ≤ total_oildrop)
  last_epoch  : Int,   // epoch của draw gần nhất (ép ≤1 draw/epoch)
}
= Constr(0, [int, int, int, int])
```

Redeemer (`types.ak`):

```
ReserveRedeemer:      Draw              = Constr(0, [])   // nhả ≤ trần/epoch qua route ReserveDraw
ReserveThreadRedeemer: MintReserveThread = Constr(0, [])  // đúc reserve_thread NFT one-shot (deploy)
```

**Bất biến:** `start_epoch` + `total_oildrop` GIỮ NGUYÊN qua mọi transition; `drawn_oildrop` đơn điệu
tăng (≤ `total_oildrop`); `last_epoch` ghi epoch draw này → chống re-draw cùng epoch.

---

## 4. Hai validator

| Validator | Loại | Vai trò |
|---|---|---|
| `reserve_thread` | mint | đúc DUY NHẤT 1 `reserve_thread` NFT one-shot (param `genesis_ref`) → ReserveState chính danh & DUY NHẤT |
| `reserve_draw` | spend | giữ ReserveState UTxO; ép 9 luật mỗi draw (xem §5). ĐÓNG vai "meter" gate nhịp cho Genesis route ReserveDraw |

**Quan hệ với Genesis (lamp_mint):** Genesis route `ReserveDraw` đòi tx spend đúng 1 UTxO mang
"meter" NFT (gate nhịp). `reserve_thread` NFT của ReserveState ĐÓNG vai meter đó — `reserve_draw`
CHÍNH là gate nhịp. (Orchestrator chốt: `meter_nft = reserve_thread`. KHÔNG có validator
`reserve_meter` riêng — đó chỉ là tên khái niệm.)

---

## 5. Chín luật ép trong `reserve_draw` (mỗi tx Draw)

Gọi `s` = ReserveState input, `s2` = ReserveState output, `delta` = `Δ mint LAMP`
(`lamp_policy`, `token_name`), `t` = epoch suy từ `validity_range.lower_bound`.

1. **ReserveState input chính danh** — đúng 1 input mang `reserve_thread` NFT (qty == 1).
   Đọc state TRỰC TIẾP từ input (không tin datum option) → chắc khớp NFT. Chống UTxO rác cùng địa chỉ.
2. **Epoch ghim (lower + upper bound)** — `t` từ `lower_bound`; ÉP `upper_bound` Finite VÀ cùng
   epoch với lower (`hi / ms_per_epoch == t`). Chống tx phủ nhiều epoch để chọn nhịp nhả (Vector 2).
3. **≤1 draw/epoch** — `t > s.last_epoch`. Chống rút nhiều lần cùng epoch vượt trần; ép tiến nghiêm ngặt.
4. **delta hợp lệ** — 3 vế độc lập: `delta > 0` (chống draw rỗng) ∧ `delta ≤ max_per_epoch(total)`
   (trần CỨNG = total/1000) ∧ `delta ≤ total − drawn` (không vượt pot còn lại).
5. **Treasury-pull gate** — ∃ input mang `treasury_auth` NFT (qty ≥ 1) Ở ĐÚNG `gate_script_hash`
   (reserve_gate). Spend NFT từ gate BẮT BUỘC kích `reserve_gate.spend` (ép `parked < floor`).
   Chỉ đếm NFT chưa đủ — phải ghim địa chỉ (Vector F/3: auth ở ví thường sẽ bỏ qua gate).
6. **Chống double-satisfaction** — đúng 1 ReserveState input/tx theo own script-hash
   (`count_inputs_at_script == 1`). 2 input có thể chia chung 1 output dest → drain.
7. **ReserveState' tái tạo đúng** — đúng 1 output mang `reserve_thread` NFT, CÙNG script address;
   `s2.start_epoch == s.start_epoch` ∧ `s2.total_oildrop == s.total_oildrop` (bất biến) ∧
   `s2.drawn_oildrop == s.drawn_oildrop + delta` (đơn điệu) ∧ `s2.last_epoch == t`. State' KHÔNG ôm LAMP
   (chống nhồi LAMP né dest) ∧ KHÔNG đính `reference_script`.
8. **reserve_thread NFT không mint/burn trong tx** — `quantity_of(tx.mint, reserve_thread_*) == 0`.
   Chống đúc thêm meter NFT giả giữ ở ví thường để né validator (Vector F).
9. **TOÀN BỘ delta LAMP tới reserve_dest** — `qty_to_credential(dest) ≥ delta` (== delta ngầm vì
   Δ mint == delta và state output không ôm LAMP → không nguồn LAMP nào khác để vượt).

---

## 6. Param `reserve_draw` (apply-param lúc deploy)

| Param | Ý nghĩa |
|---|---|
| `lamp_policy` | minting policy LAMP/tLAMP (Genesis lamp_mint) — đo Δ mint |
| `token_name` | asset name LAMP (testnet "tLAMP" / mainnet "LAMP") |
| `reserve_thread_policy` / `reserve_thread_name` | policy + name reserve_thread NFT one-shot (authenticity ReserveState) |
| `ms_per_epoch` | độ dài epoch (POSIX ms) theo network |
| `reserve_dest` | địa chỉ ĐÍCH nhận LAMP nhả (= địa chỉ custody Treasury) |
| `treasury_auth_policy` / `treasury_auth_name` | policy + name NFT co-spend authority Treasury (Treasury-pull gate) |
| `gate_script_hash` | script hash của `reserve_gate` (Treasury). Auth NFT BẮT BUỘC spend từ input ở gate này → ép kích `reserve_gate.spend`. Hằng truyền vào — KHÔNG vòng phụ thuộc |

---

## 7. Quan hệ Treasury-pull (1 tx, 2 validator đồng thời)

Mỗi draw = MỘT tx gộp: `reserve_draw` (ép trần epoch + kế toán) + `reserve_gate` của Treasury
(ép sàn `parked < floor`, giữ auth NFT) + Genesis `lamp_mint` (kế toán supply, route ReserveDraw).
Auth NFT là **input** từ gate → thỏa Luật 5; `reserve_gate` đọc `parked` qua custody reference
(CIP-31), ép sàn. Reserve nhả ⟺ Treasury thực sự dưới sàn.

- `reserve_gate` KHÔNG kiểm chi tiết draw (reserve_draw tự ép trần/kế toán);
  `reserve_draw` KHÔNG kiểm sàn (gate tự ép). Phân tách trách nhiệm sạch.
- Chi tiết flow + interface contract apply-param: xem [`Treasury/reserve-pull.md`](../Treasury/reserve-pull.md).

---

## 8. Vector tấn công đã đóng (test negative)

| Vector | Cơ chế chặn | Test (`reserve_draw.ak`) |
|---|---|---|
| Vượt trần epoch | Luật 4 (`delta ≤ max_per_epoch`) | `reject_delta_exceeds_max_per_epoch` |
| 2 draw cùng epoch | Luật 3 (`t > last_epoch`) | `reject_two_draws_same_epoch` |
| Tua lùi epoch | Luật 3 | `reject_draw_epoch_before_last` |
| Thiếu Treasury-pull | Luật 5 | `reject_missing_treasury_auth` |
| Auth ở ví thường / sai script (Vector 3) | Luật 5 (ghim gate_script_hash) | `reject_auth_not_at_gate` / `reject_auth_at_wrong_script` |
| Vượt pot còn lại | Luật 4 | `reject_delta_exceeds_pot_remaining` |
| ReserveState giả (không NFT) | Luật 1 | `reject_missing_nft` |
| Burn / draw rỗng | Luật 4 (`delta > 0`) | `reject_burn` / `reject_no_mint` |
| Kế toán sai (drawn/last_epoch) | Luật 7 | `reject_drawn_wrong_sum` / `reject_last_epoch_not_updated` |
| Rò rỉ LAMP né dest | Luật 9 | `reject_lamp_leak_not_to_dest` |
| Double-satisfaction | Luật 6 | `reject_double_satisfaction` |
| Nới cap / dời mốc | Luật 7 (bất biến) | `reject_total_oildrop_mutated` / `reject_start_epoch_mutated` |
| State' ôm LAMP / rời địa chỉ | Luật 7 | `reject_state_output_holds_lamp` / `reject_state_moved_address` |
| Đúc thêm meter NFT (Vector F) | Luật 8 | `reject_mint_extra_reserve_thread` |
| upper_bound vô hạn / khác epoch (Vector 2) | Luật 2 | `reject_upper_bound_infinite` / `reject_upper_bound_other_epoch` |

---

## 9. Trạng thái triển khai

- **onchain:** `reserve_draw.ak` (spend, 9 luật) + `reserve_thread.ak` (mint one-shot) +
  `lib/.../types.ak` (ReserveState + 2 redeemer) + `math.ak` (max_per_epoch/drawable) + `util.ak`.
  Test Aiken: happy (full-cap/partial/incremental/last-drain/3-epoch-chain) + toàn bộ negative §8.
- **offchain:** `types.ts` + `datum.ts` (codec byte-perfect) + `math.ts` (applyDraw/maxPerEpoch
  fail-fast) + `drawBuilder.ts` (dựng tx Draw co-spend ReserveState + SupplyState + Treasury auth).
- **đích nhả:** `reserve_dest` = địa chỉ custody Treasury. ⚠️ **CHƯA CHỐT** — quyết định này còn
  treo (bản ghi cũ ở `Legacy/internal-2026H1/PENDING.md §1`, thư mục đó **không còn hiệu lực**,
  đừng lấy làm nguồn). Phải chốt lại và ghi vào chính file này trước khi deploy Reserve.
