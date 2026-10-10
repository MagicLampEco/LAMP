// drip_pot — két nhả LAMP theo lịch tuyến tính thẳng vào một đích cố định.
// Đặc tả: Distribution/drip-pot/CONTRACT.md v0.2. Mỗi chốt dưới đây mang đúng mã DP-*
// của đặc tả; mỗi mã có ít nhất một ca âm tính mang tên nó ở cuối tệp.
//
// MỘT validator đa mục đích: `spend` và `mint` cùng một script hash ⇒ policy của token
// xác thực "account" = hash của chính két. Không cần tham số nào khai policy đó.
//
// BẤT BIẾN (§6), viết lại bằng lời để soát mã:
// - Token xác thực chỉ sinh ra cùng một `Account` đúng hình (MintAccounts, có committee
//   ký) và chỉ mất ở lượt `Claim` cuối (burn) ⇒ datum `Account` ở UTxO có token là dữ
//   liệu TIN ĐƯỢC; datum ở UTxO không token thì không.
// - LAMP của `Account` chỉ đi tới `vault` của nó, mỗi lượt không quá phần đã đến hạn.
// - LAMP của `Reserve` chỉ rời két bằng cách thành `Account` hoặc `Reserve` mới.
// - `vault` không bao giờ là chính két.

use aiken/builtin
use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{
  DatumHash, InlineDatum, NoDatum, Output, OutputReference, Transaction,
  placeholder,
}
use magiclamp/drippot/types.{
  Account, BurnAccount, Claim, DripDatum, MintAccounts, MintRedeemer, Reserve,
  Seed, SpendRedeemer, account_token_name,
}
use magiclamp/drippot/util

validator drip_pot(
  // Nhãn đợt. Không đọc trong thân: tác dụng duy nhất là áp tham số ⇒ đổi hash.
  _campaign_id: ByteArray,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  committee: List<VerificationKeyHash>,
  threshold: Int,
  ms_per_epoch: Int,
  window_origin_ms: Int,
  vest_epochs: Int,
) {
  spend(
    _datum: Option<Data>,
    redeemer: SpendRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // DP-PARAM: trước mọi nhánh.
    expect util.params_ok(ms_per_epoch, window_origin_ms, vest_epochs)
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
    let own_out = own_input.output
    expect Script(own) = own_out.address.payment_credential
    // §4: datum PHẢI inline. Đọc thẳng từ UTxO, không dùng tham số `_datum` (tham số
    // đó cũng được điền khi UTxO mang datum hash kèm nhân chứng).
    expect InlineDatum(raw) = own_out.datum
    expect datum: DripDatum = raw
    when datum is {
      Reserve ->
        when redeemer is {
          Seed ->
            seed(own, lamp_policy, lamp_name, committee, threshold, tx)
          Claim -> False
        }
      Account { vault, entitlement, claimed, start_epoch } ->
        when redeemer is {
          Claim ->
            claim(
              own,
              own_ref,
              own_out,
              vault,
              entitlement,
              claimed,
              start_epoch,
              lamp_policy,
              lamp_name,
              ms_per_epoch,
              window_origin_ms,
              vest_epochs,
              tx,
            )
          Seed -> False
        }
    }
  }

  mint(redeemer: MintRedeemer, policy_id: PolicyId, tx: Transaction) {
    // DP-PARAM: trước mọi nhánh.
    expect util.params_ok(ms_per_epoch, window_origin_ms, vest_epochs)
    // §5: dưới policy của két chỉ có đúng tên "account", lượng q ≠ 0.
    expect [Pair(name, q)] = dict.to_pairs(assets.tokens(tx.mint, policy_id))
    expect name == account_token_name
    when redeemer is {
      MintAccounts -> and {
          // Bị DP-MINT-3 bao hàm (q < 0 ⇒ `length(holders) == q` không thể đúng; q = 0
          // không có trong mint). Đột biến gỡ vế này SỐNG SÓT — giữ vì spec ghi tường
          // minh, KHÔNG đếm là một chốt có bài canh riêng.
          q > 0,
          mint_accounts(
            policy_id,
            q,
            lamp_policy,
            lamp_name,
            committee,
            threshold,
            ms_per_epoch,
            window_origin_ms,
            tx,
          ),
        }
      // DP-BURN-1. Phần còn lại do spend ▸ DP-CLAIM-6 ép.
      BurnAccount -> and {
          q == -1,
          when util.script_inputs(tx.inputs, policy_id) is {
            [i] -> util.token_qty(i.output.value, policy_id) == 1
            _ -> False
          },
        }
    }
  }

  // DP-PURPOSE: mọi mục đích ngoài spend/mint (withdraw, publish, vote, propose) ⇒ từ chối.
  else(_) {
    fail
  }
}

// ── spend ▸ Reserve + Seed (§4.1) ─────────────────────────────────

fn seed(
  own: ByteArray,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  committee: List<VerificationKeyHash>,
  threshold: Int,
  tx: Transaction,
) -> Bool {
  let reserve_datum = InlineDatum(reserve_data())
  let ins = util.script_inputs(tx.inputs, own)
  let outs = util.script_outputs(tx.outputs, own)
  let lamp_in =
    list.foldl(
      ins,
      0,
      fn(i, acc) { acc + util.lamp_of(i.output.value, lamp_policy, lamp_name) },
    )
  let lamp_out =
    list.foldl(
      outs,
      0,
      fn(o, acc) { acc + util.lamp_of(o.value, lamp_policy, lamp_name) },
    )
  and {
    // DP-SEED-1
    util.committee_approved(committee, threshold, tx.extra_signatories),
    // DP-SEED-2
    list.all(
      ins,
      fn(i) {
        and {
          i.output.datum == reserve_datum,
          util.token_qty(i.output.value, own) == 0,
        }
      },
    ),
    // DP-SEED-3
    lamp_out >= lamp_in,
    // DP-SEED-4: output giữ token thì hình dạng do `mint` ép (DP-MINT-3/4); còn lại
    // phải là `Reserve` đúng hình.
    list.all(
      outs,
      fn(o) {
        or {
          util.token_qty(o.value, own) > 0,
          and {
            o.datum == reserve_datum,
            util.value_is(
              o.value,
              own,
              lamp_policy,
              lamp_name,
              util.lamp_of(o.value, lamp_policy, lamp_name),
              0,
            ),
            o.reference_script == None,
          },
        }
      },
    ),
  }
}

