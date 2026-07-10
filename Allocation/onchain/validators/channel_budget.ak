// ChannelBudget validator — LỚP A (kế toán hard-cap per-channel).
//
// Budget beacon là "co-signer bắt buộc" của mọi Claim cho kênh đó:
//   - consume + re-create beacon (NFT name = channel_id giữ authenticity).
//   - remaining_oil -= amount; REJECT khi amount > remaining (vượt budget).
//   - amount PHẢI khớp entitlement-delta của ClaimAccount cùng tx (khoá chéo).
// → Σ entitlement đã cấp của kênh ≤ budget gốc, cưỡng chế on-chain.
//
// Khoá chéo (đối xứng với claim_account.ak): claim_account ép "có budget beacon
// đúng kênh bị spend"; channel_budget ép "có đúng 1 ClaimAccount in/out, amount
// khớp entitlement-delta". Không bên nào bỏ qua được.

use aiken/collection/list
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/allocation/types.{
  ChannelBudgetDatum, ChannelBudgetRedeemer, ClaimAccountDatum, Decrement,
}
use magiclamp/allocation/util

validator channel_budget(
  committee          : List<ByteArray>,
  threshold          : Int,
  budget_nft_policy  : ByteArray,
  claim_account_hash : ByteArray,
) {
  spend(
    datum_opt : Option<ChannelBudgetDatum>,
    redeemer  : ChannelBudgetRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-MINT-0: budget spend không liên quan mint.
    expect assets.is_zero(tx.mint)

    // Đúng 1 budget input + 1 output theo SCRIPT HASH (chống double-satisfaction
    // qua stake credential — 2 budget UTxO cùng hash khác stake cred).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let b_in = util.input_at_script(tx.inputs, own_hash)
    let b_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(od) = b_out.datum
    expect out_datum: ChannelBudgetDatum = od

    let Decrement { amount } = redeemer
    expect amount > 0

    // Authenticity: input + output mang đúng NFT name = channel_id, qty 1.
    let nft_name = datum.channel_id
    expect assets.quantity_of(b_in.value, budget_nft_policy, nft_name) == 1
    expect assets.quantity_of(b_out.value, budget_nft_policy, nft_name) == 1

    // Value bảo toàn tuyệt đối (NFT + min-ADA giữ nguyên) — chống rút/chèn asset.
    expect b_out.value == b_in.value

    // channel_id bất biến.
    expect out_datum.channel_id == datum.channel_id

    // Kế toán: remaining giảm ĐÚNG amount; REJECT vượt budget (BẤT BIẾN CỐT LÕI).
    expect datum.remaining_oil >= amount
    expect out_datum.remaining_oil == datum.remaining_oil - amount

    // Committee threshold ký.
    expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold

    // KHOÁ CHÉO: đúng 1 ClaimAccount input + 1 output cùng tx; cùng kênh;
    // entitlement-delta == amount (chống trừ remaining khống/replay).
    expect
      list.count(
        tx.inputs,
        fn(i) { util.is_at_script(i.output.address, claim_account_hash) },
      ) == 1
    expect
      list.count(
        tx.outputs,
        fn(o) { util.is_at_script(o.address, claim_account_hash) },
      ) == 1
    let ca_in = find_ca_input(tx.inputs, claim_account_hash)
    let ca_out = find_ca_output(tx.outputs, claim_account_hash)
    expect ca_in.channel_id == datum.channel_id
    expect ca_out.channel_id == datum.channel_id
    expect ca_out.entitlement - ca_in.entitlement == amount

    True
  }

  else(_) {
    fail
  }
}

fn find_ca_input(inputs: List<Input>, sh: ByteArray) -> ClaimAccountDatum {
  expect Some(i) = list.find(inputs, fn(x) { util.is_at_script(x.output.address, sh) })
  expect InlineDatum(d) = i.output.datum
  expect ca: ClaimAccountDatum = d
  ca
}

