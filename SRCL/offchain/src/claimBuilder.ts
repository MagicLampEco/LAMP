// claimBuilder — SRCL Claim: delegator nhận LAMP epoch e qua Merkle proof.
//
// FLOW TRUSTLESS (permissionless — ai có proof + slot đều claim được):
//   1. Spend POOL UTxO (redeemer SrclRedeemer::Claim{ClaimProof}).
//   2. Spend CLAIM-SLOT UTxO từ registry (srcl_marker) — slot name =
//      blake2b_256(epoch||owner). Marker validator ép: có POOL input + slot burn.
//   3. BURN slot NFT (redeemer BurnSlot, qty −1). Hợp lệ vì tx có POOL NFT input.
//      CHỐNG DOUBLE-CLAIM: slot tiêu 1 lần là HẾT (spend-once eUTxO).
//   4. Output:
//      - pool' = pool − amount LAMP (POOL NFT + ADA + epoch_roots bảo toàn;
//        distributed_total += amount).
//      - owner: amount LAMP (KHÔNG còn marker NFT — slot đã burn).
//
// onchain ép: Merkle verify (epoch,owner,amount) ∈ epoch_roots[epoch]; slot đúng
// tên consume TỪ registry + burn −1; value pool bảo toàn trừ −amount LAMP.

import {
  toUnit,
  credentialToAddress, keyHashToCredential, scriptHashToCredential,
  validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder, Data,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { POOL_NFT_NAME } from "./constants.js";
import { decodeSrclDatum, srclDatumToCbor, claimRedeemerToCbor, burnSlotRedeemerToCbor } from "./datum.js";
import { markerName } from "./merkle.js";
import type { ClaimProof, SrclDatum } from "./types.js";

export interface ClaimParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline SrclDatum, mang POOL NFT). */
  poolUtxo: UTxO;
  /** CLAIM-SLOT UTxO ở registry — mang slot NFT name=blake2b_256(epoch||owner). */
  slotUtxo: UTxO;
  /** Applied srcl_pool spend validator. */
  srclPoolScript: Validator;
  /** Applied srcl_marker spend validator (registry GIỮ slot). */
  srclMarkerScript: Validator;
  /** Applied srcl_nft minting policy (POOL+SLOT). */
  srclNftPolicy: MintingPolicy;
  /** policyId của srclNftPolicy. */
  srclNftPolicyId: string;

  /** LAMP policy id + asset name (hex). */
  lampPolicyId: string;
  lampAssetName: string;

  /** Mục claim (epoch, owner pkh, amount oil, Merkle proof). */
  claim: ClaimProof;

  /** ADA min kèm output owner. Mặc định 2 ADA. */
  ownerLovelace?: bigint;
}

export interface ClaimResult {
  tx: TxSignBuilder;
  amount: bigint;
  poolAfter: bigint;
  slotUnit: string;
  ownerAddress: string;
  datumAfter: SrclDatum;
  summary: string;
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, network, poolUtxo, slotUtxo, srclPoolScript, srclMarkerScript,
    srclNftPolicy, srclNftPolicyId, lampPolicyId, lampAssetName, claim,
  } = params;

  const ownerLovelace = params.ownerLovelace ?? 2_000_000n;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);
  const poolNftUnit = toUnit(srclNftPolicyId, POOL_NFT_NAME);

  if (!poolUtxo.datum) throw new Error("SRCL-CLAIM-001: poolUtxo không có inline datum");
  const datum: SrclDatum = decodeSrclDatum(Data.from(poolUtxo.datum));

  const { epoch, owner, amount, proof } = claim;
  if (amount <= 0n) throw new Error("SRCL-CLAIM-002: amount phải > 0");
  if (epoch < 0n || epoch >= BigInt(datum.epoch_roots.length)) {
    throw new Error(`SRCL-CLAIM-003: chưa có root cho epoch ${epoch} (đã nạp ${datum.epoch_roots.length})`);
  }
  if ((poolUtxo.assets[poolNftUnit] ?? 0n) < 1n) {
    throw new Error("SRCL-CLAIM-004: poolUtxo không mang POOL NFT");
  }

  const poolLamp = poolUtxo.assets[lampUnit] ?? 0n;
  if (poolLamp < amount) {
    throw new Error(`SRCL-CLAIM-005: pool còn ${poolLamp} oil < amount ${amount}. Quỹ epoch cạn.`);
  }

  // slot NFT name = blake2b_256(epoch || owner). slotUtxo PHẢI mang đúng slot này.
  const sName = markerName(epoch, owner);
  const slotUnit = toUnit(srclNftPolicyId, sName);
  if ((slotUtxo.assets[slotUnit] ?? 0n) < 1n) {
    throw new Error(`SRCL-CLAIM-006: slotUtxo không mang slot NFT (epoch=${epoch}, owner=${owner})`);
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(srclPoolScript)),
  );
  // owner = payment-credential hash → địa chỉ ví owner (enterprise, không stake).
  const ownerAddress = credentialToAddress(network, keyHashToCredential(owner));

  // ── pool output: −amount LAMP; datum distributed_total += amount ─────────
  const poolAfter = poolLamp - amount;
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  if (poolAfter > 0n) poolOutAssets[lampUnit] = poolAfter;
  else delete poolOutAssets[lampUnit];

  const datumAfter: SrclDatum = {
    ...datum,
    distributed_total: datum.distributed_total + amount,
  };

  // ── owner output: amount LAMP (KHÔNG marker — slot đã burn) ──────────────
  const ownerAssets: Record<string, bigint> = {
    lovelace: ownerLovelace,
    [lampUnit]: amount,
  };

  const txb = lucid
    .newTx()
    // POOL input (Claim) + SLOT input (registry, marker validator).
    .collectFrom([poolUtxo], claimRedeemerToCbor(claim))
    .collectFrom([slotUtxo], Data.void())
    .attach.SpendingValidator(srclPoolScript)
    .attach.SpendingValidator(srclMarkerScript)
    // BURN slot NFT (−1) → spend-once.
    .mintAssets({ [slotUnit]: -1n }, burnSlotRedeemerToCbor())
    .attach.MintingPolicy(srclNftPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: srclDatumToCbor(datumAfter) },
      poolOutAssets,
    )
    .pay.ToAddress(ownerAddress, ownerAssets);

  const tx = await txb.complete();

  const summary = [
    `═══ SRCL Claim (slot spend-once) ═══`,
    `Epoch:        ${epoch}`,
    `Owner (pkh):  ${owner}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Pool LAMP:    ${poolLamp} → ${poolAfter} oil`,
    `Slot NFT:     ${slotUnit} (BURN −1)`,
    `Proof steps:  ${proof.length}`,
  ].join("\n");

  return { tx, amount, poolAfter, slotUnit, ownerAddress, datumAfter, summary };
}