// ── spend ▸ Account + Claim (§4.2) ────────────────────────────────

fn claim(
  own: ByteArray,
  own_ref: OutputReference,
  own_out: Output,
  vault: Address,
  entitlement: Int,
  claimed: Int,
  start_epoch: Int,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  ms_per_epoch: Int,
  window_origin_ms: Int,
  vest_epochs: Int,
  tx: Transaction,
) -> Bool {
  let e = util.tx_epoch(tx, ms_per_epoch, window_origin_ms)
  let amount = util.vested(entitlement, start_epoch, e, vest_epochs) - claimed
  let remaining = entitlement - claimed - amount
  let outs = util.script_outputs(tx.outputs, own)
  let own_mint = assets.tokens(tx.mint, own)
  let tag: Data = own_ref
  and {
    // DP-CLAIM-1: đúng MỘT input của két trong cả giao dịch ⇒ một output đích không
    // thoả được cho hai tài khoản.
    list.length(util.script_inputs(tx.inputs, own)) == 1,
    // DP-CLAIM-2
    util.token_qty(own_out.value, own) == 1,
    util.lamp_of(own_out.value, lamp_policy, lamp_name) == entitlement - claimed,
    // DP-CLAIM-3
    amount > 0,
    // DP-CLAIM-4 (v0.2): đúng một output ở vault mang thẻ = OutputReference của input.
    util.vault_paid(
      tx.outputs,
      vault,
      tag,
      own,
      lamp_policy,
      lamp_name,
      amount,
    ),
    if remaining > 0 {
      // DP-CLAIM-5: lọc RỘNG theo payment credential để đếm, rồi ghim địa chỉ đầy đủ.
      when outs is {
        [next] -> {
          let next_datum: Data =
            Account {
              vault,
              entitlement,
              claimed: claimed + amount,
              start_epoch,
            }
          and {
            next.address == own_out.address,
            next.datum == InlineDatum(next_datum),
            util.value_is(
              next.value,
              own,
              lamp_policy,
              lamp_name,
              remaining,
              1,
            ),
            assets.lovelace_of(next.value) >= assets.lovelace_of(own_out.value),
            next.reference_script == None,
            dict.is_empty(own_mint),
          }
        }
        _ -> False
      }
    } else {
      // DP-CLAIM-6 (`remaining == 0`; `vested ≤ E` nên không âm, vẫn so `== 0` cho
      // chắc — số âm rơi vào nhánh từ chối).
      and {
        remaining == 0,
        outs == [],
        dict.to_pairs(own_mint) == [Pair(account_token_name, -1)],
      }
    },
  }
}

// ── mint ▸ MintAccounts (§5.1) ────────────────────────────────────

fn mint_accounts(
  own: PolicyId,
  q: Int,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  committee: List<VerificationKeyHash>,
  threshold: Int,
  ms_per_epoch: Int,
  window_origin_ms: Int,
  tx: Transaction,
) -> Bool {
  // DP-MINT-4 dùng `epoch_pinned`: hai cận hữu hạn, ≤ 1 giờ, cùng cửa sổ.
  let e = util.tx_epoch_pinned(tx, ms_per_epoch, window_origin_ms)
  let holders =
    list.filter(
      util.script_outputs(tx.outputs, own),
      fn(o) { util.token_qty(o.value, own) != 0 },
    )
  and {
    // DP-MINT-1
    util.committee_approved(committee, threshold, tx.extra_signatories),
    // DP-MINT-2
    list.all(
      util.script_inputs(tx.inputs, own),
      fn(i) { util.token_qty(i.output.value, own) == 0 },
    ),
    // DP-MINT-3: số output giữ token == q; "mỗi output đúng 1" do `value_is(.., 1)`
    // ở DP-MINT-4 ép.
    list.length(holders) == q,
    // DP-MINT-4
    list.all(
      holders,
      fn(o) { account_output_ok(o, own, lamp_policy, lamp_name, e) },
    ),
  }
}

fn account_output_ok(
  o: Output,
  own: PolicyId,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  e: Int,
) -> Bool {
  when o.datum is {
    InlineDatum(raw) -> {
      expect d: DripDatum = raw
      when d is {
        Account { vault, entitlement, claimed, start_epoch } -> and {
            entitlement > 0,
            claimed == 0,
            start_epoch >= e,
            vault.payment_credential != Script(own),
            util.value_is(o.value, own, lamp_policy, lamp_name, entitlement, 1),
            o.reference_script == None,
          }
        Reserve -> False
      }
    }
    _ -> False
  }
}

fn reserve_data() -> Data {
  let d: Data = Reserve
  d
}

// ═════════════════════════════════════════════════════════════════
// KIỂM
// Quy ước: mỗi ca âm tính lấy MỘT ca dương làm nền rồi sai ĐÚNG MỘT điều; tên ca mang
// mã chốt nó canh. Ca dương nền: `seed_two_accounts_from_reserve`, `claim_middle_round`,
// `claim_final_round_with_burn`.
// ═════════════════════════════════════════════════════════════════

const t_own: ByteArray =
  #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

const t_lamp_policy: ByteArray =
  #"1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a"

const t_lamp_name: ByteArray = "LAMP"

const t_k1: ByteArray = #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const t_k2: ByteArray = #"a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2"

const t_crank: ByteArray =
  #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

const t_user: ByteArray = #"b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1"

const t_user2: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const t_other_stake: ByteArray =
  #"5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e"

/// Đích là script (vd két `did_payment`), không phải chính két.
const t_did_script: ByteArray =
  #"9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d"

const t_foreign_policy: ByteArray =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

const t_ms: Int = 432_000_000

const t_origin: Int = 1_654_041_600_000

const t_n: Int = 36

