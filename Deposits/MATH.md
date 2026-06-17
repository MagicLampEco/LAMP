# Deposits — MATH (Cơ sở toán)

**Trạng thái:** draft 2026-06-08 (build-mode, chờ anh duyệt). Một trong 4 spec FEAT/MATH/TECH/EXEC
của Deposits. Bám **[CONTRACT.md](./CONTRACT.md)** (xương sống) + [SPEC.md](./SPEC.md) — tài liệu này
KHÔNG mâu thuẫn, chỉ **chứng minh hình thức** các bất biến mà CONTRACT phát biểu, và truy mỗi định
lý về đúng dòng code Aiken.

---

## 0. Ký hiệu

- `V_in`, `V_out`: `Value` của pot input / pot output (multiset `(policy, name) → Int`).
- `L_in`, `L_out`: sổ (danh sách `DepositLine`) trong datum in / out.
- `bal(L, a)` với `a = (policy, name)`: tổng số dư mọi dòng cùng asset `a` trong `L`.
- `line(L, k)`: dòng có khóa `k = (entity_id, depositor, policy, name)`; `amt(L, k)` = số dư của nó
  (0 nếu không có — lib `line_amount` ledger.ak:47).
- `r`: số nạp/hoàn của asset đụng đổi trong tx (`amount` / `refund_amount` / `escheat_amount`).
- `Q = 10^9` (schedule.ak:15), scale BigInt cho `demand_mult`.
- `⊕`, `⊖`: cộng/trừ multiset `Value` theo từng asset (đẳng thức TUYỆT ĐỐI, mọi asset).

Mọi số là `Int` (BigInt) — KHÔNG float (schedule.ak header). Chia `/` là floor-division Aiken.

---

## 1. Bất biến lõi (phát biểu hình thức)

| Mã | Phát biểu | Nguồn |
|---|---|---|
| **I-SUPPLY** | `tx.mint == 0` ∧ `V_out = V_in ± {a: r}` (mọi asset khác giữ nguyên) | CONTRACT §5; deposits.ak:68,124,209 |
| **I-LEDGER** | `∀a: V(a) − reserved_min_ada(a) = bal(L, a)` (sổ ↔ value) | CONTRACT §5; ledger.ak:102 |
| **I-REFUND-WHO** | Refund/Escheat: `Σ output(a) tới đích ≥ r` ∧ đích ≠ pot | CONTRACT §5; deposits.ak:204,262 |
| **I-AMOUNT** | `r = amt(L_in, k) > 0` (đọc từ sổ, không vượt) | deposits.ak:169,228 |
| **I-NO-DOUBLE** | refund/escheat XÓA dòng → lần 2 fail | CONTRACT §5; ledger.ak:286 |
| **I-NO-NEG** | mọi dòng `> 0`; deposit `amount ≥ 0`, ghi dòng chỉ khi `> 0` | ledger.ak:71; deposits.ak:128 |
| **I-PRICE** | deposit: `amount = ⌊base × mult / Q⌋` từ beacon (không tin client) | CONTRACT §5b; schedule.ak:62 |
| **I-PARAMS** | mọi param datum bảo toàn qua tx | deposits.ak:279 |

---

## 2. Bảo toàn value tuyệt đối (I-SUPPLY) — không burn

**Định lý 1 (Deposit).** Nếu nhánh Deposit qua, thì `V_out = V_in ⊕ {a: amount}` với mọi asset khác
giữ nguyên, và `tx.mint = 0`.

*Chứng minh.* deposits.ak:68 ép `assets.is_zero(tx.mint)`. deposits.ak:124 gọi `deposit_value_ok`,
mà (ledger.ak:265):
```
deposit_value_ok(v_in, v_out, policy, name, amount) = (v_out == assets.add(v_in, policy, name, amount))
```
Đây là đẳng thức `Value` **tuyệt đối** (so toàn bộ multiset, không fold per-asset). Vì `assets.add`
chỉ đổi đúng entry `(policy, name)` thêm `amount`, mọi asset khác PHẢI bằng `v_in` để đẳng thức giữ.
Khóa cả 2 chiều: không thể drain ADA reserved (asset lovelace phải == in) hay token khác (SPEC §3
A6). ∎

