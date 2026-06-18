// LAMP minting policy — DID-ANCHORED MINT AUTHORITY.
//
// Quyền mint LAMP neo vào MỘT OrgDID PhoenixKey (anchor_nft_policy,
// anchor_nft_name), KHÔNG vào một public-key cố định. Controller hiện tại của DID
// được đọc ĐỘNG qua reference input (CIP-31) → rotate/recovery xong, quyền mint
// tự đi theo DID, KHÔNG redeploy (policy-id bất biến → token đã lưu hành an toàn).
//
// Toàn bộ quyết định ở `phoenixkey.validate_mint` (thuần, test-được). Validator này
// chỉ forward `policy_id` (own policy do ledger cấp) + tx.
//
// GIỚI HẠN: policy này gate AI mint (authority DID) + AI tên token (asset-name =
// lamp_asset_name), KHÔNG gate BAO NHIÊU — cap 36 tỷ phải do tầng SupplyState/Genesis
// ép, compose riêng. Xem SPEC §1.1/§QĐ-1.
//
// Tham số (baked tại deploy):
//   lamp_asset_name   — asset-name HỢP LỆ DUY NHẤT dưới policy này (khoá C-1).
//   anchor_nft_policy — policy-id state NFT của OrgDID authority (= TAAD script hash).
//   anchor_nft_name   — asset-name state NFT (= blake2b_256(org_did)).
//
// Aiken 1.1.x / Plutus V3.

use cardano/address
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/tokenomics/phoenixkey.{
  Active, Migrated, Org, Person, Recovering, Revoked, TAADDatum, TAADStatus,
}

/// Redeemer trống — toàn bộ authority neo vào DID anchor (reference input), không
/// cần tham số redeemer. Một biến thể để CBOR redeemer xác định.
pub type LampMintRedeemer {
  Mint
}

