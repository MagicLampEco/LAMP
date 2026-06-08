// Faucet validator — pool tLAMP fixed-supply, nhả ĐÚNG claim_amount mỗi Claim.
//
// MÔ HÌNH (first-principles):
//   tLAMP đã mint hết 1 lần vào pool UTxO (one-shot, tlamp_policy). Faucet KHÔNG
//   mint — chỉ chuyển token TỪ pool SANG người claim. Fixed-supply bảo toàn tuyệt
//   đối: Σ tLAMP trước = sau, chỉ đổi vị trí (pool → claimer). KHÔNG burn.
//
// REDEEMER Claim (permissionless): bất kỳ dev nào cũng claim được claim_amount
// (MVP = 100 tLAMP). Token test vô giá trị → không cần committee/cooldown để MVP
// chạy. (Cooldown per-address có thể thêm v1.1 — ghi rõ ở CONTRACT.md, KHÔNG MVP.)
//
// BẤT BIẾN (self-audit a/b/c/d):
//   C-FAU-0  KHÔNG mint trong tx Claim (assets.is_zero(tx.mint)).
//   C-FAU-1  ĐÚNG 1 pool input + 1 pool output theo SCRIPT HASH (chống double-
//            satisfaction qua stake cred / nhiều pool UTxO trong 1 tx).
//   C-FAU-2  datum bảo toàn: pool_out.claim_amount == pool_in.claim_amount
//            (chống đổi claim_amount để drain nhiều hơn ở claim sau).
//   C-FAU-3  VALUE bảo toàn tuyệt đối: pool_out.value == pool_in.value với
//            tLAMP giảm ĐÚNG claim_amount. Mọi asset khác (ADA, dust) bảo toàn
//            → chống drain ADA / lấy >100 / lấy asset khác.
//   claim_amount > 0 (chống datum bịa claim_amount ≤ 0).

use aiken/collection/list
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/faucet/types.{Claim, FaucetDatum, FaucetRedeemer}
use magiclamp/faucet/util

validator faucet(tlamp_policy: ByteArray, tlamp_name: ByteArray) {
  spend(
    datum_opt: Option<FaucetDatum>,
    _redeemer: FaucetRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-FAU-0: Faucet KHÔNG mint (nhả từ pool, không tạo token mới).
    expect assets.is_zero(tx.mint)

    // claim_amount hợp lệ.
    expect datum.claim_amount > 0

    // C-FAU-1: đúng 1 pool input + 1 pool output theo script hash.
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    let pool_in = util.input_at_script(tx.inputs, own_hash)
    let pool_out = util.output_at_script(tx.outputs, own_hash)

    // C-FAU-2: datum bảo toàn (claim_amount không đổi).
    expect InlineDatum(od) = pool_out.datum
    expect out_datum: FaucetDatum = od
    expect out_datum.claim_amount == datum.claim_amount

    // C-FAU-3: value bảo toàn — pool_out == pool_in với tLAMP −claim_amount.
    // assets.add(v, policy, name, -q) trừ đúng q tLAMP, giữ NGUYÊN mọi asset
    // khác (ADA, dust). Bất kỳ sai lệch (lấy >100, lấy ADA, lấy asset khác,
    // nhả <100) → value ≠ → reject.
    expect
      pool_out.value == assets.add(
        pool_in.value,
        tlamp_policy,
        tlamp_name,
        -datum.claim_amount,
      )

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction) — self-audit a/b/c/d
// ══════════════════════════════════════════════════════════════

const ft_pool_sh: ByteArray = #"facade"

const ft_tlamp_policy: ByteArray = #"1a3b"

const ft_tlamp_name: ByteArray = #"744c414d50"

// 100 tLAMP = 100 × 10^6 oil.
const ft_claim: Int = 100_000_000

fn ft_datum() -> FaucetDatum {
  FaucetDatum { claim_amount: ft_claim }
}

fn ft_datum_amt(amt: Int) -> FaucetDatum {
  FaucetDatum { claim_amount: amt }
}

/// pool value: lovelace + tLAMP qty.
fn ft_pool_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), ft_tlamp_policy, ft_tlamp_name, tlamp)
}

