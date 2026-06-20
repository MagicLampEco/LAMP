# LAMP — Distribution Spec (hoàn chỉnh, v1)

> **Nguồn sự thật cho PHÂN PHỐI LAMP**: 18 pot ra cộng đồng thế nào (release / claim / gen-MAGIC).
> Tầng MINT (lazy-mint, registry, cap) ở `Tokenomics/ALLOCATION-SPEC.md` — KHÔNG lặp ở đây.
> Catalog mô tả pot ở `LAMP-POT-CATALOG.md`. Đơn vị: **NGHÌN LAMP** (tổng 36.000.000 = 36 tỷ).
> Cơ chế bám code đã có (claim_account / beacon / treasury của `Distribution/`).
>
> **Thuật ngữ (chuẩn quốc tế):** **release** = nhả token ra lưu hành · **vesting** = release nhỏ-giọt theo lịch
> (`CappedDrop` = capped linear vesting) · **emission** = phát hành token MỚI (Reserve). VI dùng "nhả" cho cả ba.

---

## 1. Nguyên tắc

1. **36 tỷ cố định, không đốt.** Giảm lưu hành = parked vào Treasury (kế toán), không huỷ token.
2. **Mô hình U/C/T** (viết tắt tiếng Anh): `U + C + T = 36 tỷ`.
   - **U = Unminted** (chưa phát hành — token chưa tồn tại on-chain; **Reserve** nằm đây vì lazy-mint chưa đúc).
   - **C = Circulating** (đang lưu hành).
   - **T = Treasury** (parked — đỗ kho bạc, "giảm lưu hành" = chuyển vào đây, không đốt).
   - `U→C` một chiều (mint/emission). Điều tiết 2 chiều CHỈ ở `C↔T`. Reserve không quay lại U (no-burn).
3. **Lazy-mint:** token chưa phát hành = chưa tồn tại on-chain. Pot không "giữ sẵn" token trừ khi cơ chế đòi.
4. **Nhỏ-giọt công bằng:** founder nhả cùng engine + cùng nhịp cộng đồng, ràng buộc on-chain, không cliff bí mật.
5. **MAGIC = sổ kế toán**, sinh tự động theo LAMP gắn DID; KHÔNG phải token. Quyền lực (VP) = MAGIC **tiêu thụ**, không nắm giữ.

---

## 2. Allocation 18 pot (nghìn LAMP)

Xem bảng đầy đủ ở `LAMP-POT-CATALOG.md §1`. Tóm tắt theo **cơ chế nhả**:

| Cơ chế nhả | Pot | Tổng (nghìn) |
|---|---|---:|
| **CappedDrop** (vesting/epoch) | Development, Platform, App, User, Referrer, PhoenixKey, Aladin, GreenSun, Partnership, Joinnet | **22.708.857** |
| **Snapshot-Merkle** (claim permissionless) | ETD, Airdrop, ISPO | 492.000 |
| **Engine gate-Treasury** | Reserve | 9.630.000 |
| **Kế toán / LP / mở-thanh-khoản** | Treasury, Liquidity, TGE | 1.873.143 |
| **Khoá vĩnh viễn (chưa-mint tới khi lập pháp nhân)** | Foundation | 1.296.000 |

Tổng = 22.708.857 + 492.000 + 9.630.000 + 1.873.143 + 1.296.000 nghìn = **36 tỷ** ✓.
Foundation **không drip** ra lưu hành — minted vào Foundation-DID rồi **khoá vĩnh viễn**, chỉ sinh MAGIC (§4).

---

## 3. Cơ chế nhả — 4 loại

