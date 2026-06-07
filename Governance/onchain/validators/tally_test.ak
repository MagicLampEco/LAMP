// Tests validator Tally — Finalize Summing→Clamped ép clamp đúng (bft_floor từ WeightParam);
// SumBatch DERIVE power từ Vote inputs thật + đốt nullifier; negative-test Finding 2/3.

use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/power.{Knot, scale}
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

const prop_id: ByteArray = #"abcd"

fn wp_ref_or() -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: 7 }
}

// ── Bảng knots w=1 (pow[c]=c·SCALE) cho cả 4 yếu tố → vp_raw = (c1·c2·c3·c4)·SCALE ──
fn lin_knots() -> List<Knot> {
  [Knot { c: 0, pow: 0 }, Knot { c: 1_000_000_000, pow: 1_000_000_000 * scale }]
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

fn summing(
  yes_raw: Int,
  no_raw: Int,
  abstain_raw: Int,
  voters: Int,
  yes_voters: Int,
  top: List<TopEntry>,
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
  }
}

// VoteDatum với c* và choice — vp_raw = c1·c2·c3·c4·SCALE (w=1 mọi yếu tố).
fn vote_datum(
  choice: VoteChoice,
  c1: Int,
  c2: Int,
  c3: Int,
  c4: Int,
  nl: ByteArray,
) -> VoteDatum {
  VoteDatum {
    proposal_id: prop_id,
    did_commit: nl,
    nullifier: nl,
    choice,
    c1_capped: c1,
    c2_capped: c2,
    c3_capped: c3,
    c4_capped: c4,
  }
}

// Vote input UTxO tại vote script hash mang VoteDatum.
fn vote_input(vd: VoteDatum, ix: Int) -> Input {
  let val = assets.from_lovelace(2_000_000)
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(vote_sh), val, vd),
  )
}

// Tally input UTxO + NFT.
fn tally_input(d_in: TallyDatum) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, #"01", 1)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(tally_sh), val, d_in),
  )
}

fn tally_out(d_out: TallyDatum) -> Output {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, #"01", 1)
  util.mk_output(util.script_address(tally_sh), val, d_out)
}

fn run_finalize(tx: Transaction, d_in: TallyDatum) -> Bool {
  tally.tally.spend(
    tally_policy,
    vote_sh,
    null_policy,
    wp_policy,
    Some(d_in),
    tally.Finalize,
    util.mk_ref(0),
    tx,
  )
}

fn run_sum(tx: Transaction, d_in: TallyDatum) -> Bool {
  tally.tally.spend(
    tally_policy,
    vote_sh,
    null_policy,
    wp_policy,
    Some(d_in),
    tally.SumBatch,
    util.mk_ref(0),
    tx,
  )
}

// ════════════════════════════════════════════════════════════
// Finalize — clamp đúng (bft_floor từ WeightParam)
// ════════════════════════════════════════════════════════════

fn finalize_tx(d_in: TallyDatum, d_out: TallyDatum, bft: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [tally_input(d_in)],
    reference_inputs: [wp_input(bft)],
    outputs: [tally_out(d_out)],
  }
}

