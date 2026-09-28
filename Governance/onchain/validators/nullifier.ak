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
// MintNullifier — năm cổng, ghép AND:
//   0. ĐỘ DÀI hai tiền ảnh: `did_commit` và `proposal_id` mỗi cái ĐÚNG 32 byte.
//      Không có vế này thì `blake2b_256(did_commit ‖ proposal_id)` KHÔNG đơn ánh theo
//      cặp: `(#"aa", #"bb")` và `(#"aabb", #"")` băm ra cùng một tên token, nên hai
//      cặp khác nhau tranh CÙNG một nullifier. Hai giá trị này đều là băm 32 byte
//      theo §v2.5 (`did_commit = blake2b_256(UTF8(did))`, `proposal_id = H(seed)`),
//      nên vế này không cắt đường trung thực nào — nó chỉ biến một tính chất của
//      cách sinh dữ liệu thành một cổng, và SDK off-chain đã đòi đúng 32 byte ở
//      `datum.ts` ▸ `HASH32_BYTES`.
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
// BurnNullifier { proposal_id, did_commits } — HAI đường, cả hai đều ở NGOÀI cửa
// sổ bỏ phiếu CỦA CHÍNH `proposal_id`:
//   (a) gom phiếu: Tally của `proposal_id` bị TIÊU cùng tx và `e ≥ vote_close_epoch`;
//   (b) thu hồi phiếu chết: Tally của `proposal_id` đã quá `vote_close +
//       tally_window` (đọc qua reference input, vì sau khi đóng sổ Tally không
//       tiêu được nữa).
//
// Hai vế BẮT BUỘC đi cùng nhau, và lý do phải viết ra vì nó là chỗ bản trước SAI:
//   • tên token bị đốt phải đúng bằng tập `{ H(d ‖ proposal_id) : d ∈ did_commits }`;
//   • căn cứ thời gian phải đọc từ Tally của ĐÚNG `proposal_id` đó.
// Bản trước lấy căn cứ từ "một tally BẤT KỲ" (`find_tally_any`) rồi kết luận hai
// cửa sổ rời nhau. Kết luận đó SAI: `tally_policy` là one-shot theo PHA, nên mọi
// proposal của pha dùng chung policy — một tally CŨ đã quá hạn thoả `e ≥
// vote_close` cho MỌI `e`, kể cả `e` nằm giữa cửa sổ bỏ phiếu của proposal đang bị
// đốt nullifier. Ca `nl_burn_muon_tally_proposal_khac_ref_tu_choi` và
// `nl_burn_muon_tally_proposal_khac_tieu_tu_choi` giữ chỗ đó.
//
// Với hai vế trên thì tính rời nhau mới là SỐ HỌC: `MintNullifier` đòi `e <
// vote_close_epoch` đọc từ Tally của `proposal_id`, `BurnNullifier` đòi `e ≥
// vote_close_epoch` đọc từ Tally của CÙNG `proposal_id`, và `e` là MỘT số (khuôn
// hai đầu `util.get_epoch_bounded`) ⇒ đốt-rồi-đúc-lại trong cửa sổ là bất khả.
// Đây là vế vá lỗi 4 của `Governance/SPEC.md` §v2.1.
//
// Tham số hoá: tally_policy, taad_policy, ms_per_epoch, tally_window_epochs.

use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Interval}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, Output, Transaction, placeholder}
use magiclamp/governance/anchor_view
use magiclamp/governance/names.{nullifier_name}
use magiclamp/governance/tally_ref
use magiclamp/governance/types.{Summing, TallyDatum}
use magiclamp/governance/util

pub type NullifierRedeemer {
  MintNullifier { did_commit: ByteArray, proposal_id: ByteArray }
  /// `did_commits` — danh sách chủ phiếu của các nullifier bị đốt trong lượt này.
  /// Nó KHÔNG phải dữ liệu được tin: policy tự dựng lại tên token từ nó và so
  /// bằng đẳng thức, nên khai sai thì đẳng thức bác.
  BurnNullifier { proposal_id: ByteArray, did_commits: List<ByteArray> }
}

/// (a) Tally của ĐÚNG `proposal_id` bị TIÊU cùng tx và cửa sổ bỏ phiếu đã đóng.
fn burn_with_tally_spent(
  tx: Transaction,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
  e: Int,
) -> Bool {
  when tally_ref.find_tally(tx.inputs, tally_policy, proposal_id) is {
    Some(td) -> e >= td.vote_close_epoch
    None -> False
  }
}

