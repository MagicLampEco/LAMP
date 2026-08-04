// Mint-Authority Registry gate cho LAMP (token-mint v2, trust-registry).
//
// THAY mô hình v1 (đọc controller_pkh trực tiếp từ anchor TAAD). LAMP KHÔNG còn
// đọc anchor; nó đọc REGISTRY NFT (bảng token_tag → Authority do OrgDID quản).
// Authority "đi theo DID" được nâng 1 tầng: controller DID sửa registry (validator
// Registry, không thuộc file này); LAMP chỉ TIN registry là nguồn authority đã duyệt.
//
// LỢI: least-privilege per-token (mỗi token_tag 1 authority riêng), token đối tác
// (MultiSig), thu hồi 1 token (Revoked) — KHÔNG đẻ sub-DID/khoá theo token, KHÔNG
// redeploy khi rotate (controller đổi ở tầng registry, đọc động).
//
// SCHEMA — MIRROR BYTE-PERFECT `PhoenixKey-Core/.../registry_mint.rs:24-30` (code THẬT,
// KHÔNG theo draft). Lệch constr/field-order → decode SAI → gate SAI.
//   RegistryDatum = Constr 0 [ governing_did: Bytes, entries: List<Entry> ]
//   Entry         = Constr 0 [ token_tag: Bytes, authority: Authority ]
//   Authority: SinglePkh = Constr 0 [Bytes] · MultiSig = Constr 1 [List<Bytes>, Int] · Revoked = Constr 2 []
//   Registry-NFT: policy ≡ registry script hash; name = blake2b_256(governing_did).

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}

// ─── Schema mirror ─────────────────────────────────────────────────────────

/// Constr 0 SinglePkh[pkh] · 1 MultiSig[pkhs,threshold] · 2 Revoked.
pub type Authority {
  SinglePkh { pkh: ByteArray }
  MultiSig { pkhs: List<ByteArray>, threshold: Int }
  Revoked
}

/// Constr 0 [token_tag, authority].
pub type RegistryEntry {
  token_tag: ByteArray,
  authority: Authority,
}

/// Constr 0 [governing_did, entries].
pub type RegistryDatum {
  governing_did: ByteArray,
  entries: List<RegistryEntry>,
}

// ─── Gate (pure, testable) ─────────────────────────────────────────────────

/// Tx này có được mint token (asset = token_asset_name, tag = token_tag) không?
///
/// Hợp lệ ⟺ TẤT CẢ:
///   (a) tx.mint dưới own_policy = ĐÚNG 1 asset-name == token_asset_name, qty > 0
///       (giữ khoá C-1: chặn burn/qty0/asset rác/đa-name).
///   (b) ĐÚNG 1 reference input mang Registry NFT (registry_nft_policy, registry_nft_name).
///   (c) decode RegistryDatum; tìm entry có token_tag == <param>. Không thấy → fail.
///   (d) authority của entry thoả:
///         SinglePkh{pkh}            → pkh ∈ extra_signatories
///         MultiSig{pkhs, threshold} → |{p ∈ pkhs : p ∈ sigs}| ≥ threshold
///         Revoked                   → fail (quyền đã thu hồi)
///
/// LAMP KHÔNG kiểm entity_type/parent_did/status — ràng buộc "registry chỉ do
/// controller DID Active sửa" thuộc về Registry validator (spend). Bind = LAMP bake
/// ĐÚNG registry NFT của GreenSun (policy+name=blake2b_256(did)) + token_tag.
pub fn validate_mint(
  own_policy: PolicyId,
  token_asset_name: AssetName,
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
  token_tag: ByteArray,
  self: Transaction,
) -> Bool {
  // (a) khoá asset-name + chặn burn/qty0/đa-name.
  expect mint_is_exactly(self, own_policy, token_asset_name)

  // (b)+(c) đúng 1 registry ref input → decode → tra ĐÚNG-1 entry theo tag.
  expect Some(reg) =
    find_registry_datum(self.reference_inputs, registry_nft_policy, registry_nft_name)

  // (d) ép authority. Fail-closed đúng-1 (KHỚP canonical Tokenomics
  // `lookup_authority`): 0 entry = không quyền; ≥2 entry trùng tag = mơ hồ → từ
  // chối, KHÔNG first-match. Write-side (`entries_well_formed`) đã chặn dup, đây là
  // read-side defence-in-depth phòng đường-ghi-datum tương lai làm vỡ bất biến.
  when list.filter(reg.entries, fn(e) { e.token_tag == token_tag }) is {
    [entry] -> authority_satisfied(entry.authority, self.extra_signatories)
    _ -> False
  }
}

