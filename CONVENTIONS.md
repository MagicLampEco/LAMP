# Quy ước tài liệu — repo LAMP

> Nguồn chuẩn: **StandardSpec** (`R&D Spec Standards`, MagicLamp ecosystem). File này chỉ ghi phần
> **áp dụng cho repo LAMP** — không lặp lại nội dung chuẩn. Khi mâu thuẫn, StandardSpec đúng.

---

## 1. Điều quan trọng nhất: Spec ≠ Paper

Đây là phân biệt nền của StandardSpec, và LAMP trước đây làm ngược.

| | **Spec** | **Paper** |
|---|---|---|
| Mục đích | để đội **xây** đúng thứ cần xây | để người ngoài **tin / adopt / công nhận** |
| Độc giả | đội build (đã tin) | người ngoài (chưa tin) |
| Hiển thị | **INTERNAL mặc định** | EXTERNAL — nhưng là **bản phái sinh**, có Legal sign-off |
| Nguồn sự thật | **là** nguồn chân lý của build-fact | **view phái sinh** của spec |

Hệ quả cho LAMP:

- Thư mục đối ngoại là **`Papers/`**, không phải `Specs/`. Trước đây LAMP gọi nó là `Specs/` và ghi
  "đặc tả dành cho công chúng" — trái Rule 6 ("ALL INTERNAL BY DEFAULT"). Chính chỗ lệch đó là
  **nguyên nhân cấu trúc** khiến câu chữ nội bộ rò ra tài liệu công khai: không có bước phái sinh nào
  để dừng lại và soát.
- **Spec nội bộ nằm trong thư mục module** (`Treasury/`, `Genesis/`, `Distribution/`, …).
- Không có file nào vừa là spec vừa là paper. Muốn công bố → viết một paper phái sinh.

## 2. Tên file

**Luật một câu: chủ đề nằm ở ĐƯỜNG DẪN, tên file chỉ nói VAI TRÒ hoặc CHỦ ĐỀ CON.**

### 2.1 File vai trò — từ vựng đóng

| Tên | Vai (theo Rule 11 — Spec Lane Discipline) |
|---|---|
| `README.md` | cửa vào module: nó là gì, chạy test thế nào, đọc tiếp ở đâu |
| `CONTRACT.md` | interface contract + bất biến (khái niệm riêng của LAMP, ngoài bộ 4-spec) |
| `Feat-Spec.md` | WHY + WHO + WHAT |
| `Math-Spec.md` | PROOF + INVARIANT + ATTACK MODEL |
| `Tech-Spec.md` | HOW-BUILD + HOW-RUN |
| `Exec-Spec.md` | HOW-DELIVER + HOW-TEST + HOW-RISK + HOW-COMM |

Mỗi thư mục nhiều nhất **một** file mỗi vai. Nội dung phải ở đúng lane — Feat không định nghĩa API,
Math không liệt kê phiên bản thư viện, Tech không viết phân tích thị trường.

### 2.2 File chủ đề

Mọi thứ không thuộc 6 vai trên: **`chu-de-viet-thuong-kebab.md`**. ASCII, không dấu, không viết hoa.
Ví dụ: `kho-a-dest.md`, `spo-cs.md`, `operator-runbook.md`, `paymaster-design.md`.

### 2.3 Cấm trong tên file

| Cấm | Vì sao | Để ở đâu |
|---|---|---|
| Phiên bản (`V2`, `v1.7`) | hết version là phải đổi tên + sửa mọi liên kết | header + §Change Log + git |
| Trạng thái (`DRAFT`, `DEPRECATED`) | trạng thái đổi thường xuyên hơn nội dung | dòng `> Trạng thái:` ở đầu file |
| Nhãn ngôn ngữ (`-Vi`) | không phân biệt được gì khi mọi file cùng một ngôn ngữ | thư mục, nếu thật cần |
| Tên module đã có trong đường dẫn | `Treasury/TREASURY-…` lặp thừa | đường dẫn đã nói rồi |

### 2.4 Dấu ngăn cách

Chỉ `-`. **Không** `_`.

### 2.5 Chủ đề lớn → mở THƯ MỤC, đừng ghép tên

`Distribution/capped-drop/{CONTRACT,Feat-Spec,Math-Spec}.md`
— không phải `Distribution/SPEC-CappedDrop-FEAT.md`.

## 3. Tham chiếu chéo

Luôn dùng **đường dẫn tương đối đầy đủ**, không viết tên trần.

