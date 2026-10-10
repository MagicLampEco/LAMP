# Storage reward payout — CONTRACT v0.3 (2026-10-10)

v0.3 vá ba phát hiện soát an ninh PR #144 (chưa triển khai mạng nào, nên đổi hash chấp nhận được): (1) `Open` phải nộp
không muộn hơn epoch `start + batch_epochs`, với khoảng hiệu lực hữu hạn hai đầu gọn một epoch — trước đây hội đồng mở muộn
thì ai cũng `Close` được ngay trước mọi `PostRoot` (`SRP-OPEN-TIMELY`); (2) cô lập theo input chưa đủ, vì mint/withdraw/cert
của script khác vẫn chạy cùng giao dịch và chấm chung output trả lá ⇒ ép số redeemer từng nhánh (`SRP-SOLE-REDEEMERS`, cùng
khuôn `C-REL-SOLE` của custody); (3) `Burn` cũng đòi mọi input ngoài Tombstone là ví khoá. §3 sửa câu "chỉ `Collect`/`Deposit`
làm một dòng tăng". Định dạng lá không đổi so với v0.2.

v0.2 vá kết quả soát an ninh cùng ngày: cấm input script ngoài đợt ở Open/PostRoot/Claim (thoả-kép với `Release`
của custody) · người nhận chỉ là ví khoá, output trả không datum/ref script · lá mang định danh đợt · PostRoot nạp thêm
ADA được, Open ép ADA tối thiểu · Tombstone hoàn ADA cho người đóng · nguồn Open sạch · hạn đóng +2 epoch.
Định dạng lá v0.1 BỊ THAY — bộ dựng cây phải dùng §4 bản này.

Validator trả thưởng lưu trữ của LampNet bằng CARP, thuộc họ Treasury. Mã: `Treasury/onchain/validators/storage_reward.ak`
(mint + spend), logic thuần `Treasury/onchain/lib/magiclamp/treasury/storage_reward.ak`, bài kiểm
`Treasury/onchain/validators/storage_reward_test.ak`.

Mã nằm trong gói `Treasury/onchain` chứ không tách gói riêng: nhánh trả về đọc `CustodyDatum`/`LedgerEntry` của custody và
dùng lại `pointer.committee_approved`, `util.*`, `ledger.get`. Cùng gói thì kiểu custody có đúng một nguồn; tách gói thì phải
chép kiểu sang và hai bản trôi riêng mà trình biên dịch không báo.

## 1. Quyết định nguồn (chủ dự án, 2026-10-08)

1. Nhà LAMP dựng và giữ validator này. Tiền vào chỉ từ nhánh `Release` của custody (`Treasury/CONTRACT.md §4`), theo đợt.
2. Một đợt = 6 epoch (bằng N ký quỹ của LampNet). Số nạp = s × (F đã ký quỹ sẽ nhả trong đợt). Epoch e trả tối đa
   ⌊s·ΣF_e⌋, với s ≤ 0,5. Độ dài epoch lấy từ Utils `MS_PER_EPOCH_BY_NETWORK` (432.000 s), không gõ tay ở off-chain.
3. CARP đã nạp mà chưa chi hết quay về bucket `storage_reward` của custody theo ngữ nghĩa `Deposit`
   (`Treasury/CONTRACT.md §15.2`), thành một DÒNG SỔ custody tiêu lại được, rồi cuộn sang đợt sau qua một `Release` mới.

Ràng buộc kèm: CARP là native token thường, policy là tham số (mainnet chưa có policy) · có M-of-N · LampNet chỉ cấp gốc
cây băm danh sách nhận mỗi epoch, không dựng validator · định dạng lá do LAMP định nghĩa (§4).

## 2. Mô hình

**Đợt** = một UTxO ở địa chỉ validator, mang đúng 1 token chứng thực `(hash validator, "SRPBATCH")` và datum `Active`.

