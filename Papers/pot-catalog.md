# LAMP — Catalog 18 Pot (mô tả + khoá/nhỏ-giọt + gen-MAGIC)

> **Paper class**: A — Positioning — giải thích 18 pot cho người ngoài.
> Đây là tài liệu **đối ngoại** (bản phái sinh), không phải đặc tả nội bộ. Chuẩn: `../CONVENTIONS.md`.

> **DRAFT — chủ repo sẽ còn thay đổi.** Mục đích: để mọi người hiểu **mỗi pot là gì,
> dùng làm gì, bị khoá hay nhỏ-giọt thế nào, và có sinh MAGIC hay không.**
> Số liệu bám `TOKENOMICS-v17`. **Đơn vị: NGHÌN LAMP** (tổng 36.000.000 nghìn = 36 tỷ).
> Dùng nghìn LAMP để PhoenixKey (142.857) và RedBack (21.143) thành SỐ NGUYÊN, hết lẻ.

> **Hệ 3 token — CHỐT: KHÔNG hợp nhất CARP vào MAGIC** (đảo lại quyết-định gộp-1-token; nguồn `/CARP` SESSION-STATE §30/6-b).
> **LAMP** = tài sản nền 36 tỷ (tài liệu này mô tả). **MAGIC** = thuần **Consumable**: **KHÔNG chuyển nhượng**, không tiêu
> thì mất (decay), neo sức-mua-dịch-vụ nội sinh, **chỉ chuộc-ra-DỊCH-VỤ** (không chuộc tiền); sinh từ nắm LAMP
> (SnapshotMint) / tiêu định kỳ (ScheduleMint). **CARP** = đồng **Exchangeable** (lưu hành, chuyển nhượng, ổn định
> đa-tầng, policy riêng) — đồng DUY NHẤT được thiết kế để chuyển nhượng trong hệ. MAGIC & CARP **không niêm yết sàn ngoài**.

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
   - **KHÔNG** ❌ — chưa-gen on-chain / parked Treasury / trong LP sàn nội bộ / quỹ peg / hết sớm → KHÔNG ở vault-DID nào → không gen.

> **Bất biến I-ACT-7 — LAMP ĐỨNG YÊN** (neo: `MAGIC/InstantGen/TECH.md` §A02 và
> `MAGIC/ScheduleGen/TECH.md` đầu tệp + §3.2): LAMP **không rời vault khi sinh MAGIC**. Khi vault
> fire, LAMP là **nền tính suất** — `lamp_balance` **bất biến**, LAMP trong vault UTxO
> byte-identical trước và sau. MAGIC được tạo ra nhưng LAMP vẫn đứng yên. Mọi luồng "LAMP →
> Treasury" phát sinh từ *hành động sinh MAGIC* là **bất hợp lệ**; chân Treasury đã bị xoá khỏi
> validator, không phải chỉ bị cấm trên giấy.
> *(Chính xác một vế: `lamp_locked` bất biến qua InstantGen, nhưng `ScheduleFire` **giải phóng khoá**
> nên `lamp_locked` có giảm — giải phóng khoá không phải LAMP rời vault.)*
>
> **Riêng pot Wakeme — hai đường ra, và cả hai đều có thật trong mã**
> (`PhoenixKeyDID/PhoenixKey-Validator/validators/wakeme_vault.ak`, bản A chốt 2026-07-30):
> **(a)** phần **chưa mở** mà người dùng bỏ không dùng → `Reclaim`/`ReclaimEpoch` thu về **pot**
> (`pot_address`, anti-idle); **(b)** phần **đã mở** — `OwnEpoch` chuyển conditional → owned, chú
> thích mã ghi *"SỞ-HỮU-HẲN"* — là **tài sản của người dùng** và rút về ví được qua `Redeem`
> (`owner_address`). ⚠️ Có tài liệu đối ngoại trong hệ đang nói người dùng *"KHÔNG BAO GIỜ sở hữu"*
> khoản này — **sai với mã đang chạy**; đã gửi thư đính chính cho nhà giữ tài liệu đó.