### 3.1 CappedDrop = capped linear vesting (`Distribution/onchain/.../claim_account.ak`)
Engine gốc đã live Preview. Datum on-chain THẬT (5 field, `lampdist/types.ak`):
`ClaimAccountDatum{ owner, entitlement E, redeemed, start_epoch, drops_per_epoch D }`.
```
vested(t) = min( E , D · drops_per_epoch · max(0, t − start_epoch) )
redeemable = vested − redeemed         (rút từ treasury cùng tx, treasury tự-bound)
```
- **Claim** (committee cấp/tăng E) / **Redeem** (permissionless, owner rút phần đã mở khoá).
- Founder (Aladin/GreenSun) dùng **đúng engine + nhịp** cộng đồng (minh bạch, không đường tắt).
- *Mỗi pot = 1 instance claim_account + 1 treasury con. Việc cấp-ngân-sách per-pot (HARD-CAP per-channel) là tầng
  phân bổ off-chain do committee quản — KHÔNG nằm trong datum on-chain hiện tại.*

### 3.2 Snapshot-Merkle (ETD / Airdrop / ISPO) — §6
Keeper/committee dựng cây Merkle `(owner, amount, epoch)` → post root vào beacon → claim permissionless bằng proof.
Chống double-claim = marker-NFT nullifier (name = leaf) ở script no-spend. Dư sau hạn → Sweep về Treasury.

### 3.3 Reserve — gate theo mức Treasury (§7)
KHÔNG theo epoch. Nhả khi Treasury parked tụt dưới trần, tối đa ở sàn (2%/1% lưu hành).

### 3.4 Chưa-mint / LP / TGE
- **Chưa-mint** (Reserve, Foundation trước lập pháp nhân): token không tồn tại → không di chuyển/đánh cắp.
- **Liquidity / TGE:** bơm vào LP/DEX khi niêm yết (chờ pháp nhân + pháp lý).

---

## 4. Quyền gen MAGIC theo pot

**NGUYÊN TẮC CỐT LÕI: MAGIC CHỈ gen trong VAULT của một DID — KHÔNG bao giờ "gen trong pot".**
Một pot gen MAGIC ⟺ LAMP của nó **đã nằm trong một vault-DID**. Luật SnapshotGen:
`M = ⌊ L · R · LF · OAC · PM · B / Q⁵ ⌋` per-DID, mỗi epoch, tính cả LAMP **locked** trong vault (C-SS-5).
> Ký hiệu (chi tiết ở spec MAGIC/SnapshotGen): `L`=LAMP trong vault · `R`=rate cơ sở · `LF`=loyalty factor (tuổi giữ)
> · `OAC`=hệ số hoạt động đa-app · `PM`/`B`=hệ số profile · `Q`=10⁹ (Q-format). Chống loãng KHÔNG sửa công thức này — xem §4.1 (trần tổng-pot).

| Mức | Pot | LAMP nằm ở vault-DID nào |
|---|---|---|
| 🏛️ **Tổ chức/Platform** | Foundation, Aladin, GreenSun, Platform, App, Joinnet→LampNet, Referrer→AffiSo, PhoenixKey→PhoenixKey-DID | vault **OrgDID / Platform-DID** (giữ/khoá ở đó → gen, kể cả phần khoá) |
| 👤 **User** | Development, User, Partnership | kênh phân phối (KHÔNG phải vault-DID) → CHỈ gen khi **claim về vault DID người dùng** |
| ❌ **Không** | Reserve, Treasury, ETD, Airdrop, ISPO, TGE, Liquidity | không ở vault-DID nào (chưa-mint LAMP / parked / LP / hết sớm) |

**Triết lý tầng tổ chức:** Foundation khoá vĩnh viễn → LAMP ở Foundation-DID gen MAGIC = năng lượng nuôi DAO
(ban chuyên môn tiêu thụ / tái uỷ quyền / bán fiat / uỷ thác thu LAMP); founder khoá dài hạn cần nguồn thu R&D →
LAMP ở OrgDID cty gen MAGIC về cty; Platform/App ở Platform-DID, MAGIC chia cho DID **theo lượng tiêu thụ**
(khuyến khích build); Joinnet/Referrer/PhoenixKey uỷ thác toàn bộ vào Platform-DID (LampNet/AffiSo/PhoenixKey).

