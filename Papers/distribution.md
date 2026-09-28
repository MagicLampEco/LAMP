# LAMP — Phân phối 36 tỷ ra cộng đồng

> Giải thích 18 pot ra cộng đồng thế nào (nhả / claim / gen-MAGIC).
> Tầng MINT (lazy-mint, registry, cap-param, A-DEST) ở `Genesis/CONTRACT.md` — KHÔNG lặp ở đây.
> Catalog mô tả pot ở `pot-catalog.md`. Đơn vị: **NGHÌN LAMP** (tổng 36.000.000 = 36 tỷ).
> Mọi cơ chế bám mã đã có (claim_account / beacon / treasury / srcl / airdrop).

---

## 1. Nguyên tắc

1. **36 tỷ cố định, không đốt.** Giảm lưu hành = parked vào Treasury (kế toán), không huỷ token.
2. **Mô hình U/C/T:** `U + C + T = 36 tỷ`. U = chưa-mint (gồm Reserve), C = lưu hành, T = Treasury parked.
   `U→C` một chiều (mint). Điều tiết 2 chiều CHỈ ở `C↔T`. Reserve không quay lại U (no-burn).
3. **Lazy-mint:** token chưa phát hành = chưa tồn tại on-chain. Pot không "giữ sẵn" token trừ khi cơ chế đòi.
4. **Nhỏ-giọt công bằng:** pot sáng lập đi đúng engine CappedDrop như pot cộng đồng — cùng công thức trần
   tích luỹ, cùng phép cắt ngọn, không có nhánh tắt riêng. Tham số nhịp của từng pot nằm trên chuỗi, đọc
   lại được, công bố khi phát hành; không có cliff bí mật.
5. **MAGIC = sổ kế toán**, sinh tự động theo LAMP gắn DID; KHÔNG phải token. Quyền lực (VP) = MAGIC **tiêu thụ**, không nắm giữ.

---

## 2. Allocation 18 pot (nghìn LAMP)

Xem bảng đầy đủ ở `pot-catalog.md §1`. Tóm tắt theo **cơ chế nhả**:

| Cơ chế nhả | Pot | Tổng (nghìn) |
|---|---|---:|
| **CappedDrop** (vesting/epoch) | Development, Platform, App, Referrer, PhoenixKey, Aladin, GreenSun, Partnership, Join LampNet | **21.707.857** |
| **Vault-vesting** (mở dần theo đêm, do PhoenixKey vận hành) | Wakeme | 1.001.000 |
| **Snapshot-Merkle** (claim permissionless) | ETD, Airdrop, SRCL | 492.000 |
| **Engine gate-Treasury** | Reserve | 9.630.000 |
| **Kế toán / LP / mở-thanh-khoản** | Treasury, Liquidity, RedBack | 1.873.143 |
| **Khoá vĩnh viễn (chưa-mint tới khi lập pháp nhân)** | Foundation | 1.296.000 |

Tổng = 21.707.857 + 1.001.000 + 492.000 + 9.630.000 + 1.873.143 + 1.296.000 = **36.000.000 nghìn** ✓.
Foundation **không drip** ra lưu hành — minted rồi **khoá gốc vĩnh viễn** sau khi lập pháp nhân: LAMP nằm
trong két của DID Foundation, khoá số dư, nên vẫn gen MAGIC (§4); cơ chế khoá hiện thực cùng lúc lập pháp nhân.
Pháp nhân Foundation đặt ở **nước ngoài**, do cộng đồng DAO hình thành từ đợt Airdrop lập ra; trạng thái các điểm
còn mở ở `Papers/pot-catalog.md`, mục "Cổng pháp lý theo pot", dòng `PHAP-NHAN-001`.

---

## 3. Cơ chế nhả — 4 loại

### 3.1 CappedDrop (claim_account vesting) — v3
Engine đã live Preview. Datum `ClaimAccountDatum{owner, entitlement E, redeemed, start_epoch,
drops_per_epoch (ghim = 1 ở v3), index_at_start}` — 6 trường, KHÔNG có `channel_id`.

