# Treasury-pull — cầu Reserve ↔ Treasury (nhả khi dưới sàn)

Cơ chế cho phép **Reserve nhả LAMP CHỈ KHI Treasury parked dưới sàn**, và ép Δ nhả ra vào **SỔ** kế
toán của kho chứ không chỉ vào sân kho.

## Thành phần

| File | Vai trò |
|---|---|
| `onchain/validators/reserve_auth.ak` | Minting policy ONE-SHOT đúc 1 **Treasury-pull auth NFT** — credential "kéo" Reserve. |
| `onchain/validators/reserve_gate.ak` | Spend validator GIỮ auth NFT; chỉ cho spend khi `parked < floor_oildrop`. |
| `onchain/validators/custody.ak` nhánh `MigrateIn` | **Chân Treasury của cầu này.** Custody BỊ TIÊU trong tx rút ⇒ nhánh này chạy ⇒ ép `value += Δ` (`C-MIG-7`) VÀ `sổ += Δ` (`C-MIG-8`). Bài kiểm: `onchain/validators/migrate_test.ak`. |
| `lib/magiclamp/treasury/migrate.ak` | Hằng `reserve_inflow_bucket_id` + `reserve_source_tag` (bucket đích và nhãn nguồn, đều HẰNG — người gọi không chọn được) + các vị từ `mint_ok`/`value_ok`/`asset_accepted`. |
| `offchain/src/reserveAuthBuilder.ts` | Dựng tx mint auth one-shot (gửi tới gate). |
| `offchain/src/reserveGateBuilder.ts` | Dựng/gộp phần GATE của tx Treasury-pull (spend auth + re-output auth). |

⚠️ Bản spec trước ghi cầu này là "1 cặp on-chain mới, **không sửa** custody/collect/release". Câu đó
KHÔNG còn đúng: `custody` đã nhận thêm nhánh `MigrateIn`, và `collect` đã nhận thêm một chặn
(`it.category != migrate.reserve_inflow_bucket_id`). Đọc theo bản cũ thì bỏ mất đúng cái tầng ghi sổ.

## Luật reserve_gate (spend auth UTxO)

**10 luật.** Nguồn: khối `// LUẬT (spend auth UTxO):` đầu `Treasury/onchain/validators/reserve_gate.ak`.

- **G-AUTH-1** own input mang auth NFT `(auth_policy, auth_name)` qty == 1 — authenticity.
- **G-CUST-1** tx có **ĐÚNG MỘT** custody UTxO THẬT (mang custody NFT
  `(custody_nft_policy, custody_nft_name)` qty == 1) trong tập **GỘP**
  `tx.inputs ∪ tx.reference_inputs` — tức **input HOẶC reference, đúng một**.
- **G-FLOOR-1** `parked = quantity_of(custody.value, lamp_policy, token_name) < floor_oildrop`.
  CHỈ cho kéo khi dưới sàn (cận chặt: `parked == floor` → reject).
- **G-REOUT-1** auth NFT **re-output về chính gate script**, so **địa chỉ ĐẦY ĐỦ** (không chỉ payment
  part), qty == 1. Tái dùng vô hạn; không mất, không burn, không rời script.
- **G-DATUM-1** auth re-output mang **INLINE datum** decode được về `Void`. Datum-hash không kèm tiền
  ảnh ⇒ UTxO không tiêu lại được ⇒ auth NFT chết ⇒ Reserve khoá **vĩnh viễn**.
- **G-REF-1** auth re-output KHÔNG mang `reference_script` (thuế min-ADA + phí vĩnh viễn).
- **G-USE-1** tx PHẢI thực sự **đúc LAMP > 0**. Chống tiêu rỗng permissionless mỗi block làm mọi tx
  rút hợp lệ thành vô hiệu — soi gương `C-COL-11` của `custody.ak`.
- **G-VALUE-1** lovelace của auth re-output `>=` lovelace own input. Chống vét ADA của gate.
- **G-NOBURN-1** auth NFT KHÔNG mint/burn trong tx (qty mint == 0) — chống đúc auth giả.
- **G-DS-1** đúng 1 input + đúng 1 output mang auth NFT (chống double-satisfaction).

