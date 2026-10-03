# GovernancePointer — custody trỏ tới governance qua một NFT con trỏ

Phiên bản 0.2 (2026-10-03). Nằm cạnh `Treasury/CONTRACT.md` và `Treasury/Tech-Spec.md` §7 (C-REL-*). Validator mới: `Treasury/onchain/validators/governance_pointer.ak`.

Vì sao lên 0.2: chốt mô hình tin cậy và trễ Mainnet (mục "Đã chốt"). Hình dạng on-chain không đổi so với 0.1.

## Đã chốt (2026-10-03)
- **Mô hình tin cậy:**
  - Committee đổi con trỏ được, nhưng phải qua trễ công khai (`CommitteePropose` rồi `ApplyPending`).
  - Committee niêm phong một chiều (`Seal`) khi governance có đủ C1–C4 chạy được. Sau đó chỉ proposal đã thông qua mới đổi được (`GovernanceSet`).
  - Đã loại: chỉ governance đổi được (governance hiện hành không thông qua được gì ⇒ con trỏ kẹt ngay), và committee đổi mãi không niêm phong (trái nguyên tắc governance theo cá nhân).
- **Trễ Mainnet:** 6 epoch = `2_592_000_000` ms. Hằng `POINTER_DELAY_MAINNET_MS` ở `Genesis/scripts/_reserve_layer2.ts`; khai số khác trên Mainnet ⇒ `POINTER-DELAY-001`.
- **Hạn của Propose** tính từ CẬN TRÊN khoảng hiệu lực + trễ. Cận dưới lùi về quá khứ được, nên tính từ cận dưới thì rút ngắn được trễ.

## Vì sao

Kho custody Reserve hiện nướng hash governance ở hai chỗ, và không có đường nào đổi sau lượt sinh:
- datum: `CustodyDatum.governance_ref`;
- tham số: `custody(proposal_policy, …)`.

Mọi nhánh custody đều ép `out_datum.governance_ref == datum.governance_ref`. `reserve_draw` thì nướng `custody_script_hash`.

Hệ quả: governance phải dựng lại (bật C2/C4, đổi danh sách `engage_policies` khi MAGIC đổi `consume`, đổi tally) ⇒ custody chỉ chi được bằng proposal của bản governance cũ, và Reserve vẫn chảy vào custody cũ.

Governance hiện hành KHÔNG thông qua được proposal nào:
- `tally.ak` ép `c2_capped == 0` và `c4_capped == 0` với mọi phiếu (`[C2-SOURCE]`, fail-closed);
- `weight_guard.ak` ▸ `knots_wellformed` ép `first.pow == 0` ⇒ VP mọi cử tri = 0;
- `weight_param_nft.ak` ép `quorum_vp_threshold >= 1`, nên `tally.pass` (vế `total_vp_eff >= quorum_vp_threshold`) luôn sai.

Nướng hash governance hôm nay = nhánh `Release` của custody chết vĩnh viễn.

## Thiết kế

`CustodyDatum` KHÔNG đổi kiểu. `custody_seed.ak` giải mã nó và nằm trong policy tLAMP `493002cc…`.
- Trường `governance_ref` (28 byte) đổi NGHĨA: từ "script hash governance" thành **policy id của NFT con trỏ governance**.
- `custody_seed.ak:148` chỉ ép độ dài 28, nên không phải sửa.

### NFT con trỏ
- Policy one-shot, theo một oref hạt giống ghim trước. Tên asset `GOVPOINTER`. Đúc đúng 1, vào địa chỉ script `governance_pointer`, kèm datum inline `PointerDatum`.
- `PointerDatum`:
  - `governance_hash: ByteArray`: 28 byte, hoặc rỗng khi chưa có governance chạy được;
  - `committee: List<VerificationKeyHash>`, `threshold: Int`;
  - `sealed: Bool`;
  - `pending: Option<Pending>`, với `Pending { new_hash: ByteArray, effective_after_ms: Int }`.
- Tham số validator: `pointer_policy` (để tự nhận NFT), `change_delay_ms`.

### Luật chi `governance_pointer` (mọi nhánh)
- NFT con trỏ đi vào và ra đúng 1, quay về CHÍNH địa chỉ đó, kèm datum inline. Không đúc, không đốt NFT con trỏ.
- `CommitteePropose(new_hash)`:
  - chỉ khi `sealed == False`; committee duyệt (`threshold` chữ ký trong `committee`);
  - `new_hash` dài 28 byte;
  - ra: `pending = Some{new_hash, effective_after_ms = lower_bound + change_delay_ms}`. Mọi trường khác giữ nguyên.
