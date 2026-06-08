# Genesis — CONTRACT (mô hình 4-POT trung thực)

**Trạng thái:** khung interface 2026-06-08 (build-mode, chờ anh audit). Đây là **xương sống**
cho việc khởi tạo tổng cung tLAMP một lần (one-shot) rồi **tách trung thực vào 4 POT
accounting**, thay cho mô hình cũ "mint hết vào 1 pool phẳng". KHÔNG module nào tự đổi
schema/bất biến ở đây.

Gốc: `LAMP-Distribution.md` (36 tỷ = Distribution 95% + Reserve 5%; team/community NẰM TRONG
Distribution). Tái dùng `LAMP/Treasury` (custody UTxO + sổ bucket trong datum + custody_seed
one-shot) — Genesis KHÔNG phát minh lại custody. Nguyên tắc nền (Treasury CONTRACT §5):
**fixed-supply 36 tỷ tuyệt đối — KHÔNG burn**, value bảo toàn `Σout = Σin`, "giảm lưu hành"
là thuộc tính kế toán (`circulating = tổng − Σ pots`).

---

## 1. Bốn POT — định nghĩa

Một POT = một **custody UTxO** (tái dùng `Treasury/custody` + seed one-shot) mang:
- **authenticity NFT** riêng (one-shot, name = `instance_id` = mã pot) → cryptographically
  tách pot này khỏi pot khác (kẻ giả không mint được NFT đúng policy).
- **inline `CustodyDatum`** với sổ bucket (accounting bucket) trong datum.

| Pot | instance_id | bucket_id | Genesis value (tLAMP) | % | Cửa chảy ra |
|---|---|---|---|---|---|
| **Distribution** | `#"4452"` ("DR") | 1 | 34_200_000_000 | 95% | Capped Drop (van D/epoch) — chỉ qua Distribution validator |
| **Reserve** | `#"5256"` ("RV") | 1 | 1_800_000_000 | 5% | DAO governance (Release Model A), TÁCH biệt Treasury |
| **Treasury** | `#"5452"` ("TR") | 1 | 0 (khởi tạo) | 0% | nhận phí/collect sau (collectToTreasury) |
| **Deposits** | `#"4450"` ("DP") | 1 | 0 (khởi tạo) | 0% | giữ bond hoàn-lại (bond in/out) |

Đơn vị bảng trên là **tLAMP nguyên** (whole token). On-chain value tính bằng **oil**
(`1 tLAMP = 10^6 oil`, `OIL_PER_LAMP = 1_000_000`). Σ value on-chain = `36e9 × 1e6` oil.

**Vì sao 4 pot riêng (không gộp 1 datum đa-bucket):**
- **Reserve TÁCH thật khỏi Treasury** (yêu cầu phản biện §2): chi Treasury (collect/release theo
  category Treasury) tiêu thụ UTxO Treasury, KHÔNG đụng UTxO Reserve → an toàn vốn theo *physical
  isolation*, không chỉ theo bút toán. Tương tự Treasury CONTRACT §1 "Emergency bucket tách
  physical".
- **Distribution physical-isolate** để Capped Drop không bao giờ rút nhầm vào quỹ DAO/phí.
- Mỗi pot **1 custody script hash riêng** (tham số `pot_tag` khác → hash khác, §4) → đếm
  input/output theo script hash (chống double-satisfaction) hoạt động độc lập từng pot.

---

## 2. Bất biến GENESIS (KHÓA — mọi spec + code phải khớp)

Ký hiệu: `A = 36_000_000_000 × OIL_PER_LAMP` (oil) = tổng cung. `pots = [Distribution, Reserve,
Treasury, Deposits]`. `value(p)` = số tLAMP-oil booked trong sổ pot `p` (KHÔNG kể reserved_min_ada
lovelace giữ min-UTxO — ADA không phải tLAMP).

- **G-SUM** (bảo toàn tổng): `Σ_p value(p) == A`. Không rơi token lẻ, không mint dư/thiếu.
- **G-SPLIT** (chia 95/5 không rơi lẻ): cho `allocation = [(Distribution, 9500 bps), (Reserve,
  500 bps)]` trên `A`:
  - `value(Distribution) = ⌊A × 9500 / 10000⌋`
  - `value(Reserve)      = ⌊A × 500 / 10000⌋`
  - **remainder** `r = A − Σ⌊...⌋` được **dồn vào pot đầu tiên** (Distribution) → `Σ == A` TUYỆT
    ĐỐI. Với `A = 36e9 × 1e6`, cả hai chia hết (xem MATH §SPLIT) ⇒ `r = 0`; nhưng thuật toán
    xử lý `r ≠ 0` tổng quát (an toàn nếu DAO đổi tỉ lệ).
  - Treasury, Deposits **không** trong allocation (bps = 0) → genesis = 0.
