# Treasury — EXEC: Lộ trình triển khai & mốc

**Doctype:** MagicLamp Protocol — Treasury Spec (EXEC)
**Trạng thái:** 🔜 outline triển khai 2026-06-05. Bám [`CONTRACT.md`](./CONTRACT.md) (khung interface đa thuê bao) — KHÔNG mâu thuẫn. EXEC không định nghĩa lại datum/bất biến (việc của TECH/MATH) — chỉ định **thứ tự build, test, deploy, migrate caller, bootstrap, rủi ro, tiêu chí "xong"**.
**Cập nhật:** 2026-06-05

Nguồn chuẩn bắt buộc đọc trước: [`CONTRACT.md`](./CONTRACT.md) (3 cửa tiền, bucket = sổ, bảo-toàn-value, release qua Governance). Spec anh em build song song (mỗi spec có Agent phản biện): **FEAT** (hành vi thu/chi/giảm-lưu-hành), **MATH** (chứng minh bảo-toàn-value + split + không-tạo-không-đốt), **TECH** (validator collect + core + datum/redeemer). Mẫu 4-spec đã chạy ở [`Governance/VotingPower`](../Governance/VotingPower/).

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Đưa Treasury từ **outline** (`SPEC.md` + `CONTRACT.md`) tới **chạy thật trên Preview**, theo đúng cách Distribution đã làm (đã live Preview — xem [`Distribution/scripts/LIVE_DEPLOY_PREVIEW.md`](../Distribution/scripts/LIVE_DEPLOY_PREVIEW.md)). Cụ thể:

1. Một **`treasury_core` validator** (custody + bucket-sổ + release-gate) + một **lớp thu `collectToTreasury`** dùng chung, tái dùng nền `Distribution/onchain/validators/treasury.ak` (đã audit C-TRE/M1).
2. **Migrate 3 generators** (Instant/Vacuum/Schedule) từ "trả LAMP vào một addr câm" sang `collectToTreasury` chung (split cut → bucket + receipt) — KHÔNG phá bất biến `treasury_receives_lamp >= lamp_paid` đã live.
3. **Lấp đúng** "AppEconomics settlement spec" mà OriLife đang chờ: OriLife định giá (`animal_fee`, oracle) → gọi `collectToTreasury(LAMP, fee, app_id="orilife", category)`; phần thưởng app (W/distribute của AppEconomics) chi RA từ bucket qua release-gate.
4. **Bootstrap instance MagicLamp** (governance_ref, accepted_assets, buckets, protocol_cut_bps) trên Preview, đa thuê bao sẵn sàng cho team eco khác (open SDK).

Mục tiêu cuối của cả dự án: **làm LAMP có giá trị**. Treasury phục vụ mục tiêu đó bằng cách (a) tạo **bể giá trị** (phí app chảy về → giảm lưu hành → khan hiếm có kiểm soát), (b) **không bao giờ phá fixed-supply 36 tỷ** (niềm tin tổng cung), (c) mở cho **mọi Cardano team** dùng chung lớp thu (instance riêng).

### 0.2 Cái gì THUỘC EXEC

- Lộ trình build theo mốc **M0…M7** + thứ tự phụ thuộc.
- Chiến lược test: **unit Aiken** (collect + core + release), **property bảo-toàn-value** (Σ_out = Σ_in tuyệt đối; cut split đúng; circulating = tổng − Σ balance), **e2e Preview** (deploy → collect lô → release-gate qua beacon Governance → verify on-chain), bám harness 00→04 của Distribution.
- Kế hoạch **migrate 3 generators** sang `collectToTreasury` (giữ bất biến cũ, không regression).
- Kế hoạch **tích hợp OriLife** (settlement spec mà OriLife đang chờ) + AppEconomics chi thưởng.
- **Bootstrap** instance MagicLamp + đường đa thuê bao.
- Rủi ro vận hành/triển khai + giảm thiểu; tiêu chí "xong" (DoD).

### 0.3 Cái gì KHÔNG thuộc EXEC (thuộc spec khác / repo khác)

| Hạng mục | Thuộc |
|---|---|
| Datum/redeemer Treasury, validator `collect`/`core`, đếm theo payment script hash, chống double-satisfaction | **TECH** |
| Chứng minh bảo-toàn-value tổng quát, split cut, "không tạo/không đốt", circulating accounting | **MATH** |
| Vòng đời thu/chi, định nghĩa bucket, luồng release proposal | **FEAT** |
| **Định giá phí** (bò ≠ gà, `animal_fee`), quy đổi LAMP↔USD/ADA | **APP** (OriLife) + **oracle** (`MAGIC/oracle`) — NGOÀI Treasury ([§3.5 CONTRACT](./CONTRACT.md)) |
| Kết quả vote / ngưỡng VP / BFT clamp (cổng release đọc kết quả này) | **Governance/VotingPower** (đọc qua reference input/beacon) |
| Backend PhoenixKey DID (cho VP) | **NGOÀI repo LAMP** |
| Tính reward W/distribute (app reward) | **MAGIC/AppEconomics** (`offchain/src/math.ts`) — Treasury chỉ giữ + chi pool |

---

## 1. Trạng thái thật hiện tại (bám sự thật, không trí nhớ)

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| `Distribution/treasury.ak` | ✅ **live Preview**, 4 test (happy + double_release + ada_drain + zero_release) | [`treasury.ak`](../Distribution/onchain/validators/treasury.ak) L141–174; commit `1fbd78a4` |
| Harness e2e tuần tự 00→04 | ✅ chạy thật Preview (mint→genesis→beacon→redeem, in tx hash + explorer) | [`Distribution/scripts/04_e2e.ts`](../Distribution/scripts/04_e2e.ts), [`LIVE_DEPLOY_PREVIEW.md`](../Distribution/scripts/LIVE_DEPLOY_PREVIEW.md) |
| 3 generators trả Treasury | ✅ **đã trả Treasury trên Preview** — bất biến `treasury_receives_lamp >= lamp_paid` | [`InstantGen/.../vault.ak`](../../MAGIC/InstantGen/onchain/validators/vault.ak) L173–174, L298–313; VacuumGen/ScheduleGen tương tự |
| AppEconomics W/distribute | ✅ engine reward + test (math.ts) | [`MAGIC/AppEconomics/offchain/src/math.ts`](../../MAGIC/AppEconomics/offchain/src/math.ts) |
| Treasury (collect + core) | 🔜 chỉ `CONTRACT.md` + `SPEC.md` outline | thư mục này |
| Governance release gate | 🔜 CONTRACT VP đã duyệt; chưa có beacon kết quả vote on-chain | [`Governance/VotingPower/CONTRACT.md`](../Governance/VotingPower/CONTRACT.md) |

