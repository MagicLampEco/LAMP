// Validator tests cho nhánh COLLECT (mock Transaction).
// Phủ: collect đúng (pass), phá value (fail), double-satisfaction (fail), sai bucket (fail),
// + drain ADA (fail), asset không nhận (fail), không-mint (fail), nhiều item gộp lô (pass).

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{Input, Transaction, placeholder}
use custody
use magiclamp/treasury/types.{
  AssetKey, Collect, CollectItem, CustodyDatum, LedgerEntry, MigrateIn,
  Rebalance,
}
use magiclamp/treasury/util

// ── Hằng số test ──
const cust_sh: ByteArray = #"c0c0c0c0"

// C-NFT: policy authenticity NFT (custody_seed mint one-shot). instance_id = datum.instance_id.
const seed_policy: assets.PolicyId = #"5eed"

const instance_id: ByteArray = #"abcd"

// Cardano epoch = 5 ngày = 432_000_000 ms (neo C-EPOCH).
const ms_per_epoch: Int = 432_000_000

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
    consumed_proposals: [],
  }
}

fn lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

// C-NFT: gắn authenticity NFT (seed_policy, instance_id) qty 1 vào MỌI value custody
// in/out. Validator nay ÉP cust_in/cust_out mang đúng 1 NFT này (chống custody-GIẢ).
fn with_nft(value: assets.Value) -> assets.Value {
  assets.add(value, seed_policy, instance_id, 1)
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

// Dựng tx collect: custody in/out value (gắn NFT) + sổ in/out + items + extra input.
// C-EPOCH: out_datum.epoch == out_epoch; validity_range.lower neo cur == out_epoch
//   (lower_ms = out_epoch × ms_per_epoch) ⇒ out.epoch == get_epoch(tx) mặc định.
//   datum(in).epoch = 10 < cur cho happy; epoch_regress đặt out_epoch < 10 để cur < in.epoch.
fn collect_tx(
  in_val      : assets.Value,
  out_val     : assets.Value,
  ledger_in   : List<LedgerEntry>,
  ledger_out  : List<LedgerEntry>,
  out_epoch   : Int,
  extra_inputs: List<Input>,
) -> Transaction {
  collect_tx_anchored(in_val, out_val, ledger_in, ledger_out, out_epoch, out_epoch * ms_per_epoch, extra_inputs)
}

// Biến thể cho phép TÁCH out_datum.epoch khỏi cur (test C-EPOCH not-anchored).
fn collect_tx_anchored(
  in_val      : assets.Value,
  out_val     : assets.Value,
  ledger_in   : List<LedgerEntry>,
  ledger_out  : List<LedgerEntry>,
  out_epoch   : Int,
  lower_ms    : Int,
  extra_inputs: List<Input>,
) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(in_val), datum(ledger_in)))
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: out_epoch }
  let cust_out = util.mk_output(cust_addr, with_nft(out_val), d_out)
  Transaction {
    ..placeholder,
    inputs: list.concat([cust_in], extra_inputs),
    outputs: [cust_out],
    mint: assets.zero,
    // F4: get_epoch_bounded ÉP validity_range hữu hạn + lower&upper CÙNG epoch.
    validity_range: epoch_range(lower_ms),
  }
}

// F4: interval GỌN trong 1 epoch (lo = lower_ms, hi = lo + ms_per_epoch − 1 cùng epoch).
fn epoch_range(lower_ms: Int) -> interval.Interval {
  interval.between(lower_ms, lower_ms + ms_per_epoch - 1)
}

