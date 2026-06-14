# Genesis — MATH (Cơ sở toán)

**Trạng thái:** draft 2026-06-09 (bám [`CONTRACT.md`](./CONTRACT.md) — xương sống lazy-mint).
Tài liệu này KHÔNG mâu thuẫn CONTRACT; nó **chứng minh hình thức** các bất biến mà CONTRACT §5
phát biểu, và truy mỗi định lý về **dòng code thật** (file:dòng).

> Đơn vị toàn bộ: **oil** (1 tLAMP = 10^6 oil). Aiken `Int` là bigint vô hạn → **KHÔNG tràn số**
> (`constants.ak:4` ghi rõ). Mọi số học dưới đây trên ℤ.

---

## 0. Ký hiệu

| Ký hiệu | Nghĩa | Nguồn |
|---|---|---|
| `S = (d, r, D, R)` | SupplyState input: `(dist_minted, reserve_minted, dist_cap, reserve_cap)` | `types.ak:9` |
| `S' = (d', r', D', R')` | SupplyState output (datum mới) | `lamp_mint.ak:50` |
| `Δ` | `quantity_of(tx.mint, lamp_policy, tLAMP_name)` — lượng tLAMP mint trong tx | `lamp_mint.ak:54` |
| `M(S)` | `d + r` = minted_total | `supplyState.ts:20` |
| `CAP` | `D + R = 36_000_000_000_000_000` oil | `constants.ak:22` |
| `D₀, R₀` | `34_200_000_000_000_000`, `1_800_000_000_000_000` (95% / 5%) | `constants.ak:16,19` |

Hằng số: `D₀ + R₀ = CAP` (`constants.ak:24` test `caps_sum_to_total`); `CAP = 36e9 × 10^6`
(`constants.ak:28` test `total_is_36b_lamp`).

---

## 1. Tiên đề transition (luật ép trong `lamp_mint`)

Mọi tx mint tLAMP hợp lệ thỏa ĐỒNG THỜI (CONTRACT §5; `lamp_mint.ak:34–94`):

| # | Tiên đề | Code |
|---|---|---|
| **T1** | đúng 1 input + đúng 1 output mang thread NFT; thread NFT không mint/burn; output cùng địa chỉ | `lamp_mint.ak:39–47` |
| **T2** | `Δ > 0` | `lamp_mint.ak:55` |
| **T3** | policy tlamp mint đúng 1 asset name (= tLAMP) | `lamp_mint.ak:56` |
| **T4** | `D' = D ∧ R' = R` (caps bất biến) | `lamp_mint.ak:59–60` |
| **T5a** | nếu `DistributionVest`: `d' = d + Δ ∧ r' = r` | `lamp_mint.ak:67–69` |
| **T5b** | nếu `ReserveDraw`: `r' = r + Δ ∧ d' = d` | `lamp_mint.ak:70–72` |
| **T6** | `d' ≥ d ∧ r' ≥ r` (monotonic guard) | `lamp_mint.ak:78–79` |
| **T7** | `d' ≤ D' ∧ r' ≤ R'` (cap enforce) | `lamp_mint.ak:82–83` |
| **T8** | `count_sigs(authority, extra_signatories) ≥ threshold` | `lamp_mint.ak:92` |

Spend tầng 3 (`supply_state.ak:29–30`): tx spend SupplyState hợp lệ ⟺ `Δ > 0`.

Mint tầng 1 (`thread_nft.ak:22–26`): mint thread NFT hợp lệ ⟺ consume `genesis_ref` ∧ đúng 1 name
∧ `quantity_of(SUPPLY) = 1`.

---

## 2. Định lý CAP (tổng phát hành không vượt 36 tỷ)

> **Định lý 2.1 (Cap-bound từng quota).** Sau mọi transition hợp lệ: `d' ≤ D₀` và `r' ≤ R₀`.

*Chứng minh.* T4 ⇒ `D' = D`. Nếu giả thiết quy nạp `D = D₀` (giữ ở Định lý 2.3), thì T7 cho
`d' ≤ D' = D₀`. Tương tự `r' ≤ R₀`. ∎

> **Định lý 2.2 (Cap-bound tổng).** `M(S') = d' + r' ≤ CAP = 36e9 × 10^6` oil.

