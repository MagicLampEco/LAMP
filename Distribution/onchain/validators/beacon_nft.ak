// Beacon authenticity NFT — minting policy ONE-SHOT (CONTRACT v2).
//
// Beacon UTxO DropParam cần đúng 1 authenticity NFT để chống datum hijacking:
// kẻ tấn công có thể tạo UTxO giả tại cùng beacon address với datum bịa, nhưng
// KHÔNG thể mint NFT này → claim_account (đọc D qua reference input) + beacon
// validator chỉ tin UTxO mang NFT.
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi 1 genesis OutputReference. Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis đó. Vì 1 UTxO chỉ spend được 1 lần trong lịch sử
//   chain → policy chạy được đúng 1 lần → supply 1 NFT cố định, KHÔNG re-mint.
//   Đây là bất biến mạnh nhất có thể đạt được mà không cần state on-chain.
//
// MINT shape (đúng 1, không hơn không kém):
//   (DROP, +1) — authenticity token cho beacon DropParam.
//
// BURN — chọn an toàn = CẤM hoàn toàn (xem QĐ ghi dưới).
//
// ĐÍCH ĐẾN (C-BCN-GEN-*, thêm 2026-09-26) — xem khối chú thích trong thân `mint`.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/lampdist/constants
use magiclamp/lampdist/types.{BeaconDatum, DropParam}
use magiclamp/lampdist/util

/// Redeemer của minting policy.
///
/// Chỉ một action `MintGenesis`. KHÔNG có biến thể Burn:
///
/// QĐ (trục an toàn vốn + bền vững hệ thống): CẤM burn.
///  - Beacon NFT là authenticity token sống suốt vòng đời module. Burn được =
///    cho phép phá tính xác thực beacon → datum hijacking lại có cửa. Không có
///    use-case hợp lệ nào cần đốt NFT này.
///  - One-shot đã chặn re-mint, nên cấm burn khiến supply BẤT BIẾN tuyệt đối
///    (đúng 1, mãi mãi). Đơn giản hoá lý luận an toàn cho mọi validator phụ thuộc.
///  - `else(_) { fail }` chặn mọi purpose khác (spend/withdraw/...) lẫn mọi
///    redeemer ngoài MintGenesis → mint âm (burn) tự động bị từ chối.
pub type BeaconNftRedeemer {
  MintGenesis
}