**Hai sự thật quyết định lộ trình:**

1. **Generators ĐÃ trả Treasury** — nhưng trả vào một `treasury_addr` *câm*: chỉ kiểm `lamp_at_treasury >= lamp_paid` **đếm theo FULL ADDRESS** `o.address == treasury_addr` (gồm stake cred, [`vault.ak` L298–313](../../MAGIC/InstantGen/onchain/validators/vault.ak)). Chưa có split cut, chưa bucket-sổ, chưa receipt, **và output câm KHÔNG mang datum**. ⇒ Migrate KHÔNG đơn thuần đổi addr: custody `Collect` validator yêu cầu output có **inline datum collect**, mà vault câm không build datum. Đường chốt: **adapter off-chain** (TECH §9 b-ii) — generator giữ logic cũ, adapter ráp datum + phát `Collect` (chi tiết §4.1). ⚠️ Bất biến mới **siết chặt hơn** bất biến cũ theo HAI chiều — per-asset thay vì chỉ LAMP, và đếm theo **payment script hash** thay vì full-address — KHÔNG phải quan hệ "tập con" thuần: cách đếm khác nhau (full-addr → script-hash) nên migrate **phải nâng cách đếm**, không chỉ đổi giá trị `treasury_addr`; đếm full-address hiện tại còn hở double-satisfaction qua stake cred (lỗ C1/C2 generators CHƯA sửa). Lưu ý thêm: quan hệ tập con (nếu xét riêng VALUE) cũng **CHỈ đúng cho ràng buộc VALUE** (`Σ out ≥ Σ in + cut`), KHÔNG đúng cho ràng buộc DATUM.

2. **`Distribution/treasury.ak` đã chứng minh khuôn release an toàn** (C-TRE-1 đếm theo script hash; C-VAL-0 bảo toàn tuyệt đối mọi asset; reject double-release + ada-drain). ⇒ `treasury_core` **mở rộng từ đây**: thay "release kích hoạt bởi Redeem hợp lệ" bằng "release kích hoạt bởi proposal Governance pass (đọc beacon)".

---

## 2. Kiến trúc 2 validator (EXEC chỉ nêu ranh giới; chi tiết ở TECH)

```
            collectToTreasury (lớp THU)                 release (lớp CHI)
  caller ───────────────►┌──────────────────┐◄──────────── Governance beacon
 (generators/             │  treasury_core   │             (reference input:
  OriLife/SDK)            │  custody UTxO     │              proposal pass?)
  amount đã định giá      │  datum = buckets  │
  ────► split cut ───────►│  (sổ kế toán)     │──► payout ──► ví đích (đã vote duyệt)
        → bucket(category)│  + receipts       │
        receipt(app_id…)  └──────────────────┘
```

- **`treasury_core`** (validator spend): giữ value đa-asset trong **1 custody UTxO** (hoặc shard); datum mang **buckets[] = sổ** (CONTRACT §1) + receipts. Hai redeemer chính: `Collect` (thu, tăng value + cập nhật sổ) và `Release` (chi, giảm value theo proposal). **Emergency bucket = UTxO physical riêng** (CONTRACT §1) → isolation, không nằm chung custody thường.
- **`collectToTreasury`** = **đường THU** (CONTRACT §3): không nhất thiết validator riêng — là **mẫu tx + redeemer `Collect`** trên `treasury_core` (caller bên ngoài đẩy LAMP vào, validator kiểm split + bảo-toàn + receipt). Đặt là lớp logic để đa thuê bao tái dùng.

> Lý do tách 2 đường trong 1 validator thay vì 2 validator: **tối ưu eUTxO** — custody là một state machine; thu/chi là 2 transition của cùng UTxO. Hai validator ⇒ phải chuyển value chéo ⇒ thêm UTxO + ExUnit. (Quyết định first-principles, trục "tư duy tối ưu" + "ít UTXO".) Chi tiết datum/redeemer ở TECH.

---

## 3. Lộ trình build theo mốc (M0…M7)

