# LAMP — Token Mint Spec (Tokenomics, canonical)

> Spec tầng **MINT** LAMP: ai được phát hành, bao nhiêu, không bao giờ mint-lại-policy, an toàn khi khoá lộ.
> Trích từ code canonical đã merge (PR#11): `Tokenomics/onchain/validators/{did_token_mint,supply_state,mint_registry}.ak`,
> **138/138 aiken test**. Đơn vị nội bộ: **oil** (1 LAMP = 10⁶ oil). Phân phối pot → ví ở `../LAMP-DISTRIBUTION-SPEC.md`.

---

## 1. Nguyên lý

1. **Tổng cung CỐ ĐỊNH 36 tỷ LAMP, không đốt.** "Fixed-supply" = *tổng phát hành lịch sử ≤ cap*, đơn điệu tăng.
   Phần chưa phát hành (**Unminted**) chưa tồn tại on-chain → không khoá min-ADA, không bị tấn công.
2. **Tính DUY NHẤT của token ở PolicyID, không ở AssetName.** PolicyID neo bởi NFT one-shot (genesis_ref).
3. **Quyền phát hành đi theo DANH TÍNH (DID), không theo khoá.** Xoay khoá = sửa dữ liệu registry, KHÔNG redeploy policy.
4. **Cap là thuộc tính của token, bake vào policy.** Mỗi token một cap cố định verify-được, cùng engine tái dùng đa-token.

---

## 2. Ba validator + thứ tự tính hash (phá vòng)

| Validator | Vai trò | Param |
|---|---|---|
| `mint_registry` | bảng authority (DID Authorization Registry) | governing_did, genesis_ref_R, taad_policy |
| `supply_state` | bộ đếm phát hành, ép cap | genesis_ref_S, state_name, **cap** |
| `did_token_mint` | minting policy LAMP (gate WHO + ép-đếm) | registry_nft_policy/name, action_tag, token_asset_name, require_supply_state, supply_state_nft_policy/name |

**Thứ tự hash BẮT BUỘC một-chiều** (sai = circular, kẹt deploy):
```
1. taad_policy            = hash TAAD validator (PhoenixKey, đã deploy)
2. registry_nft_policy    = hash mint_registry(governing_did, genesis_ref_R, taad_policy)
3. supply_state_policy    = hash supply_state(genesis_ref_S, state_name, cap)   ← KHÔNG param lamp_policy
4. lamp_policy            = hash did_token_mint(registry_nft_policy, …, supply_state_nft_policy=(3), …)
5. supply_state DATUM.lamp_policy = giá trị (4)   ← PHÁ VÒNG: lamp_policy nằm trong DATUM, không phải param
```
`supply_state` không param theo lamp_policy (chuyển vào datum, bất biến qua spend) → hash độc lập did_token_mint →
phụ thuộc 1 chiều, hết vòng. ⚠️ aiken check KHÔNG bắt circular (test dùng hash hằng) → **verify param-dependency thủ công** trước deploy.

---

## 3. `did_token_mint` — gate phát hành (2 lớp)

Nguồn: `validators/did_token_mint.ak`.
- **Lớp 1 — WHO + asset-name** (`registry.validate_token_mint`): đọc 1 registry NFT (reference input) → tra **đúng-1**
  entry `action_tag` (fail-closed) → ép Authorization (SinglePkh 1 ký / MultiSig M-of-N / Revoked→fail); + khoá mint
  đúng 1 asset-name = `token_asset_name`, qty>0 (C-1).
- **Lớp 2 — ép-đếm (opt-in)** (`require_supply_state=True`): tx PHẢI spend đúng 1 SupplyState NFT → buộc bộ đếm chạy
  (lớp cap). Token tổng quát không cap → `require_supply_state=False`.

> **KHÔNG ép recipient on-chain** (không A-DEST). Recipient (địa-chỉ-pot) do builder tx set. An toàn khi khoá lộ
> dựa **DID-controller** (§6), không dựa "ép vào kho".

---

## 4. `supply_state` — bộ đếm + cap

Nguồn: `validators/supply_state.ak`.
- **Genesis:** mint NFT thread one-shot, hard-bind Script(own), `minted_total = 0`.
- **Spend (mỗi lần mint LAMP):** consume + tái-tạo; ép `minted_total' = minted_total + minted_amount ≤ cap`, **đơn điệu**
  (không giảm) → tổng phát hành lịch sử ≤ cap vĩnh viễn.
- **cap = PARAM bake** (LAMP: `36_000_000_000_000_000` oil = 36 tỷ × 10⁶). Đa-token: cùng engine, cap riêng (framework).
- `lamp_policy`/`lamp_asset_name` trong **DATUM** (set genesis, bất biến) — token được đếm; đồng thời là chỗ phá-vòng (§2).

---

## 5. `mint_registry` — DID Authorization Registry

Nguồn: `validators/mint_registry.ak` (+ lib `tokenomics/registry.ak`). Primitive dùng-chung đã-audit.
> **action_tag** = nhãn logic ổn định định danh một dòng-token trong bảng registry (khoá tra cứu authority).
> KHÁC `token_asset_name` (nhãn token on-chain): tách hai để asset-name đổi được mà khoá tra-cứu vẫn ổn định.
- **Datum** (khớp code `tokenomics/registry.ak`): `RegistryDatum{ governing_did, entries: List<Entry> }`;
  `Entry{ action_tag, authority: Authorization }`; `Authorization = SinglePkh(pkh) | MultiSig{pkhs, threshold} | Revoked`.
  *(field tên là `authority`, kiểu là `Authorization`).*
- **Genesis:** one-shot (bind genesis_ref) + no-dup action_tag + NFT hard-bind Script(own).
- **Update:** chỉ **controller DID hiện tại** ký (đọc động `controller_pkh` từ TAAD anchor → rotate/recovery tự theo).
- **Lợi:** least-privilege/token · token đối tác MultiSig · thu hồi 1 token (Revoked) — KHÔNG đẻ khoá theo token, KHÔNG redeploy khi xoay.

---

## 6. Q1 (không redeploy) + Q2 (an toàn khi khoá lộ)

- **Q1 — policy-id bất biến:** mọi param bake là danh-tính-vĩnh-viễn (NFT one-shot) hoặc hằng; thứ động (controller)
  đọc qua reference input; DAG hash phá-vòng (§2). ⟹ xoay/khôi-phục khoá KHÔNG đổi policy-id.
  *Điều kiện ngoài:* `registry_nft_policy` phụ thuộc `taad_policy` → cần PhoenixKey đóng băng nền TAAD (schema_version) để miễn nhiễm TAAD-redeploy.
- **Q2 — khoá lộ không mất kho:** authority = **controller GreenSun OrgDID** (Secure Enclave, sinh trắc, **xoay + khôi-phục được**).
  Lộ/nghi khoá → **set entry Revoked** bằng controller còn-sống (KHÔNG giết DID — giết DID đóng băng registry). Khoá cũ
  xoay/vô-hiệu vẫn mint được vì policy đọc controller **HIỆN TẠI**. Đây thay cho seed 1-of-1 online.

---

## 7. Framework dùng-chung
`token_asset_name` + `action_tag` + `cap` (supply_state) + registry đều param ⇒ một engine phát hành mọi token hệ:
LAMP (cap 36 tỷ), token đối tác (cap riêng, MultiSig) — policy-id riêng, verify cap từ chain. Khớp **PlatformKit**.

---

## 8. Policy IDs (ĐIỀN SAU genesis GreenSun-DID — chưa tồn tại)

**Policy LAMP hiện hành (provisional, ĐANG LIVE mainnet):**
`55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` — [cexplorer](https://cexplorer.io/policy/55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0).
Đây là bản **bootstrap 1-of-1** (authority = seed online), dùng tạm. Sẽ **redeploy → `lamp_policy` mới** (bảng dưới)
do GreenSun OrgDID điều khiển, rồi retire seed cũ. Spec/docs công bố cho cộng đồng **chỉ SAU** bước redeploy đó.

⚠️ Các policy-id **MỚI** dưới được **TÍNH lúc deploy** theo thứ tự hash §2 (từ genesis_ref + cap + governing_did GreenSun),
**chưa tồn tại** tới khi genesis qua GreenSun OrgDID → khi đó điền giá trị thật:

| Định danh | Giá trị (điền sau genesis) | = |
|---|---|---|
| `taad_policy` | `<TBD>` | hash TAAD validator (PhoenixKey, mainnet) |
| `governing_did` (GreenSun) | `<TBD>` | DID GreenSun OrgDID |
| `registry_nft_policy` | `<TBD>` | hash mint_registry(governing_did, genesis_ref_R, taad_policy) |
| `registry_nft_name` | `<TBD>` | = blake2b_256(governing_did) |
| `supply_state_policy` | `<TBD>` | hash supply_state(genesis_ref_S, state_name, cap=36×10¹⁵) |
| `state_name` | `LAMP-SUPPLY` | name NFT thread SupplyState |
| **`lamp_policy`** | `<TBD>` | hash did_token_mint(registry_nft_policy, …, supply_state_policy, …) — **policy LAMP chính thức** |
| `token_asset_name` | `4c414d50` ("LAMP") | asset-name mainnet (testnet `744c414d50` "tLAMP") |
| `action_tag` | `4c414d50` ("LAMP") | khoá tra-cứu trong registry |

> Khi điền, ghi kèm **tx genesis** từng bước (B1–B4) + tx mint C đầu tiên làm chứng. cexplorer policy/`lamp_policy`.

## 9. Deploy
Runbook đầy đủ: `PhoenixKeyDID/spec-proposals/LAMP-DID-Mint-DEPLOY-RUNBOOK.md` (thứ tự hash A → setup B1-B4 → mint C → submit D → retire seed E).
Builder Core: `PhoenixKey-Core feat/registry-mint-builders` (FFI). Submit backend (D, Launch-team): fetch Blockfrost → evaluate-patch ExUnits → submit → poll (đang build, chờ builder Core về local để wire).
- **Trạng thái:** on-chain canonical 138/138 aiken test, plutus.json build, PR#11 merged. Mainnet: chờ dry-run preprod → duyệt.
