// Ca kiểm BẮC QUA nhiều validator trên CÙNG MỘT `Transaction`.
//
// Vì sao phải có tệp riêng: mỗi tệp kiểm ở trên chạy đúng một validator trên một
// `Transaction` dựng riêng cho nó. Nhưng trên chuỗi thật, một giao dịch chạy NHIỀU
// validator cùng lúc, và mỗi validator chỉ thấy MỘT `Transaction`. Hai lớp lỗi chỉ
// hiện ra ở đây:
//   • hai nhánh đáng lẽ rời nhau lại cùng thoả trên một giao dịch;
//   • một tham số đáng lẽ CHUNG (`ms_per_epoch`) bị áp lệch giữa các validator, và
//     mỗi validator vẫn "đúng" theo con số của riêng nó.

use aiken/interval
use aiken/interval.{Interval}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/mpf_fixtures as fx
use magiclamp/governance/names.{nullifier_name}
use magiclamp/governance/power.{Knot, scale}
use magiclamp/governance/types.{
  Clamped, Summing, TallyDatum, TopEntry, VoteDatum, WeightParam, Yes,
}
use magiclamp/governance/util
use nullifier
use tally
use vote

const tally_policy: PolicyId = #"7a11"

const nl_policy: PolicyId = #"7777"

const taad_policy: PolicyId = #"7aad"

const wp_policy: PolicyId = #"a0a0"

const c3_policy: PolicyId = #"c3c3"

const tally_sh: ByteArray = #"7a"

const vote_sh: ByteArray = #"c0"

/// Một nguồn DUY NHẤT cho `ms_per_epoch` trong tệp này — đúng điều bảng chốt đòi.
const ms_ep: Int = 86_400_000

/// Giá trị của một mạng KHÁC (Preprod/mainnet). Dùng để chứng minh áp lệch là chết.
const ms_ep_mang_khac: Int = 432_000_000

const window: Int = 3

const open_e: Int = 10

const close_e: Int = 20

const prop: ByteArray = #"abcd"

const did1: ByteArray = #"11"

const bft: Int = 10

const c3: Int = 10

fn at_epoch(e: Int) -> Interval {
  interval.between(e * ms_ep, e * ms_ep + 1000)
}

// ── WeightParam: pow(c) = SCALE·(c+1) ⇒ vp_raw = SCALE·(c3+1) ──
fn lin_knots() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 1_000_000_000, pow: 1_000_000_000 * scale },
  ]
}

/// VP thật ở mức validator = 0 với bảng knots hợp khuôn (`pow(0) = 0`) cộng
/// `c_sources_ok` ép `c1 = c2 = c4 = 0`: tích nhân có một thừa số 0.
/// Lý do đầy đủ + hệ quả về độ phủ: xem `vp_of` ở `validators/tally_test.ak`.
fn vp_of(_c: Int) -> Int {
  0
}

fn wp_ref() -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: 7 }
}

