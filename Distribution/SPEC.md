# LampDistribution — Spec phân bổ LAMP (Capped Drop)

**Doctype:** MagicLamp Protocol — Onchain Spec
**Version:** v2 "Capped Drop" (thay Drop Lottery v0.1)
**Updated:** 2026-06-06
**Nguồn chuẩn (interface contract):** [`CONTRACT-CappedDrop.md`](./CONTRACT-CappedDrop.md)

> **Đã thay cơ chế.** Bản v0.1 dùng **Probabilistic Drop Lottery** (random + Merkle +
> committee nonce). Bản này thay bằng **Capped Drop** — tất định, O(1), permissionless,
> không random/merkle/committee-chọn-winner. Lý do thay: Lottery có 2 lỗ hổng (proof hết
> hạn → mất quyền redeem; committee nonce grinding). Xem [`SPEC-CappedDrop-FEAT.md`](./SPEC-CappedDrop-FEAT.md) §0.

Hai tài liệu con đặc tả đầy đủ:

- **Hành vi:** [`SPEC-CappedDrop-FEAT.md`](./SPEC-CappedDrop-FEAT.md) — entitlement → drip →
  redeem; ví nhỏ (`E≤D` nhận hết)/ví lớn (nhỏ giọt); hooks DAO multi-drop/pause (post-MVP).
- **Chứng minh:** [`SPEC-CappedDrop-MATH.md`](./SPEC-CappedDrop-MATH.md) — vested đơn điệu +
  cap `E`; số epoch `⌈E/D⌉`; đa-claim cộng dồn; entitlement bảo toàn.

---

## 1. Mô hình (CONTRACT §1)

- Mỗi account = 1 **ClaimAccount UTxO** với **entitlement `E`** (tổng LAMP được phân bổ).
- Mỗi epoch mở tối đa `drops_per_epoch` drop, mỗi drop ≤ `D` LAMP. **MVP `drops_per_epoch = 1`.**

```
vested(t)  = min( E , D · drops_per_epoch · max(0, t − t0) )      (t0 = start_epoch)
redeemable = vested(t) − redeemed
```

- `E < D` → nhận hết ngay epoch đầu; `E > D` → nhỏ giọt `D`/epoch tới hết (`⌈E/D⌉` epoch).
- **Permissionless:** account tự tính `vested` on-chain khi redeem, không proof/committee chọn.
- **Entitlement bảo toàn:** bỏ lỡ epoch KHÔNG mất quyền (vested cộng dồn từ `t0`).

---

## 2. Datum `ClaimAccount` (CONTRACT §2)

```aiken
type ClaimAccountDatum {
  owner            : ByteArray,   // PKH chủ ví
  entitlement      : Int,         // E — tổng LAMP được phân bổ (cố định khi genesis/claim)
  redeemed         : Int,         // đã nhận tích lũy (oil)
  start_epoch      : Int,         // t0
  drops_per_epoch  : Int,         // MVP = 1 (DAO chỉnh per-DID ở v.sau)
}
```

**BỎ so với v0.1:** `won_cumulative`, merkle proof, mọi field lottery, Randomness/MerkleRoot
beacon, `pparam` lottery engine.

---

## 3. Beacon `DropParam` (CONTRACT §3)

- **BỎ** Randomness beacon + MerkleRoot beacon.
- **GIỮ 1 beacon tham số:** `DropParam { drop_value: Int (D), … }` — committee/DAO post (như
  P-beacon cũ). `drops_per_epoch` mặc định 1, nằm ở datum account (DAO override per-DID sau).
- Redeem đọc `D` qua **reference input** (không consume beacon).

---

## 4. Redeem (`claim_account.spend`, redeemer `Redeem`) — CONTRACT §4

Validator ÉP:

1. `vested = min(E, D · drops_per_epoch · (current_epoch − start_epoch))`; `D` từ `DropParam`
   reference input, `current_epoch` từ validity range.
2. `amount = vested − redeemed`, yêu cầu `amount > 0`.
3. Out datum: `redeemed' = redeemed + amount`; `owner/entitlement/start_epoch/drops_per_epoch`
   bất biến.
4. Treasury nhả đúng `amount` LAMP cho `owner`; `treasury_out.value = treasury_in.value −
   amount` (bảo toàn value, tái dùng `treasury.ak`, **không burn**).
5. Chống double-satisfaction: đếm theo **payment script hash** (fix C1/C2/M1).

Owner ký (`tx.extra_signatories`). Không cần committee, không proof, không nonce.

---

## 5. Invariants (normative — map test)

Hành vi: bảng F-* trong [`SPEC-CappedDrop-FEAT.md`](./SPEC-CappedDrop-FEAT.md) §7.
Toán: bảng M-* trong [`SPEC-CappedDrop-MATH.md`](./SPEC-CappedDrop-MATH.md) §6. Tóm tắt:

| ID | Phát biểu |
|---|---|
| **M-MONO** | `vested` đơn điệu không giảm theo `t`. |
| **M-CAP** | `vested(t) ≤ E` mọi `t`. |
| **M-SUM** | tổng nhận `= vested(t_cuối) ≤ E`, độc lập số lần/lộ trình redeem. |
| **M-EPOCHS** | hết sau `⌈E/(D·drops_per_epoch)⌉` epoch. |
| **F-RDM-3** | treasury nhả đúng `amount`; `tre_out = tre_in − amount`; không burn. |
| **F-RDM-5** | đúng 1 ClaimAccount in + 1 out cùng payment script hash (anti double-satisfaction). |
| **C-MINT-0** | mọi validator `tx.mint == 0` (không validator nào mint/burn LAMP). |

---

## 6. Hooks DAO (post-MVP — CHỪA CHỖ, KHÔNG build MVP) — CONTRACT §5

- **Multi-drop per-DID:** DAO tăng `drops_per_epoch` cho DID uy tín/nhu cầu cao. Gắn
  Governance VP (`LAMP/Governance/VotingPower/CONTRACT.md`) + DID sinh trắc chống sybil.
- **Pause/penalty:** DAO đặt `drops_per_epoch = 0` trong `N` epoch nếu hành vi gây hại.
- MVP chỉ cần `drops_per_epoch` là field datum + đọc được; cơ chế DAO chỉnh = phiên sau.
- Cả 2 hook **không** phá đơn điệu/cap (chứng minh MATH §5.2).

---

## 7. Giữ nguyên từ v0.1 (tái dùng) — CONTRACT §6

ClaimAccount per-wallet UTxO, `treasury.ak` + 3 fix audit C1/C2/M1, e2e harness `04_e2e.ts`,
datum codec base, claim flow committee M-of-N.

**Gỡ bỏ:** `merkle.ak`, randomness logic, `lottery.ts`, `merkle.ts`, `pparam.ts` lottery engine.

---

## 8. Flow test (integration — phải pass)

```
1. Genesis: committee(M/N) gán A: E=40 LAMP; B: E=350 LAMP. DropParam D=100. t0=epoch0.
2. Ví nhỏ A:  epoch1 → vested=40=E → redeem 40. Double-redeem cùng epoch → amount=0 → reject.
3. Ví lớn B:  epoch1 redeem 100; epoch2 redeem 100 (dồn được); … epoch5 vested cap=350.
4. Bảo toàn:  Σ amount ≤ Σ E; treasury_out = treasury_in − Σ amount; mint==0.
5. Anti-DS:   2 ClaimAccount input share stake cred trong 1 tx → reject (payment-hash count).
```

Mỗi bước có Aiken mock-tx test + vitest builder. Chi tiết: FEAT §8, MATH §3–4.