| Mốc | Nội dung | Phụ thuộc | DoD (bằng chứng) |
|---|---|---|---|
| **M0** | Khởi tạo skeleton `Treasury/onchain` (aiken project) + `offchain` (tái dùng `package.json`/lucid của Distribution). Copy `Distribution/treasury.ak` làm nền `treasury_core.ak`. | — | `aiken build` xanh; import được `util` (count_inputs_at_script…). |
| **M1** | **Datum + bucket sổ** (TECH): `TreasuryDatum { buckets: List<Bucket>, protocol_cut_bps, governance_ref, accepted_assets }`; `Bucket { id, balance }`. ⚠️ **KHÔNG có `release_threshold_num/den` trong `Bucket`** — Treasury KHÔNG tự kiểm ngưỡng (T1 = Gov D3). Toàn bộ ngưỡng (gồm clamp BFT) do Governance ép TRƯỚC; Treasury chỉ kiểm `status==Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`. Unit Aiken: encode/decode + invariant `Σ bucket.balance ≤ custody.value(LAMP)`. | M0 | test datum round-trip + invariant pass. |
| **M2** | **`Collect` redeemer** (lớp thu): kiểm `cut = amount × protocol_cut_bps / 10000` cộng đúng vào `bucket(category)`; bảo-toàn-value tổng quát (CONTRACT §3.2); receipt `(app_id, asset, amount, cut, epoch)` ghi vào datum. Đếm theo **payment script hash** (chống double-satisfaction). **Mặc định 1-custody:** `count_inputs_at_script == 1` ∧ `count_outputs_at_script == 1` (kế thừa C-TRE-1, MATH NO-DRAIN). | M1, **1-custody bootstrap chốt; throughput đo ở M6** (T4 — xem §3.1) | unit: happy + cut sai + receipt thiếu + double-satisfaction → reject. |
| **M3** | **`Release` redeemer** (lớp chi, T1 = Gov D3): release **chỉ khi** beacon Governance (reference input) cho biết proposal `status==Executed` + Proposal NFT + **khớp `spend_spec_hash`** (đích/asset/amount đã duyệt — xem §6.1) + **`execute_after_epoch` đã tới** (time-lock). Treasury KHÔNG tự kiểm ngưỡng bucket — Governance đã ép ngưỡng (gồm clamp BFT) TRƯỚC khi đặt `status==Executed`. Tái dùng C-TRE-1 (đếm script hash, 1-custody) + C-VAL-0 (bảo toàn asset khác). Multi-sig council. | M2, **Governance beacon CÓ `spend_spec_hash` + `execute_after_epoch`** (blocker cứng — xem §6.1, D2) | unit: release-no-proposal → reject; **release khi proposal chưa `Executed` → reject**; **release-sai-đích (spend_spec_hash lệch) → reject**; **release trước `execute_after_epoch` → reject**; release-đúng → pass; ada-drain → reject (kế thừa M1 test). |
| **M4** | **Property bảo-toàn-value** (MATH-driven test): sinh ngẫu nhiên N collect + M release → assert `Σ value_out(asset) = Σ value_in(asset)` tuyệt đối ∀ asset; `circulating = tổng − Σ bucket.balance`; **không có nhánh nào giảm tổng cung** (CONTRACT §5). | M2, M3 | property test (≥ vài trăm case) xanh; có log Σ_in == Σ_out. |
| **M5** | **Offchain SDK**: `buildCollectTx`, `buildReleaseTx`, `decodeTreasuryDatum`, `reapplyValidators`. Tái dùng `config.ts`/`awaitTx`/`explorerTx` của Distribution. | M1–M4 | vitest offchain: datum decode khớp Aiken; tx build hợp lệ (dry-run). |
| **M6** | **E2E Preview** (harness 00→04 kiểu Distribution): `01_deploy` (instance MagicLamp) → `02_collect_batch` (gộp lô nhiều collect) → `03_post_governance_beacon` (giả proposal pass) → `04_release` → verify on-chain (in tx hash + explorer). | M5 | record `LIVE_DEPLOY_PREVIEW.md` riêng cho Treasury với tx hash thật. |
| **M7** | **Migrate 3 generators** sang `collectToTreasury` chung + **tích hợp OriLife** + **bootstrap đa thuê bao**. | M6 | xem §4, §5; generators e2e Preview lại với treasury_core (không regression); OriLife settlement e2e. |

> Thứ tự M2 trước M3 có chủ đích: **thu là đường nóng, độc lập Governance**; chi phụ thuộc beacon (blocker ngoài). Build + test được toàn bộ đường thu (và migrate generators) **trước khi** Governance beacon sẵn sàng → không bị blocker chặn tiến độ.

### 3.1 Ràng buộc 1-custody vs shard — ĐO THROUGHPUT TRƯỚC khi chốt (T4)

**M2/M3 mặc định 1-custody:** custody là **đúng 1 UTxO** mỗi tx — bất biến NO-DRAIN dạng `count_inputs_at_script == 1` ∧ `count_outputs_at_script == 1` (MATH §6.3, TECH §10, kế thừa code [`treasury.ak` L36–37](../Distribution/onchain/validators/treasury.ak) `count_inputs_at_script == 1`). Đây là lõi chống double-satisfaction.

⚠️ **T4 (CONTRACT §9): một UTxO custody là ĐIỂM CONTENTION TUẦN TỰ** — mọi collect/release tranh spend cùng một UTxO, throughput trần = 1 tx/block cho custody đó. Vì vậy việc chốt 1-custody KHÔNG phải mặc định "cho đơn giản" rồi quên — **EXEC PHẢI ĐO** trước khi khoá: `batch N/tx × tx/block` so với tải nhiều thuê bao thực tế (M6 Preview cho số đo thật). Nâng câu hỏi treo #1 thành **quyết-định-có-số-đo**, không phải chốt cảm tính.

⚠️ **Đường mở rộng khi đo thấy nghẽn = shard-by-asset** (T4): mỗi shard giữ **1 asset**, là **1 UTxO độc lập**; bất biến NO-DRAIN + bảo-toàn-value áp **per-shard** (`count == 1` vẫn đúng TRONG mỗi shard — không phải viết lại thành "K cặp"); off-chain **cộng tổng các shard** cho `circulating` accounting. Shard-by-asset giữ nguyên lõi an toàn 1-cặp/shard (khác cách shard tuỳ-ý từng làm vỡ `count==1`) → ít tốn kép hơn. Vẫn là **mốc riêng M-shard**, không gài vào M2/M3 đang code `==1` cho custody đơn.

**Hệ quả lộ trình:** không treo song song với code. Khuyến nghị: chốt **1-custody** để bootstrap (đơn giản nhất, đúng trục "ít UTXO"); **đo throughput ở M6 Preview**; chỉ thêm **M-shard (shard-by-asset)** khi số đo cho thấy contention thật. Nếu đổi sang shard-by-asset, lõi an toàn 1-cặp/shard giữ nguyên → migration nhẹ.

---

## 4. Migrate 3 generators (Instant / Vacuum / Schedule)

**Hiện trạng:** mỗi vault validator có param `treasury_addr` và kiểm `treasury_receives_lamp(outputs, treasury_addr, lamp_policy, lamp_paid) ⇒ lamp_at_treasury >= lamp_paid` ([`vault.ak` L298–313](../../MAGIC/InstantGen/onchain/validators/vault.ak)). Treasury hiện là **addr câm** (ví trên Preview).

**Đích:** `treasury_addr` trỏ tới **`treasury_core` script address** (instance MagicLamp), và output vào đó mang **datum hợp lệ** (sổ bucket cập nhật + receipt). Generator KHÔNG cần biết bucket logic — nó chỉ cần đẩy LAMP + ghi `app_id`/`category` vào output datum theo schema collect.

**Chiến lược (giữ bất biến cũ, không regression):**

