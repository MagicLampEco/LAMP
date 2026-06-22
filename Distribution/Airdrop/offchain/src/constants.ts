// Airdrop constants — pot "Airdrop 20:100" (LAMP-DISTRIBUTION-SPEC §6.2).
//
// Tổng 120.000 nghìn LAMP = 120.000.000 LAMP, phát 5 epoch × 24.000 nghìn/epoch.
// Mỗi epoch chia 20:100 → SPO 4.000 nghìn + Delegator 20.000 nghìn.
//
// Mọi đại lượng tiền = oil (1 LAMP = 10^6 oil). BigInt tuyệt đối (C-OVERFLOW).

/** 1 LAMP = 10^6 oil (decimals 6). Khớp Utils/ETD/ISPO/Distribution. */
export const OIL_PER_LAMP = 1_000_000n;

/** 1 "nghìn LAMP" = 1.000 LAMP (đơn vị spec dùng cho allocation). */
export const LAMP_PER_THOUSAND = 1_000n;

/** Tổng pot = 120.000 nghìn LAMP = 120.000.000 LAMP. */
export const AIRDROP_TOTAL_LAMP = 120_000n * LAMP_PER_THOUSAND; // 120_000_000
export const AIRDROP_TOTAL_OIL = AIRDROP_TOTAL_LAMP * OIL_PER_LAMP;

/** Số epoch phát (5). */
export const AIRDROP_EPOCHS = 5n;

/** Ngân sách mỗi epoch = 24.000 nghìn LAMP = 24.000.000 LAMP. */
export const PER_EPOCH_LAMP = 24_000n * LAMP_PER_THOUSAND; // 24_000_000
export const PER_EPOCH_OIL = PER_EPOCH_LAMP * OIL_PER_LAMP;

/** Tỉ lệ chia mỗi epoch — 20 (SPO) : 100 (Delegator), tổng 120. */
export const SPO_RATIO = 20n;
export const DELEGATOR_RATIO = 100n;
export const TOTAL_RATIO = SPO_RATIO + DELEGATOR_RATIO; // 120

/** Hạn chót đăng ký pool (epoch). Validator từ chối đăng ký sau hạn (§6.2). */
export const REGISTER_DEADLINE_EPOCH_DEFAULT = 4n;

// ── Merkle domain separation (PHẢI khớp byte-perfect onchain merkle.ak; RFC 6962). ──
export const MERKLE_LEAF_PREFIX = 0x00;
export const MERKLE_NODE_PREFIX = 0x01;

/** LAMP → oil. */
export function lampToOil(lamp: bigint): bigint {
  return lamp * OIL_PER_LAMP;
}