fn wp_input() -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, #"50", 1)
  let wp =
    WeightParam {
      k1: lin_knots(),
      k2: lin_knots(),
      k3: lin_knots(),
      k4: lin_knots(),
      bft_floor: bft,
      quorum_vp_threshold: 0,
      quorum_voter_threshold: 0,
      theta_num: 2,
      theta_den: 3,
    }
  util.mk_input(wp_ref(), util.mk_output(util.script_address(#"a0"), val, wp))
}

fn c3_ref() -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(c3_policy, did1, 1)
  util.mk_input(
    util.mk_ref(101),
    util.mk_output(util.script_address(#"c3"), val, c3),
  )
}

// ── Phiếu ──

fn vd() -> VoteDatum {
  VoteDatum {
    proposal_id: prop,
    did_commit: did1,
    nullifier: nullifier_name(did1, prop),
    choice: Yes,
    c1_capped: 0,
    c2_capped: 0,
    c3_capped: c3,
    c4_capped: 0,
  }
}

fn vote_ref() -> OutputReference {
  util.mk_ref(1)
}

fn vote_input() -> Input {
  let val =
    assets.from_lovelace(2_000_000)
      |> assets.add(nl_policy, nullifier_name(did1, prop), 1)
  util.mk_input(
    vote_ref(),
    util.mk_output(util.script_address(vote_sh), val, vd()),
  )
}

fn burn_nl() -> Value {
  assets.zero |> assets.add(nl_policy, nullifier_name(did1, prop), -1)
}

// ── Tally ──

fn tally_ref_or() -> OutputReference {
  util.mk_ref(0)
}

fn tally_value() -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop, 1)
}

fn td(
  root: ByteArray,
  yes_raw: Int,
  voters: Int,
  yes_voters: Int,
  top: List<TopEntry>,
) -> TallyDatum {
  TallyDatum {
    proposal_id: prop,
    phase: Summing,
    weight_param_ref: wp_ref(),
    yes_power_raw: yes_raw,
    no_power_raw: 0,
    abstain_power_raw: 0,
    voters_acc: voters,
    yes_voters_acc: yes_voters,
    top_did_vp: top,
    yes_power_eff: 0,
    no_power_eff: 0,
    abstain_power_eff: 0,
    vote_open_epoch: open_e,
    vote_close_epoch: close_e,
    voted_root: root,
  }
}

fn tally_in(d: TallyDatum) -> Input {
  util.mk_input(
    tally_ref_or(),
    util.mk_output(util.script_address(tally_sh), tally_value(), d),
  )
}

fn tally_out(d: TallyDatum) -> Output {
  util.mk_output(util.script_address(tally_sh), tally_value(), d)
}

// ── Ba cách gọi validator trên MỘT `Transaction` ──

fn call_tally(
  tx: Transaction,
  d_in: TallyDatum,
  redeemer: tally.TallyRedeemer,
  ms: Int,
) -> Bool {
  tally.tally.spend(
    tally_policy,
    vote_sh,
    nl_policy,
    wp_policy,
    c3_policy,
    window,
    ms,
    Some(d_in),
    redeemer,
    tally_ref_or(),
    tx,
  )
}

fn call_vote(tx: Transaction, redeemer: vote.VoteRedeemer) -> Bool {
  vote.vote.spend(
    tally_policy,
    nl_policy,
    taad_policy,
    ms_ep,
    window,
    Some(vd()),
    redeemer,
    vote_ref(),
    tx,
  )
}

fn call_nullifier_burn_of(tx: Transaction, p: ByteArray) -> Bool {
  nullifier.nullifier.mint(
    tally_policy,
    taad_policy,
    ms_ep,
    window,
    nullifier.BurnNullifier { proposal_id: p, did_commits: [did1] },
    nl_policy,
    tx,
  )
}

fn call_nullifier_burn(tx: Transaction) -> Bool {
  call_nullifier_burn_of(tx, prop)
}

// ════════════════════════════════════════════════════════════
// Giao dịch GOM — ba validator chạy cùng lúc trên nó
// ════════════════════════════════════════════════════════════

fn d_sum_in() -> TallyDatum {
  td(fx.root_a0, 0, 0, 0, [])
}

fn d_sum_out() -> TallyDatum {
  td(
    fx.root_a1,
    vp_of(c3),
    1,
    1,
    [TopEntry { vp_raw: vp_of(c3), choice: Yes }],
  )
}

/// Giao dịch gom một phiếu: tiêu Tally + tiêu phiếu + đốt nullifier của phiếu đó.
/// Đây là hình dạng THẬT của một lượt gom trên chuỗi.
fn gather_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [tally_in(d_sum_in()), vote_input()],
    reference_inputs: [wp_input(), c3_ref()],
    outputs: [tally_out(d_sum_out())],
    mint: burn_nl(),
    validity_range: at_epoch(close_e),
  }
}

/// BA validator, MỘT `Transaction`, một `ms_per_epoch`. Ca này là hình dạng hợp lệ
/// duy nhất của lượt gom, và nó phải qua ở cả ba.
test gom_ba_validator_cung_tx_qua() {
  let tx = gather_tx()
  and {
    call_tally(tx, d_sum_in(), tally.SumBatch { insert_proofs: [fx.ins_a1()] }, ms_ep),
    call_vote(tx, vote.ConsumeForTally { book_proof: fx.mem_a1_1() }),
    call_nullifier_burn(tx),
  }
}

