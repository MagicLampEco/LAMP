# LAMP — Token Allocation & Mint Spec (v2, registry + cap-param + A-DEST)

> **Phạm vi.** Đây là spec CHUẨN cho việc **phân bổ + phát hành** token LAMP trên Cardano
> (PlutusV3 / Aiken). Thay v1 (`CONTRACT.md`, bản pre-registry 8-param `dist_dest`). Mọi số
> liệu, datum, luật trong tài liệu này được trích từ code đã verify (71/71 aiken VM test) +
> đã chạy thật trên Preview (xem §13). Đơn vị nội bộ: **oil** (1 LAMP = 10⁶ oil).

---

## 0. Tóm tắt một trang

- **Tổng cung CỐ ĐỊNH 36 tỷ LAMP, KHÔNG burn.** "Fixed-supply" = *tổng phát hành lịch sử ≤ CAP*,
  đơn điệu tăng. Token chưa mint = chưa tồn tại on-chain (không khoá min-ADA, không bị tấn công).
- **Phân bổ 2 quota** (cùng một bộ đếm `SupplyState`):
  - **Distribution = 26,37 tỷ LAMP** (đường vesting/cộng đồng/đối tác) — gate WHO bằng registry.
  - **Reserve = 9,63 tỷ LAMP** (đường DAO nhả-thuật-toán) — permissionless, **gate theo mức Treasury** (trần 2% / sàn 1% lưu hành; §7b).
- **3 câu hỏi nền** mà thiết kế trả lời:
  - **Q1 — không bao giờ mint lại policy** (policy-id bất biến qua mọi lần xoay khoá).
  - **Q2 — ký được kể cả khi seed lộ** mà pot không bị cướp (A-DEST + kho nhả-vesting).
  - **Framework dùng-chung** — cùng một source phát hành LAMP (36 tỷ), FARM (12 tỷ), … khác nhau ở apply-param.
- **Không ai mint LAMP tuỳ tiện.** Mọi tx mint phải consume + recreate `SupplyState` (ghim bởi
  thread NFT one-shot DUY NHẤT), cộng đúng quota theo redeemer, ≤ cap, đơn điệu, no-burn.

---

## 1. Nguyên lý (first-principles)

1. **Fixed-supply không cần mint sẵn.** 36 tỷ token nằm sẵn on-chain là lãng phí + bề mặt tấn công.
   Một bộ đếm đơn điệu chặn tại CAP thoả mạnh hơn: chưa mint = không tồn tại.
2. **Tính DUY NHẤT của token nằm ở PolicyID, không ở AssetName.** PolicyID neo bởi `genesis_ref`
   one-shot của thread NFT (tuyến tính apply-param). AssetName chỉ là nhãn.
3. **Quyền đi theo DANH TÍNH (DID), không theo khoá.** Xoay khoá = sửa dữ liệu (registry entry),
   KHÔNG redeploy policy. → Q1.
4. **Quyền mint chỉ "bơm vào kho", không "rút ra ví".** Tách quyền-tạo khỏi quyền-tiêu. → Q2.
5. **Cap là thuộc tính của token, bake vào policy-id.** Mỗi token một cap cố định verify-được từ
   policy-id; cùng source tái dùng cho nhiều token. → framework.

---

## 2. Phân bổ (allocation) + hằng số

Nguồn: `Genesis/onchain/lib/magiclamp/genesis/constants.ak`.

| Hằng | Giá trị (oil) | LAMP | Ý nghĩa |
|---|---|---|---|
| `oil_per_lamp` | 1 000 000 | — | 1 LAMP = 10⁶ oil |
| `dist_cap_oil` | 26 370 000 000 000 000 | 26,37 tỷ | quota Distribution |
| `reserve_cap_oil` | 9 630 000 000 000 000 | 9,63 tỷ | quota Reserve |
| `total_cap_oil` | 36 000 000 000 000 000 | 36 tỷ | **BẤT BIẾN** (= dist + reserve) |

