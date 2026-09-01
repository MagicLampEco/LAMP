# Đường tới đúc LAMP — bản đồ đo được, 2026-08-12

> Tệp này trả lời đúng một câu: **hôm nay còn thiếu gì để đúc LAMP, và ai gỡ.**
> Mọi con số ở đây **kiểm lại được bằng một lệnh**, không phải chép từ ghi chép cũ:
> ```
> bash Genesis/scripts/verify_deployed_bytes.sh
> ```
> Nguồn định danh duy nhất: `Genesis/offchain/src/deployed.ts`. Đừng chép giá trị đi nơi khác.

---

## 1. Câu trả lời ngắn

**Không có nút chặn kỹ thuật nào từ nhà khác. Để đúc LAMP hôm nay chỉ cần MỘT chữ ký.**

Bản validator đang chạy trên mainnet là bản **mồi 8 tham số**. Nhánh `DistributionVest` của nó
(`457f312:Genesis/onchain/validators/lamp_mint.ak:169-172`) đòi đúng hai điều:

1. `count_sigs(dist_authority, tx.extra_signatories) >= auth_threshold` — tức **một chữ ký** của
   pkh `180a5c17…ee0441` (`dist_authority` là danh sách MỘT phần tử, `auth_threshold = 1`);
2. `qty_to_script(tx.outputs, dist_dest, policy_id, token_name) >= delta` — toàn bộ lượng đúc rót
   vào script kho `d5e80c9a…`.

**Không đọc registry. Không đọc DID. Không cần reference input nào.**

⇒ Việc PhoenixKey gỡ mục *"chuẩn bị OrgDID đúc LAMP"* khỏi lịch là **gỡ đúng** — mục đó không có
việc để làm, chứ không phải chưa tới lượt. Registry/OrgDID chỉ vào cuộc ở bản **12 tham số**, mà
bản đó có **policy-id KHÁC**, tức là một lần phát hành token mới chứ không phải nâng cấp.

Còn lại có thể đúc: **26.369.000.000 LAMP** (`dist_cap` 26,37 tỷ − `dist_minted` 1 triệu, giải mã
từ CBOR SupplyState ghim ở `Genesis/offchain/src/supply_state.ts:31`).

---

## 2. Tám tham số — đọc ngược từ bytecode thật trên chain

Không lấy từ tài liệu nội bộ (tài liệu có thể sai, và đã từng sai). Lấy bằng cách kéo bytecode
đã-áp-tham-số từ koios rồi đọc ngược literal, sau đó **dựng lại từ mã nguồn và so từng byte**.

| # | Tên | Giá trị | Nghĩa |
|---|---|---|---|
| 1 | `thread_nft_policy` | `97213f24…ae77f0` | policy NFT one-shot định danh UTxO SupplyState |
| 2 | `thread_nft_name` | `"SUPPLY"` | tên NFT thread |
| 3 | `token_name` | `"LAMP"` | asset name của chính token |
| 4 | `dist_authority` | `[180a5c17…ee0441]` | **danh sách MỘT phần tử** — một khoá mở cổng đúc |
| 5 | `auth_threshold` | `1` | 1-of-1 |
| 6 | `dist_dest` | `d5e80c9a…4edbb6` | script hash KHO — A-DEST ép rót vào đây |
| 7 | `meter_nft_policy` | 28 byte `00` | **không có tiền ảnh** ⇒ nhánh `ReserveDraw` chết |
| 8 | `meter_nft_name` | `"MET"` | tên meter NFT |

Bằng chứng tái lập (chạy thật 2026-08-12):

| script | hash | commit nguồn | kết quả |
|---|---|---|---|
| `lamp_mint` | `55d3e01b…180f0` | `457f312` | ✅ byte khớp **2121/2121** |
| `supply_state` | `84f6d84f…b34084` | `457f312` | ✅ byte khớp **528/528** |
| `dist_treasury` | `d5e80c9a…4edbb6` | `60f7e3a` | 🟡 **hash khớp**, chain chưa có byte để so |

---

## 3. Ba sự thật khó nghe, có bằng chứng

### 3.1 🔴 MỘT KHOÁ HAI CỔNG — A-DEST không bảo vệ gì

`dist_authority[0]` và `authority` của kho `dist_treasury` là **CÙNG MỘT pkh** `180a5c17…ee0441`
(đọc ngược từ bytecode CẢ HAI script). Toàn bộ luật của kho là một dòng:

```aiken
list.has(self.extra_signatories, authority)   // dist_treasury.ak:21
```

⇒ Người ký được lệnh đúc cũng ký được lệnh rút kho, **không trần, không lịch, chi đi đâu cũng
được**. A-DEST là một **khúc vòng hai giao dịch**, không phải cái khoá thứ hai.

