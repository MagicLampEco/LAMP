# Voting Power — EXEC: Đặc tả triển khai & lộ trình

**Doctype:** MagicLamp Protocol — Governance Spec (EXEC)
**Trạng thái:** 🔜 outline triển khai. Bám `CONTRACT.md` (đã duyệt 2026-06-05, gồm nguyên lý 5 — sàn BFT clamp) — KHÔNG mâu thuẫn. Đã đồng bộ vòng audit TECH/MATH/FEAT (§11) + tích hợp nguyên lý 5 (§12) + vòng audit riêng nguyên lý 5 — clamp BFT (§13).
**Cập nhật:** 2026-06-05

Nguồn chuẩn bắt buộc đọc trước: [`CONTRACT.md`](./CONTRACT.md) (mô hình VP đã duyệt).
Spec anh em (build song song, mỗi spec có Agent phản biện): FEAT (hành vi), MATH (công thức + chứng minh), TECH (kiến trúc on-chain Aiken). EXEC này KHÔNG định nghĩa lại công thức hay datum — chỉ định **thứ tự build, test, deploy, bootstrap, rủi ro, tiêu chí "xong"**.

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Đưa hệ Voting Power từ **outline** tới **chạy thật trên Preview** theo lộ trình có mốc rõ, phụ thuộc tường minh, test có bằng chứng — đúng cách Distribution đã làm (đã live Preview, xem [`Distribution/scripts/LIVE_DEPLOY_PREVIEW.md`](../../Distribution/scripts/LIVE_DEPLOY_PREVIEW.md)).

Mục tiêu cuối của cả dự án (theo định hướng dài hạn): làm LAMP có giá trị qua một hệ quản trị **không token-weighted**, chống thâu tóm bằng tiền. EXEC phục vụ mục tiêu đó bằng cách bảo đảm hệ build được, test được, nâng cấp được, và chuyển dần từ tập trung sang DAO.

### 0.2 Cái gì THUỘC EXEC

- Lộ trình build theo mốc (M0…M6) + thứ tự phụ thuộc.
- Chiến lược test: unit Aiken, property-based cho MATH, **test clamp BFT + sàn cứng (nguyên lý 5)**, e2e Preview.
- Kế hoạch deploy Preview (bám mẫu script tuần tự của Distribution).
- Bootstrap DAO: cử tri đầu, tham số khởi tạo, đường chuyển tập trung → DAO, **chế độ hội đồng bảo trợ khi chưa đủ sàn BFT**, **mốc đo Nakamoto coefficient**.
- Rủi ro + giảm thiểu (vận hành/triển khai, không phải rủi ro toán — MATH lo).
- Tiêu chí "xong" (Definition of Done) cho từng spec FEAT/MATH/TECH/EXEC.

### 0.3 Cái gì KHÔNG thuộc EXEC (thuộc spec khác)

| Hạng mục | Thuộc spec |
|---|---|
| Công thức VP, cap, weight, chứng minh bounded/monotonic/sybil-cost | **MATH** |
| Datum/redeemer, validators, reference input đọc C1–C4, chống double-vote | **TECH** |
| Vòng đời cử tri, loại quyết định, luồng proposal/vote/recall, vòng đời tập sự | **FEAT** |
| Backend PhoenixKey DID sinh trắc + zk-proof | **NGOÀI repo LAMP** (Claude không sửa — chỉ tiêu thụ proof; xem [§3 CONTRACT](./CONTRACT.md)) |
| C1 (MAGIC tiêu thụ), C2 (ScheduleGen) — nguồn dữ liệu | **repo MAGIC** (đọc qua reference input) |

---

## 1. Trạng thái thật hiện tại (bám sự thật, không trí nhớ)

| Module LAMP | Trạng thái | Bằng chứng |
|---|---|---|
| Distribution (Drop Lottery) | ✅ **live Preview**, 113 test | [`Distribution/SPEC.md`](../../Distribution/SPEC.md), commit `af115fe8`, `5cf1ae62`, `1fbd78a4` |
| Treasury | 🔜 chỉ có `SPEC.md` outline | [`Treasury/SPEC.md`](../../Treasury/SPEC.md) |
| Governance / Voting Power | 🔜 outline + CONTRACT đã duyệt | thư mục này |
| Utils | có code + test | [`Utils/src`](../../Utils/src) |

**Hệ quả triển khai:** Distribution là **khuôn mẫu tham chiếu** đã chứng minh chạy được. Voting Power **tái dùng nguyên** bộ công cụ của nó:

- Onchain: Aiken (`onchain/validators`, `onchain/lib`, `onchain/tests`, `plutus.json`). Aiken docs: <https://aiken-lang.org/>. Stdlib: <https://aiken-lang.github.io/stdlib/>.
- Offchain: TypeScript + `@lucid-evolution/lucid` (đã có trong `Distribution/offchain/node_modules`), test bằng `vitest`. Lucid Evolution: <https://anastasia-labs.github.io/lucid-evolution/>.
- Scripts deploy Preview tuần tự: `00_preflight → 01_deploy → 02_… → 04_e2e` (xem [`Distribution/scripts`](../../Distribution/scripts)).
- Mẫu **beacon UTxO + committee multisig** cho dữ liệu off-chain không lấy được trong script context (Plutus V3 không expose epoch nonce — xem [QĐ2 Distribution SPEC](../../Distribution/SPEC.md)). Voting Power dùng lại mẫu này **chỉ làm cơ chế UTxO mock + token xác thực để build/test MVP** khi nguồn thật (MAGIC registry, ScheduleGen, Reputation registry LAMP-side) chưa expose — KHÔNG phải mô hình committee-Governance-post-C1/C2/C3 (nguồn chuẩn theo TECH §5, xem §2.2).

---

## 2. Phụ thuộc & thứ tự (phần xương sống của EXEC)

### 2.1 Blocker tiên quyết: DID proof PhoenixKey

Theo [§3 CONTRACT](./CONTRACT.md): **Governance không chạy THẬT trước khi có DID proof on-chain.** DID sinh trắc + zk-proof "1 DID = 1 người thật" thuộc backend PhoenixKey, NGOÀI repo LAMP.

**Quyết định triển khai (first-principles): tách "build/test" khỏi "chạy thật".**

- Sybil-resistance là thuộc tính của **tầng danh tính**, **tách được về mặt build/test** khỏi **tầng lõi đếm phiếu** — đúng như Distribution đã tách `claimed_balance` khỏi DID ([QĐ1 Distribution SPEC](../../Distribution/SPEC.md)). NHƯNG tách-được-để-build KHÔNG có nghĩa là độc lập về tính đúng đắn: **tính đúng đắn chống-thâu-tóm của lõi PHỤ THUỘC giả định 1-DID-1-người** (MATH §10/§13). Nếu DID không bảo đảm 1-người-1-DID thì mô hình chi phí thâu tóm của lõi sụp (MATH §13 cảnh báo trực tiếp điều này). Do đó **M0–M5 chỉ chứng minh CƠ CHẾ đếm phiếu chạy đúng, KHÔNG chứng minh an toàn sybil; an toàn sybil chỉ có hiệu lực từ M6** (khi cắm zk-verifier DID thật).
- Vì tách được về build/test, ta **build + test toàn bộ lõi với DID giả lập** trước, không chờ PhoenixKey.
- "DID giả lập" = một **interface DID** cố định: lõi nhận một `did_proof` (kiểu opaque) + một verifier có thể thay. MVP test dùng verifier `Stub` (multisig committee ký xác nhận "DID hợp lệ"), giống cách Distribution trust multisig 2/3. Khi PhoenixKey sẵn sàng, **thay verifier**, không sửa lõi.

> Ví dụ ranh giới: lõi gọi `assert_unique_voter(did_proof)`. M0–M4 cài `Stub` (committee ký). M5 thay bằng zk-verifier PhoenixKey. Datum/redeemer của lõi **không đổi** → không phá test cũ.

### 2.2 Phụ thuộc dữ liệu C1–C4

| Tham số | Nguồn | Cơ chế đọc | Trạng thái nguồn |
|---|---|---|---|
| C1 — MAGIC tiêu thụ (~18 epoch) | repo MAGIC (registry/committee MAGIC) | UTxO repo MAGIC + authenticity token → reference input | MAGIC chưa expose; MVP dùng UTxO MAGIC **giả lập** (gắn authenticity token) — KHÔNG phải beacon Governance |
| C2 — LAMP cam kết ScheduleGen (~24 epoch) | repo MAGIC (ScheduleGen) | reference input UTxO ScheduleGen | ScheduleGen có trong MAGIC [cần verify mức sẵn sàng]; MVP dùng UTxO mock nếu chưa sẵn |
| C3 — uy tín cộng đồng | **Reputation registry on-chain LAMP-side** | reference input đọc UTxO registry | registry chưa có; MVP dùng UTxO registry **giả lập** LAMP-side |
| C4 — LAMP nắm giữ (cap 100 triệu) | repo LAMP | reference input đọc **registry LAMP-holding gắn DID**; mỗi entry `did_commit→holding` BACKED bởi LAMP **khóa thật** trong lock UTxO **một-LAMP-một-DID** (D4) | registry chưa có; MVP dùng registry **giả lập** LAMP-side gắn DID + lock UTxO mock |

Reference input (đọc UTxO mà không tiêu) là cơ chế **CIP-0031**: <https://cips.cardano.org/cip/CIP-0031>. Tài liệu Cardano về reference input: <https://developers.cardano.org/docs/get-started/technical-concepts/#reference-inputs> [cần verify đúng URL canonical] — đã vào ledger từ nâng cấp Vasil.

