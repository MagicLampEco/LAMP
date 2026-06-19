// did_token_mint — minting policy TỔNG QUÁT cho token do DID quản qua bảng.
//
// Tổng quát hoá lamp_mint: thay vì neo trực tiếp vào DID anchor, neo vào MỘT
// dòng (action_tag) trong Mint-Authority Registry. Một OrgDID phát hành NHIỀU
// token, mỗi token một policy `did_token_mint` (bake action_tag + asset-name
// riêng), quyền mint mỗi token tra trong bảng theo action_tag — đổi quyền
// (Single→Multi→Revoked) = sửa bảng, KHÔNG redeploy policy nào, KHÔNG đẻ khoá.
//
// Quyền mint KHÔNG neo public-key cố định: bảng đọc động qua reference input
// (CIP-31). Authorization dòng token có thể là một khoá / multisig / đã thu hồi.
//
// CAP SUPPLY (vá C-2): policy gate AI mint (authority qua bảng) + AI tên token
// (asset-name) + — VỚI token opt-in cap — BAO NHIÊU, qua lớp THÊM compose với
// SupplyState. Token KHÔNG opt-in (require_supply_state = False) giữ hành vi cũ
// (registry tổng quát cho mọi token), KHÔNG buộc có SupplyState.
//
// ─── BINDING cap (chống bypass / double-count) ───────────────────────────────
// Khi require_supply_state = True, policy ÉP có ĐÚNG 1 INPUT mang SupplyState NFT
// (supply_state_nft_policy, supply_state_nft_name) bị spend trong cùng tx. Vì NFT
// đó đậu ở supply_state script (Design-2), consume nó CHẮC CHẮN kích spend của
// supply_state → bộ đếm đọc minted_amount = qty token toàn-tx, ép total' ≤ cap.
// → KHÔNG thể mint token-có-cap mà bỏ qua bộ đếm. Bộ đếm đọc từ tx.mint (gộp
// toàn-tx) → không double-count. NFT one-shot → không có 2 SupplyState thật.
//
// Tham số bake tại deploy:
//   registry_nft_policy     — policy-id registry NFT (= mint_registry script hash).
//   registry_nft_name       — asset-name registry NFT (= blake2b_256(governing_did)).
//   action_tag               — định danh logic dòng token (khoá tra cứu trong bảng).
//   token_asset_name        — asset-name HỢP LỆ DUY NHẤT dưới policy này (khoá C-1).
//   require_supply_state    — token này CÓ cap? (LAMP = True; token tổng quát = False).
//   supply_state_nft_policy — policy-id SupplyState NFT (= supply_state script hash).
//   supply_state_nft_name   — name SupplyState NFT (vd "LAMP-SUPPLY").
//
// Aiken 1.1.x / Plutus V3.

use aiken/crypto.{blake2b_256}
use cardano/address
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction,
  placeholder}
use magiclamp/tokenomics/registry
use magiclamp/tokenomics/registry.{Entry, RegistryDatum, SinglePkh}
use magiclamp/tokenomics/supply

/// Redeemer trống — toàn bộ authority neo vào bảng (reference input). Một biến
/// thể để CBOR redeemer xác định.
pub type DidTokenMintRedeemer {
  Mint
}

