# PlatformKit — TECH (kiến trúc on-chain Aiken + off-chain SDK)

**Trạng thái:** draft 2026-06-15 (chờ anh duyệt). Bám **xương sống** [CONTRACT.md](./CONTRACT.md) —
KHÔNG mâu thuẫn. Tài liệu này là tầng **kỹ thuật** (datum/redeemer/bất biến/validator + SDK off-chain)
của lớp Registry. Hành vi ở [FEAT](./FEAT.md), lộ trình ở [EXEC](./EXEC.md).

**Tái dùng nền sống cùng cây Treasury:**
[`Treasury/onchain/lib/magiclamp/treasury/platform.ak`](../Treasury/onchain/lib/magiclamp/treasury/platform.ak)
(types + helper) + [`validators/registry_beacon.ak`](../Treasury/onchain/validators/registry_beacon.ak)
(minting) + [`validators/registry.ak`](../Treasury/onchain/validators/registry.ak) (spend) + helper
[`lib/magiclamp/treasury/util.ak`](../Treasury/onchain/lib/magiclamp/treasury/util.ak). Custody/seed của
platform là Treasury (`Treasury/TECH.md`) — TECH này CHỈ đặc tả tầng Registry quanh nó.

---

## 0. Mục tiêu + phạm vi

### Thuộc spec này (TECH)
- 2 validator Registry: **`registry_beacon`** (minting — đăng ký platform) + **`registry`** (spend —
  cập nhật entry). Param + redeemer + bất biến từng cái.
- Datum **`PlatformEntry`** (field + Constr order) + enum `PlatformStatus`.
- **Self-ref NFT phá vòng** beacon↔registry (KHÔNG param `registry_hash`).
- **Authority-gated** (R-SIG/U-SIG) — duy nhất `platform_id` + curated, KHÔNG state trung tâm.
- Off-chain SDK: `onboard` / `registrationBuilder` / `collectAdapter` / `registryQuery`.

### KHÔNG thuộc spec này
- **Custody/Collect/Release** internals (value, sổ bucket, split cut, release-gate): ở `Treasury/TECH.md`.
  Registry **trỏ tới** custody nhưng KHÔNG enforce kế toán của nó.
- **`custody_seed`** (cửa 1 onboard): minting policy của Treasury (`Treasury/EXEC.md §16`). Registry
  nhận `instance_id/custody_hash/seed_policy` đầu ra của nó làm input đăng ký.
- **Định giá / oracle**: app-side, NGOÀI PlatformKit.
- **Đếm phiếu / VP** (đích `governance_ref`): `Governance/VotingPower/*`.

### Bất biến cốt lõi (nhắc lại — sai là hỏng)
- Registry KHÔNG giữ value (PK1) — entry UTxO chỉ mang **beacon NFT + min-ADA**, KHÔNG asset thu.
- Beacon-per-platform (PK2): mỗi platform một NFT name=`platform_id` dưới **một** policy chung.
- Authority gác **đăng bạ**, KHÔNG gác **value** (PK3); value gác bởi `governance_ref` riêng (PK6).
- Retire = status, NO-BURN (PK5): beacon sống suốt đời, vòng đời chỉ tiến.

---

## 1. Tổng quan kiến trúc — 2 validator Registry quanh Treasury custody

```
   authority ký                ┌──────────────────────────────────────────────┐
   RegisterPlatform ──────────▶│  registry_beacon (MINTING policy)             │
   (cửa 2 onboard)             │  param: registry_authority                    │
                               │  • R-SIG authority ký  • R-MINT-1 mint 1 NFT  │
                               │  • R-MINT-2 chỉ 1 policy (least-authority, F5) │
                               │  • R-OUT-1 self-ref output ở Script + datum   │
                               │  • R-WF entry well-formed  • R-NAME id==name  │
                               │  • R-BIND ref-input custody THẬT (audit #6)   │
                               │  • BURN cấm (else fail)                        │
                               └────────────────────┬─────────────────────────┘
                                                    │ mint beacon NFT(name=platform_id)
                               ┌────────────────────▼─────────────────────────┐
                               │  entry UTxO @ registry  (beacon NFT + datum   │
                               │  PlatformEntry, status=Active)   ── trỏ ──▶ custody (Treasury)
                               └────────────────────┬─────────────────────────┘
   authority ký                                     │ spend để cập nhật
   UpdateEntry ───────────────▶┌────────────────────▼─────────────────────────┐
                               │  registry (SPEND validator)                   │
                               │  param: (registry_authority, beacon_policy)   │
                               │  • U-SIG  • U-SINGLE 1in/1out script-hash     │
                               │  • U-TERMINAL Retired = trạng thái CUỐI       │
                               │  • U-NFT beacon bảo toàn  • U-ID identity     │
                               │  • U-MUT mutable hợp lệ  • U-MINT-0 no mint   │
                               └──────────────────────────────────────────────┘
```

