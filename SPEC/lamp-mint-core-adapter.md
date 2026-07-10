# LAMP mint qua OrgDID — spec-adapter cho PhoenixKey Core (`build_mint_lamp_via_did`)

> **CHỐT (2026-07-06): Model = cap-36B OrgDID lazy-mint. Validator canonical = B** (Registry-gate +
> DistributionVest + SupplyState 4-field + A-DEST on-chain). `55d3e01b…` mainnet = placeholder bootstrap,
> sẽ supersede. Đây là bản Core ĐÃ build (registry schema mirror `registry_mint.rs`).
>
> Nguồn on-chain (branch `feat/lamp-mint-compose-anchor-cap`, sẽ merge main):
> `Genesis/onchain/validators/lamp_mint.ak`, `.../supply_state.ak`, `.../dist_treasury.ak`,
> `lib/magiclamp/genesis/{types,registry}.ak`.
> Đơn vị: **1 LAMP = 10⁶ base (oil), decimals = 6.** Mọi `amount`/`Δ` dưới đây là **base unit**.

## 0. Ba validator ghép trong 1 tx mint LAMP
- **`lamp_mint`** (mint policy) — gate **AI** (Registry) + **tên token** + **route** + **A-DEST** (rót vào KHO).
- **`supply_state`** (spend, redeemer `Advance`) — gate **BAO NHIÊU** (`dist_minted'≤dist_cap`, đơn điệu).
- **`registry`** (ref input, KHÔNG spend) — bảng `token_tag → Authority` do OrgDID quản.

## 1. `lamp_mint` — điều kiện ÉP (đường DistributionVest, verified)
Tx mint LAMP (phân phối) hợp lệ ⟺ TẤT CẢ:
1. **mint:** `tx.mint` dưới `lamp_policy` = ĐÚNG 1 asset-name `token_name` (="LAMP" `4c414d50`), **qty Δ>0** (no-burn/qty0/đa-name).
2. **redeemer** = `DistributionVest` (Constr 0). (`ReserveDraw` = Constr 1 = đường Reserve, permissionless, §5.)
3. **WHO (Registry):** `registry.validate_mint` — có **ĐÚNG 1 reference input** mang Registry NFT
   `(registry_nft_policy, registry_nft_name)`; decode `RegistryDatum`; tìm entry `token_tag`==param;
   **Authority của entry thoả** (SinglePkh → pkh ∈ sigs / MultiSig → ≥ threshold / Revoked → fail).
4. **A-DEST (WHERE):** đọc `kho_hash` động từ ref input mang `kho_nft` → **`qty_to_script(outputs, kho_hash, lamp_policy, token_name) ≥ Δ`** — TOÀN BỘ Δ rót vào KHO, KHÔNG ra ví.
5. **cap** (qua supply_state, §2): `dist_minted' = dist_minted+Δ ≤ dist_cap`.

## 2. `supply_state` (spend, redeemer `Advance`) — ÉP
- **datum** `SupplyState = Constr 0 [dist_minted:Int, reserve_minted:Int, dist_cap:Int, reserve_cap:Int]`.
- input+continuing-output ĐÚNG 1 mỗi bên tại `Script(own)`, giữ SUPPLY NFT; datum sạch (không kèm LAMP).
- `dist_cap`/`reserve_cap` **bất biến** qua transition. Route DistributionVest chỉ đụng `dist_minted`; ReserveDraw chỉ đụng `reserve_minted`.
- ép `dist_minted' ≤ dist_cap`, `reserve_minted' ≤ reserve_cap`, và trần tổng `dist_minted'+reserve_minted' ≤ dist_cap+reserve_cap` (= 36 tỷ × 10⁶). Đơn điệu (không rollback).

## 3. Registry schema — MIRROR BYTE-PERFECT (Core đã có ở `registry_mint.rs`)
```
RegistryDatum = Constr 0 [ governing_did: Bytes, entries: List<RegistryEntry> ]
RegistryEntry = Constr 0 [ token_tag: Bytes, authority: Authority ]
Authority:  SinglePkh = Constr 0 [pkh: Bytes]
            MultiSig  = Constr 1 [pkhs: List<Bytes>, threshold: Int]
            Revoked   = Constr 2 []
Registry-NFT: policy ≡ registry script hash ; name = blake2b_256(governing_did)
```
**Reconcile PhoenixKey:** set entry LAMP `authority = SinglePkh{controller_pkh OrgDID}` (hoặc
`MultiSig{[controllers], m}`) → **Enclave OrgDID ký DistributionVest** qua đường registry. Không cần
emission-authority riêng. Xoay khoá vận hành = controller DID Active sửa registry (tầng Registry validator).

