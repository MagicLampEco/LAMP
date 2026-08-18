// demo_reserve_e2e.ts — LUỒNG 3 Reserve-pull e2e trên Preview (fresh genesis).
//
// Chuỗi tx:
//   G1  fresh genesis: mint thread_nft (SUPPLY NFT) + reserve_thread NFT (meter) —
//       2 one-shot trên 2 ref khác nhau, trong 1 tx; SupplyState UTxO (Tx A) tạo luôn.
//   R1  ReserveState init: gửi reserve_thread NFT + ReserveState datum → reserve_draw addr.
//   T1  custody seed: custody NFT + parked = 0 tLAMP (dưới sàn floor).
//   A1  reserve_auth mint one-shot → gửi auth NFT tới reserve_gate addr.
//   DRAW combined: reserve_gate spend (parked<floor) + reserve_draw spend (trần epoch)
//        + lamp_mint ReserveDraw (mint delta tLAMP) + custody reference → delta về custody.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, Data,
  type MintingPolicy, type Validator, type Network,
} from "@lucid-evolution/lucid";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { custodyDatumToCbor } from "../../Treasury/offchain/src/datum.js";
import type { CustodyDatum } from "../../Treasury/offchain/src/types.js";
import { reserveStateToCbor, drawRedeemerToCbor } from "../../Reserve/offchain/src/datum.js";
import { buildReserveAuthMintTx } from "../../Treasury/offchain/src/reserveAuthBuilder.js";
import { attachGateSpend } from "../../Treasury/offchain/src/reserveGateBuilder.js";

// Secret: MỘT nguồn duy nhất — $AGENT_SECRETS (/Users/ductiger/Projects/Agents/.env).
// .env trong repo con đã BỎ; không đọc, không tạo lại.
dotenv.config({
  path: process.env.AGENT_SECRETS ?? "/Users/ductiger/Projects/Agents/.env",
});

const TOKEN_NAME = "744c414d50"; // tLAMP
const SUPPLY_NAME = "535550504c59";
const RESERVE_THREAD_NAME = "524553564d4554"; // "RESVMET"
const AUTH_NAME = "5054"; // "PT" (pull-auth)
const INSTANCE_ID = "747265732d7265736576"; // "tres-resev"
const MS_PER_EPOCH = 432_000_000n;
const PROPOSAL_POLICY = "00".repeat(28);
const RESERVE_TOTAL_OILDROP = 9_630_000_000_000_000n;
const MAX_PER_EPOCH = RESERVE_TOTAL_OILDROP / 1000n;
const FLOOR_OILDROP = 1_000_000n;       // sàn 1 tLAMP; parked custody = 0 < sàn → cho kéo
const DRAW_OILDROP = 1_000_000n;        // kéo 1 tLAMP (≤ trần, ≤ pot)
const RESERVED_MIN_ADA = 2_000_000n;

const lucid = await Lucid(
  new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const gbp = JSON.parse(await readFile(resolve(process.cwd(), "../../Genesis/onchain/plutus.json"), "utf8"));
const tbp = JSON.parse(await readFile(resolve(process.cwd(), "../../Treasury/onchain/plutus.json"), "utf8"));
const rbp = JSON.parse(await readFile(resolve(process.cwd(), "../../Reserve/onchain/plutus.json"), "utf8"));
const gg = (t: string) => gbp.validators.find((v: { title: string }) => v.title === t).compiledCode;
const gt = (t: string) => tbp.validators.find((v: { title: string }) => v.title === t).compiledCode;
const gr = (t: string) => rbp.validators.find((v: { title: string }) => v.title === t).compiledCode;

const link = (h: string) => `https://preview.cexplorer.io/tx/${h}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitVisible(txHash: string, addr: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const us = await lucid.utxosAt(addr);
    if (us.some((u) => u.txHash === txHash)) return;
    await sleep(5000);
  }
  throw new Error(`tx ${txHash} chưa visible ở ${addr}`);
}
const out: Record<string, unknown> = { network: "Preview", txs: [] as unknown[] };
const rec = (o: unknown) => (out.txs as unknown[]).push(o);

// ── Pin 4 UTxO ref one-shot KHÁC NHAU upfront (thread, reserve, custody, auth) ──
// Mọi genesis_ref phải ghim TRƯỚC khi apply params (gate/draw phụ thuộc authPid,
// custodySeedPid). Ghim ngay đây để cross-param nhất quán.
const utxos0 = await lucid.wallet().getUtxos();
const sorted = [...utxos0].sort((a, b) => Number(b.assets.lovelace - a.assets.lovelace));
if (sorted.length < 4) throw new Error(`cần ≥4 UTxO ví để ghim 4 one-shot ref (có ${sorted.length}). Tách UTxO trước.`);
const seedThread = sorted[0];
const seedReserve = sorted[1];
const seedCustody = sorted[2];
const seedAuth = sorted[3];
const threadRef = new Constr(0, [seedThread.txHash, BigInt(seedThread.outputIndex)]);
const reserveRef = new Constr(0, [seedReserve.txHash, BigInt(seedReserve.outputIndex)]);
const authRef = new Constr(0, [seedAuth.txHash, BigInt(seedAuth.outputIndex)]);
console.log(`thread genesis: ${seedThread.txHash}#${seedThread.outputIndex}`);
console.log(`reserve genesis: ${seedReserve.txHash}#${seedReserve.outputIndex}`);
console.log(`custody genesis: ${seedCustody.txHash}#${seedCustody.outputIndex}`);
console.log(`auth genesis: ${seedAuth.txHash}#${seedAuth.outputIndex}`);

// ── Policies & validators ───────────────────────────────────────────────
const threadPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gg("thread_nft.thread_nft.mint"), [threadRef]) };
const threadPid = mintingPolicyToId(threadPolicy);
const reserveThreadPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gr("reserve_thread.reserve_thread.mint"), [reserveRef, RESERVE_THREAD_NAME]) };
const reserveThreadPid = mintingPolicyToId(reserveThreadPolicy);

