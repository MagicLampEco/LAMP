// TAAD anchor datum — MIRROR BYTE-PERFECT `PhoenixKey-Validator/lib/phoenixkey/types.ak:9-63`
// (code THẬT, KHÔNG theo draft). Đây là type CHỈ ĐỂ ĐỌC (reference input, KHÔNG spend) từ
// `registry_write` (Genesis) — cần để xác định "ai là controller HIỆN TẠI của governing_did"
// khi tạo/sửa Mint-Authority Registry. LAMP KHÔNG sở hữu/spend TAAD; chỉ decode datum của
// UTxO neo DID do PhoenixKey-Validator quản lý.
//
// Lệch constr/field-order với PhoenixKey-Validator → decode SAI → gate SAI. Nếu Validator đổi
// schema TAADDatum, file này PHẢI cập nhật đồng thời (interface contract, không tự trị).
//
// TAAD anchor NFT: policy ≡ TAAD validator script hash (multi-purpose Design 2 — mint policy id
// == spend script hash, taad.ak); asset name = blake2b_256(did). Baked vào `registry_write` qua
// param `taad_policy`.

use aiken/crypto.{VerificationKeyHash}

/// Constr 0 Person · 1 Org · 2 Device · 3 Machine · 4 Asset · 5 Bot · 6 AI · 7 Service ·
/// 8 Context · 9 Character. Thứ tự PHẢI khớp `types.ak:21-32`. `registry_write` không đọc field
/// này (chỉ cần decode đúng shape để field sau nó lệch offset đúng) nên không cần enumerate ý
/// nghĩa — chỉ cần khai đủ 10 constructor rỗng, đúng thứ tự.
pub type EntityType {
  Person
  Org
  Device
  Machine
  Asset
  Bot
  AI
  Service
  Context
  Character
}

/// Constr 0 Active · 1 Recovering{..} · 2 Migrated · 3 Revoked. Khớp `types.ak:9-19`.
pub type TAADStatus {
  Active
  Recovering {
    pending_controller_pkh: VerificationKeyHash,
    pending_hw_pubkey: ByteArray,
    deadline_slot: Int,
    collateral_lovelace: Int,
  }
  Migrated
  Revoked
}

/// Constr 0 [did, entity_type, controller_pkh, hw_key_pubkey, sequence, status, guardians,
/// parent_did, revoked_slot, recovery_anchor]. Khớp `types.ak:34-63` — 10 field, thứ tự đúng.
/// `registry_write` chỉ DÙNG field 0 (did), 2 (controller_pkh), 5 (status); các field còn lại
/// bake vào type CHỈ để decode CBOR không lệch offset (Aiken Data-decode positional).
pub type TAADDatum {
  did: ByteArray,
  entity_type: EntityType,
  controller_pkh: VerificationKeyHash,
  hw_key_pubkey: ByteArray,
  sequence: Int,
  status: TAADStatus,
  guardians: List<VerificationKeyHash>,
  parent_did: Option<ByteArray>,
  revoked_slot: Option<Int>,
  recovery_anchor: Option<ByteArray>,
}

/// status == Active (registry write-side chỉ chấp nhận authority từ DID còn sống; Recovering/
/// Migrated/Revoked đều KHÔNG được sửa registry — DID đang trong quy trình khác hoặc đã chết).
pub fn status_is_active(s: TAADStatus) -> Bool {
  when s is {
    Active -> True
    _ -> False
  }
}
