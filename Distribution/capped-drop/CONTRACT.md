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
6. (Tùy chọn anti-spam) ép `current_epoch > last_redeem_epoch` — chỉ thêm nếu cần; MVP có thể bỏ vì
   vested cộng dồn đã chặn tổng.

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

## 8. Spec + build (song song bám CONTRACT)

- **SPEC**: viết FEAT (hành vi: entitlement → drip → redeem, ví nhỏ/lớn, hooks DAO) + MATH (chứng minh
  vested đơn điệu/bounded/cap, ⌈E/D⌉ epoch, đa-claim cộng dồn) + cập nhật `SPEC.md`/`README` (bỏ lottery).
- **ONCHAIN**: rework `claim_account.ak` (Redeem vested), `DropParam` beacon, **gỡ** `merkle.ak`/randomness;
  Aiken test (vested đơn điệu, cap E, đa-claim, E<D nhận hết, double-satisfaction reject).
- **OFFCHAIN**: gỡ `lottery.ts`/`merkle.ts`, `redeemBuilder` tính vested, datum codec mới; vitest.
