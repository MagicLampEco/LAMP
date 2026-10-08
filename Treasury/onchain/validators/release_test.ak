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
//  ── HARDENING v1.1 (6 lỗ audit) ──
//   release_proposal_id_name_mismatch  NFT name ≠ ProposalResult.proposal_id              → fail (F1)
//   release_empty_draws                draws=[] (spec của [] khớp nhưng draws!=[] chặn)    → fail (F2)
//   release_wrong_instance_id          proposal.spec_hash tính cho instance_id KHÁC        → fail (F10/#1B)
//   release_epoch_unbounded            validity_range upper = +∞ (interval.after)          → fail (F4)
//  ── CONTRACT §17 (recipient-gross-sum) ──
//   release_recreated_recipient_utxo_rejected   UTxO tại `to` tiêu+tái tạo, phần rút đi ví khác → fail (C-REL-7 ròng)
//   release_recreated_recipient_other_stake_rejected  như trên, input ở stake khác            → fail (C-REL-7 theo credential)
//   release_script_recipient_fresh_ok / _topup_ok / release_vk_recipient_own_ada_input_ok      → pass
//   release_two_instances_one_output_*         hai kho khác hash, một output 300 cho cả hai  → fail (C-REL-SOLE)
//   release_with_other_script_spend_rejected   ròng đủ nhưng có script Plutus thứ hai chạy   → fail (C-REL-SOLE)

use aiken/interval
use cardano/assets
use cardano/transaction.{
  Input, Output, OutputReference, ScriptPurpose, Spend, Transaction, placeholder,
}
use custody
use magiclamp/treasury/pointer
use magiclamp/treasury/release
use magiclamp/treasury/types.{
  AssetKey, CustodyDatum, Executed, LedgerEntry, PointerDatum, ProposalResult,
  ProposalStatus, Release, ReleaseDraw, Tallied,
}
use magiclamp/treasury/util
use magiclamp/treasury/window_origin_fixtures

// ── Hằng số ──
const cust_sh: ByteArray = #"c0c0c0c0"

// GovernancePointer v0.1: policy proposal NFT == script hash governance (`g`), đọc từ con trỏ.
const prop_policy: assets.PolicyId =
  #"99999999999999999999999999999999999999999999999999999999"

// Policy (== script hash) NFT con trỏ governance; `CustodyDatum.governance_ref` mang giá trị này.
const ptr_policy: assets.PolicyId =
  #"70707070707070707070707070707070707070707070707070707070"

// C-NFT: policy authenticity NFT custody (custody_seed mint one-shot).
const seed_policy: assets.PolicyId = #"5eed"

// instance_id của custody (NFT name = instance_id) — khớp datum.instance_id (#"abcd").
const instance_id: ByteArray = #"abcd"

// proposal_id của beacon dùng xuyên suốt test (single-use marker C-REL-9).
const prop_id: ByteArray = #"0001"

// Script hash governance hiện hành (28 byte) — nằm trong PointerDatum.governance_hash.
const gov_sh: ByteArray =
  #"99999999999999999999999999999999999999999999999999999999"

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
    instance_id: instance_id,
    accepted_assets: accepted(),
    ledger: ledger,
    cut_bps: 1000,
    governance_ref: ptr_policy,
    // C-EPOCH: in.epoch THẤP (3) để cur (lower_ms/ms) ≥ in.epoch trong mọi happy + cô lập
    // before_timelock (cur=3 ≥ in.epoch=3 nhưng < execute_after=4).
    epoch: 3,
    consumed_proposals: [],
    // `Release` không đọc `buckets` (nó rút theo `draw.bucket_id` đã có dòng sổ); trường
    // này ở đây để C-BUCKETS-KEEP có cái mà ghim.
    buckets: [bucket_ops, bucket_community],
  }
}

fn lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

// C-NFT: gắn authenticity NFT (seed_policy, instance_id) qty 1 vào MỌI value custody in/out.
fn with_nft(value: assets.Value) -> assets.Value {
  assets.add(value, seed_policy, instance_id, 1)
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

// ── NFT con trỏ governance (GovernancePointer v0.1) ──
// UTxO con trỏ (reference input): NFT (policy, GOVPOINTER) ở Script(addr_hash), datum trỏ `g`.
fn pointer_datum(g: ByteArray) -> PointerDatum {
  PointerDatum {
    governance_hash: g,
    committee: [#"c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00"],
    threshold: 1,
    sealed: False,
    pending: None,
  }
}

fn pointer_input_custom(policy: ByteArray, addr_hash: ByteArray, g: ByteArray) -> Input {
  let val =
    assets.from_lovelace(2_000_000)
      |> assets.add(policy, pointer.pointer_name, 1)
  util.mk_input(
    util.mk_ref(9),
    util.mk_output(util.script_address(addr_hash), val, pointer_datum(g)),
  )
}

// Con trỏ thật, trỏ governance hiện hành gov_sh.
fn pointer_input() -> Input {
  pointer_input_custom(ptr_policy, ptr_policy, gov_sh)
}

// F4: get_epoch_bounded ÉP validity_range hữu hạn + lower&upper CÙNG epoch. Helper dựng
// interval GỌN trong 1 epoch: lo = lower_ms, hi = lo + ms_per_epoch − 1 (cùng epoch).
fn epoch_range(lower_ms: Int) -> interval.Interval {
  interval.between(lower_ms, lower_ms + ms_per_epoch - 1)
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
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(in_val), datum(ledger_in)))
  // C-REL-9: out_datum append proposal_id (prop_id) lên consumed_proposals_in ([]).
  // Mặc định in=[] ⇒ out=[prop_id]; test replay override d_in để ép fail.
  // C-EPOCH: out_datum.epoch NEO == cur = ⌊lower_ms / ms_per_epoch⌋ (= get_epoch(tx)).
  let d_out =
    CustodyDatum {
      ..datum(ledger_out),
      ledger: ledger_out,
      epoch: lower_ms / ms_per_epoch,
      consumed_proposals: [prop_id],
    }
  let cust_out = util.mk_output(cust_addr, with_nft(out_val), d_out)
  Transaction {
    ..placeholder,
    inputs: [cust_in, ..extra_custody],
    reference_inputs: [pointer_input(), ..ref_inputs],
    outputs: [cust_out, ..recipients],
    mint: mint,
    validity_range: epoch_range(lower_ms),
  }
}

fn run(tx: Transaction, d_in: CustodyDatum, draws: List<ReleaseDraw>) -> Bool {
  // Interface: spend(proposal_policy, seed_policy, ms_per_epoch, lamp_policy, token_name,
  //                  datum, redeemer, ref, tx). Release KHÔNG đụng 2 param cuối (chỉ
  //                  MigrateIn dùng) — truyền giá trị thật cho nhất quán fixture.
  custody.custody.spend(
    ptr_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    0,
    Some(d_in),
    Release { proposal_ref: prop_ref(), draws },
    util.mk_ref(0),
    tx,
  )
}

