# Drip pot — hợp đồng on-chain v0.2

**Trạng thái:** v0.2, 2026-10-04 — dựng cho đợt ETD trên Preprod. Chưa deploy Mainnet.

v0.1 → v0.2 (sau một lượt tấn công spec): output đích gắn thẻ `OutputReference` thay cho đo dòng
ròng (hai két drip chung một đích từng chia nhau được một output); `MintAccounts` ghim thời gian hai
cận như `pot-vault` F-1 (v0.1 để lùi `lo` về gốc cửa sổ ⇒ mở tài khoản `start_epoch = 0` rồi rút
trọn); thêm DP-PARAM; output đích chỉ ADA + LAMP; datum tiếp nối so bằng hệt; mục đích script khác
bị từ chối; nói rõ cách ánh xạ `start_epoch` sang `cliff` của ETD.

Két nhả LAMP theo lịch tuyến tính **thẳng vào một địa chỉ đích cố định**, không qua ví người nhận
và không cần người nhận ký. Đích được ghi vào datum lúc mở tài khoản; ai cũng kích lượt rút được,
nhưng LAMP chỉ đi tới đúng đích đó.

Vì sao có hợp đồng này, khi đã có `claim_account` (`Distribution/capped-drop/CONTRACT.md` v3):
`claim_account` trả LAMP **chỉ** về `VerificationKey(owner)` và đòi owner ký
(`claim_account.ak` ▸ nhánh `Redeem`). Hai điều đó loại trừ một đích là script — ví dụ két
`did_payment` của PhoenixKey (script, không tự ký được). Drip pot bỏ cả hai ràng buộc: đích là
một `Address` bất kỳ (khoá hoặc script), và rút là việc ai cũng làm được.

Lịch nhả bám `AffiSo/Launch/ETD-Spec-Vi.md §3`: `vested = E · min(1, (t − cliff)/N)`. Ở đây
`start_epoch` là **cửa sổ đầu tiên được tính**, nên `start_epoch = cliff + 1` cho ra đúng công thức
đó (0 tại `cliff`, nhả hết ở `cliff + N`).

## 1. Tham số biên dịch

Thứ tự cố định:

```
drip_pot(
  campaign_id:      ByteArray,                 -- nhãn đợt, vd "early-tiger-deleg"; đổi đợt ⇒ đổi hash
  lamp_policy:      PolicyId,
  lamp_name:        AssetName,
  committee:        List<VerificationKeyHash>, -- khoá được mở tài khoản
  threshold:        Int,                       -- số chữ ký committee tối thiểu, 1 ≤ threshold ≤ |committee|
  ms_per_epoch:     Int,                       -- > 0
  window_origin_ms: Int,                       -- gốc cửa sổ (Specs/Window/CONTRACT.md v1.0)
  vest_epochs:      Int,                       -- N > 0
)
```

Giá trị Preprod: `ms_per_epoch = 432_000_000`; `window_origin_ms = 1_654_041_600_000`
(2022-06-01T00:00:00Z — epoch 317 bắt đầu 2026-10-03T00:00:00Z, đo trên Koios);
`vest_epochs = 36`; committee = khoá vận hành, `threshold = 1`.

Một validator nhiều mục đích: `spend` và `mint` cùng một script hash. Policy của token xác thực
= hash của chính script.

## 2. Datum · redeemer

```
DripDatum =
    Reserve                                   -- Constr 0 []        (CBOR d87980)
  | Account {                                 -- Constr 1 [addr, int, int, int]
      vault:       Address,   -- đích nhận LAMP, cố định suốt đời tài khoản
      entitlement: Int,       -- E, oildrop, > 0
      claimed:     Int,       -- đã nhả, 0 ≤ claimed < E
      start_epoch: Int,       -- cửa sổ đầu tiên được tính
    }

SpendRedeemer = Seed   -- Constr 0: committee mở tài khoản từ Reserve
              | Claim  -- Constr 1: nhả phần đã đến hạn của MỘT tài khoản

MintRedeemer  = MintAccounts  -- Constr 0
              | BurnAccount   -- Constr 1
```

