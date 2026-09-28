// Ca kiểm validator `tally` v2.
//
// Ba nhóm: (a) `Finalize` ép clamp đúng + chốt thời gian F0 + ghim ba trường v2;
// (b) `SumBatch` DERIVE power từ Vote input THẬT, ghi SỔ MPF, đốt nullifier;
// (c) bảo toàn UTxO (value, địa chỉ đầy đủ, số lượng NFT, chống double-satisfaction).
//
// ┌─ VÌ SAO BẢNG KNOTS Ở ĐÂY CÓ `pow(0) = SCALE` ──────────────────────────────┐
// │ Cổng nguồn `c_sources_ok` ép `c1 = c2 = c4 = 0` (chưa có policy chứng thực). │
// │ Với bảng `pow(0) = 0` thì tích bằng 0 và MỌI cử tri có VP = 0 — lúc đó các ca │
// │ cá voi/heap/clamp dưới đây xanh ở CẢ HAI cực đột biến, tức không kiểm gì.    │
// │ `weight_guard.is_live` chỉ đòi `pow` tại knot cuối > `pow` tại knot đầu, KHÔNG │
// │ đòi `pow(0) = 0`; nên bảng ở đây đặt `pow(0) = SCALE` và để C3 lái VP:        │
// │   vp_raw = interp(k3, c3) = SCALE · (c3 + 1).                                │
// │ Đây là lựa chọn của BỘ KIỂM, không phải của bảng thật khi deploy.            │
// └─────────────────────────────────────────────────────────────────────────────┘

use aiken/collection/list
use aiken/interval
use aiken/interval.{Interval}
use aiken/merkle_patricia_forestry.{Proof}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/mpf_fixtures as fx
use magiclamp/governance/names.{nullifier_name}
use magiclamp/governance/power.{Knot, scale}
use magiclamp/governance/tally as tally_lib
use magiclamp/governance/types.{
  Abstain, Clamped, No, Summing, TallyDatum, TopEntry, VoteChoice, VoteDatum,
  WeightParam, Yes,
}
use magiclamp/governance/util
use tally

const tally_policy: PolicyId = #"7a11"

const tally_sh: ByteArray = #"7a"

const vote_sh: ByteArray = #"c0"

const null_policy: PolicyId = #"7777"

const wp_policy: PolicyId = #"a0a0"

const c3_policy: PolicyId = #"c3c3"

/// Bộ `a` của `mpf_fixtures`: proposal_id = #"abcd", did #"11"…#"16".
const prop_id: ByteArray = #"abcd"

const ms_ep: Int = 86_400_000

const window: Int = 3

const open_e: Int = 10

const close_e: Int = 20

/// epoch hợp lệ cho `SumBatch` (trong `[close, close+window)`).
const e_sum: Int = 20

/// epoch hợp lệ cho `Finalize` (từ `close+window`).
const e_fin: Int = 23

fn did_of(i: Int) -> ByteArray {
  when i is {
    1 -> #"11"
    2 -> #"12"
    3 -> #"13"
    4 -> #"14"
    5 -> #"15"
    6 -> #"16"
    _ -> #"ff"
  }
}

fn at_epoch(e: Int) -> Interval {
  interval.between(e * ms_ep, e * ms_ep + 1000)
}

fn wp_ref_or() -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: 7 }
}

// ── Bảng knots: pow(c) = SCALE·(c+1) trên [0, 10^9] ⇒ interp tuyến tính CHÍNH XÁC ──
fn lin_knots() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 1_000_000_000, pow: 1_000_000_000 * scale },
  ]
}

/// vp_raw của một cử tri khai `c3 = c` (c1 = c2 = c4 = 0).
/// VP mà `derive_batch` THẬT SỰ trả về ở mức validator, với bảng knots HỢP KHUÔN
/// (`pow(0) = 0`, cổng G0 của `weight_guard`) và `c_sources_ok` đang ép
/// `c1 = c2 = c4 = 0` (`[C1-C2-C4-SOURCE]`): công thức là tích NHÂN, một thừa số 0
/// kéo cả tích về 0 ⇒ **VP của mọi cử tri bằng 0, không phụ thuộc `c`**.
///
/// Bản trước của hàm này trả `scale · (c + 1)`, tức nó ngầm giả định một bảng có
/// `pow(0) = SCALE` — bảng mà cổng G0 phải BÁC. Nói cách khác, mọi con số power
/// khác 0 trong tệp này trước đây đến từ một bảng không hợp lệ. Giữ tham số `c` để
/// các ca đọc được, nhưng nó KHÔNG còn ảnh hưởng kết quả — và đó là điều đúng.
///
/// Hệ quả về ĐỘ PHỦ, nói thẳng: các ca ở tệp này giờ kiểm ĐƯỜNG ĐI (derive → heap →
/// đốt nullifier → sổ MPF → chốt thời gian) chứ không kiểm ĐỘ LỚN. Clamp BFT và heap
/// top-(F−1) — hai chốt chống cá voi — được kiểm ở mức THƯ VIỆN
/// (`lib/magiclamp/governance/tally.ak`, khối `hypothetical_knots_pow0_scale`), và
/// PHẢI nối lại ở mức validator khi `[C1-C2-C4-SOURCE]` có nguồn. Xem
/// `[VP-ZERO-FACTOR]` trong `SPEC.md`.
fn vp_of(_c: Int) -> Int {
  0
}

