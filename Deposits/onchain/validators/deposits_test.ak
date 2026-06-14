// Validator tests cho Deposits pot (mock Transaction). Phủ:
//   HAPPY: deposit mới, deposit cộng dồn, refund bởi depositor, refund bởi authority.
//   NEGATIVE (A1–A17 SPEC §3): double-refund, refund>amount, refund sai người,
//     deposit âm/0, phantom-line, drain ADA/asset khác, double-sat, refund-chưa-deposit,
//     mint/burn, đổi params, depositor không ký, refund không authority, output về ví,
//     sửa dòng khác, datum rỗng, dòng trùng khóa.

use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey, Credential}
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use deposits
use magiclamp/deposits/types.{
  AssetKey, Deposit, DepositLine, DepositParam, DepositTier, Escheat, PotDatum,
  Refund,
}
use magiclamp/deposits/util

// ── Hằng số ──
const pot_sh: ByteArray = #"d0d0d0d0"

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"744c414d50"

const alice: ByteArray = #"a11ce0"

const bob: ByteArray = #"b0b0"

const entity1: ByteArray = #"e1"

const entity2: ByteArray = #"e2"

// lifecycle_authority = council key (VK).
const council_pkh: ByteArray = #"c011c1"

// lifecycle_authority = validator (Script) — test nhánh Script.
const lifecycle_script: ByteArray = #"5c5c5c5c"

// v2 params:
const dp_nft_policy: ByteArray = #"9999"

const dp_nft_name: ByteArray = #"5041524d"

const treasury_pkh: ByteArray = #"7a5c0001"

const escheat_after: Int = 6

const ms_per_epoch: Int = 86_400_000

// phân loại demo: bò (cọc cao) + dưa leo (cọc 0).
const at_cattle: Int = 0

const vt_high: Int = 2

const lc_long: Int = 2

const at_plant: Int = 1

const vt_low: Int = 0

const lc_short: Int = 0

const dp_ref_ix: Int = 9

fn accepted() -> List<AssetKey> {
  [AssetKey { policy: #"", name: #"" }, AssetKey { policy: lamp_policy, name: lamp_name }]
}

fn datum_with(
  ledger: List<DepositLine>,
  authority: Credential,
) -> PotDatum {
  PotDatum {
    instance_id: #"abcd",
    accepted_assets: accepted(),
    lifecycle_authority: authority,
    reserved_min_ada: 2_000_000,
    deposit_param_policy: dp_nft_policy,
    deposit_param_name: dp_nft_name,
    treasury_credential: VerificationKey(treasury_pkh),
    escheat_after_epoch: escheat_after,
    ms_per_epoch: ms_per_epoch,
    ledger: ledger,
    epoch: 10,
  }
}

// authority = council VK mặc định.
fn datum(ledger: List<DepositLine>) -> PotDatum {
  datum_with(ledger, VerificationKey(council_pkh))
}

fn line(entity: ByteArray, depositor: ByteArray, amount: Int) -> DepositLine {
  DepositLine {
    entity_id: entity,
    depositor: depositor,
    policy: lamp_policy,
    name: lamp_name,
    amount: amount,
    epoch: 10,
    asset_type: at_cattle,
    value_tier: vt_high,
    lifecycle_class: lc_long,
  }
}

// ── DepositParam beacon (reference input, mang NFT) ──
// bảng demo: dưa leo (cọc 0) + bò (1 LAMP ở mult 1.0×). Dùng cho test deposit ĐỘNG.
fn dp_param(mult: Int) -> DepositParam {
  DepositParam {
    tiers: [
      // dưa leo → cọc 0.
      DepositTier { asset_type: at_plant, value_tier: vt_low, lifecycle_class: lc_short, base_deposit: 0 },
      // bò → 1 LAMP (10^6 oil) ở mult 1.0×.
      DepositTier { asset_type: at_cattle, value_tier: vt_high, lifecycle_class: lc_long, base_deposit: 1_000_000 },
    ],
    demand_mult: mult,
    m_min: 500_000_000,
    m_max: 2_000_000_000,
    epoch: 5,
  }
}

/// dòng cọc với epoch tùy biến (mốc tính escheat_after).
fn line_at(entity: ByteArray, depositor: ByteArray, amount: Int, dep_epoch: Int) -> DepositLine {
  DepositLine {
    entity_id: entity, depositor: depositor, policy: lamp_policy, name: lamp_name,
    amount: amount, epoch: dep_epoch,
    asset_type: at_cattle, value_tier: vt_high, lifecycle_class: lc_long,
  }
}

/// dòng cọc dưa leo (cọc 0 → KHÔNG ghi sổ thật, chỉ để test phân loại trong dòng).
fn line_cuke(entity: ByteArray, depositor: ByteArray, amount: Int) -> DepositLine {
  DepositLine {
    entity_id: entity, depositor: depositor, policy: lamp_policy, name: lamp_name,
    amount: amount, epoch: 10,
    asset_type: at_plant, value_tier: vt_low, lifecycle_class: lc_short,
  }
}

// ── ESCHEAT runner ──
// validity_range lower bound = cur_epoch × ms_per_epoch (để get_epoch trả cur_epoch).
fn run_escheat(
  in_val         : assets.Value,
  out_val        : assets.Value,
  ledger_in      : List<DepositLine>,
  d_out          : PotDatum,
  out_addr       : Address,
  signers        : List<ByteArray>,
  mint           : assets.Value,
  cur_epoch      : Int,
  recipient_outs : List<Output>,
  treasury_cred  : Credential,
  entity         : ByteArray,
  depositor      : ByteArray,
) -> Bool {
  let d_in =
    PotDatum { ..datum(ledger_in), treasury_credential: treasury_cred, ledger: ledger_in }
  let pot_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pot_addr(), in_val, d_in))
  let pot_out = util.mk_output(out_addr, out_val, d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pot_in],
      outputs: list.concat([pot_out], recipient_outs),
      mint: mint,
      extra_signatories: signers,
      validity_range: interval.after(cur_epoch * ms_per_epoch),
    }
  deposits.deposits.spend(
    Some(d_in),
    Escheat { entity_id: entity, depositor: depositor, policy: lamp_policy, name: lamp_name },
    util.mk_ref(0),
    tx,
  )
}

