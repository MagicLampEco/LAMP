// claimBuilder — Faucet v3 ClaimOpen: MỞ account MỚI cho một DID (first-claim).
//
// v1/v2 LỊCH SỬ: tệp này trước đây là `buildClaimTx` (v1, permissionless, không DID, spend
// validator `faucet.ak` đã XOÁ khỏi on-chain). v3 KHÔNG có đường claim không-DID nào nữa —
// mọi claim đều DID-gated. Tên tệp giữ nguyên (là builder "claim" cơ bản nhất của package),
// nội dung đổi hẳn sang `PoolRedeemer::ClaimOpen` (mở account MỚI, 0 account input, đúc ACCT
// NFT). Claim LẶP LẠI (account đã có) là việc của `claimDidBuilder.ts` (`ClaimAgain`).
//
// FLOW:
//   1. Spend POOL UTxO (PoolRedeemer::ClaimOpen).
//   2. Mint 1 ACCT NFT neo vào DID (FaucetNftRedeemer::MintAccount) — hợp lệ vì tx có
//      POOL NFT input (pool đang spend → faucet_nft policy uỷ quyền, xem `nft_mint::MintAccount`).
//   3. Collect 1 UTxO mang DID NFT của claimer (C-DID-1: chứng minh DID).
//   4. Output:
//      - pool' = pool − drip tLAMP; cfg + POOL NFT + ADA bảo toàn; window_epoch/claims_in_window
//        tiến đúng 1 bước (C-RATE-0..4).
//      - account MỚI: ACCT NFT + drip tLAMP + datum{did_name, last_claim_epoch=now,
//        last_touch_epoch=now}.
//
// Validity range: `ClaimOpen` dùng `util.get_epoch_pinned` (hai cận hữu hạn, CÙNG bucket) —
// builder BẮT BUỘC `pinnedEpochWindow` (xem `epochWindow.ts`), không tự đặt `validFrom` tay.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import {
  TLAMP_ASSET_NAME, acctName, assertMsPerEpochMatchesNetwork,
} from "./constants.js";
import {
  decodePoolDatum, poolDatumToCbor, faucetAccountToCbor,
  poolClaimOpenRedeemerToCbor, mintAccountRedeemerToCbor,
} from "./datum.js";
import { pinnedEpochWindow } from "./epochWindow.js";
import type { PoolDatum, FaucetAccount } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface ClaimOpenParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline PoolDatum bắt buộc, mang POOL NFT). */
  poolUtxo: UTxO;
  /** Applied faucet_pool spend validator. */
  faucetPoolScript: Validator;
  /** Applied faucet_nft minting policy (POOL + ACCT + burn). */
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

  tlampPolicyId: string;
  tlampAssetName?: string;

  /** Mốc "bây giờ" (ms Unix) dùng để tính cửa sổ hiệu lực pinned — KHÔNG đọc đồng hồ bên
   *  trong builder (thuần, dễ test). */
  nowMs: number;
  /** ms mỗi cửa sổ — PHẢI khớp param đã nạp cho faucetPoolScript/faucetAccountScript. */
  msPerEpoch: bigint;

  /** ADA min kèm account UTxO. Mặc định 2 tADA. */
  accountLovelace?: bigint;
}

export interface ClaimOpenResult {
  tx: TxSignBuilder;
  drip: bigint;
  poolAfter: bigint;
  epoch: bigint;
  accountDatum: FaucetAccount;
  accountAddress: string;
  summary: string;
}

