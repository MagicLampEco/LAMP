// ispo_nft — minting policy đúc POOL NFT (one-shot) + SLOT NFT (claim-slot).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO 1 POLICY 2 LOẠI TOKEN (POOL + SLOT)?
//   Pool validator (ispo_pool.ak) nhận diện chính nó qua "POOL NFT cùng
//   ispo_nft_policy", và ép Claim consume "SLOT NFT cùng ispo_nft_policy" từ
//   registry. Dùng CHUNG 1 policy id → pool chỉ cần 1 param `ispo_nft_policy`
//   (tính từ genesis_ref ở deploy). KHÔNG ôm script-hash chéo → KHÔNG vòng tròn.
//
// MintPool (one-shot, Constr 0):
//   - consume đúng genesis_ref (1 UTxO spend ≤ 1 lần → POOL NFT đúc ≤ 1).
//   - mint chứa ĐÚNG (POOL, +1), KHÔNG name lạ → supply POOL = 1 VĨNH VIỄN.
//
// MintSlots (lúc SetRoot, do pool ủy quyền, Constr 1):
//   - tx PHẢI có input mang POOL NFT (pool đang spend SetRoot) → pool validator
//     chạy + ép bộ slot đúng (mỗi name = marker_name(epoch,owner), qty +1, gửi
//     vào registry). Mint policy chỉ ủy quyền "có POOL input ⇒ tin pool kiểm
//     soát bộ slot". KHÔNG trùng kiểm name (pool ép).
//   - mọi name đúc qty > 0 (đúc, không burn); KHÔNG đụng POOL NFT.
//
// BurnSlot (lúc Claim, do pool ủy quyền, Constr 2):
//   - tx PHẢI có input mang POOL NFT (pool đang spend Claim) → pool ép đúng slot
//     (epoch,owner) bị burn. Không POOL input = không ai ủy quyền → reject.
//   - KHÔNG đụng POOL NFT (POOL bất biến, chỉ luân chuyển).
//
// CHỐNG DOUBLE-CLAIM (2 mức tin cậy): slot là UTxO ở registry; Claim consume +
// burn (qty −1). Spend-once của ledger eUTxO chặn claim-2 phía CLAIMER — độc lập
// indexer. NHƯNG MintSlots ở đây CHỈ đòi POOL input + qty>0, KHÔNG ép tên slot
// khớp epoch nào (tên là hash, không có preimage). ⇒ admin đủ ngưỡng tại SetRoot
// CÓ THỂ re-mint slot epoch cũ đã burn → mở lại double-claim. Slot-set integrity
// = ADMIN-THRESHOLD-TRUSTED, KHÔNG trustless tuyệt đối. Chi tiết + vì sao không
// siết rẻ on-chain: ispo_pool.ak §GIỚI HẠN.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/ispo/types.{
  BurnSlot, IspoNftRedeemer, MintPool, MintSlots, pool_nft_name,
}
use magiclamp/ispo/util

validator ispo_nft(genesis_ref: OutputReference) {
  mint(redeemer: IspoNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    let own_tokens = assets.tokens(tx.mint, policy_id)

    when redeemer is {
      // ── MintPool: one-shot POOL NFT ────────────────────────────────────
      MintPool -> {
        expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })
        // ĐÚNG 1 loại asset của policy này (POOL), qty +1. Chặn name lạ + chặn
        // đúc kèm SLOT trong tx deploy.
        expect dict.size(own_tokens) == 1
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 1
        True
      }

      // ── MintSlots: đúc bộ SLOT lúc SetRoot (pool ủy quyền) ──────────────
      MintSlots -> {
        // tx phải có input mang POOL NFT → pool đang spend SetRoot → pool ép
        // đúng bộ slot. Không POOL input = không ai ủy quyền → reject.
        expect util.count_inputs_with_nft(tx.inputs, policy_id, pool_nft_name) >= 1
        // KHÔNG đụng POOL NFT. Mọi slot đúc qty > 0 (chỉ đúc, không burn lẫn).
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 0
        expect
          list.all(
            dict.to_pairs(own_tokens),
            fn(p) {
              let Pair(_name, qty) = p
              qty > 0
            },
          )
        True
      }

      // ── BurnSlot: burn 1 SLOT lúc Claim (pool ủy quyền) ─────────────────
      BurnSlot -> {
        // tx phải có input mang POOL NFT → pool đang spend Claim → pool ép đúng
        // slot (epoch,owner) bị burn. Không POOL input = không ai ủy quyền.
        expect util.count_inputs_with_nft(tx.inputs, policy_id, pool_nft_name) >= 1
        // KHÔNG đụng POOL NFT (POOL chỉ luân chuyển, bất biến).
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
// Validator tests
// ══════════════════════════════════════════════════════════════

const in_policy: PolicyId = #"15f00d"

const slot_n: ByteArray = #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

const slot_n2: ByteArray = #"feedface00000000000000000000000000000000000000000000000000000000"

fn in_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 9 }
}

