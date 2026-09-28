# tLAMP + Faucet — CONTRACT (interface chốt)

> **Phiên bản:** v3.1 — 2026-09-28. Bump từ v3.0 vì codec on-chain đổi: `PoolDatum` thêm trường thứ
> tư `opened_root` (sổ MPF các DID đang có account), `PoolRedeemer::ClaimOpen`/`Reclaim` mang bằng
> chứng MPF, ngưỡng thu hồi 1001 → 72 cửa sổ, và bất biến mới INV-ONE-ACCT (§3.3a). Bản v3.0 nâng từ
> v1 vì v1 tả một validator đã bị xoá (`validators/faucet.ak`, `FaucetDatum{claim_amount}`).
> **Trạng thái:** v3.1 **CHƯA deploy** trên mạng nào — xem [`deployed-artifacts.md`](./deployed-artifacts.md).
> **Vai:** interface giữa on-chain và mọi bên tiêu thụ (SDK, script vận hành, module test khác).
> Khi lệch với mã trong `onchain/`, **mã thắng** và chỗ lệch phải sửa ở đây.

Module testnet cho phép **mọi dev tự claim tLAMP** (như tADA) để test mọi tính năng LAMP mainnet
trên Preview/Preprod. tLAMP là **token test duy nhất dùng chung** của MagicLamp — chốt 1 policy,
deprecate các tLAMP cũ phân mảnh (xem §6).

Lượng nhả: **v3 nhả `drip_oildrop` = 1001 tLAMP mỗi claim, có DID-gate và trần tốc độ**. Bản **v1
đang sống trên hai mạng test** nhả 100 tLAMP permissionless không DID-gate — hai con số này thuộc
hai bản khác nhau, đừng trộn (trạng thái deploy: [`deployed-artifacts.md`](./deployed-artifacts.md)).

Đơn vị: **oildrop**, 1 LAMP = 10^6 oildrop (decimals 6) — KHỚP `Distribution/constants.ak`
(q-format oildrop) + `Distribution` LAMP_ASSET_NAME. Mọi số nguyên (pure BigInt, không float).

---

## 1. Nguyên lý thiết kế (4 trục)

- **Trung thực fixed-supply (định hướng dài hạn)**: LAMP mainnet tổng cung 36 tỷ BẤT
  BIẾN, KHÔNG bao giờ burn. tLAMP phản chiếu đúng: mint TOÀN BỘ test supply **đúng 1
  lần** vào pool, rồi policy khóa. Faucet **KHÔNG mint mỗi claim** — chỉ chuyển token
  từ pool sang account của dev. Σ tLAMP bảo toàn tuyệt đối sau mọi claim.
- **First-principles (one-shot)**: policy parameterized bởi 1 genesis `OutputReference`.
  Một UTxO chỉ spend 1 lần trong lịch sử chain → policy chạy tối đa 1 lần → supply cố
  định, không re-mint. Bất biến mạnh nhất không cần state on-chain. Cùng cơ chế đó dùng lại cho
  POOL NFT (`faucet_nft` ▸ `MintPool`), nên pool là một singleton thật.
- **Tối ưu eUTXO**: pool = 1 UTxO, account = 1 UTxO per-DID. Mở account = 1 pool input + 1 pool
  output + 1 account output + 1 lượt đúc NFT. Không committee, không reference input. Ràng buộc
  dòng tiền viết bằng **đẳng thức `Value`**, không phải chuỗi bất đẳng thức trên từng asset.
- **Lợi ích người dùng + bền vững**: token test vô giá trị, nhưng pool **hữu hạn và không đúc lại
  được** ⇒ không thể để permissionless trần. Ba thứ giữ nó: trần tốc độ toàn cục (chốt duy nhất
  chặn vét kho), cooldown per-account, và thu hồi token nằm không về pool. Bản v1 "permissionless,
  không cooldown" đã bị thay chính vì vế "pool cạn là bất khả hồi".

---

## 2. tLAMP — minting policy (one-shot, fixed-supply)

> ⚠ **PHẠM VI — mục này tả policy RIÊNG của Faucet, KHÔNG tả thứ đang chạy trên Preprod.**
> Policy tLAMP đang hoạt động trên Preprod là `lamp_mint` (14 tham số, khoá bằng trần
> `dist_cap` + cổng registry + A-DEST, **đúc được nhiều lần**), không phải `tlamp_policy`
> hai tham số ở dưới. Mã: `Genesis/onchain/validators/lamp_mint.ak`; policy id đọc bằng
> `activeLampPolicyId(network)` ở `Genesis/offchain/src/lampPolicies.ts`.
> Mọi ràng buộc one-shot mô tả dưới đây đúng với `tlamp_policy` và **không** có hiệu lực
> trên token Preprod hiện hành. Đo trên chuỗi 2026-09-23 (Koios `asset_info`,
> `8169b76c…`/`744c414d50`): `mint_cnt = 4`, `burn_cnt = 0`.
> Không có dòng này thì người đọc tra "tLAMP" ra mục này rồi lập kế hoạch trên một ràng
> buộc không tồn tại — đã xảy ra một lần với một kho khác dùng token này.

