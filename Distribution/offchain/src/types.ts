// LampDistribution offchain types — mirror onchain types.ak (CONTRACT v3 "Capped Drop").
// Mọi giá trị là oildrop. Bất biến: 0 ≤ redeemed ≤ entitlement; vested cộng dồn cap E.
//
//   A(t)    = index + rate_root · (t − epoch)        ← chỉ số CỘNG DỒN, đọc từ beacon
//   A_span  = A(bây giờ) − index_at_start
//   vested  = min(entitlement, √entitlement · A_span)
//   redeemable = vested − redeemed, rồi CẮT NGỌN một lượt (xem `vested.ts`)
//
// v2 dùng `vested = drop_value · drops_per_epoch · elapsed`. Đổi vì `drop_value` đứng
// NGOÀI tổng: hạ nó viết lại toàn bộ quá khứ chứ không chỉ chặn một lần rút.

export interface ClaimAccountDatum {
  owner           : string;  // PKH hex
  entitlement     : bigint;  // E — tổng LAMP được phân bổ (oildrop), cố định khi genesis/claim
  redeemed        : bigint;  // đã nhận tích lũy (oildrop)
  start_epoch     : bigint;  // t0 — GIỮ, chỉ còn dùng cho nhãn/kiểm toán
  drops_per_epoch : bigint;  // GHIM == 1 ở v3 (C-ACC-DPE). Giữ trường, khoá giá trị
  index_at_start  : bigint;  // a₀ — chỉ số beacon CHỤP LÚC MỞ. TRƯỜNG MỚI v3, ở CUỐI
}

/** Chỉ còn 1 beacon tham số: DropParam. Bỏ Randomness/MerkleRoot. */
export type BeaconKind = "DropParam";

export interface BeaconDatum {
  epoch          : bigint;    // cửa sổ lượt post này
  kind           : BeaconKind;
  index          : bigint;    // A tại mốc `epoch` — CỘNG DỒN, CHỈ TĂNG
  rate_root      : bigint;    // w — NGUYÊN THUỶ (W := w², không phải ngược lại)
  trim_num       : bigint;    // κ tử  ┐ tham số CẮT NGỌN — kênh "siết thoải mái"
  trim_den       : bigint;    // κ mẫu ┘ giá trị vận hành 1 / 1000
  speed_policies : string[];  // MÓC MỞ RỘNG — RỖNG ở lượt đúc này (policy id hex)
}

export interface TreasuryDatum {
  committee_hash         : string;  // hex
  outstanding_entitlement : bigint;  // oildrop — sổ cái CÒN NỢ = Σ(entitlement − redeemed).
                                    // Tăng khi grant, GIẢM khi redeem (đi cặp với pool).
                                    // Bất biến on-chain: outstanding_entitlement ≤ pool.
  total_redeemed         : bigint;  // oildrop — ĐÃ PHÁT RA, CHỈ TĂNG. Mẫu số của phép cắt
                                    // ngọn. TRƯỜNG MỚI v3, ở CUỐI.
}
