// LAMP Reserve onchain types — engine nhả DEMAND-GATED qua Treasury-pull, trần CỨNG/epoch.
// PHẢI khớp byte-perfect offchain types.ts/datum.ts (Constr index = thứ tự khai báo, từ 0).

/// ReserveState — state nhả Reserve, ghim bởi reserve thread NFT one-shot (DUY NHẤT).
///
/// FIRST-PRINCIPLES — Reserve là LỚP ĐỆM SAU CÙNG, nhả demand-gated:
///   Reserve KHÔNG nhả tự động theo thời gian. Mỗi epoch có TRẦN CỨNG:
///     max_per_epoch = total_oildrop / 1000.
///   Treasury "kéo" (pull) qua co-spend authority NFT của nó; Reserve chỉ đòi sự
///   hiện diện auth NFT (logic sàn parked < floor nằm Ở TREASURY, ngoài phạm vi).
///   KHÔNG cộng dồn catch-up: epoch không nhả hết trần / bị gate → dư ở lại pot,
///   nhả ở epoch sau → tổng kéo dài tối thiểu ~1000 epoch (≤1 draw/epoch).
///
///   start_epoch + total_oildrop BẤT BIẾN qua mọi transition.
///   drawn_oildrop chỉ TĂNG (đơn điệu, ≤ total_oildrop).
///   last_epoch ghi epoch của draw gần nhất → ép ≤1 draw/epoch (t > last_epoch).
///
/// = Constr(0, [int, int, int, int])
pub type ReserveState {
  start_epoch : Int,
  total_oildrop   : Int,
  drawn_oildrop   : Int,
  last_epoch  : Int,
}

/// Redeemer spend ReserveState — chỉ Draw (nhả ≤ trần/epoch qua route ReserveDraw).
/// Spend hợp lệ ⟺ tx mint delta tLAMP qua Genesis route ReserveDraw, gửi tới dest,
/// có Treasury-pull auth NFT, t > last_epoch, delta ≤ trần & ≤ pot còn lại.
///   Draw = Constr(0, [])
pub type ReserveRedeemer {
  Draw
}

/// Redeemer mint reserve thread NFT one-shot — chỉ MintReserveThread (đúc DUY NHẤT 1 lần).
///   MintReserveThread = Constr(0, [])
pub type ReserveThreadRedeemer {
  MintReserveThread
}