**Quyết định (đồng bộ TECH §5):** nguồn 4 tham số theo đúng kiến trúc TECH §5, KHÔNG phải mô hình "beacon committee Governance post cả C1/C2/C3":

- **C1** đọc **trực tiếp từ UTxO repo MAGIC** qua reference input + **authenticity token** của committee MAGIC (TECH §5.2) — committee MAGIC chứ KHÔNG phải committee/beacon Governance. MVP chưa có nguồn thật → dùng **UTxO MAGIC giả lập gắn authenticity token**.
- **C2** đọc **UTxO ScheduleGen** (repo MAGIC) qua reference input (TECH §5.3). MVP dùng UTxO mock nếu ScheduleGen chưa expose.
- **C3** đọc **Reputation registry on-chain LAMP-side** qua reference input (TECH §5.5 CHỐT). **KHÔNG** lấy từ beacon committee post. MVP dùng UTxO registry giả lập LAMP-side.
- **C4** đọc qua **registry LAMP-holding gắn DID** (CONTRACT §5 **D4**): mỗi entry `did_commit→holding` chỉ hợp lệ khi BACKED bởi LAMP **khóa thật** trong lock UTxO **một-LAMP-một-DID** (UTxO bị tiêu khi khóa → không double-count một kho LAMP cho 2 DID). **CẤM đọc số dư ví trần** qua reference input (mô hình cũ "ví-ref-input snapshot" đã bị D4 loại — vừa hở "mượn-ảnh" hai DID trỏ một ví, vừa cho phép C4 sống lại bằng số dư ví bất kỳ). MVP dùng registry giả lập LAMP-side gắn DID + lock UTxO mock. Negative-test "mượn-ảnh" + "mua trước tiêu sau" theo registry: §3 M5.

Lý do (tối ưu eUTXO): script context không có sẵn các tổng hợp lịch sử nhiều epoch → tổng hợp được tính ở nguồn (MAGIC registry / ScheduleGen / Reputation registry), lõi Governance chỉ **đọc qua reference input + verify token xác thực**. Trust-but-verify: giá trị public, ai cũng đối chiếu được.

> **"Beacon giả lập" trong EXEC chỉ áp cho phần MAGIC/registry CHƯA expose** (C1/C2/C3 dùng UTxO mock gắn token xác thực để build/test). Đây **KHÔNG** phải mô hình committee-Governance-post-3-giá-trị: committee trong MVP chỉ post **mock-UTxO để test**, KHÔNG phải nguồn chuẩn của C1/C2/C3. Khi nguồn thật (MAGIC registry, ScheduleGen, Reputation registry LAMP) sẵn sàng, thay mock bằng UTxO thật, lõi không đổi.

### 2.3 Đồ thị phụ thuộc build

```
                 Utils (đã có)
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   MATH (công thức)  TECH (datum/    FEAT (hành vi,
   geometric VP      validator,      vòng đời cử tri)
   cap/weight)       beacon, vote)        │
          └──────┬───────┴───────┬────────┘
                 ▼               ▼
        Lõi đếm phiếu + VP (DID giả lập = Stub verifier)
                 │
                 ▼
        e2e Preview (committee bootstrap)
                 │
                 ▼  (blocker mở khi PhoenixKey sẵn sàng)
        Thay Stub → zk-verifier DID  →  chạy THẬT
                 │
                 ▼
        Chuyển tập trung → DAO (tham số về tay DAO)
```

> **Ghi chú vòng lặp MATH↔TECH:** đồ thị vẽ MATH/TECH/FEAT song song cho gọn, nhưng MATH và TECH có một **vòng lặp nhỏ** về biểu diễn fixed-point/bảng tra: TECH cần dạng lượng tử hóa `w_k` (MATH định) để cài Tally tra bảng, còn MATH đẩy quyết định fixed-point/exp về cho TECH (MATH §14 Q3, TECH §13 Q1). Vì vậy **M1 và M2 chạy interleaved** (không tuần tự sạch): chốt chung **dạng lượng tử hóa `w_k` + bảng tra quy đổi `c*_capped`** trước khi cả hai khóa output.

---

## 3. Lộ trình theo mốc (M0 → M6)

Mỗi mốc có: đầu vào, việc, **đầu ra kiểm chứng được** (test/evidence), tiêu chí xong. Không tuyên bố "xong" nếu chưa có output cụ thể (bài học verify behavior, không chỉ structure).

### M0 — Khung repo & interface contract (nền)

- **Việc:** dựng `Governance/onchain` (Aiken) + `Governance/offchain` (TS) theo đúng cây thư mục Distribution. Khoá **interface contract** do orchestrator giữ: datum VP, schema beacon C1/C2/C3, format `did_proof`, redeemer vote/proposal/recall. Đây là xương sống integrate onchain↔offchain — không giao mù cho agent.
- **Đầu ra:** `aiken.toml` build sạch (`aiken check` chạy, 0 lỗi); `plutus.json` sinh ra (rỗng validator cũng được); skeleton offchain `vitest` chạy 0 test pass.
- **Xong khi:** `aiken check` xanh + `vitest run` xanh trên skeleton.

### M1 — MATH: công thức VP (DID-agnostic)

- **Đầu vào:** CONTRACT §1 (công thức nhân `VP_i = ∏_k min(C_{k,i}, cap_k)^{w_k}`).
- **Việc:** theo TECH QĐ-T1, **off-chain TÍNH VP đầy đủ** (kể cả mũ phân số `w_k` qua `exp`/`ln` float) → quy về **fixed-point `vp_offchain_ref`** (giá trị off-chain CHỈ để hiển thị/đối chiếu test, **KHÔNG vào VoteDatum, KHÔNG là input của Tally** — D5); **on-chain KHÔNG tính lại lũy thừa**, Tally CHỈ **verify rẻ bằng bảng tra số nguyên** do MATH định (chốt `c*_capped` + tra bảng quy đổi). Vì Plutus không có số thực và hàm siêu việt (`exp`/`ln`) không có sẵn, không tồn tại "hàm VP on-chain đầy đủ" để bit-khớp với float off-chain. Biểu diễn fixed-point + bảng tra do MATH định; EXEC chỉ yêu cầu **xác định (deterministic)** và **`vp_offchain_ref` off-chain khớp Tally-tra-bảng trong dải sai số fixed-point do MATH định** (KHÔNG phải hai engine lũy thừa chạy song song khớp bit).
- **Test:** property-based (xem §4.2) cho các tính chất MATH chứng minh: bounded (cap chặn trên), monotonic theo từng C, geometric (một C=0 → VP=0). Đối chiếu `vp_offchain_ref` off-chain với kết quả Tally tra bảng on-chain trên cùng bộ vector.
- **Xong khi:** ≥ N property pass (N do MATH định) + bộ vector `vp_offchain_ref` off-chain khớp Tally-tra-bảng on-chain **trong dải sai số MATH định**.

### M2 — TECH: datum/redeemer + đọc C1–C4 + clamp BFT (nguyên lý 5)

