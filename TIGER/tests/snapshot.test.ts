// TIGER/tests/snapshot.test.ts — builder snapshot THUẦN (không mạng).
import { describe, it, expect } from "vitest";
import {
  buildSnapshotSet, summarize, parseSnapshotFile, toSnapshotJson,
  type EpochRows, type SnapshotFile,
} from "../offchain/src/snapshot.js";
import { computeEntitlements } from "../offchain/src/entitlement.js";

const SA_A = "stake1aaa", SA_B = "stake1bbb", SA_C = "stake1ccc";

const perEpoch: EpochRows[] = [
  { epoch: 500n, rows: [
    { stake_address: SA_A, amount: "300" },
    { stake_address: SA_B, amount: "50" },
  ] },
  { epoch: 501n, rows: [
    { stake_address: SA_A, amount: "300" },   // A trung thành 2 epoch
    { stake_address: SA_C, amount: "50" },
  ] },
];

describe("buildSnapshotSet", () => {
  it("gộp per-epoch, owner mặc định = stake_address", () => {
    const snap = buildSnapshotSet(perEpoch);
    expect(snap.length).toBe(2);
    expect(snap[0]).toEqual([
      { owner: SA_A, stake: 300n },
      { owner: SA_B, stake: 50n },
    ]);
  });

  it("accStake tích lũy đúng qua các epoch", () => {
    const { accStake, totalStake, owners } = summarize(buildSnapshotSet(perEpoch));
    expect(accStake.get(SA_A)).toBe(600n); // 300 + 300
    expect(accStake.get(SA_B)).toBe(50n);
    expect(accStake.get(SA_C)).toBe(50n);
    expect(totalStake).toBe(700n);
    expect(owners).toBe(3);
  });

  it("bỏ stake 0 và ví excluded (theo stake_address)", () => {
    const rows: EpochRows[] = [{ epoch: 500n, rows: [
      { stake_address: SA_A, amount: "300" },
      { stake_address: SA_B, amount: "0" },     // bỏ: stake 0
      { stake_address: SA_C, amount: "100" },
    ] }];
    const snap = buildSnapshotSet(rows, { excluded: new Set([SA_C]) });
    expect(snap[0]).toEqual([{ owner: SA_A, stake: 300n }]);
  });

  it("--registry map stake_address → payment pkh (owner)", () => {
    const registry = new Map([[SA_A, "0a".repeat(28)], [SA_B, "0b".repeat(28)]]);
    const snap = buildSnapshotSet(perEpoch, { registry });
    expect(snap[0]![0]!.owner).toBe("0a".repeat(28));
    // SA_C không trong registry → giữ nguyên stake_address
    expect(snap[1]!.find((e) => e.stake === 50n)!.owner).toBe(SA_C);
  });

  it("ném lỗi khi registry gộp 2 stake_address về 1 owner trong CÙNG epoch", () => {
    const registry = new Map([[SA_A, "0f".repeat(28)], [SA_B, "0f".repeat(28)]]);
    expect(() => buildSnapshotSet(perEpoch, { registry })).toThrow(/TIGER-SNAP-DUP/);
  });
});

describe("serialize round-trip + nạp vào computeEntitlements", () => {
  it("parseSnapshotFile khôi phục BigInt", () => {
    const snap = buildSnapshotSet(perEpoch);
    const file: SnapshotFile = {
      meta: {
        network: "Preview", pool_id: "pool1x", epochs: ["500", "501"], cutoff_epoch: "502",
        owner_key: "stake_address", registry_applied: false, total_owners: 3,
        total_stake_lovelace: "700", generated_at_epoch: "510", excluded: [],
      },
      snapshot: toSnapshotJson(snap),
    };
    expect(parseSnapshotFile(file)).toEqual(snap);
  });

  it("SnapshotSet nạp thẳng vào computeEntitlements, bảo toàn oil", () => {
    const snap = buildSnapshotSet(perEpoch);
    const budget = 700_000_000n; // oil
    const { entitlements, distributed, leftover } = computeEntitlements(snap, { budgetOil: budget });
    // A giữ 600/700 accStake → phần lớn nhất
    const eA = entitlements.find((e) => e.owner === SA_A)!;
    const eB = entitlements.find((e) => e.owner === SA_B)!;
    expect(eA.amount).toBeGreaterThan(eB.amount);
    // bất biến: Σ E_i + leftover = budget
    expect(distributed + leftover).toBe(budget);
  });
});
