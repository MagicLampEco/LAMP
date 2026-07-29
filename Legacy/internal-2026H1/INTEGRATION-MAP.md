# LAMP — Bản đồ tích hợp & sắp xếp (2026-06-14)

> Mục đích: gỡ phân mảnh 13 nhánh + 1 worktree thành MỘT nhánh mạch lạc cho launch 18/6.
> KHÔNG tự merge — đây là kế hoạch chờ anh duyệt.

## 1. Hiện trạng nhánh (ai có gì)

| Nhánh | Ngày | Module có source | Vai trò |
|---|---|---|---|
| `main` | 06/06 | Distribution, Treasury, Governance/VP, protocol-utils. **+ Tokenomics, Reserve, Distribution/channels (UNTRACKED, chưa commit)** | gốc, nhưng cũ + có việc mới chưa commit |
| `feat/genesis-lazymint` (worktree `LAMP-genesis-wt`) | 11/06 | **Genesis (lazy-mint mới nhất)**, Distribution, Treasury, Governance, protocol-utils | mint layer |
| `integrate/final-live` | 08/06 | Genesis, Deposits, Distribution, Governance, Treasury, protocol-utils | bản tích hợp gần nhất (thiếu Tokenomics/Reserve) |
| `integrate/genesis-deposits-live` | 08/06 | (như trên) | tích hợp cũ hơn |
| `integrate/e2e-demo` | — | Faucet, Distribution, Governance, Treasury | demo cũ (Faucet thay bằng Genesis) |
| `feat/tlamp-faucet` | — | Faucet (tLAMP fixed-supply + pool claim 100) | **GIỮ** — dev lấy tLAMP test trên Preview; cần gộp vào launch-1806 |
| `feat/deposits-pot`, `feat/deposits-v2` | — | Deposits | pot ký quỹ |
| `feat/treasury-*`, `feat/governance-vp-v1` | — | biến thể Treasury/Governance | đã gộp vào integrate |
| `docs/fee-did-token-boundary` | — | Reserve cũ (cap_release, ĐÃ BỎ) + specs | tham chiếu |

## 2. Vấn đề
1. **Không nhánh nào đủ bộ 18/6**: cần Genesis + Tokenomics + Reserve + Distribution + Treasury + Governance + Deposits cùng chỗ.
2. **main lạc hậu** (06/06) < integrate/final-live (08/06) < genesis-lazymint (11/06) < việc mới (14/06).
3. **Việc 14/6 (Tokenomics, Reserve) chưa commit** — đang nằm untracked trên main working tree.
4. **Thư mục build/ mồ côi** trên main (Faucet/Reserve/Governance) — source ở nhánh khác, chỉ còn cặn build trên đĩa.
5. **Faucet GIỮ (không xóa)** — đây là vòi tLAMP cho dev test trên Preview (claim 100). KHÁC Genesis (Genesis = mint thật 36 tỷ; Faucet = phát tLAMP test miễn phí). Source ở `feat/tlamp-faucet`, cần gộp vào launch-1806. Build artifact mồ côi trên main vẫn dọn được (regenerate bằng aiken build), nhưng SOURCE phải giữ.

## 3. Lộ trình hợp nhất đề xuất (chờ anh chọn)

### Phương án A — Nhánh tích hợp mới `integrate/launch-1806` (KHUYẾN NGHỊ)
1. Tạo `integrate/launch-1806` từ `feat/genesis-lazymint` (có Genesis mới nhất + Deposits chưa? — cần thêm).
2. Merge `integrate/final-live` (lấy Deposits).
3. Commit Tokenomics + Reserve mới (từ working tree 14/6) vào nhánh này.
4. ✅ Sửa cap Genesis 34,2/1,8 → 26,370/9,630 (v17) — ĐÃ XONG.
5. `aiken check` toàn bộ + offchain test toàn bộ → xanh.
6. Đây thành nhánh deploy 18/6. main giữ nguyên tới khi ổn, rồi fast-forward.
- *Ưu:* sạch, không phá main, có điểm lùi. *Nhược:* 1 lần merge có xung đột (Treasury sửa cả 2 bên).

### Phương án B — Commit thẳng việc mới lên main rồi merge dồn
- Nhanh hơn nhưng main đang cũ → dễ mất công việc integrate. KHÔNG khuyến nghị.

### Tách bạch 2 thư mục đĩa
- `Projects/LAMP` = nhánh tích hợp/main (làm việc chính).
- `Projects/LAMP-genesis-wt` = worktree — sau khi merge Genesis xong thì **gỡ worktree** (`git worktree remove`) để hết trùng lặp trên đĩa, hoặc giữ làm sandbox Genesis.

## 4. Dọn rác (tier an toàn — đã/sẽ làm)
- [x] `.DS_Store`: untrack 1 file tracked + xóa rác + thêm .gitignore.
- [ ] `build/` mồ côi (Faucet/Reserve/Governance trên main): xóa sau khi 2 agent xong `aiken check` (regenerate bằng `aiken build`).
- [ ] `Faucet/` trên main: chỉ xóa BUILD artifact mồ côi trên đĩa (regenerate được); GIỮ source — gộp `feat/tlamp-faucet` vào launch-1806.
- [ ] `plutus.json`: đã .gitignore — thống nhất không track.

## 5. Việc CẦN anh quyết
1. Chọn Phương án hợp nhất (A khuyến nghị).
2. Gỡ worktree `LAMP-genesis-wt` sau merge, hay giữ?
3. Gộp Faucet (`feat/tlamp-faucet`) + Deposits (`integrate/final-live`) vào launch-1806 luôn, hay để bước sau?
