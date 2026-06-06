// Validator tests cho nhánh RELEASE (Model A — chi qua cổng Governance, đọc beacon
// ProposalResult qua reference input). Phủ (TECH §7 bảng test):
//   release_happy            rút đúng bucket, proposal Executed, NFT đúng, time-lock OK   → pass
//   release_batch_multi      2 draw khác (to,asset), value+sổ giảm đúng                   → pass
//   release_not_executed     status=Tallied (chưa Executed)                              → fail (C-REL-2)
//   release_no_proposal      thiếu reference input proposal                               → fail (C-REL-1)
//   release_fake_nft         proposal ref không mang NFT đúng policy                       → fail (C-REL-1)
//   release_spec_mismatch    spend_spec_hash lệch (draws ≠ điều duyệt)                     → fail (C-REL-3)
//   release_before_timelock  epoch < execute_after_epoch                                  → fail (C-REL-8)
//   release_overdraw_bucket  rút > số dư bucket                                            → fail (C-REL-6)
//   release_value_tamper     sổ giảm đúng nhưng custody value rút ÍT hơn (giữ lén)        → fail (C-REL-5)
//   release_drain_ada        LAMP đúng nhưng rút lén ADA                                   → fail (C-REL-5)
//   release_double_sat       2 draw cùng (to,asset), chỉ 1 output thỏa 1 phần            → fail (C-REL-7)
//   release_recipient_missing không có output tới `to`                                     → fail (C-REL-7)
//   release_to_custody       to == chính custody (rút vòng về kho né)                      → fail (C-REL-7)
//   release_double_custody   2 custody UTxO (double-satisfaction)                          → fail (C-REL-4)
//   release_mint_rejected    tx có mint khác zero                                          → fail (C-REL-10)

use aiken/interval
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use custody
use magiclamp/treasury/release
use magiclamp/treasury/types.{
  AssetKey, CustodyDatum, Executed, LedgerEntry, ProposalResult, ProposalStatus,
  Release, ReleaseDraw, Tallied,
}
use magiclamp/treasury/util

// ── Hằng số ──
const cust_sh: ByteArray = #"c0c0c0c0"

const prop_policy: assets.PolicyId = #"9a9a"

// proposal_id của beacon dùng xuyên suốt test (single-use marker C-REL-9).
const prop_id: ByteArray = #"0001"

const gov_sh: ByteArray = #"9999"

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

const bucket_ops: Int = 1

const bucket_community: Int = 2

// Cardano epoch = 5 ngày = 432_000_000 ms.
const ms_per_epoch: Int = 432_000_000

// Người nhận (ví thường).
const alice: ByteArray = #"a11ce0"

const bob: ByteArray = #"b0b0"

fn accepted() -> List<AssetKey> {
  [
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn datum(ledger: List<LedgerEntry>) -> CustodyDatum {
  CustodyDatum {
    instance_id: #"abcd",
    accepted_assets: accepted(),
    ledger: ledger,
    cut_bps: 1000,
    governance_ref: gov_sh,
    epoch: 10,
    consumed_proposals: [],
  }
}

fn lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

// draw LAMP tới `to` từ bucket.
fn draw_lamp(bucket: Int, amount: Int, to: ByteArray) -> ReleaseDraw {
  ReleaseDraw {
    bucket_id: bucket,
    policy: lamp_policy,
    name: lamp_name,
    amount: amount,
    to: util.vk_address(to),
  }
}

// Proposal beacon UTxO (reference input): mang NFT prop_policy + ProposalResult datum.
fn proposal_input(
  status              : ProposalStatus,
  spec_hash           : ByteArray,
  execute_after_epoch : Int,
) -> Input {
  let result =
    ProposalResult {
      proposal_id: prop_id,
      status: status,
      spend_spec_hash: spec_hash,
      execute_after_epoch: execute_after_epoch,
      released_cumulative: 0,
    }
  // proposal UTxO ở script Governance + mang đúng 1 NFT one-shot.
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  let out = util.mk_output(util.script_address(gov_sh), val, result)
  util.mk_input(util.mk_ref(7), out)
}

// proposal_ref khớp proposal_input (mk_ref(7)).
fn prop_ref() -> OutputReference {
  util.mk_ref(7)
}

// Dựng tx release tổng quát.
fn release_tx(
  in_val      : assets.Value,
  out_val     : assets.Value,
  ledger_in   : List<LedgerEntry>,
  ledger_out  : List<LedgerEntry>,
  ref_inputs  : List<Input>,
  recipients  : List<Output>,
  lower_ms    : Int,
  extra_custody: List<Input>,
  mint        : assets.Value,
) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, in_val, datum(ledger_in)))
  // C-REL-9: out_datum append proposal_id (prop_id) lên consumed_proposals_in ([]).
  // Mặc định in=[] ⇒ out=[prop_id]; test replay override d_in để ép fail.
  let d_out =
    CustodyDatum {
      ..datum(ledger_out),
      ledger: ledger_out,
      epoch: 11,
      consumed_proposals: [prop_id],
    }
  let cust_out = util.mk_output(cust_addr, out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: [cust_in, ..extra_custody],
    reference_inputs: ref_inputs,
    outputs: [cust_out, ..recipients],
    mint: mint,
    validity_range: interval.after(lower_ms),
  }
}

