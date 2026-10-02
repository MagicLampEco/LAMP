# Cửa sổ thời gian của LAMP — gốc trùng biên epoch Cardano

Phiên bản 1.0 (2026-10-02). Thay cho lưới cũ `posix_ms / ms_per_epoch` tính từ gốc Unix (1970).

## 1. Định nghĩa

Mọi validator và mọi mã off-chain của LAMP dùng **một** phép tính cửa sổ:

```
window(t)       = (t − window_origin_ms) / ms_per_epoch        -- chia sàn, t tính bằng POSIX ms
window_start(e) = window_origin_ms + e × ms_per_epoch
window_end(e)   = window_origin_ms + (e + 1) × ms_per_epoch − 1
```

Với `ms_per_epoch = 432_000_000` (5 ngày) và `window_origin_ms` lấy theo bảng §2, chỉ số cửa sổ
**bằng đúng số epoch Cardano** của mạng đó, và biên cửa sổ **trùng biên epoch** — tức trùng mốc
snapshot stake của Cardano.

Bất biến:
- **WIN-ORIGIN-1** — mọi phép đổi thời gian → cửa sổ phải trừ `window_origin_ms` trước khi chia.
- **WIN-ORIGIN-2** — mọi phép đổi cửa sổ → thời gian phải cộng `window_origin_ms`.
- **WIN-ORIGIN-3** — `window_origin_ms` là tham số validator, áp lúc dựng script. Không gõ cứng trong
  thân validator, và không đọc từ datum do người dựng giao dịch soạn.
- **WIN-ORIGIN-4** — mã off-chain lấy `window_origin_ms` từ một nguồn duy nhất,
  `Utils/src/index.ts` ▸ `WINDOW_ORIGIN_MS_BY_NETWORK`. Hằng này được **suy ra** từ
  `SHELLEY_START_BY_NETWORK`, không gõ tay.

## 2. Hằng theo mạng

`window_origin_ms = shelley.posixMs − shelley.epoch × ms_per_epoch`. Đây là thời điểm bắt đầu epoch 0
nếu kéo dài epoch Shelley về trước; Byron cũng dài 432_000 s trên hai mạng dưới (21_600 slot × 20 s).

| Mạng | `window_origin_ms` | Kiểm |
|---|---|---|
| Mainnet | `1_506_203_091_000` | `1_596_059_091_000 − 208 × 432_000_000` |
| Preprod | `1_654_041_600_000` | `1_655_769_600_000 − 4 × 432_000_000` |
| Preview | **chưa chốt** | xem §4 |

## 3. Test vector (mọi bên tích hợp chạy chung)

| Mạng | `t` (ms) | `window(t)` |
|---|---|---|
| Mainnet | `1_790_459_091_000` | `658` |
| Mainnet | `1_790_459_090_999` | `657` |
| Preprod | `1_790_553_600_000` | `316` |
| Preprod | `1_790_553_599_999` | `315` |

`window_origin_ms = 0` vẫn là đầu vào hợp lệ của hàm, nhưng **không phân biệt được** bản có trừ
gốc với bản quên trừ gốc. Bộ kiểm của mỗi validator phải có ít nhất một ca với gốc Mainnet hoặc
Preprod — hai gốc này không chia hết cho `ms_per_epoch`.

## 4. Danh mục trạng thái

| Mã | Treo cái gì | Ràng buộc tạm đang có hiệu lực | Khai ở |
|---|---|---|---|
| WIN-PREVIEW | `ms_per_epoch` và `window_origin_ms` của Preview | Không có giá trị Preview ⟹ hàm off-chain ném lỗi với Preview (fail-closed) | `Utils/src/index.ts` ▸ `WINDOW_ORIGIN_MS_BY_NETWORK` |
