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
| **CS** (Community Supporter) | **15.000.000 LAMP** | Bất kỳ ai có DID sinh trắc | Σ **phiếu-stake phân bổ cho họ**; tự bỏ phiếu hợp lệ ⇒ cân bằng = **stake của chính họ** | `spo-cs.md` §3.5 |

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
- **Trần mỗi-ví: `capOildrop` PHẢI luôn `null`** — ràng buộc bất biến, KHÔNG phải mặc định bật/tắt
  được. Tham số còn trong chữ ký hàm vì máy chia dùng chung với ETD (`TIGER/offchain/src/entitlement.ts`),
  nhưng ở pot chia-theo-stake **không có trường hợp hợp lệ nào để truyền khác `null`**.
  Lý do: `accStake` là **trục bảo-toàn** — tách `n` ví giữ tổng stake không đổi thì không trần ⇒
  tổng nhận KHÔNG ĐỔI trong khi chi phí tăng theo `n` (tách bị trội tuyệt đối); có trần `c` ⇒
  `n` ví nhận tới `n·c` ⇒ **chính cái trần đặt ra để chặn cá voi là thứ trả tiền cho việc tách ví**.
  Bất biến: *trần trên trục giả-được thì an toàn; trần trên trục bảo-toàn thì tự mở cửa tách.*
  Đại số đầy đủ + điều kiện duy nhất để đưa lại: `Airdrop/spo-cs.md` §5.
- Loại ví self-dealing (sáng lập/đối tác) qua `excluded` trước khi chia (chống tư lợi).

### 1.7. Nạp on-chain + claim — **schema C (role-tag), chốt 2026-07-31**

Từ 2026-07-31 pot Delegator dùng **schema Merkle C** — bộ máy chung mọi pot (Delegator/MCS/Engage/
SPO). Nguồn sự thật: [`SCHEMA-MERKLE-V2-Tech-Spec.md`](../SCHEMA-MERKLE-V2-Tech-Spec.md).

```
leaf = blake2b_256( 0x00 ‖ campaign_id[32] ‖ epoch_be8 ‖ role[1] ‖ owner[28] ‖ amount_oildrop_be8 )
```
- `campaign_id` = `blake2b_256("LAMP-Delegator-Airdrop-1")` = `f5beb28d…db54` — **PARAM bake** validator.
- `epoch` = `E_cut` (epoch snapshot, hằng cho pot 1-snapshot) — **PARAM bake**.
- `role` = **1** (Delegator) — **PARAM bake**, CẤM đổi số (role-map §1 spec).
- `owner` = **payment key-hash (28B)** của `payment_address` — anh Aladin chốt per-role: Delegator
  neo payment-cred để giữ push-claim + trả được tiền (lỗ#1). **SRCL cũng neo payment-cred** (AffiSo
  chốt 2026-08-01, xem spec §3.1 — bản "SRCL neo stake-cred" trước đó đã bị thu hồi). SPO: nghĩa
  `owner` **chưa chốt**, phải khoá vào spec §3 trước khi dựng validator vai đó.
  **Phải là KEY-hash — CẤM script-hash** (spec §3.2): `owner` là hash trần, không phân biệt
  `VerificationKey` với `Script`, nên nhận địa chỉ script = cho phép chuyển phần của người khác vào
  địa chỉ không ai mở được. Ép ở CẢ ba khâu: validator (`expect VerificationKey`), builder snapshot
  (`MERKLE-026`), và khâu xác minh đăng ký.
- `amount` = `E_i` oildrop.

`{address, amount}` (address = `payment_address` đầy đủ, giữ cho redeemer + payout) → `snapshotTool.ts`
dựng cây (chuẩn hoá **sort TĂNG theo `slot = blake2b_256(epoch_be8 ‖ owner)`**, **trùng slot → NÉM
LỖI**; ghép đôi + promote-odd giữ nguyên) → `merkle_root` → datum `AirdropPool` POOL UTxO 100M.
Claim: redeemer `Claim{claimer, amount, proof}`; validator trích `owner = payment_cred(claimer)`, tính
leaf schema C, verify proof, **trả ≥ amount LAMP tới địa chỉ claimer**; claim-slot NFT `name = leaf`
one-shot chống double-claim (giữ nguyên). Sau `deadline_epoch`: Sweep dư về `treasury_dest`.
**Datum + redeemer KHÔNG đổi** (anh chốt giữ nguyên pot); chỉ leaf-encoding + 3 param bake.

