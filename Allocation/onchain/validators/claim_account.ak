// ClaimAccount validator — "Capped Drop" + HARD-CAP per-channel.
// Per-wallet account UTxO. 2 redeemer:
//   Claim  — committee threshold confirm → entitlement += amount. KHOÁ CHÉO:
//            BẮT BUỘC consume budget beacon đúng kênh (channel_budget trừ remaining).
//   Redeem — user tự tính vested on-chain (permissionless):
//            vested = min(E, D · drops_per_epoch · (current_epoch − start_epoch)),
//            rút redeemable = vested − redeemed từ treasury con CÙNG kênh.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/allocation/math
use magiclamp/allocation/types.{
  Claim, ClaimAccountDatum, ClaimAccountRedeemer, Redeem,
}
use magiclamp/allocation/util

validator claim_account(
  committee         : List<ByteArray>,
  threshold         : Int,
  ms_per_epoch      : Int,
  lamp_policy       : ByteArray,
  lamp_name         : ByteArray,
  drop_value        : Int,           // D (oil/drop·epoch) — tham số hoá (tất định).
  budget_nft_policy : ByteArray,     // policy NFT budget beacon one-shot (name = channel_id).
                                     // PHÁ VÒNG: claim_account CHỈ phụ thuộc budget_nft_policy
                                     // (đáy DAG) — BỎ channel_budget_hash (param chéo gây vòng).
) {
  spend(
    datum_opt : Option<ClaimAccountDatum>,
    redeemer  : ClaimAccountRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-MINT-0
    expect assets.is_zero(tx.mint)

    // Đúng 1 account input + 1 output theo SCRIPT HASH (chống double-satisfaction).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let acc_in = util.input_at_script(tx.inputs, own_hash)
    let acc_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(d) = acc_out.datum
    expect out_datum: ClaimAccountDatum = d

    // Account UTxO chỉ giữ min-ADA (không LAMP) — value bảo toàn tuyệt đối (C-VAL-0).
    expect acc_out.value == acc_in.value

    when redeemer is {
      // ── CLAIM (committee cấp/tăng entitlement, khoá chéo budget beacon) ──
      Claim { amount } -> {
        expect amount > 0
        expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold

        // entitlement += amount; field khác (kể cả channel_id) bất biến.
        expect out_datum.owner == datum.owner
        expect out_datum.entitlement == datum.entitlement + amount
        expect out_datum.redeemed == datum.redeemed
        expect out_datum.start_epoch == datum.start_epoch
        expect out_datum.drops_per_epoch == datum.drops_per_epoch
        expect out_datum.channel_id == datum.channel_id

        // KHOÁ CHÉO (VÁ Vector F qua NFT-beacon authenticity — PHÁ VÒNG):
        // BẮT BUỘC có đúng 1 INPUT mang budget NFT one-shot (budget_nft_policy, channel_id) qty 1.
        //
        // TẠI SAO ĐỦ AN TOÀN dù BỎ channel_budget_hash:
        //   - budget_nft là ONE-SHOT (genesis_ref): supply NFT (policy, channel_id) == 1 VĨNH VIỄN,
        //     không re-mint, không giả được (Vector F authenticity).
        //   - channel_budget.spend TỰ ÉP nó GIỮ NFT: input mang NFT + re-output mang NFT về
        //     CHÍNH channel_budget script (b_out.value == b_in.value) → NFT KHÔNG BAO GIỜ rời
        //     channel_budget script sau genesis (budget_nft genesis cũng ép NFT ra beacon).
        //   ⟹ "input mang NFT" ⟺ "channel_budget UTxO bị spend" ⟺ channel_budget.spend chạy
        //      → remaining_oil bị trừ + kiểm amount khớp entitlement-delta (khoá chéo nguyên vẹn).
        //   Không cần biết hash channel_budget: authenticity NFT thay thế script-hash param chéo.
        expect
          util.count_inputs_with_nft(
            tx.inputs,
            budget_nft_policy,
            datum.channel_id,
          ) == 1
        True
      }

      // ── REDEEM (permissionless, tự tính vested) ──
      Redeem -> {
        expect list.has(tx.extra_signatories, datum.owner)

        // D tham số hoá (tất định, không cần beacon ref input).
        expect drop_value > 0
        expect datum.drops_per_epoch > 0

        let current_epoch = util.get_epoch(tx, ms_per_epoch)
        let elapsed =
          if current_epoch > datum.start_epoch {
            current_epoch - datum.start_epoch
          } else {
            0
          }
        let raw = drop_value * datum.drops_per_epoch * elapsed
        let vested = math.clamp(raw, 0, datum.entitlement)

        let amount = vested - datum.redeemed
        expect amount > 0

        // chỉ redeemed đổi; owner/entitlement/start_epoch/drops_per_epoch/channel_id bất biến.
        expect out_datum.owner == datum.owner
        expect out_datum.entitlement == datum.entitlement
        expect out_datum.redeemed == datum.redeemed + amount
        expect out_datum.start_epoch == datum.start_epoch
        expect out_datum.drops_per_epoch == datum.drops_per_epoch
        expect out_datum.channel_id == datum.channel_id

        // owner nhận ĐÚNG (≥) amount LAMP. Treasury con cùng kênh ép bảo toàn value.
        expect util.lamp_to_owner(tx.outputs, datum.owner, lamp_policy, lamp_name) >= amount

        True
      }
    }
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const t_sh: ByteArray = #"a1a1a1a1"

const t_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const t_threshold: Int = 2

const t_mspe: Int = 86_400_000

const t_lamp_policy: ByteArray = #"1a3b"

const t_lamp_name: ByteArray = #"4c414d50"

const t_drop_value: Int = 100

const t_budget_policy: ByteArray = #"b00d"

const t_channel: ByteArray = #"5445414d"  // "TEAM"

const t_other_channel: ByteArray = #"5245534552564500"  // "RESERVE"

const t_owner: ByteArray = #"0a0a"

fn ca_datum(
  entitlement: Int,
  redeemed: Int,
  start_epoch: Int,
  dpe: Int,
  channel: ByteArray,
) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: t_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: start_epoch,
    drops_per_epoch: dpe,
    channel_id: channel,
  }
}

