# tLAMP + Faucet — CONTRACT (interface chốt)

Module testnet cho phép **mọi dev tự claim 100 tLAMP** (như tADA) để test mọi tính
năng LAMP mainnet trên Preview/Preprod. tLAMP là **token test canonical duy nhất**
của MagicLamp — chốt 1 policy, deprecate các tLAMP cũ phân mảnh (xem §6).

Đơn vị: **oil**, 1 LAMP = 10^6 oil (decimals 6) — KHỚP `Distribution/constants.ak`
(q-format oil) + `Distribution` LAMP_ASSET_NAME. Mọi số nguyên (pure BigInt, không float).

---

## 1. Nguyên lý thiết kế (4 trục)

- **Trung thực fixed-supply (định hướng dài hạn)**: LAMP mainnet tổng cung 36 tỷ BẤT
  BIẾN, KHÔNG bao giờ burn. tLAMP phản chiếu đúng: mint TOÀN BỘ test supply **đúng 1
  lần** vào pool, rồi policy khóa. Faucet **KHÔNG mint mỗi claim** — chỉ chuyển token
  từ pool sang dev. Σ tLAMP bảo toàn tuyệt đối sau mọi claim.
- **First-principles (one-shot)**: policy parameterized bởi 1 genesis `OutputReference`.
  Một UTxO chỉ spend 1 lần trong lịch sử chain → policy chạy tối đa 1 lần → supply cố
  định, không re-mint. Bất biến mạnh nhất không cần state on-chain.
- **Tối ưu eUTXO**: pool = 1 UTxO. Claim = 1 input + 1 output pool (theo script hash) +
  1 output cho dev. Không committee, không reference input, không mint trong claim →
  ít ExUnit, tx rẻ. Validator chỉ 1 đẳng thức value + 1 check datum.
- **Lợi ích người dùng + bền vững**: token test vô giá trị → permissionless 100/claim
  (MVP, không cần cooldown). Value bảo toàn tuyệt đối chống drain ADA/asset của pool.

---

## 2. tLAMP — minting policy (one-shot, fixed-supply)

`tlamp_policy.tlamp_policy.mint(genesis_ref: OutputReference, total_supply: Int)`

| Tham số | Ý nghĩa |
|---|---|
| `genesis_ref` | `OutputReference` UTxO ví deploy bị CONSUME (one-shot lock) |
| `total_supply` | Tổng cung oil = 36e9 × 10^6 = **36_000_000_000_000_000** |

Redeemer: `MintGenesis = Constr(0, [])` (không Burn).

Asset name: `"tLAMP"` = `#"744c414d50"` (0x74 `'t'` + `"LAMP"`). KHÔNG dùng `"LAMP"`
(`#"4c414d50"`) để tránh nhầm với token LAMP thật. Đơn vị nhỏ nhất = **oil**, 6
decimals (1 tLAMP = 10^6 oil — y như lovelace với ADA).

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

## 3. Faucet — spend validator (pool fixed-supply, nhả 100)

`faucet.faucet.spend(tlamp_policy: ByteArray, tlamp_name: ByteArray)`

Datum pool: `FaucetDatum{ claim_amount: Int } = Constr(0, [int])` — lượng oil mỗi claim
(MVP = 100 LAMP = `100_000_000` oil). Tham số runtime (DAO/test chỉnh không cần recompile).

Redeemer: `Claim = Constr(0, [])` (permissionless).

**Bất biến Claim** (tất cả phải đúng, nếu không → `fail`):

