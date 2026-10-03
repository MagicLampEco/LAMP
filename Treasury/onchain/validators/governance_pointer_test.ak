// Bài kiểm cho `governance_pointer` (Treasury/GovernancePointer.md v0.1 §"Bài kiểm bắt buộc").
// Mỗi nhánh một ca dương; mỗi vế một ca âm KHÁC ca dương của nhánh đó đúng một chỗ.

use aiken/collection/list
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  DatumHash, Input, Output, OutputReference, Transaction, placeholder,
}
use governance_pointer
use magiclamp/treasury/pointer
use magiclamp/treasury/release
use magiclamp/treasury/types.{
  ApplyPending, CommitteeCancel, CommitteePropose, Executed, GovernanceSet, Pending,
  PointerDatum, PointerRedeemer, ProposalResult, ProposalStatus, Seal, Tallied,
}
use magiclamp/treasury/util

// ── Hằng số ──
const ptr: ByteArray = #"70707070707070707070707070707070707070707070707070707070"

const delay: Int = 3_600_000

const c1: ByteArray = #"c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1"

const c2: ByteArray = #"c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2"

const gov_a: ByteArray = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const gov_b: ByteArray = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

const other: ByteArray = #"dededededededededededededededededededededededededededede"

const pid: ByteArray = #"0042"

fn seed() -> OutputReference {
  OutputReference { transaction_id: #"5e5e", output_index: 0 }
}

fn d0() -> PointerDatum {
  PointerDatum {
    governance_hash: gov_a,
    committee: [c1, c2],
    threshold: 2,
    sealed: False,
    pending: None,
  }
}

fn nft_val() -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(ptr, pointer.pointer_name, 1)
}

fn ptr_out(d: PointerDatum) -> Output {
  util.mk_output(util.script_address(ptr), nft_val(), d)
}

fn ptr_in(d: PointerDatum) -> Input {
  util.mk_input(util.mk_ref(0), ptr_out(d))
}

// Tx chi con trỏ: 1 input con trỏ (mk_ref(0)) → 1 output con trỏ.
fn sp_tx(
  d_in    : PointerDatum,
  d_out   : PointerDatum,
  signers : List<ByteArray>,
  range   : interval.Interval,
  refs    : List<Input>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [ptr_in(d_in)],
    reference_inputs: refs,
    outputs: [ptr_out(d_out)],
    extra_signatories: signers,
    mint: assets.zero,
    validity_range: range,
  }
}

fn run(d_in: PointerDatum, r: PointerRedeemer, tx: Transaction) -> Bool {
  governance_pointer.governance_pointer.spend(
    seed(),
    delay,
    Some(d_in),
    r,
    util.mk_ref(0),
    tx,
  )
}

fn rng() -> interval.Interval {
  interval.between(1_000, 2_000)
}

// ════════════════════════════════════════════════════════════
// CommitteePropose
// ════════════════════════════════════════════════════════════
fn proposed(d: PointerDatum, eff: Int) -> PointerDatum {
  PointerDatum {
    ..d,
    pending: Some(Pending { new_hash: gov_b, effective_after_ms: eff }),
  }
}

