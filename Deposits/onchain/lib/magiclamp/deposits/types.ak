// Deposits pot onchain types — interface contract (CONTRACT §2,§3; SPEC §1).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).
//
// v1: validator DEPOSITS với 2 nhánh redeemer Deposit / Refund. Pot = custody
// accounting giữ bond HOÀN-LẠI: value đa-asset trong 1 UTxO, mỗi deposit là 1 DÒNG
// SỔ trong datum (KHÔNG mỗi entity 1 UTxO — chống bloat).
//
// v2 (NÂNG CẤP, anh chốt 2026-06-08) — GIỮ mọi bất biến v1, THÊM:
//   1. mintDeposit ĐỘNG: amount KHÔNG cố định, tính từ `DepositParam` beacon
//      (governance, reference input) theo (asset_type, value_tier, lifecycle_class).
//      Validator ĐỌC beacon + ÉP amount khớp lịch — KHÔNG tin client mớm amount
//      (mẫu PriceParam của ConsumeMAGIC).
//   2. Creator-refund: depositor = người TẠO (DID); hoàn về người tạo, độc lập ví
//      người sở hữu cuối (đã là ngữ nghĩa v1 — giữ).
//   3. Escheat: DID mồ côi (không đóng vòng đời sau escheat_after) → deposit về
//      Treasury/Reserve (chống kẹt vốn vĩnh viễn). Redeemer mới `Escheat`.
//
// Khác Treasury: dòng sổ khóa theo (entity_id, depositor, asset) — vì refund phải
// về ĐÚNG người gửi; refund/escheat XÓA dòng (chống double). Treasury khóa theo
// (bucket, asset) và không xóa dòng.

use cardano/address.{Credential}
use cardano/transaction.{OutputReference}

/// Một dòng cọc trong sổ pot. Khóa = (entity_id, depositor, policy, name).
/// amount > 0 luôn (refund/escheat xóa dòng, không để dòng 0). ADA: policy=#"" name=#"".
/// v2: lưu classification (value_tier, lifecycle_class) để AUDIT + lifecycle authority
/// đối chiếu phân loại; amount đã bị ÉP khớp beacon lúc Deposit nên đây là bằng chứng.
pub type DepositLine {
  entity_id       : ByteArray,   // AssetDID con vật/cây / nhóm / hợp đồng
  depositor       : ByteArray,   // pkh người TẠO — người DUY NHẤT được hoàn (creator-refund)
  policy          : ByteArray,   // asset (LAMP); #"" = lovelace
  name            : ByteArray,
  amount          : Int,         // số đang khóa (> 0) — ÉP khớp DepositParam beacon
  epoch           : Int,         // epoch gửi (mốc tính escheat_after)
  asset_type      : Int,         // loại tài sản (con vật / cây / nhóm / hợp đồng …)
  value_tier      : Int,         // bậc giá trị (thấp → cao)
  lifecycle_class : Int,         // lớp vòng đời (ngắn → dài)
}

/// Asset được nhận (đa thuê bao). Chỉ dùng (policy, name).
pub type AssetKey {
  policy : ByteArray,
  name   : ByteArray,
}

// ── DepositParam beacon (governance — reference input, mẫu PriceParam) ───────
//
// Bảng phí cọc do DAO chỉnh. 1 hàng = 1 (asset_type, value_tier, lifecycle_class)
// → base_deposit (đơn vị oil của asset bond, vd LAMP 1e6/đơn vị). Tài sản giá trị
// THẤP + vòng đời NGẮN (dưa leo) → base_deposit ≈ 0 (min-ADA Cardano đã chống rác);
// giá trị CAO / DÀI (bò, đất, hợp đồng) → base_deposit đáng kể.
//
// Validator Deposit ĐỌC bảng này qua reference input mang NFT xác thực, tra hàng
// khớp 3 khóa, rồi ÉP `amount == base_deposit × mult / Q`. mult là hệ số nhu cầu
// (clamp [m_min,m_max]) cho phép DAO scale toàn bảng mà không sửa từng hàng.