**Vì sao cần token.** `Release` của custody là permissionless: ai có proposal `Executed` cũng dựng được giao dịch chi, và
`ReleaseDraw` chỉ cam kết `to` + `amount`, không cam kết datum. Datum trên output nạp do người dựng giao dịch đặt, nên KHÔNG
tin được. Token chỉ đúc được dưới M-of-N (nhánh mint `MintBatch`), nên "UTxO có token" chứng minh datum ban đầu do hội đồng
viết; mọi chuyển trạng thái sau đó giữ datum theo luật. UTxO không token là **UTxO chưa mở**: datum của nó không được đọc.

**Vì sao token không bị đốt lúc trả về.** Nhánh `Deposit` của custody cấm mọi mint/burn trong giao dịch (`C-DEP-MINT`). Vì vậy
giao dịch trả về đẩy token sang một UTxO `Tombstone` ở chính địa chỉ validator (ADA tối thiểu do người đóng góp), và một giao
dịch sau (`Burn`) đốt nó, trả ADA cho người đóng. Token không bao giờ rời địa chỉ script trừ khi bị đốt. Nếu token thoát ra ví,
người giữ nó gắn được token vào output của một `Release` sau (permissionless) kèm datum bịa — tức chiếm trọn một đợt thật.

### 2.1 Kiểu dữ liệu

```
Round       { epoch: Int, root: ByteArray, leaf_count: Int, paid: Int, claimed: ByteArray }
PayoutDatum = Active { batch_id: ByteArray, start_epoch: Int, epoch_fees: List<Int>, share_bps: Int,
                       round: Option<Round> }
            | Tombstone { refund_to: VerificationKeyHash }
ClaimItem   { index: Int, amount: Int, proof: List<ByteArray> }
PayoutAction (spend) = Open | PostRoot { epoch, root, leaf_count } | Claim { claims: List<ClaimItem> } | Close | Burn
BatchMint    (mint)  = MintBatch | BurnBatch
```

- `batch_id` = `blake2b_256(txid ‖ u16_be(output_index))` của UTxO nguồn tiêu ở `Open` — duy nhất toàn chuỗi, ép lúc đúc.
  Không dùng `start_epoch` làm định danh: đóng sớm rồi mở lại đợt cùng `start_epoch` sẽ trùng định danh.
- `refund_to` = VK người đóng; `Burn` trả ADA của Tombstone về đó.
- `epoch_fees[i]` = ΣF của epoch dịch vụ `start_epoch + i`, do hội đồng khai lúc mở đợt (LampNet cung cấp).
- `share_bps` = s × 10000. Trần epoch e: `cap(e) = ⌊epoch_fees[e − start] × share_bps / 10000⌋`.
- `claimed` = bitmap ⌈leaf_count/8⌉ byte; lá i ứng với byte i/8, bit (7 − i mod 8), bit cao trước.

### 2.2 Tham số (nướng vào hash)

`carp_policy`, `carp_name` · `committee: List<VerificationKeyHash>`, `threshold` · `custody_hash` (payment script hash của
custody), `custody_seed_policy`, `custody_instance_id` (NFT chứng thực custody) · `reward_bucket` (bucket_id
`storage_reward`) · `batch_epochs` (= 6) · `ms_per_epoch`, `window_origin_ms`.

Hằng: `max_share_bps = 5000` · `max_leaves = 4096` · `close_grace_epochs = 2` · `min_batch_lovelace = 5_000_000` ·
tag lá `0x20`, tag nút `0x21`.

`min_batch_lovelace`: output đợt lớn nhất (bitmap 512 B, `paid`/CARP 10¹², epoch 6 chữ số) đo bằng `cbor.serialise` = 799 B;
min-UTxO Babbage = (160 + 799) × `coinsPerUTxOByte` 4310 = 4.133.290 lovelace; 5 ADA chừa ~21%. Bài
`min_batch_lovelace_covers_largest_datum` đo lại mỗi lượt kiểm. Đổi `coinsPerUTxOByte` trên mạng thì xét lại hằng này.