*Chứng minh.* Cộng hai bất đẳng thức Định lý 2.1: `d' + r' ≤ D₀ + R₀ = CAP`
(`constants.ak:24`). ∎

> **Định lý 2.3 (Cap bất biến suốt vòng đời).** Với chuỗi transition `S₀ → S₁ → … → Sₙ` bắt đầu
> từ genesis `S₀ = (0, 0, D₀, R₀)`, mọi `Sₖ` có `Dₖ = D₀ ∧ Rₖ = R₀`.

*Chứng minh.* Quy nạp. Cơ sở: `S₀` đặt caps = `D₀, R₀` (`supplyState.ts:11–16`
`genesisSupplyState`). Bước: T4 cho `Dₖ₊₁ = Dₖ`, `Rₖ₊₁ = Rₖ`. ∎

**Hệ quả (vector A1, A9).** Không transition nào nới cap (T4 chặn A9) hay mint vượt cap (T7 chặn
A1). Biên `= cap` được phép (T7 dùng `≤`): test `distvest_exact_cap_boundary` (`lamp_mint.ak:188`)
mint tới ĐÚNG `dist_cap` pass; `mint_exceed_dist_cap` (`lamp_mint.ak:203`) vượt 1 oil fail.

---

## 3. Định lý MONOTONIC (bộ đếm chỉ tăng)

> **Định lý 3.1.** Sau mọi transition hợp lệ: `M(S') > M(S)` (tổng phát hành tăng ngặt).

*Chứng minh.* T5a hoặc T5b cho `M(S') = M(S) + Δ` (đúng một nhánh tăng, nhánh kia giữ nguyên).
T2 cho `Δ > 0`. Vậy `M(S') = M(S) + Δ > M(S)`. ∎

> **Định lý 3.2 (no rollback từng quota).** `d' ≥ d ∧ r' ≥ r`.

*Chứng minh.* T6 ép trực tiếp. Dư thừa-có-chủ-đích: đã suy được từ T5+T2 (nhánh tăng cộng `Δ>0`,
nhánh kia bằng), nhưng T6 là guard tường minh chống mọi rollback (CONTRACT §5 luật 6; chặn A4).
Test `mint_rollback_dist` (`lamp_mint.ak:235`) đặt `d' < d` → fail (vi phạm cả T5a lẫn T6). ∎

**Hệ quả monotonic toàn cục.** Vì mỗi transition chỉ tăng và `genesis_ref` one-shot bảo đảm chỉ
một chuỗi SupplyState duy nhất (Định lý 5.1), `M` đơn điệu tăng theo toàn bộ lịch sử chain ⇒
"fixed-supply" = `sup M ≤ CAP` (Định lý 2.2).

---

## 4. Định lý KHÓA QUOTA (Distribution ⊥ Reserve)

> **Định lý 4.1 (quota độc lập).** Một transition `DistributionVest` KHÔNG đổi `reserve_minted`;
> một `ReserveDraw` KHÔNG đổi `dist_minted`.

*Chứng minh.* T5a: `DistributionVest ⇒ r' = r`. T5b: `ReserveDraw ⇒ d' = d`. ∎

**Hệ quả (A5).** Không thể "rút Distribution ghi vào Reserve" hay ngược lại. Tests
`distvest_touches_reserve` (`lamp_mint.ak:244`) và `reservedraw_touches_dist`
(`lamp_mint.ak:251`) đều fail.

**Hệ quả (tổng-cap chặt hơn).** Vì hai quota khóa nhau và mỗi cái có cap riêng, mint tối đa qua
Distribution = `D₀` dù tổng `M < CAP`. Test `mint vượt total qua dist alone`
(`supplyState.test.ts`): `d = D₀` rồi mint thêm 1 oil dist → throw `dist_cap`, KHÔNG được mượn quota
Reserve.

---

## 5. Định lý DUY NHẤT (bộ đếm là singleton)

> **Định lý 5.1 (thread NFT one-shot ⇒ SupplyState duy nhất).** Trong toàn bộ lịch sử chain tồn
> tại đúng ≤ 1 thread NFT `(thread_policy, SUPPLY)`, do đó ≤ 1 chuỗi SupplyState.

