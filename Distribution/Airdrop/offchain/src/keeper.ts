// Airdrop keeper (§6.2) — biến snapshot mỗi epoch thành:
//   • root MerkleRoot để committee post lên beacon,
//   • claimed_cumulative mỗi owner để committee Claim (đặt trần entitlement),
//   • gói redeem (proof + won_cumulative + root_epoch) để owner claim permissionless.
//
// Thuần off-chain, tất định — không mạng. Builder Lucid (post beacon / Claim / Redeem)
// + e2e Preview là bước kế (cần .env). Cây cầu byte-perfect với on-chain qua merkle.ak.

import { runAirdrop, type AirdropEpochOutput } from "./distribute.js";
import type { EpochSnapshot, DistributeParams } from "./types.js";

function normHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

/** Root + epoch committee cần post lên beacon (BeaconDatum{epoch, MerkleRoot, root}). */
export interface PostableBeacon {
  epoch: bigint;
  rootHex: string;
  leafCount: number;
}

/** Gói redeem cho 1 owner: khớp tham số redeemer Redeem on-chain. */
export interface RedeemPackage {
  owner: string;
  /** won_cumulative (oil) — leaf đã commit trong root_epoch. */
  wonCumulative: bigint;
  /** root_epoch — epoch của beacon mang root chứng minh leaf này. */
  rootEpoch: bigint;
  /** Merkle proof (hex sibling list). */
  proof: string[];
}

/** Root mỗi epoch để committee post lên beacon (bỏ epoch rỗng — không ai nhận). */
export function postableRoots(outputs: AirdropEpochOutput[]): PostableBeacon[] {
  return outputs
    .filter((o) => o.entitlements.length > 0)
    .map((o) => ({ epoch: o.epoch, rootHex: o.rootHex, leafCount: o.entitlements.length }));
}

/** claimed_cumulative mỗi owner committee cần xác nhận ở epoch e (= won_cumulative).
 *  Trần để Redeem hợp lệ (won_cumulative ≤ claimed_cumulative on-chain). */
export function claimAmounts(output: AirdropEpochOutput): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const e of output.entitlements) m.set(e.owner, e.wonCumulative);
  return m;
}

/** Gói redeem cho 1 owner ở 1 epoch. null nếu owner không có entitlement epoch đó. */
export function redeemPackage(output: AirdropEpochOutput, owner: string): RedeemPackage | null {
  const o = normHex(owner);
  const e = output.entitlements.find((x) => x.owner === o);
  if (!e || e.wonCumulative <= 0n) return null;
  const proof = output.proofs.get(o);
  if (!proof) return null;
  return { owner: o, wonCumulative: e.wonCumulative, rootEpoch: output.epoch, proof };
}

export interface KeeperRun {
  outputs: AirdropEpochOutput[];
  roots: PostableBeacon[];
}

/** Chạy keeper qua nhiều epoch: phân phối + Merkle + danh sách root postable. */
export function runKeeper(
  snapshots: EpochSnapshot[],
  params: DistributeParams | DistributeParams[],
): KeeperRun {
  const outputs = runAirdrop(snapshots, params);
  return { outputs, roots: postableRoots(outputs) };
}
