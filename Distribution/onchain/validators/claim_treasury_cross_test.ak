// Bài kiểm CHÉO `claim_account` × `treasury` trên CÙNG một tx — Issue #79.
//
// Mỗi bài dựng MỘT `Transaction` (từ `cross_fixtures`) rồi chạy validator cho TỪNG input
// ở địa chỉ script, với redeemer của chính input đó và datum đọc từ chính input đó — đúng
// cách sổ cái chạy script, không phải mô phỏng validator hàng xóm bằng UTxO đặt sẵn.
//
// Một bài `fail` chỉ nói "tx bị từ chối", không nói ai từ chối. Nên mỗi ca bị từ chối có
// BA bài: chạy trọn (`run_all`), chỉ phía tài khoản, chỉ phía kho — kèm một bài đối chứng
// PASS cho thấy phần fixture của phía kia tự nó hợp lệ. Thiếu đối chứng thì bài "phía X
// từ chối" có thể đỏ vì fixture hỏng chứ không vì mệnh đề đang muốn canh.
//
// Tệp này KHÔNG được export `pub` (module test đã `use` validator — xem `cross_fixtures`).

use aiken/collection/list
use cardano/transaction.{DatumHash, InlineDatum, NoDatum, Transaction}
use claim_account
use magiclamp/lampdist/cross_fixtures as fx
use magiclamp/lampdist/types.{
  Claim, ClaimAccountDatum, ClaimAccountRedeemer, GrantEntitlement, Refill,
  TreasuryDatum, TreasuryRedeemer,
}
use magiclamp/lampdist/util
use treasury

// ── Khung chạy ─────────────────────────────────────────────────────────────────

/// Một lần chạy script mà sổ cái sẽ thực hiện: chỉ số input + redeemer của nó.
type ScriptRun {
  AccountRun(Int, ClaimAccountRedeemer)
  TreasuryRun(Int, TreasuryRedeemer)
}

/// Datum inline của input mang `ix`, đúng như sổ cái truyền cho `spend`.
fn input_datum(tx: Transaction, ix: Int) -> Option<Data> {
  expect Some(i) =
    list.find(tx.inputs, fn(x) { x.output_reference == fx.ref(ix) })
  when i.output.datum is {
    NoDatum -> None
    InlineDatum(d) -> Some(d)
    DatumHash(_) -> fail @"fixture không dùng datum-hash"
  }
}

fn run_one(tx: Transaction, run: ScriptRun) -> Bool {
  when run is {
    AccountRun(ix, r) -> {
      let datum_opt =
        when input_datum(tx, ix) is {
          None -> None
          Some(d) -> {
            expect cad: ClaimAccountDatum = d
            Some(cad)
          }
        }
      claim_account.claim_account.spend(
        fx.committee,
        fx.threshold,
        fx.ms_per_epoch,
        fx.lamp_policy,
        fx.lamp_name,
        fx.beacon_policy,
        fx.treasury_nft_policy,
        fx.account_nft_policy,
        datum_opt,
        r,
        fx.ref(ix),
        tx,
      )
    }
    TreasuryRun(ix, r) -> {
      let datum_opt =
        when input_datum(tx, ix) is {
          None -> None
          Some(d) -> {
            expect td: TreasuryDatum = d
            Some(td)
          }
        }
      treasury.treasury.spend(
        fx.claim_account_hash,
        fx.lamp_policy,
        fx.lamp_name,
        fx.committee,
        fx.threshold,
        fx.account_nft_policy,
        fx.ms_per_epoch,
        datum_opt,
        r,
        fx.ref(ix),
        tx,
      )
    }
  }
}

/// Chạy TRỌN: mọi input ở hai địa chỉ script phải có đúng một lần chạy trong `runs` —
/// quên khai một input thì bài đỏ ngay, không lặng lẽ bỏ qua một validator.
fn run_all(tx: Transaction, runs: List<ScriptRun>) -> Bool {
  let script_inputs =
    list.count(
      tx.inputs,
      fn(i) {
        util.is_at_script(i.output.address, fx.claim_account_hash) || util.is_at_script(
          i.output.address,
          fx.treasury_hash,
        )
      },
    )
  expect script_inputs == list.length(runs)
  list.all(runs, fn(run) { run_one(tx, run) })
}

fn run_account_side(tx: Transaction, runs: List<ScriptRun>) -> Bool {
  let mine =
    list.filter(
      runs,
      fn(run) {
        when run is {
          AccountRun(_, _) -> True
          TreasuryRun(_, _) -> False
        }
      },
    )
  expect list.length(mine) > 0
  list.all(mine, fn(run) { run_one(tx, run) })
}

fn run_treasury_side(tx: Transaction, runs: List<ScriptRun>) -> Bool {
  let mine =
    list.filter(
      runs,
      fn(run) {
        when run is {
          AccountRun(_, _) -> False
          TreasuryRun(_, _) -> True
        }
      },
    )
  expect list.length(mine) > 0
  list.all(mine, fn(run) { run_one(tx, run) })
}

// ── Số liệu dùng chung ─────────────────────────────────────────────────────────
// Tài khoản vào: E = 400, redeemed = 150, mốc 2 — CỐ Ý khác 0 và khác cửa sổ 5, để các
// mệnh đề rebase có đầu vào phân biệt được hai cực đột biến. Cấp thêm 1000.
// Sổ kho vào 250 (= 400 − 150, tức đúng phần nợ của tài khoản này).

const topup: Int = 1000

const outstanding_in: Int = 250

fn account_in() -> ClaimAccountDatum {
  fx.account_datum(400, 150, 2)
}

