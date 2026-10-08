# Storage reward payout — CONTRACT v0.1 (2026-10-08)

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
PayoutDatum = Active { start_epoch: Int, epoch_fees: List<Int>, share_bps: Int, round: Option<Round> }
            | Tombstone
ClaimItem   { index: Int, amount: Int, proof: List<ByteArray> }
PayoutAction (spend) = Open | PostRoot { epoch, root, leaf_count } | Claim { claims: List<ClaimItem> } | Close | Burn
BatchMint    (mint)  = MintBatch | BurnBatch
```

- `epoch_fees[i]` = ΣF của epoch dịch vụ `start_epoch + i`, do hội đồng khai lúc mở đợt (LampNet cung cấp).
- `share_bps` = s × 10000. Trần epoch e: `cap(e) = ⌊epoch_fees[e − start] × share_bps / 10000⌋`.
- `claimed` = bitmap ⌈leaf_count/8⌉ byte; lá i ứng với byte i/8, bit (7 − i mod 8), bit cao trước.

### 2.2 Tham số (nướng vào hash)

`carp_policy`, `carp_name` · `committee: List<VerificationKeyHash>`, `threshold` · `custody_hash` (payment script hash của
custody), `custody_seed_policy`, `custody_instance_id` (NFT chứng thực custody) · `reward_bucket` (bucket_id
`storage_reward`) · `batch_epochs` (= 6) · `ms_per_epoch`, `window_origin_ms`.

Hằng: `max_share_bps = 5000` · `max_leaves = 4096` · `close_grace_epochs = 1` · tag lá `0x20`, tag nút `0x21`.

## 3. Các nhánh

| Nhánh | Ai | Làm gì |
|---|---|---|
| `Open` + mint `MintBatch` | M-of-N | Tiêu đúng một UTxO chưa mở, đúc 1 token, tạo đợt `Active` với `round = None` |
| `PostRoot` | M-of-N | Đăng gốc cây cho epoch dịch vụ đã kết thúc; bitmap và `paid` về 0 |
| `Claim` | Bất kỳ ai | Trả K lá theo bằng chứng; output thứ i+1 trả claim thứ i |
| `Close` (đợt có token) | Bất kỳ ai sau `start + batch_epochs + 1`; M-of-N bất kỳ lúc nào | Toàn bộ CARP + ADA của đợt vào dòng sổ custody `(storage_reward, ·)`; token sang `Tombstone` |
| `Close` (UTxO chưa mở) | M-of-N | Toàn bộ CARP + ADA vào dòng sổ custody |
| `Burn` + mint `BurnBatch` | Bất kỳ ai | Đốt token trong `Tombstone`; ADA tự do |

**Trả về đi qua `Deposit`.** Giao dịch `Close` tiêu cả UTxO custody với redeemer `Deposit { items }`, `items` gồm
`(reward_bucket, CARP, số CARP của đợt)` (bỏ khi bằng 0) và `(reward_bucket, ADA, lovelace của đợt)`. Validator này không đọc
redeemer của custody; nó đo KẾT QUẢ trên sổ: Δ dòng `(reward_bucket, CARP)` và Δ dòng `(reward_bucket, ADA)` giữa custody vào
và custody ra phải bằng đúng số đợt đang giữ. Custody tự ép Δ sổ khớp Δ value (`C-DEP-3`, `C-DEP-4`). Chỉ `Collect`/`Deposit`
làm một dòng tăng (`Release` chỉ trừ, hai bucket dành riêng không trùng `storage_reward`), nên phép đo kết quả không bị vòng qua.

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
- Tag `0x20`/`0x21` tránh mọi tag đã dùng trong kho (`0x00`/`0x01` merkle Distribution, `0x03` `release.spend_spec_hash`,
  `0x04` `pointer.spend_spec_hash`, `0x10`/`0x11`). Lá dài 50–78 byte sau tag, nút 64 byte sau tag: hai miền khác tag lẫn độ dài.
- Vector kiểm (ghim ở các bài `leaf_vector_*`, `node_vector_sorted`), epoch 100:
  - lá 0: VK `e1×28`, không stake, 1000 → `b47b90e38bfb8d0ba3ad2cc20edf9effd6ed869596dbaa0d65575fe24f61a01d`
  - lá 1: VK `e2×28`, stake VK `5a×28`, 2500 → `d9d4ea132efda1bb2ee67470508161ea1d8849b7baea876d76fb352ff4bbc442`
  - lá 2: Script `e3×28`, không stake, 500 → `f33bf1891dfaf93aa97b47b79b4279dc205a86f9a1dcf5c3e5c8598250e78d9c`
  - node(lá0, lá1) → `1e52485a61e469159777b1da7051a46649dadeee7e9a3fb20f8760a69acc6622`; gốc = node(đó, lá2) →
    `88deba76829b2b3a99ddfc570dc4e58277d235d93c4a88e3fe7871613adc80c7`

Mỗi epoch LampNet giao cho hội đồng: `(epoch, root, leaf_count)` và danh sách lá đầy đủ (để bất kỳ ai dựng được bằng chứng).

## 5. Bất biến

| Mã | Nội dung |
|---|---|
| `SRP-MINT-ONE` | `MintBatch` đúc đúng 1 token tên `SRPBATCH`, không gì khác dưới policy này |
| `SRP-OPEN-AUTH` | Mở đợt cần M-of-N |
| `SRP-ONE-INPUT` | Mọi nhánh spend: đúng một input ở script này (chống thoả-kép giữa hai đợt); `MintBatch` cũng đòi đúng một input nguồn chưa có token |
| `SRP-OPEN-OUT` | Đúng một output ở script, cùng địa chỉ đầy đủ với input nguồn, không reference script |
| `SRP-OPEN-FRESH` | `round = None`, `start_epoch ≥ 0` |
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
| `SRP-CONT` | Output đợt: cùng địa chỉ, không reference script, datum = đúng bản dự kiến (so bằng Data). `PostRoot`: value nguyên vẹn, gốc 32 byte, `1 ≤ leaf_count ≤ 4096`, bitmap toàn 0, `paid = 0` |
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
| `SRP-CLOSE-AUTH` | Đợt có token: epoch chuỗi ≥ `start + batch_epochs + 1`, hoặc M-of-N |
| `SRP-TOMBSTONE` | Đợt có token: đúng một output ở script, cùng địa chỉ, datum `Tombstone`, value = token + ADA |
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
| Hội đồng (dưới ngưỡng) | Đăng gốc, mở, đóng sớm | M-of-N |
| Hội đồng (đủ ngưỡng) | Gốc gian | Thiệt bị chặn bởi `cap(e)` mỗi epoch và CARP của đợt; không lấy được CARP qua `PostRoot` (value nguyên vẹn) hay `Close` (chỉ về custody) |
| Hội đồng (đủ ngưỡng) | Đăng lại epoch để nhân đôi trần | `SRP-ROOT-MONOTONIC` |
| Bất kỳ ai | Đóng đợt sớm để LampNet mất thưởng | `SRP-CLOSE-AUTH` (chỉ sau hạn, hoặc M-of-N) |
| Bất kỳ ai | Trả về ngoài sổ / về bucket khác / thiếu ADA | `SRP-RETURN-LINE` |
| Bất kỳ ai | Một `Deposit` thoả cho hai script trả về | `SRP-RETURN-INPUTS` |
| Bất kỳ ai | UTxO giả có datum `Active` | `SRP-AUTH-TOKEN` |

Giả định tin cậy (không kiểm on-chain được): `epoch_fees` khai lúc mở đợt khớp F ký quỹ thật ở LampNet; danh sách lá khớp
phép đo PoR. Thiệt tối đa khi cả hai sai = CARP của một đợt.

## 8. Chi phí (đo, aiken v1.1.21, `aiken check`)

Chi phí validator = ca `bench_*` trừ ca dựng fixture tương ứng.

| Ca | mem | cpu |
|---|---|---|
| Claim 1 lá, cây sâu 12, bitmap 512 B | 0,48 M | 0,152 G |
| Claim 8 lá | 1,46 M | 0,474 G |
| Claim 16 lá | 2,56 M (18,3% trần 14 M) | 0,839 G (8,4% trần 10 G) |
| Close, sổ custody 20 dòng (chỉ validator này) | 2,76 M | 0,810 G |

Close còn phải cộng chi phí nhánh `Deposit` của custody ở cùng giao dịch (chưa đo trong phiên này).

## 9. Điểm treo

| Mã | Treo gì | Ràng buộc tạm (fail-closed) | Ở đâu |
|---|---|---|---|
| `SRP-T-CARP-MAINNET` | Policy CARP mainnet chưa có | Tham số `carp_policy`; không triển khai mainnet khi CarpetMint chưa gửi cặp policy/tên | §2.2 |
| `SRP-T-COMMITTEE` | Nguồn hội đồng: tham số riêng hay đọc từ `GOVPOINTER` | Tham số riêng; đổi hội đồng = đợt mới ở script mới | §2.2 |
| `SRP-T-LEDGER-LINES` | `Deposit` có thể thêm 2 dòng sổ; custody chặn ở 20 dòng | `Close` bị custody từ chối khi sổ đầy; CARP nằm yên trong đợt | `Treasury/CONTRACT.md §13` |
| `SRP-T-FEES-ATTEST` | F_e do hội đồng khai, không đối chiếu on-chain với ký quỹ LampNet | Thiệt ≤ CARP một đợt; `SRP-SHARE-MAX` vẫn ép trên số khai | §7 |
| `SRP-T-UNCLAIMED-WINDOW` | Lá epoch e hết hạn khi đăng gốc e+1 | Hội đồng chọn thời điểm đăng; CARP chưa nhận về custody | §6 |
| `SRP-T-PAYEE-DATUM` | Người nhận là script có thể cần datum | Validator không ép datum output trả | §4 |
| `SRP-T-OFFCHAIN` | Bộ dựng giao dịch + bộ dựng cây chưa có | Không triển khai khi chưa có bài đầu-cuối | — |