> ⚠️ **Mối lo pha loãng:** LAMP ở vault tầng tổ chức 🏛️ ≈ **20 tỷ**, gấp ~5× tầng user 👤 (~4 tỷ). Kết luận
> phản biện ở §4. **Hệ-số-gen mỗi pot KHÁC nhau** và do **Aladin Contract điều chỉnh** thời gian đầu
> (team dev Aladin vận hành giao thức), **sau giao DAO**.

---

## 1. Bảng 18 pot (đơn vị: nghìn LAMP)

| # | Pot | Nghìn LAMP | % | Mục đích | Cách ra | Gen MAGIC? |
|---|---|---:|---:|---|---|---|
| 1 | **Reserve** | 9.630.000 | 26,75% | Đệm cung cuối, điều tiết khi Treasury cạn | Engine demand-gated: tối đa **9.630.000 LAMP/epoch** (E/1000), **không giới hạn số epoch** | ❌ chưa-mint |
| 2 | **Treasury** | 964.000 | 2,68% | Sổ điều tiết C↔T (giảm lưu hành = parked, không đốt) | Kế toán 2 chiều | ❌ parked |
| 3 | **Development** | 2.718.000 | 7,55% | Quỹ duy trì & vận hành giao thức: R&D công nghệ lõi + mua app truyền thống tích hợp; DAO quyết, ai cũng đề xuất | Nhỏ-giọt | 👤 khi claim về DID |
| 4 | **Platform** | 3.141.000 | 8,73% | Thưởng nền tảng dùng LAMP | Nhỏ-giọt | 🏛️ gen, chia DID theo MAGIC tiêu thụ |
| 5 | **App** | 1.618.000 | 4,49% | Khuyến khích ứng dụng xây trên hệ | Nhỏ-giọt | 🏛️ gen, chia DID theo MAGIC tiêu thụ |
| 6 | **Wakeme** | 1.001.000 | 2,78% | **Cho mượn để TIÊU dịch vụ, KHÔNG tặng, KHÔNG để mua-bán**: mỗi PersonDID ≤1001 LAMP, khoá 1001 đêm, ngày không dùng → thu 1 LAMP về pot; qua 1001 đêm nhả 1 LAMP/đêm thành sở-hữu | Module PhoenixKey **Wakeme** (tên cũ Activation): vault-vesting 1 LAMP/đêm + anti-idle | 👤 vault khoá theo PersonDID |
| 7 | **Referrer** | 343.000 | 0,95% | Thưởng giới thiệu | Nhỏ-giọt | 🏛️ uỷ thác Platform **AffiSo** DID |
| 8 | **PhoenixKey (Phoenix Treasury)** | 142.857 | 0,40% | Quỹ **Phoenix Treasury** — nguồn tài sản cho **Feecover** (trả phí hộ user). Cấp nguồn cho **Feecover** qua **1 đợt SRCL 7 epoch**: phần thưởng staking do người tham gia định tuyến về pot được dùng trả phí mạng, đóng góp đó được **ghi nhận** bằng 7 triệu LAMP (1 triệu/epoch). Quản lý số dư ADA của Feecover là nghiệp vụ vận hành nội bộ, không phải dịch vụ giao dịch cho bên thứ ba | Nhỏ-giọt + đợt SRCL 7 epoch | 🏛️ uỷ thác Platform **PhoenixKey** DID |
| 9 | **MagicLamp Foundation** | 1.296.000 | 3,60% | Năng lượng vận hành DAO | **Chưa-mint→khoá VĨNH VIỄN** sau khi lập pháp nhân | 🏛️ gen → nuôi DAO (xem §3) |
| 10 | **Aladin Contract** | 6.000.000 | 16,67% | Pháp nhân sáng lập (1/6 cung) | Nhỏ-giọt **ngang cộng đồng** | 🏛️ gen → **OrgDID Aladin** |
| 11 | **GreenSun Tech** | 6.000.000 | 16,67% | Pháp nhân sáng lập (1/6 cung) | Nhỏ-giọt **ngang cộng đồng** | 🏛️ gen → **OrgDID GreenSun** |
| 12 | **Partnership** | 284.000 | 0,79% | Đối tác chiến lược | Nhỏ-giọt | 👤 khi partner claim về DID |
| 13 | **Early TIGER Deleg (ETD)** | 12.000 | 0,03% | Delegate sớm TIGER (redeem TRƯỚC = test) | Snapshot hồi tố | ❌ hết sớm |
| 14 | **Airdrop** | 120.000 | 0,33% | Ghi nhận đóng góp vào cơ chế bền vững của mạng Cardano — 3 pot: Delegator 100M · SPO 5M · CS 15M | Snapshot, cả 3 pot ∝ trọng số stake (v2, chốt 10/7) | ❌ hết sớm |
| 15 | **SRCL** | 360.000 | 1,00% | Redirect staking-reward ADA ↔ LAMP | Snapshot/epoch theo ADA góp; SPO bonus tự đặt | ❌ hết sớm |
| 16 | **Join LampNet** | 1.461.000 | 4,06% | Thưởng người góp tài nguyên thiết bị vào hạ tầng phân tán LampNet | Nhỏ-giọt | 🏛️ uỷ thác Platform **LampNet** DID |
| 17 | **RedBack** | 21.143 | 0,06% | Quỹ phòng-thủ neo giá đồng ổn định (peg CARP↔MAGIC): hy sinh khi peg đỏ, lớn lên khi thế chấp vượt trần | Engine phòng thủ peg (vốn vô chủ) | ❌ quỹ peg |
| 18 | **Liquidity** | 888.000 | 2,47% | Cấp thanh khoản cho **sàn nội bộ hệ sinh thái** (cặp CARP/LAMP, CARP/ADA, CARP/NIGHT) | Engine LP theo TVL | ❌ trong LP |

