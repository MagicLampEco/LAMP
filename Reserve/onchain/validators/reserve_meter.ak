// reserve_meter — GATE LAYER nhả Reserve tự động, PERMISSIONLESS, KHÔNG ai rút tay.
//
// THAY phần "DAO phê duyệt approved_cumulative bằng tay". approved_cumulative trở
// thành HÀM TẤT ĐỊNH của epoch (release.ak). Validator này ép:
//   reserve_minted_out ≤ approved_cumulative(epoch, velocity)   (C-10')
//   drawn_in_epoch_out ≤ max_draw_per_epoch(epoch)              (C-8')
//
// PERMISSIONLESS: bất kỳ ai dựng tx. KHÔNG kiểm chữ ký. δ ép đúng bằng hàm, recipient
// ép = địa chỉ tất định (recipient_lock param) — người trigger KHÔNG lợi gì ngoài đẩy
// nhả đúng lịch (giống UMKeeper/VacuumFire permissionless).
//
// Param:
//   tlamp_policy          — policy id tLAMP (đọc Δ thật từ tx.mint, không tin redeemer)
//   supply_nft_policy     — policy SUPPLY thread NFT (định danh SupplyState output)
//   supply_nft_name       — "SUPPLY"
//   meter_nft_policy      — policy ReserveMeter thread NFT
//   meter_nft_name        — name meter NFT
//   reserve_policy_nft_policy — policy authenticity ReservePolicy beacon (chống beacon giả)
//   recipient_lock        — payment credential hash đích nhả (Treasury/sink) — KHÔNG ví trigger
//   ms_per_epoch          — ms/epoch (derive current_epoch từ validity_range)
//
// SupplyState transition (reserve_minted += δ, cap enforce) do tlamp_mint (Genesis)
// ép — validator này là tầng GATE NHỊP (rate + release function), defense-in-depth.

use aiken/collection/list
use aiken/interval
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Output, OutputReference, Transaction, placeholder}
use magiclamp/reserve/constants
use magiclamp/reserve/release
use magiclamp/reserve/types.{
  Draw, Reset, ReserveMeter, ReserveMeterRedeemer, ReservePolicy, SupplyState,
  TreasuryFlowBeacon,
}
use magiclamp/reserve/util