fn wp_datum(bft: Int) -> WeightParam {
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
}

fn wp_input(bft: Int) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, #"50", 1)
  Input {
    output_reference: wp_ref_or(),
    output: util.mk_output(util.script_address(#"a0"), val, wp_datum(bft)),
  }
}

// ── Bảng lõm w≈0.5 — dùng để dựng bảng weight VI PHẠM D8 (`w_4` nặng hơn `w_3`) ──
fn sqrt_knots() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 250_000_000, pow: 15_811 * scale },
    Knot { c: 1_000_000_000, pow: 31_623 * scale },
  ]
}

fn wp_datum_d8_violating(bft: Int) -> WeightParam {
  WeightParam { ..wp_datum(bft), k3: sqrt_knots(), k4: lin_knots() }
}

fn wp_input_d8_violating(bft: Int) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, #"50", 1)
  Input {
    output_reference: wp_ref_or(),
    output: util.mk_output(
      util.script_address(#"a0"),
      val,
      wp_datum_d8_violating(bft),
    ),
  }
}

// ── NFT chứng thực C3: tên tài sản = did_commit, giá trị trong datum ──
fn c3_ref(did: ByteArray, value: Int, ix: Int) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(c3_policy, did, 1)
  util.mk_input(
    util.mk_ref(100 + ix),
    util.mk_output(util.script_address(#"c3"), val, value),
  )
}

/// Chứng thực C3 cho MỌI phiếu trong lô, đúng bằng giá trị phiếu khai.
fn c3_refs(votes: List<VoteDatum>) -> List<Input> {
  list.indexed_map(votes, fn(ix, v) { c3_ref(v.did_commit, v.c3_capped, ix) })
}

// ── TallyDatum ──

fn summing_r(
  yes_raw: Int,
  no_raw: Int,
  abstain_raw: Int,
  voters: Int,
  yes_voters: Int,
  top: List<TopEntry>,
  root: ByteArray,
) -> TallyDatum {
  TallyDatum {
    proposal_id: prop_id,
    phase: Summing,
    weight_param_ref: wp_ref_or(),
    yes_power_raw: yes_raw,
    no_power_raw: no_raw,
    abstain_power_raw: abstain_raw,
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

fn summing(
  yes_raw: Int,
  no_raw: Int,
  abstain_raw: Int,
  voters: Int,
  yes_voters: Int,
  top: List<TopEntry>,
) -> TallyDatum {
  summing_r(yes_raw, no_raw, abstain_raw, voters, yes_voters, top, fx.root_a0)
}

/// Chuyển sang pha Clamped, GIỮ nguyên ba trường v2 (đường trung thực).
fn clamped_of(d: TallyDatum, ye: Int, ne: Int, ae: Int) -> TallyDatum {
  TallyDatum {
    ..d,
    phase: Clamped,
    yes_power_eff: ye,
    no_power_eff: ne,
    abstain_power_eff: ae,
  }
}

// ── VoteDatum: c1 = c2 = c4 = 0 (cổng nguồn), C3 lái VP; nullifier = H(did‖prop) ──
fn vote_datum(choice: VoteChoice, c3: Int, did: ByteArray) -> VoteDatum {
  VoteDatum {
    proposal_id: prop_id,
    did_commit: did,
    nullifier: nullifier_name(did, prop_id),
    choice,
    c1_capped: 0,
    c2_capped: 0,
    c3_capped: c3,
    c4_capped: 0,
  }
}

fn vote_input(vd: VoteDatum, ix: Int) -> Input {
  let val = assets.from_lovelace(2_000_000)
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(vote_sh), val, vd),
  )
}

fn burn_all(votes: List<VoteDatum>) -> Value {
  list.foldl(
    votes,
    assets.zero,
    fn(v, acc) { assets.add(acc, null_policy, v.nullifier, -1) },
  )
}

// ── Tally UTxO ──

fn tally_value() -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop_id, 1)
}