/// `ms_per_epoch` áp LỆCH: `tally` nhận giá trị của một mạng khác trên ĐÚNG giao
/// dịch mà hai validator kia vừa cho qua. Cùng một `validity_range` suy ra `e = 4`
/// thay vì `e = 20` ⇒ lượt gom bị coi là trước khi đóng phiếu.
///
/// Đây là phép đo cho "`ms_per_epoch` phải là MỘT nguồn": nó chứng minh hai
/// validator áp lệch không cho ra một lỗi nào ở chỗ áp, mà cho ra một lỗi ở chỗ
/// KHÁC — nơi không ai đi tìm.
test gom_lech_ms_per_epoch_thi_do() fail {
  let tx = gather_tx()
  expect
    call_tally(
      tx,
      d_sum_in(),
      tally.SumBatch { insert_proofs: [fx.ins_a1()] },
      ms_ep_mang_khac,
    )
  True
}

/// Mặt đối chứng của ca trên: hai validator kia VẪN qua trên cùng giao dịch đó.
/// Không có ca này thì ca trên không phân biệt được "lệch tham số" với "giao dịch
/// vốn đã sai".
test gom_hai_validator_kia_van_qua_tren_cung_tx() {
  let tx = gather_tx()
  and {
    call_vote(tx, vote.ConsumeForTally { book_proof: fx.mem_a1_1() }),
    call_nullifier_burn(tx),
  }
}

/// `RetractVote` trên ĐÚNG giao dịch gom phải ĐỎ.
///
/// Chốt thật sự đỏ ở đây là (R1) — lượt gom không để lại output nào tại script
/// phiếu, nên "rút phiếu tại chỗ" không có chỗ để rút về. Vế số học `e < close` so
/// với `e >= close` được ghim ở chỗ khác (`vote_test` ▸ cặp `roi_nhau_*` dựng trên
/// cùng một `Transaction`), và KHÔNG ghim được ở đây: một `Transaction` có Tally
/// làm input thì `RetractVote` không đọc được Tally (nó đọc từ reference input),
/// mà ledger cũng không cho một UTxO vừa là input vừa là reference input. Hai hình
/// dạng loại trừ nhau ở tầng ledger trước khi đến tầng validator.
test retract_tren_tx_gom_do() fail {
  expect call_vote(gather_tx(), vote.RetractVote)
  True
}

// ════════════════════════════════════════════════════════════
// Finalize + ConsumeForTally trên cùng một giao dịch
// ════════════════════════════════════════════════════════════
//
// Đây là đòn NGHIÊM TRỌNG-2: đóng sổ VÀ tiêu huỷ phiếu chưa đếm trong một giao
// dịch. Phiếu biến mất vĩnh viễn (min-ADA + token nullifier) mà không bao giờ vào
// tally. `Finalize` một mình KHÔNG chặn được — nó không biết gì về phiếu; chốt duy
// nhất chặn là (V5) của `vote`.

fn d_fin_in() -> TallyDatum {
  td(fx.root_a0, 0, 0, 0, [])
}

fn d_fin_out() -> TallyDatum {
  TallyDatum { ..d_fin_in(), phase: Clamped }
}

/// Giao dịch đóng sổ CÓ KÈM một phiếu bị tiêu và nullifier bị đốt.
fn finalize_plus_consume_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [tally_in(d_fin_in()), vote_input()],
    reference_inputs: [wp_input()],
    outputs: [tally_out(d_fin_out())],
    mint: burn_nl(),
    validity_range: at_epoch(close_e + window),
  }
}

/// `Finalize` tự nó QUA trên giao dịch đó — đây là tiền đề của ca sau. Không có ca
/// này thì ca sau không chứng minh được rằng chốt đang chặn là (V5) chứ không phải
/// một vế nào của `Finalize`.
test finalize_tu_no_qua_tren_tx_co_phieu_bi_tieu() {
  call_tally(finalize_plus_consume_tx(), d_fin_in(), tally.Finalize, ms_ep)
}

