# LAMP — Phân phối 36 tỷ ra cộng đồng

> **Paper class**: A — Positioning — giải thích cách 36 tỷ LAMP ra cộng đồng.
> Đây là tài liệu **đối ngoại** (bản phái sinh), không phải đặc tả nội bộ. Chuẩn: `../CONVENTIONS.md`.

> Giải thích 18 pot ra cộng đồng thế nào (nhả / claim / gen-MAGIC).
> Tầng MINT (lazy-mint, registry, cap-param, A-DEST) ở `Genesis/CONTRACT.md` — KHÔNG lặp ở đây.
> Catalog mô tả pot ở `pot-catalog.md`. Đơn vị: **NGHÌN LAMP** (tổng 36.000.000 = 36 tỷ).
> Đông kết 2026-06-20. Mọi cơ chế bám code đã có (claim_account / beacon / treasury / srcl / airdrop module).

---

## 1. Nguyên tắc

1. **36 tỷ cố định, không đốt.** Giảm lưu hành = parked vào Treasury (kế toán), không huỷ token.
2. **Mô hình U/C/T:** `U + C + T = 36 tỷ`. U = chưa-mint (gồm Reserve), C = lưu hành, T = Treasury parked.
   `U→C` một chiều (mint). Điều tiết 2 chiều CHỈ ở `C↔T`. Reserve không quay lại U (no-burn).
3. **Lazy-mint:** token chưa phát hành = chưa tồn tại on-chain. Pot không "giữ sẵn" token trừ khi cơ chế đòi.
4. **Nhỏ-giọt công bằng:** founder nhả cùng engine + cùng nhịp cộng đồng, ràng buộc on-chain, không cliff bí mật.
5. **MAGIC = sổ kế toán**, sinh tự động theo LAMP gắn DID; KHÔNG phải token. Quyền lực (VP) = MAGIC **tiêu thụ**, không nắm giữ.

---

## 2. Allocation 18 pot (nghìn LAMP)

Xem bảng đầy đủ ở `pot-catalog.md §1`. Tóm tắt theo **cơ chế nhả**:

| Cơ chế nhả | Pot | Tổng (nghìn) |
|---|---|---:|
| **CappedDrop** (vesting/epoch) | Development, Platform, App, User, Referrer, PhoenixKey, Aladin, GreenSun, Partnership, Join LampNet | **22.708.857** |
| **Snapshot-Merkle** (claim permissionless) | ETD, Airdrop, SRCL | 492.000 |
| **Engine gate-Treasury** | Reserve | 9.630.000 |
| **Kế toán / LP / mở-thanh-khoản** | Treasury, Liquidity, RedBack | 1.873.143 |
| **Khoá vĩnh viễn (chưa-mint tới khi lập pháp nhân)** | Foundation | 1.296.000 |

Tổng = 22.708.857 + 492.000 + 9.630.000 + 1.873.143 + 1.296.000 = **36.000.000 nghìn** ✓.
Foundation **không drip** ra lưu hành — minted vào Foundation-DID rồi **khoá vĩnh viễn**, chỉ sinh MAGIC (§4).

---

## 3. Cơ chế nhả — 4 loại

### 3.1 CappedDrop (claim_account vesting)
Engine gốc đã live Preview. Datum `ClaimAccountDatum{owner, entitlement E, redeemed, start_epoch, drops_per_epoch D, channel_id}`.
```
vested(t) = min( E , D · drops_per_epoch · max(0, t − start_epoch) )
redeemable = vested − redeemed         (rút từ treasury con cùng tx, treasury tự-bound)
```
- **Claim** (committee cấp E) / **Redeem** (permissionless, owner rút phần đã mở khoá).
- Mỗi pot CappedDrop = 1 channel (ChannelBudget HARD-CAP 2 lớp: beacon remaining_oildrop + treasury con = budget).
- Founder (Aladin/GreenSun) dùng **đúng engine + nhịp** cộng đồng (minh bạch, không đường tắt).