validator beacon_nft(genesis_ref: OutputReference) {
  mint(_redeemer: BeaconNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ───────────────────────────
    // 1 UTxO spend được tối đa 1 lần → policy chạy được tối đa 1 lần.
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, qty +1 ───────────────────────
    // tokens(mint, policy_id) = Dict<AssetName, Int> chỉ gồm asset của policy
    // này. size == 1 đảm bảo KHÔNG mint thừa asset name lạ; quantity_of == 1
    // đảm bảo đúng (DROP,1) — không hơn không kém, không qty 2, không qty âm (burn).
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    let drop_name = util.beacon_name(DropParam)
    expect assets.quantity_of(tx.mint, policy_id, drop_name) == 1

    // ── ĐÍCH ĐẾN: NFT phải hạ cánh ở MỘT SCRIPT, mang `BeaconDatum` HỢP LỆ ────────────
    // Thêm 2026-09-26. Trước bản vá policy này chỉ ép "đúc đúng một lần", KHÔNG một chữ
    // nào về nơi NFT hạ cánh — y hệt lỗ mà `treasury_nft.ak` đã vá cho TRSY ngày
    // 2026-08-12, chỉ khác tên tài sản.
    //
    // Vì sao nó vô hiệu HẲN Capped Drop v3 nếu thiếu: `util.find_beacon` tìm beacon THUẦN
    // THEO NFT. Đúc DROP vào một VÍ thì người giữ ví viết lại `index` · `rate_root` ·
    // `trim_*` ở mỗi lần tiêu tuỳ ý — `beacon.ak` (toàn bộ C-BCN-*) KHÔNG BAO GIỜ chạy, và
    // `claim_account` ▸ Redeem đọc chỉ số cộng dồn do chính kẻ đó viết. Không bất biến nào
    // vỡ, không bài kiểm nào đỏ: hệ chỉ đơn giản không còn cái trần nào.
    //
    // Không ràng ĐÚNG hash beacon được, và đây là vòng tham số CÓ THẬT, không phải sự cẩn
    // thận thừa: `beacon(committee, threshold, beacon_nft_policy, ms_per_epoch)` ⇒ hash
    // beacon cần policy DROP, còn `beacon_nft(genesis_ref)` mà nhận hash beacon thì policy
    // DROP lại cần hash beacon. Khép kín, không bake được — cùng hình dạng vòng mà C-SOLV-5
    // (`claim_account.ak`) đã ghi cho TRSY. Nên phòng thủ chia hai tầng:
    //   (a) GENESIS — ở đây: phải là Script + datum hợp lệ.
    //   (b) VÒNG ĐỜI — `util.find_beacon` ép beacon tham chiếu ngụ tại Script, và
    //       `beacon.ak` ép output về ĐÚNG địa chỉ input. DROP không đổi nhà được nữa.
    expect [carrier] =
      list.filter(tx.outputs, fn(o) { assets.quantity_of(o.value, policy_id, drop_name) == 1 })
    expect Script(_) = carrier.address.payment_credential
    expect InlineDatum(d) = carrier.datum
    expect bd: BeaconDatum = d

    // C-BCN-GEN-1: `kind` phải là `DropParam` — `util.find_beacon` đòi đúng thế ở mọi lần
    // đọc, nên một genesis mang kind khác là một beacon KHÔNG AI ĐỌC ĐƯỢC, mà NFT thì
    // one-shot nên không đúc lại được cái thứ hai.
    expect bd.kind == DropParam

    // ── C-BCN-GEN-2: `rate_root` TRONG BIÊN CỨNG ─────────────────────────────────────
    // Đây là chốt đắt nhất của cả khối, vì nó là chốt DUY NHẤT không sửa được bằng một
    // lượt post: `beacon.ak` ép cả `rate_root_out ∈ [min, max]` (C-BCN-5b), `rate_root_out
    // ≥ rate_root_in` (C-BCN-5') và `(out − in)·q ≤ in·max_delta_q` (C-BCN-5a) CÙNG LÚC.
    //   • genesis `w > max` ⇒ mọi post phải có `out ≥ w > max` ⇒ đứt C-BCN-5b. Không lượt
    //     post nào hợp lệ NỮA, VĨNH VIỄN — kênh điều tiết tốc độ chết câm.
    //   • genesis `w < min/1,1` ⇒ post phải `out ≥ min` mà `out ≤ 1,1w < min` ⇒ cũng bế tắc.
    // Cả hai ca đều bất khả hồi: DROP NFT one-shot, không đốt được, và `beacon.ak` không có
    // nhánh nào cho nó rời script. Trước bản vá chốt này CHỈ có ở off-chain
    // (`Distribution/scripts/03_genesis.ts`, mã lỗi `GEN-V3-002`) — tức một kỷ luật vận
    // hành, sửa được sau, đúng thứ không được phép gác một trạng thái không hoàn tác.
    expect bd.rate_root >= constants.rate_root_min
    expect bd.rate_root <= constants.rate_root_max

    // C-BCN-GEN-3: mẫu số cắt ngọn khác 0. `trim_den = 0` làm phép chia ở `claim_account` ▸
    // Redeem ĐỔ VỠ (chia 0 trong Plutus là lỗi, không phải một giá trị) ⇒ không tx rút nào
    // dựng được. `beacon.ak` đã ép chốt này cho mọi lượt POST; genesis thì chưa ai ép.
    expect bd.trim_den > 0

    // C-BCN-GEN-4 / C-BCN-TRIM-NUM: tử số cắt ngọn khác 0 (và không âm).
    // `trim_num = 0` ⇒ `total_redeemed · 0 / trim_den == 0` ⇒ trần một lượt rút bị ghim
    // VĨNH VIỄN ở `max(trim_floor, 0) == trim_floor`, tức 1.000 LAMP mỗi giao dịch cho mọi
    // pot, mọi cỡ. Không bất biến nào vỡ — đó là lý do nó lọt: nó không phá tính đúng, nó
    // phá THÔNG LƯỢNG, và thông lượng không có bài kiểm nào canh.
    expect bd.trim_num > 0

    // C-BCN-GEN-5: chỉ số cộng dồn mở sổ KHÔNG ÂM. `A` được đặc tả là "cộng dồn, CHỈ TĂNG"
    // (`types.ak` ▸ `BeaconDatum.index`) và Định lý 1 của `Math-Spec.md` v3 đứng trên đó.
    // Mở sổ ở một số âm không phá đẳng thức nào (`index_at_start` chụp lại đúng giá trị âm
    // ấy nên `A_span` vẫn ≥ 0) nhưng nó làm trường này nói sai về chính nó, và mọi công cụ
    // đọc sổ ngoài chuỗi phải mang theo một ngoại lệ mà không gì nhắc.
    expect bd.index >= 0

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const nt_policy: PolicyId = #"beac"

/// genesis UTxO mà policy bắt buộc consume (output_index 7 để phân biệt).
fn nt_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

/// Mint value tham số hoá theo qty (để dựng cả happy + sai lệch).
fn nt_mint(drop_qty: Int) -> Value {
  assets.zero
    |> assets.add(nt_policy, util.beacon_name(DropParam), drop_qty)
}

/// Input consume genesis ref (dummy output ví thường).
fn nt_genesis_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(nt_genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

/// Input bất kỳ KHÔNG phải genesis (output_index khác).
fn nt_other_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(0), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

const nt_beacon_sh: ByteArray = #"b0b0b0b0"

/// Value của carrier hợp lệ: min-ADA + đúng 1 DROP.
fn nt_carrier_value() -> Value {
  assets.from_lovelace(2_000_000)
    |> assets.add(nt_policy, util.beacon_name(DropParam), 1)
}

/// `BeaconDatum` genesis tham số hoá theo BỐN trường mà C-BCN-GEN-* gác.
fn nt_datum(rate_root: Int, trim_num: Int, trim_den: Int, index: Int) -> BeaconDatum {
  BeaconDatum {
    epoch: 4142,
    kind: DropParam,
    index: index,
    rate_root: rate_root,
    trim_num: trim_num,
    trim_den: trim_den,
    speed_policies: [],
  }
}

/// Carrier HỢP LỆ: ở Script, mang DROP, datum genesis thoả trọn C-BCN-GEN-*.
fn nt_carrier() -> Output {
  nt_carrier_d(nt_datum(constants.rate_root_min * 10, 1, 1000, 0))
}

fn nt_carrier_d(bd: BeaconDatum) -> Output {
  util.mk_output(util.script_address(nt_beacon_sh), nt_carrier_value(), bd)
}

/// tx đúc genesis với MỘT carrier tuỳ ý — khuôn của mọi ca dưới.
fn nt_tx(carrier: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [nt_other_input(), nt_genesis_input()],
    outputs: [carrier],
    mint: nt_mint(1),
  }
}

fn nt_run(tx: Transaction) -> Bool {
  beacon_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test mint_happy() {
  // consume genesis + mint đúng 1 NFT qty 1 + hạ cánh ở Script với datum hợp lệ → pass.
  nt_run(nt_tx(nt_carrier()))
}

test mint_without_genesis() fail {
  // KHÔNG consume genesis ref → one-shot reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input()],
      outputs: [nt_carrier()],
      mint: nt_mint(1),
    }
  nt_run(tx)
}

test mint_wrong_quantity() fail {
  // mint 2 DROP (≠ 1) → reject (supply phải đúng 1).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      outputs: [nt_carrier()],
      mint: nt_mint(2),
    }
  nt_run(tx)
}

// ── ĐÍCH ĐẾN: Script + datum ─────────────────────────────────────────────────

/// Ca SINH RA bản vá: đúc DROP thẳng vào VÍ. Trước 2026-09-26 tx này PASS — và từ đó
/// `beacon.ak` không bao giờ chạy, mọi C-BCN-* chết câm, người giữ ví tự viết chỉ số
/// cộng dồn của toàn hệ ở mỗi lần tiêu.
test mint_drop_to_wallet_fails() fail {
  let to_wallet =
    util.mk_output(
      util.vk_address(#"badbad"),
      nt_carrier_value(),
      nt_datum(constants.rate_root_min * 10, 1, 1000, 0),
    )
  nt_run(nt_tx(to_wallet))
}

test mint_no_datum_fails() fail {
  // Ở Script nhưng KHÔNG datum: `util.find_beacon` sẽ ném ở mọi lần đọc ⇒ beacon chết
  // ngay lúc sinh, mà NFT one-shot không đúc lại được cái thứ hai.
  let bare = util.mk_output_no_datum(util.script_address(nt_beacon_sh), nt_carrier_value())
  nt_run(nt_tx(bare))
}

/// Datum KHÔNG giải được thành `BeaconDatum`. `BeaconKind` hiện chỉ có một hằng tử nên
/// không dựng được "kind sai" bằng kiểu; ca này tấn công đúng chỗ đó từ phía `Data` thô —
/// một `Data` sai hình dạng đi qua `expect bd: BeaconDatum = d`.
test mint_datum_not_a_beacon_fails() fail {
  let wrong =
    util.mk_output(util.script_address(nt_beacon_sh), nt_carrier_value(), 42)
  nt_run(nt_tx(wrong))
}

/// Hình dạng giống hệt `BeaconDatum` nhưng `kind` có hằng tử thứ hai — để dựng được một
/// `Data` mang `kind = Constr 1 []`, thứ mà kiểu `BeaconKind` một-hằng-tử không cho dựng.
type WideKind {
  WideDrop
  WideOther
}

type WideBeacon {
  epoch: Int,
  kind: WideKind,
  index: Int,
  rate_root: Int,
  trim_num: Int,
  trim_den: Int,
  speed_policies: List<ByteArray>,
}

/// `kind` = Constr 1 (không phải `DropParam`), mọi trường khác hợp lệ. Ca này đo C-BCN-GEN-1
/// cùng với phép giải `expect bd: BeaconDatum = d`: một trong hai phải từ chối.
/// Đo 2026-09-26: gỡ hẳn `expect bd.kind == DropParam` thì ca này VẪN đỏ — phép giải đã
/// từ chối Constr 1. Chốt C-BCN-GEN-1 hiện là đột biến TƯƠNG ĐƯƠNG, không bài nào ghim
/// được nó; nó chỉ có tác dụng khi `BeaconKind` có thêm hằng tử.
test mint_datum_kind_not_drop_param_fails() fail {
  let wide: Data =
    WideBeacon {
      epoch: 4142,
      kind: WideOther,
      index: 0,
      rate_root: constants.rate_root_min * 10,
      trim_num: 1,
      trim_den: 1000,
      speed_policies: [],
    }
  nt_run(nt_tx(util.mk_output(util.script_address(nt_beacon_sh), nt_carrier_value(), wide)))
}

/// Đối chứng PASS: cùng hình dạng `WideBeacon` nhưng `kind = WideDrop` (Constr 0 ≡ `DropParam`).
/// Thiếu ca này, ca trên có thể đỏ vì `WideBeacon` lệch hình dạng chứ không vì `kind`.
test mint_datum_wide_drop_ok() {
  let wide: Data =
    WideBeacon {
      epoch: 4142,
      kind: WideDrop,
      index: 0,
      rate_root: constants.rate_root_min * 10,
      trim_num: 1,
      trim_den: 1000,
      speed_policies: [],
    }
  nt_run(nt_tx(util.mk_output(util.script_address(nt_beacon_sh), nt_carrier_value(), wide)))
}

// ── C-BCN-GEN-2: biên cứng của `rate_root` ───────────────────────────────────

/// SÀN − 1. Ca bế tắc VĨNH VIỄN: post phải `≥ min` mà C-BCN-5a chỉ cho `≤ 1,1w`.
test mint_rate_root_below_floor_fails() fail {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min - 1, 1, 1000, 0))))
}