`tlamp_policy.tlamp_policy.mint(genesis_ref: OutputReference, total_supply: Int)`

| Tham số | Ý nghĩa |
|---|---|
| `genesis_ref` | `OutputReference` UTxO ví deploy bị CONSUME (one-shot lock) |
| `total_supply` | Tổng cung oildrop = 36e9 × 10^6 = **36_000_000_000_000_000** |

Redeemer: `MintGenesis = Constr(0, [])` (không Burn).

Asset name: `"tLAMP"` = `#"744c414d50"` (0x74 `'t'` + `"LAMP"`). KHÔNG dùng `"LAMP"`
(`#"4c414d50"`) để tránh nhầm với token LAMP thật. Đơn vị nhỏ nhất = **oildrop**, 6
decimals (1 tLAMP = 10^6 oildrop — y như lovelace với ADA). Hằng on-chain: `tlamp_asset_name`.

**Bất biến mint** (tất cả phải đúng, nếu không → `fail`):
- `MINT-A` consume đúng `genesis_ref` (one-shot — chống mint lần 2).
- `MINT-B` `dict.size(tokens(mint, policy)) == 1` (không mint asset name lạ kèm theo).
- `MINT-C` `quantity_of(mint, policy, "tLAMP") == total_supply` (đúng tổng cung — không
  dư, không thiếu, không âm/burn).
- `else(_) { fail }` chặn mọi purpose khác + mọi mint âm.

**Quyết định CIP-68 vs native** (ghi để truy vết, trục first-principles + tối ưu):
chọn **native one-shot FT, KHÔNG CIP-68** cho MVP. Lý do:
1. CIP-68 cần cặp (reference NFT `(100)` giữ metadata + user token `(333)`), thêm 1 UTxO
   metadata + 1 validator quản metadata → nhiều UTxO/ExUnit hơn, lệch mục tiêu "tối ưu
   eUTXO" cho token test.
2. Mục tiêu module = **test mọi tính năng LAMP** (claim/redeem/treasury/governance),
   không phải test metadata registry. Distribution/Treasury chỉ cần `(policyId, assetName,
   qty)` — native FT đủ.
3. Trung thực fixed-supply (bất biến mạnh nhất) đạt được bằng one-shot, **độc lập** với
   chuẩn metadata. Một policy native one-shot đã chốt cứng tổng cung.
4. Metadata hiển thị ví/explorer: đính kèm **CIP-25 transaction metadata** ở tx mint (label
   721) nếu cần tên/logo tLAMP — không cần CIP-68 on-chain. (MVP chưa bắt buộc; thêm ở
   bước deploy live bằng `.attachMetadata(721, {...})`.)

Khi LAMP mainnet thật dùng CIP-68, **policy mainnet khác policy tLAMP** (tLAMP chỉ là
test surrogate) → không tạo nợ kỹ thuật.

---

## 3. Faucet v3 — ba script, thứ tự áp tham số acyclic

### 3.1 Chữ ký + thứ tự áp tham số

```
faucet_nft.faucet_nft.mint(genesis_ref: OutputReference, ms_per_epoch: Int)
        → faucet_nft_policy

faucet_account.faucet_account.spend(faucet_nft_policy: ByteArray, did_nft_policy: ByteArray,
        lamp_policy: ByteArray, lamp_name: ByteArray, ms_per_epoch: Int)
        → account_script_hash

faucet_pool.faucet_pool.spend(faucet_nft_policy: ByteArray, did_nft_policy: ByteArray,
        lamp_policy: ByteArray, lamp_name: ByteArray, ms_per_epoch: Int,
        account_script_hash: ByteArray)
```

Thứ tự này **bắt buộc** và không vòng: `faucet_nft` và `faucet_account` nhận diện pool bằng POOL
NFT nên không bên nào ôm hash pool.

- `did_nft_policy`: testnet truyền policy DID **test**; mainnet truyền **PhoenixKey DID**. Định danh
  per-DID = **asset name** của DID NFT (`did_name`).
- `(lamp_policy, lamp_name)`: nhận diện tLAMP.
- `ms_per_epoch`: độ dài một **cửa sổ** tính bằng ms. "Cửa sổ" là bucket `posix_ms / ms_per_epoch`,
  **không** phải epoch Cardano.
- `account_script_hash`: tham số compile-time, **không** phải trường datum. Lý do: trong datum thì
  phép kiểm khả thi duy nhất là độ dài 28 byte — một phép kiểm ĐỘ DÀI đứng thay phép kiểm ĐỊNH
  DANH, và một hash sai làm drip rót vào địa chỉ không script, mất vĩnh viễn, trong khi mọi kiểm
  tra on-chain vẫn xanh.

### 3.2 Hai token beacon

| Token | Asset name | Tính chất |
|---|---|---|
| POOL NFT | `"POOL"` = `#"504f4f4c"` | one-shot, nhận diện pool UTxO |
| ACCT NFT | `"ACCT"` ‖ `blake2b_224(did_name)` = **32 byte** | neo account vào đúng một DID; hàm `ledger.acct_name` |