> **VÌ SAO `G-CUST-1` GỘP HAI DANH SÁCH, không bắt cứng `reference_inputs`.** Ledger vẫn ép
> `BabbageNonDisjointRefInputs` cho PlutusV3 (nới của cardano-ledger chỉ áp cho V1/V2 từ protocol
> version 11), và cả ba module kho này compile ra `"plutusVersion": "v3"` ⟹ **một `TxIn` KHÔNG thể vừa
> ở `tx.inputs` vừa ở `tx.reference_inputs`**. Mà đường rút Reserve **bắt buộc TIÊU** custody: Genesis
> `lamp_mint` nhánh `ReserveDraw` và `custody` nhánh `MigrateIn` đều đòi nó ở `tx.inputs`, vì chính
> việc bị tiêu mới kích validator kho ghi Δ vào sổ. Bắt cứng một vai ⇒ **không tx `ReserveDraw` nào
> dựng được** ⇒ pot khoá vĩnh viễn.
>
> Ngữ nghĩa SÀN không đổi giữa hai vai: cả hai đều là value **TRƯỚC** khi Δ hạ cánh (reference = không
> tiêu nên bất biến; input = trạng thái VÀO của lượt tiêu). Vế "đúng một" là defense-in-depth: nếu
> one-shot vỡ, hai UTxO mang NFT cho phép chọn cái `parked` THẤP để lách sàn — kể cả khi chúng nằm ở
> hai danh sách khác nhau.

Permissionless: bất kỳ ai cũng trigger được KHI `parked < floor` **và tx thực sự đúc LAMP** (`G-USE-1`).

## Flow 1 tx (Reserve draw + gate spend + custody BỊ TIÊU)

Treasury-pull thực thi trong **MỘT tx duy nhất**, **4** validator chạy đồng thời:

```
                ┌─────────────────────── 1 TX ───────────────────────┐
 INPUTS:        │  • auth UTxO (tại reserve_gate)   ── reserve_gate ──│ ép SÀN
                │  • ReserveState UTxO (reserve NFT) ── reserve_draw ─│ ép trần epoch + nhịp
                │  • SupplyState UTxO (Genesis)      ── lamp_mint ────│ kế toán supply + A-DEST
                │  • custody UTxO (custody NFT)      ── custody ──────│ MigrateIn: value += Δ VÀ sổ += Δ
 MINT:          │  • delta LAMP (route ReserveDraw)
 OUTPUTS:       │  • auth NFT re-output VỀ reserve_gate (inline datum Void, tái dùng)
                │  • ReserveState' (drawn += delta, last_epoch := t)
                │  • SupplyState'  (reserve_minted += delta)
                │  • custody'      (value += Δ  ∧  ledger[reserve_inflow_bucket_id] += Δ)
                └─────────────────────────────────────────────────────┘
```

- **custody là SPEND input, KHÔNG phải reference.** Chính việc bị tiêu mới làm `custody` chạy, và
  `custody` là nơi DUY NHẤT ép Δ vào **SỔ**. Ba tầng cùng đòi điều này: `reserve_draw` Luật 9-10
  (tiêu đúng 1 UTxO mang kho NFT, ở đúng `custody_script_hash`), `lamp_mint` nhánh `ReserveDraw`
  (A-DEST: tiêu đúng 1 UTxO mang `reserve_kho_nft_*` + độ tăng ròng ≥ Δ), và `custody` nhánh
  `MigrateIn` (`C-MIG-7` value, `C-MIG-8` sổ).
- **KHÔNG còn khoảng hở "value tăng mà sổ chưa tăng".** Δ vào value và Δ vào sổ xảy ra trong **cùng
  một tx**, do cùng một validator ép. Bucket đích là **HẰNG** `migrate.reserve_inflow_bucket_id`, không
  do người gọi chọn; `source` phải khớp `migrate.reserve_source_tag` (`C-MIG-8` nhãn nguồn) ⇒ không có
  đường dùng `MigrateIn` để nạp vào bucket khác.
- `reserve_gate` đọc `parked` từ UTxO custody THẬT (ở đây là input — xem `G-CUST-1`), ép
  `parked < floor`, giữ auth NFT. Sàn đọc **trạng thái VÀO**, tức trước khi Δ hạ cánh.
