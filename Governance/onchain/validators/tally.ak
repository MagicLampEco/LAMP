// Validator 3 — Tally accumulator v2 (Summing → Clamped).
//
// Một Tally UTxO / proposal, mang Tally NFT `(tally_policy, proposal_id)`.
//
// ┌─ ĐỔI BẢN CHẤT so với v1 ────────────────────────────────────────────────────┐
// │ 1. SỔ DID. `TallyDatum.voted_root` là gốc một cây MPF: khoá = `did_commit`,  │
// │    giá trị = `nullifier` của phiếu ĐƯỢC CỘNG. Đây là chỗ one-shot THẬT của   │
// │    "một DID đếm tối đa một lần" — token nullifier không làm được việc đó.    │
// │    `mpf.insert` tự `fail` khi khoá đã có trong cây, nên trùng TRONG lô và    │
// │    trùng với sổ cũ bị bác bằng CẤU TRÚC, không bằng một phép so thêm.        │
// │    Giá trị là `nullifier` cụ thể ⇒ một DID đúc đôi rồi để người dựng lô chọn │
// │    phiếu nào ĐƯỢC ĐẾM thì lựa chọn đó hiện ra trên chuỗi, truy được.        │
// │ 2. CHỐT THỜI GIAN ở cả hai nhánh. `SumBatch` trong `[close, close+window)`,  │
// │    `Finalize` từ `close+window`. v1 KHÔNG có chốt nào — một giao dịch đóng   │
// │    sổ sớm cộng với việc tiêu k phiếu của phe chống là đủ lật mọi proposal.   │
// │ 3. GHIM ba trường mới ở `Finalize`. Thiếu vế ghim `voted_root` thì chính     │
// │    `Finalize` vô hiệu hoá được lớp (V5) của `vote`.                         │
// │ 4. NGUỒN c*. `c2/c4` bị ép == 0 (chưa có policy nguồn nào chứng thực),       │
// │    `c3` phải có NFT chứng thực tên = `did_commit` làm reference input, `c1`   │
// │    phải ≤ tổng `consumed_nanogic` trên thread Engage của DID đó (engage.ak).  │
// │    Cap kiểm LẠI ở đây, không tin datum phiếu.                               │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Tham số hoá:
//   tally_policy        : NFT bảo toàn acc; tên token = proposal_id.
//   vote_script_hash    : nguồn Vote UTxO hợp lệ duy nhất.
//   nullifier_policy    : Tally ép đốt nullifier mỗi phiếu gộp.
//   weight_param_policy : authenticity token bảng WeightParam (ngưỡng + knots).
//   c3_policy           : policy NFT chứng thực C3 (uy tín). `#""` = pha chưa dùng
//                         C3 ⇒ ép `c3_capped == 0`.
//   c3_script_hash      : NƠI GIỮ NFT chứng thực C3. Chứng thực chỉ được đọc từ
//                         reference input tại `Script(c3_script_hash)`; token một
//                         mình KHÔNG đủ (xem `attested_c3`).
//   tally_window_epochs : độ dài cửa sổ gom.
//   ms_per_epoch        : quy đổi POSIX ms → epoch.
//   window_origin_ms    : gốc lưới cửa sổ.
//   engage_policies     : policy thread Engage (MAGIC) được công nhận cho C1. `[]` =
//                         pha chưa bật C1 ⇒ ép `c1_capped == 0`.

use aiken/collection/dict
use aiken/collection/list
use aiken/merkle_patricia_forestry as mpf
use aiken/merkle_patricia_forestry.{Proof}
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use magiclamp/governance/engage
use magiclamp/governance/names.{nullifier_name}
use magiclamp/governance/power.{cap_of}
use magiclamp/governance/tally.{
  batch_entries, clamp_consistent, sum_batch_consistent_entries,
  top_heap_consistent_entries,
} as tally_lib
use magiclamp/governance/types.{
  Clamped, Summing, TallyDatum, VoteDatum, WeightParam,
}
use magiclamp/governance/util
use magiclamp/governance/weight_ref.{
  read_weight_param, read_weight_param_skip_d8,
}

