// Validator tests cho custody_seed (one-shot genesis seed — ép bất biến nền).
// Phủ: seed đúng (pass); thiếu genesis (fail); mint qty/size sai (fail);
//      sổ ≠ value: thiếu lovelace reserved (fail), thừa asset không sổ (fail),
//      booked thiếu value (fail); dòng sổ trùng khóa (fail); asset không accepted
//      (fail); NFT name ≠ instance_id (fail); 2 custody output (fail); burn (fail).

use aiken/collection/list
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use custody_seed.{SeedGenesis}
use magiclamp/treasury/collect
use magiclamp/treasury/types.{AssetKey, CustodyDatum, LedgerEntry}
use magiclamp/treasury/util

// ── Hằng số test ──
const seed_policy: assets.PolicyId = #"5eed"

const cust_sh: ByteArray = #"c0c0c0c0"

const instance_id: ByteArray = #"abcd"

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

const bucket_ops: Int = 1

const bucket_community: Int = 2

// reserved min-ADA cho UTxO custody (không ghi sổ).
const reserved: Int = 2_000_000

fn accepted() -> List<AssetKey> {
  [AssetKey { policy: #"", name: #"" }, AssetKey { policy: lamp_policy, name: lamp_name }]
}

fn genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

fn seed_datum(ledger: List<LedgerEntry>) -> CustodyDatum {
  CustodyDatum {
    instance_id: instance_id,
    accepted_assets: accepted(),
    ledger: ledger,
    cut_bps: 1000,
    governance_ref: #"9999",
    epoch: 0,
    consumed_proposals: [],
  }
}

fn genesis_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(5_000_000)))
}

fn other_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(3), util.mk_output_no_datum(addr, assets.from_lovelace(5_000_000)))
}

// Mint đúng 1 NFT name = instance_id.
fn seed_mint(name: ByteArray, qty: Int) -> assets.Value {
  assets.add(assets.zero, seed_policy, name, qty)
}

// Custody NFT one-shot (authenticity) — BẮT BUỘC nằm trong custody.value on-chain.
fn custody_nft() -> assets.Value {
  assets.add(assets.zero, seed_policy, instance_id, 1)
}

// custody output TRUNG THỰC: value KÈM custody NFT (đúng như on-chain). seed_value_ok
// PHẢI trừ NFT trước khi đối chiếu sổ → các test value (sổ/reserved) vẫn đúng ngữ nghĩa.
fn cust_output(value: assets.Value, ledger: List<LedgerEntry>) -> Output {
  util.mk_output(
    util.script_address(cust_sh),
    assets.merge(value, custody_nft()),
    seed_datum(ledger),
  )
}

// Dựng tx genesis: inputs (genesis + other), mint NFT, 1 output custody.
fn seed_tx(
  inputs    : List<Input>,
  mint      : assets.Value,
  outputs   : List<Output>,
) -> Transaction {
  Transaction { ..placeholder, inputs: inputs, outputs: outputs, mint: mint }
}

fn run(tx: Transaction, reserved_min_ada: Int) -> Bool {
  custody_seed.custody_seed.mint(
    genesis_ref(), cust_sh, SeedGenesis { reserved_min_ada }, seed_policy, tx,
  )
}

// ════════════════════════════════════════════════════════════
// 1. SEED ĐÚNG (pass) — value = sổ ⊕ reserved.
//    Sổ: ops LAMP 1000, community LAMP 500, ops ADA 3_000_000.
//    value = LAMP 1500 + ADA (3_000_000 sổ + 2_000_000 reserved) = 5_000_000.
// ════════════════════════════════════════════════════════════
fn happy_ledger() -> List<LedgerEntry> {
  [
    LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1000 },
    LedgerEntry { bucket_id: bucket_community, policy: lamp_policy, name: lamp_name, amount: 500 },
    LedgerEntry { bucket_id: bucket_ops, policy: #"", name: #"", amount: 3_000_000 },
  ]
}