- **Việc:** validators `VotingPower` đọc C1–C4 qua reference input (C1 từ UTxO MAGIC + authenticity token; C2 từ ScheduleGen; C3 từ Reputation registry LAMP-side; **C4 từ registry LAMP-holding gắn DID, mỗi entry BACKED bởi LAMP khóa thật trong lock UTxO một-LAMP-một-DID — CONTRACT §5 D4, CẤM đọc số dư ví trần**). Schema UTxO mock + token xác thực cho C1/C2/C3 + registry+lock-UTxO mock cho C4 (cơ chế test khi nguồn thật chưa expose, §2.2), format `did_proof` opaque + `Stub` verifier (committee multisig, tái dùng mẫu Distribution).
- **Việc (clamp BFT — nguyên lý 5 CONTRACT §2):** Tally KHÔNG cộng thẳng `VP_i`. Mỗi DID bị **kẹp về sàn phi tập trung** trước khi cộng:
  ```
  VP_eff_i = min( VP_i , ΣVP / BFT_FLOOR )      với BFT_FLOOR = 21 (tham số DAO chỉnh, mặc định 21)
  ```
  Hệ quả số học (bám CONTRACT §2 nguyên lý 5) — **chốt mẫu số đếm phiếu**: ngưỡng tỷ lệ `t` xét trên **ΣVP THÔ** (tổng trước clamp), KHÔNG phải tổng-sau-clamp `Σ VP_eff`. Lý do (first-principles + tối ưu): `cap_eff = ΣVP_thô / 21` là hằng số trong một lần tally; một DID đã max-clamp đóng góp **đúng `1/21` của ΣVP THÔ**. Nếu lấy mẫu số = `Σ VP_eff` (tổng sau clamp), trần `1/21` BỊ PHÁ — vì clamp cắt bớt các DID lớn nên `Σ VP_eff < ΣVP_thô`, tỷ lệ một DID lớn trên tổng-sau-clamp có thể vọt lên (xem phản chứng dưới). Nên mọi ngưỡng `t·ΣVP_thô` đều tính trên ΣVP THÔ; con số DID dưới đây cũng theo mẫu số đó.

  > **Phản chứng (vì sao mẫu số phải là ΣVP THÔ):** 1 DID khổng lồ `VP=1000` + 20 DID nhỏ `VP=1` → `ΣVP_thô = 1020`, `cap_eff = 1020/21 ≈ 48,57`. DID lớn clamp về 48,57. `Σ VP_eff = 48,57 + 20 = 68,57`. Tỷ lệ DID lớn trên **tổng-sau-clamp** = `48,57/68,57 ≈ 70,8%` (PHÁ trần). Nhưng trên **ΣVP THÔ** = `48,57/1020 ≈ 4,76%` (= đúng `1/21`, trần GIỮ). Do đó chốt mẫu số = ΣVP THÔ. TC1 (§4.5) kiểm trần theo đúng mẫu số này + có test phản chứng.

  **Số DID cần cho từng ngưỡng (mẫu số = ΣVP THÔ):** đạt tỷ lệ `t` cần `≥ ⌈t·21⌉` DID độc lập **với giả định MỌI DID thuận đều đã max-clamp** (mỗi DID đóng đúng `1/21` của ΣVP thô) — chỉ khi đó công thức `⌈t·21⌉` mới khớp. Quy ước ngưỡng (cố ý KHÁC nhau, theo dữ kiện đã chốt):
    - **1/3 — ngưỡng PHỦ QUYẾT Byzantine, luật là VƯỢT (`> 1/3`):** 7 DID = đúng `7/21 = 1/3` (chưa vượt) → cần **≥ 8** DID để VƯỢT ngưỡng phủ quyết.
    - **2/3 — ngưỡng SIÊU ĐA SỐ, luật là ĐẠT (`≥ 2/3`):** **14** DID = đúng `14/21 = 2/3` → 14 ĐỦ (đạt). (13 = `13/21 < 2/3` chưa đạt.)
    - **1 — toàn bộ:** **21** DID.
  > Vì sao 1/3 dùng VƯỢT còn 2/3 dùng ĐẠT: 1/3 là ngưỡng an-toàn-BFT cần phe lành **vượt qua** mới chặn được phủ quyết của thiểu số độc hại; 2/3 là mốc siêu-đa-số mà luật DAO công nhận ngay khi **chạm tới**. Đồng bộ CONTRACT §2 ("≥ 14 đạt siêu đa số 2/3") + §4.5 TC2 + §12.
  >
  > **8/14/21 là CẬN DƯỚI (min-attack-set), KHÔNG phải số DID luôn-cần.** Các con số này đạt được khi **mỗi DID thuận đã max-clamp về `cap_eff`**; nếu một số DID thuận có `VP_i` nhỏ hơn trần (chưa chạm `cap_eff`) thì cần **NHIỀU HƠN** ngần đó DID mới gom đủ ngưỡng. Đây là **biên an toàn**: kẻ tấn công cần **TỐI THIỂU** 8 DID độc lập (đã max-clamp) để vượt 1/3 — không có đường tắt dưới 8.

  Cài đặt: vì `ΣVP` phụ thuộc chính các `VP_i` (có thể vòng), tally tính `ΣVP` thô trước, suy `cap_eff = ΣVP / BFT_FLOOR`, rồi clamp từng DID — biểu diễn fixed-point của phép chia này do **MATH/TECH** chốt (xác định, không float on-chain). EXEC chỉ yêu cầu kết quả clamp **xác định** + khớp off-chain trong dải sai số MATH định.
- **Việc (sàn cứng — nguyên lý 5):** quyết định **trọng yếu** (đổi cap/weight, nâng cấp validator, rút quỹ lớn — danh mục do FEAT chốt) chỉ hợp lệ khi **số DID thuận `≥ BFT_FLOOR`**. Chưa đủ → tx tally **fail**, proposal **khóa**, hệ về **chế độ hội đồng bảo trợ** (§5.4). Quyết định thường (không trọng yếu) KHÔNG chịu sàn cứng — tránh tê liệt giai đoạn đầu.
- **Test:** Aiken unit test mỗi nhánh validator (đủ beacon hợp lệ → pass; thiếu chữ ký committee → fail; C4 vượt cap → bị kẹp về cap). **Test clamp bắt buộc (§4.5):** vài DID VP rất lớn → sau clamp KHÔNG ai > `ΣVP_thô/21` (mẫu số = ΣVP THÔ); **test sàn cứng:** số DID thuận < 21 trên quyết định trọng yếu → tally fail (khóa).
- **Xong khi:** test Aiken phủ mọi nhánh redeemer + mọi nhánh fail (negative test bắt buộc) + 2 test clamp/sàn-cứng (§4.5) xanh.

### M3 — FEAT: luồng proposal / vote / recall + vòng đời tập sự

- **Việc:** validators/logic cho tạo proposal (cửa sổ thời gian), cast vote (chống double-vote — 1 DID 1 phiếu/proposal), recall (ngưỡng **co-sign theo đầu người** + **vote theo VP** — giá trị **tham số mở (DAO định)**, FEAT chốt; xem §8). Vòng đời tập sự: người mới VP≈0 (tính năng, không phải bug — CONTRACT §2.1).
- **Chống double-vote:** mỗi (DID, proposal_id) chỉ ghi nhận 1 lần. Mẫu: UTxO "vote receipt" mang DID + proposal_id; validator cấm mint trùng (one-shot, như beacon NFT one-shot policy Distribution đã làm, commit `5cf1ae62`).
- **Test:** Aiken + integration: cùng DID vote 2 lần → tx thứ 2 fail; người VP≈0 vote vẫn ghi nhận quyền tham gia nhưng power≈0.
- **Xong khi:** kịch bản proposal→vote→tally→recall chạy end-to-end trong integration test (chưa cần Preview).

### M4 — Lõi tích hợp + integration test (DID giả lập)

- **Việc:** ráp MATH+TECH+FEAT thành một luồng. Off-chain: VP engine, beacon poster, tx builder vote/proposal/recall (mirror Distribution offchain: `datum.ts`, `*Builder.ts`, `committee.ts`).
- **Test:** integration `vitest` mô phỏng đầy đủ một vòng quản trị với committee `Stub` đóng vai DID verifier + beacon poster. Có bằng chứng output (tally đúng theo VP, double-vote bị chặn).
- **Xong khi:** integration suite xanh, có log/evidence cụ thể (không chỉ "đã xong").

### M5 — Deploy Preview (committee bootstrap, DID vẫn giả lập)

- **Việc:** script tuần tự bám mẫu Distribution: `00_preflight` (kiểm tra ví/quỹ Preview) → `01_deploy` (script address + beacon NFT one-shot) → `02_seed` (post UTxO mock C1/C2/C3 gắn token xác thực; cho C4 thì **khóa LAMP test vào lock UTxO một-LAMP-một-DID rồi post registry mock LAMP-holding gắn `did_commit` của từng cử tri Stub** — CONTRACT §5 D4, KHÔNG nạp LAMP vào ví trần để đọc số dư) → `03_genesis` (mở proposal mẫu) → `04_e2e` (3 cử tri Stub vote, tally on-chain, recall thử). Ghi nhật ký như [`LIVE_DEPLOY_PREVIEW.md`](../../Distribution/scripts/LIVE_DEPLOY_PREVIEW.md).
- **Negative test C4 registry (bắt buộc — CONTRACT §5 D4):** hai kịch bản phủ trên **registry LAMP-holding + lock UTxO một-LAMP-một-DID** (KHÔNG còn đọc số dư ví trần):
  - **(i) "mượn-ảnh" (lỗ hổng C4 sống lại — bắt buộc):** dựng **2 DID Stub cùng trỏ một kho LAMP** (hai entry registry `did_commit_A→holding` và `did_commit_B→holding` cùng BACKED bởi **một** lock UTxO LAMP) → tally **fail** (vì lock UTxO một-LAMP-một-DID đã bị tiêu cho DID A thì DID B không còn bằng chứng khóa, hoặc validator phát hiện hai entry trỏ chung một UTxO khóa). Đây là negative-case lõi của D4: một kho LAMP KHÔNG được tính C4 cho hai DID.
  - **(ii) "mua trước tiêu sau" theo registry (giữ, đổi sang registry):** cử tri Stub **rút/tiêu LAMP đã khóa SAU khi vote** → kiểm: nếu phá lock UTxO thì entry registry C4 **mất hiệu lực** (hết bằng chứng khóa), tally KHÔNG còn tính C4 cho DID đó; LAMP khóa là điều kiện C4 đứng vững, không phải số dư ví đọc lén. e2e phải phủ cả (i) và (ii).