- Đúng: ``xem [`../Papers/pot-catalog.md`](../Papers/pot-catalog.md)``
- Sai: ``xem `CONTRACT.md``` — có 5 file `CONTRACT.md` trong repo, người đọc phải đoán.

Trỏ sang **repo khác** (MAGIC, Registry, PhoenixKey) thì dùng **URL tuyệt đối**, đừng dùng
`../../MAGIC/...`. Ai clone LAMP đơn lẻ sẽ không có thư mục đó — và LAMP là repo public.

## 4. Vài rule cứng của StandardSpec hay bị vi phạm ở repo này

Đủ 11 rule ở `_shared/HARD-RULES.md` của StandardSpec. Bốn cái LAMP hay vấp:

- **Rule 1 — KHÔNG bịa URL.** Mọi URL phải verify được, hoặc ghi rõ `[NEEDS-URL: …]`.
- **Rule 2 — KHÔNG bịa mốc thời gian.** Không "Q3 2026", không "2–4 tuần". Trạng thái dùng bộ
  `not_started / blocked-by-X / in_progress / complete / pivoted` — theo phụ thuộc, không theo lịch.
- **Rule 3 — KHÔNG bịa con số.** Mọi số phải có nguồn, hoặc `[NEEDS-EVIDENCE]`. Số test phải là số
  **đo được**, kèm ngày đo.
- **Rule 9 — chuỗi lập luận.** Mọi tham số / ngưỡng / lựa chọn kiến trúc phải có dẫn giải. Không
  "chọn theo kinh nghiệm" mà không mở ra.

## 5. Riêng cho `Papers/` — phân loại bắt buộc

Mỗi file trong `Papers/` phải khai **class** ở đầu file (Paper-CORE §1). Bốn class:

| Class | Khi nào | Trong LAMP |
|---|---|---|
| **A — Positioning** | định vị, thuyết phục bằng fact đã có trong spec | `Whitepaper.md`, `launch-framework.md`, `srcl.md` |
| **B — Research** | **sinh** fact mới, cho peer kỹ thuật / academia | chưa có |
| **C — Standard** | quy định chuẩn để team Cardano khác implement (kiểu CIP) | **chưa có — nhưng đây là loại gần mục tiêu "Open SDK cho mọi team Cardano" nhất** |
| **D — Report** | ghi lại việc **đã xảy ra**: post-mortem, benchmark, security disclosure | chưa có |

**Mặc định KHÔNG có gì từ spec ra paper** trừ khi nằm trong allow-list công bố của class đó. Luôn cấm
tuyệt đối: secret/credential, đường dẫn hạ tầng nội bộ, nội dung `_Agents/`, business-model chi tiết,
milestone nội bộ, đối tác đang đàm phán.

Với LAMP còn một lớp nữa, do pháp nhân phát hành là doanh nghiệp Việt Nam: **mọi paper phải soát lại
ngôn ngữ chào bán/hứa niêm yết trước khi công bố.** Xem `_Agents/topics/phap-ly-viet-nam-2026.md`.

## 6. Việc còn treo (nói thẳng để không ai tưởng đã xong)

- **`Papers/` vẫn là file gốc đổi tên, chưa phải bản phái sinh thật.** Đúng chuẩn thì mỗi paper phải
  được viết lại từ spec nội bộ qua bước phái sinh + Legal sign-off. Hiện chỉ mới đặt đúng chỗ và đúng
  tên, và đã gỡ ngôn ngữ rủi ro. Việc viết lại chưa làm.
- **Chưa có Class C (CIP-style) nào**, dù đó là loại sát mục tiêu Open SDK nhất.
- **Vài file `Papers/` còn nhãn DRAFT** — theo §2.3 nhãn nằm trong header là đúng, nhưng "bản nháp làm
  nguồn sự thật" vẫn là mâu thuẫn cần giải.
- **Tài liệu toàn tiếng Việt** trong khi repo nhắm team Cardano quốc tế. Phương án rẻ nhất: dịch
  `Papers/` + README của từng module (~1.400 dòng), giữ spec kỹ thuật nội bộ tiếng Việt. Chưa quyết.
- **Chưa có `Math-Spec.md`/`Exec-Spec.md` cho phần lớn module.** Không tự động là lỗi — theo scope
  level L3/L4 thì spec nhẹ hơn là đúng. Nhưng chưa ai khai LAMP ở scope level nào.