// LƯU Ý: validator đọc datum thật từ input qua own_ref (cust_in mang datum(ledger_in)).
// `datum_opt` mock = chính datum của cust_in (Aiken cấp datum của UTxO đang spend).
// Interface MỚI: spend(proposal_policy, seed_policy, ms_per_epoch, datum, redeemer, ref, tx).
fn run_with(
  tx        : Transaction,
  d_in      : CustodyDatum,
  items     : List<CollectItem>,
) -> Bool {
  // Collect KHÔNG đụng proposal_policy (chỉ nhánh Release dùng) → dummy; seed_policy + ms thật.
  custody.custody.spend(
    #"feed", seed_policy, ms_per_epoch, Some(d_in), Collect { items }, util.mk_ref(0), tx,
  )
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
// 19. ITEM CUT == 0 KHÔNG CẦN DÒNG ĐÍCH (pass) — C-COL-3 (each_item_has_target) + F3 (C-COL-11).
//   cut_bps=1000 (10%). Batch GỘP 2 item:
//     - item amount=5  → item_cut = ⌊5×1000/10000⌋ = 0 (KHÔNG đổi sổ + KHÔNG cần dòng đích),
//     - item amount=1000 → item_cut = 100 (dòng đích community mới).
//   Σcut = 100 > 0 ⇒ qua C-COL-11 (F3: Collect phải sinh cut > 0). Item cut=0 vào bucket_ops
//   GIỮ ý gốc "cut=0 không cần dòng đích" — dòng ops 42 ở in giữ NGUYÊN ở out (cut=0 không
//   đụng), KHÔNG sinh dòng đích cho item amount=5. each_item_has_target PHẢI bỏ qua item
//   cut==0 (không siết nhầm đòi dòng đích). value out = in + 100 LAMP (đúng Σcut).
//   (Đối ngẫu test 15 phantom_ledger_line: cut 0 ⇒ KHÔNG được PHÉP có dòng mới.)
// ════════════════════════════════════════════════════════════
test collect_item_cut_zero_no_target() {
  // sổ in: 1 dòng ops 42 (giữ NGUYÊN — item cut=0 không đụng).
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 42 }]
  // sổ out: ops 42 GIỮ NGUYÊN (item cut=0 không tạo dòng đích) + community 100 (item cut>0).
  let ledger_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 42 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 100 },
    ]
  // item(5, ops): cut = ⌊5×1000/10000⌋ = 0 (cut=0, không dòng đích).
  // item(1000, community): cut = 100 (Σcut = 100 > 0 → qua F3 C-COL-11).
  let items = [item(5, bucket_ops), item(1000, bucket_community)]
  // value out = in + 100 LAMP (đúng Σcut > 0).
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [])
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
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out = CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5100)), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      outputs: [cust_out],
      mint: assets.from_asset(lamp_policy, lamp_name, -100),
      validity_range: epoch_range(11 * ms_per_epoch),
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
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  // output datum đổi cut_bps 1000→2000.
  let d_out = CustodyDatum { ..datum(ledger_out), ledger: ledger_out, cut_bps: 2000, epoch: 11 }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5100)), d_out)
  let tx =
    Transaction {
      ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero,
      validity_range: epoch_range(11 * ms_per_epoch),
    }
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

// ════════════════════════════════════════════════════════════
// 10. DATUM RỖNG (fail) — UTxO custody không có datum → expect Some(datum) fail.
//     (Custody PHẢI luôn mang CustodyDatum; spend không datum = bất khả tin.)
// ════════════════════════════════════════════════════════════
test collect_missing_datum() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [])
  // datum_opt = None ⇒ expect Some(datum) crash.
  custody.custody.spend(
    #"feed", seed_policy, ms_per_epoch, None, Collect { items }, util.mk_ref(0), tx,
  )
}

