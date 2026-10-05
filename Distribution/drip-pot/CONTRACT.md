# Drip pot — hợp đồng on-chain v0.3

**Trạng thái:** v0.3, 2026-10-05. Chưa deploy Mainnet. Bản v0.2 đang chạy trên Preprod (§10).

v0.2 → v0.3: thêm nhánh `Return` (§4.3) — committee trả LAMP của `Reserve` về kho Distribution, ở
dạng mà nhánh `Refill` của kho gộp được vào sổ. Thêm tham số cuối `return_script`. Trước v0.3,
`Reserve` dư không có đường ra. Thêm hai tham số cuối `return_script`, `treasury_nft_policy`. Đổi
tham số ⇒ đổi hash: két v0.2 đã triển khai giữ nguyên.

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
  return_script:    ScriptHash,                -- hash script `treasury` (Distribution) nhận LAMP trả về
  treasury_nft_policy: PolicyId,               -- policy NFT "TREASURY" của carrier kho đó (DP-RET-7)
)
```

Giá trị Preprod: `ms_per_epoch = 432_000_000`; `window_origin_ms = 1_654_041_600_000`
(2022-06-01T00:00:00Z — epoch 317 bắt đầu 2026-10-03T00:00:00Z, đo trên Koios);
`vest_epochs = 36`; committee = khoá vận hành, `threshold = 1`; `return_script` = hash script
`treasury` của cụm đang chạy và `treasury_nft_policy` = policy NFT `TREASURY` của cụm đó, cả hai suy từ
bản ghi cụm ACTIVE (`Genesis/offchain/src/lampPolicies.ts`), không gõ tay (§7).

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
              | Return -- Constr 2: committee trả LAMP của MỘT Reserve về kho Distribution

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
  `window_origin_ms ≥ 0`, `|return_script| == 28`, `return_script ≠ own`, `|treasury_nft_policy| == 28`. Mọi phép kiểm committee dùng đúng ngữ nghĩa
  `Distribution/onchain/lib/magiclamp/lampdist/util.ak` ▸ `committee_approved`: khử trùng
  `committee`, `|committee| ≤ 16`, `1 ≤ threshold ≤ |unique(committee)|`, đếm khoá DUY NHẤT đã ký.
- **DP-PURPOSE** Mọi mục đích script ngoài `spend` và `mint` ⇒ từ chối.

## 4. Chốt — `spend`

Datum phải là inline. Cặp (datum, redeemer) khác ba cặp dưới ⇒ từ chối.

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
  `lamp ≥ amount`. Thẻ là duy nhất theo từng input nên hai lượt rút của két drip không dùng chung
  được một output. Thẻ chỉ bảo vệ két drip; nó không bảo đảm gì cho một hợp đồng khác không biết
  thẻ này cùng chạy trong giao dịch. Output tới `d.vault` mang datum khác hay không datum không được tính.
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

### 4.3. `Reserve` + `Return` — chỉ committee

Gọi `i` = input két đang chi, `r = lamp(i)`, `K = Script(return_script)`.

- **DP-RET-1** `committee_approved(committee, threshold, extra_signatories)`.
- **DP-RET-2** Đúng MỘT input của két trong cả giao dịch; datum inline `Reserve`, không giữ token
  xác thực.
- **DP-RET-3** Không input nào có payment credential `K`. Lượt trả không gộp sổ kho; việc gộp là
  một lượt `Refill` riêng của kho.
- **DP-RET-4** Không mint/burn gì dưới policy của két.
- **DP-RET-5** Output của két: không có, hoặc đúng MỘT output `Reserve` đúng hình (như DP-SEED-4:
  địa chỉ bằng hệt địa chỉ input, datum inline `Reserve`, value chỉ ADA + LAMP, không reference
  script). Gọi `k` = LAMP của nó (0 nếu không có). Đòi `k < r`.
- **DP-RET-2b** Ngoài input két đang chi, không input nào của giao dịch có payment credential dạng
  `Script(_)`. Không validator spend nào khác chạy cùng giao dịch, nên không ai dùng chung được
  output trả về (thay vai trò thẻ của DP-CLAIM-4, vì output trả về không mang được datum — DP-RET-6).
- **DP-RET-7** `reference_inputs` có **đúng một** UTxO có payment credential `K` và giữ đúng 1
  `(treasury_nft_policy, "TREASURY")` — carrier của kho. Gọi địa chỉ đầy đủ của nó là `A`.
- **DP-RET-6** Có **đúng một** output có payment credential `K`. Output đó: địa chỉ bằng hệt `A`
  (payment + stake), **không datum** (`NoDatum`), không reference script, value chỉ ADA + LAMP,
  `lamp ≥ r − k`.

Vì sao đích này là SỔ chứ không chỉ là địa chỉ: kho Distribution có nhánh `Refill`
(`Distribution/onchain/validators/treasury.ak` ▸ `Refill`, committee kho ký) gộp mọi UTxO ở payment
credential của kho vào carrier mang NFT `TREASURY` và cộng LAMP của chúng vào pool; nhánh đó không
đọc datum của input không phải carrier. Đo trên Emulator với hai validator thật
(`Distribution/tests/dripPotReturn.test.ts`): `Refill` gộp được output trả về, cả khi nó không datum
lẫn khi mang datum inline lạ. DP-RET-6 vẫn đòi `NoDatum` vì đó là hình dạng tối thiểu mà `Refill`
sinh ra để gộp (LAMP rót về qua A-DEST), không để két phụ thuộc cách kho xử datum lạ ở các bản sau;
chống dùng chung output vì thế đi qua DP-RET-2b chứ không qua thẻ. DP-RET-7 ép phía két: `K` phải đang giữ carrier
của đúng policy `TREASURY` đã áp — `return_script` trỏ nhầm (native script, kho khác policy, script
khác) thì Return không chạy được.

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
- **INV-DP-reserve-khong-ro** LAMP của `Reserve` chỉ rời két bằng một trong ba đường: thành
  `Account`, thành `Reserve` mới, hoặc tới `K` qua `Return` (DP-RET-6).
- **INV-DP-khong-tu-tro** `vault` không thể là chính két.

## 7. Nghĩa vụ off-chain

- Chọn `vault`: chỉ đặt `did_payment` của một DID **đã có anchor Active** — vào `did_payment` của
  DID chưa có anchor thì chưa có đường ra. Ví khoá thường thì không ràng buộc gì thêm. Danh sách cấp
  đọc qua `Genesis/scripts/_etdGrants.ts` ▸ `parseEtdGrants(…, { target: "drip" })`: ở đích này cổng
  ETD-GRANT-005 nhận cả ví script (với `claim_account` thì chỉ ví khoá).
- Chia `E_i` theo `ETD-Spec-Vi.md §2`, `Σ E_i ≤` LAMP đang có ở `Reserve`.
- Lượt `Claim`: đặt `lo` = thời điểm hiện tại (sớm hơn chỉ làm `amount` nhỏ đi), trả ≥ min-ADA cho
  output đích, ADA tiếp nối = `max(ADA input, min-ADA của output mới)` (số `claimed` dài thêm thì
  min-ADA tăng).
- Lượt `MintAccounts`: `lo` = bây giờ, `hi ≤ lo + 1 giờ` và còn trong cùng cửa sổ.
- Áp tham số két: `return_script`, `treasury_nft_policy` lấy từ trường có cấu trúc của bản ghi cụm
  ACTIVE, không từ chuỗi mô tả. Trước khi áp, kiểm có đúng một UTxO ở `Script(return_script)` mang 1
  `(treasury_nft_policy, "TREASURY")`, và `lamp_policy`/`lamp_name` của két bằng tham số cùng tên của
  `treasury` đó. Lệch ⇒ dừng.
- FundPot vào két drip: dựng lại hash két từ đủ tham số, so với địa chỉ pot đích, và đòi
  `return_script` == hash kho đang rót. Lệch ⇒ dừng.
- Lượt `Return`: carrier hiện tại làm reference input; output trả về đặt đúng địa chỉ của nó, không
  datum. Trước khi dựng, cụm chứa `return_script` phải ACTIVE.
- Ví đích là địa chỉ khoá: datum thẻ trên UTxO ở ví khoá vô hại. `did_payment`: hàm `spend` nhận
  `_datum: Option<Data>` và bỏ qua (`PhoenixKey-Validator/validators/did_payment.ak` ▸ `spend`).

## 8. Giới hạn đã biết

- **`Account` không thu hồi được.** Sau khi mở, LAMP của tài khoản chỉ đi tới `vault`
  (INV-DP-dich-co-dinh); `Return` chỉ áp cho `Reserve`. `vault` chết thì phần chưa nhả kẹt theo
  (mục "Đích chết").
- **LAMP trả về chưa vào sổ cho tới lượt `Refill` của kho.** Giữa hai lượt, nó nằm ở địa chỉ kho
  ngoài carrier, và `GrantEntitlement` chưa tính nó vào pool.
- **Két gắn vĩnh viễn với MỘT bản kho** (`return_script`, `treasury_nft_policy` nướng vào hash). Kho
  đổi phiên bản thì Return chỉ còn đưa LAMP về sổ của bản cũ. Ràng buộc tạm (off-chain): không
  Return khi cụm của `return_script` không còn ACTIVE.
- **Min-ADA của output trả về ở lại carrier.** Carrier không có nhánh rút ADA, nên mỗi lượt Return
  nhốt khoảng 1–2 ADA vào kho. ADA của `Reserve` về người dựng giao dịch, như ở `Seed`.
- **Ví trả phí lượt Return phải là ví khoá** (DP-RET-2b cấm mọi input script khác).
- **Một tài khoản mỗi giao dịch** (DP-CLAIM-1). Kích rút hộ hàng loạt tốn N giao dịch.
- **Committee là điểm tin cậy** khi mở tài khoản: chọn `vault`, `E`, `start_epoch`. Sau khi mở,
  committee không đổi được gì của tài khoản. Rót Treasury (đa chữ ký) → `Reserve` là HẠ mức tin
  cậy xuống committee của két (Preprod: 1-of-1). Khoá committee bị chiếm ⇒ mở được tài khoản tuỳ ý
  từ `Reserve`, nhả trong `N` cửa sổ, không ai can thiệp được.
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
- Hash CHƯA áp tham số v0.3 (`aiken build` v1.1.21, 4680 B):
  `821e8f64d3a86b73fa5c8a8e291da402717a20e4c0ec4de8c2120b3c`. Bản v0.2 (đang chạy Preprod, §10):
  `20d5ca92e7477abb6892cd7866e12e4d9e5c54e15d62820fc946a5d3`.
  Hash sau khi áp tham số đọc lại từ lượt dựng thật, đừng chép số này sang off-chain.

## 10. Triển khai Preprod (đợt ETD, 2026-10-04)

- Tham số: `campaign_id = utf8("early-tiger-deleg")`, policy tLAMP `493002cc…`, committee = khoá vận
  hành `603249ab…`, `threshold = 1`, `ms_per_epoch = 432_000_000`, gốc `1_654_041_600_000`, `N = 36`.
- Két v0.2: `addr_test1wrrnnmjve70rptk6gype2n78skrh3sfcjk3a9k8nj67uv0s7c4z50`. Hash đã áp tham số,
  tham số đã áp và bytecode v0.2 đóng băng: nguồn duy nhất là
  `Distribution/drip-pot/deployed/deployments.json` + `drip_pot-v0.2.blueprint.json`
  (`dripDeployment.ts` ▸ `resolveDripScript` ném lỗi khi hash dựng lại lệch).
- Rót từ kho Treasury: FundPot `a489876124f8260e871bc4004a666730cbe785aade12a2c3b97330d9b1397f0c`
  (12.000.000 tLAMP, 1 Reserve).
- Công cụ: `Genesis/scripts/33_drip_pot.ts` (address · status · seed · claim · return).
  `DRIP_VERSION` mặc định `v0.2` (két đang chạy); `v0.3` đọc `return_script`/`treasury_nft_policy` từ
  `lampPolicies.ts` ▸ `activeDistributionTreasury`.
