// Validator tests cho nhánh MIGRATE-IN (mock Transaction) — C-MIG-1..9.
//
// Nhánh này là chỗ Δ LAMP rút từ Reserve ĐI VÀO SỔ kho. Giá trị của nó nằm ở chỗ nó
// TỪ CHỐI, nên bộ kiểm dưới đây có đúng MỘT ca dương và phần còn lại là ca âm, mỗi
// luật C-MIG-* ít nhất một ca.
//
// KỶ LUẬT DỰNG CA ÂM: mỗi ca âm lệch khỏi ca dương ĐÚNG MỘT chỗ (trừ hai ca ghi rõ lý do
// phải lệch hai chỗ). Lệch hai chỗ thì bài chết ở cổng sớm hơn và không đo cổng nó khai.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{Input, Output, Transaction, placeholder}
use custody
use magiclamp/treasury/migrate
use magiclamp/treasury/types.{
  AssetKey, CustodyDatum, LedgerEntry, MigrateIn,
}
use magiclamp/treasury/util

// ── Hằng số test (soi gương collect_test.ak) ──
const cust_sh: ByteArray = #"c0c0c0c0"

const seed_policy: assets.PolicyId = #"5eed"

const instance_id: ByteArray = #"abcd"

const ms_per_epoch: Int = 432_000_000

const lamp_policy: assets.PolicyId = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

/// bucket vận hành của instance (Collect rót cut vào đây) — KHÁC bucket Reserve-inflow.
const bucket_ops: Int = 1

const cut_bps_10: Int = 1000

const gov_sh: ByteArray = #"9999"

/// epoch của datum vào / ra (C-MIG-4 neo out.epoch == cur).
const in_epoch: Int = 10

const out_epoch: Int = 11

/// Δ LAMP rút từ Reserve trong ca dương.
const delta: Int = 1000

/// Số dư LAMP kho ĐANG có trước khi nạp (dùng cho ca tái chế).
const held_lamp: Int = 5000

fn accepted() -> List<AssetKey> {
  [
    // ADA
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn base_datum(
  ledger  : List<LedgerEntry>,
  epoch   : Int,
  accepts : List<AssetKey>,
) -> CustodyDatum {
  CustodyDatum {
    instance_id: instance_id,
    accepted_assets: accepts,
    ledger: ledger,
    cut_bps: cut_bps_10,
    governance_ref: gov_sh,
    epoch: epoch,
    consumed_proposals: [],
  }
}

fn lamp_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.add(assets.from_lovelace(lovelace), lamp_policy, lamp_name, lamp)
}

/// C-MIG-2: NFT authenticity (seed_policy, instance_id) qty 1 trên MỌI value custody.
fn with_nft(value: assets.Value) -> assets.Value {
  assets.add(value, seed_policy, instance_id, 1)
}

// ── Fixture ca DƯƠNG ──

fn ledger_in_ok() -> List<LedgerEntry> {
  [LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: held_lamp }]
}

/// Sổ ra: dòng cũ NGUYÊN + dòng Reserve-inflow mới đúng Δ. Canonical (bucket tăng ngặt).
fn ledger_out_ok() -> List<LedgerEntry> {
  [
    LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: held_lamp },
    LedgerEntry {
      bucket_id: migrate.reserve_inflow_bucket_id,
      policy: lamp_policy,
      name: lamp_name,
      amount: delta,
    },
  ]
}

fn d_in_ok() -> CustodyDatum {
  base_datum(ledger_in_ok(), in_epoch, accepted())
}

fn d_out_ok() -> CustodyDatum {
  base_datum(ledger_out_ok(), out_epoch, accepted())
}

fn in_val_ok() -> assets.Value {
  with_nft(lamp_val(5_000_000, held_lamp))
}

fn out_val_ok() -> assets.Value {
  with_nft(lamp_val(5_000_000, held_lamp + delta))
}

fn mint_ok_value() -> assets.Value {
  assets.add(assets.zero, lamp_policy, lamp_name, delta)
}

