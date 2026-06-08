// tlamp_mint — minting policy LAZY-MINT tLAMP, gated bởi SupplyState (CONTRACT §5).
//
// FIRST-PRINCIPLES — fixed-supply không cần mint sẵn:
//   "Fixed-supply" KHÔNG đòi 36 tỷ token nằm sẵn on-chain. Nó đòi TỔNG phát hành
//   lịch sử ≤ CAP. Một bộ đếm đơn điệu (SupplyState) chặn tại CAP thỏa mạnh hơn:
//   token chưa mint = không tồn tại = không bị tấn công, không khóa min-ADA.
//
//   Mọi tx mint tLAMP PHẢI consume + recreate SupplyState (nhận diện qua thread NFT
//   one-shot DUY NHẤT). Δ = lượng mint trong tx; transition datum ép Δ vào ĐÚNG
//   quota (Distribution HOẶC Reserve) theo redeemer, ≤ cap, đơn điệu, KHÔNG burn.
//
// Param: thread_nft_policy + thread_nft_name (tầng 1) + dist_authority/reserve_authority
// (keyhash stub MVP) + auth threshold. KHÔNG tham chiếu ngược tầng 3 (không vòng lặp).
//
// NEO ĐỊNH DANH SupplyState = qua SUPPLY NFT one-shot (KHÔNG qua script-hash). Thread NFT
// được mint đúng MỘT lần (thread_nft one-shot, param genesis_ref) → tồn tại DUY NHẤT 1 bản
// trên chain → "UTxO mang đúng 1 SUPPLY NFT" ⟺ "SupplyState chính danh". Không cần ghim
// payment_credential == Script(supply_state_hash): ghim đó tạo VÒNG (supply_state_hash phụ
// thuộc tlamp_policy phụ thuộc lại supply_state_hash) — không apply-param được khi deploy.
//
// LƯU Ý: validator này KHÔNG tự đọc supply_state spend (nó là MINT policy). Nó tìm
// SupplyState input/output qua SUPPLY NFT. supply_state.ak (tầng 3) chỉ ép "có mint
// tLAMP" rồi ủy quyền toàn bộ transition cho ĐÂY → một nguồn sự thật cho cap.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Input, Output, Transaction, placeholder}
use magiclamp/genesis/constants
use magiclamp/genesis/types.{
  DistributionVest, ReserveDraw, SupplyState, TLampMintRedeemer,
}
use magiclamp/genesis/util

