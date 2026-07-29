# PlatformKit — CONTRACT (interface khóa: khuôn mẫu onboarding platform)

**Trạng thái:** khung interface 2026-06-15 (chờ anh duyệt). Đây là **xương sống** cho lớp onboarding:
mỗi Platform (PhoenixKey, OriLife, team eco khác) đăng ký một lần là có sẵn hệ thống tương tự
MagicLamp (**Treasury custody instance** + **entry Registry**). KHÔNG ai tự đổi schema/bất biến ở đây.

Gốc: tái dùng **Treasury** đa thuê bao (`Treasury/CONTRACT.md §1` instance param hóa, §10 hardening v1)
+ Registry on-chain vừa xây (`Treasury/onchain/lib/magiclamp/treasury/platform.ak`,
`validators/registry_beacon.ak`, `validators/registry.ak`). PlatformKit **KHÔNG phát minh kho bạc mới**
— nó là **khuôn lắp ráp** quanh Treasury đã có + một **sổ đăng ký** để các platform discoverable.

> **Mục tiêu cuối (KHÔNG đổi):** làm LAMP có giá trị bằng **open SDK** cho mọi Cardano team. PlatformKit
> hạ rào onboarding: một team không cần đọc hết Treasury internals — họ chạy 3 cửa (seed → register →
> integrate) là có kho bạc + được đăng bạ. Mỗi platform thêm vào là một caller `collectToTreasury`,
> một nguồn cầu LAMP.

---

## 1. Mô hình: "platform = instance Treasury + entry Registry"

- Một **Platform** = **một Treasury custody instance** (param hóa riêng — `Treasury/CONTRACT.md §1`)
  **cộng** **một entry Registry** trỏ tới instance đó.
- **Treasury instance** đã cho platform: custody UTxO giữ value đa-asset + **sổ bucket trong datum**,
  hai cửa nóng `Collect`/`Release`, NFT authenticity `seed_policy` (hardening v1 §10 H5). PlatformKit
  KHÔNG sửa custody — nó **dùng lại nguyên** validator Treasury.
- **Entry Registry** = một UTxO mang **beacon NFT** (`registry_beacon` policy, asset name = `platform_id`)
  + datum `PlatformEntry` trỏ `(instance_id, custody_hash, seed_policy, governance_ref, accepted_assets,
  cut_bps, status)`. Đây là **con trỏ discoverable**, KHÔNG giữ value, KHÔNG thay custody.
- **Tách bạch hai tầng:** Registry là **sổ chỉ-đường** (ai tồn tại, trỏ đâu, trạng thái gì). Treasury là
  **kho thật** (value + kế toán). Registry KHÔNG bao giờ giữ tiền — sai tầng = bloat + lẫn quyền.

**Vì sao không nhét platform-metadata vào custody datum (first-principles):** custody datum là đường
nóng (mọi Collect/Release giải mã nó, chi phí O(K·M) — `Treasury/TECH.md §3`). Thêm metadata onboarding
vào đó làm phình datum nóng vô ích. Tách entry Registry ra một UTxO riêng (đường lạnh, chỉ đụng khi
register/update) giữ custody gọn.

---

## 2. Tham số một platform (cấu hình onboarding)

Một platform khai báo một bộ tham số. Chia hai nhóm theo **đời sống** (bám kỷ luật Treasury §1:
param-validator = bất biến đời instance; datum = DAO chỉnh):

