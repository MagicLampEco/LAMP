// TIGER constants — Early TIGER Delegator pot (retroactive, snapshot TRƯỚC cutoff).
//
// Pot "Early TIGER Deleg 12" = 12.000.000 LAMP (0,03% của 36 tỷ). Phân bổ retroactive
// theo stake tích lũy của delegator qua MỌI snapshot TRƯỚC mốc cắt 18/6 (UTC), rồi
// nhỏ giọt kiểu B (đều N epoch, có cliff) — NGANG cộng đồng, không rút một cục.
//
// Mọi đại lượng tiền = oildrop (1 LAMP = 10^6 oildrop). BigInt tuyệt đối (C-OVERFLOW).

/** 1 LAMP = 10^6 oildrop (decimals 6). Khớp Utils/SRCL/Distribution. */
export const OILDROP_PER_LAMP = 1_000_000n;

/** Ngân sách pot = 12.000.000 LAMP. */
export const TIGER_TOTAL_LAMP = 12_000_000n;

/** Ngân sách pot tính oildrop = 12e6 × 1e6 = 1.2e13 oildrop. */
export const TIGER_TOTAL_OILDROP = TIGER_TOTAL_LAMP * OILDROP_PER_LAMP;

/** Pool TIGER (bech32) — nguồn stake để lọc epoch tính entitlement.
 *  Đây là tầng-dữ-liệu (đổi được, không strand LAMP). Có thể override qua env TIGER_POOL_ID. */
export const TIGER_POOL_ID_DEFAULT =
  "pool1q9kwa675j2z53jecrs6pn3fqsc9ypxrsypu5dgu6hammqkagy22";

/** Mốc cắt snapshot: chỉ tính các epoch < CUTOFF_EPOCH (nửa mở, loại chính epoch cắt
 *  để khách quan trước mọi tín hiệu thưởng). Tầng-dữ-liệu, đổi được, không strand LAMP.
 *
 *  CHỐT = 637. Dẫn giải (đo bằng Koios `epoch_info` ngày 2026-07-30, không suy từ trí nhớ):
 *    epoch 636: … → 2026-06-13 21:44:51 UTC
 *    epoch 637: 2026-06-13 21:44:51 → 2026-06-18 21:44:51 UTC
 *  Ranh giới epoch Cardano ở 21:44:51 UTC, KHÔNG ở nửa đêm. Mốc chủ trương là "18/6 UTC";
 *  đọc theo 18/6 00:00 UTC thì epoch 637 lúc đó CÒN ĐANG CHẠY → epoch hoàn tất cuối cùng
 *  là 636 → cutoff nửa mở = 637. Chọn cách đọc này vì nó bảo thủ hơn: loại một epoch chạy
 *  dở thay vì tính vào. Khớp `LaunchAPI/reference-ui` (đang ghi "epoch < cutoff 637").
 *  Muốn tính CẢ epoch 637 (tức mốc 18/6 21:44:51 UTC) thì đổi thành 638 — nhớ sửa cả UI. */
export const CUTOFF_EPOCH_DEFAULT = 637n;

/** Số epoch nhỏ giọt kiểu B (mặc định 36 ≈ 1 năm, ngang nhịp SRCL). Tầng-tham-số,
 *  DAO/committee đổi được. vested = E·min(1, (t−cliff)/N). */
export const DRIP_EPOCHS_DEFAULT = 36n;

/** drop_value D (oildrop/đơn-vị-mở) cho beacon dùng CHUNG mọi account TIGER.
 *  Đặt D = 1 oildrop → độ phân giải mịn nhất; mức mở mỗi epoch = D·drops_per_epoch.
 *  Kiểu B đạt được bằng drops_per_epoch_i = ceil(E_i / N) per-account (xem dripB.ts). */
export const DROP_VALUE_OILDROP = 1n;

/** LAMP → oildrop. */
export function lampToOildrop(lamp: bigint): bigint {
  return lamp * OILDROP_PER_LAMP;
}
