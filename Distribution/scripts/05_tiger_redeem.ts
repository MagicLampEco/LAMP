// Distribution/scripts/05_tiger_redeem.ts — TIGER drip kiểu B chạy THẬT trên Preview.
//
// Chạy: npx tsx 05_tiger_redeem.ts   (sau 01 → 02 → 03 deploy với DROP_VALUE_OILDROP=1)
//
// Chứng minh end-to-end rằng pot "Early TIGER Deleg 12" rút được trên validator
// claim_account ĐÃ AUDIT, với tham số kiểu B:
//   • entitlement E_i  — tính off-chain từ stake tích lũy (TIGER/offchain/src/entitlement).
//   • drops_per_epoch  — r_i = ceil(E_i / N)  (TIGER/offchain/src/dripB).
//   • D (beacon)       — 1 oildrop (DROP_VALUE_OILDROP).
//   • start_epoch      — cliff.
//   ⇒ vested(t) = min(E_i, 1·r_i·(t−cliff)) = kiểu B (xong đúng N epoch, có cliff).
//
// Flow (mỗi tx in hash + explorer + await):
//   a. Create — operator seed 1 ClaimAccount TIGER-shaped: entitlement=0 (committee
//      cấp sau), redeemed=0, start_epoch=cliff, drops_per_epoch=ceil(E/N).
//   b. Claim  — committee 2/3 ký → entitlement 0 → E_i (drops_per_epoch BẤT BIẾN).
//   c. Redeem — owner tự tính vested on-chain, nhận LAMP.
//   d. Verify — redeemed on-chain == vested off-chain (TIGER module) → BIT-IDENTITY thật.
//
// AN TOÀN: chỉ chạy khi NETWORK=Preview. Chặn cứng mainnet.

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, MS_PER_EPOCH,
  makeLucid, walletPkh, loadDeployed, reapplyValidators,
  toUnit, explorerTx, awaitTx, currentEpoch,
} from "./config.js";
import {
  decodeClaimAccountDatum, claimAccountDatumToCbor,
} from "../offchain/src/datum.js";
import { buildClaimTx }  from "../offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";
// ── TIGER module: nguồn sự thật cho entitlement + drip kiểu B ──
import { computeEntitlements } from "../../TIGER/offchain/src/entitlement.js";
import { tigerDatum, vestedAt, ceilDiv } from "../../TIGER/offchain/src/dripB.js";
import { OILDROP_PER_LAMP } from "../../TIGER/offchain/src/constants.js";
import type { SnapshotSet } from "../../TIGER/offchain/src/types.js";
import type { LucidEvolution, UTxO, TxSignBuilder } from "@lucid-evolution/lucid";

// Demo budget nhỏ để treasury (500k LAMP) chi trả được (thuật toán budget-agnostic).
const DEMO_BUDGET_OILDROP = 360n * OILDROP_PER_LAMP; // 360 LAMP chia cho delegator demo
const N_DRIP = 36n;                          // nhỏ giọt 36 epoch

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const norm = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

async function submit(
  lucid: LucidEvolution, tx: TxSignBuilder, label: string,
): Promise<string> {
  const signed = await tx.sign.withWallet().complete();
  const h = await signed.submit();
  console.log(`   TX:       ${h}`);
  console.log(`   Explorer: ${explorerTx(h)}`);
  await awaitTx(lucid, h, label);
  await sleep(20_000);
  return h;
}

async function findAccountByOwnerStart(
  lucid: LucidEvolution, address: string, ownerPkh: string, startEpoch: bigint,
): Promise<UTxO> {
  const utxos = await lucid.utxosAt(address);
  for (const u of utxos) {
    if (!u.datum) continue;
    try {
      const d = decodeClaimAccountDatum(Data.from(u.datum));
      if (norm(d.owner) === norm(ownerPkh) && d.start_epoch === startEpoch) return u;
    } catch { /* skip */ }
  }
  throw new Error(`không thấy TIGER account owner=${ownerPkh} start=${startEpoch}`);
}

