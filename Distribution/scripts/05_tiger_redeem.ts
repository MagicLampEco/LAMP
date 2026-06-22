// LampDistribution/scripts/05_tiger_redeem.ts — ETD (Early TIGER Delegation) redeem
// THẬT trên Preview, TÁI DÙNG claim_account/treasury/beacon đã audit (KHÔNG validator mới).
//
// Chạy: npm run tiger-redeem   (sau 01_deploy + 02_mint_test_lamp + 03_genesis)
//
// Mục tiêu (DoD T2 — DEV-DEPLOYMENT-PLAN):
//   • Account ETD-shaped: drops_per_epoch = ceil(E_i/N), start_epoch = cliff  (drip kiểu B).
//   • beacon D == 1 (PREMISE audit HIGH: bit-identity chỉ đúng khi D=1) — ASSERT trước redeem.
//   • Σ E_i + leftover == budget (12.000 nghìn LAMP) — bất biến bảo toàn oil (off-chain).
//   • on-chain redeemed == off-chain vested(t)  — verify cây cầu ETD ↔ Distribution.
//
// Flow:
//   0. Entitlement: snapshot (ví A = delegator) → computeEntitlements → E_A, kiểm bất biến.
//   a. Post beacon DropParam D=1 (committee) + ASSERT D==1.
//   b. Claim CREATE account ETD-shaped cho A (entitlement=E_A, dpe=ceil(E_A/N), start=cliff).
//   c. Redeem: A tự tính vested(t) on-chain → nhận LAMP. So redeem.vested == ETD vestedAt.
//   d. Verify on-chain: redeemed == off-chain vested; redeemed ≤ E.
//
// epoch: để A nhận được NGAY trong 1 lần chạy, đặt cliff = epoch − TIGER_CLIFF_EPOCHS_AGO
// (mặc định 1 epoch trước) → elapsed ≥ 1 ⇒ vested = ceil(E/N)·elapsed > 0.

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, MS_PER_EPOCH,
  makeLucid, walletPkh, loadDeployed, reapplyValidators,
  toUnit, explorerTx, awaitTx, currentEpoch,
} from "./config.js";
import { decodeClaimAccountDatum, decodeBeaconDatum } from "../offchain/src/datum.js";
import { buildClaimTx }      from "../offchain/src/claimBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import { buildRedeemTx }     from "../offchain/src/redeemBuilder.js";
import type { LucidEvolution, UTxO, TxSignBuilder } from "@lucid-evolution/lucid";

// ── ETD engine (off-chain) ──────────────────────────────────────────────
import { computeEntitlements } from "../ETD/offchain/src/entitlement.js";
import { tigerDatum, vestedAt as tigerVestedAt, ceilDiv } from "../ETD/offchain/src/dripB.js";
import {
  TIGER_TOTAL_OIL, DROP_VALUE_OIL, DRIP_EPOCHS_DEFAULT,
} from "../ETD/offchain/src/constants.js";
import type { SnapshotSet } from "../ETD/offchain/src/types.js";

const N = BigInt(process.env.TIGER_DRIP_EPOCHS ?? DRIP_EPOCHS_DEFAULT.toString());
const CLIFF_AGO = BigInt(process.env.TIGER_CLIFF_EPOCHS_AGO ?? "1");