fn spend_p(
  committee: List<ByteArray>,
  threshold: Int,
  ms: Int,
  origin: Int,
  n: Int,
  r: SpendRedeemer,
  tx: Transaction,
) -> Bool {
  drip_pot.spend(
    "early-tiger-deleg",
    t_lamp_policy,
    t_lamp_name,
    committee,
    threshold,
    ms,
    origin,
    n,
    None,
    r,
    util.mk_ref(0),
    tx,
  )
}

fn mint_p(
  committee: List<ByteArray>,
  threshold: Int,
  ms: Int,
  origin: Int,
  n: Int,
  r: MintRedeemer,
  tx: Transaction,
) -> Bool {
  drip_pot.mint(
    "early-tiger-deleg",
    t_lamp_policy,
    t_lamp_name,
    committee,
    threshold,
    ms,
    origin,
    n,
    r,
    t_own,
    tx,
  )
}

fn run_spend_with(
  committee: List<ByteArray>,
  threshold: Int,
  r: SpendRedeemer,
  _own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  spend_p(committee, threshold, t_ms, t_origin, t_n, r, tx)
}

fn run_spend(r: SpendRedeemer, tx: Transaction) -> Bool {
  run_spend_with([t_k1, t_k2], 1, r, util.mk_ref(0), tx)
}

fn run_mint_with(
  committee: List<ByteArray>,
  threshold: Int,
  r: MintRedeemer,
  tx: Transaction,
) -> Bool {
  mint_p(committee, threshold, t_ms, t_origin, t_n, r, tx)
}

fn run_mint(r: MintRedeemer, tx: Transaction) -> Bool {
  run_mint_with([t_k1, t_k2], 1, r, tx)
}

fn val(lovelace: Int, lamp: Int, token: Int) -> Value {
  assets.from_lovelace(lovelace)
    |> assets.add(t_lamp_policy, t_lamp_name, lamp)
    |> assets.add(t_own, account_token_name, token)
}

fn with_foreign(v: Value) -> Value {
  assets.add(v, t_foreign_policy, "X", 1)
}

/// Một giờ sau đầu cửa sổ `e`, cận dưới đóng, không cận trên.
fn at_epoch(e: Int) {
  interval.after(t_origin + e * t_ms + 3_600_000)
}

/// Khoảng ghim cho `MintAccounts`: [đầu cửa sổ `e` + 1 giờ, + 1,5 giờ], hai cận đóng.
fn pinned_at(e: Int) {
  let t = t_origin + e * t_ms + 3_600_000
  interval.between(t, t + 1_800_000)
}

/// Thẻ DP-CLAIM-4: Data của `OutputReference` input két.
fn tag_of(ix: Int) -> Data {
  let d: Data = util.mk_ref(ix)
  d
}

fn own_addr() -> Address {
  util.script_address(t_own)
}

fn reserve_out(lovelace: Int, lamp: Int) -> Output {
  util.mk_output(own_addr(), val(lovelace, lamp, 0), reserve_data())
}

fn account_data(vault: Address, e: Int, c: Int, s: Int) -> Data {
  let d: Data = Account { vault, entitlement: e, claimed: c, start_epoch: s }
  d
}

fn account_out(vault: Address, e: Int, c: Int, s: Int, lamp: Int) -> Output {
  util.mk_output(own_addr(), val(2_000_000, lamp, 1), account_data(vault, e, c, s))
}

fn crank_input() {
  util.mk_input(
    util.mk_ref(9),
    util.mk_output_no_datum(
      util.vk_address(t_crank),
      assets.from_lovelace(10_000_000),
    ),
  )
}

fn wallet_out(v: Value) -> Output {
  util.mk_output_no_datum(util.vk_address(t_crank), v)
}

fn tok(q: Int) -> Value {
  assets.from_asset(t_own, account_token_name, q)
}

// ── Fixture Seed: Reserve 100 → Account A 60 + Account B 30 + Reserve 10 ──

fn vault_a() -> Address {
  util.vk_address(t_user)
}

fn vault_b() -> Address {
  util.vk_address(t_user2)
}

fn seed_acc_a() -> Output {
  account_out(vault_a(), 60_000_000, 0, 320, 60_000_000)
}

fn seed_acc_b() -> Output {
  account_out(vault_b(), 30_000_000, 0, 320, 30_000_000)
}

fn seed_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      util.mk_input(util.mk_ref(0), reserve_out(2_000_000, 100_000_000)),
      crank_input(),
    ],
    outputs: [seed_acc_a(), seed_acc_b(), reserve_out(2_000_000, 10_000_000)],
    mint: tok(2),
    extra_signatories: [t_k1],
    validity_range: pinned_at(318),
  }
}

/// Seed chỉ mở Account A; LAMP của B (30) dồn về Reserve thối (40). Dùng làm nền cho
/// các ca đổi Account B.
fn seed_tx_with_b(b: Output, q: Int) -> Transaction {
  Transaction {
    ..seed_tx(),
    outputs: [seed_acc_a(), b, reserve_out(2_000_000, 10_000_000)],
    mint: tok(q),
  }
}

// ── Fixture Claim: E=36, c=4, s=317, lượt ở epoch 326 ⇒ vested 10, amount 6 ──

fn claim_vault() -> Address {
  util.vk_address(t_user)
}

fn claim_in_for(vault: Address) -> Output {
  account_out(vault, 36_000_000, 4_000_000, 317, 32_000_000)
}

fn claim_next_for(vault: Address) -> Output {
  account_out(vault, 36_000_000, 10_000_000, 317, 26_000_000)
}

/// Output đích hợp lệ: đúng địa chỉ vault, datum = thẻ của input két (ref 0).
fn pay(vault: Address, lamp: Int) -> Output {
  util.mk_output(vault, val(1_500_000, lamp, 0), tag_of(0))
}

fn claim_tx_for(vault: Address) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [util.mk_input(util.mk_ref(0), claim_in_for(vault)), crank_input()],
    outputs: [claim_next_for(vault), pay(vault, 6_000_000)],
    validity_range: at_epoch(326),
  }
}

