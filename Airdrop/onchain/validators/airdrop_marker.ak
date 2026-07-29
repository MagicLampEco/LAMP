// airdrop_marker — REGISTRY giữ toàn bộ claim-slot UTxO (no-spend CÓ ĐIỀU KIỆN).
//
// ─────────────────────────────────────────────────────────────────────────
// VAI TRÒ
//   Mỗi leaf của snapshot có ĐÚNG 1 claim-slot UTxO ngụ tại đây, mang NFT
//   (airdrop_nft_policy, name=leaf, qty 1). Slot đúc 1 lần ở SETUP (one-shot).
//   Tiêu slot = nullifier "leaf đã claim" → SPEND-ONCE, bất khả-tái-sinh.
//
// PARAM (1 chiều, KHÔNG vòng): airdrop_nft_policy — policy id POOL NFT + slot NFT.
//   Marker chỉ đọc 1 policy id, KHÔNG tham chiếu pool/treasury script-hash → không
//   vòng tròn hash-param (bài học Faucet/Allocation).
//
// ─────────────────────────────────────────────────────────────────────────
// SPEND (tiêu 1 slot UTxO) — ĐIỀU KIỆN CHUNG cho cả Claim và Sweep:
//   1. Tx có ĐÚNG 1 POOL NFT input (count_inputs_with_nft == 1) → chỉ pool (đã
//      verify proof / đã quá deadline) được phép ủy quyền tiêu slot. Không POOL
//      input = không ai ủy quyền → fail.
//   2. Slot NFT của leaf NÀY bị BURN: net mint qty (airdrop_nft_policy, leaf) == -1.
//      → slot biến mất, KHÔNG tái tạo về registry (chống "recreate slot" để claim lại).
//   Pool validator (Claim) ép leaf khớp claimer + slot từ marker_dest; pool (Sweep)
//   ép quá deadline + ADA slot về Treasury. Marker chỉ ép spend-once + burn → tách
//   quan tâm, KHÔNG trùng kiểm. "Có POOL input ⇒ tin pool".

use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction, placeholder}
use magiclamp/airdrop/ledger.{pool_nft_name}
use magiclamp/airdrop/util

validator airdrop_marker(airdrop_nft_policy: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // Slot đang tiêu: lấy leaf name = tên token policy duy nhất trong value slot.
    let own = util.own_output(own_ref, tx.inputs)
    let leaf = util.sole_policy_name(own.value, airdrop_nft_policy)

    // (1) ĐÚNG 1 POOL NFT input → pool ủy quyền (đã verify proof/deadline).
    expect
      util.count_inputs_with_nft(tx.inputs, airdrop_nft_policy, pool_nft_name) == 1

    // (2) Slot NFT leaf NÀY bị burn (net -1) → spend-once, không tái sinh về registry.
    expect assets.quantity_of(tx.mint, airdrop_nft_policy, leaf) == -1
    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const am_policy: PolicyId = #"facade01"

const am_leaf: ByteArray = #"abcdef01"

const am_registry_sh: ByteArray = #"5a5a5a5a"

const am_pool_sh: ByteArray = #"facade"

/// Slot UTxO ở registry mang (policy, leaf, 1) + min-ADA.
fn am_slot_input() {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(am_policy, am_leaf, 1)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(util.script_address(am_registry_sh), v),
  )
}

/// Input mang POOL NFT (pool đang spend).
fn am_pool_input() {
  let v =
    assets.from_lovelace(5_000_000) |> assets.add(am_policy, pool_nft_name, 1)
  util.mk_input(
    util.mk_ref(1),
    util.mk_output_no_datum(util.script_address(am_pool_sh), v),
  )
}

fn am_run(tx: Transaction) -> Bool {
  airdrop_marker.spend(am_policy, None, Void, util.mk_ref(0), tx)
}

test marker_spend_happy() {
  // có POOL input + slot leaf bị burn (-1) → cho tiêu.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [am_slot_input(), am_pool_input()],
      mint: assets.zero |> assets.add(am_policy, am_leaf, -1),
    }
  am_run(tx)
}

test marker_spend_requires_pool_input() fail {
  // KHÔNG có POOL input → không ai ủy quyền → reject (dù slot bị burn).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [am_slot_input()],
      mint: assets.zero |> assets.add(am_policy, am_leaf, -1),
    }
  am_run(tx)
}

test marker_spend_reject_recreate_slot() fail {
  // slot KHÔNG burn mà được "tái tạo" (net mint 0 → đưa lại registry) → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [am_slot_input(), am_pool_input()],
      mint: assets.zero,
    }
  am_run(tx)
}

test marker_sweep_after_deadline_ok() {
  // Sweep: nhiều slot tiêu cùng lúc — mỗi slot validator chạy độc lập. Slot leaf
  // này: có POOL input (pool Sweep) + slot burn (-1) → cho tiêu. (Pool branch ép
  // quá deadline + ADA về Treasury — không trùng kiểm ở marker.)
  let other_leaf: ByteArray = #"99887766"
  let tx =
    Transaction {
      ..placeholder,
      inputs: [am_slot_input(), am_pool_input()],
      // sweep burn nhiều slot trong 1 tx (leaf này + leaf khác).
      mint: assets.zero
        |> assets.add(am_policy, am_leaf, -1)
        |> assets.add(am_policy, other_leaf, -1),
    }
  am_run(tx)
}

test marker_spend_reject_two_pool_inputs() fail {
  // 2 POOL NFT input → count == 2 → reject (chống double-satisfaction).
  let pool2 = {
    let v =
      assets.from_lovelace(5_000_000) |> assets.add(am_policy, pool_nft_name, 1)
    util.mk_input(
      util.mk_ref(2),
      util.mk_output_no_datum(
        util.script_address_staked(am_pool_sh, #"99"),
        v,
      ),
    )
  }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [am_slot_input(), am_pool_input(), pool2],
      mint: assets.zero |> assets.add(am_policy, am_leaf, -1),
    }
  am_run(tx)
}
