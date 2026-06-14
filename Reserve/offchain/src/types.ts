// LAMP Reserve offchain types — mirror onchain lib/magiclamp/reserve/types.ak.
// PHẢI khớp byte-perfect (Constr index = thứ tự khai báo trong types.ak, từ 0).

/** ReserveState — state nhả DEMAND-GATED qua Treasury-pull, trần CỨNG/epoch.
 *  max_per_epoch = total_oil / 1000 (trần cứng, KHÔNG cộng dồn catch-up).
 *  drawn_oil chỉ TĂNG (≤ total_oil); start_epoch + total_oil BẤT BIẾN.
 *  last_epoch ghi epoch draw gần nhất → ép ≤1 draw/epoch (t > last_epoch).
 *  = Constr(0, [int, int, int, int]) */
export interface ReserveState {
  start_epoch : bigint;
  total_oil   : bigint;
  drawn_oil   : bigint;
  last_epoch  : bigint;
}

/** Redeemer spend ReserveState — chỉ Draw=Constr(0,[]). */
export type ReserveRedeemer = "Draw";
