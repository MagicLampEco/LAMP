// faucet_account — UTxO per-DID mang ACCT NFT, giữ tLAMP đã claim.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM
//   faucet_nft_policy : policy id POOL/ACCT NFT (nhận diện pool qua POOL NFT).
//   did_nft_policy    : policy id DID NFT (chủ DID phải mang để Use).
//   lamp_policy       : policy id tLAMP.
//   lamp_name         : asset name tLAMP.
//   ms_per_epoch      : ms mỗi cửa sổ.
// Validator này KHÔNG ôm hash của pool (nhận diện pool bằng POOL NFT) ⇒ nó đứng
// TRƯỚC `faucet_pool` trong dãy áp tham số, và dãy đó acyclic.
//
// Datum: FaucetAccount{did_name, last_claim_epoch, last_touch_epoch}.
// HAI mốc, hai nghĩa — gộp làm một là một lỗ: `Use` gia hạn mốc idle, và nếu đó
// cũng là mốc cooldown thì ai dùng tLAMP đúng cách lại bị đẩy cooldown ra xa,
// còn kẻ chỉ claim rồi bỏ đó thì không chịu gì.
//
// THÂN của handler nằm ở `lib/magiclamp/faucet/handlers.ak` → `account_spend`
// (kèm toàn bộ chốt C-USE-* / C-TOP-* / C-BURN-*). Lý do tách: Aiken không xuất
// handler của validator ra ngoài module, mà lớp ca kiểm "hai validator một tx"
// bắt buộc phải gọi được nó từ `faucet_pool.ak`. Xem đầu `handlers.ak`.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/faucet/handlers
use magiclamp/faucet/ledger.{
  AccountRedeemer, FaucetAccount, FaucetConfig, PoolDatum, ReclaimIdle, TopUp,
  Use, acct_name, pool_nft_name,
}
use magiclamp/faucet/util

validator faucet_account(
  faucet_nft_policy: ByteArray,
  did_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<FaucetAccount>,
    redeemer: AccountRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    handlers.account_spend(
      faucet_nft_policy,
      did_nft_policy,
      lamp_policy,
      lamp_name,
      ms_per_epoch,
      datum_opt,
      redeemer,
      own_ref,
      tx,
    )
  }

  else(_) {
    fail
  }
}


// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const fa_nft_policy: ByteArray = #"facade01"

const fa_did_policy: ByteArray = #"d1dd1d"

const fa_lamp_policy: ByteArray = #"1a3b"

const fa_lamp_name: ByteArray = #"744c414d50"

const fa_acct_sh: ByteArray = #"acc0"

const fa_pool_sh: ByteArray = #"facade"

const fa_ms_per_epoch: Int = 432_000_000

const fa_drip: Int = 1_001_000_000

const fa_cooldown: Int = 36

const fa_max_claims: Int = 20

const fa_did_name: ByteArray = #"a11ce0"

const fa_other_did: ByteArray = #"b0b0b0"

const fa_thief_pkh: ByteArray = #"a77ac6"

fn fa_acct_datum(name: ByteArray, claim_ep: Int, touch_ep: Int) -> FaucetAccount {
  FaucetAccount {
    did_name: name,
    last_claim_epoch: claim_ep,
    last_touch_epoch: touch_ep,
  }
}

fn fa_cfg() -> FaucetConfig {
  FaucetConfig {
    drip_oildrop: fa_drip,
    cooldown_epochs: fa_cooldown,
    max_claims_per_window: fa_max_claims,
  }
}

fn fa_pool_datum(window: Int, claims: Int) -> PoolDatum {
  PoolDatum { cfg: fa_cfg(), window_epoch: window, claims_in_window: claims }
}

/// account value: lovelace + ACCT NFT (tên neo vào DID) + tLAMP.
fn fa_acct_val(name: ByteArray, lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fa_nft_policy, acct_name(name), 1)
    |> assets.add(fa_lamp_policy, fa_lamp_name, tlamp)
}

