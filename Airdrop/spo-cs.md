# Airdrop — Phần SPO (Staking Pool Operator, 5M) + CS (Community Supporter, 15M) — Đặc tả cơ chế

> Mô hình **STAKE-WEIGHTED** (chủ dự án chốt 2026-07-11, thay hoàn toàn CS log-score cũ).
> Nguồn tổng: `Airdrop/CONTRACT.md`. Phần delegator (100M) tách riêng.
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

Ký hiệu: `Split(weights, potOildrop, capOildrop?)` = chia `potOildrop` cho danh sách `{id, stake}` theo
largest-remainder (Hamilton), bảo toàn tuyệt đối `Σ = potOildrop` (khi `capOildrop = null`). Hiện
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
Hiện thực: `splitSpoPot(spoWeights, SPO_POT_OILDROP)`.

### 3.3. Pot CS (15M) — trọng số = stake của người BÌNH CHỌN

Reward supporter tỉ lệ **tổng stake của các delegator đã bình chọn rằng họ được j giúp**:

```
weight_CS(j) = Σ_{d bình chọn j} allocation_d(j)          (xem quy tắc §3.4)
reward_CS(j) = Split({j ↦ weight_CS(j)}, 15.000.000 LAMP)
```
Hiện thực: `splitCsPot(csWeights, CS_POT_OILDROP)`. `csWeights[{supporter_id, weight_stake}]` do
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
| Nguồn dữ liệu | Delegation on-chain (Blockfrost account history) | Bảng phân bổ theo stake (AffiSo/ProofChat, §3.4) |
| Chống sybil bằng | Splitting pool làm loãng delegation → tự vô hiệu | Phiếu-stake ≤ stake thật của người bầu → không bơm được |
| Hàm chia | `splitSpoPot` | `splitCsPot` |

> **Ranh giới — đây KHÔNG phải bầu cử quản trị.** Toàn bộ ngôn ngữ "phiếu-stake / bình chọn /
> phân bổ" ở §3.3, §3.4 và bảng trên chỉ mô tả một **hàm phân bổ**: nó trả lời "ai nhận bao
> nhiêu" từ dữ liệu công khai, **không ràng buộc ai phải làm gì**. Quản trị LAMP đi đường khác
> và **KHÔNG token-weighted**: cử tri là **cá nhân** (1 PhoenixKey DID sinh trắc), quyền biểu
> quyết là tích nhân nhiều tham số — nguồn duy nhất `Governance/VotingPower/CONTRACT.md`.
> Không được suy ra bất kỳ quyền quản trị nào từ trọng số ở đây, và ngược lại.

Ý nghĩa: một SPO stake pledge nhỏ nhưng **hút được nhiều delegation thật** vẫn thắng lớn ở
pot SPO; một người **không vận hành pool** nhưng được nhiều stakeholder lớn công nhận đã giúp
vẫn thắng lớn ở pot CS. Cả hai không mua được bằng account giả.

## 5. Trần mỗi-người — CẤM BẬT cho pot chia-theo-stake

`Split` nhận tham số **`capOildrop` tuỳ chọn** (dùng chung máy với ETD
`TIGER/offchain/src/entitlement.ts`): người chạm trần ghim ở cap, phần dôi chia lại theo tỷ lệ
stake cho người chưa chạm (water-filling); phần không chia được do cap → **leftover về Treasury**.

**Ràng buộc (bất biến, không phải mặc định bật/tắt được): `capOildrop` PHẢI luôn `null` cho cả
ba pot Airdrop** (Delegator 100M · SPO 5M · CS 15M). Tham số vẫn còn trong chữ ký hàm vì máy
chia dùng chung với TIGER, nhưng ở đây **không có trường hợp hợp lệ nào để truyền khác `null`**.

**Vì sao — đại số.** Gọi `n` số ví tách ra từ một người, tổng stake giữ nguyên:

- **Không trần**: `Split` chia pot **cố định** theo tỉ lệ `accStake`. Tách `n` ví giữ tổng stake
  không đổi ⇒ tổng nhận **KHÔNG ĐỔI**, trong khi chi phí (phí giao dịch, min-ADA, đăng ký, DID)
  **tăng theo `n`** ⇒ tách ví bị **trội tuyệt đối**, cơ chế tự vô hiệu hoá sybil. An toàn.
