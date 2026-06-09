# Deposits — TECH (Kiến trúc on-chain Aiken)

**Trạng thái:** draft 2026-06-08 (build-mode, chờ anh duyệt). Một trong 4 spec FEAT/MATH/TECH/EXEC.
Bám **[CONTRACT.md](./CONTRACT.md)** + [SPEC.md](./SPEC.md). Tài liệu này mô tả **byte-perfect**
datum/redeemer, validator, param, từng invariant on-chain map tới dòng code, codec offchain↔onchain.
KHÔNG định nghĩa lại bất biến (việc CONTRACT/MATH) — chỉ chỉ *cài đặt*.

Mẫu tái dùng: `Treasury/onchain/lib/magiclamp/treasury/*` (custody + sổ incremental + đếm theo script
hash) và `ConsumeMAGIC price_param.ak` (beacon governance + ép giá từ bảng, không tin client).

---

## 0. Bản đồ file

| File | Vai |
|---|---|
| `onchain/validators/deposits.ak` | validator pot — 3 nhánh Deposit/Refund/Escheat |
| `onchain/validators/deposit_param.ak` | validator beacon DepositParam — committee post bảng phí |
| `onchain/validators/deposits_test.ak` | test validator (mock Transaction) — happy + negative |
| `onchain/lib/magiclamp/deposits/types.ak` | datum/redeemer schema (khóa byte-perfect với offchain) |
| `onchain/lib/magiclamp/deposits/ledger.ak` | logic thuần sổ↔value (deposit/refund ledger+value ok) |
| `onchain/lib/magiclamp/deposits/schedule.ak` | định giá cọc từ beacon (`required_for`, `valid_param`) |
| `onchain/lib/magiclamp/deposits/util.ak` | helper đếm-theo-script-hash, epoch, beacon reader, authority |
| `offchain/src/{types,datum,builder,ledger,schedule}.ts` | mirror offchain (codec + plan + tx builder) |

---

## 1. Datum schema (byte-perfect)

Constr index = thứ tự khai báo trong `types.ak` (Aiken đánh số từ 0). Offchain `datum.ts` mirror
chính xác (header datum.ts:5-22 liệt kê đầy đủ).

### 1.1 DepositLine (types.ak:29, datum.ts:160)
```
DepositLine = Constr(0, [
  entity_id:ByteArray, depositor:ByteArray, policy:ByteArray, name:ByteArray,   // 4 bytes
  amount:Int, epoch:Int, asset_type:Int, value_tier:Int, lifecycle_class:Int     // 5 int
])
```
Khóa dòng = `(entity_id, depositor, policy, name)`. `amount > 0` luôn (refund/escheat xóa hẳn dòng,
không để dòng 0). ADA: `policy = #""`, `name = #""`. `(asset_type, value_tier, lifecycle_class)` lưu
để AUDIT + đối chiếu phân loại đã định giá (types.ak:36-39).

### 1.2 AssetKey (types.ak:42), DepositTier (types.ak:59), DepositParam (types.ak:70)
```
AssetKey    = Constr(0, [policy:ByteArray, name:ByteArray])
DepositTier = Constr(0, [asset_type:Int, value_tier:Int, lifecycle_class:Int, base_deposit:Int])  // base ≥ 0
DepositParam= Constr(0, [tiers:List<DepositTier>, demand_mult:Int, m_min:Int, m_max:Int, epoch:Int])
```

