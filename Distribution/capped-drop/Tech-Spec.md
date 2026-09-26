# Capped Drop — SPEC TECH (kỹ thuật on-chain)

**Doctype:** MagicLamp Protocol — Onchain Spec (Technical / Implementation)
**Version:** v3 "Capped Drop" — chỉ số cộng dồn + trần lõm + cắt ngọn
**Updated:** 2026-09-22
**Nguồn chuẩn (interface contract):** [`CONTRACT.md`](./CONTRACT.md) — **v3**
**Hành vi:** [`Feat-Spec.md`](./Feat-Spec.md) — **v3**
**Chứng minh toán:** [`Math-Spec.md`](./Math-Spec.md) — **v3**

> ⚠ **TỆP NÀY MÔ TẢ TRẠNG THÁI ĐÍCH, KHÔNG MÔ TẢ MÃ ĐANG CHẠY.** Đo 2026-09-22: mã trong
> `Distribution/onchain/` vẫn là **v2** — `types.ak` ▸ `BeaconDatum` còn trường `drop_value`,
> `ClaimAccountDatum` chưa có `index_at_start`, `TreasuryDatum` chưa có `total_redeemed`.
> Mục nào đã lệch mã đều mang nhãn **`CHƯA CÓ TRONG MÃ`** kèm con trỏ. Đừng đọc một dòng ở đây
> thành một dòng đã hiện thực.
>
> ⚠ **v3 ĐÒI GENESIS MỚI.** Aiken giải mã nghiêm ngặt theo **số trường**, nên thêm trường vào
> `ClaimAccountDatum` và `TreasuryDatum` làm mọi UTxO đang sống không đọc được bằng validator
> v3, và cụm này **không có redeemer nâng cấp**. Không có đường di trú tại chỗ.

Tài liệu này đặc tả **cấu trúc kỹ thuật**: Aiken types → Plutus Data encoding, danh sách bất biến mỗi redeemer, luồng eUTXO, và thứ tự deploy + tham số. Mọi phát biểu dẫn file:line cụ thể.

---

## 1. Tổng quan 4 validator

| # | Validator | File | Mục đích |
|---|---|---|---|
| V1 | `beacon_nft` | `validators/beacon_nft.ak` | One-shot minting policy: mint đúng 1 authenticity NFT "DROP" |
| V2 | `beacon` | `validators/beacon.ak` | Spend validator: committee cập nhật DropParam `D` mỗi epoch |
| V3 | `claim_account` | `validators/claim_account.ak` | Spend validator: per-wallet, 2 redeemer Claim + Redeem |
| V4 | `treasury` | `validators/treasury.ak` | Spend validator: giữ LAMP pool, release theo Redeem |

**Luồng phụ thuộc deploy:**
```
V1 (beacon_nft) → policyId BEACON_NFT_POLICY
  → dùng khi tạo Beacon UTxO ban đầu
V2 (beacon)     → params: committee, threshold, BEACON_NFT_POLICY
  → cần BEACON_NFT_POLICY từ V1
V3 (claim_account) → params: committee, threshold, ms_per_epoch, LAMP_POLICY, LAMP_NAME, BEACON_NFT_POLICY
  → cần BEACON_NFT_POLICY từ V1
V4 (treasury)   → params: CLAIM_ACCOUNT_HASH, LAMP_POLICY, LAMP_NAME
  → cần script hash của V3
```

---

## 2. Aiken Types → Plutus Data Encoding

### 2.1 Quy tắc chung (Aiken → PlutusV3)

Aiken biên dịch sang Plutus Data theo quy tắc:
- **Record** (duy nhất constructor): `Constr(0, [fields…])`
- **Enum** (nhiều constructor): `Constr(index, [fields…])` với `index` = thứ tự khai báo tính từ 0
- `Int` → `Integer`, `ByteArray` → `Bytes`, `List<a>` → `List`
- Field lồng nhau encode đệ quy

Nguồn: `onchain/lib/magiclamp/lampdist/types.ak`

---

### 2.2 `ClaimAccountDatum`

**Aiken — v3** (`CHƯA CÓ TRONG MÃ`; bản đang chạy là `types.ak` ▸ `ClaimAccountDatum`, 5 trường):
```
pub type ClaimAccountDatum {
  owner           : ByteArray,   // PKH chủ ví
  entitlement     : Int,         // E — tổng LAMP (oildrop)
  redeemed        : Int,         // đã nhận tích lũy (oildrop)
  start_epoch     : Int,         // t0
  drops_per_epoch : Int,         // GHIM == 1 (C-ACC-DPE) — giữ trường, khoá giá trị
  index_at_start  : Int,         // a₀ — chỉ số beacon chụp lúc MỞ (TRƯỜNG MỚI, Ở CUỐI)
}
```

**Plutus Data encoding:**
```
Constr(0, [
  Bytes(owner),              -- field 0: PKH 28 bytes
  Integer(entitlement),      -- field 1: E (oildrop, non-negative)
  Integer(redeemed),         -- field 2: đã rút tích lũy (oildrop)
  Integer(start_epoch),      -- field 3: t0
  Integer(drops_per_epoch),  -- field 4: BẮT BUỘC == 1
  Integer(index_at_start),   -- field 5: a₀ (TRƯỜNG MỚI)
])
```

**Trường mới đặt ở CUỐI** để chỉ số Constr của năm trường đầu không đổi. Điều đó **không** làm
datum cũ đọc được bằng validator v3 — Aiken ép đúng số trường — nó chỉ giữ cho codec offchain và
mọi công cụ đọc datum khỏi phải đánh số lại.

**Bất biến datum:** `0 ≤ redeemed ≤ entitlement` · `drops_per_epoch == 1` · `entitlement ≥ 0` ·
`index_at_start ≥ 0`.

> ⚠ `index_at_start` là trường dễ hiện thực sai nhất của v3. Nó phải nằm trong **danh sách ép
> bất biến** ở nhánh `Redeem`, không phải được suy ra là bất biến vì "không ai đụng tới nó".
> Ghi đè được nó nghĩa là người rút tự đặt lại gốc thời gian của chính mình, và bất biến trung
> tâm (`vested` không giảm) mất một trong ba chân — xem [`Math-Spec.md`](./Math-Spec.md) §3.

---

### 2.3 `ClaimAccountRedeemer`

**Aiken — v3** (`Redeem` nay MANG tham số; bản đang chạy là `Redeem` không tham số —
`types.ak` ▸ `ClaimAccountRedeemer`):
```
pub type ClaimAccountRedeemer {
  Claim  { amount: Int }   -- constructor index 0
  Redeem { amount: Int }   -- constructor index 1 — THAM SỐ MỚI
}
```

**Plutus Data encoding:**

| Redeemer | Encoding |
|---|---|
| `Claim { amount }` | `Constr(0, [Integer(amount)])` |
| `Redeem { amount }` | `Constr(1, [Integer(amount)])` — **đổi từ `Constr(1, [])`** |

**Vì sao `Redeem` phải mang số tiền.** v2 để validator tự tính `vested − redeemed` rồi trả trọn.
Với cắt ngọn, "trọn" không còn là một số xác định trước khi biết trần của lượt này, và quan trọng
hơn: người dùng phải **chọn được** rút ít hơn (gộp phí, chia nhiều lượt). Nên hình dạng đúng là
người dựng XIN — validator KẸP, đúng khuôn `Claim`.

> ⚠ Đây là **thay đổi phá vỡ tương thích ở tầng redeemer**, không chỉ ở tầng datum. Mọi builder
> offchain dựng `Constr(1, [])` sẽ bị từ chối. Đổi cùng lượt với codec datum.

---

### 2.4 `BeaconKind`

**Aiken** (`types.ak:23-26`):
```
pub type BeaconKind {
  DropParam   -- constructor index 0 (duy nhất hiện tại)
}
```

**Plutus Data encoding:**

| Kind | Encoding |
|---|---|
| `DropParam` | `Constr(0, [])` |

