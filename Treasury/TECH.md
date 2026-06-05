# Treasury — TECH (Kiến trúc on-chain Aiken)

**Trạng thái:** draft 2026-06-05 (chờ anh duyệt). Bám **xương sống** `Treasury/CONTRACT.md` —
KHÔNG mâu thuẫn. Tài liệu này là tầng **kỹ thuật** (datum/redeemer/bất biến/validator) của hệ
Treasury đa thuê bao. Phần hành vi ở FEAT, chứng minh toán ở MATH, tích hợp/lộ trình ở EXEC.

Tái dùng nền: [`Distribution/onchain/validators/treasury.ak`](../Distribution/onchain/validators/treasury.ak)
+ helper [`lib/magiclamp/lampdist/util.ak`](../Distribution/onchain/lib/magiclamp/lampdist/util.ak)
(đã build + audit C1/C2/M1). Aiken stdlib: [`cardano/assets`](https://aiken-lang.github.io/stdlib/cardano/assets.html),
[`cardano/transaction`](https://aiken-lang.github.io/stdlib/cardano/transaction.html),
[`cardano/address`](https://aiken-lang.github.io/stdlib/cardano/address.html),
[`aiken/collection/dict`](https://aiken-lang.github.io/stdlib/aiken/collection/dict.html).

---

## 0. Mục tiêu + Phạm vi

### Thuộc spec này (TECH)
- 3 validator on-chain: **Custody** (giữ value + sổ bucket), **Collect** (cổng thu `collectToTreasury`),
  **Release** (cổng chi qua Governance). Datum + redeemer + bất biến từng cái.
- **Bucket accounting trong datum** — sổ, KHÔNG mỗi bucket một UTxO (chống bloat + min-ADA).
- Bất biến **bảo-toàn-value PER-ASSET** (tổng quát hóa `treasury_receives_lamp >= lamp_paid`).
- Chống **double-satisfaction** theo **payment script hash** (bài học C1/C2/M1).
- **Batch settlement tx** (gộp nhiều collect/micro-fee trong 1 tx).
- **Multi-asset** (LAMP/ADA/token doanh nghiệp), **địa chỉ Treasury tách ví**.
- Đọc **kết quả Governance** qua **reference input** + Proposal NFT (cổng release).
- **Migrate** treasury payment hiện có của generators MAGIC sang instance Treasury.

### KHÔNG thuộc spec này
- **Định giá** phí (bò ≠ gà): ở app (OriLife `animal_fee`), Treasury chỉ nhận `amount` đã tính (CONTRACT §3.5).
- **Oracle** LAMP↔USD/ADA: ngoài Treasury (CONTRACT §7) — app/caller tự quy đổi trước khi gọi collect.
- **Cơ chế bỏ phiếu / tính VP**: ở `Governance/VotingPower/*`. Treasury chỉ **đọc kết quả** đã tally.
- **Conway `treasury_donation`** (`donateToCardanoTreasury`, ADA-only kho bạc Cardano): cửa tiền
  riêng, KHÔNG đi qua 3 validator này — chỉ là field tx-level
  ([CIP-1694](https://cips.cardano.org/cip/CIP-1694), [conway certs](https://aiken-lang.github.io/stdlib/cardano/certificate.html)).
  Mô tả tách ở FEAT §"Ba cửa tiền".
- **Logic đếm phiếu / ngưỡng đạt**: validator Proposal (Governance) tự kiểm; Release chỉ đọc cờ
  `Tallied` + `Executed` đã chứng thực.

### Bất biến cốt lõi (nhắc lại — sai là hỏng)
LAMP fixed-supply 36 tỷ **tuyệt đối, KHÔNG BURN**. Mọi tx Treasury giữ `Σ_out(asset) = Σ_in(asset)`
cho **mọi** asset (kể cả ADA, kể cả LAMP) — trừ đúng phần value vật lý đi vào/ra theo đúng nghiệp vụ
(collect: value đi vào treasury tăng; release: đi ra giảm đúng số đã duyệt). "Giảm lưu hành" là
thuộc tính **kế toán** `circulating = tổng − Σ balance Treasury instance`, KHÔNG phải đốt
(CONTRACT §5; mô hình kho bạc Cardano:
[Cardano treasury](https://docs.cardano.org/about-cardano/explore-more/cardano-economy/)).

---

## 1. Tổng quan kiến trúc — 3 validator + 1 chứng thực

```
                   ┌─────────────────────────────────────────────┐
   caller (MAGIC   │   COLLECT validator (minting/spend gate)     │
   generators,     │   collectToTreasury(asset,amount,app_id,cat) │
   OriLife,        │   • split cut→bucket  • receipt  • batch      │
   app SDK)  ─────▶│   • bất biến: custody nhận ≥ Σ cut theo asset │
                   └───────────────────┬─────────────────────────┘
                                       │ cập nhật (spend+respend custody)
                   ┌───────────────────▼─────────────────────────┐
                   │   CUSTODY validator (spend)                  │
                   │   giữ Value đa-asset + SỔ bucket trong datum │
   reference ─────▶│   • Σ ledger ≤ Value thực  • bảo toàn datum  │
   (Proposal NFT)  └───────────────────┬─────────────────────────┘
                                       │ release theo proposal đã pass
                   ┌───────────────────▼─────────────────────────┐
                   │   RELEASE path (spend custody, redeemer      │
                   │   Release{proposal_ref,...})                 │
                   │   • đọc Proposal Tallied qua ref input       │
                   │   • value ra ĐÚNG số duyệt  • trừ đúng bucket │
                   └─────────────────────────────────────────────┘
```

**Quyết định first-principles (1 custody validator, 3 đường redeemer thay vì 3 validator tách
script).** eUTxO: một UTxO = một địa chỉ script + datum + value. Sổ bucket + value đa-asset cùng
nằm trên **một họ UTxO custody** (1 hoặc vài shard). Collect và Release đều **spend custody UTxO**
rồi tạo lại — nên bản chất chúng là **hai nhánh redeemer của Custody validator**, không phải 3
script địa chỉ khác nhau. Gộp lại:
- **Lợi tối ưu eUTxO:** ít script address → ít reference script on-chain, ít ExUnit nạp script, datum
  tham chiếu nhất quán. (ExUnit/script ref:
  [Plutus script budgets](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/),
  [CIP-33 reference scripts](https://cips.cardano.org/cip/CIP-33)).
- **Lợi an toàn:** một nơi duy nhất ép bất biến bảo-toàn-value + sổ — không rò nhánh.
- **Đa thuê bao:** Custody param hóa theo instance (một script hash / instance).

Vì vậy mục dưới đặt tên theo **redeemer nhánh** (`Collect`, `Release`, `Rebalance`, `Migrate`) của
**một Custody validator**. "Collect validator" và "Release validator" trong CONTRACT là **góc nhìn
nghiệp vụ** của hai nhánh này, không phải 2 script tách.

> **Custody throughput — ĐO TRƯỚC khi chốt 1 UTxO, shard-by-asset nếu nghẽn (CHỐT T4 = Treasury
> CONTRACT §9 T4).** Một custody UTxO là **điểm contention tuần tự**: mọi Collect/Release/Rebalance đều
> SPEND nó rồi tạo lại → hai tx đụng cùng custody không thể vào cùng block độc lập (tx sau phải tham
> chiếu UTxO mới của tx trước). v1 **đề xuất 1 custody** (đơn giản, throughput đủ vì Collect đã batch N
> micro-fee/tx, §4.3) — NHƯNG đây là quyết-định-có-số-đo, không mặc định mù:
> - **EXEC PHẢI đo throughput TRƯỚC khi chốt** (nâng câu hỏi treo #3 thành điều kiện có số đo): đo
>   `batch N/tx × tx/block × block/epoch` so **tải tổng nhiều thuê bao** (mọi caller generators+OriLife+
>   app SDK đổ chung 1 custody). Nếu tải đỉnh vượt khả năng tuần tự của 1 UTxO → **nghẽn**.
> - **Nếu nghẽn → shard-by-asset**: tách asset thành **nhiều custody độc lập** (mỗi shard = 1 UTxO + 1
>   sổ riêng). Bất biến sổ↔value (§3) + bảo-toàn-value áp **per-shard** (mỗi shard tự đóng); off-chain
>   **cộng tổng qua mọi shard** khi tính `circulating` (= S_total − Σ_{mọi shard + I_emg} bal). Shard
>   theo asset (không theo bucket) vì bất biến per-asset độc lập sẵn — tách asset không vỡ logic; sổ mỗi
>   shard nhỏ hơn → K·M_shard giảm, đỡ trần ExUnit (§3 phân tích K·M). Đánh đổi: nhiều UTxO → nhiều
>   min-ADA + off-chain phải tổng hợp. Chỉ shard **khi đo thấy nghẽn**, không phức tạp hóa sớm.

> Emergency bucket: CONTRACT §1 yêu cầu **tách physical**. → Emergency là **một Custody instance
> riêng** `I_emg` (script hash khác, governance/threshold riêng, param `buckets=[emergency]`), KHÔNG
> phải một dòng sổ trong custody thường. Isolation thật ở mức UTxO/địa chỉ, không phải sổ.
>
> **Hệ quả cho `circulating` (sửa audit finding 9):** vì emergency là INSTANCE KHÁC, off-chain tính
> `circulating(a) = S_total(a) − Σ_{I ∈ T, KỂ CẢ I_emg} bal_I(a)` — PHẢI cộng cả emergency instance,
> nếu không sẽ tính dư circulating (sót value đang khóa ở emergency). MATH §5.1 cần sửa: bỏ "emergency
> bucket" khỏi liệt kê các thành phần của MỘT instance I, thêm `I_emg` như PHẦN TỬ RIÊNG của tập T.
> Off-chian đối soát `circulating` phải quét toàn bộ T = {custody chính + mọi shard + I_emg}.

---

## 2. Custody validator — tham số hóa instance (đa thuê bao)

```aiken
// Một instance Treasury = một lần áp tham số → một script hash.
// MagicLamp = 1 instance; team eco khác = instance khác (open SDK).
validator custody(
  // ── nhận dạng tài sản LAMP (cho bất biến + accounting) ──
  lamp_policy        : ByteArray,
  lamp_name          : ByteArray,
  // ── cổng Governance: chỉ NFT này chứng thực 1 Proposal hợp lệ ──
  proposal_policy    : ByteArray,   // policy id của Proposal authenticity NFT (Governance)
  // ── thời gian mạng ──
  ms_per_epoch       : Int,         // Preview/Mainnet khác — như Distribution
) { ... }
```

> **Sửa audit finding 10:** `protocol_cut_bps` ĐÃ DỜI khỏi param validator vào **datum** (mục 3,
> `CustodyDatum.cut_bps`). Lý do: cut_bps là thứ **DAO chỉnh** (CONTRACT §1, §3.1); nếu để ở param thì
> DAO đổi nó ⇒ đổi SCRIPT HASH ⇒ đổi địa chỉ custody ⇒ phải migrate value — mâu thuẫn yêu cầu "giữ địa
> chỉ custody ổn định qua nâng cấp". Param validator CHỈ giữ thứ **bất biến suốt đời instance**.

`accepted_assets[]`, `buckets[]` (CONTRACT §1) **và `cut_bps`/`split_table`** **không** là tham số
validator mà nằm trong **datum** (mục 3) — để DAO thêm/bớt asset, đổi % bucket hoặc cut **không phải
đổi script hash** (giữ địa chỉ custody ổn định qua nâng cấp). Đây là quyết định tối ưu: param validator
= thứ **bất biến suốt đời instance** (định danh LAMP, policy NFT governance, ms_per_epoch); datum = thứ
**DAO có thể chỉnh** (danh mục asset, cut_bps, % bucket, balance). (Đồng bộ MATH §1: `cut_bps` từ "tham
số instance" → "tham số datum".)

---

## 3. Datum — sổ bucket + danh mục, KHÔNG mỗi bucket 1 UTxO

```aiken
// ── Một dòng sổ cho một bucket, theo TỪNG asset ──
// Khóa = (bucket_id, asset). Dùng Pairs/Dict để tra nhanh + so khớp deterministic.
pub type BucketLedger {
  // bucket_id: 0=community, 1=ops, 2=grants, 3=reserve... (danh mục mở, DAO định)
  // value: số dư kế toán của bucket đó cho asset cụ thể.
  // Bất biến sổ: Σ_bucket ledger[asset] == custody.value(asset) − min_ada_overhead.
  balances : Pairs<BucketKey, Int>,   // (xem BucketKey dưới)
}

pub type BucketKey {
  bucket_id : Int,
  policy    : ByteArray,   // asset policy (ADA = #"")
  name      : ByteArray,   // asset name  (ADA = #"")
}

// ── % chia về mỗi bucket khi collect (tổng = 10000 bps). DAO chỉnh. ──
pub type BucketSplit {
  bucket_id : Int,
  weight_bps: Int,
}

pub type CustodyDatum {
  instance_id    : ByteArray,        // định danh instance (audit, đa thuê bao)
  accepted_assets: List<BucketKey>,  // (policy,name) được nhận — name/bucket_id bỏ trống ở đây, chỉ dùng (policy,name)
  ledger         : BucketLedger,     // SỔ kế toán đa-asset × bucket (KHÔNG mỗi bucket 1 UTxO)
  cut_bps        : Int,              // bps cắt về bucket (DAO chỉnh — finding 10; KHÔNG ở param)
  split_table    : List<BucketSplit>,// (DÀNH RIÊNG đa-bucket — KHÔNG dùng ở đường collect đơn-bucket;
                                     //  finding 2: collect dùng item.category, không split_table)
  governance_ref : ByteArray,        // script hash Proposal/Governance instance gắn với treasury này
  receipt_root   : ByteArray,        // accumulator receipt (xem §6) — audit thu/chi
  epoch          : Int,              // epoch cập nhật gần nhất (chống replay sổ)
}

pub type CustodyRedeemer {
  // THU: gộp lô N collect vào 1 settlement tx (anti-bloat)
  Collect { items: List<CollectItem> }
  // CHI: release theo 1 proposal đã Tallied + pass (đọc qua reference input)
  Release { proposal_ref: OutputReference, draws: List<ReleaseDraw> }
  // CHUYỂN nội bộ giữa bucket (DAO duyệt) — value custody KHÔNG đổi, chỉ sổ
  Rebalance { proposal_ref: OutputReference, moves: List<BucketMove> }
  // MIGRATE: nạp value treasury cũ của generators vào instance (một lần, §9)
  MigrateIn { source: ByteArray }
}

pub type CollectItem {
  app_id   : ByteArray,   // ai trả (generators/OriLife/app) — cho receipt + tín dụng VP
  policy   : ByteArray,   // asset
  name     : ByteArray,
  amount   : Int,         // số đã định giá ở app (Treasury KHÔNG định giá)
  category : Int,         // bucket_id đích cho phần cut
}

pub type ReleaseDraw {
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
  amount    : Int,        // số rút ra (≤ balance bucket cho asset đó)
  to        : Address,    // người nhận (đã ghi trong proposal — xem §7)
}

pub type BucketMove {
  from_bucket : Int,
  to_bucket   : Int,
  policy      : ByteArray,
  name        : ByteArray,
  amount      : Int,
}
```

**Vì sao sổ trong datum, không mỗi bucket 1 UTxO (first-principles + tối ưu):**
1. **Min-ADA & bloat:** mỗi UTxO Cardano phải giữ tối thiểu ~1 ADA + min-ADA theo kích thước
   ([CIP-55 min-ADA / ledger params](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/)).
   K bucket × M asset = K·M UTxO khóa ADA chết + phình UTxO set. Sổ = **một** UTxO custody (hoặc vài
   shard) giữ toàn bộ value, bucket chỉ là **con số trong datum**.
2. **Atomic split:** collect cắt cut về nhiều bucket trong **một** lần spend custody — không cần
   chạm K UTxO (giảm ExUnit + tránh contention nhiều UTxO).
3. **Đếm phiếu/đọc số dư:** off-chain đọc 1 datum ra toàn bộ sổ, không phải quét K·M UTxO.

**Bất biến sổ↔value — INCREMENTAL, KHÔNG fold lại toàn sổ mỗi tx (CHỐT T3 = Treasury CONTRACT §9 T3):**

Bất biến nền (ngữ nghĩa, luôn đúng sau mọi tx):
```
∀ asset a:  Σ_{bucket b} ledger.balances[(b, a)]  ==  custody.value(a) − reserved_min_ada(a)
```
Với ADA, `reserved_min_ada` = phần ADA tối thiểu giữ UTxO sống (không thuộc bucket nào). Với LAMP/
token, `reserved_min_ada = 0`. Bất biến này khóa "sổ không nói dối": tổng các bucket luôn bằng value
thật trong custody. Drain bất kỳ asset nào → vế phải giảm → bất biến vỡ → tx reject.

**Cách ÉP trong validator (T3 — chỉ kiểm asset CÓ Δ, không fold toàn sổ):** mỗi tx Treasury (Collect/
Release/Rebalance/Migrate) đụng **một tập nhỏ asset** `A_Δ` (asset xuất hiện trong items/draws/moves).
Validator CHỈ kiểm **incremental** trên `A_Δ`:
```
∀ a ∈ A_Δ:   Σ_{bucket b} ( ledger_out[(b,a)] − ledger_in[(b,a)] )  ==  Δvalue(a)
             với Δvalue(a) = custody_out.value(a) − custody_in.value(a)
∀ a ∉ A_Δ:   custody_out.value(a) == custody_in.value(a)   (value bảo toàn → sổ a giữ nguyên,
             KHÔNG cần fold lại các dòng sổ của asset a)
```
Lý do (first-principles + tối ưu eUTXO): bất biến nền tương đương "tổng đầu == tổng đầu sau Δ" khi
`ledger_in` ĐÃ thỏa bất biến nền (bất biến quy nạp). Nếu mỗi tx fold lại Σ toàn sổ K·M dòng thì ExUnit
phình tuyến tính theo **toàn bộ** danh mục — vô lý vì một collect 1 asset không đụng K−1 bucket × M−1
asset còn lại. Kiểm Δ chỉ trên `A_Δ` giữ chi phí tỉ lệ **kích thước tx**, không tỉ lệ kích thước sổ.
Δvalue(a) cho LAMP/token là `== Σcut` (collect) hay `== −Σdraw` (release) — khóa ba đầu cut↔Δsổ↔Δvalue
(xem C-COL-5, C-REL-5/6).

**Phân tích ExUnit theo K·M + trần (T3 — đặt trần đo-thực TRƯỚC M2):**
- Gọi **K** = số bucket có dòng sổ, **M** = số asset trong danh mục. Sổ `ledger.balances` là
  `Pairs<BucketKey,Int>` cỡ **≤ K·M** dòng → mỗi lần spend custody, validator phải **đọc + giải mã
  datum** chứa tới K·M dòng (chi phí O(K·M) bất kể tx đụng mấy asset, vì datum nằm nguyên khối). Đây là
  **chi phí cố định của datum**, KHÁC chi phí kiểm Δ (O(|A_Δ| · K) cho phần cập nhật sổ).
- Cập nhật incremental: với mỗi `a ∈ A_Δ` cần tra/ghi tối đa K dòng bucket → O(|A_Δ| · K). Tổng mỗi tx
  ≈ **O(K·M)** (giải mã datum) **+ O(|A_Δ|·K)** (cập nhật) **+ O(N)** (fold items/draws, N = số item lô).
- **Trần (tham số mở — đo thực TRƯỚC M2):** vì giải mã datum là O(K·M) cứng, K·M không được vượt mức làm
  datum quá [max tx size] / [datum ExUnit budget]. Đặt **trần `K·M ≤ KM_max`** (đo bằng `aiken check`
  ExUnit thật + tx-build Preview), và **trần `N ≤ N_max`** mỗi batch (đã nêu §4.3). Nếu danh mục lớn tới
  mức K·M chạm trần → **shard-by-asset** (T4, §1): tách asset thành nhiều custody → mỗi shard sổ nhỏ hơn,
  K·M_shard < KM_max. `KM_max`/`N_max` chốt bằng số đo (không đoán) như chuẩn build mode.

---

## 4. Nhánh `Collect` — thu về treasury (CONTRACT §3, nhóm A)

### 4.1 Luồng
1. Caller (generators/OriLife/app) build settlement tx: chi các UTxO nguồn (đã trả phí), tạo
   **một** custody output mới với value tăng đúng tổng `amount` các item, datum sổ cập nhật.
2. `Collect` validator chạy khi spend custody UTxO cũ, kiểm:

### 4.2 Kiểm tra (validator)
```
C-COL-1  Singleton custody theo SCRIPT HASH:
         count_inputs_at_script(tx.inputs, own_hash) == 1
         count_outputs_at_script(tx.outputs, own_hash) == 1
         (util.count_inputs_at_script / count_outputs_at_script — chống N× qua stake cred, audit C1/C2)

C-COL-2  Bảo-toàn-value PER-ASSET — custody chỉ chứng kiến CUT (khớp MATH §2.3 INV-COLLECT `Δ_I(a) ≥ cut(a)`):
         ∀ asset a có item:
             • LAMP/token (reserved_min_ada = 0):
                 custody_out.value(a) == custody_in.value(a) + Σ_{item.asset=a} cut(item)   (ĐẲNG THỨC)
             • ADA (lovelace, reserved_min_ada > 0 cho UTxO mới):
                 custody_out.value(ADA) >= custody_in.value(ADA) + Σ_{item.asset=ADA} cut(item)
                 phần dư (≥) CHỈ là min-ADA overhead của UTxO custody mới, vào bucket ADA reserved riêng
                 (KHÔNG vào sổ LAMP — xem C-COL-5 + §3 bất biến sổ).
         ∀ asset a KHÁC (không có item):  custody_out.value(a) == custody_in.value(a)   (chống lẫn/drain)

         Ghi rõ (sửa theo audit findings 1+3): custody chỉ tăng đúng phần `cut` (KHÔNG phải `amount`).
         Phần residual = amount − cut do CALLER định tuyến ra provider/node trong cùng tx, NẰM NGOÀI bất
         biến custody. Dùng `cut`, KHÔNG dùng `amount` (xóa hẳn dòng cũ `+ Σ item.amount`).
         Dùng `==` cho LAMP/token để loại "tip LAMP" — nếu cho `≥` với LAMP, custody.value(LAMP) có thể
         tăng > Σ Δsổ → vế phải bất biến sổ↔value (§3) lệch → vỡ sổ. Dấu `≥` CHỈ hợp lệ cho ADA
         (min-ADA overhead của UTxO mới), không cho LAMP/token. (Đồng bộ MATH §2.3.)

C-COL-3  Asset hợp lệ: mọi item.(policy,name) ∈ datum.accepted_assets.

C-COL-4  Split cut đúng sổ — MODEL ĐƠN-BUCKET (category rời rạc, khớp MATH §10 #2 + CONTRACT §3.1):
           cut(item) = item.amount × cut_bps / 10000          (floor — xem MATH §3.1)
           cut_bps đọc TỪ DATUM (sửa theo audit finding 10 — KHÔNG còn là param validator; xem §2),
             để DAO chỉnh không phải đổi script hash → giữ địa chỉ custody ổn định.
           cut vào ĐÚNG MỘT bucket = item.category (cut → bucket(category), không rải đa-bucket):
             ledger_out[(item.category, asset)] = ledger_in[(item.category, asset)] + cut
           phần residual = item.amount − cut: KHÔNG vào sổ — định tuyến provider/node do CALLER tạo
             output riêng trong cùng tx (Treasury không quản, CONTRACT §3.1).
           ⇒ chỉ phần `cut` vào custody + vào sổ; residual đi thẳng provider trong cùng settlement tx.

         > Bỏ split_table/BucketSplit khỏi đường collect (sửa audit finding 2 + CHỐT T2 = Treasury
         > CONTRACT §9 T2): TECH trước đây rải cut đa-bucket bằng weight_bps gây lỗ hổng double-rounding
         > `Σ_b ⌊cut·weight_b/10000⌋ ≤ cut` (lệch tới (số bucket − 1) oil) → sổ có thể cộng KHÁC cut →
         > tạo/rớt balance ma → vỡ bất biến sổ↔value. **Dạng CHÍNH của MATH là ĐƠN-BUCKET**:
         > `Δ_bucket(category) == cut` (MATH §10 #2 — category rời rạc), TECH khớp đúng dạng này.
         > split_table/đa-bucket là **TÙY CHỌN instance**, KHÔNG phải đường mặc định; MATH hạ
         > PARTITION-MULTI xuống mục tùy chọn (T2 — hết cite chéo ngược TECH↔MATH "MATH chốt đa-bucket").
         > KHI một instance thật bật đa-bucket, BẮT BUỘC áp kỹ thuật PARTITION (MATH §3.2, mục tùy chọn):
         > "bucket cuối = cut − Σ bucket trước" để Σ_b Δledger == cut TUYỆT ĐỐI (không floor độc lập từng
         > bucket) — vì chỉ PARTITION mới giữ C-COL-5(a).

C-COL-5  Bất biến nối Δsổ ↔ cut ↔ value (sửa audit finding 2 — mắt xích nối C-COL-2 với §3):
           (a) ∀ asset a:  Σ_{bucket b} (ledger_out[(b,a)] − ledger_in[(b,a)]) == Σ_{item.asset=a} cut(item)
               (tổng Δsổ mọi bucket KHỚP TUYỆT ĐỐI tổng cut của asset — chống cộng dư/rớt oil).
           (b) Bất biến sổ↔value (§3) giữ sau cập nhật:
               Σ_b ledger_out[(b,a)] == custody_out.value(a) − reserved_min_ada(a)  ∀a.
           Với LAMP/token (reserved_min_ada=0), (a)+(b)+C-COL-2 (==) khóa ba đầu: cut == Δsổ == Δvalue.

C-COL-6  receipt_root_out = update(receipt_root_in, items)  (§6) — bắt buộc ghi nhận.

C-COL-7  epoch_out >= epoch_in  (chống replay sổ cũ); KHÔNG mint LAMP/accepted (sửa audit finding 4):
           ràng buộc PER-ASSET, KHÔNG nới is_zero(tx.mint) toàn cục:
             ∀ (p,n) ∈ accepted_assets ∪ {(lamp_policy, lamp_name)}:  tx.mint.quantity_of(p,n) == 0
           ⇒ LAMP/token kho TUYỆT ĐỐI mint==0 trong MỌI nhánh collect (giữ BIV-1, MATH §2.2).
           Mint NFT beacon của generator (policy KHÁC, không thuộc accepted_assets) được phép trong
           cùng tx — nhưng KHÔNG có cửa hậu nới "tx generator có mint riêng thì OK" (cụm đó đã xóa,
           vì không định nghĩa được "riêng" → kẻ tấn công gói mint LAMP vào tx collect sẽ lọt).
           (Áp y hệt cho MigrateIn §9.)

C-COL-8  Custody address ≠ mọi ví nguồn trong tx (CONTRACT §6): output custody phải ở SCRIPT
         address (payment_credential = Script(own_hash)), không trùng ví caller — nếu trùng, bất biến
         "nhận ≥ X" thỏa rỗng (bài học Preview generators).
```

> **Làm rõ "cut vào custody, residual ra provider" (quyết định tối ưu):** CONTRACT §3.1 nói residual
> "định tuyến theo app". Để **một** settlement tx vừa thu cut vừa trả provider, mô hình chuẩn là:
> nguồn (phí user) → (a) `cut` vào custody, (b) `residual` ra ví provider/node, cùng tx. Validator
> custody chỉ quan tâm (a): `custody nhận ≥ Σ cut`. Residual nằm ngoài tầm custody (đúng tinh thần
> "định giá/định tuyến ở app"). Nếu một instance muốn **toàn bộ** `amount` vào treasury (vd quỹ thuần
> LAMP), đặt `cut_bps = 10000` (ở datum) → cut = amount, residual = 0 (toàn bộ amount vào custody+sổ).

### 4.3 Batch settlement (anti-bloat, CONTRACT §3.3)
Off-chain gom **N micro-fee** (mỗi giao dịch user) thành **một** `Collect{ items: [N] }`:
- một custody spend + một custody output cho cả lô → 1 min-ADA, 1 lần nạp script.
- `items` là `List<CollectItem>`; validator fold qua list cộng dồn per-asset + per-bucket.
- Giới hạn N theo **tx size cap** + **ExUnit cap** mạng
  ([protocol params](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/)). N tối đa
  là **tham số mở** (off-chain chọn theo budget thực đo). Quy ước: nếu `items` vượt budget, off-chain
  chia nhiều settlement tx tuần tự (mỗi tx spend custody mới nhất).

---

## 5. Multi-asset — LAMP / ADA / token doanh nghiệp

- Value đa-asset giữ chung trên **một** UTxO custody (eUTxO cho phép một UTxO chứa nhiều
  `(policy,name)`: [assets.Value](https://aiken-lang.github.io/stdlib/cardano/assets.html)).
- Sổ khóa theo `BucketKey{bucket_id, policy, name}` → mỗi asset có dòng sổ riêng trong mỗi bucket.
- **ADA biểu diễn** `policy=#"", name=#""` (lovelace) — nhất quán với
  [`assets.from_lovelace`](https://aiken-lang.github.io/stdlib/cardano/assets.html). ADA reserve cho
  free-ops (PersonDID, CONTRACT §6) là một `bucket_id` riêng giữ lovelace.
- **Bảo-toàn-value áp cho TỪNG asset độc lập** (C-COL-2, C-REL-2): không asset nào được drain bù asset
  khác — đúng bài học M1 (LAMP delta đúng nhưng rút ADA → reject).
- Token doanh nghiệp (đa thuê bao): instance khác param `lamp_*` theo token của họ; cùng khung
  validator. LAMP-specific chỉ ở chỗ bất biến fixed-supply gọi tên LAMP cho instance MagicLamp.

---

## 6. Receipt accumulator — audit + tín dụng VP/uy tín (CONTRACT §3.4)

Ghi từng receipt thành **một** UTxO sẽ bloat. Dùng **accumulator** trong datum:
```
receipt_root_out = blake2b_256( receipt_root_in ∥ encode(items ∥ epoch) )
```
- Hash-chain (mẫu như `compute_batch_id`/`compute_order_id` của generators —
  [`crypto.blake2b_256`](https://aiken-lang.github.io/stdlib/aiken/crypto.html)). Off-chain giữ
  pre-image đầy đủ `(app_id, asset, amount, cut, epoch)` để dựng lại + chứng minh cho Governance/VP.
- On-chain chỉ giữ **root** (32 byte) → audit không drain UTxO set. Đây là cùng triết lý Merkle-root
  của Distribution (committee post root, user chứng minh bằng proof).
- **Phải chốt TRƯỚC M2** (sửa audit finding 13 — không để treo [cần verify]): dạng encode chính xác cho
  `items` = **canonical CBOR theo thứ tự field cố định** (mẫu `compute_batch_id`/`compute_order_id` của
  Distribution), chốt ở MATH §receipt để on-chain ↔ off-chain BYTE-PERFECT. Nếu encode lệch byte,
  `receipt_root` không đối chiếu được → mất audit trail + mất tín dụng VP/uy tín (dù KHÔNG phá value
  preservation). Không phải lỗ hổng value nhưng là **blocker audit/VP** → hạ về điều kiện chặn M2,
  không để treo vô thời hạn.

---

## 7. Nhánh `Release` — chi qua cổng Governance (CONTRACT §4, nhóm B)

### 7.1 Release-gate = Model A duy nhất — Treasury chỉ KIỂM CỜ, KHÔNG tự tính ngưỡng (CHỐT T1)

**T1 = Treasury CONTRACT §9 T1 = Gov CONTRACT §5 D3.** Treasury Release **KHÔNG tự tính bất kỳ ngưỡng
nào** (không `yes>no`, không nhân-chéo `≥ θ`, không clamp BFT, không sàn `|S|≥F`). Toàn bộ ngưỡng (gồm
clamp `VP_eff` 1/21 + sàn cứng số DID) do **Governance `ExecuteProposal` ép TRƯỚC** ở một tx riêng. Cổng
release của Treasury chỉ kiểm **đúng 4 thứ** (mọi bất đẳng thức tự-kiểm ngưỡng đã BỎ khỏi Treasury):

| # | Treasury kiểm | Ràng buộc | Vì sao đủ (Model A) |
|---|---|---|---|
| 1 | `status == Executed` | C-REL-2 | Governance đã ép toàn bộ ngưỡng + chuyển Tallied→Executed ở tx riêng |
| 2 | **Proposal authenticity NFT** | C-REL-1 | chống datum giả mạo địa chỉ (token one-shot chứng thực) |
| 3 | `spend_spec_hash` khớp draws | C-REL-3 | khóa đích chi (ai/bao nhiêu) đúng điều đã duyệt |
| 4 | `execute_after_epoch` time-lock | C-REL-8 | epoch hiện tại ≥ mốc duyệt |

Treasury **tin** cờ + NFT, KHÔNG đọc `yes_power/no_power/voter_count` để tự so ngưỡng (đó là việc của
Governance — đọc lại sẽ nhân đôi logic + mở lỗ hổng "release bỏ qua clamp" GAME-1, đã đóng bởi D3).

Governance phơi kết quả ở **Proposal UTxO** mang **Proposal authenticity NFT** (one-shot, mẫu
`beacon_nft.ak`), datum `ProposalDatum{ status, spend_spec_hash, execute_after_epoch, released_cumulative,
... }` (Gov CONTRACT §5 D2; [Governance TECH §3](../Governance/VotingPower/TECH.md)). Release đọc UTxO
này làm **reference input** (không tiêu — nhiều release/đọc song song):
[`Transaction.reference_inputs`](https://aiken-lang.github.io/stdlib/cardano/transaction.html).

```
C-REL-1  Reference input tồn tại tại proposal_ref và mang đúng Proposal NFT:
           expect Some(ref) = list.find(tx.reference_inputs, _.output_reference == proposal_ref)
           proposal value chứa đúng 1 NFT policy == proposal_policy  (chống datum giả mạo địa chỉ —
           lý do dùng token chứng thực, như beacon_nft.ak). is_at_script theo governance_ref.

C-REL-2  Proposal đã thông qua — CHỐT MODEL A (sửa audit finding 5): Execute là tx RIÊNG do
           Governance làm TRƯỚC; Release đọc proposal qua reference input khi status ĐÃ == Executed.
             status == Executed   (CHỈ Executed — bỏ {Tallied, Executed})
           Treasury KHÔNG tự tính ngưỡng — Governance đã ghi cờ + đã chuyển Tallied→Executed ở tx riêng.
           Ngưỡng "≥" (community ≥2/3, ops ≥1/2, emergency ≥2/3 — CONTRACT §4) đã được Proposal
           validator ép ở ExecuteProposal; Treasury tin cờ + NFT. (tham số ngưỡng mở — DAO định.)
           > Vì sao Model A (xem §7.2): nếu gói Release + Execute CÙNG tx thì Execute phải SPEND proposal
           > UTxO → proposal nằm ở regular inputs, KHÔNG còn ở reference_inputs → C-REL-1 (list.find
           > reference_inputs) FAIL. Hai cơ chế (đọc ref vs spend execute) loại trừ nhau trong cùng tx.
           > Chọn 2 tx tuần tự (Execute trước, Release sau, đọc ref) → C-REL-1 nhất quán, không đua.

C-REL-3  Khớp đích chi (HARD BLOCKER — sửa audit finding 7, KHÔNG chỉ [cần verify]):
           tổng các ReleaseDraw (bucket, asset, amount, to) phải KHỚP nội dung proposal.
           Proposal datum cam kết một "spend spec" (hash danh sách draw) → Release kiểm
             hash(draws) == proposal.spend_spec_hash. Chống chi sai địa chỉ/sai số so với điều đã duyệt.
           ⛔ HARD BLOCKER: field `spend_spec_hash` (+ `released_cumulative` nếu vesting) CHƯA tồn tại
           trong Governance ProposalDatum → validator Release như đặc tả KHÔNG THỂ build cho tới khi
           Governance thêm field. PHẢI chốt với Governance TRƯỚC khi code Release (nâng Câu hỏi treo #1
           thành điều kiện chặn DoD — §12). Thiếu spend_spec_hash ⇒ Release = KÉT KHÔNG KHÓA ĐÍCH
           (cho chi sai địa chỉ/sai số). Trong giai đoạn beacon-giả-lập (EXEC §6.1 M3): KHÔNG được merge
           Release thiếu spend_spec_hash check vào nhánh có thể lên Preview/Mainnet — beacon giả lập
           PHẢI mang một field tương đương để C-REL-3 thực thi thật, nếu không Release vô nghĩa.

C-REL-4  Singleton custody theo SCRIPT HASH (như C-COL-1) — chống double-satisfaction qua nhiều
           custody UTxO khác stake cred (audit C1/C2).

C-REL-5  Bảo-toàn-value PER-ASSET, ra ĐÚNG số duyệt:
           ∀ asset a:  custody_out.value(a) == custody_in.value(a) − Σ_{draw.asset=a} draw.amount
           (đẳng thức tuyệt đối — không dư không thiếu; mọi asset khác giữ nguyên → chống drain M1.)

C-REL-6  Trừ đúng bucket trong sổ:
           ledger_out[(b,a)] == ledger_in[(b,a)] − Σ_{draw: bucket=b,asset=a} draw.amount
           ∧ draw.amount ≤ ledger_in[(b,a)]   (không rút quá số dư bucket).

C-REL-7  Người nhận đúng — đối chiếu TỔNG per (to,asset), chống double-satisfaction (sửa finding 8):
           gộp draw theo khóa (to, asset) TRƯỚC, rồi với mỗi (to,asset):
             Σ_{output o: o.address==to} o.value(asset)  >=  Σ_{draw: draw.to==to ∧ draw.asset==asset} draw.amount
           VÀ ∀ draw: draw.to ≠ custody address (tiền thật rời treasury).
           > KHÔNG dùng "tồn tại MỘT output ≥ amount" cho TỪNG draw độc lập: hai draw cùng (to,asset)
           > có thể cùng khớp MỘT output value=amount1 (mỗi draw "tìm thấy" cùng output) → chi 1 lần
           > nhưng trừ sổ 2 lần — đúng mẫu double-satisfaction kinh điển (§10). Tổng-khớp + C-REL-5
           > (value rời custody == Σ draw, đẳng thức) khóa CẢ HAI đầu (value vào nhận = value rời kho).

C-REL-8  Time-lock (CONTRACT §4): epoch hiện tại ≥ proposal.execute_after_epoch (multi-sig council
           + time-lock). get_epoch(tx, ms_per_epoch). (độ trễ time-lock tham số mở — DAO định.)

C-REL-9  receipt_root cập nhật cho khoản chi (đối xứng C-COL-6) — audit dòng tiền ra.

C-REL-10 KHÔNG mint (assets.is_zero(tx.mint)) — release không tạo/đốt token. LAMP fixed-supply.
```

### 7.2 Vì sao reference input, KHÔNG spend Proposal
- Spend Proposal trong tx release sẽ **tiêu** UTxO proposal → chỉ một release/proposal, và phá vòng
  đời Governance (Tallied→Executed do Governance kiểm soát). Đọc bằng **reference input** giữ proposal
  nguyên (CIP-31): [CIP-31 reference inputs](https://cips.cardano.org/cip/CIP-31).
- Nếu proposal cho phép chi nhiều đợt (vesting), mỗi đợt là một Release đọc cùng proposal ref +
  time-lock tăng dần; sổ bucket giảm dần. Proposal datum cần `released_cumulative` để chống chi vượt
  tổng duyệt → ⛔ **HARD BLOCKER** (sửa audit finding 7): field này CHƯA có trong Governance
  ProposalDatum, phải chốt với Governance TRƯỚC khi code Release vesting (§12, không chỉ [cần verify]).
  Đây là mẫu `redeemed_cumulative` của Distribution áp cho release.

> **Race liveness — CHỐT MODEL A (sửa audit finding 5):** Execute và Release là HAI tx tuần tự, KHÔNG
> gói chung. Lý do: Execute SPEND proposal UTxO (đổi Tallied→Executed) → proposal thành REGULAR INPUT,
> rời reference_inputs → C-REL-1 (`list.find(tx.reference_inputs, ...)`) FAIL. Vậy gói chung tự phá
> C-REL-1. Trình tự đúng: (1) Governance làm tx Execute (spend proposal, status→Executed); (2) Release
> sau đó đọc proposal đã Executed qua REFERENCE INPUT (C-REL-1 nhất quán). Proposal sau Executed là
> UTxO bền (Governance không spend lại) → nhiều Release/đọc song song an toàn, không đua spend↔ref.
> (Nếu sau này thật cần gói chung — Model B — phải sửa C-REL-1 thành `list.find(tx.inputs, ...)` khi
> đồng-execute; v1 KHÔNG chọn B để giữ C-REL-1 đơn giản. Đồng bộ Governance §12.)

---

## 8. Nhánh `Rebalance` — chuyển nội bộ bucket (DAO duyệt)

DAO muốn chuyển từ ops→community: value custody **KHÔNG đổi**, chỉ sổ:
```
C-RBL-1  Như C-REL-1/2: proposal_ref Tallied chứng thực việc rebalance.
C-RBL-2  ∀ asset a:  custody_out.value(a) == custody_in.value(a)   (value bảo toàn TUYỆT ĐỐI).
C-RBL-3  Sổ: ledger_out = move(ledger_in, moves); Σ ledger không đổi; mỗi from bucket đủ số dư.
C-RBL-4  Singleton custody theo script hash; KHÔNG mint.
```
Tách `Rebalance` khỏi `Release` để **value-conservation tuyệt đối** (không có đường ra) — giảm bề mặt
tấn công của nhánh chi.

---

## 9. Migrate — nạp treasury payment hiện có của generators

Generators MAGIC (Vacuum/Instant/Schedule…) hiện trả LAMP về một `treasury_addr` đơn giản (bất biến
`treasury_receives_lamp >= lamp_paid`, [vault.ak](../../MAGIC/VacuumGen/onchain/validators/vault.ak)).
Hai con đường tích hợp:

**(a) Migrate value cũ (một lần) — `MigrateIn`:** (param thêm `old_treasury_hash: ByteArray` cho instance)
```
C-MIG-1  Spend UTxO treasury cũ tại CHÍNH old_treasury_hash → tạo 1 custody output instance mới.
         Singleton ĐÍCH: count_outputs_at_script(tx.outputs, own_hash) == 1.

C-MIG-2  Khóa NGUỒN theo script hash (sửa audit finding 6 — chống trộn UTxO lạ vào Σ source):
           let k = count_inputs_at_script(tx.inputs, old_treasury_hash)   // số source thật tại old hash
           k == source_count_declared (redeemer khai báo, hoặc ép k == số input KHÔNG ở own_hash)
           ∀ asset a:  custody_out.value(a) == Σ_{i: is_at_script(i, old_treasury_hash)} i.value(a)
         ⇒ Σ source CHỈ gộp UTxO tại old_treasury_hash; input lạ (script/ví khác) KHÔNG được chen vào
           Σ rồi rút qua custody_out sai. (Trước đây Σ source_in mở → lỗ hổng nạp giả/double-satisfaction.)

C-MIG-3  ledger khởi tạo: toàn bộ value vào bucket "unallocated" (bucket_id dành riêng) — DAO phân
         bổ sau bằng Rebalance. Bất biến sổ↔value (§3) giữ.

C-MIG-4  Authorize — CHỐT MỘT cơ chế on-chain (sửa audit finding 6, bỏ "HOẶC" mơ hồ):
           multisig council M-of-N:  ∀ key ∈ council_keys cần thiết: list.has(tx.extra_signatories, key)
           (hoặc đếm ≥ M chữ ký council), KÈM one-shot guard: MigrateIn chạy ĐÚNG MỘT LẦN/instance
           (vd tiêu một bootstrap-NFT one-shot, mẫu beacon_nft.ak). Vì MigrateIn là bootstrap một lần,
           ưu tiên khóa CHẶT (multisig + one-shot), KHÔNG để cờ proposal mơ hồ.

C-MIG-5  KHÔNG mint LAMP/accepted (per-asset, như C-COL-7 — finding 4): ∀ (p,n) ∈ accepted_assets ∪
         {LAMP}: tx.mint.quantity_of(p,n) == 0. (Bootstrap-NFT one-shot policy KHÁC được phép.)
```

**(b) Đổi `treasury_addr` của generators sang địa chỉ custody instance (không cần migrate value):**
- Generators param hóa `treasury_addr`; chỉ cần **deploy lại** với `treasury_addr = custody instance
  address` thì mọi collect tương lai chảy thẳng vào custody.
- ⚠️ Nhưng generators hiện kiểm `o.address == treasury_addr` (full-address) + `received >= amount`
  với **NoDatum/InlineDatum tùy ý**. Để custody validator nhận được collect đúng sổ, output tới
  custody PHẢI mang datum hợp lệ. → cần **shim**: hoặc (i) generators nâng cấp để gọi đúng
  `Collect{items}` (đổi redeemer path), hoặc (ii) một **adapter tx** off-chain gộp output generators
  rồi `Collect` lại vào custody trong cùng settlement. Mẫu (ii) **không** đụng code generators (an
  toàn nhất cho v1 — chi tiết EXEC). **[cần verify]** generators có cho phép output tới script address
  mang datum không (đọc lại constraint từng generator).

**Khuyến nghị (4 trục):** v1 chọn **(b-ii) adapter off-chain** — không sửa generators đang live
Preview (giảm rủi ro hồi quy), value chảy vào custody qua batch `Collect`, tận dụng nguyên bất biến
generators sẵn có. Migrate value cũ (a) chỉ chạy một lần lúc bootstrap instance.

---

## 10. Chống double-satisfaction — đếm theo PAYMENT SCRIPT HASH (xuyên suốt)

Tái dùng nguyên `util.count_inputs_at_script` / `count_outputs_at_script` /
`input_at_script` / `output_at_script` (đã chứng minh fix C1/C2 trong
[util.ak test `script_count_catches_stake_cred_double`](../Distribution/onchain/lib/magiclamp/lampdist/util.ak)).
Mọi nhánh ép **đúng 1 custody input + 1 custody output theo script hash** → không thể:
- Tạo 2 custody UTxO khác stake cred rồi release cả hai bằng 1 proof (C1/C2).
- Drain asset phụ trong khi delta asset chính đúng (M1) — vì bảo-toàn-value áp **per-asset**.
- Thỏa bất biến rỗng do custody trùng ví (C-COL-8 / C-REL-7 ép địa chỉ tách).

> **Cảnh báo cấu hình đa thuê bao (sửa audit finding 12 — kiểm ở bootstrap/off-chain, KHÔNG chỉ
> on-chain):** C-COL-8/C-REL-7 ép custody output ở `Script(own_hash)` CỦA CHÍNH custody validator, và
> C-COL-1/C-REL-4 ép custody_in/out cùng own_hash (singleton). Nhưng open SDK cho phép caller LÀ một
> script — một instance độc hại có thể đặt `governance_ref` hoặc treasury trỏ về CHÍNH script caller,
> vẫn qua được check "là Script address". Vì vậy bootstrap PHẢI bảo đảm:
>   • `governance_ref ≠ own_hash` (cổng release không trỏ về chính custody),
>   • payment script hash của mọi caller được chấp nhận ≠ `own_hash` (caller không trùng custody),
>   • `old_treasury_hash` (MigrateIn) ≠ `own_hash`.
> Đây là kiểm tra CẤU HÌNH instance (off-chain/bootstrap) — ghi vào **EXEC bootstrap checklist**.

Nền tảng lý thuyết double-satisfaction:
[Plutus common weaknesses — double satisfaction](https://plutus.cardano.intersectmbo.org/docs/working-with-scripts/common-weaknesses/),
[MLabs eUTxO vulnerabilities](https://github.com/mlabs-haskell/Hydra-Auction).

---

## 11. Bộ test bắt buộc (như Distribution — mock Transaction, chạy `aiken check`)

| Test | Mục | Kỳ vọng |
|---|---|---|
| `collect_happy` | thu 1 asset, cut đúng bucket, sổ khớp | pass |
| `collect_batch_multi_asset` | lô N item LAMP+ADA+token | pass |
| `collect_underpay` | custody nhận < Σ cut | **fail** (C-COL-2) |
| `collect_drain_other_asset` | tăng LAMP nhưng rút ADA | **fail** (M1 per-asset) |
| `collect_double_custody` | 2 custody input khác stake cred | **fail** (C1/C2) |
| `collect_custody_eq_wallet` | custody == ví caller | **fail** (C-COL-8) |
| `collect_ledger_mismatch` | sổ_out ≠ value_out | **fail** (§3 bất biến) |
| `collect_tip_lamp` | nộp LAMP DƯ hơn Σ cut (custody.value(LAMP) > in + Σ cut) | **fail** (C-COL-2 `==` cho LAMP, finding 3) |
| `collect_mint_lamp` | gói mint LAMP vào tx collect | **fail** (C-COL-7 per-asset, finding 4) |
| `collect_ledger_sum_ne_cut` | Σ_b Δledger ≠ Σ cut (cộng dư/rớt oil) | **fail** (C-COL-5a, finding 2) |
| `release_happy` | proposal Tallied + NFT đúng, rút đúng bucket | pass |
| `release_no_proposal` | thiếu reference input proposal | **fail** (C-REL-1) |
| `release_fake_nft` | proposal ref không có NFT đúng policy | **fail** (C-REL-1) |
| `release_not_executed_status` | status=Open/Closed | **fail** (C-REL-2 chỉ Executed) |
| `release_overdraw_bucket` | rút > balance bucket | **fail** (C-REL-6) |
| `release_drain_ada` | LAMP delta đúng, rút lén ADA | **fail** (C-REL-5) |
| `release_wrong_recipient` | to ≠ proposal spend_spec | **fail** (C-REL-3) |
| `release_not_executed` | status=Tallied (chưa Executed) | **fail** (C-REL-2 Model A, finding 5) |
| `release_double_sat_recipient` | 2 draw cùng (to,asset), 1 output thỏa cả hai | **fail** (C-REL-7 tổng-khớp, finding 8) |
| `release_before_timelock` | epoch < execute_after | **fail** (C-REL-8) |
| `release_double_custody` | 2 custody UTxO | **fail** (C-REL-4) |
| `rebalance_value_conserved` | chuyển bucket, value giữ nguyên | pass |
| `rebalance_value_changed` | rebalance mà value đổi | **fail** (C-RBL-2) |
| `migrate_full_value` | nạp đủ value treasury cũ (đúng old_treasury_hash) | pass |
| `migrate_short` | nạp thiếu | **fail** (C-MIG-2) |
| `migrate_foreign_input` | trộn UTxO lạ (khác old_treasury_hash) vào Σ source | **fail** (C-MIG-2 khóa hash, finding 6) |
| `migrate_no_council_sig` | thiếu chữ ký council / one-shot guard | **fail** (C-MIG-4, finding 6) |

Evidence bắt buộc: `aiken check` output pass FULL (như chuẩn build mode — không chỉ structure).

---

## Tham số mở (DAO định)
- `cut_bps` — bps cut về bucket khi collect. **Ở DATUM** (finding 10 — không phải param validator,
  để DAO đổi không phải đổi script hash).
- `split_table` weights — % cut chia mỗi bucket. **CHỈ dùng nếu instance bật model đa-bucket**; đường
  collect mặc định ĐƠN-BUCKET theo `item.category` (finding 2).
- Ngưỡng pass mỗi loại bucket (community ≥2/3, ops ≥1/2, emergency ≥2/3 — dạng "≥", DAO chỉnh).
- Time-lock release `execute_after_epoch` delta.
- N tối đa mỗi batch `Collect` (theo tx-size + ExUnit budget thực đo).
- `reserved_min_ada` mỗi custody UTxO.
- Danh mục `bucket_id` + `accepted_assets` (trong datum — DAO thêm/bớt không đổi script).
- Số shard custody (1 hay vài — nếu contention cao, xem Câu hỏi treo).

## Phụ thuộc
- **Governance / VotingPower** — phơi `ProposalDatum{status, yes/no_power, voter_count}` +
  Proposal authenticity NFT (policy `proposal_policy`). Treasury đọc qua reference input
  ([Governance TECH](../Governance/VotingPower/TECH.md)). ⛔ **HARD BLOCKER (finding 7): cần thêm field**
  `spend_spec_hash` (+ `released_cumulative` nếu vesting) vào ProposalDatum — phải chốt với Governance
  TRƯỚC khi code Release (không chỉ phối hợp; thiếu → Release = két không khóa đích).

> **Đồng bộ MATH cần làm (audit findings 1,2,3,9,10,11):** (1) MATH §2.3 INV-COLLECT giữ `≥` nhưng làm
> rõ chỉ áp cho ADA min-ADA overhead; cho LAMP/token là `==` (khớp C-COL-2 mới). (2) MATH §10 #2 đã
> chốt category rời rạc — TECH nay khớp (bỏ đa-bucket khỏi collect). (9) MATH §5.1 bỏ "emergency bucket"
> khỏi liệt kê của MỘT instance I, thêm `I_emg` như phần tử RIÊNG của T. (10) MATH §1: `cut_bps` từ
> "tham số instance" → "tham số datum". (11) MATH §6.3/§7 đổi `count_*_at_payment_script_hash` →
> `count_*_at_script` cho khớp `util.ak` thật (L59/L63 — đã verify; helper so theo payment credential,
> bỏ stake, `is_at_script` L94-99). TECH dùng ĐÚNG tên `count_*_at_script` — giữ nguyên.
- **`util.ak` Distribution** — `count_*_at_script`, `is_at_script`, `script_address`, builders test.
- **Generators MAGIC** — nguồn collect (caller); migrate/adapter (§9).
- **Oracle** — NGOÀI Treasury; app định giá trước khi gọi collect.
- **Aiken stdlib** assets/transaction/dict/crypto; **CIP-31/33/55/1694**.

## Câu hỏi còn treo
1. ⛔ **HARD BLOCKER — DoD chặn (finding 7): `spend_spec_hash` trong ProposalDatum** — Governance ghi
   hash danh sách draw để Release khớp (C-REL-3). PHẢI Governance thêm field TRƯỚC khi code Release.
   Thiếu ⇒ Release không biết proposal duyệt chi cho ai/bao nhiêu → KÉT KHÔNG KHÓA ĐÍCH (chi sai).
   Không được merge Release thiếu check này vào nhánh lên được Preview/Mainnet (kể cả giai đoạn
   beacon-giả-lập M3 — beacon giả lập phải mang field tương đương). **Điều kiện chặn DoD.**
2. ⛔ **Vesting / chi nhiều đợt (finding 7): `released_cumulative` trong ProposalDatum** (mẫu
   Distribution) — HARD BLOCKER nếu v1 hỗ trợ vesting. Nếu v1 CHỈ chi một lần (không vesting) → có thể
   hoãn field này nhưng phải ép `released_cumulative` ngầm = toàn bộ (một Release dùng hết proposal).
   Chốt: v1 có vesting hay chỉ chi một lần?
3. **Custody shard — QUYẾT-ĐỊNH-CÓ-SỐ-ĐO (T4, không còn treo mở):** một UTxO custody là điểm contention
   tuần tự. EXEC **phải đo throughput** (batch N/tx × tx/block so tải tổng nhiều thuê bao) TRƯỚC khi
   chốt; nếu nghẽn → **shard-by-asset** (mỗi shard 1 UTxO, bất biến per-shard, off-chain cộng tổng cho
   circulating — §1). v1 đề xuất **1 custody** (đủ vì collect đã batch) nhưng kèm điều kiện đo, không
   mặc định mù. Shard theo ASSET (không theo bucket) để bất biến per-asset độc lập không vỡ + giảm K·M
   mỗi shard (§3).
4. **Migrate (a) vs (b)** — chốt con đường nạp generators (đề xuất b-ii adapter, không sửa generators
   live). Cần EXEC xác nhận generators cho output script-address mang datum.
5. **Emergency instance riêng** — xác nhận emergency = Custody instance tách script hash (isolation
   physical), KHÔNG dòng sổ. Council/threshold riêng.
6. **Conway `donateToCardanoTreasury`** — tx-level field, không qua validator này. Có cần một helper
   off-chain trong SDK Treasury để dựng tx donate? (ngoài on-chain scope, nhưng caller cần.)

---

## Phản hồi audit (vòng 2026-06-05)

13 finding rà phản biện. Mỗi mục: quyết định + nơi sửa.

| # | Mức | Sửa gì | Nơi |
|---|---|---|---|
| 1 | critical | C-COL-2 dùng `cut` (KHÔNG `amount`), khớp MATH §2.3 `Δ_I(a) ≥ cut(a)`; bỏ dòng `+ Σ item.amount`; xóa câu "phần tăng = Σ amount". Custody chỉ chứng kiến cut; residual ngoài bất biến. | §4.2 C-COL-2 |
| 2 | critical | Chốt model ĐƠN-BUCKET (cut → `item.category`), bỏ split_table khỏi đường collect; thêm C-COL-5(a) `Σ_b Δledger == Σ cut` nối value↔sổ; split_table chỉ giữ cho đa-bucket kèm kỹ thuật PARTITION. | §4.2 C-COL-4/C-COL-5, datum |
| 3 | major | C-COL-2: `==` cho LAMP/token (loại tip LAMP làm vỡ sổ); `≥` CHỈ cho ADA min-ADA overhead, dư vào bucket ADA reserved riêng (không vào sổ LAMP). | §4.2 C-COL-2 |
| 4 | major | C-COL-7: bỏ cửa hậu "tx generator mint riêng"; thay ràng buộc per-asset `mint.quantity_of(p,n)==0 ∀ accepted ∪ {LAMP}`. Áp cả MigrateIn (C-MIG-5). | §4.2 C-COL-7, §9 |
| 5 | major | Chốt Model A: Execute (Governance, tx riêng) trước, Release đọc proposal Executed qua ref input. C-REL-2 chỉ `Executed` (bỏ Tallied). Bỏ đề xuất gói chung phá C-REL-1. | §7.1 C-REL-2, §7.2 |
| 6 | major | MigrateIn: param `old_treasury_hash`, C-MIG-2 khóa Σ source theo hash (chống input lạ); C-MIG-4 chốt multisig council + one-shot guard (bỏ "HOẶC" mơ hồ). | §9 |
| 7 | major | `spend_spec_hash` + `released_cumulative` nâng từ [cần verify] → ⛔ HARD BLOCKER DoD; cấm merge Release thiếu check vào nhánh Preview/Mainnet (kể cả beacon giả lập). | §7.1 C-REL-3, §7.2, Phụ thuộc, Câu hỏi treo #1/#2 |
| 8 | major | C-REL-7: đối chiếu TỔNG per (to,asset) (gộp draw trước), thay "tồn tại 1 output ≥ amount" — chống double-satisfaction recipient. | §7.1 C-REL-7 |
| 9 | minor | Emergency = instance riêng `I_emg`; circulating = S_total − Σ_{I ∈ T, kể cả I_emg} bal_I. Off-chain phải cộng emergency. MATH §5.1 cần sửa (đồng bộ). | §1 |
| 10 | minor | `cut_bps` chuyển từ param validator → DATUM (DAO đổi không đổi script hash). | §2, datum, C-COL-4 |
| 11 | minor | TECH dùng đúng `count_*_at_script` (verify util.ak L59/L63/L94). MATH §6.3/§7 dùng sai tên `_at_payment_script_hash` → cần sửa MATH (đồng bộ). | Phụ thuộc (note) |
| 12 | nit | Cảnh báo cấu hình: `governance_ref ≠ own_hash`, caller ≠ own_hash, old_treasury_hash ≠ own_hash → kiểm ở EXEC bootstrap checklist. | §10 |
| 13 | nit | receipt_root encode: canonical CBOR field cố định (mẫu compute_batch_id), hạ từ [cần verify] treo → blocker M2. | §6 |

**Không bỏ qua finding nào** — cả 13 đã áp. Hai finding chạm Governance (7) + MATH (1,2,9,10,11) ghi rõ
phần "Đồng bộ MATH cần làm" + Phụ thuộc; chúng là sửa Ở FILE KHÁC (ngoài TECH), ghi lại để truy vết
chứ TECH không tự sửa MATH/Governance trong vòng này.

---

## Phản hồi reconcile 2026-06-05

Áp 4 quyết định ghim cứng từ **Treasury CONTRACT §9 (T1–T5)** + **Gov CONTRACT §5 (D1–D9)**. Chỉ đụng
mục liên quan; phần còn lại giữ nguyên. Số cụ thể vẫn "tham số mở (DAO định)" trừ cái CONTRACT đã chốt.

| Áp | Nơi sửa | Đã sửa gì | Cite |
|---|---|---|---|
| **T1** | §7.1 (mới: "Release-gate = Model A duy nhất") + C-REL-2/3 | Khẳng định Treasury KHÔNG tự tính ngưỡng (bỏ mọi bất đẳng thức tự-kiểm); bảng "đúng 4 thứ kiểm": `status==Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`. Không đọc yes/no_power để so ngưỡng (đóng GAME-1). | Treasury §9 **T1** = Gov §5 **D3** |
| **T2** | §4.2 C-COL-4 (ghi chú split_table) + Tham số mở | Sửa cite "MATH chốt đa-bucket" → **dạng CHÍNH của MATH là ĐƠN-BUCKET** `Δ_bucket(category)==cut`; split_table/đa-bucket = TÙY CHỌN instance; MATH hạ PARTITION-MULTI xuống mục tùy chọn (hết cite chéo ngược). | Treasury §9 **T2** |
| **T3** | §3 (bất biến sổ↔value) | Đổi sang **INCREMENTAL**: chỉ kiểm `Σ_b Δledger[(b,a)]==Δvalue(a)` cho `a ∈ A_Δ`; asset không đụng → value bảo toàn, KHÔNG fold toàn sổ. Thêm phân tích **ExUnit K·M** (giải mã datum O(K·M) + cập nhật O(\|A_Δ\|·K) + fold O(N)) + **trần `KM_max`/`N_max` đo-thực TRƯỚC M2**; chạm trần → shard (T4). | Treasury §9 **T3** |
| **T4** | §1 (note custody throughput) + Câu hỏi treo #3 | Ghi rõ **đo throughput TRƯỚC** khi chốt 1 UTxO (EXEC đo batch N/tx × tx/block so tải đa thuê bao); **shard-by-asset nếu nghẽn** (per-shard invariant, off-chain cộng tổng circulating + I_emg). #3 nâng từ "treo mở" → quyết-định-có-số-đo. | Treasury §9 **T4** |

Bất biến KHÔNG đụng tới (giữ nguyên): LAMP không burn `Σ_out=Σ_in` per-asset (§0, §3, C-COL-2/C-REL-5);
per-capita không token-weighted (Treasury chỉ đọc cờ Gov, không đọc power thô — T1); clamp BFT 1/21 +
sàn `|S|≥F` do Governance ép, Treasury không nhúng (T1/D3); định giá ở app (§0 "KHÔNG thuộc spec").