Mức đã mở khoá không tính theo **số epoch trôi qua** mà theo **chỉ số cộng dồn của beacon** (`A`, tăng
đơn điệu, đọc được mọi lúc mà không cần ai post gì mới): gọi `A_span = A(bây giờ) − index_at_start`
(`index_at_start` chụp lúc tài khoản mở), trần tích luỹ là:
```
(redeemed + amount)² ≤ drops_per_epoch² · E · A_span²      và      redeemed + amount ≤ E
```
(validator kẹp theo dạng bình phương này để khỏi khai căn — không đổi kết quả, chỉ đổi cách tính). Tốc
độ mở khoá **lõm theo cỡ pot** (tỉ lệ √E): tách một pot thành n phần đều nhau chỉ khiến tổng tốc độ mở
khoá nhanh hơn √n lần, không nhanh hơn n lần.

- **Claim** (committee M-of-N cấp thêm rồi đặt lại mốc: quyền còn lại = quyền cũ − đã nhận + phần cấp thêm; tài khoản được REBASE lại mốc thời gian ở cửa sổ đó).
- **Redeem** (permissionless): người dựng tx tự chọn `amount` XIN rút, validator KẸP nó bằng hai tầng —
  trần tích luỹ ở trên, và một phép **cắt ngọn mỗi lượt**: `amount ≤ max(sàn, tổng đã phát · tỷ lệ)`.
  Vượt cắt ngọn KHÔNG bị từ chối, chỉ bị cắt — phần vượt còn nguyên quyền, chờ lượt rút sau.
- Mỗi pot CappedDrop là một cụm triển khai riêng; beacon chốt tốc độ, còn trần ngân sách là sổ quyền
  nhận không vượt số LAMP thật trong kho của cụm (`Distribution/onchain/lib/magiclamp/lampdist/types.ak`).
- Founder (Aladin/GreenSun) đi **đúng engine này như pot cộng đồng** — cùng công thức trần tích luỹ, cùng
  phép cắt ngọn, không có nhánh tắt riêng. Tham số nhịp của từng pot công bố khi phát hành.

### 3.2 Snapshot-Merkle (ETD / Airdrop / SRCL) — §6
Keeper/committee dựng cây Merkle `(owner, amount, epoch)` → post root vào beacon → claim permissionless bằng proof.
Chống double-claim = marker-NFT nullifier (name = leaf) ở script no-spend. Dư sau hạn → Sweep về Treasury.

### 3.3 Reserve — trần nhịp + cổng cầu (§7)
Hai vế bổ sung nhau: trần tối đa mỗi epoch, và cổng chỉ mở khi kho Treasury dưới sàn.
Nguồn duy nhất: [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md).

### 3.4 Chưa-mint / LP / RedBack
- **Chưa-mint** (Reserve): token không tồn tại → không di chuyển/đánh cắp. Reserve chỉ sinh ra theo từng lượt rút, mỗi epoch tối đa một lượt.
- **Liquidity / RedBack:** dự phòng cho nhu cầu thanh khoản trong hệ sinh thái. Cơ chế, thời điểm và điều kiện pháp lý để kích hoạt **chưa được quyết định**; dự án **không cam kết** về việc có kích hoạt hay không.

---

## 4. Quyền gen MAGIC theo pot

**NGUYÊN TẮC CỐT LÕI: MAGIC CHỈ gen trong VAULT của một DID — KHÔNG bao giờ "gen trong pot".**
Một pot gen MAGIC ⟺ LAMP của nó **đã nằm trong một vault-DID**. Luật SnapshotGen:

> **Bất biến quan trọng — LAMP ĐỨNG YÊN:** LAMP **không rời vault khi sinh MAGIC**. `lamp_balance`
> **bất biến** qua mọi cửa gen; LAMP thật trong vault UTxO byte-identical trước và sau một fire.
> LAMP là nền tính suất, không phải nhiên liệu bị chuyển. Luồng "LAMP → Treasury" phát sinh từ
> *hành động sinh MAGIC* là **bất hợp lệ** — mô hình cũ đó đã bị bỏ, chân Treasury và apply-param
> `treasury_addr` đã xoá khỏi validator.
> **Một vế cần nói đúng:** `lamp_locked` bất biến qua **InstantGen** (kho `MagicLampEco/MAGIC` —
> `MAGIC/InstantGen/TECH.md` §A02 — cùng `lamp_balance`, `loyalty_holdings`), nhưng
> **ScheduleFire GIẢI PHÓNG khoá**, tức `lamp_locked` **có giảm** (`MAGIC/ScheduleGen/TECH.md`
> đầu tệp + §3.2). Giải phóng khoá ≠ LAMP rời vault — số LAMP vẫn nguyên trong vault.
`M = ⌊μ_pot · L · R · LF · OAC · PM · B / Q⁵⌋` per-DID, mỗi epoch, tính cả LAMP **locked** trong vault
(ký hiệu `μ_pot` ở đây là cách viết gộp cho dễ đọc — cơ chế thật không sửa mã MAGIC, xem §4.1).

| Mức | Pot | LAMP nằm ở vault-DID nào |
|---|---|---|
| 🏛️ **Tổ chức/Platform** | Aladin, GreenSun, Platform, App, Join LampNet→LampNet, Referrer→AffiSo, PhoenixKey→PhoenixKey-DID, Foundation | vault **OrgDID / Platform-DID** (giữ/khoá ở đó → gen, kể cả phần khoá); **riêng Foundation — khoá số dư trong két DID Foundation, vẫn gen** |
| 👤 **User** | Development, Partnership | kênh phân phối (KHÔNG phải vault-DID) → CHỈ gen khi **claim về vault DID người dùng** |
| 👤 **User (Wakeme)** | Wakeme | LAMP đã khoá sẵn trong két theo **PersonDID** ngay từ đầu, không rời két ra ví → tính là nằm trong vault gắn DID cá nhân |
| ❌ **Không** | Reserve, Treasury, ETD, Airdrop, SRCL, RedBack, Liquidity | không ở vault-DID nào (chưa-mint LAMP / parked / LP / hết sớm) |

**Triết lý tầng tổ chức:** Foundation khoá gốc vĩnh viễn sau khi lập pháp nhân — LAMP nằm trong két DID
Foundation, khoá số dư, nên vẫn gen MAGIC (xem §3 pot 9, `pot-catalog.md`); founder khoá dài hạn cần nguồn thu R&D → LAMP ở OrgDID công ty gen MAGIC về công ty;
Platform/App ở Platform-DID, MAGIC chia cho DID **theo lượng tiêu thụ** (khuyến khích build); Join
LampNet/Referrer/PhoenixKey uỷ thác toàn bộ vào Platform-DID (LampNet/AffiSo/PhoenixKey).

### 4.1 Kiểm soát gen pot — thực hiện ở tầng LAMP, không sửa mã MAGIC

μ là **chính sách phân bổ LAMP** của từng OrgDID/ServiceDID (quyết ở tầng LAMP/governance), không phải
một tham số trong công thức sinh MAGIC — nó tác động qua lượng LAMP mà pot đó nạp vào vault sinh-MAGIC.
Giá trị μ khởi đầu của từng pot công bố khi policy chính thức phát hành. μ đổi được qua cập nhật cấu hình
trên chuỗi, không redeploy.

### 4.2 Platform vs App — định nghĩa + đăng ký + quyền lợi

**Câu hỏi phân biệt (một dự án rơi vào đúng MỘT nhánh theo từng vai đăng ký):**
> *Nó là một **DỊCH VỤ** mà app khác **tích hợp** để dùng tiện ích của nó (→ **Platform**), hay là một **ỨNG DỤNG**
> mà **người dùng cuối tương tác trực tiếp** (→ **App**)?*

**Đăng ký PLATFORM (dịch vụ — thoả TẤT CẢ):**
1. Cung cấp **dịch vụ/tiện ích dùng-chung** (qua SDK / API / primitive on-chain) cho **app khác tích hợp**.
2. Có **DID dịch vụ riêng** (ServiceDID — xem dưới); đăng ký để **MAGIC tiêu thụ chảy QUA dịch vụ** (đo on-chain).
3. Không nhất thiết có "user riêng" — giá trị = **được bao nhiêu app tích hợp + MAGIC tiêu qua nó**.