**Asset name:** `util.beacon_name(DropParam)` → `#"44524f50"` = "DROP" (ASCII). (`util.ak:123-126`)

---

### 2.5 `BeaconDatum`

**Aiken — v3** (`CHƯA CÓ TRONG MÃ`; bản đang chạy là `types.ak` ▸ `BeaconDatum`, 3 trường với
`drop_value`):
```
pub type BeaconDatum {
  epoch          : Int,               // cửa sổ lượt post này (C-BCN-3)
  kind           : BeaconKind,
  index          : Int,               // A tại mốc `epoch` — CỘNG DỒN, CHỈ TĂNG
  rate_root      : Int,               // w — NGUYÊN THUỶ, W := w²
  trim_num       : Int,               // κ tử
  trim_den       : Int,               // κ mẫu
  speed_policies : List<ByteArray>,   // MÓC — RỖNG ở lượt đúc này
}
```

**Plutus Data encoding:**
```
Constr(0, [
  Integer(epoch),            -- field 0
  Constr(0, []),             -- field 1: kind = DropParam
  Integer(index),            -- field 2
  Integer(rate_root),        -- field 3
  Integer(trim_num),         -- field 4
  Integer(trim_den),         -- field 5
  List([]),                  -- field 6: speed_policies, RỖNG
])
```

**Giá trị đóng băng ở genesis v3:**

| trường | giá trị | ghi chú |
|---|---|---|
| `index` | `0` | mốc gốc của chỉ số cộng dồn |
| `rate_root` | **`77460`** | NGUYÊN THUỶ. `W := w² = 6.000.051.600` oildrop |
| `trim_num` / `trim_den` | `1` / `1000` | lưu hành 1 tỷ ⟹ một lượt rút tối đa 1 triệu LAMP |
| `speed_policies` | `[]` | danh sách rỗng ⟹ không đòi reference input nào |

> ⛔ **`rate_root` KHÔNG được suy từ một `W` chốt trước.** Lấy `⌊√W⌋` cho `77459`, và với giá trị
> đó pot 6 tỷ chạm `entitlement` ở cửa sổ **1001** thay vì 1000 — trượt mốc hiệu chỉnh đúng một
> cửa sổ. Chiều đúng là ngược lại: chốt `w`, rồi `W := w²`.
> [`Math-Spec.md`](./Math-Spec.md) §7 (M-ROOT-CEIL).
>
> Không đọc chỗ này thành *"tài khoản không bao giờ rút hết"* — `A_span` tăng không chặn nên
> không có đuôi bụi vĩnh viễn. Cái mất là **một cửa sổ**, không phải một khoản khoá vốn.

> **`trim_floor` KHÔNG nằm trong datum này.** Nó là hằng trong `constants.ak`
> (`C-RDM-TRIM-FLOOR`). Đưa nó vào datum thì hạ về 0 dựng lại đúng điểm hấp thụ mà nó sinh ra để
> phá. CONTRACT v3 §4 mục 4.

---

### 2.6 `BeaconRedeemer`

**Aiken** (`types.ak:36-39`):
```
pub type BeaconRedeemer {
  PostBeacon   -- constructor index 0
}
```

**Plutus Data encoding:**

| Redeemer | Encoding |
|---|---|
| `PostBeacon` | `Constr(0, [])` |

---

### 2.7 `TreasuryDatum`

**Aiken — v3** (bản đang chạy có **2** trường, không phải 1 như bản v2 của tệp này viết — xem
`types.ak` ▸ `TreasuryDatum`; `total_redeemed` là trường thứ ba, `CHƯA CÓ TRONG MÃ`):
```
pub type TreasuryDatum {
  committee_hash         : ByteArray,
  outstanding_entitlement: Int,   // sổ cái CÒN NỢ = Σ(entitlement − redeemed)
  total_redeemed         : Int,   // ĐÃ PHÁT RA tích luỹ, CHỈ TĂNG (TRƯỜNG MỚI, Ở CUỐI)
}
```

**Plutus Data encoding:**
```
Constr(0, [
  Bytes(committee_hash),           -- field 0
  Integer(outstanding_entitlement),-- field 1
  Integer(total_redeemed),         -- field 2: TRƯỜNG MỚI
])
```

**Hai sổ, hai nghĩa ngược nhau — đừng gộp:** `outstanding_entitlement` là **còn nợ** (tăng khi
cấp, GIẢM khi rút); `total_redeemed` là **đã phát ra** (chỉ tăng, không bao giờ giảm).
`total_redeemed` là mẫu số của cắt ngọn, nên một hiện thực nhầm nó thành "đang lưu hành trừ đi
thứ gì đó" sẽ làm trần rút **co lại theo thời gian** thay vì nở ra.

> `total_redeemed` **không tốn thêm carrier**: mọi `Redeem` đã bắt buộc co-spend UTxO kho rồi,
> nên đọc và ghi nó là miễn phí về mặt cấu trúc giao dịch.

---

### 2.8 `TreasuryRedeemer`

**Aiken** (`types.ak:45-48`):
```
pub type TreasuryRedeemer {
  ReleaseForRedeem   -- constructor index 0
}
```

**Plutus Data encoding:**

| Redeemer | Encoding |
|---|---|
| `ReleaseForRedeem` | `Constr(0, [])` |

---

### 2.9 `BeaconNftRedeemer`

**Aiken** (`validators/beacon_nft.ak:38-40`):
```
pub type BeaconNftRedeemer {
  MintGenesis   -- constructor index 0
}
```

**Plutus Data encoding:**

| Redeemer | Encoding |
|---|---|
| `MintGenesis` | `Constr(0, [])` |

---

## 3. Validator Logic — Bất biến mỗi Redeemer

### 3.1 V1: `beacon_nft` — `mint/MintGenesis`

**Tham số validator:** `genesis_ref: OutputReference`

**Invariant list:**

| ID | Phát biểu | Code |
|---|---|---|
| **W-BNT-1** | Tx phải consume đúng `genesis_ref` trong inputs | `beacon_nft.ak:46` |
| **W-BNT-2** | `assets.tokens(tx.mint, policy_id)` có đúng 1 asset name | `beacon_nft.ak:52-53` |
| **W-BNT-3** | Asset name đó là `beacon_name(DropParam)` = `#"44524f50"` với quantity = 1 | `beacon_nft.ak:55-56` |
| **W-BNT-4** | `else(_) { fail }` chặn mọi purpose ngoài `mint` (kể cả burn qua mint âm) | `beacon_nft.ak:61-63` |

**Ghi chú burn:** Không có biến thể Burn trong redeemer. Bất kỳ mint âm (burn) đều là redeemer `MintGenesis` với quantity âm, nhưng W-BNT-3 ép `quantity_of == 1` → từ chối. Supply = 1 bất biến vĩnh viễn.

---

### 3.2 V2: `beacon` — `spend/PostBeacon`

**Tham số validator:** `committee: List<ByteArray>`, `threshold: Int`, `beacon_nft_policy: ByteArray`, `ms_per_epoch: Int`

> ⚠ **Ba mã định danh trong bảng này từng mang HAI nghĩa trong cùng tài liệu.** Bản trước
> đặt `C-BCN-3/4/5` cho *kind bất biến* và *NFT bảo toàn*, trong khi §3.3 bên dưới đặt đúng
> ba mã ấy cho *nhãn cửa sổ*, *biên cứng của D* và *trần ±10%*. Mã định danh là thứ người
> khác trích dẫn, nên trùng mã là hỏng ở chiều im lặng nhất: cả hai chỗ đều tra ra một dòng
> có thật. Nay lấy theo MÃ NGUỒN (`beacon.ak`), và hai chốt NFT đổi sang `C-BCN-NFT1/NFT2`.

**Tiền điều kiện chung (áp dụng trước khi phân nhánh redeemer):**

