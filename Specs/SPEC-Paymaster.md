# SPEC — Paymaster (MAGIC-as-gas, App Sponsor)

**Trạng thái:** DESIGN SPEC (chưa code). Dự thảo 2026-06-10.
**Nguồn bám:** `DESIGN-fee-paymaster-reserve.md §B`; `ConsumeMAGIC/FEAT.md`, `ConsumeMAGIC/TECH.md`,
`ConsumeMAGIC/MATH.md`; `Treasury/CONTRACT.md`; `CLAUDE.md` (ràng buộc vĩnh viễn).

> Spec tổng hợp (1 file) bao gồm: use cases, flow end-to-end, fee accounting model, lý do không
> oracle (MVP), security considerations, MAGIC consumption pricing. Tách thành FEAT/MATH/TECH/EXEC
> khi bước sang giai đoạn build.

---

## RÀNG BUỘC VĨNH VIỄN (không vi phạm)

- MAGIC = token native mint/burn được on-chain (policy MAGIC, `tx.mint` âm = đốt). "Không
  transferable" theo LAMP §1.5 nghĩa là không có DEX pair MAGIC↔ADA — KHÔNG phải "không phải
  token". Nguồn: `ConsumeMAGIC/FEAT.md §1`, `ConsumeMAGIC/onchain/plutus.json` (validator
  `consume.consume.spend` compiled).
- LAMP cố định 36 tỷ **LAMP** (= 3,6×10^16 oildrop), KHÔNG burn. `oildrop = LAMP × 10^6`,
  `nanogic = MAGIC × 10^9`.
  Nguồn: `Treasury/CONTRACT.md §5`.
- BigInt everywhere — KHÔNG Number cho amounts (Q = 10^9, sequential floor).
- P8: Aiken ↔ TypeScript bit-identical.
- eUTXO: 1 UTxO spend 1 lần/tx. Double-satisfaction cần guard riêng (own_hash).

---

## 0. Bối cảnh + Vấn đề

**Vấn đề:** Người dùng cần ADA để trả phí mạng và LAMP để trả phí giao thức khi tương tác với
MAGIC protocol. Rào cản này cản người mới hoặc user phổ thông chưa có ADA/LAMP.

**Giải pháp Paymaster:** App (đối tác hoặc nền tảng) đứng ra trả ADA + LAMP hộ user. User
chỉ cần đốt MAGIC từ vault của mình — nhiên liệu nghiệp vụ họ đã có. App nhận lại
`AppEconomics` reward sau từ Treasury.

**Điều Paymaster KHÔNG làm:**
- KHÔNG swap MAGIC↔ADA hay MAGIC↔LAMP (không DEX, không AMM).
- KHÔNG cần oracle giá LAMP/ADA ở MVP (app tự định tỷ giá).
- KHÔNG phát hành token mới. KHÔNG mint MAGIC.
- KHÔNG thay đổi tổng cung LAMP.

---

## 1. Use Cases

### UC-1: App sponsor phí cho user mới
> User mới của OriLife chưa có ADA/LAMP. App OriLife muốn onboard họ mà không bắt user tự
> mua ADA trước. User có MAGIC trong vault (từ loyalty rewards). App trả ADA+LAMP hộ, user
> đốt MAGIC tương ứng. App hạch toán khoản chi này vào budget sponsor, bù lại qua
> AppEconomics reward epoch sau.

### UC-2: App giảm ma sát giao dịch thường xuyên
> User OriLife đăng ký trace bò thường xuyên. Mỗi tx cần LAMP. App tự động sponsor phí,
> user chỉ approve tx. Không cần user quản lý LAMP wallet thủ công.

### UC-3: App premium — phí zero cho subscriber
> App premium: user trả subscription fee (fiat hoặc token khác) off-chain. App sponsor toàn bộ
> LAMP/ADA on-chain. User không nhận ra họ đang dùng MAGIC protocol.

### UC-4: Giới hạn budget sponsor theo DID (chống spam)
> App muốn sponsor nhưng giới hạn: mỗi user (PhoenixKey DID) không nhận quá X LAMP/epoch và
> tổng app không vượt Y LAMP/epoch. Nếu vượt → user tự trả hoặc tx từ chối.