- Bất biến kiểm bằng test: `caps_sum_to_total`, `total_is_36b_lamp`.
- **LƯU Ý framework:** trong validator hiện tại, `dist_cap`/`reserve_cap` là **PARAM apply-time**,
  KHÔNG đọc hằng. Các hằng trên là **giá trị bake cho LAMP**. Token khác bake giá trị khác
  (vd FARM: `dist_cap` + `reserve_cap` = 12 tỷ × 10⁶). Validator chỉ ép `s.dist_cap == <param>`.
- **Đơn vị nội bộ = oil** để mọi số học là `Int` (Aiken Int = bigint vô hạn, KHÔNG tràn). Off-chain
  dùng `BigInt`. Cấm `Number` cho oil/nanogic (C-OVERFLOW).

---

## 3. Kiến trúc 3 tầng — KHÔNG vòng lặp policy-id

Apply-param là một DAG; vòng phụ thuộc = không deploy được. Thiết kế giữ DAG **cycle-free**:

```
Tầng 1 — NFT one-shot (mint TRƯỚC, độc lập, neo genesis_ref):
    thread_nft  (SUPPLY)   registry_nft   kho_nft   meter_nft (= reserve_thread)
        │            │          │            │
        └──── bake policy+name của chúng vào params của ─────┐
                                                             ▼
Tầng 2 — lamp_mint (minting policy LAMP)  ◄── 12 param (§4)
        │  ĐỌC ĐỘNG (reference input), KHÔNG bake hash:
        │    • registry_nft → bảng authority (WHO)
        │    • kho_nft      → hash kho (WHERE, A-DEST)
        │    • meter_nft    → gate nhịp Reserve
        ▼
Tầng 3 — SupplyState / treasury kho / reserve_draw
        (param hoá theo lamp_policy — KHÔNG được lamp_mint bake ngược → không vòng)
```

**Vì sao không vòng:** lamp_mint **không bake** hash của bất cứ thứ gì phụ thuộc ngược lamp_policy
(SupplyState, kho treasury, reserve_draw đều param theo lamp_policy). Nó **đọc động** qua NFT
one-shot. NFT one-shot không giả được (genesis_ref tiêu một-lần) → "mang đúng 1 NFT ⟺ chính danh".

---

## 4. Tham số `lamp_mint` (12 param)

Nguồn: `Genesis/onchain/validators/lamp_mint.ak:57`. Thứ tự = hợp đồng apply-param (đổi thứ tự ⇒ sai policy-id).

| # | Param | Kiểu | Vai trò |
|---|---|---|---|
| 1 | `thread_nft_policy` | PolicyId | định danh SupplyState (tầng 1) |
| 2 | `thread_nft_name` | ByteArray | — |
| 3 | `token_name` | ByteArray | asset-name LAMP — `tLAMP` testnet / `LAMP` mainnet |
| 4 | **`dist_cap`** | Int | **PARAM** quota Distribution (LAMP: 26 370…) |
| 5 | **`reserve_cap`** | Int | **PARAM** quota Reserve (LAMP: 9 630…) |
| 6 | `registry_nft_policy` | PolicyId | WHO-gate: bảng authority |
| 7 | `registry_nft_name` | ByteArray | = blake2b_256(governing_did) |
| 8 | `token_tag` (`action_tag`) | ByteArray | khoá tra cứu authority trong bảng |
| 9 | `kho_nft_policy` | PolicyId | A-DEST: đánh dấu địa chỉ kho |
| 10 | `kho_nft_name` | ByteArray | — |
| 11 | `meter_nft_policy` | PolicyId | gate nhịp Reserve (= reserve_thread NFT) |
| 12 | `meter_nft_name` | ByteArray | — |

