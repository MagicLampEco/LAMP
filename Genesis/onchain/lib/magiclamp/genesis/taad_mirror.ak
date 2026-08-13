// TAAD anchor — ĐỌC datum neo DID do PhoenixKey-Validator quản (reference input, KHÔNG spend).
// `registry_write` (Genesis) cần đúng BA thứ từ đó: `did` (0), `controller_pkh` (2), `status` (5).
//
// ══════════════════════════════════════════════════════════════════════════════
// 🔴 VÌ SAO BẢN NÀY KHÔNG CÒN LÀ "MIRROR STRUCT" (đổi 2026-08-12, vá review PR #20 §1)
// ══════════════════════════════════════════════════════════════════════════════
// Bản trước khai LẠI `TAADDatum` **10 trường** rồi `expect parsed: TAADDatum = data`.
// `TAADDatum` thật ở `PhoenixKey-Validator/lib/phoenixkey/types.ak` có **15 trường**.
// Aiken giải mã Data theo VỊ TRÍ và ĐÚNG số lượng ⇒ 15 trường đổ vào type 10 trường KHÔNG
// "từ chối sạch" mà **CRASH** ⇒ `registry_write` chết trên MỌI anchor thật. Golden test của
// bản trước ghim đúng cái schema sai, nên nó xanh mà vẫn hỏng — test tự đối chiếu với chính
// niềm tin của mình thì không có bên thứ hai nào cả.
// Bản trước còn sai 2 chỗ nữa cùng gốc: `revoked_slot` (tên CHẾT, nay là `revoked_ms`,
// đơn vị mili-giây) và `Recovering` khai 4 trường con trong khi thật có **6**
// (`collateral_refund_pkh`, `pending_device_pkh` nối cuối).
//
// ⇒ NAY: KHÔNG chép lại hình dạng của nhà khác nữa. Giải mã theo CHỈ SỐ (`un_constr_data`
// rồi bốc phần tử 0/2/5), chỉ đòi số trường **≥ 15**. Thêm trường ở cuối → bản này vẫn chạy.
//
// AN TOÀN CỦA LỐI NÀY dựa trên một cam kết ĐÃ NHẬN BẰNG VĂN BẢN, không phải suy đoán:
// PhoenixKey giữ kỷ luật **append-cuối** (mỗi lần thêm trường đều ghi lý do tại chỗ trong
// `types.ak`: `recovery_anchor` "appended last", `limit_meter_policy` "same additive
// discipline", `depth`/`device_pkh`/`pending_device_pkh` "append CUỐI, giữ nguyên index
// 0..N"), và cam kết **gửi thư trước** nếu buộc phải chèn/bớt/đổi thứ tự — khi đó là
// migration on-chain toàn bộ, không phải thay đổi câm.
// Nguồn: thư `Phoenix → LAMP` 2026-08-12 §4, và chính các comment trong `types.ak`.
//
// CÁI LỐI NÀY VẪN KHÔNG CHE ĐƯỢC (ghi rõ, không giấu): nếu PhoenixKey **đổi Ý NGHĨA** của
// vị trí 0/2/5 mà giữ nguyên kiểu, bản này đọc trúng kiểu nhưng sai nghĩa. Chống bằng
// đúng-một-cách: hợp đồng chữ (cam kết trên) + hai ca ghim byte ở cuối tệp.
//
// NEO NGUỒN: `PhoenixKey-Validator` commit **c78e730**, `lib/phoenixkey/types.ak`,
// bộ vector đối-chiếu-chéo `docs/vectors/taad_datum.json` (trường `index` là **0-based** —
// comment trong `types.ak` đánh 1-based, `API.md` của backend đánh 0-based; lấy theo tệp
// vector vì đó là thứ máy đọc).
//
// TAAD anchor NFT: policy ≡ TAAD validator script hash (multi-purpose Design 2 — mint policy
// id == spend script hash, `taad.ak`); asset name = blake2b_256(did). Baked vào
// `registry_write` qua param `taad_policy`.

use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}

// ─── Hằng vị trí + chỉ số ─────────────────────────────────────────────────

/// Số trường TỐI THIỂU của `TAADDatum` mà bản này đòi. Hôm nay `types.ak` có ĐÚNG 15.
/// Đòi `>=` chứ không `==`: PhoenixKey append trường mới vào CUỐI thì bản này vẫn đọc đúng
/// 0/2/5 và không phải phát hành lại. Đòi có sàn (chứ không bỏ hẳn) để một datum cụt —
/// dấu hiệu nhà kia đã BỚT trường, tức đã phá cam kết — bị chặn thay vì đọc bừa.
pub const taad_min_fields: Int = 15

