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
  // Bản trước suy cửa sổ từ `lo = now − 60s` chứ không từ `now`, và nó hỏng ở hai dải,
  // đo được (mspe = 432_000_000, biên cửa sổ 100 tại 43_200_000_000):
  //
  //   now = biên + 0       epoch=99   hi >= now?  false     (nhãn của cửa sổ TRƯỚC)
  //   now = biên + 30_000  epoch=99   hi >= now?  false     (hi sớm hơn now 31 giây)
  //   now = biên + 59_999  epoch=99   hi − lo = −999 ms     (khoảng ÂM)
  //   now = cuối − 999     epoch=100  hi >= now?  false
  //
  // Tức 60 giây ĐẦU mỗi cửa sổ trả về một khoảng hiệu lực ĐÃ HẾT HẠN mang nhãn cửa sổ
  // trước — đúng lúc vận hành tự nhiên nhất: chạy post beacon ngay khi cửa sổ mới mở.
  // Xác suất thô 60s/5 ngày không phải xác suất thật, vì lịch "chạy đầu cửa sổ" rơi TRỌN
  // vào dải hỏng.
  if (msPerEpoch <= 0n) {
    throw new Error(`epochWindow: msPerEpoch phải > 0, nhận ${msPerEpoch}`);
  }
  // Cửa sổ suy từ `now`. Đây là đại lượng đúng: nhãn phải nói về cửa sổ mà giao dịch
  // THẬT SỰ chạy trong, không về cửa sổ mà cái đệm đồng hồ rơi vào.
  const epoch = nowMs / msPerEpoch;
  const windowStart = epoch * msPerEpoch;
  // Lùi 60 s cho lệch đồng hồ node/máy dựng — nhưng KẸP trong cửa sổ, không để nó đẩy
  // `lo` sang cửa sổ trước.
  const backdated = nowMs - 60_000n;
  const loMs = backdated > windowStart ? backdated : windowStart;
  // Hết cửa sổ, trừ 1 ms: `get_epoch_strict` ép `hi / mspe == lo / mspe`, mà
  // `(e+1)·mspe` chia ra `e+1`. Bản trước trừ 1000 ms và đó là nguồn của vùng chết ~1 s
  // ở cuối mỗi cửa sổ.
  //
  // Đổi kèm theo, có chủ ý: TTL nay là phần còn lại của cửa sổ chứ không phải 90 giây.
  // Hằng 90 s chép từ `drawWindow` bên Genesis, nơi nó phục vụ một script chạy MỘT MÌNH;
  // ở đây giao dịch cần đủ chữ ký committee mới gửi được, và không luật nào onchain đòi
  // nó ngắn. Không mở rủi ro mới: input đã bị tiêu nên không phát lại được, còn gửi muộn
  // trong CÙNG cửa sổ chính là điều C-BCN-3 cho phép.
  const hiMs = (epoch + 1n) * msPerEpoch - 1n;
  return { loMs, hiMs, epoch };
}