test propose_ok() {
  let tx = sp_tx(d0(), proposed(d0(), 2_000 + delay), [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

// Đè pending cũ (trễ tính lại từ đầu) — hợp lệ.
test propose_replaces_pending_ok() {
  let d_in = proposed(d0(), 5)
  let tx = sp_tx(d_in, proposed(d0(), 2_000 + delay), [c1, c2], rng(), [])
  run(d_in, CommitteePropose { new_hash: gov_b }, tx)
}

test propose_when_sealed() fail {
  let d_in = PointerDatum { ..d0(), sealed: True }
  let tx = sp_tx(d_in, proposed(d_in, 2_000 + delay), [c1, c2], rng(), [])
  run(d_in, CommitteePropose { new_hash: gov_b }, tx)
}

test propose_under_threshold() fail {
  let tx = sp_tx(d0(), proposed(d0(), 2_000 + delay), [c1], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

test propose_stranger_signs() fail {
  let tx = sp_tx(d0(), proposed(d0(), 2_000 + delay), [c1, other], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

test propose_short_hash() fail {
  let h27 = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"
  let d_out =
    PointerDatum {
      ..d0(),
      pending: Some(Pending { new_hash: h27, effective_after_ms: 2_000 + delay }),
    }
  let tx = sp_tx(d0(), d_out, [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: h27 }, tx)
}

// Hạn tính từ CẬN DƯỚI (spec v0.1 nguyên văn) ⇒ bị từ chối: cận dưới tự chọn, lùi về quá khứ
// được, nên trễ bị vô hiệu. Validator chỉ nhận cận TRÊN + delay.
test propose_effective_from_lower_bound() fail {
  let tx = sp_tx(d0(), proposed(d0(), 1_000 + delay), [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

// Hạn ngắn hơn cận trên + delay ⇒ từ chối.
test propose_effective_too_early() fail {
  let tx = sp_tx(d0(), proposed(d0(), 2_000 + delay - 1), [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

test propose_upper_unbounded() fail {
  let tx =
    sp_tx(d0(), proposed(d0(), 2_000 + delay), [c1, c2], interval.after(1_000), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

// Lén đổi governance_hash cùng lượt propose ⇒ từ chối.
test propose_changes_governance_hash() fail {
  let d_out = PointerDatum { ..proposed(d0(), 2_000 + delay), governance_hash: gov_b }
  let tx = sp_tx(d0(), d_out, [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

// Lén hạ threshold ⇒ từ chối.
test propose_changes_threshold() fail {
  let d_out = PointerDatum { ..proposed(d0(), 2_000 + delay), threshold: 1 }
  let tx = sp_tx(d0(), d_out, [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

// Lén thay committee ⇒ từ chối.
test propose_changes_committee() fail {
  let d_out = PointerDatum { ..proposed(d0(), 2_000 + delay), committee: [c1, other] }
  let tx = sp_tx(d0(), d_out, [c1, c2], rng(), [])
  run(d0(), CommitteePropose { new_hash: gov_b }, tx)
}

// ════════════════════════════════════════════════════════════
// ApplyPending (permissionless)
// ════════════════════════════════════════════════════════════
fn applied() -> PointerDatum {
  PointerDatum { ..d0(), governance_hash: gov_b, pending: None }
}

test apply_ok_no_signer() {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, applied(), [], interval.between(5_000, 6_000), [])
  run(d_in, ApplyPending, tx)
}

test apply_before_deadline() fail {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, applied(), [], interval.between(4_999, 6_000), [])
  run(d_in, ApplyPending, tx)
}

test apply_lower_unbounded() fail {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, applied(), [], interval.before(6_000), [])
  run(d_in, ApplyPending, tx)
}

test apply_no_pending() fail {
  let tx = sp_tx(d0(), applied(), [], interval.between(5_000, 6_000), [])
  run(d0(), ApplyPending, tx)
}

test apply_keeps_pending() fail {
  let d_in = proposed(d0(), 5_000)
  let d_out = PointerDatum { ..d_in, governance_hash: gov_b }
  let tx = sp_tx(d_in, d_out, [], interval.between(5_000, 6_000), [])
  run(d_in, ApplyPending, tx)
}

test apply_wrong_hash() fail {
  let d_in = proposed(d0(), 5_000)
  let d_out = PointerDatum { ..applied(), governance_hash: other }
  let tx = sp_tx(d_in, d_out, [], interval.between(5_000, 6_000), [])
  run(d_in, ApplyPending, tx)
}

// Người gọi tự do lén niêm phong cùng lượt apply ⇒ từ chối.
test apply_sneaks_seal() fail {
  let d_in = proposed(d0(), 5_000)
  let d_out = PointerDatum { ..applied(), sealed: True }
  let tx = sp_tx(d_in, d_out, [], interval.between(5_000, 6_000), [])
  run(d_in, ApplyPending, tx)
}

// ════════════════════════════════════════════════════════════
// CommitteeCancel
// ════════════════════════════════════════════════════════════
test cancel_ok() {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, d0(), [c1, c2], rng(), [])
  run(d_in, CommitteeCancel, tx)
}

test cancel_when_sealed() fail {
  let d_in = PointerDatum { ..proposed(d0(), 5_000), sealed: True }
  let d_out = PointerDatum { ..d_in, pending: None }
  let tx = sp_tx(d_in, d_out, [c1, c2], rng(), [])
  run(d_in, CommitteeCancel, tx)
}

test cancel_under_threshold() fail {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, d0(), [c2], rng(), [])
  run(d_in, CommitteeCancel, tx)
}

test cancel_no_pending() fail {
  let tx = sp_tx(d0(), d0(), [c1, c2], rng(), [])
  run(d0(), CommitteeCancel, tx)
}

test cancel_keeps_pending() fail {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, d_in, [c1, c2], rng(), [])
  run(d_in, CommitteeCancel, tx)
}

// ════════════════════════════════════════════════════════════
// Seal (một chiều)
// ════════════════════════════════════════════════════════════
fn sealed() -> PointerDatum {
  PointerDatum { ..d0(), sealed: True }
}

test seal_ok() {
  let tx = sp_tx(d0(), sealed(), [c1, c2], rng(), [])
  run(d0(), Seal, tx)
}

test seal_empty_pointer() fail {
  let d_in = PointerDatum { ..d0(), governance_hash: #"" }
  let tx = sp_tx(d_in, PointerDatum { ..d_in, sealed: True }, [c1, c2], rng(), [])
  run(d_in, Seal, tx)
}

test seal_with_pending() fail {
  let d_in = proposed(d0(), 5_000)
  let tx = sp_tx(d_in, PointerDatum { ..d_in, sealed: True }, [c1, c2], rng(), [])
  run(d_in, Seal, tx)
}

test seal_under_threshold() fail {
  let tx = sp_tx(d0(), sealed(), [c1], rng(), [])
  run(d0(), Seal, tx)
}

test seal_already_sealed() fail {
  let tx = sp_tx(sealed(), sealed(), [c1, c2], rng(), [])
  run(sealed(), Seal, tx)
}

test seal_output_not_sealed() fail {
  let tx = sp_tx(d0(), d0(), [c1, c2], rng(), [])
  run(d0(), Seal, tx)
}

// ════════════════════════════════════════════════════════════
// GovernanceSet (đường đổi con trỏ bằng proposal của governance hiện hành)
// ════════════════════════════════════════════════════════════
fn prop_in(
  at     : ByteArray,
  policy : ByteArray,
  name   : ByteArray,
  status : ProposalStatus,
  spec   : ByteArray,
) -> Input {
  let result =
    ProposalResult {
      proposal_id: pid,
      status,
      spend_spec_hash: spec,
      execute_after_epoch: 0,
      released_cumulative: 0,
    }
  let v = assets.from_lovelace(2_000_000) |> assets.add(policy, name, 1)
  util.mk_input(util.mk_ref(7), util.mk_output(util.script_address(at), v, result))
}

fn good_spec() -> ByteArray {
  pointer.pointer_spec_hash(ptr, gov_b)
}

fn gs(d_in: PointerDatum, d_out: PointerDatum, refs: List<Input>) -> Bool {
  run(
    d_in,
    GovernanceSet { new_hash: gov_b, proposal_ref: util.mk_ref(7) },
    sp_tx(d_in, d_out, [], rng(), refs),
  )
}

test gs_ok() {
  gs(d0(), applied(), [prop_in(gov_a, gov_a, pid, Executed, good_spec())])
}

// Áp được cả khi đã niêm phong, và giữ niêm phong.
test gs_ok_when_sealed() {
  gs(
    sealed(),
    PointerDatum { ..applied(), sealed: True },
    [prop_in(gov_a, gov_a, pid, Executed, good_spec())],
  )
}

// Xoá pending đang chờ.
test gs_ok_clears_pending() {
  gs(
    proposed(d0(), 9_999_999),
    applied(),
    [prop_in(gov_a, gov_a, pid, Executed, good_spec())],
  )
}

test gs_proposal_other_script() fail {
  gs(d0(), applied(), [prop_in(other, gov_a, pid, Executed, good_spec())])
}

test gs_proposal_other_policy() fail {
  gs(d0(), applied(), [prop_in(gov_a, other, pid, Executed, good_spec())])
}

test gs_proposal_not_executed() fail {
  gs(d0(), applied(), [prop_in(gov_a, gov_a, pid, Tallied, good_spec())])
}

test gs_wrong_spec_hash() fail {
  gs(
    d0(),
    applied(),
    [prop_in(gov_a, gov_a, pid, Executed, pointer.pointer_spec_hash(ptr, other))],
  )
}

// Hash cam kết cho con trỏ KHÁC (policy khác) ⇒ từ chối.
test gs_spec_for_other_pointer() fail {
  gs(
    d0(),
    applied(),
    [prop_in(gov_a, gov_a, pid, Executed, pointer.pointer_spec_hash(other, gov_b))],
  )
}

test gs_wrong_nft_name() fail {
  gs(d0(), applied(), [prop_in(gov_a, gov_a, #"0043", Executed, good_spec())])
}

test gs_missing_proposal() fail {
  gs(d0(), applied(), [])
}

test gs_empty_pointer() fail {
  let d_in = PointerDatum { ..d0(), governance_hash: #"" }
  gs(d_in, applied(), [prop_in(#"", #"", pid, Executed, good_spec())])
}

test gs_short_new_hash() fail {
  let h27 = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"
  let d_out = PointerDatum { ..applied(), governance_hash: h27 }
  run(
    d0(),
    GovernanceSet { new_hash: h27, proposal_ref: util.mk_ref(7) },
    sp_tx(
      d0(),
      d_out,
      [],
      rng(),
      [prop_in(gov_a, gov_a, pid, Executed, pointer.pointer_spec_hash(ptr, h27))],
    ),
  )
}

test gs_output_hash_mismatch() fail {
  gs(
    d0(),
    PointerDatum { ..applied(), governance_hash: other },
    [prop_in(gov_a, gov_a, pid, Executed, good_spec())],
  )
}

// Đặt lại `sealed` thành False ⇒ từ chối (không nhánh nào gỡ niêm phong).
test gs_unseal() fail {
  gs(sealed(), applied(), [prop_in(gov_a, gov_a, pid, Executed, good_spec())])
}

// Proposal chi tiền (domain 0x03) không dùng được làm proposal đổi con trỏ.
test gs_release_spec_not_accepted() fail {
  let spec03 = release.spend_spec_hash(ptr, gov_b, [])
  gs(d0(), applied(), [prop_in(gov_a, gov_a, pid, Executed, spec03)])
}

// ════════════════════════════════════════════════════════════
// Luật chung của mọi nhánh chi (dựng trên seal_ok / apply_ok)
// ════════════════════════════════════════════════════════════
fn seal_with(tx: Transaction) -> Bool {
  run(d0(), Seal, tx)
}

fn seal_tx() -> Transaction {
  sp_tx(d0(), sealed(), [c1, c2], rng(), [])
}

// NFT rời địa chỉ (đi về ví) ⇒ từ chối.
test common_nft_leaves_to_wallet() fail {
  let out =
    Output {
      ..ptr_out(sealed()),
      address: Address {
        payment_credential: VerificationKey(c1),
        stake_credential: None,
      },
    }
  seal_with(Transaction { ..seal_tx(), outputs: [out] })
}

// Đổi stake credential của địa chỉ con trỏ ⇒ từ chối.
test common_stake_credential_changed() fail {
  let out =
    Output {
      ..ptr_out(sealed()),
      address: Address {
        payment_credential: Script(ptr),
        stake_credential: Some(Inline(VerificationKey(c1))),
      },
    }
  seal_with(Transaction { ..seal_tx(), outputs: [out] })
}

// Output con trỏ không mang NFT (NFT đi output thứ hai ở ví) ⇒ từ chối.
test common_nft_split_out() fail {
  let out = Output { ..ptr_out(sealed()), value: assets.from_lovelace(2_000_000) }
  let thief =
    util.mk_output_no_datum(
      util.vk_address(c1),
      assets.from_asset(ptr, pointer.pointer_name, 1),
    )
  seal_with(Transaction { ..seal_tx(), outputs: [out, thief] })
}

// Nhồi token rác vào UTxO con trỏ ⇒ từ chối.
test common_junk_token() fail {
  let out =
    Output { ..ptr_out(sealed()), value: assets.add(nft_val(), other, #"01", 5) }
  seal_with(Transaction { ..seal_tx(), outputs: [out] })
}

test common_reference_script() fail {
  let out = Output { ..ptr_out(sealed()), reference_script: Some(other) }
  seal_with(Transaction { ..seal_tx(), outputs: [out] })
}

test common_mint_nonzero() fail {
  seal_with(Transaction { ..seal_tx(), mint: assets.from_asset(other, #"01", 1) })
}

// Đốt NFT con trỏ ⇒ từ chối.
test common_burn_pointer() fail {
  let out = Output { ..ptr_out(sealed()), value: assets.from_lovelace(2_000_000) }
  seal_with(
    Transaction {
      ..seal_tx(),
      outputs: [out],
      mint: assets.from_asset(ptr, pointer.pointer_name, -1),
    },
  )
}

// Hai input ở script con trỏ (double-satisfaction) ⇒ từ chối.
test common_two_inputs() fail {
  let junk =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(util.script_address(ptr), assets.from_lovelace(2_000_000), d0()),
    )
  seal_with(Transaction { ..seal_tx(), inputs: [ptr_in(d0()), junk] })
}

// Hai output ở script con trỏ ⇒ từ chối.
test common_two_outputs() fail {
  let extra =
    util.mk_output(util.script_address(ptr), assets.from_lovelace(2_000_000), d0())
  seal_with(Transaction { ..seal_tx(), outputs: [ptr_out(sealed()), extra] })
}

// UTxO ở địa chỉ con trỏ mà không mang NFT (datum giả) ⇒ không chi được.
test common_input_without_nft() fail {
  let junk =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(util.script_address(ptr), assets.from_lovelace(2_000_000), d0()),
    )
  seal_with(Transaction { ..seal_tx(), inputs: [junk] })
}

test common_datum_not_inline() fail {
  let out =
    Output {
      ..ptr_out(sealed()),
      datum: DatumHash(#"00000000000000000000000000000000000000000000000000000000"),
    }
  seal_with(Transaction { ..seal_tx(), outputs: [out] })
}

// ════════════════════════════════════════════════════════════
// Mint (one-shot)
// ════════════════════════════════════════════════════════════
fn genesis_datum() -> PointerDatum {
  PointerDatum {
    governance_hash: #"",
    committee: [c1],
    threshold: 1,
    sealed: False,
    pending: None,
  }
}

fn seed_in() -> Input {
  util.mk_input(seed(), util.mk_output_no_datum(util.vk_address(c1), assets.from_lovelace(10_000_000)))
}

fn mint_tx(out: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [seed_in()],
    outputs: [out],
    mint: assets.from_asset(ptr, pointer.pointer_name, 1),
  }
}

fn run_mint(d: Int, tx: Transaction) -> Bool {
  governance_pointer.governance_pointer.mint(seed(), d, Void, ptr, tx)
}

test mint_ok() {
  run_mint(delay, mint_tx(ptr_out(genesis_datum())))
}

// Đúc thẳng với governance 28 byte (không qua bước rỗng) — hợp lệ.
test mint_ok_with_governance() {
  run_mint(delay, mint_tx(ptr_out(PointerDatum { ..genesis_datum(), governance_hash: gov_a })))
}

test mint_no_seed() fail {
  run_mint(delay, Transaction { ..mint_tx(ptr_out(genesis_datum())), inputs: [] })
}

test mint_delay_zero() fail {
  run_mint(0, mint_tx(ptr_out(genesis_datum())))
}

test mint_qty_two() fail {
  let out =
    Output {
      ..ptr_out(genesis_datum()),
      value: assets.add(nft_val(), ptr, pointer.pointer_name, 1),
    }
  run_mint(
    delay,
    Transaction { ..mint_tx(out), mint: assets.from_asset(ptr, pointer.pointer_name, 2) },
  )
}

test mint_extra_name() fail {
  run_mint(
    delay,
    Transaction {
      ..mint_tx(ptr_out(genesis_datum())),
      mint: assets.from_asset(ptr, pointer.pointer_name, 1) |> assets.add(ptr, #"01", 1),
    },
  )
}

test mint_extra_policy() fail {
  run_mint(
    delay,
    Transaction {
      ..mint_tx(ptr_out(genesis_datum())),
      mint: assets.from_asset(ptr, pointer.pointer_name, 1) |> assets.add(other, #"01", 1),
    },
  )
}

test mint_to_wallet() fail {
  let out =
    util.mk_output(util.vk_address(c1), nft_val(), genesis_datum())
  run_mint(delay, mint_tx(out))
}

test mint_to_other_script() fail {
  let out = util.mk_output(util.script_address(other), nft_val(), genesis_datum())
  run_mint(delay, mint_tx(out))
}

test mint_junk_token() fail {
  let out =
    Output { ..ptr_out(genesis_datum()), value: assets.add(nft_val(), other, #"01", 1) }
  run_mint(delay, mint_tx(out))
}

test mint_reference_script() fail {
  let out = Output { ..ptr_out(genesis_datum()), reference_script: Some(other) }
  run_mint(delay, mint_tx(out))
}

test mint_sealed() fail {
  run_mint(delay, mint_tx(ptr_out(PointerDatum { ..genesis_datum(), sealed: True })))
}

test mint_pending() fail {
  let d =
    PointerDatum {
      ..genesis_datum(),
      pending: Some(Pending { new_hash: gov_b, effective_after_ms: 0 }),
    }
  run_mint(delay, mint_tx(ptr_out(d)))
}

test mint_governance_27_bytes() fail {
  let h27 = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"
  run_mint(delay, mint_tx(ptr_out(PointerDatum { ..genesis_datum(), governance_hash: h27 })))
}

test mint_committee_empty() fail {
  run_mint(
    delay,
    mint_tx(ptr_out(PointerDatum { ..genesis_datum(), committee: [], threshold: 0 })),
  )
}

test mint_threshold_zero() fail {
  run_mint(delay, mint_tx(ptr_out(PointerDatum { ..genesis_datum(), threshold: 0 })))
}

test mint_threshold_above_n() fail {
  run_mint(delay, mint_tx(ptr_out(PointerDatum { ..genesis_datum(), threshold: 2 })))
}

test mint_committee_duplicate() fail {
  run_mint(
    delay,
    mint_tx(ptr_out(PointerDatum { ..genesis_datum(), committee: [c1, c1], threshold: 2 })),
  )
}

/// `n` khoá 28 byte khác nhau: 27 byte chung + 1 byte đuôi = chỉ số.
fn committee_of(n: Int) -> List<ByteArray> {
  list.map(
    list.range(1, n),
    fn(i) { bytearray.push(#"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3", i) },
  )
}

// Biên trần `max_committee` = 16: 16 khoá qua, 17 khoá bị từ chối. Cặp này phân biệt được
// bản có vế `n <= max_committee` với bản đã gỡ nó (bài 17 khoá xanh khi gỡ).
test mint_committee_at_max_ok() {
  run_mint(
    delay,
    mint_tx(ptr_out(PointerDatum { ..genesis_datum(), committee: committee_of(16) })),
  )
}

test mint_committee_above_max() fail {
  run_mint(
    delay,
    mint_tx(ptr_out(PointerDatum { ..genesis_datum(), committee: committee_of(17) })),
  )
}

test mint_committee_short_key() fail {
  run_mint(
    delay,
    mint_tx(ptr_out(PointerDatum { ..genesis_datum(), committee: [#"c1c1"] })),
  )
}

test mint_no_datum() fail {
  run_mint(delay, mint_tx(util.mk_output_no_datum(util.script_address(ptr), nft_val())))
}

// ════════════════════════════════════════════════════════════
// Hash cam kết đổi con trỏ — tách domain + vector kiểm chéo TS
// ════════════════════════════════════════════════════════════
test pointer_spec_hash_binds_policy_and_hash() {
  pointer.pointer_spec_hash(ptr, gov_b) != pointer.pointer_spec_hash(other, gov_b) && pointer.pointer_spec_hash(
    ptr,
    gov_b,
  ) != pointer.pointer_spec_hash(ptr, gov_a)
}

// Cùng hex ở `Treasury/tests/pointer.test.ts` (tính độc lập bằng hashlib).
test pointer_spec_hash_vector() {
  pointer.pointer_spec_hash(ptr, gov_b) == #"014cdd4971c8e4900a01b916cc2f0c5ade57a3fe5e39e98b95917f1cabf3907c"
}
