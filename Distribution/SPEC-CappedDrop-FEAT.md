# Capped Drop — SPEC FEAT (hành vi)

**Doctype:** MagicLamp Protocol — Onchain Spec (Feature/Behavior)
**Version:** v2 "Capped Drop" (thay Drop Lottery v0.1)
**Updated:** 2026-06-06
**Nguồn chuẩn (interface contract):** [`CONTRACT-CappedDrop.md`](./CONTRACT-CappedDrop.md)
**Chứng minh toán:** [`SPEC-CappedDrop-MATH.md`](./SPEC-CappedDrop-MATH.md)

Tài liệu này đặc tả **hành vi** cơ chế Capped Drop: entitlement → drip (nhỏ giọt) →
redeem (tự rút). Bỏ random/lottery/merkle/committee-chọn-winner. Mọi phát biểu bám
`CONTRACT-CappedDrop.md`; mâu thuẫn thì CONTRACT thắng.

---

## 0. Vì sao Capped Drop thay Drop Lottery

Drop Lottery cũ (xem mô tả gốc đã gỡ trong [`SPEC.md`](./SPEC.md)) mang 2 lỗ hổng:

1. **Proof hết hạn → mất quyền redeem.** Redeem phải submit Merkle proof của
   `won_cumulative` ứng với `MerkleRootBeacon` epoch nào đó. Nếu user bỏ lỡ, root xoay,
   proof cũ không còn khớp root mới → user kẹt, mất phần đã thắng.
2. **Committee nonce grinding.** Người thắng phụ thuộc `nonce_N` do committee post. Committee
   có thể thử nhiều nonce để lái kết quả lottery (grinding) trước khi công bố.

Capped Drop **tất định, O(1), permissionless**: account tự tính phần đã mở khoá ngay
on-chain, không cần proof, không cần committee chọn ai thắng, không bỏ lỡ epoch nào.

---

## 1. Khái niệm

| Tên | Ký hiệu | Ý nghĩa |
|---|---|---|
| Entitlement | `E` | Tổng LAMP account được phân bổ (cố định khi genesis/claim). |
| Drop value | `D` | Trần LAMP mở khoá mỗi drop. Đọc từ `DropParam` beacon (reference input). |
| Drops/epoch | `drops_per_epoch` | Số drop mở mỗi epoch. **MVP = 1**, nằm ở datum account. |
| Start epoch | `t0` | `start_epoch` — epoch bắt đầu nhỏ giọt. |
| Vested | `vested(t)` | Tổng đã mở khoá tới epoch `t` (đơn điệu, cap `E`). |
| Redeemed | `redeemed` | Tổng đã rút ra ví (tích lũy). |
| Redeemable | `vested − redeemed` | Phần rút được ngay lúc này. |

Mọi giá trị LAMP là số nguyên oildrop (1 LAMP = 10^6 oildrop, theo `ProtocolUtils.S_LAMP_TOTAL`).

---

## 2. Công thức trung tâm

```
vested(t)   = min( E , D · drops_per_epoch · max(0, t − t0) )
redeemable  = vested(t) − redeemed
```

`t` = `current_epoch` đọc từ validity range của tx; `D` đọc từ `DropParam` beacon;
`E, redeemed, t0, drops_per_epoch` đọc từ datum `ClaimAccount`. Tất cả **tham số**, không
hardcode (CONTRACT §7).

---

## 3. Hành vi cốt lõi: entitlement → drip → redeem

### 3.1 Genesis / Claim (gán entitlement)
Committee M-of-N (giữ flow cũ, CONTRACT §6) xác nhận một ví đáng nhận `E` LAMP, tạo
`ClaimAccount` UTxO với datum:

```
ClaimAccount {
  owner            = PKH ví,
  entitlement      = E,
  redeemed         = 0,
  start_epoch      = t0 (epoch hiện tại khi gán),
  drops_per_epoch  = 1,   // MVP
}
```