fn claim_tx() -> Transaction {
  claim_tx_for(claim_vault())
}

fn claim_tx_with_next(next: Output) -> Transaction {
  Transaction { ..claim_tx(), outputs: [next, pay(claim_vault(), 6_000_000)] }
}

fn claim_tx_with_in(input: Output) -> Transaction {
  Transaction {
    ..claim_tx(),
    inputs: [util.mk_input(util.mk_ref(0), input), crank_input()],
  }
}

fn claim_tx_with_pay(p: Output) -> Transaction {
  Transaction { ..claim_tx(), outputs: [claim_next_for(claim_vault()), p] }
}

// ── Fixture Claim cuối: E=36, c=30, epoch 352 ⇒ vested 36, amount 6, burn 1 ──

fn final_in() -> Output {
  account_out(claim_vault(), 36_000_000, 30_000_000, 317, 6_000_000)
}

fn final_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [util.mk_input(util.mk_ref(0), final_in()), crank_input()],
    outputs: [
      pay(claim_vault(), 6_000_000),
      wallet_out(assets.from_lovelace(12_000_000)),
    ],
    mint: tok(-1),
    validity_range: at_epoch(352),
  }
}

// ═══ Định dạng dữ liệu (§2) ═══════════════════════════════════════

test datum_reserve_cbor_is_d87980() {
  cbor.serialise(reserve_data()) == #"d87980"
}

test datum_account_is_constr_1() {
  bytearray.take(cbor.serialise(account_data(vault_a(), 1, 0, 0)), 2) == #"d87a"
}

test redeemer_constructor_indices() {
  let seed: Data = Seed
  let claim: Data = Claim
  let mint_accounts: Data = MintAccounts
  let burn_account: Data = BurnAccount
  and {
    cbor.serialise(seed) == #"d87980",
    cbor.serialise(claim) == #"d87a80",
    cbor.serialise(mint_accounts) == #"d87980",
    cbor.serialise(burn_account) == #"d87a80",
  }
}

test vested_schedule_points() {
  and {
    util.vested(36_000_000, 317, 316, 36) == 0,
    util.vested(36_000_000, 317, 317, 36) == 1_000_000,
    util.vested(36_000_000, 317, 352, 36) == 36_000_000,
    util.vested(36_000_000, 317, 500, 36) == 36_000_000,
    util.vested(10, 0, 0, 3) == 3,
  }
}

// ═══ Ca dương ═════════════════════════════════════════════════════

test seed_two_accounts_from_reserve() {
  let tx = seed_tx()
  and {
    run_spend(Seed, tx),
    run_mint(MintAccounts, tx),
  }
}

test seed_threshold_two_with_two_distinct_keys() {
  let tx = Transaction { ..seed_tx(), extra_signatories: [t_k1, t_k2] }
  and {
    run_spend_with([t_k1, t_k2], 2, Seed, util.mk_ref(0), tx),
    run_mint_with([t_k1, t_k2], 2, MintAccounts, tx),
  }
}

test mint_accepts_start_epoch_equal_to_current() {
  run_mint(
    MintAccounts,
    seed_tx_with_b(account_out(vault_b(), 30_000_000, 0, 318, 30_000_000), 2),
  )
}

test claim_middle_round() {
  run_spend(Claim, claim_tx())
}

test claim_final_round_with_burn() {
  let tx = final_tx()
  and {
    run_spend(Claim, tx),
    run_mint(BurnAccount, tx),
  }
}

/// Đích là địa chỉ script (vd `did_payment`). v0.2: output đích mang datum thẻ, không
/// còn "không datum" như v0.1.
test claim_to_script_vault_with_tag() {
  run_spend(Claim, claim_tx_for(util.script_address(t_did_script)))
}

test claim_to_vault_with_stake_credential() {
  run_spend(Claim, claim_tx_for(util.vk_address_staked(t_user, t_other_stake)))
}

/// Output đích trả DƯ (> amount) vẫn hợp lệ: `lamp ≥ amount`.
test claim_vault_payment_above_amount() {
  run_spend(Claim, claim_tx_with_pay(pay(claim_vault(), 7_000_000)))
}

/// Cận dưới MỞ tại (đầu cửa sổ 326) − 1 ⇒ thời điểm sớm nhất = đầu cửa sổ 326. Bỏ
/// phép `+ 1` thì epoch đọc ra 325, amount = 5 ≠ 6 mà datum tiếp nối ghi ⇒ đỏ.
test claim_open_lower_bound_counts_from_lo_plus_one() {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      validity_range: interval.entirely_after(t_origin + 326 * t_ms - 1),
    },
  )
}

// ═══ §4: cặp (datum, redeemer) + datum inline ════════════════════

test spend_rejects_reserve_with_claim() fail {
  run_spend(Claim, seed_tx())
}

test spend_rejects_account_with_seed() fail {
  run_spend(Seed, Transaction { ..claim_tx(), extra_signatories: [t_k1] })
}

test spend_rejects_reserve_datum_not_inline() fail {
  let r = reserve_out(2_000_000, 100_000_000)
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), Output { ..r, datum: DatumHash(#"00") }),
        crank_input(),
      ],
    },
  )
}

// ═══ DP-SEED-* ════════════════════════════════════════════════════

test dp_seed_1_rejects_without_committee_signature() fail {
  run_spend(Seed, Transaction { ..seed_tx(), extra_signatories: [t_crank] })
}

test dp_seed_1_rejects_same_key_listed_twice_in_committee() fail {
  run_spend_with([t_k1, t_k1], 2, Seed, util.mk_ref(0), seed_tx())
}

/// Input thứ hai của két mang datum `Account` (không token). Reserve thối 15 để
/// DP-SEED-3 vẫn thoả.
test dp_seed_2_rejects_second_input_with_account_datum() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), reserve_out(2_000_000, 100_000_000)),
        util.mk_input(
          util.mk_ref(1),
          util.mk_output(
            own_addr(),
            val(2_000_000, 5_000_000, 0),
            account_data(vault_a(), 5_000_000, 0, 320),
          ),
        ),
        crank_input(),
      ],
      outputs: [seed_acc_a(), seed_acc_b(), reserve_out(2_000_000, 15_000_000)],
    },
  )
}