/// pool value (POOL NFT) nhận token reclaim.
fn fa_pool_val(lovelace: Int, tlamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(fa_nft_policy, pool_nft_name, 1)
    |> assets.add(fa_lamp_policy, fa_lamp_name, tlamp)
}

fn fa_did_val(name: ByteArray) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(fa_did_policy, name, 1)
}

fn fa_did_input(name: ByteArray) -> Input {
  util.mk_input(
    util.mk_ref(7),
    util.mk_output_no_datum(util.vk_address(#"c1"), fa_did_val(name)),
  )
}

/// validity range NEO: cả hai cận trong CÙNG bucket `epoch` (hợp đồng của
/// `get_epoch_pinned`).
fn fa_tx_at(epoch: Int, base: Transaction) -> Transaction {
  let lo = epoch * fa_ms_per_epoch
  Transaction {
    ..base,
    validity_range: interval.between(lo, lo + fa_ms_per_epoch - 1),
  }
}

/// validity range KHÔNG neo (cận trên vô hạn) — chỉ dùng cho ca âm.
fn fa_tx_open(epoch: Int, base: Transaction) -> Transaction {
  let lo = epoch * fa_ms_per_epoch
  Transaction { ..base, validity_range: interval.entirely_after(lo) }
}

fn fa_mint(name: ByteArray, qty: Int) -> assets.Value {
  assets.zero |> assets.add(fa_nft_policy, acct_name(name), qty)
}

// ── USE tests ────────────────────────────────────────────────────
// Một builder dùng chung cho ca dương và mọi ca âm: hai cực chỉ khác đúng
// trường đang kiểm.

fn use_tx(
  now: Int,
  in_claim: Int,
  in_touch: Int,
  out_claim: Int,
  out_touch: Int,
  out_tlamp: Int,
) -> Transaction {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, in_claim, in_touch),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, out_tlamp),
      fa_acct_datum(fa_did_name, out_claim, out_touch),
    )
  fa_tx_at(
    now,
    Transaction {
      ..placeholder,
      inputs: [acct_in, fa_did_input(fa_did_name)],
      outputs: [acct_out],
    },
  )
}

fn use_run(datum: FaucetAccount, tx: Transaction) -> Bool {
  faucet_account.spend(
    fa_nft_policy,
    fa_did_policy,
    fa_lamp_policy,
    fa_lamp_name,
    fa_ms_per_epoch,
    Some(datum),
    Use,
    util.mk_ref(0),
    tx,
  )
}

test use_happy() {
  let tx = use_tx(150, 100, 100, 100, 150, fa_drip)
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// Ca dương song sinh của `use_doi_last_claim_epoch`: gia hạn idle mà KHÔNG đụng
/// mốc cooldown thì phải xanh.
test use_gia_han_khong_doi_cooldown() {
  let tx = use_tx(400, 100, 380, 100, 400, fa_drip - 1)
  use_run(fa_acct_datum(fa_did_name, 100, 380), tx)
}

test use_no_did_nft() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 150),
    )
  let tx =
    fa_tx_at(
      150,
      Transaction { ..placeholder, inputs: [acct_in], outputs: [acct_out] },
    )
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

test use_epoch_not_now() fail {
  // out.last_touch_epoch ≠ now → C-USE-TOUCH-1.
  let tx = use_tx(150, 100, 100, 100, 999, fa_drip)
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// C-USE-MONO-1: mốc idle LÙI về quá khứ. Không có dòng đó, mốc idle tụt và
/// account bị thu hồi sớm hơn chủ DID tưởng.
test use_lui_moc_ve_qua_khu() fail {
  let tx = use_tx(150, 100, 200, 100, 150, fa_drip)
  use_run(fa_acct_datum(fa_did_name, 100, 200), tx)
}

/// C-USE-CLAIMFIX-1: `Use` đẩy mốc COOLDOWN lên now ⇒ cooldown bị reset/né.
test use_doi_last_claim_epoch() fail {
  let tx = use_tx(150, 100, 100, 150, 150, fa_drip)
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// C-USE-EPOCH-1: cận trên vô hạn ⇒ `now` do người dựng tx chọn.
test use_upper_bound_vo_han() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 150),
    )
  let tx =
    fa_tx_open(
      150,
      Transaction {
        ..placeholder,
        inputs: [acct_in, fa_did_input(fa_did_name)],
        outputs: [acct_out],
      },
    )
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