/// output trả LAMP về Treasury (VK custody).
fn treasury_out(pkh: ByteArray, lamp: Int) -> Output {
  util.mk_output_no_datum(
    util.vk_address(pkh),
    assets.add(assets.from_lovelace(2_000_000), lamp_policy, lamp_name, lamp),
  )
}

fn dp_ref() -> OutputReference {
  util.mk_ref_id(#"bb", dp_ref_ix)
}

/// beacon reference input mang DepositParam + NFT (qty cho phép sai để test auth).
fn dp_beacon_ref(pp: DepositParam, nft_qty: Int) -> Input {
  let v = assets.add(assets.from_lovelace(2_000_000), dp_nft_policy, dp_nft_name, nft_qty)
  util.mk_input(dp_ref(), util.mk_output(util.script_address(#"feed"), v, pp))
}

// pot value: reserved_min_ada (2 ADA) + lamp bond.
fn pot_val(lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(2_000_000), lamp_policy, lamp_name, lamp)
}

fn pot_addr() -> Address {
  util.script_address(pot_sh)
}

// ── DEPOSIT runner (FULL — kiểm soát beacon, phân loại, nft_qty) ──
// amount KHÔNG truyền trực tiếp: validator TÍNH từ beacon. Test cấp beacon (tiers)
// + nft_qty (xác thực) + phân loại (at/vt/lc) → amount = base × mult / Q.
fn run_deposit_full(
  in_val     : assets.Value,
  out_val    : assets.Value,
  ledger_in  : List<DepositLine>,
  d_out      : PotDatum,
  out_addr   : Address,
  signers    : List<ByteArray>,
  mint       : assets.Value,
  extra_in   : List<Input>,
  beacon     : DepositParam,
  nft_qty    : Int,
  entity     : ByteArray,
  depositor  : ByteArray,
  at         : Int,
  vt         : Int,
  lc         : Int,
) -> Bool {
  let d_in = datum(ledger_in)
  let pot_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pot_addr(), in_val, d_in))
  let pot_out = util.mk_output(out_addr, out_val, d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: list.concat([pot_in], extra_in),
      reference_inputs: [dp_beacon_ref(beacon, nft_qty)],
      outputs: [pot_out],
      mint: mint,
      extra_signatories: signers,
    }
  deposits.deposits.spend(
    Some(d_in),
    Deposit {
      entity_id: entity,
      depositor: depositor,
      policy: lamp_policy,
      name: lamp_name,
      asset_type: at,
      value_tier: vt,
      lifecycle_class: lc,
      deposit_ref: dp_ref(),
    },
    util.mk_ref(0),
    tx,
  )
}

// ── DEPOSIT runner (v1-compat) — phân loại = bò; beacon yields đúng `amount` ở
// mult 1.0×. Giữ chữ ký gọi v1 (truyền amount) để các test cũ không phải sửa nhiều:
// beacon cattle.base_deposit = amount → required = amount.
fn run_deposit(
  in_val     : assets.Value,
  out_val    : assets.Value,
  ledger_in  : List<DepositLine>,
  d_out      : PotDatum,
  out_addr   : Address,
  signers    : List<ByteArray>,
  mint       : assets.Value,
  extra_in   : List<Input>,
  entity     : ByteArray,
  depositor  : ByteArray,
  amount     : Int,
) -> Bool {
  // beacon: cattle tier base = amount (mult 1.0× → required = amount).
  let beacon =
    DepositParam {
      tiers: [
        DepositTier { asset_type: at_cattle, value_tier: vt_high, lifecycle_class: lc_long, base_deposit: amount },
      ],
      demand_mult: schedule_q(),
      m_min: 0,
      m_max: 2_000_000_000,
      epoch: 5,
    }
  run_deposit_full(
    in_val, out_val, ledger_in, d_out, out_addr, signers, mint, extra_in,
    beacon, 1, entity, depositor, at_cattle, vt_high, lc_long,
  )
}

fn schedule_q() -> Int {
  1_000_000_000
}

// ── REFUND runner ──
fn run_refund(
  in_val     : assets.Value,
  out_val    : assets.Value,
  ledger_in  : List<DepositLine>,
  d_out      : PotDatum,
  out_addr   : Address,
  signers    : List<ByteArray>,
  mint       : assets.Value,
  extra_in   : List<Input>,
  ref_in     : List<Input>,
  recipient_outs : List<Output>,
  authority  : Credential,
  entity     : ByteArray,
  depositor  : ByteArray,
) -> Bool {
  let d_in = datum_with(ledger_in, authority)
  let pot_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pot_addr(), in_val, d_in))
  let pot_out = util.mk_output(out_addr, out_val, d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: list.concat([pot_in], extra_in),
      reference_inputs: ref_in,
      outputs: list.concat([pot_out], recipient_outs),
      mint: mint,
      extra_signatories: signers,
    }
  deposits.deposits.spend(
    Some(d_in),
    Refund { entity_id: entity, depositor: depositor, policy: lamp_policy, name: lamp_name },
    util.mk_ref(0),
    tx,
  )
}

