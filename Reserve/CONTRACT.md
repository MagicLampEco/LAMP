# LAMP Reserve — Demand-Gated Draw Engine (v3 — luật E/1000, **chưa phải luật cuối**)

> ## 🔴 ĐỌC TRƯỚC KHI DEPLOY — tệp này và `Genesis/CONTRACT.md` mô tả HAI luật loại trừ nhau
>
> Tệp này mô tả **trần cứng E/1000 mỗi epoch**. `Genesis/CONTRACT.md §7b` mô tả một luật KHÁC
> HẲN — gate theo **mức Treasury** (trần `2%·C`, sàn `1%·C`, giữa hai mức thì nội suy, không
> giới hạn số epoch) — và nói thẳng: *"Reserve module hiện tại (`reserve_draw.ak`, trần
> E/1000/epoch) là thiết kế **CŨ** — cần thiết kế lại"*.
>
> Mã hiện có (`math.max_per_epoch` + `math.release_epochs` ở `Reserve/onchain/lib/magiclamp/reserve/math.ak`,
> gọi tại `Luật 4` của `reserve_draw`) hiện thực luật E/1000 của tệp
> này, **không** hiện thực §7b: grep `bps|nội suy|interpolat|circulating|lưu hành` trong
> `Reserve/onchain/` ra rỗng, và `reserve_draw` không nhận `SupplyState` nên **không đọc được
> `C`**. Sàn ở `reserve_gate` là `floor_oildrop` — một số **TUYỆT ĐỐI** (oildrop) nướng vào script
> hash, KHÔNG phải phần trăm lưu hành.
>
> Vì sao chỗ này đắt: cả **11** tham số của `reserve_draw` là **apply-param** — nướng vào script
> hash (bảng ở §6). `Luật 7` ép `s_out.address == own_out.address` và redeemer duy nhất là
> `Draw` (`else(_) { fail }`) ⇒ **meter NFT không bao giờ rời được địa chỉ đó**. Gửi meter
> NFT vào một instance là khoá luật đó cho toàn bộ vòng đời 9,63 tỷ, không có redeemer
> `Migrate`, không có đường nâng cấp. LAMP không burn ⇒ không có đường dọn sổ làm lại.
>
> **Chưa chốt §7b là luật cuối thì chưa được gửi meter NFT vào bất kỳ `reserve_draw` nào.**
> §7b cũng còn một lỗ ở tầng thiết kế: nó nói `1%`/`2%` của `C` (lưu hành) nhưng **chưa định
> nghĩa `C` đo bằng gì on-chain** — `C` ≠ `dist_minted + reserve_minted`, vì phần nằm trong
> Treasury thì đã đúc mà chưa lưu hành.

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
| `reserve_draw` | spend | giữ ReserveState UTxO; ép 10 luật mỗi draw (xem §5). ĐÓNG vai "meter" gate nhịp cho Genesis route ReserveDraw |

**Quan hệ với Genesis (lamp_mint):** Genesis route `ReserveDraw` đòi tx spend đúng 1 UTxO mang
"meter" NFT (gate nhịp). `reserve_thread` NFT của ReserveState ĐÓNG vai meter đó — `reserve_draw`
CHÍNH là gate nhịp. (Orchestrator chốt: `meter_nft = reserve_thread`. KHÔNG có validator
`reserve_meter` riêng — đó chỉ là tên khái niệm.)

---

## 5. Mười luật ép trong `reserve_draw` (mỗi tx Draw)

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
9. **tx PHẢI TIÊU đúng 1 UTxO mang KHO NFT** — `count_inputs_with_nft(tx.inputs, kho_nft_policy,
   kho_nft_name) == 1`. `reserve_draw` KHÔNG đo đích và KHÔNG đo lượng: nó chỉ ép kho BỊ TIÊU.
   Kho bị tiêu ⇒ validator của chính kho chạy (Treasury `custody`, nhánh `MigrateIn`) ⇒ chính nó
   ép Δ vào value VÀ vào SỔ (`C-MIG-7`/`C-MIG-8`). `== 1` chứ không `≥ 1`: hai UTxO kho trong một
   tx thì mỗi cái đòi "value tăng Δ" trong khi chỉ có một Δ được mint ⇒ mơ hồ, chặn cứng.