validator tlamp_mint(
  thread_nft_policy : PolicyId,
  thread_nft_name   : ByteArray,
  dist_authority    : List<ByteArray>,
  reserve_authority : List<ByteArray>,
  auth_threshold    : Int,
) {
  mint(r: TLampMintRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── Luật 1: consume + recreate SupplyState (thread NFT) ───────────────
    // Đúng 1 input mang thread NFT, đúng 1 output mang lại NFT đó. Thread NFT
    // KHÔNG được mint/burn trong tx này (qty trong tx.mint của thread policy == 0).
    // → chống mint lậu (A2), SupplyState giả/đôi (A3/A7), mất NFT.
    expect util.count_inputs_holding_nft(tx.inputs, thread_nft_policy, thread_nft_name) == 1
    expect util.count_holding_nft(tx.outputs, thread_nft_policy, thread_nft_name) == 1
    expect assets.quantity_of(tx.mint, thread_nft_policy, thread_nft_name) == 0

    let s_in: Output = util.input_holding_nft(tx.inputs, thread_nft_policy, thread_nft_name)
    let s_out: Output = util.output_holding_nft(tx.outputs, thread_nft_policy, thread_nft_name)

    // ── D8-#1 (neo NFT, không ghim hash): định danh SupplyState bằng SUPPLY NFT ──
    // KHÔNG ghim payment_credential == Script(supply_state_hash) — ghim đó tạo VÒNG
    // (supply_state_hash phụ thuộc tlamp_policy phụ thuộc lại nó). Thay vào: SUPPLY NFT
    // là one-shot DUY NHẤT (thread_nft param genesis_ref) → "mang đúng 1 SUPPLY NFT"
    // ⟺ SupplyState chính danh. Kẻ tấn công KHÔNG đúc nổi NFT thứ 2 để dựng SupplyState
    // giả. Cap-phình ở UTxO giả vô dụng: D7-#1 dưới ép cap == hằng genesis (sai cap →
    // không mint được), nên không cần ghim địa chỉ.
    //
    // SupplyState output PHẢI ở lại CÙNG địa chỉ input (thread không rời chỗ) — so trực
    // tiếp input↔output, KHÔNG cần param, KHÔNG vòng.
    expect s_out.address == s_in.address

    expect s: SupplyState = util.inline_datum(s_in)
    expect s2: SupplyState = util.inline_datum(s_out)

    // ── D7-#1: NEO CAP vào HẰNG SỐ (chống cap phình → mint vượt 36 tỷ) ─────
    // Cap không chỉ "bất biến qua transition" (luật 4) mà phải ĐÚNG hằng genesis.
    // Nếu UTxO vào mang cap bịa (lớn hơn), luật 4 vẫn pass vì chỉ so s2==s.
    expect s.dist_cap == constants.dist_cap_oil
    expect s.reserve_cap == constants.reserve_cap_oil

    // ── D7-#10: counter KHÔNG âm (chống dist_minted/reserve_minted âm → cap ảo) ──
    expect s.dist_minted >= 0
    expect s.reserve_minted >= 0

    // ── Luật 2 + 3: Δ>0 và policy chỉ mint đúng 1 name = tLAMP ─────────────
    // Δ = lượng tLAMP mint trong tx (cùng biến dùng cho transition → A8 không lệch).
    let delta = util.minted_qty(tx.mint, policy_id, constants.tlamp_name)
    expect delta > 0                                                   // A6 (no burn / no-op)
    expect util.policy_name_count(tx.mint, policy_id) == 1             // A11 (đúng 1 name)

    // ── Luật 4: caps BẤT BIẾN qua transition ──────────────────────────────
    expect s2.dist_cap == s.dist_cap                                  // A9
    expect s2.reserve_cap == s.reserve_cap

    // ── Luật 5: cộng đúng quota theo redeemer (khóa Distribution↔Reserve) ──
    // A5: DistributionVest KHÔNG đụng reserve_minted; ReserveDraw KHÔNG đụng dist_minted.
    // A8: cùng Δ — không thể "mint nhiều, ghi sổ ít".
    let quota_ok =
      when r is {
        DistributionVest ->
          s2.dist_minted == s.dist_minted + delta
            && s2.reserve_minted == s.reserve_minted
        ReserveDraw ->
          s2.reserve_minted == s.reserve_minted + delta
            && s2.dist_minted == s.dist_minted
      }
    expect quota_ok

    // ── Luật 6: monotonic (đơn điệu, không rollback) ──────────────────────
    // Ngầm đã đúng qua luật 5 (Δ>0) nhưng guard tường minh chống mọi rollback (A4).
    expect s2.dist_minted >= s.dist_minted
    expect s2.reserve_minted >= s.reserve_minted

    // ── Luật 7: cap enforce (biên = đúng cap được phép, > cap reject) ──────
    expect s2.dist_minted <= s2.dist_cap                             // A1
    expect s2.reserve_minted <= s2.reserve_cap

    // ── D7-#2: TRẦN TỔNG (defense-in-depth, chống mint vượt 36 tỷ) ─────────
    // Dù cap đã neo hằng, ép thêm trần tổng tuyệt đối: tổng phát hành ≤ 36 tỷ oil.
    expect s2.dist_minted + s2.reserve_minted <= constants.total_cap_oil

    // ── D3-#1 + D3-#3: KHÓA continuing output (SupplyState UTxO sạch) ──────
    // SupplyState UTxO KHÔNG được chứa tLAMP (chống nhồi tLAMP vào state để né
    // recipient / làm nhiễu kế toán circulating).
    expect assets.quantity_of(s_out.value, policy_id, constants.tlamp_name) == 0
    // KHÔNG đính reference_script (chống biến SupplyState thành script-carrier rác).
    expect s_out.reference_script == None
    // Lý tưởng: continuing output chỉ gồm 1 thread NFT + lovelace (không token lạ).
    // policy_name_count thread == 1 đã ngầm bởi luật 1; ép thêm: KHÔNG có policy nào
    // khác ngoài thread_nft_policy + lovelace (ngăn token rác bám SupplyState).
    expect util.value_only_nft_and_ada(s_out.value, thread_nft_policy)

    // ── Luật 8: authority gate (stub MVP) ─────────────────────────────────
    // A10: thiếu chữ ký authority đúng đường mint → reject.
    let authority =
      when r is {
        DistributionVest -> dist_authority
        ReserveDraw -> reserve_authority
      }
    // ── D2-#1/#2: threshold tự vệ (1 ≤ threshold ≤ |authority|) ────────────
    // threshold==0 → ai cũng mint được (vô hiệu authority). threshold > N → khóa
    // chết không bao giờ mint được. Ghim biên hợp lệ ngay trong validator.
    expect auth_threshold >= 1
    expect auth_threshold <= list.length(list.unique(authority))
    expect util.count_sigs(authority, tx.extra_signatories) >= auth_threshold

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — happy (2 đường, biên cap) + NEGATIVE (mọi vector A1..A11)
// ══════════════════════════════════════════════════════════════

const tlamp_pol: PolicyId = #"7717"

const thr_pol: PolicyId = #"5544"

const sscript: ByteArray = #"5151"

const auth_a: ByteArray = #"a1"

const auth_b: ByteArray = #"b2"

const res_auth: ByteArray = #"c3"

/// SupplyState input UTxO mang thread NFT, datum = s.
fn ss_input(s: SupplyState) -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(thr_pol, constants.supply_name, 1)
  util.mk_input(util.mk_ref(0), util.mk_output(util.script_address(sscript), v, s))
}

/// SupplyState output mang lại thread NFT, datum = s2 (cùng địa chỉ script).
fn ss_output(s2: SupplyState) -> Output {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(thr_pol, constants.supply_name, 1)
  util.mk_output(util.script_address(sscript), v, s2)
}

fn mint_tlamp(qty: Int) {
  assets.zero |> assets.add(tlamp_pol, constants.tlamp_name, qty)
}

/// Dựng tx mint tLAMP đầy đủ (params chuẩn). sigs = extra_signatories.
fn build_tx(
  s: SupplyState,
  s2: SupplyState,
  mint_qty: Int,
  sigs: List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [ss_input(s)],
    outputs: [ss_output(s2)],
    mint: mint_tlamp(mint_qty),
    extra_signatories: sigs,
  }
}

