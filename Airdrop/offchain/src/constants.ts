// TIGER Airdrop constants — KHỚP onchain ledger.ak. 1 LAMP = 10^6 oildrop.

/** 1 LAMP = 10^6 oildrop (decimals 6). Khớp @magiclamp/utils OILDROP_PER_LAMP. */
export const OILDROP_PER_LAMP = 1_000_000n;

/** Pot Delegator (∝stake mọi pool) = 100 triệu LAMP. AIRDROP-V2 §Delegator.
 *  LƯU Ý NHÃN: đây là POT DELEGATOR, KHÔNG phải tổng Airdrop. Tổng Airdrop v2 =
 *  SPO 5M + CS 15M + Delegator 100M = 120M. Giữ tên cũ để không vỡ import lịch sử. */
export const AIRDROP_TOTAL_LAMP = 100_000_000n;

/** Tổng airdrop tính bằng oildrop = 100_000_000 × 10^6 = 1e14 oildrop. */
export const AIRDROP_TOTAL_OILDROP = AIRDROP_TOTAL_LAMP * OILDROP_PER_LAMP;

/** Pot Delegator (∝stake mọi pool) = 100 triệu LAMP. AIRDROP-V2 §Delegator. */
export const DELEGATOR_TOTAL_LAMP = 100_000_000n;
/** Pot Delegator tính oildrop = 1e8 × 1e6 = 1e14 oildrop. */
export const DELEGATOR_TOTAL_OILDROP = DELEGATOR_TOTAL_LAMP * OILDROP_PER_LAMP;

/** Pot SPO (SPO = Staking Pool Operator — tư cách pool hợp lệ) = 5 triệu LAMP.
 *  SPO-CS-SPEC §4. Trọng số = stake chảy vào pool của mỗi SPO (∝stake). */
export const SPO_POT_LAMP = 5_000_000n;
/** Pot SPO tính oildrop = 5e6 × 1e6 = 5e12 oildrop. */
export const SPO_POT_OILDROP = SPO_POT_LAMP * OILDROP_PER_LAMP;

/** Pot CS (CS = Community Supporter — người hỗ trợ cộng đồng, đo qua bình chọn
 *  có-trọng-số-stake) = 15 triệu LAMP. SPO-CS-SPEC §4. Chia ∝ stake người bình chọn. */
export const CS_POT_LAMP = 15_000_000n;
/** Pot CS tính oildrop = 15e6 × 1e6 = 1,5e13 oildrop. */
export const CS_POT_OILDROP = CS_POT_LAMP * OILDROP_PER_LAMP;

/** Tổng Airdrop v2 = SPO 5M + CS 15M + Delegator 100M = 120.000.000 LAMP.
 *  SPO:CS = 5:15 = 25:75 (thay tỷ lệ base:CS 30:70 cũ của pot gộp 20M). */
export const AIRDROP_V2_TOTAL_LAMP =
  SPO_POT_LAMP + CS_POT_LAMP + DELEGATOR_TOTAL_LAMP; // = 120_000_000n

/** Pool TIGER (bech32) — pool gợi ý cho delegator đăng ký (mọi pool đều hợp lệ). */
export const TIGER_POOL_ID =
  "pool1q9kwa675j2z53jecrs6pn3fqsc9ypxrsypu5dgu6hammqkagy22";

/** Cửa sổ claim = 360 epoch sau 29/7. Sau đó: chỉ Sweep. */
export const CLAIM_WINDOW_EPOCHS = 360n;

/** Asset name POOL NFT = "APOOL" (#"41504f4f4c"). Khớp ledger.pool_nft_name. */
export const POOL_NFT_NAME = "41504f4f4c";

/** Domain-separation prefix — PHẢI khớp merkle.ak. */
export const LEAF_PREFIX = "00";
export const NODE_PREFIX = "01";

// ── Merkle schema C (v2) — cô lập leaf theo chiến dịch + vai ────────────────
// Nguồn: SCHEMA-MERKLE-V2-Tech-Spec.md §1. campaign_id + role BAKE vào validator
// (PARAM). epoch là param runtime = E_cut (KHÔNG hardcode ở đây).

/** Tên chiến dịch pot Delegator (utf8) — nguồn của campaign_id. */
export const DELEGATOR_CAMPAIGN = "LAMP-Delegator-Airdrop-1";

/** campaign_id = blake2b_256(utf8(DELEGATOR_CAMPAIGN)), hex 32 byte.
 *  Giá trị chuẩn vàng do on-chain (aiken) chốt — off-chain PHẢI khớp byte-perfect. */
export const DELEGATOR_CAMPAIGN_ID =
  "f5beb28d9ac6330b590fd5cc060d7e7fdbe2433130a4f1ffe93bb0deeb72db54";

/** role byte trong leaf. Delegator=1, MCS=2, Engage=3, SPO=4. CẤM đổi số (§1). */
export const ROLE_DELEGATOR = 1;
export const ROLE_MCS = 2;
export const ROLE_ENGAGE = 3;
export const ROLE_SPO = 4;

/** ms mỗi epoch theo network — khớp @magiclamp/utils MS_PER_EPOCH_BY_NETWORK.
 *  Preview/Preprod = 1 ngày; Mainnet = 5 ngày. Truyền vào validator làm param. */
export const MS_PER_EPOCH_BY_NETWORK = {
  Preview: 86_400_000n,
  Preprod: 86_400_000n,
  Mainnet: 432_000_000n,
} as const;

/** LAMP → oildrop. */
export function lampToOildrop(lamp: bigint): bigint {
  return lamp * OILDROP_PER_LAMP;
}

/** oildrop → LAMP (làm tròn xuống). */
export function oildropToLamp(oildrop: bigint): bigint {
  return oildrop / OILDROP_PER_LAMP;
}
