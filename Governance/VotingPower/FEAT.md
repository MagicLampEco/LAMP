# Voting Power — FEAT (Đặc tả tính năng / hành vi)

**Trạng thái:** bản thảo 2026-06-05. Bám sát
[CONTRACT.md](./CONTRACT.md) (mô hình đã duyệt). KHÔNG mâu thuẫn contract.
Mọi tham số số học chưa chốt được đánh dấu **"tham số mở (DAO định)"**.

> Spec này mô tả **hành vi nhìn thấy được** của hệ Governance: cử tri là ai, làm gì,
> qua những bước nào. KHÔNG đi sâu công thức (xem MATH) hay datum/redeemer on-chain
> (xem TECH) hay lộ trình build (xem EXEC).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

MagicLamp cần một cơ chế ra quyết định tập thể mà **token đơn thuần không mua được
quyền lực**. Cử tri là **con người** (1 PhoenixKey DID = 1 người thật), không phải số dư
ví. FEAT mô tả toàn bộ vòng đời cử tri và luồng quyết định để một người không-kỹ-thuật
đọc cũng hiểu hệ hoạt động ra sao.

Nguyên lý nền (từ contract §2, KHÔNG vi phạm):

1. **Quyền tham gia ≠ quyền lực.** Ai có DID đều bỏ phiếu được; trọng số phải kiếm.
2. **Chi phí thâu tóm = chi phí đóng góp thật.** Không có đường tắt mua quyền lực.
3. **Token đơn thuần bị vô hiệu hóa** (cap C4 + công thức nhân).
4. **Sybil chết từ gốc** (DID sinh trắc + lịch sử + uy tín + đốt LAMP, bốn lớp khóa nhau).

### 0.2 Thuộc spec này

- Vòng đời cử tri: đăng ký DID → tập sự (VP ≈ 0) → tích lũy quyền lực qua epoch.
- Phân biệt **quyền THAM GIA** và **quyền LỰC**.
- Các loại quyết định và ngưỡng thông qua (thường, siêu đa số, hiến pháp, recall).
- Luồng `proposal → vote → tally → execute`.
- Recall / bãi miễn.
- User story cho từng vai (cử tri mới, cử tri kỳ cựu, hội đồng).

### 0.3 KHÔNG thuộc spec này (thuộc spec khác)

| Chủ đề | Thuộc spec |
|---|---|
| Công thức VP, cap, weight, chứng minh toán | [MATH](./MATH.md) *(chưa viết)* |
| Tính bounded / monotonic / sybil-cost của VP | MATH |
| Datum / redeemer / validator Aiken | [TECH](./TECH.md) *(chưa viết)* |
| Đọc C1–C4 qua reference input, cross-repo data flow | TECH |
| Chống double-vote ở tầng on-chain | TECH |
| Tích hợp zk-proof DID on-chain | TECH |
| Lộ trình build, mốc, test plan, deploy Preview | [EXEC](./EXEC.md) *(chưa viết)* |
| Cơ chế sinh DID sinh trắc, zk-proof "1 người = 1 DID" | backend **PhoenixKey** (ngoài repo LAMP) |

### 0.4 Quan hệ với các tài liệu cũ — CONTRACT là chuẩn, SPEC.md cũ DEPRECATE

Nguồn chuẩn (canonical) của mô hình VP là
[CONTRACT.md](./CONTRACT.md). FEAT bám đúng CONTRACT.

Tồn tại một tài liệu cũ ở cấp trên — `Governance/SPEC.md` — viết công thức
`VP = (C1 × C2 × C3)^(1/3)` (trung bình hình học **không cap**, **thiếu C4**). Công thức đó
**mâu thuẫn CONTRACT** ở hai điểm:

1. **Thiếu cap.** CONTRACT §1 buộc `VP_i = ∏_k min(C_{k,i}, cap_k)^(w_k)` — mỗi tham số bị
   **chặn trần** trước khi nhân. SPEC.md cũ không cap → vốn lớn (C4) hoặc đốt nhiều LAMP (C1)
   có thể kéo VP lên vô hạn, phá đúng nguyên lý "token đơn thuần không mua được quyền lực"
   (CONTRACT §2.3). Cap là cốt lõi chống thâu tóm, không được bỏ.
2. **Thiếu C4 và weight DAO chỉnh.** SPEC.md cũ chỉ có 3 tham số mũ `1/3` cố định; CONTRACT
   buộc **≥ 4 tham số** (gồm C4 = 100 triệu LAMP) và **weight `w_k` do DAO điều chỉnh**.

→ **Quyết định:** công thức trong `Governance/SPEC.md` **bị deprecate**. FEAT/MATH/TECH/EXEC
chỉ bám CONTRACT. Đề nghị anh đánh dấu `Governance/SPEC.md` là lỗi thời (hoặc cập nhật nó trỏ
về CONTRACT) để tránh resume sau hiểu nhầm — **FEAT không tự sửa file cấp trên đó.**

> Ngưỡng **recall** trong SPEC.md cũ (co-sign 200/500 DID, vote 66%/75%) cũng được FEAT
> **chốt lại** ở §3.1 + §6 (xem §6.1). EXEC.md đã ghi sẵn "FEAT cần chốt lại" — FEAT là nơi
> chốt; EXEC phải bám theo §6 này, không bám số cũ của SPEC.md.

---

## 1. Hai loại quyền: THAM GIA và LỰC

Đây là trục phân biệt quan trọng nhất của spec. Lẫn hai loại này là hiểu sai cả hệ.

### 1.1 Quyền THAM GIA (participation)

- **Ai có:** mọi DID PhoenixKey hợp lệ (1 người thật, đã xác thực sinh trắc).
- **Cho phép gì:** tạo proposal (nếu đạt điều kiện tối thiểu — xem §4.2), bỏ phiếu,
  ký tên kiến nghị recall, đọc mọi dữ liệu công khai.
- **Tính chất:** nhị phân — hoặc có DID hoặc không. Không có "nửa quyền tham gia".
- **Người mới có ngay** khi DID được xác nhận on-chain.

### 1.2 Quyền LỰC (voting power, VP)

