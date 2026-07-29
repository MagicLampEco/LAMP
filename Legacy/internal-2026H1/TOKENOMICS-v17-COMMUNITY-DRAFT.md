# LAMP Tokenomics v17 — Bản giải thích cho cộng đồng

> **DRAFT NỘI BỘ — chờ chủ repo duyệt. KHÔNG đăng công khai.**
> Văn bản này diễn giải phân bổ token LAMP cho người đọc phổ thông. Mọi con số
> đơn vị **triệu LAMP** (tổng 36.000 triệu = 36 tỷ). Bản kỹ thuật gốc:
> `TOKENOMICS.md`. Khi có sai lệch, bản kỹ thuật là nguồn sự thật.

---

## 0. Tóm tắt một câu

LAMP có **tổng cung cố định 36 tỷ, không bao giờ đốt**. Token chia thành 18 quỹ
(pot) với mục đích rõ ràng. Không quỹ nào — kể cả quỹ của đội sáng lập — được rút
sạch trong ngày đầu: tất cả chảy ra **nhỏ giọt theo nhịp epoch**, ràng buộc bằng
luật on-chain. Quyền biểu quyết KHÔNG mua được bằng token.

---

## 1. Năm nguyên tắc nền tảng

**1.1 — 36 tỷ cố định, không đốt.**
Tổng cung LAMP là 36 tỷ, vĩnh viễn. Con số 36 = 1³+2³+3³, chọn làm điểm neo niềm
tin. Hợp đồng on-chain ép **tổng phát hành lịch sử ≤ 36 tỷ** — không có cửa nào in
thêm. "Giảm lưu hành" KHÔNG có nghĩa là đốt token: token được chuyển vào **Treasury**
(một sổ kế toán on-chain) và có thể đưa lại lưu thông sau. Không một LAMP nào bị huỷ.

**1.2 — Lazy-mint: chưa phát hành = chưa tồn tại.**
LAMP không nằm sẵn trong một "kho 36 tỷ" chờ phát. Token chỉ được tạo (mint) khi
thực sự có kênh phân phối yêu cầu. Phần chưa phát hành **chưa tồn tại on-chain** —
không thể bị đánh cắp, không phải mồi cho nghi ngờ tập trung quyền lực. Để bảo chứng
trần tổng, hai con số được **khắc cứng (baked) ngay trong hợp đồng**:

- `dist_cap = 26,37 tỷ` — trần cho **mọi pot trừ Reserve**.
- `reserve_cap = 9,63 tỷ` — trần riêng cho Reserve.
- Cộng lại = **36 tỷ**. Một bộ đếm đơn điệu (chỉ tăng) chặn tại trần này vĩnh viễn.

**1.3 — MAGIC KHÔNG phải token, là sổ kế toán.**
Đừng hiểu MAGIC như một đồng coin thứ hai. MAGIC là **dữ liệu kế toán (datum)** ghi
mức "tiêu thụ" của mỗi người dùng, dùng để tính quyền lợi và quyền biểu quyết. MAGIC
không giao dịch trên sàn, không có giá thị trường.

**1.4 — Công bằng nhỏ giọt (CappedDrop).**
Quỹ của đội sáng lập (Aladin, GreenSun) nhả ra **cùng một cơ chế và cùng nhịp** với
quỹ cộng đồng. Mỗi ví có một hạn mức `E` (entitlement). Lượng được phép nhận tại
thời điểm `t`:

```
vested(t) = min( E , D · drops_per_epoch · max(0, t − start_epoch) )
```

Nghĩa là token mở khoá tuyến tính theo từng epoch, không ai xả sạch hạn mức trong
ngày đầu. Hành động "redeem" (rút phần đã mở khoá) là **permissionless** — ai cũng
kiểm chứng và kích hoạt được, không qua người gác cổng.

**1.5 — Governance KHÔNG theo trọng số token.**
Giàu token KHÔNG đồng nghĩa nhiều phiếu. Cử tri là **cá nhân**, định danh qua
PhoenixKey DID (sinh trắc — một người thật, một danh tính). Sức biểu quyết (VP) là
**tích của ≥4 tham số**: (a) MAGIC đã tiêu thụ, (b) LAMP cam kết khoá, (c) uy tín,
(d) LAMP nắm giữ — và tham số (d) **có trần (cap)** để cá voi không áp đảo.