test dp_seed_2_rejects_second_input_holding_token() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), reserve_out(2_000_000, 100_000_000)),
        util.mk_input(
          util.mk_ref(1),
          util.mk_output(own_addr(), val(2_000_000, 5_000_000, 1), reserve_data()),
        ),
        crank_input(),
      ],
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        reserve_out(2_000_000, 15_000_000),
        wallet_out(tok(1)),
      ],
    },
  )
}

test dp_seed_2_rejects_second_input_with_datum_hash() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), reserve_out(2_000_000, 100_000_000)),
        util.mk_input(
          util.mk_ref(1),
          Output {
            ..reserve_out(2_000_000, 5_000_000),
            datum: DatumHash(#"00"),
          },
        ),
        crank_input(),
      ],
      outputs: [seed_acc_a(), seed_acc_b(), reserve_out(2_000_000, 15_000_000)],
    },
  )
}

test dp_seed_3_rejects_lamp_leaving_reserve() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        reserve_out(2_000_000, 9_000_000),
        wallet_out(val(2_000_000, 1_000_000, 0)),
      ],
    },
  )
}

test dp_seed_4_rejects_reserve_output_with_foreign_token() fail {
  let r = reserve_out(2_000_000, 10_000_000)
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        Output { ..r, value: with_foreign(r.value) },
      ],
    },
  )
}

test dp_seed_4_rejects_script_output_without_datum() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        util.mk_output_no_datum(own_addr(), val(2_000_000, 10_000_000, 0)),
      ],
    },
  )
}

/// Output không datum ở địa chỉ két + stake credential lạ: bộ lọc RỘNG (payment
/// credential) vẫn đếm nó là output của két. Thu hẹp bộ lọc về địa chỉ đầy đủ thì
/// ca này lọt.
test dp_seed_4_rejects_untagged_output_at_rehomed_script_address() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        util.mk_output_no_datum(
          util.script_address_staked(t_own, t_other_stake),
          val(2_000_000, 10_000_000, 0),
        ),
      ],
    },
  )
}

test dp_seed_4_rejects_reserve_output_with_reference_script() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        Output {
          ..reserve_out(2_000_000, 10_000_000),
          reference_script: Some(t_did_script),
        },
      ],
    },
  )
}

test dp_seed_4_rejects_output_with_account_datum_but_no_token() fail {
  run_spend(
    Seed,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        util.mk_output(
          own_addr(),
          val(2_000_000, 10_000_000, 0),
          account_data(vault_a(), 10_000_000, 0, 320),
        ),
      ],
    },
  )
}

// ═══ DP-CLAIM-* ═══════════════════════════════════════════════════

/// Hai tài khoản cùng vault, cùng trạng thái, MỘT output trả: đúng hình double
/// satisfaction. Tài khoản thứ hai đi về ví kẻ dựng tx.
test dp_claim_1_rejects_second_account_input() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), claim_in_for(claim_vault())),
        util.mk_input(util.mk_ref(1), claim_in_for(claim_vault())),
        crank_input(),
      ],
      outputs: [
        claim_next_for(claim_vault()),
        pay(claim_vault(), 6_000_000),
        wallet_out(val(2_000_000, 32_000_000, 1)),
      ],
    },
  )
}

test dp_claim_2_rejects_input_without_token() fail {
  run_spend(
    Claim,
    claim_tx_with_in(
      util.mk_output(
        own_addr(),
        val(2_000_000, 32_000_000, 0),
        account_data(claim_vault(), 36_000_000, 4_000_000, 317),
      ),
    ),
  )
}

test dp_claim_2_rejects_input_with_two_tokens() fail {
  run_spend(
    Claim,
    claim_tx_with_in(
      util.mk_output(
        own_addr(),
        val(2_000_000, 32_000_000, 2),
        account_data(claim_vault(), 36_000_000, 4_000_000, 317),
      ),
    ),
  )
}

test dp_claim_2_rejects_lamp_above_entitlement_minus_claimed() fail {
  run_spend(
    Claim,
    claim_tx_with_in(
      account_out(claim_vault(), 36_000_000, 4_000_000, 317, 32_000_001),
    ),
  )
}

test dp_claim_2_rejects_lamp_below_entitlement_minus_claimed() fail {
  run_spend(
    Claim,
    claim_tx_with_in(
      account_out(claim_vault(), 36_000_000, 4_000_000, 317, 31_999_999),
    ),
  )
}

/// Epoch 320 ⇒ vested 4 = claimed ⇒ amount 0. Tiếp nối giữ nguyên, trả 0.
test dp_claim_3_rejects_nothing_due() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      outputs: [claim_in_for(claim_vault()), pay(claim_vault(), 0)],
      validity_range: at_epoch(320),
    },
  )
}

test dp_claim_3_rejects_unbounded_lower_bound() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      validity_range: interval.before(t_origin + 400 * t_ms),
    },
  )
}

/// `lo` trước gốc 1 ms. Tài khoản dựng với start −10 để epoch đọc ra (−1 theo chia
/// sàn, 0 theo chia cắt) vẫn cho amount > 0 — chỉ chốt `lo − gốc ≥ 0` chặn được.
test dp_claim_3_rejects_lower_bound_before_origin() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      inputs: [
        util.mk_input(
          util.mk_ref(0),
          account_out(claim_vault(), 36_000_000, 0, -10, 36_000_000),
        ),
        crank_input(),
      ],
      outputs: [
        account_out(claim_vault(), 36_000_000, 10_000_000, -10, 26_000_000),
        pay(claim_vault(), 10_000_000),
      ],
      validity_range: interval.after(t_origin - 1),
    },
  )
}

test dp_claim_4_rejects_vault_output_short() fail {
  run_spend(Claim, claim_tx_with_pay(pay(claim_vault(), 5_999_999)))
}

