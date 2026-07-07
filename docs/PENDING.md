# LAMP Tokenomics — PENDING (quyết định chờ anh chốt)

> Mỗi mục: phân tích first-principles + **kiến nghị** của em. Mục đánh dấu 🔴 cần anh
> quyết trước khi code/deploy; 🟡 có default an toàn, chạy được mà không chặn.

---

## 🔴 1. Đích nhả Reserve — Treasury hay thị trường?

**Bối cảnh:** Reserve nhả TRẦN CỨNG E/1000 mỗi epoch = **9,630 triệu LAMP/epoch** (demand-gated qua Treasury-pull, KHÔNG tự động; dư dồn ~1001 epoch). Đích nhả `reserve_dest` là param validator — phải chốt địa chỉ.

**Phương án:**
| | A. Nhả vào Treasury | B. Nhả thẳng thị trường (DEX/LP) |
|---|---|---|
| Vai trò | Treasury điều tiết C↔T, quyết khi nào ra | Tự động vào cung lưu hành |
| Minh bạch | Cao (kế toán 1 chỗ) | Cao (on-chain tự động) |
| Rủi ro | Treasury thành điểm tập trung quyền | Áp lực bán đều, có thể đè giá |
| Pháp lý VN | An toàn hơn (không "bán" tự động) | "Bán theo lịch" dễ va NQ05 |

**Kiến nghị: A — nhả vào Treasury.** Lý do: (1) giữ đúng mô hình — Reserve chỉ là nguồn U→C đơn điệu, *Treasury* mới là cơ quan điều tiết 2 chiều; nhả thẳng thị trường là gộp 2 vai. (2) Pháp lý: tránh hành vi "bán token theo lịch tự động" — mâu thuẫn lập trường "không bán". (3) Linh hoạt: Treasury có thể giữ/release tùy điều kiện cung-cầu thực, Reserve chỉ lo *nhịp phát hành*. → `reserve_dest = Treasury script hash`.

---

## 🔴 2. Định loại LAMP pháp lý (utility vs tài sản ảo NQ05) — TIÊN QUYẾT

**Vấn đề:** NQ 05/2025 đòi "tài sản ảo phải bảo chứng tài sản thực". LAMP là utility/governance token (truy cập dịch vụ + quyền quản trị phi-token-weighted), KHÔNG hứa lợi nhuận, KHÔNG bảo chứng tài sản. → có thể NẰM NGOÀI khung "tài sản ảo cần bảo chứng", nhưng cũng có thể bị xếp vào.

**Kiến nghị:** Đây là việc **luật sư VN** phải định loại — em KHÔNG tự quyết (ngoài thẩm quyền + rủi ro thật). Em chuẩn bị sẵn lập luận để anh đưa luật sư:
- LAMP = "tiện ích nội bộ hệ sinh thái" (như điểm thưởng/credit dịch vụ), không phải công cụ đầu tư.
- Không cam kết lợi nhuận, không cổ phần, governance không theo vốn.
- Phát hành bởi doanh nghiệp VN (GreenSun+Aladin), minh bạch on-chain.
→ **Hành động:** anh xác nhận có/đã có luật sư VN để hỏi. Đây là blocker pháp lý cho niêm yết, KHÔNG chặn code/test.

---

## 🟡 3. Thuật toán √(holding)×MAGIC cho 3 tỷ NewUser-sau (→ 27/9)

**Mục tiêu anh đặt:** giọt mỗi DID/epoch ≈ √(LAMP nắm giữ) × hệ số *MAGIC đã tiêu thụ* (không phải ủy thác). Cá mập 10 triệu LAMP không tiêu MAGIC → giọt ÍT hơn nhiều doanh nghiệp nhỏ 1 triệu LAMP sản xuất thực.

**Phân tích:** công thức `√holding × f(magic)` thưởng *hoạt động thực* hơn *tài sản tĩnh* — chống cá mập thụ động, khuyến khích tiêu dùng dịch vụ. Nhưng:
- **Chặn kỹ thuật:** `EngageDatum` của MAGIC hiện CHỈ giữ `consumed_count` (số LẦN), KHÔNG giữ *tổng MAGIC đã đốt*. Để drip theo *lượng* MAGIC cần THÊM accumulator (vd `magic_burned_total` + cửa sổ N epoch) vào EngageDatum — **code MỚI ở repo MAGIC** (phụ thuộc chéo). Đây là hạ tầng chung cho cả Platform.
- Sybil: PhoenixKey DID (1 người 1 DID) chặn chia nhỏ ví.

**Công thức đề xuất (chốt sau khi có accumulator):**
```
drop_per_DID(epoch) = floor + min(cap, base × √holding × magic_consumed[DID, SMA 6 epoch] / Q)
```
- `floor` = giọt nền (ai cũng có, khuyến khích tham gia tối thiểu).
- `cap` = trần mỗi DID/epoch (chống tích tụ).
- `holding` phụ (√ làm phẳng), `magic_consumed` là hệ số chính.

**Kiến nghị:** để 27/9 (đúng state file). Trước đó cần: (a) anh duyệt THÊM `magic_burned_total` vào EngageDatum MAGIC; (b) chốt 3 tham số floor/cap/base+Q. KHÔNG chặn 18/6.

---

## Mục còn lại (gọn)

**✅ 4. Treasury seed — ĐÃ CHỐT:** Development 3 tỷ → **Development 2 tỷ + Treasury 1 tỷ** (anh chốt). Treasury 1 tỷ = vốn mồi điều tiết C↔T + khuyến khích bầu hội đồng/MagicLamp Foundation. **Còn chờ anh:** Foundation là pháp nhân VN hay DAO on-chain? (ảnh hưởng cách quản Treasury seed, KHÔNG chặn allocation).

**🟡 5. TIGER Airdrop retro vs tiếp diễn** — state chốt retro (cố định snapshot tới 29/7, claim 360 epoch, dư hoàn Treasury). Kiến nghị: GIỮ retro — đơn giản, không cạnh tranh SRCL. Đã rõ, coi như chốt trừ khi anh đổi.

**🟡 6. Tên "Scavenger"** — kiểm trademark/trùng dự án Cardano trước khi public. Hành động nhẹ, làm khi gần 27/9.

**✅ 7. Lưu SPEC canonical** — ĐÃ XONG: `TOKENOMICS.md` (gốc repo, umbrella). Module phân bổ đổi tên `Tokenomics/` → `Allocation/`.

---

## Tóm tắt cần anh
1. 🔴 Đích nhả Reserve → **kiến nghị Treasury**. Anh xác nhận để chốt `reserve_dest`.
2. 🔴 Định loại LAMP → anh xác nhận có luật sư VN; em đã soạn lập luận.
3. 🟡 √×MAGIC → duyệt thêm accumulator vào EngageDatum MAGIC (cho 27/9).
4. 🟡 Treasury seed + Foundation (pháp nhân VN hay DAO?).
5. ✅ Cap Genesis sửa 34,2/1,8 → 26,370/9,630 (v17) — ĐÃ XONG (baked on-chain + deploy Preview).