`close_grace_epochs = 2`: gốc epoch cuối đăng sớm nhất trong epoch `start + n`; hạn `start + n + 2` để lá của nó có trọn một
epoch sau epoch đăng gốc, kể cả khi hội đồng đăng muộn.

## 3. Các nhánh

| Nhánh | Ai | Làm gì |
|---|---|---|
| `Open` + mint `MintBatch` | M-of-N | Tiêu đúng một UTxO chưa mở, đúc 1 token, tạo đợt `Active` với `round = None` |
| `PostRoot` | M-of-N | Đăng gốc cây cho epoch dịch vụ đã kết thúc; bitmap và `paid` về 0 |
| `Claim` | Bất kỳ ai | Trả K lá theo bằng chứng; output thứ i+1 trả claim thứ i |
| `Close` (đợt có token) | Bất kỳ ai sau `start + batch_epochs + 2`; M-of-N bất kỳ lúc nào | Toàn bộ CARP + ADA của đợt vào dòng sổ custody `(storage_reward, ·)`; token sang `Tombstone { refund_to }` |
| `Close` (UTxO chưa mở) | M-of-N | Toàn bộ CARP + ADA vào dòng sổ custody |
| `Burn` + mint `BurnBatch` | Bất kỳ ai | Đốt token trong `Tombstone`; ADA về `refund_to` |

Open, PostRoot, Claim, Burn: ngoài input của chính đợt, mọi input là ví khoá (`SRP-ONLY-VK-INPUTS`). Close: thêm đúng input
custody (`SRP-RETURN-INPUTS`).

Mọi nhánh còn ép số redeemer (`SRP-SOLE-REDEEMERS`): không script Plutus nào ngoài những script nhánh cần được chạy cùng
giao dịch. Script native (multisig trả phí) không có redeemer nên vẫn dùng được. Giá: không ghép được thao tác script khác
(DEX, rút thưởng, cert) vào cùng giao dịch.

| Nhánh | `tx.redeemers` |
|---|---|
| `Open` + `MintBatch` | Đúng 2: `Mint(own)` + `Spend(nguồn)` |
| `PostRoot`, `Claim` | Đúng 1: `Spend(đợt)` |
| `Close` | `Spend(đợt)` + tối đa một `Spend` của input ở `custody_hash` (redeemer `Deposit`) |
| `Burn` + `BurnBatch` | Đúng 2: `Spend(Tombstone)` + `Mint(own)` |

**Mở đúng hạn (`SRP-OPEN-TIMELY`).** `Open` đọc epoch bằng `get_epoch_bounded` (cận dưới và cận trên hữu hạn, cùng epoch)
và đòi epoch đó ≤ `start + batch_epochs`. Hệ quả: đợt mở xong luôn còn ít nhất `close_grace_epochs` epoch trước khi `Close`
tự do (`start + batch_epochs + close_grace_epochs`). Đợt mở ở epoch `start + batch_epochs` vẫn đăng được gốc cho epoch dịch
vụ cuối và trả lá trong hai epoch ân hạn.

