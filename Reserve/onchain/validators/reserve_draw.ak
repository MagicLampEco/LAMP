// reserve_draw — spend validator giữ ReserveState UTxO; nhả LINEAR 1001 epoch.
//
// FIRST-PRINCIPLES — nhả tất định, permissionless, không ai tác động:
//   Reserve = nhả đều tuyệt đối trong 1001 epoch THUẦN THUẬT TOÁN. Không committee,
//   không demand_gate, không chữ ký. Bất kỳ ai dựng tx đúng lịch đều trigger được;
//   con số nhả do HÀM vested(t) quyết, không người nào sửa.
//
//   Mỗi "draw" = spend ReserveState (mang reserve thread NFT) + mint đúng `draw` tLAMP
//   qua Genesis route ReserveDraw, gửi TOÀN BỘ tới reserve_dest. drawn_oil += draw.
//   start_epoch + total_oil GIỮ NGUYÊN (bất biến). drawn_oil chỉ TĂNG (đơn điệu).
//
// Quan hệ với Genesis (tlamp_mint): Genesis route ReserveDraw đòi tx spend đúng 1 UTxO
// mang "meter" NFT (gate nhịp). reserve thread NFT của ReserveState ĐÓNG vai meter đó —
// reserve_draw CHÍNH là gate nhịp tất định. (Orchestrator chốt: meter_nft = reserve_thread.)
//
// Param:
//   tlamp_policy          — minting policy tLAMP (Genesis tlamp_mint), đo Δ mint.
//   reserve_thread_policy — policy reserve thread NFT one-shot (authenticity ReserveState).
//   reserve_thread_name   — asset name reserve thread NFT.
//   ms_per_epoch          — độ dài epoch (POSIX ms) theo network.
//   reserve_dest          — địa chỉ ĐÍCH nhận tLAMP nhả (Treasury hoặc thị trường — param).

use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound, PositiveInfinity}
use cardano/address.{Address}
use cardano/assets.{PolicyId}
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/reserve/math
use magiclamp/reserve/types.{Draw, ReserveRedeemer, ReserveState}
use magiclamp/reserve/util

// tLAMP asset name — "tLAMP" (khớp Genesis constants.tlamp_name).
const tlamp_name: ByteArray = #"744c414d50"

validator reserve_draw(
  tlamp_policy          : PolicyId,
  reserve_thread_policy : PolicyId,
  reserve_thread_name   : ByteArray,
  ms_per_epoch          : Int,
  reserve_dest          : Address,
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

    // ── Luật 3: tính draw tất định = vested(t) − drawn_oil ────────────────
    let d = math.draw(s.start_epoch, s.total_oil, s.drawn_oil, t)

    // ── Luật 4: draw > 0 (chống spam draw rỗng tiêu min-ADA) ──────────────
    expect d > 0

    // ── Luật 5: tx mint ĐÚNG `draw` tLAMP (không hơn, không kém; no-burn) ──
    // Δ == d ép: nhả đúng phần vesting tới hạn. Δ>0 ⟹ không burn (d>0 đã ép).
    let delta = util.minted_qty(tx.mint, tlamp_policy, tlamp_name)
    expect delta == d

    // ── Luật 6: chống double-satisfaction — đúng 1 ReserveState input/tx ───
    // Theo script-hash (bắt cả biến thể stake credential). 2 ReserveState input có
    // thể chia chung 1 output dest → drain. Ép count == 1.
    let own_hash = util.own_script_hash(own_out.address)
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1

    // ── Luật 7: ReserveState' tái tạo đúng (cùng script, NFT trả lại, datum tiến) ──
    // Đúng 1 output mang reserve thread NFT; ở lại CÙNG script address; datum:
    // start_epoch + total_oil BẤT BIẾN; drawn_oil' == drawn_oil + draw (đơn điệu tăng).
    expect
      util.count_outputs_with_nft(tx.outputs, reserve_thread_policy, reserve_thread_name) == 1
    let s_out: Output =
      util.output_with_nft(tx.outputs, reserve_thread_policy, reserve_thread_name)
    expect s_out.address == own_out.address
    expect s2: ReserveState = util.inline_datum(s_out)
    expect s2.start_epoch == s.start_epoch
    expect s2.total_oil == s.total_oil
    expect s2.drawn_oil == s.drawn_oil + d
    // ReserveState' KHÔNG ôm tLAMP (chống nhồi tLAMP vào state né dest).
    expect assets.quantity_of(s_out.value, tlamp_policy, tlamp_name) == 0
    // KHÔNG đính reference_script (chống biến state thành script-carrier rác).
    expect s_out.reference_script == None

    // ── Luật 7b (CX-1): reserve thread NFT KHÔNG bị mint/burn trong tx này ──
    // Chống đúc THÊM reserve thread NFT giả cùng tx rồi giữ ở ví thường để né
    // validator (Vector F). Nếu policy one-shot đã đúc đủ thì qty mint == 0;
    // ép == 0 đóng kẽ "tx vừa draw vừa mint NFT thứ 2". (Test draw chỉ mint
    // tLAMP ⟹ qty thread mint == 0 ⟹ vẫn pass.)
    expect assets.quantity_of(tx.mint, reserve_thread_policy, reserve_thread_name) == 0

    // ── Luật 8: TOÀN BỘ `draw` tLAMP đi tới reserve_dest (không rò rỉ) ─────
    // Đếm tLAMP tới credential dest ≥ draw. (== draw ngầm vì Δ mint == draw và state
    // output không ôm tLAMP → không nguồn tLAMP nào khác để vượt.)
    let to_dest = util.qty_to_credential(tx.outputs, reserve_dest, tlamp_policy, tlamp_name)
    expect to_dest >= d

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — happy + NEGATIVE (≥12)
// ══════════════════════════════════════════════════════════════

const tl_pol: PolicyId = #"7717"

const thr_pol: PolicyId = #"5544"

const thr_nm: ByteArray = #"524553"

const rscript: ByteArray = #"5151"

const dest_pkh: ByteArray = #"deadbeef"

const ms_epoch: Int = 432_000_000

// E = 7.899 tỷ LAMP (cap reserve allocation v3).
const e: Int = 7_899_000_000_000_000

const start: Int = 100

fn dest_addr() -> Address {
  util.vk_address(dest_pkh)
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

/// ReserveState' output mang lại NFT, datum = s2 (cùng script address).
fn rs_output(s2: ReserveState) -> Output {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(thr_pol, thr_nm, 1)
  util.mk_output(util.script_address(rscript), v, s2)
}

/// Output trả `qty` tLAMP tới dest.
fn dest_output(qty: Int) -> Output {
  util.mk_output_no_datum(dest_addr(), assets.from_lovelace(2_000_000) |> assets.add(tl_pol, tlamp_name, qty))
}

fn mint_tlamp(qty: Int) {
  assets.zero |> assets.add(tl_pol, tlamp_name, qty)
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
    tl_pol, thr_pol, thr_nm, ms_epoch, dest_addr(),
    Some(s_in), Draw, own_ref(), tx,
  )
}

/// Dựng tx draw chuẩn (happy): input s, mint=draw, dest=draw, output s2.
fn build_tx(s: ReserveState, s2: ReserveState, mint_qty: Int, dest_qty: Int, ep: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [rs_input(s)],
    outputs: [rs_output(s2), dest_output(dest_qty)],
    mint: mint_tlamp(mint_qty),
    validity_range: vrange(ep),
  }
}