fn happy_value() -> assets.Value {
  assets.from_lovelace(5_000_000) |> assets.add(lamp_policy, lamp_name, 1500)
}

test seed_happy() {
  let tx =
    seed_tx(
      [other_input(), genesis_input()],
      seed_mint(instance_id, 1),
      [cust_output(happy_value(), happy_ledger())],
    )
  run(tx, reserved)
}

// Sổ chỉ LAMP, reserved=0 đúng (không giữ ADA dư).
test seed_no_ada_reserve() {
  let ledger =
    [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 1500 }]
  let value = assets.add(assets.zero, lamp_policy, lamp_name, 1500)
  let tx =
    seed_tx([genesis_input()], seed_mint(instance_id, 1), [cust_output(value, ledger)])
  run(tx, 0)
}

// Sổ rỗng + reserved = value (custody mở rỗng, chỉ giữ min-ADA).
test seed_empty_ledger() {
  let tx =
    seed_tx(
      [genesis_input()],
      seed_mint(instance_id, 1),
      [cust_output(assets.from_lovelace(2_000_000), [])],
    )
  run(tx, 2_000_000)
}

// ════════════════════════════════════════════════════════════
// 2. THIẾU GENESIS (fail) — không consume genesis_ref → one-shot reject.
// ════════════════════════════════════════════════════════════
test seed_without_genesis() fail {
  let tx =
    seed_tx(
      [other_input()],
      seed_mint(instance_id, 1),
      [cust_output(happy_value(), happy_ledger())],
    )
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 3. MINT SAI SỐ LƯỢNG (fail) — qty 2 (≠ 1).
// ════════════════════════════════════════════════════════════
test seed_mint_qty_wrong() fail {
  let tx =
    seed_tx(
      [genesis_input()],
      seed_mint(instance_id, 2),
      [cust_output(happy_value(), happy_ledger())],
    )
  run(tx, reserved)
}

// MINT 2 NAME (size ≠ 1) — nhồi thêm token lạ cùng policy.
test seed_mint_extra_name() fail {
  let mint =
    seed_mint(instance_id, 1) |> assets.add(seed_policy, #"ff", 1)
  let tx =
    seed_tx([genesis_input()], mint, [cust_output(happy_value(), happy_ledger())])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 4. SỔ ≠ VALUE — ÉP BẤT BIẾN NỀN.
// ════════════════════════════════════════════════════════════
// 4a. THIẾU lovelace reserved: value ADA = đúng sổ nhưng quên +reserved.
test seed_missing_reserved() fail {
  // value chỉ có 3_000_000 ADA (= sổ) nhưng reserved=2_000_000 → kỳ vọng 5M.
  let value = assets.from_lovelace(3_000_000) |> assets.add(lamp_policy, lamp_name, 1500)
  let tx =
    seed_tx([genesis_input()], seed_mint(instance_id, 1), [cust_output(value, happy_ledger())])
  run(tx, reserved)
}

// 4b. THỪA asset không có dòng sổ: custody giữ LAMP nhiều hơn sổ ghi.
test seed_value_exceeds_ledger() fail {
  // value LAMP 2000 nhưng sổ chỉ ghi 1500 → 500 LAMP không booked (Release sẽ under-draw).
  let value = assets.from_lovelace(5_000_000) |> assets.add(lamp_policy, lamp_name, 2000)
  let tx =
    seed_tx([genesis_input()], seed_mint(instance_id, 1), [cust_output(value, happy_ledger())])
  run(tx, reserved)
}

// 4c. BOOKED thiếu value: sổ ghi LAMP 1500 nhưng custody chỉ có 1000.
test seed_ledger_exceeds_value() fail {
  let value = assets.from_lovelace(5_000_000) |> assets.add(lamp_policy, lamp_name, 1000)
  let tx =
    seed_tx([genesis_input()], seed_mint(instance_id, 1), [cust_output(value, happy_ledger())])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 5. SỔ TRÙNG KHÓA (fail) — 2 dòng cùng (bucket,asset) để né incremental.
// ════════════════════════════════════════════════════════════
test seed_dup_ledger_line() fail {
  let ledger =
    [
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 750 },
      LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: 750 },
    ]
  // tổng sổ = 1500 = value LAMP → seed_value_ok pass, nhưng no_dup_lines fail.
  let value = assets.add(assets.from_lovelace(2_000_000), lamp_policy, lamp_name, 1500)
  let tx =
    seed_tx([genesis_input()], seed_mint(instance_id, 1), [cust_output(value, ledger)])
  run(tx, 2_000_000)
}

// ════════════════════════════════════════════════════════════
// 6. ASSET KHÔNG ACCEPTED (fail) — dòng sổ dùng policy lạ.
// ════════════════════════════════════════════════════════════
test seed_line_not_accepted() fail {
  let ledger =
    [LedgerEntry { bucket_id: bucket_ops, policy: #"dead", name: #"beef", amount: 1500 }]
  let value = assets.add(assets.from_lovelace(2_000_000), #"dead", #"beef", 1500)
  let tx =
    seed_tx([genesis_input()], seed_mint(instance_id, 1), [cust_output(value, ledger)])
  run(tx, 2_000_000)
}

// ════════════════════════════════════════════════════════════
// 7. NFT NAME ≠ instance_id (fail) — mint name khác định danh datum.
// ════════════════════════════════════════════════════════════
test seed_nft_name_mismatch() fail {
  let tx =
    seed_tx(
      [genesis_input()],
      seed_mint(#"ffff", 1),
      [cust_output(happy_value(), happy_ledger())],
    )
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 8. HAI OUTPUT CUSTODY (fail) — chia value làm 2 custody né bất biến.
// ════════════════════════════════════════════════════════════
test seed_two_custody_outputs() fail {
  let o1 = cust_output(happy_value(), happy_ledger())
  let o2 = cust_output(assets.from_lovelace(2_000_000), [])
  let tx = seed_tx([genesis_input()], seed_mint(instance_id, 1), [o1, o2])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 9. BURN (fail) — mint âm bị else/qty kiểm chặn.
// ════════════════════════════════════════════════════════════
test seed_burn_rejected() fail {
  let tx =
    seed_tx(
      [genesis_input()],
      seed_mint(instance_id, -1),
      [cust_output(happy_value(), happy_ledger())],
    )
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 10. reserved_min_ada ÂM (fail).
// ════════════════════════════════════════════════════════════
test seed_negative_reserved() fail {
  let tx =
    seed_tx(
      [genesis_input()],
      seed_mint(instance_id, 1),
      [cust_output(happy_value(), happy_ledger())],
    )
  run(tx, -1)
}

// ════════════════════════════════════════════════════════════
// 11. SEED PRE-MARK consumed_proposals (fail) — S-CONSUMED-0.
//     genesis datum đặt sẵn consumed_proposals khác [] → mở đường né replay-guard
//     C-REL-9 (seed sẵn id giả để "đã chi" hoặc làm hỏng append). PHẢI bắt đầu rỗng.
// ════════════════════════════════════════════════════════════
test seed_consumed_not_empty() fail {
  let bad_datum =
    CustodyDatum { ..seed_datum(happy_ledger()), consumed_proposals: [#"beef"] }
  // value KÈM NFT (trung thực) — chỉ fail vì consumed_proposals, không vì NFT.
  let bad_out =
    util.mk_output(
      util.script_address(cust_sh),
      assets.merge(happy_value(), custody_nft()),
      bad_datum,
    )
  let tx = seed_tx([genesis_input()], seed_mint(instance_id, 1), [bad_out])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 12. KHÔNG OUTPUT CUSTODY (fail) — mint NFT nhưng không có output custody mang nó.
//     count_outputs_at_script == 0 ⇒ S-OUT-1 fail (NFT lạc, instance không sinh ra đúng).
// ════════════════════════════════════════════════════════════
test seed_no_custody_output() fail {
  // output gửi NFT vào ví thường thay vì custody script.
  let wallet_out =
    util.mk_output_no_datum(util.vk_address(#"a0"), happy_value() |> assets.add(seed_policy, instance_id, 1))
  let tx = seed_tx([genesis_input()], seed_mint(instance_id, 1), [wallet_out])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 13. NFT TRONG VALUE + SỔ ĐÚNG (pass) — chứng minh fix: seed_value_ok TRỪ custody NFT.
//     custody.value = happy_value ⊕ custody NFT (đúng on-chain). Sổ KHÔNG ghi NFT.
//     accounted_value (đã trừ NFT) == ledger_value ⊕ reserved → pass.
//     NẾU seed_value_ok KHÔNG trừ NFT, accounted dư 1 NFT ≠ sổ → test này (và seed_happy)
//     sẽ FAIL. Đó là bằng chứng fix cần thiết.
// ════════════════════════════════════════════════════════════
test seed_with_nft_in_value_ok() {
  // value tường minh CÓ NFT (không qua cust_output để rõ ý đồ): happy_value ⊕ NFT.
  let value_with_nft = assets.merge(happy_value(), custody_nft())
  let out =
    util.mk_output(util.script_address(cust_sh), value_with_nft, seed_datum(happy_ledger()))
  let tx = seed_tx([other_input(), genesis_input()], seed_mint(instance_id, 1), [out])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 14. BOOK NFT THÀNH 1 DÒNG SỔ (fail) — reject_nft_counted_as_asset.
//     Ai đó cố "né" bằng cách ghi custody NFT (seed_policy, instance_id, 1) thành 1 dòng
//     sổ để đẳng thức value==sổ thô khớp. Sau fix: accounted_value đã TRỪ NFT (=happy_value)
//     nhưng ledger_value lại CỘNG thêm NFT → lệch đúng 1 NFT → FAIL.
//     (NFT cũng KHÔNG thuộc accepted_assets → S-ACC-0 cũng chặn — phòng thủ kép.)
// ════════════════════════════════════════════════════════════
test reject_nft_counted_as_asset() fail {
  let ledger_with_nft =
    list.push(
      happy_ledger(),
      LedgerEntry { bucket_id: bucket_ops, policy: seed_policy, name: instance_id, amount: 1 },
    )
  // value = happy_value ⊕ NFT (đúng on-chain). Sổ ghi cả NFT (bẩn ngữ nghĩa kế toán).
  let value_with_nft = assets.merge(happy_value(), custody_nft())
  let out =
    util.mk_output(util.script_address(cust_sh), value_with_nft, seed_datum(ledger_with_nft))
  let tx = seed_tx([genesis_input()], seed_mint(instance_id, 1), [out])
  run(tx, reserved)
}

// ════════════════════════════════════════════════════════════
// 15. seed_value_ok CHỈ TRỪ ĐÚNG POLICY NFT (pass) — chốt ngữ nghĩa helper.
//     value = happy_value ⊕ custody NFT. Sau khi trừ seed_policy, phần còn lại == sổ ⊕
//     reserved → true. Khẳng định value_without_policy không đụng LAMP/ADA (chỉ bỏ NFT).
// ════════════════════════════════════════════════════════════
test seed_value_ok_strips_only_nft_policy() {
  let value_with_nft = assets.merge(happy_value(), custody_nft())
  collect.seed_value_ok(value_with_nft, happy_ledger(), reserved, seed_policy)
}

// Đối ngẫu: nếu trừ NHẦM policy LAMP (không phải NFT) thì sổ sẽ thiếu LAMP → false.
test seed_value_ok_wrong_policy_strip_fails() fail {
  let value_with_nft = assets.merge(happy_value(), custody_nft())
  // trừ lamp_policy thay vì seed_policy → accounted mất LAMP nhưng vẫn dư NFT → lệch.
  expect collect.seed_value_ok(value_with_nft, happy_ledger(), reserved, lamp_policy)
}