| Mã | Bất biến |
|---|---|
| `C-FAU-0` | `assets.is_zero(tx.mint)` — Faucet KHÔNG mint (nhả từ pool, không tạo token). |
| `claim>0` | `datum.claim_amount > 0` — chống datum bịa ≤ 0. |
| `C-FAU-1` | ĐÚNG 1 pool input + 1 pool output **theo SCRIPT HASH** (`count_inputs_at_script == 1`, `count_outputs_at_script == 1`) — chống double-satisfaction qua stake cred / nhiều pool UTxO 1 tx. |
| `C-FAU-2` | `pool_out.claim_amount == pool_in.claim_amount` — datum bảo toàn (chống đổi claim_amount để drain claim sau). |
| `C-FAU-3` | `pool_out.value == assets.add(pool_in.value, tlamp_policy, tlamp_name, -claim_amount)` — VALUE bảo toàn tuyệt đối: tLAMP giảm ĐÚNG claim_amount, mọi asset khác (ADA, dust) + min-ADA bảo toàn. |
| `else` | `else(_) { fail }` chặn mọi purpose khác. |

`C-FAU-3` là 1 đẳng thức bao trùm: nhả >100, nhả <100, rút ADA, lấy asset khác → đều
làm `pool_out.value` lệch → reject. Σ tLAMP bảo toàn: `pool_out + claimer = pool_in`.

**Rate-limit / cooldown** (ghi rõ, trục lợi ích + bền vững): MVP **permissionless,
không cooldown**. tLAMP vô giá trị → spam chỉ tốn phí của spammer + làm pool cạn (re-mint
pool mới rẻ). Nếu v1.1 cần chống cạn: thêm per-address marker UTxO (đã claim epoch N) —
**KHÔNG thuộc MVP**, không làm phức tạp eUTXO hiện tại.

---

## 4. Datum/Redeemer codec (byte-perfect onchain ↔ offchain)

| Loại | CBOR shape |
|---|---|
| `FaucetDatum{claim_amount}` | `Constr(0, [int])` |
| `FaucetRedeemer::Claim` | `Constr(0, [])` = `d87980` |
| `TLampRedeemer::MintGenesis` | `Constr(0, [])` = `d87980` |
| `OutputReference` (genesis param) | `Constr(0, [transaction_id: ByteArray, output_index: Int])` |

`OutputReference.transaction_id` là **ByteArray trần** (không bọc Constr) — xem
`plutus.json` definitions.

---

## 5. Offchain API (`@magiclamp/faucet-sdk`)

- `buildMintPoolTx(params)` — deploy: mint toàn bộ supply + consume genesis + gửi hết
  vào pool UTxO với `FaucetDatum`. (`mintBuilder.ts`)
- `buildClaimTx(params)` — dev claim: spend pool, pool_out = pool_in − claim_amount,
  dev nhận đúng claim_amount, datum + ADA + dust bảo toàn, no mint. (`claimBuilder.ts`)
- Constants: `OIL_PER_LAMP=1e6`, `TOTAL_SUPPLY_OIL=3.6e16`, `CLAIM_AMOUNT_OIL=1e8`,
  `TLAMP_ASSET_NAME="744c414d50"`.

Scripts (`Faucet/scripts/`, đọc `.env` từ `MAGIC/.env`:
`BLOCKFROST_TOKEN_GREENSUN` + `VEDATA_WALLET_MNEMONIC`):
`00_preflight.ts` → `01_mint_pool.ts` → `02_claim.ts`. Mặc định `SUBMIT=false` (chỉ
build + log, KHÔNG gửi tx live); `SUBMIT=true` để chạy thật.

---

## 6. Canonical — deprecate tLAMP cũ phân mảnh

Trước đây test-LAMP được mint ad-hoc bằng **native sig policy của ví deploy** (xem
`Distribution/scripts/02_mint_test_lamp.ts` + `config.ts nativeSigPolicy`) — mỗi ví/mỗi
lần ra **policy id khác nhau** → token test phân mảnh, không chia sẻ được giữa dev, và
KHÔNG trung thực fixed-supply (sig policy mint vô hạn).

**Chốt**: tLAMP canonical = policy one-shot ở §2 (cố định supply, 1 policy id chia sẻ
toàn mạng test). Các module test (Distribution/Treasury/Governance) khi cần LAMP test
nên trỏ tới `deployed-faucet.json.tlamp.policyId` thay vì tự mint sig policy. Token sig
policy cũ **deprecated** — giữ lại chỉ cho test self-contained cũ, không dùng cho e2e
chia sẻ mới.