fn run(r: TLampMintRedeemer, tx: Transaction) -> Bool {
  tlamp_mint.mint(
    thr_pol, constants.supply_name,
    [auth_a, auth_b], [res_auth], 1,
    r, tlamp_pol, tx,
  )
}

/// run với threshold tùy chỉnh (test D2-#1/#2).
fn run_thr(
  r: TLampMintRedeemer,
  tx: Transaction,
  dist_auth: List<ByteArray>,
  threshold: Int,
) -> Bool {
  tlamp_mint.mint(
    thr_pol, constants.supply_name,
    dist_auth, [res_auth], threshold,
    r, tlamp_pol, tx,
  )
}

fn fresh() -> SupplyState {
  SupplyState {
    dist_minted: 0,
    reserve_minted: 0,
    dist_cap: constants.dist_cap_oil,
    reserve_cap: constants.reserve_cap_oil,
  }
}

// ── HAPPY ────────────────────────────────────────────────────

test distvest_happy() {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

test reservedraw_happy() {
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 5_000_000 }
  run(ReserveDraw, build_tx(s, s2, 5_000_000, [res_auth]))
}

test distvest_incremental() {
  // mint dần: state đã có 100 tLAMP dist, mint thêm 50.
  let s = SupplyState { ..fresh(), dist_minted: 100_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 150_000_000 }
  run(DistributionVest, build_tx(s, s2, 50_000_000, [auth_a]))
}