**Trả về đi qua `Deposit`.** Giao dịch `Close` tiêu cả UTxO custody với redeemer `Deposit { items }`, `items` gồm
`(reward_bucket, CARP, số CARP của đợt)` (bỏ khi bằng 0) và `(reward_bucket, ADA, lovelace của đợt)`. Validator này không đọc
redeemer của custody; nó đo KẾT QUẢ trên sổ: Δ dòng `(reward_bucket, CARP)` và Δ dòng `(reward_bucket, ADA)` giữa custody vào
và custody ra phải bằng đúng số đợt đang giữ. Custody tự ép Δ sổ khớp Δ value (`C-DEP-3`, `C-DEP-4`). Các nhánh
custody làm một dòng tăng: `Collect`, `Deposit` ở mọi bucket khai báo; `MigrateIn` và `StakeRewardIn` CHỈ ở hai bucket dành
riêng `1_000_000` (`migrate.reserve_inflow_bucket_id`) và `1_000_001` (`stake_reward.stake_reward_bucket_id`); `Release` chỉ trừ.
Bucket `storage_reward` không trùng hai bucket dành riêng: `SRP-OPEN-CLOSABLE` đòi `reward_bucket ∈ buckets`, và custody
ép `buckets.no_reserved`. `SRP-RETURN-INPUTS` + `SRP-SOLE-REDEEMERS` để lại đúng một redeemer custody trong giao dịch,
nên phép đo kết quả không bị vòng qua.

**Phép thử "rót vào sổ", từng output validator tạo ra:**

| Output | Nhánh tiêu lại | Điều kiện được thoả |
|---|---|---|
| Đợt `Active` (sau `Open`/`PostRoot`/`Claim`) | `PostRoot`, `Claim`, `Close` | có token; datum đúng dạng; M-of-N hoặc hết hạn |
| Dòng sổ custody `(storage_reward, CARP/ADA)` | custody `Release` | proposal `Executed` chi từ `storage_reward` (đợt sau) |
| `Tombstone` | `Burn` | token = 1, datum `Tombstone`, đốt −1 |
| Output trả lá | ví/script người nhận | ngoài phạm vi validator |

## 4. Định dạng lá (LampNet làm theo)

```
leaf = blake2b_256( 0x20
                  ‖ policy(28)             // hash validator storage_reward (= policy token đợt)
                  ‖ batch_id(32)           // datum đợt, §2.1
                  ‖ u64_be(epoch)          // epoch dịch vụ
                  ‖ u32_be(index)          // 0 ≤ index < leaf_count
                  ‖ u64_be(amount)         // đơn vị nhỏ nhất của CARP, > 0
                  ‖ payment                // 0x00 ‖ key_hash(28)  |  0x01 ‖ script_hash(28)
                  ‖ stake )                // 0x00  |  0x01 ‖ key_hash(28)  |  0x02 ‖ script_hash(28)
node = blake2b_256( 0x21 ‖ min(a, b) ‖ max(a, b) )     // so sánh byte theo thứ tự từ điển
```

- Cây: tầng 0 là các lá theo thứ tự `index`; mỗi tầng ghép cặp (0,1), (2,3)…; nút lẻ cuối tầng được ĐẨY NGUYÊN lên tầng
  trên (không nhân đôi, không đệm). Gốc của cây một lá là chính lá đó. Bằng chứng = danh sách nút anh em từ dưới lên, không
  kèm bit hướng (cặp đã sắp).
- Địa chỉ không nằm trong redeemer: validator dựng lá từ ĐỊA CHỈ CỦA OUTPUT trả, nên không trả được tới địa chỉ khác lá.
  Stake credential dạng con trỏ (pointer) bị từ chối.
- **Người nhận chỉ là ví khoá (ràng buộc tạm, fail-closed):** lá có payment `0x01` (script) mã hoá được nhưng validator TỪ
  CHỐI trả; output trả phải `NoDatum` và không reference script (`SRP-PAYEE-PLAIN`). LampNet không đưa nút có địa chỉ script
  vào cây cho tới khi điểm treo `SRP-T-PAYEE-DATUM` được giải.
- `policy ‖ batch_id` buộc lá vào đúng một đợt của đúng một bản triển khai: đóng sớm rồi mở đợt mới và đăng lại cùng
  `(epoch, root)` không trả lại được lá cũ (`SRP-LEAF-BATCH`). LampNet đọc `batch_id` từ datum đợt sau `Open`.
