// ispo_nft — minting policy đúc POOL NFT (one-shot) + MARKER NFT (mỗi Claim).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO 1 POLICY 2 LOẠI TOKEN (POOL + MARKER)?
//   Pool validator (ispo_pool.ak) nhận diện chính nó qua "POOL NFT cùng
//   ispo_nft_policy", và ép Claim đúc đúng "MARKER NFT cùng ispo_nft_policy".
//   Dùng CHUNG 1 policy id → pool chỉ cần 1 param `ispo_nft_policy` (tính từ
//   genesis_ref ở deploy). KHÔNG ôm script-hash chéo → KHÔNG vòng tròn.
//
// MintPool (one-shot):
//   - consume đúng genesis_ref (1 UTxO spend ≤ 1 lần → POOL NFT đúc ≤ 1).
//   - mint chứa ĐÚNG (POOL, +1), KHÔNG name lạ → supply POOL = 1 VĨNH VIỄN.
//
// MintMarker (mỗi Claim, do pool ủy quyền):
//   - tx PHẢI có input mang POOL NFT (pool đang spend) → pool validator chạy →
//     pool ép marker_name = blake2b_256(epoch||owner) + qty đúng. Mint policy chỉ
//     ủy quyền "có POOL input ⇒ tin pool kiểm soát marker". KHÔNG trùng kiểm name.
//   - KHÔNG đụng POOL NFT (POOL bất biến, chỉ luân chuyển).
//
// CHỐNG DOUBLE-CLAIM: marker_name là hàm thuần (epoch, owner). Đúc marker lần 2
// cho cùng (epoch,owner) = đúc trùng asset name. UTxO mang marker cũ vẫn tồn tại
// → tx claim-2 tạo asset (policy, name) thứ 2; pool ép +1 mỗi Claim nhưng KHÔNG
// thể ngăn tồn tại 2 UTxO cùng marker. Bù lại: pool ép Claim đúc ĐÚNG 1 marker
// MỚI và marker phải về địa chỉ owner → claim-2 vẫn đúc được, NHƯNG xem ispo_pool:
// marker được giữ ở 1 marker-registry script ép unique. → Mô hình ở đây: marker
// đi kèm output owner; chống double-claim THỰC THI ở ispo_pool bằng cách BẮT marker
// đúng tên + qty=1 và (tuỳ chọn) registry. Tài liệu chi tiết: ispo_pool.ak.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/ispo/types.{IspoNftRedeemer, MintMarker, MintPool, pool_nft_name}
use magiclamp/ispo/util

validator ispo_nft(genesis_ref: OutputReference) {
  mint(redeemer: IspoNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    let own_tokens = assets.tokens(tx.mint, policy_id)

    when redeemer is {
      // ── MintPool: one-shot POOL NFT ────────────────────────────────────
      MintPool -> {
        expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })
        // ĐÚNG 1 loại asset của policy này (POOL), qty +1. Chặn name lạ + chặn
        // đúc kèm MARKER trong tx deploy.
        expect dict.size(own_tokens) == 1
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 1
        True
      }

      // ── MintMarker: ủy quyền cho pool validator ────────────────────────
      MintMarker -> {
        // tx phải có input mang POOL NFT → pool đang spend → pool validator chạy
        // và ép marker_name + qty. Không POOL input = không ai ủy quyền → reject.
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

const marker_n: ByteArray = #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

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

test mint_pool_with_extra_marker() fail {
  let mint =
    assets.zero
      |> assets.add(in_policy, pool_nft_name, 1)
      |> assets.add(in_policy, marker_n, 1)
  let tx = Transaction { ..placeholder, inputs: [in_genesis_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), MintPool, in_policy, tx)
}

test mint_marker_happy() {
  let tx =
    Transaction { ..placeholder, inputs: [in_pool_input()], mint: in_mint(marker_n, 1) }
  ispo_nft.mint(in_genesis_ref(), MintMarker, in_policy, tx)
}

test mint_marker_no_pool_input() fail {
  let tx =
    Transaction { ..placeholder, inputs: [in_other_input()], mint: in_mint(marker_n, 1) }
  ispo_nft.mint(in_genesis_ref(), MintMarker, in_policy, tx)
}

test mint_marker_touches_pool_nft() fail {
  let mint =
    assets.zero
      |> assets.add(in_policy, marker_n, 1)
      |> assets.add(in_policy, pool_nft_name, 1)
  let tx = Transaction { ..placeholder, inputs: [in_pool_input()], mint: mint }
  ispo_nft.mint(in_genesis_ref(), MintMarker, in_policy, tx)
}
