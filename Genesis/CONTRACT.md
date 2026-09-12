# LAMP — Token Allocation & Mint Spec (v2, registry + cap-param + A-DEST)

> **Phạm vi.** Đây là spec CHUẨN cho việc **phân bổ + phát hành** token LAMP trên Cardano
> (PlutusV3 / Aiken). Thay v1 (`CONTRACT.md`, bản pre-registry 8-param `dist_dest`). Mọi số
> liệu, datum, luật trong tài liệu này được trích từ code đã verify (71/71 aiken VM test) +
> đã chạy thật trên Preview (xem §13). Đơn vị nội bộ: **oildrop** (1 LAMP = 10⁶ oildrop).

---

## 0. Tóm tắt một trang

- **Tổng cung CỐ ĐỊNH 36 tỷ LAMP, KHÔNG burn.** "Fixed-supply" = *tổng phát hành lịch sử ≤ CAP*,
  đơn điệu tăng. Token chưa mint = chưa tồn tại on-chain (không khoá min-ADA, không bị tấn công).
- **Phân bổ 2 quota** (cùng một bộ đếm `SupplyState`):
  - **Distribution = 26,37 tỷ LAMP** (đường vesting/cộng đồng/đối tác) — gate WHO bằng registry.
  - **Reserve = 9,63 tỷ LAMP** (đường DAO nhả-thuật-toán) — permissionless, **trần nhịp mỗi epoch + cổng cầu khi kho Treasury dưới sàn** (§7b; luật đầy đủ ở [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md)).
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

| Hằng | Giá trị (oildrop) | LAMP | Ý nghĩa |
|---|---|---|---|
| `oildrop_per_lamp` | 1 000 000 | — | 1 LAMP = 10⁶ oildrop |
| `dist_cap_oildrop` | 26 370 000 000 000 000 | 26,37 tỷ | quota Distribution |
| `reserve_cap_oildrop` | 9 630 000 000 000 000 | 9,63 tỷ | quota Reserve |
| `total_cap_oildrop` | 36 000 000 000 000 000 | 36 tỷ | **BẤT BIẾN** (= dist + reserve) |

- Bất biến kiểm bằng test: `caps_sum_to_total`, `total_is_36b_lamp`.
- **LƯU Ý framework:** trong validator hiện tại, `dist_cap`/`reserve_cap` là **PARAM apply-time**,
  KHÔNG đọc hằng. Các hằng trên là **giá trị bake cho LAMP**. Token khác bake giá trị khác
  (vd FARM: `dist_cap` + `reserve_cap` = 12 tỷ × 10⁶). Validator chỉ ép `s.dist_cap == <param>`.
- **Đơn vị nội bộ = oildrop** để mọi số học là `Int` (Aiken Int = bigint vô hạn, KHÔNG tràn). Off-chain
  dùng `BigInt`. Cấm `Number` cho oildrop/nanogic (C-OVERFLOW).

---

## 3. Kiến trúc 3 tầng — KHÔNG vòng lặp policy-id

Apply-param là một DAG; vòng phụ thuộc = không deploy được. Thiết kế giữ DAG **cycle-free**:

```
Tầng 1 — NFT one-shot (mint TRƯỚC, độc lập, neo genesis_ref):
    thread_nft  (SUPPLY)   registry_nft   kho_nft   meter_nft (NFT one-shot BẤT KỲ)
        │            │          │            │
        └──── bake policy+name của chúng vào params của ─────┐
                                                             ▼
Tầng 2 — lamp_mint (minting policy LAMP)  ◄── 14 param (§4)
        │  ĐỌC ĐỘNG (KHÔNG bake hash):
        │    • registry_nft      → bảng authority (WHO)         [reference input]
        │    • kho_nft           → hash kho Distribution         [reference input, A-DEST]
        │    • meter_nft         → gate nhịp Reserve             [spend input]
        │    • reserve_kho_nft   → hash Treasury custody         [spend input, A-DEST Reserve]
        ▼
Tầng 3 — SupplyState / treasury kho / reserve_draw
        (param hoá theo lamp_policy — KHÔNG được lamp_mint bake ngược → không vòng)
```

