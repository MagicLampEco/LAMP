// Mint-Authority Registry — logic thuần (test-được) cho validator `mint_registry`.
//
// MỤC TIÊU first-principles: một OrgDID (vd GreenSun) phát hành NHIỀU token,
// mỗi token có quyền mint RIÊNG (một khoá / multisig / đã thu hồi), có thể
// THAY ĐỔI quyền theo từng token — mà KHÔNG đẻ khoá mới theo token và KHÔNG
// redeploy bất kỳ policy nào. Cách làm: một BẢNG (RegistryDatum) đặt trong một
// UTxO registry, đậu một registry NFT singleton, do DID controller hiện tại
// quản. Mỗi token mint policy `did_token_mint` chỉ ĐỌC bảng này (reference
// input) rồi tra cứu Authority theo `token_tag`.
//
// ─── token_tag là GÌ (quyết định first-principles) ───────────────────────────
// token_tag = ĐỊNH DANH LOGIC ổn định của một dòng token, do GreenSun tự đặt
// (vd "GST", "carbon-v1"). KHÔNG phải policy-id (policy-id của token chỉ sinh ra
// SAU khi bake đủ tham số, trong đó CÓ token_tag → nếu token_tag = policy-id thì
// vòng lặp tự tham chiếu, không khả thi). KHÔNG phải asset-name (đã có
// token_asset_name riêng; tách hai để asset-name người-đọc đổi được mà khoá tra
// cứu vẫn ổn định). token_tag là KHOÁ TRA CỨU trong bảng: bake vào params của
// token policy + làm key của Entry. Một token_tag ↔ một Authority; xoay quyền =
// sửa Entry đó (Single→Multi→Revoked), KHÔNG đổi token_tag, KHÔNG đổi policy-id
// token, KHÔNG đẻ khoá. Đây chính là "quản nhiều token, thu hồi/multisig theo
// từng token, không đẻ khoá theo token".
//
// ─── HỢP ĐỒNG INTERFACE (BẤT BIẾN — chung với Core builders + spec) ──────────
// RegistryDatum = Constr 0 { governing_did: ByteArray, entries: List<Entry> }.
//   Entry      = Constr 0 { token_tag: ByteArray, authority: Authority }.
//   Authority  = SinglePkh(pkh) [constr 0]
//              | MultiSig { pkhs, threshold } [constr 1]
//              | Revoked [constr 2].
// Thứ tự field + constr index LÀ hợp đồng CBOR — KHÔNG đổi.
//
// TAADDatum (DID anchor) TÁI DÙNG mirror trong phoenixkey.ak: controller_pkh
// field idx 2, status idx 5 (Active = constr 0).
//
// Aiken 1.1.x / Plutus V3.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/address
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/tokenomics/phoenixkey.{Active, Org, TAADDatum, TAADStatus}

// ─── Hợp đồng datum bảng ─────────────────────────────────────────────────────

/// Quyền mint của MỘT dòng token. Constr index = thứ tự khai báo (HỢP ĐỒNG).
pub type Authority {
  /// Một khoá đơn ký là đủ. [constr 0]
  SinglePkh(ByteArray)
  /// k-trên-n: đủ `threshold` khoá trong `pkhs` ký. [constr 1]
  MultiSig { pkhs: List<ByteArray>, threshold: Int }
  /// Đã thu hồi — KHÔNG ai mint được dòng token này nữa. [constr 2]
  Revoked
}

/// Một dòng trong bảng: ánh xạ token_tag → Authority. [constr 0]
pub type Entry {
  token_tag: ByteArray,
  authority: Authority,
}

/// Bảng mint-authority do MỘT OrgDID quản. [constr 0]
pub type RegistryDatum {
  governing_did: ByteArray,
  entries: List<Entry>,
}

/// Redeemer spend bảng — chỉ một action (Update). CBOR redeemer xác định.
pub type RegistryRedeemer {
  UpdateRegistry
}

/// Redeemer mint registry NFT — chỉ một action (genesis). CBOR redeemer xác định.
pub type StateNft {
  MintRegistry
}

// ════════════════════════════════════════════════════════════════════════════
// (1a) GENESIS — mint registry NFT one-shot, hard-bind vào Script(own)
// ════════════════════════════════════════════════════════════════════════════

