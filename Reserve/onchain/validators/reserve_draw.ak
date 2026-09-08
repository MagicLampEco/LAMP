// reserve_draw — spend validator giữ ReserveState UTxO; nhả DEMAND-GATED qua Treasury-pull.
//
// FIRST-PRINCIPLES — Reserve = lớp đệm sau cùng, trần CỨNG mỗi epoch:
//   Reserve KHÔNG nhả theo lịch thời gian. Mỗi epoch Treasury "kéo" (pull) tối đa
//   max_per_epoch = total_oildrop / 1000 oildrop. Treasury co-spend authority NFT của nó để
//   chứng "kéo"; logic sàn (parked < floor) nằm Ở TREASURY (ngoài phạm vi Reserve).
//   Reserve chỉ đòi: (a) sự hiện diện auth NFT, (b) ≤1 draw/epoch (t > last_epoch),
//   (c) delta ≤ trần epoch, (d) delta ≤ pot còn lại. KHÔNG cộng dồn catch-up: dư ở
//   lại pot, nhả epoch sau → tổng kéo dài tối thiểu ~1000 epoch.
//
//   Mỗi "draw" = spend ReserveState (mang reserve thread NFT) + mint delta tLAMP qua
//   Genesis route ReserveDraw, ĐỒNG THỜI tiêu UTxO KHO (mang kho NFT) để kho tự ép Δ vào
//   SỔ của nó. drawn_oildrop += delta; last_epoch := t. start_epoch + total_oildrop
//   GIỮ NGUYÊN (bất biến).
//
// LUẬT 9 — VÌ SAO ĐO "KHO BỊ TIÊU", KHÔNG ĐO "ĐỊA CHỈ NHẬN ĐỦ":
//   Bản trước ép `qty_to_credential(tx.outputs, reserve_dest, …) >= delta` — tức đo TỔNG
//   mặt output tới một ĐỊA CHỈ. Hai hỏng cùng lúc:
//     (a) đo tổng cho phép TÁI CHẾ (kho đang giữ X ≥ delta, trả lại đúng X, delta mới ra ví);
//     (b) đúng địa chỉ KHÔNG có nghĩa là vào SỔ — UTxO rót thẳng không datum thì kho tiêu
//         lại không được, Δ đóng băng ngoài sổ = đốt trá hình, trái bất biến "LAMP không đốt".
//   Nay Reserve KHÔNG tự đo đích nữa: nó chỉ ép tx PHẢI tiêu đúng 1 UTxO mang kho NFT.
//   Kho bị tiêu ⇒ validator của chính kho chạy ⇒ kho ép Δ vào value VÀ vào sổ (C-MIG-7/8).
//   Đo hộ người khác chính là chỗ đẻ ra lỗ này.
//   Lợi ích kèm theo: địa chỉ kho không còn bị nướng vào script hash của Reserve, nên
//   quyết định "kho có uỷ quyền stake không" KHÔNG còn ràng vào apply-param.
//
// Quan hệ với Genesis (lamp_mint): Genesis route ReserveDraw đòi tx spend đúng 1 UTxO
// mang "meter" NFT (gate nhịp). reserve thread NFT của ReserveState ĐÓNG vai meter đó —
// reserve_draw CHÍNH là gate nhịp. (Orchestrator chốt: meter_nft = reserve_thread.)
//
// Param:
//   lamp_policy           — minting policy LAMP/tLAMP (Genesis lamp_mint), đo Δ mint.
//   token_name             — asset name LAMP/tLAMP (param: testnet "tLAMP" / mainnet "LAMP").
//   reserve_thread_policy — policy reserve thread NFT one-shot (authenticity ReserveState).
//   reserve_thread_name   — asset name reserve thread NFT.
//   ms_per_epoch          — độ dài epoch (POSIX ms) theo network.
//   kho_nft_policy        — policy NFT one-shot ĐỊNH DANH kho (Treasury custody). Thay cho
//                           `reserve_dest` cũ: định danh kho bằng NFT chứ không bằng địa chỉ.
//                           ⚠ CẶP NÀY PHẢI TRÙNG `reserve_kho_nft_policy`/`reserve_kho_nft_name`
//                           (khe #13-14 của `Genesis/onchain/validators/lamp_mint.ak`), tức
//                           `(seed_policy, instance_id)` của instance `custody` đích. Đó KHÔNG
//                           phải cặp `kho_nft_*` (#9-10) của `lamp_mint` — cặp đó trỏ kho
//                           Distribution. Truyền lệch hai chỗ này thì mỗi validator canh một
//                           cái kho khác nhau và cả hai vẫn xanh: khoá ba tầng đứt ở tầng nối
//                           dây, không tầng nào báo.
//   kho_nft_name          — asset name kho NFT.
//   treasury_auth_policy  — policy NFT co-spend authority của Treasury (Treasury-pull gate).
//   treasury_auth_name    — asset name Treasury auth NFT.
//   gate_script_hash      — script hash của reserve_gate (Treasury). Auth NFT BẮT BUỘC
//                           được spend TỪ input nằm ở gate này → ép kích reserve_gate.spend
//                           (nơi DUY NHẤT kiểm sàn parked < floor). Hằng truyền vào —
//                           gate KHÔNG phụ thuộc reserve_draw → không vòng phụ thuộc.
//   custody_script_hash   — script hash của Treasury `custody`. UTxO mang kho NFT BẮT BUỘC
//                           nằm ở payment credential này (soi gương gate_script_hash ở
//                           Luật 5). Đặt Ở CUỐI danh sách tham số để không xê dịch khe cũ:
//                           truyền sai thứ tự KHÔNG báo lỗi, nó chỉ ra một policy-id khác
//                           một cách im lặng. KHÔNG sinh vòng apply-param — thứ tự đúc vẫn
//                           là one-shot NFT → lamp_mint → custody → reserve_gate →
//                           reserve_draw; `custody` không bake hash của hai validator này.

