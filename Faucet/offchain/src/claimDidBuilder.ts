// claimDidBuilder — Faucet v3 ClaimAgain: nạp thêm drip vào account ĐÃ CÓ của một DID.
//
// LỊCH SỬ: tệp này trước đây là `buildClaimDidTx` (v2), một hàm duy nhất xử cả "mở mới" lẫn
// "re-claim" tuỳ `oldAccountUtxo` có mặt hay không. v3 tách on-chain thành hai redeemer RIÊNG
// (`ClaimOpen` 0 account input vs `ClaimAgain` 1 account input, C-AGAIN-2) nên off-chain cũng
// tách theo: mở account mới → `claimBuilder.ts` (`buildClaimOpenTx`); nạp thêm vào account cũ
// → tệp này (`buildClaimAgainTx`, `oldAccountUtxo` nay BẮT BUỘC, không còn optional).
//
// FLOW:
//   1. Spend POOL UTxO (PoolRedeemer::ClaimAgain).
//   2. Spend account CŨ cùng DID (AccountRedeemer::TopUp) — KHÔNG mint gì. Hai chốt on-chain,
//      không phải một: pool đòi `tx.mint` dưới `faucet_nft_policy` RỖNG (C-MINT-ONLY-OPEN-1) và
//      account đòi mint của CHÍNH tên đó bằng 0 (C-TOP-4).
//   3. Collect 1 UTxO mang DID NFT của chủ account. BẮT BUỘC ở CẢ HAI lớp chốt on-chain:
//      pool (C-DID-1, chung với ClaimOpen) VÀ account (C-TOP-DID-1, thêm 2026-09-28 — chặn
//      griefing "ai cũng TopUp được account người khác, đẩy cooldown của họ ra xa" — xem
//      `handlers.ak` đầu mục TOPUP). Builder ném lỗi có mã NGAY khi không tìm thấy DID NFT,
//      không dựng tx thiếu nó (thiếu thì on-chain reject, nhưng phí đã mất).
//   4. Output:
//      - pool' = pool − drip tLAMP; cfg + POOL NFT + ADA bảo toàn; window/claims tiến 1 bước;
//        `opened_root` GIỮ NGUYÊN (C-ROOT-KEEP-1) — nhánh này không cần bằng chứng sổ.
//      - account' = account cũ + drip tLAMP; ACCT NFT giữ nguyên (KHÔNG đúc lại); datum
//        {did_name bất biến, last_claim_epoch=now, last_touch_epoch=now}.
//
// Validity range: `ClaimAgain` (pool, qua `check_claim`) VÀ `TopUp` (account) đều dùng
// `util.get_epoch_pinned` — builder dùng CHUNG một `pinnedEpochWindow` cho cả hai spend trong
// CÙNG một tx (hai script khác nhau nhưng phải thấy CÙNG một validity range vì nó là thuộc
// tính của TX, không phải của từng input).

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME, acctName, assertMsPerEpochMatchesNetwork } from "./constants.js";
import {
  decodePoolDatum, decodeFaucetAccount, poolDatumToCbor, faucetAccountToCbor,
  poolClaimAgainRedeemerToCbor, accountTopUpRedeemerToCbor,
} from "./datum.js";
import { pinnedEpochWindow } from "./epochWindow.js";
import type { PoolDatum, FaucetAccount } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface ClaimAgainParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline PoolDatum bắt buộc, mang POOL NFT). */
  poolUtxo: UTxO;
  faucetPoolScript: Validator;

  /** Account ĐÃ CÓ của DID này (inline FaucetAccount, mang ACCT NFT). BẮT BUỘC. */
  oldAccountUtxo: UTxO;
  faucetAccountScript: Validator;

  /** UTxO mang DID NFT của chủ account — bắt buộc ở CẢ pool (C-DID-1) lẫn account (C-TOP-DID-1). */
  didUtxo: UTxO;
  didNftPolicyId: string;
  didName: string;

  faucetNftPolicyId: string;

  tlampPolicyId: string;
  tlampAssetName?: string;

  nowMs: number;
  msPerEpoch: bigint;

  accountLovelace?: bigint;
}

export interface ClaimAgainResult {
  tx: TxSignBuilder;
  drip: bigint;
  poolAfter: bigint;
  epoch: bigint;
  accountDatum: FaucetAccount;
  accountAddress: string;
  summary: string;
}

