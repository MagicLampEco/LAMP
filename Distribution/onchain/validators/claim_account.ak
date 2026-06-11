// ClaimAccount validator — CONTRACT v2 "Capped Drop" (tất định).
// Per-wallet account UTxO. 2 redeemer:
//   Claim  — committee 2/3 confirm activity → entitlement += amount (cấp/tăng E).
//   Redeem — user tự tính vested on-chain (permissionless, không proof/committee):
//            vested = min(E, D · drops_per_epoch · (current_epoch − start_epoch)),
//            rút redeemable = vested − redeemed từ treasury cùng tx.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/lampdist/math
use magiclamp/lampdist/types.{
  BeaconDatum, Claim, ClaimAccountDatum, ClaimAccountRedeemer, DropParam, Redeem,
  TreasuryDatum,
}
use magiclamp/lampdist/util

validator claim_account(
  committee           : List<ByteArray>,
  threshold           : Int,
  ms_per_epoch        : Int,
  lamp_policy         : ByteArray,
  lamp_name           : ByteArray,
  beacon_nft_policy   : ByteArray,
  treasury_nft_policy : ByteArray,
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

    // C-MINT-0: account validator không liên quan mint
    expect assets.is_zero(tx.mint)

    // C-CLAIM-5 / C-RDM-7: đúng 1 account input + 1 output theo SCRIPT HASH
    // (chống double-satisfaction qua stake credential — audit C1).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let acc_in = util.input_at_script(tx.inputs, own_hash)
    let acc_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(d) = acc_out.datum
    expect out_datum: ClaimAccountDatum = d

    // Account UTxO chỉ giữ min-ADA (không LAMP) — value bảo toàn tuyệt đối,
    // chống chèn/rút asset lạ (C-VAL-0).
    expect acc_out.value == acc_in.value

    when redeemer is {
      // ── CLAIM (committee cấp/tăng entitlement) ─────────────
      Claim { amount } -> {
        expect amount > 0
        // C-CLAIM-1
        expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold
        // C-CLAIM-2/3/4: entitlement += amount; các field khác bất biến.
        expect out_datum.owner == datum.owner
        expect out_datum.entitlement == datum.entitlement + amount
        expect out_datum.redeemed == datum.redeemed
        expect out_datum.start_epoch == datum.start_epoch
        expect out_datum.drops_per_epoch == datum.drops_per_epoch

        // C-SOLV-1 (binding): MỌI Claim PHẢI co-spend treasury (GrantEntitlement) và
        // dồn cumulative_entitlement đúng `amount`. Ngăn committee tăng E mà KHÔNG
        // cập nhật sổ cái solvency (bypass bất biến cum ≤ pool). Treasury authenticity
        // qua NFT "TRSY" → chống treasury giả. treasury validator độc lập ép cum ≤ pool
        // + value bảo toàn (C-SOLV-2/C-VAL-0); ở đây chỉ ràng buộc amount nhất quán.
        let tre_in_cum = find_treasury_cum(tx.inputs, treasury_nft_policy)
        let tre_out_cum = find_treasury_out_cum(tx.outputs, treasury_nft_policy)
        expect tre_out_cum == tre_in_cum + amount

        True
      }

      // ── REDEEM (permissionless, tự tính vested) ────────────
      Redeem -> {
        // C-RDM-6: owner ký
        expect list.has(tx.extra_signatories, datum.owner)

        // C-SOLV-4 (TRSY binding redeem): treasury co-spend PHẢI là treasury canonical
        // mang đúng 1 NFT "TRSY". Đối xứng với Claim path — chống redeem rút từ treasury
        // giả (cùng script-hash, pool LAMP fake). find_treasury_cum ép đúng 1 input TRSY;
        // sổ cái cumulative_entitlement bảo toàn khi redeem (C-SOLV-3, treasury.ak ép).
        // Assert cum_in == cum_out để (a) buộc đánh giá find_treasury_*, (b) chốt thêm
        // C-SOLV-3 từ phía account (treasury.ak vốn đã ép, đây là defense-in-depth).
        let trsy_cum_in = find_treasury_cum(tx.inputs, treasury_nft_policy)
        let trsy_cum_out = find_treasury_out_cum(tx.outputs, treasury_nft_policy)
        expect trsy_cum_out == trsy_cum_in

        // C-RDM-1: D đọc từ DropParam beacon qua reference input (authenticity NFT).
        let drop_value = find_drop_value(tx.reference_inputs, beacon_nft_policy)
        expect drop_value > 0
        expect datum.drops_per_epoch > 0

        // current_epoch từ validity range lower bound.
        let current_epoch = util.get_epoch(tx, ms_per_epoch)
        // elapsed = max(0, current_epoch − start_epoch). vested cộng dồn, cap E.
        let elapsed =
          if current_epoch > datum.start_epoch {
            current_epoch - datum.start_epoch
          } else {
            0
          }
        let raw = drop_value * datum.drops_per_epoch * elapsed
        // vested = min(E, raw) — đơn điệu tăng theo t, không vượt entitlement.
        let vested = math.clamp(raw, 0, datum.entitlement)

        // C-RDM-2: redeemable > 0 (chặn redeem khi vested == redeemed).
        let amount = vested - datum.redeemed
        expect amount > 0

        // C-RDM-4: chỉ redeemed đổi; owner/entitlement/start_epoch/drops_per_epoch bất biến.
        expect out_datum.owner == datum.owner
        expect out_datum.entitlement == datum.entitlement
        expect out_datum.redeemed == datum.redeemed + amount
        expect out_datum.start_epoch == datum.start_epoch
        expect out_datum.drops_per_epoch == datum.drops_per_epoch

        // C-RDM-3: owner nhận ĐÚNG (≥) amount LAMP. Bảo toàn value treasury do
        // treasury.ak ép tre_out = tre_in − (redeemed_out − redeemed_in); chống
        // double-satisfaction theo payment script hash ở cả 2 validator.
        expect util.lamp_to_owner(tx.outputs, datum.owner, lamp_policy, lamp_name) >= amount

        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// Đọc D từ reference input mang beacon NFT (kind=DropParam).
/// Authenticity qua NFT → chống datum hijacking (fake beacon ở cùng address).
fn find_drop_value(
  ref_inputs        : List<Input>,
  beacon_nft_policy : ByteArray,
) -> Int {
  let drop_name = util.beacon_name(DropParam)
  expect Some(ri) =
    list.find(
      ref_inputs,
      fn(i) { assets.quantity_of(i.output.value, beacon_nft_policy, drop_name) == 1 },
    )
  expect InlineDatum(d) = ri.output.datum
  expect bd: BeaconDatum = d
  expect bd.kind == DropParam
  bd.drop_value
}

/// cumulative_entitlement của treasury INPUT mang NFT "TRSY" (authenticity).
/// Đúng 1 treasury input theo NFT (chống treasury giả + chống 2 sổ cái nhập nhằng).
fn find_treasury_cum(inputs: List<Input>, treasury_nft_policy: ByteArray) -> Int {
  let name = util.treasury_nft_name()
  expect [i] =
    list.filter(
      inputs,
      fn(x) { assets.quantity_of(x.output.value, treasury_nft_policy, name) == 1 },
    )
  expect InlineDatum(d) = i.output.datum
  expect td: TreasuryDatum = d
  td.cumulative_entitlement
}

/// cumulative_entitlement của treasury OUTPUT mang NFT "TRSY". Đúng 1 (NFT đi cùng).
fn find_treasury_out_cum(outputs: List<Output>, treasury_nft_policy: ByteArray) -> Int {
  let name = util.treasury_nft_name()
  expect [o] =
    list.filter(
      outputs,
      fn(x) { assets.quantity_of(x.value, treasury_nft_policy, name) == 1 },
    )
  expect InlineDatum(d) = o.datum
  expect td: TreasuryDatum = d
  td.cumulative_entitlement
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

const t_beacon_policy: ByteArray = #"beac"

const t_treasury_nft_policy: ByteArray = #"7235"

const t_treasury_sh: ByteArray = #"77777777"

const t_owner: ByteArray = #"0a0a"

fn ca_datum(
  entitlement: Int,
  redeemed: Int,
  start_epoch: Int,
  dpe: Int,
) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner: t_owner,
    entitlement: entitlement,
    redeemed: redeemed,
    start_epoch: start_epoch,
    drops_per_epoch: dpe,
  }
}

/// treasury UTxO mang NFT "TRSY" + cumulative_entitlement (sổ cái solvency).
fn treasury_io(cum_in: Int, cum_out: Int, pool: Int) -> (Input, Output) {
  let addr = util.script_address(t_treasury_sh)
  let val =
    assets.from_lovelace(2_000_000)
      |> assets.add(t_treasury_nft_policy, util.treasury_nft_name(), 1)
      |> assets.add(t_lamp_policy, t_lamp_name, pool)
  let d_in = TreasuryDatum { committee_hash: #"cccc", cumulative_entitlement: cum_in }
  let d_out = TreasuryDatum { committee_hash: #"cccc", cumulative_entitlement: cum_out }
  let tre_in = util.mk_input(util.mk_ref(8), util.mk_output(addr, val, d_in))
  let tre_out = util.mk_output(addr, val, d_out)
  (tre_in, tre_out)
}

// ── CLAIM tx: 1 account in/out + treasury co-spend (cum += amount), committee sigs ──
fn claim_tx(
  in_d      : ClaimAccountDatum,
  out_d     : ClaimAccountDatum,
  sigs      : List<ByteArray>,
  out_value : assets.Value,
  cum_in    : Int,
  cum_out   : Int,
  pool      : Int,
) -> Transaction {
  let acc_addr = util.script_address(t_sh)
  let in_val = assets.from_lovelace(2_000_000)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, in_val, in_d))
  let acc_out = util.mk_output(acc_addr, out_value, out_d)
  let (tre_in, tre_out) = treasury_io(cum_in, cum_out, pool)
  Transaction {
    ..placeholder,
    inputs: [acc_in, tre_in],
    outputs: [acc_out, tre_out],
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

test claim_happy_path() {
  // cấp E: 0 → 1000; treasury cum 0 → 1000 ≤ pool 5000.
  let in_d = ca_datum(0, 0, 5, 1)
  let out_d = ca_datum(1000, 0, 5, 1)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), 0, 1000, 5000)
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, Some(in_d), Claim { amount: 1000 }, util.mk_ref(0), tx,
  )
}

test claim_insufficient_committee() fail {
  let in_d = ca_datum(0, 0, 5, 1)
  let out_d = ca_datum(1000, 0, 5, 1)
  // chỉ 1 committee sig < threshold 2 → reject
  let tx = claim_tx(in_d, out_d, [#"c1"], assets.from_lovelace(2_000_000), 0, 1000, 5000)
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, Some(in_d), Claim { amount: 1000 }, util.mk_ref(0), tx,
  )
}

test claim_value_tamper() fail {
  let in_d = ca_datum(0, 0, 5, 1)
  let out_d = ca_datum(1000, 0, 5, 1)
  // output nhét token lạ → acc_out.value != acc_in.value → reject (C-VAL-0)
  let tampered = assets.add(assets.from_lovelace(2_000_000), #"dead", #"beef", 1)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], tampered, 0, 1000, 5000)
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, Some(in_d), Claim { amount: 1000 }, util.mk_ref(0), tx,
  )
}

test claim_cumulative_not_updated() fail {
  // C-SOLV-1: entitlement +1000 nhưng treasury cum KHÔNG tăng (0→0) → bind reject.
  let in_d = ca_datum(0, 0, 5, 1)
  let out_d = ca_datum(1000, 0, 5, 1)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), 0, 0, 5000)
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, Some(in_d), Claim { amount: 1000 }, util.mk_ref(0), tx,
  )
}

