# Distribution — CONTRACT v3 "Capped Drop" (tất định, THAY Drop Lottery)

**Trạng thái:** khung v2 duyệt 2026-06-05. **v3 duyệt 2026-09-22** — xem §0 vì sao bump.
Đây là **interface contract**. Mọi spec/code phải bám file này. Bỏ random/merkle/committee-chọn-winner.

> Lý do thay Lottery: nó mang 2 lỗ hổng (proof hết hạn → mất quyền redeem; committee nonce grinding).
> Capped Drop tất định, O(1), giữ nguyên entitlement, và biến "drop" thành van điều khiển DAO.

## 0. Vì sao bump v2 → v3

v2 tính `vested` bằng **`tốc_độ(bây_giờ) × số_cửa_sổ_đã_trôi`**, đọc `D` sống từ beacon. Hình dạng
đó có một tính chất không ai định: **mọi thừa số GIẢM ĐƯỢC đều hạ `vested` HỒI TỐ trên toàn bộ lịch
sử**, xuống dưới `redeemed` đã lưu, và `expect amount > 0` khoá tài khoản lại.

Đó không phải rủi ro lý thuyết — nó **đang sống trong mã**: `beacon.ak` ép trần đổi `D` bằng
`abs_diff`, một hàm **đối xứng**, nên `D` giảm được 10% mỗi lượt post. Một lượt post `−10%` chặn
ngay mọi tài khoản đã chạy ≥ 9 cửa sổ (điều kiện: `0,9(t+1) > t` ⟺ `t < 9`). Không bất biến nào
trong mã vỡ và không bài kiểm nào đỏ — `redeemed ≤ vested ≤ E` vẫn đúng suốt.

v3 sửa ở **hình dạng**, không vá triệu chứng:

| v2 | v3 |
|---|---|
| `vested = rate(now) × elapsed` | `vested` suy từ một **chỉ số cộng dồn** `A`, mỗi đoạn định giá bằng tốc độ SỐNG TẠI ĐOẠN ĐÓ |
| tốc độ tuyệt đối `D × dpe` | tốc độ **lõm theo cỡ** `dpe · √(W·E)` — pot to mở khoá chậm hơn theo tỉ lệ |
| không có trần theo lưu hành | **cắt ngọn** mỗi lượt redeem theo `total_redeemed` |
| `D` đổi hai chiều | `w` (gốc tốc độ) chỉ được NỚI; muốn siết thì siết ở kênh cắt ngọn |

Ba việc kèm theo, cùng lượt đúc vì cùng là mã validator: sổ tên NFT đã đúc (§4d), bảng quyền
committee (§9), và `total_redeemed` trong `TreasuryDatum` (§2b).

## 1. Mô hình

- Mỗi account = 1 **ClaimAccount UTxO** với **entitlement `E`** (tổng LAMP được phân bổ).
- Beacon giữ một **chỉ số cộng dồn** `A` — xem §3. Nó tăng đơn điệu, **không bao giờ giảm**, và
  nó là thứ duy nhất mang thông tin thời gian vào phép tính `vested`.
- Tốc độ mở khoá **lõm theo cỡ pot**: một cửa sổ mở tối đa `dpe · √(W·E)`, với `W` là hằng thang
  (đơn vị oildrop) và `dpe = drops_per_epoch`.

```
A_span  = A(bây giờ) − a0                       (a0 = chỉ số lúc mở tài khoản)
vested  = min( E , dpe · √E · A_span )
redeemable = vested − redeemed
```

- **Vì sao lõm.** Trần tuyệt đối cho `S(n) = n`: tách một pot thành `n` phần thì tổng tốc độ nhân
  `n` — trần tự huỷ. Luật căn cho `S(n) = √n`. Luật tuyến tính cho `S ≡ 1` nhưng nó xoá luôn mọi
  khác biệt theo cỡ. Luật căn là chỗ duy nhất vừa kháng tách vừa còn phân biệt cỡ.
- **`W` và `p` không phải lựa chọn tự do — chúng bị chính hai mốc hiệu chỉnh ép ra.** ETD-max
  (2.379.930 LAMP) xong trong 20 cửa sổ và pot 6 tỷ xong trong 1000 cửa sổ cho
  `p = ln 50 / ln 2521,08 = 0,4995` — lệch luật căn **0,42%** — và
  `W ≈ E_max / release_epochs² = 6×10⁹ / 10⁶ ≈ 6.000 LAMP`.
- **`rate_root` là NGUYÊN THUỶ, `W` là SUY RA — không được làm ngược.** Cái nằm trong datum là
  `w`, và `W := w²`. Chốt `W = 6.000 LAMP` rồi lấy `w = ⌊√W⌋ = 77.459` làm `n* = ⌈√E/w⌉` **trượt
  lên một cửa sổ**: pot 6 tỷ xong ở cửa sổ **1001** thay vì 1000. **Chốt `w = 77.460`** ⟹
  `W = w² = 6.000.051.600 oildrop = 6.000,0516 LAMP`, và cả hai mốc rơi đúng: pot 6 tỷ ở cửa sổ
  **1000**, ETD-max ở cửa sổ **20**. Chiều đúng không tốn gì, nên không có lý do chọn chiều kia.
  [`Math-Spec.md`](./Math-Spec.md) §7 (M-ROOT-CEIL).
  > ⚠ **Không được đọc chỗ này thành "tài khoản không bao giờ rút hết được".** `A_span` tăng
  > tuyến tính không chặn nên vế phải phép kẹp cũng tăng không chặn — không có tiệm cận và không
  > có đuôi bụi vĩnh viễn. Giá của chiều sai là **một cửa sổ**, không phải một khoản khoá vốn.
- **Hiện thực bằng SỐ NGUYÊN, không `sqrt`.** Validator không tính `vested`; nó **kẹp** con số
  người dùng xin:

```
(redeemed + amount)²  ≤  dpe² · E · A_span²        và        redeemed + amount ≤ E
```

  Ba phép nhân, ~118 bit. Plutus dùng số nguyên độ chính xác tuỳ ý nên không có trần bit.
- **Permissionless:** account tự dựng tx khi redeem, không cần proof/committee chọn.
- **Entitlement bảo toàn:** bỏ lỡ cửa sổ KHÔNG mất quyền — `A` cộng dồn, và không có nhánh nào
  làm `A` giảm.

### 1b. `drops_per_epoch ≡ 1` — GHIM CỨNG, và vì sao nó không mất gì

v2 để `dpe` tự do trong `[1, drops_per_epoch_max = 100]`, committee đặt lúc mở tài khoản, bất
biến sau đó. Với luật tốc độ mới, tự do đó là một **cửa sau xuyên thủng chính trần lõm**:
`dpe` nhân thẳng vào tốc độ, nên committee cấp cho mình `dpe = 100` trong khi cộng đồng ở giá
trị vận hành `21` cho tỉ lệ **4,76×** — và tỉ lệ ấy **không đổi dù siết `trim_num` bao nhiêu**,
vì nó nằm ở kênh tốc độ chứ không ở kênh cắt ngọn.

```
C-ACC-DPE:  drops_per_epoch == 1     (ép ở treasury.ak nhánh CREATE)
```

**Ghim nó KHÔNG phải một phép đánh đổi, vì phép hiệu chỉnh đã giả định `dpe = 1` từ đầu.** Kiểm
lại bằng chính hai mốc hiệu chỉnh, với `w = 77.460`:

| pot | `w · ⌊√E⌋` mỗi cửa sổ | số cửa sổ để chạm `E` | mốc hiệu chỉnh |
|---|---|---|---|
| ETD-max 2.379.930 LAMP | 119.497,70 | `⌈19,916⌉` | **20** ✓ |
| pot sáng lập 6×10⁹ LAMP | 6.000.025,73 | `⌈999,996⌉` | **1.000** ✓ |

Cả hai khớp **tại `dpe = 1`**. Nghĩa là `W` đã hấp thụ trọn vai trò của `dpe`; để `dpe` tự do
bên cạnh `W` là cấp hai núm cho cùng một đại lượng, và núm thứ hai thì per-account và tuỳ nghi.

**Trường `drops_per_epoch` GIỮ trong datum** (bỏ nó là đổi số trường lần nữa, và một cửa sau bị
khoá bằng `expect` thì rõ hơn một cửa sau bị xoá). Muốn mở lại ở v4 thì phải kèm một **cơ sở đo
được trên chuỗi** để phân biệt tài khoản — hôm nay không có cơ sở nào như thế.