/// Mint hợp lệ ⟺ TẤT CẢ:
///   (a) ONE-SHOT: tx CONSUME đúng UTxO genesis (`genesis_ref`) → policy chạy
///       được tối đa 1 lần trong lịch sử chain → KHÔNG re-mint.
///   (b) mint dưới own_policy ĐÚNG 1 asset-name = blake2b_256(governing_did),
///       qty = +1 (singleton; chặn đa-asset / qty≠1 / burn lẫn vào).
///   (c) NFT đó đậu ở ĐÚNG 1 output tại Script(own_policy) — hard-bind vào địa
///       chỉ chính validator (Design-2: own_policy ≡ script hash). Genesis đặt
///       NFT ở ví khác → None → từ chối.
///   (d) output đó mang inline RegistryDatum parse được, governing_did khớp tên
///       NFT (đã hàm ý qua (b)+(e)) và entries well-formed (không trùng tag).
pub fn validate_genesis(
  own_policy: PolicyId,
  governing_did: ByteArray,
  genesis_ref: OutputReference,
  self: Transaction,
) -> Bool {
  // (a) one-shot.
  expect list.any(self.inputs, fn(i) { i.output_reference == genesis_ref })

  // (b) mint đúng 1 asset-name = blake2b_256(did), qty +1.
  let expected_name = blake2b_256(governing_did)
  expect mint_is_single_nft(self, own_policy, expected_name)

  // (c)+(d) NFT đậu ở Script(own), datum hợp lệ.
  expect Some(reg_out) =
    find_unique_nft_output_at_script(self.outputs, own_policy, expected_name)
  expect Some(reg) = read_registry(reg_out)
  and {
    reg.governing_did == governing_did,
    entries_well_formed(reg.entries),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (1b) UPDATE — spend bảng, ÉP DID controller hiện tại ký + giữ bất biến
// ════════════════════════════════════════════════════════════════════════════

/// Spend hợp lệ ⟺ TẤT CẢ:
///   (a) có ĐÚNG 1 reference input mang DID anchor NFT của governing_did
///       (policy = taad_policy tham số, name = blake2b_256(governing_did)),
///       NFT đậu ở Script(taad_policy) — anchor thật của state machine TAAD.
///   (b) đọc controller_pkh từ datum anchor (động — rotate/recovery tự theo).
///   (c) controller_pkh ∈ extra_signatories (DID controller HIỆN TẠI ký).
///   (d) continuing output: ĐÚNG 1 output tại Script(own) mang registry NFT
///       (own_policy = own script hash; name = blake2b_256(governing_did)).
///   (e) governing_did BẤT BIẾN (datum_out.governing_did == datum_in...).
///   (f) entries_out well-formed (không trùng token_tag).
/// Đầu hàm còn ÉP datum_in.governing_did == `governing_did` (tham số bake của
/// validator) — biến bất biến ngầm (datum khớp param genesis) thành kiểm trực
/// tiếp, miễn nhiễm tái cấu trúc đường genesis.
/// KHÔNG ép status anchor: chỉ cần controller hiện tại ký là đủ quyền sửa bảng;
/// nếu DID đang Recovering thì controller cũ vẫn quản tới khi recovery xong —
/// quyết định bảo toàn quyền liên tục, tránh kẹt bảng giữa cửa sổ recovery.
pub fn validate_update(
  own_policy: PolicyId,
  taad_policy: PolicyId,
  governing_did: ByteArray,
  datum_in: RegistryDatum,
  own_input: Output,
  self: Transaction,
) -> Bool {
  // (F-1) ép datum khớp DID bake — chặn spend UTxO mang datum DID khác.
  expect datum_in.governing_did == governing_did
  let gov = datum_in.governing_did
  let did_name = blake2b_256(gov)

  // (a)+(b) anchor reference input singleton + đọc controller.
  expect Some(anchor) =
    find_anchor_at_script(self.reference_inputs, taad_policy, did_name)

  // (d) continuing output mang registry NFT tại Script(own).
  expect Some(reg_out) =
    find_unique_nft_output_at_script(self.outputs, own_policy, did_name)
  expect Some(datum_out) = read_registry(reg_out)

  and {
    // anchor đúng DID đang quản (phòng tên NFT trùng tình cờ — defence-in-depth).
    anchor.did == gov,
    // (c) controller hiện tại ký.
    list.has(self.extra_signatories, anchor.controller_pkh),
    // own_input thực sự mang registry NFT (chống spend nhầm UTxO khác cùng addr).
    quantity_of(own_input.value, own_policy, did_name) == 1,
    // (e) governing_did bất biến.
    datum_out.governing_did == gov,
    // (f) bảng mới well-formed.
    entries_well_formed(datum_out.entries),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (2) Cổng tra cứu cho token mint policy `did_token_mint`
// ════════════════════════════════════════════════════════════════════════════

/// Mint một dòng token hợp lệ ⟺ TẤT CẢ:
///   (a) có ĐÚNG 1 reference input mang registry NFT
///       (registry_nft_policy, registry_nft_name) — singleton bảng; 2 ref input
///       mang registry → từ chối (mơ hồ nguồn quyền).
///   (b) datum đó decode RegistryDatum; lọc TẤT CẢ Entry có token_tag ==
///       `token_tag` và đòi ĐÚNG 1 (fail-closed): 0 = không có quyền; ≥2 = mơ hồ
///       → từ chối. KHÔNG dùng first-match — tự phòng thủ kể cả nếu có đường ghi
///       datum khác trong tương lai làm vỡ bất biến no-dup do genesis+update giữ.
///   (c) Authority của entry đó thoả:
///         SinglePkh(pkh)        → pkh ∈ extra_signatories;
///         MultiSig{pkhs, thr}   → |pkhs ∩ extra_signatories| ≥ thr (thr ≥ 1);
///         Revoked               → fail.
///   (d) mint dưới own_policy = ĐÚNG 1 asset-name = token_asset_name, qty > 0
///       (chặn burn / qty 0 / asset rác cùng policy-id — vá C-1 của lamp_mint).
pub fn validate_token_mint(
  own_policy: PolicyId,
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
  token_tag: ByteArray,
  token_asset_name: AssetName,
  self: Transaction,
) -> Bool {
  // (d) khoá asset-name + chặn burn/qty0/đa-asset.
  expect mint_is_positive_single(self, own_policy, token_asset_name)

  // (a)+(b)+(c) đọc bảng singleton → tra đúng-1 entry theo tag → ép authority.
  // TÁI DÙNG cổng dùng-chung `authorized_by_registry` (cùng đường mà các verifier
  // mẫu treasury_spend / device_action đi) — KHÔNG lặp lại logic tra-cứu/authority.
  authorized_by_registry(
    self,
    registry_nft_policy,
    registry_nft_name,
    token_tag,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// (2bis) CỔNG TỔNG QUÁT — primitive tái dùng cho MỌI verifier neo authority
//        vào bảng registry (mint token, spend quỹ, hành-động thiết bị, …).
// ════════════════════════════════════════════════════════════════════════════

/// `authorized_by_registry(self, policy, name, action_tag)` = True ⟺:
///   (a) có ĐÚNG 1 reference input mang registry NFT (policy, name) — singleton;
///   (b) datum đó decode RegistryDatum, tra ĐÚNG 1 entry có token_tag ==
///       `action_tag` (fail-closed: 0 = không quyền, ≥2 = mơ hồ → từ chối);
///   (c) Authority của entry đó thoả `self.extra_signatories`
///       (SinglePkh ∈ signers | MultiSig k-of-n | Revoked → False).
/// Đây là CÙNG MỘT cổng `validate_token_mint` dùng — nên các verifier mẫu chỉ cần
/// gọi hàm này với `action_tag` của mình, KHÔNG sao chép logic registry/authority.
pub fn authorized_by_registry(
  self: Transaction,
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
  action_tag: ByteArray,
) -> Bool {
  expect Some(reg) =
    read_registry_ref(self.reference_inputs, registry_nft_policy, registry_nft_name)
  when lookup_authority(reg, action_tag) is {
    Some(auth) -> authority_satisfied(auth, self.extra_signatories)
    None -> False
  }
}

/// Tra Authority của ĐÚNG 1 entry khớp `action_tag` trong bảng (fail-closed):
/// 0 entry = None (không có quyền); ≥2 entry = None (mơ hồ → từ chối, KHÔNG
/// first-match). Pure → test-được độc lập, dùng-chung cho mọi verifier.
pub fn lookup_authority(
  reg: RegistryDatum,
  action_tag: ByteArray,
) -> Option<Authority> {
  when list.filter(reg.entries, fn(e) { e.token_tag == action_tag }) is {
    [entry] -> Some(entry.authority)
    _ -> None
  }
}

/// Reference input DUY NHẤT mang registry NFT (policy,name) → RegistryDatum.
/// 2 ref input mang registry → None (mơ hồ nguồn quyền). Wrap public của
/// `find_registry_ref` để các verifier mẫu tái dùng cùng cách đọc bảng.
pub fn read_registry_ref(
  refs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Option<RegistryDatum> {
  find_registry_ref(refs, policy, name)
}

// ─── Authority check (thuần) ────────────────────────────────────────────────

pub fn authority_satisfied(auth: Authority, signers: List<ByteArray>) -> Bool {
  when auth is {
    SinglePkh(pkh) -> list.has(signers, pkh)
    MultiSig { pkhs, threshold } -> and {
        threshold >= 1,
        count_present(pkhs, signers) >= threshold,
      }
    Revoked -> False
  }
}

/// Số phần tử của `pkhs` xuất hiện trong `signers`. Đếm theo pkh DISTINCT trong
/// pkhs để chống nhồi cùng một khoá nhiều lần lách threshold; signers do ledger
/// dedup nên một chữ ký chỉ tính một lần.
fn count_present(pkhs: List<ByteArray>, signers: List<ByteArray>) -> Int {
  let distinct = dedup(pkhs)
  list.count(distinct, fn(p) { list.has(signers, p) })
}

fn dedup(xs: List<ByteArray>) -> List<ByteArray> {
  when xs is {
    [] -> []
    [h, ..t] ->
      if list.has(t, h) {
        dedup(t)
      } else {
        [h, ..dedup(t)]
      }
  }
}

// ─── Helpers mint / value ────────────────────────────────────────────────────

/// tx.mint dưới `policy` ĐÚNG 1 asset-name = `name`, qty == +1 (NFT singleton).
fn mint_is_single_nft(self: Transaction, policy: PolicyId, name: AssetName) -> Bool {
  let moved = dict.to_pairs(assets.tokens(self.mint, policy))
  when moved is {
    [p] -> and { p.1st == name, p.2nd == 1 }
    _ -> False
  }
}

/// tx.mint dưới `policy` ĐÚNG 1 asset-name = `name`, qty > 0 (token thường).
/// Chặn: burn (qty<0), qty 0, asset-name lạ, mint ≥2 asset-name một lần.
fn mint_is_positive_single(
  self: Transaction,
  policy: PolicyId,
  name: AssetName,
) -> Bool {
  let moved = dict.to_pairs(assets.tokens(self.mint, policy))
  when moved is {
    [p] -> and { p.1st == name, p.2nd > 0 }
    _ -> False
  }
}

/// Output DUY NHẤT mang đúng 1 (policy,name) VÀ đậu tại Script(policy) — None nếu
/// zero / >1, hoặc carrier không ở địa chỉ chính validator (Design-2 hard-bind).
fn find_unique_nft_output_at_script(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Option<Output> {
  let matches =
    list.filter(
      outputs,
      fn(o) {
        quantity_of(o.value, policy, name) == 1 && o.address.payment_credential == address.Script(
          policy,
        )
      },
    )
  when matches is {
    [single] -> Some(single)
    _ -> None
  }
}

/// Anchor DID: reference input DUY NHẤT mang đúng 1 (taad_policy, name) tại
/// Script(taad_policy), trả TAADDatum đã decode. None nếu zero/>1/datum hỏng.
fn find_anchor_at_script(
  refs: List<Input>,
  taad_policy: PolicyId,
  name: AssetName,
) -> Option<TAADDatum> {
  let carriers =
    list.filter(
      refs,
      fn(i) {
        quantity_of(i.output.value, taad_policy, name) == 1 && i.output.address.payment_credential == address.Script(
          taad_policy,
        )
      },
    )
  when carriers is {
    [single] -> read_taad(single.output)
    _ -> None
  }
}

/// Reference input DUY NHẤT mang registry NFT (policy,name), trả RegistryDatum.
/// 2 ref input mang registry → None → token mint từ chối (mơ hồ nguồn quyền).
fn find_registry_ref(
  refs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Option<RegistryDatum> {
  let carriers =
    list.filter(
      refs,
      fn(i) { quantity_of(i.output.value, policy, name) == 1 },
    )
  when carriers is {
    [single] -> read_registry(single.output)
    _ -> None
  }
}

fn read_registry(output: Output) -> Option<RegistryDatum> {
  when output.datum is {
    InlineDatum(data) -> {
      expect parsed: RegistryDatum = data
      Some(parsed)
    }
    _ -> None
  }
}

fn read_taad(output: Output) -> Option<TAADDatum> {
  when output.datum is {
    InlineDatum(data) -> {
      expect parsed: TAADDatum = data
      Some(parsed)
    }
    _ -> None
  }
}

// ─── Well-formed bảng: không trùng token_tag ─────────────────────────────────

/// entries không có hai Entry cùng token_tag (key duy nhất → tra cứu xác định;
/// tránh entry "bóng" qua mặt entry hợp lệ). O(n²) — bảng nhỏ, chấp nhận được.
pub fn entries_well_formed(entries: List<Entry>) -> Bool {
  no_dup_tags(entries)
}

fn no_dup_tags(entries: List<Entry>) -> Bool {
  when entries is {
    [] -> True
    [h, ..t] -> and {
        !list.any(t, fn(e) { e.token_tag == h.token_tag }),
        no_dup_tags(t),
      }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — positive + negative (phản biện đối kháng)
//
//   GENESIS:  registry mint ok | re-mint (thiếu genesis_ref) fail | NFT off-script fail
//   UPDATE:   controller đúng ok | sai chữ ký fail | đổi governing_did fail |
//             mất NFT continuing-output fail | thiếu anchor ref fail
//   TOKEN:    SinglePkh ok | thiếu sig fail | MultiSig đủ-threshold ok |
//             thiếu threshold fail | Revoked fail | token_tag không có fail |
//             asset-name sai fail | 2 registry ref fail
// ════════════════════════════════════════════════════════════════════════════

// ─── Hằng test ───────────────────────────────────────────────────────────────

// policy-id registry NFT (= mint_registry script hash; own_policy do ledger cấp).
const reg_policy: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

// policy-id state NFT TAAD (= anchor authority policy).
const taad_policy: PolicyId =
  #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

// policy GIẢ — kẻ tấn công tự mint NFT cùng tên ở policy khác.
const fake_policy: PolicyId =
  #"deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead"

// policy-id của chính token policy (own_policy của did_token_mint).
const token_policy: PolicyId =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const gov_did: ByteArray = "did:phoenix:org:greensun"

const ctrl_a: ByteArray =
  #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const ctrl_b: ByteArray =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

const signer_x: ByteArray =
  #"d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4"

const signer_y: ByteArray =
  #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

const signer_z: ByteArray =
  #"f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6"

const hw_pub: ByteArray =
  #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

const genesis_oref: OutputReference =
  OutputReference {
    transaction_id: #"7777777777777777777777777777777777777777777777777777777777777777",
    output_index: 0,
  }

const tag_gst: ByteArray = "GST"

const tag_carbon: ByteArray = "carbon-v1"

const tok_name: AssetName = "GreenSunToken"

// ─── Builders ────────────────────────────────────────────────────────────────

fn reg_name() -> AssetName {
  blake2b_256(gov_did)
}

fn reg_datum(did: ByteArray, entries: List<Entry>) -> RegistryDatum {
  RegistryDatum { governing_did: did, entries }
}

/// Value mang đúng 1 NFT (policy,name) + min-ADA.
fn nft_value(policy: PolicyId, name: AssetName) -> assets.Value {
  assets.from_lovelace(2_000_000) |> assets.add(policy, name, 1)
}

/// Output registry tại Script(policy) mang NFT (policy, reg_name) + datum.
fn reg_output_at(policy: PolicyId, datum: RegistryDatum) -> Output {
  Output {
    address: address.from_script(policy),
    value: nft_value(policy, reg_name()),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

/// TAAD anchor datum (Org, Active) với controller cho trước.
fn anchor_datum(ctrl: ByteArray) -> TAADDatum {
  TAADDatum {
    did: gov_did,
    entity_type: Org,
    controller_pkh: ctrl,
    hw_key_pubkey: hw_pub,
    sequence: 5,
    status: Active,
    guardians: [],
    parent_did: None,
    revoked_slot: None,
    recovery_anchor: None,
  }
}

/// Reference input mang TAAD anchor NFT tại Script(policy).
fn anchor_ref(policy: PolicyId, datum: TAADDatum, idx: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: idx,
    },
    output: Output {
      address: address.from_script(policy),
      value: nft_value(policy, reg_name()),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

/// Reference input mang registry NFT (cho token mint) tại Script(reg_policy).
fn registry_ref(datum: RegistryDatum, idx: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
      output_index: idx,
    },
    output: reg_output_at(reg_policy, datum),
  }
}

fn input_consuming(oref: OutputReference) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: address.from_verification_key(ctrl_a),
      value: assets.from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn base_tx() -> Transaction {
  Transaction { ..placeholder }
}

// ════════════════════════════════════════════════════════════════════════════
// GENESIS
// ════════════════════════════════════════════════════════════════════════════

test genesis_ok() {
  let datum = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(reg_policy, reg_name(), 1),
      outputs: [reg_output_at(reg_policy, datum)],
    }
  validate_genesis(reg_policy, gov_did, genesis_oref, tx)
}

// Re-mint: tx KHÔNG consume UTxO genesis → one-shot từ chối.
test genesis_remint_without_seed_fails() fail {
  let datum = reg_datum(gov_did, [])
  let other_ref =
    OutputReference {
      transaction_id: #"8888888888888888888888888888888888888888888888888888888888888888",
      output_index: 1,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(other_ref)],
      mint: assets.zero |> assets.add(reg_policy, reg_name(), 1),
      outputs: [reg_output_at(reg_policy, datum)],
    }
  validate_genesis(reg_policy, gov_did, genesis_oref, tx)
}

// NFT đậu ở ví (off-script) → hard-bind từ chối.
test genesis_nft_off_script_fails() fail {
  let datum = reg_datum(gov_did, [])
  let wallet_out =
    Output {
      address: address.from_verification_key(ctrl_a),
      value: nft_value(reg_policy, reg_name()),
      datum: InlineDatum(datum),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(reg_policy, reg_name(), 1),
      outputs: [wallet_out],
    }
  validate_genesis(reg_policy, gov_did, genesis_oref, tx)
}

// Mint qty 2 (không singleton) → từ chối.
test genesis_mint_two_fails() fail {
  let datum = reg_datum(gov_did, [])
  let out =
    Output {
      address: address.from_script(reg_policy),
      value: assets.from_lovelace(2_000_000) |> assets.add(reg_policy, reg_name(), 2),
      datum: InlineDatum(datum),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(reg_policy, reg_name(), 2),
      outputs: [out],
    }
  validate_genesis(reg_policy, gov_did, genesis_oref, tx)
}

// entries trùng token_tag → not well-formed → từ chối.
test genesis_dup_tag_fails() fail {
  let datum =
    reg_datum(
      gov_did,
      [
        Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) },
        Entry { token_tag: tag_gst, authority: SinglePkh(signer_y) },
      ],
    )
  let tx =
    Transaction {
      ..base_tx(),
      inputs: [input_consuming(genesis_oref)],
      mint: assets.zero |> assets.add(reg_policy, reg_name(), 1),
      outputs: [reg_output_at(reg_policy, datum)],
    }
  validate_genesis(reg_policy, gov_did, genesis_oref, tx)
}

// ════════════════════════════════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════════════════════════════════

fn run_update(datum_in: RegistryDatum, own_input: Output, tx: Transaction) -> Bool {
  validate_update(reg_policy, taad_policy, gov_did, datum_in, own_input, tx)
}

// own_input mang registry NFT tại địa chỉ này (UTxO đang spend).
fn own_reg_input(datum: RegistryDatum) -> Output {
  reg_output_at(reg_policy, datum)
}

test update_ok_when_controller_signs() {
  let din = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  // bảng mới: thêm dòng carbon, đổi quyền GST sang multisig — controller đương nhiệm ký.
  let dout =
    reg_datum(
      gov_did,
      [
        Entry { token_tag: tag_gst, authority: MultiSig { pkhs: [signer_x, signer_y], threshold: 2 } },
        Entry { token_tag: tag_carbon, authority: SinglePkh(signer_z) },
      ],
    )
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// Controller rotate: anchor giờ ghi ctrl_b; ctrl_b ký → vẫn sửa được (quyền theo DID).
test update_ok_after_controller_rotated() {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_b), 0)],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [ctrl_b],
    }
  run_update(din, own_reg_input(din), tx)
}

// Sai chữ ký: anchor ghi ctrl_a nhưng chỉ signer_x ký → từ chối.
test update_wrong_signer_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [signer_x],
    }
  run_update(din, own_reg_input(din), tx)
}

// Đổi governing_did → bất biến vỡ → từ chối.
test update_change_governing_did_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum("did:phoenix:org:attacker", [])
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      // output mang NFT reg_name (theo gov_did cũ) nhưng datum đổi did.
      outputs: [
        Output {
          address: address.from_script(reg_policy),
          value: nft_value(reg_policy, reg_name()),
          datum: InlineDatum(dout),
          reference_script: None,
        },
      ],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// (F-1) datum_in.governing_did ≠ tham số bake → ép DID tường minh từ chối.
// Kẻ tấn công spend UTxO mang datum DID khác qua validator bake gov_did.
test update_datum_did_mismatches_bake_fails() fail {
  let other_did = "did:phoenix:org:attacker"
  let din = reg_datum(other_did, [])
  let dout = reg_datum(other_did, [])
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [ctrl_a],
    }
  // bake gov_did nhưng datum_in mang other_did → mismatch → fail.
  validate_update(reg_policy, taad_policy, gov_did, din, own_reg_input(din), tx)
}

// Mất NFT: continuing output KHÔNG mang registry NFT → từ chối.
test update_loses_nft_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum(gov_did, [])
  let bare_out =
    Output {
      address: address.from_script(reg_policy),
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(dout),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      outputs: [bare_out],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// NFT ra ví (off-script) → continuing output không tại Script(own) → từ chối.
test update_nft_to_wallet_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum(gov_did, [])
  let wallet_out =
    Output {
      address: address.from_verification_key(ctrl_a),
      value: nft_value(reg_policy, reg_name()),
      datum: InlineDatum(dout),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      outputs: [wallet_out],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// Thiếu anchor reference input → không đọc được controller → từ chối.
test update_missing_anchor_ref_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum(gov_did, [])
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// Anchor NFT GIẢ (policy khác) → không nhận anchor → từ chối.
test update_forged_anchor_policy_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout = reg_datum(gov_did, [])
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(fake_policy, anchor_datum(ctrl_a), 0)],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// Bảng mới trùng token_tag → not well-formed → từ chối.
test update_dup_tag_out_fails() fail {
  let din = reg_datum(gov_did, [])
  let dout =
    reg_datum(
      gov_did,
      [
        Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) },
        Entry { token_tag: tag_gst, authority: Revoked },
      ],
    )
  let tx =
    Transaction {
      ..base_tx(),
      reference_inputs: [anchor_ref(taad_policy, anchor_datum(ctrl_a), 0)],
      outputs: [reg_output_at(reg_policy, dout)],
      extra_signatories: [ctrl_a],
    }
  run_update(din, own_reg_input(din), tx)
}

// ════════════════════════════════════════════════════════════════════════════
// TOKEN MINT
// ════════════════════════════════════════════════════════════════════════════

fn mint_token(qty: Int) -> assets.Value {
  assets.zero |> assets.add(token_policy, tok_name, qty)
}

fn run_token(reg: RegistryDatum, refs: List<Input>, signers: List<ByteArray>, mint: assets.Value) -> Bool {
  let tx =
    Transaction {
      ..base_tx(),
      mint: mint,
      reference_inputs: refs,
      extra_signatories: signers,
    }
  validate_token_mint(token_policy, reg_policy, reg_name(), tag_gst, tok_name, tx)
}

test token_mint_single_ok() {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(1_000_000))
}

