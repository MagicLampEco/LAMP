// sweepBuilder — SRCL Sweep: sau end_epoch quét LAMP dư về Treasury.
//
// FLOW (permissionless, chỉ chạy được khi now > end_epoch):
//   1. Spend POOL UTxO (redeemer SrclRedeemer::Sweep).
//   2. Output: toàn bộ LAMP còn trong pool → Treasury (treasury_dest, Script).
//   onchain ép validity_range.lower_bound → epoch now > end_epoch (cận dưới).
//
// LƯU Ý: builder PHẢI set validFrom = thời điểm thuộc epoch > end_epoch để
// validator thấy now > end_epoch. POOL NFT không bắt buộc re-output (pool đóng).

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder, Data,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { decodeSrclDatum, sweepRedeemerToCbor } from "./datum.js";
import type { SrclDatum } from "./types.js";

export interface SweepParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline SrclDatum). */
  poolUtxo: UTxO;
  /** Applied srcl_pool spend validator. */
  srclPoolScript: Validator;

  /** LAMP policy id + asset name (hex). */
  lampPolicyId: string;
  lampAssetName: string;

  /** POSIX ms để set validFrom (PHẢI thuộc epoch > end_epoch). Caller tính từ tip. */
  validFromMs: number;

  /** ADA min kèm output Treasury. Mặc định 2 ADA. */
  treasuryLovelace?: bigint;
}

export interface SweepResult {
  tx: TxSignBuilder;
  sweptOildrop: bigint;
  treasuryAddress: string;
  summary: string;
}

export async function buildSweepTx(params: SweepParams): Promise<SweepResult> {
  const {
    lucid, network, poolUtxo, srclPoolScript, lampPolicyId, lampAssetName, validFromMs,
  } = params;

  const treasuryLovelace = params.treasuryLovelace ?? 2_000_000n;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);

  if (!poolUtxo.datum) throw new Error("SRCL-SWEEP-001: poolUtxo không có inline datum");
  const datum: SrclDatum = decodeSrclDatum(Data.from(poolUtxo.datum));

  const sweptOildrop = poolUtxo.assets[lampUnit] ?? 0n;
  if (sweptOildrop <= 0n) throw new Error("SRCL-SWEEP-002: pool không còn LAMP để quét");

  // treasury_dest là Script hash (đích Sweep = Treasury script).
  const treasuryAddress = credentialToAddress(
    network, scriptHashToCredential(datum.treasury_dest),
  );

  const treasuryAssets: Record<string, bigint> = {
    lovelace: treasuryLovelace,
    [lampUnit]: sweptOildrop,
  };

  const txb = lucid
    .newTx()
    .collectFrom([poolUtxo], sweepRedeemerToCbor())
    .attach.SpendingValidator(srclPoolScript)
    .pay.ToAddress(treasuryAddress, treasuryAssets)
    .validFrom(validFromMs);

  const tx = await txb.complete();

  const summary = [
    `═══ SRCL Sweep → Treasury ═══`,
    `Swept LAMP:    ${sweptOildrop / 1_000_000n} LAMP (${sweptOildrop} oildrop)`,
    `Treasury:      ${treasuryAddress}`,
    `end_epoch:     ${datum.end_epoch} (now phải > giá trị này)`,
    `validFrom ms:  ${validFromMs}`,
  ].join("\n");

  return { tx, sweptOildrop, treasuryAddress, summary };
}
