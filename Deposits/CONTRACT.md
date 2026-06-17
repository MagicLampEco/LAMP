# Deposits — CONTRACT (interface khóa)

**Trạng thái:** khung interface 2026-06-08 (build-mode, chờ anh duyệt). Đây là **xương sống** mà onchain
↔ offchain bám: schema datum, redeemer, bất biến. KHÔNG đổi schema/bất biến ở đây mà không soát chéo.

Gốc: mẫu custody+ledger+value-preservation đã có ở `Treasury/` (đọc `Treasury/CONTRACT.md` +
`Treasury/onchain/lib/magiclamp/treasury/{types,collect,release}.ak`). Deposits **tái dùng cùng mẫu
custody-pot** (value trong 1 UTxO, sổ là dòng trong datum — KHÔNG mỗi entity 1 UTxO) nhưng ngữ nghĩa
**khác Treasury và khác Pledge**.

---

## 1. Deposits pot là gì — bản chất DEPOSIT (hoàn lại), KHÔNG phải Pledge

| Khái niệm | Hành vi tiền | Khi nào trả lại |
|---|---|---|
| **Collect** (Treasury) | THU hẳn về kho, đổi trạng thái LAMP sang accounting | Không trả ngược cho người trả; chỉ Governance chi lại |
| **Pledge** (cam kết) | khóa để chứng minh cam kết tương lai | tùy điều kiện cam kết, có thể mất (slash) |
| **Deposit** (module này) | **GIỮ tạm** một khoản bond chống rác | **TRẢ LẠI ĐÚNG amount** khi entity đảo ngược/hết vòng đời |

Deposits pot = **bond hoàn-lại chống rác**, đúng mô hình **Cardano deposits pot** (key/pool/DRep deposit:
mạng GIỮ, hoàn nguyên khi đăng ký bị thu hồi). Mục đích: bắt người tạo entity (AssetDID con vật/cây,
nhóm, hợp đồng) **đặt cọc 1 khoản LAMP** → chống spam tạo entity rác; khi entity kết thúc hợp lệ →
**hoàn cọc**. Vì tiền chỉ GIỮ tạm nên **không đụng tới fixed-supply / không đụng circulating-accounting
của Treasury** (LAMP trong pot vẫn thuộc người gửi về mặt kinh tế — chỉ tạm khóa).

---

## 2. Pot custody — accounting, KHÔNG mỗi entity 1 UTxO (chống bloat)

- 1 UTxO **pot** giữ toàn bộ value bond đa-asset (v1: LAMP; mở rộng được sang asset khác).
- **Mỗi deposit = 1 DÒNG SỔ** trong datum pot: `(entity_id, depositor_pkh, policy, name, amount, epoch)`.
  KHÔNG tạo UTxO/entity → tránh bloat + min-ADA nhân theo số entity (có thể hàng triệu con vật/cây).
- Pot address PHẢI là **Script thuần tách ví** (mẫu Treasury §6): nếu pot == ví thì bất biến value
  thỏa mãn rỗng.

**Phân biệt với Treasury ledger:** Treasury ledger khóa theo `(bucket_id, asset)` (tiền đã thuộc kho,
gộp theo bucket). Deposits ledger khóa theo **`(entity_id, depositor_pkh, asset)`** — vì mỗi dòng phải
**hoàn về đúng người**, không gộp được. Khóa dòng = `(entity_id, depositor, policy, name)`.

---

## 3. Hai cửa: Deposit / Refund

| Redeemer | Ý nghĩa |
|---|---|
| `Deposit { entity_id, depositor, policy, name, amount }` | khóa `amount` của asset → thêm dòng sổ; value pot **tăng đúng amount** |
| `Refund { entity_id, depositor, policy, name }` | trả số dư dòng `(entity_id, depositor, asset)` về `depositor` → **xóa dòng**; value pot **giảm đúng amount** |

- **Deposit**: depositor cấp `amount` từ ví; pot output value = pot input value ⊕ `amount(asset)`; sổ
  thêm dòng `(entity_id, depositor, asset, amount, epoch)`. Nếu dòng `(entity_id, depositor, asset)` đã
  tồn tại → **cộng dồn** vào dòng đó (idempotent về khóa, không tạo 2 dòng cùng khóa). KHÔNG cho `amount ≤ 0`.
- **Refund**: trả **toàn bộ** số dư của dòng `(entity_id, depositor, asset)` về `depositor` (v1: hoàn
  trọn, không hoàn một phần — đơn giản hóa, khóa chống gaming). Xóa dòng khỏi sổ; pot output value =
  pot input value ⊖ `amount(asset)`. Người nhận = **`depositor_pkh` ghi trong dòng** (không ai khác).

---

## 4. Quyền trigger (authority) — AI được làm gì

