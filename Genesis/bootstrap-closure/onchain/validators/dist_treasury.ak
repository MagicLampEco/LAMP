// dist_treasury — KHO PHÁT-HÀNH-ĐƯỢC (dist_dest cho A-DEST).
//
// A-DEST ép mọi LAMP mint DistributionVest vào đây. Khác lock_vault (khóa câm),
// kho này CHO PHÉP authority ký để chuyển LAMP ra (phát hành/phân phối) → LAMP lưu thông được.
//
// BOOTSTRAP: authority = 1 pkh (ví bootstrap). Bản THẬT sau: thay bằng claim_account drip
// (permissionless theo vesting) — redeploy module RIÊNG, không strand LAMP.
//
// Param: authority (pkh được quyền rút). spend: đòi authority có trong extra_signatories.

use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction, placeholder}

validator dist_treasury(authority: ByteArray) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _ref: OutputReference,
    self: Transaction,
  ) {
    list.has(self.extra_signatories, authority)
  }

  else(_) {
    fail
  }
}

test releases_with_authority_sig() {
  let tx = Transaction { ..placeholder, extra_signatories: [#"a1"] }
  dist_treasury.spend(#"a1", None, 0, mk_ref(), tx)
}

test rejects_without_sig() {
  let tx = Transaction { ..placeholder, extra_signatories: [#"ff"] }
  !dist_treasury.spend(#"a1", None, 0, mk_ref(), tx)
}

fn mk_ref() -> OutputReference {
  OutputReference { transaction_id: #"00", output_index: 0 }
}
