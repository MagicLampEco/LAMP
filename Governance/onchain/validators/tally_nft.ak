// Tally accumulator authenticity NFT — minting policy ONE-SHOT (mẫu proposal_nft.ak).
//
// Tally UTxO cần đúng 1 authenticity NFT để chống datum hijacking: kẻ tấn công có thể
// mint một token tally_policy "mồ côi" tại địa chỉ bất kỳ mang TallyDatum bịa (phase
// Clamped, yes_power_eff khổng lồ, yes_voters_acc ≥ F) rồi cho Proposal.ExecuteProposal
// tham chiếu → Executed → Treasury chi tiền (audit GAME-1 #2). Policy này ép Tally NFT
// là DUY NHẤT/one-shot, gắn cứng vào genesis của Tally accumulator. Kết hợp với
// proposal.read_tally (kiểm ref input PHẢI nằm tại tally_script_hash đã biết), power_eff
// có gốc tin cậy: chỉ Tally validator (clamp_consistent, monotone) mới sinh được state.
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi 1 genesis OutputReference + asset name cố định. Mint chỉ
//   hợp lệ khi tx CONSUME đúng UTxO genesis đó. 1 UTxO spend được 1 lần trong lịch sử
//   chain → policy chạy đúng 1 lần → supply 1 NFT cố định, KHÔNG re-mint.
//
// BURN — CẤM hoàn toàn (else fail): NFT authenticity sống suốt vòng đời Tally; burn
// được = phá tính xác thực → ExecuteProposal có thể bị lừa. One-shot + cấm burn =
// supply BẤT BIẾN tuyệt đối (đúng 1, mãi mãi).

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}

pub type TallyNftRedeemer {
  MintTally
}

validator tally_nft(genesis_ref: OutputReference, asset_name: ByteArray) {
  mint(_redeemer: TallyNftRedeemer, policy_id: PolicyId, tx: Transaction) {
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

const tn_policy: PolicyId = #"7a11"

const tn_name: ByteArray = #"54414c4c59"

fn tn_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 5 }
}

fn vk_addr() -> Address {
  Address { payment_credential: VerificationKey(#"a0"), stake_credential: None }
}

fn tn_genesis_input() -> Input {
  Input {
    output_reference: tn_genesis_ref(),
    output: Output {
      address: vk_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn tn_other_input() -> Input {
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

test tnft_mint_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tn_other_input(), tn_genesis_input()],
      mint: assets.zero |> assets.add(tn_policy, tn_name, 1),
    }
  tally_nft.mint(tn_genesis_ref(), tn_name, MintTally, tn_policy, tx)
}

test tnft_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tn_other_input()],
      mint: assets.zero |> assets.add(tn_policy, tn_name, 1),
    }
  tally_nft.mint(tn_genesis_ref(), tn_name, MintTally, tn_policy, tx)
}

test tnft_wrong_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tn_genesis_input()],
      mint: assets.zero |> assets.add(tn_policy, tn_name, 2),
    }
  tally_nft.mint(tn_genesis_ref(), tn_name, MintTally, tn_policy, tx)
}