## 2. Datum `ClaimAccount` (thay field lottery)

```
ClaimAccount {
  owner            : ByteArray,   // PKH chủ ví
  entitlement      : Int,         // E — tổng LAMP được phân bổ
  redeemed         : Int,         // đã nhận tích lũy
  start_epoch      : Int,         // t0 — GIỮ, chỉ còn dùng cho nhãn/kiểm toán
  drops_per_epoch  : Int,         // GHIM == 1 ở v3 (C-ACC-DPE, §1b). Giữ trường, khoá giá trị
  index_at_start   : Int,         // a0 — chỉ số beacon A CHỤP LÚC MỞ (trường MỚI, ĐẶT Ở CUỐI)
}
```
**BỎ:** `won_cumulative`, merkle proof, mọi field lottery.

- `index_at_start` **thêm ở CUỐI** để không dịch chỉ số Constr của năm trường cũ. Nhưng đừng đọc
  điều đó thành "tương thích ngược": Aiken giải mã nghiêm ngặt **số trường** ở cả hai chiều, nên
  đây vẫn là một lần đổi hình dạng datum ⟹ mọi UTxO tài khoản đang sống phải di trú ⟹ **đòi một
  genesis mới**, và cụm này **không có redeemer nâng cấp**. Đó là lý do trường này phải vào ĐÚNG
  lượt đúc sắp tới hoặc không bao giờ.
- `start_epoch` KHÔNG còn tham gia phép tính `vested`. Giữ lại vì `treasury.ak` và các bài kiểm
  đang neo nó, và vì nó là dữ kiện kiểm toán rẻ. **Cấm** dùng nó thay `index_at_start`.

> ⛔ **Dạng hiện thực bị LOẠI TƯỜNG MINH.** Không được hiện thực "cộng dồn" bằng
> `accrued += rate(now) × (now − last_epoch)`. Đó **không** phải tổng tích luỹ — nó là
> `rate(now) × elapsed` với **gốc do người rút CHỌN**, và nó **tệ hơn v2**: v2 ghim gốc ở
> `start_epoch` (`claim_account.ak:115` ép `start' == get_epoch_strict`), còn dạng này cho phép
> chờ đúng cửa sổ tốc độ chạm đỉnh rồi mới chốt, và định giá TOÀN BỘ quãng chờ bằng đỉnh đó.
> Người rút đều đặn nhận trung bình; người canh đỉnh nhận tối đa. Đây là dạng rẻ nhất để viết,
> nên nó là dạng sẽ được viết nếu spec không cấm thẳng.

### 2b. Datum `Treasury` + sổ cái solvency

```
Treasury {
  committee_hash          : ByteArray,  // bảo toàn (C-TRE-2)
  outstanding_entitlement : Int,        // SỔ CÁI solvency: SỐ CÒN NỢ = Σ(E − redeemed) (oildrop)
  total_redeemed          : Int,        // ĐÃ PHÁT RA tích luỹ, CHỈ TĂNG (trường MỚI, ở CUỐI)
}
```

- **`total_redeemed` là trường mới và nó KHÔNG suy ra được từ trường cũ.**
  `outstanding_entitlement` là số **CÒN NỢ**: nó **giảm** mỗi lần ai đó rút.
  `total_redeemed` là số **ĐÃ PHÁT**: nó **tăng** mỗi lần ai đó rút. Hai đại lượng đi ngược chiều
  nhau, không cái nào suy ra cái kia — vì `E` được cấp dần chứ không cố định từ đầu.
- Nó đo được **chính xác tuyệt đối**, không cần quét chuỗi, vì cả 18 pot dùng CHUNG một kho: mọi
  `Redeem` đều co-spend đúng cái UTxO mang NFT "TRSY" (`claim_account.ak` ▸ `find_treasury_in` ép
  `expect [i]`). Đây là thứ làm §4 ▸ phép cắt ngọn rẻ bằng một phép nhân.
- **Đơn điệu tăng là một BẤT BIẾN PHẢI VIẾT RA**, không phải một hệ quả tình cờ. Ngày nào ai đó
  đổi mẫu số sang "lưu hành trừ tồn kho Treasury" thì nó thành **giảm được**, và toàn bộ lớp lỗi
  hồi tố ở §0 sống lại ở một chỗ mới. `Refill` cộng `total_redeemed` của các input y như cộng sổ
  nợ; `GrantEntitlement` giữ nguyên.
- Treasury UTxO mang **NFT authenticity "TRSY"** (policy `treasury_nft`, one-shot, supply = 1
  TUYỆT ĐỐI) → singleton toàn cục, chống treasury giả cùng script-hash.
- `outstanding_entitlement` = **số còn nợ người dùng**: `+granted` khi GrantEntitlement,
  `−released` khi ReleaseForRedeem — hai vế đi cặp với pool.
  > ⚠ **Sửa 2026-08-12.** Bản đầu định nghĩa trường này là *tổng cấp suốt vòng đời* (chỉ tăng,
  > bất biến khi redeem) và vẫn so với pool **hiện tại**. Vì pool giảm mỗi lần redeem mà sổ cái
  > thì không, `≤ pool` siết dần đến **bế tắc**: quỹ đã trả hết nợ, còn nguyên tiền, vẫn không cấp
  > thêm được — và lần cấp cuối của cả đợt phân phối đòi pool ≥ tổng lịch sử, điều không thể với
  > cung cố định. Tính an toàn muốn có (`Σ(E − redeemed) ≤ pool`) chỉ cần sổ cái theo dõi CÒN NỢ.

## 3. Beacon — chỉ số cộng dồn `A`

- **BỎ** Randomness beacon + MerkleRoot beacon. **GIỮ 1 beacon tham số**, nhưng đổi nội dung:

```
BeaconDatum {
  epoch            : Int,        // cửa sổ lượt post này (C-BCN-3: == cửa sổ tx chạy trong đó)
  kind             : DropParam,
  index            : Int,        // A tại mốc `epoch` — CỘNG DỒN, CHỈ TĂNG
  rate_root        : Int,        // w — NGUYÊN THUỶ (W := w², không phải ngược lại — §1)
  trim_num         : Int,        // κ tử  ┐ tham số CẮT NGỌN, xem §4 mục 4
  trim_den         : Int,        // κ mẫu ┘ mặc định 1 / 1000
  speed_policies   : List<ByteArray>,  // MÓC MỞ RỘNG — RỖNG ở lượt đúc này, xem §5
}
```

### 3a. Luật cộng dồn — vì sao nó KHÔNG tạo phụ thuộc liveness

Giá trị đọc được của `A` tại một thời điểm bất kỳ **không đòi ai post gì cả**:

```
A(bây giờ) = datum.index + datum.rate_root · (cửa_sổ_hiện_tại − datum.epoch)
```

Giữa hai lượt post, chỉ số tự chạy tiếp ở `rate_root` **đã post lần cuối**. Committee im lặng
⟹ vesting **chạy tiếp**, y như v2. Đây là một lựa chọn có chủ đích, và nó là chỗ dễ làm hỏng
nhất: một thiết kế bắt committee post MỖI cửa sổ để `A` tiến sẽ biến sự **im lặng** — không tx,
không chữ ký, không sàn, không ai quy trách nhiệm được — thành một nút đóng băng toàn hệ **mạnh
hơn** chính cái lỗ v3 sinh ra để vá. Và vì C-BCN-3 ép nhãn `epoch` bằng cửa sổ hiện tại, cửa sổ
đã trôi qua **không back-fill được**, nên thiệt hại sẽ là vĩnh viễn.

Một lượt post mới ép:

```
C-BCN-6:  index_out == index_in + rate_root_in · (epoch_out − epoch_in)
```

Đọc câu này cho đúng: **quá khứ được định giá bằng `rate_root` CŨ**; `rate_root_out` chỉ có hiệu
lực từ `epoch_out` trở đi. Đó chính là `Σᵢ rateᵢ` với mỗi `rateᵢ` chốt tại cửa sổ `i`, viết dưới
dạng đóng — không cần lưu một vector, không cần một giao dịch mỗi cửa sổ mỗi tài khoản.