- **Ai có:** cũng mọi DID — nhưng **độ lớn khác nhau**.
- **Quyết định gì:** lá phiếu của bạn **nặng bao nhiêu** khi đếm (tally).
- **Tính chất:** liên tục, kiếm dần. Người mới VP ≈ 0 (xem §2). VP tính từ ≥ 4 tham số
  (C1–C4) theo công thức **nhân** (geometric) — chi tiết ở MATH/CONTRACT §1.
- **Không mua đứt được:** cap C4 = 100 triệu LAMP chặn vốn; công thức nhân khiến yếu
  một tham số là kéo sụp toàn bộ.

### 1.3 Vì sao tách hai loại — first-principles

Nếu chỉ có "quyền lực" mà không có "quyền tham gia phổ quát" → người mới bị loại hoàn
toàn, hệ thành câu lạc bộ đóng, mất tính dân chủ. Nếu chỉ có "tham gia" mà mọi phiếu nặng
bằng nhau → quay về 1-người-1-phiếu, Sybil + mua DID phá được. Tách hai loại giữ cả
**tính bao trùm** (ai cũng vào được) lẫn **tính chống thâu tóm** (quyền lực phải kiếm).

**Ví dụ minh họa.** Một proposal có 1000 cử tri bỏ phiếu THUẬN, 10 bỏ CHỐNG. Đếm theo
đầu người thì 1000 thắng áp đảo. Nhưng nếu 1000 người kia là DID mới tinh (VP ≈ 0) còn 10
người kia là cử tri kỳ cựu (mỗi người VP lớn), tally theo VP có thể ra kết quả khác. Đây
là cố ý: **đám đông mới không lật được quyết định của những người đã đóng góp thật** — đó
chính là lớp chống Sybil/thuê-người ở tầng hành vi.

---

## 2. Vòng đời cử tri

### 2.1 Sơ đồ trạng thái

```
   (chưa có DID)
        │  đăng ký + xác thực sinh trắc PhoenixKey
        ▼
   [ DID hợp lệ ]  ── tham gia được ngay (vote, ký kiến nghị)
        │
        │  VP ≈ 0 ở thời điểm này
        ▼
   [ TẬP SỰ ]  ── tích lũy C1 (tiêu MAGIC), C2 (cam kết LAMP), C3 (uy tín), C4 (giữ LAMP)
        │           qua nhiều epoch
        ▼
   [ CỬ TRI CÓ TRỌNG SỐ ]  ── VP > 0 đáng kể, lá phiếu bắt đầu có sức nặng
        │
        ├─ tiếp tục đóng góp → VP tăng (tới trần các cap)
        ├─ ngừng đóng góp → C1/C2 trượt khỏi cửa sổ → VP giảm dần (xem §2.4)
        └─ vi phạm / mất uy tín → C3 giảm → VP sụp (công thức nhân)
```

### 2.2 Giai đoạn ĐĂNG KÝ

- Người dùng tạo DID qua PhoenixKey (sinh trắc + zk-proof). Cơ chế này **ngoài repo LAMP**.
- Khi DID xác nhận on-chain, người đó **lập tức có quyền tham gia**.
- VP tại thời điểm này ≈ 0 vì cả C1, C2, C3 đều chưa có lịch sử, C4 có thể nhỏ.

### 2.3 Giai đoạn TẬP SỰ (probation) — VP ≈ 0 là TÍNH NĂNG

Đây là mô hình **thử việc / thực tập**: bạn vào được cửa, nhưng tiếng nói của bạn nhẹ cho
tới khi bạn chứng minh đóng góp.

Cử tri tích lũy bốn tham số (bản chất ở CONTRACT §1):

| | Tham số | Cách tích lũy | Khó mua bằng tiền? |
|---|---|---|---|
| C1 | MAGIC tiêu thụ (cửa sổ quá khứ ~18 epoch) | dùng hệ thật qua thời gian | khó — cần thời gian |
| C2 | LAMP cam kết trong ScheduleGen (cửa sổ tương lai ~24 epoch) | khóa LAMP cho cam kết tương lai | một phần |
| C3 | uy tín cộng đồng (lịch sử quyết định đúng) | bỏ phiếu/đề xuất đúng qua nhiều vòng | rất khó |
| C4 | LAMP nắm giữ hiện tại | giữ LAMP (bị cap 100 triệu) | có — nhưng bị chặn cap |

> Độ dài cửa sổ (~18 / ~24 epoch) là **tham số mở (DAO định)**. Con số ví dụ chỉ để minh họa.

**Vì sao VP ≈ 0 của người mới không phải bug:** nếu người mới có ngay VP lớn, kẻ tấn công
chỉ cần đẻ/mua nhiều DID mới là chiếm hệ. Bắt buộc tích lũy qua thời gian + uy tín khiến chi
phí tấn công = chi phí đóng góp thật (contract §2.2).

### 2.4 Giai đoạn CÓ TRỌNG SỐ và sự SUY GIẢM

- Khi C1–C4 đủ lớn, VP > 0 đáng kể. Lá phiếu bắt đầu có sức nặng trong tally.
- **VP không vĩnh viễn.** C1 và C2 gắn **cửa sổ trượt** (sliding window): ngừng tiêu MAGIC
  thì C1 cũ rơi khỏi cửa sổ 18 epoch → C1 giảm → VP giảm. Đây là cố ý: quyền lực phản ánh
  **đóng góp đang diễn ra**, không phải hào quang quá khứ. (Cơ chế trượt chi tiết ở MATH.)
- C3 (uy tín) có thể giảm khi cử tri **bị recall vì vi phạm** (§6), hoặc theo cơ chế uy tín do
  DAO định. Vì công thức nhân, C3 sụp kéo VP sụp mạnh **— với điều kiện trọng số `w_3` đủ lớn**
  (xem cảnh báo §2.5).

> **CẢNH BÁO thiết kế C3 (herding).** KHÔNG nên định nghĩa C3 theo kiểu "giảm khi bỏ phiếu đi
> ngược kết quả đa số / kết quả cuối". Cách đó tạo **herding** (hùa theo): cử tri sợ mất uy
> tín nên bỏ theo bên đang thắng thay vì theo niềm tin → triệt tiêu phản biện, khuếch đại sai
> lầm tập thể, và biến C3 thành công cụ trừng phạt thiểu số đúng đắn. C3 nên đo **tín nhiệm xã
> hội kiểm chứng được** (CONTRACT §1: "lịch sử quyết định đúng" hiểu theo nghĩa **kết quả
> khách quan về sau**, hoặc chứng thực ngang hàng / không-vi-phạm), KHÔNG đo "có theo đám đông
> không". Định nghĩa C3 cụ thể là **tham số mở (DAO định)** nhưng **phải tránh tín hiệu
> herding** — đây là ràng buộc thiết kế FEAT chốt, MATH bám theo.