// lamp_mint với meter = reserve_thread (THẬT, không placeholder).
const tlampPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gg("lamp_mint.lamp_mint.mint"), [threadPid, SUPPLY_NAME, TOKEN_NAME, [pkh], 1n, reserveThreadPid, RESERVE_THREAD_NAME]) };
const tlampPid = mintingPolicyToId(tlampPolicy);
const lampUnit = toUnit(tlampPid, TOKEN_NAME);

const ssScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gg("supply_state.supply_state.spend"), [tlampPid, threadPid, TOKEN_NAME]) };
const ssAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(ssScript)));
const threadUnit = toUnit(threadPid, SUPPLY_NAME);

// custody (Treasury) — reserve_dest.
const custodyScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gt("custody.custody.spend"), [PROPOSAL_POLICY, MS_PER_EPOCH]) };
const custodyHash = validatorToScriptHash(custodyScript);
const custodyAddr = credentialToAddress("Preview", scriptHashToCredential(custodyHash));

// reserve_auth (one-shot, ref ghim seedAuth) — auth NFT credential.
const authPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gt("reserve_auth.reserve_auth.mint"), [authRef, AUTH_NAME]) };
const authPid = mintingPolicyToId(authPolicy);
const authUnit = toUnit(authPid, AUTH_NAME);

// custody_seed (one-shot, ref ghim seedCustody).
const custodyRefData = new Constr(0, [seedCustody.txHash, BigInt(seedCustody.outputIndex)]);
const custodySeedPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gt("custody_seed.custody_seed.mint"), [custodyRefData, custodyHash]) };
const custodySeedPid = mintingPolicyToId(custodySeedPolicy);
const custodyNftUnit = toUnit(custodySeedPid, INSTANCE_ID);

const gateScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gt("reserve_gate.reserve_gate.spend"), [custodySeedPid, INSTANCE_ID, tlampPid, TOKEN_NAME, FLOOR_OILDROP, authPid, AUTH_NAME]) };
const gateHash = validatorToScriptHash(gateScript);
const gateAddr = credentialToAddress("Preview", scriptHashToCredential(gateHash));

// reserve_draw — giữ ReserveState (param lamp + thread + dest=custody + auth + gate hash).
const reserveDrawScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gr("reserve_draw.reserve_draw.spend"), [tlampPid, TOKEN_NAME, reserveThreadPid, RESERVE_THREAD_NAME, MS_PER_EPOCH, new Constr(0, [new Constr(1, [custodyHash]), new Constr(1, [])]), authPid, AUTH_NAME, gateHash]) };
const reserveDrawAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(reserveDrawScript)));
const reserveThreadUnit = toUnit(reserveThreadPid, RESERVE_THREAD_NAME);

console.log(`tlampPid=${tlampPid}`);
console.log(`reserveThreadPid=${reserveThreadPid}`);
console.log(`custodySeedPid=${custodySeedPid} custodyAddr=${custodyAddr}`);
console.log(`authPid=${authPid} gateAddr=${gateAddr}`);
console.log(`reserveDrawAddr=${reserveDrawAddr}`);
Object.assign(out, { tlampPid, reserveThreadPid, custodySeedPid, custodyAddr, authPid, gateAddr, reserveDrawAddr, lampUnit });

const epochNow = () => BigInt(Math.floor((Date.now() - 90_000) / Number(MS_PER_EPOCH)));

