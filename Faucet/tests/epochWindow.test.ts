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
import { epochAt, windowAt, WINDOW_TTL_MS } from "../offchain/src/epochWindow.js";

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
