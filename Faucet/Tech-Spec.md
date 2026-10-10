# tLAMP + Faucet — TECH (Kiến trúc on-chain Aiken)

> **Phiên bản:** v3.2 — 2026-10-06. Bump vì đoạn mã minh hoạ §4.1 thiếu tham số `window_origin_ms` mà `util.ak` thật đã có (đoạn minh hoạ vẫn giản lược: bản thật còn chặn số âm).
> v3.1 — 2026-09-28. Bump từ v3.0 vì on-chain thêm sổ MPF `PoolDatum.opened_root`
> (mỗi DID tối đa một account), `ClaimOpen`/`Reclaim` mang bằng chứng, ngưỡng thu hồi 1001 → 72, và
> SDK có module `openedLedger.ts`. Bản v3.0 nâng từ draft 2026-06-09 vì bản đó tả `faucet.ak` và
> `lib/magiclamp/faucet/types.ak` — cả hai đã bị xoá khỏi cây mã.
> **Trạng thái:** v3.1 CHƯA deploy (xem [`deployed-artifacts.md`](./deployed-artifacts.md)).
> **Vai:** tầng kỹ thuật — mỗi nhóm bất biến nằm ở tệp nào, hàm nào; ngữ nghĩa helper; codec
> off-chain ↔ on-chain. Khi lệch với mã trong `onchain/`, **mã thắng**.

Bám [`CONTRACT.md`](./CONTRACT.md) v3.1 — KHÔNG mâu thuẫn. **Danh sách bất biến (nội dung từng chốt)
nằm ở CONTRACT v3.1 §3.3a + §3.5–§3.9 và không chép lại ở đây**; tệp này nói chốt đó *sống ở đâu trong mã*
và *vì sao viết như thế*. Hành vi ở [FEAT](./Feat-Spec.md), chứng minh ở [MATH](./Math-Spec.md), lộ
trình ở [EXEC](./Exec-Spec.md).