**Đăng ký APP (ứng dụng — thoả TẤT CẢ):**
1. **Sản phẩm hoàn chỉnh phục vụ NGƯỜI DÙNG CUỐI** (giao diện/trải nghiệm trực tiếp).
2. **Tích hợp ≥1 Platform** để cung cấp tính năng (xây TRÊN, không tự làm dịch vụ cho app khác).
3. Giá trị = **tương tác user cuối + MAGIC tiêu thụ TRONG app**.

**Khác nhau quyền lợi phân bổ:**
- **Platform pot (3.141.000 nghìn)** → chia ServiceDID theo **MAGIC tiêu thụ chảy QUA dịch vụ** (tổng hợp mọi app tích hợp nó). Thưởng "hiệu ứng nền".
- **App pot (1.618.000 nghìn)** → chia App-DID theo **MAGIC tiêu thụ TRONG app**. Thưởng "tương tác trực tiếp".

**Platform-DID là một loại DID dịch vụ (ServiceDID) của PhoenixKey.**

**1 Platform có thêm App → hưởng CẢ 2 (đăng ký TÁCH):** ServiceDID cho dịch vụ (Platform pot) + App-DID riêng cho
app (App pot). Chống lạm: app phải THẬT phục vụ user (MAGIC thật tiêu trong app), không relabel dịch vụ. Tách DID = tách kế toán.

**Phân loại dự án Aladin:** chiến lược Aladin là xây nhiều DỊCH VỤ (Platform), tích hợp tất cả vào
một App (Aladin App); bất kỳ app bên-thứ-ba nào cũng tích hợp được.
| Dự án | Phân loại |
|---|---|
| **LampNet** | Platform (hạ tầng dữ liệu) |
| **PhoenixKey** | Platform (định danh DID) |
| **AffiSo** | Platform (affiliate/phân phối) |
| **VeData** | Platform (thu thập/đánh giá dữ liệu) |
| **ProofChat** | Platform (giao tiếp) |
| **AladinWork** | Platform (quản lý công việc) |
| **SuperApp** | Platform (nền white-label) |
| **Aladin App** (ví dụ OriLife) | App (sản phẩm người dùng cuối, tích hợp các Platform trên) |

> **Quy ước venue (cho keeper/MAGIC kế toán):** mỗi Platform đăng ký một **Platform-venue NFT** (DID + loại rail);
> mỗi App đăng ký **App-venue NFT** (DID + Platform nền nó dùng). SnapshotGen/ConsumeMAGIC quy chiếu venue để
> ghi MAGIC tiêu thụ đúng pot. Chi tiết kế toán venue = spec MAGIC-consumption riêng.

---

## 5. Quản trị & sức bỏ phiếu
VP cá nhân (PhoenixKey DID) = tích có trọng số của ≥4 tham số (C1 MAGIC tiêu thụ, C2 LAMP cam kết,
C3 uy tín, C4 LAMP nắm giữ), mỗi tham số có trần riêng. Cách đo uy tín (C3) chưa công bố. Công thức là
phép nhân và mọi tham số phải mang trọng số dương — ràng buộc này được ép trên chuỗi — nên không cấu
hình nào bỏ được uy tín ra khỏi công thức. Vì vậy công thức sức bỏ phiếu chỉ được áp dụng sau khi cách đo
uy tín được công bố. Chi tiết: `Governance/VotingPower/CONTRACT.md`.
Điểm giao với phân phối: **gen-MAGIC ≠ quyền lực**; chỉ tiêu-thụ mới thành VP.

---

## 6. Ba pot phân phối cộng đồng sớm (chi tiết claim)

### 6.1 ETD — Early TIGER Delegated (12.000 nghìn)
- **Mục đích:** ghi nhận delegator sớm pool TIGER. **Redeem TRƯỚC làm test toàn cầu** cho hệ claim.
- **Cơ chế:** snapshot hồi tố stake tích luỹ qua mọi snapshot → entitlement per địa chỉ → CappedDrop/claim_account
  (hoặc Merkle 1-lần). Rút **permissionless** giống claim_account. Dư hoàn Treasury.