---

## 2. Actors

| Actor | Vai trò |
|---|---|
| **User (Holder)** | Sở hữu vault UTxO (EngageDatum); đốt MAGIC để kích hoạt nghiệp vụ |
| **App** | Đối tác đăng ký `SponsorPolicy`; trả ADA+LAMP hộ user; nhận AppEconomics reward |
| **SponsorMeter keeper** | Permissioned: cập nhật `SponsorMeter` epoch-mới (hoặc tự cập nhật trong tx sponsor) |
| **DAO / Protocol** | Phê duyệt `SponsorPolicy` qua Governance; đặt `max_per_did_per_epoch`, `max_global_per_epoch` |
| **Treasury** | Nơi nhận phần cut của giao thức từ `collectToTreasury`; phân bổ AppEconomics |

---

## 3. Flow end-to-end

### 3.1 Happy path — 1 user, 1 nghiệp vụ, app sponsor đầy đủ

```
User                    App tx-builder              Cardano ledger
  │                          │                            │
  │── request op ──────────► │                            │
  │                          │── kiểm SponsorPolicy ──────►
  │                          │   (budget available?)      │
  │                          │── kiểm SponsorMeter ───────►
  │                          │   (did quota, global quota) │
  │                          │── build tx:                 │
  │                          │    spend vault UTxO         │
  │                          │    mint MAGIC −required     │
  │                          │    output vault UTxO'       │
  │                          │    read SponsorPolicy ref   │
  │                          │    spend SponsorMeter       │
  │                          │    output SponsorMeter'     │
  │                          │    input ADA+LAMP từ app    │
  │                          │    output phí giao thức     │
  │                          │    app cosign (extra_sig)  │
  │                          │── submit ───────────────────►
  │                          │                            │── validate consume.ak
  │                          │                            │── validate paymaster.ak
  │                          │                            │   PM-1..6 ✓
  │◄── confirmed ─────────── │◄───────────────────────────│
```

**Điều kiện kết thúc:** MAGIC đốt đúng `required`; ADA+LAMP đến đích giao thức; `SponsorMeter`
cập nhật quota; `EngageDatum.consumed_count++`; App được ghi nhận trong receipt Treasury.

### 3.2 Luồng 3 vai trong 1 tx

Tách bạch 3 vai — KHÔNG gộp polymorphic:

| Vai | Hành động | Validator ép |
|---|---|---|
| (1) User đốt MAGIC | `consume.ak` `Consume` redeemer, `tx.mint` MAGIC âm | C-CM-1..5 (FEAT.md §4) |
| (2) App trả phí hộ | ADA input từ app wallet, LAMP input từ app wallet; app cosign | PM-1 (app_authority ∈ extra_signatories) |
| (3) App nhận reward | Ghi receipt vào Treasury `collectToTreasury`; nhận AppEconomics | Treasury Collect validator |

Cả 3 vai trong **1 tx** — đây là điểm cốt lõi của Paymaster: atomicity đảm bảo không app trả
mà user không đốt, và ngược lại.

### 3.3 Fallback — user tự trả (budget sponsor cạn)

Nếu `SponsorMeter` cho thấy quota cạn:
- App tx-builder KHÔNG bao gồm sponsor path.
- User tự cung cấp ADA+LAMP input bình thường (tx ConsumeMAGIC tiêu chuẩn, không cần paymaster.ak).
- Không có trạng thái lỗi on-chain — chỉ là tx khác không có bước sponsor.

### 3.4 Flow cập nhật SponsorPolicy (DAO)

DAO proposal → Executed → Treasury release thực thi → `SponsorPolicy` beacon cập nhật tham số
`(max_per_did, max_global, lamp_per_magic_q, ada_per_magic_q)`. App tx-builder đọc beacon mới
qua reference input kỳ tiếp theo.

---

## 4. Fee Accounting Model

### 4.1 Nguyên lý — phí là kế toán, không chuyển vật lý mỗi tx

Theo mô hình Treasury (`CONTRACT.md §3`): phí **không chuyển vật lý** mỗi micro-tx (tránh
min-ADA bloat). Thay vào đó:

