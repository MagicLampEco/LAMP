// 03_mint_more.ts — advance live SupplyState + mint Δ tLAMP DistributionVest.
// Đọc dist_minted THẬT từ datum on-chain (KHÔNG reset genesis). Ép collateral pure-ADA.
//
// Mục đích: nạp tLAMP cho Faucet pool (drip 1001 tLAMP cần ≥ 1001 tLAMP/claim).
// MINT_OILDROP (env) — lượng mint (oildrop). Mặc định 3000 tLAMP = 3_000_000_000.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, Data,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  requiredHashParam, requiredHexParam,
  CONSEQUENCE_METER, CONSEQUENCE_DIST_DEST, CONSEQUENCE_GENESIS_REF,
} from "./_guards.js";
import { assertParamCount } from "../offchain/src/applyGate.js";

// Secret: MỘT nguồn duy nhất — $AGENT_SECRETS (/Users/ductiger/Projects/Agents/.env).
// .env trong repo con đã BỎ; không đọc, không tạo lại.
dotenv.config({
  path: process.env.AGENT_SECRETS ?? "/Users/ductiger/Projects/Agents/.env",
});

const GUARD_IO = { env: process.env, warn: (m: string) => console.warn(m) };
const MINT_OILDROP = BigInt(process.env.MINT_OILDROP ?? "3000000000"); // 3000 tLAMP
const SUPPLY_NAME = "535550504c59";
const TOKEN_NAME = "744c414d50"; // tLAMP
// genesis_ref: xem chú thích cùng chỗ ở `02_mint_vest.ts`. Trước đây là literal Preview
// nướng cứng — tham số gốc rễ nhất tệp này lại là tham số duy nhất không qua cổng gác,
// đúng thứ mà chú thích "gác submit=true cho MỌI tham số hash/policy-id" bên dưới tự nhận
// là đã làm. Nay lời đó đúng.
const genesisRefHash = requiredHashParam("GENESIS_REF_HASH", {
  ...GUARD_IO, submit: true, bytes: 32, consequence: CONSEQUENCE_GENESIS_REF,
}).value;
const idxRaw = (process.env.GENESIS_REF_IDX ?? "").trim();
if (!/^\d+$/.test(idxRaw)) {
  // `BigInt("")` = 0n ⇒ quên biến sẽ lặng lẽ trỏ vào output #0, một UTxO khác.
  throw new Error(`GENESIS_REF_IDX chưa set / không phải số nguyên ≥ 0. ${CONSEQUENCE_GENESIS_REF}`);
}
const GENESIS_REF_IDX = BigInt(idxRaw);

const lucid = await Lucid(
  new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(process.cwd(), "../onchain/plutus.json"), "utf8"));
const getV = (t: string) => bp.validators.find((v: { title: string }) => v.title === t);

// CỔNG APPLY-001 — script này TỰ đọc plutus.json thay vì đi qua `config.ts::applyPolicy`,
// nên trước bản vá này nó là đường DUY NHẤT trong Genesis đi vòng cổng gác.
// `applyParamsToScript` KHÔNG báo lỗi khi thiếu tham số: nó apply một phần rồi trả về một
// policy-id / script-hash KHÁC, im lặng. Mà 03 luôn submit thật (`signed.submit()` cuối tệp)
// ⇒ "im lặng" ở đây nghĩa là ĐÚC TOKEN DƯỚI SAI POLICY, không một dòng cảnh báo.
// Dùng chung `assertParamCount` với `config.ts` để hai đường không thể lệch luật.
function applyChecked(title: string, params: unknown[]): string {
  const v = getV(title);
  assertParamCount(title, (v.parameters ?? []).length, params.length);
  return applyParamsToScript(v.compiledCode, params as never);
}

