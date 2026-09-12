// Validator tests cho STAKE CREDENTIAL của kho (S-STK-*) — mock Transaction.
//
// Giá trị của validator này nằm ở chỗ nó TỪ CHỐI, nên bộ kiểm có ít ca dương và phần lớn
// là ca âm, mỗi chốt S-STK-* ít nhất một ca.
//
// KỶ LUẬT DỰNG CA ÂM (mirror migrate_test.ak): mỗi ca âm lệch khỏi ca dương ĐÚNG MỘT chỗ,
// và đầu vào phải PHÂN BIỆT ĐƯỢC hai cực của chốt nó khai — ca xanh ở cả hai cực thì nó
// không kiểm gì. Với S-STK-NET điều đó có nghĩa: ca phải có input đến từ đích, vì không có
// input ấy thì GROSS và NET cho cùng một kết quả.

use aiken/builtin
use aiken/interval
use cardano/address.{Address, Credential, Script, VerificationKey}
use cardano/assets
use cardano/certificate.{
  Certificate, DelegateBlockProduction, DelegateCredential,
  RegisterAndDelegateCredential, RetireFromConstitutionalCommittee,
}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction,
  placeholder}
use treasury_stake

// ── Hằng số test ──────────────────────────────────────────────────────────

/// salt instance (khớp `CustodyDatum.instance_id` của kho).
const instance_id: ByteArray = #"abcd"

/// payment credential của ĐÍCH rút thưởng — một VÍ (VerificationKey).
///
/// Vì sao ví chứ không Script: đích Script bật S-STK-BOOK (kho phải được tiêu bằng
/// `StakeRewardIn`), và mọi ca ở tệp này sẽ chết ở chốt đó trước khi chạm chốt nó khai.
/// Đích VK tắt S-STK-BOOK nên DEST/NET/SUM/ACC đo được riêng từng chốt. Đường đích = kho
/// (Script) và S-STK-BOOK được đo ở `stake_reward_test.ak` ▸ phần TÍCH HỢP, nơi có đủ
/// custody input + redeemer.
const reward_pkh: ByteArray = #"7ec0"

/// một credential BẤT KỲ khác đích — dùng cho ca rút sai đích.
const other_sh: ByteArray = #"badf"

/// stake credential của chính kho (= script hash treasury_stake sau apply).
const stake_sh: ByteArray = #"57ac"

/// một stake credential KHÁC cùng rút trong một tx gộp (ca lỗ-batch).
const stake2_sh: ByteArray = #"57ad"

/// khoá được phép phát certificate.
const admin_pkh: ByteArray = #"a0a0"

/// một khoá khác admin.
const stranger_pkh: ByteArray = #"b0b0"

/// pool id dùng trong certificate delegate.
const pool_id: ByteArray = #"9001"

/// thưởng của ca dương.
const reward: Int = 5_000_000

fn reward_cred() -> Credential {
  VerificationKey(reward_pkh)
}

fn other_cred() -> Credential {
  Script(other_sh)
}

fn stake_cred() -> Credential {
  Script(stake_sh)
}

fn stake2_cred() -> Credential {
  Script(stake2_sh)
}

fn out_to(cred: Credential, lovelace: Int) -> Output {
  Output {
    address: Address { payment_credential: cred, stake_credential: None },
    value: assets.from_lovelace(lovelace),
    datum: NoDatum,
    reference_script: None,
  }
}

fn in_from(cred: Credential, lovelace: Int, ix: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"1111",
      output_index: ix,
    },
    output: out_to(cred, lovelace),
  }
}

/// tx tổng quát: danh sách withdrawal + inputs + outputs.
fn mk_tx(
  ws   : Pairs<Credential, Int>,
  ins  : List<Input>,
  outs : List<Output>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: ins,
    outputs: outs,
    withdrawals: ws,
    validity_range: interval.everything,
  }
}

/// tx một withdrawal của chính kho, không input nào từ đích.
fn tx_single(r: Int, outs: List<Output>) -> Transaction {
  mk_tx([Pair(stake_cred(), r)], [], outs)
}

// ══════════════════════════════════════════════════════════════════════════
// withdraw — S-STK-ACC / S-STK-DEST / S-STK-NET / S-STK-SUM
// ══════════════════════════════════════════════════════════════════════════