/// Và việc ĐỐT nullifier cũng qua ở tầng policy: sau `vote_close` thì đốt là hợp
/// lệ. Nên không có chốt nào ngoài (V5) đứng giữa phiếu và sự tiêu huỷ.
test dot_nullifier_tu_no_qua_tren_cung_tx() {
  call_nullifier_burn(finalize_plus_consume_tx())
}

/// (V5) — `ConsumeForTally` ĐỎ: sổ ở Tally output vẫn rỗng, nên phiếu không được
/// ghi vào đâu. Ba ca trên cùng một giao dịch này khoanh đúng một chốt.
test consume_tren_tx_finalize_do_o_v5() fail {
  expect
    call_vote(
      finalize_plus_consume_tx(),
      vote.ConsumeForTally { book_proof: fx.mem_a1_1() },
    )
  True
}

/// Và cũng không có chứng minh nào cứu được: `mpf.has` trên gốc RỖNG là sai với
/// mọi chứng minh. Ca này phân biệt "chọn sai chứng minh" với "sổ vốn rỗng".
test consume_tren_tx_finalize_khong_chung_minh_nao_cuu_duoc() fail {
  expect
    call_vote(
      finalize_plus_consume_tx(),
      vote.ConsumeForTally { book_proof: [] },
    )
  True
}

/// Giao dịch đóng sổ mà Tally output GHI thêm vào sổ — hai ca dưới đây dùng CHUNG
/// nó, và chúng đỏ/xanh ở hai validator KHÁC NHAU. Đó là chỗ hai chốt khoá chéo:
/// không cửa nào mở một mình.
fn finalize_ghi_so_tx() -> Transaction {
  Transaction {
    ..finalize_plus_consume_tx(),
    outputs: [tally_out(TallyDatum { ..d_fin_out(), voted_root: fx.root_a1 })],
  }
}

/// Đối chứng: khi sổ ở output CÓ ghi phiếu, (V5) QUA. Nó chứng minh (V5) không
/// phải một vế luôn-đỏ.
test consume_qua_khi_so_co_ghi() {
  call_vote(
    finalize_ghi_so_tx(),
    vote.ConsumeForTally { book_proof: fx.mem_a1_1() },
  )
}

/// Và trên CHÍNH giao dịch đó `Finalize` ĐỎ, vì nó ghim `voted_root` y nguyên.
/// Ghép hai ca: muốn phiếu sống thì phải ghi sổ, mà ghi sổ thì không đóng được sổ
/// ⇒ lối "đóng sổ kèm tiêu huỷ phiếu" không có hình dạng nào hợp lệ.
test finalize_do_khi_so_bi_ghi_o_luot_dong() fail {
  expect call_tally(finalize_ghi_so_tx(), d_fin_in(), tally.Finalize, ms_ep)
  True
}

// ════════════════════════════════════════════════════════════
// Đốt nullifier GIỮA cửa sổ bỏ phiếu bằng căn cứ mượn từ proposal khác
// ════════════════════════════════════════════════════════════
//
// Kịch bản phá: `tally_policy` là one-shot theo PHA, nên mọi proposal của pha dùng
// chung policy đó và khác nhau ở TÊN token. Một tally CŨ đã quá hạn thoả mãn mọi
// vế thời gian với MỌI `e`. Nếu căn cứ đốt lấy từ "một tally bất kỳ" thì đốt
// nullifier của proposal đang mở đi lọt ngay giữa cửa sổ bỏ phiếu của nó.
//
// Năm ca dưới đây chạy trên CÙNG MỘT giao dịch và trả lời trọn vẹn câu hỏi "hậu
// quả tới đâu": một ca ở tầng policy (chỗ được vá) và ba ca ở tầng `vote` (chỗ
// chặn thật, và chúng chặn kể cả khi policy lỏng).

const prop_cu: ByteArray = #"beef"

const close_cu: Int = 5