test distvest_exact_cap_boundary() {
  // mint tới ĐÚNG dist_cap (biên dưới-bằng được phép).
  let s = SupplyState { ..fresh(), dist_minted: constants.dist_cap_oil - 7 }
  let s2 = SupplyState { ..s, dist_minted: constants.dist_cap_oil }
  run(DistributionVest, build_tx(s, s2, 7, [auth_a]))
}

test reservedraw_exact_cap_boundary() {
  let s = SupplyState { ..fresh(), reserve_minted: constants.reserve_cap_oil - 3 }
  let s2 = SupplyState { ..s, reserve_minted: constants.reserve_cap_oil }
  run(ReserveDraw, build_tx(s, s2, 3, [res_auth]))
}

// ── NEGATIVE — A1: vượt cap ──────────────────────────────────

test mint_exceed_dist_cap() fail {
  let s = SupplyState { ..fresh(), dist_minted: constants.dist_cap_oil - 5 }
  let s2 = SupplyState { ..s, dist_minted: constants.dist_cap_oil + 1 }
  run(DistributionVest, build_tx(s, s2, 6, [auth_a]))
}

test mint_exceed_reserve_cap() fail {
  let s = SupplyState { ..fresh(), reserve_minted: constants.reserve_cap_oil }
  let s2 = SupplyState { ..s, reserve_minted: constants.reserve_cap_oil + 1 }
  run(ReserveDraw, build_tx(s, s2, 1, [res_auth]))
}

// ── A2: mint không consume SupplyState ───────────────────────

test mint_no_supplystate() fail {
  // không có input/output mang thread NFT → count == 0 ≠ 1 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        util.mk_input(util.mk_ref(0),
          util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000))),
      ],
      outputs: [],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── A4: rollback (minted giảm) ───────────────────────────────

