// Governance onchain types — interface contract (CONTRACT §5 D1–D10; TECH §3,§4,§9).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).
//
// Phạm vi v1: KHÉP vòng Treasury Release (Model A). Bốn validator lõi:
//   Proposal (vòng đời + ExecuteProposal ép ngưỡng), Tally (2 pha Summing→Clamped),
//   Vote (nullifier chống double-vote). Recall để v1.x.
//
// ┌─ KHÓA byte-perfect (CONTRACT §5 D10) ──────────────────────────────────────┐
// │ ProposalStatus {Open, Tallied, Executed, Rejected}  — Constr index 0,1,2,3 │
// │ ProposalResult 5 field — KHỚP Treasury/onchain/.../types.ak:78-84.          │
// │ Đây là projection GỌN Governance phơi ra Proposal UTxO (NFT one-shot) cho   │
// │ Treasury đọc qua REFERENCE INPUT. KHÔNG để Treasury decode ProposalDatum    │
// │ 12 field. status=Executed = index 2 (KHÔNG có "Closed" → decode-fail UTxO   │
// │ thật nếu lệch thứ tự).                                                       │
// └────────────────────────────────────────────────────────────────────────────┘

use cardano/transaction.{OutputReference}
use magiclamp/governance/power.{Knot}

/// Trạng thái proposal. THỨ TỰ KHÓA (D10): index 0=Open, 1=Tallied, 2=Executed,
/// 3=Rejected. Phải khớp byte-perfect Treasury ProposalStatus (cùng thứ tự).
/// Tech-Spec.md draft cũ ghi {Open, Closed, Tallied, Executed} — SAI, đã sửa theo D10:
/// "Closed" KHÔNG tồn tại trong type phơi ra Treasury (vòng đời nội bộ dùng phase
/// của Tally + status Proposal; "đóng vote" là CloseVoting redeemer, không phải
/// một biến thể của ProposalStatus phơi ra).
pub type ProposalStatus {
  Open
  Tallied
  Executed
  Rejected
}

/// Beacon kết quả Governance — projection GỌN phơi ở Proposal UTxO mang Proposal
/// authenticity NFT one-shot. Treasury Release ĐỌC qua REFERENCE INPUT (CIP-31).
/// 5 FIELD KHỚP BYTE-PERFECT Treasury types.ak:78-84 (D10).
/// spend_spec_hash = blake2b_256(0x02 ‖ cbor.serialise(draws)) — cùng domain tag
/// 0x02 với Treasury release.spend_spec_hash (khóa đích chi ai/bao nhiêu).
pub type ProposalResult {
  proposal_id: ByteArray,
  status: ProposalStatus,
  spend_spec_hash: ByteArray,
  execute_after_epoch: Int,
  released_cumulative: Int,
}

/// Lựa chọn phiếu. Constr 0=Yes, 1=No, 2=Abstain.
pub type VoteChoice {
  Yes
  No
  Abstain
}

/// Datum nội bộ Proposal (D2) — 12 field. DÙNG NỘI BỘ cho Tally/Vote/lifecycle;
/// KHÔNG phơi ra Treasury (Treasury chỉ đọc ProposalResult projection ở trên).
/// 3 field interface Gov→Treasury (D2, HARD BLOCKER Release):
///   spend_spec_hash, released_cumulative, execute_after_epoch.
pub type ProposalDatum {
  proposal_id: ByteArray,
  // 1  = hash nội dung đề xuất (off-chain doc hash)
  status: ProposalStatus,
  // 2  vòng đời (Open→Tallied→Executed/Rejected)
  vote_open_epoch: Int,
  // 3  epoch bắt đầu nhận phiếu
  vote_close_epoch: Int,
  // 4  epoch đóng (tham số mở)
  snapshot_epoch: Int,
  // 5  epoch khóa snapshot C4 (= vote_open_epoch)
  weight_param_ref: OutputReference,
  // 6  UTxO bảng weight/cap/bft_floor cho proposal này
  // --- interface Gov→Treasury (D2) — HARD BLOCKER cho Release ---
  spend_spec_hash: ByteArray,
  // 7  hash canonical (bucket,asset,amount,to) đã duyệt; b"" nếu không chi
  released_cumulative: Int,
  // 8  tổng đã giải ngân qua nhiều tx — chống chi vượt
  execute_after_epoch: Int,
  // 9  mốc time-lock: Execute/Release chỉ hợp lệ khi epoch ≥ giá trị này
  // --- kết quả (điền khi Tallied — power ĐÃ CLAMP, §9.5.1) ---
  yes_power: Int,
  // 10 tổng VP_eff phe THUẬN
  no_power: Int,
  // 11 tổng VP_eff phe CHỐNG
  voter_count: Int,
}

// 12 số DID đã vote (quorum theo người)