/// (b) Tally của ĐÚNG `proposal_id` đã quá cửa sổ gom — đọc qua REFERENCE input.
/// Sau `Finalize` Tally không còn nhánh nào tiêu được nó, nên vế (a) không dùng
/// được ở đây.
fn burn_after_tally_window(
  tx: Transaction,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
  e: Int,
  tally_window_epochs: Int,
) -> Bool {
  when tally_ref.find_tally(tx.reference_inputs, tally_policy, proposal_id) is {
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
        // 0. ĐỘ DÀI hai tiền ảnh — điều kiện để `H(a ‖ b)` đơn ánh theo cặp `(a, b)`.
        expect bytearray.length(did_commit) == 32
        expect bytearray.length(proposal_id) == 32
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
      BurnNullifier { proposal_id, did_commits } -> {
        // (B1) tập tên token bị đốt PHẢI ĐÚNG BẰNG `{ H(d ‖ proposal_id) }`.
        //      Một phép so đẳng thức trên dict ép cùng lúc năm thứ, nên không tách
        //      ra thành năm vế rời: đốt THUẦN (mọi qty = −1), đủ tên, KHÔNG thừa
        //      tên lạ, không thừa tên của proposal khác, và `did_commits` không có
        //      phần tử trùng (trùng thì `assets.add` gộp thành −2 và đẳng thức bác).
        let want =
          list.foldr(
            did_commits,
            assets.zero,
            fn(d, acc) {
              assets.add(acc, policy_id, nullifier_name(d, proposal_id), -1)
            },
          )
        expect own_tokens == assets.tokens(want, policy_id)
        // (B2) căn cứ thời gian đọc từ Tally của ĐÚNG `proposal_id` trên — không
        //      phải "một tally bất kỳ". Đây là vế làm hai cửa sổ thật sự rời nhau.
        let e = util.get_epoch_bounded(tx, ms_per_epoch)
        or {
          burn_with_tally_spent(tx, tally_policy, proposal_id, e),
          burn_after_tally_window(
            tx,
            tally_policy,
            proposal_id,
            e,
            tally_window_epochs,
          ),
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

/// `did_commit` và `proposal_id` là băm 32 byte trên chuỗi thật (§v2.5:
/// `did_commit = blake2b_256(UTF8(did))`, `proposal_id = H(seed)`), và cổng 0 của
/// `MintNullifier` ép đúng độ dài đó. Fixture phải dùng ĐỘ DÀI THẬT — không thì mọi
/// ca dương ở đây đỏ ở cổng 0 thay vì ở chốt mang tên chúng.
const did: ByteArray =
  #"1111111111111111111111111111111111111111111111111111111111111111"

const prop: ByteArray =
  #"abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd"

/// 31 byte — `did` cắt đúng một byte cuối.
const did_31: ByteArray =
  #"11111111111111111111111111111111111111111111111111111111111111"

/// 31 byte — `prop` cắt đúng một byte cuối.
const prop_31: ByteArray =
  #"abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdab"

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

/// Proposal CŨ dùng làm căn cứ giả trong các ca tấn công: cùng `tally_policy`
/// (policy one-shot theo pha, mỗi proposal một TÊN token), cửa sổ đã đóng từ lâu.
const prop_q: ByteArray = #"beef"

const close_q: Int = 5

fn tally_datum_of(p: ByteArray, o: Int, c: Int) -> TallyDatum {
  TallyDatum {
    ..tally_datum(),
    proposal_id: p,
    vote_open_epoch: o,
    vote_close_epoch: c,
  }
}

fn tally_utxo_of(td: TallyDatum) -> Output {
  let val =
    assets.from_lovelace(2_000_000)
      |> assets.add(tally_policy, td.proposal_id, 1)
  util.mk_output(util.script_address(tally_sh), val, td)
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

/// Tally của proposal CŨ `prop_q` — đã quá `close_q + window` từ lâu.
fn tally_q_input() -> Input {
  util.mk_input(
    util.mk_ref(9),
    tally_utxo_of(tally_datum_of(prop_q, 0, close_q)),
  )
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
  util.mk_input(
    util.mk_ref(1),
    util.mk_output(util.script_address(pay), val, d),
  )
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

fn run_mint_of(d: ByteArray, p: ByteArray, tx: Transaction) -> Bool {
  nullifier.mint(
    tally_policy,
    taad_policy,
    ms_ep,
    window,
    MintNullifier { did_commit: d, proposal_id: p },
    nl_policy,
    tx,
  )
}

fn run_mint(tx: Transaction) -> Bool {
  run_mint_of(did, prop, tx)
}

/// Đốt nullifier của `did` thuộc proposal `p`, khai `did_commits = [did]`.
fn run_burn_of(p: ByteArray, dids: List<ByteArray>, tx: Transaction) -> Bool {
  nullifier.mint(
    tally_policy,
    taad_policy,
    ms_ep,
    window,
    BurnNullifier { proposal_id: p, did_commits: dids },
    nl_policy,
    tx,
  )
}

fn run_burn(tx: Transaction) -> Bool {
  run_burn_of(prop, [did], tx)
}

// ── Dương ──

test nl_mint_happy() {
  run_mint(
    mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], one_nl(1)),
  )
}

test nl_mint_bien_duoi_cua_so() {
  // `e == vote_open_epoch` PHẢI qua (dấu ≤).
  run_mint(
    mint_tx(
      open_e,
      [tally_ref_input(), anchor_person()],
      [ctrl, dev],
      one_nl(1),
    ),
  )
}

// ── Âm: mỗi ca giữ NGUYÊN mọi vế khác, lật ĐÚNG một vế ──

// ── Cổng 0: độ dài hai tiền ảnh của `H(did_commit ‖ proposal_id)` ──

fn one_nl_of(d: ByteArray, p: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(nl_policy, name_of(d, p), qty)
}

/// Tally ref của một `proposal_id` tuỳ ý, cửa sổ `[open_e, close_e)` như bản dương.
/// `tally_utxo_of` đặt TÊN token bằng `td.proposal_id`, và `find_tally` còn đòi datum
/// khai đúng tên đó — nên hai thứ phải đi cùng nhau.
fn tally_ref_of(p: ByteArray) -> Input {
  util.mk_input(
    util.mk_ref(0),
    tally_utxo_of(tally_datum_of(p, open_e, close_e)),
  )
}

/// `did_commit` 31 byte. Mọi vế khác dựng ĐÚNG theo giá trị đó — anchor mang
/// `(taad_policy, did_31)`, token đúc tên `H(did_31 ‖ prop)` qty 1, đủ hai chữ ký,
/// đúng cửa sổ — nên gỡ cổng 0 thì ca này XANH, tức nó ghim đúng cổng 0.
test nl_mint_did_commit_31_byte_tu_choi() fail {
  let a = anchor_input_at(taad_policy, did_31, anchor_datum(0, False, 0))
  expect
    run_mint_of(
      did_31,
      prop,
      mint_tx(
        15,
        [tally_ref_input(), a],
        [ctrl, dev],
        one_nl_of(did_31, prop, 1),
      ),
    )
  True
}

/// `proposal_id` 31 byte. Tally ref dựng theo ĐÚNG `prop_31` (token + datum), token
/// đúc tên `H(did ‖ prop_31)` qty 1 ⇒ chỉ cổng 0 còn bác.
test nl_mint_proposal_id_31_byte_tu_choi() fail {
  expect
    run_mint_of(
      did,
      prop_31,
      mint_tx(
        15,
        [tally_ref_of(prop_31), anchor_person()],
        [ctrl, dev],
        one_nl_of(did, prop_31, 1),
      ),
    )
  True
}

/// Đối chứng DƯƠNG cho hai ca trên: cùng khuôn giao dịch, chỉ đổi độ dài về 32 byte
/// (ở đây là `prop` thật thay `prop_31`) ⇒ qua. Không có ca này thì hai ca trên
/// không phân biệt được "đỏ vì độ dài" với "khuôn `tally_ref_of` dựng sai".
test nl_mint_qua_voi_tally_ref_dung_khuon() {
  run_mint_of(
    did,
    prop,
    mint_tx(
      15,
      [tally_ref_of(prop), anchor_person()],
      [ctrl, dev],
      one_nl_of(did, prop, 1),
    ),
  )
}

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
  expect
    run_mint(
      mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl], one_nl(1)),
    )
  True
}

/// Đủ anchor + đủ ref tally, thiếu ĐÚNG chữ ký controller.
test nl_mint_thieu_chu_ky_controller_tu_choi() fail {
  expect
    run_mint(
      mint_tx(15, [tally_ref_input(), anchor_person()], [dev], one_nl(1)),
    )
  True
}

/// Đủ mọi thứ, chỉ `e` ra ngoài cửa sổ (`e == vote_close_epoch`, dấu <).
test nl_mint_dung_bien_dong_tu_choi() fail {
  expect
    run_mint(
      mint_tx(
        close_e,
        [tally_ref_input(), anchor_person()],
        [ctrl, dev],
        one_nl(1),
      ),
    )
  True
}

/// Đủ mọi thứ, `e` TRƯỚC khi mở phiếu.
test nl_mint_truoc_khi_mo_tu_choi() fail {
  expect
    run_mint(
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
  expect
    run_mint(
      mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], bad),
    )
  True
}