/// TRẦN + 1. Ca bế tắc VĨNH VIỄN theo chiều kia: mọi post phải `≥ w > max` ⇒ đứt C-BCN-5b.
test mint_rate_root_above_ceiling_fails() fail {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_max + 1, 1, 1000, 0))))
}

/// Đối chứng PASS ở ĐÚNG SÀN. Thiếu nó, hai bài trên có thể đỏ vì hằng biên hỏng chứ
/// không vì cái biên — và cặp `min−1 / min` là cặp phân biệt được hai cực đó.
test mint_rate_root_exactly_at_floor_ok() {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min, 1, 1000, 0))))
}

/// Đối chứng PASS ở ĐÚNG TRẦN (mệnh đề là ≤, không phải <).
test mint_rate_root_exactly_at_ceiling_ok() {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_max, 1, 1000, 0))))
}

// ── C-BCN-GEN-3/4: hai tham số cắt ngọn ──────────────────────────────────────

/// `trim_den = 0` ⇒ phép chia ở `claim_account` ▸ Redeem đổ vỡ ⇒ KHÔNG tx rút nào dựng
/// được nữa. `beacon.ak` ép chốt này cho lượt POST từ 2026-09-22; genesis thì chưa.
test mint_zero_trim_denominator_fails() fail {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min * 10, 1, 0, 0))))
}

