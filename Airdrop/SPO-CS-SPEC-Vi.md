# Airdrop — Phần SPO (Staking Pool Operator, 5M) + CS (Community Supporter, 15M) — Đặc tả cơ chế

> Mô hình **STAKE-WEIGHTED** (chủ dự án chốt 2026-07-11, thay hoàn toàn CS log-score cũ).
> Nguồn tổng: `Airdrop/AIRDROP-V2-SPEC-Vi.md`. Phần delegator (100M) tách riêng.
> Đơn vị: **1 LAMP = 10⁶ oildrop**. Hai pot RÕ RÀNG:
> **SPO = 5.000.000 LAMP** + **CS = 15.000.000 LAMP** (Community Supporter).
> Tổng SPO + CS = **20.000.000 LAMP**. Tỷ lệ SPO:CS = 5:15 = **25:75**.

---

## 0. Nguyên tắc thiết kế (bất biến)

Cả 3 pot Airdrop (Delegator 100M · SPO 5M · CS 15M) đều chia **∝ trọng số stake**. Mọi
đại lượng đo phần thưởng đều **neo stake ADA** — thứ **chi phí-giả-mạo-cao, không ngụy tạo
được**. Đây là điều làm mô hình **đơn giản hơn** (bỏ toàn bộ điểm off-chain) và **chống
sybil tốt hơn** (thước đo duy nhất là stake trên chuỗi, giống nền an ninh kinh tế Cardano).

Khác biệt giữa 3 pot chỉ ở **NGUỒN trọng số stake**, không ở loại đại lượng.

## 1. Vì sao stake-weighted = chống sybil (neo đại lượng tốn kém)

CS log-score cũ chuyển thước đo phân phối sang một đại lượng **chi phí-giả-mạo-gần-0**
(điểm tương tác off-chain), biến pot CS 15M thành sân chơi cho farmer hoặc "kẻ kiểm soát
AffiSo". Stake-weighted **đảo lại đúng nền an ninh kinh tế của Cardano**:

- Trọng số = stake ADA thật, đã tồn tại on-chain, **không nhân bản được**. Muốn tăng trọng
  số phải khoá vốn thật.
- **Splitting pool / tạo account giả tự vô hiệu**: tách pool làm loãng delegation (không
  nhân được stake); nghìn account rỗng có stake 0 → trọng số 0 → không nhận gì.
- Không còn "điểm" để cày, không còn AffiSo làm điểm-tin-cậy-đơn cho việc tính điểm — AffiSo
  chỉ **thu thập & công bố** dữ liệu stake/vote, ai cũng tính lại được (§7).

Cái giá phải trả: mô hình không còn thưởng "nội dung/chat" trực tiếp. Nhưng phần công-nhận
cộng đồng vẫn có, qua **bình chọn có-trọng-số-stake** (pot CS, §4) — người giúp cộng đồng
được stakeholder công nhận, và sức nặng công nhận = stake của người được giúp.

## 2. Đăng ký + DID (điều kiện vào pot)

- **Delegator** đăng ký bằng chữ ký reward stake key (mẫu `spo_register.ts`) — để map
  `stake_address → payment_address` và xác nhận người thật quan tâm (opt-in).
- **SPO** đăng ký bằng chữ ký reward stake key của pool — để nhận thưởng đúng operator.
- **CS (supporter)** cần **DID sinh trắc** (PhoenixKey) vì supporter có thể là **bất kỳ ai**
  (không nhất thiết vận hành pool) — DID chặn 1 người tạo nhiều supporter-id ảo để gom phiếu.
  *Lưu ý:* trọng số CS vẫn neo stake (của người bình chọn), DID chỉ dedupe danh tính người
  **nhận** thưởng CS.

## 3. Ba pot — công thức trọng số

Ký hiệu: `Split(weights, potOil, capOil?)` = chia `potOil` cho danh sách `{id, stake}` theo
largest-remainder (Hamilton), bảo toàn tuyệt đối `Σ = potOil` (khi `capOil = null`). Hiện
thực: `cs_score.ts::splitByStake` (tái dùng `computeEntitlements` của TIGER — 1 nguồn thuật
toán, đã chạy thật trên Preview).

