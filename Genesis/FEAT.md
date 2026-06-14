# Genesis — FEAT (Đặc tả tính năng / hành vi)

**Trạng thái:** bản thảo 2026-06-09. Bám sát [CONTRACT.md](./CONTRACT.md) (khung interface
lazy-mint đã ghim 2026-06-08). KHÔNG mâu thuẫn contract. Mọi phần còn stub/MVP được đánh dấu
rõ **"MVP/stub, v1.1"**.

> Spec này mô tả **hành vi nhìn thấy được** của Genesis lazy-mint: token tLAMP ra đời thế nào,
> ai được mint, mint vào quota nào, trạng thái bộ đếm trước/sau mỗi thao tác, và vì sao
> "fixed-supply 36 tỷ" KHÔNG cần mint sẵn 36 tỷ token. Người không-kỹ-thuật đọc cũng hiểu hệ
> phát hành vận hành ra sao. KHÔNG đi sâu công thức (xem [MATH](./MATH.md)) hay
> datum/redeemer/validator on-chain (xem [TECH](./TECH.md)) hay lộ trình build/deploy
> (xem [EXEC](./EXEC.md)).

---

## 0. Mục tiêu và phạm vi

### 0.1 Mục tiêu

Genesis là **cổng phát hành DUY NHẤT** của tLAMP (token LAMP testnet, sau là LAMP mainnet). Nó
giải quyết ba nhu cầu, không trộn lẫn:

1. **Bảo đảm tổng cung KHÔNG bao giờ vượt 36 tỷ** — bằng một bộ đếm on-chain đơn điệu (chỉ tăng),
   chặn cứng tại CAP. Đây là toàn bộ ý nghĩa "fixed-supply".
2. **KHÔNG khóa vốn chết** — token chỉ ra đời khi có người cần (lazy-mint). 35.999 tỷ tLAMP chưa
   ai dùng thì KHÔNG tồn tại on-chain → không khóa min-ADA, không phải canh giữ.
3. **Phân tách hai đường phát hành** — Distribution (95%, tới tay user qua Capped Drop) và Reserve
   (5%, DAO rút), mỗi đường có quota riêng, không thể "rút đường này tính vào đường kia".

Mục tiêu cuối của cả dự án: **làm cho LAMP có giá trị**. Genesis phục vụ mục tiêu đó bằng cách
neo niềm tin tổng cung (36 tỷ tuyệt đối, chứng minh được on-chain) — nền tảng để mọi định giá,
governance, và SDK bên thứ ba dựa vào.

### 0.2 Nguyên lý nền (first-principles, từ CONTRACT §1)

> **"Fixed-supply" KHÔNG đòi 36 tỷ token nằm sẵn on-chain. Nó đòi TỔNG phát hành lịch sử KHÔNG
> bao giờ vượt CAP.**

Một bộ đếm on-chain đơn điệu (chỉ tăng, chặn tại CAP) thỏa định nghĩa đó **mạnh hơn, an toàn hơn,
rẻ hơn** so với mô hình cũ "mint hết 36 tỷ rồi để nằm chờ" (branch `feat/genesis-4pots`, đã BỎ).
Token chưa mint = không tồn tại = không bị tấn công, không khóa min-ADA.

> **fixed-supply = mint cumulative ≤ CAP 36 tỷ, đơn điệu tăng, KHÔNG burn.** (CONTRACT §0)

### 0.3 KHÔNG thuộc spec này (ranh giới)

- Cơ chế Capped Drop redeem (bằng chứng claim của user) — **MVP/stub, v1.1**. Hiện đường
  DistributionVest gate bằng authority keyhash (committee stub), chưa nối Capped Drop.
- Treasury custody / Deposits (module riêng) — Genesis chỉ định nghĩa `circulating` tham chiếu
  chúng (CONTRACT §6), không sở hữu chúng.
- Định giá LAMP↔USD/ADA (Oracle), governance Voting Power — ngoài Genesis.

---

## 1. Vai trò (ai làm gì)

