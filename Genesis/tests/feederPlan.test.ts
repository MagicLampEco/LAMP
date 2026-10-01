// Phần thuần của `30_feeder_accounts.ts`: dải khoá, sức chứa kho, chọn lượt rút, đích gom, kế hoạch rót pot.
//
// Ca đáng giữ nhất là `pickNextRedeem` ở trạng thái "mọi tài khoản cùng bị cắt ngọn về một số":
// đó là trạng thái THƯỜNG của dốc đầu (trần sàn 1.000 LAMP áp cho mọi lượt), và một bộ chọn
// không có luật hoà sẽ chọn theo thứ tự trả về của nhà cung cấp — hai lần chạy trên cùng một
// trạng thái chọn hai tài khoản khác nhau, và không gì báo.
import { describe, it, expect } from "vitest";
import { credentialToAddress, keyHashToCredential } from "@lucid-evolution/lucid";

import {
  feederIndices, grantsThatFit, pickNextRedeem, chunk, assertSweepTarget, trancheCost,
  planPotFunding, planSweep, sweepAmountFromEnv, dryRunAtFromEnv, withDeadline,
  type FeederAccount, type FeederUtxo,
} from "../scripts/_feederPlan.js";
import { TRIM_FLOOR, epochWindow } from "../../Distribution/offchain/src/constants.js";
import type {
  BeaconDatum, ClaimAccountDatum, TreasuryDatum,
} from "../../Distribution/offchain/src/types.js";

const LAMP = 1_000_000n;
const E = 500_500n * LAMP;

const beacon: BeaconDatum = {
  epoch: 4144n, kind: "DropParam", index: 0n, rate_root: 77_460n,
  trim_num: 1n, trim_den: 1_000n, speed_policies: [],
};
const treasury = (totalRedeemed: bigint): TreasuryDatum => ({
  committee_hash: "00", outstanding_entitlement: 0n, total_redeemed: totalRedeemed,
});
const acc = (pkh: string, entitlement: bigint, redeemed = 0n, indexAtStart = 0n): FeederAccount => ({
  pkh,
  datum: {
    owner: pkh, entitlement, redeemed, start_epoch: 4144n, drops_per_epoch: 1n,
    index_at_start: indexAtStart,
  } satisfies ClaimAccountDatum,
});

describe("feederIndices — dải khoá feeder", () => {
  it("base 1 count 3 ⇒ [1,2,3]", () => {
    expect(feederIndices({ base: 1, count: 3 })).toEqual([1, 2, 3]);
  });
  it("count 0 ⇒ dải rỗng", () => {
    expect(feederIndices({ base: 5, count: 0 })).toEqual([]);
  });
  it("base 0 ⇒ FEED-RANGE-002 (index 0 là ví vận hành)", () => {
    expect(() => feederIndices({ base: 0, count: 1 })).toThrow(/FEED-RANGE-002/);
  });
  it("không nguyên ⇒ FEED-RANGE-001", () => {
    expect(() => feederIndices({ base: 1.5, count: 1 })).toThrow(/FEED-RANGE-001/);
  });
  it("count âm ⇒ FEED-RANGE-003", () => {
    expect(() => feederIndices({ base: 1, count: -1 })).toThrow(/FEED-RANGE-003/);
  });
  it("vượt chỉ số hardened ⇒ FEED-RANGE-004", () => {
    expect(() => feederIndices({ base: 0x7fffffff, count: 2 })).toThrow(/FEED-RANGE-004/);
    expect(feederIndices({ base: 0x7fffffff, count: 1 })).toEqual([0x7fffffff]);
  });
});

