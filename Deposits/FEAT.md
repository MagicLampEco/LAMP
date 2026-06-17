# Deposits — FEAT (Đặc tả tính năng / hành vi)

**Trạng thái:** bản thảo 2026-06-08 (build-mode, chờ anh duyệt). Bám sát
[CONTRACT.md](./CONTRACT.md) (khung interface đã ghim) + [SPEC.md](./SPEC.md) (v1 + v2). KHÔNG mâu
thuẫn. Mọi tham số số học do DAO định được đánh dấu **"tham số mở (DAO định)"**.

> Spec này mô tả **hành vi nhìn thấy được** của Deposits pot: bond hoàn-lại chống rác, ba thao tác
> (Deposit / Refund / Escheat), vai từng caller, trạng thái trước/sau mỗi thao tác. Người không kỹ
> thuật đọc cũng hiểu hệ vận hành ra sao. KHÔNG đi sâu công thức (xem [MATH](./MATH.md)) hay
> datum/redeemer/validator on-chain (xem [TECH](./TECH.md)) hay lộ trình build/deploy (xem
> [EXEC](./EXEC.md)).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

Deposits là **kho cọc hoàn-lại** (refundable bond pot) của hệ MagicLamp trên Cardano. Mục đích duy
nhất: bắt người TẠO một entity (AssetDID con vật / cây / nhóm / hợp đồng) **đặt cọc một khoản LAMP**
→ chống spam tạo entity rác; khi entity kết thúc hợp lệ → **hoàn cọc về đúng người tạo**. Đây là
mô hình **Cardano deposits pot** (key/pool/DRep deposit: mạng GIỮ tiền, hoàn nguyên khi đăng ký bị
thu hồi), KHÔNG phải Pledge (có thể mất), KHÔNG phải Collect (thu hẳn về kho) — CONTRACT §1.

Bốn nhu cầu Deposits giải quyết, không trộn lẫn:

1. **Chống rác có chi phí thật** — tạo entity phải khóa cọc → kẻ spam phải bỏ vốn thật cho mỗi
   entity. Cọc tỉ lệ theo loại tài sản: dưa leo (giá trị thấp) cọc ≈ 0, bò/đất/hợp đồng (giá trị
   cao) cọc đáng kể (CONTRACT §6.1, SPEC §6.1).
2. **An toàn vốn user tuyệt đối** — tiền trong pot vẫn thuộc người gửi về mặt kinh tế (chỉ tạm
   khóa); người tạo LUÔN rút lại được cọc của mình, không ai giam được vốn họ (CONTRACT §4).
3. **Định giá cọc CÓ THẨM QUYỀN, không tin client** — số cọc KHÔNG do app mớm; validator đọc bảng
   phí từ beacon governance (`DepositParam`) và **ÉP** đúng mức theo loại đã khai (CONTRACT §5b).
4. **Không kẹt vốn vĩnh viễn** — entity mồ côi (người tạo không bao giờ đóng vòng đời) sau một số
   epoch → cọc sung công về Treasury, ai cũng dọn được (CONTRACT §6.3, SPEC §6.3).

Mục tiêu cuối của cả dự án: **làm LAMP có giá trị**. Deposits phục vụ bằng cách tạo nhu cầu LAMP
thật (cọc cho tài sản giá trị cao) mà KHÔNG đụng fixed-supply 36 tỷ (tiền chỉ tạm giữ, không
burn — CONTRACT §1, §8).

### 0.2 Cái gì THUỘC Deposits, cái gì KHÔNG

THUỘC:
- Giữ value bond đa-asset trong **1 UTxO pot** (v1: LAMP + lovelace; mở rộng đa-asset).
- Sổ cọc: mỗi cọc là **1 dòng** `DepositLine` trong datum, khóa theo `(entity_id, depositor, policy, name)`.
- Ép: số cọc khớp beacon; hoàn về đúng depositor; sung công về Treasury; mọi bất biến value/sổ.

KHÔNG thuộc (ranh giới — CONTRACT §7):
- **Phán entity sống/chết.** Nguồn sự thật "entity hết vòng đời" là AssetDID / hợp đồng lifecycle.
  Deposits chỉ ép *ai được ký refund*, KHÔNG tự quyết entity còn sống hay không.
- **Treasury accounting / giảm lưu hành.** Bond là tiền tạm giữ của user, KHÔNG vào
  circulating-reduction của Treasury (CONTRACT §8). Escheat là điểm DUY NHẤT tiền rời pot sang
  Treasury — và đó là dòng tiền mới, không phải kế toán Deposits.
- **Định bảng phí cọc.** DAO định qua beacon `DepositParam`; Deposits chỉ ĐỌC.

---

