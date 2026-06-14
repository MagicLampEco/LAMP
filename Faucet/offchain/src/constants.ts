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

// ══════════════════════════════════════════════════════════════════════════
// FAUCET v2 — self-serve, DID-gated, rate-limited, tự thu hồi.
// Khớp onchain ledger.ak. 1 tLAMP = 10^6 oil.
// ══════════════════════════════════════════════════════════════════════════

/** Drip = 1001 tLAMP mỗi claim. */
export const DRIP_LAMP = 1001n;

/** Drip tính bằng oil = 1001 × 10^6 = 1_001_000_000. Khớp FaucetConfig.drip_oil. */
export const DRIP_OIL = DRIP_LAMP * OIL_PER_LAMP;

/** Cooldown = 36 epoch giữa 2 claim của cùng 1 DID. Khớp FaucetConfig.cooldown_epochs. */
export const COOLDOWN = 36n;

/** Reclaim = 1001 epoch idle → account bị thu hồi. Khớp FaucetConfig.reclaim_epochs
 * và hằng reclaim_epochs_const của faucet_account.ak. */
export const RECLAIM = 1001n;

/** Asset name POOL NFT = "POOL" (504f4f4c). Khớp ledger.pool_nft_name. */
export const POOL_NFT_NAME = "504f4f4c";

/** Asset name ACCT NFT = "ACCT" (41434354). Khớp ledger.acct_nft_name. */
export const ACCT_NFT_NAME = "41434354";

/** ms mỗi epoch — Preview/Preprod = 5 ngày = 432_000_000 ms (1 epoch = 432000 slot
 * × 1000 ms, 1 slot = 1s). Truyền vào validator faucet_pool/faucet_account làm param. */
export const MS_PER_EPOCH_PREVIEW = 432_000_000n;