### 4.1 Chống loãng — TRẦN: tổng MAGIC pot ≤ tổng MAGIC lưu hành (KHÔNG dùng μ_pot)
**Chốt (chủ repo):** KHÔNG có tham số `μ_pot`. Thay bằng **bất biến toàn cục**:
> **Σ MAGIC sinh từ các pot tổ chức (mỗi epoch) ≤ Σ MAGIC SnapshotGen từ LAMP LƯU HÀNH cộng đồng (cùng epoch).**

⟹ MAGIC tổ chức **không bao giờ vượt** MAGIC cộng đồng → tỷ trọng pot ≤ 50%, tự co khi cộng đồng giữ nhiều hơn.
Khoá ở tầng MAGIC, không phải tầng LAMP.

**Cơ chế (DÙNG CHUNG keeper-beacon-circulating với Reserve §7.1):** keeper mỗi epoch tính
`pot_magic_total` + `community_magic_total` → post **beacon** (committee, dữ-liệu-công-khai-tái-dựng). SnapshotGen của
vault-pot **đọc beacon** (reference input) → nếu `pot_total > community_total` thì **scale δ pot theo tỷ lệ**
`community_total / pot_total` (clamp ≤ 1). Cộng đồng KHÔNG bị scale.

⚠️ **Đụng code MAGIC** (giao MAGIC-dev): SnapshotGen hiện T16 không nhận reference input → cần thêm đường đọc
beacon-cap cho vault gắn cờ org-tier + nhánh scale. Trễ 1 epoch (beacon là số epoch trước) — chấp nhận được vì cap là
trần mềm. **KHÔNG phá** bit-identical nếu beacon là input tất định trong tx.

**Lưu ý:** loãng chỉ ở **trục kinh tế**; **trục quyền lực miễn nhiễm** (VP = MAGIC *tiêu thụ* bởi cá nhân DID sinh-trắc;
pot không phải cá nhân → VP≈0). Trần này là để cân **quang học/kinh tế**, không phải để chặn quyền lực (vốn đã sạch).

### 4.2 Platform pot vs App pot — phân bổ
> Định nghĩa Platform/App + tiêu chí đăng ký + phân loại dự án: thuộc **`PlatformKit/`** (framework platform), KHÔNG đặc tả ở đây.
> Spec này chỉ ghi **2 pot phân bổ khác nhau thế nào**:

- **Platform pot (3.141.000 nghìn)** → chia cho **Platform-DID** theo MAGIC tiêu thụ **chảy QUA dịch vụ** (tổng hợp mọi app tích hợp).
- **App pot (1.618.000 nghìn)** → chia cho **App-DID** theo MAGIC tiêu thụ **TRONG app**.
- Một dự án vừa là Platform vừa có App → đăng ký TÁCH (2 DID) → hưởng cả 2 pot; tách DID = tách kế toán, không double-count.

**Platform-DID và App-DID đều LÀ PhoenixKey DID** (loại `Service` trong `entity_type` enum — sở hữu 1+ ví, đổi chủ/tiến hoá được),
KHÁC Person DID sinh-trắc, KHÁC OrgDID pháp-nhân. ⚠️ Gate LAMP hiện ép `entity_type==Org` → cần nhận thêm `Service` (quyết định kiến trúc, giao dev).

> **Quy ước venue (cho keeper/MAGIC kế toán):** mỗi Platform đăng ký một **Platform-venue NFT** (DID + loại rail);
> mỗi App đăng ký **App-venue NFT** (DID + Platform nền nó dùng). SnapshotGen/ConsumeMAGIC quy chiếu venue để
> ghi MAGIC tiêu thụ đúng pot. Chi tiết kế toán venue = spec MAGIC-consumption riêng.

---

## 5. Giao với Governance (KHÔNG đặc tả ở đây)
Governance đặc tả riêng ở `Governance/` — KHÔNG lặp. Một điểm giao DUY NHẤT cần nhớ cho phân phối:
**gen-MAGIC ≠ quyền lực** — VP tính theo MAGIC **tiêu thụ** bởi cá nhân PhoenixKey DID, nên pot/Org sinh MAGIC
nhiều cũng KHÔNG thành phiếu (xem §4.1). Chi tiết VP: `Governance/VotingPower/`.

