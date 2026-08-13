// TIGER drip kiểu B — cliff, full-đúng-N, không-vượt-E, đơn điệu, cộng dồn,
// + BIT-IDENTITY với công thức claim_account on-chain (vector từ claim_account.ak).

import { describe, it, expect } from "vitest";
import {
  ceilDiv,
  dripBParams,
  tigerDatum,
  vested,
  vestedAt,
  redeemable,
  vestedIdealB,
  fullyVestedAfter,
} from "../offchain/src/dripB.js";
import { DROP_VALUE_OILDROP } from "../offchain/src/constants.js";

const OWNER = "0a".repeat(28);

describe("dripBParams — r = ceil(E/N), D = 1 chung", () => {
  it("chia hết: E=3600, N=36 → r=100", () => {
    const p = dripBParams(3600n, 36n, 0n);
    expect(p.dropsPerEpoch).toBe(100n);
    expect(p.dropValue).toBe(DROP_VALUE_OILDROP);
    expect(p.startEpoch).toBe(0n);
  });
  it("lẻ: E=3601, N=36 → r=ceil=101 (mở nhanh hơn, không chậm)", () => {
    expect(dripBParams(3601n, 36n, 0n).dropsPerEpoch).toBe(101n);
  });
  it("ceilDiv N=0 ném lỗi", () => {
    expect(() => ceilDiv(10n, 0n)).toThrow();
  });
});

describe("tigerDatum — khởi tạo account", () => {
  it("redeemed=0, start=cliff, dpe=ceil(E/N)", () => {
    const d = tigerDatum(OWNER, 7200n, 36n, 500n);
    expect(d.owner).toBe(OWNER);
    expect(d.entitlement).toBe(7200n);
    expect(d.redeemed).toBe(0n);
    expect(d.start_epoch).toBe(500n);
    expect(d.drops_per_epoch).toBe(200n); // 7200/36
  });
});