10. **UTxO mang kho NFT phải Ở ĐÚNG script hash của Treasury `custody`** —
    `is_at_script(kho_in.output.address, custody_script_hash)`. Luật 9 chỉ ép "một UTxO mang kho
    NFT bị tiêu", nó KHÔNG nói UTxO đó thuộc validator nào; NFT nằm ở script khác hoặc ở ví thường
    thì cái chạy không phải `custody` và không ai ép Δ vào SỔ. Soi gương Luật 5 — "có mặt" không
    thay được "validator nào chạy".

**VÌ SAO Luật 9 KHÔNG còn là `qty_to_credential(dest) ≥ delta`:** phép đo cũ đo TỔNG mặt output
tới một ĐỊA CHỈ, hỏng hai đường cùng lúc. (a) Đo tổng cho phép TÁI CHẾ — kho đang giữ `X ≥ delta`,
tx trả lại đúng `X`, `delta` mới ra ví, mà vế `tổng ≥ delta` vẫn thoả. (b) Đúng địa chỉ KHÔNG có
nghĩa là vào SỔ — Δ rót vào một UTxO không datum ở địa chỉ kho thì kho tiêu lại không được, Δ đóng
băng ngoài sổ = đốt trá hình, trái bất biến "LAMP không đốt". Nguồn: khối chú thích "LUẬT 9 — VÌ
SAO ĐO KHO BỊ TIÊU, KHÔNG ĐO ĐỊA CHỈ NHẬN ĐỦ" trong `Reserve/onchain/validators/reserve_draw.ak`.

**Lợi ích kèm theo:** địa chỉ kho không còn bị nướng vào script hash của `reserve_draw`, nên quyết
định "kho có uỷ quyền stake không" KHÔNG còn ràng vào apply-param.

---

## 6. Param `reserve_draw` (apply-param lúc deploy)

**11 tham số, ĐÚNG thứ tự** dưới đây (thứ tự nằm TRONG script hash — truyền lệch không báo lỗi,
nó chỉ ra một script hash khác một cách im lặng). Nguồn: chữ ký `validator reserve_draw(` trong
`Reserve/onchain/validators/reserve_draw.ak`.

| # | Param | Ý nghĩa |
|---|---|---|
| 1 | `lamp_policy` | minting policy LAMP/tLAMP (Genesis `lamp_mint`) — đo Δ mint |
| 2 | `token_name` | asset name LAMP (testnet "tLAMP" / mainnet "LAMP") |
| 3 | `reserve_thread_policy` | policy reserve_thread NFT one-shot (authenticity ReserveState) |
| 4 | `reserve_thread_name` | asset name reserve_thread NFT |
| 5 | `ms_per_epoch` | độ dài epoch (POSIX ms) theo network |
| 6 | `kho_nft_policy` | policy NFT one-shot ĐỊNH DANH kho (Treasury `custody`). Thay cho `reserve_dest` cũ: định danh kho bằng NFT, không bằng địa chỉ |
| 7 | `kho_nft_name` | asset name kho NFT |
| 8 | `treasury_auth_policy` | policy NFT co-spend authority Treasury (Treasury-pull gate) |
| 9 | `treasury_auth_name` | asset name Treasury auth NFT |
| 10 | `gate_script_hash` | script hash của `reserve_gate` (Treasury). Auth NFT BẮT BUỘC spend từ input ở gate này → ép kích `reserve_gate.spend`. Hằng truyền vào — KHÔNG vòng phụ thuộc |
| 11 | `custody_script_hash` | script hash của Treasury `custody`. UTxO mang kho NFT BẮT BUỘC nằm ở payment credential này (Luật 10). Đặt Ở CUỐI để không xê dịch khe cũ |

