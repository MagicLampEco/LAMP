// ┌─ BẢN CHÉP CÓ NHÃN ─────────────────────────────────────────────────────────┐
// │ Nguồn: github.com/PhoenixKeyDID/Wakeme                                     │
// │        onchain/lib/phoenixkey/anchor_view.ak @ 4512fe6                     │
// │ Chỉ số trường đối chiếu nguồn chuẩn: PhoenixKeyDID/Anchorme                │
// │        onchain/lib/phoenixkey/types.ak ▸ TAADDatum @ fbf8907               │
// │ Ngày chép: 2026-09-28.                                                     │
// │                                                                             │
// │ Vì sao CHÉP mà không phụ thuộc: `phoenixkey/*` nằm ở kho khác, không phát   │
// │ hành thành package Aiken. Chép là mức 3 của luật một-nguồn (nhãn + con trỏ  │
// │ + mốc), không phải mức 1.                                                   │
// │                                                                             │
// │ HAI CHỖ LỆCH BẢN GỐC, cố ý:                                                │
// │  1. Bỏ `use phoenixkey/types` — bản gốc dùng `TAADDatum` để dựng ca kiểm.   │
// │     Ở đây ca kiểm dựng `Data` 18 trường bằng tay (`t_fields18`), nên module │
// │     không kéo theo kiểu của kho khác.                                       │
// │  2. THÊM ba trường đọc thêm cho cổng A-PERSON (`entity_person`,             │
// │     `parent_none`, `depth`) + hàm `anchor_active_and_signed`. Bản gốc không │
// │     phơi ba trường này vì két Wakeme không cần phân loại thực thể; đường    │
// │     biểu quyết thì cần (chỉ DID Person mới là cử tri).                      │
// │                                                                             │
// │ Nghĩa vụ đối ứng: nhà PhoenixKey báo khi chỉ số trường TAAD đổi hoặc khi    │
// │ thêm nhánh cho anchor NFT rời địa chỉ `taad`.                               │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// anchor_view — đọc anchor TAAD THEO VỊ TRÍ, chịu được trường nối cuối.
//
// Vì sao không `expect TAADDatum`: giải mã chặt đòi ĐÚNG số trường của bản chép
// hôm nay, nên mỗi lần kho danh tính nối một trường thì cổng từ chối mọi anchor
// mới. Đọc theo chỉ số là hợp đồng ổn định vì kỷ luật "chỉ nối cuối" áp cho
// trường 10 trở đi.
//
// Chỉ số (khớp `TAADDatum` hôm nay, 18 trường):
//   0 did · 1 entity_type · 2 controller_pkh · 3 hw_key_pubkey · 4 sequence ·
//   5 status · 6 guardians · 7 parent_did · 8 revoked_ms · 9 recovery_anchor ·
//   10 limit_meter_policy · 11 pending_meter_policy · 12 pending_meter_ms ·
//   13 depth · 14 device_pkh · 15 aux_device_pkhs · 16 wakeme_vault_policy ·
//   17 last_active_ms.
//
// `min_fields` GIỮ ở 17: anchor đúc trước lượt nối trường 18 vẫn còn 17 trường
// trên chuỗi và cổng phải đọc được nó (ca `av_doc_17_truong`).

use aiken/builtin
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}

pub type AnchorView {
  controller_pkh: ByteArray,
  status_active: Bool,
  device_pkh: ByteArray,
  aux_device_pkhs: List<ByteArray>,
  wakeme_vault_policy: Option<ByteArray>,
  last_active_ms: Option<Int>,
  // ── THÊM so với bản gốc: ba vế của cổng A-PERSON ──
  entity_person: Bool,
  parent_none: Bool,
  depth: Int,
}

const i_entity: Int = 1

const i_controller: Int = 2

const i_status: Int = 5

const i_parent: Int = 7

const i_depth: Int = 13

const i_device: Int = 14

const i_aux: Int = 15

const i_wakeme: Int = 16

const i_last_active: Int = 17

/// Số trường tối thiểu.
const min_fields: Int = 17

fn field_bytes(fields: List<Data>, i: Int) -> Option<ByteArray> {
  when list.at(fields, i) is {
    Some(d) ->
      if d is b: ByteArray {
        Some(b)
      } else {
        None
      }
    None -> None
  }
}

/// `None` khi datum không phải Constr tag 0, thiếu trường, hoặc một trường cần
/// đọc sai kiểu. Không bao giờ `fail` trên datum Constr.
fn is_constr(d: Data) -> Bool {
  builtin.choose_data(d, True, False, False, False, False)
}