> **Cấm lưu `A` dạng vector** `[rate₀, rate₁, …]`. Nó là cách đọc đen của chữ "chốt tại từng cửa
> sổ", nó phình tuyến tính theo tuổi tài khoản, và một tài khoản 1000 cửa sổ sẽ **chết** khi datum
> vượt giới hạn kích thước tx.

### 3b. `rate_root` chỉ được NỚI

```
C-BCN-5':  rate_root_out ≥ rate_root_in            (THAY trần ±10% đối xứng của v2)
           rate_root_out ≤ rate_root_in · (1 + max_delta)     — trần tốc độ NỚI giữ nguyên
           rate_root_out ∈ [rate_root_min, rate_root_max]     — biên cứng giữ nguyên
```

v2 dùng `abs_diff`, **đối xứng**, nên nó chặn TỐC ĐỘ đổi mà không chặn CHIỀU. Chú thích trong
`beacon.ak` khẳng định *"một tài khoản đang vesting dở do đó không gặp vách"* — **câu đó sai**, và
nó sai vì `redeemed` là mốc nước cao đã lưu còn `vested` thì được tính lại. Bỏ chiều giảm là cách
rẻ nhất làm câu chú thích đó thành đúng.

**Committee mất gì khi không siết được `rate_root`?** Không mất quyền điều tiết — nó chuyển sang
kênh **cắt ngọn** ở §4 mục 4, và kênh đó **an toàn theo cấu trúc**: cắt ngọn chỉ **hoãn** một
lượt rút, nó không bao giờ hạ `vested`. Đây là phân biệt trung tâm của v3:

> **Thứ chạm TỐC ĐỘ TÍCH LUỸ thì chỉ được nới. Thứ chạm MỘT LƯỢT RÚT thì siết thoải mái.**
> Cái thứ nhất viết lại quá khứ; cái thứ hai chỉ xếp hàng cho tương lai.

## 4. Redeem (`claim_account.spend`, redeemer `Redeem`)

**Đổi vai ở v3:** người dựng tx **XIN** một `amount`; validator **KẸP** nó. v2 tự tính `amount`
rồi ép bằng, nên mọi trần phải nhét vào công thức tính; v3 chỉ cần chồng thêm bất đẳng thức. Đó
cũng là hình dạng đúng của "cắt ngọn": xin 3 triệu khi trần là 1 triệu thì **nhận 1 triệu, phần
thừa còn nguyên quyền và chờ lượt sau** — không mất, không lỗi.

Validator ÉP:
1. Đọc `BeaconDatum` qua **reference input** (NFT authenticity), `current_epoch` từ validity range.
   `A_now = index + rate_root · (current_epoch − epoch)`; `A_span = A_now − datum.index_at_start`.
   Yêu cầu `A_span ≥ 0`.
2. **C-RDM-VEST (trần tích luỹ, dạng bình phương — không `sqrt`):**
   ```
   (redeemed + amount)² ≤ drops_per_epoch² · entitlement · A_span²
   redeemed + amount    ≤ entitlement
   amount > 0
   ```
3. Out datum: `redeemed' = redeemed + amount`, mọi field khác **bất biến** — `owner`,
   `entitlement`, `start_epoch`, `drops_per_epoch`, **và `index_at_start`**. `index_at_start` bị
   ghi đè được thì người rút tự đặt lại gốc thời gian của mình; nó phải nằm trong danh sách ép
   bất biến, không phải được suy ra là bất biến.
4. **C-RDM-TRIM (cắt ngọn theo lưu hành):**
   ```
   amount ≤ max( trim_floor , total_redeemed · trim_num / trim_den )
   ```
   - `total_redeemed` đọc từ `TreasuryDatum` của chính UTxO kho đang bị co-spend — **không tốn
     thêm carrier nào**, vì §4 mục 6 đã bắt buộc co-spend nó rồi.
   - `trim_num/trim_den` mặc định `1/1000`: lưu hành 1 tỷ ⟹ một lượt rút tối đa 1 triệu.
   - **`trim_floor` là BẮT BUỘC, không phải tuỳ chọn.** Không có nó, `total_redeemed = 0` là một
     **điểm hấp thụ**: trần bằng 0 ⟹ không ai rút được ⟹ `total_redeemed` mãi bằng 0. Hệ không
     bao giờ khởi động được. Giá trị: `trim_floor = 1.000 LAMP = 1.000.000.000 oildrop`, suy từ
     yêu cầu "ví 1.000 LAMP xong trong một cửa sổ".
   - **`trim_floor` là HẰNG trong `constants.ak`, KHÔNG phải trường datum** — khác `trim_num` và
     `trim_den` ngay bên cạnh nó, nên chỗ này phải nói rõ thay vì để người đọc suy.

     ```
     C-RDM-TRIM-FLOOR:  trim_floor := constants.trim_floor   (hằng, không đọc từ datum nào)
     ```

     Lý do là **hướng hỏng**, không phải sự gọn gàng. Ba tham số cắt ngọn trông cùng một họ nhưng
     `trim_floor` **không** thuộc kênh "siết thoải mái": siết `trim_num` chỉ hoãn một lượt rút,
     còn hạ `trim_floor` về 0 **dựng lại đúng điểm hấp thụ** mà chính nó sinh ra để phá — và hệ
     chết theo kiểu không ai kêu, vì mọi bất biến vẫn đúng và mọi giao dịch chỉ đơn giản bị từ
     chối. Một tham số mà **một đầu của miền giá trị là một cái bẫy** thì đừng đưa vào datum rồi
     canh bằng một biên dưới; để nó nằm trong script hash là cách duy nhất khiến việc đổi nó phải
     đi qua một lượt đúc lại, tức phải qua đúng mức soát mà nó đáng.
   - Giá phải trả, ghi ra để không ai phát hiện muộn: đổi `trim_floor` **đòi script hash mới**.
     Chấp nhận được vì nó là **sàn an toàn**, không phải **núm điều tiết** — điều tiết đã có
     `trim_num/trim_den` trong datum, và hai thứ đó đủ để siết theo mọi mức thị trường đòi.
   - **Phạm vi: PER-ACCOUNT, per-lượt-redeem.** KHÔNG chọn "ngân sách toàn cục mỗi cửa sổ":
     ngân sách chung biến mỗi cửa sổ thành **cuộc đua đến trước**, và cá voi viết bot thì thắng
     mọi cửa sổ trong khi ví nhỏ quên rút bị bỏ đói — tức cơ chế dựng ra để bảo vệ ví nhỏ lại
     chuyển suất của họ cho người có bot. Điểm yếu của per-account (mở N tài khoản thì được N‰)
     là lỗ của §4d, và phải vá ở §4d, không vá bằng cách bẻ hình dạng trần này.
   - **Cắt ngọn KHÔNG hạ `vested`.** Nó chỉ chặn một lượt. Nhờ thế `trim_num` là tham số **siết
     được hai chiều** mà không rơi vào lớp lỗi hồi tố ở §0 — khác hẳn `rate_root`.
5. Treasury nhả đúng `amount` LAMP cho `owner`; **bảo toàn value** treasury (tái dùng treasury.ak,
   `treasury_out.value = treasury_in.value − amount`), **không burn**.
6. **C-RDM-TOTAL:** `total_redeemed_out == total_redeemed_in + amount`. Đi CẶP với
   `outstanding_entitlement_out == outstanding_entitlement_in − amount` (C-SOLV-3). Hai vế cùng
   một `amount`, hai chiều ngược nhau — thiếu một vế là mẫu số của phép cắt ngọn trôi khỏi sự thật
   mà không dòng nào kêu.
7. Chống double-satisfaction: đếm theo **payment script hash** (bài học C1/C2/M1).
8. **TRSY binding (C-SOLV-4/5):** treasury co-spend PHẢI là treasury canonical mang đúng 1 NFT
   "TRSY", **ngụ tại một script** (không phải ví) và **ra đúng địa chỉ đã vào** (C-SOLV-5);
   sổ cái `outstanding_entitlement` **giảm đúng `amount`** khi redeem (C-SOLV-3). Đối xứng với
   Claim path — chống redeem rút từ treasury giả.
9. (Tùy chọn anti-spam) ép `current_epoch > last_redeem_epoch` — chỉ thêm nếu cần; trần tích luỹ
   ở mục 2 đã chặn tổng.

