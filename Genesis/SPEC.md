# Genesis — SPEC (4-POT: split, circulating, seed; tự tấn công + chứng minh)

Bổ trợ `CONTRACT.md`. Phần này: thuật toán chia, chứng minh bảo toàn, mô hình tự-tấn-công đã đóng,
và ánh xạ code ↔ test.

Ký hiệu: `OIL = 1_000_000` (oil/tLAMP). `A = 36_000_000_000 × OIL` (tổng cung, oil).
`BPS = 10_000`. `allocation = [(Distribution, 9500), (Reserve, 500)]`.

---

## §SPLIT — `splitGenesis(total, allocation[])`

```
splitGenesis(total, allocation):
  require total ≥ 0
  require Σ bps ≤ BPS                 # không phân bổ vượt 100%
  require ∀ bps ≥ 0
  shares[i] = ⌊ total × bps[i] / BPS ⌋
  assigned  = Σ shares[i]
  remainder = total − assigned        # ≥ 0 vì Σ bps ≤ BPS ⇒ assigned ≤ total
  shares[0] += remainder              # dồn lẻ vào pot ĐẦU (Distribution)
  return shares
post: Σ shares == total               # (G-SUM) TUYỆT ĐỐI
```

**Chứng minh `Σ shares == total` (G-SUM):**
Sau vòng floor: `assigned = Σ⌊total×bps_i/BPS⌋`. Mỗi floor ≤ giá trị thực ⇒
`assigned ≤ total × (Σbps)/BPS ≤ total` (vì `Σbps ≤ BPS`). Vậy `remainder = total − assigned ≥ 0`.
Cộng remainder vào shares[0]: `Σ shares = assigned + remainder = total`. ∎

**Chứng minh `r = 0` cho cấu hình MagicLamp:** `A = 36e9 × 1e6 = 36e15`.
- Distribution: `36e15 × 9500 / 10000 = 36e15 × 0.95 = 34.2e15` — chia hết (9500/10000 = 19/20,
  `36e15` chia hết 20 vì tận cùng nhiều số 0). `⌊⌋` không cắt gì.
- Reserve: `36e15 × 500 / 10000 = 36e15 × 0.05 = 1.8e15` — chia hết tương tự.
- `assigned = 34.2e15 + 1.8e15 = 36e15 = A` ⇒ `r = 0`. ✔ Không rơi lẻ ở cấu hình thật; thuật toán
  vẫn xử lý `r ≠ 0` (test cố tình tỉ lệ lẻ để chứng minh dồn-remainder đúng).

**Tách thành pot 4 phần (Treasury/Deposits = 0):** `splitGenesis` trả 2 share (Distribution,
Reserve) cho 2 entry allocation; Treasury + Deposits không có entry ⇒ value genesis = 0. Hàm
`genesisPots(total)` gắn nhãn đầy đủ 4 pot.

---

## §CIRC — circulating đa pot

```
potBalance(pot)        = Σ dòng-sổ-tLAMP của pot           # oil
circulating(A, pots[]) = A − Σ potBalance(pot)
```

Bất biến (C-INV): `0 ≤ Σ potBalance ≤ A ⇒ 0 ≤ circulating ≤ A`.
- **Genesis**: `Σ pots = A` (G-SUM) ⇒ `circulating = 0`.
- **Sau vest** (Distribution chi D oil ra ví user): `potBalance(Distribution) ↓ D` ⇒
  `circulating ↑ D`. Token rời pot = vào lưu hành.
- **Sau thu phí Treasury** (collect c oil vào pot Treasury): `potBalance(Treasury) ↑ c` ⇒
  `circulating ↓ c`. Token rời lưu hành (về kế toán Treasury), KHÔNG burn — `A` bất biến.

---

## §SEED — seed mỗi pot (tái dùng Treasury)

Mỗi pot dựng `CustodyDatum` với 1 dòng sổ tLAMP `{bucket_id, tLAMP_policy, tLAMP_name, value(pot)}`
(pot rỗng ⇒ sổ tLAMP rỗng, chỉ giữ reserved_min_ada lovelace). Tự kiểm trước khi build:
`seedDatumOk(value, datum, reserved_min_ada)` (Treasury `collect.ts`) — `value == ledgerValue ⊕
reserved` ∧ `no_dup_lines` ∧ mọi dòng accepted. Ánh xạ thẳng `custody_seed` validator on-chain.