fn find_ca_output(outputs: List<Output>, sh: ByteArray) -> ClaimAccountDatum {
  expect Some(o) = list.find(outputs, fn(x) { util.is_at_script(x.address, sh) })
  expect InlineDatum(d) = o.datum
  expect ca: ClaimAccountDatum = d
  ca
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const cb_sh: ByteArray = #"b1b1b1b1"

const cb_ca_sh: ByteArray = #"a1a1a1a1"

const cb_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const cb_threshold: Int = 2

const cb_nft_policy: ByteArray = #"b00d"

const cb_channel: ByteArray = #"5445414d"  // "TEAM"

const cb_other_channel: ByteArray = #"5245534552564500"  // "RESERVE"

const cb_owner: ByteArray = #"0a0a"

fn cb_budget_d(channel: ByteArray, remaining: Int) -> ChannelBudgetDatum {
  ChannelBudgetDatum { channel_id: channel, remaining_oil: remaining }
}

fn cb_ca_d(channel: ByteArray, entitlement: Int) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: cb_owner,
    entitlement: entitlement,
    redeemed: 0,
    start_epoch: 0,
    drops_per_epoch: 1,
    channel_id: channel,
  }
}

/// value budget beacon = min-ADA + đúng 1 NFT name=channel.
fn cb_budget_val(channel: ByteArray) -> assets.Value {
  assets.add(assets.from_lovelace(2_000_000), cb_nft_policy, channel, 1)
}