---

## 2. Nạp nhiều nguồn vào bộ máy chung — TRẠNG THÁI ON-CHAIN THỰC TẾ

Yêu cầu: "1 pot on-chain có thể nhiều nguồn entitlement nạp qua SetRoot". Cần ghi rõ thực tế
để phần code khớp:

- **Validator hiện tại** (`airdrop_pool.ak`, `AirdropRedeemer`) chỉ có **`Claim` + `Sweep`**;
  `merkle_root` **cố định tại genesis**, **CHƯA có redeemer `SetRoot`**. (`spo-cs.md`
  §8/§10 nói "SetRoot" là **kiến trúc dự kiến**, không phải redeemer đã tồn tại.)
- Hai cách khớp yêu cầu "nhiều nguồn" mà **KHÔNG viết validator mới**:

  Hình ảnh chung cho cả ba: **pot = một cái hũ**, `merkle_root` = **niêm** dán lên hũ. Niêm
  quyết định ai mở được và mở bao nhiêu. Ba cách khác nhau ở chỗ **có mấy hũ** và **niêm dán
  mấy lần** — tên gọi bên dưới đặt theo đúng hai câu đó (2026-08-18).

  | Cách | Tên gọi | Mô tả | Hợp validator hiện tại? |
  |---|---|---|---|
  | **A** | **MỘT SỔ CHUNG** (`mot-so-chung`) | Gộp toàn bộ leaf (delegator + SPO/CS) thành **1 snapshot → 1 root** tại genesis. Một hũ, một niêm, dán một lần | ✅ Không đổi gì |
  | **B** | **HAI HŨ RIÊNG** (`hai-hu-rieng`) | Deploy **2 UTxO của cùng `airdrop_pool`** (khác genesis NFT): 1 hũ 100M niêm-delegator, 1 hũ 20M niêm-SPO+CS (5M base + 15M CS gộp). Hai hũ, hai niêm, niêm độc lập | ✅ Cùng validator, chỉ khác param genesis |
  | **C** | **HŨ THAY NIÊM MỖI KỲ** (`hu-thay-niem-moi-ky`) | Một hũ, **bóc niêm cũ dán niêm mới mỗi epoch** (cho SPO/CS drip 20 epoch, SPO-CS §6) | ⚠️ **Cần bổ sung redeemer `SetRoot`** — mở rộng nhỏ, KHÔNG đổi datum schema |

  **ĐÃ CHỐT: B — HAI HŨ RIÊNG.** Vì sao, nói bằng hình ảnh cái hũ:

  - **A thua vì thời điểm, không vì kỹ thuật.** Một niêm dán một lần đòi biết TẤT CẢ người
    nhận tại genesis. Nhưng leaf delegator chỉ tính được **sau `E_cut`**, còn hũ SPO/CS đo
    theo cửa sổ khác. Muốn gộp thì phải hoãn cả hai tới mốc muộn nhất — trả bằng lịch để mua
    một thứ không cần.
  - **C thua vì cái khuôn đã hỏng một lần.** Niêm bóc ra dán lại được nghĩa là **tồn tại một
    đường ghi đè `merkle_root` của một hũ đang giữ tiền**. Ai giữ quyền dán niêm thì viết lại
    được ai nhận bao nhiêu. Đó là quyền phải chứng minh an toàn trước, không phải quyền lấy
    kèm theo tiện lợi. Và nó đòi thêm redeemer, tức thêm mã cho một validator đã chạy thật.
  - **B thắng vì hai hũ vỡ độc lập.** Cùng validator (cùng kiểu hũ, đã kiểm), khác genesis NFT
    (khác niêm). Sai một niêm thì hỏng một hũ; hũ kia không biết chuyện đó xảy ra. Với hai
    pot đo bằng hai cách khác nhau trên hai cửa sổ khác nhau, cô lập sai sót đáng giá hơn
    tiết kiệm một UTxO.
  - Giá phải trả, nói rõ: **hai lần deploy, hai genesis NFT, hai hạn Sweep** phải theo dõi
    riêng. Đây là chi phí vận hành thật, không phải chi phí bằng 0.

  Giá trị máy đọc được: `set_root_mode` trong `params.public` của campaign record
  (`LaunchAPI/src/types.ts` → `SetRootMode`); phần kiểm ở `Airdrop/offchain/src/campaignParams.ts`.

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
| Cần đăng ký để **đủ tư cách**? | **Không** — hồi tố hoàn toàn | **Có** (ký reward stake key) | **Có** (SPO ký reward stake key) |
| Cần ký để **nhận tiền về đâu**? | **Có**, SAU cutoff — xem ghi chú dưới bảng | Có (cùng lần ký đăng ký) | Có (cùng lần ký đăng ký) |
| Cutoff | **epoch 637** (`CUTOFF_EPOCH`, TIGER) — nửa mở, xem dẫn giải trong `TIGER/offchain/src/constants.ts` | `E_cut` mới, chưa chốt | Cửa sổ theo đợt |
| Cần DID? | **Không** | **Không** (claim bằng ví) | SPO: **Không** · CS: **Có** (SPO-CS §2) |
| Nhả tiền | Drip kiểu B (36 epoch, cliff) | Claim Merkle 1 lần (cửa sổ 360 epoch) | SPO+CS, drip theo đợt |
| Tính | ∝accStake, largest-remainder | ∝accStake, largest-remainder | **∝stake, largest-remainder** (SPO=stake-vào-pool · CS=stake-bình-chọn) |