validator reserve_meter(
  tlamp_policy: PolicyId,
  supply_nft_policy: PolicyId,
  supply_nft_name: ByteArray,
  meter_nft_policy: PolicyId,
  meter_nft_name: ByteArray,
  reserve_policy_nft_policy: PolicyId,
  recipient_lock: ByteArray,
  ms_per_epoch: Int,
) {
  spend(
    datum_opt: Option<ReserveMeter>,
    r: ReserveMeterRedeemer,
    _own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(meter_in) = datum_opt

    // ── C-3: thread NFT meter 1-in / 1-out (chống double-meter RS-4) ──────
    expect util.count_inputs_holding_nft(tx.inputs, meter_nft_policy, meter_nft_name) == 1
    expect util.count_holding_nft(tx.outputs, meter_nft_policy, meter_nft_name) == 1
    let m_out_utxo: Output = util.output_holding_nft(tx.outputs, meter_nft_policy, meter_nft_name)
    expect meter_out: ReserveMeter = util.inline_datum(m_out_utxo)

    // meter output ở lại script (thread không rời chỗ).
    let m_in_utxo: Output = util.input_holding_nft(tx.inputs, meter_nft_policy, meter_nft_name)
    expect m_out_utxo.address == m_in_utxo.address
    // meter NFT KHÔNG mint/burn trong tx (qty == 0 trong tx.mint).
    expect assets.quantity_of(tx.mint, meter_nft_policy, meter_nft_name) == 0
    // meter output sạch (chỉ meter NFT + ada, không nhồi tLAMP/token rác).
    expect util.value_only_nft_and_ada(m_out_utxo.value, meter_nft_policy, meter_nft_name)

    // ── current epoch từ validity range ──────────────────────────────────
    let current_epoch = util.get_epoch(tx, ms_per_epoch)

    // ── Δ = tLAMP mint thật trong tx (KHÔNG tin redeemer) ── C-6 ──────────
    let delta = util.minted_qty(tx.mint, tlamp_policy, constants.tlamp_name)
    expect delta > 0

    // ── ReservePolicy beacon qua reference input (authenticity NFT) ── C-11 ──
    expect Some(pol_utxo) =
      util.find_ref_holding_nft(tx.reference_inputs, reserve_policy_nft_policy)
    expect policy: ReservePolicy = util.inline_datum(pol_utxo)

    // growth_bps trong biên hợp lệ (chống DAO đột ngột mở Reserve qua tham số).
    expect policy.annual_growth_bps >= constants.min_growth_bps
    expect policy.annual_growth_bps <= constants.max_growth_bps
    expect policy.epochs_per_year > 0
    expect policy.reserve_release_base > 0
    expect policy.demand_floor_bps >= 0
    expect policy.demand_floor_bps <= constants.bps_denom

    // ── velocity (tầng 2) ── đọc TreasuryFlowBeacon nếu policy bật ────────
    // velocity_source_policy == #"" → bypass MVP (tầng 1 thuần).
    let velocity_present = policy.velocity_source_policy != #""
    let sma_ratio_bps =
      if velocity_present {
        expect Some(flow_utxo) =
          util.find_ref_holding_nft(tx.reference_inputs, policy.velocity_source_policy)
        expect flow: TreasuryFlowBeacon = util.inline_datum(flow_utxo)
        // STALE-CHECK (tương đương C-UM-6 của InstantGen): beacon velocity KHÔNG
        // được cũ hơn 1 cửa sổ velocity_window. Chống replay 1 TreasuryFlowBeacon cũ
        // (sma_ratio cao) làm reference input để nới allowance vô hạn.
        //   window_start_epoch ≤ current_epoch        (không từ tương lai)
        //   current_epoch − window_start_epoch ≤ velocity_window
        expect flow.window_start_epoch <= current_epoch
        expect current_epoch - flow.window_start_epoch <= policy.velocity_window
        flow.sma_ratio_bps
      } else {
        0
      }

    // ── SupplyState thread 1-in / 1-out (binding nội-module) ── C-10' ─────
    // ĐỌC CẢ INPUT (s_in) lẫn OUTPUT (s_out): defense-in-depth — KHÔNG ủy thác
    // toàn bộ ràng buộc reserve_minted += δ cho Genesis tlamp_mint. Module tự ép
    // s_out.reserve_minted == s_in.reserve_minted + δ → kẻ tấn công KHÔNG thể đặt
    // s_out.reserve_minted thấp giả (vẫn ≤ approved) để "reset" bộ đếm tích lũy.
    expect util.count_inputs_holding_nft(tx.inputs, supply_nft_policy, supply_nft_name) == 1
    expect util.count_holding_nft(tx.outputs, supply_nft_policy, supply_nft_name) == 1
    let s_in_utxo: Output = util.input_holding_nft(tx.inputs, supply_nft_policy, supply_nft_name)
    let s_out_utxo: Output = util.output_holding_nft(tx.outputs, supply_nft_policy, supply_nft_name)
    expect s_in: SupplyState = util.inline_datum(s_in_utxo)
    expect s_out: SupplyState = util.inline_datum(s_out_utxo)
    // SupplyState output sạch (chỉ SUPPLY NFT + ada — chống nhồi token rác DoS).
    expect util.value_only_nft_and_ada(s_out_utxo.value, supply_nft_policy, supply_nft_name)
    // SupplyState ở lại script (thread không rời chỗ).
    expect s_out_utxo.address == s_in_utxo.address
    // SUPPLY NFT KHÔNG mint/burn trong tx.
    expect assets.quantity_of(tx.mint, supply_nft_policy, supply_nft_name) == 0
    // C-CONS: bảo toàn — reserve_minted CỘNG ĐÚNG δ, các cap + dist_minted BẤT BIẾN.
    expect s_out.reserve_minted == s_in.reserve_minted + delta
    expect s_out.dist_minted == s_in.dist_minted
    expect s_out.dist_cap == s_in.dist_cap
    expect s_out.reserve_cap == s_in.reserve_cap

    // ── release function: approved + max_draw từ epoch (tất định) ─────────
    let approved =
      release.approved_cumulative(
        current_epoch,
        policy.genesis_release_epoch,
        policy.reserve_release_base,
        policy.annual_growth_bps,
        policy.epochs_per_year,
        s_out.reserve_cap,
        velocity_present,
        sma_ratio_bps,
        policy.demand_floor_bps,
      )
    let max_draw =
      release.max_draw_per_epoch(
        current_epoch,
        policy.genesis_release_epoch,
        policy.reserve_release_base,
        policy.annual_growth_bps,
        policy.epochs_per_year,
        s_out.reserve_cap,
      )

    // ── C-10': reserve_minted_out ≤ approved_cumulative(epoch) ────────────
    // Trần cứng cap_release LUÔN thắng (approved ≤ cap_release theo xây dựng).
    expect s_out.reserve_minted <= approved

    // ── PERMISSIONLESS recipient lock: δ tLAMP tới đúng địa chỉ tất định ───
    // KHÔNG ví người trigger → permissionless an toàn (không lợi gì để bơm).
    expect recipient_gets_delta(tx.outputs, tlamp_policy, recipient_lock, delta)

    // ── nhánh Draw vs Reset ──────────────────────────────────────────────
    when r is {
      Draw -> {
        // C-4: epoch không đổi khi Draw ; C-5: meter đúng epoch hiện tại.
        expect meter_out.epoch == meter_in.epoch
        expect meter_in.epoch == current_epoch
        // C-7: drawn cộng đúng δ.
        expect meter_out.drawn_in_epoch == meter_in.drawn_in_epoch + delta
        // C-8': drawn_in_epoch ≤ max_draw_per_epoch(epoch).
        expect meter_out.drawn_in_epoch <= max_draw
        True
      }
      Reset -> {
        // C-12: sang epoch mới (current > meter cũ).
        expect meter_out.epoch == current_epoch
        expect current_epoch > meter_in.epoch
        // C-13: drawn_in_epoch bắt đầu = δ (reset về 0 + lần đầu).
        expect meter_out.drawn_in_epoch == delta
        // C-14: δ ≤ max_draw_per_epoch(epoch).
        expect delta <= max_draw
        True
      }
    }
  }

  else(_) {
    fail
  }
}

