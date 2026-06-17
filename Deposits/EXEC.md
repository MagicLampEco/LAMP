# Deposits — EXEC: Lộ trình triển khai & mốc

**Doctype:** MagicLamp Protocol — Deposits Spec (EXEC)
**Trạng thái:** lộ trình triển khai 2026-06-08 (build-mode). Bám
[`CONTRACT.md`](./CONTRACT.md) (xương sống) + [`SPEC.md`](./SPEC.md) (v1+v2). EXEC KHÔNG định nghĩa
lại datum/bất biến (việc TECH/MATH) — chỉ định **thứ tự build, test, deploy, bootstrap, rủi ro, tiêu
chí "xong"**.

Mẫu 4-spec + lộ trình deploy đã chạy ở [`Treasury/EXEC.md`](../Treasury/EXEC.md) và
[`Governance/VotingPower`](../Governance/VotingPower/). Deposits đi đúng cách Distribution/
Treasury đã làm (live Preview).

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Đưa Deposits từ outline (`SPEC.md` + `CONTRACT.md`) tới **chạy thật trên Preview**:

1. Một **`deposits` validator** (pot custody + sổ cọc + 3 cửa Deposit/Refund/Escheat) — đã code.
2. Một **`deposit_param` beacon validator** (committee post bảng phí cọc, NFT one-shot xác thực) — đã code.
3. **Định giá cọc ĐỘNG** từ beacon (KHÔNG tin client) + **creator-refund** + **escheat** entity mồ côi.
4. **Bootstrap instance** Preview (beacon bảng phí dưa-leo=0/bò=50, pot sổ rỗng) sẵn cho team eco khác.

Mục tiêu cuối: **làm LAMP có giá trị** — Deposits tạo nhu cầu LAMP thật (cọc cho tài sản giá trị cao)
mà KHÔNG đụng fixed-supply 36 tỷ (tiền tạm giữ, không burn).

### 0.2 Cái gì THUỘC EXEC

THUỘC: thứ tự build, test plan (đã có + còn thiếu), bootstrap, runner deploy/e2e, rủi ro, tiêu chí
"xong". KHÔNG thuộc: định nghĩa datum/redeemer (TECH), chứng minh bất biến (MATH), hành vi caller
(FEAT).

---

## 1. Lộ trình build (thứ tự đã làm)

1. **Types khóa interface** (`types.ak` + mirror `types.ts`/`datum.ts`) — Constr index, field count
   byte-perfect. ĐÂY là xương sống (CONTRACT), khóa trước.
2. **Lib thuần** (`ledger.ak`, `schedule.ak`, `util.ak`) — test đơn vị tách validator (mẫu Treasury).
3. **Validator `deposits`** (3 nhánh) + **`deposit_param`** (beacon) — gắn lib.
4. **Test validator** (`deposits_test.ak`) — mock Transaction: happy + negative A1–A17 + v2 V1–V13.
5. **Offchain SDK** (`builder.ts` plan/build + `ledger.ts`/`schedule.ts` mirror) — fail-fast tự kiểm.
6. **Scripts deploy/e2e** (`01_deploy_pot.ts`, `02_deposit_refund_e2e.ts`) — bootstrap + vòng đời cọc.

---

## 2. Trạng thái hiện tại

| Hạng mục | Trạng thái |
|---|---|
| `types.ak` + `datum.ts`/`types.ts` codec | xong, byte-perfect (13 field PotDatum, 9 field DepositLine) |
| `ledger.ak` (deposit/refund ledger+value ok, 4-5 kiểm) | xong |
| `schedule.ak` (required_for, valid_param, clamp) | xong |
| `util.ak` (count-by-script-hash, epoch, beacon reader, authority) | xong |
| `deposits.ak` (Deposit/Refund/Escheat) | xong |
| `deposit_param.ak` (committee M-of-N, epoch tăng, NFT bảo toàn) | xong |
| Test onchain | **90/90 pass** (aiken check, 2026-06-08) |
| Offchain builder + plan | xong (mirror invariant) |
| Scripts deploy/e2e (build-mode SUBMIT=false) | xong — plan + dựng tx + tự kiểm, chưa submit |
| Deploy live Preview | một phần — vòng đời cọc đã submit (xem §6 tx thật) |