| Vai | Làm gì | Gate |
|---|---|---|
| **Deployer** (foundation) | Chạy genesis một lần: consume UTxO seed → mint thread NFT `SUPPLY` → tạo SupplyState UTxO (bộ đếm) | one-shot (UTxO seed tiêu 1 lần duy nhất) |
| **Distribution authority** (committee stub) | Mint tLAMP qua đường `DistributionVest` (95% quota) → token tới user | chữ ký `dist_authority` (M-of-N stub MVP) |
| **Bất kỳ ai (Reserve trigger)** | Mint tLAMP qua đường `ReserveDraw` (5% quota) — permissionless | KHÔNG chữ ký; ÉP tx spend ReserveMeter NFT (đi qua reserve_meter — release function tất định) |
| **Bất kỳ ai (read-only)** | Đọc SupplyState datum → biết `minted_total`, quota còn lại, `circulating` | không cần — datum công khai on-chain |

**MVP/stub, v1.1:** authority hiện là **keyhash param hóa** (committee cho Distribution, DAO cho
Reserve). Khi deploy self-test, cả hai authority = ví deployer (1-of-1). v1.1: DistributionVest
nối Capped Drop redeem (redeemer mang bằng chứng claim của user, thay chữ ký committee); ReserveDraw
nối governance proposal.

---

## 2. Ba tầng script — ai phụ thuộc ai (CONTRACT §3)

Genesis gồm **ba script tách bạch**, phụ thuộc TUYẾN TÍNH (mỗi tầng chỉ biết tầng trên, KHÔNG
vòng lặp policy-id):

```
  (1) thread_nft policy   ── param = genesis_ref (UTxO seed one-shot)
        │  mint đúng 1 (SUPPLY, +1) MỘT lần → SupplyState là DUY NHẤT
        ▼
  (2) lamp_mint policy    ── param = thread_policy + SUPPLY name + authority
        │  GATE: mọi tx mint tLAMP PHẢI consume + recreate SupplyState.
        │  Toàn bộ luật cap/quota/monotonic/no-burn Ở ĐÂY.
        ▼
  (3) supply_state spend   ── param = lamp_policy
        │  SupplyState UTxO ngồi tại đây. Spend hợp lệ ⟺ tx CÓ mint tLAMP.
        │  Ủy quyền toàn bộ kiểm tra transition cho (2).
```

**Vì sao luật đặt ở MINT policy (2), không ở spend (3)** (CONTRACT §3, 4 trục):
- *Tối ưu eUTXO/ExUnit:* luật chạy 1 lần ở mint redeemer; spend (3) chỉ check "có mint" → rẻ.
- *An toàn:* mint là điểm DUY NHẤT token ra đời → cap-enforce ngay tại nguồn, không đường lách.
- *Bền vững/nâng cấp:* spend (3) tối giản → ít bề mặt lỗi; nâng luật = nâng (2).
- *Một nguồn sự thật:* không phân tán luật cap 2 nơi dễ lệch.

---

## 3. Trạng thái cốt lõi: SupplyState (bộ đếm)

SupplyState là một UTxO DUY NHẤT, mang thread NFT `SUPPLY`, datum bốn số (đơn vị **oil**, 1 tLAMP
= 10^6 oil):

| Trường | Ý nghĩa | Tính chất |
|---|---|---|
| `dist_minted` | oil tLAMP đã mint qua đường Distribution | đơn điệu tăng |
| `reserve_minted` | oil tLAMP đã mint qua đường Reserve | đơn điệu tăng |
| `dist_cap` | trần Distribution = `34_200_000_000 × 10^6` (95%) | BẤT BIẾN qua transition |
| `reserve_cap` | trần Reserve = `1_800_000_000 × 10^6` (5%) | BẤT BIẾN qua transition |

`minted_total = dist_minted + reserve_minted`. Bất biến nền: `minted_total ≤ dist_cap + reserve_cap
= 36_000_000_000_000_000 oil = 36 tỷ tLAMP` (CONTRACT §2; `constants.ak:24` test `caps_sum_to_total`).

