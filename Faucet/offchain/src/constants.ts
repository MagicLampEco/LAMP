// Faucet/tLAMP constants — KHỚP onchain (decimals 6 = oil convention Distribution).

/** 1 LAMP = 10^6 oil (decimals 6). Khớp Distribution/constants.ak (q-format oil). */
export const OIL_PER_LAMP = 1_000_000n;

/** Tổng cung LAMP mainnet = 36 tỷ. tLAMP mint đúng từng này (× OIL_PER_LAMP). */
export const TOTAL_SUPPLY_LAMP = 36_000_000_000n;

/** Tổng cung tLAMP tính bằng oil = 36e9 × 1e6 = 3.6e16 oil. */
export const TOTAL_SUPPLY_OIL = TOTAL_SUPPLY_LAMP * OIL_PER_LAMP;

/** Asset name "tLAMP" = 744c414d50 (0x74 't' + "LAMP"). Tiền tố "t" để KHÔNG
 * nhầm với LAMP thật (Distribution LAMP_ASSET_NAME = 4c414d50). Khớp onchain. */
export const TLAMP_ASSET_NAME = "744c414d50";

/** Lượng tLAMP mỗi claim = 100 LAMP (như tADA faucet). */
export const CLAIM_LAMP = 100n;

/** 100 LAMP tính bằng oil = 100 × 10^6 = 100_000_000 oil. */
export const CLAIM_AMOUNT_OIL = CLAIM_LAMP * OIL_PER_LAMP;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}