/// Chỉ số 0-based, theo `docs/vectors/taad_datum.json`.
pub const ix_did: Int = 0

pub const ix_controller_pkh: Int = 2

pub const ix_status: Int = 5

/// Chỉ số constructor của `TAADStatus`: 0 Active · 1 Recovering · 2 Migrated · 3 Revoked.
/// `Migrated` (2) là RESERVED — chưa redeemer nào transition tới, nhưng KHÔNG được xoá bên
/// đó (xoá sẽ dịch index của `Revoked`), nên khoảng trống này ổn định.
pub const status_active: Int = 0

pub const status_recovering: Int = 1

pub const status_migrated: Int = 2

pub const status_revoked: Int = 3

// ─── Cái LAMP thật sự cần ─────────────────────────────────────────────────

/// Ba trường `registry_write` dùng. KHÔNG phải bản sao `TAADDatum` — có chủ ý:
/// LAMP không quản vòng đời DID, không có việc gì với 12 trường còn lại.
pub type TaadView {
  did: ByteArray,
  controller_pkh: VerificationKeyHash,
  /// Chỉ số constructor thô của `TAADStatus` (xem hằng `status_*`).
  status: Int,
}

/// Giải mã tolerant theo chỉ số. `None` khi: constructor ngoài 0, hoặc thiếu trường
/// (< `taad_min_fields`) — hai dấu hiệu "nhà kia đã đổi schema kiểu phá vỡ".
///
/// ⚠ Datum SAI KIỂU ở vị trí 0/2/5 (vd trường 0 là Int) làm builtin `un_*_data` **abort**
/// chứ không trả `None`. Đó là fail-closed (giao dịch bị từ chối), đúng hướng an toàn — nêu
/// ra để người đọc sau không tưởng hàm này tổng trên mọi `Data`.
pub fn taad_view(d: Data) -> Option<TaadView> {
  let parts = builtin.un_constr_data(d)
  if parts.1st != 0 {
    None
  } else {
    let fields = parts.2nd
    if list.length(fields) < taad_min_fields {
      None
    } else {
      expect Some(f_did) = list.at(fields, ix_did)
      expect Some(f_ctrl) = list.at(fields, ix_controller_pkh)
      expect Some(f_status) = list.at(fields, ix_status)
      Some(
        TaadView {
          did: builtin.un_b_data(f_did),
          controller_pkh: builtin.un_b_data(f_ctrl),
          status: builtin.un_constr_data(f_status).1st,
        },
      )
    }
  }
}

/// status == Active. Registry write-side chỉ nhận authority từ DID còn sống; Recovering/
/// Migrated/Revoked đều KHÔNG được sửa registry.
/// ⚠ Đường THU HỒI (`Burn`/`Retire`) CỐ Ý không đi qua hàm này — xem `registry_write.ak`.
pub fn status_is_active(s: Int) -> Bool {
  s == status_active
}

// ══════════════════════════════════════════════════════════════════════════════
// HÌNH DẠNG ĐẦY ĐỦ — CHỈ để dựng ca kiểm + ghim byte. KHÔNG dùng để giải mã.
// ══════════════════════════════════════════════════════════════════════════════
// 🔴 KHÔNG được `expect x: TaadAnchorV2 = data` ở bất kỳ đâu trên đường chạy. Đây chính là
// cái sai của bản trước, chỉ khác là lần này đủ 15 trường — mà "đủ hôm nay" sẽ hết đúng
// ngay lần append kế tiếp của PhoenixKey. Đường chạy dùng `taad_view`.
// Type này tồn tại vì hai việc: (a) dựng ref-input thật trong test của `registry_write`;
// (b) ghim BYTE bằng vector do PhoenixKey xuất ra — nếu ngày nào bên đó đổi mà quên báo,
// build gãy TẠI ĐÂY chứ không hỏng câm trên mainnet.

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

pub type TaadStatusShape {
  Active
  Recovering {
    pending_controller_pkh: VerificationKeyHash,
    pending_hw_pubkey: ByteArray,
    deadline_ms: Int,
    collateral_lovelace: Int,
    collateral_refund_pkh: VerificationKeyHash,
    pending_device_pkh: VerificationKeyHash,
  }
  Migrated
  Revoked
}