> **Điểm mấu chốt:** CAP nằm TRONG datum, KHÔNG phải tổng token tồn tại on-chain. Dẫn chứng tx thật:
> deploy SupplyState `e21d2cb1…` (minted=0), mint 100 tLAMP `e8135d28…` (dist_minted=100e6), mint
> thêm 60 `ed7377fa…` (dist_minted 100→160). Tổng tLAMP on-chain = 160, nhưng datum vẫn ghi cap 36
> tỷ. SUPPLY NFT `mint_or_burn_count` vẫn = 1 sau mọi lần mint (NFT tái dùng, không mint lại). Xem
> [EXEC §dẫn chứng](./EXEC.md).

---

## 4. Luồng thao tác (flow)

### 4.1 Genesis (deploy — một lần duy nhất)

**Trạng thái trước:** chưa có SupplyState; ví deployer có ≥ 1 UTxO.

1. Deployer chọn UTxO đầu tiên của ví làm `genesis_ref` (seed one-shot).
2. Apply `genesis_ref` vào `thread_nft` policy → ra `thread_policy` cố định.
3. Tx **consume `genesis_ref`** + **mint đúng 1 `(SUPPLY, +1)`** + tạo SupplyState UTxO tại địa
   chỉ `supply_state` script, datum = `{dist_minted:0, reserve_minted:0, dist_cap, reserve_cap}`.

**Trạng thái sau:** SupplyState UTxO DUY NHẤT tồn tại, mang thread NFT, bộ đếm = 0.

> Vì `genesis_ref` chỉ spend được 1 lần trong lịch sử chain, `thread_nft` policy chỉ chạy ≤ 1 lần
> → KHÔNG thể tạo thread NFT thứ 2 → KHÔNG thể dựng SupplyState giả (đóng vector A3 từ gốc). Code:
> `thread_nft.ak:22` `expect list.any(... == genesis_ref)`. Dẫn chứng: deploy `e21d2cb1…`.

### 4.2 Mint qua DistributionVest (95% quota)

**Trạng thái trước:** SupplyState `S = {dist_minted, reserve_minted, dist_cap, reserve_cap}`.

1. Authority Distribution xây tx: spend SupplyState (redeemer `Advance`) + mint `Δ` oil tLAMP
   (redeemer `DistributionVest`) + recreate SupplyState' tại CÙNG địa chỉ script + trả `Δ` tLAMP
   cho recipient + ký bằng `dist_authority`.
2. `lamp_mint` ép: `Δ > 0`, `S'.dist_minted = S.dist_minted + Δ`, `S'.reserve_minted` KHÔNG đổi,
   caps KHÔNG đổi, `S'.dist_minted ≤ dist_cap`.

**Trạng thái sau:** `dist_minted += Δ`; `Δ` tLAMP nằm trong ví recipient; thread NFT về lại
SupplyState'.

> Dẫn chứng: `e8135d28…` mint 100 tLAMP DistributionVest (dist_minted 0→100e6, block 4361137).

### 4.3 Mint qua ReserveDraw (5% quota)

Y hệt 4.2 nhưng redeemer `ReserveDraw`, cộng vào `reserve_minted`, chặn tại `reserve_cap`,
`dist_minted` KHÔNG đổi. Gate KHÔNG dùng chữ ký: tx PHẢI spend đúng 1 ReserveMeter NFT →
permissionless, đi qua `reserve_meter` (Reserve module) ép δ ≤ max_draw + reserve_minted ≤
approved_cumulative(epoch) (release function tất định). Không ai rút tay.

### 4.4 Đọc trạng thái (read-only)

Bất kỳ ai đọc SupplyState datum → tính được:
- `minted_total = dist_minted + reserve_minted` (đã phát hành).
- Quota Distribution còn lại = `dist_cap − dist_minted`; Reserve còn lại = `reserve_cap − reserve_minted`.
- `circulating = minted_total − Σ(Treasury + Deposits tLAMP held)` (CONTRACT §6, `circulating.ts:25`).

