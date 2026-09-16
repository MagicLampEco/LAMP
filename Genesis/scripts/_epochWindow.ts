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
  // Hết epoch trừ 1 ms: `(t+1)·mspe` chia ra `t+1`, nên đầu trên phải nhỏ hơn nó ít nhất 1.
  // Trừ 1000 ms như bản cũ thì mất giây cuối của mỗi epoch mà không mua thêm gì.
  const hiMs = Number(t + 1n) * msPerEpoch - 1;
  return { loMs, hiMs, t };
}
