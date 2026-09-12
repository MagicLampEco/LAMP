// reserve_gate — spend validator GIỮ Treasury-pull auth NFT; ép SÀN trước khi cho kéo Reserve.
//
// VAI TRÒ (cầu Reserve↔Treasury, lớp ép sàn):
//   reserve_auth.ak đúc 1 auth NFT one-shot. NFT đó bị KHÓA tại reserve_gate (script này).
//   reserve_draw.ak (Reserve) nhả CHỈ khi tx có 1 input mang auth NFT — nhưng reserve_draw
//   KHÔNG biết logic sàn. reserve_gate là nơi DUY NHẤT ép điều kiện sàn: auth NFT chỉ được
//   spend (→ trở thành input để thỏa reserve_draw) KHI Treasury parked < floor_oildrop. Vì auth
//   NFT không thể rời gate nếu chưa qua kiểm sàn, Reserve nhả ⟺ Treasury thực sự dưới sàn.
//
//   2 validator chạy ĐỒNG THỜI trong 1 tx: reserve_gate (ép sàn + giữ auth) và reserve_draw
//   (ép trần epoch + kế toán Reserve). Phân tách trách nhiệm: gate KHÔNG kiểm chi tiết draw
//   của Reserve (reserve_draw tự ép phần nó); reserve_draw KHÔNG kiểm sàn (gate tự ép).
//
// LUẬT (spend auth UTxO):
//   G-AUTH-1   own input mang auth NFT (auth_policy, auth_name) qty == 1 — authenticity.
//   G-CUST-1   tx có ĐÚNG MỘT custody UTxO THẬT (mang custody NFT
//              (custody_nft_policy, custody_nft_name) qty == 1) trong tập GỘP
//              `tx.inputs ∪ tx.reference_inputs`. Xem khối chú thích tại chỗ ép —
//              PlutusV3 CẤM một TxIn nằm đồng thời ở hai danh sách, nên bắt cứng một
//              vai là bắt cả hệ chọn một trong hai validator.
//   G-FLOOR-1  parked = quantity_of(custody_ref.value, lamp_policy, token_name) < floor_oildrop.
//              CHỈ cho kéo khi PARKED dưới sàn (demand-gated).
//   G-REOUT-1  auth NFT re-output VỀ CHÍNH gate script (địa chỉ ĐẦY ĐỦ, không chỉ payment
//              part), qty == 1. Tái dùng vô hạn; không mất, không burn, không rời script.
//   G-DATUM-1  auth re-output mang INLINE datum decode được về Void. Datum-hash không kèm
//              tiền ảnh ⇒ UTxO không tiêu lại được ⇒ auth NFT chết ⇒ Reserve khoá vĩnh viễn.
//   G-REF-1    auth re-output KHÔNG mang reference_script (thuế min-ADA + phí vĩnh viễn).
//   G-USE-1    tx PHẢI thực sự đúc LAMP (> 0). Chống tiêu rỗng permissionless mỗi block làm
//              mọi tx rút hợp lệ thành vô hiệu — mirror C-COL-11 của custody.ak.
//   G-VALUE-1  lovelace của auth re-output >= lovelace own input. Chống vét ADA của gate.
//   G-NOBURN-1 auth NFT KHÔNG bị mint/burn trong tx (qty mint == 0) — chống đúc auth giả.
//   G-DS-1     đúng 1 input mang auth NFT + đúng 1 output mang auth NFT (chống double-satisfy).
//
// PERMISSIONLESS: bất kỳ ai cũng trigger được KHI parked < floor (không cần chữ ký riêng).
// Datum gate = Void (không trạng thái — chỉ là khóa logic).