use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound, PositiveInfinity}
use cardano/assets.{PolicyId}
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/reserve/math
use magiclamp/reserve/types.{Draw, ReserveRedeemer, ReserveState}
use magiclamp/reserve/util

validator reserve_draw(
  lamp_policy           : PolicyId,
  token_name             : ByteArray,
  reserve_thread_policy : PolicyId,
  reserve_thread_name   : ByteArray,
  ms_per_epoch          : Int,
  kho_nft_policy        : PolicyId,
  kho_nft_name          : ByteArray,
  treasury_auth_policy  : PolicyId,
  treasury_auth_name    : ByteArray,
  gate_script_hash      : ByteArray,
  custody_script_hash   : ByteArray,
) {
  spend(
    _datum: Option<ReserveState>,
    _r: ReserveRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // ── Luật 1: ReserveState input chính danh (mang reserve thread NFT, qty==1) ──
    // Không tin "đây là ReserveState" chỉ vì ngồi ở script — kẻ tấn công có thể tạo
    // UTxO rác KHÔNG NFT tại cùng địa chỉ. Ghim NFT one-shot DUY NHẤT → chính danh.
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
    let own_out: Output = own_input.output
    expect
      assets.quantity_of(own_out.value, reserve_thread_policy, reserve_thread_name) == 1

    // Đọc state vào (datum option bỏ qua — đọc trực tiếp từ input để chắc khớp NFT).
    expect s: ReserveState = util.inline_datum(own_out)

    // ── Luật 2: epoch t từ validity_range lower_bound (bảo thủ, chống tua tương lai) ──
    let t = util.get_epoch(tx.validity_range.lower_bound.bound_type, ms_per_epoch)

    // ── Luật 2b (Vector 2 — defense-in-depth): ghim t bằng upper_bound ──────
    // reserve_draw chỉ đọc lower_bound để tính t → lệ thuộc NGẦM vào ttl node.
    // Ép upper_bound LÀ Finite VÀ cùng epoch với lower_bound: t bị ghim chính
    // xác, KHÔNG trôi qua biên epoch (chống tx phủ nhiều epoch để chọn nhịp nhả).
    expect Some(hi) = util.get_finite(tx.validity_range.upper_bound.bound_type)
    expect hi / ms_per_epoch == t

    // ── Luật 3: ≤1 draw/epoch — t > last_epoch ────────────────────────────
    // Chống rút nhiều lần trong CÙNG epoch để vượt trần (mỗi epoch tối đa 1 draw
    // ≤ max_per_epoch). last_epoch ghi epoch của draw trước; ép tiến nghiêm ngặt.
    expect t > s.last_epoch

    // ── Luật 4: delta mint LAMP — > 0, ≤ trần epoch, ≤ pot còn lại ─────────
    // delta = Δ mint LAMP (lamp_policy, token_name). 3 vế độc lập:
    //   delta > 0                     — chống draw rỗng (spam min-ADA / no-burn).
    //   delta ≤ max_per_epoch(total)  — TRẦN CỨNG mỗi epoch (= total/1000).
    //   delta ≤ total − drawn         — KHÔNG vượt pot còn lại.
    let delta = util.minted_qty(tx.mint, lamp_policy, token_name)
    expect delta > 0
    expect delta <= math.max_per_epoch(s.total_oildrop)
    expect delta <= s.total_oildrop - s.drawn_oildrop

    // ── Luật 5: Treasury-pull gate — ∃ input mang treasury_auth NFT Ở GATE SCRIPT ──
    // Auth NFT PHẢI ở input thuộc gate script → spend nó BẮT BUỘC kích reserve_gate.spend
    // (ép parked < floor + custody reference). Chỉ đếm NFT là chưa đủ (Vector F): kẻ giữ
    // auth ở ví thường sẽ bỏ qua gate. Ghim địa chỉ = khôi phục bất biến "nhả ⟺ dưới sàn".
    expect
      list.any(
        tx.inputs,
        fn(i) {
          util.is_at_script(i.output.address, gate_script_hash) && assets.quantity_of(
            i.output.value, treasury_auth_policy, treasury_auth_name,
          ) >= 1
        },
      )

    // ── Luật 6: chống double-satisfaction — đúng 1 ReserveState input/tx ───
    // Theo script-hash (bắt cả biến thể stake credential). 2 ReserveState input có
    // thể chia chung 1 output dest → drain. Ép count == 1.
    let own_hash = util.own_script_hash(own_out.address)
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1

    // ── Luật 7: ReserveState' tái tạo đúng (cùng script, NFT trả lại, datum tiến) ──
    // Đúng 1 output mang reserve thread NFT; ở lại CÙNG script address; datum:
    // start_epoch + total_oildrop BẤT BIẾN; drawn_oildrop' == drawn_oildrop + delta (đơn điệu);
    // last_epoch' == t (ghi epoch draw này → chống re-draw cùng epoch ở luật 3).
    expect
      util.count_outputs_with_nft(tx.outputs, reserve_thread_policy, reserve_thread_name) == 1
    let s_out: Output =
      util.output_with_nft(tx.outputs, reserve_thread_policy, reserve_thread_name)
    expect s_out.address == own_out.address
    expect s2: ReserveState = util.inline_datum(s_out)
    expect s2.start_epoch == s.start_epoch
    expect s2.total_oildrop == s.total_oildrop
    expect s2.drawn_oildrop == s.drawn_oildrop + delta
    expect s2.last_epoch == t
    // ReserveState' KHÔNG ôm LAMP (chống nhồi LAMP vào state né dest).
    expect assets.quantity_of(s_out.value, lamp_policy, token_name) == 0
    // KHÔNG đính reference_script (chống biến state thành script-carrier rác).
    expect s_out.reference_script == None

    // ── Luật 8 (CX-1): reserve thread NFT KHÔNG bị mint/burn trong tx này ──
    // Chống đúc THÊM reserve thread NFT giả cùng tx rồi giữ ở ví thường để né
    // validator (Vector F). Nếu policy one-shot đã đúc đủ thì qty mint == 0.
    expect assets.quantity_of(tx.mint, reserve_thread_policy, reserve_thread_name) == 0

    // ── Luật 9: tx PHẢI TIÊU đúng 1 UTxO mang KHO NFT ─────────────────────
    // Không đo đích, không đo lượng — chỉ ép KHO BỊ SPEND. Kho bị spend ⇒ validator của
    // chính kho (Treasury custody, nhánh MigrateIn) chạy ⇒ nó ép Δ vào value VÀ vào SỔ
    // của nó (C-MIG-7/C-MIG-8). Đây là cùng hình dạng Reserve đã dùng cho meter NFT:
    // ghim MỘT one-shot NFT rồi để validator giữ NFT đó tự chịu trách nhiệm.
    //
    // == 1, không phải ≥ 1: hai UTxO kho trong một tx là ca kho tự chia đôi trách nhiệm —
    // mỗi cái ép "value tăng Δ" trong khi chỉ có Δ được mint ⇒ mơ hồ, chặn cứng.
    //
    // ⚠ BẤT BIẾN DEPLOY (validator KHÔNG tự bảo đảm): kho_nft_policy phải là policy
    // ONE-SHOT thật, NFT đã đúc vào đúng địa chỉ kho. Nếu là policy tuỳ ý thì kẻ tấn công
    // đúc token khớp, đặt ở script của hắn, và "kho" thành của hắn. Lớp chặn thứ hai nằm
    // ở Genesis lamp_mint: nó đọc hash kho từ chính carrier NFT này và đòi carrier ở
    // SCRIPT (`script_hash_of_holder`), nên NFT đặt ở ví thường thì cả tx chết.
    expect util.count_inputs_with_nft(tx.inputs, kho_nft_policy, kho_nft_name) == 1

    // ── Luật 10 (F6): UTxO mang kho NFT phải Ở ĐÚNG script hash của Treasury custody ──
    // Luật 9 chỉ ép "một UTxO mang kho NFT bị tiêu" — nó KHÔNG nói UTxO đó thuộc về
    // validator nào. Bản thân việc bị tiêu chỉ kích validator ĐANG GIỮ nó; nếu NFT nằm ở
    // một script khác (hoặc ở ví thường) thì cái chạy không phải `custody`, và không ai
    // ép Δ vào SỔ. Soi gương Luật 5: ở đó auth NFT bị ghim vào `gate_script_hash` vì
    // cùng một lý do — "có mặt" không thay được "validator nào chạy".
    let kho_in =
      util.input_with_nft(tx.inputs, kho_nft_policy, kho_nft_name)
    expect util.is_at_script(kho_in.output.address, custody_script_hash)

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — happy + NEGATIVE (≥14)
// ══════════════════════════════════════════════════════════════

const lamp_pol: PolicyId = #"7717"

// LAMP asset name testnet "tLAMP" (param hóa; mainnet "LAMP").
const lamp_nm: ByteArray = #"744c414d50"

const thr_pol: PolicyId = #"5544"

const thr_nm: ByteArray = #"524553"

// Treasury co-spend authority NFT (Treasury-pull gate).
const tre_pol: PolicyId = #"6655"

const tre_nm: ByteArray = #"545245"

const rscript: ByteArray = #"5151"

// gate script hash của reserve_gate (Treasury). Auth NFT BẮT BUỘC ở đây (Vector 3 fix).
const gate_hash: ByteArray = #"9191"

// script hash KHÁC gate (test auth đặt sai script → reject).
const other_script: ByteArray = #"8282"

// KHO NFT one-shot định danh kho (Treasury custody). Luật 9 ép tx TIÊU đúng 1 UTxO mang nó.
const kho_pol: PolicyId = #"7a17"

const kho_nm: ByteArray = #"4b484f"

// script hash của kho (Treasury custody). F6 đưa nó TRỞ LẠI làm param (khe cuối) —
// lần này không phải để đo đích, mà để ghim "validator nào chạy khi kho bị tiêu".
const kho_hash: ByteArray = #"c0c0"

// ví thường (nơi LAMP KHÔNG được phép dừng lại) — dùng cho fixture rò rỉ.
const wallet_pkh: ByteArray = #"deadbeef"

const ms_epoch: Int = 432_000_000

// E = 9,630 tỷ LAMP (cap reserve allocation v17). E ⋮ 1000 → trần chia chẵn.
const e: Int = 9_630_000_000_000_000

// Trần CỨNG mỗi epoch = E / 1000.
const cap: Int = 9_630_000_000_000

const start: Int = 100

/// Input KHO bị TIÊU trong tx draw: UTxO kho mang kho NFT (Luật 9). Kho bị spend ⇒
/// validator Treasury custody chạy ⇒ Δ bị ép vào value VÀ vào sổ kho.
fn kho_input() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(kho_pol, kho_nm, 1)
  util.mk_input(util.mk_ref(8), util.mk_output(util.script_address(kho_hash), v, 0))
}

/// Input mang kho NFT nhưng ĐẶT Ở VÍ THƯỜNG (không validator nào chạy).
/// Từ F6, Luật 10 của chính tệp này chặn ca đó (trước F6 thì không) — xem
/// `reject_kho_nft_at_wallet`.
fn kho_input_at_vk() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(kho_pol, kho_nm, 1)
  util.mk_input(util.mk_ref(8), util.mk_output(util.vk_address(#"7a7a"), v, 0))
}

/// Input mang kho NFT ở MỘT SCRIPT KHÁC custody (validator của kẻ tấn công chạy, không
/// phải `custody`) — ca âm chính của Luật 10.
fn kho_input_at_other_script() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(kho_pol, kho_nm, 1)
  util.mk_input(util.mk_ref(8), util.mk_output(util.script_address(other_script), v, 0))
}

fn own_ref() -> OutputReference {
  util.mk_ref(0)
}

/// ReserveState input mang reserve thread NFT (qty==1), datum = s.
fn rs_input(s: ReserveState) -> Input {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(thr_pol, thr_nm, 1)
  util.mk_input(own_ref(), util.mk_output(util.script_address(rscript), v, s))
}

/// ReserveState input KHÔNG mang NFT (UTxO rác cùng địa chỉ).
fn rs_input_no_nft(s: ReserveState) -> Input {
  util.mk_input(
    own_ref(),
    util.mk_output(util.script_address(rscript), assets.from_lovelace(2_000_000), s),
  )
}

/// Input mang Treasury auth NFT TẠI gate script (bằng chứng Treasury-pull qua gate).
fn treasury_auth_input() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(tre_pol, tre_nm, 1)
  util.mk_input(util.mk_ref(7), util.mk_output(util.script_address(gate_hash), v, 0))
}

/// Input mang Treasury auth NFT TẠI VÍ THƯỜNG (vk address — Vector 3: bỏ qua gate).
fn treasury_auth_input_at_vk() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(tre_pol, tre_nm, 1)
  util.mk_input(util.mk_ref(7), util.mk_output(util.vk_address(#"7474"), v, 0))
}

/// Input mang Treasury auth NFT TẠI script KHÁC gate (sai địa chỉ → reject).
fn treasury_auth_input_at_wrong_script() -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(tre_pol, tre_nm, 1)
  util.mk_input(util.mk_ref(7), util.mk_output(util.script_address(other_script), v, 0))
}

/// ReserveState' output mang lại NFT, datum = s2 (cùng script address).
fn rs_output(s2: ReserveState) -> Output {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(thr_pol, thr_nm, 1)
  util.mk_output(util.script_address(rscript), v, s2)
}

/// Output KHO sau MigrateIn: trả lại kho NFT + `qty` LAMP. Reserve KHÔNG đo output này
/// nữa (Treasury custody tự đo bằng C-MIG-7/C-MIG-8); giữ trong fixture để tx mang đúng
/// hình dạng thật của một lượt rút.
fn kho_output(qty: Int) -> Output {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(kho_pol, kho_nm, 1)
      |> assets.add(lamp_pol, lamp_nm, qty)
  util.mk_output(util.script_address(kho_hash), v, 0)
}

/// Output rò rỉ ra VÍ THƯỜNG — dùng cho ca ghi lại ranh giới ở cuối tệp.
fn wallet_output(qty: Int) -> Output {
  util.mk_output_no_datum(
    util.vk_address(wallet_pkh),
    assets.from_lovelace(2_000_000) |> assets.add(lamp_pol, lamp_nm, qty),
  )
}

fn mint_lamp(qty: Int) {
  assets.zero |> assets.add(lamp_pol, lamp_nm, qty)
}

/// validity_range với lower_bound finite tại epoch `ep` (ms = ep*ms_epoch) và
/// upper_bound Finite ở CUỐI epoch ep (ep*ms + ms-1) → cùng epoch, t bị ghim
/// (khớp Luật 2b). Mọi happy test dùng helper này vẫn xanh.
fn vrange(ep: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(ep * ms_epoch), is_inclusive: True },
    upper_bound: IntervalBound {
      bound_type: Finite(ep * ms_epoch + ( ms_epoch - 1 )),
      is_inclusive: True,
    },
  }
}