**Quyết định first-principles — beacon-per-platform, KHÔNG registry UTxO trung tâm.** Một UTxO "danh
sách tất cả" là điểm contention tuần tự + O(N) bloat (vết `consumed_proposals` Treasury §10 H3). Thay
bằng: mỗi platform một beacon NFT độc lập một UTxO → register/update song song, O(1)/thao tác, discover =
quét policy. (CONTRACT §3.1.)

---

## 2. Datum `PlatformEntry` — field + Constr order

Nguồn: `platform.ak` (đã sống). Constr index theo **thứ tự khai báo** — KHỚP off-chain (đổi thứ tự một
bên phá decode bên kia, cùng quy tắc Treasury datum).

```aiken
// enum PlatformStatus — Constr index: Active=0, Paused=1, Retired=2 (thứ tự khai báo).
pub type PlatformStatus {
  Active       // 0
  Paused       // 1
  Retired      // 2
}

// PlatformEntry — Constr 0, 9 field theo thứ tự (off-chain Data.Object phải khớp ĐÚNG thứ tự):
pub type PlatformEntry {
  platform_id     : ByteArray,        // 0  = beacon NFT name (duy nhất, authority kiểm duyệt)
  instance_id     : ByteArray,        // 1  Treasury custody instance_id (= seed NFT name)
  custody_hash    : ByteArray,        // 2  script hash custody.ak của platform
  seed_policy     : ByteArray,        // 3  policy NFT authenticity custody (custody_seed)
  governance_ref  : ByteArray,        // 4  script hash DAO/committee gác release (RIÊNG — PK6)
  accepted_assets : List<AssetKey>,   // 5  assets platform thu (AssetKey{policy,name} — types.ak)
  cut_bps         : Int,              // 6  protocol_cut_bps của instance
  created_epoch   : Int,              // 7  epoch đăng ký
  status          : PlatformStatus,   // 8
}
```

> **`accepted_assets` dùng `AssetKey`** (`Treasury/onchain/lib/magiclamp/treasury/types.ak`), KHÔNG
> `BucketKey`. Lý do: entry đăng bạ chỉ cần `(policy, name)` của asset — KHÔNG có khái niệm bucket ở
> tầng registry (bucket là chuyện kế toán nội bộ custody). Dùng `AssetKey{policy,name}` gọn + đúng tầng.

**Identity (5 field bất biến — PK4):** `platform_id`(0), `instance_id`(1), `custody_hash`(2),
`seed_policy`(3), `created_epoch`(7). Khóa cứng ở `UpdateEntry` (U-ID). Đổi = platform mới, đăng ký lại.

**Mutable (4 field — DAO/authority chỉnh):** `governance_ref`(4), `accepted_assets`(5), `cut_bps`(6),
`status`(8). Đổi qua `UpdateEntry` (authority ký). `status` đi đường vòng đời (Active⇄Paused→Retired).

### Redeemer

```aiken
pub type RegistryBeaconRedeemer { RegisterPlatform }   // minting (cửa 2)
pub type RegistryRedeemer        { UpdateEntry }        // spend (cập nhật/đổi status)
```

Mỗi validator **một action** (đơn nhánh) — không cần phân biệt mint một loại / spend một loại; đơn giản
hóa lý luận an toàn (else-fail mọi nhánh khác).

---

## 3. `registry_beacon` (minting) — đăng ký platform (cửa 2)

`validator registry_beacon(registry_authority: ByteArray)` — param **chỉ** `registry_authority` (KHÔNG
param `registry_hash` → phá vòng, §5). Kiểm bảy ràng buộc (R-SIG/R-MINT-1/**R-MINT-2**/R-OUT-1/R-NAME/
R-WF/R-BIND + BURN cấm):

