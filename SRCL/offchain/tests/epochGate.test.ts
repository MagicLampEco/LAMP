// tests/epochGate.test.ts — ms_per_epoch phải khớp MẠNG ĐÍCH trước khi vào datum.
//
// Lỗi được vá ở đây: `demo_srcl.ts` khoá cứng `NETWORK === "Preview"` (thoát nếu khác)
// nhưng nạp `MS_PER_EPOCH_MAINNET = 432_000_000` vào `SrclDatum.ms_per_epoch` — lệch 5 lần
// trên chính mạng nó chạy. Nó không đỏ ở đâu cả: datum vẫn đọc ra một con số hợp lệ,
// pool chỉ đơn giản tính sai mọi mốc epoch.
import { describe, it, expect } from "vitest";
import {
  msPerEpochFor,
  assertMsPerEpochMatchesNetwork,
  MS_PER_EPOCH_MAINNET,
} from "../src/constants.js";
import type { Network } from "@magiclamp/utils";

const NETWORKS: Network[] = ["Preview", "Preprod", "Mainnet"];

describe("msPerEpochFor — mỗi mạng một số, không gộp", () => {
  it("trả đúng epochLength × 1000 của từng mạng", () => {
    expect(msPerEpochFor("Mainnet")).toBe(432_000_000n);
    expect(msPerEpochFor("Preprod")).toBe(432_000_000n);
    expect(msPerEpochFor("Preview")).toBe(86_400_000n);
  });

  it("Preview KHÁC Preprod — gộp hai cái này chính là lỗi cũ", () => {
    expect(msPerEpochFor("Preview")).not.toBe(msPerEpochFor("Preprod"));
    expect(msPerEpochFor("Preprod")).toBe(msPerEpochFor("Mainnet"));
  });
});

describe("assertMsPerEpochMatchesNetwork — cổng SRCL-EPOCH-001", () => {
  it("cho qua khi số khớp mạng — cả ba mạng", () => {
    for (const n of NETWORKS) {
      expect(() => assertMsPerEpochMatchesNetwork(msPerEpochFor(n), n)).not.toThrow();
    }
  });

  it("CHẶN đúng lỗi cũ: hằng mainnet nạp vào datum chạy trên Preview", () => {
    expect(() => assertMsPerEpochMatchesNetwork(MS_PER_EPOCH_MAINNET, "Preview"))
      .toThrow(/SRCL-EPOCH-001/);
  });

  it("CHẶN cả chiều ngược lại: số Preview nạp cho mainnet", () => {
    expect(() => assertMsPerEpochMatchesNetwork(86_400_000n, "Mainnet"))
      .toThrow(/SRCL-EPOCH-001/);
    expect(() => assertMsPerEpochMatchesNetwork(86_400_000n, "Preprod"))
      .toThrow(/SRCL-EPOCH-001/);
  });

  it("mọi cặp (số, mạng) lệch đều bị chặn — quét toàn bảng, không chỉ ca đã biết", () => {
    for (const target of NETWORKS) {
      for (const source of NETWORKS) {
        if (msPerEpochFor(source) === msPerEpochFor(target)) continue;
        expect(() => assertMsPerEpochMatchesNetwork(msPerEpochFor(source), target))
          .toThrow(/SRCL-EPOCH-001/);
      }
    }
  });

  it("thông báo lỗi nói cả số sai lẫn số đúng — người vận hành sửa được ngay", () => {
    try {
      assertMsPerEpochMatchesNetwork(MS_PER_EPOCH_MAINNET, "Preview");
      throw new Error("đáng lẽ phải ném");
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain("432000000");
      expect(msg).toContain("86400000");
      expect(msg).toContain("Preview");
    }
  });
});