fn run(tx: Transaction, d_in: CustodyDatum, draws: List<ReleaseDraw>) -> Bool {
  custody.custody.spend(
    prop_policy,
    ms_per_epoch,
    Some(d_in),
    Release { proposal_ref: prop_ref(), draws },
    util.mk_ref(0),
    tx,
  )
}

// recipient output gửi LAMP tới ví `to`.
fn pay(to: ByteArray, lamp: Int) -> Output {
  util.mk_output_no_datum(util.vk_address(to), lamp_val(2_000_000, lamp))
}

// ════════════════════════════════════════════════════════════
// 1. RELEASE ĐÚNG (pass)
//    bucket_ops LAMP 1000 → rút 300 tới alice. custody LAMP 5000→4700.
//    sổ ops 1000→700. proposal Executed, spec khớp, epoch 5 ≥ execute_after 4.
// ════════════════════════════════════════════════════════════
fn happy_draws() -> List<ReleaseDraw> {
  [draw_lamp(bucket_ops, 300, alice)]
}

test release_happy() {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4700),
      ledger_in,
      ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch,
      [],
      assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// 2 draw khác (to,asset): ops→alice 300 LAMP, community→bob 500 LAMP. custody −800.
test release_batch_multi() {
  let ledger_in =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 800 },
    ]
  let ledger_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 300 },
    ]
  let draws = [draw_lamp(bucket_ops, 300, alice), draw_lamp(bucket_community, 500, bob)]
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4200),
      ledger_in,
      ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300), pay(bob, 500)],
      5 * ms_per_epoch,
      [],
      assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 2. CHƯA EXECUTED (fail) — status=Tallied → C-REL-2.
// ════════════════════════════════════════════════════════════
test release_not_executed() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Tallied, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 3. THIẾU PROPOSAL (fail) — không có reference input → C-REL-1.
// ════════════════════════════════════════════════════════════
test release_no_proposal() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 4. NFT GIẢ (fail) — proposal ref KHÔNG mang NFT prop_policy → C-REL-1.
// ════════════════════════════════════════════════════════════
test release_fake_nft() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let result =
    ProposalResult {
      proposal_id: prop_id, status: Executed, spend_spec_hash: spec,
      execute_after_epoch: 4, released_cumulative: 0,
    }
  // proposal UTxO KHÔNG có NFT prop_policy (chỉ ADA) → read_proposal reject.
  let bad_prop =
    util.mk_input(util.mk_ref(7), util.mk_output(util.script_address(gov_sh), assets.from_lovelace(2_000_000), result))
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [bad_prop],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 5. SPEC HASH LỆCH (fail) — draws thực tế ≠ điều duyệt → C-REL-3.
//    proposal cam kết spec của draw 300; nhưng rút 500 (hash khác).
// ════════════════════════════════════════════════════════════
test release_spec_mismatch() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 500 }]
  // proposal duyệt draw 300 (spec của 300); caller rút 500.
  let approved = [draw_lamp(bucket_ops, 300, alice)]
  let spec = release.spend_spec_hash(approved)
  let actual = [draw_lamp(bucket_ops, 500, alice)]
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4500),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 500)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), actual)
}