> **token_name là param** ⇒ tLAMP và LAMP có **policy-id KHÁC nhau** (2 token độc lập), cùng một code.
> **dist_cap/reserve_cap là param** ⇒ cap vào policy-id ⇒ cố định bất biến từng token, verify-được
> từ policy-id mà không cần tin datum. "Cố định" (mỗi token) và "param" (tái dùng source) không mâu thuẫn.

---

## 5. Interface contract — datum & redeemer (byte-perfect on-chain ↔ off-chain)

Nguồn: `Genesis/onchain/lib/magiclamp/genesis/types.ak`. Constr index = thứ tự khai báo; off-chain
`types.ts`/`datum.ts` PHẢI khớp tuyệt đối.

```
SupplyState = Constr 0 [ dist_minted:Int, reserve_minted:Int, dist_cap:Int, reserve_cap:Int ]
TLampMintRedeemer:  DistributionVest = Constr 0 []   ReserveDraw = Constr 1 []
ThreadNftRedeemer:  MintGenesis = Constr 0 []
SupplyStateRedeemer: Advance = Constr 0 []
```

Registry (consume bởi lamp_mint, mirror canonical `Tokenomics/.../registry.ak`):

```
RegistryDatum = Constr 0 [ governing_did:Bytes, entries:List<Entry> ]
Entry         = Constr 0 [ action_tag:Bytes, authority:Authorization ]
Authorization:  SinglePkh = Constr 0 [pkh]   MultiSig = Constr 1 [pkhs, threshold]   Revoked = Constr 2 []
Registry NFT:  policy ≡ registry script hash;  name = blake2b_256(governing_did)
```

---

## 6. Luật ép trong `lamp_mint` (MỌI tx mint LAMP)

Nguồn: `Genesis/onchain/validators/lamp_mint.ak` (mint handler). Mọi tx mint LAMP phải qua TẤT CẢ:

| Luật | Nội dung | Chống |
|---|---|---|
| **1** | Đúng 1 input + 1 output mang thread NFT; thread NFT không mint/burn trong tx | mint lậu (A2), SupplyState giả/đôi (A3/A7) |
| **D8-#1** | Định danh SupplyState **bằng SUPPLY NFT**, KHÔNG ghim script-hash | vòng apply-param |
| — | `s_out.address == s_in.address` (thread không rời chỗ) | exfil state |
| **D7-#1** | `s.dist_cap == dist_cap` ∧ `s.reserve_cap == reserve_cap` (neo **param**) | cap-bịa (test `input_cap_mismatch_param`) |
| **D7-#10** | `dist_minted ≥ 0` ∧ `reserve_minted ≥ 0` | counter âm → cap ảo |
| **2,3** | `delta > 0` ∧ policy chỉ mint đúng 1 name = `token_name` | burn/no-op (A6), asset rác (A11) |
| **4** | cap BẤT BIẾN qua transition (`s2.cap == s.cap`) | nới cap (A9) |
| **5** | cộng đúng quota theo redeemer; cùng `delta` | trộn quota (A5), ghi-sổ-lệch (A8) |
| **6** | đơn điệu (`s2.minted ≥ s.minted`) | rollback (A4) |
| **7** | `s2.dist_minted ≤ s2.dist_cap` ∧ `s2.reserve_minted ≤ s2.reserve_cap` | vượt cap (A1) |
| **D7-#2** | `s2.dist_minted + s2.reserve_minted ≤ dist_cap + reserve_cap` (trần tổng) | defense-in-depth |
| **D3** | SupplyState output sạch: 0 LAMP, no reference_script, chỉ thread NFT + ADA | nhồi LAMP né recipient |
| **8** | gate theo đường mint (§7) | sai WHO/WHERE/nhịp |

---

## 7. Hai đường mint

### 7a. DistributionVest (Constr 0) — quota 26,37 tỷ

Ba cổng **trực giao** (WHO / WHERE / HOW-MUCH). Nguồn `lamp_mint.ak:177`.

