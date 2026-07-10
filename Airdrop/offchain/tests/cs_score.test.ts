// cs_score.test.ts — kiểm chứng phân phối stake-weighted (SPO-CS-SPEC-Vi.md).
// Mọi tiền là BigInt oildrop. 1 LAMP = 10^6 oildrop.

import { describe, it, expect } from "vitest";
import {
  splitByStake,
  splitSpoPot,
  splitScPot,
  type StakeWeight,
} from "../src/cs_score.js";
import { OIL_PER_LAMP, SPO_POT_OIL, SC_POT_OIL } from "../src/constants.js";

const LAMP = OIL_PER_LAMP;
const sum = (rs: { oil: bigint }[]) => rs.reduce((s, r) => s + r.oil, 0n);

describe("splitByStake — bảo toàn tuyệt đối (Σ = pot)", () => {
  it("stake khác nhau → Σ oil = pot, dư floor gom hết", () => {
    // pot 100 oildrop chia cho stake 1:1:1 → 34/33/33, Σ=100
    const rs = splitByStake(
      [{ id: "a", stake: 1n }, { id: "b", stake: 1n }, { id: "c", stake: 1n }],
      100n,
    );
    expect(sum(rs)).toBe(100n);
    // dư floor về stake lớn nhất (tie → id hex nhỏ nhất = "a")
    expect(rs.map((r) => r.oil)).toEqual([34n, 33n, 33n]);
  });

  it("chia sạch: Σ = pot chính xác", () => {
    const rs = splitByStake(
      [{ id: "a", stake: 1000n }, { id: "b", stake: 3000n }, { id: "c", stake: 6000n }],
      10_000n,
    );
    expect(rs.find((r) => r.id === "a")!.oil).toBe(1_000n);
    expect(rs.find((r) => r.id === "b")!.oil).toBe(3_000n);
    expect(rs.find((r) => r.id === "c")!.oil).toBe(6_000n);
    expect(sum(rs)).toBe(10_000n);
  });
});

describe("∝ stake — trọng số lớn hơn ⇒ reward lớn hơn", () => {
  it("thứ hạng reward khớp thứ hạng stake", () => {
    const rs = splitByStake(
      [{ id: "small", stake: 10n }, { id: "mid", stake: 50n }, { id: "big", stake: 200n }],
      1_000_000n,
    );
    const by = Object.fromEntries(rs.map((r) => [r.id, r.oil]));
    expect(by.big!).toBeGreaterThan(by.mid!);
    expect(by.mid!).toBeGreaterThan(by.small!);
    // tỷ lệ đúng: big=200/260·1e6=769230(.7); dư floor (2) gom về stake lớn nhất = big
    expect(by.big!).toBe(769_232n); // 769230 floor + 2 dư floor
    expect(by.mid!).toBe(192_307n);
    expect(by.small!).toBe(38_461n);
    expect(sum(rs)).toBe(1_000_000n);
  });
});

describe("cap tuỳ chọn mỗi-người (như ETD capOil)", () => {
  it("người vượt cap bị ghim = cap, dư chia lại cho người chưa cap", () => {
    // stake 100:1:1, pot 300, cap 150 → whale ghim 150, còn 150 cho 2 người nhỏ
    const rs = splitByStake(
      [{ id: "whale", stake: 100n }, { id: "x", stake: 1n }, { id: "y", stake: 1n }],
      300n,
      150n,
    );
    const by = Object.fromEntries(rs.map((r) => [r.id, r.oil]));
    expect(by.whale!).toBe(150n); // ghim ở cap
    expect(by.x! + by.y!).toBe(150n); // dư chia cho 2 người nhỏ
    expect(sum(rs)).toBe(300n);
    for (const r of rs) expect(r.oil).toBeLessThanOrEqual(150n);
  });

  it("cap chặn không chia hết → leftover về Treasury", () => {
    // 2 người, cap 10 mỗi người → tối đa 20, pot 100 → leftover 80
    const rs = splitByStake(
      [{ id: "a", stake: 1n }, { id: "b", stake: 1n }],
      100n,
      10n,
    );
    expect(sum(rs)).toBe(20n);
    expect(100n - sum(rs)).toBe(80n); // leftover
  });
});

