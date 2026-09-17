// epochWindow.ts — nhãn epoch và cửa sổ hiệu lực, dạng THUẦN (nhận `nowMs`, không đọc đồng hồ).
//
// BẢN CHÉP CÓ NHÃN — Issue #76. Nguồn: `Genesis/scripts/_epochWindow.ts` (đọc 2026-09-17),
// cùng bài kiểm `Genesis/tests/epochWindow.test.ts`. LẼ RA nên `import` thẳng bản gốc thay vì
// chép, nhưng ranh giới gói chặn đúng NỬA nhu cầu: `Faucet/scripts/*.ts` (chạy runtime qua
// tsx) không có `rootDir` nên import xuyên `../../Genesis/scripts/_epochWindow.js` sạch; còn
// `Faucet/offchain/tsconfig.json` ép `rootDir: ".."` (= `Faucet/`) cho ĐÚNG project chứa bộ
// kiểm (`Faucet/tests/**` qua `Faucet/offchain/vitest.config.ts`) — import xuyên `Genesis/`
// từ đó ném `TS6059 File is not under 'rootDir'` (đo thật khi thử). Vì script runtime VÀ bài
// kiểm phải cùng đọc MỘT nguồn logic (khác nguồn thì bài kiểm không còn đo đúng cái chạy thật),
// nơi duy nhất cả hai phía cùng nạp sạch là bên trong `rootDir` của `Faucet/` — nên đặt ở đây,
// và cả `Faucet/scripts/*.ts` lẫn `Faucet/tests/*.test.ts` đều trỏ về ĐÚNG MỘT tệp này.
//
// LỖ ĐÃ CÓ, ĐỂ LẦN SAU KHÔNG DỰNG LẠI (chép nguyên từ nguồn — xem Issue #76)
// Bản cũ trong Faucet suy nhãn epoch từ `now − 90s` (hoặc `now − 60s`) rồi CHIA LUÔN, không
// kẹp trong cửa sổ hiện tại. 60–90 giây ĐẦU mỗi epoch, phép chia đó trả về nhãn epoch TRƯỚC.
// Nhãn sai đó bị ghi vào `start_epoch` (Reserve, BẤT BIẾN theo Luật 7 `reserve_draw.ak`) hoặc
// `last_epoch` (Reserve/Faucet account) — không sửa lại được sau khi đã ghi.

/** Nhãn epoch của một mốc. KHÔNG lùi trước khi chia — lùi ở đây chỉ đặt sai nhãn. */
export function epochAt(nowMs: number, msPerEpoch: number): bigint {
  if (!(msPerEpoch > 0)) {
    throw new Error(`epochAt: msPerEpoch phải > 0, nhận ${msPerEpoch}`);
  }
  return BigInt(Math.floor(nowMs / msPerEpoch));
}

/**
 * Cửa sổ hiệu lực cho một giao dịch chạy tại `nowMs`. Ba mệnh đề, cả ba đều phải đúng:
 *   · `lo` và `hi` cùng một epoch   — `reserve_draw` Luật 2b ép `hi / mspe == t`;
 *   · `hi > lo`                     — khoảng không rỗng;
 *   · `lo ≤ nowMs ≤ hi`             — khoảng CHỨA thời điểm gửi.
 */
export function windowAt(
  nowMs: number,
  msPerEpoch: number,
): { loMs: number; hiMs: number; t: bigint } {
  const t = epochAt(nowMs, msPerEpoch);
  const windowStart = Number(t) * msPerEpoch;
  // Lùi 60 s cho lệch đồng hồ node/máy dựng, nhưng KẸP trong epoch.
  const loMs = Math.max(nowMs - 60_000, windowStart);
  // Đầu trên = cái SỚM hơn của hết-epoch-trừ-1-ms và `now + WINDOW_TTL_MS`. Không kẹp thì với
  // epoch 5 ngày đầu trên tới gần 5 ngày sau `now`, vượt chân trời dự báo của node (~1,5 ngày)
  // ⇒ PastHorizon — lỗi `demo_reserve_draw_resume.ts` từng gặp (dòng đầu tệp đó).
  const hiMs = Math.min(Number(t + 1n) * msPerEpoch - 1, nowMs + WINDOW_TTL_MS);
  return { loMs, hiMs, t };
}

/** Trần TTL — PHẢI khớp `Genesis/scripts/_epochWindow.ts` ▸ `WINDOW_TTL_MS` (chép 2026-09-17); `Genesis/tests/windowTtlSync.test.ts` đỏ khi lệch. */
export const WINDOW_TTL_MS = 3_600_000;