---

## 6. Ba pot phân phối cộng đồng sớm (chi tiết claim)

### 6.1 ETD — Early TIGER Delegated (12.000 nghìn)
- **Mục đích:** ghi nhận delegator sớm pool TIGER. **Redeem TRƯỚC làm test toàn cầu** (chủ repo test ví mình trước).
- **Cơ chế:** snapshot hồi tố stake tích luỹ qua mọi snapshot → entitlement per địa chỉ → CappedDrop/claim_account
  (hoặc Merkle 1-lần). Rút **permissionless** giống claim_account. Dư hoàn Treasury.
- Đây là **bài test sống** cho toàn hệ claim trước khi mở Airdrop/ISPO.

### 6.2 Airdrop (120.000 nghìn) — 20:100, 5 epoch
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

### 6.3 ISPO (360.000 nghìn) — redirect, 36 epoch, DECOUPLED
- **Tổng:** 360.000 nghìn = 36 epoch × **10.000 nghìn/epoch**.
- **Bản chất:** delegator **tự nguyện góp một phần staking-reward ADA** (tự chọn 0–100%) đổi lấy LAMP. Chủ repo **thu ADA**.
- **Phá bottleneck "SPO ký mỗi epoch" (decouple):** SPO **KHÔNG** phải claim mỗi epoch. Tỷ lệ chỉ phụ thuộc
  **tổng ADA mỗi pool đã góp** (đo on-chain). SPO là **người nhận**, không phải **người gác cổng**.

**Thành phần on-chain:**
- `ispo_stake_script` (stake validator, Franken) — param `{owner, redirect_bp, pool_id}`. Là stake-cred của delegator;
  rút reward kích hoạt nó → ép tách `redirect_bp%` reward vào `ispo_pot`, còn lại về ví delegator. **Reward-only, auto, permissionless trigger.**
- `ispo_pot` (spend) — nhận ADA reward redirect, datum `{pool_id, owner, contributed_lovelace, epoch}`. ADA → Treasury chủ repo qua `Collect` (ép on-chain: chỉ rút ADA, không sửa sổ contribution).
- `spo_registry` (NFT+spend) — POOL-CONFIG NFT `{pool_id, spo_reward_pkh, bonus_rate_bp, rate_locked_until}`.
  `Register` one-shot (ký 1 lần); `SetRate` có **cooldown** + cap `MAX_RATE` (vd ≤10%). **SPO tự đặt rate.**
- `ispo_beacon` — committee post `MerkleRoot_e` mỗi epoch (tái dùng beacon.ak).
- `ispo_pool/marker/nft` — claim **permissionless** Merkle + slot spend-once (tái dùng). SPO bonus = 1 leaf.

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
  KHÔNG ai đụng stake gốc) + `stake-cred = ispo_stake_script{owner, redirect_bp, pool_id}`.
- Reward tích vào **reward-account riêng của stake-script** (tách hẳn UTXO vốn gốc). Mỗi epoch **keeper (permissionless)
  trigger rút** → stake validator chạy (ScriptPurpose `Rewarding`) **ép tách**: `redirect_bp%` reward → `ispo_pot`
  (tag owner+pool), phần còn lại → ví delegator. ⟹ **CHỈ reward, KHÔNG vốn gốc; tự động; ép on-chain.**
- **Delegator ký 1 LẦN** (lập Franken chọn `redirect_bp`) → sau đó tự động hoàn toàn, KHÔNG ký mỗi epoch.
- **Gom pool:** vì góp/epoch bất biến bởi script, SPO gom nhiều pool dưới cùng stake-script → ít khóa/phí/ma sát.
- Ràng buộc ledger: rút reward là **rút TOÀN BỘ một lần** → validator tự tách tỷ lệ trong cùng tx.
- Tham khảo: Cardano Addresses (payment⊕stake độc lập, mỗi cái key/script) · Plutonomicon stake-scripts
  (rút reward kích hoạt stake validator; reward-account tách UTXO) · CIP-112.