// ── TC1: clamp ΣVP THÔ. ΣVP=1000, F=10 → τ=100. Whale Yes vp_raw=400 vượt → trừ 300 ──
test finalize_clamp_tc1() {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out =
    TallyDatum {
      ..d_in,
      phase: Clamped,
      yes_power_eff: 400,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  let tx = finalize_tx(d_in, d_out, 10)
  run_finalize(tx, d_in)
}

// ── TC1b: mẫu số PHẢI ΣVP THÔ (1000). eff theo τ=70 (SAI) → clamp_consistent fail ──
test finalize_wrong_denominator_reject() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out =
    TallyDatum {
      ..d_in,
      phase: Clamped,
      yes_power_eff: 370,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  let tx = finalize_tx(d_in, d_out, 10)
  expect run_finalize(tx, d_in)
  True
}

// ── 2. REJECT forged eff: power_eff bịa (450 thay 400) → clamp_consistent fail ──
test finalize_forged_eff_reject() fail {
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out =
    TallyDatum {
      ..d_in,
      phase: Clamped,
      yes_power_eff: 450,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  let tx = finalize_tx(d_in, d_out, 10)
  expect run_finalize(tx, d_in)
  True
}

// ── 3. NO whale: power_eff == power_raw ──
test finalize_no_clamp_needed() {
  let top = [TopEntry { vp_raw: 50, choice: Yes }]
  let d_in = summing(700, 200, 100, 30, 25, top)
  let d_out =
    TallyDatum {
      ..d_in,
      phase: Clamped,
      yes_power_eff: 700,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  let tx = finalize_tx(d_in, d_out, 10)
  run_finalize(tx, d_in)
}

// ── 6. Finalize từ pha Clamped (không phải Summing) → fail (phase sai) ──
test finalize_wrong_phase_reject() fail {
  let base = summing(700, 200, 100, 30, 25, [])
  let d_in = TallyDatum { ..base, phase: Clamped }
  let d_out =
    TallyDatum {
      ..d_in,
      yes_power_eff: 700,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  let tx = finalize_tx(d_in, d_out, 10)
  expect run_finalize(tx, d_in)
  True
}

// ── 7. Finding 1: bft_floor=0 trong WeightParam giả → Finalize fail (expect bft≥1) ──
test finalize_bft_zero_reject() fail {
  let d_in = summing(700, 200, 100, 30, 25, [])
  let d_out =
    TallyDatum {
      ..d_in,
      phase: Clamped,
      yes_power_eff: 700,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  let tx = finalize_tx(d_in, d_out, 0)
  expect run_finalize(tx, d_in)
  True
}

// ════════════════════════════════════════════════════════════
// SumBatch — DERIVE power từ Vote thật (Finding 2) + đốt nullifier (Finding 3)
// ════════════════════════════════════════════════════════════

// SumBatch tx: tally in/out + Vote inputs + WeightParam ref + đốt nullifier mỗi phiếu.
fn sum_tx(
  d_in: TallyDatum,
  d_out: TallyDatum,
  votes_in: List<Input>,
  burn_mint: Value,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [tally_input(d_in), ..votes_in],
    reference_inputs: [wp_input(10)],
    outputs: [tally_out(d_out)],
    mint: burn_mint,
  }
}

// 1 phiếu Yes với c1=c2=c3=c4=10 → vp_raw = 10^4·SCALE = 10000·SCALE.
const v1_vp: Int = 10_000 * scale

// ── HAPPY: 1 Vote Yes thật, nullifier bị đốt, d_out = d_in + derive + heap chèn vote ──
//    F=10 ⇒ limit=9; heap rỗng + 1 entry vp_raw=v1_vp → d_out heap = [{v1_vp, Yes}].
test sum_derive_happy() {
  let nl = #"aa01"
  let v = vote_datum(Yes, 10, 10, 10, 10, nl)
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out = summing(v1_vp, 0, 0, 1, 1, [TopEntry { vp_raw: v1_vp, choice: Yes }])
  let burn = assets.zero |> assets.add(null_policy, nl, -1)
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], burn)
  run_sum(tx, d_in)
}

// ── Finding 2: tăng power KHÔNG có Vote input → fail (votes rỗng + delta khác 0) ──
//    Không có Vote input nào → derive=(0,..); d_out bơm yes_power_raw=v1_vp → consistent fail.
//    Đồng thời votes rỗng cũng đụng expect length≥1. Cả hai chốt: không có phiếu, không power.
test sum_no_vote_inflate_reject() fail {
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out = summing(v1_vp, 0, 0, 1, 1, [])
  // bơm power không phiếu
  let burn = assets.zero
  // không đốt gì
  let tx = sum_tx(d_in, d_out, [], burn)
  expect run_sum(tx, d_in)
  True
}

// ── Finding 2: có Vote thật nhưng d_out bơm power QUÁ mức derive → consistent fail ──
test sum_overcount_reject() fail {
  let nl = #"aa01"
  let v = vote_datum(Yes, 10, 10, 10, 10, nl)
  let d_in = summing(0, 0, 0, 0, 0, [])
  // heap ĐÚNG (cô lập lỗi về power_raw bịa); derive yes=v1_vp; d_out bịa gấp đôi.
  let d_out =
    summing(2 * v1_vp, 0, 0, 1, 1, [TopEntry { vp_raw: v1_vp, choice: Yes }])
  let burn = assets.zero |> assets.add(null_policy, nl, -1)
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], burn)
  expect run_sum(tx, d_in)
  True
}