use aiken/collection/list
use cardano/address.{Address, Inline, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{DatumHash, Input, InlineDatum, Output, OutputReference, Transaction,
  placeholder}
use magiclamp/treasury/util

/// Đếm UTxO (input/output) mang NFT (policy, name) qty == 1 — đối xứng reserve util.
fn count_inputs_with_nft(inputs: List<Input>, policy: PolicyId, name: ByteArray) -> Int {
  list.count(inputs, fn(i) { assets.quantity_of(i.output.value, policy, name) == 1 })
}

fn count_outputs_with_nft(outputs: List<Output>, policy: PolicyId, name: ByteArray) -> Int {
  list.count(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
}

fn output_with_nft(outputs: List<Output>, policy: PolicyId, name: ByteArray) -> Output {
  expect Some(o) = list.find(outputs, fn(o) { assets.quantity_of(o.value, policy, name) == 1 })
  o
}

/// reserve_gate parameterized — interface contract với Reserve + custody:
///   custody_nft_policy / custody_nft_name — authenticity custody (custody_seed one-shot NFT).
///   lamp_policy / token_name              — LAMP/tLAMP (đo parked trong custody.value).
///   floor_oildrop                             — SÀN parked (oildrop). parked < floor_oildrop mới cho kéo.
///   auth_policy / auth_name               — Treasury-pull auth NFT (= treasury_auth_policy/name
///                                           của reserve_draw; = policy/name reserve_auth đúc).
validator reserve_gate(
  custody_nft_policy : PolicyId,
  custody_nft_name   : ByteArray,
  lamp_policy        : PolicyId,
  token_name         : ByteArray,
  floor_oildrop          : Int,
  auth_policy        : PolicyId,
  auth_name          : ByteArray,
) {
  spend(_datum: Option<Void>, _r: Void, own_ref: OutputReference, tx: Transaction) {
    // ── G-AUTH-1: own input mang auth NFT qty == 1 (authenticity) ──────────
    // Không tin "đây là gate UTxO" chỉ vì ngồi ở script — UTxO rác không-NFT cùng địa
    // chỉ có thể tồn tại. Ghim auth NFT one-shot DUY NHẤT → own input chính danh.
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
    let own_out: Output = own_input.output
    expect assets.quantity_of(own_out.value, auth_policy, auth_name) == 1

    // ── G-DS-1 (vế input): đúng 1 input mang auth NFT (chống 2 gate input chia 1 output) ──
    expect count_inputs_with_nft(tx.inputs, auth_policy, auth_name) == 1

    // ── G-CUST-1: custody UTxO THẬT — CHẤP NHẬN CẢ HAI VAI (reference HOẶC input) ──
    // Ghim NFT one-shot custody_seed: chỉ UTxO mang nó mới là custody "thật" → không thể
    // dựng custody GIẢ (value LAMP thấp giả tạo) để qua mặt kiểm sàn (G-CUST-1-fake).
    //
    // VÌ SAO GỘP HAI DANH SÁCH, không bắt cứng `reference_inputs`:
    //   Ledger vẫn ép `BabbageNonDisjointRefInputs` cho PlutusV3 (nới của cardano-ledger
    //   chỉ áp cho V1/V2 từ protocol version 11), và cả ba module kho này compile ra
    //   `"plutusVersion": "v3"`. ⟹ MỘT TxIn KHÔNG thể vừa ở `tx.inputs` vừa ở
    //   `tx.reference_inputs`. Đường rút Reserve lại bắt buộc TIÊU custody (Genesis
    //   `lamp_mint` nhánh ReserveDraw + `custody` nhánh MigrateIn đòi nó ở `tx.inputs`,
    //   vì chính việc bị tiêu mới kích validator kho ghi Δ vào sổ), trong khi gate này
    //   chạy CÙNG tx đó (`reserve_draw` Luật 5 ép auth NFT ở `gate_script_hash`).
    //   Bắt cứng một vai ⇒ không tx `ReserveDraw` nào dựng được ⇒ pot khoá vĩnh viễn.
    //
    // Ngữ nghĩa SÀN không đổi giữa hai vai: cả hai đều là value TRƯỚC khi Δ hạ cánh
    // (reference = không tiêu nên bất biến; input = trạng thái VÀO của lượt tiêu).
    //
    // `expect [cust_ref]` làm luôn hai việc: chọn phần tử VÀ ép ĐÚNG MỘT. Đúng-một là
    // defense-in-depth: nếu one-shot vỡ, hai UTxO mang NFT cho phép chọn cái parked THẤP
    // để lách sàn — kể cả khi chúng nằm ở hai danh sách khác nhau.
    let cust_candidates =
      list.concat(tx.inputs, tx.reference_inputs)
        |> list.filter(
             fn(i) {
               assets.quantity_of(
                 i.output.value,
                 custody_nft_policy,
                 custody_nft_name,
               ) == 1
             },
           )
    expect [cust_ref] = cust_candidates
    let custody_out: Output = cust_ref.output

    // ── G-FLOOR-1: parked < floor_oildrop (CHỈ cho kéo khi dưới sàn) ───────────
    let parked = assets.quantity_of(custody_out.value, lamp_policy, token_name)
    expect parked < floor_oildrop

    // ── G-REOUT-1 + G-DS-1 (vế output): auth NFT re-output VỀ chính gate script ──
    // own_hash = payment script hash của gate (từ own input address). Đúng 1 output
    // mang auth NFT, ở CÙNG script hash → auth tái dùng, không rời/không mất.
    expect Script(own_hash) = own_out.address.payment_credential
    expect count_outputs_with_nft(tx.outputs, auth_policy, auth_name) == 1
    let auth_out: Output = output_with_nft(tx.outputs, auth_policy, auth_name)
    // Địa chỉ ĐẦY ĐỦ, không chỉ payment credential (bản trước dùng `util.is_at_script`, chỉ so
    // payment part). Gương `reserve_draw.ak:125`. Để tự do phần staking thì phần thưởng staking
    // của UTxO gate chảy về stake credential kẻ dựng tx.
    expect auth_out.address == own_out.address

    // ── G-DATUM-1: auth re-output PHẢI mang inline datum decode được về Void ──
    //
    // Vì sao bắt buộc: ba vế trên chỉ kiểm NƠI ĐẾN và QUYỀN SỞ HỮU của NFT, không kiểm
    // KHẢ NĂNG TIÊU LẠI. Trả auth NFT về đúng địa chỉ gate nhưng gắn `DatumHash(<32 byte
    // ngẫu nhiên>)` thì sổ cái đòi tiền ảnh datum ở lượt tiêu sau ⇒ không ai tiêu lại được.
    // Auth NFT one-shot (`reserve_auth.ak:37`) và cấm burn (G-NOBURN-1 dưới) ⇒ không đúc lại,
    // không thu hồi ⇒ `reserve_draw` Luật 5 vĩnh viễn không thoả ⇒ 9,63 tỷ LAMP Reserve
    // không bao giờ phát hành được nữa. Giá của kẻ tấn công: một phí mạng.
    //
    // Phải viết TƯỜNG MINH, không trông vào kiểu khai ở `_datum: Option<Void>`: đo được
    // Aiken KHÔNG phát cast cho tham số datum bị bỏ qua (compiledCode giống hệt bản
    // `Option<Data>`), nên khai kiểu ở đó không cưỡng chế gì lúc chạy.
    expect InlineDatum(auth_datum) = auth_out.datum
    expect _void: Void = auth_datum

    // ── G-REF-1: không biến gate thành script-carrier (gương reserve_draw.ak:134) ──
    // Đính một reference script ~16 KB đẩy min-ADA của UTxO gate lên ~69 ADA và bắt mọi lượt
    // tiêu sau gánh thêm phí reference-script, vĩnh viễn.
    expect auth_out.reference_script == None

    // ── G-USE-1: gate CHỈ mở khi tx thực sự rút Reserve ────────────────────
    //
    // Bản trước không đòi tx làm gì cả ngoài trả NFT về chỗ cũ ⇒ ai cũng dựng được một tx
    // "tiêu rỗng" mỗi block, và mỗi lượt tiêu làm mọi tx rút hợp lệ đang dựng trên UTxO gate
    // cũ thành vô hiệu. Đây đúng mẫu griefing mà `custody.ak:105` (C-COL-11) đã nhận diện và
    // vá cho nhánh Collect — bài học đó chưa lan sang đây. Đối chứng: `reserve_draw` miễn
    // nhiễm nhờ Luật 4 (`expect delta > 0`).
    expect assets.quantity_of(tx.mint, lamp_policy, token_name) > 0

    // ── G-VALUE-1: không vét ADA của gate ──────────────────────────────────
    // G-REOUT-1 không đòi giữ lovelace, nên mỗi lượt tiêu rút được phần dư về ví người dựng.
    expect assets.lovelace_of(auth_out.value) >= assets.lovelace_of(own_out.value)

    // ── G-NOBURN-1: auth NFT KHÔNG mint/burn trong tx (qty mint == 0) ──────
    // Chống đúc THÊM auth NFT giả cùng tx rồi giữ ở ví thường để né gate (mirror reserve_draw Luật 8).
    expect assets.quantity_of(tx.mint, auth_policy, auth_name) == 0

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests (≥8): happy + negative
// ══════════════════════════════════════════════════════════════

const cust_pol: PolicyId = #"c0c0"

const cust_nm: ByteArray = #"435553"

const lamp_pol: PolicyId = #"7717"

const lamp_nm: ByteArray = #"744c414d50"

const auth_pol: PolicyId = #"a1a1"

const auth_nm: ByteArray = #"5450554c4c"

// SÀN = 100 oildrop (đơn vị test gọn).
const floor: Int = 100

// gate script hash + 1 script hash KHÁC (test sai địa chỉ re-output).
const gate_hash: ByteArray = #"9191"

const other_hash: ByteArray = #"8282"

fn own_ref() -> OutputReference {
  util.mk_ref(0)
}

fn cust_ref() -> OutputReference {
  util.mk_ref(5)
}

/// gate input mang auth NFT qty==1 (datum Void).
fn gate_input() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1)
  util.mk_input(own_ref(), util.mk_output(util.script_address(gate_hash), v, Void))
}

/// gate input KHÔNG mang auth NFT (UTxO rác cùng địa chỉ).
fn gate_input_no_nft() -> Input {
  util.mk_input(
    own_ref(),
    util.mk_output(util.script_address(gate_hash), assets.from_lovelace(2_000_000), Void),
  )
}

/// custody REFERENCE input THẬT (mang custody NFT qty==1), parked LAMP = `parked`.
fn custody_ref_input(parked: Int) -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(cust_pol, cust_nm, 1)
      |> assets.add(lamp_pol, lamp_nm, parked)
  util.mk_input(cust_ref(), util.mk_output(util.script_address(#"d0d0"), v, Void))
}

/// custody REFERENCE input GIẢ (KHÔNG mang custody NFT — value LAMP thấp giả tạo).
fn custody_ref_fake(parked: Int) -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(lamp_pol, lamp_nm, parked)
  util.mk_input(cust_ref(), util.mk_output(util.script_address(#"d0d0"), v, Void))
}

/// auth re-output VỀ gate script (qty==1).
fn auth_output_to_gate() -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1)
  util.mk_output(util.script_address(gate_hash), v, Void)
}

/// auth re-output tới SCRIPT KHÁC (sai địa chỉ).
fn auth_output_wrong_addr() -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1)
  util.mk_output(util.script_address(other_hash), v, Void)
}

fn run(tx: Transaction) -> Bool {
  reserve_gate.spend(
    cust_pol, cust_nm, lamp_pol, lamp_nm, floor, auth_pol, auth_nm,
    Some(Void), Void, own_ref(), tx,
  )
}

/// Δ LAMP đúc trong tx rút — G-USE-1 đòi > 0.
fn lamp_minted(delta: Int) -> assets.Value {
  assets.zero |> assets.add(lamp_pol, lamp_nm, delta)
}

/// tx gate hợp lệ: gate input + custody reference (parked) + auth re-output về gate.
/// `mint` PHẢI mang LAMP > 0 (G-USE-1): gate chỉ mở cho tx thực sự rút Reserve, không mở
/// cho một lượt tiêu rỗng.
fn build_tx(parked: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [gate_input()],
    reference_inputs: [custody_ref_input(parked)],
    outputs: [auth_output_to_gate()],
    mint: lamp_minted(1_000),
  }
}

// ── HAPPY ────────────────────────────────────────────────────

test gate_happy_parked_below_floor() {
  // parked = 50 < floor 100 → cho kéo → pass.
  run(build_tx(50))
}

test gate_happy_parked_zero() {
  // parked = 0 (custody cạn LAMP) < floor → pass.
  run(build_tx(0))
}

// ── NEGATIVE ─────────────────────────────────────────────────

// ── NEGATIVE cho bốn luật thêm 2026-09-05 ────────────────────
// Mỗi ca khác `build_tx` ĐÚNG MỘT chiều, nên lượt từ chối quy được về đúng một luật.

test gate_reject_auth_output_datum_hash() fail {
  // G-DATUM-1: auth re-output mang datum-hash thay vì inline Void.
  //
  // Đây là ca nặng nhất trong bốn: sổ cái đòi tiền ảnh datum ở lượt tiêu sau, nên một
  // datum-hash không kèm tiền ảnh khoá UTxO gate vĩnh viễn. Auth NFT one-shot + cấm burn
  // ⇒ không đúc lại, không thu hồi ⇒ nhánh Reserve chết hẳn.
  let v = assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1)
  let out =
    Output {
      address: util.script_address(gate_hash),
      value: v,
      datum: DatumHash(#"00000000000000000000000000000000000000000000000000000000000000ff"),
      reference_script: None,
    }
  run(
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [out],
      mint: lamp_minted(1_000),
    },
  )
}

