// LAMP Reserve onchain types — engine nhả LINEAR 1001 epoch (thuần thuật toán).
// PHẢI khớp byte-perfect offchain types.ts/datum.ts (Constr index = thứ tự khai báo, từ 0).

/// ReserveState — state nhả Reserve, ghim bởi reserve thread NFT one-shot (DUY NHẤT).
///
/// FIRST-PRINCIPLES — nhả tất định, không ai tác động:
///   vested(t) = min(total_oil, total_oil * max(0, t - start_epoch) / 1001)
///   draw      = vested(t) - drawn_oil   (≥ 0, đơn điệu tăng theo epoch)
///   drawn_oil chỉ TĂNG; start_epoch + total_oil BẤT BIẾN qua mọi transition.
///   Không committee, không demand_gate — permissionless trigger thuần thuật toán.
///
/// = Constr(0, [int, int, int])
pub type ReserveState {
  start_epoch : Int,
  total_oil   : Int,
  drawn_oil   : Int,
}

/// Redeemer spend ReserveState — chỉ Draw (nhả phần vesting tới hạn qua route ReserveDraw).
/// Spend hợp lệ ⟺ tx mint đúng `draw` tLAMP qua Genesis route ReserveDraw, gửi tới dest.
///   Draw = Constr(0, [])
pub type ReserveRedeemer {
  Draw
}

/// Redeemer mint reserve thread NFT one-shot — chỉ MintReserveThread (đúc DUY NHẤT 1 lần).
///   MintReserveThread = Constr(0, [])
pub type ReserveThreadRedeemer {
  MintReserveThread
}
