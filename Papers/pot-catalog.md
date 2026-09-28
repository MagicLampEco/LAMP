# LAMP — Catalog 18 Pot (mô tả + khoá/nhỏ-giọt + gen-MAGIC)

> **Trạng thái**: ĐÃ CHỐT — bảng 18 pot (§1), phân loại gen-MAGIC ba mức (§0, §2), thuyết minh
> từng pot (§3) và kết luận về hệ-số-gen (§4) là quyết định đã chốt.
>
> **Còn mở** — hai chỗ, không phải một:
> - Quy tắc claim chi tiết của **ETD** và **SRCL** (§5). Airdrop thì không còn mở: schema nạp/claim
>   và tham số vận hành đã chốt; phần duy nhất còn treo của Airdrop là nghĩa `owner` của vai SPO.
> - **§3, pot 18 (Liquidity)** — cơ chế, thời điểm và điều kiện pháp lý để kích hoạt.
>
> Một mục đã chốt vẫn sửa được, nhưng sửa bằng một quyết định mới có ngày — không phải vì tài
> liệu này tự nhận là nháp.
>
> Mục đích: để mọi người hiểu **mỗi pot là gì, dùng làm gì, bị khoá hay nhỏ-giọt thế nào, và có
> sinh MAGIC hay không.**
> **Đơn vị: NGHÌN LAMP** (tổng 36.000.000 nghìn = 36 tỷ).
> Dùng nghìn LAMP để PhoenixKey (142.857) và RedBack (21.143) thành SỐ NGUYÊN, hết lẻ.

> **Hệ 3 token — KHÔNG hợp nhất CARP vào MAGIC.**
> **LAMP** = tài sản nền 36 tỷ (tài liệu này mô tả). **MAGIC** = thuần **Consumable**: **KHÔNG chuyển nhượng**, không tiêu
> thì mất (decay), neo sức-mua-dịch-vụ nội sinh, **chỉ chuộc-ra-DỊCH-VỤ** (không chuộc tiền); sinh từ nắm LAMP
> (InstantGen) / tiêu định kỳ (ScheduleGen). **CARP** = đồng **Exchangeable** (lưu hành, chuyển nhượng, ổn định
> đa-tầng, policy riêng) — đồng DUY NHẤT được thiết kế để chuyển nhượng trong hệ. MAGIC & CARP **không niêm yết sàn
> ngoài**; dự án không cam kết về việc niêm yết CARP trong tương lai.

---

## 0. Ba thuộc tính mỗi pot

1. **Mục đích** — pot này để làm gì.
2. **Cách ra:** **Nhỏ-giọt (CappedDrop)** — công thức trần tích luỹ + cắt ngọn: `distribution.md` §3.1 ·
   **Chưa-mint** (token chưa tồn tại, khoá tự nhiên) · **Snapshot** (chia theo ảnh chụp, claim Merkle
   permissionless) · **Engine riêng** (Reserve: trần nhịp + cổng cầu / LP / RedBack).
3. **Gen MAGIC?** — **NGUYÊN TẮC CỐT LÕI: MAGIC CHỈ gen trong VAULT của một DID, KHÔNG bao giờ gen "trong pot".**
   Một pot chỉ gen MAGIC khi **LAMP của nó đã nằm trong một vault-DID** (cá nhân / OrgDID / Platform-DID).
   3 mức = LAMP nằm ở **vault-DID nào**:
   - **TỔ CHỨC/PLATFORM** 🏛️ — LAMP được giữ/khoá **trong vault của OrgDID / Platform-DID** (OrgDID
     Aladin/GreenSun, Platform-DID LampNet/AffiSo/PhoenixKey) → vault đó gen MAGIC (tính cả phần khoá).
     Pot Foundation cũng xếp ở mức này, **áp dụng khi** cách khoá công bố lúc lập pháp nhân cho phép LAMP
     nằm trong một vault-DID — xem §3 pot 9.
   - **USER** 👤 — hai đường: **(a)** LAMP nằm ở **kênh phân phối (KHÔNG phải vault-DID)** → chỉ gen khi
     **claim về vault DID người dùng** (Development, Partnership); **(b)** LAMP đã khoá sẵn trong két theo
     **PersonDID** ngay từ đầu, không rời két ra ví người dùng (Wakeme) — được tính là nằm trong vault gắn
     DID cá nhân.
   - **KHÔNG** ❌ — chưa-gen on-chain / parked Treasury / trong LP sàn nội bộ / quỹ peg / hết sớm → KHÔNG ở vault-DID nào → không gen.