test gate_reject_noop_respend() fail {
  // G-USE-1: tx KHÔNG đúc LAMP nào. Bản trước cho qua ⇒ ai cũng tiêu rỗng UTxO gate mỗi
  // block, làm mọi tx rút hợp lệ đang dựng trên UTxO cũ thành vô hiệu (griefing).
  run(
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [auth_output_to_gate()],
      mint: assets.zero,
    },
  )
}

test gate_reject_ada_skim() fail {
  // G-VALUE-1: gate input mang 50 ADA, auth re-output chỉ trả về 2 ADA — 48 ADA còn lại
  // về ví người dựng tx. Bản trước không đòi giữ lovelace nên đây là đường vét.
  let vin = assets.from_lovelace(50_000_000) |> assets.add(auth_pol, auth_nm, 1)
  let rich_input =
    util.mk_input(own_ref(), util.mk_output(util.script_address(gate_hash), vin, Void))
  run(
    Transaction {
      ..placeholder,
      inputs: [rich_input],
      reference_inputs: [custody_ref_input(50)],
      outputs: [auth_output_to_gate()],
      mint: lamp_minted(1_000),
    },
  )
}

test gate_reject_reference_script_on_auth_output() fail {
  // G-REF-1: đính reference script vào auth re-output ⇒ min-ADA của UTxO gate nhảy vọt và
  // mọi lượt tiêu sau gánh thêm phí reference-script, vĩnh viễn.
  let v = assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1)
  let out =
    Output {
      address: util.script_address(gate_hash),
      value: v,
      datum: InlineDatum(Void),
      reference_script: Some(#"beef"),
    }
  run(
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [out],
      mint: lamp_minted(1_000),
    },
  )
}