| Bước | Hành động | Vì sao an toàn |
|---|---|---|
| 4.1 | **Đổi `treasury_addr` là CẦN nhưng KHÔNG ĐỦ.** Đổi *giá trị* `treasury_addr` (param) từ addr câm → `treasury_core` address là bước đầu, **nhưng generator hiện không build datum collect** → output câm vào custody sẽ bị `Collect` validator REJECT. Chọn 1 trong 2 đường của TECH §9, **chốt b-ii**: <br>**(a)** nâng cấp generator để tự build inline datum collect (sửa offchain generator, gọi `Collect`); <br>**(b-ii) [KHUYẾN NGHỊ]** **adapter off-chain**: generator vẫn trả vào addr trung gian (giữ logic cũ nguyên), một bước gộp off-chain đọc các output đó rồi phát một tx `Collect` vào custody mang datum hợp lệ. | ⚠️ **Quan hệ tập con CHỈ đúng cho RÀNG BUỘC VALUE** (`Σ out ≥ Σ in + cut`), KHÔNG đúng cho **RÀNG BUỘC DATUM**: custody `Collect` validator YÊU CẦU output mang inline datum (sổ bucket cập nhật + receipt), trong khi vault hiện kiểm `o.address == treasury_addr` với "NoDatum/InlineDatum **tùy ý**" (TECH §9b, §11) → vault câm KHÔNG sinh datum. Bỏ khẳng định "tập con ⇒ tự pass". ⚠️ Thêm: cách đếm cũng đổi (**full-address → payment script hash**) → migrate phải **nâng cách đếm**, không chỉ đổi giá trị `treasury_addr`; full-address còn hở double-satisfaction qua stake cred (FEAT §2.2). |
| 4.2 | Thực thi đường **b-ii** (TECH §9): adapter off-chain build tx `Collect` mang **inline datum collect** (`app_id = "instantgen"/"vacuumgen"/"schedulegen"`, `category`, cập nhật bucket sổ + receipt) + **spend custody UTxO của treasury_core** (redeemer `Collect`) để nó validate split. Lợi: KHÔNG đụng vault validator logic (zero regression onchain generator), gộp lô tự nhiên (4.4). | treasury_core kiểm split + bảo-toàn + datum ở phía nó; vault giữ `>= lamp_paid` ở phía nó. Adapter ráp datum mà vault không tự tạo được. |
| 4.3 | ⚠️ **Địa chỉ treasury_core PHẢI tách khỏi ví tạo output** (CONTRACT §6, bài học Preview): nếu `treasury_core == ví build tx` thì bất biến thỏa mãn rỗng. Verify `treasury_addr` là **script address**, không phải ví. | Đã là bài học cay đắng generators; CONTRACT §6 đóng. |
| 4.4 | **Gộp lô** (CONTRACT §3.3): một settlement tx có thể gộp nhiều generator-collect (nhiều micro-fee) cùng update 1 custody UTxO. Không thu từng micro-fee on-chain (min-ADA + phí mạng). | Anti-bloat; đếm theo script hash để 1 custody UTxO/tx (kế thừa C-TRE-1). |
| 4.5 | E2E Preview lại từng generator với treasury_core thật; verify on-chain LAMP về đúng custody + sổ bucket tăng + receipt ghi. | Bằng chứng không regression (DoD M7). |

**Test không regression:** giữ nguyên test suite generators (InstantGen/VacuumGen/ScheduleGen) — chúng kiểm `treasury_receives_lamp`. Thêm test *integration* mới: vault tx + treasury_core Collect cùng tx → cả hai validator pass; cố tình cut sai/treasury==wallet → reject.

---

## 5. Tích hợp OriLife (lấp "AppEconomics settlement spec" đang chờ)

OriLife đang **chờ một spec settlement**: làm sao phí thu từ app (vd `animal_fee` 7% — bò ≠ gà) chảy về Treasury và phần thưởng app chảy ra. `collectToTreasury` chính là spec đó. Ranh giới (đúng CONTRACT §3.5):

```
  OriLife (APP)                          Treasury (lớp này)            AppEconomics (MAGIC)
  ─────────────                          ─────────────────            ────────────────────
  định giá animal_fee  ──fee(LAMP)──►  collectToTreasury             computeW / distribute
  (bò≠gà, oracle quy đổi   amount đã    (split cut → bucket           (tính reward pool theo W)
   LAMP↔USD/ADA)           tính sẵn)     + receipt app_id="orilife")        │
                                              │  bucket balance ↑            │
                                              ▼                             ▼
                                       release (qua Governance) ◄──── pool reward chi ra
                                       theo distribute() output       (ví app/provider)
```

| Bước | Ai làm | Ranh giới |
|---|---|---|
| 5.1 | OriLife tính `animal_fee` (định giá theo loài) + quy đổi qua **oracle** (`MAGIC/oracle`). | **APP + oracle**, NGOÀI Treasury (CONTRACT §3.5, §7). Treasury chỉ nhận `amount`. |
| 5.2 | OriLife gọi `collectToTreasury(LAMP, fee, app_id="orilife", category)`. | Lớp thu (M2). Split cut → bucket; receipt ghi `app_id="orilife"`. |
| 5.3 | AppEconomics `computeW`/`distribute` ([`math.ts`](../../MAGIC/AppEconomics/offchain/src/math.ts)) tính **pool reward** từ W mỗi app (dùng receipt làm input `V`/util). | **MAGIC/AppEconomics**. Treasury KHÔNG tính reward — chỉ **giữ** pool + **chi** theo output của `distribute()`. |
| 5.4 | Chi reward: `Release` redeemer (M3) chi từ bucket reward theo `distribute()` output, qua cổng Governance (proposal "phân bổ reward epoch e" pass). | Lớp chi (M3). Cap 30%/app (`MAX_SINGLE_APP_REWARD_BPS`) đã ở AppEconomics — Treasury chỉ chấp hành số liệu. |

**DoD tích hợp OriLife:** e2e Preview — mint test-LAMP cho ví "OriLife user" → `collectToTreasury(fee)` → custody tăng + receipt `orilife` → (giả proposal pass) → `Release` chi reward theo `distribute()` → verify on-chain. Đây là **bằng chứng settlement spec mà OriLife chờ đã đóng**.

> Quyết định first-principles (trục "lợi ích người dùng + bền vững"): **định giá ở app, không ở Treasury.** Nếu nhét `animal_fee` vào Treasury thì mỗi loài/mỗi app phải sửa validator core → không đa thuê bao được, không open SDK được. Treasury chỉ là *cổng kế toán trung lập*; định giá là *chính sách app*.

---

## 6. Phụ thuộc Governance (release) + oracle (app-side)

### 6.1 Governance beacon (cổng release — blocker cho M3, KHÔNG cho M2)