Token xác thực: policy = hash script, asset name = `"account"` (`6163636f756e74`). Mỗi UTxO
`Account` hợp lệ giữ đúng 1 token. Token chỉ sinh ra cùng một `Account` đúng hình (mint) và chỉ
mất đi ở lượt `Claim` cuối (burn) ⇒ "UTxO ở địa chỉ này có token" ⟺ "tài khoản do committee mở".

`Reserve` là đúng datum mà kho Treasury rót tới qua `FundPot` (inline `d87980`).

## 3. Ký hiệu

- `own` = credential script của chính validator. "Input/output của két" = payment credential
  là `Script(own)`.
- `epoch(tx)` = `(lo − window_origin_ms) / ms_per_epoch` (chia sàn), `lo` = cận dưới validity
  range, phải hữu hạn; cận mở ⇒ `lo + 1`; `lo − window_origin_ms ≥ 0`.
- `lamp(v)` = lượng `(lamp_policy, lamp_name)` trong value `v`.
- `epoch_pinned(tx)` = như `epoch(tx)`, cộng: cận trên hữu hạn (cận mở ⇒ `hi − 1`), `lo ≤ hi`,
  `hi − lo ≤ 3_600_000`, và `(hi − window_origin_ms) / ms_per_epoch == epoch(tx)` (bản gốc:
  `pot-vault` ▸ `util.get_epoch_pinned`).
- `vested(E, s, e) = E · min(N, max(0, e − s + 1)) / N` (chia sàn).
- `tag(i)` = datum inline bằng hệt `OutputReference` của input két `i` (Data của nó).

## 3b. Chốt chung

- **DP-PARAM** Mọi nhánh kiểm trước tiên: `ms_per_epoch > 0`, `vest_epochs > 0`,
  `window_origin_ms ≥ 0`. Mọi phép kiểm committee dùng đúng ngữ nghĩa
  `Distribution/onchain/lib/magiclamp/lampdist/util.ak` ▸ `committee_approved`: khử trùng
  `committee`, `|committee| ≤ 16`, `1 ≤ threshold ≤ |unique(committee)|`, đếm khoá DUY NHẤT đã ký.
- **DP-PURPOSE** Mọi mục đích script ngoài `spend` và `mint` ⇒ từ chối.

## 4. Chốt — `spend`

Datum phải là inline. Cặp (datum, redeemer) khác hai cặp dưới ⇒ từ chối.

### 4.1. `Reserve` + `Seed` — chỉ committee

- **DP-SEED-1** `committee_approved(committee, threshold, extra_signatories)`.
- **DP-SEED-2** Mọi input của két có datum inline `Reserve` và không giữ token xác thực.
- **DP-SEED-3** Bảo toàn LAMP: `Σ lamp(output của két) ≥ Σ lamp(input của két)`.
- **DP-SEED-4** Mỗi output của két: hoặc giữ token xác thực (hình dạng do `mint` ép, §5), hoặc là
  `Reserve` đúng hình — datum inline `Reserve`, value chỉ ADA + LAMP, không reference script.
  Không output nào của két mang datum khác, để không LAMP nào thành UTxO không tiêu lại được.

### 4.2. `Account` + `Claim` — ai cũng gọi

Gọi `d` = datum input, `e = epoch(tx)`, `E = d.entitlement`, `c = d.claimed`.

- **DP-CLAIM-1** Đúng MỘT input của két trong cả giao dịch.
- **DP-CLAIM-2** Input giữ đúng 1 token xác thực và `lamp(input) == E − c`.
- **DP-CLAIM-3** `amount = vested(E, d.start_epoch, e) − c`, và `amount > 0`.
- **DP-CLAIM-4** Có **đúng một** output mà địa chỉ bằng hệt `d.vault` (payment + stake) VÀ datum
  là `tag(input két đang chi)`. Output đó: không reference script, value chỉ ADA + LAMP, và
  `lamp ≥ amount`. Thẻ là duy nhất theo từng input nên hai két (hay hai hợp đồng) không dùng chung
  được một output. Output tới `d.vault` mang datum khác hay không datum không được tính.
