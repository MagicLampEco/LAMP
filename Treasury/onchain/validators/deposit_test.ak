// Validator tests cho nhánh DEPOSIT (P7, CONTRACT §15.2) — nạp 100% vào kho, PERMISSIONLESS.
//
// Mỗi ca âm đổi ĐÚNG MỘT điều trên nền ca dương `deposit_happy`, để bài đỏ ở đúng chốt nó
// mang tên chứ không ở một chốt đứng trước. Bảng đột biến (gỡ từng chốt, chạy trọn
// `aiken check`) ghi ở CONTRACT §15.2 — một bài đỏ đúng dòng KHÔNG tự chứng minh nó ghim dòng đó.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{Input, Output, Transaction, placeholder}
use custody
use magiclamp/treasury/collect
use magiclamp/treasury/ledger
use magiclamp/treasury/migrate
use magiclamp/treasury/stake_reward
use magiclamp/treasury/types.{
  AssetKey, CollectItem, CustodyDatum, Deposit, LedgerEntry,
}
use magiclamp/treasury/util

const cust_sh: ByteArray = #"c0c0c0c0"

const seed_policy: assets.PolicyId = #"5eed"

const instance_id: ByteArray = #"abcd"

const ms_per_epoch: Int = 432_000_000

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

const bucket_ops: Int = 1

const bucket_community: Int = 2

// Epoch của tx (lower bound) — datum vào ở epoch 10.
const cur_epoch: Int = 11

fn accepted() -> List<AssetKey> {
  [
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn datum(ledger_lines: List<LedgerEntry>) -> CustodyDatum {
  CustodyDatum {
    instance_id,
    accepted_assets: accepted(),
    ledger: ledger_lines,
    // cut_bps 10% — cố ý KHÁC 100% để ca "ghi sổ theo cut" phân biệt được với Deposit.
    cut_bps: 1000,
    governance_ref: #"9999",
    epoch: 10,
    consumed_proposals: [],
    buckets: [bucket_ops, bucket_community],
  }
}

fn lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

fn with_nft(v: assets.Value) -> assets.Value {
  assets.add(v, seed_policy, instance_id, 1)
}

fn lamp_item(amount: Int, category: Int) -> CollectItem {
  CollectItem {
    app_id: #"5c1c",
    policy: lamp_policy,
    name: lamp_name,
    amount,
    category,
  }
}

fn ada_item(amount: Int, category: Int) -> CollectItem {
  CollectItem { app_id: #"5c1c", policy: #"", name: #"", amount, category }
}

fn lamp_line(bucket: Int, amount: Int) -> LedgerEntry {
  LedgerEntry { bucket_id: bucket, policy: lamp_policy, name: lamp_name, amount }
}

fn epoch_range(lower_ms: Int) -> interval.Interval {
  interval.between(lower_ms, lower_ms + ms_per_epoch - 1)
}

/// Tx tổng quát: một kho vào, một kho ra, datum ra = `d_out`.
fn deposit_tx_with(
  d_in   : CustodyDatum,
  in_val : assets.Value,
  out    : Output,
  extra  : List<Input>,
  mint   : assets.Value,
) -> Transaction {
  let cust_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(util.script_address(cust_sh), with_nft(in_val), d_in),
    )
  Transaction {
    ..placeholder,
    inputs: [cust_in, ..extra],
    outputs: [out],
    mint,
    validity_range: epoch_range(cur_epoch * ms_per_epoch),
  }
}

/// Ca chuẩn: sổ vào/ra + value vào/ra, datum ra = datum vào đổi ledger + epoch.
fn deposit_tx(
  ledger_in : List<LedgerEntry>,
  ledger_out: List<LedgerEntry>,
  in_val    : assets.Value,
  out_val   : assets.Value,
) -> Transaction {
  let d_out = CustodyDatum { ..datum(ledger_out), epoch: cur_epoch }
  deposit_tx_with(
    datum(ledger_in),
    in_val,
    util.mk_output(util.script_address(cust_sh), with_nft(out_val), d_out),
    [],
    assets.zero,
  )
}

fn run(tx: Transaction, d_in: CustodyDatum, items: List<CollectItem>) -> Bool {
  custody.custody.spend(
    #"feed",
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    0,
    Some(d_in),
    Deposit { items },
    util.mk_ref(0),
    tx,
  )
}

// ════════════════════════════════════════════════════════════
// CA DƯƠNG
// ════════════════════════════════════════════════════════════

// LAMP 1000 vào bucket_ops TRỌN VẸN (Collect cùng lượng chỉ ghi 100).
test deposit_happy() {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 1500)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 6000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// ADA thưởng staking của SRCL: 7 ADA vào bucket_community, sổ mở dòng ADA mới.
test deposit_ada_new_line() {
  let ada_line =
    LedgerEntry { bucket_id: bucket_community, policy: #"", name: #"", amount: 7_000_000 }
  // Thứ tự canonical: (1, lamp) < (2, ada).
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 500), ada_line],
      lamp_val(5_000_000, 5000),
      lamp_val(12_000_000, 5000),
    )
  run(
    tx,
    datum([lamp_line(bucket_ops, 500)]),
    [ada_item(7_000_000, bucket_community)],
  )
}

