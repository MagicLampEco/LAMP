// sweepBuilder — ISPO Sweep: sau end_epoch quét LAMP dư về Treasury.
//
// FLOW (permissionless, chỉ chạy được khi now > end_epoch):
//   1. Spend POOL UTxO (redeemer IspoRedeemer::Sweep).
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

import { decodeIspoDatum, sweepRedeemerToCbor } from "./datum.js";
import type { IspoDatum } from "./types.js";

export interface SweepParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline IspoDatum). */
  poolUtxo: UTxO;
  /** Applied ispo_pool spend validator. */
  ispoPoolScript: Validator;

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
  sweptOil: bigint;
  treasuryAddress: string;
  summary: string;
}

export async function buildSweepTx(params: SweepParams): Promise<SweepResult> {
  const {
    lucid, network, poolUtxo, ispoPoolScript, lampPolicyId, lampAssetName, validFromMs,
  } = params;

  const treasuryLovelace = params.treasuryLovelace ?? 2_000_000n;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);

  if (!poolUtxo.datum) throw new Error("ISPO-SWEEP-001: poolUtxo không có inline datum");
  const datum: IspoDatum = decodeIspoDatum(Data.from(poolUtxo.datum));

  const sweptOil = poolUtxo.assets[lampUnit] ?? 0n;
  if (sweptOil <= 0n) throw new Error("ISPO-SWEEP-002: pool không còn LAMP để quét");

  // treasury_dest là Script hash (đích Sweep = Treasury script).
  const treasuryAddress = credentialToAddress(
    network, scriptHashToCredential(datum.treasury_dest),
  );

  const treasuryAssets: Record<string, bigint> = {
    lovelace: treasuryLovelace,
    [lampUnit]: sweptOil,
  };

  const txb = lucid
    .newTx()
    .collectFrom([poolUtxo], sweepRedeemerToCbor())
    .attach.SpendingValidator(ispoPoolScript)
    .pay.ToAddress(treasuryAddress, treasuryAssets)
    .validFrom(validFromMs);

  const tx = await txb.complete();

  const summary = [
    `═══ ISPO Sweep → Treasury ═══`,
    `Swept LAMP:    ${sweptOil / 1_000_000n} LAMP (${sweptOil} oil)`,
    `Treasury:      ${treasuryAddress}`,
    `end_epoch:     ${datum.end_epoch} (now phải > giá trị này)`,
    `validFrom ms:  ${validFromMs}`,
  ].join("\n");

  return { tx, sweptOil, treasuryAddress, summary };
}
