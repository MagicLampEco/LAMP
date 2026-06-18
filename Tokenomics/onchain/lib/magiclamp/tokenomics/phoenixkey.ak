// PhoenixKey DID authority gate cho LAMP minting (DID-anchored mint authority).
//
// MỤC TIÊU first-principles: quyền mint LAMP KHÔNG neo vào một public-key cố định
// (rotate/recovery sẽ làm mất quyền, buộc redeploy policy → đổi policy-id → vỡ
// toàn bộ token đã lưu hành). Thay vào đó quyền mint neo vào MỘT OrgDID
// PhoenixKey, đọc ĐỘNG controller hiện tại qua reference input (CIP-31). Khi DID
// rotate hoặc recovery xong (status trở lại Active với controller mới), quyền mint
// TỰ ĐI THEO — không redeploy, policy-id bất biến.
//
// HỢP ĐỒNG INTERFACE với PhoenixKey-Validator (Design-2, Math Spec v4.6 §10.4):
//   • DID anchor là MỘT UTxO ở địa chỉ TAAD validator, giữ MỘT state NFT
//     (policy-id = TAAD script hash, asset-name = blake2b_256(did)).
//   • Inline datum của anchor = TAADDatum (layout dưới đây, byte-perfect CBOR).
//   • Reference input KHÔNG chạy validator (read-only) → policy này chỉ ĐỌC datum.
//
// LAYOUT CBOR (PHẢI khớp PhoenixKey-Validator/lib/phoenixkey/types.ak — nếu lệch,
// `expect parsed: TAADDatum = data` decode SAI → mint sai). Type được TÁI ĐỊNH
// NGHĨA tại đây vì LAMP không phụ thuộc repo PhoenixKey-Validator; thứ tự field và
// constr index của enum được sao chép NGUYÊN VẸN để CBOR đồng nhất.
//
// Aiken 1.1.x / Plutus V3.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}

// ─── TAAD types — MIRROR PhoenixKey-Validator (byte-perfect CBOR) ──────────

/// MIRROR `phoenixkey/types.TAADStatus`. Constr index = thứ tự khai báo:
/// Active=0, Recovering=1, Migrated=2, Revoked=3.
pub type TAADStatus {
  Active
  Recovering {
    pending_controller_pkh: ByteArray,
    pending_hw_pubkey: ByteArray,
    deadline_slot: Int,
    collateral_lovelace: Int,
  }
  Migrated
  Revoked
}

/// MIRROR `phoenixkey/types.EntityType`. Constr index = thứ tự khai báo:
/// Person=0, Org=1, Device=2, Machine=3, Asset=4, Bot=5, AI=6, Service=7,
/// Context=8, Character=9.
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

/// MIRROR `phoenixkey/types.TAADDatum`. Constr index 0, 10 field THEO THỨ TỰ —
/// KHÔNG đổi thứ tự (CBOR field-order là hợp đồng).
pub type TAADDatum {
  did: ByteArray,
  entity_type: EntityType,
  controller_pkh: ByteArray,
  hw_key_pubkey: ByteArray,
  sequence: Int,
  status: TAADStatus,
  guardians: List<ByteArray>,
  parent_did: Option<ByteArray>,
  revoked_slot: Option<Int>,
  recovery_anchor: Option<ByteArray>,
}

// ─── Mint-authority gate (pure, testable) ─────────────────────────────────

/// Quyết định: tx này có được mint LAMP dưới policy neo vào anchor
/// (anchor_nft_policy, anchor_nft_name) không?
///
/// Hợp lệ ⟺ TẤT CẢ:
///   (a) KHÔNG burn — mọi movement của LAMP trong tx.mint phải > 0 (LAMP
///       fixed-supply 36 tỷ, KHÔNG nhánh burn — Treasury/CONTRACT.md §5).
///   (b) tồn tại ĐÚNG MỘT reference input value chứa đúng 1 token
///       (anchor_nft_policy, anchor_nft_name) — singleton authority anchor.
///   (c) inline datum của ref input đó decode được thành TAADDatum.
///   (d) datum.controller_pkh ∈ tx.extra_signatories (controller HIỆN TẠI ký).
///   (e) datum.status == Active (Recovering/Migrated/Revoked đều bị từ chối —
///       đang recovery thì KHÔNG cho mint, tránh kẻ cướp DID mint trong cửa sổ).
///   (f) datum.entity_type == Org (chỉ OrgDID là authority phát hành LAMP).
///
/// `own_policy` là policy-id của chính policy LAMP — dùng để soi tx.mint.
pub fn validate_mint(
  own_policy: PolicyId,
  anchor_nft_policy: PolicyId,
  anchor_nft_name: AssetName,
  self: Transaction,
) -> Bool {
  // (a) chặn burn: mọi movement LAMP phải dương. Empty là không thể (policy chỉ
  //     chạy khi LAMP xuất hiện trong tx.mint), nhưng vẫn ép > 0 cho an toàn.
  expect mint_is_pure_positive(self, own_policy)

  // (b)+(c) tìm 1-pass anchor reference input + decode datum.
  expect Some(anchor) =
    find_anchor_datum(self.reference_inputs, anchor_nft_policy, anchor_nft_name)

  and {
    // (d) controller hiện tại ký.
    list.has(self.extra_signatories, anchor.controller_pkh),
    // (e) DID đang Active.
    is_active(anchor.status),
    // (f) authority là Org.
    is_org(anchor.entity_type),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/// Mọi movement của `policy` trong tx.mint là dương (mint thuần, không burn,
/// không qty 0). 1-pass qua dict tokens của policy.
fn mint_is_pure_positive(self: Transaction, policy: PolicyId) -> Bool {
  let moved = dict.to_pairs(assets.tokens(self.mint, policy))
  and {
    list.length(moved) > 0,
    list.all(moved, fn(p) { p.2nd > 0 }),
  }
}

/// Tìm ĐÚNG MỘT reference input mang đúng 1 đơn vị (policy, name) và trả datum
/// đã decode. None nếu zero/>1 ref input thoả, hoặc datum không parse.
///
/// 1-pass: filter reference_inputs theo (policy,name)==1, kỳ vọng đúng 1 phần tử.
/// Hai ref input cùng mang anchor → từ chối (mơ hồ authority).
fn find_anchor_datum(
  refs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Option<TAADDatum> {
  let carriers =
    list.filter(
      refs,
      fn(i) { quantity_of(i.output.value, policy, name) == 1 },
    )
  when carriers is {
    [single] -> read_taad_datum(single.output)
    _ -> None
  }
}

fn read_taad_datum(output: Output) -> Option<TAADDatum> {
  when output.datum is {
    InlineDatum(data) -> {
      expect parsed: TAADDatum = data
      Some(parsed)
    }
    _ -> None
  }
}

fn is_active(s: TAADStatus) -> Bool {
  when s is {
    Active -> True
    _ -> False
  }
}

fn is_org(e: EntityType) -> Bool {
  when e is {
    Org -> True
    _ -> False
  }
}