```
Một settlement tx = nhiều Paymaster ops gộp lại
  → collectToTreasury(LAMP, Σ cut, app_id, "paymaster") một lần
  → receipt (app_id, asset, amount, cut, epoch) ghi sổ
```

**Chi phí tức thời vs ghi sổ:**
- ADA phí mạng: app trả vật lý trong tx (không thể trì hoãn — ledger rule).
- LAMP phí giao thức: app có thể gộp nhiều ops vào 1 settlement tx (giống generators).
- MAGIC burn: xảy ra ngay trong tx ConsumeMAGIC (tx.mint âm — ledger rule).

### 4.2 Ba tầng phí (Multi-Tier Fee)

Paymaster nằm trong khung Multi-Tier Fee Composable (`DESIGN §A`):

| Tầng | Tham số | Ép bởi |
|---|---|---|
| **Protocol** | `min_lamp_per_op` | DAO beacon — validator đọc ref input |
| **Platform** | `var_lamp_bps` (trên min) + `min_token`/`var_token_bps` | Platform operator (trong biên DAO) |
| **App** | `fix_lamp`, `fix_token` (phần app tự giữ) | App developer (trong biên Platform) |

Trong tx sponsor, app thu **tổng phí = Protocol + Platform + App** từ MAGIC được đốt của user.
Phần **Protocol cut** (tầng 1) vào Treasury qua `collectToTreasury`. Phần Platform và App là
kế toán nội bộ.

**Ràng buộc bắt buộc (on-chain ép):**
- `var_lamp_bps ≤ max_platform_bps` (từ Protocol beacon).
- `fix_lamp ≤ max_app_fix_lamp` (từ Protocol beacon).
- `app.platform_ref_id == plat.platform_id` (không dùng platform giả).

### 4.3 Tỷ giá LAMP/MAGIC và ADA/MAGIC

**MVP — app tự định (không oracle):**
```
lamp_per_magic_q   : Int   // LAMP nhận được mỗi nanogic MAGIC đốt, Q-format
ada_per_magic_q    : Int   // ADA nhận được mỗi nanogic MAGIC đốt, Q-format
```

Tỷ giá được app đặt trong `SponsorPolicy` beacon (qua DAO approval). Validator Paymaster ép:
```
lamp_sponsored ≤ ⌊ magic_burned × lamp_per_magic_q / Q ⌋
ada_sponsored  ≤ ⌊ magic_burned × ada_per_magic_q  / Q ⌋
```

**Lý do không oracle ở MVP (first-principles):**
1. Oracle Cardano (Charli3, Score DEX TWAP) là external dependency — 1 oracle down → toàn bộ
   Paymaster stop. MVP phải hoạt động độc lập.
2. Tỷ giá app-tự-định có market mechanism tự nhiên: app đặt giá quá thấp → mất tiền; quá cao →
   user không dùng. DAO có thể đặt sàn `min_lamp_per_magic_q`.
3. MAGIC consumption pricing không cần precision oracle — đây là internal accounting giữa app
   và Treasury, không phải swap.
4. Interface `oracle_nft_policy: Option<ByteArray>` được thiết kế sẵn trong
   `SponsorPolicy` (`None` = MVP tự định, `Some(policy)` = dùng CIP-31 oracle datum sau).
   Nâng cấp oracle KHÔNG cần đổi datum schema.

### 4.4 AppEconomics reward

Sau mỗi epoch, Treasury `distribute()` tính reward cho app dựa trên:
- Tổng `magic_burned` được attribute cho `app_id` trong epoch.
- Weight từ `DelegationCertificate` của các vault user.
- Nguồn: `VaultDatum.delegation_cert` — `AppAllocation.weight_bps`.

Reward được ghi vào bucket `reward` của Treasury, chi định kỳ qua release-gate Governance
(proposal "phân bổ reward epoch e" — Treasury FEAT §3).

---

## 5. MAGIC Consumption Pricing

### 5.1 Kế thừa ConsumeMAGIC pricing

Paymaster TÁI DÙNG toàn bộ pricing engine của `ConsumeMAGIC`:

