// device_action — VERIFIER MẪU #2: uỷ-quyền HÀNH-ĐỘNG THIẾT BỊ (xe / két …).
//
// MỤC TIÊU (chứng minh registry tổng quát + PER-ACTION THRESHOLD): một thiết bị
// có NHIỀU hành động, mỗi hành động một `action_tag` RIÊNG trong bảng, mỗi tag
// một Authorization RIÊNG → ngưỡng KHÁC nhau theo độ nhạy. Ví dụ chính sách:
//   "operate"           → routine, 1-of-2  (tài-xế A HOẶC B vận hành);
//   "transfer-ownership"→ nhạy-cảm, 2-of-2 (cả hai đồng chủ phải ký);
//   "change-policy"     → nhạy-cảm, 2-of-2.
// Cùng một bảng, cùng controller DID, xoay quyền từng action độc lập mà KHÔNG
// redeploy: nâng "operate" lên 2-of-2 khi mất khoá, hoặc Revoke "transfer-
// ownership" khi tranh chấp — chỉ sửa entry tương ứng.
//
// action_tag nhận qua REDEEMER (không bake) → MỘT validator phục vụ MỌI hành
// động của thiết bị; ngưỡng nằm ở bảng, không nằm ở code. Verifier đọc registry,
// tra ĐÚNG entry của action_tag đó, ép Authorization của nó.
//
// Fail-closed: action_tag không có trong bảng / Revoked / thiếu chữ ký /
// thiếu-bảng / 2 bảng → False.
//
// ĐƠN GIẢN HOÁ: chỉ minh hoạ CỔNG authority per-action; state-machine thiết bị
// (datum trạng thái, continuing output) compose riêng tuỳ thiết bị.
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
use magiclamp/tokenomics/registry.{Entry, MultiSig, RegistryDatum}

/// Redeemer MANG action_tag — chọn hành-động muốn uỷ-quyền. Ngưỡng của tag này
/// do bảng quyết định (Authorization của entry), KHÔNG nằm ở đây.
pub type DeviceActionRedeemer {
  action_tag: ByteArray,
}

validator device_action(
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
) {
  spend(
    _datum: Option<Data>,
    redeemer: DeviceActionRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    // TÁI DÙNG đúng cổng dùng-chung — chỉ khác action_tag (từ redeemer). Ngưỡng
    // per-action tự đến từ Authorization của entry tag đó trong bảng.
    registry.authorized_by_registry(
      self,
      registry_nft_policy,
      registry_nft_name,
      redeemer.action_tag,
    )
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — PER-ACTION THRESHOLD (phản biện đối kháng).
//   routine "operate" 1-of-2 pass | sensitive "transfer-ownership" 2-of-2:
//   1 sig fail / 2 sig pass | action_tag không có trong bảng fail | sai-registry
//   fail. CÙNG một bảng, ngưỡng KHÁC nhau theo tag — chứng minh per-action.
// ════════════════════════════════════════════════════════════════════════════

const reg_policy: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

const fake_policy: PolicyId =
  #"deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead"

const reg_name: AssetName =
  #"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"

const gov_did: ByteArray = "did:phoenix:org:fleet"

// 2 đồng-chủ thiết bị (xe / két).
const owner_a: ByteArray =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const owner_b: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const tag_operate: ByteArray = "operate"

const tag_transfer: ByteArray = "transfer-ownership"

// Bảng MỘT thiết bị, 2 action với ngưỡng KHÁC nhau:
//   operate            → 1-of-2 (routine);
//   transfer-ownership → 2-of-2 (nhạy-cảm).
fn device_registry() -> RegistryDatum {
  RegistryDatum {
    governing_did: gov_did,
    entries: [
      Entry {
        action_tag: tag_operate,
        authority: MultiSig { pkhs: [owner_a, owner_b], threshold: 1 },
      },
      Entry {
        action_tag: tag_transfer,
        authority: MultiSig { pkhs: [owner_a, owner_b], threshold: 2 },
      },
    ],
  }
}

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

// Chạy đúng cổng validator gọi, với action_tag (như redeemer) + bảng + chữ ký.
fn run(policy: PolicyId, action_tag: ByteArray, signers: List<ByteArray>) -> Bool {
  let self =
    Transaction {
      ..placeholder,
      reference_inputs: [registry_ref(policy, device_registry())],
      extra_signatories: signers,
    }
  registry.authorized_by_registry(self, reg_policy, reg_name, action_tag)
}

// routine "operate" 1-of-2: chỉ owner_a ký → đủ → cho phép.
test device_operate_one_of_two_ok() {
  run(reg_policy, tag_operate, [owner_a])
}

// sensitive "transfer-ownership" 2-of-2: chỉ 1 ký → thiếu ngưỡng → từ chối.
test device_transfer_one_sig_fails() fail {
  run(reg_policy, tag_transfer, [owner_a])
}

// sensitive "transfer-ownership" 2-of-2: cả hai ký → cho phép.
test device_transfer_two_sigs_ok() {
  run(reg_policy, tag_transfer, [owner_a, owner_b])
}

// action_tag không có trong bảng → fail-closed.
test device_unknown_action_fails() fail {
  run(reg_policy, "self-destruct", [owner_a, owner_b])
}

// Registry NFT GIẢ (policy khác) → không nhận bảng → từ chối.
test device_forged_registry_fails() fail {
  run(fake_policy, tag_operate, [owner_a])
}
