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

/// Proposal UTxO bảo toàn: đúng 1 input + 1 output tại Proposal script hash, output
/// mang đúng 1 NFT one-shot, và TOÀN BỘ value đi qua nguyên vẹn.
///
/// Tên cũ là `nft_preserved` — đổi vì nó không còn chỉ giữ NFT. Giữ NFT là điều kiện
/// CẦN, không đủ: Tech-Spec.md:591 chốt "CloseVoting/RecordTally: Proposal output
/// value == input value (giữ NFT + ADA nguyên)", dẫn lại bài học audit Distribution M1
/// (§8.1) — delta token đúng nhưng ADA bị rút lén. Tech-Spec gọi tên hai nhánh, nhưng
/// cả bốn nhánh đều tiêu chính UTxO này nên cả bốn đều ép, không có lý do để nhánh nào
/// được rút ADA.
fn utxo_preserved(
  own_hash: ByteArray,
  proposal_policy: PolicyId,
  inputs: List<Input>,
  outputs: List<Output>,
) -> Bool {
  let n_in = util.count_inputs_at_script(inputs, own_hash)
  let n_out = util.count_outputs_at_script(outputs, own_hash)
  let in_out = util.input_at_script(inputs, own_hash)
  let out = util.output_at_script(outputs, own_hash)
  // "đúng 1 TÊN tài sản" (dict.size == 1) KHÔNG phải "đúng 1 token": số lượng nằm ở
  // giá trị của cặp, không ở số cặp. Phải bóc lấy qty và ép == 1 — cùng khuôn với
  // read_tally/read_weight_param, nơi ràng buộc này đã có sẵn.
  //
  // Vế này KHÔNG bị đẳng thức value bên dưới nuốt, dù thoạt nhìn có vẻ vậy:
  // `out.value == in_out.value` chỉ nói hai bên BẰNG NHAU, không nói số lượng TUYỆT
  // ĐỐI là 1. Một UTxO đã mang sẵn 2 đơn vị (chỉ xảy ra nếu tham số deploy
  // proposal_policy trỏ vào một policy không one-shot) đi qua đẳng thức đó êm ru.
  expect [Pair(_, qty)] = dict.to_pairs(assets.tokens(out.value, proposal_policy))
  and {
    n_in == 1,
    n_out == 1,
    // output giữ đúng 1 NFT proposal_policy (one-shot, không đốt).
    qty == 1,
    // value đi qua NGUYÊN VẸN: mọi asset, mọi lovelace. Ràng NFT thôi thì người tiêu
    // giữ NFT + datum y nguyên rồi hút hết ADA còn lại ra ví mình, không gì kêu lên.
    out.value == in_out.value,
  }
}

/// Datum output PHẢI y hệt datum input — dùng cho các nhánh theo thiết kế KHÔNG đổi
/// trạng thái gì. Liệt kê từng trường là cách hỏng im lặng: thêm một trường vào
/// ProposalDatum thì danh sách cũ vẫn biên dịch, vẫn xanh, và trường mới thành tự do.
/// So sánh cả record đóng luôn đường đó và rẻ hơn (một phép so trên Data).
fn datum_unchanged(d_in: ProposalDatum, d_out: ProposalDatum) -> Bool {
  d_out == d_in
}

/// Decode ProposalDatum output tại own script hash.
fn out_datum(own_hash: ByteArray, outputs: List<Output>) -> ProposalDatum {
  let out = util.output_at_script(outputs, own_hash)
  expect InlineDatum(d) = out.datum
  expect pd: ProposalDatum = d
  pd
}