fn run(s_in: ReserveState, tx: Transaction) -> Bool {
  reserve_draw.spend(
    lamp_pol, lamp_nm, thr_pol, thr_nm, ms_epoch, kho_pol, kho_nm, tre_pol, tre_nm,
    gate_hash, kho_hash, Some(s_in), Draw, own_ref(), tx,
  )
}

/// Dựng tx draw chuẩn (happy): input s + Treasury auth, mint=delta, dest=delta, output s2.
fn build_tx(s: ReserveState, s2: ReserveState, mint_qty: Int, dest_qty: Int, ep: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [rs_input(s), treasury_auth_input(), kho_input()],
    outputs: [rs_output(s2), kho_output(dest_qty)],
    mint: mint_lamp(mint_qty),
    validity_range: vrange(ep),
  }
}

/// State khởi đầu: chưa nhả, last_epoch = start (chưa có draw nào).
fn fresh() -> ReserveState {
  ReserveState { start_epoch: start, total_oildrop: e, drawn_oildrop: 0, last_epoch: start }
}

// ── HAPPY ────────────────────────────────────────────────────

test draw_happy_full_cap() {
  // nhả đúng TRẦN epoch (delta == max_per_epoch). t = start+1 > last_epoch.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  run(s, build_tx(s, s2, d, d, start + 1))
}

