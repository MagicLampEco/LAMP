// Validator 3 — Tally accumulator (2 pha Summing→Clamped). TECH §9.
//
// Một Tally UTxO/proposal mang Tally NFT. Pha Summing DERIVE power THÔ từ các Vote UTxO
// THẬT bị tiêu trong tx (Finding 2 — KHÔNG nhận delta tùy ý), cộng dồn + đếm DID + đếm
// DID thuận; mỗi Vote gộp PHẢI có nullifier BỊ ĐỐT trong cùng tx (Finding 3 — one-shot,
// không cộng 2 lần). Pha Finalize chuyển Summing→Clamped: ÉP clamp_consistent (power_eff
// == apply_clamp(Summing-data)) — chống off-chain mớm power_eff bịa (§9.5.3), bft_floor
// LẤY TỪ WeightParam (Finding 1 — không redeemer).
//
// Tham số hóa:
//   tally_policy        : NFT bảo toàn acc.
//   vote_script_hash    : hash Vote validator — nguồn Vote UTxO hợp lệ duy nhất.
//   nullifier_policy    : policy nullifier — Tally ÉP đốt nullifier mỗi phiếu gộp.
//   weight_param_policy : authenticity token bảng WeightParam (ngưỡng + bảng knots).

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use magiclamp/governance/tally.{clamp_consistent, sum_batch_consistent,
  top_heap_consistent} as tally_lib
use magiclamp/governance/types.{
  Clamped, Summing, TallyDatum, VoteDatum, WeightParam,
}
use magiclamp/governance/util
use magiclamp/governance/weight_guard

pub type TallyRedeemer {
  // cộng một lô phiếu vào acc (pha Summing). DERIVE power từ Vote inputs thật + đốt nullifier.
  SumBatch
  // Summing → Clamped: ÉP clamp_consistent với bft_floor đọc từ WeightParam.
  Finalize
}

/// Bảo toàn Tally NFT: đúng 1 input + 1 output tại Tally script hash, output mang NFT.
fn nft_preserved(
  own_hash: ByteArray,
  tally_policy: PolicyId,
  tx: Transaction,
) -> Bool {
  let n_in = util.count_inputs_at_script(tx.inputs, own_hash)
  let n_out = util.count_outputs_at_script(tx.outputs, own_hash)
  let out = util.output_at_script(tx.outputs, own_hash)
  and {
    n_in == 1,
    n_out == 1,
    dict.size(assets.tokens(out.value, tally_policy)) == 1,
  }
}

fn out_datum(own_hash: ByteArray, outputs: List<Output>) -> TallyDatum {
  let out = util.output_at_script(outputs, own_hash)
  expect InlineDatum(d) = out.datum
  expect td: TallyDatum = d
  td
}

/// Đọc + xác thực WeightParam qua reference input (CONTRACT D1). Token + khớp ref đã cam
/// kết trong TallyDatum (== Proposal.weight_param_ref qua RecordTally) → đúng bảng knots.
fn read_weight_param(
  reference_inputs: List<Input>,
  weight_param_policy: PolicyId,
  weight_param_ref: OutputReference,
) -> WeightParam {
  expect Some(ref) =
    list.find(
      reference_inputs,
      fn(i) {
        and {
          i.output_reference == weight_param_ref,
          dict.size(assets.tokens(i.output.value, weight_param_policy)) == 1,
        }
      },
    )
  expect [Pair(_, qty)] =
    dict.to_pairs(assets.tokens(ref.output.value, weight_param_policy))
  expect qty == 1
  expect InlineDatum(d) = ref.output.datum
  expect wp: WeightParam = d
  // Cổng D8 — ÉP TẠI ĐÂY, không phải off-chain. Đây là đường DUY NHẤT bảng knots đi vào phép
  // tính VP, nên chặn ở đây là chặn được mọi lối. Bảng vi phạm ⇒ tx fail.
  // Vì sao dạng TỪNG CẶP chứ không dạng TỔNG: `weight_guard.ak` đầu tệp.
  expect weight_guard.d8_ok(wp.k1, wp.k2, wp.k3, wp.k4)
  wp
}

/// Thu thập VoteDatum từ MỌI input tại vote_script_hash (Vote UTxO thật bị tiêu trong tx).
/// Mỗi VoteDatum PHẢI khớp proposal_id của Tally (không gộp phiếu proposal khác).
fn collect_votes(
  inputs: List<Input>,
  vote_script_hash: ByteArray,
  proposal_id: ByteArray,
) -> List<VoteDatum> {
  list.foldr(
    inputs,
    [],
    fn(i, acc) {
      if util.is_at_script(i.output.address, vote_script_hash) {
        expect InlineDatum(d) = i.output.datum
        expect vd: VoteDatum = d
        expect vd.proposal_id == proposal_id
        [vd, ..acc]
      } else {
        acc
      }
    },
  )
}