- **Có trần `c`**: một ví nhận `min(phần, c)`; `n` ví tách ra nhận tới `n·c`. Với người có phần
  `> c`, mỗi lần tách thêm một ví là **tăng thêm tới `c`** ⇒ **chính cái trần đặt ra để chặn cá
  voi là thứ TRẢ TIỀN cho việc tách ví.** Trần càng chặt, thưởng cho tách càng cao.

**Bất biến rút ra (áp cho mọi trần trong hệ, không riêng Airdrop):**

> Trần đặt trên **trục giả-được** thì an toàn; trần đặt trên **trục bảo-toàn** thì tự mở cửa tách.

`accStake` là **trục bảo-toàn** (tách ví không sinh thêm stake, chỉ chia lại) ⇒ trần đặt trên nó
luôn nằm ở vế sai. Muốn chặn cá voi thì phải chặn ở trục giả-được — tức phải có bất biến
**một-người-một-DID ép được on-chain** trước đã; hôm nay PhoenixKey chỉ ép được **một tên ↔ một
DID** (`pa2_uniqueness_logic.ak`, `key = blake2b_256(did)`), chưa đủ. Chừng nào chưa đủ, bật trần
là tự mở cửa sybil.

Ghi chú độ nghiêm trọng — thành thật: hôm nay chuyện này **chưa cắn**, vì `capOildrop` đang là
`null` ở mọi nơi gọi và `splitCsPot`/`splitSpoPot` chia một pot **cố định**. Ràng buộc này chặn
**việc bật nó về sau**, chứ không sửa một lỗ đang chảy.

## 6. Bảo toàn & largest-remainder

Mọi tiền là **BigInt oildrop**. Chia bằng **largest-remainder (Hamilton)** — trùng thuật
toán token-side đã chạy thật trên Preview:

- `cap = null` ⇒ `Σ reward = potOildrop` (dư floor gom về người stake lớn nhất) — **bảo toàn tuyệt đối**.
- Không ai stake > 0 (mảng rỗng / toàn 0) ⇒ `Σ reward = 0`, **leftover = potOildrop** (về Treasury).
- 1 người nhận duy nhất ⇒ nhận **toàn bộ pot**.
- `cap > 0` ⇒ mỗi `reward ≤ cap`; phần chặn bởi cap → leftover. *(Chỉ là tính chất của máy chia
  dùng chung — **không dùng ở Airdrop**, xem ràng buộc §5.)*

## 7. Minh bạch — cộng đồng kiểm chứng lại

Mỗi đợt AffiSo công bố **weights snapshot** — mỗi dòng `(pot, id, stake_weight, reward_oildrop)`:

- **Merkle root ghi on-chain** trong datum tx phân phối (tái dùng `airdrop_pool.ak`), lá =
  `H(id ‖ reward_oildrop)`; toàn bộ dữ liệu weights đăng công khai ở magiclamp.network/forum.
- Công thức **tất định + neo stake on-chain** → **bất kỳ ai tự tính lại** `weight` từ dữ liệu
  delegation/vote công khai, chạy lại `splitByStake`, dựng lại cây, đối chiếu root on-chain.
- Với CS: dữ liệu vote (delegator → supporter, allocation) công khai; ai cũng verify được
  `Σ allocation_d ≤ accStake(d)` (không ai bơm phiếu vượt stake) và tổng weight mỗi supporter.
- **Cửa sổ khiếu nại 1 epoch** trước mint. Gian lận bị chứng minh trong cửa sổ ⇒ root bị bác,
  đợt đó **không mint**, và bên công bố **mất tư cách công bố các đợt sau** (khoá theo PhoenixKey
  DID, cấm cấp lại qua ví mới / uỷ quyền / proxy). **Không tịch thu bond, không khoá tài sản,
  không chạm phần thưởng đã tính** — theo bất biến cấm-phạt của hệ
  (`_rules/_domain/mechanism-design.md:42,47,50`): phạt chỉ được nhắm vào **phần thưởng CHƯA
  hình thành** và **quyền tham gia**.