**Định lý 2 (Refund / Escheat).** `V_out = V_in ⊖ {a: r}`, mọi asset khác giữ nguyên, `tx.mint = 0`.

*Chứng minh.* Đối xứng: `refund_value_ok` (ledger.ak:362) = `v_out == assets.add(v_in, policy, name, -r)`.
deposits.ak:194 (Refund) / 252 (Escheat) gọi nó; deposits.ak:151/209 ép mint = 0. ∎

**Hệ quả (no-burn / no-mint).** Vì `tx.mint = 0` trong cả 3 nhánh, tổng cung token KHÔNG đổi bởi
Deposits. Tiền chỉ DI CHUYỂN (ví ↔ pot ↔ depositor/Treasury), không tạo/đốt — đúng tinh thần LAMP
fixed-supply (CONTRACT §1). Deposits KHÔNG đụng circulating-accounting (tiền tạm giữ thuộc người gửi).

---

## 3. Sổ ↔ value (I-LEDGER) bảo toàn incremental

Bất biến nền (CONTRACT §5, ledger.ak:102 `pot_value_ok`):
> `V = ledger_value(L) ⊕ from_lovelace(reserved_min_ada)`, tức `∀a: V(a) − reserved_min_ada(a) = bal(L, a)`.

**Định lý 3 (Deposit giữ I-LEDGER).** Nếu `V_in` thỏa I-LEDGER và nhánh Deposit qua với `amount > 0`,
thì `V_out` cũng thỏa I-LEDGER với `L_out`.

*Chứng minh.* Cần `bal(L_out, a) = bal(L_in, a) + amount` cho asset đụng đổi và `bal(L_out, b) =
bal(L_in, b)` cho `b ≠ a`. `deposit_ledger_ok` (ledger.ak:230) ép 4 điều:
1. `no_dup_lines(L_out)` — không 2 dòng cùng khóa.
2. `all_lines_positive(L_out)` — mọi dòng `> 0`.
3. `deposit_each_out_line_ok` — mỗi dòng out: nếu là đích thì `= amt(L_in, k) + amount`, nếu khác thì
   `= amt(L_in, k')` (giữ nguyên) — `deposit_delta` (ledger.ak:119).
4. `each_in_line_present` + `target_line_present_once` — mọi dòng in còn trong out, ĐÚNG 1 dòng đích.

(3) cho mỗi dòng out đúng giá trị; (4) cho không mất dòng in nào + cộng dồn về 1 dòng (không tách 2).
Cùng (1) (khóa duy nhất ⇒ song ánh khóa in↔out trừ dòng đích) suy ra `bal` chỉ đổi đúng `+amount` ở
asset đích. Kết hợp Định lý 1 (`V_out(a) = V_in(a) + amount`) và `reserved_min_ada` bảo toàn
(I-PARAMS): I-LEDGER giữ. ∎

**Định lý 4 (Refund/Escheat giữ I-LEDGER).** Xóa dòng đích `k`, `bal` giảm đúng `r = amt(L_in, k)`.

*Chứng minh.* `refund_ledger_ok` (ledger.ak:337) ép: `target_absent` (dòng đích không còn trong out),
`each_out_is_untouched_in` (mỗi dòng out là 1 dòng in không-đích, **giữ y nguyên** `i == o` — chống
sửa amount/epoch dòng khác), `each_in_nontarget_present` (mọi dòng in khác đích còn trong out). Suy ra
`L_out = L_in \ {line(k)}` chính xác. Do đó `bal(L_out, a) = bal(L_in, a) − r`, asset khác giữ. Kết
hợp Định lý 2 + reserved bảo toàn: I-LEDGER giữ. ∎

**Không dòng khống / value khống.** Hệ quả Định lý 3+4: không thể bơm dòng sổ mà không kèm value
(SPEC §3 A5 `deposit_phantom_value`), cũng không tăng value mà không ghi sổ tương ứng (test
`deposit_value_without_ledger`).

---

## 4. Định giá có thẩm quyền (I-PRICE) — không tin client

**Hàm phí cọc** (schedule.ak:54 `required_for`):
```
required(at, vt, lc) = ⌊ base_deposit[hàng khớp] × demand_mult / Q ⌋     (None nếu không có hàng)
```

