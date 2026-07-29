// demo_srcl_claim.ts — RESUME bước I3 Claim của demo SRCL (I1/I2 đã on-chain).
// Dựng lại validator tất định từ GENESIS_REF (đọc từ argv) + claim epoch 0 owner=ví.
// Inline claim tx để ÉP collateral pure-ADA (tránh CollateralContainsNonADA) +
// dùng UTxO ví TƯƠI (fresh Lucid) tránh stale-input.
//
// Dùng: tsx demo_srcl_claim.ts <genesisTxHash> <genesisIdx>

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  keyHashToCredential, Constr, getAddressDetails, toUnit, Data,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { buildTree, markerName } from "../offchain/src/merkle.js";
import { decodeSrclDatum, srclDatumToCbor, claimRedeemerToCbor, burnSlotRedeemerToCbor } from "../offchain/src/datum.js";
import { POOL_NFT_NAME, END_EPOCH, MS_PER_EPOCH_MAINNET } from "../offchain/src/constants.js";
import type { SrclDatum, ClaimProof } from "../offchain/src/types.js";

const [genesisTxHash, genesisIdxStr] = process.argv.slice(2);
if (!genesisTxHash || genesisIdxStr === undefined) { console.error("dùng: tsx demo_srcl_claim.ts <genesisTxHash> <genesisIdx>"); process.exit(1); }
const genesisIdx = Number(genesisIdxStr);

const ENV_PATH = "/Users/ductiger/Projects/LAMP-launch-wt/.env";
for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
}
const NETWORK = process.env.NETWORK ?? "";
const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
if (NETWORK !== "Preview") { console.error("ABORT: NETWORK != Preview"); process.exit(1); }
if (!BLOCKFROST_KEY.startsWith("preview")) { console.error("ABORT: BLOCKFROST_KEY không phải preview"); process.exit(1); }

const LAMP_POLICY = process.env.LAMP_POLICY_ID!;
const LAMP_NAME = process.env.LAMP_ASSET_NAME!;
const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);

const lucid = await Lucid(new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", BLOCKFROST_KEY), "Preview");
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(import.meta.dirname, "../onchain/plutus.json"), "utf8"));
const get = (t: string) => bp.validators.find((v: { title: string }) => v.title === t).compiledCode;
const link = (h: string) => `https://preview.cexplorer.io/tx/${h}`;

const genesisRef = new Constr(0, [genesisTxHash, BigInt(genesisIdx)]);
const srclNftPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(get("srcl_nft.srcl_nft.mint"), [genesisRef]) };
const srclNftPolicyId = mintingPolicyToId(srclNftPolicy);
const markerScript: Validator = { type: "PlutusV3", script: applyParamsToScript(get("srcl_marker.srcl_marker.spend"), [srclNftPolicyId]) };
const markerHash = validatorToScriptHash(markerScript);
const poolScript: Validator = { type: "PlutusV3", script: applyParamsToScript(get("srcl_pool.srcl_pool.spend"), [srclNftPolicyId, LAMP_POLICY, LAMP_NAME, [pkh], 1n, markerHash]) };
const poolAddress = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(poolScript)));
const markerAddress = credentialToAddress("Preview", scriptHashToCredential(markerHash));
const poolNftUnit = toUnit(srclNftPolicyId, POOL_NFT_NAME);

console.log(`[claim] poolAddr:   ${poolAddress}`);
console.log(`[claim] markerAddr: ${markerAddress}`);
console.log(`[claim] nftPid:     ${srclNftPolicyId}`);

const MY_OILDROP = 1_000_000n;
const sName = markerName(0n, pkh);
const mySlotUnit = toUnit(srclNftPolicyId, sName);

// cây để sinh proof (giống deploy: owner ví mình 1 LAMP + pkh giả 2 LAMP).
const dummyOwner = "00112233445566778899aabbccddeeff00112233445566778899aabb";
const tree = buildTree([
  { epoch: 0n, owner: pkh, amount: MY_OILDROP },
  { epoch: 0n, owner: dummyOwner, amount: 2_000_000n },
]);
const proof = tree.proofFor(0n, pkh);
const claim: ClaimProof = { epoch: 0n, owner: pkh, amount: MY_OILDROP, proof };

