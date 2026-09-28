// Validator 6 — `governance` (Pha 1/2), nhánh `mint` ▸ `OpenProposal`.
//
// Đây là chỗ DUY NHẤT một proposal và Tally accumulator của nó được SINH RA cùng
// lúc. Cả `tally_nft` lẫn `tally` đều không kiểm được datum khởi tạo của Tally:
// `tally_nft` không biết `tally_script_hash` (biết là tạo vòng phụ thuộc hash), và
// `tally.spend` chỉ chạy khi Tally ĐÃ tồn tại. Nên mọi bất biến về TRẠNG THÁI BAN
// ĐẦU phải được ép ở đây, hoặc không ở đâu cả.
//
// ┌─ CHUỖI PHỤ THUỘC HASH — chiều đã chốt, đừng đảo ────────────────────────────┐
// │ tally_nft, weight_param_nft  (không phụ thuộc gì)                            │
// │        → nullifier (nhận tally_policy)                                       │
// │        → vote      (nhận tally_policy, nullifier_policy)                     │
// │        → tally     (nhận vote_script_hash, …)                                │
// │        → governance(nhận tally_script_hash)          ← TỆP NÀY, cuối chuỗi    │
// │                                                                              │
// │ `tally` CỐ Ý không nhận `governance_policy`: nhận là thành vòng               │
// │ `governance → tally → governance` và không bản nào biên dịch nổi. Cái giá là  │
// │ `tally` không tự kiểm được rằng Tally của nó ra đời từ một giao dịch Open —   │
// │ nhưng với proposal THẬT thì `governance` kiểm trong chính giao dịch đó, vì    │
// │ hai token cùng tên `H(seed)` chỉ đúc được cùng nhau một lần.                  │
// │ Hở còn lại (token tally đúc lẻ ngoài Open) khai ở `Governance/SPEC.md`.       │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ CHƯA CÓ NHÁNH `spend` — fail-closed, có chủ ý ──────────────────────────────┐
// │ `else(_) { fail }` nghĩa là proposal UTxO do nhánh này sinh ra KHÔNG tiêu lại │
// │ được: `FinalizeProposal` (đọc Tally đã `Clamped`, ghi `status`) chưa hiện     │
// │ thực. Hệ quả phải nói thẳng: pha 1/2 CHƯA triển khai được — proposal mở ra sẽ │
// │ đứng ở `Open` vĩnh viễn, và Treasury không bao giờ đọc thấy `Executed`.       │
// │ Chọn hướng này thay vì một nhánh `spend` lỏng: một nhánh tiêu được mà chưa ép │
// │ đủ ngưỡng là đường chi tiền, còn một UTxO khoá cứng chỉ là min-ADA bị kẹt.    │
// │ Khai ở `Governance/SPEC.md` dạng danh mục trạng thái.                        │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Tham số hoá: tally_policy, tally_script_hash, weight_param_policy, ms_per_epoch,
//              delta_min_epochs, recovery_timelock_epochs, phase_tag.

use aiken/collection/dict
use aiken/collection/list
use aiken/merkle_patricia_forestry as mpf
use aiken/interval
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/names.{proposal_id_of}
use magiclamp/governance/tally as tally_lib
use magiclamp/governance/tally_ref
use magiclamp/governance/power.{Knot, scale}
use magiclamp/governance/types.{
  Clamped, Executed, Open, ProposalResult, ProposalStatus, Rejected, Summing,
  TallyDatum, TopEntry, WeightParam, Yes,
}
use magiclamp/governance/util
use magiclamp/governance/weight_ref

/// Redeemer của nhánh `mint`. Tách khỏi redeemer của nhánh `spend` thành HAI kiểu
/// vì hai nhánh không bao giờ nhận redeemer của nhau: gộp một kiểu thì mỗi nhánh
/// phải mang một nhánh `when` chết, và chỉ số Constr của nhánh này bị dịch mỗi lần
/// thêm một redeemer cho nhánh kia.
pub type GovernanceRedeemer {
  OpenProposal {
    seed: OutputReference,
    vote_open_epoch: Int,
    vote_close_epoch: Int,
    weight_param_ref: OutputReference,
  }
}

/// Redeemer của nhánh `spend`.
pub type GovernanceSpendRedeemer {
  FinalizeProposal
}

/// Đúng MỘT output giữ 1 đơn vị `(policy, name)`. Nhiều hơn một ⇒ `fail`: hai
/// output cùng mang token của một proposal làm bên đọc (Treasury, `tally`) phải
/// chọn, và phép chọn đó không có ở đâu.
fn sole_holder(
  outputs: List<Output>,
  policy: PolicyId,
  name: ByteArray,
) -> Output {
  expect [o] =
    list.filter(
      outputs,
      fn(o) { assets.quantity_of(o.value, policy, name) > 0 },
    )
  expect assets.quantity_of(o.value, policy, name) == 1
  o
}

