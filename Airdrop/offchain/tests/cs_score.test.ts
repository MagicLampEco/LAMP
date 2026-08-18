// cs_score.test.ts — kiểm chứng phân phối stake-weighted (spo-cs.md).
// Mọi tiền là BigInt oildrop. 1 LAMP = 10^6 oildrop.

import { describe, it, expect } from "vitest";
import {
  splitByStake,
  splitSpoPot,
  splitCsPot,
  type StakeWeight,
} from "../src/cs_score.js";
import { OILDROP_PER_LAMP, SPO_POT_OILDROP, CS_POT_OILDROP } from "../src/constants.js";

const LAMP = OILDROP_PER_LAMP;
const sum = (rs: { oildrop: bigint }[]) => rs.reduce((s, r) => s + r.oildrop, 0n);

describe("splitByStake — bảo toàn tuyệt đối (Σ = pot)", () => {
  it("stake khác nhau → Σ oildrop = pot, dư floor gom hết", () => {
    // pot 100 oildrop chia cho stake 1:1:1 → 34/33/33, Σ=100
    const rs = splitByStake(
      [{ id: "a", stake: 1n }, { id: "b", stake: 1n }, { id: "c", stake: 1n }],
      100n,
    );
    expect(sum(rs)).toBe(100n);
    // dư floor về stake lớn nhất (tie → id hex nhỏ nhất = "a")
    expect(rs.map((r) => r.oildrop)).toEqual([34n, 33n, 33n]);
  });

  it("chia sạch: Σ = pot chính xác", () => {
    const rs = splitByStake(
      [{ id: "a", stake: 1000n }, { id: "b", stake: 3000n }, { id: "c", stake: 6000n }],
      10_000n,
    );
    expect(rs.find((r) => r.id === "a")!.oildrop).toBe(1_000n);
    expect(rs.find((r) => r.id === "b")!.oildrop).toBe(3_000n);
    expect(rs.find((r) => r.id === "c")!.oildrop).toBe(6_000n);
    expect(sum(rs)).toBe(10_000n);
  });
});

describe("∝ stake — trọng số lớn hơn ⇒ reward lớn hơn", () => {
  it("thứ hạng reward khớp thứ hạng stake", () => {
    const rs = splitByStake(
      [{ id: "small", stake: 10n }, { id: "mid", stake: 50n }, { id: "big", stake: 200n }],
      1_000_000n,
    );
    const by = Object.fromEntries(rs.map((r) => [r.id, r.oildrop]));
    expect(by.big!).toBeGreaterThan(by.mid!);
    expect(by.mid!).toBeGreaterThan(by.small!);
    // tỷ lệ đúng: big=200/260·1e6=769230(.7); dư floor (2) gom về stake lớn nhất = big
    expect(by.big!).toBe(769_232n); // 769230 floor + 2 dư floor
    expect(by.mid!).toBe(192_307n);
    expect(by.small!).toBe(38_461n);
    expect(sum(rs)).toBe(1_000_000n);
  });
});