describe("cạnh biên", () => {
  it("không recipient nào (mảng rỗng) → leftover = pot", () => {
    const rs = splitByStake([], 5_000n);
    expect(rs).toEqual([]);
    expect(sum(rs)).toBe(0n);
    expect(5_000n - sum(rs)).toBe(5_000n); // leftover = pot
  });

  it("toàn stake 0 → không ai nhận, leftover = pot", () => {
    const rs = splitByStake(
      [{ id: "a", stake: 0n }, { id: "b", stake: 0n }],
      5_000n,
    );
    expect(sum(rs)).toBe(0n);
    for (const r of rs) expect(r.oil).toBe(0n);
    expect(5_000n - sum(rs)).toBe(5_000n);
  });

  it("1 recipient duy nhất → nhận TOÀN BỘ pot", () => {
    const rs = splitByStake([{ id: "solo", stake: 42n }], 7_777n);
    expect(rs).toEqual([{ id: "solo", oil: 7_777n }]);
  });

  it("id trùng → ném lỗi (chống thổi phồng trọng số)", () => {
    expect(() =>
      splitByStake([{ id: "dup", stake: 1n }, { id: "dup", stake: 9n }], 100n),
    ).toThrow();
  });

  it("potOil âm → ném lỗi", () => {
    expect(() => splitByStake([{ id: "a", stake: 1n }], -1n)).toThrow();
  });
});

describe("splitSpoPot — trọng số = stake chảy vào pool (mặc định 5M LAMP)", () => {
  // 3 SPO, stake-vào-pool khác nhau 1:3:6 (tổng 10M lovelace, con số minh hoạ).
  const spoWeights: StakeWeight[] = [
    { id: "spoA", stake: 1_000_000n },
    { id: "spoB", stake: 3_000_000n },
    { id: "spoC", stake: 6_000_000n },
  ];
  const rs = splitSpoPot(spoWeights);
  const by = Object.fromEntries(rs.map((r) => [r.id, r.oil]));

  it("mặc định potOil = SPO_POT_OIL = 5.000.000 LAMP", () => {
    expect(SPO_POT_OIL).toBe(5_000_000n * LAMP);
  });

  it("reward ∝ stake-vào-pool: A:B:C = 1:3:6", () => {
    expect(by.spoA! / LAMP).toBe(500_000n); // 5M × 1/10
    expect(by.spoB! / LAMP).toBe(1_500_000n); // 5M × 3/10
    expect(by.spoC! / LAMP).toBe(3_000_000n); // 5M × 6/10
    expect(by.spoC!).toBeGreaterThan(by.spoB!);
    expect(by.spoB!).toBeGreaterThan(by.spoA!);
  });

  it("bảo toàn: Σ = SPO_POT_OIL = 5.000.000 LAMP", () => {
    expect(sum(rs)).toBe(SPO_POT_OIL);
    expect(sum(rs)).toBe(5_000_000n * LAMP);
  });
});

describe("splitScPot — trọng số = stake người bình chọn (mặc định 15M LAMP)", () => {
  // supporter KHÔNG cần là SPO. weight_stake = Σ stake người bình chọn cho họ.
  const scWeights: StakeWeight[] = [
    { id: "sup1", stake: 200n },
    { id: "sup2", stake: 300n },
  ];
  const rs = splitScPot(scWeights);
  const by = Object.fromEntries(rs.map((r) => [r.id, r.oil]));

  it("mặc định potOil = SC_POT_OIL = 15.000.000 LAMP", () => {
    expect(SC_POT_OIL).toBe(15_000_000n * LAMP);
  });

  it("reward ∝ stake-bình-chọn: sup1:sup2 = 2:3", () => {
    expect(by.sup1! / LAMP).toBe(6_000_000n); // 15M × 2/5
    expect(by.sup2! / LAMP).toBe(9_000_000n); // 15M × 3/5
  });

  it("bảo toàn: Σ = SC_POT_OIL = 15.000.000 LAMP", () => {
    expect(sum(rs)).toBe(SC_POT_OIL);
  });
});
