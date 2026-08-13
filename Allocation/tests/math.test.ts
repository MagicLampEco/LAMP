// Vested math tests — Capped Drop. vested(t)=min(E, D·dpe·max(0,t−t0)); redeemable=vested−redeemed.
// PHẢI khớp claim_account.ak (Redeem branch) + math.ak clamp/ceil_div.

import { describe, it, expect } from "vitest";
import { vested, redeemable, epochsToFull, clamp, ceilDiv } from "../offchain/src/math.js";
import type { ClaimAccountDatum } from "../offchain/src/types.js";
import { lampOildrop, CHANNEL_TEAM } from "./helpers.js";

const D = lampOildrop(100n);   // 100 LAMP/drop·epoch

function acc(over: Partial<ClaimAccountDatum> = {}): ClaimAccountDatum {
  return {
    owner: "0a0a",
    entitlement: lampOildrop(1000n),
    redeemed: 0n,
    start_epoch: 0n,
    drops_per_epoch: 1n,
    channel_id: CHANNEL_TEAM,
    ...over,
  };
}

describe("vested(t) = min(E, D·dpe·max(0,t−t0)) — biên", () => {
  it("t < t0 → 0 (max(0,·))", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 5n, 3n)).toBe(0n);
  });

  it("t = t0 → 0 (chưa elapsed)", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 5n, 5n)).toBe(0n);
  });

  it("vùng giữa (tuyến tính D·dpe·Δ, chưa cap)", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 1n)).toBe(lampOildrop(100n));
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 3n)).toBe(lampOildrop(300n));
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 9n)).toBe(lampOildrop(900n));
  });

  it("cap E: đúng biên + vượt → vẫn E", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 10n)).toBe(lampOildrop(1000n));  // đúng cap
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 11n)).toBe(lampOildrop(1000n));  // vượt → E
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 9999n)).toBe(lampOildrop(1000n));
  });

  it("đơn điệu tăng theo t (không bao giờ giảm)", () => {
    let prev = -1n;
    for (let t = 0n; t <= 20n; t++) {
      const v = vested(lampOildrop(1000n), D, 1n, 0n, t);
      expect(v >= prev).toBe(true);
      prev = v;
    }
    expect(prev).toBe(lampOildrop(1000n));
  });

  it("E < D → epoch đầu nhận hết entitlement (cap E)", () => {
    const E = lampOildrop(30n);
    expect(vested(E, D, 1n, 0n, 1n)).toBe(E);
    expect(vested(E, D, 1n, 0n, 5n)).toBe(E);
  });

  it("start_epoch ≠ 0: Δ tính từ t0", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 7n, 10n)).toBe(lampOildrop(300n));   // Δ=3
  });

  it("drops_per_epoch > 1: mở nhanh hơn (D·dpe·Δ)", () => {
    expect(vested(lampOildrop(1000n), D, 2n, 0n, 3n)).toBe(lampOildrop(600n));
  });

  it("entitlement bảo toàn: bỏ lỡ epoch không mất quyền (vested cộng dồn)", () => {
    expect(vested(lampOildrop(1000n), D, 1n, 0n, 5n)).toBe(lampOildrop(500n));
  });
});

describe("redeemable = vested − redeemed (clamp ≥ 0)", () => {
  it("redeemable ≥ 0 luôn", () => {
    const a = acc({ redeemed: lampOildrop(500n) });
    expect(redeemable(a, D, 2n)).toBe(0n);   // vested(2)=200 < redeemed 500 → 0
  });

  it("gộp toàn bộ vested cộng dồn khi redeem muộn", () => {
    const a = acc({ entitlement: lampOildrop(1000n), redeemed: 0n });
    expect(redeemable(a, D, 3n)).toBe(lampOildrop(300n));
  });

  it("đa-claim: tổng nhận = E, redeemed cộng dồn", () => {
    const E = lampOildrop(250n);
    let redeemed = 0n;
    let total = 0n;
    for (const t of [1n, 2n, 3n, 4n]) {
      const r = redeemable(acc({ entitlement: E, redeemed }), D, t);
      if (r > 0n) { redeemed += r; total += r; }
    }
    expect(total).toBe(E);
    expect(redeemed).toBe(E);
    expect(redeemable(acc({ entitlement: E, redeemed }), D, 4n)).toBe(0n);  // cap, không phát thêm
  });

  it("double-redeem cùng epoch → lần 2 = 0", () => {
    const a = acc({ entitlement: lampOildrop(1000n), redeemed: lampOildrop(300n) });
    expect(redeemable(a, D, 3n)).toBe(0n);
  });
});

describe("epochsToFull = ⌈E / (D·dpe)⌉", () => {
  it("chia hết", () => {
    expect(epochsToFull(lampOildrop(1000n), D, 1n)).toBe(10n);
  });
  it("ceil khi lẻ", () => {
    expect(epochsToFull(lampOildrop(250n), D, 1n)).toBe(3n);
    expect(epochsToFull(lampOildrop(1n), D, 1n)).toBe(1n);
  });
  it("dpe>1 mở nhanh hơn", () => {
    expect(epochsToFull(lampOildrop(1000n), D, 2n)).toBe(5n);
  });
  it("D·dpe = 0 → null", () => {
    expect(epochsToFull(lampOildrop(100n), 0n, 1n)).toBe(null);
    expect(epochsToFull(lampOildrop(100n), D, 0n)).toBe(null);
  });
  it("E = 0 → 0 epoch", () => {
    expect(epochsToFull(0n, D, 1n)).toBe(0n);
  });
});

describe("clamp / ceilDiv (mirror math.ak)", () => {
  it("clamp trong/dưới/trên", () => {
    expect(clamp(50n, 10n, 100n)).toBe(50n);
    expect(clamp(5n, 10n, 100n)).toBe(10n);
    expect(clamp(500n, 10n, 100n)).toBe(100n);
  });
  it("ceilDiv", () => {
    expect(ceilDiv(200n, 100n)).toBe(2n);
    expect(ceilDiv(243n, 100n)).toBe(3n);
    expect(ceilDiv(1n, 100n)).toBe(1n);
    expect(ceilDiv(0n, 100n)).toBe(0n);
  });
});

describe("input validation", () => {
  it("rejects entitlement/D/dpe âm", () => {
    expect(() => vested(-1n, D, 1n, 0n, 1n)).toThrow(/entitlement/);
    expect(() => vested(lampOildrop(1n), -1n, 1n, 0n, 1n)).toThrow(/dropValue/);
    expect(() => vested(lampOildrop(1n), D, -1n, 0n, 1n)).toThrow(/dropsPerEpoch/);
  });
});
