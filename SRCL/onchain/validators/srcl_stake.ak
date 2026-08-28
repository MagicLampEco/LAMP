// srcl_stake — SRCL (Staking Reward Contribution Launch) reward-redirect BẢN B.
//
// ─────────────────────────────────────────────────────────────────────────
// MÔ HÌNH (SRCL-Spec §2, anh Aladin chốt bản B 2026-07-07 — trustless, on-chain):
//   Địa chỉ ví SRCL của user = (payment: KHOÁ USER, stake: Script(srcl_stake(DID))).
//   → VỐN GỐC bất-khả-xâm: chỉ khoá payment của user tiêu được ADA gốc.
//   → PHẦN THƯỞNG staking dồn vào reward-account của stake-cred (= script này); mọi
//     Withdraw reward BUỘC chảy về POT đợt Launch (beneficiary). Không ai — kể cả
//     operator — rút reward về ví riêng. Đây là "reward-redirect enforce bằng contract".
//
// APPLY-PARAM PER-DID (mẫu did_payment): `did_hash` salt hoá → mỗi DID một script-hash
//   → một stake-credential riêng → một reward-account riêng → ĐO reward per-DID được
//   (lượng Withdraw của mỗi reward-account = đóng góp của DID đó; feed vào entitlement
//   ∝reward → Merkle root → SetRoot của ispo_pool). Nếu dùng chung 1 script cho mọi
//   user thì reward gộp 1 account → mất khả năng đo per-DID.
//
// ─────────────────────────────────────────────────────────────────────────
// 2 HANDLER (stake-purpose Plutus V3)
//   withdraw : rút reward khỏi reward-account của stake-cred này. BUỘC Σ lovelace các
//              output tới `pot_cred` ≥ reward rút. Permissionless (crank ai cũng chạy;
//              đích BỊ KHOÁ về pot). Vốn gốc không nằm ở đây → không đụng.
//   publish  : chứng nhận uỷ-thác (register / delegate-to-pool / deregister). Cho phép —
//              user tự chọn pool để stake. Reward vẫn bị withdraw-gate ép về pot.
//
// Aiken 1.1.x / stdlib v3 / Plutus V3.

use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/interval
use cardano/address.{Address, Credential, Script, VerificationKey}
use cardano/assets
use cardano/assets.{lovelace_of}
use cardano/certificate.{Certificate, UnregisterCredential}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}

/// Σ lovelace mọi OUTPUT có payment_credential == pot_cred.
fn lovelace_to_cred(outputs: List<Output>, pot_cred: Credential) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o: Output, acc: Int) {
      if o.address.payment_credential == pot_cred {
        acc + lovelace_of(o.value)
      } else {
        acc
      }
    },
  )
}

/// Σ lovelace mọi INPUT đến TỪ pot_cred (Tuân F1: check NET, không GROSS). Nếu tx
/// đồng-tiêu UTxO ở pot (vd ispo_pool ép value-eq) → pot-money quay-vòng làm output
/// → GROSS pass mà net=0, reward chảy về change crank. Trừ input-từ-pot ép reward THẬT.
fn lovelace_from_cred(inputs: List<Input>, pot_cred: Credential) -> Int {
  list.foldl(
    inputs,
    0,
    fn(i: Input, acc: Int) {
      if i.output.address.payment_credential == pot_cred {
        acc + lovelace_of(i.output.value)
      } else {
        acc
      }
    },
  )
}

/// Σ lovelace MỌI withdrawal trong tx. Ép pot ≥ TỔNG này (chống LỖ-BATCH: nếu chỉ
/// ép pot ≥ reward-của-account-này, batch N account → pot nhận max thay vì sum → rò).
/// Bảo thủ: tx trộn withdrawal ngoài-SRCL cũng bị đòi về pot ⟹ chỉ crank thuần SRCL
/// (đường dùng thật) mới qua — an toàn (over-require chỉ gây REJECT, không mất tiền).
fn sum_withdrawals(withdrawals: Pairs<Credential, Int>) -> Int {
  list.foldl(withdrawals, 0, fn(p, acc) { acc + p.2nd })
}