// F4/C-MIG-4: interval GỌN trong 1 epoch (get_epoch_bounded đòi lower & upper cùng epoch).
fn epoch_range(lower_ms: Int) -> interval.Interval {
  interval.between(lower_ms, lower_ms + ms_per_epoch - 1)
}

/// Dựng tx MigrateIn. Mọi ca âm gọi hàm này và đổi ĐÚNG một tham số so với `happy_tx`.
fn tx_of(
  in_val       : assets.Value,
  out_val      : assets.Value,
  d_in         : CustodyDatum,
  d_out        : CustodyDatum,
  lower_ms     : Int,
  mint         : assets.Value,
  extra_inputs : List<Input>,
  extra_outputs: List<Output>,
) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let cust_in = util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, in_val, d_in))
  let cust_out = util.mk_output(cust_addr, out_val, d_out)
  Transaction {
    ..placeholder,
    inputs: list.concat([cust_in], extra_inputs),
    outputs: list.concat([cust_out], extra_outputs),
    mint: mint,
    validity_range: epoch_range(lower_ms),
  }
}

/// Biến thể `tx_of` cho phép đổi RIÊNG hình dạng output kho (địa chỉ / reference_script).
/// Mọi thứ khác giữ y hệt ca dương → ca âm lệch đúng một chỗ.
fn tx_with_custody_output(cust_out: Output) -> Transaction {
  let cust_addr = util.script_address(cust_sh)
  let cust_in =
    util.mk_input(util.mk_ref(0), util.mk_output(cust_addr, in_val_ok(), d_in_ok()))
  Transaction {
    ..placeholder,
    inputs: [cust_in],
    outputs: [cust_out],
    mint: mint_ok_value(),
    validity_range: epoch_range(out_epoch * ms_per_epoch),
  }
}

fn happy_tx() -> Transaction {
  tx_of(
    in_val_ok(),
    out_val_ok(),
    d_in_ok(),
    d_out_ok(),
    out_epoch * ms_per_epoch,
    mint_ok_value(),
    [],
    [],
  )
}

/// Chạy validator. `#"feed"` = proposal_policy dummy (chỉ nhánh Release dùng).
fn run(tx: Transaction, d_in: CustodyDatum, source: ByteArray) -> Bool {
  custody.custody.spend(
    #"feed", seed_policy, ms_per_epoch, lamp_policy, lamp_name,
    Some(d_in), MigrateIn { source }, util.mk_ref(0), tx,
  )
}

fn run_ok(tx: Transaction) -> Bool {
  run(tx, d_in_ok(), migrate.reserve_source_tag)
}

// ════════════════════════════════════════════════════════════
// CA DƯƠNG — đường nạp hợp lệ đầy đủ
//   spend custody (mang NFT) + mint Δ + custody output mang NFT, datum đúng,
//   value +Δ, sổ +Δ tại bucket Reserve-inflow.
// ════════════════════════════════════════════════════════════
test migrate_happy() {
  run_ok(happy_tx())
}

// ════════════════════════════════════════════════════════════
// C-MIG-1 — ĐÚNG 1 custody input + 1 custody output theo SCRIPT HASH
// ════════════════════════════════════════════════════════════

test migrate_reject_delta_to_datumless_utxo_at_custody() fail {
  // CA ĐANG LỌT TRƯỚC KHI VÁ: Δ rót vào một UTxO KHÔNG DATUM tại ĐỊA CHỈ custody.
  // Nó chỉ đúng "địa chỉ", không vào sổ, và tiêu lại không được (custody đòi datum)
  // ⇒ Δ đóng băng ngoài sổ = đốt trá hình. Nay có custody output THỨ HAI tại cùng
  // script hash ⇒ count_outputs_at_script == 2 ⇒ C-MIG-1 từ chối.
  let stray =
    util.mk_output_no_datum(
      util.script_address(cust_sh),
      lamp_val(2_000_000, delta),
    )
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, mint_ok_value(), [], [stray],
    ),
  )
}