### 3.2 Drip (mở khoá theo thời gian — KHÔNG cần giao dịch)
Vested **tự tăng theo epoch**, không ai phải làm gì. Mỗi epoch trôi qua, `vested` tăng thêm
`D · drops_per_epoch`, dừng khi chạm `E`. Đây là tính chất thuần toán, on-chain chỉ đọc khi
redeem. **Bỏ lỡ epoch không mất quyền** — vested cộng dồn từ `t0` (CONTRACT §1).

### 3.3 Redeem (tự rút — permissionless)
Owner ký tx spend `ClaimAccount` với redeemer `Redeem`. Validator ÉP (CONTRACT §4):

1. `vested = min(E, D · drops_per_epoch · (current_epoch − t0))` — `D` từ `DropParam`
   reference input, `current_epoch` từ validity range.
2. `amount = vested − redeemed`, yêu cầu `amount > 0` (không có gì để rút thì tx vô nghĩa).
3. Out datum: `redeemed' = redeemed + amount`; `owner / entitlement / start_epoch /
   drops_per_epoch` **bất biến**.
4. Treasury nhả đúng `amount` LAMP cho `owner`; `treasury_out.value = treasury_in.value −
   amount` (bảo toàn value, tái dùng `treasury.ak`, **không burn** — CONTRACT §4, §7).
5. Chống double-satisfaction: đếm theo **payment script hash** (fix C1/C2/M1, CONTRACT §4).

Không cần proof, không cần committee, không cần nonce. Owner tự rút bất cứ lúc nào sau khi
có phần vested chưa rút.

---

## 4. Hai hồ sơ ví (ví nhỏ vs ví lớn)

### 4.1 Ví nhỏ — `E ≤ D`: nhận hết ngay epoch đầu
Tại `t = t0 + 1`: `vested = min(E, D·1·1) = E` (vì `E ≤ D`). Một lần redeem rút trọn `E`.
Không nhỏ giọt. Hợp lý: phần thưởng bé thì trả luôn, khỏi bắt user chờ.

> Ví dụ: `E = 40 LAMP`, `D = 100 LAMP`. Epoch `t0+1`: vested = 40 = E → redeem 40, xong.

### 4.2 Ví lớn — `E > D`: nhỏ giọt `D`/epoch
Mỗi epoch mở thêm `D` cho tới hết, kéo dài `⌈E/D⌉` epoch (chứng minh MATH §3). User có thể
redeem từng epoch (mỗi lần `D`) hoặc dồn nhiều epoch rồi rút một lần (mỗi lần `k·D`) — kết
quả tổng nhận như nhau (đa-claim cộng dồn, MATH §4).

> Ví dụ: `E = 350 LAMP`, `D = 100 LAMP` → nhỏ giọt 100/100/100/50 trong 4 epoch
> (`⌈350/100⌉ = 4`). Epoch cuối chỉ mở 50 vì cap `E` (vested không vượt 350).

| Epoch sau `t0` | `D·1·(t−t0)` thô | `vested = min(E, …)` | Mở thêm |
|---|---|---|---|
| 1 | 100 | 100 | 100 |
| 2 | 200 | 200 | 100 |
| 3 | 300 | 300 | 100 |
| 4 | 400 | **350** (cap) | 50 |
| 5 | 500 | 350 | 0 |

### 4.3 Đa-claim tự do
Vì vested đơn điệu và cap `E`, user redeem bao nhiêu lần tùy ý: mỗi lần rút đúng phần
`vested − redeemed` tại thời điểm đó, tổng nhận luôn `= vested(t_cuối) ≤ E`. Rút sớm/muộn,
nhiều lần/một lần đều cho cùng tổng (MATH §4). Không phạt, không mất phần.

---

## 5. Hooks DAO (post-MVP — CHỪA CHỖ, KHÔNG build ở MVP)

CONTRACT §5: MVP chỉ cần `drops_per_epoch` là field datum đọc được; cơ chế DAO chỉnh nó là
phiên sau. Hai hook đã chừa chỗ:

### 5.1 Multi-drop per-DID
DAO tăng `drops_per_epoch` cho DID uy tín / nhu cầu cao (vd Org hoạt động liên tục → nhiều
drop/epoch, nhỏ giọt nhanh hơn). Gắn Governance VP (C3 uy tín) + DID sinh trắc PhoenixKey
(chống sybil chia nhiều DID để né cap). Vested-cap `E` vẫn giữ → multi-drop chỉ **rút nhanh
hơn tới `E`**, không tăng tổng nhận. Nguồn VP:
`LAMP/Governance/VotingPower/CONTRACT.md`.