---

## 5. Ba POT — KHÔNG có "Distribution pot chứa token" (CONTRACT §6)

| POT | Bản chất | On-chain |
|---|---|---|
| **Reserve** | quota CHƯA mint = `reserve_cap − reserve_minted` | **ẢO** (số trong datum), KHÔNG UTxO chứa token |
| **Treasury** | custody pot thật, nhận tLAMP đã mint | UTxO thật (module Treasury) |
| **Deposits** | custody pot thật (app deposits) | UTxO thật |

"Distribution" KHÔNG phải pot chứa token — nó là **QUOTA mint** (đường ra của lazy-mint về tay
user qua Capped Drop). tLAMP mint theo DistributionVest đi **thẳng tới user**, không qua pot trung
gian.

`circulating` chỉ trừ token ĐÃ mint mà đang nằm trong custody (Treasury/Deposits). Reserve KHÔNG
trừ — vì quota chưa mint thì token đó chưa tồn tại, không nằm trong `minted_total` (test
`circulating.test.ts` "Reserve KHÔNG trừ").

---

## 6. Vector tấn công người dùng cần biết đã đóng (CONTRACT §7)

Mọi vector A1–A12 đều có test negative (Aiken + offchain). Người vận hành cần biết hệ chặn được:

| # | Tấn công | Người dùng yên tâm vì | Test |
|---|---|---|---|
| A1 | Mint vượt cap 36 tỷ | `minted' ≤ cap'` ép cứng | `mint_exceed_dist_cap`/`reserve_cap` |
| A2 | Mint lậu (không qua bộ đếm) | mọi mint PHẢI consume SupplyState | `mint_no_supplystate` |
| A3 | Tạo bộ đếm giả (2 thread NFT) | thread NFT one-shot | `thread_without_genesis`/`mint_two_threads` |
| A4 | Lùi bộ đếm (rollback) | monotonic guard | `mint_rollback_dist` |
| A5 | Rút Distribution tính vào Reserve | redeemer khóa quota | `distvest_touches_reserve` |
| A6 | Burn lén (Δ<0) / no-op | `Δ > 0` | `mint_negative`/`mint_zero` |
| A7 | Double-satisfaction (2 SupplyState) | đúng 1 in + 1 out theo NFT | `two_supplystate_inputs` |
| A8 | Mint nhiều, ghi sổ ít | cùng một Δ cho mint + datum | `delta_mismatch` |
| A9 | Nới cap qua transition | caps bất biến | `widen_dist_cap` |
| A10 | Mint thiếu chữ ký authority | authority gate | `mint_no_authority` |
| A11 | Mint asset name lạ cùng policy | đúng 1 name = tLAMP | `mint_extra_name` |
| A12 | Phá thread (spend không mint) | spend đòi Δ>0 | `spend_without_mint` |

Chi tiết cơ chế chặn từng vector → [MATH §định lý](./MATH.md) + [TECH §invariant](./TECH.md).

---

## 7. Trạng thái triển khai (tóm tắt — chi tiết EXEC)

- **onchain:** `thread_nft.ak` (tầng 1) + `lamp_mint.ak` (tầng 2) + `supply_state.ak` (tầng 3)
  + lib `types.ak`/`constants.ak`/`util.ak`. Test Aiken: happy 2 đường + biên cap + toàn bộ A1–A12.
- **offchain:** `types.ts`/`datum.ts` (codec byte-perfect) + `supplyState.ts` (cap math fail-fast)
  + `mintBuilder.ts` + `circulating.ts`. Test vitest: codec round-trip, cap math, circulating.
- **scripts:** `01_deploy_lazymint.ts` (deploy SupplyState + mint thử, SUBMIT=false mặc định).
- **đã live Preview:** deploy + lazy-mint + mint-thêm (dẫn chứng tx ở [EXEC](./EXEC.md)).

**Còn stub/MVP (v1.1):** Capped Drop redeem cho DistributionVest; nối ReserveDraw vào governance
proposal thật (hiện gate keyhash stub).