test gate_reject_attacker_stake_credential() fail {
  // G-REOUT-1 siết: bản trước so PAYMENT credential thôi, nên trả auth NFT về
  // (gate_hash, stake của kẻ tấn công) là hợp lệ — phần thưởng staking của UTxO gate
  // chảy về họ. Nay so địa chỉ ĐẦY ĐỦ.
  let v = assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1)
  let out =
    Output {
      address: Address {
        payment_credential: Script(gate_hash),
        stake_credential: Some(Inline(Script(other_hash))),
      },
      value: v,
      datum: InlineDatum(Void),
      reference_script: None,
    }
  run(
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [out],
      mint: lamp_minted(1_000),
    },
  )
}

test gate_reject_parked_equals_floor() fail {
  // parked == floor (100) → KHÔNG < floor → G-FLOOR-1 reject (sàn là cận chặt).
  run(build_tx(floor))
}

test gate_reject_parked_above_floor() fail {
  // parked = 150 > floor → G-FLOOR-1 reject (trên sàn, không cần kéo).
  run(build_tx(150))
}

test gate_reject_missing_custody_ref() fail {
  // KHÔNG có reference input custody → G-CUST-1 reject (không đọc được parked thật).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [],
      outputs: [auth_output_to_gate()],
      mint: assets.zero,
    }
  run(tx)
}

