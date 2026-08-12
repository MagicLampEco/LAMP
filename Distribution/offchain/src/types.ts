// LampDistribution offchain types — mirror onchain types.ak (CONTRACT v2 "Capped Drop").
// Mọi giá trị là oil. Bất biến: 0 ≤ redeemed ≤ entitlement; vested cộng dồn cap E.
//   vested(t) = min(entitlement, D · drops_per_epoch · max(0, t − start_epoch))
//   redeemable = vested − redeemed

export interface ClaimAccountDatum {
  owner           : string;  // PKH hex
  entitlement     : bigint;  // E — tổng LAMP được phân bổ (oil), cố định khi genesis/claim
  redeemed        : bigint;  // đã nhận tích lũy (oil)
  start_epoch     : bigint;  // t0
  drops_per_epoch : bigint;  // MVP = 1 (DAO chỉnh per-DID ở v.sau)
}

/** Chỉ còn 1 beacon tham số: DropParam{D}. Bỏ Randomness/MerkleRoot. */
export type BeaconKind = "DropParam";

export interface BeaconDatum {
  epoch      : bigint;
  kind       : BeaconKind;
  drop_value : bigint;  // D (oil/drop) — số LAMP mở khoá mỗi drop·epoch
}

export interface TreasuryDatum {
  committee_hash         : string;  // hex
  outstanding_entitlement : bigint;  // oil — sổ cái CÒN NỢ = Σ(entitlement − redeemed).
                                    // Tăng khi grant, GIẢM khi redeem (đi cặp với pool).
                                    // Bất biến on-chain: outstanding_entitlement ≤ pool.
}
