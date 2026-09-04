# Governance — Quản trị Foundation (trang chỉ mục)

> ## ⚠️ CHƯA DÙNG ĐƯỢC — mã on-chain chưa có đường dựng tx
>
> Thư mục này có **6 validator sinh script hash thật** (`vote`, `tally`, `proposal`,
> `nullifier`, `proposal_nft`, `tally_nft`) nhưng **không có `offchain/` và không có
> `scripts/`** — nghĩa là luồng `Vote → Tally → Record → Execute → Release` hiện
> **không có tx hợp lệ nào**, kể cả trên testnet. 94 test Aiken ở đây là test đơn vị của
> validator, không phải bằng chứng luồng chạy được.
>
> Repo này Apache-2.0 công khai. Nếu bạn đang tìm một nền governance dùng được cho
> Cardano thì **đây chưa phải**. Đừng đọc `Governance/` để suy ra Treasury Release đã
> khép vòng — nó chưa.
>
> Theo dõi ở issue #21 mục C.

> **Phiên bản:** v1.0 — 2026-06-05. Lần đầu khai phiên bản — tệp trước đây chỉ có dòng `Trạng thái`,
> không có số hiệu để tham chiếu; nội dung không đổi so với ngày duyệt khung.
> **Vai:** view điều phối — trang chỉ mục Governance nói chung. Phần Voting Power KHÔNG PHẢI nguồn
> chuẩn ở đây: khi lệch với [`VotingPower/CONTRACT.md`](./VotingPower/CONTRACT.md), CONTRACT.md
> thắng. Phần "bầu cử, hội đồng, KPI" (ngoài Voting Power) chưa có nguồn chuẩn khác — vẫn ở mức
> outline.

**Trạng thái:** mô hình Voting Power đã được duyệt khung 2026-06-05. Phần còn lại (bầu cử,
hội đồng, KPI) vẫn ở mức outline.

Nguồn chuẩn của mô hình **Voting Power** là [`VotingPower/CONTRACT.md`](./VotingPower/CONTRACT.md),
chi tiết hóa thành 4 spec:

| Spec | Nội dung | File |
|---|---|---|
| **FEAT** | Tính năng/hành vi: vòng đời cử tri, tập sự, loại quyết định, luồng vote/recall | [VotingPower/Feat-Spec.md](./VotingPower/Feat-Spec.md) |
| **MATH** | Cơ sở toán: công thức VP, chứng minh bounded/monotonic, geometric vs additive, chi phí thâu tóm | [VotingPower/Math-Spec.md](./VotingPower/Math-Spec.md) |
| **TECH** | Kiến trúc on-chain Aiken: validator, đọc C1–C4, DID proof, chống double-vote | [VotingPower/Tech-Spec.md](./VotingPower/Tech-Spec.md) |
| **EXEC** | Lộ trình, mốc, test plan, deploy Preview, bootstrap DAO | [VotingPower/Exec-Spec.md](./VotingPower/Exec-Spec.md) |

---

## ⚠️ DEPRECATED — công thức cũ `VP = (C1 × C2 × C3)^(1/3)`

Bản outline trước của file này (và `MAGIC-LAMP Tokenomic §12`) ghi:

```
VP = (C1 × C2 × C3)^(1/3)      ← KHÔNG DÙNG NỮA
```

Công thức này **bị thay thế** bởi mô hình trong CONTRACT:

```
VP_i = ∏_{k=1}^{K≥4}  min( C_{k,i}, cap_k )^( w_k )
```

Hai khác biệt cốt lõi khiến công thức cũ **vi phạm nguyên lý chống thâu tóm**:

1. **Cũ không có ngưỡng (cap)** → một yếu tố có thể tăng vô hạn → VP vô hạn → người đủ
   giàu/đủ tích lũy áp đảo cả cộng đồng (quay về tài phiệt).
2. **Cũ chỉ 3 yếu tố, mũ cố định `1/3`, thiếu C4 (LAMP nắm giữ) và thiếu weight DAO chỉnh.**

Phần dưới chứng minh vì sao mô hình mới tốt hơn, có cơ sở toán học.

---

## Đánh giá: mô hình nào tốt hơn, vì sao? (cơ sở toán học)