---

## 2. Bảng 18 pot (v17)

> Tổng = 36.000 triệu LAMP = 36 tỷ. Phần lẻ (PhoenixKey .857 + RedBack .143 = 1 triệu)
> là cố ý, để các con số "hằng số" còn lại tròn đẹp. Thứ tự dưới đây là thứ tự chuẩn.

| # | Pot | Triệu LAMP | % | Ý nghĩa con số | Cơ chế nhả |
|---|---|---:|---:|---|---|
| 1 | **Reserve** | 9.630 | 26,75% | đệm phát hành sau cùng | Reserve engine: tối đa 9.630.000 LAMP/epoch (1/1000 quỹ), demand-gated, không giới hạn số epoch |
| 2 | Treasury | 964 | 2,68% | — | điều tiết C↔T (sổ kế toán) |
| 3 | Development | 2.718 | 7,55% | ≈ e×1000 | CappedDrop |
| 4 | Platform | 3.141 | 8,73% | ≈ π×1000 | CappedDrop theo MAGIC tiêu thụ |
| 5 | App | 1.618 | 4,49% | ≈ φ×1000 (tỉ lệ vàng) | CappedDrop |
| 6 | Wakeme | 1.001 | 2,78% | 1 triệu DID + 1 | CappedDrop |
| 7 | Referrer | 343 | 0,95% | = 7³ | CappedDrop |
| 8 | PhoenixKey | 142,857 | 0,40% | = 1/7 (pot lẻ duy nhất) | CappedDrop |
| 9 | MagicLamp Foundation | 1.296 | 3,60% | = 6⁴ = 36² | giữ dạng CHƯA-MINT tới khi lập pháp nhân |
| 10 | Aladin Contract | 6.000 | 16,67% | 1/6 tổng cung | CappedDrop (drip ngang cộng đồng) |
| 11 | GreenSun Tech | 6.000 | 16,67% | 1/6 tổng cung | CappedDrop (drip ngang cộng đồng) |
| 12 | Partnership | 284 | 0,79% | amicable (220–284) | CappedDrop, theo thoả thuận |
| 13 | Early TIGER Deleg | 12 | 0,03% | — | retroactive snapshot |
| 14 | Airdrop | 120 | 0,33% | — | retroactive snapshot |
| 15 | SRCL | 360 | 1,00% | tròn 1% | reward-redirect qua SPO |
| 16 | Joinnet | 1.461 | 4,06% | = Sothic 1461 | CappedDrop |
| 17 | RedBack | 21,143 | 0,06% | = 1/7 (bù lẻ với PhoenixKey) | quỹ phòng-thủ neo giá (peg CARP↔MAGIC) |
| 18 | Liquidity | 888 | 2,47% | — | LP incentive sàn nội bộ (CARP/LAMP·ADA·NIGHT) |

**Kiểm chứng số học:**
- Tổng 18 pot = **36.000 triệu** = 36 tỷ ✓
- Mọi pot trừ Reserve = **26.370 triệu** = 26,37 tỷ = `dist_cap` ✓
- Reserve = **9.630 triệu** = 9,63 tỷ = `reserve_cap` ✓

**Motif "hằng số vũ trụ":** π (Platform), e (Development), φ (App), 7³ (Referrer),
6⁴=36² (Foundation), 1/7 (PhoenixKey + RedBack), Sothic 1461 (Joinnet), amicable
220–284 (Partnership). Đây là lựa chọn thẩm mỹ/Schelling-point, **không phải lời hứa
về giá hay lợi nhuận**.

---

## 3. Giải thích từng pot (ngắn gọn)

- **Reserve (9.630)** — lớp đệm phát hành cuối cùng. Nhả **tối đa 9.630.000 LAMP mỗi epoch**
  (= 1/1000 quỹ Reserve), và **chỉ nhả khi có cầu thật** (demand-gated: cần Treasury "kéo"
  khi lưu thông xuống dưới sàn). **KHÔNG giới hạn số epoch** — quỹ co-giãn theo nhu cầu, không
  phải nhả hết trong một số epoch cố định; không cầu thì không nhả. Vì no-burn, Reserve nhả ra
  là **một chiều** — không quay ngược về trạng thái chưa-mint. Kích hoạt permissionless.