/// Chỉ số Constr của một `Data` nếu nó là Constr, ngược lại `-1` (không khớp
/// chỉ số hợp lệ nào nên mọi phép so bằng đều sai — fail-closed).
fn constr_index(d: Data) -> Int {
  if is_constr(d) {
    builtin.un_constr_data(d).1st
  } else {
    -1
  }
}

pub fn anchor_view(data: Data) -> Option<AnchorView> {
  if !is_constr(data) {
    None
  } else {
    anchor_view_constr(data)
  }
}

fn anchor_view_constr(data: Data) -> Option<AnchorView> {
  let pair = builtin.un_constr_data(data)
  let fields = pair.2nd
  if pair.1st != 0 || list.length(fields) < min_fields {
    None
  } else {
    expect Some(status_d) = list.at(fields, i_status)
    expect Some(aux_d) = list.at(fields, i_aux)
    expect Some(wk_d) = list.at(fields, i_wakeme)
    expect Some(entity_d) = list.at(fields, i_entity)
    expect Some(parent_d) = list.at(fields, i_parent)
    expect Some(depth_d) = list.at(fields, i_depth)
    when (field_bytes(fields, i_controller), field_bytes(fields, i_device)) is {
      (Some(ctrl), Some(dev)) ->
        if aux_d is aux: List<ByteArray> {
          if wk_d is wk: Option<ByteArray> {
            let last_active =
              when list.at(fields, i_last_active) is {
                Some(la) ->
                  if la is t: Int {
                    Some(t)
                  } else {
                    None
                  }
                None -> None
              }
            // depth đọc lỏng: sai kiểu ⇒ −1 ⇒ cổng `depth == 0` từ chối.
            let dp =
              if depth_d is v: Int {
                v
              } else {
                -1
              }
            Some(
              AnchorView {
                controller_pkh: ctrl,
                status_active: constr_index(status_d) == 0,
                device_pkh: dev,
                aux_device_pkhs: aux,
                wakeme_vault_policy: wk,
                last_active_ms: last_active,
                // EntityType: `Person` là constructor đầu ⇒ Constr 0.
                entity_person: constr_index(entity_d) == 0,
                // Option: `Some` = Constr 0, `None` = Constr 1.
                parent_none: constr_index(parent_d) == 1,
                depth: dp,
              },
            )
          } else {
            None
          }
        } else {
          None
        }
      _ -> None
    }
  }
}

/// Chữ ký 2-of-2 của CHÍNH CHỦ: DID Active, controller ký, một thiết bị đã uỷ
/// quyền ký. Nhận `device_pkh` HOẶC bất kỳ `aux_device_pkhs` — giữ đúng ngữ
/// nghĩa bản gốc; siết hơn sẽ khoá đường trung thực của người đã uỷ quyền thiết
/// bị phụ, mà không đóng thêm đường tấn công nào.
pub fn owner_signed(v: AnchorView, signatories: List<ByteArray>) -> Bool {
  and {
    v.status_active,
    list.has(signatories, v.controller_pkh),
    list.has(signatories, v.device_pkh) || list.any(
      v.aux_device_pkhs,
      fn(p) { list.has(signatories, p) },
    ),
  }
}

/// A-PERSON: chỉ DID `Person` GỐC mới là cử tri.
///
/// Ba vế ghép AND, mỗi vế bịt một đường lọt khác nhau, nên đừng gộp làm một:
///   • `entity_person` — loại `Bot`/`Device`/`Asset`/… Tầng danh tính chỉ neo
///     "một người = một DID" cho `Person`; DID con không đi qua cổng duy-nhất
///     sinh trắc, nên nhận mọi loại thực thể là mở đường đúc N cử tri từ một
///     người thật.
///   • `parent_none` — DID con luôn có `parent_did = Some(cha)`.
///   • `depth == 0` — gốc cây sở hữu. Vế thứ ba là vế dự phòng: nó vẫn đúng nếu
///     một lượt sau của tầng danh tính cho phép `Person` có cha.
///
/// Đảo dấu chỉ số ở đây làm cổng CHẶN HẾT (fail-closed), hiện ra ngay ở ca dương
/// — không im lặng cho qua.
pub fn anchor_active_and_signed(
  v: AnchorView,
  signatories: List<ByteArray>,
) -> Bool {
  and {
    owner_signed(v, signatories),
    v.entity_person,
    v.parent_none,
    v.depth == 0,
  }
}