- Khi gate spend → auth NFT thành **input** → thỏa điều kiện "treasury_auth NFT input qty ≥ 1 ở đúng
  `gate_script_hash`" của `reserve_draw` (Luật 5). Reserve nhả ⟺ Treasury thực sự dưới sàn.
- `reserve_gate` KHÔNG kiểm chi tiết draw của Reserve (reserve_draw tự ép trần/kế toán);
  `reserve_draw` KHÔNG kiểm sàn (gate tự ép). Phân tách trách nhiệm sạch.

Off-chain: gọi `attachGateSpend(txb, gateParams)` để thêm phần gate vào `buildDrawTx`
(Reserve SDK) đang dựng dở, rồi `.complete()` MỘT lần → 1 tx gộp.

## Interface contract (orchestrator chốt khi apply-param)

`reserve_auth` đúc auth NFT; policy id + name của nó PHẢI khớp param của CẢ HAI:

```
reserve_auth.policy_id           == reserve_gate.auth_policy           == reserve_draw.treasury_auth_policy
reserve_auth.auth_name           == reserve_gate.auth_name             == reserve_draw.treasury_auth_name
reserve_gate.custody_nft_policy/name == custody_seed.policy_id / instance_id (custody authenticity NFT)
reserve_gate.lamp_policy/token_name  == lamp_mint.policy / "tLAMP"(testnet) | "LAMP"(mainnet)

── ĐÍCH ĐẾN ĐƯỢC ĐỊNH DANH BẰNG NFT, KHÔNG BẰNG ĐỊA CHỈ (KHÔNG còn `reserve_dest`) ──
reserve_draw.kho_nft_policy/name  == lamp_mint.reserve_kho_nft_policy/name (khe #13-14)
                                  == custody_seed.policy_id / instance_id
reserve_draw.custody_script_hash  == script hash của custody sau apply-param
```

⚠️ **Ba chỗ trên phải cùng trỏ MỘT instance `custody`.** Lệch một byte thì mỗi validator canh một cái
kho khác nhau và **cả ba vẫn xanh** — khoá ba tầng đứt ở tầng nối dây, không tầng nào báo. Bài đỏ giữ
chỗ này ở `lamp_mint.ak`: `reservedraw_delta_vao_kho_dist_bi_tu_choi`,
`reservedraw_custody_bi_tieu_nhung_delta_chay_sang_kho_dist`.

Thứ tự apply-param (một chiều, không vòng): one-shot NFT → `lamp_mint` → `custody` → `reserve_gate` →
`reserve_draw`.

## Δ vào SỔ ngay trong tx rút — KHÔNG có bước settle sau

Không cần `Collect` để settle Δ. `MigrateIn` ép **value += Δ** (`C-MIG-7`) **và** **sổ += Δ tại đúng
một `(bucket, asset)`** (`C-MIG-8`) trong cùng tx rút, nên bất biến `value == Σ ledger + min_ada` không
bao giờ bị lệch tạm thời.

Đây là chỗ một bản spec trước đã sai, và cái sai không vô hại: nó tả Δ vào custody dưới dạng **value
THÔ chưa vào sổ**, rồi hẹn một tx `Collect` sau đó settle. Hình dạng đó có nghĩa Δ hạ cánh ở một UTxO
**không datum** tại địa chỉ kho — mà `custody` đòi datum để tiêu lại, nên Δ **đóng băng ngoài sổ**, tức
đốt trá hình, trái bất biến "LAMP không đốt; giảm lưu hành = chuyển vào Treasury (kế toán)"
(`Treasury/CONTRACT.md §5`). Bài đỏ ghi lại đúng hình dạng đó:
`reject_delta_to_datumless_utxo_at_kho_address` (`reserve_draw.ak`) và
`reservedraw_delta_to_datumless_utxo_at_kho` (`lamp_mint.ak`).

`Collect` vẫn tồn tại và vẫn có vai riêng (thu `protocol_cut` từ dòng phí), nhưng nó **không** phải
bước sau của đường rút Reserve. Nó còn bị chặn khỏi bucket này: `collect.all_items_valid` ép
`it.category != migrate.reserve_inflow_bucket_id`, để tính chất kiểm toán của bucket dành riêng cho
Reserve không bị trộn.
