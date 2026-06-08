# Treasury — CONTRACT (interface đa thuê bao)

**Trạng thái:** khung interface 2026-06-05 (chờ anh duyệt). Đây là **xương sống** mà 2 nhóm build
song song phải bám: **(A) `collectToTreasury`** (lớp thu) và **(B) Treasury core** (custody + bucket
+ release). KHÔNG nhóm nào tự đổi schema/bất biến ở đây.

Gốc: state §6 (Treasury design) + §7 (fee model) + rà soát 2026-06-05 (generators đã trả Treasury;
OriLife `animal_fee` cắt 7%; MAGIC AppEconomics). Reconcile `Foundation-Bootstrap.md §7` (3 quỹ cứng
→ nay là **buckets cấu hình**).

## 1. Mô hình đa thuê bao

- Treasury = **instance** param hóa. MagicLamp = một instance; team eco khác = instance khác (open SDK).
- Tham số instance: `(governance_ref, accepted_assets[], buckets[], protocol_cut_bps)`.
- **Custody tách accounting:** value nằm ở 1 (hoặc shard) UTxO custody; **bucket = sổ kế toán trong
  datum**, KHÔNG phải mỗi bucket một UTxO (chống bloat + min-ADA). DAO chỉnh % từng bucket.
- **Emergency bucket tách physical** (isolation) — không gộp custody với bucket thường.

## 2. Ba cửa tiền (KHÔNG gộp polymorphic theo addr)

| Hàm | Ý nghĩa |
|---|---|
| `transfer(asset, amount, addr)` | gửi ví thường — KHÔNG vào treasury, KHÔNG ghi sổ |
| `collectToTreasury(asset, amount, app_id, category)` | **THU về treasury** + ghi sổ + receipt (hàm chung, §3) |
| `donateToCardanoTreasury(ada)` | Conway `treasury_donation` — ADA-only, KHÔNG có addr (kho bạc Cardano riêng biệt) |

## 3. `collectToTreasury` — hàm thu dùng chung (nhóm A)

Chữ ký: `collectToTreasury(asset ∈ accepted_assets, amount, app_id, category)`.

1. **Split:** `cut = amount × protocol_cut_bps / 10000` → bucket(`category`); phần còn lại định tuyến
   theo app (provider/node — do app/caller chỉ định, không phải việc của Treasury).
2. **Bảo toàn value on-chain (bất biến lõi):** với mọi asset,
   `Σ treasury_out.value(asset) ≥ Σ treasury_in.value(asset) + cut(asset)`.
   Đây là **tổng quát hóa** bất biến `treasury_receives_lamp >= lamp_paid` đã có ở generators.
3. **Gộp theo lô:** nhiều `collect` gộp trong một settlement tx (chống bloat — KHÔNG thu từng
   micro-fee on-chain, bất khả thi vì min-ADA + phí mạng).
4. **Receipt:** ghi `(app_id, asset, amount, cut, epoch)` vào datum/UTxO → audit + tín dụng VP/uy tín.
5. **ĐỊNH GIÁ KHÔNG ở đây.** Bao nhiêu phí (bò ≠ gà) là việc của app (OriLife `animal_fee`); hàm này
   chỉ nhận `amount` đã tính. Quy đổi LAMP↔USD/ADA (oracle) cũng ở phía app/caller.

## 3.1 Điều tiết cung-cầu — split đa người nhận (`distributeToTreasuries`)

Mở rộng §3: thu LAMP từ giao dịch rồi **chia về ≥2 người nhận theo TRỌNG SỐ**, mỗi người nhận là một
**custody Accounting (script, KHÔNG ví PKH)**. MVP hardcode **20% MagicLamp custody / 80% App custody**.

**`SplitParam`** (governance beacon hoặc param):
`{ recipients: List<{ custody_hash: ByteArray, weight_bps: Int }>, min_oil: Int }`.
Bất biến `param_valid`: `≥2 recipient` ∧ mọi `weight_bps ∈ [0,10000]` ∧ `Σ weight_bps == 10000` ∧
`min_oil ≥ 0` ∧ mọi `custody_hash` đúng **28 byte** (script blake2b-224). MVP default:
`[{magiclamp_custody, 2000}, {app_custody, 8000}]`, `min_oil = 360`.

**`split_amounts(total, recipients) -> List<Int>`** (lib thuần `split.ak` ⇄ mirror `split.ts`):
- `part_i = ⌊ total × weight_i / 10000 ⌋` (floor, Int thuần — KHÔNG float).
- **Phần dư** `remainder = total − Σ floor` (∈ `[0, |recipients|)`) **dồn vào recipient ĐẦU (MagicLamp)**
  → protocol KHÔNG thiệt khi chia lẻ.
- **Bất biến cứng `Σ parts == total`** (S1) — value bảo toàn TUYỆT ĐỐI, KHÔNG rơi oil. Chứng minh bằng
  aiken test + property-test offchain dải total rộng (gồm 36 tỉ).