fn tally_input_with(d_in: TallyDatum, val: Value) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(tally_sh), val, d_in),
  )
}

fn tally_input(d_in: TallyDatum) -> Input {
  tally_input_with(d_in, tally_value())
}

fn tally_out_with(d_out: TallyDatum, val: Value) -> Output {
  util.mk_output(util.script_address(tally_sh), val, d_out)
}

fn tally_out(d_out: TallyDatum) -> Output {
  tally_out_with(d_out, tally_value())
}

fn tally_out_staked(d_out: TallyDatum) -> Output {
  util.mk_output(
    util.script_address_staked(tally_sh, #"5747"),
    tally_value(),
    d_out,
  )
}

fn drained_value() -> Value {
  assets.from_lovelace(500_000) |> assets.add(tally_policy, prop_id, 1)
}

fn doubled_nft_value() -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop_id, 2)
}

fn tally_input_second(d_in: TallyDatum) -> Input {
  util.mk_input(
    util.mk_ref(77),
    util.mk_output(util.script_address(tally_sh), tally_value(), d_in),
  )
}

// ── Chạy validator ──

fn run_finalize(tx: Transaction, d_in: TallyDatum) -> Bool {
  tally.tally.spend(
    tally_policy,
    vote_sh,
    null_policy,
    wp_policy,
    c3_policy,
    window,
    ms_ep,
    Some(d_in),
    tally.Finalize,
    util.mk_ref(0),
    tx,
  )
}

fn run_sum(tx: Transaction, d_in: TallyDatum, proofs: List<Proof>) -> Bool {
  tally.tally.spend(
    tally_policy,
    vote_sh,
    null_policy,
    wp_policy,
    c3_policy,
    window,
    ms_ep,
    Some(d_in),
    tally.SumBatch { insert_proofs: proofs },
    util.mk_ref(0),
    tx,
  )
}

// ── Khuôn giao dịch ──

fn finalize_tx_full(inp: Input, out: Output, bft: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [inp],
    reference_inputs: [wp_input(bft)],
    outputs: [out],
    validity_range: at_epoch(e_fin),
  }
}

fn finalize_tx(d_in: TallyDatum, d_out: TallyDatum, bft: Int) -> Transaction {
  finalize_tx_full(tally_input(d_in), tally_out(d_out), bft)
}

fn finalize_tx_many(
  inputs: List<Input>,
  outputs: List<Output>,
  bft: Int,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: inputs,
    reference_inputs: [wp_input(bft)],
    outputs: outputs,
    validity_range: at_epoch(e_fin),
  }
}

fn sum_tx_full(
  inp: Input,
  out: Output,
  votes_in: List<Input>,
  votes: List<VoteDatum>,
  burn_mint: Value,
  bft: Int,
  e: Int,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [inp, ..votes_in],
    reference_inputs: [wp_input(bft), ..c3_refs(votes)],
    outputs: [out],
    mint: burn_mint,
    validity_range: at_epoch(e),
  }
}

fn sum_tx_bft(
  d_in: TallyDatum,
  d_out: TallyDatum,
  votes_in: List<Input>,
  votes: List<VoteDatum>,
  burn_mint: Value,
  bft: Int,
) -> Transaction {
  sum_tx_full(
    tally_input(d_in),
    tally_out(d_out),
    votes_in,
    votes,
    burn_mint,
    bft,
    e_sum,
  )
}

fn sum_tx(
  d_in: TallyDatum,
  d_out: TallyDatum,
  votes_in: List<Input>,
  votes: List<VoteDatum>,
  burn_mint: Value,
) -> Transaction {
  sum_tx_bft(d_in, d_out, votes_in, votes, burn_mint, 10)
}

// ════════════════════════════════════════════════════════════
// Finalize — clamp + chốt thời gian F0 + ghim ba trường v2
// ════════════════════════════════════════════════════════════

test finalize_clamp_tc1() {
  // ΣVP=1000, F=10 → τ=100. Một DID Yes vp_raw=400 vượt trần → trừ 300.
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 400, 200, 100)
  run_finalize(finalize_tx(d_in, d_out, 10), d_in)
}