/// recipient nhận đúng (hoặc nhiều hơn — gộp UTxO) tổng δ tLAMP tại payment cred lock.
/// Σ tLAMP tại outputs có payment_credential == Script(recipient_lock) ≥ δ, và KHÔNG
/// có tLAMP rò ra output khác (Σ tLAMP toàn tx outputs == δ, trừ SupplyState đã sạch).
fn recipient_gets_delta(
  outputs: List<Output>,
  tlamp_policy: PolicyId,
  recipient_lock: ByteArray,
  delta: Int,
) -> Bool {
  let to_recipient =
    list.foldl(
      outputs,
      0,
      fn(o, acc) {
        let q = assets.quantity_of(o.value, tlamp_policy, constants.tlamp_name)
        when o.address.payment_credential is {
          Script(h) ->
            if h == recipient_lock {
              acc + q
            } else {
              acc
            }
          _ -> acc
        }
      },
    )
  let total_out =
    list.foldl(
      outputs,
      0,
      fn(o, acc) { acc + assets.quantity_of(o.value, tlamp_policy, constants.tlamp_name) },
    )
  // δ tLAMP tới recipient, KHÔNG rò đi đâu khác (total == to_recipient == δ).
  to_recipient == delta && total_out == delta
}

// ══════════════════════════════════════════════════════════════
// TESTS — happy (Draw, Reset, bypass + velocity) + NEGATIVE MECE
// ══════════════════════════════════════════════════════════════

const tlamp_pol: PolicyId = #"7717"

const supply_pol: PolicyId = #"5544"

const supply_nm: ByteArray = #"535550504c59"

const meter_pol: PolicyId = #"6655"

const meter_nm: ByteArray = #"4d4554"

const polnft: PolicyId = #"9988"

const flow_pol: PolicyId = #"a1a1"

const sink: ByteArray = #"5151"

// 1 epoch = 432_000_000 ms (Cardano 5 ngày). epoch e ⟺ lower_bound = e·mspe.
const mspe: Int = 432_000_000

const r0: Int = 2_000_000_000_000

const g: Int = 300

const ey: Int = 73

const rcap: Int = 1_800_000_000_000_000

const tg: Int = 1000

fn base_policy() -> ReservePolicy {
  ReservePolicy {
    genesis_release_epoch: tg,
    reserve_release_base: r0,
    annual_growth_bps: g,
    epochs_per_year: ey,
    demand_floor_bps: 2000,
    velocity_window: 12,
    velocity_source_policy: #"",
    governance_ref: #"deadbeef",
  }
}

fn supply_state(reserve_minted: Int) -> SupplyState {
  SupplyState {
    dist_minted: 0,
    reserve_minted: reserve_minted,
    dist_cap: constants.dist_cap_oil,
    reserve_cap: rcap,
  }
}

