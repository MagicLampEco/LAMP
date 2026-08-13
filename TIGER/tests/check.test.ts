// TIGER/tests/check.test.ts — checker 1 địa chỉ (thuần, không mạng).
import { describe, it, expect } from "vitest";
import {
  analyzeHistory, lookupLamp, projectLampFromSnapshot,
  type HistoryEntry,
} from "../offchain/src/check.js";
import { buildSnapshotSet } from "../offchain/src/snapshot.js";

const TIGER = "pool1tiger";
const OTHER = "pool1other";

const history: HistoryEntry[] = [
  { active_epoch: 500, amount: "1000", pool_id: OTHER },  // không TIGER
  { active_epoch: 501, amount: "2000", pool_id: TIGER },  // TIGER
  { active_epoch: 502, amount: "3000", pool_id: TIGER },  // TIGER
  { active_epoch: 503, amount: "4000", pool_id: TIGER },  // TIGER nhưng ≥ cutoff
];

describe("analyzeHistory", () => {
  it("chuẩn hoá + đánh dấu is_tiger + sort epoch", () => {
    const { rows } = analyzeHistory(history, { tigerPoolId: TIGER });
    expect(rows.map((r) => r.epoch)).toEqual([500n, 501n, 502n, 503n]);
    expect(rows.map((r) => r.is_tiger)).toEqual([false, true, true, true]);
  });

  it("lọc TIGER + áp cutoff (nửa mở, epoch < cutoff)", () => {
    const { tigerRows, tigerAccStake } = analyzeHistory(history, {
      tigerPoolId: TIGER, cutoffEpoch: 503n,
    });
    expect(tigerRows.map((r) => r.epoch)).toEqual([501n, 502n]); // 503 bị loại
    expect(tigerAccStake).toBe(5000n); // 2000 + 3000
  });

  it("không cutoff → lấy hết epoch TIGER", () => {
    const { tigerAccStake } = analyzeHistory(history, { tigerPoolId: TIGER });
    expect(tigerAccStake).toBe(9000n); // 2000 + 3000 + 4000
  });

  it("ví chưa từng stake TIGER → accStake 0", () => {
    const only = [{ active_epoch: 500, amount: "5000", pool_id: OTHER }];
    const { tigerRows, tigerAccStake } = analyzeHistory(only, { tigerPoolId: TIGER });
    expect(tigerRows).toEqual([]);
    expect(tigerAccStake).toBe(0n);
  });
});

describe("lookupLamp + projectLampFromSnapshot", () => {
  it("lookupLamp trả null khi owner không có trong entitlements", () => {
    const r = lookupLamp([], "0aowner");
    expect(r.amountOildrop).toBeNull();
  });

  it("projectLampFromSnapshot tính đúng LAMP owner từ snapshot chốt", () => {
    // owner "A" trung thành 2 epoch, "B" 1 epoch
    const snap = buildSnapshotSet([
      { epoch: 501n, rows: [
        { stake_address: "A", amount: "2000" },
        { stake_address: "B", amount: "1000" },
      ] },
      { epoch: 502n, rows: [
        { stake_address: "A", amount: "3000" },
      ] },
    ]);
    const budget = 600_000_000n;
    const pa = projectLampFromSnapshot(snap, "A", budget);
    const pb = projectLampFromSnapshot(snap, "B", budget);
    expect(pa.amountOildrop).not.toBeNull();
    expect(pa.accStake).toBe(5000n);           // 2000 + 3000
    expect(pa.amountOildrop! > pb.amountOildrop!).toBe(true);
    expect(pa.provisional).toBe(false);
  });
});
