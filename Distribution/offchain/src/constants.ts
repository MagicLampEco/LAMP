// LampDistribution constants — CONTRACT v2 "Capped Drop".
// ALL arithmetic BigInt. Đơn vị oildrop. 1 LAMP = 10^6 oildrop.

/** oildrop mỗi LAMP. */
export const OILDROP_PER_LAMP = 1_000_000n;

/** MVP drops_per_epoch mặc định (datum field; DAO override per-DID ở v.sau). */
export const DEFAULT_DROPS_PER_EPOCH = 1n;

/**
 * Giá trị genesis gợi ý cho DropParam D (oildrop/drop) khi committee post beacon đầu.
 * D là THAM SỐ đọc từ beacon, KHÔNG hardcode trong validator — đây chỉ là default tiện dụng.
 */
export const D_GENESIS = 100_000_000n; // 100 LAMP/drop·epoch

// ── Asset-name hex — MỘT nguồn cho cả offchain lẫn scripts ───────────────────
// Ba hằng dưới đây từng được chép tay ở nhiều tệp. Chép tay kiểu đó hỏng IM LẶNG:
// lúc đổi giá trị, bản chưa đổi vẫn biên dịch, vẫn chạy, và chỉ báo lỗi ở tầng
// validator ("mint fail") — nơi không nói một chữ nào về việc có hai bản hằng.
// Cần giá trị ở chỗ khác thì IMPORT từ đây, đừng gõ lại.

/** Asset-name hex treasury authenticity NFT — PHẢI khớp onchain util.treasury_nft_name. */
export const TREASURY_NFT_ASSET_NAME = "5452454153555259"; // "TREASURY"

/** Asset-name hex beacon DropParam — PHẢI khớp onchain util.beacon_name(DropParam). */
export const DROP_ASSET_NAME = "44524f50"; // "DROP"

/** Asset-name hex token LAMP testnet — khớp token Genesis/Faucet đúc thật. */
export const LAMP_ASSET_NAME = "744c414d50"; // "tLAMP"
