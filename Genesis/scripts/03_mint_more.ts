// 03_mint_more.ts — advance live SupplyState + mint Δ tLAMP DistributionVest.
// Đọc dist_minted THẬT từ datum on-chain (KHÔNG reset genesis). Ép collateral pure-ADA.
//
// Mục đích: nạp tLAMP cho Faucet pool (drip 1001 tLAMP cần ≥ 1001 tLAMP/claim).
// MINT_OIL (env) — lượng mint (oil). Mặc định 3000 tLAMP = 3_000_000_000.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, Data,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const MINT_OIL = BigInt(process.env.MINT_OIL ?? "3000000000"); // 3000 tLAMP
const SUPPLY_NAME = "535550504c59";
const TOKEN_NAME = "744c414d50"; // tLAMP
const GENESIS_REF_HASH = "689c56e05a6c4cb97ea59c26f9b2bb271ca2cf6ae52ee3dba08fb9c7a9204973";
const GENESIS_REF_IDX = 1n;

const lucid = await Lucid(
  new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(process.cwd(), "../onchain/plutus.json"), "utf8"));
const get = (t: string) => bp.validators.find((v: { title: string }) => v.title === t).compiledCode;

const genesisRef = new Constr(0, [GENESIS_REF_HASH, GENESIS_REF_IDX]);
const threadPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(get("thread_nft.thread_nft.mint"), [genesisRef]) };
const threadPid = mintingPolicyToId(threadPolicy);
const distDest = process.env.DIST_DEST ?? "00".repeat(28); // A-DEST: hash KHO treasury; deploy thật PHẢI điền
const tlampPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(get("lamp_mint.lamp_mint.mint"), [threadPid, SUPPLY_NAME, TOKEN_NAME, [pkh], 1n, distDest, "00".repeat(28), "4d4554"]) };
const tlampPid = mintingPolicyToId(tlampPolicy);
const ssScript: Validator = { type: "PlutusV3", script: applyParamsToScript(get("supply_state.supply_state.spend"), [tlampPid, threadPid, TOKEN_NAME]) };
const ssAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(ssScript)));

const threadUnit = toUnit(threadPid, SUPPLY_NAME);
const tlampUnit = toUnit(tlampPid, TOKEN_NAME);

console.log(`tlampPid=${tlampPid}`);
console.log(`tlampUnit=${tlampUnit}`);

const at = await lucid.utxosAt(ssAddr);
const supplyUtxo = at.find((u) => (u.assets[threadUnit] ?? 0n) === 1n);
if (!supplyUtxo) throw new Error("SupplyState UTxO không thấy on-chain");

// Đọc datum THẬT (dist_minted hiện tại).
const d = Data.from(supplyUtxo.datum!) as Constr<Data>;
const distMinted = d.fields[0] as bigint;
const reserveMinted = d.fields[1] as bigint;
const distCap = d.fields[2] as bigint;
const reserveCap = d.fields[3] as bigint;
console.log(`SupplyState in: ${supplyUtxo.txHash}#${supplyUtxo.outputIndex} dist_minted=${distMinted}`);

const newDist = distMinted + MINT_OIL;
if (newDist > distCap) throw new Error(`vượt dist_cap: ${newDist} > ${distCap}`);
const newDatum = new Constr(0, [newDist, reserveMinted, distCap, reserveCap]);
console.log(`mint Δ=${MINT_OIL} → dist_minted ${distMinted} → ${newDist}`);

const walletUtxos = await lucid.wallet().getUtxos();
const pureAda = walletUtxos.filter((u) => Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0);
if (pureAda.length === 0) throw new Error("không có UTxO pure-ADA cho collateral");

const tx = await lucid.newTx()
  .collectFrom([supplyUtxo], Data.to(new Constr(0, [])))         // Advance
  .attach.SpendingValidator(ssScript)
  .mintAssets({ [tlampUnit]: MINT_OIL }, Data.to(new Constr(0, []))) // DistributionVest
  .attach.MintingPolicy(tlampPolicy)
  .pay.ToContract(ssAddr, { kind: "inline", value: Data.to(newDatum) }, { lovelace: 2_000_000n, [threadUnit]: 1n })
  .pay.ToAddress(myAddr, { [tlampUnit]: MINT_OIL })
  .collectFrom([pureAda[0]])
  .addSignerKey(pkh)
  .complete({ coinSelection: true });

console.log(`Tx built (eval OK). CBOR len: ${tx.toCBOR().length}`);
const signed = await tx.sign.withWallet().complete();
const h = await signed.submit();
console.log(`SUBMITTED https://preview.cexplorer.io/tx/${h}`);
console.log(`hash: ${h}`);
await lucid.awaitTx(h);
console.log(`MINTED ${MINT_OIL} oil tLAMP (${Number(MINT_OIL) / 1e6} tLAMP). tlampPid=${tlampPid}`);