validator srcl_stake(did_hash: ByteArray, pot_cred: Credential) {
  // ─── Withdraw reward → BUỘC về pot ───────────────────────────────────────
  // `account` = stake-credential đang rút (= Script(own hash) của validator này).
  // self.withdrawals mang (account → reward_lovelace). Ép reward tới pot_cred.
  withdraw(_redeemer: Data, account: Credential, self: Transaction) {
    // salt did_hash vào điều kiện (giữ param sống + neo mỗi DID một script-hash).
    expect did_hash != #""
    // account này PHẢI đang được rút (có mặt trong withdrawals).
    expect Some(_reward) = pairs.get_first(self.withdrawals, account)
    // ÉP NET (Tuân F1): (Σ out→pot − Σ in-từ-pot) ≥ Σ reward. Trừ input-từ-pot
    // chống pot-money-quay-vòng (đồng-tiêu ispo_pool value-eq) làm output giả-thoả.
    // Vẫn ép Σ-withdrawals (chống lỗ-batch, đã vá trước).
    lovelace_to_cred(self.outputs, pot_cred) - lovelace_from_cred(
      self.inputs,
      pot_cred,
    ) >= sum_withdrawals(self.withdrawals)
  }

  // ─── Publish cert: register/delegate MỞ, deregister CẤM (Tuân F2) ─────────
  // Vốn gốc = payment-cred user (không thuộc script này). Reward-gate ở withdraw
  // khoá đường reward; uỷ-thác register/delegate để user chọn pool. NHƯNG cấm
  // deregister: Conway UnRegCert hoàn stake-deposit vào value-pool → crank
  // permissionless hốt về change. Cấm hẳn (user không cần deregister trong SRCL).
  publish(_redeemer: Data, certificate: Certificate, _self: Transaction) {
    when certificate is {
      UnregisterCredential { .. } -> False
      _ -> True
    }
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS — reward-redirect (bản B). Dựng Transaction tối thiểu (withdrawals + outputs).
//   P1 reward 5 ADA → pot đủ (≥5) → PASS
//   N1 reward 5 ADA → pot chỉ 3 → REJECT (rò 2 ADA khỏi pot)
//   N2 reward 5 ADA → tới ví KHÁC (không pot) → REJECT
//   P2 reward 5 ADA → pot nhận 7 (dư) → PASS (≥)
// ════════════════════════════════════════════════════════════════════════════

const t_did: ByteArray =
  #"d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0d1d0"

const t_pot_hash: ByteArray =
  #"9070790707907079070790707907079070790707907079070790709c"

const t_other_hash: ByteArray =
  #"badebadebadebadebadebadebadebadebadebadebadebadebadebade"

const t_stake_hash: ByteArray =
  #"57ac57ac57ac57ac57ac57ac57ac57ac57ac57ac57ac57ac57ac57ac"

fn pot_cred() -> Credential {
  Script(t_pot_hash)
}

// stake-credential đang rút = Script(own hash) — dùng làm key withdrawals + account.
fn stake_cred() -> Credential {
  Script(t_stake_hash)
}

fn out_to(cred: Credential, lovelace: Int) -> Output {
  Output {
    address: Address { payment_credential: cred, stake_credential: None },
    value: assets.from_lovelace(lovelace),
    datum: NoDatum,
    reference_script: None,
  }
}

// tx với 1 withdrawal (stake_cred → reward) + danh sách output.
fn mk_tx(reward: Int, outs: List<Output>) -> Transaction {
  Transaction {
    inputs: [],
    reference_inputs: [],
    outputs: outs,
    fee: 0,
    mint: assets.zero,
    certificates: [],
    withdrawals: [Pair(stake_cred(), reward)],
    validity_range: interval.everything,
    extra_signatories: [],
    redeemers: [],
    datums: dict.empty,
    id: #"0000000000000000000000000000000000000000000000000000000000000000",
    votes: [],
    proposal_procedures: [],
    current_treasury_amount: None,
    treasury_donation: None,
  }
}

// input đến TỪ pot_cred (mô phỏng đồng-tiêu UTxO ở pot, vd ispo_pool).
fn pot_input(lovelace: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
      output_index: 0,
    },
    output: out_to(pot_cred(), lovelace),
  }
}

