// LampDistribution/scripts/04_e2e.ts — Full flow THẬT trên Preview (CONTRACT v2 "Capped Drop").
//
// Chạy: npm run e2e   (sau 01 → 02 → 03)
//
// Flow tất định (CONTRACT v2 §1/§4 — KHÔNG lottery/merkle/nonce):
//   a. Claim:   committee 2/3 ký → cấp entitlement E cho A (250 LAMP), B (1000 LAMP).
//   b. Beacon:  committee post DropParam{D} (drop value) cho epoch hiện tại.
//   c. Redeem:  A tự tính vested(t) on-chain → nhận LAMP đã mở khoá vào ví (permissionless).
//   d. Verify:  query lại UTxO, in redeemed (cộng dồn) + LAMP balance.
//
//   vested(t) = min(E, D · drops_per_epoch · max(0, t − start_epoch))
//   amount    = vested − redeemed   (yêu cầu > 0)
//
// Mỗi tx: in tx hash + explorer link + await confirm trước khi sang bước sau.
//
// LƯU Ý epoch: validator claim_account tính epoch từ validity_range POSIX ms.
// Lucid set validity range quanh slot hiện tại → epoch khớp currentEpoch ta tính từ tip.
// Với E (250 hoặc 1000 LAMP) và D (mặc định 100 LAMP), vested epoch đầu = min(E, D·1·0)=0
// NẾU t==start_epoch. Để A nhận được ngay trong e2e, ta cấp E ở Claim với start_epoch =
// epoch genesis (đã set ở 03), rồi redeem ở epoch ≥ start_epoch+1 (xem ghi chú redeem).

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, MS_PER_EPOCH,
  makeLucid, walletPkh, loadDeployed, reapplyValidators,
  toUnit, explorerTx, awaitTx, currentEpoch,
} from "./config.js";
import { decodeClaimAccountDatum } from "../offchain/src/datum.js";
import { buildClaimTx }      from "../offchain/src/claimBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import { buildRedeemTx }     from "../offchain/src/redeemBuilder.js";
import { D_GENESIS }         from "../offchain/src/constants.js";
import type { LucidEvolution, UTxO, TxSignBuilder } from "@lucid-evolution/lucid";

const LAMP_A = 250_000_000n;   // 250 LAMP entitlement (oildrop)
const LAMP_B = 1_000_000_000n; // 1000 LAMP entitlement (oildrop)

// DropParam D (oildrop/drop·epoch). Khớp 03 genesis (DROP_VALUE_OILDROP) nếu set; else D_GENESIS.
const DROP_VALUE = BigInt(process.env.DROP_VALUE_OILDROP ?? D_GENESIS.toString());

function norm(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

/** Tìm ClaimAccount UTxO theo owner PKH (decode datum). Re-resolve sau mỗi spend.
 *  Nhiều account cùng owner → chọn cái entitlement cao nhất (account "hoạt động"). */
async function findClaimAccount(
  lucid: LucidEvolution, address: string, ownerPkh: string,
): Promise<UTxO> {
  const utxos = await lucid.utxosAt(address);
  let best: UTxO | null = null;
  let bestEnt = -1n;
  for (const u of utxos) {
    if (!u.datum) continue;
    try {
      const d = decodeClaimAccountDatum(Data.from(u.datum));
      if (norm(d.owner) === norm(ownerPkh) && d.entitlement > bestEnt) {
        best = u; bestEnt = d.entitlement;
      }
    } catch { /* không phải ClaimAccountDatum */ }
  }
  if (best) return best;
  throw new Error(`không tìm thấy ClaimAccount cho owner ${ownerPkh} tại ${address}`);
}

/** Tìm beacon UTxO theo NFT asset. Re-resolve sau mỗi PostBeacon. */
async function findBeacon(
  lucid: LucidEvolution, address: string, nftUnit: string,
): Promise<UTxO> {
  const utxos = await lucid.utxosAt(address);
  const u = utxos.find((x) => (x.assets[nftUnit] ?? 0n) === 1n);
  if (!u) throw new Error(`không tìm thấy beacon UTxO chứa ${nftUnit}`);
  return u;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sign + submit + await + settle. Trả txHash.
 *  Sleep sau confirm để Blockfrost index UTxO mới (tránh stale input ở tx kế). */
async function submit(
  lucid: LucidEvolution, txComplete: TxSignBuilder, label: string,
): Promise<string> {
  const signed = await txComplete.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, label);
  await sleep(20_000);  // chờ provider index xong (chống TranslationLogicMissingInput)
  return txHash;
}

/** Đảm bảo ví có ≥2 UTxO ADA-thuần (≥5 tADA) làm collateral cho Plutus tx. */
async function ensureCollateral(lucid: LucidEvolution): Promise<void> {
  const addr = await lucid.wallet().address();
  const isPureAda = (u: UTxO): boolean =>
    Object.keys(u.assets).length === 1 && (u.assets["lovelace"] ?? 0n) >= 5_000_000n;
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.filter(isPureAda).length >= 2) {
    console.log("   collateral: đã có UTxO ADA-thuần ✓");
    return;
  }
  console.log("   collateral: tạo 2 UTxO ADA-thuần (5 tADA mỗi cái)…");
  const tx = await lucid.newTx()
    .pay.ToAddress(addr, { lovelace: 5_000_000n })
    .pay.ToAddress(addr, { lovelace: 5_000_000n })
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const h = await signed.submit();
  console.log(`   TX:       ${h}`);
  await awaitTx(lucid, h, "prep collateral");
  await sleep(20_000);
}

