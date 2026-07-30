# PlatformKit — FEAT (đặc tả tính năng / hành vi)

**Trạng thái:** bản thảo 2026-06-15. Bám sát [CONTRACT.md](./CONTRACT.md) (khung interface đã chốt).
KHÔNG mâu thuẫn contract. Tham số chưa chốt đánh dấu **"tham số mở (DAO định)"**.

> Spec này mô tả **hành vi nhìn thấy được** của PlatformKit: một team onboard một platform thế nào
> (seed kho → đăng ký đăng bạ → nối app thu phí), collect adapter biến sự kiện app thành `CollectItem`,
> discover registry để tìm platform, và ai dùng SDK này. Người không-kỹ-thuật đọc cũng hiểu.
> KHÔNG đi sâu datum/redeemer/validator (xem [TECH](./Tech-Spec.md)) hay lộ trình bootstrap (xem
> [EXEC](./Exec-Spec.md)).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

PlatformKit là **khuôn mẫu onboarding**: mỗi platform (PhoenixKey, OriLife, team eco khác) đăng ký một
lần là có sẵn hệ thống **tương tự MagicLamp** — một **Treasury custody instance** (kho có ghi sổ) cộng
một **entry Registry** (đăng bạ discoverable). Nó giải quyết bốn nhu cầu, không trộn lẫn:

1. **Hạ rào dựng kho** — một team không phải đọc hết Treasury internals; chạy ba cửa (seed → register →
   integrate) là có kho + được đăng bạ.
2. **Đăng bạ discoverable** — mọi platform tra được bằng một lần quét policy (`registry_beacon`), không
   cần danh bạ tập trung do ai đó vận hành.
3. **Kiểm duyệt onboarding** — `registry_authority` ký mỗi đăng ký → `platform_id` duy nhất, chống chiếm
   tên + rác. Curated, không permissionless.
4. **Nối app thu phí** — app platform gọi `collectToTreasury` của instance mình; collect adapter biến
   sự kiện app (vd "một con vật được định danh", "một DID được cấp") thành `CollectItem`.

Mục tiêu cuối: **làm LAMP có giá trị** bằng open SDK. Mỗi platform onboard = một caller
`collectToTreasury` mới = một nguồn cầu LAMP (khi instance đó nhận LAMP).

### 0.2 Thuộc spec này
- Luồng onboard một platform (PhoenixKey, OriLife làm ví dụ) — ba cửa tuần tự.
- Collect adapter: sự kiện platform → `CollectItem`; pricing nằm ở app.
- Discover registry: quét beacon policy ra danh sách platform + lọc theo status.
- Vòng đời đăng bạ nhìn từ ngoài: Register → Pause/Resume → Retire.
- Ai dùng (open SDK cho team Cardano). User stories.

### 0.3 KHÔNG thuộc spec này (thuộc spec khác)

| Chủ đề | Thuộc |
|---|---|
| Custody/collect/release internals, bảo-toàn-value, split cut | [Treasury](../Treasury/) (FEAT/MATH/TECH) |
| Datum `PlatformEntry`, redeemer registry, bất biến on-chain | [TECH](./Tech-Spec.md) |
| **Định giá phí** (bò ≠ gà — `animal_fee`), quy đổi LAMP↔USD/ADA | App (OriLife/PhoenixKey) + Oracle, **NGOÀI** PlatformKit |
| Cơ chế vote / Voting Power (đích `governance_ref`) | [Governance/VotingPower](../Governance/VotingPower/) |
| Lộ trình deploy registry, onboard PhoenixKey/OriLife, tích hợp collect | [EXEC](./Exec-Spec.md) |

---

## 1. Luồng onboard một platform (ba cửa)

Bám ba cửa CONTRACT §6. Mỗi cửa một ranh giới rõ, **tuần tự**: có kho → được thấy → bắt đầu thu.

### 1.1 Cửa 1 — Seed custody (dựng kho)

Team chạy `custody_seed` (Treasury) một lần:
- consume một genesis UTxO (one-shot);
- mint NFT authenticity (name = `instance_id`);
- tạo custody UTxO đầu tiên với value + **sổ bucket base-case đúng** (seed guards Treasury §16:
  `cut_bps ∈ [0,10000]`, mọi dòng sổ `> 0`, `instance_id ≠ ""`, `accepted_assets ≠ []`, sổ strict-sorted).

**Nhìn từ ngoài:** team giờ có một **kho** với `instance_id`, `custody_hash`, `seed_policy`. Kho rỗng
value nhưng kế toán đúng từ gốc. Chưa ai thấy platform này.