test draw_happy_partial_below_cap() {
  // nhả PARTIAL (delta < trần) — Treasury chỉ cần kéo một phần.
  let s = fresh()
  let d = cap - 1_000_000
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 5 }
  run(s, build_tx(s, s2, d, d, start + 5))
}

test draw_happy_incremental_next_epoch() {
  // đã nhả 1 epoch (last_epoch = start+10, drawn = cap), nhả tiếp epoch sau (start+11).
  let drawn0 = cap
  let s = ReserveState { ..fresh(), drawn_oildrop: drawn0, last_epoch: start + 10 }
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: drawn0 + d, last_epoch: start + 11 }
  run(s, build_tx(s, s2, d, d, start + 11))
}

test draw_happy_last_epoch_drains_remaining() {
  // epoch cuối: pot còn < trần → kéo nốt phần còn lại (delta = remaining < cap).
  let drawn0 = e - 3_000_000
  let s = ReserveState { ..fresh(), drawn_oildrop: drawn0, last_epoch: start + 999 }
  let d = 3_000_000
  let s2 = ReserveState { ..s, drawn_oildrop: e, last_epoch: start + 1000 }
  run(s, build_tx(s, s2, d, d, start + 1000))
}

// ── NEGATIVE ─────────────────────────────────────────────────