- **Negative test clamp + sàn cứng (bắt buộc — nguyên lý 5, §4.5):** (1) **clamp e2e:** dựng 1 DID Stub có VP rất lớn → tally on-chain Preview ghi `VP_eff` kẹp về `ΣVP_thô/21` (mẫu số = ΣVP THÔ, đã chốt M2), đọc lại datum khớp. (2) **sàn cứng e2e:** chạy một quyết định **trọng yếu** với **< 21 DID** thuận → tx tally **fail thật trên Preview** (proposal khóa, về chế độ hội đồng bảo trợ §5.4); ghi tx hash của lần fail như bằng chứng. M5 chạy với committee bootstrap đóng vai hội đồng bảo trợ (chưa đủ 21 DID độc lập thật là điều BÌNH THƯỜNG ở giai đoạn này — đúng §5.4).
- **Lưu ý collateral/datum decode:** Distribution từng vấp datum decode + collateral ở e2e live (commit `1fbd78a4`) → kế thừa bài học: test decode datum thật trên Preview, đặt collateral đúng.
- **Bất biến chống-thâu-tóm cho M5 (BẮT BUỘC — vì M5 là điểm tập trung quyền lực tối đa):** trong M5 một committee đơn lẻ đang kiểm soát CẢ danh tính (DID Stub) LẪN UTxO mock C1/C2/C3 → về nguyên tắc có thể bịa cử tri + VP tùy ý. Phải chặn bằng các bất biến sau:
  - (a) **Danh sách DID Stub công khai + cố định TRƯỚC khi mở proposal**, commit on-chain (vd hash danh sách trong datum genesis). Committee **KHÔNG được thêm DID giữa kỳ** bỏ phiếu.
  - (b) **Mỗi giá trị mock C1/C2/C3 kèm bằng chứng đối chiếu nguồn** (link Cardano/MAGIC thật) ngay cả ở MVP. Nếu chưa đối chiếu được nguồn thật, **đánh dấu rõ: "M5 là test TIN-CẬY-COMMITTEE, KHÔNG phải bằng chứng chống-sybil — chống-sybil chỉ có hiệu lực từ M6"** (xem §2.1).
  - (c) **Kết quả tally M5 KHÔNG được dùng làm tiền lệ quản trị thật** — chỉ là bằng chứng cơ chế chạy đúng.
- **Xong khi:** có tx hash Preview thật cho mỗi bước + tally on-chain đọc lại khớp tính toán off-chain (trong dải sai số MATH định) + **negative test C4 registry pass — cả "mượn-ảnh" (2 DID trỏ một kho LAMP → fail) lẫn "mua trước tiêu sau" (phá lock → mất C4)** + **negative test clamp + sàn cứng pass (có tx hash lần tally fail khi < 21 DID)** + Nakamoto coefficient đo được ghi vào nhật ký (§5.5) + ba bất biến (a)(b)(c) được khẳng định trong nhật ký deploy.

### M6 — Mở blocker DID + chuyển sang DAO (chạy thật)

- **Việc (phụ thuộc PhoenixKey sẵn sàng):** thay `Stub` verifier bằng **zk-verifier DID** PhoenixKey (1 DID = 1 người, không lộ sinh trắc — CONTRACT §3/§4). Datum/redeemer lõi **không đổi**.
- **Việc (sàn cứng có hiệu lực THẬT — nguyên lý 5):** từ M6, sàn cứng `≥ BFT_FLOOR` DID độc lập đếm trên **DID PhoenixKey thật** (không phải Stub). Hệ chỉ **thoát chế độ hội đồng bảo trợ** (§5.4) khi đạt **≥ 21 DID độc lập có VP > 0** (đo theo Nakamoto coefficient §5.5). Trước mốc đó, quyết định trọng yếu vẫn về hội đồng bảo trợ — đây là hành vi đúng, không phải lỗi.
- **Việc (bootstrap → DAO):** xem §5.
- **Xong khi:** một proposal thật chạy với cử tri có DID PhoenixKey thật trên Preview; quyền chỉnh cap/weight đã chuyển vào validator DAO (committee không còn đơn phương sửa được); **sàn cứng kiểm trên DID thật (quyết định trọng yếu khóa khi < 21 DID độc lập, mở khi đủ — verify được trên Preview)** + Nakamoto coefficient của hệ ghi nhận theo §5.5.

---

## 4. Chiến lược test

Nguyên tắc gốc: **verify behavior, không chỉ structure**. Compile pass ≠ đúng. Mọi tuyên bố "PASS" phải kèm output cụ thể.

### 4.1 Unit Aiken (on-chain)

- Mỗi validator + mỗi hàm thuần có test trong `onchain/tests` (mẫu Distribution `onchain/tests`).
- **Negative test bắt buộc:** thiếu chữ ký committee → fail; double-vote → fail; C4 vượt cap → bị kẹp; beacon sai schema → fail. Chống "happy path only".
- Chạy: `aiken check` (Aiken test runner tích hợp). Docs: <https://aiken-lang.org/language-tour/tests>.

### 4.2 Property-based cho MATH

- Vì VP là công thức toán có tính chất phải giữ với **mọi** đầu vào, dùng property-based test (không chỉ vài ví dụ).
- Aiken hỗ trợ **property-based test với fuzzer** ngay trong ngôn ngữ. Docs: <https://aiken-lang.org/language-tour/tests#property-based-test>. Đây là công cụ chuẩn để kiểm các tính chất MATH sẽ chứng minh.
- Tính chất kiểm (MATH định nghĩa chính xác, EXEC liệt kê để test bám):
  - **bounded:** mỗi `min(C_k, cap_k)` ≤ `cap_k` → VP có chặn trên.
  - **monotonic:** tăng một `C_k` không làm VP giảm.
  - **geometric collapse:** tồn tại `k` với `C_k = 0` → `VP = 0` (token max C4 + C3=0 ⇒ VP=0; đây là chứng minh "token không mua được quyền lực", CONTRACT §1).
  - **xác định:** `vp_offchain_ref` off-chain (exp/ln float → fixed-point) khớp Tally-tra-bảng on-chain **trong dải sai số fixed-point MATH định** trên cùng vector. KHÔNG kỳ vọng bit-khớp tuyệt đối: xấp xỉ số nguyên của hàm siêu việt (exp/ln) không thể bit-khớp với float — chỉ khớp trong dải (MATH §11.5).
- Off-chain (TS) có thể bổ sung property test bằng `fast-check` để đối chiếu chéo [cần verify đã có trong node_modules].

**Ví dụ số minh hoạ** (con số cap/weight là **tham số mở (DAO định)** — đây chỉ để hiểu tính chất):
giả sử 4 tham số, weight đều `1`, cap C4 = 100 triệu. Cử tri A giữ 12 tỷ LAMP nhưng C1=C2=C3=0 (mới vào): `min(12e9, 100e6)=100e6` nhưng `0^1 = 0` ở C1 ⇒ **VP_A = 0**. Cử tri B: C1=50, C2=30, C3=20, C4=10 triệu ⇒ VP_B = (50·30·20·10e6)^... > 0. Người giàu thuần tuý thua người đóng góp thật — đúng nguyên lý CONTRACT §2/§3.

### 4.3 Integration (off-chain, DID giả lập)

- `vitest` mô phỏng vòng quản trị đầy đủ với committee `Stub`. Mẫu: `Distribution/tests/integration.test.ts`.
- Kiểm: tally theo VP đúng; double-vote chặn; beacon đọc qua reference input đúng; recall đạt/không đạt ngưỡng đúng.

### 4.4 e2e Preview (như Distribution đã làm)

- Chạy thật trên Cardano Preview testnet, ghi tx hash từng bước. Đây là mức bằng chứng cao nhất trước mainnet.
- Bài học kế thừa: 1 lệnh kiểm tra trên testnet tránh hàng giờ debug; decode datum + collateral phải test thật (commit `1fbd78a4`).

### 4.5 Test clamp BFT + sàn cứng (nguyên lý 5 — BẮT BUỘC)

Nguyên lý 5 (CONTRACT §2) là lớp chống-thâu-tóm theo **nhóm nhỏ** (cap mỗi DID chỉ chặn cá nhân). Phải có test riêng, không gộp vào happy-path tally:

- **TC1 — clamp chặn trần `1/21` (mẫu số = ΣVP THÔ):** dựng vài DID có `VP_i` rất lớn (vd 1 DID chiếm 90% tổng thô). Sau clamp `VP_eff_i = min(VP_i, ΣVP_thô/21)`: **kiểm không DID nào có `VP_eff_i > ΣVP_thô/21`** (≈ 4,76% của **ΣVP THÔ** — mẫu số đã chốt ở M2). Test cả biên: DID đúng bằng `ΣVP_thô/21` không bị kẹp thêm.
  - **TC1b — phản chứng mẫu số (BẮT BUỘC):** dựng đúng kịch bản M2 — 1 DID `VP=1000` + 20 DID `VP=1` (`ΣVP_thô=1020`, `cap_eff≈48,57`). Kiểm: (a) tỷ lệ DID lớn trên **ΣVP THÔ** = `cap_eff/1020 ≈ 4,76%` (trần GIỮ — đây là mẫu số đã chốt); (b) khẳng định KHÔNG dùng mẫu số tổng-sau-clamp `Σ VP_eff ≈ 68,57` (nếu dùng nhầm sẽ ra `≈ 70,8%`, phá trần). Test này chốt chết quy ước mẫu số để code tally không lệch.
- **TC2 — ngưỡng đạt được cần đủ DID độc lập (mẫu số = ΣVP THÔ, mọi DID đã max-clamp):** dựng `n` DID đã max-clamp (mỗi DID đóng đúng `1/21` của ΣVP thô), kiểm theo **đúng quy ước M2**:
  - **1/3 (VƯỢT):** tỷ lệ thuận VƯỢT `1/3` khi `n ≥ 8`; `n=7` đúng `1/3` (chưa vượt).
  - **2/3 (ĐẠT):** tỷ lệ thuận ĐẠT `≥ 2/3` khi `n = 14`; `n=13` (`13/21 < 2/3`) chưa đạt.
  - **1:** đạt `1` khi `n = 21`.
  Bám đúng số liệu CONTRACT §2 / M2. **Lưu ý:** 8/14/21 là CẬN DƯỚI (mọi DID đã max-clamp); nếu DID thuận có VP nhỏ hơn trần thì cần nhiều DID hơn — TC2 cố ý dựng kịch bản max-clamp để kiểm đúng cận dưới.