ACCT NFT **không** còn là hằng `#"41434354"` — đó chỉ là 4 byte tiền tố (`ledger.acct_name_prefix`).
Mọi bên off-chain phải tự tính bằng cùng thuật toán (blake2b, digest 28 byte, không salt/key).

### 3.3 Datum

```
FaucetConfig  { drip_oildrop, cooldown_epochs, max_claims_per_window }
PoolDatum     { cfg: FaucetConfig, window_epoch, claims_in_window, opened_root }  ← datum POOL UTxO
FaucetAccount { did_name, last_claim_epoch, last_touch_epoch }                    ← datum account UTxO
```

- `opened_root` (32 byte) là gốc Merkle Patricia Forestry (`aiken-lang/merkle-patricia-forestry`
  v2.1.0) của TẬP khoá `did_key(did_name) = blake2b_224(did_name)` các DID đang có account. Giá trị
  lá = bytes rỗng. Tập khoá nằm off-chain; datum chỉ giữ gốc — giữ cả tập trong datum thì danh sách
  phình theo số DID tới lúc một lượt spend vượt trần ex-unit và pool chết vĩnh viễn. Xem §3.3a.

- `FaucetConfig` **bất biến vĩnh viễn** từ giây deploy (C-CFG-1 ép `out_pd.cfg == cfg` ở mọi lượt
  spend; POOL NFT one-shot nên không đúc lại datum được). Không có redeemer `Reconfigure`.
- `FaucetConfig` **không còn** trường `reclaim_epochs` (bản sao không được cưỡng chế ở đâu) và
  **không** ôm `account_script_hash`.
- Hai mốc trong `FaucetAccount` có hai nghĩa, **không gộp**: `last_claim_epoch` là mốc COOLDOWN
  (chỉ `ClaimOpen`/`ClaimAgain`/`TopUp` đổi được); `last_touch_epoch` là mốc IDLE (`Use` gia hạn
  được, `ReclaimIdle` đọc trường này).
- Ngưỡng thu hồi là hằng compile-time `reclaim_epochs_const = 72` cửa sổ (≈ **360 ngày** với cửa sổ
  5 ngày của Preprod/Mainnet; 72 ngày trên Preview) ở `lib/magiclamp/faucet/handlers.ak` — nguồn duy
  nhất, không có bản sao trong datum. v3.0 dùng 1001 (≈ 13,7 năm), tức trên thực tế không bao giờ
  thu hồi — với sổ một-DID-một-account, thu hồi là đường DUY NHẤT trả khoá của DID về, nên ngưỡng
  phải nằm trong tầm đời một mạng test.
- Trần compile-time `ledger.max_claims_ceiling = 100` chặn một con số `max_claims_per_window` gõ
  nhầm ở giây deploy.

### 3.3a Bất biến INV-ONE-ACCT — mỗi DID tối đa MỘT account

**Phát biểu:** tại mọi thời điểm, khoá `did_key(did_name)` nằm trong `PoolDatum.opened_root` ⇔ đang
tồn tại ĐÚNG MỘT ACCT NFT của DID đó.

Validator là hàm thuần trên một tx, không thấy UTxO nào khác đang sống — câu "DID này đã có account
chưa" không trả lời được bằng ràng buộc cục bộ nào, nên phải có một SỔ trong datum pool và mỗi lượt
mở/thu hồi phải chứng minh nó chuyển đúng. Quy nạp giữ bất biến; hai vế của mỗi bước đi CÙNG một tx:

| Bước | Sổ | Tập ACCT NFT | Chốt |
|---|---|---|---|
| `MintPool` | gốc RỖNG (`mpf.root(mpf.empty)`) | rỗng | `C-MP-8` |
| `ClaimOpen` | chứng minh VẮNG rồi CHÈN khoá | đúc 1 ACCT NFT | `C-OPEN-UNIQ-1` ⇔ `C-OPEN-1` |
| `Reclaim` | chứng minh CÓ rồi XOÁ khoá | đốt đúng ACCT NFT đó | `C-RECL-UNIQ-1` ⇔ `C-RECL-BURN-1` (+ `C-BURN-1` ở account) |
| `ClaimAgain` · `TopUpPool` | giữ NGUYÊN gốc | không đổi | `C-ROOT-KEEP-1` |

Tách một cặp "⇔" ra là bất biến sập mà không cổng nào còn phát hiện được, vì sổ chính là thứ đứng ra
làm chứng. **Trạng thái mã:** bảng trên giả thiết ACCT NFT chỉ được đúc trong tx `ClaimOpen`, và
giả thiết đó ĐÃ được mã ép: `C-MINT-ONLY-OPEN-1` (`ClaimAgain`) · `C-MINT-ONLY-OPEN-2` (`TopUpPool`)
· `C-RECL-BURN-2` (`Reclaim` đúng một mục mint) — xem [MATH](./Math-Spec.md) v3.1 §6a. Khoá trùng đúng phần đuôi asset name ACCT (`"ACCT"` ‖ khoá) nên bên off-chain dựng lại
được toàn bộ tập khoá từ các ACCT NFT đang sống, không cần lưu trạng thái riêng (§5).

### 3.4 Redeemer

