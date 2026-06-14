// claimBuilder — TIGER Airdrop Claim. Claimer present Merkle proof → nhận `amount`
// LAMP, đúc 1 CLAIM marker NFT (name = leaf) vào marker script (nullifier).
//
// FLOW (lucid-evolution):
//   1. Spend POOL UTxO (AirdropRedeemer::Claim{claimer, amount, proof}).
//   2. Mint CLAIM marker (airdrop_nft policy, name=leaf, qty +1) redeemer MintClaim.
//   3. Output POOL' = POOL − amount LAMP, datum claimed_count += 1 (POOL NFT giữ).
//   4. Output claimer ← amount LAMP.
//   5. Output marker_dest ← CLAIM marker NFT (khóa vĩnh viễn).
//
// CHỐNG DOUBLE-CLAIM: trước build, kiểm marker leaf CHƯA tồn tại (indexer). Onchain
// ép đúc đúng 1 marker name=leaf vào marker_dest.

import {
  toUnit,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder,
} from "@lucid-evolution/lucid";

import { airdropPoolToCbor, claimRedeemerToCbor, mintClaimRedeemerToCbor } from "./datum.js";
import { buildProofForAddress } from "./merkle.js";
import type { AirdropPool, MerkleTree } from "./types.js";

export interface ClaimParams {
  lucid: LucidEvolution;

  /** POOL UTxO (datum AirdropPool, POOL NFT, kho LAMP). */
  poolUtxo: UTxO;
  /** Datum pool đã decode (merkle_root/deadline/dest/count). */
  pool: AirdropPool;
  airdropPoolScript: Validator;

  /** Minting policy airdrop_nft (đã apply genesis_ref). */
  airdropNftPolicy: MintingPolicy;
  /** policyId của airdrop_nft (= POOL NFT policy = marker policy). */
  airdropNftPolicyId: string;

  /** Cây Merkle đầy đủ (để sinh proof) — từ snapshotTool/buildTree. */
  tree: MerkleTree;
  /** Địa chỉ claimer (phải có trong snapshot). */
  claimerAddress: string;

  lamp_policy: string;
  lamp_name: string;

  /** min-ADA kèm marker UTxO. Mặc định 2 ADA. */
  markerLovelace?: bigint;
  /** min-ADA kèm output claimer (ngoài LAMP). Mặc định 2 ADA. */
  claimerLovelace?: bigint;
  /** Khoảng hợp lệ: upper_bound (POSIX ms) PHẢI < deadline (onchain ép). Caller set. */
  validToMs: number;
}

export interface ClaimResult {
  tx: TxSignBuilder;
  amount: bigint;
  leaf: string;
  markerUnit: string;
  summary: string;
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, poolUtxo, pool, airdropPoolScript, airdropNftPolicy, airdropNftPolicyId,
    tree, claimerAddress, lamp_policy, lamp_name, validToMs,
  } = params;

  const markerLovelace = params.markerLovelace ?? 2_000_000n;
  const claimerLovelace = params.claimerLovelace ?? 2_000_000n;

  // 1. Sinh proof + entry từ cây.
  const { entry, proof, leaf } = buildProofForAddress(tree, claimerAddress);
  const amount = entry.amount;
  if (amount <= 0n) throw new Error("CLAIM-001: amount ≤ 0 trong snapshot");

  const lampUnit = toUnit(lamp_policy, lamp_name);
  const markerUnit = toUnit(airdropNftPolicyId, leaf);

  // 2. POOL' = POOL − amount LAMP; datum claimed_count += 1.
  const poolLamp = poolUtxo.assets[lampUnit] ?? 0n;
  if (poolLamp < amount) throw new Error("CLAIM-002: pool không đủ LAMP cho claim");
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets, [lampUnit]: poolLamp - amount };
  const poolOut: AirdropPool = { ...pool, claimed_count: pool.claimed_count + 1n };

  const poolAddress = poolUtxo.address;

  const tx = await lucid
    .newTx()
    .validTo(validToMs)
    .collectFrom([poolUtxo], claimRedeemerToCbor(entry, proof))
    .attach.SpendingValidator(airdropPoolScript)
    .mintAssets({ [markerUnit]: 1n }, mintClaimRedeemerToCbor())
    .attach.MintingPolicy(airdropNftPolicy)
    // POOL' (− amount LAMP), datum count+1
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: airdropPoolToCbor(poolOut) },
      poolOutAssets,
    )
    // claimer nhận amount LAMP
    .pay.ToAddress(claimerAddress, { lovelace: claimerLovelace, [lampUnit]: amount })
    // marker NFT → marker_dest (nullifier khóa vĩnh viễn)
    .pay.ToAddress(pool.marker_dest, { lovelace: markerLovelace, [markerUnit]: 1n })
    .complete();

  const summary = [
    `═══ TIGER Airdrop Claim ═══`,
    `Claimer:      ${claimerAddress}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Leaf:         ${leaf}`,
    `Marker unit:  ${markerUnit} → ${pool.marker_dest}`,
    `Pool LAMP:    ${poolLamp} → ${poolLamp - amount} oil`,
    `claimed_count:${pool.claimed_count} → ${pool.claimed_count + 1n}`,
    `Proof steps:  ${proof.length}`,
  ].join("\n");

  return { tx, amount, leaf, markerUnit, summary };
}