**Kiểm chứng:** tổng = 36.000.000 nghìn ✓ · mọi pot trừ Reserve = 26.370.000 (= `dist_cap`) ✓ · Reserve = 9.630.000 (= `reserve_cap`) ✓ · PhoenixKey 142.857 + RedBack 21.143 = 164.000 (bù lẻ tròn).

---

## 2. Ba mức gen-MAGIC (tổng theo nghìn LAMP)

- **🏛️ Tổ chức/Platform — LAMP nằm trong vault OrgDID/Platform-DID, gen kể cả khi khoá (~20.001.857 ≈ 20 tỷ):**
  Foundation, Aladin, GreenSun, Platform, App, Join LampNet→LampNet, Referrer→AffiSo, PhoenixKey→PhoenixKey-DID.
- **👤 User — chỉ gen khi claim về DID (~4.003.000 ≈ 4 tỷ):** Development, Wakeme, Partnership.
- **❌ Không gen (~11.995.143 ≈ 12 tỷ):** Reserve, Treasury, ETD, Airdrop, SRCL, RedBack, Liquidity.

---

## 3. Thuyết minh từng pot (để cộng đồng phân biệt)

**Nhóm điều tiết & dự trữ**
- **1. Reserve (9.630.000)** — lớp đệm cung **cuối cùng**. Nhả **tối đa 9.630.000 LAMP mỗi epoch** (= 1/1000 quỹ
  Reserve), và **chỉ nhả khi có cầu thật** (demand-gated: khi lưu hành tụt dưới sàn, Treasury hết khả năng điều tiết).
  **KHÔNG giới hạn số epoch** — quỹ co-giãn theo nhu cầu thật, KHÔNG phải "nhả hết trong N epoch"; không cầu thì không
  nhả. Một chiều (no-burn). Permissionless, không ai rút tay.
- **2. Treasury (964.000)** — **vốn mồi + sổ điều tiết hai chiều** C↔T. "Giảm lưu hành" = parked vào đây (kế toán),
  KHÔNG đốt. Là nơi bơm lại các pot khác (User, Development…) khi DAO quyết. Quản bởi DAO.

