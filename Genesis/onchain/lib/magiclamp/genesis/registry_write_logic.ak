// Mint-Authority Registry — WRITE-SIDE (create + update entries), pure testable logic.
// Validator mỏng forward: `validators/registry_write.ak`.
//
// registry.ak (đã có) là READ-side: hàm thuần `validate_mint` cho lamp_mint đọc registry
// làm reference input. File NÀY là WRITE-side: ai được TẠO registry mới cho một governing_did,
// ai được SỬA (thay entries) registry đã có. Trước bản này, KHÔNG có validator write-side nào
// trong repo (kiểm kê 2026-07-10: grep toàn bộ `git log --all`, không tìm thấy registry_write/
// RegistryWrite/tên tương đương; write-side mới chỉ tồn tại dạng offchain builder Rust ở
// PhoenixKey-Core `registry_mint.rs`, CHƯA có mảnh Aiken nào khớp).
//
// THIẾT KẾ (khớp `SPEC/lamp-mint-core-adapter.md` §3 + brief write-side 2026-07-10):
//
//   AUTHORITY = "controller HIỆN TẠI của governing_did", chứng minh bằng:
//     (a) ĐÚNG 1 reference input mang TAAD anchor NFT của governing_did (policy = taad_policy
//         param, name = blake2b_256(governing_did), tại Script(taad_policy));
//     (b) decode TAADDatum (mirror `taad_mirror.ak`); datum.did == governing_did (defense-in-
//         depth, khớp asset-name binding); status == Active (Recovering/Migrated/Revoked KHÔNG
//         được sửa registry);
//     (c) datum.controller_pkh ∈ tx.extra_signatories.
//   Gate NÀY dùng CHUNG cho CẢ mint (Deploy = tạo registry mới) LẪN spend (Update = sửa entries)
//   — "chỉ controller hiện tại mới tạo/sửa được registry của DID mình", một nguồn sự thật.
//
//   REDEEMER SHAPE = Constr rỗng (Deploy=Constr0[], Update=Constr0[]) — KHÔNG thêm field. Khớp
//   BYTE-PERFECT với `registry_mint.rs:605-619` (deploy) + `:770-788` (update): cả 2 builder Core
//   ĐANG gửi `PlutusData::new_empty_constr_plutus_data(index 0)` làm redeemer. Đổi shape (vd thêm
//   genesis_ref) sẽ ĐÒI Core sửa builder — KHÔNG làm ở đây (giữ interface ổn định, Core coi
//   "registry_mint.rs — Core đã có (mirror)" là XONG trong bảng phối hợp adapter §8).
//
//   ONE-SHOT theo governing_did: KHÔNG dùng mẫu genesis_ref tham chiếu UTxO seed (thread_nft.ak)
//   vì registry là script DÙNG CHUNG cho NHIỀU governing_did (asset name = blake2b_256(did) biến
//   thiên theo DID, không phải 1 singleton toàn cục như SupplyState) — KHÔNG bake được 1
//   genesis_ref cố định cho mọi DID, và thêm field genesis_ref vào redeemer sẽ phá byte-compat
//   Core (xem trên). Chặn "đúc NFT registry thứ 2 cho cùng DID" bằng authority-binding: KHÔNG ai
//   thiếu controller_pkh + anchor Active của DID đó tạo được registry (kể cả registry thứ 2).
//   RESIDUAL (ghi rõ, không giấu — cùng loại giới hạn đã biết ở TAAD GenesisPerson,
//   xem PhoenixKey memory `anchor-uniqueness-limit.md`): controller HIỆN TẠI hợp lệ của DID vẫn
//   CÓ THỂ tự mint 1 registry thứ 2 cho DID mình (đúng thẩm quyền, không phải tấn công) →
//   2 UTxO cùng asset-name tại registry script. Downstream fail-closed: registry.ak
//   `find_registry_datum` (đọc) đòi ĐÚNG 1 carrier — thấy ≥2 → None → mọi mint LAMP qua registry
//   đó BỊ KHOÁ. KHÔNG rút được quỹ, KHÔNG ảnh hưởng DID khác.
//   ⚠ SỬA 2026-08-12 (review PR #20 §1): bản đầu mô tả cái trên là "DoS tự gây, chấp nhận được".
//   Mô tả đó THIẾU hai vế. (i) KHÔNG THỂ CỨU: `expect qty == 1` chặn mọi burn và spend luôn ép
//   continuing output ⇒ NFT trùng kẹt vĩnh viễn ⇒ DID mất quyền mint LAMP VĨNH VIỄN, không có
//   đường lùi nào ngoài đổi DID/đổi script. (ii) KHÔNG CẦN CỐ Ý: redeemer rỗng, không nonce,
//   không seed ⇒ chỉ cần controller ký một tx do builder lỗi (deploy chạy lại/retry) hoặc builder
//   độc dựng là brick. "Tự gây" không có nghĩa là "khó xảy ra".
//   ⇒ NAY CÓ ĐƯỜNG THU HỒI: `registry_write` thêm purpose-pair `Burn` (mint, constr 1) +
//   `Retire` (spend, constr 1) — controller hiện tại (CÙNG gate `controller_authorized`) đốt
//   ĐÚNG 1 Registry-NFT để gỡ bản trùng. Deploy/Update GIỮ NGUYÊN constr 0 ⇒ byte-compat
//   `registry_mint.rs` KHÔNG vỡ, Core không phải sửa builder.
//
//   BẤT BIẾN update: NFT ở lại ĐÚNG script address (continuing output DUY NHẤT); governing_did
//   KHÔNG đổi; entries mới `entries_well_formed`; output SẠCH (chỉ NFT + lovelace, không token
//   lạ, không reference_script); NFT KHÔNG mint/burn trong tx Update (D8-#3 style — input bị
//   spend PHẢI mang đúng NFT thật, không tin datum chỉ vì ngồi ở script này).
//
//   entries_well_formed: |entries| ≤ 64 (đối xứng trần pkhs — xem `max_entries`); KHÔNG trùng
//   token_tag; MultiSig → pkhs ≤ 16 (chặn ExUnit DoS, khớp `registry.ak:96-97` read-side),
//   pkhs UNIQUE (chặn datum độc `[k,k,k]` — khác registry.ak vốn chỉ dedupe lúc ĐỌC, ở ĐÂY chặn
//   NGAY LÚC GHI để datum sạch từ gốc), threshold ∈ [1, |pkhs|].

