# Distribution — CONTRACT v2 "Capped Drop" (tất định, THAY Drop Lottery)

**Trạng thái:** anh duyệt khung 2026-06-05. Đây là **interface contract** thay cơ chế Lottery cũ.
Mọi spec/code phải bám file này. Bỏ random/merkle/committee-chọn-winner.

> Lý do thay: Lottery mang 2 lỗ hổng (proof hết hạn → mất quyền redeem; committee nonce grinding).
> Capped Drop tất định, O(1), giữ nguyên entitlement, và biến "drop" thành van điều khiển DAO.

## 1. Mô hình

- Mỗi account = 1 **ClaimAccount UTxO** với **entitlement `E`** (tổng LAMP được phân bổ).
- Mỗi epoch mở tối đa `drops_per_epoch` drop; mỗi drop trị giá ≤ `D` LAMP. **MVP: `drops_per_epoch = 1`.**
- Lượng đã mở khoá (vested) cộng dồn, chặn trên bởi `E`:

```
vested(t) = min( E , D · drops_per_epoch · max(0, t − t0) )      (t0 = start_epoch)
redeemable = vested − redeemed
```

- Hệ quả: `E < D` → nhận hết ngay epoch đầu; `E > D` → nhỏ giọt `D`/epoch tới hết (⌈E/D⌉ epoch).
- **Permissionless:** account tự tính `vested` on-chain khi redeem, không cần proof/committee chọn.
- **Entitlement bảo toàn:** bỏ lỡ epoch KHÔNG mất quyền (vested cộng dồn). Giải lỗ hổng lottery.

## 2. Datum `ClaimAccount` (thay field lottery)

```
ClaimAccount {
  owner            : ByteArray,   // PKH chủ ví
  entitlement      : Int,         // E — tổng LAMP được phân bổ (cố định khi genesis/claim)
  redeemed         : Int,         // đã nhận tích lũy
  start_epoch      : Int,         // t0
  drops_per_epoch  : Int,         // MVP = 1 (DAO chỉnh per-DID ở v.sau)
}
```
**BỎ:** `won_cumulative`, merkle proof, mọi field lottery.

### 2b. Datum `Treasury` + sổ cái solvency

```
Treasury {
  committee_hash         : ByteArray,  // bảo toàn (C-TRE-2)
  outstanding_entitlement : Int,        // SỔ CÁI solvency: SỐ CÒN NỢ = Σ(E − redeemed) (oildrop)
}
```
- Treasury UTxO mang **NFT authenticity "TRSY"** (policy `treasury_nft`, one-shot, supply = 1
  TUYỆT ĐỐI) → singleton toàn cục, chống treasury giả cùng script-hash.
- `outstanding_entitlement` = **số còn nợ người dùng**: `+granted` khi GrantEntitlement,
  `−released` khi ReleaseForRedeem — hai vế đi cặp với pool.
  > ⚠ **Sửa 2026-08-12.** Bản đầu định nghĩa trường này là *tổng cấp suốt vòng đời* (chỉ tăng,
  > bất biến khi redeem) và vẫn so với pool **hiện tại**. Vì pool giảm mỗi lần redeem mà sổ cái
  > thì không, `≤ pool` siết dần đến **bế tắc**: quỹ đã trả hết nợ, còn nguyên tiền, vẫn không cấp
  > thêm được — và lần cấp cuối của cả đợt phân phối đòi pool ≥ tổng lịch sử, điều không thể với
  > cung cố định. Tính an toàn muốn có (`Σ(E − redeemed) ≤ pool`) chỉ cần sổ cái theo dõi CÒN NỢ.

## 3. Beacon

- **BỎ** Randomness beacon + MerkleRoot beacon.
- **GIỮ 1 beacon tham số:** `DropParam { drop_value: Int (D), … }` — committee/DAO post (như P-beacon cũ).
  `drops_per_epoch` mặc định 1, nằm ở datum account (DAO override per-DID sau).

## 4. Redeem (`claim_account.spend`, redeemer `Redeem`)

Validator ÉP:
1. `vested = min(entitlement, D · drops_per_epoch · (current_epoch − start_epoch))`, đọc `D` từ
   `DropParam` beacon qua **reference input**, `current_epoch` từ validity range.
2. `amount = vested − redeemed`, yêu cầu `amount > 0`.
3. Out datum: `redeemed' = redeemed + amount`, các field khác bất biến (owner/entitlement/start_epoch).
4. Treasury nhả đúng `amount` LAMP cho `owner`; **bảo toàn value** treasury (tái dùng treasury.ak,
   `treasury_out.value = treasury_in.value − amount`), **không burn**.
5. Chống double-satisfaction: đếm theo **payment script hash** (bài học C1/C2/M1).
6. **TRSY binding (C-SOLV-4/5):** treasury co-spend PHẢI là treasury canonical mang đúng 1 NFT
   "TRSY", **ngụ tại một script** (không phải ví) và **ra đúng địa chỉ đã vào** (C-SOLV-5);
   sổ cái `outstanding_entitlement` **giảm đúng `amount`** khi redeem (C-SOLV-3). Đối xứng với
   Claim path — chống redeem rút từ treasury giả.
7. (Tùy chọn anti-spam) ép `current_epoch > last_redeem_epoch` — chỉ thêm nếu cần; MVP có thể bỏ vì
   vested cộng dồn đã chặn tổng.

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

## 5. Hooks DAO (post-MVP — CHỪA CHỖ, KHÔNG build MVP)

- **Multi-drop per-DID:** DAO tăng `drops_per_epoch` cho DID uy tín/nhu cầu cao (Org hoạt động liên
  tục → nhiều drop/epoch). Gắn Governance VP (C3 uy tín) + DID sinh trắc (chống sybil chia nhiều DID).
- **Pause/penalty:** DAO đặt `drops_per_epoch = 0` trong N epoch nếu hành vi gây hại.
- MVP chỉ cần để `drops_per_epoch` là field datum + đọc được; cơ chế DAO chỉnh nó = phiên sau.

## 6. Giữ nguyên (tái dùng, KHÔNG vứt)

- ClaimAccount per-wallet UTxO (QĐ5), `treasury.ak` + 3 fix audit C1/C2/M1, e2e harness `04_e2e.ts`,
  datum codec base, claim flow committee (M-of-N).

## 7. Bất biến (mọi spec/code)

- LAMP **không burn**; treasury bảo toàn value tuyệt đối.
- `vested` **đơn điệu tăng** theo `t`, **cap `E`** (không vượt entitlement).
- Đa-claim: `redeemed` cộng dồn, luôn `vested − redeemed ≥ 0`, tổng nhận ≤ `E`.
- `D`, `drops_per_epoch` là **tham số** (committee/DAO), KHÔNG hardcode.
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