> **Bất biến quan trọng — LAMP ĐỨNG YÊN** (neo: kho `MagicLampEco/MAGIC` — `MAGIC/InstantGen/TECH.md`
> §A02 và `MAGIC/ScheduleGen/TECH.md` đầu tệp + §3.2): LAMP **không rời vault khi sinh MAGIC**. Khi vault
> fire, LAMP là **nền tính suất** — `lamp_balance` **bất biến**, LAMP trong vault UTxO
> byte-identical trước và sau. MAGIC được tạo ra nhưng LAMP vẫn đứng yên. Mọi luồng "LAMP →
> Treasury" phát sinh từ *hành động sinh MAGIC* là **bất hợp lệ**; chân Treasury đã bị xoá khỏi
> validator, không phải chỉ bị cấm trên giấy.
> *(Chính xác một vế: `lamp_locked` bất biến qua InstantGen, nhưng `ScheduleFire` **giải phóng khoá**
> nên `lamp_locked` có giảm — giải phóng khoá không phải LAMP rời vault.)*
>
> **Riêng pot Wakeme — MỘT ĐÍCH: LAMP rời két chỉ về kho.** LAMP trong két Wakeme không rút ra ví
> người dùng được; đường ra duy nhất của nó là về kho của pot. Két mở dần 1 LAMP mỗi đêm trong 1001
> đêm; đêm nào không dùng dịch vụ thì phần chưa mở của đêm đó bị thu hồi về kho. Wakeme không giữ
> khoá nào chi phối tài sản người dùng.

> ⚠️ **Mối lo pha loãng:** LAMP ở vault tầng tổ chức 🏛️ ≈ **20 tỷ**, gấp ~5× tầng user 👤 (~4 tỷ). Kết luận
> phân tích ở §4. **Hệ-số-gen mỗi pot KHÁC nhau**; pháp nhân sáng lập vận hành giai đoạn đầu, chuyển
> DAO theo lộ trình.

---

## 1. Bảng 18 pot (đơn vị: nghìn LAMP)