validator did_token_mint(
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
  action_tag: ByteArray,
  token_asset_name: AssetName,
  require_supply_state: Bool,
  supply_state_nft_policy: PolicyId,
  supply_state_nft_name: AssetName,
) {
  mint(_redeemer: DidTokenMintRedeemer, own_policy: PolicyId, self: Transaction) {
    // Lớp 1 (giữ NGUYÊN): authority qua bảng + khoá asset-name (C-1).
    let authorized =
      registry.validate_token_mint(
        own_policy,
        registry_nft_policy,
        registry_nft_name,
        action_tag,
        token_asset_name,
        self,
      )
    // Lớp 2 (THÊM, opt-in): token-có-cap PHẢI spend SupplyState → ép bộ đếm chạy.
    let counted =
      if require_supply_state {
        supply.requires_supply_state_spent(
          self,
          supply_state_nft_policy,
          supply_state_nft_name,
        )
      } else {
        True
      }
    authorized && counted
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — BINDING cap (lớp 2). Lớp 1 (authority/asset-name) đã test đủ ở
// registry.ak. Ở đây test phần THÊM: token-có-cap PHẢI spend SupplyState.
//
//   require_supply_state=True:  có SupplyState input + authority ok → ok |
//     KHÔNG spend SupplyState (bypass bộ đếm) → fail | 2 SupplyState input → fail |
//     SupplyState NFT giả (policy khác) → fail
//   require_supply_state=False: token tổng quát KHÔNG cần SupplyState → ok
// ════════════════════════════════════════════════════════════════════════════

const reg_policy: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

const tok_policy: PolicyId =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// SupplyState NFT policy (= supply_state script hash).
const ss_policy: PolicyId =
  #"5555555555555555555555555555555555555555555555555555555555"

const fake_ss_policy: PolicyId =
  #"deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead"

const gov_did: ByteArray = "did:phoenix:org:greensun"

const tag_lamp: ByteArray = "LAMP"

const tok_name: AssetName = "LAMP"

const ss_name: AssetName = "LAMP-SUPPLY"

const signer_x: ByteArray =
  #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"

fn reg_name() -> AssetName {
  blake2b_256(gov_did)
}

fn reg_datum() -> RegistryDatum {
  RegistryDatum {
    governing_did: gov_did,
    entries: [Entry { action_tag: tag_lamp, authority: SinglePkh(signer_x) }],
  }
}

fn registry_ref(idx: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
      output_index: idx,
    },
    output: Output {
      address: address.from_script(reg_policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(reg_policy, reg_name(), 1),
      datum: InlineDatum(reg_datum()),
      reference_script: None,
    },
  }
}

/// Input mang SupplyState NFT (policy, ss_name) tại Script(ss_policy).
fn ss_input(policy: PolicyId, idx: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"3333333333333333333333333333333333333333333333333333333333333333",
      output_index: idx,
    },
    output: Output {
      address: address.from_script(ss_policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(policy, ss_name, 1),
      datum: InlineDatum(supply.SupplyStateDatum { minted_total: 0 }),
      reference_script: None,
    },
  }
}

fn mint_tok(qty: Int) -> Value {
  assets.zero |> assets.add(tok_policy, tok_name, qty)
}

/// Replicate logic mint của did_token_mint với cờ require_supply_state.
fn run(require_ss: Bool, inputs: List<Input>, refs: List<Input>, signers: List<ByteArray>, mint: Value) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      mint: mint,
      inputs: inputs,
      reference_inputs: refs,
      extra_signatories: signers,
    }
  let authorized =
    registry.validate_token_mint(tok_policy, reg_policy, reg_name(), tag_lamp, tok_name, tx)
  let counted =
    if require_ss {
      supply.requires_supply_state_spent(tx, ss_policy, ss_name)
    } else {
      True
    }
  authorized && counted
}

// Token-có-cap: authority ok + SupplyState bị spend → ok.
test capped_with_supply_state_ok() {
  run(True, [ss_input(ss_policy, 0)], [registry_ref(0)], [signer_x], mint_tok(1_000_000))
}

// Token-có-cap NHƯNG KHÔNG spend SupplyState (bypass bộ đếm) → từ chối.
test capped_without_supply_state_fails() fail {
  run(True, [], [registry_ref(0)], [signer_x], mint_tok(1_000_000))
}

// Token-có-cap: 2 SupplyState input → đòi-đúng-1 từ chối (chống nhân đôi bộ đếm).
test capped_two_supply_states_fails() fail {
  run(
    True,
    [ss_input(ss_policy, 0), ss_input(ss_policy, 1)],
    [registry_ref(0)],
    [signer_x],
    mint_tok(1_000_000),
  )
}

// Token-có-cap: SupplyState NFT GIẢ (policy khác) → không nhận → từ chối.
test capped_forged_supply_state_fails() fail {
  run(True, [ss_input(fake_ss_policy, 0)], [registry_ref(0)], [signer_x], mint_tok(1_000_000))
}

// Token tổng quát (require_supply_state=False): KHÔNG cần SupplyState → ok.
test uncapped_no_supply_state_ok() {
  run(False, [], [registry_ref(0)], [signer_x], mint_tok(1_000_000))
}
