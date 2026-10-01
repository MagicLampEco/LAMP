// Gốc cửa sổ phía Treasury (Specs/Window/CONTRACT.md v1.0) — hai việc:
//   1. `windowIndexOf` (bản chép CÓ NHÃN trong collectBuilder.ts, vì Treasury/offchain không phụ thuộc
//      `@magiclamp/utils`) phải cho CÙNG kết quả với `windowIndex` của Utils — đây là chỗ bản sao tự chết
//      ồn ào khi nguồn đổi.
//   2. Vector đo tay từ spec §3: mốc t0 ở cửa sổ 658 (Mainnet) / 316 (Preprod).
import { describe, it, expect } from "vitest";
import { windowIndexOf } from "../offchain/src/collectBuilder.js";
import { windowIndex, WINDOW_ORIGIN_MS_BY_NETWORK } from "../../Utils/src/index.js";

const MS = 432_000_000n;
const MAINNET = WINDOW_ORIGIN_MS_BY_NETWORK.Mainnet!;
const PREPROD = WINDOW_ORIGIN_MS_BY_NETWORK.Preprod!;

describe("hằng gốc gõ trong bài Treasury khớp Utils", () => {
  it("collect.test.ts và custodyParams.test.ts dùng gốc Mainnet thật", () => {
    expect(MAINNET).toBe(1_506_203_091_000n);
  });
});

describe("windowIndexOf — bản sao phải khớp Utils", () => {
  it("khớp windowIndex của Utils trên lưới mốc, cả hai mạng", () => {
    for (const o of [MAINNET, PREPROD]) {
      for (const k of [0n, 1n, MS - 1n, MS, MS + 1n, 316n * MS + 7n, 658n * MS - 1n, 658n * MS]) {
        expect(windowIndexOf(o + k, o, MS)).toBe(windowIndex(o + k, o, MS));
      }
    }
  });

  it("gốc không chia hết cho MS: chia thô cho nhãn KHÁC", () => {
    expect(MAINNET % MS).not.toBe(0n);
    const t = MAINNET + 12n * MS;
    expect(windowIndexOf(t, MAINNET, MS)).toBe(12n);
    expect(t / MS).not.toBe(12n);
  });

  it("hai mạng, cùng một mốc ⇒ gốc khác ⇒ nhãn khác", () => {
    const t = PREPROD + 5n * MS;
    expect(windowIndexOf(t, PREPROD, MS)).toBe(5n);
    expect(windowIndexOf(t, MAINNET, MS)).not.toBe(5n);
  });

  it("từ chối: msPerEpoch ≤ 0, gốc thiếu/âm, mốc trước gốc", () => {
    expect(() => windowIndexOf(MAINNET, 0n, 0n)).toThrow(/EPOCH-000/);
    expect(() => windowIndexOf(MAINNET, undefined as unknown as bigint, MS)).toThrow(/WINDOW-ORIGIN-001/);
    expect(() => windowIndexOf(MAINNET, -1n, MS)).toThrow(/WINDOW-ORIGIN-001/);
    expect(() => windowIndexOf(MAINNET - 1n, MAINNET, MS)).toThrow(/WINDOW-ORIGIN-002/);
  });
});