/// Dựng tx Decrement: budget in/out + ClaimAccount in/out (entitlement +delta).
fn cb_tx(
  b_channel    : ByteArray,
  b_in_rem     : Int,
  b_out_rem    : Int,
  b_in_val     : assets.Value,
  b_out_val    : assets.Value,
  ca_channel   : ByteArray,
  ca_ent_in    : Int,
  ca_ent_out   : Int,
  sigs         : List<ByteArray>,
  extra_ins    : List<Input>,
  extra_outs   : List<Output>,
) -> Transaction {
  let b_addr = util.script_address(cb_sh)
  let ca_addr = util.script_address(cb_ca_sh)
  let b_in = util.mk_input(util.mk_ref(0), util.mk_output(b_addr, b_in_val, cb_budget_d(b_channel, b_in_rem)))
  let b_out = util.mk_output(b_addr, b_out_val, cb_budget_d(b_channel, b_out_rem))
  let ca_val = assets.from_lovelace(2_000_000)
  let ca_in = util.mk_input(util.mk_ref(1), util.mk_output(ca_addr, ca_val, cb_ca_d(ca_channel, ca_ent_in)))
  let ca_out = util.mk_output(ca_addr, ca_val, cb_ca_d(ca_channel, ca_ent_out))
  Transaction {
    ..placeholder,
    inputs: list.concat([b_in, ca_in], extra_ins),
    outputs: list.concat([b_out, ca_out], extra_outs),
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

test budget_decrement_happy() {
  // remaining 1000, amount 300 → out 700; entitlement 0→300. pass.
  let tx =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 300, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_exact_drain() {
  // remaining 500, amount 500 → out 0 (cấp hết, không âm). pass.
  let tx =
    cb_tx(
      cb_channel, 500, 0, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 100, 600, [#"c1", #"c2", #"c3"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 500)), Decrement { amount: 500 }, util.mk_ref(0), tx,
  )
}

test budget_over_cap_rejected() fail {
  // remaining 100, amount 101 → reject (BẤT BIẾN CỐT LÕI: cấp vượt budget).
  let tx =
    cb_tx(
      cb_channel, 100, -1, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 101, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 100)), Decrement { amount: 101 }, util.mk_ref(0), tx,
  )
}

test budget_wrong_arithmetic() fail {
  // out.remaining ≠ in.remaining − amount (800 thay vì 700) → reject.
  let tx =
    cb_tx(
      cb_channel, 1000, 800, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 300, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_channel_id_tamper() fail {
  // out.channel_id ≠ in (TEAM→RESERVE) → reject. NFT out cũng đổi để giữ authenticity,
  // nhưng channel_id bất biến vẫn fail.
  let b_addr = util.script_address(cb_sh)
  let ca_addr = util.script_address(cb_ca_sh)
  let b_in =
    util.mk_input(util.mk_ref(0), util.mk_output(b_addr, cb_budget_val(cb_channel), cb_budget_d(cb_channel, 1000)))
  // output đổi channel_id; value vẫn NFT TEAM để qua authenticity input, nhưng b_out.value==b_in.value cũng phải giữ.
  let b_out = util.mk_output(b_addr, cb_budget_val(cb_channel), cb_budget_d(cb_other_channel, 700))
  let ca_val = assets.from_lovelace(2_000_000)
  let ca_in = util.mk_input(util.mk_ref(1), util.mk_output(ca_addr, ca_val, cb_ca_d(cb_channel, 0)))
  let ca_out = util.mk_output(ca_addr, ca_val, cb_ca_d(cb_channel, 300))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [b_in, ca_in],
      outputs: [b_out, ca_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_nft_missing() fail {
  // input/output không mang NFT name=channel → authenticity reject.
  let no_nft = assets.from_lovelace(2_000_000)
  let tx =
    cb_tx(
      cb_channel, 1000, 700, no_nft, no_nft,
      cb_channel, 0, 300, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_insufficient_committee() fail {
  // chỉ 1 sig < threshold 2 → reject.
  let tx =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 300, [#"c1"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_no_claim_coupled() fail {
  // không có ClaimAccount in/out → reject (chống trừ remaining khống/replay).
  let b_addr = util.script_address(cb_sh)
  let b_in =
    util.mk_input(util.mk_ref(0), util.mk_output(b_addr, cb_budget_val(cb_channel), cb_budget_d(cb_channel, 1000)))
  let b_out = util.mk_output(b_addr, cb_budget_val(cb_channel), cb_budget_d(cb_channel, 700))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [b_in],
      outputs: [b_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_amount_mismatch_claim() fail {
  // entitlement-delta của account (200) ≠ amount trừ ở budget (300) → reject.
  let tx =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 200, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_claim_wrong_channel() fail {
  // ClaimAccount thuộc kênh khác budget (RESERVE vs TEAM) → reject (chống trộn 2 kênh).
  let tx =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_other_channel, 0, 300, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_double_satisfaction() fail {
  // 2 budget UTxO cùng hash khác stake-cred → count_inputs_at_script == 2 → reject.
  let dup_addr = util.script_address_staked(cb_sh, #"5742")
  let dup_in =
    util.mk_input(util.mk_ref(9), util.mk_output(dup_addr, cb_budget_val(cb_channel), cb_budget_d(cb_channel, 1000)))
  let tx =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 300, [#"c1", #"c2"], [dup_in], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_mint_nonzero() fail {
  // mint ≠ 0 → reject (C-MINT-0).
  let base =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), cb_budget_val(cb_channel),
      cb_channel, 0, 300, [#"c1", #"c2"], [], [],
    )
  let tx = Transaction { ..base, mint: assets.add(assets.zero, #"dead", #"beef", 1) }
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}

test budget_value_tamper() fail {
  // b_out.value ≠ b_in.value (nhét token lạ) → reject (bảo toàn value).
  let tampered = assets.add(cb_budget_val(cb_channel), #"dead", #"beef", 1)
  let tx =
    cb_tx(
      cb_channel, 1000, 700, cb_budget_val(cb_channel), tampered,
      cb_channel, 0, 300, [#"c1", #"c2"], [], [],
    )
  channel_budget.spend(
    cb_committee, cb_threshold, cb_nft_policy, cb_ca_sh,
    Some(cb_budget_d(cb_channel, 1000)), Decrement { amount: 300 }, util.mk_ref(0), tx,
  )
}
