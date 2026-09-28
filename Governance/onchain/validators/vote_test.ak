// Ca kiểm `vote` v2 — tầng ScriptContext.
//
// Kỷ luật của mọi ca ÂM ở đây: dựng đầu vào KHÁC bản dương ĐÚNG MỘT vế, để ca đỏ
// ở chốt mang tên nó chứ không trượt xuống chốt kế tiếp. Chỗ dễ trượt nhất là bỏ
// cả một reference input — khi đó tx chết ở phép đọc Tally, không ở chốt đang đo.

use aiken/builtin
use aiken/interval
use aiken/interval.{Interval}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/mpf_fixtures as fx
use magiclamp/governance/names.{nullifier_name}
use magiclamp/governance/types.{
  No, Summing, TallyDatum, VoteChoice, VoteDatum, Yes,
}
use magiclamp/governance/util
use vote

const tally_policy: PolicyId = #"7a11"

const nl_policy: PolicyId = #"7777"

const taad_policy: PolicyId = #"7aad"

const vote_sh: ByteArray = #"c0"

const tally_sh: ByteArray = #"7a"

const ms_ep: Int = 86_400_000

const window: Int = 3

const open_e: Int = 10

const close_e: Int = 20

/// Bộ `b` của `mpf_fixtures`: proposal_id = #"22", did #"11" và #"12".
const prop: ByteArray = #"22"

const did1: ByteArray = #"11"

const did2: ByteArray = #"12"

const ctrl: ByteArray = #"c1"

const dev: ByteArray = #"d1"

fn nl1() -> ByteArray {
  nullifier_name(did1, prop)
}

fn nl2() -> ByteArray {
  nullifier_name(did2, prop)
}

// ── Tally UTxO ──

fn tally_datum(root: ByteArray) -> TallyDatum {
  TallyDatum {
    proposal_id: prop,
    phase: Summing,
    weight_param_ref: util.mk_ref(7),
    yes_power_raw: 0,
    no_power_raw: 0,
    abstain_power_raw: 0,
    voters_acc: 0,
    yes_voters_acc: 0,
    top_did_vp: [],
    yes_power_eff: 0,
    no_power_eff: 0,
    abstain_power_eff: 0,
    vote_open_epoch: open_e,
    vote_close_epoch: close_e,
    voted_root: root,
  }
}

fn tally_value() -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop, 1)
}

fn tally_input(root: ByteArray) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(
      util.script_address(tally_sh),
      tally_value(),
      tally_datum(root),
    ),
  )
}

fn tally_output(root: ByteArray) -> Output {
  util.mk_output(util.script_address(tally_sh), tally_value(), tally_datum(root))
}

// ── Anchor TAAD ──

fn anchor_datum(entity_ix: Int, parent_some: Bool, depth: Int) -> Data {
  let parent: Data =
    if parent_some {
      builtin.constr_data(0, [builtin.b_data("did:phoenix:cha")])
    } else {
      builtin.constr_data(1, [])
    }
  builtin.constr_data(
    0,
    [
      builtin.b_data("did:phoenix:t"),
      builtin.constr_data(entity_ix, []),
      builtin.b_data(ctrl),
      builtin.b_data(#"02aa"),
      builtin.i_data(3),
      builtin.constr_data(0, []),
      builtin.list_data([]),
      parent,
      builtin.constr_data(1, []),
      builtin.constr_data(1, []),
      builtin.constr_data(1, []),
      builtin.constr_data(1, []),
      builtin.constr_data(1, []),
      builtin.i_data(depth),
      builtin.b_data(dev),
      builtin.list_data([]),
      builtin.constr_data(1, []),
      builtin.i_data(12_345_000),
    ],
  )
}

fn anchor_ref(name: ByteArray, d: Data) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(taad_policy, name, 1)
  util.mk_input(
    util.mk_ref(9),
    util.mk_output(util.script_address(taad_policy), val, d),
  )
}

fn anchor_person(name: ByteArray) -> Input {
  anchor_ref(name, anchor_datum(0, False, 0))
}

// ── UTxO phiếu ──

fn vd_of(did: ByteArray, choice: VoteChoice) -> VoteDatum {
  VoteDatum {
    proposal_id: prop,
    did_commit: did,
    nullifier: nullifier_name(did, prop),
    choice,
    c1_capped: 0,
    c2_capped: 0,
    c3_capped: 0,
    c4_capped: 0,
  }
}

fn vote_value(nl: ByteArray) -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(nl_policy, nl, 1)
}