| # | Pot | Nghìn LAMP | % | Mục đích | Cách ra | Gen MAGIC? |
|---|---|---:|---:|---|---|---|
| 1 | **Reserve** | 9.630.000 | 26,75% | Đệm cung cuối, điều tiết khi Treasury cạn | Engine hai vế: trần **9.630 nghìn LAMP/epoch** (= 9,63 triệu LAMP = 1/1000 quỹ Reserve) + cổng cầu khi kho Treasury dưới sàn; **không ấn định epoch kết thúc**. Luật: [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md) | ❌ chưa-mint |
| 2 | **Treasury** | 964.000 | 2,68% | Sổ điều tiết C↔T (giảm lưu hành = parked, không đốt) | Kế toán 2 chiều | ❌ parked |
| 3 | **Development** | 2.718.000 | 7,55% | Quỹ duy trì & vận hành giao thức: R&D công nghệ lõi + mua app truyền thống tích hợp; DAO quyết, ai cũng đề xuất | Nhỏ-giọt | 👤 khi claim về DID |
| 4 | **Platform** | 3.141.000 | 8,73% | Thưởng nền tảng dùng LAMP | Nhỏ-giọt | 🏛️ gen, chia DID theo MAGIC tiêu thụ |
| 5 | **App** | 1.618.000 | 4,49% | Khuyến khích ứng dụng xây trên hệ | Nhỏ-giọt | 🏛️ gen, chia DID theo MAGIC tiêu thụ |
| 6 | **Wakeme** | 1.001.000 | 2,78% | **Cho mượn để TIÊU dịch vụ, KHÔNG tặng, KHÔNG để mua-bán**: mỗi PersonDID mượn tối đa 1001 LAMP, khoá 1001 đêm, trong đó mở dần 1 LAMP mỗi đêm | Vault-vesting do PhoenixKey vận hành + thu hồi đêm không dùng | 👤 vault khoá theo PersonDID |
| 7 | **Referrer** | 343.000 | 0,95% | Thưởng giới thiệu | Nhỏ-giọt | 🏛️ uỷ thác Platform **AffiSo** DID |
| 8 | **PhoenixKey (Phoenix Treasury)** | 142.857 | 0,40% | Quỹ **Phoenix Treasury** — nguồn tài sản cho **Feecover** (trả phí hộ user). Cấp nguồn cho **Feecover** qua **1 đợt SRCL 7 epoch**: phần thưởng staking do người tham gia định tuyến về pot được dùng trả phí mạng, đóng góp đó được **ghi nhận** bằng 7 triệu LAMP (1 triệu/epoch). Quản lý số dư ADA của Feecover là nghiệp vụ vận hành nội bộ, không phải dịch vụ giao dịch cho bên thứ ba | Nhỏ-giọt + đợt SRCL 7 epoch | 🏛️ uỷ thác Platform **PhoenixKey** DID |
| 9 | **MagicLamp Foundation** | 1.296.000 | 3,60% | Quỹ dài hạn của pháp nhân đại diện, giữ ở dạng khoá gốc | **Chưa-mint→khoá VĨNH VIỄN** sau khi lập pháp nhân | 🏛️ *(áp dụng khi cách khoá cho phép — xem §3)* |
| 10 | **Aladin Contract** | 6.000.000 | 16,67% | Pháp nhân sáng lập (1/6 cung) | Nhỏ-giọt **ngang cộng đồng** | 🏛️ gen → **OrgDID Aladin** |
| 11 | **GreenSun Tech** | 6.000.000 | 16,67% | Pháp nhân sáng lập (1/6 cung) | Nhỏ-giọt **ngang cộng đồng** | 🏛️ gen → **OrgDID GreenSun** |
| 12 | **Partnership** | 284.000 | 0,79% | Đối tác chiến lược | Nhỏ-giọt | 👤 khi partner claim về DID |
| 13 | **Early TIGER Deleg (ETD)** | 12.000 | 0,03% | Delegate sớm TIGER (redeem TRƯỚC = test) | Snapshot hồi tố | ❌ hết sớm |
| 14 | **Airdrop** | 120.000 | 0,33% | Ghi nhận đóng góp vào cơ chế bền vững của mạng Cardano — 2 phần: Delegator 100M · SPO 20M | Snapshot theo `accStake`, sàn 1.000 ADA (chốt 25/9) | ❌ hết sớm |
| 15 | **SRCL** | 360.000 | 1,00% | Redirect staking-reward ADA ↔ LAMP | Snapshot/epoch theo ADA góp; SPO bonus tự đặt | ❌ hết sớm |
| 16 | **Join LampNet** | 1.461.000 | 4,06% | Thưởng người góp tài nguyên thiết bị vào hạ tầng phân tán LampNet | Nhỏ-giọt | 🏛️ uỷ thác Platform **LampNet** DID |
| 17 | **RedBack** | 21.143 | 0,06% | Quỹ phòng-thủ neo giá đồng ổn định (peg CARP↔MAGIC): hy sinh khi peg đỏ, lớn lên khi thế chấp vượt trần | Engine phòng thủ peg (vốn vô chủ) | ❌ quỹ peg |
| 18 | **Liquidity** | 888.000 | 2,47% | Dự phòng thanh khoản hệ sinh thái; cơ chế và cặp giao dịch: xem §3 pot 18 | Chưa có engine; xem §3 pot 18 | ❌ dự phòng |