test use_self_inflate_tlamp() fail {
  // account_out tLAMP > in → bơm token vào account → reject.
  let tx = use_tx(150, 100, 100, 100, 150, fa_drip + 1)
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// C-USE-NAME-1: acct_out mang ACCT NFT của DID KHÁC (tên không khớp datum).
test use_acct_out_name_khac_did() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_other_did, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 150),
    )
  let tx =
    fa_tx_at(
      150,
      Transaction {
        ..placeholder,
        inputs: [acct_in, fa_did_input(fa_did_name)],
        outputs: [acct_out],
      },
    )
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// C-USE-2: `Use` đúc thêm một ACCT NFT cùng tên.
test use_mint_them_acct() fail {
  let tx = use_tx(150, 100, 100, 100, 150, fa_drip)
  let tx2 = Transaction { ..tx, mint: fa_mint(fa_did_name, 1) }
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx2)
}

/// C-USE-2: `Use` đốt ACCT NFT (thoát khỏi script mà không qua ReclaimIdle).
test use_burn_acct() fail {
  let tx = use_tx(150, 100, 100, 100, 150, fa_drip)
  let tx2 = Transaction { ..tx, mint: fa_mint(fa_did_name, -1) }
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx2)
}

/// C-USE-NOPOOL-1: tx có POOL NFT input (đường mà A2 đi qua).
test use_co_pool_input() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 150),
    )
  let pool_in =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(
        util.script_address(fa_pool_sh),
        fa_pool_val(10_000_000, 5_000_000_000),
        fa_pool_datum(150, 0),
      ),
    )
  let tx =
    fa_tx_at(
      150,
      Transaction {
        ..placeholder,
        inputs: [acct_in, pool_in, fa_did_input(fa_did_name)],
        outputs: [acct_out],
      },
    )
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// Use: acct_out CÙNG script hash, KHÁC stake credential.
test use_acct_out_stake_hijack() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      util.script_address_staked(fa_acct_sh, fa_thief_pkh),
      fa_acct_val(fa_did_name, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 150),
    )
  let tx =
    fa_tx_at(
      150,
      Transaction {
        ..placeholder,
        inputs: [acct_in, fa_did_input(fa_did_name)],
        outputs: [acct_out],
      },
    )
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

/// Use: acct_out đúng chỗ, đúng value, nhưng đính reference script.
test use_acct_out_script_carrier() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output_with_ref_script(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 150),
      #"beef",
    )
  let tx =
    fa_tx_at(
      150,
      Transaction {
        ..placeholder,
        inputs: [acct_in, fa_did_input(fa_did_name)],
        outputs: [acct_out],
      },
    )
  use_run(fa_acct_datum(fa_did_name, 100, 100), tx)
}

// ── TOPUP tests ──────────────────────────────────────────────────

