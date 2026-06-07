// Proposal authenticity NFT — minting policy ONE-SHOT (mẫu Distribution beacon_nft.ak).
//
// Proposal UTxO cần đúng 1 authenticity NFT để chống datum hijacking: kẻ tấn công
// có thể tạo UTxO giả tại cùng Proposal address với ProposalResult bịa (vd status
// = Executed), nhưng KHÔNG mint được NFT này → Treasury Release (đọc qua reference
// input) chỉ tin UTxO MANG NFT (release.read_proposal: expect dict.size==1, qty==1).
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi 1 genesis OutputReference + asset name cố định. Mint
//   chỉ hợp lệ khi tx CONSUME đúng UTxO genesis đó. 1 UTxO spend được 1 lần trong
//   lịch sử chain → policy chạy đúng 1 lần → supply 1 NFT cố định, KHÔNG re-mint.
//
// BURN — CẤM hoàn toàn (else fail): NFT authenticity sống suốt vòng đời proposal;
// burn được = phá tính xác thực → Treasury có thể bị lừa. One-shot + cấm burn =
// supply BẤT BIẾN tuyệt đối (đúng 1, mãi mãi).

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}

pub type ProposalNftRedeemer {
  MintProposal
}

validator proposal_nft(genesis_ref: OutputReference, asset_name: ByteArray) {
  mint(_redeemer: ProposalNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: consume đúng UTxO genesis ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, asset_name cố định, qty +1 ──
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect assets.quantity_of(tx.mint, policy_id, asset_name) == 1

    True
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════
// Tests (mock Transaction)
// ════════════════════════════════════════════════════════════

const np_policy: PolicyId = #"9901"

const np_name: ByteArray = #"50524f50"

fn np_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 3 }
}

fn vk_addr() -> Address {
  Address { payment_credential: VerificationKey(#"a0"), stake_credential: None }
}

fn np_genesis_input() -> Input {
  Input {
    output_reference: np_genesis_ref(),
    output: Output {
      address: vk_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn np_other_input() -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"00", output_index: 0 },
    output: Output {
      address: vk_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

test pnft_mint_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [np_other_input(), np_genesis_input()],
      mint: assets.zero |> assets.add(np_policy, np_name, 1),
    }
  proposal_nft.mint(np_genesis_ref(), np_name, MintProposal, np_policy, tx)
}

test pnft_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [np_other_input()],
      mint: assets.zero |> assets.add(np_policy, np_name, 1),
    }
  proposal_nft.mint(np_genesis_ref(), np_name, MintProposal, np_policy, tx)
}

test pnft_wrong_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [np_genesis_input()],
      mint: assets.zero |> assets.add(np_policy, np_name, 2),
    }
  proposal_nft.mint(np_genesis_ref(), np_name, MintProposal, np_policy, tx)
}