### 3.1. Pot Delegator (100M) — trọng số = stake của CHÍNH delegator

```
weight_Delegator(d) = accStake(d) = Σ_{e trong cửa sổ, đủ điều kiện giữ ≥N} active_stake_d(e)
E(d) = Split({d ↦ accStake(d)}, 100.000.000 LAMP)
```
GIỮ nguyên `delegator_entitlement.ts` (mọi pool, đăng ký, cửa sổ `[E_open, E_cut)`, §1
AIRDROP-V2). Không đổi.

### 3.2. Pot SPO (5M) — trọng số = stake CHẢY VÀO POOL

Reward SPO tỉ lệ **lượng stake-đã-đăng-ký chảy vào pool của họ** (delegation họ hút/giữ):

```
weight_SPO(i) = Σ_{d đã đăng ký, delegate vào pool của i} accStake(d)
reward_SPO(i) = Split({i ↦ weight_SPO(i)}, 5.000.000 LAMP)
```
Hiện thực: `splitSpoPot(spoWeights, SPO_POT_OIL)`.

### 3.3. Pot CS (15M) — trọng số = stake của người BÌNH CHỌN

Reward supporter tỉ lệ **tổng stake của các delegator đã bình chọn rằng họ được j giúp**:

```
weight_CS(j) = Σ_{d bình chọn j} allocation_d(j)          (xem quy tắc §3.4)
reward_CS(j) = Split({j ↦ weight_CS(j)}, 15.000.000 LAMP)
```
Hiện thực: `splitCsPot(csWeights, CS_POT_OIL)`. `csWeights[{supporter_id, weight_stake}]` do
AffiSo/ProofChat thu & xuất.

### 3.4. Quy tắc bình chọn — chống double-count

Mỗi delegator đã đăng ký có **"phiếu-stake" = stake của họ** (`accStake(d)`), và phân bổ cho
≥0 supporter:

```
Σ_j allocation_d(j) ≤ accStake(d)        (tổng phân bổ 1 delegator ≤ stake của họ)
```

- **Mặc định:** delegator dồn **toàn bộ phiếu-stake cho 1 supporter** (`allocation = accStake`).
- **Tuỳ chọn:** chia đều cho k supporter họ chọn (`allocation = accStake / k` mỗi người).
- Trần trên bảo đảm **không delegator nào bơm phiếu vượt stake thật** → tổng trọng số CS toàn
  cục ≤ tổng stake đã đăng ký → không double-count, neo chặt vào stake.

## 4. Phân biệt hai vai trò SPO (Staking Pool Operator) vs CS (Community Supporter) (BẢNG so sánh)

Cả hai đều stake-weighted (chống sybil), khác **NGUỒN** trọng số:

| Trục | **SPO — Staking Pool Operator** (5M) | **CS — Community Supporter** (15M) |
|---|---|---|
| Ai đủ tư cách | Nhà vận hành pool (đăng ký reward stake key) | **Bất kỳ ai** hỗ trợ cộng đồng (không cần vận hành pool) |
| Trọng số neo vào | **Stake CHẢY VÀO POOL** — delegation của người đã đăng ký ủy thác vào pool họ | **Stake của người ĐƯỢC-GIÚP** — tổng phiếu-stake bình chọn cho họ |
| Thưởng điều gì | Thu hút & **giữ** được nhiều delegation | Được stakeholder **công nhận đã giúp** |
| Cần DID? | Không (đủ chữ ký pool) | **Có** (supporter có thể là bất kỳ ai → DID dedupe danh tính nhận) |
| Nguồn dữ liệu | Delegation on-chain (Blockfrost account history) | Vote có-trọng-số-stake (AffiSo/ProofChat, §3.4) |
| Chống sybil bằng | Splitting pool làm loãng delegation → tự vô hiệu | Phiếu-stake ≤ stake thật của người bầu → không bơm được |
| Hàm chia | `splitSpoPot` | `splitCsPot` |