> **Nút cổ chai phải khai, vì nó KHÔNG phải lỗi mới của v3 nhưng v3 làm nó quan trọng hơn.**
> `find_treasury_in` ép `expect [i]` — đúng MỘT UTxO kho trong inputs — và kho là singleton toàn
> cục. ⟹ **toàn hệ tối đa MỘT `Redeem` mỗi block.** Ai muốn bóp nghẹt đường rút chỉ cần chen một
> `Redeem` nhỏ của chính mình mỗi block; chi phí là phí mạng. Đây là cái giá của việc có một sổ
> cái solvency ép được per-tx, và v3 nhận nó có ý thức. Nhưng phép cắt ngọn ở mục 4 làm số lượt
> rút cần thiết TĂNG (một pot to phải rút nhiều lượt nhỏ thay vì một lượt to), nên áp lực lên nút
> này tăng theo. **Chưa đo**: bao nhiêu lượt `Redeem` mỗi cửa sổ ở tải dự kiến, và khi nào nó
> chạm trần một-lượt-mỗi-block.

## 4b. Grant entitlement + bất biến SOLVENCY (`treasury.spend`, redeemer `GrantEntitlement`)

**Claim là REBASE, không phải cộng thêm** — và v3 phải nói rõ vì nó có thêm một trường phải theo.
Nhánh `Claim` hiện ép `redeemed_out == 0`, `start_epoch_out ==` cửa sổ hiện tại, và
`entitlement_out == entitlement_in − redeemed_in + amount` (`claim_account.ak` ▸ nhánh `Claim`).

```
C-CLAIM-8:  out_datum.index_at_start == A(cửa_sổ_hiện_tại)      ← BẮT BUỘC ở v3
            ép ở `treasury.ak` ▸ GrantEntitlement, CẢ HAI nhánh CREATE và UPDATE
```

**Chỗ ép là `treasury`, không phải `claim_account` — và vị trí đó là một ràng buộc, không phải một
lựa chọn.** Đường CREATE (mở tài khoản mới) **không có input tài khoản**, nên `claim_account.spend`
KHÔNG chạy; nhánh `GrantEntitlement` là nơi duy nhất có thẩm quyền đặt mốc chỉ số lúc mở. Đặt mệnh
đề này ở `claim_account` thì nó bỏ trống đúng nhánh nguy hiểm nhất. Cùng lý lẽ đã dùng cho `C-ACC-2`
(`start_epoch`) ngày 2026-09-16.

Hai đường không tách rời nhau được: `Claim` bắt buộc co-spend kho (C-SOLV-1), và kho chỉ còn đúng
nhánh `GrantEntitlement` chạy được trong một tx như vậy — `Refill` bị `C-REF-ACC` chặn khi tx chạm
tài khoản, `ReleaseForRedeem` đòi `redeemed` TĂNG trong khi `Claim` ép nó về 0.

> **Bản trước của mục này viết sai chỗ ép** (ghi là `claim_account` ▸ `Claim`), và cái sai đó không
> vô hại: một hiện thực đọc theo nó sẽ để nhánh CREATE hoàn toàn không gác. Đo được 2026-09-22 —
> ba ca kiểm âm tính ở CREATE (`index_at_start` lệch ±1, và bằng `index` trần tức quên số hạng
> `rate_root·(cửa_sổ − epoch)`) **xanh cả ba** trước khi vá.

**Không có mệnh đề này thì v3 dựng lại đúng lỗ mà bản vá `start_epoch` đã bịt, qua một cửa khác.**
Một tài khoản già có `index_at_start` nhỏ, nên `A_span` của nó đã rất lớn; cấp thêm một lô mới mà
giữ nguyên mốc ấy thì lô mới **vest gần như tức thì** — `vested = √E' · A_span` với `A_span` mang
tuổi của lô cũ. Rebase `start_epoch` không cứu được, vì ở v3 `start_epoch` **không còn đi vào phép
tính vested**; thứ đi vào phép tính là `index_at_start`.

Đây là ca mẫu của một lớp lỗi phải canh mỗi lần thêm trường: **một bản vá cũ chỉ bịt đúng cái cửa
nó nhìn thấy.** Thêm một trường mang ngữ nghĩa thời gian thì phải soát lại MỌI nhánh từng rebase
thời gian, không chỉ nhánh vừa sửa.

Các ràng buộc solvency:
1. `granted = amount` (tham số của redeemer `Claim`), yêu cầu `granted > 0`.
   **SỬA so với bản v2 của mục này**, vốn định nghĩa `granted = entitlement_out − entitlement_in`.
   Định nghĩa đó **sai kể từ khi `Claim` thành rebase**: nó cho `amount − redeemed`, lệch đúng
   `redeemed` mỗi lần cấp thêm cho một tài khoản đã rút. Đại số sổ cái quyết định bên nào đúng —
   `outstanding = Σ(E − redeemed)`, sau rebase là `(E − redeemed + amount) − 0`, nên hiệu đúng
   bằng `amount`. Mã đã cộng `amount`; chỗ sai là câu chữ, không phải mã.
2. **C-SOLV-1:** `outstanding_entitlement_out = outstanding_entitlement_in + granted` (sổ cái dồn đúng).
3. **C-SOLV-2 (SOLVENCY):** `outstanding_entitlement_out ≤ treasury pool LAMP` → committee KHÔNG cấp
   E vượt số dư quỹ → redeem không bao giờ kẹt vì cạn pool.
4. **C-VAL-0:** pool LAMP + mọi asset BẤT BIẾN khi grant (chỉ datum đổi).
4-bis. **C-ACC-1 + C-ACC-1b (đường CREATE):** tx phải ĐÚC NFT tài khoản tên `blake2b_256(owner)`
   dưới `account_nft_policy` (**C-ACC-1**, đo trên `tx.mint`), **và** NFT đó phải NẰM TRONG chính
   output tài khoản vừa mở (**C-ACC-1b**, đo trên `ca_out.value` — thêm 2026-09-26).
   Hai mệnh đề, hai đại lượng khác nhau: cái thứ nhất nói NFT **tồn tại**, cái thứ hai nói nó
   **hạ cánh đúng chỗ**. `claim_account_nft.ak` ▸ A-ACC-3 cố ý chỉ ép "một Script bất kỳ" (vòng
   tham số giữa policy và hash `claim_account`), và lời biện hộ ghi ở đó — *"đúc vào script khác
   thì tự khoá tiền của kẻ dựng tx"* — đúng với ví người dựng và **sai với kho**: giao dịch ấy
   vẫn cộng `granted` vào sổ nợ ở C-SOLV-1. Tài khoản ra đời không NFT thì `claim_account.spend`
   từ chối nó vĩnh viễn ⇒ nợ vào sổ **không có đường lùi** (sổ chỉ giảm qua `ReleaseForRedeem`,
   vốn cần một tài khoản tiêu được) ⇒ C-SOLV-2 siết dần trần cấp phát cho mọi pot về sau.
   Ép được ở `treasury` vì nó đã nhận `claim_account_hash` làm tham số — đây là chỗ DUY NHẤT
   trong hệ biết cả tên NFT phải đúc lẫn địa chỉ tài khoản.
5. Treasury là singleton per-tx theo script hash + NFT "TRSY" toàn cục → sổ cái serial-hoá MỌI
   Claim/Redeem → sổ cái **BẰNG** `Σ(E − redeemed)`, nên `Σ(E − redeemed) ≤ pool` ép được PER-TX.
6. `claim_account.spend` (Claim) ràng buộc `nợ_out = nợ_in + amount` để khoá amount nhất quán giữa
   account và sổ cái; treasury validator độc lập ép C-SOLV-2 + C-VAL-0.
7. **C-SOLV-5 (nơi trú của TRSY):** ràng ĐÚNG hash treasury trong `claim_account` là bất khả thi vì
   vòng tham số (`treasury`→`claim_account_hash`→`treasury_nft_policy`→`treasury_hash`). Thay bằng
   hai tầng không cần vòng: (a) `treasury_nft` ép NFT genesis hạ cánh ở **một Script** mang
   `TreasuryDatum` với nợ mở `= 0`; (b) `claim_account` ép carrier ngụ tại Script và **không đổi
   nhà** trong tx. Trước bản vá hai hàm tra cứu lọc THUẦN theo NFT — TRSY nằm ở ví thì sổ cái do
   người dựng tx tự viết và `treasury.ak` không bao giờ chạy.

