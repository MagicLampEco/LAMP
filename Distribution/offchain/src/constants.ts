// LampDistribution constants — CONTRACT v2 "Capped Drop".
// ALL arithmetic BigInt. Đơn vị oildrop. 1 LAMP = 10^6 oildrop.

/** oildrop mỗi LAMP. */
export const OILDROP_PER_LAMP = 1_000_000n;

/** MVP drops_per_epoch mặc định (datum field; DAO override per-DID ở v.sau). */
export const DEFAULT_DROPS_PER_EPOCH = 1n;

/**
 * Mốc hiệu chỉnh của `rate_root` (w) — NGUYÊN THUỶ, `W := w²` là dẫn xuất chứ không ngược
 * lại (`Math-Spec.md` v3 §7). w = 77.460 cho tốc độ 6.000,0516 LAMP mỗi cửa sổ ở `√E = 1`.
 */
export const RATE_ROOT_GENESIS = 77_460n;

/** Asset-name hex treasury authenticity NFT — PHẢI khớp onchain util.treasury_nft_name. */
export const TREASURY_NFT_ASSET_NAME = "54525359"; // "TRSY"

/**
 * Cổng fail-closed cho `rate_root` của beacon GENESIS (`scripts/03_genesis.ts`).
 *
 * Hai chốt, HAI ĐẠI LƯỢNG khác nhau — đừng đọc gộp, vì mỗi cái mù đúng chỗ cái kia gác:
 *
 *   1. BIÊN CỨNG `[RATE_ROOT_MIN, RATE_ROOT_MAX]` — chặn ca BẾ TẮC. Genesis ngoài biên thì
 *      KHÔNG lượt post nào sau đó hợp lệ, vĩnh viễn: `beacon.ak` ép đồng thời
 *      `rate_root_out ∈ [min,max]` (C-BCN-5b), `rate_root_out ≥ rate_root_in` (C-BCN-5') và
 *      một bước nới ≤ +10% (C-BCN-5a). `w > max` ⇒ mọi post đứt C-BCN-5b; `w < min/1,1` ⇒
 *      post không với nổi tới sàn trong một bước. Chốt này nay CÓ Ở ON-CHAIN
 *      (`beacon_nft.ak` ▸ C-BCN-GEN-2, thêm 2026-09-26) — bản off-chain giữ lại để người
 *      vận hành thấy lỗi TRƯỚC khi trả phí, không phải để gác.
 *
 *   2. ĐÚNG MỐC HIỆU CHỈNH trên Mainnet — chốt này KHÔNG có ở on-chain và sẽ không bao giờ
 *      có: một genesis nằm TRONG biên mà sai lịch không phá bất biến nào. `RATE_ROOT_MAX` là
 *      w×100, nên một genesis hợp-biên vẫn mở khoá nhanh gấp 100 lần lịch đã chốt
 *      (`Math-Spec.md` v3 §7: w = 77.460 cho pot 6 tỷ chạm `E` ở cửa sổ 1000). Chỉ tài liệu
 *      biết con số đúng, nên chỉ off-chain gác được.
 *
 * Ngoài Mainnet thì vế 2 cố ý MỞ: đổi `rate_root` genesis là đúng cách dựng ca kiểm cho
 * C-BCN-5a/5b trên mạng thử, và trên mạng thử thì bất khả hồi là rẻ.
 */
