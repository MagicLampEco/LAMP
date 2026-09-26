// Beacon validator (CONTRACT v3 "Capped Drop", C-BCN-*).
// Committee post CHỈ SỐ CỘNG DỒN `A` + gốc tốc độ `rate_root` mỗi cửa sổ. Authenticity = NFT.
//
// v3 đổi NỘI DUNG datum, không đổi khung: `drop_value` (một tốc độ tuyệt đối, đọc SỐNG ở
// mỗi lần rút) được thay bằng cặp `index` + `rate_root`, trong đó `index` đã CHỐT giá trị
// của mọi cửa sổ đã qua. Nhờ thế một lượt post mới không viết lại được quá khứ, và chiều
// giảm của tham số tốc độ bị đóng hẳn (C-BCN-5'). Xem CONTRACT v3 §0 cho lỗ mà nó diệt.
// Genesis beacon (epoch đầu) được tạo bằng cách pay-to-address + NFT lúc deploy
// (không qua validator). Mọi update sau spend + re-create với epoch tăng.

use aiken/interval
use cardano/address.{Address}
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction, placeholder}
use magiclamp/lampdist/constants
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
  //
  // ⚠ PHẠM VI ĐÚC LẠI — bản trước của chú thích này ghi "thêm tham số ở đây chỉ đổi ĐỊA
  // CHỈ beacon", và câu đó đúng về HASH nhưng sai về VIỆC PHẢI LÀM. Địa chỉ beacon đổi
  // kéo theo cả cụm, vì DROP NFT ghim beacon nằm Ở ĐỊA CHỈ CŨ và nó không đi đâu được:
  // muốn dời nó phải tiêu UTxO cũ, mà tiêu UTxO cũ thì phải qua chính validator cũ —
  // validator ấy không có nhánh nào cho phép NFT rời script (`expect nft_out == 1` ngay
  // dưới), và `beacon_nft` là one-shot nên cũng không đốt được. Beacon mới do đó cần một
  // DROP NFT MỚI ⇒ `beacon_nft` đúc lại ⇒ `beacon_nft_policy` đổi ⇒ `claim_account` và
  // `treasury` (cùng nhận policy đó làm tham số) đổi hash theo.
  //
  // Bộ phải đúc lại là {`beacon_nft`, `beacon`, `claim_account`, `treasury`} — bốn, không
  // phải một. Đây là chi phí thật của mỗi lần thêm tham số vào tệp này, và nó không hiện
  // ra ở phép so hash.
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

    // ── C-BCN-5b (v3): `rate_root` NẰM TRONG BIÊN CỨNG ──────────────────────────────
    // Thay C-BCN-4 của v2 (biên của `drop_value`). Trần chặn điểm đến của kênh tốc độ:
    // không có nó, committee nới `rate_root` dần dần (mỗi lượt +10%, mỗi cửa sổ một lượt)
    // tới bất kỳ giá trị nào, và một pot mở khoá trọn trong một cửa sổ.
    //
    // SÀN thì BỊ BAO TRÙM trên một chuỗi hợp lệ — nói ra thay vì để người đọc suy: C-BCN-5'
    // ngay dưới ép `rate_root` chỉ tăng, và genesis đặt trên sàn, nên quy nạp cho mọi lượt
    // post đều trên sàn. Giao dịch DUY NHẤT phân biệt được nó là giao dịch tiêu một beacon
    // đã nằm DƯỚI sàn — trạng thái chỉ đến được từ một genesis dựng sai. Giữ vì nó là chân
    // thứ nhất của Định lý 1 (`w > 0` ⇒ A không giảm) và vì nó rẻ.
    expect out_datum.rate_root >= constants.rate_root_min
    expect out_datum.rate_root <= constants.rate_root_max

    // ── C-BCN-5' (v3): `rate_root` CHỈ ĐƯỢC NỚI — MỘT CHIỀU ─────────────────────────
    // Đây là chốt thay `abs_diff` của v2, và nó là lý do v3 tồn tại. `abs_diff` ĐỐI XỨNG:
    // nó chặn TỐC ĐỘ đổi mà không chặn CHIỀU, nên committee hạ được 10% mỗi lượt post. Với
    // công thức v2 (`vested = D · dpe · elapsed`, thừa số NGOÀI tổng tích luỹ) một lượt
    // −10% kéo `vested` xuống dưới `redeemed` đã lưu của mọi tài khoản đã chạy ≥ 9 cửa sổ
    // (`0,9(t+1) > t ⟺ t < 9`) ⇒ `expect amount > 0` khoá tài khoản VĨNH VIỄN. Không bất
    // biến nào vỡ và không bài kiểm nào đỏ — `redeemed ≤ vested ≤ E` vẫn đúng suốt.
    //
    // Committee KHÔNG mất quyền điều tiết: nó chuyển sang kênh CẮT NGỌN (`trim_num`), và
    // kênh đó an toàn theo cấu trúc vì cắt ngọn chỉ HOÃN một lượt rút, không bao giờ hạ
    // `vested`. Phân biệt trung tâm của v3: thứ chạm TỐC ĐỘ TÍCH LUỸ thì chỉ được nới, thứ
    // chạm MỘT LƯỢT RÚT thì siết thoải mái.
    expect out_datum.rate_root >= datum.rate_root

    // ── C-BCN-5a: MỘT LƯỢT NỚI KHÔNG QUÁ +10% ───────────────────────────────────────
    // Biên cứng ở trên chặn điểm đến; dòng này chặn TỐC ĐỘ đi tới đó.
    // (w_mới − w_cũ) · q ≤ w_cũ · max_rate_root_delta_q. Hiệu KHÔNG âm nhờ C-BCN-5'.
    //
    // Nhân chéo thay vì chia — số nguyên chia làm tròn xuống, nên bản chia cho lọt một
    // dải sát biên và dải đó không tự khai là đã lọt.
    expect
      ( out_datum.rate_root - datum.rate_root ) * constants.q <= datum.rate_root * constants.max_rate_root_delta_q

    // ── C-BCN-6 (v3): CHỈ SỐ CỘNG DỒN — QUÁ KHỨ ĐỊNH GIÁ BẰNG `rate_root` CŨ ─────────
    //   index_out == index_in + rate_root_IN · (epoch_out − epoch_in)
    // Thừa số là `datum.rate_root`, KHÔNG phải `out_datum.rate_root`. Đó là toàn bộ nội
    // dung của chốt: `rate_root` mới chỉ có hiệu lực TỪ `epoch_out` trở đi, nên một lượt
    // post không với ngược lại được vào bất kỳ điểm nào của quá khứ. Viết dưới dạng đóng
    // như vậy cũng là lý do KHÔNG cần lưu `A` dạng vector `[rate₀, rate₁, …]` — vector sẽ
    // phình tuyến tính theo tuổi tài khoản và một tài khoản 1000 cửa sổ chết vì datum quá
    // cỡ. `Math-Spec.md` v3 §2 (1) + HQ 1.2.
    expect
      out_datum.index == datum.index + datum.rate_root * ( out_datum.epoch - datum.epoch )

    // ── ⚠ MỆNH ĐỀ NÀY KHÔNG CÓ TRONG ĐẶC TẢ ĐƯỢC GIAO — thêm vì tìm được đường phá ────
    // `trim_den` là MẪU SỐ của phép cắt ngọn ở `claim_account` ▸ Redeem
    // (`total_redeemed · trim_num / trim_den`). Chia cho 0 trong Plutus là LỖI, không phải
    // một giá trị — nên một lượt post đặt `trim_den = 0` làm MỌI giao dịch `Redeem` của
    // toàn hệ đổ vỡ, vĩnh viễn và không ai kêu (beacon vẫn hợp lệ, sổ vẫn đúng, chỉ là
    // không tx rút nào dựng được nữa). Đó là đúng cái quyền đóng băng mà CONTRACT §9 nói
    // committee KHÔNG còn: "trim_num siết được nhưng chỉ chạm lượt rút tương lai".
    expect out_datum.trim_den > 0

    // ── C-BCN-TRIM-NUM (2026-09-26): TỬ SỐ CẮT NGỌN PHẢI DƯƠNG ───────────────────────
    // ⚠ Bản trước của chú thích trên viết: "`trim_num` thì không cần gác — số âm làm tích
    // âm, và `max(trim_floor, ·)` nuốt nó." Câu đó ĐÚNG về số ÂM và MÙ với số 0, mà số 0 là
    // giá trị duy nhất trong miền có người muốn đặt.
    //
    // `trim_num = 0` ⇒ `total_redeemed · 0 / trim_den == 0` ⇒ trần một lượt rút bằng
    // `max(trim_floor, 0) == trim_floor` MÃI MÃI, bất kể lưu hành lớn tới đâu. Một pot 6 tỷ
    // LAMP khi ấy phải rút 6 triệu lượt ở 1.000 LAMP/lượt, và `find_treasury_in` giới hạn
    // toàn hệ MỘT `Redeem` mỗi block (CONTRACT §4 nút cổ chai) ⇒ nhiều thập kỷ. Đó đúng là
    // quyền làm chậm tài sản người khác mà CONTRACT §9 nói committee KHÔNG còn: bảng quyền
    // ghi "`trim_num` siết được nhưng chỉ chạm lượt rút tương lai", và chữ "siết" không bao
    // hàm "tắt hẳn". Không bất biến nào vỡ — nó không phá tính ĐÚNG, nó phá THÔNG LƯỢNG.
    //
    // Số ÂM thì vẫn đúng như câu cũ nói, nhưng chốt này bao luôn nó, và bao là đúng: một
    // tham số mà miền hợp lệ là `> 0` thì nên nói ra `> 0`, đừng để ba bước suy luận
    // (`max`, dấu, làm tròn về 0 của phép chia số nguyên) gánh hộ.
    expect out_datum.trim_num > 0

    // ── C-BCN-HOME (2026-09-26): BEACON KHÔNG ĐỔI NHÀ ───────────────────────────────
    // `count_outputs_at_script` + `output_at_script` ở trên chỉ ép PAYMENT credential; hai
    // địa chỉ cùng script hash mà khác stake credential là HAI địa chỉ (đúng dữ kiện mà
    // audit C1 dựng ra: xem `util.ak` ▸ `script_count_catches_stake_cred_double`). Nên
    // trước dòng này một lượt post dời được beacon sang stake credential của người dựng tx,
    // và toàn bộ phần thưởng uỷ quyền của min-ADA beacon đi theo — vĩnh viễn, vì C-BCN-1
    // không bao giờ đòi ai trả lại. Đối xứng với C-SOLV-5 của TRSY ("ra đúng địa chỉ đã
    // vào"); ở đây rẻ hơn hẳn vì cả hai đầu đã nằm trong tay.
    expect beacon_out.address == beacon_in.address

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