test finalize_wrong_denominator_reject() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  // F=5 ⇒ τ=200 ⇒ excess=200 ⇒ yes_eff=500, nhưng d_out ghi theo F=10.
  let d_out = clamped_of(d_in, 400, 200, 100)
  expect run_finalize(finalize_tx(d_in, d_out, 5), d_in)
  True
}

test finalize_forged_eff_reject() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 450, 200, 100)
  expect run_finalize(finalize_tx(d_in, d_out, 10), d_in)
  True
}

test finalize_no_clamp_needed() {
  let top = [TopEntry { vp_raw: 50, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 700, 200, 100)
  run_finalize(finalize_tx(d_in, d_out, 10), d_in)
}

test finalize_wrong_phase_reject() fail {
  let base = summing(700, 200, 100, 30, 25, [])
  let d_in = TallyDatum { ..base, phase: Clamped }
  let d_out = clamped_of(base, 700, 200, 100)
  expect run_finalize(finalize_tx(d_in, d_out, 10), d_in)
  True
}

test finalize_bft_zero_reject() fail {
  let d_in = summing(700, 200, 100, 30, 25, [])
  let d_out = clamped_of(d_in, 700, 200, 100)
  expect run_finalize(finalize_tx(d_in, d_out, 0), d_in)
  True
}

/// (F0) — `e == close + window − 1`: cửa sổ gom CHƯA hết. Mọi vế khác y hệt
/// `finalize_clamp_tc1`, nên ca này đỏ ở đúng chốt thời gian.
test finalize_truoc_khi_het_cua_so_gom_tu_choi() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 400, 200, 100)
  let tx =
    Transaction {
      ..finalize_tx(d_in, d_out, 10),
      validity_range: at_epoch(close_e + window - 1),
    }
  expect run_finalize(tx, d_in)
  True
}

/// (F0) — ghim `voted_root`. Không có vế này thì chính `Finalize` ghi lại sổ tuỳ ý
/// và lớp (V5) của `vote` (phiếu phải có trong sổ) bị vô hiệu hoá.
test finalize_ghi_lai_so_tu_choi() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing_r(700, 200, 100, 30, 25, top, fx.root_a2)
  let d_out =
    TallyDatum { ..clamped_of(d_in, 400, 200, 100), voted_root: fx.root_a1 }
  expect run_finalize(finalize_tx(d_in, d_out, 10), d_in)
  True
}

/// (F0) — ghim `vote_close_epoch`: dời mốc đóng phiếu ở lượt đóng sổ.
test finalize_doi_moc_dong_phieu_tu_choi() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out =
    TallyDatum { ..clamped_of(d_in, 400, 200, 100), vote_close_epoch: close_e + 5 }
  expect run_finalize(finalize_tx(d_in, d_out, 10), d_in)
  True
}

/// (F0) — ghim `vote_open_epoch`.
test finalize_doi_moc_mo_phieu_tu_choi() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out =
    TallyDatum { ..clamped_of(d_in, 400, 200, 100), vote_open_epoch: open_e + 1 }
  expect run_finalize(finalize_tx(d_in, d_out, 10), d_in)
  True
}

// ════════════════════════════════════════════════════════════
// SumBatch — DERIVE power + SỔ MPF + đốt nullifier
// ════════════════════════════════════════════════════════════

fn v1_vp() -> Int {
  vp_of(10)
}

test sum_derive_happy() {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  run_sum(tx, d_in, [fx.ins_a1()])
}

/// Bơm power mà KHÔNG có phiếu nào: đỏ ở `list.length(votes) >= 1`.
test sum_no_vote_inflate_reject() fail {
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out = summing(v1_vp(), 0, 0, 1, 1, [])
  let tx = sum_tx(d_in, d_out, [], [], assets.zero)
  expect run_sum(tx, d_in, [])
  True
}

/// Nullifier KHÔNG bị đốt. Sổ + power + heap ĐÚNG để cô lập.
test sum_nullifier_not_burned_reject() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], assets.zero)
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// Hai phiếu nhưng chỉ đốt một nullifier.
test sum_double_count_one_burn_reject() fail {
  let va = vote_datum(Yes, 10, did_of(1))
  let vb = vote_datum(Yes, 10, did_of(2))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let heap =
    [
      TopEntry { vp_raw: v1_vp(), choice: Yes },
      TopEntry { vp_raw: v1_vp(), choice: Yes },
    ]
  let d_out = summing_r(2 * v1_vp(), 0, 0, 2, 2, heap, fx.root_a2)
  let burn = burn_all([va])
  let tx =
    sum_tx(d_in, d_out, [vote_input(va, 1), vote_input(vb, 2)], [va, vb], burn)
  expect run_sum(tx, d_in, [fx.ins_a1(), fx.ins_a2()])
  True
}