/// Builder chung của mọi ca `TopUp`. `did_inputs` là chỗ DUY NHẤT khác nhau giữa
/// `topup_happy` và `topup_khong_did_nft` — hai cực dựng bằng cùng một hàm.
fn topup_tx_did(
  now: Int,
  pool_drip: Int,
  out_tlamp: Int,
  out_claim: Int,
  did_inputs: List<Input>,
) -> Transaction {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, out_tlamp),
      fa_acct_datum(fa_did_name, out_claim, now),
    )
  let pool_cfg =
    FaucetConfig {
      drip_oildrop: pool_drip,
      cooldown_epochs: fa_cooldown,
      max_claims_per_window: fa_max_claims,
    }
  let pool_in =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(
        util.script_address(fa_pool_sh),
        fa_pool_val(10_000_000, 5_000_000_000),
        PoolDatum { cfg: pool_cfg, window_epoch: now, claims_in_window: 0 },
      ),
    )
  let pool_out =
    util.mk_output(
      util.script_address(fa_pool_sh),
      fa_pool_val(10_000_000, 5_000_000_000 - pool_drip),
      PoolDatum { cfg: pool_cfg, window_epoch: now, claims_in_window: 1 },
    )
  fa_tx_at(
    now,
    Transaction {
      ..placeholder,
      inputs: list.concat([acct_in, pool_in], did_inputs),
      outputs: [pool_out, acct_out],
    },
  )
}

fn topup_tx(now: Int, pool_drip: Int, out_tlamp: Int, out_claim: Int) -> Transaction {
  topup_tx_did(now, pool_drip, out_tlamp, out_claim, [fa_did_input(fa_did_name)])
}

fn topup_run(tx: Transaction) -> Bool {
  faucet_account.spend(
    fa_nft_policy,
    fa_did_policy,
    fa_lamp_policy,
    fa_lamp_name,
    fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100, 100)),
    TopUp,
    util.mk_ref(0),
    tx,
  )
}

test topup_happy() {
  topup_run(topup_tx(150, fa_drip, fa_drip * 2, 150))
}

/// C-TOP-5: account rút bớt tLAMP trong khi mang danh "nhận thêm drip".
test topup_rut_bot_tlamp() fail {
  topup_run(topup_tx(150, fa_drip, 0, 150))
}

/// C-TOP-5: account nhận nhiều hơn drip mà pool khai.
test topup_nhan_hon_drip() fail {
  topup_run(topup_tx(150, fa_drip, fa_drip * 2 + 1, 150))
}

/// C-TOP-6: mốc cooldown không được đẩy lên now ⇒ claim này "không tính".
test topup_khong_cap_nhat_cooldown() fail {
  topup_run(topup_tx(150, fa_drip, fa_drip * 2, 100))
}

/// C-TOP-DID-1: cùng builder với `topup_happy`, CHỈ bỏ DID NFT khỏi input.
test topup_khong_did_nft() fail {
  topup_run(topup_tx_did(150, fa_drip, fa_drip * 2, 150, []))
}

/// C-TOP-POOL-1: không có POOL input ⇒ không có nguồn nào khai drip.
test topup_khong_co_pool_input() fail {
  let acct_addr = util.script_address(fa_acct_sh)
  let acct_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        acct_addr,
        fa_acct_val(fa_did_name, 2_000_000, fa_drip),
        fa_acct_datum(fa_did_name, 100, 100),
      ),
    )
  let acct_out =
    util.mk_output(
      acct_addr,
      fa_acct_val(fa_did_name, 2_000_000, fa_drip * 2),
      fa_acct_datum(fa_did_name, 150, 150),
    )
  let tx =
    fa_tx_at(
      150,
      Transaction {
        ..placeholder,
        inputs: [acct_in, fa_did_input(fa_did_name)],
        outputs: [acct_out],
      },
    )
  topup_run(tx)
}

// ── RECLAIM IDLE tests ───────────────────────────────────────────
// Mô hình: pool_in 5_000_000_000 tLAMP. Reclaim trả account về pool →
// pool_out = 5_000_000_000 + Δ. Δ ≥ acct_lamp (= fa_drip) là hợp lệ.

const fa_pool_base: Int = 5_000_000_000

fn fa_pool_input() -> Input {
  util.mk_input(
    util.mk_ref(1),
    util.mk_output(
      util.script_address(fa_pool_sh),
      fa_pool_val(10_000_000, fa_pool_base),
      fa_pool_datum(50, 7),
    ),
  )
}