| Nhóm | Constructor (thứ tự = Constr index) |
|---|---|
| `PoolRedeemer` | `ClaimOpen{proof}` · `ClaimAgain` · `Reclaim{proof}` · `TopUpPool` — `proof: mpf.Proof` |
| `AccountRedeemer` | `Use` · `TopUp` · `ReclaimIdle` |
| `FaucetNftRedeemer` | `MintPool` · `MintAccount` · `BurnAccount` |

### 3.5 Bất biến `faucet_pool.spend` — prelude (chạy trước mọi nhánh)

| Mã | Bất biến |
|---|---|
| — | đúng 1 input và 1 output mang POOL NFT (`util.count_inputs_with_nft` / `count_outputs_with_nft`) |
| `C-POOL-IN-1` | POOL NFT input ở CHÍNH script đang chạy: `util.own_address(own_ref, …) == pool_in.address`. `own_addr` do ledger cấp nên không giả được; thiếu nó thì mọi ràng buộc địa chỉ bên dưới suy biến thành "ví == ví" |
| `C-POOL-OUT-1` | `pool_out.address == pool_in.address` — so **ĐỊA CHỈ ĐẦY ĐỦ**, không chỉ payment credential: cùng script hash + khác stake credential là hai Address khác nhau |
| `C-POOL-OUT-2` | `pool_out.reference_script == None` — pool không biến thành script-carrier |
| — | `pool_out.datum` là `InlineDatum` parse được thành `PoolDatum` |
| `C-CFG-1` | `out_pd.cfg == cfg` — MỘT đẳng thức, không nới thành nhiều dòng |
| `C-CFG-2/3` | `drip_oildrop > 0` · `cooldown_epochs ≥ 0` · `max_claims_per_window > 0` |

Ba chốt `C-CFG-*` nằm ở prelude nên chúng gãy với **mọi** redeemer — đó là lý do `MintPool` phải ép
chúng ngay lúc đúc: một datum khởi tạo sai khoá chết toàn bộ tLAMP trong pool.

### 3.6 Bất biến dùng chung cho `ClaimOpen` + `ClaimAgain` (`check_claim`)

| Mã | Bất biến |
|---|---|
| `C-RATE-0` | `now = util.get_epoch_pinned(tx, ms_per_epoch)` — **không** dùng cận dưới. Với `now` lùi được, mỗi bucket quá khứ là một quota mới và trần tốc độ bị leo thang theo bậc thang |
| `C-RATE-1` | `now ≥ pd.window_epoch` (cửa sổ đơn điệu so với datum) |
| `C-RATE-2` | `used + 1 ≤ cfg.max_claims_per_window`, với `used = claims_in_window` nếu `now == window_epoch`, ngược lại `0` |
| `C-RATE-3/4` | `out_pd.window_epoch == now` · `out_pd.claims_in_window == used + 1` |
| `C-DRIP-1` | `pool_out.value == assets.add(pool_in.value, lamp_policy, lamp_name, −drip_oildrop)` — đẳng thức `Value`, giữ POOL NFT + ADA + mọi asset khác |
| `C-ACCTOUT-1..3` | đúng 1 output ở `account_script_hash`; địa chỉ nó == địa chỉ **enterprise** của hash đó; `reference_script == None` |
| `C-ACCTOUT-4/5` | `last_claim_epoch == now` · `last_touch_epoch == now` |
| `C-NAME-1/2` | account output mang ACCT NFT tên `acct_name(did_name)`; trong tx chỉ có **một** output mang tên đó |
| `C-DID-1` | tx có ≥ 1 input mang DID NFT `(did_nft_policy, did_name)` |

### 3.7 Bất biến riêng từng nhánh pool

