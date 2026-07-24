// supply_state — SPEND validator của bộ đếm tổng-cung LAMP (vá lỗ C-2).
//
// Một state UTxO đậu SupplyState NFT one-shot (mint bởi NHÁNH genesis dưới đây),
// datum giữ `minted_total` (oil). MỖI lần mint LAMP, tx PHẢI spend + tái-tạo
// UTxO này; spend ép minted_total' = minted_total + minted_amount ≤ CAP. Bộ đếm
// đơn điệu không giảm → tổng phát hành lịch sử LAMP ≤ CAP vĩnh viễn.
//
// HAI NHÁNH (cùng một script hash → own_policy ≡ own_script, Design-2):
//   • mint(...)  — GENESIS: mint NFT thread one-shot bound genesis_ref, total = 0.
//   • spend(...) — đếm mint LAMP qua bộ đếm, ép cap.
//
// ─── CAP = THAM SỐ BAKE ───────────────────────────────────────────────────────
// `cap` (Int, oil) bake tại deploy. LAMP: 36 tỷ × 10⁶ oil/LAMP = 36_000_000_000_000_000
// (decimals = 6, SPEC dòng đầu "1 LAMP = 10⁶ oil"). Tham số hoá để cùng engine
// tái dùng cho token opt-in cap khác (cap riêng) — KHÔNG hard-code hằng.
//
// `state_name` cố định (vd "LAMP-SUPPLY") — name của NFT thread; bake làm tham số
// để engine tổng quát.
//
// ─── PHÁ VÒNG PHỤ-THUỘC-HASH (lamp_policy ĐƯA VÀO DATUM) ──────────────────────
// TRƯỚC: validator param theo `lamp_policy` (= hash did_token_mint, vì LAMP do
// did_token_mint đúc) → supply_state hash phụ-thuộc did_token_mint hash. NHƯNG
// did_token_mint lại param theo supply_state_nft_policy (= supply_state hash) →
// HAI HASH PHỤ THUỘC VÒNG → không tính được hash nào → KHÔNG DEPLOY ĐƯỢC.
// (aiken check KHÔNG bắt vì test dùng hash hằng giả.)
// NAY: lamp_policy / lamp_asset_name CHUYỂN VÀO SupplyStateDatum (set lúc genesis,
// bất biến qua spend). supply_state KHÔNG còn param theo lamp_policy → hash ĐỘC LẬP
// did_token_mint. did_token_mint vẫn param theo supply_state_nft_policy = hash này
// → phụ thuộc 1 CHIỀU, HẾT VÒNG.
//
// ─── THỨ TỰ DEPLOY (offchain PHẢI làm đúng tuần tự) ──────────────────────────
//   1. Tính supply_state hash (param: genesis_ref, state_name, cap — KHÔNG lamp_policy).
//   2. Tính did_token_mint hash (param: ..., supply_state_nft_policy = supply_state hash).
//   3. Genesis supply_state với datum.lamp_policy = did_token_mint hash (bước 2),
//      datum.lamp_asset_name = asset-name LAMP, datum.minted_total = 0.
//   Tuần tự 1→2→3, mỗi bước chỉ phụ thuộc bước trước → không còn vòng.
//
// Aiken 1.1.x / Plutus V3.

use cardano/address
use cardano/address.{Script}
use cardano/assets
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{Input, Output, OutputReference, Transaction}
use magiclamp/tokenomics/supply.{SupplyStateDatum, SupplyStateNft,
  SupplyStateRedeemer}

validator supply_state(
  // GENESIS one-shot anchor.
  genesis_ref: OutputReference,
  // name của SupplyState NFT thread (vd "LAMP-SUPPLY").
  state_name: AssetName,
  // trần raw-unit oil (LAMP = 36_000_000_000_000_000).
  cap: Int,
) {
  // LƯU Ý: token được đếm (lamp_policy / lamp_asset_name) KHÔNG còn là tham số —
  // đã chuyển vào SupplyStateDatum để phá vòng phụ-thuộc-hash (xem header).
  // ── GENESIS: mint NFT thread one-shot, hard-bind Script(own), total = 0 ──────
  mint(_redeemer: SupplyStateNft, own_policy: PolicyId, self: Transaction) {
    supply.validate_genesis(own_policy, state_name, genesis_ref, self)
  }

  // ── SPEND: đếm mint LAMP, ép cap ────────────────────────────────────────────
  spend(
    datum: Option<SupplyStateDatum>,
    _redeemer: SupplyStateRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum_in) = datum
    // own_script ≡ own_policy (Design-2): NFT one-shot policy-id = script hash.
    // Đọc từ chính UTxO đang spend (address của own_ref input).
    expect Some(own_input) =
      find_self(self.inputs, own_ref)
    expect Script(own_script) = own_input.output.address.payment_credential
    supply.validate_spend(
      own_script,
      own_script,
      state_name,
      cap,
      datum_in,
      own_ref,
      self,
    )
  }

  else(_) {
    fail
  }
}