const genesisRef = new Constr(0, [genesisRefHash, GENESIS_REF_IDX]);
const threadPolicy: MintingPolicy = { type: "PlutusV3", script: applyChecked("thread_nft.thread_nft.mint", [genesisRef]) };
const threadPid = mintingPolicyToId(threadPolicy);
// CỔNG GÁC apply-param — 03 luôn submit thật (`signed.submit()` cuối tệp), nên gác
// submit=true cho MỌI tham số hash/policy-id đọc từ env, không riêng DIST_DEST — kể cả
// `genesis_ref` ở trên (câu này từng SAI với chính tệp nó nằm trong: genesis_ref là literal
// Preview, ungated). Còn lại cố ý là literal và KHÔNG phải hash/policy-id: `SUPPLY_NAME`/
// `TOKEN_NAME` là asset-name hằng, `[pkh]`/`1n` là authority 1-of-1 self-test lấy từ ví.
//
// Trước bản vá này `meter_nft_policy` là literal `"00".repeat(28)` NƯỚNG THẲNG vào lời gọi
// applyParamsToScript — còn tệ hơn placeholder từ env: không có cách nào truyền giá trị thật
// vào mà không sửa mã. Nay đọc từ METER_NFT_POLICY và bắt buộc phải có.
//
// ⚠ ĐỪNG "SỬA" LỖI APPLY-001 BẰNG CÁCH ĐẶT METER_NFT_POLICY=00×28 VÀO .env.
// Danh sách tham số dưới đây là hình dạng 8 tham số của bản `lamp_mint` CŨ; bản ở HEAD
// khai 12 (thêm dist_cap, reserve_cap, registry_nft_*, token_tag, kho_nft_*), nên
// `applyChecked` sẽ ném APPLY-001 — đó là hành vi ĐÚNG, không phải thiếu biến môi trường.
// `.env` dùng chung ở gốc repo (`../../.env`), nên một giá trị chết nhét vào đây sẽ chảy
// thẳng sang 01/02 mà không ai thấy. Muốn 03 chạy lại thì phải cập nhật cho khớp 12 tham số.
const distDest = requiredHashParam("DIST_DEST", { ...GUARD_IO, submit: true, consequence: CONSEQUENCE_DIST_DEST }).value;
const meterPid = requiredHashParam("METER_NFT_POLICY", { ...GUARD_IO, submit: true, consequence: CONSEQUENCE_METER }).value;
const meterNm = requiredHexParam("METER_NFT_NAME", { ...GUARD_IO, submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER }).value;
const distDestAddr = credentialToAddress("Preview", scriptHashToCredential(distDest));
const tlampPolicy: MintingPolicy = { type: "PlutusV3", script: applyChecked("lamp_mint.lamp_mint.mint", [threadPid, SUPPLY_NAME, TOKEN_NAME, [pkh], 1n, distDest, meterPid, meterNm]) };
const tlampPid = mintingPolicyToId(tlampPolicy);
const ssScript: Validator = { type: "PlutusV3", script: applyChecked("supply_state.supply_state.spend", [tlampPid, threadPid, TOKEN_NAME]) };
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

const newDist = distMinted + MINT_OILDROP;
if (newDist > distCap) throw new Error(`vượt dist_cap: ${newDist} > ${distCap}`);
const newDatum = new Constr(0, [newDist, reserveMinted, distCap, reserveCap]);
console.log(`mint Δ=${MINT_OILDROP} → dist_minted ${distMinted} → ${newDist}`);

const walletUtxos = await lucid.wallet().getUtxos();
const pureAda = walletUtxos.filter((u) => Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0);
if (pureAda.length === 0) throw new Error("không có UTxO pure-ADA cho collateral");

const tx = await lucid.newTx()
  .collectFrom([supplyUtxo], Data.to(new Constr(0, [])))         // Advance
  .attach.SpendingValidator(ssScript)
  .mintAssets({ [tlampUnit]: MINT_OILDROP }, Data.to(new Constr(0, []))) // DistributionVest
  .attach.MintingPolicy(tlampPolicy)
  .pay.ToContract(ssAddr, { kind: "inline", value: Data.to(newDatum) }, { lovelace: 2_000_000n, [threadUnit]: 1n })
  .pay.ToAddress(distDestAddr, { [tlampUnit]: MINT_OILDROP })  // A-DEST: LAMP vào KHO, không về ví
  .collectFrom([pureAda[0]])
  .addSignerKey(pkh)
  .complete({ coinSelection: true });

console.log(`Tx built (eval OK). CBOR len: ${tx.toCBOR().length}`);
const signed = await tx.sign.withWallet().complete();
const h = await signed.submit();
console.log(`SUBMITTED https://preview.cexplorer.io/tx/${h}`);
console.log(`hash: ${h}`);
await lucid.awaitTx(h);
console.log(`MINTED ${MINT_OILDROP} oildrop tLAMP (${Number(MINT_OILDROP) / 1e6} tLAMP). tlampPid=${tlampPid}`);