// ── Gốc cửa sổ (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-1..3) ─────────────────
// Bản của `run` nhận gốc `origin` và dời mọi biên hữu hạn của validity range đi
// `shift`. `(o, o)`: cùng kịch bản dời sang lưới có gốc ⇒ kết quả phải y như bản gốc 0.
// `(0, o)`: validator QUÊN gốc trên tx đã dời ⇒ phải bị chặn.
fn run_at(origin: Int, shift: Int, tx: Transaction, d_in: CustodyDatum, draws: List<ReleaseDraw>) -> Bool {
  // Interface: spend(proposal_policy, seed_policy, ms_per_epoch, lamp_policy, token_name,
  //                  datum, redeemer, ref, tx). Release KHÔNG đụng 2 param cuối (chỉ
  //                  MigrateIn dùng) — truyền giá trị thật cho nhất quán fixture.
  custody.custody.spend(
    ptr_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    origin,
    Some(d_in),
    Release { proposal_ref: prop_ref(), draws },
    util.mk_ref(0),
    window_origin_fixtures.shift_tx(tx, shift),
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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

// ════════════════════════════════════════════════════════════
// 1-bis. ĐƯỜNG CHI CỦA GOVERNANCE PHA 1/2 ĐANG ĐÓNG — đo, không mô tả.
//
// `Governance/SPEC.md` §v2.10 `[GOV-FINALIZE-BRANCH]` khai: Pha 1/2 ép
// `spend_spec_hash == #""` ở CẢ HAI cửa (`OpenProposal` và `FinalizeProposal`), nên
// "mọi lượt `Release` bị từ chối". Câu đó tựa vào MỘT tính chất của Treasury —
// `release.spend_spec_hash` không bao giờ băm ra chuỗi rỗng — và tính chất đó trước
// nay không có ca nào đo. Thiếu ca này thì lời khẳng định "đường chi đã đóng độc lập"
// chỉ là một dòng trong tài liệu, và tài liệu không chặn được gì.
//
// Ca KHÁC `release_happy` ĐÚNG MỘT trường: `spend_spec_hash` của proposal là `#""`
// thay vì `spec`. Mọi vế đi TRƯỚC C-REL-3 đều thoả — `draws != []` (C-REL-13),
// `read_proposal` đọc được beacon (C-REL-1), `status == Executed` (C-REL-2) — nên ca
// đỏ ở đúng C-REL-3 (`custody.ak` ▸ nhánh `Release`).
// ════════════════════════════════════════════════════════════
test release_spec_hash_rong_tu_choi() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4700),
      ledger_in,
      ledger_out,
      // proposal Executed, mọi thứ hợp lệ, `spend_spec_hash` = chuỗi RỖNG.
      [proposal_input(Executed, #"", 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch,
      [],
      assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

/// Tiền đề của ca trên, ghim riêng: `release.spend_spec_hash` là `blake2b_256` ⇒ 32
/// byte ⇒ KHÔNG BAO GIỜ bằng `#""`, kể cả với danh sách chi rỗng. Không có vế này thì
/// ca trên chỉ nói "một giá trị cụ thể không khớp", không nói "chuỗi rỗng là bất khả".
test release_spec_hash_khong_bao_gio_rong() {
  and {
    release.spend_spec_hash(seed_policy, instance_id, happy_draws()) != #"",
    release.spend_spec_hash(seed_policy, instance_id, []) != #"",
  }
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, approved)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let cust_in = util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(in_val), d_in))
  // out append đúng quy tắc [prop_id, ..in] = [prop_id, prop_id] (để cô lập đúng
  // nguyên nhân fail = proposal_is_fresh, KHÔNG phải consumed_appended_ok).
  // C-EPOCH: out.epoch = cur = 5 (lower_ms = 5×ms) ≥ in.epoch (3) — qua neo, cô lập C-REL-9.
  let d_out =
    CustodyDatum {
      ..datum(ledger_out),
      ledger: ledger_out,
      epoch: 5,
      consumed_proposals: [prop_id, prop_id],
    }
  let cust_out = util.mk_output(cust_addr, with_nft(out_val), d_out)
  Transaction {
    ..placeholder,
    inputs: [cust_in],
    reference_inputs: [pointer_input(), ..ref_inputs],
    outputs: [cust_out, ..recipients],
    mint: assets.zero,
    validity_range: epoch_range(5 * ms_per_epoch),
  }
}

test release_replay_same_proposal() fail {
  // tx2: bucket ops 700 (sau tx1), rút thêm 300 → 400. Mọi check value/ledger/spec
  // ĐỀU khớp (draws giống tx1, custody còn dư) — CHỈ C-REL-9 chặn (single-use).
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 400 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  // out_datum cố tình KHÔNG append prop_id (consumed=[]) → consumed_appended_ok fail.
  // epoch neo cur=5 để qua C-EPOCH, cô lập C-REL-9.
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [] }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 4700)), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  custody.custody.spend(
    ptr_policy, seed_policy, ms_per_epoch, lamp_policy, lamp_name, 0, None,
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  // governance_ref đổi 9999→dead (chiếm quyền cổng release sau này) → params bảo toàn fail.
  let d_out =
    CustodyDatum {
      ..datum(ledger_out), ledger: ledger_out, epoch: 5,
      governance_ref: #"dead", consumed_proposals: [prop_id],
    }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 4700)), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 18b. ĐỔI `buckets` trong RELEASE (fail) — C-BUCKETS-KEEP.
//     `Release` KHÔNG đọc `buckets` (nó rút theo `draw.bucket_id`), nên đây là nhánh mà vế
//     này dễ bị coi là dư nhất. Nó không dư: một proposal đã duyệt chỉ cam kết ai/bao nhiêu
//     (`spend_spec_hash` khoá `draws`), KHÔNG cam kết gì về `buckets`. Thiếu vế này thì mọi
//     lượt chi hợp lệ là một lượt được phép nới danh sách category, và lượt `Collect` sau đó
//     tự nó hợp lệ hoàn toàn nên không có chỗ nào để bắt.
//     Đổi ĐÚNG MỘT THỨ so với bài dương: `buckets` [1,2] → [1,2,3].
// ════════════════════════════════════════════════════════════
test release_reject_buckets_mutated() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out =
    CustodyDatum {
      ..datum(ledger_out), ledger: ledger_out, epoch: 5,
      consumed_proposals: [prop_id],
      buckets: [bucket_ops, bucket_community, 3],
    }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 4700)), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, neg)
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
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  // KHÔNG output custody — toàn bộ value đi ra ví thường.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [pay(alice, 300), util.mk_output_no_datum(util.vk_address(bob), lamp_val(5_000_000, 4700))],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
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

// ════════════════════════════════════════════════════════════
// ── HARDENING v1: test đối kháng MỚI (C-REL-1 #1A, C-NFT, C-EPOCH, PRUNE) ──
// ════════════════════════════════════════════════════════════