validator lamp_mint(
  lamp_asset_name: AssetName,
  anchor_nft_policy: PolicyId,
  anchor_nft_name: AssetName,
) {
  mint(_redeemer: LampMintRedeemer, policy_id: PolicyId, self: Transaction) {
    phoenixkey.validate_mint(
      policy_id,
      lamp_asset_name,
      anchor_nft_policy,
      anchor_nft_name,
      self,
    )
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — positive + negative (phản biện đối kháng)
//   Pass:  controller ký + Active + Org
//   Fail:  thiếu chữ ký controller; ref input KHÔNG có anchor NFT; anchor NFT
//          policy GIẢ; status=Recovering; status=Revoked; entity_type sai (Person);
//          burn (mint âm); qty 0; 2 ref input cùng mang anchor (mơ hồ → từ chối);
//          (C-1) asset-name KHÁC "LAMP"; (C-1) 2 asset-name trong 1 tx.
// ════════════════════════════════════════════════════════════════════════════

// ─── Hằng test ─────────────────────────────────────────────────────────────

// policy-id của chính policy LAMP (own_policy do ledger cấp).
const lamp_policy: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

// policy-id state NFT của TAAD validator (= anchor authority policy).
const anchor_policy: PolicyId =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

// policy GIẢ — kẻ tấn công tự mint NFT cùng tên ở policy khác.
const fake_policy: PolicyId =
  #"deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead"

// asset-name anchor (= blake2b_256(org_did) ngoài đời; ở test là hằng cố định).
const anchor_name: AssetName =
  #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"

const controller_pkh: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const other_pkh: ByteArray =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

const hw_pub: ByteArray =
  #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

const org_did: ByteArray = "did:phoenix:org:greensun"

// ─── Builders ──────────────────────────────────────────────────────────────

fn lamp_token_name() -> AssetName {
  "LAMP"
}

/// Mint dương n LAMP.
fn mint_lamp(qty: Int) -> assets.Value {
  assets.zero |> assets.add(lamp_policy, lamp_token_name(), qty)
}

/// Value mang đúng 1 anchor NFT (policy, name) + min-ADA.
fn anchor_value(policy: PolicyId, name: AssetName) -> assets.Value {
  assets.from_lovelace(2000000) |> assets.add(policy, name, 1)
}

fn org_datum(status: TAADStatus, ctrl: ByteArray) -> TAADDatum {
  TAADDatum {
    did: org_did,
    entity_type: Org,
    controller_pkh: ctrl,
    hw_key_pubkey: hw_pub,
    sequence: 5,
    status,
    guardians: [],
    parent_did: None,
    revoked_slot: None,
    recovery_anchor: None,
  }
}

fn ref_input(value: assets.Value, datum: TAADDatum, idx: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: idx,
    },
    output: Output {
      address: address.from_script(anchor_policy),
      value,
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn base_tx() -> Transaction {
  Transaction { ..placeholder }
}

fn run(self: Transaction) -> Bool {
  phoenixkey.validate_mint(
    lamp_policy,
    lamp_token_name(),
    anchor_policy,
    anchor_name,
    self,
  )
}

// ─── PASS: controller ký + Active + Org ──────────────────────────────────────

test mint_ok_when_controller_signs() {
  let datum = org_datum(Active, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: thiếu chữ ký controller ──────────────────────────────────────────

test mint_fails_without_controller_sig() fail {
  let datum = org_datum(Active, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [other_pkh],
    }
  run(tx)
}

// ─── FAIL: ref input KHÔNG mang anchor NFT (chỉ ADA) ─────────────────────────

test mint_fails_when_no_anchor_in_ref() fail {
  let datum = org_datum(Active, controller_pkh)
  let bare =
    Input {
      output_reference: OutputReference {
        transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
        output_index: 0,
      },
      output: Output {
        address: address.from_script(anchor_policy),
        value: assets.from_lovelace(2000000),
        datum: InlineDatum(datum),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [bare],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: anchor NFT GIẢ — policy khác, cùng asset-name ─────────────────────

test mint_fails_when_anchor_policy_forged() fail {
  let datum = org_datum(Active, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(fake_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: anchor NFT GIẢ — đúng policy, asset-name khác ──────────────────────

test mint_fails_when_anchor_name_wrong() fail {
  let datum = org_datum(Active, controller_pkh)
  let wrong_name: AssetName =
    #"9999999999999999999999999999999999999999999999999999999999999999"
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, wrong_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: status = Recovering (đang recovery → KHÔNG cho mint) ───────────────

test mint_fails_when_status_recovering() fail {
  let recovering =
    Recovering {
      pending_controller_pkh: other_pkh,
      pending_hw_pubkey: hw_pub,
      deadline_slot: 999,
      collateral_lovelace: 5000000,
    }
  let datum = org_datum(recovering, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: status = Revoked ──────────────────────────────────────────────────

test mint_fails_when_status_revoked() fail {
  let datum = org_datum(Revoked, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: status = Migrated ─────────────────────────────────────────────────

test mint_fails_when_status_migrated() fail {
  let datum = org_datum(Migrated, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: entity_type sai (Person, không phải Org) ──────────────────────────

test mint_fails_when_entity_not_org() fail {
  let person =
    TAADDatum { ..org_datum(Active, controller_pkh), entity_type: Person }
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), person, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: BURN (mint âm) — LAMP fixed-supply, no-burn ───────────────────────

test mint_fails_on_burn() fail {
  let datum = org_datum(Active, controller_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(-1_000_000),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL: HAI ref input cùng mang anchor NFT → mơ hồ authority → từ chối ─────

test mint_fails_when_two_anchor_refs() fail {
  let datum_a = org_datum(Active, controller_pkh)
  // ref input thứ 2 mang NFT cùng (policy,name) nhưng controller GIẢ — nếu policy
  // chọn nhầm cái này, kẻ tấn công sẽ qua mặt. Singleton-anchor PHẢI từ chối cả hai.
  let datum_b = org_datum(Active, other_pkh)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(1_000_000),
      reference_inputs: [
        ref_input(anchor_value(anchor_policy, anchor_name), datum_a, 0),
        ref_input(anchor_value(anchor_policy, anchor_name), datum_b, 1),
      ],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── PASS (phản biện): authority ĐI THEO DID sau rotate ──────────────────────
// Controller MỚI (sau rotate) ký, cùng anchor NFT, status Active → vẫn mint được,
// KHÔNG cần redeploy policy. Đây là bất biến cốt lõi của thiết kế.

test mint_ok_after_controller_rotated() {
  let new_ctrl = other_pkh
  let datum = org_datum(Active, new_ctrl)
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint_lamp(42),
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [new_ctrl],
    }
  run(tx)
}

// ─── FAIL (phản biện): mint qty 0 không được coi là "dương" ───────────────────

test mint_fails_on_zero_qty() fail {
  let datum = org_datum(Active, controller_pkh)
  // tx.mint mang LAMP với qty 0 (chỉ để policy chạy) — phải bị mint_is_exactly_lamp chặn.
  let zero_mint = assets.zero |> assets.add(lamp_policy, lamp_token_name(), 0)
  let tx =
    Transaction {
      ..base_tx(),
      mint: zero_mint,
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL (C-1): mint đúng controller nhưng asset-name KHÁC "LAMP" → token rác ─
// Authority hợp lệ (controller ký + Active + Org) NHƯNG asset-name lạ dưới cùng
// policy-id LAMP. Trước vá C-1 đây là lỗ hổng: token rác qua mặt. Phải bị chặn.

test mint_fails_when_asset_name_not_lamp() fail {
  let datum = org_datum(Active, controller_pkh)
  let junk_mint =
    assets.zero |> assets.add(lamp_policy, "JUNK", 1_000_000)
  let tx =
    Transaction {
      ..base_tx(),
      mint: junk_mint,
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}

// ─── FAIL (C-1): mint 2 asset-name khác nhau trong 1 tx → từ chối ─────────────
// Kẻ tấn công kèm "LAMP" hợp lệ với một asset-name rác cùng policy-id trong cùng
// một tx. Khoá asset-name chỉ chấp nhận ĐÚNG MỘT entry = "LAMP" → từ chối cả tx.

test mint_fails_when_two_asset_names() fail {
  let datum = org_datum(Active, controller_pkh)
  let multi_mint =
    assets.zero
      |> assets.add(lamp_policy, lamp_token_name(), 1_000_000)
      |> assets.add(lamp_policy, "JUNK", 1)
  let tx =
    Transaction {
      ..base_tx(),
      mint: multi_mint,
      reference_inputs: [ref_input(anchor_value(anchor_policy, anchor_name), datum, 0)],
      extra_signatories: [controller_pkh],
    }
  run(tx)
}