- Tag `0x20`/`0x21` tránh mọi tag đã dùng trong kho (`0x00`/`0x01` merkle Distribution, `0x03` `release.spend_spec_hash`,
  `0x04` `pointer.spend_spec_hash`, `0x10`/`0x11`). Lá dài 50–78 byte sau tag, nút 64 byte sau tag: hai miền khác tag lẫn độ dài.
- Vector kiểm (ghim ở các bài `batch_id_vector`, `leaf_vector_*`, `node_vector_sorted`): policy = `52×28`;
  batch_id = blake2b_256(`77` ‖ `0000`) = `083cdb5877e2861cc9fbfa4cbdb6ffbe221c309b3633023ce4a6e25c2b09922d`; epoch 100:
  - lá 0: VK `e1×28`, không stake, 1000 → `b2041a954820f9e7e05ee248d4f61cb8c167492035595b4e3417db6b706e20ac`
  - lá 1: VK `e2×28`, stake VK `5a×28`, 2500 → `21a5097770cef49482429906025643558f247882273adc1ec2699811ce924dca`
  - lá 2: VK `e4×28`, không stake, 500 → `23edc21c284d94fd2faf9577a9c51311bf18e13d2701180c2a69c725f8cb3053`
  - node(lá0, lá1) → `718bae551f47f787905688d2b175eb9c9ebbed585c3df09473cec0186d671e1a`; gốc = node(đó, lá2) →
    `367c75918807ae17d354fae61d1c139f868f58109ccebdd03fd29492464c55c7`
  - (chỉ để kiểm mã hoá) lá 2 với payee Script `e3×28` → `fc9ded531c6ecfe5efa51ae3f0b9eaa704ade22b49d09fbe8f9a4e6ebca6f557`

Mỗi epoch LampNet giao cho hội đồng: `(epoch, root, leaf_count)` và danh sách lá đầy đủ (để bất kỳ ai dựng được bằng chứng).

## 5. Bất biến