### 3.2 Snapshot-Merkle (ETD / Airdrop / SRCL) — §6
Keeper/committee dựng cây Merkle `(owner, amount, epoch)` → post root vào beacon → claim permissionless bằng proof.
Chống double-claim = marker-NFT nullifier (name = leaf) ở script no-spend. Dư sau hạn → Sweep về Treasury.

### 3.3 Reserve — gate theo mức Treasury (§7)
KHÔNG theo epoch. Nhả khi Treasury parked tụt dưới trần, tối đa ở sàn (2%/1% lưu hành).

### 3.4 Chưa-mint / LP / RedBack
- **Chưa-mint** (Reserve, Foundation trước lập pháp nhân): token không tồn tại → không di chuyển/đánh cắp.
- **Liquidity / RedBack:** dự phòng cho nhu cầu thanh khoản trong hệ sinh thái. Cơ chế, thời điểm và điều kiện pháp lý để kích hoạt **chưa được quyết định**; dự án **không cam kết** về việc có kích hoạt hay không.

---

## 4. Quyền gen MAGIC theo pot

**NGUYÊN TẮC CỐT LÕI: MAGIC CHỈ gen trong VAULT của một DID — KHÔNG bao giờ "gen trong pot".**
Một pot gen MAGIC ⟺ LAMP của nó **đã nằm trong một vault-DID**. Luật SnapshotGen:
`M = ⌊μ_pot · L · R · LF · OAC · PM · B / Q⁵⌋` per-DID, mỗi epoch, tính cả LAMP **locked** trong vault (C-SS-5).

| Mức | Pot | LAMP nằm ở vault-DID nào |
|---|---|---|
| 🏛️ **Tổ chức/Platform** | Foundation, Aladin, GreenSun, Platform, App, Join LampNet→LampNet, Referrer→AffiSo, PhoenixKey→PhoenixKey-DID | vault **OrgDID / Platform-DID** (giữ/khoá ở đó → gen, kể cả phần khoá) |
| 👤 **User** | Development, User, Partnership | kênh phân phối (KHÔNG phải vault-DID) → CHỈ gen khi **claim về vault DID người dùng** |
| ❌ **Không** | Reserve, Treasury, ETD, Airdrop, SRCL, RedBack, Liquidity | không ở vault-DID nào (chưa-mint LAMP / parked / LP / hết sớm) |

**Triết lý tầng tổ chức:** Foundation khoá vĩnh viễn → LAMP ở Foundation-DID gen MAGIC = năng lượng nuôi DAO
(ban chuyên môn tiêu thụ / tái uỷ quyền / uỷ thác thu LAMP — định đoạt ra ngoài hệ do quy chế Foundation quyết
định sau khi lập pháp nhân); founder khoá dài hạn cần nguồn thu R&D →
LAMP ở OrgDID cty gen MAGIC về cty; Platform/App ở Platform-DID, MAGIC chia cho DID **theo lượng tiêu thụ**
(khuyến khích build); Join LampNet/Referrer/PhoenixKey uỷ thác toàn bộ vào Platform-DID (LampNet/AffiSo/PhoenixKey).

### 4.1 Kiểm soát gen pot — thực hiện ở TẦNG LAMP, KHÔNG sửa code MAGIC
**Chốt (sau đánh giá MAGIC spec):** KHÔNG thêm tham số `μ` vào công thức SnapshotGen (sẽ phá P8 bit-identical +
đụng datum/constructor 2 phía + cần oracle gán tier). Vì `MAGIC ∝ L` (tuyến tính theo LAMP trong vault),
hệ số `μ` đạt được **tương đương** bằng cách: **mỗi pot chỉ nạp `μ × balance` LAMP vào vault sinh-MAGIC**, phần
`(1−μ)` giữ ở **vault treasury KHÔNG-snapshot**. ⟹ μ là **chính sách phân bổ LAMP của từng OrgDID/ServiceDID**
(quyết ở tầng LAMP/governance), KHÔNG đụng một dòng code MAGIC.
- `μ ≈ 0.25` cho 2 pot **Founder** (Aladin/GreenSun) → chỉ ¼ balance vào vault sinh-MAGIC; org 80%→50% ngày đầu.
- `μ = 1.0` cho Foundation/Platform/App/Join LampNet/Referrer/PhoenixKey (đã tiêu-lại / chia-theo-tiêu-thụ về cộng đồng).
- μ điều chỉnh được (Aladin Contract → DAO) qua việc dời LAMP giữa 2 vault, không redeploy.

