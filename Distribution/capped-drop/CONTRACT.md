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
- **`W` và `p` không phải lựa chọn tự do — chúng bị chính hai mốc đã chốt ép ra.** ETD-max
  (2.379.930 LAMP) xong trong 20 cửa sổ và pot 6 tỷ xong trong 1000 cửa sổ cho
  `p = ln 50 / ln 2521,08 = 0,4995` — lệch luật căn **0,42%** — và
  `W = E_max / release_epochs² = 6×10⁹ / 10⁶ = **6.000 LAMP**`.
- **Hiện thực bằng SỐ NGUYÊN, không `sqrt`.** Validator không tính `vested`; nó **kẹp** con số
  người dùng xin:

```
(redeemed + amount)²  ≤  dpe² · E · A_span²        và        redeemed + amount ≤ E
```

  Ba phép nhân, ~118 bit. Plutus dùng số nguyên độ chính xác tuỳ ý nên không có trần bit.
- **Permissionless:** account tự dựng tx khi redeem, không cần proof/committee chọn.
- **Entitlement bảo toàn:** bỏ lỡ cửa sổ KHÔNG mất quyền — `A` cộng dồn, và không có nhánh nào
  làm `A` giảm.

## 2. Datum `ClaimAccount` (thay field lottery)

```
ClaimAccount {
  owner            : ByteArray,   // PKH chủ ví
  entitlement      : Int,         // E — tổng LAMP được phân bổ
  redeemed         : Int,         // đã nhận tích lũy
  start_epoch      : Int,         // t0 — GIỮ, chỉ còn dùng cho nhãn/kiểm toán
  drops_per_epoch  : Int,         // dpe, trong [1, drops_per_epoch_max]
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
  rate_root        : Int,        // w = √W, gốc tốc độ ĐANG hiệu lực kể từ `epoch`
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
     bao giờ khởi động được. Giá trị: `trim_floor = 1.000 LAMP`, suy từ yêu cầu "ví 1.000 LAMP
     xong trong một cửa sổ".
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

Mọi **Claim** (committee cấp/tăng `entitlement`) BẮT BUỘC co-spend treasury (GrantEntitlement):
1. `granted = entitlement_out − entitlement_in`, yêu cầu `granted > 0`.
2. **C-SOLV-1:** `outstanding_entitlement_out = outstanding_entitlement_in + granted` (sổ cái dồn đúng).
3. **C-SOLV-2 (SOLVENCY):** `outstanding_entitlement_out ≤ treasury pool LAMP` → committee KHÔNG cấp
   E vượt số dư quỹ → redeem không bao giờ kẹt vì cạn pool.
4. **C-VAL-0:** pool LAMP + mọi asset BẤT BIẾN khi grant (chỉ datum đổi).
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

Refill gộp N UTxO ở địa chỉ kho về một singleton, cộng sổ cái các input mang datum qua
`fold_ledger` (`treasury.ak` ▸ `fn fold_ledger`). `fold_ledger` ép mọi input có datum khai CÙNG
`committee_hash`, nhưng KHÔNG ép từng số hạng `outstanding_entitlement` không-âm trước khi cộng.

| mã định danh | treo cái gì | ràng buộc TẠM đang có hiệu lực (fail-closed) | khai ở file nào |
|---|---|---|---|
| RFL-KILL-ONCHAIN-01 | *(v3: vá luôn ở lượt đúc này — xem §10)* `fold_ledger` tự nó chưa ép từng số hạng ≥ 0 — một UTxO tự đặt tại địa chỉ kho (Cardano không chạy validator lúc TẠO), khai đúng `committee_hash` công khai kèm `outstanding_entitlement` ÂM, kéo sổ nợ TỔNG sau Refill xuống thấp hơn thật. Vá on-chain đổi script hash (= địa chỉ kho đang chạy) | Chốt off-chain `RFL-013` (`Distribution/offchain/src/refillBuilder.ts`) chặn mọi input như vậy TRƯỚC khi cộng vào sổ cái — đủ cho mọi Refill đi qua builder này. KHÔNG chặn một giao dịch dựng tay thẳng vào validator bằng con đường khác | `Distribution/onchain/validators/treasury.ak:298-320` (mã), builder + test ở `Distribution/offchain/src/refillBuilder.ts` + `Distribution/tests/refillBuilder.test.ts` |

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
g_min · trim_num/trim_den · C_launch  ≥  dpe · √(W · E_test)
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

- **Multi-drop per-DID:** DAO tăng `drops_per_epoch` cho DID uy tín/nhu cầu cao. `dpe` nằm trong
  `[1, drops_per_epoch_max]` và **bất biến sau khi mở** — tăng nó cho một tài khoản đang chạy là
  một thay đổi tốc độ tích luỹ, phải đi qua đường NỚI, không được đi qua đường sửa datum.
- **Pause/penalty:** ĐẶT `drops_per_epoch = 0` là một **hành vi bị CẤM** ở v3 — nó hạ `vested`
  hồi tố xuống 0 và khoá vĩnh viễn một tài khoản đã rút dở. Phạt, nếu cần, phải đi qua
  `trim_num`, tức chỉ chạm các lượt rút TƯƠNG LAI.

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
- `rate_root`, `trim_num/trim_den`, `drops_per_epoch` là **tham số** (committee/DAO), KHÔNG hardcode.
- `index_at_start` **bất biến trọn đời tài khoản** — phải nằm trong danh sách ép, không được để
  suy ra.
- **SOLVENCY (C-SOLV-*):** `outstanding_entitlement` ≤ treasury pool LAMP ép on-chain ở MỌI Claim;
  sổ cái BẰNG `Σ(E − redeemed)` (tăng khi grant, giảm khi redeem) → `Σ(E − redeemed) ≤ pool`. Treasury
  authenticity = NFT "TRSY" one-shot (supply 1). `05_verify_solvency.ts` = kiểm tra vận hành
  độc lập (defense-in-depth), KHÔNG còn là chốt duy nhất.

## 8. Spec + build (song song bám CONTRACT)

- **SPEC**: viết FEAT (hành vi: entitlement → drip → redeem, ví nhỏ/lớn, hooks DAO) + MATH (chứng minh
  vested đơn điệu/bounded/cap, ⌈E/D⌉ epoch, đa-claim cộng dồn) + cập nhật `SPEC.md`/`README` (bỏ lottery).
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
| xin 3 triệu khi trần 1 triệu: **nhận 1 triệu, không lỗi**, phần thừa còn quyền | ngữ nghĩa cắt ngọn | ca dễ viết sai thành "reject" |
| `index_at_start` bị đổi trong out datum ⟹ TỪ CHỐI | §7 | không ép thì ca này xanh |
| `total_redeemed_out ≠ in + amount` ⟹ TỪ CHỐI | C-RDM-TOTAL | kiểm cả chiều thiếu lẫn chiều thừa |
| `speed_policies = []` ⟹ không đòi reference input nào | §5 | đo số reference input, không đo kết quả |

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
| đặt `drops_per_epoch` lúc mở | committee | M-of-N | không (bất biến sau khi mở) | **CHƯA CÓ mệnh đề nào ép `dpe` công bằng giữa các tài khoản.** Committee tự cấp `dpe = 100` trong khi cộng đồng ở `dpe = 21` là hợp lệ, và tỉ lệ 4,76× đó **không đổi** dù siết `trim_num` bao nhiêu |
| `DistributionVest` (đúc LAMP vào kho) | entry Registry `lamp_tag` | **PHẢI `MultiSig`, CẤM `SinglePkh`** | có (`Revoked`) | `SinglePkh` = một chữ ký đúc được tới `dist_cap`; nếu đúc từng đợt thì nhánh này còn sống suốt vòng đời |

**Hai dòng cuối là điểm treo thật, không phải thủ tục.** Dòng `dpe`: cần một mệnh đề ép `dpe` suy
tất định từ `E`, hoặc một trần trên tỉ số `dpe` giữa các tài khoản — **chưa có, chưa thiết kế**.
Dòng `DistributionVest`: là điều kiện đi kèm của quyết định "đúc từng đợt".

## 10. Phạm vi lượt này — cái gì vá, cái gì cố ý để lại

**Vá trong lượt đúc này** (tất cả đều là mã validator hoặc hình dạng datum, tức không sửa được về
sau vì cụm không có redeemer nâng cấp): §1 trần lõm · §2 `index_at_start` · §2b `total_redeemed` ·
§3 chỉ số cộng dồn + `rate_root` một chiều · §4 cắt ngọn + `trim_floor` · §4d sổ tên NFT ·
§5 móc `speed_policies` rỗng · RFL-KILL-ONCHAIN-01 (`fold_ledger` ép từng số hạng ≥ 0).

**Cố ý để lại, và vì sao để lại được:**

| để lại | vì sao hoãn được |
|---|---|
| Giá trị thật của `trim_num`, `g`, `speed_policies` | tham số trong datum beacon, đổi bất cứ lúc nào |
| Nối `consumed MAGIC` đầy đủ | móc đã cắm ở §5; bật là một lượt post |
| Trần công bằng cho `dpe` | chưa thiết kế xong — ghi ở §9 như điểm treo, KHÔNG im lặng |
| Tách-theo-NGƯỜI | không có đường on-chain nào hôm nay; §4d đã khai giới hạn |
| Nút cổ chai một-`Redeem`-mỗi-block | chưa đo; nó là trần thông lượng, không phải lỗ an toàn |
| UI tách "rút được cửa sổ này" khỏi "còn lại tổng" | off-chain. Nhưng **bắt buộc trước khi có người dùng thật**: nếu không, mỗi lần cắt ngọn sẽ đọc như một lần tịch thu |

**Thứ KHÔNG nằm trong tầm của bất kỳ mục nào ở trên, và phải nói ra để không ai tưởng đã được
che:** ba cái trần ở đây kẹp tốc độ LAMP **đi ra từ kho**. Chúng không chạm được LAMP mà một người
**mua bằng tiền mặt trên thị trường**. Nếu mối lo là một vị thế lớn bán xuống, vị thế gom trên thị
trường có thể lớn hơn cả một pot và nó nằm hoàn toàn ngoài `claim_account.ak`. Ba cái trần này
khoá một cửa; cửa kia không có khoá và không thể có.
