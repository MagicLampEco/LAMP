// pot_vault — két pot 8. MỘT validator đa mục đích: `mint` đúc NFT pot one-shot,
// `spend` chạy hai nhánh `Feed` (rót sang két swap) và `Absorb` (hút UTxO lạc).
//
// Policy của NFT pot = hash của CHÍNH script này, asset name = "" (rỗng), nên cặp
// (own_hash, "") là định danh không cần tham số nào khai thêm. Địa chỉ pot =
// `Script(own_hash)` không stake credential.
//
// Thân handler nằm ở `lib/magiclamp/potvault/handlers.ak` (kèm toàn bộ chốt
// F-* / A-* / M-* và danh sách bất biến). Xem đầu tệp đó trước khi sửa.

use aiken/interval.{Finite, Interval, IntervalBound, PositiveInfinity, between}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{
  Input, Output, OutputReference, ScriptPurpose, Spend, Transaction, placeholder,
}
use magiclamp/potvault/handlers
use magiclamp/potvault/types.{
  Absorb, Feed, MintPot, PotDatum, PotRedeemer, max_range_ms, pot_nft_name,
  reserve_nft_name,
}
use magiclamp/potvault/util

validator pot_vault(
  genesis_ref: OutputReference,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  ms_per_epoch: Int,
  window_cap: Int,
  total_cap: Int,
) {
  mint(redeemer: types.PotMintRedeemer, policy_id: PolicyId, tx: Transaction) {
    handlers.pot_mint(
      genesis_ref,
      lamp_policy,
      lamp_name,
      ms_per_epoch,
      window_cap,
      total_cap,
      redeemer,
      policy_id,
      tx,
    )
  }

  spend(
    datum: Option<Data>,
    redeemer: PotRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    handlers.pot_spend(
      lamp_policy,
      lamp_name,
      ms_per_epoch,
      window_cap,
      total_cap,
      datum,
      redeemer,
      own_ref,
      tx,
    )
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FIXTURE
// ══════════════════════════════════════════════════════════════════════════

/// Hash của chính script pot trong ca kiểm (28 byte).
const t_pot_hash: ByteArray =
  #"11111111111111111111111111111111111111111111111111111111"

/// Hash két swap (Feecover) — nằm trong datum, không phải tham số.
const t_reserve_hash: ByteArray =
  #"22222222222222222222222222222222222222222222222222222222"

/// Một script hash KHÁC — dùng cho ca "rót sang địa chỉ không phải két".
const t_other_hash: ByteArray =
  #"33333333333333333333333333333333333333333333333333333333"

const t_lamp_policy: PolicyId =
  #"44444444444444444444444444444444444444444444444444444444"

/// "LAMP"
const t_lamp_name: AssetName = #"4c414d50"

const t_alien_policy: PolicyId =
  #"55555555555555555555555555555555555555555555555555555555"

const t_alien_name: AssetName = #"beef"

/// Preprod: cửa sổ 5 ngày.
const t_ms_per_epoch: Int = 432_000_000

/// 1.000.000 LAMP (oildrop, decimals 6).
const t_window_cap: Int = 1_000_000_000_000

/// 7.000.000 LAMP — trần tích luỹ kênh (F8 = 1).
const t_total_cap: Int = 7_000_000_000_000

const t_now: Int = 4143

/// Lượng rót của ca dương: đúng bằng trần cửa sổ (ca dương ở biên).
const t_d: Int = t_window_cap

const t_pot_ada: Int = 2_000_000

const t_pot_lamp: Int = 5_000_000_000_000

fn t_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 5 }
}

fn t_pot_ref() -> OutputReference {
  util.mk_ref(1)
}

fn t_reserve_ref() -> OutputReference {
  util.mk_ref(2)
}

// ── Value ─────────────────────────────────────────────────────────

fn t_pot_value(lamp: Int, ada: Int) -> Value {
  assets.from_lovelace(ada)
    |> assets.add(t_pot_hash, pot_nft_name, 1)
    |> assets.add(t_lamp_policy, t_lamp_name, lamp)
}

fn t_reserve_value(lamp: Int, ada: Int) -> Value {
  assets.from_lovelace(ada)
    |> assets.add(t_reserve_hash, reserve_nft_name, 1)
    |> assets.add(t_lamp_policy, t_lamp_name, lamp)
}

fn t_lamp_value(lamp: Int, ada: Int) -> Value {
  assets.from_lovelace(ada) |> assets.add(t_lamp_policy, t_lamp_name, lamp)
}

fn t_mint_value(name: AssetName, qty: Int) -> Value {
  assets.zero |> assets.add(t_pot_hash, name, qty)
}

// ── Datum ─────────────────────────────────────────────────────────

fn t_pot_datum(drawn: Int, last: Int) -> PotDatum {
  PotDatum {
    reserve_hash: t_reserve_hash,
    drawn_total: drawn,
    last_window: last,
  }
}

fn t_some_datum(d: Data) -> Option<Data> {
  Some(d)
}

fn t_redeemers(r: Data) -> Pairs<ScriptPurpose, Data> {
  [Pair(Spend(t_pot_ref()), r)]
}

// ── UTxO ──────────────────────────────────────────────────────────

fn t_pot_input(d: PotDatum, lamp: Int, ada: Int) -> Input {
  util.mk_input(
    t_pot_ref(),
    util.mk_output(util.script_address(t_pot_hash), t_pot_value(lamp, ada), d),
  )
}

