// TIGER Airdrop constants — KHỚP onchain ledger.ak. 1 LAMP = 10^6 oil.

/** 1 LAMP = 10^6 oil (decimals 6). Khớp @magiclamp/utils OIL_PER_LAMP. */
export const OIL_PER_LAMP = 1_000_000n;

/** Tổng airdrop TIGER = 0,1 tỷ LAMP = 100_000_000 LAMP (TOKENOMICS §TIGER Airdrop). */
export const AIRDROP_TOTAL_LAMP = 100_000_000n;

/** Tổng airdrop tính bằng oil = 100_000_000 × 10^6 = 1e14 oil. */
export const AIRDROP_TOTAL_OIL = AIRDROP_TOTAL_LAMP * OIL_PER_LAMP;

/** Cửa sổ claim = 360 epoch sau 29/7. Sau đó: chỉ Sweep. */
export const CLAIM_WINDOW_EPOCHS = 360n;

/** Asset name POOL NFT = "APOOL" (#"41504f4f4c"). Khớp ledger.pool_nft_name. */
export const POOL_NFT_NAME = "41504f4f4c";

/** Domain-separation prefix — PHẢI khớp merkle.ak. */
export const LEAF_PREFIX = "00";
export const NODE_PREFIX = "01";

/** ms mỗi epoch theo network — khớp @magiclamp/utils MS_PER_EPOCH_BY_NETWORK.
 *  Preview/Preprod = 1 ngày; Mainnet = 5 ngày. Truyền vào validator làm param. */
export const MS_PER_EPOCH_BY_NETWORK = {
  Preview: 86_400_000n,
  Preprod: 86_400_000n,
  Mainnet: 432_000_000n,
} as const;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}

/** oil → LAMP (làm tròn xuống). */
export function oilToLamp(oil: bigint): bigint {
  return oil / OIL_PER_LAMP;
}