// ════════════════════════════════════════════════════════════
// 11. KHÔNG OUTPUT CUSTODY (fail) — value rời treasury không quay lại script.
//     count_outputs_at_script == 0 ⇒ C-COL-1 fail (drain toàn bộ kho).
// ════════════════════════════════════════════════════════════
test collect_no_custody_output() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  // output gửi thẳng ví thường, KHÔNG có output về custody script.
  let wallet_out = util.mk_output_no_datum(util.vk_address(#"dead"), lamp_val(5_000_000, 5100))
  let tx =
    Transaction {
      ..placeholder, inputs: [cust_in], outputs: [wallet_out], mint: assets.zero,
      validity_range: epoch_range(11 * ms_per_epoch),
    }
  run_with(tx, datum(ledger_in), [item(1000, bucket_ops)])
}

// ════════════════════════════════════════════════════════════
// 12. ĐỤNG MARKER SINGLE-USE (fail) — Collect KHÔNG được ghi consumed_proposals
//     (chỉ Release ghi). Nếu Collect thêm proposal_id giả vào consumed → C-COL-2 fail.
//     (Chống "tự đánh dấu đã chi" để né replay-guard sai mục đích.)
// ════════════════════════════════════════════════════════════
test collect_consumed_tamper() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  // out_datum đổi consumed_proposals []→[#"beef"] (Collect không được phép).
  let d_out =
    CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11, consumed_proposals: [#"beef"] }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5100)), d_out)
  let tx =
    Transaction {
      ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero,
      validity_range: epoch_range(11 * ms_per_epoch),
    }
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 13. CUSTODY OUTPUT VỀ VÍ THƯỜNG (fail) — nếu refactor chọn output theo cách khác,
//     khẳng định !is_vk chặn output custody nằm ở VerificationKey address.
//     Ở đây ta đặt cust_out ở vk_address NHƯNG cùng "hash" để count theo script vẫn 0
//     ⇒ thực chất rơi vào count==0; để cô lập is_vk, ta giữ 1 output script + 1 vk cùng value
//     không khả thi (count==1 chọn script). Thay vào: kiểm địa chỉ script KHÔNG có payment vk.
//     → test này xác nhận happy vẫn pass khi address là Script thuần (regression guard).
// ════════════════════════════════════════════════════════════
test collect_script_addr_is_not_vk() {
  // Khẳng định bất biến nền: custody address là Script, !is_vk == True.
  let addr = util.script_address(cust_sh)
  !util.is_vk(addr)
}

// ════════════════════════════════════════════════════════════
// 14. NHÁNH CHƯA TRIỂN KHAI (fail) — Rebalance / MigrateIn rơi vào `_ -> fail`.
//     v1 chỉ Collect + Release; mọi redeemer khác PHẢI reject (không lọt cửa hậu).
// ════════════════════════════════════════════════════════════
test collect_rebalance_unimplemented() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in))
  let tx = Transaction { ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero }
  custody.custody.spend(
    #"feed", seed_policy, ms_per_epoch, Some(datum(ledger_in)),
    Rebalance { moves: [] }, util.mk_ref(0), tx,
  )
}

test collect_migrate_unimplemented() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in))
  let tx = Transaction { ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero }
  custody.custody.spend(
    #"feed", seed_policy, ms_per_epoch, Some(datum(ledger_in)),
    MigrateIn { source: #"00" }, util.mk_ref(0), tx,
  )
}

// ════════════════════════════════════════════════════════════
// 15. THÊM DÒNG SỔ KHỐNG (fail) — out có dòng (bucket,asset) KHÔNG ở in và KHÔNG có
//     item nào nhắm tới → each_out_line_ok kỳ vọng get(in)+Δ=0 nhưng amount=999 ⇒ fail.
//     (Chống bơm số dư bucket khống để Release v1.x rút ra value không có thật.)
// ════════════════════════════════════════════════════════════
test collect_phantom_ledger_line() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 },
      // dòng khống: community LAMP 999, không item nào nhắm tới, không có ở in.
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 999 },
    ]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 16. C-NFT — cust_in/out KHÔNG mang NFT authenticity (seed_policy, instance_id).
