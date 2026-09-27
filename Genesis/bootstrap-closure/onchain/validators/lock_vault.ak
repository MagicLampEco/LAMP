// lock_vault — KHO KHÓA VĨNH VIỄN (endowment principal bất khả rút).
//
// Dùng cho pot Foundation (anh chốt 19/6): LAMP rót vào đây qua A-DEST nằm MÃI MÃI,
// principal KHÔNG bao giờ spend ra được → "luôn có người vận hành", backing cho hệ.
// DAO chỉ hưởng fiat từ MAGIC + bán phần LAMP đến từ ủy thác (KÊNH KHÁC, không phải kho này).
//
// spend luôn trả False → mọi nỗ lực tiêu UTxO ở đây bị validator từ chối → khóa tuyệt đối.
// Cũng dùng làm dist_dest TEST trên Preview (chứng minh A-DEST rót vào kho + bất khả rút).
//
// KHÔNG param → script hash CỐ ĐỊNH (one canonical lock address).

use cardano/transaction.{OutputReference, Transaction}

validator lock_vault {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _ref: OutputReference,
    _self: Transaction,
  ) {
    False
  }

  else(_) {
    fail
  }
}
