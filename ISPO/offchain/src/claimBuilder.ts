// claimBuilder — ISPO Claim: delegator nhận LAMP epoch e qua Merkle proof.
//
// FLOW (permissionless — ai có proof + nhận đúng owner đều claim được):
//   1. Spend POOL UTxO (redeemer IspoRedeemer::Claim{ClaimProof}).
//   2. Mint 1 MARKER NFT name=blake2b_256(epoch||owner) (redeemer MintMarker).
//      Hợp lệ vì tx có POOL NFT input (ispo_nft ủy quyền). CHỐNG DOUBLE-CLAIM.
//   3. Output:
//      - pool' = pool − amount LAMP (POOL NFT + ADA + epoch_roots bảo toàn;
//        distributed_total += amount).
//      - owner: amount LAMP + 1 MARKER NFT (biên-lai per (epoch,owner)).
//
// onchain ép: Merkle verify (epoch,owner,amount) ∈ epoch_roots[epoch]; marker đúng
// tên + qty 1 tới owner; value pool bảo toàn trừ −amount LAMP.

import {
  toUnit,
  credentialToAddress, keyHashToCredential, scriptHashToCredential,
  validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder, Data,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { POOL_NFT_NAME } from "./constants.js";
import { decodeIspoDatum, ispoDatumToCbor, claimRedeemerToCbor, mintMarkerRedeemerToCbor } from "./datum.js";
import { markerName } from "./merkle.js";
import type { ClaimProof, IspoDatum } from "./types.js";

export interface ClaimParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline IspoDatum, mang POOL NFT). */
  poolUtxo: UTxO;
  /** Applied ispo_pool spend validator. */
  ispoPoolScript: Validator;
  /** Applied ispo_nft minting policy (POOL+MARKER). */
  ispoNftPolicy: MintingPolicy;
  /** policyId của ispoNftPolicy. */
  ispoNftPolicyId: string;

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
  markerUnit: string;
  ownerAddress: string;
  datumAfter: IspoDatum;
  summary: string;
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, network, poolUtxo, ispoPoolScript, ispoNftPolicy, ispoNftPolicyId,
    lampPolicyId, lampAssetName, claim,
  } = params;

  const ownerLovelace = params.ownerLovelace ?? 2_000_000n;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);
  const poolNftUnit = toUnit(ispoNftPolicyId, POOL_NFT_NAME);

  if (!poolUtxo.datum) throw new Error("ISPO-CLAIM-001: poolUtxo không có inline datum");
  const datum: IspoDatum = decodeIspoDatum(Data.from(poolUtxo.datum));

  const { epoch, owner, amount, proof } = claim;
  if (amount <= 0n) throw new Error("ISPO-CLAIM-002: amount phải > 0");
  if (epoch < 0n || epoch >= BigInt(datum.epoch_roots.length)) {
    throw new Error(`ISPO-CLAIM-003: chưa có root cho epoch ${epoch} (đã nạp ${datum.epoch_roots.length})`);
  }
  if ((poolUtxo.assets[poolNftUnit] ?? 0n) < 1n) {
    throw new Error("ISPO-CLAIM-004: poolUtxo không mang POOL NFT");
  }

  const poolLamp = poolUtxo.assets[lampUnit] ?? 0n;
  if (poolLamp < amount) {
    throw new Error(`ISPO-CLAIM-005: pool còn ${poolLamp} oil < amount ${amount}. Quỹ epoch cạn.`);
  }

  // marker NFT name = blake2b_256(epoch || owner).
  const mName = markerName(epoch, owner);
  const markerUnit = toUnit(ispoNftPolicyId, mName);

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(ispoPoolScript)),
  );
  // owner = payment-credential hash → địa chỉ ví owner (enterprise, không stake).
  const ownerAddress = credentialToAddress(network, keyHashToCredential(owner));

  // ── pool output: −amount LAMP; datum distributed_total += amount ─────────
  const poolAfter = poolLamp - amount;
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  if (poolAfter > 0n) poolOutAssets[lampUnit] = poolAfter;
  else delete poolOutAssets[lampUnit];

  const datumAfter: IspoDatum = {
    ...datum,
    distributed_total: datum.distributed_total + amount,
  };

  // ── owner output: amount LAMP + MARKER NFT ──────────────────────────────
  const ownerAssets: Record<string, bigint> = {
    lovelace: ownerLovelace,
    [lampUnit]: amount,
    [markerUnit]: 1n,
  };

  const txb = lucid
    .newTx()
    .collectFrom([poolUtxo], claimRedeemerToCbor(claim))
    .attach.SpendingValidator(ispoPoolScript)
    .mintAssets({ [markerUnit]: 1n }, mintMarkerRedeemerToCbor())
    .attach.MintingPolicy(ispoNftPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: ispoDatumToCbor(datumAfter) },
      poolOutAssets,
    )
    .pay.ToAddress(ownerAddress, ownerAssets);

  const tx = await txb.complete();

  const summary = [
    `═══ ISPO Claim ═══`,
    `Epoch:        ${epoch}`,
    `Owner (pkh):  ${owner}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Pool LAMP:    ${poolLamp} → ${poolAfter} oil`,
    `Marker NFT:   ${markerUnit}`,
    `Proof steps:  ${proof.length}`,
  ].join("\n");

  return { tx, amount, poolAfter, markerUnit, ownerAddress, datumAfter, summary };
}