*Chứng minh.* `thread_nft` policy param = `genesis_ref` (một `OutputReference` cụ thể). Mint hợp lệ
đòi `tx` consume `genesis_ref` (`thread_nft.ak:22`). Một UTxO spend ≤ 1 lần trong lịch sử chain
(tính chất eUTXO) ⇒ policy chạy ≤ 1 lần ⇒ mint đúng 1 `(SUPPLY,+1)` (`thread_nft.ak:25–26`) đúng
MỘT lần. Không có nhánh else cho phép (`thread_nft.ak:30` `else(_) { fail }`) ⇒ không burn, không
mint lần 2. ∎

**Hệ quả (A3).** Không thể dựng SupplyState giả: `mint_two_threads` (qty 2, `thread_nft.ak:68`) và
`thread_without_genesis` (`thread_nft.ak:62`) đều fail.

> **Định lý 5.2 (thread bảo toàn qua mint tLAMP).** Mỗi tx mint tLAMP giữ nguyên thread NFT: đúng 1
> input + 1 output mang nó, KHÔNG mint/burn nó.

*Chứng minh.* T1: `count_inputs_holding_nft == 1` (`lamp_mint.ak:39`),
`count_holding_nft(outputs) == 1` (`lamp_mint.ak:40`), `quantity_of(tx.mint, thread, SUPPLY) == 0`
(`lamp_mint.ak:41`), `s_out.address == s_in.address` (`lamp_mint.ak:47`). ∎

**Hệ quả.** SUPPLY NFT `mint_or_burn_count` luôn = 1 dù mint tLAMP nhiều lần — dẫn chứng tx thật
`ed7377fa…` (mint thêm 60 tLAMP, NFT count vẫn 1). Chống A2 (mint lậu: `count == 0 ≠ 1`,
`mint_no_supplystate`), A7 (double-sat: `count == 2 ≠ 1`, `two_supplystate_inputs`).

---

## 6. Định lý KHÔNG-LỆCH Δ (mint = ghi sổ)

> **Định lý 6.1 (A8).** Lượng token thực sự đúc ra (`Δ` trong `tx.mint`) BẰNG lượng cộng vào bộ
> đếm.

*Chứng minh.* `lamp_mint.ak:54` định nghĩa `delta` là CHÍNH `quantity_of(tx.mint, policy_id, tLAMP)`
— cùng một biến `delta` dùng trong T5a/T5b (`lamp_mint.ak:68,71`). Không tồn tại biến thứ hai cho
"lượng ghi sổ" → không thể lệch. ∎

**Hệ quả.** `delta_mismatch` (`lamp_mint.ak:292`): mint 1_000_000 nhưng datum cộng 1 → `s2.dist_minted
≠ s.dist_minted + delta` → T5a fail.

---

## 7. Định lý KHÔNG-BURN

> **Định lý 7.1.** Genesis KHÔNG có đường giảm tổng phát hành.

*Chứng minh.* (a) `TLampMintRedeemer` chỉ có 2 nhánh `DistributionVest`/`ReserveDraw`
(`types.ak:19–22`), KHÔNG nhánh burn. (b) T2 ép `Δ > 0` ⇒ không mint âm. (c) thread NFT không có
đường burn (`thread_nft.ak:30` else fail). (d) spend SupplyState đòi `Δ > 0` (`supply_state.ak:30`)
⇒ không spend kèm burn (`spend_with_burn_attempt` fail, `supply_state.ak:68`). ∎

**Liên hệ LAMP fixed-supply.** Nhất quán nguyên tắc dự án: LAMP 36 tỷ BẤT BIẾN, KHÔNG burn. Genesis
chỉ phát hành (đơn điệu lên tới cap), giảm-lưu-hành về sau là việc của Treasury (chuyển trạng thái
UTxO → Accounting, value bảo toàn `Σout=Σin`), KHÔNG đốt.

---

## 8. Value preservation (Σout = Σin) — phân định

Genesis KHÔNG vi phạm bảo toàn value của ledger: token MỚI ra đời qua `tx.mint` (Δ > 0) — đây là
**mint hợp lệ của ledger**, không phải "tạo từ hư không phá Σout=Σin". Đẳng thức ledger luôn giữ:

```
Σ outputs = Σ inputs + tx.mint        (mint = +Δ tLAMP)
```

