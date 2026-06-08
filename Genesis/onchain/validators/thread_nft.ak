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
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/genesis/constants
use magiclamp/genesis/types.{MintGenesis, ThreadNftRedeemer}
use magiclamp/genesis/util

validator thread_nft(genesis_ref: OutputReference) {
  mint(_r: ThreadNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ONE-SHOT: consume genesis_ref (1 lần duy nhất trong lịch sử chain).
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // Đúng 1 asset name của policy này, qty đúng 1 (không hơn không kém, không âm).
    expect util.policy_name_count(tx.mint, policy_id) == 1
    expect assets.quantity_of(tx.mint, policy_id, constants.supply_name) == 1

    // KHÔNG ghim output tại Script(supply_state_hash) với datum genesis (D8-#2 cũ):
    // ghim đó cần param supply_state_hash → tạo VÒNG (supply_state_hash phụ thuộc
    // tlamp_policy phụ thuộc thread_policy = ĐÂY) → không apply-param được khi deploy.
    //
    // An toàn vẫn đủ qua 2 lớp tuyến tính tầng-2:
    //   • Neo NFT one-shot: SUPPLY NFT duy nhất ⟺ SupplyState chính danh (count==1).
    //   • D7-#1 (tlamp_mint): cap == hằng genesis. SupplyState khởi tạo cap-phình /
    //     counter≠0 sẽ KHÔNG mint nổi tLAMP → vô dụng. Không cần ép datum tại lượt mint
    //     thread. Một nguồn sự thật cho cap nằm ở tlamp_mint, không trùng lặp.
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

test thread_oneshot_happy() {
  // consume genesis_ref + mint đúng 1 SUPPLY NFT → hợp lệ. Định danh genesis (cap/counter)
  // KHÔNG còn ép tại đây — đã ủy cho neo-NFT + D7-#1 (tlamp_mint). Không cần output datum.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [other_input(), g_input()],
      mint: mint_supply(1),
    }
  thread_nft.mint(g_ref(), MintGenesis, pol, tx)
}

test thread_without_genesis() fail {
  // KHÔNG consume genesis → one-shot reject (A3: không thể mint thread tùy tiện).
  let tx = Transaction { ..placeholder, inputs: [other_input()], mint: mint_supply(1) }
  thread_nft.mint(g_ref(), MintGenesis, pol, tx)
}

test mint_two_threads() fail {
  // mint qty 2 → ≠ 1 → reject (A3: không 2 thread NFT).
  let tx = Transaction { ..placeholder, inputs: [g_input()], mint: mint_supply(2) }
  thread_nft.mint(g_ref(), MintGenesis, pol, tx)
}

test thread_burn_rejected() fail {
  // qty -1 (burn) → reject (NFT bất biến).
  let tx = Transaction { ..placeholder, inputs: [g_input()], mint: mint_supply(-1) }
  thread_nft.mint(g_ref(), MintGenesis, pol, tx)
}

test thread_extra_name() fail {
  // thêm asset name lạ cùng policy → name_count ≠ 1 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_supply(1) |> assets.add(pol, #"9999", 1),
    }
  thread_nft.mint(g_ref(), MintGenesis, pol, tx)
}