**Ví dụ số minh họa (chỉ để hiểu, KHÔNG phải tham số chốt).** Giả sử cử tri A có
C1=80, C2=50, C3=9, C4=60 triệu; cử tri B (cùng vốn LAMP) có C1=80, C2=50, **C3=1**, C4=60
triệu. Vì VP nhân lũy thừa, chênh lệch C3 từ 9 xuống 1 làm VP của B nhỏ hơn A nhiều bậc —
minh họa "yếu một tham số kéo sụp toàn bộ". Con số chỉ minh họa; công thức thật ở MATH.

### 2.5 Điều kiện để "yếu một tham số kéo sụp toàn bộ" thật sự đúng — phụ thuộc `w_k`

Khẳng định "yếu một tham số kéo sụp toàn bộ VP" (CONTRACT §1) **chỉ đúng khi trọng số `w_k`
của tham số đó đủ lớn**. Trong `VP = ∏_k min(C_k, cap_k)^(w_k)`, nếu một `w_k` rất nhỏ (gần 0)
thì tham số `C_k` dù tụt về gần 0 cũng **không** kéo VP sụp đáng kể — số mũ nhỏ làm hiệu ứng
mờ đi.

→ **Ràng buộc thiết kế FEAT chốt (MATH/DAO bám theo):** muốn cơ chế chống thâu tóm và cơ chế
phạt-uy-tín-qua-C3 có hiệu lực, **`w_3` (và các trọng số của tham số "khó mua bằng tiền") phải
đủ lớn** so với `w_4` (trọng số C4 — vốn). Nếu DAO vô tình đặt `w_3 → 0`, thì C3 tụt không còn
kéo VP sụp, và "token đơn thuần bị vô hiệu hóa" **mất hiệu lực**. Các con số `w_k` là **tham
số mở (DAO định)**, nhưng **quan hệ `w_3` (uy tín) không được lép vế so với `w_4` (vốn)** là
ràng buộc bản chất — không phải con số tự do tuyệt đối. MATH cần chứng minh cận: với khoảng
`w_k` nào thì tính chất "kéo sụp" và "sybil-cost" còn giữ.

---

## 3. Các loại quyết định và ngưỡng thông qua

DAO ra nhiều loại quyết định với mức hệ trọng khác nhau. Quyết định càng khó đảo ngược,
ngưỡng càng cao. **Ngưỡng thông qua đếm theo tổng VP** của phiếu hợp lệ (chống đám đông Sybil
lật người đóng góp thật). Nhưng **quorum dùng hàng rào hai trục** — vừa theo VP vừa theo đầu
người — vì quorum chỉ-theo-VP là bề mặt tấn công (§3.3).

### 3.1 Bảng loại quyết định

| Loại | Ví dụ nội dung | Ngưỡng thông qua (theo VP) | Quorum (hai trục — xem §3.3) |
|---|---|---|---|
| **Thường** | chỉnh tham số nhỏ, chi tiêu ngân quỹ nhỏ, lịch trình vận hành | **> 1/2** tổng VP THUẬN | (a) **≥ Q_người** cử tri có-trọng-số tham gia **VÀ** (b) **≥ Q_VP%** tổng VP lưu hành tham gia — mức **mở (DAO định)** |
| **Siêu đa số** | chỉnh weight/cap VP, nâng cấp validator, chi tiêu lớn | **≥ 2/3** tổng VP THUẬN | như trên, **Q_người và Q_VP% cao hơn** (DAO định) |
| **Hiến pháp** | đổi 4 nguyên lý nền, đổi mô hình VP, đổi cap C4 | **≥ 3/4** tổng VP THUẬN | cao nhất; **+ hai vòng cách nhau N epoch** cho đổi cap C4 (§3.5) |
| **Recall / bãi miễn** | gỡ một thành viên hội đồng / khóa VP một cử tri lạm dụng | **≥ 2/3** tổng VP THUẬN (xem §6) | khởi xướng **theo đầu người** + quorum hai trục (§6.1) |

Trong đó (đều là **tham số mở (DAO định)** về con số, nhưng **chốt về bản chất**):

- **Q_người** = số tối thiểu **cử tri có-trọng-số** (VP > một mức sàn) phải tham gia. Đếm theo
  **đầu người DID**, không theo VP. Chặn trường hợp 2–3 cử tri VP khổng lồ tự đạt quorum.
- **Q_VP%** = phần trăm tối thiểu **tổng VP đang lưu hành** phải tham gia. Chặn trường hợp đông
  người nhưng toàn VP≈0, hệ thiếu chính danh thực chất.

Vòng bỏ phiếu hợp lệ chỉ khi **cả hai** điều kiện quorum đạt. Cử tri tập sự (VP≈0) **không**
tính vào Q_người (vì Q_người đếm cử tri có-trọng-số) — xử lý câu hỏi treo §10 mục 6.

> Ranh giới phân loại (nội dung nào là "thường" vs "siêu đa số" vs "hiến pháp") là
> **tham số mở (DAO định)** — cần một bảng phân loại chính thức do DAO chốt.

### 3.2 Vì sao ghi "≥ 2/3" (đạt-hoặc-vượt), KHÔNG ghi "> 2/3"

Đây là điểm thiết kế then chốt. Nếu yêu cầu **> 2/3** (vượt hẳn) thì một liên minh nắm
**đúng 1/3** tổng VP có thể **veto** mọi quyết định tầng siêu đa số: chỉ cần họ giữ phiếu
CHỐNG hoặc không vote, bên THUẬN không bao giờ chạm mốc "vượt 2/3".

Ghi **≥ 2/3** (đạt là đủ) khiến nhóm 1/3 **không tự động veto được**: khi bên THUẬN gom
đúng 2/3 tổng VP, quyết định qua. Tương tự **≥ 3/4** cho hiến pháp: nhóm 1/4 không veto
được tầng 3/4.

