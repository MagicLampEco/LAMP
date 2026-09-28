// Nullifier minting policy v2 — CỔNG WHO của đường biểu quyết.
//
// ┌─ Đổi bản chất so với v1 ────────────────────────────────────────────────────┐
// │ v1 cố dùng token nullifier để làm HAI việc: (a) chứng minh người đúc là chủ │
// │ DID, (b) bảo đảm mỗi DID chỉ một phiếu. Việc (b) BẤT KHẢ ở tầng này: token  │
// │ cùng `(policy, name)` là đồng nhất và mint policy không thấy lịch sử, nên   │
// │ không policy nào chặn được đơn vị thứ hai.                                  │
// │                                                                             │
// │ v2 chỉ giữ việc (a). Việc (b) chuyển sang SỔ DID (`TallyDatum.voted_root`,  │
// │ MPF) mà `tally.SumBatch` ép — chỗ duy nhất trên eUTXO có trạng thái toàn    │
// │ cục cho một proposal. Hệ quả: bản sao nullifier trở thành VÔ HẠI thay vì     │
// │ phải bị cấm. Rẻ hơn và chắc hơn một cổng không thể dựng.                    │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// asset name = blake2b_256(did_commit ‖ proposal_id).
//
// MintNullifier — bốn cổng, ghép AND:
//   1. hình dạng mint: đúng 1 tên token của policy này, qty +1, và tx KHÔNG đúc
//      policy nào khác (chống đính kèm một lượt đúc lạ vào cùng chữ ký).
//   2. tên = blake2b_256(did_commit ‖ proposal_id) — policy tự dựng, không tin tên
//      do bên dựng tx mớm.
//   3. cửa sổ bỏ phiếu: `vote_open_epoch ≤ e < vote_close_epoch`, đọc từ datum của
//      Tally UTxO tìm qua REFERENCE INPUT theo token `(tally_policy, proposal_id)`.
//   4. WHO: đúng MỘT reference input ở `Script(taad_policy)` mang
//      `(taad_policy, did_commit)`; anchor `Active`, `entity_type = Person`,
//      `parent_did = None`, `depth = 0`; giao dịch có chữ ký `controller_pkh` VÀ
//      một thiết bị đã uỷ quyền. Cổng A-PERSON nằm ở `anchor_view`.
//
// BurnNullifier — HAI đường, cả hai đều ở NGOÀI cửa sổ bỏ phiếu:
//   (a) gom phiếu: Tally của proposal bị TIÊU cùng tx và `e ≥ vote_close_epoch`;
//   (b) thu hồi phiếu chết: Tally đã quá `vote_close + tally_window` (đọc qua
//       reference input, vì sau khi đóng sổ Tally không tiêu được nữa).
// Cả hai đòi `e ≥ vote_close_epoch`, còn `MintNullifier` đòi `e < vote_close_epoch`
// ⇒ hai cửa sổ RỜI NHAU theo số học ⇒ đốt-rồi-đúc-lại trong cửa sổ là bất khả.
// Đây là vế vá lỗi 4 của `Governance/SPEC.md` §v2.1.
//
// Tham số hoá: tally_policy, taad_policy, ms_per_epoch, tally_window_epochs.

use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/interval.{Interval}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, Output, Transaction, placeholder}
use magiclamp/governance/anchor_view
use magiclamp/governance/tally_ref
use magiclamp/governance/types.{Summing, TallyDatum}
use magiclamp/governance/util

pub type NullifierRedeemer {
  MintNullifier { did_commit: ByteArray, proposal_id: ByteArray }
  BurnNullifier
}

/// name nullifier canonical = blake2b_256(did_commit ‖ proposal_id).
pub fn nullifier_name(
  did_commit: ByteArray,
  proposal_id: ByteArray,
) -> ByteArray {
  crypto.blake2b_256(bytearray.concat(did_commit, proposal_id))
}

/// (a) Tally BỊ TIÊU cùng tx và cửa sổ bỏ phiếu đã đóng.
fn burn_with_tally_spent(tx: Transaction, tally_policy: PolicyId, e: Int) -> Bool {
  when tally_ref.find_tally_any(tx.inputs, tally_policy) is {
    Some(td) -> e >= td.vote_close_epoch
    None -> False
  }
}