- Đây là **bài test sống** cho toàn hệ claim trước khi mở Airdrop/SRCL.

### 6.2 Airdrop (120.000 nghìn) — Delegator + SPO, theo accStake

Chia **2 phần**: **Delegator 100.000 nghìn** theo `accStake` của người nhận · **SPO 20.000 nghìn**
theo tổng `accStake` của các delegator đủ điều kiện đang uỷ thác vào pool đó. Người nhận phải vượt
**sàn 1.000 ADA**. Không có phần Community Supporter, không có phần tương tác. Cơ chế đăng ký pool
(SPO mint registration-NFT), snapshot theo epoch và claim Merkle permissionless — mô tả đầy đủ ở
`pot-catalog.md` §3, pot 14.

### 6.3 SRCL (360.000 nghìn) — redirect, 36 epoch (≈180 ngày), DECOUPLED
- **Tổng:** 360.000 nghìn = 36 epoch × **10.000 nghìn/epoch**.
- **Bản chất:** delegator tự nguyện **định tuyến** một phần phần-thưởng staking phát sinh trong tương lai (tự chọn 0–100%) về pot của đợt. Đóng góp đó được **ghi nhận** bằng LAMP theo công thức tất định. Vốn gốc không rời ví. ADA phần-thưởng đi về `beneficiary` của đợt — **không** về doanh thu của bên sáng lập; bên thụ hưởng của hai đợt cộng đồng khai ở `srcl.md` §5 (đợt dùng ngân sách pot 8 — Phoenix Treasury — có bên thụ hưởng công bố riêng trước khi mở), và ràng buộc **bên thụ hưởng tách khỏi bên đóng góp** khai ở `srcl.md` §7. Công thức chia LAMP không phụ thuộc doanh thu hay lãi lỗ của bất kỳ pháp nhân nào.
- **Phá bottleneck "SPO ký mỗi epoch" (decouple):** SPO **KHÔNG** phải claim mỗi epoch. Tỷ lệ chỉ phụ thuộc
  **tổng ADA mỗi pool đã góp** (đo on-chain). SPO là **người nhận**, không phải **người gác cổng**.

**Thành phần on-chain:**
- `srcl_stake_script` (stake validator, Franken) — param `{owner, redirect_bp, pool_id}`. Là stake-cred của delegator;
  rút reward kích hoạt nó → ép tách `redirect_bp%` reward vào `srcl_pot`, còn lại về ví delegator. **Reward-only, auto, permissionless trigger.**
- `srcl_pot` (spend) — nhận ADA reward redirect, datum `{pool_id, owner, contributed_lovelace, epoch}`. ADA ra khỏi pot qua `Collect` về bên thụ hưởng đã khai của đợt đó (`srcl.md` §4 — tham số cấu hình mỗi đợt, không phải địa chỉ khắc trong mã; đợt 1 = kho cộng đồng, `srcl.md` §5); nhánh này chỉ rút ADA, không sửa sổ contribution.
- `spo_registry` (NFT+spend) — POOL-CONFIG NFT `{pool_id, spo_reward_pkh, bonus_rate_bp, rate_locked_until}`.
  `Register` one-shot (ký 1 lần); `SetRate` có **cooldown** + cap `MAX_RATE` (vd ≤10%). **SPO tự đặt rate.**
- `srcl_beacon` — committee post `MerkleRoot_e` mỗi epoch (tái dùng beacon.ak).
- `srcl_pool/marker/nft` — claim **permissionless** Merkle + slot spend-once (tái dùng). SPO bonus = 1 leaf.

**Công thức mỗi epoch e** (LAMP_e = 10.000 nghìn):
```
Σ_all  = Σ ADA mọi pool góp (epoch e)
LAMP_pool(p)  = LAMP_e × Σ_p / Σ_all                      (pool góp gấp đôi → gấp đôi LAMP)
spo_bonus(p)  = LAMP_pool(p) × bonus_rate_bp(p) / 10000   (rate SPO tự đặt)
LAMP_deleg(p) = LAMP_pool(p) − spo_bonus(p)
entitlement(d)= LAMP_deleg(p) × c_d / Σ_p                 (c_d = ADA delegator d góp)
```
Dư floor → dồn ví lớn nhất (tất định). SPO bonus + mọi delegator = leaf trong cùng cây → claim permissionless.

