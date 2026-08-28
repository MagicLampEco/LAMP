// claimDidBuilder — Faucet v2 Claim: DID-gated, drip 1001 tLAMP, rate-limited.
//
// FLOW (self-serve, permissionless trừ phải mang DID NFT):
//   1. Spend POOL UTxO (redeemer PoolRedeemer::Claim).
//   2. Mint 1 ACCT NFT (redeemer FaucetNftRedeemer::MintAccount). Hợp lệ vì tx có
//      POOL NFT input (pool đang spend → faucet_nft policy ủy quyền).
//   3. Collect 1 UTxO mang DID NFT (did_nft_policy, did_name) → chứng minh DID.
//   4. (Re-claim) tùy chọn spend account CŨ cùng DID → ép cooldown onchain.
//   5. Output:
//      - pool' = pool − drip tLAMP (POOL NFT + ADA + config bảo toàn).
//      - account mới: ACCT NFT + drip tLAMP + datum {did_name, last_epoch=now}.
//      - DID NFT trả lại ví claimer.
//
// LƯU Ý onchain: pool validator dùng validity_range.lower_bound → builder PHẢI set
// validFrom = "bây giờ" để now = epoch hiện tại (account.last_epoch khớp).

import {
  toUnit, fromText,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import {
  TLAMP_ASSET_NAME, ACCT_NFT_NAME, assertMsPerEpochMatchesNetwork,
} from "./constants.js";
import {
  decodeFaucetConfig, faucetConfigToCbor, faucetAccountToCbor,
  poolClaimRedeemerToCbor, mintAccountRedeemerToCbor, accountUseRedeemerToCbor,
} from "./datum.js";
import type { FaucetConfig, FaucetAccount } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface ClaimDidParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline FaucetConfig bắt buộc, mang POOL NFT). */
  poolUtxo: UTxO;
  /** Applied faucet_pool spend validator. */
  faucetPoolScript: Validator;
  /** Applied faucet_nft minting policy (POOL+ACCT). */
  faucetNftPolicy: MintingPolicy;
  /** policyId của faucetNftPolicy. */
  faucetNftPolicyId: string;
  /** Applied faucet_account spend validator (địa chỉ nhận account mới). */
  faucetAccountScript: Validator;

  /** UTxO mang DID NFT (chứng minh DID claimer). */
  didUtxo: UTxO;
  /** policyId của DID NFT. */
  didNftPolicyId: string;
  /** asset name (hex) của DID NFT = định danh per-DID (did_name account). */
  didName: string;

  /** tLAMP policy id. */
  tlampPolicyId: string;
  tlampAssetName?: string;

  /** [Re-claim] account CŨ cùng DID (spend để ép cooldown + giải phóng tLAMP cũ). */
  oldAccountUtxo?: UTxO;

  /** epoch hiện tại (offchain tính từ tip). Account.last_epoch = giá trị này. */
  currentEpoch: bigint;
  /** ms mỗi epoch dùng để tính `currentEpoch` + đã nạp làm param của faucetPoolScript /
   *  faucetAccountScript. Truyền vào thì builder gác nó khớp `network` (FAUCET-EPOCH-001);
   *  bỏ trống thì mặc định lấy đúng theo `network`. */
  msPerEpoch?: bigint;

  /** ADA min kèm account UTxO. Mặc định 2 tADA. */
  accountLovelace?: bigint;
}

export interface ClaimDidResult {
  tx: TxSignBuilder;
  drip: bigint;
  poolAfter: bigint;
  accountDatum: FaucetAccount;
  accountAddress: string;
  summary: string;
}