validator governance(
  tally_policy: PolicyId,
  tally_script_hash: ByteArray,
  weight_param_policy: PolicyId,
  ms_per_epoch: Int,
  delta_min_epochs: Int,
  recovery_timelock_epochs: Int,
  _phase_tag: ByteArray,
) {
  mint(redeemer: GovernanceRedeemer, policy_id: PolicyId, tx: Transaction) {
    let OpenProposal { seed, vote_open_epoch, vote_close_epoch,
                       weight_param_ref } = redeemer
    let e = util.get_epoch_bounded(tx, ms_per_epoch)
    let proposal_id = proposal_id_of(seed)

    // ── (O1) danh tính: tiêu hạt giống ⇒ `proposal_id` đúc được đúng một lần ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == seed })

    // ── (O2) lượt đúc: đúng token proposal + đúng token tally, KHÔNG gì khác ──
    //    Vế "đúng hai policy" chặn đường gộp Open với một lượt đúc khác (vd
    //    `nullifier`) — ở đó cổng của policy kia đọc cùng bộ output này và có thể
    //    diễn giải khác.
    expect dict.size(assets.tokens(tx.mint, policy_id)) == 1
    expect assets.quantity_of(tx.mint, policy_id, proposal_id) == 1
    expect dict.size(assets.tokens(tx.mint, tally_policy)) == 1
    expect assets.quantity_of(tx.mint, tally_policy, proposal_id) == 1
    expect list.length(assets.policies(tx.mint)) == 2

    // ── (O3) cửa sổ bỏ phiếu ──
    //    `vote_open >= e`: không mở một proposal đã "đang bỏ phiếu" trong quá khứ
    //    (cửa sổ quá khứ + `nullifier` đòi `vote_open <= e` ⇒ không ai đúc được
    //    phiếu, nhưng người mở tự đúc trước rồi mở sau thì có).
    expect vote_open_epoch >= e
    expect vote_close_epoch > vote_open_epoch
    // CAO-5: cửa sổ bỏ phiếu phải NGẮN HƠN thời hạn phục hồi DID. Không có vế này
    // thì một guardian chiếm được DID bằng luồng phục hồi và vẫn còn thời gian bỏ
    // phiếu bằng DID đó trong CÙNG cửa sổ — `[DID-RECOVERY-TRUST]`.
    expect vote_close_epoch - vote_open_epoch < recovery_timelock_epochs

    // ── (O4) proposal UTxO ──
    let p_out = sole_holder(tx.outputs, policy_id, proposal_id)
    expect util.is_at_script(p_out.address, policy_id)
    expect p_out.reference_script == None
    expect InlineDatum(pd) = p_out.datum
    expect pr: ProposalResult = pd

    // ── (O5) Tally UTxO ──
    let t_out = sole_holder(tx.outputs, tally_policy, proposal_id)
    expect util.is_at_script(t_out.address, tally_script_hash)
    expect t_out.reference_script == None
    expect InlineDatum(td) = t_out.datum
    expect ts: TallyDatum = td

    // ── (O6) `weight_param_ref` trỏ đúng một UTxO mang token bảng tham số ──
    //    `tally` cũng kiểm lại lúc đọc, nhưng kiểm ở đây biến "trỏ sai" từ một
    //    Tally KHOÁ CỨNG (không lượt gộp nào chạy được) thành một giao dịch Open
    //    không dựng nổi.
    expect
      list.any(
        tx.reference_inputs,
        fn(i) {
          and {
            i.output_reference == weight_param_ref,
            dict.size(assets.tokens(i.output.value, weight_param_policy)) == 1,
          }
        },
      )

    and {
      // proposal: trạng thái ban đầu
      pr.proposal_id == proposal_id,
      pr.status == Open,
      // SELF-DUP-CHOICE mức 3 chưa có đường đóng kín ⇒ Pha 1/2 KHÔNG cho proposal
      // chi tiền. `#""` là giá trị Treasury đọc thành "không có danh sách chi".
      pr.spend_spec_hash == #"",
      pr.released_cumulative == 0,
      pr.execute_after_epoch >= vote_close_epoch + delta_min_epochs,
      // tally: trạng thái ban đầu — MỌI trường, không chỉ các bộ đếm
      ts.proposal_id == proposal_id,
      ts.phase == Summing,
      ts.weight_param_ref == weight_param_ref,
      ts.yes_power_raw == 0,
      ts.no_power_raw == 0,
      ts.abstain_power_raw == 0,
      ts.voters_acc == 0,
      ts.yes_voters_acc == 0,
      ts.top_did_vp == [],
      ts.yes_power_eff == 0,
      ts.no_power_eff == 0,
      ts.abstain_power_eff == 0,
      ts.vote_open_epoch == vote_open_epoch,
      ts.vote_close_epoch == vote_close_epoch,
      // SỔ RỖNG. Không có vế này thì người mở proposal ghi sẵn vào sổ những
      // `did_commit` của phe đối lập: các DID đó không đúc được phiếu nào vào sổ
      // nữa (`mpf.insert` bác khoá đã có) ⇒ bị loại khỏi cuộc bỏ phiếu.
      ts.voted_root == mpf.root(mpf.empty),
    }
  }

  // ── FinalizeProposal: Open → Executed / Rejected ────────────────────────────
  //
  // Đây là chỗ DUY NHẤT ngưỡng thông qua được ép (CONTRACT §5 D3 — "Release-gate =
  // Model A"): Treasury KHÔNG tự tính ngưỡng, nó chỉ kiểm `status == Executed` +
  // Proposal NFT + `spend_spec_hash` + time-lock. Nên nếu nhánh này ghi `Executed`
  // sai một lần thì không có tầng nào phía sau bắt lại.
  //
  // Nhánh này KHÔNG chi một đồng nào, và điều đó KHÔNG phải vì nó thiếu đường chi:
  // nó ghim `spend_spec_hash == #""`, mà `Treasury` ▸ `release.spend_spec_hash` so
  // hash canonical của danh sách chi với trường đó — không danh sách chi nào băm ra
  // chuỗi rỗng, nên mọi lượt Release đều bị từ chối. Đó là ràng buộc tạm fail-closed
  // của `[SELF-DUP-CHOICE]`, không phải một hở.
  spend(
    datum_opt: Option<ProposalResult>,
    _redeemer: GovernanceSpendRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(pr_in) = datum_opt
    let inp = util.own_input(own_ref, tx.inputs)
    // `own_hash` ĐỒNG THỜI là policy id của token proposal: `governance` là một
    // script hai mục đích (`mint` + `spend`), nên hash script bằng policy id. Nhánh
    // `spend` không được truyền `policy_id`, và đây là cách lấy nó mà không thêm một
    // apply-param tự khai (apply-param thì người deploy đặt sai được, `own_hash` thì
    // không).
    let own_hash = util.own_script_hash(inp.address)
    let e = util.get_epoch_bounded(tx, ms_per_epoch)

    // ── (S1) chỉ đi từ `Open` ──
    //    Vế này cũng là thứ làm proposal đã kết thúc KHÔNG tiêu lại được: một
    //    proposal `Executed` hay `Rejected` không khớp nhánh nào (`[PROPOSAL-CLOSE]`).
    expect pr_in.status == Open

    // ── (S2) đúng 1 input + 1 output tại script này ──
    //    Chống double satisfaction: `util.output_at_script` lấy output KHỚP ĐẦU TIÊN,
    //    nên không đếm thì một output hợp lệ thoả cho nhiều proposal cùng lúc — và
    //    mỗi proposal chỉ cần MỘT tally qua ngưỡng là đủ để lật tất cả.
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
    let out = util.output_at_script(tx.outputs, own_hash)

    // ── (S3) NFT xác thực đi qua nguyên vẹn, tên = `proposal_id` ──
    //    `release.read_proposal` của Treasury ép `nft_name == result.proposal_id`;
    //    nếu nhánh này để tên token và `proposal_id` trong datum trôi khỏi nhau thì
    //    beacon thành không đọc được, hoặc đọc được dưới một danh tính khác.
    expect assets.quantity_of(inp.value, own_hash, pr_in.proposal_id) == 1
    expect dict.size(assets.tokens(inp.value, own_hash)) == 1
    expect assets.quantity_of(out.value, own_hash, pr_in.proposal_id) == 1

    // ── (S4) bảo toàn value + ĐỊA CHỈ ĐẦY ĐỦ + không đính script ──
    //    `util.is_at_script` chỉ so payment credential (đúng cho việc ĐẾM); ép đích
    //    thì phải so cả `stake_credential`, không thì người tiêu đổi stake cred và
    //    lấy phần thưởng staking của UTxO beacon.
    expect out.value == inp.value
    expect out.address == inp.address
    expect out.reference_script == None

    // ── (S5) không đúc, không đốt ──
    //    Chặn đường gộp lượt ghi kết quả vào một lượt đúc bất kỳ, gồm cả việc đúc
    //    thêm một token proposal cùng tên.
    expect tx.mint == assets.zero

    // ── (S6) time-lock ──
    //    Custody ép `cur >= execute_after_epoch` (C-REL-8) ở lượt CHI. Ép thêm ở
    //    lượt GHI để `Executed` không tồn tại trên chuỗi trước mốc đó — cái đó là
    //    thứ bên ngoài đọc, và nó là lời hứa về thời gian phản đối.
    expect e >= pr_in.execute_after_epoch

    // ── (S7) Tally của ĐÚNG proposal này, ĐÃ `Clamped`, tại ĐÚNG script tally ──
    //    `Clamped` là điều kiện then chốt: pha `Summing` mang power CHƯA clamp, và
    //    đọc ngưỡng trên số chưa clamp là đúng lỗ GAME-1 ("release bỏ qua clamp").
    let td =
      tally_ref.expect_tally_at(
        tx.reference_inputs,
        tally_policy,
        pr_in.proposal_id,
        tally_script_hash,
      )
    expect td.phase == Clamped

    // ── (S8) bảng tham số ĐÚNG ref mà tally đã cam kết ──
    //    Đọc theo `td.weight_param_ref`, KHÔNG theo một ref trong redeemer: ngưỡng
    //    phải là ngưỡng đã chốt lúc Open, không phải ngưỡng người tiêu chọn lúc ghi
    //    kết quả (audit Finding 1). `weight_ref.read_weight_param` ép cổng D8 bên trong.
    let wp =
      weight_ref.read_weight_param(
        tx.reference_inputs,
        weight_param_policy,
        td.weight_param_ref,
      )
    expect wp.bft_floor >= 1

    // ── (S9) datum ra: CHỈ `status` đổi, và đúng theo `pass` canonical ──
    expect InlineDatum(od) = out.datum
    expect pr_out: ProposalResult = od
    let verdict =
      if tally_lib.pass(
        td,
        wp.bft_floor,
        wp.quorum_vp_threshold,
        wp.quorum_voter_threshold,
        wp.theta_num,
        wp.theta_den,
      ) {
        Executed
      } else {
        Rejected
      }
    and {
      pr_out.proposal_id == pr_in.proposal_id,
      pr_out.spend_spec_hash == pr_in.spend_spec_hash,
      // ràng buộc tạm `[SELF-DUP-CHOICE]`: ép LẠI ở đây, không chỉ ở Open. Một UTxO
      // proposal có thể tồn tại từ trước bản này (hoặc từ một đường chưa biết) với
      // `spend_spec_hash` khác rỗng; nhánh ghi kết quả là cửa cuối trước Treasury.
      pr_out.spend_spec_hash == #"",
      pr_out.released_cumulative == pr_in.released_cumulative,
      pr_out.execute_after_epoch == pr_in.execute_after_epoch,
      pr_out.status == verdict,
    }
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

const gov_policy: PolicyId = #"9001"

const tally_policy: PolicyId = #"7a11"

const tally_sh: ByteArray = #"7a"

const wp_policy: PolicyId = #"a0a0"

const tag: ByteArray = #"5031"

const ms_ep: Int = 86_400_000

const delta_min: Int = 2

/// Thời hạn phục hồi DID (soft-pin theo mạng); cửa sổ bỏ phiếu phải ngắn hơn.
const recovery_epochs: Int = 15

const e_now: Int = 10

const open_e: Int = 12

const close_e: Int = 20

fn seed() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 3 }
}