test reject_delta_exceeds_max_per_epoch() fail {
  // delta = cap+1 > trần epoch → Luật 4 reject (chống vượt trần cứng).
  let s = fresh()
  let d = cap + 1
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  run(s, build_tx(s, s2, d, d, start + 1))
}

test reject_two_draws_same_epoch() fail {
  // draw lần 2 trong CÙNG epoch: t == last_epoch (start+5) → Luật 3 (t > last_epoch) reject.
  let drawn0 = cap
  let s = ReserveState { ..fresh(), drawn_oildrop: drawn0, last_epoch: start + 5 }
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: drawn0 + d, last_epoch: start + 5 }
  run(s, build_tx(s, s2, d, d, start + 5))
}

test reject_draw_epoch_before_last() fail {
  // t < last_epoch (tua lùi: t = start+3 nhưng last = start+5) → Luật 3 reject.
  let s = ReserveState { ..fresh(), drawn_oildrop: cap, last_epoch: start + 5 }
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: cap + d, last_epoch: start + 3 }
  run(s, build_tx(s, s2, d, d, start + 3))
}

test reject_missing_treasury_auth() fail {
  // KHÔNG có input mang Treasury auth NFT → Luật 5 reject (không Treasury-pull).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_auth_not_at_gate() fail {
  // Vector 3: auth NFT ở VÍ THƯỜNG (vk address) — đủ qty nhưng KHÔNG ở gate script →
  // bỏ qua reserve_gate (không ép sàn) → Luật 5 reject (auth phải spend từ gate).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input_at_vk(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_auth_at_wrong_script() fail {
  // Vector 3: auth NFT ở SCRIPT KHÁC gate (không phải reserve_gate) → không kích đúng
  // gate ép sàn → Luật 5 reject (gate_script_hash phải khớp reserve_gate).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input_at_wrong_script(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_delta_exceeds_pot_remaining() fail {
  // pot còn 2_000_000 nhưng delta = trần (cap) > remaining → Luật 4 reject.
  let drawn0 = e - 2_000_000
  let s = ReserveState { ..fresh(), drawn_oildrop: drawn0, last_epoch: start + 998 }
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: drawn0 + d, last_epoch: start + 999 }
  run(s, build_tx(s, s2, d, d, start + 999))
}