- **WHO — registry authority** (`registry.validate_mint`, `registry.ak:62`):
  - (a) mint đúng 1 asset-name = `token_name`, qty > 0 (khoá C-1);
  - (b) đúng 1 reference input mang registry NFT `(registry_nft_policy, registry_nft_name)`;
  - (c) tra **đúng-1** entry có `action_tag == token_tag` (**fail-closed**: 0 = không quyền, ≥2 = mơ hồ → reject);
  - (d) authority thoả: `SinglePkh`→1 chữ ký · `MultiSig{pkhs,threshold}`→M-of-N (dedup, threshold∈[1,|uniq|], |pkhs|≤16) · `Revoked`→fail.
  - **Xoay khoá** = sửa entry registry (controller DID hiện tại ký, tầng Registry validator) → KHÔNG redeploy lamp_mint.
- **WHERE — A-DEST** (`lamp_mint.ak:199`): TOÀN BỘ `delta` LAMP phải rót vào **kho**.
  Kho định-danh bằng `kho_nft` (đọc hash động qua `util.script_hash_of_holder`, count==1 chống fake-NFT),
  KHÔNG bake hash kho → kho tự-bound (treasury param theo lamp_policy) không tạo vòng.
  `qty_to_script(outputs, kho_hash, token_name) ≥ delta`. ⟹ authority chỉ **bơm vào kho**, không mint thẳng về ví.
- **HOW MUCH — cap** (§6, luật 7 + D7).

### 7b. ReserveDraw (Constr 1) — quota 9,63 tỷ

Permissionless thật, **KHÔNG chữ ký**. Nguồn `lamp_mint.ak:204`.
- Ép tx spend **đúng 1** UTxO mang meter NFT (= reserve_thread NFT); meter không mint/burn trong tx.
- ⟹ tầng gate Reserve BẮT BUỘC chạy. Không keyholder nào quyết con số nhả → "nhả-thuật-toán, không ai rút tay".

**Gate nhịp Reserve = THEO MỨC TREASURY, KHÔNG theo epoch (anh chốt 20/6 — SỬA thiết kế E/1000 cũ).**
Reserve là **lớp đệm cung CUỐI CÙNG** (U→C một chiều, no-burn). Điều tiết cung-cầu chính thuộc Treasury
(C↔T hai chiều). Reserve **chỉ nhả khi Treasury KHÔNG còn đủ đệm** — nếu Treasury dồi dào mà vẫn nhả Reserve
thì mất ý nghĩa. Hai mức trên **tổng lưu hành C** (KHÔNG phải max cap):
- **Trần = 2% × C**: khi parked Treasury `T ≥ 2%·C` → Reserve **KHÔNG nhả** (Treasury tự lo cầu).
- **Sàn = 1% × C**: khi `T ≤ 1%·C` → Reserve nhả **tối đa**.
- **Giữa (1%·C < T < 2%·C)**: nhả theo **một hàm số** nội suy (càng gần sàn càng nhả mạnh).
- KHÔNG giới hạn số epoch; tốc độ cạn Reserve = do cầu (mức Treasury) quyết, không do lịch.

> ⚠️ **Reserve module hiện tại (`reserve_draw.ak`, trần E/1000/epoch) là thiết kế CŨ — cần thiết kế lại**
> theo gate-mức-Treasury này. Tham số (2%/1%, dạng hàm nội suy) chốt ở spec Reserve riêng.

---

## 8. Mô hình authority registry (token-mint v2)

- **Một OrgDID (vd GreenSun) phát hành nhiều token**, mỗi token một `action_tag` với một authority RIÊNG.
- **Sửa quyền** (Single→Multi→Revoked) = update registry datum; **chỉ controller DID hiện tại ký**
  (`Tokenomics/.../registry.ak:validate_update`, đọc `controller_pkh` ĐỘNG từ TAAD anchor → rotate/recovery tự theo).