| Nhánh | Mã | Bất biến |
|---|---|---|
| `ClaimOpen` | `C-OPEN-1` | đúc đúng 1 ACCT NFT của DID này |
| | `C-OPEN-2` | **0** input ở `account_script_hash` — đây là đường mở mới |
| | `C-OPEN-3` | account mới nhận ĐÚNG `drip_oildrop` tLAMP |
| | `C-OPEN-UNIQ-1` | `out_pd.opened_root == mpf.root(mpf.insert(from_root(pd.opened_root), did_key(acct.did_name), "", proof))` — `mpf.insert` tự ép khoá CHƯA có. `did` lấy từ datum account OUTPUT, không từ redeemer |
| `ClaimAgain` | `C-MINT-ONLY-OPEN-1` | `tx.mint` dưới `faucet_nft_policy` **RỖNG**. THAY chốt cũ `C-AGAIN-1` (chỉ so `an` của CHÍNH DID trong tx) — vế cũ để lọt việc đúc ACCT NFT của một DID khác, và giữ cả hai thì vế cũ thành bất khả ghim |
| | `C-AGAIN-2` | ĐÚNG 1 input ở `account_script_hash` — không có nó thì chỉ cần không đưa account cũ vào input là cooldown biến mất |
| | `C-AGAIN-3/4` | account input mang đúng ACCT NFT của DID này; `old.did_name` khớp |
| | `C-COOL-1` | `now ≥ old.last_claim_epoch + cooldown_epochs` — đọc mốc COOLDOWN, không phải mốc idle |
| | `C-AGAIN-5` | `acct_out(tLAMP) == acct_in(tLAMP) + drip_oildrop` — cộng thêm, không bỏ rơi số cũ |
| | `C-ROOT-KEEP-1` | `out_pd.opened_root == pd.opened_root`. Nhánh không cần bằng chứng nào — thiếu dòng này thì nó ghi được gốc tuỳ ý (xoá khoá của chính mình rồi `ClaimOpen` lại) |
| `Reclaim` | `C-RECL-0` | ĐÚNG 1 input ở `account_script_hash`. Không có dòng này thì đây là cửa spend RỖNG permissionless trên một singleton, tức DoS toàn phần giá một phí tx |
| | — | `lamp_out ≥ lamp_in` và `pool_out.value == add(pool_in.value, lamp, lamp_out − lamp_in)` |
| | `C-RECL-1/2` | `window_epoch` và `claims_in_window` **bảo toàn**. Không có chúng, xen một `Reclaim` reset bộ đếm miễn phí ⇒ trần tốc độ vô hiệu |
| | `C-RECL-UNIQ-1` | `out_pd.opened_root == mpf.root(mpf.delete(from_root(pd.opened_root), did_key(recl_acct.did_name), "", proof))` — `mpf.delete` tự ép khoá ĐANG có; `did` lấy từ datum của account input duy nhất (C-RECL-0) |
| | `C-RECL-BURN-2` | `dict.size(assets.tokens(tx.mint, faucet_nft_policy)) == 1` — cùng `C-RECL-BURN-1` thì `tx.mint` dưới policy này = đúng `{an(d): −1}`, tức một lượt thu hồi không kèm một lượt ĐÚC. Trùng lặp có chủ ý với `dict.size(own_tokens) == 1` của `faucet_nft`: pool là nơi GHI SỔ nên tiền đề của bút ghi không đi vay hình dạng mà script khác đang ép |
| | `C-RECL-BURN-1` | `quantity_of(tx.mint, faucet_nft_policy, acct_name(recl_acct.did_name)) == −1` — xoá khoá ⇔ đốt ĐÚNG ACCT NFT trong cùng tx. Thiếu nó, cặp `pool.Reclaim` + `account.TopUp` xoá khoá mà account vẫn sống ⇒ cùng DID `ClaimOpen` được account thứ hai |
| `TopUpPool` | — | **0** input ở `account_script_hash` (không mượn đường thu hồi) |
| | `C-TUP-1` | `lamp_out − lamp_in ≥ drip_oildrop` — nạp thật, không phải spend rỗng |
| | `C-TUP-2/3` | bộ đếm tốc độ bảo toàn |
| | `C-ROOT-KEEP-1` | `out_pd.opened_root == pd.opened_root` |
| | `C-MINT-ONLY-OPEN-2` | `tx.mint` dưới `faucet_nft_policy` **RỖNG**. Nhánh này trước đây KHÔNG đọc `tx.mint`, mà `MintAccount` chỉ đòi có POOL input ⇒ một lượt nạp tiền đúc kèm được ACCT NFT ra ví và cả hai validator đều chấp nhận |

### 3.8 Bất biến `faucet_account.spend` (thân ở `handlers.account_spend`)

Prelude: đúng 1 input ở script hash của chính nó (đếm theo script hash, chống double-satisfaction
qua stake credential).

| Nhánh | Mã | Bất biến |
|---|---|---|
| `Use` | `C-USE-NOPOOL-1` | tx **KHÔNG** có POOL NFT input. `Use` và `TopUp` phải RỜI NHAU: `Use` cấm tLAMP tăng, `TopUp` bắt buộc tăng |
| | `C-USE-EPOCH-1` | `now` qua `get_epoch_pinned` |
| | `C-ACCT-ADDR-1` / `C-ACCT-REF-1` | account output cùng ĐỊA CHỈ ĐẦY ĐỦ với input; `reference_script == None` |
| | — | tx mang DID NFT `(did_nft_policy, did_name)`; `did_name` bất biến |
| | `C-USE-CLAIMFIX-1` | `last_claim_epoch` **BẤT BIẾN** — `Use` không reset cooldown |
| | `C-USE-TOUCH-1` / `C-USE-MONO-1` | `last_touch_epoch == now` và **không lùi** |
| | `C-USE-NAME-1` / `C-USE-2` | ACCT NFT ở lại account, tên neo đúng DID; không đúc, không đốt |
| | — | `0 ≤ out(tLAMP) ≤ in(tLAMP)` — rút ra dùng được, bơm vào thì không |
| `TopUp` | `C-TOP-DID-1` | tx mang DID NFT của chính account đó. Thiếu nó, bất kỳ ai cũng tiêu được account UTxO của người khác, tự bỏ `drip` vào, và **đẩy mốc cooldown của nạn nhân lên `now`**. Chi phí của dòng này bằng 0 vì tx `ClaimAgain` đã phải mang DID NFT (C-DID-1) |
| | `C-TOP-ADDR-1` / `C-TOP-REF-1` / `C-TOP-2` | địa chỉ đầy đủ bất biến; không script-carrier; `did_name` bất biến |
| | `C-TOP-6/7` | cả hai mốc `== now` (claim vừa xảy ra) |
| | `C-TOP-3/4` | ACCT NFT ở lại; không đúc/đốt |
| | `C-TOP-POOL-1` + `C-TOP-5` | đúng 1 POOL NFT input, và `acct_out(tLAMP) == acct_in(tLAMP) + pd.cfg.drip_oildrop` — số tiền **đọc từ datum POOL**, không để bên pool tự khai |
| `ReclaimIdle` | — | `now = util.get_epoch(tx, …)` — **cố ý** dùng cận dưới: lùi thời gian chỉ làm người thu hồi tự mình không đủ điều kiện |
| | — | `now ≥ last_touch_epoch + reclaim_epochs_const` (đọc mốc IDLE) |
| | `C-ACCT-POOLADDR-1` | đúng 1 POOL input + 1 POOL output, và `pool_out.address == pool_in.address`. Chốt này **không** trùng `C-POOL-OUT-1`: nếu POOL NFT đã lạc ra ví thì `faucet_pool.spend` không được gọi, và đây là cổng duy nhất còn đứng |
| | — | `pool_lamp_out − pool_lamp_in ≥ acct_lamp` — TOÀN BỘ tLAMP của account về pool, so **delta** chứ không so tuyệt đối |
| | `C-BURN-1` | ACCT NFT **phải** bị đốt (`quantity_of(tx.mint, …, an) == −1`). Không đốt thì nó thành vé tái dùng vĩnh viễn |

