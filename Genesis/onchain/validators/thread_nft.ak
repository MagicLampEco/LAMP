// thread_nft — minting policy ONE-SHOT cho SupplyState thread NFT (CONTRACT §3 tầng 1).
//
// FIRST-PRINCIPLES — one-shot ⇒ SupplyState DUY NHẤT:
//   Policy param = genesis_ref (OutputReference). Mint hợp lệ chỉ khi tx CONSUME
//   đúng UTxO genesis đó. 1 UTxO spend ≤ 1 lần trong lịch sử chain → policy chạy
//   ≤ 1 lần → mint đúng 1 (SUPPLY,+1) đúng MỘT lần → KHÔNG thể tạo thread NFT thứ 2
//   → KHÔNG thể dựng SupplyState giả (vector A3). Bất biến mạnh nhất không cần state.
//
// MINT shape: đúng 1 asset name (supply_name), qty == 1. KHÔNG burn (else fail) →
// thread NFT BẤT BIẾN, sống suốt vòng đời module (đóng vector A3/A12 từ gốc).

use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/genesis/constants
use magiclamp/genesis/types.{MintGenesis, SupplyState, ThreadNftRedeemer}
use magiclamp/genesis/util

validator thread_nft(genesis_ref: OutputReference, supply_state_hash: ByteArray) {
  mint(_r: ThreadNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ONE-SHOT: consume genesis_ref (1 lần duy nhất trong lịch sử chain).
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // Đúng 1 asset name của policy này, qty đúng 1 (không hơn không kém, không âm).
    expect util.policy_name_count(tx.mint, policy_id) == 1
    expect assets.quantity_of(tx.mint, policy_id, constants.supply_name) == 1

    // ── D8-#2: NEO output mang SUPPLY NFT vào supply_state script + datum genesis ──
    // KHÔNG ủy thác offchain neo bootstrap đúng. Mint thread NFT chỉ hợp lệ khi tx
    // đồng thời đặt nó tại Script(supply_state_hash) với datum genesis CHÍNH DANH
    // (counter = 0, cap = hằng). Loại bỏ đường tạo SupplyState khởi tạo bịa (cap phình
    // hoặc counter ≠ 0) ngay tại lượt mint thread duy nhất.
    let s_out: Output =
      util.output_holding_nft(tx.outputs, policy_id, constants.supply_name)
    expect s_out.address.payment_credential == Script(supply_state_hash)
    expect genesis: SupplyState = util.inline_datum(s_out)
    expect genesis == SupplyState {
      dist_minted: 0,
      reserve_minted: 0,
      dist_cap: constants.dist_cap_oil,
      reserve_cap: constants.reserve_cap_oil,
    }
    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"5544"

const sscript: ByteArray = #"5151"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 3 }
}

fn g_input() -> Input {
  util.mk_input(g_ref(), util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)))
}

fn other_input() -> Input {
  util.mk_input(util.mk_ref(9), util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)))
}

fn mint_supply(qty: Int) {
  assets.zero |> assets.add(pol, constants.supply_name, qty)
}

fn genesis_state() -> SupplyState {
  SupplyState {
    dist_minted: 0,
    reserve_minted: 0,
    dist_cap: constants.dist_cap_oil,
    reserve_cap: constants.reserve_cap_oil,
  }
}

/// Output mang SUPPLY NFT, tại supply_state script, datum = s (canonical genesis nếu dùng genesis_state()).
fn supply_out(s: SupplyState) -> Output {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(pol, constants.supply_name, 1)
  util.mk_output(util.script_address(sscript), v, s)
}

test thread_oneshot_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [other_input(), g_input()],
      outputs: [supply_out(genesis_state())],
      mint: mint_supply(1),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

test thread_without_genesis() fail {
  // KHÔNG consume genesis → one-shot reject (A3: không thể mint thread tùy tiện).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [other_input()],
      outputs: [supply_out(genesis_state())],
      mint: mint_supply(1),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

test mint_two_threads() fail {
  // mint qty 2 → ≠ 1 → reject (A3: không 2 thread NFT).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      outputs: [supply_out(genesis_state())],
      mint: mint_supply(2),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

test thread_burn_rejected() fail {
  // qty -1 (burn) → reject (NFT bất biến).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      outputs: [supply_out(genesis_state())],
      mint: mint_supply(-1),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

test thread_extra_name() fail {
  // thêm asset name lạ cùng policy → name_count ≠ 1 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      outputs: [supply_out(genesis_state())],
      mint: mint_supply(1) |> assets.add(pol, #"9999", 1),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

// ── D8-#2: output SUPPLY NFT rời supply_state script ─────────────
test thread_output_wrong_address() fail {
  // NFT đặt ở địa chỉ ví thường, không phải Script(supply_state_hash) → reject.
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(pol, constants.supply_name, 1)
  let moved = util.mk_output(util.vk_address(#"dead"), v, genesis_state())
  let tx =
    Transaction { ..placeholder, inputs: [g_input()], outputs: [moved], mint: mint_supply(1) }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

// ── D8-#2: datum genesis KHÔNG canonical (cap phình) ─────────────
test thread_genesis_cap_inflated() fail {
  // datum khởi tạo cap > hằng → reject (chống bootstrap cap phình từ lượt mint thread).
  let bad =
    SupplyState { ..genesis_state(), dist_cap: constants.dist_cap_oil + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      outputs: [supply_out(bad)],
      mint: mint_supply(1),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}

// ── D8-#2: counter genesis ≠ 0 ───────────────────────────────────
test thread_genesis_counter_nonzero() fail {
  // datum khởi tạo dist_minted ≠ 0 → reject (genesis phải sạch counter).
  let bad = SupplyState { ..genesis_state(), dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      outputs: [supply_out(bad)],
      mint: mint_supply(1),
    }
  thread_nft.mint(g_ref(), sscript, MintGenesis, pol, tx)
}
