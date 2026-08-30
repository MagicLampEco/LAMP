# Treasury — FEAT (Đặc tả tính năng / hành vi)

**Trạng thái:** bản thảo 2026-06-05. Bám sát [CONTRACT.md](./CONTRACT.md) (khung interface đã
duyệt). KHÔNG mâu thuẫn contract. Mọi tham số số học chưa chốt được đánh dấu
**"tham số mở (DAO định)"**.

> Spec này mô tả **hành vi nhìn thấy được** của Treasury: ba cửa tiền, luồng thu
> (`collectToTreasury`), vòng đời bucket, cổng giải ngân qua Governance, mô hình đa thuê bao,
> và vai của từng caller. Người không-kỹ-thuật đọc cũng hiểu hệ vận hành ra sao.
> KHÔNG đi sâu công thức (xem [MATH](./Math-Spec.md)) hay datum/redeemer/validator on-chain
> (xem [TECH](./Tech-Spec.md)) hay lộ trình build/deploy (xem [EXEC](./Exec-Spec.md)).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

Treasury là **kho bạc đa-asset có ghi sổ** của một hệ sinh thái trên Cardano. Nó giải quyết bốn
nhu cầu, không trộn lẫn:

1. **Thu phí giao thức về một nơi** — mọi app (generators MAGIC, OriLife, SDK bên thứ ba) trả
   một phần phí về Treasury qua **một hàm chung** `collectToTreasury`, thay vì mỗi app tự chế.
2. **Ghi sổ minh bạch** — mỗi lần thu để lại receipt `(app_id, asset, amount, cut, epoch)` →
   kiểm toán được, làm đầu vào cho uy tín / Voting Power.
3. **Giải ngân có kiểm soát** — tiền chỉ rời kho khi một proposal Governance đã **duyệt xong**
   (status `Executed`); Treasury **thi hành**, không tự bỏ phiếu/tự tính ngưỡng (T1). Qua
   multi-sig council + time-lock.