describe("grantsThatFit — sức chứa kho (outstanding + E ≤ pool)", () => {
  it("vừa đúng bội số", () => {
    expect(grantsThatFit(10n * E, 0n, E, 100)).toBe(10);
  });
  it("trừ phần đã nợ, làm tròn xuống", () => {
    expect(grantsThatFit(10n * E, 3n * E + 1n, E, 100)).toBe(6);
  });
  it("muốn ít hơn sức chứa ⇒ trả số muốn", () => {
    expect(grantsThatFit(10n * E, 0n, E, 4)).toBe(4);
  });
  it("kho đầy hoặc âm ⇒ 0, không ném", () => {
    expect(grantsThatFit(E, E, E, 5)).toBe(0);
    expect(grantsThatFit(E - 1n, 0n, E, 5)).toBe(0);
    expect(grantsThatFit(0n, 1n, E, 5)).toBe(0);
  });
  it("E ≤ 0 ⇒ FEED-GRANT-001", () => {
    expect(() => grantsThatFit(E, 0n, 0n, 1)).toThrow(/FEED-GRANT-001/);
  });
});

describe("pickNextRedeem — chọn lượt rút kế tiếp", () => {
  const w = 4146n;   // hai cửa sổ sau mốc ⇒ A_span = 2w > 0

  it("dốc đầu: mọi tài khoản bị cắt về trần sàn ⇒ hoà ⇒ chọn pkh nhỏ nhất, bất kể thứ tự vào", () => {
    const xs = [acc("cc", E), acc("aa", E), acc("bb", E)];
    const p = pickNextRedeem(xs, beacon, treasury(0n), w, TRIM_FLOOR, 1n);
    expect(p).toEqual({ pkh: "aa", amount: TRIM_FLOOR });
    const q = pickNextRedeem([...xs].reverse(), beacon, treasury(0n), w, TRIM_FLOOR, 1n);
    expect(q).toEqual(p);
  });

  it("trần đã nới: chọn tài khoản rút được NHIỀU nhất, kể cả khi nó đứng sau", () => {
    const big = treasury(1_000_000_000n * LAMP);   // trần = 1e6 LAMP, trên mọi vested ở đây
    const xs = [acc("aa", 1_000n * LAMP), acc("zz", E)];
    const p = pickNextRedeem(xs, beacon, big, w, TRIM_FLOOR, 1n)!;
    expect(p.pkh).toBe("zz");
    expect(p.amount).toBeGreaterThan(1_000n * LAMP);
  });

  it("ngưỡng tối thiểu loại lượt rút vụn", () => {
    const xs = [acc("aa", 500n * LAMP)];            // cả đời chỉ 500 LAMP
    expect(pickNextRedeem(xs, beacon, treasury(0n), w, TRIM_FLOOR, TRIM_FLOOR)).toBeNull();
    expect(pickNextRedeem(xs, beacon, treasury(0n), w, TRIM_FLOOR, 1n)).toEqual({ pkh: "aa", amount: 500n * LAMP });
  });

  it("tài khoản mở ngay cửa sổ này (A_span = 0) và tài khoản đã rút trọn ⇒ bỏ qua", () => {
    const aNow = beacon.index + beacon.rate_root * (w - beacon.epoch);
    const xs = [acc("aa", E, 0n, aNow), acc("bb", E, E)];
    expect(pickNextRedeem(xs, beacon, treasury(0n), w, TRIM_FLOOR, 1n)).toBeNull();
  });

  it("danh sách rỗng ⇒ null", () => {
    expect(pickNextRedeem([], beacon, treasury(0n), w, TRIM_FLOOR, 1n)).toBeNull();
  });

  it("một feeder hai tài khoản (chuỗi không chặn đúc trùng tên) ⇒ trả ref, hoà thì ref nhỏ hơn", () => {
    const xs = [{ ...acc("aa", E), ref: "ff#1" }, { ...acc("aa", E), ref: "11#0" }];
    const p = pickNextRedeem(xs, beacon, treasury(0n), w, TRIM_FLOOR, 1n);
    expect(p).toEqual({ pkh: "aa", amount: TRIM_FLOOR, ref: "11#0" });
    expect(pickNextRedeem([...xs].reverse(), beacon, treasury(0n), w, TRIM_FLOOR, 1n)).toEqual(p);
  });
});

