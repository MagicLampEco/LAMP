// ISPO keeper (§6.3) — biến lịch sử contribution thành: root MerkleRoot post beacon,
// claimed_cumulative committee Claim (trần entitlement), gói redeem cho owner claim
// permissionless. Thuần off-chain, tất định. Builder Lucid + e2e Preview là bước kế.

import { runIspo, type IspoEpochOutput } from "./distribute.js";
import type { PoolConfig, Contribution, DistributeParams } from "./types.js";

function normHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

export interface PostableBeacon {
  epoch: bigint;
  rootHex: string;
  leafCount: number;
}

export interface RedeemPackage {
  owner: string;
  wonCumulative: bigint;
  rootEpoch: bigint;
  proof: string[];
}

export function postableRoots(outputs: IspoEpochOutput[]): PostableBeacon[] {
  return outputs
    .filter((o) => o.entitlements.length > 0)
    .map((o) => ({ epoch: o.epoch, rootHex: o.rootHex, leafCount: o.entitlements.length }));
}

/** claimed_cumulative committee cần xác nhận mỗi owner ở epoch e (= won_cumulative). */
export function claimAmounts(output: IspoEpochOutput): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const e of output.entitlements) m.set(e.owner, e.wonCumulative);
  return m;
}

/** Gói redeem cho 1 owner ở 1 epoch. null nếu owner không có entitlement epoch đó. */
export function redeemPackage(output: IspoEpochOutput, owner: string): RedeemPackage | null {
  const o = normHex(owner);
  const e = output.entitlements.find((x) => x.owner === o);
  if (!e || e.wonCumulative <= 0n) return null;
  const proof = output.proofs.get(o);
  if (!proof) return null;
  return { owner: o, wonCumulative: e.wonCumulative, rootEpoch: output.epoch, proof };
}

export interface KeeperRun {
  outputs: IspoEpochOutput[];
  roots: PostableBeacon[];
}

export function runKeeper(
  distributionEpochs: bigint[],
  pools: PoolConfig[],
  contributions: Contribution[],
  params: DistributeParams,
): KeeperRun {
  const outputs = runIspo(distributionEpochs, pools, contributions, params);
  return { outputs, roots: postableRoots(outputs) };
}