fn prop() -> ByteArray {
  proposal_id_of(seed())
}

fn wp_ref() -> OutputReference {
  OutputReference { transaction_id: #"cc", output_index: 1 }
}

fn seed_input() -> Input {
  util.mk_input(
    seed(),
    util.mk_output_no_datum(
      util.vk_address(#"f0"),
      assets.from_lovelace(5_000_000),
    ),
  )
}

fn wp_ref_input() -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, tag, 1)
  util.mk_input(
    wp_ref(),
    util.mk_output(util.script_address(#"a0"), val, 0),
  )
}

fn pr_ok() -> ProposalResult {
  ProposalResult {
    proposal_id: prop(),
    status: Open,
    spend_spec_hash: #"",
    execute_after_epoch: close_e + delta_min,
    released_cumulative: 0,
  }
}

fn ts_ok() -> TallyDatum {
  TallyDatum {
    proposal_id: prop(),
    phase: Summing,
    weight_param_ref: wp_ref(),
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
    voted_root: mpf.root(mpf.empty),
  }
}

fn p_out_of(pr: ProposalResult) -> Output {
  let val = assets.from_lovelace(2_000_000) |> assets.add(gov_policy, prop(), 1)
  util.mk_output(util.script_address(gov_policy), val, pr)
}

fn t_out_of(ts: TallyDatum) -> Output {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop(), 1)
  util.mk_output(util.script_address(tally_sh), val, ts)
}

fn mint_ok() -> Value {
  assets.zero
    |> assets.add(gov_policy, prop(), 1)
    |> assets.add(tally_policy, prop(), 1)
}

fn run_with(
  redeemer: GovernanceRedeemer,
  inputs: List<Input>,
  refs: List<Input>,
  outputs: List<Output>,
  mint: Value,
  e: Int,
) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      inputs: inputs,
      reference_inputs: refs,
      outputs: outputs,
      mint: mint,
      validity_range: interval.between(e * ms_ep, e * ms_ep + 1000),
    }
  governance.mint(
    tally_policy,
    tally_sh,
    wp_policy,
    ms_ep,
    delta_min,
    recovery_epochs,
    tag,
    redeemer,
    gov_policy,
    tx,
  )
}

fn rd(open_ep: Int, close_ep: Int) -> GovernanceRedeemer {
  OpenProposal {
    seed: seed(),
    vote_open_epoch: open_ep,
    vote_close_epoch: close_ep,
    weight_param_ref: wp_ref(),
  }
}