describe("chunk — lô gom", () => {
  it("cắt đều và phần dư", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("cỡ lô < 1 ⇒ FEED-SWEEP-001", () => {
    expect(() => chunk([1], 0)).toThrow(/FEED-SWEEP-001/);
  });
});

describe("assertSweepTarget — đích gom chỉ là ví payment-key đúng mạng", () => {
  const pkh = "603249abe9bc29ea474777fc4cfc2f220a784a53e201b9b9afac5ff5";
  const vkPreprod = credentialToAddress("Preprod", keyHashToCredential(pkh));
  const vkMainnet = credentialToAddress("Mainnet", keyHashToCredential(pkh));
  const scriptPreprod = "addr_test1wptvkfjptza8ljj7cpqg34383v426rjmlpx30a0r23srs6qlrp83y";

  it("ví payment-key Preprod ⇒ qua", () => {
    expect(() => assertSweepTarget(vkPreprod, 0)).not.toThrow();
  });
  it("địa chỉ script ⇒ FEED-SWEEP-003", () => {
    expect(() => assertSweepTarget(scriptPreprod, 0)).toThrow(/FEED-SWEEP-003/);
  });
  it("sai mạng ⇒ FEED-SWEEP-002", () => {
    expect(() => assertSweepTarget(vkMainnet, 0)).toThrow(/FEED-SWEEP-002/);
  });
  it("trống ⇒ FEED-SWEEP-002", () => {
    expect(() => assertSweepTarget("", 0)).toThrow(/FEED-SWEEP-002/);
  });
});

describe("trancheCost — chi phí một đợt grant", () => {
  it("2.000 feeder × 500.500 LAMP = 1,001 tỷ LAMP · khoá 4.000 ADA · phí ~1.000 ADA", () => {
    const c = trancheCost(2_000, E);
    expect(c.entitlementTotal).toBe(1_001_000_000n * LAMP);
    expect(c.lockedLovelace).toBe(4_000_000_000n);
    expect(c.grantFeeLovelace).toBe(1_000_000_000n);
  });
});

describe("planPotFunding — chọn UTxO LAMP ở feeder để rót thẳng vào pot", () => {
  const U = "ab".repeat(28) + "744c414d50";
  const X = "cd".repeat(28) + "58";
  const fu = (index: number, lampAmt: bigint, extra: Record<string, bigint> = {}, ref = `${index}#0`): FeederUtxo => ({
    index, pkh: `pkh${index}`, address: `addr_feeder_${index}`, ref,
    assets: { lovelace: 1_200_000n, [U]: lampAmt, ...extra },
  });
  // minPotAmount = 1: các ca dưới đây canh phép chọn/chia lô, không canh suất pot (khối riêng ở cuối).
  const base = { lampUnit: U, batchSize: 2, maxTx: 10, allowPartial: false, minPotAmount: 1n };

  it("đủ ⇒ chọn lớn trước, lô ≤ batchSize, output pot ĐÚNG số, thừa về feeder ĐẦU lô cuối", () => {
    const xs = [fu(1, 10n), fu(2, 50n), fu(3, 30n), fu(4, 40n)];
    const p = planPotFunding(xs, { ...base, amount: 100n });
    // lớn trước: 50 (#2), 40 (#4), 30 (#3) ⇒ đủ 100 sau 3 UTxO; #1 không bị tiêu.
    expect(p.batches.map((b) => b.inputs.map((i) => i.index))).toEqual([[2, 4], [3]]);
    expect(p.batches.map((b) => b.potAmount)).toEqual([90n, 10n]);
    expect(p.batches.map((b) => b.change)).toEqual([0n, 20n]);
    expect(p.batches[1]!.changeAddress).toBe("addr_feeder_3");
    expect(p.total).toBe(100n);
    expect(p.available).toBe(130n);
    expect(p.partial).toBe(false);
  });

  it("thừa trong lô nhiều feeder ⇒ về feeder ĐẦU lô, không về ví khác", () => {
    const p = planPotFunding([fu(7, 30n), fu(5, 40n)], { ...base, amount: 50n });
    expect(p.batches).toHaveLength(1);
    expect(p.batches[0]).toMatchObject({ potAmount: 50n, change: 20n, lampIn: 70n, changeAddress: "addr_feeder_5" });
  });

  it("đúng khít ⇒ không thừa", () => {
    const p = planPotFunding([fu(1, 60n), fu(2, 40n)], { ...base, amount: 100n });
    expect(p.batches.map((b) => b.change)).toEqual([0n]);
    expect(p.total).toBe(100n);
  });

  it("thứ tự trả về của nhà cung cấp không đổi kế hoạch (hoà: chỉ số nhỏ, rồi ref nhỏ)", () => {
    const xs = [fu(3, 20n), fu(1, 20n, {}, "bb#1"), fu(1, 20n, {}, "aa#0"), fu(2, 20n)];
    const a = planPotFunding(xs, { ...base, amount: 40n });
    const b = planPotFunding([...xs].reverse(), { ...base, amount: 40n });
    expect(a).toEqual(b);
    expect(a.batches[0]!.inputs.map((i) => i.ref)).toEqual(["aa#0", "bb#1"]);
  });

  it("không đủ ⇒ FEED-POT-003, nói có bao nhiêu, thiếu bao nhiêu", () => {
    expect(() => planPotFunding([fu(1, 30n), fu(2, 40n)], { ...base, amount: 100n }))
      .toThrow(/FEED-POT-003: feeder có 70 oildrop LAMP, cần 100, thiếu 30/);
  });

  it("không đủ + ALLOW_PARTIAL ⇒ rót phần đang có, đánh dấu partial", () => {
    const p = planPotFunding([fu(1, 30n), fu(2, 40n)], { ...base, amount: 100n, allowPartial: true });
    expect(p.total).toBe(70n);
    expect(p.partial).toBe(true);
    expect(p.batches.map((b) => b.change)).toEqual([0n]);
  });

  it("không có LAMP nào ⇒ FEED-POT-003 kể cả khi ALLOW_PARTIAL", () => {
    expect(() => planPotFunding([], { ...base, amount: 1n, allowPartial: true })).toThrow(/FEED-POT-003/);
  });

  it("UTxO mang asset lạ ⇒ bị LOẠI và ĐẾM, không tính vào phần đủ", () => {
    const xs = [fu(1, 60n, { [X]: 1n }), fu(2, 40n)];
    expect(() => planPotFunding(xs, { ...base, amount: 100n })).toThrow(/FEED-POT-003: feeder có 40/);
    const p = planPotFunding(xs, { ...base, amount: 40n });
    expect(p.excluded).toEqual([{ ref: "1#0", index: 1, reason: `mang asset khác: ${X}` }]);
    expect(p.batches[0]!.inputs.map((i) => i.index)).toEqual([2]);
  });

  it("cần nhiều giao dịch hơn MAX_TX ⇒ FEED-POT-004; ALLOW_PARTIAL ⇒ cắt ở MAX_TX", () => {
    const xs = [fu(1, 10n), fu(2, 10n), fu(3, 10n)];
    const o = { ...base, batchSize: 1, maxTx: 2, amount: 30n };
    expect(() => planPotFunding(xs, o)).toThrow(/FEED-POT-004: cần 3 giao dịch/);
    const p = planPotFunding(xs, { ...o, allowPartial: true });
    expect(p.batches).toHaveLength(2);
    expect(p.total).toBe(20n);
    expect(p.partial).toBe(true);
  });

  it("AMOUNT ≤ 0 ⇒ FEED-POT-001; cỡ lô / MAX_TX không hợp lệ ⇒ FEED-POT-002", () => {
    expect(() => planPotFunding([fu(1, 1n)], { ...base, amount: 0n })).toThrow(/FEED-POT-001/);
    expect(() => planPotFunding([fu(1, 1n)], { ...base, amount: 1n, batchSize: 0 })).toThrow(/FEED-POT-002/);
    expect(() => planPotFunding([fu(1, 1n)], { ...base, amount: 1n, maxTx: 0 })).toThrow(/FEED-POT-002/);
  });
});

// ── Suất pot D: không bao giờ tạo UTxO kho < D ────────────────────────────────
// Dịch vụ phát của Wakeme chỉ chọn MỘT UTxO kho ≥ D và không có bộ dựng `Collect` ⇒ một UTxO
// kho < D là LAMP không bao giờ được phát. Số thật Preprod: D = 1.001 tLAMP (cap của wakeme_pot),
// Redeem đầu dốc ra UTxO 1.000 tLAMP ở feeder.
describe("planPotFunding — suất pot D (minPotAmount)", () => {
  const T = 1_000_000n;   // oildrop / tLAMP
  const U = "ab".repeat(28) + "744c414d50";
  const fu = (index: number, lampAmt: bigint, k = 0): FeederUtxo => ({
    index, pkh: `pkh${index}`, address: `addr_feeder_${index}`, ref: `${index}#${k}`,
    assets: { lovelace: 1_200_000n, [U]: lampAmt },
  });
  const D = 1_001n * T;

  it("lượt 04/10: 3 UTxO × 1.000 ở một feeder, rót 2.002, D = 1.001 ⇒ 1 lô, pot 2.002, thừa 998", () => {
    const xs = [fu(7, 1_000n * T, 0), fu(7, 1_000n * T, 1), fu(7, 1_000n * T, 2)];
    const p = planPotFunding(xs, { lampUnit: U, amount: 2_002n * T, batchSize: 40, maxTx: 25, allowPartial: false, minPotAmount: D });
    expect(p.batches).toHaveLength(1);
    expect(p.batches[0]).toMatchObject({ potAmount: 2_002n * T, change: 998n * T, changeAddress: "addr_feeder_7" });
  });

  it("lượt nâng: 2.000 UTxO × 1.000, rót 1.999.998, lô 40 ⇒ lô cuối 39.998 ≥ D, qua", () => {
    const xs = Array.from({ length: 2_000 }, (_, i) => fu(i + 1, 1_000n * T));
    const p = planPotFunding(xs, { lampUnit: U, amount: 1_999_998n * T, batchSize: 40, maxTx: 100, allowPartial: false, minPotAmount: D });
    expect(p.batches).toHaveLength(50);
    expect(p.batches.at(-1)!.potAmount).toBe(39_998n * T);
    expect(p.batches.every((b) => b.potAmount >= D)).toBe(true);
  });

  it("lô cuối < D ⇒ FEED-POT-005, không rót gì (cùng đầu vào, D nhỏ hơn thì qua)", () => {
    const xs = [fu(1, 1_000n * T), fu(2, 1_000n * T), fu(3, 1_000n * T)];
    const o = { lampUnit: U, amount: 2_500n * T, batchSize: 2, maxTx: 10, allowPartial: false };
    // lô 1 = 2 UTxO = 2.000 (đủ), lô 2 rót phần còn lại 500 < 1.001.
    expect(() => planPotFunding(xs, { ...o, minPotAmount: D }))
      .toThrow(/FEED-POT-005: lô 2\/2 rót 500000000 < suất pot 1001000000/);
    const p = planPotFunding(xs, { ...o, minPotAmount: 500n * T });   // biên: = D thì qua
    expect(p.batches.map((b) => b.potAmount)).toEqual([2_000n * T, 500n * T]);
  });

  it("lượng rót < D (một lô) ⇒ FEED-POT-005", () => {
    expect(() => planPotFunding([fu(1, 5_000n * T)],
      { lampUnit: U, amount: 1_000n * T, batchSize: 40, maxTx: 1, allowPartial: false, minPotAmount: D }))
      .toThrow(/FEED-POT-005: lô 1\/1/);
  });

  it("lô ĐẦY nhưng gom từ UTxO vụn < D ⇒ FEED-POT-005 (không chỉ soát lô cuối)", () => {
    const xs = [fu(1, 10n), fu(2, 10n), fu(3, 30n)];
    // lớn trước ⇒ lô 1 = [30,10] rót trọn 40, lô 2 = [10]. D = 45 ⇒ lô 1 (ĐẦY, không phải lô cuối) hỏng trước.
    expect(() => planPotFunding(xs, { lampUnit: U, amount: 50n, batchSize: 2, maxTx: 10, allowPartial: false, minPotAmount: 45n }))
      .toThrow(/FEED-POT-005: lô 1\/2/);
  });

  it("ALLOW_PARTIAL cắt ở MAX_TX vẫn soát D trên các lô còn lại", () => {
    const xs = [fu(1, 10n), fu(2, 10n), fu(3, 10n)];
    expect(() => planPotFunding(xs, { lampUnit: U, amount: 30n, batchSize: 1, maxTx: 2, allowPartial: true, minPotAmount: 11n }))
      .toThrow(/FEED-POT-005/);
  });

  it("minPotAmount < 1 ⇒ FEED-POT-002", () => {
    expect(() => planPotFunding([fu(1, 10n)], { lampUnit: U, amount: 1n, batchSize: 1, maxTx: 1, allowPartial: false, minPotAmount: 0n }))
      .toThrow(/FEED-POT-002/);
  });
});

// ── sweep: gom ĐÚNG một lượng, không gom tất ──────────────────────────────────
describe("planSweep — gom đúng AMOUNT_OILDROP về ví thường", () => {
  const U = "ab".repeat(28) + "744c414d50";
  const X = "cd".repeat(28) + "58";
  const fu = (index: number, lampAmt: bigint, extra: Record<string, bigint> = {}): FeederUtxo => ({
    index, pkh: `pkh${index}`, address: `addr_feeder_${index}`, ref: `${index}#0`,
    assets: { lovelace: 1_200_000n, [U]: lampAmt, ...extra },
  });
  const o = { lampUnit: U, batchSize: 40, maxTx: 25 };

  it("10 feeder × 1.000, gom 2.500 ⇒ CHỈ tiêu 3 UTxO, đích nhận đúng 2.500, thừa 500 về feeder đầu lô", () => {
    const xs = Array.from({ length: 10 }, (_, i) => fu(i + 1, 1_000n));
    const p = planSweep(xs, { ...o, amount: 2_500n });
    expect(p.batches).toHaveLength(1);
    expect(p.batches[0]!.inputs.map((i) => i.index)).toEqual([1, 2, 3]);
    expect(p.batches[0]).toMatchObject({ potAmount: 2_500n, change: 500n, lampIn: 3_000n, changeAddress: "addr_feeder_1" });
    expect(p.total).toBe(2_500n);
  });

  it("không đủ ⇒ FEED-SWEEP-005, không kế hoạch gửi thiếu", () => {
    expect(() => planSweep([fu(1, 1_000n), fu(2, 500n)], { ...o, amount: 2_000n }))
      .toThrow(/FEED-SWEEP-005: cần gom 2000 oildrop LAMP, feeder dùng được 1500/);
  });

  it("cần nhiều giao dịch hơn MAX_TX ⇒ FEED-SWEEP-005 (không cắt ngầm ở MAX_TX)", () => {
    const xs = [fu(1, 10n), fu(2, 10n), fu(3, 10n)];
    expect(() => planSweep(xs, { lampUnit: U, batchSize: 1, maxTx: 2, amount: 30n })).toThrow(/FEED-SWEEP-005/);
  });

  it("UTxO mang asset lạ ⇒ bị loại và đếm, không tiêu", () => {
    const p = planSweep([fu(1, 5_000n, { [X]: 1n }), fu(2, 1_000n)], { ...o, amount: 1_000n });
    expect(p.excluded.map((x) => x.ref)).toEqual(["1#0"]);
    expect(p.batches[0]!.inputs.map((i) => i.index)).toEqual([2]);
    expect(() => planSweep([fu(1, 5_000n, { [X]: 1n }), fu(2, 1_000n)], { ...o, amount: 2_000n }))
      .toThrow(/FEED-SWEEP-005: .*loại 1 UTxO/);
  });

  it("AMOUNT ≤ 0 ⇒ FEED-SWEEP-004; cỡ lô < 1 ⇒ FEED-SWEEP-001", () => {
    expect(() => planSweep([fu(1, 1n)], { ...o, amount: 0n })).toThrow(/FEED-SWEEP-004/);
    expect(() => planSweep([fu(1, 1n)], { ...o, batchSize: 0, amount: 1n })).toThrow(/FEED-SWEEP-001/);
  });
});

describe("sweepAmountFromEnv — AMOUNT_OILDROP bắt buộc cho sweep", () => {
  it("thiếu / rỗng ⇒ FEED-SWEEP-004 (không quay về gom tất)", () => {
    expect(() => sweepAmountFromEnv(undefined)).toThrow(/FEED-SWEEP-004: STEP=sweep đòi AMOUNT_OILDROP/);
    expect(() => sweepAmountFromEnv("  ")).toThrow(/FEED-SWEEP-004/);
  });
  it("không phải số nguyên dương ⇒ FEED-SWEEP-004", () => {
    expect(() => sweepAmountFromEnv("0")).toThrow(/FEED-SWEEP-004/);
    expect(() => sweepAmountFromEnv("1e6")).toThrow(/FEED-SWEEP-004/);
    expect(() => sweepAmountFromEnv("-5")).toThrow(/FEED-SWEEP-004/);
  });
  it("số hợp lệ ⇒ bigint", () => {
    expect(sweepAmountFromEnv(" 100000000000 ")).toBe(100_000_000_000n);
  });
});

describe("dryRunAtFromEnv — DRY_RUN_AT_MS chỉ cho chạy khô plan|redeem", () => {
  it("trống ⇒ undefined (giờ thật)", () => {
    expect(dryRunAtFromEnv(undefined, true, "redeem")).toBeUndefined();
    expect(dryRunAtFromEnv("", false, "grant")).toBeUndefined();
  });
  it("mốc 04/10 07:02 (+07) ⇒ cửa sổ 4146 qua epochWindow", () => {
    const at = dryRunAtFromEnv("1791072120000", false, "redeem")!;
    expect(at).toBe(1_791_072_120_000n);
    const w = epochWindow(432_000_000n, at);
    expect(w.epoch).toBe(4146n);
    expect(w.loMs).toBe(1_791_072_060_000n);   // lùi 60 s, vẫn trong 4146 (mốc 1791072000000)
  });
  it("đặt cùng SUBMIT=true ⇒ FEED-ENV-003", () => {
    expect(() => dryRunAtFromEnv("1791072120000", true, "redeem")).toThrow(/FEED-ENV-003/);
  });
  it("STEP khác plan|redeem ⇒ FEED-ENV-004", () => {
    expect(() => dryRunAtFromEnv("1791072120000", false, "grant")).toThrow(/FEED-ENV-004/);
    expect(() => dryRunAtFromEnv("1791072120000", false, "fundpot")).toThrow(/FEED-ENV-004/);
    expect(dryRunAtFromEnv("1791072120000", false, "plan")).toBe(1_791_072_120_000n);
  });
  it("không phải số nguyên ⇒ FEED-ENV-001", () => {
    expect(() => dryRunAtFromEnv("04/10", false, "redeem")).toThrow(/FEED-ENV-001/);
  });
});

describe("withDeadline — hạn giờ chờ giao dịch vào block", () => {
  it("xong trước hạn ⇒ trả đúng giá trị", async () => {
    await expect(withDeadline(Promise.resolve(true), 1_000, () => new Error("X"))).resolves.toBe(true);
  });
  it("không bao giờ xong ⇒ ném lỗi do onTimeout dựng (mang hash)", async () => {
    const never = new Promise<boolean>(() => {});
    await expect(withDeadline(never, 20, () => new Error("FEED-AWAIT-001: hash abc")))
      .rejects.toThrow(/FEED-AWAIT-001: hash abc/);
  });
  it("lỗi của chính lời chờ đi lên nguyên văn, không bị đổi thành hết giờ", async () => {
    await expect(withDeadline(Promise.reject(new Error("provider down")), 1_000, () => new Error("FEED-AWAIT-001")))
      .rejects.toThrow(/provider down/);
  });
  it("hạn giờ < 1 ⇒ FEED-ENV-001", async () => {
    await expect(withDeadline(Promise.resolve(1), 0, () => new Error("X"))).rejects.toThrow(/FEED-ENV-001/);
  });
});