**`min_oil`** (mặc định 360): mỗi settlement ép `total ≥ min_oil` (S3) — chống bụi + buộc gộp lô. Biên
test: 359 reject, 360 pass.

**Orchestrator offchain `distributeToTreasuries(total, splitParam, custodyUtxos[], custodyScripts[], …)`**:
tính `parts` → với MỖI recipient dựng **1 Collect tx riêng** vào custody tương ứng (tái dùng
`buildCollectTx`, `CollectItem{app_id, amount=part_i}`). Mỗi custody recipient là **toàn-thu**
(`cut_bps == 10000` ⇒ `cut == part_i` ⇒ toàn bộ `part_i` vào custody). Cả N custody vào Accounting
(ledger). Ép: số custody UTxO == số recipient; mỗi custody script hash khớp `recipient.custody_hash`
(chặn ví PKH lọt vì custody address dựng từ `validatorToScriptHash` → luôn `Script` credential, và
`custody.ak` còn ép `!is_vk(cust_out.address)`).

### Enforce tỷ lệ — MVP-offchain vs v1.x-onchain-splitter

**MVP: enforce ở orchestrator offchain + receipt on-chain minh bạch.** Mỗi Collect ghi `app_id + amount`
vào ledger custody (per-instance) → đối soát tỷ lệ off-chain bằng tổng các receipt.

**Hard-enforce `Σ outputs đúng weight` onchain = HOÃN sang v1.x** (splitter validator). Lý do (4 trục):

- **Tư duy nguyên bản (bản chất kiến trúc):** MVP dựng **1 Collect tx RIÊNG cho mỗi recipient**. Custody
  validator (`custody.ak` nhánh Collect) chỉ thấy **đúng 1 custody input + 1 custody output của CHÍNH NÓ**
  (C-COL-1, chống double-satisfaction). Nó **không có cái nhìn toàn settlement** — không biết `total`,
  không biết weight, không biết các custody recipient khác. Vì vậy nó **không thể** ép tỷ lệ 20/80 trong
  kiến trúc per-tx hiện tại, dù muốn. Enforce protocol-cut onchain ngay MVP là **bất khả thi rẻ** — không
  phải "chưa làm" mà là "kiến trúc per-tx không cho phép".
- **Tư duy tối ưu (eUTXO/ExUnit):** muốn hard-enforce phải **gộp N recipient vào 1 tx** + thêm **splitter
  validator** đọc `total` (provider input) + `SplitParam` (reference beacon) rồi ép
  `Σ output→custody_i ≥ ⌊total×weight_i/10000⌋` per recipient. Việc này cộng 1 UTxO splitter + 1 reference
  input + fold qua mọi output mỗi tx → đắt ExUnit + tăng contention 1 UTxO. MVP per-tx rẻ hơn nhiều và đủ
  cho giai đoạn bootstrap (caller MagicLamp tự dựng đúng).
- **Định hướng dài hạn (open SDK, LAMP có giá trị):** v1.x splitter là **đường để bên thứ ba không tin
  cậy** cũng buộc phải chia đúng tỷ lệ (khi App tự dựng tx). Giai đoạn MVP caller là chính MagicLamp →
  rủi ro tự-gian-lận tỷ lệ ≈ 0; receipt on-chain đã đủ để cộng đồng đối soát. Ship MVP trước, mở splitter
  khi có integrator ngoài.
- **Lợi ích người dùng + bền vững:** value LUÔN bảo toàn tuyệt đối **mỗi Collect** (`Σout=Σin` per-asset,
  KHÔNG burn) ngay MVP — user không mất oil dù tỷ lệ chia do offchain quyết. Tệ nhất nếu offchain chia sai
  weight: vẫn không mất tiền, chỉ lệch phân bổ giữa 2 custody MagicLamp ↔ App, và receipt on-chain phơi
  ngay sai lệch đó. Rủi ro giới hạn + quan sát được → hoãn an toàn.

**v1.x — splitter validator (follow-up):** 1 tx gộp N output custody; đọc `total` + `SplitParam` beacon;
ép `Σ output→custody_i` đúng `split_amounts(total, recipients)` per recipient (remainder dồn đầu); vẫn
KHÔNG burn (`Σ out = total`). Lib `split.ak` (đã build) tái dùng nguyên — chỉ thêm validator bọc ngoài.

## 4. Bucket release — chi ra (nhóm B)

- Release **chỉ khi** một proposal Governance đã pass (đọc kết quả qua reference input / beacon).
- Ngưỡng theo loại bucket, viết dạng **"≥"** (tham số DAO): vd community ≥2/3, ops ≥1/2, emergency ≥2/3.
- Multi-sig council + **time-lock** giải ngân.
- **Chống double-satisfaction:** đếm theo **payment script hash** (bài học audit C1/C2/M1 Distribution),
  bảo toàn value, không drain.

## 5. Giảm lưu hành — KHÔNG BAO GIỜ BURN (chỉ chuyển trạng thái)

- **LAMP fixed-supply 36 tỷ là tuyệt đối — KHÔNG có nhánh burn, không có `deflation_bps`.** Đã gọi
  fixed-supply thì không được phá tổng cung.
