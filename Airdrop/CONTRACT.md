# Airdrop v2 — Đặc tả tổng (120 triệu LAMP, 3 pot, cùng bộ máy Merkle-airdrop)

> Chủ dự án chốt 2026-07-10. Bản này thay model v1 (TIGER-only auto-snapshot).
> Đơn vị: **1 LAMP = 10⁶ oildrop** (hằng số `OILDROP_PER_LAMP` trong `offchain/src/constants.ts`).
> Cơ chế on-chain: xem `README.md`. Phần SPO/CS: xem `spo-cs.md` (KHÔNG lặp ở đây).

---

## 0. Tổng quan — 1 bộ máy, 3 pot ngân sách (tất cả STAKE-WEIGHTED)

Tổng Airdrop v2 = **120.000.000 LAMP**, chia **3 pot ngân sách** dưới **cùng** bộ máy
Merkle-airdrop (`airdrop_nft.ak` + `airdrop_pool.ak` + marker nullifier).
**KHÔNG viết validator mới.** Cả **3 pot đều chia ∝ trọng số stake** (largest-remainder,
BigInt oildrop) — chỉ khác **NGUỒN** trọng số. Mô hình cũ "CS log-score" đã bỏ hoàn toàn
(2026-07-11): đơn giản hơn + chống sybil tốt hơn vì mọi thước đo đều neo stake ADA.

| Pot | Ngân sách | Đối tượng | Trọng số (nguồn stake) | Đặc tả |
|---|---|---|---|---|
| **Delegator** | **100.000.000 LAMP** | Delegator Cardano (mọi pool) đã đăng ký | stake của **CHÍNH họ** (accStake mọi pool) | §1–§5 (bản này) |
| **SPO** (Staking Pool Operator) | **5.000.000 LAMP** | SPO đã đăng ký | Σ stake delegator (đã đăng ký) **CHẢY VÀO POOL** của họ | `spo-cs.md` |
| **CS** (Community Supporter) | **15.000.000 LAMP** | Người hỗ trợ cộng đồng (bất kỳ ai, có DID) | Σ stake của delegator đã **BÌNH CHỌN** rằng họ đã giúp | `spo-cs.md` |

Tỷ lệ **SPO:CS = 5:15 = 25:75**. Tổng SPO+CS = 20M.

Bộ máy on-chain dùng chung: mỗi **nguồn entitlement** = một snapshot `{address, amount}` nạp
vào cùng loại pool. SPO và CS tính trong `cs_score.ts` (`splitSpoPot` / `splitCsPot`, đều gọi
`splitByStake` — tái dùng `computeEntitlements` của TIGER). Mỗi snapshot là một cây Merkle →
1 `merkle_root`. Claim bằng Merkle proof, marker NFT chống double-claim, phần dư Sweep về
Treasury (README §1–§3).

---

## 1. Pot Delegator (100M) — mô hình mới

### 1.1. Khác biệt cốt lõi với v1 (TIGER auto-snapshot)

| Trục | v1 (TIGER-only) | v2 (Delegator) |
|---|---|---|
| Tham gia | Tự động (auto-include) | **PHẢI ĐĂNG KÝ** (opt-in, ký reward stake key) |
| Nguồn stake tính thưởng | Chỉ pool TIGER | **Bất kỳ pool Cardano** |
| Cửa sổ | Snapshot retroactive trước cutoff | Cửa sổ mới `[E_open, E_cut)` |
| Địa chỉ nhận | pkh suy từ stake pool TIGER | `payment_address` khai lúc đăng ký |

Lý do đăng-ký thay vì auto: (a) phải map `stake_address → payment_address` để biết nhả
LAMP về đâu (claim bằng payment addr, không phải stake addr); (b) opt-in = bằng chứng
người thật quan tâm, giảm bụi ví chết; (c) pháp lý sạch — người dùng chủ động ghi danh.

### 1.2. Đăng ký = ký bằng reward stake key

Theo đúng mẫu `spo_register.ts` (dùng **reward stake key**, KHÔNG cần cold/KES/VRF):

1. Ví chứng minh quyền sở hữu `stake_address` bằng chữ ký Ed25519 trên message chuẩn
   (nonce + timestamp + `payment_address` + network).
2. Off-chain verify chữ ký → derive `stake_address` từ pubkey → khớp `stake_address` khai.
3. Map `stake_address → payment_address` được ký cứng → nơi nhận LAMP, **bất biến** sau khi nộp.

