// useBuilder — Faucet v3 Use: chủ DID gia hạn mốc IDLE + dùng tLAMP test.
//
// v3 tách account datum thành HAI mốc (`last_claim_epoch` cooldown, `last_touch_epoch` idle —
// xem `types.ts`). `Use` CHỈ được đụng `last_touch_epoch`; `last_claim_epoch` bất biến
// (C-USE-CLAIMFIX-1 on-chain — không có dòng đó thì một lượt `Use` reset được cooldown).
//
// FLOW:
//   1. Spend account UTxO (AccountRedeemer::Use).
//   2. Collect 1 UTxO mang DID NFT → chứng minh chủ DID.
//   3. Output account': ACCT NFT + did_name + last_claim_epoch bất biến, last_touch_epoch=now
//      (KHÔNG LÙI — C-USE-MONO-1), tLAMP ≤ cũ (cho phép rút ra dùng, KHÔNG được tăng).
//
// Validity range: `Use` dùng `util.get_epoch_pinned` (C-USE-EPOCH-1) — PHẢI qua
// `pinnedEpochWindow`, không tự đặt `validFrom` tay bằng cận dưới trần (đường né cooldown/idle
// bằng cách lùi thời gian mà C-RATE-0/C-USE-EPOCH-1 tồn tại để chặn).
//
// C-USE-NOPOOL-1 (on-chain): tx KHÔNG được có POOL NFT input — builder này không đụng pool
// nên tự nhiên thoả, không cần cổng riêng.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME, acctName, assertMsPerEpochMatchesNetwork } from "./constants.js";
import {
  decodeFaucetAccount, faucetAccountToCbor, accountUseRedeemerToCbor,
} from "./datum.js";
import { pinnedEpochWindow } from "./epochWindow.js";
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

  nowMs: number;
  msPerEpoch: bigint;

  /** tLAMP (oildrop) rút ra khỏi account để dùng (0 = chỉ gia hạn). Mặc định 0. */
  withdrawOildrop?: bigint;
  /** ADA min account'. Mặc định = ADA account cũ. */
  accountLovelace?: bigint;
}

export interface UseResult {
  tx: TxSignBuilder;
  newAccountDatum: FaucetAccount;
  accountLampAfter: bigint;
  epoch: bigint;
  summary: string;
}

export async function buildUseTx(params: UseParams): Promise<UseResult> {
  const {
    lucid, network, accountUtxo, faucetAccountScript, faucetNftPolicyId,
    didUtxo, didNftPolicyId, didName, tlampPolicyId, msPerEpoch,
  } = params;

  assertMsPerEpochMatchesNetwork(msPerEpoch, network);

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);
  const an = acctName(didName);
  const acctNftUnit = toUnit(faucetNftPolicyId, an);
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
  if ((accountUtxo.assets[acctNftUnit] ?? 0n) < 1n) {
    throw new Error(`USE-006: accountUtxo không mang ACCT NFT ${acctNftUnit}`);
  }

  const acctLamp = accountUtxo.assets[tlampUnit] ?? 0n;
  if (withdraw < 0n) throw new Error("USE-004: withdrawOildrop < 0");
  if (withdraw > acctLamp) throw new Error(`USE-005: withdraw ${withdraw} > account tLAMP ${acctLamp}`);
  const lampAfter = acctLamp - withdraw;

  // ── C-USE-EPOCH-1: mốc neo vào thời gian thật ────────────────────────
  const { loMs, hiMs, epoch } = pinnedEpochWindow(params.nowMs, Number(msPerEpoch));
  // ── C-USE-MONO-1: mốc idle KHÔNG LÙI ─────────────────────────────────
  if (epoch < acct.last_touch_epoch) {
    throw new Error(
      `USE-007: epoch hiện tại ${epoch} < last_touch_epoch datum ${acct.last_touch_epoch} — ` +
      `mốc idle không được lùi (C-USE-MONO-1 sẽ từ chối).`,
    );
  }

  const accountLovelace = params.accountLovelace ?? (accountUtxo.assets.lovelace ?? 2_000_000n);

  // C-USE-CLAIMFIX-1: last_claim_epoch BẤT BIẾN. C-USE-TOUCH-1: last_touch_epoch = now.
  const newDatum: FaucetAccount = {
    did_name: acct.did_name,
    last_claim_epoch: acct.last_claim_epoch,
    last_touch_epoch: epoch,
  };

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
      accountUtxo.address,
      { kind: "inline", value: faucetAccountToCbor(newDatum) },
      accountOutAssets,
    )
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  const summary = [
    `═══ Faucet v3 Use (gia hạn mốc idle) ═══`,
    `DID name:      ${didName}`,
    `last_touch:    ${acct.last_touch_epoch} → ${epoch}`,
    `last_claim:    ${acct.last_claim_epoch} (bất biến)`,
    `Account tLAMP: ${acctLamp} → ${lampAfter} oildrop (rút ${withdraw})`,
  ].join("\n");

  return { tx, newAccountDatum: newDatum, accountLampAfter: lampAfter, epoch, summary };
}
