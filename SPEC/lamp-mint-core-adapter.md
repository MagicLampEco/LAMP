# LAMP mint qua OrgDID — spec-adapter cho PhoenixKey Core (`build_mint_lamp_via_did`)

> Mục tiêu: Core (rust_core) dựng tx mint LAMP khớp CHÍNH XÁC validator on-chain.
> Nguồn sự thật on-chain: `Tokenomics/onchain/lib/magiclamp/tokenomics/phoenixkey.ak::validate_mint`
> + `Tokenomics/onchain/validators/supply_state.ak` (+ `lib/.../supply.ak`).
> Đơn vị: **1 LAMP = 10⁶ base (oildrop), decimals = 6.** Mọi `amount` dưới đây là **base unit**.

## 0. Bức tranh — 2 validator ghép trong 1 tx
Mint LAMP hợp lệ = 1 tx đồng thời:
- **`lamp_mint`** (mint policy) — gate **AI mint** (authority OrgDID) + **tên token** (asset-name).
- **`supply_state`** (spend) — gate **BAO NHIÊU** (bộ đếm ≤ cap 36 tỷ LAMP). `lamp_mint` KHÔNG tự cap.

`lamp_mint` KHÔNG tự đọc `supply_state`; ràng buộc cap đến từ việc tx PHẢI spend UTxO SupplyState
(mang SUPPLY NFT) trong cùng tx → validator supply_state chạy → ép `minted_total' ≤ cap`.

## 1. Điều kiện `lamp_mint`/`validate_mint` ÉP (verified)
Tx mint LAMP hợp lệ ⟺ TẤT CẢ:
1. **(a)** `tx.mint` dưới `lamp_policy` = ĐÚNG 1 asset-name `lamp_asset_name` (`4c414d50`="LAMP"), **qty > 0** (chặn burn/qty0/đa-name).
2. **(b)+(c)** tx có **reference input** mang **anchor NFT** của OrgDID `(anchor_nft_policy, anchor_nft_name)` — datum decode được (`TAADDatum`).
3. **(d)** `anchor.controller_pkh` ∈ `tx.extra_signatories` — **controller hiện tại của OrgDID ký**.
4. **(e)** `anchor.status` = **Active**.
5. **(f)** `anchor.entity_type` = **Org**.

> **Anchor NFT** (CIP-31 reference, KHÔNG spend): `anchor_nft_policy` = **TAAD validator script hash**;
> `anchor_nft_name` = **`blake2b_256(org_did)`**. Controller đổi (rotate/recovery) → sửa TAAD datum,
> `lamp_policy` BẤT BIẾN (quyền mint tự đi theo DID).

## 2. Điều kiện `supply_state` (spend, redeemer `CountMint`) ÉP
Spend UTxO SupplyState hợp lệ ⟺:
- **(s1)** own_input mang SupplyState NFT `(state_nft_policy, state_name)` qty 1.
- **(s2)** ĐÚNG 1 input tại `Script(own)` mang SupplyState NFT (chống nhân đôi bộ đếm).
- **(s3)** continuing output: ĐÚNG 1 output tại `Script(own)` giữ SupplyState NFT + datum.
- **(s4)** `minted_amount` = qty `(lamp_policy, lamp_asset_name)` trong `tx.mint` (đọc policy/name TỪ DATUM).
- **cap:** `minted_total' = minted_total + minted_amount`, ép **`minted_total' ≤ CAP`** (đơn điệu, ≤ 36 tỷ × 10⁶ base).
- datum bất biến trừ `minted_total`: `lamp_policy` / `lamp_asset_name` giữ nguyên.

> Datum: `SupplyStateDatum { minted_total: Int, lamp_policy: PolicyId, lamp_asset_name: AssetName }`.