---

## §ATTACK — tự tấn công (mô hình đối kháng, đã đóng)

1. **Rơi token lẻ khi 95/5.** Đòn: tỉ lệ khiến `⌊⌋` cắt → `Σ < total` → token "bốc hơi" khỏi 4
   pot (vi phạm G-SUM, value không bảo toàn). **Đóng:** remainder dồn pot đầu (§SPLIT, chứng minh
   `Σ == total`). Test `split.test.ts`: tỉ lệ lẻ (3333/3333/3334, và 1/1 trên số nguyên tố) →
   khẳng định `Σ == total` và remainder vào pot[0].

2. **Reserve không tách thật khỏi Treasury.** Đòn: nếu Reserve + Treasury chung 1 custody (1 datum
   2 bucket), 1 tx Release "category=Treasury" có thể rút nhầm số dư Reserve (cùng UTxO). **Đóng:**
   4 custody UTxO + 4 **script hash riêng** (`pot_tag`). Chi Treasury đếm input theo *Treasury
   hash* (C-COL-1/C-REL-4) ⇒ KHÔNG thể đưa UTxO Reserve vào cùng nhánh. Test: 4 hash phân biệt
   (`pots.test.ts` dựng 4 datum + kiểm instance_id/pot_tag khác nhau).

3. **circulating sai đa pot.** Đòn: cộng nhầm pot Treasury/Deposits (rỗng) hoặc bỏ sót pot →
   circulating lệch. **Đóng:** định nghĩa cứng `A − Σ pots`; test 3 trạng thái (genesis=0,
   sau-vest>0, sau-thu-phí giảm) + bất biến `0 ≤ circ ≤ A`.

4. **mint dư/thiếu.** Đòn: builder mint ≠ A → tổng cung sai. **Đóng:** builder mint đúng
   `A` oil + 4 NFT; self-check `Σ output tLAMP-value == A` trước khi trả tx; test builder.

5. **token rơi ngoài 4 pot.** Đòn: builder tạo output thừa (ví deploy giữ lại 1 phần) → Σ 4 pot <
   A nhưng mint == A → token kẹt ví. **Đóng:** `planGenesis` ép `Σ_p value(p) == A` (ném lỗi nếu
   lệch) + builder chỉ tạo đúng 4 custody output mang đúng share; test khẳng định Σ output == mint.

6. **seed sổ ≠ value.** Đòn: datum khai value(pot) nhưng custody value khác → kế toán hỏng, Release
   over/under-draw về sau. **Đóng:** G-SEED `seedDatumOk` (tái dùng Treasury seed_value_ok +
   no_dup_lines); test seed pass cho cả pot có token (Distribution/Reserve) lẫn pot rỗng
   (Treasury/Deposits).

7. **NFT pot trùng / thiếu.** Đòn: 2 pot cùng instance_id → không phân biệt được. **Đóng:** 4
   instance_id khác nhau (`DR/RV/TR/DP`), one-shot mint đúng 4 NFT name riêng; test.

---

## §MAP — code ↔ test

| Khái niệm | File | Test |
|---|---|---|
| `splitGenesis`, `genesisPots`, `GENESIS_*` | `offchain/src/split.ts` | `tests/split.test.ts` |
| `circulating`, `potBalance` | `offchain/src/circulating.ts` | `tests/circulating.test.ts` |
| pot datum dựng + seed self-check | `offchain/src/pots.ts` | `tests/pots.test.ts` |
| builder mint A + 4 custody output | `offchain/src/genesisBuilder.ts` | `tests/builder.test.ts` |
| deploy Preview (SUBMIT=false) | `scripts/01_genesis_4pots.ts` | (chạy live, anh chạy) |
| bất biến split onchain (pure) | `onchain/lib/magiclamp/genesis/split.ak` | test trong file |
| wrapper tách-hash + one-shot mint | `onchain/validators/genesis_pot.ak`, `genesis_mint.ak` | test trong file |
