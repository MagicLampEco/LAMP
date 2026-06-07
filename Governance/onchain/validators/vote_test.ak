// Tests validator Vote — CastVote happy; double-vote (sai nullifier) fail;
// C4 vượt cap fail; proposal không Open fail; committee thiếu chữ ký fail.

use aiken/crypto
use aiken/interval
use aiken/primitive/bytearray
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Transaction, placeholder}
use magiclamp/governance/did_stub.{DidCommittee}
use magiclamp/governance/types.{
  Open, ProposalDatum, Tallied, VoteChoice, VoteDatum, Yes,
}
use magiclamp/governance/util
use vote

const null_policy: PolicyId = #"7777"

const prop_policy: PolicyId = #"9901"

const vote_sh: ByteArray = #"c0"

const ms_per_epoch: Int = 432_000_000

const did: ByteArray = #"11"

const prop_id: ByteArray = #"22"

fn committee() -> DidCommittee {
  DidCommittee { signers: [#"a1", #"a2", #"a3"], threshold: 2 }
}

fn null_name() -> ByteArray {
  crypto.blake2b_256(bytearray.concat(did, prop_id))
}

fn vd(choice: VoteChoice, c4: Int, nullifier: ByteArray) -> VoteDatum {
  VoteDatum {
    proposal_id: prop_id,
    did_commit: did,
    nullifier,
    choice,
    c1_capped: 100,
    c2_capped: 100,
    c3_capped: 50,
    c4_capped: c4,
  }
}

// Proposal beacon reference input (mang Proposal NFT) — status truyền vào.
fn proposal_ref(status) -> Input {
  let pd =
    ProposalDatum {
      proposal_id: prop_id,
      status,
      vote_open_epoch: 10,
      vote_close_epoch: 20,
      snapshot_epoch: 10,
      weight_param_ref: util.mk_ref(0),
      spend_spec_hash: #"",
      released_cumulative: 0,
      execute_after_epoch: 22,
      yes_power: 0,
      no_power: 0,
      voter_count: 0,
    }
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  util.mk_input(
    util.mk_ref(5),
    util.mk_output(util.script_address(#"b0"), val, pd),
  )
}

// Vote input UTxO (đang spend) tại vote script hash.
fn vote_input(d: VoteDatum) -> Input {
  let val = assets.from_lovelace(2_000_000)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(vote_sh), val, d),
  )
}

// Cast tx: spend vote UTxO + mint nullifier + ref proposal Open + committee ký + vote output.
fn cast_tx(
  d_in: VoteDatum,
  d_out: VoteDatum,
  mint_name: ByteArray,
  mint_qty: Int,
  prop_status,
  signers: List<ByteArray>,
  epoch_ms: Int,
) -> Transaction {
  let out_val =
    assets.from_lovelace(2_000_000)
      |> assets.add(null_policy, d_out.nullifier, 1)
  let vout = util.mk_output(util.script_address(vote_sh), out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: [vote_input(d_in)],
    reference_inputs: [proposal_ref(prop_status)],
    outputs: [vout],
    mint: assets.zero |> assets.add(null_policy, mint_name, mint_qty),
    extra_signatories: signers,
    // Finding 4: validity_range CÓ BIÊN TRÊN hữu hạn (cùng epoch) — Vote validator dùng
    // upper_bound cho ràng "epoch < đóng". Khoảng nằm trọn trong epoch của epoch_ms.
    validity_range: interval.between(epoch_ms, epoch_ms + ms_per_epoch - 1),
  }
}

fn run_cast(tx: Transaction, d_in: VoteDatum) -> Bool {
  vote.vote.spend(
    null_policy,
    prop_policy,
    committee(),
    ms_per_epoch,
    Some(d_in),
    vote.CastVote { did_proof: #"", cap1: 10_000, cap2: 50_000, cap3: 100 },
    util.mk_ref(0),
    tx,
  )
}

// ── 1. HAPPY: cast vote Yes, nullifier đúng, proposal Open, 2 chữ ký committee ──
test cast_happy() {
  let d = vd(Yes, 2_000_000, null_name())
  // epoch = 15·ms trong [10,20).
  let tx =
    cast_tx(d, d, null_name(), 1, Open, [#"a1", #"a2"], 15 * ms_per_epoch)
  run_cast(tx, d)
}

// ── 2. DOUBLE-VOTE / nullifier SAI: name không = hash(did‖prop) → fail ──
test cast_wrong_nullifier_reject() fail {
  // datum mang nullifier bịa (#"dead") thay vì hash → expect vd.nullifier==want fail.
  let d = vd(Yes, 2_000_000, #"dead")
  let tx = cast_tx(d, d, #"dead", 1, Open, [#"a1", #"a2"], 15 * ms_per_epoch)
  expect run_cast(tx, d)
  True
}

// ── 3. C4 VƯỢT CAP: c4_capped = 100_000_001 > cap4 100 triệu → capped_ok fail ──
test cast_c4_over_cap_reject() fail {
  let d = vd(Yes, 100_000_001, null_name())
  let tx =
    cast_tx(d, d, null_name(), 1, Open, [#"a1", #"a2"], 15 * ms_per_epoch)
  expect run_cast(tx, d)
  True
}

// ── 3b. C4 ĐÚNG CAP biên: c4 = 100_000_000 PHẢI PASS (dấu ≤) ──
test cast_c4_at_cap_passes() {
  let d = vd(Yes, 100_000_000, null_name())
  let tx =
    cast_tx(d, d, null_name(), 1, Open, [#"a1", #"a2"], 15 * ms_per_epoch)
  run_cast(tx, d)
}

// ── 4. PROPOSAL không Open (Tallied) → fail ──
test cast_proposal_not_open_reject() fail {
  let d = vd(Yes, 2_000_000, null_name())
  let tx =
    cast_tx(d, d, null_name(), 1, Tallied, [#"a1", #"a2"], 15 * ms_per_epoch)
  expect run_cast(tx, d)
  True
}

// ── 5. COMMITTEE thiếu chữ ký (1 < threshold 2) → DID stub fail ──
test cast_insufficient_committee_reject() fail {
  let d = vd(Yes, 2_000_000, null_name())
  let tx = cast_tx(d, d, null_name(), 1, Open, [#"a1"], 15 * ms_per_epoch)
  expect run_cast(tx, d)
  True
}

// ── 6. NGOÀI cửa sổ vote (epoch ≥ vote_close 20) → fail ──
test cast_after_close_reject() fail {
  let d = vd(Yes, 2_000_000, null_name())
  let tx =
    cast_tx(d, d, null_name(), 1, Open, [#"a1", #"a2"], 20 * ms_per_epoch)
  expect run_cast(tx, d)
  True
}

// ── 7. Finding 4: validity_range STRADDLE — lower ở epoch 19 (< close 20) nhưng UPPER
//    chạm epoch 20 (= close). Biên cũ (lower_bound) cho '<' sẽ LỌT (19<20 đúng). Sửa
//    dùng upper_bound: epoch_hi=20, 20<20 SAI → FAIL. Chống vote lọt tại epoch đóng. ──
test cast_straddle_close_reject() fail {
  let d = vd(Yes, 2_000_000, null_name())
  let lo = 19 * ms_per_epoch
  let hi = 20 * ms_per_epoch
  // chạm epoch đóng
  let out_val =
    assets.from_lovelace(2_000_000) |> assets.add(null_policy, d.nullifier, 1)
  let vout = util.mk_output(util.script_address(vote_sh), out_val, d)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [vote_input(d)],
      reference_inputs: [proposal_ref(Open)],
      outputs: [vout],
      mint: assets.zero |> assets.add(null_policy, null_name(), 1),
      extra_signatories: [#"a1", #"a2"],
      validity_range: interval.between(lo, hi),
    }
  expect run_cast(tx, d)
  True
}