## 4c. Refill (gộp kho, `treasury.spend` redeemer `Refill`) — danh mục trạng thái

Refill gộp N UTxO ở địa chỉ kho về một singleton. **Sổ cái đi ra lấy từ ĐÚNG MỘT input: carrier**,
tức UTxO mang NFT kho "TRSY" (`treasury.ak` ▸ `fn carrier_ledger`). Datum của mọi input khác bị
BỎ QUA hoàn toàn — value của chúng vẫn được hút vào pool (đó là việc Refill sinh ra để làm), sổ
của chúng thì không đi vào một mệnh đề nào.

```
C-REF-PROV:  đúng MỘT input ở địa chỉ kho mang tài sản tên "TRSY" (= carrier);
             out_datum.{committee_hash, outstanding_entitlement, total_redeemed}
               == của carrier;
             input khác → datum BỎ QUA, KHÔNG fail.
C-REF-TOTAL: out_datum.total_redeemed == carrier.total_redeemed  (hệ quả của C-REF-PROV)
C-REF-SIGN:  carrier.outstanding_entitlement ≥ 0 và carrier.total_redeemed ≥ 0
             (nay là lớp phòng thủ theo chiều sâu, không còn là lớp duy nhất)
```

> **Sửa 2026-09-26 — vì sao bỏ phép TỔNG.** Bản trước cộng sổ của MỌI input có inline datum, và
> tự biện hộ nguyên văn rằng *"chặn chặt hơn sẽ giết cả lượt gộp hai kho hợp lệ"*. Câu đó sai vì
> một dữ kiện nằm ở tệp khác: `treasury_nft` là policy **one-shot**, nên **không bao giờ tồn tại
> hai kho hợp lệ** để mà gộp. Địa chỉ kho chỉ là một hash công khai và Cardano không chạy
> validator lúc TẠO output, nên mọi input ngoài carrier hoặc là LAMP rót về qua A-DEST (không
> datum), hoặc là một UTxO người lạ tự đỗ với datum tự viết. Phép TỔNG vì thế không gộp hai sự
> thật — nó cộng một sự thật với một lời khai. Hai đường hại đo được, cả hai một chiều:
> `total_redeemed` khống (10²⁴) giết vĩnh viễn phép cắt ngọn của §4 (trường CHỈ TĂNG, không nhánh
> nào kéo về); `outstanding_entitlement` khống phình sổ nợ và khoá C-SOLV-2 cho mọi pot. Cả hai
> đi qua `C-REF-SIGN` vì số khống là số **dương**.

> **Giới hạn còn lại, nói thẳng.** `treasury` không nhận `treasury_nft_policy` làm tham số (đổi
> arity = đổi đường apply-param của off-chain), nên phép nhận diện carrier đi theo **TÊN** tài
> sản, không theo policy id. Đúc một tài sản trùng tên dưới policy khác rồi đỗ ở địa chỉ kho làm
> tập carrier có 2 phần tử ⇒ lượt gộp đó bị từ chối. Đó là **quấy rối**, không phải đường chiếm
> sổ (committee chọn input, và một Refill không có carrier thật sinh ra vật trơ mà
> `claim_account` không bao giờ đọc). Khoá nốt khe này cần thêm tham số — một lượt deploy có
> phối hợp với off-chain.

| mã định danh | treo cái gì | ràng buộc TẠM đang có hiệu lực (fail-closed) | khai ở file nào |
|---|---|---|---|
| ~~RFL-KILL-ONCHAIN-01~~ | **ĐÓNG 2026-09-26.** Đã vá on-chain: `carrier_ledger` ép `≥ 0` trên carrier, và C-REF-PROV làm số hạng của input lạ không còn đi vào sổ ở BẤT KỲ dấu nào | — | `Distribution/onchain/validators/treasury.ak` ▸ `fn carrier_ledger` |
| RFL-BUILDER-SUM-01 | `refillBuilder` off-chain vẫn tính sổ ra bằng TỔNG trên mọi input có datum (`ledgerIn`/`redeemedIn`), tức nó dựng ra giao dịch mà chuỗi nay TỪ CHỐI khi tập input có một UTxO lạ mang datum | Fail-closed: giao dịch hỏng ở khâu nộp, không mất tiền. Ca thường gặp (carrier + UTxO không datum) vẫn đúng vì tổng khi đó bằng sổ carrier | `Distribution/offchain/src/refillBuilder.ts` ▸ `ledgerIn`, `redeemedIn`; bộ ca ở `Distribution/tests/refillBuilder.test.ts` |

## 4d. Sổ tên NFT đã đúc — phạm vi của MỌI trần per-account

Không có mục này thì §1 (trần lõm) và §4 mục 4 (cắt ngọn) **không có phạm vi**, và mọi tranh luận
về hình dạng của chúng là tranh luận về hình dạng của một cái trần rỗng.

Tốc độ tổng khi một chủ tách pot thành `N` tài khoản: `N · min( dpe·√(W·E/N) , trần_cắt_ngọn )`.

| N | pot 6 tỷ rút hết trong |
|---|---|
| 1 | 23,7 năm |
| 36 | **2,3 năm** |
| 100 | **1,4 năm** |

Trần lõm kháng tách theo `√N` — tốt, nhưng không phải vô hạn. Cắt ngọn per-account kháng **0**.

**Trạng thái hôm nay, đã tự kiểm:** `claim_account_nft.ak` ép `committee_approved` (A-ACC-1),
đúng 1 asset name trong MỘT tx (A-ACC-2), và `nft_name == blake2b_256(cad.owner)` (A-ACC-4). Nên
tách **không** permissionless: cần `N` ví khác nhau **và** `N` chữ ký committee. Nhưng mint policy
**không giữ sổ tên đã đúc** và **không có nhánh burn**, nên cùng một tên đúc lại được; và không
mệnh đề nào ràng `N` khoá với `N` NGƯỜI.

> **Nói thẳng giới hạn của bản vá này:** một sổ tên đã đúc đóng được **tách theo KHOÁ**. Nó
> **KHÔNG** đóng được **tách theo NGƯỜI** — `did_commit` không cho sự thật đó (kho MAGIC đã viết
> thẳng rằng nó dùng được cho QUY KẾT chứ không cho hạn mức theo người), và **không có đường
> on-chain nào** cho sự thật đó hôm nay. Với hai pot sáng lập 6 tỷ, bên xin cấp tài khoản cũng
> chính là bên ký duyệt, nên với ĐÚNG ca đáng lo nhất, tách vẫn là tự phục vụ. Cái chặn thật ở ca
> đó là §9, không phải mục này.

Điểm treo liên quan, giữ nguyên: `Governance/VotingPower/CONTRACT.md §3 [IDENT-ONE-PERSON]`.

## 5. Móc mở rộng — `speed_policies` (RỖNG ở lượt đúc này)

Mục tiêu: gắn được một hệ số theo **mức tiêu thụ MAGIC** của chủ tài khoản **sau** khi có số liệu
thật, mà **không** phải đúc một genesis mới. Lượt đúc này chỉ cắm đường đọc, để trống tham số.

**Móc gắn vào KÊNH CẮT NGỌN, không gắn vào kênh tốc độ.** Đây là chỗ cả thiết kế xoay quanh:

```
amount ≤ max( trim_floor , total_redeemed · trim_num · g / trim_den )
```

- `g` suy từ `EngageDatum` của chủ tài khoản, đọc qua reference input, với danh sách policy lấy từ
  `speed_policies` trong `BeaconDatum`.
- `speed_policies = []` ⟹ `g = 1` ⟹ **không reference input nào bị đòi, chi phí bằng 0**, hành vi
  y hệt như không có móc. Đó là trạng thái của lượt đúc này.
- Khi bật: `g ∈ [g_min, 1]` với **`g_min > 0`**. Thiếu reference input, thread không tìm thấy,
  hoặc `consumed = 0` ⟹ `g = g_min`, **KHÔNG** phải `g = 0`.

### 5a. Ràng buộc bắt buộc lên `g_min` — nếu không thì `g` là một CỔNG, không phải HỆ SỐ