test dp_claim_4_rejects_vault_output_without_tag() fail {
  run_spend(
    Claim,
    claim_tx_with_pay(
      util.mk_output_no_datum(claim_vault(), val(1_500_000, 6_000_000, 0)),
    ),
  )
}

test dp_claim_4_rejects_vault_output_with_other_datum() fail {
  run_spend(
    Claim,
    claim_tx_with_pay(
      util.mk_output(claim_vault(), val(1_500_000, 6_000_000, 0), reserve_data()),
    ),
  )
}

/// Hai két khác hash cùng trả một vault: output duy nhất mang thẻ của input két KIA
/// (ref 5). Đo dòng ròng (v0.1) thì một output thoả được cả hai két.
test dp_claim_4_rejects_output_tagged_for_another_pot_input() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), claim_in_for(claim_vault())),
        util.mk_input(
          util.mk_ref(5),
          util.mk_output(
            util.script_address(t_did_script),
            val(2_000_000, 6_000_000, 0),
            reserve_data(),
          ),
        ),
        crank_input(),
      ],
      outputs: [
        claim_next_for(claim_vault()),
        util.mk_output(claim_vault(), val(1_500_000, 6_000_000, 0), tag_of(5)),
        wallet_out(val(0, 6_000_000, 0)),
      ],
    },
  )
}

/// Output mang thẻ hợp lệ ĐỨNG TRƯỚC, bản sao mang cùng thẻ đứng sau.
test dp_claim_4_rejects_two_tagged_outputs() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      outputs: [
        claim_next_for(claim_vault()),
        pay(claim_vault(), 6_000_000),
        pay(claim_vault(), 0),
      ],
    },
  )
}

test dp_claim_4_rejects_vault_output_with_foreign_token() fail {
  let p = pay(claim_vault(), 6_000_000)
  run_spend(Claim, claim_tx_with_pay(Output { ..p, value: with_foreign(p.value) }))
}

test dp_claim_4_rejects_vault_output_with_reference_script() fail {
  run_spend(
    Claim,
    claim_tx_with_pay(
      Output {
        ..pay(claim_vault(), 6_000_000),
        reference_script: Some(t_did_script),
      },
    ),
  )
}

test dp_claim_4_rejects_payment_to_vault_key_with_other_stake() fail {
  run_spend(
    Claim,
    claim_tx_with_pay(
      pay(util.vk_address_staked(t_user, t_other_stake), 6_000_000),
    ),
  )
}

test dp_claim_5_rejects_continuing_at_other_stake() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      Output {
        ..claim_next_for(claim_vault()),
        address: util.script_address_staked(t_own, t_other_stake),
      },
    ),
  )
}

/// Output hợp lệ ĐỨNG TRƯỚC, output thừa sau (một Reserve không LAMP).
test dp_claim_5_rejects_second_script_output() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      outputs: [
        claim_next_for(claim_vault()),
        reserve_out(2_000_000, 0),
        pay(claim_vault(), 6_000_000),
      ],
    },
  )
}

test dp_claim_5_rejects_claimed_understated() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      account_out(claim_vault(), 36_000_000, 9_999_999, 317, 26_000_000),
    ),
  )
}

/// Datum tiếp nối đúng bốn trường + một trường THỪA ở cuối. Parse lỏng từng trường
/// (`expect Account{..} = raw`) thì bỏ qua đuôi thừa; so Data bằng hệt thì không.
test dp_claim_5_rejects_datum_with_extra_field() fail {
  let vault_data: Data = claim_vault()
  let e: Data = 36_000_000
  let c: Data = 10_000_000
  let s: Data = 317
  let extra: Data = 0
  run_spend(
    Claim,
    claim_tx_with_next(
      util.mk_output(
        own_addr(),
        val(2_000_000, 26_000_000, 1),
        builtin.constr_data(1, [vault_data, e, c, s, extra]),
      ),
    ),
  )
}

test dp_claim_5_rejects_vault_changed() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      account_out(
        util.vk_address(t_crank),
        36_000_000,
        10_000_000,
        317,
        26_000_000,
      ),
    ),
  )
}

test dp_claim_5_rejects_entitlement_changed() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      account_out(claim_vault(), 72_000_000, 10_000_000, 317, 26_000_000),
    ),
  )
}

test dp_claim_5_rejects_start_epoch_changed() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      account_out(claim_vault(), 36_000_000, 10_000_000, 300, 26_000_000),
    ),
  )
}

test dp_claim_5_rejects_lamp_short_in_continuing() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      account_out(claim_vault(), 36_000_000, 10_000_000, 317, 25_999_999),
    ),
  )
}

/// LAMP DƯ ở tiếp nối cũng hỏng: lượt sau DP-CLAIM-2 (`lamp == E − c`) không bao giờ
/// thoả nữa ⇒ tài khoản bị khoá vĩnh viễn.
test dp_claim_5_rejects_lamp_extra_in_continuing() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      account_out(claim_vault(), 36_000_000, 10_000_000, 317, 26_000_001),
    ),
  )
}

test dp_claim_5_rejects_ada_decrease() fail {
  let n = claim_next_for(claim_vault())
  run_spend(
    Claim,
    claim_tx_with_next(Output { ..n, value: val(1_999_999, 26_000_000, 1) }),
  )
}

test dp_claim_5_rejects_foreign_token_in_continuing() fail {
  let n = claim_next_for(claim_vault())
  run_spend(Claim, claim_tx_with_next(Output { ..n, value: with_foreign(n.value) }))
}

test dp_claim_5_rejects_reference_script_on_continuing() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      Output {
        ..claim_next_for(claim_vault()),
        reference_script: Some(t_did_script),
      },
    ),
  )
}