**Lưu ý quan trọng (có thể KHÔNG cần cap):** loãng chỉ ở **trục kinh tế**, KHÔNG trục quyền lực — VP = MAGIC
**tiêu thụ** bởi cá nhân DID sinh-trắc; pot/Org không phải cá nhân nên **VP ≈ 0**. MAGIC pot danh-nghĩa nhiều
KHÔNG tự thành quyền lực. Nên **kiểm tra ở tầng ConsumeMAGIC** xem MAGIC-pot có hại thật không trước khi áp μ —
có thể bài toán đã được giải sẵn bởi governance phi-token-weighted. (Phương án anh nêu "cap tổng pot ≤ tổng cộng đồng"
đo được nhưng **cưỡng chế thì đụng code MAGIC NHIỀU hơn** — phá T16 no-reference-input + keeper/beacon/quota + trễ 1 epoch → không khuyến nghị.)

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

**Platform-DID = ServiceDID (ĐÃ XÁC NHẬN có sẵn trong PhoenixKey).** `entity_type` enum
(`PhoenixKey-Validator/lib/phoenixkey/types.ak:22-33`) có **`Service`** (index 7) riêng — KHÁC Person DID sinh-trắc,
KHÁC OrgDID pháp-nhân. ServiceDID: **sở hữu bởi 1+ ví, đổi chủ được** (redeemer `Transfer` 2-of-2 + guardian),
**tiến hoá được** (đẻ con Service). Đúng yêu cầu Platform-DID.
- ⚠️ **Cần đổi gate LAMP:** hiện LAMP ép `entity_type==Org`; nếu Platform-DID = Service thì gate phải nhận Service.
  Đây là quyết định kiến trúc (Platform-pot trả về ServiceDID, khác OrgDID founder).

**1 Platform có thêm App → hưởng CẢ 2 (đăng ký TÁCH):** ServiceDID cho dịch vụ (Platform pot) + App-DID riêng cho
app (App pot). Chống lạm: app phải THẬT phục vụ user (MAGIC thật tiêu trong app), không relabel dịch vụ. Tách DID = tách kế toán.

**Phân loại dự án Aladin** (chủ repo xác nhận 20/6): **chiến lược Aladin = xây nhiều DỊCH VỤ (Platform), tích
hợp tất cả vào một App (Aladin App); bất kỳ app bên-thứ-ba nào cũng tích hợp được.**
| Dự án | Phân loại | Lý do |
|---|---|---|
| **LampNet** | **Platform** | mạng/hạ-tầng dữ liệu, app khác neo/đọc qua nó |
| **PhoenixKey** | **Platform** | định danh DID, mọi app tích hợp |
| **AffiSo** | **Platform** | affiliate/phân-phối, app tích hợp |
| **VeData** | **Platform** | dịch vụ thu thập/phân loại/đánh giá/truy xuất dữ liệu lên LampNet + neo Cardano; mọi người/app tương tác |
| **ProofChat** | **Platform** | dịch vụ giao tiếp bí mật giữa mọi thực thể; mọi app tích hợp |
| **AladinWork** | **Platform** | JobContract + hoà giải + lập lịch + quản lý đội nhóm; app tích hợp dùng các tiện ích này |
| **SuperApp** | **Platform** | nhà-máy white-label sản xuất super-app |
| **Aladin App** (vd OriLife) | **App** | sản phẩm user cuối, **tích hợp tất cả Platform trên** |

