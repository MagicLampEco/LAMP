// useBuilder — Faucet v2 Use: chủ DID gia hạn account + dùng tLAMP test.
//
// FLOW:
//   1. Spend account UTxO (redeemer AccountRedeemer::Use).
//   2. Collect 1 UTxO mang DID NFT → chứng minh chủ DID.
//   3. Output account': ACCT NFT + did_name bất biến + last_epoch = now, tLAMP ≤ cũ
//      (cho phép rút ra dùng). Cập nhật last_epoch → tránh bị reclaim.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME, ACCT_NFT_NAME } from "./constants.js";
import {
  decodeFaucetAccount, faucetAccountToCbor, accountUseRedeemerToCbor,
} from "./datum.js";
import type { FaucetAccount } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface UseParams {
  lucid: LucidEvolution;
  network: Network;

  /** Account UTxO (inline FaucetAccount, mang ACCT NFT). */
  accountUtxo: UTxO;
  /** Applied faucet_account validator. */
  faucetAccountScript: Validator;
  /** policyId faucet_nft (ACCT NFT). */
  faucetNftPolicyId: string;

  /** UTxO mang DID NFT (chủ DID). */
  didUtxo: UTxO;
  didNftPolicyId: string;
  /** asset name (hex) DID NFT — phải khớp account.did_name. */
  didName: string;

  tlampPolicyId: string;
  tlampAssetName?: string;

  /** epoch hiện tại → account'.last_epoch. */
  currentEpoch: bigint;

  /** tLAMP (oildrop) rút ra khỏi account để dùng (0 = chỉ gia hạn). Mặc định 0. */
  withdrawOildrop?: bigint;
  /** ADA min account'. Mặc định = ADA account cũ. */
  accountLovelace?: bigint;
}

export interface UseResult {
  tx: TxSignBuilder;
  newAccountDatum: FaucetAccount;
  accountLampAfter: bigint;
  summary: string;
}

export async function buildUseTx(params: UseParams): Promise<UseResult> {
  const {
    lucid, network, accountUtxo, faucetAccountScript, faucetNftPolicyId,
    didUtxo, didNftPolicyId, didName, tlampPolicyId, currentEpoch,
  } = params;

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);
  const acctNftUnit = toUnit(faucetNftPolicyId, ACCT_NFT_NAME);
  const didUnit = toUnit(didNftPolicyId, didName);
  const withdraw = params.withdrawOildrop ?? 0n;

  if (!accountUtxo.datum) throw new Error("USE-001: accountUtxo has no inline datum");
  const acct: FaucetAccount = decodeFaucetAccount(Data.from(accountUtxo.datum));
  if (acct.did_name !== didName) {
    throw new Error(`USE-002: account did_name ${acct.did_name} ≠ ${didName}`);
  }
  if ((didUtxo.assets[didUnit] ?? 0n) < 1n) {
    throw new Error(`USE-003: didUtxo không chứa DID NFT ${didUnit}`);
  }

  const acctLamp = accountUtxo.assets[tlampUnit] ?? 0n;
  if (withdraw < 0n) throw new Error("USE-004: withdrawOildrop < 0");
  if (withdraw > acctLamp) throw new Error(`USE-005: withdraw ${withdraw} > account tLAMP ${acctLamp}`);
  const lampAfter = acctLamp - withdraw;

  const accountAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetAccountScript)),
  );
  const accountLovelace = params.accountLovelace ?? (accountUtxo.assets.lovelace ?? 2_000_000n);

  const newDatum: FaucetAccount = { did_name: acct.did_name, last_epoch: currentEpoch };

  const accountOutAssets: Record<string, bigint> = {
    lovelace: accountLovelace,
    [acctNftUnit]: 1n,
  };
  if (lampAfter > 0n) accountOutAssets[tlampUnit] = lampAfter;

  const tx = await lucid
    .newTx()
    .collectFrom([accountUtxo], accountUseRedeemerToCbor())
    .attach.SpendingValidator(faucetAccountScript)
    .collectFrom([didUtxo])
    .pay.ToAddressWithData(
      accountAddress,
      { kind: "inline", value: faucetAccountToCbor(newDatum) },
      accountOutAssets,
    )
    .complete();

  const summary = [
    `═══ Faucet v2 Use (gia hạn account) ═══`,
    `DID name:     ${didName}`,
    `last_epoch:   ${acct.last_epoch} → ${currentEpoch}`,
    `Account tLAMP: ${acctLamp} → ${lampAfter} oildrop (rút ${withdraw})`,
  ].join("\n");

  return { tx, newAccountDatum: newDatum, accountLampAfter: lampAfter, summary };
}