async function ensureCollateral(lucid: LucidEvolution): Promise<void> {
  const addr = await lucid.wallet().address();
  const pure = (u: UTxO): boolean =>
    Object.keys(u.assets).length === 1 && (u.assets["lovelace"] ?? 0n) >= 5_000_000n;
  if ((await lucid.wallet().getUtxos()).filter(pure).length >= 2) return;
  const tx = await lucid.newTx()
    .pay.ToAddress(addr, { lovelace: 5_000_000n })
    .pay.ToAddress(addr, { lovelace: 5_000_000n })
    .complete();
  await submit(lucid, tx, "prep collateral");
}

async function main(): Promise<void> {
  console.log("=== TIGER Early Delegator — drip kiểu B redeem (Preview) ===\n");
  if (NETWORK !== "Preview") {
    throw new Error(`CHẶN: NETWORK=${NETWORK} ≠ Preview. Script này CHỈ chạy Preview.`);
  }

  const state = await loadDeployed();
  if (!state.genesis || !state.testLamp || !state.beaconNftPolicy) {
    throw new Error("deployed.json thiếu genesis/testLamp/beacon — chạy 01→02→03 (DROP_VALUE_OILDROP=1) trước.");
  }

  const lucid = await makeLucid();
  const aPkh = await walletPkh(lucid);
  const { claimScript, treasuryScript } = await reapplyValidators(state);
  const committee = state.committee.keyHashes;
  const threshold = state.committee.threshold;

  const epoch = await currentEpoch();
  const cliff = epoch - 2n; // cliff đã qua → vested > 0 ngay (demo). Thực tế: cliff = launch.
  const validFromMs = epoch * MS_PER_EPOCH;
  console.log(`Network: ${NETWORK}   epoch: ${epoch}   cliff(demo): ${cliff}\n`);

  // ── Tính entitlement TIGER từ snapshot mock (ví A là delegator chính) ──
  const B = "b0".repeat(28), C = "c0".repeat(28);
  const snaps: SnapshotSet = [
    [{ owner: aPkh, stake: 300n }, { owner: B, stake: 50n }],  // epoch -3
    [{ owner: aPkh, stake: 300n }, { owner: C, stake: 50n }],  // epoch -2 (A trung thành 2 epoch)
  ];
  const { entitlements, distributed, leftover } = computeEntitlements(snaps, {
    budgetOildrop: DEMO_BUDGET_OILDROP,
  });
  const eA = entitlements.find((e) => norm(e.owner) === norm(aPkh))!;
  const E_i = eA.amount;
  const r_i = ceilDiv(E_i, N_DRIP);
  console.log(`Entitlement A: ${E_i / OILDROP_PER_LAMP} LAMP (acc stake ${eA.accStake}), `
    + `r=ceil(E/${N_DRIP})=${r_i} oildrop/epoch`);
  console.log(`(Σ phân bổ ${distributed / OILDROP_PER_LAMP} LAMP, leftover ${leftover / OILDROP_PER_LAMP})\n`);

  const tDatum = tigerDatum(aPkh, E_i, N_DRIP, cliff); // entitlement=E_i ở off-chain ref
  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const dropNft = toUnit(state.beaconNftPolicy, DROP_ASSET_NAME);

  await ensureCollateral(lucid);

  // ── a. CREATE — seed account TIGER-shaped: entitlement=0, drops_per_epoch=r_i ──
  console.log("── a. Create TIGER ClaimAccount (entitlement=0, drops/epoch=r_i) ──");
  const seedCbor = claimAccountDatumToCbor({
    owner: aPkh, entitlement: 0n, redeemed: 0n, start_epoch: cliff, drops_per_epoch: r_i,
  });
  const createTx = await lucid.newTx()
    .pay.ToAddressWithData(state.claimAccount.address,
      { kind: "inline", value: seedCbor }, { lovelace: 2_000_000n })
    .complete();
  await submit(lucid, createTx, "create TIGER account");

  // ── b. CLAIM — committee cấp entitlement 0 → E_i ──
  console.log("\n── b. Claim (committee cấp E_i, drops/epoch bất biến) ──");
  const acc0 = await findAccountByOwnerStart(lucid, state.claimAccount.address, aPkh, cliff);
  const claimTx = await buildClaimTx({
    lucid, claimScript, network: NETWORK,
    ownerPkh: aPkh, amount: E_i, currentEpoch: epoch,
    claimAccountUtxo: acc0,
    committeeKeyHashes: committee, threshold, validFromMs,
  });
  console.log(claimTx.summary);
  await submit(lucid, claimTx.tx, "claim E_i");

  // ── c. REDEEM — owner tự tính vested(t), nhận LAMP ──
  console.log("\n── c. Redeem (owner self-compute vested kiểu B) ──");
  const acc1 = await findAccountByOwnerStart(lucid, state.claimAccount.address, aPkh, cliff);
  const d1 = decodeClaimAccountDatum(Data.from(acc1.datum!));
  const rEpoch = await currentEpoch();
  const offchainVested = vestedAt(d1, rEpoch); // dự đoán off-chain (TIGER module)
  console.log(`   off-chain vested dự đoán @epoch ${rEpoch}: ${offchainVested / OILDROP_PER_LAMP} LAMP`);

  const treasuryU = (await lucid.utxosAt(state.treasury.address))
    .find((u) => (u.assets[lampUnit] ?? 0n) >= offchainVested);
  if (!treasuryU) throw new Error("treasury thiếu LAMP cho vested");
  const dropBeacon = (await lucid.utxosAt(state.beacon.address))
    .find((u) => (u.assets[dropNft] ?? 0n) === 1n);
  if (!dropBeacon) throw new Error("không thấy DropParam beacon");
  // PREMISE kiểu B (audit HIGH): bit-identity chỉ đúng khi beacon D == 1 oildrop.
  // D ≠ 1 → vested on-chain mở nhanh gấp D lần → phá "nhỏ giọt đều N epoch".
  // BeaconDatum = Constr(0, [epoch:int, kind, drop_value:int]); D ở field index 2.
  const beaconFields = (Data.from(dropBeacon.datum!) as { fields: unknown[] }).fields;
  const onchainD = beaconFields[2] as bigint;
  if (onchainD !== 1n) {
    throw new Error(
      `CHẶN: beacon D=${onchainD} ≠ 1 → kiểu B sai. Deploy 03 với DROP_VALUE_OILDROP=1.`,
    );
  }

  const redeem = await buildRedeemTx({
    lucid, network: NETWORK,
    claimAccountUtxo: acc1, claimScript,
    treasuryUtxo: treasuryU, treasuryScript,
    dropBeaconUtxo: dropBeacon,
    currentEpoch: rEpoch, validFromMs: rEpoch * MS_PER_EPOCH,
    lampPolicyId: state.testLamp.policyId, lampAssetName: state.testLamp.assetName,
  });
  console.log(redeem.summary);
  await submit(lucid, redeem.tx, "redeem TIGER");

  // ── d. VERIFY — on-chain redeemed == off-chain vested (BIT-IDENTITY thật) ──
  console.log("\n── d. Verify (on-chain == off-chain) ──");
  const acc2 = await findAccountByOwnerStart(lucid, state.claimAccount.address, aPkh, cliff);
  const d2 = decodeClaimAccountDatum(Data.from(acc2.datum!));
  console.log(`   on-chain: entitlement=${d2.entitlement / OILDROP_PER_LAMP} redeemed=${d2.redeemed / OILDROP_PER_LAMP} LAMP`);
  console.log(`   off-chain vested: ${offchainVested / OILDROP_PER_LAMP} LAMP; redeem.amount: ${redeem.amount / OILDROP_PER_LAMP} LAMP`);

  if (d2.redeemed !== redeem.amount) {
    throw new Error(`redeemed on-chain (${d2.redeemed}) ≠ amount (${redeem.amount})`);
  }
  if (d2.redeemed !== offchainVested) {
    throw new Error(`BIT-IDENTITY FAIL: on-chain redeemed (${d2.redeemed}) ≠ off-chain vested (${offchainVested})`);
  }
  if (d2.redeemed > d2.entitlement) {
    throw new Error(`vi phạm cap: redeemed (${d2.redeemed}) > E (${d2.entitlement})`);
  }
  console.log(`\n✅ TIGER kiểu B chạy THẬT trên Preview — on-chain redeemed == off-chain vested == ${offchainVested / OILDROP_PER_LAMP} LAMP. BIT-IDENTITY xác nhận.`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
