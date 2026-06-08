import { describe, it, expect } from "vitest";
import {
  type Recipient, type SplitParam,
  weightsSum, allWeightsNonneg, allHashesSized, paramValid, minOilOk,
  floorPart, floorParts, splitAmounts, sumInts, mvpSplitParam,
} from "../offchain/src/split.js";
import { planDistribute } from "../offchain/src/distribute.js";

// ── Fixtures: custody hash 28 byte (script blake2b-224 = 56 hex) ──────────
const MLAMP = "11".repeat(28);
const APP = "22".repeat(28);
const NODE = "33".repeat(28);

function mvpRecipients(): Recipient[] {
  return [
    { custody_hash: MLAMP, weight_bps: 2000n },
    { custody_hash: APP, weight_bps: 8000n },
  ];
}
function threeRecipients(): Recipient[] {
  return [
    { custody_hash: MLAMP, weight_bps: 3333n },
    { custody_hash: APP, weight_bps: 3333n },
    { custody_hash: NODE, weight_bps: 3334n },
  ];
}

const LAMP_POLICY = "aabb".repeat(14);
const LAMP_NAME = "4c414d50";

// ── floorPart (mirror onchain floor_part) ─────────────────────────────────
describe("floorPart — ⌊ total × bps / 10000 ⌋", () => {
  it("20% / 80% của 1000", () => {
    expect(floorPart(1000n, 2000n)).toBe(200n);
    expect(floorPart(1000n, 8000n)).toBe(800n);
  });
  it("truncate toward floor", () => {
    expect(floorPart(1001n, 2000n)).toBe(200n); // 20.02 → 20
  });
});

// ── splitAmounts: 20/80 đúng ──────────────────────────────────────────────
describe("splitAmounts — chia 20/80 + remainder dồn đầu", () => {
  it("chia chẵn 1000 → [200, 800]", () => {
    expect(splitAmounts(1000n, mvpRecipients())).toEqual([200n, 800n]);
  });

  it("remainder dồn recipient ĐẦU (S2): 1001 → [201, 800]", () => {
    expect(splitAmounts(1001n, mvpRecipients())).toEqual([201n, 800n]);
  });

  it("total=1 → toàn bộ vào đầu [1, 0]", () => {
    expect(splitAmounts(1n, mvpRecipients())).toEqual([1n, 0n]);
  });

  it("3 recipient, remainder 1 dồn đầu: 100 → [34, 33, 33]", () => {
    expect(splitAmounts(100n, threeRecipients())).toEqual([34n, 33n, 33n]);
  });

  it("3 recipient, remainder 2 dồn đầu: 5 → [3, 1, 1]", () => {
    expect(splitAmounts(5n, threeRecipients())).toEqual([3n, 1n, 1n]);
  });
});

// ── S1: Σ parts == total TUYỆT ĐỐI (property — dải total rộng) ─────────────
describe("Σ parts == total (S1 — KHÔNG rơi oil)", () => {
  it("mvp: mọi total trong dải đều bảo toàn", () => {
    const rs = mvpRecipients();
    for (let t = 360n; t < 2000n; t++) {
      expect(sumInts(splitAmounts(t, rs))).toBe(t);
    }
  });

  it("3 recipient: mọi total đều bảo toàn (remainder ≤ 2)", () => {
    const rs = threeRecipients();
    for (let t = 0n; t < 1000n; t++) {
      expect(sumInts(splitAmounts(t, rs))).toBe(t);
    }
  });

  it("total lớn (tỉ) vẫn bảo toàn", () => {
    const rs = mvpRecipients();
    const big = 36_000_000_000n;
    expect(sumInts(splitAmounts(big, rs))).toBe(big);
  });
});

// ── property: remainder LUÔN vào phần tử đầu, các phần tử sau == floor ─────
describe("remainder chỉ tác động phần tử ĐẦU (S2)", () => {
  it("part_i (i≥1) == floorPart(total, weight_i)", () => {
    const rs = threeRecipients();
    for (let t = 0n; t < 500n; t++) {
      const parts = splitAmounts(t, rs);
      const floors = floorParts(t, rs);
      // i ≥ 1 khớp floor; i == 0 = floor_0 + remainder.
      for (let i = 1; i < rs.length; i++) {
        expect(parts[i]).toBe(floors[i]);
      }
      const remainder = t - sumInts(floors);
      expect(parts[0]).toBe(floors[0]! + remainder);
      expect(remainder >= 0n).toBe(true);
      expect(remainder < BigInt(rs.length)).toBe(true);
    }
  });
});

// ── min_oil biên (S3): 359 fail, 360 pass ─────────────────────────────────
describe("min_oil — total ≥ min_oil (S3)", () => {
  it("359 fail, 360 pass, 361 pass", () => {
    expect(minOilOk(359n, 360n)).toBe(false);
    expect(minOilOk(360n, 360n)).toBe(true);
    expect(minOilOk(361n, 360n)).toBe(true);
  });
});