// ════════════════════════════════════════════════════════════
// 6. TRƯỚC TIME-LOCK (fail) — epoch hiện tại 3 < execute_after 4 → C-REL-8.
// ════════════════════════════════════════════════════════════
test release_before_timelock() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
      3 * ms_per_epoch,
      [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 7. RÚT QUÁ BUCKET (fail) — bucket ops chỉ có 200 nhưng rút 300 → C-REL-6.
// ════════════════════════════════════════════════════════════
test release_overdraw_bucket() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 200 }]
  // sổ ra = 200 − 300 = −100 (over-draw) — draws_within_balance + each_out_line_ok fail.
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: -100 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 8. PHÁ VALUE (fail) — sổ giảm đúng 300 nhưng custody chỉ ra 100 (giữ lén 200) → C-REL-5.
// ════════════════════════════════════════════════════════════
test release_value_tamper() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  // custody LAMP 5000→4900 (chỉ −100) thay vì −300 → value_ok fail.
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4900),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 9. DRAIN ADA (fail) — LAMP −300 đúng nhưng rút lén ADA 5M→2M → C-REL-5.
// ════════════════════════════════════════════════════════════
test release_drain_ada() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(2_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 10. DOUBLE-SATISFACTION người nhận (fail) — 2 draw cùng (alice,LAMP) tổng 600,
//     nhưng chỉ 1 output 300 tới alice (thiếu). C-REL-7 tổng-khớp fail.
//     (Đồng thời value rời custody chỉ −600 nếu cố đặt; ở đây ta cố ý chỉ trả 300.)
// ════════════════════════════════════════════════════════════
test release_double_sat() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 400 }]
  // 2 draw cùng (alice, LAMP): 300 + 300 = 600 rút khỏi sổ ops.
  let draws = [draw_lamp(bucket_ops, 300, alice), draw_lamp(bucket_ops, 300, alice)]
  let spec = release.spend_spec_hash(draws)
  // custody −600 (value_ok pass) NHƯNG chỉ 1 output 300 tới alice → Σ output(300) < Σ draw(600).
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4400),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 11. THIẾU OUTPUT NGƯỜI NHẬN (fail) — không có output tới alice → C-REL-7.
//     value rời custody −300 đúng nhưng "rời" đi đâu? (ở đây cố tình gửi tới bob).
// ════════════════════════════════════════════════════════════
test release_recipient_missing() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  // output gửi bob (sai recipient) thay vì alice → Σ output tới alice = 0 < 300.
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(bob, 300)],
      5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 12. TO == CUSTODY (fail) — draw.to trỏ về chính custody (rút vòng né C-REL-5) → C-REL-7.
// ════════════════════════════════════════════════════════════
test release_to_custody() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let bad_draw =
    ReleaseDraw {
      bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 300,
      to: util.script_address(cust_sh),
    }
  let draws = [bad_draw]
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 13. HAI CUSTODY (fail) — 2 custody input khác stake cred → C-REL-4.
// ════════════════════════════════════════════════════════════
test release_double_custody() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let cust_addr2 = util.script_address_staked(cust_sh, #"5742")
  let extra =
    util.mk_input(util.mk_ref(9), util.mk_output(cust_addr2, lamp_val(5_000_000, 9999), datum(ledger_in)))
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch,
      [extra],
      assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 14. MINT/BURN (fail) — tx có mint khác zero → C-REL-10 (LAMP fixed-supply).
// ════════════════════════════════════════════════════════════
test release_mint_rejected() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch, [],
      assets.from_asset(lamp_policy, lamp_name, -300),
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 15. REPLAY PROPOSAL (fail) — HARD BLOCKER finding 7 / C-REL-9.
//   Cùng MỘT proposal Executed dùng cho tx Release THỨ HAI: custody input đã có
//   prop_id trong consumed_proposals (tx1 đã ghi). proposal_is_fresh fail → chống
//   chi vượt ngưỡng duyệt (két KHÓA tổng, không chỉ số dư bucket). Đây là kịch bản
//   "ops 300 → rút 300×N" mà audit nêu: tx2 PHẢI fail.
//
//   Mô phỏng tx2: ledger custody còn 700 (sau tx1 1000→700), kẻ tấn công thử rút
//   thêm 300 (700→400) bằng CÙNG proposal. Validator thấy prop_id ∈ consumed_in → fail.
// ════════════════════════════════════════════════════════════
fn datum_consumed(ledger: List<LedgerEntry>, consumed: List<ByteArray>) -> CustodyDatum {
  CustodyDatum { ..datum(ledger), consumed_proposals: consumed }
}

// Dựng tx replay: d_out append prop_id thêm lần nữa lên in=[prop_id] ⇒ [prop_id, prop_id].
fn replay_tx(
  in_val     : assets.Value,
  out_val    : assets.Value,
  ledger_in  : List<LedgerEntry>,
  ledger_out : List<LedgerEntry>,
  ref_inputs : List<Input>,
  recipients : List<Output>,
) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let d_in = datum_consumed(ledger_in, [prop_id])
  let cust_in = util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, in_val, d_in))
  // out append đúng quy tắc [prop_id, ..in] = [prop_id, prop_id] (để cô lập đúng
  // nguyên nhân fail = proposal_is_fresh, KHÔNG phải consumed_appended_ok).
  let d_out =
    CustodyDatum {
      ..datum(ledger_out),
      ledger: ledger_out,
      epoch: 11,
      consumed_proposals: [prop_id, prop_id],
    }
  let cust_out = util.mk_output(cust_addr, out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: [cust_in],
    reference_inputs: ref_inputs,
    outputs: [cust_out, ..recipients],
    mint: assets.zero,
    validity_range: interval.after(5 * ms_per_epoch),
  }
}

