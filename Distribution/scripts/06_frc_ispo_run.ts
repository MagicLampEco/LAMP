// 06_frc_ispo_run.ts — FRC-ISPO 10 người THẬT trên Preview.
// Tạo 10 ClaimAccount (entitlement = phân bổ FRC-ISPO per-người) + redeem THẬT.
// Owner = ví demo cho cả 10 (ký redeem bằng 1 khoá); mỗi account mang entitlement 1 người.
// Phân bổ: pot 3000 tLAMP, 1000/epoch × 3 epoch, ∝ tADA reward đóng góp mỗi epoch (apportion Hamilton).
// Ghi tiến độ ra scratchpad/frc_run.json.

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, MS_PER_EPOCH,
  makeLucid, walletPkh, loadDeployed, reapplyValidators,
  toUnit, explorerTx, awaitTx, currentEpoch,
} from "./config.js";
import { decodeClaimAccountDatum, decodeBeaconDatum } from "../offchain/src/datum.js";
import { buildClaimTx }  from "../offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";
import { apportion } from "../ETD/offchain/src/attribution.js";
import { writeFileSync } from "node:fs";
import type { LucidEvolution, UTxO } from "@lucid-evolution/lucid";

const OUT = process.env.FRC_OUT ?? "/private/tmp/claude-501/-Users-ductiger-Projects-MAGIC/2d55a651-f59d-4be2-b35d-63c04adf0d52/scratchpad/frc_run.json";
const START = Number(process.env.FRC_START ?? "0");
const OIL = 1_000_000n;
const ada = (x: number) => BigInt(Math.round(x * 1e6));
const P = ["P1","P2","P3","P4","P5","P6","P7","P8","P9","P10"];
const EPOCHS: bigint[][] = [
  [ada(10), ada(20), ada(5),  ada(15), ada(8),  ada(12), ada(25), ada(3),  ada(18), ada(7)],
  [ada(12), ada(18), ada(6),  ada(0),  ada(10), ada(14), ada(22), ada(5),  ada(20), ada(9)],
  [ada(11), ada(0),  ada(8),  ada(15), ada(9),  ada(13), ada(24), ada(4),  ada(19), ada(8)],
];
const POT_PER_EPOCH = 1000n * OIL;
const norm = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// entitlement per người = Σ epoch apportion(1000 tLAMP, contributions)
function entitlements(): { perEpoch: bigint[][]; totals: bigint[]; gstPerEpoch: bigint[] } {
  const perEpoch: bigint[][] = [];
  const gstPerEpoch: bigint[] = [];
  const totals = new Array<bigint>(P.length).fill(0n);
  for (const contrib of EPOCHS) {
    const shares = apportion(POT_PER_EPOCH, contrib);
    perEpoch.push(shares);
    gstPerEpoch.push(contrib.reduce((s, v) => s + v, 0n));
    shares.forEach((s, i) => (totals[i]! += s));
  }
  return { perEpoch, totals, gstPerEpoch };
}

const results: any = { network: NETWORK, players: [], gstPerEpochAda: [], txs: [] };
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2));

async function findNewAccount(lucid: LucidEvolution, addr: string, owner: string, ent: bigint, txHash: string): Promise<UTxO> {
  for (let i = 0; i < 6; i++) {
    const utxos = await lucid.utxosAt(addr);
    for (const u of utxos) {
      if (u.txHash !== txHash || !u.datum) continue;
      try { const d = decodeClaimAccountDatum(Data.from(u.datum));
        if (norm(d.owner) === norm(owner) && d.entitlement === ent) return u;
      } catch {}
    }
    await sleep(10_000);
  }
  throw new Error(`không thấy account mới ent=${ent} từ tx ${txHash}`);
}

async function submit(lucid: LucidEvolution, txc: any, label: string): Promise<string> {
  const signed = await txc.sign.withWallet().complete();
  const h = await signed.submit();
  console.log(`   TX ${label}: ${h}`);
  console.log(`   ${explorerTx(h)}`);
  await awaitTx(lucid, h, label);
  await sleep(35_000);
  return h;
}

async function ensureCollateral(lucid: LucidEvolution): Promise<void> {
  const addr = await lucid.wallet().address();
  const pure = (u: UTxO) => Object.keys(u.assets).length === 1 && (u.assets["lovelace"] ?? 0n) >= 5_000_000n;
  if ((await lucid.wallet().getUtxos()).filter(pure).length >= 2) return;
  const tx = await lucid.newTx().pay.ToAddress(addr, { lovelace: 5_000_000n }).pay.ToAddress(addr, { lovelace: 5_000_000n }).complete();
  const s = await tx.sign.withWallet().complete(); const h = await s.submit();
  await awaitTx(lucid, h, "collateral"); await sleep(20_000);
}