/// budget beacon input mang NFT one-shot name=channel (để Claim khoá chéo).
/// Ở channel_budget script (b1b1b1b1) — đây là nơi NFT one-shot bị đóng băng vĩnh viễn.
fn budget_beacon_input(channel: ByteArray) -> Input {
  let addr = util.script_address(#"b1b1b1b1")
  let val = assets.add(assets.from_lovelace(2_000_000), t_budget_policy, channel, 1)
  // datum tối giản (claim_account không đọc datum budget, chỉ kiểm NFT one-shot có mặt).
  util.mk_input(util.mk_ref(7), util.mk_output_no_datum(addr, val))
}

// ── CLAIM tx: account in/out + committee sigs + budget beacon input ──
fn claim_tx(
  in_d        : ClaimAccountDatum,
  out_d       : ClaimAccountDatum,
  sigs        : List<ByteArray>,
  out_value   : assets.Value,
  budget_ins  : List<Input>,
) -> Transaction {
  let acc_addr = util.script_address(t_sh)
  let in_val = assets.from_lovelace(2_000_000)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, in_val, in_d))
  let acc_out = util.mk_output(acc_addr, out_value, out_d)
  Transaction {
    ..placeholder,
    inputs: list.concat([acc_in], budget_ins),
    outputs: [acc_out],
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

fn run_claim(in_d: ClaimAccountDatum, amount: Int, tx: Transaction) -> Bool {
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_drop_value,
    t_budget_policy, Some(in_d), Claim { amount }, util.mk_ref(0), tx,
  )
}

test claim_happy_path() {
  // cấp E: 0 → 1000, kèm budget beacon TEAM.
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), [budget_beacon_input(t_channel)])
  run_claim(in_d, 1000, tx)
}

test claim_requires_budget_beacon() fail {
  // Claim KHÔNG kèm budget beacon → count_inputs_with_nft == 0 → reject.
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), [])
  run_claim(in_d, 1000, tx)
}

test claim_budget_wrong_channel() fail {
  // budget beacon kênh RESERVE nhưng account kênh TEAM → NFT name account-channel vắng → reject.
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), [budget_beacon_input(t_other_channel)])
  run_claim(in_d, 1000, tx)
}

test claim_channel_tamper() fail {
  // out.channel_id đổi (TEAM→RESERVE) → reject (kênh bất biến).
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_other_channel)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), [budget_beacon_input(t_channel)])
  run_claim(in_d, 1000, tx)
}

