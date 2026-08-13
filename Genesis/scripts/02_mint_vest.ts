// Tx B độc lập: spend SupplyState (Advance) + mint 100 tLAMP DistributionVest.
// Đọc SupplyState từ chain (Tx A đã confirm). Ép collateral pure-ADA.
import { Constr, toUnit, credentialToAddress, scriptHashToCredential, type MintingPolicy, type Validator } from "@lucid-evolution/lucid";
import {
  NETWORK, TOKEN_NAME, makeLucid, walletPkh,
  rawValidator, applyValidator, applyPolicy, scriptAddress, policyId, scriptHashOf, explorerTx,
} from "./config.js";
import { SUPPLY_NAME } from "../offchain/src/constants.js";
import {
  supplyStateToCbor, supplyStateRedeemerToCbor, mintRouteToCbor,
} from "../offchain/src/datum.js";
import { genesisSupplyState, applyMint } from "../offchain/src/supplyState.js";

const TEST_MINT_OILDROP = BigInt(process.env.TEST_MINT_OILDROP ?? "100000000"); // 100 tLAMP
const GENESIS_REF_HASH = "689c56e05a6c4cb97ea59c26f9b2bb271ca2cf6ae52ee3dba08fb9c7a9204973";
const GENESIS_REF_IDX = 1;

const lucid = await makeLucid();
const pkh = await walletPkh(lucid);
const myAddr = await lucid.wallet().address();

const genesisRef = new Constr(0, [GENESIS_REF_HASH, BigInt(GENESIS_REF_IDX)]);
const threadPolicy: MintingPolicy = applyPolicy((await rawValidator("thread_nft.thread_nft.mint")).compiledCode, [genesisRef]);
const threadPid = policyId(threadPolicy);
const meterPid = process.env.METER_NFT_POLICY ?? "00".repeat(28);
const meterNm = process.env.METER_NFT_NAME ?? "4d4554";
if (!process.env.DIST_DEST) throw new Error("DIST_DEST chưa set: A-DEST sẽ ép LAMP vào Script(00*28) KẸT vĩnh viễn. Set DIST_DEST=hash kho.");
const distDest = process.env.DIST_DEST; // A-DEST: hash KHO treasury
const distDestAddr = credentialToAddress("Preview", scriptHashToCredential(distDest));
const tlampPolicy: MintingPolicy = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
  threadPid, SUPPLY_NAME, TOKEN_NAME, [pkh], 1n, distDest, meterPid, meterNm,
]);
const tlampPid = policyId(tlampPolicy);
const ssScript: Validator = applyValidator((await rawValidator("supply_state.supply_state.spend")).compiledCode, [tlampPid, threadPid, TOKEN_NAME]);
const ssHash = scriptHashOf(ssScript);
const ssAddr = scriptAddress(ssScript);

const threadUnit = toUnit(threadPid, SUPPLY_NAME);
const tlampUnit = toUnit(tlampPid, TOKEN_NAME);

console.log(`Network=${NETWORK} tlampPid=${tlampPid} ssHash=${ssHash}`);

// Read SupplyState UTxO from chain
const atScript = await lucid.utxosAt(ssAddr);
const supplyUtxo = atScript.find((u) => (u.assets[threadUnit] ?? 0n) === 1n);
if (!supplyUtxo) throw new Error("SupplyState UTxO không thấy on-chain");
console.log(`SupplyState in: ${supplyUtxo.txHash}#${supplyUtxo.outputIndex}`);

const s0 = genesisSupplyState();
const s1 = applyMint(s0, "DistributionVest", TEST_MINT_OILDROP);
console.log(`mint Δ=${TEST_MINT_OILDROP} → dist_minted ${s1.dist_minted}`);

// pick a pure-ADA utxo as collateral
const walletUtxos = await lucid.wallet().getUtxos();
const pureAda = walletUtxos.filter(u => Object.keys(u.assets).filter(k=>k!=="lovelace").length===0);
if (pureAda.length === 0) throw new Error("không có UTxO pure-ADA cho collateral");
console.log(`collateral candidate: ${pureAda[0].txHash}#${pureAda[0].outputIndex} (${pureAda[0].assets.lovelace})`);

const tx = await lucid.newTx()
  .collectFrom([supplyUtxo], supplyStateRedeemerToCbor())
  .attach.SpendingValidator(ssScript)
  .mintAssets({ [tlampUnit]: TEST_MINT_OILDROP }, mintRouteToCbor("DistributionVest"))
  .attach.MintingPolicy(tlampPolicy)
  .pay.ToContract(ssAddr, { kind: "inline", value: supplyStateToCbor(s1) }, { lovelace: 2_000_000n, [threadUnit]: 1n })
  .pay.ToAddress(myAddr, { [tlampUnit]: TEST_MINT_OILDROP })
  .collectFrom([pureAda[0]])
  .addSignerKey(pkh)
  .complete({ coinSelection: true });

console.log(`Tx B built (eval OK). CBOR len: ${tx.toCBOR().length}`);
const signed = await tx.sign.withWallet().complete();
const h = await signed.submit();
console.log(`SUBMITTED: ${explorerTx(h)}`);
console.log(`hash: ${h}`);
await lucid.awaitTx(h);
console.log(`✅ Minted ${TEST_MINT_OILDROP} oildrop tLAMP DistributionVest`);
console.log(`tlampPolicy=${tlampPid} assetName=${TOKEN_NAME}`);