pub type TallyRedeemer {
  /// `insert_proofs` — một chứng minh CHÈN MPF cho MỖI phiếu trong lô, ĐÚNG THỨ TỰ
  /// của `collect_votes` (tức thứ tự input). Bên dựng lô sinh off-chain, mỗi
  /// chứng minh ứng với trạng thái sổ ngay TRƯỚC lần chèn đó.
  SumBatch { insert_proofs: List<Proof> }
  Finalize
}

/// cap4 cứng = 100 triệu LAMP (CONTRACT §3 — ngoại lệ "tham số mở").
pub const cap4_hard: Int = 100_000_000

/// Bảo toàn Tally acc UTxO: đúng 1 input + 1 output tại Tally script hash, output
/// mang đúng 1 NFT ĐÚNG TÊN, không đính reference script, và TOÀN BỘ value đi qua
/// nguyên vẹn.
fn utxo_preserved(
  own_hash: ByteArray,
  tally_policy: PolicyId,
  proposal_id: ByteArray,
  tx: Transaction,
) -> Bool {
  let n_in = util.count_inputs_at_script(tx.inputs, own_hash)
  let n_out = util.count_outputs_at_script(tx.outputs, own_hash)
  let in_out = util.input_at_script(tx.inputs, own_hash)
  let out = util.output_at_script(tx.outputs, own_hash)
  // `dict.size == 1` nói "đúng 1 TÊN tài sản", KHÔNG nói "đúng 1 token": số lượng
  // nằm ở giá trị của cặp, không ở số cặp.
  expect [Pair(_, qty)] = dict.to_pairs(assets.tokens(out.value, tally_policy))
  and {
    n_in == 1,
    n_out == 1,
    qty == 1,
    // TÊN token BUỘC vào datum: acc vào phải mang đúng `(tally_policy, proposal_id)`
    // của chính datum nó khai. Vế `qty == 1` ở trên đếm SỐ LƯỢNG của một tên tuỳ ý,
    // nên không có vế này thì một Tally UTxO mang NFT tên X mà datum khai
    // `proposal_id = Y` đi qua trọn vòng đời: `collect_votes` gom phiếu của Y, sổ MPF
    // ghi theo Y, còn mọi bên đọc ngoài (`tally_ref.find_tally`, `nullifier` cổng 3,
    // `vote` V4/V5) định danh tally đó theo TÊN TOKEN là X. Hai định danh trôi khỏi
    // nhau trong im lặng. Cộng với `[TALLY-TOKEN-OUTSIDE-OPEN]` (token tally đúc lẻ
    // không bị kiểm datum khởi tạo) thì hình dạng đó dựng được ngoài giao dịch Open.
    assets.quantity_of(in_out.value, tally_policy, proposal_id) == 1,
    // value NGUYÊN VẸN: giữ NFT thôi thì người tiêu giữ NFT + datum đúng rồi hút
    // hết ADA của acc ra ví mình, và không ràng buộc cũ nào kêu lên.
    out.value == in_out.value,
    // ĐỊA CHỈ ĐẦY ĐỦ (kể cả stake credential). `util.is_at_script` chỉ so
    // payment_credential — đúng cho việc ĐẾM, không đủ cho việc ÉP ĐÍCH.
    out.address == in_out.address,
    // KHÔNG đính reference script vào acc ra (`R-ADDR-PRESERVE` §v2.8). Một ô
    // reference script gắn vào UTxO acc làm min-ADA của acc phình theo kích thước
    // script gắn kèm — và acc là UTxO KHÔNG có nhánh nào thu hồi được
    // (`[PROPOSAL-CLOSE]`), nên khoản đó bị khoá vĩnh viễn, do người dựng giao dịch
    // chọn và người mở proposal trả. Hai nhánh spend còn lại của hệ
    // (`governance ▸ FinalizeProposal` S4, `vote ▸ RetractVote` R4) đã ép vế này;
    // tally là chỗ duy nhất còn thiếu (PoC 2 / 2b của báo cáo audit).
    out.reference_script == None,
  }
}

