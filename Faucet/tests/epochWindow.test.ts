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
import { WINDOW_ORIGIN_MS_BY_NETWORK } from "@magiclamp/utils";
import {
  epochAt, windowAt, WINDOW_TTL_MS, pinnedEpochWindow, MIN_PINNED_WINDOW_MS,
} from "../offchain/src/epochWindow.js";

const MSPE = 432_000_000; // 5 ngày
// Gốc cửa sổ THẬT của Mainnet (Specs/Window/CONTRACT.md v1.0 §3), KHÔNG phải 0: gốc 0 không phân
// biệt được bản có trừ gốc với bản quên trừ. 1_506_203_091_000 chia MSPE dư 123_091_000, nên
// `t / MSPE` và `(t − ORIGIN) / MSPE` lệch nhau ở MỌI mốc dưới đây.
const ORIGIN = Number(WINDOW_ORIGIN_MS_BY_NETWORK.Mainnet!);
const BIEN = ORIGIN + 100 * MSPE;  // đầu cửa sổ 100

describe("epochAt — nhãn epoch tại các mốc BẮT BUỘC của Issue #76", () => {
  // Ba mốc đầu là ba mốc ĐỎ đo được trên công thức cũ `(now − 90_000) / mspe`: cả ba đều nằm
  // trong 90 giây đầu cửa sổ, nên bản cũ chia ra epoch 99 (TRƯỚC) thay vì 100 (HIỆN TẠI).
  it.each([
    ["giây 0 (mở cửa sổ)", BIEN],
    ["giây 59", BIEN + 59_000],
    ["giây 89 — mốc sát biên 90s của công thức cũ", BIEN + 89_000],
    ["cuối cửa sổ − 1 ms", BIEN + MSPE - 1],
  ])("%s → nhãn = cửa sổ HIỆN TẠI (100n)", (_ten, now) => {
    expect(epochAt(now, MSPE, ORIGIN)).toBe(100n);
  });

  it("msPerEpoch ≤ 0 thì NÉM, không trả về nhãn vô nghĩa", () => {
    expect(() => epochAt(BIEN, 0, ORIGIN)).toThrow();
    expect(() => epochAt(BIEN, -1, ORIGIN)).toThrow();
  });
});

describe("windowAt — cửa sổ chứa chính thời điểm gửi, tại các mốc BẮT BUỘC", () => {
  it.each([
    ["giây 0 (mở cửa sổ)", BIEN],
    ["giây 59", BIEN + 59_000],
    ["giây 89 — mốc sát biên 90s của công thức cũ", BIEN + 89_000],
    ["cuối cửa sổ − 1 ms", BIEN + MSPE - 1],
  ])("%s", (_ten, now) => {
    const w = windowAt(now, MSPE, ORIGIN);
    // Luật 2b `reserve_draw.ak`: lo & hi cùng một epoch.
    expect(Math.floor((w.loMs - ORIGIN) / MSPE)).toBe(100);
    expect(Math.floor((w.hiMs - ORIGIN) / MSPE)).toBe(100);
    expect(w.t).toBe(100n);
    // Khoảng không rỗng, và CHỨA chính thời điểm gửi — mệnh đề bản cũ từng thiếu.
    expect(w.hiMs).toBeGreaterThan(w.loMs);
    expect(w.loMs).toBeLessThanOrEqual(now);
    expect(w.hiMs).toBeGreaterThanOrEqual(now);
    // Không vượt chân trời dự báo của node (PastHorizon).
    expect(w.hiMs - now).toBeLessThanOrEqual(WINDOW_TTL_MS);
  });

  it("hi = now + TTL khi cuối cửa sổ còn xa; = cuối cửa sổ − 1 ms khi cửa sổ hết trước", () => {
    expect(windowAt(BIEN, MSPE, ORIGIN).hiMs).toBe(BIEN + WINDOW_TTL_MS);
    expect(windowAt(BIEN + MSPE - 1_000, MSPE, ORIGIN).hiMs).toBe(BIEN + MSPE - 1);
  });
});