| Nhóm | Tham số | Đời sống | Nằm ở |
|---|---|---|---|
| **Identity** (bất biến) | `platform_id` | đặt một lần, không đổi | beacon NFT name + `PlatformEntry.platform_id` |
| | `instance_id` | = seed NFT name của custody | `PlatformEntry.instance_id` |
| | `custody_hash` | script hash custody.ak của platform | `PlatformEntry.custody_hash` |
| | `seed_policy` | policy NFT authenticity custody | `PlatformEntry.seed_policy` |
| | `created_epoch` | epoch đăng ký | `PlatformEntry.created_epoch` |
| **Mutable** (DAO chỉnh) | `governance_ref` | DAO/committee gác release của platform | `PlatformEntry.governance_ref` |
| | `accepted_assets[]` | assets platform thu (LAMP/ADA/token) | `PlatformEntry.accepted_assets` |
| | `cut_bps` | `protocol_cut_bps` của instance | `PlatformEntry.cut_bps` |
| | `status` | `Active` / `Paused` / `Retired` | `PlatformEntry.status` |

> **Ghi chú đối soát với custody:** `cut_bps`, `accepted_assets`, `governance_ref` cũng tồn tại trong
> **custody datum** (nguồn chân lý cho on-chain enforcement). Entry Registry giữ **bản sao đăng bạ**
> để discover/đọc nhanh KHÔNG cần spend custody. Nếu hai nơi lệch (vd DAO đổi `cut_bps` ở custody nhưng
> chưa cập nhật entry), **custody là chuẩn**; off-chain coi entry là chỉ-mục, verify lại bằng custody
> khi cần con số ràng buộc. (Xem `TECH.md` invariant đối soát.)

**Identity 5 field bất biến** (`platform_id, instance_id, custody_hash, seed_policy, created_epoch`) —
khóa cứng on-chain ở `UpdateEntry` (U-ID, `registry.ak`). Đổi một field này = một platform KHÁC, phải
đăng ký mới. Mutable 4 field đổi qua `UpdateEntry` (authority ký).

> **Đăng ký buộc trỏ custody THẬT (R-BIND — `registry_beacon.ak`).** `RegisterPlatform` NAY ép tx đăng ký
> phải **reference một custody UTxO** mang ĐÚNG 1 NFT authenticity `(seed_policy, instance_id)` Ở ĐÚNG địa
> chỉ `Script(custody_hash)`. Hệ quả: entry **KHÔNG nói dối được** về custody — bộ ba `(seed_policy,
> instance_id, custody_hash)` trong datum phải khớp một custody đã seed THẬT trên chain. Buộc onboarding
> đúng thứ tự: **cửa 1 (seed custody) phải submit TRƯỚC cửa 2 (register)** (§6). Đây là vá an ninh đóng
> audit #6 ở **mức đăng ký**; người đọc registry hậu kỳ vẫn nên đối soát lại với custody thật trước khi
> route phí (van SDK `verifyEntryAgainstCustody` — `TECH.md §6`, `FEAT.md §3`).

---

## 3. Mô hình Registry: beacon-per-platform + authority, discoverable, no central contention

Đây là quyết định kiến trúc cốt lõi. **Một registry UTxO trung tâm bị bác bỏ.**

### 3.1 Beacon-per-platform (KHÔNG registry UTxO trung tâm)

- **Mỗi platform = một beacon NFT** (name = `platform_id`) dưới **một policy chung** `registry_beacon`.
- **"Tất cả platform" = tập UTxO mang token của `registry_beacon` policy** — query policy id ra toàn bộ
  sổ đăng ký. Discoverable bằng một lần quét policy (Blockfrost/Kupo `assets/{policy}`).
- **Mỗi entry độc lập một UTxO** → register/update platform A KHÔNG đụng UTxO platform B. **No central
  contention.**

**Vì sao bác registry UTxO trung tâm (first-principles + bài học Treasury):** một UTxO "danh sách tất cả
platform" là **điểm contention tuần tự** (mọi register phải spend nó rồi tạo lại — hai đăng ký không vào
cùng block độc lập) **và** phình O(N) theo số platform (đúng vết `consumed_proposals` mà Treasury phải
vá — `Treasury/CONTRACT.md §10 H3`). Beacon-per-platform = mỗi đăng ký là một UTxO mới độc lập → O(1)
mỗi thao tác, song song hóa hoàn toàn.

### 3.2 Authority-gated (tính duy nhất `platform_id` + kiểm duyệt onboarding)