| Mã | Nội dung |
|---|---|
| `SRP-MINT-ONE` | `MintBatch` đúc đúng 1 token tên `SRPBATCH`, không gì khác dưới policy này |
| `SRP-OPEN-AUTH` | Mở đợt cần M-of-N |
| `SRP-ONE-INPUT` | Mọi nhánh spend: đúng một input ở script này (chống thoả-kép giữa hai đợt); `MintBatch` cũng đòi đúng một input nguồn chưa có token |
| `SRP-OPEN-OUT` | Đúng một output ở script, cùng địa chỉ đầy đủ với input nguồn, không reference script |
| `SRP-ONLY-VK-INPUTS` | Open (mint), PostRoot, Claim, Burn: mọi input ngoài input của chính script là ví khoá — không custody, không script lạ. Chặn thoả-kép: `Release` của custody (C-REL-7) cộng mọi output tới `to`, nên output đợt-tiếp-tục của Claim từng được tính làm người nhận `Release` trong cùng giao dịch |
| `SRP-OPEN-ID` | `batch_id = blake2b_256(txid ‖ u16_be(index))` của UTxO nguồn |
| `SRP-OPEN-SRC-CLEAN` | UTxO nguồn chỉ có ADA + CARP |
| `SRP-OPEN-MINADA` | ADA đợt lúc mở ≥ `min_batch_lovelace` |
| `SRP-PAYEE-PLAIN` | Output trả: payment credential là ví khoá, `NoDatum`, không reference script |
| `SRP-LEAF-BATCH` | Lá chứa `policy ‖ batch_id` của đợt đang trả |
| `SRP-BURN-REFUND` | `Burn`: có output tới VK `refund_to` mang ≥ ADA của Tombstone |
| `SRP-OPEN-FRESH` | `round = None`, `start_epoch ≥ 0` |
| `SRP-OPEN-TIMELY` | `MintBatch`: khoảng hiệu lực hữu hạn hai đầu, gọn một epoch; epoch đó ≤ `start + batch_epochs` ⇒ còn ≥ `close_grace_epochs` epoch trước khi `Close` tự do |
| `SRP-SOLE-REDEEMERS` | Số và mục đích redeemer theo bảng §3: Open 2 (mint + spend nguồn của chính hash), PostRoot/Claim 1, Close 1 + tối đa một spend custody, Burn 2 (spend + mint của chính hash). Chặn mint/withdraw/cert của script khác chấm chung output |
| `SRP-OPEN-SHAPE` | `len(epoch_fees) = batch_epochs`, mọi phần tử ≥ 0 |
| `SRP-SHARE-MAX` | `0 ≤ share_bps ≤ 5000` (s ≤ 0,5) |
| `SRP-OPEN-KEEP` | Đợt giữ TOÀN BỘ CARP của UTxO nguồn; ADA không giảm; value chỉ gồm ADA + CARP + token |
| `SRP-OPEN-FUNDED` | Σ cap ≤ CARP nạp — mọi trần đều chi được |
| `SRP-OPEN-CLOSABLE` | Reference input custody (đúng NFT) có CARP và ADA trong `accepted_assets`, có `reward_bucket` trong `buckets`. Hai trường này bất biến đời instance ⇒ đợt mở được thì đóng được |
| `SRP-AUTH-TOKEN` | `PostRoot`/`Claim`/`Burn` chỉ trên UTxO có token |
| `SRP-ROOT-AUTH` | Đăng gốc cần M-of-N |
| `SRP-ROOT-RANGE` | `start ≤ epoch < start + batch_epochs` |
| `SRP-ROOT-MONOTONIC` | `epoch` mới > `epoch` vòng trước. Đăng lại cùng epoch xoá bitmap và `paid` ⇒ nhân đôi trần |
| `SRP-ROOT-AFTER-EPOCH` | Epoch chuỗi (cận dưới khoảng hiệu lực) > `epoch` — epoch dịch vụ đã kết thúc |
| `SRP-CONT` | Output đợt: cùng địa chỉ, không reference script, datum = đúng bản dự kiến (so bằng Data). `PostRoot`: mọi asset ngoài ADA nguyên vẹn, ADA không giảm (datum phình tới ~600 B), gốc 32 byte, `1 ≤ leaf_count ≤ 4096`, bitmap toàn 0, `paid = 0` |
| `SRP-PAY-POSITION` | `outputs[0]` = đợt tiếp tục; `outputs[i]` trả claim thứ i. Mỗi output trả đúng một lá ⇒ không thoả-kép trong cùng giao dịch |
| `SRP-LEAF-BOUNDS` | `amount > 0`, `0 ≤ index < leaf_count` |
| `SRP-NO-DOUBLE` | Bit `index` chưa bật; bật trong datum ra (bắt cả claim trùng trong cùng giao dịch) |
| `SRP-PROOF` | `root_from(leaf(epoch vòng, index, amount, địa chỉ output), proof) == root` |
| `SRP-PAY-EXACT` | Output trả mang đúng `amount` CARP |
| `SRP-CAP-PER-EPOCH` | `paid + Σamount ≤ cap(epoch vòng)` |
| `SRP-CLAIM-VALUE` | CARP đợt giảm đúng Σamount; ADA không giảm; value sạch |
| `SRP-RETURN-INPUTS` | `Close`: ngoài đợt và custody, mọi input là ví khoá (chống một `Deposit` thoả cho hai script) |
| `SRP-RETURN-NOMINT` | `Close`: không đúc/đốt dưới policy này |
| `SRP-RETURN-LINE` | Δ sổ custody `(reward_bucket, CARP)` = CARP của đợt; Δ `(reward_bucket, ADA)` = lovelace của đợt |
| `SRP-CLOSE-AUTH` | Đợt có token: epoch chuỗi ≥ `start + batch_epochs + 2`, hoặc M-of-N |
| `SRP-TOMBSTONE` | Đợt có token: đúng một output ở script, cùng địa chỉ, datum `Tombstone { refund_to }` với `refund_to` 28 byte, value = token + ADA |
| `SRP-UNOPENED-AUTH` | UTxO chưa mở: M-of-N, và không output nào ở script |
| `SRP-BURN-TOMB` / `SRP-BURN-ONE` | Chỉ `Tombstone` được đốt; đốt đúng 1 |

