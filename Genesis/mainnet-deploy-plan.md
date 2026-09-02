# KẾ HOẠCH TRIỂN KHAI MAINNET — mint LAMP vào kho

> Soạn 2026-07-13. **Sửa lớn 2026-07-29** sau khi anh chốt policy + verify lại on-chain.
> Trạng thái: **CHƯA SẴN SÀNG mint giá trị thật**. Đây là việc phải làm theo thứ tự.

## Sự thật cứng (verify lại on-chain 2026-07-29 — `scripts/verify_mainnet_supply.ts`, Koios read-only)

- Policy mainnet `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` là bản **KHỞI TẠO
  (bootstrap)**, KHÔNG phải token canonical.
  > **Sửa 2026-09-02.** Bản trước ghi nó "LÀ token LAMP canonical 36 tỷ … không đẻ policy mới".
  > Sai theo hai chiều: datum khai cap 36 tỷ, nhưng **trần phát hành THỰC TẾ chỉ 26,37 tỷ** vì
  > nhánh `ReserveDraw` chết (`deployed.ts:92`, `:118-119`) — và A1 đã chốt phát hành policy
  > mới. Giữ lại câu cũ để không ai đọc bản trước rồi kết luận ngược.
- `supply_state` (`addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3`) mang thread NFT
  `SUPPLY`, inline datum constructor 0, **4 field**:
  `dist_minted` = 1.000.000 LAMP · `reserve_minted` = 0 · `dist_cap` = 26.370.000.000 ·
  `reserve_cap` = 9.630.000.000 → **tổng cap 36 tỷ**, còn mint được **26,369 tỷ + 9,63 tỷ**.
- Kho (`addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu`) đang giữ đúng 1.000.000 LAMP.
- ⇒ **Lazy-mint đã wired thật trên mainnet** — nhưng chỉ MỘT trong hai đường. Đường
  `DistributionVest` chạy được (đã đúc 1 triệu LAMP vào kho); đường `ReserveDraw` chết từ lúc
  đúc. Nên "mint LAMP vào kho" đi được qua policy này, còn 9,63 tỷ Reserve thì không —
  đó là lý do A1 chốt phát hành policy mới.

> **SỬA MỘT KHẲNG ĐỊNH SAI CỦA BẢN CŨ.** Bản 13/07 ghi: *"`55d3e01b…180f0` = 1e12 base
> (1 triệu LAMP), `mint_or_burn_count=1` → CỐ ĐỊNH, không mint thêm. Đây KHÔNG phải token 36 tỷ
> canonical"* và *"policy `lamp_mint` cap 36 tỷ CHƯA deploy mainnet"*. **Cả hai đều SAI.**
> `mint_or_burn_count=1` chỉ nói policy mới mint **một lần**, không nói nó **không mint được nữa**
> — trần thật nằm trong datum `supply_state`, và datum đó ghi 36 tỷ. Ai đọc bản cũ rồi kết luận
> "phải làm token mới" là bị dẫn sai. Giữ đoạn này lại để không ai lặp lỗi.

