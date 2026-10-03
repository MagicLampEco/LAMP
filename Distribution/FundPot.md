# FundPot — rót trọn một phân bổ từ kho Treasury vào một pot script

Phiên bản 1.0 (2026-10-03). Nằm cạnh `Distribution/SPEC.md`; validator: `Distribution/onchain/validators/treasury.ak`.

## Vì sao
Trước bản này, tLAMP chỉ rời kho Treasury qua `ReleaseForRedeem`, tức là đi kèm một lượt Redeem của `claim_account` đã vest. Tốc độ nhả vì thế bị giới hạn theo từng cửa sổ.

Một pot của hệ cần nhận trọn phân bổ ngay sau genesis, ví dụ kho Wakeme cần 1.001.000.000 tLAMP. Đó là các script tự phát theo luật riêng: chỉ-vào, mỗi người một suất. Với các pot này, đường nhả dần không làm được việc đó.

Chủ dự án chốt 2026-10-02: thêm nhánh rót pot, do MỘT chữ ký committee duyệt.

## Redeemer
`TreasuryRedeemer` thêm constructor `FundPot` (không trường), đặt **ở cuối** để giữ index của `ReleaseForRedeem` (0), `GrantEntitlement` (1), `Refill` (2).

## Luật on-chain (nhánh `FundPot` của `treasury.spend`)
- **FP-1 committee**: `util.committee_approved(committee, threshold, tx.extra_signatories)`, cùng hàm với `GrantEntitlement`.
- **FP-2 singleton**: đúng 1 input ở script treasury. Input đó mang đúng 1 NFT `TREASURY`.
- **FP-3 carrier quay về**:
  - Đúng 1 output ra ĐÚNG địa chỉ đã vào, mang NFT `TREASURY`, có inline `TreasuryDatum`.
  - `outstanding_entitlement` và mọi trường khác của datum KHÔNG đổi.
  - Lovelace ra ≥ lovelace vào.
- **FP-4 lượng rót**: `funded = lamp_in − lamp_out_carrier`, `funded > 0`. Không token nào khác (trừ ADA) rời carrier.
- **FP-5 đích là pot script**: mọi output KHÁC carrier mà mang LAMP đều phải:
  - (a) có payment credential là `Script`;
  - (b) không phải script treasury, không phải script `claim_account`;
  - (c) có datum inline;
  - (d) tổng LAMP ở các output này = `funded` CHÍNH XÁC.
  Không output nào có payment credential là VerificationKey được mang LAMP.
- **FP-6 khả chi**: `outstanding_entitlement ≤ lamp_out_carrier`, tức sổ nợ vẫn được bảo đảm sau khi rót.
- **FP-7 không đúc**: tx không mint/burn token nào thuộc policy LAMP, policy `treasury_nft` hay `claim_account_nft`.

"Đúng số phân bổ của từng pot" KHÔNG ép on-chain:
- Số lấy từ `Papers/pot-catalog.md` lúc dựng giao dịch (bộ dựng ném nếu lệch).
- Tin cậy ngang với `GrantEntitlement`: cùng chữ ký đó vốn đã cấp được entitlement tuỳ ý trong giới hạn kho.

## Bất biến không được phá (ràng buộc khi hiện thực)
- KHÔNG đổi kiểu `TreasuryDatum`.
- KHÔNG đổi mã nào mà `treasury_nft`, `oneshot_nft`, `lamp_mint`, `custody_seed` biên dịch vào. Policy id tLAMP Preprod đã công bố `493002cc03004e3e14fd607cfba59312bd946e478e69d6ab431ccfac` phải giữ nguyên.
  - Kiểm bằng: chạy khô `Genesis/scripts/20_canonical_genesis.ts` với hạt giống đã ghim (README của lượt đúc) và `EXPECTED_LAMP_PID` = id trên.
- Hash `treasury`, `claim_account` ĐƯỢC đổi.

## Off-chain
- `Distribution/offchain/src/fundPotBuilder.ts` dựng giao dịch theo FP-1..7, nhận vào:
  - pot đích (địa chỉ, script hash, datum inline CBOR);
  - danh sách lượng cho K output, mỗi output ≥ suất D của pot;
  - tổng phải bằng `amount`.
- `Genesis/scripts/fund_pot.ts` chạy builder trên state canonical.
  - Bắt buộc khai `POT_ADDRESS`, `POT_SCRIPT_HASH`, `POT_DATUM_CBOR`, `AMOUNT_OILDROP`, `POT_SHARE_OILDROP`, `POT_OUTPUTS` (K).
  - Soát hình dạng pot bằng `_potShape.ts`. `SUBMIT=false` mặc định.

## Bài kiểm bắt buộc
- Mỗi luật FP-1..FP-7 có một bài âm, đầu vào chỉ khác ca dương ở ĐÚNG luật đó:
  - thiếu chữ ký;
  - hai input treasury;
  - carrier đổi datum;
  - LAMP ra địa chỉ VK;
  - LAMP về claim_account;
  - output pot không datum;
  - tổng pot ≠ funded;
  - funded = 0;
  - nợ > pool sau rót;
  - kèm mint LAMP.
- Một bài dương: K = 3 output.
- Đột biến: gỡ từng luật, bộ kiểm phải đỏ. Ghi kết quả.