- **TC3 — sàn cứng khóa quyết định trọng yếu:** với một quyết định **trọng yếu**, số DID thuận **< 21** → tally **fail**, proposal **khóa** (về chế độ hội đồng bảo trợ §5.4). Cùng quyết định với **≥ 21** DID thuận → tally **pass**. Đây là negative test bắt buộc — chống "happy path bỏ qua sàn".
- **TC4 — BFT_FLOOR là tham số DAO:** đổi `BFT_FLOOR` (vd 19 và 22) → ngưỡng `⌈t·BFT_FLOOR⌉` và sàn cứng dịch theo đúng tham số, xác nhận con số 21 KHÔNG hard-code chết. Lưu ý chuẩn BFT (n ≥ 3f+1): 21 chịu `f=6` (3·6+1=19 ≤ 21 < 22=3·7+1); 21 là **SÀN tối thiểu**, không phải ghế cố định.

Các test này chạy ở M2 (Aiken unit), lặp lại ở M4 (integration off-chain so khớp clamp), và phủ ở M5 (e2e Preview: kịch bản < 21 DID → quyết định trọng yếu bị khóa thật).

---

## 5. Bootstrap DAO: tập trung → phi tập trung

Đây là phần nhạy cảm nhất (chuyển quyền). Thiết kế theo first-principles: **bắt đầu tập trung tối thiểu cần thiết, có lộ trình rút lui ghi sẵn on-chain, không để committee giữ quyền vĩnh viễn.**

### 5.1 Ai là cử tri đầu (genesis voters)

- Vấn đề con-gà-quả-trứng: VP cần lịch sử (C1/C3), nhưng lúc khởi tạo chưa ai có lịch sử.
- **Quyết định:** một tập **genesis voters** nhỏ, công khai — thành viên Foundation + người đóng góp sớm có DID PhoenixKey (khi M6). Trong M5 (DID giả lập), genesis voters là các DID `Stub` do committee chỉ định, **công khai danh sách** để cộng đồng giám sát.
- Genesis voters KHÔNG được VP đặc quyền vĩnh viễn — họ chỉ là điểm khởi động. Khi C1/C3 của cộng đồng tích đủ qua nhiều epoch (mô hình tập sự, CONTRACT §2.1), quyền lực phân tán tự nhiên.
- **Bất biến GĐ A (đồng bộ bất biến M5 §3):** ở GĐ A committee kiểm soát cả DID Stub lẫn UTxO mock C1/C2/C3 → để tránh committee tự bịa cử tri + VP mà không lộ: (a) danh sách DID Stub **công khai + cố định, commit on-chain trước khi mở proposal**; (b) mỗi giá trị mock C1/C2/C3 kèm bằng chứng đối chiếu nguồn, hoặc **đánh dấu rõ GĐ A là test tin-cậy-committee, KHÔNG phải bằng chứng chống-sybil** (chống-sybil từ M6); (c) **kết quả tally GĐ A KHÔNG dùng làm tiền lệ quản trị thật**.

### 5.2 Tham số khởi tạo

- Cap C1/C2/C3, weight `w_k`, độ dài cửa sổ (C1 ~18 epoch, C2 ~24 epoch — CONTRACT §1) **đặt giá trị khởi tạo ban đầu** do orchestrator/Foundation chốt cho M5, **nhưng đánh dấu rõ là tạm thời**.
- Cap C4 = **100 triệu LAMP** (CONTRACT §1/§3 — con số này đã chốt trong CONTRACT, KHÔNG mở).
- Mọi cap/weight khác: **tham số mở (DAO định)** — không bịa con số cuối ở EXEC.
- **Bất biến bootstrap (xử lý cảnh báo MATH §9.2 — VP=0 toàn cục):** vì công thức nhân, nếu lúc khởi tạo **chưa cử tri nào có C3 > 0** thì `VP = 0` toàn hệ → governance tê liệt. Giá trị khởi tạo M5 PHẢI xử lý trường hợp này: hoặc **đặt `w_3 = 0` lúc bootstrap rồi bật dần** khi Reputation registry có dữ liệu, hoặc **dùng `floor_k` tạm** (sàn dương cho tham số chưa có lịch sử). Chọn cách nào **ghi rõ + lý do** vào nhật ký deploy, tránh toàn hệ VP=0. Quyết định bootstrap này liên kết MATH §9.2 / §14 Q1.

### 5.3 Đường chuyển quyền (3 giai đoạn)

```
GĐ A — Committee-guarded (M5)      GĐ B — DAO-proposable (sau M6)     GĐ C — DAO-sovereign
committee multisig đặt tham số  →  DAO bỏ phiếu đổi tham số, committee →  committee bỏ multisig;
+ post beacon; danh sách công     chỉ còn post beacon (vận hành),       chỉ validator DAO đổi
khai; cộng đồng giám sát           không đơn phương đổi cap/weight        được cap/weight
```

