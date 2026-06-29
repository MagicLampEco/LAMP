# LAMP — Catalog 18 Pot (mô tả + khoá/nhỏ-giọt + gen-MAGIC)

> **DRAFT — chủ repo sẽ còn thay đổi.** Mục đích: để mọi người hiểu **mỗi pot là gì,
> dùng làm gì, bị khoá hay nhỏ-giọt thế nào, và có sinh MAGIC hay không.**
> Số liệu bám `TOKENOMICS-v17`. **Đơn vị: NGHÌN LAMP** (tổng 36.000.000 nghìn = 36 tỷ).
> Dùng nghìn LAMP để PhoenixKey (142.857) và RedBack (21.143) thành SỐ NGUYÊN, hết lẻ.

---

## 0. Ba thuộc tính mỗi pot

1. **Mục đích** — pot này để làm gì.
2. **Cách ra:** **Nhỏ-giọt (CappedDrop)** `vested(t)=min(E, D·dpe·max(0,t−start))` · **Chưa-mint**
   (token chưa tồn tại, khoá tự nhiên) · **Snapshot** (chia theo ảnh chụp, claim Merkle permissionless)
   · **Engine riêng** (Reserve gate-Treasury / LP / RedBack).
3. **Gen MAGIC?** — **NGUYÊN TẮC CỐT LÕI: MAGIC CHỈ gen trong VAULT của một DID, KHÔNG bao giờ gen "trong pot".**
   Một pot chỉ gen MAGIC khi **LAMP của nó đã nằm trong một vault-DID** (cá nhân / OrgDID / Platform-DID).
   3 mức = LAMP nằm ở **vault-DID nào**:
   - **TỔ CHỨC/PLATFORM** 🏛️ — LAMP được giữ/khoá **trong vault của OrgDID / Platform-DID** (Foundation-DID,
     OrgDID Aladin/GreenSun, Platform-DID LampNet/AffiSo/PhoenixKey) → vault đó gen MAGIC (tính cả phần khoá, C-SS-5).
   - **USER khi claim** 👤 — LAMP nằm ở **kênh phân phối (KHÔNG phải vault-DID)** → chỉ gen khi **claim về vault
     DID người dùng** (kể cả chưa redeem).
   - **KHÔNG** ❌ — chưa-gen on-chain / parked Treasury / trong LP-DEX / hết sớm → KHÔNG ở vault-DID nào → không gen.

> ⚠️ **Mối lo pha loãng:** LAMP ở vault tầng tổ chức 🏛️ ≈ **20 tỷ**, gấp ~5× tầng user 👤 (~4 tỷ). Kết luận
> phản biện ở §4. **Hệ-số-gen mỗi pot KHÁC nhau** và do **Aladin Contract điều chỉnh** thời gian đầu
> (team dev Aladin vận hành giao thức), **sau giao DAO**.

---

## 1. Bảng 18 pot (đơn vị: nghìn LAMP)

