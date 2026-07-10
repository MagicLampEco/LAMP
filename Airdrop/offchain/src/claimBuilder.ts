// claimBuilder — TIGER Airdrop Claim (SPEND-ONCE). Claimer present Merkle proof →
// nhận `amount` LAMP, consume + BURN claim-slot UTxO (name = leaf) ở registry.
//
// FLOW (lucid-evolution):
//   1. Spend POOL UTxO (AirdropRedeemer::Claim{claimer, amount, proof}).
//   2. Spend slot UTxO (mang (airdrop_nft, leaf, 1) ở marker_dest) — redeemer của
//      marker validator (Data Void/placeholder; marker không đọc redeemer).
//   3. Burn slot NFT (airdrop_nft policy, name=leaf, qty -1) redeemer BurnSlot.
//   4. Output POOL' = POOL − amount LAMP, datum claimed_count += 1 (POOL NFT giữ).
//   5. Output claimer ← amount LAMP.
//   (KHÔNG còn output marker — slot biến mất khỏi registry = nullifier spend-once.)
//
// CHỐNG DOUBLE-CLAIM: slot UTxO đúc 1 lần ở SETUP, tiêu rồi bất khả-tái-sinh
// (one-shot mint). Claim lần 2 cho cùng leaf → registry KHÔNG còn slot → tx không
// build được. TRUSTLESS, KHÔNG cần indexer.

import {
  toUnit,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder, type Redeemer,
} from "@lucid-evolution/lucid";

import { airdropPoolToCbor, claimRedeemerToCbor, burnSlotRedeemerToCbor } from "./datum.js";
import { buildProofForAddress } from "./merkle.js";
import type { AirdropPool, MerkleTree } from "./types.js";

export interface ClaimParams {
  lucid: LucidEvolution;

  /** POOL UTxO (datum AirdropPool, POOL NFT, kho LAMP). */
  poolUtxo: UTxO;
  /** Datum pool đã decode (merkle_root/deadline/dest/count). */
  pool: AirdropPool;
  airdropPoolScript: Validator;

  /** Slot UTxO của leaf claimer (mang (airdrop_nft, leaf, 1) ở marker_dest). */
  slotUtxo: UTxO;
  /** Marker (registry) validator — đính kèm để spend slotUtxo. */
  airdropMarkerScript: Validator;

  /** Minting policy airdrop_nft (đã apply genesis_ref). */
  airdropNftPolicy: MintingPolicy;
  /** policyId của airdrop_nft (= POOL NFT policy = slot policy). */
  airdropNftPolicyId: string;

  /** Cây Merkle đầy đủ (để sinh proof) — từ snapshotTool/buildTree. */
  tree: MerkleTree;
  /** Địa chỉ claimer (phải có trong snapshot). */
  claimerAddress: string;

  lamp_policy: string;
  lamp_name: string;

  /** Redeemer khi spend slot UTxO (marker validator bỏ qua) — mặc định Void. */
  slotRedeemer?: Redeemer;
  /** min-ADA kèm output claimer (ngoài LAMP). Mặc định 2 ADA. */
  claimerLovelace?: bigint;
  /** Khoảng hợp lệ: upper_bound (POSIX ms) PHẢI < deadline (onchain ép). Caller set. */
  validToMs: number;
}

export interface ClaimResult {
  tx: TxSignBuilder;
  amount: bigint;
  leaf: string;
  slotUnit: string;
  summary: string;
}

/** Void redeemer (Plutus unit = Constr 0 []) — marker validator không đọc redeemer. */
const VOID_REDEEMER: Redeemer = "d87980";

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, poolUtxo, pool, airdropPoolScript, slotUtxo, airdropMarkerScript,
    airdropNftPolicy, airdropNftPolicyId, tree, claimerAddress,
    lamp_policy, lamp_name, validToMs,
  } = params;

  const claimerLovelace = params.claimerLovelace ?? 2_000_000n;
  const slotRedeemer = params.slotRedeemer ?? VOID_REDEEMER;

  // 1. Sinh proof + entry từ cây.
  const { entry, proof, leaf } = buildProofForAddress(tree, claimerAddress);
  const amount = entry.amount;
  if (amount <= 0n) throw new Error("CLAIM-001: amount ≤ 0 trong snapshot");

  const lampUnit = toUnit(lamp_policy, lamp_name);
  const slotUnit = toUnit(airdropNftPolicyId, leaf);

  // 2. slot UTxO phải mang đúng NFT (policy, leaf) — đối chiếu trước build.
  if ((slotUtxo.assets[slotUnit] ?? 0n) !== 1n) {
    throw new Error(`CLAIM-003: slotUtxo không mang NFT slot ${slotUnit} (đã claim?)`);
  }

  // 3. POOL' = POOL − amount LAMP; datum claimed_count += 1.
  const poolLamp = poolUtxo.assets[lampUnit] ?? 0n;
  if (poolLamp < amount) throw new Error("CLAIM-002: pool không đủ LAMP cho claim");
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets, [lampUnit]: poolLamp - amount };
  const poolOut: AirdropPool = { ...pool, claimed_count: pool.claimed_count + 1n };

  const poolAddress = poolUtxo.address;

  const tx = await lucid
    .newTx()
    .validTo(validToMs)
    // Spend POOL (redeemer Claim) + slot (marker validator).
    .collectFrom([poolUtxo], claimRedeemerToCbor(entry, proof))
    .attach.SpendingValidator(airdropPoolScript)
    .collectFrom([slotUtxo], slotRedeemer)
    .attach.SpendingValidator(airdropMarkerScript)
    // BURN slot NFT (-1) → nullifier spend-once.
    .mintAssets({ [slotUnit]: -1n }, burnSlotRedeemerToCbor())
    .attach.MintingPolicy(airdropNftPolicy)
    // POOL' (− amount LAMP), datum count+1
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: airdropPoolToCbor(poolOut) },
      poolOutAssets,
    )
    // claimer nhận amount LAMP
    .pay.ToAddress(claimerAddress, { lovelace: claimerLovelace, [lampUnit]: amount })
    .complete();

  const summary = [
    `═══ TIGER Airdrop Claim (spend-once) ═══`,
    `Claimer:      ${claimerAddress}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Leaf:         ${leaf}`,
    `Slot unit:    ${slotUnit} (BURN -1, từ ${pool.marker_dest})`,
    `Pool LAMP:    ${poolLamp} → ${poolLamp - amount} oil`,
    `claimed_count:${pool.claimed_count} → ${pool.claimed_count + 1n}`,
    `Proof steps:  ${proof.length}`,
  ].join("\n");

  return { tx, amount, leaf, slotUnit, summary };
}