test gate_reject_fake_custody_ref() fail {
  // custody reference GIẢ (không mang custody NFT) dù parked=0 → G-CUST-1 reject
  // (không tin custody không-NFT → chống dựng custody giả qua mặt sàn).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_fake(0)],
      outputs: [auth_output_to_gate()],
      mint: assets.zero,
    }
  run(tx)
}

test gate_reject_auth_not_reoutput() fail {
  // auth NFT KHÔNG re-output (output không mang auth) → G-REOUT-1 reject (auth biến mất).
  let plain =
    util.mk_output(util.vk_address(#"f00d"), assets.from_lovelace(2_000_000), Void)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [plain],
      mint: assets.zero,
    }
  run(tx)
}

test gate_reject_auth_burn() fail {
  // tx burn auth NFT (mint qty == -1 ≠ 0) → G-NOBURN-1 reject.
  // (auth cũng KHÔNG re-output trong burn → đồng thời vi phạm G-REOUT-1; ép no-burn rõ.)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [auth_output_to_gate()],
      mint: assets.zero |> assets.add(auth_pol, auth_nm, -1),
    }
  run(tx)
}

test gate_reject_auth_wrong_addr() fail {
  // auth re-output tới SCRIPT KHÁC (không phải gate) → G-REOUT-1 reject (auth rời gate).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [auth_output_wrong_addr()],
      mint: assets.zero,
    }
  run(tx)
}