```
price(op_type) = ⌊ base_price[op_type] × demand_mult / Q ⌋   (nanogic)
required(t, n) = price(t) × n
```

Nguồn: `ConsumeMAGIC/MATH.md §2.1-2.2`, `ConsumeMAGIC/onchain/lib/magiclamp/consume/pricing.ak`.

### 5.2 Đơn vị và scale

| Đơn vị | Giá trị |
|---|---|
| Q | 10^9 |
| nanogic | MAGIC × 10^9 — đơn vị nhỏ nhất |
| demand_mult | Q-format ∈ [m_min, m_max] |
| lamp_per_magic_q | Q-format (1.0 = Q = 10^9 nghĩa là 1 LAMP/MAGIC) |
| ada_per_magic_q | Q-format (1.0 = Q = 10^9 nghĩa là 1 ADA/MAGIC) |

**BigInt bắt buộc** — không Number cho mọi giá trị trên.

### 5.3 Test vectors số thật (verifiable)

**TV-PM-PRICE-01: Tính lamp_sponsored**
```
magic_burned    = 10_000_000        (0.01 MAGIC = 10^7 nanogic)
lamp_per_magic_q = 500_000_000      (0.5× Q = 0.5 LAMP / MAGIC)
Q               = 1_000_000_000
lamp_sponsored  = ⌊ 10_000_000 × 500_000_000 / 1_000_000_000 ⌋
                = ⌊ 5_000_000_000_000_000 / 1_000_000_000 ⌋
                = 5_000_000         (0.005 LAMP = 5000 oildrop)
```

**TV-PM-PRICE-02: Tính ada_sponsored**
```
magic_burned    = 50_000_000        (0.05 MAGIC)
ada_per_magic_q = 2_000_000_000     (2.0× Q = 2 ADA / MAGIC)
Q               = 1_000_000_000
ada_sponsored   = ⌊ 50_000_000 × 2_000_000_000 / 1_000_000_000 ⌋
                = ⌊ 100_000_000_000_000_000 / 1_000_000_000 ⌋
                = 100_000_000       (100 ADA = 100_000_000 lovelace)
```

**TV-PM-BUDGET-01: Per-DID cap check**
```
max_per_did_per_epoch = 10_000_000_000   (10 LAMP/DID/epoch, oildrop unit)
did_sponsored_so_far  = 8_000_000_000    (8 LAMP đã sponsor)
lamp_this_op          = 5_000_000        (0.005 LAMP mới)
8_000_000_000 + 5_000_000 = 8_005_000_000 ≤ 10_000_000_000  → ACCEPT
```

**TV-PM-BUDGET-02: Per-DID cap vượt**
```
did_sponsored_so_far  = 9_999_000_000    (9.999 LAMP)
lamp_this_op          = 5_000_000        (0.005 LAMP)
9_999_000_000 + 5_000_000 = 10_004_000_000 > 10_000_000_000  → REJECT
```

**TV-PM-BUDGET-03: Global cap**
```
max_global_per_epoch   = 100_000_000_000  (100 LAMP/epoch)
global_sponsored_epoch = 99_998_000_000   (99.998 LAMP)
lamp_this_op           = 5_000_000        (0.005 LAMP)
99_998_000_000 + 5_000_000 = 100_003_000_000 > 100_000_000_000  → REJECT (global cap)
```

---

## 6. Kiến trúc On-chain (Aiken types + Plutus Data encoding)

### 6.1 SponsorPolicy (beacon — reference input)

```aiken
// paymaster/types.ak
pub type SponsorPolicy {
  app_id               : ByteArray,         // định danh app đăng ký
  app_authority        : ByteArray,         // VerificationKeyHash bắt buộc cosign
  max_per_did_per_epoch: Int,               // oildrop — cap mỗi DID mỗi epoch
  max_global_per_epoch : Int,               // oildrop — cap toàn app mỗi epoch
  lamp_per_magic_q     : Int,               // Q-format: lamp / nanogic
  ada_per_magic_q      : Int,               // Q-format: ada / nanogic
  oracle_nft_policy    : Option<ByteArray>, // None = MVP tự định; Some = CIP-31 oracle
  epoch                : Int,               // epoch cập nhật (đơn điệu tăng)
}
```

