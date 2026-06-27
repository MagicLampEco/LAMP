// TIGER per-epoch attribution — bảo toàn oil, đối chiếu computeEntitlements, snapshot I/O.

import { describe, it, expect } from "vitest";
import {
  apportion,
  ownerBreakdown,
  attributionContext,
} from "../offchain/src/attribution.js";
import { computeEntitlements } from "../offchain/src/entitlement.js";
import {
  parseSnapshot,
  buildSnapshot,
} from "../offchain/src/snapshot-io.js";
import { TIGER_TOTAL_OIL, OIL_PER_LAMP } from "../offchain/src/constants.js";
import type { SnapshotSet } from "../offchain/src/types.js";

const A = "a1".repeat(28);
const B = "b2".repeat(28);
const C = "c3".repeat(28);
const FOUNDER = "ff".repeat(28);

describe("apportion — chia số nguyên Hamilton (bảo toàn)", () => {
  it("Σ phần == total CHÍNH XÁC", () => {
    const w = [3n, 1n, 1n];
    const out = apportion(10n, w);
    expect(out.reduce((s, v) => s + v, 0n)).toBe(10n);
  });

  it("rải dư cho phần-dư lớn nhất; tie → chỉ-số nhỏ trước (tất định)", () => {
    // total 10, weights bằng nhau [1,1,1] → mỗi cái 3, dư 1 → idx 0.
    expect(apportion(10n, [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
  });

  it("weights toàn 0 → mảng 0", () => {
    expect(apportion(100n, [0n, 0n])).toEqual([0n, 0n]);
  });

  it("total 0 → mảng 0", () => {
    expect(apportion(0n, [5n, 7n])).toEqual([0n, 0n]);
  });

  it("không tạo/huỷ đơn-vị với số lớn (oil)", () => {
    const w = [123456789n, 987654321n, 555555555n, 1n];
    const out = apportion(TIGER_TOTAL_OIL, w);
    expect(out.reduce((s, v) => s + v, 0n)).toBe(TIGER_TOTAL_OIL);
    expect(out.every((v) => v >= 0n)).toBe(true);
  });
});

describe("ownerBreakdown — Σ ownerShare == E_i (đối chiếu computeEntitlements)", () => {
  const snaps: SnapshotSet = [
    [{ owner: A, stake: 100n }, { owner: B, stake: 50n }],
    [{ owner: A, stake: 100n }, { owner: C, stake: 200n }],
    [{ owner: A, stake: 100n }, { owner: B, stake: 50n }, { owner: C, stake: 200n }],
  ];

  it("cap=null: mỗi ví Σ per-epoch == entitlement cuối CHÍNH XÁC", () => {
    const res = computeEntitlements(snaps);
    for (const ent of res.entitlements) {
      const bd = ownerBreakdown(snaps, ent.owner);
      expect(bd.found).toBe(true);
      expect(bd.entitlementOil).toBe(ent.amount);
      expect(bd.sumOwnerShareOil).toBe(ent.amount);
      const cum = bd.epochs[bd.epochs.length - 1]!.cumulativeOil;
      expect(cum).toBe(ent.amount);
    }
  });

  it("cumulative cộng dồn đơn điệu không giảm", () => {
    const bd = ownerBreakdown(snaps, A);
    let prev = -1n;
    for (const e of bd.epochs) {
      expect(e.cumulativeOil >= prev).toBe(true);
      prev = e.cumulativeOil;
    }
  });

  it("ownerShare epoch ∝ stake epoch của ví (A đều 100/epoch → ~đều)", () => {
    const bd = ownerBreakdown(snaps, A);
    // A stake 100 cả 3 epoch → 3 phần chênh nhau ≤ 1 oil (do Hamilton).
    const shares = bd.epochs.map((e) => e.ownerShareOil);
    const max = shares.reduce((m, v) => (v > m ? v : m), 0n);
    const min = shares.reduce((m, v) => (v < m ? v : m), shares[0]!);
    expect(max - min <= 1n).toBe(true);
  });

  it("ví KHÔNG có trong snapshot → found=false, E_i=0, share=0", () => {
    const bd = ownerBreakdown(snaps, "de".repeat(28));
    expect(bd.found).toBe(false);
    expect(bd.entitlementOil).toBe(0n);
    expect(bd.sumOwnerShareOil).toBe(0n);
    expect(bd.epochs.every((e) => e.ownerShareOil === 0n)).toBe(true);
  });

  it("ví bị loại (self-dealing) → found=false, share 0 mọi epoch", () => {
    const s2: SnapshotSet = [
      [{ owner: A, stake: 100n }, { owner: FOUNDER, stake: 9999n }],
    ];
    const bd = ownerBreakdown(s2, FOUNDER, { excluded: new Set([FOUNDER]) });
    expect(bd.found).toBe(false);
    expect(bd.sumOwnerShareOil).toBe(0n);
  });

  it("CÓ cap: Σ per-epoch vẫn == E_i đã cap (chia từ E_i thật)", () => {
    const big: SnapshotSet = [
      [{ owner: A, stake: 1_000_000n }, { owner: B, stake: 1n }, { owner: C, stake: 1n }],
    ];
    const cap = TIGER_TOTAL_OIL / 2n; // A sẽ chạm cap
    const res = computeEntitlements(big, { capOil: cap });
    for (const ent of res.entitlements) {
      const bd = ownerBreakdown(big, ent.owner, { capOil: cap });
      expect(bd.sumOwnerShareOil).toBe(ent.amount);
    }
    const a = res.entitlements.find((e) => e.owner === A)!;
    expect(a.capped).toBe(true);
    expect(a.amount).toBe(cap);
  });
});

describe("attributionContext — Σ potOil == distributed", () => {
  const snaps: SnapshotSet = [
    [{ owner: A, stake: 300n }, { owner: B, stake: 100n }],
    [{ owner: A, stake: 300n }, { owner: C, stake: 600n }],
  ];

  it("tổng pot mỗi epoch cộng lại == distributed (cap=null ⇒ == budget)", () => {
    const ctx = attributionContext(snaps);
    const sumPot = ctx.potPerEpoch.reduce((s, p) => s + p.potOil, 0n);
    expect(sumPot).toBe(ctx.distributedOil);
    expect(ctx.distributedOil).toBe(TIGER_TOTAL_OIL); // cap=null, leftover 0
    expect(ctx.leftoverOil).toBe(0n);
  });

  it("epoch nhãn + totalStake đúng", () => {
    const ctx = attributionContext(snaps, {}, [550n, 551n]);
    expect(ctx.potPerEpoch.map((p) => p.epoch)).toEqual([550n, 551n]);
    expect(ctx.potPerEpoch[0]!.totalStake).toBe(400n); // 300+100
    expect(ctx.potPerEpoch[1]!.totalStake).toBe(900n); // 300+600
    expect(ctx.grandTotalStake).toBe(1300n);
  });

  it("Σ tất cả ownerShare (mọi ví) == distributed (bảo toàn toàn cục)", () => {
    const res = computeEntitlements(snaps);
    let total = 0n;
    for (const ent of res.entitlements)
      total += ownerBreakdown(snaps, ent.owner).sumOwnerShareOil;
    expect(total).toBe(res.distributed);
  });
});

describe("snapshot-io — toàn vẹn + round-trip", () => {
  const epochs = [
    { epoch: 550n, stakes: [{ owner: A, stake: 100n }, { owner: B, stake: 50n }] },
    { epoch: 551n, stakes: [{ owner: A, stake: 100n }, { owner: C, stake: 200n }] },
  ];
  const built = buildSnapshot({
    network: "Preview",
    pot: "Early TIGER Deleg 12",
    budgetLamp: 12_000_000n,
    cutoffEpoch: 560n,
    poolIds: ["pool1tiger"],
    excluded: [],
    dripEpochs: 36n,
    cliffEpoch: 555n,
    epochs,
  });

  it("round-trip build → parse → breakdown khớp computeEntitlements", () => {
    const p = parseSnapshot(built);
    expect(p.budgetOil).toBe(12_000_000n * OIL_PER_LAMP);
    expect(p.epochs).toEqual([550n, 551n]);
    const res = computeEntitlements(p.snapshots, p.params);
    const bd = ownerBreakdown(p.snapshots, A, p.params, p.epochs);
    const entA = res.entitlements.find((e) => e.owner === A)!;
    expect(bd.sumOwnerShareOil).toBe(entA.amount);
    expect(bd.epochs.map((e) => e.epoch)).toEqual([550n, 551n]);
  });

  it("THROW owner trùng trong 1 epoch (TIGER-002)", () => {
    const bad = JSON.parse(JSON.stringify(built));
    bad.epochs[0].stakes.push({ owner: A, stake: "5" });
    expect(() => parseSnapshot(bad)).toThrow(/TIGER-002/);
  });

  it("THROW epoch không tăng dần (SNAP-003)", () => {
    const bad = JSON.parse(JSON.stringify(built));
    bad.epochs[1].epoch = "550";
    expect(() => parseSnapshot(bad)).toThrow(/SNAP-003/);
  });

  it("THROW epoch ≥ cutoff (SNAP-004)", () => {
    const bad = JSON.parse(JSON.stringify(built));
    bad.cutoffEpoch = "551";
    expect(() => parseSnapshot(bad)).toThrow(/SNAP-004/);
  });

  it("THROW pkh sai định dạng (SNAP-005)", () => {
    const bad = JSON.parse(JSON.stringify(built));
    bad.epochs[0].stakes[0].owner = "xyz";
    expect(() => parseSnapshot(bad)).toThrow(/SNAP-005/);
  });

  it("THROW version lạ (SNAP-000)", () => {
    const bad = JSON.parse(JSON.stringify(built));
    bad.version = 2;
    expect(() => parseSnapshot(bad)).toThrow(/SNAP-000/);
  });
});
