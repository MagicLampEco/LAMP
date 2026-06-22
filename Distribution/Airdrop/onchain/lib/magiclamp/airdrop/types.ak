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

// ══════════════════════════════════════════════════════════════
// Claim stack — TÁI DÙNG nguyên cơ chế đã audit (LampDistribution lottery).
// Claim permissionless = owner tự redeem bằng Merkle proof của won_cumulative
// đối chiếu MerkleRoot beacon. Committee Claim đặt trần claimed_cumulative
// (= entitlement snapshot xác nhận). redeemed_cumulative cộng dồn ⇒ chống double-redeem.
// ══════════════════════════════════════════════════════════════

/// Per-wallet account tại claim_account script. Mọi giá trị là oil.
/// Bất biến: 0 ≤ redeemed_cumulative ≤ claimed_cumulative.
pub type ClaimAccountDatum {
  owner               : ByteArray, // PKH chủ ví (= owner leaf Merkle)
  claimed_cumulative  : Int,       // trần entitlement committee xác nhận
  redeemed_cumulative : Int,       // tổng đã rút ra ví
  last_claim_epoch    : Int,
}

pub type ClaimAccountRedeemer {
  // committee xác nhận entitlement snapshot → claimed_cumulative += amount
  Claim { amount: Int }
  // user redeem permissionless với Merkle proof của won_cumulative đối chiếu root
  Redeem { won_cumulative: Int, root_epoch: Int, proof: List<ByteArray> }
}

/// Beacon airdrop chỉ post MerkleRoot mỗi epoch (committee).
pub type BeaconKind {
  MerkleRoot
}

pub type BeaconDatum {
  epoch : Int,
  kind  : BeaconKind,
  value : ByteArray, // merkle root (32 bytes)
}

pub type BeaconRedeemer {
  PostBeacon
}

/// Treasury giữ LAMP pool; release đúng delta redeemed cho mỗi Redeem cùng tx.
pub type TreasuryDatum {
  committee_hash : ByteArray,
}

pub type TreasuryRedeemer {
  ReleaseForRedeem
}
