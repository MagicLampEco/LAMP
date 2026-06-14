// Treasury con PER-CHANNEL validator — LỚP B (hard-cap vật lý).
// Mỗi kênh có treasury riêng, value LAMP = ĐÚNG budget kênh. Release đúng
// redeemed-delta cho mỗi Redeem cùng tx. Value cạn = hết ngân sách vật lý.
//
// Chống trộn kênh: ép ClaimAccount.channel_id == TreasuryDatum.channel_id.
// → account kênh A KHÔNG rút được từ treasury kênh B.

use aiken/collection/list
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/tokenomics/types.{
  ClaimAccountDatum, ReleaseForRedeem, TreasuryDatum, TreasuryRedeemer,
}
use magiclamp/tokenomics/util

validator treasury(
  claim_account_hash : ByteArray,
  lamp_policy        : ByteArray,
  lamp_name          : ByteArray,
) {
  spend(
    datum_opt : Option<TreasuryDatum>,
    _redeemer : TreasuryRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-MINT-0
    expect assets.is_zero(tx.mint)

    // Đúng 1 treasury input + output theo SCRIPT HASH (chống N× release qua nhiều UTxO).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let tre_in = util.input_at_script(tx.inputs, own_hash)
    let tre_out = util.output_at_script(tx.outputs, own_hash)

    // Datum bảo toàn (committee_hash + channel_id).
    expect InlineDatum(od) = tre_out.datum
    expect out_datum: TreasuryDatum = od
    expect out_datum.committee_hash == datum.committee_hash
    expect out_datum.channel_id == datum.channel_id

    // Đúng 1 ClaimAccount input + output cùng tx.
    expect
      list.count(tx.inputs, fn(i) { util.is_at_script(i.output.address, claim_account_hash) }) == 1
    expect
      list.count(tx.outputs, fn(o) { util.is_at_script(o.address, claim_account_hash) }) == 1

    let ca_in = find_claim_account_input(tx.inputs, claim_account_hash)
    let ca_out = find_claim_account_output(tx.outputs, claim_account_hash)

    // Chống trộn kênh: account phải CÙNG kênh treasury (LỚP B nối với channel_id).
    expect ca_in.channel_id == datum.channel_id
    expect ca_out.channel_id == datum.channel_id

    // released = redeemed(out) − redeemed(in).
    let released = ca_out.redeemed - ca_in.redeemed
    expect released > 0

    // output treasury == input value với LAMP giảm ĐÚNG released. Bảo toàn TUYỆT ĐỐI
    // mọi asset khác. Nếu released > LAMP đang có → out.value LAMP âm, KHÔNG dựng được
    // value hợp lệ → vật lý cản (LỚP B).
    expect tre_out.value == assets.add(tre_in.value, lamp_policy, lamp_name, -released)

    True
  }

  else(_) {
    fail
  }
}

fn find_claim_account_input(inputs: List<Input>, script_hash: ByteArray) -> ClaimAccountDatum {
  expect Some(i) = list.find(inputs, fn(x) { util.is_at_script(x.output.address, script_hash) })
  expect InlineDatum(d) = i.output.datum
  expect ca: ClaimAccountDatum = d
  ca
}

fn find_claim_account_output(outputs: List<Output>, script_hash: ByteArray) -> ClaimAccountDatum {
  expect Some(o) = list.find(outputs, fn(x) { util.is_at_script(x.address, script_hash) })
  expect InlineDatum(d) = o.datum
  expect ca: ClaimAccountDatum = d
  ca
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const tt_tre_sh: ByteArray = #"77777777"

const tt_ca_sh: ByteArray = #"a1a1a1a1"

const tt_lamp_policy: ByteArray = #"1a3b"

const tt_lamp_name: ByteArray = #"4c414d50"

const tt_owner: ByteArray = #"0a0a"

const tt_channel: ByteArray = #"5445414d"  // "TEAM"

const tt_other_channel: ByteArray = #"5245534552564500"  // "RESERVE"

fn tt_tre_d(channel: ByteArray) -> TreasuryDatum {
  TreasuryDatum { committee_hash: #"cccc", channel_id: channel }
}

fn tt_ca_d(redeemed: Int, channel: ByteArray) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: tt_owner,
    entitlement: 1000,
    redeemed: redeemed,
    start_epoch: 0,
    drops_per_epoch: 1,
    channel_id: channel,
  }
}

