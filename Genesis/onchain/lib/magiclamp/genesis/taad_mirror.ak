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

use aiken/cbor
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

// ══════════════════════════════════════════════════════════════
// GOLDEN CBOR — chốt encoding của mirror (vá review PR #20 §2)
// ══════════════════════════════════════════════════════════════
//
// VÌ SAO CẦN: file này khai là mirror byte-perfect của một repo KHÁC mà repo này không build
// cùng, nên drift là câm. Đa số drift FAIL-CLOSED (lệch số field → arity sai → decode abort;
// lệch field 0 → `d.did == governing_did` bắt). NHƯNG drift CHỈ SỐ CONSTRUCTOR của TAADStatus
// thì KHÔNG: PhoenixKey chèn thêm 1 status ở index 0 sẽ đẩy `Active` sang 1, và
// `status_is_active` — vốn khớp theo INDEX — sẽ nhận status MỚI (vd Frozen) là Active. DID bị
// đóng băng/thu hồi vẫn ghi được Mint-Authority Registry ⇒ BYPASS gate, không phải DoS.
//
// Hai test dưới chốt bytes. Khi cập nhật mirror theo PhoenixKey-Validator: dump CBOR bên đó và
// so với hằng ở đây — lệch thì build gãy TẠI ĐÂY thay vì gate hỏng câm trên mainnet.
// Đây là pin MỘT CHIỀU (khoá encoding phía LAMP), KHÔNG thay được cross-check thật; muốn thật
// thì cần fixture do PhoenixKey-Validator xuất ra, ghim vào cả 2 repo.

/// Chỉ số constructor TAADStatus — cái mà `status_is_active` phụ thuộc vào. Constr n ⇒ tag 121+n.
test taad_status_constr_indices_pinned() {
  and {
    cbor.serialise(Active) == #"d87980",
    cbor.serialise(Migrated) == #"d87b80",
    cbor.serialise(Revoked) == #"d87c80",
    status_is_active(Active),
    !status_is_active(Migrated),
    !status_is_active(Revoked),
    !status_is_active(
      Recovering {
        pending_controller_pkh: #"c0",
        pending_hw_pubkey: #"aabb",
        deadline_slot: 1,
        collateral_lovelace: 2,
      },
    ),
  }
}

/// Toàn bộ TAADDatum: 10 field, đúng thứ tự, EntityType constr 1 (Org), status constr 0 (Active).
test taad_datum_cbor_golden() {
  let sample =
    TAADDatum {
      did: "did:phoenix:org:greensun",
      entity_type: Org,
      controller_pkh: #"c07401",
      hw_key_pubkey: #"beef",
      sequence: 7,
      status: Active,
      guardians: [#"9a"],
      parent_did: None,
      revoked_slot: Some(42),
      recovery_anchor: None,
    }
  // d8799f · 5818 "did:…greensun" · d87a80 (Org=constr 1) · 43 c07401 · 42 beef · 07
  //        · d87980 (Active=constr 0) · 9f 419a ff · d87a80 (None) · d8799f 182a ff (Some 42)
  //        · d87a80 (None) · ff  → ĐÚNG 10 field, ĐÚNG thứ tự types.ak:34-63.
  cbor.serialise(sample) == #"d8799f58186469643a70686f656e69783a6f72673a677265656e73756ed87a8043c0740142beef07d879809f419affd87a80d8799f182affd87a80ff"
}