fn out_datum(own_hash: ByteArray, outputs: List<Output>) -> TallyDatum {
  let out = util.output_at_script(outputs, own_hash)
  expect InlineDatum(d) = out.datum
  expect td: TallyDatum = d
  td
}

/// Thu thập VoteDatum từ MỌI input tại `vote_script_hash`. Mỗi VoteDatum PHẢI khớp
/// `proposal_id` của Tally (không trộn phiếu của hai proposal trong một lô).
fn collect_votes(
  inputs: List<Input>,
  vote_script_hash: ByteArray,
  proposal_id: ByteArray,
) -> List<VoteDatum> {
  list.foldr(
    inputs,
    [],
    fn(i, acc) {
      if util.is_at_script(i.output.address, vote_script_hash) {
        expect InlineDatum(d) = i.output.datum
        expect vd: VoteDatum = d
        expect vd.proposal_id == proposal_id
        [vd, ..acc]
      } else {
        acc
      }
    },
  )
}

/// Mỗi phiếu gộp PHẢI có nullifier BỊ ĐỐT (qty −1) trong `tx.mint`, và số TÊN
/// token bị đốt PHẢI bằng số phiếu (không thừa, không thiếu).
fn nullifiers_burned(
  tx: Transaction,
  nullifier_policy: PolicyId,
  votes: List<VoteDatum>,
) -> Bool {
  let burned = assets.tokens(tx.mint, nullifier_policy)
  and {
    dict.size(burned) == list.length(votes),
    list.all(
      votes,
      fn(v) { assets.quantity_of(tx.mint, nullifier_policy, v.nullifier) == -1 },
    ),
  }
}

/// Giá trị C3 được CHỨNG THỰC cho một DID: đúng một reference input **tại
/// `Script(c3_script_hash)`** mang `(c3_policy, did_commit)` với datum inline là một
/// Int. Không tìm được ⟹ `-1`, và mọi `c3_capped >= 0` sẽ bác — fail-closed, không
/// im lặng cho qua.
///
/// **Vì sao vế địa chỉ là vế QUYẾT ĐỊNH, không phải vệ sinh** (PoC 4 của báo cáo
/// audit đi lọt đúng ở đây, theo mẫu `anchor_view ▸ find_anchor_view`): datum của một
/// UTxO do người TẠO ra UTxO đó viết, nên "một reference input mang token X" chỉ nói
/// token X có thật — nó không nói ai viết con số nằm cạnh token. Người giữ token đem
/// nó về ví thường rồi tự đặt giá trị chứng thực tuỳ ý; cổng cũ nhận. Ghim địa chỉ là
/// thứ dời quyền viết con số đó về một script mà bên phát hành C3 gác.
///
/// Hệ quả fail-closed phải nói rõ: `c3_policy != #""` mà `c3_script_hash == #""` thì
/// không địa chỉ thật nào khớp `Script(#"")` ⇒ mọi phiếu khai `c3_capped >= 0` bị bác
/// ⇒ nhánh `SumBatch` tự khoá. Đó là chiều hỏng ĐÚNG cho một cặp tham số khai lệch,
/// nên không thêm cổng riêng cho nó.
fn attested_c3(
  reference_inputs: List<Input>,
  c3_policy: PolicyId,
  c3_script_hash: ByteArray,
  did_commit: ByteArray,
) -> Int {
  when
    list.filter(
      reference_inputs,
      fn(i) {
        and {
          i.output.address.payment_credential == Script(c3_script_hash),
          assets.quantity_of(i.output.value, c3_policy, did_commit) == 1,
        }
      },
    )
  is {
    [a] ->
      when a.output.datum is {
        InlineDatum(d) ->
          if d is v: Int {
            v
          } else {
            -1
          }
        _ -> -1
      }
    _ -> -1
  }
}

