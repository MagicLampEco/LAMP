// LAMP Reserve offchain types — mirror onchain lib/magiclamp/reserve/types.ak.
// PHẢI khớp byte-perfect (Constr index = thứ tự khai báo trong types.ak, từ 0).

/** ReserveState — state nhả linear 1001 epoch, ghim bởi reserve thread NFT one-shot.
 *  vested(t) = min(total_oil, total_oil * max(0, t-start_epoch) / 1001).
 *  drawn_oil chỉ TĂNG; start_epoch + total_oil BẤT BIẾN.
 *  = Constr(0, [int, int, int]) */
export interface ReserveState {
  start_epoch : bigint;
  total_oil   : bigint;
  drawn_oil   : bigint;
}

/** Redeemer spend ReserveState — chỉ Draw=Constr(0,[]). */
export type ReserveRedeemer = "Draw";
