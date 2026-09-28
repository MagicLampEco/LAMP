// Validator 5 — `weight_param_nft`: policy ĐÚC NFT tham số weight, và là nơi DUY
// NHẤT bảng `WeightParam` được kiểm trước khi nó thành nguồn tin cho `tally`.
//
// ┌─ VÌ SAO PHẢI CÓ TỆP NÀY ────────────────────────────────────────────────────┐
// │ `tally.Finalize` đọc `WeightParam` qua reference input và dùng `bft_floor` làm │
// │ MẪU SỐ của trần clamp τ = ΣVP / F, `theta_num/theta_den` làm ngưỡng thông qua.│
// │ Trước v2 không policy nào gác việc TẠO RA bảng đó: một UTxO mang `WeightParam`│
// │ với `bft_floor` khổng lồ làm τ → 0 (mọi cử tri bị coi là cá voi), hoặc với    │
// │ `theta_num = 1, theta_den = 100` làm ngưỡng thông qua tụt về 1% — và `tally`  │
// │ chỉ kiểm D8, không kiểm hai thứ đó. Cổng phải nằm ở chỗ bảng được SINH RA.   │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ UTxO tham số là BEACON KHOÁ VĨNH VIỄN — có chủ ý ────────────────────────────┐
// │ Đích bị ép là `Script(policy_id)`: địa chỉ có payment credential đúng bằng    │
// │ hash của CHÍNH script này. Script này không có nhánh `spend`, và `else(_)`    │
// │ `fail`, nên KHÔNG giao dịch nào tiêu lại được UTxO đó. Đây là lựa chọn:      │
// │ bảng weight phải bất biến trong suốt vòng đời một pha, và cách rẻ nhất để ép │
// │ bất biến là làm nó không tiêu được. Giá phải trả là min-ADA của UTxO đó bị    │
// │ khoá vĩnh viễn — số đo và cách đổi bảng (đúc NFT pha MỚI với `phase_tag`      │
// │ khác) khai ở `Governance/SPEC.md`.                                            │
// │                                                                               │
// │ Phép thử "rót đúng địa chỉ không phải rót vào sổ" đi theo chiều NGƯỢC ở đây:  │
// │ câu hỏi không phải "có giao dịch nào tiêu lại được không" (câu trả lời là     │
// │ KHÔNG, và đó là đích), mà "bên đọc nó có nhận ra nó không" — `tally` nhận ra  │
// │ bằng chính NFT `(policy_id, phase_tag)`, nên nó nằm TRONG sổ của bên đọc.     │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Tham số hoá: seed_ref (one-shot), phase_tag (tên tài sản = mã pha),
//              bft_floor_min, bft_floor_max, quorum_voters_min.
// Preprod chốt: bft_floor_min = 21, bft_floor_max = 64, quorum_voters_min = 21.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/governance/power.{Knot, scale}
use magiclamp/governance/types.{WeightParam}
use magiclamp/governance/util
use magiclamp/governance/weight_guard

pub type WeightParamNftRedeemer {
  MintWeightParam
}

validator weight_param_nft(
  seed_ref: OutputReference,
  phase_tag: ByteArray,
  bft_floor_min: Int,
  bft_floor_max: Int,
  quorum_voters_min: Int,
) {
  mint(_redeemer: WeightParamNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: tiêu đúng UTxO hạt giống ⇒ policy chạy đúng một lần ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == seed_ref })

    // ── Đúc ĐÚNG một tên tài sản, đúng một đơn vị, và KHÔNG policy nào khác ──
    //    Vế "một policy" chặn đường gộp lượt đúc bảng weight vào một giao dịch
    //    đúc thứ khác, nơi các cổng của thứ kia có thể diễn giải output này.
    expect dict.size(assets.tokens(tx.mint, policy_id)) == 1
    expect assets.quantity_of(tx.mint, policy_id, phase_tag) == 1
    expect list.length(assets.policies(tx.mint)) == 1

    // ── ĐÍCH: đúng MỘT output giữ NFT, tại `Script(policy_id)`, không đính script ──
    //    Không có vế đích thì NFT đi vào ví bất kỳ cùng một datum bịa, và `tally`
    //    vẫn đọc được nó qua reference input — cổng ở trên thành ra vô nghĩa.
    let holders =
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy_id, phase_tag) > 0 },
      )
    expect [out] = holders
    expect assets.quantity_of(out.value, policy_id, phase_tag) == 1
    expect util.is_at_script(out.address, policy_id)
    expect out.reference_script == None

    // ── Bảng weight phải HỢP LỆ ngay tại lượt sinh ──
    expect InlineDatum(d) = out.datum
    expect wp: WeightParam = d
    and {
      // ngưỡng thông qua θ = theta_num/theta_den ∈ [1/2, 1] — dưới 1/2 thì thiểu số
      // quyết được, trên 1 thì không proposal nào qua nổi.
      wp.theta_num >= 1,
      wp.theta_num <= wp.theta_den,
      2 * wp.theta_num >= wp.theta_den,
      // F là MẪU SỐ của τ = ΣVP/F. F nhỏ ⇒ trần cao ⇒ clamp thành phép rỗng;
      // F lớn ⇒ trần thấp ⇒ mọi cử tri bị coi là cá voi. Kẹp HAI ĐẦU.
      wp.bft_floor >= bft_floor_min,
      wp.bft_floor <= bft_floor_max,
      // quorum theo NGƯỜI có sàn (bất biến "cử tri = cá nhân" cần một sàn số người);
      // quorum theo VP chỉ cần dương — 0 làm quorum VP tắt hẳn.
      wp.quorum_voter_threshold >= quorum_voters_min,
      wp.quorum_vp_threshold >= 1,
      // D8: yếu tố MUA ĐƯỢC không nặng hơn yếu tố PHẢI KIẾM, và không yếu tố nào tắt.
      weight_guard.d8_ok(wp.k1, wp.k2, wp.k3, wp.k4),
    }
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

