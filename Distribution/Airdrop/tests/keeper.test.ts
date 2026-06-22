// Keeper — root postable + claimed_cumulative + gói redeem khớp on-chain.
import { describe, it, expect } from "vitest";
import { runKeeper, postableRoots, claimAmounts, redeemPackage } from "../offchain/src/keeper.js";
import { verifyClaim } from "../offchain/src/merkle.js";
import { splitEpoch } from "../offchain/src/split.js";
import type { EpochSnapshot, DistributeParams } from "../offchain/src/types.js";

const pkh = (b: string): string => b.repeat(28);
const OS1 = pkh("51");
const D1 = pkh("d1"), D2 = pkh("d2");

const { spoBudgetOil, delegatorBudgetOil } = splitEpoch();
const PARAMS: DistributeParams = { spoBudgetOil, delegatorBudgetOil, floorStake: 0n };

function snap(epoch: bigint): EpochSnapshot {
  return {
    epoch,
    registrations: [{ poolId: "P1", spoRewardOwner: OS1, epochRegistered: 1n }],
    poolStatus: [{ poolId: "P1", producedBlock: true }],
    delegators: [
      { owner: D1, poolId: "P1", stake: 1_000n },
      { owner: D2, poolId: "P1", stake: 3_000n },
    ],
  };
}

describe("Airdrop keeper", () => {
  it("postableRoots: 1 root/epoch, khớp output", () => {
    const { outputs, roots } = runKeeper([snap(1n), snap(2n)], PARAMS);
    expect(roots.length).toBe(2);
    expect(roots[0]!.epoch).toBe(1n);
    expect(roots[0]!.rootHex).toBe(outputs[0]!.rootHex);
    expect(roots[1]!.epoch).toBe(2n);
  });

  it("claimAmounts: owner → won_cumulative (trần committee Claim)", () => {
    const { outputs } = runKeeper([snap(1n)], PARAMS);
    const amounts = claimAmounts(outputs[0]!);
    const d1 = outputs[0]!.entitlements.find((e) => e.owner === D1)!;
    expect(amounts.get(D1)).toBe(d1.wonCumulative);
    expect(amounts.get(OS1)).toBeGreaterThan(0n); // SPO cũng có trần
  });

  it("redeemPackage: proof verify được với root epoch đó (claim permissionless)", () => {
    const { outputs } = runKeeper([snap(1n), snap(2n)], PARAMS);
    for (const o of outputs) {
      const pkgD1 = redeemPackage(o, D1)!;
      expect(pkgD1.rootEpoch).toBe(o.epoch);
      expect(verifyClaim(o.rootHex, pkgD1.owner, pkgD1.wonCumulative, pkgD1.proof)).toBe(true);
    }
  });

  it("redeemPackage: cumulative tăng qua epoch (claim trễ lấy đủ)", () => {
    const { outputs } = runKeeper([snap(1n), snap(2n)], PARAMS);
    const e1 = redeemPackage(outputs[0]!, D1)!.wonCumulative;
    const e2 = redeemPackage(outputs[1]!, D1)!.wonCumulative;
    expect(e2).toBeGreaterThan(e1);
  });

  it("redeemPackage: owner không tham gia → null", () => {
    const { outputs } = runKeeper([snap(1n)], PARAMS);
    expect(redeemPackage(outputs[0]!, pkh("ee"))).toBeNull();
  });

  it("redeemPackage chấp nhận owner có 0x prefix / hoa", () => {
    const { outputs } = runKeeper([snap(1n)], PARAMS);
    const pkg = redeemPackage(outputs[0]!, "0x" + D1.toUpperCase());
    expect(pkg).not.toBeNull();
    expect(pkg!.owner).toBe(D1);
  });
});