test migrate_reject_two_custody_inputs() fail {
  // 2 custody input chia chung 1 custody output (double-satisfaction) → C-MIG-1 reject.
  let second =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(util.script_address(cust_sh), in_val_ok(), d_in_ok()),
    )
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, mint_ok_value(), [second], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-2 — cust_in/out mang đúng 1 NFT authenticity
// ════════════════════════════════════════════════════════════

test migrate_reject_output_without_seed_nft() fail {
  // Δ rót vào UTxO có DATUM HỢP LỆ nhưng KHÔNG mang custody NFT — custody-GIẢ dựng tại
  // địa chỉ script (địa chỉ công khai) với datum bịa → C-MIG-2 reject.
  run_ok(
    tx_of(
      in_val_ok(),
      // cố ý bỏ with_nft; mọi thứ khác giữ nguyên
      lamp_val(5_000_000, held_lamp + delta),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_input_without_seed_nft() fail {
  // custody INPUT không mang NFT (UTxO rác tại địa chỉ script) → C-MIG-2 reject.
  run_ok(
    tx_of(
      lamp_val(5_000_000, held_lamp),
      out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-3 — tham số instance bảo toàn (một trường một bài)
// ════════════════════════════════════════════════════════════

test migrate_reject_cut_bps_mutated() fail {
  let d_out = CustodyDatum { ..d_out_ok(), cut_bps: 0 }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_governance_ref_mutated() fail {
  let d_out = CustodyDatum { ..d_out_ok(), governance_ref: #"dead" }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_instance_id_mutated() fail {
  let d_out = CustodyDatum { ..d_out_ok(), instance_id: #"beef" }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_accepted_assets_mutated() fail {
  let d_out =
    CustodyDatum { ..d_out_ok(), accepted_assets: [AssetKey { policy: #"", name: #"" }] }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_consumed_proposals_touched() fail {
  // MigrateIn KHÔNG được dùng làm đường vòng cho Release: chạm marker single-use
  // (thêm một proposal_id "đã chi") → C-MIG-3 reject.
  let d_out = CustodyDatum { ..d_out_ok(), consumed_proposals: [#"0001"] }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-4 — neo epoch
// ════════════════════════════════════════════════════════════

test migrate_reject_epoch_not_anchored() fail {
  // out_datum.epoch ≠ cur (cur đọc từ validity_range) → C-MIG-4 reject. Đóng băng epoch
  // sổ = kiểm toán đọc sai thời điểm nạp.
  let d_out = CustodyDatum { ..d_out_ok(), epoch: out_epoch + 1 }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_epoch_regress() fail {
  // cur < datum.epoch (tua lùi) → C-MIG-4 reject.
  // LỆCH HAI CHỖ CÓ CHỦ Ý: dời validity_range về epoch 9 thì out.epoch phải theo (= 9),
  // nếu không bài chết ở vế `out_datum.epoch == cur` chứ không ở vế `cur >= datum.epoch`.
  let back = in_epoch - 1
  let d_out = CustodyDatum { ..d_out_ok(), epoch: back }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      back * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-5 — custody output ở SCRIPT, không ví thường
//   GHI CHÚ TRUNG THỰC: vế này là HỆ QUẢ của C-MIG-1 (`output_at_script` lọc theo
//   payment credential Script) ⇒ KHÔNG dựng được ca âm cô lập cho riêng nó; output ở
//   ví thường làm count_outputs_at_script == 0 và chết ở C-MIG-1 trước. Bài dưới
//   khẳng định trực tiếp bất biến địa chỉ, không đi qua handler.
// ════════════════════════════════════════════════════════════
test migrate_custody_addr_is_not_vk() {
  !util.is_vk(util.script_address(cust_sh))
}

// ════════════════════════════════════════════════════════════
// C-MIG-6 — mint CÓ KIỂM SOÁT (chỗ dễ mở lỗ nhất: một ca âm cho TỪNG biến thể)
// ════════════════════════════════════════════════════════════

test migrate_reject_no_mint() fail {
  // Δ == 0 → C-MIG-6 (`delta > 0`) reject: MigrateIn không phải đường respend miễn phí.
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, assets.zero, [], [],
    ),
  )
}

test migrate_reject_mint_other_policy() fail {
  // Cùng tx đúc thêm asset của POLICY KHÁC (vd NFT authenticity của instance khác)
  // → tx.mint không còn chứa đúng một cặp → C-MIG-6 reject.
  let dirty = assets.add(mint_ok_value(), #"bad0", #"9999", 1)
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, dirty, [], [],
    ),
  )
}

test migrate_reject_mint_other_name_same_policy() fail {
  // Đúc thêm asset-name LẠ dưới CÙNG lamp_policy → C-MIG-6 reject.
  let dirty = assets.add(mint_ok_value(), lamp_policy, #"9999", 1)
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, dirty, [], [],
    ),
  )
}

test migrate_reject_mint_negative_other_asset() fail {
  // Lượng ÂM (burn) ở một asset khác nằm cùng tx.mint → C-MIG-6 reject.
  let dirty = assets.add(mint_ok_value(), #"bad0", #"9999", -1)
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, dirty, [], [],
    ),
  )
}

test migrate_reject_burn_lamp() fail {
  // Δ âm (đốt LAMP) → C-MIG-6 reject. LAMP KHÔNG đốt: đó là bất biến sản phẩm.
  // LỆCH HAI CHỖ CÓ CHỦ Ý: value ra phải khớp dấu âm, nếu không bài chết ở C-MIG-7.
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(lamp_val(5_000_000, held_lamp - delta)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch,
      assets.add(assets.zero, lamp_policy, lamp_name, -delta), [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-7 — value: +Δ đúng asset, mọi asset khác NGUYÊN
// ════════════════════════════════════════════════════════════

test migrate_reject_value_unchanged() fail {
  // Mint Δ nhưng custody value KHÔNG tăng → C-MIG-7 reject.
  run_ok(
    tx_of(
      in_val_ok(), in_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_recycle_delta_to_wallet() fail {
  // TÁI CHẾ: kho đang giữ held_lamp ≥ Δ. tx tiêu UTxO kho, trả lại ĐÚNG held_lamp, còn Δ
  // mới chảy ra ví. Phép đo "tổng LAMP mặt output tới kho ≥ Δ" (luật 9 cũ của Reserve)
  // cho ca này lọt; C-MIG-7 đo ĐỘ TĂNG của chính UTxO kho nên từ chối.
  let wallet =
    util.mk_output_no_datum(util.vk_address(#"beef01"), lamp_val(2_000_000, delta))
  run_ok(
    tx_of(
      in_val_ok(), in_val_ok(), d_in_ok(), d_out_ok(),
      out_epoch * ms_per_epoch, mint_ok_value(), [], [wallet],
    ),
  )
}

test migrate_reject_ada_drained() fail {
  // Nhân lúc nạp Δ thì rút bớt ADA ra → C-MIG-7 reject (mọi asset khác phải NGUYÊN).
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(lamp_val(3_000_000, held_lamp + delta)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_junk_token_added() fail {
  // Nhét token rác vào custody output (phình UTxO / vượt trần asset) → C-MIG-7 reject.
  run_ok(
    tx_of(
      in_val_ok(),
      assets.add(out_val_ok(), #"7a17", #"4a554e4b", 1),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

// ── C-MIG-7 sau F5: lovelace `>=`, phi-lovelace vẫn đẳng thức ───────────────
// Lượt MigrateIn ĐẦU TIÊN thêm asset mới + dòng datum mới ⇒ min-UTxO tăng. Khoá cứng
// lovelace làm lượt đó bất khả thi vĩnh viễn (không có đường sửa sau seed). Hai bài dưới
// ghim ĐÚNG chỗ nới và ĐÚNG chỗ không nới.

test migrate_ada_topup_allowed() {
  // Bơm THÊM ADA (5M → 7M) trong khi phi-lovelace tăng đúng Δ → PASS.
  // Đây là đường vừa mở; ADA thừa là phần KHÔNG ghi sổ (ứng xử như reserved_min_ada).
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(lamp_val(7_000_000, held_lamp + delta)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_other_token_withdrawn() fail {
  // Nhân lúc nạp Δ thì RÚT một token khác ra khỏi kho → C-MIG-7 reject: nới chỉ áp cho
  // lovelace, phi-lovelace vẫn là đẳng thức nên không asset nào rời kho được.
  // LỆCH HAI CHỖ CÓ CHỦ Ý: token phụ phải có mặt ở CẢ value vào lẫn value ra, nếu không
  // thì không có gì để rút và bài không đo được vế nó khai.
  let extra_pol: assets.PolicyId = #"7e57"
  let extra_nm: ByteArray = #"584f58"
  run_ok(
    tx_of(
      assets.add(in_val_ok(), extra_pol, extra_nm, 10),
      assets.add(out_val_ok(), extra_pol, extra_nm, 9),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-ADDR (F2) — địa chỉ kho GIỮ NGUYÊN, kể cả stake credential
//   MigrateIn là nhánh permissionless đầu tiên ⇒ không có vế này thì bất kỳ ai dựng
//   được tx draw cũng chuyển quyền uỷ quyền stake của toàn bộ ADA kho về mình, mỗi
//   epoch một lần, với chi phí một phí tx.
// ════════════════════════════════════════════════════════════

test migrate_reject_stake_credential_hijack() fail {
  // Output kho CÙNG payment credential (nên vẫn qua C-MIG-1/C-MIG-5) nhưng gắn stake
  // credential của kẻ tấn công → C-MIG-ADDR reject.
  let hijacked =
    util.mk_output(
      util.script_address_staked(cust_sh, #"deadbeef"),
      out_val_ok(),
      d_out_ok(),
    )
  run_ok(tx_with_custody_output(hijacked))
}

// ════════════════════════════════════════════════════════════
// C-MIG-REFSCRIPT (F3) — không đính script tham chiếu vào kho
//   Ba nhánh dùng chung một hình dạng vế này; một ca âm ở đây là đủ để nó không bao giờ
//   là mệnh đề chết. Hai nhánh còn lại soi gương (C-COL-REFSCRIPT, C-REL-REFSCRIPT) và
//   được ghim bởi ca âm tương ứng trong collect_test.ak / release_test.ak.
// ════════════════════════════════════════════════════════════

test migrate_reject_reference_script_attached() fail {
  // Đính một script tham chiếu vào kho mỗi lượt migrate = ăn dần dư địa min-ADA
  // (griefing) → C-MIG-REFSCRIPT reject.
  let with_ref =
    Output {
      ..util.mk_output(util.script_address(cust_sh), out_val_ok(), d_out_ok()),
      reference_script: Some(#"5c81"),
    }
  run_ok(tx_with_custody_output(with_ref))
}

test migrate_reject_value_over_credited() fail {
  // value tăng NHIỀU HƠN Δ (kho tự nhận thêm LAMP không có nguồn) → C-MIG-7 reject.
  run_ok(
    tx_of(
      in_val_ok(),
      with_nft(lamp_val(5_000_000, held_lamp + delta + 1)),
      d_in_ok(), d_out_ok(), out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

// ════════════════════════════════════════════════════════════
// C-MIG-8 — sổ: +Δ tại ĐÚNG MỘT (bucket, asset), canonical
// ════════════════════════════════════════════════════════════

test migrate_reject_ledger_unchanged() fail {
  // VALUE tăng nhưng SỔ giữ nguyên → C-MIG-8 reject. Đây là hình dạng "đúng địa chỉ,
  // ngoài sổ": Release đọc sổ nên Δ đó không bao giờ rút lại được = đốt trá hình.
  let d_out = CustodyDatum { ..d_out_ok(), ledger: ledger_in_ok() }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_ledger_wrong_bucket() fail {
  // Δ ghi vào bucket VẬN HÀNH thay vì bucket Reserve-inflow (bucket có luật chi khác)
  // → C-MIG-8 reject.
  let d_out =
    CustodyDatum {
      ..d_out_ok(),
      ledger: [
        LedgerEntry {
          bucket_id: bucket_ops,
          policy: lamp_policy,
          name: lamp_name,
          amount: held_lamp + delta,
        },
      ],
    }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_ledger_line_dropped() fail {
  // Xoá lén dòng sổ cũ (số dư bucket_ops biến mất) → C-MIG-8 reject.
  let d_out =
    CustodyDatum {
      ..d_out_ok(),
      ledger: [
        LedgerEntry {
          bucket_id: migrate.reserve_inflow_bucket_id,
          policy: lamp_policy,
          name: lamp_name,
          amount: delta,
        },
      ],
    }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_ledger_over_credited() fail {
  // Sổ ghi Δ+1 trong khi value chỉ tăng Δ → C-MIG-8 reject (sổ dối để Release rút vượt).
  let d_out =
    CustodyDatum {
      ..d_out_ok(),
      ledger: [
        LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: held_lamp },
        LedgerEntry {
          bucket_id: migrate.reserve_inflow_bucket_id,
          policy: lamp_policy,
          name: lamp_name,
          amount: delta + 1,
        },
      ],
    }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_ledger_not_canonical() fail {
  // Sổ ra KHÔNG strict-sorted (đảo thứ tự hai dòng) → C-MIG-8 reject: sổ không canonical
  // thì phép so in↔out tuyến tính mất hiệu lực và dòng trùng khoá lọt được.
  let d_out =
    CustodyDatum {
      ..d_out_ok(),
      ledger: [
        LedgerEntry {
          bucket_id: migrate.reserve_inflow_bucket_id,
          policy: lamp_policy,
          name: lamp_name,
          amount: delta,
        },
        LedgerEntry { bucket_id: bucket_ops, policy: lamp_policy, name: lamp_name, amount: held_lamp },
      ],
    }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_phantom_ledger_line() fail {
  // Nhồi dòng khống cho asset khác (không có ở sổ vào, không có Δ nào nhắm tới)
  // → C-MIG-8 reject.
  let d_out =
    CustodyDatum {
      ..d_out_ok(),
      ledger: list.concat(
        ledger_out_ok(),
        [
          LedgerEntry {
            bucket_id: migrate.reserve_inflow_bucket_id + 1,
            policy: lamp_policy,
            name: lamp_name,
            amount: 999,
          },
        ],
      ),
    }
  run_ok(
    tx_of(
      in_val_ok(), out_val_ok(), d_in_ok(), d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
  )
}

test migrate_reject_wrong_source_tag() fail {
  // `source` không khớp nhãn nguồn dành riêng cho Reserve → reject. Bucket đích là HẰNG,
  // nên nhãn sai nghĩa là tx đang khai một nguồn mà nhánh này không phục vụ.
  run(happy_tx(), d_in_ok(), #"00")
}

// ════════════════════════════════════════════════════════════
// C-MIG-9 — asset phải nằm trong accepted_assets
// ════════════════════════════════════════════════════════════

test migrate_reject_asset_not_accepted() fail {
  // Instance KHÔNG khai nhận LAMP → từ chối nạp. LỆCH HAI CHỖ CÓ CHỦ Ý: accepted_assets
  // phải đổi ở CẢ datum vào lẫn datum ra, nếu không bài chết ở C-MIG-3 (bảo toàn params).
  let ada_only = [AssetKey { policy: #"", name: #"" }]
  let d_in = base_datum(ledger_in_ok(), in_epoch, ada_only)
  let d_out = base_datum(ledger_out_ok(), out_epoch, ada_only)
  run(
    tx_of(
      in_val_ok(), out_val_ok(), d_in, d_out,
      out_epoch * ms_per_epoch, mint_ok_value(), [], [],
    ),
    d_in,
    migrate.reserve_source_tag,
  )
}