test sum_two_votes_happy() {
  let va = vote_datum(Yes, 10, did_of(1))
  let vb = vote_datum(No, 10, did_of(2))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let heap =
    [
      TopEntry { vp_raw: v1_vp(), choice: Yes },
      TopEntry { vp_raw: v1_vp(), choice: No },
    ]
  let d_out = summing_r(v1_vp(), v1_vp(), 0, 2, 1, heap, fx.root_a2)
  let burn = burn_all([va, vb])
  let tx =
    sum_tx(d_in, d_out, [vote_input(va, 1), vote_input(vb, 2)], [va, vb], burn)
  run_sum(tx, d_in, [fx.ins_a1(), fx.ins_a2()])
}

test sum_abstain_happy() {
  let v = vote_datum(Abstain, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      0,
      0,
      v1_vp(),
      1,
      0,
      [TopEntry { vp_raw: v1_vp(), choice: Abstain }],
      fx.root_a1,
    )
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  run_sum(tx, d_in, [fx.ins_a1()])
}

/// Chốt thời gian: `e == vote_close_epoch − 1` ⇒ lượt gộp vào CÙNG cửa sổ với
/// `RetractVote`. Mọi vế khác y hệt `sum_derive_happy`.
test sum_truoc_khi_dong_phieu_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    sum_tx_full(
      tally_input(d_in),
      tally_out(d_out),
      [vote_input(v, 1)],
      [v],
      burn_all([v]),
      10,
      close_e - 1,
    )
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// Chốt thời gian: `e == close + window` ⇒ cửa sổ gom đã hết.
test sum_sau_khi_het_cua_so_gom_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    sum_tx_full(
      tally_input(d_in),
      tally_out(d_out),
      [vote_input(v, 1)],
      [v],
      burn_all([v]),
      10,
      close_e + window,
    )
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// Lượt gộp DỜI mốc đóng phiếu về sau. Mọi vế khác y hệt `sum_derive_happy` (sổ,
/// power, heap, đốt đều đúng), nên ca này đỏ ở đúng vế GHIM cửa sổ.
///
/// Vì sao là đòn thật, không phải vệ sinh datum: `nullifier.MintNullifier` đọc cửa
/// sổ TỪ datum Tally (`vote_open <= e < vote_close`). Dời `vote_close` về sau ở một
/// lượt gộp mở lại cửa đúc phiếu — trong khi chính lượt gộp đó vừa đốt nullifier của
/// các DID đã đếm. Mỗi DID đúc lại được một phiếu nữa, bao nhiêu lần cũng được.
test sum_doi_moc_dong_phieu_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    TallyDatum {
      ..summing_r(
        v1_vp(),
        0,
        0,
        1,
        1,
        [TopEntry { vp_raw: v1_vp(), choice: Yes }],
        fx.root_a1,
      ),
      vote_close_epoch: close_e + 5,
    }
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// Đối xứng: lượt gộp dời mốc MỞ phiếu.
test sum_doi_moc_mo_phieu_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    TallyDatum {
      ..summing_r(
        v1_vp(),
        0,
        0,
        1,
        1,
        [TopEntry { vp_raw: v1_vp(), choice: Yes }],
        fx.root_a1,
      ),
      vote_open_epoch: open_e + 1,
    }
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

// ── SỔ MPF ──

