// reclaimBuilder — Faucet v3 ReclaimIdle: keeper thu hồi account idle về pool + ĐỐT ACCT NFT.
//
// PERMISSIONLESS: account idle ≥ reclaim_epochs_const (1001 cửa sổ, hằng COMPILE-TIME on-chain
// — xem `handlers.ak`, KHÔNG còn trường datum) → BẤT KỲ AI spend nó, trả TOÀN BỘ tLAMP về pool
// (bảo toàn cung) VÀ đốt ACCT NFT (C-BURN-1 — thiếu bước đốt thì ACCT NFT ra khỏi script thành
// vé tái dùng vĩnh viễn). Pool đồng thời spend (PoolRedeemer::Reclaim) để nhận token; bộ đếm
// tốc độ (window_epoch/claims_in_window) BẢO TOÀN nguyên vẹn (C-RECL-1/2 — một `Reclaim` không
// được reset trần tốc độ).
//
// FLOW:
//   1. Spend account UTxO (AccountRedeemer::ReclaimIdle).
//   2. Spend POOL UTxO (PoolRedeemer::Reclaim).
//   3. Đốt ACCT NFT (FaucetNftRedeemer::BurnAccount, qty −1).
//   4. Output pool' = pool + account.tLAMP (cfg + POOL NFT + ADA + bộ đếm bảo toàn). KHÔNG có
//      output account — UTxO đó biến mất hoàn toàn khỏi tập UTxO.
//
// Validity range: `ReclaimIdle` CỐ Ý dùng `util.get_epoch` (cận DƯỚI, KHÔNG pinned) — lùi thời
// gian chỉ làm chính người thu hồi tự mình không đủ điều kiện, không ai khác thiệt (xem
// `handlers.ak`). Builder chỉ cần `validFrom`, KHÔNG cần `validTo`.

import {
  toUnit,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME, RECLAIM, acctName } from "./constants.js";
import {
  decodePoolDatum, decodeFaucetAccount, poolDatumToCbor,
  poolReclaimRedeemerToCbor, accountReclaimIdleRedeemerToCbor, burnAccountRedeemerToCbor,
} from "./datum.js";
import { epochAt } from "./epochWindow.js";
import type { PoolDatum, FaucetAccount } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface ReclaimParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (PoolDatum, POOL NFT). */
  poolUtxo: UTxO;
  faucetPoolScript: Validator;

  /** Account idle (FaucetAccount, ACCT NFT, giữ tLAMP). */
  accountUtxo: UTxO;
  faucetAccountScript: Validator;

  /** Applied faucet_nft minting policy — cần để ĐỐT ACCT NFT (C-BURN-1). */
  faucetNftPolicy: MintingPolicy;
  faucetNftPolicyId: string;

  tlampPolicyId: string;
  tlampAssetName?: string;

  /** Mốc "bây giờ" (ms Unix) — CỐ Ý cận dưới, không pinned. Xem đầu tệp. */
  nowMs: number;
  msPerEpoch: bigint;
}

export interface ReclaimResult {
  tx: TxSignBuilder;
  reclaimed: bigint;
  poolAfter: bigint;
  epoch: bigint;
  summary: string;
}

export async function buildReclaimTx(params: ReclaimParams): Promise<ReclaimResult> {
  const {
    lucid, poolUtxo, faucetPoolScript, accountUtxo, faucetAccountScript,
    faucetNftPolicy, faucetNftPolicyId, tlampPolicyId, msPerEpoch,
  } = params;

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);

  if (!poolUtxo.datum) throw new Error("RECLAIM-001: poolUtxo has no inline datum");
  if (!accountUtxo.datum) throw new Error("RECLAIM-002: accountUtxo has no inline datum");
  const pd: PoolDatum = decodePoolDatum(Data.from(poolUtxo.datum));
  const acct: FaucetAccount = decodeFaucetAccount(Data.from(accountUtxo.datum));
  const an = acctName(acct.did_name);
  const acctNftUnit = toUnit(faucetNftPolicyId, an);

  if ((accountUtxo.assets[acctNftUnit] ?? 0n) < 1n) {
    throw new Error(`RECLAIM-005: accountUtxo không mang ACCT NFT ${acctNftUnit}`);
  }

  const reclaimed = accountUtxo.assets[tlampUnit] ?? 0n;
  if (reclaimed <= 0n) throw new Error("RECLAIM-003: account không có tLAMP để thu hồi");

  // ── Cận dưới (get_epoch), CỐ Ý không pinned. Kiểm idle offchain, mirror on-chain
  // `now >= acct.last_touch_epoch + reclaim_epochs_const` — đọc mốc IDLE, KHÔNG phải cooldown.
  const epoch = epochAt(params.nowMs, Number(msPerEpoch));
  if (epoch < acct.last_touch_epoch + RECLAIM) {
    throw new Error(
      `RECLAIM-004: account chưa idle đủ. now=${epoch} < last_touch_epoch ${acct.last_touch_epoch} + reclaim ${RECLAIM}`,
    );
  }

  // pool' = pool + reclaimed tLAMP (POOL NFT + ADA + cfg bảo toàn). Địa chỉ TÁI TẠO lấy TỪ
  // CHÍNH `poolUtxo.address` — C-ACCT-POOLADDR-1/C-POOL-OUT-1 ép đúng địa chỉ input.
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  const poolAfter = poolLamp + reclaimed;
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets, [tlampUnit]: poolAfter };
  // C-RECL-1/2: bộ đếm tốc độ BẢO TOÀN nguyên vẹn — Reclaim KHÔNG được reset trần tốc độ.
  const poolDatumOut: PoolDatum = pd;

  const tx = await lucid
    .newTx()
    .collectFrom([accountUtxo], accountReclaimIdleRedeemerToCbor())
    .attach.SpendingValidator(faucetAccountScript)
    .collectFrom([poolUtxo], poolReclaimRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .mintAssets({ [acctNftUnit]: -1n }, burnAccountRedeemerToCbor())   // C-BURN-1
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(
      poolUtxo.address,
      { kind: "inline", value: poolDatumToCbor(poolDatumOut) },
      poolOutAssets,
    )
    .validFrom(params.nowMs)
    .complete();

  const summary = [
    `═══ Faucet v3 ReclaimIdle (thu hồi → pool, đốt ACCT NFT) ═══`,
    `Account DID:  ${acct.did_name} (last_touch_epoch ${acct.last_touch_epoch})`,
    `Reclaimed:    ${reclaimed / 1_000_000n} tLAMP (${reclaimed} oildrop) → pool`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oildrop`,
    `ACCT NFT:     ${acctNftUnit} — ĐỐT`,
  ].join("\n");

  return { tx, reclaimed, poolAfter, epoch, summary };
}