fn find_self(
  inputs: List<transaction.Input>,
  own_ref: OutputReference,
) -> Option<transaction.Input> {
  when inputs is {
    [] -> None
    [h, ..t] ->
      if h.output_reference == own_ref {
        Some(h)
      } else {
        find_self(t, own_ref)
      }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — positive + negative (phản biện đối kháng)
//
//   GENESIS:  one-shot ok | re-mint (thiếu genesis_ref) fail | NFT off-script fail
//             | total≠0 seed fail | mint qty 2 fail
//   SPEND:    mint trong cap ok | mint vượt cap fail | total'≠total+amount fail
//             | minted_total giảm (burn) fail | NFT giả (policy khác) fail
//             | mất NFT continuing-output fail | 2 SupplyState input fail
// ════════════════════════════════════════════════════════════════════════════

// ─── Hằng test ───────────────────────────────────────────────────────────────

// policy-id của SupplyState NFT = script hash của chính supply_state (Design-2).
const ss_policy: PolicyId =
  #"5555555555555555555555555555555555555555555555555555555555"

// policy GIẢ — kẻ tấn công tự mint NFT cùng tên ở policy khác.
const fake_policy: PolicyId =
  #"deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead"

// policy-id của LAMP token.
const lamp_policy_c: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

const state_name_c: AssetName = "LAMP-SUPPLY"

const lamp_name_c: AssetName = "LAMP"

// CAP LAMP = 36 tỷ × 10⁶ oil = 36_000_000_000_000_000.
const cap_c: Int = 36_000_000_000_000_000

const genesis_oref: OutputReference =
  OutputReference {
    transaction_id: #"7777777777777777777777777777777777777777777777777777777777777777",
    output_index: 0,
  }

const own_oref: OutputReference =
  OutputReference {
    transaction_id: #"9999999999999999999999999999999999999999999999999999999999999999",
    output_index: 0,
  }

const ctrl_a: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

// ─── Builders ────────────────────────────────────────────────────────────────

fn base_tx() -> Transaction {
  Transaction { ..transaction.placeholder }
}

fn ss_value(policy: PolicyId) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(policy, state_name_c, 1)
}

/// Datum chuẩn (token được đếm = LAMP) với minted_total = total.
fn ss_datum(total: Int) -> SupplyStateDatum {
  SupplyStateDatum {
    minted_total: total,
    lamp_policy: lamp_policy_c,
    lamp_asset_name: lamp_name_c,
  }
}

/// Output SupplyState tại Script(policy) mang NFT + datum.
fn ss_output_at(policy: PolicyId, total: Int) -> transaction.Output {
  transaction.Output {
    address: address.from_script(policy),
    value: ss_value(policy),
    datum: transaction.InlineDatum(ss_datum(total)),
    reference_script: None,
  }
}

fn input_consuming(oref: OutputReference) -> transaction.Input {
  transaction.Input {
    output_reference: oref,
    output: transaction.Output {
      address: address.from_verification_key(ctrl_a),
      value: assets.from_lovelace(5_000_000),
      datum: transaction.NoDatum,
      reference_script: None,
    },
  }
}

/// own_input đang spend: SupplyState UTxO tại Script(ss_policy) mang NFT + datum.
fn own_ss_input(policy: PolicyId, total: Int) -> transaction.Input {
  transaction.Input { output_reference: own_oref, output: ss_output_at(policy, total) }
}

fn mint_lamp(qty: Int) -> assets.Value {
  if qty == 0 {
    assets.zero
  } else {
    assets.zero |> assets.add(lamp_policy_c, lamp_name_c, qty)
  }
}

// ── runners ──

fn run_genesis(self: Transaction) -> Bool {
  supply.validate_genesis(ss_policy, state_name_c, genesis_oref, self)
}

fn run_spend(datum_in: SupplyStateDatum, own_in: transaction.Input, self: Transaction) -> Bool {
  supply.validate_spend(
    ss_policy,
    ss_policy,
    state_name_c,
    cap_c,
    datum_in,
    own_in.output_reference,
    self,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// GENESIS
// ════════════════════════════════════════════════════════════════════════════

test genesis_one_shot_ok() {
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(ss_policy, state_name_c, 1),
      outputs: [ss_output_at(ss_policy, 0)],
    }
  run_genesis(tx)
}

// Re-mint: KHÔNG consume genesis_ref → one-shot từ chối.
test genesis_remint_without_seed_fails() fail {
  let other =
    OutputReference {
      transaction_id: #"8888888888888888888888888888888888888888888888888888888888888888",
      output_index: 1,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(other)],
      mint: assets.zero |> assets.add(ss_policy, state_name_c, 1),
      outputs: [ss_output_at(ss_policy, 0)],
    }
  run_genesis(tx)
}

// NFT ra ví (off-script) → hard-bind từ chối.
test genesis_nft_off_script_fails() fail {
  let wallet_out =
    transaction.Output {
      address: address.from_verification_key(ctrl_a),
      value: ss_value(ss_policy),
      datum: transaction.InlineDatum(ss_datum(0)),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(ss_policy, state_name_c, 1),
      outputs: [wallet_out],
    }
  run_genesis(tx)
}

// Seed total ≠ 0 → từ chối (chống pre-burn quota lén).
test genesis_nonzero_total_fails() fail {
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(ss_policy, state_name_c, 1),
      outputs: [ss_output_at(ss_policy, 1_000_000)],
    }
  run_genesis(tx)
}

