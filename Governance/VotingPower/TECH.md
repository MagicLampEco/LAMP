# Voting Power — TECH (Đặc tả kỹ thuật on-chain)

**Trạng thái:** bản nháp kỹ thuật, bám `CONTRACT.md` (đã duyệt 2026-06-05). Không mâu thuẫn
CONTRACT. Mọi tham số số (cap C1–C4, weight w_k, độ dài cửa sổ, ngưỡng quorum) là **tham số mở
(DAO định)** — file này KHÔNG chốt con số cuối, chỉ chốt cách mã hóa và kiểm tra on-chain.

Stack: Cardano eUTxO, Aiken, Plutus V3.
- Plutus V3 ledger language: [CIP-0035](https://cips.cardano.org/cip/CIP-0035) ·
  Plutus V3 trong Conway: [Cardano docs — Plutus](https://developers.cardano.org/docs/smart-contracts/plutus/)
- Mô hình eUTxO: [Cardano docs — eUTxO](https://docs.cardano.org/about-cardano/learn/eutxo-explainer/)
- Aiken language tour: [aiken-lang.org](https://aiken-lang.org/language-tour) ·
  stdlib `cardano/transaction`: [docs](https://aiken-lang.github.io/stdlib/cardano/transaction.html)

> **Bản 2 (sau audit 2026-06-05).** Đã sửa 11 phát hiện audit. Các thay đổi nền tảng: (1) bỏ giả
> định sai "AssetName duy nhất toàn sổ = chống re-mint vĩnh viễn" — nullifier dùng mẫu **spend-đếm**
> ở Tally + cấm burn trước Tallied; (2) bỏ "reference input ví" cho C4 — chuyển sang **registry
> LAMP-holding gắn DID** (như C3); (3) Tally **spend** Vote UTxO thay vì accumulator Merkle (bỏ
> `consumed_root`); (4) chốt **registry DID** là bắt buộc cho v1 (SNARK on-chain tách ra tx riêng);
> (5) mã hóa quorum thành biểu thức xác định hai trục; (6) §6.5 là kiểm tra **off-chain**, không
> phải invariant validator; (7)–(11) liveness, ràng `did_commit` cho ref hint, bỏ "mốc nội suy đã
> ký", trích theo tên hàm, cap đọc từ UTxO tham số. Chi tiết ở mục **Phản hồi audit** cuối file.

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Định nghĩa **kiến trúc on-chain** để một DAO bỏ phiếu theo mô hình **cử tri = 1 PhoenixKey DID**
(không token-weighted), với Voting Power tính theo công thức nhân (geometric) đã chốt ở CONTRACT §1:

```
VP_i = ∏_k  min( C_{k,i}, cap_k )^( w_k )
```

Cụ thể TECH trả lời 6 câu hỏi kỹ thuật:

1. Bốn validator (Proposal, Vote, Tally, Recall) có datum/redeemer gì, kiểm gì.
2. Đọc C1 (MAGIC tiêu thụ), C2 (ScheduleGen cam kết), C4 (LAMP nắm giữ) qua **reference input**
   thế nào — cross-repo LAMP ↔ MAGIC.
3. Tích hợp **DID proof** từ PhoenixKey (zk, "1 DID = 1 người") — vị trí trong tx, đây là
   **external blocker**.
4. Chống **double-vote** (nullifier theo DID + proposal).
5. Chống **double-satisfaction** (đếm theo payment script hash — bài học audit Distribution
   C1/C2/M1), bảo toàn value, min-ADA / UTxO bloat.
6. **Nơi tính VP**: off-chain compute + on-chain verify, hay on-chain thuần — phân tích ExUnit.

### 0.2 KHÔNG thuộc spec này (thuộc spec khác)

| Nằm ở đâu | Nội dung |
|---|---|
| **MATH** | Giá trị/đơn vị của VP, chứng minh bounded/monotonic/sybil-cost, cách lượng tử hóa số mũ phân số `w_k`, chuẩn hóa C3, làm tròn fixed-point. TECH chỉ **mã hóa lại** kết quả MATH, không tự định công thức. |
| **FEAT** | Vòng đời tập sự, loại quyết định nào cần vote, ngưỡng thông qua về mặt chính sách, luồng nghiệp vụ proposal/recall ở mức hành vi. |
| **EXEC** | Lộ trình build, thứ tự, test plan, deploy Preview, bootstrap DAO, mốc phụ thuộc DID. |
| **PhoenixKey backend** | Sinh DID sinh trắc, mạch zk chứng minh "1 DID = 1 người", verifying key. Claude **không sửa** (CLAUDE.md). TECH chỉ **tiêu thụ** proof. |
| **MAGIC repo** | Định nghĩa cuối của C1/C2 (datum MAGIC consumption, ScheduleGen commitment). TECH chỉ định **giao diện đọc** (interface), không định nghĩa lại datum của MAGIC. |

---

## 1. Bức tranh tổng thể — bốn validator + dòng dữ liệu

```
                       ┌───────────────────────── PhoenixKey (external) ───────────┐
                       │  DID sinh trắc + zk-proof "1 DID = 1 người"  [BLOCKER]     │
                       │  → verifying key + DID-commitment registry on-chain        │
                       └───────────────┬───────────────────────────────────────────┘
                                       │ (reference input registry — cách (b) v1)
   repo MAGIC                          ▼                     repo LAMP
 ┌───────────────┐            ┌─────────────────┐         ┌──────────────────┐
 │ C1: MAGIC     │  ref input │  Vote validator │  ref in │ C4: LAMP-holding │
 │   consumed    │───────────▶│  (1 phiếu/UTxO) │◀────────│   registry (DID) │
 │ C2: Schedule  │  ref input │                 │         └──────────────────┘
 │   commitment  │───────────▶│  + Nullifier    │
 └───────────────┘            │    mint (anti   │  ref in  ┌──────────────────┐
                              │    double-vote) │◀─────────│ C3: Reputation   │
                              └────────┬────────┘          │   registry (LAMP)│
   ┌──────────────┐                    │                   └──────────────────┘
   │  Proposal    │  Tally SPEND        ▼
   │  validator   │  từng lô phiếu  ┌─────────────┐      ┌──────────────┐
   │  (1 UTxO/đề  │◀────────────────│   Tally     │      │   Recall     │
   │   xuất)      │  của proposal   │  validator  │      │  validator   │
   └──────────────┘                 └─────────────┘      └──────────────┘
                                          │
                                          ▼  (nếu thông qua) gọi treasury.ak (Distribution)
```

Bốn validator độc lập về địa chỉ (4 script hash), liên kết qua **tham số hóa** (mỗi validator
biết hash của các validator kia) và qua **token chứng thực** (authenticity NFT) — đúng mẫu
beacon NFT của Distribution (`beacon_nft.ak`). Lý do dùng token chứng thực: một datum giả mạo ở
địa chỉ bất kỳ không thể bị nhầm là "phiếu thật" nếu thiếu NFT một-lần (one-shot) do policy hợp lệ
phát ([CIP-0068](https://cips.cardano.org/cip/CIP-0068) gợi ý mẫu reference/authenticity token; ở
đây ta dùng one-shot NFT đơn giản như `beacon_nft.ak` đã có).

> **Lưu ý kiến trúc (sửa audit #1, #3):** Tally **tiêu (spend)** từng lô Vote UTxO khi đếm — không
> đọc bằng reference input và không dùng accumulator Merkle. UTxO đã tiêu không cộng lại được → đây
> là cơ chế chống đếm-trùng *tự nhiên* của eUTxO, không cần `consumed_root`. Xem §9.

---

## 2. Quyết định nền tảng (first-principles)

### QĐ-T1 — Nơi tính VP: **off-chain compute + on-chain verify**, KHÔNG on-chain thuần

**Vấn đề:** công thức `VP = ∏ min(C_k, cap_k)^{w_k}` có **số mũ phân số `w_k`** (MATH định).
Lũy thừa phân số = `exp(w_k · ln(C_k))`. Aiken/Plutus **không có** dấu phẩy động; `ln`/`exp` phải
xấp xỉ bằng chuỗi/bảng tra → tốn ExUnit lớn và rủi ro sai số. Plutus có ngân sách ExUnit giới hạn
theo block ([CIP-0035 / protocol params `maxTxExUnits`](https://cips.cardano.org/cip/CIP-0035);
tham số mạng: [Cardano docs](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/)).

**Quyết định:** chia hai pha.

1. **Off-chain (client/indexer):** đọc C1–C4 từ chain, tính `VP_i` đầy đủ (kể cả mũ phân số bằng
   số thực), tạo phiếu mang **`vp_claimed`** (số nguyên fixed-point, MATH định thang).
2. **On-chain (Vote validator):** KHÔNG tính lại lũy thừa. Thay vào đó **verify rẻ**:
   - Mỗi `C_{k,i}` được **chứng minh bằng reference input thật** (xem §5) → giá trị đầu vào không
     bịa được.
   - Vote validator **chỉ chốt các đầu vào `C_k` (đã cap) vào datum phiếu**. Vote **KHÔNG** kiểm
     `vp_claimed` (không quy đổi sang power ở Vote). **Tally** mới quy đổi `c*_capped → power` bằng
     **bảng tra (lookup table) số nguyên** do DAO công bố on-chain (trỏ bởi `weight_param_ref`).

   > **Sửa audit #9:** Bản trước nêu hai biến thể — (i) "kiểm `vp_claimed` nằm trong khoảng
   > `[VP_lo, VP_hi]` mà off-chain cung cấp **mốc nội suy đã ký**", và (ii) "chốt `c*_capped`, Tally
   > tra bảng". Biến thể (i) đã **BỎ**: nó **tin off-chain** (ai ký bound? off-chain ký = lại tin
   > off-chain) — mâu thuẫn nội tại với chính nguyên tắc "không tin off-chain" của mục này. Chốt
   > **một đường duy nhất**: Vote chỉ verify `c*_capped` từ ref input; Tally tra bảng số nguyên.
   > Đồng bộ MATH §11 (MATH chốt dạng bảng-power log-domain hay tra số nguyên trực tiếp). Câu hỏi
   > treo §13.1 đã thành **quyết định một-đường**.

**Lý do (4 trục):**
- *Tối ưu ExUnit:* tránh `exp/ln` on-chain — đây là chi phí lớn nhất nếu làm thuần on-chain.
- *An toàn vốn/chống gaming:* đầu vào `C_k` **không** tin off-chain — phải chứng minh bằng
  reference input thật, nên off-chain chỉ làm việc số học, không nắm quyền quyết định giá trị.
- *Đơn giản hóa eUTxO:* phiếu chỉ lưu các `C_k` đã cap (số nguyên nhỏ) + DID + proposal id.
- *Nâng cấp được:* bảng tra weight nằm trong UTxO tham số do DAO chỉnh → đổi `w_k` không cần
  đổi validator.

### QĐ-T2 — Một phiếu = một UTxO tại Vote validator, mang nullifier

Mỗi cử tri tạo **đúng một UTxO phiếu** cho mỗi proposal. Chống double-vote bằng **nullifier**
`H(DID ‖ proposal_id)` (xem §6). Không gộp nhiều phiếu vào một UTxO (tránh nhập nhằng tính phiếu
và tránh một UTxO bị một người khống chế).

### QĐ-T3 — Đếm theo PAYMENT SCRIPT HASH ở mọi nơi nhạy cảm (bài học audit)

Tái dùng nguyên `util.count_inputs_at_script` / `count_outputs_at_script` /
`util.is_at_script` của Distribution (`util.ak`, trích theo **tên hàm** — xem ghi chú §13 nit #10).
Lý do: hai UTxO **cùng script hash** nhưng **khác stake credential** là **hai address khác nhau** →
đếm theo full-address bỏ sót → double. Bằng chứng test đã có: `util.script_count_catches_stake_cred_double`.
Đây là fix audit **C1/C2** của Distribution, bắt buộc áp dụng lại cho Governance.

---

## 3. Validator 1 — Proposal

### 3.1 Vai trò
Một UTxO duy nhất đại diện cho một đề xuất. Giữ trạng thái vòng đời (mở vote → đóng → đã tally).
Mang **Proposal authenticity NFT** (one-shot, mint khi mở đề xuất) để chống giả mạo địa chỉ.

### 3.2 Datum

```aiken
pub type ProposalStatus {
  Open       // đang nhận phiếu
  Closed     // hết cửa sổ vote, chờ tally
  Tallied    // đã chốt kết quả
  Executed   // đã thi hành (nếu là proposal có hành động on-chain)
}

pub type ProposalDatum {
  proposal_id     : ByteArray,   // = hash nội dung đề xuất (off-chain doc hash)
  status          : ProposalStatus,
  vote_open_epoch : Int,         // epoch bắt đầu nhận phiếu
  vote_close_epoch: Int,         // epoch đóng (tham số mở: độ dài cửa sổ)
  snapshot_epoch  : Int,         // epoch khóa snapshot C4 (= vote_open_epoch; xem §5.4)
  // snapshot tham chiếu (chống đổi luật giữa chừng — xem §5.6):
  weight_param_ref: OutputReference, // UTxO bảng weight/cap dùng cho đề xuất này
  // kết quả (điền khi Tallied):
  yes_power       : Int,         // tổng VP phiếu YES (fixed-point)
  no_power        : Int,
  abstain_power   : Int,         // tổng VP phiếu Abstain (vào quorum-VP, không vào yes/no)
  voter_count     : Int,         // số DID đã vote (quorum theo người — xem §9.4)
}

pub type ProposalRedeemer {
  OpenProposal               // tạo (mint authenticity NFT)
  CloseVoting                // Open → Closed khi epoch ≥ vote_close_epoch
  RecordTally { yes: Int, no: Int, abstain: Int, voters: Int }  // Closed → Tallied (do Tally validator)
  ExecuteProposal            // Tallied → Executed (nếu thông qua)
}
```

### 3.3 Kiểm tra chính
- `OpenProposal`: mint đúng 1 Proposal NFT (one-shot theo `OutputReference` seed —
  mẫu `beacon_nft.ak`); `status = Open`; `vote_close_epoch > vote_open_epoch`;
  `snapshot_epoch == vote_open_epoch`.
- `CloseVoting`: `get_epoch(tx, ms_per_epoch) ≥ vote_close_epoch` (dùng `util.get_epoch`); `status`
  chuyển `Open → Closed`; **value bảo toàn** (giữ nguyên NFT + ADA); đúng 1 proposal input + 1 output
  theo script hash (QĐ-T3).
- `RecordTally`: chỉ hợp lệ khi **Tally validator** chạy cùng tx (kiểm bằng có input/withdraw từ
  Tally script hash, hoặc Tally NFT có mặt); ghi `yes_power/no_power/abstain_power/voter_count`;
  `Closed → Tallied`.
- `ExecuteProposal`: `status = Tallied` và **điều kiện thông qua đạt** (biểu thức quorum + ngưỡng —
  xem §9.4; các ngưỡng là **tham số mở**, FEAT/MATH định). Nếu đề xuất chi tiêu kho bạc → tx này
  đồng thời chi `treasury.ak` (Distribution), Proposal validator chỉ chuyển trạng thái, **không** tự
  kiểm logic kho bạc (treasury tự kiểm).

> **Ghi chú liveness (sửa audit #7):** Vote dùng Proposal UTxO làm **reference input** (đọc, không
> tiêu) còn `CloseVoting` **tiêu (spend)** Proposal UTxO. Ở biên cửa-sổ-đóng có **điều kiện đua**:
> một tx vote phút chót dùng Proposal làm ref input có thể fail nếu một tx `CloseVoting` tiêu UTxO đó
> trước khi tx vote vào block (ref input trỏ UTxO đã tiêu → tx vote không hợp lệ). Đây KHÔNG phải lỗ
> hổng an toàn (không cho phép vote sai), chỉ là cạm bẫy liveness/UX. Giảm thiểu: (i) vote chỉ hợp lệ
> khi `epoch < vote_close_epoch` VÀ Proposal còn `Open` — validator đã ép điều này nên không có phiếu
> "lọt sau giờ"; (ii) ví/client nên ngừng nhận phiếu một khoảng an toàn trước biên; (iii) **cân nhắc
> để `CloseVoting` chỉ được phép sau một epoch ân hạn** (`epoch ≥ vote_close_epoch + grace`) để tx
> vote ở epoch cuối không bị tx đóng "cướp" UTxO. Độ dài ân hạn là **tham số mở (DAO định)**. Ghi vào
> câu hỏi treo §13.8.

ms_per_epoch là tham số mạng (Preview/Mainnet khác nhau) — truyền qua tham số hóa validator như
Distribution đang làm. [Cardano epoch params](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/).

---

## 4. Validator 2 — Vote (trọng tâm kỹ thuật)

### 4.1 Datum

```aiken
pub type VoteChoice { Yes  No  Abstain }

pub type VoteDatum {
  proposal_id  : ByteArray,    // phải khớp Proposal đang Open
  did_commit   : ByteArray,    // commitment công khai của DID (KHÔNG lộ sinh trắc)
  nullifier    : ByteArray,    // = H(did_commit ‖ proposal_id) — chống double-vote
  choice       : VoteChoice,
  // các đầu vào C_k đã CAP (số nguyên), do off-chain tính, validator verify bằng ref input:
  c1_capped    : Int,          // MAGIC tiêu thụ, đã min(·, cap1)
  c2_capped    : Int,          // ScheduleGen commitment, đã min(·, cap2)
  c3_capped    : Int,          // reputation, đã min(·, cap3)
  c4_capped    : Int,          // LAMP nắm giữ (registry-DID), đã min(·, cap4=100_000_000 — CONTRACT §1)
  vp_claimed   : Int,          // VP fixed-point off-chain tính (Tally kiểm lại bằng bảng tra)
}

pub type VoteRedeemer {
  CastVote {
    // proof từ PhoenixKey: chứng minh did_commit thuộc 1 người thật, chưa lộ sinh trắc
    did_proof   : ByteArray,        // [EXTERNAL — định dạng do PhoenixKey chốt]
    // các con trỏ reference input để validator tự đọc C_k (không tin off-chain):
    c1_ref_hint : Int,              // index của ref input MAGIC-consumption trong tx.reference_inputs
    c2_ref_hint : Int,
    c3_ref_hint : Int,              // index ref input Reputation registry
    c4_ref_hint : Int               // index ref input LAMP-holding registry (gắn DID — xem §5.4)
  }
  RetractVote                       // rút phiếu khi proposal còn Open — xem §6.4
}
```

> Lưu ý byte-perfect: như Distribution, datum on-chain phải khớp tuyệt đối với type off-chain
> (Constr index theo thứ tự khai báo — xem ghi chú đầu `types.ak`). Mọi thay đổi thứ tự field là
> breaking.

### 4.2 Kiểm tra `CastVote` (thứ tự, fail sớm)

1. **C-MINT:** mint chỉ gồm đúng 1 Nullifier token (xem §6), `tx.mint` không chứa gì khác lạ.
2. **Proposal đang Open:** đọc Proposal UTxO qua **reference input** (không tiêu nó — nhiều người
   vote song song cùng đọc 1 proposal, nên phải là *reference*, không phải *spend*). Kiểm
   `proposal_id` khớp, `status == Open`, `vote_open_epoch ≤ epoch < vote_close_epoch`.
   - Đọc reference input: [stdlib `Transaction.reference_inputs`](https://aiken-lang.github.io/stdlib/cardano/transaction.html).
   - Liveness biên cửa sổ: xem ghi chú §3.3.
3. **DID proof hợp lệ:** verify `did_commit` ∈ registry "1 người = 1 DID" của PhoenixKey **qua
   reference input** (cách (b) — **bắt buộc v1**, xem §4.4 ExUnit + §7). SNARK on-chain (cách (a)) bị
   **loại khỏi tx vote** vì lý do ExUnit (§4.4). **[EXTERNAL BLOCKER]** — chi tiết §7.
4. **Nullifier đúng:** token nullifier mint phải có name `= H(did_commit ‖ proposal_id)` và policy
   nullifier hợp lệ → một DID chỉ vote được 1 lần/proposal (§6).
5. **C_k chứng minh bằng reference input (không tin off-chain):**
   - `c1_capped == min(read_C1(ref MAGIC), cap1)`
   - `c2_capped == min(read_C2(ref ScheduleGen), cap2)`
   - `c3_capped == min(read_C3(ref reputation registry), cap3)`
   - `c4_capped == min(read_C4(ref LAMP-holding registry gắn DID), cap4)`
   - **Mỗi ref input PHẢI kiểm cả ba điều kiện** (a) UTxO ở **đúng script hash** đã tham số hóa,
     (b) **datum gắn `did_commit` KHỚP `did_commit` trong VoteDatum** (không chỉ "gắn DID" chung
     chung — xem §5.2, §5.8), (c) trường giá trị thỏa. **Thiếu (b) = mượn C_k của người khác** — đây
     là điều kiện sống-còn (sửa audit #8).
   - `cap1..cap3` đọc từ **UTxO tham số** (`weight_param_ref` của Proposal), **KHÔNG** tham số hóa
     cứng / không redeploy (sửa audit #11, xem §5.2, §5.5). `cap4 = 100_000_000` (CONTRACT §3) có thể
     cứng vì CONTRACT đã chốt là ngoại lệ.
6. **VP nhất quán:** TECH **không** tính lũy thừa ở Vote (QĐ-T1). Vote **chỉ** chốt `c*_capped` đúng;
   `vp_claimed` được **Tally** kiểm lại bằng bảng tra. (Không còn biến thể "kiểm ngay ở Vote" — đã
   chốt một-đường, sửa audit #9.)
7. **Value/min-ADA:** phiếu UTxO chỉ cần min-ADA + 1 Nullifier token. Bảo toàn: không rút ADA của
   ai khác; output phiếu đặt tại Vote script hash. min-ADA theo
   [ledger `coinsPerUTxOByte`](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/)
   — chi phí UTxO bloat ở §8.
8. **Chống double-satisfaction (QĐ-T3):** đúng 1 Vote output tại script hash mang nullifier vừa
   mint; reference input MAGIC/LAMP **không** bị tính nhầm là input chi tiêu.

### 4.3 Ví dụ số minh họa (giúp hiểu, KHÔNG phải tham số chốt)

Giả định DAO tạm đặt: cap1=10_000 MAGIC, cap2=50_000 LAMP, cap3=100, cap4=100_000_000 LAMP;
weight (sau lượng tử hóa MATH) w=(0.30, 0.20, 0.30, 0.20).

Cá voi giữ 12 tỷ LAMP, không có lịch sử:
- C1=0 → `c1_capped=0`. Vì công thức **nhân**, `0^{0.30}=0` → **VP=0**. Token vô hiệu (CONTRACT §3).

Người dùng lâu năm: C1=8_000 (cap 10_000), C2=50_000 (đạt cap), C3=80 (cap 100), C4=2_000_000:
- off-chain tính `VP = 8000^0.30 · 50000^0.20 · 80^0.30 · 2_000_000^0.20`.
- Vote chỉ kiểm: `c1_capped=8000, c2_capped=50000, c3_capped=80, c4_capped=2_000_000` đúng từ ref
  input. Tally tra bảng → cộng vào `yes_power`.

(Con số chỉ minh họa cơ chế; thang fixed-point và cách làm tròn là **MATH định**.)

### 4.4 Ngân sách ExUnit của tx `CastVote` (sửa audit #4)

Mỗi tx vote phải gói gọn dưới **`maxTxExUnits`** — giới hạn ExUnit mỗi tx (mem + cpu), là protocol
param Conway ([protocol params](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/);
**[cần verify]** giá trị chính xác `maxTxExUnits` trên Preview/Mainnet — tra
`cardano-cli query protocol-parameters` mục `maxTxExecutionUnits`, thường cỡ ~10–14M mem / ~10G cpu
mỗi tx, **[cần verify]** số đúng theo era hiện hành). Liệt kê chi phí từng bước của `CastVote`:

| Bước | Chi phí ExUnit (định tính) |
|---|---|
| Decode 4–5 reference input (Proposal + C1/C2/C3/C4 registry) | trung bình — mỗi datum decode tuyến tính theo size |
| `blake2b_256(did_commit ‖ proposal_id)` (nullifier name) | rẻ — một hash 32-byte ([stdlib `crypto.blake2b_256`](https://aiken-lang.github.io/stdlib/aiken/crypto.html)) |
| Kiểm `c*_capped == min(read_C_k, cap_k)` ×4 | rẻ — so sánh số nguyên |
| Bảo toàn value + đếm script hash (QĐ-T3) | rẻ–trung bình |
| **DID verify cách (a) — SNARK Groth16 pairing BLS12-381** | **RẤT đắt** — một verify pairing tốn cỡ hàng triệu ExUnit ([CIP-0381](https://cips.cardano.org/cip/CIP-0381)); cộng dồn với 4–5 ref decode + mint dễ **vượt `maxTxExUnits`** |
| **DID verify cách (b) — đọc ref input registry + membership rẻ** | **rẻ** — chỉ decode datum registry + so khớp `did_commit` |

**Kết luận (bắt buộc, không phải khuyến nghị):** **cách (b) registry là BẮT BUỘC cho v1.** Lý do:
gộp một SNARK pairing với 4–5 ref input decode + mint nullifier + kiểm value trong **cùng một tx**
nhiều khả năng **vượt `maxTxExUnits`** ([cần verify] số đúng). Nếu vẫn muốn giữ cửa cho cách (a)
SNARK tự chủ thì phải **tách did-verify thành tx riêng** (register-once): cử tri chứng minh DID một
lần ở tx A (chỉ chứa pairing, không gộp ref C_k), tx A tạo/cập nhật một entry registry; tx vote B
sau đó chỉ đọc registry rẻ. KHÔNG verify SNARK ngay trong tx vote. (Đồng bộ §7, câu hỏi treo §13.2 →
quyết định.)

---

## 5. Đọc C1 / C2 / C3 / C4 qua reference input — cross-repo

### 5.1 Vì sao reference input
Reference input ([CIP-0031](https://cips.cardano.org/cip/CIP-0031)) cho phép **đọc** một UTxO mà
**không tiêu** nó → nhiều phiếu song song cùng đọc một UTxO MAGIC/Proposal/registry mà không tranh
chấp (contention). Đây là điểm cốt lõi để Governance scale: nếu phải *spend* UTxO C_k, mỗi epoch chỉ
một người vote được.

> **Quan trọng (sửa audit #2):** reference input đọc giá trị **HIỆN TẠI** của UTxO tại thời điểm tx
> vào block — nó **KHÔNG** cho phép "đọc số dư tại epoch quá khứ". Vì thế mọi C_k phải đến từ một UTxO
> mà committee/oracle **post sẵn beacon giá trị-đã-snapshot gắn DID** (mẫu EXEC §2.2 đã dùng cho
> C1/C2/C3), **KHÔNG** đọc trực tiếp số dư ví trần. Đặc biệt C4 (xem §5.4).

### 5.2 C1 — MAGIC tiêu thụ (repo MAGIC)
- **Nguồn:** một UTxO/registry ở MAGIC ghi tổng MAGIC mà `DID` đã tiêu trong cửa sổ ~18 epoch
  (CONTRACT §1; độ dài cửa sổ là tham số mở), gắn `did_commit`, có authenticity token.
- **Giao diện đọc:** Vote validator nhận `c1_ref_hint` (index trong `tx.reference_inputs`), đọc
  output đó, **PHẢI kiểm cả ba**: (a) address ở **đúng script hash MAGIC-consumption** (tham số hóa
  vào Vote validator — không tin address bất kỳ); (b) **datum chứa `did_commit` KHỚP `did_commit` của
  VoteDatum** (không chỉ "gắn DID" chung chung); (c) trường "consumed trong cửa sổ" ≥ giá trị khai.
  Sau đó `c1_capped = min(consumed, cap1)`.
- **Cảnh báo bảo mật (sửa audit #8):** `c1_ref_hint` do **người gọi (redeemer) cung cấp**. Tin index
  trần rồi đọc `reference_inputs[hint]` mà **thiếu kiểm (b)** = cử tri trỏ hint tới beacon C1 của
  **người khác** có C1 cao → **mượn C1**. Kiểm (b) là **bắt buộc, sống-còn**. Cần negative test: trỏ
  ref hint tới beacon của DID khác → tx **fail**.
- **cap1 đọc từ UTxO tham số** (`weight_param_ref`), **KHÔNG** tham số hóa cứng / không redeploy
  (sửa audit #11).
- **Ranh giới:** **định nghĩa datum của MAGIC thuộc repo MAGIC.** TECH chỉ chốt *interface*: cần một
  trường số nguyên "MAGIC consumed trong cửa sổ N epoch, gắn DID" tại UTxO **đọc được bằng reference
  input** + **được chứng thực** (authenticity token), nếu không attacker tự đặt UTxO giả. → **phụ
  thuộc cross-repo (xem §12).**

### 5.3 C2 — ScheduleGen commitment (repo MAGIC)
- **Nguồn:** UTxO ScheduleGen ghi LAMP cử tri cam kết khóa cho cửa sổ tương lai ~24 epoch, gắn DID.
- **Giao diện đọc:** giống C1 — ref input tại đúng ScheduleGen script hash, **datum gắn `did_commit`
  khớp VoteDatum** (cùng rủi ro "mượn C2" nếu thiếu kiểm này — sửa audit #8), trường số "LAMP
  committed còn hiệu lực tại epoch hiện tại". `c2_capped = min(committed, cap2)`. `cap2` đọc từ UTxO
  tham số (sửa audit #11).
- **Tinh tế thời gian:** cam kết phải còn hiệu lực **tại epoch vote** — Vote kiểm `commit_end_epoch ≥
  epoch` để không tính cam kết đã hết hạn. (chống "cam kết rồi rút ngay").

### 5.4 C4 — LAMP nắm giữ (repo LAMP) — **registry gắn DID, KHÔNG reference input ví** (sửa audit #2)

> **Bản trước chốt sai:** "dùng (a) reference input ví + snapshot epoch cho v1". Audit chỉ ra đây là
> **cơ chế không khả thi + lỗ hổng kinh tế**:
> - Reference input đọc số dư **HIỆN TẠI**, không đọc được "số dư tại epoch mở proposal" → ví có thể
>   tiêu LAMP trước khi vote rồi nạp lại sau (ảnh số dư).
> - Không có gì ràng "UTxO LAMP này thuộc **duy nhất** `did_commit` của cử tri": **nhiều DID có thể
>   cùng trỏ ref input tới MỘT ví cá voi** ("cho mượn ảnh") → mỗi DID khai `c4_capped = cap4` từ cùng
>   một kho LAMP không ai thực giữ. Đọc `quantity_of` không kiểm quyền sở hữu gắn DID.

- **Quyết định v1 (chốt — khuyến nghị (a) của audit):** **bỏ "reference input ví"**, đo C4 qua một
  **LAMP-holding registry gắn DID** (giống C3 §5.5). Buộc **khóa/đăng ký LAMP theo DID**: một lượng
  LAMP chỉ đếm cho **một** DID (registry ghi `did_commit → lamp_holding_snapshot`, committee/oracle
  post tại `snapshot_epoch = vote_open_epoch`). Vì là registry gắn DID + một-LAMP-một-DID, không thể
  "cho mượn ảnh" cho 120 DID.
- **Giao diện đọc:** Vote nhận `c4_ref_hint`, kiểm (a) đúng script hash LAMP-holding registry,
  (b) `did_commit` khớp VoteDatum, (c) trường holding snapshot tại `snapshot_epoch` của Proposal.
  `c4_capped = min(holding, cap4)`. cap4 = **100 triệu LAMP** (CONTRACT §3 — con số đã chốt, ngoại lệ
  duy nhất so với "tham số mở").
- **Vì sao registry chứ không spend-để-chống-mượn:** giải pháp thay thế "buộc chính UTxO ví bị spend
  trong tx vote rồi trả lại" sẽ **phá tính song song §5.1** (spend = contention). Registry post-trước
  giữ được song song. (Đọc value khi committee dựng snapshot: `assets.quantity_of`,
  [stdlib `cardano/assets`](https://aiken-lang.github.io/stdlib/cardano/assets.html).)
- **Ai post snapshot phi tập trung** (không tạo "người canh" — CONTRACT §1): chung câu hỏi với C3 —
  thiết kế validator registry riêng (EXEC). Xem §13.4.

### 5.5 C3 — Reputation (repo LAMP)
- **Nguồn:** một **Reputation registry** UTxO (LAMP-side) ghi điểm uy tín theo DID (lịch sử quyết
  định đúng — CONTRACT §1). Cập nhật điểm là một validator riêng (ngoài 4 validator lõi; thuộc lộ
  trình EXEC). Vote đọc qua reference input + authenticity token, **kiểm `did_commit` khớp VoteDatum**
  (cùng rủi ro "mượn C3" — sửa audit #8). `c3_capped = min(rep, cap3)`. `cap3` đọc từ UTxO tham số
  (sửa audit #11).
- **Câu hỏi treo:** ai/cái gì cập nhật C3 phi tập trung (không "người canh" — CONTRACT §1)? — §13.3.

### 5.6 Bảng tham số/cap/weight on-chain (chống đổi luật giữa chừng)
**Cap (cap1..cap3) + weight + bảng tra** cố định trong một **UTxO tham số** mang DAO-param NFT.
Proposal lưu `weight_param_ref` trỏ tới UTxO này tại lúc Open. Mọi phiếu của proposal đó dùng **đúng**
bảng được trỏ → DAO đổi cap/weight cho proposal sau, không hồi tố proposal đang chạy. (eUTxO-friendly:
chỉ đọc, không tiêu.)

> **Sửa audit #11:** Cap đọc **từ datum của UTxO tham số này**, **KHÔNG** qua "redeploy validator".
> Redeploy = đổi script hash = đổi địa chỉ = phá mọi UTxO/beacon đang trỏ hash cũ, và KHÔNG phải "DAO
> chỉnh runtime" như CONTRACT §1 ngụ ý ("hệ DAO, không người canh tập trung"). Bỏ hẳn vế "redeploy"
> khỏi §5.2/§5.5. Ngoại lệ: `cap4 = 100_000_000` có thể tham số hóa cứng vì CONTRACT đã chốt cố định.

---

## 6. Chống double-vote — Nullifier minting policy

> **Sửa audit #1 (critical) — chỉnh nền tảng.** Bản trước khẳng định SAI: "asset (policy,name) là
> duy nhất toàn sổ cái → lần vote thứ hai không mint lại được". Plutus minting policy **KHÔNG thấy
> toàn bộ UTxO set**, chỉ thấy tx hiện tại. Nếu nullifier token đã bị **đốt (burn)** (qua RetractVote
> hay ReclaimAfterTally), thì `(policy,name)` đó **không còn tồn tại** → policy **không có cách nội
> tại nào biết "name này từng mint"** → cùng DID+proposal **mint lại được** → **double-vote**. Tính
> "duy nhất AssetName" chỉ đúng khi token còn **SỐNG** và buộc nó hiện diện ở một UTxO ta kiểm được;
> nó **KHÔNG** phải bất biến lịch sử. §6.4 cũ (burn để vote lại) trực tiếp phá §6.1 cũ.
>
> **Chọn mẫu B (chốt cho v1):** **giữ token-nullifier nhưng CẤM tuyệt đối burn trước khi proposal
> `Tallied`** (giống `beacon_nft.ak` cấm burn beacon), và buộc nullifier token **hiện diện cùng Vote
> UTxO mà Tally tiêu** khi đếm. Hệ quả: **KHÔNG cho RetractVote đổi-ý-rồi-vote-lại** (cho phép =
> mở cửa double-vote). Đây là eUTxO-đơn-giản, không cần cấu trúc dữ liệu mới. (Mẫu A — sổ nullifier
> sorted-set với non-membership proof — mạnh hơn nhưng nặng; để dành, xem §6.6 + §13.7.)

### 6.1 Nguyên lý (mẫu B)
"1 DID = 1 phiếu/proposal" thực thi bằng **token nullifier sống tới khi Tallied**: mint một NFT có
**asset name = `H(did_commit ‖ proposal_id)`**, gắn **cùng** Vote UTxO. Nullifier policy:
- name khai `== blake2b_256(did_commit ‖ proposal_id)`
  ([stdlib `aiken/crypto.blake2b_256`](https://aiken-lang.github.io/stdlib/aiken/crypto.html)),
- mint đúng số lượng **+1** (cấm mint >1, cấm mint số âm/burn — xem §6.4),
- proposal đang `Open` (đọc ref input),
- DID proof hợp lệ (§7).

Vì policy cấm burn trước `Tallied`, mọi nullifier của một proposal **đồng thời sống** trong cửa sổ
vote → trong cửa sổ đó `(policy,name)` thực sự **duy nhất đang-sống** → mint trùng cùng `(DID,
proposal)` thất bại (đã có một token cùng name sống, mint thêm bị policy chặn vì name phải bằng hash
và Tally/Vote buộc 1 token/UTxO). **Đây mới là tính duy nhất ĐÚNG** — duy nhất *khi còn sống*, không
phải bất biến lịch sử.

### 6.2 Nullifier khác one-shot beacon thế nào
Beacon NFT của Distribution là one-shot theo **OutputReference seed** (mint đúng 1 lần khi tiêu seed
UTxO). Nullifier KHÁC: tên token là **hàm của (DID, proposal)**, không của UTxO seed → policy kiểm
name = hash thay vì kiểm tiêu seed. Điểm **chung** với beacon: **cấm burn** (beacon_nft.ak cấm burn
beacon; nullifier cấm burn trước Tallied).

### 6.3 Vì sao token, không phải "quét toàn sổ"
Plutus validator **không** quét được toàn bộ UTxO set để hỏi "DID này vote chưa". Validator chỉ
thấy dữ liệu **trong tx**. Nullifier biến câu hỏi global ("đã vote chưa") thành ràng buộc local
("mint được token tên này không, với điều kiện token cũ chưa burn"). Đây tương tự nullifier trong hệ
riêng tư (vd Zcash) — nhưng Zcash dùng **cây nullifier tích lũy** (sorted-set/accumulator) để chống
double-spend *bất biến lịch sử*; ở đây mẫu B đạt mục tiêu rẻ hơn bằng **cấm-burn-tới-Tallied** thay
cho cây tích lũy. (Nếu cần bất biến lịch sử thật, dùng mẫu A §6.6.)

### 6.4 RetractVote (rút phiếu) — **KHÔNG cho đổi-ý-rồi-vote-lại** (sửa audit #1)
- Policy **cấm burn nullifier khi proposal chưa `Tallied`**. Vì thế `RetractVote` **không được đốt
  nullifier**. Hệ quả thiết kế: nếu FEAT muốn "rút phiếu", `RetractVote` chỉ có thể **đổi `choice`
  của chính UTxO phiếu** (vd Yes→No→Abstain) **trong khi giữ nguyên nullifier**, KHÔNG xóa-rồi-tạo-
  lại. Đổi `choice` không sinh nullifier mới → không mở cửa double-vote.
- **Cấm tuyệt đối**: burn nullifier → mint lại = double-vote. Đó là lý do bản trước (burn để vote
  lại) bị bác. **TECH KHÔNG hỗ trợ "đổi ý bằng burn-rồi-vote-lại".**
- Câu hỏi FEAT (§13.5): cho `RetractVote` đổi `choice` tại chỗ hay khóa cứng phiếu tới Tally — cả hai
  đều **giữ nullifier sống**, đều an toàn.

### 6.5 So khớp số phiếu ↔ nullifier — **kiểm OFF-CHAIN, không phải invariant validator** (sửa audit #6)

> **Bản trước sai:** "Tally kiểm **số Vote UTxO == số nullifier đã mint cho proposal**". Đây là một
> invariant **GLOBAL** ("tổng nullifier toàn proposal đã mint trong quá khứ") mà một tx Tally đơn lẻ
> **KHÔNG kiểm được** — validator chỉ thấy nullifier trong tx của nó, không đếm được tổng nullifier
> toàn proposal. Nó là kiểm tra **off-chain/indexer**, KHÔNG phải ràng buộc validator.

- **On-chain thực thi được (thay cho invariant global):** Tally **chỉ cộng các Vote UTxO MANG
  nullifier token hợp lệ** (token nullifier nằm **cùng** UTxO phiếu). "Phiếu ma không nullifier" tự
  bị loại vì Tally **bỏ qua** UTxO thiếu nullifier token → không cần đếm global. Đây là invariant
  **local**, validator kiểm được. (Vì §6.1 buộc nullifier gắn cùng Vote UTxO khi mint, mọi phiếu hợp
  lệ đều mang token; phiếu không token = giả → bị loại.)
- **§6.5 là lớp OFF-CHAIN bổ trợ:** indexer đối chiếu `số Vote UTxO ≟ số nullifier đã mint` để phát
  hiện bất thường thống kê — KHÔNG dùng nó như rào on-chain chống nhồi phiếu (rào on-chain đã nằm ở
  "Tally chỉ cộng phiếu-có-nullifier" trên).

### 6.6 Mẫu A (dự phòng, KHÔNG dùng v1) — sổ nullifier sorted-set
Nếu sau này cần **bất biến lịch sử** (chống double-vote kể cả khi cho phép burn-và-mint-lại), phải
dùng **sorted-set commitment** (sparse Merkle tree / sorted-list root) hỗ trợ **non-membership proof
+ insert**: CastVote chứng minh nullifier **chưa có** trong root cũ rồi **chèn** → root mới. Đây là
**cấu trúc khác**, KHÔNG tái dùng `merkle.ak` (merkle.ak chỉ verify trên root tĩnh — xem §9.2). Mẫu A
nặng ExUnit hơn mẫu B; chỉ cân nhắc nếu FEAT bắt buộc cho "đổi ý" mà vẫn cần bất biến. Xem §13.7.

---

## 7. DID proof từ PhoenixKey — EXTERNAL DEPENDENCY / BLOCKER

CONTRACT §3: PhoenixKey DID sinh trắc + zk-proof "1 DID = 1 người" thuộc **backend PhoenixKey**,
NGOÀI repo LAMP; Claude **không sửa**; là **blocker tiên quyết** — Governance không chạy thật trước
khi có DID proof on-chain.

### 7.1 TECH cần PhoenixKey cung cấp (interface, do PhoenixKey chốt — [cần verify])
1. **Định dạng `did_commit`**: commitment công khai ổn định cho một người, không lộ sinh trắc.
2. **Verifier on-chain**: cách kiểm `did_proof` trong Vote validator. Hai khả năng:
   - (a) **zk-SNARK on-chain** dùng pairing BLS12-381 mà Plutus V3 hỗ trợ
     ([CIP-0381 — BLS12-381 builtins](https://cips.cardano.org/cip/CIP-0381);
     [stdlib `aiken/crypto/bls12_381`](https://aiken-lang.github.io/stdlib/aiken/crypto/bls12_381.html)).
     Tự chủ nhưng **rất đắt ExUnit** → **KHÔNG đặt trong tx vote** (xem §4.4); nếu dùng phải **tách
     thành tx register-once riêng** trước vote.
   - (b) **Registry pattern**: PhoenixKey duy trì on-chain registry các `did_commit` đã chứng thực
     (committee/oracle PhoenixKey ký). Vote chỉ đọc reference input registry + kiểm membership rẻ.
     Đẩy chi phí zk ra ngoài tx vote. **BẮT BUỘC v1** (không chỉ "khuyến nghị") vì gộp SNARK vào tx
     vote nhiều khả năng vượt `maxTxExUnits` (§4.4).
3. **Chống chuyển nhượng DID**: đảm bảo `did_commit` không bán/cho thuê được — thuộc PhoenixKey.

### 7.2 Vị trí trong tx vote
- **Cách (b) — v1:** `did_commit` có trong **reference input** = PhoenixKey DID-registry (gắn
  authenticity token PhoenixKey); `did_proof` chỉ là con trỏ + chữ ký liveness (tránh phát lại).
- **Cách (a) — nếu dùng về sau:** SNARK pairing verify ở **tx register-once riêng** (không phải tx
  vote), tx đó tạo/cập nhật entry registry; tx vote vẫn đọc registry như cách (b). KHÔNG verify
  pairing trong tx vote (§4.4).

### 7.3 Trạng thái
**BLOCKER mở.** TECH chốt **cách (b) cho v1**; thiết kế vẫn **cắm vào được cách (a)** qua tx
register-once. EXEC phải đặt mốc: Governance live phụ thuộc PhoenixKey expose registry. Đến khi đó,
build + test bằng **DID mock** (committee test ký) để không kẹt tiến độ.

---

## 8. Bảo toàn value, min-ADA, UTxO bloat

### 8.1 Bảo toàn value (bài học M1 — chống drain ADA)
Audit Distribution M1: LAMP delta đúng nhưng rút lén ADA → phải kiểm **value tuyệt đối**
(`treasury.ak`: `tre_out.value == assets.add(tre_in.value, …, -released)` — trích theo tên field/hàm,
xem nit #10). Áp dụng:
- **CloseVoting/RecordTally:** Proposal output value == input value (giữ NFT + ADA nguyên).
- **ExecuteProposal chi kho bạc:** logic chi do `treasury.ak` kiểm (nó đã bảo toàn mọi asset khác).
- **Vote UTxO:** chỉ min-ADA + nullifier; không nhận/nhả asset lạ.

### 8.2 min-ADA & UTxO bloat
Mỗi phiếu = 1 UTxO khóa min-ADA. 10_000 cử tri/proposal = 10_000 UTxO. Đánh đổi:
- *Chi phí:* min-ADA mỗi UTxO (~1–2 ADA tùy size, theo `coinsPerUTxOByte`
  [Cardano params](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/)). Cử tri tự
  trả min-ADA của phiếu mình → không rút từ kho bạc.
- *Thu hồi — qua chính Tally (sửa audit #1, #3):* Tally **tiêu (spend)** Vote UTxO khi đếm (§9). Vì
  Tally chỉ chạy khi Proposal `Closed→Tallied`, **chính bước Tally đốt nullifier + trả min-ADA về
  owner** ngay trong lô tally. KHÔNG còn redeemer `ReclaimAfterTally` riêng (bản trước đốt nullifier
  riêng — đã gộp vào Tally để mỗi nullifier sống đúng tới lúc bị Tally tiêu). Burn nullifier **chỉ**
  hợp lệ trong tx Tally (proposal đang/đã `Tallied`), KHÔNG sớm hơn (§6.4). → trạng thái chain không
  phình vĩnh viễn.
- *Tối ưu Tally:* không "đọc" cả 10_000 UTxO trong **một** tx (vượt ExUnit). Tally **tiêu theo lô** —
  xem §9.

### 8.3 Datum nhỏ
Vote datum chỉ số nguyên + 2–3 bytearray hash (32 byte) → nhỏ. Tránh nhồi list dài vào datum (mỗi
byte datum tăng min-ADA). DID proof bytes (nếu từng dùng cách (a) ở tx register-once) nằm ở
**redeemer**, KHÔNG datum → không tính vào min-ADA UTxO phiếu.

---

## 9. Validator 3 — Tally (tiêu theo lô — spend-đếm)

> **Sửa audit #3 (major) + #1.** Bản trước đề xuất accumulator Merkle (`consumed_root`) tái dùng
> `merkle.ak`. **Đã verify:** `merkle.ak` (Distribution, `lib/magiclamp/lampdist/merkle.ak`) chỉ có
> `verify_proof`/`verify_claim` trên một **root TĨNH** (cây cố định, RFC6962, sorted-pair) — **KHÔNG**
> có primitive `insert`/`append`, **KHÔNG** có non-membership proof. Một accumulator cộng-dồn-tăng-
> dần cần "chứng minh X chưa có trong root cũ" rồi "root mới = root cũ + X" — `merkle.ak` không làm
> được (nó giả định toàn bộ leaf biết trước để dựng cây off-chain). Dùng nó cho `consumed_root` đang
> chạy là **sai cấu trúc dữ liệu**.
>
> **Chốt giải pháp (b) của audit — spend-đếm:** **bỏ accumulator**; mỗi lô tally **TIÊU (spend)** các
> Vote UTxO nó cộng. UTxO đã tiêu **không cộng lại được** (one-shot tự nhiên của eUTxO) → không cần
> `consumed_root`, không cần non-membership. Đánh đổi: spend phá song song, **nhưng Tally vốn tuần tự**
> (cộng dồn vào một acc UTxO) nên chấp nhận được. Câu hỏi treo §13.7 đã thành quyết định.

### 9.1 Vấn đề ExUnit
Không thể duyệt 10_000 Vote UTxO trong 1 tx. Plutus có `maxTxExUnits` giới hạn
([params](https://docs.cardano.org/about-cardano/explore-more/parameter-guide/)).

### 9.2 Mẫu fold tăng dần — **spend-đếm, không Merkle**
Một **Tally accumulator** UTxO (mang Tally NFT) cho mỗi proposal:

```aiken
pub type TallyDatum {
  proposal_id   : ByteArray,
  yes_power_acc : Int,
  no_power_acc  : Int,
  abstain_power_acc : Int,
  voters_acc    : Int,        // số DID đã cộng (quorum theo người — §9.4)
  // KHÔNG còn consumed_root: chống đếm-trùng bằng SPEND Vote UTxO (đã tiêu = không cộng lại).
}
```

Mỗi tx tally **gom một lô** Vote UTxO (vd 50–100 phiếu/tx, dưới `maxTxExUnits`) bằng cách **tiêu**
chúng (spend), cộng dồn vào acc, **đồng thời đốt nullifier + trả min-ADA về owner từng phiếu** (§8.2).
Lặp tới khi hết phiếu → tx cuối `RecordTally` lên Proposal. **Không cần `consumed_root`** vì UTxO đã
tiêu ở lô trước không thể xuất hiện lại ở lô sau (ledger eUTxO bảo đảm) — đây mới là chống đếm-trùng
đúng eUTxO.

- Quy đổi `c*_capped → power`: tại Tally, dùng **bảng tra số nguyên** từ UTxO weight-param (trỏ bởi
  `weight_param_ref` của Proposal). Đây là nơi áp `w_k` (số mũ) đã lượng tử hóa — **MATH định dạng
  bảng**. Tally cộng `power_i` cho YES/NO/Abstain.
- **Không tái dùng `merkle.ak`** cho mục đích này (lý do trên). `merkle.ak` vẫn là khuôn hợp lệ cho
  các root TĨNH (vd Distribution) — chỉ không hợp cho accumulator chạy.

### 9.3 Chống double-satisfaction tại Tally
- Đếm theo script hash (QĐ-T3): đúng 1 Tally acc input + 1 output; mọi Vote input **bị tiêu** đếm
  theo Vote script hash; **mỗi Vote UTxO chỉ cộng được một lần** vì nó bị spend (không cần kiểm
  membership `consumed_root` nữa — sửa audit #3).
- Chỉ cộng Vote UTxO **mang nullifier token hợp lệ** (phiếu-không-nullifier bị loại — §6.5).
- Bảo toàn: Tally acc output value == input value + (chỉ datum đổi); min-ADA các Vote UTxO bị tiêu
  trả về owner (không vào acc, không drain).

### 9.4 Quorum — **biểu thức xác định, hai trục** (sửa audit #5)

> **Bản trước mơ hồ:** §9.4 ghi "Quorum theo NGƯỜI, không theo token" trong khi FEAT §3.1/§3.3 +
> §6 nói quorum theo **tổng VP**. "Theo người" ≠ "theo VP" ≠ "theo token" — **ba khái niệm**. Để mơ
> hồ ở tầng on-chain là nguy hiểm vì validator phải kiểm một **biểu thức cụ thể**.

TallyDatum cung cấp **cả hai** số liệu: `voters_acc` (số DID) và `yes/no/abstain_power_acc` (tổng VP).
**Mã hóa quorum như biểu thức xác định** mà `ExecuteProposal` (§3.3) kiểm:

```
total_vp     = yes_power_acc + no_power_acc + abstain_power_acc
pass(proposal) =
     total_vp     ≥ quorum_vp_threshold          // quorum THEO VP (trục chính, đồng bộ FEAT §3)
  && voter_count   ≥ quorum_voter_threshold       // quorum THEO NGƯỜI (sàn chống thiểu-số-VP-cao)
  && yes_power_acc > no_power_acc                  // ngưỡng thông qua (FEAT/MATH định dạng chính xác)
```

- **Chốt đồng bộ liên-spec:** quyết-định thường **quorum theo VP** là trục chính (đồng bộ FEAT §3.3);
  `voter_count` là **sàn phụ** (chống một thiểu-số VP-cao tự quyết). Cả hai ngưỡng (`quorum_vp_threshold`,
  `quorum_voter_threshold`) là **tham số mở (DAO định)** — đọc từ UTxO tham số (§5.6).
- **Recall (EXEC §8) khác:** **khởi xướng** recall dùng **co-sign theo đầu người** (vd 200/500 — đếm
  số DID đồng-ký), còn **quyết-định** recall vẫn theo VP. Tách rõ: "đầu người" chỉ cho NGƯỠNG KHỞI
  XƯỚNG, không cho kết quả bỏ phiếu. Xem §10.3.
- `abstain_power` vào `total_vp` (tính quorum-VP) nhưng KHÔNG vào yes/no → phiếu Abstain *góp quorum*
  mà không nghiêng kết quả. (Phiếu VP≈0 có vào quorum không — đồng bộ FEAT câu hỏi treo §10.6; nếu
  FEAT chốt loại VP≈0 khỏi quorum thì Tally bỏ qua khi cộng. Xem §13.9.)

---

## 10. Validator 4 — Recall (bãi nhiệm)

### 10.1 Vai trò
Cho phép cộng đồng **bãi nhiệm** một quyết định/đại diện đã thông qua (CONTRACT §4 liệt kê recall ở
phạm vi FEAT/TECH). Bản chất kỹ thuật = một proposal đặc biệt nhắm vào một
`target` (proposal_id đã Executed, hoặc một role/credential).

### 10.2 Datum/Redeemer

```aiken
pub type RecallDatum {
  target_id     : ByteArray,   // cái bị recall
  status        : ProposalStatus,
  recall_open   : Int,
  recall_close  : Int,
  cosign_count  : Int,         // số DID đồng-ký khởi xướng (ngưỡng đầu-người — §10.3)
  yes_power     : Int,
  no_power      : Int,
  abstain_power : Int,
  voter_count   : Int,
}

pub type RecallRedeemer {
  OpenRecall { cosigners: Int } // chỉ mở khi cosign_count ≥ ngưỡng đầu-người (tham số mở)
  CloseRecall
  RecordRecallTally { yes: Int, no: Int, abstain: Int, voters: Int }
  ExecuteRecall   // nếu đạt ngưỡng VP (thường CAO hơn proposal thường — tham số mở)
}
```

### 10.3 Tái dùng
Recall **dùng lại** cơ chế Vote + Nullifier + Tally (cùng `did_commit`, nullifier =
`H(did ‖ "recall:" ‖ target_id)` để tách không gian với vote thường). Khác biệt chính:
- **Khởi xướng theo đầu người:** `OpenRecall` chỉ hợp lệ khi `cosign_count ≥ cosign_threshold` (số
  DID đồng-ký, vd 200/500 — EXEC §8). Đây là ngưỡng **đầu-người** (sửa audit #5: chỉ KHỞI XƯỚNG mới
  đếm đầu người).
- **Quyết-định theo VP:** `ExecuteRecall` kiểm biểu thức quorum-VP như §9.4 nhưng **ngưỡng cao hơn**
  proposal thường (chống lạm dụng bãi nhiệm).
- Có thể yêu cầu **VP tối thiểu của người khởi xướng** (chống spam recall).
- Các ngưỡng đều **tham số mở (DAO định)**.

### 10.4 Hiệu lực
`ExecuteRecall` đảo trạng thái target: vd nếu target là proposal chi kho bạc chưa giải ngân hết →
chặn `treasury.ak` giải ngân tiếp (qua điều kiện liên kết — chi tiết liên kết treasury là **câu hỏi
treo**, phụ thuộc thiết kế quyền của treasury hiện tại chỉ kiểm Merkle redeem, chưa có "governance
veto" — §13.6).

---

## 11. Tham số mở (DAO định)

| Tham số | Ghi chú |
|---|---|
| `cap1` (MAGIC consumed) | CONTRACT để "DAO định". Đọc từ UTxO tham số (§5.6), KHÔNG redeploy. Ví dụ minh họa dùng 10_000 — KHÔNG chốt. |
| `cap2` (ScheduleGen committed) | DAO định, đọc từ UTxO tham số. |
| `cap3` (reputation) | DAO định, đọc từ UTxO tham số. |
| `cap4` (LAMP nắm giữ) | **= 100_000_000 LAMP** — CONTRACT §3 đã chốt (ngoại lệ, có thể tham số hóa cứng). |
| `w_1..w_k` (weight/số mũ) | MATH định dạng lượng tử hóa; DAO chỉnh giá trị qua weight-param UTxO. |
| Độ dài cửa sổ C1 (~18 epoch), C2 (~24 epoch) | CONTRACT nêu "~", con số cuối DAO định. |
| Độ dài cửa sổ vote, recall | DAO định. |
| Epoch ân hạn `CloseVoting` (chống đua biên — §3.3) | DAO định. |
| `quorum_vp_threshold` (quorum theo VP — §9.4) | DAO định (trục chính). |
| `quorum_voter_threshold` (quorum theo người — §9.4) | DAO định (sàn phụ). |
| Ngưỡng thông qua proposal | FEAT/MATH định; DAO chỉnh. |
| `cosign_threshold` khởi xướng recall (đầu người — §10.3) | DAO định. |
| Ngưỡng VP + VP tối thiểu khởi xướng recall | DAO định (cao hơn proposal thường). |
| Thang fixed-point của `vp_claimed`/power | MATH định. |

---

## 12. Phụ thuộc

1. **PhoenixKey (BLOCKER tiên quyết).** Cần: định dạng `did_commit`, **registry chứng thực** (v1 —
   §7), bảo đảm DID không chuyển nhượng. (SNARK BLS12-381 chỉ nếu tách tx register-once — §4.4.) Đến
   khi có → build/test bằng DID mock. (CONTRACT §3.)
2. **Repo MAGIC.** Cần MAGIC expose, ở UTxO đọc-bằng-reference-input + có authenticity token + **gắn
   `did_commit`**:
   - C1: "MAGIC consumed trong cửa sổ N epoch, gắn DID".
   - C2: "LAMP committed trong ScheduleGen còn hiệu lực, gắn DID".
   Datum/policy do **MAGIC repo** định; TECH chỉ tiêu thụ. (CONTRACT §3.)
3. **Repo LAMP — sẵn có để tái dùng:** `util.ak` (đếm theo script hash, `get_epoch`, builders),
   `treasury.ak` (liên kết ExecuteProposal chi kho bạc), mẫu one-shot `beacon_nft.ak` (authenticity
   NFT + nullifier policy, **cấm burn**). **Lưu ý:** `merkle.ak` **KHÔNG** dùng cho Tally (chỉ verify
   root tĩnh, không accumulator — §9.2). Aiken stdlib v3.1.0, Plutus V3 (`aiken.toml`).
4. **LAMP-holding registry + Reputation registry (LAMP-side, mới):** validator riêng post snapshot C4
   (§5.4) + C3 (§5.5) gắn DID, phi tập trung (EXEC). C4 KHÔNG đọc ví trần (sửa audit #2).
5. **MATH spec.** Dạng lượng tử hóa `w_k`, thang fixed-point, làm tròn, bảng tra power.
6. **FEAT spec.** `RetractVote` đổi `choice` tại chỗ hay khóa cứng (KHÔNG burn-vote-lại — §6.4); loại
   quyết định; ngưỡng chính sách; phiếu VP≈0 vào quorum không (§9.4).

---

## 13. Câu hỏi còn treo

1. **VP verify ở đâu — ĐÃ CHỐT (sửa audit #9):** Vote chỉ chốt `c*_capped` từ ref input; Tally tra
   bảng số nguyên. Biến thể "mốc nội suy đã ký" đã **bỏ** (tin off-chain, mâu thuẫn nội tại). Còn lại
   phụ thuộc MATH: dạng bảng-power (log-domain hay tra số nguyên trực tiếp).
2. **DID verifier — ĐÃ CHỐT v1 (sửa audit #4):** registry chứng thực PhoenixKey (cách b) **bắt buộc**
   trong tx vote; SNARK on-chain (cách a) nếu dùng phải tách tx register-once. Còn chờ PhoenixKey
   expose registry.
3. **C3 cập nhật phi tập trung:** ai/cái gì ghi điểm uy tín mà không tạo "người canh" tập trung
   (mâu thuẫn CONTRACT §1 "không người canh")? Cần thiết kế validator reputation riêng (EXEC).
4. **C4 snapshot phi tập trung:** ai post LAMP-holding snapshot gắn DID tại `snapshot_epoch` mà không
   thành "người canh" (cùng dạng câu hỏi C3)? **Đã chốt KHÔNG đọc ví trần** (sửa audit #2); cách post
   snapshot decentralize còn mở (EXEC).
5. **RetractVote:** cho `RetractVote` đổi `choice` tại chỗ hay khóa cứng phiếu — thuộc FEAT. **Cả hai
   đều GIỮ nullifier sống** (KHÔNG burn-vote-lại — sửa audit #1, §6.4).
6. **Recall ↔ treasury veto:** `treasury.ak` hiện chỉ kiểm Merkle redeem, chưa có móc "governance
   veto". Liên kết ExecuteRecall → chặn giải ngân cần bổ sung điều kiện vào treasury (thay đổi
   contract Distribution — cần anh duyệt vì đụng repo đã live Preview).
7. **Chống đếm-trùng nullifier — ĐÃ CHỐT (sửa audit #3):** Tally **spend** Vote UTxO (one-shot tự
   nhiên), KHÔNG accumulator Merkle (`merkle.ak` không insert/non-membership được). Mẫu A sorted-set
   (§6.6) chỉ dự phòng nếu sau này cần bất biến lịch sử cho phép burn-vote-lại.
8. **Đua biên CloseVoting (sửa audit #7):** chốt độ dài epoch ân hạn `CloseVoting` (§3.3) để tx vote
   phút chót không bị "cướp" Proposal UTxO. Tham số mở.
9. **Phiếu VP≈0 vào quorum-VP không (sửa audit #5):** đồng bộ FEAT câu hỏi treo §10.6. Nếu loại,
   Tally bỏ qua khi cộng `total_vp`.

---

## Phản hồi audit

Áp dụng 11/11 phát hiện. Tóm tắt xử lý từng cái (không bác cái nào):

1. **[critical] Nullifier "AssetName duy nhất toàn sổ" sai nền tảng — ÁP DỤNG.** Bỏ giả định. Chọn
   **mẫu B**: cấm burn nullifier trước `Tallied`, nullifier gắn cùng Vote UTxO, KHÔNG cho burn-vote-
   lại. Viết lại §6.1/§6.3/§6.4, gộp thu-hồi vào Tally (§8.2), thêm mẫu A dự phòng §6.6 (sorted-set,
   KHÔNG merkle.ak). §6.4 cũ (burn để vote lại) đã bị loại vì phá §6.1.
2. **[critical] "Reference input ví + snapshot epoch" cho C4 không khả thi + lỗ hổng kinh tế — ÁP
   DỤNG (chọn (a) của audit).** Bỏ đọc ví trần. C4 đọc qua **LAMP-holding registry gắn DID** (một
   LAMP một DID), committee post snapshot tại `vote_open_epoch`. Viết lại §5.4; cập nhật §1 sơ đồ, §12.
3. **[major] `merkle.ak` không làm accumulator chạy — ÁP DỤNG (chọn (b) spend-đếm).** Đã verify
   merkle.ak chỉ có `verify_proof`/`verify_claim` trên root tĩnh, không insert/non-membership. Bỏ
   `consumed_root`; Tally **spend** Vote UTxO theo lô. Viết lại §9.2/§9.3, cập nhật §13.7.
4. **[major] ExUnit tx CastVote — ÁP DỤNG.** Thêm §4.4 ngân sách ExUnit từng bước; **chốt cách (b)
   registry DID BẮT BUỘC** (không chỉ khuyến nghị); SNARK (a) nếu dùng phải tách tx register-once.
   `maxTxExUnits` đánh dấu **[cần verify]** số chính xác Preview/Mainnet. Cập nhật §7.
5. **[major] Mâu thuẫn quorum theo người/VP/token — ÁP DỤNG.** Mã hóa quorum thành **biểu thức xác
   định hai trục** (§9.4): quorum-VP là chính (đồng bộ FEAT §3), `voter_count` là sàn phụ; recall
   khởi-xướng mới theo đầu người (§10.3). Thêm `abstain_power`. Cross-ref FEAT §10.6 (§13.9).
6. **[major] §6.5 invariant global không thực thi on-chain — ÁP DỤNG.** Ghi rõ §6.5 là kiểm
   **off-chain/indexer**; rào on-chain thật = "Tally chỉ cộng Vote UTxO MANG nullifier hợp lệ" (local,
   validator kiểm được). Viết lại §6.5, §9.3.
7. **[minor] Đua biên CloseVoting (ref vs spend Proposal) — ÁP DỤNG.** Thêm ghi chú liveness §3.3 +
   đề xuất epoch ân hạn `CloseVoting`; thêm tham số §11; câu hỏi treo §13.8.
8. **[minor] `c*_ref_hint` thiếu ràng `did_commit` = mượn C_k người khác — ÁP DỤNG.** Nhấn mạnh điều
   kiện **bắt buộc (b)**: datum beacon C1/C2/C3/C4 phải KHỚP `did_commit` của VoteDatum; yêu cầu
   negative test. Viết lại §4.2 bước 5, §5.2, §5.3, §5.5.
9. **[minor] "Mốc nội suy đã ký" tin off-chain, hai biến thể lửng lơ — ÁP DỤNG.** Bỏ hẳn biến thể
   này. Chốt một-đường: Vote verify `c*_capped`, Tally tra bảng. Viết lại QĐ-T1; §13.1 thành quyết
   định.
10. **[nit] Số dòng trích dẫn lệch — ÁP DỤNG.** Verify thực tế: `get_epoch` dòng 12 (audit nói 11-14;
    dòng 12 là đúng dòng signature), `count_inputs_at_script` dòng 59, `script_count_catches_stake_
    cred_double` dòng 198. Để bền, **đã chuyển mọi trích dẫn sang TÊN HÀM/field** thay vì số dòng
    (số dòng trôi khi sửa file). QĐ-T3, §3.3, §8.1.
11. **[nit] "Redeploy validator để đổi cap" mâu thuẫn CONTRACT §1 — ÁP DỤNG.** Cap1..cap3 (+ weight)
    đọc từ **UTxO tham số** (DAO-param NFT, §5.6), KHÔNG redeploy. Bỏ vế "redeploy" khỏi §5.2/§5.5.
    cap4 cố định cứng (CONTRACT chốt). Cập nhật §4.2, §11.

**Không bác phát hiện nào** — tất cả đều đúng về bản chất eUTxO/ExUnit/CONTRACT. Các con số tham số
(cap, weight, ngưỡng quorum, độ dài cửa sổ, epoch ân hạn) giữ **tham số mở (DAO định)**; chỉ
`cap4=100_000_000` cố định theo CONTRACT §3.

---

*Hết TECH (bản 2 sau audit). Nguồn chuẩn khung: `CONTRACT.md`. Công thức/giá trị: `MATH`. Hành vi:
`FEAT`. Lộ trình: `EXEC`.*