fn run(outputs: List<Output>) -> Bool {
  run_with(
    rd(open_e, close_e),
    [seed_input()],
    [wp_ref_input()],
    outputs,
    mint_ok(),
    e_now,
  )
}

fn outs_ok() -> List<Output> {
  [p_out_of(pr_ok()), t_out_of(ts_ok())]
}

test open_happy() {
  run(outs_ok())
}

// ── (O1) danh tính ──

test open_khong_tieu_hat_giong_tu_choi() fail {
  expect
    run_with(
      rd(open_e, close_e),
      [
        util.mk_input(
          util.mk_ref(9),
          util.mk_output_no_datum(
            util.vk_address(#"f0"),
            assets.from_lovelace(5_000_000),
          ),
        ),
      ],
      [wp_ref_input()],
      outs_ok(),
      mint_ok(),
      e_now,
    )
  True
}

// ── (O2) lượt đúc ──

/// Không đúc token tally ⇒ proposal không có accumulator, và `vote` sẽ không tìm
/// được Tally nào để gộp vào.
test open_khong_duc_token_tally_tu_choi() fail {
  let mint = assets.zero |> assets.add(gov_policy, prop(), 1)
  expect
    run_with(
      rd(open_e, close_e),
      [seed_input()],
      [wp_ref_input()],
      [p_out_of(pr_ok())],
      mint,
      e_now,
    )
  True
}

/// Đúc token tally với TÊN KHÁC `H(seed)`. Lượt đúc vẫn có đúng một tên của
/// `tally_policy` (nên vế `dict.size == 1` thoả) và output Tally vẫn mang token
/// đúng tên, nên chỉ vế "tên đúc phải là `H(seed)`" bác.
///
/// Vì sao là đòn thật: `tally_nft` tự nó chỉ ép tên = `H(seed_của_nó)`. Nếu Open
/// không ép tên ĐÚC khớp `H(seed_của_proposal)`, một giao dịch Open dùng seed `A`
/// đi kèm một token tally đúc từ seed `B` — và token `(tally_policy, H(A))` mà
/// output đang giữ khi đó là một token đã đúc từ TRƯỚC, ở một giao dịch không ai
/// kiểm datum khởi tạo của nó.
test open_duc_token_tally_ten_khac_tu_choi() fail {
  let mint =
    assets.zero
      |> assets.add(gov_policy, prop(), 1)
      |> assets.add(tally_policy, #"dead", 1)
  expect
    run_with(
      rd(open_e, close_e),
      [seed_input()],
      [wp_ref_input()],
      outs_ok(),
      mint,
      e_now,
    )
  True
}

/// Gộp một policy thứ ba vào giao dịch Open.
test open_gop_policy_thu_ba_tu_choi() fail {
  let mint = mint_ok() |> assets.add(#"beef", #"01", 1)
  expect
    run_with(
      rd(open_e, close_e),
      [seed_input()],
      [wp_ref_input()],
      outs_ok(),
      mint,
      e_now,
    )
  True
}

/// Đúc hai đơn vị token proposal — hai UTxO cùng mang beacon kết quả.
test open_hai_don_vi_token_proposal_tu_choi() fail {
  let mint =
    assets.zero
      |> assets.add(gov_policy, prop(), 2)
      |> assets.add(tally_policy, prop(), 1)
  expect
    run_with(
      rd(open_e, close_e),
      [seed_input()],
      [wp_ref_input()],
      outs_ok(),
      mint,
      e_now,
    )
  True
}

// ── (O3) cửa sổ ──

test open_cua_so_trong_qua_khu_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), vote_open_epoch: e_now - 1 }
  expect
    run_with(
      rd(e_now - 1, close_e),
      [seed_input()],
      [wp_ref_input()],
      [p_out_of(pr_ok()), t_out_of(ts)],
      mint_ok(),
      e_now,
    )
  True
}

/// `vote_open == e` đúng bằng biên — PHẢI qua.
test open_cua_so_mo_ngay_epoch_nay_qua() {
  let ts = TallyDatum { ..ts_ok(), vote_open_epoch: e_now }
  run_with(
    rd(e_now, close_e),
    [seed_input()],
    [wp_ref_input()],
    [p_out_of(pr_ok()), t_out_of(ts)],
    mint_ok(),
    e_now,
  )
}

test open_dong_truoc_khi_mo_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), vote_close_epoch: open_e }
  let pr = ProposalResult { ..pr_ok(), execute_after_epoch: 99 }
  expect
    run_with(
      rd(open_e, open_e),
      [seed_input()],
      [wp_ref_input()],
      [p_out_of(pr), t_out_of(ts)],
      mint_ok(),
      e_now,
    )
  True
}

/// CAO-5: cửa sổ bỏ phiếu DÀI hơn thời hạn phục hồi DID.
test open_cua_so_dai_hon_thoi_han_phuc_hoi_tu_choi() fail {
  let far = open_e + recovery_epochs
  let ts = TallyDatum { ..ts_ok(), vote_close_epoch: far }
  let pr = ProposalResult { ..pr_ok(), execute_after_epoch: far + delta_min }
  expect
    run_with(
      rd(open_e, far),
      [seed_input()],
      [wp_ref_input()],
      [p_out_of(pr), t_out_of(ts)],
      mint_ok(),
      e_now,
    )
  True
}

/// Cửa sổ NGẮN HƠN đúng một epoch so với thời hạn phục hồi — PHẢI qua.
test open_cua_so_ngan_hon_mot_epoch_qua() {
  let far = open_e + recovery_epochs - 1
  let ts = TallyDatum { ..ts_ok(), vote_close_epoch: far }
  let pr = ProposalResult { ..pr_ok(), execute_after_epoch: far + delta_min }
  run_with(
    rd(open_e, far),
    [seed_input()],
    [wp_ref_input()],
    [p_out_of(pr), t_out_of(ts)],
    mint_ok(),
    e_now,
  )
}

/// Khoảng hiệu lực mở một đầu ⇒ `get_epoch_bounded` bác: không có nó thì người mở
/// chọn được `e` nào có lợi cho vế `vote_open >= e`.
test open_khoang_hieu_luc_mo_tu_choi() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [seed_input()],
      reference_inputs: [wp_ref_input()],
      outputs: outs_ok(),
      mint: mint_ok(),
      validity_range: interval.after(e_now * ms_ep),
    }
  expect
    governance.mint(
      tally_policy,
      tally_sh,
      wp_policy,
      ms_ep,
      delta_min,
      recovery_epochs,
      tag,
      rd(open_e, close_e),
      gov_policy,
      tx,
    )
  True
}