use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use aiken/crypto.{blake2b_256}
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId, Value, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output}
use magiclamp/genesis/registry.{Authority, MultiSig, RegistryEntry, Revoked, SinglePkh}
use magiclamp/genesis/taad_mirror.{TAADDatum, status_is_active}
use magiclamp/genesis/util

// ─── entries_well_formed ────────────────────────────────────────────────────

/// Trần số entry mỗi registry. Đối xứng với trần `pkhs <= 16` bên dưới: read-side
/// `registry.ak.validate_mint` quét TOÀN BỘ entries + decode cả datum trên MỌI tx mint LAMP,
/// nên datum phình = ExUnit phình trên đường nóng, đủ lớn thì mint vượt budget → khoá chính DID
/// đó (cùng loại DoS tự-gây mà trần pkhs sinh ra để chặn, chỉ khác một tầng).
/// ponytail: 64 là trần rộng tay (1 org thực tế vài token), KHÔNG phải số đo được. Nếu có org
/// thật cần >64 token_tag thì nới hằng này — nới được vì chưa registry nào ghi quá 64.
pub const max_entries: Int = 64

/// Bảng entries hợp lệ để ghi (mint genesis HOẶC continuing update) ⟺:
///   (a) số entry ≤ max_entries (chặn ExUnit DoS ở read-side);
///   (b) không token_tag trùng (list.unique trên tag == chính nó);
///   (c) mọi Authority hợp lệ cấu trúc (authority_well_formed).
pub fn entries_well_formed(entries: List<RegistryEntry>) -> Bool {
  let tags = list.map(entries, fn(e) { e.token_tag })
  and {
    list.length(entries) <= max_entries,
    list.length(list.unique(tags)) == list.length(tags),
    list.all(entries, fn(e) { authority_well_formed(e.authority) }),
  }
}

/// SinglePkh/Revoked: luôn hợp lệ cấu trúc (không tham số phụ cần ràng buộc).
/// MultiSig{pkhs,threshold}: pkhs ≤ 16 (DoS), pkhs UNIQUE (không trùng), threshold ∈ [1,|pkhs|].
pub fn authority_well_formed(a: Authority) -> Bool {
  when a is {
    SinglePkh { .. } -> True
    Revoked -> True
    MultiSig { pkhs, threshold } -> {
      let n = list.length(pkhs)
      and {
        n <= 16,
        n == list.length(list.unique(pkhs)),
        threshold >= 1,
        threshold <= n,
      }
    }
  }
}

// ─── TAAD authority (controller HIỆN TẠI của governing_did) ────────────────

/// Đúng 1 reference input mang TAAD anchor NFT (taad_policy, blake2b_256(governing_did)) tại
/// Script(taad_policy) → decode TAADDatum. None nếu 0/≥2/không ở script/parse-fail (fail-closed,
/// mirror `registry.ak.find_registry_datum` + `state_nft_logic.find_owner_reference`).
pub fn find_taad_datum(
  refs: List<Input>,
  taad_policy: PolicyId,
  governing_did: ByteArray,
) -> Option<TAADDatum> {
  let name = blake2b_256(governing_did)
  let carriers =
    list.filter(
      refs,
      fn(i) {
        quantity_of(i.output.value, taad_policy, name) == 1 && util.is_at_script(
          i.output.address,
          taad_policy,
        )
      },
    )
  when carriers is {
    [single] -> read_taad_datum(single.output)
    _ -> None
  }
}