### 1.3 PotDatum (types.ak:82, datum.ts:186) — 13 field
```
PotDatum = Constr(0, [
  instance_id:ByteArray,                 // [0]  param
  accepted_assets:List<AssetKey>,        // [1]  param
  lifecycle_authority:Credential,        // [2]  param  (cardano/address.Credential)
  reserved_min_ada:Int,                  // [3]  param  lovelace giữ min-UTxO, KHÔNG ghi sổ
  deposit_param_policy:ByteArray,        // [4]  param  policy NFT xác thực beacon
  deposit_param_name:ByteArray,          // [5]  param  name NFT xác thực beacon
  deposit_param_script_hash:ByteArray,   // [6]  param  F3 — địa chỉ beacon HỢP LỆ
  treasury_credential:Credential,        // [7]  param  đích escheat
  escheat_after_epoch:Int,               // [8]  param  > 0
  ms_per_epoch:Int,                      // [9]  param  > 0
  min_param_epoch:Int,                   // [10] param  sàn freshness beacon (LỖ-2)
  ledger:List<DepositLine>,              // [11] STATE
  epoch:Int,                             // [12] STATE  epoch cập nhật gần nhất
])
```
11 field đầu = **param** (bảo toàn mọi tx — deposits.ak:279 `params_preserved`); chỉ `[11] ledger` +
`[12] epoch` đổi. `Credential` = `cardano/address.Credential`: `VerificationKey(h)=Constr(0,[bytes])`,
`Script(h)=Constr(1,[bytes])` (datum.ts:84).

### 1.4 DepositsRedeemer (types.ak:109, datum.ts:235)
```
Deposit = Constr(0, [entity_id, depositor, policy, name,            // 4 bytes
                     asset_type:Int, value_tier:Int, lifecycle_class:Int,
                     deposit_ref:OutputReference])                   // 8 fields — KHÔNG có amount
Refund  = Constr(1, [entity_id, depositor, policy, name])           // 4 bytes
Escheat = Constr(2, [entity_id, depositor, policy, name])           // 4 bytes
OutputReference = Constr(0, [txHash:ByteArray, index:Int])
```
**Điểm thiết kế quan trọng:** Deposit KHÔNG mang `amount` (v2 — types.ak:110-112). amount bị ÉP từ
beacon. Đây là khác biệt cốt lõi với "client mớm amount" (CONTRACT §5b).

### 1.5 DepositParamRedeemer (types.ak:141)
```
DepositParamRedeemer = Constr(0, [])   // PostParam (committee post bảng mới)
```

---

## 2. Validator `deposits` — 3 nhánh

Signature: `spend(datum_opt: Option<PotDatum>, redeemer: DepositsRedeemer, own_ref, tx)`
(deposits.ak:46). `else(_) -> fail` (deposits.ak:272) — chỉ cho phép spend đúng schema.

Bootstrap mỗi nhánh (deposits.ak:52-54):
```
expect Some(datum) = datum_opt                 // A16 missing_datum → fail
let own_addr = util.own_address(own_ref, tx.inputs)
let own_hash = util.own_script_hash(own_addr)  // expect Script(h) — pot KHÔNG ở VK
```

### 2.1 Nhánh Deposit (deposits.ak:57-146) — invariant → dòng code

| Invariant | Code |
|---|---|
| C-DEP-0 không mint | `expect assets.is_zero(tx.mint)` (68) |
| (phòng thủ) sổ in không dup | `expect ledger.no_dup_lines(datum.ledger)` (73) |
| C-DEP-1 single pot in/out theo script hash | `count_inputs_at_script==1` ∧ `count_outputs_at_script==1` (76-79) |
| C-DEP-2 params + epoch + output-ở-Script | `params_preserved` (84), `out_datum.epoch >= datum.epoch` (85), `!util.is_vk(pot_out.address)` (86) |
| C-DEP-3 asset accepted | `ledger.asset_accepted(policy, name, accepted_assets)` (89) |
| C-DEP-4 depositor ký | `util.signed_by(tx.extra_signatories, depositor)` (92) |
| F4+F5 datum guard | `ms_per_epoch > 0` (97), `escheat_after_epoch > 0` (98) — LỖ-3 |
| F1+LỖ-1 epoch dòng mới | `dep_epoch = util.get_deposit_epoch(tx, ms_per_epoch)` (102) — cửa sổ hẹp |
| C-DEP-7 đọc beacon + ép amount | `read_beacon_datum`(106) → `valid_param`(115) → `pp.epoch >= min_param_epoch`(118, LỖ-2) → `required_for` Some (120) |
| C-DEP-5 value | `ledger.deposit_value_ok(...)` (124) |
| C-DEP-6 sổ | `if amount > 0 { deposit_ledger_ok(...) } else { out_datum.ledger == datum.ledger }` (128-145) |

