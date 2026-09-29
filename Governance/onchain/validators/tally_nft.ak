// Validator — `tally_nft`: policy đúc token xác thực của Tally accumulator.
//
// ┌─ ĐỔI BẢN CHẤT so với v1 ────────────────────────────────────────────────────┐
// │ v1: `tally_nft(genesis_ref, asset_name)` — hạt giống VÀ tên tài sản nằm trong │
// │ apply-param, nên MỖI proposal cần một policy id riêng. Nhưng `tally`, `vote`  │
// │ và `nullifier` đều nhận ĐÚNG MỘT `tally_policy` cho cả pha; một policy mỗi    │
// │ proposal làm ba validator đó phải deploy lại cho từng proposal — tức v1 không │
// │ dựng nổi proposal thứ hai.                                                   │
// │                                                                              │
// │ v2 (`SPEC.md` §v2.5): `tally_nft(phase_tag)` — MỘT policy cho cả pha, hạt     │
// │ giống nằm trong REDEEMER, tên tài sản = `H(seed)`. Tính duy nhất vẫn tuyệt   │
// │ đối vì một `OutputReference` tiêu được đúng một lần trong cả lịch sử chuỗi:  │
// │ hai lượt đúc cùng tên đòi tiêu cùng một UTxO hai lần.                        │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// KHÔNG kiểm ĐÍCH và KHÔNG kiểm datum khởi tạo ở đây — có chủ ý. Policy này không
// phụ thuộc gì (chỉ `phase_tag`), nên nó không biết `tally_script_hash`; biết là
// tạo vòng `tally → governance → tally`. Hai thứ đó do handler mint của
// `governance` kiểm trong CHÍNH giao dịch Open (`governance` có
// `tally_script_hash` trong apply-param).
//
// Hở còn lại, đã khai ở `Governance/SPEC.md`: một token `tally_policy` đúc LẺ
// ngoài giao dịch Open dựng được một Tally UTxO có datum bịa, và nó hút được phiếu
// (cử tri tưởng đó là proposal thật). Nó KHÔNG bao giờ sinh ra một proposal: hạt
// giống đã bị tiêu nên không giao dịch Open nào đúc lại được token cùng tên.
//
// ĐỐT — CẤM hoàn toàn (`else(_) { fail }` + mọi lượng phải là +1): token xác thực
// sống suốt vòng đời Tally; đốt được là phá gốc tin cậy của `power_eff`.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/governance/names.{proposal_id_of}
use magiclamp/governance/util

pub type TallyNftRedeemer {
  MintTally { seed: OutputReference }
}

validator tally_nft(_phase_tag: ByteArray) {
  mint(redeemer: TallyNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    let MintTally { seed } = redeemer
    // ── Tiêu đúng UTxO hạt giống ⇒ tên này đúc được đúng một lần ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == seed })
    // ── Đúng một TÊN tài sản của policy này, tên = H(seed), đúng một đơn vị ──
    expect dict.size(assets.tokens(tx.mint, policy_id)) == 1
    assets.quantity_of(tx.mint, policy_id, proposal_id_of(seed)) == 1
  }

  else(_) {
    fail
  }
}

// ════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════

const tn_policy: PolicyId = #"7a11"

const tag: ByteArray = #"5031"

fn seed() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 5 }
}

fn seed_input() -> Input {
  util.mk_input(
    seed(),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

fn other_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

fn run(tx: Transaction) -> Bool {
  tally_nft.mint(tag, MintTally { seed: seed() }, tn_policy, tx)
}

test tnft_mint_happy() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [other_input(), seed_input()],
      mint: assets.zero
        |> assets.add(tn_policy, proposal_id_of(seed()), 1),
    }
  run(tx)
}

test tnft_without_seed() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [other_input()],
      mint: assets.zero
        |> assets.add(tn_policy, proposal_id_of(seed()), 1),
    }
  expect run(tx)
  True
}

test tnft_wrong_qty() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [seed_input()],
      mint: assets.zero
        |> assets.add(tn_policy, proposal_id_of(seed()), 2),
    }
  expect run(tx)
  True
}

/// Tên tài sản KHÔNG phải `H(seed)`: không có vế này thì một lượt đúc tiêu hạt
/// giống `A` đặt được tên `H(B)` của một hạt giống khác — và `H(B)` là tên mà
/// giao dịch Open của proposal `B` sẽ đòi.
test tnft_ten_khong_phai_bam_hat_giong() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [seed_input()],
      mint: assets.zero |> assets.add(tn_policy, #"abcd", 1),
    }
  expect run(tx)
  True
}

/// Hai TÊN cùng policy trong một lượt đúc.
test tnft_hai_ten_mot_luot() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [seed_input()],
      mint: assets.zero
        |> assets.add(tn_policy, proposal_id_of(seed()), 1)
        |> assets.add(tn_policy, #"abcd", 1),
    }
  expect run(tx)
  True
}

test tnft_dot_tu_choi() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [seed_input()],
      mint: assets.zero
        |> assets.add(tn_policy, proposal_id_of(seed()), -1),
    }
  expect run(tx)
  True
}
