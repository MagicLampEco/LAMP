// Logic thuần Proposal — projection ProposalDatum → ProposalResult (D10) + lifecycle.
// Tách khỏi validator để test đơn vị (mirror release.ak/collect.ak).
//
// D10: ProposalResult là projection GỌN 5 field Governance phơi ra Proposal UTxO
// (mang NFT one-shot) cho Treasury đọc qua reference input. project() map 12 field
// nội bộ → 5 field khớp BYTE-PERFECT Treasury types.ak:78-84.

use cardano/transaction.{OutputReference}
use magiclamp/governance/types.{
  Executed, ProposalDatum, ProposalResult, ProposalStatus, Tallied,
}

/// Projection D10: ProposalDatum (12 field nội bộ) → ProposalResult (5 field phơi
/// ra Treasury). Map đúng field theo tên. status/spend_spec_hash/execute_after_epoch/
/// released_cumulative lấy thẳng; proposal_id lấy thẳng. yes/no_power, voter_count,
/// vote_*_epoch, weight_param_ref KHÔNG phơi ra (nội bộ).
pub fn project(d: ProposalDatum) -> ProposalResult {
  ProposalResult {
    proposal_id: d.proposal_id,
    status: d.status,
    spend_spec_hash: d.spend_spec_hash,
    execute_after_epoch: d.execute_after_epoch,
    released_cumulative: d.released_cumulative,
  }
}

/// Kiểm output ProposalDatum sau ExecuteProposal là projection-đúng + status=Executed,
/// các field interface Gov→Treasury GIỮ NGUYÊN từ input (Tallied), CHỈ status đổi.
/// Idempotent: input phải đang Tallied (đã set Executed thì project khác → fail vào lại).
pub fn execute_transition_ok(d_in: ProposalDatum, d_out: ProposalDatum) -> Bool {
  and {
    // input PHẢI đang Tallied (chưa Executed) — idempotent: 1 proposal Executed 1 lần.
    d_in.status == Tallied,
    // output status = Executed.
    d_out.status == Executed,
    // các field KHÓA interface giữ nguyên (Treasury so spend_spec_hash + execute_after).
    d_out.proposal_id == d_in.proposal_id,
    d_out.spend_spec_hash == d_in.spend_spec_hash,
    d_out.execute_after_epoch == d_in.execute_after_epoch,
    d_out.released_cumulative == d_in.released_cumulative,
    // kết quả tally đã chốt — giữ nguyên (không sửa power sau khi Tallied).
    d_out.yes_power == d_in.yes_power,
    d_out.no_power == d_in.no_power,
    d_out.voter_count == d_in.voter_count,
    d_out.weight_param_ref == d_in.weight_param_ref,
    d_out.vote_open_epoch == d_in.vote_open_epoch,
    d_out.vote_close_epoch == d_in.vote_close_epoch,
    d_out.snapshot_epoch == d_in.snapshot_epoch,
  }
}

/// status getter tiện cho validator/test.
pub fn status_of(d: ProposalDatum) -> ProposalStatus {
  d.status
}

// ════════════════════════════════════════════════════════════
// Tests — projection (D10 round-trip) + transition
// ════════════════════════════════════════════════════════════

fn mk_datum(status: ProposalStatus) -> ProposalDatum {
  ProposalDatum {
    proposal_id: #"abcd",
    status,
    vote_open_epoch: 10,
    vote_close_epoch: 20,
    snapshot_epoch: 10,
    weight_param_ref: OutputReference { transaction_id: #"00", output_index: 0 },
    spend_spec_hash: #"5ec0",
    released_cumulative: 0,
    execute_after_epoch: 22,
    yes_power: 200,
    no_power: 100,
    voter_count: 30,
  }
}

test project_maps_five_fields() {
  let r = project(mk_datum(Executed))
  and {
    r.proposal_id == #"abcd",
    r.status == Executed,
    r.spend_spec_hash == #"5ec0",
    r.execute_after_epoch == 22,
    r.released_cumulative == 0,
  }
}

test execute_transition_happy() {
  let d_in = mk_datum(Tallied)
  let d_out = mk_datum(Executed)
  execute_transition_ok(d_in, d_out)
}

test execute_transition_rejects_non_tallied_input() fail {
  // input đã Executed → re-execute (idempotent vi phạm) → fail.
  let d_in = mk_datum(Executed)
  let d_out = mk_datum(Executed)
  expect execute_transition_ok(d_in, d_out)
  True
}

test execute_transition_rejects_spec_tamper() fail {
  // output đổi spend_spec_hash (đổi đích chi sau khi duyệt) → fail.
  let d_in = mk_datum(Tallied)
  let d_out = ProposalDatum { ..mk_datum(Executed), spend_spec_hash: #"dead" }
  expect execute_transition_ok(d_in, d_out)
  True
}
