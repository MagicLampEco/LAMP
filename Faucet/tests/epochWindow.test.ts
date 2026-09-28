// Nhãn epoch + cửa sổ hiệu lực dùng ở các script demo Reserve/Faucet V2 — Issue #76.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// `demo_reserve_e2e.ts`/`demo_reserve_draw_resume.ts`/`demo_faucet_v2.ts` từng suy nhãn epoch
// bằng cách LÙI `now` một khoảng (90s hoặc 60s) RỒI MỚI CHIA cho ms/epoch, không kẹp trong cửa
// sổ hiện tại. 60–90 giây ĐẦU mỗi epoch, phép chia đó trả về nhãn epoch TRƯỚC — và nhãn sai đó
// từng bị ghi vào `start_epoch` (Reserve, BẤT BIẾN theo Luật 7 `reserve_draw.ak`) hoặc
// `last_epoch`. Bài này đo đúng ba mốc bắt buộc của Issue #76 (giây 0/59/89 một cửa sổ, và
// cuối cửa sổ − 1ms) trên `Faucet/offchain/src/epochWindow.ts` — bản chép có nhãn của
// `Genesis/scripts/_epochWindow.ts` (lý do chép: `rootDir` của `Faucet/offchain/tsconfig.json`
// chặn import xuyên gói `Genesis/`; xem chú thích đầu tệp nguồn).
import { describe, it, expect } from "vitest";
import {
  epochAt, windowAt, WINDOW_TTL_MS, pinnedEpochWindow, MIN_PINNED_WINDOW_MS,
} from "../offchain/src/epochWindow.js";

const MSPE = 432_000_000; // 5 ngày, neo mốc Unix (cùng hằng số với bài kiểm gốc ở Genesis)
const BIEN = 100 * MSPE;  // đầu cửa sổ epoch 100

describe("epochAt — nhãn epoch tại các mốc BẮT BUỘC của Issue #76", () => {
  // Ba mốc đầu là ba mốc ĐỎ đo được trên công thức cũ `(now − 90_000) / mspe`: cả ba đều nằm
  // trong 90 giây đầu cửa sổ, nên bản cũ chia ra epoch 99 (TRƯỚC) thay vì 100 (HIỆN TẠI).
  it.each([
    ["giây 0 (mở cửa sổ)", BIEN],
    ["giây 59", BIEN + 59_000],
    ["giây 89 — mốc sát biên 90s của công thức cũ", BIEN + 89_000],
    ["cuối cửa sổ − 1 ms", BIEN + MSPE - 1],
  ])("%s → nhãn = cửa sổ HIỆN TẠI (100n)", (_ten, now) => {
    expect(epochAt(now, MSPE)).toBe(100n);
  });

  it("msPerEpoch ≤ 0 thì NÉM, không trả về nhãn vô nghĩa", () => {
    expect(() => epochAt(BIEN, 0)).toThrow();
    expect(() => epochAt(BIEN, -1)).toThrow();
  });
});

describe("windowAt — cửa sổ chứa chính thời điểm gửi, tại các mốc BẮT BUỘC", () => {
  it.each([
    ["giây 0 (mở cửa sổ)", BIEN],
    ["giây 59", BIEN + 59_000],
    ["giây 89 — mốc sát biên 90s của công thức cũ", BIEN + 89_000],
    ["cuối cửa sổ − 1 ms", BIEN + MSPE - 1],
  ])("%s", (_ten, now) => {
    const w = windowAt(now, MSPE);
    // Luật 2b `reserve_draw.ak`: lo & hi cùng một epoch.
    expect(Math.floor(w.loMs / MSPE)).toBe(100);
    expect(Math.floor(w.hiMs / MSPE)).toBe(100);
    expect(w.t).toBe(100n);
    // Khoảng không rỗng, và CHỨA chính thời điểm gửi — mệnh đề bản cũ từng thiếu.
    expect(w.hiMs).toBeGreaterThan(w.loMs);
    expect(w.loMs).toBeLessThanOrEqual(now);
    expect(w.hiMs).toBeGreaterThanOrEqual(now);
    // Không vượt chân trời dự báo của node (PastHorizon).
    expect(w.hiMs - now).toBeLessThanOrEqual(WINDOW_TTL_MS);
  });

  it("hi = now + TTL khi cuối cửa sổ còn xa; = cuối cửa sổ − 1 ms khi cửa sổ hết trước", () => {
    expect(windowAt(BIEN, MSPE).hiMs).toBe(BIEN + WINDOW_TTL_MS);
    expect(windowAt(BIEN + MSPE - 1_000, MSPE).hiMs).toBe(BIEN + MSPE - 1);
  });
});

// ── pinnedEpochWindow — nghĩa vụ off-chain riêng của Faucet v3 (`util.get_epoch_pinned`) ────
// Khác `windowAt`: `lo = now_ms` (KHÔNG lùi cho lệch đồng hồ) và NÉM lỗi có mã khi phần bucket
// còn lại ngắn hơn TTL tối thiểu, thay vì lặng lẽ trả về cửa sổ hẹp. Xem đầu `epochWindow.ts`.
describe("pinnedEpochWindow — lo=now (không lùi), hi kẹp cuối bucket, ném khi bucket cạn", () => {
  it("giữa bucket: lo=now, hi=now+ttl, cùng bucket, chứa now", () => {
    const now = BIEN + 2 * 3_600_000; // 2 giờ sau đầu bucket 5 ngày — còn RẤT nhiều dư
    const w = pinnedEpochWindow(now, MSPE);
    expect(w.loMs).toBe(now);                          // KHÔNG lùi — khác windowAt
    expect(w.hiMs).toBe(now + WINDOW_TTL_MS);
    expect(w.epoch).toBe(100n);
    expect(Math.floor(w.loMs / MSPE)).toBe(Math.floor(w.hiMs / MSPE));
  });

  it("sát biên cuối bucket, còn dư ĐÚNG bằng ngưỡng tối thiểu: KHÔNG ném", () => {
    const now = BIEN + MSPE - 1 - MIN_PINNED_WINDOW_MS; // còn lại đúng minWindowMs tới hết bucket
    const w = pinnedEpochWindow(now, MSPE);
    expect(w.hiMs).toBe(BIEN + MSPE - 1);
    expect(w.hiMs - w.loMs).toBe(MIN_PINNED_WINDOW_MS);
  });

  it("sát biên cuối bucket, còn dư DƯỚI ngưỡng tối thiểu: NÉM lỗi có mã, không tự nới hi", () => {
    const now = BIEN + MSPE - 1 - MIN_PINNED_WINDOW_MS + 1; // thiếu 1ms so với ngưỡng
    expect(() => pinnedEpochWindow(now, MSPE)).toThrow(/FAUCET-WINDOW-001/);
  });

  it("ttl vừa khít bucket (ttl < khoảng cách tới cuối bucket): hi = now+ttl, không kẹp", () => {
    const now = BIEN; // đầu bucket, còn gần trọn 5 ngày
    const ttl = 120_000; // 2 phút — nhỏ hơn nhiều so với phần còn lại của bucket
    const w = pinnedEpochWindow(now, MSPE, ttl);
    expect(w.hiMs).toBe(now + ttl);
    expect(w.hiMs - w.loMs).toBe(ttl);
  });

  it("msPerEpoch <= 0 thì NÉM", () => {
    expect(() => pinnedEpochWindow(BIEN, 0)).toThrow();
    expect(() => pinnedEpochWindow(BIEN, -1)).toThrow();
  });
});