4. **Giảm lưu hành mà KHÔNG phá tổng cung** — LAMP fixed-supply 36 tỷ là tuyệt đối; "thu về
   Treasury" chỉ **chuyển trạng thái** UTxO lưu hành → kế toán trong kho, đúng mô hình
   [Cardano treasury](https://docs.cardano.org/about-cardano/explore-more/cardano-treasury/)
   (ADA vào treasury không bị đốt, chỉ rời circulating).

Mục tiêu cuối của cả dự án: **làm cho LAMP có giá trị** bằng cách mở SDK cho mọi Cardano team.
Vì vậy Treasury là **một instance param hóa** — không hard-code cho riêng MagicLamp; bất kỳ team
nào cũng dựng được kho bạc riêng từ cùng validator.

Nguyên lý nền (từ CONTRACT §2, §5 — KHÔNG vi phạm):

1. **Ba cửa tiền tách bạch**, KHÔNG gộp polymorphic theo địa chỉ.
2. **Bảo toàn value on-chain là tuyệt đối** — `Σ out = Σ in` cho mọi asset; "giảm lưu hành" là
   thuộc tính **kế toán**, không phải đốt.
3. **Custody tách accounting** — value nằm ở UTxO custody; bucket là **sổ trong datum**, không
   phải mỗi bucket một UTxO (chống bloat + min-ADA).
4. **Định giá nằm ở app, không ở Treasury** — Treasury nhận `amount` đã tính sẵn.

### 0.2 Thuộc spec này

- Ba cửa tiền: `transfer` / `collectToTreasury` / `donateToCardanoTreasury` — phân biệt rạch ròi.
- Luồng `collectToTreasury`: app gọi → split protocol cut → ghi vào bucket → phát receipt.
- Thu theo lô (batch) — nhiều micro-fee gộp vào một settlement tx.
- Vòng đời bucket: tạo → nạp (qua collect) → đề xuất chi → release → đối soát.
- Cổng giải ngân qua Governance: Governance đã duyệt (status `Executed`) → Treasury **thi hành**, KHÔNG tự bỏ phiếu / tự tính ngưỡng (T1).
- Tạo và cấu hình instance đa thuê bao (open SDK).
- Giảm lưu hành bằng chuyển trạng thái (KHÔNG burn).
- Vai của từng caller: generators (MAGIC), OriLife, app SDK; council giải ngân; business mở
  instance riêng. User story cho từng vai.

### 0.3 KHÔNG thuộc spec này (thuộc spec khác)

| Chủ đề | Thuộc spec |
|---|---|
| Công thức split cut, làm tròn, chứng minh bảo-toàn-value tổng quát | [MATH](./Math-Spec.md) *(chưa viết)* |
| Cận an toàn của batch (không drain qua làm tròn), chứng minh đối soát bucket | MATH |
| Datum schema (custody, sổ bucket, receipt), redeemer, validator Aiken | [TECH](./Tech-Spec.md) *(chưa viết)* |
| Đếm theo payment script hash, chống double-satisfaction on-chain | TECH |
| Đọc beacon Governance qua reference input; time-lock; multi-sig council | TECH |
| Sharding custody khi UTxO quá lớn; tách physical emergency bucket | TECH |
| Lộ trình build, mốc, test plan, deploy Preview, tích hợp generators/OriLife | [EXEC](./Exec-Spec.md) *(chưa viết)* |
| **Định giá phí** (bò ≠ gà — `animal_fee`), quy đổi LAMP↔USD/ADA qua oracle | App (OriLife) + Oracle, **NGOÀI** Treasury |
| Cơ chế vote, công thức Voting Power | [Governance/VotingPower](../Governance/VotingPower/) |

### 0.4 Quan hệ với tài liệu cũ — CONTRACT là chuẩn

[CONTRACT.md](./CONTRACT.md) là nguồn chuẩn. [SPEC.md](./SPEC.md) cũ ("3 kho bạc cứng:
Community / Operational / Emergency") nay **DEPRECATE về phần hard-code**: ba kho đó trở thành
**ba bucket cấu hình** trong một instance, KHÔNG còn là ba contract cứng. Mẫu validator tái dùng
từ [`Distribution/onchain/validators/treasury.ak`](../Distribution/onchain/validators/treasury.ak)
(đã build + audit: `C-TRE-1` đếm theo script hash, `C-VAL-0` bảo toàn tuyệt đối mọi asset,
`C-MINT-0`, và `M1` = ada-drain test) làm nền.

---

## 1. Ba cửa tiền — vì sao tách, không gộp

Tiền ra/vào hệ có **ba ý nghĩa khác nhau về kế toán và quyền**. Gộp chúng thành một hàm
polymorphic phân nhánh theo địa chỉ là **anti-pattern** — nó làm bất biến bảo-toàn-value bị thỏa
mãn rỗng (nếu `treasury == wallet` thì "treasury nhận ≥ X" luôn đúng mà không thu gì — đúng bài
học Preview generators, CONTRACT §6). Vì vậy ba hàm **riêng biệt**:

| Hàm | Ý nghĩa kế toán | Có ghi sổ? | Asset |
|---|---|---|---|
| `transfer(asset, amount, addr)` | gửi ví thường — tiền vẫn **lưu hành** | KHÔNG | đa-asset |
| `collectToTreasury(asset, amount, app_id, category)` | **thu về kho** — rời lưu hành sang kế toán | CÓ (receipt + sổ bucket) | accepted_assets |
| `donateToCardanoTreasury(ada)` | quyên vào **kho bạc Cardano** (field `donation` của Conway ledger era) | KHÔNG (kho ngoài hệ) | **ADA-only** |

Phân biệt then chốt:

- **`transfer`** không liên quan Treasury. Người dùng chuyển LAMP cho nhau bình thường; tổng cung
  và lưu hành không đổi. Có ở đây chỉ để nói rõ: **không phải mọi luồng tiền đều là "thu kho"**.
- **`collectToTreasury`** là cửa duy nhất làm LAMP **rời lưu hành** (chuyển trạng thái sang kế
  toán). Đây là trục của spec — chi tiết §2.
- **`donateToCardanoTreasury`** dùng hai field tx-level thêm ở **Conway ledger era**:
  `donation` (key 22, `positive_coin`) và `current_treasury_value` (key 21, `coin`) trong
  `transaction_body`
  ([conway.cddl, cardano-ledger](https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/conway/impl/cddl/data/conway.cddl))
  — ADA-only, **không có địa chỉ đích** (vào kho bạc Cardano cấp
  giao thức, không phải kho MagicLamp). LƯU Ý: hai field này thuộc **Conway CDDL của ledger**,
  KHÔNG phải nội dung [CIP-1694](https://cips.cardano.org/cip/CIP-1694) (CIP-1694 chỉ định nghĩa
  Treasury Withdrawal — chiều RÚT, ngược lại; nó không định nghĩa field donation). Tách hẳn vì đây
  là tiền **rời khỏi hệ MagicLamp** vào kho bạc của chính Cardano — không ghi sổ bucket, không
  release lại được.
  ⚠️ KHÔNG nhầm với "ADA vào Treasury": ADA vào **script Treasury MagicLamp** (giữ đa-asset) đi
  qua `collectToTreasury`, KHÁC hoàn toàn `donateToCardanoTreasury`.

---

## 2. `collectToTreasury` — luồng thu dùng chung

Đây là hàm **mọi app dùng chung** để trả phí giao thức về kho. Một lần thu đi qua bốn bước nhìn
thấy được; **không bước nào định giá** (app đã tính `amount` trước khi gọi).

### 2.1 Bốn bước của một lần thu

1. **Nhận** `collectToTreasury(asset, amount, app_id, category)` với `asset ∈ accepted_assets`
   của instance. Nếu asset không nằm trong danh sách chấp nhận → từ chối.
2. **Split protocol cut.** Một phần `cut = amount × protocol_cut_bps / 10000` (làm tròn — quy tắc
   chính xác ở MATH) được giữ lại cho Treasury. **Chỉ `cut` đi vào custody** — phần còn lại
   `residual = amount − cut` **đi thẳng tới ví provider/node trong CÙNG settlement tx**, KHÔNG bao
   giờ nằm trong custody. App/caller chỉ định đích của `residual`; Treasury không can thiệp giá trị
   nhưng tx phải chứng kiến `cut` về custody (mô hình "chỉ cut vào custody, residual ra provider
   cùng tx" — KHÔNG phải "thu cả `amount` rồi rút `residual` sau").
3. **Ghi vào bucket — ĐƠN-BUCKET (mặc định).** Toàn bộ `cut` vào **đúng một** bucket =
   `category` của lần thu: số dư bucket `category` tăng đúng **`cut`** trong **sổ kế toán (datum)**,
   KHÔNG tạo UTxO mới cho bucket. Đây là đường mặc định (`cut → category`, **T2** —
   [CONTRACT §9 T2](./CONTRACT.md)): một collect chỉ chạm **một** bucket, KHÔNG chia cut ra nhiều
   bucket. Value vật lý vào custody cũng chỉ là **`cut`** (vào **một UTxO custody** hoặc shard) —
   khớp với số dư bucket `category`. `residual` không qua custody.
   *(Đa-bucket — chia một `cut` cho nhiều bucket theo `split_table` — CHỈ là **tùy chọn instance**,
   KHÔNG phải đường mặc định; xem §5.1.)*
4. **Phát receipt.** Ghi `(app_id, asset, amount, cut, epoch)` → để kiểm toán + làm tín dụng cho
   Voting Power / uy tín (app_id biết "ai đóng góp bao nhiêu").

### 2.2 Bất biến bảo toàn value (lõi)

Với **mọi** asset, sau một settlement tx thu (bất biến áp cho **`Σ cut`**, KHÔNG phải `Σ amount` —
`residual` không qua custody, xem §2.1 bước 2):

```
Σ treasury_out.value(asset) ≥ Σ treasury_in.value(asset) + Σ cut(asset)
```

Đây là **tổng quát hóa theo HAI chiều** của bất biến `treasury_receives_lamp >= lamp_paid` đã có ở
generators MAGIC ([InstantGen vault.ak L298-313](https://github.com/MagicLampEco/MAGIC/blob/main/InstantGen/onchain/validators/vault.ak) (repo MAGIC)):

1. **Đa-asset** — generators chỉ áp cho LAMP; Treasury áp cho **mọi** asset trong `accepted_assets`.
2. **Đếm theo payment script hash** — generators hiện đếm theo **FULL ADDRESS**
   (`o.address == treasury_addr`, gồm cả stake credential — xem `vault.ak`), còn Treasury đếm theo
   **payment script hash** (§4.4, bài học C1/C2/M1 Distribution).

Dấu **`≥`** (không phải `=`) để Treasury được **gộp nhiều output** trong một tx. Chứng minh + cận
an toàn ở MATH.

⚠️ Đây KHÔNG phải mở rộng thuần "chỉ nâng `=` thành `≥`": cách **đếm cũng đổi** (full-address →
script-hash). Generators đếm full-address là **điểm YẾU**: hai output cùng payment script nhưng
khác stake credential bị tính tách → vẫn hở đường double-satisfaction qua stake cred (chính lỗ
C1/C2 mà Distribution đã sửa nhưng generators CHƯA). Vì vậy khi migrate generators sang cửa thu
chung, phải **nâng cách đếm** chứ không chỉ đổi giá trị `treasury_addr` (xem EXEC §4.1).

⚠️ Bất biến này chỉ có nghĩa khi **địa chỉ Treasury tách khỏi mọi ví tạo output cùng tx**
(lý lẽ "thỏa mãn rỗng nếu `treasury == wallet`" trình bày đầy đủ ở §1 + nguồn chuẩn
[CONTRACT §6](./CONTRACT.md)).

### 2.3 Thu theo lô (batch) — vì sao bắt buộc

Thu **từng** micro-fee on-chain là **bất khả thi**: mỗi UTxO Cardano cần min-ADA
(~1 ADA, [protocol parameters](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/))
+ phí mạng cho mỗi tx. Một phí 0.01 LAMP không thể tự nó là một tx. Vì vậy:

- App tích lũy nhiều khoản phí off-chain (hoặc trong UTxO trung gian của app).
- Định kỳ, **một settlement tx** gộp nhiều `collect` lại → một lần ghi sổ, một lần vào custody.
- Cửa sổ gộp (mỗi bao nhiêu, mỗi bao lâu) là **tham số mở (DAO định)** — đánh đổi giữa độ trễ
  ghi sổ và phí.

### 2.4 Định giá KHÔNG ở Treasury

Treasury **không biết** bò đắt hơn gà. Nó nhận `amount` đã tính. Logic "phí bao nhiêu cho loài
nào" nằm ở app (OriLife `animal_fee` —
[AnimalIdentity-Trust-Fee.md](../../OriLifeTrace/OriLife-Specs/AnimalIdentify/AnimalIdentity-Trust-Fee.md)).
Quy đổi LAMP↔USD/ADA (oracle TWAP) cũng ở phía app. Lý do first-principles: **một kho bạc đa thuê
bao không thể biết mô hình giá của mọi app** — nếu nhúng định giá vào Treasury thì mỗi app mới
phải sửa Treasury, phá tính open SDK.

⚠️ **Đừng trộn hai tỷ lệ.** `animal_fee` 7% của OriLife
([AnimalIdentity-Trust-Fee.md](../../OriLifeTrace/OriLife-Specs/AnimalIdentify/AnimalIdentity-Trust-Fee.md))
là **phí APP-LEVEL** (OriLife tự định, do app thu của người dùng), KHÔNG phải `protocol_cut_bps`
của Treasury. Luồng đúng: app tính `amount` (đã gồm hoặc chưa gồm phí app — do app quyết) → gọi
`collectToTreasury(amount)` → Treasury mới cắt **`protocol_cut_bps`** (tham số mở, DAO định) **lên
`amount` đó**. Hai con số ở hai tầng khác nhau: 7% là tầng app, `protocol_cut_bps` là tầng giao
thức — KHÔNG suy ra `protocol_cut_bps = 7%`.

---

## 3. Vòng đời bucket

**Bucket = một mục trong sổ kế toán** (datum), không phải một UTxO. Một instance có nhiều bucket
(vd: community, ops, emergency, **reward**, hoặc do team tự đặt). DAO chỉnh tỉ lệ và ngưỡng từng
bucket.

**Hai nhịp chi khác nhau** (MECE theo nhịp giải ngân):

- **Bucket theo proposal rời rạc** — community, ops, emergency: chi khi một proposal Governance
  riêng lẻ pass đủ ngưỡng (§4). Nhịp **không định kỳ**, theo từng đề xuất.
- **Bucket `reward`** — nạp từ cut như bucket thường, nhưng **chi theo epoch, gần tự động**: số
  reward mỗi app do AppEconomics `distribute()` tính (Treasury KHÔNG tính, chỉ giữ + chi pool theo
  số đó). Chi reward **vẫn qua release-gate Governance** (proposal "phân bổ reward epoch e" pass —
  EXEC §5.4), KHÔNG có đường chi tự động bỏ qua cổng. Khác community/ops ở chỗ **nhịp định kỳ theo
  epoch** và **số liệu đến từ engine AppEconomics**, không phải con số trong từng proposal rời rạc.

### 3.1 Các trạng thái

1. **Tạo** — khi cấu hình instance (§5), liệt kê các bucket + thuộc tính (tên, ngưỡng release).
2. **Nạp** — `collectToTreasury(..., category)` cộng `cut` vào số dư bucket `category`. Đây là
   **đường vào duy nhất** của bucket thường.
3. **Đề xuất chi** — một proposal Governance nêu rõ: bucket nào, asset gì, bao nhiêu, đích đến.
4. **Release** — khi proposal pass đủ ngưỡng (§4), tiền rời custody, số dư bucket giảm tương ứng.
5. **Đối soát** — sau mỗi tx, tổng số dư các bucket khớp value custody (trừ phần đã release).
   Chứng minh ở MATH.

### 3.2 Custody tách accounting (chống bloat)

Tất cả bucket **chia sẻ một UTxO custody** (hoặc một số ít shard nếu value quá lớn). Số dư từng
bucket chỉ là **con số trong datum**. Lý do (CONTRACT §1):

- Nếu mỗi bucket một UTxO → mỗi bucket khóa min-ADA riêng, và mỗi lần thu phải đụng nhiều UTxO →
  bloat + phí cao + contention.
- Một custody + sổ datum → một lần thu chỉ cập nhật một UTxO. Tối ưu eUTxO/ExUnit.

### 3.3 Emergency bucket tách physical

**Ngoại lệ có chủ đích:** emergency bucket được tách thành **UTxO physical riêng** (isolation).
Lý do: sự cố khẩn cấp cần đường giải ngân **không phụ thuộc** trạng thái custody chính (nếu
custody chính bị khóa do tranh chấp/đề xuất đang treo, emergency vẫn chi được). Đánh đổi bloat
chấp nhận được vì chỉ một bucket. Chi tiết cô lập physical ở TECH.

---

## 4. Release qua cổng Governance

Tiền **chỉ rời kho** khi một proposal Governance đã **duyệt xong** (status `Executed`). Treasury
**không tự** quyết chi, **không tự bỏ phiếu, không tự tính ngưỡng** — nó là cái két **thi hành**
quyết định Governance đã chốt. Governance là người giữ chìa; Treasury chỉ mở két khi thấy cờ
`Executed` (mô hình Model A, **T1 / Gov D3** — [CONTRACT §9 T1](./CONTRACT.md),
[VotingPower/CONTRACT.md §5 D3](../Governance/VotingPower/CONTRACT.md)).

### 4.1 Cổng đọc cờ Executed (KHÔNG tự tính ngưỡng)

Release đọc trạng thái proposal qua **reference input / beacon** của Governance (không tiêu UTxO
Governance, chỉ đọc — [CIP-31 reference inputs](https://cips.cardano.org/cip/CIP-31)). Theo
**Model A (T1)**, Treasury kiểm **đúng bốn điều cờ**, KHÔNG tự đánh giá vote:

1. `status == Executed` — proposal đã được Governance duyệt và chuyển sang thi hành.
2. **Proposal NFT** đúng (định danh proposal hợp lệ, chống giả mạo).
3. `spend_spec_hash` khớp — hash canonical danh sách `(bucket, asset, amount, đích)` Treasury
   sắp chi đúng bằng cái Governance đã duyệt (chống đổi đích/số sau khi pass).
4. `execute_after_epoch` đã tới — mốc time-lock đã qua.

Treasury **KHÔNG** đọc số phiếu, **KHÔNG** so ngưỡng, **KHÔNG** tính Voting Power. Mọi đánh giá
ngưỡng (gồm clamp BFT) Governance đã ép **trước** khi đặt cờ `Executed` (xem §4.2).

### 4.2 Ngưỡng do Governance ép trước — Treasury không tự kiểm

Ngưỡng release **không phải việc của Treasury**. Governance là nơi tính và ép ngưỡng; khi một
proposal đạt ngưỡng (gồm clamp BFT 1/21 + sàn cứng số DID thuận), Governance mới đặt cờ
`status == Executed`. Treasury chỉ thấy cờ đó (§4.1) rồi thi hành.

Ngưỡng minh họa theo loại proposal/bucket (số do **Governance** giữ, KHÔNG phải Treasury — viết
dạng **"≥"**, tham số mở DAO định, KHÔNG phải số cuối):

| Loại bucket | Ngưỡng minh họa (Governance ép) |
|---|---|
| community (grants, ecosystem) | ≥ 2/3 |
| ops (vận hành, hạ tầng) | ≥ 1/2 |
| emergency (security incident) | ≥ 2/3 |

Ngưỡng tính theo mô hình Voting Power đã chốt (cử tri = người, KHÔNG phải token-weighted —
xem [VotingPower/CONTRACT.md](../Governance/VotingPower/CONTRACT.md)). **Bảng trên chỉ để minh
họa bối cảnh** — Treasury không cài đặt nó; nó là tham số phía Governance.

### 4.3 Council + time-lock

Giải ngân cần **multi-sig council** ký + **time-lock** (một khoảng chờ giữa pass và chi).

**Vai council = CHỈ thực thi, KHÔNG phủ quyết.** Council chỉ ký tx release **sau khi** Governance
đã đặt cờ `status == Executed` (§4.1, ngưỡng do Governance ép — §4.2) + qua time-lock. Council
**KHÔNG** có quyền chặn một proposal đã đạt ngưỡng
(≥) — nếu cho phép chặn thì council thành một quyền phủ quyết M-of-N **lên trên** kết quả vote
DID-based (cử tri = người, [VotingPower/CONTRACT.md](../Governance/VotingPower/CONTRACT.md)), tái
tập trung đúng thứ governance model muốn tránh, mâu thuẫn nguyên lý "Governance giữ chìa, Treasury
là két" (§4 mở đầu). Council chỉ là **tay thực thi kết quả vote**, không phải tầng phê duyệt thứ
hai.

Lý do first-principles của time-lock: cho phép **phát hiện và phản ứng** nếu một proposal độc hại
lọt qua — là **phanh khẩn cấp giới hạn** (chỉ trì hoãn/đóng băng trong thời hạn để cộng đồng phản
ứng, KHÔNG thay thế hay đảo ngược vote), không phải khâu phê duyệt lại. Chi tiết cơ chế ở TECH.

### 4.4 An toàn release (không drain)

- **Bảo toàn value:** mọi asset không-được-release giữ nguyên tuyệt đối (chống drain ADA — bài
  học audit M1).
- **Chống double-satisfaction:** đếm input/output theo **payment script hash** trên toàn tx, đúng
  **một** custody in + **một** custody out (bài học C1/C2/M1 Distribution — N× release qua nhiều
  UTxO khác stake-cred bị chặn). Chi tiết enforcement ở TECH.

---

## 5. Instance đa thuê bao (open SDK)

Treasury là **một validator param hóa**. Mỗi hệ sinh thái dựng **một instance** riêng từ cùng mã.

### 5.1 Tham số một instance

`(governance_ref, accepted_assets[], buckets[], protocol_cut_bps)`:

- `governance_ref` — beacon/hash của hệ Governance giữ chìa release của instance này.
- `accepted_assets[]` — các asset instance chấp nhận thu (vd LAMP, ADA, token doanh nghiệp).
- `buckets[]` — danh sách bucket + thuộc tính (tên, ngưỡng release). Mặc định mỗi collect dồn
  `cut` vào **một** bucket = `category` (đơn-bucket, **T2** — §2.1 bước 3).
- `protocol_cut_bps` — phần Treasury giữ lại mỗi lần thu (tham số mở — DAO định).
- `split_table` *(tùy chọn)* — bảng chia một `cut` cho **nhiều** bucket theo tỉ lệ. **KHÔNG**
  bật mặc định; chỉ instance nào cần đa-bucket mới cấu hình. Khi không có `split_table`, hệ chạy
  đơn-bucket `cut → category` (§2.1 bước 3, T2).

### 5.2 Cấu hình ai đổi được gì

- **Lúc tạo:** người dựng instance đặt giá trị khởi tạo (asset, bucket, cut).
- **Sau đó:** thay đổi tham số (cut, ngưỡng bucket, thêm asset) phải qua **proposal Governance**
  của chính instance đó — không ai đơn phương đổi. (Treasury không tự đổi tham số của mình.)

### 5.3 MagicLamp là một instance, không phải đặc quyền

MagicLamp dựng **một** instance (asset chính = LAMP + ADA; buckets = community/ops/emergency).
Một team eco khác dựng **instance khác** (asset riêng, bucket riêng, cut riêng) từ **cùng
validator**. Đây chính là điểm "open SDK": không ai phải fork Treasury. Lý do hướng-mục-tiêu:
mỗi team dùng được Treasury → mỗi team là một caller của `collectToTreasury` → mỗi luồng phí làm
LAMP hữu dụng hơn (khi instance đó nhận LAMP), dẫn tới mục tiêu cuối **LAMP có giá trị**.

---

## 6. Giảm lưu hành bằng chuyển trạng thái — KHÔNG BURN

**Bất biến tuyệt đối:** LAMP fixed-supply 36 tỷ. KHÔNG có nhánh burn, KHÔNG có `deflation_bps`.

- "Thu về Treasury" = chuyển một lượng LAMP từ **UTxO lưu hành** sang **kế toán trong Treasury**.
  Token vẫn còn trong tổng cung; chỉ **rời lưu hành**. Governance chi lại sau.
- Value on-chain **luôn** bảo toàn tuyệt đối: `Σ out = Σ in` cho mọi asset. Không có nhánh nào
  làm tổng cung giảm.
- **circulating** là thuộc tính **kế toán**, tính bằng:

  ```
  circulating = tổng_cung − Σ balance(các Treasury instance)
  ```

  Nó là một **con số dẫn xuất**, KHÔNG phải một thao tác đốt on-chain.

Đây đúng mô hình [Cardano treasury](https://docs.cardano.org/about-cardano/explore-more/cardano-treasury/):
ADA vào treasury không bị đốt, chỉ rời circulating, governance phân bổ lại sau. Lý do
first-principles: **đốt là không thể đảo ngược và phá cam kết fixed-supply**; chuyển trạng thái
giữ được cả tính khan hiếm (rời lưu hành tạo áp lực cung) lẫn cam kết tổng cung bất biến (niềm tin
holder), và cho phép tái phân bổ qua Governance.

---

## 7. Vai caller + User story

LAMP ← MAGIC một chiều. Caller của `collectToTreasury` là **bên ngoài** Treasury (generators,
OriLife, app SDK). Treasury không gọi ngược ai.

### 7.1 Generators (MAGIC) — caller

Generators (Snapshot/Instant/Vacuum/Schedule) đã có bất biến `treasury_receives_lamp >= lamp_paid`.
Họ là caller mẫu: khi một generator thu phí, một phần đi Treasury qua `collectToTreasury`. Treasury
**siết chặt** bất biến đó theo hai chiều (§2.2): per-asset thay vì chỉ LAMP, và đếm theo payment
script hash thay vì full-address. Cách đếm full-address hiện tại của generators là điểm yếu (hở
double-satisfaction qua stake cred); migrate sang cửa thu chung **bắt buộc nâng cách đếm**, không
chỉ đổi `treasury_addr` (EXEC §4.1).

### 7.2 OriLife — caller

OriLife định giá `animal_fee` (bò ≠ gà) **ở app**, rồi gọi `collectToTreasury(LAMP, fee, "orilife",
category)`. Treasury chỉ nhận số đã tính, split cut, ghi sổ. OriLife không cần biết nội bộ kho.

### 7.3 App SDK bên thứ ba — caller + người mở instance

Một team Cardano bất kỳ: hoặc (a) gọi `collectToTreasury` của instance MagicLamp (nếu trả phí về
kho MagicLamp), hoặc (b) **mở instance riêng** (§5) rồi tự là caller của instance mình.

### 7.4 User story

**US-1 — App tích hợp (lập trình viên OriLife):**
> "App tôi định giá `animal_fee` xong. Tôi gọi một hàm `collectToTreasury(LAMP, fee, 'orilife',
> 'community')`, gộp nhiều con vật trong một settlement tx mỗi epoch. Tôi nhận receipt để chứng
> minh đóng góp. Tôi KHÔNG phải tự viết logic kho bạc, split, hay chống double-satisfaction."

**US-2 — Council giải ngân (thành viên hội đồng MagicLamp):**
> "Governance đã duyệt một proposal grant community (đạt ≥2/3 — Governance tự ép ngưỡng đó) và đặt
> cờ `status == Executed`. Tôi cùng council ký tx release sau khi qua time-lock. Validator Treasury
> KHÔNG đếm phiếu — nó chỉ kiểm cờ `Executed` + Proposal NFT + `spend_spec_hash` (khớp
> bucket/asset/amount/đích Governance đã chốt) + `execute_after_epoch`, và mọi asset khác giữ
> nguyên (§4.1). Tôi KHÔNG thể rút quá số proposal duyệt, KHÔNG thể drain ADA, KHÔNG thể chi khi
> chưa `Executed`. Và tôi **KHÔNG thể chặn** một proposal đã `Executed` — vai tôi chỉ là **ký thi
> hành kết quả Governance**, không phải phê duyệt lại (§4.3)."

**US-3 — Business mở instance riêng (team Cardano khác):**
> "Tôi dựng một Treasury instance cho token của mình: `accepted_assets=[MYTOKEN, ADA]`,
> ba bucket, `protocol_cut_bps` của tôi, trỏ `governance_ref` về DAO của tôi. Cùng validator
> MagicLamp, không fork. App của tôi gọi `collectToTreasury` của instance này. Khi tôi cũng chấp
> nhận LAMP, tôi trở thành một nguồn cầu cho LAMP."

---

## 8. Tham số mở (DAO định)

| Tham số | Ý nghĩa | Ghi chú |
|---|---|---|
| `protocol_cut_bps` | phần Treasury giữ mỗi lần thu | mỗi instance riêng; đổi qua proposal |
| Ngưỡng release từng bucket | vd community ≥2/3, ops ≥1/2, emergency ≥2/3 | dạng "≥"; số minh họa, chưa chốt |
| Cửa sổ batch | bao nhiêu collect / bao lâu gộp một settlement | đánh đổi độ trễ ghi sổ ↔ phí |
| `split_table` (tỉ lệ phân bổ cut theo bucket) | cut chia về các bucket thế nào | **TÙY CHỌN** — mặc định đơn-bucket `cut → category` (T2); chỉ bật khi instance cần đa-bucket |
| Time-lock release | khoảng chờ giữa pass và chi | phanh an toàn |
| Số shard custody | khi value quá lớn cho một UTxO | [cần verify] ngưỡng tối ưu — TECH |
| Ngưỡng tách physical ngoài emergency | có bucket nào khác cần cô lập không | mặc định chỉ emergency |

---

## 9. Phụ thuộc

- **Governance** ([VotingPower](../Governance/VotingPower/)) — cổng release; đọc kết quả vote
  (Voting Power: cử tri = người, KHÔNG token-weighted).
- **Oracle** LAMP↔USD/ADA — cho app **định giá**, **NGOÀI** Treasury (quyết định **app-side**,
  ngoài phạm vi Treasury). Ví dụ nguồn oracle khả dĩ: Charli3, Score DEX TWAP — **chưa chốt**.
- **Caller:** generators (MAGIC), OriLife, app SDK. (LAMP ← MAGIC một chiều.)
- **Nền validator:** [`Distribution/onchain/validators/treasury.ak`](../Distribution/onchain/validators/treasury.ak)
  (mẫu release có kiểm soát, đã audit `C-TRE-1`/`C-VAL-0`/`C-MINT-0`/`M1`).
- **Conway / CIP:**
  [conway.cddl (cardano-ledger)](https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/conway/impl/cddl/data/conway.cddl)
  — field `donation` (key 22) + `current_treasury_value` (key 21) ở `transaction_body` (cơ chế
  quyên kho bạc Cardano);
  [CIP-1694](https://cips.cardano.org/cip/CIP-1694) (tham chiếu cho mô hình treasury Cardano nói
  chung + Treasury Withdrawal, KHÔNG phải nguồn của field donation);
  [CIP-31](https://cips.cardano.org/cip/CIP-31) (reference inputs đọc beacon).

---

## 10. Câu hỏi còn treo

1. **(ĐÃ CHỐT mô hình custody)** Mô hình settlement: **chỉ `cut` vào custody**, `residual =
   amount − cut` đi thẳng ví provider/node trong **cùng tx**, KHÔNG bao giờ qua custody (§2.1 bước
   2-3; bất biến §2.2 áp cho `Σ cut`). **Phần còn TREO** chỉ là *mức độ Treasury chứng kiến đích
   `residual`*: settlement tx có cần Treasury kiểm đích phần `residual` (chống app khai khống
   `amount` rồi nuốt phần lẽ ra trả node), hay chỉ kiểm `cut` về kho? → ảnh hưởng bất biến ở MATH.
   **Cần anh/DAO chốt mức độ tin cậy caller.** (Lưu ý: dù chốt hướng nào, `residual` vẫn KHÔNG vào
   custody — điều treo chỉ là Treasury có *quan sát* đích residual hay không.)
2. **Emergency bucket physical:** nạp emergency từ đâu? Có một phần cut tự động vào emergency mỗi
   lần thu, hay chỉ nạp bằng proposal riêng? → ảnh hưởng vòng đời §3.3.
3. **Đa asset trong một bucket:** một bucket community giữ đồng thời LAMP + ADA + token khác, hay
   mỗi bucket một asset? → ảnh hưởng datum (TECH) + đối soát (MATH).
4. **Receipt lưu bao lâu / gọn cỡ nào?** Ghi đủ `(app_id, asset, amount, cut, epoch)` mỗi collect
   có thể phình datum theo lô lớn. Có cần gộp receipt (Merkle root theo epoch) thay vì lưu từng
   dòng? → đánh đổi audit chi tiết ↔ kích thước datum. **Cân nhắc ở TECH.**
5. **Cross-instance:** nếu instance team khác chấp nhận LAMP, có cơ chế nào để Voting Power
   MagicLamp tính tín dụng đóng góp đó không, hay receipt chỉ có nghĩa trong instance phát ra?
6. **Reward bucket nằm trong custody core hay tách instance/physical?** Reward có nhịp chi định kỳ
   theo epoch (khác community/ops rời rạc, §3) và số liệu đến từ AppEconomics `distribute()`. Có
   nên tách physical như emergency (isolation) để chi reward định kỳ không vướng custody chung
   khi có proposal khác đang treo? → đồng bộ với EXEC §13.3 (đang treo, chưa chốt).

---

## 11. Phản hồi audit (vòng 1 — 2026-06-05)

Áp đủ 9 finding. Tóm tắt thay đổi để truy vết:

1. **[major] Nguồn `treasury_donation`** — bỏ trích CIP-1694 cho field donation (CIP-1694 chỉ định
   nghĩa Treasury Withdrawal, chiều rút). Đổi nguồn sang **conway.cddl của cardano-ledger** (field
   `donation` key 22 + `current_treasury_value` key 21 ở `transaction_body`), giữ CIP-1694 làm
   tham chiếu mô hình chung. Đã verify tên field + key index trực tiếp trên conway.cddl (đường dẫn
   đúng: `eras/conway/impl/cddl/data/conway.cddl`). Sửa ở §1, bảng §1, §9. (3 spec
   CONTRACT/TECH/MATH sửa đồng bộ ngoài file này — xem ghi chú dưới.)
2. **[major] "Tổng quát hóa" generators** — nói rõ Treasury siết theo HAI chiều: per-asset +
   đếm theo **payment script hash** (generators hiện đếm full-address `o.address == treasury_addr`,
   `vault.ak` L298-313, còn hở double-satisfaction qua stake cred). KHÔNG phải quan hệ "tập con".
   Sửa §2.2, §7.1; đồng bộ EXEC §1 + §4.1.
3. **[major] Residual vs custody** — chốt mô hình: **chỉ `cut` vào custody**, `residual = amount −
   cut` đi thẳng ví provider/node cùng tx, KHÔNG qua custody. Bất biến §2.2 áp cho `Σ cut`. Gỡ Câu
   hỏi treo #1 thành "đã chốt mô hình custody; còn treo chỉ là mức độ Treasury quan sát đích
   residual". Sửa §2.1 bước 2-3, §2.2, §10.1.
4. **[minor] Trùng "treasury==wallet"** — giữ lý lẽ đầy đủ một lần ở §1; §2.2 chỉ trỏ về §1 +
   CONTRACT §6.
5. **[minor] Link oracle** — bỏ link charli3.io cạnh marker [cần verify]; nêu rõ là quyết định
   app-side, ví dụ nguồn khả dĩ (Charli3, Score DEX TWAP) **chưa chốt**. Sửa §9.
6. **[minor] Sót bucket `reward`** — thêm reward vào §3 với nhịp chi định kỳ theo epoch (số liệu từ
   AppEconomics `distribute()`, vẫn qua release-gate Governance), khác community/ops rời rạc. Thêm
   Câu hỏi treo #6 đồng bộ EXEC §13.3.
7. **[minor] Council vs vote** — §4.3 làm rõ council CHỈ thực thi, KHÔNG phủ quyết proposal đã đạt
   ngưỡng; time-lock là phanh khẩn cấp giới hạn, không thay vote. Đồng bộ US-2 §7.4.
8. **[nit] Mã test** — chuẩn hóa `C-TRE/M1` → `C-TRE-1`/`C-VAL-0`/`C-MINT-0`/`M1` (đúng định danh
   trong `treasury.ak`). Sửa §0.4, §9.
9. **[nit] Hai tỷ lệ 7% vs cut** — §2.4 thêm câu phân biệt `animal_fee` 7% là phí app-level của
   OriLife, KHÔNG phải `protocol_cut_bps` của Treasury.

**Ghi chú đồng bộ ngoài FEAT** (cần áp ở các spec kia, ngoài phạm vi lần sửa này):
- Finding 1: sửa nguồn donation ở CONTRACT §2, TECH §0, MATH §2.1 (cùng đổi CIP-1694 → conway.cddl).
- Finding 2: EXEC §1 + §4.1 đã sửa kèm lần này (đổi "tập con" → "siết chặt + đếm script-hash").

---

## 12. Phản hồi reconcile 2026-06-05

Áp hai quyết định ghim CONTRACT §9 (**T1**, **T2**). Chỉ sửa mục lệch, giữ phần còn lại.

1. **[T1 — Release-gate Model A]** Mô tả release lại thành "**Governance đã duyệt (Executed) →
   Treasury thi hành**", KHÔNG còn để Treasury tự bỏ phiếu / tự tính ngưỡng:
   - §4 mở đầu: đổi "proposal đã pass" → "đã duyệt (status `Executed`)"; nói rõ Treasury không tự
     bỏ phiếu/tính ngưỡng (Model A, cite T1 / Gov D3).
   - §4.1 viết lại thành "cổng đọc cờ Executed": Treasury kiểm đúng **bốn điều cờ** (`status ==
     Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`), KHÔNG đọc số phiếu,
     KHÔNG so ngưỡng, KHÔNG tính VP. Khớp CONTRACT §9 T1 + Gov §5 D3.
   - §4.2: ngưỡng (gồm clamp BFT 1/21) do **Governance** ép TRƯỚC; bảng ngưỡng chỉ minh họa bối
     cảnh, Treasury KHÔNG cài đặt. Cite VotingPower CONTRACT §5 D1/D3.
   - §4.3 + US-2 §7.4: council ký **sau khi** Governance đặt cờ `Executed` (không phải "sau khi
     pass đủ ngưỡng"); US-2 nêu rõ validator Treasury không đếm phiếu, chỉ kiểm cờ + `spend_spec_hash`.
   - §0.1 mục 3 + §0.2: đồng bộ ngôn ngữ "Executed → thi hành (T1)".
2. **[T2 — Collect đơn-bucket mặc định]** Khẳng định collect dồn `cut` vào **đúng một** bucket =
   `category`; `split_table` (đa-bucket) chỉ là tùy chọn:
   - §2.1 bước 3: ghi rõ ĐƠN-BUCKET `cut → category` là đường mặc định (cite T2); đa-bucket qua
     `split_table` là tùy chọn instance.
   - §5.1: tách `split_table` thành tham số **tùy chọn**, không bật mặc định; khi vắng → đơn-bucket.
   - §8 (bảng tham số mở): dòng phân bổ cut đánh dấu **TÙY CHỌN**, mặc định đơn-bucket (T2).