/// (b) Tally đã quá cửa sổ gom — đọc qua REFERENCE input. Sau `Finalize` Tally
/// không còn nhánh nào tiêu được nó, nên vế (a) không dùng được ở đây.
fn burn_after_tally_window(
  tx: Transaction,
  tally_policy: PolicyId,
  e: Int,
  tally_window_epochs: Int,
) -> Bool {
  when tally_ref.find_tally_any(tx.reference_inputs, tally_policy) is {
    Some(td) -> e >= td.vote_close_epoch + tally_window_epochs
    None -> False
  }
}

validator nullifier(
  tally_policy: PolicyId,
  taad_policy: PolicyId,
  ms_per_epoch: Int,
  tally_window_epochs: Int,
) {
  mint(redeemer: NullifierRedeemer, policy_id: PolicyId, tx: Transaction) {
    let own_tokens = assets.tokens(tx.mint, policy_id)
    when redeemer is {
      MintNullifier { did_commit, proposal_id } -> {
        // 1 + 2. hình dạng mint + tên canonical.
        let want_name = nullifier_name(did_commit, proposal_id)
        expect dict.size(own_tokens) == 1
        expect assets.quantity_of(tx.mint, policy_id, want_name) == 1
        expect list.length(assets.policies(tx.mint)) == 1
        // 3. cửa sổ bỏ phiếu đọc từ Tally UTxO (reference input, theo token).
        let td =
          tally_ref.expect_tally(tx.reference_inputs, tally_policy, proposal_id)
        let e = util.get_epoch_bounded(tx, ms_per_epoch)
        expect td.vote_open_epoch <= e
        expect e < td.vote_close_epoch
        // 4. WHO — A-PERSON + hai chữ ký chính chủ.
        anchor_view.person_owner_signed_ref(
          tx.reference_inputs,
          taad_policy,
          did_commit,
          tx.extra_signatories,
        )
      }
      BurnNullifier -> {
        // đốt THUẦN: mọi tên token của policy này trong `tx.mint` đều qty −1.
        expect list.all(dict.to_pairs(own_tokens), fn(p) { p.2nd == -1 })
        let e = util.get_epoch_bounded(tx, ms_per_epoch)
        or {
          burn_with_tally_spent(tx, tally_policy, e),
          burn_after_tally_window(tx, tally_policy, e, tally_window_epochs),
        }
      }
    }
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

const nl_policy: PolicyId = #"7777"

const tally_policy: PolicyId = #"7a11"

const taad_policy: PolicyId = #"7aad"

const tally_sh: ByteArray = #"7a"

const ms_ep: Int = 86_400_000

const window: Int = 3

const open_e: Int = 10

const close_e: Int = 20

const did: ByteArray = #"11"

const prop: ByteArray = #"abcd"

/// Hai khoá chính chủ của anchor dựng bởi `anchor_datum` (khớp `#"c1"`/`#"d1"`).
const ctrl: ByteArray = #"c1"

const dev: ByteArray = #"d1"

fn name_of(d: ByteArray, p: ByteArray) -> ByteArray {
  nullifier_name(d, p)
}

fn tally_datum() -> TallyDatum {
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
    voted_root: #"0000000000000000000000000000000000000000000000000000000000000000",
  }
}

fn tally_utxo(name: ByteArray) -> Output {
  let val = assets.from_lovelace(2_000_000) |> assets.add(tally_policy, name, 1)
  util.mk_output(util.script_address(tally_sh), val, tally_datum())
}

fn tally_ref_input() -> Input {
  util.mk_input(util.mk_ref(0), tally_utxo(prop))
}

fn tally_spent_input() -> Input {
  util.mk_input(util.mk_ref(0), tally_utxo(prop))
}

/// Datum anchor TAAD 18 trường — Person gốc, Active, controller `c1`, device `d1`.
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

fn anchor_input_at(pay: ByteArray, name: ByteArray, d: Data) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(taad_policy, name, 1)
  util.mk_input(util.mk_ref(1), util.mk_output(util.script_address(pay), val, d))
}

fn anchor_person() -> Input {
  anchor_input_at(taad_policy, did, anchor_datum(0, False, 0))
}

/// validity_range bị chặn hai đầu, cả hai biên trong epoch `e`.
fn at_epoch(e: Int) -> Interval {
  interval.between(e * ms_ep, e * ms_ep + 1000)
}