- *Rút từ VỐN GỐC (stake) = pool riêng, thiết kế sau khi cầu cao — KHÔNG nằm trong ISPO này.*
- **Phân biệt với phát biểu cũ:** "Cardano không auto-debit" chỉ đúng cho **vốn gốc**; **reward** redirect được
  tự động qua Franken/script-staking — đây mới là đường chuẩn.

**Vá game-theory:**
- **Front-run snapshot:** tính theo **ADA-góp-TRONG-epoch** (flow); góp ở epoch e chỉ tính cho phân phối **e+1** (datum ghi epoch, keeper đếm contribution `epoch < e`).
- **Bait-and-switch rate:** cooldown + rate **chỉ áp epoch SAU** khi qua cooldown → delegator có ≥2 epoch để rời.
- **SPO không đăng ký/đặt rate:** delegator pool đó **vẫn nhận LAMP** (rate=0, không ai ăn bonus) — tính năng, không phải bug.
- **Sybil delegator:** vô hại (chia theo ADA, không theo đầu người). **Whale:** tuyến tính, không méo (tuỳ chọn `MAX_CONTRIB`).

**Hệ quả thị trường:** thưởng theo **redirect-intensity** (không theo stake) → SPO nhỏ truyền thông tốt thắng SPO lớn ì →
tái cơ cấu stake → **Cardano phi tập trung hơn**. SPO không mất ADA túi riêng → ủng hộ nhiệt thành; chủ repo thu ADA tỷ lệ thuận tổng góp.

