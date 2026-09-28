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
use magiclamp/governance/types.{
  Clamped, Executed, Open, ProposalResult, Summing, TallyDatum, TopEntry, Yes,
}
use magiclamp/governance/util

pub type GovernanceRedeemer {
  OpenProposal {
    seed: OutputReference,
    vote_open_epoch: Int,
    vote_close_epoch: Int,
    weight_param_ref: OutputReference,
  }
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
