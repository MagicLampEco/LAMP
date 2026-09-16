// Beacon validator (CONTRACT v2, C-BCN-1).
// Committee post DropParam D mỗi epoch. Authenticity = NFT.
// Genesis beacon (epoch đầu) được tạo bằng cách pay-to-address + NFT lúc deploy
// (không qua validator). Mọi update sau spend + re-create với epoch tăng.

use aiken/interval
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction, placeholder}
use magiclamp/lampdist/constants
use magiclamp/lampdist/math
use magiclamp/lampdist/types.{
  BeaconDatum, BeaconKind, BeaconRedeemer, DropParam, PostBeacon,
}
use magiclamp/lampdist/util

validator beacon(
  committee         : List<ByteArray>,
  threshold         : Int,
  beacon_nft_policy : ByteArray,
  // ⚠ THÊM 2026-09-16 (vá Issue #72, lỗ 2 + lỗ 3) — ĐẶT CUỐI theo đúng khuôn đã dùng ở
  // `claim_account.ak` và `treasury.ak`: tham số mới đi sau cùng để không xáo trộn thứ tự
  // các tham số cũ trong chuỗi apply-param offchain.
  // `beacon_nft(genesis_ref)` KHÔNG nướng hash beacon, nên thêm tham số ở đây chỉ đổi
  // ĐỊA CHỈ beacon; `beacon_nft_policy` giữ nguyên ⇒ `claim_account` (nhận policy đó)
  // KHÔNG đổi hash theo.
  ms_per_epoch      : Int,
) {
  spend(
    datum_opt : Option<BeaconDatum>,
    _redeemer : BeaconRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    // C-MINT-0: validator beacon không liên quan mint
    expect assets.is_zero(tx.mint)

    // single-input + single-output theo SCRIPT HASH (chống double-satisfaction
    // qua stake credential — audit C1).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

    // C-BCN-1: committee 2/3 đồng thuận
    expect util.committee_approved(committee, threshold, tx.extra_signatories)

    let beacon_in = util.input_at_script(tx.inputs, own_hash)
    let beacon_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(d) = beacon_out.datum
    expect out_datum: BeaconDatum = d

    // C-BCN-2: epoch đơn điệu TĂNG; kind bảo toàn.
    expect out_datum.epoch > datum.epoch
    expect out_datum.kind == datum.kind

    // ── C-BCN-3 (2026-09-16, vá Issue #72 lỗ 2): NHÃN PHẢI LÀ CỬA SỔ HIỆN TẠI ────────
    // Trước bản vá, C-BCN-2 đứng MỘT MÌNH và nó chỉ ép "lớn hơn lần trước" — không ép
    // dính vào thời gian thật. Hệ quả đo được trên Preprod ngày 2026-09-16: beacon mang
    // nhãn 4144 trong khi cửa sổ đang chạy là 4142, vì lượt post thứ hai trong cùng một
    // cửa sổ BUỘC phải mang nhãn của cửa sổ kế để thoả C-BCN-2. Trường tên `epoch` khi
    // ấy không nói về epoch nào cả — nó chỉ là một bộ đếm lượt post.
    //
    // Chỗ hỏng không phải "thiếu một cổng" mà là "một trường nói sai về chính nó", nên
    // vá bằng cách ép cái tên thành đúng: `epoch` = cửa sổ mà giá trị này ĐƯỢC POST.
    // `find_drop_value` bên `claim_account.ak` vẫn cố ý bỏ qua trường này (D có hiệu lực
    // ngay khi post) — nhưng nay ai đọc nhãn cũng đọc được đúng một điều có thật.
    //
    // Đo bằng `get_epoch_strict` chứ KHÔNG phải `get_epoch`: đầu dưới đặt lùi bao xa cũng
    // hợp lệ với sổ cái, nên `get_epoch` một mình cho phép dán nhãn quá khứ. Xem lý lẽ
    // đầy đủ ở `util.ak`, hàm `get_epoch_strict` ("Luật 2b").
    let window = util.get_epoch_strict(tx, ms_per_epoch)
    expect out_datum.epoch == window

    // C-BCN-2 + C-BCN-3 đi CẶP, và cặp ấy mới là thứ có giá trị: mỗi cửa sổ post được
    // TỐI ĐA MỘT lượt (lượt thứ hai cùng cửa sổ có `epoch` bằng lượt trước ⇒ đứt C-BCN-2;
    // muốn thoả C-BCN-2 thì phải mang nhãn cửa sổ sau ⇒ đứt C-BCN-3). Đó là điều kiện
    // để trần ±10% ở C-BCN-5 dưới đây là một trần THẬT thay vì một gợi ý.

    // ── C-BCN-4 (2026-09-16, vá Issue #72 lỗ 3): D NẰM TRONG BIÊN CỨNG ──────────────
    // Không có dòng này, `drop_value` do committee đặt là số nguyên bất kỳ > 0, mà D
    // nhân thẳng vào công thức vested của MỌI tài khoản đang mở:
    //   vested = min(E, D · drops_per_epoch · elapsed)
    // ⇒ đặt D đủ lớn là mọi tài khoản vested trọn `entitlement` trong đúng một cửa sổ,
    // tức lịch vesting không ràng buộc được chính bên phát hành. Trần dưới thì chặn
    // chiều ngược lại: hạ D về ~0 là đóng băng vesting của người đang chờ.
    expect out_datum.drop_value >= constants.drop_value_min
    expect out_datum.drop_value <= constants.drop_value_max

    // ── C-BCN-5: MỘT LƯỢT ĐỔI KHÔNG QUÁ ±10% ────────────────────────────────────────
    // Biên cứng ở trên chặn điểm đến; dòng này chặn TỐC ĐỘ. Một tài khoản đang vesting dở
    // do đó không gặp vách: D trôi chậm, và người giữ tài khoản có ít nhất một cửa sổ để
    // phản ứng. |D_mới − D_cũ| · q ≤ D_cũ · max_drop_delta_q.
    //
    // Nhân chéo thay vì chia — số nguyên chia làm tròn xuống, nên bản chia cho lọt một
    // dải sát biên và dải đó không tự khai là đã lọt.
    let delta = math.abs_diff(out_datum.drop_value, datum.drop_value)
    expect delta * constants.q <= datum.drop_value * constants.max_drop_delta_q

    // authenticity NFT bảo toàn (đúng 1 token, không bị rút)
    let nft_name = util.beacon_name(datum.kind)
    let nft_in = assets.quantity_of(beacon_in.value, beacon_nft_policy, nft_name)
    let nft_out = assets.quantity_of(beacon_out.value, beacon_nft_policy, nft_name)
    expect nft_in == 1
    expect nft_out == 1

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const bt_sh: ByteArray = #"b0b0b0b0"

const bt_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const bt_threshold: Int = 2

const bt_nft_policy: ByteArray = #"beac"

const bt_mspe: Int = 432_000_000

/// D vào = 100 LAMP (giá trị beacon mở sổ). Trong [min, max], nên nó là mốc hợp lệ để
/// đo các ca biên quanh nó.
const bt_d_in: Int = 100_000_000

fn bt_datum(epoch: Int, kind: BeaconKind, d: Int) -> BeaconDatum {
  BeaconDatum { epoch: epoch, kind: kind, drop_value: d }
}

/// tx post beacon, validity range NẰM GỌN trong cửa sổ `window` (thoả Luật 2b).
fn beacon_tx(
  in_epoch  : Int,
  out_epoch : Int,
  sigs      : List<ByteArray>,
  out_d     : Int,
  window    : Int,
) -> Transaction {
  beacon_tx_range(
    in_epoch, out_epoch, sigs, out_d,
    interval.between(window * bt_mspe, window * bt_mspe + 1000),
  )
}

fn beacon_tx_range(
  in_epoch  : Int,
  out_epoch : Int,
  sigs      : List<ByteArray>,
  out_d     : Int,
  vr        : interval.Interval,
) -> Transaction {
  let addr = util.script_address(bt_sh)
  let nft_val =
    assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, util.beacon_name(DropParam), 1)
  let b_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(addr, nft_val, bt_datum(in_epoch, DropParam, bt_d_in)),
    )
  let b_out = util.mk_output(addr, nft_val, bt_datum(out_epoch, DropParam, out_d))
  Transaction {
    ..placeholder,
    inputs: [b_in],
    outputs: [b_out],
    extra_signatories: sigs,
    mint: assets.zero,
    validity_range: vr,
  }
}