test token_mint_single_missing_sig_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  run_token(reg, [registry_ref(reg, 0)], [signer_y], mint_token(1_000_000))
}

test token_mint_multisig_threshold_ok() {
  let reg =
    reg_datum(
      gov_did,
      [Entry { token_tag: tag_gst, authority: MultiSig { pkhs: [signer_x, signer_y, signer_z], threshold: 2 } }],
    )
  // 2/3 ký → đủ.
  run_token(reg, [registry_ref(reg, 0)], [signer_x, signer_z], mint_token(500_000))
}

test token_mint_multisig_below_threshold_fails() fail {
  let reg =
    reg_datum(
      gov_did,
      [Entry { token_tag: tag_gst, authority: MultiSig { pkhs: [signer_x, signer_y, signer_z], threshold: 2 } }],
    )
  // chỉ 1 ký → thiếu.
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(500_000))
}

// Nhồi cùng một khoá nhiều lần trong pkhs không lách được threshold (dedup).
test token_mint_multisig_dup_key_no_bypass_fails() fail {
  let reg =
    reg_datum(
      gov_did,
      [Entry { token_tag: tag_gst, authority: MultiSig { pkhs: [signer_x, signer_x, signer_x], threshold: 2 } }],
    )
  // signer_x ký một lần; pkhs nhồi 3 lần x nhưng dedup còn 1 → count 1 < 2 → fail.
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(500_000))
}

