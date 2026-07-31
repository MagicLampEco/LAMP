// SRCL constants — KHỚP onchain (lib/magiclamp/srcl). 1 LAMP = 10^6 oildrop.
//
// SRCL reward-redirect: tổng 360 triệu LAMP (pot SRCL trong bảng 18-pot,
// Papers/pot-catalog.md) chia ĐỀU 36 epoch cho delegator theo tỷ lệ stake.
// Phần off-chain (vận hành SPO + thu reward ADA) là thao tác 2 cty;
// phần on-chain = phân phối LAMP per-epoch qua Merkle proof.

/** 1 LAMP = 10^6 oildrop (decimals 6). Khớp Utils.OILDROP_PER_LAMP + Distribution. */
export const OILDROP_PER_LAMP = 1_000_000n;

/** Tổng quỹ SRCL = 360 triệu LAMP (pot SRCL, bảng 18-pot). */
export const SRCL_TOTAL_LAMP = 360_000_000n;

/** Tổng quỹ SRCL tính bằng oildrop = 3,6e8 × 1e6 = 3,6e14 oildrop. */
export const SRCL_TOTAL_OILDROP = SRCL_TOTAL_LAMP * OILDROP_PER_LAMP;

// ── SCHEMA C — cô lập pot theo chiến dịch + vai (khớp onchain merkle.ak PARAM) ──

/** Tên chiến dịch SRCL (utf8). campaign_id = blake2b_256(tên này). */
export const SRCL_CAMPAIGN_NAME = "LAMP-SRCL-1";

/** campaign_id[32] (hex) = blake2b_256("LAMP-SRCL-1"). BAKE làm PARAM validator.
 *  Giá trị canonical do onchain merkle.ak chốt (test parity_v2_leaf). Off-chain
 *  neo cứng để mọi leaf khớp byte-perfect; test khẳng định = blake2b_256(tên). */
export const SRCL_CAMPAIGN_ID =
  "5286f2c03f9f7c8b4e0d7da40f325ed5ecdc5d3eaf858efaf297aaefa6f1aedd";

/** role[1] SRCL/SPO = 0x04 (spec §1 — CẤM đổi số role). owner leaf = stake key-hash. */
export const ROLE_SPO = 4;

/** Số epoch phân phối = 36 (epoch 0..35). */
export const EPOCHS = 36n;

/** Epoch cuối SRCL = 35 (= EPOCHS − 1). Sweep chỉ sau end_epoch. */
export const END_EPOCH = EPOCHS - 1n;

/** Ngân sách LAMP MỖI epoch (oildrop), chia đều: 3,6e14 / 36 = 10_000_000_000_000 oildrop
 *  = 10.000.000 LAMP chẵn. 360M chia hết 36 nên KHÔNG có dư lẻ. */
export const PER_EPOCH_OILDROP = SRCL_TOTAL_OILDROP / EPOCHS;

/** Dư lẻ do chia floor = 3,6e14 − 36 × PER_EPOCH_OILDROP (oildrop) = 0 (360M ⋮ 36). */
export const REMAINDER_OILDROP = SRCL_TOTAL_OILDROP - PER_EPOCH_OILDROP * EPOCHS;

/** Asset name POOL NFT = "SRCL" (#"5352434c"). Khớp types.pool_nft_name. */
export const POOL_NFT_NAME = "5352434c";

/** ms mỗi epoch — Preview/Preprod = 432_000_000; Mainnet cũng 432_000_000.
 *  Truyền vào SrclDatum.ms_per_epoch (validator quy đổi epoch từ validity_range). */
export const MS_PER_EPOCH_MAINNET = 432_000_000n;

/** LAMP → oildrop. */
export function lampToOildrop(lamp: bigint): bigint {
  return lamp * OILDROP_PER_LAMP;
}