---

## 3. Test plan

### 3.1 Đã có (onchain — `deposits_test.ak`, 90 test pass)

**Happy v1:** `deposit_new`, `deposit_accumulate`, `deposit_keeps_other_line`, `refund_by_depositor`,
`refund_by_authority_vk`, `refund_by_authority_script`, `refund_keeps_other_line`.

**Negative v1 (A1–A17):**
- A1 double-refund: `refund_double_phantom`, `refund_line_not_deleted`
- A2 sai người: `refund_wrong_recipient`
- A3 vượt amount: `refund_over_amount`
- A4 âm/0: `deposit_negative`, `deposit_zero`
- A5 phantom line: `deposit_phantom_value`
- A6 drain: `deposit_drain_ada`, `refund_drain_other`
- A7 double-sat: `deposit_double_sat`
- A8 refund-phantom: `refund_phantom`
- A9 mint: `deposit_mint`, `refund_mint`
- A10 params: `deposit_param_tamper`, `refund_authority_tamper`
- A11 depositor không ký: `deposit_unsigned_depositor`
- A12 không authority: `refund_no_authority`
- A13 output về ví: `deposit_no_pot_output`
- A14 sửa dòng khác: `refund_tamper_other_line`
- A16 datum rỗng: `deposit_missing_datum`
- A17 dòng trùng khóa: `deposit_dup_line`
- thêm: `deposit_epoch_regress`, `deposit_value_without_ledger`, `refund_underpay_recipient`,
  `refund_delete_keep_value`

**v2 (deposit động + escheat):** `v2_deposit_cattle_dynamic`, `v2_deposit_cucumber_zero`,
`v2_deposit_demand_scaled`, `v2_deposit_client_underpay_fail`, `v2_deposit_fake_tier_fail`,
`v2_deposit_fake_beacon_no_nft_fail`, `v2_deposit_invalid_beacon_fail`,
`v2_deposit_zero_phantom_line_fail`, `v2_escheat_happy`, `v2_escheat_anyone_triggers`,
`v2_escheat_too_early_fail`, `v2_escheat_steal_to_attacker_fail`, `v2_escheat_then_refund_double_fail`,
`v2_escheat_phantom_fail`, `v2_escheat_mint_fail`, `v2_escheat_eat_other_line_fail`,
`v2_escheat_delete_keep_value_fail`, `v2_escheat_param_tamper_fail`, `v2_escheat_to_script_treasury`,
`v2_deposit_beacon_wrong_address_fail`, `v2_deposit_beacon_other_script_fail`,
`v2_deposit_beacon_right_address_ok`.

**Beacon (`deposit_param.ak`):** `deposit_param_happy`, `deposit_param_epoch_not_increasing`,
`deposit_param_insufficient_sigs`, `deposit_param_invalid_clamp`, `deposit_param_threshold_zero_fail`,
`deposit_param_committee_dup_fail`, `deposit_param_double_output_fail`.

**Schedule (`schedule.ak`):** `schedule_cucumber_zero`, `schedule_cattle_high`, `schedule_demand_scales`,
`schedule_unknown_tier_none`, `schedule_valid_param_ok`, `schedule_valid_param_out_of_clamp`,
`schedule_valid_param_negative_base_fail`.

### 3.2 Bằng chứng pass

```
$ aiken check          # 2026-06-08
pass: 90   fail: 0
```
(đếm bằng `aiken check | grep -c '"status": "pass"'` = 90, `"status": "fail"` = 0.)

### 3.3 Còn THIẾU (gap test — cần code)

