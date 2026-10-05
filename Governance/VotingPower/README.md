# Voting Power — onchain v1

Nền Voting Power (VP) cho governance: cử tri = cá nhân (1 DID = 1 phiếu/proposal),
VP tính từ **≥4 tham số geometric có cap** — token đơn thuần **không** mua được quyền lực.
Đặc tả: [`CONTRACT.md`](./CONTRACT.md) · [`Math-Spec.md`](./Math-Spec.md) · [`Tech-Spec.md`](./Tech-Spec.md) · [`Exec-Spec.md`](./Exec-Spec.md).

## Trạng thái kiểm tra

| Tầng | Lệnh | Kết quả |
|---|---|---|
| On-chain (Aiken PlutusV3) | `cd Governance/onchain && aiken check` | chạy lệnh, đọc dòng tổng kết ở output |
| Off-chain (vitest) | `cd Governance/offchain && npx vitest run` | chạy lệnh, đọc dòng tổng kết ở output |

Số bài kiểm đổi theo từng lượt sửa nên tài liệu này không ghi con số.

Validators trong `Governance/onchain/validators/`: `vote` · `proposal` · `proposal_nft` · `tally` ·
`tally_nft` · `nullifier` (sáu validator v1) cùng `governance` · `weight_param_nft` (kiến trúc v2,
[`../SPEC.md`](../SPEC.md) §Kiến trúc on-chain v2). Đã có SDK dựng giao dịch ở `Governance/offchain/`
(`openProposalBuilder`, `voteBuilders`, `tallyBuilders`, `finalizeProposalBuilder`, …). `../SPEC.md`
có thể còn câu "chưa có mã" — khi lệch với thư mục `onchain/` và `offchain/`, mã thắng.

**Triển khai:** Governance **chưa được triển khai** (kho không ghi hash hay địa chỉ đã áp tham số
của Governance; chưa truy chuỗi để xác nhận). Chưa có đường thông qua một proposal chi tiền: xem mục
Known limitations.

Bất biến đã xác minh khớp `CONTRACT.md` (xác minh ở commit `e637f83`; chưa kiểm lại sau các thay đổi v2 và C1):
- **VP = tích ≥4 tham số, KHÔNG token-weighted** — `vp_raw = p1·p2·p3·p4 / SCALE³` (`lib/.../power.ak`); geometric ⇒ 1 yếu tố = 0 làm sụp toàn bộ VP; nội suy lõm không thổi phồng VP.
- **Cap C4 chống cá voi** — `cap4_hard = 100_000_000` LAMP, ép cứng trong Vote (test `cast_c4_over_cap_reject` + `cast_c4_at_cap_passes`).
- **1 DID = 1 phiếu/proposal** — nullifier `blake2b_256(did_commit ‖ proposal_id)` sống trong cửa sổ vote (`nullifier.ak`).

## Known limitations (BLOCKER mainnet — không phải blocker merge v1)

Ba mục dưới là **giới hạn đã biết**, interface tách sạch để swap sau, nhưng **phải đóng trước mainnet governance**:

1. **C1 = MAGIC đã tiêu thụ.** Khi danh sách `engage_policies` của `tally` khác rỗng, C1 được bật: mỗi phiếu phải có `0 ≤ c1_capped ≤ cap1` và `c1_capped` không vượt giá trị MAGIC đã tiêu thụ đọc từ thread của MAGIC (`tally.ak` ▸ nhánh `c1_on`, `engage.attested_c1`). Danh sách rỗng thì `c1_capped` bị ép bằng 0. Định dạng thread phía MAGIC vẫn là phụ thuộc cross-repo (CONTRACT §D9) — chống-mượn-C1 chưa coi là đã chặn nếu MAGIC chưa xác nhận.
2. **C2 và C4 chưa có nguồn on-chain: `tally` ép `c2_capped == 0` và `c4_capped == 0`** (`tally.ak`, cùng khối kiểm với C1). VP là tích các tham số, nên một thừa số bằng 0 làm VP bằng 0 — chưa có đường thông qua một proposal bằng VP thật cho tới khi C2/C4 có nguồn.
3. **DID cử tri là committee-multisig STUB** (`lib/.../did_stub.ak`) thay cho proof zk sinh trắc PhoenixKey (ngoài repo, BLOCKER tiên quyết). Ranh giới stub↔thật giữ nguyên chữ ký `verify_did` để swap không đụng validator. → Sybil-resistance v1 dựa vào committee chứng thực, chưa phải mã hoá sinh trắc.
