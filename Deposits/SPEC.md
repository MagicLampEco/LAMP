# Deposits — SPEC (chi tiết + tự phản biện/tấn công)

Bổ trợ `CONTRACT.md`. Mục tiêu: mô tả validator `deposits.ak`, bất biến chi tiết, **danh sách vector
tấn công đã rà + cách đóng**, và bằng chứng test.

Tham chiếu mẫu: `Treasury/onchain/lib/magiclamp/treasury/{collect,release}.ak` (value-preservation bằng
đẳng thức Value tuyệt đối; đếm theo payment script hash; sổ incremental 4-kiểm).

---

## 1. Datum & redeemer

```
DepositLine {                      // 1 dòng cọc trong sổ pot
  entity_id    : ByteArray,        // AssetDID con vật/cây / nhóm / hợp đồng
  depositor    : ByteArray,        // pkh người bỏ tiền — người DUY NHẤT được hoàn
  policy       : ByteArray,        // asset (LAMP); #"" = lovelace
  name         : ByteArray,
  amount       : Int,              // số đang khóa (> 0)
  epoch        : Int,              // epoch gửi (audit)
}

PotDatum {
  instance_id        : ByteArray,        // định danh instance (đa thuê bao)
  accepted_assets    : List<AssetKey>,   // (policy,name) được nhận
  lifecycle_authority : Credential,      // ai (ngoài depositor) được trigger Refund
  reserved_min_ada   : Int,              // lovelace giữ min-UTxO, KHÔNG ghi sổ
  ledger             : List<DepositLine>,// sổ cọc
  epoch              : Int,              // epoch cập nhật gần nhất
}

DepositsRedeemer:
  Deposit { entity_id, depositor, policy, name, amount }   // Constr 0
  Refund  { entity_id, depositor, policy, name }            // Constr 1
```

`lifecycle_authority : Credential` (mirror `cardano/address.Credential`): có thể là
`VerificationKey(pkh)` (council/owner key) hoặc `Script(hash)` (validator AssetDID/hợp đồng — withdraw-0
hoặc spend chứng kiến). Ép qua `extra_signatories` (VK) hoặc input chứng kiến (Script) — v1 dùng nhánh
VK + reference-witness đơn giản (xem §3 C-REF-AUTH).

Khóa dòng = `(entity_id, depositor, policy, name)`. `reserved_min_ada` + `lifecycle_authority` +
`accepted_assets` + `instance_id` là **params** bảo toàn qua mọi tx (chỉ `ledger` + `epoch` đổi).

---

## 2. Bất biến validator (mã C-DEP-* / C-REF-*)

**Deposit:**
- C-DEP-0  `tx.mint == 0` (không mint/burn).
- C-DEP-1  ĐÚNG 1 pot input + 1 pot output theo payment script hash (chống double-sat).
- C-DEP-2  params bảo toàn (instance_id, accepted_assets, lifecycle_authority, reserved_min_ada); epoch
           không lùi; pot output ở Script (`!is_vk`).
- C-DEP-3  `amount > 0` ∧ asset ∈ accepted_assets.
- C-DEP-4  `depositor` ký tx (`extra_signatories`) — sổ trung thực, không gán nợ người khác.
- C-DEP-5  **value:** `pot_out.value == pot_in.value ⊕ {asset: amount}` (đẳng thức tuyệt đối → asset
           khác giữ nguyên, không drain).
- C-DEP-6  **sổ:** dòng `(entity,depositor,asset)` ở out == số dư in của dòng đó `+ amount`; mọi dòng
           khác giữ nguyên; không thêm/xóa dòng khác; không dòng trùng khóa; mọi dòng out `amount > 0`.

**Refund:**
- C-REF-0  `tx.mint == 0`.
- C-REF-1  ĐÚNG 1 pot input + 1 pot output theo payment script hash.
- C-REF-2  params bảo toàn; epoch không lùi; pot output ở Script.
- C-REF-3  dòng đích `(entity,depositor,asset)` PHẢI tồn tại trong `ledger_in` (chống refund-phantom);
           gọi `refund_amount` = số dư dòng đó (> 0).
- C-REF-4  **authority:** `depositor` ký HOẶC `lifecycle_authority` thỏa (VK ký / Script chứng kiến).
- C-REF-5  **value:** `pot_out.value == pot_in.value ⊖ {asset: refund_amount}` (đẳng thức tuyệt đối).
- C-REF-6  **sổ:** dòng đích **bị XÓA** khỏi out; mọi dòng khác giữ nguyên; không thêm dòng; không trùng
           khóa. (Xóa dòng = chống double-refund: lần 2 C-REF-3 fail vì dòng đã biến mất.)
