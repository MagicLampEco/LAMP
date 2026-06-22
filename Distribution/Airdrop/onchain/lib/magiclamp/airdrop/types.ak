// Airdrop onchain types — interface contract (§6.2).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).

/// Đăng ký pool (SPO mint registration-NFT). NFT bất biến tại registry script;
/// keeper đọc làm reference input để biết pool nào đủ tư cách nhận phân phối.
/// asset name của NFT == pool_id (1 NFT / pool).
pub type RegistrationDatum {
  pool_id          : ByteArray, // pool id (cũng là asset name NFT)
  reward_owner     : ByteArray, // PKH ví nhận LAMP của SPO (= owner leaf Merkle)
  epoch_registered : Int,       // epoch đăng ký (nhận phân phối TỪ epoch này)
}

pub type RegistryRedeemer {
  // SPO đăng ký pool — mint 1 NFT name=pool_id vào registry script.
  Register
}
