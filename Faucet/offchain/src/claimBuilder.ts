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
//        tiến đúng 1 bước (C-RATE-0..4); `opened_root` = gốc sau khi CHÈN khoá DID (C-OPEN-UNIQ-1).
//      - account MỚI: ACCT NFT + drip tLAMP + datum{did_name, last_claim_epoch=now,
//        last_touch_epoch=now}.
//
// SỔ MỘT-DID-MỘT-ACCOUNT (v3.1, INV-ONE-ACCT): redeemer mang bằng chứng MPF rằng khoá
// `blake2b_224(did_name)` CHƯA có trong `opened_root`. Builder nhận sổ (`OpenedLedger` đã dựng,
// hoặc danh sách account đang sống để tự dựng), ĐỐI CHIẾU gốc với datum pool (lệch ⇒
// `FAUCET-LEDGER-001`), rồi mới sinh bằng chứng. DID đã có account ⇒ ném `CLAIM-OPEN-007` —
// đường đúng là `buildClaimAgainTx` (claimDidBuilder.ts).
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
import { resolveOpenedLedger, type OpenedLedger, type OpenedLedgerSource } from "./openedLedger.js";
import type { PoolDatum, FaucetAccount, MpfProof } from "./types.js";
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
  /**
   * `window_origin_ms` đã apply vào faucet_nft/faucet_pool/faucet_account (tham số CUỐI,
   * Specs/Window/CONTRACT.md v1.0): cửa sổ = `(nowMs − windowOriginMs) / msPerEpoch`. Lấy từ
   * `windowOriginMs(network)` của `@magiclamp/utils` (Preview ném lỗi, không có giá trị). Truyền
   * lệch thì nhãn cửa sổ trong datum lệch với cái validator suy ra và giao dịch bị từ chối.
   */
  windowOriginMs: bigint;

  /** Sổ `opened_root` hiện tại: `OpenedLedger` đã dựng, HOẶC danh sách account đang sống
   *  (`{didName}` / `{acctAssetName}`) để builder tự dựng. Gốc phải khớp datum pool input. */
  openedLedger: OpenedLedgerSource;

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
  /** Datum pool output (có `opened_root` MỚI). */
  poolDatumOut: PoolDatum;
  /** Bằng chứng chèn đã đặt vào redeemer `ClaimOpen`. */
  proof: MpfProof;
  /** Sổ SAU khi tx này lên chuỗi — dùng cho lượt dựng kế tiếp. */
  nextLedger: OpenedLedger;
  summary: string;
}

export async function buildClaimOpenTx(params: ClaimOpenParams): Promise<ClaimOpenResult> {
  const {
    lucid, network, poolUtxo, faucetPoolScript, faucetNftPolicy, faucetNftPolicyId,
    faucetAccountScript, didUtxo, didNftPolicyId, didName, tlampPolicyId, msPerEpoch, windowOriginMs,
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
  const { loMs, hiMs, epoch } = pinnedEpochWindow(params.nowMs, Number(msPerEpoch), Number(windowOriginMs));
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

  // ── C-OPEN-UNIQ-1: sổ khớp datum, DID chưa có account, sinh bằng chứng chèn ────────
  const ledger = await resolveOpenedLedger(params.openedLedger, pd.opened_root);   // FAUCET-LEDGER-001
  if (ledger.hasDid(didName)) {
    throw new Error(
      `CLAIM-OPEN-007: DID ${didName} đã có account (khoá đang nằm trong opened_root) — mỗi DID tối đa ` +
      `MỘT account (INV-ONE-ACCT). Nạp thêm vào account đó bằng buildClaimAgainTx (ClaimAgain).`,
    );
  }
  const ins = await ledger.planInsert(didName);

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
  const poolDatumOut: PoolDatum = {
    cfg, window_epoch: epoch, claims_in_window: used + 1n, opened_root: ins.rootAfter,
  };

  // ── account output MỚI: ACCT NFT + drip tLAMP + datum{did_name, now, now} ────
  const accountDatum: FaucetAccount = { did_name: didName, last_claim_epoch: epoch, last_touch_epoch: epoch };
  const accountAssets: Record<string, bigint> = {
    lovelace: accountLovelace,
    [acctNftUnit]: 1n,
    [tlampUnit]: cfg.drip_oildrop,
  };

  const tx = await lucid
    .newTx()
    .collectFrom([poolUtxo], poolClaimOpenRedeemerToCbor(ins.proof))
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
    `opened_root:  ${ins.rootBefore} → ${ins.rootAfter} (${ledger.size} → ${ins.next.size} DID, proof ${ins.proof.length} bước)`,
  ].join("\n");

  return {
    tx, drip: cfg.drip_oildrop, poolAfter, epoch, accountDatum, accountAddress,
    poolDatumOut, proof: ins.proof, nextLedger: ins.next, summary,
  };
}