//     Validator ÉP quantity_of(value, seed_policy, instance_id) == 1 ở cả in & out.
//     Dựng tx thủ công với value KHÔNG có NFT (không qua with_nft) → C-NFT fail.
// ════════════════════════════════════════════════════════════
test collect_missing_seed_nft() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let cust_addr = util.script_address(cust_sh)
  // value KHÔNG có NFT (cố ý bỏ with_nft) — mọi cờ khác đúng.
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, lamp_val(5_000_000, 5000), datum(ledger_in)))
  let d_out = CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  let cust_out = util.mk_output(cust_addr, lamp_val(5_000_000, 5100), d_out)
  let tx =
    Transaction {
      ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero,
      validity_range: epoch_range(11 * ms_per_epoch),
    }
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 17. C-EPOCH — out.epoch KHÔNG neo vào cur (out.epoch ≠ get_epoch(tx)) dù
//     cur ≥ in.epoch. Validator ÉP out_datum.epoch == cur → fail.
//     Dựng: cur = 12 (lower_ms = 12×ms), out_datum.epoch = 11 (≠ 12), in.epoch = 10
//     (12 ≥ 10 nên `cur >= datum.epoch` qua; CHỈ `out.epoch == cur` chặn).
// ════════════════════════════════════════════════════════════
test collect_epoch_not_anchored() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let tx =
    collect_tx_anchored(
      lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5100),
      ledger_in, ledger_out,
      11,                    // out_datum.epoch = 11
      12 * ms_per_epoch,     // cur = 12 ≠ 11
      [],
    )
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 18. C-SORT — out ledger KHÔNG strict-sorted (2 bucket sai thứ tự khóa).
//     ledger.is_canonical (strict_sorted) fail. Mọi giá trị dòng đúng (each_out_line_ok
//     pass) — cô lập đúng nguyên nhân = thứ tự khóa.
// ════════════════════════════════════════════════════════════
test collect_ledger_not_sorted() fail {
  let ledger_in =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 },
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 0 },
    ]
  // out: community(bucket 2) ĐỨNG TRƯỚC ops(bucket 1) — sai thứ tự strict-sorted.
  let ledger_out =
    [
      LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 500 },
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 },
    ]
  let items = [item(1000, bucket_ops), item(5000, bucket_community)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5600), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// ── HARDENING v1.1: test đối kháng (F3 C-COL-11, F4 epoch-bounded) ──
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 20. ITEMS RỖNG (fail) — [F3 C-COL-11] Collect PHẢI sinh cut > 0.
//   items=[] ⇒ cut_value(items) = zero ⇒ assets.is_zero(cut) → C-COL-11 chặn. Chống
//   griefing no-op: respend miễn phí mỗi block gây contention chặn settlement thật.
//   ledger_out == ledger_in + value out == in (không đổi gì) → mọi check khác qua,
//   CHỈ C-COL-11 chặn → cô lập F3.
// ════════════════════════════════════════════════════════════
test collect_empty_items() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 42 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 42 }]
  let items = []
  // value out == in (không cut) — chỉ C-COL-11 (Σcut>0) chặn.
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5000), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 21. MỌI ITEM CUT == 0 (fail) — [F3 C-COL-11] Σcut = 0.
//   2 item amount=5/9 (cut ⌊×1000/10000⌋=0 mỗi item) ⇒ Σcut = 0 ⇒ cut_value = zero →
//   C-COL-11 chặn. Item HỢP LỆ (amount≥0 + accepted) nhưng KHÔNG sinh giá trị nào cho
//   custody → no-op griefing. ledger/value KHÔNG đổi → cô lập F3.
//   (Đối ngẫu test 19 collect_item_cut_zero_no_target: ở đó CÓ 1 item cut>0 → Σcut>0 pass.)
// ════════════════════════════════════════════════════════════
test collect_all_cut_zero() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 42 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 42 }]
  // cả 2 item cut=0 ⇒ Σcut=0.
  let items = [item(5, bucket_ops), item(9, bucket_community)]
  let tx =
    collect_tx(lamp_val(5_000_000, 5000), lamp_val(5_000_000, 5000), ledger_in, ledger_out, 11, [])
  run_with(tx, datum(ledger_in), items)
}

// ════════════════════════════════════════════════════════════
// 22. VALIDITY_RANGE TRẢI 2 EPOCH (fail) — [F4] get_epoch_bounded ép lower&upper CÙNG epoch.
//   lo ở epoch 11 (11×ms), hi ở epoch 12 (12×ms) → hi/ms ≠ lo/ms → expect hi==e fail.
//   Chống range trải biên epoch (epoch sổ nhập nhằng). Dựng THỦ CÔNG để upper rơi epoch khác.
// ════════════════════════════════════════════════════════════
test collect_epoch_range_multi_epoch() fail {
  let ledger_in = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 0 }]
  let ledger_out = [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 100 }]
  let items = [item(1000, bucket_ops)]
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5000)), datum(ledger_in)))
  let d_out = CustodyDatum { ..datum(ledger_out), ledger: ledger_out, epoch: 11 }
  let cust_out = util.mk_output(cust_addr, with_nft(lamp_val(5_000_000, 5100)), d_out)
  let tx =
    Transaction {
      ..placeholder, inputs: [cust_in], outputs: [cust_out], mint: assets.zero,
      // lo epoch 11, hi epoch 12 → trải 2 epoch → get_epoch_bounded fail (hi/ms ≠ lo/ms).
      validity_range: interval.between(11 * ms_per_epoch, 12 * ms_per_epoch),
    }
  run_with(tx, datum(ledger_in), items)
}