Aiken: `plutus = "v3"`, stdlib theo [`aiken.toml`](./onchain/aiken.toml).
Module dùng: [`cardano/assets`](https://aiken-lang.github.io/stdlib/cardano/assets.html),
[`cardano/transaction`](https://aiken-lang.github.io/stdlib/cardano/transaction.html),
[`cardano/address`](https://aiken-lang.github.io/stdlib/cardano/address.html),
[`aiken/collection/dict`](https://aiken-lang.github.io/stdlib/aiken/collection/dict.html),
[`aiken/collection/list`](https://aiken-lang.github.io/stdlib/aiken/collection/list.html),
[`aiken/crypto`](https://aiken-lang.github.io/stdlib/aiken/crypto.html),
[`aiken/interval`](https://aiken-lang.github.io/stdlib/aiken/interval.html).
Sổ `opened_root`: [`aiken-lang/merkle-patricia-forestry`](https://github.com/aiken-lang/merkle-patricia-forestry)
v2.1.0 (ghim theo commit trong `aiken.toml`/`aiken.lock`); phía off-chain là gói npm
`@aiken-lang/merkle-patricia-forestry` 1.3.1 của cùng tác giả.

---

## 0. Bốn script + tham số

| Script | Tệp | Loại | Param compile-time (ĐÚNG THỨ TỰ) |
|---|---|---|---|
| `faucet_nft.mint` | [`faucet_nft.ak`](./onchain/validators/faucet_nft.ak) | minting policy | `genesis_ref: OutputReference`, `ms_per_epoch: Int` |
| `faucet_account.spend` | [`faucet_account.ak`](./onchain/validators/faucet_account.ak) | spend validator | `faucet_nft_policy`, `did_nft_policy`, `lamp_policy`, `lamp_name`, `ms_per_epoch` |
| `faucet_pool.spend` | [`faucet_pool.ak`](./onchain/validators/faucet_pool.ak) | spend validator | `faucet_nft_policy`, `did_nft_policy`, `lamp_policy`, `lamp_name`, `ms_per_epoch`, `account_script_hash` |
| `tlamp_policy.mint` | [`tlamp_policy.ak`](./onchain/validators/tlamp_policy.ak) | minting policy | `genesis_ref: OutputReference`, `total_supply: Int` |

Thư viện dùng chung:

| Tệp | Nội dung |
|---|---|
| [`lib/magiclamp/faucet/ledger.ak`](./onchain/lib/magiclamp/faucet/ledger.ak) | kiểu datum, ba nhóm redeemer, `pool_nft_name`, `acct_name_prefix`, `acct_name()`, `max_claims_ceiling` |
| [`lib/magiclamp/faucet/util.ak`](./onchain/lib/magiclamp/faucet/util.ak) | `get_epoch` / `get_epoch_pinned`, đếm theo script hash, NFT-beacon, `script_address` |
| [`lib/magiclamp/faucet/handlers.ak`](./onchain/lib/magiclamp/faucet/handlers.ak) | `account_spend`, `nft_mint`, `reclaim_epochs_const` |

**Vì sao `handlers.ak` tồn tại — đừng gộp lại.** Aiken KHÔNG xuất handler của validator ra ngoài
module (`use faucet_account` rồi gọi `faucet_account.spend` trả lỗi
`aiken::check::unknown::module_value`). Nhưng lớp ca kiểm quan trọng nhất của module là lớp gọi
**hai script trên CÙNG một `Transaction`** — phép đo duy nhất bắt được "hai validator đòi hai điều
trái nhau", thứ mà mọi bài đơn vị vẫn xanh đúng tên nó. Không có tệp này thì lớp ca đó không viết
được, và một luồng có thể là mã chết trong khi toàn bộ bộ kiểm vẫn xanh. `faucet_account.ak` và
`faucet_nft.ak` chỉ còn là vỏ gọi `handlers.account_spend` / `handlers.nft_mint`. `faucet_pool`
KHÔNG nằm ở đây: ca kiểm hai-validator sống trong `faucet_pool.ak` (nơi có sẵn bộ builder của pool)
nên nó gọi pool trong-module và gọi hai hàm kia qua module.

**Vì sao param hoá:**
- `genesis_ref` ⇒ mỗi deploy ra một policy id riêng, cố định supply (one-shot anchor). KHÔNG hard-code.
- `total_supply` truyền qua param ⇒ on-chain không nhúng con số khổng lồ; Preview/Preprod dùng cùng
  mã, supply khác nhau.
- `(lamp_policy, lamp_name)` ⇒ validator biết "asset nào là tLAMP" để áp đẳng thức `Value`, không cần
  đọc redeemer hay datum để biết.
- `ms_per_epoch` ⇒ độ dài cửa sổ theo mạng, không nướng vào mã. Cổng off-chain
  `assertMsPerEpochMatchesNetwork` chặn lượt nạp lệch mạng.
- `account_script_hash` ⇒ xem §7.

**Thứ tự áp tham số là một dãy thẳng, acyclic:**

```
faucet_nft(genesis_ref, ms_per_epoch)                                  → faucet_nft_policy
faucet_account(faucet_nft_policy, did, lamp_policy, lamp_name, ms)     → account_script_hash
faucet_pool(faucet_nft_policy, did, lamp_policy, lamp_name, ms, account_script_hash)
```

Kiểm được ngay trên chữ ký: `faucet_account` và `faucet_nft` không bên nào ôm hash pool — chúng nhận
diện pool bằng POOL NFT. Đây là lý do một kiến trúc "truyền script-hash chéo hai chiều" (pool ôm
hash account **và** account ôm hash pool) không deploy được, và vì sao chỉ một chiều là đủ.

---

## 1. Datum / Redeemer — định nghĩa Aiken

### 1.1 Kiểu ([`ledger.ak`](./onchain/lib/magiclamp/faucet/ledger.ak))

```aiken
pub type FaucetConfig {
  drip_oildrop: Int,            // tLAMP (oildrop) nhả mỗi claim; chuẩn 1_001_000_000
  cooldown_epochs: Int,         // số cửa sổ tối thiểu giữa 2 claim của cùng 1 chuỗi account
  max_claims_per_window: Int,   // trần claim mỗi cửa sổ, TOÀN CỤC
}

pub type PoolDatum {
  cfg: FaucetConfig,            // BẤT BIẾN qua mọi lượt spend (C-CFG-1)
  window_epoch: Int,            // cửa sổ đang đếm
  claims_in_window: Int,        // số claim đã tiêu trong cửa sổ đó
  opened_root: ByteArray,       // gốc MPF 32 byte của tập did_key các DID đang có account
}

pub type FaucetAccount {
  did_name: ByteArray,          // asset name của DID NFT = định danh per-DID
  last_claim_epoch: Int,        // mốc COOLDOWN — `Use` KHÔNG đụng
  last_touch_epoch: Int,        // mốc IDLE — `ReclaimIdle` đọc trường này
}

pub type PoolRedeemer {
  ClaimOpen { proof: mpf.Proof }   // bằng chứng khoá DID CHƯA có trong opened_root
  ClaimAgain
  Reclaim { proof: mpf.Proof }     // bằng chứng khoá DID ĐANG có trong opened_root
  TopUpPool
}
pub type AccountRedeemer   { Use  TopUp  ReclaimIdle }
pub type FaucetNftRedeemer { MintPool  MintAccount  BurnAccount }
```

**`PoolDatum` tách `cfg` ra khỏi hai trường biến thiên là có chủ đích:** nhờ vậy "cấu hình bất biến"
viết được thành **MỘT** đẳng thức `out_pd.cfg == cfg`, không bị nới ra thành ba dòng so từng trường
— và một dòng thì không ai lỡ sửa mất một phần.

**Hai mốc, hai nghĩa — gộp làm một là một lỗ.** `Use` gia hạn mốc idle; nếu đó cũng là mốc cooldown
thì ai dùng tLAMP đúng cách lại bị đẩy cooldown ra xa, còn kẻ chỉ claim rồi bỏ đó thì không chịu gì,
và cooldown reset được bằng một lượt `Use`.

Hằng trong cùng tệp: `pool_nft_name = #"504f4f4c"` · `acct_name_prefix = #"41434354"` ·
`max_claims_ceiling = 100` · `did_leaf_value = #""`. Hàm: `did_key(did_name) = blake2b_224(did_name)`
và `empty_opened_root() = mpf.root(mpf.empty)` — một **hàm**, không phải hằng byte gõ tay, để thư
viện đổi cách băm nút rỗng thì không có bản sao nào chết im lặng.

**`opened_root` nối CUỐI, không chèn giữa:** index và vị trí ba trường cũ giữ nguyên, nên bộ giải mã
cũ ném vì sai số trường thay vì đọc nhầm trường. Sổ là một TẬP HỢP (giá trị lá rỗng) — mọi dữ liệu
về account nằm trong datum của chính account UTxO.

**Khoá sổ CỐ Ý bằng phần đuôi asset name ACCT** (`acct_name = "ACCT" ‖ did_key`). Nhờ vậy bên
off-chain dựng lại TOÀN BỘ tập khoá từ các ACCT NFT đang sống dưới policy `faucet_nft`, không cần
biết `did_name` của ai và không cần tự lưu trạng thái — nếu khoá là một hàm khác, mất bản lưu là mất
khả năng dựng bằng chứng cho mọi lượt mở/thu hồi về sau.

### 1.2 Asset name ACCT — hàm, không phải hằng

```aiken
pub fn acct_name(did_name: ByteArray) -> ByteArray {
  bytearray.concat(acct_name_prefix, crypto.blake2b_224(did_name))
}
```

4 byte tiền tố + 28 byte digest = **32 byte**, đúng trần asset name của Cardano. Mọi bên off-chain
phải tính bằng cùng thuật toán cho **mọi** lượt dựng tx, và "cùng thuật toán" ở đây là một hợp đồng
chặt: **BLAKE2b với độ dài digest 28 byte, KHÔNG key, KHÔNG salt, KHÔNG personalisation**. Lệch một
trong ba tham số đó ra một asset name khác hẳn, và tx sẽ trượt ở `C-NAME-1` chứ không báo "sai hash".

Bản off-chain tương ứng: `constants.acctName`, hiện hiện thực bằng `@noble/hashes`. Tên thư viện là
chi tiết thay thế được — cái **không** thay thế được là ba tham số trên, nên ca kiểm phải đối chiếu
với một vector BLAKE2b-224 độc lập (RFC 7693) chứ không chỉ với chính thư viện đang dùng.

Đây là cái bẫy dễ sai nhất sau khi nâng cấp: `ACCT_NFT_NAME = "41434354"` vẫn còn được xuất ra ở
off-chain (để không lay callers cũ), nhưng mọi nơi **ghép chuỗi tay** từ hằng đó đang dựng SAI asset
name.

### 1.3 CBOR shape

Bảng byte đầy đủ ở [CONTRACT](./CONTRACT.md) v3.1 §4 — một nguồn, không chép lại. Ba điều thuộc
tầng kỹ thuật:

- Bước `Leaf` của bằng chứng MPF mang `key`/`value` ở dạng **ĐÃ BĂM** (`blake2b_256` của khoá sổ và
  của giá trị lá), không phải khoá/giá trị thô. Bằng chứng do thư viện sinh — dựng tay là chỗ sai
  dễ nhất.

- Constr index = **thứ tự khai báo constructor** trong `ledger.ak`. Đổi thứ tự khai báo là đổi codec
  của mọi bên tiêu thụ, kể cả khi không đổi một chữ nào trong logic.
- `OutputReference.transaction_id` là **ByteArray TRẦN** (không bọc Constr) — khớp `plutus.json`
  definitions. Đây là cái bẫy codec hay sai nhất khi dựng tham số genesis.

### 1.4 Asset name tLAMP (hằng chốt)

```
"tLAMP" = #"744c414d50"   (0x74 't' + "LAMP")
```

Tiền tố `t` để KHÔNG nhầm với LAMP thật (`Distribution LAMP_ASSET_NAME = #"4c414d50"`). Khai báo
on-chain `tlamp_policy.tlamp_asset_name`, off-chain `constants.TLAMP_ASSET_NAME`.

---

## 2. `tlamp_policy.mint` — validator chi tiết

```aiken
validator tlamp_policy(genesis_ref: OutputReference, total_supply: Int) {
  mint(_redeemer: TLampRedeemer, policy_id: PolicyId, tx: Transaction) {
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })   // MINT-A
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1                                        // MINT-B
    expect assets.quantity_of(tx.mint, policy_id, tlamp_asset_name) == total_supply  // MINT-C
    True
  }
  else(_) { fail }                                                           // MINT-else
}
```

| Mã | Bất biến | Chống |
|---|---|---|
| `MINT-A` | consume `genesis_ref` | mint lần 2 / mint giả (one-shot) |
| `MINT-B` | `dict.size(tokens) == 1` | mint kèm name lạ cùng policy |
| `MINT-C` | `quantity_of == total_supply` | thừa / thiếu / âm tổng cung |
| `MINT-else` | `else { fail }` | mọi purpose khác + mọi mint âm |

**Vì sao cần CẢ `dict.size` và `quantity_of`, không chỉ một:** `dict.size == 1` nói policy chỉ mint
**một tên**; `quantity_of == total_supply` nói tên đó đúng lượng. Hai góc phá: `add(name', 0)` không
tạo entry (size 0); `add(name', −1)` tạo entry (size 2) — mỗi cái bị một trong hai chốt bắt. Chứng
minh ở [MATH](./Math-Spec.md) v3.1 §2.2.

Script này **độc lập** với ba script Faucet v3: nó chỉ đúc token, không biết gì về pool. Nó không bị
bản vá v3 chạm tới.

---

## 3. Faucet v3 — chốt nào sống ở tệp nào

Nội dung từng chốt: [CONTRACT](./CONTRACT.md) v3.1 §3.3a + §3.5–§3.9. Bảng dưới là bản đồ **vị trí**.

| Nhóm chốt | Tệp | Hàm |
|---|---|---|
| `C-POOL-IN-1` · `C-POOL-OUT-1/2` · `C-CFG-1/2/3` | `validators/faucet_pool.ak` | `faucet_pool.spend`, phần prelude trước `when redeemer is` |
| `C-RATE-0..4` · `C-DRIP-1` · `C-ACCTOUT-1..5` · `C-NAME-1/2` · `C-DID-1` | `validators/faucet_pool.ak` | `check_claim` (dùng chung cho `ClaimOpen` + `ClaimAgain`) |
| `C-OPEN-1..3` · `C-OPEN-UNIQ-1` | `validators/faucet_pool.ak` | nhánh `ClaimOpen` |
| `C-AGAIN-2..5` · `C-COOL-1` · `C-ROOT-KEEP-1` · `C-MINT-ONLY-OPEN-1` | `validators/faucet_pool.ak` | nhánh `ClaimAgain` (`C-MINT-ONLY-OPEN-1` THAY `C-AGAIN-1`) |
| `C-RECL-0/1/2` · `C-RECL-UNIQ-1` · `C-RECL-BURN-1/2` | `validators/faucet_pool.ak` | nhánh `Reclaim` |
| `C-TUP-1/2/3` · `C-ROOT-KEEP-1` · `C-MINT-ONLY-OPEN-2` | `validators/faucet_pool.ak` | nhánh `TopUpPool` |
| `C-USE-*` · `C-ACCT-ADDR-1` · `C-ACCT-REF-1` | `lib/magiclamp/faucet/handlers.ak` | `account_spend`, nhánh `Use` |
| `C-TOP-*` | `lib/magiclamp/faucet/handlers.ak` | `account_spend`, nhánh `TopUp` |
| `C-ACCT-POOLADDR-1` · `C-BURN-1` | `lib/magiclamp/faucet/handlers.ak` | `account_spend`, nhánh `ReclaimIdle` |
| `C-MP-1..8` | `lib/magiclamp/faucet/handlers.ak` | `nft_mint`, nhánh `MintPool` |
| `C-MA-1..4` | `lib/magiclamp/faucet/handlers.ak` | `nft_mint`, nhánh `MintAccount` |
| `C-MB-1..3` | `lib/magiclamp/faucet/handlers.ak` | `nft_mint`, nhánh `BurnAccount` |
| `reclaim_epochs_const = 72` | `lib/magiclamp/faucet/handlers.ak` | hằng module (nguồn DUY NHẤT) |
| `did_key` · `did_leaf_value` · `empty_opened_root` | `lib/magiclamp/faucet/ledger.ak` | định nghĩa sổ (khoá, lá, gốc rỗng) |
| đối chiếu off-chain ↔ on-chain của sổ | `validators/ledger_parity.ak` | chỉ ca kiểm (không validator, không đổi hash) |

**`ledger_parity.ak`** ghim một chuỗi 4 DID (chèn từ sổ rỗng, thu hồi bằng bằng chứng sâu 2 bước, mở
lại về đúng gốc cũ, bước `Fork`, thu hồi trên sổ một khoá) với gốc + bằng chứng do SDK JS sinh; cùng
bộ số được ghim ở `tests/openedLedger.test.ts`. Hai phía ghim cùng một bộ ⇒ đổi cách băm, cách mã hoá
bằng chứng hay cách dựng khoá ở một phía là một trong hai bộ kiểm đỏ. Có thêm hai ca phải-bị-từ-chối
(chèn khoá đã có, xoá khoá không có).

Ba tính chất của cách bố trí này, đáng ghi vì chúng dễ bị "tối giản" mất:

1. **`check_claim` là một hàm, không phải hai khối chép đôi.** Hai nhánh claim kiểm giống nhau ở 14
   chốt; viết hai lần thì chúng trôi khỏi nhau qua các lần sửa. Hàm trả về `ClaimCtx{now, acct_out,
   acct, an}` — đúng phần mà hai nhánh còn dùng tiếp.
2. **`MintPool` là cổng DUY NHẤT còn ép được trạng thái khởi tạo của pool.** Sau tx đó, `C-CFG-1`
   đóng băng `cfg` vĩnh viễn và POOL NFT one-shot nên không có đường đúc lại datum. Bốn đường phá mà
   `C-MP-*` đóng đều **bất khả hồi**: POOL NFT đúc thẳng vào ví (pool validator không bao giờ chạy) ·
   datum sai hình dạng (prelude gãy với MỌI redeemer ⇒ khoá chết toàn bộ tLAMP) · `window_epoch` khởi
   tạo ở quá khứ (mỗi bucket chưa dùng là một quota cộng dồn) · một con số `max_claims_per_window` gõ
   nhầm (trần tốc độ thành số trang trí).
3. **`C-ACCT-POOLADDR-1` KHÔNG trùng `C-POOL-OUT-1`.** Chốt ở pool chỉ chạy khi POOL NFT còn ở script
   pool; nếu nó đã lạc ra ví thì `faucet_pool.spend` không được gọi và chốt trong `ReclaimIdle` là
   cổng duy nhất còn đứng. Hai cổng ở hai script là **phòng thủ tầng**, không phải kiểm trùng.
   Tương tự với `C-AGAIN-2` (đếm account input ở pool) và phép đếm `== 1` trong `account_spend`.

---

## 4. `util.ak` — hai hàm epoch, và phép đếm theo script hash

### 4.1 `get_epoch` và `get_epoch_pinned` KHÔNG thay thế cho nhau

```aiken
pub fn get_epoch(tx, ms_per_epoch, window_origin_ms) -> Int {          // chỉ đọc cận DƯỚI
  expect Some(s) = tx.validity_range.lower_bound.bound_type |> get_finite
  (s - window_origin_ms) / ms_per_epoch
}

pub fn get_epoch_pinned(tx, ms_per_epoch, window_origin_ms) -> Int {   // NEO vào thời gian thật
  expect Some(lo) = tx.validity_range.lower_bound.bound_type |> get_finite
  expect Some(hi) = tx.validity_range.upper_bound.bound_type |> get_finite
  let e = (lo - window_origin_ms) / ms_per_epoch
  expect (hi - window_origin_ms) / ms_per_epoch == e
  e
}
```

Chọn sai hàm là một lỗ, không phải một chi tiết phong cách:

- `get_epoch` — cận dưới do người dựng tx đặt, và ledger chỉ đòi `lower_bound ≤ slot hiện tại` ⇒ giá
  trị trả về **luôn ≤ bucket thật**, đặt nhỏ tuỳ ý. Chỉ dùng được cho chốt mà "nói nhỏ hơn thật" là
  bất lợi cho chính người dựng tx — đúng một chỗ: `ReclaimIdle`.
- `get_epoch_pinned` — ép cả hai cận hữu hạn và **cùng một bucket** ⇒ slot hiện tại ∈ `[lo, hi]` ⊂
  bucket ⇒ giá trị trả về là bucket **thật**. Mọi chốt tốc độ, mọi cooldown, mọi lần ghi `last_*` và
  datum khởi tạo đều PHẢI dùng hàm này.

**Vì sao phải viết ra:** chốt cooldown và chốt trần-tốc-độ **ngược dấu nhau**. Cooldown cần "không
nói `now` lớn hơn thật"; `window_epoch` cần "không nói `now` NHỎ hơn thật". Cận dưới chỉ trả lời vế
đầu — dùng chung một hàm cho cả hai là cách trần tốc độ bị leo thang theo bậc thang trong khi mọi ca
kiểm vẫn xanh.

Nghĩa vụ off-chain đi kèm `get_epoch_pinned` ghi ở [CONTRACT](./CONTRACT.md) v3.1 §5.

### 4.2 Đếm theo payment script hash, KHÔNG theo full-address

```aiken
is_at_script(addr, h)          = addr.payment_credential == Script(h)
count_inputs_at_script(...)    = list.count theo is_at_script
count_outputs_at_script(...)   = list.count theo is_at_script
input_at_script / output_at_script = list.find theo is_at_script
```

Cùng script hash + khác stake credential = Address khác nhau nhưng **đều là UTxO của script** → phải
đếm theo hash, nếu không thì kẻ tấn công đặt hai UTxO khác stake credential, thoả ràng buộc trên một
cái và "ăn" cái kia.

**Nhưng đếm theo hash chưa đủ cho ĐÍCH ĐẾN.** `count/output_at_script` chỉ so payment credential nên
stake credential là trường TỰ DO nếu không ghim: cùng hash + khác stake credential thì phần thưởng uỷ
quyền trên ADA của UTxO chảy về khoá stake của kẻ dựng tx, và bên index mất dấu. Vì thế mọi chốt về
đích trong v3 so **ĐỊA CHỈ ĐẦY ĐỦ** (`pool_out.address == pool_in.address`,
`acct_out.address == acct_in.address`) hoặc so với địa chỉ **enterprise** dựng từ
`util.script_address(account_script_hash)`. Hàm `script_address` vì thế nằm trong mã sản xuất, không
còn là helper của ca kiểm.

`own_script_hash` ép `Script(h)` — `own_ref` trỏ UTxO ví thường (`VerificationKey`) thì gãy.

### 4.3 NFT-beacon helpers

`has_nft(out, policy, name)` = `quantity_of(out.value, policy, name) == 1` ·
`count_inputs_with_nft` / `count_outputs_with_nft` / `input_with_nft` / `output_with_nft`.

Hai hàm `*_with_nft` định vị UTxO **thuần bằng NFT** — chúng không nói gì về nơi đến. Đó là lý do mỗi
chỗ dùng chúng đều phải kèm một chốt địa chỉ riêng.

---

## 5. Codec off-chain — builder ↔ chốt on-chain

| Builder | Tệp | Chốt on-chain mà nó phải thoả |
|---|---|---|
| `buildMintPoolTx` | `offchain/src/mintBuilder.ts` | consume genesis · đúc đúng 1 POOL NFT · pool output ở script enterprise, không ref-script · `PoolDatum{claims_in_window: 0, window_epoch: bucket thật, opened_root: gốc rỗng}` · `max_claims_per_window ≤ 100` (`C-MP-1..8`) |
| `buildClaimOpenTx` | `offchain/src/claimBuilder.ts` | `C-RATE-*` · `C-DRIP-1` · `C-ACCTOUT-*` · `C-NAME-*` · `C-DID-1` · `C-OPEN-1..3` · `C-OPEN-UNIQ-1` (đối chiếu sổ, chèn khoá, bằng chứng vào redeemer) |
| `buildClaimAgainTx` | `offchain/src/claimDidBuilder.ts` | như trên trừ `C-OPEN-*`, thêm `C-AGAIN-2..5` · `C-COOL-1` · `C-ROOT-KEEP-1` · `C-MINT-ONLY-OPEN-1` (builder KHÔNG đúc gì dưới `faucet_nft_policy`), và **đồng thời** `C-TOP-*` vì account input dùng redeemer `TopUp` |
| `buildUseTx` | `offchain/src/useBuilder.ts` | `C-USE-*` — đặc biệt: tx **không được** có POOL NFT input (nên không đụng `PoolDatum`) |
| `buildReclaimTx` | `offchain/src/reclaimBuilder.ts` | `C-RECL-0/1/2` · `C-RECL-UNIQ-1` · `C-RECL-BURN-1` (pool) + `C-BURN-1`, `C-ACCT-POOLADDR-1` (account) |
| `buildTopUpPoolTx` | `offchain/src/topUpPoolBuilder.ts` | `C-TUP-1/2/3` · `C-ROOT-KEEP-1`, và **không** account input |

Codec: `offchain/src/datum.ts` (`encodeFaucetConfig`/`decodeFaucetConfig`, `encodePoolDatum`/
`decodePoolDatum`, `encodeFaucetAccount`/`decodeFaucetAccount`, `encodePoolRedeemer`/
`decodePoolRedeemer`, `encodeMpfProof`/`decodeMpfProof`, và một hàm `*RedeemerToCbor` cho mỗi
constructor của ba nhóm redeemer — `ClaimOpen`/`Reclaim` nhận `proof`) trên kiểu ở
`offchain/src/types.ts`.

Sổ: `offchain/src/openedLedger.ts` (`OpenedLedger`). Ba nguyên tắc của module, đều là lựa chọn có
chủ đích:

1. **Dựng lại, không lưu.** Tập khoá dựng từ danh sách ACCT NFT đang sống (`{acctAssetName}`) hoặc
   `did_name` (`{didName}`); module không có trạng thái bền nào để lệch.
2. **Đối chiếu trước khi dùng.** Gốc dựng lại ≠ `opened_root` trên datum ⇒ ném `FAUCET-LEDGER-001` và
   builder dừng. Danh sách đầu vào thiếu/thừa (chỉ mục chưa đồng bộ, đọc ở khối cũ) thì bằng chứng
   chắc chắn trượt on-chain; không có đường "đoán lại" tập khoá.
3. **Tự kiểm bằng chính phép on-chain.** Mỗi bằng chứng sinh ra được kiểm lại theo hai chiều
   `verify(excluding)` = gốc không có khoá, `verify(including)` = gốc có khoá — đúng hai phép
   `mpf.insert`/`mpf.delete` làm — trước khi trả cho builder (`FAUCET-LEDGER-005` nếu lệch).

Gốc rỗng: thư viện JS biểu diễn trie rỗng bằng `hash === null`, không xuất hằng; SDK giữ
`OPENED_ROOT_EMPTY` (32 byte 0) làm cầu nối và hằng này được ghim bằng thực thi ở cả hai phía
(`tests/openedLedger.test.ts` và bài Aiken `ledger_parity_empty_root`).

Cửa sổ hiệu lực: `offchain/src/epochWindow.ts` — `pinnedEpochWindow` (ném `FAUCET-WINDOW-001` khi
bucket còn lại ngắn hơn `MIN_PINNED_WINDOW_MS`) cho mọi nhánh đòi `get_epoch_pinned`; `windowAt` là
hàm dùng chung cho cả Reserve draw và **có lùi `lo` 60s**, nên nó KHÔNG thay được `pinnedEpochWindow`.

### 5.1 Hằng off-chain khớp on-chain (`offchain/src/constants.ts`)

| Hằng | Khớp với |
|---|---|
| `OILDROP_PER_LAMP` | decimals 6 (Distribution) |
| `TOTAL_SUPPLY_OILDROP` | `tlamp_policy` tham số `total_supply` |
| `TLAMP_ASSET_NAME` | `tlamp_policy.tlamp_asset_name` |
| `DRIP_OILDROP` | `FaucetConfig.drip_oildrop` (giá trị deploy) |
| `COOLDOWN` | `FaucetConfig.cooldown_epochs` (giá trị deploy) |
| `POOL_NFT_NAME` | `ledger.pool_nft_name` |
| `MAX_CLAIMS_CEILING` | `ledger.max_claims_ceiling` |
| `RECLAIM` | **bản chép có nhãn** của `handlers.reclaim_epochs_const` |
| `acctName()` | `ledger.acct_name` |

`RECLAIM` (= 72) là bản chép duy nhất được phép, vì nó chỉ dùng để off-chain tự tính "đã đủ idle
chưa" TRƯỚC khi dựng tx — sai giá trị không đổi được luật on-chain, chỉ làm builder chặn nhầm hoặc
dựng một tx chắc chắn bị từ chối. Bản chép có ca kiểm đọc thẳng `reclaim_epochs_const` trong
`handlers.ak` (`tests/faucetV2.test.ts`) — lệch nguồn là đỏ. Mọi hằng còn lại phải đọc từ datum
hoặc từ blueprint, không gõ tay.

Cổng `assertMsPerEpochMatchesNetwork` (`FAUCET-EPOCH-001`) chặn lượt nạp `ms_per_epoch` lệch mạng —
lỗi đó không làm tx fail (validator nhận cùng con số), nó chỉ làm cooldown và ngưỡng thu hồi dài ra
hoặc ngắn lại vài lần mà không ai thấy.

---

## 6. Mô hình UTxO

```
DEPLOY:
  [genesis UTxO] ──faucet_nft.MintPool──▶ [POOL UTxO: POOL NFT + tLAMP + PoolDatum{opened_root: rỗng}]
                                          (genesis consumed → POOL NFT one-shot locked)

CLAIM OPEN:
  [POOL: ClaimOpen{proof VẮNG}] + [DID NFT]  ──faucet_pool + faucet_nft.MintAccount──▶
      [POOL': tLAMP −drip, claims_in_window +1, opened_root = chèn did_key]
      [ACCOUNT: ACCT NFT + drip tLAMP + FaucetAccount{now, now}]

CLAIM AGAIN:
  [POOL: ClaimAgain] + [ACCOUNT: TopUp] + [DID NFT] ──faucet_pool + faucet_account──▶
      [POOL': tLAMP −drip, claims +1, opened_root GIỮ]  [ACCOUNT': tLAMP +drip, cả hai mốc = now]

USE:
  [ACCOUNT: Use] + [DID NFT]  ──faucet_account──▶
      [ACCOUNT': last_touch = now, last_claim GIỮ, tLAMP ≤ cũ]   (CẤM POOL NFT input)

RECLAIM IDLE:
  [ACCOUNT: ReclaimIdle] + [POOL: Reclaim{proof CÓ}] ──faucet_account + faucet_pool + BurnAccount──▶
      [POOL': tLAMP + toàn bộ tLAMP account, bộ đếm GIỮ NGUYÊN, opened_root = xoá did_key]
      (ACCT NFT bị đốt — C-RECL-BURN-1 ở pool, C-BURN-1 ở account)

TOP UP POOL:
  [POOL: TopUpPool] + [nguồn tLAMP] ──faucet_pool──▶
      [POOL': tLAMP +Δ, Δ ≥ drip, bộ đếm + opened_root GIỮ NGUYÊN]  (CẤM account input)
```

Hai luồng **không** có hình dạng tx nào gọi cả hai spend validator, và đó là tính chất của thiết kế
chứ không phải chỗ thiếu: `Use` bị `C-USE-NOPOOL-1` cấm POOL NFT input; `TopUpPool` cấm account
input và không đúc gì.

Không có redeemer `Drain`, không có `Admin`, không có `Reconfigure` — pool tự bảo toàn bằng đẳng thức
`Value` cộng bộ đếm, không cần authority nào.

---

## 7. Quyết định kỹ thuật (truy vết 4 trục)

- **`account_script_hash` là tham số compile-time, KHÔNG phải trường datum.** Trong datum thì cổng
  duy nhất kiểm được nó là "đúng 28 byte" — một phép kiểm ĐỘ DÀI đứng thay phép kiểm ĐỊNH DANH. Một
  hash đủ 28 byte nhưng sai làm mọi drip rót vào địa chỉ không có script: không nhánh nào tiêu lại
  được, mất vĩnh viễn, và mọi kiểm tra on-chain vẫn xanh. Là param thì "đúng script hay không" quyết
  ở lúc biên dịch. Không sinh vòng vì `faucet_account` nhận diện pool bằng POOL NFT.
- **Trần tốc độ nằm trong datum POOL, không nằm ở per-DID.** Trần per-DID chỉ chặn được một DID; số
  DID thì không hệ Faucet nào kiểm soát. Trần toàn cục là chốt DUY NHẤT chặn vét pool, và nó phải
  cứng vì **không validator nào trong module đúc lại được tLAMP** — nếu token nạp vào pool là bản đúc
  bởi `tlamp_policy` (one-shot) thì cạn là **bất khả hồi**; nếu là bản đúc bởi một policy còn đúc được
  thì nạp lại là chuyện vận hành. Thiết kế lấy giả định khắt khe hơn. Ở v3.0, cooldown chỉ là tiện
  lợi kế toán vì một DID mở được nhiều account song song (điểm treo `[FAUCET-ACCT-UNIQUE]`); v3.1
  đóng đường `ClaimOpen` của điểm đó bằng sổ `opened_root` (INV-ONE-ACCT), và đóng đường đúc ACCT NFT
  ngoài `ClaimOpen` (`TopUpPool`, `ClaimAgain` kèm `MintAccount`) bằng `C-MINT-ONLY-OPEN-1/2` +
  `C-RECL-BURN-2` — [MATH](./Math-Spec.md) v3.1 §6a.1. Từ đó cooldown là ràng buộc THẬT trên một DID.
- **Sổ một-DID-một-account là MPF trong datum pool, không phải danh sách, không phải NFT phụ.** Validator
  không thấy UTxO nào khác đang sống, nên "DID này đã có account chưa" chỉ trả lời được bằng một cấu
  trúc chứng minh được trong chính tx. Giữ cả tập khoá trong datum thì chi phí mỗi lượt spend tăng theo
  số DID tới lúc vượt trần ex-unit và pool chết vĩnh viễn; MPF giữ 32 byte gốc và chi phí kiểm bằng
  chứng theo độ sâu (logarit số khoá). Giá phải trả: `faucet_pool` lớn lên ≈ **6,2 KB** (6.213 byte
  compiled, đo từ `plutus.json`), và bên dựng tx phải có danh sách account đang sống để sinh bằng chứng.
  Mọi lượt `ClaimOpen`/`Reclaim` ghi cùng một gốc nên hai lượt đồng thời tranh chấp nhau — vốn đã có vì
  pool là singleton.
- **`max_claims_per_window` BẤT BIẾN sau deploy, không có `Reconfigure`.** Một redeemer sửa cấu hình
  là một cửa cần authority, và authority trên một singleton giữ toàn bộ tLAMP là bề mặt lớn hơn cái
  nó mua. Đổi trần = deploy pool mới. Giá phải trả cho lựa chọn này: một con số gõ nhầm ở giây deploy
  là bất khả hồi — nên `C-MP-7` + `max_claims_ceiling = 100` tồn tại.
- **Tách `TopUpPool` khỏi `Reclaim`.** Hai ý định khác nhau, và cả hai phải tốn thứ gì đó: `Reclaim`
  đòi đúng một account input, `TopUpPool` đòi nạp ≥ `drip` và cấm account input. Gộp lại thì nhánh
  nạp mượn được đường thu hồi, và `Reclaim` thành cửa spend rỗng permissionless trên một singleton.
- **`reclaim_epochs_const = 72` cửa sổ (≈ 360 ngày với cửa sổ 5 ngày; 72 ngày trên Preview), hằng
  compile-time.** v3.0 dùng 1001 (≈ 13,7 năm), lấy theo con số của drip chứ không theo một khoảng thời
  gian — trên thực tế là "không bao giờ thu hồi". Với INV-ONE-ACCT, thu hồi là đường DUY NHẤT trả khoá
  một DID về sổ, nên ngưỡng phải nằm trong tầm đời một mạng test. Giữ hằng compile-time để keeper
  không phải đọc datum pool qua reference input. Đổi con số này là đổi một hằng giao thức (đổi hash
  `faucet_account`).
- **Native one-shot FT, KHÔNG CIP-68 (MVP)**: CIP-68 cần cặp ref-NFT(100) + user-token(333) +
  validator metadata → nhiều UTxO/ExUnit, lệch mục tiêu tối ưu eUTXO cho token test. Mục tiêu module =
  test **tính năng** LAMP (claim/treasury/governance), không phải metadata registry. Fixed-supply đạt
  bằng one-shot, độc lập chuẩn metadata. Metadata ví/explorer dùng CIP-25 tx metadata (label 721) ở
  bước deploy nếu cần — KHÔNG bắt buộc MVP ([CONTRACT](./CONTRACT.md) v3.1 §2). Policy mainnet thật
  KHÁC policy tLAMP → không tạo nợ kỹ thuật.