Nhánh `amount == 0` (cọc 0 — dưa leo): ép `out_datum.ledger == datum.ledger` (144) — KHÔNG ghi dòng
khống (SPEC §6.4 V5). Value cũng giữ nguyên qua `deposit_value_ok(..., 0)` (`add(v, p, n, 0) = v`).

### 2.2 Nhánh Refund (deposits.ak:148-205)

| Invariant | Code |
|---|---|
| C-REF-0 không mint | `assets.is_zero(tx.mint)` (151) |
| C-REF-1 single in/out | (153-156) |
| C-REF-2 params/epoch/Script | (159-163) |
| C-REF-3 dòng tồn tại + r>0 | `Some(line) = find_line(...)` (166); `refund_amount = line.amount`; `expect refund_amount > 0` (169) |
| C-REF-4 authority | `depositor_signed ‖ authority_signed` (172-180) |
| C-REF-6 sổ xóa dòng | `refund_ledger_ok(...)` (183) |
| C-REF-5 value −r | `refund_value_ok(...)` (194) |
| C-REF-7 tới đúng depositor | `output_sum_to_pkh(tx.outputs, depositor, policy, name) >= refund_amount` (204) |

`authority_ok` (util.ak:199): `VerificationKey(pkh)` → ký; `Script(hash)` → `witnessed_by_script`
(có input hoặc reference-input ở Script(hash) — util.ak:187). **MVP**: nhánh Script chỉ ép *sự hiện
diện* witness (SPEC §3 C-REF-AUTH ghi rõ v1 đơn giản; production gắn validator AssetDID thật).

### 2.3 Nhánh Escheat (deposits.ak:207-268)

Đối xứng Refund nhưng: (a) KHÔNG cần authority (ai cũng trigger — public-good); (b) thêm gate epoch;
(c) tiền về `treasury_credential` thay depositor.

| Invariant | Code |
|---|---|
| C-ESC-0..2 mint/single/params | (209-222) |
| C-ESC-3 dòng tồn tại + r>0 | `find_line`(225), `escheat_amount = line.amount`(227), `> 0`(228) |
| F4+F5+LỖ-3 guard | `ms_per_epoch > 0`(232), `escheat_after_epoch > 0`(233) |
| C-ESC-4 đã tới hạn | `current_epoch = get_epoch(tx, ms_per_epoch)`(237); `current_epoch >= line.epoch + escheat_after_epoch`(238) |
| C-ESC-6 sổ xóa dòng | `refund_ledger_ok(...)` (242) — tái dùng |
| C-ESC-5 value −r | `refund_value_ok(...)` (252) — tái dùng |
| C-ESC-7 tới Treasury | `output_sum_to_credential(tx.outputs, treasury_credential, policy, name) >= escheat_amount` (262) |

Tái dùng `refund_ledger_ok`/`refund_value_ok` (KHÔNG viết logic value mới — tối ưu ExUnit + giảm bề
mặt lỗi; SPEC §6.5).

---

## 3. Validator `deposit_param` (beacon) — param hóa

Param hóa (deposit_param.ak:17): `(committee: List<ByteArray>, threshold: Int, param_nft_policy,
param_nft_name)`. Spend (PostParam):