Mọi câu trong tài liệu mô tả A-DEST như biện pháp bảo vệ ("lộ khoá vận hành cũng không cướp được")
đều viết cho bản **12 tham số** và **không áp cho mainnet**. Đừng dẫn lại.

### 3.2 🔴 KHO CHƯA TỪNG BỊ TIÊU — đường ra chưa ai chạy thử

koios `/script_info` **không trả** bytecode cho `d5e80c9a…`. Trên Cardano byte của script chỉ lên
chain khi nó được **dùng**. Nghĩa là tới hôm nay chưa ai mở kho lần nào.

Hệ quả: 1.000.000 LAMP đang nằm trong một cái hộp mà **chưa ai thử mở**. Đúc thêm vào đó trước khi
thử mở là đánh cược toàn bộ dự án — LAMP **không burn được**, rót nhầm là vĩnh viễn.

### 3.3 `ReserveDraw` chết vĩnh viễn — nhưng 9,63 tỷ KHÔNG "mất"

`meter_nft_policy = 00`×28. Policy-id là hash 224-bit ⇒ không tồn tại tiền ảnh ⇒ điều kiện
`count_inputs_holding_nft(...) == 1` không bao giờ thoả.

**Chưa đúc = chưa tồn tại.** Không ai từng nắm 9,63 tỷ đó, không ai bị lấy mất gì. Phát biểu đúng —
và mạnh hơn phát biểu cũ:

> LAMP: **trần cứng 36 tỷ** (bất biến, nướng vào policy-id). **Phát hành hữu hiệu tối đa 26,37 tỷ.**
> Rổ Reserve 9,63 tỷ **vĩnh viễn không phát hành được** dưới policy này — đó là trần THẤP HƠN,
> tức khan hiếm hơn, không phải mất mát.

Đây là việc **đổi chữ, miễn phí**. Cách còn lại — đẻ policy mới để cứu Reserve — là trả token thật
để mua một lớp đệm mà chính spec gọi là "SAU CÙNG" (`Reserve/CONTRACT.md:4`).

---

## 4. Một ràng buộc TỰ ĐẶT cần chủ dự án quyết

`Genesis/kho-a-dest.md:36` và `Genesis/mainnet-deploy-plan.md:29-30` ghi:

> *"Mainnet ĐANG VI PHẠM: kho A-DEST là `dist_treasury` 1-pkh. **Phải thay bằng `treasury.ak`
> TRƯỚC khi rót thêm giá trị.**"*

**Câu đó không thực hiện được, và cũng không cần thiết.**

- **Không thực hiện được:** `dist_dest` nướng vào tham số ⇒ đổi kho = đổi script hash = **policy-id
  khác = token khác**. Thêm nữa `treasury.ak` nhận `lamp_policy` làm tham số
  (`Distribution/onchain/validators/treasury.ak:16-19`), mà `lamp_policy` lại cần `dist_dest` =
  hash của treasury ⇒ **vòng apply-param không giải được**.
- **Không cần thiết:** A-DEST chỉ ràng buộc **trong tx đúc**. Kho chi ra tự do với một chữ ký, nên
  nó làm được **TRẠM TRUNG CHUYỂN**: đúc → kho → tx thứ hai đẩy vào hợp đồng phân phối thật. Chính
  repo đã viết đường này rồi: `Genesis/scripts/mint_release_plan.ts:160` — *"Release kho→pot: tx
  riêng SPEND kho… rót LAMP vào pot từng đợt"*. Và mọi hợp đồng phân phối trong repo đều nhận
  `lamp_policy` làm **tham số**, nên bind được vào policy `55d3e01b…` đang chạy, không vòng.

⚠️ **Đây là chỗ cần chủ dự án chốt, LAMP agent không tự lật một quyết định đã ghi.** Hai lựa chọn:

| | Giữ nguyên câu cũ | Gỡ câu cũ, dùng trạm trung chuyển |
|---|---|---|
| Hệ quả | Việc đúc bị treo **vĩnh viễn** sau một cổng không mở được | Đúc được ngay, cửa sổ tin cậy = thời gian giữa 2 tx |
| Deploy validator Genesis mới | 5 | 0 |
| Policy-id | ĐỔI ⇒ token cũ thành mồ côi | GIỮ |

---

## 5. Khuyến nghị — thứ tự theo TÍNH BẤT KHẢ HỒI, không theo cảm giác quan trọng

**Bậc 0 — không chạm chain, sửa được, làm ngay**
1. ~~Đối chiếu byte 3 script~~ — **XONG** 2026-08-12 (§2).
2. Phát biểu lại cung theo §3.3. Danh sách tệp phải sửa ở §6.
3. Chủ dự án chốt §4.

**Bậc 1 — bất khả hồi nhưng giá trị ≈ 0. PHẢI làm trước mọi thứ khác**