// Proposal beacon Ở ĐỊA CHỈ SCRIPT KHÁC governance_ref (mọi cờ khác đúng).
fn proposal_input_at(
  script_hash         : ByteArray,
  status              : ProposalStatus,
  spec_hash           : ByteArray,
  execute_after_epoch : Int,
) -> Input {
  let result =
    ProposalResult {
      proposal_id: prop_id, status: status, spend_spec_hash: spec_hash,
      execute_after_epoch: execute_after_epoch, released_cumulative: 0,
    }
  let val = assets.from_lovelace(2_000_000) |> assets.add(prop_policy, #"0001", 1)
  let out = util.mk_output(util.script_address(script_hash), val, result)
  util.mk_input(util.mk_ref(7), out)
}

// ════════════════════════════════════════════════════════════
// 22. PROPOSAL Ở SAI ĐỊA CHỈ GOVERNANCE (fail) — C-REL-1 #1A.
//     Proposal beacon đặt ở script hash #"dead" ≠ datum.governance_ref (gov_sh).
//     read_proposal ÉP payment_credential == Script(governance_ref) → expect ph == gov fail.
//     Chống NFT proposal bị dời sang UTxO datum giả ở script lạ / replay chéo instance.
// ════════════════════════════════════════════════════════════
test release_proposal_wrong_governance_addr() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      // proposal ở script #"dead" (≠ gov_sh) — mọi cờ khác (status/spec/NFT/epoch) đúng.
      [proposal_input_at(#"dead", Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ── Builder tx release điều khiển NFT custody (name + có/không) + epoch ──
fn release_tx_nft(
  cust_in_val  : assets.Value,   // value đầy đủ (gồm/không NFT) — KHÔNG tự thêm
  cust_out_val : assets.Value,
  ledger_in    : List<LedgerEntry>,
  ledger_out   : List<LedgerEntry>,
  out_epoch    : Int,
  lower_ms     : Int,
  ref_inputs   : List<Input>,
  recipients   : List<Output>,
) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, cust_in_val, datum(ledger_in)))
  let d_out =
    CustodyDatum {
      ..datum(ledger_out), ledger: ledger_out, epoch: out_epoch,
      consumed_proposals: [prop_id],
    }
  let cust_out = util.mk_output(cust_addr, cust_out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: [cust_in],
    reference_inputs: [pointer_input(), ..ref_inputs],
    outputs: [cust_out, ..recipients],
    mint: assets.zero,
    validity_range: epoch_range(lower_ms),
  }
}

// ════════════════════════════════════════════════════════════
// 23. C-NFT — cust_in KHÔNG mang NFT authenticity (seed_policy, instance_id) → fail.
//     quantity_of(cust_in.value, seed_policy, instance_id) == 1 fail.
// ════════════════════════════════════════════════════════════
test release_custody_missing_seed_nft() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx_nft(
      lamp_val(5_000_000, 5000),               // cust_in KHÔNG NFT
      with_nft(lamp_val(5_000_000, 4700)),     // cust_out có NFT (cô lập cust_in)
      ledger_in, ledger_out, 5, 5 * ms_per_epoch,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 24. C-NFT — NFT name ≠ instance_id (cust mang (seed_policy, #"ffff") thay vì abcd).
//     quantity_of(value, seed_policy, instance_id) == 0 ≠ 1 → fail.
// ════════════════════════════════════════════════════════════
test release_custody_nft_wrong_name() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  // NFT name SAI (#"ffff") ở cả in & out → quantity_of theo instance_id (#"abcd") == 0.
  let wrong_in = assets.add(lamp_val(5_000_000, 5000), seed_policy, #"ffff", 1)
  let wrong_out = assets.add(lamp_val(5_000_000, 4700), seed_policy, #"ffff", 1)
  let tx =
    release_tx_nft(
      wrong_in, wrong_out, ledger_in, ledger_out, 5, 5 * ms_per_epoch,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 25. C-EPOCH — out.epoch KHÔNG neo cur (out.epoch ≠ get_epoch(tx)) dù cur ≥ in.epoch.
//     cur = 6 (lower_ms = 6×ms), out_datum.epoch = 5 (≠ 6), in.epoch = 3 → chỉ
//     `out.epoch == cur` chặn.
// ════════════════════════════════════════════════════════════
test release_epoch_not_anchored() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx_nft(
      with_nft(lamp_val(5_000_000, 5000)),
      with_nft(lamp_val(5_000_000, 4700)),
      ledger_in, ledger_out,
      5,                    // out_datum.epoch = 5
      6 * ms_per_epoch,     // cur = 6 ≠ 5
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 300)],
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 26. PRUNE — draw rút CẠN bucket (700 → 0): out PHẢI BỎ dòng đó (không giữ dòng 0).
//     value + sổ khớp. ledger.is_canonical (all_positive) + each_in_line_settled
//     (new_bal==0 ⇒ được vắng) đều PASS.
// ════════════════════════════════════════════════════════════
test release_prune_zero_line() {
  // bucket ops LAMP 700, rút HẾT 700 → dòng cạn 0, out ledger = [] (prune).
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let ledger_out = []
  let draws = [draw_lamp(bucket_ops, 700, alice)]
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4300),       // custody LAMP −700
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 700)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 27. each_in_line_settled (fail) — bỏ dòng còn DƯ > 0.
//     bucket ops còn 400 sau rút (1000 − 600) NHƯNG out_datum bỏ luôn dòng đó (ledger=[]).
//     new_bal = 400 ≠ 0 ⇒ line_present(out) phải True nhưng out rỗng → fail.
//     (value đặt khớp draw 600 để cô lập each_in_line_settled, không lẫn value_ok.)
// ════════════════════════════════════════════════════════════
test release_keep_nonzero_line_dropped() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  // out rỗng dù số dư mới = 1000 − 600 = 400 > 0 (phải giữ dòng) → each_in_line_settled fail.
  let ledger_out = []
  let draws = [draw_lamp(bucket_ops, 600, alice)]
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4400),       // custody LAMP −600 (khớp draw)
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 600)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 28. [ĐÃ ĐÓNG — F10] cross_instance_same_gov. Trước đây là known-gap: hai custody
// instance KHÁC NHAU nhưng CÙNG governance_ref có thể dùng chung 1 proposal vì
// spend_spec_hash chỉ khóa draws, không nhắc instance_id. F10 đưa instance_id VÀO
// spend_spec_hash (domain-separate theo instance) → proposal của A KHÔNG spend được
// custody B. Phủ TRỰC TIẾP bởi test 35 release_wrong_instance_id bên dưới.
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 29. RÚT CHÍNH NFT AUTHENTICITY (fail) — C-NFT (phủ TRỰC TIẾP).
//   Một draw nhắm rút chính token (seed_policy, instance_id) qty 1 ra ví. NFT một-shot
//   = chứng thực custody; nếu rút được, kẻ tấn công bóc NFT khỏi kho. Hai lớp chặn:
//   (a) sổ KHÔNG có dòng cho (seed_policy, instance_id) ⇒ ledger.get(in)=0, rút 1 ⇒
//       draws_within_balance fail (1 > 0);
//   (b) dù né được sổ, value_ok ÉP custody_out == custody_in ⊖ NFT ⇒ cust_out mất NFT,
//       nhưng C-NFT ép quantity_of(cust_out, seed_policy, instance_id)==1 ⇒ mâu thuẫn.
//   Ở đây ta dựng draws khớp spec + recipients đủ + value_ok khớp (custody_out KHÔNG còn
//   NFT) để CÔ LẬP đúng lớp chặn C-NFT trên cust_out. Khẳng định: NFT KHÔNG rút được.
// ════════════════════════════════════════════════════════════
test release_draw_targets_seed_nft() fail {
  let cust_addr = util.script_address(cust_sh)
  // sổ in CÓ dòng NFT (cố ý) để né draws_within_balance + each_out_line_ok ⇒ cô lập C-NFT.
  let ledger_in =
    [LedgerEntry { bucket_id: bucket_ops, policy: seed_policy, name: instance_id, amount: 1 }]
  let ledger_out = []
  // draw rút chính NFT (seed_policy, instance_id) qty 1 ra ví alice.
  let nft_draw =
    ReleaseDraw {
      bucket_id: bucket_ops, policy: seed_policy, name: instance_id, amount: 1,
      to: util.vk_address(alice),
    }
  let draws = [nft_draw]
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  // cust_in mang NFT; cust_out theo value_ok = in ⊖ NFT ⇒ KHÔNG còn NFT (chỉ ADA+LAMP).
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [prop_id] }
  // cust_out KHÔNG có NFT (rút ra ngoài) — value_ok khớp nhưng C-NFT cust_out==1 fail.
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 5000), d_out)
  // recipient nhận NFT (output tới alice mang NFT) — recipients_ok đủ.
  let nft_to_alice =
    util.mk_output_no_datum(util.vk_address(alice), assets.add(assets.from_lovelace(2_000_000), seed_policy, instance_id, 1))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, nft_to_alice],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 30. RÚT ASSET CHƯA BOOKED (fail) — C-REL-6.