Nhóm nhận ETD được chọn bằng **snapshot hồi tố stake tích luỹ**, tức tiêu chí là uỷ thác ADA,
**không** phải tiêu MAGIC. Họ không cần vault MAGIC, không cần PersonDID, và theo mặc định
**chưa từng tiêu một nanogic nào** — tiêu MAGIC đòi mở vault, sinh MAGIC, rồi đốt qua `BurnBatch`,
không việc nào nằm trong điều kiện nhận ETD. Nếu `g` hạ trần cắt ngọn của họ thì **pot được thiết
kế để redeem TRƯỚC, làm phép thử toàn cầu, lại thành pot vest CHẬM NHẤT hệ**.

> **Phép thử phải chạy trên mọi ứng viên công thức, trước khi nó được bật:**
> *"Một tài khoản có `consumed = 0` và sẽ mãi bằng 0 thì vest hết suất trong bao lâu? Nếu câu trả
> lời là 'không bao giờ' hoặc 'lâu hơn đời dự án', số hạng này đang là một CỔNG chứ không phải
> một HỆ SỐ."*

Ràng buộc suy ra, viết dưới dạng bất đẳng thức để đo được chứ không để đọc cho xuôi:

```
g_min · trim_num/trim_den · C_launch  ≥  dpe · rate_root · ⌊√E_test⌋
```

tức **trần cắt ngọn của một tài khoản tiêu 0 phải vẫn NẰM TRÊN tốc độ lõm của nó** — lúc đó `g`
không đổi gì cả với nhóm ấy, và nó chỉ còn là hệ số với đúng nhóm nó nhắm tới: pot đủ to để trần
cắt ngọn mới ráo. Với `E_test` = ETD-max (2.379.930 LAMP ⟹ tốc độ lõm ≈ 119.497/cửa sổ) và
`C_launch` = 1 tỷ LAMP ⟹ `g_min ≥ 0,12`. **Chọn `g_min = 1/8`.** Dưới ngưỡng đó, `g` bắt đầu ăn
vào nhóm ETD, và nó sẽ ăn một cách **im lặng** — không lỗi, không cảnh báo, chỉ là người dùng thật
kêu rằng mở khoá chậm mà không ai truy được vì sao.

### 5c. Đọc MỘT thread là đọc THIẾU, và thiếu theo hướng người dùng điều khiển được

Đúc thread Engage là **permissionless** và tên thread suy từ một seed do chính người đúc chọn
(`ConsumeMAGIC/onchain/validators/consume.ak` ▸ `validate_mint_engage_id`), còn `BindDID` chỉ
nhìn đúng MỘT thread nên không giao dịch nào ở vị trí so được hai thread. ⟹ **một người mở được
N thread cùng một `did_commit`, không giới hạn, và đó là ý định của thiết kế bên đó.**
`consumed_nanogic` do đó là số của **một thread**, không phải của **một người**, và **không có
đường on-chain nào cộng N thread lại** mà không biết trước danh sách N.

Hệ quả phải thiết kế quanh, không phải hệ quả để ghi chú:

- Reference input trỏ vào thread nào là do **người dựng giao dịch chọn** ⟹ họ chọn thread có số
  cao nhất, và họ dồn được mọi hoạt động vào đúng một thread để trỏ vào.
- Vì `g` ở đây là **thưởng** (tiêu nhiều ⟹ trần cao hơn) chứ không phải **cổng**, chiều sai
  **không** nghiêng về phía an toàn. Ai rải thật ra N thread thì thiệt; ai dồn vào một thread thì
  lợi. Đó là một trục để chơi, và nó miễn phí.
- ⟹ **`g` không được là một hàm tăng không chặn của `consumed`.** Nó phải bão hoà: đạt trần `g = 1`
  ở một mức tiêu thụ đặt được, để việc dồn thread chỉ giúp tới đúng mức ấy rồi thôi.

Đây cũng là lý do thứ hai — độc lập với lý do hồi tố ở §5 — khiến móc này **để trống ở lượt đúc
này**: hình dạng bão hoà đòi số liệu tiêu thụ thật, mà số liệu đó chưa tồn tại.

**Nguồn thứ hai, độc lập, neo vào một phép chạy lại được** (không neo vào chú thích, vì chú thích
già đi mà không ai báo): quét `consume.ak` tìm một mệnh đề ép duy-nhất-theo-owner cho thread
engage trả về **rỗng**. Phạm vi của phép đo, nói trước: nó quét **một tệp** và khớp theo **chuỗi
ký tự**, nên nó không loại được một ràng buộc viết dưới tên khác ở tệp khác. Mức phát biểu đúng là
*"không tìm thấy trong `consume.ak`"*, chưa phải *"không tồn tại trong hệ"*.

### 5d. 🔴 Điều kiện CHẶN trước khi bật móc: cam kết DID KHÔNG được xác thực

Đây là ràng buộc nặng nhất của §5 và nó không nằm ở phía này, nên phải chép vào đây thay vì trỏ.

`did_commit` là một hash 32 byte **nằm công khai trên chuỗi**. Không mệnh đề nào ở hai module
nguồn chứng minh cam kết đó **thuộc về** người ký — ai đọc chuỗi cũng **chép được** cam kết của
người khác vào vault hoặc thread của mình, không cần biết tiền ảnh. Cả hai chiều đều mở: bán mức
tiêu của mình, và thổi mức tiêu cho một người không hề yêu cầu. Hai module nguồn ghi cùng một câu,
cố ý cùng câu chữ, và nó kết luận thẳng:

> `did_commit` dùng được cho **QUY KẾT** (ai tự nhận việc tiêu này), **KHÔNG** dùng được cho bất
> cứ thứ gì mà nói dối có lợi — quyền biểu quyết, **phân bổ phần thưởng**, hạn mức theo người,
> chống-Sybil.

**Một hệ số nâng trần rút LÀ phân bổ phần thưởng.** ⟹ Móc §5 không được bật chừng nào chưa có một
**liên kết ĐƯỢC XÁC THỰC** giữa tài khoản phân phối và bản ghi tiêu thụ. Hình dạng rẻ nhất đã được
nêu ở phía nguồn: đọc anchor Service-DID qua `reference_input` rồi đòi chữ ký controller — đổi
validator, tức **đổi script hash**.

**Và không có đường vòng.** Cả hai đường tiêu thụ đều mang cùng giới hạn này: đường prepaid
(`magic_settled`) và đường engage (`consumed_nanogic`) — hai module cố ý viết cùng một câu, vì
*"nếu không bên đọc sẽ tin bên lỏng hơn"*. Chuyển đường không cứu.

> ⚠ **Đừng ghi lý do đóng hướng này thành "đường prepaid không mang DID nên không có gì để nối".**
> Câu đó **SAI** — `SetDidCommit` (`prepaid.ak` ▸ `validate_set_did_commit`) đặt `did_commit` một
> lần, một chiều, từ rỗng sang 32 byte; mệnh đề pin rỗng chỉ gác **cổng đúc**. Nguy hiểm của câu
> sai ấy là nó **già đi ngược chiều với sự thật**: người sau `grep` ra nhánh ghi sẽ tưởng mình vừa
> sửa một chỗ lỗi thời và **mở lại hướng đã đóng**, chỉ bằng một lượt đọc mã. Lý do thật là một
> phát biểu về **tính chất** của trường — nó có, nó điền được, và **giá trị điền vào không ai
> kiểm** — nên không lượt đọc mã nào lật được nó.

**Biên còn lại, vẫn đúng:** hai bộ đếm nằm ở hai module rời nhau, không mệnh đề nào của bên này
đọc trường của bên kia. Nên mọi câu "tiêu thụ MAGIC" trong hợp đồng này, nếu có ngày được dùng,
phải nói rõ **đường nào** — không có đại lượng "tổng tiêu thụ" nào tồn tại on-chain.

**Vì sao danh sách chứ không phải một policy.** `consume` nhận `vault_script_hash` làm apply-param
⟹ mỗi loại vault sinh một script hash khác ⟹ policy thread NFT **chính là** script hash đó ⟹ một
người có thread nằm ở nhiều policy. Trên mạng thử đã có HAI. Kho này đã giải đúng bài toán ấy một
lần rồi: `Governance/onchain/lib/magiclamp/governance/engage.ak` ▸ khối chú thích
`VÌ SAO engage_policies LÀ DANH SÁCH` — và nó đặt danh sách trong **datum tham số**, KHÔNG
apply-param. v3 dùng lại đúng cách đó.