/// SinglePkh → 1 sig; MultiSig → M-of-N; Revoked → False.
///
/// Tự vệ datum registry độc hại (audit MED 19/6, đối xứng util.count_sigs):
///   • DEDUPE pkhs (list.unique) — chống `[k1,k1,k1] threshold 3` thoả bằng 1 chữ ký k1.
///   • threshold ∈ [1, |unique pkhs|] — chống threshold ≤ 0 (0 chữ ký vẫn pass) + khoá chết.
pub fn authority_satisfied(a: Authority, sigs: List<ByteArray>) -> Bool {
  when a is {
    SinglePkh { pkh } -> list.has(sigs, pkh)
    MultiSig { pkhs, threshold } -> {
      // chặn ExUnit DoS: authority MultiSig hợp lý ≤ 16 khoá (audit systems HIGH).
      expect list.length(pkhs) <= 16
      let uniq = list.unique(pkhs)
      let n = list.count(uniq, fn(p) { list.has(sigs, p) })
      threshold >= 1 && threshold <= list.length(uniq) && n >= threshold
    }
    Revoked -> False
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// tx.mint dưới policy = ĐÚNG 1 (name, qty) với name == token_name, qty > 0.
fn mint_is_exactly(self: Transaction, policy: PolicyId, token_name: AssetName) -> Bool {
  let moved = dict.to_pairs(assets.tokens(self.mint, policy))
  when moved is {
    [p] -> and { p.1st == token_name, p.2nd > 0 }
    _ -> False
  }
}

/// Đúng 1 reference input mang (policy,name) NFT **VÀ ngụ tại đúng script registry**
/// → decode RegistryDatum. None nếu 0/≥2/parse-fail/sai địa chỉ.
///
/// ĐỪNG GỠ RÀNG BUỘC ĐỊA CHỈ. Lọc theo NFT không thôi thì bất kỳ UTxO nào mang
/// registry NFT — kể cả ví thường — cũng mở được cổng mint, và datum trên đó do
/// chính người dựng tx đặt (bịa `authority = SinglePkh(ví_mình)` là mint được).
/// Hôm nay NFT chưa rời được script (đúc one-shot + `validate_update` luôn ép
/// continuing output tại `Script(own)`), nên đây là defence-in-depth — nhưng an
/// toàn của LAMP không nên treo vào một bất biến nằm ở validator khác, không được
/// ghi ở đâu và không được kiểm ở đâu. Bản v1 (`Legacy/Tokenomics-v1-anchor/…/
/// phoenixkey.ak:142-156`) thiếu đúng mệnh đề này và PoC mint được LAMP không giới
/// hạn từ anchor đặt ở ví thường.
/// Pin được mà KHÔNG cần thêm tham số vì Registry-NFT policy ≡ registry script
/// hash (xem header file).
fn find_registry_datum(
  refs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Option<RegistryDatum> {
  let carriers =
    list.filter(
      refs,
      fn(i) {
        quantity_of(i.output.value, policy, name) == 1 && i.output.address.payment_credential == Script(
          policy,
        )
      },
    )
  when carriers is {
    [single] -> read_registry_datum(single.output)
    _ -> None
  }
}

fn read_registry_datum(output: Output) -> Option<RegistryDatum> {
  when output.datum is {
    InlineDatum(data) -> {
      expect parsed: RegistryDatum = data
      Some(parsed)
    }
    _ -> None
  }
}