> **Ghi chú ETD — tư cách ≠ nơi trả.** Hai chuyện này từng bị gộp làm một nên tài liệu đọc như tự
> mâu thuẫn. **Tư cách nhận** của ETD là hồi tố tuyệt đối: không ai làm gì để trở nên đủ điều kiện,
> và không ai mất tư cách đã có. Nhưng **nơi trả** thì bắt buộc có một bước ký SAU cutoff, vì
> `claim_account` ép LAMP về `vk_address(owner)` và `owner` buộc là **payment key hash**
> (`Distribution/onchain/lib/magiclamp/lampdist/util.ak:102-114,158`), trong khi chuỗi chỉ cho
> `stake_address` — mà stake → payment không phải một hàm. Bước ký này dùng lại nguyên cơ chế
> `delegator_register.ts`, và vì nó diễn ra sau cutoff nên **không thể** làm ai trở nên đủ điều kiện.

Điểm dễ nhầm nhất: **ETD 12M ≠ Airdrop-Delegator 100M.** ETD = thưởng hồi tố *chỉ* cho
delegator pool TIGER giai đoạn đầu (không đăng ký). Airdrop-Delegator = pot mới 100M, mọi pool,
phải đăng ký, cửa sổ riêng.

### 3.1. SPO (Staking Pool Operator) vs CS (Community Supporter) — cùng stake-weighted, khác NGUỒN trọng số

> **Làn CS là stake-weighted, không phải thước đo đóng góp.** Quy tắc bình chọn cho phép
> **tự bỏ phiếu** (`j = d` hợp lệ), nên tự bỏ phiếu là chiến lược trội và điểm cân bằng là
> `weight_CS(j) = accStake(j)` — pot CS thành đợt chia-theo-stake thứ hai. Chứng minh + lý do
> chốt: `spo-cs.md` §3.5. Đừng hứa "được công nhận đã giúp" ở bất kỳ đâu.

| Trục | **SPO — Staking Pool Operator** (5M) | **CS — Community Supporter** (15M) |
|---|---|---|
| Vai trò | Nhà vận hành pool | Người hỗ trợ cộng đồng (**bất kỳ ai**, không cần vận hành pool) |
| Trọng số neo vào | Stake **CHẢY VÀO POOL** (delegation đã đăng ký ủy thác vào pool họ) | Σ **phiếu-stake phân bổ cho họ** (phiếu-stake ≤ stake mỗi người bầu) |
| Thưởng điều gì | Thu hút & giữ được delegation | **Nắm stake ADA** — làn stake-weighted, KHÔNG đo sự giúp đỡ (`spo-cs.md` §3.5) |
| Cần DID? | Không | **Có** (dedupe danh tính người nhận; **không** chặn tự bỏ phiếu) |
| Chống sybil | Splitting pool làm loãng delegation → tự vô hiệu | Phiếu-stake ≤ stake thật → không bơm được (**không** chặn tự bỏ phiếu) |
| Hàm chia (`cs_score.ts`) | `splitSpoPot` | `splitCsPot` |