**Vì sao móc ở kênh cắt ngọn mới an toàn.** `g` là đại lượng **giảm được** (thread bị tiêu, mức
tiêu thụ tụt, committee đổi danh sách). Mọi đại lượng giảm được nằm trong kênh **tốc độ tích luỹ**
đều viết lại quá khứ — đúng lớp lỗi §0. Nằm trong kênh **cắt ngọn** thì nó chỉ hoãn một lượt rút.
Cùng một tham số, hai chỗ cắm, một chỗ là bom hẹn giờ và một chỗ thì không.

**Điều lượt đúc này KHÔNG được làm, và phải ghi ra vì nó phản trực giác:** không tạo một UTxO
"van" riêng do committee quản. Một carrier thứ ba nâng số điểm hỏng đơn của mọi `Redeem` từ 2 lên
3, và vì nó không chịu C-BCN-2/C-BCN-3 (một lượt post mỗi cửa sổ) nên nó bị quay lại mỗi block để
vô hiệu hoá mọi `Redeem` đang bay, với chi phí ~0,2 ADA và **không có gì để tố cáo** vì giá trị
trong van không đổi. Tham số đi vào `BeaconDatum` để thừa hưởng sẵn cả bộ phanh của beacon.

### 5b. Hooks DAO khác (post-MVP — CHỪA CHỖ, KHÔNG build lượt này)

- **Multi-drop per-DID: HOÃN VÔ THỜI HẠN, không phải "chưa làm".** v3 ghim `dpe ≡ 1` (§1b). Mở
  lại nó đòi một **cơ sở đo được trên chuỗi** để phân biệt tài khoản nào xứng đáng nhanh hơn —
  và cơ sở duy nhất từng được đề xuất là uy tín/DID, thứ mà `did_commit` **không** cung cấp
  (kho MAGIC đã viết thẳng rằng nó dùng cho QUY KẾT, không cho hạn mức theo người). Không có cơ
  sở thì "DAO chỉnh per-DID" chỉ là committee chỉnh theo ý mình, có thêm một lá phiếu.
- **Pause/penalty:** ĐẶT `drops_per_epoch = 0` là một **hành vi bị CẤM**, và lý do đáng đọc kỹ
  vì nó tinh tế: `dpe` nằm **NGOÀI** tổng tích luỹ (`vested = dpe · √E · A_span`), nên hạ nó
  xuống 0 hạ `vested` **hồi tố** xuống 0 và khoá vĩnh viễn một tài khoản đã rút dở. So sánh với
  `rate_root`, nằm **TRONG** tổng: hạ nó chỉ làm các cửa sổ TƯƠNG LAI đóng góp ít đi.
  **Cùng một phép nhân, hai vị trí, hai hệ quả trái ngược** — đây là phép thử phải chạy trước
  khi thêm bất kỳ thừa số nào (§7). Phạt, nếu cần, đi qua `trim_num`.

## 6. Giữ nguyên (tái dùng, KHÔNG vứt)

- ClaimAccount per-wallet UTxO (QĐ5), `treasury.ak` + 3 fix audit C1/C2/M1, e2e harness `04_e2e.ts`,
  datum codec base, claim flow committee (M-of-N).

## 7. Bất biến (mọi spec/code)

- LAMP **không burn**; treasury bảo toàn value tuyệt đối.
- **`vested` KHÔNG BAO GIỜ GIẢM — bất biến trung tâm của v3.** Suy ra từ ba vế, cả ba phải giữ:
  `A` đơn điệu tăng (§3a, không có nhánh nào làm `index` giảm) · `rate_root` chỉ nới (§3b) ·
  `E` chỉ tăng (`GrantEntitlement` ép `granted > 0`). Phá một vế là dựng lại lỗ §0.
- **Phép thử bắt buộc trước khi thêm BẤT KỲ thừa số nào vào công thức rút:** *"thừa số này giảm
  được không, và nó nằm ở kênh TỐC ĐỘ TÍCH LUỸ hay kênh MỘT LƯỢT RÚT?"* Giảm được + kênh tốc độ
  ⟹ **CẤM**. Giảm được + kênh cắt ngọn ⟹ được. Không trả lời được ⟹ coi như kênh tốc độ.
- Đa-claim: `redeemed` cộng dồn, luôn `vested − redeemed ≥ 0`, tổng nhận ≤ `E`.
- `total_redeemed` **chỉ tăng**, và mẫu số của phép cắt ngọn **không được** đổi sang một đại lượng
  giảm được (vd "lưu hành trừ tồn kho Treasury").
- `rate_root`, `trim_num/trim_den` là **tham số** (committee/DAO), KHÔNG hardcode. `drops_per_epoch`
  thì KHÔNG — v3 ghim nó `== 1` (§1b, `C-ACC-DPE`), và nó giữ trường chỉ để khỏi đổi số trường lần
  nữa. Đừng đọc dòng này thành "cả ba đều chỉnh được": một thừa số đứng NGOÀI tổng `A_span` mà chỉnh
  được là đúng thứ §0 cấm.
- `index_at_start` **bất biến trọn đời tài khoản** — phải nằm trong danh sách ép, không được để
  suy ra.
- **SOLVENCY (C-SOLV-*):** `outstanding_entitlement` ≤ treasury pool LAMP ép on-chain ở MỌI Claim;
  sổ cái BẰNG `Σ(E − redeemed)` (tăng khi grant, giảm khi redeem) → `Σ(E − redeemed) ≤ pool`. Treasury
  authenticity = NFT "TRSY" one-shot (supply 1). `05_verify_solvency.ts` = kiểm tra vận hành
  độc lập (defense-in-depth), KHÔNG còn là chốt duy nhất.

## 8. Spec + build (song song bám CONTRACT)

- **SPEC**: MATH **đã lên v3** — [`Math-Spec.md`](./Math-Spec.md), 9 định lý + bảng 14 bất biến
  (`M-*`) để bộ kiểm bám. FEAT · TECH · EXEC **còn ở v2 và đã tự khai là lệch** bằng một biển ở
  đầu tệp; nâng chúng lên v3 là việc riêng, **chưa làm**.
- **ONCHAIN**: rework `claim_account.ak` (Redeem vested), `DropParam` beacon, **gỡ** `merkle.ak`/randomness;
  Aiken test (vested đơn điệu, cap E, đa-claim, E<D nhận hết, double-satisfaction reject).
- **OFFCHAIN**: gỡ `lottery.ts`/`merkle.ts`, `redeemBuilder` tính vested, datum codec mới; vitest.

### 8b. Bộ kiểm v3 — ca nào PHẢI có

Mỗi ca dưới đây canh một mệnh đề mà nếu gỡ đi thì **không bài kiểm cũ nào đỏ**. Đó là tiêu chuẩn
để một ca được vào danh sách này, không phải "trông có vẻ cần".