**Vì sao không vòng:** lamp_mint **không bake** hash của bất cứ thứ gì phụ thuộc ngược lamp_policy
(SupplyState, kho treasury, reserve_draw đều param theo lamp_policy). Nó **đọc động** qua NFT
one-shot. NFT one-shot không giả được (genesis_ref tiêu một-lần) → "mang đúng 1 NFT ⟺ chính danh".

---

## 4. Tham số `lamp_mint` (14 param)

Nguồn: chữ ký `validator lamp_mint(` trong `Genesis/onchain/validators/lamp_mint.ak` (trích theo TÊN,
không theo số dòng — số dòng trôi mà con trỏ vẫn trỏ vào một dòng CÓ THẬT). Thứ tự = hợp đồng
apply-param (đổi thứ tự ⇒ sai policy-id).

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
| 9 | `kho_nft_policy` | PolicyId | A-DEST đường **Distribution**: đánh dấu kho Distribution (`Distribution/onchain/validators/treasury.ak`) |
| 10 | `kho_nft_name` | ByteArray | — |
| 11 | `meter_nft_policy` | PolicyId | gate nhịp Reserve — NFT one-shot bất kỳ, xem ghi chú dưới bảng |
| 12 | `meter_nft_name` | ByteArray | — |
| 13 | `reserve_kho_nft_policy` | PolicyId | A-DEST đường **Reserve**: `seed_policy` của instance Treasury `custody` đích |
| 14 | `reserve_kho_nft_name` | ByteArray | `instance_id` của instance `custody` đó |