export function assertGenesisRateRoot(rateRoot: bigint, network: string): void {
  if (rateRoot < RATE_ROOT_MIN || rateRoot > RATE_ROOT_MAX) {
    throw new Error(
      `GEN-V3-002: RATE_ROOT ${rateRoot} ngoài biên [${RATE_ROOT_MIN}, ${RATE_ROOT_MAX}] mà ` +
      `\`beacon.ak\` ép ở C-BCN-5b và \`beacon_nft.ak\` ép ở C-BCN-GEN-2. Genesis đặt ngoài ` +
      `biên thì KHÔNG lượt post nào sau đó hợp lệ — và genesis không undo được.`,
    );
  }
  if (network === "Mainnet" && rateRoot !== RATE_ROOT_GENESIS) {
    throw new Error(
      `GEN-V3-003: Mainnet TỪ CHỐI RATE_ROOT=${rateRoot} — genesis Mainnet phải dùng đúng ` +
      `RATE_ROOT_GENESIS=${RATE_ROOT_GENESIS} (mốc hiệu chỉnh của lịch mở khoá). Biên ` +
      `[${RATE_ROOT_MIN}, ${RATE_ROOT_MAX}] rộng gấp 100 lần mốc đó, nên "trong biên" KHÔNG ` +
      `đủ: một genesis hợp-biên vẫn mở khoá sai lịch, và genesis không undo được. Đổi lịch ` +
      `thật thì đổi RATE_ROOT_GENESIS ở tệp này, qua một vòng chốt.`,
    );
  }
}

/** Biên của `rate_root` — PHẢI khớp `onchain/lib/magiclamp/lampdist/constants.ak`, nơi
 *  `beacon.ak` đọc chúng ở C-BCN-5a/5b. Chép có nhãn: nguồn là tệp `.ak` đó, bản chép
 *  này ngày 2026-09-22 (v3). */
export const RATE_ROOT_MIN = 7_746n;            // w/10
export const RATE_ROOT_MAX = 7_746_000n;        // w×100
export const MAX_RATE_ROOT_DELTA_Q = 100_000_000n; // +10% × Q — CHỈ chiều nới
export const Q = 1_000_000_000n;

/** Sàn cắt ngọn (C-RDM-TRIM-FLOOR) — HẰNG của validator, KHÔNG đọc từ datum nào.
 *  Chép có nhãn: nguồn `constants.ak` ▸ `trim_floor`, bản chép 2026-09-22. */
export const TRIM_FLOOR = 1_000_000_000n;       // 1.000 LAMP

/** Giá trị vận hành của κ = trim_num / trim_den = 1/1000. Đây là TRƯỜNG DATUM, không phải
 *  hằng validator — để ở đây chỉ làm mặc định tiện dụng khi dựng beacon genesis. */
export const TRIM_NUM_GENESIS = 1n;
export const TRIM_DEN_GENESIS = 1_000n;

/** v3 ghim `drops_per_epoch == 1` (C-ACC-DPE). Không còn trần nào để khai: một thừa số
 *  đứng NGOÀI tổng `A_span` mà chỉnh được là đúng thứ CONTRACT §0 cấm. */
export const DROPS_PER_EPOCH_PINNED = 1n;

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
  //
  // Và KẸP bởi `now + WINDOW_TTL_MS`: node không quy đổi được slot vượt chân trời dự báo
  // (~1,5 ngày trên Preprod) và từ chối giao dịch có script với lỗi PastHorizon — đã xảy ra
  // thật một lần (`Faucet/scripts/demo_reserve_draw_resume.ts`, dòng đầu tệp). Bản trước đặt
  // đầu trên ở cuối cửa sổ, tức tới gần 5 ngày sau `now` với cửa sổ 5 ngày. TTL 1 giờ thay vì
  // 90 s như `drawWindow` cũ: giao dịch ở đây cần đủ chữ ký committee mới gửi được.
  const windowEnd = (epoch + 1n) * msPerEpoch - 1n;
  const ttlEnd = nowMs + WINDOW_TTL_MS;
  const hiMs = windowEnd < ttlEnd ? windowEnd : ttlEnd;
  return { loMs, hiMs, epoch };
}

/** Trần TTL của một giao dịch dựng bằng `epochWindow`: 1 giờ. PHẢI khớp
 *  `Genesis/scripts/_epochWindow.ts` ▸ `WINDOW_TTL_MS` (chép có nhãn, 2026-09-17). */
export const WINDOW_TTL_MS = 3_600_000n;
