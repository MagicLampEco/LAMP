// LampDistribution onchain types — interface contract (SPEC §5)
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).

/// Per-wallet account tại claim_account script — CONTRACT v2 "Capped Drop".
/// Mọi giá trị là oildrop. Bất biến: 0 ≤ redeemed ≤ entitlement; vested cộng dồn cap E.
///   vested(t) = min(entitlement, D · drops_per_epoch · max(0, t − start_epoch))
///   redeemable = vested − redeemed
pub type ClaimAccountDatum {
  owner           : ByteArray,   // PKH chủ ví
  entitlement     : Int,         // E — tổng LAMP được phân bổ (cố định khi genesis/claim)
  redeemed        : Int,         // đã nhận tích lũy
  start_epoch     : Int,         // t0
  drops_per_epoch : Int,         // MVP = 1 (DAO chỉnh per-DID ở v.sau)
}

pub type ClaimAccountRedeemer {
  // committee 2/3 confirm activity → entitlement += amount (cấp/tăng phân bổ)
  Claim { amount: Int }
  // user tự tính vested on-chain, rút redeemable = vested − redeemed (permissionless)
  Redeem
}

pub type BeaconKind {
  // tham số drop value D (oildrop/drop) committee/DAO post
  DropParam
}

/// Beacon UTxO do committee post. Authenticity = NFT.
///   DropParam → drop_value D (oildrop) — số LAMP mở khoá mỗi drop·epoch.
pub type BeaconDatum {
  epoch     : Int,
  kind      : BeaconKind,
  drop_value: Int,
}

pub type BeaconRedeemer {
  // committee post giá trị mới cho epoch kế tiếp
  PostBeacon
}

/// Treasury UTxO giữ LAMP pool (QĐ7).
pub type TreasuryDatum {
  committee_hash : ByteArray,
}

pub type TreasuryRedeemer {
  // release LAMP cho các Redeem trong cùng tx
  ReleaseForRedeem
}