## 3. Công thức tx Core phải dựng (`build_mint_lamp_via_did`)
```
Inputs:
  • (spend) UTxO SupplyState hiện tại  (mang SUPPLY NFT)  — redeemer CountMint
  • (spend) UTxO trả phí của người dựng tx (collateral + fee)
Reference inputs:
  • UTxO mang anchor NFT của OrgDID (TAAD state)          — CIP-31, KHÔNG spend
Mint:
  • +Δ (lamp_policy, "LAMP")   — redeemer lamp_mint = Mint  (Δ = số LAMP × 10⁶ base)
Outputs:
  • SupplyState continuing output tại Script(supply_state):
      value = SUPPLY NFT + min-ADA (KHÔNG kèm LAMP)
      datum = { minted_total + Δ, lamp_policy, lamp_asset_name }   (2 field sau giữ nguyên)
  • Đích nhận Δ LAMP  (xem §4 A-DEST)
Required signers (extra_signatories):
  • controller_pkh của OrgDID   (đọc từ TAAD datum; m-of-n → xem §5)
Scripts đính kèm:
  • lamp_mint (mint policy)  +  supply_state (spend validator)
Validity: đặt TTL hợp lý.
```

## 4. A-DEST — đích nhận Δ LAMP
- **Bản OrgDID-anchor thuần (main):** validator KHÔNG ép đích → Core PHẢI tự gửi Δ vào **kho phân phối
  có kiểm soát** (không ra ví vận hành) để đúng chính sách A-DEST (§8 explainer).
- **Bản compose-cap (branch `feat/lamp-mint-compose-anchor-cap`):** A-DEST **ép on-chain** — route
  `DistributionVest` BẮT BUỘC rót Δ vào kho `(kho_nft_policy/name)`; redeemer là `DistributionVest`
  (không phải `Mint`), thêm route `ReserveDraw` permissionless. Nếu bản này lên main, §3 đổi:
  redeemer route + output Δ vào kho là RÀNG BUỘC validator, không phải tùy Core.
> **CẦN CHỐT (blocker):** Core build theo bản nào? (main OrgDID-anchor + CountMint) vs
> (compose: DistributionVest/ReserveDraw + registry WHO-gate + A-DEST on-chain). Hai bản khác
> redeemer + mô hình authority. Spec này mặc định **bản OrgDID-anchor** (đúng `build_mint_lamp_via_did`).

## 5. m-of-n
`validate_mint` (main) kiểm **một** `controller_pkh`. Muốn m-of-n:
- hoặc `controller_pkh` = **hash native-multisig** (tx gom đủ m vkey-witness khớp script) — khi đó
  PhoenixKey `/sign/request` gom m chữ ký rồi mới hợp lệ;
- hoặc TAAD hỗ trợ **threshold controller** (validator kiểm ≥ m trong danh sách) — hiện main KHÔNG có.
> Xác nhận với LAMP: controller là single-pkh hay multisig-hash, để Core gom chữ ký đúng.

## 6. Schema phải khớp CBOR (rust_core ↔ Aiken)
| Type | Field (đúng thứ tự = constructor index) |
|---|---|
| `TAADDatum` | `controller_pkh`, `status` (Active/…), `entity_type` (Org/Person), … (xem `phoenixkey.ak`) |
| `SupplyStateDatum` | `minted_total: Int`, `lamp_policy: PolicyId`, `lamp_asset_name: AssetName` |
| `LampMintRedeemer` | `Mint` (Constr 0, rỗng) — hoặc route `DistributionVest`/`ReserveDraw` (bản compose) |
| `SupplyStateRedeemer` | `CountMint` (Constr 0, rỗng) |

## 7. Trạng thái phối hợp
| Phần | Trạng thái | Ai |
|---|---|---|
| `lamp_mint` + `supply_state` + `validate_mint` | on-chain sẵn (main) | LAMP |
| Builder mẫu Lucid (compose lamp_mint + SupplyState) | có: `Genesis/offchain/src/mintBuilder.ts` (branch compose) | LAMP |
| `build_mint_lamp_via_did` **compose SupplyState** | thiếu — Core bổ sung theo §3 | Core |
| Intent `LAMP_MINT` + endpoint + gom m-of-n | thiếu | Long (Specs#8) |
| Chốt bản canonical (main vs compose) + controller single/multisig | **BLOCKER** | anh + LAMP |

## 8. Đơn vị — cảnh báo tránh lỗi 10⁶
Explorer hiện `decimals 0` (thiếu metadata) → hiển thị raw base. Core + backend LUÔN coi **1 LAMP = 10⁶ base**;
`amount` truyền vào builder là **base unit**. Không lấy số explorer làm số LAMP.