> **Quy ước venue (cho keeper/MAGIC kế toán):** mỗi Platform đăng ký một **Platform-venue NFT** (DID + loại rail);
> mỗi App đăng ký **App-venue NFT** (DID + Platform nền nó dùng). SnapshotGen/ConsumeMAGIC quy chiếu venue để
> ghi MAGIC tiêu thụ đúng pot. Chi tiết kế toán venue = spec MAGIC-consumption riêng.

---

## 5. (giữ chỗ — Governance/VP) 
VP cá nhân (PhoenixKey DID) = tích ≥4 tham số (C1 MAGIC tiêu thụ, C2 LAMP cam kết, C3 uy tín, C4 LAMP nắm giữ có cap).
Chi tiết ở spec Governance riêng. Điểm giao với phân phối: **gen-MAGIC ≠ quyền lực**; chỉ tiêu-thụ mới thành VP.

---

## 6. Ba pot phân phối cộng đồng sớm (chi tiết claim)

### 6.1 ETD — Early TIGER Delegated (12.000 nghìn)
- **Mục đích:** ghi nhận delegator sớm pool TIGER. **Redeem TRƯỚC làm test toàn cầu** (chủ repo test ví mình trước).
- **Cơ chế:** snapshot hồi tố stake tích luỹ qua mọi snapshot → entitlement per địa chỉ → CappedDrop/claim_account
  (hoặc Merkle 1-lần). Rút **permissionless** giống claim_account. Dư hoàn Treasury.
- Đây là **bài test sống** cho toàn hệ claim trước khi mở Airdrop/SRCL.

### 6.2 Airdrop (120.000 nghìn) — 3 pot, stake-weighted

> ⚠️ **Mục này đã bị thay.** Chủ dự án chốt model v2 ngày 2026-07-10:
> **Delegator 100M + SPO 5M + CS 15M**, cả ba pot đều chia **∝ trọng số stake**.
> Đặc tả hiệu lực: [`Airdrop/CONTRACT.md`](../Airdrop/CONTRACT.md) +
> [`Airdrop/spo-cs.md`](../Airdrop/spo-cs.md).
> Phần dưới là mô hình v1 (tỉ lệ 20:100, SPO 20M, chưa có pot CS) — **giữ để truy vết, đừng lấy số**.
- **Tổng:** 120.000 nghìn = 5 epoch × **24.000 nghìn/epoch**.
- **Chia 20:100** mỗi epoch: `B_spo = 24.000 × 20/120 = 4.000` (SPO) + `B_del = 24.000 × 100/120 = 20.000` (Delegator).
- **Cổng đăng ký pool (on-chain):** SPO mint registration-NFT `{pool_id, reward_stake_address, epoch_registered}`.
  Mở **từ 1/7**, hạn chót **epoch 4** (validator từ chối đăng ký sau hạn). Chủ repo đăng ký pool TIGER đầu tiên.
- **Snapshot + chia:** mỗi epoch keeper đọc stake snapshot pool đã đăng ký. Gọi `S_p` = stake pool p, `S_tot=ΣS_p`:
  - SPO của p: `B_spo · S_p/S_tot` (**tỷ lệ stake** — chống Sybil tách pool); cộng yêu cầu **sàn stake + sản xuất block** trong epoch để đủ điều kiện.
  - Delegator d ở p: `B_del · s_d/S_tot` (pro-rata stake toàn cục).
  - `won_cumulative` cộng dồn qua epoch → claim trễ vẫn đủ.
- **Claim:** sau snapshot đầu, delegator+SPO claim **permissionless** bằng Merkle proof, validator đối chiếu root beacon.
- **Edge:** đăng ký muộn → nhận từ epoch đăng ký; stake đổi → tính lại mỗi epoch; delegator đổi pool (đã đăng ký) → vẫn nhận theo snapshot epoch đó.

