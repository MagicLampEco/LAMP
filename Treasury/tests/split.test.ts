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

// ── GUARD total < 0 + parity onchain↔offchain trên dải total ÂM ───────────
// Aiken `/` = FLOOR division (về -∞); JS BigInt `/` = trunc-toward-zero. Hai phép
// CHỈ trùng khi total ≥ 0. splitAmounts ép total ≥ 0 (mirror split_amounts) → []
// cho total < 0, tránh miền lệch. Test này khoá hành vi + đối chiếu giá trị floor
// số âm THỰC của Aiken (hard-code từ aiken test t_floor_part_negative_is_floor).
describe("guard total < 0 + parity miền âm (mirror split.ak)", () => {
  it("total < 0 → [] (guard, mirror onchain t_split_negative_total_empty)", () => {
    expect(splitAmounts(-101n, mvpRecipients())).toEqual([]);
    expect(splitAmounts(-1n, threeRecipients())).toEqual([]);
  });

  it("total = 0 (biên) qua guard → [0, 0], Σ = 0", () => {
    const p = splitAmounts(0n, mvpRecipients());
    expect(p).toEqual([0n, 0n]);
    expect(sumInts(p)).toBe(0n);
  });

  it("floorPart số âm: JS TRUNC khác Aiken FLOOR — minh chứng lý do guard", () => {
    // JS BigInt trunc-toward-zero: -202000n/10000n = -20n.
    expect(floorPart(-101n, 2000n)).toBe(-20n);
    expect(floorPart(-101n, 8000n)).toBe(-80n);
    // Onchain Aiken FLOOR (về -∞) cho -21n / -81n (aiken test xác nhận).
    // ⇒ JS ≠ Aiken ở total âm; guard total≥0 ở CẢ HAI khoá miền trùng.
    const AIKEN_FLOOR_101_2000 = -21n; // giá trị onchain thực
    const AIKEN_FLOOR_101_8000 = -81n;
    expect(floorPart(-101n, 2000n)).not.toBe(AIKEN_FLOOR_101_2000);
    expect(floorPart(-101n, 8000n)).not.toBe(AIKEN_FLOOR_101_8000);
  });

  it("guard đồng bộ: với total < 0, cả hai impl trả [] ⇒ KHÔNG còn lệch", () => {
    for (let t = -500n; t < 0n; t++) {
      expect(splitAmounts(t, mvpRecipients())).toEqual([]);
      expect(splitAmounts(t, threeRecipients())).toEqual([]);
    }
  });
});

// ── parity vector cứng onchain (mirror split_test.ak) trên dải total ≥ 0 rộng ─
// Hard-code giá trị onchain (đã xác nhận bằng aiken test) vào offchain để bắt drift.
describe("parity vector cứng onchain↔offchain (dải total ≥ 0 rộng)", () => {
  it("mvp 20/80: vector khớp byte với split_amounts onchain", () => {
    const rs = mvpRecipients();
    // [total, expected] — onchain cho cùng kết quả (floor + remainder dồn đầu).
    const cases: [bigint, bigint[]][] = [
      [0n, [0n, 0n]],
      [1n, [1n, 0n]],
      [359n, [72n, 287n]],     // 359×0.2=71.8→71; 359×0.8=287.2→287; rem=1 → 72,287
      [360n, [72n, 288n]],
      [361n, [73n, 288n]],     // 361×0.2=72.2→72; 361×0.8=288.8→288; rem=1 → 73,288
      [9999n, [2000n, 7999n]], // 9999×0.2=1999.8→1999; ×0.8=7999.2→7999; rem=1 → 2000,7999
      [36_000_000_000_000_000n, [7_200_000_000_000_000n, 28_800_000_000_000_000n]], // 36 tỉ × 10^6
    ];
    for (const [t, exp] of cases) {
      expect(splitAmounts(t, rs)).toEqual(exp);
      expect(sumInts(splitAmounts(t, rs))).toBe(t);
    }
  });

  it("3 recipient 3333/3333/3334: vector khớp byte onchain", () => {
    const rs = threeRecipients();
    const cases: [bigint, bigint[]][] = [
      [0n, [0n, 0n, 0n]],
      [5n, [3n, 1n, 1n]],
      [100n, [34n, 33n, 33n]],
      [9999n, [3334n, 3332n, 3333n]], // floor 3332/3332/3333 Σ=8997 rem=2 → đầu nhận 3334
    ];
    for (const [t, exp] of cases) {
      expect(splitAmounts(t, rs)).toEqual(exp);
      expect(sumInts(splitAmounts(t, rs))).toBe(t);
    }
  });

  it("weight biên 0/10000: phần tử đầu nhận remainder, đuôi = floor", () => {
    const rs: Recipient[] = [
      { custody_hash: MLAMP, weight_bps: 0n },
      { custody_hash: APP, weight_bps: 10000n },
    ];
    // weight 10000 bps = toàn bộ ⇒ floor đuôi = total chẵn, remainder = 0.
    expect(splitAmounts(1000n, rs)).toEqual([0n, 1000n]);
    expect(splitAmounts(1001n, rs)).toEqual([0n, 1001n]);
    expect(sumInts(splitAmounts(1001n, rs))).toBe(1001n);
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