// Mint qty 2 (không singleton) → từ chối.
test genesis_mint_two_fails() fail {
  let out =
    transaction.Output {
      address: address.from_script(ss_policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(ss_policy, state_name_c, 2),
      datum: transaction.InlineDatum(ss_datum(0)),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(ss_policy, state_name_c, 2),
      outputs: [out],
    }
  run_genesis(tx)
}

// ════════════════════════════════════════════════════════════════════════════
// SPEND — đếm mint, ép cap
// ════════════════════════════════════════════════════════════════════════════

// Mint trong cap: total 1_000_000 → mint 5_000_000 → total' 6_000_000 ≤ cap → ok.
test spend_mint_within_cap_ok() {
  let din = ss_datum(1_000_000)
  let own_in = own_ss_input(ss_policy, 1_000_000)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(5_000_000),
      outputs: [ss_output_at(ss_policy, 6_000_000)],
    }
  run_spend(din, own_in, tx)
}

// Mint vừa chạm trần CAP → ok (≤, không <).
test spend_mint_exactly_cap_ok() {
  let din = ss_datum(0)
  let own_in = own_ss_input(ss_policy, 0)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(cap_c),
      outputs: [ss_output_at(ss_policy, cap_c)],
    }
  run_spend(din, own_in, tx)
}

// Mint VƯỢT cap: total' = cap + 1 > cap → từ chối.
test spend_mint_over_cap_fails() fail {
  let din = ss_datum(cap_c)
  let own_in = own_ss_input(ss_policy, cap_c)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(1),
      outputs: [ss_output_at(ss_policy, cap_c + 1)],
    }
  run_spend(din, own_in, tx)
}

// total' ≠ total + amount: datum_out khai ít hơn thực mint (rò quota) → từ chối.
test spend_total_not_sum_fails() fail {
  let din = ss_datum(1_000_000)
  let own_in = own_ss_input(ss_policy, 1_000_000)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(5_000_000),
      // KHAI total' = 2_000_000 nhưng thực mint 5_000_000 → 1_000_000+5_000_000 ≠ 2_000_000.
      outputs: [ss_output_at(ss_policy, 2_000_000)],
    }
  run_spend(din, own_in, tx)
}

// minted_total GIẢM (burn LAMP kéo lùi bộ đếm) → (s5) minted_amount ≥ 0 từ chối.
test spend_total_decreases_fails() fail {
  let din = ss_datum(10_000_000)
  let own_in = own_ss_input(ss_policy, 10_000_000)
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      // burn -1_000_000 LAMP → minted_amount âm.
      mint: mint_lamp(-1_000_000),
      outputs: [ss_output_at(ss_policy, 9_000_000)],
    }
  run_spend(din, own_in, tx)
}