**Ví dụ số minh họa.** Tổng VP hợp lệ = 300 đơn vị. Một liên minh nắm 100 đơn vị (đúng 1/3).
- Với luật "> 2/3" (cần > 200): bên còn lại tối đa gom 200, không vượt 200 → **bị veto bởi 1/3**.
- Với luật "≥ 2/3" (cần ≥ 200): bên còn lại gom đúng 200 → **đạt mốc, quyết định qua**.

Đây đúng là mục tiêu: team 1/3 không được quyền phủ quyết tầng 2/3.

### 3.3 Quorum — vì sao cần HAI trục, không chỉ theo VP

Ngưỡng tỉ lệ chưa đủ. Nếu chỉ 3 người vote và 2 người (VP lớn) THUẬN, "≥ 2/3" đạt nhưng
quyết định thiếu chính danh.

**Quorum chỉ-theo-VP là bề mặt tấn công.** Nếu quorum chỉ đòi "đủ tổng VP tham gia", một
nhóm rất ít người nhưng VP khổng lồ (vài cử tri kỳ cựu cấu kết) tự đạt quorum và thông qua
quyết định mà phần đông cộng đồng không hề tham gia — đúng kịch bản "câu lạc bộ đóng" mà
nguyên lý §1.3 phải tránh. Ngược lại, quorum chỉ-theo-đầu-người lại bị đám đông VP≈0 đẩy đạt.

→ **Quyết định: quorum dùng hai trục, phải đạt CẢ HAI:**

1. **Trục đầu người (Q_người):** ≥ một số tối thiểu **cử tri có-trọng-số** (VP > sàn) tham gia.
   Bảo đảm bề rộng — không để 2–3 cá nhân tự quyết.
2. **Trục VP (Q_VP%):** ≥ một phần trăm tối thiểu **tổng VP lưu hành** tham gia. Bảo đảm chiều
   sâu — không để đám đông tập sự đẩy quorum hình thức.

Mức **Q_người** và **Q_VP%** cho từng loại quyết định là **tham số mở (DAO định)** về con số;
nhưng **yêu cầu phải-đạt-cả-hai-trục đã chốt** trong FEAT (chống bề mặt tấn công). Cử tri tập
sự không tính vào Q_người (§3.1).

### 3.4 Xử lý phiếu TRẮNG — chốt bản chất, để DAO chọn mẫu số

Phiếu TRẮNG (abstain) là **tín hiệu "tham gia nhưng không nghiêng bên nào"**, khác hẳn
không-vote. FEAT chốt **bản chất** sau (con số/lựa chọn cuối để DAO định):

- TRẮNG **tính vào quorum** (cả Q_người nếu là cử tri có-trọng-số, và Q_VP%) — vì người đó
  **đã tham gia**, thể hiện hệ có chính danh.
- TRẮNG **không** tính vào VP THUẬN.
- **Mẫu số ngưỡng**: DAO chọn **một trong hai**, và phải khai báo công khai cho từng loại:
  - **(M1) THUẬN / (THUẬN + CHỐNG)** — TRẮNG trung lập hoàn toàn, không ngầm thành CHỐNG.
  - **(M2) THUẬN / (tổng VP tham gia, gồm TRẮNG)** — TRẮNG ngầm thành lực cản (gần như CHỐNG).

  FEAT **không tự chốt M1 hay M2** (đây là **tham số mở (DAO định)**), nhưng chốt rằng **mẫu
  số phải nhất quán, công khai trước khi mở vote**, không đổi giữa chừng (chống thao túng kết
  quả bằng cách diễn giải lại TRẮNG sau tally). Khuyến nghị mặc định **M1** cho tầng thường để
  TRẮNG đúng nghĩa trung lập; cân nhắc **M2** cho tầng hiến pháp (đổi cap C4) để quyết định
  hệ trọng cần đa số chủ động rõ ràng.

### 3.5 Hai vòng cho quyết định đổi cap C4 (chống thâu tóm cốt lõi)

Cap C4 = 100 triệu LAMP là **tham số chống thâu tóm cốt lõi** (CONTRACT §2.3). Một proposal
hiến pháp đổi cap C4 phải qua **hai vòng bỏ phiếu cách nhau N epoch** (N là **tham số mở
(DAO định)**), mỗi vòng đều **≥ 3/4** tổng VP THUẬN + quorum hiến pháp. Lý do: nếu một liên
minh tạm chiếm đủ VP trong một vòng, khoảng cách N epoch cho cộng đồng phát hiện và phản ứng
(rời hệ, recall, huy động cử tri) trước khi cap bị nới — phòng thủ chiều sâu cho đúng thông số
giữ "token không mua được quyền lực". Xử lý câu hỏi treo §10 mục 4.

---

## 4. Luồng: proposal → vote → tally → execute

### 4.1 Sơ đồ luồng

```
[ Soạn proposal ] → [ Đệ trình on-chain ] → [ Thảo luận / cooldown ]
        → [ Cửa sổ bỏ phiếu mở ] → [ Tally (đếm theo VP) ]
        → đạt ngưỡng + quorum? ──yes──→ [ Hàng đợi thực thi (timelock) ] → [ Execute ]
                                  └──no───→ [ Bác bỏ / lưu lịch sử ]
```

### 4.2 Bước SOẠN và ĐỆ TRÌNH proposal

- Người đề xuất phải có DID hợp lệ (quyền tham gia).
- **Có thể** đặt **điều kiện đề xuất tối thiểu** (ví dụ: VP ≥ một mức, hoặc đặt cọc LAMP
  chống spam) — mức cụ thể là **tham số mở (DAO định)**. Đặt cọc bị tịch thu nếu proposal
  bị đánh giá spam/ác ý, hoàn lại nếu hợp lệ (chi tiết cơ chế ở TECH).
- Proposal khai báo rõ: **loại quyết định** (§3), nội dung thực thi, tham số liên quan.

### 4.3 Bước THẢO LUẬN / COOLDOWN

- Giữa lúc đệ trình và lúc mở bỏ phiếu có khoảng **cooldown** để cộng đồng đọc, phản biện.
  Tránh proposal "đánh úp" bỏ phiếu tức thì. Độ dài cooldown là **tham số mở (DAO định)**.

