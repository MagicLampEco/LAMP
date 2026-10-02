// Cửa sổ hiệu lực + nhãn epoch — ba mệnh đề, và mệnh đề thứ ba là mệnh đề từng thiếu.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// `drawWindow`/`epochNow` (`scripts/_reserve_layer2.ts`) chạy ở mọi lượt rút Reserve và chưa
// từng có bài kiểm nào — chúng nằm trong một tệp `import ./config.js`, nên một bài chạm vào
// nó phụ thuộc môi trường. Phần tính do đó đã được tách sang `scripts/_epochWindow.ts` dạng
// thuần (nhận `nowMs`), và đây là bài của nó.
//
// Bài đo BA mệnh đề, cố ý:
//   · `lo` và `hi` cùng một cửa sổ  — mệnh đề validator ép (`reserve_draw` Luật 2b);
//   · `hi > lo`                     — khoảng không rỗng;
//   · `lo ≤ now ≤ hi`               — khoảng CHỨA thời điểm gửi.
// Bản cũ thoả HAI mệnh đề đầu ở MỌI mốc trong khi mệnh đề thứ ba đỏ ở 60 giây đầu mỗi cửa sổ.
// Nên một bài chỉ đo hai mệnh đề đầu xanh trọn vẹn trên cả bản hỏng lẫn bản đúng — nó không
// phân biệt được hai cực, tức nó không kiểm gì.
//
// GỐC CỬA SỔ (Specs/Window/CONTRACT.md v1.0): mọi mốc dưới đây neo vào `ORIGIN` = gốc Mainnet
// THẬT, KHÔNG phải 0. Gốc 0 không phân biệt được bản trừ gốc với bản quên trừ — `ORIGIN` chia
// cho MSPE dư khác 0 (xem ca "gốc không chia hết"), nên bản quên trừ cho nhãn lệch ngay.
import { describe, it, expect } from "vitest";
import {
  epochAt, windowAt, canonicalWindowOrigin, WINDOW_TTL_MS,
} from "../scripts/_epochWindow.js";
import { WINDOW_ORIGIN_MS_BY_NETWORK, CHAIN_TIME_ERRORS } from "../../Utils/src/index.js";

const MSPE = 432_000_000; // 5 ngày
const ORIGIN_BIG = WINDOW_ORIGIN_MS_BY_NETWORK.Mainnet!;
const ORIGIN = Number(ORIGIN_BIG);
const BIEN = ORIGIN + 100 * MSPE; // đầu cửa sổ 100

describe("windowAt — cửa sổ chứa chính thời điểm gửi", () => {
  // Bốn mốc đầu là bốn mốc ĐỎ đo được trên bản cũ. Mốc "giữa cửa sổ" xanh ở CẢ HAI bản nên
  // một mình nó không phân biệt được gì — nó ở đây làm đối chứng, không làm bằng chứng.
  it.each([
    ["mở cửa sổ", BIEN],
    ["+1 ms", BIEN + 1],
    ["+30 s", BIEN + 30_000],
    ["+59,999 s — mốc từng cho khoảng ÂM", BIEN + 59_999],
    ["+60 s — mốc đầu tiên bản cũ đúng", BIEN + 60_000],
    ["giữa cửa sổ (đối chứng)", BIEN + MSPE / 2],
    ["cuối − 1000 ms — vùng chết cũ", BIEN + MSPE - 1_000],
    ["ms cuối cùng của cửa sổ", BIEN + MSPE - 1],
  ])("%s", (_ten, now) => {
    const w = windowAt(now, MSPE, ORIGIN_BIG);
    expect(w.t).toBe(100n);
    expect(Math.floor((w.loMs - ORIGIN) / MSPE)).toBe(Number(w.t));
    expect(Math.floor((w.hiMs - ORIGIN) / MSPE)).toBe(Number(w.t));
    expect(w.hiMs).toBeGreaterThan(w.loMs);
    expect(w.loMs).toBeLessThanOrEqual(now);
    expect(w.hiMs).toBeGreaterThanOrEqual(now);
    // Mệnh đề thứ tư: không vượt chân trời dự báo của node (PastHorizon).
    expect(w.hiMs - now).toBeLessThanOrEqual(WINDOW_TTL_MS);
  });

  it("hi = now + TTL khi cuối cửa sổ còn xa — mốc đỏ trên bản đặt hi ở cuối cửa sổ", () => {
    expect(windowAt(BIEN, MSPE, ORIGIN_BIG).hiMs).toBe(BIEN + WINDOW_TTL_MS);
    expect(windowAt(BIEN + MSPE / 2, MSPE, ORIGIN_BIG).hiMs).toBe(BIEN + MSPE / 2 + WINDOW_TTL_MS);
  });

  it("hi sát cuối cửa sổ khi cửa sổ hết trước TTL — không vắt sang cửa sổ sau", () => {
    const cuoi = ORIGIN + 101 * MSPE;
    expect(windowAt(cuoi - 1_000, MSPE, ORIGIN_BIG).hiMs).toBe(cuoi - 1);
    expect(windowAt(cuoi - WINDOW_TTL_MS, MSPE, ORIGIN_BIG).hiMs).toBe(cuoi - 1);
  });

  it("lo không bị cái đệm 60 s đẩy sang cửa sổ trước", () => {
    expect(windowAt(BIEN, MSPE, ORIGIN_BIG).loMs).toBe(BIEN);
    expect(windowAt(BIEN + 59_999, MSPE, ORIGIN_BIG).loMs).toBe(BIEN);
    expect(windowAt(BIEN + 60_000, MSPE, ORIGIN_BIG).loMs).toBe(BIEN);
    expect(windowAt(BIEN + 60_001, MSPE, ORIGIN_BIG).loMs).toBe(BIEN + 1);
  });
});