Đây là trục an toàn vốn quan trọng nhất. Phân tích đối kháng (§ self-attack SPEC):

- **Deposit**: bất kỳ ai cũng có thể NẠP cọc cho 1 entity (nạp tiền vào pot không hại ai — chỉ thêm
  value + thêm dòng ghi nợ pot với chính người nạp). `depositor` trong dòng = người sẽ được hoàn. v1:
  ép `depositor` PHẢI ký tx Deposit (`extra_signatories`) — chống ghi tên người khác làm depositor để
  bẫy/gán nợ sai (tuy vô hại tiền, nhưng giữ sổ trung thực: depositor là người thật bỏ tiền).
- **Refund**: chỉ hoàn khi entity thật sự hết vòng đời. **Ai xác nhận "hết vòng đời"?** Đây là điều
  kiện NGOÀI module Deposits (thuộc AssetDID lifecycle / hợp đồng). v1 chọn **Model A — cổng authority
  qua chữ ký** (mirror Treasury Model A đọc cờ Governance, nhưng đơn giản hơn cho bond):
  - Refund hợp lệ ⇔ **`depositor` ký** (người bỏ tiền tự rút lại cọc của mình) **HOẶC** một
    `lifecycle_authority` (param instance — vd validator AssetDID/hợp đồng, hoặc council key) ký.
  - Lý do 2 nhánh: (a) người gửi luôn có quyền rút cọc CỦA MÌNH (đây là tiền của họ, chỉ tạm khóa —
    không ai được giam vốn user); (b) `lifecycle_authority` cho phép hệ thống tự hoàn hàng loạt khi
    entity kết thúc (vd con vật chết, hợp đồng đáo hạn) mà không cần depositor online.
  - **KHÔNG cho người thứ 3 bất kỳ** trigger refund tới túi mình: tiền LUÔN về `depositor_pkh` ghi
    trong dòng, bất kể ai ký. Kẻ tấn công ký được cũng chỉ "giúp" hoàn tiền về đúng depositor.

> Quyết định (4 trục): an toàn vốn user (depositor luôn rút được cọc mình) + decentralize được
> (lifecycle_authority có thể là validator, không bắt buộc multisig người) + đơn giản (2 nhánh ký, không
> kéo cả Governance proposal cho mỗi con vật) + chống gaming (tiền chỉ về depositor ghi sổ).

---

## 5. Bất biến lõi (ÉP onchain — mọi nhánh)

- **INV-SUPPLY (value-preservation tuyệt đối):** `Σ pot_out.value = Σ pot_in.value ± amount`, KHÔNG
  mint/burn (`tx.mint == 0`). Deposit: `+amount(asset)`. Refund: `−amount(asset)`. Đẳng thức Value
  tuyệt đối khóa cả 2 chiều (asset đụng đổi đúng amount; asset khác giữ nguyên — chống drain ADA/token).
- **INV-LEDGER (sổ ↔ value):** `∀ asset a:  pot.value(a) − reserved_min_ada(a) == Σ_dòng ledger[a]`.
  Mỗi tx ép **incremental**: dòng đụng đổi đúng Δ, dòng khác giữ nguyên, không thêm/xóa dòng lén.
- **INV-REFUND-WHO:** Refund trả về **đúng `depositor_pkh`** ghi trong dòng (Σ output tới depositor ≥
  amount), và `depositor ≠ pot` (tiền THẬT rời pot).
- **INV-REFUND-AMOUNT:** Refund trả **đúng** số dư dòng (không vượt: không rút > đã gửi; hoàn trọn dòng).
- **INV-NO-DOUBLE-REFUND:** 1 dòng deposit hoàn **đúng 1 lần** — refund **XÓA** dòng. Sau refund, khóa
  `(entity_id, depositor, asset)` không còn trong sổ ⇒ không refund lại được (refund-chưa-deposit fail).
- **INV-NO-REFUND-PHANTOM:** Refund-khi-chưa-deposit fail — dòng đích PHẢI tồn tại trong `ledger_in`.
- **INV-NO-NEG:** Deposit `amount > 0`; cấm dòng âm; cấm bơm số dư khống.
- **INV-PARAMS:** params instance (`instance_id`, `accepted_assets`, `lifecycle_authority`,
  `reserved_min_ada` policy) bảo toàn; chống double-satisfaction (đếm theo **payment script hash**, đúng
  1 pot input + 1 pot output — bài học C1/C2/M1 Distribution).

---

## 5b. Bất biến đồng hồ & beacon (v2 — chống đầu độc epoch / stale fee)

Deposit ĐỘNG đọc bảng phí từ beacon `DepositParam` (reference input, CIP-31) và đóng dấu
`epoch` lên dòng mới. 3 lỗ phải khóa:

- **INV-DEPOSIT-EPOCH (LỖ-1 — cửa sổ epoch hẹp):** epoch đóng dấu dòng MỚI lấy từ
  `validity_range`, ÉP **cả 2 cận hữu hạn** + cửa sổ **HẸP `upper − lower < ms_per_epoch`**;
  `dep_epoch = lower / ms_per_epoch`. Ledger chỉ ép `slot ≥ lower`, nên một-cận (chỉ
  `validFrom`) cho attacker đặt `lower = 0` (quá khứ) → `dep_epoch` giả nhỏ → dòng đóng dấu
  epoch quá khứ → escheat SỚM (cướp cọc user). Kẹp cận trên `< 1 epoch` khiến `lower = 0`
  chỉ hợp lệ quanh genesis, không dùng cho cọc thật → epoch ghim SÁT now. (Escheat dùng
  one-cận `validFrom` là ĐÚNG idiom gating "đã qua mốc": đặt `lower` nhỏ không giúp attacker
  vì điều kiện là `current_epoch ≥ mốc`.)
- **INV-BEACON-FRESH (LỖ-2 — freshness):** Deposit ÉP `beacon.epoch ≥ min_param_epoch`
  (param pot). Chống bind bảng phí CŨ (stale): DAO nâng phí ở epoch mới → attacker không
  tham chiếu beacon epoch thấp để cọc ít hơn lịch hiện hành. `min_param_epoch` đơn điệu
  tăng theo mỗi lần governance nâng (cập nhật qua nâng cấp pot params, bảo toàn mọi tx khác).
- **INV-ESCHEAT-MIN (LỖ-3):** `escheat_after_epoch > 0` (KHÔNG `== 0`) — cọc tồn **≥ 1
  epoch** trước khi escheat được; `== 0` cho phép escheat NGAY trong epoch gửi (cướp cọc vừa nạp).

**TRUST-ROOT beacon `deposit_param` NFT — BẮT BUỘC minting policy ONE-SHOT.**
Xác thực beacon = đúng 1 NFT `(deposit_param_policy, deposit_param_name)` ở đúng địa chỉ
`Script(deposit_param_script_hash)` (F3). Tính an toàn của TOÀN BỘ định giá cọc dựa trên giả
định **NFT này là duy nhất, không đúc lại được** — nếu policy cho phép mint nhiều bản, attacker
đúc NFT thứ 2 mang datum giả (định giá cọc = 0) → né phí. Vì vậy `deposit_param_policy` PHẢI
là **one-shot minting policy** (mint đúng 1 lần, gắn 1 UTxO seed cố định — mẫu Cardano CIP-68
one-shot / consume-utxo). Điều này **kiểm lúc bootstrap/deploy** (off-chain xác minh policy
script + lịch sử mint), KHÔNG kiểm lại mỗi tx Deposit (reference input chỉ thấy NFT, không
thấy policy logic). Sai sót ở bước này phá toàn bộ trust-root → kiểm nghiêm ở deploy.

---

## 6. Asset & ràng buộc

- `accepted_assets`: v1 = LAMP (`policy = LAMP_POLICY`, `name = #"744c414d50"`, 6 decimals → 1 LAMP =
  10^6 oil). Mở rộng đa-asset như Treasury.
- `reserved_min_ada`: lovelace giữ cho min-UTxO của chính pot, KHÔNG ghi sổ deposit (chỉ áp lovelace).
- Pot address tách mọi ví tạo output cùng tx (mẫu Treasury §6).

---

## 7. Phụ thuộc & ranh giới

- **AssetDID / hợp đồng lifecycle**: NGUỒN sự thật "entity hết vòng đời". Deposits chỉ ép *ai ký được
  refund*, KHÔNG tự phán entity sống/chết. `lifecycle_authority` là điểm cắm (validator hash hoặc pkh).
- **KHÔNG đụng Treasury accounting**: bond là tiền tạm giữ của user, không vào circulating-reduction.
- Caller (offchain SDK): app tạo entity gọi `buildDepositTx`; lifecycle/owner gọi `buildRefundTx`.

---

## 8. Phân biệt với Treasury (tránh nhầm 2 mẫu)

| | Treasury custody | Deposits pot |
|---|---|---|
| Khóa dòng sổ | `(bucket_id, asset)` | `(entity_id, depositor, asset)` |
| Tiền thuộc về | kho (đã thu hẳn) | **người gửi** (tạm khóa) |
| Cửa vào | `Collect` (cut về bucket) | `Deposit` (khóa nguyên amount) |
| Cửa ra | `Release` (Governance gate, chi tới `to` tùy proposal) | `Refund` (về **đúng depositor**, authority gate) |
| Xóa dòng | KHÔNG (chỉ giảm số dư) | **CÓ** (refund xóa dòng → chống double-refund) |
| fixed-supply | đổi trạng thái sang accounting | không đụng (tiền chỉ tạm giữ) |