**Định lý 5 (amount bị ép, không do client).** Deposit qua ⇒ `amount` đúng bằng `required(...)`
của beacon được xác thực, KHÔNG phải giá trị nào caller chọn.

*Chứng minh.* Redeemer Deposit v2 KHÔNG còn field `amount` (types.ak:113-122) — chỉ mang phân loại +
`deposit_ref`. Validator:
1. Đọc beacon qua reference input, xác thực NFT one-shot + đúng địa chỉ Script (deposits.ak:106,
   util.ak:164 `read_beacon_datum`) — F3.
2. `valid_param(beacon)` (deposits.ak:115) — clamp đúng.
3. `beacon.epoch ≥ min_param_epoch` (deposits.ak:118) — freshness.
4. `required_for(...)` ép Some (deposits.ak:120) — tier PHẢI có trong bảng (None → fail).
5. `amount` = giá trị đó; rồi `deposit_value_ok` (Định lý 1) ép `V_out = V_in + amount`.

Vì `amount` là output của bước 4 (không phải input redeemer), client không bịa được. Khai tier giả
(9,9,9) → `required_for` None → fail (SPEC §6.4 V2). ∎

**Bất biến clamp (schedule.ak:42 `valid_param`):**
```
0 ≤ m_min ≤ m_max ;  m_min ≤ demand_mult ≤ m_max ;  ∀ hàng: base_deposit ≥ 0
```
**Bổ đề (required ≥ 0).** Từ `base ≥ 0` ∧ `mult ≥ m_min ≥ 0` ⇒ `base × mult ≥ 0` ⇒ `⌊·/Q⌋ ≥ 0`. Do
đó cọc không bao giờ âm (chống "deposit khống / rút ngược" qua base âm — schedule.ak:39). ∎

**Tính đơn điệu theo demand_mult.** `mult₁ ≤ mult₂` ⇒ `⌊base·mult₁/Q⌋ ≤ ⌊base·mult₂/Q⌋` (floor đơn
điệu, `base ≥ 0`). DAO nâng `demand_mult` ⇒ cọc mọi hàng không giảm (test `schedule_demand_scales`:
50→100 LAMP khi 1.0×→2.0×). Cọc 0 bất biến theo mult (`0 × mult = 0` — test `schedule_cucumber_zero`).

---

## 5. Chống double-refund / double-escheat (I-NO-DOUBLE)

**Định lý 6.** Một dòng `k` được hoàn (refund) hoặc sung công (escheat) **đúng 1 lần** trên toàn
chuỗi tx hợp lệ.

*Chứng minh.* Refund/Escheat ép `Some(line) = find_line(L_in, k)` (deposits.ak:166, 225) — dòng PHẢI
tồn tại; nếu None → `expect` fail. Theo Định lý 4, sau thao tác `L_out = L_in \ {line(k)}`. Vì pot là
1 UTxO tuần tự (state machine), datum kế tiếp = `L_out` không còn `k`. Tx thứ 2 cùng khóa: `find_line`
trên sổ mới → None → fail. ⇒ tối đa 1 lần. (SPEC §3 A1, §6.4 V8: escheat-rồi-refund cũng fail vì dòng
biến mất.) ∎

**Hệ quả chống refund-phantom.** Refund khóa chưa từng deposit ⇒ `find_line` None ⇒ fail ngay (SPEC
§3 A8 `refund_phantom`). I-NO-REFUND-PHANTOM.

---

## 6. Hoàn về đúng người (I-REFUND-WHO) — chống double-satisfaction

**Định lý 7 (Refund tới đúng depositor).** Refund qua ⇒ `Σ` value(asset) của mọi output gửi tới
`VerificationKey(depositor)` `≥ refund_amount`.

*Chứng minh.* deposits.ak:204 ép `output_sum_to_pkh(tx.outputs, depositor, policy, name) ≥
refund_amount`. `output_sum_to_pkh` (util.ak:110) **GỘP** value(asset) của MỌI output có payment
credential = `VerificationKey(depositor)` — KHÔNG dùng "tồn tại 1 output ≥ amount". Gộp-tổng chống
double-satisfaction: nếu attacker tách output để 1 output ≥ amount nhưng tổng tới depositor < amount
(giấu bớt), tổng-khớp fail (test `refund_underpay_recipient`). Kết hợp Định lý 2 (pot value −r): tiền
THẬT rời pot, về đúng người ghi sổ. ∎