- C-REF-7  **người nhận:** Σ output value(asset) tới `depositor` ≥ `refund_amount` ∧ `depositor ≠ pot`
           (tiền THẬT rời pot, về đúng người ghi sổ — tổng-khớp chống double-satisfaction).

---

## 3. Tự phản biện / tấn công (vector → cách đóng → test)

| # | Vector tấn công | Cách đóng | Test (NEGATIVE) |
|---|---|---|---|
| A1 | **Double-refund**: hoàn cùng 1 dòng 2 lần để rút 2× | Refund XÓA dòng (C-REF-6). Tx2 dùng cùng khóa → C-REF-3 fail (dòng không còn) | `refund_phantom` (sau xóa) + onchain xóa-dòng enforced |
| A2 | **Refund sai người**: kẻ khác trigger, tiền về túi kẻ tấn công | Tiền LUÔN về `depositor` ghi trong dòng (C-REF-7); output tới attacker không thỏa | `refund_wrong_recipient` |
| A3 | **Refund vượt amount**: rút nhiều hơn đã gửi | `refund_amount` = số dư dòng (đọc từ sổ), value ⊖ đúng số đó (C-REF-5); over-pay tới depositor không phá value nhưng over-rút pot value → C-REF-5 fail | `refund_over_amount` |
| A4 | **Deposit âm / 0**: ghi `amount ≤ 0` để bơm sổ hoặc rút ngược | C-DEP-3 `amount > 0`; C-DEP-6 mọi dòng out `> 0` | `deposit_negative`, `deposit_zero` |
| A5 | **Entity giả / phantom line**: bơm dòng sổ khống không kèm value | C-DEP-6 đẳng thức sổ↔value: dòng mới phải kèm value ⊕ amount đúng (C-DEP-5). Dòng khống không có value → value_ok fail | `deposit_phantom_value` |
| A6 | **Drain ADA / asset khác**: lợi dụng deposit/refund để rút ADA reserved hoặc token khác | Đẳng thức Value tuyệt đối (C-DEP-5/C-REF-5): chỉ asset đụng đổi, asset khác == in | `deposit_drain_ada`, `refund_drain_other` |
| A7 | **Double-satisfaction**: 2 pot UTxO khác stake-cred, 1 redeemer rút cả 2 | Đếm theo payment script hash == 1 in + 1 out (C-*-1) | `deposit_double_sat` |
| A8 | **Refund-chưa-deposit (phantom)**: refund khóa chưa từng gửi | C-REF-3 dòng phải có trong ledger_in | `refund_phantom` |
| A9 | **Mint/burn**: phá fixed-supply hoặc tạo LAMP | C-*-0 `tx.mint == 0` | `deposit_mint`, `refund_mint` |
| A10 | **Đổi params lén** (đổi lifecycle_authority để chiếm quyền refund tương lai) | C-*-2 params bảo toàn | `deposit_param_tamper`, `refund_authority_tamper` |
| A11 | **Gán depositor giả** (ghi tên người khác → sau này họ "nợ" / loạn sổ) | C-DEP-4 depositor PHẢI ký | `deposit_unsigned_depositor` |
| A12 | **Refund không ai có quyền** (người lạ tự rút dù không phải depositor/authority) | C-REF-4 phải depositor-ký hoặc authority-thỏa | `refund_no_authority` |
| A13 | **Pot output về ví thường** (rút sạch pot, không trả lại script) | C-*-1 đếm output-at-script == 1; C-*-2 `!is_vk` | `deposit_no_pot_output`, refund tương tự |
| A14 | **Xóa/sửa dòng người khác** trong cùng tx refund | C-REF-6 mọi dòng ≠ đích giữ nguyên (each-other-line-present + no extra) | `refund_tamper_other_line` |
| A15 | **Refund một phần để giữ dòng** (rút bớt, giữ khóa → refund lại) | v1 hoàn TRỌN: C-REF-6 xóa hẳn dòng đích, không có nhánh hoàn-một-phần | (cấu trúc: không expose partial) |
| A16 | **Datum rỗng** (spend pot không datum) | `expect Some(datum)` fail | `missing_datum` |
| A17 | **Cộng dồn sai khi deposit trùng khóa** (tạo 2 dòng cùng khóa né kiểm) | C-DEP-6 no_dup_lines(out) + dòng đích == in + amount | `deposit_dup_line` |