// Lô nhiều item: hai item cùng dòng cộng dồn + một item dòng khác.
test deposit_batch_multi() {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 800), lamp_line(bucket_community, 50)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 5350),
    )
  run(
    tx,
    datum([lamp_line(bucket_ops, 500)]),
    [
      lamp_item(100, bucket_ops),
      lamp_item(200, bucket_ops),
      lamp_item(50, bucket_community),
    ],
  )
}

// ════════════════════════════════════════════════════════════
// CA ÂM — mỗi ca đổi đúng một điều trên nền deposit_happy
// ════════════════════════════════════════════════════════════

// C-DEP-3: sổ ghi theo cut (100) như Collect trong khi value vào đủ 1000.
test deposit_reject_ledger_cut_only() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 600)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 6000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-4: sổ +1000 nhưng value chỉ +900 (khai khống sổ).
test deposit_reject_value_short() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 1500)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 5900),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-4: đủ LAMP nhưng rút lén 1 ADA khỏi kho.
test deposit_reject_ada_drain() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 1500)],
      lamp_val(5_000_000, 5000),
      lamp_val(4_000_000, 6000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-5: một item amount = 0 trong lô (Collect cho qua, Deposit thì không). Sổ và value
// khớp chính xác phần còn lại, nên chỉ vế `amount > 0` chặn được.
test deposit_reject_zero_amount_item() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 1500)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 6000),
    )
  run(
    tx,
    datum([lamp_line(bucket_ops, 500)]),
    [lamp_item(1000, bucket_ops), lamp_item(0, bucket_community)],
  )
}

// C-DEP-5: amount âm để rút ngầm (sổ và value đều giảm khớp).
test deposit_reject_negative_amount() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 400)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 4900),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(-100, bucket_ops)])
}

// C-DEP-11: items rỗng — respend no-op (sổ và value giữ nguyên).
test deposit_reject_empty_items() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 500)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 5000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [])
}

// C-DEP-CAT: category chưa khai trong `buckets`.
test deposit_reject_undeclared_category() fail {
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 500), lamp_line(7, 1000)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 6000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, 7)])
}

// C-DEP-CAT: bucket dành riêng nguồn Reserve.
test deposit_reject_reserve_inflow_bucket() fail {
  let r = migrate.reserve_inflow_bucket_id
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 500), lamp_line(r, 1000)],
      lamp_val(5_000_000, 5000),
      lamp_val(5_000_000, 6000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, r)])
}

// C-DEP-CAT: bucket dành riêng thưởng uỷ quyền của CHÍNH kho.
test deposit_reject_stake_reward_bucket() fail {
  let s = stake_reward.stake_reward_bucket_id
  let ada_line = LedgerEntry { bucket_id: s, policy: #"", name: #"", amount: 7_000_000 }
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 500), ada_line],
      lamp_val(5_000_000, 5000),
      lamp_val(12_000_000, 5000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [ada_item(7_000_000, s)])
}

// Hai vế id dành riêng trong `deposit_items_valid` là phòng thủ theo chiều sâu: với datum gieo
// hợp lệ, `is_declared` đã loại chúng. Ghim bằng bài ĐƠN VỊ truyền `buckets` CHỨA id dành riêng.
test deposit_items_valid_rejects_reserved_even_if_declared() {
  let r = migrate.reserve_inflow_bucket_id
  let s = stake_reward.stake_reward_bucket_id
  let declared = [bucket_ops, r, s]
  and {
    collect.deposit_items_valid([lamp_item(1, bucket_ops)], accepted(), declared),
    !collect.deposit_items_valid([lamp_item(1, r)], accepted(), declared),
    !collect.deposit_items_valid([ada_item(1, s)], accepted(), declared),
  }
}

