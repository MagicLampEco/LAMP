// TIGER entitlement — bảo toàn oil, loại self-dealing, cap water-filling, tất định.

import { describe, it, expect } from "vitest";
import {
  accumulate,
  computeEntitlements,
} from "../offchain/src/entitlement.js";
import { TIGER_TOTAL_OIL, OIL_PER_LAMP } from "../offchain/src/constants.js";
import type { SnapshotSet } from "../offchain/src/types.js";

const A = "a1".repeat(28);
const B = "b2".repeat(28);
const C = "c3".repeat(28);
const D = "d4".repeat(28);
const FOUNDER = "ff".repeat(28);

describe("accumulate — tích lũy stake qua snapshot", () => {
  it("cộng dồn nhiều epoch (lòng trung thành = stake·epoch)", () => {
    const snaps: SnapshotSet = [
      [{ owner: A, stake: 100n }, { owner: B, stake: 50n }],
      [{ owner: A, stake: 100n }], // A stake 2 epoch, B chỉ 1
      [{ owner: A, stake: 100n }],
    ];
    const acc = accumulate(snaps);
    expect(acc.get(A)).toBe(300n); // 3 epoch × 100
    expect(acc.get(B)).toBe(50n); // 1 epoch × 50
  });

  it("loại ví self-dealing TRƯỚC khi chia", () => {
    const snaps: SnapshotSet = [
      [{ owner: A, stake: 100n }, { owner: FOUNDER, stake: 9999n }],
    ];
    const acc = accumulate(snaps, new Set([FOUNDER]));
    expect(acc.has(FOUNDER)).toBe(false);
    expect(acc.get(A)).toBe(100n);
  });

  it("bỏ stake = 0", () => {
    const acc = accumulate([[{ owner: A, stake: 0n }, { owner: B, stake: 5n }]]);
    expect(acc.has(A)).toBe(false);
    expect(acc.get(B)).toBe(5n);
  });

  it("THROW owner trùng trong CÙNG snapshot (chống thổi phồng accStake)", () => {
    expect(() =>
      accumulate([[{ owner: A, stake: 100n }, { owner: A, stake: 50n }]]),
    ).toThrow(/TIGER-002/);
  });

  it("cùng owner ở KHÁC snapshot vẫn cộng dồn (lòng trung thành hợp lệ)", () => {
    const acc = accumulate([
      [{ owner: A, stake: 100n }],
      [{ owner: A, stake: 100n }],
    ]);
    expect(acc.get(A)).toBe(200n);
  });
});

describe("computeEntitlements — bảo toàn oil (không cap)", () => {
  it("Σ E_i = budget CHÍNH XÁC, dư floor → ví stake lớn nhất (tie → hex nhỏ nhất)", () => {
    // budget 10, 3 ví bằng nhau: floor(10/3)=3 mỗi ví, Σ=9, dư 1 → A (tie hex nhỏ nhất).
    const snaps: SnapshotSet = [
      [
        { owner: A, stake: 1n },
        { owner: B, stake: 1n },
        { owner: C, stake: 1n },
      ],
    ];
    const { entitlements, leftover, distributed } = computeEntitlements(snaps, {
      budgetOil: 10n,
    });
    expect(distributed).toBe(10n);
    expect(leftover).toBe(0n);
    const a = entitlements.find((e) => e.owner === A)!;
    const b = entitlements.find((e) => e.owner === B)!;
    const c = entitlements.find((e) => e.owner === C)!;
    expect(a.amount).toBe(4n); // 3 + dư 1
    expect(b.amount).toBe(3n);
    expect(c.amount).toBe(3n);
  });

  it("full budget 1.2e13 chia hết → Σ = budget", () => {
    const snaps: SnapshotSet = [
      [{ owner: A, stake: 1n }, { owner: B, stake: 1n }],
    ];
    const { distributed, leftover } = computeEntitlements(snaps);
    expect(distributed).toBe(TIGER_TOTAL_OIL);
    expect(leftover).toBe(0n);
  });

  it("tỷ lệ đúng theo stake tích lũy", () => {
    const snaps: SnapshotSet = [
      [{ owner: A, stake: 300n }, { owner: B, stake: 100n }],
    ];
    const { entitlements } = computeEntitlements(snaps);
    const a = entitlements.find((e) => e.owner === A)!;
    const b = entitlements.find((e) => e.owner === B)!;
    // A:B = 3:1 → A = 0.75·budget, B = 0.25·budget
    expect(a.amount).toBe((TIGER_TOTAL_OIL * 3n) / 4n);
    expect(b.amount).toBe(TIGER_TOTAL_OIL / 4n);
  });

  it("snapshot rỗng → leftover = budget, không ví nào", () => {
    const { entitlements, leftover } = computeEntitlements([]);
    expect(entitlements.length).toBe(0);
    expect(leftover).toBe(TIGER_TOTAL_OIL);
  });
});