## 4. Công thức tx Core dựng (`build_mint_lamp_via_did`, route DistributionVest)
```
Inputs (spend):
  • UTxO SupplyState hiện tại (mang SUPPLY NFT)     — redeemer Advance
  • UTxO phí/collateral của người dựng tx
Reference inputs (KHÔNG spend):
  • Registry NFT UTxO  (bảng token_tag→authority)
  • KHO NFT UTxO       (để đọc kho_hash cho A-DEST)
Mint:
  • +Δ (lamp_policy, "LAMP")                        — redeemer lamp_mint = DistributionVest
Outputs:
  • SupplyState continuing @ Script(supply_state): SUPPLY NFT + minADA, datum {dist_minted+Δ, …3 field giữ}
  • KHO @ kho_hash: ≥ Δ LAMP                         ← A-DEST bắt buộc, KHÔNG ra ví
Required signers:
  • authority của entry token_tag (= controller_pkh OrgDID nếu SinglePkh; hoặc ≥m nếu MultiSig)
Scripts đính: lamp_mint (mint) + supply_state (spend). Validity TTL hợp lý.
```

## 5. ReserveDraw (đường Reserve — KHÔNG liên quan PhoenixKey mint)
Permissionless: KHÔNG chữ ký; ép tx spend ĐÚNG 1 UTxO mang `meter_nft` (= reserve_thread) → `reserve_draw`
ép δ ≤ E/1000/epoch. Core **không** dùng đường này cho mint-by-OrgDID.

## 6. Tham số bake `lamp_mint` (12) — LAMP cấp khi deploy
`thread_nft_policy/name` (SUPPLY NFT) · `token_name` ("LAMP") · `dist_cap` · `reserve_cap`
(LAMP = 26,37 tỷ + 9,63 tỷ ×10⁶) · `registry_nft_policy/name` · **`token_tag`** — **CHỐT 2026-07-10**:
`#"4c414d50"` (UTF-8 "LAMP"), hằng số `constants.lamp_token_tag` (`Genesis/onchain/lib/magiclamp/genesis/constants.ak`)
· `kho_nft_policy/name` · `meter_nft_policy/name`.

## 7. Đơn vị — cảnh báo 10⁶
Explorer hiện `decimals 0` (thiếu metadata) → hiển thị raw base. Core + backend LUÔN coi 1 LAMP = 10⁶ base;
`Δ` truyền builder là **base unit**. Không lấy số explorer làm số LAMP.

## 8. Trạng thái phối hợp
| Phần | Trạng thái | Ai |
|---|---|---|
| `lamp_mint`+`supply_state`+`registry`(schema mirror rs) | on-chain sẵn (branch B), **chờ merge main** | LAMP |
| `registry_write` (Registry write-side: Deploy genesis + Update entries, gate qua TAAD anchor `controller_pkh`) | **on-chain sẵn 2026-07-10** (`Genesis/onchain/validators/registry_write.ak` + `lib/.../registry_write_logic.ak`, 37 test mới, `aiken check` 108/108), **chờ merge main** — redeemer empty-constr khớp byte-perfect `registry_mint.rs` (deploy §605-619, update §770-788), KHÔNG cần Core sửa builder | LAMP |
| `registry_mint.rs` (schema registry) | Core đã có (mirror) | Core |
| `build_mint_lamp_via_did` route DistributionVest + Advance + A-DEST | sửa theo §4 (thêm registry+KHO ref, output KHO) | Core |
| Intent `LAMP_MINT` + endpoint + gom m-of-n | thiếu | Long |
| Deploy Genesis Preview SUBMIT=true → cấp policy-id/CBOR/SUPPLY-NFT ref | chờ Preview wallet seed | LAMP (em chạy) |
| KHO release → ETD/Airdrop (vesting claim_account) | **chưa dựng** (dist_treasury mới bootstrap authority-sig) | LAMP |
| Signer = controller OrgDID (Enclave), set làm registry authority | **xác nhận** | anh + PhoenixKey |