**Nhóm vận hành & sáng lập (PHÂN BIỆT RÕ)**
- **3. Development (2.718.000)** — quỹ **duy trì & vận hành giao thức mạng lưới**: nghiên cứu & phát triển **công
  nghệ lõi mới**, và **mua các ứng dụng truyền thống để tích hợp** vào hệ. **Do DAO quyết định — bất kỳ thành viên
  DAO nào cũng có thể đề xuất tài trợ.** Có thể **được bổ sung dần từ Treasury** + **phần hoàn lại của các sản phẩm**.
  ⚠️ Đây là **quỹ CHUNG của giao thức (DAO quản), KHÔNG phải tiền của 2 công ty sáng lập** — khác hẳn pot Aladin/GreenSun.
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
- **6. Wakeme (1.001.000)** — **KHÔNG phải tặng.** Giao thức **cho mỗi PersonDID (PhoenixKey) MƯỢN tối đa 1001 LAMP với
  MỤC ĐÍCH DUY NHẤT là TIÊU dùng dịch vụ trong hệ — KHÔNG phải để mua-bán.** Khi kích hoạt DID (GetLAMP), LAMP vào một
  **vault khoá 1001 đêm**, mở dần **1 LAMP mỗi đêm**; **đêm nào không dùng dịch vụ → 1 LAMP phần CHƯA-MỞ bị thu về pot**
  (use-it-or-lose-it — chỉ đòi phần chưa trao, KHÔNG chạm phần đã mở). Ai dùng-thật giữ trọn dòng mở; ai bỏ cuộc trả
  phần chưa-mở về pot nuôi người mới. **Chỉ phần đã mở mới chuyển-nhượng được** (LAMP đã mở → sinh MAGIC để tiêu dùng
  dịch vụ trong hệ; phần đã mở là tài sản thuộc sở hữu người dùng, họ toàn quyền định đoạt). Cơ chế đầy đủ: đặc tả
  `PhoenixKey Wakeme` (tên cũ Activation; validator `activation_vault.ak`+`activation_logic.ak`,
  vault-vesting theo đồng-hồ-NGÀY slot/86400 + anti-idle thu-hồi, forfeit-1001-idle-epoch). **Pot tự-nuôi, không cạn**: 3 nguồn nạp — phần
  thu-hồi của người bỏ cuộc + phí user-trước (thu bằng LAMP theo giá-trị, phản-chu-kỳ) + Treasury bơm khi cần.
- **7. Referrer (343.000)** — thưởng **giới thiệu** người dùng mới. Uỷ thác vào Platform **AffiSo** (DID riêng).
- **8. PhoenixKey — Phoenix Treasury (142.857)** — **quỹ của Phoenix Treasury**, đóng vai **nguồn tài sản cho Feecover**
  (tính năng trả phí hộ người dùng). Trích một phần pot làm tài sản chi trả **phí mạng** cho user. Hai nguồn nạp cho
  Feecover: **(1)** `TxFee` user trả mỗi giao dịch — **phí cố định theo từng loại giao dịch, quy về CARP**; **(2)** chính
  pot này — chạy **1 đợt SRCL trong 7 epoch**: phần thưởng staking do người tham gia định tuyến về pot được dùng trả
  **phí mạng** cho user, và đóng góp đó được **ghi nhận** bằng **7 triệu LAMP** (1 triệu/epoch). **Vòng tự-bồi:** khi có
  CARP (từ TxFee), hệ thống quy đổi CARP về ADA để tiếp tục có nguồn trả phí. Đây là **nghiệp vụ vận hành nội bộ** để
  duy trì số dư trả phí, không phải dịch vụ giao dịch cung cấp cho bên thứ ba. **Giao thức TỰ ĐỘNG, KHÔNG người kiểm soát.** Uỷ thác vào Platform **PhoenixKey** (DID riêng).
  > Bản cũ ghi "quỹ tài trợ phí ADA/DUST, user không cần ADA" — mô tả sai (agent bịa), đã thay bằng mô hình Feecover
  > thực: `TxFee` cố định (CARP) + đợt SRCL 7 epoch của pot này thu ADA + CARP mua lại ADA trên DEX.
- **16. Join LampNet (1.461.000)** — thưởng **người đóng góp tài nguyên thiết bị** (sức tính toán, lưu trữ, băng thông)
  vào **hạ tầng thiết bị phân tán LampNet**. Uỷ thác vào Platform **LampNet** (DID riêng).

**Nhóm DAO & đối tác**
- **9. MagicLamp Foundation (1.296.000)** — **năng lượng vận hành DAO**. Khoá vĩnh viễn sau khi lập pháp nhân; LAMP
  ở Foundation-DID **sinh MAGIC** chia cho các **ban chuyên môn** tiêu thụ. Ban được **tái uỷ quyền** phần chưa dùng
  cho ban khác, hoặc **uỷ thác thu LAMP**; phần MAGIC dư sau phân bổ cũng tái uỷ quyền nhận LAMP. Mọi hình thức định
  đoạt tài sản của Foundation ra ngoài hệ do quy chế Foundation quyết định **sau khi lập pháp nhân** — chưa nằm trong
  phạm vi tài liệu này. Triết lý "tài sản khoá → năng lượng".