Plutus Data: `Constr 0 [B, B, I, I, I, I, Option<B>, I]`.
Beacon mang **SponsorPolicy NFT** (one-shot, tương tự `price_nft.ak`).

### 6.2 SponsorMeter (thread NFT — 1 per app per epoch)

```aiken
pub type SponsorMeter {
  app_id              : ByteArray,
  epoch               : Int,               // epoch hiện hành
  did_lamp_map        : List<(ByteArray, Int)>, // (did_hash, lamp_sponsored) per DID
  global_lamp_epoch   : Int,               // tổng oildrop đã sponsor trong epoch
}
```

Plutus Data: `Constr 0 [B, I, List<(B,I)>, I]`.
Thread NFT (`SponsorMeter NFT`) đảm bảo chống double-spend / double-meter (1 UTxO duy nhất).

**Lưu ý eUTXO:** `did_lamp_map` là List — kích thước tăng theo số DID distinct/epoch. Nếu app
lớn (nhiều DID/epoch), cần shard per-DID hoặc Merkle approach. MVP dùng List; v1.x cần đo.

### 6.3 Mở rộng EngageDatum (blocker — cross-repo)

`ConsumeMAGIC/TECH.md §1.3` hiện có:
```aiken
pub type EngageDatum {
  owner          : ByteArray,
  consumed_count : Int,
  last_epoch     : Int,
}
```

**Cần thêm `did_commit`** (DESIGN §B — blocker):
```aiken
pub type EngageDatum {
  owner          : ByteArray,
  consumed_count : Int,
  last_epoch     : Int,
  did_commit     : Option<ByteArray>,  // blake2b256 PhoenixKey DID hash — None nếu chưa bind
}
```

Plutus Data: `Constr 0 [B, I, I, Option<B>]` (thêm field cuối — KHÔNG đảo thứ tự).
**Blocker:** cần anh giao Tuân sửa MAGIC repo trước khi build Paymaster.
**Phạm vi ảnh hưởng:** cả Paymaster (per-DID cap) lẫn VP D9 (Voting Power DID attribution).

### 6.4 PaymasterRedeemer

```aiken
pub type PaymasterRedeemer {
  // Sponsor: kích hoạt sponsor path trong tx ConsumeMAGIC
  Sponsor {
    consume_ref  : OutputReference, // input vault UTxO (consume.ak đã validate)
    sponsor_ref  : OutputReference, // input SponsorMeter UTxO
    policy_ref   : OutputReference, // reference input SponsorPolicy beacon
  }
}
```

### 6.5 Luồng eUTXO chi tiết

```
Tx PaymasterSponsor:
  inputs:
    vault_UTxO    (script: consume.ak,  datum: EngageDatum, value: ADA + engage_NFT)
    meter_UTxO    (script: paymaster.ak, datum: SponsorMeter, value: ADA + meter_NFT)
    app_wallet_UTxO (addr: app pubkey,  value: ADA + LAMP — trả phí hộ)
  reference_inputs:
    price_beacon  (script: price_param.ak, datum: PriceParam, value: ADA + price_NFT)
    policy_beacon (script: paymaster_policy.ak, datum: SponsorPolicy, value: ADA + policy_NFT)
  outputs:
    vault_UTxO'   (script: consume.ak, datum: EngageDatum',  value: ADA + engage_NFT)
                  EngageDatum': consumed_count++, last_epoch=current
    meter_UTxO'   (script: paymaster.ak, datum: SponsorMeter', value: ADA + meter_NFT)
                  SponsorMeter': did quota + global quota cập nhật
    protocol_out  (địa chỉ nhận LAMP phí giao thức, ví Treasury settlement)
  mint:
    (magic_policy, magic_name, −magic_burned)  -- âm = đốt MAGIC
  extra_signatories:
    app_authority  -- app_cosign bắt buộc
  redeemers:
    Spend(vault_UTxO): Consume { op_type, op_count, price_ref }
    Spend(meter_UTxO): Sponsor { consume_ref, sponsor_ref, policy_ref }
```

---

## 7. Validator Logic — Bất biến (Paymaster)

