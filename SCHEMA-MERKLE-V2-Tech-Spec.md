# Merkle-airdrop schema C (v2) — Tech-Spec bộ máy chung LAMP

> Nguồn sự thật DUY NHẤT cho leaf/node/slot encoding + thứ tự lá + quy tắc payout của **mọi pot
> Merkle-airdrop** trong hệ (Delegator, MCS, Engage, SPO). Chốt 2026-07-31 theo quyết định anh Aladin
> ("Airdrop + SRCL là một bộ máy, đa vai") + 2 thư AffiSo (29–30/07). aiken-dev + off-chain + AffiSo
> (reward-engine) PHẢI khớp byte-perfect với spec này. Đổi spec = đổi mọi root đã phát → cấm sửa số role.

## 0. Vì sao đổi (schema A/B cũ → C)

- **A (Airdrop cũ):** `leaf = blake2b(0x00 ‖ cbor(address) ‖ amount_be8)` — không epoch, không role,
  owner = full address. Không phân biệt được chiến dịch/vai ⇒ proof pot này tái dùng pot khác.
- **B (SRCL cũ):** `leaf = blake2b(0x00 ‖ epoch_be8 ‖ owner ‖ amount_be8)` — có epoch, không role,
  không campaign.
- **C (chốt):** thêm `campaign_id[32]` (cô lập proof theo chiến dịch) + `role[1]` (cô lập theo vai
  trong cùng chiến dịch) + owner CHUẨN HOÁ 28 byte + `amount_oildrop_be8` (đơn vị oildrop, không
  LAMP nguyên). Hai pot khác campaign/role KHÔNG BAO GIỜ chia sẻ leaf hợp lệ.

## 1. Byte layout (CỐ ĐỊNH, fixed-width — không length-prefix)

```
leaf = blake2b_256( 0x00 ‖ campaign_id[32] ‖ epoch_be8[8] ‖ role[1] ‖ owner[28] ‖ amount_oildrop_be8[8] )
node = blake2b_256( 0x01 ‖ left[32] ‖ right[32] )
slot = blake2b_256( epoch_be8[8] ‖ owner[28] )
```

Tổng payload leaf trước hash = 1 + 32 + 8 + 1 + 28 + 8 = **78 byte** (chưa gồm prefix; prefix 0x00
là byte đầu). Mọi trường fixed-width ⇒ nối thẳng (raw-concat) không mập mờ biên.

| Trường | Rộng | Nghĩa |
|---|---|---|
| prefix leaf | 1 | `0x00` domain-sep (chống second-preimage: leaf ≠ node) |
| `campaign_id` | 32 | `blake2b_256(tên_chiến_dịch_utf8)`. Bake vào validator (PARAM). |
| `epoch_be8` | 8 | epoch big-endian u64. Pot 1-snapshot (Delegator): HẰNG = epoch snapshot (dùng `E_cut`). Pot đa-epoch (SRCL): epoch của từng dòng. |
| `role` | 1 | Delegator=`0x01`, MCS=`0x02`, Engage=`0x03`, SPO=`0x04`. **CẤM đổi số.** |
| `owner` | 28 | credential-hash (blake2b_224). **Delegator = payment key-hash; SPO/SRCL = stake key-hash.** (xem §3) |
| `amount_oildrop_be8` | 8 | lượng oildrop (1 LAMP = 10⁶ oildrop), big-endian u64. |

- prefix node = `0x01`. node = hash(0x01 ‖ left ‖ right) — **KHÔNG sort cặp** (giữ vị trí trái/phải).
- `int → be8`: 8 byte big-endian, giả định `0 ≤ n < 2^64`.

## 2. Thứ tự lá + dựng cây (tất định)

1. **Chuẩn hoá:** với mỗi entry tính `slot = blake2b_256(epoch_be8 ‖ owner[28])`.
2. **Trùng slot → NÉM LỖI CỨNG** (không lặng lẽ chọn — trùng slot = có người mất tiền). Slot trùng
   nghĩa là cùng (epoch, owner) xuất hiện 2 lần trong 1 pot.
