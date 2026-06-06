// LampDistribution constants — CONTRACT v2 "Capped Drop".
// ALL arithmetic BigInt. Đơn vị oil. 1 LAMP = 10^6 oil.

/** oil mỗi LAMP. */
export const OIL_PER_LAMP = 1_000_000n;

/** MVP drops_per_epoch mặc định (datum field; DAO override per-DID ở v.sau). */
export const DEFAULT_DROPS_PER_EPOCH = 1n;

/**
 * Giá trị genesis gợi ý cho DropParam D (oil/drop) khi committee post beacon đầu.
 * D là THAM SỐ đọc từ beacon, KHÔNG hardcode trong validator — đây chỉ là default tiện dụng.
 */
export const D_GENESIS = 100_000_000n; // 100 LAMP/drop·epoch