test token_mint_revoked_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: Revoked }])
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(1_000_000))
}

// token_tag không có trong bảng → không tìm thấy entry → từ chối.
test token_mint_tag_not_in_registry_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_carbon, authority: SinglePkh(signer_x) }])
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(1_000_000))
}

// (c) read-side fail-closed: bảng có 2 entry TRÙNG token_tag → filter ra ≥2 →
// đòi-đúng-1 từ chối (mơ hồ nguồn quyền), KHÔNG first-match entry đầu.
test token_mint_dup_tag_in_registry_fails() fail {
  let reg =
    reg_datum(
      gov_did,
      [
        Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) },
        Entry { token_tag: tag_gst, authority: SinglePkh(signer_y) },
      ],
    )
  // signer_x ký (khớp entry đầu) nhưng vẫn PHẢI fail vì 2 entry cùng tag.
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(1_000_000))
}

// asset-name sai (token rác cùng policy-id) → khoá C-1 chặn.
test token_mint_wrong_asset_name_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  let junk = assets.zero |> assets.add(token_policy, "JUNK", 1_000_000)
  run_token(reg, [registry_ref(reg, 0)], [signer_x], junk)
}

// burn (qty < 0) → từ chối.
test token_mint_burn_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(-1_000_000))
}

// qty 0 → không "dương" → từ chối.
test token_mint_zero_qty_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  run_token(reg, [registry_ref(reg, 0)], [signer_x], mint_token(0))
}