---

## 4. Tính pháp lý sạch

- **Airdrop = ghi nhận, KHÔNG bán token.** Không thu tiền để nhận LAMP; entitlement tính từ
  hành vi on-chain đã có (delegation) + đăng ký ký offline.
- **Delegator KHÔNG cần DID** — claim bằng ví (`payment_address`), là phân phối theo hành vi
  kinh tế công khai (stake ADA), không phải bỏ phiếu.
- **SPO KHÔNG cần DID** — reward neo delegation on-chain (đủ chữ ký pool). **CS CẦN DID** —
  người nhận có thể là bất kỳ ai, DID sinh trắc dedupe danh tính **người nhận** thưởng CS (dù
  trọng số vẫn neo stake của người bỏ phiếu). Ranh giới DID này là **có chủ đích** (SPO-CS §2).
  DID ở đây chỉ chặn **nhiều danh tính nhận**, KHÔNG chặn **tự bỏ phiếu** (SPO-CS §3.5).

---

## 5. Việc off-chain cần code (để agent code khớp)

Tái dùng tối đa hạ tầng sẵn có — **KHÔNG viết lại**:

| File cần viết | Nhiệm vụ | Tái dùng |
|---|---|---|
| `delegator_register.ts` | Ký reward stake key → map `stake_address → payment_address`; kiểm ví có `active_stake` (chưa stake → hướng dẫn stake TIGER/bất kỳ pool); xuất `delegator_registration.json` | Khung + verify Ed25519 + `pubkeyToStakeAddr` từ `spo_register.ts` |
| `build_delegator_snapshot.ts` | Đọc list registration → mỗi `stake_address` fetch account history → `active_stake` per epoch trong `[E_open,E_cut)` **qua bất kỳ pool** → áp điều kiện giữ ≥ N epoch (§1.5) → SnapshotSet (owner=`payment_address`) → `computeEntitlements(budget=100M oildrop)` → `{address, amount}` → **cây schema C** (`campaign_id`=Delegator, `role`=1, `epoch`=`E_cut`, leaf owner=payment-cred, sort theo slot) → root + exportClaims | `computeEntitlements` (`TIGER/.../entitlement.ts`), `merkle.ts` (schema C), `snapshotTool.ts`, `datum.ts` |
| `cs_score.ts` | Chia pot SPO/CS ∝stake: `splitByStake`/`splitSpoPot`/`splitCsPot` (largest-remainder + cap tuỳ chọn) | `computeEntitlements` (TIGER) — xem `spo-cs.md` §3 |

Đã có, dùng nguyên: `merkle.ts` (leaf byte-perfect), `snapshotTool.ts` (`{address,amount}`→root),
`claimBuilder.ts`, `sweepBuilder.ts`, `datum.ts`. `computeEntitlements` hiện ở module TIGER —
nên trích thành util dùng chung hoặc import trực tiếp (giữ 1 nguồn thuật toán, đừng copy-lệch).

---

## 6. Tham số vận hành — ĐÃ CHỐT, và chỗ ở của chúng (2026-08-18)

**Chúng KHÔNG còn nằm trong mã.** Nguồn duy nhất là khối `params` của campaign record
(`LaunchAPI/data/campaigns.json`, đợt `airdrop-v2`), sửa được qua
`PATCH /admin/campaigns/:id` — tức sửa trên giao diện quản trị, không sửa mã rồi phát hành
lại. `build_delegator_snapshot.ts --campaign airdrop-v2` đọc thẳng từ đó; cờ gõ tay vẫn đè
được nhưng **in ra một dòng cảnh báo**, vì một lượt chạy lệch campaign record là một lượt
chia tiền theo con số không ai duyệt.

