# Governance — Quản trị Foundation (trang chỉ mục)

> ## ⚠️ CHƯA THÔNG QUA ĐƯỢC PROPOSAL — mã v2 + SDK đã có, nguồn C2/C4 chưa có
>
> Mã on-chain v2 (`governance`, `proposal`, `vote`, `tally`, `nullifier`, `weight_param_nft`,
> `proposal_nft`, `tally_nft` trong `onchain/validators/`) và SDK off-chain (`Governance/offchain/src/`
> — `openProposalBuilder.ts`, `voteBuilders.ts`, `tallyBuilders.ts`, `finalizeProposalBuilder.ts`)
> đã có; trạng thái từng tệp ở §v2.11. C1 đọc từ thread Engage của MAGIC khi `engage_policies` khác
> rỗng (`validators/tally.ak` ▸ `c_sources_ok`). C2, C4 vẫn bị ép `== 0` ⇒ VP (tích nhân) = 0 ⇒
> `FinalizeProposal` chỉ ra `Rejected` (`[VP-ZERO-FACTOR]`). Đường chi tiền vẫn đóng
> (`[GOV-FINALIZE-BRANCH]`). Custody trỏ tới governance qua NFT con trỏ
> (`Treasury/GovernancePointer.md` v0.2), nên dựng lại governance không đúc lại kho.
>
> Repo này Apache-2.0 công khai. Nếu bạn đang tìm một nền governance dùng được cho
> Cardano thì **đây chưa phải**. Đừng đọc `Governance/` để suy ra Treasury Release đã
> khép vòng — nó chưa.
>
> Theo dõi ở issue #21 mục C.

> **Phiên bản:** v2.1 — 2026-10-04. **Vì sao bump phụ:** tài liệu theo kịp mã, không đổi interface
> Governance→Treasury — khối cảnh báo đầu tệp và §Kiến trúc on-chain v2 bỏ "chưa có mã/không có
> `offchain/`"; C1 đã có nguồn (`tally` thêm apply-param CUỐI `engage_policies`, 2026-10-03), mã
> treo `[C1-C2-C4-SOURCE]` đổi thành `[C2-C4-SOURCE]`; định nghĩa epoch theo
> `Specs/Window/CONTRACT.md` v1.1 §1 (tham số `window_origin_ms`); thứ tự apply-param `tally` 10
> tham số ở `[C3-ISSUER]`.
> v2.0 — 2026-09-27. **Vì sao bump chính:** thêm
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

**Trạng thái:** đã có mã on-chain v2 và SDK off-chain (`Governance/offchain/src/`); trạng thái từng
tệp v1 → v2 ở §v2.11 (`proposal.ak`, `proposal_nft.ak` còn cho Pha 0). Mô hình Voting Power (công thức, cap, trọng số) vẫn thuộc
[`VotingPower/CONTRACT.md`](./VotingPower/CONTRACT.md) v1.1; mục này chỉ định hình dạng on-chain.

