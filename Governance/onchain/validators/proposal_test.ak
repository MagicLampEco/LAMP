// Tests validator Proposal — ExecuteProposal happy → Executed; idempotent; pass biên.
// Dựng mock tx: Proposal UTxO (NFT) spend + Tally UTxO (NFT) reference (pha Clamped).

use aiken/interval
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/types.{
  Clamped, Executed, ProposalDatum, Summing, Tallied, TallyDatum, TopEntry,
  WeightParam, Yes,
}
use magiclamp/governance/util
use proposal

const prop_policy: PolicyId = #"9901"

const tally_policy: PolicyId = #"7a11"

const wp_policy: PolicyId = #"a0a0"

const prop_sh: ByteArray = #"b0"

const ms_per_epoch: Int = 432_000_000

const prop_id: ByteArray = #"abcd"

const spec_hash: ByteArray = #"5ec0"

fn weight_ref() -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: 0 }
}

// WeightParam ref input mang authenticity token wp_policy, ngưỡng truyền vào.
// output_reference == weight_ref() (khớp d_in.weight_param_ref đã cam kết).
fn wp_datum(
  bft: Int,
  q_vp: Int,
  q_voter: Int,
  th_num: Int,
  th_den: Int,
) -> WeightParam {
  WeightParam {
    k1: [],
    k2: [],
    k3: [],
    k4: [],
    bft_floor: bft,
    quorum_vp_threshold: q_vp,
    quorum_voter_threshold: q_voter,
    theta_num: th_num,
    theta_den: th_den,
  }
}

fn wp_ref(bft: Int, q_vp: Int, q_voter: Int, th_num: Int, th_den: Int) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, #"50", 1)
  let wp = wp_datum(bft, q_vp, q_voter, th_num, th_den)
  Input {
    output_reference: weight_ref(),
    output: util.mk_output(util.script_address(#"a0"), val, wp),
  }
}

fn prop_datum(status, yes_p: Int, no_p: Int, voters: Int) -> ProposalDatum {
  ProposalDatum {
    proposal_id: prop_id,
    status,
    vote_open_epoch: 10,
    vote_close_epoch: 20,
    snapshot_epoch: 10,
    weight_param_ref: weight_ref(),
    spend_spec_hash: spec_hash,
    released_cumulative: 0,
    execute_after_epoch: 22,
    yes_power: yes_p,
    no_power: no_p,
    voter_count: voters,
  }
}

// Tally acc reference input (pha Clamped) mang Tally NFT.
fn tally_ref(yes_eff: Int, no_eff: Int, yes_voters: Int, voters: Int) -> Input {
  let td =
    TallyDatum {
      proposal_id: prop_id,
      phase: Clamped,
      weight_param_ref: weight_ref(),
      yes_power_raw: yes_eff,
      no_power_raw: no_eff,
      abstain_power_raw: 0,
      voters_acc: voters,
      yes_voters_acc: yes_voters,
      top_did_vp: [],
      yes_power_eff: yes_eff,
      no_power_eff: no_eff,
      abstain_power_eff: 0,
    }
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, #"01", 1)
  util.mk_input(
    util.mk_ref(9),
    util.mk_output(util.script_address(tally_sh()), val, td),
  )
}

fn tally_sh() -> ByteArray {
  #"7a"
}

// Proposal UTxO input (mang Proposal NFT) tại prop script hash.
fn prop_input(d: ProposalDatum) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(prop_sh), val, d),
  )
}

// Proposal output (mang NFT) với datum mới.
fn prop_output(d: ProposalDatum) -> Output {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  util.mk_output(util.script_address(prop_sh), val, d)
}

// exec_tx mặc định: dựng WeightParam ref ngưỡng 2/3, bft=21, quorum=0.
fn exec_tx(
  d_in: ProposalDatum,
  d_out: ProposalDatum,
  tally_input: Input,
  lower_ms: Int,
) -> Transaction {
  exec_tx_wp(d_in, d_out, tally_input, lower_ms, wp_ref(21, 0, 0, 2, 3))
}

// exec_tx_wp: cho phép truyền WeightParam ref tùy biến (ngưỡng giả / token sai cho negative-test).
fn exec_tx_wp(
  d_in: ProposalDatum,
  d_out: ProposalDatum,
  tally_input: Input,
  lower_ms: Int,
  wp_input: Input,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [prop_input(d_in)],
    reference_inputs: [tally_input, wp_input],
    outputs: [prop_output(d_out)],
    validity_range: interval.after(lower_ms),
  }
}

fn run_exec(tx: Transaction, d_in: ProposalDatum) -> Bool {
  proposal.proposal.spend(
    prop_policy,
    tally_policy,
    tally_sh(),
    wp_policy,
    ms_per_epoch,
    Some(d_in),
    proposal.ExecuteProposal,
    util.mk_ref(0),
    tx,
  )
}