## A. Quyết định chiến lược
1. **ĐÃ CHỐT 2026-09-02: PHÁT HÀNH POLICY MỚI, khai tử bản mồi `55d3e01b…180f0`.**
   Thời điểm phát hành **chưa chốt** — phải diễn tập trọn vẹn trên Preprod trước
   (`Genesis/canonical-preprod-runbook.md`).

   > Bản chốt 2026-07-29 ghi ngược lại ("không migrate, không khai tử"). Nó không sai vì ai
   > cẩu thả — nó được chốt khi chưa ai biết lỗ dưới đây, đo được **2026-08-12**, tức muộn
   > hơn hai tuần. Giữ lại đoạn này để không ai đọc bản cũ rồi kết luận ngược.

   Lý do quyết định, theo thứ tự sức nặng:
   - **Ngõ cụt cứng.** `meter_nft_policy` nướng vào policy này là **28 byte 0**
     (`Genesis/offchain/src/deployed.ts:92`, đọc ngược từ bytecode trên chuỗi). Chuỗi đó
     không có tiền ảnh blake2b-224 nên không UTxO nào mang nổi NFT dưới nó ⇒ điều kiện
     `count_inputs_holding_nft(...) == 1` của nhánh `ReserveDraw` không bao giờ thoả ⇒
     **9,63 tỷ LAMP Reserve (26,75% tổng cung) không rút được, mãi mãi**
     (deployed.ts:118-119). Trần phát hành THỰC TẾ của policy này là **26,37 tỷ**, không
     phải 36 tỷ — `scripts/verify_mainnet_supply.ts` in ra đúng câu đó.
     apply-param không sửa được sau khi gửi (`onchain/validators/lamp_mint.ak:34`).
   - **Một khoá hai cổng.** `dist_authority` là danh sách MỘT pkh, ngưỡng 1-of-1, và pkh đó
     TRÙNG authority của kho `dist_treasury` (`deployed.ts` khối `caveats`). A-DEST vì thế
     là một khúc vòng hai giao dịch, không phải cái khoá thứ hai. Khoá nướng vào tham số
     nên không xoay được.
   - **Thời điểm rẻ nhất là bây giờ.** Mới đúc **1.000.000 LAMP** (0,0028%), nằm trong kho,
     và kho **chưa từng bị tiêu** ⇒ chưa một LAMP nào tới tay ai ⇒ không người nắm giữ nào
     bị ảnh hưởng. Mỗi đợt phân phối mở dưới policy mồi làm chi phí chuyển đổi nhân lên.
   - **Cái giá phải trả, nói thẳng.** `lamp_mint.ak:157` ép `delta > 0` nên 1 triệu LAMP đó
     **không đốt được**. Chúng ở lại như tài sản của một policy đã khai tử. Đây là vấn đề
     KHAI BÁO, không phải vấn đề tiền — xem cổng 5 ở cuối runbook.
2. **token_tag = `4c414d50`** — đã chốt (xem `kho-a-dest.md`).
3. **Kho A-DEST = `treasury.ak` vesting** — đã chốt. Kho mainnet hiện tại là `dist_treasury` 1-pkh
   (đang giữ 1 triệu LAMP) → **phải thay bằng `treasury.ak` TRƯỚC khi mint giá trị**.
4. **Authority**: hệ quả trực tiếp của A1. A1 chốt theo đường "policy mới" ⇒ **cửa MultiSig
   M-of-N (spec §11) mở lại**, và bản canonical 12 tham số còn đi xa hơn: WHO-gate đọc bảng
   registry theo `token_tag`, nên xoay khoá vận hành = sửa entry registry, KHÔNG redeploy.
   Con số M/N và danh sách người giữ khoá **chưa chốt** — quyết định vận hành, không phải
   quyết định kỹ thuật.

   > Bản trước ghi "không xoay khoá được ⇒ khuyến nghị M-of-N đã hết hiệu lực". Câu đó chỉ
   > đúng khi A1 đóng theo đường "giữ bản mồi". A1 đã đóng theo đường ngược lại.

## A'. Đối chiếu script on-chain — HAI PHẦN BA ĐÃ XONG, phần còn lại KHÔNG làm được theo cách cổng đòi

> **Sửa 2026-09-02.** Bản trước ghi *"chưa ai đối chiếu"*. Phát biểu đó sai theo **hai chiều cùng
> lúc**: đã làm nhiều hơn thế, và phần còn lại thì không thể làm theo cách cổng phát biểu.
> Nguồn số duy nhất: `Genesis/offchain/src/deployed.ts` khối `provenance` — đừng chép số sang chỗ khác.

| Script | Trạng thái đối chiếu | Cách đo |
|---|---|---|
| `lamp_mint` (`55d3e01b…180f0`) | ✅ **trùng byte** (2026-08-09) | dựng lại từ commit `457f312`, áp **8 tham số** ⇒ CBOR trùng byte, hash trùng |
| `supply_state` (`84f6d84f…34084`) | ✅ **trùng byte** (2026-08-12) | cùng commit nguồn; 528 byte trên chuỗi |
| `dist_treasury` (`d5e80c9a…edbb6`) | ⚠️ **chỉ hash** — trùng byte KHÔNG khả thi hôm nay | dựng `dist_treasury.ak` từ `60f7e3a`, áp authority ⇒ ra đúng `d5e80c9a…` |