- "Thu về Treasury" = **chuyển trạng thái** một lượng LAMP từ **UTxO lưu hành (circulating)** sang
  **Accounting trong Treasury** — token vẫn tồn tại trong tổng cung, chỉ **rời lưu hành**; governance
  chi lại sau. Đây đúng mô hình **Cardano treasury** (ADA vào treasury không bị đốt, chỉ rời
  circulating).
- Hệ quả cho bất biến §3.2: value LUÔN bảo toàn tuyệt đối (`Σ out = Σ in`, không có nhánh giảm tổng).
  "Giảm lưu hành" là thuộc tính **kế toán** (circulating = tổng − Σ balance các Treasury instance),
  KHÔNG phải thao tác đốt on-chain.

## 6. Asset & ràng buộc

- `accepted_assets`: LAMP, ADA, token doanh nghiệp (đa thuê bao). ADA reserve cho free-ops (PersonDID).
- ⚠️ **Địa chỉ Treasury PHẢI tách khỏi mọi ví tạo output cùng tx** — nếu `treasury == wallet`, bất biến
  `treasury_receives ≥ X` bị thỏa mãn rỗng (bài học Preview generators).
- ADA vào "Treasury" = vào **script Treasury riêng của MagicLamp** (giữ đa-asset), KHÔNG phải kho bạc
  Cardano (Conway donate, ADA-only, không addr).

## 7. Phụ thuộc

- **Governance** (cổng release) — đọc kết quả vote (Voting Power model đã chốt).
- **Oracle** LAMP↔USD/ADA (Score DEX TWAP / Charli3) — cho app định giá, **NGOÀI** Treasury.
- **Caller** của `collectToTreasury`: generators (MAGIC), OriLife, app SDK khác. (LAMP ← MAGIC 1 chiều.)

## 8. Phân rã build

Treasury là **một hệ thống** → build **4 spec FEAT/MATH/TECH/EXEC** cho toàn hệ, chạy song song +
Agent audit đối kháng (như Voting Power). Hai mảng nội dung A và B cùng nằm trong 4 spec đó, KHÔNG
tách 2 nhóm (tránh trùng datum/bất biến):

- **A — Collect** (`collectToTreasury`): split / bảo-toàn-value / batch / receipt + tích hợp caller
  (§2, §3, §6). Là module xuyên suốt: FEAT mô tả hành vi thu, MATH chứng minh bảo-toàn + split,
  TECH validator thu, EXEC tích hợp generators/OriLife.
- **B — Core**: custody + buckets + release + governance-gate + giảm-lưu-hành + đa thuê bao
  (§1, §4, §5, §6).

## 9. Quyết định reconcile 2026-06-05 (interface KHÓA — mọi spec phải khớp)

Sau rà soát đối kháng, ghim cứng. Đồng bộ với Governance CONTRACT §5 (D1–D9).

- **T1 — Release-gate = Model A** (= Gov D3). Treasury KHÔNG tự tính ngưỡng; chỉ kiểm
  `status==Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`. Toàn bộ ngưỡng
  (gồm clamp BFT) do Governance ép trước. → bỏ mọi bất đẳng thức tự-kiểm ngưỡng ở Treasury.
- **T2 — Collect ĐƠN-BUCKET mặc định.** `cut → đúng item.category` (một bucket). `split_table`
  (đa-bucket) CHỈ là tùy chọn instance, KHÔNG phải đường mặc định. MATH sửa: hạ PARTITION-MULTI
  xuống "tùy chọn", dạng chính là `Δ_bucket(category) == cut`. Hết cite chéo ngược TECH↔MATH.
- **T3 — Bất biến sổ↔value là INCREMENTAL.** Mỗi tx chỉ kiểm asset CÓ Δ: `Σ_b Δledger[(b,a)] ==
  Δvalue(a)`; asset không đụng thì value bảo toàn → sổ giữ nguyên (không fold lại toàn sổ mỗi tx).
  Thêm phân tích ExUnit theo K·M (số bucket × số asset) + đặt trần đo-thực trước M2.
- **T4 — Custody: đo throughput trước khi chốt 1 UTxO.** Một UTxO custody là điểm contention tuần
  tự. EXEC phải đo (batch N/tx × tx/block) so tải nhiều thuê bao; nếu nghẽn → **shard-by-asset**
  (mỗi shard 1 UTxO độc lập, bất biến áp per-shard, off-chain cộng tổng cho circulating). Nâng câu
  hỏi treo #3 thành quyết-định-có-số-đo.
- **T5 — MATH §6.1 bỏ tự-kiểm ngưỡng.** Chỉ giữ vị từ boolean `pass(P)` đọc từ Governance (đã clamp,
  khớp §0.2 + T1). Nếu mô tả ngữ nghĩa thì ghi rõ `approval = Σ VP_eff(thuận)` (đã clamp),
  `total = ΣVP-tham-gia GỐC` — cross-ref VotingPower MATH §8B + D1, để không implement nhầm power thô.