/// Rebase đúng: E' = 400 − 150 + 1000 = 1250, redeemed' = 0, mốc' = cửa sổ 5.
fn account_rebased() -> ClaimAccountDatum {
  fx.account_datum(1250, 0, fx.window)
}

/// Công thức TRƯỚC #75: E' = E + amount, giữ `redeemed`, giữ mốc. Sai cả ba mệnh đề
/// C-CLAIM-3/5/6 — đúng hình dạng mà cặp Claim+Refill nhắm tới (né C-ACC-3 của kho).
fn account_pre_75() -> ClaimAccountDatum {
  fx.account_datum(1400, 150, 2)
}

/// Không rebase nhưng GIỮ khớp sổ kho: E' = 1250 (granted = 1250 − 250 = 1000 = amount),
/// chỉ `redeemed'` và mốc sai. Để mọi lý do từ chối ở ca 3 đều là mệnh đề rebase, không
/// phải lệch sổ.
fn account_not_rebased() -> ClaimAccountDatum {
  fx.account_datum(1250, 150, 2)
}

fn grant_runs() -> List<ScriptRun> {
  [AccountRun(fx.account_ix, Claim { amount: topup }),
    TreasuryRun(fx.treasury_ix, GrantEntitlement)]
}

/// Refill chạy cho CẢ HAI input ở địa chỉ kho (carrier TRSY và UTxO tự đỗ).
fn refill_runs() -> List<ScriptRun> {
  [
    AccountRun(fx.account_ix, Claim { amount: topup }),
    TreasuryRun(fx.treasury_ix, Refill), TreasuryRun(fx.parked_ix, Refill),
  ]
}

// ── Ca 1: Claim + GrantEntitlement hợp lệ → qua CẢ HAI validator ─────────────

test cross_claim_grant_passes_both_validators() {
  let tx =
    fx.claim_grant_tx(
      account_in(),
      account_rebased(),
      outstanding_in,
      outstanding_in + topup,
    )
  run_all(tx, grant_runs())
}

// ── Ca 2: Claim + Refill → bị từ chối ─────────────────────────────────────────
// Hình dạng tấn công: kho thật + UTxO tự đỗ khai nợ khống 1000 ⇒ carrier TRSY tăng 1000
// ⇒ C-SOLV-1 phía tài khoản thoả, phép gộp phía kho thoả. Hai lớp chặn độc lập:
// `treasury` ▸ C-REF-ACC và `claim_account` ▸ C-CLAIM-3/5/6.

fn claim_refill_pre_75_tx() -> Transaction {
  fx.claim_refill_tx(account_in(), account_pre_75(), outstanding_in, topup)
}

test cross_claim_refill_rejected() fail {
  run_all(claim_refill_pre_75_tx(), refill_runs())
}

/// Lớp tài khoản: C-CLAIM-3/5/6 (datum ra không rebase).
test cross_claim_refill_rejected_by_claim_account() fail {
  run_account_side(claim_refill_pre_75_tx(), refill_runs())
}

/// Lớp kho: C-REF-ACC (tx có input + output ở địa chỉ tài khoản).
test cross_claim_refill_rejected_by_treasury() fail {
  run_treasury_side(claim_refill_pre_75_tx(), refill_runs())
}

/// Đối chứng cho bài trên: CÙNG phần kho, bỏ phần tài khoản ⇒ Refill QUA ở cả hai input.
/// Tức lý do duy nhất kho từ chối Claim+Refill là sự có mặt của tài khoản.
test cross_refill_part_alone_passes_treasury() {
  run_all(
    fx.refill_only_tx(outstanding_in, topup),
    [TreasuryRun(fx.treasury_ix, Refill), TreasuryRun(fx.parked_ix, Refill)],
  )
}

// Ca 2b — Claim + Refill với datum tài khoản ĐÃ rebase đúng. Phía tài khoản KHÔNG từ chối
// (nó không đọc redeemer của kho), nên với hình dạng này chỉ còn MỘT lớp: C-REF-ACC.

/// Ghi nhận hành vi, không phải yêu cầu: `claim_account` chấp nhận phần của nó trong
/// Claim+Refill khi datum đã rebase. Đồng thời là đối chứng rằng fixture tài khoản trong
/// `claim_refill_tx` tự nó hợp lệ — ca 2 đỏ phía tài khoản là vì mệnh đề rebase.
test cross_claim_refill_rebased_passes_claim_account() {
  run_account_side(
    fx.claim_refill_tx(account_in(), account_rebased(), outstanding_in, topup),
    refill_runs(),
  )
}

test cross_claim_refill_rebased_rejected() fail {
  run_all(
    fx.claim_refill_tx(account_in(), account_rebased(), outstanding_in, topup),
    refill_runs(),
  )
}

// ── Ca 3: Claim + GrantEntitlement, datum tài khoản không rebase → bị từ chối ─────

fn claim_grant_not_rebased_tx() -> Transaction {
  fx.claim_grant_tx(
    account_in(),
    account_not_rebased(),
    outstanding_in,
    outstanding_in + topup,
  )
}

test cross_claim_grant_not_rebased_rejected() fail {
  run_all(claim_grant_not_rebased_tx(), grant_runs())
}

/// Lớp tài khoản: C-CLAIM-5 (`redeemed' = 0`) · C-CLAIM-6 (mốc').
test cross_claim_grant_not_rebased_rejected_by_claim_account() fail {
  run_account_side(claim_grant_not_rebased_tx(), grant_runs())
}

/// Lớp kho: C-ACC-3 (cùng hai đẳng thức, từ phía kho).
test cross_claim_grant_not_rebased_rejected_by_treasury() fail {
  run_treasury_side(claim_grant_not_rebased_tx(), grant_runs())
}
