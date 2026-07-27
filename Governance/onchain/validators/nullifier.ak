// Nullifier minting policy — chống double-vote (mẫu B, TECH §6).
//
// "1 DID = 1 phiếu/proposal" thực thi bằng token nullifier SỐNG trong cửa sổ vote:
//   asset name = blake2b_256(did_commit ‖ proposal_id).
// MINT (CastVote): đúng 1 token, name = hash(did‖proposal_id), qty +1 → trong cửa sổ vote
//   (policy,name) là DUY NHẤT ĐANG-SỐNG → mint trùng cùng (DID,proposal) thất bại.
// BURN (BurnNullifier — Finding 3): cho phép đốt nullifier KHI gộp phiếu vào Tally, để
//   one-shot hoá việc cộng power: nullifier tiêu đúng 1 lần ↔ phiếu cộng đúng 1 lần,
//   KHÔNG cộng cùng phiếu 2 lần qua nhiều SumBatch. Burn CHỈ hợp lệ khi tx CŨNG tiêu
//   Tally accumulator (mang tally_policy NFT trong input) — Tally validator ràng kế toán
//   power_raw/voter khớp số nullifier đốt. Ngoài bối cảnh Tally → cấm đốt (chống phá phiếu).
//
// did_commit + proposal_id truyền qua redeemer để policy tái dựng name (KHÔNG tin name
// off-chain mớm) khi MINT. Khi BURN, policy chỉ chốt: mọi token policy này trong mint đều
// qty −1 (đốt thuần) + có Tally NFT bị tiêu (kế toán Tally chịu trách nhiệm đúng phiếu).

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Transaction, placeholder}
use magiclamp/governance/util

pub type NullifierRedeemer {
  MintNullifier { did_commit: ByteArray, proposal_id: ByteArray }
  // Finding 3: đốt nullifier khi gộp phiếu vào Tally (one-shot). tally_policy: NFT acc.
  BurnNullifier
}

/// name nullifier canonical = blake2b_256(did_commit ‖ proposal_id).
pub fn nullifier_name(
  did_commit: ByteArray,
  proposal_id: ByteArray,
) -> ByteArray {
  crypto.blake2b_256(bytearray.concat(did_commit, proposal_id))
}

/// Có input nào mang ≥ 1 token tally_policy không (Tally accumulator bị tiêu trong tx)?
fn tally_spent(inputs: List<Input>, tally_policy: PolicyId) -> Bool {
  list.any(
    inputs,
    fn(i) { dict.size(assets.tokens(i.output.value, tally_policy)) >= 1 },
  )
}

validator nullifier(tally_policy: PolicyId) {
  mint(redeemer: NullifierRedeemer, policy_id: PolicyId, tx: Transaction) {
    let own_tokens = assets.tokens(tx.mint, policy_id)
    when redeemer is {
      MintNullifier { did_commit, proposal_id } -> {
        // name PHẢI = hash(did‖proposal_id) — policy tự dựng, không tin off-chain.
        let want_name = nullifier_name(did_commit, proposal_id)
        // Đúng 1 token của policy này, qty +1 (mint, KHÔNG burn — qty âm bị chặn).
        expect dict.size(own_tokens) == 1
        expect assets.quantity_of(tx.mint, policy_id, want_name) == 1
        True
      }
      // ── BurnNullifier: gộp phiếu vào Tally (Finding 3). MỌI token policy này trong mint
      //    PHẢI qty −1 (đốt thuần, không lén mint) + Tally NFT bị tiêu (kế toán Tally) ──
      BurnNullifier -> {
        expect tally_spent(tx.inputs, tally_policy)
        // mọi token policy này trong tx.mint đều qty == −1 (chỉ đốt, không mint kèm).
        list.all(dict.to_pairs(own_tokens), fn(p) { p.2nd == -1 })
      }
    }
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

const nl_policy: PolicyId = #"7777"

const tally_policy: PolicyId = #"7a11"

const tally_sh: ByteArray = #"7a"

fn nl_did() -> ByteArray {
  #"11"
}

fn nl_prop() -> ByteArray {
  #"22"
}

test nullifier_mint_happy() {
  let name = nullifier_name(nl_did(), nl_prop())
  let tx =
    Transaction {
      ..placeholder,
      mint: assets.zero |> assets.add(nl_policy, name, 1),
    }
  nullifier.mint(
    tally_policy,
    MintNullifier { did_commit: nl_did(), proposal_id: nl_prop() },
    nl_policy,
    tx,
  )
}

test nullifier_wrong_name_fails() fail {
  // mint token tên KHÔNG khớp hash → fail (qty_of want_name == 0 ≠ 1).
  let tx =
    Transaction {
      ..placeholder,
      mint: assets.zero |> assets.add(nl_policy, #"deadbeef", 1),
    }
  nullifier.mint(
    tally_policy,
    MintNullifier { did_commit: nl_did(), proposal_id: nl_prop() },
    nl_policy,
    tx,
  )
}

test nullifier_mint_path_burn_rejected() fail {
  // qty −1 với redeemer MINT → fail (qty_of want_name == −1 ≠ 1).
  let name = nullifier_name(nl_did(), nl_prop())
  let tx =
    Transaction {
      ..placeholder,
      mint: assets.zero |> assets.add(nl_policy, name, -1),
    }
  nullifier.mint(
    tally_policy,
    MintNullifier { did_commit: nl_did(), proposal_id: nl_prop() },
    nl_policy,
    tx,
  )
}

test nullifier_extra_token_rejected() fail {
  // mint 2 asset name khác nhau → dict.size==2 ≠ 1 → fail (đường MINT).
  let name = nullifier_name(nl_did(), nl_prop())
  let tx =
    Transaction {
      ..placeholder,
      mint: assets.zero
        |> assets.add(nl_policy, name, 1)
        |> assets.add(nl_policy, #"99", 1),
    }
  nullifier.mint(
    tally_policy,
    MintNullifier { did_commit: nl_did(), proposal_id: nl_prop() },
    nl_policy,
    tx,
  )
}

// ── BurnNullifier happy: đốt nullifier (qty −1) + Tally NFT bị tiêu trong input ──
fn tally_input() -> Input {
  let val =
    assets.from_lovelace(2_000_000) |> assets.add(tally_policy, #"01", 1)
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(tally_sh), val, 0),
  )
}

test nullifier_burn_happy() {
  let name = nullifier_name(nl_did(), nl_prop())
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input()],
      mint: assets.zero |> assets.add(nl_policy, name, -1),
    }
  nullifier.mint(tally_policy, BurnNullifier, nl_policy, tx)
}

test nullifier_burn_without_tally_rejected() fail {
  // đốt nullifier nhưng KHÔNG có Tally NFT bị tiêu → tally_spent False → fail (chống phá phiếu).
  let name = nullifier_name(nl_did(), nl_prop())
  let tx =
    Transaction {
      ..placeholder,
      mint: assets.zero |> assets.add(nl_policy, name, -1),
    }
  expect nullifier.mint(tally_policy, BurnNullifier, nl_policy, tx)
  True
}

test nullifier_burn_sneaky_mint_rejected() fail {
  // BurnNullifier nhưng lén mint 1 token mới (qty +1) cùng policy → all qty==−1 False → fail.
  let name = nullifier_name(nl_did(), nl_prop())
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_input()],
      mint: assets.zero
        |> assets.add(nl_policy, name, -1)
        |> assets.add(nl_policy, #"abcd", 1),
    }
  expect nullifier.mint(tally_policy, BurnNullifier, nl_policy, tx)
  True
}