/// output trả LAMP về ví depositor.
fn refund_out(depositor: ByteArray, lamp: Int) -> Output {
  util.mk_output_no_datum(
    util.vk_address(depositor),
    assets.add(assets.from_lovelace(2_000_000), lamp_policy, lamp_name, lamp),
  )
}

// ════════════════════════════════════════════════════════════
// HAPPY 1 — DEPOSIT mới: Alice cọc 1 LAMP (10^6 oil) cho entity1.
//   pot lamp 0→1_000_000; sổ thêm dòng (entity1, alice, 1_000_000).
// ════════════════════════════════════════════════════════════
test deposit_new() {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 1_000_000,
  )
}

// HAPPY 2 — DEPOSIT cộng dồn cùng khóa: Alice đã có 1_000_000, nạp thêm 500_000.
//   dòng đích 1_000_000→1_500_000 (1 dòng), pot +500_000.
test deposit_accumulate() {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = [line(entity1, alice, 1_500_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(1_000_000), pot_val(1_500_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 500_000,
  )
}

// HAPPY 2b — DEPOSIT giữ NGUYÊN dòng người khác: Bob nạp khi sổ đã có dòng Alice.
test deposit_keeps_other_line() {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = [line(entity1, alice, 1_000_000), line(entity2, bob, 700_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(1_000_000), pot_val(1_700_000), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, [], entity2, bob, 700_000,
  )
}

// ════════════════════════════════════════════════════════════
// HAPPY 3 — REFUND bởi depositor: Alice tự rút cọc 1 LAMP.
//   dòng XÓA; pot lamp 1_000_000→0; output LAMP về ví Alice.
// ════════════════════════════════════════════════════════════
test refund_by_depositor() {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// HAPPY 4 — REFUND bởi lifecycle_authority (council VK ký, Alice KHÔNG online).
//   tiền vẫn về Alice (depositor ghi sổ).
test refund_by_authority_vk() {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [council_pkh], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// HAPPY 4b — REFUND bởi lifecycle_authority dạng Script (input chứng kiến validator).
test refund_by_authority_script() {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let auth = Script(lifecycle_script)
  let d_out = PotDatum { ..datum_with(ledger_out, auth), ledger: ledger_out, epoch: 11 }
  // input chứng kiến tại Script(lifecycle_script).
  let witness =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.script_address(lifecycle_script), assets.from_lovelace(2_000_000)))
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [], assets.zero, [witness], [], [refund_out(alice, 1_000_000)],
    auth, entity1, alice,
  )
}

// HAPPY 5 — REFUND giữ NGUYÊN dòng người khác: hoàn Alice, Bob dòng vẫn còn.
test refund_keeps_other_line() {
  let ledger_in = [line(entity1, alice, 1_000_000), line(entity2, bob, 700_000)]
  let ledger_out = [line(entity2, bob, 700_000)]
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(1_700_000), pot_val(700_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A1 — DOUBLE-REFUND (fail): refund dòng ĐÃ bị xóa (sổ in không có dòng đích).
//   = refund-chưa-deposit sau lần 1 → C-REF-3 find_line fail.
// ════════════════════════════════════════════════════════════
test refund_double_phantom() fail {
  let ledger_in = [line(entity2, bob, 700_000)]   // dòng Alice đã bị xóa ở lần 1
  let ledger_out = [line(entity2, bob, 700_000)]
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(700_000), pot_val(700_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// A1b — REFUND không xóa dòng (giữ dòng đích ở out để refund lại) → C-REF-6 target_absent fail.
test refund_line_not_deleted() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = [line(entity1, alice, 1_000_000)]   // dòng đích VẪN còn
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  // value vẫn giảm (pot 1_000_000→0) nhưng sổ không xóa → mâu thuẫn → fail.
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A2 — REFUND SAI NGƯỜI (fail): tiền về Bob thay vì Alice (depositor ghi sổ).
//   C-REF-7 output_sum_to_pkh(alice) == 0 < refund_amount.
// ════════════════════════════════════════════════════════════
test refund_wrong_recipient() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(bob, 1_000_000)],   // tiền về BOB
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A3 — REFUND VƯỢT AMOUNT (fail): rút 2 LAMP nhưng dòng chỉ 1 LAMP.
//   refund_amount đọc từ sổ = 1_000_000; pot giảm 2_000_000 → C-REF-5 value fail.
// ════════════════════════════════════════════════════════════
test refund_over_amount() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  // pot giảm 2_000_000 (rút quá) → refund_value_ok kỳ vọng −1_000_000 → fail.
  run_refund(
    pot_val(2_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 2_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A4 — DEPOSIT ÂM (fail) + DEPOSIT 0 (fail): C-DEP-3 amount > 0.
// ════════════════════════════════════════════════════════════
test deposit_negative() fail {
  let ledger_out = [line(entity1, alice, -500_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(0), pot_val(-500_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, -500_000,
  )
}

test deposit_zero() fail {
  let ledger_out = [line(entity1, alice, 0)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(0), pot_val(0), [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 0,
  )
}

// ════════════════════════════════════════════════════════════
// A5 — PHANTOM LINE (fail): sổ thêm dòng khống KHÔNG kèm value.
//   ledger_out có 999 nhưng pot value không tăng → C-DEP-5 value fail.
// ════════════════════════════════════════════════════════════
test deposit_phantom_value() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  // sổ +1_000_000 nhưng pot value KHÔNG tăng (vẫn 0).
  run_deposit(
    pot_val(0), pot_val(0), [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 1_000_000,
  )
}

// ════════════════════════════════════════════════════════════
// A6 — DRAIN ADA (fail, deposit) + DRAIN asset khác (fail, refund).
// ════════════════════════════════════════════════════════════
test deposit_drain_ada() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  // LAMP +1_000_000 đúng, NHƯNG ADA rút 2M→0 → đẳng thức value fail.
  let out_val = assets.add(assets.from_lovelace(0), lamp_policy, lamp_name, 1_000_000)
  run_deposit(
    pot_val(0), out_val, [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 1_000_000,
  )
}

test refund_drain_other() fail {
  // pot có thêm token X; refund LAMP nhưng rút luôn X.
  let token_x_p: ByteArray = #"dead"
  let token_x_n: ByteArray = #"beef"
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  let in_val = assets.add(pot_val(1_000_000), token_x_p, token_x_n, 5000)
  // out rút LAMP đúng NHƯNG cũng rút token X (5000→0) → value fail.
  let out_val = pot_val(0)
  run_refund(
    in_val, out_val, ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A7 — DOUBLE-SATISFACTION (fail): 2 pot input cùng script hash, khác stake cred.
// ════════════════════════════════════════════════════════════
test deposit_double_sat() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  let pot2 = util.script_address_staked(pot_sh, #"5742")
  let extra =
    util.mk_input(util.mk_ref(9), util.mk_output(pot2, pot_val(9999), datum([])))
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [extra], entity1, alice, 1_000_000,
  )
}

// ════════════════════════════════════════════════════════════
// A8 — REFUND-CHƯA-DEPOSIT (fail): refund khóa chưa từng gửi (sổ rỗng).
// ════════════════════════════════════════════════════════════
test refund_phantom() fail {
  let ledger_in = []
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(0), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A9 — MINT/BURN (fail): deposit + refund với tx.mint khác zero.
// ════════════════════════════════════════════════════════════
test deposit_mint() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.from_asset(lamp_policy, lamp_name, -100), [], entity1, alice, 1_000_000,
  )
}

test refund_mint() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.from_asset(lamp_policy, lamp_name, 100), [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A10 — ĐỔI PARAMS (fail): deposit đổi reserved_min_ada; refund đổi lifecycle_authority.
// ════════════════════════════════════════════════════════════
test deposit_param_tamper() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, reserved_min_ada: 9_999_999, epoch: 11 }
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 1_000_000,
  )
}

test refund_authority_tamper() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  // out_datum đổi lifecycle_authority sang Script khác (chiếm quyền tương lai).
  let d_out = PotDatum {
    ..datum_with(ledger_out, VerificationKey(council_pkh)),
    ledger: ledger_out, lifecycle_authority: Script(#"f00d"), epoch: 11,
  }
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A11 — DEPOSITOR KHÔNG KÝ (fail): C-DEP-4 depositor phải ký.
// ════════════════════════════════════════════════════════════
test deposit_unsigned_depositor() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  // signer là bob, KHÔNG phải alice (depositor).
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [bob], assets.zero, [], entity1, alice, 1_000_000,
  )
}

// ════════════════════════════════════════════════════════════
// A12 — REFUND KHÔNG AUTHORITY (fail): người lạ (bob) ký, không phải depositor/authority.
// ════════════════════════════════════════════════════════════
test refund_no_authority() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  // bob ký (không phải alice, không phải council) → authority fail.
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A13 — POT OUTPUT VỀ VÍ THƯỜNG (fail): không output về script → count_outputs_at_script == 0.
// ════════════════════════════════════════════════════════════
test deposit_no_pot_output() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  // pot_out đặt ở ví thường (vk_address) → count_outputs_at_script == 0.
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, util.vk_address(#"dead"),
    [alice], assets.zero, [], entity1, alice, 1_000_000,
  )
}

// ════════════════════════════════════════════════════════════
// A14 — SỬA DÒNG NGƯỜI KHÁC (fail): refund Alice nhưng bơm số dư Bob.
//   each_out_is_untouched_in fail (dòng bob amount đổi).
// ════════════════════════════════════════════════════════════
test refund_tamper_other_line() fail {
  let ledger_in = [line(entity1, alice, 1_000_000), line(entity2, bob, 700_000)]
  // bob bị bơm 700_000→9_000_000.
  let ledger_out = [line(entity2, bob, 9_000_000)]
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  run_refund(
    pot_val(1_700_000), pot_val(700_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// A16 — DATUM RỖNG (fail): spend pot không datum.
// ════════════════════════════════════════════════════════════
test deposit_missing_datum() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  let pot_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pot_addr(), pot_val(0), datum([])))
  let pot_out = util.mk_output(pot_addr(), pot_val(1_000_000), d_out)
  let tx =
    Transaction { ..placeholder, inputs: [pot_in], outputs: [pot_out], mint: assets.zero, extra_signatories: [alice] }
  deposits.deposits.spend(
    None,
    Deposit {
      entity_id: entity1, depositor: alice, policy: lamp_policy, name: lamp_name,
      asset_type: at_cattle, value_tier: vt_high, lifecycle_class: lc_long, deposit_ref: dp_ref(),
    },
    util.mk_ref(0),
    tx,
  )
}

// ════════════════════════════════════════════════════════════
// A17 — DÒNG TRÙNG KHÓA (fail): deposit tạo 2 dòng cùng khóa né cộng dồn.
//   no_dup_lines(out) fail.
// ════════════════════════════════════════════════════════════
test deposit_dup_line() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  // out tách thành 2 dòng cùng khóa (1_000_000 + 500_000) thay vì cộng dồn.
  let ledger_out = [line(entity1, alice, 1_000_000), line(entity1, alice, 500_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(1_000_000), pot_val(1_500_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 500_000,
  )
}

// A15 — REFUND MỘT PHẦN giữ dòng: cấu trúc không expose; A1b đã phủ "giữ dòng" = fail.

// ════════════════════════════════════════════════════════════
// EPOCH LÙI (fail): out_epoch < datum.epoch (deposit).
// ════════════════════════════════════════════════════════════
test deposit_epoch_regress() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 9 }
  run_deposit(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 1_000_000,
  )
}

// ════════════════════════════════════════════════════════════
// AUDIT-1 — DEPOSIT value tăng nhưng SỔ KHÔNG cập nhật (bơm value tự do):
//   pot +1_000_000 nhưng ledger_out giữ nguyên dòng cũ → deposit_ledger_ok fail
//   (target_line_present_once == 0 ∨ dòng đích không +amount). Chống "đút value lậu".
// ════════════════════════════════════════════════════════════
test deposit_value_without_ledger() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = [line(entity1, alice, 1_000_000)]   // sổ KHÔNG +500_000
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit(
    pot_val(1_000_000), pot_val(1_500_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], entity1, alice, 500_000,
  )
}

// ════════════════════════════════════════════════════════════
// AUDIT-2 — REFUND TRẢ THIẾU người nhận: tiền rời pot (value giảm) NHƯNG output
//   tới depositor < refund_amount (giấu bớt) → C-REF-7 tổng-khớp fail.
// ════════════════════════════════════════════════════════════
test refund_underpay_recipient() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  // pot giảm đúng 1_000_000 (C-REF-5 ok) nhưng output về alice chỉ 400_000 → C-REF-7 fail.
  run_refund(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 400_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════
// AUDIT-3 — REFUND XÓA SỔ nhưng GIỮ value trong pot (xóa nợ mà không trả tiền):
//   ledger xóa dòng (alice -1_000_000) nhưng pot value KHÔNG giảm → C-REF-5 fail.
//   Chống "xóa nghĩa vụ hoàn mà giữ tiền lại pot" (mất tiền user về tay kho).
// ════════════════════════════════════════════════════════════
test refund_delete_keep_value() fail {
  let ledger_in = [line(entity1, alice, 1_000_000)]
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 11 }
  // pot GIỮ value 1_000_000 (không giảm) nhưng sổ xóa dòng → refund_value_ok fail.
  run_refund(
    pot_val(1_000_000), pot_val(1_000_000), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ███ v2 — DEPOSIT ĐỘNG (amount ÉP từ DepositParam beacon) ███
// ════════════════════════════════════════════════════════════════════════════

// V2-DEP-1 (HAPPY) — bò: beacon base 1_000_000 × mult 1.0× = 1 LAMP. amount KHÔNG
//   do client mớm — validator TÍNH từ beacon theo (cattle, high, long).
test v2_deposit_cattle_dynamic() {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(schedule_q()), 1,
    entity1, alice, at_cattle, vt_high, lc_long,
  )
}

// V2-DEP-2 (HAPPY) — dưa leo: beacon base 0 → cọc 0. KHÔNG ghi dòng (value giữ, sổ giữ).
//   min-ADA Cardano đã chống rác cho tài sản giá trị thấp + vòng đời ngắn.
test v2_deposit_cucumber_zero() {
  let d_out = PotDatum { ..datum([]), ledger: [], epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(0), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(schedule_q()), 1,
    entity1, alice, at_plant, vt_low, lc_short,
  )
}

// V2-DEP-3 (HAPPY) — demand cao 2.0×: bò base 1_000_000 → required 2_000_000 (DAO
//   scale toàn bảng qua demand_mult). Pot +2 LAMP, sổ dòng 2 LAMP.
test v2_deposit_demand_scaled() {
  let ledger_out = [line(entity1, alice, 2_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(2_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(2_000_000_000), 1,
    entity1, alice, at_cattle, vt_high, lc_long,
  )
}

// V2-ATK-1 (fail) — CLIENT MỚM AMOUNT SAI LỊCH: beacon nói bò = 1_000_000 nhưng kẻ
//   tấn công nạp pot +500_000 + ghi dòng 500_000 (trả ít hơn lịch). validator TÍNH
//   amount=1_000_000 từ beacon → C-DEP-5 value (pot chỉ +500_000 ≠ +1_000_000) fail.
test v2_deposit_client_underpay_fail() fail {
  let ledger_out = [line(entity1, alice, 500_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(500_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(schedule_q()), 1,
    entity1, alice, at_cattle, vt_high, lc_long,
  )
}

// V2-ATK-2 (fail) — TIER GIẢ NÉ PHÍ: phân loại (9,9,9) KHÔNG có trong bảng beacon →
//   required_for None → fail. Chống "khai tier rởm để required=0/định giá lậu".
test v2_deposit_fake_tier_fail() fail {
  let d_out = PotDatum { ..datum([]), ledger: [], epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(0), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(schedule_q()), 1,
    entity1, alice, 9, 9, 9,
  )
}

// V2-ATK-3 (fail) — BEACON GIẢ (không NFT): reference input mang DepositParam nhưng
//   nft_qty=0 → read_beacon_datum fail (không phải bảng phí governance thật).
test v2_deposit_fake_beacon_no_nft_fail() fail {
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(1_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(schedule_q()), 0,    // nft_qty = 0
    entity1, alice, at_cattle, vt_high, lc_long,
  )
}

// V2-ATK-4 (fail) — BEACON RÁC (clamp sai): demand_mult > m_max → valid_param fail →
//   reject (không dùng bảng phí ngoài bất biến). Chống beacon định giá bừa.
test v2_deposit_invalid_beacon_fail() fail {
  let bad =
    DepositParam {
      tiers: [DepositTier { asset_type: at_cattle, value_tier: vt_high, lifecycle_class: lc_long, base_deposit: 1_000_000 }],
      demand_mult: 3_000_000_000,   // > m_max
      m_min: 500_000_000,
      m_max: 2_000_000_000,
      epoch: 5,
    }
  let ledger_out = [line(entity1, alice, 1_000_000)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(3_000_000), [], d_out, pot_addr(),
    [alice], assets.zero, [], bad, 1,
    entity1, alice, at_cattle, vt_high, lc_long,
  )
}

// V2-ATK-5 (fail) — CỌC 0 NHƯNG GHI DÒNG KHỐNG: dưa leo required=0, kẻ tấn công ghi
//   dòng phantom (amount 1) không kèm value → nhánh amount==0 ép sổ_out==sổ_in → fail.
test v2_deposit_zero_phantom_line_fail() fail {
  let ledger_out = [line_cuke(entity1, alice, 1)]
  let d_out = PotDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  run_deposit_full(
    pot_val(0), pot_val(0), [], d_out, pot_addr(),
    [alice], assets.zero, [], dp_param(schedule_q()), 1,
    entity1, alice, at_plant, vt_low, lc_short,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ███ v2 — ESCHEAT (DID mồ côi quá hạn → value về Treasury) ███
// ════════════════════════════════════════════════════════════════════════════

// V2-ESC-1 (HAPPY) — đủ hạn: deposit epoch 10, escheat_after 6, cur_epoch 16 (= 10+6).
//   value 1 LAMP về Treasury custody, dòng XÓA.
test v2_escheat_happy() {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 16 }
  run_escheat(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 16, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-2 (HAPPY) — bất kỳ ai trigger được (public-good cleanup), tiền vẫn về Treasury.
//   signer = người lạ (bob), không phải depositor/authority → vẫn hợp lệ vì đích cố định.
test v2_escheat_anyone_triggers() {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 5), line_at(entity2, bob, 700_000, 5)]
  let ledger_out = [line_at(entity2, bob, 700_000, 5)]
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 20 }
  run_escheat(
    pot_val(1_700_000), pot_val(700_000), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 20, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-1 (fail) — ESCHEAT SỚM: cur_epoch 15 < 10+6=16 → C-ESC-4 chưa tới hạn.
test v2_escheat_too_early_fail() fail {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 15 }
  run_escheat(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 15, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-2 (fail) — ĂN CẮP VỀ VÍ ATTACKER: đủ hạn nhưng tiền về ví bob (attacker)
//   thay Treasury → C-ESC-7 output_sum_to_credential(treasury)=0 < amount → fail.
test v2_escheat_steal_to_attacker_fail() fail {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 16 }
  run_escheat(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 16, [treasury_out(bob, 1_000_000)],   // tiền về BOB
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-3 (fail) — ESCHEAT RỒI REFUND (double): sau escheat dòng đã xóa. Mô phỏng
//   refund dòng không còn → C-REF-3 fail (dòng đã biến mất). Dùng nhánh refund.
test v2_escheat_then_refund_double_fail() fail {
  let ledger_in = []   // sau escheat: sổ rỗng
  let ledger_out = []
  let d_out = PotDatum { ..datum_with(ledger_out, VerificationKey(council_pkh)), ledger: ledger_out, epoch: 17 }
  run_refund(
    pot_val(0), pot_val(0), ledger_in, d_out, pot_addr(),
    [alice], assets.zero, [], [], [refund_out(alice, 1_000_000)],
    VerificationKey(council_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-4 (fail) — ESCHEAT DÒNG KHÔNG TỒN TẠI (phantom): sổ rỗng → C-ESC-3 fail.
test v2_escheat_phantom_fail() fail {
  let d_out =
    PotDatum { ..datum([]), treasury_credential: VerificationKey(treasury_pkh), ledger: [], epoch: 16 }
  run_escheat(
    pot_val(0), pot_val(0), [], d_out, pot_addr(),
    [bob], assets.zero, 16, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-5 (fail) — ESCHEAT MINT/BURN: tx.mint ≠ 0 → C-ESC-0 fail.
test v2_escheat_mint_fail() fail {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 16 }
  run_escheat(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.from_asset(lamp_policy, lamp_name, -100), 16,
    [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-6 (fail) — ESCHEAT ĂN DÒNG NGƯỜI KHÁC: escheat alice nhưng xóa luôn dòng
//   bob (chưa tới hạn) → C-ESC-6 each_in_nontarget_present fail (dòng bob biến mất).
test v2_escheat_eat_other_line_fail() fail {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10), line_at(entity2, bob, 700_000, 10)]
  let ledger_out = []   // xóa CẢ bob
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 16 }
  // pot giảm cả 1.7M để value khớp sổ rỗng — nhưng sổ ăn dòng bob → ledger fail.
  run_escheat(
    pot_val(1_700_000), pot_val(700_000), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 16, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-7 (fail) — ESCHEAT XÓA SỔ GIỮ VALUE: dòng xóa nhưng pot value KHÔNG giảm
//   (kho ăn không tiền) → C-ESC-5 value fail. (đối xứng refund_delete_keep_value).
test v2_escheat_delete_keep_value_fail() fail {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh), ledger: ledger_out, epoch: 16 }
  run_escheat(
    pot_val(1_000_000), pot_val(1_000_000), ledger_in, d_out, pot_addr(),   // value GIỮ
    [bob], assets.zero, 16, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-ATK-8 (fail) — ESCHEAT ĐỔI PARAM (escheat_after) lén ở out_datum để né hạn
//   tương lai → C-ESC-2 params_preserved fail.
test v2_escheat_param_tamper_fail() fail {
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum {
      ..datum(ledger_out), treasury_credential: VerificationKey(treasury_pkh),
      escheat_after_epoch: 0, ledger: ledger_out, epoch: 16,
    }
  run_escheat(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 16, [treasury_out(treasury_pkh, 1_000_000)],
    VerificationKey(treasury_pkh), entity1, alice,
  )
}

// V2-ESC-9 (HAPPY) — Treasury là SCRIPT credential (custody validator). tiền về Script.
test v2_escheat_to_script_treasury() {
  let treasury_script: ByteArray = #"7a5c50ad"
  let ledger_in = [line_at(entity1, alice, 1_000_000, 10)]
  let ledger_out = []
  let d_out =
    PotDatum { ..datum(ledger_out), treasury_credential: Script(treasury_script), ledger: ledger_out, epoch: 16 }
  let t_out =
    util.mk_output_no_datum(
      util.script_address(treasury_script),
      assets.add(assets.from_lovelace(2_000_000), lamp_policy, lamp_name, 1_000_000),
    )
  run_escheat(
    pot_val(1_000_000), pot_val(0), ledger_in, d_out, pot_addr(),
    [bob], assets.zero, 16, [t_out],
    Script(treasury_script), entity1, alice,
  )
}
