// Khung dựng tx dùng CHUNG cho `claim_account` và `treasury` — Issue #79.
//
// Bộ kiểm cũ chạy MỘT validator trên mỗi tx; validator hàng xóm chỉ hiện diện dưới dạng
// UTxO đặt sẵn. Nên mỗi tệp tự dựng một bộ hằng + một hình dạng tx riêng (`claim_tx` bên
// tài khoản dùng `ms_per_epoch = 86_400_000`, `grant_upd_tx` bên kho dùng `432_000_000`,
// tài khoản bên kho không mang NFT…), và không bài nào chứng minh được một tx cụ thể qua
// được CẢ HAI phía. Ở đây chỉ có MỘT bộ hằng và MỘT hình dạng tx; tệp test
// `validators/claim_treasury_cross_test.ak` gọi cả hai `spend` trên đúng giá trị đó.
//
// Vì sao nằm ở lib/: module test đã `use` validator thì không được export `pub`
// (aiken::check::illegal::import) — tiền lệ `governance/proposal_fixtures.ak`. Ở đây CHỈ
// có thứ không đụng module validator; phần gọi `spend` ở lại trong tệp test.
//
// Không hàm nào ở đây nằm trong cây gọi của validator ⇒ không đổi script hash.

use aiken/crypto.{blake2b_256}
use aiken/interval
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/lampdist/types.{
  BeaconDatum, ClaimAccountDatum, DropParam, TreasuryDatum,
}
use magiclamp/lampdist/util

// ── Tham số áp cho CẢ HAI validator (cùng giá trị ⇒ cùng một "cụm") ──────────

pub const claim_account_hash: ByteArray = #"a1a1a1a1"

pub const treasury_hash: ByteArray = #"77777777"

pub const lamp_policy: ByteArray = #"1a3b"

pub const lamp_name: ByteArray = #"744c414d50"

pub const beacon_policy: ByteArray = #"beac"

pub const treasury_nft_policy: ByteArray = #"7235"

pub const account_nft_policy: ByteArray = #"acac"

pub const committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

pub const threshold: Int = 2

pub const committee_sigs: List<ByteArray> = [#"c1", #"c2"]

pub const ms_per_epoch: Int = 86_400_000

pub const owner: ByteArray = #"0a0a"

/// Hash committee ghi trong datum kho. Không validator nào so nó với tham số `committee`
/// ở các nhánh dùng dưới đây; chỉ cần mọi UTxO kho khai cùng một giá trị.
pub const committee_hash: ByteArray = #"cccc"

/// Cửa sổ mọi tx dựng sẵn chạy trong đó. KHÁC mốc tài khoản vào (2) có chủ đích: mốc vào
/// trùng cửa sổ thì mệnh đề `start' = cửa sổ` đúng ở cả hai cực đột biến.
pub const window: Int = 5

/// Ba OutputReference cố định: tài khoản · kho mang TRSY · UTxO tự đỗ ở địa chỉ kho.
pub const account_ix: Int = 0

pub const treasury_ix: Int = 1

pub const parked_ix: Int = 2

/// LAMP trong pool kho. Đủ lớn để C-SOLV-2 (`nợ ≤ pool`) không phải lý do từ chối nào.
pub const pool: Int = 5000

// ── Datum + value ──────────────────────────────────────────────────────────────

/// Gốc tốc độ của beacon dùng chung. `A(window) = 0 + rate_root · (window − 0)`, nên
/// `index_at_start` mà C-CLAIM-8 đòi ở cửa sổ 5 là `rate_root · 5`.
pub const rate_root: Int = 100

pub const beacon_ix: Int = 3

pub fn account_datum(
  entitlement: Int,
  redeemed: Int,
  start_epoch: Int,
  index_at_start: Int,
) -> ClaimAccountDatum {
  ClaimAccountDatum {
    owner,
    entitlement,
    redeemed,
    start_epoch,
    drops_per_epoch: 1,
    index_at_start,
  }
}

/// `A` tại cửa sổ `w` theo beacon dùng chung (epoch 0, index 0).
pub fn index_at(w: Int) -> Int {
  rate_root * w
}

pub fn treasury_datum(outstanding: Int, total_redeemed: Int) -> TreasuryDatum {
  TreasuryDatum {
    committee_hash,
    outstanding_entitlement: outstanding,
    total_redeemed,
  }
}

/// Reference input mang beacon NFT "DROP". v3 BẮT BUỘC có nó ở mọi `GrantEntitlement`:
/// `index_at_start` được ghim bằng `A(cửa sổ hiện tại)` (C-CLAIM-8), và `A` chỉ đọc được
/// từ beacon đã xác thực.
pub fn beacon_ref() -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(beacon_policy, util.beacon_name(DropParam), 1)
  util.mk_input(
    util.mk_ref(beacon_ix),
    util.mk_output(
      util.script_address(#"bbbbbbbb"),
      v,
      BeaconDatum {
        epoch: 0,
        kind: DropParam,
        index: 0,
        rate_root,
        trim_num: 1,
        trim_den: 1000,
        speed_policies: [],
      },
    ),
  )
}

/// Tài khoản HỢP LỆ: min-ADA + NFT tài khoản tên blake2b_256(owner) (C-ACC-0).
pub fn account_value() -> assets.Value {
  assets.from_lovelace(2_000_000)
    |> assets.add(account_nft_policy, blake2b_256(owner), 1)
}

/// UTxO kho: ADA + LAMP (+ NFT "TRSY" nếu là carrier canonical).
pub fn treasury_value(lovelace: Int, lamp: Int, trsy: Bool) -> assets.Value {
  let v =
    assets.from_lovelace(lovelace) |> assets.add(lamp_policy, lamp_name, lamp)
  if trsy {
    assets.add(v, treasury_nft_policy, util.treasury_nft_name(), 1)
  } else {
    v
  }
}

pub fn window_range() -> interval.Interval {
  interval.between(window * ms_per_epoch, window * ms_per_epoch + 1000)
}

// ── Mảnh UTxO ────────────────────────────────────────────────────────────────

pub fn account_input(d: ClaimAccountDatum) -> Input {
  util.mk_input(
    util.mk_ref(account_ix),
    util.mk_output(
      util.script_address(claim_account_hash),
      account_value(),
      d,
    ),
  )
}

pub fn account_output(d: ClaimAccountDatum) -> Output {
  util.mk_output(util.script_address(claim_account_hash), account_value(), d)
}

pub fn treasury_input(
  ix: Int,
  lovelace: Int,
  lamp: Int,
  outstanding: Int,
  trsy: Bool,
) -> Input {
  util.mk_input(
    util.mk_ref(ix),
    util.mk_output(
      util.script_address(treasury_hash),
      treasury_value(lovelace, lamp, trsy),
      treasury_datum(outstanding, 0),
    ),
  )
}

pub fn treasury_output(
  lovelace: Int,
  lamp: Int,
  outstanding: Int,
  trsy: Bool,
) -> Output {
  util.mk_output(
    util.script_address(treasury_hash),
    treasury_value(lovelace, lamp, trsy),
    treasury_datum(outstanding, 0),
  )
}

/// Khung chung: chữ ký committee, cửa sổ `window`, beacon ở reference input, không mint.
pub fn base_tx(ins: List<Input>, outs: List<Output>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: ins,
    outputs: outs,
    reference_inputs: [beacon_ref()],
    extra_signatories: committee_sigs,
    validity_range: window_range(),
    mint: assets.zero,
  }
}

