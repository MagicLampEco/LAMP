# KẾ HOẠCH TRIỂN KHAI MAINNET — mint LAMP vào kho

> Soạn 2026-07-13. **Sửa lớn 2026-07-29** sau khi anh chốt policy + verify lại on-chain.
> Trạng thái: **CHƯA SẴN SÀNG mint giá trị thật**. Đây là việc phải làm theo thứ tự.

## Sự thật cứng (verify lại on-chain 2026-07-29 — `scripts/verify_mainnet_supply.ts`, Koios read-only)

- Policy mainnet `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` **LÀ token LAMP
  canonical 36 tỷ** — anh chốt 2026-07-29, không đẻ policy mới.
- `supply_state` (`addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3`) mang thread NFT
  `SUPPLY`, inline datum constructor 0, **4 field**:
  `dist_minted` = 1.000.000 LAMP · `reserve_minted` = 0 · `dist_cap` = 26.370.000.000 ·
  `reserve_cap` = 9.630.000.000 → **tổng cap 36 tỷ**, còn mint được **26,369 tỷ + 9,63 tỷ**.
- Kho (`addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu`) đang giữ đúng 1.000.000 LAMP.
- ⇒ **Lazy-mint đã wired thật trên mainnet.** "Mint LAMP vào kho" = dùng đường đã có, KHÔNG phải
  deploy policy mới.

> **SỬA MỘT KHẲNG ĐỊNH SAI CỦA BẢN CŨ.** Bản 13/07 ghi: *"`55d3e01b…180f0` = 1e12 base
> (1 triệu LAMP), `mint_or_burn_count=1` → CỐ ĐỊNH, không mint thêm. Đây KHÔNG phải token 36 tỷ
> canonical"* và *"policy `lamp_mint` cap 36 tỷ CHƯA deploy mainnet"*. **Cả hai đều SAI.**
> `mint_or_burn_count=1` chỉ nói policy mới mint **một lần**, không nói nó **không mint được nữa**
> — trần thật nằm trong datum `supply_state`, và datum đó ghi 36 tỷ. Ai đọc bản cũ rồi kết luận
> "phải làm token mới" là bị dẫn sai. Giữ đoạn này lại để không ai lặp lỗi.

## A. Quyết định chiến lược
1. ~~Token mainnet chính thức là cái nào~~ → **ĐÃ CHỐT 2026-07-29: `55d3e01b…180f0`.** Không
   migrate, không khai tử, không phát hành token thứ hai.
2. **token_tag = `4c414d50`** — đã chốt (xem `kho-a-dest.md`).
3. **Kho A-DEST = `treasury.ak` vesting** — đã chốt. Kho mainnet hiện tại là `dist_treasury` 1-pkh
   (đang giữ 1 triệu LAMP) → **phải thay bằng `treasury.ak` TRƯỚC khi mint giá trị**.
4. **Authority**: hệ quả trực tiếp của quyết định A1 — tham số đã **nướng vào policy-id**, nên
   **không xoay khoá được** mà vẫn giữ token này. Khuyến nghị MultiSig M-of-N ở spec §11 **chỉ áp
   dụng được cho policy mới**, tức đã hết hiệu lực với lựa chọn A1. Bù lại bằng quy trình giữ khoá
   ngoại tuyến + trần on-chain + A-DEST.

## A'. VIỆC PHẢI LÀM TRƯỚC MỌI THỨ — đối chiếu script on-chain
Chưa ai đối chiếu **CBOR script đang chạy trên mainnet** với bản dựng lại từ mã nguồn. Cần biết
chắc nó là bản **8 tham số (authority khoá thường, threshold 1)** hay **12 tham số (registry-gate
theo DID)**, và A-DEST có được ép on-chain thật không. Đây là **điều kiện tiên quyết** của mọi
bước mint có giá trị, và cũng là căn cứ để chốt lại `Papers/Whitepaper.md §8`.

## B. Code phải merge (hiện ở nhánh/worktree, chưa lên main)
5. **LAMP**: `lamp_mint` 12-param + registry read-side đã nằm trọn trong nhánh PR #17
   (`feat/launch-etd-airdrop-srcl`) → merge PR #17 là xong. Nhánh cũ
   `feat/lamp-mint-compose-anchor-cap` đã ghim tag `archive/feat-lamp-mint-compose-anchor-cap`.
   **Lưu ý:** bản 12-param này là bản THIẾT KẾ; policy đang chạy trên mainnet có thể là bản 8-param
   — xem mục A'. Merge code không tự động đổi script đã deploy.
6. **LAMP**: dựng script deploy 12-param **production** (hiện chỉ có demo Preview khoá cứng + bản v1 8-param) — gồm bước phá-vòng + đặt kho-NFT tại `treasury.ak`.
7. **LAMP**: dựng **route kho→pot** (nối Genesis mint ↔ Distribution treasury) — item #9, chưa có. (Chính là pipeline đang diễn tập trên Preprod.)
8. **PhoenixKey-Core**: merge `registry_mint.rs` (write-side, đã có 4-field) → main; build + deploy Registry NFT cho OrgDID.
9. **SuperApp**: đồng bộ enclave core copy sang **4-field** (bản hiện 3-field → sẽ bị validator chặn); ráp `buildAndSignTx` native (Thư); bật cờ `ORG_MINT_ENABLED`.
10. **Backend (Long)**: merge endpoint `mint-lamp` + `submit-tx` + `claim/vesting-release`.