fn tt_lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), tt_lamp_policy, tt_lamp_name, lamp)
}

fn treasury_tx(
  tre_channel  : ByteArray,
  tre_in_val   : assets.Value,
  tre_out_val  : assets.Value,
  ca_channel   : ByteArray,
  redeemed_in  : Int,
  redeemed_out : Int,
  extra_tre    : List<Input>,
) -> Transaction {
  let tre_addr = util.script_address(tt_tre_sh)
  let ca_addr = util.script_address(tt_ca_sh)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, tre_in_val, tt_tre_d(tre_channel)))
  let tre_out = util.mk_output(tre_addr, tre_out_val, tt_tre_d(tre_channel))
  let ca_in =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(redeemed_in, ca_channel)),
    )
  let ca_out =
    util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(redeemed_out, ca_channel))
  Transaction {
    ..placeholder,
    inputs: list.concat([tre_in, ca_in], extra_tre),
    outputs: [tre_out, ca_out],
    mint: assets.zero,
  }
}

fn run_tre(channel: ByteArray, tx: Transaction) -> Bool {
  treasury.spend(
    tt_ca_sh, tt_lamp_policy, tt_lamp_name, Some(tt_tre_d(channel)), ReleaseForRedeem,
    util.mk_ref(0), tx,
  )
}

test treasury_happy() {
  // released 100; treasury TEAM LAMP 1000→900, ADA giữ; account cùng kênh TEAM.
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), tt_channel, 0, 100, [])
  run_tre(tt_channel, tx)
}

test treasury_channel_mismatch() fail {
  // account kênh RESERVE redeem từ treasury TEAM → reject (chống trộn 2 kênh).
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), tt_other_channel, 0, 100, [])
  run_tre(tt_channel, tx)
}

test treasury_physical_cap() fail {
  // LỚP B: treasury con chỉ có 100 LAMP (= budget vật lý). Redeem đòi released 150.
  // out.value phải = in.value − 150 LAMP = −50 LAMP. Mock dựng out=100 (giữ nguyên 100)
  // nhưng datum khai redeemed delta 150 → out.value ≠ in − released → reject.
  // Không thể dựng value LAMP âm → vật lý cản.
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 100), tt_lamp_val(5_000_000, 100), tt_channel, 0, 150, [])
  run_tre(tt_channel, tx)
}

test treasury_double_release() fail {
  // 2 treasury input cùng hash khác stake cred → count_inputs_at_script == 2 → reject.
  let tre_addr2 = util.script_address_staked(tt_tre_sh, #"5742")
  let extra =
    util.mk_input(util.mk_ref(9), util.mk_output(tre_addr2, tt_lamp_val(5_000_000, 1000), tt_tre_d(tt_channel)))
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 900), tt_channel, 0, 100, [extra])
  run_tre(tt_channel, tx)
}

test treasury_ada_drain() fail {
  // LAMP delta đúng nhưng rút bớt ADA → value sai → reject.
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(2_000_000, 900), tt_channel, 0, 100, [])
  run_tre(tt_channel, tx)
}

test treasury_zero_release() fail {
  // released 0 → reject.
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 1000), tt_channel, 100, 100, [])
  run_tre(tt_channel, tx)
}

test treasury_value_not_conserved() fail {
  // released 100 nhưng treasury chỉ giảm 50 (out 950) → value ≠ in − released → reject.
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 950), tt_channel, 0, 100, [])
  run_tre(tt_channel, tx)
}

// ══════════════════════════════════════════════════════════════
// ADVERSARIAL — Lớp B chặn drain dù entitlement bị thổi phồng (Vector F hậu quả).
// ══════════════════════════════════════════════════════════════

