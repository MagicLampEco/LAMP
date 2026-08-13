// demo_reserve_draw_resume.ts — chỉ chạy tx DRAW cuối (G1/R1/T1/A1 đã on-chain).
// Re-derive mọi policy/address từ 4 genesis ref CỐ ĐỊNH (đã dùng ở lần deploy trước).
// Sửa lỗi PastHorizon: validity range hẹp quanh now.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, Data,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { reserveStateToCbor, drawRedeemerToCbor } from "../../Reserve/offchain/src/datum.js";
import { attachGateSpend } from "../../Treasury/offchain/src/reserveGateBuilder.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const TOKEN_NAME = "744c414d50";
const SUPPLY_NAME = "535550504c59";
const RESERVE_THREAD_NAME = "524553564d4554";
const AUTH_NAME = "5054";
const INSTANCE_ID = "747265732d7265736576";
const MS_PER_EPOCH = 432_000_000n;
const PROPOSAL_POLICY = "00".repeat(28);
const FLOOR_OILDROP = 1_000_000n;
const DRAW_OILDROP = 1_000_000n;
const RESERVED_MIN_ADA = 2_000_000n;

// 4 genesis ref CỐ ĐỊNH (từ lần deploy trước).
const threadRef = new Constr(0, ["360b3313a1f7ac59681a177757711b4b4e4533563f21ba24f2f082fbaa0970f2", 1n]);
const reserveRef = new Constr(0, ["df167c4ce1166b0d40cad175f31a72004a9022bd3a48a2e9be15f2ddb5ec3f5b", 3n]);
const custodyRefData = new Constr(0, ["facf5831e65dbecbf4c7f4f96c0940a319543d232c28d1479da21909e39d1713", 1n]);
const authRef = new Constr(0, ["864f7298039e40cae164c0c0dcb7ae36728eea170c849927ddbfca39b8738bc5", 2n]);

const lucid = await Lucid(new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!), "Preview");
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

const threadPid = mintingPolicyToId({ type: "PlutusV3", script: applyParamsToScript(gg("thread_nft.thread_nft.mint"), [threadRef]) });
const reserveThreadPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gr("reserve_thread.reserve_thread.mint"), [reserveRef, RESERVE_THREAD_NAME]) };
const reserveThreadPid = mintingPolicyToId(reserveThreadPolicy);
const tlampPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gg("lamp_mint.lamp_mint.mint"), [threadPid, SUPPLY_NAME, TOKEN_NAME, [pkh], 1n, reserveThreadPid, RESERVE_THREAD_NAME]) };
const tlampPid = mintingPolicyToId(tlampPolicy);
const lampUnit = toUnit(tlampPid, TOKEN_NAME);
const ssScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gg("supply_state.supply_state.spend"), [tlampPid, threadPid, TOKEN_NAME]) };
const ssAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(ssScript)));
const threadUnit = toUnit(threadPid, SUPPLY_NAME);

const custodyScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gt("custody.custody.spend"), [PROPOSAL_POLICY, MS_PER_EPOCH]) };
const custodyHash = validatorToScriptHash(custodyScript);
const custodyAddr = credentialToAddress("Preview", scriptHashToCredential(custodyHash));
const authPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(gt("reserve_auth.reserve_auth.mint"), [authRef, AUTH_NAME]) };
const authPid = mintingPolicyToId(authPolicy);
const authUnit = toUnit(authPid, AUTH_NAME);
const custodySeedPid = mintingPolicyToId({ type: "PlutusV3", script: applyParamsToScript(gt("custody_seed.custody_seed.mint"), [custodyRefData, custodyHash]) });
const custodyNftUnit = toUnit(custodySeedPid, INSTANCE_ID);
const gateScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gt("reserve_gate.reserve_gate.spend"), [custodySeedPid, INSTANCE_ID, tlampPid, TOKEN_NAME, FLOOR_OILDROP, authPid, AUTH_NAME]) };
const gateHash = validatorToScriptHash(gateScript);
const gateAddr = credentialToAddress("Preview", scriptHashToCredential(gateHash));
const reserveDest = new Constr(0, [new Constr(1, [custodyHash]), new Constr(1, [])]);
const reserveDrawScript: Validator = { type: "PlutusV3", script: applyParamsToScript(gr("reserve_draw.reserve_draw.spend"), [tlampPid, TOKEN_NAME, reserveThreadPid, RESERVE_THREAD_NAME, MS_PER_EPOCH, reserveDest, authPid, AUTH_NAME, gateHash]) };
const reserveDrawAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(reserveDrawScript)));
const reserveThreadUnit = toUnit(reserveThreadPid, RESERVE_THREAD_NAME);

