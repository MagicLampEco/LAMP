// sweepBuilder — TIGER Airdrop Sweep. Sau deadline_epoch → toàn bộ LAMP dư trong
// pool hoàn về treasury_dest (Treasury custody). Permissionless.
//
// FLOW:
//   1. Spend POOL UTxO (AirdropRedeemer::Sweep). validFrom (lower_bound) ≥ deadline.
//   2. Output treasury_dest ← toàn bộ LAMP còn lại (≥ pool LAMP onchain).
//   POOL NFT + min-ADA: builder gửi kèm về treasury (onchain chỉ ép LAMP → treasury).

import {
  toUnit,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import { sweepRedeemerToCbor } from "./datum.js";
import type { AirdropPool } from "./types.js";

export interface SweepParams {
  lucid: LucidEvolution;

  /** POOL UTxO (datum AirdropPool, POOL NFT, kho LAMP dư). */
  poolUtxo: UTxO;
  /** Datum pool đã decode (cần treasury_dest + deadline_epoch). */
  pool: AirdropPool;
  airdropPoolScript: Validator;

  lamp_policy: string;
  lamp_name: string;

  /** Khoảng hợp lệ: lower_bound (POSIX ms) PHẢI ≥ deadline (onchain ép). Caller set. */
  validFromMs: number;
}

export interface SweepResult {
  tx: TxSignBuilder;
  swept: bigint;
  summary: string;
}

export async function buildSweepTx(params: SweepParams): Promise<SweepResult> {
  const {
    lucid, poolUtxo, pool, airdropPoolScript, lamp_policy, lamp_name, validFromMs,
  } = params;

  const lampUnit = toUnit(lamp_policy, lamp_name);
  const swept = poolUtxo.assets[lampUnit] ?? 0n;

  // Toàn bộ value pool (LAMP dư + POOL NFT + ADA) → treasury_dest.
  const treasuryAssets: Record<string, bigint> = { ...poolUtxo.assets };

  const tx = await lucid
    .newTx()
    .validFrom(validFromMs)
    .collectFrom([poolUtxo], sweepRedeemerToCbor())
    .attach.SpendingValidator(airdropPoolScript)
    .pay.ToAddress(pool.treasury_dest, treasuryAssets)
    .complete();

  const summary = [
    `═══ TIGER Airdrop Sweep (dư → Treasury) ═══`,
    `Treasury:     ${pool.treasury_dest}`,
    `Swept LAMP:   ${swept / 1_000_000n} LAMP (${swept} oil)`,
    `Deadline:     epoch ${pool.deadline_epoch} (đã qua)`,
    `Đã claim:     ${pool.claimed_count} leaf`,
  ].join("\n");

  return { tx, swept, summary };
}