describe("computeEntitlements — cap/ví (water-filling)", () => {
  it("cá voi bị ghim cap, phần dôi chia lại cho ví nhỏ", () => {
    // A áp đảo stake nhưng cap chặn → B,C nhận phần dôi
    const cap = TIGER_TOTAL_OIL / 2n; // trần 50% pot
    const snaps: SnapshotSet = [
      [
        { owner: A, stake: 1_000_000n },
        { owner: B, stake: 1n },
        { owner: C, stake: 1n },
      ],
    ];
    const { entitlements, distributed, leftover } = computeEntitlements(snaps, {
      capOil: cap,
    });
    const a = entitlements.find((e) => e.owner === A)!;
    expect(a.amount).toBe(cap); // ghim trần
    expect(a.capped).toBe(true);
    // tổng vẫn = budget (B,C hấp thụ phần dôi)
    expect(distributed).toBe(TIGER_TOTAL_OIL);
    expect(leftover).toBe(0n);
  });

  it("budget > n×cap → phần thừa thành leftover (không vượt cap)", () => {
    const cap = 1000n;
    const snaps: SnapshotSet = [
      [{ owner: A, stake: 1n }, { owner: B, stake: 1n }],
    ];
    const { entitlements, leftover, distributed } = computeEntitlements(snaps, {
      capOil: cap,
    });
    // 2 ví × cap 1000 = 2000 tối đa; budget 1.2e13 → leftover khổng lồ
    for (const e of entitlements) expect(e.amount).toBe(cap);
    expect(distributed).toBe(2000n);
    expect(leftover).toBe(TIGER_TOTAL_OIL - 2000n);
  });

  it("không ví nào vượt cap sau nhiều vòng water-filling", () => {
    const cap = TIGER_TOTAL_OIL / 3n;
    const snaps: SnapshotSet = [
      [
        { owner: A, stake: 100n },
        { owner: B, stake: 100n },
        { owner: C, stake: 1n },
        { owner: D, stake: 1n },
      ],
    ];
    const { entitlements, distributed } = computeEntitlements(snaps, {
      capOil: cap,
    });
    for (const e of entitlements) expect(e.amount).toBeLessThanOrEqual(cap);
    expect(distributed).toBe(TIGER_TOTAL_OIL);
  });
});

describe("tất định (determinism)", () => {
  it("cùng input → cùng output (kể cả thứ tự snapshot khác)", () => {
    const s1: SnapshotSet = [
      [{ owner: A, stake: 7n }, { owner: B, stake: 3n }],
      [{ owner: C, stake: 5n }],
    ];
    const s2: SnapshotSet = [
      [{ owner: C, stake: 5n }],
      [{ owner: B, stake: 3n }, { owner: A, stake: 7n }],
    ];
    const r1 = computeEntitlements(s1);
    const r2 = computeEntitlements(s2);
    expect(r1.distributed).toBe(r2.distributed);
    const m1 = new Map(r1.entitlements.map((e) => [e.owner, e.amount]));
    const m2 = new Map(r2.entitlements.map((e) => [e.owner, e.amount]));
    expect(m1).toEqual(m2);
  });
});

describe("TV-OVERFLOW — BigInt, không Number", () => {
  it("budget 1.2e13 oil × stake lớn không tràn", () => {
    const bigStake = 45_000_000_000_000n; // ~45M ADA lovelace scale
    const snaps: SnapshotSet = [
      [{ owner: A, stake: bigStake }, { owner: B, stake: bigStake }],
    ];
    const { distributed } = computeEntitlements(snaps);
    expect(distributed).toBe(TIGER_TOTAL_OIL);
    expect(typeof distributed).toBe("bigint");
  });

  it("12M LAMP = 1.2e13 oil", () => {
    expect(TIGER_TOTAL_OIL).toBe(12_000_000n * OIL_PER_LAMP);
    expect(TIGER_TOTAL_OIL).toBe(12_000_000_000_000n);
  });
});