// ── pinnedEpochWindow — nghĩa vụ off-chain riêng của Faucet v3 (`util.get_epoch_pinned`) ────
// Khác `windowAt`: `lo = now_ms` (KHÔNG lùi cho lệch đồng hồ) và NÉM lỗi có mã khi phần bucket
// còn lại ngắn hơn TTL tối thiểu, thay vì lặng lẽ trả về cửa sổ hẹp. Xem đầu `epochWindow.ts`.
describe("pinnedEpochWindow — lo=now (không lùi), hi kẹp cuối bucket, ném khi bucket cạn", () => {
  it("giữa bucket: lo=now, hi=now+ttl, cùng bucket, chứa now", () => {
    const now = BIEN + 2 * 3_600_000; // 2 giờ sau đầu bucket 5 ngày — còn RẤT nhiều dư
    const w = pinnedEpochWindow(now, MSPE, ORIGIN);
    expect(w.loMs).toBe(now);                          // KHÔNG lùi — khác windowAt
    expect(w.hiMs).toBe(now + WINDOW_TTL_MS);
    expect(w.epoch).toBe(100n);
    expect(Math.floor((w.loMs - ORIGIN) / MSPE)).toBe(Math.floor((w.hiMs - ORIGIN) / MSPE));
  });

  it("sát biên cuối bucket, còn dư ĐÚNG bằng ngưỡng tối thiểu: KHÔNG ném", () => {
    const now = BIEN + MSPE - 1 - MIN_PINNED_WINDOW_MS; // còn lại đúng minWindowMs tới hết bucket
    const w = pinnedEpochWindow(now, MSPE, ORIGIN);
    expect(w.hiMs).toBe(BIEN + MSPE - 1);
    expect(w.hiMs - w.loMs).toBe(MIN_PINNED_WINDOW_MS);
  });

  it("sát biên cuối bucket, còn dư DƯỚI ngưỡng tối thiểu: NÉM lỗi có mã, không tự nới hi", () => {
    const now = BIEN + MSPE - 1 - MIN_PINNED_WINDOW_MS + 1; // thiếu 1ms so với ngưỡng
    expect(() => pinnedEpochWindow(now, MSPE, ORIGIN)).toThrow(/FAUCET-WINDOW-001/);
  });

  it("ttl vừa khít bucket (ttl < khoảng cách tới cuối bucket): hi = now+ttl, không kẹp", () => {
    const now = BIEN; // đầu bucket, còn gần trọn 5 ngày
    const ttl = 120_000; // 2 phút — nhỏ hơn nhiều so với phần còn lại của bucket
    const w = pinnedEpochWindow(now, MSPE, ORIGIN, ttl);
    expect(w.hiMs).toBe(now + ttl);
    expect(w.hiMs - w.loMs).toBe(ttl);
  });

  it("msPerEpoch <= 0 thì NÉM", () => {
    expect(() => pinnedEpochWindow(BIEN, 0, ORIGIN)).toThrow();
    expect(() => pinnedEpochWindow(BIEN, -1, ORIGIN)).toThrow();
  });
});

// ── Gốc cửa sổ — Specs/Window/CONTRACT.md v1.0 (WIN-ORIGIN-1..3) ─────────────────────────
describe("gốc cửa sổ: nhãn = (t − origin) / mspe, KHÔNG phải t / mspe", () => {
  it("lưới Unix cũ cho nhãn KHÁC — bài này đỏ nếu hàm quên trừ gốc", () => {
    const now = BIEN + 5_000;
    expect(epochAt(now, MSPE, ORIGIN)).toBe(100n);
    // Cái mà bản cũ (chia từ gốc Unix) sẽ trả: lệch hàng nghìn cửa sổ, không phải lệch 1.
    expect(BigInt(Math.floor(now / MSPE))).not.toBe(100n);
  });

  it("biên cửa sổ rơi đúng gốc + k·mspe: ms đầu → k, ms cuối → k, ms kế → k+1", () => {
    const start = ORIGIN + 100 * MSPE;
    expect(epochAt(start - 1, MSPE, ORIGIN)).toBe(99n);
    expect(epochAt(start, MSPE, ORIGIN)).toBe(100n);
    expect(epochAt(start + MSPE - 1, MSPE, ORIGIN)).toBe(100n);
    expect(epochAt(start + MSPE, MSPE, ORIGIN)).toBe(101n);
  });

  it("windowAt/pinnedEpochWindow: hi không vượt cuối cửa sổ tính TỪ GỐC (origin + (e+1)·mspe − 1)", () => {
    const end = BIEN + MSPE - 1;
    expect(windowAt(end - 1_000, MSPE, ORIGIN).hiMs).toBe(end);
    // còn 2·min tới hết cửa sổ (< TTL) ⇒ hi bị kẹp đúng ở cuối cửa sổ, KHÔNG sang cửa sổ sau.
    expect(pinnedEpochWindow(end - 2 * MIN_PINNED_WINDOW_MS, MSPE, ORIGIN).hiMs).toBe(end);
    // Đầu cửa sổ: lo bị kẹp ở windowStart = origin + e·mspe, không lùi sang cửa sổ trước.
    expect(windowAt(BIEN + 10_000, MSPE, ORIGIN).loMs).toBe(BIEN);
  });

  it("gốc Preprod thật cũng cho nhãn 316 tại biên 316 (vector §3 của spec)", () => {
    const o = Number(WINDOW_ORIGIN_MS_BY_NETWORK.Preprod!);
    expect(epochAt(o + 316 * MSPE, MSPE, o)).toBe(316n);
    expect(epochAt(o + 316 * MSPE - 1, MSPE, o)).toBe(315n);
  });

  it("thiếu / sai gốc thì NÉM có mã, không lặng lẽ chia từ gốc Unix", () => {
    // `undefined as never`: mô phỏng caller JS/any quên truyền.
    expect(() => epochAt(BIEN, MSPE, undefined as never)).toThrow(/FAUCET-WINDOW-002/);
    expect(() => windowAt(BIEN, MSPE, NaN)).toThrow(/FAUCET-WINDOW-002/);
    expect(() => pinnedEpochWindow(BIEN, MSPE, -1)).toThrow(/FAUCET-WINDOW-002/);
  });

  it("mốc TRƯỚC gốc thì NÉM FAUCET-WINDOW-003 (giờ giả trên mạng có gốc thật)", () => {
    expect(() => epochAt(ORIGIN - 1, MSPE, ORIGIN)).toThrow(/FAUCET-WINDOW-003/);
    expect(() => windowAt(5_000, MSPE, ORIGIN)).toThrow(/FAUCET-WINDOW-003/);
    expect(() => pinnedEpochWindow(5_000, MSPE, ORIGIN)).toThrow(/FAUCET-WINDOW-003/);
  });
});
