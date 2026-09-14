// PoC + hồi quy: ba nhánh KHÔNG-Execute của validator Proposal có ràng datum output
// hay không. Bất biến đang được canh ở đây: Proposal UTxO là singleton mang NFT
// one-shot, nên MỖI lần tiêu nó là một lần ghi lại TOÀN BỘ datum. Nhánh nào không
// nói gì về datum ra thì nhánh đó cho phép người tiêu đặt datum tuỳ ý — trong đó có
// `spend_spec_hash` (đích chi mà Treasury đọc) và `status` (nhảy thẳng lên Executed).
//
// Ba nhánh, ba mức hở khác nhau:
//   OpenProposal — không đọc datum ra một lần nào.
//   CloseVoting  — chỉ giữ 2/12 trường (status, proposal_id).
//   RecordTally  — giữ 8/12 trường, để trống ba mốc epoch.
//
// Bản NGHIÊM đối chứng cùng kho: `proposal.execute_transition_ok` giữ đủ 12 trường.
//
// Hạ tầng dựng tx (prop_datum/prop_input/prop_output/tally_ref/tally_sh/lifecycle_tx
// + hằng số) lấy từ `lib/magiclamp/governance/proposal_fixtures.ak` — một nguồn duy
// nhất dùng chung với `proposal_test`, không dựng bộ song song.

use cardano/assets
use cardano/transaction.{Input, OutputReference, Transaction}
use magiclamp/governance/proposal_fixtures.{
  lifecycle_tx, lifecycle_tx_full, lifecycle_tx_many, lifecycle_tx_out,
  ms_per_epoch, prop_datum, prop_input, prop_input_second, prop_input_with,
  prop_output, prop_output_staked, prop_output_with, prop_policy, tally_policy,
  tally_ref, tally_sh, wp_policy, wp_ref,
}
use magiclamp/governance/types.{Executed, Open, ProposalDatum, Tallied}
use magiclamp/governance/util
use proposal

fn run(tx: Transaction, d_in: ProposalDatum, r: proposal.ProposalRedeemer) -> Bool {
  proposal.proposal.spend(
    prop_policy,
    tally_policy,
    tally_sh(),
    wp_policy,
    ms_per_epoch,
    Some(d_in),
    r,
    util.mk_ref(0),
    tx,
  )
}

// prop_datum dựng vote_open=10, vote_close=20, snapshot=10, execute_after=22,
// spend_spec_hash=#"5ec0" — mọi ca dưới đây tamper đúng MỘT trường trên nền đó, để
// cái phân biệt hai cực chỉ có thể là trường bị đổi.
fn open_datum() -> ProposalDatum {
  prop_datum(Open, 0, 0, 0)
}