## 6. Chống trả trùng — vì sao bitmap trong datum

| Phương án | Chi phí mỗi claim | Ghi chú |
|---|---|---|
| **Bitmap trong datum (chọn)** | 1 phép đọc bit + ghép lại ≤ 512 byte | Datum ≤ 512 byte bitmap; một UTxO, xử lý theo lô K claim/giao dịch |
| Sổ MPF các lá đã trả | ~35K mem mỗi bước bằng chứng, ×2 (chèn) | Script +~3 KB (thư viện), bằng chứng off-chain phức tạp hơn |
| Token "đã nhận" mỗi lá | 1 output + min-ADA mỗi lá | Rác UTxO, tốn ADA mỗi lá mỗi epoch |

Trần `max_leaves = 4096` giữ bitmap ≤ 512 byte. Đợt chỉ có MỘT vòng sống: đăng gốc epoch e+1 thì lá chưa nhận của epoch e
không nhận được nữa — CARP đó nằm lại đợt và về custody lúc `Close`. Hàng đợi tuần tự trên một UTxO là chủ đích: số lá mỗi
epoch nhỏ, và ai cũng đẩy được lô claim (người nhận không cần ký).

## 7. Mô hình đe doạ

| Kẻ tấn công | Đòn | Chặn bởi |
|---|---|---|
| Người dựng `Release` | Gắn datum bịa (gốc của mình) lên output nạp | Datum UTxO không token không được đọc; chỉ `Open` (M-of-N) tạo đợt |
| Người giữ token thoát ra | Gắn token vào output `Release` sau | Token không rời script: `SRP-TOMBSTONE`, `SRP-OPEN-OUT`, `SRP-CONT` |
| Người đẩy claim | Trả sai địa chỉ / thừa / trùng / vượt trần / rút ADA | `SRP-PROOF`, `SRP-PAY-EXACT`, `SRP-NO-DOUBLE`, `SRP-CAP-PER-EPOCH`, `SRP-CLAIM-VALUE` |
| Người đẩy claim | Tiêu hai đợt, một output trả cho cả hai | `SRP-ONE-INPUT`, `SRP-PAY-POSITION` |
| Người đẩy claim | Ghép Claim với `Release` của custody (đích = địa chỉ đợt) trong một giao dịch: output đợt-tiếp-tục vừa là đợt vừa là "người nhận" `Release`, CARP của `Release` vào túi kẻ dựng | `SRP-ONLY-VK-INPUTS` (lỗ gốc ở custody `recipients_ok` vá riêng ở custody) |
| Người đẩy claim | Gắn datum rác / ref script vào output trả cho người nhận là script | `SRP-PAYEE-PLAIN` |
| Hội đồng / bất kỳ ai | Đóng sớm, mở đợt mới, đăng lại cùng `(epoch, root)` để trả lá lần hai | `SRP-LEAF-BATCH`, `SRP-OPEN-ID` |
| Người lạ | Đốt Tombstone, lấy ADA của người đóng | `SRP-BURN-REFUND` |
| Hội đồng (dưới ngưỡng) | Đăng gốc, mở, đóng sớm | M-of-N |
| Hội đồng (đủ ngưỡng) | Gốc gian | Thiệt bị chặn bởi `cap(e)` mỗi epoch và CARP của đợt; không lấy được CARP qua `PostRoot` (value nguyên vẹn) hay `Close` (chỉ về custody) |
| Hội đồng (đủ ngưỡng) | Đăng lại epoch để nhân đôi trần | `SRP-ROOT-MONOTONIC` |
| Bất kỳ ai | Đóng đợt sớm để LampNet mất thưởng | `SRP-CLOSE-AUTH` (chỉ sau hạn, hoặc M-of-N) |
| Bất kỳ ai | Trả về ngoài sổ / về bucket khác / thiếu ADA | `SRP-RETURN-LINE` |
| Bất kỳ ai | Một `Deposit` thoả cho hai script trả về | `SRP-RETURN-INPUTS` |
| Bất kỳ ai | UTxO giả có datum `Active` | `SRP-AUTH-TOKEN` |
| Bất kỳ ai | Đóng tự do ngay sau khi hội đồng mở đợt muộn, trước mọi `PostRoot` | `SRP-OPEN-TIMELY` |
| Người dựng giao dịch | Ghép mint/withdraw/cert của script khác để output trả lá hoặc output hoàn ADA thoả hộ nó | `SRP-SOLE-REDEEMERS`, `SRP-ONLY-VK-INPUTS` (Burn) |