- **12. Partnership (284.000)** — **đối tác chiến lược**, theo thoả thuận; claim về **DID của partner**.

**Nhóm phân phối sớm (snapshot, hết trong thời gian đầu)**
- **13. ETD (12.000)** — ghi nhận **delegator sớm pool TIGER**; redeem TRƯỚC làm **bài test toàn cầu** cho hệ claim.
- **14. Airdrop (120.000)** — **dành tặng cộng đồng SPO và Delegator** dựa trên stake + sự hỗ trợ; **ghi nhận đóng góp
  vào cơ chế bền vững của mạng blockchain Cardano**. Chia **3 pot**: Delegator **100M** · SPO **5M** ·
  CS (Community Supporter) **15M**, cả ba đều **∝ trọng số stake**. Đặc tả hiệu lực:
  [`Airdrop/CONTRACT.md`](../Airdrop/CONTRACT.md). (Mô hình cũ 5 epoch ×24.000 tỉ lệ
  20:100 đã bị thay ngày 2026-07-10.)
- **15. SRCL (360.000)** — **redirect staking-reward ADA ↔ LAMP** (delegator tự nguyện đổi % reward), 36 epoch.

**Nhóm thanh khoản & bình ổn peg**
- **17. RedBack (21.143)** — **quỹ hỗ trợ neo giá đồng ổn định** (peg CARP↔MAGIC). **Hy sinh khi Peg chuyển sang đỏ**
  (dùng vốn vô chủ mua/đỡ kéo giá về neo) và **lớn lên khi tỷ lệ thế chấp (br) vượt quá trần** (thặng dư backing chảy
  vào quỹ). Vốn vô chủ, không ai rút tay. Chi tiết cơ chế bình ổn: `/CARP` (Stabilization).
- **18. Liquidity (888.000)** — dự phòng cho nhu cầu thanh khoản trong hệ sinh thái. **Cơ chế, thời điểm và điều kiện
  pháp lý để kích hoạt chưa được quyết định**, và chỉ triển khai trong khuôn khổ pháp luật áp dụng — vận hành một nơi
  giao dịch tài sản mã hoá là hoạt động cần giấy phép riêng, không suy ra từ tài liệu này. CARP là đồng chuyển-nhượng
  duy nhất trong hệ; MAGIC KHÔNG
  chuyển nhượng. Không niêm yết sàn ngoài.

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
  Join LampNet/Referrer/PhoenixKey (uỷ thác Platform-DID phục vụ cộng đồng) — cap nhóm này = tự bắn vào chân.
- Vì Aladin chỉnh được, các mức trên là **điểm khởi đầu**, không khắc cứng vĩnh viễn.

---

## 5. Ba pot phân phối cộng đồng sớm (chi tiết claim — chốt sau)

- **ETD (12.000 nghìn)** — delegator sớm pool TIGER redeem TRƯỚC làm test toàn cầu. Rút theo claim_account vesting permissionless.
- **Airdrop (120.000 nghìn)** — **3 pot**: Delegator 100M · SPO 5M · CS 15M, cả ba ∝ trọng số stake (v2, chốt 10/7). Đăng ký bắt buộc; claim Merkle sau snapshot.
- **SRCL (360.000 nghìn)** — 36 epoch ×10.000 nghìn. Delegator tự nguyện định tuyến phần thưởng staking về pot; LAMP được **ghi nhận** ∝ phần thưởng đã đóng góp (việc đã xảy ra), theo công thức tất định công khai; **SPO tự đặt bonus rate**. SPO chỉ đăng-ký + đặt-rate 1 lần (decouple, không ký mỗi epoch). Phần thưởng ADA thuộc doanh thu vận hành pool của bên vận hành đợt, tách bạch với phân bổ LAMP.

---

*Hết catalog draft. §4 (cap gen-MAGIC) + quy tắc claim chi tiết chờ phản biện toán + chủ repo chốt.*