### 4.4 Bước BỎ PHIẾU

- Cửa sổ bỏ phiếu mở trong số epoch cố định (**tham số mở (DAO định)**).
- Mỗi DID bỏ **một** phiếu cho proposal đó (THUẬN / CHỐNG / TRẮNG). Chống double-vote ở
  tầng on-chain — thuộc TECH.
- **VP được "chốt ảnh" (snapshot)** để không ai thao túng VP giữa chừng (mua LAMP ngay trước
  tally). FEAT **chốt hai mốc snapshot khác nhau cho hai nhóm tham số**, vì rủi ro thao túng
  của chúng khác nhau:

  - **C1, C2, C3** (engagement quá khứ, cam kết tương lai, uy tín): chốt tại **mốc MỞ vote**.
    Các tham số này tích lũy chậm qua nhiều epoch, không mua đột ngột được, nên chốt ở mốc mở
    vote là đủ và đơn giản.
  - **C4** (LAMP nắm giữ hiện tại — **mua được tức thì bằng tiền**): chốt **SỚM hơn**, tại
    **mốc ĐỆ TRÌNH proposal** (đầu cooldown), KHÔNG đợi tới mốc mở vote. Lý do: nếu chốt C4 ở
    mốc mở vote, kẻ tấn công thấy proposal nhạy cảm rồi **mua LAMP trong cooldown** để đẩy C4
    (tới cap) ngay trước khi vote. Chốt C4 ở mốc đệ trình khử được cửa sổ mua-gấp này. (Dù C4
    đã bị cap 100 triệu, vẫn không nên để mua-gấp đẩy một ví từ thấp lên cap đúng lúc vote.)

  Quy ước trên **nhất quán với §2.4**: VP suy giảm theo cửa sổ trượt là quy luật dài hạn giữa
  các vòng; còn **trong một vòng bỏ phiếu**, VP của mỗi cử tri **đông cứng tại các mốc
  snapshot trên** — không có mâu thuẫn "VP đang diễn ra" vs "VP chốt ảnh": chốt ảnh chỉ áp cho
  phạm vi một vòng vote, suy giảm áp cho trục thời gian dài. Mốc snapshot cụ thể (đệ trình /
  mở vote) đã chốt; các tham số phụ là **tham số mở (DAO định)**; cơ chế snapshot ở TECH.

### 4.5 Bước TALLY (đếm)

- Cộng **tổng VP** của các phiếu THUẬN, CHỐNG, TRẮNG riêng.
- Kiểm tra **quorum hai trục** (§3.3): đạt **cả** Q_người (số cử tri có-trọng-số tham gia) và
  Q_VP% (phần trăm tổng VP lưu hành tham gia).
- So tỉ lệ THUẬN với **ngưỡng loại quyết định** (§3.1), dùng **≥** cho tầng 2/3 và 3/4.
- Phiếu TRẮNG tính vào quorum nhưng **không** tính THUẬN. Mẫu số ngưỡng (M1 hay M2) theo §3.4
  — DAO chọn, nhưng **phải công khai trước khi mở vote và không đổi giữa chừng**.

### 4.6 Bước EXECUTE (thực thi) + TIMELOCK

- Proposal đạt ngưỡng KHÔNG thực thi tức thì. Nó vào **hàng đợi timelock** (khoảng chờ bắt
  buộc) trước khi hiệu lực. Lý do: cho cộng đồng thời gian phản ứng nếu một quyết định độc
  hại lọt qua (rời hệ thống, chuẩn bị recall). Độ dài timelock là **tham số mở (DAO định)**.
- Hết timelock, hành động được kích hoạt on-chain (chi tiết cơ chế ở TECH).
- Proposal **không đạt** được lưu vào lịch sử (phục vụ C3 — uy tín dựa lịch sử quyết định).

---

## 5. Hội đồng (council) — vai trò và giới hạn

> Hội đồng là **tùy chọn thiết kế**; mô hình lõi vẫn là DAO trực tiếp theo VP. Nếu DAO chọn
> có hội đồng, FEAT mô tả hành vi dưới đây. Việc **có hay không có** hội đồng là
> **tham số mở (DAO định)**.

- Hội đồng là một nhóm nhỏ cử tri được bầu, lo việc **vận hành nhanh** (ví dụ duyệt chi
  tiêu nhỏ trong hạn mức, lên lịch proposal, phản ứng khẩn cấp).
- **Giới hạn quyền:** hội đồng KHÔNG được tự đổi mô hình VP, cap, weight, hay 4 nguyên lý —
  những việc đó luôn cần bỏ phiếu toàn DAO ở tầng siêu đa số / hiến pháp.
- **Hội đồng bị giám sát bằng recall** (§6): cử tri có thể bãi miễn thành viên hội đồng.
- Cách bầu hội đồng, nhiệm kỳ, hạn mức chi tiêu là **tham số mở (DAO định)**.

---

## 6. Recall / bãi miễn

Recall là van an toàn: khi một thành viên hội đồng hoặc một cử tri **vi phạm / lạm dụng quyền
lực**, cộng đồng gỡ quyền của họ.

### 6.0 Recall CHỈ cho vi phạm — KHÔNG cho liên minh hợp pháp

Đây là ranh giới quan trọng nhất của recall, chốt rõ để tránh biến recall thành vũ khí thanh
trừng phe đối lập:

- **Recall áp cho HÀNH VI VI PHẠM cụ thể, kiểm chứng được**, ví dụ: thành viên hội đồng tiêu
  vượt hạn mức được giao, ký giao dịch ngoài thẩm quyền, một DID bị chứng minh là giả mạo
  sinh trắc, hoặc một thực thể điều khiển nhiều DID **vi phạm luật DAO** (không phải chỉ vì
  cùng bỏ phiếu một hướng).
- **Recall KHÔNG áp cho "liên minh hợp pháp".** Nhiều cử tri thật cùng quan điểm, cùng bỏ
  phiếu một hướng là **dân chủ bình thường**, KHÔNG phải lý do recall. CONTRACT §2.2 nói hành
  vi cùng phục vụ một thực thể là "lộ thiên on-chain" — nhưng *lộ thiên* nghĩa là **cộng đồng
  thấy để phản biện và huy động phiếu đối trọng**, KHÔNG mặc nhiên nghĩa "đủ căn cứ recall".
  Recall một nhóm chỉ vì họ bỏ phiếu khác mình = đa số đè thiểu số, phá tính bao trùm (§1.3).