describe("kiểu B — cliff + full đúng N + không vượt E", () => {
  const E = 3_600_000n; // 3.6 LAMP-oildrop-scale
  const N = 36n;
  const cliff = 10n;
  const d = tigerDatum(OWNER, E, N, cliff);

  it("CLIFF: t ≤ cliff ⇒ vested = 0", () => {
    expect(vestedAt(d, 0n)).toBe(0n);
    expect(vestedAt(d, cliff)).toBe(0n); // tại đúng cliff vẫn 0 (elapsed ≤ 0)
  });

  it("FULL đúng hạn: t = cliff + N ⇒ vested = E", () => {
    expect(vestedAt(d, cliff + N)).toBe(E);
  });

  it("KHÔNG VƯỢT: vested ≤ E mọi t (kể cả t rất xa)", () => {
    for (const t of [cliff + 1n, cliff + 18n, cliff + N, cliff + 1000n]) {
      expect(vestedAt(d, t)).toBeLessThanOrEqual(E);
    }
    expect(vestedAt(d, cliff + 1000n)).toBe(E); // cap giữ nguyên E
  });

  it("ĐƠN ĐIỆU không giảm theo t", () => {
    let prev = 0n;
    for (let t = cliff; t <= cliff + N + 5n; t += 1n) {
      const v = vestedAt(d, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("xấp xỉ tuyến tính giữa kỳ (t = cliff + N/2 ≈ E/2)", () => {
    const half = vestedAt(d, cliff + N / 2n);
    // ceil-rate mở ≥ lý tưởng, sai khác ≤ r·(N/2) ≪ E
    expect(half).toBeGreaterThanOrEqual(E / 2n);
    expect(half).toBeLessThanOrEqual(E / 2n + d.drops_per_epoch * (N / 2n));
  });
});

describe("kiểu B ≥ kiểu B lý tưởng mỗi epoch, cả hai full ≤ N", () => {
  it("onchain(ceil) ≥ ideal(floor) mọi epoch; cả hai = E tại cliff+N", () => {
    const E = 5_000_001n; // lẻ để ceil ≠ floor
    const N = 36n;
    const cliff = 3n;
    const d = tigerDatum(OWNER, E, N, cliff);
    for (let t = cliff; t <= cliff + N; t += 1n) {
      const on = vestedAt(d, t);
      const ideal = vestedIdealB(E, N, cliff, t);
      expect(on).toBeGreaterThanOrEqual(ideal); // không bao giờ chậm hơn
    }
    expect(vestedAt(d, cliff + N)).toBe(E);
    expect(vestedIdealB(E, N, cliff, cliff + N)).toBe(E);
  });

  it("fullyVestedAfter ≤ N (xong trong hạn)", () => {
    for (const E of [1n, 35n, 36n, 37n, 3_600_001n, 12_000_000_000_000n]) {
      expect(fullyVestedAfter(E, 36n)).toBeLessThanOrEqual(36n);
    }
  });

  it("ví cực nhỏ E < N xong sớm (E epoch) — chấp nhận, dưới ngưỡng thực tế", () => {
    // E=10 oildrop, N=36 → r=ceil(10/36)=1 → full sau 10 epoch
    expect(fullyVestedAfter(10n, 36n)).toBe(10n);
  });
});

describe("BIT-IDENTITY với claim_account on-chain (vector từ claim_account.ak)", () => {
  // vested(E, D, dpe, start, t) = min(E, D·dpe·max(0,t−start))
  it("redeem_happy: E=1000,D=100,dpe=1,start=0,t=3 → 300", () => {
    expect(vested(1000n, 100n, 1n, 0n, 3n)).toBe(300n);
  });
  it("redeem_small: E=50,D=100,t=1 → 50 (cap ngay epoch đầu)", () => {
    expect(vested(50n, 100n, 1n, 0n, 1n)).toBe(50n);
  });
  it("redeem_vested_capped: E=1000,D=100,t=50 → 1000 (cap)", () => {
    expect(vested(1000n, 100n, 1n, 0n, 50n)).toBe(1000n);
  });
  it("multi-claim epoch: t=2→200, t=5→500, t=20→1000", () => {
    expect(vested(1000n, 100n, 1n, 0n, 2n)).toBe(200n);
    expect(vested(1000n, 100n, 1n, 0n, 5n)).toBe(500n);
    expect(vested(1000n, 100n, 1n, 0n, 20n)).toBe(1000n);
  });
  it("trước start → 0", () => {
    expect(vested(1000n, 100n, 1n, 5n, 3n)).toBe(0n);
    expect(vested(1000n, 100n, 1n, 5n, 5n)).toBe(0n);
  });
});

describe("redeemable — cộng dồn, bỏ lỡ epoch không mất quyền", () => {
  it("rút nhiều đợt: tổng nhận = vested(epoch cuối), path-independent", () => {
    const E = 3_600n;
    const N = 36n;
    const cliff = 0n;
    let d = tigerDatum(OWNER, E, N, cliff); // r=100
    // đợt 1 epoch 5: vested=500, rút 500
    let r1 = redeemable(d, 5n);
    expect(r1).toBe(500n);
    d = { ...d, redeemed: d.redeemed + r1 };
    // đợt 2 epoch 20: vested=2000, đã rút 500 → rút 1500
    let r2 = redeemable(d, 20n);
    expect(r2).toBe(1500n);
    d = { ...d, redeemed: d.redeemed + r2 };
    // đợt 3 epoch 36 (full): vested=3600, đã 2000 → rút 1600
    let r3 = redeemable(d, 36n);
    expect(r3).toBe(1600n);
    d = { ...d, redeemed: d.redeemed + r3 };
    expect(d.redeemed).toBe(E); // tổng = E chính xác
    // sau đó không còn gì
    expect(redeemable(d, 100n)).toBe(0n);
  });

  it("bỏ lỡ tới epoch cuối vẫn rút trọn E (1 phát)", () => {
    const E = 3_600n;
    const d = tigerDatum(OWNER, E, 36n, 0n);
    expect(redeemable(d, 36n)).toBe(E);
  });
});