/// (T2) — `d_out.voted_root` KHÔNG đổi dù lô có phiếu mới.
test sum_so_khong_ghi_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing(v1_vp(), 0, 0, 1, 1, [TopEntry { vp_raw: v1_vp(), choice: Yes }])
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// (T2) — MỘT DID hai phiếu trong CÙNG một lô. `mpf.insert` bác vì khoá đã có
/// trong cây sau lần chèn thứ nhất. Hai phiếu khác `choice` nên nullifier khác
/// nhau ⇒ `nullifiers_burned` THOẢ (đốt 2 tên, 2 phiếu) ⇒ ca này đỏ ở SỔ, không
/// trượt xuống chốt đốt nullifier.
///
/// `reference_inputs` dựng TAY: `c3_refs` sinh một NFT mỗi phiếu, mà `attested_c3`
/// đòi ĐÚNG MỘT reference input mang tên đó — hai phiếu cùng DID sẽ làm ca đỏ ở
/// cổng nguồn chứ không ở sổ. Một NFT cho DID đó là đúng hình dạng thật.
test sum_mot_did_hai_phieu_cung_lo_tu_choi() fail {
  let va = vote_datum(Yes, 10, did_of(1))
  let vb = vote_datum(No, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let heap =
    [
      TopEntry { vp_raw: v1_vp(), choice: Yes },
      TopEntry { vp_raw: v1_vp(), choice: No },
    ]
  let d_out = summing_r(v1_vp(), v1_vp(), 0, 2, 1, heap, fx.root_a2)
  let burn = burn_all([va, vb])
  let tx =
    Transaction {
      ..sum_tx(
        d_in,
        d_out,
        [vote_input(va, 1), vote_input(vb, 2)],
        [va, vb],
        burn,
      ),
      reference_inputs: [wp_input(10), c3_ref(did_of(1), 10, 0)],
    }
  expect run_sum(tx, d_in, [fx.ins_a1(), fx.ins_a2()])
  True
}

/// (T2) — DID đã có trong sổ từ lô TRƯỚC: lượt gộp thứ hai cộng lại cùng DID.
test sum_did_da_co_trong_so_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let d_out =
    summing_r(
      2 * v1_vp(),
      0,
      0,
      2,
      2,
      [
        TopEntry { vp_raw: v1_vp(), choice: Yes },
        TopEntry { vp_raw: v1_vp(), choice: Yes },
      ],
      fx.root_a2,
    )
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a2()])
  True
}

/// (T2) — số chứng minh KHÁC số phiếu.
test sum_thieu_chung_minh_tu_choi() fail {
  let va = vote_datum(Yes, 10, did_of(1))
  let vb = vote_datum(No, 10, did_of(2))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let heap =
    [
      TopEntry { vp_raw: v1_vp(), choice: Yes },
      TopEntry { vp_raw: v1_vp(), choice: No },
    ]
  let d_out = summing_r(v1_vp(), v1_vp(), 0, 2, 1, heap, fx.root_a2)
  let burn = burn_all([va, vb])
  let tx =
    sum_tx(d_in, d_out, [vote_input(va, 1), vote_input(vb, 2)], [va, vb], burn)
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

// ── Cổng NGUỒN c1/c2/c3/c4 ──

/// (T1b) — `c4_capped > 0` mà không nguồn nào chứng thực. Sổ/heap/power đều ĐÚNG
/// theo chính giá trị đó, nên ca này đỏ ở cổng nguồn.
test sum_c4_khong_nguon_tu_choi() fail {
  let v = VoteDatum { ..vote_datum(Yes, 10, did_of(1)), c4_capped: 7 }
  let vp = vp_of(10) * 8 / 1
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(vp, 0, 0, 1, 1, [TopEntry { vp_raw: vp, choice: Yes }], fx.root_a1)
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// (T1b) — `c1_capped > 0`.
test sum_c1_khong_nguon_tu_choi() fail {
  let v = VoteDatum { ..vote_datum(Yes, 10, did_of(1)), c1_capped: 3 }
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// (T1b) — `c3_capped` khai CAO HƠN giá trị NFT chứng thực. Giữ NGUYÊN reference
/// input chứng thực (giá trị 9), chỉ lật số khai lên 10.
test sum_c3_khai_cao_hon_chung_thuc_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    Transaction {
      ..sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v])),
      reference_inputs: [wp_input(10), c3_ref(did_of(1), 9, 0)],
    }
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// (T1b) — KHÔNG có NFT chứng thực C3 nào. Giữ NGUYÊN `wp` reference input để ca
/// không trượt xuống phép đọc WeightParam.
test sum_c3_khong_chung_thuc_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    Transaction {
      ..sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v])),
      reference_inputs: [wp_input(10)],
    }
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// (T1b) — chứng thực C3 của DID KHÁC (tên tài sản = did khác). Có đủ một NFT
/// `c3_policy` trong reference input, chỉ sai TÊN.
test sum_c3_chung_thuc_cua_did_khac_tu_choi() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    Transaction {
      ..sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v])),
      reference_inputs: [wp_input(10), c3_ref(did_of(2), 10, 0)],
    }
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// (T1) — `vd.nullifier` không bằng `H(did‖prop)`. Đốt đúng tên bịa đó để
/// `nullifiers_burned` vẫn thoả, nên ca đỏ ở (T1).
test sum_nullifier_bia_tu_choi() fail {
  let v = VoteDatum { ..vote_datum(Yes, 10, did_of(1)), nullifier: #"deadbeef" }
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

// ════════════════════════════════════════════════════════════
// Heap top-(F−1) — cá voi BUỘC vào heap; cấm nhồi entry giả
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// Cổng D8 ở TẦNG VALIDATOR
// ════════════════════════════════════════════════════════════

/// Giao dịch Y HỆT `finalize_clamp_tc1`, chỉ thay bảng knots trong WeightParam.
test finalize_rejects_d8_violating_weight_table() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 400, 200, 100)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(d_in)],
      reference_inputs: [wp_input_d8_violating(10)],
      outputs: [tally_out(d_out)],
      validity_range: at_epoch(e_fin),
    }
  expect run_finalize(tx, d_in)
  True
}