- **DP-CLAIM-5** Nếu `c + amount < E` (chưa hết):
  - đúng một output của két, địa chỉ **bằng hệt** địa chỉ input;
  - datum inline **bằng hệt** (so Data) `Account{ vault = d.vault, entitlement = E, claimed =
    c + amount, start_epoch = d.start_epoch }` dựng lại — không parse lỏng từng trường;
  - value đúng bằng `{ ADA: ≥ ADA của input, LAMP: E − c − amount, token xác thực: 1 }`, không
    token nào khác; không reference script;
  - không mint/burn gì dưới policy của két.
- **DP-CLAIM-6** Nếu `c + amount == E` (lượt cuối): không output nào của két, và mint dưới policy
  của két đúng bằng `{"account": −1}`. ADA của tài khoản do người dựng giao dịch nhận (bù phí cho
  người kích rút hộ).

## 5. Chốt — `mint`

Dưới policy của két, mint chỉ được chứa đúng tên `"account"` với lượng `q ≠ 0`.

### 5.1. `MintAccounts`, `q > 0`

- **DP-MINT-1** `committee_approved(committee, threshold, extra_signatories)`.
- **DP-MINT-2** Không input nào của két giữ token xác thực (không trộn với `Claim`).
- **DP-MINT-3** Số output của két giữ token xác thực == `q`, mỗi output giữ đúng 1.
- **DP-MINT-4** Mỗi output đó:
  - datum inline `Account` với `entitlement > 0`, `claimed == 0`,
    `start_epoch ≥ epoch_pinned(tx)` — hai cận ghim trong 1 giờ, nên người dựng không lùi được
    thời gian để mở tài khoản đã nhả sẵn;
  - payment credential của `vault` ≠ `Script(own)`;
  - value đúng bằng `{ ADA: bất kỳ, LAMP: entitlement, token xác thực: 1 }`; không reference script.

### 5.2. `BurnAccount`, `q == −1`

- **DP-BURN-1** Đúng một input của két, input đó giữ token xác thực. Phần còn lại do `spend`
  ▸ DP-CLAIM-6 ép (chỉ lượt cuối mới được đốt).

Mọi `q` khác (`< −1`, hay `> 0` với redeemer `BurnAccount`, hay `< 0` với `MintAccounts`) ⇒ từ chối.

## 6. Bất biến

- **INV-DP-solvency** Với mọi `Account` có token: `lamp(utxo) == E − claimed`. Không lượt nào
  nhả quá `vested`, và tổng nhả của một tài khoản không vượt `E`.
- **INV-DP-dich-co-dinh** LAMP rời một `Account` chỉ đi tới `vault` của nó.
- **INV-DP-chi-tang** `claimed` chỉ tăng; `vault`, `entitlement`, `start_epoch` không đổi.
- **INV-DP-reserve-khong-ro** LAMP của `Reserve` chỉ rời két bằng cách thành `Account` (hoặc
  `Reserve` mới) — không có nhánh chi `Reserve` ra ngoài.
- **INV-DP-khong-tu-tro** `vault` không thể là chính két.

## 7. Nghĩa vụ off-chain

- Chọn `vault`: chỉ đặt `did_payment` của một DID **đã có anchor Active** (thư Phoenix
  `pk1004did-a`) — vào `did_payment` của DID chưa có anchor thì chưa có đường ra. Ví khoá thường
  thì không ràng buộc gì thêm.
- Chia `E_i` theo `ETD-Spec-Vi.md §2`, `Σ E_i ≤` LAMP đang có ở `Reserve`.
- Lượt `Claim`: đặt `lo` = thời điểm hiện tại (sớm hơn chỉ làm `amount` nhỏ đi), trả ≥ min-ADA cho
  output đích, ADA tiếp nối = `max(ADA input, min-ADA của output mới)` (số `claimed` dài thêm thì
  min-ADA tăng).
- Lượt `MintAccounts`: `lo` = bây giờ, `hi ≤ lo + 1 giờ` và còn trong cùng cửa sổ.
- Ví đích là địa chỉ khoá: datum thẻ trên UTxO ở ví khoá vô hại. `did_payment`: hàm `spend` nhận
  `_datum: Option<Data>` và bỏ qua (`PhoenixKey-Validator/validators/did_payment.ak` ▸ `spend`).

## 8. Giới hạn đã biết