fn read_taad_datum(o: Output) -> Option<TAADDatum> {
  when o.datum is {
    InlineDatum(data) -> {
      expect parsed: TAADDatum = data
      Some(parsed)
    }
    _ -> None
  }
}

/// AUTHORITY tổng: TAAD anchor của governing_did tồn tại (đúng 1, đúng script), datum.did khớp
/// (defense-in-depth, khớp A-1 binding TAAD dùng), status Active, và controller_pkh hiện tại ∈
/// chữ ký tx. Dùng CHUNG cho mint(Deploy) và spend(Update).
pub fn controller_authorized(
  refs: List<Input>,
  taad_policy: PolicyId,
  governing_did: ByteArray,
  sigs: List<ByteArray>,
) -> Bool {
  when find_taad_datum(refs, taad_policy, governing_did) is {
    Some(d) ->
      and {
        d.did == governing_did,
        status_is_active(d.status),
        list.has(sigs, d.controller_pkh),
      }
    None -> False
  }
}

// ─── Mint helpers (genesis output) ──────────────────────────────────────────

/// (name, qty) DUY NHẤT bị chuyển động dưới `policy` trong tx.mint. None nếu 0 hoặc ≥2 tên
/// (chặn mint đa-tên/kèm token rác cùng policy — mirror `registry.ak.mint_is_exactly`).
pub fn minted_pair(mint: Value, policy: PolicyId) -> Option<(AssetName, Int)> {
  let moved = dict.to_pairs(assets.tokens(mint, policy))
  when moved is {
    [p] -> Some((p.1st, p.2nd))
    _ -> None
  }
}

/// Output DUY NHẤT mang đúng 1 (policy,name) VÀ ở Script(policy) (hard-bind — mirror
/// `state_nft_logic.find_unique_output_with_nft` Design-2: policy id ≡ chính script này, nên
/// hard-bind địa chỉ genesis vào validator, không cần param, không tạo vòng).
pub fn find_fresh_output(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Option<Output> {
  let matches =
    list.filter(
      outputs,
      fn(o) { quantity_of(o.value, policy, name) == 1 && o.address.payment_credential == Script(
        policy,
      ) },
    )
  when matches is {
    [single] -> Some(single)
    _ -> None
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — pure helper (entries_well_formed / authority_well_formed / TAAD gate)
// ══════════════════════════════════════════════════════════════

const tag_a: ByteArray = #"4c414d50"

const tag_b: ByteArray = #"4641524d"

const pkh_1: ByteArray = #"11"

const pkh_2: ByteArray = #"22"

const pkh_3: ByteArray = #"33"

test entries_well_formed_single_ok() {
  entries_well_formed([RegistryEntry { token_tag: tag_a, authority: SinglePkh { pkh: pkh_1 } }])
}

test entries_well_formed_dup_tag_fails() {
  !entries_well_formed(
    [
      RegistryEntry { token_tag: tag_a, authority: SinglePkh { pkh: pkh_1 } },
      RegistryEntry { token_tag: tag_a, authority: SinglePkh { pkh: pkh_2 } },
    ],
  )
}

test entries_well_formed_two_distinct_tags_ok() {
  entries_well_formed(
    [
      RegistryEntry { token_tag: tag_a, authority: SinglePkh { pkh: pkh_1 } },
      RegistryEntry { token_tag: tag_b, authority: Revoked },
    ],
  )
}

test authority_multisig_ok() {
  authority_well_formed(MultiSig { pkhs: [pkh_1, pkh_2, pkh_3], threshold: 2 })
}

test authority_multisig_dup_pkh_fails() {
  !authority_well_formed(MultiSig { pkhs: [pkh_1, pkh_1], threshold: 1 })
}

test authority_multisig_threshold_zero_fails() {
  !authority_well_formed(MultiSig { pkhs: [pkh_1, pkh_2], threshold: 0 })
}

test authority_multisig_threshold_over_n_fails() {
  !authority_well_formed(MultiSig { pkhs: [pkh_1, pkh_2], threshold: 3 })
}

test authority_multisig_over_16_fails() {
  let many = list.repeat(pkh_1, 17)
  // 17 bản #"11" trùng nhau -> unique=1 nhưng n=17 > 16 -> fail trước khi tới check unique.
  !authority_well_formed(MultiSig { pkhs: many, threshold: 1 })
}

test entries_at_cap_ok() {
  let at_cap =
    list.map(
      list.range(1, max_entries),
      fn(i) {
        RegistryEntry {
          token_tag: bytearray.push(#"", i),
          authority: SinglePkh { pkh: pkh_1 },
        }
      },
    )
  and { list.length(at_cap) == max_entries, entries_well_formed(at_cap) }
}

test entries_over_cap_fails() {
  let over =
    list.map(
      list.range(1, max_entries + 1),
      fn(i) {
        RegistryEntry {
          token_tag: bytearray.push(#"", i),
          authority: SinglePkh { pkh: pkh_1 },
        }
      },
    )
  and { list.length(over) == max_entries + 1, !entries_well_formed(over) }
}
