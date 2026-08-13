// LAMP Genesis offchain types — mirror onchain lib/magiclamp/genesis/types.ak.
// PHẢI khớp byte-perfect (Constr index = thứ tự khai báo trong types.ak).

/** SupplyState — bộ đếm phát hành đơn điệu (oildrop), ghim bởi thread NFT one-shot.
 *  minted_total = dist_minted + reserve_minted ≤ dist_cap + reserve_cap (BẤT BIẾN).
 *  = Constr(0, [int, int, int, int]) */
export interface SupplyState {
  dist_minted    : bigint;
  reserve_minted : bigint;
  dist_cap       : bigint;
  reserve_cap    : bigint;
}

/** Đường mint tLAMP (khóa quota). DistributionVest=Constr(0,[]); ReserveDraw=Constr(1,[]). */
export type MintRoute = "DistributionVest" | "ReserveDraw";

/** Redeemer thread NFT one-shot — chỉ MintGenesis=Constr(0,[]). */
export type ThreadNftRedeemer = "MintGenesis";

/** Redeemer spend SupplyState — chỉ Advance=Constr(0,[]). */
export type SupplyStateRedeemer = "Advance";