| # | Pot | Nghìn LAMP | % | Mục đích | Cách ra | Gen MAGIC? |
|---|---|---:|---:|---|---|---|
| 1 | **Reserve** | 9.630.000 | 26,75% | Đệm cung cuối, điều tiết khi Treasury cạn | Engine gate **mức Treasury** (trần 2% / sàn 1% lưu hành) | ❌ chưa-mint |
| 2 | **Treasury** | 964.000 | 2,68% | Sổ điều tiết C↔T (giảm lưu hành = parked, không đốt) | Kế toán 2 chiều | ❌ parked |
| 3 | **Development** | 2.718.000 | 7,55% | Quỹ vận hành 2 cty (R&D, M&A, BD, pháp lý, marketing) | Nhỏ-giọt | 👤 khi claim về DID |
| 4 | **Platform** | 3.141.000 | 8,73% | Thưởng nền tảng dùng LAMP | Nhỏ-giọt | 🏛️ gen, chia DID theo MAGIC tiêu thụ |
| 5 | **App** | 1.618.000 | 4,49% | Khuyến khích ứng dụng xây trên hệ | Nhỏ-giọt | 🏛️ gen, chia DID theo MAGIC tiêu thụ |
| 6 | **User** | 1.001.000 | 2,78% | Thưởng người dùng cuối (1 triệu DID + đệm) | Nhỏ-giọt | 👤 khi claim về DID |
| 7 | **Referrer** | 343.000 | 0,95% | Thưởng giới thiệu | Nhỏ-giọt | 🏛️ uỷ thác Platform **AffiSo** DID |
| 8 | **PhoenixKey** | 142.857 | 0,40% | Gắn hạ tầng định danh | Nhỏ-giọt | 🏛️ uỷ thác Platform **PhoenixKey** DID |
| 9 | **MagicLamp Foundation** | 1.296.000 | 3,60% | Năng lượng vận hành DAO | **Chưa-mint→khoá VĨNH VIỄN** sau khi lập pháp nhân | 🏛️ gen → nuôi DAO (xem §3) |
| 10 | **Aladin Contract** | 6.000.000 | 16,67% | Pháp nhân sáng lập (1/6 cung) | Nhỏ-giọt **ngang cộng đồng** | 🏛️ gen → **OrgDID Aladin** |
| 11 | **GreenSun Tech** | 6.000.000 | 16,67% | Pháp nhân sáng lập (1/6 cung) | Nhỏ-giọt **ngang cộng đồng** | 🏛️ gen → **OrgDID GreenSun** |
| 12 | **Partnership** | 284.000 | 0,79% | Đối tác chiến lược | Nhỏ-giọt | 👤 khi partner claim về DID |
| 13 | **Early TIGER Deleg (ETD)** | 12.000 | 0,03% | Delegate sớm TIGER (redeem TRƯỚC = test) | Snapshot hồi tố | ❌ hết sớm |
| 14 | **Airdrop** | 120.000 | 0,33% | Cộng đồng sớm (SPO+Delegator đăng ký) | Snapshot, 5 epoch ×24.000, 20:100 | ❌ hết sớm |
| 15 | **SRCL** | 360.000 | 1,00% | Redirect staking-reward ADA ↔ LAMP | Snapshot/epoch theo ADA góp; SPO bonus tự đặt | ❌ hết sớm |
| 16 | **Joinnet** | 1.461.000 | 4,06% | Khuyến khích tham gia mạng lưới | Nhỏ-giọt | 🏛️ uỷ thác Platform **LampNet** DID |
| 17 | **RedBack** | 21.143 | 0,06% | Mở thanh khoản ban đầu khi niêm yết | Mở thanh khoản | ❌ trong DEX |
| 18 | **Liquidity** | 888.000 | 2,47% | Khuyến khích thanh khoản LAMP/ADA | Engine LP theo TVL | ❌ trong LP |

**Kiểm chứng:** tổng = 36.000.000 nghìn ✓ · mọi pot trừ Reserve = 26.370.000 (= `dist_cap`) ✓ · Reserve = 9.630.000 (= `reserve_cap`) ✓ · PhoenixKey 142.857 + RedBack 21.143 = 164.000 (bù lẻ tròn).

---

## 2. Ba mức gen-MAGIC (tổng theo nghìn LAMP)

- **🏛️ Tổ chức/Platform — LAMP nằm trong vault OrgDID/Platform-DID, gen kể cả khi khoá (~20.001.857 ≈ 20 tỷ):**
  Foundation, Aladin, GreenSun, Platform, App, Joinnet→LampNet, Referrer→AffiSo, PhoenixKey→PhoenixKey-DID.
- **👤 User — chỉ gen khi claim về DID (~4.003.000 ≈ 4 tỷ):** Development, User, Partnership.
- **❌ Không gen (~11.995.143 ≈ 12 tỷ):** Reserve, Treasury, ETD, Airdrop, SRCL, RedBack, Liquidity.

---

## 3. Thuyết minh từng pot (để cộng đồng phân biệt)

**Nhóm điều tiết & dự trữ**
- **1. Reserve (9.630.000)** — lớp đệm cung **cuối cùng**. CHỈ nhả khi Treasury cạn (gate mức Treasury §1), để
  thêm cung khi cầu thật vượt khả năng điều tiết của Treasury. Một chiều (no-burn). Permissionless, không ai rút tay.
- **2. Treasury (964.000)** — **vốn mồi + sổ điều tiết hai chiều** C↔T. "Giảm lưu hành" = parked vào đây (kế toán),
  KHÔNG đốt. Là nơi bơm lại các pot khác (User, Development…) khi DAO quyết. Quản bởi DAO.

