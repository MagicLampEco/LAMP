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
  planPotFunding, type FeederAccount, type FeederUtxo,
} from "../scripts/_feederPlan.js";
import { TRIM_FLOOR } from "../../Distribution/offchain/src/constants.js";
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
  const base = { lampUnit: U, batchSize: 2, maxTx: 10, allowPartial: false };

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
