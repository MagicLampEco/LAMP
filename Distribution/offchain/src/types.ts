// LampDistribution offchain types — mirror onchain types.ak (CONTRACT v2 "Capped Drop").
// Mọi giá trị là oildrop. Bất biến: 0 ≤ redeemed ≤ entitlement; vested cộng dồn cap E.
//   vested(t) = min(entitlement, D · drops_per_epoch · max(0, t − start_epoch))
//   redeemable = vested − redeemed

export interface ClaimAccountDatum {
  owner           : string;  // PKH hex
  entitlement     : bigint;  // E — tổng LAMP được phân bổ (oildrop), cố định khi genesis/claim
  redeemed        : bigint;  // đã nhận tích lũy (oildrop)
  start_epoch     : bigint;  // t0
  drops_per_epoch : bigint;  // MVP = 1 (DAO chỉnh per-DID ở v.sau)
}

/** Chỉ còn 1 beacon tham số: DropParam{D}. Bỏ Randomness/MerkleRoot. */
export type BeaconKind = "DropParam";

export interface BeaconDatum {
  epoch      : bigint;
  kind       : BeaconKind;
  drop_value : bigint;  // D (oildrop/drop) — số LAMP mở khoá mỗi drop·epoch
}

export interface TreasuryDatum {
  committee_hash : string;  // hex
}