| Invariant | Code |
|---|---|
| không mint | `assets.is_zero(tx.mint)` (34) |
| single in/out theo script hash | (37-38) — chống chẻ UTxO beacon (REG-4) |
| committee guard | `threshold > 0`(44), `no_dup_keys(committee)`(45) — chống 1 key giả lập M-of-N |
| M-of-N | `count_sigs(committee, extra_signatories) >= threshold` (46) |
| epoch đơn điệu TĂNG | `out_datum.epoch > datum.epoch` (54) — chống rollback phí thấp |
| bảng mới hợp lệ | `schedule.valid_param(out_datum)` (57) |
| NFT bảo toàn | `nft_in == 1` ∧ `nft_out == 1` (62-63) |

**TRUST-ROOT (CONTRACT §5b):** authenticity = NFT one-shot. `param_nft_policy` PHẢI là one-shot
minting policy (mint đúng 1 lần, gắn UTxO seed). Kiểm ở **deploy/bootstrap** (offchain xác minh policy
script + lịch sử mint), KHÔNG kiểm lại mỗi tx Deposit. Đây là điểm tin cậy gốc — sai phá toàn bộ
định giá.

---

## 4. Lib `ledger.ak` — sổ↔value incremental (mẫu Treasury 4-kiểm)

### 4.1 Deposit ledger (ledger.ak:230 `deposit_ledger_ok`) — 4 kiểm
1. `no_dup_lines(out)` (63) — không 2 dòng cùng khóa.
2. `all_lines_positive(out)` (71) — mọi dòng > 0.
3. `deposit_each_out_line_ok` (153) — mỗi dòng out: amount = `get(in,key) + delta` (delta = amount nếu
   đích, 0 nếu khác); + **F1 epoch** (174-179: dòng mới = dep_epoch; cộng dồn/khác = in.epoch giữ); +
   **F2 classification** (181-199: dòng đích khớp redeemer, cộng dồn buộc in cũ cũng khớp; dòng khác
   khớp in).
4. `each_in_line_present`(206) + `target_line_present_once`(217) — không mất dòng in, ĐÚNG 1 dòng đích.

### 4.2 Refund ledger (ledger.ak:337 `refund_ledger_ok`) — 5 kiểm
`no_dup_lines(out)` + `all_lines_positive(out)` + `target_absent`(286, dòng đích XÓA) +
`each_out_is_untouched_in`(301, mỗi dòng out là dòng in không-đích **y nguyên** `i == o`) +
`each_in_nontarget_present`(317, mọi dòng in khác đích còn). ⇒ `L_out = L_in \ {đích}` chính xác.

### 4.3 Value (đẳng thức tuyệt đối)
`deposit_value_ok` (265): `v_out == assets.add(v_in, policy, name, amount)`. `refund_value_ok` (362):
`v_out == assets.add(v_in, policy, name, -refund_amount)`. So toàn multiset → khóa 2 chiều, rẻ ExUnit
hơn fold per-asset (SPEC §4).

### 4.4 Seed/state helper
`ledger_value`(93) + `pot_value_ok`(102) — kiểm INV-LEDGER lúc seed (offchain dùng trước deploy).

---

## 5. Lib `util.ak` — chống double-sat + epoch + beacon + authority

- **Đếm theo PAYMENT SCRIPT HASH** (70 `is_at_script`, 87-104 count/find/at): KHÔNG so full Address →
  2 UTxO khác stake-cred cùng script tính chung (chống double-sat C1/C2/M1). `is_vk`(78) ép pot output
  ở Script.
- **Epoch:** `get_epoch`(33, one-cận — Escheat) vs `get_deposit_epoch`(53, hai-cận hẹp — Deposit
  đóng-dấu). `get_finite`(19) trích `Finite` bound, fail nếu vô hạn.
- **Người nhận (gộp-tổng chống double-sat):** `output_sum_to_pkh`(110, refund tới VK) +
  `output_sum_to_credential`(135, escheat tới VK/Script). KHÔNG dùng "tồn tại 1 output ≥ amount".
- **Beacon reader (CIP-31):** `read_beacon_datum`(164) — tìm ref input theo `OutputReference`, ÉP
  địa chỉ == `Script(script_hash)` (F3), NFT qty == 1, datum inline. Trả `Data` (caller `expect`
  cast `DepositParam`).
