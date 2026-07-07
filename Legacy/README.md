# Legacy — tài liệu lỗi thời (giữ để tra cứu lịch sử)

Thư mục này chứa doc đã bị quyết định mới thay thế. **KHÔNG dùng làm nguồn sự thật.** Mỗi file kèm lý do + bản canonical thay thế.

| File | Là gì | Bị thay bởi | Lý do lỗi thời |
|---|---|---|---|
| `TOKENOMICS-v3-DEPRECATED.md` | Tokenomics v3 (14/6, đơn vị "oildrop", era 1-token, bảng 18-pot cap cũ 34,2/1,8) | `../TOKENOMICS-v17-COMMUNITY-DRAFT.md` + `../LAMP-POT-CATALOG.md` | Tự đánh dấu DEPRECATED ở dòng 1; số cap không khớp v17 (26,370/9,630) |
| `lamp-mint-core-adapter-v1-anchor.md` | Adapter mint LAMP qua OrgDID theo mô hình **v1/anchor**: `validate_mint` đọc `controller_pkh` từ TAAD anchor, redeemer `CountMint`, SupplyState **3-field** | `../Genesis/ALLOCATION-SPEC.md` (§7a/§7b, v2/registry) | Quyết định canonical = **v2/registry-gate** (`Genesis/onchain/lib/magiclamp/genesis/registry.ak` dòng 1-6: "v2 THAY v1, LAMP KHÔNG còn đọc anchor"). Bản v1 này đã gây nhầm builder Core (xem message PhoenixKey §0). |

## Bối cảnh quyết định canonical (chốt)

Mint LAMP canonical = **v2/registry-gate** (branch `feat/lamp-mint-compose-anchor-cap`):
- Gate quyền qua **Registry NFT** (`token_tag → Authority`: SinglePkh / MultiSig / Revoked), KHÔNG đọc TAAD anchor.
- Redeemer `DistributionVest` (Distribution quota) / `ReserveDraw` (Reserve quota, permissionless).
- `SupplyState` **4-field**: `dist_minted, reserve_minted, dist_cap, reserve_cap`.
- **A-DEST ép on-chain**: Δ LAMP bắt buộc rót vào KHO (kho NFT), không ra ví.
- Ký để mint = **authority trong registry entry** (controller OrgDID qua Secure Enclave), không có khoá riêng của LAMP.

Nguồn sự thật hiện hành: `Genesis/onchain/validators/lamp_mint.ak` + `Genesis/onchain/lib/magiclamp/genesis/registry.ak` + `Genesis/ALLOCATION-SPEC.md`.

## Đã xoá hẳn (không giữ — chỉ là artifact tự sinh, 0 file git-tracked)
- `Tokenomics/` — module cũ, source đã đổi tên thành `Allocation/`; trên đĩa chỉ còn `onchain/build/` + `node_modules`.
- `PlatformKit/` — chỉ còn `node_modules`, vai trò đã chuyển sang `LaunchAPI/`.
- `protocol-utils/` — đã đổi tên thành `Utils/` (commit 9dd9efe).