**Kiểm chứng:** tổng = 36.000.000 nghìn ✓ · mọi pot trừ Reserve = 26.370.000 (= `dist_cap`) ✓ · Reserve = 9.630.000 (= `reserve_cap`) ✓ · PhoenixKey 142.857 + RedBack 21.143 = 164.000 (bù lẻ tròn).

### Cổng pháp lý theo pot — ràng buộc fail-closed

Bảng này ghi **trạng thái**, không ghi phương án. Mỗi dòng: pot nào · điều gì đang mở · ràng buộc
TẠM đang có hiệu lực · khai ở đâu. Mọi ràng buộc đều là **đóng-mặc-định**: điều kiện chưa thoả thì
pot không vận hành phần tương ứng, chứ không vận hành tạm rồi sửa sau.

| pot | trạng thái đang mở | ràng buộc TẠM đang có hiệu lực (fail-closed) | khai ở |
|---|---|---|---|
| 9 · Foundation | pháp nhân chưa lập | **không** giữ tài sản trọng yếu trước khi có pháp nhân; khoá vĩnh viễn chỉ thực hiện sau khi lập | §3 pot 9 |
| `PHAP-NHAN-001` (áp cho pot 9 · 14 · 15) | quốc gia đặt pháp nhân, hình thức pháp nhân, quy chế của nó | đã định **hướng**: pháp nhân đặt ở **nước ngoài**, lập bởi cộng đồng DAO hình thành từ Airdrop. Chừng nào chưa công bố đủ ba thứ đang mở ⇒ **cấm** mọi tài liệu mô tả Foundation như pháp nhân **đang tồn tại**, **cấm** nêu một quốc gia cụ thể như đã chọn, và pot 9 giữ trạng thái **chưa-mint** | §3 pot 9, pot 14; `srcl.md` §1 |
| 15 · SRCL | đại lượng đo ngưỡng kích hoạt (`SRCL-KICH-HOAT-001`) · người giữ `delegation_admin` (`SRCL-ADMIN-002`) | con số ngưỡng: **21**. Đơn vị đếm, văn kiện lâm thời và cách đếm công bố sau ⇒ SRCL **không kích hoạt** tới khi công bố; admin chưa công bố ⇒ **cấm** mô tả cơ chế là "bất biến"/"không admin" | `srcl.md` §1, §8 |
| 17 · RedBack | phạm vi CARP ↔ LAMP | quỹ peg thuộc tài liệu riêng của CARP; kho này **không** định nghĩa lại điều kiện hy sinh quỹ | `srcl.md` §5 đợt 2 |
| 18 · Liquidity | điều kiện pháp lý để cấp thanh khoản | **chưa kích hoạt**; không cặp nào được mở trước khi có kết luận tư vấn cho khu vực tương ứng | §3 pot 18 |

**Áp cho mọi pot:** phân phối LAMP theo nguyên tắc **đóng-mặc-định theo vùng pháp lý** — một khu
vực chỉ mở khi đã có kết luận tư vấn cho khu vực đó, và ràng buộc đó có hiệu lực **kỹ thuật tại
khâu claim**, không chỉ trong quy chế.

---

## 2. Ba mức gen-MAGIC (tổng theo nghìn LAMP)

- **🏛️ Tổ chức/Platform — LAMP nằm trong vault OrgDID/Platform-DID, gen kể cả khi khoá (~20.001.857 ≈
  20 tỷ, gồm Foundation — áp dụng khi cách khoá công bố lúc lập pháp nhân cho phép LAMP nằm trong
  vault-DID):** Aladin, GreenSun, Platform, App, Join LampNet→LampNet, Referrer→AffiSo,
  PhoenixKey→PhoenixKey-DID, Foundation.
- **👤 User (~4.003.000 ≈ 4 tỷ):** hai đường — Development, Partnership gen **sau khi claim** về vault DID
  người dùng; Wakeme gen vì LAMP đã nằm sẵn trong két theo **PersonDID** (không rời két ra ví).
