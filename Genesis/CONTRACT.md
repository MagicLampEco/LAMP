# LAMP Genesis — Lazy-Mint Supply Contract (v1, ghim)

Mô hình **lazy-mint** (chốt 2026-06-08, anh Aladin). Thay thế hoàn toàn branch
`feat/genesis-4pots` cũ (mô hình "mint hết 36 tỷ rồi để nằm chờ" — BỎ vì rủi ro
tấn công + khóa min-ADA cho token chưa dùng).

> **fixed-supply = mint cumulative ≤ CAP 36 tỷ, đơn điệu tăng, KHÔNG burn.**
> Token chưa mint = KHÔNG tồn tại on-chain = không bị tấn công, không khóa min-ADA.

---

## 1. Nguyên lý (first-principles)

Token chỉ tồn tại khi có người cần. "Fixed-supply" KHÔNG đòi token phải nằm sẵn
on-chain — nó đòi **tổng phát hành lịch sử KHÔNG bao giờ vượt CAP**. Một bộ đếm
on-chain đơn điệu (chỉ tăng, chặn tại CAP) thỏa định nghĩa đó mạnh hơn, an toàn
hơn, rẻ hơn so với việc mint sẵn 36 tỷ token rồi canh giữ.

Bộ đếm đó = **SupplyState UTxO** (duy nhất, ghim bởi thread NFT one-shot).

---

## 2. Đơn vị + hằng số (MVP Preview)

| Hằng | Giá trị | Ghi chú |
|---|---|---|
| 1 tLAMP | `1_000_000` oil | 10^6, khớp Distribution (`oil`) |
| asset name token | param `token_name` | testnet "tLAMP" `#"744c414d50"` / mainnet "LAMP" `#"4c414d50"` |
| asset name thread NFT | `#"535550504c59"` | "SUPPLY" |
| `dist_cap` | `28_101_000_000 × 10^6` oil | 78,06% — Distribution quota (mọi khoản trừ Reserve) |
| `reserve_cap` | `7_899_000_000 × 10^6` oil | 21,94% — Reserve quota (engine trần E/1000/epoch, Treasury-pull gated, ~1001 epoch) |
| CAP tổng | `36_000_000_000 × 10^6` oil | dist_cap + reserve_cap, BẤT BIẾN |

`dist_cap` + `reserve_cap` = `36e9 × 10^6` = `36_000_000_000_000_000` oil.

---

## 3. Ba tầng script (KHÔNG vòng lặp policy-id — first-principles)

Phá vòng lặp phụ thuộc bằng tham số hóa TUYẾN TÍNH (mỗi tầng chỉ phụ thuộc tầng trên):

```
  (1) thread_nft policy   param = genesis_ref (OutputReference one-shot)
        │  mint đúng 1 (SUPPLY,+1), one-shot → SupplyState UTxO là DUY NHẤT
        ▼
  (2) lamp_mint policy    param = thread_nft_policy + thread_nft_name
        │  GATE: mỗi tx mint tLAMP PHẢI consume + recreate SupplyState (nhận diện
        │  qua thread NFT). Toàn bộ luật cap/quota/monotonic/no-burn Ở ĐÂY.
        ▼
  (3) supply_state spend   param = lamp_policy
        │  SupplyState UTxO ngồi tại đây. Spend hợp lệ ⟺ tx CÓ mint tLAMP (≠0).
        │  Ủy quyền toàn bộ kiểm tra transition cho (2) — tránh trùng lặp luật.
```

Vì sao tuyến tính (không vòng): (1) chỉ biết genesis_ref. (2) chỉ biết policy+name
của (1). (3) chỉ biết policy của (2). Không tầng nào tham chiếu ngược tầng dưới.

**Quyết định đặt luật ở MINT policy (2), không ở spend (3)** (4 trục):
- *Tối ưu (eUTXO/ExUnit):* luật chạy 1 lần ở mint redeemer; spend (3) chỉ check
  "có mint" → rẻ, không trùng lặp logic nặng.
