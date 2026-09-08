# Treasury — Kho bạc đa thuê bao (trang chỉ mục)

> **Phiên bản:** v1.0 — 2026-06-05. Lần đầu khai phiên bản — tệp trước đây chỉ có dòng `Trạng thái`,
> không có số hiệu để tham chiếu; nội dung không đổi so với ngày đóng khung.
> **Vai:** view điều phối — trang chỉ mục, KHÔNG PHẢI nguồn chuẩn. Khi lệch với
> [`CONTRACT.md`](./CONTRACT.md), CONTRACT.md thắng.

**Trạng thái:** mô hình đã đóng khung 2026-06-05. Nguồn chuẩn = [`CONTRACT.md`](./CONTRACT.md),
chi tiết hóa thành 4 spec:

| Spec | Nội dung | File |
|---|---|---|
| **FEAT** | 3 cửa tiền, luồng `collectToTreasury`, vòng đời bucket, release, đa thuê bao | [Feat-Spec.md](./Feat-Spec.md) |
| **MATH** | bảo toàn value `Σ_out=Σ_in`, circulating = tổng − Σ balance, số học split | [Math-Spec.md](./Math-Spec.md) |
| **TECH** | validator Aiken (Custody/Collect/Release), datum bucket-accounting, chống double-satisfaction | [Tech-Spec.md](./Tech-Spec.md) |
| **EXEC** | lộ trình, migrate generators, tích hợp OriLife, test Preview | [Exec-Spec.md](./Exec-Spec.md) |

---

## ⚠️ DEPRECATED — "3 kho bạc cứng" + "burn để deflation"

Bản outline cũ (theo `Foundation-Bootstrap.md §7`) ghi **3 kho bạc cố định** (Community/Operational/
Emergency, mỗi cái một pool riêng). Nay thay bằng mô hình **bucket cấu hình**:

- **Bucket = sổ kế toán trong datum**, KHÔNG phải mỗi kho một UTxO/pool (chống bloat + min-ADA).
  DAO chỉnh số bucket + % + ngưỡng. Emergency vẫn tách physical (isolation). Ngưỡng viết dạng **"≥"**.
- **Đa thuê bao:** Treasury là instance param hóa — MagicLamp = một instance; team eco khác = instance
  khác (open SDK). Không hardcode danh sách kho.

Đồng thời, **bỏ hẳn khái niệm "burn để giảm cung"**: LAMP fixed-supply 36 tỷ tuyệt đối, KHÔNG burn.
"Giảm lưu hành" = chuyển trạng thái UTxO lưu hành → Accounting trong Treasury (như Cardano treasury);
value on-chain LUÔN `Σ_out = Σ_in`. Xem [CONTRACT §5](./CONTRACT.md).

## Điểm cốt lõi

- **`collectToTreasury(asset, amount, app_id, category)`** — hàm THU dùng chung cho mọi app eco (lấp
  đúng "AppEconomics settlement spec" mà OriLife đang chờ). **Định giá nằm ở app** (OriLife `animal_fee`
  bò ≠ gà), Treasury chỉ nhận `amount` đã tính.
- Bảo toàn value per-asset (tổng quát hóa `treasury_receives_lamp >= lamp_paid` mà generators TỪNG có —
  đã gỡ 2026-09-03, `Exec-Spec.md §1`);
  chống double-satisfaction theo **payment script hash**; thu **theo lô**; địa chỉ Treasury **tách ví**.

## Tái dùng từ Distribution

- `Distribution/onchain/validators/treasury.ak` (release LAMP có kiểm soát, đã build + audit) là nền
  cho Treasury đa thuê bao. Generators (MAGIC) đang trả Treasury riêng lẻ → migrate sang
  `collectToTreasury` chung (xem EXEC).

## Phụ thuộc

- **Governance** (cổng release — đọc kết quả vote qua reference input/beacon).
- **Oracle** LAMP↔USD/ADA — cho app định giá, **NGOÀI** Treasury.
- **LAMP ← MAGIC 1 chiều**: caller = generators (MAGIC), OriLife, app SDK.
