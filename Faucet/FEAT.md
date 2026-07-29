# tLAMP + Faucet — FEAT (Đặc tả tính năng / hành vi)

**Trạng thái:** draft 2026-06-09. Bám sát [CONTRACT.md](./CONTRACT.md) (khung interface đã
chốt) — KHÔNG mâu thuẫn. Một trong 4 spec FEAT/MATH/TECH/EXEC của module Faucet.

> Spec này mô tả **hành vi nhìn thấy được** của module: ai làm gì, luồng deploy pool +
> luồng dev claim 100 tLAMP, trạng thái trước/sau mỗi thao tác. Bám hành vi **code thật**
> ([`onchain/validators/tlamp_policy.ak`](./onchain/validators/tlamp_policy.ak),
> [`onchain/validators/faucet.ak`](./onchain/validators/faucet.ak),
> [`offchain/src/mintBuilder.ts`](./offchain/src/mintBuilder.ts),
> [`offchain/src/claimBuilder.ts`](./offchain/src/claimBuilder.ts)).
> KHÔNG đi sâu công thức/chứng minh (xem [MATH](./MATH.md)) hay datum/redeemer/validator
> byte-level (xem [TECH](./TECH.md)) hay lộ trình build/test/deploy (xem [EXEC](./EXEC.md)).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