/// `rate_root` vào = 100.000. KHÔNG phải giá trị hiệu chỉnh 77.460 — cố ý chọn một số
/// tròn nằm THUẦN BÊN TRONG [min, max] để mọi ca biên quanh nó tính nhẩm được, và để ca
/// biên của C-BCN-5b phải tự dựng `rate_root` vào của riêng nó (nếu không nó mượn biên
/// của hàng xóm).
const bt_w_in: Int = 100_000

/// `index` vào. Khác 0 có chủ đích: với `index = 0` thì mệnh đề C-BCN-6
/// (`index_out == index_in + …`) vẫn đúng khi ai đó bỏ số hạng `index_in`, nên ca kiểm
/// không phân biệt được hai cực đột biến.
const bt_index_in: Int = 7_000

const bt_trim_num: Int = 1

const bt_trim_den: Int = 1000

fn bt_datum(epoch: Int, kind: BeaconKind, index: Int, w: Int) -> BeaconDatum {
  BeaconDatum {
    epoch: epoch,
    kind: kind,
    index: index,
    rate_root: w,
    trim_num: bt_trim_num,
    trim_den: bt_trim_den,
    speed_policies: [],
  }
}

/// `index` mà C-BCN-6 đòi khi post ở `out_epoch` từ mốc `in_epoch` với `rate_root` CŨ.
fn bt_index_ok(in_epoch: Int, out_epoch: Int, in_index: Int, in_w: Int) -> Int {
  in_index + in_w * ( out_epoch - in_epoch )
}

