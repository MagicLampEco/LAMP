// SRCL constants — KHỚP onchain (lib/magiclamp/srcl). 1 LAMP = 10^6 oil.
//
// SRCL reward-redirect: tổng 1 tỷ LAMP chia ĐỀU 36 epoch cho delegator theo tỷ
// lệ stake. Phần off-chain (vận hành SPO + thu reward ADA) là thao tác 2 cty;
// phần on-chain = phân phối LAMP per-epoch qua Merkle proof.

/** 1 LAMP = 10^6 oil (decimals 6). Khớp Utils.OIL_PER_LAMP + Distribution. */
export const OIL_PER_LAMP = 1_000_000n;

/** Tổng quỹ SRCL = 1 tỷ LAMP. */
export const SRCL_TOTAL_LAMP = 1_000_000_000n;

/** Tổng quỹ SRCL tính bằng oil = 1e9 × 1e6 = 1e15 oil. */
export const SRCL_TOTAL_OIL = SRCL_TOTAL_LAMP * OIL_PER_LAMP;

/** Số epoch phân phối = 36 (epoch 0..35). */
export const EPOCHS = 36n;

/** Epoch cuối SRCL = 35 (= EPOCHS − 1). Sweep chỉ sau end_epoch. */
export const END_EPOCH = EPOCHS - 1n;

/** Ngân sách LAMP MỖI epoch (oil), chia đều: floor(1e15 / 36) = 27_777_777_777_777 oil
 *  ≈ 27,777,777.78 LAMP. Phần dư (1e15 − 36×budget) gộp vào epoch cuối hoặc sweep. */
export const PER_EPOCH_OIL = SRCL_TOTAL_OIL / EPOCHS;

/** Dư lẻ do chia floor = 1e15 − 36 × PER_EPOCH_OIL (oil). Về epoch cuối / sweep. */
export const REMAINDER_OIL = SRCL_TOTAL_OIL - PER_EPOCH_OIL * EPOCHS;

/** Asset name POOL NFT = "SRCL" (#"5352434c"). Khớp types.pool_nft_name. */
export const POOL_NFT_NAME = "5352434c";

/** ms mỗi epoch — Preview/Preprod = 432_000_000; Mainnet cũng 432_000_000.
 *  Truyền vào SrclDatum.ms_per_epoch (validator quy đổi epoch từ validity_range). */
export const MS_PER_EPOCH_MAINNET = 432_000_000n;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}