**Vì sao phần thứ ba không làm được:** trên Cardano, byte của script chỉ lên chuỗi khi script **được
tiêu**. Kho `dist_treasury` chưa từng bị tiêu lần nào ⇒ **không có byte trên chuỗi để so**. Đây
không phải "chưa ai làm", mà là "không mở được": cổng viết *"đối chiếu từng byte trước khi mint giá
trị thật"* là **một cổng không có chìa**.

**Câu hỏi 8-hay-12 tham số đã có đáp án:** bản đang chạy dựng từ `457f312` với **8 tham số**
(authority khoá thường, threshold 1) — không phải bản 12 tham số registry-gate theo DID. Kéo theo:
A-DEST **không** được ép on-chain ở bản đang chạy, và bản 12 tham số ở mục B5 là bản **thiết kế**,
merge nó không đổi script đã deploy.

**Việc thật còn lại của mục này** không phải đi đo lại, mà là **phát biểu lại cổng**: điều kiện cho
lần mint tới phải đặt theo **hash + commit nguồn**, không theo byte trên chuỗi. Chừng nào cổng còn
viết theo byte thì nó vẫn đóng với `dist_treasury` — đó chính là ràng buộc fail-closed đang giữ A1
và A4 an toàn trong lúc hai mục đó còn mở (xem bảng ở cuối tệp). Phát biểu lại cổng **mở** ràng buộc
đó ra, nên hai việc phải đi cùng nhau, không làm lẻ.

## B. Code phải merge (hiện ở nhánh/worktree, chưa lên main)
5. **LAMP**: `lamp_mint` 12-param + registry read-side đã nằm trọn trong nhánh PR #17
   (`feat/launch-etd-airdrop-srcl`) → merge PR #17 là xong. Nhánh cũ
   `feat/lamp-mint-compose-anchor-cap` đã ghim tag `archive/feat-lamp-mint-compose-anchor-cap`.
   **Lưu ý:** bản 12-param này là bản THIẾT KẾ; policy đang chạy trên mainnet có thể là bản 8-param
   — xem mục A'. Merge code không tự động đổi script đã deploy.
6. ~~**LAMP**: dựng script deploy 12-param **production**~~ → **ĐÃ CÓ (2026-09-02)**, lớp Preprod:
   `scripts/_canonical_v2.ts` (wiring), `20_canonical_genesis.ts` … `23_prove_oneshot.ts`,
   `verify_canonical_v2.ts`, `v2_wiring_dry.ts`. Runbook: `Genesis/canonical-preprod-runbook.md`.
   Bốn marker đi qua `oneshot_nft.ak` / `treasury_nft.ak` (one-shot thật), kho-NFT đặt tại
   `treasury.ak` đúng như mục A3. Chưa gửi giao dịch nào; bước 1 mới ở mức dựng + eval xanh.
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
> pipeline với marker one-shot áp `genesis_ref` thật, rồi thử mint lượt thứ hai bằng cùng
> policy đó và **xác nhận nó bị chặn**. Chưa có phép thử đó thì mục C chưa xanh, dù mọi bước
> khác đã chạy.
>
> **Cập nhật 2026-09-02 — phép thử đó nay có script, chưa có kết quả.**
> `scripts/23_prove_oneshot.ts` kiểm hai chiều: (1) UTxO hạt giống đã biến mất khỏi tập UTxO
> sống ⇒ điều kiện one-shot không giao dịch nào về sau thoả được — phủ định cho MỌI lượt thử,
> không riêng lượt được dựng; (2) dựng thật một giao dịch đúc SUPPLY NFT thứ hai và xác nhận
> bị chặn (không ký, không gửi). Đường chạy mới KHÔNG dùng `scriptFromNative` cho khe marker
> nào, nên cổng MARKER-001 (`_guards.ts`) im — đo được ở lượt dựng khô, ghi trong runbook.

## C-bis. Diễn tập canonical v2 — trạng thái đo được (2026-09-02)

Chi tiết + lệnh chạy: `Genesis/canonical-preprod-runbook.md`.