// ── Finding 3: Vote thật, d_out đúng derive, NHƯNG nullifier KHÔNG bị đốt → fail ──
test sum_nullifier_not_burned_reject() fail {
  let nl = #"aa01"
  let v = vote_datum(Yes, 10, 10, 10, 10, nl)
  let d_in = summing(0, 0, 0, 0, 0, [])
  // heap + power ĐÚNG (cô lập lỗi nullifier không đốt).
  let d_out =
    summing(v1_vp, 0, 0, 1, 1, [TopEntry { vp_raw: v1_vp, choice: Yes }])
  let burn = assets.zero
  // KHÔNG đốt nullifier
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], burn)
  expect run_sum(tx, d_in)
  True
}

// ── Finding 3: 2 phiếu nhưng chỉ đốt 1 nullifier → dict.size mismatch → fail ──
test sum_double_count_one_burn_reject() fail {
  let nl_a = #"aa01"
  let nl_b = #"bb02"
  let va = vote_datum(Yes, 10, 10, 10, 10, nl_a)
  let vb = vote_datum(Yes, 10, 10, 10, 10, nl_b)
  let d_in = summing(0, 0, 0, 0, 0, [])
  // heap + power ĐÚNG (cô lập lỗi: chỉ đốt 1/2 nullifier → dict.size mismatch).
  let heap =
    [
      TopEntry { vp_raw: v1_vp, choice: Yes },
      TopEntry { vp_raw: v1_vp, choice: Yes },
    ]
  let d_out = summing(2 * v1_vp, 0, 0, 2, 2, heap)
  // chỉ đốt 1 trong 2 nullifier.
  let burn = assets.zero |> assets.add(null_policy, nl_a, -1)
  let tx = sum_tx(d_in, d_out, [vote_input(va, 1), vote_input(vb, 2)], burn)
  expect run_sum(tx, d_in)
  True
}

// ── HAPPY 2 phiếu (Yes + No), đốt cả 2 nullifier, derive đúng mỗi phe ──
test sum_two_votes_happy() {
  let nl_a = #"aa01"
  let nl_b = #"bb02"
  let va = vote_datum(Yes, 10, 10, 10, 10, nl_a)
  let vb = vote_datum(No, 10, 10, 10, 10, nl_b)
  let d_in = summing(0, 0, 0, 0, 0, [])
  // foldl chèn theo thứ tự lô (Yes trước No), bằng vp_raw → giữ thứ tự: [Yes, No].
  let heap =
    [TopEntry { vp_raw: v1_vp, choice: Yes }, TopEntry { vp_raw: v1_vp, choice: No }]
  let d_out = summing(v1_vp, v1_vp, 0, 2, 1, heap)
  let burn =
    assets.zero
      |> assets.add(null_policy, nl_a, -1)
      |> assets.add(null_policy, nl_b, -1)
  let tx = sum_tx(d_in, d_out, [vote_input(va, 1), vote_input(vb, 2)], burn)
  run_sum(tx, d_in)
}

// ── Abstain phiếu: vào abstain_power_raw, voters tăng nhưng yes_voters KHÔNG ──
test sum_abstain_happy() {
  let nl = #"cc03"
  let v = vote_datum(Abstain, 10, 10, 10, 10, nl)
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out =
    summing(0, 0, v1_vp, 1, 0, [TopEntry { vp_raw: v1_vp, choice: Abstain }])
  let burn = assets.zero |> assets.add(null_policy, nl, -1)
  let tx = sum_tx(d_in, d_out, [vote_input(v, 1)], burn)
  run_sum(tx, d_in)
}

// ════════════════════════════════════════════════════════════
// Heap top-(F-1) — ĐÓNG soundness BFT-cap (D6). Cá voi BUỘC vào heap; cấm nhồi giả.
// ════════════════════════════════════════════════════════════