// ════════════════════════════════════════════════════════════
// Bảo toàn UTxO — value, ĐỊA CHỈ đầy đủ, số lượng NFT, double-satisfaction
// ════════════════════════════════════════════════════════════

test finalize_rejects_value_drain() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 400, 200, 100)
  let tx =
    finalize_tx_full(
      tally_input(d_in),
      tally_out_with(d_out, drained_value()),
      10,
    )
  expect run_finalize(tx, d_in)
  True
}

test sum_batch_rejects_value_drain() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    sum_tx_full(
      tally_input(d_in),
      tally_out_with(d_out, drained_value()),
      [vote_input(v, 1)],
      [v],
      burn_all([v]),
      10,
      e_sum,
    )
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// `util.is_at_script` chỉ so payment credential (đúng cho việc ĐẾM), nên một acc
/// ra tại `Script(tally_sh) + stake credential của người tiêu` thoả mọi vế khác.
test finalize_rejects_stake_credential_swap() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out = clamped_of(d_in, 400, 200, 100)
  let tx = finalize_tx_full(tally_input(d_in), tally_out_staked(d_out), 10)
  expect run_finalize(tx, d_in)
  True
}

test sum_batch_rejects_stake_credential_swap() fail {
  let v = vote_datum(Yes, 10, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(
      v1_vp(),
      0,
      0,
      1,
      1,
      [TopEntry { vp_raw: v1_vp(), choice: Yes }],
      fx.root_a1,
    )
  let tx =
    sum_tx_full(
      tally_input(d_in),
      tally_out_staked(d_out),
      [vote_input(v, 1)],
      [v],
      burn_all([v]),
      10,
      e_sum,
    )
  expect run_sum(tx, d_in, [fx.ins_a1()])
  True
}

/// Hai đơn vị NFT ở CẢ hai đầu ⇒ đẳng thức bảo toàn value THOẢ, và
/// `dict.size(...) == 1` cũng thoả vì nó đếm số TÊN tài sản. Chỉ vế số lượng bác.
test finalize_rejects_duplicated_nft() fail {
  let d_in = summing(700, 200, 100, 30, 25, [])
  let d_out = clamped_of(d_in, 700, 200, 100)
  let tx =
    finalize_tx_full(
      tally_input_with(d_in, doubled_nft_value()),
      tally_out_with(d_out, doubled_nft_value()),
      10,
    )
  expect run_finalize(tx, d_in)
  True
}

/// Double satisfaction: `output_at_script` lấy output KHỚP ĐẦU TIÊN, nên không đếm
/// thì một output hợp lệ thoả cho nhiều acc cùng script.
test finalize_rejects_two_inputs_at_script() fail {
  let d_in = summing(700, 200, 100, 30, 25, [])
  let d_out = clamped_of(d_in, 700, 200, 100)
  let tx =
    finalize_tx_many(
      [tally_input(d_in), tally_input_second(d_in)],
      [tally_out(d_out)],
      10,
    )
  expect run_finalize(tx, d_in)
  True
}

test finalize_rejects_two_outputs_at_script() fail {
  let d_in = summing(700, 200, 100, 30, 25, [])
  let d_out = clamped_of(d_in, 700, 200, 100)
  let tx =
    finalize_tx_many(
      [tally_input(d_in)],
      [tally_out(d_out), tally_out(d_out)],
      10,
    )
  expect run_finalize(tx, d_in)
  True
}

// ════════════════════════════════════════════════════════════
// Đã DỜI xuống mức thư viện — đừng dựng lại ở đây khi VP còn bằng 0
// ════════════════════════════════════════════════════════════
//
// Mười một ca dưới đây từng ở tệp này và nay nằm ở
// `lib/magiclamp/governance/tally.ak`, khối `hypothetical_knots_pow0_scale`:
//
//   sum_overcount_reject · sum_then_finalize_two_whales_e2e
//   sum_multibatch_evict_small_is_sound · sum_multibatch_keep_small_drop_big_reject
//   finalize_whale_keeps_full_power_reject · sum_f2_single_whale_must_be_in_heap_reject
//   sum_f2_single_whale_in_heap_ok · sum_whale_missing_from_heap_reject
//   sum_forged_heap_entry_reject · sum_old_keep_heap_reject
//   sum_merge_inherit_plus_batch
//
// Vì sao KHÔNG giữ ở mức validator: mọi ca trên nói về ĐỘ LỚN của VP (cá voi vượt
// trần, entry nhỏ bị đẩy khỏi heap, power bị bơm quá mức derive). Ở mức validator,
// `WeightParam` phải đi qua `read_weight_param` ⇒ cổng G0 ép `pow(0) == 0`; cộng với
// `c_sources_ok` đang ép `c1 = c2 = c4 = 0` (`[C1-C2-C4-SOURCE]`) thì MỌI VP bằng 0.
// Với mọi VP bằng 0 thì mọi entry heap bằng nhau và clamp là phép rỗng — ca kiểm
// XANH ở cả hai cực của đột biến, tức không ghim gì mà vẫn trông như có ghim. Đó là
// dạng hỏng tệ nhất, nên bỏ hẳn ở đây tốt hơn giữ lại cho đủ số.
//
// Các ca CÒN LẠI ở tệp này kiểm ĐƯỜNG ĐI: derive → sổ MPF → đốt nullifier → chốt
// thời gian → nguồn c* → bảo toàn UTxO. Chúng không phụ thuộc độ lớn VP nên vẫn
// phân biệt được hai cực.
//
// NGHĨA VỤ khi `[C1-C2-C4-SOURCE]` có nguồn on-chain: dựng LẠI mười một ca đó ở đây
// với bảng hợp khuôn, rồi mới được nói hai chốt chống cá voi đã ghim trên đường
// thật. Xem `[VP-ZERO-FACTOR]` trong `SPEC.md`.

// ── `[VP-ZERO-FACTOR]` — ghim HÀNH VI, không chỉ mô tả nó ──
//
// Hai ca dưới đây dựng lại PoC 1 của audit ở mức validator với bảng HỢP KHUÔN. Có
// chúng thì câu "Pha 1/2 chỉ ghi được `Rejected`" là một phép đo; thiếu chúng thì nó
// là một câu trong tài liệu, và tài liệu không chặn được gì.

/// (poc1c) Đường on-chain THẬT chạy được với bảng hợp khuôn, và nó cộng ĐÚNG 0 —
/// cử tri khai `c3` tối đa vẫn ra VP = 0 vì `c1 = c2 = c4` bị cổng nguồn ép 0 và VP
/// là tích nhân. Lô KHÔNG bị bác: gộp vẫn là thao tác hợp lệ, chỉ là nó không cộng
/// power nào. Em CỐ Ý không thêm chốt "lô phải cộng thêm gì đó" — chốt đó mâu thuẫn
/// với chính `[VP-ZERO-FACTOR]` khi `[C1-C2-C4-SOURCE]` còn treo.
test vp_zero_sumbatch_chay_duoc_ma_cong_khong() {
  let v = vote_datum(Yes, 1_000_000_000, did_of(1))
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing_r(0, 0, 0, 1, 1, [TopEntry { vp_raw: 0, choice: Yes }], fx.root_a1)
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], [v], burn_all([v]))
  and {
    run_sum(tx, d_in, [fx.ins_a1()]),
    // tiền đề: cử tri này khai `c3` TỐI ĐA. Không có vế này thì ca trên chỉ nói
    // "một phiếu c3 = 0 cộng ra 0", tức không nói gì.
    v.c3_capped == 1_000_000_000,
  }
}

/// (poc1b) Và `pass` canonical KHÔNG BAO GIỜ đúng khi mọi VP bằng 0 — kể cả với 30
/// cử tri THUẬN và `quorum_vp_threshold` đặt ở giá trị NHỎ NHẤT mà
/// `weight_param_nft` cho phép (`>= 1`). Nên `FinalizeProposal` chỉ ra `Rejected`.
test vp_zero_pass_khong_bao_gio_dung() {
  let d = clamped_of(summing_r(0, 0, 0, 30, 30, [], fx.root_a0), 0, 0, 0)
  and {
    !tally_lib.pass(d, 21, 1, 21, 2, 3),
    // và vế đang bác ĐÚNG là vế quorum VP, không phải một vế khác đi trước:
    d.voters_acc >= 21,
    d.yes_voters_acc >= 21,
    tally_lib.total_vp_eff(d) == 0,
  }
}