## 1. Vai trò (ai làm gì)

| Vai | Làm gì | Ràng buộc |
|---|---|---|
| **Creator (người tạo entity)** | gọi Deposit để khóa cọc; gọi Refund để tự rút cọc của mình | PHẢI ký tx Deposit (`depositor` = chính họ); là người DUY NHẤT nhận hoàn |
| **lifecycle_authority** | trigger Refund hàng loạt khi entity kết thúc (vd con vật chết, hợp đồng đáo hạn) mà không cần creator online | là `Credential` (VK council/owner HOẶC Script validator AssetDID) ghim trong PotDatum |
| **Bất kỳ ai (public)** | trigger Escheat cho entity mồ côi quá hạn (dọn rác công ích) | tiền ÉP về Treasury cố định → không có động cơ trộm |
| **Committee / keeper governance** | post bảng phí cọc mới (DepositParam beacon) | M-of-N chữ ký; epoch đơn điệu tăng |
| **App / SDK offchain** | dựng tx (`buildDepositTx` / `buildRefundTx` / `buildEscheatTx`) | tự kiểm bất biến trước khi submit (fail-fast) |

Điểm cốt lõi (CONTRACT §4): tiền **LUÔN** về `depositor_pkh` ghi trong dòng, bất kể AI ký. Kẻ tấn
công ký được refund cũng chỉ "giúp" hoàn tiền về đúng người tạo — không cướp được.

---

## 2. Trạng thái pot

Pot là **1 UTxO** ở địa chỉ Script thuần (tách mọi ví). Nó mang:
- **Value**: tổng bond đa-asset + `reserved_min_ada` (lovelace giữ min-UTxO của chính pot).
- **Datum** `PotDatum`: params bất biến (instance_id, accepted_assets, lifecycle_authority,
  reserved_min_ada, beacon NFT policy/name/script_hash, treasury_credential, escheat_after_epoch,
  ms_per_epoch, min_param_epoch) + state thay đổi (`ledger` = danh sách `DepositLine`, `epoch`).

Bất biến nền (luôn đúng giữa các tx — CONTRACT §5, lib `ledger.ak:102` `pot_value_ok`):
> `pot.value(asset) − reserved_min_ada(asset) == Σ số dư mọi dòng cùng asset`.

Tức value pot LUÔN khớp sổ cộng phần giữ min-ADA. Không dòng khống (sổ tăng mà value không tăng),
không value khống (value tăng mà sổ không ghi).

---

## 3. Thao tác Deposit (nạp cọc) — Constr 0

**Ai:** creator (người tạo entity). **PHẢI ký** tx (`depositor` = ví đang ký) — CONTRACT §4,
validator `deposits.ak:92`.

**Đầu vào caller cung cấp:**
- `entity_id` (AssetDID), `depositor` (pkh người tạo), `(policy, name)` asset bond,
- **phân loại**: `(asset_type, value_tier, lifecycle_class)` — khai entity thuộc loại nào,
- `deposit_ref` — trỏ tới beacon `DepositParam` (reference input).

**Số cọc KHÔNG do caller quyết.** Validator đọc beacon qua `deposit_ref`, tra hàng khớp 3 khóa phân
loại, tính `required = base_deposit × demand_mult / Q` và **ÉP** `amount == required`
(deposits.ak:120, schedule.ak:54). Caller chỉ khai *loại*; giá *do governance định*.

**Luồng:**
1. Creator (qua app) chọn entity + khai phân loại.
2. SDK đọc beacon, tính cọc thực sự (`requiredFor`), dựng tx Deposit.
3. Validator kiểm: số khớp beacon, beacon tươi (epoch ≥ min_param_epoch), depositor ký, value pot
   tăng đúng `amount`, sổ ghi/cộng dồn đúng dòng.

**Trạng thái trước → sau:**
- Value pot: `+amount` của asset (asset khác giữ nguyên — không drain).
- Sổ: thêm dòng `(entity_id, depositor, policy, name, amount, dep_epoch, asset_type, value_tier, lifecycle_class)`.
  Nếu dòng cùng khóa đã tồn tại → **cộng dồn** vào dòng đó (idempotent về khóa, không tạo 2 dòng) —
  CONTRACT §3, lib `deposit_ledger_ok` (ledger.ak:230).

**Trường hợp đặc biệt — cọc 0 hợp lệ (dưa leo).** Tài sản giá trị thấp + vòng đời ngắn (cây/thấp/
ngắn) có `base_deposit = 0` → `amount = 0`. Khi đó **KHÔNG ghi dòng** (không value, không sổ): min-ADA
Cardano của entity UTxO đã chống rác (deposits.ak:128-145, SPEC §6.1). Đây là tính năng, không phải
lỗi: dưa leo không cần cọc.