// ── (O4) proposal UTxO ──

test open_proposal_dich_vi_thuong_tu_choi() fail {
  let val = assets.from_lovelace(2_000_000) |> assets.add(gov_policy, prop(), 1)
  let out = util.mk_output(util.vk_address(#"f0"), val, pr_ok())
  expect run([out, t_out_of(ts_ok())])
  True
}

test open_proposal_dinh_kem_script_tu_choi() fail {
  let out = Output { ..p_out_of(pr_ok()), reference_script: Some(#"aabb") }
  expect run([out, t_out_of(ts_ok())])
  True
}

/// `spend_spec_hash` KHÔNG rỗng — proposal chi tiền. Ràng buộc tạm fail-closed của
/// `[SELF-DUP-CHOICE]`.
test open_spend_spec_hash_khong_rong_tu_choi() fail {
  let pr = ProposalResult { ..pr_ok(), spend_spec_hash: #"aabbcc" }
  expect run([p_out_of(pr), t_out_of(ts_ok())])
  True
}

test open_released_cumulative_khac_khong_tu_choi() fail {
  let pr = ProposalResult { ..pr_ok(), released_cumulative: 1 }
  expect run([p_out_of(pr), t_out_of(ts_ok())])
  True
}

test open_status_khong_phai_open_tu_choi() fail {
  let pr = ProposalResult { ..pr_ok(), status: Executed }
  expect run([p_out_of(pr), t_out_of(ts_ok())])
  True
}

/// `execute_after_epoch` sớm hơn `vote_close + Δ_min` ⇒ chi tiền trước khi kết quả
/// được ghi.
test open_execute_after_qua_som_tu_choi() fail {
  let pr =
    ProposalResult { ..pr_ok(), execute_after_epoch: close_e + delta_min - 1 }
  expect run([p_out_of(pr), t_out_of(ts_ok())])
  True
}

// ── (O5) Tally UTxO ──

test open_tally_dich_script_khac_tu_choi() fail {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop(), 1)
  let out = util.mk_output(util.script_address(#"dead"), val, ts_ok())
  expect run([p_out_of(pr_ok()), out])
  True
}

test open_tally_dinh_kem_script_tu_choi() fail {
  let out = Output { ..t_out_of(ts_ok()), reference_script: Some(#"aabb") }
  expect run([p_out_of(pr_ok()), out])
  True
}

/// SỔ ĐÃ CÓ NGƯỜI: người mở ghi sẵn `did_commit` của phe đối lập vào sổ ⇒ các DID
/// đó không chèn được phiếu nào nữa (`mpf.insert` bác khoá đã có) ⇒ bị loại.
/// Gốc dùng ở đây là gốc THẬT của một cây một khoá, nên nó qua mọi vế khác.
test open_so_khong_rong_tu_choi() fail {
  let ts =
    TallyDatum {
      ..ts_ok(),
      voted_root: #"f61f4cedb818770b83c26787080e864e71ade8d71b0dc6bcbaeab561696ecba6",
    }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

test open_bo_dem_khac_khong_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), yes_power_raw: 1 }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

test open_voters_khac_khong_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), voters_acc: 1 }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

/// Heap nạp sẵn một entry: nó đi thẳng vào phép clamp ở `Finalize` mà không ứng
/// phiếu nào (`SumBatch` chỉ ép heap RA suy từ heap VÀO + lô).
test open_heap_nap_san_tu_choi() fail {
  let ts =
    TallyDatum { ..ts_ok(), top_did_vp: [TopEntry { vp_raw: 1, choice: Yes }] }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

test open_pha_khong_phai_summing_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), phase: Clamped }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

/// Datum Tally khai cửa sổ KHÁC redeemer ⇒ `nullifier` và `vote` đọc cửa sổ từ
/// datum, nên không ghim thì cửa sổ của redeemer chỉ là trang trí.
test open_tally_cua_so_lech_redeemer_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), vote_close_epoch: close_e + 5 }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

test open_tally_proposal_id_lech_tu_choi() fail {
  let ts = TallyDatum { ..ts_ok(), proposal_id: #"abcd" }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}

// ── (O6) weight_param_ref ──

test open_weight_param_ref_khong_co_token_tu_choi() fail {
  let bad =
    util.mk_input(
      wp_ref(),
      util.mk_output(
        util.script_address(#"a0"),
        assets.from_lovelace(2_000_000),
        0,
      ),
    )
  expect
    run_with(
      rd(open_e, close_e),
      [seed_input()],
      [bad],
      outs_ok(),
      mint_ok(),
      e_now,
    )
  True
}

// ════════════════════════════════════════════════════════════
// FinalizeProposal — Open → Executed / Rejected
// ════════════════════════════════════════════════════════════

const tally_policy_id: PolicyId = tally_policy

/// epoch ghi kết quả: sau `execute_after_epoch` của `pr_ok()`.
const e_fin: Int = close_e + delta_min

// ── WeightParam dùng ở nhánh spend ──
//
// Bảng `pow(c) = SCALE·(c+1)` — cùng khuôn `tally_test` dùng, và vì sao giống nhau
// đã ghi ở đó: cổng nguồn ép `c1 = c2 = c4 = 0`, nên bảng có `pow(0) = 0` làm VP của
// mọi cử tri bằng 0 và ca kiểm ngưỡng xanh ở CẢ HAI cực.
fn lin_knots() -> List<Knot> {
  [
    Knot { c: 0, pow: scale },
    Knot { c: 1_000_000_000, pow: 1_000_000_001 * scale },
  ]
}

/// `bft_floor = 3` (sàn cứng số DID thuận), quorum người 2, quorum VP 1, θ = 2/3.
fn wp_datum() -> WeightParam {
  WeightParam {
    k1: lin_knots(),
    k2: lin_knots(),
    k3: lin_knots(),
    k4: lin_knots(),
    bft_floor: 3,
    quorum_vp_threshold: 1,
    quorum_voter_threshold: 2,
    theta_num: 2,
    theta_den: 3,
  }
}

fn wp_ref_input_with(wp: WeightParam) -> Input {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, tag, 1)
  util.mk_input(wp_ref(), util.mk_output(util.script_address(#"a0"), val, wp))
}

fn wp_ref_input_ok() -> Input {
  wp_ref_input_with(wp_datum())
}

/// Tally đã `Clamped`. `pass` canonical (`tally_lib.pass`) đọc đúng năm số dưới đây.
fn td_clamped(
  yes_eff: Int,
  no_eff: Int,
  abstain_eff: Int,
  voters: Int,
  yes_voters: Int,
) -> TallyDatum {
  TallyDatum {
    proposal_id: prop(),
    phase: Clamped,
    weight_param_ref: wp_ref(),
    yes_power_raw: yes_eff,
    no_power_raw: no_eff,
    abstain_power_raw: abstain_eff,
    voters_acc: voters,
    yes_voters_acc: yes_voters,
    top_did_vp: [],
    yes_power_eff: yes_eff,
    no_power_eff: no_eff,
    abstain_power_eff: abstain_eff,
    vote_open_epoch: open_e,
    vote_close_epoch: close_e,
    voted_root: mpf.root(mpf.empty),
  }
}

/// Thoả TRỌN BỘ `pass`: yes_voters 4 ≥ F=3 · total_vp 100 ≥ 1 · voters 5 ≥ 2 ·
/// 70·3 = 210 ≥ (70+20)·2 = 180.
fn td_pass() -> TallyDatum {
  td_clamped(70, 20, 10, 5, 4)
}

/// Không thoả CHỈ ở vế θ: 50·3 = 150 < (50+40)·2 = 180. Ba vế kia vẫn thoả.
fn td_fail_theta() -> TallyDatum {
  td_clamped(50, 40, 10, 5, 4)
}

fn tally_ref_input_of(td: TallyDatum, sh: ByteArray) -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy_id, prop(), 1)
  util.mk_input(util.mk_ref(50), util.mk_output(util.script_address(sh), val, td))
}

fn tally_ref_input(td: TallyDatum) -> Input {
  tally_ref_input_of(td, tally_sh)
}

// ── UTxO proposal ──

fn proposal_value() -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(gov_policy, prop(), 1)
}

fn prop_in_of(pr: ProposalResult, val: Value) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(gov_policy), val, pr),
  )
}

fn prop_in() -> Input {
  prop_in_of(pr_ok(), proposal_value())
}

fn prop_out_of(pr: ProposalResult, val: Value) -> Output {
  util.mk_output(util.script_address(gov_policy), val, pr)
}

fn result_of(status: ProposalStatus) -> ProposalResult {
  ProposalResult { ..pr_ok(), status }
}

fn run_fin_full(
  pr_in: ProposalResult,
  inputs: List<Input>,
  refs: List<Input>,
  outputs: List<Output>,
  mint: Value,
  e: Int,
) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      inputs: inputs,
      reference_inputs: refs,
      outputs: outputs,
      mint: mint,
      validity_range: interval.between(e * ms_ep, e * ms_ep + 1000),
    }
  governance.spend(
    tally_policy,
    tally_sh,
    wp_policy,
    ms_ep,
    delta_min,
    recovery_epochs,
    tag,
    Some(pr_in),
    FinalizeProposal,
    util.mk_ref(0),
    tx,
  )
}