fn fresh() -> ReserveState {
  ReserveState { start_epoch: start, total_oil: e, drawn_oil: 0 }
}

// ── HAPPY ────────────────────────────────────────────────────

test draw_happy_mid() {
  // t = start+500, chưa nhả → draw == vested(500).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  run(s, build_tx(s, s2, d, d, start + 500))
}

test draw_correct_vesting_incremental() {
  // đã nhả tới epoch 500, nhả tiếp tới 600 → draw = vested(600) - vested(500).
  let drawn0 = math.vested(start, e, start + 500)
  let s = ReserveState { ..fresh(), drawn_oil: drawn0 }
  let d = math.vested(start, e, start + 600) - drawn0
  let s2 = ReserveState { ..s, drawn_oil: drawn0 + d }
  run(s, build_tx(s, s2, d, d, start + 600))
}

test draw_full_drain_at_end() {
  // t ≥ start+1001 → draw == E toàn bộ một lần.
  let s = fresh()
  let s2 = ReserveState { ..s, drawn_oil: e }
  run(s, build_tx(s, s2, e, e, start + 1001))
}

test draw_boundary_epoch_first() {
  // biên: t = start+1 → draw == E/1001 (epoch đầu, nhả nhỏ nhất > 0).
  let s = fresh()
  let d = math.vested(start, e, start + 1)
  let s2 = ReserveState { ..s, drawn_oil: d }
  run(s, build_tx(s, s2, d, d, start + 1))
}

// ── NEGATIVE ─────────────────────────────────────────────────

test reject_draw_exceeds_vesting() fail {
  // mint nhiều hơn vesting tới hạn (draw+1) → delta ≠ d → reject.
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d + 1 }
  run(s, build_tx(s, s2, d + 1, d + 1, start + 500))
}