**Nhóm vận hành & sáng lập (PHÂN BIỆT RÕ)**
- **3. Development (2.718.000)** — quỹ **tài trợ ý tưởng mới, R&D, sáp nhập/tích hợp ứng dụng**. **Kiểm soát & vận
  hành bởi DAO.** Có thể **được bổ sung dần từ Treasury** + **phần hoàn lại của các sản phẩm**. ⚠️ Đây là **quỹ
  CHUNG của giao thức (DAO quản), KHÔNG phải tiền của 2 công ty sáng lập** — khác hẳn pot Aladin/GreenSun.
- **10–11. Aladin Contract / GreenSun Tech (6.000.000 mỗi bên)** — **phần phân bổ RIÊNG của 2 công ty sáng lập**
  (mỗi cty 1/6 cung), thù lao cho việc xây hệ từ đầu. **Khoá dài hạn, nhả nhỏ giọt ngang cộng đồng** (cùng engine,
  không đường tắt). MAGIC sinh về **OrgDID từng công ty** làm nguồn thu R&D/vận hành (vì tài sản lớn bị khoá).
  ⚠️ Khác Development: đây là **sở hữu công ty**, Development là **ngân sách DAO**.

**Nhóm nền tảng & ứng dụng (PHÂN BIỆT RÕ)**
- **4. Platform (3.141.000)** — thưởng cho các **NỀN TẢNG nền móng** của hệ (LampNet, AffiSo, PhoenixKey… — hạ tầng
  có **DID riêng**, thứ khác xây LÊN trên). Nhả/chia cho DID **theo lượng MAGIC tiêu thụ** trên nền tảng đó.
- **5. App (1.618.000)** — thưởng cho các **ỨNG DỤNG do cộng đồng xây TRÊN nền tảng** (nhiều, đa dạng). ⚠️ Khác
  Platform: **Platform = lớp nền (ít, hạ tầng); App = lớp xây-trên (nhiều, cộng đồng)**. Khuyến khích build app thật.

**Nhóm người dùng & giới thiệu**
- **6. User (1.001.000)** — **tặng 1 triệu user ĐẦU TIÊN kích hoạt DID qua GetMAGIC, mỗi user 1001 LAMP**. Pot này
  **tăng dần từ Treasury, do DAO quyết**.
- **7. Referrer (343.000)** — thưởng **giới thiệu** người dùng mới. Uỷ thác vào Platform **AffiSo** (DID riêng).
- **8. PhoenixKey (142.857)** — thưởng cho **người sẵn sàng trả Network fee thay cho new User khi họ đăng ký Person
  DID**. **Giao thức hoàn toàn TỰ ĐỘNG, KHÔNG người kiểm soát.** Uỷ thác vào Platform **PhoenixKey** (DID riêng).
- **16. Joinnet (1.461.000)** — thưởng **tham gia/mở rộng mạng lưới**. Uỷ thác vào Platform **LampNet** (DID riêng).

**Nhóm DAO & đối tác**
- **9. MagicLamp Foundation (1.296.000)** — **năng lượng vận hành DAO**. Khoá vĩnh viễn sau khi lập pháp nhân; LAMP
  ở Foundation-DID **sinh MAGIC** chia cho các **ban chuyên môn** tiêu thụ. Ban được **tái uỷ quyền / bán thu fiat /
  uỷ thác thu LAMP**; phần MAGIC dư sau phân bổ cũng tái uỷ quyền nhận LAMP. Triết lý "tài sản khoá → năng lượng".
- **12. Partnership (284.000)** — **đối tác chiến lược**, theo thoả thuận; claim về **DID của partner**.

**Nhóm phân phối sớm (snapshot, hết trong thời gian đầu)**
- **13. ETD (12.000)** — ghi nhận **delegator sớm pool TIGER**; redeem TRƯỚC làm **bài test toàn cầu** cho hệ claim.
- **14. Airdrop (120.000)** — ghi nhận **cộng đồng sớm** (SPO + Delegator của pool đăng ký), 5 epoch ×24.000, 20:100.
- **15. SRCL (360.000)** — **redirect staking-reward ADA ↔ LAMP** (delegator tự nguyện đổi % reward), 36 epoch.