- Cardano **KHÔNG ép unique asset-name dưới một policy** nếu không có state trung tâm. Để `platform_id`
  duy nhất mà KHÔNG cần UTxO trung tâm: dùng **`registry_authority`** (committee → DAO) **ký mỗi đăng ký**
  (R-SIG, U-SIG). Authority **không ký trùng id** → duy nhất bằng kỷ luật ký, không bằng state.
- Đây là **đăng ký có kiểm duyệt** (curated), KHÔNG permissionless. Đúng mô hình platform onboarding:
  - chống **chiếm tên** (squatting `platform_id` đẹp);
  - chống **rác** (spam entry vô nghĩa làm bẩn sổ);
  - cho phép authority kiểm tham số platform hợp lý trước khi đăng bạ.

**Đánh đổi đã cân (4 trục):** authority-curated **bền vững** hơn permissionless cho một sổ đăng bạ
(uy tín registry = uy tín các platform trong đó). Rủi ro tập trung được giảm bằng **lộ trình
committee → DAO**: v1 authority = multisig committee bootstrap (Governance chưa thật); khi Governance
chạy → chuyển `registry_authority` về DAO (xem `EXEC.md` known-gap). Authority CHỈ gác **đăng bạ**,
KHÔNG động được **value** (value ở custody, gác bởi `governance_ref` riêng từng platform — §5).

> **Known-gap audit #2 — `platform_id` duy nhất là VAN QUY TRÌNH, KHÔNG bất biến mật mã.** `registry_beacon`
> KHÔNG one-shot (không consume một genesis UTxO duy nhất) → on-chain KHÔNG biết một `platform_id` đã được
> mint trước đó; ràng buộc R-MINT-1 chỉ ép "mint đúng 1 token mỗi tx". Vì vậy tính duy nhất dựa **hai van
> quy trình**: (1) `registry_authority` không ký 2 lần cùng `platform_id` (authority-curated); (2) SDK dedup
> — `discoverPlatforms` đánh dấu `duplicate` cho mọi entry trùng id, caller route phí PHẢI kiểm trước khi
> tin. Đây **không** phải đảm bảo mật mã. Đề xuất đóng v1.x: **one-shot `genesis_ref` per platform** (mẫu
> `custody_seed` — consume UTxO duy nhất → asset-name duy nhất theo cơ chế) hoặc **registry-state roster**
> (đánh đổi: thêm contention). (Xem `TECH.md` GAP-2.)
>
> **Known-gap audit #4 — `registry_authority` hiện 1 key-hash = single point of failure.** Một khóa rò =
> chiếm tên/onboard rác. NÊN là **multisig/committee script** (M-of-N), governance_ref committee → DAO.
> Trước mainnet PHẢI là committee multisig, KHÔNG key đơn. (Xem `EXEC.md §6.1`, `TECH.md` GAP-3.)

### 3.3 Phá vòng beacon↔registry (self-ref NFT)

- `registry_beacon` (minting) cần chọn output entry → nếu param `registry_hash` thì cần hash registry
  trước; registry (spend) cần `beacon_policy` để ép NFT → cần hash beacon trước → **vòng**.
- **Phá vòng:** `registry_beacon` chọn output entry bằng **self-reference NFT** (output mang **chính
  token vừa mint**, ở Script address bất kỳ) — KHÔNG param `registry_hash` (R-OUT-1). `registry` param
  `beacon_policy = hash(registry_beacon(authority))` — chỉ phụ thuộc `authority`, KHÔNG phụ thuộc hash
  registry → không vòng. Deploy được theo một chiều (beacon trước, registry sau).

> Mẫu self-ref này gương đúng `custody_seed` của Treasury (`Treasury/EXEC.md §16` — phá vòng
> seed↔custody bằng self-reference NFT). Cùng triết lý: minting policy chọn output bằng "token tôi vừa
> mint", không cần biết hash đích.