/// Tally của proposal CŨ, đã quá `close_cu + window` từ lâu.
fn tally_cu_input() -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop_cu, 1)
  util.mk_input(
    OutputReference { transaction_id: #"cc", output_index: 0 },
    util.mk_output(
      util.script_address(tally_sh),
      val,
      TallyDatum { ..td(fx.root_a0, 0, 0, 0, []), proposal_id: prop_cu,
                   vote_open_epoch: 0, vote_close_epoch: close_cu },
    ),
  )
}

/// Epoch 15 nằm GIỮA cửa sổ bỏ phiếu của `prop` ([10, 20)). Phiếu bị tiêu, token
/// nullifier bị đốt, căn cứ là tally của `prop_cu`.
fn dot_giua_cua_so_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [vote_input(), tally_cu_input()],
    // Tally THẬT của `prop` có mặt làm reference input — để mỗi ca dưới đây đỏ ở
    // đúng chốt mang tên nó, không đỏ vì "không tìm thấy tally nào".
    reference_inputs: [
      wp_input(),
      c3_ref(),
      tally_cu_input(),
      tally_in(d_sum_in()),
    ],
    outputs: [],
    mint: burn_nl(),
    validity_range: at_epoch(15),
  }
}

/// (1) Tầng policy — chỗ được vá. Căn cứ thời gian phải đọc từ tally của ĐÚNG
/// `prop`; giao dịch này không có tally nào của `prop` nên cả hai đường tắt.
test dot_giua_cua_so_policy_tu_choi() fail {
  expect call_nullifier_burn(dot_giua_cua_so_tx())
  True
}

/// (2) Đối chứng — chứng minh giao dịch này KHÔNG bị chặn vì một lý do khác. Khai
/// `proposal_id = prop_cu` thì tên token đốt không khớp `H(did‖prop_cu)`, nên ca
/// này cũng đỏ, nhưng ở chốt (B1) chứ không phải (B2). Hai ca cùng đỏ ở HAI chốt
/// khác nhau ⇒ không chốt nào đang gánh hộ chốt kia.
test dot_giua_cua_so_khai_proposal_cu_cung_tu_choi() fail {
  expect call_nullifier_burn_of(dot_giua_cua_so_tx(), prop_cu)
  True
}

/// (3) `ConsumeForTally` ĐỎ: (V4) đòi tally của ĐÚNG `prop` bị tiêu cùng tx.
test dot_giua_cua_so_consume_do() fail {
  expect
    call_vote(
      dot_giua_cua_so_tx(),
      vote.ConsumeForTally { book_proof: fx.mem_a1_1() },
    )
  True
}

/// (4) `ReclaimVote` ĐỎ: (C2) đòi `e ≥ close + window` đọc từ tally của `prop`.
test dot_giua_cua_so_reclaim_do() fail {
  expect call_vote(dot_giua_cua_so_tx(), vote.ReclaimVote)
  True
}

/// Đối chứng HÌNH DẠNG: CÙNG giao dịch đó, chỉ dịch `e` ra sau `close + window`
/// của `prop`, thì đốt QUA ở tầng policy. Không có ca này thì bốn ca trên chỉ
/// chứng minh "giao dịch đó bị từ chối", chứ không chứng minh nó bị từ chối vì
/// CĂN CỨ THỜI GIAN — nó có thể bị từ chối vì dựng sai một chỗ nào khác.
test dot_sau_han_tren_cung_hinh_dang_qua() {
  call_nullifier_burn(
    Transaction {
      ..dot_giua_cua_so_tx(),
      validity_range: at_epoch(close_e + window),
    },
  )
}

// Nhánh thứ ba của `vote` — `RetractVote` — không cần ca ở đây: nó ép
// `tx.mint == assets.zero`, nên KHÔNG giao dịch có đốt nào khớp nó. Chốt đó đã
// được `retract_len_dot_nullifier_tu_choi` (tệp `vote_test`) ghim trên một giao
// dịch rút hợp lệ về mọi mặt khác — dựng lại ở đây chỉ được một ca đỏ ở chốt đếm
// output, tức đỏ vì lý do khác với tên nó.
