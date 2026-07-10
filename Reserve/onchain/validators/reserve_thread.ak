// reserve_thread — minting policy ONE-SHOT cho reserve thread NFT (ghim ReserveState).
//
// FIRST-PRINCIPLES — one-shot ⇒ reserve thread NFT DUY NHẤT:
//   Policy param = genesis_ref (OutputReference). Mint hợp lệ chỉ khi tx CONSUME
//   đúng UTxO genesis đó. 1 UTxO spend ≤ 1 lần trong lịch sử chain → policy chạy
//   ≤ 1 lần → đúc đúng 1 (RESERVE_THREAD,+1) đúng MỘT lần → KHÔNG thể tạo reserve
//   thread NFT thứ 2 → KHÔNG thể dựng ReserveState giả. Bất biến mạnh nhất, không
//   cần state.
//
// VÌ SAO cần policy này (audit — meter gap): Genesis route ReserveDraw đếm "input
// mang meter NFT". Orchestrator chốt meter_nft = reserve_thread. Trước đây
// reserve_thread_policy chỉ ĐƯỢC THAM CHIẾU (reserve_draw param) mà KHÔNG có policy
// thật → tính one-shot CHƯA tồn tại → có thể đúc nhiều reserve thread NFT → nhiều
// ReserveState giả → "input mang meter NFT" KHÔNG chắc là ReserveState tại
// reserve_draw → có thể né reserve_draw. Policy one-shot DUY NHẤT đóng kẽ này:
// chỉ 1 reserve thread NFT tồn tại ⟹ "input mang meter NFT" CHẮC CHẮN là
// ReserveState tại reserve_draw ⟹ ép reserve_draw chạy. KHÔNG cần sửa Genesis.
//
// MINT shape: đúng 1 asset name (reserve_thread_name), qty == 1, KHÔNG name lạ cùng
// policy. KHÔNG burn (else fail) → reserve thread NFT BẤT BIẾN suốt vòng đời module.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/assets
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/reserve/types.{MintReserveThread, ReserveThreadRedeemer}
use magiclamp/reserve/util

validator reserve_thread(
  genesis_ref         : OutputReference,
  reserve_thread_name : ByteArray,
) {
  mint(_r: ReserveThreadRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: consume genesis_ref (1 lần DUY NHẤT trong lịch sử chain) ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Đúng 1 asset name của policy này (chống đúc kèm name lạ cùng policy) ──
    expect util.policy_name_count(tx.mint, policy_id) == 1

    // ── Đúc đúng 1 reserve thread NFT (qty == 1; loại burn qty<0 và bội số) ──
    expect assets.quantity_of(tx.mint, policy_id, reserve_thread_name) == 1

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — happy + NEGATIVE (≥4)
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"5544"

const thr_nm: ByteArray = #"524553"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 3 }
}

fn g_input() -> Input {
  util.mk_input(
    g_ref(),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

fn other_input() -> Input {
  util.mk_input(
    util.mk_ref(9),
    util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
  )
}

fn mint_thread(qty: Int) {
  assets.zero |> assets.add(pol, thr_nm, qty)
}

fn run_mint(tx: Transaction) -> Bool {
  reserve_thread.mint(g_ref(), thr_nm, MintReserveThread, pol, tx)
}

test thread_oneshot_happy() {
  // consume genesis_ref + đúc đúng 1 reserve thread NFT → hợp lệ.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [other_input(), g_input()],
      mint: mint_thread(1),
    }
  run_mint(tx)
}

test reject_without_genesis() fail {
  // KHÔNG consume genesis → one-shot reject (không đúc thread NFT tùy tiện).
  let tx = Transaction { ..placeholder, inputs: [other_input()], mint: mint_thread(1) }
  run_mint(tx)
}

test reject_mint_two() fail {
  // đúc qty 2 → ≠ 1 → reject (không 2 reserve thread NFT cùng tx).
  let tx = Transaction { ..placeholder, inputs: [g_input()], mint: mint_thread(2) }
  run_mint(tx)
}

test reject_burn() fail {
  // qty -1 (burn) → ≠ 1 → reject (NFT bất biến, no-burn).
  let tx = Transaction { ..placeholder, inputs: [g_input()], mint: mint_thread(-1) }
  run_mint(tx)
}

test reject_extra_name() fail {
  // thêm asset name lạ cùng policy → policy_name_count ≠ 1 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_thread(1) |> assets.add(pol, #"9999", 1),
    }
  run_mint(tx)
}