- *An toàn:* mint là điểm DUY NHẤT token ra đời → đặt cap-enforce ngay tại nguồn,
  không thể có đường mint nào lách (mọi mint tLAMP đều qua policy (2)).
- *Bền vững/nâng cấp:* spend (3) tối giản → ít bề mặt lỗi; nâng luật = nâng (2).
- *Lợi ích hệ thống:* một nguồn sự thật cho cap, không phân tán luật 2 nơi dễ lệch.

---

## 4. SupplyState datum (interface contract — byte-perfect onchain ↔ offchain)

```
SupplyState {
  dist_minted    : Int,   // oil tLAMP đã mint qua đường Distribution (đơn điệu)
  reserve_minted : Int,   // oil tLAMP đã mint qua đường Reserve (đơn điệu)
  dist_cap       : Int,   // trần Distribution (hằng, KHÔNG đổi qua transition)
  reserve_cap    : Int,   // trần Reserve (hằng, KHÔNG đổi qua transition)
}
= Constr(0, [int, int, int, int])
```

`minted_total = dist_minted + reserve_minted`. Bất biến: `≤ dist_cap + reserve_cap`.

## 4b. lamp_mint redeemer

```
TLampMintRedeemer:
  DistributionVest   = Constr(0, [])   // mint vào quota Distribution
  ReserveDraw        = Constr(1, [])   // mint vào quota Reserve
```

(MVP: gate authority = committee/DAO stub ký tx; v1.1 nối Capped Drop redeem cho
DistributionVest. Mint policy KHÔNG burn → không có nhánh redeemer âm.)

---

## 5. Luật ép trong `lamp_mint` (mọi tx mint tLAMP)

Gọi `S` = SupplyState input (datum cũ), `S'` = SupplyState output (datum mới),
`Δ` = `quantity_of(tx.mint, lamp_policy, tLAMP_name)` (lượng tLAMP mint trong tx).

1. **Consume + recreate SupplyState (thread):** đúng 1 input mang thread NFT
   `(thread_nft_policy, SUPPLY, 1)`, đúng 1 output mang lại NFT đó tại CÙNG địa chỉ
   script. Thread NFT KHÔNG bị mint/burn trong tx này. → chống tạo SupplyState giả,
   chống đánh tráo, chống mất NFT.
2. **Δ > 0:** mint dương. `Δ ≤ 0` reject → chặn burn lén + tx no-op.
3. **Mint chỉ tLAMP:** policy tlamp chỉ mint đúng asset name tLAMP, đúng 1 name.
4. **Caps bất biến:** `S'.dist_cap == S.dist_cap` ∧ `S'.reserve_cap == S.reserve_cap`.
   → chống nới cap.
5. **Cộng đúng quota theo redeemer:**
   - `DistributionVest`: `S'.dist_minted == S.dist_minted + Δ` ∧
     `S'.reserve_minted == S.reserve_minted` (Reserve KHÔNG đổi).
   - `ReserveDraw`: `S'.reserve_minted == S.reserve_minted + Δ` ∧
     `S'.dist_minted == S.dist_minted` (Distribution KHÔNG đổi).
   → chống "rút Distribution tính vào Reserve" và ngược lại; Δ trong policy ≡ Δ
     trong datum transition (cùng một biến → không thể lệch).
6. **Monotonic (không giảm):** ngầm bởi Δ>0 + cộng đúng; thêm guard
   `S'.dist_minted ≥ S.dist_minted` ∧ `S'.reserve_minted ≥ S.reserve_minted`.
   → chống rollback đếm.
7. **Cap enforce:** `S'.dist_minted ≤ S'.dist_cap` ∧ `S'.reserve_minted ≤ S'.reserve_cap`.
   → chống mint vượt cap (cả biên = đúng cap vẫn cho, > cap reject).
8. **Authority gate (stub MVP):** tx phải có chữ ký authority tương ứng đường mint
   (committee cho DistributionVest, DAO cho ReserveDraw). Param hóa list keyhash.