- **GĐ A → B:** mở khi DID thật (M6) + cộng đồng đủ cử tri có VP>0 để một vote có ý nghĩa (ngưỡng số cử tri tối thiểu là **tham số mở (DAO định)**).
- **GĐ B → C:** committee tự nguyện (hoặc theo proposal) gỡ quyền đặt tham số khỏi multisig, chuyển hẳn vào validator DAO. Quyền post beacon (C1/C2/C3) có thể giữ ở committee lâu hơn vì là vai vận hành dữ liệu, không phải vai quyền lực — nhưng cần lộ trình phi tập trung beacon (vd nhiều committee độc lập, hoặc oracle) **[câu hỏi treo §10]**.
- **Bất biến cần giữ:** ở mọi giai đoạn, committee KHÔNG được tự cấp VP cho mình ngoài công thức; mọi thay đổi cap/weight để lại dấu vết on-chain (truy vết được).
- **Mốc Nakamoto coefficient (điều kiện trưởng thành — nguyên lý 5):** GĐ B→C chỉ nên mở khi hệ đã **đủ phi tập trung thật**, đo bằng [Nakamoto coefficient](https://news.earn.com/quantifying-decentralization-e39db233c28e) = số DID độc lập **tối thiểu** cần cấu kết để kiểm soát > 1/3 (hoặc > 1/2) VP-tham-gia sau clamp. Mục tiêu hệ trưởng thành: **Nakamoto coefficient ≫ 21**. Khi đó trần `1/21` tự nới và không còn ràng buộc (clamp trở nên vô hại vì không DID nào chạm trần) — đây là tín hiệu lượng hóa rằng sàn BFT đã hoàn thành vai trò. Mốc đo cụ thể ghi ở §5.5.

### 5.4 Chế độ hội đồng bảo trợ (khi chưa đủ BFT_FLOOR DID độc lập)

Hệ quả trực tiếp của **sàn cứng** (nguyên lý 5): nếu số DID độc lập đủ tư cách **< BFT_FLOOR (21)**, mọi quyết định **trọng yếu** bị **khóa** (tally fail — M2/§4.5 TC3). Nhưng hệ vẫn phải vận hành (post beacon, mở proposal thường, sửa lỗi khẩn). Cơ chế khóa cần một **đường lùi an toàn**, không để hệ tê liệt hoàn toàn:

- **Định nghĩa:** khi hệ chưa đạt sàn 21 DID độc lập đủ tư cách, quyền quyết định trọng yếu **tạm về committee multisig bootstrap** (hội đồng bảo trợ) — đúng vai GĐ A. Committee chỉ là **người giữ tạm**, KHÔNG phải chủ sở hữu quyền lực; mọi hành động phải on-chain, công khai, recall được.
- **Phạm vi bị khóa cho cộng đồng (chỉ committee quyết được):** đổi cap/weight, nâng cấp validator, rút quỹ lớn. Phạm vi mở (cộng đồng vote thường, không cần đủ 21): proposal không trọng yếu, tín hiệu, thảo luận.
- **Điều kiện THOÁT chế độ này (one-way, ghi on-chain):** khi đủ **≥ 21 DID độc lập có VP > 0** (đo theo Nakamoto coefficient §5.5, không phải chỉ đếm đầu DID đăng ký — phải là DID độc lập, không cùng phục vụ một thực thể), sàn cứng tự cho phép quyết định trọng yếu chạy qua VP, committee mất quyền đơn phương. Việc thoát phải để lại dấu vết on-chain (epoch đạt sàn, danh sách DID đủ tư cách hash trong datum).
- **Bất biến chống lạm dụng (đồng bộ bất biến M5 §3 + §5.1 GĐ A):** trong chế độ bảo trợ committee KHÔNG được (a) tự thêm DID Stub giữa kỳ để giả đạt 21; (b) tự cấp VP cho mình ngoài công thức; (c) dùng quyết định ở chế độ bảo trợ làm tiền lệ quản trị thật sau khi hệ trưởng thành. Danh sách DID đủ tư cách + mỗi quyết định bảo trợ phải public + recall được.
- **Vì sao về committee, không tê liệt cứng:** first-principles — sàn cứng bảo vệ chống thiểu số chiếm quyền KHI hệ đã phi tập trung; ở giai đoạn bootstrap (chưa đủ 21 DID) thì "thiểu số" chính là toàn bộ hệ, nên đòi 21 phiếu là bất khả thi → phải có người giữ tạm minh bạch thay vì khóa chết. Đây là sự đánh đổi có chủ đích, ghi rõ để truy vết (4 trục: an toàn vốn user + hệ vận hành bền + chống gaming bằng công khai/recall + đường phi tập trung tường minh).

### 5.5 Mốc đo Nakamoto coefficient của hệ qua thời gian

Để biết hệ đã trưởng thành (thoát chế độ bảo trợ §5.4, mở GĐ B→C §5.3), cần **đo định kỳ**, không đoán:

- **Định nghĩa đo:** Nakamoto coefficient của Governance = số **DID độc lập tối thiểu** cần cấu kết để kiểm soát > 1/3 tổng VP-tham-gia **sau clamp** (ngưỡng phủ quyết Byzantine). Có thể đo thêm bản > 1/2 (đa số thường). Tính off-chain từ snapshot VP mỗi proposal-open epoch; công khai để cộng đồng đối chiếu (trust-but-verify, mẫu Distribution).
- **Vì sao đo sau clamp:** clamp ép trần `1/21` nên Nakamoto coefficient luôn **≥ 8** (cần ≥ 8 DID đã max-clamp để vượt 1/3 — M2). Con số đo có ý nghĩa khi vượt xa 8: nó cho biết quyền lực đã **phân tán tự nhiên** tới đâu (nhiều DID có VP gần trần) hay vẫn dồn vào nhóm nhỏ vừa-đủ-8.
- **Mục tiêu theo thời gian:** Nakamoto coefficient **tăng dần qua các epoch** (mô hình tập sự CONTRACT §2.1 khiến cộng đồng tích VP dần) và đạt **≫ 21** ở hệ trưởng thành. Khi đó không DID nào còn chạm trần `1/21` → clamp vô hại → sàn BFT hoàn thành vai trò.
- **Ghi nhận:** mỗi proposal-open epoch ghi Nakamoto coefficient đo được vào nhật ký quản trị (mẫu `LIVE_DEPLOY_PREVIEW.md`). Đây là chỉ số sức khỏe phi tập trung chính của hệ — theo dõi đường cong của nó để quyết định mở GĐ B→C.

---

## 6. Rủi ro & giảm thiểu (vận hành/triển khai)

(Rủi ro toán học — sybil-cost, collusion — đã luận ở CONTRACT §2 và thuộc MATH. Đây là rủi ro triển khai/vận hành.)

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | **DID PhoenixKey trượt tiến độ** → M6 kẹt | Cao | Tách build/test khỏi chạy thật (§2.1). M0–M5 hoàn tất độc lập với DID. Hệ "sẵn sàng cắm DID" chứ không "chờ DID". |
| R2 | **Committee beacon gian lận / sai số** (C1/C2/C3) | Trung | Giá trị public, trust-but-verify (mẫu Distribution QĐ2). Bất kỳ ai đối chiếu Cardano/MAGIC thật; sai → cộng đồng phát hiện + recall committee. |
| R3 | **Lệch fixed-point on-chain vs off-chain** → tally sai | Cao | Bắt buộc `vp_offchain_ref` off-chain khớp **Tally-tra-bảng on-chain trong dải sai số fixed-point MATH định** (M1) — KHÔNG phải hai engine lũy thừa khớp bit (off-chain dùng exp/ln float, on-chain chỉ tra bảng số nguyên) + property test xác định (§4.2). Không ship nếu vector lệch ra ngoài dải. |
| R4 | **Cross-repo (MAGIC) đổi schema C1/C2** phá đọc reference input | Trung | Khoá interface contract beacon ở M0; versioned schema; integration test đối chiếu schema MAGIC thật trước M5. |
| R5 | **Double-vote / replay** qua UTxO khéo léo | Cao | One-shot vote receipt (DID+proposal_id), mẫu beacon NFT one-shot Distribution; negative test bắt buộc (§4.1). |
| R6 | **Genesis voters thành tầng lớp đặc quyền** (không chịu rút) | Trung | Không cấp VP đặc quyền vĩnh viễn (§5.1); lộ trình GĐ A→B→C ghi sẵn; danh sách công khai; recall được. |
| R7 | **Collateral/datum decode lỗi ở e2e Preview** | Trung | Kế thừa bài học commit `1fbd78a4`: test decode datum thật + collateral đúng trước khi tuyên bố live. |
| R8 | **Đa account gh / post nhầm identity** khi báo cáo | Thấp | Tuân quy ước CLAUDE.md: chọn identity qua `GH_TOKEN=$PAT`, verify bằng `gh api user`, nội dung GitHub duyệt trước. |
| R9 | **Hệ chưa đủ 21 DID độc lập** → quyết định trọng yếu khóa, dễ bị hiểu nhầm là "hỏng" hoặc bị committee lạm quyền trong lúc khóa | Trung | Chế độ **hội đồng bảo trợ** minh bạch (§5.4): committee giữ tạm, mọi hành động on-chain + công khai + recall được; điều kiện thoát one-way ghi on-chain (≥ 21 DID độc lập, đo §5.5); bất biến chống committee tự thêm DID/tự cấp VP. Tài liệu nói rõ "khóa" là TÍNH NĂNG (sàn BFT), không phải bug. |
| R10 | **Đếm "21 DID" theo đầu DID đăng ký, không phải DID ĐỘC LẬP** → committee/kẻ tấn công nhồi DID cùng phục vụ một thực thể để giả đạt sàn | Cao | Sàn cứng + thoát chế độ bảo trợ đo theo **Nakamoto coefficient** (DID độc lập, §5.5), KHÔNG chỉ đếm đầu DID; M6 dùng DID PhoenixKey sinh trắc (1 người = 1 DID); hành vi cùng phục vụ một thực thể lộ thiên on-chain → recall (CONTRACT §2 nguyên lý 2/4). |

---

## 7. Tiêu chí "xong" (Definition of Done) từng spec

| Spec | Xong khi |
|---|---|
| **MATH** | Công thức VP biểu diễn xác định (fixed-point + bảng tra); ≥ property test cho bounded/monotonic/geometric-collapse pass (Aiken fuzzer); chứng minh "token không mua được quyền lực" viết rõ; **`vp_offchain_ref` off-chain khớp Tally-tra-bảng on-chain trong dải sai số MATH định (có test so khớp)** — KHÔNG kỳ vọng bit-khớp tuyệt đối với fixed-point exp/ln (MATH §11.5). |
| **TECH** | Datum/redeemer định nghĩa đủ; validators đọc C1–C4 (C4 trực tiếp, C1/C2/C3 qua beacon+reference input); `Stub` DID verifier cắm được, thay bằng zk-verifier không phá datum; Aiken unit test phủ mọi nhánh + negative test. |
| **FEAT** | Vòng đời cử tri (gồm tập sự VP≈0) + 3 loại quyết định + luồng proposal/vote/recall mô tả đủ; double-vote chặn; ngưỡng recall (co-sign + %) khớp Governance SPEC; integration test chạy 1 vòng quản trị. |
| **EXEC** (file này) | M0–M5 có đầu ra kiểm chứng (test xanh + tx hash Preview); kế hoạch M6 + bootstrap DAO ghi rõ; rủi ro + giảm thiểu liệt kê; **clamp BFT + sàn cứng (nguyên lý 5) có test bắt buộc (§4.5) + chế độ hội đồng bảo trợ (§5.4) + mốc đo Nakamoto coefficient (§5.5) ghi rõ**; tài liệu deploy ghi như `LIVE_DEPLOY_PREVIEW.md`. |

---

## 8. Tham số mở (DAO định)

Các tham số EXEC **cố ý KHÔNG bịa con số cuối**:

- Cap C1, C2, C3 — **tham số mở (DAO định)**.
- Weight `w_k` cho mọi tham số — **tham số mở (DAO định)**.
- Độ dài cửa sổ C1 (~18 epoch) và C2 (~24 epoch) — CONTRACT nêu **ví dụ**, giá trị chốt là **tham số mở (DAO định)**.
- Ngưỡng số cử tri tối thiểu để GĐ A→B (vote có ý nghĩa) — **tham số mở (DAO định)**.
- Số property test tối thiểu `N` (M1) — do **MATH** chốt.
- Ngưỡng recall: **co-sign (đầu người) + vote (theo VP)** — giá trị **tham số mở (DAO định)**, FEAT chốt. Con số tham chiếu Governance SPEC (200/500 DID, 66%/75%) chỉ là **GỢI Ý chưa chốt**; FEAT thực tế dùng 2/3 và 3/4 (khác) → KHÔNG coi là số build được ở M3.

**Đã chốt (KHÔNG mở):** Cap C4 = **100 triệu LAMP** (CONTRACT §1/§3).

---

## 9. Phụ thuộc (tóm tắt)

- **PhoenixKey DID proof on-chain** — blocker tiên quyết cho **chạy thật** (M6). NGOÀI repo LAMP. Build/test (M0–M5) KHÔNG chờ nó (§2.1).
- **repo MAGIC** — nguồn C1 (MAGIC tiêu thụ) + C2 (ScheduleGen). Đọc qua reference input; cần khoá schema beacon ở M0 (R4).
- **repo LAMP** — C4 đọc qua **registry LAMP-holding gắn DID + lock UTxO một-LAMP-một-DID** (CONTRACT §5 D4 — KHÔNG đọc số dư ví trần); tái dùng toolchain + mẫu beacon/committee/one-shot của Distribution.
- **Utils** — tái dùng tiện ích chung.

---

## 10. Câu hỏi còn treo

1. **Phi tập trung beacon C1/C2/C3:** sau GĐ C, ai post beacon? Một committee đa chữ ký giữ lâu dài (rủi ro tập trung dữ liệu) hay nhiều committee độc lập / oracle? — chưa chốt, cần thiết kế trước GĐ C (§5.3).
2. **Biểu diễn fixed-point cho weight `w_k` + bảng tra:** phân số `p/q` + luỹ thừa nguyên, hay log-domain (cộng log thay nhân)? Ảnh hưởng độ chính xác on-chain. Có vòng lặp MATH↔TECH (MATH §14 Q3, TECH §13 Q1, xem ghi chú §2.3). — **MATH** quyết, EXEC chỉ yêu cầu xác định + `vp_offchain_ref` khớp Tally-tra-bảng trong dải sai số (KHÔNG bit-khớp tuyệt đối).
3. **C3 (uy tín) lấy on-chain hay beacon?** "Lịch sử quyết định đúng" có thể suy ra on-chain từ vote receipts, hoặc committee chấm điểm rồi post beacon. On-chain thì sạch hơn nhưng tốn ExUnit/khó định nghĩa "đúng". — cần FEAT+TECH chốt nguồn trước M2.
4. **Mức sẵn sàng thật của ScheduleGen (C2) trong MAGIC** — `[cần verify]` có UTxO đọc được qua reference input chưa, schema ổn định chưa.
5. **Ngưỡng recall** trong Governance SPEC (200/500 DID, 66%/75%) — có còn đúng sau khi mô hình chuyển sang VP nhân không? FEAT cần rà lại (co-sign theo đầu người hay theo VP?).

---

*EXEC này bám `CONTRACT.md` (đã duyệt). Mọi con số tham số chưa chốt được đánh dấu "tham số mở (DAO định)". Trạng thái thật: Distribution đã live Preview (khuôn mẫu tham chiếu); Treasury/Governance ở mức outline.*

---

## 11. Phản hồi audit (vòng đối chiếu TECH/MATH/FEAT)

Đã áp dụng cả 9 finding. Tóm tắt cách xử lý + chỗ sửa:

1. **[major] M1/R3/§4.2 "bit-khớp" sai chỗ** → đã sửa. M1 bỏ "cài hàm VP on-chain đầy đủ"; theo TECH QĐ-T1: off-chain tính exp/ln float → `vp_offchain_ref` fixed-point, on-chain Tally chỉ tra bảng số nguyên. R3 + §4.2 + DoD MATH §7 đổi "bit-khớp" thành "khớp Tally-tra-bảng trong dải sai số MATH định".
2. **[major] Nguồn C1/C3 sai khuôn** → đã đồng bộ §2.2 với TECH §5: C1 từ UTxO MAGIC + authenticity token (committee MAGIC, không phải beacon Governance); C2 từ ScheduleGen; C3 từ Reputation registry LAMP-side qua reference input. "Beacon giả lập" chỉ là cơ chế UTxO mock để test, không phải nguồn chuẩn — ghi rõ. §1 cũng sửa cho khớp.
3. **[major] M5 single-point-of-trust (sybil)** → đã thêm 3 bất biến vào M5 §3 + §5.1 GĐ A: (a) danh sách DID Stub công khai + cố định, commit on-chain trước proposal; (b) mock C1/C2/C3 kèm bằng chứng nguồn, hoặc đánh dấu rõ "M5 là test tin-cậy-committee, không phải bằng chứng chống-sybil"; (c) tally M5 không làm tiền lệ quản trị thật.
4. **[minor] Bịa số recall ở M3** → đã dời con số 200/500 + 66/75 ra khỏi việc-phải-build M3, đánh dấu "tham số mở (DAO định)"; §8 ghi rõ đó chỉ là GỢI Ý chưa chốt (FEAT dùng 2/3, 3/4 khác).
5. **[minor] "vuông góc" + URL Vasil** → đã sửa §2.1: thay "vuông góc (⟂)" bằng "tách được về build/test, NHƯNG đúng đắn chống-thâu-tóm PHỤ THUỘC giả định 1-DID-1-người (MATH §10/§13); M0–M5 chỉ chứng minh cơ chế, an toàn sybil từ M6". Thay URL Vasil `[cần verify]` bằng link Cardano developers reference-input (vẫn để `[cần verify]` đúng canonical), giữ CIP-0031.
6. **[minor] DoD MATH §7 "bit-khớp"** → đã sửa cùng finding 1 (khớp trong dải, có test so khớp).
7. **[minor] M5 thiếu negative test C4** → đã thêm negative test C4 vào M5 04_e2e + DoD M5. **Lưu ý (cập nhật theo D4):** vòng audit này ban đầu dùng mô hình "ví-ref-input snapshot tại proposal-open epoch (TECH §5.4)"; mô hình đó đã bị **CONTRACT §5 D4 loại** (hở "mượn-ảnh" + cho C4 sống lại bằng số dư ví bất kỳ). Negative test C4 nay theo **registry LAMP-holding gắn DID + lock UTxO một-LAMP-một-DID**: "mượn-ảnh" (2 DID trỏ một kho LAMP → fail) + "mua trước tiêu sau" (phá lock → mất C4). Xem §3 M5 + mục "Phản hồi reconcile 2026-06-05" cuối file.
8. **[nit] Đồ thị phụ thuộc thiếu vòng MATH↔TECH** → đã thêm ghi chú dưới đồ thị §2.3: M1/M2 chạy interleaved, chốt chung dạng lượng tử hóa `w_k` + bảng tra trước khi khóa (MATH §14 Q3, TECH §13 Q1).
9. **[nit] §5.2 thiếu bất biến VP=0 toàn cục** → đã thêm bất biến bootstrap: đặt `w_3=0` lúc bootstrap rồi bật dần, hoặc dùng `floor_k` tạm; ghi rõ lý do; liên kết MATH §9.2 / §14 Q1.

**Lưu ý tham chiếu:** các mục TECH §5.x, MATH §9/§11/§13/§14 được trích từ finding audit (spec anh em build song song, chưa nằm cùng thư mục VotingPower lúc sửa). Khi TECH/MATH chốt bản chính, cần đối chiếu lại số hiệu mục để link không lệch `[cần verify số mục cuối]`.

---

## 12. Tích hợp nguyên lý 5 (sàn phi tập trung Byzantine — clamp BFT)

CONTRACT §2 thêm **nguyên lý 5**: VP hiệu dụng mỗi DID bị clamp `VP_eff_i = min(VP_i, ΣVP/BFT_FLOOR)`, `BFT_FLOOR = 21` (tham số DAO chỉnh). EXEC tích hợp **chỉ vào các mục liên quan**, giữ nguyên cấu trúc + đánh số cũ. Tóm tắt đã thêm gì + lý do (4 trục để truy vết):

1. **M2** — thêm việc cài **clamp** (kẹp trần `1/21`) + **sàn cứng** (quyết định trọng yếu chỉ hợp lệ khi số DID thuận `≥ 21`) vào Tally; biểu diễn fixed-point phép chia do MATH/TECH chốt (xác định, không float). **Mẫu số đếm phiếu chốt = ΣVP THÔ** (không phải tổng-sau-clamp — nếu nhầm sẽ phá trần `1/21`, xem phản chứng M2/TC1b). Quy ước ngưỡng: **1/3 là VƯỢT (`>1/3` → cần ≥ 8 DID)**, **2/3 là ĐẠT (`≥2/3` → 14 DID đủ)**, 21 đạt 100%. Các số 8/14/21 là **CẬN DƯỚI** (mọi DID đã max-clamp); DID nhỏ hơn trần thì cần nhiều hơn.
2. **§4.5 (mới)** — test bắt buộc: TC1 clamp không ai > `ΣVP_thô/21` + **TC1b phản chứng mẫu số** (1 DID 1000 + 20 DID 1, trần giữ trên ΣVP thô); TC2 ngưỡng cần đủ DID độc lập (1/3 VƯỢT khi n≥8, 2/3 ĐẠT khi n=14, 1 khi n=21); TC3 sàn cứng khóa quyết định trọng yếu khi < 21 DID; TC4 `BFT_FLOOR` là tham số DAO (21 chịu f=6, là SÀN tối thiểu — không phải ghế cố định, tránh bẫy oligarchy 21 block-producer).
3. **§5.4 (mới)** — **chế độ hội đồng bảo trợ**: khi hệ < 21 DID độc lập đủ tư cách, quyết định trọng yếu khóa, quyền tạm về committee multisig minh bạch (giữ tạm, không sở hữu quyền lực); điều kiện thoát one-way ghi on-chain.
4. **§5.5 (mới)** — **mốc đo Nakamoto coefficient** của hệ qua thời gian, đo sau clamp, mục tiêu `≫ 21`; ghi mỗi proposal-open epoch.
5. **§5.3** — gắn mốc Nakamoto coefficient vào điều kiện mở GĐ B→C.
6. **M5 / M6** — M5 chạy committee bootstrap đóng vai hội đồng bảo trợ + negative test clamp/sàn-cứng có tx hash; M6 sàn cứng có hiệu lực THẬT trên DID PhoenixKey, thoát chế độ bảo trợ khi đủ 21 DID độc lập.
7. **R9, R10** — rủi ro "khóa bị hiểu nhầm là hỏng/lạm quyền" (giảm bằng §5.4 minh bạch) + "đếm đầu DID thay vì DID độc lập" (giảm bằng đo Nakamoto coefficient + DID sinh trắc).

**Lý do (4 trục):**
- *Định hướng dài hạn:* clamp + sàn BFT bảo đảm không thực thể nào (kể cả Foundation) chiếm quyền → tăng tin cậy của hệ open-SDK, phục vụ mục tiêu LAMP có giá trị.
- *Nguyên bản:* bám chuẩn an-toàn BFT (n ≥ 3f+1, chịu < 1/3 độc hại) thay vì copy mô hình "N validator cố định" kiểu EOS — 21 là sàn, không phải ghế.
- *Tối ưu eUTXO:* clamp chỉ là một phép `min` + một phép chia `cap_eff = ΣVP_thô/21` trong Tally (rẻ, xác định; mẫu số ΣVP THÔ tính một lần, dùng chung), không thêm UTxO/ExUnit đáng kể; tái dùng đúng khuôn tally đã có.
- *Lợi ích user + bền vững:* chế độ hội đồng bảo trợ tránh tê liệt giai đoạn bootstrap nhưng minh bạch + recall được; Nakamoto coefficient cho chỉ số sức khỏe phi tập trung đo được, decentralize có lộ trình.

**Cần verify khi MATH/TECH chốt bản chính:** biểu diễn fixed-point của `ΣVP/BFT_FLOOR` + thứ tự tính `ΣVP` thô → clamp (tránh vòng phụ thuộc) thuộc MATH/TECH; số hiệu mục liên kết `[cần verify số mục cuối]`.

---

## 13. Phản hồi audit (vòng riêng nguyên lý 5 — clamp BFT)

Audit phản biện sau khi tích hợp nguyên lý 5 (§12). Áp 5 finding:

1. **[major] Mẫu số clamp dùng ΣVP THÔ, nhưng trần `1/21` chỉ đúng nếu mẫu số đếm phiếu cũng là ΣVP thô** — ĐÚNG, đã sửa. Vì clamp cắt bớt DID lớn nên `Σ VP_eff < ΣVP_thô`; nếu xét ngưỡng `t` trên tổng-sau-clamp thì trần `1/21` bị phá (phản chứng: 1 DID `VP=1000` + 20 DID `VP=1` → DID lớn chiếm `≈70,8%` tổng-sau-clamp nhưng đúng `4,76%` trên ΣVP thô). **Chốt: mẫu số đếm phiếu = ΣVP THÔ** (M2 ghi rõ + phản chứng + nêu giả định "8/14/21 chỉ đúng khi mọi DID thuận đã max-clamp"). §4.5 thêm **TC1b** test phản chứng để code không lệch mẫu số. Vì sao chọn ΣVP thô (không phải Σ VP_eff): `cap_eff = ΣVP_thô/21` là hằng số trong một tally, một DID max-clamp đóng đúng `1/21` ΣVP thô — số học sạch, không vòng lặp, khớp dữ kiện đã chốt (8/14/21).
2. **[major] Bất đối xứng quy ước `≥/>` giữa 1/3 và 2/3, M2 và TC2 đọc như mâu thuẫn** — ĐÚNG, đã thống nhất. Chốt rõ ngay M2 + đầu TC2: **1/3 là ngưỡng PHỦ QUYẾT Byzantine → luật VƯỢT (`>1/3`) → cần ≥ 8**; **2/3 là ngưỡng SIÊU ĐA SỐ → luật ĐẠT (`≥2/3`) → 14 đủ**. Hai quy ước cố ý khác nhau, đã ghi lý do (1/3: phe lành phải vượt mới chặn phủ quyết thiểu số; 2/3: DAO công nhận khi chạm). Theo đúng dữ kiện anh chốt ("1/3 cần ≥8 để VƯỢT; 2/3 ĐÚNG 14") + CONTRACT §2 ("≥14 đạt siêu đa số 2/3").
3. **[minor] TC2 ghi "n≥15 mới vượt 2/3" lệch M2/CONTRACT "14 đạt 2/3"** — ĐÚNG, đã sửa. Chọn 2/3 = ngưỡng ĐẠT → TC2 nay ghi "**ĐẠT 2/3 khi n=14; n=13 chưa đạt**", khớp M2 + CONTRACT §2 + §12. Bỏ con số 15 (đó là quy ước VƯỢT, không dùng cho 2/3).
4. **[minor] "DID độc lập đã max-clamp" trộn 2 khái niệm; 8/14/21 là cận dưới không phải số cứng** — ĐÚNG, đã làm rõ. M2 + TC2 thêm câu: **8/14/21 là CẬN DƯỚI (min-attack-set), đạt khi mỗi DID đã max-clamp về `cap_eff`; DID thuận nhỏ hơn trần thì cần nhiều DID hơn**. Đây là biên an toàn — kẻ tấn công cần TỐI THIỂU ngần đó DID độc lập, không có đường tắt.
5. **[nit] §12 dòng tóm tắt lặp "2/3 → đúng 14" theo cách bất đối xứng cũ** — đã đồng bộ §12 mục 1+2: nêu rõ mẫu số = ΣVP THÔ, quy ước 1/3 VƯỢT / 2/3 ĐẠT, 8/14/21 là cận dưới. Ba chỗ (M2, §4.5, §12) nay khớp nhau.

**Không có finding nào bị bỏ** — cả 5 đúng và đã áp. Mọi sửa nằm trong M2 + §4.5 (TC1/TC1b/TC2) + §5.4 (clamp e2e mẫu số) + §12; KHÔNG đụng phần khác, giữ nguyên cấu trúc + đánh số.

---

## 14. Phản hồi reconcile 2026-06-05 (áp D4 — sửa lỗ hổng C4 sống lại)

Áp **CONTRACT §5 D4**: C4 (LAMP nắm giữ) đọc qua **registry LAMP-holding gắn DID**, mỗi entry `did_commit→holding` BACKED bởi LAMP **khóa thật** trong lock UTxO **một-LAMP-một-DID** (UTxO bị tiêu khi khóa → không double-count một kho LAMP cho 2 DID). **CẤM đọc số dư ví trần** qua reference input. Bỏ hẳn mô hình cũ "ví-ref-input snapshot tại proposal-open epoch (TECH §5.4)" — mô hình đó vừa hở **"mượn-ảnh"** (2 DID trỏ chung một ví/kho LAMP), vừa cho **C4 sống lại** bằng số dư ví bất kỳ.

Đã sửa (tất cả cite **D4**, BỎ mọi cite **TECH §5.4** cho mô hình ví-ref-input):

- **§2.2 bảng** (hàng C4): từ "reference input đọc UTxO ví cử tri (snapshot)" → "registry LAMP-holding gắn DID + lock UTxO một-LAMP-một-DID"; trạng thái nguồn đổi sang "registry giả lập LAMP-side gắn DID + lock UTxO mock".
- **§2.2 quyết định** (bullet C4): đổi sang registry + lock một-LAMP-một-DID; ghi rõ CẤM đọc số dư ví trần + lý do D4 (mượn-ảnh + C4 sống lại); cite D4.
- **M2** (đọc C1–C4): C4 từ registry gắn DID + lock UTxO một-LAMP-một-DID, CẤM ví trần; mock registry+lock cho C4; cite D4.
- **M5 `02_seed`**: thay "nạp LAMP vào ví cho C4 + ghi snapshot" → **khóa LAMP vào lock UTxO một-LAMP-một-DID rồi post registry mock gắn `did_commit`** từng cử tri Stub; cite D4.
- **M5 negative test**: BỎ negative test snapshot-ví cũ; THÊM **(i) "mượn-ảnh"** — 2 DID trỏ một kho LAMP → tally **fail** (lõi của D4); **(ii) "mua trước tiêu sau" theo registry** (giữ ý cũ nhưng đổi cơ chế) — phá lock UTxO sau khi vote → entry C4 mất hiệu lực, không còn tính C4. DoD M5 cập nhật theo.
- **§9 phụ thuộc**: C4 đọc qua registry + lock một-LAMP-một-DID (D4), không đọc ví trần.
- **§11 mục 7** (audit cũ): ghi chú cập nhật theo D4 — mô hình TECH §5.4 đã bị loại, negative test C4 nay theo registry.

**Giữ nguyên (KHÔNG đụng):** mọi mục clamp BFT / sàn cứng / mẫu số ΣVP THÔ (§2.2 C1/C2/C3, M2 clamp, §4.5 TC1–TC4, §5.4, §5.5, §12, §13); cap C4 = 100 triệu LAMP (CONTRACT §1/§3); per-capita không token-weighted. LAMP **khóa** ở đây là **chuyển trạng thái** (lock UTxO), KHÔNG burn — bảo toàn `Σ_out = Σ_in` (Treasury CONTRACT §5). Con số cap/weight khác vẫn là "tham số mở (DAO định)".

**Lý do (4 trục):** *Định hướng dài hạn* — đóng lỗ hổng cho phép token-thuần mua C4 qua ví ảo, giữ đúng "token đơn thuần vô hiệu" (CONTRACT §2 nguyên lý 3) → tăng tin cậy hệ open-SDK. *Nguyên bản* — C4 phải là **bằng chứng khóa vốn gắn danh tính**, không phải số dư đọc lén (số dư ví chia sẻ được giữa nhiều DID). *Tối ưu eUTXO* — lock UTxO một-LAMP-một-DID bị **tiêu** khi khóa nên double-count bất khả thi về cấu trúc (không cần kiểm tra phức tạp); registry chỉ là reference input rẻ. *Lợi ích user + bền vững* — chống "mượn-ảnh" sybil bằng vốn chung, an toàn vốn user (LAMP khóa truy vết được, mở khóa được, không đốt).
