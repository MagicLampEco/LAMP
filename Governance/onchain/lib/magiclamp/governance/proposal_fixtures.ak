// Hạ tầng dựng tx cho các test validator Proposal — NGUỒN DUY NHẤT.
//
// Vì sao nằm ở lib/ chứ không ở cạnh test: Aiken cấm một module test đã import
// validator được export `pub` (aiken::check::illegal::import). Nên hai tệp test cùng
// soi validator Proposal không chia nhau fixture được nếu fixture nằm trong một trong
// hai tệp đó — mỗi tệp sẽ tự dựng một bộ, rồi hai bộ trôi khỏi nhau mà không ai báo.
// Đặt ở lib/ theo đúng tiền lệ `util.ak` mục "Test-support builders (mock UTxO/tx)".
//
// Ở đây CHỈ có thứ không đụng tới module validator: hằng số, datum mẫu, UTxO mẫu,
// khung tx. Phần gọi `proposal.proposal.spend` phải ở lại trong chính tệp test.

use aiken/interval
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/types.{
  Clamped, ProposalDatum, TallyDatum, WeightParam,
}
use magiclamp/governance/util

pub const prop_policy: PolicyId = #"9901"

pub const tally_policy: PolicyId = #"7a11"

pub const wp_policy: PolicyId = #"a0a0"

pub const prop_sh: ByteArray = #"b0"

pub const ms_per_epoch: Int = 432_000_000

pub const prop_id: ByteArray = #"abcd"

pub const spec_hash: ByteArray = #"5ec0"

pub fn weight_ref() -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: 0 }
}

pub fn tally_sh() -> ByteArray {
  #"7a"
}

// WeightParam ref input mang authenticity token wp_policy, ngưỡng truyền vào.
// output_reference == weight_ref() (khớp d_in.weight_param_ref đã cam kết).
pub fn wp_datum(
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

pub fn wp_ref(
  bft: Int,
  q_vp: Int,
  q_voter: Int,
  th_num: Int,
  th_den: Int,
) -> Input {
  wp_ref_custom(wp_policy, weight_ref(), bft, q_vp, q_voter, th_num, th_den)
}

// WeightParam ref TÙY BIẾN: token policy + output_reference để mô phỏng giả mạo ngưỡng.
pub fn wp_ref_custom(
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

pub fn prop_datum(
  status,
  yes_p: Int,
  no_p: Int,
  voters: Int,
) -> ProposalDatum {
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
pub fn tally_ref(
  yes_eff: Int,
  no_eff: Int,
  yes_voters: Int,
  voters: Int,
) -> Input {
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
  tally_ref_custom(td, tally_sh())
}

// Tally ref TÙY BIẾN: phase + script hash để mô phỏng forgery.
pub fn tally_ref_custom(td: TallyDatum, at_hash: ByteArray) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, #"01", 1)
  util.mk_input(
    util.mk_ref(9),
    util.mk_output(util.script_address(at_hash), val, td),
  )
}

// Proposal UTxO input (mang Proposal NFT) tại prop script hash.
pub fn prop_input(d: ProposalDatum) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(prop_sh), val, d),
  )
}

// Proposal output (mang NFT) với datum mới.
pub fn prop_output(d: ProposalDatum) -> Output {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  util.mk_output(util.script_address(prop_sh), val, d)
}

// Proposal output với value TÙY BIẾN — dùng cho ca soi ràng buộc NFT (số lượng token).
pub fn prop_output_with(d: ProposalDatum, val: assets.Value) -> Output {
  util.mk_output(util.script_address(prop_sh), val, d)
}

// Proposal input với value TÙY BIẾN. Cần cho ca phải làm đẳng thức value THOẢ để đo
// riêng một ràng buộc khác (vd `qty == 1`) — đổi mỗi output thì đẳng thức value vỡ
// trước, và ca đó sẽ đo nhầm sang chốt bảo toàn value.
pub fn prop_input_with(d: ProposalDatum, val: assets.Value) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(prop_sh), val, d),
  )
}

// Khung tx vòng đời: tiêu đúng 1 Proposal UTxO, trả đúng 1 output tại Proposal script
// hash, kèm reference input tuỳ nhánh. lower_ms luôn hữu hạn vì validator tính epoch
// từ biên DƯỚI của validity_range ngay đầu nhánh spend.
pub fn lifecycle_tx(
  d_in: ProposalDatum,
  d_out: ProposalDatum,
  refs: List<Input>,
  lower_ms: Int,
) -> Transaction {
  lifecycle_tx_out(d_in, prop_output(d_out), refs, lower_ms)
}

// Như trên nhưng nhận thẳng Output — cho ca cần đổi value chứ không chỉ đổi datum.
pub fn lifecycle_tx_out(
  d_in: ProposalDatum,
  out: Output,
  refs: List<Input>,
  lower_ms: Int,
) -> Transaction {
  lifecycle_tx_full(prop_input(d_in), out, refs, lower_ms)
}

// Khuôn gốc: nhận cả Input lẫn Output dựng sẵn. Hai hàm trên đều gọi về đây.
pub fn lifecycle_tx_full(
  inp: Input,
  out: Output,
  refs: List<Input>,
  lower_ms: Int,
) -> Transaction {
  lifecycle_tx_many([inp], [out], refs, lower_ms)
}

// Nhiều input / nhiều output — cho ca double-satisfaction (hai UTxO cùng script trong
// một tx). Mọi khuôn ở trên đều gọi về đây, nên chỉ có MỘT chỗ dựng Transaction.
pub fn lifecycle_tx_many(
  inputs: List<Input>,
  outputs: List<Output>,
  refs: List<Input>,
  lower_ms: Int,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs,
    reference_inputs: refs,
    outputs,
    validity_range: interval.after(lower_ms),
  }
}

// Proposal input thứ HAI (output_reference khác) — dùng cho ca double-satisfaction.
pub fn prop_input_second(d: ProposalDatum) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0002", 1)
  util.mk_input(
    util.mk_ref(1),
    util.mk_output(util.script_address(prop_sh), val, d),
  )
}