async function main(): Promise<void> {
  const state = await loadDeployed();
  const lucid = await makeLucid();
  const owner = await walletPkh(lucid);
  const { claimScript, treasuryScript } = await reapplyValidators(state);
  const committee = state.committee.keyHashes, threshold = state.committee.threshold;
  const epoch = await currentEpoch();
  const ELAPSED = 2n;
  const startEpoch = epoch >= ELAPSED ? epoch - ELAPSED : 0n;
  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const dropNft = toUnit(state.beaconNftPolicy, DROP_ASSET_NAME);

  // D từ beacon genesis
  const beaconU0 = (await lucid.utxosAt(state.beacon.address)).find((u) => (u.assets[dropNft] ?? 0n) === 1n)!;
  const D = decodeBeaconDatum(Data.from(beaconU0.datum!)).drop_value;
  console.log(`FRC-ISPO 10 người · epoch ${epoch} · start ${startEpoch} (elapsed ${ELAPSED}) · D=${D/OIL} LAMP`);

  const { perEpoch, totals, gstPerEpoch } = entitlements();
  results.gstPerEpochAda = gstPerEpoch.map((v) => (v / 1_000_000n).toString());
  results.epoch = epoch.toString(); results.startEpoch = startEpoch.toString();
  for (let i = 0; i < P.length; i++) results.players.push({
    name: P[i], entitlementOil: totals[i]!.toString(), entitlementLamp: (totals[i]! / OIL).toString(),
    perEpochLamp: perEpoch.map((e) => (e[i]! / OIL).toString()),
    accountTx: null, redeemTx: null, redeemedOil: null,
  });
  save();

  await ensureCollateral(lucid);

  for (let i = START; i < P.length; i++) {
    const E = totals[i]!;
    const dpe = (E + (D * ELAPSED) - 1n) / (D * ELAPSED); // ceil(E/(D·elapsed)) → vested = E
    console.log(`\n[${P[i]}] E=${E/OIL} LAMP  dpe=${dpe}`);
    // CREATE
    const claim = await buildClaimTx({
      lucid, claimScript, network: NETWORK, ownerPkh: owner, amount: E,
      currentEpoch: startEpoch, dropsPerEpoch: dpe,
      committeeKeyHashes: committee, threshold, validFromMs: startEpoch * MS_PER_EPOCH,
    });
    const cTx = await submit(lucid, claim.tx, `create ${P[i]}`);
    results.players[i].accountTx = cTx; results.txs.push(cTx); save();
    const accU = await findNewAccount(lucid, state.claimAccount.address, owner, E, cTx);
    // REDEEM (re-fetch treasury mỗi vòng vì bị tiêu+tạo lại)
    const treasuryU = (await lucid.utxosAt(state.treasury.address)).find((u) => (u.assets[lampUnit] ?? 0n) > 0n)!;
    const beaconU = (await lucid.utxosAt(state.beacon.address)).find((u) => (u.assets[dropNft] ?? 0n) === 1n)!;
    const redeem = await buildRedeemTx({
      lucid, network: NETWORK, claimAccountUtxo: accU, claimScript,
      treasuryUtxo: treasuryU, treasuryScript, dropBeaconUtxo: beaconU,
      currentEpoch: epoch, validFromMs: epoch * MS_PER_EPOCH,
      lampPolicyId: state.testLamp.policyId, lampAssetName: state.testLamp.assetName,
    });
    const rTx = await submit(lucid, redeem.tx, `redeem ${P[i]}`);
    results.players[i].redeemTx = rTx; results.players[i].redeemedOil = redeem.vested.toString();
    results.txs.push(rTx); save();
    console.log(`   ✓ ${P[i]} redeemed ${redeem.vested/OIL} LAMP (E=${E/OIL})`);
  }

  results.done = true; save();
  console.log(`\n✅ Xong 10 người. GST nhận/epoch (tADA): ${results.gstPerEpochAda.join(", ")} · tổng ${gstPerEpoch.reduce((s,v)=>s+v,0n)/1_000_000n}`);
}

main().catch((e) => { results.error = String(e instanceof Error ? e.message : e); save(); console.error("❌", results.error); process.exit(1); });