### 7.1 Redeemer `Sponsor`

| ID | Bất biến | Cách ép |
|---|---|---|
| PM-1 | `app_authority ∈ tx.extra_signatories` | `expect list.has(tx.extra_signatories, policy.app_authority)` |
| PM-2 | `magic_burned` đọc từ `tx.mint` thật (KHÔNG tin redeemer) | `magic_burned = -qty` từ `flatten(tx.mint)` tại (magic_policy, magic_name) |
| PM-3 | `lamp_sponsored ≤ ⌊ magic_burned × lamp_per_magic_q / Q ⌋` | kiểm giới hạn LAMP app được dùng |
| PM-4 | `ada_sponsored ≤ ⌊ magic_burned × ada_per_magic_q / Q ⌋` | kiểm giới hạn ADA app được dùng |
| PM-5 | Per-DID cap: `did_spent_epoch + lamp_this ≤ max_per_did_per_epoch` | lookup `did_lamp_map[did_hash]` trong SponsorMeter |
| PM-6 | Global cap: `global_lamp_epoch + lamp_this ≤ max_global_per_epoch` | kiểm `SponsorMeter.global_lamp_epoch` |
| PM-7 | Double-meter guard: đúng 1 meter input + 1 meter output (thread NFT) | `count_inputs_at_script == 1`, `count_outputs_at_script == 1` |
| PM-8 | Meter epoch: nếu `meter.epoch < current_epoch` → reset meter (epoch mới) | so sánh epoch, reset `did_lamp_map=[]`, `global_lamp_epoch=0` |
| PM-9 | Meter NFT bảo toàn: `Σ nft_out@script == Σ nft_in@script` | không rút thread token |
| PM-10 | Policy beacon freshness: `current_epoch - policy.epoch ≤ max_policy_stale` | tránh tỷ giá stale |
| PM-11 | `tx.mint` chỉ chứa MAGIC burn (không mint LAMP, không mint asset lạ) | mirror C-CM-1 của consume.ak |

**else(_): fail** — chặn mọi purpose ngoài spend.

---

## 8. Security Considerations

### 8.1 Threat model (MECE)

| ID | Tấn công | Biện pháp |
|---|---|---|
| PM-ATK-1 | App buộc user trả quá nhiều MAGIC | Tỷ giá `lamp_per_magic_q` / `ada_per_magic_q` qua DAO approval; user thấy số trước khi sign |
| PM-ATK-2 | App spam rút hết ngân sách sponsor | Per-DID cap (PM-5) + global cap (PM-6) on-chain |
| PM-ATK-3 | Double-meter: 2 txs cùng epoch drain gấp đôi | Thread NFT `SponsorMeter` — 1 UTxO/app/epoch (PM-7) |
| PM-ATK-4 | Khai `magic_burned` giả trong redeemer | Đọc từ `tx.mint` thật, không tin redeemer (PM-2) |
| PM-ATK-5 | Meter epoch cũ (replay SponsorMeter epoch trước) | Kiểm epoch lock; reset nếu epoch mới (PM-8) |
| PM-ATK-6 | Sybil: tạo nhiều DID để né per-DID cap | DID sinh trắc PhoenixKey — không thể clone |
| PM-ATK-7 | App không cosign (người khác submit tx) | `app_authority ∈ extra_signatories` bắt buộc (PM-1) |
| PM-ATK-8 | Policy beacon giả (không có NFT) | Kiểm SponsorPolicy NFT qty == 1 (1 policy per app) |
| PM-ATK-9 | Tỷ giá stale (policy không cập nhật lâu) | `max_policy_stale` epoch (PM-10) |
| PM-ATK-10 | Double-satisfaction: 1 burn thỏa 2 sponsor | `consume_ref` unique per redeemer; aggregate check qua `own_hash` |
| PM-ATK-11 | Drain ADA/LAMP khỏi meter UTxO | Bất biến value bảo toàn tuyệt đối: non-MAGIC assets bảo toàn (PM-11) |
| PM-ATK-12 | App khai `lamp_sponsored` nhiều hơn thực tế nhận | Không áp dụng: validator kiểm `magic_burned` (input phía user); app không lấy thêm LAMP ngoài giao thức ép |