`Release` đọc kết quả vote qua **reference input / beacon** ([CONTRACT §4](./CONTRACT.md); mẫu beacon đã chạy ở [`Distribution/onchain/validators/beacon_nft.ak`](../Distribution/onchain/validators/beacon_nft.ak)). Theo **T1 = Gov D3 (Model A)**: Treasury KHÔNG tự kiểm ngưỡng; chỉ kiểm `status==Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`. Cần từ Governance (3 field HARD BLOCKER, **Gov D2**):

- Một **UTxO beacon** mang ProposalDatum với `status==Executed` (Governance đã ép TOÀN BỘ ngưỡng — gồm clamp BFT `VP_eff` + sàn cứng `|S|≥F` — TRƯỚC khi đặt trạng thái này) — đọc-chỉ bằng reference input (không spend).
- ⚠️ **BLOCKER CỨNG M3 — `spend_spec_hash`** (Gov D2; TECH §7 C-REL-3): hash canonical của **danh sách chi đã duyệt** `(bucket, asset, amount, to)`. `Release` so khớp output thực tế với `spend_spec_hash` → nếu thiếu, **Release không biết proposal duyệt chi cho ai/bao nhiêu → LỖ HỔNG CHI SAI** (release đúng tổng nhưng sai đích vẫn pass). Phải **chốt với Governance TRƯỚC khi code M3**.
- ⚠️ **BLOCKER CỨNG M3 — `execute_after_epoch`** (Gov D2): mốc time-lock. `Release` reject nếu epoch hiện tại **chưa tới** `execute_after_epoch`. Đây là cơ chế time-lock duy nhất (không còn ngưỡng/threshold ở Treasury). Phải có trong ProposalDatum cùng `spend_spec_hash`.
- `released_cumulative` (Gov D2): chống chi vượt qua nhiều tx (vesting/chi nhiều đợt). Bắt buộc nếu hỗ trợ chi nhiều đợt; tham số mở phần nhịp chi — bàn FEAT/Governance.
- **KHÔNG còn ngưỡng bucket "≥" ở Treasury** (T1): bất đẳng thức ngưỡng (community ≥2/3, ops ≥1/2…) **do Governance ép** khi tính `status==Executed`, KHÔNG tự kiểm ở Release. Treasury **chấp hành** trạng thái Executed, không tự tính VP/ngưỡng/BFT clamp.

**Giảm rủi ro blocker:** M3 dùng **beacon giả lập** (committee 1-of-1 ký, như Distribution genesis) để test release-gate *cơ chế* trên Preview trước khi Governance beacon thật sẵn sàng. ⚠️ Beacon giả lập **PHẢI mô phỏng đủ 3 field Gov D2**: `status==Executed` + `spend_spec_hash` (commit danh sách chi rồi cho `Release` so khớp) + `execute_after_epoch` (test time-lock reject trước mốc) — nếu thiếu, test release-gate là **rỗng**: release đúng số nhưng sai đích/sai thời điểm vẫn pass, C-REL-3 không được kiểm. Khi Governance live → wire reference input thật (đổi param `governance_ref`), không sửa validator core.

### 6.2 Oracle (app-side, NGOÀI Treasury)

Quy đổi LAMP↔USD/ADA cho **định giá app** dùng `MAGIC/oracle` (Score DEX TWAP / Charli3 — [cần verify nguồn TWAP cuối]). Treasury **không gọi oracle**; nó nhận `amount` đã quy đổi (CONTRACT §7). Ghi rõ để không ai nhét oracle vào validator core (sẽ phá tính trung lập + đa thuê bao).

---

## 7. Bootstrap instance MagicLamp + đa thuê bao

### 7.1 Instance MagicLamp (instance đầu tiên)

Param khởi tạo (CONTRACT §1): `(governance_ref, accepted_assets[], buckets[], protocol_cut_bps)`.