3. **Sắp lá TĂNG DẦN theo `slot`** (so sánh byte-lexicographic hex). Tất định, ổn định khi `amount`
   đổi (khác schema A sort theo leafHash — leafHash đổi khi amount đổi).
4. **Ghép đôi theo thứ tự đó**, dựng cây nhị phân từ dưới lên. **Node lẻ cuối → PROMOTE nguyên vẹn**
   lên tầng trên (carry, KHÔNG tự-hash) — giữ đúng quy ước off-chain merkle.ts hiện tại.
5. `MerkleStep/ProofStep{is_left, hash}`: `is_left=True` → sibling bên TRÁI → parent =
   hash(0x01 ‖ sibling ‖ cur); `False` → parent = hash(0x01 ‖ cur ‖ sibling).

## 3. Nghĩa owner theo vai (PER-ROLE — anh chốt 2026-07-31)

Thư AffiSo viết "owner = stake key-hash" cho MỌI vai. **Sửa lại theo quyết định anh:** owner mang
credential PHÙ HỢP với cách pot đó trả tiền / định danh:

| Vai | owner[28] = | Lý do |
|---|---|---|
| **Delegator** (airdrop payout) | **payment key-hash** | pot TRẢ LAMP cho người nhận. Trả vào stake address (reward addr) KHÔNG tiêu được (lỗ#1). payment-cred cho phép push-claim: operator trả hộ vào địa chỉ có đúng payment-cred đó (ví người nhận kiểm soát). |
| **SPO / SRCL** (reward-redirect) | ⚠️ **CHƯA CHỐT — xem §3.1** | (thư AffiSo đề "stake key-hash"; nhưng payout code `srcl_pool` so **payment**-cred ⇒ nếu owner=stake-hash sẽ KHOÁ TIỀN). |
| **MCS / Engage** | theo spec vai đó (chưa hiện thực) | khoá vào spec khi dựng validator vai đó. |

⇒ **owner KHÔNG đồng nhất một loại credential toàn hệ.** Mỗi role bake nghĩa owner riêng; role byte
trong leaf đã cô lập nên không nhầm được.

### 3.1 SRCL owner-tier — OPEN, hoà giải TRƯỚC khi mở claim SRCL (auditor CAO 2026-07-31)

Auditor (cardano, PoC verify) chỉ ra: `srcl_pool.ak` payout dùng `is_owned_by` = so **payment_credential
== owner**. Nếu builder set owner = **stake** key-hash (như thư AffiSo + chủ trương per-role ban đầu),
LAMP chỉ trả được vào enterprise-addr(stake_hash) — **ví thường (payment≠stake, CIP-1852) nhận 0** ⇒
khoá tiền + griefer claim-hộ đốt slot → nạn nhân mất luôn entitlement.
- **KHÔNG do schema C sinh** (leaf on-chain chỉ concat bytes owner, không phân biệt tier); là drift
  spec↔code có sẵn. **KHÔNG chặn seed cơ học** nhưng hiện lỗi ở CLAIM (tx vẫn validate → mất âm thầm).
- **Khuyến nghị auditor (option 1):** SRCL leaf owner = **payment key-hash** (join stake→payment như
  builder Delegator v2), giữ payout payment-cred → self-consistent, KHÔNG đổi validator. `types.ak:79`
  đã ghi owner="payment-credential hash" — tức code SRCL vốn giả định payment-cred; chính thư AffiSo +
  bảng trên là chỗ lệch. ⇒ nhiều khả năng "SRCL=stake-key-hash" là nhầm giữa vai KÝ reward-redirect
  (stake key) với ĐÍCH trả LAMP (payment key). **Cần anh xác nhận** trước khi hiện thực builder SRCL cho seed.
- Option 2 (nếu thật muốn owner=stake): đổi payout so `stake_credential` + trả vào base/reward addr — đổi validator, đắt hơn.

## 4. Quy tắc payout on-chain (pot Delegator)

Datum `AirdropPool` GIỮ NGUYÊN (quyết định 2 — không đổi schema, không thêm redeemer). campaign_id,
snapshot_epoch (=E_cut), role = **PARAM validator** (bake tại deploy). Trong redeemer `Claim{claimer,
amount, proof}`:

1. `owner := payment_credential_hash(claimer)` — trích 28-byte hash từ `claimer.payment_credential`
   (VerificationKey(h) hoặc Script(h) → lấy `h`).
2. `leaf := leaf_hash_v2(campaign_id, snapshot_epoch, role, owner, amount)`.
3. Kiểm `merkle.verify(merkle_root, leaf, proof)` (proof dẫn leaf → root).
4. GIỮ NGUYÊN mọi ràng buộc cũ: 1 POOL in/out theo NFT, `now_upper < deadline`, pool value =
   pool_in − amount LAMP, datum bất biến trừ `claimed_count += 1`, **output trả ≥ amount LAMP tới
   ĐỊA CHỈ `claimer`** (`o.address == claimer`), consume + burn đúng claim-slot NFT name=`leaf`.

**Tính an toàn (per-role Delegator):** leaf chỉ ràng buộc payment-cred, không ràng full address.
Ai có proof chỉ có thể chuyển LAMP tới địa chỉ có ĐÚNG payment-cred đó (payment key của người nhận
kiểm soát) — kẻ khác không lấy được. slot-NFT one-shot vẫn chống double-claim độc lập. Griefing tối
đa: đẩy vào enterprise-addr(pkh) (không stake part) — vẫn người nhận tiêu được, chỉ mất phần thưởng
stake tí hon của UTxO đó tới khi họ dời. Chấp nhận được; nếu muốn siết: ép output là enterprise-addr.

## 5. Byte parity (BẮT BUỘC)

Mỗi module PHẢI có 1 test đối chiếu byte-perfect on-chain ↔ off-chain (mẫu `parity_offchain_leaf`
hiện có). Quy trình: aiken-dev tính vector chuẩn TỪ on-chain (`aiken check` in ra / test hardcode),
off-chain + AffiSo reward-engine phải khớp CHÍNH hash đó.

**Test-vector chuẩn (aiken-dev điền giá trị thật sau khi `aiken check`):**
```
campaign_id = blake2b_256("LAMP-Delegator-Airdrop-1")   // = 0x________ (điền)
epoch       = 637            role = 0x01 (Delegator)
owner       = 0xa0a0…a0 (28 byte payment key-hash mẫu)
amount      = 27_780_000 oildrop
=> leaf_hash_v2 = 0x________ (aiken tính, off-chain khớp)
=> slot        = blake2b_256(epoch_be8 ‖ owner) = 0x________
```

## 6. Migration & phạm vi đợt này

- **Airdrop:** merkle.ak (leaf A→C, thêm param campaign_id/epoch/role vào `airdrop_pool` +
  helper trích payment-cred) + off-chain merkle.ts (leaf C, sort theo slot, dup-slot throw) +
  builder v2 (owner=payment-key-hash, role=1, epoch=E_cut, campaign_id) + toàn bộ test.
- **SRCL:** merkle.ak (B→C: thêm campaign_id + role=SPO/…; owner giữ stake-key-hash) + gộp
  `srcl_stake.ak` bản B + sửa README (mô tả bản B) + vá `computeEntitlements` trùng tên.
- **Chưa làm đợt này:** MCS/Engage/SPO validator (chưa tồn tại) — chỉ khoá role-map + checklist
  "pot mới PHẢI bake campaign_id + role đúng bảng §1" trước khi ai clone engine.
- Datum `AirdropPool` KHÔNG đổi. Redeemer KHÔNG thêm. `owner` cross-pot: khi kế toán liên chương
  trình (chống trả trùng 1 người) phải chuẩn hoá theo role (Delegator payment-cred ≠ SPO stake-cred).

## 7. Nguồn dẫn được
- Layout: thư `AffiSo-reply-schema-lock-va-filter-owner-2026-07-29` + `AffiSo-reply-da-cap-patched-va-merkle-oildrop-2026-07-30`.
- owner per-role: quyết định anh Aladin 2026-07-31 (topic `public-release-readiness.md` §PHIÊN 2026-07-31).
- Ranh giới tầng: AffiSo lọc tư cách khi dựng `StakeEntry[]`; LAMP `computeEntitlements` chỉ lọc
  `stake>0`, KHÔNG nhét ngưỡng 1000 ADA.
