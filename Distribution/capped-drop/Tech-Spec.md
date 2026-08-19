# Capped Drop — SPEC TECH (kỹ thuật on-chain)

**Doctype:** MagicLamp Protocol — Onchain Spec (Technical / Implementation)
**Version:** v2 "Capped Drop"
**Updated:** 2026-06-10
**Nguồn chuẩn (interface contract):** [`CONTRACT.md`](./CONTRACT.md)
**Hành vi:** [`Feat-Spec.md`](./Feat-Spec.md)
**Chứng minh toán:** [`Math-Spec.md`](./Math-Spec.md)

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

**Aiken** (`types.ak:8-14`):
```
pub type ClaimAccountDatum {
  owner           : ByteArray,   // PKH chủ ví
  entitlement     : Int,         // E — tổng LAMP (oildrop)
  redeemed        : Int,         // đã nhận tích lũy (oildrop)
  start_epoch     : Int,         // t0
  drops_per_epoch : Int,         // MVP = 1
}
```

**Plutus Data encoding:**
```
Constr(0, [
  Bytes(owner),              -- field 0: PKH 28 bytes
  Integer(entitlement),      -- field 1: E (oildrop, non-negative)
  Integer(redeemed),         -- field 2: đã rút tích lũy (oildrop)
  Integer(start_epoch),      -- field 3: t0
  Integer(drops_per_epoch),  -- field 4: r (MVP=1)
])
```

**Bất biến datum:** `0 ≤ redeemed ≤ entitlement`, `drops_per_epoch ≥ 0`, `entitlement ≥ 0`.

---

### 2.3 `ClaimAccountRedeemer`

**Aiken** (`types.ak:16-21`):
```
pub type ClaimAccountRedeemer {
  Claim { amount: Int }   -- constructor index 0
  Redeem                  -- constructor index 1
}
```

**Plutus Data encoding:**

| Redeemer | Encoding |
|---|---|
| `Claim { amount }` | `Constr(0, [Integer(amount)])` |
| `Redeem` | `Constr(1, [])` |

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

**Aiken** (`types.ak:28-34`):
```
pub type BeaconDatum {
  epoch      : Int,
  kind       : BeaconKind,
  drop_value : Int,
}
```

**Plutus Data encoding:**
```
Constr(0, [
  Integer(epoch),            -- field 0: epoch khi post
  Constr(0, []),             -- field 1: kind = DropParam
  Integer(drop_value),       -- field 2: D (oildrop/drop)
])
```

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

**Aiken** (`types.ak:41-43`):
```
pub type TreasuryDatum {
  committee_hash : ByteArray,
}
```

**Plutus Data encoding:**
```
Constr(0, [
  Bytes(committee_hash),     -- field 0: hash nhận dạng committee
])
```

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

**Tham số validator:** `committee: List<ByteArray>`, `threshold: Int`, `beacon_nft_policy: ByteArray`

**Tiền điều kiện chung (áp dụng trước khi phân nhánh redeemer):**

| ID | Phát biểu | Code |
|---|---|---|
| **C-MINT-0** | `tx.mint` là zero — beacon validator không liên quan mint | `beacon.ak:29` |
| **C-BCN-DS1** | Đúng 1 input tại script hash (chống double-satisfaction C1) | `beacon.ak:33` |
| **C-BCN-DS2** | Đúng 1 output tại script hash | `beacon.ak:34` |

**Bất biến `PostBeacon`:**

| ID | Phát biểu | Code |
|---|---|---|
| **C-BCN-1** | `committee_approved(committee, threshold, sigs)` (≥ threshold NGƯỜI trong committee ký) | `beacon.ak:37` |
| **C-BCN-2** | `out_datum.epoch > datum.epoch` (epoch đơn điệu tăng, không update cùng epoch) | `beacon.ak:45` |
| **C-BCN-3** | `out_datum.kind == datum.kind` (kind beacon không đổi) | `beacon.ak:46` |
| **C-BCN-4** | `nft_in == 1` (NFT có trong input) | `beacon.ak:51` |
| **C-BCN-5** | `nft_out == 1` (NFT bảo toàn sang output, không bị rút) | `beacon.ak:52` |