**Góp ADA qua địa chỉ Franken — chỉ phần thưởng, tự động mỗi epoch.** Cơ sở mã nguồn Cardano (đã xác minh):
- Địa chỉ delegator = **Franken**: `payment-cred = KHÓA delegator` (vốn gốc AN TOÀN, tiêu tự do —
  KHÔNG ai đụng stake gốc) + `stake-cred = srcl_stake_script{owner, redirect_bp, pool_id}`.
- Reward tích vào **reward-account riêng của stake-script** (tách hẳn UTXO vốn gốc). Mỗi epoch **keeper (permissionless)
  trigger rút** → stake validator chạy (ScriptPurpose `Rewarding`) **ép tách**: `redirect_bp%` reward → `srcl_pot`
  (tag owner+pool), phần còn lại → ví delegator. ⟹ **CHỈ reward, KHÔNG vốn gốc; tự động; ép bởi stake validator trong cùng giao dịch.**
- **Delegator ký 1 LẦN** (lập Franken chọn `redirect_bp`) → sau đó tự động hoàn toàn, KHÔNG ký mỗi epoch.
- **Gom pool:** vì góp/epoch được script ghi nhận, SPO gom nhiều pool dưới cùng stake-script → ít khóa/phí/ma sát.
- Ràng buộc ledger: rút reward là **rút TOÀN BỘ một lần** → validator tự tách tỷ lệ trong cùng tx.
- Tham khảo: Cardano Addresses (payment⊕stake độc lập, mỗi cái key/script) · Plutonomicon stake-scripts
  (rút reward kích hoạt stake validator; reward-account tách UTXO) · CIP-112.
- *Rút từ VỐN GỐC (stake) = pool riêng, thiết kế sau khi cầu cao — KHÔNG nằm trong SRCL này.*
- **Phân biệt với phát biểu cũ:** "Cardano không auto-debit" chỉ đúng cho **vốn gốc**; **reward** redirect được
  tự động qua Franken/script-staking — đây mới là đường chuẩn.

**Chống lạm dụng:**
- **Front-run snapshot:** tính theo **ADA-góp-TRONG-epoch** (flow); góp ở epoch e chỉ tính cho phân phối **e+1** (datum ghi epoch, keeper đếm contribution `epoch < e`).
- **Bait-and-switch rate:** cooldown + rate **chỉ áp epoch SAU** khi qua cooldown → delegator có ≥2 epoch để rời.
- **SPO không đăng ký/đặt rate:** delegator pool đó **vẫn nhận LAMP** (rate=0, không ai ăn bonus).
- **Sybil delegator:** vô hại (chia theo ADA, không theo đầu người). **Whale:** tuyến tính, không méo; có thể đặt trần góp mỗi địa chỉ.

**Hệ quả thị trường:** thưởng theo **redirect-intensity** (không theo stake) → SPO nhỏ truyền thông tốt thắng SPO lớn ì →
tái cơ cấu stake → **Cardano phi tập trung hơn**. SPO không mất ADA túi riêng. ADA phần-thưởng đi về bên
thụ hưởng của đợt (đợt 1: kho cộng đồng — `srcl.md` §5), và công thức chia LAMP không phụ thuộc doanh
thu hay lãi lỗ của bất kỳ pháp nhân nào: nó chỉ đọc lượng ADA đã góp, đo trên chuỗi.

### 6.4 Góp qua ứng dụng của hệ — lập Franken qua PhoenixKey

