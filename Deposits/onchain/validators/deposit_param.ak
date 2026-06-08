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

    // Committee M-of-N đồng thuận. LỖ phòng thủ:
    //   - threshold > 0: threshold ≤ 0 → 0 chữ ký cũng qua (beacon bị chiếm tự do).
    //   - committee KHÔNG trùng key: nếu cùng 1 key xuất hiện n lần trong committee,
    //     count_sigs đếm n cho 1 chữ ký → 1 người giả lập M-of-N (phá ngưỡng thật).
    expect threshold > 0
    expect no_dup_keys(committee)
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

/// committee không có key trùng (mỗi key đếm đúng 1 lần trong M-of-N).
fn no_dup_keys(committee: List<ByteArray>) -> Bool {
  list.all(committee, fn(k) { list.count(committee, fn(o) { o == k }) == 1 })
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

// PHÒNG-3a (fail) — THRESHOLD ≤ 0: threshold=0 → count_sigs ≥ 0 luôn đúng (0 chữ ký cũng
//   post được bảng phí → beacon bị chiếm). guard expect threshold > 0 → reject.
test deposit_param_threshold_zero_fail() fail {
  let tx = dp_tx(5, 6, 1_500_000_000, [])
  deposit_param.spend(
    dp_committee, 0, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}

// PHÒNG-3b (fail) — COMMITTEE TRÙNG KEY: committee = [c1, c1, c2] (c1 lặp). 1 chữ ký c1
//   → count_sigs đếm 2 (c1 khớp 2 lần) ≥ threshold 2 → 1 người giả lập M-of-N. guard
//   no_dup_keys(committee) → reject.
test deposit_param_committee_dup_fail() fail {
  let dup_committee: List<ByteArray> = [#"c1", #"c1", #"c2"]
  // chỉ c1 ký → count_sigs(dup_committee, [c1]) = 2 ≥ threshold 2 (KHÔNG có guard sẽ qua).
  let tx = dp_tx(5, 6, 1_500_000_000, [#"c1"])
  deposit_param.spend(
    dup_committee, dp_threshold, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}

// REG-4 (fail) — DOUBLE-OUTPUT RÚT NFT: spend beacon, tạo 2 output ở CÙNG script (1 giữ
// NFT + datum hợp lệ, 1 phụ) để né "đúng 1 output". count_outputs_at_script==2 → fail.
// Chống chẻ UTxO beacon (tách NFT khỏi datum / nhân bản bảng phí).
test deposit_param_double_output_fail() fail {
  let addr = util.script_address(dp_sh)
  let nft_val = assets.add(assets.from_lovelace(2_000_000), dp_nft_policy, dp_nft_name, 1)
  let b_in = util.mk_input(util.mk_ref(0), util.mk_output(addr, nft_val, mk_dp(5, 1_000_000_000)))
  let b_out1 = util.mk_output(addr, nft_val, mk_dp(6, 1_500_000_000))
  let b_out2 = util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [b_in],
      outputs: [b_out1, b_out2],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  deposit_param.spend(
    dp_committee, dp_threshold, dp_nft_policy, dp_nft_name,
    Some(mk_dp(5, 1_000_000_000)), PostParam, util.mk_ref(0), tx,
  )
}
