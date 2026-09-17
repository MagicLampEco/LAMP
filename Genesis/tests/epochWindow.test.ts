// Cửa sổ hiệu lực + nhãn epoch — ba mệnh đề, và mệnh đề thứ ba là mệnh đề từng thiếu.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// `drawWindow`/`epochNow` (`scripts/_reserve_layer2.ts`) chạy ở mọi lượt rút Reserve và chưa
// từng có bài kiểm nào — chúng nằm trong một tệp `import ./config.js`, nên một bài chạm vào
// nó phụ thuộc môi trường. Phần tính do đó đã được tách sang `scripts/_epochWindow.ts` dạng
// thuần (nhận `nowMs`), và đây là bài của nó.
//
// Bài đo BA mệnh đề, cố ý:
//   · `lo` và `hi` cùng một epoch  — mệnh đề validator ép (`reserve_draw` Luật 2b);
//   · `hi > lo`                     — khoảng không rỗng;
//   · `lo ≤ now ≤ hi`               — khoảng CHỨA thời điểm gửi.
// Bản cũ thoả HAI mệnh đề đầu ở MỌI mốc trong khi mệnh đề thứ ba đỏ ở 60 giây đầu mỗi epoch.
// Nên một bài chỉ đo hai mệnh đề đầu xanh trọn vẹn trên cả bản hỏng lẫn bản đúng — nó không
// phân biệt được hai cực, tức nó không kiểm gì.
import { describe, it, expect } from "vitest";
import { epochAt, windowAt, WINDOW_TTL_MS } from "../scripts/_epochWindow.js";

const MSPE = 432_000_000; // 5 ngày, neo mốc Unix
const BIEN = 100 * MSPE;  // đầu epoch 100

describe("windowAt — cửa sổ chứa chính thời điểm gửi", () => {
  // Bốn mốc đầu là bốn mốc ĐỎ đo được trên bản cũ. Mốc "giữa epoch" xanh ở CẢ HAI bản nên
  // một mình nó không phân biệt được gì — nó ở đây làm đối chứng, không làm bằng chứng.
  it.each([
    ["mở cửa sổ", BIEN],
    ["+1 ms", BIEN + 1],
    ["+30 s", BIEN + 30_000],
    ["+59,999 s — mốc từng cho khoảng ÂM", BIEN + 59_999],
    ["+60 s — mốc đầu tiên bản cũ đúng", BIEN + 60_000],
    ["giữa epoch (đối chứng)", BIEN + MSPE / 2],
    ["cuối − 1000 ms — vùng chết cũ", BIEN + MSPE - 1_000],
    ["ms cuối cùng của epoch", BIEN + MSPE - 1],
  ])("%s", (_ten, now) => {
    const w = windowAt(now, MSPE);
    expect(w.t).toBe(100n);
    expect(Math.floor(w.loMs / MSPE)).toBe(Number(w.t));
    expect(Math.floor(w.hiMs / MSPE)).toBe(Number(w.t));
    expect(w.hiMs).toBeGreaterThan(w.loMs);
    expect(w.loMs).toBeLessThanOrEqual(now);
    expect(w.hiMs).toBeGreaterThanOrEqual(now);
    // Mệnh đề thứ tư: không vượt chân trời dự báo của node (PastHorizon).
    expect(w.hiMs - now).toBeLessThanOrEqual(WINDOW_TTL_MS);
  });

  it("hi = now + TTL khi cuối epoch còn xa — mốc đỏ trên bản đặt hi ở cuối epoch", () => {
    expect(windowAt(BIEN, MSPE).hiMs).toBe(BIEN + WINDOW_TTL_MS);
    expect(windowAt(BIEN + MSPE / 2, MSPE).hiMs).toBe(BIEN + MSPE / 2 + WINDOW_TTL_MS);
  });

  it("hi sát cuối epoch khi epoch hết trước TTL — không vắt sang epoch sau", () => {
    expect(windowAt(101 * MSPE - 1_000, MSPE).hiMs).toBe(101 * MSPE - 1);
    expect(windowAt(101 * MSPE - WINDOW_TTL_MS, MSPE).hiMs).toBe(101 * MSPE - 1);
  });

  it("lo không bị cái đệm 60 s đẩy sang epoch trước", () => {
    expect(windowAt(BIEN, MSPE).loMs).toBe(BIEN);
    expect(windowAt(BIEN + 59_999, MSPE).loMs).toBe(BIEN);
    expect(windowAt(BIEN + 60_000, MSPE).loMs).toBe(BIEN);
    expect(windowAt(BIEN + 60_001, MSPE).loMs).toBe(BIEN + 1);
  });
});

describe("epochAt — nhãn là epoch ĐANG chạy", () => {
  it("không lùi trước khi chia", () => {
    expect(epochAt(BIEN, MSPE)).toBe(100n);
    expect(epochAt(BIEN - 1, MSPE)).toBe(99n);
    expect(epochAt(BIEN + 89_999, MSPE)).toBe(100n); // bản cũ lùi 90 s ⇒ trả 99n
  });

  it("msPerEpoch ≤ 0 thì NÉM, không trả về một nhãn vô nghĩa", () => {
    expect(() => epochAt(BIEN, 0)).toThrow();
    expect(() => epochAt(BIEN, -1)).toThrow();
    expect(() => windowAt(BIEN, 0)).toThrow();
  });
});