- **Offchain vitest CHƯA chạy được**: `offchain/node_modules` chưa cài (`vitest` ERR_MODULE_NOT_FOUND).
  Cần `npm install` trong `offchain/` rồi `npx vitest run` để verify codec round-trip + plan invariant.
  Hiện chỉ verify được logic onchain; mirror offchain mới qua đọc code, CHƯA có evidence test chạy.
- **LỖ-1 (epoch dòng mới — cửa sổ hẹp) chưa có test onchain tách riêng** kiểm `get_deposit_epoch` từ
  chối `lower_bound=0` quá khứ + cửa sổ rộng ≥ 1 epoch. Logic có (util.ak:53) + builder đặt cửa sổ
  đúng (builder.ts:149-154), nhưng nên thêm test validator negative `deposit_epoch_window_wide_fail`
  + `deposit_lower_bound_past_fail` để khóa hồi quy.
- **NFT one-shot beacon**: kiểm one-shot ở deploy (offchain), CHƯA có script verify policy script +
  lịch sử mint. Build-mode dùng NFT placeholder `9999`/`5041524d`. Live cần mint one-shot thật.
- **Nhánh authority Script (lifecycle = Script)**: MVP chỉ ép *sự hiện diện* witness (util.ak:187).
  Production cần gắn validator AssetDID thật chứng kiến đồng ý (SPEC §3 C-REF-AUTH).

---

## 4. Bootstrap (deploy instance)

`scripts/01_deploy_pot.ts` (build-mode SUBMIT=false → plan; SUBMIT=true + .env → submit):
1. Compile `deposit_param` + `deposits` validator → script hash + address.
2. Beacon `DepositParam`: bảng phí demo (dưa leo cây/thấp/ngắn=0, bò vật/cao/dài=50 LAMP @1.0×,
   clamp `[0.5×, 2.0×]`). Genesis output mang NFT (live: mint one-shot; build-mode: placeholder).
3. Seed `PotDatum` (sổ rỗng) với v2 params: `deposit_param_policy/name`, `deposit_param_script_hash`
   = hash beacon đã apply (F3), `treasury_credential` (đích escheat), `escheat_after_epoch=6`,
   `ms_per_epoch=86400000` (Preview 1 ngày/epoch), `min_param_epoch=0` (bootstrap chấp mọi beacon;
   DAO nâng sau).
4. Tự kiểm `potValueOk` + `validParam` trước build (SEED-001/BEACON-001).
5. Ghi `deployed.json` cho script 02.

Tham số env: `INSTANCE_ID`, `RESERVED_MIN_ADA`(2 ADA), `LIFECYCLE_AUTH_KIND/HASH`,
`TREASURY_KIND/HASH`, `ESCHEAT_AFTER_EPOCH`, `MS_PER_EPOCH`, `MIN_PARAM_EPOCH`, `DP_NFT_POLICY/NAME`.

---

## 5. E2E vòng đời (`02_deposit_refund_e2e.ts`)

Demo định giá ĐỘNG + vòng đời cọc 0→50→0:
- **Deposit dưa leo** (cây/thấp/ngắn): `planDeposit` đọc beacon → `amount=0` → KHÔNG ghi dòng.
- **Deposit bò** (vật/cao/dài): `amount=50 LAMP` ÉP từ beacon → pot +50, sổ +1 dòng.
- **Refund**: creator rút bò → pot −50, dòng xóa, 50 LAMP về depositor.
- **Escheat**: (plan) entity mồ côi quá `escheat_after` → value về Treasury.

Build-mode plan cả 3 trên datum mô phỏng (tự kiểm bất biến qua plan*). SUBMIT=true dựng + submit
deposit (bò) → refund live.

---

## 6. Dẫn chứng deploy Preview (tx thật)

Vòng đời cọc đã submit trên Preview (CONTRACT/SPEC §6 — anh chốt 2026-06-08):