fn mint_tx(
  e: Int,
  refs: List<Input>,
  sigs: List<ByteArray>,
  mint: Value,
) -> Transaction {
  Transaction {
    ..placeholder,
    reference_inputs: refs,
    extra_signatories: sigs,
    mint,
    validity_range: at_epoch(e),
  }
}

fn one_nl(qty: Int) -> Value {
  assets.zero |> assets.add(nl_policy, name_of(did, prop), qty)
}

fn run_mint(tx: Transaction) -> Bool {
  nullifier.mint(
    tally_policy,
    taad_policy,
    ms_ep,
    window,
    MintNullifier { did_commit: did, proposal_id: prop },
    nl_policy,
    tx,
  )
}

fn run_burn(tx: Transaction) -> Bool {
  nullifier.mint(
    tally_policy,
    taad_policy,
    ms_ep,
    window,
    BurnNullifier,
    nl_policy,
    tx,
  )
}

// ── Dương ──

test nl_mint_happy() {
  run_mint(
    mint_tx(
      15,
      [tally_ref_input(), anchor_person()],
      [ctrl, dev],
      one_nl(1),
    ),
  )
}

test nl_mint_bien_duoi_cua_so() {
  // `e == vote_open_epoch` PHẢI qua (dấu ≤).
  run_mint(
    mint_tx(open_e, [tally_ref_input(), anchor_person()], [ctrl, dev], one_nl(1)),
  )
}

// ── Âm: mỗi ca giữ NGUYÊN mọi vế khác, lật ĐÚNG một vế ──

/// Giữ ref tally, bỏ ĐÚNG anchor ⇒ đỏ ở cổng WHO, không phải ở cổng tally-ref.
test nl_mint_khong_anchor_tu_choi() fail {
  expect run_mint(mint_tx(15, [tally_ref_input()], [ctrl, dev], one_nl(1)))
  True
}

/// Giữ anchor + hai chữ ký, bỏ ĐÚNG ref tally ⇒ đỏ ở cổng cửa sổ.
test nl_mint_khong_ref_tally_tu_choi() fail {
  expect run_mint(mint_tx(15, [anchor_person()], [ctrl, dev], one_nl(1)))
  True
}

/// Đủ anchor + đủ ref tally, thiếu ĐÚNG chữ ký thiết bị.
test nl_mint_thieu_chu_ky_thiet_bi_tu_choi() fail {
  expect run_mint(
    mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl], one_nl(1)),
  )
  True
}

/// Đủ anchor + đủ ref tally, thiếu ĐÚNG chữ ký controller.
test nl_mint_thieu_chu_ky_controller_tu_choi() fail {
  expect run_mint(
    mint_tx(15, [tally_ref_input(), anchor_person()], [dev], one_nl(1)),
  )
  True
}

/// Đủ mọi thứ, chỉ `e` ra ngoài cửa sổ (`e == vote_close_epoch`, dấu <).
test nl_mint_dung_bien_dong_tu_choi() fail {
  expect run_mint(
    mint_tx(close_e, [tally_ref_input(), anchor_person()], [ctrl, dev], one_nl(1)),
  )
  True
}

/// Đủ mọi thứ, `e` TRƯỚC khi mở phiếu.
test nl_mint_truoc_khi_mo_tu_choi() fail {
  expect run_mint(
    mint_tx(
      open_e - 1,
      [tally_ref_input(), anchor_person()],
      [ctrl, dev],
      one_nl(1),
    ),
  )
  True
}

/// A-PERSON: anchor là DID con `Bot` — đủ hai chữ ký, đủ ref tally, đúng cửa sổ.
/// Ca này KHÁC `nl_mint_happy` đúng một ô của datum anchor.
test nl_mint_did_con_bot_tu_choi() fail {
  let a = anchor_input_at(taad_policy, did, anchor_datum(5, False, 0))
  expect run_mint(mint_tx(15, [tally_ref_input(), a], [ctrl, dev], one_nl(1)))
  True
}

/// A-PERSON: Person nhưng `parent_did = Some(...)`.
test nl_mint_person_co_cha_tu_choi() fail {
  let a = anchor_input_at(taad_policy, did, anchor_datum(0, True, 0))
  expect run_mint(mint_tx(15, [tally_ref_input(), a], [ctrl, dev], one_nl(1)))
  True
}

