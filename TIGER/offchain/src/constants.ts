// TIGER constants — Early TIGER Delegator pot (retroactive, snapshot TRƯỚC cutoff).
//
// Pot "Early TIGER Deleg 12" = 12.000.000 LAMP (0,03% của 36 tỷ). Phân bổ retroactive
// theo stake tích lũy của delegator qua MỌI snapshot TRƯỚC mốc cắt 18/6 (UTC), rồi
// nhỏ giọt kiểu B (đều N epoch, có cliff) — NGANG cộng đồng, không rút một cục.
//
// Mọi đại lượng tiền = oil (1 LAMP = 10^6 oil). BigInt tuyệt đối (C-OVERFLOW).

/** 1 LAMP = 10^6 oil (decimals 6). Khớp Utils/ISPO/Distribution. */
export const OIL_PER_LAMP = 1_000_000n;

/** Ngân sách pot = 12.000.000 LAMP. */
export const TIGER_TOTAL_LAMP = 12_000_000n;

/** Ngân sách pot tính oil = 12e6 × 1e6 = 1.2e13 oil. */
export const TIGER_TOTAL_OIL = TIGER_TOTAL_LAMP * OIL_PER_LAMP;

/** Pool TIGER (bech32) — nguồn stake để lọc epoch tính entitlement.
 *  Đây là tầng-dữ-liệu (đổi được, không strand LAMP). Có thể override qua env TIGER_POOL_ID. */
export const TIGER_POOL_ID_DEFAULT =
  "pool1q9kwa675j2z53jecrs6pn3fqsc9ypxrsypu5dgu6hammqkagy22";

/** Mốc cắt snapshot: chỉ tính các epoch < CUTOFF_EPOCH (nửa mở, loại chính epoch cắt
 *  để khách quan trước mọi tín hiệu thưởng). Giá trị epoch THẬT điền khi vận hành
 *  (đây là tầng-dữ-liệu, đổi được, không strand LAMP). CHƯA CHỐT: epoch tương ứng 18/6 UTC. */
export const CUTOFF_EPOCH_DEFAULT = 0n;

/** Số epoch nhỏ giọt kiểu B (mặc định 36 ≈ 1 năm, ngang nhịp ISPO). Tầng-tham-số,
 *  DAO/committee đổi được. vested = E·min(1, (t−cliff)/N). */
export const DRIP_EPOCHS_DEFAULT = 36n;

/** drop_value D (oil/đơn-vị-mở) cho beacon dùng CHUNG mọi account TIGER.
 *  Đặt D = 1 oil → độ phân giải mịn nhất; mức mở mỗi epoch = D·drops_per_epoch.
 *  Kiểu B đạt được bằng drops_per_epoch_i = ceil(E_i / N) per-account (xem dripB.ts). */
export const DROP_VALUE_OIL = 1n;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}