**Tại sao cần W-BNT / C-BCN-4/5:** Kẻ tấn công có thể tạo UTxO giả tại cùng beacon address với datum bịa. Cả `claim_account` và `beacon` chỉ tin UTxO mang authenticity NFT. Validator giả không thể mint NFT (one-shot đã dùng).

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
| **C-CLAIM-3** | `out_datum.entitlement == datum.entitlement + amount` | `claim_account.ak:62` |
| **C-CLAIM-4** | `out_datum.owner == datum.owner` (owner bất biến) | `claim_account.ak:61` |
| **C-CLAIM-5** | `out_datum.redeemed == datum.redeemed` (redeemed không đổi khi Claim) | `claim_account.ak:63` |
| **C-CLAIM-6** | `out_datum.start_epoch == datum.start_epoch` | `claim_account.ak:64` |
| **C-CLAIM-7** | `out_datum.drops_per_epoch == datum.drops_per_epoch` | `claim_account.ak:65` |

#### Redeemer `Redeem`

| ID | Phát biểu | Code |
|---|---|---|
| **C-RDM-6** | `datum.owner ∈ tx.extra_signatories` (owner ký — permissionless với owner) | `claim_account.ak:73` |
| **C-RDM-1** | `drop_value = find_drop_value(tx.reference_inputs, beacon_nft_policy)` — D đọc từ reference input mang NFT `#"44524f50"` | `claim_account.ak:76-77` |
| **C-RDM-1a** | `drop_value > 0` | `claim_account.ak:78` |
| **C-RDM-1b** | `datum.drops_per_epoch > 0` (chặn pause-redeem tính vested sai) | `claim_account.ak:79` |
| **C-RDM-EPOCH** | `current_epoch = get_epoch(tx, ms_per_epoch)` từ validity_range lower_bound (Finite) | `claim_account.ak:81`, `util.ak:12-15` |
| **C-RDM-ELAPSED** | `elapsed = max(0, current_epoch − datum.start_epoch)` | `claim_account.ak:83-88` |
| **C-RDM-VESTED** | `raw = drop_value × drops_per_epoch × elapsed`; `vested = clamp(raw, 0, datum.entitlement)` | `claim_account.ak:89-91` |
| **C-RDM-2** | `amount = vested − datum.redeemed > 0` | `claim_account.ak:93-95` |
| **C-RDM-4** | `out_datum.redeemed == datum.redeemed + amount` | `claim_account.ak:100` |
| **C-RDM-4a** | `out_datum.owner / entitlement / start_epoch / drops_per_epoch` bất biến | `claim_account.ak:98-101` |
| **C-RDM-3** | `lamp_to_owner(tx.outputs, owner, lamp_policy, lamp_name) ≥ amount` | `claim_account.ak:107` |

**Ghi chú `find_drop_value`** (`claim_account.ak:119-135`): tìm reference input mang `quantity_of(value, beacon_nft_policy, #"44524f50") == 1`, giải datum `BeaconDatum`, kiểm `kind == DropParam`, trả `drop_value`. Từ chối nếu không tìm thấy hoặc datum sai.

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
  outputs: [beacon_addr ← ADA + NFT "DROP" + BeaconDatum{epoch=0, kind=DropParam, drop_value=D₀}]
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
  inputs:  [beacon_in: V2 ← ADA + NFT + BeaconDatum{epoch=N, kind=DropParam, drop_value=D_old}]
  outputs: [beacon_out: V2 ← ADA + NFT + BeaconDatum{epoch=N+1, kind=DropParam, drop_value=D_new}]
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
  ref:     {beacon: V2 ← ADA + NFT "DROP" + BeaconDatum{epoch=K, kind=DropParam, drop_value=D}}
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
  NFT + D ──────────┤→ V3.find_drop_value()            │
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
    Datum (inline): BeaconDatum { epoch: 0, kind: DropParam, drop_value: D₀ }
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