/// Mỗi phiếu gộp PHẢI có nullifier BỊ ĐỐT (qty −1) trong tx.mint (Finding 3 — one-shot:
/// nullifier tiêu đúng 1 lần → KHÔNG cộng cùng phiếu 2 lần qua nhiều SumBatch). Đếm số
/// token nullifier_policy bị đốt PHẢI == số phiếu trong lô, và mỗi nullifier của phiếu
/// trong lô xuất hiện với qty −1.
fn nullifiers_burned(
  tx: Transaction,
  nullifier_policy: PolicyId,
  votes: List<VoteDatum>,
) -> Bool {
  let burned = assets.tokens(tx.mint, nullifier_policy)
  and {
    // số loại token nullifier trong mint == số phiếu (không thừa, không thiếu).
    dict.size(burned) == list.length(votes),
    // mỗi nullifier của phiếu bị đốt đúng −1.
    list.all(
      votes,
      fn(v) { assets.quantity_of(tx.mint, nullifier_policy, v.nullifier) == -1 },
    ),
  }
}

validator tally(
  tally_policy: PolicyId,
  vote_script_hash: ByteArray,
  nullifier_policy: PolicyId,
  weight_param_policy: PolicyId,
) {
  spend(
    datum_opt: Option<TallyDatum>,
    redeemer: TallyRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d_in) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)
    let d_out = out_datum(own_hash, tx.outputs)

    when redeemer is {
      // ── SumBatch: DERIVE power THÔ từ Vote inputs THẬT (Finding 2) + đốt nullifier ──
      //    (Finding 3). power_raw/voter chỉ tăng đúng tổng phiếu thật; không delta tùy ý.
      SumBatch -> {
        expect d_in.phase == Summing
        let wp =
          read_weight_param(
            tx.reference_inputs,
            weight_param_policy,
            d_in.weight_param_ref,
          )
        let votes = collect_votes(tx.inputs, vote_script_hash, d_in.proposal_id)
        // PHẢI có ≥ 1 phiếu thật trong lô — chống SumBatch rỗng làm no-op che giấu.
        expect list.length(votes) >= 1
        and {
          d_out.phase == Summing,
          // ĐÓNG soundness BFT-cap (D6): heap top-(F-1) PHẢI = canonical merge(heap cũ +
          // vp_raw mỗi phiếu thật trong lô), cắt F−1. Mọi cá voi (vp_raw>ΣVP/F) buộc có
          // mặt → Finalize clamp trừ đúng phần vượt → không DID nào thoát trần. Đồng thời
          // chống nhồi entry giả (mỗi entry ứng 1 vote thật hoặc kế thừa d_in).
          top_heap_consistent(d_in, d_out, wp, votes),
          // power_raw + voter = cũ + DERIVE(phiếu thật) — KHÔNG nhận số tùy ý (Finding 2).
          sum_batch_consistent(d_in, d_out, wp, votes),
          // nullifier mỗi phiếu BỊ ĐỐT trong tx — one-shot, không cộng 2 lần (Finding 3).
          nullifiers_burned(tx, nullifier_policy, votes),
          nft_preserved(own_hash, tally_policy, tx),
        }
      }

      // ── Finalize: Summing → Clamped, ÉP clamp_consistent (power_eff đúng) ──
      //    bft_floor LẤY TỪ WeightParam (Finding 1) — không redeemer.
      Finalize -> {
        expect d_in.phase == Summing
        let wp =
          read_weight_param(
            tx.reference_inputs,
            weight_param_policy,
            d_in.weight_param_ref,
          )
        expect wp.bft_floor >= 1
        // power THÔ + đếm + heap GIỮ NGUYÊN từ Summing (chỉ tính power_eff).
        and {
          d_out.phase == Clamped,
          d_out.proposal_id == d_in.proposal_id,
          d_out.weight_param_ref == d_in.weight_param_ref,
          d_out.yes_power_raw == d_in.yes_power_raw,
          d_out.no_power_raw == d_in.no_power_raw,
          d_out.abstain_power_raw == d_in.abstain_power_raw,
          d_out.voters_acc == d_in.voters_acc,
          d_out.yes_voters_acc == d_in.yes_voters_acc,
          d_out.top_did_vp == d_in.top_did_vp,
          // ÉP clamp đúng: power_eff == apply_clamp(d_out raw + heap), F từ WeightParam.
          clamp_consistent(d_out, wp.bft_floor),
          nft_preserved(own_hash, tally_policy, tx),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