function norm(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

/** Tìm ClaimAccount UTxO theo owner; nhiều account → entitlement cao nhất (account ETD). */
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

async function findBeacon(
  lucid: LucidEvolution, address: string, nftUnit: string,
): Promise<UTxO> {
  const utxos = await lucid.utxosAt(address);
  const u = utxos.find((x) => (x.assets[nftUnit] ?? 0n) === 1n);
  if (!u) throw new Error(`không tìm thấy beacon UTxO chứa ${nftUnit}`);
  return u;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function submit(
  lucid: LucidEvolution, txComplete: TxSignBuilder, label: string,
): Promise<string> {
  const signed = await txComplete.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, label);
  await sleep(20_000); // chờ provider index xong (chống TranslationLogicMissingInput)
  return txHash;
}

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

/** Snapshot demo self-contained: ví A là delegator (~20%) + 2 co-delegator giả.
 *  Production: thay bằng snapshot stake THẬT từ Blockfrost/Koios (xem ETD/README §thuật toán). */
function demoSnapshot(aPkh: string): SnapshotSet {
  const a = norm(aPkh);
  const x = "c1".repeat(28);
  const y = "c2".repeat(28);
  // 1 epoch đủ minh hoạ tỉ lệ; A 2000 / tổng 10000 = 20% budget.
  return [[
    { owner: a, stake: 2_000n },
    { owner: x, stake: 4_000n },
    { owner: y, stake: 4_000n },
  ]];
}

async function main(): Promise<void> {
  console.log("=== LampDistribution Step 5: ETD redeem (drip kiểu B trên claim_account) ===\n");

  const state = await loadDeployed();
  if (!state.genesis || !state.wallets || !state.testLamp || !state.beaconNftPolicy) {
    throw new Error("deployed.json thiếu genesis/wallets/testLamp — chạy 01→02→03 trước.");
  }

  const lucid = await makeLucid();
  const aPkh  = await walletPkh(lucid);
  if (norm(aPkh) !== norm(state.wallets.aPkh)) {
    throw new Error(`ví hiện tại (${aPkh}) ≠ ví A genesis (${state.wallets.aPkh}). Dùng đúng ví deploy.`);
  }

  const { claimScript, beaconScript, treasuryScript } = await reapplyValidators(state);
  const committee = state.committee.keyHashes;
  const threshold = state.committee.threshold;

  const epoch     = await currentEpoch();
  const cliffEpoch = epoch >= CLIFF_AGO ? epoch - CLIFF_AGO : 0n; // start_epoch = cliff (quá khứ → redeem ngay)
  const elapsed   = epoch - cliffEpoch;

  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const dropNft  = toUnit(state.beaconNftPolicy, DROP_ASSET_NAME);

  console.log(`Network: ${NETWORK}   epoch hiện tại: ${epoch}`);
  console.log(`Committee: ${committee.length} keys (threshold ${threshold}, source ${state.committee.source})`);
  console.log(`Drip:  N = ${N} epoch · cliff = ${cliffEpoch} (${CLIFF_AGO} epoch trước) · elapsed = ${elapsed}\n`);

  // ════════════════════════════════════════════════════════════
  // 0. ENTITLEMENT — snapshot → E_A; bất biến Σ E_i + leftover == budget
  // ════════════════════════════════════════════════════════════
  console.log("── 0. Entitlement (off-chain, bảo toàn oil) ──");
  const snapshots = demoSnapshot(aPkh);
  const result = computeEntitlements(snapshots); // không cap, không loại (demo)
  const sumE = result.entitlements.reduce((s, e) => s + e.amount, 0n);
  if (sumE + result.leftover !== TIGER_TOTAL_OIL) {
    throw new Error(`BẤT BIẾN GÃY: Σ E_i (${sumE}) + leftover (${result.leftover}) ≠ budget (${TIGER_TOTAL_OIL})`);
  }
  console.log(`   Σ E_i + leftover = ${sumE} + ${result.leftover} = budget ${TIGER_TOTAL_OIL} oil ✓`);

  const eA = result.entitlements.find((e) => norm(e.owner) === norm(aPkh));
  if (!eA || eA.amount <= 0n) throw new Error("ví A không có entitlement trong snapshot demo");
  const E_A = eA.amount;
  const dpe = ceilDiv(E_A, N);
  console.log(`   E_A = ${E_A / 1_000_000n} LAMP  · drops/epoch = ceil(E/N) = ${dpe / 1_000_000n} LAMP\n`);

  // ════════════════════════════════════════════════════════════
  // a. POST beacon DropParam D=1  (PREMISE: bit-identity cần D==1)
  // ════════════════════════════════════════════════════════════
  console.log("── a. Post DropParam beacon D=1 ──");
  await ensureCollateral(lucid);

  const beacon0 = await findBeacon(lucid, state.beacon.address, dropNft);
  const postD = await buildPostBeaconTx({
    lucid, beaconUtxo: beacon0, beaconScript, network: NETWORK,
    beaconNftPolicy: state.beaconNftPolicy,
    newBeacon: { epoch, kind: "DropParam", drop_value: DROP_VALUE_OIL }, // D = 1
    committeeKeyHashes: committee, threshold,
  });
  console.log(postD.summary);
  await submit(lucid, postD.tx, "post DropParam D=1");

  // ASSERT D == 1 (đọc lại beacon datum)
  const beaconNow = await findBeacon(lucid, state.beacon.address, dropNft);
  const bd = decodeBeaconDatum(Data.from(beaconNow.datum!));
  if (bd.drop_value !== DROP_VALUE_OIL || DROP_VALUE_OIL !== 1n) {
    throw new Error(`PREMISE GÃY: beacon D = ${bd.drop_value} ≠ 1 — drip kiểu B KHÔNG bit-identical. Dừng.`);
  }
  console.log(`   ✓ beacon D = ${bd.drop_value} (== 1) — drip kiểu B hợp lệ\n`);

  // ════════════════════════════════════════════════════════════
  // b. CLAIM CREATE — account ETD-shaped cho A (committee cấp E_A)
  // ════════════════════════════════════════════════════════════
  console.log("── b. Claim CREATE account ETD-shaped (start=cliff, dpe=ceil(E/N)) ──");
  const claim = await buildClaimTx({
    lucid, claimScript, network: NETWORK,
    ownerPkh: aPkh, amount: E_A,
    currentEpoch: cliffEpoch,                 // CREATE: start_epoch = cliff
    dropsPerEpoch: dpe,                        // drip kiểu B
    committeeKeyHashes: committee, threshold,
    validFromMs: cliffEpoch * MS_PER_EPOCH,    // get_epoch(lower_bound) == cliff
  });
  console.log(claim.summary);
  await submit(lucid, claim.tx, "claim ETD account");

  // ════════════════════════════════════════════════════════════
  // c. REDEEM — A tự tính vested(t); so với ETD vestedAt off-chain
  // ════════════════════════════════════════════════════════════
  console.log("\n── c. Redeem (vested tất định) ──");
  const accA = await findClaimAccount(lucid, state.claimAccount.address, aPkh);
  const dA   = decodeClaimAccountDatum(Data.from(accA.datum!));

  // ETD off-chain vestedAt cho CHÍNH datum on-chain (kiểm cây cầu trước khi tốn tx)
  const etdVested = tigerVestedAt(dA, epoch);
  if (etdVested <= 0n) {
    throw new Error(
      `vested off-chain = 0 tại epoch ${epoch} (start=${dA.start_epoch}). ` +
      `Tăng TIGER_CLIFF_EPOCHS_AGO hoặc đợi sang epoch kế (Preview epoch = 1 ngày).`,
    );
  }

  const treasuryU = (await lucid.utxosAt(state.treasury.address))
    .find((u) => (u.assets[lampUnit] ?? 0n) > 0n);
  if (!treasuryU) throw new Error("không tìm thấy treasury UTxO còn LAMP");
  const dropBeacon = await findBeacon(lucid, state.beacon.address, dropNft);

  const balBefore = (await lucid.wallet().getUtxos())
    .reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);

  const redeem = await buildRedeemTx({
    lucid, network: NETWORK,
    claimAccountUtxo: accA, claimScript,
    treasuryUtxo: treasuryU, treasuryScript,
    dropBeaconUtxo: dropBeacon,
    currentEpoch: epoch,
    validFromMs: epoch * MS_PER_EPOCH,
    lampPolicyId: state.testLamp.policyId, lampAssetName: state.testLamp.assetName,
  });
  console.log(redeem.summary);

  // CÂY CẦU ETD↔Distribution: vested builder (Distribution) == ETD vestedAt (off-chain)
  if (redeem.vested !== etdVested) {
    throw new Error(`BRIDGE GÃY: redeem.vested (${redeem.vested}) ≠ ETD vestedAt (${etdVested})`);
  }
  console.log(`   ✓ bridge: Distribution vested == ETD vestedAt = ${etdVested} oil`);
  await submit(lucid, redeem.tx, "redeem ETD");

  // ════════════════════════════════════════════════════════════
  // d. VERIFY on-chain: redeemed == off-chain vested; redeemed ≤ E
  // ════════════════════════════════════════════════════════════
  console.log("\n── d. Verify on-chain ──");
  const accA2 = await findClaimAccount(lucid, state.claimAccount.address, aPkh);
  const d2    = decodeClaimAccountDatum(Data.from(accA2.datum!));
  const balAfter = (await lucid.wallet().getUtxos())
    .reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);

  console.log(`   ETD account: E=${d2.entitlement / 1_000_000n} LAMP redeemed=${d2.redeemed / 1_000_000n} LAMP ` +
    `(start=${d2.start_epoch}, dpe=${d2.drops_per_epoch / 1_000_000n} LAMP)`);
  console.log(`   Vested(t=${epoch}): ${redeem.vested / 1_000_000n} LAMP; nhận ${redeem.amount / 1_000_000n} LAMP`);
  console.log(`   Ví A test-LAMP: ${balBefore / 1_000_000n} → ${balAfter / 1_000_000n} LAMP (+${(balAfter - balBefore) / 1_000_000n})`);

  // DoD: on-chain redeemed == off-chain vested (genesis redeemed=0 ⇒ redeemed == vested).
  if (d2.redeemed !== etdVested) {
    throw new Error(`DoD GÃY: on-chain redeemed (${d2.redeemed}) ≠ off-chain vested (${etdVested})`);
  }
  if (d2.redeemed > d2.entitlement) {
    throw new Error(`redeemed (${d2.redeemed}) > entitlement (${d2.entitlement}) — vi phạm cap E`);
  }
  console.log(`   ✓ on-chain redeemed == off-chain vested == ${etdVested} oil; redeemed ≤ E`);

  console.log("\n✅ ETD redeem hoàn tất — drip kiểu B chạy THẬT trên Preview (tái dùng claim_account đã audit).");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