### 1.2 Cửa 2 — Register (đăng bạ)

Team gửi yêu cầu đăng ký tới `registry_authority` (committee → DAO). Authority kiểm tham số rồi **ký**
một tx `RegisterPlatform`:
- mint beacon NFT (name = `platform_id`) dưới policy `registry_beacon`;
- tạo entry UTxO ở `registry` mang beacon NFT + datum `PlatformEntry` (trỏ custody vừa seed, status =
  `Active`);
- entry **well-formed** (mọi định danh ≠ rỗng, `cut_bps ∈ [0,10000]`, có asset, Active) + `platform_id`
  khớp NFT name;
- **trỏ custody THẬT (R-BIND):** tx register PHẢI **reference** custody UTxO của cửa 1 (mang NFT
  authenticity `(seed_policy, instance_id)` Ở `Script(custody_hash)`). → custody phải đã **seed + submit
  on-chain TRƯỚC** cửa 2; entry không nói dối được custody.

**Nhìn từ ngoài:** platform giờ **discoverable** — bất kỳ ai quét `registry_beacon` policy đều thấy nó,
trỏ tới custody nào, thu asset gì, cut bao nhiêu, trạng thái Active.

### 1.3 Cửa 3 — Integrate collect (nối app)

App của platform gọi `collectToTreasury(asset, amount, app_id, category)` của instance mình:
- app **định giá** `amount` (Treasury KHÔNG định giá);
- collect adapter gom N sự kiện thành một `Collect{ items: [N] }` (batch — chống bloat);
- custody split `cut = amount × cut_bps / 10000` → bucket `category`, phát receipt.

**Nhìn từ ngoài:** kho bắt đầu **nhận value thật**. Số dư bucket tăng, receipt ghi "ai đóng góp bao
nhiêu".

### 1.4 Ví dụ — PhoenixKey

- **Cửa 1:** seed custody instance `instance_id="phoenixkey"`, `accepted_assets=[LAMP, ADA]`,
  `cut_bps` (DAO định), `governance_ref` = DAO PhoenixKey (RIÊNG — PK6).
- **Cửa 2:** authority ký register `platform_id="phoenixkey"`, status Active.
- **Cửa 3:** PhoenixKey **Frontend/SDK** (lớp touchable) gọi `collectToTreasury(LAMP, fee, "phoenixkey",
  category)` khi một sự kiện thu phí xảy ra (vd cấp/gia hạn DID). **KHÔNG đụng backend Java
  (PhoenixKeyDID/Database)** — tích hợp ở lớp Frontend/SDK (xem EXEC + ranh giới sửa code).

### 1.5 Ví dụ — OriLife

- **Cửa 1:** seed custody `instance_id="orilife"`, `accepted_assets=[LAMP, ADA]`, `governance_ref` =
  DAO OriLife (RIÊNG — KHÁC PhoenixKey).
- **Cửa 2:** authority ký register `platform_id="orilife"`.
- **Cửa 3:** OriLife **mobile/SDK** (lớp touchable) định giá `animal_fee` (bò ≠ gà — app-level), rồi
  gọi `collectToTreasury(LAMP, fee, "orilife", category)`, gộp nhiều con vật trong một settlement tx
  mỗi epoch. **KHÔNG đụng backend OriLife** — tích hợp ở mobile/SDK.

---

## 2. Collect adapter — sự kiện platform → CollectItem

Collect adapter là **lớp keo** giữa **logic app** (sự kiện + định giá) và **cửa thu Treasury**
(`collectToTreasury`). Nó KHÔNG định giá; nó **gom + dịch + batch**.

### 2.1 Adapter làm gì

1. **Nghe sự kiện app** — vd OriLife "con vật X được định danh, phí Y LAMP"; PhoenixKey "DID Z gia hạn,
   phí W". App đã tính `amount` (định giá ở app).
2. **Dịch sang `CollectItem`** — `{ app_id, policy, name, amount, category }` (schema Treasury). `app_id`
   = `platform_id` (hoặc sub-id của app), `category` = bucket đích, `amount` = số app tính.
   > ⛔ **F8 — `app_id` VÔ DANH on-chain:** `app_id` chỉ ở redeemer Collect, KHÔNG được neo vào datum
   > custody (Treasury chưa có `receipt_root`). Sau khi tx confirm không gì chứng thực ai đóng góp. **VP/uy
   > tín KHÔNG được tin `app_id` từ Collect** để cấp tín dụng C1 (MAGIC tiêu thụ) tới khi receipt thực thi
   > thật (chống bịa). receipt = v1.x / bỏ lời hứa. (CONTRACT PK11, `Treasury/Tech-Spec.md §6`.)