- **Treasury (964)** — sổ điều tiết hai chiều giữa "đang lưu hành" (C) và "đỗ"
  (T). Đây là nơi "giảm lưu hành" thực hiện bằng kế toán, không đốt.
- **Development (2.718)** — quỹ **duy trì & vận hành giao thức mạng lưới**: R&D công nghệ lõi mới + mua app
  truyền thống để tích hợp. **Do DAO quyết, bất kỳ thành viên DAO nào cũng có thể đề xuất tài trợ.** Đây là
  quỹ CHUNG của giao thức, **KHÔNG phải tiền của hai công ty sáng lập**.
- **Platform (3.141)** — thưởng cho nền tảng dùng LAMP, nhả theo MAGIC tiêu thụ.
- **App (1.618)** — khuyến khích ứng dụng xây trên hệ sinh thái.
- **User (1.001)** — **cho mỗi PersonDID mượn ≤1001 LAMP để TIÊU dịch vụ (không tặng, không để mua-bán)**: khoá 1001
  đêm, mở 1 LAMP/đêm; đêm không dùng → thu 1 LAMP phần chưa-mở về pot (use-it-or-lose-it). Chỉ phần đã mở mới chuyển
  nhượng được. Cơ chế: đặc tả PhoenixKey Activation (vault-vesting + anti-idle).
- **Referrer (343)** — thưởng giới thiệu.
- **PhoenixKey (142,857)** — **quỹ Phoenix Treasury**, nguồn tài sản cho **Feecover** (trả phí hộ user).
  Phí mỗi loại giao dịch cố định (quy về CARP); pot này trích **7 triệu LAMP** chạy 1 đợt **SRCL 7 epoch**
  (1 triệu/epoch) thu về ADA trả phí mạng; CARP thu được mua lại ADA trên DEX (vòng tự-bồi). Tự động, không
  người kiểm soát. Gắn hạ tầng PhoenixKey DID. Pot lẻ duy nhất. Chi tiết: `Specs/LAMP-POT-CATALOG.md` #8.
- **MagicLamp Foundation (1.296)** — dành cho **pháp nhân chủ tương lai**. Quỹ này
  **giữ ở dạng CHƯA-MINT** (một dạng khoá tự nhiên) cho tới khi pháp nhân được lập —
  chưa tồn tại on-chain, không thể di chuyển.
- **Aladin Contract / GreenSun Tech (6.000 mỗi bên)** — hai **pháp nhân sáng lập**.
  Mỗi công ty 1/6 tổng cung. Nhả qua **CappedDrop ngang cộng đồng** (xem §4).
- **Partnership (284)** — đối tác chiến lược, theo thoả thuận.
- **Early TIGER Deleg (12)** — ghi nhận người delegate sớm cho TIGER pool. *(Pool
  TIGER đã rút khỏi nhóm sáng lập; chỉ còn hiện diện qua pot ghi nhận này.)*
- **Airdrop (120)** — **dành tặng cộng đồng SPO và Delegator** dựa trên stake + sự hỗ trợ; **ghi nhận đóng góp
  vào cơ chế bền vững của mạng blockchain Cardano**. Qua snapshot hồi tố.
- **SRCL (360)** — Staking Reward Contribution Launch: người stake ADA chuyển hướng phần
  thưởng để nhận LAMP, không bán token trực tiếp.
- **Joinnet (1.461)** — thưởng **người đóng góp tài nguyên thiết bị** (tính toán, lưu trữ, băng thông) vào
  **hạ tầng thiết bị phân tán LampNet**.
- **RedBack (21,143)** — **quỹ hỗ trợ neo giá đồng ổn định** (peg CARP↔MAGIC): hy sinh khi Peg chuyển sang đỏ, lớn
  lên khi tỷ lệ thế chấp vượt quá trần. Vốn vô chủ, không ai rút tay.
- **Liquidity (888)** — **cấp thanh khoản cho sàn giao dịch nội bộ hệ sinh thái** (MagicSwap), bắt đầu với cặp
  **CARP/LAMP, CARP/ADA, CARP/NIGHT**. CARP là đồng chuyển-nhượng duy nhất giao dịch nội bộ; MAGIC KHÔNG chuyển nhượng.

---

## 4. Vì sao đội sáng lập KHÔNG thể "xả" token