// Value của Proposal UTxO vào là 2_000_000 lovelace + đúng 1 NFT. "Rút cạn" ở đây là
// giữ NGUYÊN NFT và nguyên datum, chỉ hút ADA ra: 1_999_999 lovelace đi vào ví người
// tiêu. Chọn cách này vì nó đi lọt mọi ràng buộc hiện có — NFT còn, datum còn.
fn drained_value() -> assets.Value {
  assets.from_lovelace(1) |> assets.add(prop_policy, #"0001", 1)
}

// ════════════════════════════════════════════════════════════
// Bảo toàn value — Tech-Spec.md:591 ("Proposal output value == input value (giữ
// NFT + ADA nguyên)"), cùng bài học audit Distribution M1 mà chính §8.1 trích:
// delta token đúng nhưng ADA bị rút lén. Tech-Spec gọi tên CloseVoting/RecordTally;
// bốn nhánh đều tiêu chính UTxO đó nên bốn nhánh đều phải bảo toàn.
// ════════════════════════════════════════════════════════════

test open_proposal_rejects_value_drain() fail {
  let d = open_datum()
  let tx =
    lifecycle_tx_out(d, prop_output_with(d, drained_value()), [], 12 * ms_per_epoch)
  expect run(tx, d, proposal.OpenProposal)
  True
}

test close_voting_rejects_value_drain() fail {
  let d = open_datum()
  let tx =
    lifecycle_tx_out(d, prop_output_with(d, drained_value()), [], 25 * ms_per_epoch)
  expect run(tx, d, proposal.CloseVoting)
  True
}

test record_tally_rejects_value_drain() fail {
  let d_in = open_datum()
  let d_out = prop_datum(Tallied, 200, 100, 30)
  let tx =
    lifecycle_tx_out(
      d_in,
      prop_output_with(d_out, drained_value()),
      [tally_ref(200, 100, 21, 30)],
      25 * ms_per_epoch,
    )
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// Nhánh Execute dựng đúng khuôn happy path của proposal_test (tally 200/100, 21 DID
// thuận, WeightParam 2/3 bft=21, epoch 25 ≥ execute_after 22) — mọi ngưỡng đều ĐẠT,
// nên thứ duy nhất phân biệt ca này với ca xanh là value bị rút.
test execute_proposal_rejects_value_drain() fail {
  let d_in = prop_datum(Tallied, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let tx =
    lifecycle_tx_out(
      d_in,
      prop_output_with(d_out, drained_value()),
      [tally_ref(200, 100, 21, 30), wp_ref(21, 0, 0, 2, 3)],
      25 * ms_per_epoch,
    )
  expect run(tx, d_in, proposal.ExecuteProposal)
  True
}

// ════════════════════════════════════════════════════════════
// Bảo toàn ĐỊA CHỈ — vế mà cả khối bảo toàn value ở trên KHÔNG đo được.
//
// Mọi phép đếm/tìm của `util` so payment credential chứ không so address, và đó là
// lựa chọn ĐÚNG cho việc đếm (so cả address thì người tiêu tách output sang một stake
// credential khác để lách `n_out == 1`). Hệ quả là output tại
// `Script(prop_sh) + stake credential của người tiêu` thoả n_in/n_out, thoả qty, thoả
// đẳng thức value, thoả datum — bốn ca dưới đây xanh hết nếu không có vế địa chỉ.
//
// Phép đo đảo, không phải suy đoán: gỡ `out.address == in_out.address` khỏi
// `proposal.utxo_preserved` thì đúng bốn ca này xanh trở lại và không ca nào khác đổi màu.
//
// Bốn nhánh chứ không một: `utxo_preserved` được gọi từ cả bốn (`proposal.ak` — bốn
// lời gọi), nên một ca duy nhất chỉ chứng minh cho nhánh nó chạy qua.
// ════════════════════════════════════════════════════════════

test open_proposal_rejects_stake_credential_swap() fail {
  let d = open_datum()
  let tx = lifecycle_tx_out(d, prop_output_staked(d), [], 12 * ms_per_epoch)
  expect run(tx, d, proposal.OpenProposal)
  True
}

test close_voting_rejects_stake_credential_swap() fail {
  let d = open_datum()
  let tx = lifecycle_tx_out(d, prop_output_staked(d), [], 25 * ms_per_epoch)
  expect run(tx, d, proposal.CloseVoting)
  True
}

test record_tally_rejects_stake_credential_swap() fail {
  let d_in = open_datum()
  let d_out = prop_datum(Tallied, 200, 100, 30)
  let tx =
    lifecycle_tx_out(
      d_in,
      prop_output_staked(d_out),
      [tally_ref(200, 100, 21, 30)],
      25 * ms_per_epoch,
    )
  expect run(tx, d_in, proposal.RecordTally)
  True
}

test execute_proposal_rejects_stake_credential_swap() fail {
  let d_in = prop_datum(Tallied, 200, 100, 30)
  let d_out = prop_datum(Executed, 200, 100, 30)
  let tx =
    lifecycle_tx_out(
      d_in,
      prop_output_staked(d_out),
      [tally_ref(200, 100, 21, 30), wp_ref(21, 0, 0, 2, 3)],
      25 * ms_per_epoch,
    )
  expect run(tx, d_in, proposal.ExecuteProposal)
  True
}

// ════════════════════════════════════════════════════════════
// OpenProposal — nhánh theo thiết kế KHÔNG đổi trạng thái gì
// ════════════════════════════════════════════════════════════

// ── ĐƯỜNG ĐI ĐƯỢC: datum ra y hệt datum vào → phải qua. Ca này là cực đối chứng:
//    nếu nó đỏ cùng lúc với các ca fail bên dưới thì bản vá đang chặn cả việc hợp lệ. ──
test open_proposal_accepts_unchanged_datum() {
  let d = open_datum()
  let tx = lifecycle_tx(d, d, [], 12 * ms_per_epoch)
  run(tx, d, proposal.OpenProposal)
}

// ── 1. Tiêu một proposal đang Open, giữ đúng NFT, nhưng ghi lại spend_spec_hash.
//    Đây là đích chi mà Treasury Release đọc — đổi được nó là đổi được người nhận
//    tiền trên một đề xuất đã mở. PHẢI bị từ chối. ──
test open_proposal_rejects_datum_overwrite() fail {
  let d_in = open_datum()
  let d_out = ProposalDatum { ..d_in, spend_spec_hash: #"dead" }
  let tx = lifecycle_tx(d_in, d_out, [], 12 * ms_per_epoch)
  expect run(tx, d_in, proposal.OpenProposal)
  True
}

// ── 2. Cùng lối vào, nhưng datum ra đặt thẳng status=Executed: bỏ qua cả bỏ phiếu
//    lẫn kiểm phiếu lẫn ngưỡng. Treasury chỉ đọc projection 5 trường và thấy
//    status=Executed là đủ điều kiện chi. PHẢI bị từ chối. ──
test open_proposal_rejects_status_jump() fail {
  let d_in = open_datum()
  let d_out = ProposalDatum { ..d_in, status: Executed }
  let tx = lifecycle_tx(d_in, d_out, [], 12 * ms_per_epoch)
  expect run(tx, d_in, proposal.OpenProposal)
  True
}

// ── 6. NFT: datum ra y hệt, value vào và ra BẰNG NHAU, nhưng cả hai cùng mang 2 đơn
//    vị của cùng asset name. Ràng buộc cũ `dict.size(tokens) == 1` đếm số TÊN nên
//    không thấy gì; đẳng thức bảo toàn value cũng không thấy gì vì nó chỉ so hai bên
//    với nhau, không nói số lượng TUYỆT ĐỐI. Thứ duy nhất từ chối được là `qty == 1`.
//
//    Bản đầu của ca này chỉ đổi output (2 đơn vị ra, 1 vào) — nó đỏ, đúng tên, và đo
//    NHẦM: nó chết ở chốt bảo toàn value. Phép đo đảo bắt được: gỡ `qty == 1` ra thì
//    bộ kiểm vẫn xanh. Phải làm đẳng thức value THOẢ mới cô lập được chốt cần đo.
//
//    Hôm nay policy one-shot (proposal_nft) làm cảnh này không dựng được trên chuỗi —
//    nhưng proposal_policy là THAM SỐ deploy, và nhánh spend là chỗ duy nhất còn canh
//    nếu tham số đó từng trỏ vào một policy khác. PHẢI bị từ chối. ──
test open_proposal_rejects_duplicated_nft() fail {
  let d = open_datum()
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 2)
  let tx =
    lifecycle_tx_full(
      prop_input_with(d, val),
      prop_output_with(d, val),
      [],
      12 * ms_per_epoch,
    )
  expect run(tx, d, proposal.OpenProposal)
  True
}

// ════════════════════════════════════════════════════════════
// CloseVoting — chú thích tại chỗ khai báo redeemer nói rõ nhánh này
// "chỉ gate thời gian + giữ value", tức datum phải bất biến
// ════════════════════════════════════════════════════════════

// ── ĐƯỜNG ĐI ĐƯỢC: quá vote_close_epoch, datum ra y hệt datum vào → phải qua. ──
test close_voting_accepts_unchanged_datum() {
  let d = open_datum()
  let tx = lifecycle_tx(d, d, [], 25 * ms_per_epoch)
  run(tx, d, proposal.CloseVoting)
}

// ── 3. Hết hạn bỏ phiếu (epoch 25 ≥ vote_close 20), status ra vẫn Open và
//    proposal_id vẫn đúng — thoả trọn hai vế đang có — nhưng spend_spec_hash đã đổi.
//    Các nhánh sau (RecordTally, ExecuteProposal) chỉ chép lại giá trị này, nên đích
//    chi giả đi thẳng tới Treasury. PHẢI bị từ chối. ──
test close_voting_rejects_spec_tamper() fail {
  let d_in = open_datum()
  let d_out = ProposalDatum { ..d_in, spend_spec_hash: #"dead" }
  let tx = lifecycle_tx(d_in, d_out, [], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.CloseVoting)
  True
}

// ── 4. Cùng lối vào, hạ execute_after_epoch xuống 0: xoá time-lock D2, Execute và
//    Release chạy được ngay trong epoch kế. PHẢI bị từ chối. ──
test close_voting_rejects_timelock_tamper() fail {
  let d_in = open_datum()
  let d_out = ProposalDatum { ..d_in, execute_after_epoch: 0 }
  let tx = lifecycle_tx(d_in, d_out, [], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.CloseVoting)
  True
}

// ════════════════════════════════════════════════════════════
// RecordTally — Open → Tallied, chép power đã clamp; ba mốc epoch bị bỏ trống
// ════════════════════════════════════════════════════════════

// Tally ref pha Clamped khớp proposal_id + weight_param_ref của prop_datum.
fn tally_in() -> Input {
  tally_ref(200, 100, 21, 30)
}

// ── ĐƯỜNG ĐI ĐƯỢC: transition hợp lệ, mọi trường còn lại giữ nguyên → phải qua. ──
test record_tally_accepts_valid_transition() {
  let d_in = open_datum()
  let d_out = prop_datum(Tallied, 200, 100, 30)
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  run(tx, d_in, proposal.RecordTally)
}

// ── 5. Transition hợp lệ mọi mặt (status, proposal_id, ba số power chép đúng từ
//    Tally, ba trường interface giữ nguyên) nhưng vote_close_epoch bị đẩy từ 20 lên
//    999. Cửa bỏ phiếu mở lại sau khi đã chốt kết quả, và Vote đọc chính trường này
//    để quyết định còn nhận phiếu hay không. PHẢI bị từ chối. ──
test record_tally_rejects_epoch_tamper() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum { ..prop_datum(Tallied, 200, 100, 30), vote_close_epoch: 999 }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// ── 7. Cùng khuôn, đổi vote_open_epoch. Hai ca dưới đây tồn tại vì phép đo đảo: gỡ
//    riêng chốt vote_open_epoch (và riêng chốt snapshot_epoch) ra khỏi validator thì
//    bộ kiểm vẫn XANH — ca số 5 ở trên chết ở chốt vote_close_epoch nên không chứng
//    minh được gì cho hai chốt còn lại. PHẢI bị từ chối. ──
test record_tally_rejects_vote_open_tamper() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum { ..prop_datum(Tallied, 200, 100, 30), vote_open_epoch: 0 }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// ── 8. Cùng khuôn, đổi snapshot_epoch: mốc khoá ảnh chụp C4 (LAMP nắm giữ). Dời được
//    nó là dời được tập trọng số mà một đợt kiểm phiếu sau viện dẫn. PHẢI bị từ chối. ──
test record_tally_rejects_snapshot_tamper() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum { ..prop_datum(Tallied, 200, 100, 30), snapshot_epoch: 7 }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// ── 9 + 10. Ba vế interface Gov→Treasury ở RecordTally (`spend_spec_hash`,
//    `execute_after_epoch`) và vế `status == Tallied` đã có trong mã từ trước, nhưng
//    phép đo đảo cho thấy gỡ chúng ra thì bộ kiểm vẫn xanh: nhánh RecordTally trước
//    đợt này không có ca âm nào. Ba ca dưới đây ghim chúng — cùng lớp lỗi với chỗ vừa
//    vá, nên để hở là vá theo phạm vi của TRIỆU CHỨNG chứ không của nguyên nhân. ──
test record_tally_rejects_spec_tamper() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum {
      ..prop_datum(Tallied, 200, 100, 30),
      spend_spec_hash: #"dead",
    }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

test record_tally_rejects_timelock_tamper() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum { ..prop_datum(Tallied, 200, 100, 30), execute_after_epoch: 0 }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// status ra vẫn Open: kiểm phiếu đã chốt mà cửa bỏ phiếu chưa đóng ⇒ Vote (đọc
// `status == Open`) còn nhận phiếu cho một proposal đã có kết quả.
test record_tally_rejects_status_stays_open() fail {
  let d_in = open_datum()
  let d_out = ProposalDatum { ..prop_datum(Tallied, 200, 100, 30), status: Open }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// ── 13–18. Sáu trường GIÁ TRỊ còn lại của RecordTally. Chúng đã có trong mã từ trước
//    nhưng phép đo đảo cho thấy không ca nào ghim: nhánh RecordTally trước đợt này
//    không có ca âm. Mỗi chốt MỘT ca riêng — một ca không ghim được cả khối `and`, vì
//    nó chết ở vế vỡ sớm nhất rồi phủ bóng phần còn lại.
//
//    Vì sao đúng sáu trường này: `released_cumulative` và `weight_param_ref` đi thẳng
//    vào phép tính chi tiền của Treasury; ba trường power quyết định đề xuất có thông
//    qua hay không; `proposal_id` buộc cả chuỗi vào đúng một đề xuất. ──

// proposal_id ra khác input ⇒ kết quả của đề xuất này được gắn sang một đề xuất khác.
test record_tally_rejects_proposal_id_swap() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum { ..prop_datum(Tallied, 200, 100, 30), proposal_id: #"beef" }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// yes_power ghi cao hơn số Tally đã clamp ⇒ thổi phiếu thuận, qua được ngưỡng θ.
test record_tally_rejects_yes_power_inflate() fail {
  let d_in = open_datum()
  let d_out = prop_datum(Tallied, 999, 100, 30)
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// no_power ghi thấp hơn ⇒ cùng hiệu ứng, đi từ mẫu số của biểu thức pass.
test record_tally_rejects_no_power_deflate() fail {
  let d_in = open_datum()
  let d_out = prop_datum(Tallied, 200, 0, 30)
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// voter_count ghi sai ⇒ qua được quorum theo NGƯỜI mà không có người thật.
test record_tally_rejects_voter_count_inflate() fail {
  let d_in = open_datum()
  let d_out = prop_datum(Tallied, 200, 100, 9_999)
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// released_cumulative lùi về 0 ⇒ xoá lịch sử đã giải ngân, Treasury cho chi lại từ đầu.
test record_tally_rejects_released_cumulative_reset() fail {
  let d_in =
    ProposalDatum { ..open_datum(), released_cumulative: 5_000_000 }
  let d_out = prop_datum(Tallied, 200, 100, 30)
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// weight_param_ref trỏ sang bảng tham số khác ⇒ Execute sau đó đọc ngưỡng của bảng lạ.
test record_tally_rejects_weight_param_swap() fail {
  let d_in = open_datum()
  let d_out =
    ProposalDatum {
      ..prop_datum(Tallied, 200, 100, 30),
      weight_param_ref: OutputReference {
        transaction_id: #"ff",
        output_index: 9,
      },
    }
  let tx = lifecycle_tx(d_in, d_out, [tally_in()], 25 * ms_per_epoch)
  expect run(tx, d_in, proposal.RecordTally)
  True
}

// ════════════════════════════════════════════════════════════
// Double satisfaction — hai UTxO cùng Proposal script trong MỘT tx
// ════════════════════════════════════════════════════════════

// ── 11 + 12. `n_in == 1` / `n_out == 1` có trong mã từ trước và cũng không ai canh.
//    Đây là lỗ kinh điển của eUTXO: `output_at_script` lấy output KHỚP ĐẦU TIÊN, nên
//    nếu không đếm thì một output hợp lệ thoả cho nhiều input cùng script — proposal
//    thứ hai bị tiêu mà không ai kiểm datum ra của nó. PHẢI bị từ chối. ──
test open_proposal_rejects_two_inputs_at_script() fail {
  let d = open_datum()
  let tx =
    lifecycle_tx_many(
      [prop_input(d), prop_input_second(d)],
      [prop_output(d)],
      [],
      12 * ms_per_epoch,
    )
  expect run(tx, d, proposal.OpenProposal)
  True
}

test open_proposal_rejects_two_outputs_at_script() fail {
  let d = open_datum()
  let tx =
    lifecycle_tx_many(
      [prop_input(d)],
      [prop_output(d), prop_output(d)],
      [],
      12 * ms_per_epoch,
    )
  expect run(tx, d, proposal.OpenProposal)
  True
}