test dp_claim_5_rejects_datum_hash_on_continuing() fail {
  run_spend(
    Claim,
    claim_tx_with_next(
      Output { ..claim_next_for(claim_vault()), datum: DatumHash(#"00") },
    ),
  )
}

test dp_claim_5_rejects_mint_during_partial_claim() fail {
  run_spend(
    Claim,
    Transaction {
      ..claim_tx(),
      outputs: [
        claim_next_for(claim_vault()),
        pay(claim_vault(), 6_000_000),
        wallet_out(tok(1)),
      ],
      mint: tok(1),
    },
  )
}

test dp_claim_6_rejects_final_without_burn() fail {
  run_spend(
    Claim,
    Transaction {
      ..final_tx(),
      outputs: [
        pay(claim_vault(), 6_000_000),
        wallet_out(val(12_000_000, 0, 1)),
      ],
      mint: assets.zero,
    },
  )
}

test dp_claim_6_rejects_final_with_script_output_left() fail {
  run_spend(
    Claim,
    Transaction {
      ..final_tx(),
      outputs: [
        pay(claim_vault(), 6_000_000),
        reserve_out(2_000_000, 0),
        wallet_out(assets.from_lovelace(10_000_000)),
      ],
    },
  )
}

/// Tên thừa xếp SAU "account" theo thứ tự byte ("zzzz" > "account"), để cặp đầu của
/// dict vẫn là cặp hợp lệ.
test dp_claim_6_rejects_final_burn_with_extra_name() fail {
  let tx = final_tx()
  run_spend(
    Claim,
    Transaction {
      ..tx,
      outputs: [
        pay(claim_vault(), 6_000_000),
        wallet_out(
          assets.from_lovelace(12_000_000)
            |> assets.add(t_own, "zzzz", 1),
        ),
      ],
      mint: tok(-1) |> assets.add(t_own, "zzzz", 1),
    },
  )
}

// ═══ §5 + DP-MINT-* ═══════════════════════════════════════════════

test mint_rejects_extra_token_name() fail {
  run_mint(
    MintAccounts,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        reserve_out(2_000_000, 10_000_000),
        wallet_out(assets.from_asset(t_own, "zzzz", 1)),
      ],
      mint: tok(2) |> assets.add(t_own, "zzzz", 1),
    },
  )
}

test mint_rejects_other_name_only() fail {
  run_mint(
    MintAccounts,
    Transaction {
      ..seed_tx(),
      outputs: [wallet_out(assets.from_asset(t_own, "accounts", 2))],
      mint: assets.from_asset(t_own, "accounts", 2),
    },
  )
}

test mint_rejects_mint_accounts_with_negative_quantity() fail {
  run_mint(MintAccounts, Transaction { ..final_tx(), extra_signatories: [t_k1] })
}

test dp_mint_1_rejects_without_committee_signature() fail {
  run_mint(MintAccounts, Transaction { ..seed_tx(), extra_signatories: [t_crank] })
}

test dp_mint_1_rejects_same_key_listed_twice_in_committee() fail {
  run_mint_with([t_k1, t_k1], 2, MintAccounts, seed_tx())
}

/// Một Account có sẵn (token 1) bị tiêu kèm, toàn bộ value của nó ra ví. Số output
/// giữ token ở két vẫn bằng q = 2 ⇒ chỉ DP-MINT-2 chặn.
test dp_mint_2_rejects_script_input_holding_token() fail {
  let tx = seed_tx()
  run_mint(
    MintAccounts,
    Transaction {
      ..tx,
      inputs: [
        util.mk_input(util.mk_ref(0), reserve_out(2_000_000, 100_000_000)),
        util.mk_input(util.mk_ref(1), claim_in_for(claim_vault())),
        crank_input(),
      ],
      outputs: [
        seed_acc_a(),
        seed_acc_b(),
        reserve_out(2_000_000, 10_000_000),
        wallet_out(val(2_000_000, 32_000_000, 1)),
      ],
    },
  )
}

/// Đúc 2 nhưng chỉ một Account ở két; token thứ hai ra ví.
test dp_mint_3_rejects_minted_token_sent_to_wallet() fail {
  run_mint(
    MintAccounts,
    Transaction {
      ..seed_tx(),
      outputs: [
        seed_acc_a(),
        reserve_out(2_000_000, 40_000_000),
        wallet_out(tok(1)),
      ],
    },
  )
}

test dp_mint_3_rejects_output_holding_two_tokens() fail {
  run_mint(
    MintAccounts,
    Transaction {
      ..seed_tx(),
      outputs: [
        util.mk_output(
          own_addr(),
          val(2_000_000, 60_000_000, 2),
          account_data(vault_a(), 60_000_000, 0, 320),
        ),
        reserve_out(2_000_000, 40_000_000),
      ],
    },
  )
}

test dp_mint_4_rejects_zero_entitlement() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(account_out(vault_b(), 0, 0, 320, 0), 2),
  )
}

test dp_mint_4_rejects_nonzero_claimed() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(account_out(vault_b(), 30_000_000, 1, 320, 30_000_000), 2),
  )
}

test dp_mint_4_rejects_start_epoch_in_past() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(account_out(vault_b(), 30_000_000, 0, 317, 30_000_000), 2),
  )
}

test dp_mint_4_rejects_vault_at_own_script() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(
      account_out(
        util.script_address_staked(t_own, t_other_stake),
        30_000_000,
        0,
        320,
        30_000_000,
      ),
      2,
    ),
  )
}

test dp_mint_4_rejects_lamp_below_entitlement() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(account_out(vault_b(), 30_000_000, 0, 320, 29_999_999), 2),
  )
}

test dp_mint_4_rejects_lamp_above_entitlement() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(account_out(vault_b(), 30_000_000, 0, 320, 30_000_001), 2),
  )
}

test dp_mint_4_rejects_foreign_token_on_account() fail {
  let b = seed_acc_b()
  run_mint(MintAccounts, seed_tx_with_b(Output { ..b, value: with_foreign(b.value) }, 2))
}

test dp_mint_4_rejects_reference_script_on_account() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(Output { ..seed_acc_b(), reference_script: Some(t_did_script) }, 2),
  )
}

test dp_mint_4_rejects_reserve_datum_with_token() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(
      util.mk_output(own_addr(), val(2_000_000, 30_000_000, 1), reserve_data()),
      2,
    ),
  )
}

test dp_mint_4_rejects_account_without_inline_datum() fail {
  run_mint(
    MintAccounts,
    seed_tx_with_b(Output { ..seed_acc_b(), datum: NoDatum }, 2),
  )
}