//   Custody value CÓ một asset (#"dead",#"beef") nhưng sổ KHÔNG có dòng nào cho nó
//   (chưa booked). Draw rút amount > 0 của asset đó ⇒ ledger.get(in)=0, drawn>0 ⇒
//   draws_within_balance fail (rút quá "số dư sổ" = 0). Chống rút value lén nằm trong
//   kho mà sổ chưa ghi (đồng bộ sổ↔value). value_ok + recipients khớp để cô lập C-REL-6.
// ════════════════════════════════════════════════════════════
test release_draw_unbooked_asset() fail {
  // sổ chỉ có LAMP ops; KHÔNG có dòng cho (#"dead",#"beef").
  let ledger_in =
    [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  // sổ out giữ nguyên LAMP (draw chỉ đụng asset chưa booked) ⇒ each_out_line_ok pass cho dòng LAMP.
  let ledger_out =
    [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  // draw rút 50 của (#"dead",#"beef") từ bucket_ops — asset CÓ trong value nhưng sổ=0.
  let unbooked_draw =
    ReleaseDraw {
      bucket_id: bucket_ops, policy: #"dead", name: #"beef", amount: 50,
      to: util.vk_address(alice),
    }
  let draws = [unbooked_draw]
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  // cust_in: NFT + ADA + LAMP 5000 + 50 của asset chưa booked (#"dead",#"beef").
  let in_val = assets.add(with_nft(lamp_val(5_000_000, 5000)), #"dead", #"beef", 50)
  // cust_out = in ⊖ 50 asset (value_ok khớp) — chỉ C-REL-6 chặn (sổ không có dòng).
  let out_val = with_nft(lamp_val(5_000_000, 5000))
  let recipient =
    util.mk_output_no_datum(util.vk_address(alice), assets.add(assets.from_lovelace(2_000_000), #"dead", #"beef", 50))
  let tx =
    release_tx_nft(
      in_val, out_val, ledger_in, ledger_out, 5, 5 * ms_per_epoch,
      [proposal_input(Executed, spec, 4)],
      [recipient],
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 31. PRUNE CHỌN LỌC ĐA DÒNG (pass) — PRUNE.
//   Sổ in 2 dòng CÙNG asset (LAMP) KHÁC bucket: ops 700, community 500.
//   Rút CẠN ops (700→0 ⇒ prune, vắng ở out) NHƯNG community chỉ rút 200 (500→300, giữ).
//   value + sổ khớp; out canonical (strict-sorted, mọi dòng > 0). Khẳng định prune
//   CHỌN LỌC đúng: dòng cạn bị bỏ, dòng còn dư GIỮ NGUYÊN ở đúng giá trị mới.
// ════════════════════════════════════════════════════════════
test release_prune_partial_multi_line() {
  let ledger_in =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 500 },
    ]
  // ops rút cạn (prune, vắng); community 500→300 (giữ). out chỉ còn dòng community.
  let ledger_out =
    [LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 300 }]
  let draws =
    [draw_lamp(bucket_ops, 700, alice), draw_lamp(bucket_community, 200, bob)]
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4100),       // custody LAMP −900 (700 + 200)
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [pay(alice, 700), pay(bob, 200)],
      5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 32. KHÔI PHỤC test 21 — APPEND XÓA/QUÊN ID CŨ (fail) — C-REL-9 consumed_appended_ok.
//   Phủ TRỰC TIẾP (trước chỉ phủ gián tiếp). custody_in đã có 1 id cũ (#"01ad") trong
//   consumed_proposals; out_datum chi proposal MỚI (prop_id) NHƯNG out_datum.consumed =
//   [] (QUÊN cả id cũ lẫn id mới) thay vì [prop_id, #"01ad"]. consumed_appended_ok ÉP
//   out == [proposal_id, ..in] ⇒ [] ≠ [prop_id, #"01ad"] → fail. Chống "quên" proposal
//   đã dùng để mở lại đường replay vòng sau. Dựng tx THỦ CÔNG kiểu test 18 (không qua
//   release_tx helper) để kiểm soát chính xác consumed in/out + cô lập C-REL-9.
//   Mọi cờ khác (status/spec/NFT/epoch/value/ledger/recipient) đúng.
// ════════════════════════════════════════════════════════════
test release_consumed_strip_old_id() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  // custody_in: consumed_proposals đã có 1 id cũ (#"01ad") — proposal_is_fresh(prop_id) PASS
  //   (prop_id #"0001" ≠ #"01ad" nên KHÔNG lẫn proposal_is_fresh).
  let d_in = datum_consumed(ledger_in, [#"01ad"])
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), d_in))
  // out_datum QUÊN id cũ #"01ad" lẫn id mới prop_id ⇒ consumed=[] ≠ [prop_id, #"01ad"].
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [] }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 4700)), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
    }
  // d_in mang [#"01ad"] để khớp cust_in.
  run(tx, d_in, draws)
}

// ════════════════════════════════════════════════════════════
// ── HARDENING v1.1: test đối kháng 6 LỖ AUDIT (F1, F2, F4, F10) ──
// ════════════════════════════════════════════════════════════