/// Cổng NGUỒN của bốn đầu vào C1–C4 — ràng buộc TẠM, fail-closed.
///
/// Trước v2, `c*_capped` chỉ bị CAP, không bị chứng thực: một DID có anchor thật
/// khai được VP tối đa mà không nắm MAGIC/LAMP nào. Cap không phải chứng thực.
///
///   • C2, C4 — chưa có policy nguồn nào tồn tại ⇒ ép == 0. Với công thức
///     tích, một thừa số ở mốc đầu bảng kéo VP xuống mốc đầu, nên pha nào dựa vào
///     bốn yếu tố sẽ TỰ KHOÁ cho tới khi có nguồn. Đó là ý định: thà khoá còn hơn
///     đếm một con số không ai chứng thực.
///   • C3 — có nguồn: NFT chứng thực tên tài sản = `did_commit`, ĐẶT TẠI
///     `Script(c3_script_hash)`, giá trị trong datum. Đòi giá trị chứng thực ≥ giá
///     trị khai, và khai trong `[0, cap_3]`. `c3_policy == #""` = pha chưa bật C3 ⇒
///     ép == 0.
///   • C1 — có nguồn: thread Engage của MAGIC (`engage.ak`), policy thuộc
///     `engage_policies`, `did_commit` trong datum khớp BYTE với phiếu. Đòi
///     `0 ≤ c1_capped ≤ cap_1` VÀ tổng `consumed_nanogic` các thread đó `≥ c1_capped`.
///     `engage_policies == []` = pha chưa bật C1 ⇒ ép == 0.
///
///     Vì sao `≥` chứ không `==` như bản v1 (`CastVote`, ff4563a): ở v2 phép kiểm chạy
///     lúc GOM, không lúc bỏ phiếu. `consumed_nanogic` chỉ tăng, và thread bị tiêu-tạo
///     lại mỗi lần tiêu MAGIC ⇒ giữa hai thời điểm đó tổng trên chuỗi có thể đã lớn hơn
///     số khai. Với `==`, cử tri tiêu thêm MAGIC sau khi bỏ phiếu làm phiếu của chính họ
///     KHÔNG GOM ĐƯỢC NỮA. `≥` chặn đúng đường cần chặn (khai THỪA), cùng khuôn với C3.
///
///     ⚠ VẾ C1 KHÔNG ĐÓNG ĐƯỢC LỖ "thread tự đúc": cổng đúc thread của MAGIC ghim ĐỘ
///     DÀI `did_commit` chứ không ghim NỘI DUNG. Câu đúng mức khi báo cáo, đừng rút gọn:
///       "C1 đọc từ chuỗi thay cho C1 tự khai — chặn được khai thừa trên thread đã có,
///        KHÔNG chặn được thread tự đúc mang did_commit tự chọn."
///     Việc vá nằm ở repo MAGIC; CONTRACT §5 D9 vẫn cấm mô tả C1 là "chống-Sybil".
fn c_sources_ok(
  reference_inputs: List<Input>,
  c3_policy: PolicyId,
  c3_script_hash: ByteArray,
  engage_policies: List<PolicyId>,
  wp: WeightParam,
  votes: List<VoteDatum>,
) -> Bool {
  // `cap_of` duyệt trọn bảng knots. Nó KHÔNG phụ thuộc phiếu, nên tính một lần
  // ngoài vòng lặp thay vì k lần bên trong (bảng 8 mốc, k = 5: 55 000 mem).
  let cap3 = cap_of(wp.k3)
  // Pha chưa bật C1 thì KHÔNG tính bảng thread lẫn `cap_1` — đường nóng giữ nguyên chi phí.
  let c1_on = engage_policies != []
  let cap1 =
    if c1_on {
      cap_of(wp.k1)
    } else {
      0
    }
  let c1_credits =
    if c1_on {
      engage.thread_credits(reference_inputs, engage_policies)
    } else {
      []
    }
  list.all(
    votes,
    fn(v) {
      and {
        if c1_on {
          and {
            v.c1_capped >= 0,
            v.c1_capped <= cap1,
            engage.attested_c1(c1_credits, v.did_commit) >= v.c1_capped,
          }
        } else {
          v.c1_capped == 0
        },
        v.c2_capped == 0,
        v.c4_capped == 0,
        // cap4 cứng vẫn giữ trong mã như một chốt dự phòng cho lượt mở C4.
        v.c4_capped <= cap4_hard,
        if c3_policy == #"" {
          v.c3_capped == 0
        } else {
          and {
            v.c3_capped >= 0,
            v.c3_capped <= cap3,
            attested_c3(
              reference_inputs,
              c3_policy,
              c3_script_hash,
              v.did_commit,
            ) >= v.c3_capped,
          }
        },
      }
    },
  )
}

