// LAMP Reserve constants — mirror onchain (oildrop units).

/** 1 LAMP = 10^6 oildrop. */
export const OILDROP_PER_LAMP = 1_000_000n;

/** asset name LAMP — testnet "tLAMP" (hex). Param hóa onchain (token_name).
 *  Mainnet đổi sang "LAMP" = "4c414d50". Khớp Genesis constants.ttoken_name. */
export const TLAMP_NAME = "744c414d50";

/** Số epoch tối thiểu để cạn pot khi nhả liên tục đúng trần (math.release_epochs). */
export const RELEASE_EPOCHS = 1000n;

/** Cap Reserve = 9,630 tỷ LAMP × 10^6 = 9_630_000_000_000_000 oildrop (allocation v17).
 *  Chia chẵn cho RELEASE_EPOCHS → trần epoch là số nguyên (dư 0). */
export const RESERVE_TOTAL_OILDROP = 9_630_000_000_000_000n;

/** Trần CỨNG nhả mỗi epoch = RESERVE_TOTAL_OILDROP / 1000 = 9_630_000_000_000 oildrop. */
export const MAX_PER_EPOCH = RESERVE_TOTAL_OILDROP / RELEASE_EPOCHS;