test reject_missing_nft() fail {
  // ReserveState input KHÔNG mang reserve thread NFT → reject (Luật 1).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input_no_nft(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_no_mint() fail {
  // tx KHÔNG mint LAMP (delta 0) → Luật 4 (delta > 0) reject.
  let s = fresh()
  let s2 = ReserveState { ..s, drawn_oildrop: 0, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(0)],
      mint: assets.zero,
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_burn() fail {
  // mint âm (burn) → delta < 0 → Luật 4 (delta > 0) reject.
  let s = fresh()
  let s2 = ReserveState { ..s, drawn_oildrop: 0, last_epoch: start + 1 }
  run(s, build_tx(s, s2, -1, 0, start + 1))
}

test reject_drawn_wrong_sum() fail {
  // s2.drawn_oildrop ≠ s.drawn_oildrop + delta → Luật 7 reject (kế toán sai).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d + 1, last_epoch: start + 1 }
  run(s, build_tx(s, s2, d, d, start + 1))
}

test reject_last_epoch_not_updated() fail {
  // s2.last_epoch ≠ t (ghi sai, vẫn = start) → Luật 7 reject (mở re-draw cùng epoch).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start }
  run(s, build_tx(s, s2, d, d, start + 1))
}

// GỠ `reject_lamp_leak_not_to_dest`: nó khẳng định Reserve tự chặn LAMP rò ra ví, tức
// khẳng định đúng phép đo đã sinh ra lỗ (đo TỔNG mặt output tới một địa chỉ — cho tái
// chế lọt, và không phân biệt được "vào kho" với "vào sổ kho"). Bảo đảm đó KHÔNG mất,
// nó CHUYỂN CHỖ: nay do Treasury custody C-MIG-7/8 và Genesis lamp_mint
// `qty_delta_at_script` cưỡng chế. Ca cùng hình dạng nay nằm ở
// `reserve_khong_do_dich_den_khi_kho_bi_tieu` (cuối tệp) — cùng tx, kỳ vọng ĐẢO, kèm
// con trỏ tới hai bài đang chặn nó thật.

test reject_double_satisfaction() fail {
  // 2 ReserveState input cùng script → count_inputs_at_script == 2 ≠ 1 → Luật 6 reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_total_oildrop_mutated() fail {
  // s2.total_oildrop ≠ s.total_oildrop (nới cap) → Luật 7 bất biến reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { start_epoch: start, total_oildrop: e * 2, drawn_oildrop: d, last_epoch: start + 1 }
  run(s, build_tx(s, s2, d, d, start + 1))
}

test reject_start_epoch_mutated() fail {
  // s2.start_epoch ≠ s.start_epoch (dời mốc) → Luật 7 bất biến reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { start_epoch: start - 50, total_oildrop: e, drawn_oildrop: d, last_epoch: start + 1 }
  run(s, build_tx(s, s2, d, d, start + 1))
}

test reject_state_output_holds_lamp() fail {
  // ReserveState' ôm LAMP (né dest) → Luật 7 reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let dirty =
    util.mk_output(
      util.script_address(rscript),
      assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, thr_nm, 1)
        |> assets.add(lamp_pol, lamp_nm, d),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [dirty],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_state_moved_address() fail {
  // ReserveState' rời script address (mang NFT đi nơi khác) → Luật 7 reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let moved =
    util.mk_output(
      util.vk_address(#"f00d"),
      assets.from_lovelace(2_000_000) |> assets.add(thr_pol, thr_nm, 1),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [moved, kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_mint_extra_reserve_thread() fail {
  // tx draw đồng thời mint THÊM 1 reserve thread NFT (Vector F) → Luật 8 reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d) |> assets.add(thr_pol, thr_nm, 1),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

// ── NEGATIVE: ép upper_bound Finite + cùng epoch (Vector 2) ────────────────

/// validity_range với upper_bound = PositiveInfinity (lower_bound finite tại ep).
fn vrange_open_upper(ep: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(ep * ms_epoch), is_inclusive: True },
    upper_bound: IntervalBound { bound_type: PositiveInfinity, is_inclusive: True },
  }
}

/// validity_range với lower_bound tại epoch `lo_ep`, upper_bound tại epoch `hi_ep`.
fn vrange_cross(lo_ep: Int, hi_ep: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(lo_ep * ms_epoch), is_inclusive: True },
    upper_bound: IntervalBound { bound_type: Finite(hi_ep * ms_epoch), is_inclusive: True },
  }
}

test reject_upper_bound_infinite() fail {
  // upper_bound = PositiveInfinity → get_finite None → Luật 2b reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 500 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange_open_upper(start + 500),
    }
  run(s, tx)
}

test reject_upper_bound_other_epoch() fail {
  // upper_bound ở epoch KHÁC lower_bound → t không ghim → Luật 2b reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 500 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange_cross(start + 500, start + 501),
    }
  run(s, tx)
}

// ── NEGATIVE: Luật 9 — tx PHẢI TIÊU đúng 1 UTxO mang KHO NFT ──────────────

test reject_missing_kho_input() fail {
  // KHÔNG tiêu UTxO kho → Treasury custody KHÔNG chạy → không ai ép Δ vào sổ.
  // Đây chính là hình dạng cũ ("rót vào địa chỉ rồi thôi") → Luật 9 reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_two_kho_inputs() fail {
  // 2 UTxO mang kho NFT trong cùng tx → count == 2 ≠ 1 → Luật 9 reject.
  // (NFT one-shot thì ca này không xảy ra được trên chain thật; chặn cứng để phép đo
  //  không bao giờ mơ hồ nếu policy kho bị deploy sai.)
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input(), kho_input()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

test reject_delta_to_datumless_utxo_at_kho_address() fail {
  // Đúng ĐỊA CHỈ kho nhưng KHÔNG tiêu kho: Δ rót vào một UTxO không datum, không NFT
  // tại địa chỉ kho. Luật 9 CŨ (`qty_to_credential ≥ delta`) cho ca này qua, và Δ đóng
  // băng ngoài sổ. Luật 9 MỚI reject vì không có input nào mang kho NFT.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let stray =
    util.mk_output_no_datum(
      util.script_address(kho_hash),
      assets.from_lovelace(2_000_000) |> assets.add(lamp_pol, lamp_nm, d),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input()],
      outputs: [rs_output(s2), stray],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

// ── NEGATIVE: Luật 10 (F6) — kho NFT phải Ở ĐÚNG script hash custody ──────

test reject_kho_nft_at_other_script() fail {
  // kho NFT ngồi ở MỘT SCRIPT KHÁC: Luật 9 vẫn đếm được 1 UTxO mang NFT, nhưng validator
  // chạy khi nó bị tiêu là của kẻ tấn công, không phải `custody` ⇒ không ai ép Δ vào sổ.
  // Luật 10 reject. Cặp dương của bài này là mọi ca happy (kho ở đúng `kho_hash`).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input_at_other_script()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

// ── RANH GIỚI: Reserve KHÔNG đo đích, và đó là CỐ Ý ───────────────────────
// Hai test dưới ghi lại bằng mã phần Reserve KHÔNG canh, để không ai đọc reserve_draw
// rồi tưởng nó đang bảo vệ đích đến. Người canh là Treasury custody (C-MIG-7/8) và
// Genesis lamp_mint (`script_hash_of_holder` + `qty_delta_at_script`).

test reserve_khong_do_dich_den_khi_kho_bi_tieu() {
  // Δ chảy thẳng ra VÍ THƯỜNG trong khi kho vẫn bị tiêu và trả lại y nguyên.
  // reserve_draw CHO QUA — đúng thiết kế. Cùng tx này chết ở Treasury custody
  // (`migrate_reject_recycle_delta_to_wallet`) và ở Genesis lamp_mint
  // (`reservedraw_reject_kho_recycle`).
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input()],
      outputs: [rs_output(s2), wallet_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

// ── Luật 10 (F6): ĐẢO một ca DƯƠNG cũ ─────────────────────────────────────
// Bài `reserve_khong_ep_kho_nft_o_script` từng là ca DƯƠNG ghi lại giới hạn "Reserve chỉ
// đếm NFT, không soi địa chỉ". Đó là ghim một GIỚI HẠN mà F6 xoá bỏ, không phải ghim một
// HÀNH VI — nên nó phải đảo, chứ không phải giữ. Nay đổi tên + gắn `fail`.
// Bảo đảm cũ (lớp chặn ở Genesis `lamp_mint.script_hash_of_holder`) KHÔNG mất: nó vẫn
// đứng đó và vẫn được `Genesis/onchain/validators/lamp_mint.ak` ghim; F6 chỉ thêm lớp
// thứ hai ngay tại Reserve, để một tx như vậy chết sớm hơn và chết ở đúng nơi đo được.

test reject_kho_nft_at_wallet() fail {
  // kho NFT nằm ở VÍ THƯỜNG ⇒ không validator nào chạy khi nó bị tiêu ⇒ không ai ép Δ
  // vào sổ. Trước F6 reserve_draw cho qua; nay Luật 10 reject.
  let s = fresh()
  let d = cap
  let s2 = ReserveState { ..s, drawn_oildrop: d, last_epoch: start + 1 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), treasury_auth_input(), kho_input_at_vk()],
      outputs: [rs_output(s2), kho_output(d)],
      mint: mint_lamp(d),
      validity_range: vrange(start + 1),
    }
  run(s, tx)
}

// ── HAPPY: full-drain nhiều epoch tới cạn (tổng kế toán đúng E) ────────────

test draw_full_drain_three_epochs_chain() {
  // Mô phỏng 3 epoch liên tiếp nhả đúng trần — kiểm transition nối tiếp đúng.
  // Epoch A: drawn 0 → cap, last start → start+1.
  let sa = fresh()
  let sa2 = ReserveState { ..sa, drawn_oildrop: cap, last_epoch: start + 1 }
  let ok_a = run(sa, build_tx(sa, sa2, cap, cap, start + 1))
  // Epoch B: tiếp từ sa2 → 2*cap, last start+1 → start+2.
  let sb2 = ReserveState { ..sa2, drawn_oildrop: 2 * cap, last_epoch: start + 2 }
  let ok_b = run(sa2, build_tx(sa2, sb2, cap, cap, start + 2))
  // Epoch C: tiếp từ sb2 → 3*cap, last start+2 → start+3.
  let sc2 = ReserveState { ..sb2, drawn_oildrop: 3 * cap, last_epoch: start + 3 }
  let ok_c = run(sb2, build_tx(sb2, sc2, cap, cap, start + 3))
  ok_a && ok_b && ok_c
}
