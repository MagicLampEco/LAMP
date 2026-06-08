// tLAMP — minting policy ONE-SHOT cho test-LAMP canonical (Preview/Preprod).
//
// MỤC TIÊU: tLAMP trung thực mô phỏng LAMP mainnet = FIXED-SUPPLY. Để giữ trung
// thực fixed-supply, policy mint TOÀN BỘ test supply ĐÚNG 1 LẦN rồi tự khóa
// (one-shot), KHÔNG mint mỗi lần dev claim. Faucet nhả token từ pool có sẵn.
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi 1 genesis OutputReference. Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis đó. Một UTxO chỉ spend được 1 lần trong lịch sử
//   chain → policy chạy được TỐI ĐA 1 lần → supply cố định, KHÔNG re-mint.
//   Đây là bất biến mạnh nhất đạt được mà không cần state on-chain.
//
// MINT shape (đúng tổng cung, không hơn không kém):
//   (LAMP="4c414d50", +total_supply) — total_supply truyền qua param.
//   - dict.size == 1: policy này KHÔNG mint asset name lạ nào khác.
//   - quantity_of == total_supply: đúng tổng cung, không dư không thiếu, không âm.
//
// total_supply tính ở offchain = 36_000_000_000 × 10^6 oil (decimals 6, khớp
// Distribution: 1 LAMP = 10^6 oil). Truyền qua param để onchain không hard-code
// con số khổng lồ + cho phép preprod/preview dùng cùng policy code.
//
// BURN: CẤM hoàn toàn. LAMP mainnet fixed-supply BẤT BIẾN (KHÔNG bao giờ burn),
// tLAMP phản chiếu đúng tính chất đó. `else(_) { fail }` chặn mọi mint âm + mọi
// purpose khác. Sau khi mint xong, KHÔNG còn cửa thay đổi tổng cung tLAMP.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction,
  placeholder}

/// Asset name "LAMP" = #"4c414d50" (khớp Distribution LAMP_ASSET_NAME).
pub const lamp_asset_name: ByteArray = #"4c414d50"

/// Redeemer: chỉ MintGenesis (mint toàn bộ supply 1 lần). Không Burn.
pub type TLampRedeemer {
  MintGenesis
}

validator tlamp_policy(genesis_ref: OutputReference, total_supply: Int) {
  mint(_redeemer: TLampRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ──────────────────────────
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 asset (LAMP), qty = total_supply ─────────────────
    // dict.size == 1 chặn mint kèm asset name lạ trong cùng policy.
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    // quantity đúng tổng cung: không dư, không thiếu, không âm (burn).
    expect assets.quantity_of(tx.mint, policy_id, lamp_asset_name) == total_supply

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const tp_policy: PolicyId = #"7777"

// Tổng cung test nhỏ trong unit test (logic giống hệt số thật).
const tp_total: Int = 36_000_000_000_000_000

fn tp_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 3 }
}

fn vk_addr(pkh: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(pkh), stake_credential: None }
}

fn mk_out_no_datum(addr: Address, value: Value) -> Output {
  Output { address: addr, value: value, datum: NoDatum, reference_script: None }
}

fn tp_genesis_input() -> Input {
  Input {
    output_reference: tp_genesis_ref(),
    output: mk_out_no_datum(vk_addr(#"a0"), assets.from_lovelace(2_000_000)),
  }
}

fn tp_other_input() -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"bb", output_index: 0 },
    output: mk_out_no_datum(vk_addr(#"a0"), assets.from_lovelace(2_000_000)),
  }
}

fn tp_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(tp_policy, name, qty)
}

test mint_full_supply_happy() {
  // consume genesis + mint đúng tổng cung → pass.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_other_input(), tp_genesis_input()],
      mint: tp_mint(lamp_asset_name, tp_total),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

test mint_without_genesis() fail {
  // KHÔNG consume genesis ref → one-shot reject (chống mint lần 2 / mint giả).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_other_input()],
      mint: tp_mint(lamp_asset_name, tp_total),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

test mint_wrong_quantity_less() fail {
  // mint thiếu (total − 1) → reject: phải đúng tổng cung.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_genesis_input()],
      mint: tp_mint(lamp_asset_name, tp_total - 1),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

test mint_wrong_quantity_more() fail {
  // mint dư (total + 1) → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_genesis_input()],
      mint: tp_mint(lamp_asset_name, tp_total + 1),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

test mint_negative_burn() fail {
  // mint âm (burn) → reject: tLAMP fixed-supply không burn.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_genesis_input()],
      mint: tp_mint(lamp_asset_name, -tp_total),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

test mint_extra_asset_name() fail {
  // mint kèm asset name lạ (FAKE) → dict.size == 2 → reject.
  let mint =
    assets.zero
      |> assets.add(tp_policy, lamp_asset_name, tp_total)
      |> assets.add(tp_policy, #"4641", 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_genesis_input()],
      mint: mint,
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

// ══════════════════════ RED-TEAM VÒNG 2 ══════════════════════

// RT-P1: consume genesis + LAMP đúng total NHƯNG kèm name lạ qty âm (giả "burn"
// để né dict.size). assets.add(-1) tạo entry → dict.size == 2 → reject.
test rt_mint_lamp_plus_negative_other() fail {
  let mint =
    assets.zero
      |> assets.add(tp_policy, lamp_asset_name, tp_total)
      |> assets.add(tp_policy, #"4641", -1)
  let tx =
    Transaction { ..placeholder, inputs: [tp_genesis_input()], mint: mint }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

// RT-P2: mint LAMP qty=0 (rỗng). add qty 0 KHÔNG tạo entry → own_tokens rỗng →
// dict.size 0 ≠ 1 → reject (không cho mint "0 token" để né quantity check).
test rt_mint_zero_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_genesis_input()],
      mint: assets.zero |> assets.add(tp_policy, lamp_asset_name, 0),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

// RT-P3: input có transaction_id khớp genesis nhưng output_index khác (off-by-one).
// OutputReference so sánh cả 2 field → không khớp → one-shot reject.
test rt_mint_genesis_wrong_index() fail {
  let bad_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"aa",
        output_index: 4,
      },
      output: mk_out_no_datum(vk_addr(#"a0"), assets.from_lovelace(2_000_000)),
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [bad_input],
      mint: tp_mint(lamp_asset_name, tp_total),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}

// RT-P4: mint asset name lạ DUY NHẤT (không có LAMP) + consume genesis.
// dict.size==1 NHƯNG quantity_of(LAMP)==0 ≠ total → reject (chống mint token
// rác mạo danh policy).
test rt_mint_only_fake_name() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tp_genesis_input()],
      mint: tp_mint(#"4641", tp_total),
    }
  tlamp_policy.mint(tp_genesis_ref(), tp_total, MintGenesis, tp_policy, tx)
}
