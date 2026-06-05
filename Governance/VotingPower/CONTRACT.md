# Voting Power — CONTRACT (mô hình đã duyệt)

**Trạng thái:** ✅ anh đã duyệt khung 2026-06-05. Đây là **interface contract** — nguồn chuẩn
mà 4 spec (FEAT / MATH / TECH / EXEC) phải bám. KHÔNG spec nào được mâu thuẫn file này.

> Lý do tồn tại: tránh mỗi lần resume/compact lại hiểu nhầm MagicLamp dùng "1 token = 1 phiếu".
> **MagicLamp KHÔNG token-weighted.** Đọc file này trước khi bàn lại governance.

## 1. Mô hình cốt lõi

Bỏ phiếu dựa trên **cử tri = cá nhân (1 PhoenixKey DID)**, KHÔNG dựa số token. Mỗi cử tri có
một **Voting Power (VP)** tính từ **≥ 4 tham số**, mỗi tham số có **ngưỡng (cap)** và **trọng số
(weight) do DAO điều chỉnh**:

```
VP_i = ∏_k  min( C_{k,i}, cap_k )^( w_k )
```

| | Tham số | Cap (ví dụ) | Bản chất | Mua bằng tiền? |
|---|---|---|---|---|
| C1 | MAGIC tiêu thụ, cửa sổ quá khứ (~18 epoch) | DAO định | engagement đã chứng minh | khó (cần thời gian) |
| C2 | LAMP cam kết trong ScheduleGen, cửa sổ tương lai (~24 epoch) | DAO định | cam kết tương lai | một phần (khóa LAMP) |
| C3 | uy tín cộng đồng (lịch sử quyết định đúng) | DAO định | tín nhiệm xã hội | rất khó |
| C4 | LAMP nắm giữ hiện tại | **100 triệu** | vốn hiện tại | có — nhưng bị cap |
| … | DAO có thể bổ sung tham số | DAO định | | |

- **Tất cả cap và weight do DAO chỉnh.** Đây là hệ DAO — không có "người canh" tập trung.
- **Công thức NHÂN (geometric), không CỘNG.** Yếu một tham số là kéo sụp toàn bộ VP → token
  đơn thuần không mua được quyền lực. (Cộng thì người giàu max C4 + đốt LAMP đẩy C1 + khóa LAMP
  đẩy C2 → 3/4 yếu tố mua được; nhân thì C3 thấp làm sụp tất.)

## 2. Bốn nguyên lý (KHÔNG được vi phạm trong mọi spec)

1. **Quyền tham gia ≠ quyền lực.** Ai có DID đều được bỏ phiếu. Trọng số (power) phải kiếm.
   Người mới VP ≈ 0, tích lũy dần qua nhiều epoch — **mô hình tập sự** (như thử việc trước khi
   vào làm, thực tập trước khi tốt nghiệp). VP≈0 của người mới là TÍNH NĂNG, không phải bug.

2. **Chi phí thâu tóm = chi phí đóng góp thật.** Muốn có quyền lực phải nuôi hệ thống bằng đúng
   giá trị tương đương (đốt LAMP, tiêu MAGIC qua thời gian, tích uy tín). Không có đường tắt.
   Collusion (thuê 120 người thật vote hộ) không phải lỗ hổng: để 120 người đó có quyền lực thật,
   kẻ tấn công phải khiến họ đóng góp thật bằng đúng giá trị thu được — và hành vi cùng phục vụ
   một thực thể là lộ thiên on-chain, cộng đồng phát hiện được; bên kia cũng huy động được người.

3. **Token đơn thuần vô hiệu hóa.** Cap C4 = 100 triệu LAMP: ai giữ 12 tỷ chỉ được tính như
   **một cử tri 100 triệu**; muốn dùng hết phải chia cho ~120 cử tri — mà mỗi cử tri phải là
   người thật (DID sinh trắc) có lịch sử + uy tín + đã đốt LAMP. Cộng với công thức nhân.

4. **Sybil chết từ gốc — phòng thủ nhiều lớp liên kết:** DID sinh trắc PhoenixKey (1 người =
   1 DID, không nhân bản) + buộc có lịch sử (C1) + uy tín (C3) + đốt LAMP. Bốn lớp khóa lẫn nhau,
   không soi rời từng cái.

## 3. Phụ thuộc liên hệ thống

- **PhoenixKey DID sinh trắc** + zk-proof "1 DID = 1 người thật" mà KHÔNG lộ dữ liệu sinh trắc.
  Thuộc **backend PhoenixKey** — NGOÀI phạm vi repo LAMP (Claude không sửa, chỉ tiêu thụ proof).
  Đây là **blocker tiên quyết**: Governance không chạy thật trước khi có DID proof on-chain.
- **C1 (MAGIC tiêu thụ)** đọc từ repo MAGIC; **C2 (ScheduleGen)** từ MAGIC; **C4 (LAMP UTxO)**
  từ repo LAMP. Cross-repo qua reference input.

## 4. Bốn spec phải build (mỗi spec có Agent phản biện)

| Spec | Phạm vi |
|---|---|
| **FEAT** | Tính năng/hành vi: cử tri, vòng đời tập sự, quyền tham gia vs quyền lực, loại quyết định, luồng proposal/vote/recall. |
| **MATH** | Công thức VP, cap, weight, tính chất toán (bounded, monotonic, sybil-cost, geometric vs additive), chứng minh "token không mua được quyền lực". |
| **TECH** | Kiến trúc on-chain Cardano/Aiken: datum/redeemer, validators, reference input đọc C1–C4, tích hợp DID proof, chống double-vote, cross-repo data flow. |
| **EXEC** | Lộ trình triển khai, mốc, phụ thuộc (DID blocker), thứ tự build, test plan, deploy Preview, bootstrap DAO. |