- **Proposal recall phải nêu cáo buộc vi phạm cụ thể** (hành vi gì, bằng chứng on-chain nào).
  Recall không nêu được vi phạm cụ thể → cộng đồng nên bác ngay từ vòng phản biện.

### 6.1 Luồng recall

```
[ Kiến nghị recall ]  ── cần số chữ ký DID tối thiểu (theo ĐẦU NGƯỜI) + đặt cọc LAMP khởi xướng
        → [ Cooldown / phản biện ]  ── nêu cáo buộc vi phạm cụ thể (§6.0)
        → [ Bỏ phiếu recall ]  ── ngưỡng ≥ 2/3 tổng VP THUẬN
        → đạt? ──yes──→ [ Gỡ vai trò / khóa-giảm VP đối tượng ] + hoàn cọc người khởi xướng
                  └──no──→ [ Bác, lưu lịch sử ] + TỊCH THU cọc nếu kiến nghị bị đánh giá quấy rối
```

- **Ngưỡng khởi xướng** (bao nhiêu DID phải ký để mở vote recall) đếm theo **đầu người DID**
  (chống một cá nhân VP-lớn tự khởi xướng recall đối thủ). Con số là **tham số mở (DAO định)**.
- **Đặt cọc LAMP khi khởi xướng:** người mở kiến nghị recall phải **khóa một khoản cọc LAMP**
  (mức **mở (DAO định)**). Hoàn lại nếu recall đạt hoặc được đánh giá thiện chí; **tịch thu**
  nếu bị đánh giá quấy rối/ác ý. Cọc đặt chi phí thật lên việc khởi xướng → chống grinding (mở
  hàng loạt recall rác).
- **Ngưỡng thông qua recall = ≥ 2/3 tổng VP THUẬN** (dùng **≥**, lý do như §3.2). FEAT **chốt
  con số này**; nó **thay thế** các số cũ rải rác (SPEC.md cũ ghi vote 66%/75% + co-sign
  200/500 DID — xem §0.4): **một** ngưỡng vote duy nhất **≥ 2/3** cho mọi recall, và co-sign
  khởi xướng theo đầu người (con số DAO định, không chốt cứng 200/500). EXEC.md/SPEC.md phải
  bám §6 này.
- **Quyết định cuối đếm theo VP** (chống đám đông Sybil lật người đóng góp thật); **khởi
  xướng đếm theo đầu người** (chống VP-lớn đơn lẻ tự mở recall đối thủ).
- Hệ quả khi recall đạt: gỡ vai trò hội đồng và/hoặc **giảm/khóa VP** đối tượng (ví dụ hạ C3
  về mức phạt). Hệ quả cụ thể là **tham số mở (DAO định)**; cơ chế on-chain ở TECH.

### 6.2 Chống lạm dụng + chống GRINDING recall song song

Cooldown một mình **không** chặn grinding: kẻ tấn công có thể mở **nhiều recall song song**
nhằm cùng một đối tượng (hoặc nhằm nhiều người đóng góp thật cùng lúc) để bào mòn, làm loãng
sự chú ý của cộng đồng, hoặc ép đối tượng liên tục tự bảo vệ. FEAT chốt các van sau:

- **Trần recall đồng thời theo đối tượng:** mỗi DID/ghế hội đồng chỉ có **tối đa một** kiến
  nghị recall **đang mở** tại một thời điểm. Kiến nghị thứ hai nhằm cùng đối tượng bị từ chối
  cho tới khi cái đang mở kết thúc.
- **Trần recall đồng thời theo người khởi xướng:** một DID chỉ được giữ **tối đa K** kiến nghị
  recall đang mở cùng lúc (K nhỏ, **tham số mở (DAO định)**) → chặn một người rải recall hàng
  loạt.
- **Trần recall đồng thời toàn hệ** (tùy chọn, DAO định): giới hạn tổng số recall mở song song
  để cộng đồng không bị quá tải.
- **Đặt cọc LAMP khởi xướng** (§6.1): mỗi kiến nghị tốn cọc → mở N recall song song tốn N cọc,
  cọc bị tịch thu nếu quấy rối. Đây là van kinh tế cốt lõi chống grinding.
- **Thời gian miễn sau recall thất bại:** một DID vừa qua một recall **thất bại** được **miễn**
  bị recall lại trong một khoảng (**tham số mở (DAO định)**) → không thể recall liên tục một
  người tới khi "trúng".

---

## 7. User story theo vai

### 7.1 Cử tri MỚI (Mai — vừa tạo DID)

- Mai xác thực sinh trắc, có DID. Cô **bỏ phiếu được ngay** cho một proposal đang mở.
- Phiếu của Mai **gần như không có sức nặng** (VP ≈ 0) vì cô chưa có C1/C2/C3.
- Mai bắt đầu **dùng MAGIC thật** (tích C1), **cam kết LAMP qua ScheduleGen** (tích C2), và
  **tham gia có trách nhiệm** qua nhiều vòng để xây C3 (uy tín đo bằng tín nhiệm xã hội /
  không-vi-phạm, KHÔNG phải "bỏ theo đa số" — §2.4). Sau nhiều epoch, VP của Mai lớn dần.
- *Cảm nhận đúng:* "Tôi được tham gia ngay, nhưng tiếng nói nặng dần khi tôi đóng góp thật."

### 7.2 Cử tri KỲ CỰU (Bình — 2 năm trong hệ)

- Bình có C1 cao (tiêu MAGIC đều), C2 cao (cam kết LAMP dài hạn), C3 cao (tín nhiệm cộng đồng,
  không vi phạm), C4 chạm gần cap. VP của Bình lớn.
- Bình **soạn proposal** siêu đa số (đổi một weight VP), đặt cọc LAMP, qua cooldown.
- Nếu Bình **ngừng hoạt động** vài epoch, C1/C2 trượt khỏi cửa sổ → VP giảm. Quyền lực của
  Bình phản ánh đóng góp **đang diễn ra**, không phải quá khứ.
- *Cảm nhận đúng:* "Quyền lực tôi kiếm được là thật, nhưng phải tiếp tục nuôi hệ mới giữ."