fn supply_utxo(s: SupplyState) -> Output {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(supply_pol, supply_nm, 1)
  util.mk_output(util.script_address(#"aaaa"), v, s)
}

fn supply_out(reserve_minted: Int) -> Output {
  supply_utxo(supply_state(reserve_minted))
}

fn supply_in(reserve_minted: Int) -> Output {
  supply_utxo(supply_state(reserve_minted))
}

fn meter_in_utxo(m: ReserveMeter) -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(meter_pol, meter_nm, 1)
  util.mk_output(util.script_address(#"bbbb"), v, m)
}

fn meter_out_utxo(m: ReserveMeter) -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(meter_pol, meter_nm, 1)
  util.mk_output(util.script_address(#"bbbb"), v, m)
}

fn policy_ref(p: ReservePolicy) -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(polnft, #"01", 1)
  util.mk_output(util.script_address(#"cccc"), v, p)
}

fn flow_ref(f: TreasuryFlowBeacon) -> Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(flow_pol, #"02", 1)
  util.mk_output(util.script_address(#"dddd"), v, f)
}

fn recipient_out(qty: Int) -> Output {
  util.mk_output(
    util.script_address(sink),
    assets.from_lovelace(2_000_000) |> assets.add(tlamp_pol, constants.tlamp_name, qty),
    0,
  )
}

fn mint_tlamp(qty: Int) {
  assets.zero |> assets.add(tlamp_pol, constants.tlamp_name, qty)
}

fn validity(epoch: Int) {
  interval.after(epoch * mspe)
}

/// build tx Draw/Reset đầy đủ. reserve_minted_in = giá trị SupplyState INPUT;
/// reserve_minted_out = giá trị SupplyState OUTPUT (test tự chọn để bắt C-CONS).
fn build_tx(
  meter_in: ReserveMeter,
  meter_out: ReserveMeter,
  reserve_minted_in: Int,
  reserve_minted_out: Int,
  delta: Int,
  recipient_qty: Int,
  epoch: Int,
  policy: ReservePolicy,
  flow: Option<TreasuryFlowBeacon>,
) -> Transaction {
  let refs =
    when flow is {
      Some(f) -> [
        util.mk_input(util.mk_ref(10), policy_ref(policy)),
        util.mk_input(util.mk_ref(11), flow_ref(f)),
      ]
      None -> [util.mk_input(util.mk_ref(10), policy_ref(policy))]
    }
  Transaction {
    ..placeholder,
    inputs: [
      util.mk_input(util.mk_ref(0), meter_in_utxo(meter_in)),
      util.mk_input(util.mk_ref(1), supply_in(reserve_minted_in)),
    ],
    reference_inputs: refs,
    outputs: [meter_out_utxo(meter_out), supply_out(reserve_minted_out), recipient_out(recipient_qty)],
    mint: mint_tlamp(delta),
    validity_range: validity(epoch),
  }
}

fn run(r: ReserveMeterRedeemer, tx: Transaction) -> Bool {
  reserve_meter.spend(
    tlamp_pol,
    supply_pol,
    supply_nm,
    meter_pol,
    meter_nm,
    polnft,
    sink,
    mspe,
    Some(meter_in_datum(tx)),
    r,
    util.mk_ref(0),
    tx,
  )
}

/// lấy meter_in datum từ input đầu (test helper).
fn meter_in_datum(tx: Transaction) -> ReserveMeter {
  expect Some(i) = list.head(tx.inputs)
  expect m: ReserveMeter = util.inline_datum(i.output)
  m
}

// ── HAPPY: Draw bypass MVP (velocity_source_policy = #"") ─────
// epoch 1036, δ nhỏ ≤ max_draw (~8.22e8). reserve_minted_out ≤ approved=cap.
test draw_happy_bypass() {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 500_000_000 }
  let tx = build_tx(mi, mo, 0, 500_000_000, 500_000_000, 500_000_000, 1036, base_policy(), None)
  run(Draw, tx)
}

// ── HAPPY: Reset sang epoch mới ──────────────────────────────
test reset_happy() {
  let mi = ReserveMeter { epoch: 1035, drawn_in_epoch: 999 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 500_000_000 }
  let tx = build_tx(mi, mo, 0, 500_000_000, 500_000_000, 500_000_000, 1036, base_policy(), None)
  run(Reset, tx)
}

// ── HAPPY: velocity bật, allowance cao đủ ────────────────────
test draw_happy_velocity_high() {
  let pol = ReservePolicy { ..base_policy(), velocity_source_policy: flow_pol }
  let flow = TreasuryFlowBeacon { window_start_epoch: 1024, sma_ratio_bps: 10000 }
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 500_000_000 }
  let tx = build_tx(mi, mo, 0, 500_000_000, 500_000_000, 500_000_000, 1036, pol, Some(flow))
  run(Draw, tx)
}

// ── NEG: velocity beacon CŨ (stale) → replay bị chặn ─────────
test draw_velocity_stale() fail {
  // window_start_epoch=1020, current=1036 → diff=16 > velocity_window=12 → reject.
  let pol = ReservePolicy { ..base_policy(), velocity_source_policy: flow_pol }
  let flow = TreasuryFlowBeacon { window_start_epoch: 1020, sma_ratio_bps: 10000 }
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 500_000_000 }
  let tx = build_tx(mi, mo, 0, 500_000_000, 500_000_000, 500_000_000, 1036, pol, Some(flow))
  run(Draw, tx)
}

// ── NEG: drawn vượt max_draw_per_epoch (C-8') ────────────────
test draw_exceeds_max_draw() fail {
  // δ = 9e8 > max_draw ~8.22e8 → reject.
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 900_000_000 }
  let tx = build_tx(mi, mo, 0, 900_000_000, 900_000_000, 900_000_000, 1036, base_policy(), None)
  run(Draw, tx)
}

// ── NEG: reserve_minted_out vượt approved (velocity thấp kéo allowance) ──
test reserve_minted_exceeds_approved() fail {
  // velocity 30% → approved ≈ 1.53e12. reserve_minted_out = 2e12 > approved → reject.
  let pol = ReservePolicy { ..base_policy(), velocity_source_policy: flow_pol }
  let flow = TreasuryFlowBeacon { window_start_epoch: 1024, sma_ratio_bps: 3000 }
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let tx = build_tx(mi, mo, 1_999_000_000_000, 2_000_000_000_000, 1_000_000_000, 1_000_000_000, 1036, pol, Some(flow))
  run(Draw, tx)
}

// ── NEG: recipient sai (δ tới ví khác, không sink) ───────────
test recipient_wrong_lock() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  // recipient_out tới địa chỉ vk khác, không phải Script(sink).
  let bad_recipient =
    util.mk_output(
      util.vk_address(#"dead"),
      assets.from_lovelace(2_000_000) |> assets.add(tlamp_pol, constants.tlamp_name, 1_000_000_000),
      0,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        util.mk_input(util.mk_ref(0), meter_in_utxo(mi)),
        util.mk_input(util.mk_ref(1), supply_in(0)),
      ],
      reference_inputs: [util.mk_input(util.mk_ref(10), policy_ref(base_policy()))],
      outputs: [meter_out_utxo(mo), supply_out(1_000_000_000), bad_recipient],
      mint: mint_tlamp(1_000_000_000),
      validity_range: validity(1036),
    }
  run(Draw, tx)
}

// ── NEG: Draw meter epoch cũ (C-5) ───────────────────────────
test draw_stale_epoch() fail {
  // meter.epoch=1035 nhưng current_epoch=1036 → C-5 fail (Draw đòi epoch ==).
  let mi = ReserveMeter { epoch: 1035, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1035, drawn_in_epoch: 1_000_000_000 }
  let tx = build_tx(mi, mo, 0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1036, base_policy(), None)
  run(Draw, tx)
}

// ── NEG: Draw thay đổi epoch trong meter (C-4) ───────────────
test draw_mutates_epoch() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1037, drawn_in_epoch: 1_000_000_000 }
  let tx = build_tx(mi, mo, 0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1036, base_policy(), None)
  run(Draw, tx)
}

// ── NEG: drawn cộng sai δ (C-7) ──────────────────────────────
test draw_wrong_drawn_sum() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 100 }
  // drawn_out nên = 100 + δ ; đặt sai = δ.
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let tx = build_tx(mi, mo, 0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1036, base_policy(), None)
  run(Draw, tx)
}