/// P1 — thưởng 5 ADA về đúng đích, đúng số → PASS.
test p1_reward_to_dest_ok() {
  let tx = tx_single(reward, [out_to(reward_cred(), reward)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// P2 — đích nhận DƯ (7 > 5) → PASS (điều kiện là ≥, không phải =).
test p2_reward_over_to_dest_ok() {
  let tx = tx_single(reward, [out_to(reward_cred(), 7_000_000)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// N1 — S-STK-DEST: thưởng 5 chảy về credential KHÁC đích → REJECT.
/// Phân biệt hai cực: bỏ phép lọc theo `reward_cred` thì tổng output = 5 ≥ 5 ⇒ ca này
/// pass ⇒ đỏ. Giữ phép lọc thì đích nhận 0 ⇒ reject.
test n1_reward_to_other_cred_rejected() fail {
  let tx = tx_single(reward, [out_to(other_cred(), reward)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// N2 — đích nhận THIẾU (3 < 5), phần chênh rò ra ngoài → REJECT.
test n2_reward_short_to_dest_rejected() fail {
  let tx = tx_single(reward, [out_to(reward_cred(), 3_000_000)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// N3 — S-STK-DEST: KHÔNG output nào tới đích (tiền về ví thường của crank) → REJECT.
test n3_no_output_to_dest_rejected() fail {
  let tx = tx_single(reward, [out_to(VerificationKey(stranger_pkh), reward)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

// ── S-STK-NET: ca GROSS-vs-NET ───────────────────────────────────────────
// Hai ca dưới đây CHỈ khác nhau ở lượng lovelace của output tới đích. Đó là chỗ GROSS và
// NET tách ra: cả hai ca đều có một input 10 ADA đến TỪ đích.

/// P3 — input từ đích 10, output về đích 15 ⇒ NET = 5 ≥ thưởng 5 → PASS.
test p3_net_with_input_from_dest_ok() {
  let tx =
    mk_tx(
      [Pair(stake_cred(), reward)],
      [in_from(reward_cred(), 10_000_000, 0)],
      [out_to(reward_cred(), 15_000_000)],
    )
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// N4 — S-STK-NET: input từ đích 10, output về đích 10 ⇒ NET = 0 < 5 → REJECT.
/// GROSS (10 ≥ 5) sẽ PASS SAI: tiền của chính đích quay vòng làm output, còn 5 ADA thưởng
/// đi vào change của người crank. Đây là ca phân biệt hai cực của S-STK-NET.
test n4_gross_recycle_from_dest_rejected() fail {
  let tx =
    mk_tx(
      [Pair(stake_cred(), reward)],
      [in_from(reward_cred(), 10_000_000, 0)],
      [out_to(reward_cred(), 10_000_000)],
    )
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

// ── S-STK-SUM: lỗ-batch ──────────────────────────────────────────────────

/// P4 — hai reward-account cùng rút 5, đích nhận đúng TỔNG 10 → PASS.
test p4_batch_sum_to_dest_ok() {
  let tx =
    mk_tx(
      [Pair(stake_cred(), reward), Pair(stake2_cred(), reward)],
      [],
      [out_to(reward_cred(), 10_000_000)],
    )
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// N5 — S-STK-SUM: hai account cùng rút 5 nhưng đích chỉ nhận 5 (= MAX, rò 5) → REJECT.
/// Phân biệt hai cực: ép theo phần riêng của account này (5 ≥ 5) thì ca pass ⇒ đỏ.
test n5_batch_only_max_to_dest_rejected() fail {
  let tx =
    mk_tx(
      [Pair(stake_cred(), reward), Pair(stake2_cred(), reward)],
      [],
      [out_to(reward_cred(), reward)],
    )
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

// ── S-STK-ACC ────────────────────────────────────────────────────────────

/// N6 — S-STK-ACC: tx KHÔNG có withdrawal nào → REJECT.
/// Không có chốt này thì Σ withdrawals = 0 và mọi tx đều thoả `net ≥ 0` — handler biến
/// thành cửa luôn-True, dùng được làm chữ ký khống cho bất kỳ tx nào.
test n6_no_withdrawal_rejected() fail {
  let tx = mk_tx([], [], [out_to(reward_cred(), reward)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

/// N7 — S-STK-ACC: tx CÓ withdrawal nhưng của account KHÁC → REJECT.
test n7_other_account_withdrawing_rejected() fail {
  let tx = mk_tx([Pair(stake2_cred(), reward)], [], [out_to(reward_cred(), reward)])
  treasury_stake.treasury_stake.withdraw(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    stake_cred(),
    tx,
  )
}

// ══════════════════════════════════════════════════════════════════════════
// publish — S-STK-CERT-DEREG / S-STK-CERT-SIG
// ══════════════════════════════════════════════════════════════════════════

fn tx_signed_by(signers: List<ByteArray>) -> Transaction {
  Transaction { ..placeholder, extra_signatories: signers }
}

fn delegate_cert() -> Certificate {
  DelegateCredential {
    credential: stake_cred(),
    delegate: DelegateBlockProduction { stake_pool: pool_id },
  }
}

/// `RegisterCredential`/`UnregisterCredential` mang trường kiểu `Never` — kiểu này không
/// có constructor nên KHÔNG viết thẳng được trong Aiken (đây chính là chỗ bản tham chiếu
/// SRCL dừng lại và ghi "không unit-test được"). Dựng qua `Data` rồi ép kiểu thì test
/// được: Constr index theo thứ tự khai báo trong `cardano/certificate.ak` (0 = Register,
/// 1 = Unregister), field 0 = credential, field 1 = `Never`.
///
/// ĐÃ ĐO (không phải suy luận): `Never` trên chuỗi là **Constr 1, không tham số** — cùng
/// biểu diễn với `None` của `Option`, đúng như stdlib mô tả ("luôn được khởi tạo là None").
/// Constr 0 thì `expect cert: Certificate = raw` CRASH, và ca `fail` vẫn xanh vì nó chết ở
/// phép ép kiểu chứ không ở chốt nó mang tên — một ca xanh không kiểm gì.
fn cert_with_never_field(index: Int) -> Certificate {
  let cred_data: Data = builtin.constr_data(1, [builtin.b_data(stake_sh)])
  let never_data: Data = builtin.constr_data(1, [])
  let raw: Data = builtin.constr_data(index, [cred_data, never_data])
  expect cert: Certificate = raw
  cert
}

fn register_cert() -> Certificate {
  cert_with_never_field(0)
}

fn unregister_cert() -> Certificate {
  cert_with_never_field(1)
}

/// P5 — delegate CÓ chữ ký admin → PASS.
test p5_delegate_signed_by_admin_ok() {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    delegate_cert(),
    tx_signed_by([admin_pkh]),
  )
}

/// P6 — register CÓ chữ ký admin → PASS.
test p6_register_signed_by_admin_ok() {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    register_cert(),
    tx_signed_by([admin_pkh]),
  )
}

/// N8 — S-STK-CERT-SIG: delegate KHÔNG có chữ ký nào → REJECT.
/// Đây là ca chặn đúng đường grief: bất kỳ ai trỏ stake của kho sang pool của mình.
test n8_delegate_unsigned_rejected() fail {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    delegate_cert(),
    tx_signed_by([]),
  )
}

/// N9 — S-STK-CERT-SIG: delegate có chữ ký NGƯỜI LẠ (không phải admin) → REJECT.
test n9_delegate_signed_by_stranger_rejected() fail {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    delegate_cert(),
    tx_signed_by([stranger_pkh]),
  )
}

/// N10 — S-STK-CERT-DEREG: deregister DÙ CÓ chữ ký admin vẫn REJECT.
/// Phân biệt hai cực: nếu `UnregisterCredential` rơi vào nhánh đòi chữ ký (thay vì `False`
/// cứng) thì ca này pass ⇒ đỏ. Conway hoàn stake-deposit vào value-pool, mà `withdraw` chỉ
/// ép được phần tương ứng Σ withdrawals ⇒ khoản hoàn chảy vào change của người crank.
test n10_deregister_even_signed_rejected() fail {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    unregister_cert(),
    tx_signed_by([admin_pkh]),
  )
}

/// N11 — danh sách TRẮNG: certificate ngoài register/delegate bị từ chối DÙ có chữ ký
/// admin. Ca P7 ngay dưới là đối chứng, để thấy N11 đỏ vì LOẠI cert chứ không vì thiếu
/// chữ ký.
test n11_unlisted_certificate_rejected() fail {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    RetireFromConstitutionalCommittee {
      constitutional_committee_member: stake_cred(),
    },
    tx_signed_by([admin_pkh]),
  )
}

/// P7 — register-and-delegate CÓ chữ ký admin → PASS (đối chứng cho N11).
test p7_register_and_delegate_signed_ok() {
  treasury_stake.treasury_stake.publish(
    instance_id,
    reward_cred(),
    admin_pkh,
    Void,
    RegisterAndDelegateCredential {
      credential: stake_cred(),
      delegate: DelegateBlockProduction { stake_pool: pool_id },
      deposit: 2_000_000,
    },
    tx_signed_by([admin_pkh]),
  )
}