export async function buildClaimOpenTx(params: ClaimOpenParams): Promise<ClaimOpenResult> {
  const {
    lucid, network, poolUtxo, faucetPoolScript, faucetNftPolicy, faucetNftPolicyId,
    faucetAccountScript, didUtxo, didNftPolicyId, didName, tlampPolicyId, msPerEpoch,
  } = params;

  // Cổng gác trước khi ký: ms/epoch dùng để tính cửa sổ (và đã nướng vào param pool/account)
  // phải khớp mạng đích — lệch thì tx vẫn pass, chỉ sai mốc, im lặng.
  assertMsPerEpochMatchesNetwork(msPerEpoch, network);

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);
  const an = acctName(didName);
  const acctNftUnit = toUnit(faucetNftPolicyId, an);
  const didUnit = toUnit(didNftPolicyId, didName);
  const accountLovelace = params.accountLovelace ?? 2_000_000n;

  // ── Decode pool datum ──────────────────────────────────────────────
  if (!poolUtxo.datum) throw new Error("CLAIM-OPEN-001: poolUtxo has no inline datum");
  const pd: PoolDatum = decodePoolDatum(Data.from(poolUtxo.datum));
  const cfg = pd.cfg;
  if (cfg.drip_oildrop <= 0n) throw new Error("CLAIM-OPEN-002: pool drip_oildrop must be > 0");

  // DID NFT phải có mặt trong didUtxo (qty ≥1) — C-DID-1.
  if ((didUtxo.assets[didUnit] ?? 0n) < 1n) {
    throw new Error(`CLAIM-OPEN-003: didUtxo không chứa DID NFT ${didUnit}`);
  }

  // Pool đủ tLAMP?
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  if (poolLamp < cfg.drip_oildrop) {
    throw new Error(`CLAIM-OPEN-004: pool còn ${poolLamp} oildrop < drip ${cfg.drip_oildrop}. Pool cạn.`);
  }

  // ── Cửa sổ pinned + trần tốc độ (mirror C-RATE-0..4 offchain, fail-fast) ────
  const { loMs, hiMs, epoch } = pinnedEpochWindow(params.nowMs, Number(msPerEpoch));
  if (epoch < pd.window_epoch) {
    throw new Error(
      `CLAIM-OPEN-005: epoch hiện tại ${epoch} < window_epoch trong datum pool ${pd.window_epoch} — ` +
      `đồng hồ lệch hoặc datum pool từ tương lai (C-RATE-1 on-chain sẽ từ chối).`,
    );
  }
  const used = epoch === pd.window_epoch ? pd.claims_in_window : 0n;
  if (used + 1n > cfg.max_claims_per_window) {
    throw new Error(
      `CLAIM-OPEN-006: hết quota cửa sổ ${epoch} (đã dùng ${used}/${cfg.max_claims_per_window}) — ` +
      `chờ cửa sổ sau, KHÔNG có đường vét sớm hơn (C-RATE-2 chốt DUY NHẤT chặn vét pool).`,
    );
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetPoolScript)),
  );
  const accountAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetAccountScript)),
  );

  // ── pool output: −drip tLAMP, cfg + POOL NFT + ADA bảo toàn, cửa sổ tiến 1 bước ──
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  const poolAfter = poolLamp - cfg.drip_oildrop;
  if (poolAfter > 0n) poolOutAssets[tlampUnit] = poolAfter;
  else delete poolOutAssets[tlampUnit];
  const poolDatumOut: PoolDatum = { cfg, window_epoch: epoch, claims_in_window: used + 1n };

  // ── account output MỚI: ACCT NFT + drip tLAMP + datum{did_name, now, now} ────
  const accountDatum: FaucetAccount = { did_name: didName, last_claim_epoch: epoch, last_touch_epoch: epoch };
  const accountAssets: Record<string, bigint> = {
    lovelace: accountLovelace,
    [acctNftUnit]: 1n,
    [tlampUnit]: cfg.drip_oildrop,
  };

  const tx = await lucid
    .newTx()
    .collectFrom([poolUtxo], poolClaimOpenRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .collectFrom([didUtxo])                       // mang DID NFT vào tx (DID-gated, C-DID-1)
    .mintAssets({ [acctNftUnit]: 1n }, mintAccountRedeemerToCbor())
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: poolDatumToCbor(poolDatumOut) },
      poolOutAssets,
    )
    .pay.ToAddressWithData(
      accountAddress,
      { kind: "inline", value: faucetAccountToCbor(accountDatum) },
      accountAssets,
    )
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  const summary = [
    `═══ Faucet v3 ClaimOpen (mở account mới) ═══`,
    `DID name:     ${didName}`,
    `Drip:         ${cfg.drip_oildrop / 1_000_000n} tLAMP (${cfg.drip_oildrop} oildrop)`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oildrop`,
    `Window:       ${epoch} (${used + 1n}/${cfg.max_claims_per_window} claim)`,
    `Account addr: ${accountAddress}`,
  ].join("\n");

  return { tx, drip: cfg.drip_oildrop, poolAfter, epoch, accountDatum, accountAddress, summary };
}