fn t_pot_output(d: PotDatum, lamp: Int, ada: Int) -> Output {
  util.mk_output(util.script_address(t_pot_hash), t_pot_value(lamp, ada), d)
}

fn t_reserve_input(lamp: Int) -> Input {
  util.mk_input(
    t_reserve_ref(),
    util.mk_output_no_datum(
      util.script_address(t_reserve_hash),
      t_reserve_value(lamp, t_pot_ada),
    ),
  )
}

fn t_reserve_output(lamp: Int) -> Output {
  util.mk_output_no_datum(
    util.script_address(t_reserve_hash),
    t_reserve_value(lamp, t_pot_ada),
  )
}

/// UTxO lạc mang datum inline `OutputReference` — đúng hình dạng mà két swap dùng
/// khi trả LAMP về theo `pot_return`.
fn t_stray_ref_datum(ix: Int, v: Value) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(util.script_address(t_pot_hash), v, util.mk_ref(99)),
  )
}

/// UTxO lạc KHÔNG datum. Plutus V3 cho tiêu, nên `spend` phải chạy được với `None`.
fn t_stray_no_datum(ix: Int, v: Value) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output_no_datum(util.script_address(t_pot_hash), v),
  )
}

fn t_wallet_input(ix: Int, v: Value) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output_no_datum(util.vk_address(#"a0"), v),
  )
}

fn t_genesis_input() -> Input {
  util.mk_input(
    t_genesis_ref(),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

// ── Validity range ────────────────────────────────────────────────

/// Hai cận HỮU HẠN, cùng bucket `epoch`, rộng đúng `max_range_ms`.
fn t_range_ok(epoch: Int) -> Interval {
  let lo = epoch * t_ms_per_epoch
  between(lo, lo + max_range_ms)
}

fn t_range(lo: Int, lo_incl: Bool, hi: Int, hi_incl: Bool) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(lo), is_inclusive: lo_incl },
    upper_bound: IntervalBound { bound_type: Finite(hi), is_inclusive: hi_incl },
  }
}

fn t_range_open_top(lo: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(lo), is_inclusive: True },
    upper_bound: IntervalBound {
      bound_type: PositiveInfinity,
      is_inclusive: True,
    },
  }
}

// ── Gọi validator ─────────────────────────────────────────────────

fn t_spend(
  d: Option<Data>,
  r: PotRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  pot_vault.spend(
    t_genesis_ref(),
    t_lamp_policy,
    t_lamp_name,
    t_ms_per_epoch,
    t_window_cap,
    t_total_cap,
    d,
    r,
    own_ref,
    tx,
  )
}

fn t_mint_with(
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  ms_per_epoch: Int,
  window_cap: Int,
  total_cap: Int,
  tx: Transaction,
) -> Bool {
  pot_vault.mint(
    t_genesis_ref(),
    lamp_policy,
    lamp_name,
    ms_per_epoch,
    window_cap,
    total_cap,
    MintPot,
    t_pot_hash,
    tx,
  )
}

fn t_mint(tx: Transaction) -> Bool {
  t_mint_with(
    t_lamp_policy,
    t_lamp_name,
    t_ms_per_epoch,
    t_window_cap,
    t_total_cap,
    tx,
  )
}

// ── Dựng tx ───────────────────────────────────────────────────────

/// Một lượt `Feed`: trả về (datum của pot input, tx) để hai thứ không bao giờ
/// lệch nhau trong ca kiểm.
fn t_feed(
  din: PotDatum,
  pot_lamp_in: Int,
  pot_out: Output,
  reserve_lamp_in: Int,
  reserve_out: Output,
  extra_inputs: List<Input>,
  range: Interval,
) -> (Option<Data>, Transaction) {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        t_pot_input(din, pot_lamp_in, t_pot_ada),
        t_reserve_input(reserve_lamp_in),
        ..extra_inputs
      ],
      outputs: [pot_out, reserve_out],
      validity_range: range,
      redeemers: t_redeemers(Feed),
    }
  (t_some_datum(din), tx)
}

fn t_din_ok() -> PotDatum {
  t_pot_datum(0, t_now - 1)
}

fn t_pot_out_ok() -> Output {
  t_pot_output(t_pot_datum(t_d, t_now), t_pot_lamp - t_d, t_pot_ada)
}

fn t_feed_ok() -> (Option<Data>, Transaction) {
  t_feed(
    t_din_ok(),
    t_pot_lamp,
    t_pot_out_ok(),
    0,
    t_reserve_output(t_d),
    [],
    t_range_ok(t_now),
  )
}

/// Một lượt `Absorb`: pot input + danh sách UTxO lạc.
fn t_absorb(
  din: PotDatum,
  pot_lamp_in: Int,
  pot_out: Output,
  strays: List<Input>,
  pot_redeemer: Data,
) -> (Option<Data>, Transaction) {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [t_pot_input(din, pot_lamp_in, t_pot_ada), ..strays],
      outputs: [pot_out],
      redeemers: t_redeemers(pot_redeemer),
    }
  (t_some_datum(din), tx)
}

fn t_mint_tx(pot_out: Output, mint: Value, inputs: List<Input>) -> Transaction {
  Transaction { ..placeholder, inputs, outputs: [pot_out], mint }
}

fn t_mint_datum_ok() -> PotDatum {
  PotDatum { reserve_hash: t_reserve_hash, drawn_total: 0, last_window: -1 }
}