- **❌ Không gen (~11.995.143 ≈ 12 tỷ):** Reserve, Treasury, ETD, Airdrop, SRCL, RedBack, Liquidity.

---

## 3. Thuyết minh từng pot (để cộng đồng phân biệt)

**Nhóm điều tiết & dự trữ**
- **1. Reserve (9.630.000)** — lớp đệm cung **cuối cùng**, luật nhả có **hai vế phải thoả cả hai**: nhả
  **tối đa 9.630 nghìn LAMP mỗi epoch** (= 9,63 triệu LAMP = 1/1000 quỹ Reserve), và **chỉ nhả khi kho
  Treasury xuống dưới sàn**. Cạn sau 1000 epoch là **cận dưới**, không phải lịch — mỗi epoch bị cổng
  đóng lại đẩy thời điểm cạn ra xa, và **không có cận trên**; không cầu thì không nhả. Một chiều
  (no-burn). Permissionless, không ai rút tay. Luật đầy đủ: [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md).
- **2. Treasury (964.000)** — **vốn mồi + sổ điều tiết hai chiều** C↔T. "Giảm lưu hành" = parked vào đây
  (kế toán), KHÔNG đốt. Hai khái niệm KHÁC nhau, đừng gộp: **trần của một pot đã triển khai bị chốt cứng
  trên chuỗi** (đổi ngân sách một pot nghĩa là triển khai lại cụm pot đó, không phải chỉnh một tham số);
  còn **"Treasury cấp thêm cho một pot"** là một khoản **chuyển giữa hai pot theo biểu quyết** (rút từ
  Treasury, cấp cho pot kia ở lượt triển khai kế tiếp) — tổng 36 tỷ không đổi. Thiết kế: DAO quản; giai
  đoạn đầu pháp nhân sáng lập vận hành, chuyển DAO theo lộ trình.

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
  MỤC ĐÍCH DUY NHẤT là TIÊU dùng dịch vụ trong hệ — KHÔNG phải để mua-bán.** LAMP trong két không rút
  ra ví người dùng được; đường ra duy nhất của nó là về kho của pot. Két mở dần **1 LAMP mỗi đêm**
  trong 1001 đêm; đêm nào không dùng dịch vụ thì phần chưa mở của đêm đó bị thu hồi về kho
  (use-it-or-lose-it — chỉ đòi phần chưa mở). Wakeme không giữ khoá nào chi phối tài sản người dùng.
  Ba nguồn nạp lại vào **đúng ngân sách đã chốt** của pot: phần thu-hồi của người bỏ cuộc (đêm chưa mở
  bị thu hồi về kho) + phí user-trước (thu bằng LAMP theo giá-trị, phản-chu-kỳ) + Treasury cấp thêm theo
  biểu quyết (một khoản chuyển giữa hai pot — xem pot 2, không phải tăng trần).
- **7. Referrer (343.000)** — thưởng **giới thiệu** người dùng mới. Uỷ thác vào Platform **AffiSo** (DID riêng).
- **8. PhoenixKey — Phoenix Treasury (142.857)** — quỹ của Phoenix Treasury, nguồn tài sản cho
  Feecover (tính năng trả phí mạng hộ người dùng). Một phần nguồn ADA của Feecover đến từ pot này
  qua một đợt SRCL riêng, 7 epoch, dùng ngân sách của chính pot 8 — tách khỏi pot 15 (SRCL cộng
  đồng). Đóng góp đó được **ghi nhận** bằng **7 triệu LAMP** (1 triệu/epoch). Việc quy đổi tài sản
  khác về ADA để duy trì nguồn trả phí chỉ triển khai trong khuôn khổ pháp luật áp dụng cho hoạt
  động đó, và hiện không vận hành. Quy tắc chi của pot này nằm trong mã, không do người quyết định
  từng lượt. Uỷ thác vào Platform **PhoenixKey** (DID riêng).