- **Genesis registry** = one-shot (bind `genesis_ref`) + `entries_well_formed` (no-dup `action_tag`) + NFT hard-bind `Script(own)`.
- **Lợi:** least-privilege/token · token đối tác MultiSig · thu hồi 1 token (Revoked) — KHÔNG đẻ sub-DID/khoá theo token, KHÔNG redeploy khi xoay.
- **DID Authorization Registry** là một primitive dùng-chung đã-audit (one-shot genesis + no-dup tag +
  authority-gate). lamp_mint **consume** nó qua reference input (read-only), KHÔNG nhúng logic ghi bảng.

---

## 9. Kho nhả-theo-vesting (Q2 — an toàn khi seed lộ)

- A-DEST chỉ đảm bảo LAMP **vào kho**. Kho **tự-bound**: chỉ nhả qua vesting, controller KHÔNG rút tay.
- Tái dùng `Distribution/treasury.ak`: `tre_out.value == tre_in.value − released`, với
  `released = ca_out.redeemed − ca_in.redeemed` (KHÔNG cần controller ký).
- `claim_account` (permissionless Redeem): `vested = min(E, D · drops_per_epoch · (epoch − start_epoch))`,
  rút `vested − redeemed`. Entitlement `E` do **committee M-of-N** cấp (Claim); rate `D` do beacon đặt (PostBeacon).
- **Hệ quả an toàn:** lộ khoá vận hành (authority entry) → kẻ tấn công mint thêm tới cap **vào kho**, nhưng
  **không lấy ra được** (kho nhả theo vesting do committee/beacon khác bên kiểm soát). Hại tối đa = **pha loãng
  theo nhịp, KHÔNG trộm** — với điều kiện kho = treasury vesting (xem §11).

---

## 10. Framework dùng-chung (cùng source, nhiều token)

- `dist_cap`/`reserve_cap`/`token_name`/`token_tag`/registry/kho/meter đều **param** ⇒ một source `lamp_mint`
  phát hành được mọi token hệ sinh thái:
  - **LAMP**: `token_name="LAMP"`, cap 26,37 + 9,63 tỷ.
  - **FARM**: `token_name="FARM"`, cap (vd) 12 tỷ chia 2 quota tuỳ thiết kế.
  - Mỗi token: policy-id riêng (bake param riêng) ⇒ cap + danh tính cố định, verify từ policy-id.
- Khớp định hướng **PlatformKit** (framework dùng-chung cho mọi platform), KHÔNG thiết kế economics riêng từng token ở tầng code.

---

## 11. Bất biến governance + RUNBOOK genesis (BẮT BUỘC)

Phân tích grounded (xem báo cáo governance) xác nhận: hai rủi ro HIGH KHÔNG phải lỗ validator mà là
**cấu hình genesis**. Validator hỗ trợ đúng; an toàn phụ thuộc đặt datum/param đúng lúc genesis:

| Bất biến | Vì sao | Verify post-deploy |
|---|---|---|
| **LAMP entry = `MultiSig`** (vd 3-of-5), KHÔNG `SinglePkh` | 1 khoá lộ = mint tới cap (vào kho) | đọc registry datum → `lookup_authority(LAMP_tag)` là MultiSig |
| **kho A-DEST = treasury VESTING**, KHÔNG `dist_treasury` 1-pkh | 1-pkh = rút sạch kho ngay | hash địa chỉ kho == hash treasury vesting đã biết |
| **3 vai 3 bên khác nhau** (registry-controller ≠ committee-entitlement ≠ beacon-rate) | trùng bên = insider tự-cấp-tự-nhả | so 3 bộ khoá/param khác nhau |
| **rate nhịp Distribution** | DistributionVest không rate-limit ở tầng mint | dựa kho-vesting làm cơ chế hãm (quyết định: KHÔNG thêm rate-limit mint) |