// ── Hai hình dạng tx của Issue #79 ──────────────────────────────────────────────

/// `Claim` (tài khoản) + `GrantEntitlement` (kho) — đường cấp thêm chính danh.
/// Kho: value bất biến, sổ `outstanding_in → outstanding_out`.
pub fn claim_grant_tx(
  in_d: ClaimAccountDatum,
  out_d: ClaimAccountDatum,
  outstanding_in: Int,
  outstanding_out: Int,
) -> Transaction {
  base_tx(
    [
      account_input(in_d),
      treasury_input(treasury_ix, 5_000_000, pool, outstanding_in, True),
    ],
    [
      account_output(out_d),
      treasury_output(5_000_000, pool, outstanding_out, True),
    ],
  )
}

/// `Claim` (tài khoản) + `Refill` (kho) — cặp #75 chặn. Hình dạng tấn công đầy đủ:
/// kho thật (TRSY, nợ `outstanding_in`) gộp với một UTxO TỰ ĐỖ ở địa chỉ kho (không TRSY)
/// khai nợ khống `parked_debt`. Sổ ra = tổng sổ vào ⇒ Refill thoả phép gộp; carrier TRSY
/// tăng đúng `parked_debt` ⇒ C-SOLV-1 phía tài khoản thoả với `amount = parked_debt`.
/// Không đi qua `GrantEntitlement` ⇒ không mệnh đề C-ACC-3 nào chạy.
pub fn claim_refill_tx(
  in_d: ClaimAccountDatum,
  out_d: ClaimAccountDatum,
  outstanding_in: Int,
  parked_debt: Int,
) -> Transaction {
  base_tx(
    [
      account_input(in_d),
      treasury_input(treasury_ix, 5_000_000, pool, outstanding_in, True),
      treasury_input(parked_ix, 2_000_000, 0, parked_debt, False),
    ],
    [
      account_output(out_d),
      treasury_output(7_000_000, pool, outstanding_in + parked_debt, True),
    ],
  )
}

/// Đối chứng cho `claim_refill_tx`: CÙNG phần kho, bỏ phần tài khoản. Tx này phải QUA
/// Refill — nếu không, bài "kho từ chối Claim+Refill" có thể đỏ vì fixture kho hỏng chứ
/// không vì C-REF-ACC.
///
/// ⚠ ĐỔI KỲ VỌNG 2026-09-26 (C-REF-PROV). Sổ ra trước đây là `outstanding_in + parked_debt`
/// — phép TỔNG của luật cũ. Nay `treasury.ak` chỉ lấy sổ CỦA CARRIER (UTxO mang NFT
/// "TRSY"), nên hình dạng QUA được là `outstanding_in`; `parked_debt` vẫn giữ nguyên ở
/// input để value của nó bị hút vào pool, đúng việc mà Refill sinh ra để làm. Nói cách
/// khác, chính con số đổi ở dòng này là con số mà bản vá lấy đi khỏi tay người lạ.
pub fn refill_only_tx(outstanding_in: Int, parked_debt: Int) -> Transaction {
  base_tx(
    [
      treasury_input(treasury_ix, 5_000_000, pool, outstanding_in, True),
      treasury_input(parked_ix, 2_000_000, 0, parked_debt, False),
    ],
    [treasury_output(7_000_000, pool, outstanding_in, True)],
  )
}

pub fn ref(ix: Int) -> OutputReference {
  util.mk_ref(ix)
}