export async function buildClaimAgainTx(params: ClaimAgainParams): Promise<ClaimAgainResult> {
  const {
    lucid, network, poolUtxo, faucetPoolScript, oldAccountUtxo, faucetAccountScript,
    didUtxo, didNftPolicyId, didName, faucetNftPolicyId, tlampPolicyId, msPerEpoch,
  } = params;

  assertMsPerEpochMatchesNetwork(msPerEpoch, network);

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);
  const an = acctName(didName);
  const acctNftUnit = toUnit(faucetNftPolicyId, an);
  const didUnit = toUnit(didNftPolicyId, didName);

  // ── C-DID-1 (pool) + C-TOP-DID-1 (account, thêm 2026-09-28): DID NFT PHẢI có mặt. Ném
  // NGAY, không dựng tx thiếu nó — thiếu DID thì on-chain reject cả hai lớp chốt, builder
  // không nên chờ tới lúc submit mới báo. ─────────────────────────────────────────────────
  if ((didUtxo.assets[didUnit] ?? 0n) < 1n) {
    throw new Error(`CLAIM-AGAIN-000: didUtxo không chứa DID NFT ${didUnit} — bắt buộc ở cả pool (C-DID-1) lẫn account (C-TOP-DID-1).`);
  }

  // ── Decode pool datum ──────────────────────────────────────────────
  if (!poolUtxo.datum) throw new Error("CLAIM-AGAIN-001: poolUtxo has no inline datum");
  const pd: PoolDatum = decodePoolDatum(Data.from(poolUtxo.datum));
  const cfg = pd.cfg;
  if (cfg.drip_oildrop <= 0n) throw new Error("CLAIM-AGAIN-002: pool drip_oildrop must be > 0");

  // ── Decode account cũ, đối chiếu DID + ACCT NFT ──────────────────────
  if (!oldAccountUtxo.datum) throw new Error("CLAIM-AGAIN-003: oldAccountUtxo has no inline datum");
  const oldAcct: FaucetAccount = decodeFaucetAccount(Data.from(oldAccountUtxo.datum));
  if (oldAcct.did_name !== didName) {
    throw new Error(`CLAIM-AGAIN-004: oldAccountUtxo.did_name ${oldAcct.did_name} ≠ ${didName}`);
  }
  if ((oldAccountUtxo.assets[acctNftUnit] ?? 0n) < 1n) {
    throw new Error(`CLAIM-AGAIN-005: oldAccountUtxo không mang ACCT NFT ${acctNftUnit}`);
  }

  // Pool đủ tLAMP?
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  if (poolLamp < cfg.drip_oildrop) {
    throw new Error(`CLAIM-AGAIN-006: pool còn ${poolLamp} oildrop < drip ${cfg.drip_oildrop}. Pool cạn.`);
  }

  // ── Cửa sổ pinned + trần tốc độ (mirror C-RATE-0..4) ─────────────────
  const { loMs, hiMs, epoch } = pinnedEpochWindow(params.nowMs, Number(msPerEpoch));
  if (epoch < pd.window_epoch) {
    throw new Error(`CLAIM-AGAIN-007: epoch hiện tại ${epoch} < window_epoch datum pool ${pd.window_epoch}.`);
  }
  const used = epoch === pd.window_epoch ? pd.claims_in_window : 0n;
  if (used + 1n > cfg.max_claims_per_window) {
    throw new Error(
      `CLAIM-AGAIN-008: hết quota cửa sổ ${epoch} (đã dùng ${used}/${cfg.max_claims_per_window}) — chờ cửa sổ sau.`,
    );
  }

  // ── Cooldown (C-COOL-1): mirror offchain, đọc mốc COOLDOWN (last_claim_epoch) ────
  if (epoch < oldAcct.last_claim_epoch + cfg.cooldown_epochs) {
    throw new Error(
      `CLAIM-AGAIN-009: chưa hết cooldown. now=${epoch} < last_claim_epoch ${oldAcct.last_claim_epoch} + ` +
      `cooldown ${cfg.cooldown_epochs} = ${oldAcct.last_claim_epoch + cfg.cooldown_epochs}.`,
    );
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetPoolScript)),
  );

  // ── pool output: −drip tLAMP, cfg + POOL NFT + ADA bảo toàn, cửa sổ tiến 1 bước ──
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  const poolAfter = poolLamp - cfg.drip_oildrop;
  if (poolAfter > 0n) poolOutAssets[tlampUnit] = poolAfter;
  else delete poolOutAssets[tlampUnit];
  // C-ROOT-KEEP-1: `ClaimAgain` không mở/đóng account nào ⇒ sổ `opened_root` giữ NGUYÊN.
  const poolDatumOut: PoolDatum = {
    cfg, window_epoch: epoch, claims_in_window: used + 1n, opened_root: pd.opened_root,
  };

  // ── account output: CỘNG THÊM drip, ACCT NFT giữ nguyên, KHÔNG đúc lại (C-MINT-ONLY-OPEN-1) ──
  // Địa chỉ TÁI TẠO lấy TỪ CHÍNH `oldAccountUtxo.address`, không tự tính lại qua
  // validatorToScriptHash — cùng lý do C-ACCT-ADDR-1/C-TOP-ADDR-1 on-chain ép "đúng địa chỉ
  // input kể cả stake credential": hai nguồn cùng tả một địa chỉ là chỗ dễ trôi nhau.
  const oldLamp = oldAccountUtxo.assets[tlampUnit] ?? 0n;
  const accountDatum: FaucetAccount = { did_name: didName, last_claim_epoch: epoch, last_touch_epoch: epoch };
  const accountAssets: Record<string, bigint> = {
    ...oldAccountUtxo.assets,
    [tlampUnit]: oldLamp + cfg.drip_oildrop,
  };

  const tx = await lucid
    .newTx()
    .collectFrom([poolUtxo], poolClaimAgainRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .collectFrom([oldAccountUtxo], accountTopUpRedeemerToCbor())
    .attach.SpendingValidator(faucetAccountScript)
    .collectFrom([didUtxo])                       // C-DID-1 + C-TOP-DID-1
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: poolDatumToCbor(poolDatumOut) },
      poolOutAssets,
    )
    .pay.ToAddressWithData(
      oldAccountUtxo.address,
      { kind: "inline", value: faucetAccountToCbor(accountDatum) },
      accountAssets,
    )
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  const summary = [
    `═══ Faucet v3 ClaimAgain (nạp thêm vào account đã có) ═══`,
    `DID name:     ${didName}`,
    `Drip:         ${cfg.drip_oildrop / 1_000_000n} tLAMP (${cfg.drip_oildrop} oildrop)`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oildrop`,
    `Account tLAMP: ${oldLamp} → ${oldLamp + cfg.drip_oildrop} oildrop`,
    `Window:       ${epoch} (${used + 1n}/${cfg.max_claims_per_window} claim)`,
    `Cooldown:     last_claim_epoch ${oldAcct.last_claim_epoch} → ${epoch}`,
  ].join("\n");

  return {
    tx, drip: cfg.drip_oildrop, poolAfter, epoch, accountDatum,
    accountAddress: oldAccountUtxo.address, summary,
  };
}