// ── NEG: δ ≤ 0 (no-op/burn) ──────────────────────────────────
test draw_zero_delta() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let tx = build_tx(mi, mo, 0, 0, 0, 0, 1036, base_policy(), None)
  run(Draw, tx)
}

// ── NEG: growth_bps ngoài biên (chống DAO mở Reserve qua tham số) ──
test policy_growth_too_high() fail {
  let pol = ReservePolicy { ..base_policy(), annual_growth_bps: 600 }
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let tx = build_tx(mi, mo, 0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1036, pol, None)
  run(Draw, tx)
}

// ── NEG: Reset không tiến epoch (current ≤ meter cũ) ─────────
test reset_not_advancing() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let tx = build_tx(mi, mo, 0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1036, base_policy(), None)
  run(Reset, tx)
}

// ── NEG: trước genesis_release_epoch → approved=0, mọi δ>0 vượt ──
test draw_before_genesis_release() fail {
  // epoch 999 < t_g=1000 → cap_release=0 → approved=0 → reserve_minted_out>0 reject.
  let mi = ReserveMeter { epoch: 999, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 999, drawn_in_epoch: 1 }
  let tx = build_tx(mi, mo, 0, 1, 1, 1, 999, base_policy(), None)
  run(Draw, tx)
}

// ── NEG: C-CONS hole — δ lớn nhưng s_out.reserve_minted đặt thấp GIẢ ──────
// Đây là lỗ HIGH council nêu: trước fix, reserve_meter chỉ ép s_out ≤ approved,
// KHÔNG ép s_out == s_in + δ. Kẻ tấn công đặt s_in cao (gần approved) + δ lớn
// nhưng s_out THẤP để "reset" bộ đếm tích lũy → vượt trần tích lũy ở tầng meter.
// Sau fix: expect s_out.reserve_minted == s_in.reserve_minted + delta → reject.
test draw_conservation_understated_out() fail {
  // s_in = 1.5e12, δ = 1e9 (≤ max_draw). s_out đặt = 1e9 (giả thấp, vẫn ≤ approved).
  // Bảo toàn đòi s_out == 1.5e12 + 1e9 ≠ 1e9 → C-CONS fail.
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let tx =
    build_tx(
      mi,
      mo,
      1_500_000_000_000,
      1_000_000_000,
      1_000_000_000,
      1_000_000_000,
      1036,
      base_policy(),
      None,
    )
  run(Draw, tx)
}