- **16. Join LampNet (1.461.000)** — thưởng **người đóng góp tài nguyên thiết bị** (sức tính toán, lưu trữ, băng thông)
  vào **hạ tầng thiết bị phân tán LampNet**. Uỷ thác vào Platform **LampNet** (DID riêng). Nguồn phân
  phối là cơ chế **LampNet Launch** (`launch-framework.md` §3) — cùng khung với SRCL, khác giải pháp
  kỹ thuật; trạng thái: sẽ thiết kế.

**Nhóm DAO & đối tác**
- **9. MagicLamp Foundation (1.296.000)** — **quỹ dài hạn của pháp nhân đại diện**. Pháp nhân này **đặt ở nước ngoài** và
  do **cộng đồng DAO hình thành từ đợt Airdrop** lập ra, không do hai công ty sáng lập lập ra — vai của nó là
  **đại diện pháp lý** cho hệ (trạng thái: `PHAP-NHAN-001`, mục "Cổng pháp lý theo pot" ở §1).
  LAMP của Foundation **khoá gốc vĩnh viễn** sau khi lập pháp nhân; cách khoá — và việc cách khoá đó có để
  LAMP nằm trong một vault-DID hay không — công bố **cùng lúc lập pháp nhân**. Mọi hình thức định đoạt tài
  sản của Foundation ra ngoài hệ do quy chế Foundation quyết định **sau khi lập pháp nhân** — chưa nằm trong
  phạm vi tài liệu này. Phần LAMP này không nhả ra lưu hành. Việc nó có tạo nguồn vận hành cho DAO hay
  không phụ thuộc cách khoá, công bố cùng lúc lập pháp nhân.
- **12. Partnership (284.000)** — **đối tác chiến lược**, theo thoả thuận; claim về **DID của partner**.

**Nhóm phân phối sớm (snapshot, hết trong thời gian đầu)**
- **13. ETD (12.000)** — ghi nhận **delegator sớm pool TIGER**; redeem TRƯỚC làm **bài test toàn cầu** cho hệ claim.
- **14. Airdrop (120.000)** — **dành tặng cộng đồng Delegator và SPO** dựa trên **stake**; ghi nhận việc góp phần
  vào an ninh kinh tế của mạng Cardano.

  **Mục đích chính của đợt này không phải là phân phối token, mà là tạo ra một cộng đồng DAO** —
  tập hợp đủ người sẵn sàng nhận việc vận hành để **thành lập MagicLamp Foundation**, pháp nhân
  **đặt ở nước ngoài** làm đại diện pháp lý cho hệ. Việc phân phối token là **phương tiện** để tập
  hợp cộng đồng đó, không phải đích đến. Hệ quả đọc được từ hai chỗ khác trong tài liệu này: pot 9
  (Foundation) **chưa-mint** cho tới khi pháp nhân được lập, và SRCL (pot 15) **không kích hoạt**
  trước khi đạt số người ký văn kiện thành lập — cả hai mốc đều nằm **sau** Airdrop, và cả hai đều
  đóng-mặc-định. Nói cách khác, Airdrop là bước duy nhất chạy được khi chưa có pháp nhân, và đó
  chính là lý do nó đứng đầu. Trạng thái của chính pháp nhân: dòng `PHAP-NHAN-001`, mục "Cổng pháp
  lý theo pot" ở §1.

  Chia **2 phần** (chốt 2026-09-25): **Delegator 100M**, chia theo `accStake` của chính người nhận ·
  **SPO 20M**, chia theo tổng `accStake` của các delegator đủ điều kiện đang uỷ thác vào pool đó.
  Người nhận phải vượt **sàn 1.000 ADA**. Không có phần Community Supporter, không có phần tương tác
  (engage). Cách chia cũ 3 pot (Delegator 100M · SPO 5M · CS 15M) đã bị thay.
- **15. SRCL (360.000)** — **redirect staking-reward ADA ↔ LAMP** (delegator tự nguyện đổi % reward), 36 epoch (≈180 ngày).

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