4. **TX THĂM DÒ KHO.** Tiêu UTxO kho, tách ~1.000 LAMP ra một địa chỉ, trả phần còn lại về kho.
   Phí ~0,4 ADA. Nó chứng minh ba thứ mà không gì khác chứng minh được:
   - khoá `180a5c17…` **còn tồn tại và ký được**;
   - bytecode kho **đúng như hash tiên đoán** (byte lên chain sau tx này ⇒ đối chiếu được nốt vế
     thứ ba của §2);
   - **đường ra không kẹt**.

   Chưa làm bước này thì mọi lượt đúc đều là rót thêm vào một cái hộp chưa ai mở thử.
   **Đây là việc rẻ nhất và đáng làm nhất trong toàn bộ danh sách.**

5. **Diễn tập trọn vòng trên Preview với ĐÚNG kiến trúc 8 tham số** — xem §7. Mọi cuộc diễn tập
   trước nay chạy bản 12 tham số, tức chứng minh một thứ khác với thứ đang chạy.

**Bậc 2 — bất khả hồi, có giá trị. Chỉ sau khi bậc 1 xanh**

6. Chốt hợp đồng đích cho **đợt đầu**, và chứng minh đường ra của **chính nó** trước khi nạp.
7. Đúc **đợt nhỏ nhất trước** (ETD 12 triệu LAMP), qua trạm trung chuyển, vào pool.

**Đúc theo ĐỢT, không đúc trọn một lần.** Ba đợt launch đã lên kế hoạch cộng lại là **513 triệu
LAMP** (`Genesis/scripts/mint_release_plan.ts:124-128`) = **1,95%** headroom. Phí chênh giữa
"một lần" và "ba đợt" khoảng **3 ADA**. Còn lượng LAMP nằm dưới quyền một khoá thì chênh **4–7 bậc
độ lớn**. Ai lấy phí làm lý do đúc một lần là đang tối ưu trục rác.

*(Ghi chú kỹ thuật: A-DEST bản 8 tham số dùng `>=` chứ không phải `==`
(`457f312:.../lamp_mint.ak:172`) ⇒ một tx có thể **vừa đúc đợt n+1 vào kho vừa tiêu UTxO kho cũ
đẩy đợt n ra pool**, kéo trần rủi ro xuống đúng một đợt. Đã kiểm, không phải suy đoán.)*

---

## 6. Chọn hợp đồng đích — chỗ khác biệt thật sự

Mục tiêu là *"không ai, kể cả đội dự án, rút tắt được"*. Đo theo tiêu chuẩn đó:

> **Hai hợp đồng so sánh dưới đây không còn trong cây làm việc.** `Airdrop/` và `SRCL/` đều đã bàn giao ra ngoài
> repo này (SRCL 2026-08-30, Airdrop 2026-09-01). Phần so sánh **giữ nguyên làm bằng chứng lịch sử** — nó là chỗ ghi vì
> sao một pot đạt tiêu chuẩn "không ai rút tắt được" còn pot kia không, và bài học đó áp cho mọi pot
> dựng sau. Đọc mã bằng `git show 6df96ae:<đường-dẫn>`.

- **`Airdrop/onchain/validators/airdrop_pool.ak` ĐẠT.** `merkle_root`/`deadline`/`dest` **bất biến
  qua `Claim`** (`:20`); claim permissionless bằng proof; chống double-claim bằng slot spend-once;
  hết hạn thì `Sweep` toàn bộ LAMP còn lại về Treasury. **Sau khi nạp, không ai thêm được người
  nhận.** Điểm tin cậy duy nhất còn lại là "soạn root đúng" — và điểm đó công khai kiểm được bằng
  snapshot.
- **`SRCL/onchain/validators/srcl_pool.ak` CHƯA ĐẠT.** `SetRoot` cho admin **append một root mới
  mỗi epoch** (`:117-122`, trần `end_epoch + 1` root). Value được bảo toàn tuyệt đối trong
  `SetRoot`, nên đây không phải cửa rút tiền — nhưng nó **là** quyền thêm người nhận về sau.
  Nặng hơn: **ba lỗ đang MỞ**, chính `SRCL/README.md:140-157` ghi rõ, kèm câu phải vá **cùng một
  lượt** vì cả ba đổi script hash:
  - **S1 — cửa `Sweep` mở ngay từ ngày đầu.** `util.get_epoch` trả epoch POSIX **tuyệt đối**
    (~4132 hiện nay) trong khi `end_epoch = 35` là epoch **tương đối của chiến dịch** ⇒ `4132 > 35`
    ⇒ **bất kỳ ai cũng quét sạch pot về Treasury, không cần chữ ký**. Không mất tiền (tiền về
    Treasury) nhưng chiến dịch chết ở epoch 0. Test hiện tại xanh chỉ vì fixture đặt validity-range
    theo epoch *tương đối* — đúng lớp "test tự đối chiếu với niềm tin của chính nó" đã gặp ở
    `taad_mirror`.
  - **S2 — `Sweep` rò lovelace VÀ POOL NFT** (`srcl_pool.ak:194-204` chỉ kiểm phần LAMP). Mất POOL
    NFT là mất authenticity ⇒ **phải deploy lại toàn bộ**, mọi root đã phát thành vô dụng.
  - **S3 — tái tạo slot vô hạn** (`srcl_nft.ak:77-84` không cấm đúc tên KHÁC cùng policy trong tx
    `Claim`) ⇒ claim lặp. Bản vá đối chiếu có sẵn ở `Airdrop/onchain/validators/airdrop_nft.ak:122-131`.

  🔴 **ĐỪNG NẠP LAMP THẬT VÀO SRCL** trước khi vá cả ba. Lưu ý cơ chế SRCL **đã bàn giao cho Launch
  agent** (chốt 2026-08-04); `SRCL/` giữ nguyên trong repo này tới khi Launch port xong.