// ── NEG: cap-tamper — s_out.reserve_cap đổi (nới trần) so s_in ────────────
test draw_cap_tamper() fail {
  // s_in cap = rcap; s_out cap bị nhồi to hơn (qua supply_out custom).
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let s_out_tampered =
    util.mk_output(
      util.script_address(#"aaaa"),
      assets.from_lovelace(2_000_000) |> assets.add(supply_pol, supply_nm, 1),
      SupplyState {
        dist_minted: 0,
        reserve_minted: 1_000_000_000,
        dist_cap: constants.dist_cap_oil,
        reserve_cap: rcap * 2,
      },
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        util.mk_input(util.mk_ref(0), meter_in_utxo(mi)),
        util.mk_input(util.mk_ref(1), supply_in(0)),
      ],
      reference_inputs: [util.mk_input(util.mk_ref(10), policy_ref(base_policy()))],
      outputs: [meter_out_utxo(mo), s_out_tampered, recipient_out(1_000_000_000)],
      mint: mint_tlamp(1_000_000_000),
      validity_range: validity(1036),
    }
  run(Draw, tx)
}

// ── NEG: thiếu SupplyState input (chỉ có output) → binding fail ───────────
test draw_missing_supply_input() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [util.mk_input(util.mk_ref(0), meter_in_utxo(mi))],
      reference_inputs: [util.mk_input(util.mk_ref(10), policy_ref(base_policy()))],
      outputs: [meter_out_utxo(mo), supply_out(1_000_000_000), recipient_out(1_000_000_000)],
      mint: mint_tlamp(1_000_000_000),
      validity_range: validity(1036),
    }
  run(Draw, tx)
}

// ── NEG: s_out SupplyState nhồi token rác (DoS/bloat) → value_only fail ───
test draw_supply_out_dirty() fail {
  let mi = ReserveMeter { epoch: 1036, drawn_in_epoch: 0 }
  let mo = ReserveMeter { epoch: 1036, drawn_in_epoch: 1_000_000_000 }
  let dirty_supply =
    util.mk_output(
      util.script_address(#"aaaa"),
      assets.from_lovelace(2_000_000)
        |> assets.add(supply_pol, supply_nm, 1)
        |> assets.add(#"baad", #"01", 1),
      supply_state(1_000_000_000),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        util.mk_input(util.mk_ref(0), meter_in_utxo(mi)),
        util.mk_input(util.mk_ref(1), supply_in(0)),
      ],
      reference_inputs: [util.mk_input(util.mk_ref(10), policy_ref(base_policy()))],
      outputs: [meter_out_utxo(mo), dirty_supply, recipient_out(1_000_000_000)],
      mint: mint_tlamp(1_000_000_000),
      validity_range: validity(1036),
    }
  run(Draw, tx)
}