| bước | việc | trạng thái |
|---|---|---|
| 0 | `v2:dry` — wiring khô, không chạm mạng | ✅ sạch: 5 marker ra 5 policy-id khác nhau, cổng APPLY-001/002 im |
| 1 | Tx A — đúc 5 marker one-shot | ⏳ **dựng + eval script OK trên Preprod** (CBOR 3.885 byte), **CHƯA gửi** |
| 2 | Tx B — `DistributionVest` → KHO | ⏳ chưa chạy (cần UTxO do Tx A tạo) |
| 3 | Tx C — `ReserveDraw` (nhánh chết ở mainnet) | ⏳ chưa chạy |
| 4 | bằng chứng one-shot (phủ định) | ⏳ chưa chạy |
| — | **Lớp 2**: MET dưới `reserve_draw.ak`, thử vượt trần nhịp phải bị chặn | ❌ **chưa dựng** |

> **Lớp 1 chứng minh nhánh Reserve MỞ ĐƯỢC, không chứng minh nó CÓ PHANH.** Ở Lớp 1, MET nằm
> ở ví, nên khi nó bị tiêu thì không validator nào chạy — trần nhịp δ ≤ E/1000 chưa được ép
> ở đâu cả. Phát hành mainnet với MET ở ví thì ai giữ khoá rút trọn 9,63 tỷ trong một giao
> dịch, chi phí bằng phí mạng (đúng đường (b) mà cổng MARKER-001 mô tả). Lớp 2 phải xanh
> trước khi bàn tới mainnet.

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
| A1 policy mainnet | **ĐÓNG 2026-09-02 — phát hành policy mới** | mục A1 ở đầu tệp: `deployed.ts:92` + `:118-119` (Reserve 9,63 tỷ không rút được), `lamp_mint.ak:34` (apply-param không sửa được). Đường này khớp `Papers/Whitepaper.md` đính chính 2026-08-26 (bản đang chạy là **khởi tạo**, §8–§9) |
| A4 authority | **MỞ — nhưng đã đổi bản chất** | A1 đóng theo đường "policy mới" ⇒ M-of-N khả thi trở lại, và bản 12 tham số cho xoay khoá qua registry mà không redeploy. Còn phải chốt: **con số M/N + danh sách người giữ khoá** (quyết định vận hành) |
| Thời điểm phát hành | **MỞ** | phải qua trọn `Genesis/canonical-preprod-runbook.md` (bước 1-4 + Lớp 2) trước khi bàn tới ngày |

**Ràng buộc đang giữ an toàn:** cổng A' dưới đây chặn mọi bước mint giá trị thật.
A1 đóng theo đường "policy mới" làm cổng đó rơi vào một trạng thái khác về chất: kho
`dist_treasury` cũ — chỗ duy nhất cổng không mở được vì chưa từng bị tiêu — **không còn nằm
trên đường mint giá trị thật nữa**. Policy mới dùng `treasury.ak` làm kho, và TRSY NFT bị
`treasury_nft.ak:50-56` ép hạ cánh ở một Script mang `TreasuryDatum` nợ mở = 0. Nên việc
phát biểu lại cổng theo `hash + commit nguồn` giờ **áp cho lần deploy mới**, không còn là
thứ ràng với A1 nữa.

Việc thật còn lại, theo thứ tự:
- **A' — phát biểu lại cổng đối chiếu theo `hash + commit nguồn`.** Nay áp cho **lần deploy
  mới**, không còn ràng với A1: kho `dist_treasury` cũ đã rời khỏi đường mint giá trị thật
  (lý do ở bảng trạng thái trên). Việc còn lại là câu chữ của cổng, không phải phép đo.
- **A4 — chốt M/N và danh sách người giữ khoá** cho authority của policy mới.
- **Duyệt merge B5–B10** (điều phối nhiều đội: LAMP/Tuân, Core/Thư, SuperApp, Long).
- **Cho phép gửi Tx A trên Preprod** để bước 2-4 của runbook chạy được — Tx A tiêu hạt giống
  và không làm lại được, nên nó không tự chạy.
- **Dựng Lớp 2** (MET dưới `reserve_draw.ak`) — chưa có, và đây là cổng nặng nhất còn lại.
- **Rồi mới D12–D15.**

Em (agent) KHÔNG thực thi bước mainnet nào (token thật, bất khả nghịch) — anh + đội làm, em chuẩn bị code + verify + diễn tập Preprod.

— LampNet agent
