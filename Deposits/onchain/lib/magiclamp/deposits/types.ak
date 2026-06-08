// Deposits pot onchain types — interface contract (CONTRACT §2,§3; SPEC §1).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).
//
// Phạm vi v1: validator DEPOSITS với 2 nhánh redeemer Deposit / Refund.
// Pot = custody accounting giữ bond HOÀN-LẠI: value đa-asset trong 1 UTxO, mỗi
// deposit là 1 DÒNG SỔ trong datum (KHÔNG mỗi entity 1 UTxO — chống bloat).
//
// Khác Treasury: dòng sổ khóa theo (entity_id, depositor, asset) — vì refund phải
// về ĐÚNG người gửi; refund XÓA dòng (chống double-refund). Treasury khóa theo
// (bucket, asset) và không xóa dòng.

use cardano/address.{Credential}

/// Một dòng cọc trong sổ pot. Khóa = (entity_id, depositor, policy, name).
/// amount > 0 luôn (refund xóa dòng, không để dòng 0). ADA: policy=#"" name=#"".
pub type DepositLine {
  entity_id : ByteArray,   // AssetDID con vật/cây / nhóm / hợp đồng
  depositor : ByteArray,   // pkh người bỏ tiền — người DUY NHẤT được hoàn
  policy    : ByteArray,   // asset (LAMP); #"" = lovelace
  name      : ByteArray,
  amount    : Int,         // số đang khóa (> 0)
  epoch     : Int,         // epoch gửi (audit)
}

/// Asset được nhận (đa thuê bao). Chỉ dùng (policy, name).
pub type AssetKey {
  policy : ByteArray,
  name   : ByteArray,
}

/// Datum pot — value bond đa-asset trong UTxO, sổ cọc là dòng trong datum.
/// params (instance_id, accepted_assets, lifecycle_authority, reserved_min_ada)
/// bảo toàn qua mọi tx; chỉ ledger + epoch được đổi.
pub type PotDatum {
  instance_id         : ByteArray,         // định danh instance (đa thuê bao)
  accepted_assets     : List<AssetKey>,    // (policy,name) được nhận
  lifecycle_authority : Credential,        // ai (ngoài depositor) được trigger Refund
  reserved_min_ada    : Int,               // lovelace giữ min-UTxO, KHÔNG ghi sổ
  ledger              : List<DepositLine>, // sổ cọc
  epoch               : Int,               // epoch cập nhật gần nhất
}

/// Redeemer: nạp cọc (Deposit) / hoàn cọc (Refund).
/// Constr index theo thứ tự khai báo: Deposit=0, Refund=1.
pub type DepositsRedeemer {
  // NẠP: khóa amount của asset cho entity → thêm/cộng dồn dòng (depositor PHẢI ký).
  Deposit {
    entity_id : ByteArray,
    depositor : ByteArray,
    policy    : ByteArray,
    name      : ByteArray,
    amount    : Int,
  }
  // HOÀN: trả TRỌN số dư dòng (entity_id, depositor, asset) về depositor → xóa dòng.
  Refund {
    entity_id : ByteArray,
    depositor : ByteArray,
    policy    : ByteArray,
    name      : ByteArray,
  }
}