// ── G1: fresh genesis Tx A (thread NFT + SupplyState) ───────────────────
{
  const s0 = new Constr(0, [0n, 0n, 26370000000000000n, 9630000000000000n]); // dist,reserve,distCap,reserveCap
  const tx = await lucid.newTx()
    .collectFrom([seedThread])
    .mintAssets({ [threadUnit]: 1n }, Data.to(new Constr(0, [])))
    .attach.MintingPolicy(threadPolicy)
    .pay.ToContract(ssAddr, { kind: "inline", value: Data.to(s0) }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[G1] genesis SupplyState ${link(h)}`);
  rec({ step: "G1_genesis", hash: h, link: link(h) });
  await lucid.awaitTx(h); await waitVisible(h, ssAddr); await waitVisible(h, myAddr);
}

// ── R1: mint reserve_thread NFT + init ReserveState → reserve_draw addr ──
{
  const start = epochNow();
  const rState = { start_epoch: start, total_oildrop: RESERVE_TOTAL_OILDROP, drawn_oildrop: 0n, last_epoch: 0n };
  const tx = await lucid.newTx()
    .collectFrom([seedReserve])
    .mintAssets({ [reserveThreadUnit]: 1n }, Data.to(new Constr(0, [])))
    .attach.MintingPolicy(reserveThreadPolicy)
    .pay.ToContract(reserveDrawAddr, { kind: "inline", value: reserveStateToCbor(rState) }, { lovelace: RESERVED_MIN_ADA, [reserveThreadUnit]: 1n })
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[R1] ReserveState init (total=${RESERVE_TOTAL_OILDROP}) ${link(h)}`);
  rec({ step: "R1_reserve_init", hash: h, link: link(h), reserveDrawAddr, start_epoch: start.toString() });
  await lucid.awaitTx(h); await waitVisible(h, reserveDrawAddr); await waitVisible(h, myAddr);
}

// ── T1: custody seed (parked = 0 tLAMP < floor). Book custody NFT làm dòng sổ. ──
{
  const seedDatum: CustodyDatum = {
    instance_id: INSTANCE_ID,
    accepted_assets: [{ policy: tlampPid, name: TOKEN_NAME }, { policy: custodySeedPid, name: INSTANCE_ID }],
    ledger: [{ bucket_id: 9n, policy: custodySeedPid, name: INSTANCE_ID, amount: 1n }],
    cut_bps: 1000n, governance_ref: "", epoch: 0n, consumed_proposals: [],
  };
  const tx = await lucid.newTx()
    .collectFrom([seedCustody])
    .mintAssets({ [custodyNftUnit]: 1n }, Data.to(new Constr(0, [RESERVED_MIN_ADA])))
    .attach.MintingPolicy(custodySeedPolicy)
    .pay.ToAddressWithData(custodyAddr, { kind: "inline", value: custodyDatumToCbor(seedDatum) }, { lovelace: RESERVED_MIN_ADA, [custodyNftUnit]: 1n })
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[T1] custody seed (parked=0 < floor=${FLOOR_OILDROP}) ${link(h)}`);
  rec({ step: "T1_custody_seed", hash: h, link: link(h), custodyAddr });
  await lucid.awaitTx(h); await waitVisible(h, custodyAddr); await waitVisible(h, myAddr);
}

// ── A1: reserve_auth mint one-shot (ref = seedAuth) → gate addr ──────────
{
  // seedAuth có thể đã bị coin-selection tiêu ở các tx trước. Kiểm tra còn sống.
  const live = (await lucid.wallet().getUtxos()).some((u) => u.txHash === seedAuth.txHash && u.outputIndex === seedAuth.outputIndex);
  if (!live) throw new Error(`[A1] seedAuth ${seedAuth.txHash}#${seedAuth.outputIndex} đã bị tiêu (coin-selection). Cần khóa ref auth khỏi coin-selection ở các tx trước.`);
  const res = await buildReserveAuthMintTx({
    lucid, authPolicy, authPolicyId: authPid, authName: AUTH_NAME,
    genesisUtxo: seedAuth, gateAddress: gateAddr,
  });
  const h = await (await res.tx.sign.withWallet().complete()).submit();
  console.log(`[A1] reserve_auth NFT → gate ${link(h)}`);
  rec({ step: "A1_auth_mint", hash: h, link: link(h), authUnit, gateAddr });
  await lucid.awaitTx(h); await waitVisible(h, gateAddr); await waitVisible(h, myAddr);
}