fn vote_input(vd: VoteDatum, ix: Int) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(vote_sh), vote_value(vd.nullifier), vd),
  )
}

fn at_epoch(e: Int) -> Interval {
  interval.between(e * ms_ep, e * ms_ep + 1000)
}

fn burn(nl: ByteArray) -> Value {
  assets.zero |> assets.add(nl_policy, nl, -1)
}

fn run(
  vd: VoteDatum,
  redeemer: vote.VoteRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  vote.vote.spend(
    tally_policy,
    nl_policy,
    taad_policy,
    ms_ep,
    window,
    Some(vd),
    redeemer,
    own_ref,
    tx,
  )
}

// ════════════════════════════════════════════════════════════
// ConsumeForTally
// ════════════════════════════════════════════════════════════

/// Lô MỘT phiếu: sổ đi từ rỗng sang 1 DID. Chứng minh membership của did1 trong
/// sổ 1 DID là chứng minh rỗng.
fn consume_tx_one() -> Transaction {
  let v1 = vd_of(did1, Yes)
  Transaction {
    ..placeholder,
    inputs: [tally_input(fx.root_b0), vote_input(v1, 1)],
    outputs: [tally_output(fx.root_b1)],
    mint: burn(nl1()),
    validity_range: at_epoch(close_e),
  }
}

test consume_happy_mot_phieu() {
  run(
    vd_of(did1, Yes),
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    consume_tx_one(),
  )
}

/// Lô HAI phiếu: cả hai phiếu phải qua trên CÙNG một `Transaction`.
fn consume_tx_two() -> Transaction {
  let v1 = vd_of(did1, Yes)
  let v2 = vd_of(did2, No)
  Transaction {
    ..placeholder,
    inputs: [tally_input(fx.root_b0), vote_input(v1, 1), vote_input(v2, 2)],
    outputs: [tally_output(fx.root_b2)],
    mint: burn(nl1()) |> assets.add(nl_policy, nl2(), -1),
    validity_range: at_epoch(close_e),
  }
}

test consume_happy_hai_phieu_cung_tx() {
  let tx = consume_tx_two()
  and {
    run(
      vd_of(did1, Yes),
      vote.ConsumeForTally { book_proof: fx.mem_b1_2() },
      util.mk_ref(1),
      tx,
    ),
    run(
      vd_of(did2, No),
      vote.ConsumeForTally { book_proof: fx.mem_b2_2() },
      util.mk_ref(2),
      tx,
    ),
  }
}

/// (V5) — sổ ra KHÔNG chứa did của phiếu này. Dựng bằng cách để Tally output giữ
/// gốc CŨ (`root_b0`); mọi vế khác y hệt bản dương.
test consume_phieu_khong_vao_so_tu_choi() fail {
  let v1 = vd_of(did1, Yes)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(fx.root_b0), vote_input(v1, 1)],
      outputs: [tally_output(fx.root_b0)],
      mint: burn(nl1()),
      validity_range: at_epoch(close_e),
    }
  expect run(
    v1,
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    tx,
  )
  True
}

/// (V5) — sổ ra ĐÚNG nhưng chứng minh là của DID KHÁC.
test consume_chung_minh_cua_did_khac_tu_choi() fail {
  let tx = consume_tx_two()
  expect run(
    vd_of(did1, Yes),
    vote.ConsumeForTally { book_proof: fx.mem_b2_2() },
    util.mk_ref(1),
    tx,
  )
  True
}

/// (V5) — chứng minh của sổ 2 DID dùng cho lô 1 DID: gốc không khớp.
test consume_chung_minh_sai_the_he_so_tu_choi() fail {
  expect run(
    vd_of(did1, Yes),
    vote.ConsumeForTally { book_proof: fx.mem_b1_2() },
    util.mk_ref(1),
    consume_tx_one(),
  )
  True
}

/// (V2) — không đốt nullifier. Sổ ra vẫn đúng, Tally vẫn bị tiêu.
test consume_khong_dot_tu_choi() fail {
  let v1 = vd_of(did1, Yes)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(fx.root_b0), vote_input(v1, 1)],
      outputs: [tally_output(fx.root_b1)],
      mint: assets.zero,
      validity_range: at_epoch(close_e),
    }
  expect run(
    v1,
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    tx,
  )
  True
}