```
R-SIG     authority ký:  list.has(tx.extra_signatories, registry_authority)
          ⇒ kiểm duyệt + đảm bảo platform_id DUY NHẤT (authority không ký trùng id). KHÔNG state trung
            tâm — duy nhất bằng kỷ luật ký. (CONTRACT §3.2.)

R-MINT-1  mint ĐÚNG 1 token policy này, qty +1:
            own_tokens = assets.tokens(tx.mint, policy_id)
            dict.size(own_tokens) == 1  ∧  [Pair(platform_id, qty)] = to_pairs  ∧  qty == 1
          ⇒ một đăng ký = một beacon NFT (name = platform_id). Không mint lô / không qty>1.

R-MINT-2  least-authority (vá lần 2 LỖ #F5):  list.length(assets.policies(tx.mint)) == 1
          ⇒ tx đăng ký CHỈ mint policy beacon NÀY, KHÔNG gánh mint policy NGOÀI cùng tx. Beacon không
            ngầm cho phép đồng-mint token lạ trong cùng tx đăng ký (đối xứng `custody_seed` S-MINT-2 của
            Treasury). Code: `registry_beacon.ak` L37. (4 trục: bền vững — thu hẹp quyền tx; first-
            principles — minting policy chỉ chịu trách nhiệm token của nó.)

R-OUT-1   ĐÚNG 1 output mang NFT đó (SELF-REF), ở SCRIPT (registry validator) + có datum:
            count_outputs_with_token(tx.outputs, policy_id, platform_id) == 1
            entry_out = output_with_token(...)        // output mang chính token vừa mint
            !util.is_vk(entry_out.address)            // ở Script address (KHÔNG ví thường)
            expect InlineDatum(od) = entry_out.datum
            expect entry: PlatformEntry = od
          ⇒ NFT phải đáp ở một entry UTxO ở Script (registry) với datum PlatformEntry — KHÔNG được mint
            rồi gửi vào ví thường (mất tính "entry sống ở registry").
          > self-ref (chọn output bằng "token tôi vừa mint") = KHÔNG cần param registry_hash → phá vòng.

R-NAME    entry.platform_id == platform_id   // datum khai đúng tên NFT đã mint
          ⇒ platform_id trong datum == asset name → entry không thể nói dối định danh.

R-WF      platform.entry_well_formed(entry):
            platform_id≠"" ∧ instance_id≠"" ∧ custody_hash≠"" ∧ governance_ref≠"" ∧ seed_policy≠""
            ∧ accepted_assets≠[] ∧ 0≤cut_bps≤10000 ∧ created_epoch≥0 ∧ status==Active
          ⇒ entry phải well-formed + **khởi tạo Active** (không cho register thẳng vào Paused/Retired).

R-BIND    entry PHẢI trỏ custody THẬT (đóng audit #6 ở mức đăng ký):
            expect Some(cust_ref) = list.find(tx.reference_inputs, fn(i) {
              assets.quantity_of(i.output.value, entry.seed_policy, entry.instance_id) == 1 })
            expect Script(custody_h) = cust_ref.output.address.payment_credential
            custody_h == entry.custody_hash
          ⇒ tx đăng ký PHẢI reference một custody UTxO mang ĐÚNG 1 NFT authenticity
            (entry.seed_policy, entry.instance_id) Ở ĐÚNG địa chỉ Script(entry.custody_hash). Entry
            KHÔNG nói dối được về custody — `(seed_policy, instance_id, custody_hash)` trong datum phải
            khớp một custody THẬT đã tồn tại on-chain. Custody phải seed + submit TRƯỚC khi register
            (khớp onboard tuần tự cửa 1 → cửa 2). Off-chain gương ở `registrationBuilder.verifyCustodyBinding`
            + `registryQuery.verifyEntryAgainstCustody` (§6).

BURN — CẤM (else fail): beacon sống suốt vòng đời platform; retire = status trong datum (PK5).
```

**Vì sao R-WF đòi `status==Active` lúc register:** đăng ký = "platform vừa ra đời, đang hoạt động". Cho
register thẳng vào `Retired`/`Paused` = một entry chết-từ-lúc-sinh (rác). Vòng đời tiến từ Active (CONTRACT
§4) — Pause/Retire là bước **sau** qua `UpdateEntry`.

---

## 4. `registry` (spend) — cập nhật entry (đổi status / mutable)

`validator registry(registry_authority: ByteArray, beacon_policy: assets.PolicyId)`. `beacon_policy =
hash(registry_beacon(authority))` — chỉ phụ thuộc `authority`, KHÔNG hash registry → không vòng (§5).
Một action `UpdateEntry`:

```
U-MINT-0  assets.is_zero(tx.mint)            // update KHÔNG đụng beacon supply (không mint/burn)
U-SIG     authority ký                        // curated — như R-SIG
U-TERMINAL entry_in.status != Retired         // Retired là trạng thái CUỐI — không revive
          ⇒ một khi platform Retired thì entry KHÔNG spend/update được nữa (chặn cả Retired→Active lẫn
            Retired→Retired). Vòng đời một chiều: Active⇄Paused→Retired (terminal). Đóng known-gap cũ
            "vòng đời status không ép on-chain" — thứ tự status NAY ép cứng ở validator, không còn là
            chính sách authority off-chain. (CONTRACT §4.)
U-SINGLE  ĐÚNG 1 entry input + 1 output theo SCRIPT HASH:
            count_inputs_at_script(tx.inputs, own_hash) == 1
            count_outputs_at_script(tx.outputs, own_hash) == 1
            reg_out ở Script (!is_vk)         // chống double-satisfaction qua nhiều entry khác stake-cred
                                              // (bài học C1/C2 Distribution — đếm theo PAYMENT SCRIPT HASH)
U-ID      identity_preserved(entry_in, entry_out):
            platform_id ∧ instance_id ∧ custody_hash ∧ seed_policy ∧ created_epoch BẢO TOÀN (5 field)
          ⇒ update KHÔNG đổi định danh — đổi = platform khác (phải register mới), không lén qua update.
U-MUT     mutable_fields_valid(entry_out):
            governance_ref≠"" ∧ accepted_assets≠[] ∧ 0≤cut_bps≤10000
          ⇒ sau cập nhật, mutable vẫn hợp lệ (không hạ governance_ref về rỗng, không cut_bps ngoài dải).
U-NFT     beacon NFT bảo toàn in & out:
            has_one_nft(reg_in.value,  beacon_policy, entry_in.platform_id)  == True
            has_one_nft(reg_out.value, beacon_policy, entry_out.platform_id) == True
          ⇒ chỉ entry "thật" (mang beacon NFT) mới spend được; NFT không rời entry qua update.

else fail — KHÔNG xóa entry (retire = status, không spend-burn — PK5).
```

> **`status` đổi qua U-MUT path nhưng KHÔNG nằm trong `mutable_fields_valid` check** — vì mọi giá trị
> `PlatformStatus` (Active/Paused/Retired) đều hợp lệ về mặt **cấu trúc**. Ràng buộc **vòng đời** thì ÉP
> RIÊNG qua **U-TERMINAL** (`entry_in.status != Retired`): Retired là trạng thái CUỐI, một chiều — không
> revive về Active/Paused. Active⇄Paused đảo ngược tự do; →Retired một chiều, terminal. (Trước v1 đây là
> known-gap "chính sách authority off-chain"; NAY đã ép cứng on-chain — known-gap GAP-1 đóng.)

**U-SINGLE đếm theo PAYMENT SCRIPT HASH** (qua `count_inputs_at_script`/`count_outputs_at_script` của
`util.ak`) — KHÔNG full-address: chống double-satisfaction N× entry khác stake-cred (đúng lỗ C1/C2 mà
Distribution sửa, generators còn hở — `Treasury/FEAT.md §2.2`).

> ⛔ **F7 (vá lần 2 — reconcile): `registry` KHÔNG gác custody on-chain.** `registry.ak` (UpdateEntry) chỉ
> ép U-* về ENTRY (status/identity/mutable/NFT/authority) — **KHÔNG đọc custody UTxO**, và **custody
> validator (`custody.ak`) KHÔNG đọc registry** (không reference input registry ở nhánh Collect/Release).
> Hai validator **độc lập hoàn toàn về dòng tiền**. Hệ quả: `entry.status` (kể cả `Retired`) là **NHÃN
> DISCOVERY**, KHÔNG phải van chặn — đặt Retired KHÔNG dừng được Collect/Release ở custody (kho vẫn thu/
> chi qua `governance_ref` riêng). Người tin "Retired = quỹ đóng" HIỂU NHẦM (CONTRACT PK10). **v1.x nếu
> muốn Pause THẬT:** custody param thêm `registry_beacon_policy` + đọc entry qua reference input + nhánh
> Collect/Release ép `entry.status == Active`. Đánh đổi: +1 reference input/tx custody + ràng buộc vòng đời
> custody↔registry. v1 KHÔNG làm — tách tầng PK1 (registry = con trỏ; custody = kho).

---

## 5. Self-ref NFT — phá vòng beacon↔registry

**Vòng (nếu naïve):** `registry_beacon` muốn ép output entry ở registry → param `registry_hash`; `registry`
muốn ép beacon NFT → param `beacon_policy = hash(registry_beacon(...))`. Hai bên cần hash của nhau trước
compile → vòng, không deploy được.

**Phá vòng (đã làm):**
- `registry_beacon` chọn output entry bằng **self-reference NFT** — `output_with_token(outputs, policy_id,
  platform_id)`: output mang **chính token vừa mint**. KHÔNG cần biết hash registry → BỎ param
  `registry_hash`. Chỉ ép output ở **Script address bất kỳ** (`!is_vk`), không ép đúng hash registry.
- `registry` param `beacon_policy = hash(registry_beacon(authority))` — chỉ phụ thuộc `authority` (không
  phụ thuộc hash registry). Tính được độc lập.

**Chiều deploy:** `registry_beacon(authority)` compile trước → ra `beacon_policy` → `registry(authority,
beacon_policy)` compile sau. Một chiều, không vòng.

> Gương đúng mẫu `custody_seed` Treasury (`Treasury/EXEC.md §16` — phá vòng seed↔custody bằng self-ref).
> Cùng triết lý: minting policy chọn output bằng "token tôi vừa mint", không cần hash đích.