/// Khuôn chuẩn: thay đổi duy nhất theo tham số là Tally và datum ra.
fn run_fin(td: TallyDatum, pr_out: ProposalResult) -> Bool {
  run_fin_full(
    pr_ok(),
    [prop_in()],
    [tally_ref_input(td), wp_ref_input_ok()],
    [prop_out_of(pr_out, proposal_value())],
    assets.zero,
    e_fin,
  )
}

test fin_qua_nguong_ghi_executed() {
  run_fin(td_pass(), result_of(Executed))
}

test fin_khong_qua_nguong_ghi_rejected() {
  run_fin(td_fail_theta(), result_of(Rejected))
}

/// Qua ngưỡng nhưng datum ra ghi `Rejected` — nhánh này ép ĐÚNG phán quyết, không
/// chỉ ép "một trong hai".
test fin_qua_nguong_ma_ghi_rejected_tu_choi() fail {
  expect run_fin(td_pass(), result_of(Rejected))
  True
}

/// Không qua ngưỡng mà ghi `Executed` — đây là đòn CHÍNH: Treasury chỉ đọc
/// `status == Executed`, nên nếu nhánh này lỏng thì không tầng nào phía sau bắt lại.
test fin_khong_qua_nguong_ma_ghi_executed_tu_choi() fail {
  expect run_fin(td_fail_theta(), result_of(Executed))
  True
}

// ── (S9) từng vế của `pass` canonical ──

/// Sàn cứng: `yes_voters_acc = 2 < F = 3`. Ba vế kia vẫn thoả ⇒ phán quyết phải là
/// `Rejected`, nên ca này ghi `Executed` và phải đỏ.
test fin_duoi_san_cung_bft_ghi_executed_tu_choi() fail {
  expect run_fin(td_clamped(70, 20, 10, 5, 2), result_of(Executed))
  True
}

/// Mặt thuận: đúng cùng Tally đó, ghi `Rejected` thì qua.
test fin_duoi_san_cung_bft_ghi_rejected_qua() {
  run_fin(td_clamped(70, 20, 10, 5, 2), result_of(Rejected))
}

/// Quorum THEO NGƯỜI: `voters_acc = 1 < 2`.
test fin_duoi_quorum_nguoi_ghi_executed_tu_choi() fail {
  expect run_fin(td_clamped(70, 20, 10, 1, 4), result_of(Executed))
  True
}

/// Quorum THEO VP: tổng VP_eff = 0 < 1. Abstain NẰM TRONG mẫu của quorum-VP (D1),
/// nên ca này cũng ghim chiều đó: ba số eff đều 0.
test fin_duoi_quorum_vp_ghi_executed_tu_choi() fail {
  expect run_fin(td_clamped(0, 0, 0, 5, 4), result_of(Executed))
  True
}

/// θ đúng BẰNG ngưỡng phải PASS (dấu `≥`, D1): 60·3 = 180 ≥ (60+30)·2 = 180.
test fin_theta_dung_bang_nguong_qua() {
  run_fin(td_clamped(60, 30, 10, 5, 4), result_of(Executed))
}

/// Và lệch một đơn vị dưới ngưỡng thì `Rejected`: 59·3 = 177 < (59+30)·2 = 178.
test fin_theta_lech_mot_don_vi_thi_rejected() {
  run_fin(td_clamped(59, 30, 10, 5, 4), result_of(Rejected))
}

// ── (S1) nguồn trạng thái ──