/// Một hàng bảng phí cọc (governance param).
pub type DepositTier {
  asset_type      : Int,
  value_tier      : Int,
  lifecycle_class : Int,
  base_deposit    : Int,   // ≥ 0 (oil) — base_deposit = 0 hợp lệ (cọc ≈ 0)
}

/// Datum beacon DepositParam (reference input — CIP-31, KHÔNG tiêu khi đọc).
///   required(tier) = base_deposit × demand_mult / Q   (Q=1e9, scale BigInt)
/// demand_mult clamp [m_min, m_max] (keeper cập nhật offchain; validator kiểm lại).
/// Bất biến datum: 0 ≤ m_min ≤ demand_mult ≤ m_max; mọi base_deposit ≥ 0; pure BigInt.
pub type DepositParam {
  tiers       : List<DepositTier>,
  demand_mult : Int,
  m_min       : Int,
  m_max       : Int,
  epoch       : Int,
}

/// Datum pot — value bond đa-asset trong UTxO, sổ cọc là dòng trong datum.
/// params (instance_id, accepted_assets, lifecycle_authority, reserved_min_ada,
/// v2: deposit_param_nft_*, treasury_credential, escheat_after_epoch, ms_per_epoch)
/// bảo toàn qua MỌI tx; chỉ ledger + epoch được đổi.
pub type PotDatum {
  instance_id            : ByteArray,         // định danh instance (đa thuê bao)
  accepted_assets        : List<AssetKey>,    // (policy,name) được nhận
  lifecycle_authority    : Credential,        // ai (ngoài depositor) được trigger Refund
  reserved_min_ada       : Int,               // lovelace giữ min-UTxO, KHÔNG ghi sổ
  // v2 params:
  deposit_param_policy      : ByteArray,      // policy NFT xác thực beacon DepositParam
  deposit_param_name        : ByteArray,      // name NFT xác thực beacon DepositParam
  // F3 — script hash của validator deposit_param (địa chỉ beacon HỢP LỆ). Đọc beacon
  // ÉP địa chỉ == Script(hash) này (KHÔNG chỉ tin NFT-qty==1: NFT có thể bị gửi tới UTxO
  // địa chỉ tùy ý mang datum giả). Khóa beacon về đúng validator governance.
  deposit_param_script_hash : ByteArray,
  treasury_credential       : Credential,     // đích escheat (Treasury/Reserve custody)
  escheat_after_epoch    : Int,               // số epoch sau deposit mới được escheat
  ms_per_epoch           : Int,               // POSIX ms / epoch (đổi epoch từ validity range)
  // state:
  ledger                 : List<DepositLine>, // sổ cọc
  epoch                  : Int,               // epoch cập nhật gần nhất
}

/// Redeemer: nạp cọc (Deposit) / hoàn cọc (Refund) / sung công (Escheat).
/// Constr index theo thứ tự khai báo: Deposit=0, Refund=1, Escheat=2.
pub type DepositsRedeemer {
  // NẠP: khóa cọc cho entity → thêm/cộng dồn dòng (depositor PHẢI ký).
  // amount KHÔNG do client quyết — validator ÉP khớp DepositParam beacon (deposit_ref)
  // tra theo (asset_type, value_tier, lifecycle_class).
  Deposit {
    entity_id       : ByteArray,
    depositor       : ByteArray,
    policy          : ByteArray,
    name            : ByteArray,
    asset_type      : Int,
    value_tier      : Int,
    lifecycle_class : Int,
    deposit_ref     : OutputReference,   // beacon DepositParam (reference input)
  }
  // HOÀN: trả TRỌN số dư dòng (entity_id, depositor, asset) về depositor → xóa dòng.
  Refund {
    entity_id : ByteArray,
    depositor : ByteArray,
    policy    : ByteArray,
    name      : ByteArray,
  }
  // SUNG CÔNG: DID mồ côi quá escheat_after → trả value về Treasury → xóa dòng.
  // current_epoch ≥ line.epoch + escheat_after; tiền ÉP về treasury_credential.
  Escheat {
    entity_id : ByteArray,
    depositor : ByteArray,
    policy    : ByteArray,
    name      : ByteArray,
  }
}

/// Redeemer cho beacon DepositParam (committee/keeper post bảng phí mới).
pub type DepositParamRedeemer {
  PostParam
}