// tx với inputs + 1 withdrawal + outputs.
fn mk_tx_in(reward: Int, ins: List<Input>, outs: List<Output>) -> Transaction {
  Transaction { ..mk_tx(reward, outs), inputs: ins }
}

// P1 — reward 5 ADA, pot nhận đúng 5 → PASS.
test p1_reward_to_pot_ok() {
  let tx = mk_tx(5_000_000, [out_to(pot_cred(), 5_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// P2 — reward 5 ADA, pot nhận 7 (dư) → PASS (≥).
test p2_reward_to_pot_over_ok() {
  let tx = mk_tx(5_000_000, [out_to(pot_cred(), 7_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// N1 — reward 5 ADA nhưng pot chỉ nhận 3 (rò 2) → REJECT.
test n1_reward_short_to_pot_rejected() fail {
  let tx = mk_tx(5_000_000, [out_to(pot_cred(), 3_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// N2 — reward 5 ADA tới ví KHÁC (không pot) → REJECT.
test n2_reward_to_other_rejected() fail {
  let tx = mk_tx(5_000_000, [out_to(Script(t_other_hash), 5_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// N3 — reward 5 ADA, KHÔNG output nào tới pot → REJECT.
test n3_reward_no_pot_output_rejected() fail {
  let tx = mk_tx(5_000_000, [out_to(VerificationKey(t_other_hash), 5_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// ─── LỖ-BATCH: 2 account cùng rút 5 → pot phải nhận TỔNG 10 ──────────────────
const t_stake2_hash: ByteArray =
  #"9070790707907079070790707907079070790707907079070790709d"

fn stake2_cred() -> Credential {
  Script(t_stake2_hash)
}

// tx 2 withdrawal (stake_cred=5, stake2_cred=5) + outputs.
fn mk_tx2(r1: Int, r2: Int, outs: List<Output>) -> Transaction {
  Transaction {
    ..mk_tx(0, outs),
    withdrawals: [Pair(stake_cred(), r1), Pair(stake2_cred(), r2)],
  }
}

// P3 — batch 2×5, pot nhận đúng TỔNG 10 → PASS.
test p3_batch_sum_to_pot_ok() {
  let tx = mk_tx2(5_000_000, 5_000_000, [out_to(pot_cred(), 10_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// N4 — LỖ-BATCH: 2×5 nhưng pot chỉ nhận 5 (= max, rò 5) → REJECT.
test n4_batch_only_max_to_pot_rejected() fail {
  let tx = mk_tx2(5_000_000, 5_000_000, [out_to(pot_cred(), 5_000_000)])
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// ─── F1 (Tuân): check NET, không GROSS ──────────────────────────────────────

// P4 — input pot 10 + output pot 15 (NET 5) + reward 5 → PASS.
test p4_net_input_pot_ok() {
  let tx =
    mk_tx_in(
      5_000_000,
      [pot_input(10_000_000)],
      [out_to(pot_cred(), 15_000_000)],
    )
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// N5 — LỖ-F1: input pot 10 + output pot 10 (quay-vòng, NET 0) + reward 5 → REJECT.
// GROSS cũ (10≥5) PASS sai; NET (10−10=0 ≥ 5) REJECT đúng.
test n5_pot_cycle_gross_leak_rejected() fail {
  let tx =
    mk_tx_in(
      5_000_000,
      [pot_input(10_000_000)],
      [out_to(pot_cred(), 10_000_000)],
    )
  srcl_stake.withdraw(t_did, pot_cred(), Void, stake_cred(), tx)
}

// ─── F2 (Tuân): publish cấm deregister ──────────────────────────────────────
// LƯU Ý: KHÔNG unit-test được — `UnregisterCredential.refund : Never` (bottom-type
// stdlib, không constructible trong test). Fix ở CODE (publish `when` match →
// UnregisterCredential → False); verify bằng review. register/delegate qua `_ -> True`.
