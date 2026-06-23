// ISPO keeper — root postable + claimed_cumulative + gói redeem khớp on-chain.
import { describe, it, expect } from "vitest";
import { runKeeper, claimAmounts, redeemPackage } from "../offchain/src/keeper.js";
import { verifyClaim } from "../offchain/src/merkle.js";
import { PER_EPOCH_OIL } from "../offchain/src/constants.js";
import type { PoolConfig, Contribution, DistributeParams } from "../offchain/src/types.js";

const pkh = (b: string): string => b.repeat(28);
const OS1 = pkh("51");
const D1 = pkh("d1"), D2 = pkh("d2");

const PARAMS: DistributeParams = { perEpochOil: PER_EPOCH_OIL, maxContribLovelace: null };
const POOLS: PoolConfig[] = [
  { poolId: "P1", spoRewardOwner: OS1, bonusRateBp: 1000n, rateEffectiveFromEpoch: 0n },
];
const CONTRIBS: Contribution[] = [
  { owner: D1, poolId: "P1", contributedLovelace: 1_000n, epoch: 1n },
  { owner: D2, poolId: "P1", contributedLovelace: 3_000n, epoch: 1n },
];

describe("ISPO keeper", () => {
  it("postableRoots: 1 root/epoch khớp output", () => {
    const { outputs, roots } = runKeeper([2n, 3n], POOLS, CONTRIBS, PARAMS);
    expect(roots.length).toBe(2);
    expect(roots[0]!.rootHex).toBe(outputs[0]!.rootHex);
  });

  it("claimAmounts: owner → won_cumulative; SPO bonus có trần", () => {
    const { outputs } = runKeeper([2n], POOLS, CONTRIBS, PARAMS);
    const m = claimAmounts(outputs[0]!);
    expect(m.get(D1)).toBe(outputs[0]!.entitlements.find((e) => e.owner === D1)!.wonCumulative);
    expect(m.get(OS1)).toBeGreaterThan(0n);
  });

  it("redeemPackage: proof verify với root epoch đó", () => {
    const { outputs } = runKeeper([2n, 3n], POOLS, CONTRIBS, PARAMS);
    for (const o of outputs) {
      const pkg = redeemPackage(o, D1)!;
      expect(pkg.rootEpoch).toBe(o.epoch);
      expect(verifyClaim(o.rootHex, pkg.owner, pkg.wonCumulative, pkg.proof)).toBe(true);
    }
  });

  it("redeemPackage: cumulative tăng qua epoch", () => {
    const { outputs } = runKeeper([2n, 3n], POOLS, CONTRIBS, PARAMS);
    expect(redeemPackage(outputs[1]!, D1)!.wonCumulative)
      .toBeGreaterThan(redeemPackage(outputs[0]!, D1)!.wonCumulative);
  });

  it("redeemPackage: owner không góp → null; chấp nhận 0x/HOA", () => {
    const { outputs } = runKeeper([2n], POOLS, CONTRIBS, PARAMS);
    expect(redeemPackage(outputs[0]!, pkh("ee"))).toBeNull();
    expect(redeemPackage(outputs[0]!, "0x" + D1.toUpperCase())!.owner).toBe(D1);
  });
});