// ── 1. HAPPY: Tallied → Executed, pass đạt (yes=200 no=100, 2/3, 21 DID thuận) ──
test execute_happy() {
  let d_in = prop_datum(Tallied, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let tin = tally_ref(200, 100, 21, 30)
  // epoch = 25·ms ≥ execute_after 22.
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  run_exec(tx, d_in)
}

// ── 2. BIÊN: yes·θ_den == base·θ_num (yes=2 no=1, 2/3) PHẢI PASS (D1 dấu ≥) ──
test execute_boundary_exact_passes() {
  let d_in = prop_datum(Tallied, 2, 1, 21)
  let d_out = prop_datum(Executed, 2, 1, 21)
  let tin = tally_ref(2, 1, 21, 21)
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  run_exec(tx, d_in)
}

// ── 3. IDEMPOTENT: input đã Executed → re-execute fail (execute_transition_ok) ──
test execute_idempotent_reject() fail {
  let d_in = prop_datum(Executed, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let tin = tally_ref(200, 100, 21, 30)
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ── 4. SÀN CỨNG: yes_voters=20 < F=21 → pass fail dù tỷ lệ đạt ──
test execute_hard_floor_reject() fail {
  let d_in = prop_datum(Tallied, 300, 0, 25)
  let d_out = prop_datum(Executed, 300, 0, 25)
  let tin = tally_ref(300, 0, 20, 25)
  // 20 < 21
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ── 5. TIME-LOCK: epoch < execute_after_epoch → fail ──
test execute_timelock_reject() fail {
  let d_in = prop_datum(Tallied, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let tin = tally_ref(200, 100, 21, 30)
  // epoch = 21·ms < execute_after 22.
  let tx = exec_tx(d_in, d_out, tin, 21 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ── 6. JUST BELOW 2/3: yes=199 no=101 → fail ──
test execute_below_threshold_reject() fail {
  let d_in = prop_datum(Tallied, 199, 101, 30)
  let d_out = prop_datum(Executed, 199, 101, 30)
  let tin = tally_ref(199, 101, 21, 30)
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ════════════════════════════════════════════════════════════
// Audit GAME-1 regression — guard mới (phase Clamped + clamp + gốc script hash)
// ════════════════════════════════════════════════════════════

// Tally ref TÙY BIẾN: phase + script hash để mô phỏng forgery.
fn tally_ref_custom(td: TallyDatum, at_hash: ByteArray) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, #"01", 1)
  util.mk_input(
    util.mk_ref(9),
    util.mk_output(util.script_address(at_hash), val, td),
  )
}

// ── 7. GAME-1 #1: Tally pha Summing với yes_power_eff thổi phồng → ExecuteProposal
//    PHẢI fail (expect td.phase == Clamped). Tỷ lệ/quorum/sàn đều "đạt" nếu tin eff. ──
test execute_summing_phase_reject() fail {
  let d_in = prop_datum(Tallied, 400, 0, 30)
  let d_out = prop_datum(Executed, 400, 0, 30)
  // raw bịa nhỏ, eff thổi 400 — nếu không ép phase, pass() đạt.
  let td =
    TallyDatum {
      proposal_id: prop_id,
      phase: Summing,
      weight_param_ref: weight_ref(),
      yes_power_raw: 50,
      no_power_raw: 0,
      abstain_power_raw: 0,
      voters_acc: 30,
      yes_voters_acc: 21,
      top_did_vp: [],
      yes_power_eff: 400,
      no_power_eff: 0,
      abstain_power_eff: 0,
    }
  let tin = tally_ref_custom(td, tally_sh())
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ── 8. GAME-1 #1 defense-in-depth: pha Clamped NHƯNG yes_power_eff KHÔNG khớp
//    apply_clamp (whale vp_raw=400 > cap chưa bị trừ) → clamp_consistent fail. ──
test execute_inconsistent_clamp_reject() fail {
  let d_in = prop_datum(Tallied, 400, 0, 30)
  let d_out = prop_datum(Executed, 400, 0, 30)
  // ΣVP_raw = 500, F=21 → cap = 23. Whale Yes vp_raw=400 vượt cap → excess=377.
  // apply_clamp ⇒ yes_eff = 400−377 = 23. Datum bịa yes_power_eff=400 → KHÔNG nhất quán.
  let td =
    TallyDatum {
      proposal_id: prop_id,
      phase: Clamped,
      weight_param_ref: weight_ref(),
      yes_power_raw: 400,
      no_power_raw: 100,
      abstain_power_raw: 0,
      voters_acc: 30,
      yes_voters_acc: 21,
      top_did_vp: [TopEntry { vp_raw: 400, choice: Yes }],
      yes_power_eff: 400,
      no_power_eff: 100,
      abstain_power_eff: 0,
    }
  let tin = tally_ref_custom(td, tally_sh())
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ── 9. GAME-1 #2: Tally UTxO giả MANG NFT nhưng ở SCRIPT HASH KHÁC (không phải
//    tally_script_hash đã tham số hóa) → read_tally không tìm thấy ref → fail. ──
test execute_forged_tally_wrong_script_reject() fail {
  let d_in = prop_datum(Tallied, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let td =
    TallyDatum {
      proposal_id: prop_id,
      phase: Clamped,
      weight_param_ref: weight_ref(),
      yes_power_raw: 200,
      no_power_raw: 100,
      abstain_power_raw: 0,
      voters_acc: 30,
      yes_voters_acc: 21,
      top_did_vp: [],
      yes_power_eff: 200,
      no_power_eff: 100,
      abstain_power_eff: 0,
    }
  // NFT thật, datum hợp lệ, NHƯNG đặt tại script hash kẻ tấn công #"dead" ≠ tally_sh().
  let tin = tally_ref_custom(td, #"dead")
  let tx = exec_tx(d_in, d_out, tin, 25 * ms_per_epoch)
  expect run_exec(tx, d_in)
  True
}

// ════════════════════════════════════════════════════════════
// Finding 1 regression — ngưỡng ĐỌC TỪ WeightParam UTxO, KHÔNG redeemer
// ════════════════════════════════════════════════════════════

// WeightParam ref TÙY BIẾN: token policy + output_reference để mô phỏng giả mạo ngưỡng.
fn wp_ref_custom(
  pol: PolicyId,
  or_ref: OutputReference,
  bft: Int,
  q_vp: Int,
  q_voter: Int,
  th_num: Int,
  th_den: Int,
) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(pol, #"50", 1)
  Input {
    output_reference: or_ref,
    output: util.mk_output(
      util.script_address(#"a0"),
      val,
      wp_datum(bft, q_vp, q_voter, th_num, th_den),
    ),
  }
}

// ── 10. Finding 1: WeightParam mang TOKEN SAI policy (#"beef" ≠ wp_policy). Kẻ tấn công
//    đặt ngưỡng giả bft=1,quorum=0,θ=0/1 (pass luôn) nhưng token sai → read_weight_param
//    không tìm thấy ref hợp lệ → fail. NGƯỠNG GIẢ KHÔNG QUA. ──
test execute_forged_wp_wrong_token_reject() fail {
  let d_in = prop_datum(Tallied, 199, 101, 30)
  // 199<2/3 — phải fail nếu ngưỡng thật
  let d_out = prop_datum(Executed, 199, 101, 30)
  let tin = tally_ref(199, 101, 21, 30)
  // ngưỡng giả pass-luôn nhưng token sai policy.
  let bad_wp = wp_ref_custom(#"beef", weight_ref(), 1, 0, 0, 0, 1)
  let tx = exec_tx_wp(d_in, d_out, tin, 25 * ms_per_epoch, bad_wp)
  expect run_exec(tx, d_in)
  True
}

// ── 11. Finding 1: WeightParam đúng token NHƯNG output_reference KHÁC weight_param_ref
//    đã cam kết lúc OpenProposal → không khớp → read không tìm thấy → fail. ──
test execute_forged_wp_wrong_ref_reject() fail {
  let d_in = prop_datum(Tallied, 199, 101, 30)
  let d_out = prop_datum(Executed, 199, 101, 30)
  let tin = tally_ref(199, 101, 21, 30)
  let other_ref = OutputReference { transaction_id: #"ff", output_index: 9 }
  // token đúng, ngưỡng giả pass-luôn, nhưng ref KHÔNG khớp d_in.weight_param_ref.
  let bad_wp = wp_ref_custom(wp_policy, other_ref, 1, 0, 0, 0, 1)
  let tx = exec_tx_wp(d_in, d_out, tin, 25 * ms_per_epoch, bad_wp)
  expect run_exec(tx, d_in)
  True
}

// ── 12. Finding 1: WeightParam authentic (token + ref đúng) nhưng bft_floor=0 → expect
//    wp.bft_floor ≥ 1 fail (chống ngưỡng 0 — mẫu trần clamp + sàn cứng vô nghĩa). ──
test execute_wp_bft_zero_reject() fail {
  let d_in = prop_datum(Tallied, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let tin = tally_ref(200, 100, 21, 30)
  let bad_wp = wp_ref_custom(wp_policy, weight_ref(), 0, 0, 0, 2, 3)
  let tx = exec_tx_wp(d_in, d_out, tin, 25 * ms_per_epoch, bad_wp)
  expect run_exec(tx, d_in)
  True
}

// ── 13. Finding 1 POSITIVE: cùng tally 199/101 NHƯNG WeightParam authentic đặt θ=1/2
//    (ngưỡng thấp hợp lệ do DAO) → 199·2=398 ≥ 300·1=300 PASS. Chứng minh ngưỡng ĐẾN
//    từ WeightParam authentic điều khiển kết quả (không phải redeemer). ──
test execute_wp_controls_threshold() {
  let d_in = prop_datum(Tallied, 199, 101, 30)
  let d_out = prop_datum(Executed, 199, 101, 30)
  let tin = tally_ref(199, 101, 21, 30)
  let wp = wp_ref_custom(wp_policy, weight_ref(), 21, 0, 0, 1, 2)
  let tx = exec_tx_wp(d_in, d_out, tin, 25 * ms_per_epoch, wp)
  run_exec(tx, d_in)
}