### 3.9 Bất biến `faucet_nft.mint` (thân ở `handlers.nft_mint`)

| Nhánh | Mã | Bất biến |
|---|---|---|
| `MintPool` | — | consume `genesis_ref` (one-shot); `dict.size(own_tokens) == 1`; `quantity_of(POOL) == 1`; đúng 1 output mang POOL NFT |
| | `C-MP-1` | `pool_out.address.payment_credential` là `Script(_)` — không đúc thẳng vào ví, vì khi đó `faucet_pool.spend` không bao giờ chạy |
| | `C-MP-2/3` | `stake_credential == None` (enterprise); không script-carrier |
| | `C-MP-4/5` | datum parse được thành `PoolDatum`; `claims_in_window == 0` |
| | `C-MP-6` | `window_epoch == get_epoch_pinned(tx, ms_per_epoch)` — `window_epoch = 0` (mặc định tự nhiên của builder) cho sẵn hàng nghìn bậc thang quota dùng được ngay sau deploy |
| | `C-MP-7` | `drip_oildrop > 0` · `cooldown_epochs ≥ 0` · `0 < max_claims_per_window ≤ max_claims_ceiling` |
| | `C-MP-8` | `opened_root == empty_opened_root()` (= `mpf.root(mpf.empty)`) — sổ khởi tạo RỖNG; đúc pool với một gốc khác là cấp sẵn "account ma" cho các DID chưa từng mở |
| `MintAccount` | `C-MA-1/2` | ≥ 1 POOL NFT input (pool đang được spend ⇒ pool validator đã chạy); `quantity_of(POOL) == 0`; đúng 1 asset name; đúng 1 đơn vị |
| | `C-MA-3/4` | tên = tiền tố `"ACCT"` + độ dài đúng 32 byte |
| `BurnAccount` | `C-MB-1..3` | đúng 1 asset name, `qty == −1`, tiền tố + độ dài 32 byte (POOL name dài 4 byte ⇒ không burn POOL NFT qua nhánh này) |

`MintAccount` và `BurnAccount` không đứng chung một tx: khoá redeemer của mint là cặp
`(Mint, policyId)` nên một policy chỉ có MỘT redeemer mint trong một tx.

**Phân vai, không kiểm trùng:** mint policy ép **hình dạng** asset name ACCT và hình dạng datum
KHỞI TẠO của pool; `faucet_pool` ép tên **khớp DID** (C-NAME-1) và mọi ràng buộc dòng tiền.

`else(_) { fail }` ở cả ba validator chặn mọi purpose khác.

---

## 4. Datum/Redeemer codec (byte-perfect onchain ↔ offchain)

Constr index `i` (với `i < 7`) mã hoá thành CBOR tag `121 + i`.