// SumBatch tx với bft_floor TÙY CHỌN (whale vượt trần cần F nhỏ để τ=ΣVP/F < vp_raw whale).
fn sum_tx_bft(
  d_in: TallyDatum,
  d_out: TallyDatum,
  votes_in: List<Input>,
  burn_mint: Value,
  bft: Int,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [tally_input(d_in), ..votes_in],
    reference_inputs: [wp_input(bft)],
    outputs: [tally_out(d_out)],
    mint: burn_mint,
  }
}

fn nl_of(i: Int) -> ByteArray {
  // nullifier duy nhất mỗi phiếu (đốt 1 token/loại).
  when i is {
    1 -> #"01"
    2 -> #"02"
    3 -> #"03"
    4 -> #"04"
    5 -> #"05"
    6 -> #"06"
    _ -> #"ff"
  }
}

// vp_raw cho c1=c2=c3=c4=c (w=1): vp = c^4 · SCALE.
fn vp4(c: Int) -> Int {
  c * c * c * c * scale
}

// whale c=20 → vp=160_000·SCALE ; small c=5 → vp=625·SCALE.
const whale_c: Int = 20

const small_c: Int = 5

fn whale_vp() -> Int {
  vp4(whale_c)
}

fn small_vp() -> Int {
  vp4(small_c)
}

// đốt tất cả nullifier của một danh sách vote.
fn burn_all(votes: List<VoteDatum>) -> Value {
  list.foldl(
    votes,
    assets.zero,
    fn(v, acc) { assets.add(acc, null_policy, v.nullifier, -1) },
  )
}

// ── NEGATIVE 1: cá voi BỎ PHIẾU nhưng d_out.top_did_vp KHÔNG chứa nó → fail.
//    F=3 (limit=2). 1 whale Yes + 1 small Yes. canonical heap = [{whale,Yes},{small,Yes}].
//    d_out CỐ TÌNH bỏ whale (chỉ giữ small) → top_heap_consistent mismatch → fail.
test sum_whale_missing_from_heap_reject() fail {
  let vw = vote_datum(Yes, whale_c, whale_c, whale_c, whale_c, nl_of(1))
  let vs = vote_datum(Yes, small_c, small_c, small_c, small_c, nl_of(2))
  let votes = [vw, vs]
  let d_in = summing(0, 0, 0, 0, 0, [])
  // power_raw ĐÚNG (cô lập lỗi vào heap): yes_raw = whale+small.
  let bad_heap = [TopEntry { vp_raw: small_vp(), choice: Yes }]
  let d_out = summing(whale_vp() + small_vp(), 0, 0, 2, 2, bad_heap)
  let burn = burn_all(votes)
  let tx =
    sum_tx_bft(d_in, d_out, [vote_input(vw, 1), vote_input(vs, 2)], burn, 3)
  expect run_sum(tx, d_in)
  True
}

// ── NEGATIVE 2: NHỒI entry giả KHÔNG ứng vote nào → fail.
//    1 whale Yes thật. canonical heap = [{whale,Yes}]. d_out nhồi thêm 1 entry bịa
//    (vp_raw không phiếu nào tạo ra) → mismatch → fail. (limit F-1=2 đủ chỗ, nên fail
//    KHÔNG do cắt mà do entry giả không khớp canonical.)
test sum_forged_heap_entry_reject() fail {
  let vw = vote_datum(Yes, whale_c, whale_c, whale_c, whale_c, nl_of(1))
  let votes = [vw]
  let d_in = summing(0, 0, 0, 0, 0, [])
  let forged = TopEntry { vp_raw: 999_999 * scale, choice: No }
  let bad_heap = [TopEntry { vp_raw: whale_vp(), choice: Yes }, forged]
  let d_out = summing(whale_vp(), 0, 0, 1, 1, bad_heap)
  let burn = burn_all(votes)
  let tx = sum_tx_bft(d_in, d_out, [vote_input(vw, 1)], burn, 3)
  expect run_sum(tx, d_in)
  True
}

