// DepositParam beacon spend validator (CONTRACT §3 v2; mẫu ConsumeMAGIC price_param).
// Committee/keeper post bảng phí cọc + demand_mult mới. Authenticity = NFT one-shot.
// Genesis beacon tạo lúc deploy (pay-to-address + mint NFT). Update sau = spend +
// re-create với epoch ĐƠN ĐIỆU TĂNG (chống rollback phí cũ khi DAO đã chỉnh).
//
// Validator Deposit ĐỌC beacon này qua reference input (KHÔNG tiêu) → ÉP amount cọc.

use aiken/collection/list
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction, placeholder}
use magiclamp/deposits/schedule
use magiclamp/deposits/types.{
  DepositParam, DepositParamRedeemer, DepositTier, PostParam,
}
use magiclamp/deposits/util

validator deposit_param(
  committee          : List<ByteArray>,
  threshold          : Int,
  param_nft_policy   : ByteArray,
  param_nft_name     : ByteArray,
) {
  spend(
    datum_opt : Option<DepositParam>,
    _redeemer : DepositParamRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // Beacon không liên quan mint (NFT bảo toàn, không đốt/đúc ở đây).
    expect assets.is_zero(tx.mint)

    // single-input + single-output theo SCRIPT HASH (chống double-satisfaction).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    // Committee M-of-N đồng thuận.
    expect count_sigs(committee, tx.extra_signatories) >= threshold

    let beacon_in = util.input_at_script(tx.inputs, own_hash)
    let beacon_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(d) = beacon_out.datum
    expect out_datum: DepositParam = d

    // epoch đơn điệu TĂNG (chống rollback về phí thấp khi DAO đã nâng).
    expect out_datum.epoch > datum.epoch

    // datum mới phải hợp lệ (clamp invariant) — không post bảng phí rác.
    expect schedule.valid_param(out_datum)

    // authenticity NFT bảo toàn (đúng 1 token in/out, không rút).
    let nft_in = assets.quantity_of(beacon_in.value, param_nft_policy, param_nft_name)
    let nft_out = assets.quantity_of(beacon_out.value, param_nft_policy, param_nft_name)
    expect nft_in == 1
    nft_out == 1
  }

  else(_) {
    fail
  }
}

fn count_sigs(committee: List<ByteArray>, sigs: List<ByteArray>) -> Int {
  list.count(committee, fn(k) { list.has(sigs, k) })
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const dp_sh: ByteArray = #"d0d0"

const dp_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const dp_threshold: Int = 2

const dp_nft_policy: ByteArray = #"9999"

const dp_nft_name: ByteArray = #"5041524d"

fn mk_dp(epoch: Int, demand: Int) -> DepositParam {
  DepositParam {
    tiers: [
      DepositTier { asset_type: 1, value_tier: 0, lifecycle_class: 0, base_deposit: 0 },
      DepositTier { asset_type: 0, value_tier: 2, lifecycle_class: 2, base_deposit: 50_000_000 },
    ],
    demand_mult: demand,
    m_min: 500_000_000,
    m_max: 2_000_000_000,
    epoch: epoch,
  }
}

fn dp_tx(in_epoch: Int, out_epoch: Int, out_demand: Int, sigs: List<ByteArray>) -> Transaction {
  let addr = util.script_address(dp_sh)
  let nft_val = assets.add(assets.from_lovelace(2_000_000), dp_nft_policy, dp_nft_name, 1)
  let b_in = util.mk_input(util.mk_ref(0), util.mk_output(addr, nft_val, mk_dp(in_epoch, 1_000_000_000)))
  let b_out = util.mk_output(addr, nft_val, mk_dp(out_epoch, out_demand))
  Transaction {
    ..placeholder,
    inputs: [b_in],
    outputs: [b_out],
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

test deposit_param_happy() {
  let tx = dp_tx(5, 6, 1_500_000_000, [#"c1", #"c2"])
  deposit_param.spend(
    dp_committee, dp_threshold, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}

test deposit_param_epoch_not_increasing() fail {
  let tx = dp_tx(5, 5, 1_500_000_000, [#"c1", #"c2"])
  deposit_param.spend(
    dp_committee, dp_threshold, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}

test deposit_param_insufficient_sigs() fail {
  let tx = dp_tx(5, 6, 1_500_000_000, [#"c1"])
  deposit_param.spend(
    dp_committee, dp_threshold, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}

test deposit_param_invalid_clamp() fail {
  // out demand_mult > m_max → valid_param false → reject.
  let tx = dp_tx(5, 6, 3_000_000_000, [#"c1", #"c2"])
  deposit_param.spend(
    dp_committee, dp_threshold, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}