### 6.3 SRCL (360.000 nghìn) — redirect, 36 epoch, DECOUPLED
- **Tổng:** 360.000 nghìn = 36 epoch × **10.000 nghìn/epoch**.
- **Bản chất:** delegator tự nguyện **định tuyến** một phần phần-thưởng staking phát sinh trong tương lai (tự chọn 0–100%) về pot của đợt. Đóng góp đó được **ghi nhận** bằng LAMP theo công thức tất định. Vốn gốc không rời ví. ADA phần-thưởng về bên vận hành là **doanh thu vận hành stake pool**, hạch toán **tách bạch** với việc phân bổ LAMP — công thức chia LAMP không phụ thuộc doanh thu hay lãi lỗ của bên vận hành.
- **Phá bottleneck "SPO ký mỗi epoch" (decouple):** SPO **KHÔNG** phải claim mỗi epoch. Tỷ lệ chỉ phụ thuộc
  **tổng ADA mỗi pool đã góp** (đo on-chain). SPO là **người nhận**, không phải **người gác cổng**.

**Thành phần on-chain:**
- `srcl_stake_script` (stake validator, Franken) — param `{owner, redirect_bp, pool_id}`. Là stake-cred của delegator;
  rút reward kích hoạt nó → ép tách `redirect_bp%` reward vào `srcl_pot`, còn lại về ví delegator. **Reward-only, auto, permissionless trigger.**
- `srcl_pot` (spend) — nhận ADA reward redirect, datum `{pool_id, owner, contributed_lovelace, epoch}`. ADA → Treasury chủ repo qua `Collect` (ép on-chain: chỉ rút ADA, không sửa sổ contribution).
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

**Góp ADA = FRANKEN ADDRESS (reward-only, tự động, bất biến on-chain).** Cơ sở mã nguồn Cardano (đã xác minh):
- Địa chỉ delegator = **Franken**: `payment-cred = KHÓA delegator` (vốn gốc AN TOÀN, tiêu tự do, **sạch pháp lý** —
  KHÔNG ai đụng stake gốc) + `stake-cred = srcl_stake_script{owner, redirect_bp, pool_id}`.
- Reward tích vào **reward-account riêng của stake-script** (tách hẳn UTXO vốn gốc). Mỗi epoch **keeper (permissionless)
  trigger rút** → stake validator chạy (ScriptPurpose `Rewarding`) **ép tách**: `redirect_bp%` reward → `srcl_pot`
  (tag owner+pool), phần còn lại → ví delegator. ⟹ **CHỈ reward, KHÔNG vốn gốc; tự động; ép on-chain.**
- **Delegator ký 1 LẦN** (lập Franken chọn `redirect_bp`) → sau đó tự động hoàn toàn, KHÔNG ký mỗi epoch.
- **Gom pool:** vì góp/epoch bất biến bởi script, SPO gom nhiều pool dưới cùng stake-script → ít khóa/phí/ma sát.
- Ràng buộc ledger: rút reward là **rút TOÀN BỘ một lần** → validator tự tách tỷ lệ trong cùng tx.
- Tham khảo: Cardano Addresses (payment⊕stake độc lập, mỗi cái key/script) · Plutonomicon stake-scripts
  (rút reward kích hoạt stake validator; reward-account tách UTXO) · CIP-112.
- *Rút từ VỐN GỐC (stake) = pool riêng, thiết kế sau khi cầu cao — KHÔNG nằm trong SRCL này.*
- **Phân biệt với phát biểu cũ:** "Cardano không auto-debit" chỉ đúng cho **vốn gốc**; **reward** redirect được
  tự động qua Franken/script-staking — đây mới là đường chuẩn.

**Vá game-theory:**
- **Front-run snapshot:** tính theo **ADA-góp-TRONG-epoch** (flow); góp ở epoch e chỉ tính cho phân phối **e+1** (datum ghi epoch, keeper đếm contribution `epoch < e`).
- **Bait-and-switch rate:** cooldown + rate **chỉ áp epoch SAU** khi qua cooldown → delegator có ≥2 epoch để rời.
- **SPO không đăng ký/đặt rate:** delegator pool đó **vẫn nhận LAMP** (rate=0, không ai ăn bonus) — tính năng, không phải bug.
- **Sybil delegator:** vô hại (chia theo ADA, không theo đầu người). **Whale:** tuyến tính, không méo (tuỳ chọn `MAX_CONTRIB`).