**Quyết định authority (A12, 4 trục):** Model A — `depositor` luôn rút được cọc của mình (an toàn vốn,
không giam vốn user); `lifecycle_authority` cho hệ tự hoàn hàng loạt khi entity kết thúc. KHÔNG kéo cả
Governance proposal cho mỗi entity (tối ưu phí + đơn giản; bond ≠ chi ngân khố). `lifecycle_authority`
là Credential → cắm validator hoặc key, decentralize được.

### C-REF-AUTH chi tiết (v1)
- Nhánh **depositor**: `depositor ∈ tx.extra_signatories`.
- Nhánh **authority**:
  - `lifecycle_authority == VerificationKey(pkh)` → `pkh ∈ tx.extra_signatories`.
  - `lifecycle_authority == Script(hash)` → tx có **input hoặc reference_input tại địa chỉ payment =
    Script(hash)** (chứng kiến validator lifecycle đồng ý). v1 ép sự hiện diện input/ref-input ở
    Script(hash) (đơn giản, đủ an toàn cho self-test; production gắn validator AssetDID thật).
- Refund hợp lệ ⇔ (depositor-ký) ∨ (authority-thỏa). Thiếu cả hai → C-REF-4 fail.

---

## 4. Tối ưu eUTXO / ExUnit

- 1 pot UTxO (point of contention tuần tự) — như Treasury T4: batch nhiều deposit/refund trong 1 tx nếu
  cần; nếu nghẽn → shard-by-entity-prefix (v1.x). v1 single-op-per-tx đủ cho self-test.
- Sổ là `List<DepositLine>`; kiểm incremental O(n) mỗi tx (mirror Treasury). Khóa dòng dài hơn Treasury
  (4 field thay 2) nhưng cùng độ phức tạp.
- Value preservation bằng MỘT đẳng thức `Value` (rẻ nhất, khóa 2 chiều) thay vì fold per-asset.

---

## 5. Bằng chứng test

Xem `Deposits/onchain/validators/deposits_test.ak` (validator tests, mock Transaction — happy +
NEGATIVE A1–A17 + v2) + `Deposits/tests/deposits.test.ts` (offchain plan/codec vitest). Số pass thật ghi ở
báo cáo build. Deploy Preview: `Deposits/scripts/01_deploy_pot.ts` + `02_deposit_refund_e2e.ts`
(SUBMIT=false ở build-mode — chỉ import + tsc + plan, live khi có `.env`).

---

## 6. v2 — NÂNG CẤP (anh chốt 2026-06-08): deposit ĐỘNG + creator-refund + escheat

GIỮ NGUYÊN mọi bất biến v1 (value-preservation, double-refund, đúng depositor, double-sat). THÊM 3 thứ.

### 6.1 mintDeposit ĐỘNG — amount từ `DepositParam` beacon (KHÔNG client mớm)

- Beacon `DepositParam` (reference input, mang NFT xác thực) = bảng phí cọc do DAO chỉnh:
  `DepositTier { asset_type, value_tier, lifecycle_class, base_deposit }` + `demand_mult` (clamp `[m_min,m_max]`).
  `required = base_deposit × demand_mult / Q` (Q=1e9, pure BigInt, floor). Validator `deposit_param.ak` ép
  committee M-of-N + epoch đơn điệu tăng + `valid_param` (mẫu ConsumeMAGIC `price_param.ak`).
- Redeemer `Deposit` v2 mang `(asset_type, value_tier, lifecycle_class, deposit_ref)`. Validator ĐỌC beacon
  qua `deposit_ref` (xác thực NFT theo `deposit_param_policy/name` ghim trong PotDatum) → `valid_param` →
  tra hàng khớp 3 khóa → **ÉP `amount == required`** (C-DEP-7). amount KHÔNG còn trong redeemer.
- **Cọc 0 hợp lệ**: dưa leo (cây/thấp/ngắn) → `base_deposit=0` → amount 0 → KHÔNG ghi dòng (min-ADA Cardano
  đã chống rác). Bò/đất/hợp đồng (cao/dài) → cọc đáng kể.

### 6.2 Creator-refund