/// Bảng tham số DAO (weight/cap/ngưỡng) — datum của Weight-Param UTxO mang authenticity
/// token (weight_param_policy). Theo CONTRACT D1 ("θ đọc từ UTxO tham số") + D7/D8:
/// MỌI ngưỡng pass + bảng tra VP nằm Ở ĐÂY, KHÔNG nhận từ redeemer (chống bypass —
/// audit Finding 1). Proposal cam kết weight_param_ref lúc OpenProposal → Execute/Finalize
/// PHẢI đọc đúng UTxO này (token xác thực + khớp ref đã cam kết).
///
/// k1..k4: bảng knots pow_k cho 4 yếu tố (D7, nội suy). bft_floor/quorum/θ: ngưỡng pass (D1).
/// Ràng D8 ép TRÊN CHUỖI, không off-chain: `weight_guard.d8_ok` gọi trong
/// `validators/tally.ak:read_weight_param` — đường DUY NHẤT bảng knots đi vào phép tính VP.
/// Ép dạng TỪNG CẶP (`w_1 ≥ w_2` ∧ `w_3 ≥ w_4`) chứ không dạng tổng `w_2+w_4 ≤ w_1+w_3`:
/// dạng tổng nhận cả `w = (0.5, 0, 0, 0.5)`, mà `w_3 = 0` tắt hẳn thừa số uy tín. Lập luận
/// đầy đủ + cách kiểm quan hệ w_k thẳng trên bảng knots: `lib/.../weight_guard.ak` đầu tệp.
/// on-chain chốt nguồn ngưỡng DUY NHẤT là UTxO này.
pub type WeightParam {
  k1: List<Knot>,
  k2: List<Knot>,
  k3: List<Knot>,
  k4: List<Knot>,
  bft_floor: Int,
  // F — sàn cứng + mẫu trần clamp τ=ΣVP/F
  quorum_vp_threshold: Int,
  // quorum theo VP
  quorum_voter_threshold: Int,
  // quorum theo người
  theta_num: Int,
  // θ_num (mặc định 2)
  theta_den: Int,
}

// θ_den (mặc định 3)

/// Datum phiếu (D5 — BỎ vp_claimed). Vote chỉ chốt 4 đầu vào c*_capped đã cap;
/// Tally tự tính power qua bảng tra (KHÔNG tin số VP off-chain mớm).
pub type VoteDatum {
  proposal_id: ByteArray,
  // phải khớp Proposal đang Open
  did_commit: ByteArray,
  // commitment công khai DID (KHÔNG lộ sinh trắc)
  nullifier: ByteArray,
  // = blake2b_256(did_commit ‖ proposal_id) — chống double-vote
  choice: VoteChoice,
  c1_capped: Int,
  // MAGIC tiêu thụ, đã min(·, cap1)
  c2_capped: Int,
  // ScheduleGen commitment, đã min(·, cap2)
  c3_capped: Int,
  // reputation, đã min(·, cap3)
  c4_capped: Int,
}

// LAMP nắm giữ (registry-DID), đã min(·, cap4=100_000_000)

/// Một ứng viên "DID vượt trần" — bằng chứng để pha Clamped trừ đúng phần vượt
/// (D6). vp_raw = VP THÔ (đã quy đổi từ c*_capped qua bảng tra, CHƯA clamp).
pub type TopEntry {
  vp_raw: Int,
  choice: VoteChoice,
}

/// Pha của Tally accumulator (§9.2).
pub type TallyPhase {
  Summing
  // pha 1: cộng power THÔ + đếm DID + duy trì top-(F-1) heap
  Clamped
}

// pha 2: power hiệu dụng sau clamp BFT, sẵn sàng RecordTally

/// Tally accumulator datum (D6 thêm top_did_vp). Một UTxO/proposal mang Tally NFT.
pub type TallyDatum {
  proposal_id: ByteArray,
  phase: TallyPhase,
  // UTxO bảng weight/cap (D7) + ngưỡng — Tally đọc để DERIVE power_raw từ Vote thật
  // (Finding 2) + Finalize lấy bft_floor (Finding 1). PHẢI khớp Proposal.weight_param_ref.
  weight_param_ref: OutputReference,
  // --- pha Summing: tổng power THÔ (chưa clamp) ---
  yes_power_raw: Int,
  no_power_raw: Int,
  abstain_power_raw: Int,
  voters_acc: Int,
  // số DID đã cộng (quorum theo người)
  yes_voters_acc: Int,
  // số DID THUẬN (sàn cứng ≥ bft_floor)
  top_did_vp: List<TopEntry>,
  // top-(F-1) heap, bounded ≤ F-1 (D6)
  // --- pha Clamped: power hiệu dụng sau VP_eff = min(VP_i, ΣVP/F) ---
  yes_power_eff: Int,
  no_power_eff: Int,
  abstain_power_eff: Int,
}
