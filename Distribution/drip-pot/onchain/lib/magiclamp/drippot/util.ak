// Helper dùng chung cho `drip_pot`. Ý tưởng lấy từ `pot-vault/onchain/lib/magiclamp/
// potvault/util.ak` (lọc theo SCRIPT HASH rồi ghim ĐỊA CHỈ ĐẦY ĐỦ ở chỗ cần ghim; so
// value bằng cách DỰNG LẠI rồi so `==`), viết lại riêng — hai module không dùng chung
// workspace, và chép nguyên tệp thì hai bản trôi nhau mà không gì báo.

use aiken/collection/list
use aiken/interval.{Finite, IntervalBoundType}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use magiclamp/drippot/types.{account_token_name, max_range_ms}

// ── Lọc theo script ───────────────────────────────────────────────

/// Payment credential là `Script(script_hash)`. Stake credential KHÔNG xét: đây là bộ
/// lọc RỘNG dùng để ĐẾM "input/output của két" (§3). Thu hẹp về địa chỉ đầy đủ ở
/// đây làm một output "dời nhà" (thêm stake credential lạ) rơi khỏi phép đếm.
pub fn is_at_script(addr: Address, script_hash: ByteArray) -> Bool {
  when addr.payment_credential is {
    Script(h) -> h == script_hash
    _ -> False
  }
}

pub fn script_inputs(inputs: List<Input>, script_hash: ByteArray) -> List<Input> {
  list.filter(inputs, fn(i) { is_at_script(i.output.address, script_hash) })
}

pub fn script_outputs(
  outputs: List<Output>,
  script_hash: ByteArray,
) -> List<Output> {
  list.filter(outputs, fn(o) { is_at_script(o.address, script_hash) })
}

// ── Token xác thực + LAMP ─────────────────────────────────────────

pub fn token_qty(v: Value, own: PolicyId) -> Int {
  assets.quantity_of(v, own, account_token_name)
}

pub fn lamp_of(v: Value, lamp_policy: PolicyId, lamp_name: AssetName) -> Int {
  assets.quantity_of(v, lamp_policy, lamp_name)
}

/// Value ĐÚNG BẰNG { ADA: của chính nó, LAMP: `lamp_qty`, token xác thực: `token` }.
///
/// Dựng lại từ đúng ba thành phần với lượng KỲ VỌNG rồi so bằng: một phép so đóng
/// cả "lượng sai" lẫn "có token lạ" (kể cả token kẻ dựng tx tự đúc), thay vì liệt
/// kê thứ phải vắng mặt — danh sách vắng mặt không bao giờ đóng hết.
pub fn value_is(
  v: Value,
  own: PolicyId,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  lamp_qty: Int,
  token: Int,
) -> Bool {
  let rebuilt =
    assets.from_lovelace(assets.lovelace_of(v))
      |> assets.add(lamp_policy, lamp_name, lamp_qty)
      |> assets.add(own, account_token_name, token)
  rebuilt == v
}

// ── Chữ ký committee ──────────────────────────────────────────────

/// DP-SEED-1 / DP-MINT-1, ngữ nghĩa ĐÚNG như `Distribution/onchain/lib/magiclamp/
/// lampdist/util.ak` ▸ `committee_approved` (spec v0.2 §3b DP-PARAM):
/// khử trùng committee, `|committee| ≤ 16`, `1 ≤ threshold ≤ |unique|`, đếm khoá DUY
/// NHẤT đã ký. Trả False, không abort.
///
/// Vế `threshold ≤ |unique|` bị vế đếm bao hàm (số khoá đã ký ≤ |unique|), nên không
/// ca nào tách được nó ra — giữ để khớp bản gốc, ghi rõ để không ai đếm nó là một chốt
/// có bài canh riêng.
pub fn committee_approved(
  committee: List<ByteArray>,
  threshold: Int,
  signatories: List<ByteArray>,
) -> Bool {
  let uniq = list.unique(committee)
  and {
    list.length(committee) <= 16,
    threshold >= 1,
    threshold <= list.length(uniq),
    list.count(uniq, fn(k) { list.has(signatories, k) }) >= threshold,
  }
}

/// DP-PARAM, phần tham số số học. Mọi nhánh gọi TRƯỚC tiên — kể cả nhánh không dùng
/// tới tham số đó (Seed không đọc thời gian), để một bộ tham số hỏng không mở được
/// bất cứ nhánh nào.
pub fn params_ok(ms_per_epoch: Int, window_origin_ms: Int, vest_epochs: Int) -> Bool {
  and {
    ms_per_epoch > 0,
    vest_epochs > 0,
    window_origin_ms >= 0,
  }
}

// ── Thời gian ─────────────────────────────────────────────────────

pub fn get_finite(bt: IntervalBoundType) -> Option<Int> {
  when bt is {
    Finite(s) -> Some(s)
    _ -> None
  }
}