Khác `spo_register.ts` ở chỗ đây là **delegator** (ví thường), không cần là operator pool.
Chữ ký chứng minh: "tôi kiểm soát stake key này" (đủ để tính ∝stake của chính nó).

### 1.3. Ví CHƯA stake → hướng dẫn stake trước

Thưởng ∝stake ⇒ **phải có stake thật** mới có phần. Ví chưa delegate:

- Công cụ đăng ký phát hiện `active_stake = 0` ở mọi epoch trong cửa sổ → **từ chối** đăng ký,
  kèm hướng dẫn: **stake vào pool TIGER, hoặc bất kỳ pool Cardano nào**, chờ delegation
  có hiệu lực (≥ N epoch, §1.5), rồi quay lại đăng ký.
- KHÔNG ưu tiên pool TIGER trong công thức — mọi pool tính như nhau (khác hẳn v1). Gợi ý
  pool TIGER chỉ là mặc-định-thân-thiện, không bắt buộc.

### 1.4. Cửa sổ snapshot

- `E_open` — epoch mở đăng ký (công bố công khai).
- `E_cut` — epoch cutoff (nửa mở): chỉ tính các epoch **`e ∈ [E_open, E_cut)`**. Loại chính
  `E_cut` để khách quan trước mọi tín hiệu thưởng (cùng nguyên tắc nửa-mở của TIGER).
- Với mỗi ví đã đăng ký, đọc `active_stake_i(e)` **qua bất kỳ pool** ở từng epoch `e` trong cửa sổ
  (Blockfrost `/accounts/{stake_address}/history`).

### 1.5. Chống "stake 1 epoch rồi rút" — yêu cầu giữ ≥ N epoch

Nếu chỉ cộng thô mọi epoch có stake, kẻ tấn công stake 1 epoch sát cutoff rồi rút vẫn ăn phần.
Chặn bằng **điều kiện giữ delegation liên tục ≥ N epoch**:

- Ví **đủ tư cách** khi có ít nhất một chuỗi **≥ N epoch liên tiếp** với `active_stake > 0`
  trong `[E_open, E_cut)`.
- `accStake_i = Σ active_stake_i(e)` chỉ cộng các epoch **nằm trong một chuỗi giữ ≥ N** (epoch lẻ
  không thuộc chuỗi nào ≥ N → **không cộng**). Ví stake đúng 1 epoch → accStake = 0 → loại.
- **N = 2** — *tham số CHỐT*, công bố mỗi đợt (giống ràng buộc "giữ ≥2 epoch" của costly-signal
  trong SPO-CS §2). Đổi N là tầng-tham-số, không đụng on-chain.

> Đây là "stake·epoch" tích lũy: ví giữ X qua nhiều epoch nhận nhiều "stake·epoch" hơn ví giữ
> X một epoch → thưởng lòng trung thành theo thời gian, KHÔNG token-weighted governance
> (đây là phân bổ pot, không phải phiếu bầu).

### 1.6. Tính entitlement — tái dùng `computeEntitlements`

Nạp SnapshotSet (mỗi epoch đủ điều kiện = 1 snapshot `{owner = payment_address, stake = active_stake}`)
vào `computeEntitlements` (`TIGER/offchain/src/entitlement.ts`):

```
accStake_i = Σ_{e đủ điều kiện} active_stake_i(e)      // §1.5
E_i        = floor(budget × accStake_i / Σ accStake)   // budget = 100M LAMP (oildrop)
```

- **budget = 100.000.000 × 10⁶ = 1×10¹⁴ oildrop** (= `AIRDROP_TOTAL_OILDROP` hiện có: pot Delegator
  giữ đúng con số 100M của `AIRDROP_TOTAL_LAMP`; 120M là **tổng 2 pot**, không phải 1 pot).
- Largest-remainder (Hamilton) trong `computeEntitlements` → **bảo toàn tuyệt đối**:
  `Σ E_i + leftover = budget`. Dư floor gom về ví stake lớn nhất chưa cap.
- Cap/ví tùy chọn (chống cá voi): truyền `capOildrop` → water-filling sẵn có. Mặc định không cap;
  nếu cần cap là *tham số quản trị*.
- Loại ví self-dealing (sáng lập/đối tác) qua `excluded` trước khi chia (chống tư lợi).

### 1.7. Nạp on-chain + claim (y hệt cơ chế cũ)

