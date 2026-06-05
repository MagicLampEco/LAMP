// Validator tests cho nhánh COLLECT (mock Transaction).
// Phủ: collect đúng (pass), phá value (fail), double-satisfaction (fail), sai bucket (fail),
// + drain ADA (fail), asset không nhận (fail), không-mint (fail), nhiều item gộp lô (pass).

use aiken/collection/list
use cardano/assets
use cardano/transaction.{Input, Transaction, placeholder}
use custody
use magiclamp/treasury/types.{
  AssetKey, Collect, CollectItem, CustodyDatum, LedgerEntry,
}
use magiclamp/treasury/util

// ── Hằng số test ──
const cust_sh: ByteArray = #"c0c0c0c0"

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

// bucket đích cho cut
const bucket_ops: Int = 1

const bucket_community: Int = 2

// cut_bps = 1000 (10%)
const cut_bps_10: Int = 1000

fn accepted() -> List<AssetKey> {
  [
    AssetKey { policy: #"", name: #"" },
    // ADA
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn datum(ledger: List<LedgerEntry>) -> CustodyDatum {
  CustodyDatum {
    instance_id: #"abcd",
    accepted_assets: accepted(),
    ledger: ledger,
    cut_bps: cut_bps_10,
    governance_ref: #"9999",
    epoch: 10,
  }
}

fn lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

fn item(amount: Int, category: Int) -> CollectItem {
  CollectItem {
    app_id: #"0001",
    policy: lamp_policy,
    name: lamp_name,
    amount: amount,
    category: category,
  }
}

// Dựng tx collect: custody in/out value + sổ in/out + items + extra custody input.
fn collect_tx(
  in_val      : assets.Value,
  out_val     : assets.Value,
  ledger_in   : List<LedgerEntry>,
  ledger_out  : List<LedgerEntry>,
  out_epoch   : Int,
  extra_inputs: List<Input>,
) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, in_val, datum(ledger_in)))
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: out_epoch }
  let cust_out = util.mk_output(cust_addr, out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: list.concat([cust_in], extra_inputs),
    outputs: [cust_out],
    mint: assets.zero,
  }
}

// LƯU Ý: validator đọc datum thật từ input qua own_ref (cust_in mang datum(ledger_in)).
// `datum_opt` mock = chính datum của cust_in (Aiken cấp datum của UTxO đang spend).
fn run_with(
  tx        : Transaction,
  d_in      : CustodyDatum,
  items     : List<CollectItem>,
) -> Bool {
  custody.custody.spend(Some(d_in), Collect { items }, util.mk_ref(0), tx)
}

// ════════════════════════════════════════════════════════════
// 1. COLLECT ĐÚNG (pass)
//    amount=1000 LAMP, cut_bps=10% → cut=100 vào bucket_ops.
//    custody LAMP 5000→5100, ADA giữ nguyên. Sổ ops LAMP 0→100.
// ════════════════════════════════════════════════════════════
test collect_happy() {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// Gộp lô 2 item cùng asset cùng bucket: amount 1000 + 2000 → cut 100 + 200 = 300.
test collect_batch_same_bucket() {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 50 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 350 }]
  let items = [item(1000, bucket_ops), item(2000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5300), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// Gộp lô 2 item KHÁC bucket: 1000→ops(cut100), 5000→community(cut500). custody +600.
test collect_batch_multi_bucket() {
  let ledger_in =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 0 },
    ]
  let ledger_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 500 },
    ]
  let items = [item(1000, bucket_ops), item(5000, bucket_community)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5600), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 2. PHÁ VALUE (fail) — sổ ghi cut=100 nhưng custody value chỉ +50 (rút bớt LAMP).
// ════════════════════════════════════════════════════════════
test collect_value_tamper() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  // custody chỉ +50 LAMP thay vì +100 → value_ok fail.
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5050), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 2b. DRAIN ADA (fail) — LAMP +100 đúng cut, NHƯNG rút ADA 5M→2M.
// ════════════════════════════════════════════════════════════
test collect_ada_drain() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(2_000_000, 5100), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 3. DOUBLE-SATISFACTION (fail) — 2 custody input cùng script hash, KHÁC stake cred.
//    count_inputs_at_script == 2 → reject (1 collect không được rút 2 custody UTxO).
// ════════════════════════════════════════════════════════════
test collect_double_satisfaction() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let cust_addr2 = util.script_address_staked(cust_sh, #"5742")
  let extra =
    util.mk_input(util.mk_ref(9), util.mk_output(cust_addr2, lamp_val(5_000_000, 9999), datum(ledger_in)))
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [extra])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 4. SAI BUCKET (fail) — item.category=ops nhưng sổ cộng cut vào community.
//    Dòng ops không tăng (kỳ vọng +100) → each_out_line_ok fail.
// ════════════════════════════════════════════════════════════
test collect_wrong_bucket() fail {
  let ledger_in =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 0 },
    ]
  // cut vào community (sai) thay vì ops (đúng theo item.category).
  let ledger_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 100 },
    ]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 5. ASSET KHÔNG ĐƯỢC NHẬN (fail) — item dùng policy lạ.
// ════════════════════════════════════════════════════════════
test collect_asset_not_accepted() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: #"dead", name: #"beef", amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: #"dead", name: #"beef", amount: 100 }]
  let bad_item = CollectItem { app_id: #"0001", policy: #"dead", name: #"beef", amount: 1000, category: bucket_ops }
  let in_val = assets.add(assets.from_lovelace(5_000_000), #"dead", #"beef", 5000)
  let out_val = assets.add(assets.from_lovelace(5_000_000), #"dead", #"beef", 5100)
  let tx = collect_tx(in_val, out_val, ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), [bad_item])
}

// ════════════════════════════════════════════════════════════
// 6. MINT/BURN (fail) — tx có mint khác zero → C-MINT-0 fail (KHÔNG burn LAMP).
// ════════════════════════════════════════════════════════════
test collect_mint_rejected() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  let d_out = CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 5100), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      outputs: [cust_out],
      mint: assets.from_asset(lamp_policy, lamp_name, -100),
    }
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 7. ĐỔI PARAM DATUM (fail) — cut_bps bị đổi ở output → C-COL-2 fail.
// ════════════════════════════════════════════════════════════
test collect_param_tamper() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  // output datum đổi cut_bps 1000→2000.
  let d_out = CustodyDatum { ..datum(ledger_out), ledger: ledger_out, cut_bps: 2000, epoch: 11 }
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 5100), d_out)
  let tx = Transaction { ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero }
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 8. XÓA DÒNG SỔ (fail) — drain sổ bằng cách bỏ dòng community ở output.
// ════════════════════════════════════════════════════════════
test collect_ledger_line_dropped() fail {
  let ledger_in =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 777 },
    ]
  // bỏ dòng community (mất 777) — each_in_line_present fail.
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 9. EPOCH LÙI (fail) — out_epoch < datum.epoch.
// ════════════════════════════════════════════════════════════
test collect_epoch_regress() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 9, [])
  run_with(tx, datum(ledger_in), items)
}