fn t_mint_out_ok() -> Output {
  t_pot_output(t_mint_datum_ok(), 0, t_pot_ada)
}

fn t_mint_tx_ok(pot_out: Output) -> Transaction {
  t_mint_tx(pot_out, t_mint_value(pot_nft_name, 1), [t_genesis_input()])
}

// ══════════════════════════════════════════════════════════════════════════
// FEED
// ══════════════════════════════════════════════════════════════════════════

test feed_dung_luat() {
  let (d, tx) = t_feed_ok()
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-6: LAMP của két sau lượt rót vượt trần cửa sổ đúng 1 oildrop. Ca dương song
/// sinh là `feed_dung_luat` (két rỗng → đúng trần).
test feed_vuot_window_cap() fail {
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      1,
      t_reserve_output(t_d + 1),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-4: sổ gộp vượt trần tích luỹ kênh đúng 1 oildrop.
test feed_vuot_total_cap() fail {
  let din = t_pot_datum(t_total_cap - t_d + 1, t_now - 1)
  let (d, tx) =
    t_feed(
      din,
      t_pot_lamp,
      t_pot_output(
        t_pot_datum(t_total_cap + 1, t_now),
        t_pot_lamp - t_d,
        t_pot_ada,
      ),
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// Ca dương song sinh của `feed_vuot_total_cap`: đúng TRẦN thì phải xanh.
test feed_dung_total_cap() {
  let din = t_pot_datum(t_total_cap - t_d, t_now - 1)
  let (d, tx) =
    t_feed(
      din,
      t_pot_lamp,
      t_pot_output(t_pot_datum(t_total_cap, t_now), t_pot_lamp - t_d, t_pot_ada),
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: hai lượt `Feed` trong cùng một cửa sổ.
test feed_hai_lan_mot_cua_so() fail {
  let din = t_pot_datum(0, t_now)
  let (d, tx) =
    t_feed(
      din,
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: cận DƯỚI lùi sang bucket trước ⇒ hai cận khác bucket.
test feed_can_duoi_lui_qua_khu() fail {
  let lo = t_now * t_ms_per_epoch - 1
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo + 10, True),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: cận TRÊN vô hạn ⇒ `now` không neo được vào thời gian thật.
test feed_can_tren_vo_han() fail {
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range_open_top(t_now * t_ms_per_epoch),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: khoảng rộng hơn 1 giờ đúng 1 ms.
test feed_khoang_hon_1_gio() fail {
  let lo = t_now * t_ms_per_epoch
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo + max_range_ms + 1, True),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: cận dưới MỞ ở đúng biên bucket trước. `lo_raw` thuộc bucket `t_now − 1`
/// nhưng thời điểm sớm nhất thật là `lo_raw + 1` ⇒ cùng bucket `t_now` ⇒ XANH.
/// Không quy đổi cận mở thì ca này bị từ chối oan.
test feed_can_duoi_mo_sat_bien() {
  let lo = t_now * t_ms_per_epoch - 1
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, False, lo + 1 + max_range_ms, True),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: cận trên MỞ ở `lo + max_range_ms + 1` ⇒ muộn nhất thật là
/// `lo + max_range_ms` ⇒ đúng trần ⇒ XANH.
test feed_can_tren_mo_sat_bien() {
  let lo = t_now * t_ms_per_epoch
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo + max_range_ms + 1, False),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: cận trên MỞ ở `lo + max_range_ms + 2` ⇒ muộn nhất thật vượt trần 1 ms.
test feed_can_tren_mo_vuot_tran() fail {
  let lo = t_now * t_ms_per_epoch
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo + max_range_ms + 2, False),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-6: LAMP rót vào một script KHÁC két (NFT két đi theo, địa chỉ thì không).
test feed_den_dia_chi_khac_ket() fail {
  let reserve_out =
    util.mk_output_no_datum(
      util.script_address(t_other_hash),
      t_reserve_value(t_d, t_pot_ada),
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      reserve_out,
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-6: ĐỊA CHỈ FRANKEN — đúng payment credential của két, gắn thêm stake
/// credential của kẻ dựng tx ⇒ thưởng uỷ quyền trên ADA của két chảy về ví họ.
/// Đây là ca DUY NHẤT tách được cổng "so địa chỉ đầy đủ" khỏi cổng
/// "payment credential là Script(reserve_hash)".
test feed_ket_co_stake_cred() fail {
  let reserve_out =
    util.mk_output_no_datum(
      util.script_address_staked(t_reserve_hash, #"a77ac6"),
      t_reserve_value(t_d, t_pot_ada),
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      reserve_out,
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-5: két KHÔNG bị tiêu (không có input mang NFT két) ⇒ không validator nào
/// bên két chạy ⇒ LAMP rót vào một UTxO không ai canh.
test feed_thieu_nft_ket() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        t_pot_input(t_din_ok(), t_pot_lamp, t_pot_ada),
        t_wallet_input(9, assets.from_lovelace(2_000_000)),
      ],
      outputs: [t_pot_out_ok(), t_reserve_output(t_d)],
      validity_range: t_range_ok(t_now),
      redeemers: t_redeemers(Feed),
    }
  t_spend(t_some_datum(t_din_ok()), Feed, t_pot_ref(), tx)
}

/// F-2: đổi `reserve_hash` trong datum tiếp nối ⇒ đổi đích rót vĩnh viễn.
test feed_doi_reserve_hash() fail {
  let pot_out =
    t_pot_output(
      PotDatum {
        reserve_hash: t_other_hash,
        drawn_total: t_d,
        last_window: t_now,
      },
      t_pot_lamp - t_d,
      t_pot_ada,
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-3: rút ADA của pot ra (min-UTxO của pot bị gặm dần).
test feed_lay_ada_pot() fail {
  let pot_out =
    t_pot_output(t_pot_datum(t_d, t_now), t_pot_lamp - t_d, t_pot_ada - 1)
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-3: nhồi token lạ vào pot (min-UTxO tăng, sổ kế toán nhiễu).
test feed_them_token_la() fail {
  let v =
    t_pot_value(t_pot_lamp - t_d, t_pot_ada)
      |> assets.add(t_alien_policy, t_alien_name, 1)
  let pot_out =
    util.mk_output(util.script_address(t_pot_hash), v, t_pot_datum(t_d, t_now))
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-0: `Feed` kèm một UTxO lạc ⇒ LAMP của UTxO lạc trả hộ lượt rót.
test feed_kem_utxo_lac() fail {
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [t_stray_ref_datum(3, t_lamp_value(t_d, 2_000_000))],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-2: output tiếp nối ở ĐỊA CHỈ FRANKEN của chính pot.
test feed_pot_out_stake_cred() fail {
  let pot_out =
    util.mk_output(
      util.script_address_staked(t_pot_hash, #"a77ac6"),
      t_pot_value(t_pot_lamp - t_d, t_pot_ada),
      t_pot_datum(t_d, t_now),
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-2: pot biến thành script-carrier (ADA min-UTxO phình theo kích thước script).
test feed_pot_out_ref_script() fail {
  let pot_out =
    util.mk_output_with_ref_script(
      util.script_address(t_pot_hash),
      t_pot_value(t_pot_lamp - t_d, t_pot_ada),
      t_pot_datum(t_d, t_now),
      #"beef",
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-4: lượt rót rỗng (`d == 0`) — chỉ để đẩy `last_window` lên, chiếm cửa sổ.
test feed_d_bang_0() fail {
  let pot_out = t_pot_output(t_pot_datum(0, t_now), t_pot_lamp, t_pot_ada)
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(0),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-4: `drawn_total` không tăng theo lượng rót (sổ gộp bị nói nhỏ đi ⇒ trần
/// tích luỹ thành số trang trí).
test feed_drawn_total_khong_tang() fail {
  let pot_out = t_pot_output(t_pot_datum(0, t_now), t_pot_lamp - t_d, t_pot_ada)
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-2: `last_window` ghi ở TƯƠNG LAI (khoá cửa sổ sau mà không rót gì thêm).
test feed_last_window_khac_now() fail {
  let pot_out =
    t_pot_output(t_pot_datum(t_d, t_now + 1), t_pot_lamp - t_d, t_pot_ada)
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      pot_out,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-6: két nhận ÍT hơn lượng rời pot ⇒ phần chênh đi đâu không ai biết.
test feed_ket_nhan_thieu() fail {
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d - 1),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-5: HAI input mang NFT két. `input_with_nft` lấy cái đầu tiên, nên không có
/// phép đếm thì `reserve_lamp_in` đọc từ một UTxO do người dựng tx chọn — chốt
/// "két nhận đúng `d`" tính trên một cái sổ khác. Ca `feed_thieu_nft_ket` KHÔNG
/// ghim được vế này (nó đỏ vì `expect Some(..)` vỡ khi danh sách rỗng).
test feed_hai_input_ket() fail {
  let ket2 =
    util.mk_input(
      util.mk_ref(7),
      util.mk_output_no_datum(
        util.script_address(t_reserve_hash),
        t_reserve_value(0, t_pot_ada),
      ),
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [ket2],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-6: HAI output mang NFT két, cái HỢP LỆ đứng TRƯỚC. `output_with_nft` lấy cái
/// đầu tiên ⇒ không có phép đếm thì output thứ hai (địa chỉ franken) đi lọt hoàn
/// toàn. Thứ tự trong danh sách là phần load-bearing của ca này: đảo lại thì ca
/// đỏ ở chốt địa chỉ và không còn ghim phép đếm.
test feed_hai_output_ket() fail {
  let (d, tx0) = t_feed_ok()
  let ket2 =
    util.mk_output_no_datum(
      util.script_address_staked(t_reserve_hash, #"a77ac6"),
      t_reserve_value(0, t_pot_ada),
    )
  let tx =
    Transaction {
      ..tx0,
      outputs: [t_pot_out_ok(), t_reserve_output(t_d), ket2],
    }
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-7: đúc thêm một token dưới policy pot trong lượt `Feed`.
test feed_mint_duoi_policy_pot() fail {
  let (d, tx0) = t_feed_ok()
  let tx = Transaction { ..tx0, mint: t_mint_value(#"99", 1) }
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// Hai input mang NFT pot trong một lượt `Feed`.
///
/// ĐỌC KỸ: ca này đỏ ở **F-0** (`count_inputs_at_script == 1`), KHÔNG ở chốt
/// "đúng 1 input pot" — đo bằng đột biến 2026-09-28: gỡ chốt đếm NFT thì ca này
/// VẪN đỏ. Chốt đếm NFT được ghim bởi `absorb_hai_input_pot_nft` (nhánh `Absorb`
/// không có F-0 nên ở đó nó là cổng duy nhất còn đứng).
test feed_hai_input_pot_nft() fail {
  let second =
    util.mk_input(
      util.mk_ref(8),
      util.mk_output(
        util.script_address(t_pot_hash),
        t_pot_value(t_pot_lamp, t_pot_ada),
        t_din_ok(),
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        t_pot_input(t_din_ok(), t_pot_lamp, t_pot_ada),
        t_reserve_input(0),
        second,
      ],
      outputs: [t_pot_out_ok(), t_reserve_output(t_d)],
      validity_range: t_range_ok(t_now),
      redeemers: t_redeemers(Feed),
    }
  t_spend(t_some_datum(t_din_ok()), Feed, t_pot_ref(), tx)
}

/// F-2: hai output ở địa chỉ pot ⇒ phép "đúng 1 output tiếp nối" mất nghĩa (một
/// output thoả cho nhiều mục đích, và bên index không biết cái nào là pot).
test feed_hai_output_pot() fail {
  let (d, tx0) = t_feed_ok()
  let junk =
    util.mk_output_no_datum(
      util.script_address(t_pot_hash),
      assets.from_lovelace(2_000_000),
    )
  let tx =
    Transaction {
      ..tx0,
      outputs: [t_pot_out_ok(), t_reserve_output(t_d), junk],
    }
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-2: output tiếp nối ở đúng địa chỉ pot nhưng KHÔNG mang NFT pot ⇒ NFT biến
/// mất khỏi két (và cùng với nó là mọi cổng của những lượt sau).
test feed_pot_out_thieu_nft() fail {
  let no_nft =
    util.mk_output(
      util.script_address(t_pot_hash),
      t_lamp_value(t_pot_lamp - t_d, t_pot_ada),
      t_pot_datum(t_d, t_now),
    )
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      no_nft,
      0,
      t_reserve_output(t_d),
      [],
      t_range_ok(t_now),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: thời gian ÂM. Fixture đi đúng bội của `ms_per_epoch` (−2 × ms) nên bucket
/// tính ra −2 bất kể phép chia làm tròn kiểu nào, và `last_window = −3` để lượt
/// này THOẢ mọi chốt khác — nếu không nó đỏ ở `now > last_window` và chốt `lo ≥ 0`
/// không còn bài nào ghim (đo bằng đột biến 2026-09-28).
test feed_thoi_gian_am() fail {
  let lo = -2 * t_ms_per_epoch
  let (d, tx) =
    t_feed(
      t_pot_datum(0, -3),
      t_pot_lamp,
      t_pot_output(t_pot_datum(t_d, -2), t_pot_lamp - t_d, t_pot_ada),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo + 1_000, True),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: hai cận NẰM HAI BUCKET mà vẫn trong trần 1 giờ — cửa sổ 5 ngày rộng hơn
/// 1 giờ rất nhiều, nên một khoảng hợp lệ vẫn vắt qua được ranh giới bucket. Ở
/// đây datum ghi đúng bucket của cận DƯỚI (`t_now − 1`) nên mọi chốt khác thoả:
/// chốt "hai cận cùng bucket" là cổng duy nhất còn đứng. Không có nó, một lượt
/// Feed xảy ra trong cửa sổ `t_now` được ghi sổ vào cửa sổ `t_now − 1` ⇒ cửa sổ
/// `t_now` còn nguyên một lượt nữa.
test feed_hai_can_khac_bucket() fail {
  let lo = t_now * t_ms_per_epoch - 1_000
  let (d, tx) =
    t_feed(
      t_pot_datum(0, t_now - 2),
      t_pot_lamp,
      t_pot_output(t_pot_datum(t_d, t_now - 1), t_pot_lamp - t_d, t_pot_ada),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo + max_range_ms, True),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

/// F-1: khoảng RỖNG (`lo > hi`). Không chặn thì `hi − lo ≤ max_range_ms` thoả
/// tầm thường (số âm) và cả hai cận vẫn cùng bucket.
test feed_khoang_rong() fail {
  let lo = t_now * t_ms_per_epoch + 100
  let (d, tx) =
    t_feed(
      t_din_ok(),
      t_pot_lamp,
      t_pot_out_ok(),
      0,
      t_reserve_output(t_d),
      [],
      t_range(lo, True, lo - 10, True),
    )
  t_spend(d, Feed, t_pot_ref(), tx)
}

// ══════════════════════════════════════════════════════════════════════════
// ABSORB
// ══════════════════════════════════════════════════════════════════════════

test absorb_dung_luat() {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// UTxO lạc mang datum inline `OutputReference` (hình két swap trả về) — gọi
/// validator trên CHÍNH UTxO lạc đó.
test absorb_utxo_lac_datum_outputref() {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (_d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  t_spend(t_some_datum(util.mk_ref(99)), Absorb, util.mk_ref(3), tx)
}

/// UTxO lạc KHÔNG datum: Plutus V3 cho tiêu, `spend` phải chạy được với `None`.
test absorb_utxo_lac_khong_datum() {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_no_datum(3, t_lamp_value(500, 5_000_000))
  let (_d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  t_spend(None, Absorb, util.mk_ref(3), tx)
}

/// A-3: người dọn nuốt 1 oildrop LAMP của UTxO lạc.
test absorb_nuot_lamp() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_499, t_pot_ada), [stray], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-1: đổi datum trong lượt `Absorb` (ở đây: `last_window`).
test absorb_doi_datum() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx) =
    t_absorb(
      din,
      1_000,
      t_pot_output(t_pot_datum(t_d, t_now + 1), 1_500, t_pot_ada),
      [stray],
      Absorb,
    )
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-1: LAMP trả về KHÔNG hoàn trần — `drawn_total` không được giảm.
test absorb_hoan_tran_drawn_total() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx) =
    t_absorb(
      din,
      1_000,
      t_pot_output(t_pot_datum(t_d - 500, t_now), 1_500, t_pot_ada),
      [stray],
      Absorb,
    )
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-3: token lạ trên UTxO lạc bị đẩy VÀO pot.
test absorb_token_la_vao_pot() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray_value =
    t_lamp_value(500, 5_000_000) |> assets.add(t_alien_policy, t_alien_name, 1)
  let stray = t_stray_ref_datum(3, stray_value)
  let pot_out_value =
    t_pot_value(1_500, t_pot_ada) |> assets.add(t_alien_policy, t_alien_name, 1)
  let (d, tx) =
    t_absorb(
      din,
      1_000,
      util.mk_output(util.script_address(t_pot_hash), pot_out_value, din),
      [stray],
      Absorb,
    )
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// Ca dương song sinh: token lạ theo NGƯỜI DỌN, LAMP vào pot ⇒ xanh.
test absorb_token_la_ve_nguoi_don() {
  let din = t_pot_datum(t_d, t_now)
  let stray_value =
    t_lamp_value(500, 5_000_000) |> assets.add(t_alien_policy, t_alien_name, 1)
  let stray = t_stray_ref_datum(3, stray_value)
  let (d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-3: `Absorb` mà KHÔNG có UTxO lạc nào — lượt chạy rỗng, chỉ tốn phí và
/// chiếm UTxO pot (và ở bản lỏng thì nó là đường đổi datum miễn phí).
test absorb_khong_co_utxo_lac() fail {
  let din = t_pot_datum(t_d, t_now)
  let (d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_000, t_pot_ada), [], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-3: rút ADA của pot trong lượt dọn.
test absorb_lay_ada_pot() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx) =
    t_absorb(
      din,
      1_000,
      t_pot_output(din, 1_500, t_pot_ada - 1),
      [stray],
      Absorb,
    )
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-3: hai UTxO lạc, cả hai phải vào pot (ca dương — chốt tổng, không chốt "một cái").
test absorb_hai_utxo_lac() {
  let din = t_pot_datum(t_d, t_now)
  let strays =
    [
      t_stray_ref_datum(3, t_lamp_value(500, 5_000_000)),
      t_stray_no_datum(4, t_lamp_value(700, 3_000_000)),
    ]
  let (d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 2_200, t_pot_ada), strays, Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-3: hai UTxO lạc mà chỉ một cái được cộng vào pot.
test absorb_hai_utxo_lac_thieu_mot() fail {
  let din = t_pot_datum(t_d, t_now)
  let strays =
    [
      t_stray_ref_datum(3, t_lamp_value(500, 5_000_000)),
      t_stray_no_datum(4, t_lamp_value(700, 3_000_000)),
    ]
  let (d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), strays, Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-4: đúc token dưới policy pot trong lượt `Absorb`.
test absorb_mint_duoi_policy_pot() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx0) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  let tx = Transaction { ..tx0, mint: t_mint_value(#"99", 1) }
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// CHỐNG THOẢ MÃN KÉP — ca ghim chốt "đúng 1 input pot" (`count_inputs_with_nft`).
///
/// Hai UTxO pot cùng bị tiêu bằng `Absorb`, LAMP và datum giống nhau. Nhánh
/// `Absorb` KHÔNG có F-0, và `stray_lamp_total` loại mọi input mang NFT pot ⇒ khi
/// kiểm input A thì B không tính là UTxO lạc và ngược lại, nên MỘT output tiếp nối
/// thoả cho CẢ HAI lượt gọi: LAMP của một trong hai pot đi ra ví mà không cổng nào
/// thấy. Đây là ca DUY NHẤT tách được chốt đếm NFT khỏi các chốt khác.
test absorb_hai_input_pot_nft() fail {
  let din = t_pot_datum(t_d, t_now)
  let pot_b =
    util.mk_input(
      util.mk_ref(8),
      util.mk_output(
        util.script_address(t_pot_hash),
        t_pot_value(1_000, t_pot_ada),
        din,
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [t_pot_input(din, 1_000, t_pot_ada), pot_b],
      outputs: [
        t_pot_output(din, 1_000, t_pot_ada),
        util.mk_output_no_datum(
          util.vk_address(#"a0"),
          t_lamp_value(1_000, 2_000_000),
        ),
      ],
      redeemers: t_redeemers(Absorb),
    }
  t_spend(t_some_datum(din), Absorb, t_pot_ref(), tx)
}

/// A-2: hai output ở địa chỉ pot trong lượt dọn.
test absorb_hai_output_pot() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (d, tx0) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  let junk =
    util.mk_output_no_datum(
      util.script_address(t_pot_hash),
      assets.from_lovelace(2_000_000),
    )
  let tx =
    Transaction { ..tx0, outputs: [t_pot_output(din, 1_500, t_pot_ada), junk] }
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-2: output tiếp nối KHÔNG mang NFT pot trong lượt dọn.
test absorb_pot_out_thieu_nft() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let no_nft =
    util.mk_output(
      util.script_address(t_pot_hash),
      t_lamp_value(1_500, t_pot_ada),
      din,
    )
  let (d, tx) = t_absorb(din, 1_000, no_nft, [stray], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-2: pot biến thành script-carrier trong lượt dọn.
test absorb_pot_out_ref_script() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let carrier =
    util.mk_output_with_ref_script(
      util.script_address(t_pot_hash),
      t_pot_value(1_500, t_pot_ada),
      din,
      #"beef",
    )
  let (d, tx) = t_absorb(din, 1_000, carrier, [stray], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

/// A-2: output tiếp nối ở ĐỊA CHỈ FRANKEN của pot trong lượt dọn.
test absorb_pot_out_stake_cred() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let franken =
    util.mk_output(
      util.script_address_staked(t_pot_hash, #"a77ac6"),
      t_pot_value(1_500, t_pot_ada),
      din,
    )
  let (d, tx) = t_absorb(din, 1_000, franken, [stray], Absorb)
  t_spend(d, Absorb, t_pot_ref(), tx)
}

// ══════════════════════════════════════════════════════════════════════════
// NHÁNH UTxO LẠC (A-STRAY-*)
// ══════════════════════════════════════════════════════════════════════════

/// A-STRAY-1: tiêu UTxO lạc mà KHÔNG tiêu UTxO pot ⇒ không nhánh nào ép luật ⇒
/// ai cũng hốt LAMP đang chờ dọn.
test spend_lac_khong_co_pot() fail {
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [stray],
      outputs: [
        util.mk_output_no_datum(
          util.vk_address(#"a0"),
          t_lamp_value(500, 5_000_000),
        ),
      ],
    }
  t_spend(t_some_datum(util.mk_ref(99)), Absorb, util.mk_ref(3), tx)
}

/// A-STRAY-2: UTxO pot bị tiêu bằng redeemer `Feed` trong khi UTxO lạc đi nhánh
/// hút. Nhánh của pot đã chặn hình dạng này (F-0), dòng này chặn ngay tại chỗ.
test spend_lac_pot_dung_redeemer_feed() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (_d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Feed)
  t_spend(t_some_datum(util.mk_ref(99)), Absorb, util.mk_ref(3), tx)
}

/// A-STRAY-3: UTxO lạc đi bằng redeemer `Feed`.
test spend_lac_redeemer_feed() fail {
  let din = t_pot_datum(t_d, t_now)
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let (_d, tx) =
    t_absorb(din, 1_000, t_pot_output(din, 1_500, t_pot_ada), [stray], Absorb)
  t_spend(t_some_datum(util.mk_ref(99)), Feed, util.mk_ref(3), tx)
}

/// NFT pot nằm ở VÍ: input mang NFT bị tiêu nhưng validator pot KHÔNG chạy cho
/// nó ⇒ uỷ quyền rơi vào chỗ trống. (Hình dạng này không tồn tại được trên chuỗi
/// vì M-3/F-2/A-2 giữ NFT ở địa chỉ pot; cổng vẫn phải đứng độc lập.)
test spend_lac_pot_nft_o_vi() fail {
  let stray = t_stray_ref_datum(3, t_lamp_value(500, 5_000_000))
  let pot_at_wallet =
    util.mk_input(
      t_pot_ref(),
      util.mk_output_no_datum(
        util.vk_address(#"a0"),
        t_pot_value(1_000, t_pot_ada),
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pot_at_wallet, stray],
      outputs: [
        util.mk_output_no_datum(
          util.vk_address(#"a0"),
          t_lamp_value(500, 5_000_000),
        ),
      ],
      redeemers: t_redeemers(Absorb),
    }
  t_spend(t_some_datum(util.mk_ref(99)), Absorb, util.mk_ref(3), tx)
}

// ══════════════════════════════════════════════════════════════════════════
// MINTPOT
// ══════════════════════════════════════════════════════════════════════════

test mintpot_dung_luat() {
  t_mint(t_mint_tx_ok(t_mint_out_ok()))
}

/// M-5: nạp LAMP ngay trong lượt đúc (đường nạp lần đầu).
test mintpot_kem_lamp() {
  t_mint(t_mint_tx_ok(t_pot_output(t_mint_datum_ok(), 9_000_000, t_pot_ada)))
}

/// M-1: không tiêu `genesis_ref` ⇒ one-shot bị phá (đúc được nhiều pot).
test mintpot_khong_tieu_genesis_ref() fail {
  let tx =
    t_mint_tx(
      t_mint_out_ok(),
      t_mint_value(pot_nft_name, 1),
      [t_wallet_input(9, assets.from_lovelace(2_000_000))],
    )
  t_mint(tx)
}

/// M-2: đúc 2 NFT pot.
test mintpot_hai_nft() fail {
  let tx =
    t_mint_tx(
      t_pot_output(t_mint_datum_ok(), 0, t_pot_ada),
      t_mint_value(pot_nft_name, 2),
      [t_genesis_input()],
    )
  t_mint(tx)
}

/// M-2: đúc kèm một tên khác dưới cùng policy.
test mintpot_kem_ten_khac() fail {
  let mint = t_mint_value(pot_nft_name, 1) |> assets.add(t_pot_hash, #"99", 1)
  let tx = t_mint_tx(t_mint_out_ok(), mint, [t_genesis_input()])
  t_mint(tx)
}

/// Không có đường đốt NFT pot: số lượng âm bị M-2 từ chối.
test burn_nft() fail {
  let tx =
    t_mint_tx(
      t_mint_out_ok(),
      t_mint_value(pot_nft_name, -1),
      [t_genesis_input()],
    )
  t_mint(tx)
}

/// M-3: HAI output mang NFT pot, cái HỢP LỆ đứng TRƯỚC — cùng lẽ với
/// `feed_hai_output_ket`: `output_with_nft` lấy cái đầu, nên phép đếm là cổng duy
/// nhất thấy được cái thứ hai. `mintpot_nft_vao_vi` không ghim được vế này.
test mintpot_hai_output_nft() fail {
  let tx =
    Transaction {
      ..t_mint_tx_ok(t_mint_out_ok()),
      outputs: [
        t_mint_out_ok(),
        util.mk_output(
          util.vk_address(#"a0"),
          t_pot_value(0, t_pot_ada),
          t_mint_datum_ok(),
        ),
      ],
    }
  t_mint(tx)
}

/// M-3: đúc NFT pot thẳng vào ví ⇒ validator pot không bao giờ chạy.
test mintpot_nft_vao_vi() fail {
  let pot_out =
    util.mk_output(
      util.vk_address(#"a77ac6"),
      t_pot_value(0, t_pot_ada),
      t_mint_datum_ok(),
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-3: ĐỊA CHỈ FRANKEN của pot ngay lúc đúc.
test mintpot_nft_stake_cred() fail {
  let pot_out =
    util.mk_output(
      util.script_address_staked(t_pot_hash, #"a77ac6"),
      t_pot_value(0, t_pot_ada),
      t_mint_datum_ok(),
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-3: pot khởi tạo mang reference script.
test mintpot_ref_script() fail {
  let pot_out =
    util.mk_output_with_ref_script(
      util.script_address(t_pot_hash),
      t_pot_value(0, t_pot_ada),
      t_mint_datum_ok(),
      #"beef",
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-4: không datum ⇒ pot khoá chết với MỌI redeemer.
test mintpot_khong_datum() fail {
  let pot_out =
    util.mk_output_no_datum(
      util.script_address(t_pot_hash),
      t_pot_value(0, t_pot_ada),
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-4: `drawn_total` khởi tạo khác 0 (ăn trước hạn mức kênh).
test mintpot_datum_drawn_khac_0() fail {
  let pot_out =
    t_pot_output(
      PotDatum { reserve_hash: t_reserve_hash, drawn_total: 1, last_window: -1 },
      0,
      t_pot_ada,
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-4: `last_window` khởi tạo = 0. Cửa sổ 0 là cửa sổ THẬT, nên 0 tặng sẵn một
/// lượt Feed mà `now > last_window` vẫn thoả — phải là −1.
test mintpot_last_window_bang_0() fail {
  let pot_out =
    t_pot_output(
      PotDatum { reserve_hash: t_reserve_hash, drawn_total: 0, last_window: 0 },
      0,
      t_pot_ada,
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-4: `reserve_hash` 27 byte ⇒ không phải một script hash ⇒ đích rót chết.
test mintpot_reserve_hash_27_byte() fail {
  let pot_out =
    t_pot_output(
      PotDatum {
        reserve_hash: #"222222222222222222222222222222222222222222222222222222",
        drawn_total: 0,
        last_window: -1,
      },
      0,
      t_pot_ada,
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-5: token lạ trong value lúc đúc.
test mintpot_token_la() fail {
  let v =
    t_pot_value(0, t_pot_ada) |> assets.add(t_alien_policy, t_alien_name, 1)
  let pot_out =
    util.mk_output(util.script_address(t_pot_hash), v, t_mint_datum_ok())
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-6: `reserve_hash == policy_id` ⇒ F-5/F-6 đòi cùng một NFT cho hai vai ⇒
/// `d == −d` ⇒ không lượt Feed nào thoả được ⇒ pot chết, không dòng nào báo.
test mintpot_reserve_hash_bang_own() fail {
  let pot_out =
    t_pot_output(
      PotDatum { reserve_hash: t_pot_hash, drawn_total: 0, last_window: -1 },
      0,
      t_pot_ada,
    )
  t_mint(t_mint_tx_ok(pot_out))
}

/// M-6: tham số LAMP TRÙNG NFT pot ⇒ sổ LAMP và NFT lẫn nhau.
test mintpot_lamp_trung_nft_pot() fail {
  t_mint_with(
    t_pot_hash,
    pot_nft_name,
    t_ms_per_epoch,
    t_window_cap,
    t_total_cap,
    t_mint_tx_ok(t_mint_out_ok()),
  )
}

/// M-7: `ms_per_epoch == 0` ⇒ chia cho 0 ở mọi lượt Feed.
test mintpot_ms_per_epoch_bang_0() fail {
  t_mint_with(
    t_lamp_policy,
    t_lamp_name,
    0,
    t_window_cap,
    t_total_cap,
    t_mint_tx_ok(t_mint_out_ok()),
  )
}

/// M-7: `window_cap == 0` ⇒ không lượt rót nào thoả được (`d > 0` mà két ≤ 0).
test mintpot_window_cap_bang_0() fail {
  t_mint_with(
    t_lamp_policy,
    t_lamp_name,
    t_ms_per_epoch,
    0,
    t_total_cap,
    t_mint_tx_ok(t_mint_out_ok()),
  )
}

/// M-7: `total_cap == 0` ⇒ trần tích luỹ không bao giờ thoả.
test mintpot_total_cap_bang_0() fail {
  t_mint_with(
    t_lamp_policy,
    t_lamp_name,
    t_ms_per_epoch,
    t_window_cap,
    0,
    t_mint_tx_ok(t_mint_out_ok()),
  )
}