| ca | canh cái gì | đầu vào phân biệt hai cực ở đâu |
|---|---|---|
| hạ `rate_root` bị TỪ CHỐI | §3b | post `w' < w`; v2 sẽ cho qua, v3 phải đỏ |
| post cách 5 cửa sổ: `index` cộng đúng `w_cũ × 5` | C-BCN-6 | dùng `w_mới ≠ w_cũ`; nếu mã nhân nhầm `w_mới` thì con số khác hẳn |
| hạ `rate_root` **không** hạ `vested` của tài khoản đã rút 9 cửa sổ | bất biến trung tâm §7 | đúng ca lỗ đang sống — `t = 9` là biên, kiểm cả `t = 8` và `t = 10` |
| committee im lặng 20 cửa sổ: vesting vẫn tiến | §3a fail-open | nếu mã đòi post mỗi cửa sổ thì ca này treo |
| `total_redeemed = 0`: ví 1.000 LAMP vẫn rút được | `trim_floor` §4 mục 4 | bỏ `trim_floor` ⟹ đỏ. Không có ca này thì điểm hấp thụ lọt |
| **cấp thêm cho tài khoản ĐÃ CHẠY: `index_at_start` rebase về `A(bây giờ)`** | `C-CLAIM-8` §4b | mở tài khoản ở cửa sổ 0, chạy tới cửa sổ 500, cấp thêm ⟹ lô mới phải vest theo lịch của CHÍNH NÓ, không vest tức thì. Không có ca này thì lỗ `start_epoch` 2026-09-17 sống lại qua cửa khác |
| `granted == amount`, KHÔNG phải `entitlement_out − entitlement_in` | §4b mục 1 | ca phân biệt: cấp thêm cho tài khoản có `redeemed > 0`. Hai công thức chỉ khác nhau ở đúng ca đó |
| `trim_floor` KHÔNG đọc từ datum nào | `C-RDM-TRIM-FLOOR` | dựng beacon datum mang một trường trông như `trim_floor` với giá trị khác hằng ⟹ kết quả rút phải **không đổi**. Ca này bắt đúng lỗi hiện thực dễ xảy ra nhất: đọc nó từ datum "cho tiện" |
| xin 3 triệu khi trần 1 triệu: **nhận 1 triệu, không lỗi**, phần thừa còn quyền | ngữ nghĩa cắt ngọn | ca dễ viết sai thành "reject" |
| `index_at_start` bị đổi trong out datum ⟹ TỪ CHỐI | §7 | không ép thì ca này xanh |
| `total_redeemed_out ≠ in + amount` ⟹ TỪ CHỐI | C-RDM-TOTAL | kiểm cả chiều thiếu lẫn chiều thừa |
| `speed_policies = []` ⟹ không đòi reference input nào | §5 | đo số reference input, không đo kết quả |
| mở tài khoản với `dpe = 2` ⟹ TỪ CHỐI | `C-ACC-DPE` §1b | v2 cho qua mọi giá trị tới 100; kiểm cả `dpe = 0` và `dpe = 100` |
| tài khoản `consumed = 0`, cỡ ETD-max: vest hết ĐÚNG 20 cửa sổ khi móc BẬT | §5a | đầu vào phân biệt: chạy lại với `g_min = 0,10` (dưới ngưỡng 0,1194977) thì phải LÂU HƠN 20 — nếu hai bên ra cùng số thì ca này không kiểm gì |
| **pot 6 tỷ chạm ĐÚNG `E` ở cửa sổ 1000** (`rate_root = 77.460`) | §1 · M-ROOT-CEIL | Phải chạy tới `n = 1000` thật, cấm ngoại suy: ở `n` nhỏ hai giá trị `w` cho kết quả **giống hệt nhau** (chênh <`1,3×10⁻⁵` ở `n=1`), nên bài ngắn xanh ở cả hai cực và không kiểm gì. Ca đối xứng: `w = 77.459` thì cửa sổ 1000 **chưa** chạm, và **chạm ở 1001** — kiểm cả hai mốc, đừng kiểm "không bao giờ chạm" vì điều đó SAI |

> **Đừng phát biểu "chốt X đã được ghim" chỉ vì có một bài đỏ ở chốt X.** Bài có thể trượt xuống
> chốt kế tiếp và chết ở đó, đúng tên, đúng màu. Phép đo đúng là **gỡ hẳn chốt X rồi chạy trọn bộ
> kiểm**; còn xanh ⟹ không bài nào canh. Chưa chạy phép đó thì mức phát biểu đúng là *"có bài đỏ
> ở chốt X"*.

## 9. Bảng quyền committee — cổng CHÍNH

Bắt buộc với mọi thiết kế chạm mint hoặc quyền đặc quyền. Lý do nó phải nằm ở đây chứ không ở một
tài liệu vận hành: committee giữ **quyền làm chậm tài sản của người khác nhiều thập kỷ**, trong khi
phần thưởng tương lai của chính họ nhỏ hơn hẳn giá trị của quyền đó. Bất đối xứng ấy không xử được
bằng hình phạt — chỉ xử được bằng **phân tán quyền**.

| quyền | ai | ngưỡng | thu hồi được? | hỏng thì sao |
|---|---|---|---|---|
| post beacon (`rate_root`, `trim_*`, `speed_policies`) | committee | M-of-N | — | `rate_root` chỉ nới ⟹ không đóng băng được ai. `trim_num` siết được nhưng chỉ chạm lượt rút tương lai |
| `GrantEntitlement` (mở tài khoản, tăng `E`) | committee | M-of-N | — | cấp `E` khống bị C-SOLV-2 chặn ở `≤ pool` |
| đặt `drops_per_epoch` lúc mở | — | — | — | **ĐÃ ĐÓNG ở v3**: `C-ACC-DPE` ép `dpe == 1` cho mọi tài khoản (§1b). Committee không còn núm per-account nào chạm được kênh tốc độ |
| đặt `trim_floor` | — | — | — | **KHÔNG phải quyền của committee**: hằng trong `constants.ak`, đổi thì phải đúc lại script (`C-RDM-TRIM-FLOOR` §4 mục 4). Trong datum thì hạ về 0 dựng lại đúng điểm hấp thụ nó sinh ra để phá |
| `DistributionVest` (đúc LAMP vào kho) | entry Registry `lamp_tag` | **PHẢI `MultiSig`, CẤM `SinglePkh`** | có (`Revoked`) | `SinglePkh` = một chữ ký đúc được tới `dist_cap`; nếu đúc từng đợt thì nhánh này còn sống suốt vòng đời |

**Dòng `DistributionVest` là điểm treo thật, không phải thủ tục** — nó là điều kiện đi kèm của
quyết định "đúc từng đợt": giữ nhánh mint sống thì entry Registry phải là `MultiSig`.

Sau khi §1b ghim `dpe ≡ 1`, **committee không còn núm per-account nào chạm được kênh tốc độ**.
Mọi quyền còn lại của họ hoặc chỉ-nới (`rate_root`), hoặc chỉ-chạm-lượt-rút-tương-lai
(`trim_num`), hoặc bị chặn bởi một bất biến độc lập (`GrantEntitlement` ↔ C-SOLV-2), hoặc nằm
ngoài tầm với vì đã đóng băng vào script hash (`trim_floor`).

## 10. Phạm vi lượt này — cái gì vá, cái gì cố ý để lại

**Vá trong lượt đúc này** (tất cả đều là mã validator hoặc hình dạng datum, tức không sửa được về
sau vì cụm không có redeemer nâng cấp): §1 trần lõm · **§1b `C-ACC-DPE` ghim `dpe ≡ 1`** ·
§2 `index_at_start` · §2b `total_redeemed` ·
§3 chỉ số cộng dồn + `rate_root` một chiều · §4 cắt ngọn + `trim_floor` · §4d sổ tên NFT ·
§5 móc `speed_policies` rỗng · RFL-KILL-ONCHAIN-01 (§4c, nay vá bằng `C-REF-PROV`: sổ ra lấy từ
carrier mang NFT "TRSY", không còn cộng sổ của input lạ ở BẤT KỲ dấu nào) ·
§4b mục 4-bis `C-ACC-1b` (NFT tài khoản phải nằm TRONG output tài khoản, không chỉ trong `tx.mint`).

**Cố ý để lại, và vì sao để lại được:**

| để lại | vì sao hoãn được |
|---|---|
| Giá trị thật của `trim_num`, `g`, `speed_policies` | tham số trong datum beacon, đổi bất cứ lúc nào |
| Nối `consumed MAGIC` đầy đủ | móc đã cắm ở §5; bật là một lượt post |
| *(gỡ khỏi danh sách hoãn)* trần công bằng cho `dpe` | **ĐÃ VÁ trong lượt này** — `C-ACC-DPE` ghim `dpe ≡ 1`, §1b |
| Tách-theo-NGƯỜI | không có đường on-chain nào hôm nay; §4d đã khai giới hạn |
| Nút cổ chai một-`Redeem`-mỗi-block | chưa đo; nó là trần thông lượng, không phải lỗ an toàn |
| UI tách "rút được cửa sổ này" khỏi "còn lại tổng" | off-chain. Nhưng **bắt buộc trước khi có người dùng thật**: nếu không, mỗi lần cắt ngọn sẽ đọc như một lần tịch thu |

**Thứ KHÔNG nằm trong tầm của bất kỳ mục nào ở trên, và phải nói ra để không ai tưởng đã được
che:** ba cái trần ở đây kẹp tốc độ LAMP **đi ra từ kho**. Chúng không chạm được LAMP mà một người
**mua bằng tiền mặt trên thị trường**. Nếu mối lo là một vị thế lớn bán xuống, vị thế gom trên thị
trường có thể lớn hơn cả một pot và nó nằm hoàn toàn ngoài `claim_account.ak`. Ba cái trần này
khoá một cửa; cửa kia không có khoá và không thể có.
