// treasury_spend — VERIFIER MẪU #1: spend validator gác một UTxO quỹ.
//
// MỤC TIÊU (chứng minh registry là PRIMITIVE TỔNG QUÁT, không chỉ mint token):
// cùng một Mint-Authority Registry mà `did_token_mint` dùng để gác AI-mint-token
// thì cũng gác được AI-CHI-QUỸ — chỉ đổi `action_tag`. UTxO quỹ đậu tại địa chỉ
// validator này; cho phép spend ⟺ tx có reference input mang registry NFT của
// governing_did + entry `action_tag = "spend-treasury"` có Authority THOẢ
// (SinglePkh | MultiSig k-of-n | Revoked → cấm).
//
// Minh hoạ thu-hồi-không-redeploy: nhân viên nghỉ → DID controller sửa bảng đặt
// entry "spend-treasury" thành Revoked (hoặc bỏ khoá đó khỏi MultiSig) → KHÔNG
// ai chi được quỹ nữa, mà KHÔNG phải dời quỹ sang địa chỉ mới hay redeploy
// validator. Quyền chi xoay động qua bảng (reference input CIP-31).
//
// ĐƠN GIẢN HOÁ (ghi chú để ngoài, không thuộc trọng tâm GATE authority):
//   - KHÔNG ép accounting (số dư còn lại / continuing-output / chống rút sạch):
//     phần value/kế toán compose riêng tuỳ chính sách quỹ. Verifier này CHỈ minh
//     hoạ CỔNG authority — đúng phạm vi "primitive tổng quát".
//
// Tham số bake tại deploy:
//   registry_nft_policy — policy-id registry NFT (= mint_registry script hash).
//   registry_nft_name   — asset-name registry NFT (= blake2b_256(governing_did)).
//
// Aiken 1.1.x / Plutus V3.

use cardano/address
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/tokenomics/registry.{
  Entry, MultiSig, RegistryDatum, Revoked, SinglePkh,
}

/// action_tag cố định của verifier quỹ — khoá tra cứu trong bảng.
pub const spend_treasury_tag: ByteArray = "spend-treasury"

/// Redeemer trống — toàn bộ authority neo vào bảng (reference input). Một biến
/// thể để CBOR redeemer xác định.
pub type TreasurySpendRedeemer {
  Spend
}

validator treasury_spend(
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
) {
  spend(
    _datum: Option<Data>,
    _redeemer: TreasurySpendRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // TÁI DÙNG cổng dùng-chung của registry — CÙNG đường mà did_token_mint đi,
    // chỉ khác action_tag. Fail-closed: thiếu bảng / không có entry / Revoked /
    // thiếu chữ ký → False.
    registry.authorized_by_registry(
      self,
      registry_nft_policy,
      registry_nft_name,
      spend_treasury_tag,
    )
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — positive + negative (phản biện đối kháng).
//   chi đúng-authority pass | Revoked fail | thiếu-sig fail | sai-registry fail |
//   không-có-entry fail | MultiSig đủ-ngưỡng pass | MultiSig thiếu-ngưỡng fail.
// `run` gọi ĐÚNG cổng mà validator gọi (registry.authorized_by_registry) → test
// đi đúng đường thực thi của validator.
// ════════════════════════════════════════════════════════════════════════════

const reg_policy: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

const fake_policy: PolicyId =
  #"deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead"

const reg_name: AssetName =
  #"abababababababababababababababababababababababababababab"

const gov_did: ByteArray = "did:phoenix:org:greensun"

// nhân viên A / B — đồng-ký quỹ.
const treasurer_a: ByteArray =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const treasurer_b: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const outsider: ByteArray =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

fn reg_datum(entries: List<Entry>) -> RegistryDatum {
  RegistryDatum { governing_did: gov_did, entries }
}

/// reference input mang registry NFT (policy, reg_name) + datum.
fn registry_ref(policy: PolicyId, datum: RegistryDatum) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
      output_index: 0,
    },
    output: Output {
      address: address.from_script(policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(policy, reg_name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn run(refs: List<Input>, signers: List<ByteArray>) -> Bool {
  let self =
    Transaction {
      ..placeholder,
      reference_inputs: refs,
      extra_signatories: signers,
    }
  registry.authorized_by_registry(
    self,
    reg_policy,
    reg_name,
    spend_treasury_tag,
  )
}

// Chi đúng authority (SinglePkh treasurer_a ký) → cho phép.
test treasury_spend_single_ok() {
  let reg = reg_datum([Entry { token_tag: spend_treasury_tag, authority: SinglePkh(treasurer_a) }])
  run([registry_ref(reg_policy, reg)], [treasurer_a])
}

// Nhân viên nghỉ → controller set entry "spend-treasury" = Revoked → KHÔNG chi
// được (không cần dời quỹ / redeploy).
test treasury_spend_revoked_fails() fail {
  let reg = reg_datum([Entry { token_tag: spend_treasury_tag, authority: Revoked }])
  run([registry_ref(reg_policy, reg)], [treasurer_a])
}

// Thiếu chữ ký người được uỷ quyền → từ chối.
test treasury_spend_missing_sig_fails() fail {
  let reg = reg_datum([Entry { token_tag: spend_treasury_tag, authority: SinglePkh(treasurer_a) }])
  run([registry_ref(reg_policy, reg)], [outsider])
}

// Registry NFT GIẢ (policy khác) ở ref input → không nhận bảng → từ chối.
test treasury_spend_forged_registry_fails() fail {
  let reg = reg_datum([Entry { token_tag: spend_treasury_tag, authority: SinglePkh(treasurer_a) }])
  run([registry_ref(fake_policy, reg)], [treasurer_a])
}

// Bảng không có entry "spend-treasury" → fail-closed.
test treasury_spend_no_entry_fails() fail {
  let reg = reg_datum([Entry { token_tag: "other-action", authority: SinglePkh(treasurer_a) }])
  run([registry_ref(reg_policy, reg)], [treasurer_a])
}

// MultiSig 2-of-2: cả hai treasurer ký → cho phép.
test treasury_spend_multisig_ok() {
  let reg =
    reg_datum(
      [
        Entry {
          token_tag: spend_treasury_tag,
          authority: MultiSig { pkhs: [treasurer_a, treasurer_b], threshold: 2 },
        },
      ],
    )
  run([registry_ref(reg_policy, reg)], [treasurer_a, treasurer_b])
}

// MultiSig 2-of-2 nhưng chỉ 1 ký → thiếu ngưỡng → từ chối.
test treasury_spend_multisig_below_threshold_fails() fail {
  let reg =
    reg_datum(
      [
        Entry {
          token_tag: spend_treasury_tag,
          authority: MultiSig { pkhs: [treasurer_a, treasurer_b], threshold: 2 },
        },
      ],
    )
  run([registry_ref(reg_policy, reg)], [treasurer_a])
}