## 5b. Luật `supply_state` spend (tối giản)

- Spend hợp lệ ⟺ `quantity_of(tx.mint, lamp_policy, tLAMP_name) > 0` (có mint tLAMP
  trong tx). Ủy quyền toàn bộ transition cho `lamp_mint`.
- KHÔNG cho spend SupplyState mà không mint (chống rút NFT ra / phá thread vô cớ).

---

## 6. Ba POT (KHÔNG có "Distribution pot chứa token")

| POT | Bản chất | On-chain |
|---|---|---|
| **Reserve** | quota CHƯA mint = `reserve_cap − reserve_minted` | ẢO (số trong datum), KHÔNG UTxO chứa token |
| **Treasury** | custody pot thật, nhận tLAMP đã mint | UTxO thật (module Treasury) |
| **Deposits** | custody pot thật (app deposits) | UTxO thật |

`circulating = minted_total − Σ(Treasury + Deposits tLAMP held)`
trong đó `minted_total = dist_minted + reserve_minted ≤ 36 tỷ`.

"Distribution" KHÔNG phải pot chứa token — nó là QUOTA mint (đường ra của lazy-mint
về tay user qua Capped Drop). tLAMP mint theo DistributionVest đi thẳng tới user,
không qua pot trung gian.

---

## 7. Vector tấn công đã đóng (test negative bắt buộc)

| # | Tấn công | Cơ chế chặn | Test |
|---|---|---|---|
| A1 | Mint vượt cap | luật 7 (`minted' ≤ cap'`) | `mint_exceed_dist_cap` / `reserve_cap` fail |
| A2 | Mint không consume SupplyState (mint lậu) | luật 1 (bắt buộc thread input+output) | `mint_no_supplystate` fail |
| A3 | Tạo SupplyState giả (2 thread NFT) | thread NFT one-shot (1 lần mint duy nhất) | `thread_oneshot` + `mint_two_threads` fail |
| A4 | minted giảm (rollback) | luật 6 monotonic + luật 5 cộng đúng | `mint_rollback_dist` fail |
| A5 | Mint sai quota (Distribution→Reserve) | luật 5 (redeemer khóa quota) | `distvest_touches_reserve` fail |
| A6 | Burn lén (Δ<0) | luật 2 (`Δ>0`) | `mint_negative` fail |
| A7 | Double-satisfaction (2 SupplyState in/out) | luật 1 (đúng 1 in + đúng 1 out theo NFT) | `two_supplystate_inputs` fail |
| A8 | Δ policy ≠ Δ datum | luật 5 dùng CÙNG Δ cho cả 2 → không thể lệch | `delta_mismatch` fail |
| A9 | Nới cap qua transition | luật 4 (cap bất biến) | `widen_dist_cap` fail |
| A10 | Mint thiếu chữ ký authority | luật 8 | `mint_no_authority` fail |
| A11 | Mint asset name lạ cùng policy | luật 3 (đúng 1 name = tLAMP) | `mint_extra_name` fail |
| A12 | Spend SupplyState không mint (phá thread) | luật 5b | `spend_without_mint` fail |

---

## 8. Đường mint (2)

1. **DistributionVest** — quota Distribution. MVP gate bằng committee/authority stub
   (param keyhash). v1.1: nối Capped Drop redeem (redeemer mang bằng chứng claim).
2. **ReserveDraw** — quota Reserve. Gate bằng DAO authority stub (param keyhash).

---

## 9. Trạng thái triển khai

- onchain: `supply_state.ak` (spend, tầng 3) + `lamp_mint.ak` (mint, tầng 2) +
  `thread_nft.ak` (mint one-shot, tầng 1) + `lib/.../types.ak` + `constants.ak` + `util.ak`.
- offchain: `types.ts` + `datum.ts` (codec) + `supplyState.ts` (cap math) +
  `mintBuilder.ts` (DistributionVest/ReserveDraw) + `circulating.ts`.
- scripts: deploy Preview SUBMIT=false (deploy SupplyState + mint thử DistributionVest).