/// tx post beacon, validity range NẰM GỌN trong cửa sổ `window` (thoả Luật 2b).
/// `out_index` để lộ ra ngoài vì C-BCN-6 là một ĐẲNG THỨC — ca kiểm phải bẻ được nó.
fn beacon_tx(
  in_epoch  : Int,
  out_epoch : Int,
  sigs      : List<ByteArray>,
  out_w     : Int,
  out_index : Int,
  window    : Int,
) -> Transaction {
  beacon_tx_full(
    in_epoch, out_epoch, sigs, bt_w_in, out_w, out_index, bt_trim_den,
    interval.between(window * bt_mspe, window * bt_mspe + 1000),
  )
}

/// Biến thể dựng `index` ra ĐÚNG theo C-BCN-6 — khuôn của mọi ca không nhắm vào C-BCN-6.
fn beacon_tx_ok_index(
  in_epoch  : Int,
  out_epoch : Int,
  sigs      : List<ByteArray>,
  out_w     : Int,
  window    : Int,
) -> Transaction {
  beacon_tx(
    in_epoch, out_epoch, sigs, out_w,
    bt_index_ok(in_epoch, out_epoch, bt_index_in, bt_w_in), window,
  )
}

fn beacon_tx_full(
  in_epoch  : Int,
  out_epoch : Int,
  sigs      : List<ByteArray>,
  in_w      : Int,
  out_w     : Int,
  out_index : Int,
  out_trim_den : Int,
  vr        : interval.Interval,
) -> Transaction {
  beacon_tx_raw(
    in_epoch, out_epoch, sigs, in_w, out_w, out_index, bt_trim_num, out_trim_den,
    util.script_address(bt_sh), vr,
  )
}