fn fa_acct_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(
      util.script_address(fa_acct_sh),
      fa_acct_val(fa_did_name, 2_000_000, fa_drip),
      fa_acct_datum(fa_did_name, 100, 100),
    ),
  )
}

/// pool output với tLAMP = base + delta.
fn fa_pool_out(delta: Int) -> Output {
  util.mk_output(
    util.script_address(fa_pool_sh),
    fa_pool_val(10_000_000, fa_pool_base + delta),
    fa_pool_datum(50, 7),
  )
}

fn reclaim_idle_run(now: Int, outputs: List<Output>, mint: assets.Value) -> Bool {
  let tx =
    fa_tx_at(
      now,
      Transaction {
        ..placeholder,
        inputs: [fa_acct_input(), fa_pool_input()],
        outputs: outputs,
        mint: mint,
      },
    )
  faucet_account.spend(
    fa_nft_policy,
    fa_did_policy,
    fa_lamp_policy,
    fa_lamp_name,
    fa_ms_per_epoch,
    Some(fa_acct_datum(fa_did_name, 100, 100)),
    ReclaimIdle,
    util.mk_ref(0),
    tx,
  )
}

test reclaim_idle_happy() {
  // now=1101 ≥ 100+1001; pool nhận đủ Δ=fa_drip; ACCT NFT bị đốt.
  reclaim_idle_run(1101, [fa_pool_out(fa_drip)], fa_mint(fa_did_name, -1))
}

test reclaim_idle_too_early() fail {
  reclaim_idle_run(1100, [fa_pool_out(fa_drip)], fa_mint(fa_did_name, -1))
}

test reclaim_idle_token_not_to_pool() fail {
  // pool nhận Δ = fa_drip − 1 < acct_lamp (keeper cuỗm 1 token) → reject.
  reclaim_idle_run(1101, [fa_pool_out(fa_drip - 1)], fa_mint(fa_did_name, -1))
}

test reclaim_idle_no_pool_output() fail {
  let bad_out =
    util.mk_output_no_datum(
      util.vk_address(#"ee"),
      assets.from_lovelace(2_000_000)
        |> assets.add(fa_lamp_policy, fa_lamp_name, fa_drip),
    )
  reclaim_idle_run(1101, [bad_out], fa_mint(fa_did_name, -1))
}

/// C-BURN-1: thu hồi mà KHÔNG đốt ACCT NFT ⇒ nó thành vé tái dùng vĩnh viễn.
test reclaim_idle_khong_burn_acct() fail {
  reclaim_idle_run(1101, [fa_pool_out(fa_drip)], assets.zero)
}

/// C-BURN-1: đốt ACCT NFT của DID KHÁC (giữ lại vé của chính mình).
test reclaim_idle_burn_name_khac() fail {
  reclaim_idle_run(1101, [fa_pool_out(fa_drip)], fa_mint(fa_other_did, -1))
}

/// ReclaimIdle: keeper trả đủ tLAMP nhưng đưa pool sang VÍ mình.
test reclaim_idle_pool_to_wallet() fail {
  let pool_out =
    util.mk_output(
      util.vk_address(fa_thief_pkh),
      fa_pool_val(10_000_000, fa_pool_base + fa_drip),
      fa_pool_datum(50, 7),
    )
  reclaim_idle_run(1101, [pool_out], fa_mint(fa_did_name, -1))
}

/// ReclaimIdle: pool_out cùng script hash, khác stake credential.
test reclaim_idle_pool_stake_hijack() fail {
  let pool_out =
    util.mk_output(
      util.script_address_staked(fa_pool_sh, fa_thief_pkh),
      fa_pool_val(10_000_000, fa_pool_base + fa_drip),
      fa_pool_datum(50, 7),
    )
  reclaim_idle_run(1101, [pool_out], fa_mint(fa_did_name, -1))
}