test gate_reject_missing_auth_input() fail {
  // own input KHÔNG mang auth NFT → G-AUTH-1 reject (gate UTxO giả không credential).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input_no_nft()],
      reference_inputs: [custody_ref_input(50)],
      outputs: [auth_output_to_gate()],
      mint: assets.zero,
    }
  run(tx)
}

// ── G-CUST-1 vai INPUT (F1): đường mà bản vá Reserve↔Treasury thực sự đi ──────
// PlutusV3 cấm một TxIn nằm ở cả hai danh sách, mà tx ReserveDraw BẮT BUỘC tiêu custody
// (để validator kho chạy và ghi Δ vào sổ). Ba bài dưới ghim: đường input mở, sàn vẫn ép
// trên đường đó, và đúng-một vẫn ép xuyên hai danh sách.

/// tx gate với custody nằm ở `tx.inputs` (bị TIÊU), KHÔNG ở reference_inputs.
fn build_tx_custody_spent(parked: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [gate_input(), custody_ref_input(parked)],
    reference_inputs: [],
    outputs: [auth_output_to_gate()],
    // PHẢI có mint: `G-USE-1` đòi `quantity_of(tx.mint, lamp_policy, token_name) > 0`.
    // Đây là hình dạng tx ReserveDraw THẬT — draw nhả LAMP bằng cách mint, nên tx không
    // mint là tx không tồn tại trên đường này. Trước khi `G-USE-1` có, chỗ này để
    // `assets.zero` và bài vẫn xanh; sau đó bài âm bên dưới có nguy cơ chết ở `G-USE-1`
    // thay vì ở luật mang tên nó — cùng màu, sai chốt.
    mint: lamp_minted(1_000),
  }
}