⚠ **BẤT BIẾN NỐI DÂY:** cặp `kho_nft_policy`/`kho_nft_name` (#6-7) của `reserve_draw` phải TRÙNG
cặp `reserve_kho_nft_policy`/`reserve_kho_nft_name` (khe #13-14 của
`Genesis/onchain/validators/lamp_mint.ak`), tức `(seed_policy, instance_id)` của instance `custody`
đích. Đó KHÔNG phải cặp `kho_nft_*` (#9-10) của `lamp_mint` — cặp đó trỏ kho Distribution. Truyền
lệch hai chỗ này thì mỗi validator canh một cái kho khác nhau và **cả hai vẫn xanh**: khoá ba tầng
đứt ở tầng nối dây, không tầng nào báo.

Thứ tự đúc: one-shot NFT → `lamp_mint` → `custody` → `reserve_gate` → `reserve_draw`. `custody`
không nướng hash của hai validator cuối ⟹ KHÔNG sinh vòng apply-param.

---

## 7. Quan hệ Treasury-pull (1 tx, 2 validator đồng thời)

Mỗi draw = MỘT tx gộp: `reserve_draw` (ép trần epoch + kế toán) + `reserve_gate` của Treasury
(ép sàn `parked < floor`, giữ auth NFT) + Genesis `lamp_mint` (kế toán supply, route ReserveDraw).
Auth NFT là **input** từ gate → thỏa Luật 5; `reserve_gate` đọc `parked` từ UTxO custody THẬT (mang
custody NFT) rồi ép sàn. Trên đường Reserve, custody đó là một **spend input**, không phải reference:
Luật 9 buộc kho bị tiêu, và PlutusV3 cấm một `TxIn` nằm đồng thời ở `tx.inputs` và
`tx.reference_inputs`. Vì vậy `G-CUST-1` gộp hai danh sách và chấp nhận **input HOẶC reference, đúng
một** (xem khối chú thích tại chỗ ép `G-CUST-1` trong `Treasury/onchain/validators/reserve_gate.ak`).
Reserve nhả ⟺ Treasury thực sự dưới sàn.

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
| Kho KHÔNG bị tiêu (hình dạng "rót vào địa chỉ rồi thôi") | Luật 9 | `reject_missing_kho_input` |
| 2 UTxO kho trong 1 tx (kho tự chia đôi trách nhiệm) | Luật 9 | `reject_two_kho_inputs` |
| Δ rót vào UTxO KHÔNG datum tại địa chỉ kho (Δ đóng băng ngoài sổ) | Luật 9 | `reject_delta_to_datumless_utxo_at_kho_address` |
| Kho NFT ngồi ở script KHÁC `custody` | Luật 10 | `reject_kho_nft_at_other_script` |
| Kho NFT ở ví thường | Luật 10 | `reject_kho_nft_at_wallet` |
| Double-satisfaction | Luật 6 | `reject_double_satisfaction` |
| Nới cap / dời mốc | Luật 7 (bất biến) | `reject_total_oildrop_mutated` / `reject_start_epoch_mutated` |
| State' ôm LAMP / rời địa chỉ | Luật 7 | `reject_state_output_holds_lamp` / `reject_state_moved_address` |
| Đúc thêm meter NFT (Vector F) | Luật 8 | `reject_mint_extra_reserve_thread` |
| upper_bound vô hạn / khác epoch (Vector 2) | Luật 2 | `reject_upper_bound_infinite` / `reject_upper_bound_other_epoch` |

---

## 9. Trạng thái triển khai

- **onchain:** `reserve_draw.ak` (spend, 10 luật) + `reserve_thread.ak` (mint one-shot) +
  `lib/.../types.ak` (ReserveState + 2 redeemer) + `math.ak` (max_per_epoch/drawable) + `util.ak`.
  Test Aiken: happy (full-cap/partial/incremental/last-drain/3-epoch-chain) + toàn bộ negative §8.
- **offchain:** `types.ts` + `datum.ts` (codec byte-perfect) + `math.ts` (applyDraw/maxPerEpoch
  fail-fast) + `drawBuilder.ts` (dựng tx Draw co-spend ReserveState + SupplyState + Treasury auth).
- **đích nhả:** `complete` — KHÔNG còn tham số `reserve_dest`. Đích được ép bằng NFT chứ bằng địa
  chỉ: `kho_nft_policy`/`kho_nft_name` (Luật 9, kho phải BỊ TIÊU) + `custody_script_hash` (Luật 10,
  kho phải ở đúng `custody`). Hạng mục "chốt `reserve_dest` trước khi deploy" đã hết hiệu lực vì
  chính tham số đó không còn tồn tại trong `validator reserve_draw(`.
- **còn treo:** `blocked-by-deploy` — cặp `(kho_nft_policy, kho_nft_name)` là `(seed_policy,
  instance_id)` của MỘT instance `custody`, nướng vào script hash. Chọn instance nào là quyết định
  lúc deploy, không phải điều validator tự bảo đảm; chọn sai không sửa được bằng cách truyền tham
  số khác. Xem §6 khối "BẤT BIẾN NỐI DÂY".