test claim_insufficient_committee() fail {
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let tx = claim_tx(in_d, out_d, [#"c1"], assets.from_lovelace(2_000_000), [budget_beacon_input(t_channel)])
  run_claim(in_d, 1000, tx)
}

test claim_value_tamper() fail {
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let tampered = assets.add(assets.from_lovelace(2_000_000), #"dead", #"beef", 1)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], tampered, [budget_beacon_input(t_channel)])
  run_claim(in_d, 1000, tx)
}

// ── REDEEM tx: account in/out + owner nhận LAMP (treasury con cùng kênh) ──
fn redeem_tx(
  in_d           : ClaimAccountDatum,
  out_d          : ClaimAccountDatum,
  owner_lamp_out : Int,
  current_epoch  : Int,
  sigs           : List<ByteArray>,
  extra_outs     : List<Output>,
) -> Transaction {
  let acc_addr = util.script_address(t_sh)
  let val = assets.from_lovelace(2_000_000)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, val, in_d))
  let acc_out = util.mk_output(acc_addr, val, out_d)
  let owner_val =
    assets.add(assets.from_lovelace(2_000_000), t_lamp_policy, t_lamp_name, owner_lamp_out)
  let owner_out = util.mk_output(util.vk_address(t_owner), owner_val, in_d)
  Transaction {
    ..placeholder,
    inputs: [acc_in],
    outputs: list.concat([acc_out, owner_out], extra_outs),
    extra_signatories: sigs,
    validity_range: interval.after(current_epoch * t_mspe),
    mint: assets.zero,
  }
}

fn run_redeem(in_d: ClaimAccountDatum, tx: Transaction) -> Bool {
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_drop_value,
    t_budget_policy, Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_happy() {
  // E=1000, D=100, dpe=1, start=0, epoch=3 → vested=300, amount=300.
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 300, 0, 1, t_channel)
  let tx = redeem_tx(in_d, out_d, 300, 3, [t_owner], [])
  run_redeem(in_d, tx)
}

test redeem_multi_claim_accumulate() {
  // cộng dồn 3 đợt → tổng 1000 = E.
  let d1_in = ca_datum(1000, 0, 0, 1, t_channel)
  let d1_out = ca_datum(1000, 200, 0, 1, t_channel)
  let r1 = run_redeem(d1_in, redeem_tx(d1_in, d1_out, 200, 2, [t_owner], []))
  let d2_in = ca_datum(1000, 200, 0, 1, t_channel)
  let d2_out = ca_datum(1000, 500, 0, 1, t_channel)
  let r2 = run_redeem(d2_in, redeem_tx(d2_in, d2_out, 300, 5, [t_owner], []))
  let d3_in = ca_datum(1000, 500, 0, 1, t_channel)
  let d3_out = ca_datum(1000, 1000, 0, 1, t_channel)
  let r3 = run_redeem(d3_in, redeem_tx(d3_in, d3_out, 500, 20, [t_owner], []))
  r1 && r2 && r3
}

test redeem_vested_capped_at_E() {
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 1000, 0, 1, t_channel)
  let tx = redeem_tx(in_d, out_d, 1000, 50, [t_owner], [])
  run_redeem(in_d, tx)
}

test redeem_over_cap_rejected() fail {
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 1500, 0, 1, t_channel)
  let tx = redeem_tx(in_d, out_d, 1500, 50, [t_owner], [])
  run_redeem(in_d, tx)
}

test redeem_nothing_vested_rejected() fail {
  let in_d = ca_datum(1000, 500, 0, 1, t_channel)
  let out_d = ca_datum(1000, 500, 0, 1, t_channel)
  let tx = redeem_tx(in_d, out_d, 0, 5, [t_owner], [])
  run_redeem(in_d, tx)
}

test redeem_no_owner_sig() fail {
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 300, 0, 1, t_channel)
  let tx = redeem_tx(in_d, out_d, 300, 3, [], [])
  run_redeem(in_d, tx)
}

test redeem_channel_tamper() fail {
  // out.channel_id đổi khi Redeem → reject.
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 300, 0, 1, t_other_channel)
  let tx = redeem_tx(in_d, out_d, 300, 3, [t_owner], [])
  run_redeem(in_d, tx)
}

test redeem_double_satisfaction() fail {
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 300, 0, 1, t_channel)
  let dup_addr = util.script_address_staked(t_sh, #"5742")
  let dup_out = util.mk_output(dup_addr, assets.from_lovelace(2_000_000), out_d)
  let tx = redeem_tx(in_d, out_d, 300, 3, [t_owner], [dup_out])
  run_redeem(in_d, tx)
}

test redeem_mint_rejected() fail {
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 300, 0, 1, t_channel)
  let base = redeem_tx(in_d, out_d, 300, 3, [t_owner], [])
  let tx = Transaction { ..base, mint: assets.add(assets.zero, #"dead", #"beef", 1) }
  run_redeem(in_d, tx)
}

// ══════════════════════════════════════════════════════════════
// ADVERSARIAL — lens "drain-budget" (red-team). Test KHÔNG `fail` mà PASS
// = exploit thành công (validator nhận tx độc). Có `fail` = bị chặn.
// ══════════════════════════════════════════════════════════════

/// budget NFT name=channel nằm ở VÍ THƯỜNG (VerificationKey), KHÔNG ở channel_budget.
fn budget_nft_in_wallet(channel: ByteArray, holder: ByteArray) -> Input {
  let val = assets.add(assets.from_lovelace(2_000_000), t_budget_policy, channel, 1)
  util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.vk_address(holder), val))
}