### 6.4 UX delegator — lập Franken qua PhoenixKey (KHẢ THI)
Vấn đề: ví phổ thông (Eternl/Lace) **không có UX** để uỷ quyền stake-cred cho script tuỳ ý. **Giải: dùng app riêng
của hệ (PhoenixKey / widget GetMAGIC) tự dựng tx** — bỏ qua giới hạn ví bên thứ ba. Cơ sở kỹ thuật (đã xác minh):
- **stake-cred CÓ THỂ là script** (không chỉ key) — hợp lệ để delegate. Địa chỉ base = payment-cred ⊕ stake-cred độc lập.
- Lập Franken = 1 tx mang **stake registration cert + delegation cert** cho `ispo_stake_script`. App tự dựng, user ký bằng khóa payment (PhoenixKey đã giữ khóa cho DID).
- → Tham khảo: [Delegation — Cardano Docs](https://docs.cardano.org/about-cardano/learn/delegation) · [Stake registration+delegation cert (cardano-c)](https://cardano-c.readthedocs.io/en/latest/api/certs/stake_registration_delegation_cert.html).

**Luồng UX 1-chạm:** trong PhoenixKey/GetMAGIC, user chọn "Tham gia ISPO — redirect X% reward" → app dựng Franken
address + 2 cert + đặt `redirect_bp=X` → user ký 1 lần → xong. Reward auto-redirect mỗi epoch (keeper trigger), KHÔNG ký lại.
- `redirect_bp` đặt bằng **param script** (đổi tỷ lệ = re-delegate) HOẶC đọc từ **reference config-UTxO của user** (đổi tỷ lệ không re-delegate) — dev chọn; bản đầu dùng param cho đơn giản.
- **Fallback** cho user không dùng app hệ: lối đẩy-tay (withdraw reward + gửi ADA vào `ispo_pot`), app hướng dẫn.
- **Đánh giá:** KHẢ THI trên PhoenixKey vì là **app của mình** (dựng tx trực tiếp qua SDK, không phụ thuộc UX ví ngoài).
  Việc cần làm: PhoenixKey/GetMAGIC thêm màn "ISPO redirect" + builder Franken. Rủi ro = công sức tích hợp, không phải bất khả thi.

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

### 7.1 Trigger permissionless (cho dev)
Reserve nhả qua tx **permissionless + tất định**: validator ép *khi nào* (parked vs gate) + *bao nhiêu* (δ theo gate);
người dựng KHÔNG chọn được con số; **bất kỳ ai** submit được khi điều kiện đủ. Cần **keeper** canh + dựng tx (không đặc quyền).

**Đo circulating C:** C = `minted_total − parked − locked` KHÔNG phải 1 giá trị
on-chain đơn lẻ. ⟹ keeper tính C off-chain → **post beacon `C`** (committee multisig, dữ-liệu-công-khai-tái-dựng-được,
như FlowRate/UM). Validator Reserve đọc beacon C (reference input) + đọc `parked` từ custody UTxO → ép gate.

**Luồng trigger (ai cũng chạy được):**
1. Đọc on-chain: custody UTxO (`parked` = LAMP ở Treasury), beacon `C` (lưu hành), ReserveState (`drawn`, `total`).
2. Tính `δ = f(parked, C)` theo gate (nếu `parked ≥ 2%·C` → δ=0, tx vô nghĩa). Càng gần `1%·C` → δ càng lớn.
3. Dựng tx: spend reserve-thread UTxO + reserve-gate auth + readFrom(beacon C, custody) → **mint δ LAMP** → output δ vào
   **custody Treasury** + tái-tạo ReserveState (`drawn += δ`). KHÔNG cần chữ ký authority (chỉ collateral ADA).
4. Submit. Validator REJECT nếu: `parked ≥ 2%·C`, δ sai gate, vượt `total−drawn`, không vào đúng Treasury.
> Vì bước 3 ai dựng cũng được + bước 4 không đòi authority → **bất kỳ ai canh thấy Treasury < trần đều trigger được**;
> con số δ do gate ép, không ai gian lận. Keeper chỉ tự-động-hoá việc canh + bấm.

- ⚠️ Engine Reserve gate-Treasury **CHƯA build** (E/1000 cũ đã bỏ; gate-sàn-tuyệt-đối `reserve_gate.ak` cũ có nhưng
  chưa theo 2%/1%-C). Validator + keeper-beacon-C = **giao dev** (spec Reserve riêng). Code cũ: 40/40 unit test chứng minh
  *lõi* mint-vào-Treasury permissionless chạy, nhưng chưa có tx Preview thật + chưa theo gate-C.

### 7.2 Động lực trigger + liveness (LỖ HỔNG chủ repo nêu — giải pháp)
**Lỗ thật:** permissionless ≠ có-động-lực. Nếu trigger không thưởng → không ai tốn phí+collateral để bấm → Reserve
không nhả khi cần, beacon-C không post, snapshot trễ. **Giải 3 lớp (bù nhau):**
1. **Thưởng keeper (động lực kinh tế cho BẤT KỲ AI):** tx trigger được trích một **phần nhỏ** làm thưởng cho người
   dựng (vd `keeper_fee` = x‰ của δ nhả, hoặc phí cố định từ Treasury), ép on-chain trong validator. ⟹ ai thấy
   Treasury < trần đều có lãi để bấm → thị trường tự lo liveness (mẫu "liquidation bot" của DeFi).
2. **Người-hưởng-lợi tự chạy keeper (liveness nền):** Reserve nhả vào Treasury → **DAO/Treasury hưởng lợi trực tiếp**
   nên DAO tự chạy keeper (như `UMKeeper` đã có). Committee post beacon-C cũng vì chính họ cần (Reserve + trần pot).
   Permissionless = ai cũng CÓ THỂ; DAO = ĐẢM BẢO.
3. **Thiết kế KHÔNG-tới-hạn-thời-gian (catch-up):** nếu không ai bấm 1 thời gian → hệ **không vỡ**, chỉ **trễ** (Reserve
   giữ chưa-mint = an toàn/bảo thủ; δ tích theo điều kiện, bù khi có người bấm). Hỏng tối đa = "chậm", không "mất".
> Tổ hợp: thưởng-keeper (1) cho liveness phi-tập-trung + DAO-keeper (2) cho nền + catch-up (3) cho an-toàn-khi-vắng.
> Áp dụng CHO MỌI cơ chế permissionless ở đây (Reserve nhả, beacon-C, snapshot, Airdrop/ISPO claim).

---

## 8. Điểm tin-cậy + giảm thiểu

| Cơ chế | Điểm tin-cậy | Giảm thiểu |
|---|---|---|
| Snapshot-Merkle (Airdrop/ISPO/ETD) | keeper/committee tính root đúng | dữ liệu vào **on-chain công khai** → ai cũng tái dựng root + tố cáo; committee multisig (3/5); challenge window |
| ISPO SPO rate | đọc-được on-chain | rate là datum công khai, cap MAX_RATE, cooldown chống đổi giật |
| CappedDrop entitlement | committee cấp E | E tăng-chỉ, redeem permissionless ai cũng giám sát |
| Reserve | gate state on-chain tất định | không có velocity-oracle (đã bỏ vì lỗ H2); chỉ mức Treasury parked |

---

## 9. Trạng thái

### 9.1 Bảng THAM SỐ CHỐT (giá trị khởi đầu — ĐIỀU CHỈNH ĐƯỢC, không phải hằng cứng)
Mọi tham số dưới đọc từ **config-UTxO** do **Aladin Contract đặt → sau giao DAO** (đổi qua tx cập-nhật, không redeploy).

| Tham số | Giá trị khởi đầu | Phạm vi / ghi chú |
|---|---|---|
| Trần gen-MAGIC pot | **Σ MAGIC pot ≤ Σ MAGIC lưu hành** | scale qua keeper-beacon (§4.1); không μ_pot |
| Reserve `trần` | **2% × C** (lưu hành) | trên trần → KHÔNG nhả |
| Reserve `sàn` | **1% × C** | tại sàn → nhả tối đa |
| Reserve hàm `f(T)` | **tuyến tính** giữa trần↔sàn | `rate = (trần−T)/(trần−sàn)` clamp [0,1] |
| Airdrop chia | **20:100** (SPO:Delegator) | per epoch |
| Airdrop epoch ×budget | **5 × 24.000 nghìn** | tổng 120.000 |
| Airdrop hạn đăng ký | **epoch 4** | mở từ 1/7 |
| Airdrop sàn đủ-điều-kiện SPO | **pledge thật + ≥1 block/epoch** | chống Sybil tách pool |
| ISPO epoch ×budget | **36 × 10.000 nghìn** | tổng 360.000 |
| ISPO `MAX_RATE` (bonus SPO) | **10% (1000 bp)** | SPO tự đặt ≤ mức này |
| ISPO rate `cooldown` | **2 epoch** | rate mới chỉ áp sau cooldown |
| ISPO `redirect_bp` (delegator) | **0–100%** | delegator tự chọn |
| ISPO committee | **3/5 multisig** | post Merkle root |

### 9.2 Trạng thái + giao dev
- **Có code (cần cập nhật v17 + cơ chế mới):** claim_account/treasury/beacon (live Preview); Airdrop/ISPO (số cũ → sửa v17 + cơ chế mới); Reserve (E/1000 → viết lại gate-Treasury).
- **Đã chốt thiết kế:** allocation 18-pot; gen MAGIC trong vault-DID + trần tổng-pot ≤ lưu hành (keeper-beacon); Airdrop 20:100; ISPO Franken reward-only (xác minh mã nguồn); Reserve gate-Treasury + thưởng-keeper liveness; UX delegator qua PhoenixKey (§6.4).
- **Giao dev:** validator Reserve gate-Treasury + keeper-beacon-C (chung trần-pot) + thưởng-keeper; Airdrop/ISPO (Franken `ispo_stake_script`/`ispo_pot`/`spo_registry`); SnapshotGen đọc beacon-cap; config-UTxO tham số; màn "ISPO redirect" PhoenixKey/GetMAGIC.

---

*Hết. Tham số §9.1 là khởi đầu, Aladin Contract (→DAO) điều chỉnh qua config-UTxO, KHÔNG redeploy.*
