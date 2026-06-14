// ispo_marker — REGISTRY script GIỮ claim-slot NFT (1 slot/owner/epoch).
//
// ─────────────────────────────────────────────────────────────────────────
// VAI TRÒ
//   Mỗi entitlement (epoch, owner) ↔ ĐÚNG 1 slot UTxO ở script này. Slot đúc
//   lúc admin SetRoot epoch e (ispo_pool ép gửi bộ slot vào đây). Claim PHẢI
//   consume slot tương ứng + BURN nó → slot biến mất VĨNH VIỄN.
//
// ─────────────────────────────────────────────────────────────────────────
// CHỐNG DOUBLE-CLAIM phía CLAIMER (spend-once) — KHÔNG trustless tuyệt đối
//   Slot là UTxO. Tiêu 1 lần là hết. Với BỘ SLOT CHO TRƯỚC, claim-2 cùng
//   (epoch,owner) KHÔNG còn slot → không lập được tx. Phần này KHÔNG phụ thuộc
//   indexer off-chain.
//
//   GIỚI HẠN: slot do admin SetRoot đúc. On-chain KHÔNG ép tên slot khớp epoch
//   (tên là blake2b hash, không có preimage). Admin đủ ngưỡng, nếu cấu kết, có
//   thể re-mint slot epoch cũ đã burn → tái tạo nullifier. Vậy việc "bộ slot
//   đúng + không re-mint" = TIN CẬY admin-threshold. Chi tiết: ispo_pool.ak
//   §GIỚI HẠN.
//
// ─────────────────────────────────────────────────────────────────────────
// LUẬT SPEND (mỗi slot UTxO)
//   1. tx PHẢI có ≥1 POOL NFT input (pool đang spend Claim ủy quyền việc tiêu
//      slot — pool validator mới ép đúng (epoch,owner) khớp proof). Không POOL
//      input = không ai ủy quyền → fail.
//   2. Slot mà UTxO này mang PHẢI bị BURN (mint qty == −1 cho đúng name), KHÔNG
//      được tái đúc/luân chuyển. Buộc slot tiêu là CHÁY → spend-once thực thi.
//
// PARAM
//   ispo_nft_policy : policy id đúc POOL + SLOT (tính từ genesis_ref ở deploy).
//                     Param ≠ datum → KHÔNG phá interface contract. Pool 1 chiều
//                     tham chiếu registry qua slot_registry_hash; registry tham
//                     chiếu policy → KHÔNG vòng tròn.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/ispo/types.{pool_nft_name}
use magiclamp/ispo/util

validator ispo_marker(ispo_nft_policy: ByteArray) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // UTxO slot đang spend (chính nó).
    expect Some(self_in) =
      list.find(tx.inputs, fn(x) { x.output_reference == own_ref })

    // (1) POOL NFT input phải có mặt → pool đang spend (Claim) ủy quyền.
    expect
      util.count_inputs_with_nft(tx.inputs, ispo_nft_policy, pool_nft_name) >= 1

    // Tên slot mà UTxO này mang (token DUY NHẤT của ispo_nft_policy trong slot,
    // KHÔNG phải POOL NFT). Slot đúc qty 1, registry không gom POOL NFT.
    let slot_tokens = assets.tokens(self_in.output.value, ispo_nft_policy)
    // Đúng 1 loại token policy này trong slot, và KHÔNG phải POOL NFT.
    expect dict.size(slot_tokens) == 1
    expect [Pair(slot_name, slot_qty)] = dict.to_pairs(slot_tokens)
    expect slot_qty == 1
    expect slot_name != pool_nft_name

    // (2) Slot này PHẢI bị BURN trong tx (mint qty == −1). KHÔNG tái đúc.
    expect assets.quantity_of(tx.mint, ispo_nft_policy, slot_name) == -1
    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const im_nft_policy: ByteArray = #"15f00d"

const im_registry_sh: ByteArray = #"5e9157"

const slot_name_a: ByteArray = #"5101015101015101015101015101015101015101015101015101015101010101"

fn im_slot_val(name: ByteArray, qty: Int) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(im_nft_policy, name, qty)
}

fn im_pool_input() -> Input {
  let v = assets.from_lovelace(5_000_000) |> assets.add(im_nft_policy, pool_nft_name, 1)
  util.mk_input(util.mk_ref(9), util.mk_output_no_datum(util.vk_address(#"b0"), v))
}

fn im_slot_input(name: ByteArray, qty: Int) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(util.script_address(im_registry_sh), im_slot_val(name, qty)),
  )
}

fn im_burn(name: ByteArray, qty: Int) -> assets.Value {
  assets.zero |> assets.add(im_nft_policy, name, qty)
}

fn run_marker(tx: Transaction) -> Bool {
  // own_ref = ref của slot input (mk_ref(0)). redeemer bị bỏ qua → 0 placeholder.
  let r: Data = 0
  ispo_marker.spend(im_nft_policy, None, r, util.mk_ref(0), tx)
}

test marker_burn_happy() {
  // POOL input có mặt + slot bị burn (−1) → pass.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [im_pool_input(), im_slot_input(slot_name_a, 1)],
      mint: im_burn(slot_name_a, -1),
    }
  run_marker(tx)
}

test marker_reject_no_pool_input() fail {
  // KHÔNG có POOL input → không ai ủy quyền → fail.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [im_slot_input(slot_name_a, 1)],
      mint: im_burn(slot_name_a, -1),
    }
  run_marker(tx)
}

test marker_reject_slot_not_burned() fail {
  // slot KHÔNG bị burn (mint 0 cho name) → fail (spend-once không thực thi).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [im_pool_input(), im_slot_input(slot_name_a, 1)],
      mint: assets.zero,
    }
  run_marker(tx)
}

test marker_reject_slot_recreated() fail {
  // mưu toan tái đúc slot (mint +1 thay vì −1) → qty ≠ −1 → fail.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [im_pool_input(), im_slot_input(slot_name_a, 1)],
      mint: im_burn(slot_name_a, 1),
    }
  run_marker(tx)
}
