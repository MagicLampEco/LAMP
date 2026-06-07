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

5. **Sàn phi tập trung Byzantine — không thực thể nào chiếm đa số.** Cap mỗi DID chỉ chặn một
   cá nhân; nguyên lý 5 chặn **mọi nhóm nhỏ**. Khi kiểm phiếu, VP hiệu dụng mỗi DID bị clamp:
   `VP_eff_i = min( VP_i , ΣVP / BFT_FLOOR )` với `BFT_FLOOR = 21` (tham số DAO chỉnh, mặc định 21).
   Hệ quả: không DID nào vượt `1/21 ≈ 4,76%` tổng → cần **≥ 8 DID độc lập** mới chạm ngưỡng
   Byzantine 1/3, **≥ 14** đạt siêu đa số 2/3, **≥ 21** đạt 100%. Cộng **sàn cứng**: quyết định
   trọng yếu chỉ hợp lệ khi số DID thuận `≥ BFT_FLOOR` (chưa đủ → khóa, về chế độ hội đồng bảo
   trợ — xem EXEC bootstrap). Đây là chuẩn an-toàn BFT (chịu < 1/3 độc hại); `BFT_FLOOR` là
   **SÀN tối thiểu**, KHÔNG phải số ghế cố định (tránh bẫy oligarchy kiểu 21 block-producer) —
   hệ trưởng thành phải có [Nakamoto coefficient](https://news.earn.com/quantifying-decentralization-e39db233c28e)
   ≫ 21, lúc đó trần `1/21` tự nới và không còn ràng buộc.

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

## 5. Quyết định reconcile 2026-06-05 (interface KHÓA — mọi spec phải khớp)

Sau rà soát đối kháng, các interface dưới đây được **ghim cứng**. Spec nào lệch phải sửa theo đây.

- **D1 — Ngưỡng thông qua (MỘT dạng duy nhất).** Validator pass dùng dạng nhân-chéo số nguyên:
  `Σ VP_eff(THUẬN) × θ_den ≥ W_base_eff × θ_num`, **dấu `≥`** (đúng ngưỡng phải PASS),
  `W_base_eff = VP_eff(thuận) + VP_eff(chống)` (TRẮNG ngoài mẫu), `(θ_num,θ_den)` đọc từ UTxO tham
  số (mặc định 2/3). KÈM sàn cứng `số DID thuận ≥ BFT_FLOOR`. TECH §9.4 BỎ `yes>no`; MATH §8.2 là chuẩn.
- **D2 — ProposalDatum (interface Gov→Treasury).** Thêm field: `spend_spec_hash` (hash canonical
  danh sách `(bucket, asset, amount, to)` đã duyệt), `released_cumulative` (chống chi vượt qua nhiều
  tx), `execute_after_epoch` (mốc time-lock). 3 field này là HARD BLOCKER cho Treasury Release.
- **D3 — Release-gate = Model A.** Treasury KHÔNG tự tính ngưỡng; chỉ kiểm `status==Executed` +
  Proposal NFT + `spend_spec_hash`. Governance `ExecuteProposal` ép TOÀN BỘ ngưỡng (gồm clamp BFT
  `VP_eff` + sàn cứng `|S|≥F`) TRƯỚC. Đóng lỗ hổng "release bỏ qua clamp" (GAME-1).
- **D4 — C4 (LAMP nắm giữ) = registry khóa.** Đọc qua LAMP-holding registry gắn DID, mỗi entry
  `did_commit→holding` BACKED bởi LAMP **khóa thật** trong lock UTxO **một-LAMP-một-DID** (UTxO bị
  tiêu khi khóa → không double-count cho 2 DID). CẤM đọc số dư ví trần qua reference input. EXEC/M2/M5
  theo đây; thêm negative-test "mượn-ảnh" (2 DID trỏ một kho LAMP → fail).
- **D5 — Bỏ `vp_claimed` khỏi VoteDatum.** Tally tự tính `power` từ `c*_capped` + bảng tra; không
  tin số off-chain mớm.
- **D6 — TallyDatum thêm `top_did_vp: List<TopEntry>`** (≤ F−1, `TopEntry{vp_raw, choice}`) để pha
  Clamped trừ đúng phần vượt trần; cập nhật min-ADA Tally UTxO theo bytes heap.
- **D7 — Thuật toán VP on-chain (chốt khả thi).** Bảng 1-chiều `pow_k[c] = round(c^{w_k}·SCALE)` cho
  từng yếu tố (nội suy tuyến tính giữa mốc) rồi `power = (pow_1·pow_2·pow_3·pow_4)/SCALE^3` trên
  Aiken `Int` (bignum, không overflow). Đặc tả SCALE + sai số nội suy + property test VP_int vs VP_float.
- **D8 — Chống đòn bẩy mua-bằng-tiền (C2+C4).** Ràng buộc cứng `w_2 + w_4 ≤ w_1 + w_3` (tổng weight
  yếu tố mua-được-bằng-tiền ≤ tổng weight yếu tố cần-thời-gian). C2 chỉ tính nếu LAMP **đã khóa** qua
  đủ N epoch tương lai (biến C2 thành chi-phí-cơ-hội-thời-gian như C1, không phải khóa-tức-thì).
- **D9 — Interface cross-repo MAGIC (CẦN MAGIC xác nhận).** Beacon C1/C2 của MAGIC PHẢI nhúng
  `did_commit` đọc byte-perfect trong datum để ràng (b) chống-mượn-C_k thực thi được. Cho tới khi MAGIC
  xác nhận → đánh dấu chống-mượn-C1/C2 là "phụ thuộc xác nhận MAGIC", không coi là đã chặn.

- **D10 — `ProposalResult` beacon Gov→Treasury (KHÓA byte-perfect, orchestrator ghim 2026-06-07).**
  Audit phát hiện: Treasury `release.ak` decode type **`ProposalResult` 5 field**
  (`Treasury/onchain/lib/magiclamp/treasury/types.ak:78-84`), KHÔNG decode `ProposalDatum` 12 field.
  → Governance KHÔNG bắt Treasury đọc `ProposalDatum` nặng. Thay vào đó: tại `ExecuteProposal`,
  Governance **phơi một Proposal UTxO mang Proposal NFT one-shot**, datum = **`ProposalResult` GỌN
  khớp BYTE-PERFECT** định nghĩa Treasury hiện có:
  ```
  ProposalResult { proposal_id: ByteArray, status: ProposalStatus,
                   spend_spec_hash: ByteArray, execute_after_epoch: Int,
                   released_cumulative: Int }
  ProposalStatus { Open, Tallied, Executed, Rejected }   // Constr index 0,1,2,3 — Executed=2
  ```
  **BẮT BUỘC:** Governance `types.ak` khai báo `ProposalStatus` ĐÚNG THỨ TỰ `{Open, Tallied,
  Executed, Rejected}` (KHÔNG `{Open, Closed, Tallied, Executed}` như TECH.md draft — lệch index sẽ
  decode-fail trên UTxO thật). TECH.md phải sửa theo đây. `ProposalDatum` 12 field (D2) vẫn dùng NỘI
  BỘ cho Tally/Vote; `ProposalResult` chỉ là projection phơi ra cho Treasury.
  **Lý do (4 trục):** tối ưu eUTXO (reference input gọn, ít byte); KHÔNG rework Treasury đã build+test
  61 pass; ranh giới sạch onchain↔onchain; bền vững (đổi nội bộ Governance không phá Treasury).
  Governance build phải có Aiken negative-test: round-trip serialise `ProposalResult` của Governance
  → decode bằng type Treasury (mirror) PHẢI khớp; `status=Closed` (không tồn tại) → fail.
