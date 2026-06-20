// mint_registry — Mint-Authority Registry multi-purpose validator (Design-2).
//
// MỘT validator, HAI handler (mint + spend). Vì cả hai cùng một script, policy-id
// của registry NFT ĐỒNG NHẤT với script hash của chính validator. Nhờ vậy:
//   • GENESIS (mint): ledger cấp `own_policy` (= script hash) → mint gate
//     HARD-BIND registry NFT vào output tại Script(own_policy) = địa chỉ chính
//     validator. Standalone policy KHÔNG làm được (vòng phụ thuộc địa chỉ↔policy).
//   • UPDATE (spend): bảng là MỘT UTxO ở địa chỉ này, neo bằng registry NFT
//     singleton (policy = own script hash, name = blake2b_256(governing_did)).
//     spend re-derive own_policy từ script credential của own_input → không bake.
//
// Toàn bộ quyết định thuần ở `magiclamp/tokenomics/registry` (test-được).
//
// Tham số bake tại deploy:
//   governing_did — OrgDID quản bảng (vd GreenSun). Khoá tên NFT = blake2b_256(did).
//   genesis_ref   — UTxO genesis tiêu một-lần (one-shot, chống re-mint).
//   taad_policy   — policy-id state NFT của TAAD validator (= TAAD script hash);
//                   dùng ở UPDATE để định vị DID anchor reference input.
//
// Aiken 1.1.x / Plutus V3.

use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction, find_input}
use magiclamp/tokenomics/registry.{RegistryDatum, RegistryRedeemer, StateNft}

validator mint_registry(
  governing_did: ByteArray,
  genesis_ref: OutputReference,
  taad_policy: PolicyId,
) {
  // ─── GENESIS ─────────────────────────────────────────────────────
  mint(_redeemer: StateNft, own_policy: PolicyId, self: Transaction) {
    registry.validate_genesis(own_policy, governing_did, genesis_ref, self)
  }

  // ─── UPDATE ──────────────────────────────────────────────────────
  spend(
    datum_opt: Option<RegistryDatum>,
    _redeemer: RegistryRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    expect Some(own_input) = find_input(self.inputs, own_ref)
    // own_policy = own script hash (Design-2: policy-id ≡ script hash). Lấy từ
    // payment credential của chính UTxO đang spend.
    expect Script(own_policy) = own_input.output.address.payment_credential
    registry.validate_update(
      own_policy,
      taad_policy,
      governing_did,
      datum,
      own_input.output,
      self,
    )
  }

  else(_) {
    fail
  }
}
