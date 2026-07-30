# tLAMP + Faucet — TECH (Kiến trúc on-chain Aiken)

**Trạng thái:** draft 2026-06-09. Bám **xương sống** [`CONTRACT.md`](./CONTRACT.md) — KHÔNG mâu
thuẫn. Tài liệu này là tầng **kỹ thuật** (datum/redeemer byte-perfect, validator, tham số, từng bất
biến map tới dòng code, codec offchain↔onchain). Hành vi ở [FEAT](./Feat-Spec.md), chứng minh ở
[MATH](./Math-Spec.md), lộ trình ở [EXEC](./Exec-Spec.md).

Aiken: `plutus = "v3"`, stdlib `aiken-lang/stdlib v3.1.0` ([`aiken.toml`](./onchain/aiken.toml)).
Module dùng: [`cardano/assets`](https://aiken-lang.github.io/stdlib/cardano/assets.html),
[`cardano/transaction`](https://aiken-lang.github.io/stdlib/cardano/transaction.html),
[`cardano/address`](https://aiken-lang.github.io/stdlib/cardano/address.html),
[`aiken/collection/dict`](https://aiken-lang.github.io/stdlib/aiken/collection/dict.html),
[`aiken/collection/list`](https://aiken-lang.github.io/stdlib/aiken/collection/list.html).

---

## 0. Hai script + tham số

| Script | File | Loại | Param compile-time |
|---|---|---|---|
| `tlamp_policy.mint` | [`tlamp_policy.ak`](./onchain/validators/tlamp_policy.ak) | minting policy | `genesis_ref: OutputReference`, `total_supply: Int` |
| `faucet.spend` | [`faucet.ak`](./onchain/validators/faucet.ak) | spend validator | `tlamp_policy: ByteArray`, `tlamp_name: ByteArray` |

Helper dùng chung: [`lib/magiclamp/faucet/util.ak`](./onchain/lib/magiclamp/faucet/util.ak),
types: [`lib/magiclamp/faucet/types.ak`](./onchain/lib/magiclamp/faucet/types.ak).

**Vì sao param hóa:**
- `genesis_ref` ⇒ mỗi deploy ra 1 policy id riêng cố định supply (one-shot anchor). KHÔNG hard-code.
- `total_supply` truyền qua param ⇒ onchain không nhúng con số khổng lồ; cho phép Preview/Preprod
  dùng cùng code, supply khác nhau ([`tlamp_policy.ak:19-21`](./onchain/validators/tlamp_policy.ak)).
- Faucet param `tlamp_policy + tlamp_name` ⇒ validator biết "asset nào là tLAMP" để áp đẳng thức
  value, KHÔNG cần đọc redeemer hay datum để biết.

---

## 1. Datum / Redeemer — schema byte-perfect

### 1.1 Định nghĩa Aiken ([`types.ak`](./onchain/lib/magiclamp/faucet/types.ak))

```aiken
pub type FaucetDatum {
  claim_amount: Int,          // oildrop mỗi claim; MVP = 100_000_000
}
pub type FaucetRedeemer {
  Claim                       // chỉ 1 action, permissionless
}
```

```aiken
// tlamp_policy.ak
pub type TLampRedeemer {
  MintGenesis                 // chỉ mint toàn bộ supply 1 lần; KHÔNG Burn
}
```

### 1.2 CBOR shape (Constr index = thứ tự khai báo)

| Loại | Plutus Data | CBOR |
|---|---|---|
| `FaucetDatum{claim_amount}` | `Constr(0, [int])` | — |
| `FaucetRedeemer::Claim` | `Constr(0, [])` | `d87980` |
| `TLampRedeemer::MintGenesis` | `Constr(0, [])` | `d87980` |
| `OutputReference` (param) | `Constr(0, [transaction_id: ByteArray, output_index: Int])` | — |

`OutputReference.transaction_id` là **ByteArray TRẦN** (không bọc Constr) — khớp
`plutus.json` definitions ([CONTRACT §4](./CONTRACT.md)). Đây là cái bẫy codec hay sai nhất.

### 1.3 Codec offchain ↔ onchain ([`datum.ts`](./offchain/src/datum.ts))

```ts
encodeFaucetDatum(d)  = new Constr(0, [d.claim_amount])           // :30-32
claimRedeemerToCbor() = Data.to(new Constr(0, []))  // "d87980"   // :52
mintGenesisRedeemerToCbor() = Data.to(new Constr(0, []))          // :57
```

Decode có guard chặt: `index !== 0` → reject; `fields.length !== 1` → reject
([`datum.ts:34-39`](./offchain/src/datum.ts)). Test round-trip + sai field count:
[`datum.test.ts:13-29`](./tests/datum.test.ts). Redeemer = `d87980` test
[`datum.test.ts:31-38`](./tests/datum.test.ts).

`OutputReference` param dựng ở script deploy: `new Constr(0, [genesis.txHash /* bare hex */,
BigInt(genesis.outputIndex)])` ([`01_mint_pool.ts:35-38`](./scripts/01_mint_pool.ts)).

### 1.4 Asset name tLAMP (hằng chốt)

```
"tLAMP" = #"744c414d50"   (0x74 't' + "LAMP")
```

Tiền tố `t` để KHÔNG nhầm với LAMP thật (`Distribution LAMP_ASSET_NAME = #"4c414d50"`). Khai báo
onchain `tlamp_asset_name` ([`tlamp_policy.ak:35`](./onchain/validators/tlamp_policy.ak)), offchain
`TLAMP_ASSET_NAME` ([`constants.ts:14`](./offchain/src/constants.ts)). Test khớp
[`datum.test.ts:50-52`](./tests/datum.test.ts).

---

## 2. tLAMP policy — validator chi tiết

```aiken
validator tlamp_policy(genesis_ref: OutputReference, total_supply: Int) {
  mint(_redeemer: TLampRedeemer, policy_id: PolicyId, tx: Transaction) {
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })   // :45
    let own_tokens = assets.tokens(tx.mint, policy_id)                         // :49
    expect dict.size(own_tokens) == 1                                         // :50
    expect assets.quantity_of(tx.mint, policy_id, tlamp_asset_name) == total_supply  // :53
    True
  }
  else(_) { fail }                                                            // :58
}
```

| Mã | Bất biến on-chain | Dòng | Chống |
|---|---|---|---|
| `MINT-A` | consume `genesis_ref` | [`:45`](./onchain/validators/tlamp_policy.ak) | mint lần 2 / mint giả (one-shot) |
| `MINT-B` | `dict.size(tokens) == 1` | [`:50`](./onchain/validators/tlamp_policy.ak) | mint kèm name lạ cùng policy |
| `MINT-C` | `quantity_of == total_supply` | [`:53`](./onchain/validators/tlamp_policy.ak) | thừa/thiếu/âm tổng cung |
| `MINT-else` | `else { fail }` | [`:58`](./onchain/validators/tlamp_policy.ak) | mọi purpose khác + mọi mint âm |

**Lý do dùng `dict.size + quantity_of` (không chỉ 1 trong 2):** `dict.size == 1` đảm bảo policy chỉ
mint **1** asset name; `quantity_of == total_supply` đảm bảo asset name đó (nếu là `n`) đúng lượng.
Hai góc red-team: `add(name', 0)` không tạo entry (size 0); `add(name', −1)` tạo entry (size 2) — cả
hai đều bị một trong hai check bắt (xem [MATH §2.2](./Math-Spec.md)).

---

## 3. Faucet — validator chi tiết

```aiken
validator faucet(tlamp_policy: ByteArray, tlamp_name: ByteArray) {
  spend(datum_opt, _redeemer, own_ref, tx) {
    expect Some(datum) = datum_opt                                           // :37
    let own_addr = util.own_address(own_ref, tx.inputs)                      // :38
    let own_hash = util.own_script_hash(own_addr)                           // :39
    expect assets.is_zero(tx.mint)                                          // :42  C-FAU-0
    expect datum.claim_amount > 0                                           // :45  claim>0
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1            // :48  C-FAU-1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1          // :49  C-FAU-1
    let pool_in  = util.input_at_script(tx.inputs, own_hash)                // :51
    let pool_out = util.output_at_script(tx.outputs, own_hash)              // :52
    expect InlineDatum(od) = pool_out.datum                                 // :55
    expect out_datum: FaucetDatum = od                                      // :56
    expect out_datum.claim_amount == datum.claim_amount                     // :57  C-FAU-2
    expect pool_out.value == assets.add(pool_in.value, tlamp_policy, tlamp_name, -datum.claim_amount)  // :63-69  C-FAU-3
    True
  }
  else(_) { fail }                                                          // :74
}
```

| Mã | Bất biến on-chain | Dòng | Chống |
|---|---|---|---|
| `C-FAU-0` | `assets.is_zero(tx.mint)` | [`:42`](./onchain/validators/faucet.ak) | mint thêm tLAMP / NFT rác |
| `claim>0` | `datum.claim_amount > 0` | [`:45`](./onchain/validators/faucet.ak) | datum bịa ≤ 0, claim ngược |
| `C-FAU-1` | `count_inputs==1 ∧ count_outputs==1` (script hash) | [`:48-49`](./onchain/validators/faucet.ak) | double-satisfaction |
| `C-FAU-2` | datum có + `claim_amount` giữ | [`:55-57`](./onchain/validators/faucet.ak) | drain trễ, mất datum |
| `C-FAU-3` | value-eq `pool_out == pool_in − c·tLAMP` | [`:63-69`](./onchain/validators/faucet.ak) | lấy >100/<100/ADA/asset khác |
| `C-FAU-else` | `else { fail }` | [`:74`](./onchain/validators/faucet.ak) | mọi purpose khác |

**Thứ tự check có chủ đích:** `claim_amount > 0` (`:45`) đứng **trước** value-eq (`:63`). Nếu không,
`c < 0` biến `add(..., −c)` thành `add(..., +|c|)` = bơm token vào pool. Đặt positivity trước đóng cửa
này ([MATH §3.5](./Math-Spec.md)).

### 3.1 Vì sao 1 đẳng thức value thay vì nhiều check rời

`C-FAU-3` là **1 đẳng thức `Value` bao trùm**: nhả >100, nhả <100, rút ADA, lấy asset khác, bơm
ngược → mọi sai lệch làm `pool_out.value ≠ pool_in.value + add(−c)` → reject. Đây là lựa chọn **tối
ưu eUTXO**: 1 phép so `Value` thay vì N phép so từng asset. `assets.add(v,p,n,−c)` chỉ chạm entry
`(p,n)`, mọi asset khác (ADA, dust) tự động phải bằng nhau ([`faucet.ak:59-62`](./onchain/validators/faucet.ak),
chứng minh [MATH §3.1](./Math-Spec.md)).

---

## 4. Helper `util.ak` — đếm theo script hash (chống double-sat)

```aiken
own_address(own_ref, inputs)   = (input khớp own_ref).output.address       // :11-14
own_script_hash(addr)          = expect Script(h) = addr.payment_credential; h  // :17-20
is_at_script(addr, h)          = addr.payment_credential == Script(h)       // :22-27
count_inputs_at_script(...)    = list.count theo is_at_script               // :29-31
count_outputs_at_script(...)   = list.count theo is_at_script               // :33-35
input_at_script / output_at_script = list.find theo is_at_script           // :37-45
```

**Nguyên lý (bài học Distribution C1/C2):** đếm theo **payment script hash**, KHÔNG full-address.
Cùng hash + khác stake credential = address khác nhưng đều là UTxO script → phải đếm theo hash
([`util.ak:1-3`](./onchain/lib/magiclamp/faucet/util.ak)). `script_address_staked` trong test dựng
đúng case này để chứng minh guard bắt được ([`util.ak:53-59`](./onchain/lib/magiclamp/faucet/util.ak),
test `claim_double_satisfaction`, `rt_two_pool_outputs`).

`own_script_hash` ép `Script(h)` — nếu `own_ref` trỏ UTxO ví thường (`VerificationKey`) thì
`expect Script(h)` fail (test `rt_own_ref_not_script`).

---

## 5. Codec offchain — builder map tới bất biến

### 5.1 `buildMintPoolTx` ([`mintBuilder.ts`](./offchain/src/mintBuilder.ts))

```
.collectFrom([genesisUtxo])                                    // :94  → MINT-A (consume genesis)
.mintAssets({ [tlampUnit]: totalSupply }, mintGenesisRedeemerToCbor())  // :95  → MINT-C
.attach.MintingPolicy(tlampPolicy)                             // :96
.pay.ToAddressWithData(poolAddress, {inline: faucetDatumToCbor}, poolAssets)  // :97-101  → C-POOL-1
```

`poolAssets = { lovelace: poolLovelace, [tlampUnit]: totalSupply }` — **toàn bộ** tLAMP vào pool,
không giữ lại ví ([`:87-90`](./offchain/src/mintBuilder.ts)). `poolAddress` = script address của
Faucet (`validatorToScriptHash → credentialToAddress`, [`:80-82`](./offchain/src/mintBuilder.ts)).

Guard offchain trước build: `totalSupply > 0`, `claimAmount > 0`, `claimAmount ≤ totalSupply`
([`mintBuilder.ts:74-76`](./offchain/src/mintBuilder.ts), test
[`builders.test.ts:108-116`](./tests/builders.test.ts)).

### 5.2 `buildClaimTx` ([`claimBuilder.ts`](./offchain/src/claimBuilder.ts))

```
decode pool datum → amount = claim_amount; reject nếu ≤ 0           // :60-62
reject nếu poolLamp < amount (pool cạn) CLAIM-003                   // :65-70
poolOutAssets = { ...poolUtxo.assets }; poolOutAssets[tlampUnit] -= amount  // :78-81  → C-FAU-3
newPoolDatum = { claim_amount: datum.claim_amount }                 // :84  → C-FAU-2
.collectFrom([poolUtxo], claimRedeemerToCbor())                    // :88
.attach.SpendingValidator(faucetScript)                            // :89
.pay.ToAddressWithData(poolAddress, {inline}, poolOutAssets)       // :90-94
.pay.ToAddress(destination, { [tlampUnit]: amount })               // :95  → C-RECV (dev nhận c)
```

**Quan trọng — bảo toàn dust/ADA:** builder **clone toàn bộ** `poolUtxo.assets` rồi chỉ trừ tLAMP
([`claimBuilder.ts:78-79`](./offchain/src/claimBuilder.ts)) ⇒ ADA + dust tự khớp `C-FAU-3`. Khi pool
cạn đúng `c`, **bỏ hẳn** unit tLAMP (`delete`) để tránh entry qty 0
([`:80-81`](./offchain/src/claimBuilder.ts), test `drops tLAMP unit` [`builders.test.ts:162-172`](./tests/builders.test.ts)).

### 5.3 Constants khớp onchain ([`constants.ts`](./offchain/src/constants.ts))

| Hằng | Giá trị | Khớp |
|---|---|---|
| `OILDROP_PER_LAMP` | `1_000_000n` | decimals 6 (Distribution) |
| `TOTAL_SUPPLY_OILDROP` | `36_000_000_000_000_000n` | `tlamp_policy total_supply` |
| `CLAIM_AMOUNT_OILDROP` | `100_000_000n` | `FaucetDatum.claim_amount` MVP |
| `TLAMP_ASSET_NAME` | `"744c414d50"` | `tlamp_asset_name` |

Test sanity [`datum.test.ts:40-53`](./tests/datum.test.ts).

---

## 6. Mô hình UTxO + chống double-sat (tổng hợp)

```
DEPLOY:   [genesis UTxO]  ──tlamp_policy.mint──▶  [pool UTxO: tLAMP=T, ADA, datum]
                                                  (genesis consumed → policy locked)

CLAIM:    [pool: tLAMP=P] ──faucet.spend(Claim)─▶  [pool': tLAMP=P−c, ADA, datum giữ]
                                                  [dev: tLAMP=+c]
                                                  (mint = 0)
```

- **1 pool UTxO** (không committee, không reference input) → claim = 1 input + 2 output, ít ExUnit.
- Double-satisfaction đóng cả 2 chiều: count input==1 **và** count output==1 theo script hash
  ([`faucet.ak:48-49`](./onchain/validators/faucet.ak)).
- Không có Drain/Admin redeemer — pool tự bảo toàn qua value-eq, không cần authority
  ([`types.ak:9-11`](./onchain/lib/magiclamp/faucet/types.ak)).

---

## 7. Quyết định kỹ thuật (truy vết 4 trục)

- **Native one-shot FT, KHÔNG CIP-68** (MVP): CIP-68 cần cặp ref-NFT(100)+user-token(333) + validator
  metadata → nhiều UTxO/ExUnit, lệch mục tiêu tối ưu eUTXO cho token test. Mục tiêu module = test
  **tính năng** LAMP (claim/treasury/governance), không phải metadata registry. Fixed-supply đạt
  bằng one-shot, độc lập chuẩn metadata. Metadata ví/explorer dùng CIP-25 tx metadata (label 721) ở
  bước deploy nếu cần — KHÔNG bắt buộc MVP ([CONTRACT §2](./CONTRACT.md)). Policy mainnet thật KHÁC
  policy tLAMP → không tạo nợ kỹ thuật.
- **claim_amount trong datum (param runtime), không hard-code:** DAO/test chỉnh lượng/claim không
  recompile/redeploy ([`types.ak:3-5`](./onchain/lib/magiclamp/faucet/types.ak)).
- **Permissionless, không cooldown (MVP):** token test vô giá trị → spam vô nghĩa; cooldown
  per-address (marker UTxO) là **v1.1, chưa code** ([CONTRACT §3](./CONTRACT.md)).