- **Không có đường thu hồi.** `Reserve` dư và `Account` có `vault` không tiêu được sẽ nằm lại
  mãi. Treo: nhánh `Return` về kho Treasury cần datum đúng sổ kho (không phải chỉ đúng địa chỉ),
  chưa thiết kế. Ràng buộc tạm: chỉ rót vào `Reserve` đúng lượng sẽ mở tài khoản.
- **Một tài khoản mỗi giao dịch** (DP-CLAIM-1). Kích rút hộ hàng loạt tốn N giao dịch.
- **Committee là điểm tin cậy** khi mở tài khoản: chọn `vault`, `E`, `start_epoch`. Sau khi mở,
  committee không đổi được gì của tài khoản. Rót Treasury (đa chữ ký) → `Reserve` là HẠ mức tin
  cậy xuống committee của két (Preprod: 1-of-1). Khoá committee bị chiếm ⇒ mở được tài khoản tuỳ ý
  từ `Reserve`, nhả trong `N` cửa sổ, không ai can thiệp được. Hướng bỏ điểm tin cậy (chưa làm):
  tham số `grants_root` — `MintAccounts` kèm bằng chứng Merkle cho `(vault, E, start_epoch)`.
- **Đích chết.** Đích là script đòi datum riêng (kho Treasury, pot khác, script V1/V2) thì LAMP tới
  đúng địa chỉ mà không tiêu lại được. `did_payment` của DID chuyển `Revoked`/`Migrated` sau khi mở
  tài khoản thì phần nhả sau đó kẹt. Ràng buộc tạm (off-chain, fail-closed): chỉ mở tài khoản cho
  ví khoá, hoặc `did_payment` của DID đang Active.
- **Rút hộ lượt cuối ăn ADA tài khoản** (DP-CLAIM-6) — theo thiết kế; người nhận không mất LAMP.
- **ADA của `Reserve` thuộc committee.** DP-SEED-4 không so ADA ra với ADA vào, nên lượt `Seed` lấy
  được min-ADA của Reserve. Không nới gì thêm: committee vốn đã chọn được `vault` và `E`.
- **Stake credential của địa chỉ két** chỉ bị ép ở output tiếp nối (bằng hệt input), không ép lúc
  đúc. Tài khoản đặt ở địa chỉ két có stake vẫn rút được, nhưng bộ quét theo địa chỉ không stake sẽ
  không thấy nó. Ràng buộc tạm (off-chain): mọi Reserve và Account đặt ở địa chỉ két KHÔNG stake.
- **Datum sai ở địa chỉ két ⇒ kẹt.** UTxO không datum, datum hash, hay datum lạ không có nhánh tiêu.
  FundPot (`treasury.ak` FP-5) chỉ ép "có inline datum", không ép `d87980` ⇒ bộ dựng FundPot phải
  khai đúng `POT_DATUM_CBOR=d87980` (`fund_pot.ts` đọc lại giao dịch đã dựng trước khi ký).

## 9. Mã + kiểm

- Mã: `Distribution/drip-pot/onchain/` (Aiken v1.1.21, stdlib `7d5cee54…`, như `pot-vault`).
- Mỗi chốt DP-* có ít nhất một ca âm tính mang tên chốt.
- Hash CHƯA áp tham số (`aiken build` v1.1.21): `20d5ca92e7477abb6892cd7866e12e4d9e5c54e15d62820fc946a5d3`.
  Hash sau khi áp tham số đọc lại từ lượt dựng thật, đừng chép số này sang off-chain.

## 10. Triển khai Preprod (đợt ETD, 2026-10-04)

- Tham số: `campaign_id = utf8("early-tiger-deleg")`, policy tLAMP `493002cc…`, committee = khoá vận
  hành `603249ab…`, `threshold = 1`, `ms_per_epoch = 432_000_000`, gốc `1_654_041_600_000`, `N = 36`.
- Két: `addr_test1wrrnnmjve70rptk6gype2n78skrh3sfcjk3a9k8nj67uv0s7c4z50`
  (hash `c739ee4ccf9e30aeda4103954fc7858778c13895a3d2d8f396bdc63e`).
- Rót từ kho Treasury: FundPot `a489876124f8260e871bc4004a666730cbe785aade12a2c3b97330d9b1397f0c`
  (12.000.000 tLAMP, 1 Reserve).
- Công cụ: `Genesis/scripts/33_drip_pot.ts` (address · status · seed · claim).
