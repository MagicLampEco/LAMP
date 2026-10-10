# Cửa sổ thời gian của LAMP — gốc trùng biên epoch Cardano

Phiên bản 1.2 (2026-10-04). Vì sao bump: Preview có gốc và có vector (§2–§3); §1 nêu `ms_per_epoch`
theo mạng; đóng mục treo WIN-PREVIEW ở §4. Preprod/Mainnet không đổi giá trị nào. Công thức §1 và
WIN-ORIGIN-1..4 giữ nguyên, nên con trỏ `v1.0 §1` / `v1.0, WIN-ORIGIN-n` trong chú thích mã vẫn đúng
nghĩa; câu nào nói "Preview chưa có gốc" thì đã lỗi thời.
Phiên bản 1.1 (2026-10-04). Vì sao bump: thêm §5 (danh sách validator mang `window_origin_ms`); §1–§4 không
đổi, nên con trỏ `v1.0 §1–§4` vẫn đúng nghĩa.
Phiên bản 1.0 (2026-10-02). Thay cho lưới cũ `posix_ms / ms_per_epoch` tính từ gốc Unix (1970).

## 1. Định nghĩa

Mọi validator và mọi mã off-chain của LAMP dùng **một** phép tính cửa sổ:

```
window(t)       = (t − window_origin_ms) / ms_per_epoch        -- chia sàn, t tính bằng POSIX ms
window_start(e) = window_origin_ms + e × ms_per_epoch
window_end(e)   = window_origin_ms + (e + 1) × ms_per_epoch − 1
```

`ms_per_epoch` là độ dài epoch của chính mạng đó (`Utils/src/index.ts` ▸ `MS_PER_EPOCH_BY_NETWORK`):
`432_000_000` (5 ngày) trên Mainnet và Preprod, `86_400_000` (1 ngày) trên Preview. Với giá trị đó và
`window_origin_ms` lấy theo bảng §2, chỉ số cửa sổ **bằng đúng số epoch Cardano** của mạng, và biên
cửa sổ **trùng biên epoch** — tức trùng mốc snapshot stake của Cardano.

Hệ quả trên Preview: một cửa sổ dài 1 ngày, nên mọi lịch tính bằng cửa sổ (ví dụ nhả dần trong 36
cửa sổ) chạy nhanh gấp 5 lần Preprod. Bộ dựng nào nướng một `ms_per_epoch` cố định thay vì lấy theo
mạng thì phải từ chối mạng có độ dài epoch khác — ví dụ cụm canonical của Genesis
(`Genesis/scripts/_epochWindow.ts` ▸ `canonicalWindowOrigin`) từ chối Preview.

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
nếu kéo dài epoch Shelley về trước; Byron cũng dài 432_000 s trên Mainnet và Preprod (21_600 slot × 20 s).
Preview không có kỷ Byron: mốc Shelley của nó chính là epoch 0.

| Mạng | `window_origin_ms` | Kiểm |
|---|---|---|
| Mainnet | `1_506_203_091_000` | `1_596_059_091_000 − 208 × 432_000_000` |
| Preprod | `1_654_041_600_000` | `1_655_769_600_000 − 4 × 432_000_000` |
| Preview | `1_666_656_000_000` | `1_666_656_000_000 − 0 × 86_400_000` (mốc Shelley 2022-10-25T00:00:00Z) |

## 3. Test vector (mọi bên tích hợp chạy chung)

| Mạng | `t` (ms) | `window(t)` |
|---|---|---|
| Mainnet | `1_790_459_091_000` | `658` |
| Mainnet | `1_790_459_090_999` | `657` |
| Preprod | `1_790_553_600_000` | `316` |
| Preprod | `1_790_553_599_999` | `315` |
| Preview | `1_753_056_000_000` | `1000` |
| Preview | `1_753_055_999_999` | `999` |

Vector Preview đối chiếu Koios Preview `epoch_info?_epoch_no=1000` ▸ `start_time = 1_753_056_000`
(đo 2026-10-04).

`window_origin_ms = 0` vẫn là đầu vào hợp lệ của hàm, nhưng **không phân biệt được** bản có trừ
gốc với bản quên trừ gốc. Bộ kiểm của mỗi validator phải có ít nhất một ca với gốc Mainnet hoặc
Preprod — hai gốc này không chia hết cho `ms_per_epoch`. Gốc Preview **chia hết** cho `86_400_000`
(thương 19_290): ca Preview phân biệt được chỉ số (lệch 19_290) nhưng không phân biệt được pha của
biên, nên nó không thay được ca Mainnet/Preprod.

## 4. Danh mục trạng thái

Không còn mục treo. WIN-PREVIEW đóng ở v1.2: Preview dùng `ms_per_epoch = 86_400_000` và gốc ở §2.
Mạng không có trong bảng §2 vẫn bị `windowOriginMs` từ chối (fail-closed).

## 5. Validator mang tham số

`window_origin_ms` là tham số validator (WIN-ORIGIN-3) của 15 validator, đo trên `origin/main` `2be9ffb`:
`claim_account`, `beacon`, `treasury` (Distribution) · `pot_vault` (Distribution/pot-vault) · `claim_account`
(Allocation) · `faucet_nft`, `faucet_account`, `faucet_pool` (Faucet) · `custody` (Treasury) · `reserve_draw`
(Reserve) · `nullifier`, `vote`, `proposal`, `governance`, `tally` (Governance). Vị trí trong bộ tham số: xem chữ
ký `validator <tên>(` của từng tệp — ở `tally` nó đứng ngay trước `engage_policies`. Validator mới thêm sau mốc
đo trên không tự hiện ở danh sách này; tra lại bằng `git grep -l "window_origin_ms: Int" -- '*/validators/*.ak'`.