/// A-PERSON: `depth = 1`.
test nl_mint_depth_khac_khong_tu_choi() fail {
  let a = anchor_input_at(taad_policy, did, anchor_datum(0, False, 1))
  expect run_mint(mint_tx(15, [tally_ref_input(), a], [ctrl, dev], one_nl(1)))
  True
}

/// Anchor mang đúng NFT nhưng nằm NGOÀI `Script(taad_policy)`.
test nl_mint_anchor_ngoai_script_taad_tu_choi() fail {
  let a = anchor_input_at(#"bbbb", did, anchor_datum(0, False, 0))
  expect run_mint(mint_tx(15, [tally_ref_input(), a], [ctrl, dev], one_nl(1)))
  True
}

/// Tên token không khớp `H(did‖prop)`.
test nl_mint_ten_sai_tu_choi() fail {
  let bad = assets.zero |> assets.add(nl_policy, #"deadbeef", 1)
  expect run_mint(
    mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], bad),
  )
  True
}

/// Đúc 2 đơn vị cùng tên: qty ≠ 1.
test nl_mint_hai_don_vi_tu_choi() fail {
  expect run_mint(
    mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], one_nl(2)),
  )
  True
}

/// Đính kèm một policy LẠ vào cùng lượt đúc.
test nl_mint_kem_policy_la_tu_choi() fail {
  let m = one_nl(1) |> assets.add(#"9999", #"01", 1)
  expect run_mint(mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], m))
  True
}

/// Biên validity_range mở một đầu ⇒ `get_epoch_bounded` từ chối.
test nl_mint_bien_mo_tu_choi() fail {
  let tx =
    Transaction {
      ..placeholder,
      reference_inputs: [tally_ref_input(), anchor_person()],
      extra_signatories: [ctrl, dev],
      mint: one_nl(1),
      validity_range: interval.after(15 * ms_ep),
    }
  expect run_mint(tx)
  True
}

/// Hai biên rơi vào HAI epoch khác nhau ⇒ từ chối (khuôn hai-đầu).
test nl_mint_hai_bien_khac_epoch_tu_choi() fail {
  let tx =
    Transaction {
      ..placeholder,
      reference_inputs: [tally_ref_input(), anchor_person()],
      extra_signatories: [ctrl, dev],
      mint: one_nl(1),
      validity_range: interval.between(15 * ms_ep, 16 * ms_ep + 10),
    }
  expect run_mint(tx)
  True
}

// ── BurnNullifier ──

fn burn_tx(e: Int, inputs: List<Input>, refs: List<Input>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: inputs,
    reference_inputs: refs,
    mint: one_nl(-1),
    validity_range: at_epoch(e),
  }
}

test nl_burn_gom_phieu_happy() {
  run_burn(burn_tx(close_e, [tally_spent_input()], []))
}

/// Đốt trong khi cửa sổ bỏ phiếu CÒN MỞ — có tally bị tiêu, datum đọc được, chỉ
/// `e` là thấp. Đây là vế vá lỗi 4 (`SPEC.md` §v2.1).
test nl_burn_trong_cua_so_tu_choi() fail {
  expect run_burn(burn_tx(close_e - 1, [tally_spent_input()], []))
  True
}

/// Không tally bị tiêu và không tally tham chiếu ⇒ cả hai đường đều tắt.
test nl_burn_khong_tally_tu_choi() fail {
  expect run_burn(burn_tx(close_e + 99, [], []))
  True
}

/// Đường (b): tally đã quá `close + window`, đọc qua REFERENCE input.
test nl_burn_sau_cua_so_gom_happy() {
  run_burn(burn_tx(close_e + window, [], [tally_ref_input()]))
}

/// Đường (b) chưa tới hạn: `e == close + window − 1`.
test nl_burn_truoc_han_thu_hoi_tu_choi() fail {
  expect run_burn(burn_tx(close_e + window - 1, [], [tally_ref_input()]))
  True
}

/// Lén đúc một token mới trong lượt đốt.
test nl_burn_len_duc_tu_choi() fail {
  let m = one_nl(-1) |> assets.add(nl_policy, #"abcd", 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_spent_input()],
      mint: m,
      validity_range: at_epoch(close_e),
    }
  expect run_burn(tx)
  True
}
