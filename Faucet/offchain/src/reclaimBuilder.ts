// reclaimBuilder — Faucet v2 ReclaimIdle: keeper thu hồi account idle về pool.
//
// PERMISSIONLESS: account idle ≥ reclaim_epochs (1001) → BẤT KỲ AI spend nó, trả
// TOÀN BỘ tLAMP về pool (bảo toàn cung). Pool đồng thời spend (PoolRedeemer::Reclaim)
// để nhận token + cập nhật value.
//
// FLOW:
//   1. Spend account UTxO (AccountRedeemer::ReclaimIdle).
//   2. Spend POOL UTxO (PoolRedeemer::Reclaim).
//   3. Output pool' = pool + account.tLAMP (config + POOL NFT + ADA bảo toàn).
//   KHÔNG cần DID NFT. ACCT NFT có thể burn (đốt) — ở đây bỏ vào pool? Đơn giản
//   nhất: ACCT NFT không ràng buộc onchain → builder gửi về ví keeper (không ảnh
//   hưởng bảo toàn cung tLAMP). Token tLAMP về pool là điều kiện onchain duy nhất.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME } from "./constants.js";
import {
  decodeFaucetConfig, decodeFaucetAccount, faucetConfigToCbor,
  poolReclaimRedeemerToCbor, accountReclaimIdleRedeemerToCbor,
} from "./datum.js";
import type { FaucetConfig, FaucetAccount } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface ReclaimParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (FaucetConfig, POOL NFT). */
  poolUtxo: UTxO;
  faucetPoolScript: Validator;

  /** Account idle (FaucetAccount, ACCT NFT, giữ tLAMP). */
  accountUtxo: UTxO;
  faucetAccountScript: Validator;

  tlampPolicyId: string;
  tlampAssetName?: string;

  /** epoch hiện tại — chỉ để báo cáo (validity range ép now onchain). */
  currentEpoch: bigint;
}

export interface ReclaimResult {
  tx: TxSignBuilder;
  reclaimed: bigint;
  poolAfter: bigint;
  summary: string;
}

export async function buildReclaimTx(params: ReclaimParams): Promise<ReclaimResult> {
  const {
    lucid, network, poolUtxo, faucetPoolScript, accountUtxo, faucetAccountScript,
    tlampPolicyId, currentEpoch,
  } = params;

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);

  if (!poolUtxo.datum) throw new Error("RECLAIM-001: poolUtxo has no inline datum");
  if (!accountUtxo.datum) throw new Error("RECLAIM-002: accountUtxo has no inline datum");
  const cfg: FaucetConfig = decodeFaucetConfig(Data.from(poolUtxo.datum));
  const acct: FaucetAccount = decodeFaucetAccount(Data.from(accountUtxo.datum));

  const reclaimed = accountUtxo.assets[tlampUnit] ?? 0n;
  if (reclaimed <= 0n) throw new Error("RECLAIM-003: account không có tLAMP để thu hồi");

  // Cảnh báo offchain: kiểm idle (onchain ép cứng qua validity range).
  if (currentEpoch < acct.last_epoch + cfg.reclaim_epochs) {
    throw new Error(
      `RECLAIM-004: account chưa idle đủ. now=${currentEpoch} < last_epoch ${acct.last_epoch} + reclaim ${cfg.reclaim_epochs}`,
    );
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetPoolScript)),
  );

  // pool' = pool + reclaimed tLAMP (POOL NFT + ADA + config bảo toàn).
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  const poolAfter = poolLamp + reclaimed;
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets, [tlampUnit]: poolAfter };

  const tx = await lucid
    .newTx()
    .collectFrom([accountUtxo], accountReclaimIdleRedeemerToCbor())
    .attach.SpendingValidator(faucetAccountScript)
    .collectFrom([poolUtxo], poolReclaimRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: faucetConfigToCbor(cfg) },
      poolOutAssets,
    )
    .complete();

  const summary = [
    `═══ Faucet v2 ReclaimIdle (thu hồi → pool) ═══`,
    `Account DID:  ${acct.did_name} (last_epoch ${acct.last_epoch})`,
    `Reclaimed:    ${reclaimed / 1_000_000n} tLAMP (${reclaimed} oil) → pool`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oil`,
  ].join("\n");

  return { tx, reclaimed, poolAfter, summary };
}