// VECTOR F — MÔ HÌNH BẢO MẬT MỚI (NFT-beacon authenticity thay script-hash param chéo).
//
// PHÁ VÒNG: claim_account BỎ channel_budget_hash, chỉ đếm count_inputs_with_nft (đáy DAG).
// claim_account 1 MÌNH KHÔNG còn ép NFT phải ở channel_budget script — nên xét RIÊNG nó,
// tx mang NFT ở VÍ THƯỜNG SẼ qua check NFT (test này PASS, không fail).
//
// VÌ SAO VẪN AN TOÀN (Vector F bịt ở TẦNG HỆ THỐNG, không ở claim_account đơn lẻ):
//   1. budget_nft ONE-SHOT: supply NFT (policy, channel_id) == 1 VĨNH VIỄN. genesis ÉP
//      NFT ra ĐÚNG 1 beacon output mang ChannelBudgetDatum (budget_nft.ak).
//   2. channel_budget.spend ÉP b_out.value == b_in.value ⟹ NFT LUÔN re-output về channel_budget
//      script. KHÔNG có đường nào để NFT rời channel_budget ra ví thường/script khác.
//   ⟹ Trạng thái "NFT ở ví thường" (test bên dưới) là BẤT KHẢ ĐẠT trên chain thật.
//      Hễ NFT bị spend ⟺ channel_budget UTxO bị spend ⟺ channel_budget.spend chạy → trừ remaining.
//
// Test này GIỮ LẠI để tài liệu hoá: claim_account đơn lẻ KHÔNG phân biệt vị trí NFT (PASS),
// và chứng minh khoá chéo KHÔNG còn dựa hash param (đã phá vòng). An toàn = bất biến one-shot
// + channel_budget tự giữ NFT, KHÔNG phải check trong claim_account.
test claim_account_alone_accepts_nft_anywhere() {
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let tx =
    claim_tx(
      in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000),
      [budget_nft_in_wallet(t_channel, #"deadbeef")],
    )
  run_claim(in_d, 1000, tx)
}

// CHỨNG MINH happy-path: NFT đúng kênh, ở channel_budget script (đường duy nhất khả thi) → pass.
test claim_beacon_at_channel_budget_script_passes() {
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  // budget_beacon_input dùng util.script_address(#"b1b1b1b1") — channel_budget script.
  let tx =
    claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), [budget_beacon_input(t_channel)])
  run_claim(in_d, 1000, tx)
}

// VECTOR — batched double-claim: 2 ClaimAccount cùng hash trong 1 tx, 1 beacon.
// claim_account count_inputs_at_script==2 → reject. fail = chặn.
test atk_two_accounts_one_budget_blocked() fail {
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let acc_addr = util.script_address(t_sh)
  let v = assets.from_lovelace(2_000_000)
  let acc_in1 = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, v, in_d))
  let acc_in2 = util.mk_input(util.mk_ref(3), util.mk_output(acc_addr, v, in_d))
  let acc_out1 = util.mk_output(acc_addr, v, out_d)
  let acc_out2 = util.mk_output(acc_addr, v, out_d)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [acc_in1, acc_in2, budget_beacon_input(t_channel)],
      outputs: [acc_out1, acc_out2],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  run_claim(in_d, 1000, tx)
}

// VECTOR — beacon là REFERENCE input (không spend) → count_inputs_with_nft==0 → reject.
test atk_beacon_reference_only_blocked() fail {
  let in_d = ca_datum(0, 0, 5, 1, t_channel)
  let out_d = ca_datum(1000, 0, 5, 1, t_channel)
  let acc_addr = util.script_address(t_sh)
  let v = assets.from_lovelace(2_000_000)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, v, in_d))
  let acc_out = util.mk_output(acc_addr, v, out_d)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [acc_in],
      reference_inputs: [budget_beacon_input(t_channel)],
      outputs: [acc_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  run_claim(in_d, 1000, tx)
}

// VECTOR — Redeem tự cấp LAMP (không treasury). redeemed++ nhưng treasury không spend.
// Tự đốt vested của chính account, KHÔNG rút được gì từ Treasury → vô hại (không drain).
// PASS = claim_account Redeem 1 mình không ép treasury (cần treasury con để bảo toàn).
test atk_redeem_self_funded_no_treasury() {
  let in_d = ca_datum(1000, 0, 0, 1, t_channel)
  let out_d = ca_datum(1000, 300, 0, 1, t_channel)
  let tx = redeem_tx(in_d, out_d, 300, 3, [t_owner], [])
  run_redeem(in_d, tx)
}