- **G-NONNEG**: `value(p) ≥ 0 ∀p` (không pot âm).
- **G-MINT-1**: tx genesis mint ĐÚNG `A` oil tLAMP (one-shot) + 4 authenticity NFT (mỗi pot 1),
  KHÔNG mint asset khác, KHÔNG mint dư/thiếu.
- **G-CIRC-0** (circulating tại genesis = 0): `circulating = A − Σ_p value(p) = A − A = 0`. Chưa
  vested token nào ra ví user.
- **G-SEED** (mỗi pot khớp Treasury seed): mỗi custody UTxO thỏa `seed_value_ok` Treasury —
  `value(p) == ledger_value(sổ_p) ⊕ reserved_min_ada` (tLAMP-oil booked == value, ADA reserved
  không booked). Tái dùng `custody_seed` one-shot ép bất biến nền sổ↔value.

---

## 3. circulating — đa pot (tái dùng, khóa định nghĩa)

`circulating(A, pots) = A − Σ_p potBalance(p)` với `potBalance(p) = Σ dòng-sổ-tLAMP của pot p`.

- Chỉ tính **tLAMP** (policy+name của tLAMP). ADA/asset khác KHÔNG vào circulating tLAMP.
- Pot Treasury chứa tLAMP thu phí về sau → circulating GIẢM đúng lượng đó (token rời lưu hành,
  KHÔNG burn — Treasury CONTRACT §5). Pot Deposits giữ bond → cũng rời circulating tạm thời.
- **Bất biến C-INV**: `0 ≤ circulating ≤ A` mọi thời điểm (vì `0 ≤ Σ pots ≤ A`).

---

## 4. Onchain — tách hash mỗi pot (tái dùng custody, KHÔNG sửa Treasury)

- **`custody` (Treasury)** spend validator KHÔNG param theo pot → 4 pot dùng chung hash nếu
  param `(proposal_policy, ms_per_epoch)` giống. Để **mỗi pot 1 hash riêng** mà KHÔNG đụng module
  Treasury đã audit, Genesis thêm **wrapper mỏng** `genesis_pot(pot_tag, …)`: cùng logic seed,
  nhưng `pot_tag` (ByteArray riêng mỗi pot) đưa vào param ⇒ blake2b script hash khác nhau.
- **`genesis_mint`** (one-shot, param `genesis_ref`): trong 1 tx, mint đúng `A` oil tLAMP +
  4 NFT pot. One-shot bằng consume `genesis_ref` (1 UTxO spend ≤ 1 lần → policy chạy ≤ 1 lần →
  KHÔNG re-mint, supply tLAMP cố định `A`).
- Bất biến nền sổ↔value tại seed mỗi pot tái dùng `collect.seed_value_ok` + `no_dup_lines` của
  Treasury (Genesis import, KHÔNG copy).

> **Quyết định (4 trục):** v1 Genesis tập trung **lớp logic chia + circulating + builder offchain**
> (cốt lõi, test pass FULL) + **chứng minh bất biến onchain bằng pure-fn lib + test**. Wrapper
> `genesis_pot`/`genesis_mint` cung cấp tách-hash + one-shot mint. KHÔNG sửa `custody.ak`/
> `custody_seed.ak` đã audit (trục bền vững: giảm bề mặt hồi quy).

---

## 5. Phản biện đã đóng (chi tiết §SPEC.md "Tự tấn công")

| Đòn tấn công | Đóng bằng |
|---|---|
| Chia 95/5 rơi token lẻ | G-SPLIT dồn remainder vào pot đầu → Σ==A tuyệt đối (test remainder ≠ 0) |
| Reserve không tách thật khỏi Treasury | 4 custody UTxO + 4 script hash riêng; chi Treasury tiêu UTxO Treasury, Reserve bất biến |
| circulating sai khi đa pot | định nghĩa `A − Σ pots`; test genesis=0, sau vest > 0, sau thu phí Treasury vẫn đúng |
| mint dư/thiếu | G-MINT-1: mint == A oil + 4 NFT, không hơn |
| token rơi ra ngoài 4 pot | G-SUM + builder dựng đúng 4 output, Σ output value == mint |
| seed sổ ≠ value (kế toán hỏng) | G-SEED tái dùng seed_value_ok + no_dup_lines |

---

## 6. Phụ thuộc

- **`LAMP/Treasury`** (custody + seed + collect lib) — Genesis import, tái dùng, KHÔNG sửa.
- **`LAMP/Distribution`** — Distribution pot là nguồn cho Capped Drop (van D). Genesis chỉ seed
  pot; cơ chế vest nằm ở Distribution.
- tLAMP token (Faucet, name `#"744c414d50"` "tLAMP", 6 decimals) — Genesis dùng làm asset mint.