/// Gốc sổ SAU khi ghi trọn lô: chèn lần lượt `(did_commit → nullifier)` của từng
/// phiếu vào cây, mỗi lần một chứng minh. `mpf.insert` `fail` nếu chứng minh sai
/// HOẶC khoá đã tồn tại ⇒ không cần phép so trùng nào thêm.
fn book_root_after(
  root_in: ByteArray,
  votes: List<VoteDatum>,
  proofs: List<Proof>,
) -> ByteArray {
  expect list.length(proofs) == list.length(votes)
  let trie =
    list.foldl(
      list.zip(votes, proofs),
      mpf.from_root(root_in),
      fn(pair, acc) {
        let (v, proof) = pair
        mpf.insert(acc, v.did_commit, v.nullifier, proof)
      },
    )
  mpf.root(trie)
}

validator tally(
  tally_policy: PolicyId,
  vote_script_hash: ByteArray,
  nullifier_policy: PolicyId,
  weight_param_policy: PolicyId,
  c3_policy: PolicyId,
  c3_script_hash: ByteArray,
  tally_window_epochs: Int,
  ms_per_epoch: Int,
  // THÊM 2026-10-02 (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-3) — ĐẶT CUỐI theo khuôn các
  // tham số đã thêm trước. Gốc lưới cửa sổ: cửa sổ = (t − window_origin_ms) / ms_per_epoch,
  // nên chỉ số cửa sổ = số epoch Cardano của mạng. Đổi hash validator này.
  window_origin_ms: Int,
  // THÊM 2026-10-03 (bật C1, `Governance/SPEC.md` `[C1-C2-C4-SOURCE]`) — ĐẶT CUỐI theo khuôn
  // các tham số đã thêm trước. `[]` = pha chưa bật C1. Đổi hash validator này.
  engage_policies: List<PolicyId>,
) {
  spend(
    datum_opt: Option<TallyDatum>,
    redeemer: TallyRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d_in) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)
    let d_out = out_datum(own_hash, tx.outputs)
    let e = util.get_epoch_bounded(tx, ms_per_epoch, window_origin_ms)

    when redeemer is {
      // ── SumBatch: cộng một lô phiếu THẬT vào acc + ghi sổ DID ──
      SumBatch { insert_proofs } -> {
        expect d_in.phase == Summing
        // cửa sổ gom: TỪ khi đóng phiếu (rời cửa sổ rút) tới khi đóng sổ.
        expect e >= d_in.vote_close_epoch
        expect e < d_in.vote_close_epoch + tally_window_epochs
        // Cổng D8 KHÔNG chạy ở đường nóng — bảng đã qua cổng lúc ĐÚC và UTxO mang
        // nó không tiêu lại được, nên nó bất biến. Lập luận đầy đủ + số đo ở đầu
        // `lib/magiclamp/governance/weight_ref.ak`.
        let wp =
          read_weight_param_skip_d8(
            tx.reference_inputs,
            weight_param_policy,
            d_in.weight_param_ref,
          )
        let votes = collect_votes(tx.inputs, vote_script_hash, d_in.proposal_id)
        // PHẢI có ≥ 1 phiếu thật — chống lượt gộp rỗng làm no-op che giấu, và nhờ
        // đó số lượt gộp bị chặn trên bởi số DID bỏ phiếu (không spin vô hạn).
        expect list.length(votes) >= 1
        // (T1) token BUỘC vào datum: tên nullifier của mỗi phiếu = H(did‖prop).
        expect
          list.all(
            votes,
            fn(v) { v.nullifier == nullifier_name(v.did_commit, v.proposal_id) },
          )
        // (T1b) NGUỒN của c* — kiểm LẠI ở đây, không tin datum phiếu.
        expect
          c_sources_ok(
            tx.reference_inputs,
            c3_policy,
            c3_script_hash,
            engage_policies,
            wp,
            votes,
          )
        // (T2) SỔ DID: gốc ra = kết quả chèn trọn lô vào gốc vào.
        expect
          d_out.voted_root == book_root_after(
            d_in.voted_root,
            votes,
            insert_proofs,
          )
        // Quy đổi VP THÔ của cả lô ĐÚNG MỘT LẦN. Hai bất biến dưới đây đều đọc
        // `(vp_raw, choice)` của từng phiếu; gọi `top_heap_consistent` và
        // `sum_batch_consistent` dạng cũ thì mỗi hàm tự quy đổi lại cả lô.
        let entries = batch_entries(wp, votes)
        and {
          d_out.phase == Summing,
          // cửa sổ GHIM: không lượt gộp nào dời được mốc mở/đóng phiếu.
          d_out.vote_open_epoch == d_in.vote_open_epoch,
          d_out.vote_close_epoch == d_in.vote_close_epoch,
          // heap top-(F−1) canonical ⇒ mọi cá voi buộc có mặt ⇒ Finalize clamp
          // trừ đúng phần vượt ⇒ không DID nào thoát trần.
          top_heap_consistent_entries(d_in, d_out, entries, wp.bft_floor),
          // power_raw + đếm = cũ + DERIVE(phiếu thật) — không nhận delta tuỳ ý.
          sum_batch_consistent_entries(d_in, d_out, entries),
          nullifiers_burned(tx, nullifier_policy, votes),
          utxo_preserved(own_hash, tally_policy, d_in.proposal_id, tx),
        }
      }

      // ── Finalize: Summing → Clamped, ÉP clamp_consistent + GHIM ba trường mới ──
      Finalize -> {
        expect d_in.phase == Summing
        // (F0) cửa sổ gom đã hết. KHÔNG có vế này thì một giao dịch duy nhất gom
        // chọn lọc rồi đóng sổ là hợp lệ, và phiếu chưa gom bị phá huỷ vĩnh viễn.
        expect e >= d_in.vote_close_epoch + tally_window_epochs
        let wp =
          read_weight_param(
            tx.reference_inputs,
            weight_param_policy,
            d_in.weight_param_ref,
          )
        expect wp.bft_floor >= 1
        and {
          d_out.phase == Clamped,
          d_out.proposal_id == d_in.proposal_id,
          d_out.weight_param_ref == d_in.weight_param_ref,
          d_out.yes_power_raw == d_in.yes_power_raw,
          d_out.no_power_raw == d_in.no_power_raw,
          d_out.abstain_power_raw == d_in.abstain_power_raw,
          d_out.voters_acc == d_in.voters_acc,
          d_out.yes_voters_acc == d_in.yes_voters_acc,
          d_out.top_did_vp == d_in.top_did_vp,
          // GHIM ba trường v2. Vế `voted_root` là BẮT BUỘC: thiếu nó thì `Finalize`
          // ghi lại sổ tuỳ ý, và lớp (V5) của `vote` (phiếu phải có trong sổ) bị
          // chính nhánh này vô hiệu hoá.
          d_out.vote_open_epoch == d_in.vote_open_epoch,
          d_out.vote_close_epoch == d_in.vote_close_epoch,
          d_out.voted_root == d_in.voted_root,
          clamp_consistent(d_out, wp.bft_floor),
          utxo_preserved(own_hash, tally_policy, d_in.proposal_id, tx),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
