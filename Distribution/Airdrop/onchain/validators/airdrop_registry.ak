// airdrop_registry (§6.2) — SPO đăng ký pool nhận airdrop bằng cách mint 1
// registration-NFT (name = pool_id) vào registry script, mang RegistrationDatum
// {pool_id, reward_owner, epoch_registered}. NFT BẤT BIẾN (không có spend handler →
// else fail) ⇒ keeper đọc làm reference input, datum không thể sửa.
//
// Luật (validator từ chối nếu vi phạm):
//   R1  Đúng 1 token policy này được mint: name == datum.pool_id, qty 1 (không token ẩn).
//   R2  Đúng 1 output tại registry script, giữ NFT + RegistrationDatum inline.
//   R3  Cửa sổ đăng ký: register_open_epoch ≤ current_epoch ≤ register_deadline_epoch
//       (mở 1/7, hạn epoch 4 — §6.2; sau hạn KHÔNG đăng ký được).
//   R4  datum.epoch_registered == current_epoch (không khai khống epoch).
//   R5  SPO (datum.reward_owner) ký — chỉ chủ pool tự đăng ký.
//
// RANH GIỚI TIN CẬY (đọc kỹ — "1 NFT/pool" là mục tiêu, KHÔNG phải bảo đảm on-chain):
//   • R1 chỉ kiểm TRONG-1-TX. Minting policy không thấy UTxO set / lịch sử ⇒ cùng pool_id
//     CÓ THỂ mint lại ở tx khác (mỗi lần 1 NFT (policy, pool_id) mới, datum reward_owner
//     khác). Không state-thread nên KHÔNG chặn được uniqueness toàn cục ở tầng validator.
//   • R5 chỉ chứng minh người ký == reward_owner TỰ CHỌN, KHÔNG buộc pool_id thuộc SPO đó
//     ⇒ ai cũng đăng ký pool_id người khác với reward_owner của mình (hijack tiềm năng).
//   • Phòng thủ THẬT nằm off-chain: (a) keeper dedup TẤT ĐỊNH earliest-wins, KHÔNG throw khi
//     trùng (distribute.ts — nếu không, 1 tx mint-trùng rẻ tiền làm sập cả epoch = DoS);
//     (b) committee thẩm định reward_owner khớp reward account thật của pool TRƯỚC khi post
//     Merkle root (§6.2). Committee (M-of-N ⌈2N/3⌉) là trust anchor, không phải NFT này.

use aiken/collection/list
use aiken/interval
use cardano/assets.{PolicyId}
use cardano/assets
use cardano/transaction.{InlineDatum, Transaction, placeholder}
use magiclamp/airdrop/types.{RegistrationDatum, RegistryRedeemer, Register}
use magiclamp/airdrop/util

validator airdrop_registry(
  register_open_epoch     : Int,
  register_deadline_epoch : Int,
  ms_per_epoch            : Int,
) {
  mint(_redeemer: RegistryRedeemer, policy_id: PolicyId, tx: Transaction) {
    // R2: đúng 1 output tại registry script (own_hash == policy_id cho mint+spend).
    expect util.count_outputs_at_script(tx.outputs, policy_id) == 1
    let reg_out = util.output_at_script(tx.outputs, policy_id)
    expect InlineDatum(d) = reg_out.datum
    expect rd: RegistrationDatum = d

    // R1: đúng 1 token policy này mint, name == pool_id, qty 1 (chặn token ẩn).
    let mints = list.filter(assets.flatten(tx.mint), fn(t) { t.1st == policy_id })
    expect mints == [(policy_id, rd.pool_id, 1)]
    expect assets.quantity_of(reg_out.value, policy_id, rd.pool_id) == 1

    // R3: cửa sổ đăng ký [open, deadline].
    let current_epoch = util.get_epoch(tx, ms_per_epoch)
    expect current_epoch >= register_open_epoch
    expect current_epoch <= register_deadline_epoch

    // R4: epoch khai == epoch thật.
    expect rd.epoch_registered == current_epoch

    // R5: SPO ký.
    expect util.signed_by(tx, rd.reward_owner)
    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const t_policy: ByteArray = #"a1a1a1a1"

const t_pool: ByteArray = #"deadbeef"

const t_owner: ByteArray = #"0a0a"

const t_open: Int = 1

const t_deadline: Int = 4

const t_mspe: Int = 86_400_000

fn reg_datum(pool: ByteArray, owner: ByteArray, epoch: Int) -> RegistrationDatum {
  RegistrationDatum { pool_id: pool, reward_owner: owner, epoch_registered: epoch }
}

/// tx: mint NFT + 1 output registry, sigs, epoch.
fn reg_tx(
  rd        : RegistrationDatum,
  mint_name : ByteArray,
  mint_qty  : Int,
  sigs      : List<ByteArray>,
  epoch     : Int,
) -> Transaction {
  let reg_addr = util.script_address(t_policy)
  let out_val = assets.add(assets.from_lovelace(2_000_000), t_policy, rd.pool_id, 1)
  let reg_out = util.mk_output(reg_addr, out_val, rd)
  let mint_val = assets.from_asset(t_policy, mint_name, mint_qty)
  Transaction {
    ..placeholder,
    outputs: [reg_out],
    mint: mint_val,
    extra_signatories: sigs,
    validity_range: interval.after(epoch * t_mspe),
  }
}

test register_happy_path() {
  let rd = reg_datum(t_pool, t_owner, 2)
  let tx = reg_tx(rd, t_pool, 1, [t_owner], 2)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_at_open_boundary() {
  let rd = reg_datum(t_pool, t_owner, 1)
  let tx = reg_tx(rd, t_pool, 1, [t_owner], 1) // epoch == open
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_at_deadline_boundary() {
  let rd = reg_datum(t_pool, t_owner, 4)
  let tx = reg_tx(rd, t_pool, 1, [t_owner], 4) // epoch == deadline
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_after_deadline() fail {
  let rd = reg_datum(t_pool, t_owner, 5)
  let tx = reg_tx(rd, t_pool, 1, [t_owner], 5) // > deadline → reject (R3)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_before_open() fail {
  let rd = reg_datum(t_pool, t_owner, 0)
  let tx = reg_tx(rd, t_pool, 1, [t_owner], 0) // < open → reject (R3)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_wrong_datum_epoch() fail {
  let rd = reg_datum(t_pool, t_owner, 3) // khai 3 nhưng tx ở epoch 2 → reject (R4)
  let tx = reg_tx(rd, t_pool, 1, [t_owner], 2)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_no_owner_sig() fail {
  let rd = reg_datum(t_pool, t_owner, 2)
  let tx = reg_tx(rd, t_pool, 1, [], 2) // không ai ký → reject (R5)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_double_mint() fail {
  let rd = reg_datum(t_pool, t_owner, 2)
  let tx = reg_tx(rd, t_pool, 2, [t_owner], 2) // mint qty 2 → reject (R1)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}

test register_name_mismatch() fail {
  let rd = reg_datum(t_pool, t_owner, 2)
  // NFT name khác pool_id trong datum → mints ≠ [(policy, pool_id, 1)] → reject (R1)
  let tx = reg_tx(rd, #"facefeed", 1, [t_owner], 2)
  airdrop_registry.mint(t_open, t_deadline, t_mspe, Register, t_policy, tx)
}