/// Khuôn TRỌN VẸN — để lộ thêm `out_trim_num` (C-BCN-TRIM-NUM) và ĐỊA CHỈ ra của beacon
/// (C-BCN-HOME). Hai trường này phải lộ ra chứ không gói lại: cả hai đều là thứ người dựng
/// tx đặt được, nên một khuôn cố định chúng là một khuôn không bẻ được mệnh đề nào.
fn beacon_tx_raw(
  in_epoch     : Int,
  out_epoch    : Int,
  sigs         : List<ByteArray>,
  in_w         : Int,
  out_w        : Int,
  out_index    : Int,
  out_trim_num : Int,
  out_trim_den : Int,
  out_addr     : Address,
  vr           : interval.Interval,
) -> Transaction {
  let addr = util.script_address(bt_sh)
  let nft_val =
    assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, util.beacon_name(DropParam), 1)
  let b_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(addr, nft_val, bt_datum(in_epoch, DropParam, bt_index_in, in_w)),
    )
  let out_d =
    BeaconDatum {
      epoch: out_epoch,
      kind: DropParam,
      index: out_index,
      rate_root: out_w,
      trim_num: out_trim_num,
      trim_den: out_trim_den,
      speed_policies: [],
    }
  let b_out = util.mk_output(out_addr, nft_val, out_d)
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
  bt_run_w(in_epoch, bt_w_in, bt_index_in, tx)
}

fn bt_run_w(in_epoch: Int, in_w: Int, in_index: Int, tx: Transaction) -> Bool {
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, bt_mspe,
    Some(bt_datum(in_epoch, DropParam, in_index, in_w)), PostBeacon, util.mk_ref(0), tx,
  )
}

test beacon_happy() {
  // post ở cửa sổ 6, nhãn 6, w 100.000 → 105.000 (+5%: một điểm THUẦN BÊN TRONG mọi biên).
  // `index` ra = 7000 + 100.000 · (6 − 5) = 107.000 — định giá bằng `rate_root` CŨ.
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], 105_000, 6))
}

