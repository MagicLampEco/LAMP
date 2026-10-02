// _epochWindow.ts — nhãn epoch và cửa sổ hiệu lực, dạng THUẦN (nhận `nowMs`, không đọc đồng hồ).
//
// VÌ SAO TÁCH RA KHỎI `_reserve_layer2.ts`
// Hai hàm này từng nằm trong đó và không có bài kiểm nào — không phải vì ai quên, mà vì
// `_reserve_layer2.ts` `import ./config.js`, và một bài kiểm chạm vào nó thì phụ thuộc môi
// trường (xem lý lẽ ở `tests/floorLabel.test.ts`). Nên chúng nằm ở nơi KHÔNG THỂ kiểm được
// bằng phép kiểm, và cái lỗ ở dưới sống suốt thời gian đó.
//
// LỖ ĐÃ CÓ, ĐỂ LẦN SAU KHÔNG DỰNG LẠI
// Bản cũ suy nhãn epoch từ `lo = now − 60s` chứ không từ `now`. Hệ quả đo được (mspe =
// 432.000.000 ms, biên epoch 100 tại 43.200.000.000):
//
//   mốc              t    lo<=now  now<=hi
//   mở cửa sổ        99   true     FALSE
//   +30 s            99   true     FALSE
//   +59,999 s        99   true     FALSE      (hi − lo = −999 ms: khoảng ÂM)
//   cuối − 1 ms      100  true     FALSE      (vùng chết do trừ 1000 ms)
//
// Tức 60 giây ĐẦU mỗi epoch trả về một khoảng ĐÃ HẾT HẠN mang nhãn epoch TRƯỚC. Xác suất
// thô 60 s / 5 ngày không phải xác suất thật: lịch vận hành tự nhiên nhất — chạy ngay khi
// cửa sổ mới mở — rơi TRỌN vào dải hỏng.
//
// Và mệnh đề mà bản cũ thoả ở mọi mốc là `lo` và `hi` cùng một epoch. Đó là mệnh đề
// validator ép, nên nó trông như mệnh đề cần đo; mệnh đề THIẾU là `lo ≤ now ≤ hi`.

import {
  windowBounds, windowIndex, windowOriginMs as utilsWindowOriginMs, ChainTimeError, CHAIN_TIME_ERRORS,
  type Network as UtilsNetwork,
} from "../../Utils/src/index.js";

// ── GỐC CỬA SỔ (Specs/Window/CONTRACT.md v1.0) ───────────────────────────────
// Cửa sổ = `(t − window_origin_ms) / ms_per_epoch`, KHÔNG phải `t / ms_per_epoch`: 15 validator
// nay nhận `window_origin_ms` làm tham số CUỐI, và phép chia thô lệch vài cửa sổ so với nhãn
// on-chain. Số đo ở khối "LỖ ĐÃ CÓ" phía trên dùng gốc 0 cho dễ đọc; mọi mốc thật cộng thêm gốc.
// Phép tính viết ở MỘT nơi — `Utils/src/index.ts` ▸ `windowBounds`; tệp này chỉ thêm phần riêng
// của giao dịch (lùi `lo` cho lệch đồng hồ, kẹp `hi` bằng TTL).

/**
 * `window_origin_ms` cho một mạng của tầng script. Nhận `string` vì `Network` của lucid có thêm
 * "Custom" mà Utils không có — Custom không có gốc xác định nên NÉM, giống Preview
 * (Utils ▸ `windowOriginMs`, WIN-PREVIEW). Đây là chỗ DUY NHẤT ở Genesis đổi tên mạng thành gốc.
 */
export function canonicalWindowOrigin(network: string): bigint {
  if (network !== "Preview" && network !== "Preprod" && network !== "Mainnet") {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED,
      `mạng "${network}" không có window_origin_ms (Specs/Window/CONTRACT.md §4) — từ chối đoán`,
    );
  }
  return utilsWindowOriginMs(network as UtilsNetwork);
}

/** Nhãn cửa sổ của một mốc. KHÔNG lùi trước khi chia — lùi ở đây chỉ đặt sai nhãn. */
export function epochAt(nowMs: number, msPerEpoch: number, windowOriginMs: bigint): bigint {
  if (!(msPerEpoch > 0)) {
    throw new Error(`epochAt: msPerEpoch phải > 0, nhận ${msPerEpoch}`);
  }
  return windowIndex(BigInt(Math.floor(nowMs)), windowOriginMs, BigInt(msPerEpoch));
}

/**
 * Cửa sổ hiệu lực cho một giao dịch chạy tại `nowMs`. Ba mệnh đề, cả ba đều phải đúng:
 *   · `lo` và `hi` cùng một cửa sổ  — `reserve_draw` Luật 2b ép `(hi − o) / mspe == t`;
 *   · `hi > lo`                     — khoảng không rỗng;
 *   · `lo ≤ nowMs ≤ hi`             — khoảng CHỨA thời điểm gửi.
 */
export function windowAt(
  nowMs: number,
  msPerEpoch: number,
  windowOriginMs: bigint,
): { loMs: number; hiMs: number; t: bigint } {
  if (!(msPerEpoch > 0)) {
    throw new Error(`windowAt: msPerEpoch phải > 0, nhận ${msPerEpoch}`);
  }
  const b = windowBounds(BigInt(Math.floor(nowMs)), windowOriginMs, BigInt(msPerEpoch));
  // Lùi 60 s cho lệch đồng hồ node/máy dựng, nhưng KẸP trong cửa sổ.
  const loMs = Math.max(nowMs - 60_000, Number(b.startMs));
  // Đầu trên = cái SỚM hơn trong hai mốc:
  //   · hết cửa sổ trừ 1 ms (`b.endMs = o + (t+1)·mspe − 1`) — `o + (t+1)·mspe` chia ra `t+1`,
  //     nên đầu trên phải nhỏ hơn nó ít nhất 1;
  //   · `now + WINDOW_TTL_MS` — node không quy đổi được slot vượt chân trời dự báo (~1,5 ngày
  //     trên Preprod) và từ chối giao dịch có script với lỗi PastHorizon. Lỗi này đã xảy ra
  //     thật một lần (`Faucet/scripts/demo_reserve_draw_resume.ts`, dòng đầu tệp). Bản trước
  //     đặt đầu trên ở cuối cửa sổ — với cửa sổ 5 ngày là tới gần 5 ngày sau `now`.
  const hiMs = Math.min(Number(b.endMs), nowMs + WINDOW_TTL_MS);
  return { loMs, hiMs, t: b.epoch };
}

/** Trần TTL của một giao dịch: 1 giờ — đủ gom chữ ký, cách xa chân trời dự báo ~1,5 ngày. */
export const WINDOW_TTL_MS = 3_600_000;