/// Anchor `(policy, name)` trong một danh sách input: ĐÚNG MỘT UTxO ở
/// `Script(policy)` mang token, datum inline, đọc được. Thiếu/thừa/không đọc
/// được ⟹ None.
///
/// Vế địa chỉ `Script(policy)` là vế bản gốc cố ý có: không có nó thì chữ ký
/// chính chủ chỉ đáng tin nhờ một tính chất của validator KHÁC ("anchor không
/// bao giờ rời `taad`"). Cùng policy đó còn đúc token khác loại, nên "token của
/// `taad_policy`" KHÔNG đồng nghĩa "anchor của một DID"; vế địa chỉ là thứ phân
/// biệt hai loại.
pub fn find_anchor_view(
  inputs: List<Input>,
  policy: PolicyId,
  name: ByteArray,
) -> Option<AnchorView> {
  when
    list.filter(
      inputs,
      fn(i) {
        and {
          i.output.address.payment_credential == Script(policy),
          quantity_of(i.output.value, policy, name) == 1,
        }
      },
    )
  is {
    [a] ->
      when a.output.datum is {
        InlineDatum(d) -> anchor_view(d)
        _ -> None
      }
    _ -> None
  }
}

/// Cổng WHO đầy đủ qua anchor làm REFERENCE input: đúng một anchor của
/// `did_commit`, Active, `Person` gốc, hai chữ ký chính chủ.
pub fn person_owner_signed_ref(
  reference_inputs: List<Input>,
  policy: PolicyId,
  did_commit: ByteArray,
  signatories: List<ByteArray>,
) -> Bool {
  when find_anchor_view(reference_inputs, policy, did_commit) is {
    Some(v) -> anchor_active_and_signed(v, signatories)
    None -> False
  }
}

// ════════════════════════════════════════════════════════════
// Tests — chép nguyên bộ ca của bản gốc, dựng `Data` bằng tay
// ════════════════════════════════════════════════════════════

fn d_bytes(b: ByteArray) -> Data {
  builtin.b_data(b)
}

fn d_int(i: Int) -> Data {
  builtin.i_data(i)
}

fn d_some(x: Data) -> Data {
  builtin.constr_data(0, [x])
}

fn d_none() -> Data {
  builtin.constr_data(1, [])
}

/// Status `Active` = Constr 0 không trường.
fn d_active() -> Data {
  builtin.constr_data(0, [])
}