Quy ước trong mục này:
- **epoch** = `⌊(posix_ms − window_origin_ms) / ms_per_epoch⌋` (`Specs/Window/CONTRACT.md` v1.1 §1;
  mã: `Governance/onchain/lib/magiclamp/governance/util.ak` ▸ `get_epoch`, `get_epoch_bounded`;
  `Treasury/onchain/lib/magiclamp/treasury/util.ak` ▸ `get_epoch_bounded`). Trên mọi mạng (Mainnet,
  Preprod, Preview) chỉ số này = số epoch Cardano, biên trùng biên epoch (`Specs/Window/CONTRACT.md`
  v1.2 §1–§2). `window_origin_ms` là apply-param CUỐI của `nullifier`, `vote`, `proposal`, `governance`,
  và của `tally` (đứng TRƯỚC `engage_policies`) — danh sách đầy đủ ở `Specs/Window/CONTRACT.md` v1.2
  §5; các bảng apply-param bên dưới không chép lại tham số này.
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
| 4 | Nullifier đốt được trong khi cửa sổ bỏ phiếu còn mở | `nullifier.ak` ▸ nhánh `BurnNullifier` chỉ đòi có token `tally_policy` bị tiêu (`tally_spent`), không đòi cửa sổ đã đóng | đốt rồi đúc lại cùng tên ⇒ một DID hai phiếu (issue #88). **ĐÃ VÁ ở Pha 1/2, nhưng vá HAI LẦN**: bản v2 đầu tiên ép `e ≥ vote_close` mà đọc mốc từ một tally BẤT KỲ, nên cửa sổ vẫn hở qua một tally cũ của proposal khác; chốt B2 (§v2.5) mới đóng hẳn |

Lỗi 1–2 không vá được bằng cách chỉ đổi tham số: một policy chung mà không có quy tắc sinh tên duy
nhất thì mất tính duy nhất của `proposal_id` — đúng lỗ F11 mà `Treasury/Tech-Spec.md` đã ghi là
"van quy trình Governance". v2 đóng F11 bằng mật mã (§v2.8 `R-SEED-UNIQUE`).

**Trạng thái vá của bốn lỗi** (neo vào mã, không vào bảng trên):

| # | Trạng thái | Neo |
|---|---|---|
| 1 | CÒN MỞ ở Pha 0 (`proposal_nft` v1 chưa thay) | `Governance/onchain/validators/proposal_nft.ak` ▸ `validator proposal_nft` vẫn nhận `genesis_ref, asset_name` |
| 2 | ĐÃ VÁ | `Governance/onchain/validators/tally_nft.ak` ▸ `validator tally_nft(_phase_tag)`, redeemer `MintTally { seed }`, tên tài sản ép bằng `names.ak` ▸ `proposal_id_of` |
| 3 | ĐÃ VÁ ở Pha 1/2, CÒN MỞ ở Pha 0 | `validators/governance.ak` ▸ `spend` nhận và ghi ra ĐÚNG `ProposalResult` 5 trường ở mọi trạng thái (`R-RESULT-SHAPE`), nên beacon Treasury đọc được; `validators/proposal.ak` v1 của Pha 0 vẫn ghi `ProposalDatum` 12 trường |
| 4 | ĐÃ VÁ | `validators/nullifier.ak` ▸ `burn_with_tally_spent` (đòi `e ≥ vote_close_epoch`) và `burn_after_tally_window`; cả hai cửa sổ đốt nằm NGOÀI cửa sổ đúc ⇒ đúc-lại-sau-khi-đốt bất khả về số học |

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
datum, do một bên phát hành được quản trị (bên nào: `[C3-ISSUER]`). **Hai** apply-param của `tally`
Pha 2 định nghĩa nó: `c3_policy` (ai đúc) và `c3_script_hash` (nơi giữ). Vế thứ hai là vế quyết định
— datum do người TẠO UTxO viết, nên token một mình không nói ai viết con số nằm cạnh nó
(`R-C3-ADDR` §v2.8).

### v2.4 Đồ thị phụ thuộc hash — thứ tự biên dịch không vòng

"A nhận hash của B làm apply-param" nghĩa là B phải biên dịch trước A. Thứ tự sau không có vòng:

```
tally_policy            weight_param_policy (Pha 2)       (không phụ thuộc gì)
   │                          │
   ├─► nullifier(tally_policy, taad_policy, ms_per_epoch, tally_window_epochs)
   ├─► vote(tally_policy, nullifier_policy)
   └─► tally(tally_policy, vote_script_hash, nullifier_policy,
             weight_param_policy, c3_policy, c3_script_hash,
             tally_window, ms_per_epoch)
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
  KHÔNG bao giờ sinh ra một proposal (seed của nó đã bị tiêu, nên không tồn tại proposal cùng tên),
  nhưng nó KHÔNG vô hại: nó dựng được một tally có datum bịa để hút phiếu. Khai đầy đủ ở
  `[TALLY-TOKEN-OUTSIDE-OPEN]` §v2.10.
- `c3_script_hash` thêm một cạnh **đi RA NGOÀI kho này**: script giữ NFT chứng thực C3 phải được
  biên dịch (và hash của nó phải chốt) TRƯỚC `tally` Pha 2. Không tạo vòng, vì script đó không nhận
  hash nào của Governance. Cho tới khi `[C3-ISSUER]` có lời giải thì Pha 1 áp `c3_policy = #""` và
  giá trị của `c3_script_hash` không đi vào nhánh nào (cổng rẽ nhánh theo `c3_policy == #""`) — vẫn
  phải khai một giá trị vì nó nằm trong hash, và khai `#""` là lựa chọn đúng: nó làm cấu hình lệch
  (`c3_policy != #""` với `c3_script_hash == #""`) tự khoá thay vì im lặng nhận chứng thực từ ví
  thường.
- `phase_tag` (một chuỗi byte khác nhau cho mỗi pha) nằm trong apply-param của các policy không phụ
  thuộc gì, để hai pha không bao giờ trùng policy id.

### v2.5 Bảng validator

| Tên | Loại | Pha | Apply-param | Datum | Nhánh |
|---|---|---|---|---|---|
| `governance` | mint + spend | 0 | `committee_keys` (3 khoá, đôi một khác nhau), `committee_threshold` = 2, `delta_min_epochs` (> 0), `ms_per_epoch`, `phase_tag` | `ProposalResult` (5 trường, byte-khớp Treasury) | **CHƯA CÓ MÃ — hàng này là THIẾT KẾ, không phải trạng thái.** Pha 0 hiện chạy trên v1 `validators/proposal.ak` + `validators/proposal_nft.ak`. Đọc ở chữ ký `validator governance(` (`validators/governance.ak`): `governance` có đúng một bản, apply-param là `tally_policy, tally_script_hash, weight_param_policy, ms_per_epoch, delta_min_epochs, recovery_timelock_epochs, _phase_tag` (+ `window_origin_ms` cuối) — KHÔNG có `committee_keys`/`committee_threshold`, tức bản Pha 0 chưa được biên dịch. Nhánh dự kiến: mint `OpenProposal { seed }` · spend `ExecuteCommittee` |
| `governance` | mint + spend | 1, 2 | `tally_policy`, `tally_script_hash`, `weight_param_policy`, `ms_per_epoch`, `delta_min_epochs`, `recovery_timelock_epochs`, `phase_tag` | `ProposalResult` | mint `OpenProposal { seed, vote_open_epoch, vote_close_epoch, weight_param_ref }` · spend `FinalizeProposal` |
| `tally_nft` (= `tally_policy`) | mint | 1, 2 | `phase_tag` | — | `MintTally { seed }`: tiêu `seed`, đúng 1 TÊN tài sản, tên = `H(seed)`, qty 1; mọi lượng âm ⇒ từ chối |
| `tally` | spend | 1, 2 | `tally_policy`, `vote_script_hash`, `nullifier_policy`, `weight_param_policy`, `c3_policy`, **`c3_script_hash`**, `tally_window_epochs`, `ms_per_epoch`, **`engage_policies`** (THỨ TỰ ÁP đúng như liệt kê — `c3_script_hash` chèn NGAY SAU `c3_policy`; `engage_policies` đứng CUỐI, ngay sau `window_origin_ms`; `[]` = pha chưa bật C1) | `TallyDatum` v2 — 15 trường, thứ tự CBOR: `proposal_id`, `phase`, `weight_param_ref`, `yes/no/abstain_power_raw`, `voters_acc`, `yes_voters_acc`, `top_did_vp`, `yes/no/abstain_power_eff`, `vote_open_epoch`, `vote_close_epoch`, `voted_root` | `SumBatch { insert_proofs }` · `Finalize` |
| `vote` | spend | 1, 2 | `tally_policy`, `nullifier_policy`, `taad_policy`, `ms_per_epoch`, `tally_window_epochs` | `VoteDatum` v2 — 8 trường: `proposal_id`, `did_commit`, `nullifier`, `choice`, `c1..c4_capped` | `ConsumeForTally { book_proof }` · `RetractVote` · `ReclaimVote` |
| `nullifier` | mint | 1, 2 | `tally_policy`, `taad_policy`, `ms_per_epoch`, `tally_window_epochs` | — | `MintNullifier { did_commit, proposal_id }` · `BurnNullifier { proposal_id, did_commits }` |
| `weight_param_nft` (= `weight_param_policy`) | mint | 2 | `seed_ref`, `phase_tag`, `bft_floor_min`, `bft_floor_max`, `quorum_voters_min` | — (output nó đánh dấu mang datum `WeightParam` 9 trường) | `MintWeightParam`: đúc một lần lúc dựng pha (`[WEIGHT-PARAM-UPDATE]`), kèm trọn bộ cổng bảng tham số |
| `custody` (Treasury) | spend | mọi pha | `pointer_policy`, `seed_policy`, `ms_per_epoch`, `lamp_policy`, `token_name` (nguồn: `Treasury/CONTRACT.md` v1.2 §1) | `CustodyDatum` (có `governance_ref`) | không đổi ở v2, trừ `[SPEND-SPEC-INSTANCE]` và `[PHASE-SWEEP-INTAKE]` |

Điều kiện từng nhánh:

- **`OpenProposal`** (mọi pha, permissionless): tiêu `seed`; mint của policy này chứa đúng một token,
  tên `H(seed)`, qty 1; đúng một output tại địa chỉ governance (payment = `Script(hash governance)`)
  mang token đó, datum `ProposalResult { proposal_id: H(seed), status: Open, spend_spec_hash,
  execute_after_epoch, released_cumulative: 0 }`, không reference script.
  - Pha 0: Open ghi `execute_after_epoch = 0`; giá trị thật do `ExecuteCommittee` ghi (custody chỉ
    đọc trường này khi `status == Executed`).
  - Pha 1/2: cùng giao dịch phải đúc token `(tally_policy, H(seed))` đặt tại `tally_script_hash` với
    `TallyDatum` khởi tạo; `vote_open_epoch ≥ e`; `vote_close_epoch > vote_open_epoch`;
    `execute_after_epoch ≥ vote_close_epoch + Δ_min`; `weight_param_ref` trỏ đúng một UTxO mang
    token `weight_param_policy`, **datum của nó giải được thành `WeightParam`, thoả cổng D8
    (`weight_guard.d8_ok`) và có `bft_floor ≥ 1`** — đây là chỗ D8 được ép trên đường đi của một
    PROPOSAL, vì nhánh này là lần ĐẦU TIÊN một proposal chạm bảng tham số (`tally ▸ SumBatch` cố ý
    KHÔNG chạy lại D8, xem `[SUMBATCH-EXUNIT]`); `spend_spec_hash == #""` (ràng buộc tạm của `[SELF-DUP-CHOICE]`);
    `vote_close_epoch − vote_open_epoch < recovery_timelock_epochs` (`[DID-RECOVERY-TRUST]`); và
    `tx.mint` chứa ĐÚNG hai policy (`governance` + `tally_policy`), không policy thứ ba.
    `TallyDatum` khởi tạo bị ghim TOÀN BỘ, không chỉ các bộ đếm: `proposal_id == H(seed)`,
    `phase == Summing`, sáu trường power = 0, `voters_acc = yes_voters_acc = 0`,
    `top_did_vp == []`, `weight_param_ref` khớp redeemer, hai mốc cửa sổ khớp redeemer, và
    `voted_root` = gốc cây MPF RỖNG (`mpf.root(mpf.empty)` = 32 byte 0). Vế `top_did_vp == []` và
    vế sổ rỗng đều là vế TẤN CÔNG, không phải vệ sinh: một entry heap nạp sẵn đi thẳng vào phép
    clamp ở `Finalize` mà không ứng phiếu nào; một `did_commit` ghi sẵn vào sổ làm DID đó không
    chèn được phiếu nào nữa (`mpf.insert` bác khoá đã có) ⇒ bị loại khỏi cuộc bỏ phiếu.

  **Chi phí thực thi đo được, không ước lượng** (2026-09-29, bảng knots **8 mốc thật**, `bft_floor`
  21; `validators/exunit_test.ak` ▸ `gov_open_run` − `gov_open_base`): `mem 4 708 501 · cpu
  1 491 124 779`, tức **33,6 % trần mem (14 000 000)** và **14,9 % trần cpu (10 000 000 000)** — lấy
  biên 20 % như `[SUMBATCH-EXUNIT]` thì là 42,0 % ngân sách mem an toàn. **Cổng D8 chiếm 77,7 % khoản
  đó:** `weight_guard.d8_ok` đo RIÊNG trên cùng bảng, trong cùng lần chạy (`gov_open_d8_run` −
  `gov_open_d8_base`) là `mem 3 656 890 · cpu 1 155 836 048`; phần Open còn lại là `mem 1 051 611`.
  Đó là giá của việc D8 rời đường nóng, và nó là cái giá ĐÚNG: nhánh này trả nó một lần cho cả đời
  một proposal, `tally ▸ SumBatch` trước đây trả nó mỗi lô (`[SUMBATCH-EXUNIT]` mục (a)). Nhánh
  không có vòng lặp theo số phiếu — số bước chỉ phụ thuộc số MỐC của bảng — nên con số không tăng
  theo quy mô cuộc bỏ phiếu; bảng dài hơn 8 mốc thì phải đo lại. Đọc như **cận trên gần**: cách đo
  gọi thẳng handler, ở `SumBatch` nó cao hơn ExUnit thật của Emulator 9–12 %.
- **`ExecuteCommittee`** (Pha 0): tiêu proposal `Open`; `extra_signatories` chứa ≥ 2 khoá khác nhau
  trong `committee_keys`; đúng một output cùng địa chỉ (cả stake credential), cùng value, không
  reference script; datum ra giữ nguyên `proposal_id`, `spend_spec_hash`, `released_cumulative`;
  `status = Executed`; `execute_after_epoch ≥ e + Δ_min`. Committee **không** sửa được
  `spend_spec_hash` — thứ được ký là thứ đã mở công khai ở Open.
- **`FinalizeProposal`** (Pha 1/2) — nhánh `spend` của `governance`. Đây là chỗ DUY NHẤT ngưỡng
  thông qua được ép: theo `VotingPower/CONTRACT.md` v1.1 §5 D3 (Release-gate = Model A), Treasury
  KHÔNG tự tính ngưỡng, nó chỉ kiểm `status == Executed` + Proposal NFT + `spend_spec_hash` +
  time-lock. Nhánh này lỏng một lần thì không tầng nào phía sau bắt lại.

  | mã | điều kiện |
  |---|---|
  | S1 | datum vào có `status == Open`. Vế này cũng là thứ khoá proposal đã kết thúc: `Executed`/`Rejected` không khớp nhánh nào (`[PROPOSAL-CLOSE]`) |
  | S2 | đúng 1 input + 1 output tại script governance (chống double satisfaction — một tally qua ngưỡng không được thoả cho nhiều proposal) |
  | S3 | NFT `(governance_policy, proposal_id)` qty 1 ở CẢ hai đầu, và đúng một TÊN tài sản của policy đó trong input. `policy_id` lấy bằng hash script của chính input đang tiêu, không bằng một apply-param tự khai — `governance` là script hai mục đích nên hai giá trị bằng nhau theo định nghĩa |
  | S4 | `out.value == inp.value`, `out.address == inp.address` (cả stake credential), `reference_script == None` |
  | S5 | `tx.mint == 0` |
  | S6 | `e ≥ execute_after_epoch`. Custody ép lại ở lượt CHI (C-REL-8); ép ở đây để `Executed` không TỒN TẠI trên chuỗi trước mốc đó — đó là lời hứa về thời gian phản đối |
  | S7 | Tally của đúng `proposal_id`, đọc qua reference input theo TOKEN **và** ghim địa chỉ `Script(tally_script_hash)` (`R-TALLY-HASH`), với `phase == Clamped`. `Summing` mang power CHƯA clamp — đọc ngưỡng trên số chưa clamp là đúng lỗ GAME-1 |
  | S8 | `WeightParam` đọc theo `TallyDatum.weight_param_ref` — ref đã cam kết lúc Open, KHÔNG phải ref trong redeemer (audit Finding 1); `bft_floor ≥ 1`; cổng D8 ép ở nhánh này qua `weight_ref.read_weight_param` (bản CÓ D8). Bốn chỗ ép D8: `weight_param_nft ▸ mint` (cổng THẬT, nơi bảng sinh ra và là nơi DUY NHẤT ép θ/`bft_floor`/quorum) · `governance ▸ OpenProposal` · nhánh này · `tally ▸ Finalize`. Đường NÓNG `tally ▸ SumBatch` dùng `read_weight_param_skip_d8` — lập luận đóng + số đo ở `[SUMBATCH-EXUNIT]` |
  | S9 | datum ra là `ProposalResult`, CHỈ `status` đổi: `proposal_id`, `spend_spec_hash`, `released_cumulative`, `execute_after_epoch` ghim y nguyên; `spend_spec_hash == #""` ép LẠI ở đây (`[SELF-DUP-CHOICE]` — Open không phải cửa duy nhất); `status = Executed` khi `pass` canonical đúng, `Rejected` khi sai — ép ĐÚNG phán quyết, không phải "một trong hai" |

  `pass` canonical là biểu thức DUY NHẤT, hiện thực ở `lib/magiclamp/governance/tally.ak` ▸ `pass`,
  khớp `VotingPower/Tech-Spec.md` §9.4 và `CONTRACT.md` v1.1 §5 D1:
  `yes_voters_acc ≥ bft_floor` ∧ `total_vp_eff ≥ quorum_vp_threshold` ∧
  `voters_acc ≥ quorum_voter_threshold` ∧ `yes_power_eff · θ_den ≥ (yes_power_eff + no_power_eff) · θ_num`.
  Abstain NẰM TRONG mẫu của quorum-VP và NẰM NGOÀI mẫu của θ.

  **Một chỗ dư thừa CÓ CHỦ Ý, ghi ra để không ai "dọn" nhầm.** Hai vế số lượng NFT của S3 (đầu vào
  và đầu ra) là một CẶP dư thừa dưới S4: `out.value == inp.value` kéo theo hai vế đó tương đương
  nhau, nên gỡ một vế bất kỳ KHÔNG đổi hành vi của validator (đo bằng đột biến: gỡ riêng từng vế thì
  toàn bộ bộ kiểm còn xanh; gỡ CẢ HAI thì `fin_nhan_ban_nft_tu_choi` đỏ). Giữ cả hai là cố ý — ai bỏ
  S4 sau này để nới value (ví dụ cho phép nạp thêm ADA) thì hai vế đó lập tức hết tương đương, và
  thiếu một vế là beacon ra không còn được ép mang NFT. Đừng gỡ theo hướng "không bài nào canh".

  **Nhánh này KHÔNG chi một đồng nào, và đó là ràng buộc chứ không phải thiếu sót.** Nó ghim
  `spend_spec_hash == #""`; `Treasury/onchain/lib/magiclamp/treasury/release.ak` ▸ `spend_spec_hash`
  so hash canonical của danh sách chi với trường đó, và không danh sách chi nào băm ra chuỗi rỗng ⇒
  mọi lượt `Release` bị từ chối. Hình dạng beacon khớp đúng cái Treasury đọc:
  `release.read_proposal` đòi reference input tại `Script(governance_ref)`, đúng một token
  `proposal_policy`, `nft_name == result.proposal_id`, datum `ProposalResult` 5 trường — cả bốn vế
  đều được S3/S4/S9 giữ nguyên qua lượt ghi kết quả.

  **Chi phí thực thi đo được, không ước lượng.** Đường đi đầy đủ (`fin_qua_nguong_ghi_executed`,
  `aiken check -m fin_`): `mem 1,14 M · cpu 363,62 M` — so với trần mỗi giao dịch
  `mem 14 M · cpu 10 000 M` là **≈ 8,2 % bộ nhớ · ≈ 3,6 % bước tính**. Nhánh này duyệt số bước cố
  định (không có vòng lặp theo số phiếu: nó đọc MỘT tally đã `Clamped` và MỘT bảng tham số), nên con
  số không tăng theo quy mô cuộc bỏ phiếu. Đây là lý do việc gộp toàn bộ ngưỡng vào một nhánh duy
  nhất không tạo rủi ro ExUnit — khác hẳn `SumBatch`, chỗ chi phí tỉ lệ với cỡ lô (`[SUMBATCH-EXUNIT]`).
  **KHÔNG so trực tiếp con số này với số của `OpenProposal` ở §v2.5:** nó đo trên bảng knots **2 mốc**
  của `validators/governance.ak` (`wp_datum` ▸ `lin_knots`), còn số Open đo trên bảng **8 mốc**. Nhánh
  này cũng chạy `read_weight_param` bản CÓ D8 (S8), nên ở bảng 8 mốc nó sẽ đắt thêm xấp xỉ đúng khoản
  D8 đã đo ở §v2.5. Đo lại ở 8 mốc là việc CHƯA làm.
- **`SumBatch { insert_proofs }`** (Pha 1/2, permissionless): `vote_close_epoch ≤ e <
  vote_close_epoch + tally_window_epochs`; tiêu tally và k UTxO tại `vote_script_hash`, mỗi UTxO mang
  đúng một token `nullifier_policy` có tên `blake2b_256(did_commit ‖ proposal_id)` khớp datum của nó;
  `k ≥ 1`; đốt đúng k token đó; power tính LẠI từ đầu vào C1–C4 qua bảng knots, không tin số khai;
  cộng dồn theo `choice`; heap top-(F−1) canonical; hai mốc cửa sổ GHIM y nguyên; và **sổ DID**:
  `voted_root` ra = kết quả chèn lần lượt `(did_commit → nullifier)` của trọn lô vào `voted_root`
  vào, mỗi lần một phần tử của `insert_proofs` (`R-BOOK-MPF` §v2.8).

  Chứng thực C3 phải nằm tại `Script(c3_script_hash)` — token một mình KHÔNG đủ (`R-C3-ADDR`
  §v2.8). Và `utxo_preserved` (dùng chung với `Finalize`) ép năm thứ trên acc: đúng 1 input + 1
  output tại script tally · acc VÀO mang đúng `(tally_policy, proposal_id)` của chính datum nó
  khai · đúng 1 đơn vị NFT ở acc RA · `value` và địa chỉ đầy đủ bảo toàn · acc RA **không có
  reference script** (`R-ADDR-PRESERVE`).
- **`Finalize`** (tally): `e ≥ vote_close_epoch + tally_window_epochs`; `bft_floor ≥ 1`;
  `Summing → Clamped` kèm clamp BFT (`tally_lib.clamp_consistent`); GHIM y nguyên mọi trường
  power/đếm/heap **và** `vote_open_epoch`, `vote_close_epoch`, `voted_root`. Vế ghim `voted_root` là
  bắt buộc: thiếu nó thì chính `Finalize` ghi lại sổ tuỳ ý và lớp "phiếu phải có trong sổ" của `vote`
  bị vô hiệu hoá.
  Tên hai pha trong mã là `Summing` / **`Clamped`** (`types.ak` ▸ `TallyPhase`); bản SPEC trước ghi
  `Final` — mã thắng, tên đúng là `Clamped`.
- **`ConsumeForTally { book_proof }`** (vote): tên token nullifier của phiếu = `H(did_commit ‖
  proposal_id)`, đúng một tên và một đơn vị trong input; token bị ĐỐT trong cùng giao dịch và không
  output nào tại script phiếu còn giữ nó; token `(tally_policy, proposal_id)` bị TIÊU cùng giao dịch;
  và `book_proof` chứng minh `(did_commit → nullifier)` CÓ TRONG `voted_root` của **Tally output**.
  Vế cuối làm việc "tiêu huỷ phiếu chưa đếm" bất khả về cấu trúc.
- **`RetractVote`** (vote): `e < vote_close_epoch` (tally đọc qua reference input); đúng 1 input và 1
  output tại script phiếu; anchor TAAD của `did_commit` Active + Person gốc + hai chữ ký chính chủ;
  value và địa chỉ đầy đủ bảo toàn, không reference script; CHỈ `choice` đổi và PHẢI đổi thật;
  `tx.mint == 0`.
- **`ReclaimVote`** (vote): `e ≥ vote_close_epoch + tally_window_epochs`; đúng 1 input tại script
  phiếu; chữ ký chính chủ như trên; nullifier bị đốt và không output nào tại script phiếu giữ lại nó.
  Không có nhánh này thì mọi phiếu không được ai gom chết vĩnh viễn, và "không gom phiếu của một
  nhóm" thành đòn bẩy: nhóm đó mất phiếu VÀ mất cọc.
- **`MintWeightParam`** (`weight_param_nft`, Pha 2): tiêu `seed_ref`; đúng một TÊN tài sản của
  policy, tên = `phase_tag`, qty 1, và `tx.mint` chỉ có MỘT policy; đúng MỘT output giữ NFT đó, tại
  `Script(policy_id)`, không reference script; datum giải được thành `WeightParam` và thoả:
  `1 ≤ theta_num ≤ theta_den`, `2·theta_num ≥ theta_den`,
  `bft_floor_min ≤ bft_floor ≤ bft_floor_max`, `quorum_voter_threshold ≥ quorum_voters_min`,
  `quorum_vp_threshold ≥ 1`, và cổng D8 (`weight_guard.d8_ok`). Preprod chốt:
  `bft_floor_min = 21`, `bft_floor_max = 64`, `quorum_voters_min = 21`.
- **`MintNullifier`** (Pha 1/2): `did_commit` và `proposal_id` mỗi cái ĐÚNG 32 byte (`R-PREIMAGE-32`
  §v2.8); đúng một token, tên `blake2b_256(did_commit ‖ proposal_id)`, qty 1;
  reference input mang `(tally_policy, proposal_id)` và `vote_open_epoch ≤ e < vote_close_epoch`
  đọc từ datum của nó; `tx.mint` chỉ có MỘT policy; đúng một reference input mang
  `(taad_policy, did_commit)` **và nằm tại địa chỉ `Script(taad_policy)`**; datum anchor đọc theo
  CHỈ SỐ trên `Data` (`lib/magiclamp/governance/anchor_view.ak`, bản chép có nhãn kho nguồn + sha
  + ngày):

  | chỉ số | trường | dùng để |
  |---|---|---|
  | 1 | `entity_type` | A-PERSON: phải là `Constr 0` (`Person`) |
  | 2 | `controller_pkh` | chữ ký bắt buộc |
  | 5 | `status` | phải là `Constr 0` (`Active`) |
  | 7 | `parent_did` | A-PERSON: phải là `Constr 1` (`None`) |
  | 13 | `depth` | A-PERSON: phải `== 0` |
  | 14 | `device_pkh` | chữ ký bắt buộc |
  | 15 | `aux_device_pkhs` | danh sách khoá thiết bị phụ; chữ ký ở trường 14 **hoặc** một khoá trong danh sách này đều thoả vế "khoá thiết bị" |

  Trường 15 trước nay không được SPEC nhắc tới; nó nới vế chữ ký thiết bị và phải khai ra, vì bản
  chép của anchor đọc nó.
  **A-PERSON** (ba vế ghép bằng AND) chặn đường một người thật đúc k DID con rồi bỏ k phiếu — không
  có nó thì "cử tri = cá nhân" chỉ là một câu trong tài liệu.
  `did_commit = blake2b_256(UTF8(did))`, không băm lần hai. Token nullifier nằm ở đâu thì policy
  không kiểm (vòng phụ thuộc); `SumBatch` chỉ đếm token nằm tại `vote_script_hash` — đặt sai chỗ là
  tự mất phiếu, và không đúc lại được.
- **`BurnNullifier { proposal_id, did_commits }`** — hai chốt, ghép AND:

  | mã | điều kiện |
  |---|---|
  | B1 | tập tên token của policy trong `tx.mint` **đúng bằng** `{ blake2b_256(d ‖ proposal_id) : d ∈ did_commits }`, mỗi tên đúng −1. Ép bằng MỘT phép so đẳng thức dict, nên nó ép cùng lúc năm thứ: đốt thuần (mọi qty = −1) · đủ tên · không thừa tên lạ · không thừa tên của proposal khác · `did_commits` không có phần tử trùng (trùng thì cộng dồn thành −2 và đẳng thức bác) |
  | B2 | căn cứ thời gian đọc từ Tally của **ĐÚNG `proposal_id` đó**, một trong hai đường: (a) Tally của `proposal_id` bị TIÊU cùng giao dịch và `e ≥ vote_close_epoch` — đường của `SumBatch`; (b) Tally của `proposal_id` đọc qua REFERENCE input và `e ≥ vote_close_epoch + tally_window_epochs` — đường của `ReclaimVote`, cần thiết vì sau `Finalize` không nhánh nào tiêu được tally nữa |

  **Vì sao B2 phải ghim `proposal_id`, và vì sao bản trước SAI ở đúng chỗ này.** Bản trước đọc căn
  cứ từ "một tally BẤT KỲ" rồi kết luận hai cửa sổ rời nhau. Kết luận đó không đúng: `tally_policy`
  là one-shot theo **PHA**, nên mọi proposal của pha dùng CHUNG policy đó và khác nhau ở TÊN token ⇒
  một tally CŨ đã quá hạn thoả `e ≥ vote_close` với **mọi** `e`, kể cả `e` nằm giữa cửa sổ bỏ phiếu
  của proposal đang bị đốt nullifier. Đo bằng ca chạy thật:
  `nl_burn_muon_tally_proposal_khac_ref_tu_choi` (đường b) và
  `nl_burn_muon_tally_proposal_khac_tieu_tu_choi` (đường a) — hai ca này ĐỎ trên bản trước, XANH sau
  khi có B2. Đường (a) đặc biệt dễ dựng vì `tally ▸ Finalize` không ràng buộc `tx.mint` chút nào,
  nên một lượt đóng sổ của proposal cũ chở được lượt đốt của proposal đang mở.

  **Hậu quả thực tế của lỗ đó: KHÔNG khai thác được, và phải nói rõ vì sao** — nó là lỗi phòng-thủ-
  theo-lớp, không phải lỗ đang mở. Nullifier nào quan trọng thì đang nằm trong một UTxO phiếu tại
  `vote_script_hash`, và đốt nó buộc phải TIÊU UTxO đó, tức phải qua `vote ▸ spend`: `ConsumeForTally`
  đòi Tally của đúng proposal bị tiêu cùng tx (V4) — mà `tally ▸ SumBatch` đòi `e ≥ vote_close`;
  `ReclaimVote` đòi `e ≥ vote_close + tally_window` (C2); `RetractVote` đòi `tx.mint == 0`. Ba ca
  `dot_giua_cua_so_consume_do` · `dot_giua_cua_so_reclaim_do` · `retract_len_dot_nullifier_tu_choi`
  ghim ba vế đó. Thứ còn đốt được là nullifier LỎNG — token chủ nó tự giữ trong ví, chưa gửi vào UTxO
  phiếu; đốt nó không mất gì của ai, và đúc lại ra ĐÚNG cùng một tên (`H(did ‖ proposal_id)` tất
  định) nên không sinh thêm quyền bỏ phiếu nào. Một DID đếm tối đa một lần vẫn do sổ MPF
  `voted_root` ép, không do token (§v2.3). **Nghĩa là trước khi vá, chốt thật sự chặn nằm ở `vote`
  chứ không ở `nullifier` — và đó đúng là thứ không được để nguyên: `vote` thêm một nhánh, hoặc
  nullifier lỏng trở nên có ích, là lỗ thành lỗ sống.**

  Với B1 + B2 thì tính rời nhau mới là SỐ HỌC: `MintNullifier` đòi `e < vote_close_epoch` đọc từ
  Tally của `proposal_id`, `BurnNullifier` đòi `e ≥ vote_close_epoch` đọc từ Tally của CÙNG
  `proposal_id`, và `e` là MỘT số ⇒ đốt-rồi-đúc-lại trong cửa sổ bất khả (`R-WINDOW-DISJOINT`).

  **Chi phí.** B1 băm lại một lần cho mỗi DID trong lô. Đo được (`aiken check -m nl_burn`):
  lô 1 DID `mem 241 K · cpu 72,1 M` (bản trước: `mem 219 K · cpu 64,6 M` ⇒ **+10 % mem, +12 % cpu**),
  lô 20 DID `mem 2,25 M · cpu 678 M` ⇒ chi phí biên **≈ 106 K mem · ≈ 32 M cpu mỗi DID**. Policy chạy
  MỘT lần cho cả lô (một redeemer mint), nên khoản này không nhân theo số phiếu như `vote ▸ spend`.
  Trần mỗi giao dịch là `mem 14 M · cpu 10 000 M`; ngân sách TRỌN một giao dịch `SumBatch` k phiếu
  vẫn CHƯA đo — nó nằm trong `[SUMBATCH-EXUNIT]`.

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
- **`R-NULLIFIER-PARAM`.** `nullifier(tally_policy, taad_policy, ms_per_epoch, tally_window_epochs, window_origin_ms)`
  — năm tham số, đúng thứ tự đó (đối chiếu chữ ký `validator nullifier(` trong `validators/nullifier.ak`); toàn bộ là
  apply-param; `taad_policy` theo mạng, nướng vào hash, không đọc từ UTxO tham số. Governance nhận
  `nullifier_policy` làm apply-param. Cùng nguyên tắc §v2.2.
- **`R-WINDOW-DISJOINT`.** `MintNullifier` chỉ khi `vote_open ≤ e < vote_close`; `BurnNullifier` và
  `SumBatch` chỉ khi `e ≥ vote_close`. Hai cửa sổ rời nhau ⇒ không có lượt đúc lại sau khi đốt —
  đóng lỗi 4 (issue #88) ở tầng thiết kế.
  **Hai mốc `vote_close` đó phải là của CÙNG MỘT proposal, và vế này không suy ra được từ câu trên.**
  `tally_policy` one-shot theo PHA ⇒ mọi proposal của pha dùng chung policy, nên "đọc `vote_close` từ
  một tally" chưa xác định được tally NÀO. Đọc từ tally của proposal khác thì hai cửa sổ không còn
  rời nhau: một tally cũ đã quá hạn thoả `e ≥ vote_close` với mọi `e`. Cả `MintNullifier` (gate 3) và
  `BurnNullifier` (B2) đều phải đọc theo `proposal_id` khai trong redeemer. Xem §v2.5
  `BurnNullifier` để có ca đo.
- **`R-RESULT-SHAPE`.** Datum của UTxO proposal là **đúng** `ProposalResult` 5 trường ở mọi trạng
  thái và mọi pha; dữ liệu phiếu nằm ở datum tally. Bộ kiểm bắt buộc có ca: datum mà **validator
  thật ghi ra** (không phải bản dựng tay) giải mã được bằng bản sao kiểu Treasury. Lỗi 3 lọt vì
  thiếu đúng ca này.
- **`R-ADDR-PRESERVE`.** Mọi nhánh spend của governance và tally: output cùng địa chỉ với input (cả
  stake credential), cùng token xác thực **ĐÚNG TÊN**, không reference script, không bơm token lạ.
  Ba vế này hiện thực ở `validators/tally.ak` ▸ `utxo_preserved` và `validators/governance.ak` ▸ S3/S4.
  **Vế "không reference script" không phải vệ sinh.** Acc tally và UTxO proposal đều KHÔNG có nhánh
  nào thu hồi (`[PROPOSAL-CLOSE]`), nên min-ADA của chúng bị khoá vĩnh viễn; đính một ô reference
  script vào acc làm min-ADA đó phình theo kích thước script gắn kèm, do người DỰNG giao dịch chọn và
  người MỞ proposal trả. `governance` S4 và `vote` R4 đã ép vế này từ trước; `tally` thiếu nó tới
  lượt vá 2026-09-29 (PoC 2 / 2b của báo cáo audit).
  **Vế "đúng TÊN" cũng không phải vệ sinh.** Đếm số lượng của một tên TUỲ Ý (`qty == 1`) không nói
  tên đó là `proposal_id` mà datum khai. Thiếu vế tên thì một Tally UTxO mang NFT tên `X` với datum
  khai `proposal_id = Y` đi trọn vòng đời: `SumBatch` gom phiếu của `Y`, sổ MPF ghi theo `Y`, còn mọi
  bên đọc ngoài (`tally_ref.find_tally`, `nullifier` cổng 3, `vote` V4/V5) định danh tally đó theo
  TÊN TOKEN là `X`. Hai định danh trôi khỏi nhau trong im lặng, và `[TALLY-TOKEN-OUTSIDE-OPEN]` cho
  phép dựng đúng hình dạng đó ngoài giao dịch Open.
- **`R-C3-ADDR` — chứng thực C3 đọc theo `(policy, tên, NƠI GIỮ)`, không theo `(policy, tên)`.**
  `tally ▸ attested_c3` chỉ nhận reference input tại `Script(c3_script_hash)` (apply-param), và đòi
  ĐÚNG MỘT ứng viên. Lý do: datum của một UTxO do người TẠO nó viết, nên "có token `(c3_policy,
  did_commit)`" chỉ nói token có thật — nó không nói ai viết con số nằm cạnh token. Người giữ token
  đem nó về ví thường rồi tự ghi giá trị chứng thực là đường của PoC 4. Cùng khuôn với
  `anchor_view ▸ find_anchor_view` (ghim `Script(policy)` + đúng một ứng viên), và cùng lý lẽ với
  `R-PIN-TWO`: token duy nhất KHÔNG thay được vế nơi giữ.
  Fail-closed khi hai tham số khai lệch: `c3_policy != #""` mà `c3_script_hash == #""` thì không địa
  chỉ thật nào khớp `Script(#"")` ⇒ mọi phiếu khai `c3_capped >= 0` bị bác ⇒ nhánh `SumBatch` tự
  khoá. Đó là chiều hỏng đúng, nên không có cổng riêng cho cặp tham số này.
- **`R-PREIMAGE-32` — hai tiền ảnh của `H(did_commit ‖ proposal_id)` phải CỐ ĐỊNH ĐỘ DÀI.**
  `nullifier ▸ MintNullifier` ép `length(did_commit) == 32` và `length(proposal_id) == 32`. Không có
  hai vế đó thì phép nối byte không đơn ánh: `(#"aa", #"bb")` và `(#"aabb", #"")` băm ra CÙNG một tên
  token, tức hai cặp khác nhau tranh cùng một nullifier. Cả hai giá trị vốn là băm 32 byte theo §v2.5
  (`did_commit = blake2b_256(UTF8(did))`, `proposal_id = H(seed)`), nên vế này không cắt đường trung
  thực nào — nó biến một tính chất của CÁCH SINH dữ liệu thành một cổng. SDK off-chain đã đòi đúng 32
  byte ở `offchain/src/datum.ts` ▸ `HASH32_BYTES`; trước lượt vá này, hai bên lệch nhau và bên yếu
  hơn là bên on-chain.
  `BurnNullifier` KHÔNG cần vế tương ứng: B1 dựng LẠI tên token từ `did_commits` rồi so đẳng thức,
  nên một `did_commit` sai độ dài cho ra một tên mà không lượt đúc nào tạo được ⇒ không có token đó
  để đốt.
- **`R-SWEEP-DELTA`.** `release.recipients_ok` cộng **mọi** output tới `to`. Khi `to` là địa chỉ
  một script có nhánh permissionless tiêu-rồi-trả-lại (như custody), người dựng giao dịch có thể
  tiêu một UTxO có sẵn ở đó và trả lại nguyên giá trị, khiến tổng output "đủ" trong khi khoản chi
  thật đi nơi khác. Nhánh nhận của custody k+1 (`[PHASE-SWEEP-INTAKE]`) phải ép
  `value_out − value_in` đúng bằng khoản chi và ghi đúng khoản đó vào sổ.
- **`R-BOOK-MPF` — sổ DID đã đếm là một GỐC 32 byte, không một danh sách.** `TallyDatum.voted_root`
  là gốc Merkle Patricia Forestry với khoá = `did_commit`, giá trị = `nullifier` của phiếu được cộng.
  `SumBatch` chèn trọn lô bằng `insert_proofs` (một chứng minh mỗi phiếu); `mpf.insert` tự `fail` khi
  chứng minh sai **hoặc khoá đã có trong cây**, nên "mỗi DID đếm tối đa một lần" không cần phép so
  trùng nào thêm, kể cả trong một lô và giữa nhiều lô. Kích thước datum không đổi theo số cử tri —
  đây là lý do bỏ `voted_dids: List` và `merge_strict_asc` của bản thiết kế trước.
  Giá trị lưu là `nullifier` chứ không phải một cờ: một DID bị đếm hai lần với hai `choice` khác nhau
  đòi hai nullifier khác nhau cho cùng `did_commit`, và việc đó HIỆN RA trên chuỗi (`[SELF-DUP-CHOICE]`
  mức 3).
- **`R-C-SOURCE` — `c*_capped` phải có NGUỒN, không chỉ có TRẦN.** Cap không phải chứng thực: một DID
  có anchor thật khai được trần tối đa của cả bốn yếu tố mà không nắm MAGIC/LAMP nào. `tally.SumBatch`
  kiểm lại nguồn của từng yếu tố, KHÔNG tin datum phiếu (`validators/tally.ak` ▸ `c_sources_ok`).
  Trạng thái hiện hành: C1 bị ép `== 0` khi `engage_policies == []`; khác rỗng thì
  `0 ≤ c1_capped ≤ cap_of(k1)` và `engage.attested_c1(thread_credits, did_commit) ≥ c1_capped`
  (apply-param CUỐI `engage_policies` của `tally`, bật 2026-10-03). C2, C4 vẫn bị ép `== 0` (chưa có
  policy chứng thực nào — `[C2-C4-SOURCE]`); C3 đòi một reference input mang
  đúng một token `(c3_policy, did_commit)` với giá trị chứng thực `≥` số khai, và `c3_capped` không
  vượt trần bảng knots. `c3_policy == #""` ⇒ C3 cũng bị ép `== 0`.
  Vế TRẦN (`c3_capped ≤ cap_of(k3)`) trước 2026-09-29 KHÔNG có ca kiểm nào ghim, và lý do là thứ đáng
  ghi lại: `interp` bão hoà ở knot cuối nên `cap` và `cap + 1` cho CÙNG một `pow`, còn
  `[VP-ZERO-FACTOR]` làm VP của mọi cử tri bằng 0 — hai thứ đó cộng lại làm mọi ca đọc kết quả qua
  power XANH ở cả hai cực, tức không đo gì. Nay ghim bằng cặp `sum_c3_khai_dung_bang_cap_qua` /
  `sum_c3_khai_vuot_cap_tu_choi` (`validators/tally_test.ak`), hai ca khác nhau đúng MỘT đơn vị và có
  chứng thực C3 thoả ở cả hai. Đo bằng đột biến trên bản chép: nới vế thành `≤ cap3 + 1`, hoặc thay
  hẳn bằng `True`, thì ĐÚNG một ca đỏ — và đó là ca âm mới, không ca nào khác.
- **`R-VOTE-THREE-WINDOW`.** Ba nhánh của `vote.spend` chia theo `e` thành ba cửa sổ RỜI NHAU:
  `RetractVote` khi `e < vote_close`; `ConsumeForTally` khi `e ≥ vote_close` (do `SumBatch` cùng giao
  dịch ép); `ReclaimVote` khi `e ≥ vote_close + tally_window`. Tính rời nhau là SỐ HỌC chứ không phải
  một luật thêm, vì `e` là MỘT số (`util.get_epoch_bounded`). Đây là lý do mọi chốt thời gian dùng
  khuôn hai-đầu chứ không ghép biên dưới với biên trên (`R-EPOCH-BOUNDED` dưới).
- **`R-EPOCH-BOUNDED`.** Mọi chốt thời gian của đường biểu quyết dùng `util.get_epoch_bounded`: cả
  hai biên validity range phải hữu hạn VÀ cùng epoch. Ghép `get_epoch` (biên dưới) với
  `get_epoch_upper` (biên trên) cho hai bất đẳng thức ngược chiều vẫn ĐÚNG, nhưng nó để lại câu hỏi
  "biên nào cho dấu nào" ở từng chỗ gọi, và câu đó bị trả lời sai ở lượt sửa sau mà không phép đo nào
  kêu.
- **`R-VERDICT-ONE-SOURCE`.** Biểu thức thông qua có ĐÚNG MỘT hiện thực:
  `lib/magiclamp/governance/tally.ak` ▸ `pass`. `governance ▸ FinalizeProposal` gọi nó, không viết
  lại. Bốn vế của nó đọc `bft_floor`, `quorum_vp_threshold`, `quorum_voter_threshold`,
  `theta_num/theta_den` từ `WeightParam` — không vế nào nhận giá trị từ redeemer. Và nhánh ghi kết
  quả phải ép ĐÚNG phán quyết (`status == verdict`), không phải "một trong `Executed`/`Rejected`":
  ép lỏng thành ra người tiêu chọn kết quả trong khi mọi vế khác vẫn thoả.
  Cùng lý do với `R-BOOK-MPF` và `weight_ref`: hai bản sao của một biểu thức quyết định sẽ biên dịch
  được, chạy xanh, và trôi khỏi nhau.
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

**Beacon khoá vĩnh viễn — hai UTxO, có chủ ý, kèm số đo.**

Hai UTxO của đường biểu quyết KHÔNG có nhánh nào tiêu lại được, và đó là lựa chọn thiết kế chứ không
phải sơ suất:

| UTxO | Vì sao khoá | Chỗ cưỡng chế |
|---|---|---|
| **WeightParam beacon** | bảng tham số phải BẤT BIẾN trong đời một pha; cách rẻ nhất để ép bất biến là làm nó không tiêu được. Đổi bảng = đúc NFT pha MỚI với `phase_tag` khác (`[WEIGHT-PARAM-UPDATE]`) | `validators/weight_param_nft.ak`: đích bị ép là `Script(policy_id)` — địa chỉ có payment credential đúng bằng hash của CHÍNH script đó, mà script đó chỉ có nhánh `mint` và `else(_) { fail }` |
| **Tally UTxO sau `Finalize`** | kết quả đã đóng là dữ kiện lịch sử; `ReclaimVote` và `FinalizeProposal` đọc nó qua reference input nên nó phải còn sống | `validators/tally.ak`: `TallyRedeemer` chỉ có `SumBatch` và `Finalize`, và cả hai đòi `d_in.phase == Summing` ⇒ một tally đã `Clamped` không khớp nhánh nào |
| **Proposal UTxO sau `FinalizeProposal`** | beacon kết quả là thứ Treasury đọc qua reference input; nó phải sống ít nhất tới khi mọi lượt chi xong, và `R-NO-BURN` cấm đốt | `validators/governance.ak` ▸ `spend`: chốt S1 đòi `status == Open`, nên một proposal `Executed` hoặc `Rejected` không khớp nhánh nào (`[PROPOSAL-CLOSE]`) |

**min-ADA bị khoá — đo bằng công thức ledger, không đoán.** `min_ada = (160 + |TxOut CBOR|) ·
utxoCostPerByte`, `utxoCostPerByte = 4310` lovelace (tham số giao thức, giống nhau ở mainnet ·
Preprod · Preview). Kích thước `TxOut` tính bằng cách mã hoá CBOR đúng khuôn Plutus Data mà
`aiken/cbor` dùng (mảng độ dài không xác định cho `List` và cho trường của `Constr`), địa chỉ script
29 byte, value gồm ADA + đúng một NFT:

| UTxO | Hình dạng datum | `TxOut` | min-ADA |
|---|---|---|---|
| WeightParam beacon | 5 mốc mỗi yếu tố | 421 B | **2,504110 ADA** |
| WeightParam beacon | 9 mốc mỗi yếu tố | 709 B | **3,745390 ADA** |
| WeightParam beacon | 17 mốc mỗi yếu tố | 1285 B | **6,227950 ADA** |
| Tally (đã `Clamped`) | `top_did_vp` rỗng | 295 B | **1,961050 ADA** |
| Tally (đã `Clamped`) | `top_did_vp` 20 entry | 617 B | **3,348870 ADA** |
| Tally (đã `Clamped`) | `top_did_vp` 63 entry (`bft_floor = 64`) | 1305 B | **6,314150 ADA** |
| Proposal (đã `Executed`/`Rejected`) | `spend_spec_hash` rỗng (hình dạng Pha 1/2) | 160 B | **1,379200 ADA** |
| Proposal (đã `Executed`/`Rejected`) | `spend_spec_hash` 32 byte (khi mở đường chi) | 193 B | **1,521430 ADA** |

Đọc bảng theo đúng chiều: WeightParam beacon là **một** UTxO cho **cả pha** ⇒ khoản khoá là một
lần, cỡ 2,5–6,3 ADA tuỳ độ phân giải bảng knots. Tally và Proposal là **một UTxO mỗi proposal** ⇒
khoản khoá tỉ lệ với số proposal, và cận trên của Tally do `bft_floor` định (heap giữ tối đa `F−1`
entry). Với `bft_floor = 21` (chốt Launch) thì `top_did_vp` tối đa 20 entry ⇒ **≈ 3,35 ADA** cho
Tally **+ ≈ 1,38 ADA** cho Proposal ⇒ **≈ 4,73 ADA khoá vĩnh viễn mỗi proposal**. Con số Proposal
chỉ nhích lên ≈ 1,52 ADA khi `spend_spec_hash` được điền, nên việc mở đường chi không đổi bậc chi
phí.

Hai số này là chi phí của người MỞ proposal và người DỰNG pha, không lấy từ kho (§trên). Lời giải
tổng cho việc thu hồi vẫn nằm ở `[PROPOSAL-CLOSE]`.

### v2.10 Danh mục điểm mở

| Mã | Treo gì | Ràng buộc tạm thời đang có hiệu lực (fail-closed) | Khai ở |
|---|---|---|---|
| `[C2-SOURCE]` | C2 (LAMP cam kết) đọc từ nguồn on-chain nào | `tally.SumBatch` ép `c2_capped == 0` với MỌI phiếu (`R-C-SOURCE`) ⇒ yếu tố C2 không đóng góp gì cho tới khi có nguồn | tệp này §v2.3, §v2.8; mô hình `VotingPower/CONTRACT.md` §1 |
| `[C3-ISSUER]` | bên phát hành NFT chứng thực C3, **và script nào GIỮ NFT đó** | `tally` nhận HAI apply-param cho C3: `c3_policy` (ai đúc) và `c3_script_hash` (nơi giữ). Đặt `c3_policy = #""` ⇒ `c3_capped` bị ép `== 0`. Khác `#""` ⇒ mỗi phiếu đòi ĐÚNG MỘT reference input mang `(c3_policy, did_commit)` **tại `Script(c3_script_hash)`**, datum inline là một `Int` ≥ số khai (`R-C3-ADDR` §v2.8). Hai ứng viên ⇒ bác; chứng thực ở ví thường ⇒ bác. **Thứ tự apply-param của `tally` (10 tham số, `c3_script_hash` chèn NGAY SAU `c3_policy`; nguồn `validator tally(` trong `validators/tally.ak`): `tally_policy`, `vote_script_hash`, `nullifier_policy`, `weight_param_policy`, `c3_policy`, `c3_script_hash`, `tally_window_epochs`, `ms_per_epoch`, `window_origin_ms`, `engage_policies`.** Còn treo ở hai vế: bên phát hành là ai, và script giữ NFT phải ép được cái gì (tối thiểu: chỉ bên phát hành mới ghi/sửa được `Int` trong datum) — cho tới khi có lời giải thì `c3_policy = #""` là cấu hình DUY NHẤT được phép deploy | tệp này §v2.3, §v2.8 `R-C3-ADDR` |
| `[VP-ZERO-FACTOR]` | **Pha 1/2 chỉ ghi được `Rejected`, không ghi được `Executed`** — và đây là HỆ QUẢ của mô hình, không phải lỗi | Cổng G0 (`weight_guard.knots_wellformed`) ép `pow_k(0) == 0` cho cả bốn bảng, vì `VotingPower/CONTRACT.md` §1 định VP là công thức NHÂN ("yếu một tham số là kéo sụp toàn bộ VP") và §2 nguyên lý 1 coi "người mới VP ≈ 0" là TÍNH NĂNG. Cộng với `[C2-C4-SOURCE]` đang ép `c2 = c4 = 0` ⇒ mọi VP bằng 0 ⇒ `total_vp_eff == 0` ⇒ vế quorum VP của `pass` canonical không bao giờ đạt (`quorum_vp_threshold >= 1` do `weight_param_nft` ép) ⇒ `FinalizeProposal` luôn ra `Rejected`. **Không có tài sản nào chịu rủi ro** vì đường chi đã đóng độc lập (`[GOV-FINALIZE-BRANCH]`: `spend_spec_hash == #""`). `Executed` ở Pha 1/2 đòi có nguồn C2/C4 on-chain TRƯỚC (C1 đã có nguồn khi `engage_policies` khác rỗng). Ghim bằng ca chạy thật: `vp_zero_sumbatch_chay_duoc_ma_cong_khong` + `vp_zero_pass_khong_bao_gio_dung` (`validators/tally_test.ak`) và e2e Emulator của SDK kỳ vọng `verdict == "Rejected"`.<br>**Hai hệ quả phụ phải nói thẳng.** (a) Một lượt `SumBatch` vẫn HỢP LỆ dù cộng 0 — nó tiêu phiếu và ghi sổ mà không tăng power. Em CỐ Ý không thêm chốt "lô phải cộng thêm gì đó": chốt đó mâu thuẫn với chính dòng này khi `[C2-C4-SOURCE]` còn treo, nên nó chỉ được thêm CÙNG LÚC với nguồn C2/C4. (b) Clamp BFT và heap top-(F−1) — hai chốt chống cá voi — **không kiểm được ở mức validator** khi mọi VP bằng 0 (mọi entry heap bằng nhau ⇒ ca kiểm xanh ở cả hai cực đột biến ⇒ không ghim gì). Độ phủ của chúng nằm ở mức THƯ VIỆN: `lib/magiclamp/governance/tally.ak`, khối `hypothetical_knots_pow0_scale`, kèm một ca khẳng định chính bảng giả định đó bị `d8_ok` bác. **NGHĨA VỤ: nối lại ở mức validator khi mở nguồn C2/C4**, trước đó không được nói hai chốt này đã ghim trên đường thật | tệp này §v2.5, §v2.10 `[C2-C4-SOURCE]`; `lib/magiclamp/governance/weight_guard.ak` ▸ `knots_wellformed` |
| `[C2-C4-SOURCE]` (tên cũ `[C1-C2-C4-SOURCE]` — C1 đã có nguồn từ 2026-10-03; tên cũ còn trong chú thích mã: `validators/tally.ak`, `validators/tally_test.ak`, `lib/magiclamp/governance/{tally,weight_guard}.ak`, `offchain/src/voteBuilders.ts`, `tests/e2e.test.ts`) | hai yếu tố C2 (LAMP cam kết), C4 (LAMP nắm giữ) chưa có policy chứng thực nào trên chuỗi | `tally.SumBatch` ▸ `c_sources_ok` ép `c2_capped == c4_capped == 0` với MỌI phiếu. C1 có nguồn khi `engage_policies` khác rỗng (thread Engage của MAGIC, `engage.attested_c1 ≥ c1_capped`); `engage_policies == []` ⇒ `c1_capped == 0`. Hệ quả phải nói thẳng: vì C2 và C4 bằng 0, VP tích nhân bằng 0 với MỌI cử tri — mô hình tích-nhân-bốn-yếu-tố CHƯA có hiệu lực, Pha 2 không được coi là hoàn tất khi dòng này còn treo | tệp này §v2.8 `R-C-SOURCE` |
| `[BALLOT-PUBLIC]` | phiếu KHÔNG ẩn — chủ dự án đã chốt là không làm phiếu ẩn ở v2 | không có ràng buộc tạm nào, vì đây không phải một thứ đang chờ: nó là một QUYẾT ĐỊNH, và hệ quả của nó vĩnh viễn. Hệ quả: (a) `did_commit` nằm công khai trong datum phiếu và trong sổ `voted_root`, nên ai tra được `did_commit → DID` thì biết một cá nhân cụ thể đã bỏ phiếu; (b) `choice` công khai vĩnh viễn trên chuỗi, không xoá được; (c) do đó mua phiếu và cưỡng ép bỏ phiếu KIỂM CHỨNG ĐƯỢC từ bên ngoài. Bất kỳ lời hứa đối ngoại nào về "bỏ phiếu riêng tư" đều sai với bản này | tệp này §v2.10 |
| `[SELF-DUP-CHOICE]` | một cá nhân không bị chặn về mặt mật mã khỏi việc được đếm hai lần với hai `choice` khác nhau nếu có một đường nào đúc được hai nullifier cho cùng `did_commit` | hai mức đang có hiệu lực: **mức 1** — khoá sổ MPF là `did_commit` và giá trị là `nullifier`, nên một DID chèn lần thứ hai bị `mpf.insert` bác, và nếu nó xảy ra qua một đường chưa biết thì việc đó HIỆN RA trên chuỗi (hai giá trị khác nhau cho cùng khoá); **mức 3** — `governance.OpenProposal` ép `spend_spec_hash == #""`, tức Pha 1/2 KHÔNG cho proposal chi tiền, nên lỗ này không có đường dẫn tới tài sản. Mức 2 (đóng kín bằng mật mã) chưa có lời giải | tệp này §v2.5, §v2.8 `R-BOOK-MPF` |
| `[DID-RECOVERY-TRUST]` | luồng phục hồi DID của PhoenixKey cho một nhóm guardian chiếm quyền điều khiển một anchor sau một thời hạn; Governance không kiểm soát luồng đó | `governance.OpenProposal` ép `vote_close_epoch − vote_open_epoch < recovery_timelock_epochs` (apply-param, soft-pin đọc từ cấu hình theo mạng). Cắt đường "chiếm DID rồi bỏ phiếu bằng nó trong CÙNG cửa sổ". KHÔNG đóng kín: guardian vẫn chiếm được giữa hai proposal | tệp này §v2.5 |
| `[GOV-FINALIZE-BRANCH]` | *(đọc cùng `[VP-ZERO-FACTOR]`: nhánh này hiện chỉ ra được `Rejected`, vì mọi VP bằng 0 khi `[C2-C4-SOURCE]` còn treo — hai dòng chặn ở HAI tầng khác nhau và không thay nhau được: dòng này chặn CHI, dòng kia chặn THÔNG QUA)* nhánh `FinalizeProposal` ĐÃ hiện thực (`validators/governance.ak` ▸ `spend`, chín chốt S1–S9 §v2.5), nhưng Pha 1/2 vẫn CHƯA chi được tiền: điều còn treo là đường proposal-chi-tiền, không phải nhánh ghi kết quả | `spend_spec_hash == #""` bị ép ở CẢ HAI cửa (`OpenProposal` và `FinalizeProposal`) ⇒ `release.spend_spec_hash` của Treasury không bao giờ khớp ⇒ mọi lượt `Release` bị từ chối. Pha 1/2 hiện là đường RA QUYẾT ĐỊNH (`Executed`/`Rejected` đọc được từ ngoài), KHÔNG phải đường giải ngân. Mở nó ra đòi `[SELF-DUP-CHOICE]` mức 2 có lời giải trước | tệp này §v2.5, §v2.10 `[SELF-DUP-CHOICE]` |
| `[TALLY-TOKEN-OUTSIDE-OPEN]` | `tally_nft` không kiểm ĐÍCH và không kiểm datum khởi tạo (nó không biết `tally_script_hash` — biết là tạo vòng phụ thuộc, §v2.4), nên một token `tally_policy` đúc LẺ ngoài giao dịch Open dựng được một Tally UTxO có datum bịa | hở là HÚT PHIẾU, không phải chi tiền: cử tri có thể bị dụ đúc nullifier và bỏ phiếu vào một tally không ứng proposal nào. Nó KHÔNG bao giờ sinh ra một proposal, vì hạt giống của nó đã bị tiêu nên không giao dịch Open nào đúc lại được token cùng tên. Bên đọc off-chain phải xác minh tally bằng cách truy giao dịch đúc của nó và kiểm rằng giao dịch đó cũng đúc token `governance` cùng tên.<br>**Hệ quả phải nói thêm, vì "hút phiếu" nghe như chỉ mất công — không phải:** người dựng tally giả cũng chính là người CHẠY ĐƯỢC `SumBatch` trên nó (nhánh đó permissionless), và một lượt `SumBatch` TIÊU các UTxO phiếu mà **không ràng buộc ADA của chúng đi đâu**. Hai chỗ đọc thẳng ra được: `validators/tally.ak` ▸ `utxo_preserved` chỉ ép `out.value == in_out.value` cho ĐÚNG acc tally, và `validators/vote.ak` ▸ `ConsumeForTally` chỉ ép "không output nào ở script phiếu còn giữ nullifier này" (V3) — không vế nào nói về min-ADA của phiếu. Vậy người dựng tally giả **thu hồi được phiếu của proposal giả**: gom trọn lô phiếu của cử tri bị dụ và bỏ túi min-ADA của từng UTxO phiếu. Cử tri mất cả ba: cọc min-ADA, phí, và cửa sổ bỏ phiếu — nullifier tên `H(did ‖ proposal_id)` khác nhau theo `proposal_id` nên phiếu đã tiêu cho proposal giả KHÔNG đúc lại được cho proposal thật, mà thời gian thì không quay lại. Tức đây là đường **tước phiếu có chủ đích, có lãi, nhắm được vào một nhóm cử tri cụ thể** — khác hẳn "một tally không ứng proposal nào". (Khoản min-ADA của chính acc tally giả thì người dựng KHÔNG lấy lại được: sau `Finalize` không nhánh nào tiêu được acc — `[PROPOSAL-CLOSE]`. Nên chi phí của kẻ tấn công là một min-ADA acc, thu là `k` min-ADA phiếu.) Ràng buộc tạm duy nhất vẫn là phép xác minh off-chain ở trên, và nó phải nằm trong ví/cổng thông tin chứ không trong tài liệu | tệp này §v2.5 |
| `[IDENT-ONE-PERSON]` | **chi phí Sybil của cả hệ quản trị = số anchor `Person` GỐC mà tầng danh tính cấp cho MỘT người thật.** Governance đếm anchor, không đếm người: cổng A-PERSON (`anchor_view ▸ anchor_active_and_signed`) loại `Bot`/`Device`/DID con (`parent_did = Some`, `depth ≠ 0`), nên nó đóng đường "một người đúc k DID CON rồi bỏ k phiếu" — nhưng nó KHÔNG nói gì về "một người xin được k anchor `Person` gốc". Hai câu đó khác nhau, và chỉ câu thứ nhất được ép trên chuỗi | **Governance KHÔNG ràng buộc khoá giữa hai cử tri, và không có chỗ nào để làm việc đó.** Không validator nào so `controller_pkh` của hai anchor khác nhau, không có sổ "một người một suất" nào ngoài sổ MPF theo `did_commit` — mà `did_commit` là định danh của ANCHOR, không phải của người. Hệ quả phải nói thẳng: **hai ngưỡng chống-thâu-tóm duy nhất của mô hình — sàn BFT (`bft_floor`, số cử tri THUẬN tối thiểu) và quorum-người (`quorum_voter_threshold`) — tựa HOÀN TOÀN vào tầng danh tính.** Cả hai đếm anchor; nếu một người xin được `n` anchor `Person` gốc thì hai ngưỡng đó bị chia cho `n`, và không phép kiểm on-chain nào phát hiện được. Lớp VP tích-nhân KHÔNG bù được: nó chặn một cử tri GIÀU, không chặn `n` cử tri giả nghèo như nhau. Ràng buộc tạm duy nhất nằm NGOÀI kho này (`VotingPower/CONTRACT.md` §3); trong kho này, Pha 1 phải được mô tả là "đếm anchor", và mọi lời hứa đối ngoại dạng "một người một phiếu" là SAI với bản hiện tại | `VotingPower/CONTRACT.md` §3; `lib/magiclamp/governance/anchor_view.ak` ▸ `anchor_active_and_signed` |
| `[VOTE-INTENT-WALLET]` | **`MintNullifier` không ghim ĐÍCH của token, nên `choice` của phiếu do BÊN DỰNG giao dịch viết, không do cổng WHO viết** | Cổng WHO (`nullifier` cổng 4) chỉ chứng thực rằng chủ anchor đã ký một lượt ĐÚC; nó không đọc `VoteDatum` và không biết UTxO phiếu sẽ mang `choice` nào — `SPEC.md` §v2.5 đã ghi "token nullifier nằm ở đâu thì policy không kiểm (vòng phụ thuộc)". Hệ quả: một ví dựng giao dịch hộ cử tri có thể ghi `choice` ngược ý, và chữ ký của cử tri vẫn hợp lệ. **NGHĨA VỤ Ở TẦNG VÍ, không ở tầng validator: ví PHẢI hiện `choice` (và `proposal_id`) cho người ký ĐỌC TRƯỚC KHI KÝ.** Đường sửa sai đã có trên chuỗi và là đường DUY NHẤT: `vote ▸ RetractVote` đổi `choice` tại chỗ, chỉ chạy được khi `e < vote_close_epoch` và đòi lại đúng hai chữ ký chính chủ (R3) — nên cử tri phát hiện muộn hơn mốc đóng phiếu thì KHÔNG còn đường nào. Đây là một điểm mở của TRẢI NGHIỆM, không phải của mã: thêm cổng on-chain đòi `vote` gác việc TẠO ra chính UTxO của nó, thứ §v2.11 đã bác | tệp này §v2.5 (`MintNullifier`, `RetractVote`); `validators/vote.ak` ▸ nhánh `RetractVote` |
| `[PHASE1-QUORUM]` | giá trị quorum Pha 1 | governance Pha 1 không được biên dịch khi chưa có giá trị; không có giá trị ngầm định | tệp này §v2.5 |
| `[SUMBATCH-EXUNIT]` | **ĐÃ ĐO LẠI SAU LƯỢT TỐI ƯU (off-chain, 2026-09-29, nhánh `feat/governance-v2`, sau `4012882`):** ExUnit và kích thước của MỘT lô `SumBatch` k phiếu. **CÒN TREO:** độ dài `tally_window` suy từ cỡ lô · giao dịch quét kho §v2.7 · đo lại trên testnet | **Kết quả.** Trần tx mem 14 000 000 / cpu 10 000 000 000; lấy biên 20% ⇒ mem ≤ 11 200 000. **Mem vẫn là trần ràng buộc** — ở mọi trần k dưới đây cpu không vượt 38%. Bảng knots 8 mốc, `bft_floor` 21, VP = 0 (`[VP-ZERO-FACTOR]`). k tối đa theo biên 20% — cột "trước" là số của bản `4012882`, cột "sau" là bản hiện tại:<br>· heap ĐẦY 20 mục, sổ rỗng, C3 tắt — **3 → 7** (69,0%; k = 8 là 80,4% ⇒ vượt)<br>· heap ĐẦY, sổ rỗng, C3 bật — **2 → 6** (72,0%; k = 7 là 84,5%)<br>· heap ĐẦY, sổ 10 000 DID, C3 tắt — **2 → 6** (76,4%; k = 7 là 88,2%)<br>· heap ĐẦY, sổ 10 000 DID, C3 bật — **2 → 5** (74,2%; k = 6 là 88,5%)<br>· heap RỖNG (lô đầu), sổ rỗng, C3 tắt — **5 → 8** (69,8%; k = 9 là 81,1%)<br>· heap RỖNG, sổ rỗng, C3 bật — **4 → 7** (74,6%; k = 8 là 89,0%)<br>**Ba nguồn tiết kiệm, mỗi nguồn một số đo riêng** (k = 1, heap đầy, sổ rỗng, C3 tắt; trước → sau): `tally` 5 841 565 → 2 168 332 · `vote` 1 135 982 → 428 054 · `nullifier` 552 563 → 208 223 · TỔNG 7 530 110 → 2 804 609.<br>(a) **Cổng D8 rời khỏi đường nóng.** `weight_guard.d8_ok` trên bảng 8 mốc tốn **3 645 089 mem** mỗi lượt `SumBatch` — 26% trọn trần, khoản lớn nhất. `tally ▸ SumBatch` nay gọi `weight_ref.read_weight_param_skip_d8`. Đóng vì: `weight_param_nft` one-shot theo `seed_ref`, mỗi lượt đúc ép đúng MỘT tên tài sản và MỘT đơn vị, đích bị ép về `Script(policy_id)` mà script đó không có nhánh `spend` ⇒ tổng cung một đơn vị, datum bất biến, và phép đọc khoá đúng vào `OutputReference` đã cam kết lúc Open. D8 nay ép ở `weight_param_nft ▸ mint` (cổng THẬT), `governance ▸ OpenProposal` (nhánh một proposal chạm bảng LẦN ĐẦU), `governance ▸ FinalizeProposal` và `tally ▸ Finalize`. Lập luận đầy đủ ở đầu `lib/magiclamp/governance/weight_ref.ak`. **Open đắt thêm bao nhiêu — ĐÃ ĐO** (một lần mỗi proposal, không phải mỗi lô): số + cách đo ở §v2.5 mục `OpenProposal`, đo bằng `gov_open_run` − `gov_open_base` và `gov_open_d8_run` − `gov_open_d8_base` trong `validators/exunit_test.ak`.<br>(b) **`vote`/`nullifier` đọc LÁT CẮT `TallyDatum`, không giải chặt.** Bốn trường đường nóng cần (`proposal_id`, hai mốc cửa sổ, `voted_root`) đọc theo khuôn 15 ô, trường `top_did_vp` không bao giờ bị ép ⇒ chi phí ĐỘC LẬP cỡ heap: `vote` cho đúng 428 054 mem/phiếu với heap rỗng lẫn heap 20 mục (trước: 506 522 và 1 135 982). Trước lượt này một giao dịch k phiếu giải chặt `2k + 1` lần. Vì sao không nới chốt nào: xem đầu `lib/magiclamp/governance/tally_ref.ak`.<br>(c) **Quy đổi VP của lô ĐÚNG MỘT LẦN.** `top_heap_consistent` và `sum_batch_consistent` đều đọc `(vp_raw, choice)` mỗi phiếu; trước đây mỗi hàm tự quy đổi lại cả lô. Tiết kiệm ở `tally`: 658 841 mem (k = 5, C3 bật), 239 996 (k = 5, C3 tắt). Kèm: `cap_of(wp.k3)` nâng ra ngoài vòng lặp phiếu.<br>**Cận trên khi mở C1/C2/C4:** phần tăng đo ở mức thư viện nay là **+181 350 mem mỗi phiếu** (một nửa số cũ 362 699 — đúng phần (c) bỏ đi), tuyến tính theo k. k tối đa khi cộng khoản đó: heap đầy sổ rỗng C3 tắt **7**, C3 bật **6**; heap đầy sổ 10 000 DID C3 tắt **5**, C3 bật **4**; heap rỗng sổ rỗng C3 tắt **7**, C3 bật **6**.<br>**Kích thước tx vẫn không ràng buộc:** mô hình cộng từng phần ở sáu trần mới cho 3 326–8 404 byte (lớn nhất: sổ 10 000 DID + C3 tắt, k = 6), trần 16 384 ⇒ biên ≥ 48%. Tx thật dựng bằng SDK trong Emulator: 862 B (k = 1) đến 4 334 B (k = 8, C3 bật). **Cách đo:** `validators/exunit_test.ak` gọi handler của ba validator trên một `Transaction` dựng trọn (redeemer/datum ép kiểu lại từ `Data`), ExUnit script = ca − ca `_base`; k đo tại 1–10, 20, 40 nên trần là số ĐO ở lân cận trần, không phải nghiệm của đường khớp. Đối chiếu bằng ExUnit THẬT từ Emulator (`Governance/tests/exunitBench.test.ts`, `GOV_BENCH=1`, sổ rỗng + heap rỗng): cách đo trực tiếp cao hơn Emulator 9–12% (k = 4 C3 tắt: 4 891 285 so với 4 360 355; k = 8 C3 bật: 12 464 824 so với 11 348 943), nên bảng trên là cận trên gần. **Ràng buộc tạm:** `buildSumBatchTx` không đặt trần k — người gọi chọn k theo bảng trên; lô vượt trần bị bác ngay lúc dựng vì Lucid đánh giá UPLC cục bộ, không lên chuỗi. Pha 1 không triển khai mainnet trước khi đo lại trên testnet | tệp này §v2.6, §v2.7; `validators/exunit_test.ak`; `lib/magiclamp/governance/{weight_ref,tally_ref}.ak`; `Governance/tests/exunitBench.test.ts` |
| `[PHASE-SWEEP-INTAKE]` | custody đã có `Deposit` (`Treasury/CONTRACT.md` v1.2 §15.2) nhận 100% cho bucket thường; hai bucket dành riêng (nguồn Reserve, thưởng uỷ quyền) chưa có đường nhận từ instance tiền nhiệm (`custody.ak` ▸ C-DEP-CAT) | không proposal chuyển pha nào được đưa tới `Executed` | tệp này §v2.7 |
| `[PHASE-RESERVE-REPOINT]` | đường Reserve → custody ghim instance bằng apply-param (`reserve_gate`) | chuyển pha không được coi là hoàn tất khi đường Reserve còn trỏ instance cũ | tệp này §v2.7 |
| `[WEIGHT-PARAM-UPDATE]` | cập nhật `WeightParam` trong một pha | `weight_param_nft` đúc một lần theo `seed_ref`, ép đích là `Script(policy_id)` — script đó không có nhánh `spend` ⇒ không nhánh nào tiêu được; đổi bảng tham số = đúc NFT pha mới. min-ADA bị khoá đo được ở §v2.9 | tệp này §v2.5, §v2.9 |
| `[PROPOSAL-CLOSE]` | thu hồi UTxO proposal/tally đã kết thúc | cấm đốt, không có nhánh đóng | tệp này §v2.9 |
| `[SPEND-SPEC-INSTANCE]` | phía Treasury ĐÃ gắn `seed_policy` vào tiền ảnh `spend_spec_hash` (`Treasury/CONTRACT.md` v1.2 §15.1, `C-REL-3-SEED`; off-chain `Treasury/offchain/src/release.ts` ▸ `spendSpecHash`). Còn treo: phía governance chưa dựng tiền ảnh này cho proposal chi tiền | governance Pha 1/2 ép `spend_spec_hash == #""` ⇒ mọi `Release` bị từ chối (`[GOV-FINALIZE-BRANCH]`) | `Treasury/CONTRACT.md` v1.2 §15.1 |

### v2.11 Mã v1 sẽ thay

| Tệp v1 | Số phận ở v2 | Trạng thái |
|---|---|---|
| `validators/proposal.ak`, `validators/proposal_nft.ak` | thay bằng một validator `governance` hai mục đích mỗi pha | XONG cho Pha 1/2 — `validators/governance.ak` có cả `mint ▸ OpenProposal` và `spend ▸ FinalizeProposal`; hai tệp v1 còn nguyên cho Pha 0 |
| `validators/tally_nft.ak` | thay bằng `tally_policy` seed-unique | XONG — `validator tally_nft(_phase_tag)`, `MintTally { seed }` |
| `validators/tally.ak` | giữ logic cộng/clamp; bỏ phụ thuộc Proposal v1; thêm `tally_window`, cửa sổ `SumBatch`, sổ MPF, cổng nguồn C* | XONG |
| `validators/vote.ak` | bỏ `proposal_policy` và stub committee chứng thực DID; ba nhánh `ConsumeForTally`/`RetractVote`/`ReclaimVote` | XONG — `CastVote` đã bỏ: một UTxO phiếu được TẠO bằng giao dịch đúc nullifier, và một nhánh `spend` không gác được việc tạo ra chính UTxO của nó |
| `validators/nullifier.ak` | thêm anchor TAAD + A-PERSON + cửa sổ; `BurnNullifier { proposal_id, did_commits }` ghim tập tên bị đốt (B1) và ghim căn cứ thời gian theo `proposal_id` (B2) | XONG |
| `validators/weight_param_nft.ak` | MỚI ở v2 — cổng bảng tham số DAO | XONG |
| `lib/magiclamp/governance/{power,weight_guard,tally}.ak` | giữ (Pha 2); `power.ak` thêm `cap_of` (trần đọc thẳng từ knot cuối, không cần trường mới) | XONG |
| `lib/magiclamp/governance/{anchor_view,names,tally_ref,weight_ref,mpf_fixtures}.ak` | MỚI ở v2 — bản chép anchor TAAD có nhãn; tên tài sản canonical; đọc tally theo TOKEN (`tally_view` = lát cắt 4 trường theo chỉ số cho đường nóng `vote`/`nullifier`, `expect_tally_at` giải chặt + ghim địa chỉ cho `governance`); đọc `WeightParam` MỘT nguồn cho cả `tally` và `governance` — `read_weight_param` CÓ cổng D8 (Open/Finalize), `read_weight_param_skip_d8` cho `SumBatch` (`[SUMBATCH-EXUNIT]`); fixture MPF sinh tự động | XONG |
| `lib/magiclamp/governance/did_stub.ak` | bỏ khỏi đường biểu quyết (committee không còn chứng thực DID) | còn tệp, không còn nơi gọi trên đường biểu quyết |
| `lib/magiclamp/governance/types.ak` | `ProposalResult`/`ProposalStatus` giữ nguyên byte; `ProposalDatum` 12 trường bỏ; `TallyDatum`, `VoteDatum` theo §v2.5 | `TallyDatum` XONG (ba trường v2 thêm ở CUỐI để giữ chỉ số CBOR của 12 trường đầu); `ProposalDatum` còn vì Pha 0 |

**Hai chỗ SPEC lệch mã, mã thắng, đã sửa trong tệp này:** tên pha thứ hai của tally là `Clamped`
(không phải `Final`); `nullifier` có thêm apply-param `tally_window_epochs` mà bảng §v2.5 trước
không ghi. Một chỗ nữa ghi để không ai đi tìm: bản `aiken build` của v1 cho `proposal_nft` và
`tally_nft` **cùng một script hash** (hai thân hàm giống nhau từng byte trước khi áp tham số); ở v2
`tally_nft` đã đổi thân nên hai hash khác nhau.

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
