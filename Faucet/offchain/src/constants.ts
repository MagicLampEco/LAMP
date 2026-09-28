// Faucet/tLAMP constants — KHỚP onchain (decimals 6 = oildrop convention Distribution).

import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { msPerEpoch as msPerEpochOf } from "@magiclamp/utils";
import type { Network } from "@magiclamp/utils";

/** 1 LAMP = 10^6 oildrop (decimals 6). Khớp Distribution/constants.ak (q-format oildrop). */
export const OILDROP_PER_LAMP = 1_000_000n;

/** Tổng cung LAMP mainnet = 36 tỷ. tLAMP mint đúng từng này (× OILDROP_PER_LAMP). */
export const TOTAL_SUPPLY_LAMP = 36_000_000_000n;

/** Tổng cung tLAMP tính bằng oildrop = 36e9 × 1e6 = 3.6e16 oildrop. */
export const TOTAL_SUPPLY_OILDROP = TOTAL_SUPPLY_LAMP * OILDROP_PER_LAMP;

/** Asset name "tLAMP" = 744c414d50 (0x74 't' + "LAMP"). Tiền tố "t" để KHÔNG
 * nhầm với LAMP thật (Distribution LAMP_ASSET_NAME = 4c414d50). Khớp onchain. */
export const TLAMP_ASSET_NAME = "744c414d50";

/** LAMP → oildrop. */
export function lampToOildrop(lamp: bigint): bigint {
  return lamp * OILDROP_PER_LAMP;
}

// ══════════════════════════════════════════════════════════════════════════
// FAUCET v2 — self-serve, DID-gated, rate-limited, tự thu hồi.
// Khớp onchain ledger.ak. 1 tLAMP = 10^6 oildrop.
// ══════════════════════════════════════════════════════════════════════════

/** Drip = 1001 tLAMP mỗi claim. */
export const DRIP_LAMP = 1001n;

/** Drip tính bằng oildrop = 1001 × 10^6 = 1_001_000_000. Khớp FaucetConfig.drip_oildrop. */
export const DRIP_OILDROP = DRIP_LAMP * OILDROP_PER_LAMP;

/** Cooldown = 36 epoch giữa 2 claim của cùng 1 chuỗi account. Khớp FaucetConfig.cooldown_epochs. */
export const COOLDOWN = 36n;

/** Reclaim = 1001 epoch idle → account bị thu hồi (đọc mốc `last_touch_epoch`, KHÔNG phải
 * `last_claim_epoch`). v3: đây KHÔNG còn là trường của `FaucetConfig` — trần này nay là hằng
 * COMPILE-TIME on-chain DUY NHẤT (`handlers.reclaim_epochs_const`, `Faucet/onchain/lib/magiclamp/
 * faucet/handlers.ak`). Hằng ở đây là BẢN CHÉP CÓ NHÃN để offchain tự tính "đã đủ idle chưa"
 * TRƯỚC khi dựng tx (reclaimBuilder) — sai giá trị không làm tx pass/fail khác on-chain, chỉ
 * làm phép tính "đã đủ điều kiện chưa" ở tầng offchain sai. */
export const RECLAIM = 1001n;

/** Asset name POOL NFT = "POOL" (504f4f4c). Khớp ledger.pool_nft_name. */
export const POOL_NFT_NAME = "504f4f4c";

/** Tiền tố asset name ACCT NFT = "ACCT" (41434354), 4 byte. KHÔNG còn là toàn bộ asset name:
 * v3 đúc TÊN NEO VÀO DID = prefix ‖ blake2b_224(did_name) (32 byte, đúng trần asset name) — xem
 * `acctName()` dưới. Giữ tên hằng cũ để KHÔNG lay callers hiện có (mọi nơi đang ghép chuỗi
 * "41434354" thủ công là đang dựng SAI asset name ở v3, phải chuyển sang gọi `acctName`). */
export const ACCT_NFT_NAME = "41434354";