| Bước | TX hash | Ý nghĩa |
|---|---|---|
| Deploy | `569cb92d…` | beacon (bảng phí dưa leo=0/bò=50) + pot (sổ rỗng) |
| Deposit dưa leo | `70304b1d…` | `amount=0` — cọc 0 hợp lệ, sổ KHÔNG ghi dòng |
| Deposit bò | `b62bb807…` | `amount=50 LAMP` ÉP từ beacon — pot +50, sổ +1 dòng |
| Refund | `ad051344…` | creator rút 50 LAMP, dòng xóa, tiền về enterprise address |

Vòng đời cọc 0→50→0 chứng minh: định giá động (cọc 0 vs 50 từ cùng beacon), creator-refund (tiền về
đúng người tạo), bảo toàn value.

### 6.1 Bẫy thật phát hiện (live)

1. **`reserved_min_ada` phải phủ min-ADA khi pot giữ token.** Khi pot có LAMP, min-UTxO Cardano cao
   hơn pot rỗng → `reserved_min_ada` phải đủ lớn (không thì pot output fail min-UTxO). Đặt
   `RESERVED_MIN_ADA` ≥ min-UTxO của pot có token.
2. **Refund về ENTERPRISE address.** Tiền hoàn tới `VerificationKey(depositor)` không stake-cred
   (enterprise address). `output_sum_to_pkh` đếm theo payment credential = VK(pkh) (util.ak:110) → khớp.
   Builder dùng `credentialToAddress(network, {type:"Key", hash:depositor})` (builder.ts:244) — đúng
   enterprise. (Nếu depositor có stake-cred riêng, vẫn khớp vì đếm theo payment credential.)

---

## 7. Rủi ro + giảm thiểu

| Rủi ro | Giảm thiểu | Trạng thái |
|---|---|---|
| Beacon giả mạo (NFT không one-shot) → định giá lậu | one-shot policy + F3 địa chỉ script + NFT qty==1 | one-shot kiểm ở DEPLOY (gap §3.3) |
| Đầu độc epoch → escheat sớm cướp cọc | cửa sổ hẹp (LỖ-1) + escheat≥1 (LỖ-3) + freshness (LỖ-2) | code có; test LỖ-1 tách còn thiếu |
| Double-refund/escheat | xóa dòng → lần 2 fail | test pass (A1, V8) |
| Drain ADA/token khác | đẳng thức Value tuyệt đối | test pass (A6) |
| Double-satisfaction | đếm theo payment script hash | test pass (A7, REG-4) |
| Treasury (escheat đích) bị đổi né hạn | params_preserved 11 field | test pass (V12) |
| Kẹt vốn vĩnh viễn (DID mồ côi) | escheat public-good về Treasury | code + plan có |

---

## 8. Tiêu chí "xong"

- [x] 90/90 test onchain pass (aiken check).
- [x] Validator 3 nhánh + beacon đầy đủ bất biến CONTRACT §5 + §5b.
- [x] Offchain SDK plan/build + scripts deploy/e2e.
- [x] Vòng đời cọc 0→50→0 submit Preview (tx thật §6).
- [ ] Offchain vitest chạy có evidence (cần `npm install` — gap §3.3).
- [ ] Test LỖ-1 tách riêng (epoch window) khóa hồi quy.
- [ ] NFT one-shot beacon mint thật + script verify policy (live, ngoài build-mode).
- [ ] Nhánh authority Script gắn validator AssetDID thật (v1.1).

---

## 9. Việc còn lại (gaps cần code — tóm tắt)

1. **Cài + chạy offchain vitest** (`offchain/`): verify codec round-trip + plan invariant có evidence.
2. **Test onchain LỖ-1**: `deposit_lower_bound_past_fail` + `deposit_epoch_window_wide_fail`.
3. **NFT one-shot beacon**: minting policy one-shot thật + script verify ở deploy (thay placeholder).
4. **Authority Script production**: gắn validator AssetDID lifecycle (thay MVP "hiện diện witness").
5. **(tùy chọn v1.x)**: batch nhiều op/tx, shard-by-entity-prefix nếu pot nghẽn contention.