test beacon_epoch_not_increasing() fail {
  // out.epoch == in.epoch → đứt C-BCN-2
  bt_run(5, beacon_tx_ok_index(5, 5, [#"c1", #"c2"], 105_000, 5))
}

test beacon_insufficient_committee() fail {
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1"], 105_000, 6))
}

// ── C-BCN-3: nhãn phải là cửa sổ HIỆN TẠI ────────────────────────────────────
// Ca này là ca đã XẢY RA THẬT trên Preprod: lượt post thứ hai trong cùng một cửa sổ
// buộc phải mang nhãn cửa sổ kế để thoả C-BCN-2, nên beacon mang nhãn 4144 trong khi
// cửa sổ đang chạy là 4142. Trước bản vá, tx này HỢP LỆ.
test beacon_label_ahead_of_window_rejected() fail {
  bt_run(5, beacon_tx_ok_index(5, 7, [#"c1", #"c2"], 105_000, 6))
}

test beacon_label_behind_window_rejected() fail {
  // dán nhãn cửa sổ cũ trong khi đang ở cửa sổ 7
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], 105_000, 7))
}

/// C-BCN-2 + C-BCN-3 đi cặp ⇒ MỖI CỬA SỔ TỐI ĐA MỘT LƯỢT POST. Ca này là lượt thứ hai
/// trong cửa sổ 6 (beacon đã mang nhãn 6): muốn thoả C-BCN-2 phải ghi nhãn 7, mà cửa sổ
/// thật vẫn là 6 ⇒ đứt C-BCN-3. Đây là mệnh đề khiến trần +10% ở C-BCN-5a là trần thật.
test beacon_second_post_same_window_rejected() fail {
  bt_run(6, beacon_tx_ok_index(6, 7, [#"c1", #"c2"], 105_000, 6))
}

/// Luật 2b: validity range KHÔNG có đầu trên ⇒ tx không tự khai nổi cửa sổ của nó.
/// Fail-closed. Đây cũng là ca chứng minh `get_epoch` cũ (chỉ đọc đầu dưới) KHÔNG
/// thay được `get_epoch_strict` ở đây — `interval.after` là đúng thứ `get_epoch` nhận.
test beacon_unbounded_range_rejected() fail {
  bt_run(
    5,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      bt_trim_den, interval.after(6 * bt_mspe),
    ),
  )
}

/// Cửa sổ vắt qua biên epoch ⇒ hai đầu rơi hai cửa sổ ⇒ từ chối. Bên dựng tx phải kéo
/// đầu trên về sát cuối cửa sổ (khuôn `drawWindow` bên Genesis).
test beacon_range_straddles_boundary_rejected() fail {
  bt_run(
    5,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      bt_trim_den, interval.between(6 * bt_mspe - 1000, 6 * bt_mspe + 1000),
    ),
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
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      bt_trim_den, interval.between(6 * bt_mspe, 7 * bt_mspe),
    ),
  )
}

// ── C-BCN-5' (v3): `rate_root` CHỈ ĐƯỢC NỚI ──────────────────────────────────
// LỖ ĐANG SỐNG ở bản v2 mà cặp ca dưới đây đóng lại. `math.abs_diff` đối xứng ⇒ bản cũ
// cho HẠ 10% mỗi lượt post, và một lượt −10% khoá mọi tài khoản đã chạy ≥ 9 cửa sổ.

/// Hạ `rate_root` 1% — THUẦN BÊN TRONG mọi biên khác: trên sàn cứng (99.000 > 7.746),
/// dưới trần cứng, và |Δ| = 1% < 10% nên trần tốc độ của v2 cho qua. Lý do đỏ DUY NHẤT
/// còn lại là chiều. Gỡ C-BCN-5' ra thì tx này ĐƯỢC CHẤP NHẬN.
test beacon_rate_root_lowered_rejected() fail {
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], 99_000, 6))
}

/// Ca ĐỐI XỨNG của bài trên, cùng độ lớn bước (1%), chỉ đổi DẤU: nâng thì qua.
/// Hai bài chỉ khác nhau ở một chữ số, nên chúng phân biệt được đúng chiều và không gì khác.
test beacon_rate_root_raised_ok() {
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], 101_000, 6))
}

/// Biên của C-BCN-5': GIỮ NGUYÊN được phép (mệnh đề là `≥`, không phải `>`).
test beacon_rate_root_unchanged_ok() {
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], bt_w_in, 6))
}

/// Hạ MỘT ĐƠN VỊ. Ca sát biên nhất của chiều — nếu ai đó viết nhầm thành `>=` trên hiệu
/// đã lấy trị tuyệt đối, hoặc bỏ dấu, thì đúng ca này lọt.
test beacon_rate_root_lowered_by_one_rejected() fail {
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], bt_w_in - 1, 6))
}

// ── C-BCN-5a: một lượt nới không quá +10% ────────────────────────────────────

test beacon_delta_exactly_at_limit_ok() {
  // +10% chẵn — biên ĐƯỢC PHÉP (mệnh đề là ≤, không phải <)
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], 110_000, 6))
}

