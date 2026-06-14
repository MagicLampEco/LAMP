// faucet_nft — minting policy đúc POOL NFT (one-shot) + ACCT NFT (theo claim).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO 1 POLICY 2 LOẠI TOKEN (POOL + ACCT)?
//   Pool validator nhận diện account qua "ACCT NFT cùng faucet_nft_policy".
//   Account validator nhận diện pool qua "POOL NFT cùng faucet_nft_policy".
//   Dùng CHUNG 1 policy id → cả hai chỉ cần 1 param `faucet_nft_policy` (tính từ
//   genesis_ref ở deploy). KHÔNG bên nào ôm script-hash bên kia → KHÔNG vòng tròn.
//
// MintPool (one-shot):
//   - consume đúng genesis_ref (1 UTxO spend tối đa 1 lần → pool NFT đúc tối đa 1).
//   - mint chứa ĐÚNG (POOL, +1), KHÔNG kèm ACCT, KHÔNG name lạ → supply POOL = 1.
//
// MintAccount (mỗi Claim/Reclaim do pool ủy quyền):
//   - tx PHẢI có input mang POOL NFT (pool đang được spend trong cùng tx). Pool
//     validator (faucet_pool.ak) mới là nơi ép drip/cooldown/cấu trúc account.
//     Mint policy chỉ ủy quyền: "có POOL NFT input ⇒ pool validator đã chạy ⇒
//     tin pool kiểm soát số lượng ACCT". Tách quan tâm, KHÔNG trùng kiểm.
//   - mint chỉ chứa asset của loại ACCT (KHÔNG đụng POOL NFT — pool NFT bất biến,
//     chỉ luân chuyển, không mint/burn thêm).

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/faucet/ledger.{
  FaucetNftRedeemer, MintAccount, MintPool, acct_nft_name, pool_nft_name,
}
use magiclamp/faucet/util

validator faucet_nft(genesis_ref: OutputReference) {
  mint(redeemer: FaucetNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    let own_tokens = assets.tokens(tx.mint, policy_id)

    when redeemer is {
      // ── MintPool: one-shot POOL NFT ────────────────────────────────────
      MintPool -> {
        // one-shot: consume genesis_ref → policy chạy tối đa 1 lần.
        expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })
        // ĐÚNG 1 loại asset của policy này (POOL), qty +1. Chặn name lạ + chặn
        // đúc kèm ACCT trong cùng tx deploy.
        expect dict.size(own_tokens) == 1
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 1
        True
      }

      // ── MintAccount: ủy quyền cho pool validator ───────────────────────
      MintAccount -> {
        // tx phải có input mang POOL NFT → pool đang được spend → pool validator
        // đã chạy và kiểm soát toàn bộ ràng buộc account. Không có POOL input =
        // không ai ủy quyền → reject (chống đúc ACCT lậu ngoài faucet flow).
        expect util.count_inputs_with_nft(tx.inputs, policy_id, pool_nft_name) >= 1
        // KHÔNG đụng POOL NFT trong mint (pool NFT chỉ luân chuyển, bất biến).
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 0
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

const fn_policy: PolicyId = #"facef00d"

fn fn_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 5 }
}

fn fn_genesis_input() -> Input {
  util.mk_input(
    fn_genesis_ref(),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

fn fn_other_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

/// Input mang POOL NFT (pool đang spend).
fn fn_pool_input() -> Input {
  let v = assets.from_lovelace(5_000_000) |> assets.add(fn_policy, pool_nft_name, 1)
  util.mk_input(util.mk_ref(1), util.mk_output_no_datum(util.vk_address(#"b0"), v))
}

fn fn_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(fn_policy, name, qty)
}

test mint_pool_happy() {
  // consume genesis + mint đúng (POOL,1) → pass.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_other_input(), fn_genesis_input()],
      mint: fn_mint(pool_nft_name, 1),
    }
  faucet_nft.mint(fn_genesis_ref(), MintPool, fn_policy, tx)
}

test mint_pool_without_genesis() fail {
  // KHÔNG consume genesis → one-shot reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_other_input()],
      mint: fn_mint(pool_nft_name, 1),
    }
  faucet_nft.mint(fn_genesis_ref(), MintPool, fn_policy, tx)
}

test mint_pool_wrong_qty() fail {
  // mint 2 POOL → reject (one-shot supply = 1).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_genesis_input()],
      mint: fn_mint(pool_nft_name, 2),
    }
  faucet_nft.mint(fn_genesis_ref(), MintPool, fn_policy, tx)
}

test mint_pool_with_extra_acct() fail {
  // deploy mà đúc kèm ACCT → dict.size == 2 → reject.
  let mint =
    assets.zero
      |> assets.add(fn_policy, pool_nft_name, 1)
      |> assets.add(fn_policy, acct_nft_name, 1)
  let tx =
    Transaction { ..placeholder, inputs: [fn_genesis_input()], mint: mint }
  faucet_nft.mint(fn_genesis_ref(), MintPool, fn_policy, tx)
}

test mint_account_happy() {
  // có POOL NFT input → đúc ACCT +1 hợp lệ.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_pool_input()],
      mint: fn_mint(acct_nft_name, 1),
    }
  faucet_nft.mint(fn_genesis_ref(), MintAccount, fn_policy, tx)
}

test mint_account_no_pool_input() fail {
  // đúc ACCT mà KHÔNG có POOL NFT input → không ai ủy quyền → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fn_other_input()],
      mint: fn_mint(acct_nft_name, 1),
    }
  faucet_nft.mint(fn_genesis_ref(), MintAccount, fn_policy, tx)
}

test mint_account_touches_pool_nft() fail {
  // mưu toan đúc thêm POOL NFT qua MintAccount → quantity_of(POOL)≠0 → reject.
  let mint =
    assets.zero
      |> assets.add(fn_policy, acct_nft_name, 1)
      |> assets.add(fn_policy, pool_nft_name, 1)
  let tx =
    Transaction { ..placeholder, inputs: [fn_pool_input()], mint: mint }
  faucet_nft.mint(fn_genesis_ref(), MintAccount, fn_policy, tx)
}