## 4. Giới hạn tỷ lệ gen? — KẾT LUẬN

**Mối lo loãng là CÓ THẬT nhưng chỉ ở TRỤC KINH TẾ, không phải trục QUYỀN LỰC.**

1. **Trục quyền lực miễn nhiễm.** VP = MAGIC **tiêu thụ** (C1) × C2 × C3 × C4; cử tri = cá nhân DID sinh trắc.
   MAGIC trong OrgDID/Foundation chỉ là **số dư kế toán** — muốn thành phiếu phải **tiêu thụ bởi một thân-nhân
   sinh-trắc**, mà pot/Org không có. ⟹ founder/Foundation **không thể** biến kho MAGIC thành quyền lực. Động lực
   đóng góp của user được bảo vệ ở **tầng thiết kế**, không phải tầng tỷ lệ gen.
2. **Loãng kinh tế tự co.** Mỗi LAMP user gen MAGIC nhiều hơn LAMP tổ chức theo thiết kế (tham số OAC +
   decay), nên tỷ trọng MAGIC do tổ chức nắm giảm dần khi cộng đồng tham gia nhiều hơn. Tự cân theo thời
   gian, không cần thêm trần cứng.

**Hệ-số-gen mỗi pot là THAM SỐ ĐIỀU CHỈNH ĐƯỢC, nhưng KHÔNG nằm trong mã sinh MAGIC.** Ký hiệu `μ_pot`
trong công thức `M_pot = ⌊μ_pot · L · R · LF · OAC · PM · B / Q⁵⌋` là cách viết GỘP cho dễ đọc: cơ chế
thật tác động qua **lượng LAMP mà mỗi pot nạp vào vault sinh MAGIC** (MAGIC tỉ lệ tuyến tính với LAMP
trong vault, nên nạp ít hơn có hiệu quả tương đương nhân `μ_pot` vào công thức) — không sửa mã MAGIC,
không đụng datum/constructor. Chi tiết cơ chế: `distribution.md` §4.1. Giá trị μ khởi đầu của từng pot
công bố khi policy chính thức phát hành, và đổi được qua cập nhật cấu hình trên chuỗi; pháp nhân sáng
lập vận hành giai đoạn đầu, chuyển DAO theo lộ trình.

---

## 5. Ba pot phân phối cộng đồng sớm (chi tiết claim — ETD/SRCL chốt sau, Airdrop đã chốt)

- **ETD (12.000 nghìn)** — delegator sớm pool TIGER redeem TRƯỚC làm test toàn cầu. Rút theo claim_account vesting permissionless.
- **Airdrop (120.000 nghìn)** — **2 phần** (chốt 2026-09-25): Delegator 100M theo `accStake` của người nhận · SPO 20M theo tổng `accStake` uỷ thác vào pool; sàn 1.000 ADA; không phần CS, không phần tương tác. Đăng ký bắt buộc; claim Merkle sau snapshot. Quy tắc claim đã chốt; phần duy nhất còn treo là nghĩa `owner` của vai **SPO**.
- **SRCL (360.000 nghìn)** — 36 epoch ×10.000 nghìn. Delegator tự nguyện định tuyến phần thưởng staking về pot; LAMP được **ghi nhận** ∝ phần thưởng đã đóng góp (việc đã xảy ra), theo công thức tất định công khai; **SPO tự đặt bonus rate**. SPO chỉ đăng-ký + đặt-rate 1 lần (decouple, không ký mỗi epoch). ADA phần-thưởng đi về bên thụ hưởng khai ở `srcl.md` §5, tách bạch với phân bổ LAMP.

---

*Hết catalog. §4 (hệ-số-gen) đã có kết luận — `μ_pot` là tham số điều chỉnh được theo thiết kế,
không phải mục còn treo. Hai chỗ còn treo: quy tắc claim chi tiết của ETD / SRCL cùng nghĩa `owner`
vai SPO của Airdrop (§5), và điều kiện kích hoạt pot Liquidity (§3, pot 18).*