test gate_happy_custody_as_spend_input() {
  // custody Ở `tx.inputs`, parked = 50 < floor 100 → pass. Đây là hình dạng tx ReserveDraw
  // thật; trước F1 nó bị G-CUST-1 từ chối và toàn bộ đường Reserve không dựng được.
  run(build_tx_custody_spent(50))
}

test gate_reject_custody_as_spend_input_above_floor() fail {
  // custody Ở `tx.inputs`, parked = 150 > floor → G-FLOOR-1 vẫn reject.
  // Bài này chứng minh việc mở vai input KHÔNG mở luôn cổng sàn.
  run(build_tx_custody_spent(150))
}

test gate_reject_custody_in_both_lists() fail {
  // Hai UTxO mang custody NFT — một ở `inputs`, một ở `reference_inputs`.
  // Tập gộp có 2 phần tử → `expect [cust_ref]` reject.
  //
  // CẢ HAI đều DƯỚI sàn, CÓ CHỦ Ý: nếu đặt một cái trên sàn thì bài chết ở G-FLOOR-1 và
  // không còn đo vế đúng-một nữa. Đo thật bằng đột biến (`[x]` → `[x, ..]`): với hình
  // dạng này bài chuyển sang ĐỎ; với hình dạng "một trên sàn" thì 0 bài đỏ — cùng một
  // tên bài, một cái ghim luật, một cái không ghim gì.
  let second_cust =
    util.mk_input(
      util.mk_ref(6),
      util.mk_output(
        util.script_address(#"d0d0"),
        assets.from_lovelace(2_000_000)
          |> assets.add(cust_pol, cust_nm, 1)
          |> assets.add(lamp_pol, lamp_nm, 0),
        Void,
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input(), custody_ref_input(50)],
      reference_inputs: [second_cust],
      outputs: [auth_output_to_gate()],
      // Có mint, cùng lý do ở `build_tx_custody_spent`: bài này ghim vế "đúng MỘT UTxO
      // mang custody NFT". Để `assets.zero` thì nó chết ở `G-USE-1` trước khi chạm vế đó,
      // và vẫn hiện ĐỎ đúng tên — đỏ đúng chỗ mang tên nó KHÔNG chứng minh nó ghim chỗ đó.
      mint: lamp_minted(1_000),
    }
  run(tx)
}

test gate_reject_two_custody_refs() fail {
  // 2 reference input mang custody NFT (count_inputs_with_nft == 2) → G-CUST-1 reject.
  // Defense-in-depth: chống chọn custody parked thấp để qua sàn nếu one-shot vỡ.
  let second_cust =
    util.mk_input(
      util.mk_ref(6),
      util.mk_output(
        util.script_address(#"d0d0"),
        assets.from_lovelace(2_000_000)
          |> assets.add(cust_pol, cust_nm, 1)
          |> assets.add(lamp_pol, lamp_nm, 0),
        Void,
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input()],
      reference_inputs: [custody_ref_input(50), second_cust],
      outputs: [auth_output_to_gate()],
      mint: assets.zero,
    }
  run(tx)
}

test gate_reject_double_satisfaction_two_auth_inputs() fail {
  // 2 input mang auth NFT (count_inputs_with_nft == 2) → G-DS-1 reject (chống chia chung 1 output).
  let second =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output(
        util.script_address(gate_hash),
        assets.from_lovelace(2_000_000) |> assets.add(auth_pol, auth_nm, 1),
        Void,
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gate_input(), second],
      reference_inputs: [custody_ref_input(50)],
      outputs: [auth_output_to_gate()],
      mint: assets.zero,
    }
  run(tx)
}