### 7.3 HỘI ĐỒNG (nhóm vận hành)

- Hội đồng duyệt nhanh một khoản chi nhỏ trong hạn mức — không cần vòng bỏ phiếu toàn DAO.
- Khi cần đổi cap C4, hội đồng **không tự quyết**: phải đưa ra bỏ phiếu hiến pháp (≥ 3/4).
- Nếu một thành viên hội đồng lạm quyền, cộng đồng **khởi xướng recall** (§6) và gỡ họ.
- *Cảm nhận đúng:* "Chúng tôi vận hành nhanh việc nhỏ, nhưng mọi việc lớn vẫn thuộc DAO, và
  chúng tôi bị giám sát bằng recall."

### 7.4 KẺ TẤN CÔNG (Cường — muốn thâu tóm)

- Cường giàu, mua 12 tỷ LAMP. Nhưng cap C4 = 100 triệu → Cường chỉ được tính như **một cử
  tri 100 triệu**. Muốn dùng hết, phải chia cho ~120 DID người-thật, mỗi DID cần lịch sử +
  uy tín + đốt LAMP (contract §2.3).
- Cường thuê 120 người vote hộ. Để 120 người đó có VP thật, Cường phải khiến họ **đóng góp
  thật** bằng đúng giá trị thu được — và hành vi cùng phục vụ một thực thể **lộ thiên
  on-chain**, cộng đồng phát hiện, **huy động phiếu đối trọng**, và nếu nhóm này **vi phạm
  luật DAO** (không chỉ vì bỏ phiếu cùng hướng — §6.0) thì có thể **recall**.
- *Kết quả đúng:* "Không có đường tắt. Chi phí thâu tóm = chi phí đóng góp thật."

---

## 8. Tham số mở (DAO định)

Các **con số** sau **chưa chốt** — DAO quyết, FEAT chỉ đánh dấu vị trí. Lưu ý phân biệt:
nhiều **bản chất/ràng buộc đã chốt trong FEAT** (đánh dấu rõ ở mục tương ứng); chỉ **con số**
là mở.

- Cap từng tham số C1, C2, C3 (C4 = 100 triệu LAMP đã chốt ở contract); weight `w_k` — **với
  ràng buộc đã chốt: `w_3` (uy tín) không lép vế `w_4` (vốn), §2.5**.
- Độ dài cửa sổ trượt C1 (~18 epoch ví dụ) và C2 (~24 epoch ví dụ).
- Bảng phân loại quyết định (nội dung nào thuộc thường / siêu đa số / hiến pháp).
- **Con số** quorum: Q_người và Q_VP% cho từng loại (**bản chất "hai trục, đạt cả hai" đã chốt
  §3.3**).