Đây là câu hỏi cộng đồng quan tâm nhất, nên trả lời thẳng.

1. **Cùng một cơ chế.** Pot Aladin và GreenSun (mỗi bên 6 tỷ) nhả qua **đúng
   engine CappedDrop** mà pot cộng đồng dùng — không có "đường tắt" riêng cho đội.

2. **Ràng buộc bằng luật on-chain, không bằng lời hứa.** Công thức mở khoá
   `vested(t) = min(E, D · drops_per_epoch · max(0, t − start_epoch))` được hợp đồng
   **kiểm tra mỗi giao dịch**. Một ví không thể rút quá phần đã mở khoá tại epoch
   hiện tại — giao dịch vi phạm bị validator từ chối. Đây không phải cam kết tự
   nguyện; nó là **bất biến on-chain**.

3. **Drip ngang cộng đồng.** Tham số `drops_per_epoch` và `start_epoch` đặt sao cho
   đội sáng lập chảy ra **cùng nhịp** với các pot khác — không có cliff bí mật, không
   có cửa "unlock toàn bộ ngày đầu".

4. **Redeem permissionless = ai cũng giám sát được.** Vì việc rút là công khai và
   không cần xin phép, **bất kỳ ai** cũng đọc on-chain để kiểm chứng đội đã (và chỉ
   có thể) rút đúng phần được phép.

> Hệ quả: kể cả khi đội muốn bán tháo, **on-chain không cho phép** rút nhanh hơn
> lịch nhỏ giọt. Lượng có thể chạm thị trường mỗi epoch bị chặn cứng.

---

## 5. Cam kết pháp lý & lằn đỏ

Văn bản này KHÔNG phải tài liệu chào bán. Để minh bạch:

- **Chưa niêm yết DEX / chưa bán token** cho tới khi có **pháp nhân phát hành hợp
  pháp**. Đội phát hành theo hướng **doanh nghiệp Việt Nam** (Aladin + GreenSun),
  không offshore, để tối đa minh bạch và phù hợp Nghị quyết 05/2025/NQ-CP.
- **Lằn đỏ securities.** Phân loại pháp lý của LAMP (utility/governance so với "tài
  sản ảo") **chưa chốt** — cần ý kiến luật sư trước khi mở bán. Mọi mô tả trong bản
  này về quyền lợi token KHÔNG cấu thành lời mời đầu tư.
- **Không bán LAMP để gây quỹ.** Nguồn thu của hai công ty đến từ vận hành SPO hợp
  pháp (margin SRCL pool, fee TIGER pool) và dịch vụ B2B (gói MAGIC) — KHÔNG từ bán
  token trên sàn.
- **Không hứa giá.** Không có cam kết về giá, lợi nhuận, hay "to the moon". Các con
  số "hằng số vũ trụ" là thẩm mỹ thiết kế, không phải dự phóng tài chính.

---

## 6. Đã on-chain vs còn đang xây (trung thực)

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| Genesis lazy-mint + cap 26,37 / 9,63 tỷ | **Đã code + test** (56 on-chain, 34 off-chain) | trần baked on-chain |
| CappedDrop (claim_account) | **Đã code + test**; engine gốc đã **live Preview** | công thức vested đã chạy |
| Phân bổ per-channel HARD-CAP (Allocation) | **Đã code + test** (61 on-chain, 63 off-chain) | trần 2 lớp mỗi kênh |
| Reserve engine (≤ 9.630.000 LAMP/epoch, demand-gated) | **Đã code + test** (38 on-chain, 22 off-chain) | trần/epoch, không giới hạn số epoch |
| Treasury (C↔T) | **Đang phát triển** | phần collect/release |
| Governance / VotingPower (cá nhân, ≥4 tham số) | **Chỉ có spec, CHƯA có validator** | code dự kiến giai đoạn sau |
| Niêm yết DEX / thanh khoản | **Chưa thực hiện** | chờ pháp nhân + pháp lý |

> Nói thẳng: phần **mint, phân bổ nhỏ giọt, Reserve, trần tổng cung** đã có mã và
> test. Phần **governance đầy đủ** và **niêm yết** còn nằm trên lộ trình.

---

*Hết bản draft. Các điểm cần chủ repo xác nhận liệt kê khi báo cáo — không nằm trong văn bản công khai.*
