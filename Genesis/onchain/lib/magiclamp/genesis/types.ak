// LAMP Genesis onchain types — lazy-mint interface contract (CONTRACT §4).
// PHẢI khớp byte-perfect với offchain types.ts/datum.ts (Constr index = thứ tự khai báo).

/// SupplyState — bộ đếm phát hành đơn điệu, ghim bởi thread NFT one-shot (DUY NHẤT).
/// minted_total = dist_minted + reserve_minted ≤ dist_cap + reserve_cap (BẤT BIẾN).
/// dist_cap/reserve_cap KHÔNG đổi qua transition (luật 4). Đơn vị: oil.
///
/// = Constr(0, [int, int, int, int])
pub type SupplyState {
  dist_minted    : Int,
  reserve_minted : Int,
  dist_cap       : Int,
  reserve_cap    : Int,
}

/// Redeemer mint tLAMP — chọn đường mint (khóa quota). KHÔNG nhánh burn (no-burn).
///   DistributionVest = Constr(0, [])  — cộng vào dist_minted (đường Capped Drop, MVP stub).
///   ReserveDraw      = Constr(1, [])  — cộng vào reserve_minted (đường DAO).
pub type TLampMintRedeemer {
  DistributionVest
  ReserveDraw
}

/// Redeemer thread NFT (one-shot) — chỉ MintGenesis. KHÔNG burn (NFT sống suốt đời).
pub type ThreadNftRedeemer {
  MintGenesis
}

/// Redeemer spend SupplyState — chỉ Advance (cho phép tx mint tLAMP đẩy state tiến).
/// Spend hợp lệ ⟺ có mint tLAMP trong tx (luật 5b). Transition ủy quyền tlamp_mint.
pub type SupplyStateRedeemer {
  Advance
}