test reject_missing_nft() fail {
  // ReserveState input KHÔNG mang reserve thread NFT → reject (luật 1).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input_no_nft(s)],
      outputs: [rs_output(s2), dest_output(d)],
      mint: mint_tlamp(d),
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

test reject_no_mint() fail {
  // tx KHÔNG mint tLAMP (delta 0) nhưng draw>0 → delta ≠ d → reject (luật 5).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [rs_output(s2), dest_output(d)],
      mint: assets.zero,
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

test reject_burn() fail {
  // mint âm (burn) → delta < 0 ≠ d>0 → reject (no-burn).
  let s = fresh()
  let s2 = ReserveState { ..s, drawn_oil: 0 }
  run(s, build_tx(s, s2, -1, 0, start + 500))
}

test reject_drawn_decrease() fail {
  // s2.drawn_oil < s.drawn_oil + draw (đi lùi) → reject (luật 7 đơn điệu).
  let drawn0 = math.vested(start, e, start + 500)
  let s = ReserveState { ..fresh(), drawn_oil: drawn0 }
  let d = math.vested(start, e, start + 600) - drawn0
  // s2 ghi drawn giảm về 0 thay vì drawn0+d.
  let s2 = ReserveState { ..s, drawn_oil: 0 }
  run(s, build_tx(s, s2, d, d, start + 600))
}

test reject_tlamp_leak_not_to_dest() fail {
  // tLAMP nhả KHÔNG tới dest (tới ví lạ) → to_dest < draw → reject (luật 8).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let leak =
    util.mk_output_no_datum(
      util.vk_address(#"baad"),
      assets.from_lovelace(2_000_000) |> assets.add(tl_pol, tlamp_name, d),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [rs_output(s2), leak],
      mint: mint_tlamp(d),
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

test reject_double_satisfaction() fail {
  // 2 ReserveState input cùng script → count_inputs_at_script == 2 ≠ 1 → reject.
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s), rs_input(s)],
      outputs: [rs_output(s2), dest_output(d)],
      mint: mint_tlamp(d),
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

test reject_draw_zero_before_start() fail {
  // t == start → vested 0 → draw 0 → reject (luật 4 ép draw>0, chống spam rỗng).
  let s = fresh()
  let s2 = ReserveState { ..s, drawn_oil: 0 }
  run(s, build_tx(s, s2, 0, 0, start))
}

test reject_draw_zero_caught_up() fail {
  // drawn == vested(t) → draw 0 → reject (đã nhả hết phần tới hạn, không spam).
  let v = math.vested(start, e, start + 300)
  let s = ReserveState { ..fresh(), drawn_oil: v }
  let s2 = ReserveState { ..s, drawn_oil: v }
  run(s, build_tx(s, s2, 0, 0, start + 300))
}

test reject_total_oil_mutated() fail {
  // s2.total_oil ≠ s.total_oil (nới cap) → reject (luật 7 bất biến).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { start_epoch: start, total_oil: e * 2, drawn_oil: d }
  run(s, build_tx(s, s2, d, d, start + 500))
}

test reject_start_epoch_mutated() fail {
  // s2.start_epoch ≠ s.start_epoch (dời mốc nhả) → reject (luật 7 bất biến).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { start_epoch: start - 50, total_oil: e, drawn_oil: d }
  run(s, build_tx(s, s2, d, d, start + 500))
}

test reject_state_output_holds_tlamp() fail {
  // ReserveState' ôm tLAMP (né dest) → reject (luật 7).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let dirty =
    util.mk_output(
      util.script_address(rscript),
      assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, thr_nm, 1)
        |> assets.add(tl_pol, tlamp_name, d),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [dirty],
      mint: mint_tlamp(d),
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

test reject_state_moved_address() fail {
  // ReserveState' rời script address (mang NFT đi nơi khác) → reject (luật 7).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let moved =
    util.mk_output(
      util.vk_address(#"f00d"),
      assets.from_lovelace(2_000_000) |> assets.add(thr_pol, thr_nm, 1),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [moved, dest_output(d)],
      mint: mint_tlamp(d),
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

// ── NEGATIVE: Việc 1 (CX-1) — chống đúc reserve thread NFT giả cùng tx ─────

test reject_mint_extra_reserve_thread() fail {
  // tx draw đồng thời mint THÊM 1 reserve thread NFT (Vector F: giữ NFT ở ví
  // thường né validator) → Luật 7b ép qty mint thread == 0 → reject.
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [rs_output(s2), dest_output(d)],
      // mint tLAMP đúng draw, NHƯNG kèm đúc thêm 1 reserve thread NFT giả.
      mint: mint_tlamp(d) |> assets.add(thr_pol, thr_nm, 1),
      validity_range: vrange(start + 500),
    }
  run(s, tx)
}

// ── NEGATIVE: Việc 2 — ép upper_bound Finite + cùng epoch ──────────────────

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
  // Chống lệ thuộc ngầm vào ttl node (tx không ghim biên trên epoch).
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [rs_output(s2), dest_output(d)],
      mint: mint_tlamp(d),
      validity_range: vrange_open_upper(start + 500),
    }
  run(s, tx)
}

test reject_upper_bound_other_epoch() fail {
  // upper_bound ở epoch KHÁC lower_bound (start+501 vs start+500) → t không ghim
  // → Luật 2b (hi/ms_epoch == t) reject. Chống tx phủ nhiều epoch chọn nhịp nhả.
  let s = fresh()
  let d = math.vested(start, e, start + 500)
  let s2 = ReserveState { ..s, drawn_oil: d }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [rs_input(s)],
      outputs: [rs_output(s2), dest_output(d)],
      mint: mint_tlamp(d),
      validity_range: vrange_cross(start + 500, start + 501),
    }
  run(s, tx)
}
