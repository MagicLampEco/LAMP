// Vested math tests — CONTRACT v2 "Capped Drop" §1/§7.
// vested(t) = min(E, D·dpe·max(0, t−t0)); redeemable = vested − redeemed.

import { describe, it, expect } from "vitest";
import { vested, redeemable, epochsToFull } from "../offchain/src/vested.js";
import type { ClaimAccountDatum } from "../offchain/src/types.js";
import { lampOildrop } from "./helpers.js";

const D = lampOildrop(100n);   // 100 LAMP/drop·epoch

function acc(over: Partial<ClaimAccountDatum> = {}): ClaimAccountDatum {
  return {
    owner: "0a0a",
    entitlement: lampOildrop(1000n),
    redeemed: 0n,
    start_epoch: 0n,
    drops_per_epoch: 1n,
    ...over,
  };
}

describe("vested(t) = min(E, D·dpe·max(0,t−t0))", () => {
  it("trước/đúng t0 → 0 (max(0, ·))", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 5n, 5n)).toBe(0n);   // t == t0
    expect(vested(lampOildrop(1000n), D, 1n, 5n, 3n)).toBe(0n);   // t < t0
  });

  it("tuyến tính trong vùng chưa cap: D·dpe·Δ", () => {
    // E=1000, D=100, dpe=1, t0=0 → epoch k mở 100k tới cap 1000 (k=10).
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 1n)).toBe(lampOildrop(100n));
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 3n)).toBe(lampOildrop(300n));
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 9n)).toBe(lampOildrop(900n));
  });

  it("cap E: không vượt entitlement dù t lớn", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 10n)).toBe(lampOildrop(1000n)); // đúng cap
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 11n)).toBe(lampOildrop(1000n)); // vượt → vẫn E
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 9999n)).toBe(lampOildrop(1000n));
  });

  it("đơn điệu tăng theo t (không bao giờ giảm)", () => {
    let prev = -1n;
    for (let t = 0n; t <= 20n; t++) {
      const v = vested(lampOildrop(1000n), D, 1n, 0n, t);
      expect(v >= prev).toBe(true);
      prev = v;
    }
    expect(prev).toBe(lampOildrop(1000n)); // đạt cap cuối cùng
  });

  it("E < D → nhận hết ngay epoch đầu (ví nhỏ)", () => {
    // E=30 LAMP < D=100 → epoch 1 đã min(30, 100)=30 = full.
    const E = lampOildrop(30n);
    expect(vested(E, D, 1n, 0n, 1n)).toBe(E);
    expect(vested(E, D, 1n, 0n, 5n)).toBe(E); // vẫn cap E
  });

  it("E > D → nhỏ giọt D/epoch tới hết, ⌈E/D⌉ epoch", () => {
    // E=250, D=100 → epoch1=100, epoch2=200, epoch3=250 (cap). ⌈250/100⌉=3.
    const E = lampOildrop(250n);
    expect(vested(E, D, 1n, 0n, 1n)).toBe(lampOildrop(100n));
    expect(vested(E, D, 1n, 0n, 2n)).toBe(lampOildrop(200n));
    expect(vested(E, D, 1n, 0n, 3n)).toBe(E);
    expect(epochsToFull(E, D, 1n)).toBe(3n);
  });

  it("drops_per_epoch > 1 → mở nhanh hơn (hook DAO)", () => {
    // dpe=2 → mỗi epoch mở 2D = 200 LAMP.
    expect(vested(lampOildrop(1000n), D, 2n, 0n, 3n)).toBe(lampOildrop(600n));
    expect(epochsToFull(lampOildrop(1000n), D, 2n)).toBe(5n); // ⌈1000/200⌉
  });

  it("start_epoch ≠ 0: Δ tính từ t0", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 7n, 10n)).toBe(lampOildrop(300n)); // Δ=3
  });

  it("entitlement bảo toàn: bỏ lỡ epoch không mất quyền (vested cộng dồn)", () => {
    // Account claim từ t0=0, tới epoch 5 mới redeem lần đầu → vested(5)=500 đầy đủ,
    // không mất 4 epoch trước (khác lottery proof hết hạn).
    const E = lampOildrop(1000n);
    expect(vested(E, D, 1n, 0n, 5n)).toBe(lampOildrop(500n));
  });
});

describe("redeemable = vested − redeemed (đa-claim cộng dồn)", () => {
  it("redeemable ≥ 0 luôn (clamp)", () => {
    const a = acc({ redeemed: lampOildrop(500n) });
    // vested(2)=200 < redeemed 500 → clamp 0 (không âm).
    expect(redeemable(a, D, 2n)).toBe(0n);
  });

  it("đa-claim: tổng nhận ≤ E, redeemed cộng dồn từng lần", () => {
    // E=250, D=100, dpe=1. Mô phỏng redeem nhiều epoch, cộng dồn redeemed.
    const E = lampOildrop(250n);
    let redeemed = 0n;
    let totalReceived = 0n;

    for (const t of [1n, 2n, 3n, 4n]) {
      const a = acc({ entitlement: E, redeemed });
      const r = redeemable(a, D, t);
      // mỗi epoch nhận đúng phần vested mới
      if (r > 0n) {
        redeemed += r;
        totalReceived += r;
      }
    }
    expect(totalReceived).toBe(E);        // tổng nhận = E (không hơn)
    expect(redeemed).toBe(E);
    // epoch 4 đã cap, redeemable = 0 (không phát thêm)
    expect(redeemable(acc({ entitlement: E, redeemed }), D, 4n)).toBe(0n);
  });

  it("redeem một lần sau nhiều epoch = gộp toàn bộ vested cộng dồn", () => {
    // Bỏ lỡ tới epoch 3 mới redeem → nhận đủ 300 (cộng dồn), không mất epoch 1,2.
    const a = acc({ entitlement: lampOildrop(1000n), redeemed: 0n });
    expect(redeemable(a, D, 3n)).toBe(lampOildrop(300n));
  });

  it("double-redeem cùng epoch → lần 2 redeemable = 0", () => {
    // Sau khi redeem 300 ở epoch 3, redeemed=300; redeem lại cùng epoch → 0.
    const a = acc({ entitlement: lampOildrop(1000n), redeemed: lampOildrop(300n) });
    expect(redeemable(a, D, 3n)).toBe(0n);
  });
});

describe("epochsToFull = ⌈E / (D·dpe)⌉", () => {
  it("chia hết", () => {
    expect(epochsToFull(lampOildrop(1000n), D, 1n)).toBe(10n);
  });
  it("ceil khi lẻ", () => {
    expect(epochsToFull(lampOildrop(250n), D, 1n)).toBe(3n);   // ⌈2.5⌉
    expect(epochsToFull(lampOildrop(1n), D, 1n)).toBe(1n);     // ví siêu nhỏ
  });
  it("D·dpe = 0 → null (không bao giờ mở)", () => {
    expect(epochsToFull(lampOildrop(100n), 0n, 1n)).toBe(null);
    expect(epochsToFull(lampOildrop(100n), D, 0n)).toBe(null);
  });
  it("E = 0 → 0 epoch", () => {
    expect(epochsToFull(0n, D, 1n)).toBe(0n);
  });
});

describe("input validation", () => {
  it("rejects entitlement/D/dpe âm", () => {
    expect(() => vested(-1n, D, 1n, 0n, 1n)).toThrow(/entitlement/);
    expect(() => vested(lampOildrop(1n), -1n, 1n, 0n, 1n)).toThrow(/dropValue/);
    expect(() => vested(lampOildrop(1n), D, -1n, 0n, 1n)).toThrow(/dropsPerEpoch/);
  });
});
