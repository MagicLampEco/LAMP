# Fix CRITICAL — giả mạo account trong Allocation (claim_account/treasury)

**Ngày:** 2026-07-24
**Nhánh:** commit thẳng lên `feat/launch-etd-airdrop-srcl` (PR #17)
**Module:** `Allocation/` (ETD #13 dùng lại nền này → tự hưởng fix)
**Trạng thái:** design approved, chờ plan

## 1. Lỗ hổng

`Allocation/onchain/validators/claim_account.ak` + `treasury.ak` cho phép **giả mạo account**:

- Account là UTxO ở địa chỉ script claim_account mang `ClaimAccountDatum { owner, entitlement, redeemed, start_epoch, drops_per_epoch, channel_id }`. **Không có token nào xác thực UTxO này được committee bảo chứng.**
- `Redeem` là permissionless, tính `vested = min(E, D · drops_per_epoch · (current_epoch − start_epoch))` **thuần từ datum** — mà datum do người tạo account đặt.
- `treasury.ak` release cho *bất kỳ* UTxO ở `claim_account_hash` miễn `channel_id` khớp.

**Khai thác:** attacker trả UTxO vào script claim_account với datum bịa `{ owner: mình, entitlement: khủng, redeemed: 0, start_epoch: quá khứ, drops_per_epoch: khủng, channel_id: <kênh có tiền> }` → gọi Redeem → treasury (channel_id khớp) release LAMP, **không cần committee Claim nào**. Blocker mainnet — chặn trước khi nhánh chạm giá trị thật.

**Không dính:** Airdrop (`airdrop_pool.ak`) và Distribution — cả hai Merkle-gated + POOL/beacon NFT, amount bị chặn bởi merkle_root committee post. Chỉ Allocation dùng vested-from-datum.

## 2. Nguyên tắc fix

Account chỉ hợp lệ khi mang **NFT xác thực do committee bảo chứng lúc genesis**. Không NFT → không Redeem, treasury không release. Chặn tại điểm tạo account — nơi mọi caller (kể cả ETD) đi qua. Giữ nguyên UX vested-from-datum (đã chốt: yêu cầu cứng).

Bất biến mới (đánh số theo phong cách SPEC hiện có, nhánh `C-ACC-*`):
- **C-ACC-1** — Mọi ClaimAccount UTxO hợp lệ mang đúng 1 token `(account_nft_policy, blake2b_256(owner ‖ channel_id))`.
- **C-ACC-2** — Mint account NFT ⇒ tx có `committee threshold` chữ ký (⌈2N/3⌉).
- **C-ACC-3** — Genesis account khởi `redeemed == 0`; NFT vào output ở Script credential claim_account, datum owner/channel khớp name.
- **C-ACC-4** — Claim và Redeem đều ép `acc_in` mang account NFT đúng name; value-preservation mang NFT sang out.
- **C-ACC-5** — Treasury release ép ClaimAccount input kèm mang account NFT (defense-in-depth).

## 3. Thành phần

### ① `Allocation/onchain/validators/account_nft.ak` (mới)
Minting policy, nhân bản cấu trúc `budget_nft.ak` nhưng gate bằng **committee** thay vì chỉ one-shot:

- Param: `committee : List<ByteArray>`, `threshold : Int`.
- `mint(redeemer, policy_id, tx)`:
  - `expect count_committee_sigs(committee, tx.extra_signatories) >= threshold`  *(C-ACC-2 — thứ chặn forgery)*
  - Mint **đúng 1** token của policy này (`dict.size(own_tokens) == 1`).
  - Token name = `blake2b_256(owner ‖ channel_id)` — owner/channel đọc từ datum của output nhận NFT.
  - NFT vào **đúng 1 output** (`expect [acc_out] = nft_outs`) ở Script credential (`util.is_at_script_cred`), datum là `ClaimAccountDatum` với `owner`/`channel_id` khớp name và `redeemed == 0`. *(C-ACC-1, C-ACC-3)*
  - `else(_) -> fail`.

> Ceiling (ponytail): committee "bless" 2 account cùng owner/kênh = vấn đề governance của committee (M-of-N là trust anchor), KHÔNG chống trong v1. Ghi comment `// ponytail:` ở validator.

### ② `Allocation/onchain/validators/claim_account.ak`
- Thêm param `account_nft_policy : ByteArray`.
- Sau khi lấy `acc_in`/`out_datum`, ép (áp cho **cả** Claim và Redeem):
  ```
  let acc_name = blake2b_256(concat(datum.owner, datum.channel_id))
  expect assets.quantity_of(acc_in.value, account_nft_policy, acc_name) == 1
  ```
  *(C-ACC-4)* — `acc_out.value == acc_in.value` sẵn có → NFT tự bảo toàn sang out.

### ③ `Allocation/onchain/validators/treasury.ak`
- Thêm param `account_nft_policy`. Đọc `owner`/`channel_id` từ datum của ClaimAccount input, dẫn `acc_name = blake2b_256(owner ‖ channel_id)`, ép `quantity_of(ca_in.value, account_nft_policy, acc_name) == 1`. *(C-ACC-5, defense-in-depth)*

### ④ Off-chain (`Allocation/offchain/src/`)
- `setupBuilder.ts` (hoặc builder genesis account mới): tx committee co-sign, consume/định danh, **mint account NFT** (name = blake2b(owner‖channel)), tạo claim_account UTxO datum khởi tạo (`redeemed = 0`), gửi NFT vào đó.
- `claimBuilder.ts` / `redeemBuilder.ts`: đảm bảo account NFT được mang qua input→output (value preserved).
- `datum.ts` / `constants.ts`: không đổi datum shape; thêm helper `accountNftName(owner, channel)` = blake2b_256 (dùng `@noble/hashes/blake2b`, khớp on-chain byte-perfect).

### ⑤ Tests
On-chain (`claim_account_test.ak` / `account_nft_test.ak` / `treasury` tests):
- **REGRESSION cốt lõi:** account giả (UTxO ở script, datum fat, KHÔNG account NFT) → Redeem `fail`.
- Genesis mint thiếu committee threshold → mint `fail` (C-ACC-2).
- NFT name sai (owner/channel không khớp) → `fail` (C-ACC-1/3).
- Genesis `redeemed != 0` → `fail` (C-ACC-3).
- Happy: genesis committee-signed → mint OK → Redeem OK.
- Treasury: release cho account không NFT → `fail` (C-ACC-5).
- NFT bảo toàn qua Claim và Redeem.

Off-chain (vitest): builder genesis mint đúng name; redeem/claim mang NFT qua; `accountNftName` khớp vector on-chain (cross-check như `leaf_hash_xcheck_offchain` của Distribution).

## 4. Kiểm chứng
`cd Allocation/onchain && aiken check` (thêm test C-ACC-*, giữ 67 cũ xanh) + `cd Allocation/offchain && npx vitest run`. Cả hai xanh 0 fail. Xác nhận ETD (#13) redeem vẫn chạy trên nền đã vá.

## 5. Ngoài phạm vi
- Không đổi mô hình vesting (giữ vested-from-datum).
- Không chống committee double-bless (ceiling §3①).
- Không đụng Airdrop/Distribution (đã an toàn).
- Không tách module (việc riêng, sau khi fix ổn).