// ── paramValid (S4 + cấu trúc) ────────────────────────────────────────────
describe("paramValid", () => {
  it("MVP hợp lệ", () => {
    expect(paramValid(mvpSplitParam(MLAMP, APP))).toBe(true);
  });

  it("Σ weight ≠ 10000 reject", () => {
    const bad: SplitParam = {
      recipients: [
        { custody_hash: MLAMP, weight_bps: 2000n },
        { custody_hash: APP, weight_bps: 7000n }, // Σ = 9000
      ],
      min_oil: 360n,
    };
    expect(paramValid(bad)).toBe(false);
  });

  it("< 2 recipient reject", () => {
    const bad: SplitParam = {
      recipients: [{ custody_hash: MLAMP, weight_bps: 10000n }],
      min_oil: 360n,
    };
    expect(paramValid(bad)).toBe(false);
  });

  it("min_oil âm reject", () => {
    expect(paramValid({ recipients: mvpRecipients(), min_oil: -1n })).toBe(false);
  });

  it("weight âm reject", () => {
    const bad: SplitParam = {
      recipients: [
        { custody_hash: MLAMP, weight_bps: -2000n },
        { custody_hash: APP, weight_bps: 12000n },
      ],
      min_oil: 360n,
    };
    expect(paramValid(bad)).toBe(false);
  });

  it("hash ≠ 28 byte reject", () => {
    const bad: SplitParam = {
      recipients: [
        { custody_hash: "c0c0", weight_bps: 2000n },
        { custody_hash: APP, weight_bps: 8000n },
      ],
      min_oil: 360n,
    };
    expect(paramValid(bad)).toBe(false);
  });

  it("hash với prefix 0x vẫn nhận đúng độ dài", () => {
    const ok: SplitParam = {
      recipients: [
        { custody_hash: "0x" + MLAMP, weight_bps: 2000n },
        { custody_hash: "0x" + APP, weight_bps: 8000n },
      ],
      min_oil: 360n,
    };
    expect(paramValid(ok)).toBe(true);
  });
});

describe("helper bất biến", () => {
  it("weightsSum == 10000", () => {
    expect(weightsSum(mvpRecipients())).toBe(10000n);
  });
  it("allWeightsNonneg true", () => {
    expect(allWeightsNonneg(mvpRecipients())).toBe(true);
  });
  it("allHashesSized true", () => {
    expect(allHashesSized(mvpRecipients())).toBe(true);
  });
});

// ── mirror onchain: vector cứng khớp split_test.ak ────────────────────────
describe("mirror onchain split_test.ak (vector khớp byte)", () => {
  it("các vector cứng giống aiken test", () => {
    const rs = mvpRecipients();
    expect(splitAmounts(1000n, rs)).toEqual([200n, 800n]);   // t_split_20_80_exact
    expect(splitAmounts(1001n, rs)).toEqual([201n, 800n]);   // t_split_remainder_to_first
    expect(splitAmounts(1n, rs)).toEqual([1n, 0n]);          // t_split_total_one_to_first
    const t3 = threeRecipients();
    expect(splitAmounts(100n, t3)).toEqual([34n, 33n, 33n]); // t_split_three_remainder_to_first
    expect(splitAmounts(5n, t3)).toEqual([3n, 1n, 1n]);      // t_split_three_remainder_two
  });
});

// ── planDistribute (orchestrator thuần) ───────────────────────────────────
describe("planDistribute — orchestrator thuần", () => {
  const APP_ID = "deadbeef";

  it("dựng item amount = part cho mỗi recipient, Σ == total", () => {
    const param = mvpSplitParam(MLAMP, APP);
    const plan = planDistribute(1000n, param, LAMP_POLICY, LAMP_NAME, APP_ID, 1n);
    expect(plan.parts).toEqual([200n, 800n]);
    expect(plan.plans[0]!.item.amount).toBe(200n);
    expect(plan.plans[1]!.item.amount).toBe(800n);
    expect(plan.plans[0]!.item.app_id).toBe(APP_ID);
    expect(plan.plans[0]!.item.category).toBe(1n);
    expect(sumInts(plan.parts)).toBe(1000n);
  });

  it("remainder vào MagicLamp (recipient đầu): total 1001 → MagicLamp 201", () => {
    const param = mvpSplitParam(MLAMP, APP);
    const plan = planDistribute(1001n, param, LAMP_POLICY, LAMP_NAME, APP_ID, 1n);
    expect(plan.plans[0]!.part).toBe(201n);
    expect(plan.plans[0]!.recipient.custody_hash).toBe(MLAMP);
    expect(plan.plans[1]!.part).toBe(800n);
  });

  it("total < min_oil (359) → ném DIST-002", () => {
    const param = mvpSplitParam(MLAMP, APP);
    expect(() => planDistribute(359n, param, LAMP_POLICY, LAMP_NAME, APP_ID, 1n))
      .toThrow(/DIST-002/);
  });

  it("total == min_oil (360) → pass, Σ == 360", () => {
    const param = mvpSplitParam(MLAMP, APP);
    const plan = planDistribute(360n, param, LAMP_POLICY, LAMP_NAME, APP_ID, 1n);
    expect(sumInts(plan.parts)).toBe(360n);
    // 360 × 20% = 72; 360 × 80% = 288; Σ = 360 (chia chẵn).
    expect(plan.parts).toEqual([72n, 288n]);
  });

  it("param Σ weight ≠ 10000 → ném DIST-001", () => {
    const bad: SplitParam = {
      recipients: [
        { custody_hash: MLAMP, weight_bps: 2000n },
        { custody_hash: APP, weight_bps: 7000n },
      ],
      min_oil: 360n,
    };
    expect(() => planDistribute(1000n, bad, LAMP_POLICY, LAMP_NAME, APP_ID, 1n))
      .toThrow(/DIST-001/);
  });

  it("Σ parts == total cho dải total (S1 qua orchestrator)", () => {
    const param = mvpSplitParam(MLAMP, APP);
    for (let t = 360n; t < 1500n; t++) {
      const plan = planDistribute(t, param, LAMP_POLICY, LAMP_NAME, APP_ID, 1n);
      expect(sumInts(plan.parts)).toBe(t);
    }
  });
});