Ví phổ thông (Eternl/Lace) không có giao diện để uỷ quyền stake-cred cho một script tuỳ ý; người dùng
tham gia SRCL qua ứng dụng của hệ (PhoenixKey / widget GetMAGIC), ứng dụng tự dựng giao dịch thay người
dùng. Cơ sở kỹ thuật (đã xác minh): stake-cred có thể là một script (không chỉ một khoá) và vẫn hợp lệ để
delegate — địa chỉ base gồm payment-cred và stake-cred độc lập nhau. Lập Franken là một giao dịch mang
chứng nhận đăng ký stake và chứng nhận uỷ quyền cho `srcl_stake_script`; ứng dụng dựng giao dịch, người
dùng ký bằng khoá của chính mình trong ứng dụng của hệ.
- → Tham khảo: [Delegation — Cardano Docs](https://docs.cardano.org/about-cardano/learn/delegation) · [Stake registration+delegation cert (cardano-c)](https://cardano-c.readthedocs.io/en/latest/api/certs/stake_registration_delegation_cert.html).

**Luồng người dùng:** trong PhoenixKey/GetMAGIC, người dùng chọn "Tham gia SRCL — redirect X% reward" →
ứng dụng dựng địa chỉ Franken cùng hai chứng nhận, đặt `redirect_bp = X` → người dùng ký một lần → phần
thưởng tự động định tuyến mỗi epoch, không phải ký lại. Người dùng không dùng ứng dụng của hệ vẫn tham
gia được bằng cách tự rút phần thưởng rồi gửi ADA vào `srcl_pot`.

---

## 7. Reserve — trần nhịp + cổng cầu

> **Nguồn duy nhất của luật này: [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md).**
> Mục này chỉ tóm tắt vừa đủ để đọc tiếp bản phân bổ, và **không** phát biểu lại luật.

Reserve = **lớp đệm cung CUỐI CÙNG** (U→C, no-burn). Điều tiết cung-cầu chính ở Treasury (C↔T). Reserve chỉ nhả
khi Treasury không còn đủ đệm — Treasury dồi dào mà vẫn nhả Reserve = mất ý nghĩa.

Luật nhả có **hai vế, phải thoả cả hai**:

```
vế A — TRẦN NHỊP   : mỗi epoch nhả tối đa E/1000 = 9.630 nghìn LAMP (= 9,63 triệu LAMP); tối đa 1 lượt/epoch;
                     không cộng dồn — epoch không nhả thì phần đó ở lại quỹ
vế B — CỔNG CẦU    : chỉ nhả khi kho Treasury dưới sàn (ngưỡng nhị phân, đo trạng thái
                     TRƯỚC giao dịch)
```

- **Không ấn định epoch kết thúc.** Cạn sau 1000 epoch là **cận dưới** (mọi epoch đều nhả đúng trần);
  mỗi epoch bị cổng đóng lại đẩy thời điểm cạn ra xa, và không có cận trên.
- Permissionless: ai dựng tx đúng điều kiện cũng được; **đích đến = kho Treasury**. Cách validator
  nhận diện kho khác nhau giữa đường Distribution và đường Reserve, và đường Reserve đang ở giữa một
  lần đổi cách — bảng ở [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md) §3.5 là nguồn
  duy nhất, mục này không nhắc lại.

---

## 8. Điểm tin-cậy + giảm thiểu

| Cơ chế | Điểm tin-cậy | Giảm thiểu |
|---|---|---|
| Snapshot-Merkle (Airdrop/SRCL/ETD) | keeper/committee tính root đúng | dữ liệu vào **on-chain công khai** → ai cũng tái dựng root + tố cáo; committee multisig (3/5); challenge window |
| SRCL SPO rate | đọc-được on-chain | rate là datum công khai, cap MAX_RATE, cooldown chống đổi giật |
| CappedDrop entitlement | committee cấp E | E tăng-chỉ, redeem permissionless ai cũng giám sát |
| Reserve | gate state on-chain tất định | không có velocity-oracle (đã bỏ); chỉ mức Treasury parked |

---

## 9. Trạng thái

Mọi tham số vận hành (μ_pot từng pot, trần/sàn Reserve, tỷ lệ và mốc của Airdrop/SRCL) đọc từ
config-UTxO trên chuỗi. Giá trị khởi đầu công bố khi policy chính thức phát hành, và đổi được qua
cập nhật cấu hình trên chuỗi — không redeploy.

---

*Hết. Tham số khởi đầu công bố khi policy chính thức phát hành; pháp nhân sáng lập vận hành giai
đoạn đầu, chuyển DAO theo lộ trình, đổi qua config-UTxO, KHÔNG redeploy.*