> **HAI CẶP KHO, KHÔNG PHẢI MỘT.** `kho_nft_*` (#9-10) và `reserve_kho_nft_*` (#13-14) trỏ vào HAI
> kho KHÁC NHAU. #9-10 → kho **Distribution** (`Distribution/onchain/validators/treasury.ak`, có sổ
> `outstanding_entitlement` phục vụ claim/redeem), dùng cho nhánh `DistributionVest`. #13-14 →
> **Treasury `custody`** (`Treasury/onchain/validators/custody.ak`), cặp giá trị = `(seed_policy,
> instance_id)` của instance đích; đó là nơi DUY NHẤT có nhánh `MigrateIn` ép Δ vào SỔ KẾ TOÁN, dùng
> cho nhánh `ReserveDraw`. Dùng chung một cặp sẽ dời đích của `DistributionVest` sang Treasury
> custody, tức 26,37 tỷ LAMP chỉ còn chi được qua `Release` gác bằng proposal — phá đường
> claim/redeem của Distribution.
>
> ⚠ **Nối nhầm dây ở đây thì khoá ba tầng hở NGAY Ở TẦNG NỐI và cả ba tầng vẫn xanh:** tx tiêu UTxO
> kho Distribution, `treasury.ak` chạy — nhưng nó không có nhánh nào ghi Δ vào sổ custody, nên Δ
> đứng ngoài sổ kế toán dù mọi phép đo đều thoả. Bài đỏ giữ chỗ này:
> `reservedraw_delta_vao_kho_dist_bi_tu_choi` và
> `reservedraw_custody_bi_tieu_nhung_delta_chay_sang_kho_dist` (`lamp_mint.ak`).
>
> ⚠ **BẤT BIẾN DEPLOY:** `reserve_kho_nft_name` = `instance_id` của MỘT instance custody, nướng vào
> policy-id ⇒ đường Reserve khoá vĩnh viễn vào đúng instance đó. Chọn sai lúc deploy không sửa được
> bằng cách truyền tham số khác — phải đúc policy mới. Cặp này còn phải TRÙNG
> `kho_nft_policy`/`kho_nft_name` (#6-7) của `Reserve/onchain/validators/reserve_draw.ak`.
>
> **Hai khe #13-14 được thêm Ở CUỐI, cố ý:** thêm giữa danh sách thì xê dịch mọi khe sau nó, và
> truyền lệch thứ tự KHÔNG báo lỗi — nó chỉ ra một policy-id khác một cách im lặng.

> **`meter_nft` là một TÍNH CHẤT, không phải một danh tính.** Chỗ này trước đây viết
> `meter_nft (= reserve_thread)`, đọc ra thành "phải do `Reserve/reserve_thread.ak` đúc". Không
> phải. `lamp_mint` chỉ đòi đúng hai điều: tx spend đúng 1 UTxO mang NFT đó, và tx không đúc lại
> nó. `reserve_draw` nhận `reserve_thread_policy` như một **tham số tự do** — nó không biết và
> không quan tâm ai đúc. Điều kiện thật là **one-shot**, và `oneshot_nft.ak` với
> `reserve_thread.ak` đúng bằng nhau từng mệnh đề (tiêu `genesis_ref` · đúng 1 tên ·
> `qty == 1` · `else fail`).
>
> Ràng buộc THẬT nằm ở chỗ khác: **ba giá trị phải bằng nhau** — `meter_nft_policy`/`_name`
> nướng vào `lamp_mint`, `reserve_thread_policy`/`_name` nướng vào `reserve_draw`, và
> policy/name của NFT thật sự hạ cánh ở địa chỉ `reserve_draw`. Cả ba đều là apply-param,
> khoá cứng khi gửi tx đầu. Lệch một byte ⇒ `reserve_draw.ak:66-67` gãy vĩnh viễn ⇒ 9,63 tỷ
> không phát hành được, mà LAMP không burn nên không có đường dọn sổ.
>
> Ranh giới tổng quát dùng lại được cho mọi marker sau này: **người đúc chỉ quan trọng khi có
> validator suy ra ĐỊA CHỈ từ policy-id của marker.** Với `meter` thì không ⇒ người đúc không
> quan trọng. Với `registry` thì CÓ — `registry.ak:137-138` đòi `policy-id ≡ registry script
> hash` và `:148-150` ép carrier nằm ở `Script(policy)` ⇒ REG **bắt buộc** do chính validator
> `registry` đúc. Đừng chép cách làm của `meter` sang `registry`.

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

Ba cổng **trực giao** (WHO / WHERE / HOW-MUCH). Nguồn: nhánh `DistributionVest ->` trong
`Genesis/onchain/validators/lamp_mint.ak`.

- **WHO — registry authority** (`registry.validate_mint`, `registry.ak:62`):
  - (a) mint đúng 1 asset-name = `token_name`, qty > 0 (khoá C-1);
  - (b) đúng 1 reference input mang registry NFT `(registry_nft_policy, registry_nft_name)`;
  - (c) tra **đúng-1** entry có `action_tag == token_tag` (**fail-closed**: 0 = không quyền, ≥2 = mơ hồ → reject);
  - (d) authority thoả: `SinglePkh`→1 chữ ký · `MultiSig{pkhs,threshold}`→M-of-N (dedup, threshold∈[1,|uniq|], |pkhs|≤16) · `Revoked`→fail.
  - **Xoay khoá** = sửa entry registry (controller DID hiện tại ký, tầng Registry validator) → KHÔNG redeploy lamp_mint.
- **WHERE — A-DEST** (khối `── WHERE: A-DEST` trong nhánh `DistributionVest`): TOÀN BỘ `delta` LAMP
  phải rót vào **kho Distribution**.
  Kho định-danh bằng `kho_nft` (đọc hash động qua `util.script_hash_of_holder` trên
  `tx.reference_inputs`, count==1 chống fake-NFT),
  KHÔNG bake hash kho → kho tự-bound (treasury param theo lamp_policy) không tạo vòng.
  `qty_delta_at_script(inputs, outputs, kho_hash, policy_id, token_name) ≥ delta` — đo **ĐỘ TĂNG RÒNG** của kho
  (tổng ở output − tổng ở input), KHÔNG đo tổng mặt output. Đo tổng cho phép **tái chế**: kho đang giữ X,
  tx tiêu UTxO kho rồi trả lại đúng X và đưa delta mới về ví — "tổng ≥ delta" vẫn thoả khi X ≥ delta
  trong khi kho không tăng một đồng. Test đối chứng: `adest_recycle_kho_balance_rejected` (đỏ trên luật cũ).
  ⟹ authority chỉ **bơm vào kho**, không mint thẳng về ví.
- **HOW MUCH — cap** (§6, luật 7 + D7).

### 7b. ReserveDraw (Constr 1) — quota 9,63 tỷ

Permissionless thật, **KHÔNG chữ ký**. Nguồn: nhánh `ReserveDraw ->` trong
`Genesis/onchain/validators/lamp_mint.ak`.
- **WHO/NHỊP:** ép tx spend **đúng 1** UTxO mang meter NFT (NFT one-shot bất kỳ); meter không
  mint/burn trong tx. ⟹ tầng gate Reserve BẮT BUỘC chạy. Không keyholder nào quyết con số nhả →
  "nhả-thuật-toán, không ai rút tay".
- **WHERE — A-DEST đường Reserve** (khối `── WHERE: A-DEST cho đường Reserve`), soi gương
  `DistributionVest`, hai vế:
  - (a) tx phải TIÊU **đúng 1** UTxO mang `reserve_kho_nft_*` (#13-14) ⇒ validator của kho
    (Treasury `custody`, nhánh `MigrateIn`) chạy ⇒ chính nó ép Δ vào value VÀ vào SỔ;
  - (b) `qty_delta_at_script(inputs, outputs, reserve_kho_hash, policy_id, token_name) ≥ delta` —
    **ĐỘ TĂNG RÒNG** của kho, KHÔNG đo tổng mặt output (đo tổng cho tái chế).
- **KHÁC `DistributionVest` ở CHỖ ĐỌC, và khác có lý do:** Distribution đọc kho qua **reference
  input** (kho không cần bị tiêu, không tranh chấp UTxO). Ở đây kho PHẢI là **spend input**, vì
  chính việc bị tiêu mới làm validator kho chạy. Cùng hàm `script_hash_of_holder` phục vụ cả hai vì
  nó nhận `List<Input>`; nó vẫn đòi carrier ở SCRIPT và đòi ĐÚNG MỘT carrier, nên kho NFT đặt ở ví
  thường thì cả tx chết ngay tại đây.

> **RANH GIỚI — `lamp_mint` canh ĐÍCH ĐẾN, và UỶ QUYỀN nhịp + lượng.**
> Trước đây nhánh `ReserveDraw` chỉ đòi đúng 1 input mang meter NFT và KHÔNG ép đích đến; nay nó ép
> thêm A-DEST đường Reserve (kho phải BỊ TIÊU và phải TĂNG RÒNG ≥ δ). Lý do đổi: đích đến từng được
> uỷ quyền cho `reserve_draw`, mà `reserve_draw` lại đo bằng "tổng LAMP tới một ĐỊA CHỈ", nên mỗi
> lượt rút đẩy Δ vào một UTxO không datum ở địa chỉ kho — tiêu lại không được ⇒ Δ bị **PHÁ HUỶ**,
> trái bất biến "LAMP không đốt; giảm lưu hành = chuyển vào kho (kế toán)". Đúng địa chỉ mà không
> vào SỔ thì kho không nhận được gì.
>
> **CÒN UỶ QUYỀN (`lamp_mint` vẫn KHÔNG canh):** trần mỗi lượt (`δ ≤ E/1000`), nhịp ≤1 lượt/epoch,
> pot còn lại, Treasury-pull. Toàn bộ nằm ở **script đang giữ meter NFT**.
> - meter NFT ở `reserve_draw.ak` ⇒ nhả theo thuật toán, không ai rút tay.
> - meter NFT ở **ví thường** ⇒ người cầm ví tự chọn nhịp và lượng, **nhưng vẫn PHẢI rót vào kho** —
>   A-DEST mới chặn đường "đúc thẳng 9,63 tỷ về ví".
>
> `meter_nft_policy`/`_name` và `reserve_kho_nft_policy`/`_name` đều là tham số apply-time ⇒ **nướng
> vào policy-id** ⇒ chọn sai lúc deploy là vĩnh viễn (policy mainnet `55d3e01b…` đã dính: `meter_nft`
> 28 byte 0 ⇒ nhánh `ReserveDraw` chết hẳn ở policy đó; apply-param không sửa được sau khi gửi).
>
> Test ghi lại ranh giới: `reservedraw_lamp_mint_ep_dich_den()` mang `fail` — **kỳ vọng đã bị ĐẢO**.
> Tên cũ `reservedraw_lamp_mint_khong_ep_dich_den` là ca DƯƠNG ghi lại đúng giới hạn mà bản vá này
> xoá bỏ, nên nó phải đảo chứ không phải giữ. Bài đỏ giữ chỗ nối dây:
> `reservedraw_delta_vao_kho_dist_bi_tu_choi`,
> `reservedraw_custody_bi_tieu_nhung_delta_chay_sang_kho_dist`.

**Luật nhả Reserve: nguồn duy nhất là [`Specs/Emission/CONTRACT.md`](../Specs/Emission/CONTRACT.md).**

Tóm tắt vừa đủ để đọc tiếp phần Genesis — **không** phát biểu lại luật:

- Reserve là **lớp đệm cung CUỐI CÙNG** (U→C một chiều, no-burn). Điều tiết cung-cầu chính thuộc
  Treasury (C↔T hai chiều).
- Luật nhả có **hai vế bổ sung nhau**: **trần nhịp** mỗi epoch (ép ở module Reserve) và **cổng cầu**
  chỉ mở khi kho Treasury dưới sàn (ép ở module Treasury). Một lượt nhả hợp lệ phải thoả cả hai.
- **Không ấn định epoch kết thúc** — mỗi epoch bị cổng đóng lại đẩy thời điểm cạn ra xa.

> Bản trước của mục này mô tả một luật loại trừ trần nhịp, và gọi trần nhịp là "thiết kế cũ cần
> thiết kế lại". Cả hai câu đó đã bị thay; lý do ghi ở `Specs/Emission/CONTRACT.md` §7.

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
(Con số `71/71` là ảnh chụp của một bản build cũ; tập test đang lớn dần nên đừng trích nó làm số đo
hiện tại — đếm lại bằng cách chạy bộ kiểm.)

**A-DEST đường Reserve — bài âm giữ chỗ** (`lamp_mint.ak`, nhánh `ReserveDraw`):
`reservedraw_no_kho_input` (kho không bị tiêu) · `reservedraw_two_kho_inputs` ·
`reservedraw_delta_to_datumless_utxo_at_kho` (Δ đóng băng ngoài sổ) ·
`reservedraw_kho_nft_at_wallet` · `reservedraw_reject_kho_recycle` (tái chế số dư kho) ·
`reservedraw_kho_increase_below_delta` · `reservedraw_delta_vao_kho_dist_bi_tu_choi` và
`reservedraw_custody_bi_tieu_nhung_delta_chay_sang_kho_dist` (nối nhầm hai cặp kho) ·
`reservedraw_lamp_mint_ep_dich_den` (ca DƯƠNG cũ đã bị ĐẢO thành `fail`).
Cặp dương: `reservedraw_delta_vao_dung_custody_duoc_nhan`,
`reservedraw_kho_increase_real_when_kho_prefunded`.

**Preview THẬT (đã submit, node Plutus VM thật):**
- Genesis (đúc 3 NFT + SupplyState + registry + kho): tx `7663fd0e…`
- Mint LAMP → kho (registry-gate SinglePkh + A-DEST): tx `052fc490…` — kho giữ đúng 250 LAMP.
- ATTACK rót LAMP né kho → **node REJECT** ("validator crashed").
- policy-id 12-param: `530439f6…` — chứng minh apply Int-param (cap) chạy thật. ⚠️ **Bản 12-tham-số,
  đã lỗi thời** sau khi thêm A-DEST đường Reserve (§4 nay 14 param) — dữ kiện lịch sử, KHÔNG phải
  bằng chứng cho mã hiện tại. Xem cảnh báo đầu §15.

---

## 14. Bốn trục quyết định (ghi lý do)

- **(a) Định hướng dài hạn:** registry + cap-param ⇒ một source audited phát hành mọi token hệ sinh thái;
  Q1 (không redeploy) bảo toàn policy-id qua đời dự án.
- **(b) First-principles:** fixed-supply = đếm ≤ cap (không mint sẵn); quyền = danh tính (không khoá);
  quyền-tạo ⊥ quyền-tiêu (A-DEST) — **chỉ đúng khi hai vai do hai chủ thể khác nhau nắm**. Trực giao nằm
  ở luật, không tự sinh ra ở người: mainnet `55d3e01b…` bake `dist_authority[0]` và authority của kho
  `dist_treasury` là CÙNG một pkh, nên ở đó A-DEST chỉ là khúc vòng hai giao dịch, không phải khoá thứ hai.
- **(c) Tối ưu eUTXO/ExUnit/phí:** đọc-động qua NFT (không vòng,
  không re-deploy); cap pkhs ≤ 16 (chặn ExUnit DoS).
- **(d) Lợi ích user + bền vững:** seed lộ **không lấy được LAMP về ví kẻ tấn công** — A-DEST ép mọi lượt
  DistributionVest vào kho, nên thiệt hại tối đa là **pha loãng tới cap**, không phải trộm. Sau lượt đúc
  trọn quota (§16) thì kể cả pha loãng cũng hết đường. Đây là phát biểu đúng của "Q2"; câu "seed lộ
  không mất pot" nói gọn quá tới mức sai — mất pot hay không còn phụ thuộc AI GIỮ KHOÁ KHO.
  Thu hồi/đổi quyền/token mà không gãy token khác;
  cộng đồng verify cap từ policy-id.

---

## 15. Trạng thái triển khai

> ⚠️ **BẢN 12-THAM-SỐ ĐÃ LỖI THỜI — đừng trích số dưới đây làm bằng chứng cho mã hiện tại.**
> Các số và policy-id trong mục này thuộc một **bản build cũ**, đúc TRƯỚC khi A-DEST đường Reserve
> được thêm vào `lamp_mint` (hai khe `reserve_kho_nft_policy`/`reserve_kho_nft_name`, §4). Số tham
> số hiện tại là **14**, nên policy-id sinh ra từ bản 14-tham-số **khác** policy-id ghi ở đây — tham
> số nằm TRONG policy-id. Chúng vẫn đúng như **dữ kiện lịch sử** (một bản apply Int-param đã chạy
> thật trên Preview), nên giữ nguyên; nhưng phải **build lại và đo lại** trước khi trích làm bằng
> chứng về trạng thái hiện tại.

- Aiken (bản build 12-tham-số, `not_started` cho bản 14): **150/150 VM test pass** (Genesis);
  plutus.json 12 param (aiken v1.1.21+42babe5). Số test và số tham số của bản 14 chưa đo.
- Off-chain (bản 12-tham-số): apply 12-param + genesis/mint/attack chạy thật trên Preview (§13).
- **Chưa deploy mainnet.** Mainnet bootstrap hiện tại là bản TEST, sẽ thay bằng bản registry này
  (1 lần cuối, sau khi đóng băng nền TAAD + genesis OrgDID GreenSun).
- **Pending trước mainnet:** build lại plutus.json theo **14 param** rồi đồng bộ deploy script sang
  14-param (thêm bước nối `reserve_kho_nft_*` vào instance `custody` đích) + bước đúc kho/registry
  NFT; audit độc lập tập trung (one-shot + no-dup + policy-bất-biến).

---

## 16. ĐÚC MỘT LƯỢT CHẠM CAP — cổng chết bằng luật sổ cái (anh chốt 2026-08-18)

**Điều kiện anh chốt, nguyên văn:** *"Đúc một lần chạm cap ⇒ cổng chết ngay sau đó ⇒ xoay khoá
OrgDID bao nhiêu lần cũng không ảnh hưởng gì cả. Không được để registry sống mãi, vì chả để làm
gì cả. Hơn nữa, nếu để OrgDID thì đang biến tôi trở thành mục tiêu tấn công của kẻ xấu."*
Kèm ràng buộc: **tổng cung 36 tỷ là bắt buộc, không hạ.**

### 16.1 Cách thoả — và vì sao nó là LUẬT, không phải lời hứa

Đúc **trọn** `dist_cap` = 26,37 tỷ LAMP trong **đúng một giao dịch** DistributionVest. Sau lượt đó
`dist_minted == dist_cap`, và hai luật sẵn có khoá chéo nhau:

- `expect delta > 0` (A6, `lamp_mint.ak:104`) — không có lượt mint 0.
- `expect s2.dist_minted <= s2.dist_cap` (A1, luật 7) — không vượt cap.

Hai vế đó **không cùng đúng được nữa**. Không cần ai giữ lời, không cần ai đốt khoá: đường
DistributionVest đóng bằng số học, vĩnh viễn. Registry còn sống hay đã thu hồi, khoá OrgDID xoay
bao nhiêu lần, ai cầm seed — đều không đổi kết quả.

**Chỗ này khác một lời hứa vận hành ở đâu:** "đúc dần rồi sẽ dừng khi chạm cap" cho phép đúc 1
oildrop mỗi lượt, vô hạn lượt, giữ cổng sống mãi — cổng chỉ chết nếu người cầm khoá TỰ NGUYỆN đúc
hết. Đúc trọn trong một lượt bỏ hẳn chữ "tự nguyện" ra khỏi câu.

### 16.2 Bằng chứng trong mã (mỗi test đã bị làm ĐỎ đúng một lần)

`Genesis/onchain/validators/lamp_mint.ak`, mục "CỔNG CHẾT":

| test | khẳng định |
|---|---|
| `oneshot_full_dist_cap` | đúc 26.370.000.000.000.000 oildrop trong ĐÚNG một tx |
| `gate_dead_authority_still_signs` | sau đó 1 oildrop cũng không đúc thêm, dù khoá vận hành ký đúng |
| `gate_dead_even_after_key_rotation` | registry ghi khoá MỚI, khoá mới ký — vẫn không mở được |
| `gate_dead_no_unbooked_mint` | không né được bằng mint-không-ghi-sổ |
| `gate_dead_no_counter_rollback` | không quay ngược sổ để mở lại quota |
| `gate_dead_no_quota_borrow` | không mượn quota Reserve để đúc tiếp đường Distribution |
| `reserve_alive_after_dist_gate_dead` | 9,63 tỷ KHÔNG chết theo |
| `both_quotas_exhausted_policy_closed` | cạn cả hai quota ⇒ policy đóng tuyệt đối |

Đối chứng đột biến: nới trần cap ⇒ 2 test cổng chết đỏ; nới luật ghi sổ ⇒ 3 test đỏ; nới đơn điệu
⇒ 2 test đỏ; đổi `<=` thành `<` ⇒ test đúc trọn đỏ. **Test xanh chưa từng đỏ thì chưa kiểm được gì.**

### 16.3 Điều KHÔNG chết, và vì sao giữ nguyên

9,63 tỷ Reserve **không** đi đường này. Nó ở lại quota `ReserveDraw` — nhánh không đọc registry,
không đòi chữ ký, chỉ đòi spend meter NFT. Đó chính là "thuật toán nhả tự động không ai rút tay"
(§7b). Ép nó vào lượt đúc một-lần sẽ **giết** đúng cái cơ chế cần giữ.

⚠️ Nhưng xem RANH GIỚI ở §7b: bảo đảm đó **chỉ có thật khi meter NFT nằm ở đúng script nhả**.
Đây là quyết định **bất khả hồi** tại thời điểm apply-param.

### 16.4 Thu hồi registry

Sau lượt đúc trọn, registry không còn tác dụng gì với LAMP. Thu hồi NFT (`registry_write.ak`,
redeemer retire) làm cho điều đó **nhìn thấy được** thay vì phải suy luận — nhưng nó là **hệ quả**,
không phải nguyên nhân: cổng đã chết trước khi registry bị thu hồi, và sẽ vẫn chết nếu registry
còn sống.

---
