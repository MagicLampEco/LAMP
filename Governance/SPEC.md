# Governance — Quản trị Foundation (spec outline)

**Trạng thái:** 🔜 chưa implement. Outline phạm vi để truy vết.

Nguồn chuẩn: `MagicLamp-Docs/docs/Foundation-Bootstrap.md`.

## Phạm vi

- **iVoteSpace**: nền tảng proposal + bỏ phiếu on-chain (Cardano).
- **3 hội đồng**: Điều hành (Executive) / Thành viên (Member) / Hiến pháp (Constitutional).
- **Voting Power (VP)**: công thức `VP = (C1 × C2 × C3)^(1/3)` (§6) — cần chốt với
  MAGIC-LAMP Tokenomic §12 (đang mâu thuẫn: VP 3 thành phần vs time-weighted đơn giản).
- **Bầu cử (Election)**: timeline nhiệm kỳ, ứng cử (ngưỡng LAMP), kiểm phiếu.
- **Recall (bãi miễn)**: ngưỡng co-sign (200/500 DID) + vote (66%/75%).
- **KPI + thưởng** cuối nhiệm kỳ Executive Council bằng LAMP.

## Cần spec onchain (chưa có)

- `Proposal` validator: tạo/đóng proposal, time window.
- `Vote` validator: cast vote, chống double-vote, weight theo VP.
- `Election` + `Recall` validators.
- Anti-sybil: 1 người = 1 phiếu (cần PhoenixKey DID — external dep, chưa có on-chain proof).

## Phụ thuộc

- VP computation cần dữ liệu từ MAGIC (LF, MAGIC consumed) → cross-repo: Governance đọc
  state MAGIC qua reference input. Ranh giới cần thiết kế kỹ.
- Anti-sybil blocker: PhoenixKey on-chain DID proof format (như Distribution Phase 2).