- **Authority:** `signed_by`(182), `witnessed_by_script`(187), `authority_ok`(199).
- **Test builders:** `script_address`/`vk_address`/`mk_output`/`mk_input`/`mk_ref` (213-252).

---

## 6. Lib `schedule.ak` — định giá

```
q = 1_000_000_000                                              // schedule.ak:15
lookup_base(tiers, at, vt, lc) -> Option<Int>                 // None nếu không có hàng (20)
valid_param(pp) -> Bool                                       // clamp + base≥0 (42)
required_for(pp, at, vt, lc) = Some(base * demand_mult / q)   // floor BigInt, None nếu không có hàng (54)
```
None khi tier không có trong bảng → Deposit fail (chống tier giả né phí). `required` ≥ 0 (base≥0,
mult≥m_min≥0). Pure BigInt, không float.

---

## 7. Codec offchain ↔ onchain (byte-perfect)

`offchain/src/datum.ts` dùng **duck-type Constr** (datum.ts:42 `asConstr`) thay `instanceof` để tránh
lỗi 2 bản `@lucid-evolution/lucid` khác class identity (offchain vs scripts — bài học Treasury).

Kiểm field-count chặt (mỗi decode `expect length`):
- AssetKey 2, Credential 1, OutRef 2, DepositTier 4, DepositParam 5, **DepositLine 9**, **PotDatum 13**,
  Deposit redeemer 8, Refund 4, Escheat 4 (datum.ts:78,91,107,120,140,170,207,261,275,285).

`normHex`(37) chuẩn hóa hex (bỏ `0x`, lowercase). `DEPOSITS_REDEEMER = {Deposit:0, Refund:1,
Escheat:2}` (33) khớp Constr index onchain. Round-trip `*ToCbor`/`*FromCbor` cho PotDatum + DepositParam
+ redeemer (test offchain `deposits.test.ts`).

**Mirror invariant offchain** (`builder.ts`): `planDeposit`/`planRefund`/`planEscheat` tự kiểm bất
biến (gọi `depositLedgerOk`/`depositValueOk`/`refundLedgerOk`/`refundValueOk` từ `ledger.ts`) TRƯỚC
khi dựng tx → fail-fast, tránh phí submit hỏng (builder.ts:113-118, 226-231, 328-333).

---

## 8. Param hóa & bootstrap

- `deposits` validator: KHÔNG param hóa ở compile (đa thuê bao qua `instance_id` trong datum). Mọi
  cấu hình instance nằm trong PotDatum param fields.
- `deposit_param` validator: param hóa 4 giá trị compile-time (committee, threshold, nft policy/name)
  → mỗi instance governance có script hash riêng. `deposit_param_script_hash` trong PotDatum ghim
  đúng hash này (F3) để Deposit xác thực beacon.
- Bootstrap (scripts/01_deploy_pot.ts): deploy beacon (datum bảng phí + NFT) + pot (datum seed sổ
  rỗng). Live cần mint NFT one-shot trước (build-mode dùng placeholder demo `9999`/`5041524d`).

---

## 9. Tối ưu eUTXO / ExUnit (SPEC §4, §6.5)

- 1 pot UTxO (point of contention tuần tự); beacon là **reference input** (CIP-31 — 1 UTxO chung mọi
  deposit, KHÔNG tiêu → không contention beacon).
- Sổ `List<DepositLine>`; kiểm incremental O(n) mỗi tx. Value preservation = 1 đẳng thức `Value`
  (rẻ nhất, khóa 2 chiều) thay fold per-asset.
- Escheat tái dùng `refund_ledger_ok`/`refund_value_ok` → không thêm logic value mới.
- ExUnit thực đo: xem `aiken check` output (mem/cpu mỗi test). v1 single-op-per-tx đủ cho self-test;
  nghẽn → batch nhiều op/tx hoặc shard-by-entity-prefix (v1.x).
