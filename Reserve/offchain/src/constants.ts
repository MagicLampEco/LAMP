// LAMP Reserve constants — mirror onchain (oil units).

/** 1 LAMP = 10^6 oil. */
export const OIL_PER_LAMP = 1_000_000n;

/** asset name LAMP — testnet "tLAMP" (hex). Param hóa onchain (lamp_name).
 *  Mainnet đổi sang "LAMP" = "4c414d50". Khớp Genesis constants.tlamp_name. */
export const TLAMP_NAME = "744c414d50";

/** Số epoch tối thiểu để cạn pot khi nhả liên tục đúng trần (math.release_epochs). */
export const RELEASE_EPOCHS = 1000n;

/** Cap Reserve = 7.899 tỷ LAMP × 10^6 = 7_899_000_000_000_000 oil (allocation v3).
 *  Chia chẵn cho RELEASE_EPOCHS → trần epoch là số nguyên (dư 0). */
export const RESERVE_TOTAL_OIL = 7_899_000_000_000_000n;

/** Trần CỨNG nhả mỗi epoch = RESERVE_TOTAL_OIL / 1000 = 7_899_000_000_000 oil. */
export const MAX_PER_EPOCH = RESERVE_TOTAL_OIL / RELEASE_EPOCHS;
