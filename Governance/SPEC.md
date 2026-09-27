# Governance — Quản trị Foundation (trang chỉ mục)

> ## ⚠️ CHƯA DÙNG ĐƯỢC — mã on-chain chưa có đường dựng tx
>
> Thư mục này có **6 validator sinh script hash thật** (`vote`, `tally`, `proposal`,
> `nullifier`, `proposal_nft`, `tally_nft`) nhưng **không có `offchain/` và không có
> `scripts/`** — nghĩa là luồng `Vote → Tally → Record → Execute → Release` hiện
> **không có tx hợp lệ nào**, kể cả trên testnet. Test Aiken ở đây là test đơn vị của
> validator, không phải bằng chứng luồng chạy được.
>
> Sáu validator đó là **v1 và sẽ bị thay**: v1 có bốn lỗi hình dạng đo được trên mã, trong đó
> một lỗi khiến một kho custody chỉ chi được cho đúng một proposal cả đời
> ([§v2.1](#v21-vì-sao-thay-v1--bốn-lỗi-đo-được-trên-mã)). Kiến trúc thay thế là
> [§Kiến trúc on-chain v2](#kiến-trúc-on-chain-v2--gốc-tin-cậy-cố-định-theo-pha) — hiện mới là
> đặc tả, chưa có mã.
>
> Repo này Apache-2.0 công khai. Nếu bạn đang tìm một nền governance dùng được cho
> Cardano thì **đây chưa phải**. Đừng đọc `Governance/` để suy ra Treasury Release đã
> khép vòng — nó chưa.
>
> Theo dõi ở issue #21 mục C.

> **Phiên bản:** v2.0 — 2026-09-27. **Vì sao bump chính:** thêm
> [§Kiến trúc on-chain v2](#kiến-trúc-on-chain-v2--gốc-tin-cậy-cố-định-theo-pha) — gốc tin cậy cố
> định theo pha, `proposal_policy` dùng chung trong một pha với tên sinh từ seed, ba pha
> (committee → một DID một phiếu → VP), chuyển pha bằng quét kho — và hạ toàn bộ mã on-chain hiện
> có xuống v1. Đổi cách đúc Proposal NFT là đổi một vế của interface Governance→Treasury, nên là
> bump chính. `ProposalResult` 5 trường (`VotingPower/CONTRACT.md` v1.1 §5 D10) giữ nguyên byte.
> v1.0 — 2026-06-05: lần đầu khai phiên bản.
> **Vai:** view điều phối — trang chỉ mục Governance nói chung, **và** nguồn chuẩn cho hình dạng
> on-chain v2 (validator, policy, apply-param, datum, nhánh, luồng giao dịch, chuyển pha). Phần
> Voting Power (công thức, cap, trọng số) KHÔNG PHẢI nguồn chuẩn ở đây: khi lệch với
> [`VotingPower/CONTRACT.md`](./VotingPower/CONTRACT.md), CONTRACT.md thắng. Về cách đúc và đọc
> Proposal/Tally NFT, mục v2 ở đây thay cho `VotingPower/Tech-Spec.md` §3 và cho cụm "Proposal NFT
> one-shot" ở CONTRACT D2/D10 (CONTRACT v1.1 trỏ về đây). Phần "bầu cử, hội đồng, KPI" (ngoài Voting Power) chưa có nguồn chuẩn khác — vẫn ở mức
> outline.

**Trạng thái:** mô hình Voting Power đã được duyệt khung 2026-06-05. Phần còn lại (bầu cử,
hội đồng, KPI) vẫn ở mức outline.

Nguồn chuẩn của mô hình **Voting Power** là [`VotingPower/CONTRACT.md`](./VotingPower/CONTRACT.md),
chi tiết hóa thành 4 spec:

| Spec | Nội dung | File |
|---|---|---|
| **FEAT** | Tính năng/hành vi: vòng đời cử tri, tập sự, loại quyết định, luồng vote/recall | [VotingPower/Feat-Spec.md](./VotingPower/Feat-Spec.md) |
| **MATH** | Cơ sở toán: công thức VP, chứng minh bounded/monotonic, geometric vs additive, chi phí thâu tóm | [VotingPower/Math-Spec.md](./VotingPower/Math-Spec.md) |
| **TECH** | Kiến trúc on-chain Aiken: validator, đọc C1–C4, DID proof, chống double-vote | [VotingPower/Tech-Spec.md](./VotingPower/Tech-Spec.md) |
| **EXEC** | Lộ trình, mốc, test plan, deploy Preview, bootstrap DAO | [VotingPower/Exec-Spec.md](./VotingPower/Exec-Spec.md) |

---

## Kiến trúc on-chain v2 — gốc tin cậy cố định theo pha

**Trạng thái:** đặc tả, **chưa có mã**. Mã trong `onchain/validators/` là v1 và sẽ bị thay
(§v2.11). Mô hình Voting Power (công thức, cap, trọng số) vẫn thuộc
[`VotingPower/CONTRACT.md`](./VotingPower/CONTRACT.md) v1.1; mục này chỉ định hình dạng on-chain.

Quy ước trong mục này:
- **epoch** = `⌊posix_ms / ms_per_epoch⌋` (`Governance/onchain/lib/magiclamp/governance/util.ak` ▸
  `get_epoch`; `Treasury/onchain/lib/magiclamp/treasury/util.ak` ▸ `get_epoch_bounded`). Đây KHÔNG
  phải số epoch của sổ cái Cardano.
- **epoch của giao dịch** (ký hiệu `e`) = epoch tính theo khuôn bị chặn hai đầu: cả hai biên của
  validity range phải hữu hạn và rơi vào cùng một epoch — đúng khuôn `get_epoch_bounded` mà custody
  đang dùng. Một biên mở hoặc hai biên khác epoch ⇒ giao dịch bị từ chối.
- **`H(S)`** = `blake2b_256(cbor.serialise(S))` với `S` là một `OutputReference`, mã hoá theo
  `aiken/cbor.serialise`. Bên dựng giao dịch phải tái tạo đúng byte đó.

### v2.1 Vì sao thay v1 — bốn lỗi đo được trên mã

| # | Lỗi | Neo mã | Hệ quả |
|---|---|---|---|
| 1 | Proposal NFT one-shot **mỗi proposal** | `Governance/onchain/validators/proposal_nft.ak` ▸ `validator proposal_nft(genesis_ref, asset_name)`: đúc đòi tiêu đúng `genesis_ref` | policy id đổi theo từng proposal. Custody nhận **một** `proposal_policy` làm apply-param (`Treasury/onchain/validators/custody.ak` ▸ `validator custody`) và `release.read_proposal` đòi token của đúng policy đó ⇒ **một instance custody chi được cho đúng một proposal cả đời** |
| 2 | Tally NFT cùng khuôn one-shot | `tally_nft.ak` ▸ `validator tally_nft(genesis_ref, asset_name)`; `proposal.ak` ▸ `validator proposal` nhận **một** `tally_policy` | một bản `proposal` chỉ đọc được tally của đúng một proposal — cùng lỗi 1, ở tầng tally |
| 3 | Datum proposal `Executed` không đọc được ở phía Treasury | `lib/magiclamp/governance/proposal.ak` ▸ `execute_transition_ok` giữ `ProposalDatum` 12 trường ở output; `Treasury/onchain/lib/magiclamp/treasury/release.ak` ▸ `read_proposal` giải mã `ProposalResult` 5 trường (`expect result: ProposalResult = d`) | Release không chạy được trên một proposal v1 thật. Đo bằng một ca kiểm tạm (không commit): dựng `ProposalDatum` status `Executed`, `expect` sang `ProposalResult` ⇒ `FAIL … x <expected> _r: ProposalResult = data` (aiken v1.1.21). `proposal_result_roundtrip_test.ak` không bắt được vì nó kiểm `ProposalResult` ↔ bản sao kiểu Treasury, không kiểm datum mà validator thật ghi ra |
| 4 | Nullifier đốt được trong khi cửa sổ bỏ phiếu còn mở | `nullifier.ak` ▸ nhánh `BurnNullifier` chỉ đòi có token `tally_policy` bị tiêu (`tally_spent`), không đòi cửa sổ đã đóng | đốt rồi đúc lại cùng tên ⇒ một DID hai phiếu (issue #88) |

Lỗi 1–2 không vá được bằng cách chỉ đổi tham số: một policy chung mà không có quy tắc sinh tên duy
nhất thì mất tính duy nhất của `proposal_id` — đúng lỗ F11 mà `Treasury/Tech-Spec.md` đã ghi là
"van quy trình Governance". v2 đóng F11 bằng mật mã (§v2.8 `R-SEED-UNIQUE`).

### v2.2 Nguyên tắc: gốc tin cậy cố định theo pha

1. Mỗi pha quản trị là **một bản validator `governance` riêng**, một script hash riêng.
2. Mọi thứ quyết định "ai có quyền" trong pha là **apply-param** (hằng biên dịch, nằm trong script
   hash): danh sách khoá committee và ngưỡng, `tally_policy`, `tally_script_hash`,
   `weight_param_policy`, `nullifier_policy`, `Δ_min`, `ms_per_epoch`. Mỗi pha chỉ mang những
   apply-param mà pha đó dùng (§v2.5).
3. **Không có UTxO thẩm quyền khả biến. Không có nhánh sửa quyền.** Một giá trị thẩm quyền cần đổi
   ⇒ dựng pha mới.
4. **Chuyển pha = một proposal `Release` của pha cũ** quét toàn bộ số dư kho sang một custody
   instance mới có `governance_ref` = hash của governance pha mới (§v2.7). Đây là đường duy nhất:
   - custody không đổi được `governance_ref` — cả bốn nhánh của `custody.ak` (`Collect`, `Release`,
     `MigrateIn`, `StakeRewardIn`) ép `out_datum.governance_ref == datum.governance_ref`;
   - `MigrateIn` là nhánh nhận LAMP **đúc mới trong cùng giao dịch** (`migrate.mint_ok` đòi
     `tx.mint` chứa đúng `(lamp_policy, token_name)` với Δ > 0), không phải nhánh dời kho.

Vì sao: một UTxO thẩm quyền khả biến biến mọi bảo đảm của pha thành "đúng cho tới lần sửa kế
tiếp". Bên nắm quyền sửa dời được gốc tin cậy tally sang một hash tuỳ ý, hoặc tự bàn giao rồi tự
xoá mà không đảo được. Gốc cố định theo pha đổi rủi ro đó lấy một chi phí đo được và công khai:
mỗi lần đổi quyền là một lần triển khai cộng một giao dịch quét kho, có độ trễ `Δ_min`.

### v2.3 Ba pha

| Pha | Ai quyết | Cơ chế trên chuỗi | Gọi đúng tên |
|---|---|---|---|
| **Pha 0** | ba khoá, ngưỡng 2 | nhánh `ExecuteCommittee`: ≥ 2 chữ ký khác nhau trong 3 khoá chuyển proposal `Open → Executed` | **committee** — không phải DAO; không có phiếu, không có tally |
| **Pha 1** | cử tri = DID | một DID một phiếu; nullifier đòi anchor TAAD của DID | biểu quyết một DID một phiếu |
| **Pha 2** | cử tri = DID | VP đủ 4 tham số, có cap, clamp BFT (`VotingPower/CONTRACT.md` §1, §5 D1) | biểu quyết theo VP |

Pha 0 tồn tại vì Pha 1 phụ thuộc `[IDENT-ONE-PERSON]` và Pha 2 phụ thuộc nguồn C2/C3 (§v2.10) —
chưa đóng. Pha 0 khai đúng bản chất: một committee 2-trong-3 với độ trễ bắt buộc; tài liệu nào mô
tả Pha 0 là quản trị phi tập trung là sai.

C3 (uy tín) ở Pha 2 là một **NFT chứng thực**: tên tài sản = `did_commit`, giá trị nằm trong
datum, do một bên phát hành được quản trị (bên nào: `[C3-ISSUER]`). Policy của NFT đó là
apply-param của `tally` Pha 2.

### v2.4 Đồ thị phụ thuộc hash — thứ tự biên dịch không vòng

"A nhận hash của B làm apply-param" nghĩa là B phải biên dịch trước A. Thứ tự sau không có vòng:

```
tally_policy            weight_param_policy (Pha 2)       (không phụ thuộc gì)
   │                          │
   ├─► nullifier(tally_policy, taad_policy, ms_per_epoch)
   ├─► vote(tally_policy, nullifier_policy)
   └─► tally(tally_policy, vote_script_hash, nullifier_policy,
             weight_param_policy, c_source_policies, tally_window, ms_per_epoch)
                 │
                 ▼
governance(committee | tally_policy, tally_script_hash, nullifier_policy,
           weight_param_policy, ngưỡng pha, Δ_min, ms_per_epoch, phase_tag)
   = handler mint + handler spend  ⇒  proposal_policy == hash(governance)
                 │
                 ▼
custody(proposal_policy, seed_policy, ms_per_epoch, lamp_policy, token_name)
   + datum governance_ref == hash(governance)
```

Ràng buộc suy ra từ đồ thị:

- **`proposal_policy` là handler `mint` của chính validator `governance`** (một validator hai mục
  đích, một hash). Đây là hệ quả bắt buộc, không phải lựa chọn phong cách: policy đúc proposal phải
  kiểm datum khởi tạo và nơi đến (địa chỉ governance) ⇒ phải biết hash governance; governance phải
  nhận ra token của mình ⇒ phải biết policy. Tách thành hai validator thì vòng. Hệ quả ở custody:
  apply-param `proposal_policy` và trường datum `governance_ref` mang **cùng một giá trị**, nhưng
  custody vẫn kiểm **cả hai** (§v2.8 `R-PIN-TWO`).
- `vote`, `tally`, `nullifier` **không** nhận `proposal_policy` (v1 `vote` có — v2 bỏ): nhận thì
  vòng qua `tally_script_hash`. Liên kết proposal ↔ tally đi qua **tên chung `H(S)`** đúc trong
  cùng giao dịch Open (§v2.6), và qua việc governance kiểm tally khi ghi kết quả.
- `tally_policy` đúc theo quy tắc seed-unique và không phụ thuộc gì, nên nó **không tự kiểm** nơi
  đến và datum khởi tạo của tally. Hai thứ đó do handler mint của governance kiểm trong giao dịch
  Open (governance biết `tally_script_hash`). Một token `tally_policy` đúc lẻ ngoài giao dịch Open
  là vô hại: seed của nó đã bị tiêu, nên không bao giờ tồn tại proposal cùng tên.
- `phase_tag` (một chuỗi byte khác nhau cho mỗi pha) nằm trong apply-param của các policy không phụ
  thuộc gì, để hai pha không bao giờ trùng policy id.

### v2.5 Bảng validator

| Tên | Loại | Pha | Apply-param | Datum | Nhánh |
|---|---|---|---|---|---|
| `governance` | mint + spend | 0 | `committee_keys` (3 khoá, đôi một khác nhau), `committee_threshold` = 2, `delta_min_epochs` (> 0), `ms_per_epoch`, `phase_tag` | `ProposalResult` (5 trường, byte-khớp Treasury) | mint `OpenProposal { seed }` · spend `ExecuteCommittee` |
| `governance` | mint + spend | 1 | `tally_policy`, `tally_script_hash`, `nullifier_policy`, `theta_num`/`theta_den`, `quorum_voters` (`[PHASE1-QUORUM]`), `delta_min_epochs`, `ms_per_epoch`, `phase_tag` | `ProposalResult` | mint `OpenProposal { seed, vote_open_epoch, vote_close_epoch }` · spend `FinalizeProposal` |
| `governance` | mint + spend | 2 | như Pha 1, thêm `weight_param_policy`; ngưỡng pass đọc từ `WeightParam` đã cam kết | `ProposalResult` | như Pha 1 |
| `tally_policy` | mint | 1, 2 | `phase_tag` | — | `MintTally { seed }`: tiêu `seed`, đúng 1 token, tên = `H(seed)`, qty 1; mọi lượng âm ⇒ từ chối |
| `tally` | spend | 1, 2 | `tally_policy`, `vote_script_hash`, `nullifier_policy`, `tally_window_epochs`, `ms_per_epoch`; Pha 2 thêm `weight_param_policy`, policy các nguồn C1–C4 | `TallyDatum` v2: `proposal_id`, `vote_open_epoch`, `vote_close_epoch`, `weight_param_ref` (chỉ Pha 2), `phase` (`Summing`/`Final`), tổng thuận/chống/trắng, số DID; Pha 2 thêm vùng dữ liệu clamp của v1 | `SumBatch` · `Finalize` |
| `vote` | spend | 1, 2 | `tally_policy`, `nullifier_policy` | `VoteDatum` v2: `proposal_id`, `did_commit`, `choice`; Pha 2 thêm đầu vào C1–C4 | chỉ tiêu được khi token `(tally_policy, proposal_id)` bị tiêu cùng giao dịch |
| `nullifier` | mint | 1, 2 | `tally_policy`, `taad_policy`, `ms_per_epoch` | — | `MintNullifier { did_commit, proposal_id }` · `BurnNullifier` |
| `weight_param_policy` | mint | 2 | `seed` một lần, `phase_tag` | — (UTxO nó đánh dấu mang datum `WeightParam` của v1) | đúc một lần lúc dựng pha (`[WEIGHT-PARAM-UPDATE]`) |
| `custody` (Treasury) | spend | mọi pha | `proposal_policy`, `seed_policy`, `ms_per_epoch`, `lamp_policy`, `token_name` | `CustodyDatum` (có `governance_ref`) | không đổi ở v2, trừ `[SPEND-SPEC-INSTANCE]` và `[PHASE-SWEEP-INTAKE]` |

Điều kiện từng nhánh:

- **`OpenProposal`** (mọi pha, permissionless): tiêu `seed`; mint của policy này chứa đúng một token,
  tên `H(seed)`, qty 1; đúng một output tại địa chỉ governance (payment = `Script(hash governance)`)
  mang token đó, datum `ProposalResult { proposal_id: H(seed), status: Open, spend_spec_hash,
  execute_after_epoch, released_cumulative: 0 }`, không reference script.
  - Pha 0: Open ghi `execute_after_epoch = 0`; giá trị thật do `ExecuteCommittee` ghi (custody chỉ
    đọc trường này khi `status == Executed`).
  - Pha 1/2: cùng giao dịch phải đúc token `(tally_policy, H(seed))` đặt tại `tally_script_hash` với
    `TallyDatum { proposal_id: H(seed), phase: Summing, tổng = 0, … }`; `vote_open_epoch ≥ e`;
    `vote_close_epoch > vote_open_epoch`; `execute_after_epoch ≥ vote_close_epoch + Δ_min`. Pha 2
    thêm: `weight_param_ref` trỏ đúng một UTxO mang token `weight_param_policy`.
- **`ExecuteCommittee`** (Pha 0): tiêu proposal `Open`; `extra_signatories` chứa ≥ 2 khoá khác nhau
  trong `committee_keys`; đúng một output cùng địa chỉ (cả stake credential), cùng value, không
  reference script; datum ra giữ nguyên `proposal_id`, `spend_spec_hash`, `released_cumulative`;
  `status = Executed`; `execute_after_epoch ≥ e + Δ_min`. Committee **không** sửa được
  `spend_spec_hash` — thứ được ký là thứ đã mở công khai ở Open.
- **`FinalizeProposal`** (Pha 1/2): tiêu proposal `Open`; reference input tại `tally_script_hash`
  mang `(tally_policy, proposal_id)` với `phase == Final`; `status = Executed` nếu qua ngưỡng
  (Pha 1: θ + `quorum_voters`; Pha 2: `pass` canonical của `VotingPower/CONTRACT.md` §5 D1 trên
  power đã clamp), ngược lại `Rejected`; các trường khác giữ nguyên.
- **`SumBatch`** (Pha 1/2, permissionless): `e ≥ vote_close_epoch`; tiêu tally và k UTxO tại
  `vote_script_hash`, mỗi UTxO mang đúng một token `nullifier_policy` có tên
  `blake2b_256(did_commit ‖ proposal_id)` khớp datum của nó; đốt đúng k token đó; cộng dồn theo
  `choice` (Pha 2: power tính lại từ đầu vào C1–C4 như v1, không tin số VP khai).
- **`Finalize`** (tally): `e ≥ vote_close_epoch + tally_window_epochs`; `Summing → Final` (Pha 2:
  kèm clamp BFT như v1 `tally_lib.clamp_consistent`).
- **`MintNullifier`** (Pha 1/2): đúng một token, tên `blake2b_256(did_commit ‖ proposal_id)`, qty 1;
  reference input mang `(tally_policy, proposal_id)` và `vote_open_epoch ≤ e < vote_close_epoch`
  đọc từ datum của nó; đúng một reference input mang `(taad_policy, did_commit)`; datum anchor đọc
  theo chỉ số trên `Data`: trường chỉ số 5 = `Constr 0` (Active), và giao dịch có chữ ký của khoá
  ở trường chỉ số 2 (`controller_pkh`) và trường chỉ số 14 (`device_pkh`). `did_commit =
  blake2b_256(UTF8(did))`, không băm lần hai. Token nullifier nằm ở đâu thì policy không kiểm (vòng
  phụ thuộc); `SumBatch` chỉ đếm token nằm tại `vote_script_hash` — đặt sai chỗ là tự mất phiếu, và
  không đúc lại được.
- **`BurnNullifier`**: chỉ khi `e ≥ vote_close_epoch` và token `tally_policy` bị tiêu cùng giao dịch;
  mọi token của policy trong mint đều qty −1.

### v2.6 Luồng giao dịch

**Pha 0 — committee.**
1. `Open` (bất kỳ ai): tiêu seed `S` → proposal `H(S)` tại governance, `status = Open`,
   `spend_spec_hash` = hash danh sách chi đã định (tính theo `release.spend_spec_hash` với đúng
   `instance_id` đích).
2. `ExecuteCommittee`: 2 trong 3 khoá ký → `Executed`, `execute_after_epoch ≥ e + Δ_min`.
3. `Release` (Treasury, bất kỳ ai): custody đọc proposal qua reference input, kiểm như hiện hành
   (`custody.ak` C-REL-1…9), chờ `epoch ≥ execute_after_epoch`.

**Pha 1 — một DID một phiếu.**
1. `Open`: tiêu `S` → proposal `H(S)` + tally `H(S)` trong **cùng** giao dịch.
2. `Vote` (trong `[vote_open, vote_close)`): đúc nullifier (anchor TAAD + hai chữ ký) → UTxO tại
   `vote_script_hash` mang nullifier + `VoteDatum`.
3. `SumBatch` (từ `vote_close`, bất kỳ ai, nhiều lượt): gom phiếu vào tally, đốt nullifier.
4. `Finalize` (từ `vote_close + tally_window`): tally `Final`.
5. `FinalizeProposal`: governance đọc tally → `Executed`/`Rejected`.
6. `Release` như Pha 0; độ trễ đã khoá từ Open (`execute_after_epoch ≥ vote_close + Δ_min`).

**Pha 2 — VP.** Như Pha 1, thêm: tally datum cam kết `weight_param_ref` ở Open; `VoteDatum` mang
đầu vào C1–C4; `SumBatch` tính power từ bảng tra của `WeightParam` (logic v1 `power.ak`,
`weight_guard.ak`); `Finalize` clamp BFT; `FinalizeProposal` dùng `pass` canonical.

`tally_window` tồn tại vì `SumBatch` không chứng minh được "đã gom hết phiếu" — eUTXO không chứng
minh được sự vắng mặt. Cửa sổ gom đủ dài là thứ cho mọi phía (kể cả phe chống) kịp đưa phiếu của
mình vào trước khi tally đóng; không có nó, một bên gom chọn lọc rồi đóng ngay là đủ để lật kết quả.

### v2.7 Chuyển pha bằng quét kho

1. Dựng pha k+1 theo thứ tự §v2.4; kiểm các ràng buộc biên dịch ở §v2.8.
2. Gieo custody instance k+1 (`custody_seed`) với `governance_ref` = hash governance pha k+1 và
   apply-param `proposal_policy` cùng giá trị; `buckets` và `accepted_assets` phải bao trùm của
   instance k.
3. Ở pha k: mở một proposal có danh sách chi = **mọi dòng sổ** `(bucket, asset)` với toàn bộ số dư,
   `to` = địa chỉ custody k+1; `spend_spec_hash` tính với `instance_id` của instance k.
4. Đưa proposal tới `Executed` bằng cơ chế của pha k; chờ `Δ_min`; `Release`.

Ràng buộc và giới hạn của đường này:

- **Rót đúng địa chỉ chưa phải rót vào sổ.** Output tới địa chỉ custody k+1 mà không đi qua một
  nhánh của custody k+1 thì nằm ngoài sổ của nó (và ngoài NFT xác thực), không nhánh nào tiêu lại
  đúng nghĩa. Custody hiện **không có** nhánh nhận 100% theo `(bucket, asset)` từ một instance tiền
  nhiệm: `Collect` chỉ ghi phần `⌊amount × cut_bps / 10000⌋` (`collect.ak` ▸ `item_cut`) và cấm ghi
  vào bucket dành riêng; `MigrateIn` đòi đúc LAMP. ⇒ `[PHASE-SWEEP-INTAKE]`.
- **Nhận phải đo bằng Δ, không bằng tổng output** (`R-SWEEP-DELTA`, §v2.8).
- **Phần ADA giữ NFT ở lại instance k**: output custody k phải còn NFT xác thực và ADA tối thiểu,
  nên không quét được về 0.
- **Pha cũ không tắt được.** Governance pha k vẫn tồn tại và vẫn điều khiển instance k. Mọi dòng
  nạp còn trỏ instance k sau chuyển pha tiếp tục nằm dưới quyền pha k. Trong repo này, đường Reserve
  → custody ghim instance bằng apply-param: `Treasury/onchain/validators/reserve_gate.ak` ▸
  `validator reserve_gate(custody_nft_policy, custody_nft_name, …)` ⇒ `[PHASE-RESERVE-REPOINT]`. Các
  nguồn nạp ngoài repo này (ghim bằng cấu hình hay bằng apply-param) chưa được đếm.
- **Kích thước**: sổ tối đa `ledger.max_ledger_lines` dòng; một giao dịch `Release` quét hết có vừa
  giới hạn ExUnit hay không chưa đo (`[SUMBATCH-EXUNIT]` gồm cả phép đo này). Mỗi proposal chỉ chi
  một lần (`consumed_proposals`), nên chia nhỏ nghĩa là nhiều proposal.

### v2.8 Ràng buộc bắt buộc

- **`R-PIN-TWO` — custody ghim hai thứ.** `proposal_policy` (apply-param) **và** `governance_ref`
  (datum). `release.read_proposal` kiểm cả hai: `Script(ph) == governance_ref`, đúng một token
  `proposal_policy`, `nft_name == proposal_id`. Bỏ vế địa chỉ thì an toàn của kho phụ thuộc hoàn
  toàn vào việc handler mint không bao giờ để token rời địa chỉ governance; với một policy cho phép
  nơi đến tuỳ ý, kẻ tấn công đúc proposal vào script riêng rồi tự ghi `Executed`. Hai vế trùng giá
  trị ở v2 (§v2.4) nhưng không được gộp thành một phép kiểm.
- **`R-SEED-UNIQUE`.** `proposal_id` = tên tài sản = `H(seed)`, seed phải bị tiêu trong giao dịch
  đúc, qty 1, đúng một token của policy trong mint. Một `OutputReference` chỉ tiêu được một lần ⇒
  tên duy nhất vĩnh viễn trong policy. Cùng quy tắc cho `tally_policy`.
- **`R-NO-BURN`.** Token proposal và token tally không bao giờ bị đốt: mọi lượng âm của policy trong
  mint ⇒ từ chối. Chi phí của lựa chọn này ở §v2.9.
- **`R-DELAY` — độ trễ bắt buộc.** `Δ_min` là apply-param của governance mỗi pha, `> 0`, kiểm lúc
  biên dịch. Pha 1/2: tại Open, `execute_after_epoch ≥ vote_close_epoch + Δ_min`. Pha 0: tại
  `ExecuteCommittee`, `execute_after_epoch ≥ e + Δ_min`. Custody ép `epoch ≥ execute_after_epoch`
  (C-REL-8). Không có đường nào ghi `execute_after_epoch` nhỏ hơn.
- **`R-EPOCH`.** `ms_per_epoch` là apply-param của cả governance lẫn custody; hai giá trị phải
  **bằng nhau**, kiểm lúc biên dịch pha. Không đổi được trong đời một pha hay một instance. Lệch
  nhau ⇒ `execute_after_epoch` do governance ghi được custody đọc theo thang khác.
- **`R-TALLY-HASH` — niềm tin thuần tuý.** Reference input không chạy script: governance chỉ so
  địa chỉ của tally với `tally_script_hash`. Giá trị đó phải là hash của đúng script tally đã
  triển khai — kiểm lúc biên dịch pha bằng cách tính lại từ bản biên dịch và đối chiếu với reference
  script trên chuỗi. Không có phép kiểm nào trên chuỗi thay được bước này.
- **`R-NULLIFIER-PARAM`.** `nullifier(tally_policy, taad_policy, ms_per_epoch)` — toàn bộ là
  apply-param; `taad_policy` theo mạng, nướng vào hash, không đọc từ UTxO tham số. Governance nhận
  `nullifier_policy` làm apply-param. Cùng nguyên tắc §v2.2.
- **`R-WINDOW-DISJOINT`.** `MintNullifier` chỉ khi `vote_open ≤ e < vote_close`; `BurnNullifier` và
  `SumBatch` chỉ khi `e ≥ vote_close`. Hai cửa sổ rời nhau ⇒ không có lượt đúc lại sau khi đốt —
  đóng lỗi 4 (issue #88) ở tầng thiết kế.
- **`R-RESULT-SHAPE`.** Datum của UTxO proposal là **đúng** `ProposalResult` 5 trường ở mọi trạng
  thái và mọi pha; dữ liệu phiếu nằm ở datum tally. Bộ kiểm bắt buộc có ca: datum mà **validator
  thật ghi ra** (không phải bản dựng tay) giải mã được bằng bản sao kiểu Treasury. Lỗi 3 lọt vì
  thiếu đúng ca này.
- **`R-ADDR-PRESERVE`.** Mọi nhánh spend của governance và tally: output cùng địa chỉ với input (cả
  stake credential), cùng token xác thực, không reference script, không bơm token lạ.
- **`R-SWEEP-DELTA`.** `release.recipients_ok` cộng **mọi** output tới `to`. Khi `to` là địa chỉ
  một script có nhánh permissionless tiêu-rồi-trả-lại (như custody), người dựng giao dịch có thể
  tiêu một UTxO có sẵn ở đó và trả lại nguyên giá trị, khiến tổng output "đủ" trong khi khoản chi
  thật đi nơi khác. Nhánh nhận của custody k+1 (`[PHASE-SWEEP-INTAKE]`) phải ép
  `value_out − value_in` đúng bằng khoản chi và ghi đúng khoản đó vào sổ.
- **`R-REGISTRY-NOT-AUTHORITY`.** `PlatformEntry.governance_ref` trong registry Treasury là trường
  khả biến (`registry.ak` U-MUT) — chỉ là bản ghi tra cứu. Nguồn thẩm quyền là datum custody cộng
  apply-param của custody. Bên đọc off-chain phải đối chiếu với datum custody, không tin registry.

### v2.9 Rủi ro đã biết: proposal rác

Open là permissionless, và `R-NO-BURN` cấm đốt ⇒ mỗi proposal (Pha 1/2: thêm một tally) giữ vĩnh
viễn một UTxO có ADA tối thiểu. Proposal đã `Executed` và đã chi cũng không nhánh nào tiêu lại.
Hệ quả: ADA tối thiểu bị kẹt, tập UTxO phình, chỉ mục off-chain nhiễu.

Biện pháp trong v2:
- Chi phí mở (ADA tối thiểu + phí) do người mở trả; không nhánh nào lấy nó từ kho.
- Rác không chạm kho: Pha 0 chỉ committee đưa được proposal tới `Executed`; Pha 1/2 chỉ tally qua
  ngưỡng mới làm được việc đó.
- Chỉ mục off-chain lọc theo `status` và `proposal_id`.
- Phần còn treo — thu hồi UTxO đã kết thúc (đặt cọc hoàn lại khi đóng, hoặc nhánh đóng sau khi chi):
  `[PROPOSAL-CLOSE]`. Ràng buộc đã biết cho mọi lời giải: "đóng sau khi chi" đòi governance biết
  proposal đã được chi, nhưng theo §v2.4 governance không biết hash custody (custody phụ thuộc
  governance, không ngược lại).

### v2.10 Danh mục điểm mở

| Mã | Treo gì | Ràng buộc tạm thời đang có hiệu lực (fail-closed) | Khai ở |
|---|---|---|---|
| `[C2-SOURCE]` | C2 (LAMP cam kết) đọc từ nguồn on-chain nào | Pha 2 không được biên dịch; không bản `tally` nào nhận C2 | tệp này §v2.3; mô hình `VotingPower/CONTRACT.md` §1 |
| `[C3-ISSUER]` | bên phát hành NFT chứng thực C3 | không policy C3 nào được nướng vào `tally`; Pha 2 không được biên dịch | tệp này §v2.3 |
| `[IDENT-ONE-PERSON]` | một người k khoá ⇒ k anchor ⇒ k phiếu | ràng buộc tạm ở `VotingPower/CONTRACT.md` §3; Pha 1 đếm anchor, không được mô tả là đếm người | `VotingPower/CONTRACT.md` §3 |
| `[PHASE1-QUORUM]` | giá trị quorum Pha 1 | governance Pha 1 không được biên dịch khi chưa có giá trị; không có giá trị ngầm định | tệp này §v2.5 |
| `[SUMBATCH-EXUNIT]` | ExUnit mỗi lô `SumBatch`, cỡ lô, độ dài `tally_window`, và giao dịch quét kho §v2.7 | chưa đo; Pha 1 không triển khai mainnet trước khi đo trên testnet | tệp này §v2.6, §v2.7 |
| `[PHASE-SWEEP-INTAKE]` | custody chưa có nhánh nhận 100% theo `(bucket, asset)` từ instance tiền nhiệm | không proposal chuyển pha nào được đưa tới `Executed` | tệp này §v2.7 |
| `[PHASE-RESERVE-REPOINT]` | đường Reserve → custody ghim instance bằng apply-param (`reserve_gate`) | chuyển pha không được coi là hoàn tất khi đường Reserve còn trỏ instance cũ | tệp này §v2.7 |
| `[WEIGHT-PARAM-UPDATE]` | cập nhật `WeightParam` trong một pha | `WeightParam` đúc một lần lúc dựng pha, đặt ở địa chỉ không nhánh nào tiêu được; đổi bảng tham số = chuyển pha | tệp này §v2.5 |
| `[PROPOSAL-CLOSE]` | thu hồi UTxO proposal/tally đã kết thúc | cấm đốt, không có nhánh đóng | tệp này §v2.9 |
| `[SPEND-SPEC-INSTANCE]` | tiền ảnh `spend_spec_hash` sẽ gắn định danh custody instance (thay đổi phía Treasury) | governance tính theo `release.spend_spec_hash` hiện hành; đổi theo khi thay đổi được ghi vào `Treasury/CONTRACT.md` | `Treasury/CONTRACT.md` |

### v2.11 Mã v1 sẽ thay

| Tệp v1 | Số phận ở v2 |
|---|---|
| `validators/proposal.ak`, `validators/proposal_nft.ak` | thay bằng một validator `governance` hai mục đích mỗi pha |
| `validators/tally_nft.ak` | thay bằng `tally_policy` seed-unique |
| `validators/tally.ak` | giữ logic cộng/clamp; bỏ phụ thuộc Proposal v1; thêm `tally_window`, cửa sổ `SumBatch` |
| `validators/vote.ak` | bỏ `proposal_policy` và stub committee chứng thực DID; chỉ tiêu được trong `SumBatch` |
| `validators/nullifier.ak` | thêm anchor TAAD + cửa sổ; `BurnNullifier` chỉ sau `vote_close` |
| `lib/magiclamp/governance/{power,weight_guard,tally}.ak` | giữ (Pha 2) |
| `lib/magiclamp/governance/types.ak` | `ProposalResult`/`ProposalStatus` giữ nguyên byte; `ProposalDatum` 12 trường bỏ; `TallyDatum`, `VoteDatum` theo §v2.5 |

---

## ⚠️ DEPRECATED — công thức cũ `VP = (C1 × C2 × C3)^(1/3)`

Bản outline trước của file này (và `MAGIC-LAMP Tokenomic §12`) ghi:

```
VP = (C1 × C2 × C3)^(1/3)      ← KHÔNG DÙNG NỮA
```

Công thức này **bị thay thế** bởi mô hình trong CONTRACT:

```
VP_i = ∏_{k=1}^{K≥4}  min( C_{k,i}, cap_k )^( w_k )
```

Hai khác biệt cốt lõi khiến công thức cũ **vi phạm nguyên lý chống thâu tóm**:

1. **Cũ không có ngưỡng (cap)** → một yếu tố có thể tăng vô hạn → VP vô hạn → người đủ
   giàu/đủ tích lũy áp đảo cả cộng đồng (quay về tài phiệt).
2. **Cũ chỉ 3 yếu tố, mũ cố định `1/3`, thiếu C4 (LAMP nắm giữ) và thiếu weight DAO chỉnh.**

Phần dưới chứng minh vì sao mô hình mới tốt hơn, có cơ sở toán học.

---

## Đánh giá: mô hình nào tốt hơn, vì sao? (cơ sở toán học)

### Nhận diện toán học của công thức

Hàm `VP = ∏_k C_k^{w_k}` chính là một **hàm Cobb–Douglas** — dạng hàm sản xuất kinh điển trong
kinh tế học, mô tả sản lượng từ nhiều đầu vào **bổ trợ** nhau
([Cobb–Douglas](https://en.wikipedia.org/wiki/Cobb%E2%80%93Douglas_production_function)).
Công thức cũ `(C1·C2·C3)^{1/3}` chỉ là **trường hợp đặc biệt**: Cobb–Douglas 3 đầu vào, trọng số
bằng nhau `w_k = 1/3`, **không bão hòa**. Tức mô hình mới **bao trùm** (tổng quát hóa) mô hình cũ —
đặt `K=3, w_k=1/3, cap_k=∞` là ra lại công thức cũ. Vậy câu hỏi không phải "cái nào", mà là "có nên
thêm cap + weight + C4 không". Bốn tính chất toán dưới đây trả lời: **có**.

### 1. Tính bị chặn trên (bounded) — điều kiện sống còn

- **Cũ:** `lim_{C_k → ∞} (C1·C2·C3)^{1/3} = ∞`. Không có trần. Một cá nhân đẩy một yếu tố đủ lớn
  (vd dồn vốn vào một yếu tố mua được) → VP lớn tùy ý → có thể vượt tổng VP cộng đồng. Đây đúng là
  thất bại của **bỏ phiếu theo vốn** mà Buterin phê phán
  ([Moving beyond coin voting governance](https://vitalik.eth.limo/general/2021/08/16/voting3.html)).
- **Mới:** `min(C_k, cap_k) ≤ cap_k` nên `VP_i ≤ ∏_k cap_k^{w_k}` = **trần cứng, hữu hạn**, giống
  nhau cho mọi cử tri. Vượt cap là vô ích → không ai mua thêm quyền lực được. Đây là hàm **lợi ích
  cận biên giảm dần đến bão hòa**
  ([diminishing returns](https://en.wikipedia.org/wiki/Diminishing_returns)). **Bounded là điều kiện
  toán để câu "token đơn thuần không mua được quyền lực" thành đúng** — thiếu nó nguyên lý sụp.

### 2. Chống thâu tóm định lượng được (nhờ cap)

Gọi `VP_max = ∏_k cap_k^{w_k}`. Một thực thể nắm `H` LAMP muốn tối đa ảnh hưởng:
- **Không cap (cũ):** ảnh hưởng ∝ tăng theo `H` không giới hạn → 1 ví đủ giàu thắng.
- **Có cap (mới):** mỗi DID chỉ đạt tối đa `VP_max`; phần `H` vượt `cap_4 = 100 triệu` **vô giá trị
  về phiếu**. Muốn dùng hết `H = 12 tỷ` phải chia cho `≥ H/cap_4 ≈ 120` **DID người-thật**, mỗi DID
  còn phải có C1/C2/C3 thật (lịch sử tiêu MAGIC + cam kết + uy tín). Chi phí thâu tóm vì thế **= chi phí đóng
  góp thật** — **với điều kiện** một DID ứng đúng một người thật. Điều kiện đó hôm nay là **điểm
  treo chưa đóng** (`Governance/VotingPower/CONTRACT.md §3 [IDENT-ONE-PERSON]`): chưa có mệnh đề
  chứng thực trên chuỗi giới hạn số DID mỗi người, nên cổng cưỡng chế thật nằm ở NĂNG LỰC (VP),
  không phải ở việc tạo DID
  ([proof of personhood](https://en.wikipedia.org/wiki/Proof_of_personhood);
  [Sybil attack — Douceur 2002](https://www.microsoft.com/en-us/research/publication/the-sybil-attack/)).

### 3. Vì sao NHÂN (geometric) chứ không CỘNG (additive)

- **Cộng** `VP = Σ w_k C_k`: các yếu tố **thay thế** nhau. Ai mạnh tiền có thể max C4 + khóa LAMP đẩy
  C2 → **hai** yếu tố mua được, cộng dồn vẫn cao **dù uy tín C3 = 0**.
- **Nhân** (Cobb–Douglas): các yếu tố **bổ trợ**, không thay thế. Nếu `C3 → 0` thì `VP → 0` bất kể
  các yếu tố khác lớn cỡ nào (vì số mũ dương). Buộc cử tri mạnh **cả bốn** mặt → token đơn thuần
  bất lực. Nền tảng là bất đẳng thức **AM–GM**: trung bình nhân ≤ trung bình cộng, và trung bình
  nhân **phạt sự mất cân đối** ([AM–GM](https://en.wikipedia.org/wiki/AM%E2%80%93GM_inequality);
  [weighted geometric mean](https://en.wikipedia.org/wiki/Weighted_geometric_mean)).

### 4. Linh hoạt + mô-đun (weight DAO + thêm yếu tố)

- **Cũ:** mũ cứng `1/3`, 3 yếu tố cố định. Muốn đổi tầm quan trọng → phải sửa công thức (hard fork).
- **Mới:** `w_k` là **tham số DAO chỉnh** → cộng đồng hạ trọng số vốn (C4), nâng trọng số uy tín (C3)
  mà không đổi cấu trúc. Thêm yếu tố mới (`K` tăng) **không phá** tính bounded/monotonic — chứng minh
  ở [MATH](./VotingPower/Math-Spec.md). Nếu chuẩn hóa `Σ w_k = 1` thì VP là **trung bình nhân có trọng số**,
  giữ thứ nguyên, so sánh được giữa các cử tri.

### So với các mô hình quản trị khác

| Mô hình | Cơ chế | Điểm yếu | Tham chiếu |
|---|---|---|---|
| 1 token = 1 phiếu | phiếu ∝ số token | tài phiệt; mua phiếu | [Buterin 2021](https://vitalik.eth.limo/general/2021/08/16/voting3.html) |
| Quadratic voting | phiếu ∝ √token | vẫn mua được; cần chống sybil mạnh | [Quadratic payments — Buterin](https://vitalik.eth.limo/general/2019/12/07/quadratic.html); [Lalley–Weyl](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2003531) |
| 1 người = 1 phiếu | per-capita thuần | bỏ qua mức đóng góp; cần chống sybil | [proof of personhood](https://en.wikipedia.org/wiki/Proof_of_personhood) |
| **MagicLamp VP** | per-capita (1 DID) × Cobb–Douglas có cap trên ≥4 yếu tố đóng góp | phụ thuộc DID sinh trắc; cần chống collusion người-thật | [DeSoc / Soulbound — Weyl, Ohlhaver, Buterin](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4105763) |

**Kết luận:** mô hình mới tốt hơn vì nó **bao trùm** mô hình cũ và thêm đúng ba thứ mà nguyên lý
chống thâu tóm đòi hỏi về mặt toán — **cap** (để bounded), **công thức nhân** (để các yếu tố bổ trợ,
token không thay thế được uy tín), **weight DAO** (để tự điều tiết). Công thức cũ thiếu cap nên
**không thể** bảo đảm "token đơn thuần không mua được quyền lực" — đó là lý do bắt buộc thay.

---

## Phạm vi Governance còn lại (outline — chưa chi tiết hóa)

Nguồn: `MagicLamp-Docs/docs/Foundation-Bootstrap.md` (lưu ý: bản local hiện trống — cần đồng bộ).

- **iVoteSpace**: nền tảng proposal + bỏ phiếu on-chain (Cardano).
- **3 hội đồng**: Điều hành / Thành viên / Hiến pháp.
- **Bầu cử**: nhiệm kỳ, ứng cử, kiểm phiếu (trọng số theo VP ở trên).
- **Recall (bãi miễn)**: ngưỡng co-sign theo **đầu người** + vote theo **VP**; ngưỡng siêu đa số
  ghi dạng **"≥2/3"** (đạt-hoặc-vượt) để Team giữ 1/3 không phủ quyết được tầng 2/3. Con số là
  **tham số mở (DAO định)** — xem FEAT §loại quyết định.
- **KPI + thưởng** cuối nhiệm kỳ Executive Council bằng LAMP.

## Phụ thuộc

- **[IDENT-ONE-PERSON]** PhoenixKey DID sinh trắc + zk-proof "1 DID = 1 người" — backend PhoenixKey,
  **ngoài repo LAMP** (Claude không sửa). Blocker tiên quyết để Governance chạy thật; trạng thái
  đầy đủ + ràng buộc tạm thời fail-closed: `Governance/VotingPower/CONTRACT.md §3`.
- C1/C2 đọc từ repo **MAGIC** (MAGIC consumed, ScheduleGen commitment) qua reference input; C4 từ
  **LAMP**. Cross-repo — thiết kế ở [TECH](./VotingPower/Tech-Spec.md).