- `ApplyPending`:
  - ai cũng gọi được;
  - `pending = Some(p)` và `validity lower_bound >= p.effective_after_ms`;
  - ra: `governance_hash = p.new_hash`, `pending = None`, còn lại giữ nguyên.
- `CommitteeCancel`: chỉ khi chưa niêm phong; committee duyệt; ra `pending = None`.
- `Seal`:
  - chỉ khi chưa niêm phong; committee duyệt;
  - `governance_hash` dài 28 byte, `pending == None`;
  - ra: `sealed = True`. Một chiều: không nhánh nào đặt lại `False`.
- `GovernanceSet(new_hash)`:
  - Chỉ khi `governance_hash` dài 28 byte.
  - Có reference input mang đúng 1 token policy = `governance_hash`, nằm ở `Script(governance_hash)`, datum `ProposalResult` với `status == Executed`.
  - Tên NFT == `proposal_id`, như `release.read_proposal`.
  - Proposal cam kết đúng việc đổi con trỏ: `spend_spec_hash == blake2b_256(0x04 ‖ pointer_policy ‖ new_hash)`. Domain tag 0x04 tách khỏi 0x03 của Release.
  - Ra: `governance_hash = new_hash`, `pending = None`. Áp được cả khi đã niêm phong.

### Custody đọc con trỏ
- Bỏ tham số `proposal_policy` của `custody`, hoặc giữ nhưng bỏ qua (bên hiện thực chọn, ghi lý do).
- `release.read_proposal` nhận thêm reference input mang NFT con trỏ, có policy `== datum.governance_ref`, nằm ở địa chỉ có payment credential `Script` của `governance_pointer`.
  - Hash script `governance_pointer` là tham số mới của custody, hoặc được ép qua datum con trỏ. Bên hiện thực chọn cách không vòng hash.
  - Lấy `g = PointerDatum.governance_hash`, đòi `length(g) == 28`; con trỏ rỗng ⇒ Release bị từ chối.
  - Sau đó giữ nguyên C-REL-1, với `governance_ref := g` và `proposal_policy := g`.
- Mọi bất biến C-REL-3..7 giữ nguyên.

## Bất biến không được phá
- KHÔNG đổi kiểu `CustodyDatum`, KHÔNG sửa `custody_seed.ak`, `oneshot_nft`, `treasury_nft`, `lamp_mint`.
- Kiểm bằng chạy khô genesis có ghim hạt giống:
  - `EXPECTED_LAMP_PID=493002cc03004e3e14fd607cfba59312bd946e478e69d6ab431ccfac`;
  - lệnh mẫu trong `_Agents/topics/f1-close-in-genesis-impl.md`.
- Hash `custody`, `reserve_draw` ĐƯỢC đổi (trước genesis).

## Genesis
- NFT con trỏ đúc ở một giao dịch riêng (Tx P), TRƯỚC Tx A0, theo hạt giống ghim `POINTER_SEED_TX/IDX`.
  - Datum đầu: `governance_hash = #""`, `committee = [pkh vận hành]`, `threshold = 1`, `sealed = False`, `pending = None`.
- `CustodyDatum.governance_ref` = policy NFT con trỏ. Bỏ biến `GOVERNANCE_SCRIPT_HASH` khỏi đường genesis.
- `change_delay_ms`: Preprod `3_600_000` (1 giờ, để diễn tập). Mainnet 6 epoch (mục "Đã chốt").

## Bài kiểm bắt buộc
- Mỗi nhánh có ca dương, và ca âm cho từng vế. Ví dụ:
  - Propose khi đã niêm phong;
  - Apply trước hạn;
  - Seal khi con trỏ rỗng;
  - GovernanceSet với proposal ở script khác, sai status, sai `spend_spec_hash`, sai tên NFT;
  - NFT rời địa chỉ;
  - datum đổi trường không được đổi;
  - đặt lại `sealed` thành False.
- Custody Release:
  - con trỏ rỗng ⇒ từ chối;
  - con trỏ giả (NFT policy khác, hoặc ở script khác) ⇒ từ chối;
  - proposal của governance cũ sau khi con trỏ đã đổi ⇒ từ chối.
- Đột biến: gỡ từng vế, bộ kiểm phải đỏ.
