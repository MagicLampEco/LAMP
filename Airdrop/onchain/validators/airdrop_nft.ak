// airdrop_nft — minting policy đúc POOL NFT (one-shot) + CLAIM marker (per-leaf).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO 1 POLICY 2 LOẠI TOKEN (POOL + CLAIM)?
//   Pool validator nhận diện chính nó qua "POOL NFT cùng airdrop_nft_policy".
//   Pool ép mỗi Claim đúc 1 CLAIM marker (name = leaf). Dùng CHUNG 1 policy id →
//   pool chỉ cần 1 param `airdrop_nft_policy` (tính từ genesis_ref ở deploy).
//   KHÔNG hash-param chéo → KHÔNG vòng tròn (bài học Faucet/Allocation).
//
// MintPool (one-shot):
//   - consume đúng genesis_ref (1 UTxO spend ≤ 1 lần → POOL NFT đúc ≤ 1).
//   - mint chứa ĐÚNG (POOL, +1), KHÔNG name lạ → supply POOL = 1 VĨNH VIỄN.
//
// MintClaim (mỗi Claim, do pool ủy quyền):
//   - tx PHẢI có input mang POOL NFT (pool đang spend) → pool validator chạy →
//     pool đã kiểm Merkle proof + leaf. Marker policy chỉ ủy quyền + ép cấu trúc:
//       · đúng 1 loại asset của policy này được mint (CLAIM, KHÔNG kèm POOL).
//       · KHÔNG đụng POOL NFT (qty POOL trong mint == 0 → pool NFT bất biến).
//   - KHÔNG tự kiểm leaf==name ở đây (pool ép name=leaf qua marker_dest output) →
//     tách quan tâm, không trùng kiểm. Marker policy = "có POOL input ⇒ tin pool".

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/airdrop/ledger.{
  AirdropNftRedeemer, MintClaim, MintPool, pool_nft_name,
}
use magiclamp/airdrop/util

validator airdrop_nft(genesis_ref: OutputReference) {
  mint(redeemer: AirdropNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    let own_tokens = assets.tokens(tx.mint, policy_id)

    when redeemer is {
      // ── MintPool: one-shot POOL NFT ────────────────────────────────────
      MintPool -> {
        expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })
        // ĐÚNG 1 loại asset của policy này (POOL), qty +1. Chặn name lạ + chặn
        // đúc kèm CLAIM trong cùng tx deploy.
        expect dict.size(own_tokens) == 1
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 1
        True
      }

      // ── MintClaim: ủy quyền cho pool validator ─────────────────────────
      MintClaim -> {
        // tx phải có input mang POOL NFT → pool đang spend → pool validator đã
        // chạy + kiểm proof. Không POOL input = không ai ủy quyền → reject.
        expect
          util.count_inputs_with_nft(tx.inputs, policy_id, pool_nft_name) >= 1
        // KHÔNG đụng POOL NFT (pool NFT chỉ luân chuyển, bất biến).
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 0
        // Đúng 1 loại asset của policy này được mint (CLAIM marker đơn) — chặn
        // đúc nhiều marker lạ chen vào 1 tx (pool ép name=leaf + qty=1).
        expect dict.size(own_tokens) == 1
        True
      }
    }
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const an_policy: PolicyId = #"facef00d"

const an_claim_name: ByteArray = #"abcdef01"

fn an_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 5 }
}

fn an_genesis_input() -> Input {
  util.mk_input(
    an_genesis_ref(),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

fn an_other_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

/// Input mang POOL NFT (pool đang spend).
fn an_pool_input() -> Input {
  let v =
    assets.from_lovelace(5_000_000) |> assets.add(an_policy, pool_nft_name, 1)
  util.mk_input(
    util.mk_ref(1),
    util.mk_output_no_datum(util.vk_address(#"b0"), v),
  )
}

fn an_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(an_policy, name, qty)
}

test an_mint_pool_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_other_input(), an_genesis_input()],
      mint: an_mint(pool_nft_name, 1),
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test an_mint_pool_without_genesis() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_other_input()],
      mint: an_mint(pool_nft_name, 1),
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test an_mint_pool_wrong_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_genesis_input()],
      mint: an_mint(pool_nft_name, 2),
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test an_mint_claim_happy() {
  // có POOL NFT input → đúc CLAIM marker +1 hợp lệ.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_pool_input()],
      mint: an_mint(an_claim_name, 1),
    }
  airdrop_nft.mint(an_genesis_ref(), MintClaim, an_policy, tx)
}

test an_mint_claim_no_pool_input() fail {
  // đúc CLAIM mà KHÔNG có POOL NFT input → không ai ủy quyền → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_other_input()],
      mint: an_mint(an_claim_name, 1),
    }
  airdrop_nft.mint(an_genesis_ref(), MintClaim, an_policy, tx)
}

test an_mint_claim_touches_pool_nft() fail {
  // mưu toan đúc thêm POOL NFT qua MintClaim → quantity_of(POOL)≠0 → reject.
  let mint =
    assets.zero
      |> assets.add(an_policy, an_claim_name, 1)
      |> assets.add(an_policy, pool_nft_name, 1)
  let tx =
    Transaction { ..placeholder, inputs: [an_pool_input()], mint: mint }
  airdrop_nft.mint(an_genesis_ref(), MintClaim, an_policy, tx)
}