| Param | Giá trị khởi tạo | Ghi chú |
|---|---|---|
| `accepted_assets` | `[LAMP, ADA]` (mở rộng sau) | ADA reserve cho free-ops (PersonDID) — CONTRACT §6 |
| `buckets` | **danh mục minh họa, DAO chốt** — vd `[community, ops, emergency]` (+ reward nếu tách, xem câu treo #3) | ⚠️ **Danh mục bucket là tham số mở (DAO định) — KHÔNG cứng.** Các spec hiện liệt kê KHÁC nhau (FEAT/MATH: community/ops/emergency; TECH ví dụ `bucket_id` 0=community/1=ops/2=grants/3=reserve) → đừng đọc reward/grants/reserve như đã quyết. Khi minh họa, **đối chiếu `bucket_id` của TECH** để ví dụ khớp. Ngưỡng minh họa: community ≥2/3, ops ≥1/2, emergency ≥2/3 (reconcile Foundation-Bootstrap §7: 3 quỹ cứng → nay buckets cấu hình) |
| `protocol_cut_bps` | **tham số mở (DAO định)** | KHÔNG bịa số. Khởi tạo bằng giá trị an toàn thấp, DAO chỉnh. |
| `governance_ref` | ban đầu **committee bootstrap** (multi-sig council), chuyển dần sang beacon DAO | giống Distribution committee 1-of-1 self-test → M-of-N thật |
| emergency | **UTxO physical riêng** (isolation) | CONTRACT §1 |

**Đường bootstrap → DAO:** y mẫu VotingPower EXEC — khởi tạo bằng hội đồng bảo trợ (committee multi-sig), chuyển `governance_ref` sang beacon DAO khi đủ sàn BFT. Đổi `governance_ref` ⇒ script address đổi ⇒ deploy instance mới (state cũ không lẫn — bài học Distribution LIVE_DEPLOY §"chuyển committee").

### 7.2 Đa thuê bao (open SDK)

- Team eco khác = **instance khác** (param khác) — cùng validator code, khác param hash. Họ tự cấu hình `accepted_assets`/`buckets`/`protocol_cut_bps`/`governance_ref` của họ.
- SDK offchain (`buildCollectTx`/`buildReleaseTx`) nhận instance config → không hard-code MagicLamp.
- Đây là hiện thực hóa định hướng "open SDK cho mọi Cardano team" ở tầng kho bạc.

---

## 8. Chiến lược test (có bằng chứng — không chỉ structure)

Bám nguyên tắc "verify behavior, không chỉ structure". Mỗi mốc phải có output test thật.

| Tầng | Công cụ | Kiểm gì | Bằng chứng |
|---|---|---|---|
| Unit onchain | `aiken check` | collect happy/sai-cut/receipt-thiếu/double-satisfaction; release no-proposal/dưới-ngưỡng/đúng/ada-drain | mock `Transaction` (kiểu `treasury.ak` L116–174); output `aiken check` xanh |
| Property bảo-toàn-value | aiken property test / generator | ∀ chuỗi (collect×N, release×M): `Σ out(asset) = Σ in(asset)` tuyệt đối; `Σ bucket = custody LAMP`; `circulating = tổng − Σ balance`; KHÔNG nhánh giảm tổng (CONTRACT §5) | log Σ_in == Σ_out cho ≥ vài trăm case |
| Datum parity | vitest offchain | decode TS ↔ Aiken khớp byte (P8 determinism) | test round-trip |
| Migrate generators | aiken + integration | vault tx + treasury_core Collect cùng tx → cả hai pass; cut sai/treasury==wallet → reject | output test 3 generators không regression |
| E2E Preview | harness 00→04 (lucid) | deploy instance → collect lô → beacon → release → verify on-chain | tx hash + explorer link trong `LIVE_DEPLOY_PREVIEW.md` Treasury |
| OriLife settlement | e2e Preview | collect(fee, app_id=orilife) → release reward theo distribute() | tx hash thật |

**Bất biến trọng tâm phải có test riêng** (đây là xương sống). EXEC chỉ nêu **TEST gì** + **trỏ mã bất biến** — **không định nghĩa lại công thức** (§0.3). Nguồn-chân-lý duy nhất ở MATH; nếu MATH sửa mã bất biến, test ở đây bám theo mã, không lệch:
- **TOTAL-CONSERVE** (MATH §7): test `Σ value_out = Σ value_in` **tuyệt đối** ∀ asset — KHÔNG redeemer nào giảm tổng cung (đối lập "burn"; CONTRACT §5).
- **BIV-1** (MATH §7): test bảo toàn per-asset khi release LAMP không drain ADA (kế thừa `treasury_ada_drain` test [L160–166](../Distribution/onchain/validators/treasury.ak)).
- **NO-DRAIN** (MATH §6.3 / §7): test reject double-satisfaction — **mặc định 1-custody** (`count_inputs_at_script == 1`, §3.1); nếu chốt shard, mã NO-DRAIN đổi thành "K cặp" (MATH §9 #5) → test bám mã mới. Kế thừa `treasury_double_release` [L149–158](../Distribution/onchain/validators/treasury.ak).

---

## 9. Rủi ro vận hành & giảm thiểu

| Rủi ro | Hệ quả | Giảm thiểu |
|---|---|---|
| `treasury_addr` trỏ về ví build tx | bất biến thỏa mãn rỗng (drain) | M7 4.3: assert là script address; CI check; bài học Preview generators (CONTRACT §6) |
| Bucket bloat (mỗi bucket 1 UTxO) | min-ADA + phí leo, kho bạc kẹt | bucket = **sổ trong datum** (CONTRACT §1); 1 custody UTxO (+ shard nếu cần) |
| Thu từng micro-fee on-chain | bất khả thi (min-ADA > fee) | **gộp lô** (CONTRACT §3.3); micro-fee tích ở app, settle theo lô |
| Governance beacon chưa sẵn sàng | M3 release bị chặn | beacon giả lập committee để test cơ chế; wire thật sau (§6.1) |
| Migrate generator: output câm thiếu datum → `Collect` reject | tx fail, settlement kẹt | đường adapter off-chain b-ii (§4.1) ráp datum; KHÔNG đụng vault logic; giữ test suite generators (§4) |
| Emergency drain qua bucket thường | mất isolation | emergency = **UTxO physical riêng** (CONTRACT §1) |
| Datum tăng không giới hạn (receipts) | UTxO vượt size | giới hạn receipts/UTxO; gộp/archive theo epoch (chi tiết TECH) — **tham số mở** |

---

## 10. Tiêu chí "xong" (Definition of Done)

- **TECH:** validator `treasury_core` (Collect + Release) compile + `aiken check` xanh; đếm theo payment script hash; datum bucket sổ + receipt; emergency isolation.
- **MATH:** chứng minh `Σ out = Σ in` tuyệt đối ∀ asset (không nhánh giảm tổng); split cut đúng; `circulating = tổng − Σ balance` là hệ quả; property test xanh.
- **FEAT:** vòng đời thu (collect/batch/receipt) + chi (release qua Governance) + giảm-lưu-hành (accounting, không burn) mô tả khớp validator.
- **EXEC (file này):** harness 00→04 chạy thật Preview (record `LIVE_DEPLOY_PREVIEW.md` Treasury); 3 generators migrate không regression (e2e Preview); OriLife settlement e2e đóng (bằng chứng spec OriLife chờ); instance MagicLamp bootstrap + 1 instance thuê bao thử nghiệm.

---

## 11. Tham số mở (DAO định)

- `protocol_cut_bps` (tỷ lệ cut protocol khi collect).
- ⚠️ **Ngưỡng release mỗi bucket KHÔNG còn ở Treasury** (T1 = Gov D3): ngưỡng "≥" (community ≥2/3, ops ≥1/2…) **do Governance ép** khi đặt `status==Executed`; Treasury chỉ chấp hành. Đây là tham số mở **của Governance**, không phải Treasury.
- `BFT_FLOOR` cho release trọng yếu (đọc từ Governance; mặc định 21 — [VotingPower CONTRACT §2.5](../Governance/VotingPower/CONTRACT.md)). Governance ép, Treasury không tự tính.
- Cửa sổ gộp lô collect (bao nhiêu micro-fee/settlement tx).
- Ngưỡng bucket-shard (khi nào tách custody thành nhiều UTxO chống contention).
- Giới hạn receipts/UTxO + chính sách archive theo epoch.
- Danh sách `accepted_assets` mở rộng (token doanh nghiệp đa thuê bao).

KHÔNG bịa số cuối ở EXEC — các spec dưới + DAO chốt.

## 12. Phụ thuộc

| Phụ thuộc | Loại | Trạng thái |
|---|---|---|
| `Distribution/onchain/validators/treasury.ak` + `util` | tái dùng nền (copy → mở rộng) | ✅ live Preview |
| Harness 00→04 + `config.ts` Distribution | tái dùng | ✅ chạy thật |
| Governance beacon (kết quả vote, ngưỡng ≥, BFT clamp) | cổng release (blocker M3, không blocker M2) | 🔜 CONTRACT duyệt, beacon chưa có → dùng giả lập |
| **Governance ProposalDatum có `spend_spec_hash` + `execute_after_epoch`** (+ `released_cumulative` nếu vesting) — Gov D2 | **blocker CỨNG M3** — chống chi-sai-đích + time-lock (TECH C-REL-3, §6.1; T1 Model A) | 🔜 **phải chốt với Governance TRƯỚC khi code M3**; beacon giả lập M3 cũng phải mô phỏng cả 3 field |
| `MAGIC/AppEconomics` (W/distribute) | nguồn số reward (Treasury chỉ chi) | ✅ engine + test |
| `MAGIC/oracle` (LAMP↔USD/ADA) | app-side định giá, NGOÀI Treasury | ✅ có code; Treasury không gọi |
| OriLife (`animal_fee` định giá) | caller collect (app) | chờ settlement spec này |
| 3 generators (Instant/Vacuum/Schedule) | caller collect (migrate) | ✅ đã trả Treasury câm trên Preview |
| PhoenixKey DID (cho VP → release) | gián tiếp qua Governance | NGOÀI repo LAMP |

## 13. Câu hỏi còn treo (cần anh/DAO chốt)

1. **Custody một UTxO hay shard — quyết-định-có-số-đo** (T4, CONTRACT §9). Không còn câu hỏi mở cảm tính: **chốt 1-custody bootstrap**, **đo throughput ở M6 Preview** (`batch N/tx × tx/block` so tải đa thuê bao); chỉ thêm **M-shard = shard-by-asset** khi số đo cho thấy contention thật. Shard-by-asset giữ lõi an toàn 1-cặp/shard (`count==1` per-shard) → migration nhẹ, không phải viết lại NO-DRAIN. Chi tiết §3.1.
2. **`protocol_cut_bps` khởi tạo bao nhiêu?** Tham số mở — cần anh/DAO cho giá trị khởi tạo an toàn để bootstrap (em không bịa).
3. **Reward bucket nằm trong Treasury core hay tách instance?** Reward (AppEconomics distribute) có nhịp chi khác community/ops (theo epoch, tự động hơn). Có nên tách physical như emergency? — đề xuất bàn ở FEAT.
4. **Nguồn oracle TWAP cuối** (Score DEX TWAP vs Charli3) — [cần verify], thuộc app-side nhưng ảnh hưởng định giá OriLife.
5. **Gộp lô collect — ai là "settler"?** Generator tự settle từng tx, hay có một relayer gộp nhiều micro-fee? Ảnh hưởng anti-bloat + ai trả phí mạng. Đề xuất bàn ở FEAT/TECH.

---

## 14. Phản hồi audit (truy vết) — 2026-06-05

Vòng audit đối kháng. EXEC chỉ tự sửa nội dung EXEC; các điểm cần MATH/TECH sửa được **báo** ở đây (EXEC không sửa file khác — ranh giới spec).

| # | Mức | Nội dung | Xử lý ở EXEC | Cần báo MATH/TECH |
|---|---|---|---|---|
| 1 | major | Mâu thuẫn bất biến double-satisfaction (`count==1`) vs shard treo song song với code | ✅ Thêm §3.1 (1-custody mặc định; shard = đổi bất biến an toàn, mốc M-shard riêng); M2/M3 ghi `count==1`; câu treo #1 chốt-trước-M2 | — (MATH §9 #5 đã nêu; EXEC nay phản ánh phụ thuộc vào M2/M3) |
| 2 | major | §4.1 sai "tập con ⇒ tự pass"; thực ra custody cần datum, vault câm không build | ✅ Sửa §4.1 (đổi addr CẦN nhưng KHÔNG ĐỦ; chốt đường b-ii adapter off-chain); §1 điểm 1; rủi ro §9 | — |
| 3 | major | §6.1/§12 bỏ sót `spend_spec_hash` là blocker M3 (chống chi-sai-đích, TECH C-REL-3) | ✅ Thêm vào §6.1 (blocker cứng + beacon giả lập phải mô phỏng) + bảng §12 + DoD test M3 release-sai-đích→reject | — |
| 4 | minor | Link sai: 'CIP-55' cho min-ADA | Oracle §6.2 đã có [cần verify] (giữ) | **Báo MATH §4.1 + TECH §3:** bỏ 'CIP-55' cho min-ADA → thay bằng protocol param **`coinsPerUTxOByte`** (Cardano protocol parameters, ledger Babbage). Score DEX TWAP cần link thật hoặc giữ [cần verify]. |
| 5 | minor | §8 lặp công thức bất biến (trôi dạt khi MATH sửa) | ✅ §8 nay TRỎ mã MATH (TOTAL-CONSERVE/BIV-1/NO-DRAIN) thay vì lặp công thức | — |
| 6 | minor | Danh mục bucket khác nhau giữa 3 spec (reward/grants/reserve/emergency) | ✅ §7.1 ghi 'danh mục minh họa, DAO chốt' + đối chiếu `bucket_id` TECH | (khuyến nghị các spec không liệt kê danh sách cứng khác nhau) |
| 7 | nit | EXEC dùng đúng tên `count_inputs_at_script` (verify util.ak L59) | ✅ EXEC giữ nguyên (tên đúng) | **Báo MATH §6.3:** sửa `count_inputs_at_payment_script_hash` → `count_inputs_at_script` (tên thật trong [`util.ak` L59](../Distribution/onchain/lib/magiclamp/lampdist/util.ak)) để khớp code. |

---

## 15. Phản hồi reconcile 2026-06-05

Áp các quyết định KHÓA của CONTRACT (Treasury §9 T1–T5 + Governance §5 D2) vào EXEC. Chỉ đụng mục liên quan; phần còn lại giữ nguyên.

| Áp | Quyết định cite | Đã sửa gì ở EXEC |
|---|---|---|
| **M1 datum bỏ ngưỡng** | **T1** (Treasury CONTRACT §9 = Gov **D3** Model A) | §3 M1: `Bucket { id, balance }` — bỏ `release_threshold_num/den`. Treasury KHÔNG tự kiểm ngưỡng; chỉ kiểm `status==Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`. |
| **M3 DoD đổi điều kiện reject** | **T1** (= Gov **D3**) | §3 M3: bỏ "release-dưới-ngưỡng → reject"; thay bằng **"release khi proposal chưa `Executed` → reject"** + **"release trước `execute_after_epoch` → reject"**. Treasury chấp hành trạng thái Executed, Governance đã ép ngưỡng + clamp BFT trước. |
| **Custody đo throughput trước** | **T4** (Treasury CONTRACT §9) | §3.1 + §13 #1: một UTxO custody là điểm contention tuần tự → **EXEC phải đo** (`batch N/tx × tx/block`) ở M6 Preview trước khi khoá. Câu treo #1 nâng thành **quyết-định-có-số-đo**. |
| **shard-by-asset = đường mở rộng** | **T4** | §3.1: đường mở rộng khi nghẽn = **shard-by-asset** (mỗi shard 1 asset = 1 UTxO độc lập; NO-DRAIN per-shard, `count==1` vẫn đúng trong shard; off-chain cộng tổng cho circulating). Giữ lõi an toàn 1-cặp/shard → migration nhẹ, KHÔNG viết lại NO-DRAIN thành "K cặp". |
| **Thêm `execute_after_epoch` + `spend_spec_hash`** | **D2** (Gov CONTRACT §5) | §6.1 + §12: `Release` đọc từ ProposalDatum cả `spend_spec_hash` (chống chi-sai-đích) **và** `execute_after_epoch` (time-lock) — 2 blocker cứng M3. `released_cumulative` nếu vesting. Beacon giả lập M3 phải mô phỏng cả 3 field. |
| Dọn tham số mở | T1 | §11: ghi rõ ngưỡng release bucket + `BFT_FLOOR` **không còn ở Treasury** — do Governance ép, Treasury chấp hành. |

---

## 16. Quyết định genesis seed (custody_seed) — ép bất biến nền sổ↔value tại tạo (2026-06-05)

**Lỗ hổng (audit major):** `custody.ak` chỉ chạy khi **SPEND** custody đã tồn tại (nhánh `Collect`), và Collect chỉ kiểm **INCREMENTAL** (`Δsổ == Δvalue`, đúng T3). Custody UTxO **đầu tiên (seed)** do ví thường tạo với inline `CustodyDatum` **tùy ý** → bất biến nền ghi ở `types.ak`
`∀a Σ_b ledger[(b,a)] == value(a) − reserved_min_ada(a)` **KHÔNG được ép ở đâu on-chain**. Trong v1 (chỉ Collect) value vẫn bảo toàn `Σout=Σin` (không leak), nhưng **kế toán có thể sinh ra đã hỏng** → Release (v1.x) đọc sổ sai sẽ over/under-draw, và không có gì chặn.

**Quyết định: chọn đường (a) — minting-policy one-shot `custody_seed`** (mirror `Distribution/beacon_nft.ak`), KHÔNG chọn đường (b) "tin-cậy-người-seed + chỉ test off-chain".

| Trục | Lý do chọn (a) one-shot seed policy |
|---|---|
| **Định hướng dài hạn (LAMP có giá trị + open SDK)** | Mỗi instance thuê bao (đa thuê bao) tự seed custody của họ. Nếu seed là "tin người" thì mỗi team eco phải tự kỷ luật — không kiểm soát được, niềm tin kế toán rạn. One-shot policy **ép on-chain cho MỌI instance** → seed luôn đúng từ gốc, mở SDK an toàn. |
| **Tư duy nguyên bản (first-principles)** | Bất biến nền là **tiền đề** mà nhánh incremental (`Δsổ==Δvalue`) dựa vào: induction cần **base case** đúng. Ép base case ngay tại genesis = đóng đúng chỗ hở, không vá vòng ngoài. One-shot (consume genesis UTxO) là cách mạnh nhất đạt "policy chạy đúng 1 lần" mà KHÔNG cần state on-chain. |
| **Tư duy tối ưu (eUTxO/ExUnit/ít UTXO)** | Chi phí chỉ phát sinh **đúng 1 lần** (lúc seed), không đụng đường nóng Collect. Cách ép = **một đẳng thức Value** (`value == ledger_value ⊕ reserved`), mirror `value_ok` — rẻ nhất, khóa cả 2 chiều (thiếu/thừa asset). NFT seed kiêm authenticity token (custody "thật" = UTxO mang NFT) → tái dùng cho validator/offchain phụ thuộc về sau, không thêm UTXO. |
| **Lợi ích người dùng + bền vững** | Kế toán **không thể sinh ra đã hỏng** → an toàn vốn khi Release. Cấm burn NFT → supply authenticity bất biến, đơn giản hóa lý luận an toàn mọi validator phụ thuộc. |

**Triển khai:**
- `lib/magiclamp/treasury/collect.ak`: thêm `ledger_value` + `seed_value_ok(value, ledger, reserved_min_ada)` (ép `value == ledger_value(ledger) ⊕ reserved_min_ada`).
- `validators/custody_seed.ak`: minting policy `custody_seed(genesis_ref, custody_script_hash)`, redeemer `SeedGenesis { reserved_min_ada }`. Ép: one-shot (consume `genesis_ref`); mint đúng 1 NFT name=`instance_id` qty +1; đúng 1 output custody theo SCRIPT HASH mang inline datum; `seed_value_ok`; `no_dup_lines`; mọi dòng ∈ `accepted_assets`; `reserved_min_ada ≥ 0`. Burn cấm (`else fail`).
- Offchain (`offchain/src/collect.ts`): `ledgerValue` / `seedValue` / `seedValueOk` / `allLinesAccepted` / `seedDatumOk` — gương đủ validator để off-chain DỰNG đúng seed + tự kiểm TRƯỚC khi build genesis tx.

**Bằng chứng test:** `aiken check` 27/27 pass (12 cũ + **15 seed** `custody_seed_test.ak`); `vitest run` 57/57 pass (41 cũ + **16 seed** `tests/seed.test.ts`). Phủ: seed đúng / thiếu genesis / mint qty-size sai / sổ≠value (thiếu reserved, thừa asset, booked thiếu) / dòng trùng khóa / asset không accepted / NFT name lệch instance_id / 2 custody output / burn / reserved âm.

**Lưu ý migrate sang shard-by-asset (T4):** nếu sau đo throughput chốt shard, mỗi shard là 1 custody UTxO độc lập → seed policy áp **per-shard** (mỗi shard 1 NFT, `seed_value_ok` per-shard). Lõi không đổi.