Giả định tin cậy (không kiểm on-chain được): `epoch_fees` khai lúc mở đợt khớp F ký quỹ thật ở LampNet; danh sách lá khớp
phép đo PoR. Thiệt tối đa khi cả hai sai = CARP của một đợt.

## 8. Chi phí (đo, aiken v1.1.21, `aiken check`)

Chi phí validator = ca `bench_*` trừ ca dựng fixture tương ứng.

| Ca | mem | cpu |
|---|---|---|
| Claim 1 lá, cây sâu 12, bitmap 512 B | 0,54 M | 0,174 G |
| Claim 8 lá | 1,59 M | 0,533 G |
| Claim 16 lá | 2,76 M (19,7% trần 14 M) | 0,939 G (9,4% trần 10 G) |
| Close, sổ custody 20 dòng (chỉ validator này; CustodyDatum giải mã một lần mỗi đầu) | 1,79 M | 0,536 G |

Script (chưa áp tham số) 7.418 B (v0.2: 6.722 B). Đo v0.3, 2026-10-10.

Close còn phải cộng chi phí nhánh `Deposit` của custody ở cùng giao dịch (chưa đo trong phiên này).

## 9. Điểm treo

| Mã | Treo gì | Ràng buộc tạm (fail-closed) | Ở đâu |
|---|---|---|---|
| `SRP-T-CARP-MAINNET` | Policy CARP mainnet chưa có | Tham số `carp_policy`; không triển khai mainnet khi CarpetMint chưa gửi cặp policy/tên | §2.2 |
| `SRP-T-COMMITTEE` | Nguồn hội đồng: tham số riêng hay đọc từ `GOVPOINTER` | Tham số riêng; đổi hội đồng = đợt mới ở script mới | §2.2 |
| `SRP-T-LEDGER-LINES` | `Deposit` có thể thêm 2 dòng sổ; custody chặn ở 20 dòng | `Close` bị custody từ chối khi sổ đầy; CARP nằm yên trong đợt | `Treasury/CONTRACT.md §13` |
| `SRP-T-FEES-ATTEST` | F_e do hội đồng khai, không đối chiếu on-chain với ký quỹ LampNet | Thiệt ≤ CARP một đợt; `SRP-SHARE-MAX` vẫn ép trên số khai | §7 |
| `SRP-T-UNCLAIMED-WINDOW` | Lá epoch e hết hạn khi đăng gốc e+1 | Hội đồng chọn thời điểm đăng; CARP chưa nhận về custody | §6 |
| `SRP-T-PAYEE-DATUM` | Trả cho nút có địa chỉ script (cần datum theo script đích) | Chỉ trả ví khoá; output trả `NoDatum`, không ref script (`SRP-PAYEE-PLAIN`) | §4 |
| `SRP-T-OFFCHAIN` | Bộ dựng giao dịch + bộ dựng cây chưa có | Không triển khai khi chưa có bài đầu-cuối | — |