### Nhận diện toán học của công thức

Hàm `VP = ∏_k C_k^{w_k}` chính là một **hàm Cobb–Douglas** — dạng hàm sản xuất kinh điển trong
kinh tế học, mô tả sản lượng từ nhiều đầu vào **bổ trợ** nhau
([Cobb–Douglas](https://en.wikipedia.org/wiki/Cobb%E2%80%93Douglas_production_function)).
Công thức cũ `(C1·C2·C3)^{1/3}` chỉ là **trường hợp đặc biệt**: Cobb–Douglas 3 đầu vào, trọng số
bằng nhau `w_k = 1/3`, **không bão hòa**. Tức mô hình mới **bao trùm** (tổng quát hóa) mô hình cũ —
đặt `K=3, w_k=1/3, cap_k=∞` là ra lại công thức cũ. Vậy câu hỏi không phải "cái nào", mà là "có nên
thêm cap + weight + C4 không". Bốn tính chất toán dưới đây trả lời: **có**.

### 1. Tính bị chặn trên (bounded) — điều kiện sống còn

- **Cũ:** `lim_{C_k → ∞} (C1·C2·C3)^{1/3} = ∞`. Không có trần. Một cá nhân đẩy một yếu tố đủ lớn
  (vd dồn vốn vào một yếu tố mua được) → VP lớn tùy ý → có thể vượt tổng VP cộng đồng. Đây đúng là
  thất bại của **bỏ phiếu theo vốn** mà Buterin phê phán
  ([Moving beyond coin voting governance](https://vitalik.eth.limo/general/2021/08/16/voting3.html)).
- **Mới:** `min(C_k, cap_k) ≤ cap_k` nên `VP_i ≤ ∏_k cap_k^{w_k}` = **trần cứng, hữu hạn**, giống
  nhau cho mọi cử tri. Vượt cap là vô ích → không ai mua thêm quyền lực được. Đây là hàm **lợi ích
  cận biên giảm dần đến bão hòa**
  ([diminishing returns](https://en.wikipedia.org/wiki/Diminishing_returns)). **Bounded là điều kiện
  toán để câu "token đơn thuần không mua được quyền lực" thành đúng** — thiếu nó nguyên lý sụp.

### 2. Chống thâu tóm định lượng được (nhờ cap)

Gọi `VP_max = ∏_k cap_k^{w_k}`. Một thực thể nắm `H` LAMP muốn tối đa ảnh hưởng:
- **Không cap (cũ):** ảnh hưởng ∝ tăng theo `H` không giới hạn → 1 ví đủ giàu thắng.
- **Có cap (mới):** mỗi DID chỉ đạt tối đa `VP_max`; phần `H` vượt `cap_4 = 100 triệu` **vô giá trị
  về phiếu**. Muốn dùng hết `H = 12 tỷ` phải chia cho `≥ H/cap_4 ≈ 120` **DID người-thật**, mỗi DID
  còn phải có C1/C2/C3 thật (lịch sử tiêu MAGIC + cam kết + uy tín). Chi phí thâu tóm vì thế **= chi phí đóng
  góp thật**, và bị chặn sybil bởi DID sinh trắc
  ([proof of personhood](https://en.wikipedia.org/wiki/Proof_of_personhood);
  [Sybil attack — Douceur 2002](https://www.microsoft.com/en-us/research/publication/the-sybil-attack/)).

### 3. Vì sao NHÂN (geometric) chứ không CỘNG (additive)

- **Cộng** `VP = Σ w_k C_k`: các yếu tố **thay thế** nhau. Ai mạnh tiền có thể max C4 + khóa LAMP đẩy
  C2 → **hai** yếu tố mua được, cộng dồn vẫn cao **dù uy tín C3 = 0**.
- **Nhân** (Cobb–Douglas): các yếu tố **bổ trợ**, không thay thế. Nếu `C3 → 0` thì `VP → 0` bất kể
  các yếu tố khác lớn cỡ nào (vì số mũ dương). Buộc cử tri mạnh **cả bốn** mặt → token đơn thuần
  bất lực. Nền tảng là bất đẳng thức **AM–GM**: trung bình nhân ≤ trung bình cộng, và trung bình
  nhân **phạt sự mất cân đối** ([AM–GM](https://en.wikipedia.org/wiki/AM%E2%80%93GM_inequality);
  [weighted geometric mean](https://en.wikipedia.org/wiki/Weighted_geometric_mean)).

### 4. Linh hoạt + mô-đun (weight DAO + thêm yếu tố)

- **Cũ:** mũ cứng `1/3`, 3 yếu tố cố định. Muốn đổi tầm quan trọng → phải sửa công thức (hard fork).
- **Mới:** `w_k` là **tham số DAO chỉnh** → cộng đồng hạ trọng số vốn (C4), nâng trọng số uy tín (C3)
  mà không đổi cấu trúc. Thêm yếu tố mới (`K` tăng) **không phá** tính bounded/monotonic — chứng minh
  ở [MATH](./VotingPower/Math-Spec.md). Nếu chuẩn hóa `Σ w_k = 1` thì VP là **trung bình nhân có trọng số**,
  giữ thứ nguyên, so sánh được giữa các cử tri.

### So với các mô hình quản trị khác

| Mô hình | Cơ chế | Điểm yếu | Tham chiếu |
|---|---|---|---|
| 1 token = 1 phiếu | phiếu ∝ số token | tài phiệt; mua phiếu | [Buterin 2021](https://vitalik.eth.limo/general/2021/08/16/voting3.html) |
| Quadratic voting | phiếu ∝ √token | vẫn mua được; cần chống sybil mạnh | [Quadratic payments — Buterin](https://vitalik.eth.limo/general/2019/12/07/quadratic.html); [Lalley–Weyl](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2003531) |
| 1 người = 1 phiếu | per-capita thuần | bỏ qua mức đóng góp; cần chống sybil | [proof of personhood](https://en.wikipedia.org/wiki/Proof_of_personhood) |
| **MagicLamp VP** | per-capita (1 DID) × Cobb–Douglas có cap trên ≥4 yếu tố đóng góp | phụ thuộc DID sinh trắc; cần chống collusion người-thật | [DeSoc / Soulbound — Weyl, Ohlhaver, Buterin](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4105763) |

**Kết luận:** mô hình mới tốt hơn vì nó **bao trùm** mô hình cũ và thêm đúng ba thứ mà nguyên lý
chống thâu tóm đòi hỏi về mặt toán — **cap** (để bounded), **công thức nhân** (để các yếu tố bổ trợ,
token không thay thế được uy tín), **weight DAO** (để tự điều tiết). Công thức cũ thiếu cap nên
**không thể** bảo đảm "token đơn thuần không mua được quyền lực" — đó là lý do bắt buộc thay.

---

## Phạm vi Governance còn lại (outline — chưa chi tiết hóa)

Nguồn: `MagicLamp-Docs/docs/Foundation-Bootstrap.md` (lưu ý: bản local hiện trống — cần đồng bộ).

- **iVoteSpace**: nền tảng proposal + bỏ phiếu on-chain (Cardano).
- **3 hội đồng**: Điều hành / Thành viên / Hiến pháp.
- **Bầu cử**: nhiệm kỳ, ứng cử, kiểm phiếu (trọng số theo VP ở trên).
- **Recall (bãi miễn)**: ngưỡng co-sign theo **đầu người** + vote theo **VP**; ngưỡng siêu đa số
  ghi dạng **"≥2/3"** (đạt-hoặc-vượt) để Team giữ 1/3 không phủ quyết được tầng 2/3. Con số là
  **tham số mở (DAO định)** — xem FEAT §loại quyết định.
- **KPI + thưởng** cuối nhiệm kỳ Executive Council bằng LAMP.

## Phụ thuộc

- **PhoenixKey DID sinh trắc + zk-proof** "1 DID = 1 người" — backend PhoenixKey, **ngoài repo LAMP**
  (Claude không sửa). Blocker tiên quyết để Governance chạy thật.
- C1/C2 đọc từ repo **MAGIC** (MAGIC consumed, ScheduleGen commitment) qua reference input; C4 từ
  **LAMP**. Cross-repo — thiết kế ở [TECH](./VotingPower/Tech-Spec.md).