### 5.2 Pause / penalty
DAO đặt `drops_per_epoch = 0` trong `N` epoch nếu account có hành vi gây hại. Khi `drops_per_epoch
= 0`: `vested` đứng yên (không mở thêm), nhưng phần đã vested trước đó **không mất** (redeemed
giữ nguyên quyền). Pause là tạm dừng nhỏ giọt, không tịch thu.

> Cả 2 hook đều **không** đổi bất biến: vested vẫn đơn điệu (pause = đạo hàm 0, không âm),
> vẫn cap `E`. Xem MATH §5 cho chứng minh hook không phá đơn điệu.

---

## 6. Giữ nguyên từ Lottery (tái dùng)

CONTRACT §6: ClaimAccount per-wallet UTxO (QĐ5 cũ), `treasury.ak` + 3 fix audit C1/C2/M1,
e2e harness `04_e2e.ts`, datum codec base, claim flow committee M-of-N.

---

## 7. Bất biến hành vi (normative — đặt tên để test truy vết)

| ID | Phát biểu |
|---|---|
| **F-VEST-1** | `vested(t) = min(E, D·drops_per_epoch·max(0, t−t0))` — tất định từ datum + beacon + validity range. |
| **F-VEST-2** | `vested` đơn điệu không giảm theo `t` (drip không lùi). MATH §2. |
| **F-VEST-3** | `vested ≤ E` mọi `t` (cap entitlement). MATH §2. |
| **F-RDM-1** | `amount = vested − redeemed`; yêu cầu `amount > 0`. |
| **F-RDM-2** | Out datum: `redeemed' = redeemed + amount`; `owner/entitlement/start_epoch/drops_per_epoch` bất biến. |
| **F-RDM-3** | Treasury nhả đúng `amount` cho owner; `tre_out.value = tre_in.value − amount`; không burn. |
| **F-RDM-4** | Owner ký (`tx.extra_signatories`). Permissionless với owner — không cần committee. |
| **F-RDM-5** | Đúng 1 ClaimAccount input + 1 output cùng payment script hash (chống double-satisfaction). |
| **F-SUM-1** | Tổng nhận qua mọi lần redeem `= redeemed_cuối = vested(t_cuối) ≤ E` (MATH §4). |
| **F-SMALL-1** | `E ≤ D` ⇒ redeem epoch `t0+1` rút trọn `E`. |
| **F-LARGE-1** | `E > D` ⇒ nhỏ giọt, hết sau đúng `⌈E/D⌉` epoch (drops_per_epoch=1). MATH §3. |
| **F-DAO-1** | (post-MVP) `drops_per_epoch` là field datum, đọc được; cơ chế DAO chỉnh defer. |

---

## 8. Flow test hành vi (cho onchain/offchain bám)

```
1. Genesis: committee(M/N) gán A: E=40 LAMP; B: E=350 LAMP. D=100 (DropParam beacon). t0=epoch0.
2. Ví nhỏ (A): epoch1 → vested=40=E → A redeem 40, redeemed=40. Hết.
3. Ví nhỏ double: A redeem lại cùng epoch → amount=40−40=0 → reject (F-RDM-1).
4. Ví lớn drip (B): epoch1 vested=100 → redeem 100; epoch2 vested=200 → redeem 100 (dồn được).
5. Ví lớn cap (B): epoch5 vested=min(350,500)=350 → redeem (350−đã rút). Tổng B nhận = 350 = E.
6. Bảo toàn: Σ amount mọi redeem ≤ Σ E; treasury_out = treasury_in − Σ amount; mint==0.
7. Double-satisfaction: 2 ClaimAccount input share stake cred trong 1 tx → reject (F-RDM-5).
```

Mỗi bước có unit test (Aiken mock-tx + vitest builder). Chi tiết chứng minh số học:
[`SPEC-CappedDrop-MATH.md`](./SPEC-CappedDrop-MATH.md).