/// (V3) — đốt một đơn vị nhưng một output tại vote script vẫn GIỮ nullifier đó.
/// Không có (V3) thì (V2) một mình cho phép phiếu sống tiếp.
test consume_output_van_giu_nullifier_tu_choi() fail {
  let v1 = vd_of(did1, Yes)
  let keep = util.mk_output(util.script_address(vote_sh), vote_value(nl1()), v1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(fx.root_b0), vote_input(v1, 1)],
      outputs: [tally_output(fx.root_b1), keep],
      mint: burn(nl1()),
      validity_range: at_epoch(close_e),
    }
  expect run(
    v1,
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    tx,
  )
  True
}

/// (V4) — Tally chỉ là REFERENCE input, không bị tiêu. Sổ ra vẫn đúng.
test consume_tally_khong_bi_tieu_tu_choi() fail {
  let v1 = vd_of(did1, Yes)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [vote_input(v1, 1)],
      reference_inputs: [tally_input(fx.root_b0)],
      outputs: [tally_output(fx.root_b1)],
      mint: burn(nl1()),
      validity_range: at_epoch(close_e),
    }
  expect run(
    v1,
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    tx,
  )
  True
}

/// (V1) — UTxO phiếu mang token nullifier của DID KHÁC. `vd.nullifier` vẫn khớp
/// `H(did‖prop)` nên ca này đo đúng vế "token buộc vào datum".
test consume_token_cua_did_khac_tu_choi() fail {
  let v1 = vd_of(did1, Yes)
  let wrong =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(util.script_address(vote_sh), vote_value(nl2()), v1),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(fx.root_b0), wrong],
      outputs: [tally_output(fx.root_b1)],
      mint: burn(nl1()),
      validity_range: at_epoch(close_e),
    }
  expect run(
    v1,
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    tx,
  )
  True
}

/// (V1) — `vd.nullifier` bịa, không bằng `H(did‖prop)`.
test consume_nullifier_bia_tu_choi() fail {
  let bad = VoteDatum { ..vd_of(did1, Yes), nullifier: #"deadbeef" }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input(fx.root_b0), vote_input(bad, 1)],
      outputs: [tally_output(fx.root_b1)],
      mint: burn(#"deadbeef"),
      validity_range: at_epoch(close_e),
    }
  expect run(
    bad,
    vote.ConsumeForTally { book_proof: fx.mem_b1_1() },
    util.mk_ref(1),
    tx,
  )
  True
}

// ════════════════════════════════════════════════════════════
// RetractVote
// ════════════════════════════════════════════════════════════

fn refs_ok() -> List<Input> {
  [tally_input(fx.root_b0), anchor_person(did1)]
}

fn retract_out(vd: VoteDatum, val: Value) -> Output {
  util.mk_output(util.script_address(vote_sh), val, vd)
}

fn retract_tx(
  e: Int,
  refs: List<Input>,
  out: Output,
  mint: Value,
  sigs: List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [vote_input(vd_of(did1, Yes), 1)],
    reference_inputs: refs,
    outputs: [out],
    mint,
    extra_signatories: sigs,
    validity_range: at_epoch(e),
  }
}

test retract_happy() {
  let out = retract_out(vd_of(did1, No), vote_value(nl1()))
  run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e - 1, refs_ok(), out, assets.zero, [ctrl, dev]),
  )
}

/// (R2) — `e == vote_close_epoch`. Mọi vế khác y hệt bản dương.
test retract_dung_bien_dong_tu_choi() fail {
  let out = retract_out(vd_of(did1, No), vote_value(nl1()))
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e, refs_ok(), out, assets.zero, [ctrl, dev]),
  )
  True
}

/// (R3) — giữ NGUYÊN anchor + ref Tally, bỏ ĐÚNG chữ ký.
test retract_khong_chu_ky_tu_choi() fail {
  let out = retract_out(vd_of(did1, No), vote_value(nl1()))
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e - 1, refs_ok(), out, assets.zero, []),
  )
  True
}

/// (R3) — đủ hai chữ ký nhưng anchor là DID con `Bot`.
test retract_anchor_bot_tu_choi() fail {
  let out = retract_out(vd_of(did1, No), vote_value(nl1()))
  let refs =
    [tally_input(fx.root_b0), anchor_ref(did1, anchor_datum(5, False, 0))]
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e - 1, refs, out, assets.zero, [ctrl, dev]),
  )
  True
}

/// (R4) — hút ADA: output giữ token, datum đúng, chỉ ít lovelace hơn.
test retract_hut_ada_tu_choi() fail {
  let drained =
    assets.from_lovelace(1_000_000) |> assets.add(nl_policy, nl1(), 1)
  let out = retract_out(vd_of(did1, No), drained)
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e - 1, refs_ok(), out, assets.zero, [ctrl, dev]),
  )
  True
}

