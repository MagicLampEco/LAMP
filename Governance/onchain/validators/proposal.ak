// Validator 1 — Proposal (vòng đời đề xuất). Một UTxO/proposal mang Proposal NFT
// one-shot (proposal_nft.ak). TECH §3.
//
// Redeemer: OpenProposal | CloseVoting | RecordTally | ExecuteProposal.
// Trọng tâm: ExecuteProposal ÉP biểu thức pass canonical (D1) — clamp BFT + sàn cứng
// — TRƯỚC, set status=Executed, giữ NFT, idempotent (Tallied→Executed 1 lần).
//
// Model A (D3): Governance ép TOÀN BỘ ngưỡng ở ExecuteProposal; Treasury Release chỉ
// đọc ProposalResult (projection D10) qua reference input + kiểm status==Executed.
//
// Tham số hóa:
//   proposal_policy : PolicyId NFT one-shot chứng thực Proposal UTxO này.
//   tally_policy    : PolicyId NFT Tally accumulator (đọc kết quả tally đã clamp).
//   ms_per_epoch    : độ dài epoch (Preview/Mainnet khác) — time-lock execute_after.
//
// RecordTally + ExecuteProposal đọc TallyDatum (pha Clamped) qua REFERENCE INPUT mang
// Tally NFT. Tham số ngưỡng (bft_floor, quorum, θ) lấy từ TallyDatum-bound proposal +
// redeemer (DAO-param). v1: nhận qua redeemer (đọc UTxO tham số là mở rộng EXEC).

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use magiclamp/governance/proposal.{execute_transition_ok} as proposal_lib
use magiclamp/governance/tally.{clamp_consistent, pass} as tally_lib
use magiclamp/governance/types.{
  Clamped, Open, ProposalDatum, Tallied, TallyDatum, WeightParam,
}
use magiclamp/governance/util

pub type ProposalRedeemer {
  // mở đề xuất (mint NFT one-shot ở proposal_nft) — kiểm status Open.
  OpenProposal
  // Open → đóng nhận phiếu (epoch ≥ vote_close). status GIỮ Open ở projection (Closed
  // không tồn tại — D10); "đóng vote" đánh dấu qua việc Tally bắt đầu, KHÔNG đổi status.
  // v1: CloseVoting chỉ gate thời gian + giữ value; vòng đời Open→Tallied do RecordTally.
  CloseVoting
  // Tally chạy cùng tx (Tally NFT reference) → ghi power vào ProposalDatum, Open→Tallied.
  RecordTally
  // Tallied → Executed: ÉP pass canonical (clamp BFT + sàn cứng) + time-lock + giữ NFT.
  // Finding 1: KHÔNG còn nhận ngưỡng từ redeemer — đọc TẤT CẢ từ WeightParam UTxO
  // (reference input trỏ bởi d_in.weight_param_ref, xác thực token). Chống bypass ngưỡng.
  ExecuteProposal
}

/// Đọc + xác thực TallyDatum qua reference input mang Tally NFT one-shot.
/// Mirror release.read_proposal: đúng 1 token tally_policy + decode datum.
///
/// GỐC TIN CẬY (audit GAME-1 #2): ref input PHẢI nằm tại Tally script hash đã biết
/// (tally_script_hash) — không thì kẻ tấn công mint token tally_policy mồ côi tại
/// địa chỉ bất kỳ rồi mớm TallyDatum bịa. Token + qty CHƯA đủ; bắt buộc + địa chỉ.
fn read_tally(
  reference_inputs: List<Input>,
  tally_policy: PolicyId,
  tally_script_hash: ByteArray,
) -> TallyDatum {
  expect Some(ref) =
    list.find(
      reference_inputs,
      fn(i) {
        and {
          util.is_at_script(i.output.address, tally_script_hash),
          dict.size(assets.tokens(i.output.value, tally_policy)) == 1,
        }
      },
    )
  expect [Pair(_, qty)] =
    dict.to_pairs(assets.tokens(ref.output.value, tally_policy))
  expect qty == 1
  expect InlineDatum(d) = ref.output.datum
  expect td: TallyDatum = d
  td
}

/// Đọc + xác thực WeightParam qua reference input (CONTRACT D1 — "θ đọc từ UTxO tham số").
/// HAI ràng buộc xác thực (cả hai bắt buộc, chống mọi giả mạo ngưỡng — Finding 1):
///   (a) reference input PHẢI có output_reference == weight_param_ref đã CAM KẾT trong
///       ProposalDatum lúc OpenProposal (byte-perfect) — không cho mớm UTxO ngưỡng khác.
///   (b) UTxO đó PHẢI mang đúng 1 authenticity token weight_param_policy — chống kẻ tấn
///       công tạo UTxO bất kỳ tại weight_param_ref bịa (ref alone chưa đủ vì kẻ tấn công
///       không kiểm soát được transaction_id thật, nhưng token khóa nguồn tin cậy DAO).
/// Thiếu một trong hai → expect fail → tx fail. Ngưỡng giả tuyệt đối không qua.
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
  wp
}

/// Proposal NFT bảo toàn: đúng 1 input + 1 output tại Proposal script hash, output
/// mang đúng NFT one-shot (value giữ NFT). Chống đốt/đổi địa chỉ Proposal UTxO.
fn nft_preserved(
  own_hash: ByteArray,
  proposal_policy: PolicyId,
  inputs: List<Input>,
  outputs: List<Output>,
) -> Bool {
  let n_in = util.count_inputs_at_script(inputs, own_hash)
  let n_out = util.count_outputs_at_script(outputs, own_hash)
  let out = util.output_at_script(outputs, own_hash)
  and {
    n_in == 1,
    n_out == 1,
    // output giữ đúng 1 NFT proposal_policy (one-shot, không đốt).
    dict.size(assets.tokens(out.value, proposal_policy)) == 1,
  }
}