## C. Diễn tập Preprod (GATE — phải xanh mới lên mainnet)
11. Chạy **trọn pipeline canonical** trên Preprod: deploy (thread + lamp_mint 12-param + registry NFT + supply_state + treasury.ak kho + kho-NFT) → mint DistributionVest → kho → claim entitlement → post beacon → redeem → treasury nhả tLAMP về ví. **(đang dựng)**

> **GATE này chứng minh cái gì, và KHÔNG chứng minh cái gì.**
>
> Diễn tập xanh chứng minh: các validator ăn khớp nhau, datum/redeemer đúng dạng, thứ tự
> tham số dựng ra script chạy được, và pipeline đi hết từ mint tới nhả token.
>
> Diễn tập xanh **KHÔNG** chứng minh tính DUY NHẤT của thread NFT — thứ neo toàn bộ định danh
> SupplyState. Lý do cụ thể, không phải lo xa: kịch bản diễn tập **không dùng** `thread_nft.ak`.
> `Genesis/scripts/canonical_mint.ts:44` và `canonical_mint_resume.ts:37` dựng
> `scriptFromNative({ type: "sig", keyHash: pkh })` rồi lấy `nPid` đó làm policy cho CẢ BỐN
> mốc SUPPLY/REG/KHO/MET (`canonical_mint.ts:48-50`). Policy native-sig **mint lại được bao
> nhiêu lần tuỳ ý** bằng chính khoá ví đó. `thread_nft.ak:20-26` mới là one-shot thật: nó đòi
> tiêu đúng `genesis_ref` — một OutputReference chỉ tồn tại một lần trong lịch sử chain.
>
> Hệ quả: một lượt Preprod xanh nói được "đường ống thông", không nói được "chỉ có một
> SupplyState". Trước khi lên mainnet phải có thêm bằng chứng RIÊNG cho tính one-shot: chạy
> pipeline với `thread_nft.ak` áp `genesis_ref` thật, rồi thử mint lượt thứ hai bằng cùng
> policy đó và **xác nhận nó bị chặn**. Chưa có phép thử đó thì mục C chưa xanh, dù mọi bước
> khác đã chạy.

## D. Deploy mainnet (CHỈ sau A–C xanh)
12. TAAD anchor OrgDID **Active trên mainnet** (PhoenixKey-Validator/Core).
13. Runbook mainnet phá-vòng: taad → registry NFT (entry `LAMP`→authority) → `treasury.ak` kho + kho-NFT → thread NFT + `lamp_mint` policy + SupplyState datum (cap 36 tỷ).
14. Mint thật: `DistributionVest`, authority M-of-N ký → LAMP vào kho.
15. Verify on-chain + publish artefacts (policy-id, kho addr, registry NFT) cho SuperApp / PhoenixKey / Long ráp + bật cờ.

## Anh cần làm gì (tóm tắt — soát lại 2026-09-02)

Bản trước liệt gọn "Chốt A1–A4" như một khối. Soát từng mục thì khối đó sai theo **hai chiều
ngược nhau**, nên tách ra:

| Mã | Trạng thái thật | Bằng chứng |
|---|---|---|
| A2 `token_tag` | **ĐÓNG** | mục A2 tệp này + `kho-a-dest.md` |
| A3 kho A-DEST = `treasury.ak` | **ĐÓNG** | mục A3 tệp này |
| A1 policy mainnet | **MỞ** | `Papers/Whitepaper.md` đính chính 2026-08-26 rút lại câu "chốt … chính thức": policy đang chạy là bản **khởi tạo (bootstrap)**, hai đường vẫn song song (giữ vĩnh viễn / phát hành policy mới khi mint uỷ quyền qua OrgDID sẵn sàng — §8–§9). Muộn hơn mục A1 của tệp này gần một tháng ⇒ bản muộn thắng |
| A4 authority | **MỞ, dẫn xuất từ A1** | lập luận "tham số đã nướng vào policy-id ⇒ không xoay khoá được" chỉ đứng khi A1 đóng theo đường (a). A1 mở ⇒ cửa MultiSig M-of-N (spec §11) vẫn mở |

**Ràng buộc TẠM đang giữ an toàn trong lúc A1/A4 mở:** cổng A' dưới đây chặn mọi bước mint giá trị
thật, và nó chặn **cả hai** đường của A1 — nên để A1 mở không mở thêm rủi ro nào.

Việc thật còn lại, theo thứ tự:
- **A' — đối chiếu CBOR script mainnet với bản dựng lại từ mã nguồn.** Chưa ai làm. Đây là điều
  kiện tiên quyết của mọi bước mint có giá trị, và là cổng đang giữ A1/A4 an toàn.
- **Duyệt merge B5–B10** (điều phối nhiều đội: LAMP/Tuân, Core/Thư, SuperApp, Long).
- **Chờ Preprod rehearsal xanh (C11)** — kèm phép thử one-shot `thread_nft.ak` nêu ở khung mục C.
- **Rồi mới D12–D15.**

Em (agent) KHÔNG thực thi bước mainnet nào (token thật, bất khả nghịch) — anh + đội làm, em chuẩn bị code + verify + diễn tập Preprod.

— LampNet agent