/// Trong ca kiểm, `policy_id` ĐỒNG THỜI là script hash của đích — đúng như trên chuỗi.
const wp_policy: PolicyId = #"a0a0"

const tag: ByteArray = #"5031"

const bft_min: Int = 21

const bft_max: Int = 64

const voters_min: Int = 21

fn seed() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 4 }
}

fn seed_input() -> Input {
  util.mk_input(
    seed(),
    util.mk_output_no_datum(
      util.vk_address(#"f0"),
      assets.from_lovelace(5_000_000),
    ),
  )
}

fn other_input() -> Input {
  util.mk_input(
    util.mk_ref(9),
    util.mk_output_no_datum(
      util.vk_address(#"f0"),
      assets.from_lovelace(5_000_000),
    ),
  )
}

/// Bảng w = 1.0 trên [0, 10^9].
fn k_w1() -> List<Knot> {
  [Knot { c: 0, pow: 0 }, Knot { c: 1_000_000_000, pow: 1_000_000_000 * scale }]
}

/// Bảng w = 0.5 trên [0, 10^9] — ba mốc, nằm DƯỚI `k_w1` với mọi c ≥ 1.
fn k_w05() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 250_000_000, pow: 15_811 * scale },
    Knot { c: 1_000_000_000, pow: 31_623 * scale },
  ]
}

fn good_wp() -> WeightParam {
  WeightParam {
    k1: k_w1(),
    k2: k_w05(),
    k3: k_w1(),
    k4: k_w05(),
    bft_floor: 21,
    quorum_vp_threshold: 1_000 * scale,
    quorum_voter_threshold: 21,
    theta_num: 2,
    theta_den: 3,
  }
}

fn nft_value() -> Value {
  assets.from_lovelace(2_000_000) |> assets.add(wp_policy, tag, 1)
}

fn beacon_out(wp: WeightParam) -> Output {
  util.mk_output(util.script_address(wp_policy), nft_value(), wp)
}

fn run(tx: Transaction) -> Bool {
  weight_param_nft.mint(
    seed(),
    tag,
    bft_min,
    bft_max,
    voters_min,
    MintWeightParam,
    wp_policy,
    tx,
  )
}

fn mint_tx(outputs: List<Output>, mint: Value, inputs: List<Input>) -> Transaction {
  Transaction { ..placeholder, inputs: inputs, outputs: outputs, mint: mint }
}

fn one_mint() -> Value {
  assets.zero |> assets.add(wp_policy, tag, 1)
}

fn happy_tx() -> Transaction {
  mint_tx(
    [beacon_out(good_wp())],
    one_mint(),
    [other_input(), seed_input()],
  )
}

test wp_mint_happy() {
  run(happy_tx())
}

// ── one-shot + hình dạng lượt đúc ──

test wp_khong_tieu_hat_giong_tu_choi() fail {
  expect run(mint_tx([beacon_out(good_wp())], one_mint(), [other_input()]))
  True
}

test wp_hai_don_vi_tu_choi() fail {
  let mint = assets.zero |> assets.add(wp_policy, tag, 2)
  let val = assets.from_lovelace(2_000_000) |> assets.add(wp_policy, tag, 2)
  let out = util.mk_output(util.script_address(wp_policy), val, good_wp())
  expect run(mint_tx([out], mint, [seed_input()]))
  True
}

