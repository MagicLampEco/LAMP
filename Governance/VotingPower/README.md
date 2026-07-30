# Voting Power — onchain v1

Nền Voting Power (VP) cho governance: cử tri = cá nhân (1 DID = 1 phiếu/proposal),
VP tính từ **≥4 tham số geometric có cap** — token đơn thuần **không** mua được quyền lực.
Đặc tả: [`CONTRACT.md`](./CONTRACT.md) · [`Math-Spec.md`](./Math-Spec.md) · [`Tech-Spec.md`](./Tech-Spec.md) · [`Exec-Spec.md`](./Exec-Spec.md).

## Trạng thái test (commit `e637f83`)

| Tầng | Lệnh | Kết quả |
|---|---|---|
| On-chain (Aiken PlutusV3) | `cd Governance/onchain && aiken check` | **90 pass / 0 fail** |
| Off-chain (vitest) | — | Không áp dụng — v1 **chỉ on-chain**, chưa có `Governance/offchain` |

Validators: `vote` · `proposal` · `proposal_nft` · `tally` · `tally_nft` · `nullifier`.

Bất biến đã xác minh khớp `CONTRACT.md`:
- **VP = tích ≥4 tham số, KHÔNG token-weighted** — `vp_raw = p1·p2·p3·p4 / SCALE³` (`lib/.../power.ak`); geometric ⇒ 1 yếu tố = 0 làm sụp toàn bộ VP; nội suy lõm không thổi phồng VP.
- **Cap C4 chống cá voi** — `cap4_hard = 100_000_000` LAMP, ép cứng trong Vote (test `cast_c4_over_cap_reject` + `cast_c4_at_cap_passes`).
- **1 DID = 1 phiếu/proposal** — nullifier `blake2b_256(did_commit ‖ proposal_id)` sống trong cửa sổ vote (`nullifier.ak`).

## Known limitations (BLOCKER mainnet — không phải blocker merge v1)

Hai mục dưới là **giới hạn có chủ đích của v1**, interface tách sạch để swap sau, nhưng **phải đóng trước mainnet governance**:

1. **C1 = MAGIC đã tiêu thụ** đúng theo spec, nhưng on-chain **chỉ range-check** `c1_capped ≤ cap1`. Giá trị C1 thật đến từ **beacon cross-repo MAGIC (CONTRACT §D9)** — chống-mượn-C1/C2 hiện là *"phụ thuộc xác nhận MAGIC, chưa coi là đã chặn"*. → Cần MAGIC xác nhận định dạng beacon C1/C2.
2. **DID cử tri là committee-multisig STUB** (`lib/.../did_stub.ak`) thay cho proof zk sinh trắc PhoenixKey (ngoài repo, BLOCKER tiên quyết). Ranh giới stub↔thật giữ nguyên chữ ký `verify_did` để swap không đụng validator. → Sybil-resistance v1 dựa vào committee chứng thực, chưa phải mã hoá sinh trắc.
