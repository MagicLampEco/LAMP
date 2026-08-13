// LAMP Genesis constants — mirror onchain constants.ak (oildrop units).

export const OILDROP_PER_LAMP = 1_000_000n;

// Asset name LAMP = PARAM của lamp_mint (apply-param lúc deploy), KHÔNG hardcode 1 cái
// vào builder. testnet truyền TLAMP_NAME, mainnet truyền LAMP_NAME. Token = PolicyID +
// AssetName → token_name là param ⇒ policyId KHÁC nhau giữa tLAMP và LAMP (đúng: 2 token
// độc lập). AssetName chỉ là NHÃN; tính DUY NHẤT nằm ở PolicyID (neo bởi genesis_ref).

/** asset name LAMP testnet — "tLAMP" (hex). */
export const TLAMP_NAME = "744c414d50";

/** asset name LAMP mainnet — "LAMP" (hex). */
export const LAMP_NAME = "4c414d50";

/** asset name thread NFT SupplyState — "SUPPLY" (hex). */
export const SUPPLY_NAME = "535550504c59";

/** CAP Distribution: 26,370 tỷ LAMP × 10^6 (oildrop) — khớp allocation v17 (tất cả trừ Reserve). */
export const DIST_CAP_OILDROP = 26_370_000_000_000_000n;

/** CAP Reserve: 9,630 tỷ LAMP × 10^6 (oildrop) — khớp allocation v17 (engine trần E/1000/epoch, Treasury-pull gated, ~1001 epoch). */
export const RESERVE_CAP_OILDROP = 9_630_000_000_000_000n;

/** CAP tổng = 36 tỷ LAMP × 10^6 — BẤT BIẾN. */
export const TOTAL_CAP_OILDROP = 36_000_000_000_000_000n;