Genesis chỉ ràng buộc **khi nào `tx.mint` được phép có +Δ tLAMP** (mọi tiên đề T1–T8). Đây là khác
biệt bản chất với Treasury (chỉ di chuyển token đã tồn tại, `tx.mint = 0`, nên ở đó Σout=Σin theo
nghĩa chặt). Genesis là **nguồn** duy nhất đưa value mới vào hệ, có trần CAP.

---

## 9. Định nghĩa hình thức `circulating` (CONTRACT §6)

```
circulating(S, pots) = M(S) − Σ_{p ∈ pots} p.held
                     = (dist_minted + reserve_minted) − Σ(Treasury + Deposits held)
```

(`circulating.ts:25–39`). **Reserve KHÔNG trừ**: `reserve_cap − reserve_minted` (quota chưa mint)
là token CHƯA tồn tại ⇒ không nằm trong `M(S)` ⇒ không phải trừ. Chỉ trừ token ĐÃ mint đang nằm
custody.

> **Bất biến C1 (non-negative).** `circulating ≥ 0` đòi `Σ held ≤ M(S)`. Code ép tường minh:
> `circulating.ts:33` throw nếu `heldTotal > minted` (custody không thể giữ nhiều hơn đã mint —
> bất khả thi). Test `circulating.test.ts` "Σ held > minted → throw".

> **Bất biến C2 (held ≥ 0).** Mỗi pot held không âm (`circulating.ts:28`), test "pot held âm → throw".

---

## 10. Tương đương offchain ↔ onchain (fail-fast)

`supplyState.ts` `applyMint` (`supplyState.ts:41–64`) tính `S'` offchain ĐÚNG T2/T5/T7 trước khi
build tx (tránh tốn phí cho tx chắc reject):

| Onchain (lamp_mint.ak) | Offchain (supplyState.ts) |
|---|---|
| T2 `Δ > 0` | `:42` `if (delta <= 0n) throw GMINT-001` |
| T5a `d' = d + Δ` | `:46,53` `dist_minted: s.dist_minted + delta` |
| T5b `r' = r + Δ` | `:56,63` `reserve_minted: ...` |
| T7 `d' ≤ D` | `:47` `if (next > s.dist_cap) throw GMINT-010` |
| T7 `r' ≤ R` | `:57` `if (next > s.reserve_cap) throw GMINT-011` |
| T4 caps bất biến | `{...s, dist_minted: next}` giữ nguyên caps |

Bất biến audit offchain `assertInvariants` (`supplyState.ts:67–77`): `d,r ≥ 0`, `d ≤ D`, `r ≤ R`.

---

## 11. Bảng property cần test (đối chiếu đã có)

| Property | Định lý | Test đã có | Trạng thái |
|---|---|---|---|
| Cap-bound tổng ≤ 36 tỷ | 2.2 | `distvest_exact_cap_boundary`, `mint_exceed_dist_cap` | ✅ Aiken + offchain |
| Cap bất biến | 2.3 | `widen_dist_cap`, `widen_reserve_cap` | ✅ |
| Monotonic ngặt | 3.1, 3.2 | `mint_rollback_dist`, `distvest_incremental` | ✅ |
| Khóa quota | 4.1 | `distvest_touches_reserve`, `reservedraw_touches_dist` | ✅ |
| Singleton bộ đếm | 5.1 | `mint_two_threads`, `thread_without_genesis` | ✅ |
| Thread bảo toàn | 5.2 | `mint_no_supplystate`, `two_supplystate_inputs`, `thread_minted_in_tx`, `supplystate_moved_address` | ✅ |
| Δ = ghi sổ | 6.1 | `delta_mismatch` | ✅ |
| No-burn | 7.1 | `mint_negative`, `mint_zero`, `thread_burn_rejected`, `spend_with_burn_attempt` | ✅ |
| circulating ≥ 0 | C1, C2 | `circulating.test.ts` (Σ held > minted, held âm) | ✅ |

**Gap (cần bổ sung khi nối Capped Drop v1.1):** property "tổng Δ qua tất cả claim ≤ quota
Distribution của user cụ thể" — chưa có vì Capped Drop redeem còn stub (gate hiện = keyhash, không
ràng buộc per-user). Xem [EXEC §gaps](./EXEC.md).
