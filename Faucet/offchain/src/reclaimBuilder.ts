// reclaimBuilder — Faucet v3 ReclaimIdle: keeper thu hồi account idle về pool + ĐỐT ACCT NFT.
//
// PERMISSIONLESS: account idle ≥ reclaim_epochs_const (72 cửa sổ, hằng COMPILE-TIME on-chain
// — xem `handlers.ak`, KHÔNG còn trường datum) → BẤT KỲ AI spend nó, trả TOÀN BỘ tLAMP về pool
// (bảo toàn cung) VÀ đốt ACCT NFT (C-BURN-1 — thiếu bước đốt thì ACCT NFT ra khỏi script thành
// vé tái dùng vĩnh viễn). Pool đồng thời spend (PoolRedeemer::Reclaim) để nhận token; bộ đếm
// tốc độ (window_epoch/claims_in_window) BẢO TOÀN nguyên vẹn (C-RECL-1/2 — một `Reclaim` không
// được reset trần tốc độ).
//
// SỔ MỘT-DID-MỘT-ACCOUNT (v3.1, INV-ONE-ACCT): `Reclaim` mang bằng chứng MPF rằng khoá
// `blake2b_224(did_name)` ĐANG có trong `opened_root`, và pool output mang gốc SAU KHI XOÁ khoá đó
// (C-RECL-UNIQ-1). Xoá khoá ⇔ đốt ĐÚNG ACCT NFT của account bị thu hồi (C-RECL-BURN-1 ở pool,
// C-BURN-1 ở account) — hai vế đi cùng một tx, tách ra là sổ nói một chuyện, chuỗi nói chuyện
// khác. Sổ lệch datum ⇒ `FAUCET-LEDGER-001`, không dựng tiếp.
//
// Account RỖNG (0 tLAMP) cũng thu hồi được, khớp on-chain: đó là đường duy nhất trả khoá DID của
// một account đã rút sạch về sổ. Account rỗng KHÔNG được miễn ngưỡng idle (RECLAIM-004 vẫn áp).
//
// FLOW:
//   1. Spend account UTxO (AccountRedeemer::ReclaimIdle).
//   2. Spend POOL UTxO (PoolRedeemer::Reclaim{proof}).
//   3. Đốt ACCT NFT (FaucetNftRedeemer::BurnAccount, qty −1).
//   4. Output pool' = pool + account.tLAMP (cfg + POOL NFT + ADA + bộ đếm bảo toàn; `opened_root`
//      = gốc đã xoá khoá DID). KHÔNG có output account — UTxO đó biến mất khỏi tập UTxO.
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
import { resolveOpenedLedger, type OpenedLedger, type OpenedLedgerSource } from "./openedLedger.js";
import type { PoolDatum, FaucetAccount, MpfProof } from "./types.js";
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
  /**
   * `window_origin_ms` đã apply vào faucet_nft/faucet_pool/faucet_account (tham số CUỐI,
   * Specs/Window/CONTRACT.md v1.0): cửa sổ = `(nowMs − windowOriginMs) / msPerEpoch`. Lấy từ
   * `windowOriginMs(network)` của `@magiclamp/utils` (Preview ném lỗi, không có giá trị). Truyền
   * lệch thì nhãn cửa sổ trong datum lệch với cái validator suy ra và giao dịch bị từ chối.
   */
  windowOriginMs: bigint;

  /** Sổ `opened_root` hiện tại: `OpenedLedger` đã dựng, HOẶC danh sách account đang sống
   *  (gồm cả account sắp thu hồi) để builder tự dựng. Gốc phải khớp datum pool input. */
  openedLedger: OpenedLedgerSource;
}

export interface ReclaimResult {
  tx: TxSignBuilder;
  reclaimed: bigint;
  poolAfter: bigint;
  epoch: bigint;
  /** Datum pool output (có `opened_root` đã xoá khoá DID). */
  poolDatumOut: PoolDatum;
  /** Bằng chứng xoá đã đặt vào redeemer `Reclaim`. */
  proof: MpfProof;
  /** Sổ SAU khi tx này lên chuỗi. */
  nextLedger: OpenedLedger;
  summary: string;
}