Ý nghĩa: một SPO stake pledge nhỏ nhưng **hút được nhiều delegation thật** vẫn thắng lớn ở
pot SPO; một người **không vận hành pool** nhưng được nhiều stakeholder lớn công nhận đã giúp
vẫn thắng lớn ở pot CS. Cả hai không mua được bằng account giả.

## 5. Cap tuỳ chọn mỗi-người (chống cá voi)

`Split` nhận tham số **`capOil` tuỳ chọn** (như ETD `TIGER/offchain/src/entitlement.ts`): người chạm trần
ghim ở cap, phần dôi chia lại theo tỷ lệ stake cho người chưa chạm (water-filling); phần
không chia được do cap → **leftover về Treasury**. **Mặc định `capOil = null`** (không cap).
Đây là tham số quản trị, công bố mỗi đợt nếu bật.

## 6. Bảo toàn & largest-remainder

Mọi tiền là **BigInt oildrop**. Chia bằng **largest-remainder (Hamilton)** — trùng thuật
toán token-side đã chạy thật trên Preview:

- `cap = null` ⇒ `Σ reward = potOil` (dư floor gom về người stake lớn nhất) — **bảo toàn tuyệt đối**.
- Không ai stake > 0 (mảng rỗng / toàn 0) ⇒ `Σ reward = 0`, **leftover = potOil** (về Treasury).
- 1 người nhận duy nhất ⇒ nhận **toàn bộ pot**.
- `cap > 0` ⇒ mỗi `reward ≤ cap`; phần chặn bởi cap → leftover.

## 7. Minh bạch — cộng đồng kiểm chứng lại

Mỗi đợt AffiSo công bố **weights snapshot** — mỗi dòng `(pot, id, stake_weight, reward_oil)`:

- **Merkle root ghi on-chain** trong datum tx phân phối (tái dùng `airdrop_pool.ak`), lá =
  `H(id ‖ reward_oil)`; toàn bộ dữ liệu weights đăng công khai ở magiclamp.network/forum.
- Công thức **tất định + neo stake on-chain** → **bất kỳ ai tự tính lại** `weight` từ dữ liệu
  delegation/vote công khai, chạy lại `splitByStake`, dựng lại cây, đối chiếu root on-chain.
- Với CS: dữ liệu vote (delegator → supporter, allocation) công khai; ai cũng verify được
  `Σ allocation_d ≤ accStake(d)` (không ai bơm phiếu vượt stake) và tổng weight mỗi supporter.
- **Cửa sổ khiếu nại 1 epoch** trước mint; AffiSo đặt **bond bị slash** nếu gian lận bị chứng minh.

## 8. Điểm còn phải chốt (giao quản trị / đợt-1 GreenSun)

- `N` (số epoch giữ delegation tối thiểu cho accStake) — mặc định 2.
- `capOil` mỗi pot SPO/CS — mặc định null; bật nếu cần chống cá voi.
- Quy tắc allocation CS (§3.4): dồn-1 vs chia-đều — công bố mỗi đợt.
- Số bond AffiSo + luật slash + trọng tài khiếu nại.
- SPO/CS drip 1 root tĩnh hay per-epoch (SetRoot) — xem AIRDROP-V2 §2.

## 9. Tái dùng code — KHÔNG viết validator mới

- **On-chain:** `airdrop_pool.ak` (Claim/Sweep) + `airdrop_nft.ak` + marker nullifier — giữ
  nguyên. SPO/CS chỉ là **nguồn entitlement** khác nạp vào cùng bộ máy, y như delegator.
- **Off-chain:** `cs_score.ts` (`splitByStake` + `splitSpoPot` + `splitCsPot`, tái dùng
  `computeEntitlements` của TIGER) + `spo_register.ts` (đăng ký). AffiSo/ProofChat xuất
  `spoWeights` (stake vào pool) + `csWeights` (stake bình chọn) theo schema §7.
