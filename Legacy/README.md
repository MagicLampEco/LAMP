# Legacy — tài liệu lỗi thời (giữ để tra cứu lịch sử)

Thư mục này chứa doc đã bị quyết định mới thay thế. **KHÔNG dùng làm nguồn sự thật.** Mỗi file kèm lý do + bản canonical thay thế.

| File | Là gì | Bị thay bởi | Lý do lỗi thời |
|---|---|---|---|
| `TOKENOMICS-v3-DEPRECATED.md` | Tokenomics v3 (14/6, đơn vị "oildrop", era 1-token, bảng 18-pot cap cũ 34,2/1,8) | `../Specs/TOKENOMICS-v17-COMMUNITY-DRAFT.md` + `../Specs/LAMP-POT-CATALOG.md` | Tự đánh dấu DEPRECATED ở dòng 1; số cap không khớp v17 (26,370/9,630) |
| `lamp-mint-core-adapter-v1-anchor.md` | Adapter mint LAMP qua OrgDID theo mô hình **v1/anchor**: `validate_mint` đọc `controller_pkh` từ TAAD anchor, redeemer `CountMint`, SupplyState **3-field** | `../Genesis/ALLOCATION-SPEC.md` (§7a/§7b, v2/registry) | Quyết định canonical = **v2/registry-gate** (`Genesis/onchain/lib/magiclamp/genesis/registry.ak` dòng 1-6: "v2 THAY v1, LAMP KHÔNG còn đọc anchor"). Bản v1 này đã gây nhầm builder Core (xem message PhoenixKey §0). |
| `Tokenomics-v1-anchor/onchain/` | Module mint **v1/anchor** (9 validator): `lamp_mint.ak` (đọc `phoenixkey.validate_mint`, redeemer `CountMint`), `supply_state.ak` + `supply.ak` (SupplyState **3-field**), `did_token_mint.ak`, `mint_registry.ak`, 2 example | `../Genesis/onchain/validators/lamp_mint.ak` (v2/registry-gate, 4-field) | **Trùng tên `lamp_mint.ak`** với bản canonical ở Genesis → dev/agent dễ mở nhầm bản 3-field. Dời khỏi cây build (không có `aiken.toml` → `aiken check` chưa từng chạy vào đây). |

## Bối cảnh quyết định canonical (chốt)

Mint LAMP canonical = **v2/registry-gate** (branch `feat/lamp-mint-compose-anchor-cap`):
- Gate quyền qua **Registry NFT** (`token_tag → Authority`: SinglePkh / MultiSig / Revoked), KHÔNG đọc TAAD anchor.
- Redeemer `DistributionVest` (Distribution quota) / `ReserveDraw` (Reserve quota, permissionless).
- `SupplyState` **4-field**: `dist_minted, reserve_minted, dist_cap, reserve_cap`.
- **A-DEST ép on-chain**: Δ LAMP bắt buộc rót vào KHO (kho NFT), không ra ví.
- Ký để mint = **authority trong registry entry** (controller OrgDID qua Secure Enclave), không có khoá riêng của LAMP.

Nguồn sự thật hiện hành: `Genesis/onchain/validators/lamp_mint.ak` + `Genesis/onchain/lib/magiclamp/genesis/registry.ak` + `Genesis/ALLOCATION-SPEC.md`.

## Đã đổi tên / dời (không xoá — tra bảng trên hoặc lịch sử git)
- `Tokenomics/onchain/` (v1-anchor, 9 validator) — **đã dời vào `Legacy/Tokenomics-v1-anchor/onchain/`** (bảng trên). Source phân bổ canonical = `Allocation/`.
- `protocol-utils/` — đã đổi tên thành `Utils/` (commit 9dd9efe).

_Ghi chú: `PlatformKit/` (36 file) là framework onboarding platform **đang dùng** (đến từ main qua PR#11), KHÔNG lỗi thời — không nằm trong Legacy._