describe("epochAt — nhãn là cửa sổ ĐANG chạy", () => {
  it("không lùi trước khi chia", () => {
    expect(epochAt(BIEN, MSPE, ORIGIN_BIG)).toBe(100n);
    expect(epochAt(BIEN - 1, MSPE, ORIGIN_BIG)).toBe(99n);
    expect(epochAt(BIEN + 89_999, MSPE, ORIGIN_BIG)).toBe(100n); // bản cũ lùi 90 s ⇒ trả 99n
  });

  it("msPerEpoch ≤ 0 thì NÉM, không trả về một nhãn vô nghĩa", () => {
    expect(() => epochAt(BIEN, 0, ORIGIN_BIG)).toThrow();
    expect(() => epochAt(BIEN, -1, ORIGIN_BIG)).toThrow();
    expect(() => windowAt(BIEN, 0, ORIGIN_BIG)).toThrow();
  });
});

describe("gốc cửa sổ — bản quên trừ gốc phải ĐỎ ở bài này", () => {
  // Gốc Mainnet KHÔNG chia hết cho MSPE (dư ≠ 0). Hai phép chia cho cùng một mốc thật:
  //   · đúng: `(t − ORIGIN) / MSPE`  → 100
  //   · quên trừ gốc: `t / MSPE`     → 100 + ORIGIN/MSPE (≈ 3486) — lệch hàng nghìn cửa sổ
  // Đây là cặp ca phân biệt được hai cực; ca gốc = 0 xanh ở CẢ HAI nên không kiểm gì.
  it("gốc không chia hết cho MSPE, nên chia thô cho nhãn KHÁC", () => {
    expect(ORIGIN % MSPE).not.toBe(0);
    expect(Math.floor(BIEN / MSPE)).not.toBe(100);
    expect(epochAt(BIEN, MSPE, ORIGIN_BIG)).toBe(100n);
  });

  it("cùng một mốc, hai gốc khác nhau → hai nhãn khác nhau (Mainnet vs Preprod)", () => {
    const pre = canonicalWindowOrigin("Preprod");
    const mai = canonicalWindowOrigin("Mainnet");
    expect(pre).not.toBe(mai);
    // Mainnet bắt đầu SỚM hơn Preprod ⇒ mốc cách gốc Mainnet 7 cửa sổ nằm TRƯỚC gốc Preprod;
    // dùng nhầm gốc Preprod cho mốc Mainnet không cho nhãn khác mà NÉM (WINDOW_BEFORE_ORIGIN).
    expect(epochAt(Number(mai) + 7 * MSPE, MSPE, mai)).toBe(7n);
    expect(() => epochAt(Number(mai) + 7 * MSPE, MSPE, pre)).toThrow(CHAIN_TIME_ERRORS.WINDOW_BEFORE_ORIGIN);
    // Chiều ngược lại: mốc Preprod đo bằng gốc Mainnet ra nhãn KHÁC (lệch hàng trăm cửa sổ).
    expect(epochAt(Number(pre) + 7 * MSPE, MSPE, pre)).toBe(7n);
    expect(epochAt(Number(pre) + 7 * MSPE, MSPE, mai)).not.toBe(7n);
  });

  it("canonicalWindowOrigin: Preview và mạng lạ NÉM (fail-closed), Mainnet/Preprod trả gốc của Utils", () => {
    expect(canonicalWindowOrigin("Mainnet")).toBe(ORIGIN_BIG);
    expect(() => canonicalWindowOrigin("Preview")).toThrow(CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED);
    expect(() => canonicalWindowOrigin("Custom")).toThrow(CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED);
  });

  it("mốc TRƯỚC gốc thì NÉM — không đoán một nhãn âm", () => {
    expect(() => epochAt(ORIGIN - 1, MSPE, ORIGIN_BIG)).toThrow(CHAIN_TIME_ERRORS.WINDOW_BEFORE_ORIGIN);
  });
});