/// 15 trường, đúng thứ tự `types.ak` @ c78e730.
pub type TaadAnchorV2 {
  did: ByteArray,
  entity_type: EntityType,
  controller_pkh: VerificationKeyHash,
  hw_key_pubkey: ByteArray,
  sequence: Int,
  status: TaadStatusShape,
  guardians: List<VerificationKeyHash>,
  parent_did: Option<ByteArray>,
  revoked_ms: Option<Int>,
  recovery_anchor: Option<ByteArray>,
  limit_meter_policy: Option<ByteArray>,
  pending_meter_policy: Option<Option<ByteArray>>,
  pending_meter_ms: Option<Int>,
  depth: Int,
  device_pkh: VerificationKeyHash,
}

/// Dựng hình dạng GENESIS (đúng bộ 7 vector hiện có: sequence 0, guardians rỗng,
/// trường 7..12 None, depth 0) — chỉ khác `did`/`entity_type`/`controller_pkh`/`status`.
pub fn genesis_anchor(
  did: ByteArray,
  entity_type: EntityType,
  controller_pkh: VerificationKeyHash,
  status: TaadStatusShape,
) -> TaadAnchorV2 {
  TaadAnchorV2 {
    did,
    entity_type,
    controller_pkh,
    hw_key_pubkey: #"022222222222222222222222222222222222222222222222222222222222222222",
    sequence: 0,
    status,
    guardians: [],
    parent_did: None,
    revoked_ms: None,
    recovery_anchor: None,
    limit_meter_policy: None,
    pending_meter_policy: None,
    pending_meter_ms: None,
    depth: 0,
    device_pkh: #"99999999999999999999999999999999999999999999999999999999",
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GHIM BYTE theo vector PhoenixKey-Validator `docs/vectors/taad_datum.json` @ c78e730
// ══════════════════════════════════════════════════════════════════════════════
// Hai chuỗi hex dưới CHÉP NGUYÊN từ trường `datum_cbor_hex` của tệp vector đó — KHÔNG phải
// do bản này tự sinh rồi tự khen. Sinh lại phía LAMP mà ra đúng byte ⇒ hai bên hiểu giống
// nhau về thứ tự trường, chỉ số constructor, và cách đóng gói (mảng vô-hạn 0x9f…ff, chunk
// bytestring > 64 byte, tag cao 0xd90500+ cho constr ≥ 7).

const ctrl_1s: ByteArray = #"11111111111111111111111111111111111111111111111111111111"

/// Ca `did_empty_bytearray` — ca ngắn nhất, `did` rỗng nên không dính chunk.
test golden_case_did_empty_bytearray() {
  let a = genesis_anchor(#"", Person, ctrl_1s, Active)
  cbor.serialise(a) == #"d8799f40d87980581c11111111111111111111111111111111111111111111111111111111582102222222222222222222222222222222222222222222222222222222222222222200d8798080d87a80d87a80d87a80d87a80d87a80d87a8000581c99999999999999999999999999999999999999999999999999999999ff"
}

/// Ca `entity_type_9_max` — `Character` = constr 9 ⇒ dãy tag CAO `0xd90502`, và `did` 100
/// byte ⇒ bytestring bị CHIA CHUNK (0x5f · 64 byte · 26 byte · 0xff). Hai lối mã hoá mà
/// bản 10-trường trước đây chưa từng chạm tới.
test golden_case_entity_type_9_max() {
  let did =
    "did:phoenix:aaaaaaaaaaaac:0303030303030303030303030303030303030303030303030303030303030303"
  let a = genesis_anchor(did, Character, ctrl_1s, Active)
  cbor.serialise(a) == #"d8799f5f58406469643a70686f656e69783a616161616161616161616161633a3033303330333033303330333033303330333033303330333033303330333033303330333033581a3033303330333033303330333033303330333033303330333033ffd9050280581c11111111111111111111111111111111111111111111111111111111582102222222222222222222222222222222222222222222222222222222222222222200d8798080d87a80d87a80d87a80d87a80d87a80d87a8000581c99999999999999999999999999999999999999999999999999999999ff"
}

// ─── Giải mã: bản 15 trường đọc được, và đọc ĐÚNG ba vị trí ────────────────

test view_reads_did_controller_status() {
  let a = genesis_anchor("did:phoenix:org:greensun", Org, ctrl_1s, Active)
  expect Some(v) = taad_view(a)
  and {
    v.did == "did:phoenix:org:greensun",
    v.controller_pkh == ctrl_1s,
    v.status == status_active,
    status_is_active(v.status),
  }
}

/// Đây là ca mà bản 10-trường CRASH. Nay phải trả `Some` và đọc đúng.
test view_survives_full_15_field_anchor() {
  let a = genesis_anchor("did:phoenix:person:x", Person, ctrl_1s, Active)
  taad_view(a) != None
}

test view_maps_each_status_constr() {
  let mk = fn(s) { genesis_anchor("d", Person, ctrl_1s, s) }
  let recovering =
    Recovering {
      pending_controller_pkh: #"aa",
      pending_hw_pubkey: #"bb",
      deadline_ms: 1,
      collateral_lovelace: 2,
      collateral_refund_pkh: #"cc",
      pending_device_pkh: #"dd",
    }
  expect Some(v_act) = taad_view(mk(Active))
  expect Some(v_rec) = taad_view(mk(recovering))
  expect Some(v_mig) = taad_view(mk(Migrated))
  expect Some(v_rev) = taad_view(mk(Revoked))
  and {
    v_act.status == status_active,
    v_rec.status == status_recovering,
    v_mig.status == status_migrated,
    v_rev.status == status_revoked,
    status_is_active(v_act.status),
    !status_is_active(v_rec.status),
    !status_is_active(v_mig.status),
    !status_is_active(v_rev.status),
  }
}

/// Hình dạng GIẢ ĐỊNH của một ngày PhoenixKey append trường thứ 16 (16 trường, constr 0).
/// Chỉ dùng trong test ngay dưới.
type AnchorPlusOne {
  did: ByteArray,
  entity_type: EntityType,
  controller_pkh: VerificationKeyHash,
  hw_key_pubkey: ByteArray,
  sequence: Int,
  status: TaadStatusShape,
  guardians: List<VerificationKeyHash>,
  parent_did: Option<ByteArray>,
  revoked_ms: Option<Int>,
  recovery_anchor: Option<ByteArray>,
  limit_meter_policy: Option<ByteArray>,
  pending_meter_policy: Option<Option<ByteArray>>,
  pending_meter_ms: Option<Int>,
  depth: Int,
  device_pkh: VerificationKeyHash,
  /// trường thứ 16 mà LAMP chưa biết mặt
  something_new: Int,
}

/// Hình dạng CỤT — nhà kia BỚT trường, tức đã phá cam kết append-cuối.
type AnchorTooShort {
  did: ByteArray,
  entity_type: EntityType,
  controller_pkh: VerificationKeyHash,
  hw_key_pubkey: ByteArray,
  sequence: Int,
  status: TaadStatusShape,
}

/// KỶ LUẬT APPEND-CUỐI: PhoenixKey thêm trường thứ 16 → bản này VẪN đọc đúng, không phải
/// phát hành lại. Đây là cả lý do tồn tại của lối giải mã theo chỉ số.
test view_tolerates_future_appended_field() {
  let with_extra =
    AnchorPlusOne {
      did: "did:phoenix:future",
      entity_type: Person,
      controller_pkh: ctrl_1s,
      hw_key_pubkey: #"02",
      sequence: 0,
      status: Active,
      guardians: [],
      parent_did: None,
      revoked_ms: None,
      recovery_anchor: None,
      limit_meter_policy: None,
      pending_meter_policy: None,
      pending_meter_ms: None,
      depth: 0,
      device_pkh: #"99",
      something_new: 42,
    }
  expect Some(v) = taad_view(with_extra)
  and {
    v.did == "did:phoenix:future",
    v.controller_pkh == ctrl_1s,
    v.status == status_active,
  }
}

/// Datum CỤT → chặn, không đọc bừa.
test view_rejects_short_datum() {
  let too_short =
    AnchorTooShort {
      did: "did:phoenix:x",
      entity_type: Person,
      controller_pkh: ctrl_1s,
      hw_key_pubkey: #"02",
      sequence: 0,
      status: Active,
    }
  taad_view(too_short) == None
}

/// Constructor khác 0 (không phải `TAADDatum`) → chặn. `None` của Option là constr 1.
test view_rejects_wrong_constructor() {
  let not_a_datum: Option<ByteArray> = None
  taad_view(not_a_datum) == None
}