const poolUtxos = await lucid.utxosAt(poolAddress);
const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n)!;
if (!poolUtxo) throw new Error("pool UTxO không thấy");
const slotUtxos = await lucid.utxosAt(markerAddress);
const slotUtxo = slotUtxos.find((u) => (u.assets[mySlotUnit] ?? 0n) === 1n)!;
if (!slotUtxo) throw new Error("slot UTxO (epoch0, ví) không thấy ở registry");

const datum: SrclDatum = decodeSrclDatum(Data.from(poolUtxo.datum!));
const poolLamp = poolUtxo.assets[lampUnit] ?? 0n;
const poolAfter = poolLamp - MY_OILDROP;
const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
if (poolAfter > 0n) poolOutAssets[lampUnit] = poolAfter; else delete poolOutAssets[lampUnit];
const datumAfter: SrclDatum = { ...datum, distributed_total: datum.distributed_total + MY_OILDROP };
const ownerAddress = credentialToAddress("Preview", keyHashToCredential(pkh));

// ÉP collateral pure-ADA + chọn input ví TƯƠI.
const walletUtxos = await lucid.wallet().getUtxos();
const pureAda = walletUtxos.filter((u) => Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0)
  .sort((a, b) => (b.assets.lovelace > a.assets.lovelace ? 1 : -1));
if (pureAda.length === 0) throw new Error("không có UTxO pure-ADA cho collateral/phí");
const collateral = pureAda[0]!;
console.log(`[claim] collateral pure-ADA: ${collateral.txHash}#${collateral.outputIndex} (${Number(collateral.assets.lovelace)/1e6} ADA)`);

const tx = await lucid.newTx()
  .collectFrom([poolUtxo], claimRedeemerToCbor(claim))
  .collectFrom([slotUtxo], Data.void())
  .attach.SpendingValidator(poolScript)
  .attach.SpendingValidator(markerScript)
  .mintAssets({ [mySlotUnit]: -1n }, burnSlotRedeemerToCbor())
  .attach.MintingPolicy(srclNftPolicy)
  .pay.ToAddressWithData(poolAddress, { kind: "inline", value: srclDatumToCbor(datumAfter) }, poolOutAssets)
  .pay.ToAddress(ownerAddress, { lovelace: 2_000_000n, [lampUnit]: MY_OILDROP })
  .collectFrom([collateral])               // ép input pure-ADA (phí + change)
  .complete({ coinSelection: true });

const signed = await tx.sign.withWallet().complete();
const h = await signed.submit();
console.log(`[I3] CLAIM submitted ${link(h)} (amount ${MY_OILDROP} oildrop → ${ownerAddress})`);
await lucid.awaitTx(h);
console.log(`[I3] confirmed`);

// verify
await new Promise((r) => setTimeout(r, 8000));
const slotAfter = await lucid.utxosAt(markerAddress);
const slotStill = slotAfter.some((u) => (u.assets[mySlotUnit] ?? 0n) > 0n);
const poolAfterUtxos = await lucid.utxosAt(poolAddress);
const pu = poolAfterUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n);
const poolLampAfter = pu ? (pu.assets[lampUnit] ?? 0n) : -1n;
console.log(`[verify] slot còn ở registry? ${slotStill} (kỳ vọng false)`);
console.log(`[verify] pool tLAMP sau claim: ${poolLampAfter} oildrop (kỳ vọng ${poolAfter})`);

const out = {
  network: "Preview", demo: "SRCL", step: "I3_claim_resume",
  hash: h, link: link(h), poolAddress, markerAddress, srclNftPolicyId,
  epoch: 0, owner: pkh, amountOildrop: MY_OILDROP.toString(),
  poolLampAfterOildrop: poolLampAfter.toString(), ownerAddress,
  slotUnit: mySlotUnit, slotBurned: !slotStill,
};
await writeFile(resolve(import.meta.dirname, "demo-srcl-claim-out.json"),
  JSON.stringify(out, null, 2) + "\n");
console.log("DONE. wrote demo-srcl-claim-out.json");
console.log(`I3 claim: ${link(h)}`);
