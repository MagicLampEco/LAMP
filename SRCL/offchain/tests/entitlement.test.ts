// SRCL entitlement — tính đúng tỷ lệ stake + bảo toàn tổng quỹ epoch.

import { describe, it, expect } from "vitest";
import {
  computeSrclEntitlements, epochBudgetOildrop, snapshotEpoch, snapshotAll,
} from "../src/snapshotTool.js";
import {
  PER_EPOCH_OILDROP, REMAINDER_OILDROP, SRCL_TOTAL_OILDROP, EPOCHS, END_EPOCH,
  SRCL_CAMPAIGN_ID, ROLE_SPO,
} from "../src/constants.js";
import type { StakeEntry } from "../src/types.js";
import { verifyProof } from "../src/merkle.js";

describe("hằng quỹ SRCL", () => {
  it("tổng = 360 triệu LAMP = 3,6e14 oildrop", () => {
    expect(SRCL_TOTAL_OILDROP).toBe(360_000_000_000_000n);
  });
  it("36 epoch", () => {
    expect(EPOCHS).toBe(36n);
    expect(END_EPOCH).toBe(35n);
  });
  it("36 × PER_EPOCH + REMAINDER = tổng (không mất oildrop)", () => {
    expect(PER_EPOCH_OILDROP * EPOCHS + REMAINDER_OILDROP).toBe(SRCL_TOTAL_OILDROP);
  });
  it("PER_EPOCH = 10 triệu LAMP chẵn, dư 0", () => {
    // 3,6e14 / 36 = 10_000_000_000_000 oildrop = 10.000.000 LAMP. 360M ⋮ 36.
    expect(PER_EPOCH_OILDROP).toBe(10_000_000_000_000n);
    expect(REMAINDER_OILDROP).toBe(0n);
  });
});

describe("computeSrclEntitlements — tỷ lệ stake tất định (per-epoch, khác canonical TIGER)", () => {
  it("chia đôi đều khi stake bằng nhau", () => {
    const stakes: StakeEntry[] = [
      { owner: "aa", stake: 100n },
      { owner: "bb", stake: 100n },
    ];
    const ents = computeSrclEntitlements(0, stakes, 1000n);
    expect(ents.map((e) => e.amount).sort()).toEqual([500n, 500n]);
    expect(ents.reduce((a, e) => a + e.amount, 0n)).toBe(1000n);
  });

  it("tỷ lệ 1:3 → 250 : 750", () => {
    const stakes: StakeEntry[] = [
      { owner: "aa", stake: 100n },
      { owner: "bb", stake: 300n },
    ];
    const ents = computeSrclEntitlements(0, stakes, 1000n);
    const byOwner = Object.fromEntries(ents.map((e) => [e.owner, e.amount]));
    expect(byOwner["aa"]).toBe(250n);
    expect(byOwner["bb"]).toBe(750n);
  });

  it("dư do floor dồn ví stake lớn nhất; tổng == budget chính xác", () => {
    // stake 1:1:1, budget 1000 → 333 mỗi ví, dư 1 → ví max (đầu tiên) nhận 334.
    const stakes: StakeEntry[] = [
      { owner: "aa", stake: 10n },
      { owner: "bb", stake: 10n },
      { owner: "cc", stake: 10n },
    ];
    const ents = computeSrclEntitlements(0, stakes, 1000n);
    expect(ents.reduce((a, e) => a + e.amount, 0n)).toBe(1000n);
    expect(ents.map((e) => e.amount).sort((a, b) => Number(a - b))).toEqual([333n, 333n, 334n]);
  });

  it("budget thật của epoch — tổng entitlement == budget epoch", () => {
    const stakes: StakeEntry[] = [
      { owner: "aa", stake: 7n },
      { owner: "bb", stake: 11n },
      { owner: "cc", stake: 13n },
    ];
    const ents = computeSrclEntitlements(5, stakes);
    expect(ents.reduce((a, e) => a + e.amount, 0n)).toBe(epochBudgetOildrop(5));
  });

  it("epoch cuối (35) cộng dư lẻ REMAINDER", () => {
    expect(epochBudgetOildrop(35)).toBe(PER_EPOCH_OILDROP + REMAINDER_OILDROP);
    expect(epochBudgetOildrop(0)).toBe(PER_EPOCH_OILDROP);
  });

  it("bỏ qua ví stake 0", () => {
    const stakes: StakeEntry[] = [
      { owner: "aa", stake: 100n },
      { owner: "bb", stake: 0n },
    ];
    const ents = computeSrclEntitlements(0, stakes, 1000n);
    expect(ents.length).toBe(1);
    expect(ents[0]!.amount).toBe(1000n);
  });

  it("list rỗng / tổng stake 0 → entitlement rỗng", () => {
    expect(computeSrclEntitlements(0, [], 1000n)).toEqual([]);
    expect(computeSrclEntitlements(0, [{ owner: "aa", stake: 0n }], 1000n)).toEqual([]);
  });
});

describe("snapshotEpoch / snapshotAll — root + proof khớp", () => {
  it("snapshot 1 epoch → cây + proof verify đúng cho mọi entitlement", () => {
    const stakes: StakeEntry[] = [
      { owner: "a1", stake: 50n },
      { owner: "b2", stake: 150n },
      { owner: "c3", stake: 300n },
    ];
    const snap = snapshotEpoch(2, stakes);
    expect(snap.totalOildrop).toBe(epochBudgetOildrop(2));
    for (const e of snap.entitlements) {
      const proof = snap.tree.proofFor(BigInt(e.epoch), e.owner);
      // snapshotEpoch dùng campaign/role mặc định SRCL → verify với đúng cặp đó.
      expect(
        verifyProof(snap.root, SRCL_CAMPAIGN_ID, BigInt(e.epoch), ROLE_SPO, e.owner, e.amount, proof),
      ).toBe(true);
    }
  });

  it("snapshotAll nhiều epoch → roots index theo epoch, root khác nhau", () => {
    const m = new Map<number, StakeEntry[]>();
    m.set(0, [{ owner: "aa", stake: 1n }, { owner: "bb", stake: 2n }]);
    m.set(1, [{ owner: "aa", stake: 3n }, { owner: "bb", stake: 1n }]);
    const { roots, snapshots } = snapshotAll(m);
    expect(roots.length).toBe(2);
    expect(roots[0]).not.toBe(roots[1]); // stake khác → root khác.
    expect(snapshots[0]!.totalOildrop).toBe(epochBudgetOildrop(0));
  });
});