describe("cap tuỳ chọn mỗi-người (như ETD capOildrop)", () => {
  it("người vượt cap bị ghim = cap, dư chia lại cho người chưa cap", () => {
    // stake 100:1:1, pot 300, cap 150 → whale ghim 150, còn 150 cho 2 người nhỏ
    const rs = splitByStake(
      [{ id: "whale", stake: 100n }, { id: "x", stake: 1n }, { id: "y", stake: 1n }],
      300n,
      150n,
    );
    const by = Object.fromEntries(rs.map((r) => [r.id, r.oildrop]));
    expect(by.whale!).toBe(150n); // ghim ở cap
    expect(by.x! + by.y!).toBe(150n); // dư chia cho 2 người nhỏ
    expect(sum(rs)).toBe(300n);
    for (const r of rs) expect(r.oildrop).toBeLessThanOrEqual(150n);
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
    for (const r of rs) expect(r.oildrop).toBe(0n);
    expect(5_000n - sum(rs)).toBe(5_000n);
  });

  it("1 recipient duy nhất → nhận TOÀN BỘ pot", () => {
    const rs = splitByStake([{ id: "solo", stake: 42n }], 7_777n);
    expect(rs).toEqual([{ id: "solo", oildrop: 7_777n }]);
  });

  it("id trùng → ném lỗi (chống thổi phồng trọng số)", () => {
    expect(() =>
      splitByStake([{ id: "dup", stake: 1n }, { id: "dup", stake: 9n }], 100n),
    ).toThrow();
  });

  it("potOildrop âm → ném lỗi", () => {
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
  const by = Object.fromEntries(rs.map((r) => [r.id, r.oildrop]));

  it("mặc định potOildrop = SPO_POT_OILDROP = 5.000.000 LAMP", () => {
    expect(SPO_POT_OILDROP).toBe(5_000_000n * LAMP);
  });

  it("reward ∝ stake-vào-pool: A:B:C = 1:3:6", () => {
    expect(by.spoA! / LAMP).toBe(500_000n); // 5M × 1/10
    expect(by.spoB! / LAMP).toBe(1_500_000n); // 5M × 3/10
    expect(by.spoC! / LAMP).toBe(3_000_000n); // 5M × 6/10
    expect(by.spoC!).toBeGreaterThan(by.spoB!);
    expect(by.spoB!).toBeGreaterThan(by.spoA!);
  });

  it("bảo toàn: Σ = SPO_POT_OILDROP = 5.000.000 LAMP", () => {
    expect(sum(rs)).toBe(SPO_POT_OILDROP);
    expect(sum(rs)).toBe(5_000_000n * LAMP);
  });
});

describe("splitCsPot — trọng số = Σ phiếu-stake phân bổ cho người nhận (mặc định 15M LAMP)", () => {
  // Người nhận KHÔNG cần là SPO. weight_stake = Σ allocation_d(j), kể cả d = j
  // (tự bỏ phiếu hợp lệ — spo-cs.md §3.4/§3.5).
  const csWeights: StakeWeight[] = [
    { id: "sup1", stake: 200n },
    { id: "sup2", stake: 300n },
  ];
  const rs = splitCsPot(csWeights);
  const by = Object.fromEntries(rs.map((r) => [r.id, r.oildrop]));

  it("mặc định potOildrop = CS_POT_OILDROP = 15.000.000 LAMP", () => {
    expect(CS_POT_OILDROP).toBe(15_000_000n * LAMP);
  });

  it("reward ∝ stake-bình-chọn: sup1:sup2 = 2:3", () => {
    expect(by.sup1! / LAMP).toBe(6_000_000n); // 15M × 2/5
    expect(by.sup2! / LAMP).toBe(9_000_000n); // 15M × 3/5
  });

  it("bảo toàn: Σ = CS_POT_OILDROP = 15.000.000 LAMP", () => {
    expect(sum(rs)).toBe(CS_POT_OILDROP);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GHIM NGỮ NGHĨA §3.5 — làn CS LÀ stake-weighted (Q10, phương án (c))
//
// Ràng buộc DUY NHẤT của làn CS: Σ_j allocation_d(j) ≤ accStake(d). KHÔNG có
// mệnh đề `j ≠ d` ⇒ tự bỏ phiếu hợp lệ + là chiến lược trội tuyệt đối ⇒ điểm
// cân bằng weight_CS(j) = accStake(j), tức pot CS = đợt chia-theo-stake thứ hai.
// Test này ghim đúng hành vi đó để không ai lặng lẽ khôi phục ngữ nghĩa
// "thưởng đóng góp được công nhận" (spo-cs.md §3.5).
// ─────────────────────────────────────────────────────────────────────────
describe("§3.5 — tự bỏ phiếu hợp lệ ⇒ làn CS thoái hoá thành chia theo stake", () => {
  // 3 delegator đã đăng ký, accStake 200 : 300 : 500 (Σ = 1000).
  const accStake = { d1: 200n, d2: 300n, d3: 500n };
  const TOTAL = accStake.d1 + accStake.d2 + accStake.d3; // 1000n

  const rewardOf = (ws: StakeWeight[], id: string) =>
    splitCsPot(ws).find((r) => r.id === id)!.oildrop;

  it("người nhận trùng người bầu (j = d) được chấp nhận — không có cổng `j ≠ d`", () => {
    // d1 tự phân bổ toàn bộ phiếu-stake cho chính mình.
    const ws: StakeWeight[] = [{ id: "d1", stake: accStake.d1 }];
    expect(() => splitCsPot(ws)).not.toThrow();
    expect(splitCsPot(ws)[0]!.oildrop).toBe(CS_POT_OILDROP); // 1 người ⇒ trọn pot
  });

  it("tự bỏ phiếu là chiến lược TRỘI: dồn phiếu về mình ⇒ reward tăng nghiêm ngặt", () => {
    // Tổng trọng số toàn cục giữ nguyên = 1000 ở cả 3 kịch bản → so sánh sạch.
    // (a) d1 tặng HẾT 200 phiếu-stake cho d2.
    const giveAll: StakeWeight[] = [
      { id: "d1", stake: 0n },
      { id: "d2", stake: accStake.d2 + accStake.d1 }, // 500
      { id: "d3", stake: accStake.d3 },
    ];
    // (b) d1 tặng một nửa (100), giữ lại 100.
    const giveHalf: StakeWeight[] = [
      { id: "d1", stake: 100n },
      { id: "d2", stake: accStake.d2 + 100n }, // 400
      { id: "d3", stake: accStake.d3 },
    ];
    // (c) d1 tự bỏ phiếu toàn bộ.
    const selfVote: StakeWeight[] = [
      { id: "d1", stake: accStake.d1 },
      { id: "d2", stake: accStake.d2 },
      { id: "d3", stake: accStake.d3 },
    ];

    const a = rewardOf(giveAll, "d1");
    const b = rewardOf(giveHalf, "d1");
    const c = rewardOf(selfVote, "d1");

    expect(a).toBe(0n); // tặng đi ⇒ nhận 0 từ phần đã tặng
    expect(b).toBeGreaterThan(a); // giữ lại một nửa ⇒ tăng nghiêm ngặt
    expect(c).toBeGreaterThan(b); // giữ hết ⇒ tăng tiếp
    // Cơ chế KHÔNG bù cho người tặng: phần d1 tặng đi chảy sang d2.
    expect(rewardOf(giveAll, "d2")).toBeGreaterThan(rewardOf(selfVote, "d2"));
  });

  it("cân bằng (mọi người tự bỏ phiếu) ⇒ reward_CS = chia pot 15M ∝ accStake", () => {
    const equilibrium: StakeWeight[] = [
      { id: "d1", stake: accStake.d1 },
      { id: "d2", stake: accStake.d2 },
      { id: "d3", stake: accStake.d3 },
    ];
    const by = Object.fromEntries(splitCsPot(equilibrium).map((r) => [r.id, r.oildrop]));

    // 15M LAMP × 200/1000 = 3.000.000 LAMP, v.v. — y hệt một đợt airdrop
    // chia theo stake, chồng lên pot Delegator 100M (spo-cs.md §3.5).
    expect(by.d1! / LAMP).toBe(3_000_000n);
    expect(by.d2! / LAMP).toBe(4_500_000n);
    expect(by.d3! / LAMP).toBe(7_500_000n);

    // Bất biến: kết quả TRÙNG KHỚP splitByStake trên chính accStake — bằng
    // chứng làn CS không thêm một đại lượng "đóng góp" nào ngoài stake.
    expect(splitCsPot(equilibrium)).toEqual(
      splitByStake(equilibrium, CS_POT_OILDROP),
    );
    expect(sum(splitCsPot(equilibrium))).toBe(CS_POT_OILDROP);
    expect(TOTAL).toBe(1000n);
  });
});
