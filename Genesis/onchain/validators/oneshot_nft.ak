// oneshot_nft — minting policy ONE-SHOT DÙNG CHUNG cho MỌI marker NFT của Genesis.
//
// VÌ SAO CẦN: `lamp_mint` neo bốn thứ vào NFT — SupplyState (thread), registry, kho
// (A-DEST), meter (Reserve). Mọi bảo đảm của nó đều có dạng "đúng 1 NFT ⟺ đúng 1 bản
// chính danh". Câu đó CHỈ đúng nếu NFT không đúc thêm được. `thread_nft.ak` làm đúng
// điều đó nhưng ép cứng tên "SUPPLY" nên ba marker còn lại không dùng lại được — và
// thực tế mọi script deploy đang lấp chỗ trống bằng native-sig policy.
//
// Native-sig KHÔNG one-shot. Người cầm khoá đúc được NFT thứ hai bất cứ lúc nào:
//   • SUPPLY thứ 2  → dựng SupplyState mới dist_minted=0 → đúc lại TRỌN cap. Cap chết.
//   • KHO thứ 2     → A-DEST đọc hash kho từ ref input → trỏ về script của kẻ đúc.
//   • REG thứ 2     → tự viết authority cho chính mình.
//   • MET thứ 2     → mở nhánh ReserveDraw không qua script nhả.
// ⇒ "đúc trọn cap rồi cổng chết" KHÔNG đúng nếu marker không one-shot: cổng chết,
//   nhưng dựng được SupplyState mới thì mở lại được cổng khác y hệt.
//
// LUẬT: policy chạy được ⟺ tx CONSUME `genesis_ref`. Một UTxO tiêu ≤ 1 lần trong lịch
// sử chain ⇒ policy chạy ≤ 1 lần ⇒ đúc đúng 1 đơn vị `asset_name`, đúng MỘT lần, mãi mãi.
//
// `asset_name` là PARAM ⇒ cùng một `genesis_ref` sinh ra BỐN policy-id KHÁC NHAU cho bốn
// tên khác nhau, và cả bốn đúc gọn trong ĐÚNG một giao dịch (giao dịch tiêu genesis_ref).
// Không tốn thêm UTxO mồi, không thêm vòng phụ thuộc.
//
// KHÔNG burn (`else fail` + qty phải đúng 1): marker sống suốt vòng đời module.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction, placeholder}
use magiclamp/genesis/util

validator oneshot_nft(genesis_ref: OutputReference, asset_name: ByteArray) {
  mint(_r: Void, policy_id: PolicyId, tx: Transaction) {
    // ONE-SHOT: phải tiêu đúng UTxO genesis (một lần duy nhất trong lịch sử chain).
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // Đúng 1 asset name của policy này, qty đúng 1 — không hơn, không kém, không âm.
    expect util.policy_name_count(tx.mint, policy_id) == 1
    expect assets.quantity_of(tx.mint, policy_id, asset_name) == 1
    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"a11ce0"

const nm: ByteArray = #"4b484f"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"c0de", output_index: 2 }
}

fn spend_genesis() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      util.mk_input(
        g_ref(),
        util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
      ),
    ],
    mint: assets.zero |> assets.add(pol, nm, 1),
  }
}

test oneshot_happy() {
  oneshot_nft.mint(g_ref(), nm, Void, pol, spend_genesis())
}

// ── KHÔNG tiêu genesis_ref → không đúc được. Đây là toàn bộ tính one-shot. ──
test oneshot_without_genesis_input_fails() fail {
  let tx =
    Transaction {
      ..spend_genesis(),
      inputs: [
        util.mk_input(
          util.mk_ref(9),
          util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
        ),
      ],
    }
  oneshot_nft.mint(g_ref(), nm, Void, pol, tx)
}

// ── Đúc 2 đơn vị (thay vì 1) → reject. NFT phải là NFT thật. ──
test oneshot_qty_two_fails() fail {
  let tx = Transaction { ..spend_genesis(), mint: assets.zero |> assets.add(pol, nm, 2) }
  oneshot_nft.mint(g_ref(), nm, Void, pol, tx)
}

// ── Đúc kèm tên thứ hai cùng policy → reject (một policy một tên). ──
test oneshot_extra_name_fails() fail {
  let tx =
    Transaction {
      ..spend_genesis(),
      mint: assets.zero |> assets.add(pol, nm, 1) |> assets.add(pol, #"ffff", 1),
    }
  oneshot_nft.mint(g_ref(), nm, Void, pol, tx)
}

// ── Sai tên (đúc tên khác tên param) → reject. ──
test oneshot_wrong_name_fails() fail {
  let tx = Transaction { ..spend_genesis(), mint: assets.zero |> assets.add(pol, #"ffff", 1) }
  oneshot_nft.mint(g_ref(), nm, Void, pol, tx)
}

// ── Burn → nhánh else fail. Marker sống suốt vòng đời. ──
test oneshot_burn_fails() fail {
  let tx = Transaction { ..spend_genesis(), mint: assets.zero |> assets.add(pol, nm, -1) }
  oneshot_nft.mint(g_ref(), nm, Void, pol, tx)
}