/// Dựng tx Claim: pool_in_val → pool_out_val, datum in/out, mint, extra pool inputs.
fn faucet_tx(
  pool_in_val: assets.Value,
  pool_out_val: assets.Value,
  d_in: FaucetDatum,
  d_out: FaucetDatum,
  mint: assets.Value,
  extra_pool: List<Input>,
) -> Transaction {
  let pool_addr = util.script_address(ft_pool_sh)
  let pool_in = util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, pool_in_val, d_in))
  let pool_out = util.mk_output(pool_addr, pool_out_val, d_out)
  // claimer nhận token (output ví thường — không bị validator kiểm, value tx tự cân).
  let claimer = util.mk_output_no_datum(util.vk_address(#"c1"), assets.from_lovelace(2_000_000))
  Transaction {
    ..placeholder,
    inputs: list.concat([pool_in], extra_pool),
    outputs: [pool_out, claimer],
    mint: mint,
  }
}

test claim_happy() {
  // pool 1_000_000 tLAMP → 999_999_900 (−100); ADA giữ nguyên; datum giữ; no mint.
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - ft_claim),
      ft_datum(),
      ft_datum(),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_too_much() fail {
  // (b) drain >100: nhả 200 tLAMP nhưng datum claim_amount=100 → value ≠ → reject.
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - 200_000_000),
      ft_datum(),
      ft_datum(),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_too_little() fail {
  // nhả <100 (50) → pool_out cao hơn mong đợi → value ≠ → reject.
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - 50_000_000),
      ft_datum(),
      ft_datum(),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_drain_ada() fail {
  // (b) lấy ADA: tLAMP delta đúng (−100) NHƯNG rút ADA 10M→2M → value ≠ → reject.
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(2_000_000, 1_000_000_000 - ft_claim),
      ft_datum(),
      ft_datum(),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_steal_other_asset() fail {
  // (b) lấy asset khác: pool có dust DUST, claim lấy luôn dust → value ≠ → reject.
  let dust_policy: ByteArray = #"dddd"
  let dust_name: ByteArray = #"f00d"
  let pool_in =
    ft_pool_val(10_000_000, 1_000_000_000)
      |> assets.add(dust_policy, dust_name, 5)
  // out thiếu dust → value ≠ pool_in − 100tLAMP (vẫn còn dust 5).
  let pool_out = ft_pool_val(10_000_000, 1_000_000_000 - ft_claim)
  let tx = faucet_tx(pool_in, pool_out, ft_datum(), ft_datum(), assets.zero, [])
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_mint_rejected() fail {
  // (a/c) tx Claim mà mint thêm tLAMP → C-FAU-0 reject (fixed-supply không tăng).
  let mint = assets.zero |> assets.add(ft_tlamp_policy, ft_tlamp_name, 100_000_000)
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - ft_claim),
      ft_datum(),
      ft_datum(),
      mint,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_datum_tamper() fail {
  // (c) đổi claim_amount ở output (100→1000) để claim sau drain nhiều → C-FAU-2 reject.
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - ft_claim),
      ft_datum(),
      ft_datum_amt(1_000_000_000),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_double_satisfaction() fail {
  // (d) 2 pool input cùng script hash, KHÁC stake cred → count_inputs_at_script
  // == 2 → C-FAU-1 reject. (Chống claim từ 2 pool nhưng chỉ trả 1 output.)
  let pool_addr2 = util.script_address_staked(ft_pool_sh, #"5742")
  let extra =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output(pool_addr2, ft_pool_val(10_000_000, 1_000_000_000), ft_datum()),
    )
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - ft_claim),
      ft_datum(),
      ft_datum(),
      assets.zero,
      [extra],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

test claim_zero_amount_datum() fail {
  // datum bịa claim_amount = 0 → expect claim_amount > 0 reject.
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_datum_amt(0),
      ft_datum_amt(0),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum_amt(0)), Claim, util.mk_ref(0), tx,
  )
}

// ══════════════════════ RED-TEAM VÒNG 2 ══════════════════════

/// Dựng tx có thêm OUTPUT tùy ý (test 2 pool output / split).
fn faucet_tx_xout(
  pool_in_val: assets.Value,
  pool_out_val: assets.Value,
  d_in: FaucetDatum,
  d_out: FaucetDatum,
  extra_out: List<Output>,
) -> Transaction {
  let pool_addr = util.script_address(ft_pool_sh)
  let pool_in = util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, pool_in_val, d_in))
  let pool_out = util.mk_output(pool_addr, pool_out_val, d_out)
  let claimer = util.mk_output_no_datum(util.vk_address(#"c1"), assets.from_lovelace(2_000_000))
  Transaction {
    ..placeholder,
    inputs: [pool_in],
    outputs: list.concat([pool_out, claimer], extra_out),
    mint: assets.zero,
  }
}

// RT-F1: 2 pool OUTPUT cùng script hash (1 input). count_outputs==2 → C-FAU-1 reject.
// (Chẻ pool ra 2 output để né value-eq trên 1 output.)
test rt_two_pool_outputs() fail {
  let pool_addr2 = util.script_address_staked(ft_pool_sh, #"5742")
  let extra =
    util.mk_output(pool_addr2, ft_pool_val(10_000_000, 500_000_000), ft_datum())
  let tx =
    faucet_tx_xout(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 500_000_000 - ft_claim),
      ft_datum(),
      ft_datum(),
      [extra],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

// RT-F2: pool_out THÊM tLAMP (claim hiệu dụng âm). value-eq đòi out = in − claim;
// out có nhiều hơn → lệch → reject (không cho "claim ngược" bơm token).
test rt_negative_effective_claim() fail {
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 + ft_claim),
      ft_datum(),
      ft_datum(),
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

// RT-F3: pool_out datum = NoDatum (mất datum để né C-FAU-2 / khoá pool).
// expect InlineDatum(od) fail → reject.
test rt_pool_out_no_datum() fail {
  let pool_addr = util.script_address(ft_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0),
      util.mk_output(pool_addr, ft_pool_val(10_000_000, 1_000_000_000), ft_datum()))
  let pool_out =
    util.mk_output_no_datum(pool_addr, ft_pool_val(10_000_000, 1_000_000_000 - ft_claim))
  let claimer =
    util.mk_output_no_datum(util.vk_address(#"c1"), assets.from_lovelace(2_000_000))
  let tx =
    Transaction { ..placeholder, inputs: [pool_in], outputs: [pool_out, claimer], mint: assets.zero }
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

// RT-F4: mint asset CỦA POLICY KHÁC (NFT rác) trong tx Claim. is_zero(tx.mint)
// bắt mọi mint ≠ 0 → reject (không né C-FAU-0 bằng policy khác).
test rt_mint_other_policy() fail {
  let mint = assets.zero |> assets.add(#"beef", #"01", 1)
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000 - ft_claim),
      ft_datum(),
      ft_datum(),
      mint,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

// RT-F5: claim_amount âm trong datum. claim_amount > 0 reject TRƯỚC value-eq
// (chặn -claim biến assets.add(..., -(-x)) thành +x bơm pool).
test rt_negative_claim_amount() fail {
  let neg = ft_datum_amt(-ft_claim)
  let tx =
    faucet_tx(
      ft_pool_val(10_000_000, 1_000_000_000),
      ft_pool_val(10_000_000, 1_000_000_000),
      neg,
      neg,
      assets.zero,
      [],
    )
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(neg), Claim, util.mk_ref(0), tx,
  )
}

// RT-F6: own_ref trỏ input ví thường (không script). own_script_hash expect
// Script(h) fail → reject (chống spoof own_ref sang UTxO non-script).
test rt_own_ref_not_script() fail {
  let pool_addr = util.script_address(ft_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0),
      util.mk_output(pool_addr, ft_pool_val(10_000_000, 1_000_000_000), ft_datum()))
  let vk_in =
    util.mk_input(util.mk_ref(5),
      util.mk_output_no_datum(util.vk_address(#"99"), assets.from_lovelace(5_000_000)))
  let pool_out =
    util.mk_output(pool_addr, ft_pool_val(10_000_000, 1_000_000_000 - ft_claim), ft_datum())
  let claimer =
    util.mk_output_no_datum(util.vk_address(#"c1"), assets.from_lovelace(2_000_000))
  let tx =
    Transaction { ..placeholder, inputs: [pool_in, vk_in], outputs: [pool_out, claimer], mint: assets.zero }
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(5), tx,
  )
}

// RT-F7 (HAPPY biến thể): pool giữ dust asset y nguyên + nhả đúng 100 → PASS.
// Chứng minh value-eq không cấm pool ôm asset phụ hợp lệ (bảo toàn mọi asset khác).
test rt_happy_with_dust() {
  let pin =
    ft_pool_val(10_000_000, 1_000_000_000) |> assets.add(#"dddd", #"f00d", 7)
  let pout =
    ft_pool_val(10_000_000, 1_000_000_000 - ft_claim) |> assets.add(#"dddd", #"f00d", 7)
  let tx = faucet_tx(pin, pout, ft_datum(), ft_datum(), assets.zero, [])
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}

// RT-F8: steal dust — pool có dust, claim nhả đúng 100 tLAMP NHƯNG cuỗm luôn dust
// (pool_out thiếu dust). value-eq lệch → reject (bảo toàn asset phụ).
test rt_steal_dust() fail {
  let pin =
    ft_pool_val(10_000_000, 1_000_000_000) |> assets.add(#"dddd", #"f00d", 7)
  let pout = ft_pool_val(10_000_000, 1_000_000_000 - ft_claim)
  let tx = faucet_tx(pin, pout, ft_datum(), ft_datum(), assets.zero, [])
  faucet.spend(
    ft_tlamp_policy, ft_tlamp_name, Some(ft_datum()), Claim, util.mk_ref(0), tx,
  )
}
