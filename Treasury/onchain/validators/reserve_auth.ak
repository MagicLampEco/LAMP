// reserve_auth — minting policy ONE-SHOT cho Treasury "kéo" Reserve (Treasury-pull).
//
// VAI TRÒ (cầu Reserve↔Treasury): reserve_draw.ak (module Reserve) chỉ nhả khi tx có
// 1 input mang NFT (treasury_auth_policy, treasury_auth_name) qty ≥ 1 — bằng chứng
// "Treasury chủ động kéo". NFT đó ĐÍCH THỊ là token policy NÀY đúc. reserve_draw KHÔNG
// biết logic sàn (parked < floor); ràng buộc sàn nằm ở reserve_gate.ak — validator giữ
// auth NFT này và chỉ cho spend khi Treasury parked < floor. Vì auth NFT bị KHÓA tại
// reserve_gate, mọi lần nó thành input đều đã qua kiểm sàn → Reserve nhả CHỈ khi dưới sàn.
//
// FIRST-PRINCIPLES — one-shot (mirror custody_seed.ak / thread_nft.ak):
//   Policy param = genesis_ref (OutputReference) + auth_name (ByteArray). Mint hợp lệ chỉ
//   khi tx CONSUME đúng UTxO genesis đó. 1 UTxO spend ≤ 1 lần trong lịch sử chain → policy
//   chạy ≤ 1 lần → đúc đúng 1 (auth_name, +1) đúng MỘT lần → KHÔNG thể tạo auth NFT thứ 2
//   → KHÔNG thể giả "Treasury-pull" để vắt Reserve. Đây là credential DUY NHẤT, BẤT BIẾN.
//
// MINT shape: đúng 1 asset name (auth_name) của policy này, qty == 1. KHÔNG name lạ kèm.
// BURN — CẤM hoàn toàn (else fail): auth NFT sống suốt vòng đời cầu, tái dùng vô hạn.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction,
  placeholder}

/// Redeemer minting policy. Một action duy nhất; KHÔNG có Burn (else fail).
pub type ReserveAuthRedeemer {
  MintAuth
}

/// reserve_auth parameterized bởi (genesis_ref, auth_name).
///   genesis_ref — UTxO genesis tiêu đúng 1 lần (one-shot).
///   auth_name   — asset name auth NFT (phải khớp treasury_auth_name của reserve_draw + reserve_gate).
validator reserve_auth(genesis_ref: OutputReference, auth_name: ByteArray) {
  mint(_r: ReserveAuthRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: consume đúng UTxO genesis (1 lần duy nhất trong lịch sử chain) ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Đúng 1 asset name của policy này (chống đúc kèm name lạ cùng policy) ──
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    // ── Đúng (auth_name, +1): name khớp param, qty đúng 1 (không hơn, không âm) ──
    expect assets.quantity_of(tx.mint, policy_id, auth_name) == 1

    True
  }

  // BURN + mọi purpose khác → CẤM (chống đốt/đúc lại auth credential).
  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests (≥4)
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"a1a1"

// auth_name = "TPULL" (Treasury-pull) hex.
const auth_nm: ByteArray = #"5450554c4c"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 3 }
}

fn other_ref() -> OutputReference {
  OutputReference { transaction_id: #"cc", output_index: 0 }
}

fn vk_addr(pkh: ByteArray) -> Address {
  Address {
    payment_credential: VerificationKey(pkh),
    stake_credential: None,
  }
}

fn mk_input(ref: OutputReference) -> Input {
  Input {
    output_reference: ref,
    output: Output {
      address: vk_addr(#"a0"),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn run(redeemer: ReserveAuthRedeemer, mint: Value, inputs: List<Input>) -> Bool {
  reserve_auth.mint(
    g_ref(),
    auth_nm,
    redeemer,
    pol,
    Transaction { ..placeholder, inputs: inputs, mint: mint },
  )
}

// ── HAPPY ────────────────────────────────────────────────────

test auth_happy_mint_one() {
  // Consume genesis + đúc đúng 1 (auth_name, +1) → pass.
  let mint = assets.zero |> assets.add(pol, auth_nm, 1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

// ── NEGATIVE ─────────────────────────────────────────────────

test auth_reject_no_genesis() fail {
  // KHÔNG consume genesis_ref → one-shot reject (không thể đúc nếu thiếu genesis).
  let mint = assets.zero |> assets.add(pol, auth_nm, 1)
  run(MintAuth, mint, [mk_input(other_ref())])
}

test auth_reject_qty_two() fail {
  // Đúc qty 2 (không phải đúng 1) → reject (quantity_of == 1 sai).
  let mint = assets.zero |> assets.add(pol, auth_nm, 2)
  run(MintAuth, mint, [mk_input(g_ref())])
}

test auth_reject_extra_name() fail {
  // Đúc kèm asset name lạ cùng policy (dict.size == 2 ≠ 1) → reject.
  let mint =
    assets.zero
      |> assets.add(pol, auth_nm, 1)
      |> assets.add(pol, #"dead", 1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

test auth_reject_wrong_name() fail {
  // Đúc đúng 1 token nhưng SAI name (≠ auth_name) → quantity_of(auth_name) == 0 → reject.
  let mint = assets.zero |> assets.add(pol, #"beef", 1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

test auth_reject_burn() fail {
  // Burn (qty âm) → quantity_of(auth_name) == -1 ≠ 1 → reject (cấm đốt auth).
  let mint = assets.zero |> assets.add(pol, auth_nm, -1)
  run(MintAuth, mint, [mk_input(g_ref())])
}