// C-DEP-5: asset không nằm trong accepted_assets.
test deposit_reject_asset_not_accepted() fail {
  let foreign =
    CollectItem {
      app_id: #"5c1c",
      policy: #"f0f0",
      name: #"00",
      amount: 1000,
      category: bucket_ops,
    }
  let line = LedgerEntry { bucket_id: bucket_ops, policy: #"f0f0", name: #"00", amount: 1000 }
  let tx =
    deposit_tx(
      [lamp_line(bucket_ops, 500)],
      [lamp_line(bucket_ops, 500), line],
      lamp_val(5_000_000, 5000),
      assets.add(lamp_val(5_000_000, 5000), #"f0f0", #"00", 1000),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [foreign])
}

// C-DEP-MINT: tx có mint.
test deposit_reject_mint() fail {
  let d_out = CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch }
  let tx =
    deposit_tx_with(
      datum([lamp_line(bucket_ops, 500)]),
      lamp_val(5_000_000, 5000),
      util.mk_output(
        util.script_address(cust_sh),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      [],
      assets.from_asset(#"abab", #"01", 1),
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-1: hai input kho (khác stake credential) — double-satisfaction.
test deposit_reject_two_custody_inputs() fail {
  let d_out = CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch }
  let extra =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output(
        util.script_address_staked(cust_sh, #"5742"),
        lamp_val(5_000_000, 100),
        datum([lamp_line(bucket_ops, 500)]),
      ),
    )
  let tx =
    deposit_tx_with(
      datum([lamp_line(bucket_ops, 500)]),
      lamp_val(5_000_000, 5000),
      util.mk_output(
        util.script_address(cust_sh),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      [extra],
      assets.zero,
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

/// Một ca âm đổi datum ra (ngoài ledger/epoch) trên nền happy.
fn tamper(f: fn(CustodyDatum) -> CustodyDatum) -> Bool {
  let d_out = f(CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch })
  let tx =
    deposit_tx_with(
      datum([lamp_line(bucket_ops, 500)]),
      lamp_val(5_000_000, 5000),
      util.mk_output(
        util.script_address(cust_sh),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      [],
      assets.zero,
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-2: đổi cut_bps.
test deposit_reject_cut_bps_tamper() fail {
  tamper(fn(d) { CustodyDatum { ..d, cut_bps: 0 } })
}

// C-DEP-2: đổi governance_ref.
test deposit_reject_governance_tamper() fail {
  tamper(fn(d) { CustodyDatum { ..d, governance_ref: #"6666" } })
}

// C-DEP-2: đổi accepted_assets.
test deposit_reject_accepted_tamper() fail {
  tamper(
    fn(d) {
      CustodyDatum {
        ..d,
        accepted_assets: [AssetKey { policy: #"", name: #"" }, ..accepted()],
      }
    },
  )
}

// C-DEP-2: đổi instance_id.
test deposit_reject_instance_tamper() fail {
  tamper(fn(d) { CustodyDatum { ..d, instance_id: #"dcba" } })
}

// C-BUCKETS-KEEP ở nhánh Deposit: nới danh sách bucket.
test deposit_reject_buckets_widened() fail {
  tamper(fn(d) { CustodyDatum { ..d, buckets: [bucket_ops, bucket_community, 7] } })
}

// C-DEP-2: xoá marker proposal đã chi.
test deposit_reject_consumed_tamper() fail {
  let d_in =
    CustodyDatum { ..datum([lamp_line(bucket_ops, 500)]), consumed_proposals: [#"0001"] }
  let d_out = CustodyDatum { ..d_in, ledger: [lamp_line(bucket_ops, 1500)], epoch: cur_epoch, consumed_proposals: [] }
  let tx =
    deposit_tx_with(
      d_in,
      lamp_val(5_000_000, 5000),
      util.mk_output(
        util.script_address(cust_sh),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      [],
      assets.zero,
    )
  run(tx, d_in, [lamp_item(1000, bucket_ops)])
}

// C-EPOCH: out.epoch không neo đúng epoch của tx.
test deposit_reject_epoch_not_anchored() fail {
  tamper(fn(d) { CustodyDatum { ..d, epoch: cur_epoch + 1 } })
}

// C-EPOCH: tx ở epoch trước datum vào (lùi).
test deposit_reject_epoch_regress() fail {
  let d_in = CustodyDatum { ..datum([lamp_line(bucket_ops, 500)]), epoch: cur_epoch + 1 }
  let d_out = CustodyDatum { ..d_in, ledger: [lamp_line(bucket_ops, 1500)], epoch: cur_epoch }
  let tx =
    deposit_tx_with(
      d_in,
      lamp_val(5_000_000, 5000),
      util.mk_output(
        util.script_address(cust_sh),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      [],
      assets.zero,
    )
  run(tx, d_in, [lamp_item(1000, bucket_ops)])
}

// C-NFT: kho vào không mang NFT chứng thực (kho giả dựng tại địa chỉ script).
test deposit_reject_missing_seed_nft() fail {
  let d_out = CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch }
  let cust_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        util.script_address(cust_sh),
        lamp_val(5_000_000, 5000),
        datum([lamp_line(bucket_ops, 500)]),
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      outputs: [
        util.mk_output(util.script_address(cust_sh), lamp_val(5_000_000, 6000), d_out),
      ],
      mint: assets.zero,
      validity_range: epoch_range(cur_epoch * ms_per_epoch),
    }
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-NFT (vế ra): NFT bị bóc khỏi kho ra (value ra thiếu NFT, dồn đủ mọi thứ khác).
test deposit_reject_nft_stripped_on_output() fail {
  let d_out = CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch }
  let tx =
    deposit_tx_with(
      datum([lamp_line(bucket_ops, 500)]),
      lamp_val(5_000_000, 5000),
      util.mk_output(util.script_address(cust_sh), lamp_val(5_000_000, 6000), d_out),
      [],
      assets.zero,
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-ADDR: người nạp đổi stake credential của kho.
test deposit_reject_stake_credential_hijack() fail {
  let d_out = CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch }
  let tx =
    deposit_tx_with(
      datum([lamp_line(bucket_ops, 500)]),
      lamp_val(5_000_000, 5000),
      util.mk_output(
        util.script_address_staked(cust_sh, #"deadbeef"),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      [],
      assets.zero,
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// C-DEP-REFSCRIPT: đính script tham chiếu vào kho.
test deposit_reject_reference_script() fail {
  let d_out = CustodyDatum { ..datum([lamp_line(bucket_ops, 1500)]), epoch: cur_epoch }
  let out =
    Output {
      ..util.mk_output(
        util.script_address(cust_sh),
        with_nft(lamp_val(5_000_000, 6000)),
        d_out,
      ),
      reference_script: Some(#"5c81"),
    }
  let tx =
    deposit_tx_with(
      datum([lamp_line(bucket_ops, 500)]),
      lamp_val(5_000_000, 5000),
      out,
      [],
      assets.zero,
    )
  run(tx, datum([lamp_line(bucket_ops, 500)]), [lamp_item(1000, bucket_ops)])
}

// ════════════════════════════════════════════════════════════
// C-DEP-LINES — trần số dòng sổ (#96) áp cho Deposit
//   Kho khai buckets 1..21, sổ vào ĐÚNG trần (20 dòng ADA ở bucket 1..20).
//   Nạp vào dòng ĐÃ CÓ (bucket 20) → pass; nạp mở dòng thứ 21 (bucket 21) → fail.
// ════════════════════════════════════════════════════════════
fn cap_datum(ledger_lines: List<LedgerEntry>) -> CustodyDatum {
  CustodyDatum {
    ..datum(ledger_lines),
    buckets: list.range(1, ledger.max_ledger_lines + 1),
  }
}

fn ada_lines(n: Int, bump_last: Int) -> List<LedgerEntry> {
  list.map(
    list.range(1, n),
    fn(b) {
      LedgerEntry {
        bucket_id: b,
        policy: #"",
        name: #"",
        amount: if b == n {
          1_000 + bump_last
        } else {
          1_000
        },
      }
    },
  )
}

fn cap_run(ledger_out: List<LedgerEntry>, items: List<CollectItem>, add: Int) -> Bool {
  let n = ledger.max_ledger_lines
  let d_in = cap_datum(ada_lines(n, 0))
  let d_out = CustodyDatum { ..cap_datum(ledger_out), epoch: cur_epoch }
  let tx =
    deposit_tx_with(
      d_in,
      assets.from_lovelace(2_000_000 + n * 1_000),
      util.mk_output(
        util.script_address(cust_sh),
        with_nft(assets.from_lovelace(2_000_000 + n * 1_000 + add)),
        d_out,
      ),
      [],
      assets.zero,
    )
  run(tx, d_in, items)
}

test deposit_cap_existing_line_ok() {
  let n = ledger.max_ledger_lines
  cap_run(ada_lines(n, 500), [ada_item(500, n)], 500)
}

test deposit_cap_new_line_rejected() fail {
  let n = ledger.max_ledger_lines
  let extra = LedgerEntry { bucket_id: n + 1, policy: #"", name: #"", amount: 500 }
  cap_run(list.concat(ada_lines(n, 0), [extra]), [ada_item(500, n + 1)], 500)
}