test mint_rollback_dist() fail {
  // s2.dist_minted < s.dist_minted → vi phạm monotonic + quota.
  let s = SupplyState { ..fresh(), dist_minted: 100_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 50_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

// ── A5: mint sai quota (Distribution đụng Reserve) ───────────

test distvest_touches_reserve() fail {
  // DistributionVest nhưng lại tăng reserve_minted → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000, reserve_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

test reservedraw_touches_dist() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000, dist_minted: 1_000_000 }
  run(ReserveDraw, build_tx(s, s2, 1_000_000, [res_auth]))
}

// ── A6: burn / no-op (Δ ≤ 0) ─────────────────────────────────

test mint_negative() fail {
  // Δ = -1 (burn) → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 0 }
  run(DistributionVest, build_tx(s, s2, -1, [auth_a]))
}

test mint_zero() fail {
  // Δ = 0 (no-op) → reject (delta > 0).
  let s = fresh()
  let s2 = fresh()
  run(DistributionVest, build_tx(s, s2, 0, [auth_a]))
}

// ── A7: double-satisfaction (2 SupplyState input) ────────────

test two_supplystate_inputs() fail {
  // 2 input mang thread NFT → count == 2 ≠ 1 → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s), ss_input(s)],
      outputs: [ss_output(s2)],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── A8: Δ policy ≠ Δ datum ────────────────────────────────────

test delta_mismatch() fail {
  // mint 1_000_000 tLAMP nhưng datum chỉ cộng 1 → s2.dist_minted ≠ s+Δ → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

// ── A9: nới cap qua transition ───────────────────────────────

test widen_dist_cap() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000, dist_cap: constants.dist_cap_oil + 1 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

test widen_reserve_cap() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000, reserve_cap: constants.reserve_cap_oil * 2 }
  run(ReserveDraw, build_tx(s, s2, 1_000_000, [res_auth]))
}

// ── A10: thiếu chữ ký authority ──────────────────────────────

test mint_no_authority() fail {
  // DistributionVest nhưng không ai trong dist_authority ký → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [#"ff"]))
}

test reservedraw_wrong_authority() fail {
  // ReserveDraw nhưng chỉ có dist authority ký (không res_auth) → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  run(ReserveDraw, build_tx(s, s2, 1_000_000, [auth_a]))
}

// ── A11: mint asset name lạ cùng policy ──────────────────────

test mint_extra_name() fail {
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [ss_output(s2)],
      mint: mint_tlamp(1_000_000) |> assets.add(tlamp_pol, #"9999", 1),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── thread NFT bị burn/mint kèm (phá thread) ─────────────────

test thread_minted_in_tx() fail {
  // tx mint thêm thread NFT (qty thread ≠ 0) → reject (luật 1 ép == 0).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [ss_output(s2)],
      mint: mint_tlamp(1_000_000) |> assets.add(thr_pol, constants.supply_name, 1),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── SupplyState output rời địa chỉ script ────────────────────

test supplystate_moved_address() fail {
  // output mang thread NFT nhưng ở địa chỉ ví khác → s_out.address ≠ s_in.address.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let moved =
    util.mk_output(
      util.vk_address(#"dead"),
      assets.from_lovelace(2_000_000) |> assets.add(thr_pol, constants.supply_name, 1),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [moved],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── SupplyState recreate THIẾU (input có, output không mang NFT) ──

test no_supplystate_output() fail {
  // có SupplyState input nhưng KHÔNG recreate output mang thread NFT → count_out 0 ≠ 1.
  let s = fresh()
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [
        util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000)),
      ],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── Output mang NFT nhưng datum KHÔNG phải SupplyState (datum rác) ──

test garbage_output_datum() fail {
  // output mang thread NFT nhưng datum là Int rác → expect s2: SupplyState fail.
  let s = fresh()
  let garbage =
    util.mk_output(
      util.script_address(sscript),
      assets.from_lovelace(2_000_000) |> assets.add(thr_pol, constants.supply_name, 1),
      42,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [garbage],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ══════════════════════════════════════════════════════════════
// NEGATIVE bổ sung — neo bootstrap on-chain (Nhóm A/B/C audit MECE)
// ══════════════════════════════════════════════════════════════

/// SupplyState input KHÔNG mang SUPPLY NFT (UTxO giả tại địa chỉ script).
fn ss_input_no_nft(s: SupplyState) -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output(util.script_address(sscript), assets.from_lovelace(2_000_000), s),
  )
}

// ── D7-#1: cap INPUT phình (neo hằng) ─────────────────────────
test input_cap_inflated() fail {
  // s.dist_cap > hằng genesis → reject (luật 4 cũ chỉ so s2==s, không bắt được).
  let s = SupplyState { ..fresh(), dist_cap: constants.dist_cap_oil + 1_000_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

test input_reserve_cap_inflated() fail {
  let s = SupplyState { ..fresh(), reserve_cap: constants.reserve_cap_oil * 10 }
  let s2 = SupplyState { ..s, reserve_minted: 1_000_000 }
  run(ReserveDraw, build_tx(s, s2, 1_000_000, [res_auth]))
}

// ── D7-#10: counter INPUT âm ──────────────────────────────────
test input_counter_negative() fail {
  // s.dist_minted < 0 → reject (chống cap ảo qua counter âm).
  let s = SupplyState { ..fresh(), dist_minted: -1_000_000 }
  let s2 = SupplyState { ..s, dist_minted: 0 }
  run(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]))
}

test input_reserve_counter_negative() fail {
  let s = SupplyState { ..fresh(), reserve_minted: -5 }
  let s2 = SupplyState { ..s, reserve_minted: -4 }
  run(ReserveDraw, build_tx(s, s2, 1, [res_auth]))
}

// ── D8-#1 (neo NFT): SupplyState INPUT KHÔNG mang SUPPLY NFT → reject ──
test input_no_supply_nft() fail {
  // UTxO giả KHÔNG mang SUPPLY NFT → count_inputs_holding_nft == 0 ≠ 1 → reject.
  // Đây là neo định danh mới: không bằng địa chỉ-script (gây vòng) mà bằng NFT one-shot.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input_no_nft(s)],
      outputs: [ss_output(s2)],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── D7-#2: vượt TRẦN TỔNG (defense-in-depth) ──────────────────
// Lưu ý: với cap neo hằng, trần tổng = dist_cap+reserve_cap; muốn chạm trần phải
// đẩy 1 nhánh tới cap rồi nhánh kia vượt. Test bằng reserve tới sát rồi cộng vượt
// tổng nhưng vẫn ≤ reserve_cap là bất khả (reserve_cap < total). Dùng kịch bản:
// dist đã = dist_cap, mint reserve khiến tổng > total — nhưng reserve_minted vẫn phải
// ≤ reserve_cap. Vì dist_cap+reserve_cap == total_cap, chạm trần ⟺ chạm cả 2 cap.
// → trần tổng là lớp phòng thủ dư (đã được 2 cap riêng bao). Khẳng định nó KHÔNG
// loại oan happy-case biên kép:
test total_cap_double_boundary_ok() {
  // dist đầy cap, reserve mint tới đúng cap → tổng == total_cap (==, không vượt).
  let s = SupplyState { ..fresh(), dist_minted: constants.dist_cap_oil, reserve_minted: constants.reserve_cap_oil - 1 }
  let s2 = SupplyState { ..s, reserve_minted: constants.reserve_cap_oil }
  run(ReserveDraw, build_tx(s, s2, 1, [res_auth]))
}

// ── D3-#1: nhồi tLAMP vào SupplyState output ──────────────────
test state_output_holds_tlamp() fail {
  // s_out chứa tLAMP → reject (continuing output phải sạch tLAMP).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let dirty =
    util.mk_output(
      util.script_address(sscript),
      assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, constants.supply_name, 1)
        |> assets.add(tlamp_pol, constants.tlamp_name, 500_000),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [dirty],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── D3 (token rác): SupplyState output mang token policy lạ ────
test state_output_foreign_token() fail {
  // s_out mang thread NFT + 1 token policy lạ → value_only_nft_and_ada fail → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let dirty =
    util.mk_output(
      util.script_address(sscript),
      assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, constants.supply_name, 1)
        |> assets.add(#"aaaa", #"1234", 7),
      s2,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [dirty],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── D3-#3: SupplyState output đính reference_script ───────────
test state_output_has_reference_script() fail {
  // s_out.reference_script != None → reject.
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  let with_ref =
    Output {
      address: util.script_address(sscript),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(thr_pol, constants.supply_name, 1),
      datum: InlineDatum(s2),
      reference_script: Some(#"deadbeef"),
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input(s)],
      outputs: [with_ref],
      mint: mint_tlamp(1_000_000),
      extra_signatories: [auth_a],
    }
  run(DistributionVest, tx)
}

// ── D2-#1: threshold == 0 ─────────────────────────────────────
test threshold_zero_rejected() fail {
  // threshold 0 → vô hiệu authority (ai cũng mint) → reject (ép >= 1).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run_thr(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]), [auth_a, auth_b], 0)
}

// ── D2-#2: threshold > |authority| ────────────────────────────
test threshold_exceeds_n_rejected() fail {
  // threshold 3 > 2 authority key → khóa chết → reject (ép <= N).
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run_thr(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a, auth_b]), [auth_a, auth_b], 3)
}

// ── D2-#3: key authority trùng không phình N ──────────────────
test duplicate_authority_key_no_inflate() fail {
  // authority = [auth_a, auth_a] (N giả = 2), threshold 2; chỉ auth_a ký.
  // count_sigs dedupe → distinct count = 1 < 2 → reject. (Đồng thời threshold <= unique N=1
  // cũng fail → chống nhồi key.)
  let s = fresh()
  let s2 = SupplyState { ..s, dist_minted: 1_000_000 }
  run_thr(DistributionVest, build_tx(s, s2, 1_000_000, [auth_a]), [auth_a, auth_a], 2)
}