// Proposal beacon với NFT name TÙY Ý (tách khỏi proposal_id) — cho F1.
fn proposal_input_named(
  nft_name            : ByteArray,
  status              : ProposalStatus,
  spec_hash           : ByteArray,
  execute_after_epoch : Int,
) -> Input {
  let result =
    ProposalResult {
      proposal_id: prop_id, status: status, spend_spec_hash: spec_hash,
      execute_after_epoch: execute_after_epoch, released_cumulative: 0,
    }
  // NFT name = nft_name (KHÔNG ép == proposal_id) → cô lập F1 (read_proposal so name==id).
  let val = assets.from_lovelace(2_000_000) |> assets.add(prop_policy, nft_name, 1)
  let out = util.mk_output(util.script_address(gov_sh), val, result)
  util.mk_input(util.mk_ref(7), out)
}

// ════════════════════════════════════════════════════════════
// 33. PROPOSAL NFT NAME ≠ proposal_id (fail) — [F1] read_proposal ép nft_name == result.proposal_id.
//   proposal NFT mang name #"dead" nhưng ProposalResult.proposal_id = #"0001".
//   Không có vế này, 1 NFT phơi N datum khác proposal_id (cùng spec_hash) → consumed_proposals
//   KHÔNG chặn replay. Mọi cờ khác (status/spec/gov-addr/epoch) đúng → cô lập F1.
// ════════════════════════════════════════════════════════════
test release_proposal_id_name_mismatch() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      // NFT name #"dead" ≠ proposal_id #"0001" → read_proposal expect nft_name==id fail.
      [proposal_input_named(#"dead", Executed, spec, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 34. DRAWS RỖNG (fail) — [F2] custody.ak Release ép `draws != []`.
//   proposal cam kết spec_hash của [] (draws=[] KHỚP C-REL-3) nhưng `draws != []` chặn TRƯỚC.
//   Một Release rỗng chỉ nhồi consumed_proposals (phình datum → kẹt) mà KHÔNG chi gì.
//   value_ok với []: cust_out == cust_in (out=in 5000); ledger giữ nguyên → mọi check khác
//   qua, CHỈ `draws != []` (đứng trước read_proposal) chặn → cô lập F2.
// ════════════════════════════════════════════════════════════
test release_empty_draws() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  // draws=[] ⇒ sổ KHÔNG đổi (out == in), value KHÔNG đổi.
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let draws = []
  // spec của [] (đúng instance_id) → C-REL-3 KHỚP; nhưng draws!=[] chặn trước read_proposal.
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5000),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec, 4)],
      [],
      5 * ms_per_epoch, [], assets.zero,
    )
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 35. PROPOSAL CHO INSTANCE KHÁC (fail) — [F10/#1B] ĐÓNG known-gap test 28.
//   spend_spec_hash NAY gồm instance_id. proposal.spec_hash tính cho instance_id KHÁC
//   (#"9999") trong khi custody datum.instance_id = #"abcd" → spend_spec_hash(#"abcd", draws)
//   ≠ proposal.spec_hash (tính cho #"9999") → C-REL-3 fail. Hai instance CÙNG governance_ref
//   KHÔNG còn dùng chung proposal: proposal của A KHÔNG spend được custody B (domain-separated
//   theo instance). draws khớp số dư + mọi cờ khác đúng → cô lập F10.
// ════════════════════════════════════════════════════════════
test release_wrong_instance_id() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  // spec tính cho instance_id #"9999" (KHÁC custody datum.instance_id #"abcd").
  let spec_other_instance = release.spend_spec_hash(seed_policy, #"9999", draws)
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out,
      [proposal_input(Executed, spec_other_instance, 4)],
      [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  // custody datum.instance_id = #"abcd" (qua datum()); validator so
  // spend_spec_hash(#"abcd", draws) ≠ spec(#"9999") → C-REL-3 fail.
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 36. EPOCH KHÔNG CHẶN TRÊN (fail) — [F4] get_epoch_bounded ép upper_bound HỮU HẠN.
//   validity_range = interval.after(lower) ⇒ upper = +∞. get_finite(upper) = None →
//   expect Some(hi_ms) fail. Chống "đóng băng" epoch: kẻ đặt lower ở epoch cũ + upper ∞
//   rồi submit muộn → epoch sổ tụt hậu thời gian thật. Mọi cờ khác đúng → cô lập F4.
//   (Dựng tx THỦ CÔNG để validity_range = interval.after, KHÔNG qua release_tx/epoch_range.)
// ════════════════════════════════════════════════════════════
test release_epoch_unbounded() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [prop_id] }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 4700)), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      // upper = +∞ (interval.after) → get_epoch_bounded expect Some(hi_ms) fail.
      validity_range: interval.after(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 37. C-REL-ADDR (fail) — [F2] địa chỉ kho GIỮ NGUYÊN, kể cả stake credential.
//   `count_*_at_script` chỉ so PAYMENT credential ⇒ trước F2 stake credential của kho
//   hoàn toàn tự do. `!is_vk` KHÔNG chặn (payment credential vẫn là Script). Mọi vế khác
//   giữ đúng ca dương (proposal Executed, spec khớp, time-lock qua) → cô lập C-REL-ADDR.
// ════════════════════════════════════════════════════════════
test release_stake_credential_hijack() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [prop_id] }
  let cust_out =
    util.mk_output(
      util.script_address_staked(cust_sh, #"deadbeef"),
      with_nft(lamp_val(5_000_000, 4700)),
      d_out,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 38. C-REL-REFSCRIPT (fail) — [F3] không đính script tham chiếu vào kho.
//   Griefing ăn dần dư địa min-ADA. Soi gương Genesis lamp_mint + Reserve reserve_draw.
// ════════════════════════════════════════════════════════════
test release_reference_script_attached() fail {
  let cust_addr = util.script_address(cust_sh)
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [prop_id] }
  let cust_out =
    Output {
      ..util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 4700)), d_out),
      reference_script: Some(#"5c81"),
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [proposal_input(Executed, spec, 4), pointer_input()],
      outputs: [cust_out, pay(alice, 300)],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
    }
  run(tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 39–41. C-REL-3-SEED (P7) — HAI KHO KHÁC HẠT GIỐNG, TRÙNG `instance_id`, MỘT PROPOSAL.
//   Lỗ trước bản vá: `spend_spec_hash` chỉ gắn `instance_id`, mà `instance_id` do người gieo
//   tự đặt (`custody_seed` chỉ ép khác rỗng). Kho A (seed_policy #"5eed") và kho B
//   (seed_policy #"5eeb") cùng khai `instance_id = #"abcd"`, cùng governance_ref. Một tx
//   tiêu CẢ HAI, mỗi kho −300 LAMP, alice nhận 600:
//     • mỗi validator đếm input của script CHÍNH NÓ ⇒ C-REL-4 thấy đúng 1 ở cả hai;
//     • `consumed_proposals` là hai danh sách riêng ⇒ C-REL-9 thoả ở cả hai;
//     • recipients_ok mỗi kho đòi alice ≥ 300 — 600 thoả cả hai.
//   ⇒ trước bản vá cả hai validator trả True: chi 2× điều Governance duyệt.
//   Sau bản vá, proposal cam kết (seed_A, abcd, draws); validator B tái dựng với seed_B ⇒
//   lệch ⇒ C-REL-3 từ chối ⇒ cả tx bị từ chối.
//   Ca 39 là ĐỐI CHỨNG DƯƠNG trên CHÍNH tx đó: validator A chấp nhận — tức tx không hỏng vì
//   lý do nào khác, và ca 40 đỏ đúng vì định danh kho. Ca 41 đo trực tiếp trên hàm hash.
// ════════════════════════════════════════════════════════════
const seed_policy_b: assets.PolicyId = #"5eeb"

const cust_sh_b: ByteArray = #"c1c1c1c1"

fn two_custody_tx() -> Transaction {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  // Proposal duyệt cho kho A (seed_policy #"5eed").
  let spec_a = release.spend_spec_hash(seed_policy, instance_id, draws)
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 5, consumed_proposals: [prop_id] }
  let addr_a = util.script_address(cust_sh)
  let addr_b = util.script_address(cust_sh_b)
  let nft_a = fn(v) { assets.add(v, seed_policy, instance_id, 1) }
  let nft_b = fn(v) { assets.add(v, seed_policy_b, instance_id, 1) }
  let in_a =
    util.mk_input(util.mk_ref(0), util.mk_output(addr_a, nft_a(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let in_b =
    util.mk_input(util.mk_ref(1), util.mk_output(addr_b, nft_b(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let out_a = util.mk_output(addr_a, nft_a(lamp_val(5_000_000, 4700)), d_out)
  let out_b = util.mk_output(addr_b, nft_b(lamp_val(5_000_000, 4700)), d_out)
  Transaction {
    ..placeholder,
    inputs: [in_a, in_b],
    reference_inputs: [proposal_input(Executed, spec_a, 4), pointer_input()],
    outputs: [out_a, out_b, pay(alice, 600)],
    mint: assets.zero,
    validity_range: epoch_range(5 * ms_per_epoch),
  }
}

fn two_custody_ledger_in() -> List<LedgerEntry> {
  [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
}

test release_two_custody_same_instance_id_owner_accepts() {
  // Validator của kho A (đúng kho proposal cam kết) trên CHÍNH tx chi đôi: chấp nhận.
  custody.custody.spend(
    ptr_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    0,
    Some(datum(two_custody_ledger_in())),
    Release { proposal_ref: prop_ref(), draws: happy_draws() },
    util.mk_ref(0),
    two_custody_tx(),
  )
}

test release_two_custody_same_instance_id_other_rejects() fail {
  // Validator của kho B (khác hạt giống, trùng instance_id) trên cùng tx: C-REL-3 từ chối
  // ⇒ tx tiêu cả hai kho bị từ chối, proposal chỉ chi được ở đúng một kho.
  custody.custody.spend(
    ptr_policy,
    seed_policy_b,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    0,
    Some(datum(two_custody_ledger_in())),
    Release { proposal_ref: prop_ref(), draws: happy_draws() },
    util.mk_ref(1),
    two_custody_tx(),
  )
}

test spend_spec_hash_binds_seed_policy() {
  // Cùng instance_id, cùng draws, khác seed_policy ⇒ khác hash.
  release.spend_spec_hash(seed_policy, instance_id, happy_draws()) != release.spend_spec_hash(
    seed_policy_b,
    instance_id,
    happy_draws(),
  )
}

// ════════════════════════════════════════════════════════════
// 42–43. VECTOR KIỂM CHÉO aiken ↔ TS (C-REL-3, công thức 0x03 của P7).
//   Cùng hex ở `Treasury/tests/release.test.ts` khối "spend_spec_hash canonical". Hex tính
//   ĐỘC LẬP bằng hashlib (blake2b-256) trên CBOR đã ghim ở cùng tệp TS — ba bản cài
//   (aiken, @noble/hashes, hashlib) phải cho cùng một chuỗi. seed_policy 28 byte thật.
// ════════════════════════════════════════════════════════════
const vector_seed: ByteArray =
  #"11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee"

test spend_spec_hash_vector_single() {
  release.spend_spec_hash(vector_seed, instance_id, [draw_lamp(bucket_ops, 300, alice)]) == #"bcee7a33b9509d456dcc6d10d6275cc42acf6509c21c9a335afa7d4e34391b56"
}

test spend_spec_hash_vector_multi() {
  release.spend_spec_hash(
    vector_seed,
    instance_id,
    [draw_lamp(bucket_ops, 300, alice), draw_lamp(bucket_community, 500, bob)],
  ) == #"da4718206f096865962155c98d4876f561bb9f285a391882b71866a8d7d46b22"
}

/// `release_happy` dời sang gốc Mainnet: phải xanh như bản gốc 0.
test release_happy_origin_mainnet() {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  run_at(window_origin_fixtures.mainnet_origin_ms, window_origin_fixtures.mainnet_origin_ms, tx, datum(ledger_in), draws)
}

/// `release_happy` dời sang gốc Preprod: phải xanh như bản gốc 0.
test release_happy_origin_preprod() {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  run_at(window_origin_fixtures.preprod_origin_ms, window_origin_fixtures.preprod_origin_ms, tx, datum(ledger_in), draws)
}

/// Ca âm: tx đã dời sang lưới Mainnet nhưng validator nhận gốc 0 (quên trừ gốc) ⇒ phải bị chặn.
test release_happy_origin_forgotten() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let spec = release.spend_spec_hash(seed_policy, instance_id, draws)
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
  run_at(0, window_origin_fixtures.mainnet_origin_ms, tx, datum(ledger_in), draws)
}

// ════════════════════════════════════════════════════════════
// 50+. CON TRỎ GOVERNANCE (Treasury/GovernancePointer.md v0.1, C-REL-PTR).
//   Custody đọc governance hiện hành g từ NFT con trỏ (reference input) thay vì nướng cứng.
//   Mỗi ca âm khác ca dương `release_ptr_happy` ĐÚNG MỘT chỗ.
// ════════════════════════════════════════════════════════════
const gov_new: ByteArray = #"88888888888888888888888888888888888888888888888888888888"

// Proposal beacon ở Script(at), mang NFT (policy, prop_id).
fn proposal_input_pg(at: ByteArray, policy: ByteArray, spec_hash: ByteArray) -> Input {
  let result =
    ProposalResult {
      proposal_id: prop_id, status: Executed, spend_spec_hash: spec_hash,
      execute_after_epoch: 4, released_cumulative: 0,
    }
  let val = assets.from_lovelace(2_000_000) |> assets.add(policy, prop_id, 1)
  util.mk_input(util.mk_ref(7), util.mk_output(util.script_address(at), val, result))
}

fn ptr_case(refs: List<Input>, param: ByteArray) -> Bool {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
  let draws = happy_draws()
  let base =
    release_tx(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 4700),
      ledger_in, ledger_out, [], [pay(alice, 300)], 5 * ms_per_epoch, [], assets.zero,
    )
  let tx = Transaction { ..base, reference_inputs: refs }
  custody.custody.spend(
    param, seed_policy, ms_per_epoch, lamp_policy, lamp_name, 0,
    Some(datum(ledger_in)),
    Release { proposal_ref: prop_ref(), draws }, util.mk_ref(0), tx,
  )
}

fn spec_ok() -> ByteArray {
  release.spend_spec_hash(seed_policy, instance_id, happy_draws())
}

// Dương: con trỏ đã đổi sang gov_new, proposal của gov_new ⇒ chi được (governance dựng lại
// không phải đúc lại kho — lý do tồn tại của con trỏ).
test release_ptr_happy_after_change() {
  ptr_case(
    [proposal_input_pg(gov_new, gov_new, spec_ok()), pointer_input_custom(ptr_policy, ptr_policy, gov_new)],
    ptr_policy,
  )
}

// Proposal của governance CŨ sau khi con trỏ đã đổi ⇒ từ chối.
test release_ptr_old_governance_rejected() fail {
  ptr_case(
    [proposal_input_pg(gov_sh, gov_sh, spec_ok()), pointer_input_custom(ptr_policy, ptr_policy, gov_new)],
    ptr_policy,
  )
}

// Con trỏ rỗng (chưa có governance chạy được) ⇒ từ chối.
test release_ptr_empty_rejected() fail {
  ptr_case(
    [proposal_input(Executed, spec_ok(), 4), pointer_input_custom(ptr_policy, ptr_policy, #"")],
    ptr_policy,
  )
}

// Con trỏ trỏ hash 27 byte ⇒ từ chối (đúng 28).
test release_ptr_short_hash_rejected() fail {
  let g27 = #"999999999999999999999999999999999999999999999999999999"
  ptr_case(
    [proposal_input_pg(g27, g27, spec_ok()), pointer_input_custom(ptr_policy, ptr_policy, g27)],
    ptr_policy,
  )
}

// Thiếu reference input con trỏ ⇒ từ chối.
test release_ptr_missing_rejected() fail {
  ptr_case([proposal_input(Executed, spec_ok(), 4)], ptr_policy)
}

// Con trỏ giả: NFT policy KHÁC ở đúng Script(ptr_policy) ⇒ từ chối.
test release_ptr_fake_policy_rejected() fail {
  let fake = #"71717171717171717171717171717171717171717171717171717171"
  ptr_case(
    [proposal_input(Executed, spec_ok(), 4), pointer_input_custom(fake, ptr_policy, gov_sh)],
    ptr_policy,
  )
}

// Con trỏ giả: NFT đúng policy nhưng ở script KHÁC ⇒ từ chối.
test release_ptr_wrong_script_rejected() fail {
  let other = #"72727272727272727272727272727272727272727272727272727272"
  ptr_case(
    [proposal_input(Executed, spec_ok(), 4), pointer_input_custom(ptr_policy, other, gov_sh)],
    ptr_policy,
  )
}

// Datum trỏ con trỏ KHÁC con trỏ nướng vào hash kho (tham số #1) ⇒ từ chối.
test release_ptr_param_mismatch_rejected() fail {
  let other = #"73737373737373737373737373737373737373737373737373737373"
  ptr_case(
    [proposal_input(Executed, spec_ok(), 4), pointer_input()],
    other,
  )
}

// Proposal ở đúng Script(g) nhưng NFT policy KHÁC g ⇒ từ chối (proposal_policy := g).
test release_ptr_proposal_policy_not_g_rejected() fail {
  ptr_case(
    [proposal_input_pg(gov_sh, gov_new, spec_ok()), pointer_input()],
    ptr_policy,
  )
}

// ════════════════════════════════════════════════════════════
// CONTRACT §17 — `recipient-gross-sum`: C-REL-7 đo RÒNG + C-REL-SOLE.
//   Lỗ trước bản vá: `recipients_ok` cộng GỘP mọi output tại `to`. `to` là script có UTxO mà
//   người ngoài tiêu-rồi-tái-tạo được (claim permissionless, Collect…) ⇒ output tái tạo mang
//   sẵn số dư cũ thoả kiểm; 300 LAMP rút ra đi ví kẻ dựng tx (bob). Ca "fail" đầu tiên dưới
//   đây là PoC đó (trước bản vá validator trả True). Fixture để `redeemers` rỗng ⇒ C-REL-SOLE
//   thoả rỗng, nên các ca đó đỏ đúng vì C-REL-7 ròng; ca SOLE dùng redeemers thật.
// ════════════════════════════════════════════════════════════
const recv_sh: ByteArray =
  #"e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3"

fn recv_draws() -> List<ReleaseDraw> {
  [
    ReleaseDraw {
      bucket_id: bucket_ops,
      policy: lamp_policy,
      name: lamp_name,
      amount: 300,
      to: util.script_address(recv_sh),
    },
  ]
}

fn recv_ledger_in() -> List<LedgerEntry> {
  [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 }]
}

fn recv_ledger_out() -> List<LedgerEntry> {
  [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 700 }]
}

// Tx Release 300 LAMP; `extra` = input ngoài custody, `recipients` = output ngoài custody.
fn recv_tx(draws: List<ReleaseDraw>, extra: List<Input>, recipients: List<Output>) -> Transaction {
  release_tx(
    lamp_val(5_000_000, 5000),
    lamp_val(5_000_000, 4700),
    recv_ledger_in(),
    recv_ledger_out(),
    [proposal_input(Executed, release.spend_spec_hash(seed_policy, instance_id, draws), 4)],
    recipients,
    5 * ms_per_epoch,
    extra,
    assets.zero,
  )
}

// UTxO sẵn có tại script nhận (mô phỏng nhánh claim permissionless của validator nhận).
fn recv_input(stake: Option<ByteArray>, lamp: Int) -> Input {
  let addr =
    when stake is {
      Some(k) -> util.script_address_staked(recv_sh, k)
      None -> util.script_address(recv_sh)
    }
  util.mk_input(util.mk_ref(3), util.mk_output_no_datum(addr, lamp_val(2_000_000, lamp)))
}

fn recv_out(lamp: Int) -> Output {
  util.mk_output_no_datum(util.script_address(recv_sh), lamp_val(2_000_000, lamp))
}

test release_recreated_recipient_utxo_rejected() fail {
  // PoC: tiêu 1000 tại `to`, tái tạo 1000 tại `to`, 300 rút ra đi bob.
  let draws = recv_draws()
  let tx = recv_tx(draws, [recv_input(None, 1000)], [recv_out(1000), pay(bob, 300)])
  run(tx, datum(recv_ledger_in()), draws)
}

test release_recreated_recipient_other_stake_rejected() fail {
  // Như trên nhưng UTxO bị tiêu nằm ở CÙNG script, stake credential khác ⇒ trừ theo địa chỉ
  // đầy đủ sẽ không thấy nó; trừ theo payment credential thì thấy.
  let draws = recv_draws()
  let tx =
    recv_tx(draws, [recv_input(Some(#"5a5a"), 1000)], [recv_out(1000), pay(bob, 300)])
  run(tx, datum(recv_ledger_in()), draws)
}

test release_script_recipient_fresh_ok() {
  // Đối chứng dương: không input tại `to`, output 300 tới `to`.
  let draws = recv_draws()
  let tx = recv_tx(draws, [], [recv_out(300)])
  run(tx, datum(recv_ledger_in()), draws)
}

test release_script_recipient_topup_ok() {
  // Đối chứng dương sát biên: input 1000 tại `to`, output 1300 tại `to` ⇒ ròng đúng 300.
  let draws = recv_draws()
  let tx = recv_tx(draws, [recv_input(None, 1000)], [recv_out(1300)])
  run(tx, datum(recv_ledger_in()), draws)
}

test release_script_recipient_topup_short_rejected() fail {
  // Biên −1: ròng 299 < 300.
  let draws = recv_draws()
  let tx = recv_tx(draws, [recv_input(None, 1000)], [recv_out(1299), pay(bob, 1)])
  run(tx, datum(recv_ledger_in()), draws)
}

test release_vk_recipient_own_ada_input_ok() {
  // `to` là ví VK bình thường, ví đó tự dựng tx và trả phí bằng UTxO CHỈ ADA của mình
  // (input tại `to` không mang LAMP ⇒ không làm giảm ròng LAMP).
  let draws = happy_draws()
  let alice_ada =
    util.mk_input(
      util.mk_ref(4),
      util.mk_output_no_datum(util.vk_address(alice), assets.from_lovelace(10_000_000)),
    )
  let tx =
    release_tx(
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4700),
      recv_ledger_in(),
      recv_ledger_out(),
      [proposal_input(Executed, release.spend_spec_hash(seed_policy, instance_id, draws), 4)],
      [pay(alice, 300)],
      5 * ms_per_epoch,
      [alice_ada],
      assets.zero,
    )
  run(tx, datum(recv_ledger_in()), draws)
}

// ── C-REL-SOLE ──
fn spend_redeemer(ix: Int) -> Pair<ScriptPurpose, Data> {
  let r: Data = 0
  Pair(Spend(util.mk_ref(ix)), r)
}

test release_sole_redeemer_own_only_ok() {
  // Đối chứng dương với redeemers THẬT: chỉ có mục của chính custody.
  let draws = recv_draws()
  let tx = recv_tx(draws, [], [recv_out(300)])
  run(Transaction { ..tx, redeemers: [spend_redeemer(0)] }, datum(recv_ledger_in()), draws)
}

test release_with_other_script_spend_rejected() fail {
  // Ròng ĐỦ (1000 → 1300 tại `to`), nhưng UTxO tại `to` là script Plutus ⇒ có redeemer thứ
  // hai ⇒ C-REL-SOLE từ chối. Ca này cô lập SOLE: C-REL-7 ròng thoả (xem _topup_ok).
  let draws = recv_draws()
  let tx = recv_tx(draws, [recv_input(None, 1000)], [recv_out(1300)])
  run(
    Transaction { ..tx, redeemers: [spend_redeemer(0), spend_redeemer(3)] },
    datum(recv_ledger_in()),
    draws,
  )
}

// Hai kho KHÁC script hash (khác hạt giống), mỗi kho có proposal riêng đã duyệt, cùng chi 300
// LAMP tới alice; tx chỉ có MỘT output 300 cho alice — 300 còn lại đi bob.
fn proposal_input_ref(ix: Int, spec_hash: ByteArray) -> Input {
  let result =
    ProposalResult {
      proposal_id: prop_id,
      status: Executed,
      spend_spec_hash: spec_hash,
      execute_after_epoch: 4,
      released_cumulative: 0,
    }
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, prop_id, 1)
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(gov_sh), val, result),
  )
}

fn two_instance_tx(redeemers: Pairs<ScriptPurpose, Data>) -> Transaction {
  let draws = happy_draws()
  let d_out =
    CustodyDatum {
      ..datum(recv_ledger_out()),
      ledger: recv_ledger_out(),
      epoch: 5,
      consumed_proposals: [prop_id],
    }
  let addr_a = util.script_address(cust_sh)
  let addr_b = util.script_address(cust_sh_b)
  let nft_a = fn(v) { assets.add(v, seed_policy, instance_id, 1) }
  let nft_b = fn(v) { assets.add(v, seed_policy_b, instance_id, 1) }
  Transaction {
    ..placeholder,
    inputs: [
      util.mk_input(
        util.mk_ref(0),
        util.mk_output(addr_a, nft_a(lamp_val(5_000_000, 5000)), datum(recv_ledger_in())),
      ),
      util.mk_input(
        util.mk_ref(1),
        util.mk_output(addr_b, nft_b(lamp_val(5_000_000, 5000)), datum(recv_ledger_in())),
      ),
    ],
    reference_inputs: [
      proposal_input_ref(7, release.spend_spec_hash(seed_policy, instance_id, draws)),
      proposal_input_ref(8, release.spend_spec_hash(seed_policy_b, instance_id, draws)),
      pointer_input(),
    ],
    outputs: [
      util.mk_output(addr_a, nft_a(lamp_val(5_000_000, 4700)), d_out),
      util.mk_output(addr_b, nft_b(lamp_val(5_000_000, 4700)), d_out),
      pay(alice, 300),
      pay(bob, 300),
    ],
    mint: assets.zero,
    validity_range: epoch_range(5 * ms_per_epoch),
    redeemers: redeemers,
  }
}

fn run_instance(seed: ByteArray, own_ix: Int, prop_ix: Int, tx: Transaction) -> Bool {
  custody.custody.spend(
    ptr_policy,
    seed,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    0,
    Some(datum(recv_ledger_in())),
    Release { proposal_ref: util.mk_ref(prop_ix), draws: happy_draws() },
    util.mk_ref(own_ix),
    tx,
  )
}

test release_two_instances_one_output_net_blind() {
  // Chứng cứ vì sao cần C-REL-SOLE: bỏ redeemers (SOLE thoả rỗng) thì CẢ HAI kho đều chấp nhận
  // dù alice chỉ nhận 300 cho hai lượt chi 300 — đo ròng một mình KHÔNG đóng biến thể này.
  // Đồng thời là đối chứng dương: tx không hỏng vì lý do nào khác.
  let tx = two_instance_tx([])
  and {
    run_instance(seed_policy, 0, 7, tx),
    run_instance(seed_policy_b, 1, 8, tx),
  }
}

test release_two_instances_one_output_rejected_a() fail {
  run_instance(
    seed_policy,
    0,
    7,
    two_instance_tx([spend_redeemer(0), spend_redeemer(1)]),
  )
}

test release_two_instances_one_output_rejected_b() fail {
  run_instance(
    seed_policy_b,
    1,
    8,
    two_instance_tx([spend_redeemer(0), spend_redeemer(1)]),
  )
}