// ════════════════════════════════════════════════════════════════════════════════
// ĐỘ PHỦ CỦA BỘ KIỂM — đọc trước khi gỡ bất cứ dòng nào bên dưới
// ════════════════════════════════════════════════════════════════════════════════
//
// Các vế trong những khối `and { … }` dưới đây đều có ca âm riêng ghim chúng: gỡ một
// vế ra rồi chạy `aiken check` thì có ít nhất một test đỏ. Các tiền điều kiện dạng
// `expect` thì KHÔNG — đo ngày 2026-09-14 bằng cách gỡ từng cái rồi chạy trọn bộ:
// mười hai `expect` dưới đây gỡ ra mà bộ kiểm VẪN XANH.
//
// Điều đó KHÔNG có nghĩa chúng thừa. Chúng chia làm hai loại, và hai loại có rủi ro
// khác hẳn nhau:
//
//   (A) ĐANG ĐƯỢC MỘT LỚP SAU CHE — gỡ ra thì tx vẫn bị từ chối, nhưng bởi lớp khác:
//       · Execute ▸ `expect td.phase == Clamped`   ← `clamp_consistent` che: datum pha
//         Summing có ba trường *_eff chưa ràng, và chính clamp_consistent bắt ra sai.
//       · Execute ▸ `expect wp.bft_floor >= 1`     ← `clamp_consistent` che: F = 0 làm
//         phép chia trong công thức trần τ = ΣVP/F nổ ⇒ validator crash ⇒ từ chối.
//       · Execute ▸ `expect td.proposal_id == d_in.proposal_id` ← `pass()` + ràng buộc
//         datum ra che trong các ca hiện có.
//       Hệ quả phải nhớ: ba bài `execute_summing_phase_reject`,
//       `execute_wp_bft_zero_reject`, `execute_forged_tally_wrong_script_reject` ĐỎ
//       đúng dòng mang tên chúng, nhưng KHÔNG chứng minh được ba `expect` này ghim
//       gì. Gỡ lớp che (đổi `clamp_consistent`, đổi `pass`) thì phải THÊM ca cho ba
//       `expect` này, đừng tin vào màu xanh còn lại.
//
//   (B) CHƯA CÓ CA NÀO CHẠM TỚI — không lớp nào che, chỉ là bộ kiểm chưa đi qua:
//       · Open  ▸ `status == Open`, `vote_close > vote_open`, `snapshot == vote_open`
//       · Close ▸ `status == Open`, `epoch >= vote_close`
//       · Tally ▸ `status == Open`, `td.proposal_id`, `td.weight_param_ref`,
//                 `td.phase == Clamped`
//       Loại này là nợ kiểm thử thẳng thắn: một ca âm cho mỗi cái là đủ.
//
// Cách đo lại (rẻ, ~25 giây một chốt): thay chốt bằng `expect True` / `True,` → chạy
// `aiken check` → đọc `"status": "fail"` trong output JSON → khôi phục. Đừng suy luận
// thay cho phép đo: vế `qty == 1` trong `utxo_preserved` từng trông y như một vế chết
// cho tới khi ca kiểm được sửa cho cô lập đúng đại lượng.
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
        // Ba expect trên chỉ nói về datum VÀO. Proposal UTxO là singleton, nên mỗi lần
        // tiêu nó là một lần ghi lại TOÀN BỘ datum: không ràng datum RA thì ai tiêu
        // được một proposal đang Open cũng đặt lại được spend_spec_hash (đích chi
        // Treasury đọc) hay status=Executed. Nhánh này theo thiết kế không đổi trạng
        // thái gì ⇒ datum ra phải y datum vào.
        let d_out = out_datum(own_hash, tx.outputs)
        and {
          datum_unchanged(d_in, d_out),
          utxo_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
        }
      }

      // ── CloseVoting: epoch ≥ vote_close; status giữ Open; value bảo toàn ──
      CloseVoting -> {
        expect d_in.status == Open
        expect epoch >= d_in.vote_close_epoch
        let d_out = out_datum(own_hash, tx.outputs)
        // Chú thích tại chỗ khai báo redeemer đã chốt: nhánh này "chỉ gate thời gian +
        // giữ value". Giữ 2 trường (status, proposal_id) trên 12 thì 10 trường còn lại
        // tự do đúng lúc hết hạn bỏ phiếu — đổi được spend_spec_hash và
        // execute_after_epoch, rồi các nhánh sau chỉ chép lại giá trị đã bị đổi.
        and {
          datum_unchanged(d_in, d_out),
          utxo_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
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
          // ba mốc epoch cũng phải giữ nguyên: RecordTally chỉ ghi kết quả, không có
          // lý do gì đổi lịch. Bỏ trống thì đẩy được vote_close_epoch lên sau khi đã
          // chốt kết quả — Vote đọc đúng trường này để biết còn nhận phiếu hay không.
          d_out.vote_open_epoch == d_in.vote_open_epoch,
          d_out.vote_close_epoch == d_in.vote_close_epoch,
          d_out.snapshot_epoch == d_in.snapshot_epoch,
          utxo_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
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
          utxo_preserved(own_hash, proposal_policy, tx.inputs, tx.outputs),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