/// `epoch(tx)` (§3): `(lo − window_origin_ms) / ms_per_epoch`, chia sàn.
///
/// - `lo` = cận dưới validity range, PHẢI hữu hạn (−∞ ⇒ fail);
/// - cận dưới mở ⇒ thời điểm sớm nhất là `lo + 1`;
/// - `lo − window_origin_ms ≥ 0` (chặn trên SỐ BỊ CHIA, không trên `lo` thô).
/// Không xét cận trên: `lo` sớm hơn thật chỉ làm `amount` nhỏ đi (§7), và với
/// `MintAccounts` thì `start_epoch ≥ epoch(tx)` càng chặt khi `lo` càng muộn.
pub fn tx_epoch(tx: Transaction, ms_per_epoch: Int, window_origin_ms: Int) -> Int {
  let lower = tx.validity_range.lower_bound
  expect Some(lo_raw) = get_finite(lower.bound_type)
  let lo =
    if lower.is_inclusive {
      lo_raw
    } else {
      lo_raw + 1
    }
  let elapsed = lo - window_origin_ms
  expect elapsed >= 0
  elapsed / ms_per_epoch
}

/// `epoch_pinned(tx)` (§3, bản gốc `pot-vault` ▸ `util.get_epoch_pinned`): như
/// `tx_epoch`, cộng cận trên hữu hạn (mở ⇒ `hi − 1`), `lo ≤ hi`, `hi − lo ≤
/// max_range_ms`, và hai cận cùng cửa sổ. Dùng cho `MintAccounts`: không ghim cận trên
/// thì người dựng lùi `lo` về gốc lưới, đọc ra epoch 0 và mở tài khoản đã nhả sẵn.
pub fn tx_epoch_pinned(
  tx: Transaction,
  ms_per_epoch: Int,
  window_origin_ms: Int,
) -> Int {
  let e = tx_epoch(tx, ms_per_epoch, window_origin_ms)
  let lower = tx.validity_range.lower_bound
  let upper = tx.validity_range.upper_bound
  expect Some(lo_raw) = get_finite(lower.bound_type)
  expect Some(hi_raw) = get_finite(upper.bound_type)
  let lo =
    if lower.is_inclusive {
      lo_raw
    } else {
      lo_raw + 1
    }
  let hi =
    if upper.is_inclusive {
      hi_raw
    } else {
      hi_raw - 1
    }
  expect lo <= hi
  expect hi - lo <= max_range_ms
  expect ( hi - window_origin_ms ) / ms_per_epoch == e
  e
}

/// `vested(E, s, e) =E · min(N, max(0, e − s + 1)) / N`, chia sàn (§3).
pub fn vested(entitlement: Int, start: Int, epoch: Int, n: Int) -> Int {
  let raw = epoch - start + 1
  let k =
    if raw < 0 {
      0
    } else if raw > n {
      n
    } else {
      raw
    }
  entitlement * k / n
}

// ── Output đích gắn thẻ (DP-CLAIM-4, v0.2) ────────────────────────

/// Có ĐÚNG MỘT output với địa chỉ bằng hệt `vault` VÀ datum inline bằng hệt `tag`
/// (Data của `OutputReference` input két đang chi); output đó không ref script, value
/// chỉ ADA + LAMP, và `lamp ≥ amount`.
///
/// Thẻ duy nhất theo từng input ⇒ hai két (hay hai hợp đồng) cùng trả một đích không
/// dùng chung được một output. Output tới vault mà datum khác / không datum thì không
/// được đếm — lọc theo (địa chỉ, thẻ) trước, rồi mới xét hình dạng, để một output
/// trùng thẻ đứng sau vẫn làm danh sách dài 2 và bị từ chối.
pub fn vault_paid(
  outputs: List<Output>,
  vault: Address,
  tag: Data,
  own: PolicyId,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  amount: Int,
) -> Bool {
  let tagged = InlineDatum(tag)
  when
    list.filter(
      outputs,
      fn(o) {
        and {
          o.address == vault,
          o.datum == tagged,
        }
      },
    )
  is {
    [p] -> {
      let paid = lamp_of(p.value, lamp_policy, lamp_name)
      and {
        p.reference_script == None,
        value_is(p.value, own, lamp_policy, lamp_name, paid, 0),
        paid >= amount,
      }
    }
    _ -> False
  }
}

// ── Dựng ca kiểm (mock UTxO/tx) ───────────────────────────────────

pub fn script_address(hash: ByteArray) -> Address {
  Address { payment_credential: Script(hash), stake_credential: None }
}

/// Cùng payment credential, KHÁC stake credential ⇒ Address khác. Ca DUY NHẤT tách
/// được "so địa chỉ đầy đủ" khỏi "so payment credential".
pub fn script_address_staked(hash: ByteArray, stake_pkh: ByteArray) -> Address {
  Address {
    payment_credential: Script(hash),
    stake_credential: Some(Inline(VerificationKey(stake_pkh))),
  }
}

pub fn vk_address(pkh: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(pkh), stake_credential: None }
}

pub fn vk_address_staked(pkh: ByteArray, stake_pkh: ByteArray) -> Address {
  Address {
    payment_credential: VerificationKey(pkh),
    stake_credential: Some(Inline(VerificationKey(stake_pkh))),
  }
}

pub fn mk_output(addr: Address, value: Value, datum: Data) -> Output {
  Output {
    address: addr,
    value,
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

pub fn mk_output_no_datum(addr: Address, value: Value) -> Output {
  Output { address: addr, value, datum: NoDatum, reference_script: None }
}

pub fn mk_input(ref: OutputReference, out: Output) -> Input {
  Input { output_reference: ref, output: out }
}

pub fn mk_ref(ix: Int) -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: ix }
}
