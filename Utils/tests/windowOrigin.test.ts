// tests/windowOrigin.test.ts — Specs/Window/CONTRACT.md v1.0: gốc cửa sổ + test vector §3
import { describe, it, expect } from "vitest";
import {
  WINDOW_ORIGIN_MS_BY_NETWORK, windowOriginMs, windowOf, windowStart, windowEnd,
  windowIndex, windowStartMs, windowEndMs, windowBounds,
  SHELLEY_START_BY_NETWORK, MS_PER_EPOCH_BY_NETWORK, msPerEpoch,
  ChainTimeError, CHAIN_TIME_ERRORS,
} from "../src/index.js";

function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ChainTimeError);
  expect((caught as ChainTimeError).code).toBe(code);
}

describe("WINDOW_ORIGIN_MS_BY_NETWORK — suy ra, không gõ tay (WIN-ORIGIN-4)", () => {
  it("giá trị khớp bảng spec §2", () => {
    expect(windowOriginMs("Mainnet")).toBe(1_506_203_091_000n);
    expect(windowOriginMs("Preprod")).toBe(1_654_041_600_000n);
  });

  it("đúng công thức shelley.posixMs − shelley.epoch × ms_per_epoch", () => {
    for (const n of ["Preprod", "Mainnet"] as const) {
      const s = SHELLEY_START_BY_NETWORK[n];
      expect(WINDOW_ORIGIN_MS_BY_NETWORK[n]).toBe(s.posixMs - s.epoch * MS_PER_EPOCH_BY_NETWORK[n]);
    }
  });

  it("hai gốc KHÔNG chia hết cho ms_per_epoch (ca gốc 0 không phân biệt được bản quên trừ gốc)", () => {
    expect(windowOriginMs("Mainnet") % msPerEpoch("Mainnet")).not.toBe(0n);
    expect(windowOriginMs("Preprod") % msPerEpoch("Preprod")).not.toBe(0n);
  });

  it("Preview KHÔNG có giá trị: chỉ số trần ra undefined, hàm ném WINDOW_ORIGIN_UNDEFINED (WIN-PREVIEW)", () => {
    expect(WINDOW_ORIGIN_MS_BY_NETWORK.Preview).toBeUndefined();
    expect("Preview" in WINDOW_ORIGIN_MS_BY_NETWORK).toBe(false);
    expectCode(() => windowOriginMs("Preview"), CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED);
    expectCode(() => windowOf(1_790_459_091_000n, "Preview"), CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED);
    expectCode(() => windowStart(1n, "Preview"), CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED);
    expectCode(() => windowEnd(1n, "Preview"), CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED);
  });

  it("bảng bị đóng băng (không ghi đè được từ nơi khác)", () => {
    expect(Object.isFrozen(WINDOW_ORIGIN_MS_BY_NETWORK)).toBe(true);
  });
});

describe("test vector spec §3 — mọi bên tích hợp chạy chung", () => {
  const vectors: Array<[Parameters<typeof windowOf>[1], bigint, bigint]> = [
    ["Mainnet", 1_790_459_091_000n, 658n],
    ["Mainnet", 1_790_459_090_999n, 657n],
    ["Preprod", 1_790_553_600_000n, 316n],
    ["Preprod", 1_790_553_599_999n, 315n],
  ];
  for (const [net, t, expected] of vectors) {
    it(`${net} t=${t} ⇒ ${expected}`, () => {
      expect(windowOf(t, net)).toBe(expected);
    });
  }

  it("biên cửa sổ trùng biên epoch Cardano: start(e) chia ra e, start(e) − 1 chia ra e − 1", () => {
    for (const net of ["Preprod", "Mainnet"] as const) {
      for (const e of [316n, 658n, 1000n]) {
        expect(windowOf(windowStart(e, net), net)).toBe(e);
        expect(windowOf(windowStart(e, net) - 1n, net)).toBe(e - 1n);
        expect(windowOf(windowEnd(e, net), net)).toBe(e);
        expect(windowEnd(e, net) + 1n).toBe(windowStart(e + 1n, net));
      }
    }
  });

  it("mốc Shelley đầu tiên của mỗi mạng nằm đúng đầu cửa sổ = epoch Shelley", () => {
    for (const n of ["Preprod", "Mainnet"] as const) {
      const s = SHELLEY_START_BY_NETWORK[n];
      expect(windowOf(s.posixMs, n)).toBe(s.epoch);
      expect(windowStart(s.epoch, n)).toBe(s.posixMs);
    }
  });
});

describe("hàm tham số tường minh (windowIndex / windowStartMs / windowEndMs / windowBounds)", () => {
  const MS = 432_000_000n;
  const O = 1_654_041_600_000n;

  it("trừ gốc TRƯỚC khi chia: bản quên trừ gốc cho số khác", () => {
    const t = 1_790_553_600_000n;
    expect(windowIndex(t, O, MS)).toBe(316n);
    expect(t / MS).not.toBe(316n); // chính cái lưới 1970 cũ
  });

  it("chiều ngược cộng gốc: start/end ↔ index", () => {
    expect(windowStartMs(316n, O, MS)).toBe(1_790_553_600_000n);
    expect(windowEndMs(315n, O, MS)).toBe(1_790_553_599_999n);
    const b = windowBounds(1_790_600_000_000n, O, MS);
    expect(b).toEqual({ epoch: 316n, startMs: 1_790_553_600_000n, endMs: 1_790_985_599_999n });
  });

  it("gốc 0 vẫn hợp lệ (lưới 1970) và t trước gốc ném WINDOW_BEFORE_ORIGIN", () => {
    expect(windowIndex(10n * MS + 5n, 0n, MS)).toBe(10n);
    expectCode(() => windowIndex(O - 1n, O, MS), CHAIN_TIME_ERRORS.WINDOW_BEFORE_ORIGIN);
  });

  it("tham số sai ném WINDOW_PARAMS_INVALID", () => {
    expectCode(() => windowIndex(1n, 0n, 0n), CHAIN_TIME_ERRORS.WINDOW_PARAMS_INVALID);
    expectCode(() => windowStartMs(1n, -1n, MS), CHAIN_TIME_ERRORS.WINDOW_PARAMS_INVALID);
  });
});