| ID | Phát biểu | Code |
|---|---|---|
| **C-MINT-0** | `tx.mint` là zero — beacon validator không liên quan mint | `beacon.ak` ▸ `assets.is_zero(tx.mint)` |
| **C-BCN-DS1** | Đúng 1 input tại script hash (chống double-satisfaction C1) | `beacon.ak` ▸ `count_inputs_at_script` |
| **C-BCN-DS2** | Đúng 1 output tại script hash | `beacon.ak` ▸ `count_outputs_at_script` |

**Bất biến `PostBeacon`** — thứ tự trong bảng là thứ tự THẬT trong thân hàm, và thứ tự đó
quyết định mệnh đề nào từ chối trước:

| ID | Phát biểu | Code |
|---|---|---|
| **C-BCN-1** | `committee_approved(committee, threshold, sigs)` (≥ threshold NGƯỜI trong committee ký) | `beacon.ak` ▸ `committee_approved` |
| **C-BCN-2** | `out_datum.epoch > datum.epoch` (epoch đơn điệu tăng) **và** `out_datum.kind == datum.kind` | `beacon.ak` ▸ khối C-BCN-2 |
| **C-BCN-3** | `out_datum.epoch == get_epoch_strict(tx, ms_per_epoch)` — nhãn PHẢI là cửa sổ tx chạy trong đó | `beacon.ak` ▸ khối C-BCN-3 |
| **C-BCN-4** | `drop_value_min ≤ out_datum.drop_value ≤ drop_value_max` | `beacon.ak` ▸ khối C-BCN-4 — **v2; v3 thay bằng C-BCN-5b trên `rate_root`** |
| **C-BCN-5** | `abs_diff(D_out, D_in) × q ≤ D_in × max_drop_delta_q` (±10% một lượt) | `beacon.ak` ▸ khối C-BCN-5 |
| **C-BCN-NFT1** | `nft_in == 1` (NFT có trong input) | `beacon.ak` ▸ khối authenticity NFT |
| **C-BCN-NFT2** | `nft_out == 1` (NFT bảo toàn sang output, không bị rút) | `beacon.ak` ▸ khối authenticity NFT |

**Tại sao cần W-BNT / C-BCN-NFT1/NFT2:** Kẻ tấn công có thể tạo UTxO giả tại cùng beacon address với datum bịa. Cả `claim_account` và `beacon` chỉ tin UTxO mang authenticity NFT. Validator giả không thể mint NFT (one-shot đã dùng).

**C-BCN-4 đứng TRƯỚC C-BCN-5**, và điều đó có hệ quả cho cách đọc bộ kiểm: một ca đặt D ra
ngoài biên cứng thường cũng vượt ±10%, nên nó đỏ mà không chứng minh cái biên được ghim. Hai
ca phân biệt được hai chốt là `beacon_floor_is_the_binding_clause` và
`beacon_ceiling_is_the_binding_clause` — đo 2026-09-17: gỡ hẳn C-BCN-4 thì đúng hai ca đó đỏ,
mọi ca khác vẫn xanh.

**Phạm vi đúc lại khi thêm tham số cho `beacon`:** bốn script, không phải một —
{`beacon_nft`, `beacon`, `claim_account`, `treasury`}. Đổi tham số đổi địa chỉ beacon; DROP NFT
đang ghim beacon không rời được địa chỉ cũ (không nhánh nào cho NFT ra khỏi script) và
`beacon_nft` là one-shot nên không đốt được ⇒ phải đúc DROP NFT mới ⇒ `beacon_nft_policy` đổi
⇒ hai validator nhận policy đó đổi hash theo.

---

### 3.3 V3: `claim_account` — 2 redeemer

**Tham số validator:** `committee`, `threshold`, `ms_per_epoch`, `lamp_policy`, `lamp_name`, `beacon_nft_policy`

**Tiền điều kiện chung:**

| ID | Phát biểu | Code |
|---|---|---|
| **C-MINT-0** | `tx.mint` là zero | `claim_account.ak:39` |
| **C-RDM-DS1** | Đúng 1 input tại script hash | `claim_account.ak:43` |
| **C-RDM-DS2** | Đúng 1 output tại script hash | `claim_account.ak:44` |
| **C-VAL-0** | `acc_out.value == acc_in.value` (account UTxO chỉ giữ min-ADA, không chèn/rút token) | `claim_account.ak:53` |

#### Redeemer `Claim { amount }`

| ID | Phát biểu | Code |
|---|---|---|
| **C-CLAIM-1** | `amount > 0` | `claim_account.ak:58` |
| **C-CLAIM-2** | `committee_approved(committee, threshold, sigs)` | `claim_account.ak:89` |
| **C-CLAIM-3** | `out_datum.entitlement == datum.entitlement − datum.redeemed + amount` (cấp thêm = REBASE, xem §Bất biến thêm 2026-09-17) | `claim_account.ak` ▸ nhánh `Claim` |
| **C-CLAIM-4** | `out_datum.owner == datum.owner` (owner bất biến) | `claim_account.ak` ▸ nhánh `Claim` |
| **C-CLAIM-5** | `out_datum.redeemed == 0` | `claim_account.ak` ▸ nhánh `Claim` |
| **C-CLAIM-6** | `out_datum.start_epoch == get_epoch_strict(tx, ms_per_epoch)` (cận HAI phía) | `claim_account.ak` ▸ nhánh `Claim` |
| **C-CLAIM-7** | `out_datum.drops_per_epoch == datum.drops_per_epoch` | `claim_account.ak:65` |

#### Redeemer `Redeem`

**Đổi hình dạng redeemer:** ở v3 `Redeem` **mang một tham số** — người dựng giao dịch XIN một số
tiền, validator KẸP. v2 để validator tự tính rồi trả trọn phần chênh; v3 không làm thế được nữa
vì cắt ngọn phải chặn được từng lượt.

```
Redeem { amount: Int }        -- constructor index 1, CHƯA CÓ TRONG MÃ
                              -- bản đang chạy: `Redeem` không tham số (types.ak ▸ ClaimAccountRedeemer)
```