export async function buildClaimDidTx(params: ClaimDidParams): Promise<ClaimDidResult> {
  const {
    lucid, network, poolUtxo, faucetPoolScript, faucetNftPolicy, faucetNftPolicyId,
    faucetAccountScript, didUtxo, didNftPolicyId, didName, tlampPolicyId,
    currentEpoch,
  } = params;

  // Cổng gác trước khi ký: ms/epoch caller dùng (để tính currentEpoch, và đã nướng vào
  // param của pool/account script) phải khớp mạng đích — lệch thì tx vẫn pass, chỉ sai mốc.
  if (params.msPerEpoch !== undefined) assertMsPerEpochMatchesNetwork(params.msPerEpoch, network);

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);
  const acctNftUnit = toUnit(faucetNftPolicyId, ACCT_NFT_NAME);
  const didUnit = toUnit(didNftPolicyId, didName);
  const accountLovelace = params.accountLovelace ?? 2_000_000n;

  // ── Decode pool config ───────────────────────────────────────────────
  if (!poolUtxo.datum) throw new Error("CLAIM-D-001: poolUtxo has no inline datum");
  const cfg: FaucetConfig = decodeFaucetConfig(Data.from(poolUtxo.datum));
  const drip = cfg.drip_oildrop;
  if (drip <= 0n) throw new Error("CLAIM-D-002: pool drip_oildrop must be > 0");

  // DID NFT phải có mặt trong didUtxo (qty ≥1).
  if ((didUtxo.assets[didUnit] ?? 0n) < 1n) {
    throw new Error(`CLAIM-D-003: didUtxo không chứa DID NFT ${didUnit}`);
  }

  // Pool đủ tLAMP?
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  if (poolLamp < drip) {
    throw new Error(`CLAIM-D-004: pool còn ${poolLamp} oildrop < drip ${drip}. Pool cạn.`);
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetPoolScript)),
  );
  const accountAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetAccountScript)),
  );

  // ── pool output: −drip tLAMP, config + POOL NFT + ADA bảo toàn ──────────
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  const poolAfter = poolLamp - drip;
  if (poolAfter > 0n) poolOutAssets[tlampUnit] = poolAfter;
  else delete poolOutAssets[tlampUnit];

  // ── account output: ACCT NFT + drip tLAMP + datum ──────────────────────
  const accountDatum: FaucetAccount = { did_name: didName, last_epoch: currentEpoch };
  const accountAssets: Record<string, bigint> = {
    lovelace: accountLovelace,
    [acctNftUnit]: 1n,
    [tlampUnit]: drip,
  };

  let txb = lucid
    .newTx()
    .collectFrom([poolUtxo], poolClaimRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .collectFrom([didUtxo])                       // mang DID NFT vào tx (DID-gated)
    .mintAssets({ [acctNftUnit]: 1n }, mintAccountRedeemerToCbor())
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: faucetConfigToCbor(cfg) },
      poolOutAssets,
    )
    .pay.ToAddressWithData(
      accountAddress,
      { kind: "inline", value: faucetAccountToCbor(accountDatum) },
      accountAssets,
    );

  // Re-claim: spend account cũ (account validator Use sẽ ép cooldown ở tx đó —
  // hoặc pool ép qua find_account_input_epoch). Ở đây chỉ đưa input vào tx.
  if (params.oldAccountUtxo) {
    txb = txb
      .collectFrom([params.oldAccountUtxo], accountUseRedeemerToCbor())
      .attach.SpendingValidator(faucetAccountScript);
  }

  const tx = await txb.complete();

  const summary = [
    `═══ Faucet v2 Claim (DID-gated) ═══`,
    `DID name:     ${didName}`,
    `Drip:         ${drip / 1_000_000n} tLAMP (${drip} oildrop)`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oildrop`,
    `Account addr: ${accountAddress}`,
    `last_epoch:   ${currentEpoch}`,
    params.oldAccountUtxo ? `Re-claim:     spend account cũ (cooldown ${cfg.cooldown_epochs} epoch)` : `First-claim`,
  ].join("\n");

  void fromText;
  return { tx, drip, poolAfter, accountDatum, accountAddress, summary };
}