- **`Distribution/` (Capped Drop) — phụ thuộc PR #22.** Trên nhánh chính hiện nay `TreasuryDatum`
  chỉ có `committee_hash`, **không có sổ cái solvency**, và `Claim { amount }` không có trần nào.
  Sổ cái `outstanding_entitlement` + bất biến `≤ pool` chỉ tồn tại trên nhánh **PR #22 chưa merge**.
  ⇒ Muốn dùng kênh này thì **merge #22 trước**, và kể cả sau đó cũng phải nói đúng mức: nó biến
  *"một khoá rút ngay"* thành *"M-of-N rút dần theo vesting"* — **tốt hơn, chưa phải "không ai rút
  tắt được"**. Đừng viết ngược lên Papers.

---

## 7. Diễn tập testnet — thiếu đúng một thứ

Ba script `Genesis/scripts/01_deploy_lazymint.ts` · `02_mint_vest.ts` · `03_mint_more.ts` **đã áp
đúng 8 tham số** — chúng không sai. Chúng gãy vì đọc `onchain/plutus.json`, mà blueprint ở HEAD là
bản **12 tham số**. Áp 8 giá trị vào script 12 tham số thì lệch kiểu ngay từ apply-param.

**Cách gỡ, không phải sửa script:** dựng blueprint 8 tham số từ `457f312` rồi trỏ vào đó.

```bash
git worktree add --detach /tmp/lamp-8p 457f312
cp -R Genesis/onchain/build /tmp/lamp-8p/Genesis/onchain/     # dùng lại stdlib đã tải
( cd /tmp/lamp-8p/Genesis/onchain && aiken build )            # sinh plutus.json 8 tham số
```

Rồi chạy `01` → `03` trên Preview với `dist_authority` = ví test. Còn phải thay:
`GENESIS_REF_HASH` ở `02_mint_vest.ts:15-16` và `03_mint_more.ts:22-23` (khoá cứng UTxO cũ — phải
đúc thread NFT mới rồi thay), và `explorerTx` (`Genesis/scripts/config.ts:116`) luôn in URL Preview
kể cả khi `NETWORK=Preprod`.

⚠️ Một điều diễn tập **KHÔNG** bắt được: phiên bản compiler aiken lúc deploy mainnet **không ai ghi
lại**. Máy này đang có `v1.1.21`, và với phiên bản đó thì byte khớp tuyệt đối (§2) — nên rủi ro này
coi như đã đóng cho `lamp_mint`/`supply_state`, nhưng vẫn mở cho mọi validator mới.

---

## 8. Ai gỡ cái gì

| Việc | Ai | Trạng thái |
|---|---|---|
| Chốt §4 (giữ hay gỡ ràng buộc "đổi kho trước") | **chủ dự án** | chờ |
| Khoá ký `180a5c17…` | **chủ dự án** | repo không có, không suy ra được |
| Tx thăm dò kho | chủ dự án ký, LAMP agent dựng | chờ khoá |
| Blueprint 8 tham số + diễn tập Preview | LAMP agent | làm được ngay |
| Phát biểu lại cung (§3.3) trong Papers | LAMP agent | chờ chốt §4 |
| Sửa whitepaper Launch | **Launch agent** | đã gửi thư |
| PhoenixKey/OrgDID | **không ai** | không nằm trên đường găng — xem §1 |
| Vá S1/S2/S3 của SRCL trước khi nạp (cùng một lượt) | Launch agent (đã bàn giao) | chưa xếp lịch |

*Bản này tổng hợp từ ba lượt rà độc lập (bản đồ đường đi · phản biện đối kháng · rút về nguyên lý
gốc) do LAMP agent điều phối và kiểm lại từng khẳng định nặng. Chỗ nào hai lượt rà nói ngược nhau
thì lấy theo phép đo, và ghi rõ ở trên.*