// Account TEAM có entitlement thổi phồng (qua Vector F) đòi release 2000 LAMP,
// nhưng treasury TEAM chỉ giữ 1000 (= budget vật lý). Kẻ tấn công CỐ giữ output
// value hợp lệ (non-negative): out giữ nguyên 1000 LAMP nhưng datum khai released
// 2000 → out.value(1000) ≠ in.value(1000) − 2000 = −1000 → reject. fail = chặn.
// (Phương án duy nhất để "qua" check là dựng out.value = −1000 LAMP, nhưng ledger
// Cardano cấm token-quantity âm → tx không thể nộp. Vật lý cản tuyệt đối.)
test atk_inflated_entitlement_capped_by_physical_treasury() fail {
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 1000), tt_channel, 0, 2000, [])
  run_tre(tt_channel, tx)
}

// Account TEAM (entitlement thổi phồng) cố rút từ treasury kênh RESERVE → reject
// (ca.channel_id TEAM ≠ treasury.channel_id RESERVE). Cross-channel bị chặn. fail.
test atk_inflated_team_cannot_touch_reserve_treasury() fail {
  let tx =
    treasury_tx(tt_other_channel, tt_lamp_val(5_000_000, 1_000_000), tt_lamp_val(5_000_000, 999_000), tt_channel, 0, 1000, [])
  run_tre(tt_other_channel, tx)
}

// ══════════════════════════════════════════════════════════════
// ADVERSARIAL cross-channel-mix (audit bổ sung) — lens donor/exact-cap.
// ══════════════════════════════════════════════════════════════

// XC-1: exact drain ĐÚNG biên — treasury TEAM giữ 1000, released 1000 → out 0 LAMP.
// Hợp lệ (không vượt budget vật lý). Đây là biên trên cùng kênh, KHÔNG phải lỗ hổng.
test xc1_exact_full_drain_same_channel() {
  let tx =
    treasury_tx(tt_channel, tt_lamp_val(5_000_000, 1000), tt_lamp_val(5_000_000, 0), tt_channel, 0, 1000, [])
  run_tre(tt_channel, tx)
}

// XC-2 (CỐT LÕI): "donor" cross-channel. Treasury TEAM (đang validate) chỉ giữ 100,
// account TEAM đòi released 600. Kẻ tấn công thêm 1 treasury RESERVE thứ 2 (cùng hash,
// KHÁC stake-cred) làm "nguồn bù" 500 vào output TEAM. Mục tiêu: out.value TEAM = in − 600
// nhờ nhặt LAMP từ treasury RESERVE.
// PHẢI bị chặn: count_inputs_at_script(own_hash)==2 (2 treasury cùng hash) → reject.
test xc2_cross_channel_donor_blocked() fail {
  let tre_addr = util.script_address(tt_tre_sh)
  let donor_addr = util.script_address_staked(tt_tre_sh, #"5742")
  let ca_addr = util.script_address(tt_ca_sh)
  let tre_in = util.mk_input(util.mk_ref(0), util.mk_output(tre_addr, tt_lamp_val(5_000_000, 100), tt_tre_d(tt_channel)))
  // gộp LAMP donor vào output treasury TEAM để value trông "đủ trừ 600"
  let tre_out = util.mk_output(tre_addr, tt_lamp_val(5_000_000, 0), tt_tre_d(tt_channel))
  let donor_in = util.mk_input(util.mk_ref(9), util.mk_output(donor_addr, tt_lamp_val(5_000_000, 1000), tt_tre_d(tt_other_channel)))
  let donor_out = util.mk_output(donor_addr, tt_lamp_val(5_000_000, 500), tt_tre_d(tt_other_channel))
  let ca_in = util.mk_input(util.mk_ref(1), util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(0, tt_channel)))
  let ca_out = util.mk_output(ca_addr, assets.from_lovelace(2_000_000), tt_ca_d(600, tt_channel))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tre_in, donor_in, ca_in],
      outputs: [tre_out, donor_out, ca_out],
      mint: assets.zero,
    }
  run_tre(tt_channel, tx)
}