---

## 4. Vòng đời platform (Register → Update status)

Một platform đi qua **một** lần Register rồi sống bằng các Update:

```
   (seed custody — Treasury custody_seed)         ┌─────────────┐
   genesis ──────────────────────────────────────▶│ custody UTxO │ (value + sổ)
                                                   └─────────────┘
                                                          ▲ trỏ
   RegisterPlatform (registry_beacon mint) ──▶ entry UTxO (beacon NFT + PlatformEntry, status=Active)
                                                          │
   UpdateEntry (registry spend, authority ký) ──▶ đổi status: Active ⇄ Paused → Retired (terminal)
                                                  + đổi mutable (governance_ref/accepted/cut_bps)
```

**Vòng đời status là MỘT CHIỀU, Retired là trạng thái CUỐI (U-TERMINAL — `registry.ak`).** `Active ⇄ Paused`
đảo ngược tự do; `→ Retired` một chiều — entry đã Retired KHÔNG spend/update được nữa (validator ép
`entry_in.status != Retired`, chặn cả Retired→Active lẫn Retired→Retired). Đây là vá an ninh khóa cứng
thứ tự status **on-chain** (trước đây chỉ là chính sách authority off-chain).

| Bước | Hành động | Validator | Ràng buộc khóa |
|---|---|---|---|
| **Register** | mint beacon NFT(name=`platform_id`) + tạo entry UTxO ở `registry`, status=`Active` | `registry_beacon` | R-MINT-1/R-SIG/R-OUT-1/R-WF/R-NAME/**R-BIND**; **entry well-formed + Active + trỏ custody THẬT** |
| **Update status** | đổi `status` (Active/Paused/Retired) và/hoặc mutable fields | `registry` (UpdateEntry) | U-SIG/U-SINGLE/U-NFT/U-ID/U-MUT/U-MINT-0/**U-TERMINAL**; **identity 5 field bất biến + Retired terminal** |

**Ngữ nghĩa status:**
- **`Active`** — platform đang thu/chi bình thường; được hiển thị trong discover mặc định.
- **`Paused`** — tạm dừng đăng bạ (vd đang bảo trì/điều tra); custody vẫn tồn tại, nhưng discover lọc ra.
  Đảo ngược được (`Paused → Active`).
- **`Retired`** — ngừng hẳn đăng bạ; **trạng thái CUỐI, không revive** (U-TERMINAL ép on-chain: entry
  Retired không spend/update được nữa → không Retired→Active). **KHÔNG xóa entry** (retire = đổi status
  trong datum, KHÔNG spend-burn beacon). Beacon sống suốt vòng đời → lịch sử platform tra được, audit
  không mất dấu.

> ⛔ **F7 (vá lần 2 — reconcile): `status` là NHÃN DISCOVERY, KHÔNG phải van chặn dòng tiền.** Registry
> **KHÔNG gác custody on-chain** — `registry.ak` (UpdateEntry) chỉ ép U-* về ENTRY (identity/mutable/NFT/
> authority), KHÔNG đọc custody, và **custody validator KHÔNG đọc registry** (custody.ak không có bất kỳ
> reference input registry nào). Hệ quả: đặt `status=Paused`/`Retired` **KHÔNG dừng** được Collect/Release
> ở custody của platform đó — kho VẪN thu/chi bình thường. **Người tin "Retired = quỹ đóng" là HIỂU NHẦM:**
> Retired chỉ ẩn entry khỏi discover mặc định, value ở custody vẫn sống và vẫn vận hành qua governance_ref
> riêng của nó. Đây là **tách tầng có chủ đích** (PK1: registry = con trỏ, custody = kho) — nhưng phải ghi
> rõ để không ai dựa `status` làm cơ chế đóng quỹ. **Đề xuất v1.x nếu muốn Pause THẬT:** cho custody đọc
> entry registry qua **reference input** (custody param thêm `registry_beacon_policy`; nhánh Collect/Release
> ép `entry.status == Active`). Đánh đổi: thêm một reference input mỗi tx custody + ràng buộc vòng đời
> custody↔registry. Hiện v1 **KHÔNG** làm — status thuần là nhãn đăng bạ.

> **Vì sao retire = status, KHÔNG burn beacon (first-principles):** burn beacon = mất bản ghi platform
> từng tồn tại → đứt audit trail + một `platform_id` có thể bị tái cấp cho platform khác (lẫn lịch sử).
> Giữ beacon + đặt `status=Retired` = supply NFT bất biến, lý luận an toàn đơn giản (cấm burn ở cả
> `registry_beacon` else-fail lẫn `registry` U-MINT-0), `platform_id` không tái dùng. Đồng nhất triết lý
> "no-burn" của LAMP/Treasury ở tầng registry.

**KHÔNG có cửa hủy-đăng-ký (un-register).** Registry chỉ tiến trạng thái (Active⇄Paused→Retired), không
xóa. Đây là cố ý: một sổ đăng bạ phải **chỉ thêm/đổi-trạng-thái**, không được rò bản ghi.

---

## 5. Ranh giới: mỗi platform `governance_ref` RIÊNG (#1B Treasury — nay ĐÓNG, giữ defense-in-depth)

> ✅ **#1B ĐÓNG (vá lần 2 F10 — `Treasury/CONTRACT.md §10 H1B`).** `spend_spec_hash` Treasury NAY gồm
> `instance_id` (`= blake2b(0x02 ‖ blake2b(instance_id) ‖ blake2b(cbor(draws)))`) → proposal của instance A
> KHÔNG dùng được cho instance B **dù CÙNG `governance_ref`** (hash khác instance ⇒ release reject). Lỗ
> replay-chéo cùng governance_ref đã bị chặn **on-chain ở Treasury**, không còn là known-gap.

**Ràng buộc PK6 GIỮ NGUYÊN như defense-in-depth (KHÔNG còn bắt buộc bởi #1B):**

> Mỗi custody instance NÊN có **`governance_ref` RIÊNG** — khuyến nghị mạnh, không hai platform dùng chung.
> Sau khi #1B đóng, dùng chung `governance_ref` KHÔNG còn gây replay-chéo (instance_id trong spec_hash đã
> khóa), nhưng giữ riêng vẫn tốt cho **tách quyền release** (mỗi platform một cổng governance độc lập →
> blast-radius nhỏ khi một governance bị tổn hại) — đây là lý do giữ PK6.

⛔ **YÊU CẦU INTERFACE thay thế lên Governance (F10):** khi tạo proposal, Governance PHẢI tính
`spend_spec_hash` với ĐÚNG `instance_id` đích (commit target instance). Tính sai instance ⇒ proposal không
chi được ở instance nào. Đây là ràng buộc build-side của Governance (đã thay cho known-gap #1B cũ).

Lý do giữ PK6: entry well-formed đòi `governance_ref != #""` (R-WF); checklist onboarding §6 khuyến nghị
giá trị **riêng per-platform** (tách quyền, không còn vì replay-chéo).

**Hệ quả cho cấu trúc một platform (sau #1B đóng — KHUYẾN NGHỊ, không còn bắt buộc bởi replay):**
- Platform có **emergency bucket tách physical** (custody instance thứ hai — `Treasury/TECH.md §1`) NÊN
  trỏ `governance_ref` **khác** custody chính (tách quyền release; #1B đã khóa replay qua instance_id).
- Hai platform khác nhau (PhoenixKey vs OriLife) **nên** hai `governance_ref` khác nhau (tách quyền).

**Ranh giới quyền (KHÔNG lẫn):**
- `registry_authority` gác **đăng bạ** (register/update entry). KHÔNG động value.
- `governance_ref` (riêng từng platform) gác **release value** ở custody của platform đó. KHÔNG động
  registry. Hai quyền **tách bạch hoàn toàn** — authority không chi được tiền, governance không niêm
  yết được platform.

---

## 6. Ba cửa onboarding (seed custody → register → integrate collect)

Một team onboard qua **ba cửa tuần tự**, mỗi cửa một ranh giới rõ:

### Cửa 1 — Seed custody (dựng Treasury instance)
Chạy `custody_seed` (Treasury) một lần: consume genesis UTxO, mint NFT authenticity (name=`instance_id`),
tạo custody UTxO đầu (value + sổ base-case đúng, seed guards S-CUT-0/S-LEDGER-1/S-ID-0/S-ACC-1 —
`Treasury/EXEC.md §16`). **Output:** `instance_id`, `custody_hash`, `seed_policy`. Đây là **kho** của
platform.

### Cửa 2 — Register (đăng bạ vào Registry)
Authority ký `RegisterPlatform` (`registry_beacon` mint): mint beacon NFT(name=`platform_id`) + tạo
entry UTxO trỏ tới custody vừa seed (`instance_id/custody_hash/seed_policy/governance_ref/accepted/
cut_bps`, status=`Active`). **Output:** platform **discoverable**. Đây là **con trỏ** vào kho.

> **R-BIND — custody phải seed + submit TRƯỚC khi register.** Tx register PHẢI **reference** custody UTxO
> của cửa 1 (mang NFT authenticity `(seed_policy, instance_id)` Ở `Script(custody_hash)`). Vì vậy cửa 1
> không chỉ "chạy trước" mà phải **đã submit on-chain** (custody UTxO tồn tại để reference) trước cửa 2.
> Entry không trỏ được tới custody chưa tồn tại → không nói dối custody. (Vá an ninh — `TECH.md §3` R-BIND.)

### Cửa 3 — Integrate collect (nối app vào kho)
App của platform gọi `collectToTreasury(asset, amount, app_id, category)` của custody instance mình
(`Treasury/FEAT.md §2`). Định giá ở app (`amount` đã tính), Treasury split `cut` → bucket + receipt.
Đây là **luồng thu** thật — kho bắt đầu nhận value. Tích hợp ở **lớp touchable** của platform
(Frontend/SDK/mobile), KHÔNG đụng backend nội bộ platform (xem `EXEC.md`).

> Ba cửa **tách bạch + tuần tự**: seed (có kho) → register (được thấy) → integrate (bắt đầu thu). Một
> team có thể dừng sau cửa 1 (kho riêng, không đăng bạ) hoặc cửa 2 (đăng bạ, chưa nối app). Cửa 3 là
> nơi LAMP/asset thật chảy về.

---

## 7. Phụ thuộc

- **Treasury** (`Treasury/CONTRACT.md`) — nền custody/collect/release + `custody_seed`. PlatformKit
  KHÔNG sửa, chỉ dùng lại. Registry on-chain **đã sống cùng cây** `Treasury/onchain/`
  (`platform.ak` + `registry_beacon.ak` + `registry.ak`) — PlatformKit là tầng spec mô tả + lớp off-chain
  + lộ trình bootstrap quanh chúng.
- **Governance** (`Governance/VotingPower/`) — đích của `governance_ref` (gác release từng platform).
  v1 chưa thật → `registry_authority` + `governance_ref` bootstrap bằng **committee multisig**, chuyển
  DAO khi Governance chạy (known-gap §5 + `EXEC.md`).
- **Caller app:** PhoenixKey (Frontend/SDK), OriLife (mobile/SDK), team Cardano khác (open SDK). Mỗi
  caller là một platform tự seed custody + tự là caller `collectToTreasury` của instance mình.

---

## 8. Bất biến interface (KHÓA — mọi spec PlatformKit phải khớp)

- **PK1 — Platform = (Treasury instance) + (entry Registry).** Registry là con trỏ, KHÔNG giữ value.
- **PK2 — Beacon-per-platform.** Mỗi platform một beacon NFT (name=`platform_id`) dưới policy chung;
  discover = quét policy. KHÔNG registry UTxO trung tâm (no contention, no O(N) bloat).
- **PK3 — Authority-gated, curated.** `registry_authority` ký mọi register/update → `platform_id` duy
  nhất + kiểm duyệt. KHÔNG permissionless. Authority gác **đăng bạ**, KHÔNG gác **value**.
- **PK4 — Identity 5 field bất biến.** `platform_id, instance_id, custody_hash, seed_policy,
  created_epoch` khóa cứng (U-ID). Đổi = platform mới.
- **PK5 — Retire = status, KHÔNG burn.** Beacon sống suốt đời; vòng đời chỉ tiến (Active⇄Paused→Retired),
  KHÔNG xóa entry. Đồng nhất no-burn của LAMP/Treasury.
- **PK6 — Mỗi platform `governance_ref` RIÊNG** (khuyến nghị defense-in-depth). #1B ĐÓNG ở Treasury (F10
  — `spend_spec_hash` gồm `instance_id`), nên dùng chung KHÔNG còn gây replay-chéo; giữ riêng để **tách
  quyền release** (blast-radius nhỏ). Yêu cầu interface thay thế: Governance commit đúng `instance_id` khi
  tạo proposal.
- **PK7 — custody là nguồn chân lý** cho `(cut_bps, accepted_assets, governance_ref)`; entry là bản sao
  đăng bạ, verify lại bằng custody khi cần con số ràng buộc.
- **PK8 — Đăng ký buộc trỏ custody THẬT (R-BIND).** `RegisterPlatform` ép reference-input custody mang
  đúng 1 NFT authenticity `(seed_policy, instance_id)` Ở `Script(custody_hash)` → entry không nói dối
  custody. Custody phải seed + submit TRƯỚC register. (Vá an ninh — đóng audit #6 ở mức đăng ký.)
- **PK9 — Retired là trạng thái CUỐI (U-TERMINAL).** Vòng đời một chiều Active⇄Paused→Retired; entry
  Retired không spend/update được nữa (cấm revive). Thứ tự status ép on-chain, không còn là chính sách
  off-chain. (Vá an ninh.)
- **PK10 — `status` là NHÃN DISCOVERY, KHÔNG van chặn dòng tiền (F7).** Registry KHÔNG gác custody on-chain
  (custody validator không đọc registry; registry không đọc custody). `Paused`/`Retired` KHÔNG dừng được
  Collect/Release ở custody — kho vẫn thu/chi. "Retired = quỹ đóng" là HIỂU NHẦM. Muốn Pause THẬT → v1.x
  (custody đọc entry qua reference input). (§4.)
- **PK11 — receipt/app_id CHƯA neo on-chain (F8 — kế thừa Treasury).** `app_id` ở `CollectItem` redeemer là
  vô danh; CustodyDatum không có `receipt_root`. **VP/uy tín KHÔNG tin `app_id` từ Collect** để cấp tín
  dụng C1 tới khi receipt thực thi (chống bịa). receipt = v1.x hoặc bỏ lời hứa. (`Treasury/TECH.md §6`.)

> **Mô hình tin cậy khi route phí (audit — đọc kỹ).** `platform_id` duy nhất + `registry_authority` đơn
> khóa là **van quy trình**, KHÔNG bất biến mật mã: discover (`discoverPlatforms`) chỉ đọc datum →
> KHÔNG đủ tin. Người tin PHẢI (a) kiểm `duplicate`/`findDuplicatePlatformIds` (audit #2), (b) gọi
> `verifyEntryAgainstCustody(entry, custodyUtxo)` đối soát custody THẬT trước khi route phí (audit #6
> hậu kỳ), (c) đối với authority đơn khóa — chờ committee multisig trước mainnet (audit #4). Chi tiết +
> lộ trình đóng ở `TECH.md` known-gap GAP-2/3/4/5 + `EXEC.md §6`.
