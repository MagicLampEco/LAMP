// Validator tests cho Deposits pot (mock Transaction). Phủ:
//   HAPPY: deposit mới, deposit cộng dồn, refund bởi depositor, refund bởi authority.
//   NEGATIVE (A1–A17 SPEC §3): double-refund, refund>amount, refund sai người,
//     deposit âm/0, phantom-line, drain ADA/asset khác, double-sat, refund-chưa-deposit,
//     mint/burn, đổi params, depositor không ký, refund không authority, output về ví,
//     sửa dòng khác, datum rỗng, dòng trùng khóa.

use aiken/collection/list
use cardano/address.{Address, Script, VerificationKey, Credential}
use cardano/assets
use cardano/transaction.{Input, Output, Transaction, placeholder}
use deposits
use magiclamp/deposits/types.{
  AssetKey, Deposit, DepositLine, PotDatum, Refund,
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
  }
}

// pot value: reserved_min_ada (2 ADA) + lamp bond.
fn pot_val(lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(2_000_000), lamp_policy, lamp_name, lamp)
}

fn pot_addr() -> Address {
  util.script_address(pot_sh)
}

// ── DEPOSIT runner ──
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
  let d_in = datum(ledger_in)
  let pot_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pot_addr(), in_val, d_in))
  let pot_out = util.mk_output(out_addr, out_val, d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: list.concat([pot_in], extra_in),
      outputs: [pot_out],
      mint: mint,
      extra_signatories: signers,
    }
  deposits.deposits.spend(
    Some(d_in),
    Deposit { entity_id: entity, depositor: depositor, policy: lamp_policy, name: lamp_name, amount: amount },
    util.mk_ref(0),
    tx,
  )
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
    Deposit { entity_id: entity1, depositor: alice, policy: lamp_policy, name: lamp_name, amount: 1_000_000 },
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
