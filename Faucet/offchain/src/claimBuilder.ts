// Faucet claimBuilder — dev claim ĐÚNG claim_amount tLAMP từ pool (permissionless).
//
// Input:
//   - poolUtxo: Faucet pool UTxO (inline FaucetDatum). Spend với redeemer Claim.
// Output:
//   - pool': value = pool_in − claim_amount tLAMP; ADA + asset khác bảo toàn;
//            datum FaucetDatum bảo toàn (claim_amount không đổi).
//   - claimer: nhận ĐÚNG claim_amount tLAMP.
//   - KHÔNG mint (fixed-supply, chỉ chuyển pool → claimer).
//
// Invariants (khớp validator faucet.ak):
//   C-FAU-2  pool' datum == pool datum (claim_amount bảo toàn).
//   C-FAU-3  pool'.value = pool.value − claim_amount tLAMP; mọi asset khác bảo toàn.
//   C-RECV   claimer nhận đúng claim_amount tLAMP.
//   C-FAU-0  tx.mint == 0.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME } from "./constants.js";
import { decodeFaucetDatum, faucetDatumToCbor, claimRedeemerToCbor } from "./datum.js";
import type { FaucetDatum } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface ClaimParams {
  lucid:   LucidEvolution;
  network: Network;

  /** Faucet pool UTxO (inline FaucetDatum bắt buộc). */
  poolUtxo:     UTxO;
  faucetScript: Validator;

  /** tLAMP policy id (asset name mặc định "tLAMP"). */
  tlampPolicyId:   string;
  tlampAssetName?: string;

  /** Nơi nhận tLAMP. Mặc định = ví đang chọn (lucid wallet). */
  destinationAddress?: string;
}

export interface ClaimResult {
  tx:          TxSignBuilder;
  amount:      bigint;      // claim_amount nhả ra
  poolAfter:   bigint;      // tLAMP còn lại trong pool
  poolDatum:   FaucetDatum;
  summary:     string;
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const { lucid, network, poolUtxo, faucetScript, tlampPolicyId } = params;
  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);

  // ── Decode pool datum ──────────────────────────────────────────────
  if (!poolUtxo.datum) throw new Error("CLAIM-001: poolUtxo has no inline datum");
  const datum: FaucetDatum = decodeFaucetDatum(Data.from(poolUtxo.datum));
  const amount = datum.claim_amount;
  if (amount <= 0n) throw new Error("CLAIM-002: pool claim_amount must be > 0");

  // ── Đủ tLAMP trong pool? ───────────────────────────────────────────
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  if (poolLamp < amount) {
    throw new Error(
      `CLAIM-003: pool chỉ còn ${poolLamp} oil tLAMP < claim_amount ${amount}. Pool cạn — re-deploy.`,
    );
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetScript)),
  );
  const destination = params.destinationAddress ?? (await lucid.wallet().address());

  // ── pool output: clone toàn bộ assets, trừ ĐÚNG amount tLAMP (C-FAU-3) ──
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  const poolAfter = poolLamp - amount;
  if (poolAfter > 0n) poolOutAssets[tlampUnit] = poolAfter;
  else delete poolOutAssets[tlampUnit];   // pool cạn tLAMP → bỏ unit, giữ ADA

  // datum bảo toàn (C-FAU-2).
  const newPoolDatum: FaucetDatum = { claim_amount: datum.claim_amount };

  const tx = await lucid
    .newTx()
    .collectFrom([poolUtxo], claimRedeemerToCbor())
    .attach.SpendingValidator(faucetScript)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: faucetDatumToCbor(newPoolDatum) },
      poolOutAssets,
    )
    .pay.ToAddress(destination, { [tlampUnit]: amount })   // C-RECV: claimer nhận đúng amount
    .complete();

  const summary = [
    `═══ Faucet Claim ═══`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oil`,
    `Claim:        ${amount / 1_000_000n} LAMP (${amount} oil)`,
    `Destination:  ${destination}`,
  ].join("\n");

  return { tx, amount, poolAfter, poolDatum: newPoolDatum, summary };
}