console.log(`tlampPid=${tlampPid} reserveThreadPid=${reserveThreadPid}`);
console.log(`custodyAddr=${custodyAddr} gateAddr=${gateAddr} reserveDrawAddr=${reserveDrawAddr}`);

// Đọc UTxO on-chain.
const reserveUtxo = (await lucid.utxosAt(reserveDrawAddr)).find((u) => (u.assets[reserveThreadUnit] ?? 0n) === 1n)!;
const supplyUtxo = (await lucid.utxosAt(ssAddr)).find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
const authUtxo = (await lucid.utxosAt(gateAddr)).find((u) => (u.assets[authUnit] ?? 0n) === 1n)!;
const custodyUtxo = (await lucid.utxosAt(custodyAddr)).find((u) => (u.assets[custodyNftUnit] ?? 0n) === 1n)!;
if (!reserveUtxo || !supplyUtxo || !authUtxo || !custodyUtxo) throw new Error("thiếu 1 UTxO tiền-điều-kiện trên chain");

const rIn = Data.from(reserveUtxo.datum!) as Constr<Data>;
const start = rIn.fields[0] as bigint, total = rIn.fields[1] as bigint, drawn = rIn.fields[2] as bigint, lastEpoch = rIn.fields[3] as bigint;
const loMs = Date.now() - 60_000;
let hiMs = loMs + 90_000;
const t = BigInt(Math.floor(loMs / Number(MS_PER_EPOCH)));
if (BigInt(Math.floor(hiMs / Number(MS_PER_EPOCH))) !== t) hiMs = Number((t + 1n) * MS_PER_EPOCH) - 1000;
if (!(t > lastEpoch)) throw new Error(`t=${t} ≤ last_epoch=${lastEpoch}`);
console.log(`draw epoch t=${t} (last=${lastEpoch}) lo=${loMs} hi=${hiMs}`);
const rOut = { start_epoch: start, total_oildrop: total, drawn_oildrop: drawn + DRAW_OILDROP, last_epoch: t };
const sIn = Data.from(supplyUtxo.datum!) as Constr<Data>;
const sOut = new Constr(0, [sIn.fields[0], (sIn.fields[1] as bigint) + DRAW_OILDROP, sIn.fields[2], sIn.fields[3]]);

let txb = lucid.newTx()
  .collectFrom([reserveUtxo], drawRedeemerToCbor())
  .attach.SpendingValidator(reserveDrawScript)
  .pay.ToContract(reserveDrawAddr, { kind: "inline", value: reserveStateToCbor(rOut) }, { lovelace: RESERVED_MIN_ADA, [reserveThreadUnit]: 1n })
  .mintAssets({ [lampUnit]: DRAW_OILDROP }, Data.to(new Constr(1, [])))
  .attach.MintingPolicy(tlampPolicy)
  .collectFrom([supplyUtxo], Data.to(new Constr(0, [])))
  .attach.SpendingValidator(ssScript)
  .pay.ToContract(ssAddr, { kind: "inline", value: Data.to(sOut) }, { lovelace: supplyUtxo.assets.lovelace, [threadUnit]: 1n })
  .pay.ToAddress(custodyAddr, { lovelace: RESERVED_MIN_ADA, [lampUnit]: DRAW_OILDROP })
  .validFrom(loMs).validTo(hiMs)
  .addSignerKey(pkh);

txb = attachGateSpend(txb, {
  lucid, authUtxo, gateScript, gateAddress: gateAddr,
  authPolicyId: authPid, authName: AUTH_NAME,
  custodyUtxo, lampPolicyId: tlampPid, tokenName: TOKEN_NAME, floorOildrop: FLOOR_OILDROP,
});

const tx = await txb.complete({ coinSelection: true });
const h = await (await tx.sign.withWallet().complete()).submit();
console.log(`[DRAW] Reserve→Treasury pull ${DRAW_OILDROP} oildrop (t=${t}) ${link(h)}`);
await lucid.awaitTx(h);
await writeFile(resolve(process.cwd(), "demo-reserve-e2e-out.json"), JSON.stringify({
  network: "Preview", tlampPid, reserveThreadPid, custodyAddr, gateAddr, reserveDrawAddr,
  deploy: { G1: "b784c0953f225c864485245dd77682c7e9369064f3c8721b3abe3ecae475c1d6", R1: "09847f047e8e8e3294b54e26c8477c03b90d513fb3d6b42beff838fb29bc1a02", T1: "b3d46e1c67b4525166daf21cf556c2d0a129b408bbe38e344305ec25ef611056", A1: "afcc994051af2420715dc1140a995f3f8c139f2a2c767b57a98ae1a1fa81c307" },
  DRAW: { hash: h, link: link(h), deltaOildrop: DRAW_OILDROP.toString(), epoch: t.toString(), reserveDest: custodyAddr },
}, null, 2) + "\n");
console.log("DONE. DRAW submitted + out written.");
