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
import {
  requiredHashParam, requiredHexParam,
  CONSEQUENCE_METER, CONSEQUENCE_DIST_DEST, CONSEQUENCE_GENESIS_REF,
} from "./_guards.js";

const GUARD_IO = { env: process.env, warn: (m: string) => console.warn(m) };
const TEST_MINT_OILDROP = BigInt(process.env.TEST_MINT_OILDROP ?? "100000000"); // 100 tLAMP

// CỔNG GÁC apply-param GỐC RỄ — `genesis_ref` neo one-shot của `thread_nft`.
// Trước bản vá này nó là literal Preview nướng cứng
// (`689c56e0…4973#1`, deploy Preview 2026-06) và KHÔNG qua cổng nào, trong khi `threadPid`
// sinh từ nó lại là apply-param của cả `lamp_mint` lẫn `supply_state` — tức tham số ĐỘC
// HẠI NHẤT tệp này lại là tham số duy nhất không được gác. Chạy trên Preprod/Mainnet với
// literal đó thì cả ba script ra hash khác, im lặng. Nay bắt buộc truyền qua env
// (`bytes: 32` = tx-hash, khác 28 byte của policy-id/script-hash).
const genesisRefHash = requiredHashParam("GENESIS_REF_HASH", {
  ...GUARD_IO, submit: true, bytes: 32, consequence: CONSEQUENCE_GENESIS_REF,
}).value;
// Nửa còn lại của OutputReference. KHÔNG dùng `BigInt(env ?? "")`: `BigInt("")` = 0n, tức
// quên biến sẽ lặng lẽ trỏ vào output #0 của đúng tx đó — một UTxO khác, một policy khác.
const idxRaw = (process.env.GENESIS_REF_IDX ?? "").trim();
if (!/^\d+$/.test(idxRaw)) {
  throw new Error(`GENESIS_REF_IDX chưa set / không phải số nguyên ≥ 0. ${CONSEQUENCE_GENESIS_REF}`);
}
const genesisRefIdx = BigInt(idxRaw);

const lucid = await makeLucid();
const pkh = await walletPkh(lucid);
const myAddr = await lucid.wallet().address();

const genesisRef = new Constr(0, [genesisRefHash, genesisRefIdx]);
const threadPolicy: MintingPolicy = applyPolicy((await rawValidator("thread_nft.thread_nft.mint")).compiledCode, [genesisRef]);
const threadPid = policyId(threadPolicy);
// CỔNG GÁC apply-param — script này GỬI VÔ ĐIỀU KIỆN (`signed.submit()` cuối tệp, không có
// nhánh SUBMIT), nên MỌI tham số hash/hex đọc từ env đều gác ở mức submit=true: không có chế
// độ dựng-thử để nới placeholder. Trước đây chỉ DIST_DEST được gác (`ddfa2c6`), METER_* thì
// không, và `genesis_ref` (gốc rễ của cả ba script) cũng không.
const meterPid = requiredHashParam("METER_NFT_POLICY", { ...GUARD_IO, submit: true, consequence: CONSEQUENCE_METER }).value;
const meterNm = requiredHexParam("METER_NFT_NAME", { ...GUARD_IO, submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER }).value;
const distDest = requiredHashParam("DIST_DEST", { ...GUARD_IO, submit: true, consequence: CONSEQUENCE_DIST_DEST }).value; // A-DEST: hash KHO treasury
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