| Loại | Plutus Data | CBOR |
|---|---|---|
| `FaucetConfig{drip_oildrop, cooldown_epochs, max_claims_per_window}` | `Constr(0, [int, int, int])` | — |
| `PoolDatum{cfg, window_epoch, claims_in_window, opened_root}` | `Constr(0, [Constr(0,[int,int,int]), int, int, bytes(32)])` | — |
| `FaucetAccount{did_name, last_claim_epoch, last_touch_epoch}` | `Constr(0, [bytes, int, int])` | — |
| `PoolRedeemer::ClaimOpen{proof}` | `Constr(0, [Proof])` | bằng chứng rỗng: `d8799f80ff` |
| `PoolRedeemer::ClaimAgain` | `Constr(1, [])` | `d87a80` |
| `PoolRedeemer::Reclaim{proof}` | `Constr(2, [Proof])` | bằng chứng rỗng: `d87b9f80ff` |
| `PoolRedeemer::TopUpPool` | `Constr(3, [])` | `d87c80` |
| `Proof` (MPF) | `List<ProofStep>` — danh sách rỗng hợp lệ (`ClaimOpen` trên sổ rỗng; `Reclaim` trên sổ một khoá) | — |
| `ProofStep::Branch{skip, neighbors}` | `Constr(0, [int, bytes(128)])` | — |
| `ProofStep::Fork{skip, neighbor}` | `Constr(1, [int, Constr(0, [nibble: int, prefix: bytes, root: bytes(32)])])` | — |
| `ProofStep::Leaf{skip, key, value}` | `Constr(2, [int, bytes(32), bytes(32)])` — `key`/`value` là dạng ĐÃ BĂM (`blake2b_256`) | — |
| `AccountRedeemer::Use` | `Constr(0, [])` | `d87980` |
| `AccountRedeemer::TopUp` | `Constr(1, [])` | `d87a80` |
| `AccountRedeemer::ReclaimIdle` | `Constr(2, [])` | `d87b80` |
| `FaucetNftRedeemer::MintPool` | `Constr(0, [])` | `d87980` |
| `FaucetNftRedeemer::MintAccount` | `Constr(1, [])` | `d87a80` |
| `FaucetNftRedeemer::BurnAccount` | `Constr(2, [])` | `d87b80` |
| `TLampRedeemer::MintGenesis` | `Constr(0, [])` | `d87980` |
| `OutputReference` (genesis param) | `Constr(0, [transaction_id: ByteArray, output_index: Int])` | — |

`OutputReference.transaction_id` là **ByteArray trần** (không bọc Constr) — xem
`plutus.json` definitions.

**Ba chỗ codec đã DỊCH so với bản trước, đọc kỹ trước khi nâng cấp một bên tiêu thụ:**
1. Datum của POOL UTxO nay là `PoolDatum`, **không** còn là `FaucetConfig` trần.
2. `FaucetConfig` vẫn 3 trường nhưng trường thứ ba đổi nghĩa: `reclaim_epochs` → `max_claims_per_window`.
3. `FaucetAccount` từ 2 trường thành 3 trường; `AccountRedeemer::ReclaimIdle` dịch từ index 1 sang 2;
   `PoolRedeemer::Reclaim` dịch từ index 1 sang 2.
4. **v3.1:** `PoolDatum` từ 3 trường thành 4 (`opened_root` NỐI CUỐI); `ClaimOpen`/`Reclaim` từ
   `Constr` rỗng thành `Constr` một trường `proof`. Index constructor KHÔNG đổi. Một bộ giải mã v3.0
   đọc datum v3.1 phải ném vì sai số trường — không được đệm gốc rỗng cho trường thiếu.

Bằng chứng MPF sinh bằng thư viện JS `@aiken-lang/merkle-patricia-forestry` (SDK dùng 1.3.1) —
không dựng tay. CBOR SDK mã hoá trùng từng byte với `Proof.toCBOR()` của thư viện (kiểm ở
`tests/openedLedger.test.ts`), kể cả cách chẻ 128 byte `neighbors` thành hai khúc 64 byte.

Asset name ACCT phải tính bằng `blake2b_224(did_name)` cho **mọi** lượt dựng tx — không có hằng nào
dùng lại được.

---

## 5. Offchain API (`@magiclamp/faucet-sdk`, `offchain/src/`)

| Hàm | Việc | Tệp |
|---|---|---|
| `buildMintPoolTx` | deploy: đúc POOL NFT one-shot + `PoolDatum` khởi tạo (`opened_root` rỗng), nạp tLAMP vào pool | `mintBuilder.ts` |
| `buildClaimOpenTx` | mở chuỗi account mới cho một DID (đúc ACCT NFT, chèn khoá vào sổ) — nhận `openedLedger` | `claimBuilder.ts` |
| `buildClaimAgainTx` | nạp thêm drip vào chuỗi account đã có (pool `ClaimAgain` + account `TopUp`); giữ gốc sổ | `claimDidBuilder.ts` |
| `buildUseTx` | chủ DID gia hạn mốc idle + rút tLAMP ra dùng (không đụng pool) | `useBuilder.ts` |
| `buildReclaimTx` | thu hồi account nằm không về pool (permissionless), xoá khoá khỏi sổ + đốt ACCT NFT — nhận `openedLedger` | `reclaimBuilder.ts` |
| `buildTopUpPoolTx` | nạp tLAMP vào pool (vận hành); giữ gốc sổ | `topUpPoolBuilder.ts` |

Codec: `datum.ts` (`encode/decode` + `*ToCbor` cho cả ba nhóm redeemer, và bộ mã hoá `Proof`
`encodeMpfProof`/`decodeMpfProof`) trên các kiểu ở `types.ts`.