3. **Batch** — gom N item thành **một** `Collect{ items: [N] }` settlement tx mỗi cửa-sổ (mỗi epoch /
   mỗi ngưỡng số item — **tham số mở**), thay vì một tx mỗi micro-fee (bất khả thi vì min-ADA + phí mạng,
   `Treasury/Feat-Spec.md §2.3`).
4. **Build tx** — spend custody mới nhất, tạo custody output (value + sổ cập nhật), trả `residual` ra
   provider/node nếu có (`Treasury/Tech-Spec.md §4`).

### 2.2 Pricing ở app — KHÔNG ở adapter

Adapter **không biết** bò đắt hơn gà. Định giá (`animal_fee` OriLife; phí DID PhoenixKey) + quy đổi
LAMP↔USD/ADA (oracle) nằm **ở app**. Adapter nhận `amount` đã tính, đúng tinh thần Treasury §2.4: một
khuôn onboarding đa platform **không thể biết mô hình giá của mọi app** — nhúng định giá vào sẽ phá
open SDK.

> **Hai tỷ lệ KHÔNG trộn** (kế thừa `Treasury/Feat-Spec.md §2.4`): `animal_fee` 7% của OriLife là **phí
> app-level** (app thu của người dùng); `cut_bps` là **cắt protocol-level** Treasury lấy trên `amount`.
> Hai con số hai tầng — KHÔNG suy ra `cut_bps = 7%`.

### 2.3 Adapter là tùy biến nhẹ per-platform

Mỗi platform có sự kiện riêng → adapter là **lớp mỏng app tự viết** (nghe sự kiện của họ, map sang
`CollectItem`). SDK PlatformKit cung cấp **khung chung** `collectAdapter(events) -> CollectItem[]` +
builder batch; phần "sự kiện gì → amount bao nhiêu" do app điền. Đây là **đường mở rộng đúng chỗ**:
chung phần cơ học (batch/build/receipt), riêng phần nghiệp vụ (định giá/sự kiện).

---

## 3. Discover registry — tìm platform

Discover = **quét beacon policy**, không cần danh bạ trung tâm.

### 3.1 Cách discover

- Quét tập UTxO mang token của `registry_beacon` policy (Blockfrost/Kupo `assets/{policy}` rồi đọc
  UTxO mang mỗi token). Mỗi UTxO = một entry; asset name = `platform_id`; datum = `PlatformEntry`.
- **Lọc theo status:** discover mặc định trả platform `status == Active`; có thể lấy cả `Paused`/`Retired`
  cho audit/lịch sử.
- **Đọc một platform:** từ `PlatformEntry` ra `(instance_id, custody_hash, seed_policy, governance_ref,
  accepted_assets, cut_bps, status)` → biết kho ở đâu, thu asset gì, cut bao nhiêu, gác bởi governance nào.

### 3.2 Vì sao discover rẻ + không contention

Beacon-per-platform (CONTRACT §3.1): "tất cả platform" = một policy → một lần quét policy ra toàn bộ sổ.
Không UTxO trung tâm phải spend → register/discover song song, không đua. Một platform mới xuất hiện =
một UTxO mới mang beacon → quét lần sau là thấy, không phải cập nhật danh bạ ở đâu cả.

### 3.3 Đối soát entry với custody (entry là chỉ-mục, custody là chuẩn)

Entry đăng bạ `(cut_bps, accepted_assets, governance_ref)` là **bản sao đọc nhanh**. Khi cần con số
**ràng buộc** (vd verify cut thực một platform đang dùng), SDK đọc lại **custody datum** (nguồn chân lý
— CONTRACT §2 ghi chú, PK7). Nếu lệch (DAO đổi custody nhưng chưa cập nhật entry), custody thắng; SDK
nên gợi ý update entry cho khớp.

### 3.4 Tin discover TỚI ĐÂU — bắt buộc đối soát custody trước khi route phí (audit)

`discoverPlatforms` **CHỈ đọc datum** trong entry — datum có thể khai `seed_policy/instance_id/custody_hash`
**bất kỳ**. Vì vậy discover là **chỉ-mục để tìm**, KHÔNG phải bằng chứng đủ để **route phí** tới một
custody. Người tin (ví/app gửi value tới kho của một platform) PHẢI qua ba van trước khi tin:

1. **Đối soát custody THẬT (audit #6, BẮT BUỘC trước route phí).** Gọi `verifyEntryAgainstCustody(entry,
   custodyUtxo)` — kiểm custody UTxO thật mang đúng 1 NFT authenticity `(seed_policy, instance_id)` Ở
   `Script(custody_hash)`. On-chain R-BIND đã ép lúc ĐĂNG KÝ; nhưng reader hậu kỳ vẫn phải đối soát lại
   (custody có thể đã được spend/đổi sau register). Chưa verify against custody thật → KHÔNG route phí.
2. **Kiểm trùng `platform_id` (audit #2).** `discoverPlatforms` đánh dấu `duplicate=true` cho mọi entry
   có `platform_id` xuất hiện ≥2 lần trong lô; `findDuplicatePlatformIds` liệt kê. On-chain KHÔNG ép
   `platform_id` duy nhất (beacon không one-shot — đây là van quy trình, KHÔNG đảm bảo mật mã). Có trùng
   → KHÔNG im lặng chọn cái đầu; phải đối soát custody chọn entry thật hoặc từ chối.
3. **Cảnh báo entry ở Script lạ (audit #3).** Cấp `registryScriptHash` cho `discoverPlatforms` → entry
   mà NFT beacon nằm ngoài registry validator thật bị đánh dấu `foreignScript=true`. Bỏ qua hoặc soi kỹ.

> **Vì sao discover một mình KHÔNG đủ tin (first-principles):** một beacon NFT + datum chỉ chứng minh
> "authority đã ký một đăng ký", KHÔNG chứng minh "entry này trỏ đúng custody thật ở thời điểm route phí".
> Ba van trên đưa discover từ "thấy" sang "đủ tin để gửi tiền". (Chi tiết SDK ở `Tech-Spec.md §6.4`; mô hình
> tin cậy + lộ trình đóng ở `CONTRACT.md §8`.)
>
> ⛔ **F13 (vá lần 2 — nhấn mạnh):** `verifyEntryAgainstCustody` + dedup (`findDuplicatePlatformIds`) chỉ
> là **VAN SDK** — SDK KHÔNG ép được. **Người tích hợp PHẢI tự gọi TRƯỚC khi route phí.** Bỏ qua = gửi
> tiền tới custody giả mạo (entry nói dối) hoặc entry trùng `platform_id`. Đây là kỷ luật phía caller,
> không phải bất biến on-chain.

---

## 4. Vòng đời đăng bạ nhìn từ ngoài

Nhìn từ người dùng registry (không phải on-chain), một platform tiến qua:

- **Register → Active** — xuất hiện, được hiển thị mặc định.
- **Active ⇄ Paused** — tạm ẩn (bảo trì/điều tra); custody vẫn còn, discover mặc định lọc ra; quay lại
  Active được.
- **→ Retired** — ngừng hẳn đăng bạ; **trạng thái CUỐI, không revive** (U-TERMINAL ép on-chain — không
  Retired→Active). **entry KHÔNG biến mất** (retire = status, không xóa — CONTRACT §4). Lịch sử "platform
  này từng tồn tại, trỏ kho nào" tra mãi được. `platform_id` không tái cấp.

**KHÔNG có un-register.** Registry chỉ tiến trạng thái + đổi mutable fields, không xóa bản ghi — một sổ
đăng bạ bền vững phải chỉ-thêm/đổi-trạng-thái.

> ⛔ **F7 — `status` KHÔNG đóng quỹ (đọc kỹ — chống hiểu nhầm).** `Paused`/`Retired` chỉ đổi **cách hiển
> thị trong discover** (ẩn entry khỏi danh sách mặc định). Chúng **KHÔNG dừng** custody: kho của platform
> đó **vẫn thu (Collect) + chi (Release)** bình thường vì Registry không gác custody on-chain (custody và
> registry là hai validator độc lập về dòng tiền). **"Một platform Retired = quỹ của nó đã đóng" là HIỂU
> NHẦM** — value vẫn sống, vẫn vận hành qua `governance_ref` riêng. Muốn ĐÓNG quỹ thật phải dùng cơ chế
> release/governance ở custody, KHÔNG phải đổi status entry. (Muốn Pause THẬT cần v1.x: custody đọc entry
> qua reference input — CONTRACT §4 / TECH §4.)

---

## 5. Ai dùng — open SDK cho team Cardano

### 5.1 Người onboard platform (team eco)

Một team Cardano bất kỳ: chạy ba cửa → có kho + được đăng bạ, **không fork** Treasury, **không tự viết**
logic kho bạc/split/double-satisfaction/discover. PhoenixKey + OriLife là hai platform đầu; team thứ ba
dùng **cùng** registry + **cùng** Treasury validator.

### 5.2 registry_authority (committee → DAO)

v1: một **multisig committee** giữ `registry_authority` (Governance chưa thật). Vai: kiểm tham số đăng
ký + ký register/update + đảm bảo `platform_id` duy nhất. KHÔNG động value (value ở custody, gác bởi
`governance_ref` riêng). Khi Governance chạy → chuyển authority về DAO.

### 5.3 Người discover (ví, explorer, app khác)

Bất kỳ ai cần biết "hệ sinh thái này có platform nào" — quét beacon policy ra danh sách. Không cần quyền,
không cần ai vận hành danh bạ. **Nếu định route phí** (không chỉ liệt kê): phải qua ba van §3.4 — đối
soát custody thật (`verifyEntryAgainstCustody`), kiểm trùng id (`duplicate`), cảnh báo script lạ
(`foreignScript`). Discover một mình KHÔNG đủ tin để gửi tiền.

### 5.4 User story

**US-1 — Team onboard (lập trình viên OriLife):**
> "Tôi chạy `seedCustody()` một lần → có kho. Tôi xin authority ký register → platform tôi hiện trên
> registry. App mobile tôi gọi `collectToTreasury(LAMP, animal_fee, 'orilife', category)`, gộp nhiều con
> vật mỗi epoch qua collect adapter. Tôi KHÔNG phải viết kho bạc, split cut, hay logic discover. Tôi
> KHÔNG đụng backend — chỉ nối ở lớp mobile/SDK."

**US-2 — registry_authority (thành viên committee):**
> "Một team xin đăng ký `platform_id='neobank'`. Tôi kiểm tham số: custody đã seed đúng? `governance_ref`
> RIÊNG (không trùng platform khác — PK6)? `cut_bps` hợp lý? Nếu ổn tôi ký `RegisterPlatform`. Tôi
> KHÔNG ký trùng `platform_id` (đảm bảo duy nhất). Tôi KHÔNG chi được value của bất kỳ platform nào —
> đó là việc của `governance_ref` từng platform."

**US-3 — Người discover (ví Cardano):**
> "Tôi quét `registry_beacon` policy → ra danh sách mọi platform Active: tên, kho ở đâu, thu asset gì.
> Không ai phải vận hành một API danh bạ cho tôi — registry là on-chain, đọc trực tiếp."

**US-4 — PhoenixKey tích hợp (lập trình viên Frontend):**
> "Tôi nối collect ở **Frontend/SDK**: khi một DID được cấp/gia hạn, tôi tạo `CollectItem(LAMP, fee,
> 'phoenixkey', category)`, batch theo epoch, build settlement tx. Tôi KHÔNG đụng backend Java
> (PhoenixKeyDID/Database) — đó ngoài ranh giới."

---

## 6. Tham số mở (DAO / authority định)

| Tham số | Ý nghĩa | Ghi chú |
|---|---|---|
| `registry_authority` | ai ký register/update | v1 = committee multisig; → DAO khi Governance chạy |
| `cut_bps` mỗi platform | protocol cut của instance đó | trùng custody datum; đổi qua Governance của platform |
| Cửa sổ batch collect | bao nhiêu sự kiện / bao lâu gộp một settlement | đánh đổi độ trễ ghi sổ ↔ phí; per-platform |
| `accepted_assets` mỗi platform | asset platform thu | per-platform; LAMP/ADA/token riêng |
| Chính sách duyệt đăng ký | tiêu chí authority chấp nhận một platform | curated; chính sách committee → DAO định |

---

## 7. Phụ thuộc

- **Treasury** (`Treasury/CONTRACT.md`) — custody/collect/release + `custody_seed` (cửa 1). PlatformKit
  dùng lại, không sửa.
- **Governance** (`Governance/VotingPower/`) — đích `governance_ref` (gác release từng platform). v1
  bootstrap committee, → DAO.
- **Oracle** LAMP↔USD/ADA — cho app **định giá** (cửa 3), **NGOÀI** PlatformKit (app-side).
- **Caller app:** PhoenixKey (Frontend/SDK), OriLife (mobile/SDK), team Cardano khác (open SDK).