/// Đúc thêm một TÊN tài sản thứ hai cùng policy — `dict.size == 1` bác.
test wp_hai_ten_cung_policy_tu_choi() fail {
  let mint = one_mint() |> assets.add(wp_policy, #"5032", 1)
  expect run(mint_tx([beacon_out(good_wp())], mint, [seed_input()]))
  True
}

/// Gộp với một policy KHÁC trong cùng lượt đúc.
test wp_gop_policy_khac_tu_choi() fail {
  let mint = one_mint() |> assets.add(#"beef", #"01", 1)
  expect run(mint_tx([beacon_out(good_wp())], mint, [seed_input()]))
  True
}

// ── đích ──

/// NFT đi vào VÍ THƯỜNG: `tally` vẫn đọc được qua reference input, nên không có
/// vế đích thì mọi cổng bảng ở trên vô nghĩa.
test wp_dich_vi_thuong_tu_choi() fail {
  let out = util.mk_output(util.vk_address(#"f0"), nft_value(), good_wp())
  expect run(mint_tx([out], one_mint(), [seed_input()]))
  True
}

/// NFT đi vào một script KHÁC (không phải chính policy này) ⇒ có nhánh tiêu lại.
test wp_dich_script_khac_tu_choi() fail {
  let out = util.mk_output(util.script_address(#"dead"), nft_value(), good_wp())
  expect run(mint_tx([out], one_mint(), [seed_input()]))
  True
}

test wp_dich_dinh_kem_script_tu_choi() fail {
  let out =
    Output { ..beacon_out(good_wp()), reference_script: Some(#"aabb") }
  expect run(mint_tx([out], one_mint(), [seed_input()]))
  True
}

test wp_khong_output_nao_giu_nft_tu_choi() fail {
  let out =
    util.mk_output(
      util.script_address(wp_policy),
      assets.from_lovelace(2_000_000),
      good_wp(),
    )
  expect run(mint_tx([out], one_mint(), [seed_input()]))
  True
}

// ── cổng bảng ──

test wp_theta_num_khong_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), theta_num: 0, theta_den: 3 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

test wp_theta_tren_mot_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), theta_num: 4, theta_den: 3 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

/// θ = 1/3 < 1/2 — thiểu số quyết được.
test wp_theta_duoi_mot_nua_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), theta_num: 1, theta_den: 3 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

/// θ = 1/2 đúng bằng sàn — PHẢI qua (kiểm chiều so sánh không bị lệch một đơn vị).
test wp_theta_dung_mot_nua_qua() {
  let wp = WeightParam { ..good_wp(), theta_num: 1, theta_den: 2 }
  run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
}

test wp_bft_duoi_san_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), bft_floor: bft_min - 1 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

test wp_bft_tren_tran_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), bft_floor: bft_max + 1 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

test wp_bft_dung_hai_bien_qua() {
  let lo = WeightParam { ..good_wp(), bft_floor: bft_min }
  let hi = WeightParam { ..good_wp(), bft_floor: bft_max }
  and {
    run(mint_tx([beacon_out(lo)], one_mint(), [seed_input()])),
    run(mint_tx([beacon_out(hi)], one_mint(), [seed_input()])),
  }
}

test wp_quorum_nguoi_duoi_san_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), quorum_voter_threshold: voters_min - 1 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

test wp_quorum_vp_khong_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), quorum_vp_threshold: 0 }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

/// D8: bảng C4 (vốn, mua được) nặng hơn bảng C3 (uy tín).
test wp_d8_von_nang_hon_uy_tin_tu_choi() fail {
  let wp = WeightParam { ..good_wp(), k3: k_w05(), k4: k_w1() }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

/// D8: một yếu tố bị TẮT (bảng phẳng).
test wp_d8_yeu_to_bi_tat_tu_choi() fail {
  let flat =
    [Knot { c: 0, pow: scale }, Knot { c: 1_000_000_000, pow: scale }]
  let wp = WeightParam { ..good_wp(), k3: flat, k4: flat }
  expect run(mint_tx([beacon_out(wp)], one_mint(), [seed_input()]))
  True
}

// ── đốt ──

/// Nhánh `mint` với số lượng âm không qua `quantity_of(...) == 1`; mọi mục đích
/// khác (`spend`/`withdraw`/…) rơi vào `else(_) { fail }` ⇒ NFT không đốt được.
test wp_dot_tu_choi() fail {
  let mint = assets.zero |> assets.add(wp_policy, tag, -1)
  expect run(mint_tx([], mint, [seed_input()]))
  True
}
