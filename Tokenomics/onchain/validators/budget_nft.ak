// Budget beacon authenticity NFT — minting policy ONE-SHOT, name = channel_id.
//
// Mỗi kênh có đúng 1 ChannelBudget beacon. NFT này chứng thực beacon đó:
// channel_budget validator + claim_account chỉ tin UTxO mang NFT name = channel_id
// → chống datum hijacking (kẻ tấn công tạo budget giả với remaining khống).
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi (genesis_ref, channel_id). Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis. 1 UTxO spend được 1 lần → policy chạy 1 lần →
//   supply 1 NFT cố định per kênh, KHÔNG re-mint, KHÔNG burn (else fail).

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/tokenomics/util

pub type BudgetNftRedeemer {
  MintGenesis
}

validator budget_nft(
  genesis_ref         : OutputReference,
  channel_id          : AssetName,
  channel_budget_hash : ByteArray,   // VÁ Vector F (defense-in-depth): NFT genesis
                                     // BẮT BUỘC ra channel_budget script, khoá vĩnh viễn.
) {
  mint(_redeemer: BudgetNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ──────────────────────────
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, name = channel_id, qty +1 ──
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect assets.quantity_of(tx.mint, policy_id, channel_id) == 1

    // ── VÁ Vector F (gốc): NFT vừa mint PHẢI ra channel_budget script ─────
    // Khoá NFT vào script ngay từ genesis → không bao giờ rời ra ví thường.
    // channel_budget.ak ép b_out.value == b_in.value mọi Decrement → NFT đóng
    // băng vĩnh viễn ở script. Bịt tận gốc đường mở của Vector F (NFT ở ví).
    expect
      util.count_outputs_at_script_with_nft(
        tx.outputs,
        channel_budget_hash,
        policy_id,
        channel_id,
      ) == 1

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const bn_policy: PolicyId = #"b00d"

const bn_channel: AssetName = #"5445414d"  // "TEAM"

const bn_cb_hash: ByteArray = #"b1b1b1b1"  // channel_budget script hash đích genesis

fn bn_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

fn bn_mint(name: AssetName, qty: Int) -> assets.Value {
  assets.zero |> assets.add(bn_policy, name, qty)
}

fn bn_genesis_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(bn_genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

fn bn_other_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(0), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

/// Output NFT genesis tại 1 address bất kỳ (để test đích đến).
fn bn_nft_out_at(addr: Address) -> Output {
  let val = assets.add(assets.from_lovelace(2_000_000), bn_policy, bn_channel, 1)
  util.mk_output_no_datum(addr, val)
}

test budget_nft_mint_happy() {
  // NFT genesis ra channel_budget script (đúng đích) → pass.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_other_input(), bn_genesis_input()],
      outputs: [bn_nft_out_at(util.script_address(bn_cb_hash))],
      mint: bn_mint(bn_channel, 1),
    }
  budget_nft.mint(bn_genesis_ref(), bn_channel, bn_cb_hash, MintGenesis, bn_policy, tx)
}

test budget_nft_mint_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_other_input()],
      outputs: [bn_nft_out_at(util.script_address(bn_cb_hash))],
      mint: bn_mint(bn_channel, 1),
    }
  budget_nft.mint(bn_genesis_ref(), bn_channel, bn_cb_hash, MintGenesis, bn_policy, tx)
}

test budget_nft_mint_wrong_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_nft_out_at(util.script_address(bn_cb_hash))],
      mint: bn_mint(bn_channel, 2),
    }
  budget_nft.mint(bn_genesis_ref(), bn_channel, bn_cb_hash, MintGenesis, bn_policy, tx)
}

test budget_nft_mint_wrong_name() fail {
  // mint name khác channel_id → quantity_of(channel_id)==0 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_nft_out_at(util.script_address(bn_cb_hash))],
      mint: bn_mint(#"9999", 1),
    }
  budget_nft.mint(bn_genesis_ref(), bn_channel, bn_cb_hash, MintGenesis, bn_policy, tx)
}

// VÁ Vector F (gốc) — NFT genesis gửi vào VÍ THƯỜNG thay vì channel_budget script.
// count_outputs_at_script_with_nft(cb_hash,...) == 0 (NFT ở vk_address) → reject. fail.
test budget_nft_mint_to_wallet_rejected() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_nft_out_at(util.vk_address(#"deadbeef"))],
      mint: bn_mint(bn_channel, 1),
    }
  budget_nft.mint(bn_genesis_ref(), bn_channel, bn_cb_hash, MintGenesis, bn_policy, tx)
}

// NFT genesis gửi vào 1 SCRIPT KHÁC (không phải channel_budget_hash) → reject. fail.
test budget_nft_mint_to_wrong_script_rejected() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bn_genesis_input()],
      outputs: [bn_nft_out_at(util.script_address(#"deadbeef"))],
      mint: bn_mint(bn_channel, 1),
    }
  budget_nft.mint(bn_genesis_ref(), bn_channel, bn_cb_hash, MintGenesis, bn_policy, tx)
}