/// Decode ProposalDatum output tại own script hash.
fn out_datum(own_hash: ByteArray, outputs: List<Output>) -> ProposalDatum {
  let out = util.output_at_script(outputs, own_hash)
  expect InlineDatum(d) = out.datum
  expect pd: ProposalDatum = d
  pd
}

validator proposal(
  proposal_policy: PolicyId,
  tally_policy: PolicyId,
  tally_script_hash: ByteArray,
  weight_param_policy: PolicyId,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<ProposalDatum>,
    redeemer: ProposalRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d_in) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)
    let epoch = util.get_epoch(tx, ms_per_epoch)

    when redeemer is {
      // ── OpenProposal: status Open + value bảo toàn NFT. (Mint NFT ở proposal_nft.) ──
      OpenProposal -> {
        expect d_in.status == Open
        expect d_in.vote_close_epoch > d_in.vote_open_epoch
        expect d_in.snapshot_epoch == d_in.vote_open_epoch
        nft_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs)
      }

      // ── CloseVoting: epoch ≥ vote_close; status giữ Open; value bảo toàn ──
      CloseVoting -> {
        expect d_in.status == Open
        expect epoch >= d_in.vote_close_epoch
        let d_out = out_datum(own_hash, tx.outputs)
        and {
          d_out.status == Open,
          d_out.proposal_id == d_in.proposal_id,
          nft_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
        }
      }

      // ── RecordTally: Tally chạy cùng tx (Tally NFT reference) → ghi power đã clamp ──
      //    vào ProposalDatum, Open → Tallied. KHÔNG kiểm pass ở đây (pass ở Execute).
      RecordTally -> {
        expect d_in.status == Open
        let td =
          read_tally(tx.reference_inputs, tally_policy, tally_script_hash)
        expect td.proposal_id == d_in.proposal_id
        // Tally PHẢI dùng đúng bảng WeightParam mà Proposal cam kết (Finding 1+2): bảo
        // đảm power_raw được DERIVE bằng đúng bảng knots của proposal này.
        expect td.weight_param_ref == d_in.weight_param_ref
        // Tally PHẢI đã chốt pha Clamped (power_eff sẵn sàng) — KHÔNG ghi power pha
        // Summing (eff chưa ràng) vào ProposalDatum (audit GAME-1 #3).
        expect td.phase == Clamped
        let d_out = out_datum(own_hash, tx.outputs)
        and {
          d_out.status == Tallied,
          d_out.proposal_id == d_in.proposal_id,
          // ghi power đã CLAMP từ Tally vào ProposalDatum (nguồn power duy nhất — D5).
          d_out.yes_power == td.yes_power_eff,
          d_out.no_power == td.no_power_eff,
          d_out.voter_count == td.voters_acc,
          // field interface Gov→Treasury giữ nguyên.
          d_out.spend_spec_hash == d_in.spend_spec_hash,
          d_out.execute_after_epoch == d_in.execute_after_epoch,
          d_out.released_cumulative == d_in.released_cumulative,
          d_out.weight_param_ref == d_in.weight_param_ref,
          nft_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
        }
      }

      // ── ExecuteProposal: ÉP pass canonical + time-lock + Tallied→Executed + giữ NFT ──
      ExecuteProposal -> {
        // time-lock D2: chỉ Execute khi epoch ≥ execute_after_epoch.
        expect epoch >= d_in.execute_after_epoch
        // Finding 1: đọc ngưỡng từ WeightParam UTxO (CONTRACT D1) — KHÔNG từ redeemer.
        // Xác thực token + khớp weight_param_ref đã cam kết lúc OpenProposal.
        let wp =
          read_weight_param(
            tx.reference_inputs,
            weight_param_policy,
            d_in.weight_param_ref,
          )
        // F ≥ 1 (mẫu trần clamp + sàn cứng) — chống ngưỡng giả 0 nếu bảng DAO sai.
        expect wp.bft_floor >= 1
        // đọc TallyDatum — power đã clamp + sàn cứng số DID thuận.
        let td =
          read_tally(tx.reference_inputs, tally_policy, tally_script_hash)
        expect td.proposal_id == d_in.proposal_id
        // GAME-1 #1: Tally PHẢI đã chốt pha Clamped. Pha Summing để ba field *_eff
        // HOÀN TOÀN không ràng → kẻ tấn công thổi yes_power_eff. ÉP phase trước.
        expect td.phase == Clamped
        // DEFENSE-IN-DEPTH (#1): tái-kiểm clamp BFT tại CHÍNH tx Execute — không tin
        // pha Clamped đã set đúng ở tx Tally trước. power_eff PHẢI == apply_clamp(raw+heap).
        // bft_floor LẤY TỪ WeightParam (không redeemer) → clamp dùng đúng F của DAO.
        expect clamp_consistent(td, wp.bft_floor)
        // ÉP biểu thức pass canonical (D1): clamp BFT đã áp trong td.*_eff, sàn cứng
        // yes_voters_acc ≥ F, quorum, nhân-chéo Int dấu ≥. NGƯỠNG TỪ WeightParam.
        expect
          pass(
            td,
            wp.bft_floor,
            wp.quorum_vp_threshold,
            wp.quorum_voter_threshold,
            wp.theta_num,
            wp.theta_den,
          )
        // transition Tallied → Executed (idempotent + giữ field interface).
        let d_out = out_datum(own_hash, tx.outputs)
        and {
          execute_transition_ok(d_in, d_out),
          nft_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