test dp_mint_4_rejects_unbounded_lower_bound() fail {
  run_mint(
    MintAccounts,
    Transaction { ..seed_tx(), validity_range: interval.before(t_origin + 400 * t_ms) },
  )
}

/// Seed mở tài khoản `start_epoch = 0` (đã nhả trọn) — nền cho các ca lùi thời gian.
fn seed_tx_start_zero() -> Transaction {
  Transaction {
    ..seed_tx(),
    outputs: [
      account_out(vault_a(), 60_000_000, 0, 0, 60_000_000),
      account_out(vault_b(), 30_000_000, 0, 0, 30_000_000),
      reserve_out(2_000_000, 10_000_000),
    ],
  }
}

/// Lùi `lo` về gốc lưới, cận trên MỞ (+∞): `epoch(tx)` đọc ra 0 ⇒ start 0 lọt nếu
/// không ghim cận trên.
test dp_mint_4_rejects_lo_at_origin_with_open_upper() fail {
  run_mint(
    MintAccounts,
    Transaction { ..seed_tx_start_zero(), validity_range: interval.after(t_origin) },
  )
}

/// Lùi `lo` về gốc lưới, cận trên xa (bây giờ).
test dp_mint_4_rejects_lo_at_origin_with_far_upper() fail {
  run_mint(
    MintAccounts,
    Transaction {
      ..seed_tx_start_zero(),
      validity_range: interval.between(t_origin, t_origin + 318 * t_ms),
    },
  )
}

/// Cùng cửa sổ 318, rộng 1 giờ + 1 ms: chỉ trần độ rộng chặn.
test dp_mint_4_rejects_range_wider_than_one_hour() fail {
  let t = t_origin + 318 * t_ms + 3_600_000
  run_mint(
    MintAccounts,
    Transaction { ..seed_tx(), validity_range: interval.between(t, t + 3_600_001) },
  )
}

/// Rộng 40 phút nhưng vắt qua đầu cửa sổ 319: chỉ phép "cùng cửa sổ" chặn.
test dp_mint_4_rejects_range_spanning_window_boundary() fail {
  let b = t_origin + 319 * t_ms
  run_mint(
    MintAccounts,
    Transaction {
      ..seed_tx(),
      validity_range: interval.between(b - 1_800_000, b + 600_000),
    },
  )
}

// ═══ DP-PARAM ═════════════════════════════════════════════════════

/// threshold 0, có một chữ ký committee: bỏ vế `threshold ≥ 1` thì đếm 1 ≥ 0 lọt.
test dp_param_rejects_threshold_zero() fail {
  run_spend_with([t_k1, t_k2], 0, Seed, util.mk_ref(0), seed_tx())
}

/// committee `[k1, k1]`, threshold 2 > |unique| = 1. (Vế này bị vế đếm bao hàm — xem
/// chú thích `committee_approved`.)
test dp_param_rejects_threshold_above_unique_committee() fail {
  run_mint_with([t_k1, t_k1], 2, MintAccounts, seed_tx())
}

/// 17 khoá khác nhau, threshold 1, k1 ký: chỉ trần `|committee| ≤ 16` chặn.
test dp_param_rejects_committee_over_sixteen() fail {
  run_spend_with(
    [
      t_k1, #"01", #"02", #"03", #"04", #"05", #"06", #"07", #"08", #"09", #"0a",
      #"0b", #"0c", #"0d", #"0e", #"0f", #"10",
    ],
    1,
    Seed,
    util.mk_ref(0),
    seed_tx(),
  )
}

/// Nhánh mint không đọc `vest_epochs` ⇒ chỉ DP-PARAM chặn.
test dp_param_rejects_vest_epochs_zero() fail {
  mint_p([t_k1, t_k2], 1, t_ms, t_origin, 0, MintAccounts, seed_tx())
}

/// Nhánh Seed không đọc thời gian ⇒ chỉ DP-PARAM chặn.
test dp_param_rejects_ms_per_epoch_zero() fail {
  spend_p([t_k1, t_k2], 1, 0, t_origin, t_n, Seed, seed_tx())
}

test dp_param_rejects_negative_origin() fail {
  spend_p([t_k1, t_k2], 1, t_ms, -1, t_n, Seed, seed_tx())
}

/// Đối chứng cho ba ca trên: cùng tham số hợp lệ trên đúng hai nhánh đó thì qua.
test dp_param_valid_params_pass_on_seed_and_mint() {
  and {
    spend_p([t_k1, t_k2], 1, t_ms, t_origin, t_n, Seed, seed_tx()),
    mint_p([t_k1, t_k2], 1, t_ms, t_origin, t_n, MintAccounts, seed_tx()),
  }
}

// ═══ DP-BURN-1 + lượng q sai nhánh ═══════════════════════════════

test dp_burn_1_rejects_burn_of_two() fail {
  run_mint(BurnAccount, Transaction { ..final_tx(), mint: tok(-2) })
}

test dp_burn_1_rejects_positive_quantity() fail {
  run_mint(BurnAccount, seed_tx())
}

test dp_burn_1_rejects_without_script_input() fail {
  run_mint(BurnAccount, Transaction { ..final_tx(), inputs: [crank_input()] })
}

test dp_burn_1_rejects_two_script_inputs() fail {
  run_mint(
    BurnAccount,
    Transaction {
      ..final_tx(),
      inputs: [
        util.mk_input(util.mk_ref(0), final_in()),
        util.mk_input(util.mk_ref(1), reserve_out(2_000_000, 0)),
        crank_input(),
      ],
    },
  )
}

test dp_burn_1_rejects_input_without_token() fail {
  run_mint(
    BurnAccount,
    Transaction {
      ..final_tx(),
      inputs: [
        util.mk_input(
          util.mk_ref(0),
          util.mk_output(
            own_addr(),
            val(2_000_000, 6_000_000, 0),
            account_data(claim_vault(), 36_000_000, 30_000_000, 317),
          ),
        ),
        crank_input(),
      ],
    },
  )
}