/// `trim_num = 0` ⇒ trần một lượt rút ghim vĩnh viễn ở `trim_floor` cho MỌI pot.
/// Cặp phân biệt với bài trên: cả hai đều là tham số cắt ngọn, chỉ một cái làm tx ĐỔ VỠ,
/// cái kia làm tx HỢP LỆ mà vô dụng — nên phải có hai bài, không gộp một.
test mint_zero_trim_numerator_fails() fail {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min * 10, 0, 1000, 0))))
}

/// Đối chứng: `trim_num = 1`, `trim_den = 1` (siết chặt nhất còn hợp lệ) vẫn QUA — hai
/// bài trên đỏ vì số 0, không vì một chốt tưởng tượng nào về độ lớn của κ.
test mint_trim_one_over_one_ok() {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min * 10, 1, 1, 0))))
}

// ── C-BCN-GEN-5: chỉ số mở sổ không âm ───────────────────────────────────────

test mint_negative_index_fails() fail {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min * 10, 1, 1000, -1))))
}

/// Đối chứng: `index = 0` là giá trị mở sổ ĐÚNG (mệnh đề là ≥ 0, không phải > 0).
/// `mint_happy` cũng dùng 0, nhưng ca này nói ra chủ ý để bài trên không bị đọc thành
/// "index phải dương".
test mint_zero_index_ok() {
  nt_run(nt_tx(nt_carrier_d(nt_datum(constants.rate_root_min * 10, 1, 1000, 0))))
}