**Hệ quả thị trường:** thưởng theo **redirect-intensity** (không theo stake) → SPO nhỏ truyền thông tốt thắng SPO lớn ì →
tái cơ cấu stake → **Cardano phi tập trung hơn**. SPO không mất ADA túi riêng. Phần thưởng staking được định tuyến về pot của đợt là doanh thu vận hành pool của pháp nhân, tách bạch và **không tham gia** vào công thức phân bổ LAMP.

### 6.4 UX delegator — lập Franken qua PhoenixKey (KHẢ THI)
Vấn đề: ví phổ thông (Eternl/Lace) **không có UX** để uỷ quyền stake-cred cho script tuỳ ý. **Giải: dùng app riêng
của hệ (PhoenixKey / widget GetMAGIC) tự dựng tx** — bỏ qua giới hạn ví bên thứ ba. Cơ sở kỹ thuật (đã xác minh):
- **stake-cred CÓ THỂ là script** (không chỉ key) — hợp lệ để delegate. Địa chỉ base = payment-cred ⊕ stake-cred độc lập.
- Lập Franken = 1 tx mang **stake registration cert + delegation cert** cho `srcl_stake_script`. App tự dựng, user ký bằng khóa payment (PhoenixKey đã giữ khóa cho DID).
- → Tham khảo: [Delegation — Cardano Docs](https://docs.cardano.org/about-cardano/learn/delegation) · [Stake registration+delegation cert (cardano-c)](https://cardano-c.readthedocs.io/en/latest/api/certs/stake_registration_delegation_cert.html).

**Luồng UX 1-chạm:** trong PhoenixKey/GetMAGIC, user chọn "Tham gia SRCL — redirect X% reward" → app dựng Franken
address + 2 cert + đặt `redirect_bp=X` → user ký 1 lần → xong. Reward auto-redirect mỗi epoch (keeper trigger), KHÔNG ký lại.
- `redirect_bp` đặt bằng **param script** (đổi tỷ lệ = re-delegate) HOẶC đọc từ **reference config-UTxO của user** (đổi tỷ lệ không re-delegate) — dev chọn; bản đầu dùng param cho đơn giản.
- **Fallback** cho user không dùng app hệ: lối đẩy-tay (withdraw reward + gửi ADA vào `srcl_pot`), app hướng dẫn.
- **Đánh giá:** KHẢ THI trên PhoenixKey vì là **app của mình** (dựng tx trực tiếp qua SDK, không phụ thuộc UX ví ngoài).
  Việc cần làm: PhoenixKey/GetMAGIC thêm màn "SRCL redirect" + builder Franken. Rủi ro = công sức tích hợp, không phải bất khả thi.

---

## 7. Reserve — gate theo mức Treasury

Reserve = **lớp đệm cung CUỐI CÙNG** (U→C, no-burn). Điều tiết cung-cầu chính ở Treasury (C↔T). Reserve chỉ nhả
khi Treasury không còn đủ đệm — Treasury dồi dào mà vẫn nhả Reserve = mất ý nghĩa.

Hai mức trên **tổng lưu hành C** (KHÔNG phải max cap):
```
T = LAMP parked ở Treasury;  C = lưu hành
T ≥ 2%·C           →  Reserve KHÔNG nhả (Treasury tự lo cầu)
1%·C < T < 2%·C    →  nhả theo hàm nội suy f(T) (càng gần sàn càng mạnh)
T ≤ 1%·C           →  nhả TỐI ĐA
```
- KHÔNG giới hạn số epoch; tốc độ cạn = do cầu (mức Treasury) quyết.
- Permissionless: ai dựng tx đúng điều kiện cũng được; dest = Treasury.
- ⚠️ `Reserve/onchain/reserve_draw.ak` hiện (E/1000/epoch) là thiết kế CŨ — **viết lại** theo gate-mức-Treasury. Tham số (2%/1%, dạng `f`) chốt ở spec Reserve riêng.

---

## 8. Điểm tin-cậy + giảm thiểu

| Cơ chế | Điểm tin-cậy | Giảm thiểu |
|---|---|---|
| Snapshot-Merkle (Airdrop/SRCL/ETD) | keeper/committee tính root đúng | dữ liệu vào **on-chain công khai** → ai cũng tái dựng root + tố cáo; committee multisig (3/5); challenge window |
| SRCL SPO rate | đọc-được on-chain | rate là datum công khai, cap MAX_RATE, cooldown chống đổi giật |
| CappedDrop entitlement | committee cấp E | E tăng-chỉ, redeem permissionless ai cũng giám sát |
| Reserve | gate state on-chain tất định | không có velocity-oracle (đã bỏ vì lỗ H2); chỉ mức Treasury parked |

---

## 9. Trạng thái

### 9.1 Bảng THAM SỐ CHỐT (giá trị khởi đầu — ĐIỀU CHỈNH ĐƯỢC, không phải hằng cứng)
Mọi tham số dưới đọc từ **config-UTxO** do **Aladin Contract đặt → sau giao DAO** (đổi qua tx cập-nhật, không redeploy).

| Tham số | Giá trị khởi đầu | Phạm vi / ghi chú |
|---|---|---|
| `μ_pot` Founder (Aladin, GreenSun) | **0.25** | (0,1]; cân quang học MAGIC ngày đầu |
| `μ_pot` Foundation/Platform/App/Join LampNet/Referrer/PhoenixKey | **1.0** | nhóm tiêu-lại/chia-theo-tiêu-thụ → không cap |
| `μ_pot` User/Development/Partnership | **1.0** | gen ở vault user khi claim |
| Reserve `trần` | **2% × C** (lưu hành) | trên trần → KHÔNG nhả |
| Reserve `sàn` | **1% × C** | tại sàn → nhả tối đa |
| Reserve hàm `f(T)` | **tuyến tính** giữa trần↔sàn | `rate = (trần−T)/(trần−sàn)` clamp [0,1] |
| Airdrop chia | **Delegator 100M · SPO 5M · CS 15M**, cả ba ∝ trọng số stake (v2, chốt 10/7) | per snapshot |
| Airdrop epoch ×budget | **5 × 24.000 nghìn** | tổng 120.000 |
| Airdrop hạn đăng ký | **epoch 4** | mở từ 1/7 |
| Airdrop sàn đủ-điều-kiện SPO | **pledge thật + ≥1 block/epoch** | chống Sybil tách pool |
| SRCL epoch ×budget | **36 × 10.000 nghìn** | tổng 360.000 |
| SRCL `MAX_RATE` (bonus SPO) | **10% (1000 bp)** | SPO tự đặt ≤ mức này |
| SRCL rate `cooldown` | **2 epoch** | rate mới chỉ áp sau cooldown |
| SRCL `redirect_bp` (delegator) | **0–100%** | delegator tự chọn |
| SRCL committee | **3/5 multisig** | post Merkle root |

### 9.2 Trạng thái + giao dev
- **Có code (cần cập nhật v17 + cơ chế mới):** claim_account/treasury/beacon (live Preview); Airdrop/SRCL (số cũ → sửa v17 + cơ chế mới); Reserve (E/1000 → viết lại gate-Treasury).
- **Đã chốt thiết kế:** allocation 18-pot; gen MAGIC trong vault-DID + `μ_pot` Aladin chỉnh; Airdrop 20:100; SRCL Franken reward-only (xác minh mã nguồn); Reserve gate-Treasury; UX delegator qua PhoenixKey (§6.4).
- **Giao dev:** validator `srcl_stake_script`(Franken)/`srcl_pot`/`spo_registry`; cập nhật Airdrop/SRCL/Reserve; config-UTxO tham số; màn "SRCL redirect" trong PhoenixKey/GetMAGIC; spec Reserve riêng.

---

*Hết. Tham số §9.1 là khởi đầu, Aladin Contract (→DAO) điều chỉnh qua config-UTxO, KHÔNG redeploy.*