| ID | Phát biểu | Trạng thái |
|---|---|---|
| **C-RDM-6** | `datum.owner ∈ tx.extra_signatories` | có — `claim_account.ak:73` |
| **C-RDM-BCN** | Đọc `BeaconDatum` từ reference input mang NFT `#"44524f50"`; ép `kind == DropParam` | có (đổi tên từ `find_drop_value`) |
| **C-RDM-EPOCH** | `current_epoch = get_epoch(tx, ms_per_epoch)` từ `lower_bound` | có — `claim_account.ak:81` |
| **C-RDM-A** | `A_now = bcn.index + bcn.rate_root × (current_epoch − bcn.epoch)` | **CHƯA CÓ TRONG MÃ** |
| **C-RDM-SPAN** | `A_span = A_now − datum.index_at_start`; ép `A_span ≥ 0` | **CHƯA CÓ TRONG MÃ** |
| **C-RDM-VEST** | `(datum.redeemed + amount)² ≤ dpe² × entitlement × A_span²` | **CHƯA CÓ TRONG MÃ** |
| **C-RDM-CAP** | `datum.redeemed + amount ≤ datum.entitlement` | **CHƯA CÓ TRONG MÃ** |
| **C-RDM-TRIM** | `amount ≤ max(constants.trim_floor, tre_in.total_redeemed × trim_num / trim_den)` | **CHƯA CÓ TRONG MÃ** |
| **C-RDM-2** | `amount > 0` | có |
| **C-RDM-4** | `out_datum.redeemed == datum.redeemed + amount` | có — `claim_account.ak:100` |
| **C-RDM-4a** | `out_datum.owner`/`entitlement`/`start_epoch`/`drops_per_epoch`/**`index_at_start`** bất biến | một phần — `index_at_start` **CHƯA CÓ** |
| **C-RDM-TOTAL** | `tre_out.total_redeemed == tre_in.total_redeemed + amount` | **CHƯA CÓ TRONG MÃ** |
| **C-RDM-3** | `lamp_to_owner(...) ≥ amount` | có — `claim_account.ak:107` |

**Hai điểm dễ hiện thực sai, nêu vì chúng không tự lộ ra:**

1. **Không khai căn, và cũng không nhân chéo tuỳ tiện.** `C-RDM-VEST` là phép so sánh số nguyên
   đúng như viết. Biên đo được là **105 bit** ở `dpe = 1` với pot 6 tỷ — Plutus dùng số nguyên độ
   chính xác tuỳ ý nên không tràn, nhưng con số này là thứ để định cỡ ExUnits.
   [`Math-Spec.md`](./Math-Spec.md) §6.
2. **Vượt trần cắt ngọn phải CẮT, không được TỪ CHỐI.** Ngữ nghĩa là *"xin 3 triệu, nhận 1
   triệu"*. Hiện thực thành `expect amount <= trần` rồi để giao dịch hỏng là đúng chữ nhưng sai
   hành vi: người dùng không có cách nào biết nên xin bao nhiêu, và mỗi lần đoán sai mất phí.
   Dạng đúng là kẹp giá trị xin xuống trần rồi tiếp tục.

**`speed_policies = []` ⟹ không đòi reference input nào.** Ca kiểm phải đo **số reference input**,
không đo kết quả rút — một hiện thực vẫn đi tìm thread khi danh sách rỗng sẽ qua được ca đo kết
quả nhưng làm mọi giao dịch đắt hơn và phụ thuộc một UTxO không cần thiết.

**Ghi chú hàm đọc beacon** (`claim_account.ak` ▸ `find_drop_value`, **đổi tên + đổi kiểu trả về ở v3**):
tìm reference input mang `quantity_of(value, beacon_nft_policy, #"44524f50") == 1`, giải datum
`BeaconDatum`, kiểm `kind == DropParam`. v2 trả `drop_value`; **v3 phải trả cả bộ**
`(epoch, index, rate_root, trim_num, trim_den, speed_policies)` — `epoch` nay ĐI VÀO phép tính
(`A_now = index + rate_root × (current_epoch − bcn.epoch)`), khác hẳn v2 nơi hàm **cố ý bỏ qua**
`epoch`. Một hiện thực v3 quên trả `epoch` sẽ tính `A_now` bằng `index` trần và **đứng yên mãi**.
Từ chối nếu không tìm thấy hoặc datum sai.

Hàm này **cố ý bỏ qua** `BeaconDatum.epoch`: D có hiệu lực ngay khi được post, không có độ trễ một cửa sổ. Trước 2026-09-16 điều đó khiến trường `epoch` không nói về epoch nào cả — nó chỉ là bộ đếm lượt post, vì `beacon.ak` chỉ ép nó tăng. Nay `beacon.ak` C-BCN-3 ép nó BẰNG cửa sổ mà lượt post chạy trong đó, nên nhãn là một sự thật đo được (*"D này được đặt ở cửa sổ N"*) chứ không phải một cam kết về thời điểm áp dụng.

#### Đồng hồ epoch — hai đại lượng, KHÔNG thay nhau được

| hàm | đọc | chặn được chiều nào | dùng ở |
|---|---|---|---|
| `get_epoch` | chỉ `lower_bound` | chỉ chiều TIẾN (nhãn tương lai) | `claim_account` nhánh `Redeem` |
| `get_epoch_strict` | CẢ HAI đầu, ép cùng một cửa sổ | cả hai chiều | `treasury` C-ACC-2 · `beacon` C-BCN-3 |

Sổ cái nhận tx khi `lower ≤ now ≤ upper`, nên `lower` đặt lùi bao xa cũng hợp lệ ⇒ `get_epoch` một mình **không** ghim được một nhãn thời gian. Nó đủ ở `Redeem` vì ở đó epoch nhỏ đi thì người dựng tx THIỆT (`elapsed` nhỏ ⇒ vested nhỏ). Ở mọi chỗ GHI một mốc thời gian thì phải dùng `get_epoch_strict` ("Luật 2b", cùng khuôn với `reserve_draw` bên Genesis).

#### Bất biến thêm 2026-09-16 (Issue #72)

| ID | Phát biểu | Code |
|---|---|---|
| **C-ACC-2** | CREATE: `ca_out.start_epoch == get_epoch_strict(tx, ms_per_epoch)` | `treasury.ak`, nhánh `GrantEntitlement` ▸ CREATE |
| **C-BCN-3** | `out_datum.epoch == get_epoch_strict(tx, ms_per_epoch)` | `beacon.ak` |
| **C-BCN-4** | `drop_value_min ≤ out_datum.drop_value ≤ drop_value_max` | `beacon.ak` — **v2, thay ở v3** |
| **C-BCN-5** | `abs_diff(D_out, D_in) × q ≤ D_in × max_drop_delta_q` (±10% một lượt) | `beacon.ak:108-109` — **v2, LỖ ĐANG SỐNG** |

#### Bất biến beacon v3 — thay C-BCN-4/5 ở trên

| ID | Phát biểu | Trạng thái |
|---|---|---|
| **C-BCN-6** | `index_out == index_in + rate_root_in × (epoch_out − epoch_in)` | **CHƯA CÓ TRONG MÃ** |
| **C-BCN-5'** | `rate_root_out ≥ rate_root_in` — **MỘT CHIỀU**, thay `abs_diff` đối xứng | **CHƯA CÓ TRONG MÃ** |
| **C-BCN-5a** | `rate_root_out ≤ rate_root_in × (1 + max_delta)` — trần tốc độ NỚI, giữ | **CHƯA CÓ TRONG MÃ** |
| **C-BCN-5b** | `rate_root_min ≤ rate_root_out ≤ rate_root_max` — biên cứng, giữ | **CHƯA CÓ TRONG MÃ** |

> 🔴 **`C-BCN-5` hiện tại là lỗ đang sống, không phải nợ kỹ thuật.** `math.abs_diff` là hàm **đối
> xứng**, nên trần ±10% cho phép **hạ** `drop_value` 10% mỗi lượt post. Với công thức v2
> (`vested = D × dpe × elapsed`), một lượt `−10%` đưa `vested` xuống dưới `redeemed` của mọi tài
> khoản đã chạy từ 9 cửa sổ trở lên ⟹ `expect amount > 0` khoá vĩnh viễn. Không bất biến nào vỡ
> và không bài kiểm nào đỏ. Chú thích tại `beacon.ak:102-104` khẳng định điều **ngược lại**
> (*"không gặp vách"*) — đó là chú thích sai, không phải mã sai theo một nghĩa khác.
>
> `C-BCN-6` + `C-BCN-5'` của v3 diệt lỗ này **ở hình dạng**: quá khứ đã được định giá và ghi vào
> `index` bằng `rate_root` CŨ, nên một giá trị mới không với ngược lại được.
> [`Math-Spec.md`](./Math-Spec.md) §2 HQ 1.2 và §4.

#### Bất biến thêm 2026-09-17 — cấp thêm = REBASE tài khoản

C-ACC-2 chỉ ghim CREATE. Trước ngày này nhánh UPDATE (cấp thêm cho một tài khoản đã có) giữ
nguyên `start_epoch` và `redeemed`, nên trên một tài khoản đã già phần cấp MỚI được tính như
thể nó đã vesting từ mốc cũ. Đo được: `E = 400` mở ở cửa sổ 0, cấp thêm 1000 ở cửa sổ 100 ⇒
`elapsed = 100` ⇒ `raw = D · dpe · 100` vượt `E = 1400` ⇒ rút TRỌN 1400 ở giao dịch kế tiếp.

**Vì sao không dời mốc theo bình quân gia quyền.** Phương án
`start' = ⌈(E · start + granted · cửa_sổ_này) / E'⌉` KHÔNG đóng được lỗ: cùng ca trên cho
`start' = 72`, `elapsed = 28`, và với `D · dpe` đủ lớn thì `28 · D · dpe` vẫn vượt 1400. Tuổi
tài khoản vẫn đi theo sang lô mới, chỉ bị pha loãng. Đổi trọng số sang phần chưa rút
(`E − redeemed`) cũng không đóng: vẫn còn tổ hợp tham số rút trọn.

**Phương án chốt: rebase.** Phần chưa rút cộng phần cấp mới thành MỘT lô mới, bắt đầu từ cửa sổ
hiện tại:

    E' = (E − redeemed) + amount      redeemed' = 0      start' = get_epoch_strict(tx, ms_per_epoch)

| ID | Phát biểu | Code |
|---|---|---|
| **C-ACC-3** | UPDATE: `ca_out.redeemed == 0` và `ca_out.start_epoch == get_epoch_strict(tx, ms_per_epoch)`; phần cộng vào sổ nợ tính từ `ca_in.entitlement − ca_in.redeemed` | `treasury.ak`, nhánh `GrantEntitlement` ▸ UPDATE |
| **C-ACC-4** | CREATE: `1 ≤ ca_out.drops_per_epoch ≤ drops_per_epoch_max` | `treasury.ak`, nhánh `GrantEntitlement` ▸ CREATE; trần ở `lampdist/constants.ak` ▸ `drops_per_epoch_max` |
| **C-REF-ACC** | `Refill`: không input nào và không output nào nằm ở `claim_account_hash` | `treasury.ak`, nhánh `Refill` |
| **C-CLAIM-3/5/6** | cùng ba đẳng thức, ép từ phía tài khoản (bảng §Redeemer `Claim`) | `claim_account.ak` ▸ nhánh `Claim` |
| **C-ACC-1** | CREATE: `quantity_of(tx.mint, account_nft_policy, blake2b_256(ca_out.owner)) == 1` — tx phải ĐÚC NFT tài khoản | `treasury.ak`, nhánh `GrantEntitlement` ▸ CREATE |
| **C-ACC-1b** | CREATE: `quantity_of(ca_out.value, account_nft_policy, blake2b_256(ca_out.owner)) == 1` — NFT phải NẰM TRONG output tài khoản, không chỉ tồn tại trong `tx.mint` (thêm 2026-09-26; xem CONTRACT v3 §4b mục 4-bis) | `treasury.ak`, nhánh `GrantEntitlement` ▸ CREATE |
| **C-REF-PROV** | `Refill`: đúng MỘT input ở địa chỉ kho mang tài sản tên "TRSY" (carrier); `out_datum.{committee_hash, outstanding_entitlement, total_redeemed}` bằng của carrier; datum input khác BỎ QUA, không fail (thêm 2026-09-26, THAY phép TỔNG; xem CONTRACT v3 §4c) | `treasury.ak` ▸ `fn carrier_ledger` + nhánh `Refill` |
| **C-REF-SIGN** | `Refill`: `carrier.outstanding_entitlement ≥ 0` và `carrier.total_redeemed ≥ 0` — cận DƯỚI, đối xứng với `≤ lamp_out` là cận TRÊN | `treasury.ak` ▸ `fn carrier_ledger` |

**Hệ quả người nhận thấy được.** Phần đã vest mà chưa rút tại lúc cấp thêm KHÔNG mất — nó nằm
trong `E − redeemed` — nhưng nó vest lại từ đầu cùng lô mới. Muốn giữ tiến độ thì rút trước
khi được cấp thêm. Bên dựng giao dịch cấp thêm phải chặn trường hợp này trừ khi người vận hành
chấp nhận rõ ràng (`Genesis/scripts/28_beacon_grant_redeem.ts` ▸ bước topup, mã lỗi `TOPUP-006`).

**Sổ nợ vẫn khớp.** `Σ(E − redeemed)` trước và sau rebase chênh đúng `amount`, nên
`outstanding_entitlement` của kho cộng đúng `amount` như trước (C-SOLV-1).

**Vì sao chốt nằm ở CẢ HAI validator.** C-SOLV-1 chỉ ép `Claim` co-spend kho, KHÔNG ép kho
chạy nhánh `GrantEntitlement` — kho chạy `Refill` thì không mệnh đề C-ACC-3 nào chạy. Hai lớp
chặn cặp đó: C-REF-ACC từ phía kho, C-CLAIM-3/5/6 từ phía tài khoản. Chúng độc lập với nhau
**chỉ khi datum tài khoản KHÔNG rebase**. Datum đã rebase đúng thì C-CLAIM-3/5/6 thoả, và
`claim_account` không đọc redeemer của kho, nên cặp `Claim` + `Refill` khi đó chỉ còn một lớp
chặn là C-REF-ACC. Thứ bị né là nhánh `GrantEntitlement` của kho; các đẳng thức rebase vẫn bị
phía tài khoản ép, chữ ký committee vẫn bị `Claim` ép, và `dpe` vẫn bất biến ở `Claim`. Chưa
dựng giao dịch nào cho thấy né nhánh đó rút thêm được gì.

Đo bằng `Distribution/onchain/validators/claim_treasury_cross_test.ak` (Issue #79): mỗi bài
dựng MỘT giao dịch và chạy cả hai validator trên nó. Gỡ C-REF-ACC → Claim+Refill với datum
không rebase vẫn bị `claim_account` từ chối, nhưng với datum đã rebase thì qua trọn
(`cross_claim_refill_rebased_rejected` đỏ). Gỡ C-CLAIM-3/5/6 → cả hai hình dạng vẫn bị
C-REF-ACC từ chối.

**Vì sao cần C-ACC-4.** Biên của D (C-BCN-4) một mình không ghim tốc độ vesting: `vested` tỉ lệ
với `D · dpe`, và `dpe` do committee đặt lúc CREATE. `drops_per_epoch_max` là giá trị tạm cho
Preprod, chốt trước mainnet cùng biên D.

**C-BCN-2 + C-BCN-3 đi CẶP** và cặp ấy mới là thứ có giá trị: mỗi cửa sổ post được tối đa MỘT lượt (lượt thứ hai cùng cửa sổ có `epoch` bằng lượt trước ⇒ đứt C-BCN-2; mang nhãn cửa sổ sau ⇒ đứt C-BCN-3). Đó là điều kiện để C-BCN-5 là một trần thật — không có nó thì post `n` lượt trong một cửa sổ đổi được `1,1ⁿ` lần.

**Phần C-BCN-4/5 KHÔNG bịt**: committee vẫn dời được D trong toàn dải `[min, max]`, chỉ là mất nhiều cửa sổ. Một tài khoản đang vesting dở do đó không gặp vách, nhưng cũng không được bảo đảm một tốc độ vesting cố định. Con số `min`/`max`/`±10%` thừa kế từ thiết kế P-beacon cũ và **chưa qua một vòng chốt nào cho D** — xem `onchain/lib/magiclamp/lampdist/constants.ak`.

---

### 3.4 V4: `treasury` — `spend/ReleaseForRedeem`

**Tham số validator:** `claim_account_hash`, `lamp_policy`, `lamp_name`

**Tiền điều kiện chung:**

| ID | Phát biểu | Code |
|---|---|---|
| **C-MINT-0** | `tx.mint` là zero | `treasury.ak:32` |
| **C-TRE-DS1** | Đúng 1 treasury input tại script hash (chống C2 multi-UTxO drain) | `treasury.ak:36` |
| **C-TRE-DS2** | Đúng 1 treasury output tại script hash | `treasury.ak:37` |

**Bất biến `ReleaseForRedeem`:**

| ID | Phát biểu | Code |
|---|---|---|
| **C-TRE-2** | `out_datum.committee_hash == datum.committee_hash` (datum bảo toàn) | `treasury.ak:45` |
| **C-TRE-CA1** | Đúng 1 ClaimAccount input tại `claim_account_hash` | `treasury.ak:48-49` |
| **C-TRE-CA2** | Đúng 1 ClaimAccount output tại `claim_account_hash` | `treasury.ak:51` |
| **C-TRE-REL1** | `released = ca_out.redeemed − ca_in.redeemed` | `treasury.ak:56` |
| **C-TRE-REL2** | `released > 0` | `treasury.ak:57` |
| **C-TRE-1** | `tre_out.value == assets.add(tre_in.value, lamp_policy, lamp_name, -released)` — LAMP giảm đúng `released`, mọi asset khác bảo toàn tuyệt đối (ADA, token lạ) | `treasury.ak:61` |

**Ghi chú fix M1 (ADA drain):** Bất biến C-TRE-1 dùng `assets.add(tre_in.value, …, -released)` thay vì chỉ kiểm LAMP delta riêng. Tức `tre_out.value` phải bằng `tre_in.value` trừ đúng `released` LAMP và không thay đổi gì khác. ADA giảm → value không khớp → reject.

---

## 4. eUTXO Flow

### 4.1 Ký hiệu

```
[UTxO]        = UTxO tại validator address
{ref}         = reference input (không spend, chỉ đọc datum)
→             = kết quả output
TX( )         = giao dịch
```

### 4.2 Flow Deploy (chạy 1 lần)

```
TX-DEPLOY-NFT:
  inputs:  [genesis_utxo]          (bất kỳ UTxO của deployer)
  mint:    beacon_nft_policy:"DROP" qty=1
  outputs: [beacon_addr ← ADA + NFT "DROP" + BeaconDatum{epoch=0, kind=DropParam, index=0, rate_root=77460, trim=1/1000, speed_policies=[]}]
  signers: [deployer]

  Bất biến: W-BNT-1 (consume genesis_utxo), W-BNT-2/3 (mint đúng 1 qty 1)
  Kết quả:  Beacon UTxO ban đầu tồn tại trên chain với NFT + datum D₀.
  Lưu ý:   Beacon UTxO được PAY TRỰC TIẾP tới beacon address (không qua validator spend).
            Validator beacon chỉ áp dụng cho mọi UPDATE sau này.
```

```
TX-DEPLOY-TREASURY:
  inputs:  [deployer_utxo]
  outputs: [treasury_addr ← ADA + LAMP_initial + TreasuryDatum{committee_hash}]
  signers: [deployer]

  Không qua validator (genesis). treasury.ak kiểm soát từ lần spend đầu tiên.
```

```
TX-DEPLOY-CLAIM-ACCOUNT (optional prefund — có thể bỏ qua, tạo lazily):
  Committee tạo ClaimAccount UTxO cho mỗi wallet.
```

### 4.3 Flow Committee Update Beacon (định kỳ mỗi epoch)

```
TX-UPDATE-BEACON:
  inputs:  [beacon_in: V2 ← ADA + NFT + BeaconDatum{epoch=N, kind=DropParam, index=A_N, rate_root=w_old, …}]
  outputs: [beacon_out: V2 ← ADA + NFT + BeaconDatum{epoch=N+1, kind=DropParam, index=A_N + w_old·(N+1−N), rate_root=w_new ≥ w_old, …}]
  signers: [committee_key_1, committee_key_2]  (≥ threshold)

  Bất biến V2: C-MINT-0, C-BCN-DS1/DS2, C-BCN-1/2/3/4/5
  Kết quả: Beacon UTxO cập nhật D cho epoch tiếp theo.
```

### 4.4 Flow Committee Claim (cấp entitlement)

```
TX-CLAIM:
  inputs:  [account_in: V3 ← ADA + ClaimAccountDatum{owner, E_old, redeemed, t0, r}]
  outputs: [account_out: V3 ← ADA + ClaimAccountDatum{owner, E_old+amount, redeemed, t0, r}]
  redeemer V3: Claim { amount }
  signers: [committee_key_1, committee_key_2]  (≥ threshold)

  Bất biến V3: C-MINT-0, C-RDM-DS1/DS2, C-VAL-0, C-CLAIM-1/2/3/4/5/6/7
  Kết quả: Entitlement E tăng thêm amount. Mọi field khác bất biến.
```

### 4.5 Flow Redeem (user tự rút — PERMISSIONLESS)

```
TX-REDEEM:
  inputs:  [account_in: V3 ← ADA + ClaimAccountDatum{owner, E, redeemed_old, t0, r}]
           [treasury_in: V4 ← ADA + LAMP_pool + TreasuryDatum{committee_hash}]
  ref:     {beacon: V2 ← ADA + NFT "DROP" + BeaconDatum{epoch=K, kind=DropParam, index, rate_root, trim_*, speed_policies}}
  outputs: [account_out: V3 ← ADA + ClaimAccountDatum{owner, E, redeemed_old+amount, t0, r}]
           [treasury_out: V4 ← ADA + (LAMP_pool - amount) + TreasuryDatum{committee_hash}]
           [owner_wallet ← ADA + amount LAMP]
  validity_range: [lower_bound = current_epoch × ms_per_epoch, …]
  redeemer V3: Redeem
  redeemer V4: ReleaseForRedeem
  signers: [owner_pkh]

  Phép tính on-chain (V3):
    elapsed = max(0, current_epoch − t0)
    raw     = D × r × elapsed
    vested  = clamp(raw, 0, E)          = min(E, raw)
    amount  = vested − redeemed_old     > 0

  Bất biến V3: C-MINT-0, C-RDM-DS1/DS2, C-VAL-0, C-RDM-6, C-RDM-1/1a/1b,
               C-RDM-EPOCH, C-RDM-ELAPSED, C-RDM-VESTED, C-RDM-2, C-RDM-4/4a, C-RDM-3
  Bất biến V4: C-MINT-0, C-TRE-DS1/DS2, C-TRE-2, C-TRE-CA1/CA2, C-TRE-REL1/REL2, C-TRE-1
  Kết quả: account.redeemed tăng amount; treasury LAMP giảm amount; owner nhận amount LAMP.
```

### 4.6 Sơ đồ quan hệ validator trong TX-REDEEM

```
                    ┌─────────────────────────────────┐
  {beacon: V2}      │  TX-REDEEM                      │
  (reference only)  │                                 │
  NFT + beacon ─────┤→ V3 đọc index + rate_root        │
                    │                                 │
  [account: V3] ────┤→ check vested, amount           │
  redeemer: Redeem  │   update redeemed               ├──→ [account_out: V3]
                    │                                 │
  [treasury: V4] ───┤→ check released == amount       │
  redeemer:         │   check value delta             ├──→ [treasury_out: V4]
  ReleaseForRedeem  │                                 │
                    │   owner receives amount LAMP    ├──→ [owner wallet]
                    └─────────────────────────────────┘

  Liên kết V3 ↔ V4:
    V3 kiểm: lamp_to_owner(tx.outputs, owner, …) ≥ amount        (C-RDM-3)
    V4 kiểm: released = ca_out.redeemed − ca_in.redeemed         (C-TRE-REL1)
             tre_out.value = tre_in.value − released LAMP        (C-TRE-1)
    V4 không gọi lại V3; cả 2 đọc chung tx.inputs/tx.outputs.
```

### 4.7 Chống double-satisfaction — tóm tắt

| Loại tấn công | Guard | Validator |
|---|---|---|
| 2 account UTxO cùng script hash (khác stake cred) trong 1 tx | `count_inputs_at_script == 1` | V3: `claim_account.ak:43` |
| 2 account output → dùng 1 `Redeem` để update 2 account | `count_outputs_at_script == 1` | V3: `claim_account.ak:44` |
| 2 treasury UTxO trong 1 tx → nhân đôi release | `count_inputs_at_script == 1` | V4: `treasury.ak:36` |
| Beacon giả (datum bịa, không NFT) qua reference_inputs | `quantity_of(NFT) == 1` | V3: `claim_account.ak:129` |
| Account giả không giữ value đúng | `acc_out.value == acc_in.value` | V3: `claim_account.ak:53` |
| ADA drain từ treasury | Full value equality check | V4: `treasury.ak:61` |

---

## 5. Deploy — Thứ tự và Tham số

### 5.1 Thứ tự bắt buộc

```
Bước 1: Biên dịch tất cả 4 validators → plutus.json
  cd Distribution/onchain && aiken build
  Đọc script hash và policy ID từ plutus.json.

Bước 2: Deploy beacon_nft (one-shot mint)
  Cần: genesis_ref (UTxO sẽ bị consume — chọn UTxO deployer bất kỳ, ghi lại TxHash#Index)
  Kết quả: BEACON_NFT_POLICY (policy ID từ plutus.json, parameterized bởi genesis_ref)
  Mint 1 NFT "DROP" trong cùng tx → gửi tới beacon_address (bước 3 cần địa chỉ này)

Bước 3: Tạo Beacon UTxO ban đầu
  Cần: BEACON_NFT_POLICY, beacon validator script hash (BEACON_SCRIPT_HASH)
  Giao dịch pay-to-address (KHÔNG spend validator — genesis beacon):
    Output tại: beacon validator address (BEACON_SCRIPT_HASH, stake=None)
    Value: min-ADA + 1 NFT "DROP" (BEACON_NFT_POLICY)
    Datum (inline): BeaconDatum { epoch: 0, kind: DropParam, index: 0, rate_root: 77460,
                                  trim_num: 1, trim_den: 1000, speed_policies: [] }
  Ghi: BEACON_UTXO (TxHash#0) — reference input cho mọi Redeem

Bước 4: Tạo Treasury UTxO ban đầu
  Cần: TREASURY_SCRIPT_HASH (V4 sau khi parameterize bởi CLAIM_ACCOUNT_HASH)
  QUAN TRỌNG: CLAIM_ACCOUNT_HASH phải xác định TRƯỚC (bước 3.5 bên dưới)
  Giao dịch pay-to-address:
    Output tại: treasury validator address (TREASURY_SCRIPT_HASH)
    Value: min-ADA + LAMP_total (oildrop)
    Datum (inline): TreasuryDatum { committee_hash: COMMITTEE_HASH }

Bước 3.5 (xen giữa 3-4): Xác định CLAIM_ACCOUNT_HASH
  Script hash của V3 (claim_account) phụ thuộc tham số
  beacon_nft_policy (= BEACON_NFT_POLICY từ bước 2).
  Sau bước 2 mới biết BEACON_NFT_POLICY → mới hash V3 → mới hash V4.
  Thứ tự thực tế: 2 → hash V3 → hash V4 → 3 (Beacon genesis) → 4 (Treasury genesis).

Bước 5 (optional): Tạo ClaimAccount UTxO cho wallet đầu tiên
  Committee dùng TX-CLAIM (Claim { amount=E }) với account rỗng sẵn có.
  Hoặc tạo trực tiếp pay-to-address với datum ban đầu {owner, 0, 0, t0, 1}.
```

### 5.2 Env vars cần thiết

| Biến | Nguồn | Dùng bởi |
|---|---|---|
| `GENESIS_UTXO_REF` | Chọn trước deploy | Tham số `beacon_nft` validator |
| `BEACON_NFT_POLICY` | `plutus.json` sau build (parameterized bởi `GENESIS_UTXO_REF`) | Tham số V2 + V3; tạo Beacon genesis UTxO |
| `BEACON_SCRIPT_HASH` | `plutus.json` sau build (parameterized bởi committee, threshold, `BEACON_NFT_POLICY`) | Địa chỉ Beacon UTxO |
| `CLAIM_ACCOUNT_HASH` | `plutus.json` sau build (parameterized bởi committee, threshold, `ms_per_epoch`, `LAMP_POLICY`, `LAMP_NAME`, `BEACON_NFT_POLICY`) | Tham số V4 |
| `TREASURY_SCRIPT_HASH` | `plutus.json` sau build (parameterized bởi `CLAIM_ACCOUNT_HASH`, `LAMP_POLICY`, `LAMP_NAME`) | Địa chỉ Treasury UTxO |
| `LAMP_POLICY` | Đã deploy từ trước | V3, V4 |
| `LAMP_NAME` | `#"744c414d50"` ("tLAMP", canonical) | V3, V4 |
| `COMMITTEE_KEYS` | Danh sách PKH committee | Tham số V2, V3 |
| `THRESHOLD` | Số nguyên ≥ 1 (MVP = 2) | Tham số V2, V3 |
| `MS_PER_EPOCH` | Preview = 86_400_000 (1 ngày); Mainnet = 432_000_000 (5 ngày) | Tham số V3 |
| `INITIAL_DROP_VALUE` | `D₀` (oildrop/drop) — tham số kinh tế | Datum Beacon genesis |
| `COMMITTEE_HASH` | Identifier committee cho audit | TreasuryDatum |

### 5.3 Phụ thuộc tham số (dependency graph)

```
GENESIS_UTXO_REF
  └→ beacon_nft script → BEACON_NFT_POLICY
       ├→ beacon(committee, threshold, BEACON_NFT_POLICY) → BEACON_SCRIPT_HASH
       └→ claim_account(committee, threshold, ms_per_epoch, LAMP_POLICY, LAMP_NAME, BEACON_NFT_POLICY)
              → CLAIM_ACCOUNT_HASH
                   └→ treasury(CLAIM_ACCOUNT_HASH, LAMP_POLICY, LAMP_NAME) → TREASURY_SCRIPT_HASH
```

---

## 6. Bảng bất biến tổng hợp (tham chiếu chéo FEAT ↔ TECH)

| FEAT ID | TECH ID | MATH ID | Phát biểu | Trạng thái |
|---|---|---|---|---|
| F-VEST-1 | C-RDM-VEST + C-RDM-CAP | M-SQUARE | kẹp bình phương ⟺ `vested = min(E, √E·A_span)` | CHƯA CÓ |
| F-VEST-2 | — | M-MONO | `vested` đơn điệu, KHÔNG cần giả thiết tham số cố định | toán |
| F-VEST-3 | C-RDM-CAP | M-CAP | `redeemed + amount ≤ E` | CHƯA CÓ |
| F-VEST-4 | C-RDM-A | M-INDEX-LIVE | committee im lặng ⟹ `A` vẫn chạy (dạng đóng) | CHƯA CÓ |
| F-VEST-5 | C-BCN-6 | M-INDEX-PAST | lượt post mới không đổi `A` ở quá khứ | CHƯA CÓ |
| F-RDM-1 | C-RDM-2 | — | `amount > 0` | có |
| F-RDM-2 | C-RDM-4/4a | — | out datum đúng, **`index_at_start` bất biến** | một phần |
| F-RDM-3 | C-TRE-1 + C-RDM-3 | — | kho nhả đúng, owner nhận đúng | có |
| F-RDM-4 | C-RDM-6 | — | owner ký | có |
| F-RDM-5 | C-RDM-DS1/DS2 | — | đúng 1 account + 1 kho mỗi tx | có |
| F-TRIM-1 | C-RDM-TRIM | — | trần một lượt; vượt thì **cắt**, không từ chối | CHƯA CÓ |
| F-TRIM-2 | C-RDM-TOTAL | M-TRIM-FINITE | phần bị cắt không mất; xong sau ≤ `⌈E/F⌉` lượt | CHƯA CÓ |
| F-TRIM-3 | C-RDM-TRIM-FLOOR | M-TRIM-FLOOR | `C = 0` vẫn rút được | CHƯA CÓ |
| F-SUM-1 | C-RDM-4 | M-SUM | tổng nhận `≤ min(E, vested(t_cuối))` | có |
| F-SUM-2 | — | M-SUM | ⚠ tổng nhận **phụ thuộc lộ trình** ở v3 | toán |
| F-LARGE-1 | — | M-ROOT-CEIL | hết sau đúng `⌈√E / w⌉` cửa sổ | CHƯA CÓ |
| F-LARGE-2 | §4d | M-SPLIT | tách `n` phần chỉ nhanh gấp `√n` | CHƯA CÓ |
| F-DPE-1 | C-ACC-DPE | — | `drops_per_epoch == 1` mọi tài khoản | CHƯA CÓ |

**Cột "Trạng thái" đo 2026-09-22 bằng `grep` trên `Distribution/onchain/`** — "CHƯA CÓ" nghĩa là
không tệp mã nào chứa mệnh đề đó, không phải là nó khó. Bảng này là danh sách việc của lượt đúc
v3, không phải bản kê thứ đã chạy.

---

## 7. Lưu ý kỹ thuật bổ sung

### 7.1 `ms_per_epoch` và validity_range

`get_epoch(tx, ms_per_epoch)` (`util.ak:12-15`) lấy lower_bound của validity_range, yêu cầu kiểu `Finite`. Tx builder phải set lower_bound POSIX ms rõ ràng (không `NegativeInfinity`). Nếu không set → validator fail với `expect Some(s)`.

**Preview testnet:** `ms_per_epoch = 86_400_000` (1 epoch = 1 ngày).
**Mainnet (khi deploy):** `ms_per_epoch = 432_000_000` (1 epoch = 5 ngày = 432,000 giây = 432,000,000 ms).

Tham số này là một phần của validator hash → thay đổi `ms_per_epoch` tạo ra script hash khác. Deploy Preview và Mainnet là 2 script khác nhau.

**`get_finite` bỏ qua `is_inclusive` — biết và CỐ Ý không sửa.** Nó chỉ đọc `bound_type` và
trả giá trị, nên một `upper_bound` với `is_inclusive = False` được đọc như thể bao gồm chính
mốc đó. Sai lệch tối đa là 1 ms, và nó lệch theo chiều NGHIÊM hơn: cửa sổ được coi là dài hơn
1 ms so với cửa sổ sổ cái thật chấp nhận, nên mọi giao dịch qua được `get_epoch_strict` cũng
qua được sổ cái. Sửa nó sẽ đổi hash của ba validator để đổi lấy 1 ms ở chiều an toàn — ghi ra
đây thay vì sửa, để lần sau ai thấy cũng biết là đã cân nhắc.

**Bên dựng tx phải tự kéo `hi` về trong cửa sổ.** `get_epoch_strict` ép `hi / mspe == lo / mspe`,
mà TTL mặc định của ví (`now + vài giờ`) vắt qua biên epoch nhiều lần mỗi chu kỳ; lúc đó tx bị
từ chối và lỗi chỉ nói *"validator crashed"*. Hàm làm việc đó là `epochWindow`
(`offchain/src/constants.ts`), bản song sinh bên Genesis là `windowAt` (`scripts/_epochWindow.ts`).
Cả hai trả về khoảng thoả BA mệnh đề: hai đầu cùng cửa sổ · `hi > lo` · **`lo ≤ now ≤ hi`**.
Mệnh đề thứ ba là mệnh đề từng thiếu ở cả hai bản — chúng suy cửa sổ từ `lo = now − 60 s` thay
vì từ `now`, nên 60 giây đầu mỗi cửa sổ trả về một khoảng ĐÃ HẾT HẠN mang nhãn cửa sổ trước.

### 7.2 Beacon reference input không bị spend

Beacon UTxO là **reference input** trong TX-REDEEM, không bị spend. Validator V3 chỉ đọc `index` + `rate_root` + `trim_*` từ datum. Beacon UTxO có thể được cập nhật song song bởi committee mà không block redeem. Tuy nhiên nếu beacon bị update trong cùng tx với redeem → update là spend, redeem là reference input → xung đột (eUTXO: 1 UTxO không thể vừa spend vừa reference trong cùng tx). Offchain phải chọn beacon UTxO chưa bị spend.

### 7.3 LAMP token canonical name

`LAMP_NAME = #"744c414d50"` ("tLAMP", canonical kể từ commit `bcbd8205`). Tham số này hardcode trong validator hash. Kiểm tra trước deploy:
- `claim_account` tests: `t_lamp_name: ByteArray = #"4c414d50"` (test dùng mock, không phải mainnet/preview canonical)
- Khi deploy thực: phải dùng `#"744c414d50"` đúng theo MAGIC canonical

### 7.4 Không có `withdraw` validator

Tất cả 4 validator chỉ implement `spend` (và `mint` cho V1). `else(_) { fail }` ở tất cả chặn `withdraw`, `publish`, `vote`, `propose` — không ai có thể dùng stake credential của script để rút ADA reward.

### 7.5 `ClaimAccountDatum.drops_per_epoch` — GHIM `== 1` ở v3

v2 để trường này tự do trong `[1, drops_per_epoch_max = 100]`, committee đặt lúc mở tài khoản.
v3 ép `== 1` ở nhánh CREATE của `treasury.ak` (`C-ACC-DPE`). Mã hiện tại **chỉ kiểm `r > 0`** —
đó là chỗ phải đổi.

```
C-ACC-DPE:  ca_out.drops_per_epoch == 1      (treasury.ak ▸ GrantEntitlement ▸ CREATE)
```

**Vì sao ghim thay vì để DAO chỉnh:** trường này nhân thẳng vào tốc độ và nằm **ngoài** tổng tích
luỹ, nên hạ nó viết lại toàn bộ lịch sử — `= 0` khoá tài khoản vĩnh viễn, đúng lớp lỗi mà cả v3
được dựng ra để diệt. Ngược lại `rate_root` nằm **trong** tổng nên hạ nó chỉ chạm cửa sổ tương
lai. Cùng một phép nhân, hai vị trí, hai hệ quả trái ngược:
[`Math-Spec.md`](./Math-Spec.md) §4.

Thêm một lý do không thuộc về an toàn mà thuộc về công bằng: `dpe = 100` cho committee cạnh giá
trị vận hành `21` của cộng đồng là tỉ lệ **4,76×**, và tỉ lệ ấy **không đổi dù siết `trim_num`
bao nhiêu**, vì nó nằm ở kênh tốc độ chứ không ở kênh cắt ngọn.

**Trường vẫn GIỮ trong datum**, không xoá: một cửa sau bị khoá bằng một mệnh đề ép thì đọc được
và kiểm được, một cửa sau bị xoá thì lần sau có người mở lại mà không biết vì sao nó từng bị
đóng. Mở lại ở v4 đòi một **cơ sở đo được trên chuỗi** để phân biệt tài khoản — hôm nay không có
cơ sở nào như thế.

---

## 8. Tests on-chain hiện có (Aiken mock-tx)

| Test | Validator | Happy/Fail | Bất biến kiểm |
|---|---|---|---|
| `mint_happy` | V1 | happy | W-BNT-1/2/3 |
| `mint_without_genesis` | V1 | fail | W-BNT-1 |
| `mint_wrong_quantity` | V1 | fail | W-BNT-3 |
| `beacon_happy` | V2 | happy | C-BCN-1/2/3/4/5 |
| `beacon_epoch_not_increasing` | V2 | fail | C-BCN-2 |
| `beacon_insufficient_committee` | V2 | fail | C-BCN-1 |
| `claim_happy_path` | V3 | happy | C-CLAIM-1/2/3/4/5/6/7 |
| `claim_insufficient_committee` | V3 | fail | C-CLAIM-2 |
| `claim_value_tamper` | V3 | fail | C-VAL-0 |
| `redeem_happy` | V3 | happy | C-RDM-6/1/VESTED/2/4/3 |
| `redeem_small_entitlement_full_first_epoch` | V3 | happy | F-SMALL-1 |
| `redeem_multi_claim_accumulate` | V3 | happy | F-SUM-1 (3 đợt) |
| `redeem_vested_capped_at_E` | V3 | happy | F-VEST-3 |
| `redeem_over_cap_rejected` | V3 | fail | C-RDM-4 |
| `redeem_nothing_vested_rejected` | V3 | fail | C-RDM-2 |
| `redeem_no_owner_sig` | V3 | fail | C-RDM-6 |
| `redeem_double_satisfaction` | V3 | fail | C-RDM-DS2 |
| `redeem_mint_rejected` | V3 | fail | C-MINT-0 |
| `treasury_happy` | V4 | happy | C-TRE-1/REL1/REL2 |
| `treasury_double_release` | V4 | fail | C-TRE-DS1 |
| `treasury_ada_drain` | V4 | fail | C-TRE-1 (M1 fix) |
| `treasury_zero_release` | V4 | fail | C-TRE-REL2 |