/** Trần compile-time cho `FaucetConfig.max_claims_per_window`, ép ở `MintPool` (C-MP-7).
 * Khớp `ledger.max_claims_ceiling`. Datum pool đóng băng vĩnh viễn (C-CFG-1) nên đây là cổng
 * DUY NHẤT còn chặn một con số gõ nhầm ở giây deploy. */
export const MAX_CLAIMS_CEILING = 100n;

/**
 * Asset name ACCT NFT neo vào một DID cụ thể: prefix "ACCT" (4 byte) ‖ blake2b_224(did_name)
 * (28 byte) = 32 byte — đúng trần asset name Cardano. Khớp `ledger.acct_name` on-chain
 * (`crypto.blake2b_224`, digest 28 byte, không salt/key/personal).
 *
 * `did_name` nhận dạng HEX (asset name gốc của DID NFT, cùng khuôn với mọi asset name khác
 * trong SDK này). Ném nếu không phải hex hợp lệ — hình dạng lạ thì NÉM, không đệm.
 *
 * Dùng `@noble/hashes` như `Distribution/offchain/src/accountNft.ts`. Ca kiểm neo hàm này vào
 * vector BLAKE2b-224("") của RFC 7693.
 */
export function acctName(didName: string): string {
  if (!/^[0-9a-fA-F]*$/.test(didName) || didName.length % 2 !== 0) {
    throw new Error(`FAUCET-ACCTNAME-001: did_name phải là hex bytes hợp lệ (độ dài chẵn), nhận '${didName}'`);
  }
  return ACCT_NFT_NAME + bytesToHex(blake2b(hexToBytes(didName), { dkLen: 28 }));
}

/** ms mỗi epoch theo network. Nạp vào validator faucet_pool/faucet_account làm param,
 *  và dùng quy đổi POSIX ms → epoch cho `FaucetAccount.last_epoch`.
 *
 *  KHÔNG khai lại số ở đây — TÁI XUẤT thẳng từ `@magiclamp/utils`. Bản khai cũ tên là
 *  `MS_PER_EPOCH_PREVIEW` nhưng giữ 432_000_000, tức số của Preprod/Mainnet — lệch đúng 5×
 *  trên Preview. Số thật lấy từ `epochLength` trong ShelleyGenesis: Mainnet 432_000 ·
 *  Preprod 432_000 · **Preview 86_400** (slot_length 1s ở cả ba); Preprod soi gương mainnet,
 *  Preview thì không.
 *
 *  Lệch này KHÔNG làm tx fail — off-chain và validator nạp CÙNG một số sai nên mọi check
 *  vẫn pass, chỉ mốc thời gian sai im lặng: trên Preview `COOLDOWN = 36 epoch` hoá 180 ngày
 *  thay vì 36, `RECLAIM = 1001 epoch` hoá 13,7 năm thay vì 2,7. Bỏ hẳn nơi khai thứ hai thì
 *  không còn gì để lệch. */
export { msPerEpoch, MS_PER_EPOCH_BY_NETWORK } from "@magiclamp/utils";

/**
 * Cổng gác TRƯỚC KHI KÝ/DEPLOY: `ms_per_epoch` sắp nạp làm param validator (⇒ nướng vào
 * script hash) hoặc dùng tính `last_epoch` (⇒ nướng vào datum) có khớp mạng đích không.
 * Ném nếu lệch — sau khi ký thì số đã cố định on-chain, và nó lệch im lặng chứ không fail.
 */
export function assertMsPerEpochMatchesNetwork(msPerEpochValue: bigint, network: Network): void {
  const expected = msPerEpochOf(network);
  if (msPerEpochValue !== expected) {
    throw new Error(
      `FAUCET-EPOCH-001: ms_per_epoch=${msPerEpochValue} không khớp mạng ${network} ` +
      `(đúng phải là ${expected}). Nạp số này là khoá sai mốc epoch cho cả pool: ` +
      `cooldown/reclaim lệch ${expected > msPerEpochValue ? "ngắn" : "dài"} đi nhiều lần.`,
    );
  }
}