/// Status `Recovering` = Constr 1 (bảy trường; nội dung không được đọc ở đây).
fn d_recovering() -> Data {
  builtin.constr_data(1, [d_bytes(#"c9")])
}

/// 18 trường của `TAADDatum` hôm nay. Tham số hoá đúng những ô các ca cần lật.
fn t_fields18(
  entity_ix: Int,
  status: Data,
  parent: Data,
  depth: Int,
  wk: Data,
) -> List<Data> {
  [
    d_bytes("did:phoenix:t"),
    builtin.constr_data(entity_ix, []),
    d_bytes(#"c1"),
    d_bytes(#"02aa"),
    d_int(3),
    status,
    builtin.list_data([]),
    parent,
    d_none(),
    d_none(),
    d_none(),
    d_none(),
    d_none(),
    d_int(depth),
    d_bytes(#"d1"),
    builtin.list_data([d_bytes(#"d2")]),
    wk,
    d_int(12_345_000),
  ]
}

/// Anchor Person gốc, Active, có `wakeme_vault_policy`.
fn t_person() -> Data {
  builtin.constr_data(
    0,
    t_fields18(0, d_active(), d_none(), 0, d_some(d_bytes(#"ab"))),
  )
}

fn t_fields17() -> List<Data> {
  list.take(t_fields18(0, d_active(), d_none(), 0, d_some(d_bytes(#"ab"))), 17)
}

test av_doc_17_truong() {
  let d17 = builtin.constr_data(0, t_fields17())
  expect Some(v) = anchor_view(d17)
  and {
    v.controller_pkh == #"c1",
    v.status_active,
    v.device_pkh == #"d1",
    v.aux_device_pkhs == [#"d2"],
    v.wakeme_vault_policy == Some(#"ab"),
    v.last_active_ms == None,
    v.entity_person,
    v.parent_none,
    v.depth == 0,
  }
}

test av_doc_18_truong_last_active() {
  expect Some(v) = anchor_view(t_person())
  and {
    v.last_active_ms == Some(12_345_000),
    v.wakeme_vault_policy == Some(#"ab"),
  }
}

test av_doc_19_truong_van_doc() {
  let d19 =
    builtin.constr_data(
      0,
      list.concat(t_fields17(), [d_int(5), d_bytes(#"ff")]),
    )
  expect Some(v) = anchor_view(d19)
  v.last_active_ms == Some(5)
}

test av_truong_18_sai_kieu_thi_khong_co_last_active() {
  let d18 = builtin.constr_data(0, list.concat(t_fields17(), [d_bytes(#"00")]))
  expect Some(v) = anchor_view(d18)
  v.last_active_ms == None
}

test av_16_truong_tu_choi() {
  let short = builtin.constr_data(0, list.take(t_fields17(), 16))
  anchor_view(short) == None
}

test av_khong_phai_constr_tu_choi() {
  and {
    anchor_view(d_int(1)) == None,
    anchor_view(d_bytes(#"00")) == None,
  }
}

test av_tag_khac_0_tu_choi() {
  anchor_view(
    builtin.constr_data(1, t_fields18(0, d_active(), d_none(), 0, d_none())),
  ) == None
}

test av_recovering_khong_active() {
  let d =
    builtin.constr_data(0, t_fields18(0, d_recovering(), d_none(), 0, d_none()))
  expect Some(v) = anchor_view(d)
  !v.status_active
}

test av_owner_signed_can_ca_hai() {
  expect Some(v) = anchor_view(t_person())
  and {
    owner_signed(v, [#"c1", #"d1"]),
    owner_signed(v, [#"c1", #"d2"]),
    !owner_signed(v, [#"c1"]),
    !owner_signed(v, [#"d1", #"d2"]),
  }
}

fn t_anchor_at(pay: ByteArray) -> Input {
  util_input(pay, t_person())
}

fn util_input(pay: ByteArray, d: Data) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"00", output_index: 0 },
    output: Output {
      address: Address {
        payment_credential: Script(pay),
        stake_credential: None,
      },
      value: from_asset(#"aa", #"01", 1),
      datum: InlineDatum(d),
      reference_script: None,
    },
  }
}

/// Anchor phải nằm ở `Script(policy)`: mang đúng NFT nhưng ở script khác ⟹ None.
test av_anchor_ngoai_script_taad_tu_choi() {
  and {
    find_anchor_view([t_anchor_at(#"aa")], #"aa", #"01") != None,
    find_anchor_view([t_anchor_at(#"bb")], #"aa", #"01") == None,
  }
}

// ── A-PERSON: ba vế, mỗi vế một ca đỏ riêng ──

const sigs_ok: List<ByteArray> = [#"c1", #"d1"]

test aperson_person_goc_qua() {
  expect Some(v) = anchor_view(t_person())
  anchor_active_and_signed(v, sigs_ok)
}

/// `entity_type = Bot` (Constr 5) — DID con đúc được hàng loạt từ một Person.
test aperson_bot_tu_choi() {
  let d =
    builtin.constr_data(0, t_fields18(5, d_active(), d_none(), 0, d_none()))
  expect Some(v) = anchor_view(d)
  and {
    // đủ chữ ký, đủ Active, đúng cha, đúng depth — KHÁC bản dương ĐÚNG một ô.
    owner_signed(v, sigs_ok),
    v.parent_none,
    v.depth == 0,
    !anchor_active_and_signed(v, sigs_ok),
  }
}

/// `parent_did = Some(...)` — Person nhưng không phải gốc cây sở hữu.
test aperson_co_cha_tu_choi() {
  let d =
    builtin.constr_data(
      0,
      t_fields18(0, d_active(), d_some(d_bytes("did:phoenix:cha")), 0, d_none()),
    )
  expect Some(v) = anchor_view(d)
  and {
    owner_signed(v, sigs_ok),
    v.entity_person,
    v.depth == 0,
    !anchor_active_and_signed(v, sigs_ok),
  }
}

/// `depth = 1` — vế dự phòng, độc lập với hai vế trên.
test aperson_depth_khac_khong_tu_choi() {
  let d =
    builtin.constr_data(0, t_fields18(0, d_active(), d_none(), 1, d_none()))
  expect Some(v) = anchor_view(d)
  and {
    owner_signed(v, sigs_ok),
    v.entity_person,
    v.parent_none,
    !anchor_active_and_signed(v, sigs_ok),
  }
}

/// Chỉ số `Option` KHÔNG đảo: `Some` = 0, `None` = 1. Nếu đảo, `parent_none`
/// đúng ở ca có cha và sai ở ca không cha — hai ca trên không thể cùng xanh.
test aperson_chi_so_option_dung_chieu() {
  and {
    constr_index(d_none()) == 1,
    constr_index(d_some(d_int(1))) == 0,
  }
}