/// (R5) — `choice` KHÔNG đổi: rút phiếu phải là một thay đổi thật.
test retract_khong_doi_lua_chon_tu_choi() fail {
  let out = retract_out(vd_of(did1, Yes), vote_value(nl1()))
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e - 1, refs_ok(), out, assets.zero, [ctrl, dev]),
  )
  True
}

/// (R5) — lén đốt nullifier trong lượt rút (đường đốt-rồi-đúc-lại).
test retract_len_dot_nullifier_tu_choi() fail {
  let out = retract_out(vd_of(did1, No), assets.from_lovelace(2_000_000))
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    retract_tx(close_e - 1, refs_ok(), out, burn(nl1()), [ctrl, dev]),
  )
  True
}

/// (R1) — hai phiếu trong một lần rút: một chữ ký thoả cho cả hai.
test retract_hai_phieu_mot_luot_tu_choi() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [vote_input(vd_of(did1, Yes), 1), vote_input(vd_of(did2, Yes), 2)],
      reference_inputs: refs_ok(),
      outputs: [
        retract_out(vd_of(did1, No), vote_value(nl1())),
        retract_out(vd_of(did2, No), vote_value(nl2())),
      ],
      mint: assets.zero,
      extra_signatories: [ctrl, dev],
      validity_range: at_epoch(close_e - 1),
    }
  expect run(vd_of(did1, Yes), vote.RetractVote, util.mk_ref(1), tx)
  True
}

// ════════════════════════════════════════════════════════════
// ReclaimVote
// ════════════════════════════════════════════════════════════

fn reclaim_tx(e: Int, refs: List<Input>, sigs: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [vote_input(vd_of(did1, Yes), 1)],
    reference_inputs: refs,
    outputs: [
      util.mk_output_no_datum(
        util.vk_address(#"a0"),
        assets.from_lovelace(1_800_000),
      ),
    ],
    mint: burn(nl1()),
    extra_signatories: sigs,
    validity_range: at_epoch(e),
  }
}

test reclaim_happy() {
  run(
    vd_of(did1, Yes),
    vote.ReclaimVote,
    util.mk_ref(1),
    reclaim_tx(close_e + window, refs_ok(), [ctrl, dev]),
  )
}

/// (C2) — `e == close + window − 1`: chưa hết cửa sổ gom.
test reclaim_truoc_han_tu_choi() fail {
  expect run(
    vd_of(did1, Yes),
    vote.ReclaimVote,
    util.mk_ref(1),
    reclaim_tx(close_e + window - 1, refs_ok(), [ctrl, dev]),
  )
  True
}

/// (C3) — giữ NGUYÊN anchor + ref Tally, bỏ ĐÚNG chữ ký. Không có vế này thì bất
/// kỳ ai cũng lấy được min-ADA phiếu của người khác.
test reclaim_khong_chu_ky_tu_choi() fail {
  expect run(
    vd_of(did1, Yes),
    vote.ReclaimVote,
    util.mk_ref(1),
    reclaim_tx(close_e + window, refs_ok(), []),
  )
  True
}

/// (C4) — không đốt nullifier: token phiếu ra ngoài script, không ai gác nữa.
test reclaim_khong_dot_nullifier_tu_choi() fail {
  let tx =
    Transaction {
      ..reclaim_tx(close_e + window, refs_ok(), [ctrl, dev]),
      mint: assets.zero,
    }
  expect run(vd_of(did1, Yes), vote.ReclaimVote, util.mk_ref(1), tx)
  True
}

// ── Hai cửa sổ RỜI NHAU, đo trên CÙNG một `Transaction` ──
//    Hai ca dưới dùng CÙNG một hàm dựng tx, cùng tham số ⇒ cùng một giá trị
//    `Transaction`. Aiken không bắt được lỗi thành `False` nên không gộp được hai
//    nhánh vào một ca; cặp ca này là cách đúng để đo "rời nhau".

fn tx_sau_cua_so_gom() -> Transaction {
  reclaim_tx(close_e + window, refs_ok(), [ctrl, dev])
}

test roi_nhau_reclaim_qua_tren_tx_do() {
  run(vd_of(did1, Yes), vote.ReclaimVote, util.mk_ref(1), tx_sau_cua_so_gom())
}

test roi_nhau_retract_do_tren_cung_tx() fail {
  expect run(
    vd_of(did1, Yes),
    vote.RetractVote,
    util.mk_ref(1),
    tx_sau_cua_so_gom(),
  )
  True
}