| FEAT ID | TECH ID | Phát biểu | Validator | Code |
|---|---|---|---|---|
| F-VEST-1 | C-RDM-VESTED | `vested = clamp(D·r·elapsed, 0, E)` | V3 | `claim_account.ak:89-91` |
| F-VEST-2 | — | vested đơn điệu (toán, không kiểm on-chain) | — | MATH §2 |
| F-VEST-3 | C-RDM-VESTED | `clamp(…, 0, E)` đảm bảo `vested ≤ E` | V3 | `math.ak:13-18` |
| F-RDM-1 | C-RDM-2 | `amount > 0` | V3 | `claim_account.ak:95` |
| F-RDM-2 | C-RDM-4/4a | out datum cập nhật đúng | V3 | `claim_account.ak:98-101` |
| F-RDM-3 | C-TRE-1 + C-RDM-3 | treasury nhả đúng, owner nhận đúng | V3 + V4 | `claim_account.ak:107`, `treasury.ak:61` |
| F-RDM-4 | C-RDM-6 | owner ký | V3 | `claim_account.ak:73` |
| F-RDM-5 | C-RDM-DS1/DS2, C-TRE-DS1/DS2 | đúng 1 account + 1 treasury per tx | V3 + V4 | `claim_account.ak:43-44`, `treasury.ak:36-37` |
| F-SUM-1 | C-RDM-4 + C-TRE-REL1 | tổng nhận = vested cuối ≤ E (toán + datum chain) | V3 + V4 | MATH §4 |

---

## 7. Lưu ý kỹ thuật bổ sung

### 7.1 `ms_per_epoch` và validity_range

`get_epoch(tx, ms_per_epoch)` (`util.ak:12-15`) lấy lower_bound của validity_range, yêu cầu kiểu `Finite`. Tx builder phải set lower_bound POSIX ms rõ ràng (không `NegativeInfinity`). Nếu không set → validator fail với `expect Some(s)`.

**Preview testnet:** `ms_per_epoch = 86_400_000` (1 epoch = 1 ngày).
**Mainnet (khi deploy):** `ms_per_epoch = 432_000_000` (1 epoch = 5 ngày = 432,000 giây = 432,000,000 ms).

Tham số này là một phần của validator hash → thay đổi `ms_per_epoch` tạo ra script hash khác. Deploy Preview và Mainnet là 2 script khác nhau.

### 7.2 Beacon reference input không bị spend

Beacon UTxO là **reference input** trong TX-REDEEM, không bị spend. Validator V3 chỉ đọc `drop_value` từ datum. Beacon UTxO có thể được cập nhật song song bởi committee mà không block redeem. Tuy nhiên nếu beacon bị update trong cùng tx với redeem → update là spend, redeem là reference input → xung đột (eUTXO: 1 UTxO không thể vừa spend vừa reference trong cùng tx). Offchain phải chọn beacon UTxO chưa bị spend.

### 7.3 LAMP token canonical name

`LAMP_NAME = #"744c414d50"` ("tLAMP", canonical kể từ commit `bcbd8205`). Tham số này hardcode trong validator hash. Kiểm tra trước deploy:
- `claim_account` tests: `t_lamp_name: ByteArray = #"4c414d50"` (test dùng mock, không phải mainnet/preview canonical)
- Khi deploy thực: phải dùng `#"744c414d50"` đúng theo MAGIC canonical

### 7.4 Không có `withdraw` validator

Tất cả 4 validator chỉ implement `spend` (và `mint` cho V1). `else(_) { fail }` ở tất cả chặn `withdraw`, `publish`, `vote`, `propose` — không ai có thể dùng stake credential của script để rút ADA reward.

### 7.5 `ClaimAccountDatum.drops_per_epoch` MVP = 1

Hiện tại không có redeemer nào thay đổi `drops_per_epoch`. Hook DAO (FEAT §5) dự kiến thêm redeemer mới trong v.sau, có thể là:
- `UpdateDropsPerEpoch { new_r: Int }` với guard committee + governance VP
Chừa chỗ: field đã có trong datum, offchain có thể đọc; onchain không ép `r == 1` — kiểm `r > 0` khi Redeem.

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
