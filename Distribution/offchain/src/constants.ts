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

/** Asset-name hex treasury authenticity NFT — PHẢI khớp onchain util.treasury_nft_name. */
export const TREASURY_NFT_ASSET_NAME = "54525359"; // "TRSY"

/** Biên của D — PHẢI khớp `onchain/lib/magiclamp/lampdist/constants.ak`, nơi `beacon.ak`
 *  đọc chúng ở C-BCN-4/5. Chép có nhãn: nguồn là tệp `.ak` đó, bản chép này ngày 2026-09-16. */
export const DROP_VALUE_MIN = 10_000_000n;      // 10 LAMP
export const DROP_VALUE_MAX = 10_000_000_000n;  // 10.000 LAMP
export const MAX_DROP_DELTA_Q = 100_000_000n;   // ±10% × Q
export const Q = 1_000_000_000n;

/**
 * Cửa sổ hiệu lực cho một tx PHẢI đóng dấu thời gian — CREATE tài khoản, post beacon.
 * Cả hai đầu rơi cùng một epoch ("Luật 2b", `onchain/lib/.../util.ak` ▸ `get_epoch_strict`).
 *
 * Vì sao cần cả hai đầu, và vì sao bên dựng phải tự kéo đầu trên về: sổ cái nhận tx khi
 * `lower ≤ now ≤ upper`, nên đầu DƯỚI một mình không chứng minh được gì — đặt lùi bao xa
 * cũng hợp lệ. Validator do đó ép hai đầu cùng cửa sổ; cửa sổ mặc định của ví (thường
 * `now + vài giờ`) sẽ VẮT QUA biên epoch vài lần mỗi chu kỳ, và lúc đó tx bị từ chối mà
 * không có gì nói vì sao. Hàm này kéo `hi` về sát cuối epoch đúng ở những lần ấy.
 *
 * Cùng khuôn với `drawWindow` bên Genesis (`scripts/_reserve_layer2.ts`) — ở đó gọi là
 * "Luật 2b" của `reserve_draw`. Hai nơi, một luật; đây là bản của Distribution.
 */
export function epochWindow(
  msPerEpoch: bigint,
  nowMs: bigint = BigInt(Date.now()),
): { loMs: bigint; hiMs: bigint; epoch: bigint } {
  // Lùi 60 s: đồng hồ node và đồng hồ máy dựng không bao giờ khớp tuyệt đối, và lệch
  // theo chiều `lower > now` làm tx bị từ chối là "chưa tới hạn".
  const loMs = nowMs - 60_000n;
  const epoch = loMs / msPerEpoch;
  const defaultHi = loMs + 90_000n;
  const endOfWindow = (epoch + 1n) * msPerEpoch - 1000n;
  const hiMs = defaultHi / msPerEpoch === epoch ? defaultHi : endOfWindow;
  return { loMs, hiMs, epoch };
}