- **Con số** mẫu số TRẮNG: chọn M1 hay M2 cho từng loại (**bản chất "TRẮNG vào quorum, không
  vào THUẬN, mẫu số công khai trước và bất biến" đã chốt §3.4**).
- Điều kiện tối thiểu để đề xuất proposal (VP tối thiểu và/hoặc đặt cọc LAMP).
- Độ dài cooldown, cửa sổ bỏ phiếu, timelock thực thi; **N epoch giữa hai vòng đổi cap C4**
  (**bản chất "hai vòng" đã chốt §3.5**).
- **Con số** các mốc snapshot (**bản chất đã chốt §4.4: C1/C2/C3 chốt mốc mở vote, C4 chốt
  sớm tại mốc đệ trình**).
- Có hay không có hội đồng; cách bầu, nhiệm kỳ, hạn mức chi tiêu hội đồng.
- **Con số** recall: ngưỡng khởi xướng (số chữ ký DID, đầu người), mức cọc LAMP, trần K recall
  song song/người, hệ quả khi đạt, thời gian miễn (**bản chất đã chốt §6: vote ≥ 2/3 VP, khởi
  xướng theo đầu người + cọc, trần đồng thời, recall chỉ cho vi phạm**).
- Định nghĩa C3 cụ thể (**ràng buộc đã chốt §2.4: phải tránh tín hiệu herding**).

## 9. Phụ thuộc

- **PhoenixKey DID sinh trắc + zk-proof "1 DID = 1 người thật"** — backend PhoenixKey,
  ngoài repo LAMP. **Blocker tiên quyết:** Governance không chạy thật trước khi có DID proof
  on-chain (contract §3).
- **C1 (MAGIC tiêu thụ)** và **C2 (ScheduleGen)**: đọc từ repo **MAGIC** qua reference input.
- **C4 (LAMP nắm giữ)**: đọc từ repo **LAMP**.
- Công thức VP, tính chất toán: **MATH**.
- Datum/redeemer, snapshot, chống double-vote, đọc C1–C4 on-chain, timelock: **TECH**.
- Lộ trình build, mốc, test plan: **EXEC**.

## 10. Câu hỏi còn treo

> Nhiều câu hỏi treo cũ đã được audit yêu cầu **chốt bản chất**; phần dưới ghi rõ cái nào FEAT
> đã chốt (chỉ còn con số cho DAO) và cái nào còn thực sự mở.

1. **Mẫu số ngưỡng (TRẮNG):** **bản chất đã chốt §3.4** (TRẮNG vào quorum, không vào THUẬN, mẫu
   số M1/M2 công khai trước và bất biến). Còn mở: DAO chọn M1 hay M2 cho từng loại.
2. **VP biến động trong cửa sổ vote:** **đã chốt §4.4** — C1/C2/C3 chốt mốc mở vote; C4 (mua
   được tức thì) chốt **sớm** tại mốc đệ trình. Không còn để mở chiều "chốt mốc đóng vote" vì
   nó mở cửa mua-gấp.
3. **Recall đối tượng VP rất lớn:** **còn mở** (chuyển sang MATH/CONTRACT). Nếu một DID VP áp
   đảo (gần tự đạt 1/3) thì ngưỡng recall ≥ 2/3 khó khả thi → cân nhắc **trần VP tối đa cho
   một DID** (khác cap C4). FEAT nêu vấn đề; con số/cơ chế trần thuộc MATH + CONTRACT (vì đụng
   mô hình VP). **Đề nghị anh quyết có thêm trần-VP-mỗi-DID vào CONTRACT không.**
4. **Hiến pháp đổi cap C4:** **đã chốt §3.5** — bắt buộc **hai vòng cách nhau N epoch**, mỗi
   vòng ≥ 3/4. Còn mở: con số N.
5. **Quyền tham gia của DID đã bị recall:** **còn mở**. Khuyến nghị FEAT: recall **giảm/khóa
   VP và gỡ vai trò**, KHÔNG xóa quyền tham gia cơ bản (vote với VP đã hạ), để giữ nguyên lý
   "ai có DID đều tham gia" (§1.1) — trừ trường hợp DID bị chứng minh **giả mạo sinh trắc** thì
   mất hẳn tư cách. Chốt cuối là **tham số mở (DAO định)**.
6. **Tính phiếu cử tri tập sự (VP ≈ 0) vào quorum:** **đã xử lý §3.1/§3.3** — tập sự **không**
   tính vào trục Q_người (đếm cử tri có-trọng-số), VP≈0 gần như không cộng vào Q_VP%. Vậy đám
   đông tập sự **không** tự đẩy quorum đạt; đây là hành vi mong muốn (chống đám đông mới lật
   người đóng góp thật, §1.3).

## 11. Cơ sở toán học & tham chiếu

FEAT mô tả hành vi; **cơ sở toán** của mọi con số nằm ở [MATH](./MATH.md) và phần "Đánh giá mô hình"
trong [../SPEC.md](../SPEC.md). Tóm các neo lý thuyết cho các khái niệm dùng ở trên:

- **Voting Power = hàm Cobb–Douglas có cap** (`∏_k min(C_k,cap_k)^{w_k}`): dạng hàm bổ trợ nhiều
  đầu vào — [Cobb–Douglas](https://en.wikipedia.org/wiki/Cobb%E2%80%93Douglas_production_function);
  vì sao nhân chứ không cộng: [AM–GM](https://en.wikipedia.org/wiki/AM%E2%80%93GM_inequality),
  [weighted geometric mean](https://en.wikipedia.org/wiki/Weighted_geometric_mean);
  cap = [diminishing returns](https://en.wikipedia.org/wiki/Diminishing_returns).
- **Token đơn thuần không cầm quyền** (vì sao bỏ "1 token = 1 phiếu"):
  [Buterin — Moving beyond coin voting](https://vitalik.eth.limo/general/2021/08/16/voting3.html).
- **Cử tri = 1 người thật (DID sinh trắc)**:
  [proof of personhood](https://en.wikipedia.org/wiki/Proof_of_personhood);
  chống [Sybil attack — Douceur 2002](https://www.microsoft.com/en-us/research/publication/the-sybil-attack/);
  nền tảng danh tính + uy tín soulbound:
  [DeSoc — Weyl, Ohlhaver, Buterin](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4105763).
- **Ngưỡng siêu đa số / "≥2/3"**: [supermajority](https://en.wikipedia.org/wiki/Supermajority);
  bối cảnh quản trị on-chain Cardano: [CIP-1694](https://cips.cardano.org/cip/CIP-1694).
- **Quorum & nghịch lý cử tri thờ ơ** (vì sao tách trục đầu-người và trục VP):
  [voter turnout / apathy](https://en.wikipedia.org/wiki/Voter_apathy).

---

## Phản hồi audit (2026-06-05)

Bản FEAT này áp dụng 6 finding audit. Tóm tắt cách xử lý + chỗ cần anh/đồng đội theo tiếp:

- **F1 (recall ngưỡng — major):** FEAT **chốt** một ngưỡng recall duy nhất **≥ 2/3 tổng VP
  THUẬN** (vote) + khởi xướng **theo đầu người** (§3.1, §6.1). Số cũ rải rác trong `SPEC.md`
  cũ (vote 66%/75%, co-sign 200/500 DID) **bị thay thế**. **Cần anh duyệt sửa `EXEC.md` +
  `SPEC.md`** bám §6 (EXEC.md dòng 266/287 đã tự ghi "FEAT cần chốt lại" → khớp).
- **F2 (xung đột công thức VP — major):** thêm **§0.4** — CONTRACT là chuẩn; công thức
  `(C1×C2×C3)^(1/3)` không-cap trong `Governance/SPEC.md` cũ **mâu thuẫn CONTRACT** (thiếu cap
  + thiếu C4 + thiếu weight DAO) → **đề nghị anh deprecate `SPEC.md`** (FEAT không tự sửa file
  cấp trên).
- **F3 (grinding recall — major):** thêm **trần recall đồng thời** (theo đối tượng / theo
  người khởi xướng / toàn hệ) + **đặt cọc LAMP khi khởi xướng** (tịch thu nếu quấy rối) +
  thời gian miễn sau recall thất bại (§6.1, §6.2).
- **F4 (quorum/TRẮNG/tập sự là bề mặt tấn công — major):** chốt **quorum hai trục** (Q_người
  theo đầu người **và** Q_VP% theo VP, đạt cả hai — §3.1, §3.3); chốt **bản chất xử lý TRẮNG**
  (§3.4); chốt **tập sự không vào Q_người** (§3.1, §10 mục 6). Ngưỡng thông qua vẫn theo VP.
- **F5 (snapshot VP mâu thuẫn — major):** chốt **§4.4** — C1/C2/C3 snapshot tại mốc mở vote;
  **C4 snapshot sớm** tại mốc đệ trình (chống mua LAMP đẩy C4 trong cooldown). Làm rõ không
  mâu thuẫn §2.4 (suy giảm dài hạn vs chốt-ảnh trong một vòng).
- **F6 (C3 herding / recall liên minh / kéo-sụp phụ thuộc w_3 — minor):** thêm **cảnh báo
  chống herding cho C3** (§2.4) + ràng buộc **`w_3` không lép vế `w_4`** để hiệu ứng kéo-sụp
  thật sự đúng (§2.5); chốt **recall chỉ cho vi phạm cụ thể, KHÔNG cho liên minh hợp pháp**
  (§6.0).

**Không bỏ qua finding nào** — cả 6 đều được áp dụng. Hai điểm cần anh quyết tiếp ngoài phạm vi
FEAT: (a) deprecate/cập nhật `Governance/SPEC.md`; (b) có thêm **trần VP tối đa cho một DID**
vào CONTRACT/MATH hay không (§10 mục 3).