/// Đúc 2 đơn vị cùng tên: qty ≠ 1.
test nl_mint_hai_don_vi_tu_choi() fail {
  expect
    run_mint(
      mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], one_nl(2)),
    )
  True
}

/// Đính kèm một policy LẠ vào cùng lượt đúc.
test nl_mint_kem_policy_la_tu_choi() fail {
  let m = one_nl(1) |> assets.add(#"9999", #"01", 1)
  expect
    run_mint(mint_tx(15, [tally_ref_input(), anchor_person()], [ctrl, dev], m))
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
    inputs,
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

// ── Căn cứ đốt phải là tally của ĐÚNG proposal đang bị đốt nullifier ──
//
// Hai ca dưới đây là kịch bản phá cụ thể: epoch 15 nằm TRONG cửa sổ bỏ phiếu của
// `prop` ([10, 20)), nhưng tally của `prop_q` đã quá hạn từ lâu (`close_q = 5`).
// Nếu căn cứ đốt lấy từ "một tally BẤT KỲ" thì đốt nullifier của `prop` đi lọt
// ngay giữa cửa sổ bỏ phiếu của chính `prop` — đúng thứ chú thích đầu tệp khẳng
// định là bất khả.

/// Đường (b) — tally của proposal KHÁC làm reference input.
test nl_burn_muon_tally_proposal_khac_ref_tu_choi() fail {
  expect run_burn(burn_tx(15, [], [tally_q_input()]))
  True
}

/// Đường (a) — tally của proposal KHÁC bị TIÊU cùng tx (ví dụ một lượt `Finalize`
/// của `prop_q`: nhánh đó không ràng buộc `tx.mint` chút nào).
test nl_burn_muon_tally_proposal_khac_tieu_tu_choi() fail {
  expect run_burn(burn_tx(15, [tally_q_input()], []))
  True
}

// ── Chốt (B1): tập tên bị đốt = tập dựng lại từ `did_commits` ──

/// `did_commits` khai một DID KHÁC với DID của token bị đốt.
test nl_burn_khai_did_khac_tu_choi() fail {
  expect run_burn_of(prop, [#"99"], burn_tx(close_e, [tally_spent_input()], []))
  True
}

/// `did_commits` rỗng ⇒ tập dựng lại rỗng, không khớp một tên bị đốt.
test nl_burn_khai_rong_tu_choi() fail {
  expect run_burn_of(prop, [], burn_tx(close_e, [tally_spent_input()], []))
  True
}

/// `did_commits` có PHẦN TỬ TRÙNG: hai lần cùng `did` ⇒ `assets.add` gộp thành −2,
/// đẳng thức bác. Không có vế này thì một lượt đốt k token khai được 2k chủ phiếu.
test nl_burn_did_trung_trong_lo_tu_choi() fail {
  expect
    run_burn_of(prop, [did, did], burn_tx(close_e, [tally_spent_input()], []))
  True
}

/// Đốt kèm một tên token LẠ của cùng policy (không dựng được từ `did_commits` nào).
test nl_burn_them_ten_la_tu_choi() fail {
  let m = one_nl(-1) |> assets.add(nl_policy, #"cafe", -1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_spent_input()],
      mint: m,
      validity_range: at_epoch(close_e),
    }
  expect run_burn_of(prop, [did], tx)
  True
}

// ── Lô nhiều DID — hình dạng của một lượt `SumBatch` thật ──

const lo_dids: List<ByteArray> =
  [
    #"01", #"02", #"03", #"04", #"05", #"06", #"07", #"08", #"09", #"0a", #"0b",
    #"0c", #"0d", #"0e", #"0f", #"10", #"11", #"12", #"13", #"14",
  ]

fn burn_lo(dids: List<ByteArray>) -> Value {
  list.foldr(
    dids,
    assets.zero,
    fn(d, acc) { assets.add(acc, nl_policy, name_of(d, prop), -1) },
  )
}

fn burn_lo_tx(dids: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [tally_spent_input()],
    mint: burn_lo(dids),
    validity_range: at_epoch(close_e),
  }
}

/// Lô 20 phiếu — cỡ lô `SumBatch` lớn nhất mà `bft_floor = 21` sinh ra ở nhánh
/// heap. Ca này là phép ĐO ExUnit của chốt (B1), không phải một ca bảo mật.
test nl_burn_lo_hai_muoi_did_happy() {
  run_burn_of(prop, lo_dids, burn_lo_tx(lo_dids))
}

/// Thiếu ĐÚNG một DID trong khai báo khi lô đốt 20 tên.
test nl_burn_lo_thieu_mot_did_tu_choi() fail {
  expect
    run_burn_of(
      prop,
      list.filter(lo_dids, fn(d) { d != #"14" }),
      burn_lo_tx(lo_dids),
    )
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