fn bt_run(in_epoch: Int, tx: Transaction) -> Bool {
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, bt_mspe,
    Some(bt_datum(in_epoch, DropParam, bt_d_in)), PostBeacon, util.mk_ref(0), tx,
  )
}

test beacon_happy() {
  // post ở cửa sổ 6, nhãn 6, D 100 → 110 LAMP (đúng +10%)
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 110_000_000, 6))
}

test beacon_epoch_not_increasing() fail {
  // out.epoch == in.epoch → đứt C-BCN-2
  bt_run(5, beacon_tx(5, 5, [#"c1", #"c2"], 110_000_000, 5))
}

test beacon_insufficient_committee() fail {
  bt_run(5, beacon_tx(5, 6, [#"c1"], 110_000_000, 6))
}

// ── C-BCN-3: nhãn phải là cửa sổ HIỆN TẠI ────────────────────────────────────
// Ca này là ca đã XẢY RA THẬT trên Preprod: lượt post thứ hai trong cùng một cửa sổ
// buộc phải mang nhãn cửa sổ kế để thoả C-BCN-2, nên beacon mang nhãn 4144 trong khi
// cửa sổ đang chạy là 4142. Trước bản vá, tx này HỢP LỆ.
test beacon_label_ahead_of_window_rejected() fail {
  bt_run(5, beacon_tx(5, 7, [#"c1", #"c2"], 110_000_000, 6))
}

test beacon_label_behind_window_rejected() fail {
  // dán nhãn cửa sổ cũ trong khi đang ở cửa sổ 7
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 110_000_000, 7))
}

/// C-BCN-2 + C-BCN-3 đi cặp ⇒ MỖI CỬA SỔ TỐI ĐA MỘT LƯỢT POST. Ca này là lượt thứ hai
/// trong cửa sổ 6 (beacon đã mang nhãn 6): muốn thoả C-BCN-2 phải ghi nhãn 7, mà cửa sổ
/// thật vẫn là 6 ⇒ đứt C-BCN-3. Đây là mệnh đề khiến trần ±10% ở C-BCN-5 là trần thật.
test beacon_second_post_same_window_rejected() fail {
  bt_run(6, beacon_tx(6, 7, [#"c1", #"c2"], 110_000_000, 6))
}

/// Luật 2b: validity range KHÔNG có đầu trên ⇒ tx không tự khai nổi cửa sổ của nó.
/// Fail-closed. Đây cũng là ca chứng minh `get_epoch` cũ (chỉ đọc đầu dưới) KHÔNG
/// thay được `get_epoch_strict` ở đây — `interval.after` là đúng thứ `get_epoch` nhận.
test beacon_unbounded_range_rejected() fail {
  bt_run(5, beacon_tx_range(5, 6, [#"c1", #"c2"], 110_000_000, interval.after(6 * bt_mspe)))
}

/// Cửa sổ vắt qua biên epoch ⇒ hai đầu rơi hai cửa sổ ⇒ từ chối. Bên dựng tx phải kéo
/// đầu trên về sát cuối cửa sổ (khuôn `drawWindow` bên Genesis).
test beacon_range_straddles_boundary_rejected() fail {
  bt_run(
    5,
    beacon_tx_range(
      5, 6, [#"c1", #"c2"], 110_000_000,
      interval.between(6 * bt_mspe - 1000, 6 * bt_mspe + 1000),
    ),
  )
}

// ── C-BCN-4: biên cứng của D ─────────────────────────────────────────────────

test beacon_drop_below_floor_rejected() fail {
  // D dưới sàn 10 LAMP. Ca "đóng băng vesting của người đang chờ".
  // ⚠ Ca này ĐỎ ở C-BCN-5 trước khi tới C-BCN-4 (−99% vượt xa ±10%), nên một mình nó
  // KHÔNG ghim được cái sàn — xem `beacon_floor_is_the_binding_clause` ngay dưới.
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 1_000_000, 6))
}

/// Ca PHÂN BIỆT HAI CHỐT ở chiều SÀN. D vào đặt sát ngay trên sàn (10,5 LAMP), D ra là
/// −10% chẵn = 9,45 LAMP: thoả C-BCN-5 nhưng thủng C-BCN-4 ⇒ đỏ thì đỏ vì đúng cái sàn.
///
/// Ca này được viết SAU khi phép đo đảo báo rằng gỡ hẳn mệnh đề sàn đi thì cả 122 bài
/// vẫn xanh. Bốn ca "sàn" có sẵn lúc ấy đều chết ở C-BCN-5 trước, tức chúng đỏ đúng
/// dòng mang tên mình mà không ghim dòng đó.
test beacon_floor_is_the_binding_clause() fail {
  let d_in = 10_500_000
  let vr = interval.between(6 * bt_mspe, 6 * bt_mspe + 1000)
  let addr = util.script_address(bt_sh)
  let nft_val =
    assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, util.beacon_name(DropParam), 1)
  let b_in =
    util.mk_input(util.mk_ref(0), util.mk_output(addr, nft_val, bt_datum(5, DropParam, d_in)))
  let b_out = util.mk_output(addr, nft_val, bt_datum(6, DropParam, 9_450_000))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [b_in],
      outputs: [b_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
      validity_range: vr,
    }
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, bt_mspe,
    Some(bt_datum(5, DropParam, d_in)), PostBeacon, util.mk_ref(0), tx,
  )
}

/// Ca PHÂN BIỆT cho ĐẦU TRÊN của Luật 2b (`util.get_epoch_strict`).
///
/// `beacon_range_straddles_boundary_rejected` ở trên KHÔNG ghim được đầu trên: bỏ mệnh
/// đề `hi / ms_per_epoch == e` đi thì nó vẫn đỏ, chỉ là đỏ ở C-BCN-3 thay vì ở Luật 2b —
/// bài trượt xuống chốt kế tiếp và chết ở đó, người đọc thấy đúng màu đúng tên.
///
/// Ca này bẻ đúng chỗ đó: đầu dưới rơi cửa sổ 6, đầu trên rơi cửa sổ 7, và nhãn ghi 6 —
/// tức KHỚP với `get_epoch(lower)`. Còn mệnh đề đầu trên thì từ chối; gỡ nó ra thì tx
/// này ĐƯỢC CHẤP NHẬN, và đó đúng là đường dán nhãn quá khứ mà lỗ 2 nói tới.
test beacon_upper_bound_is_the_binding_clause() fail {
  bt_run(
    5,
    beacon_tx_range(
      5, 6, [#"c1", #"c2"], 110_000_000,
      interval.between(6 * bt_mspe, 7 * bt_mspe),
    ),
  )
}

/// D vượt trần 10.000 LAMP. Ca NẶNG NHẤT trong Issue #72: không có trần thì committee
/// đặt D đủ lớn là mọi tài khoản vested trọn entitlement trong đúng một cửa sổ.
///
/// ⚠ Ca này ĐỎ ở C-BCN-5 trước khi tới C-BCN-4 (nhảy từ 100 lên 20.000 LAMP vượt xa
/// ±10%), nên MỘT MÌNH nó KHÔNG chứng minh C-BCN-4 được ghim — xem
/// `beacon_ceiling_is_the_binding_clause` ngay dưới, ca đó mới phân biệt được hai chốt.
test beacon_drop_above_ceiling_rejected() fail {
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 20_000_000_000, 6))
}

/// Ca PHÂN BIỆT HAI CHỐT: D vào đặt sát trần (10.000 LAMP), D ra +10% = 11.000 LAMP.
/// Thoả C-BCN-5 (đúng biên delta) nhưng vượt C-BCN-4 ⇒ nếu đỏ thì đỏ vì đúng cái trần.
/// Không có ca này thì gỡ C-BCN-4 đi bộ kiểm vẫn xanh, và nhãn "đã ghim trần" là nhãn
/// mượn của hàng xóm.
test beacon_ceiling_is_the_binding_clause() fail {
  let vr = interval.between(6 * bt_mspe, 6 * bt_mspe + 1000)
  let addr = util.script_address(bt_sh)
  let nft_val =
    assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, util.beacon_name(DropParam), 1)
  let d_in = constants.drop_value_max
  let b_in =
    util.mk_input(util.mk_ref(0), util.mk_output(addr, nft_val, bt_datum(5, DropParam, d_in)))
  let b_out = util.mk_output(addr, nft_val, bt_datum(6, DropParam, 11_000_000_000))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [b_in],
      outputs: [b_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
      validity_range: vr,
    }
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, bt_mspe,
    Some(bt_datum(5, DropParam, d_in)), PostBeacon, util.mk_ref(0), tx,
  )
}

// ── C-BCN-5: một lượt đổi không quá ±10% ─────────────────────────────────────

test beacon_delta_exactly_at_limit_ok() {
  // +10% chẵn — biên ĐƯỢC PHÉP (mệnh đề là ≤, không phải <)
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 110_000_000, 6))
}

test beacon_delta_down_exactly_at_limit_ok() {
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 90_000_000, 6))
}

test beacon_delta_one_oildrop_over_limit_rejected() fail {
  // +10% + 1 oildrop. Ca sát biên: bản chia số nguyên cho lọt dải này, bản nhân chéo thì không.
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 110_000_001, 6))
}

test beacon_delta_down_over_limit_rejected() fail {
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], 89_999_999, 6))
}

/// Chiều GIẢM phải bị chặn riêng, không suy ra được từ chiều tăng: một bản chỉ ép
/// `out ≤ in · 1,1` xanh trọn các ca tăng ở trên mà vẫn cho hạ D về sàn trong một lượt.
test beacon_drop_to_floor_in_one_post_rejected() fail {
  bt_run(5, beacon_tx(5, 6, [#"c1", #"c2"], constants.drop_value_min, 6))
}