// SupplyState NFT GIẢ (policy khác) ở continuing output → (s3) không nhận → từ chối.
test spend_forged_nft_output_fails() fail {
  let din = ss_datum(0)
  let own_in = own_ss_input(ss_policy, 0)
  let forged_out =
    transaction.Output {
      address: address.from_script(ss_policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(fake_policy, state_name_c, 1),
      datum: transaction.InlineDatum(ss_datum(5_000_000)),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(5_000_000),
      outputs: [forged_out],
    }
  run_spend(din, own_in, tx)
}

// Mất NFT: continuing output KHÔNG mang SupplyState NFT → (s3) từ chối.
test spend_loses_nft_fails() fail {
  let din = ss_datum(0)
  let own_in = own_ss_input(ss_policy, 0)
  let bare_out =
    transaction.Output {
      address: address.from_script(ss_policy),
      value: assets.from_lovelace(2_000_000),
      datum: transaction.InlineDatum(ss_datum(5_000_000)),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(5_000_000),
      outputs: [bare_out],
    }
  run_spend(din, own_in, tx)
}

// 2 SupplyState input (nhân đôi bộ đếm để đếm thiếu) → (s2) đòi-đúng-1 từ chối.
test spend_two_supply_states_fails() fail {
  let din = ss_datum(0)
  let own_in = own_ss_input(ss_policy, 0)
  // input thứ 2 cùng Script(ss_policy) mang SupplyState NFT.
  let second =
    transaction.Input {
      output_reference: OutputReference {
        transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        output_index: 1,
      },
      output: ss_output_at(ss_policy, 0),
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in, second],
      mint: mint_lamp(5_000_000),
      outputs: [ss_output_at(ss_policy, 5_000_000), ss_output_at(ss_policy, 5_000_000)],
    }
  run_spend(din, own_in, tx)
}

// own_input KHÔNG mang SupplyState NFT (spend nhầm UTxO khác cùng addr) → (s1) từ chối.
test spend_own_input_no_nft_fails() fail {
  let din = ss_datum(0)
  let bare_own =
    transaction.Input {
      output_reference: own_oref,
      output: transaction.Output {
        address: address.from_script(ss_policy),
        value: assets.from_lovelace(2_000_000),
        datum: transaction.InlineDatum(din),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [bare_own],
      mint: mint_lamp(5_000_000),
      outputs: [ss_output_at(ss_policy, 5_000_000)],
    }
  run_spend(din, bare_own, tx)
}

// datum_out ĐỔI lamp_policy (đổi mục-tiêu-đếm để né cap token thật) → (s8) từ chối.
test spend_changes_lamp_policy_fails() fail {
  let din = ss_datum(1_000_000)
  let own_in = own_ss_input(ss_policy, 1_000_000)
  // continuing output mang datum với lamp_policy GIẢ (khác datum_in) → bất biến vỡ.
  let tampered_out =
    transaction.Output {
      address: address.from_script(ss_policy),
      value: ss_value(ss_policy),
      datum: transaction.InlineDatum(
        SupplyStateDatum {
          minted_total: 6_000_000,
          lamp_policy: fake_policy,
          lamp_asset_name: lamp_name_c,
        },
      ),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(5_000_000),
      outputs: [tampered_out],
    }
  run_spend(din, own_in, tx)
}

// datum_out ĐỔI lamp_asset_name → (s8) từ chối (bất biến token được đếm).
test spend_changes_lamp_asset_name_fails() fail {
  let din = ss_datum(1_000_000)
  let own_in = own_ss_input(ss_policy, 1_000_000)
  let tampered_out =
    transaction.Output {
      address: address.from_script(ss_policy),
      value: ss_value(ss_policy),
      datum: transaction.InlineDatum(
        SupplyStateDatum {
          minted_total: 6_000_000,
          lamp_policy: lamp_policy_c,
          lamp_asset_name: "NOT-LAMP",
        },
      ),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [own_in],
      mint: mint_lamp(5_000_000),
      outputs: [tampered_out],
    }
  run_spend(din, own_in, tx)
}