// ── DRAW: combined gate + reserve_draw + lamp_mint ReserveDraw + custody ref ──
{
  const reserveUtxos = await lucid.utxosAt(reserveDrawAddr);
  const reserveUtxo = reserveUtxos.find((u) => (u.assets[reserveThreadUnit] ?? 0n) === 1n)!;
  const ssUtxos = await lucid.utxosAt(ssAddr);
  const supplyUtxo = ssUtxos.find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
  const gateUtxos = await lucid.utxosAt(gateAddr);
  const authUtxo = gateUtxos.find((u) => (u.assets[authUnit] ?? 0n) === 1n)!;
  const custodyUtxos = await lucid.utxosAt(custodyAddr);
  const custodyUtxo = custodyUtxos.find((u) => (u.assets[custodyNftUnit] ?? 0n) === 1n)!;

  // ReserveState' (drawn += delta, last_epoch = t).
  const rIn = Data.from(reserveUtxo.datum!) as Constr<Data>;
  const start = rIn.fields[0] as bigint;
  const total = rIn.fields[1] as bigint;
  const drawn = rIn.fields[2] as bigint;
  // validity range: lo & hi CÙNG epoch synthetic t; t > last_epoch.
  // CỬA SỔ HẸP quanh now (≤ horizon node ~1.5 ngày). Cả lo & hi phải floor-chia
  // ra cùng t. Đặt lo = now − 60s, hi = lo + 90s; bảo đảm cùng epoch (chừa biên).
  const lastEpoch = rIn.fields[3] as bigint;
  const loMs = Date.now() - 60_000;
  let hiMs = loMs + 90_000;
  const t = BigInt(Math.floor(loMs / Number(MS_PER_EPOCH)));
  // nếu hi rơi sang epoch sau (gần biên) → kéo hi về sát cuối epoch t.
  if (BigInt(Math.floor(hiMs / Number(MS_PER_EPOCH))) !== t) {
    hiMs = Number((t + 1n) * MS_PER_EPOCH) - 1000;
  }
  if (!(t > lastEpoch)) throw new Error(`[DRAW] t=${t} ≤ last_epoch=${lastEpoch}`);
  const rOut = { start_epoch: start, total_oildrop: total, drawn_oildrop: drawn + DRAW_OILDROP, last_epoch: t };

  // SupplyState' (reserve_minted += delta).
  const sIn = Data.from(supplyUtxo.datum!) as Constr<Data>;
  const sOut = new Constr(0, [sIn.fields[0], (sIn.fields[1] as bigint) + DRAW_OILDROP, sIn.fields[2], sIn.fields[3]]);

  // reserve_dest = custody addr → delta LAMP về custody (value thô).
  let txb = lucid.newTx()
    // reserve_draw: spend ReserveState (mang meter NFT) + recreate.
    .collectFrom([reserveUtxo], drawRedeemerToCbor())
    .attach.SpendingValidator(reserveDrawScript)
    .pay.ToContract(reserveDrawAddr, { kind: "inline", value: reserveStateToCbor(rOut) }, { lovelace: RESERVED_MIN_ADA, [reserveThreadUnit]: 1n })
    // lamp_mint ReserveDraw: mint delta tLAMP.
    .mintAssets({ [lampUnit]: DRAW_OILDROP }, Data.to(new Constr(1, [])))
    .attach.MintingPolicy(tlampPolicy)
    // SupplyState advance.
    .collectFrom([supplyUtxo], Data.to(new Constr(0, [])))
    .attach.SpendingValidator(ssScript)
    .pay.ToContract(ssAddr, { kind: "inline", value: Data.to(sOut) }, { lovelace: supplyUtxo.assets.lovelace, [threadUnit]: 1n })
    // delta LAMP → reserve_dest (custody addr) value thô.
    .pay.ToAddress(custodyAddr, { lovelace: RESERVED_MIN_ADA, [lampUnit]: DRAW_OILDROP })
    .validFrom(loMs).validTo(hiMs)
    .addSignerKey(pkh);

  // gate spend (parked<floor) + custody reference.
  txb = attachGateSpend(txb, {
    lucid, authUtxo, gateScript, gateAddress: gateAddr,
    authPolicyId: authPid, authName: AUTH_NAME,
    custodyUtxo, lampPolicyId: tlampPid, tokenName: TOKEN_NAME, floorOildrop: FLOOR_OILDROP,
  });

  const tx = await txb.complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[DRAW] Reserve→Treasury pull ${DRAW_OILDROP} oildrop (t=${t}) ${link(h)}`);
  rec({ step: "DRAW", hash: h, link: link(h), deltaOildrop: DRAW_OILDROP.toString(), epoch: t.toString(), reserveDest: custodyAddr });
  await lucid.awaitTx(h); await waitVisible(h, custodyAddr);
}

await writeFile(resolve(process.cwd(), "demo-reserve-e2e-out.json"), JSON.stringify(out, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
console.log("DONE. wrote demo-reserve-e2e-out.json");