// ── NEGATIVE 3: heap GIỮ NGUYÊN (hành vi code CŨ d_out.top==d_in.top) khi cá voi mới
//    bỏ phiếu → fail. Đây CHÍNH là lỗ hổng cũ. d_in heap=[] ; whale vote ;
//    d_out heap=[] (giữ nguyên) → bỏ sót whale → fail.
test sum_old_keep_heap_reject() fail {
  let vw = vote_datum(Yes, whale_c, whale_c, whale_c, whale_c, nl_of(1))
  let votes = [vw]
  let d_in = summing(0, 0, 0, 0, 0, [])
  // mô phỏng hành vi CŨ: heap output == heap input (rỗng) dù có whale mới.
  let d_out = summing(whale_vp(), 0, 0, 1, 1, [])
  let burn = burn_all(votes)
  let tx = sum_tx_bft(d_in, d_out, [vote_input(vw, 1)], burn, 3)
  expect run_sum(tx, d_in)
  True
}

// ── HAPPY E2E: 2 cá voi (A Yes, B No) + 4 phiếu nhỏ Yes → heap giữ ĐÚNG 2 cá voi →
//    Finalize clamp trừ đúng phần vượt → VP_eff mỗi DID ≤ ΣVP/F.
//    F=3, τ=ΣVP/3. ΣVP = 2·whale + 4·small = 320_000+2_500 = 322_500·SCALE.
//    τ = 322_500·SCALE/3 = 107_500·SCALE. whale=160_000>τ ; small=625<τ.
//    canonical heap (limit 2) = [{whale,Yes},{whale,No}].
test sum_then_finalize_two_whales_e2e() {
  let a = vote_datum(Yes, whale_c, whale_c, whale_c, whale_c, nl_of(1))
  let b = vote_datum(No, whale_c, whale_c, whale_c, whale_c, nl_of(2))
  let s1 = vote_datum(Yes, small_c, small_c, small_c, small_c, nl_of(3))
  let s2 = vote_datum(Yes, small_c, small_c, small_c, small_c, nl_of(4))
  let s3 = vote_datum(Yes, small_c, small_c, small_c, small_c, nl_of(5))
  let s4 = vote_datum(Yes, small_c, small_c, small_c, small_c, nl_of(6))
  let votes = [a, b, s1, s2, s3, s4]
  let ins =
    [
      vote_input(a, 1), vote_input(b, 2), vote_input(s1, 3), vote_input(s2, 4),
      vote_input(s3, 5), vote_input(s4, 6),
    ]
  let d_in = summing(0, 0, 0, 0, 0, [])
  // canonical heap: foldl chèn A,B (bằng vp) → [A,B]; smalls < whale → ngoài top-2.
  let heap =
    [
      TopEntry { vp_raw: whale_vp(), choice: Yes },
      TopEntry { vp_raw: whale_vp(), choice: No },
    ]
  let yes_raw = whale_vp() + 4 * small_vp()
  // 160_000+2_500 = 162_500
  let no_raw = whale_vp()
  // 160_000
  let d_sum = summing(yes_raw, no_raw, 0, 6, 5, heap)
  let burn = burn_all(votes)
  let tx_sum = sum_tx_bft(d_in, d_sum, ins, burn, 3)
  let ok_sum = run_sum(tx_sum, d_in)

  // Finalize clamp: τ=107_500·SCALE. excess Yes (A)=52_500 ; excess No (B)=52_500.
  let tau = ( whale_vp() * 2 + small_vp() * 4 ) / 3
  let yes_eff = yes_raw - ( whale_vp() - tau )
  let no_eff = no_raw - ( whale_vp() - tau )
  let d_clamped =
    TallyDatum {
      ..d_sum,
      phase: Clamped,
      yes_power_eff: yes_eff,
      no_power_eff: no_eff,
      abstain_power_eff: 0,
    }
  let tx_fin =
    Transaction {
      ..placeholder,
      inputs: [tally_input(d_sum)],
      reference_inputs: [wp_input(3)],
      outputs: [tally_out(d_clamped)],
    }
  let ok_fin = run_finalize(tx_fin, d_sum)

  // mỗi cá voi VP_eff = τ (≤ ΣVP/F) → không DID nào thoát trần.
  and {
    ok_sum,
    ok_fin,
    no_eff == tau,
    yes_eff == 4 * small_vp() + tau,
  }
}

