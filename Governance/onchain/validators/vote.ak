// Validator 2 — Vote (1 phiếu = 1 UTxO, nullifier chống double-vote). TECH §4.
//
// CastVote kiểm (thứ tự fail sớm):
//   1. Nullifier mint đúng: name == blake2b_256(did_commit‖proposal_id), qty +1 policy nullifier.
//   2. Proposal đang Open (đọc qua REFERENCE INPUT mang Proposal NFT — không tiêu).
//      vote_open_epoch ≤ epoch < vote_close_epoch.
//   3. DID proof hợp lệ (STUB committee multisig — did_stub.verify_did; PhoenixKey thật sau).
//   4. c*_capped trong [0, cap_k]: c1/c2/c3 ≤ cap (đọc redeemer caps), c4 ≤ 100_000_000 (cứng).
//      v1 STUB: cap1..3 truyền qua redeemer (UTxO tham số là mở rộng EXEC; ref input C_k thật
//      cần MAGIC encoding did_commit byte-perfect — D9, đánh dấu cho audit).
//   5. Vote output tại Vote script hash mang nullifier + datum khớp redeemer.
//
// RetractVote: đổi choice TẠI CHỖ, GIỮ nullifier (KHÔNG burn-rồi-vote-lại — TECH §6.4).
//
// Tham số hóa: nullifier_policy, proposal_policy (NFT proposal để xác thực ref), committee, ms_per_epoch.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use magiclamp/governance/did_stub.{DidCommittee, verify_did}
use magiclamp/governance/types.{Open, ProposalDatum, VoteDatum}
use magiclamp/governance/util

/// cap4 cứng = 100 triệu LAMP (CONTRACT §3 — ngoại lệ "tham số mở").
pub const cap4_hard: Int = 100_000_000

pub type VoteRedeemer {
  CastVote {
    did_proof: ByteArray,
    // [EXTERNAL — PhoenixKey; v1 STUB không dùng, committee ký tx]
    cap1: Int,
    // cap C1 (DAO-param; v1 qua redeemer)
    cap2: Int,
    cap3: Int,
  }
  RetractVote
}

/// nullifier name canonical (đồng bộ nullifier.ak).
fn nullifier_name(did_commit: ByteArray, proposal_id: ByteArray) -> ByteArray {
  crypto.blake2b_256(bytearray.concat(did_commit, proposal_id))
}

/// Đọc Proposal đang Open qua reference input mang Proposal NFT (xác thực, không tiêu).
fn read_open_proposal(
  reference_inputs: List<Input>,
  proposal_policy: PolicyId,
) -> ProposalDatum {
  expect Some(ref) =
    list.find(
      reference_inputs,
      fn(i) { dict.size(assets.tokens(i.output.value, proposal_policy)) == 1 },
    )
  expect [Pair(_, qty)] =
    dict.to_pairs(assets.tokens(ref.output.value, proposal_policy))
  expect qty == 1
  expect InlineDatum(d) = ref.output.datum
  expect pd: ProposalDatum = d
  pd
}

/// c*_capped đã cap đúng: 0 ≤ c ≤ cap.
fn capped_ok(c: Int, cap: Int) -> Bool {
  c >= 0 && c <= cap
}

validator vote(
  nullifier_policy: PolicyId,
  proposal_policy: PolicyId,
  committee: DidCommittee,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<VoteDatum>,
    redeemer: VoteRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(vd) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    when redeemer is {
      CastVote { did_proof: _did_proof, cap1, cap2, cap3 } -> {
        // Biên thời gian (Finding 4): ràng "mở ≤ epoch" lấy LOWER bound (toàn khoảng ≥ open);
        // ràng "epoch < đóng" lấy UPPER bound (TOÀN khoảng < đóng) — lower_bound cho '<' sai
        // hướng, lọt vote tại epoch đóng. Hai biên độc lập cho hai bất đẳng thức ngược chiều.
        let epoch_lo = util.get_epoch(tx, ms_per_epoch)
        let epoch_hi = util.get_epoch_upper(tx, ms_per_epoch)
        // 1. Nullifier mint đúng name + qty 1 policy nullifier.
        let want_name = nullifier_name(vd.did_commit, vd.proposal_id)
        expect vd.nullifier == want_name
        let null_tokens = assets.tokens(tx.mint, nullifier_policy)
        expect dict.size(null_tokens) == 1
        expect assets.quantity_of(tx.mint, nullifier_policy, want_name) == 1
        // 2. Proposal đang Open + trong cửa sổ vote.
        let p = read_open_proposal(tx.reference_inputs, proposal_policy)
        expect p.proposal_id == vd.proposal_id
        expect p.status == Open
        expect p.vote_open_epoch <= epoch_lo
        expect epoch_hi < p.vote_close_epoch
        // 3. DID proof (STUB committee multisig). _did_proof reserved cho PhoenixKey thật.
        expect verify_did(committee, vd.did_commit, tx.extra_signatories)
        // 4. c*_capped trong [0, cap_k]; c4 cap cứng 100 triệu.
        expect capped_ok(vd.c1_capped, cap1)
        expect capped_ok(vd.c2_capped, cap2)
        expect capped_ok(vd.c3_capped, cap3)
        expect capped_ok(vd.c4_capped, cap4_hard)
        // 5. Vote output tại Vote script hash mang nullifier + datum khớp.
        let out = util.output_at_script(tx.outputs, own_hash)
        expect InlineDatum(od) = out.datum
        expect out_vd: VoteDatum = od
        and {
          assets.quantity_of(out.value, nullifier_policy, want_name) == 1,
          out_vd == vd,
        }
      }

      // RetractVote: đổi choice TẠI CHỖ, GIỮ nullifier (không burn). proposal còn Open.
      RetractVote -> {
        let p = read_open_proposal(tx.reference_inputs, proposal_policy)
        expect p.proposal_id == vd.proposal_id
        expect p.status == Open
        let out = util.output_at_script(tx.outputs, own_hash)
        expect InlineDatum(od) = out.datum
        expect out_vd: VoteDatum = od
        // KHÔNG đổi nullifier/did/proposal/c*; CHỈ choice được đổi.
        and {
          out_vd.nullifier == vd.nullifier,
          out_vd.did_commit == vd.did_commit,
          out_vd.proposal_id == vd.proposal_id,
          out_vd.c1_capped == vd.c1_capped,
          out_vd.c2_capped == vd.c2_capped,
          out_vd.c3_capped == vd.c3_capped,
          out_vd.c4_capped == vd.c4_capped,
          // nullifier token GIỮ trong output (không burn).
          assets.quantity_of(out.value, nullifier_policy, vd.nullifier) == 1,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