**Escheat tương tự (Định lý 7'):** `output_sum_to_credential(treasury_credential) ≥ escheat_amount`
(deposits.ak:262, util.ak:135) — gộp theo `Credential` (cho phép Treasury là Script). Tiền ÉP về
Treasury cố định, không về ví attacker dù ai trigger (SPEC §6.4 V7).

**Lưu ý đích ≠ pot.** Vì `output_sum_to_pkh` chỉ đếm output ở `VerificationKey(...)` còn pot output ở
`Script(...)` (deposits.ak:163 ép `!is_vk`), tiền tới depositor KHÔNG trùng pot output → r thực sự
rời pot (CONTRACT §5 INV-REFUND-WHO `depositor ≠ pot`).

---

## 7. Chống đầu độc đồng hồ (epoch) — 3 lỗ

CONTRACT §5b nêu 3 lỗ; đây là chứng minh.

**LỖ-1 (epoch dòng mới — cửa sổ hẹp).** Dòng mới đóng dấu `dep_epoch = ⌊lo / ms_per_epoch⌋` với
`(lo, hi)` = cả 2 cận hữu hạn của `validity_range`, ÉP `hi − lo < ms_per_epoch` (util.ak:53-61
`get_deposit_epoch`).

*Bổ đề (không bịa epoch quá khứ).* Ledger ép `lo ≤ slot ≤ hi` cho tx vào chuỗi. Nếu attacker đặt
`lo = 0` (quá khứ) để `dep_epoch = 0`, thì `hi < ms_per_epoch` (do cửa sổ hẹp) ⇒ ledger ép `slot ≤
hi < ms_per_epoch` ⇒ tx chỉ vào được quanh genesis (slot < 1 epoch). Với cọc thật (now ≫ genesis),
không thỏa ⇒ tx bị từ chối. Do đó `dep_epoch` ghim **sát now** (cửa sổ < 1 epoch ⇒ `lo` và `hi`
cùng/kề 1 epoch). ∎ Chống: dòng đóng dấu epoch giả nhỏ → escheat SỚM (cướp cọc user).

**LỖ-2 (freshness beacon).** Deposit ép `beacon.epoch ≥ min_param_epoch` (deposits.ak:118).
`min_param_epoch` đơn điệu tăng (cập nhật qua nâng cấp pot params; bảo toàn ở tx khác — I-PARAMS).
⇒ DAO nâng phí ở epoch mới, attacker không tham chiếu beacon epoch thấp (bảng phí cũ) để cọc ít hơn
lịch hiện hành (SPEC §6.4 V… stale). ∎

**LỖ-3 (escheat ≥ 1 epoch).** `escheat_after_epoch > 0` ép ở cả Deposit lẫn Escheat (deposits.ak:98,
233). ⇒ cọc tồn ≥ 1 epoch trước khi escheat được; `== 0` (nếu cho) cho phép escheat NGAY trong epoch
gửi (cướp cọc vừa nạp). Cùng `current_epoch ≥ line.epoch + escheat_after` (deposits.ak:238): escheat
chỉ kích hoạt sau đúng số epoch (SPEC §6.4 V6 `too_early`). ∎

**Idiom one-cận cho Escheat là đúng.** Escheat dùng `get_epoch` (chỉ `lower_bound` — util.ak:33). Vì
điều kiện là `current_epoch ≥ mốc` và ledger ép `slot ≥ lo`, đặt `lo` nhỏ KHÔNG giúp attacker (chỉ
làm điều kiện KHÓ thỏa hơn). One-cận an toàn cho gating "đã qua mốc"; chỉ Deposit (đóng-dấu) mới cần
hai-cận hẹp.

---

## 8. Chống double-satisfaction qua script hash (I-PARAMS phụ)

Mọi nhánh ép `count_inputs_at_script(own_hash) == 1` ∧ `count_outputs_at_script(own_hash) == 1`
(deposits.ak:76-77, 153-154, 212-213). Đếm theo **payment script hash** (util.ak:70 `is_at_script`),
KHÔNG so full Address ⇒ 2 pot UTxO khác stake-cred nhưng cùng script vẫn bị tính chung → 1 redeemer
KHÔNG rút được 2 pot (bài học audit C1/C2/M1 Distribution; SPEC §3 A7 `deposit_double_sat`). Beacon
`deposit_param` cũng ép single-in/single-out + NFT bảo toàn (deposit_param.ak:37-38, 62-63 — chống
chẻ UTxO beacon tách NFT khỏi datum, test `deposit_param_double_output_fail`).

**Params bảo toàn (I-PARAMS).** `params_preserved` (deposits.ak:279) so 11 field datum (mọi field
ngoài `ledger` + `epoch`); gom 1 chỗ để 3 nhánh dùng chung → thêm param mới chỉ sửa 1 nơi (tránh sót
field — bài học audit). Chống đổi `lifecycle_authority` để chiếm quyền refund tương lai (SPEC §3 A10),
đổi `treasury_credential`/`escheat_after_epoch` để né hạn (SPEC §6.4 V12).

---

## 9. Bảng property cần test (đối chiếu test thật)

| Property | Test onchain (deposits_test.ak / schedule.ak / deposit_param.ak) | Trạng thái |
|---|---|---|
| Định lý 1 (deposit value) | `deposit_new`, `deposit_drain_ada`(fail), `deposit_phantom_value`(fail) | pass |
| Định lý 2 (refund/escheat value) | `refund_by_depositor`, `refund_drain_other`(fail), `v2_escheat_delete_keep_value_fail` | pass |
| Định lý 3 (deposit ledger) | `deposit_accumulate`, `deposit_keeps_other_line`, `deposit_dup_line`(fail) | pass |
| Định lý 4 (refund ledger) | `refund_keeps_other_line`, `refund_tamper_other_line`(fail), `v2_escheat_eat_other_line_fail` | pass |
| Định lý 5 (I-PRICE) | `v2_deposit_cattle_dynamic`, `v2_deposit_client_underpay_fail`, `v2_deposit_fake_tier_fail` | pass |
| Bổ đề required≥0 / clamp | `schedule_valid_param_*`, `v2_deposit_invalid_beacon_fail` | pass |
| Đơn điệu mult | `schedule_demand_scales`, `schedule_cucumber_zero` | pass |
| Định lý 6 (no-double) | `refund_double_phantom`, `v2_escheat_then_refund_double_fail` | pass |
| Định lý 7 (refund-who) | `refund_wrong_recipient`(fail), `refund_underpay_recipient`(fail), `v2_escheat_steal_to_attacker_fail` | pass |
| LỖ-1 epoch | (deploy validity window — builder.ts:149) + escheat epoch tests | partial (xem EXEC §gap) |
| LỖ-3 escheat≥1 | `v2_escheat_too_early_fail` | pass |
| double-sat | `deposit_double_sat`(fail), `deposit_param_double_output_fail` | pass |
| no-mint | `deposit_mint`(fail), `refund_mint`(fail), `v2_escheat_mint_fail` | pass |
| I-PARAMS | `deposit_param_tamper`(fail), `v2_escheat_param_tamper_fail` | pass |

Tổng: **90/90 test onchain pass** (aiken check, 2026-06-08 — xem [EXEC](./EXEC.md) §4).

---

## 10. Giả định / giới hạn

- **TRUST-ROOT beacon** dựa vào NFT `deposit_param` là **one-shot** (mint đúng 1 lần). Đây là giả
  định kiểm ở **deploy** (offchain), KHÔNG chứng minh được trong validator Deposit (reference input
  chỉ thấy NFT, không thấy policy logic — CONTRACT §5b). Sai ở bước này phá toàn bộ I-PRICE.
- Chứng minh I-NO-DOUBLE giả định pot là state-machine 1-UTxO tuần tự (CONTRACT §2). Nếu tương lai
  shard pot (v1.x), cần chứng minh lại tính duy nhất khóa across shard.
- Floor-division: cọc thực = `⌊base·mult/Q⌋` có thể lệch tối đa < 1 oil so với giá trị thực — chấp
  nhận (mẫu ProtocolUtils.Q / ConsumeMAGIC; bond không cần độ chính xác sub-oil).