// ════════════════════════════════════════════════════════════
// RE-AUDIT vòng 4 (đối kháng) — bổ sung: đa-lô, F=3 ba-cá-voi bất khả, Finalize thoát trần
// ════════════════════════════════════════════════════════════

// ── RA1 (đa-lô): cá voi NHỎ vào batch trước rồi bị F−1 entry LỚN HƠN đẩy khỏi top-(F-1).
//    Chứng minh eviction LÀNH: entry bị đẩy có vp_raw THẤP hơn F−1 entry giữ lại ⇒ tại τ
//    cuối nó KHÔNG phải cá voi (nếu phải thì có ≥F cá voi — mâu thuẫn). d_in mang [10000];
//    batch 2 entry 160000 (>10000). merge_top([{10000}],[{160000,160000}],2)=[{160000},{160000}].
//    d_out heap PHẢI == canonical (10000 bị đẩy) → run_sum PASS với heap đúng.
test sum_multibatch_evict_small_is_sound() {
  let w_small = vp4(10)
  // 10_000·SCALE — đã trong heap d_in từ lô trước
  let vb1 = vote_datum(No, 20, 20, 20, 20, nl_of(1))
  let vb2 = vote_datum(No, 20, 20, 20, 20, nl_of(2))
  // canonical: chèn 2 entry 160_000 vào [{10000,Yes}] giảm dần, cắt 2 → [{big,No},{big,No}].
  let big = vp4(20)
  let heap =
    [TopEntry { vp_raw: big, choice: No }, TopEntry { vp_raw: big, choice: No }]
  let d_in =
    summing(w_small, 0, 0, 1, 1, [TopEntry { vp_raw: w_small, choice: Yes }])
  let d_out = summing(w_small, 2 * big, 0, 3, 1, heap)
  let burn = burn_all([vb1, vb2])
  let tx =
    sum_tx_bft(d_in, d_out, [vote_input(vb1, 1), vote_input(vb2, 2)], burn, 3)
  run_sum(tx, d_in)
}

// ── RA2 (đa-lô, ÉP heap SAI): cùng kịch bản RA1 nhưng d_out CỐ GIỮ entry nhỏ (10000) và
//    bỏ 1 entry lớn → KHÔNG khớp canonical merge_top → fail. (Chứng minh off-chain không
//    thể giữ lại 1 DID nhỏ để né việc 1 cá voi lớn vào heap.)
test sum_multibatch_keep_small_drop_big_reject() fail {
  let w_small = vp4(10)
  let vb1 = vote_datum(No, 20, 20, 20, 20, nl_of(1))
  let vb2 = vote_datum(No, 20, 20, 20, 20, nl_of(2))
  let big = vp4(20)
  // SAI: giữ small + 1 big (canonical phải là [big,big]).
  let bad_heap =
    [
      TopEntry { vp_raw: big, choice: No },
      TopEntry { vp_raw: w_small, choice: Yes },
    ]
  let d_in =
    summing(w_small, 0, 0, 1, 1, [TopEntry { vp_raw: w_small, choice: Yes }])
  let d_out = summing(w_small, 2 * big, 0, 3, 1, bad_heap)
  let burn = burn_all([vb1, vb2])
  let tx =
    sum_tx_bft(d_in, d_out, [vote_input(vb1, 1), vote_input(vb2, 2)], burn, 3)
  expect run_sum(tx, d_in)
  True
}