### 7.1. Mất-tư-cách răn được tới đâu — và hai ca nó KHÔNG răn được

Nói đúng thứ nó là: mất-tư-cách là **một chi phí đặt lên người còn muốn chơi tiếp**, KHÔNG phải
một cơ chế răn đe tổng quát. Nếu tô mỗi vòng là `r` và hệ số chiết khấu `δ ∈ [0,1)`, thứ cơ chế
này tước được là `r·(1−δ^T)/(1−δ)` với `T` vòng còn lại — **chặn trên bởi `r/(1−δ)`, không phụ
thuộc `T`**. Trong khi cái lợi của một lần công bố root gian lận **tỉ lệ với kích thước pot**
(tới 15M LAMP), một lần, ngay. Hai đại lượng không cùng thang ⇒ hai ca sau **vẫn mở**:

- **Ván cuối / thoát**: người ở vòng cuối mất một thứ có giá trị **bằng 0**. Không răn được.
- **Hối lộ ngoài-hệ**: bên hối lộ chỉ cần trả hơn `r/(1−δ)` — một trần cố định. Không răn được.

(Bond bị slash **cũng không** răn được hai ca này — nó cũng là một hằng số — và còn vi phạm bất
biến. Nên bỏ bond không làm mất sức răn đe nào; nó chỉ bỏ một lời hứa rỗng có kèm vi phạm.)

**Hai ca này xử ở TẦNG KHÁC, không xử bằng phạt.** Theo `mechanism-design.md:51` — *vị trí
đòn-bẩy-lớn mà thưởng-tương-lai của người giữ nhỏ → phạt về cấu trúc không thể tương xứng thiệt
hại → xử bằng **phân tán quyền (M-of-N)*** — lời giải là **không để một tác nhân (AffiSo) đơn
độc quyết root**: root mỗi đợt phải **M-of-N** bên độc lập cùng tính lại và cùng ký, trên đúng
dữ liệu công khai ở §7. Đây là điểm **chưa chốt** (xem §8), và ghi ra ở đây để người sau không
xây tiếp lên giả định rằng cửa sổ khiếu nại đã đủ.

## 8. Điểm còn phải chốt (giao quản trị / đợt-1 GreenSun)

- `N` (số epoch giữ delegation tối thiểu cho accStake) — mặc định 2.
- ~~`capOildrop` mỗi pot SPO/CS~~ — **ĐÃ CHỐT, không còn là điểm mở**: luôn `null`. Bật trần trên
  pot chia-theo-stake là tự mở cửa tách ví — đại số + lý do ở §5. Đưa nó trở lại danh sách mở
  chỉ hợp lệ khi đã có bất biến một-người-một-DID ép được on-chain.
- Quy tắc allocation CS (§3.4): dồn-1 vs chia-đều — công bố mỗi đợt.
- ~~Số bond AffiSo + luật slash~~ — **BỎ HẲN**, chọi bất biến cấm-phạt (§7). Thay bằng: **`M`/`N`
  cho tập bên ký root** + danh sách bên độc lập + trọng tài khiếu nại + thời hạn khoá tư cách
  công bố. Đây mới là chỗ chặn được ván-cuối và hối-lộ (§7.1).
- SPO/CS drip 1 root tĩnh hay per-epoch (SetRoot) — xem AIRDROP-V2 §2.

## 9. Tái dùng code — KHÔNG viết validator mới

- **On-chain:** `airdrop_pool.ak` (Claim/Sweep) + `airdrop_nft.ak` + marker nullifier — giữ
  nguyên. SPO/CS chỉ là **nguồn entitlement** khác nạp vào cùng bộ máy, y như delegator.
- **Off-chain:** `cs_score.ts` (`splitByStake` + `splitSpoPot` + `splitCsPot`, tái dùng
  `computeEntitlements` của TIGER) + `spo_register.ts` (đăng ký). AffiSo/ProofChat xuất
  `spoWeights` (stake vào pool) + `csWeights` (stake bình chọn) theo schema §7.