**Sổ `opened_root`: `openedLedger.ts`.** `OpenedLedger.fromLiveAccounts([...])` dựng lại tập khoá từ
danh sách account đang sống — mỗi phần tử là `{ didName }` hoặc `{ acctAssetName }` (asset name ACCT
NFT ở địa chỉ account). `rebuild(list, root)` / `assertRoot(root)` đối chiếu gốc dựng lại với
`opened_root` trên datum: lệch ⇒ ném `FAUCET-LEDGER-001`, **không** dựng tiếp. `planInsert(did)` /
`planDelete(did)` trả bằng chứng + gốc trước/sau + sổ kế tiếp (sổ bất biến, không sửa tại chỗ).
Builder `ClaimOpen`/`Reclaim` nhận tham số `openedLedger` là một `OpenedLedger` HOẶC chính danh sách
đó. Mã lỗi: `FAUCET-LEDGER-002` hai account cùng một DID đang sống · `-003` chèn khoá đã có ·
`-004` xoá khoá không có · `-005` bằng chứng tự kiểm lệch · `-01x` hình dạng đầu vào lạ.
`CLAIM-OPEN-007`: DID đã có account ⇒ dùng `buildClaimAgainTx`. Module chạy trên Node (thư viện MPF
dùng `Buffer` + `node:assert`).

Hằng và cổng gác: `constants.ts` — `DRIP_OILDROP`, `COOLDOWN`, `RECLAIM`, `POOL_NFT_NAME`,
`MAX_CLAIMS_CEILING`, `acctName()`, và `assertMsPerEpochMatchesNetwork` (`FAUCET-EPOCH-001`) chặn
lượt nạp `ms_per_epoch` lệch mạng.

**Nghĩa vụ bắt buộc của builder (không phải codec, nhưng thiếu thì tx trượt ngẫu nhiên ở biên
bucket):** với `ClaimOpen`, `ClaimAgain`, `TopUp`, `Use`, `MintPool` phải đặt `lo = now_ms` và
`hi = min(now_ms + ttl, (⌊lo / ms_per_epoch⌋ + 1) × ms_per_epoch − 1)`; bucket còn lại ngắn hơn TTL
tối thiểu thì **chờ sang bucket sau, KHÔNG nới `hi`**. Hàm thuần: `epochWindow.pinnedEpochWindow`,
ném `FAUCET-WINDOW-001`. **KHÔNG** áp cho `ReclaimIdle`.

Scripts (`Faucet/scripts/`, nhận `BLOCKFROST_KEY` + `WALLET_SEED` qua biến môi trường đặt
ngay trước lệnh — `scripts/config.ts`): mặc định `SUBMIT=false` (chỉ build + log, KHÔNG gửi tx
live); `SUBMIT=true` để chạy thật.

**Không còn harness đánh số `00/01/02`** — bộ script đó gọi validator v1 nên đã bị xoá cùng nó. Đường
chạy thật của v3 là gọi trực tiếp sáu builder ở bảng trên (script demo hiện có:
`scripts/demo_faucet_v2.ts`, nội dung v3 nhưng tên còn nhãn cũ). Lộ trình deploy ở
[`Exec-Spec.md`](./Exec-Spec.md) v3.1 §4.

---

## 6. tLAMP dùng chung — deprecate tLAMP cũ phân mảnh

Trước đây test-LAMP được mint ad-hoc bằng **native sig policy của ví deploy** (xem
`Distribution/scripts/02_mint_test_lamp.ts` + `config.ts nativeSigPolicy`) — mỗi ví/mỗi
lần ra **policy id khác nhau** → token test phân mảnh, không chia sẻ được giữa dev, và
KHÔNG trung thực fixed-supply (sig policy mint vô hạn).

**Chốt**: tLAMP dùng chung = **một** policy id chia sẻ toàn mạng test, thay cho sig policy
mỗi-ví-một-id. Vai đó hiện do `lamp_mint` giữ, không do policy one-shot ở §2 — xem khối
phạm vi ở đầu §2. Các module test (Distribution/Treasury/Governance) khi cần LAMP test
nên trỏ tới nguồn ở `Genesis/offchain/src/lampPolicies.ts` thay vì tự mint sig policy. Token sig
policy cũ **deprecated** — giữ lại chỉ cho test self-contained cũ, không dùng cho e2e
chia sẻ mới.

> ⚠️ **Đường trỏ đã đổi (2026-09-11).** `deployed-faucet.json` là **ảnh chụp** một lượt deploy,
> KHÔNG phải nguồn. Nguồn duy nhất: `Genesis/offchain/src/lampPolicies.ts` — đọc bằng
> `activeLampPolicyId(network)`.
> Trạng thái bản đang nằm trong `deployed-faucet.json` (`7a1a7aed…`): **SUPERSEDED** — marker
> neo bằng native-sig ví deploy nên MỘT khoá đúc thêm được; đang chờ bản
> `preprod-oneshot-14param` / `preview-oneshot-14param` đúc theo đường registry-gate.
> Hệ quả cho vế "KHÔNG trung thực fixed-supply" ở ngay trên: nó đúng với sig policy **và** đúng
> với bản `7a1a7aed…` — đổi từ sig policy sang `7a1a7aed…` KHÔNG gỡ được điều đó, chỉ đổi chỗ
> đặt cái khoá. Đo lại: `cd Genesis/offchain && npx vitest run ../tests/lampPolicies.test.ts`.