- `depositor` = pkh **người TẠO** (DID), ghi trong dòng. Refund/escheat trả về đúng `depositor`, ĐỘC LẬP ví
  người sở hữu cuối (giải "người tiêu dùng chưa có ví"). Đây đã là ngữ nghĩa v1 (giữ); v2 chỉ làm rõ vai trò.
  Nhánh authority v1 giữ nguyên (depositor ký HOẶC lifecycle_authority).

### 6.3 Escheat — DID mồ côi → Treasury

- Redeemer `Escheat { entity_id, depositor, policy, name }` (Constr 2). Bất biến C-ESC-0..7:
  - C-ESC-4 `current_epoch ≥ line.epoch + escheat_after_epoch` (epoch từ `validity_range.lower_bound /
    ms_per_epoch` — ledger chặn giả epoch tương lai).
  - C-ESC-7 value ÉP về `treasury_credential` (VK hoặc Script) — KHÔNG về ví attacker.
  - C-ESC-6 xóa dòng (dùng lại `refund_ledger_ok`) → chống double (escheat-rồi-refund/escheat lại fail vì
    dòng biến mất). C-ESC-5 value −amount tuyệt đối (chống drain ADA/token khác).
- Ai cũng trigger được (public-good cleanup) — tiền đích cố định nên không có động cơ trộm.

### 6.4 Vector tấn công v2 (đã đóng + test)

| # | Vector | Cách đóng | Test |
|---|---|---|---|
| V1 | Client mớm amount sai lịch | amount ÉP từ beacon (C-DEP-7); value khớp beacon | `v2_deposit_client_underpay_fail` |
| V2 | Tier giả để cọc=0 / định giá lậu | hàng không có trong bảng → `required_for` None → fail | `v2_deposit_fake_tier_fail` |
| V3 | Beacon giả (không NFT) | `read_beacon_datum` ép NFT qty==1 | `v2_deposit_fake_beacon_no_nft_fail` |
| V4 | Beacon rác (clamp/base âm) | `valid_param` (defense-in-depth) | `v2_deposit_invalid_beacon_fail`, schedule tests |
| V5 | Cọc 0 nhưng ghi dòng khống | nhánh amount==0 ép `sổ_out == sổ_in` | `v2_deposit_zero_phantom_line_fail` |
| V6 | Escheat sớm (chưa tới hạn) | C-ESC-4 epoch gate | `v2_escheat_too_early_fail` |
| V7 | Escheat về ví attacker | C-ESC-7 ÉP về `treasury_credential` | `v2_escheat_steal_to_attacker_fail` |
| V8 | Escheat rồi refund (double) | xóa dòng → refund-phantom fail | `v2_escheat_then_refund_double_fail` |
| V9 | Escheat phantom (dòng không có) | C-ESC-3 dòng phải tồn tại | `v2_escheat_phantom_fail` |
| V10 | Escheat ăn dòng người khác | C-ESC-6 dòng khác giữ nguyên | `v2_escheat_eat_other_line_fail` |
| V11 | Escheat xóa sổ giữ value | C-ESC-5 value −amount tuyệt đối | `v2_escheat_delete_keep_value_fail` |
| V12 | Escheat đổi param né hạn | C-ESC-2 params_preserved (9 field) | `v2_escheat_param_tamper_fail` |
| V13 | Escheat mint/burn | C-ESC-0 tx.mint==0 | `v2_escheat_mint_fail` |

### 6.5 Quyết định (4 trục)

- **Định hướng**: phí cọc động theo loại tài sản mở SDK cho mọi loại entity (con vật/cây/đất/hợp đồng) — không
  ép 1 mức cứng; LAMP có giá trị qua cọc thật cho tài sản giá trị cao.
- **First-principles**: amount KHÔNG tin client (như giá ConsumeMAGIC) — nguồn sự thật = beacon governance +
  NFT; phân loại trung thực thuộc AssetDID (ngoài module), validator chỉ đảm bảo "đã trả đúng phí cho loại đã khai".
- **Tối ưu eUTXO**: beacon là reference input (CIP-31, 1 UTxO chung mọi deposit, không tiêu — không contention);
  escheat tái dùng `refund_ledger_ok`/`refund_value_ok` (không thêm logic value mới).
- **Bền vững**: escheat chống kẹt vốn vĩnh viễn (DID mồ côi → Treasury), an toàn vốn user (depositor luôn rút
  được trước hạn), không trộm được (đích cố định).