| Tham số | Giá trị | Ai chốt | Căn cứ |
|---|---|---|---|
| `e_open` | **654** | VeData (uỷ quyền) | epoch mở đo, sau mốc hạ tầng gần nhất còn đo được |
| `e_cut` | **666** (`W` = 12) | VeData (uỷ quyền) | cửa sổ phải là QUÁ KHỨ lúc công bố — xem `sealed` bên dưới |
| `n_min_epochs` | **2** | VeData (uỷ quyền) | nhỏ nhất phân biệt được *giữ suốt* với *đẹp đúng hôm chụp*; `N=1` = thuê stake một ngày |
| `set_root_mode` | **`hai-hu-rieng`** (Cách B) | chủ nhân | §2 |
| `cap_oildrop` | **`null` — KHÔNG trần, cả ba pot** | LAMP agent | xem ghi chú dưới |
| `excluded_file` | `Airdrop/data/excluded-self.json` | LAMP agent (LUẬT); danh sách do người giữ bảng khoá điền | `Airdrop/data/excluded-self.md` |

### `sealed` — cửa sổ đo KHÔNG được công bố trước khi nó đóng

`e_open`/`e_cut` nằm trong `params.sealed`, và `publicCampaign()` **lược `sealed` khỏi mọi
đường ra công khai** (GET public, SSE `/events` — vốn không có auth — và payload webhook).
Lý do là chính lý do đã chọn `E_cut` lùi về quá khứ: công bố cửa sổ trước khi nó đóng là báo
trước ngày cần đẹp sổ, ai cũng thuê stake đúng 12 epoch rồi rút, và đợt phát trả tiền cho
đúng hành vi nó muốn chặn. Mở niêm = **một lượt sửa có chủ ý của quản trị** (chuyển hai
trường lên `params.public`), không phải một phép so mốc thời gian tự chạy — cổng tự mở theo
đồng hồ là cổng sẽ mở nhầm một lần nào đó.

Kiểm: `LaunchAPI/tests/publicCampaign.check.ts` (`npm run check` trong `LaunchAPI/`).

### Vì sao `cap_oildrop = null` ở CẢ BA pot — và vì sao đây là chỗ khác bảng của VeData

Bảng VeData đề nghị *hạng 1–2 không trần · hạng 3 (CS) trần 1%*, với lý do **tư cách dự ở
làn CS giả được rẻ**. Lý do đó **đã hết hiệu lực** sau khi làn CS được khai lại là
stake-weighted (`cs_score.ts` → `splitCsPot`, `spo-cs.md §3.5`): trọng số CS ở điểm cân bằng bằng
chính stake của người nhận, nên tư cách dự ở làn CS **tốn đúng bằng** hai làn kia. Tiền đề
mất thì cái trần mất theo.

Và đặt trần vào bất kỳ làn nào cũng **tạo ra** đúng thứ nó định chặn. Cả ba pot chia bằng
`splitByStake` (∝ stake, largest-remainder). Không trần: tách một ví thành `n` ví giữ tổng
stake không đổi ⇒ tổng phần nhận **không đổi**, mà chi phí giao dịch tăng ⇒ chia nhỏ bị trội
tuyệt đối, tự nó chặn. Có trần `c`: một ví lớn nhận `min(phần, c)`, còn `n` ví nhận tới
`n·c` ⇒ **cái trần đặt ra để chặn cá voi chính là thứ trả tiền cho việc tách ví.** Cùng đại
số với nghịch lý quadratic funding.

Mặc định `capOildrop = null` trong `cs_score.ts` (`splitSpoPot`, `splitCsPot`) ⇒ hai pot SPO/CS
đã đúng chốt này sẵn. Pot Delegator thì **đọc `cap_oildrop` từ campaign record** và truyền
thẳng vào `buildDelegatorEntitlements` (`build_delegator_snapshot.ts`) — đổi trần trên giao
diện quản trị là đổi được phép chia, không phải sửa mã. Ghi ra thành quyết định có lý do để
lần sau không ai bật trần vì thấy nó "an toàn hơn".