**Đánh đổi đã cân:** vì `registry_beacon` chỉ ép output ở **Script bất kỳ** (không đúng hash registry),
về lý thuyết một beacon NFT có thể được mint vào một Script KHÁC registry. Nhưng: (a) authority ký mới
mint được (R-SIG) → authority chỉ ký tx đặt entry đúng ở registry; (b) `registry` U-NFT chỉ cho spend
entry mang NFT ở **địa chỉ registry** → entry đặt sai chỗ không update được qua registry (mắc kẹt). Off-chain
discover quét policy + lọc UTxO ở **đúng địa chỉ registry** (registryQuery §6) → entry lạc chỗ không lọt
danh sách. Đây là đánh đổi **first-principles** (phá vòng > ép-hash-cứng) an toàn vì authority-gated.

---

## 6. Off-chain SDK

ES modules, Lucid Evolution (gương `Treasury/offchain`). Bốn nhóm hàm:

### 6.1 `onboard` — điều phối ba cửa
`onboard(config) -> { instanceId, custodyHash, seedPolicy, platformId }`. Gọi tuần tự:
1. **cửa 1** `seedCustody()` (tái dùng Treasury custody_seed off-chain) → `instance_id/custody_hash/
   seed_policy`;
2. **cửa 2** `registrationBuilder()` → entry UTxO đăng bạ;
3. trả handle để **cửa 3** `collectAdapter` dùng. Một hàm cho team eco chạy trọn onboard.

### 6.2 `registrationBuilder` — build tx RegisterPlatform / UpdateEntry
- `planRegister(params)` — mint beacon NFT + tạo entry UTxO (datum `PlatformEntry`, status Active).
  Gương R-MINT-1/R-OUT-1/R-WF/R-NAME **TRƯỚC** khi build (tự kiểm well-formed off-chain, không để
  validator reject vô ích). **R-BIND (mới):** nhận `custodyUtxo: CustodyRef` + gương R-BIND fail-fast
  qua `verifyCustodyBinding` — custody ref PHẢI mang đúng 1 NFT authenticity `(seed_policy, instance_id)`
  Ở `Script(custody_hash)`, nếu thiếu/sai ném `REG-BIND`. `RegisterPlan.custodyRef` báo caller phải
  `readFrom` UTxO custody này khi dựng tx thật (reference input on-chain). Custody phải seed TRƯỚC.
- `verifyCustodyBinding(custody, seedPolicy, instanceId, custodyHash) -> {ok, reason?}` — gương R-BIND
  thuần (kiểm NFT qty==1 + script hash địa chỉ == custody_hash). Dùng cả ở builder (fail-fast) lẫn audit.
- `planUpdateEntry(entryIn, changes, beaconPolicy, authority)` — spend entry, tạo entry_out đổi mutable
  fields (gồm `status`). Gương U-ID (giữ 5 identity) + U-MUT + U-NFT. **U-TERMINAL (mới):** reject nếu
  `entryIn.status === "Retired"` (ném `UPD-TERMINAL`) — Retired terminal, không revive.

### 6.3 `collectAdapter` — sự kiện app → CollectItem (cửa 3, FEAT §2)
- `collectAdapter(events) -> CollectItem[]` — map sự kiện platform `{amount đã định giá, category}` sang
  `CollectItem{app_id, policy, name, amount, category}` (schema Treasury). Pricing **KHÔNG ở đây** (app
  điền `amount`).
  > ⛔ **F8 (vá lần 2): `app_id` trong CollectItem là VÔ DANH on-chain.** `app_id` chỉ nằm ở **redeemer**
  > Collect, KHÔNG neo vào CustodyDatum (Treasury chưa có `receipt_root` — `Treasury/TECH.md §6`). Sau khi
  > tx confirm, không hash/UTxO nào chứng thực `app_id` đã khai. **VP/uy tín KHÔNG được tin `app_id` từ
  > Collect** để cấp tín dụng C1 (MAGIC tiêu thụ) tới khi receipt được thực thi — nếu tin, kẻ tấn công khai
  > `app_id` người khác để bơm VP. receipt_root là v1.x hoặc bỏ lời hứa. (CONTRACT PK11.)
- `buildCollectBatchTx(items)` — gom N item thành một `Collect` settlement tx (tái dùng `buildCollectTx`
  của Treasury). Batch theo cửa-sổ (tham số mở).

