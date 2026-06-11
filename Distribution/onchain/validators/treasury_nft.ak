// Treasury authenticity NFT — minting policy ONE-SHOT (CONTRACT v2, C-SOLV-*).
//
// Treasury UTxO giữ sổ cái solvency (cumulative_entitlement) + LAMP pool. claim_account
// đọc treasury qua reference/co-spend để ép cumulative_entitlement ≤ pool. Nếu treasury
// KHÔNG có authenticity NFT, kẻ tấn công tạo treasury giả (cùng datum shape, pool LAMP
// fake lớn) tại cùng address → bypass solvency. NFT "TRSY" duy nhất chứng thực treasury
// canonical → singleton TUYỆT ĐỐI toàn cục (không chỉ per-tx).
//
// FIRST-PRINCIPLES — one-shot: policy parameterized bởi 1 genesis OutputReference. Mint
//   chỉ hợp lệ khi tx CONSUME đúng UTxO genesis đó → policy chạy đúng 1 lần → supply 1
//   NFT cố định, KHÔNG re-mint. Bất biến mạnh nhất không cần state on-chain.
//
// MINT shape: (TRSY, +1) đúng 1, không hơn không kém. BURN cấm (else fail).

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/lampdist/util

/// Redeemer minting policy. Chỉ MintGenesis (cấm burn — authenticity sống suốt vòng đời).
pub type TreasuryNftRedeemer {
  MintGenesis
}

validator treasury_nft(genesis_ref: OutputReference) {
  mint(_redeemer: TreasuryNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ───────────────────────────
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, qty +1 ───────────────────────
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    let nft_name = util.treasury_nft_name()
    expect assets.quantity_of(tx.mint, policy_id, nft_name) == 1

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const nt_policy: PolicyId = #"7235"

fn nt_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

fn nt_mint(qty: Int) -> Value {
  assets.zero
    |> assets.add(nt_policy, util.treasury_nft_name(), qty)
}

fn nt_genesis_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(nt_genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

fn nt_other_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(0), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

test trnft_mint_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input(), nt_genesis_input()],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input()],
      mint: nt_mint(1),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test trnft_mint_wrong_quantity() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      mint: nt_mint(2),
    }
  treasury_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}