### 8.2 Tương tác an toàn với consume.ak

Paymaster validator chạy **song song** với `consume.ak` trong cùng tx (2 scripts khác nhau,
2 UTxO khác nhau). Mỗi script chỉ validate UTxO của mình. Không có điểm tương tác trực tiếp.

**Nguy cơ phối hợp:** attacker submit tx dùng `consume.ak` (đốt MAGIC đúng) nhưng thiếu
`paymaster.ak` validate → không có PM-1..PM-11. Giải pháp: nếu app muốn sponsor, app tx-builder
**bắt buộc** bao gồm meter_UTxO và policy beacon trong tx. Nếu thiếu → tx không có sponsor path,
app không được AppEconomics reward cho ops đó.

### 8.3 eUTXO isolation

Paymaster `SponsorMeter` là UTxO riêng biệt với vault UTxO của user. Double-satisfaction cho
SponsorMeter: chỉ có 1 meter/app/epoch (thread NFT), không thể spend 2 meter UTxO cùng epoch
vì chỉ có 1 tồn tại.

### 8.4 Không có oracle — rủi ro kinh doanh

Không oracle = tỷ giá không phản ánh market realtime. Rủi ro:
- App đặt `lamp_per_magic_q` quá cao → user tiêu MAGIC nhiều hơn cần.
- App đặt quá thấp → app mất tiền khi sponsor.

**Biện pháp:** DAO đặt sàn `min_lamp_per_magic_q` (trong Protocol beacon); app cạnh tranh thị
trường tự điều chỉnh. Oracle path (CIP-31 datum giá) được thiết kế sẵn trong `oracle_nft_policy`
field — upgrade KHÔNG cần fork validator.

---

## 9. Deploy Dependencies

Thứ tự build (phụ thuộc đơn chiều):

```
Step 1: ConsumeMAGIC đã deploy (consume.ak, price_param.ak, engage_nft_policy)
        → CONSUME_SCRIPT_HASH, ENGAGE_NFT_POLICY_ID, MAGIC_POLICY_ID
        Nguồn: ConsumeMAGIC/TECH.md §4

Step 2: Mở rộng EngageDatum thêm did_commit (blocker — cross-repo MAGIC)
        → Giao Tuân, PR vào MAGIC repo

Step 3: deploy paymaster_policy_nft.ak (one-shot, parameterized genesis_ref)
        → PAYMASTER_POLICY_NFT_POLICY_ID

Step 4: deploy paymaster_policy.ak (SponsorPolicy beacon per app)
        → PAYMASTER_POLICY_SCRIPT_HASH

Step 5: deploy paymaster_meter_nft.ak (one-shot per app, parameterized genesis_ref)
        → PAYMASTER_METER_NFT_POLICY_ID

Step 6: deploy paymaster.ak (SponsorMeter validator)
        parameterized: magic_policy, magic_name, max_policy_stale, ms_per_epoch,
                       policy_nft_policy, meter_nft_policy
        → PAYMASTER_SCRIPT_HASH

Step 7: App đăng ký — post SponsorPolicy UTxO tại PAYMASTER_POLICY_SCRIPT_HASH
        (tx: mint policy NFT, SponsorPolicy datum, DAO approval)

Step 8: App tạo SponsorMeter UTxO tại PAYMASTER_SCRIPT_HASH
        (tx: mint meter NFT, SponsorMeter datum epoch=current, global=0, did_map=[])
```

Env vars cần thêm vào `scripts/.env`:
```
PAYMASTER_POLICY_SCRIPT_HASH
PAYMASTER_POLICY_NFT_POLICY_ID
PAYMASTER_SCRIPT_HASH
PAYMASTER_METER_NFT_POLICY_ID
MAX_POLICY_STALE=10
```

---

## 10. Test Plan

### 10.1 Positive tests (≥3)