// ── RA3 (Finalize thoát trần): heap ĐÚNG chứa 2 cá voi, nhưng d_out tính power_eff để
//    1 DID GIỮ vp_raw nguyên (không trừ phần vượt) → clamp_consistent fail. Cụ thể: B(No)
//    cá voi vp=160000>τ nhưng no_power_eff CỐ Ý = no_raw (không clamp) → fail.
//    ⇒ KHÔNG DID nào có thể giữ VP_eff > τ qua Finalize.
test finalize_whale_keeps_full_power_reject() fail {
  let big = vp4(20)
  // 160_000
  let small = vp4(5)
  // 625
  let heap =
    [
      TopEntry { vp_raw: big, choice: Yes },
      TopEntry { vp_raw: big, choice: No },
    ]
  let yes_raw = big + 4 * small
  let no_raw = big
  let d_in = summing(yes_raw, no_raw, 0, 6, 5, heap)
  let tau = ( big * 2 + small * 4 ) / 3
  let yes_eff = yes_raw - ( big - tau )
  // SAI: no_eff KHÔNG trừ phần vượt → B giữ VP_eff = big > τ (thoát trần).
  let d_out =
    TallyDatum {
      ..d_in,
      phase: Clamped,
      yes_power_eff: yes_eff,
      no_power_eff: no_raw,
      abstain_power_eff: 0,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(d_in)],
      reference_inputs: [wp_input(3)],
      outputs: [tally_out(d_out)],
    }
  expect run_finalize(tx, d_in)
  True
}

// ── RA4 (F=2, cá voi DUY NHẤT bắt buộc vào heap limit=1): F=2 ⇒ limit=1. 1 cá voi lớn +
//    1 nhỏ. canonical heap top-1 = [{big}]. d_out bỏ big giữ small → fail. (Trần τ=ΣVP/2.)
test sum_f2_single_whale_must_be_in_heap_reject() fail {
  let big = vp4(20)
  let small = vp4(5)
  let vw = vote_datum(Yes, 20, 20, 20, 20, nl_of(1))
  let vs = vote_datum(Yes, 5, 5, 5, 5, nl_of(2))
  // SAI: top-1 phải là big nhưng d_out giữ small.
  let bad_heap = [TopEntry { vp_raw: small, choice: Yes }]
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out = summing(big + small, 0, 0, 2, 2, bad_heap)
  let burn = burn_all([vw, vs])
  let tx =
    sum_tx_bft(d_in, d_out, [vote_input(vw, 1), vote_input(vs, 2)], burn, 2)
  expect run_sum(tx, d_in)
  True
}

// ── RA5 (heap canonical ĐÚNG ở F=2, top-1 = big): khẳng định mặt thuận của RA4.
test sum_f2_single_whale_in_heap_ok() {
  let big = vp4(20)
  let small = vp4(5)
  let vw = vote_datum(Yes, 20, 20, 20, 20, nl_of(1))
  let vs = vote_datum(Yes, 5, 5, 5, 5, nl_of(2))
  // foldl chèn vw rồi vs vào []: [big] rồi chèn small (small<big) → [big,small]; take_1 → [big].
  let heap = [TopEntry { vp_raw: big, choice: Yes }]
  let d_in = summing(0, 0, 0, 0, 0, [])
  let d_out = summing(big + small, 0, 0, 2, 2, heap)
  let burn = burn_all([vw, vs])
  let tx =
    sum_tx_bft(d_in, d_out, [vote_input(vw, 1), vote_input(vs, 2)], burn, 2)
  run_sum(tx, d_in)
}

// ── HAPPY MERGE qua heap kế thừa: d_in MANG SẴN 1 whale nhỏ, batch thêm 1 whale lớn hơn
//    → merge giữ cả 2 (limit 2), sắp giảm. Chứng minh heap kế thừa d_in + chèn đúng.
test sum_merge_inherit_plus_batch() {
  let w1 = vp4(10)
  // 10_000·SCALE
  let w2 = vp4(20)
  // 160_000·SCALE  (lớn hơn w1)
  let d_in = summing(w1, 0, 0, 1, 1, [TopEntry { vp_raw: w1, choice: Yes }])
  let vb = vote_datum(No, 20, 20, 20, 20, nl_of(1))
  // canonical merge([{w1,Yes}],[{w2,No}],2): w2>w1 → [{w2,No},{w1,Yes}].
  let heap =
    [TopEntry { vp_raw: w2, choice: No }, TopEntry { vp_raw: w1, choice: Yes }]
  let d_out = summing(w1, w2, 0, 2, 1, heap)
  let burn = burn_all([vb])
  let tx = sum_tx_bft(d_in, d_out, [vote_input(vb, 1)], burn, 3)
  run_sum(tx, d_in)
}
