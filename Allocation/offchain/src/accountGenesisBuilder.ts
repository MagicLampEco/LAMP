// LAMP Allocation accountGenesisBuilder — tạo 1 ClaimAccount CHÍNH DANH (genesis, committee).
//
// Vá CRITICAL giả mạo account: account chỉ hợp lệ khi mang NFT do committee bảo chứng lúc
// genesis (account_nft.ak: mint gate committee threshold). Builder này dựng tx đó:
//   MINT 1 account NFT (policy accountNftPolicy, name = blake2b(owner‖channel)) — MintAccount.
//   OUT  ClaimAccount UTxO → claim_account script, value = min-ADA + NFT,
//        datum {owner, entitlement, redeemed=0, start_epoch, drops_per_epoch, channel_id}.
//   SIGN ≥ threshold committee (account_nft.ak: util.committee_approved(committee, threshold, sigs)).
//
// Invariants ép TRƯỚC build:
//   C-ACC-2  ≥ threshold committee signers.
//   C-ACC-1  NFT name = blake2b(owner‖channel).
//   C-ACC-3  redeemed khởi tạo == 0; NFT ra claim_account script (Script credential).
//   G-1      drops_per_epoch > 0; entitlement ≥ 0.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type Assets, type LucidEvolution, type MintingPolicy, type Network,
  type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import type { ClaimAccountDatum } from "./types.js";
import { claimAccountDatumToCbor, accountNftRedeemerToCbor } from "./datum.js";
import { accountNftName } from "./accountNft.js";
import { assertCommitteeSigners } from "./committee.js";
import { DEFAULT_MIN_ADA } from "./constants.js";

function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface AccountGenesisParams {
  lucid:   LucidEvolution;
  network: Network;

  /** owner PKH hex (chủ ví account). */
  owner: string;
  /** channel_id hex (kênh — bind với budget/treasury cùng kênh). */
  channelId: string;

  /** E khởi tạo (oildrop) — committee bảo chứng. ≥ 0 (0 = mở tài khoản, cấp sau qua Claim). */
  entitlement: bigint;
  /** t0 vesting (đặt lùi = cliff). */
  startEpoch: bigint;
  /** nhịp nhả (drops/epoch) — > 0. */
  dropsPerEpoch: bigint;

  /** account_nft minting policy đã apply (committee, threshold) + policy id. */
  accountNftPolicy:   MintingPolicy;
  accountNftPolicyId: string;

  /** claim_account spend validator (đích account UTxO). */
  claimAccountScript: Validator;

  /** committee M-of-N + threshold (khớp param bake vào account_nft). */
  committeeKeyHashes: string[];
  threshold?:         number;
  /** subset ký thực tế (default = toàn committee); phải đạt threshold. */
  signerKeyHashes?:   string[];

  /** min-ADA account UTxO (mặc định 2 ADA). */
  minAda?: bigint;
}

export interface AccountGenesisResult {
  tx:             TxSignBuilder;
  accountAddress: string;
  nftUnit:        string;
  accountDatum:   ClaimAccountDatum;
  summary:        string;
}

export async function buildAccountGenesisTx(
  params: AccountGenesisParams,
): Promise<AccountGenesisResult> {
  const {
    lucid, network, entitlement, startEpoch, dropsPerEpoch,
    accountNftPolicy, accountNftPolicyId, claimAccountScript, committeeKeyHashes,
  } = params;

  if (dropsPerEpoch <= 0n) throw new Error(`AGEN-001: dropsPerEpoch must be > 0 (got ${dropsPerEpoch})`); // G-1
  if (entitlement < 0n)    throw new Error(`AGEN-002: entitlement must be ≥ 0 (got ${entitlement})`);      // G-1
  if (startEpoch < 0n)     throw new Error(`AGEN-003: startEpoch must be ≥ 0 (got ${startEpoch})`);

  const signers   = params.signerKeyHashes ?? committeeKeyHashes;
  const threshold = assertCommitteeSigners(committeeKeyHashes, signers, params.threshold); // C-ACC-2

  const owner     = normHex(params.owner);
  const channelId = normHex(params.channelId);
  const minAda    = params.minAda ?? DEFAULT_MIN_ADA;

  const name    = accountNftName(owner, channelId);           // C-ACC-1
  const nftUnit = toUnit(accountNftPolicyId, name);

  const accountAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(claimAccountScript)),
  );

  const accountDatum: ClaimAccountDatum = {
    owner,
    entitlement,
    redeemed:        0n,                                       // C-ACC-3
    start_epoch:     startEpoch,
    drops_per_epoch: dropsPerEpoch,
    channel_id:      channelId,
  };

  // Account UTxO: min-ADA + 1 account NFT (không LAMP — value = auth-only).
  const accountValue: Assets = { lovelace: minAda, [nftUnit]: 1n };

  let txb = lucid
    .newTx()
    .mintAssets({ [nftUnit]: 1n }, accountNftRedeemerToCbor())  // MintAccount (C-ACC-1)
    .attach.MintingPolicy(accountNftPolicy)
    .pay.ToAddressWithData(
      accountAddress,
      { kind: "inline", value: claimAccountDatumToCbor(accountDatum) },
      accountValue,                                            // NFT → claim_account (C-ACC-3)
    );

  for (const k of signers) txb = txb.addSignerKey(k);          // C-ACC-2

  const tx = await txb.complete();

  const summary = [
    `═══ Genesis account (committee-gated) ═══`,
    `Owner:    ${owner}`,
    `Channel:  ${channelId}`,
    `E:        ${entitlement} oildrop   dpe: ${dropsPerEpoch}   start: ${startEpoch}`,
    `NFT:      ${nftUnit}`,
    `Account:  ${accountAddress}  (redeemed = 0)`,
    `Signers:  ${signers.length}/${committeeKeyHashes.length} (need ${threshold})`,
  ].join("\n");

  return { tx, accountAddress, nftUnit, accountDatum, summary };
}