### 6.4 `registryQuery` — discover (FEAT §3)
- `discoverPlatforms(utxos, beaconPolicy, opts?) -> DiscoveredPlatform[]` — lọc UTxO mang beacon NFT,
  decode `PlatformEntry`, gương R-NAME (`platform_id == NFT name`, lệch = loại). THUẦN (nhận `utxos[]`
  đã fetch, không cần chain). Trả kèm 2 cờ cảnh báo audit:
  - **`duplicate`** (audit #2): TRUE cho MỌI entry có `platform_id` xuất hiện ≥2 lần trong lô — KHÔNG im
    lặng chọn cái đầu. On-chain KHÔNG ép `platform_id` duy nhất (beacon không one-shot) → đây là VAN dedup
    off-chain. `findDuplicatePlatformIds(platforms)` trả map id→entry trùng (rỗng = sạch).
  - **`foreignScript`** (audit #3): nếu cấp `opts.registryScriptHash`, TRUE khi `utxo.scriptHash` khác
    registry thật (beacon NFT bị gửi ra ngoài registry validator).
- **`verifyEntryAgainstCustody(entry, custodyUtxo) -> {ok, reason?}` (audit #6 — BẮT BUỘC trước route phí):**
  `discoverPlatforms` CHỈ đọc datum → KHÔNG đủ tin (entry có thể khai `seed_policy/instance_id/custody_hash`
  bất kỳ). Người tin (route phí) PHẢI gọi hàm này đối soát entry với UTxO custody THẬT, gương R-BIND
  on-chain: (1) `quantity_of(custody.value, seed_policy, instance_id) == 1`; (2) custody payment
  credential (script hash) == `entry.custody_hash`. R-BIND ép lúc ĐĂNG KÝ; reader hậu kỳ vẫn nên đối
  soát lại (custody có thể đã được spend/đổi sau register).
  > ⛔ **F13 (vá lần 2 — nhấn mạnh): `verifyEntryAgainstCustody` + dedup CHỈ là VAN SDK, KHÔNG bất biến
  > on-chain.** SDK KHÔNG thể ép người tích hợp gọi — đây là kỷ luật phía caller. **Người tích hợp PHẢI gọi
  > `verifyEntryAgainstCustody` + `findDuplicatePlatformIds`/`duplicate` (audit #2) TRƯỚC khi route phí.**
  > Bỏ qua = route phí tới custody giả mạo (entry nói dối) hoặc entry trùng `platform_id`. Đây là known-gap
  > còn lại (van quy trình, không mật mã) — xem GAP-2/GAP-4 §7.
- `getPlatform(platform_id)` / `findPlatform(platforms, id)` — đọc/tìm một entry (findPlatform trả cái
  ĐẦU — KHÔNG an toàn khi `duplicate` → kiểm `findDuplicatePlatformIds` trước).
- `reconcileWithCustody(entry)` — đọc custody datum của `instance_id`, đối soát `(cut_bps, accepted_assets,
  governance_ref)`; custody là chuẩn (PK7) → cảnh báo nếu entry lệch.

`decodePlatformEntry` / `encodePlatformEntry` — schema `Data.Object`/`Data.Enum` **khớp ĐÚNG** Constr
order §2 (9 field, status enum 0/1/2). Lệch thứ tự phá decode (cùng quy tắc Treasury datum).

---

## 7. Bất biến + lý do quyết định (4 trục build mode)

| Bất biến | Ép ở | Lý do (trục) |
|---|---|---|
| **PK2 beacon-per-platform** | `registry_beacon` R-MINT-1/R-OUT-1 | **first-principles + tối ưu:** bỏ UTxO trung tâm → bỏ contention tuần tự + O(N) bloat (vết `consumed_proposals` §10 H3). Discover = quét policy O(1). |
| **PK3 authority-gated, curated** | R-SIG / U-SIG | **bền vững:** uy tín registry = uy tín platform trong đó; chống chiếm tên + rác. `platform_id` duy nhất KHÔNG cần state trung tâm (Cardano không ép unique asset-name) → authority ký không trùng. |
| **PK4 identity 5 field bất biến** | U-ID | **first-principles:** đổi định danh = platform khác → phải register mới, không lén qua update. |
| **PK5 retire = status, NO-BURN** | else-fail (cả 2) + U-MINT-0 | **dài hạn + bền vững:** beacon sống suốt đời → audit trail không đứt, `platform_id` không tái cấp; đồng nhất no-burn LAMP/Treasury. |
| **R-BIND entry trỏ custody THẬT** | `registry_beacon` R-BIND (ref-input) | **an toàn (đóng audit #6 mức đăng ký):** entry KHÔNG nói dối custody — `(seed_policy, instance_id, custody_hash)` phải khớp custody THẬT đã seed (ref-input mang NFT authenticity @ Script(custody_hash)). Buộc onboard tuần tự seed→register. |
| **U-TERMINAL Retired = trạng thái CUỐI** | `registry` U-TERMINAL (`entry_in.status != Retired`) | **bền vững:** vòng đời một chiều Active⇄Paused→Retired; cấm revive Retired→Active (đóng GAP-1 cũ — thứ tự status NAY ép on-chain, không còn là chính sách authority off-chain). |
| **PK6 governance_ref RIÊNG/platform** | R-WF (≠"") + checklist onboard | **bền vững (tách quyền):** #1B Treasury **ĐÓNG** (F10 — spec_hash gồm instance_id); dùng chung KHÔNG còn replay chéo. PK6 nay là **khuyến nghị tách quyền release** (blast-radius nhỏ), không bắt buộc bởi replay. Governance commit đúng instance_id khi tạo proposal. |
| **PK1 registry KHÔNG giữ value** | R-OUT-1 (entry = NFT+min-ADA) + tách custody | **first-principles:** registry là con trỏ, value ở custody. Sai tầng = bloat + lẫn quyền. |
| **self-ref phá vòng** | R-OUT-1 (chọn output bằng token vừa mint) | **first-principles + tối ưu:** deploy một chiều beacon→registry, không param vòng. Gương custody_seed Treasury. |
| **đếm payment-script-hash** | U-SINGLE (`count_*_at_script`) | **an toàn:** chống double-satisfaction N× entry khác stake-cred (lỗ C1/C2 Distribution). |
| **R-MINT-2 least-authority (F5)** | `registry_beacon` R-MINT-2 (`length(policies(tx.mint))==1`) | **bền vững + first-principles:** tx đăng ký chỉ mint policy beacon, không gánh mint policy ngoài (đối xứng custody_seed S-MINT-2). |
| **PK10 status = nhãn discovery (F7)** | KHÔNG ép on-chain (registry ⊥ custody) | **reconcile:** registry không gác custody — status không chặn dòng tiền; ghi rõ chống hiểu nhầm "Retired=quỹ đóng". v1.x custody đọc entry nếu cần Pause thật. |
| **PK11 app_id vô danh (F8)** | KHÔNG neo on-chain (chưa receipt_root) | **reconcile (an toàn VP):** VP không tin app_id từ Collect tới khi receipt thực thi (chống bịa C1). |

**Tổng hợp 4 trục:**
- **(a) Dài hạn — open SDK:** PlatformKit là khuôn để **mọi** team Cardano dựng platform tương tự
  MagicLamp mà không fork → mỗi platform một caller `collectToTreasury` → cầu LAMP.
- **(b) First-principles — beacon:** discover = "tập UTxO mang một policy" thay vì danh bạ ai-đó-vận-hành;
  duy nhất id bằng kỷ luật ký (Cardano không ép unique asset-name) thay vì state trung tâm.
- **(c) Tối ưu — no-contention:** beacon-per-platform → register/update/discover song song, O(1)/thao tác,
  không UTxO nóng tuần tự, không O(N) bloat.
- **(d) Bền vững — authority-curated:** sổ đăng bạ uy tín (chống chiếm tên/rác), no-burn (lịch sử bền),
  quyền tách bạch (authority gác đăng bạ ≠ governance gác value), lộ trình committee → DAO.

### Đã đóng (đánh dấu — không còn gap)
- **~~GAP-1 vòng đời status~~ — ĐÓNG bằng U-TERMINAL.** Cấm Retired→Active NAY ép cứng on-chain
  (`registry` U-TERMINAL: `entry_in.status != Retired`), không còn là chính sách authority off-chain.
  Off-chain `planUpdateEntry` gương (`UPD-TERMINAL`). (§4.)
- **audit #6 custody (mức ĐĂNG KÝ) — ĐÓNG bằng R-BIND.** Entry không nói dối custody lúc register:
  `registry_beacon` ép reference-input custody mang đúng 1 NFT authenticity `(seed_policy, instance_id)`
  Ở `Script(custody_hash)`. (§3.)

### Known-gap (đánh dấu — chờ; ghi rõ van + lộ trình)
- **GAP-2 (audit #2) — `platform_id` duy nhất = AUTHORITY-CURATED, CHƯA bất biến mật mã.** `registry_beacon`
  KHÔNG one-shot (không consume genesis ref) → on-chain KHÔNG biết `platform_id` đã mint trước đó; R-MINT-1
  chỉ ép "mint đúng 1 token/tx". Tính duy nhất dựa **van quy trình** (KHÔNG bất biến mật mã):
  (1) `registry_authority` (committee→DAO) không ký 2 lần cùng `platform_id`; (2) SDK dedup —
  `discoverPlatforms` đánh dấu `duplicate=true` cho mọi entry trùng + `findDuplicatePlatformIds` liệt kê
  (caller route phí PHẢI kiểm trước khi tin). Đề xuất v1.x đóng bằng bất biến mật mã: **one-shot
  `genesis_ref` per platform** (consume một UTxO duy nhất → asset-name duy nhất, mẫu `custody_seed`) hoặc
  **registry-state roster** (đánh đổi: thêm contention — cân nhắc kỹ). (CONTRACT §3.2.)
- **GAP-3 (audit #4) — `registry_authority` hiện 1 vkh = single point of failure.** Param hiện 1 `ByteArray`
  (1 key-hash) → một khóa rò = chiếm tên/onboard rác. NÊN nâng lên **multisig/committee script** (M-of-N
  native/Plutus), `governance_ref` committee → DAO. Lộ trình ở EXEC §6.1. Trước mainnet PHẢI là committee
  multisig, KHÔNG key đơn.
- **GAP-4 (audit #6, hậu kỳ) — discover chỉ đọc datum, KHÔNG đủ tin để route phí.** R-BIND đóng ở mức
  ĐĂNG KÝ; nhưng reader hậu kỳ (custody có thể đã spend/đổi sau register) PHẢI gọi
  `verifyEntryAgainstCustody(entry, custodyUtxo)` đối soát với custody THẬT trước khi route phí. Van SDK,
  không phải gap on-chain — ghi rõ để caller không tin mù datum.
- **GAP-5 (audit #3) — entry lạc-chỗ ở Script lạ.** `registry_beacon` chỉ ép output ở Script **bất kỳ**
  (self-ref, không đúng hash registry — đánh đổi phá vòng §5). An toàn nhờ authority-gated + `discoverPlatforms`
  nhận `registryScriptHash` tùy chọn → đánh dấu `foreignScript=true`. v1.x: nếu cần khóa cứng, thêm
  self-check địa chỉ sau khi có hash registry (đường hai-bước như Treasury).
- **~~GAP-6 — `governance_ref` riêng vì replay-chéo #1B~~ — KHÔNG còn là gap an toàn (vá lần 2 F10).**
  #1B đã ĐÓNG ở Treasury (`spend_spec_hash` gồm `instance_id` — `Treasury/CONTRACT.md §10 H1B`): dùng chung
  `governance_ref` KHÔNG còn gây replay-chéo. PK6 (governance_ref riêng) NAY giữ như **khuyến nghị tách
  quyền release** (blast-radius nhỏ), KHÔNG còn ràng buộc an toàn cứng. R-WF vẫn đòi `governance_ref ≠ ""`.
  ⛔ Yêu cầu interface thay thế: Governance commit đúng `instance_id` khi tạo proposal. (CONTRACT §5, PK6.)

---

## 8. Phản hồi vá audit lần 2 (vòng 2026-06-15)

Đợt vá thứ hai chạm PlatformKit: 1 lỗ on-chain (F5), 2 reconcile (F7, F8), 1 known-gap nhấn mạnh (F13),
+ hệ quả #1B đóng (F10). Code đã áp; spec này mô tả lại.

| Lỗ | Mức | Sửa gì | Mã | Nơi | Code |
|---|---|---|---|---|---|
| **F5** | major | `registry_beacon` ép `length(policies(tx.mint)) == 1` (least-authority — không gánh mint policy ngoài; đối xứng custody_seed S-MINT-2 Treasury). | R-MINT-2 | §3 R-MINT-2, §1 sơ đồ, §7 bảng | registry_beacon.ak L37 |
| **F7** | reconcile | Registry status (Paused/Retired) KHÔNG gác custody on-chain (custody ⊥ registry). status = nhãn discovery, KHÔNG van chặn dòng tiền; "Retired=quỹ đóng" là HIỂU NHẦM. v1.x: custody đọc entry qua reference nếu muốn Pause thật. | PK10 | CONTRACT §4 + PK10, §4 note, §7 bảng | registry.ak (không ref custody) |
| **F8** | reconcile | `app_id` (CollectItem redeemer) vô danh on-chain; CustodyDatum không có `receipt_root`. VP/uy tín KHÔNG tin app_id từ Collect tới khi receipt thực thi (chống bịa C1). receipt = v1.x / bỏ lời hứa. | PK11 | CONTRACT PK11, §6.3 note | (Treasury types.ak — chưa có receipt) |
| **F10** | — (đóng) | #1B ĐÓNG ở Treasury (`spend_spec_hash` gồm instance_id). PK6 governance_ref riêng → từ ràng-buộc-an-toàn thành KHUYẾN NGHỊ tách quyền. GAP-6 hết là gap an toàn. Governance build-side PHẢI commit đúng instance_id. | PK6 | CONTRACT §5/PK6, §7 GAP-6 | (Treasury release.ak) |
| **F13** | known-gap | `verifyEntryAgainstCustody` + dedup chỉ là VAN SDK — người tích hợp PHẢI gọi TRƯỚC khi route phí (SDK không ép được). Bỏ qua = route phí tới custody giả / entry trùng. | — | §6.4 note, CONTRACT §8 | registryQuery (SDK) |