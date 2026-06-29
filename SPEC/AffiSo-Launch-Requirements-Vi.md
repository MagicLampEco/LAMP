# Yêu cầu xây dựng: AffiSo Launch + giải pháp kỹ thuật SRCL

> Tài liệu yêu cầu gửi team AffiSo. Mục tiêu: AffiSo xây **module Launch** (`affiso.net/launch`) làm nền tảng ra-mắt dùng chung toàn hệ sinh thái, và **giải pháp kỹ thuật cho cơ chế SRCL** (đóng phần thưởng staking → nhận LAMP). Đọc kèm: `Launch-Framework-Vi.md`, `SRCL-Spec-Vi.md`.

---

## 1. Phạm vi

AffiSo cung cấp **nền tảng + cơ chế xác định phần thưởng + đo lường + cộng đồng** cho mọi đợt Launch. Token-side (đội LAMP) cung cấp thuật toán phân bổ LAMP/MAGIC + kho + claim. PhoenixKey cung cấp định danh + ký. Tài liệu này nêu phần **AffiSo phải xây**.

---

## 2. Yêu cầu chức năng — Module Launch (dùng chung)

| Mã | Yêu cầu |
|---|---|
| FR-L1 | Đăng ký một đợt Launch: dự án cấu hình cơ chế + các trục (nguồn, token đích, cách đo, phân bổ, thời hạn, bên hưởng thụ, cổng tham gia). Mỗi đợt có `launch_id` duy nhất, có kiểm duyệt onboarding (chống chiếm tên / rác). |
| FR-L2 | Trang mỗi đợt tại `affiso.net/launch/<project>`: hiển thị tài liệu dự án, dẫn tới kênh chat (nhóm Launch trên Chat SuperApp), và mọi thông báo của đợt. |
| FR-L3 | Khám phá: liệt kê mọi đợt Launch đang/đã chạy, lọc theo trạng thái. |
| FR-L4 | Đo lường + quy kết: ghi nhận ai giới thiệu ai vào đợt, quy kết minh bạch, chống Sybil bằng DID + reputation. |
| FR-L5 | Cơ chế xác định phần thưởng cho **vai chủ động** (người giới thiệu / hỗ trợ) tách khỏi phần token-đích chia cho người đóng góp nguồn lực — cấu hình tỉ lệ theo từng đợt. |
| FR-L6 | Bảng điều khiển đợt: tiến độ pot, số người tham gia, đóng góp tích lũy, lịch nhả token. |

## 3. Yêu cầu chức năng — Giải pháp kỹ thuật SRCL

| Mã | Yêu cầu |
|---|---|
| FR-S1 | Hướng dẫn người tham gia **ký một lần** trên ví hiện có (Lace, Eternl) để nối phần ủy thác tới script reward-only của đợt + uỷ quyền PhoenixKey. Giao diện ký phải **đọc được rõ** (không ký mù): nêu rõ chỉ nối phần thưởng staking, không chuyển vốn gốc. |
| FR-S2 | Mỗi epoch: thu thập số ADA phần-thưởng mỗi người đóng góp (đo on-chain), kết xuất thành snapshot đóng góp chuẩn để token-side phân bổ LAMP. |
| FR-S3 | Hỗ trợ **nhiều đợt SRCL song song / nối tiếp**, mỗi đợt khác `pot_lamp` / `lamp_source` / `duration_epochs` / `beneficiary` / `operator` / `rules` (xem 2 ví dụ §5 SRCL-Spec). |
| FR-S4 | Hiển thị cho mỗi người: phần thưởng đã đóng góp mỗi epoch + LAMP nhận được mỗi epoch + tổng — tự kiểm được, tất định. |
| FR-S5 | Định tuyến ADA phần-thưởng thu về đúng `beneficiary` của đợt (ví dụ pool GST vận hành bằng chữ ký dự án; hoặc pot RedBack tự động không ai rút). |

---

## 4. Hợp đồng interface (ranh giới các bên)

| AffiSo cung cấp | Nhận từ | Trả về |
|---|---|---|
| Đăng ký + trang đợt + đo lường + quy kết | dự án (cấu hình đợt) | `launch_id`, trang, snapshot đóng góp |
| Snapshot đóng góp mỗi epoch (FR-S2) | đo on-chain | dữ liệu chuẩn cho token-side phân bổ |

| Bên khác cung cấp | Bên | Mô tả |
|---|---|---|
| Thuật toán phân bổ LAMP/MAGIC ∝ đóng góp (tất định, bảo toàn) + kho + claim | **Token-side (LAMP)** | nhận snapshot đóng góp → ra entitlement + nhả token |
| Script reward-only (nối phần ủy thác) + ký uỷ quyền + ký claim (Grant revocable) | **PhoenixKey** | bảo đảm vốn gốc bất khả xâm phạm |
| Xác thực đóng góp thật + chống Sybil/trùng | **VeData** | với các cơ chế cần xác thực ngoài on-chain |
| Hiển thị số dư / địa chỉ trong tin nhắn | **ProofChat (trong SuperApp)** | |

Token-side đã có sẵn (tái dùng): thuật toán chia số nguyên dư-lớn-nhất + kho + claim đã kiểm thử (đã chạy thật trên Preview). AffiSo **không** tự làm phần phân bổ token; chỉ cấp snapshot đóng góp đúng định dạng.

---

## 5. Ràng buộc bắt buộc

| Mã | Ràng buộc |
|---|---|
| C-1 | **Dùng tài nguyên hệ sinh thái.** Chat trên SuperApp (ProofChat), thông báo trên AffiSo, chi tiết trên magiclamp.network, diễn đàn magiclamp.network/forum. **Cấm** Telegram, X, Discord, hay SaaS ngoài cho log/analytics/chat. |
| C-2 | **Không ký mù.** Mọi giao diện ký phải phân tích + hiển thị ý định giao dịch phía client; không chỉ tin chuỗi mô tả từ backend. |
| C-3 | **Một người một DID** (PhoenixKey sinh trắc) ở mọi khâu nhận thưởng / quy kết. |
| C-4 | **Phân tách lõi/mở rộng.** Nếu lõi AffiSo (các stream + validator) chưa hỗ trợ loại đóng-góp-nguồn-lực mới, thiết kế nó như **cơ chế cắm qua cổng (adapter)**, không sửa lõi đóng. |
| C-5 | **Vùng pháp lý.** Hỗ trợ geofence theo cấu hình từng đợt (chặn theo IP + DID). |

---

## 6. Tiêu chí nghiệm thu

- Một đợt SRCL thử nghiệm chạy được end-to-end trên Preview: đăng ký → người tham gia ký một lần (đọc-được, không mù) → mỗi epoch ra snapshot đóng góp → token-side phân bổ + nhả LAMP → người tham gia tự kiểm bảng từng epoch.
- Không phụ thuộc ngoài hệ (kiểm: không có endpoint Telegram/X/Discord/ngrok/SaaS trong code đường-chạy).
- Vốn gốc người tham gia chứng minh được là bất khả xâm phạm (script reward-only).
- Đa đợt: hai đợt cấu hình khác nhau chạy được độc lập.

---

## 7. Ngoài phạm vi (do bên khác lo)

- `did_stake.ak` (script reward-only) + ký uỷ quyền + ký claim → **PhoenixKey**.
- Thuật toán phân bổ LAMP/MAGIC + kho + claim → **Token-side (LAMP)**.
- Migrate salt ký + audit khâu ký (rust_core) → **PhoenixKey**.