`{address, amount}` (address = `payment_address`, amount = `E_i` oildrop) → `snapshotTool.ts`
dựng cây Merkle (sort theo leaf hash → root tất định) → `merkle_root`. Root đặt vào datum
`AirdropPool` của POOL UTxO 100M. Claim bằng `payment_address` + Merkle proof; marker NFT
`name = leaf` khóa vĩnh viễn = nullifier chống double-claim. Sau `deadline_epoch`: Sweep dư
về `treasury_dest`. Chi tiết leaf encoding byte-perfect + replay note: README §1–§3.

---

## 2. Nạp nhiều nguồn vào bộ máy chung — TRẠNG THÁI ON-CHAIN THỰC TẾ

Yêu cầu: "1 pot on-chain có thể nhiều nguồn entitlement nạp qua SetRoot". Cần ghi rõ thực tế
để phần code khớp:

- **Validator hiện tại** (`airdrop_pool.ak`, `AirdropRedeemer`) chỉ có **`Claim` + `Sweep`**;
  `merkle_root` **cố định tại genesis**, **CHƯA có redeemer `SetRoot`**. (`spo-cs.md`
  §8/§10 nói "SetRoot" là **kiến trúc dự kiến**, không phải redeemer đã tồn tại.)
- Hai cách khớp yêu cầu "nhiều nguồn" mà **KHÔNG viết validator mới**:

  | Cách | Mô tả | Hợp validator hiện tại? |
  |---|---|---|
  | **A. Root gộp 1 lần** | Gộp toàn bộ leaf (delegator + SPO/CS) thành **1 snapshot → 1 root** tại genesis | ✅ Không đổi gì |
  | **B. 2 pool-instance** | Deploy **2 UTxO của cùng `airdrop_pool`** (khác genesis NFT): 1 pool 100M root-delegator, 1 pool 20M root-SPO+CS (5M base + 15M CS gộp) | ✅ Cùng validator, chỉ khác param genesis |
  | **C. SetRoot per-epoch** | Cập nhật root mỗi epoch (cho SPO/CS drip 20 epoch, SPO-CS §6) | ⚠️ **Cần bổ sung redeemer `SetRoot`** — mở rộng nhỏ, KHÔNG đổi datum schema |

- **Khuyến nghị cho pot Delegator (bản này):** snapshot tính **1 lần** sau `E_cut` → **1 root cố định**
  → khớp validator hiện tại **không cần thay đổi** (Cách A hoặc B). Delegator KHÔNG cần SetRoot.
- **Điểm cần chốt on-chain (SPO/CS):** nếu SPO/CS drip nhiều epoch cần root cập nhật per-epoch →
  chọn Cách C (thêm `SetRoot`, giữ nguyên datum `AirdropPool`) **hoặc** chấp nhận 1 root tĩnh
  (chia 20M một lần). Quyết định này thuộc phần SPO/CS + on-chain, ghi ở đây để không mâu thuẫn.

---

## 3. Phân biệt ETD vs Airdrop-Delegator vs SPO+CS (đừng nhầm)

Ba pot ĐỘC LẬP, dễ lẫn vì đều liên quan delegation:

| Trục | **ETD** (Early-TIGER-Delegator) | **Airdrop-Delegator v2** | **Airdrop SPO+CS** |
|---|---|---|---|
| Module | `TIGER/` | `Airdrop/` (pot Delegator) | `Airdrop/` (pot SPO+CS) |
| Ngân sách | **12M LAMP** | **100M LAMP** | **SPO 5M + CS 15M = 20M LAMP** |
| Trigger | Retroactive (nhìn về quá khứ) | Đăng ký + cửa sổ mới `[E_open,E_cut)` | Đăng ký SPO + đo delegation/vote theo đợt |
| Nguồn stake | **Chỉ pool TIGER** | **Bất kỳ pool Cardano** | Delegation vào pool SPO / vote-stake (mọi pool) |
| Pool nào | TIGER duy nhất | Mọi pool | Mọi pool |
| Cần đăng ký? | **Không** (auto retro) | **Có** (ký reward stake key) | **Có** (SPO ký reward stake key) |
| Cutoff | Mốc 18/6 UTC (`CUTOFF_EPOCH`, TIGER) | `E_cut` mới, chưa chốt | Cửa sổ theo đợt |
| Cần DID? | **Không** | **Không** (claim bằng ví) | SPO: **Không** · CS: **Có** (SPO-CS §2) |
| Nhả tiền | Drip kiểu B (36 epoch, cliff) | Claim Merkle 1 lần (cửa sổ 360 epoch) | SPO+CS, drip theo đợt |
| Tính | ∝accStake, largest-remainder | ∝accStake, largest-remainder | **∝stake, largest-remainder** (SPO=stake-vào-pool · CS=stake-bình-chọn) |