/// Proposal đã `Executed` không tiêu lại được — nếu tiêu được thì một proposal đã
/// chi xong được ghi lại `Executed` với `released_cumulative` reset.
test fin_tu_executed_tu_choi() fail {
  expect
    run_fin_full(
      result_of(Executed),
      [prop_in_of(result_of(Executed), proposal_value())],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

test fin_tu_rejected_tu_choi() fail {
  expect
    run_fin_full(
      result_of(Rejected),
      [prop_in_of(result_of(Rejected), proposal_value())],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

// ── (S6) time-lock ──

/// `e = execute_after − 1`. Mọi vế khác y hệt `fin_qua_nguong_ghi_executed`.
test fin_truoc_execute_after_tu_choi() fail {
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin - 1,
    )
  True
}

/// Khoảng hiệu lực mở một đầu ⇒ `get_epoch_bounded` bác. Không có khuôn hai-đầu thì
/// người tiêu chọn được biên có lợi cho vế time-lock.
test fin_khoang_hieu_luc_mo_tu_choi() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [prop_in()],
      reference_inputs: [tally_ref_input(td_pass()), wp_ref_input_ok()],
      outputs: [prop_out_of(result_of(Executed), proposal_value())],
      validity_range: interval.after(e_fin * ms_ep),
    }
  expect
    governance.spend(
      tally_policy,
      tally_sh,
      wp_policy,
      ms_ep,
      delta_min,
      recovery_epochs,
      tag,
      Some(pr_ok()),
      FinalizeProposal,
      util.mk_ref(0),
      tx,
    )
  True
}

// ── (S7) Tally ──

/// Tally còn ở pha `Summing`: power CHƯA clamp. Đây là lỗ GAME-1 ("release bỏ qua
/// clamp") — cùng bộ số nhưng chưa trừ phần vượt trần của cá voi.
test fin_tally_con_summing_tu_choi() fail {
  let td = TallyDatum { ..td_pass(), phase: Summing }
  expect run_fin(td, result_of(Executed))
  True
}

/// Tally nằm NGOÀI script tally (`R-TALLY-HASH`). Token vẫn đúng tên và đúng số
/// lượng, datum vẫn `Clamped` — chỉ địa chỉ khác.
test fin_tally_ngoai_script_tally_tu_choi() fail {
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input_of(td_pass(), #"dead"), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// Tally của proposal KHÁC (tên token khác) ⇒ không tìm được tally nào.
test fin_tally_cua_proposal_khac_tu_choi() fail {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy_id, #"beef", 1)
  let bad =
    util.mk_input(
      util.mk_ref(50),
      util.mk_output(util.script_address(tally_sh), val, td_pass()),
    )
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [bad, wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// HAI reference input cùng mang token tally của proposal này: một cái thật
/// (`td_fail_theta` — trượt ngưỡng) và một cái dựng thêm mang `td_pass`. Nếu chỗ đọc
/// chỉ "tìm cái đầu tiên" thì người tiêu CHỌN được tally nào validator đọc, và thứ
/// tự reference input là thứ họ tự đặt. Chỉ vế "đúng MỘT" mới bác.
test fin_hai_tally_cung_proposal_tu_choi() fail {
  let gia =
    util.mk_input(
      OutputReference { transaction_id: #"77", output_index: 0 },
      util.mk_output(
        util.script_address(tally_sh),
        assets.from_lovelace(2_000_000)
          |> assets.add(tally_policy_id, prop(), 1),
        td_pass(),
      ),
    )
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [gia, tally_ref_input(td_fail_theta()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

// ── (S8) WeightParam ──

/// Beacon `WeightParam` bị nhân bản: đúng MỘT tên tài sản nhưng số lượng 2. Vế đếm
/// số TÊN vẫn thoả, chỉ vế `qty == 1` bác. Bảng tham số là thứ quyết định ngưỡng nên
/// tính-độc-nhất của nó phải ép ở SỐ LƯỢNG, không chỉ ở tên.
test fin_weight_param_nhan_ban_tu_choi() fail {
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, tag, 2)
  let doi =
    util.mk_input(
      wp_ref(),
      util.mk_output(util.script_address(#"a0"), val, wp_datum()),
    )
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), doi],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// Tally cam kết `wp_ref()`, nhưng reference input mang bảng ở MỘT ref khác. Bảng
/// đó có ngưỡng dễ hơn (θ = 1/2) và sẽ cho `Executed` với `td_fail_theta()`.
test fin_weight_param_ref_khac_cam_ket_tu_choi() fail {
  let easy = WeightParam { ..wp_datum(), theta_num: 1, theta_den: 2 }
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, tag, 1)
  let other =
    util.mk_input(
      OutputReference { transaction_id: #"ee", output_index: 0 },
      util.mk_output(util.script_address(#"a0"), val, easy),
    )
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_fail_theta()), other],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// Bảng weight VI PHẠM D8 (C4 nặng hơn C3): `read_weight_param` bác ngay ở phép đọc.
test fin_bang_weight_vi_pham_d8_tu_choi() fail {
  let sqrt_knots =
    [
      Knot { c: 0, pow: scale },
      Knot { c: 250_000_000, pow: 15_811 * scale },
      Knot { c: 1_000_000_000, pow: 31_623 * scale },
    ]
  let bad = WeightParam { ..wp_datum(), k3: sqrt_knots, k4: lin_knots() }
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_with(bad)],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// `bft_floor = 0` làm sàn cứng biến mất VÀ `cap_per_did` chia cho 0 ở tầng clamp.
test fin_bft_floor_khong_tu_choi() fail {
  let bad = WeightParam { ..wp_datum(), bft_floor: 0 }
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_with(bad)],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

// ── (S3)/(S4)/(S5) bảo toàn beacon ──

/// Hút ADA của UTxO beacon: giữ NFT, datum đúng, nhưng lovelace giảm.
test fin_hut_ada_tu_choi() fail {
  let drained =
    assets.from_lovelace(500_000) |> assets.add(gov_policy, prop(), 1)
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), drained)],
      assets.zero,
      e_fin,
    )
  True
}

/// Đổi stake credential của địa chỉ ra: `util.is_at_script` chỉ so payment
/// credential nên mọi vế đếm vẫn thoả.
test fin_doi_stake_credential_tu_choi() fail {
  let out =
    util.mk_output(
      util.script_address_staked(gov_policy, #"5747"),
      proposal_value(),
      result_of(Executed),
    )
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [out],
      assets.zero,
      e_fin,
    )
  True
}

test fin_dinh_kem_script_tu_choi() fail {
  let out =
    Output {
      ..prop_out_of(result_of(Executed), proposal_value()),
      reference_script: Some(#"aabb"),
    }
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [out],
      assets.zero,
      e_fin,
    )
  True
}

/// Hai đơn vị NFT ở CẢ hai đầu ⇒ đẳng thức bảo toàn value thoả và `dict.size == 1`
/// cũng thoả (nó đếm số TÊN). Chỉ vế số lượng bác.
test fin_nhan_ban_nft_tu_choi() fail {
  let doubled =
    assets.from_lovelace(2_000_000) |> assets.add(gov_policy, prop(), 2)
  expect
    run_fin_full(
      pr_ok(),
      [prop_in_of(pr_ok(), doubled)],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), doubled)],
      assets.zero,
      e_fin,
    )
  True
}

/// UTxO proposal mang THÊM một tên token nữa cùng policy `governance` — beacon của
/// một proposal khác bị gộp vào. Hai vế số lượng đều thoả và value được bảo toàn;
/// chỉ vế đếm SỐ TÊN bác. Không có vế đó thì beacon thứ hai bị nhốt vĩnh viễn trong
/// một datum mang danh tính của proposal thứ nhất: `[PROPOSAL-CLOSE]` khoá UTxO lại
/// ngay sau lượt này, và Treasury thì đòi đúng một token nên không đọc lại được.
test fin_hai_ten_token_gov_cung_utxo_tu_choi() fail {
  let merged =
    assets.from_lovelace(2_000_000)
      |> assets.add(gov_policy, prop(), 1)
      |> assets.add(gov_policy, #"beef", 1)
  expect
    run_fin_full(
      pr_ok(),
      [prop_in_of(pr_ok(), merged)],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), merged)],
      assets.zero,
      e_fin,
    )
  True
}

/// Đúc thêm một token cùng policy trong lượt ghi kết quả.
test fin_duc_them_token_tu_choi() fail {
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero |> assets.add(gov_policy, #"beef", 1),
      e_fin,
    )
  True
}

/// Double satisfaction: HAI proposal cùng script trong một giao dịch, MỘT output.
/// `util.output_at_script` lấy output khớp đầu tiên, nên không đếm thì một output
/// hợp lệ thoả cho cả hai — và cả hai được ghi `Executed` bằng một tally.
test fin_hai_proposal_mot_output_tu_choi() fail {
  let second =
    util.mk_input(
      util.mk_ref(88),
      util.mk_output(util.script_address(gov_policy), proposal_value(), pr_ok()),
    )
  expect
    run_fin_full(
      pr_ok(),
      [prop_in(), second],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(result_of(Executed), proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

test fin_hai_output_tai_script_tu_choi() fail {
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [
        prop_out_of(result_of(Executed), proposal_value()),
        prop_out_of(result_of(Executed), proposal_value()),
      ],
      assets.zero,
      e_fin,
    )
  True
}

// ── (S9) các trường KHÔNG được đổi ──

/// `execute_after_epoch` bị dời SỚM lên ở lượt ghi kết quả ⇒ custody chi ngay.
test fin_doi_execute_after_tu_choi() fail {
  let pr_out =
    ProposalResult { ..result_of(Executed), execute_after_epoch: 0 }
  expect run_fin(td_pass(), pr_out)
  True
}

/// `released_cumulative` bị reset ⇒ chống-chi-vượt của custody mất mốc.
test fin_reset_released_cumulative_tu_choi() fail {
  let pr_out = ProposalResult { ..result_of(Executed), released_cumulative: 0 }
  expect
    run_fin_full(
      ProposalResult { ..pr_ok(), released_cumulative: 5 },
      [
        prop_in_of(
          ProposalResult { ..pr_ok(), released_cumulative: 5 },
          proposal_value(),
        ),
      ],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(pr_out, proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// `proposal_id` trong datum ra bị đổi ⇒ `release.read_proposal` của Treasury ép
/// `nft_name == result.proposal_id`, nên beacon sẽ mang một danh tính khác tên token.
test fin_doi_proposal_id_tu_choi() fail {
  let pr_out = ProposalResult { ..result_of(Executed), proposal_id: #"beef" }
  expect run_fin(td_pass(), pr_out)
  True
}

/// `spend_spec_hash` được ĐIỀN ở lượt ghi kết quả — đây là đường vòng quanh ràng
/// buộc tạm của `[SELF-DUP-CHOICE]` nếu chỉ ép nó ở Open.
test fin_dien_spend_spec_hash_tu_choi() fail {
  let pr_out =
    ProposalResult { ..result_of(Executed), spend_spec_hash: #"aabbcc" }
  expect run_fin(td_pass(), pr_out)
  True
}

/// Và cả khi datum VÀO đã mang `spend_spec_hash` khác rỗng (giữ nguyên, không đổi):
/// vế `== #""` vẫn bác. Ca này phân biệt "ép giữ nguyên" với "ép rỗng".
test fin_spend_spec_hash_vao_khong_rong_tu_choi() fail {
  let pr_in = ProposalResult { ..pr_ok(), spend_spec_hash: #"aabbcc" }
  let pr_out = ProposalResult { ..pr_in, status: Executed }
  expect
    run_fin_full(
      pr_in,
      [prop_in_of(pr_in, proposal_value())],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(pr_out, proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// Chiều ngược lại: datum VÀO mang `spend_spec_hash` khác rỗng, datum RA XOÁ nó về
/// rỗng. Vế `== #""` thoả, chỉ vế ghim "bằng đúng giá trị vào" bác. Hai vế đó không
/// thay nhau được: thiếu vế ghim thì lượt ghi kết quả XOÁ được cam kết chi tiêu của
/// proposal, và bên ngoài đọc beacon sẽ thấy một `Executed` không ràng buộc chi gì.
test fin_xoa_spend_spec_hash_tu_choi() fail {
  let pr_in = ProposalResult { ..pr_ok(), spend_spec_hash: #"aabbcc" }
  let pr_out =
    ProposalResult { ..pr_in, status: Executed, spend_spec_hash: #"" }
  expect
    run_fin_full(
      pr_in,
      [prop_in_of(pr_in, proposal_value())],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [prop_out_of(pr_out, proposal_value())],
      assets.zero,
      e_fin,
    )
  True
}

/// Datum ra không phải `ProposalResult` (Treasury sẽ không giải mã được beacon).
test fin_datum_ra_sai_kieu_tu_choi() fail {
  let out =
    util.mk_output(util.script_address(gov_policy), proposal_value(), 0)
  expect
    run_fin_full(
      pr_ok(),
      [prop_in()],
      [tally_ref_input(td_pass()), wp_ref_input_ok()],
      [out],
      assets.zero,
      e_fin,
    )
  True
}

test open_tally_weight_param_ref_lech_redeemer_tu_choi() fail {
  let ts =
    TallyDatum {
      ..ts_ok(),
      weight_param_ref: OutputReference {
        transaction_id: #"dd",
        output_index: 0,
      },
    }
  expect run([p_out_of(pr_ok()), t_out_of(ts)])
  True
}