// 2 asset-name trong 1 tx → khoá asset-name chỉ nhận đúng 1 → từ chối.
test token_mint_two_asset_names_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  let multi =
    assets.zero
      |> assets.add(token_policy, tok_name, 1_000_000)
      |> assets.add(token_policy, "JUNK", 1)
  run_token(reg, [registry_ref(reg, 0)], [signer_x], multi)
}

// 2 reference input cùng mang registry NFT → mơ hồ nguồn quyền → từ chối.
test token_mint_two_registry_refs_fails() fail {
  let reg_real = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  // bảng GIẢ thứ 2 cùng (reg_policy, reg_name) nhưng cho signer_y quyền — nếu policy
  // chọn nhầm cái này kẻ tấn công qua mặt. Singleton-registry PHẢI từ chối cả hai.
  let reg_fake = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_y) }])
  run_token(
    reg_real,
    [registry_ref(reg_real, 0), registry_ref(reg_fake, 1)],
    [signer_x],
    mint_token(1_000_000),
  )
}

// registry NFT GIẢ (policy khác) ở ref input → không nhận → từ chối.
test token_mint_forged_registry_policy_fails() fail {
  let reg = reg_datum(gov_did, [Entry { token_tag: tag_gst, authority: SinglePkh(signer_x) }])
  let forged_ref =
    Input {
      output_reference: OutputReference {
        transaction_id: #"3333333333333333333333333333333333333333333333333333333333333333",
        output_index: 0,
      },
      output: Output {
        address: address.from_script(fake_policy),
        value: nft_value(fake_policy, reg_name()),
        datum: InlineDatum(reg),
        reference_script: None,
      },
    }
  run_token(reg, [forged_ref], [signer_x], mint_token(1_000_000))
}