Điểm dễ nhầm nhất: **ETD 12M ≠ Airdrop-Delegator 100M.** ETD = thưởng hồi tố *chỉ* cho
delegator pool TIGER giai đoạn đầu (không đăng ký). Airdrop-Delegator = pot mới 100M, mọi pool,
phải đăng ký, cửa sổ riêng.

### 3.1. SPO (Staking Pool Operator) vs CS (Community Supporter) — cùng stake-weighted, khác NGUỒN trọng số

| Trục | **SPO — Staking Pool Operator** (5M) | **CS — Community Supporter** (15M) |
|---|---|---|
| Vai trò | Nhà vận hành pool | Người hỗ trợ cộng đồng (**bất kỳ ai**, không cần vận hành pool) |
| Trọng số neo vào | Stake **CHẢY VÀO POOL** (delegation đã đăng ký ủy thác vào pool họ) | Stake của người **ĐƯỢC-GIÚP** bình chọn (phiếu-stake ≤ stake mỗi người bầu) |
| Thưởng điều gì | Thu hút & giữ được delegation | Được stakeholder công nhận đã giúp |
| Cần DID? | Không | **Có** (dedupe danh tính người nhận) |
| Chống sybil | Splitting pool làm loãng delegation → tự vô hiệu | Phiếu-stake ≤ stake thật → không bơm được |
| Hàm chia (`cs_score.ts`) | `splitSpoPot` | `splitCsPot` |

---

## 4. Tính pháp lý sạch

- **Airdrop = ghi nhận, KHÔNG bán token.** Không thu tiền để nhận LAMP; entitlement tính từ
  hành vi on-chain đã có (delegation) + đăng ký ký offline.
- **Delegator KHÔNG cần DID** — claim bằng ví (`payment_address`), là phân phối theo hành vi
  kinh tế công khai (stake ADA), không phải bỏ phiếu.
- **SPO KHÔNG cần DID** — reward neo delegation on-chain (đủ chữ ký pool). **CS CẦN DID** —
  supporter có thể là bất kỳ ai, DID sinh trắc dedupe danh tính **người nhận** thưởng CS (dù
  trọng số vẫn neo stake của người bình chọn). Ranh giới DID này là **có chủ đích** (SPO-CS §2).

---

## 5. Việc off-chain cần code (để agent code khớp)

Tái dùng tối đa hạ tầng sẵn có — **KHÔNG viết lại**:

| File cần viết | Nhiệm vụ | Tái dùng |
|---|---|---|
| `delegator_register.ts` | Ký reward stake key → map `stake_address → payment_address`; kiểm ví có `active_stake` (chưa stake → hướng dẫn stake TIGER/bất kỳ pool); xuất `delegator_registration.json` | Khung + verify Ed25519 + `pubkeyToStakeAddr` từ `spo_register.ts` |
| `build_delegator_snapshot.ts` | Đọc list registration → mỗi `stake_address` fetch account history → `active_stake` per epoch trong `[E_open,E_cut)` **qua bất kỳ pool** → áp điều kiện giữ ≥ N epoch (§1.5) → SnapshotSet (owner=`payment_address`) → `computeEntitlements(budget=100M oildrop)` → `{address, amount}` → root + exportClaims | `computeEntitlements` (`TIGER/.../entitlement.ts`), `merkle.ts`, `snapshotTool.ts`, `datum.ts` |
| `cs_score.ts` | Chia pot SPO/CS ∝stake: `splitByStake`/`splitSpoPot`/`splitCsPot` (largest-remainder + cap tuỳ chọn) | `computeEntitlements` (TIGER) — xem `spo-cs.md` §3 |

Đã có, dùng nguyên: `merkle.ts` (leaf byte-perfect), `snapshotTool.ts` (`{address,amount}`→root),
`claimBuilder.ts`, `sweepBuilder.ts`, `datum.ts`. `computeEntitlements` hiện ở module TIGER —
nên trích thành util dùng chung hoặc import trực tiếp (giữ 1 nguồn thuật toán, đừng copy-lệch).

---

## 6. Tham số cần chốt (giao quản trị / đợt-1)

- `E_open`, `E_cut` — mốc cửa sổ đăng ký delegator (chưa chốt).
- **N = 2** — số epoch giữ delegation tối thiểu (§1.5). Mặc định, đổi được.
- `capOildrop` cho pot Delegator — mặc định không cap; bật nếu cần chống cá voi.
- SetRoot cho SPO/CS drip per-epoch — chốt Cách A/B/C (§2).
- Danh sách `excluded` ví self-dealing.