| ID | Mô tả | Kiểm |
|---|---|---|
| T-PM-POS-01 | Happy path: 1 DID, 1 op, budget dồi dào | MAGIC burn đúng; meter cập nhật; app cosign |
| T-PM-POS-02 | Over-burn MAGIC (user đốt nhiều hơn required) | Cho phép; lamp_sponsored tính theo burn thực |
| T-PM-POS-03 | Epoch mới: meter reset tự động trong tx | SponsorMeter.epoch cập nhật; did_map=[] reset; global=0 reset |
| T-PM-POS-04 | Batch: 2 vault input cùng app sponsor | Aggregate magic_burned; aggregate quota check |

### 10.2 Negative tests (≥5)

| ID | Mô tả | Kết quả kỳ vọng |
|---|---|---|
| T-PM-NEG-01 | Thiếu app cosign (app_authority không ký) | PM-1 fail |
| T-PM-NEG-02 | magic_burned < required | consume.ak C-CM-2 fail (trước khi paymaster.ak) |
| T-PM-NEG-03 | Per-DID cap vượt | PM-5 fail |
| T-PM-NEG-04 | Global cap vượt | PM-6 fail |
| T-PM-NEG-05 | Tỷ giá stale (policy epoch quá cũ) | PM-10 fail |
| T-PM-NEG-06 | Fake policy beacon (NFT qty=0) | PM-8 security check fail |
| T-PM-NEG-07 | Double-meter (2 meter input cùng epoch) | PM-7 count fail (chỉ 1 input@script) |
| T-PM-NEG-08 | Khai magic_burned giả trong redeemer | Validator đọc tx.mint thật → PM-2 fail |
| T-PM-NEG-09 | Drain ADA từ meter UTxO | PM-11 value preservation fail |
| T-PM-NEG-10 | lamp_sponsored vượt giới hạn tỷ giá | PM-3 fail |

---

## 11. Known Limits và v-next

### v1 (MVP)

- `did_lamp_map` là flat List — O(n) lookup per tx. Giới hạn thực tế: ~50-100 DID/epoch/app
  trước khi ExUnit limit. Cần đo trước M2.
- Oracle path là interface sẵn nhưng chưa implement (`oracle_nft_policy = None`).
- `app_id` chưa liên kết PhoenixKey DID của app — chỉ là ByteArray tự khai.
- AppEconomics reward distribution qua Treasury (bucket reward) — chờ Treasury EXEC §5.4 build.

### v1.x

- Merkle-based `did_lamp_map` nếu đo ExUnit vượt giới hạn.
- CIP-31 oracle datum giá tự động (cắm `oracle_nft_policy = Some(policy)`).
- Cross-instance: receipt từ Paymaster tích vào Voting Power (attribution VP D9 khi
  `did_commit` sẵn sàng).
- App identity qua PhoenixKey DID on-chain (thay ByteArray tự khai).

---

## 12. Phụ thuộc

- **ConsumeMAGIC** (đã build) — `consume.ak`, `EngageDatum`, `PriceParam` beacon.
  Nguồn: `ConsumeMAGIC/onchain/plutus.json` (compiled).
- **Treasury** — `collectToTreasury` để ghi receipt AppEconomics; bucket reward.
  Nguồn: `Treasury/onchain/validators/custody.ak`.
- **Governance** — DAO approval cho `SponsorPolicy` tham số (tỷ giá, caps).
  Nguồn: `Governance/VotingPower/CONTRACT.md`.
- **PhoenixKey DID** (external) — `did_commit` field trong EngageDatum; sinh trắc chống Sybil.
  Blocker: `EngageDatum.did_commit` cần Tuân mở rộng trước.
- **Multi-Tier Fee** (`DESIGN §A`) — Paymaster là một app-layer trong khung 3 tầng phí.
  Build sau Reserve (C) và Multi-Tier Fee (A) theo thứ tự `DESIGN §TỔNG HỢP`.

---

## 13. Out-of-scope

- Token-hóa MAGIC.
- Burn LAMP.
- DEX pair MAGIC↔ADA hay MAGIC↔LAMP.
- Định giá nghiệp vụ cụ thể của app (bò vs gà) — đó là `animal_fee` phía app.
- Quản lý committee app (ngoài threshold DAO đã có).
- Vesting/linear release reward (v1: release toàn bộ qua Treasury proposal).
- Cross-chain Paymaster.