fn in_genesis_input() -> Input {
  util.mk_input(
    in_genesis_ref(),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

fn in_other_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

fn in_pool_input() -> Input {
  let v = assets.from_lovelace(5_000_000) |> assets.add(in_policy, pool_nft_name, 1)
  util.mk_input(util.mk_ref(1), util.mk_output_no_datum(util.vk_address(#"b0"), v))
}

fn in_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(in_policy, name, qty)
}

test mint_pool_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [in_other_input(), in_genesis_input()],
      mint: in_mint(pool_nft_name, 1),
    }
  ispo_nft.mint(in_genesis_ref(), MintPool, in_policy, tx)
}

test mint_pool_without_genesis() fail {
  let tx =
    Transaction { ..placeholder, inputs: [in_other_input()], mint: in_mint(pool_nft_name, 1) }
  ispo_nft.mint(in_genesis_ref(), MintPool, in_policy, tx)
}

test mint_pool_wrong_qty() fail {
  let tx =
    Transaction { ..placeholder, inputs: [in_genesis_input()], mint: in_mint(pool_nft_name, 2) }
  ispo_nft.mint(in_genesis_ref(), MintPool, in_policy, tx)
}

test mint_pool_with_extra_slot() fail {
  let mint =
    assets.zero
      |> assets.add(in_policy, pool_nft_name, 1)
      |> assets.add(in_policy, slot_n, 1)
  let tx = Transaction { ..placeholder, inputs: [in_genesis_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), MintPool, in_policy, tx)
}

// ── MintSlots (đúc bộ slot lúc SetRoot) ────────────────────────────

test mint_slots_happy() {
  // đúc 2 slot (bộ slot cho 2 owner), có POOL input → pass.
  let mint = assets.zero
    |> assets.add(in_policy, slot_n, 1)
    |> assets.add(in_policy, slot_n2, 1)
  let tx = Transaction { ..placeholder, inputs: [in_pool_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), MintSlots, in_policy, tx)
}

test mint_slots_requires_admin_via_pool() fail {
  // KHÔNG có POOL input → không ai ủy quyền (admin SetRoot vắng) → reject.
  let tx =
    Transaction { ..placeholder, inputs: [in_other_input()], mint: in_mint(slot_n, 1) }
  ispo_nft.mint(in_genesis_ref(), MintSlots, in_policy, tx)
}

test mint_slots_touches_pool_nft() fail {
  // mưu toan đúc kèm POOL NFT → reject (POOL bất biến).
  let mint =
    assets.zero
      |> assets.add(in_policy, slot_n, 1)
      |> assets.add(in_policy, pool_nft_name, 1)
  let tx = Transaction { ..placeholder, inputs: [in_pool_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), MintSlots, in_policy, tx)
}

test mint_slots_negative_qty_rejected() fail {
  // MintSlots mà 1 name qty < 0 (lén burn) → reject (chỉ đúc, qty > 0).
  let mint = assets.zero
    |> assets.add(in_policy, slot_n, 1)
    |> assets.add(in_policy, slot_n2, -1)
  let tx = Transaction { ..placeholder, inputs: [in_pool_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), MintSlots, in_policy, tx)
}

// ── BurnSlot (burn 1 slot lúc Claim) ───────────────────────────────

test burn_slot_happy() {
  // burn 1 slot (−1), có POOL input → pass.
  let tx =
    Transaction { ..placeholder, inputs: [in_pool_input()], mint: in_mint(slot_n, -1) }
  ispo_nft.mint(in_genesis_ref(), BurnSlot, in_policy, tx)
}

test burn_slot_requires_pool_input() fail {
  // KHÔNG có POOL input → không ai ủy quyền → reject.
  let tx =
    Transaction { ..placeholder, inputs: [in_other_input()], mint: in_mint(slot_n, -1) }
  ispo_nft.mint(in_genesis_ref(), BurnSlot, in_policy, tx)
}

test burn_slot_touches_pool_nft() fail {
  // burn slot mà đụng POOL NFT → reject (POOL bất biến).
  let mint =
    assets.zero
      |> assets.add(in_policy, slot_n, -1)
      |> assets.add(in_policy, pool_nft_name, 1)
  let tx = Transaction { ..placeholder, inputs: [in_pool_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), BurnSlot, in_policy, tx)
}