test beacon_delta_one_over_limit_rejected() fail {
  // +10% + 1. Ca sát biên: bản chia số nguyên cho lọt dải này, bản nhân chéo thì không.
  bt_run(5, beacon_tx_ok_index(5, 6, [#"c1", #"c2"], 110_001, 6))
}

// ── C-BCN-5b: biên cứng của `rate_root` ──────────────────────────────────────

/// TRẦN là biên chịu lực. `rate_root` vào đặt ĐÚNG trần, ra = trần + 1: thoả C-BCN-5'
/// (nâng) và thoả C-BCN-5a (bước +0,000013% « 10%), nên lý do đỏ duy nhất là cái trần.
/// Gỡ hai dòng biên cứng ra thì tx này ĐƯỢC CHẤP NHẬN.
test beacon_ceiling_is_the_binding_clause() fail {
  let w_in = constants.rate_root_max
  bt_run_w(
    5, w_in, bt_index_in,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], w_in, w_in + 1, bt_index_ok(5, 6, bt_index_in, w_in),
      bt_trim_den, interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

/// Đối chứng PASS của bài trên: CÙNG `rate_root` vào ở đúng trần, ra GIỮ NGUYÊN ⇒ qua.
/// Nếu thiếu nó, bài trên có thể đỏ vì fixture `rate_root_max` hỏng chứ không vì cái trần.
test beacon_at_ceiling_staying_put_ok() {
  let w_in = constants.rate_root_max
  bt_run_w(
    5, w_in, bt_index_in,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], w_in, w_in, bt_index_ok(5, 6, bt_index_in, w_in),
      bt_trim_den, interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

/// SÀN. ⚠ Phạm vi của ca này, nói trước để không ai đọc quá: nó dựng một trạng thái
/// KHÔNG ĐẾN ĐƯỢC trên một chuỗi hợp lệ — `rate_root` vào nằm DƯỚI sàn. Trên chuỗi thật,
/// genesis đặt trên sàn và C-BCN-5' ép chỉ-tăng, nên quy nạp cho mọi beacon đều trên sàn.
/// Ca này chứng minh mệnh đề SÀN có hiệu lực, KHÔNG chứng minh nó cần thiết.
test beacon_floor_is_the_binding_clause() fail {
  let w_in = constants.rate_root_min - 2
  bt_run_w(
    5, w_in, bt_index_in,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], w_in, w_in + 1, bt_index_ok(5, 6, bt_index_in, w_in),
      bt_trim_den, interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

// ── C-BCN-6: chỉ số cộng dồn, quá khứ định giá bằng `rate_root` CŨ ───────────

/// Post CÁCH 5 CỬA SỔ với `rate_root` ra KHÁC hẳn vào: `index` phải cộng đúng `w_CŨ × 5`.
/// Đầu vào phân biệt hai cực: nếu mã nhân nhầm `w_mới` thì con số là 7000 + 110.000·5 =
/// 557.000, lệch 50.000 so với 507.000 — không phải một sai số làm tròn nào che được.
test beacon_index_accrues_at_old_rate_over_five_windows_ok() {
  bt_run(
    5,
    beacon_tx(5, 10, [#"c1", #"c2"], 110_000, 7_000 + 100_000 * 5, 10),
  )
}

/// Cùng tx, `index` tính bằng `rate_root` MỚI ⇒ quá khứ bị định giá lại ⇒ TỪ CHỐI.
/// Đây là hình dạng của chính cái lỗ mà v3 diệt, chỉ khác dấu: ở đây nó ăn về phía người rút.
test beacon_index_accrued_at_new_rate_rejected() fail {
  bt_run(
    5,
    beacon_tx(5, 10, [#"c1", #"c2"], 110_000, 7_000 + 110_000 * 5, 10),
  )
}

/// `index` đứng yên trong khi 5 cửa sổ đã trôi ⇒ committee xoá 5 cửa sổ vesting của MỌI
/// tài khoản mà không đụng `rate_root`. Đây là đường đóng băng thứ hai, và C-BCN-6 là
/// mệnh đề DUY NHẤT chặn nó.
test beacon_index_frozen_rejected() fail {
  bt_run(5, beacon_tx(5, 10, [#"c1", #"c2"], 110_000, 7_000, 10))
}

/// `index` cộng THỪA một đơn vị. Ca sát biên phía trên — C-BCN-6 là ĐẲNG THỨC, không phải
/// bất đẳng thức, nên chiều thừa cũng phải đỏ (nó là tiền in thêm cho mọi tài khoản).
test beacon_index_over_accrued_by_one_rejected() fail {
  bt_run(
    5,
    beacon_tx(5, 10, [#"c1", #"c2"], 110_000, 7_000 + 100_000 * 5 + 1, 10),
  )
}

// ── Mẫu số cắt ngọn phải khác 0 (mệnh đề THÊM ngoài đặc tả) ──────────────────

/// `trim_den = 0` làm phép chia ở `claim_account` ▸ Redeem đổ vỡ ⇒ toàn hệ không dựng
/// được giao dịch rút nào nữa, vĩnh viễn, mà beacon vẫn "hợp lệ" theo mọi chốt khác.
test beacon_zero_trim_denominator_rejected() fail {
  bt_run(
    5,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      0, interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

/// Đối chứng: `trim_den = 1` (siết cắt ngọn tới mức chặt nhất còn hợp lệ) vẫn QUA.
/// Cặp này phân biệt "mẫu số bằng 0" với "mẫu số nhỏ" — không có nó, ca trên có thể đỏ
/// vì một chốt tưởng tượng nào đó về độ lớn của `trim_den`.
test beacon_trim_denominator_one_ok() {
  bt_run(
    5,
    beacon_tx_full(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      1, interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

// ── C-BCN-TRIM-NUM: TỬ SỐ cắt ngọn phải dương (mệnh đề THÊM 2026-09-26) ──────

/// `trim_num = 0`: beacon vẫn hợp lệ theo MỌI chốt cũ (epoch tăng, nhãn đúng cửa sổ, w nới
/// trong biên, index cộng đúng, mẫu số > 0, NFT bảo toàn) — và trần một lượt rút bị ghim
/// VĨNH VIỄN ở `trim_floor` cho mọi pot. Đây là ca phân biệt được bản có và bản không có
/// mệnh đề mới: trước nó tx này ĐƯỢC CHẤP NHẬN.
test beacon_zero_trim_numerator_rejected() fail {
  bt_run(
    5,
    beacon_tx_raw(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      0, bt_trim_den, util.script_address(bt_sh),
      interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

/// Tử số ÂM — chiều mà chú thích cũ nói "không cần gác". Nó đúng ở chỗ `max(trim_floor, ·)`
/// nuốt tích âm, nhưng bài này vẫn phải ĐỎ: mệnh đề mới là `> 0`, và một giá trị không có
/// nghĩa vận hành nào thì không nên hợp lệ chỉ vì có thứ khác dọn hộ.
test beacon_negative_trim_numerator_rejected() fail {
  bt_run(
    5,
    beacon_tx_raw(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      -1, bt_trim_den, util.script_address(bt_sh),
      interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

/// Đối chứng: `trim_num = 2` (nới cắt ngọn) vẫn QUA — hai bài trên đỏ vì cận dưới của miền,
/// không vì một chốt tưởng tượng nào ghim `trim_num == 1`.
test beacon_trim_numerator_two_ok() {
  bt_run(
    5,
    beacon_tx_raw(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      2, bt_trim_den, util.script_address(bt_sh),
      interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}

// ── C-BCN-HOME: beacon không đổi nhà (mệnh đề THÊM 2026-09-26) ───────────────

/// Beacon ra ĐÚNG script hash nhưng gắn thêm một stake credential. Đếm-theo-script-hash cũ
/// KHÔNG phân biệt được ca này (đó là cùng dữ kiện mà audit C1 dựng ra, chỉ dùng theo chiều
/// ngược), nên trước 2026-09-26 tx này ĐƯỢC CHẤP NHẬN và min-ADA beacon đổi chủ uỷ quyền.
test beacon_output_restaked_rejected() fail {
  bt_run(
    5,
    beacon_tx_raw(
      5, 6, [#"c1", #"c2"], bt_w_in, 105_000, bt_index_ok(5, 6, bt_index_in, bt_w_in),
      bt_trim_num, bt_trim_den, util.script_address_staked(bt_sh, #"5a5e"),
      interval.between(6 * bt_mspe, 6 * bt_mspe + 1000),
    ),
  )
}