**Dấu epoch chống đầu độc.** Dòng mới đóng dấu epoch lấy từ `validity_range` của tx, kẹp **cửa sổ
hẹp < 1 epoch** (util.ak:53 `get_deposit_epoch`) → creator không bịa được epoch quá khứ để escheat
sớm. Dòng cộng dồn GIỮ epoch cũ — nạp thêm không làm trẻ lại đồng hồ escheat (ledger.ak:172-179).

---

## 4. Thao tác Refund (hoàn cọc) — Constr 1

**Ai (CONTRACT §4, deposits.ak:172-180):** một trong hai nhánh —
- **Nhánh creator**: `depositor` tự ký → tự rút cọc của mình (an toàn vốn — không ai giam được).
- **Nhánh authority**: `lifecycle_authority` thỏa (VK council/owner ký, HOẶC Script validator
  lifecycle chứng kiến bằng input/reference-input) → hệ tự hoàn hàng loạt khi entity kết thúc, không
  cần creator online.

Thiếu cả hai → fail (SPEC §3 A12). Người thứ 3 bất kỳ KHÔNG trigger được.

**Hoàn TRỌN, không một phần (v1).** Refund trả **toàn bộ** số dư dòng `(entity, depositor, asset)`
về `depositor` rồi **XÓA** dòng (CONTRACT §3, SPEC §3 A15). Không có nhánh hoàn một phần — đơn giản
hóa + khóa gaming (rút bớt rồi giữ khóa để rút lại).

**Trạng thái trước → sau:**
- Value pot: `−refund_amount` của asset (asset khác giữ nguyên).
- Sổ: dòng đích **bị xóa hẳn**; mọi dòng khác giữ nguyên (lib `refund_ledger_ok` ledger.ak:337).
- Tiền về: `≥ refund_amount` tới đúng `depositor_pkh` (tổng-khớp per-asset, deposits.ak:204).

**Chống double-refund (CONTRACT §5 INV-NO-DOUBLE-REFUND):** vì refund XÓA dòng, lần refund thứ 2
cùng khóa sẽ fail ngay ở bước "dòng đích phải tồn tại" (deposits.ak:166). 1 cọc hoàn đúng 1 lần.

---

## 5. Thao tác Escheat (sung công entity mồ côi) — Constr 2

**Ai:** bất kỳ ai (dọn rác công ích — SPEC §6.3). Không cần quyền đặc biệt vì tiền đích cố định.

**Khi nào hợp lệ:** entity mồ côi — người tạo không bao giờ đóng vòng đời. Điều kiện onchain
(deposits.ak:238, CONTRACT §6.3):
> `current_epoch ≥ line.epoch + escheat_after_epoch`.

`current_epoch` lấy từ `validity_range.lower_bound` (caller đặt; ledger ép `slot ≥ lower` → không
bịa epoch tương lai được — util.ak:33). `escheat_after_epoch > 0` luôn (cọc tồn ≥ 1 epoch trước khi
escheat được — CONTRACT §5b LỖ-3, deposits.ak:233).

**Trạng thái trước → sau:**
- Value pot: `−escheat_amount` (đối xứng refund, dùng lại `refund_value_ok`).
- Sổ: dòng đích **bị xóa** (dùng lại `refund_ledger_ok`).
- Tiền về: `≥ escheat_amount` tới **`treasury_credential`** cố định (VK hoặc Script —
  deposits.ak:262, util.ak:135). KHÔNG về ví attacker dù ai trigger.

Sau escheat, khóa biến mất → không escheat lại / refund lại được (chống double — SPEC §6.4 V8).

---

## 6. Beacon DepositParam (bảng phí cọc do DAO định)

Là **1 UTxO riêng** mang NFT xác thực (one-shot), đặt ở địa chỉ validator `deposit_param`. Datum
chứa: danh sách `tiers` (mỗi hàng = `(asset_type, value_tier, lifecycle_class) → base_deposit`),
`demand_mult` (hệ số nhu cầu, clamp `[m_min, m_max]`), `epoch`.

**Cập nhật (committee post bảng mới — deposit_param.ak):**
- M-of-N committee ký (`threshold > 0`, committee không key trùng — deposit_param.ak:44-46).
- `epoch` **đơn điệu tăng** (chống rollback về phí thấp khi DAO đã nâng — deposit_param.ak:54).
- Bảng mới phải hợp lệ (`valid_param`: clamp đúng, mọi base ≥ 0 — deposit_param.ak:57).
- NFT bảo toàn (đúng 1 token in/out — deposit_param.ak:62-63).