export async function buildReclaimTx(params: ReclaimParams): Promise<ReclaimResult> {
  const {
    lucid, poolUtxo, faucetPoolScript, accountUtxo, faucetAccountScript,
    faucetNftPolicy, faucetNftPolicyId, tlampPolicyId, msPerEpoch, windowOriginMs,
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

  // Account RỖNG (0 tLAMP) vẫn thu hồi được — on-chain chỉ đòi pool nhận ≥ số tLAMP account
  // đang giữ (`handlers.ak` ▸ `ReclaimIdle`: `pool_lamp_out - pool_lamp_in >= acct_lamp`), 0 là
  // hợp lệ. Từ v3.1 đây là đường DUY NHẤT trả khoá DID của một account đã rút sạch về sổ; bản
  // trước từ chối ca này (RECLAIM-003, mã đã bỏ) nên khoá đó không bao giờ được giải phóng qua SDK.
  // Asset vắng ⇔ 0 ở đây là đúng nghĩa của Value on-chain, không phải đệm: ledger không lưu
  // lượng 0. Số âm thì không thể có trong Value ⇒ ném, không nuốt.
  const reclaimed = accountUtxo.assets[tlampUnit] ?? 0n;
  if (reclaimed < 0n) throw new Error(`RECLAIM-006: accountUtxo mang lượng tLAMP âm (${reclaimed})`);

  // ── Cận dưới (get_epoch), CỐ Ý không pinned. Kiểm idle offchain, mirror on-chain
  // `now >= acct.last_touch_epoch + reclaim_epochs_const` — đọc mốc IDLE, KHÔNG phải cooldown.
  const epoch = epochAt(params.nowMs, Number(msPerEpoch), Number(windowOriginMs));
  if (epoch < acct.last_touch_epoch + RECLAIM) {
    throw new Error(
      `RECLAIM-004: account chưa idle đủ. now=${epoch} < last_touch_epoch ${acct.last_touch_epoch} + reclaim ${RECLAIM}`,
    );
  }

  // ── C-RECL-UNIQ-1: sổ khớp datum, khoá DID đang có, sinh bằng chứng xoá ────────────
  // `did` lấy từ datum của CHÍNH account input — cùng nguồn on-chain đọc (`recl_acct.did_name`).
  const ledger = await resolveOpenedLedger(params.openedLedger, pd.opened_root);   // FAUCET-LEDGER-001
  const del = await ledger.planDelete(acct.did_name);                              // FAUCET-LEDGER-004

  // pool' = pool + reclaimed tLAMP (POOL NFT + ADA + cfg bảo toàn). Địa chỉ TÁI TẠO lấy TỪ
  // CHÍNH `poolUtxo.address` — C-ACCT-POOLADDR-1/C-POOL-OUT-1 ép đúng địa chỉ input.
  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  const poolAfter = poolLamp + reclaimed;
  // Pool rỗng + account rỗng ⇒ poolAfter = 0: KHÔNG ghi mục lượng 0 vào output (Value on-chain
  // không có mục đó, và `pool_out.value == pool_in.value + 0` so theo đúng nghĩa ấy).
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  if (poolAfter > 0n) poolOutAssets[tlampUnit] = poolAfter;
  else delete poolOutAssets[tlampUnit];
  // C-RECL-1/2: bộ đếm tốc độ BẢO TOÀN nguyên vẹn — Reclaim KHÔNG được reset trần tốc độ.
  // C-RECL-UNIQ-1: chỉ `opened_root` đổi, sang gốc đã xoá khoá.
  const poolDatumOut: PoolDatum = { ...pd, opened_root: del.rootAfter };

  const tx = await lucid
    .newTx()
    .collectFrom([accountUtxo], accountReclaimIdleRedeemerToCbor())
    .attach.SpendingValidator(faucetAccountScript)
    .collectFrom([poolUtxo], poolReclaimRedeemerToCbor(del.proof))
    .attach.SpendingValidator(faucetPoolScript)
    .mintAssets({ [acctNftUnit]: -1n }, burnAccountRedeemerToCbor())   // C-BURN-1 + C-RECL-BURN-1
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
    `opened_root:  ${del.rootBefore} → ${del.rootAfter} (${ledger.size} → ${del.next.size} DID, proof ${del.proof.length} bước)`,
  ].join("\n");

  return { tx, reclaimed, poolAfter, epoch, poolDatumOut, proof: del.proof, nextLedger: del.next, summary };
}