async function main(): Promise<void> {
  console.log("=== LampDistribution Step 4: E2E live flow (Capped Drop v2) ===\n");

  const state = await loadDeployed();
  if (!state.genesis || !state.wallets || !state.testLamp || !state.beaconNftPolicy) {
    throw new Error("deployed.json thiếu genesis/wallets/testLamp — chạy 01→02→03 trước.");
  }

  const lucid = await makeLucid();
  const aPkh  = await walletPkh(lucid);
  if (norm(aPkh) !== norm(state.wallets.aPkh)) {
    throw new Error(`ví hiện tại (${aPkh}) ≠ ví A genesis (${state.wallets.aPkh}). Dùng đúng ví deploy.`);
  }
  const bPkh = state.wallets.bPkh;

  const { claimScript, beaconScript, treasuryScript } = await reapplyValidators(state);
  const committee = state.committee.keyHashes;
  const threshold = state.committee.threshold;

  const epoch = await currentEpoch();
  // lower_bound POSIX ms cho validity_range → validator get_epoch khớp epoch.
  const validFromMs = epoch * MS_PER_EPOCH;
  console.log(`Network: ${NETWORK}   epoch: ${epoch}`);
  console.log(`Committee: ${committee.length} keys (threshold ${threshold}, source ${state.committee.source})`);

  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const dropNft  = toUnit(state.beaconNftPolicy, DROP_ASSET_NAME);

  // balance A trước flow
  const balBefore = (await lucid.wallet().getUtxos())
    .reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`Ví A test-LAMP trước: ${balBefore / 1_000_000n} LAMP\n`);

  // ════════════════════════════════════════════════════════════
  // a. CLAIM — committee cấp entitlement E (A 250 LAMP, B 1000 LAMP)
  // ════════════════════════════════════════════════════════════
  console.log("── a. Claim (committee cấp entitlement E) ──");

  await ensureCollateral(lucid);

  const accA0 = await findClaimAccount(lucid, state.claimAccount.address, aPkh);
  const claimA = await buildClaimTx({
    lucid, claimScript, network: NETWORK,
    ownerPkh: aPkh, amount: LAMP_A, currentEpoch: epoch,
    claimAccountUtxo: accA0,
    committeeKeyHashes: committee, threshold,
    validFromMs,
  });
  console.log(claimA.summary);
  await submit(lucid, claimA.tx, "claim A");

  // Claim B (ví placeholder) — best-effort: lỗi không chặn flow chính (A → redeem).
  try {
    const accB0 = await findClaimAccount(lucid, state.claimAccount.address, bPkh);
    const claimB = await buildClaimTx({
      lucid, claimScript, network: NETWORK,
      ownerPkh: bPkh, amount: LAMP_B, currentEpoch: epoch,
      claimAccountUtxo: accB0,
      committeeKeyHashes: committee, threshold,
      validFromMs,
    });
    console.log(claimB.summary);
    await submit(lucid, claimB.tx, "claim B");
  } catch (e) {
    console.log(`   ⚠ Claim B bỏ qua (best-effort): ${(e as Error).message.slice(0, 120)}`);
  }

  // ════════════════════════════════════════════════════════════
  // b. POST DropParam beacon — committee post D cho epoch hiện tại
  // ════════════════════════════════════════════════════════════
  console.log("\n── b. Post DropParam beacon (D) ──");

  const dropUtxo = await findBeacon(lucid, state.beacon.address, dropNft);
  const postD = await buildPostBeaconTx({
    lucid, beaconUtxo: dropUtxo, beaconScript, network: NETWORK,
    beaconNftPolicy: state.beaconNftPolicy,
    newBeacon: { epoch, kind: "DropParam", drop_value: DROP_VALUE },
    committeeKeyHashes: committee, threshold,
  });
  console.log(postD.summary);
  await submit(lucid, postD.tx, "post DropParam");

  // ════════════════════════════════════════════════════════════
  // c. REDEEM — A tự tính vested(t), nhận LAMP đã mở khoá
  // ════════════════════════════════════════════════════════════
  console.log("\n── c. Redeem (ví A — tất định, self-compute vested) ──");

  // current_epoch dùng cho redeem: phải > start_epoch để vested > 0
  // (vested = min(E, D·dpe·(t−t0))). start_epoch = epoch genesis (set ở 03).
  // Đọc start_epoch thực từ datum để tính validFrom chuẩn.
  const accA1     = await findClaimAccount(lucid, state.claimAccount.address, aPkh);
  const dA1       = decodeClaimAccountDatum(Data.from(accA1.datum!));
  const redeemEpoch = await currentEpoch();
  const redeemValidFromMs = redeemEpoch * MS_PER_EPOCH;
  if (redeemEpoch <= dA1.start_epoch) {
    console.log(
      `   ⚠ epoch hiện tại (${redeemEpoch}) ≤ start_epoch (${dA1.start_epoch}) → vested=0. ` +
      `Đợi sang epoch kế rồi chạy lại bước redeem (Preview epoch = 1 ngày).`,
    );
  }

  const treasuryU = (await lucid.utxosAt(state.treasury.address))
    .find((u) => (u.assets[lampUnit] ?? 0n) > 0n);
  if (!treasuryU) throw new Error("không tìm thấy treasury UTxO còn LAMP");
  const dropBeacon = await findBeacon(lucid, state.beacon.address, dropNft);

  const redeem = await buildRedeemTx({
    lucid, network: NETWORK,
    claimAccountUtxo: accA1, claimScript,
    treasuryUtxo: treasuryU, treasuryScript,
    dropBeaconUtxo: dropBeacon,
    currentEpoch: redeemEpoch,
    validFromMs: redeemValidFromMs,
    lampPolicyId: state.testLamp.policyId, lampAssetName: state.testLamp.assetName,
  });
  console.log(redeem.summary);
  await submit(lucid, redeem.tx, "redeem A");

  // ════════════════════════════════════════════════════════════
  // d. VERIFY on-chain (redeemed cộng dồn + LAMP balance)
  // ════════════════════════════════════════════════════════════
  console.log("\n── d. Verify on-chain ──");

  const accA2 = await findClaimAccount(lucid, state.claimAccount.address, aPkh);
  const dA    = decodeClaimAccountDatum(Data.from(accA2.datum!));
  const balAfter = (await lucid.wallet().getUtxos())
    .reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);

  console.log(`   ClaimAccount A: entitlement=${dA.entitlement / 1_000_000n} ` +
    `redeemed=${dA.redeemed / 1_000_000n} LAMP ` +
    `(start_epoch=${dA.start_epoch}, drops/epoch=${dA.drops_per_epoch})`);
  console.log(`   Vested tại redeem: ${redeem.vested / 1_000_000n} LAMP; released ${redeem.amount / 1_000_000n} LAMP`);
  console.log(`   Ví A test-LAMP: ${balBefore / 1_000_000n} → ${balAfter / 1_000_000n} LAMP ` +
    `(+${(balAfter - balBefore) / 1_000_000n})`);

  // Bất biến: redeemed cộng dồn = amount đã redeem lần này (genesis redeemed=0).
  if (dA.redeemed !== redeem.amount) {
    throw new Error(`redeemed on-chain (${dA.redeemed}) ≠ amount redeem (${redeem.amount})`);
  }
  // Bất biến: tổng nhận ≤ entitlement.
  if (dA.redeemed > dA.entitlement) {
    throw new Error(`redeemed (${dA.redeemed}) > entitlement (${dA.entitlement}) — vi phạm cap E`);
  }
  if (balAfter - balBefore !== redeem.amount) {
    console.log(`   ⚠ chênh balance (${balAfter - balBefore}) ≠ released (${redeem.amount}) ` +
      `— có thể do change UTxO/min-ADA; kiểm tra explorer.`);
  }

  console.log("\n✅ E2E hoàn tất — claim → post DropParam → redeem (vested tất định) chạy THẬT trên Preview.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