**Nhóm thanh khoản**
- **17. RedBack (21.143)** — token **mở thanh khoản ban đầu** khi niêm yết.
- **18. Liquidity (888.000)** — khuyến khích **cung cấp thanh khoản** cặp LAMP/ADA (theo TVL).

---

## 4. Giới hạn tỷ lệ gen? — KẾT LUẬN (phản biện toán + game-theory)

**Mối lo loãng là CÓ THẬT nhưng chỉ ở TRỤC KINH TẾ, không phải trục QUYỀN LỰC.**

1. **Trục quyền lực miễn nhiễm.** VP = MAGIC **tiêu thụ** (C1) × C2 × C3 × C4; cử tri = cá nhân DID sinh trắc.
   MAGIC trong OrgDID/Foundation chỉ là **số dư kế toán** — muốn thành phiếu phải **tiêu thụ bởi một thân-nhân
   sinh-trắc**, mà pot/Org không có. ⟹ founder/Foundation **không thể** biến kho MAGIC thành quyền lực. Động lực
   đóng góp của user được bảo vệ ở **tầng thiết kế**, không phải tầng tỷ lệ gen.
2. **Loãng kinh tế tự co.** Mỗi LAMP user gen MAGIC **nhiều hơn** org (hệ số hiệu dụng `eff_user≈1.79` vs
   `eff_org≈1.47`: user OAC cao + decay Ember). Tỷ trọng org: cộng đồng giữ 0→80%, giữ 8 tỷ→58%. Tự cân theo thời gian.

**Hệ-số-gen mỗi pot = THAM SỐ ĐIỀU CHỈNH ĐƯỢC, do Aladin Contract đặt thời gian đầu → sau giao DAO.**
Mỗi pot một hệ số `μ_pot ∈ (0,1]` riêng (KHÁC nhau), áp lên công thức gen: `M_pot = ⌊μ_pot · L · R · LF · OAC · PM · B / Q⁵⌋`.
Lý do để Aladin Contract chỉnh: team dev Aladin vận hành giao thức buổi đầu, cần tinh chỉnh theo dữ liệu thật; cơ chế
governance đầy đủ chưa lên → giao DAO sau.

**Khuyến nghị giá trị KHỞI ĐẦU (Aladin Contract đặt, chỉnh sau):**
- `μ ≈ 0.25` cho **2 pot Founder** (Aladin + GreenSun) — nhả MAGIC về OrgDID cty, không tự-tiêu-lại-cho-cộng-đồng →
  cân quang học ngày đầu (org 80%→50%; →25% khi cộng đồng giữ 8 tỷ).
- `μ = 1.0` (đầy đủ) cho Foundation (nuôi DAO, ban tiêu-thụ-lại), Platform/App (chia DID theo tiêu thụ),
  Joinnet/Referrer/PhoenixKey (uỷ thác Platform-DID phục vụ cộng đồng) — cap nhóm này = tự bắn vào chân.
- Vì Aladin chỉnh được, các mức trên là **điểm khởi đầu**, không khắc cứng vĩnh viễn.

---

## 5. Ba pot phân phối cộng đồng sớm (chi tiết claim — chốt sau)

- **ETD (12.000 nghìn)** — delegator sớm pool TIGER redeem TRƯỚC làm test toàn cầu. Rút theo claim_account vesting permissionless.
- **Airdrop (120.000 nghìn)** — 5 epoch ×24.000 nghìn, chia **20:100** (SPO:Delegator) theo stake pool đăng ký (cổng từ 1/7, hạn epoch 4). Claim Merkle sau snapshot đầu.
- **SRCL (360.000 nghìn)** — 36 epoch ×10.000 nghìn. Delegator tự nguyện góp staking-reward ADA → LAMP ∝ ADA góp; LAMP/pool ∝ tổng ADA pool; **SPO tự đặt bonus rate**. SPO chỉ đăng-ký + đặt-rate 1 lần (decouple, không ký mỗi epoch). Chủ dự án thu ADA.

---

*Hết catalog draft. §4 (cap gen-MAGIC) + quy tắc claim chi tiết chờ phản biện toán + chủ repo chốt.*