test release_replay_same_proposal() fail {
  // tx2: bucket ops 700 (sau tx1), rút thêm 300 → 400. Mọi check value/ledger/spec
  // ĐỀU khớp (draws giống tx1, custody còn dư) — CHỈ C-REL-9 chặn (single-use).
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 400 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    replay_tx(
      lamp_val(5_000_000, 4700), lamp_val(5_000_000, 4400),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
    )
  // d_in mang prop_id đã chi ⇒ proposal_is_fresh fail.
  run(tx, datum_consumed(ledger_in, [prop_id]), draws)
}

// ════════════════════════════════════════════════════════════
// 16. STRIP MARKER (fail) — C-REL-9 consumed_appended_ok.
//   tx1 hợp lệ nhưng out_datum KHÔNG append prop_id (giữ consumed=[]) để "quên"
//   proposal đã dùng → mở đường replay vòng sau. consumed_appended_ok phải fail.
// ════════════════════════════════════════════════════════════
test release_strip_marker() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  // out_datum cố tình KHÔNG append prop_id (consumed=[]) → consumed_appended_ok fail.
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11, consumed_proposals: [] }
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 4700), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4)],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: interval.after(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 17. DATUM RỖNG (fail) — custody spend không datum → expect Some(datum) fail.
// ════════════════════════════════════════════════════════════
test release_missing_datum() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  custody.custody.spend(
    prop_policy, ms_per_epoch, None,
    Release { proposal_ref: prop_ref(), draws }, util.mk_ref(0), tx,
  )
}

// ════════════════════════════════════════════════════════════
// 18. ĐỔI PARAM DATUM trong RELEASE (fail) — governance_ref bị đổi ở output.
//     Release ép params instance bảo toàn (mirror C-COL-2). Collect đã test, Release CHƯA.
// ════════════════════════════════════════════════════════════
test release_param_tamper() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  // governance_ref đổi 9999→dead (chiếm quyền cổng release sau này) → params bảo toàn fail.
  let d_out =
    CustodyDatum {
      ..datum(ledger_out), ledger: ledger_out, epoch: 11,
      governance_ref: #"dead", consumed_proposals: [prop_id],
    }
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 4700), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4)],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: interval.after(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 19. DRAW ÂM (fail) — amount = −300 (bơm sổ ngược / value bất nhất).
//     all_draws_nonneg chặn rút âm. spec_hash khớp (đúng draws âm) nên không lọt qua C-REL-3;
//     chỉ all_draws_nonneg trong ledger_ok chặn. Đồng thời ép phơi sai số sổ/value.
// ════════════════════════════════════════════════════════════
test release_negative_draw() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  // draw −300 ⇒ each_out_line_ok kỳ vọng out = 1000 − (−300) = 1300; ta đặt 1300 để cô lập
  // all_draws_nonneg là nguyên nhân fail duy nhất (không lẫn each_out_line_ok).
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1300 }]
  let neg = [draw_lamp(bucket_ops, -300, alice)]
  let spec = release.spend_spec_hash(neg)
  // value_ok: out = in − (−300) = in + 300 ⇒ custody 5000→5300 (cô lập all_draws_nonneg).
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5300),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 0)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), neg)
}

// ════════════════════════════════════════════════════════════
// 20. KHÔNG OUTPUT CUSTODY (fail) — Release drain toàn bộ kho, không trả về script.
//     count_outputs_at_script == 0 ⇒ C-REL-4 fail.
// ════════════════════════════════════════════════════════════
test release_no_custody_output() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  // KHÔNG output custody — toàn bộ value đi ra ví thường.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4)],
      outputs: [pay(alice, 300), util.mk_output_no_datum(util.vk_address(bob), lamp_val(5_000_000, 4700))],
      mint: assets.zero,
      validity_range: interval.after(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 21. APPEND XÓA ID CŨ (fail) — C-REL-9 consumed_appended_ok.
// [P1 FOLLOW-UP — tạm gỡ 2026-06-05] Bản test này (custody_in consumed=[#"old"],
// out_datum quên #"old") khiến aiken v1.1.21 PANIC compiler (nuốt lỗi khi không TTY),
// làm cả module Treasury không biên dịch. Cần dựng lại tx tối giản kiểu test 18 rồi
// khôi phục. Bất biến consumed_appended_ok vẫn được phủ gián tiếp bởi replay test khác.
// ════════════════════════════════════════════════════════════