Faucet là **vòi cấp token test tLAMP** cho mọi dev Cardano trên Preview/Preprod, hệt như
[tADA faucet chính chủ Cardano](https://docs.cardano.org/cardano-testnet/tools/faucet): ai cũng
tự lấy được **100 tLAMP** để test mọi tính năng LAMP mainnet (claim Distribution, nộp Treasury,
bỏ phiếu Governance…) mà không phải tự mint token rời rạc.

Mục tiêu cuối của cả dự án: **làm cho LAMP có giá trị** bằng cách mở SDK cho mọi Cardano team.
Faucet phục vụ mục tiêu đó bằng cách cho **một token test canonical duy nhất** (1 policy id chia
sẻ toàn mạng test) — dev của bất kỳ team eco nào đều dùng chung tLAMP để test SDK MagicLamp, thay
vì mỗi ví mint một policy id khác nhau (token phân mảnh, không chia sẻ được — xem [CONTRACT §6](./CONTRACT.md)).

### 0.2 Hai thành phần — vì sao tách

Module gồm **2 phần độc lập về vai trò** (CONTRACT §2, §3):

| Thành phần | Loại script | Ai chạy | Tần suất |
|---|---|---|---|
| **tLAMP policy** (`tlamp_policy.ak`) | minting policy one-shot | người deploy (1 ví foundation) | **đúng 1 lần trong lịch sử** |
| **Faucet** (`faucet.ak`) | spend validator (pool) | mọi dev | bao nhiêu lần cũng được |

Tách vì: token test phải **fixed-supply trung thực** (mint hết 1 lần rồi khóa), còn việc phát
cho dev là **chuyển token từ pool sang ví** — KHÔNG mint mỗi claim. Đây là điểm khác cốt lõi so
với faucet "mint-on-demand" thông thường: Σ tLAMP **bất biến** sau mọi claim ([CONTRACT §1](./CONTRACT.md),
[`tlamp_policy.ak:1-11`](./onchain/validators/tlamp_policy.ak)).

### 0.3 Thuộc spec này

- Vai của 2 caller: **người deploy** (mint pool 1 lần), **dev claim** (lấy 100 tLAMP).
- Luồng deploy: one-shot mint toàn bộ supply → đổ hết vào 1 pool UTxO có datum.
- Luồng claim: spend pool → pool giảm đúng `claim_amount`, dev nhận đúng `claim_amount`.
- Trạng thái pool trước/sau mỗi claim; điều kiện pool cạn.
- Vì sao permissionless, không cooldown (MVP); cooldown là v1.1.
- tLAMP canonical thay token test cũ phân mảnh.

### 0.4 KHÔNG thuộc spec này

| Chủ đề | Thuộc spec |
|---|---|
| Công thức + bất biến + chứng minh (value-preservation, one-shot, no-burn) | [MATH](./MATH.md) |
| Datum/redeemer byte-perfect, validator Aiken, chống double-satisfaction | [TECH](./TECH.md) |
| Codec offchain↔onchain (`OutputReference` shape, Constr index) | [TECH](./TECH.md) |
| Lộ trình build/test/deploy Preview, test plan, gaps | [EXEC](./EXEC.md) |
| Token LAMP **thật** mainnet (CIP-68, policy khác hẳn) | LAMP mainnet — tLAMP chỉ là test surrogate ([CONTRACT §2](./CONTRACT.md)) |
| Cooldown per-address chống cạn pool | **v1.1, chưa code** ([CONTRACT §3](./CONTRACT.md)) |

---

## 1. Vai và actor

### 1.1 Người deploy (foundation, 1 lần)

Một ví test của MagicLamp (đọc seed từ `MAGIC/.env` `VEDATA_WALLET_MNEMONIC`, xem
[`scripts/config.ts:28-29`](./scripts/config.ts)) chạy **đúng 1 lần** để khởi tạo cả hệ:

- Chọn 1 UTxO ví làm **genesis** (one-shot anchor).
- Mint **toàn bộ** test supply = 36 tỷ tLAMP = `36_000_000_000_000_000` oildrop.
- Đổ **hết** vào 1 Faucet pool UTxO, đính `FaucetDatum{ claim_amount }`.

Sau bước này policy **tự khóa**: genesis UTxO đã bị tiêu, không UTxO nào tiêu lại được → KHÔNG
ai mint thêm tLAMP, kể cả chính người deploy ([`tlamp_policy.ak:44-45`](./onchain/validators/tlamp_policy.ak),
luồng tx ở [`mintBuilder.ts:92-102`](./offchain/src/mintBuilder.ts)).

### 1.2 Dev claim (mọi người, permissionless)

Bất kỳ ví test nào cũng claim được. KHÔNG cần whitelist, KHÔNG cần chữ ký foundation, KHÔNG có
committee. Mỗi claim:

- Spend pool UTxO với redeemer `Claim`.
- Tạo pool mới = pool cũ trừ đúng `claim_amount` tLAMP.
- Ví dev nhận đúng `claim_amount` tLAMP (mặc định 100 LAMP = `100_000_000` oildrop).

Token test **vô giá trị** → permissionless là an toàn: kẻ spam chỉ tốn phí của chính nó, và pool
cạn thì re-deploy pool mới rất rẻ ([CONTRACT §3](./CONTRACT.md), [`faucet.ak:8-10`](./onchain/validators/faucet.ak)).

---

## 2. Luồng A — Deploy pool (one-shot mint)

**Caller:** người deploy. **Script chạy:** `tlamp_policy.mint`. **Builder:**
[`buildMintPoolTx`](./offchain/src/mintBuilder.ts).

### 2.1 Trạng thái trước

- Chưa có tLAMP nào tồn tại (policy id của tLAMP chưa từng mint).
- Ví deploy có ≥ 1 UTxO + đủ tADA (preflight đòi ≥ 10 tADA, [`00_preflight.ts:33`](./scripts/00_preflight.ts)).

### 2.2 Hành vi

Tx deploy làm đồng thời 3 việc trong **1 giao dịch**:

1. **Consume genesis UTxO** — UTxO đã được dùng để parameterize policy
   ([`01_mint_pool.ts:35-40`](./scripts/01_mint_pool.ts), `collectFrom([genesisUtxo])` ở
   [`mintBuilder.ts:94`](./offchain/src/mintBuilder.ts)).
2. **Mint đúng tổng cung** `(tLAMP, +TOTAL_SUPPLY_OILDROP)` — không hơn không kém
   ([`mintBuilder.ts:95`](./offchain/src/mintBuilder.ts), validator ép ở
   [`tlamp_policy.ak:49-53`](./onchain/validators/tlamp_policy.ak)).
3. **Gửi toàn bộ tLAMP vào pool** UTxO ở địa chỉ Faucet + min-ADA + inline `FaucetDatum`
   ([`mintBuilder.ts:97-101`](./offchain/src/mintBuilder.ts)).

### 2.3 Trạng thái sau

- 1 pool UTxO tại địa chỉ Faucet: value = `{ lovelace: poolLovelace, tLAMP: TOTAL_SUPPLY_OILDROP }`,
  inline datum `FaucetDatum{ claim_amount }`.
- Genesis UTxO biến mất khỏi chain → **policy khóa vĩnh viễn** (không re-mint được).
- Pool là **nguồn claim duy nhất** — không tLAMP nào nằm ngoài pool ([`mintBuilder.ts:18` C-POOL-1](./offchain/src/mintBuilder.ts)).

### 2.4 Cái gì bị từ chối (người deploy không làm bậy được)

- Mint mà **không** consume genesis → reject (one-shot, [`tlamp_policy.ak:45`](./onchain/validators/tlamp_policy.ak),
  test `mint_without_genesis`).
- Mint **sai tổng cung** (thừa/thiếu 1 oildrop) → reject ([`:53`](./onchain/validators/tlamp_policy.ak),
  test `mint_wrong_quantity_less/more`).
- Mint **kèm asset name lạ** cùng policy → reject (`dict.size == 1`, [`:51`](./onchain/validators/tlamp_policy.ak),
  test `mint_extra_asset_name`).
- Mint **âm** (burn) → reject (tLAMP fixed-supply không burn, [`:58 else fail`](./onchain/validators/tlamp_policy.ak),
  test `mint_negative_burn`).

---

## 3. Luồng B — Claim 100 tLAMP

**Caller:** dev bất kỳ. **Script chạy:** `faucet.spend`. **Builder:**
[`buildClaimTx`](./offchain/src/claimBuilder.ts).

### 3.1 Trạng thái trước

- Pool UTxO tồn tại với `tLAMP_pool ≥ claim_amount` (đủ để nhả 1 claim).
- Dev có ví test với chút tADA trả phí.

### 3.2 Hành vi

Tx claim spend pool với redeemer `Claim` và tạo ra:

1. **Pool mới** = pool cũ, chỉ tLAMP **giảm đúng** `claim_amount`; **mọi asset khác giữ
   nguyên** (ADA, dust); datum **giữ nguyên** `claim_amount`
   ([`claimBuilder.ts:78-84`](./offchain/src/claimBuilder.ts)).
2. **Output cho dev** nhận **đúng** `claim_amount` tLAMP
   ([`claimBuilder.ts:95`](./offchain/src/claimBuilder.ts)).
3. **KHÔNG mint** gì (`tx.mint == 0`) — chỉ chuyển token pool → dev.

Validator `faucet.spend` ép đẳng thức value: `pool_out.value == pool_in.value` với tLAMP
`−claim_amount` ([`faucet.ak:63-69`](./onchain/validators/faucet.ak)). Một đẳng thức này bao trùm
mọi gian lận (xem §3.4).

### 3.3 Trạng thái sau

| | tLAMP | ADA | dust | datum |
|---|---|---|---|---|
| Pool trước | `P` | `A` | `D` | `claim_amount` |
| Pool sau | `P − claim_amount` | `A` (giữ) | `D` (giữ) | `claim_amount` (giữ) |
| Ví dev | `+claim_amount` | — | — | — |

**Σ tLAMP bảo toàn:** `pool_out + claimer = pool_in` ([CONTRACT §3](./CONTRACT.md), test
`claim_happy`, builder test `builders.test.ts:148`). Pool có thể claim **lặp lại** tới khi cạn.

Khi pool nhả tới đúng 0 tLAMP, builder bỏ hẳn unit tLAMP khỏi pool output (giữ ADA) — pool vẫn
còn UTxO nhưng hết tLAMP ([`claimBuilder.ts:80-81`](./offchain/src/claimBuilder.ts), test
`drops tLAMP unit when pool drained`). Lúc đó claim tiếp **thất bại ở offchain** với lỗi
`CLAIM-003: pool cạn — re-deploy` ([`claimBuilder.ts:66-70`](./offchain/src/claimBuilder.ts)).

### 3.4 Cái gì bị từ chối (dev không drain được)

Tất cả nhờ 1 đẳng thức value + vài guard ([`faucet.ak:41-69`](./onchain/validators/faucet.ak)):

| Mưu đồ | Bị chặn bởi | Test |
|---|---|---|
| Nhả **>100** (lấy nhiều hơn) | value-eq lệch | `claim_too_much` |
| Nhả **<100** (giam token) | value-eq lệch | `claim_too_little` |
| Rút **ADA** của pool | value-eq lệch | `claim_drain_ada` |
| Cuỗm **dust/asset khác** của pool | value-eq lệch | `claim_steal_other_asset`, `rt_steal_dust` |
| **Bơm ngược** token vào pool rồi "claim âm" | value-eq lệch | `rt_negative_effective_claim` |
| **Mint thêm** tLAMP trong tx claim | `assets.is_zero(tx.mint)` | `claim_mint_rejected` |
| Mint **NFT rác policy khác** | `assets.is_zero(tx.mint)` | `rt_mint_other_policy` |
| **Đổi `claim_amount`** ở pool mới (để claim sau lấy nhiều) | datum preservation | `claim_datum_tamper` |
| **Xóa datum** pool mới (khóa/né check) | `expect InlineDatum` | `rt_pool_out_no_datum` |
| Datum bịa `claim_amount ≤ 0` | `claim_amount > 0` | `claim_zero_amount_datum`, `rt_negative_claim_amount` |
| **2 pool input** (double-satisfaction, 1 output trả) | count theo script hash | `claim_double_satisfaction` |
| **2 pool output** (chẻ pool né value-eq) | count theo script hash | `rt_two_pool_outputs` |
| Giả `own_ref` trỏ UTxO ví thường | `own_script_hash` ép `Script` | `rt_own_ref_not_script` |

Trường hợp **hợp lệ vẫn chạy:** pool ôm dust hợp lệ, nhả đúng 100 → PASS (`rt_happy_with_dust`)
— value-eq KHÔNG cấm pool giữ asset phụ, chỉ cấm thay đổi nó.

---

## 4. Vì sao permissionless + không cooldown (MVP)

Quyết định ghi để truy vết (4 trục, [CONTRACT §3](./CONTRACT.md)):

- **Lợi ích người dùng:** dev test cần token **ngay**, không qua phê duyệt — giống tADA faucet.
- **Bền vững:** token test vô giá trị nên spam **không có động cơ kinh tế**; kẻ spam chỉ tốn phí
  của mình. Pool cạn → re-deploy pool mới rẻ.
- **Tối ưu eUTXO:** không cooldown nghĩa là không cần per-address marker UTxO → claim chỉ 1 input
  + 2 output, ít ExUnit.
- **v1.1 (chưa code):** nếu cần chống cạn, thêm marker UTxO "đã claim epoch N" per-address. GHI RÕ
  KHÔNG thuộc MVP, không làm phức tạp eUTXO hiện tại.

---

## 5. tLAMP canonical — thay token test cũ

Trước đây test-LAMP được mint ad-hoc bằng **native sig policy của ví deploy** → mỗi ví ra **policy
id khác nhau** → token phân mảnh, không chia sẻ giữa dev, và KHÔNG fixed-supply (sig policy mint vô
hạn) ([CONTRACT §6](./CONTRACT.md)).

**Chốt:** tLAMP canonical = policy one-shot ở §2 (1 policy id, supply cố định, chia sẻ toàn mạng
test). Các module test khác (Distribution/Treasury/Governance) khi cần LAMP test nên trỏ tới
`deployed-faucet.json.tlamp.policyId` thay vì tự mint. Token sig policy cũ **deprecated**.

---

## 6. Tóm tắt trạng thái — bảng chuyển

| Thao tác | Caller | Trước | Sau | Bất biến giữ |
|---|---|---|---|---|
| Deploy pool | foundation (1 lần) | chưa có tLAMP | pool đầy + policy khóa | Σ = total_supply, genesis consumed |
| Claim | mọi dev | pool `P` tLAMP | pool `P−c`, dev `+c` | Σ tLAMP bất biến, datum + ADA + dust giữ |
| Claim khi cạn | mọi dev | pool `< c` tLAMP | (reject offchain) | — |

Mọi thao tác **không bao giờ** burn tLAMP, không bao giờ vượt tổng cung — fixed-supply trung thực,
phản chiếu đúng LAMP mainnet 36 tỷ bất biến.