**Deposit ĐỌC beacon qua reference input (CIP-31, KHÔNG tiêu):** 1 beacon chung cho mọi deposit →
không tranh chấp UTxO. Beacon được xác thực bằng NFT one-shot + đúng địa chỉ script (F3) →
không UTxO giả nào mạo danh bảng phí (CONTRACT §5b TRUST-ROOT, util.ak:164).

**Ý nghĩa thực tế (demo deploy, scripts/01_deploy_pot.ts:50):**
- dưa leo: `(asset_type=1 cây, value_tier=0 thấp, lifecycle_class=0 ngắn)` → 0 LAMP.
- bò: `(asset_type=0 con vật, value_tier=2 cao, lifecycle_class=2 dài)` → 50 LAMP @ 1.0×.
- DAO nâng `demand_mult` 2.0× → toàn bảng scale, bò thành 100 LAMP (schedule.ak test `schedule_demand_scales`).

---

## 7. Vòng đời điển hình (dẫn chứng tx thật Preview)

Vòng đời cọc một entity (deploy → cọc 0 → cọc 50 → hoàn 0):

1. **Deploy** beacon + pot (tx `569cb92d…`): beacon bảng phí (dưa leo=0, bò=50) + pot sổ rỗng.
2. **Deposit dưa leo** (tx `70304b1d…`): khai loại cây/thấp/ngắn → `amount = 0` → pot value giữ
   nguyên, sổ KHÔNG ghi dòng. Chứng minh cọc 0 hợp lệ.
3. **Deposit bò** (tx `b62bb807…`): khai loại con vật/cao/dài → `amount = 50 LAMP` ÉP từ beacon →
   pot `+50 LAMP`, sổ thêm 1 dòng.
4. **Refund** (tx `ad051344…`): creator rút cọc bò → pot `−50 LAMP`, dòng bị xóa, 50 LAMP về
   enterprise address của creator (refund về **enterprise address** — bẫy thật phát hiện, EXEC §rủi ro).

Bẫy thật (EXEC): `reserved_min_ada` phải phủ min-ADA khi pot giữ token (nếu pot có LAMP, min-UTxO
Cardano cao hơn → reserved phải đủ, không thì tx pot output fail).

---

## 8. Phân biệt với Treasury (tránh nhầm 2 mẫu — CONTRACT §8)

| | Treasury custody | Deposits pot |
|---|---|---|
| Khóa dòng sổ | `(bucket_id, asset)` | `(entity_id, depositor, asset)` |
| Tiền thuộc về | kho (đã thu hẳn) | **người gửi** (tạm khóa) |
| Cửa vào | Collect (cut về bucket) | Deposit (khóa nguyên amount, ÉP từ beacon) |
| Cửa ra | Release (Governance gate) | Refund (về đúng depositor) + Escheat (về Treasury) |
| Xóa dòng | KHÔNG (chỉ giảm số dư) | **CÓ** (refund/escheat xóa dòng → chống double) |
| fixed-supply | đổi trạng thái sang accounting | không đụng (tiền tạm giữ) |

---

## 9. Tham số mở (DAO định)

- Bảng `tiers` + `base_deposit` mỗi loại (beacon DepositParam) — DAO định, nâng qua committee.
- `demand_mult` + clamp `[m_min, m_max]` — DAO scale toàn bảng theo nhu cầu.
- `escheat_after_epoch` — số epoch mồ côi trước khi sung công (deploy demo = 6, > 0 bắt buộc).
- `lifecycle_authority`, `treasury_credential` — ghim lúc deploy instance; bảo toàn qua mọi tx.

---

## 10. Trạng thái hiện tại + gap

- v1 (Deposit/Refund) + v2 (deposit động + escheat + creator-refund) đã code đầy đủ trong
  validator + lib + offchain SDK + scripts deploy/e2e. Test onchain 90/90 pass (xem [EXEC](./EXEC.md)).
- **MVP/stub còn lại (v1.1):**
  - Nhánh authority Script (lifecycle_authority = Script) v1 chỉ ép **sự hiện diện** input/ref-input
    ở Script(hash) (util.ak:187 `witnessed_by_script`) — production cần gắn validator AssetDID thật
    chứng kiến đồng ý (SPEC §3 C-REF-AUTH ghi rõ "v1 đơn giản, đủ an toàn cho self-test").
  - NFT one-shot cho beacon: kiểm one-shot ở **deploy** (offchain), KHÔNG kiểm lại mỗi tx Deposit
    (CONTRACT §5b TRUST-ROOT). Deploy script build-mode dùng NFT placeholder demo; live cần mint
    one-shot thật trước.
  - Refund một phần: KHÔNG có (v1 hoàn trọn — quyết định khóa gaming, không phải thiếu sót).