> **Quyết định rate-limit (đã chốt):** KHÔNG thêm rate-limit ở nhánh DistributionVest. A-DEST + kho
> treasury tự-bound đã là cơ chế hãm nhịp thật; rate-limit ở mint là defense-in-depth trùng lặp và
> sẽ đổi policy-id. Thay bằng **bất biến runbook "kho = vesting"** + verify post-deploy.

> **Quy trình sự cố (DID/khoá):** set entry **`Revoked`** bằng controller CÒN-SỐNG. KHÔNG giết DID
> (giết DID làm registry kẹt update). Token nhạy-cảm có thể opt-in dead-man `valid_until`/heartbeat
> trong registry datum (giữ decouple, chỉ đọc registry) — KHÔNG mặc định.

---

## 12. Q1 — không bao giờ mint lại policy

- policy-id `lamp_mint` cố định ⟺ mọi param bake là **danh tính vĩnh viễn** (NFT one-shot) hoặc **hằng**,
  và mọi thứ động (controller) đọc qua reference input. Đã thoả: §3 (DAG cycle-free) + §8 (xoay khoá = sửa data).
- **Phụ thuộc TAAD còn lại:** `registry_nft_policy` hiện phụ thuộc `taad_policy`. Để Q1 miễn nhiễm
  TAAD-redeploy, PhoenixKey **đóng băng nền TAAD** (schema_version + headroom). Đây là điều kiện ngoài LAMP.

---

## 13. Vector tấn công đã đóng + evidence

**Test negative bắt buộc (aiken VM, 71/71 pass):** cap-bịa (`input_cap_mismatch_param`), nới-cap
(`widen_dist_cap`/`widen_reserve_cap`), vượt-cap (`mint_exceed_*`), registry: stranger/revoked/wrong-tag/
missing/two-refs/dup-tag-fail-closed/multisig-insufficient/dup-pkh/threshold-0, A-DEST: mint-không-vào-kho /
split-một-phần-ra-ví, SupplyState bẩn / double / rollback / reference-script.

**Preview THẬT (đã submit, node Plutus VM thật):**
- Genesis (đúc 3 NFT + SupplyState + registry + kho): tx `7663fd0e…`
- Mint LAMP → kho (registry-gate SinglePkh + A-DEST): tx `052fc490…` — kho giữ đúng 250 LAMP.
- ATTACK rót LAMP né kho → **node REJECT** ("validator crashed").
- policy-id 12-param: `530439f6…` — chứng minh apply Int-param (cap) chạy thật.

---

## 14. Bốn trục quyết định (ghi lý do)

- **(a) Định hướng dài hạn:** registry + cap-param ⇒ một source audited phát hành mọi token hệ sinh thái;
  Q1 (không redeploy) bảo toàn policy-id qua đời dự án.
- **(b) First-principles:** fixed-supply = đếm ≤ cap (không mint sẵn); quyền = danh tính (không khoá);
  quyền-tạo ⊥ quyền-tiêu (A-DEST).
- **(c) Tối ưu eUTXO/ExUnit/phí:** lazy-mint (không khoá min-ADA 36 tỷ); đọc-động qua NFT (không vòng,
  không re-deploy); cap pkhs ≤ 16 (chặn ExUnit DoS).
- **(d) Lợi ích user + bền vững:** seed lộ không mất pot (Q2); thu hồi/đổi quyền/token mà không gãy token khác;
  cộng đồng verify cap từ policy-id.

---

## 15. Trạng thái triển khai

- Aiken: **71/71 VM test pass**; plutus.json 12 param (đã build).
- Off-chain: apply 12-param + genesis/mint/attack chạy thật trên Preview (§13).
- **Chưa deploy mainnet.** Mainnet bootstrap hiện tại là bản TEST, sẽ thay bằng bản registry này
  (1 lần cuối, sau khi đóng băng nền TAAD + genesis OrgDID GreenSun).
- **Pending trước mainnet:** đồng bộ deploy script sang 12-param + bước đúc kho/registry NFT;
  audit độc lập tập trung (one-shot + no-dup + policy-bất-biến).