test claim_cumulative_wrong_delta() fail {
  // C-SOLV-1: cum tăng 999 ≠ amount 1000 → reject.
  let in_d = ca_datum(0, 0, 5, 1)
  let out_d = ca_datum(1000, 0, 5, 1)
  let tx = claim_tx(in_d, out_d, [#"c1", #"c2"], assets.from_lovelace(2_000_000), 0, 999, 5000)
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy, Some(in_d), Claim { amount: 1000 }, util.mk_ref(0), tx,
  )
}

// ── REDEEM tx: account in/out + owner nhận LAMP + DropParam beacon ref input ──
fn redeem_tx(
  in_d           : ClaimAccountDatum,
  out_d          : ClaimAccountDatum,
  owner_lamp_out : Int,
  drop_value     : Int,
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
  // beacon reference input mang NFT DropParam
  let beacon_addr = util.script_address(#"bbbbbbbb")
  let beacon_val =
    assets.add(assets.from_lovelace(2_000_000), t_beacon_policy, util.beacon_name(DropParam), 1)
  let beacon_datum = BeaconDatum { epoch: 0, kind: DropParam, drop_value: drop_value }
  let beacon_ref =
    util.mk_input(util.mk_ref(5), util.mk_output(beacon_addr, beacon_val, beacon_datum))
  // treasury co-spend in+out mang NFT TRSY (authenticity, C-SOLV-4 redeem binding).
  // cum bảo toàn (0→0) → claim_account chỉ assert authenticity + C-SOLV-3.
  let (tre_in, tre_out) = treasury_io(0, 0, 100_000)
  Transaction {
    ..placeholder,
    inputs: [acc_in, tre_in],
    reference_inputs: [beacon_ref],
    outputs: list.concat([acc_out, owner_out, tre_out], extra_outs),
    extra_signatories: sigs,
    validity_range: interval.after(current_epoch * t_mspe),
    mint: assets.zero,
  }
}

test redeem_happy() {
  // E=1000, D=100, dpe=1, start=0, epoch=3 → vested=min(1000, 300)=300, redeemed=0 → amount=300.
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 300, 0, 1)
  let tx = redeem_tx(in_d, out_d, 300, 100, 3, [t_owner], [])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_small_entitlement_full_first_epoch() {
  // E=50 < D=100 → vested=min(50, 100·1·1)=50 ngay epoch đầu (elapsed=1) → amount=50.
  let in_d = ca_datum(50, 0, 0, 1)
  let out_d = ca_datum(50, 50, 0, 1)
  let tx = redeem_tx(in_d, out_d, 50, 100, 1, [t_owner], [])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_multi_claim_accumulate() {
  // Đa-claim cộng dồn 3 đợt. E=1000, D=100, dpe=1, start=0.
  // Đợt 1: epoch=2 → vested=200, redeemed 0→200, amount=200.
  let d1_in = ca_datum(1000, 0, 0, 1)
  let d1_out = ca_datum(1000, 200, 0, 1)
  let tx1 = redeem_tx(d1_in, d1_out, 200, 100, 2, [t_owner], [])
  let r1 =
    claim_account.spend(
      t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
      Some(d1_in), Redeem, util.mk_ref(0), tx1,
    )
  // Đợt 2: epoch=5 → vested=500, redeemed 200→500, amount=300.
  let d2_in = ca_datum(1000, 200, 0, 1)
  let d2_out = ca_datum(1000, 500, 0, 1)
  let tx2 = redeem_tx(d2_in, d2_out, 300, 100, 5, [t_owner], [])
  let r2 =
    claim_account.spend(
      t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
      Some(d2_in), Redeem, util.mk_ref(0), tx2,
    )
  // Đợt 3: epoch=20 → raw=2000, vested=min(1000,2000)=1000, redeemed 500→1000, amount=500.
  let d3_in = ca_datum(1000, 500, 0, 1)
  let d3_out = ca_datum(1000, 1000, 0, 1)
  let tx3 = redeem_tx(d3_in, d3_out, 500, 100, 20, [t_owner], [])
  let r3 =
    claim_account.spend(
      t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
      Some(d3_in), Redeem, util.mk_ref(0), tx3,
    )
  // tổng nhận = 200+300+500 = 1000 = E (cap chính xác).
  r1 && r2 && r3
}

test redeem_vested_capped_at_E() {
  // epoch xa (50) → raw=5000 nhưng vested cap E=1000. redeemed 0→1000, amount=1000.
  // out.redeemed = 1001 (vượt E) phải reject; ở đây out.redeemed=1000 hợp lệ → pass.
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 1000, 0, 1)
  let tx = redeem_tx(in_d, out_d, 1000, 100, 50, [t_owner], [])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_over_cap_rejected() fail {
  // vested cap = 1000 nhưng out.redeemed khai 1500 (> vested) → amount sai → reject.
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 1500, 0, 1)
  let tx = redeem_tx(in_d, out_d, 1500, 100, 50, [t_owner], [])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_nothing_vested_rejected() fail {
  // vested == redeemed → amount=0 → expect amount > 0 reject.
  // E=1000, D=100, epoch=5 → vested=500, redeemed đã =500 → amount=0.
  let in_d = ca_datum(1000, 500, 0, 1)
  let out_d = ca_datum(1000, 500, 0, 1)
  let tx = redeem_tx(in_d, out_d, 0, 100, 5, [t_owner], [])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_no_owner_sig() fail {
  // không có owner trong extra_signatories → reject (C-RDM-6)
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 300, 0, 1)
  let tx = redeem_tx(in_d, out_d, 300, 100, 3, [], [])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_double_satisfaction() fail {
  // 2 account output cùng script hash (khác stake cred) → count_outputs_at_script == 2 → reject.
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 300, 0, 1)
  // output account thứ 2 trùng script hash t_sh, khác stake cred → vẫn is_at_script.
  let dup_addr = util.script_address_staked(t_sh, #"5742")
  let dup_out = util.mk_output(dup_addr, assets.from_lovelace(2_000_000), out_d)
  let tx = redeem_tx(in_d, out_d, 300, 100, 3, [t_owner], [dup_out])
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_mint_rejected() fail {
  // tx có mint ≠ 0 → expect assets.is_zero(tx.mint) reject (C-MINT-0).
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 300, 0, 1)
  let base = redeem_tx(in_d, out_d, 300, 100, 3, [t_owner], [])
  let tx = Transaction { ..base, mint: assets.add(assets.zero, #"dead", #"beef", 1) }
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}

test redeem_fake_treasury_no_trsy_rejected() fail {
  // C-SOLV-4: treasury input KHÔNG mang NFT TRSY (treasury giả cùng script-hash, pool
  // LAMP fake) → find_treasury_cum không tìm thấy input TRSY nào → reject. Chống rút
  // redeem từ treasury giả (đối xứng Claim path).
  let in_d = ca_datum(1000, 0, 0, 1)
  let out_d = ca_datum(1000, 300, 0, 1)
  // tx KHÔNG có treasury TRSY: thay acc_in + 1 input ví thường (không NFT).
  let acc_addr = util.script_address(t_sh)
  let val = assets.from_lovelace(2_000_000)
  let acc_in = util.mk_input(util.mk_ref(0), util.mk_output(acc_addr, val, in_d))
  let acc_out = util.mk_output(acc_addr, val, out_d)
  let owner_val =
    assets.add(assets.from_lovelace(2_000_000), t_lamp_policy, t_lamp_name, 300)
  let owner_out = util.mk_output(util.vk_address(t_owner), owner_val, in_d)
  let beacon_addr = util.script_address(#"bbbbbbbb")
  let beacon_val =
    assets.add(assets.from_lovelace(2_000_000), t_beacon_policy, util.beacon_name(DropParam), 1)
  let beacon_datum = BeaconDatum { epoch: 0, kind: DropParam, drop_value: 100 }
  let beacon_ref =
    util.mk_input(util.mk_ref(5), util.mk_output(beacon_addr, beacon_val, beacon_datum))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [acc_in],
      reference_inputs: [beacon_ref],
      outputs: [acc_out, owner_out],
      extra_signatories: [t_owner],
      validity_range: interval.after(3 * t_mspe),
      mint: assets.zero,
    }
  claim_account.spend(
    t_committee, t_threshold, t_mspe, t_lamp_policy, t_lamp_name, t_beacon_policy,
    t_treasury_nft_policy,
    Some(in_d), Redeem, util.mk_ref(0), tx,
  )
}
