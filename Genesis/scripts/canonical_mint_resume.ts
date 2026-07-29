// canonical_mint_resume.ts — RESUME bước b (DistributionVest → KHO) khi genesis (bước a)
// đã chạy nhưng mint fail. Dùng ĐÚNG outref của genesis tx (thread ss0 sạch) thay vì
// .find() (tránh vớ phải thread ô nhiễm dist_minted≠0 trên mạng đã genesis nhiều lần).
//
// Chặn coin-selection vớ marker: nạp tay [ss0, fundUtxo(ADA thuần)] → inputs chỉ 1 thread.
//
// Chạy: GENESIS_TX=<hash> NETWORK=Preview SUBMIT=true tsx canonical_mint_resume.ts
import {
  Data, Constr, fromText, toUnit, scriptFromNative, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Validator,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, makeLucid, walletPkh, applyPolicy, policyId, rawValidator, explorerTx, SUBMIT } from "./config.js";
import { supplyStateToCbor, mintRouteToCbor } from "../offchain/src/datum.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPPLY_NAME = "535550504c59", TLAMP_NAME = "744c414d50", TOKEN_TAG = "4c414d50";
const DIST_CAP = 26370000000000000n, RESERVE_CAP = 9630000000000000n;
const REG_NAME = fromText("REG"), KHO_NAME = fromText("KHO"), MET_NAME = fromText("MET");
const MS_PER_EPOCH = 432000000n, DELTA = 10_000n * 1_000_000n;

async function distCode(title: string): Promise<string> {
  const bp = JSON.parse(await readFile(resolve(__dirname, "../../Distribution/onchain/plutus.json"), "utf8"));
  const v = (bp.validators as { title: string; compiledCode: string }[]).find((x) => x.title === title);
  if (!v) throw new Error(`Distribution '${title}' not found`); return v.compiledCode;
}

async function main() {
  const genesisTx = (process.env.GENESIS_TX ?? "").trim();
  if (!genesisTx) throw new Error("thiếu GENESIS_TX=<hash bước a>");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);

  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode,
    [nPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP, nPid, REG_NAME, TOKEN_TAG, nPid, KHO_NAME, nPid, MET_NAME]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);
  const committee = [pkh], threshold = 1n;
  const claimS: Validator = { type: "PlutusV3", script: applyParamsToScript(await distCode("claim_account.claim_account.spend"), [committee, threshold, MS_PER_EPOCH, lampPid, TLAMP_NAME, nPid] as never) };
  const claimHash = validatorToScriptHash(claimS);
  const treS: Validator = { type: "PlutusV3", script: applyParamsToScript(await distCode("treasury.treasury.spend"), [claimHash, lampPid, TLAMP_NAME] as never) };
  const treHash = validatorToScriptHash(treS);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(treHash));
  const threadUnit = toUnit(nPid, SUPPLY_NAME), regUnit = toUnit(nPid, REG_NAME), khoUnit = toUnit(nPid, KHO_NAME);
  console.log(`=== RESUME mint (${NETWORK}) lampPid=${lampPid}\nKHO ${treAddr}\n`);

  // Genesis outputs: #0 SupplyState(ss0), #1 registry, #2 kho-NFT@treAddr.
  const [ss0, regU] = await lucid.utxosByOutRef([
    { txHash: genesisTx, outputIndex: 0 }, { txHash: genesisTx, outputIndex: 1 },
  ]);
  if (!ss0 || (ss0.assets[threadUnit] ?? 0n) !== 1n) throw new Error(`genesis#0 không mang thread NFT`);
  if (!regU || (regU.assets[regUnit] ?? 0n) !== 1n) throw new Error(`genesis#1 không mang reg NFT`);
  // xác nhận ss0 = dist_minted 0 (thread sạch)
  const s = Data.from(ss0.datum!) as Constr<Data>;
  if ((s.fields[0] as bigint) !== 0n) throw new Error(`ss0 dist_minted=${s.fields[0]} ≠ 0 (thread ô nhiễm, sai outref)`);
  const khoU = (await lucid.utxosAt(treAddr)).find((u) => (u.assets[khoUnit] ?? 0n) === 1n);
  if (!khoU) throw new Error(`không thấy kho-NFT tại ${treAddr}`);

  // fundUtxo: UTxO ADA THUẦN lớn nhất (không marker/tLAMP) → tránh vớ thread thứ 2.
  const all = await lucid.utxosAt(walletAddr);
  const clean = all.filter((u) => Object.keys(u.assets).every((k) => k === "lovelace"))
    .sort((a, b) => Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n)));
  if (clean.length === 0) throw new Error("không có UTxO ADA thuần làm phí");
  const fundUtxo = clean[0];
  console.log(`ss0=${genesisTx}#0  fund=${fundUtxo.txHash}#${fundUtxo.outputIndex} (${(fundUtxo.assets.lovelace ?? 0n) / 1_000_000n} tADA)\n`);

  const ss1 = supplyStateToCbor({ dist_minted: DELTA, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const treDatum = Data.to(new Constr(0, [pkh]));

  const mintTx = await lucid.newTx()
    .collectFrom([ss0, fundUtxo])
    .mintAssets({ [lampUnit]: DELTA }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ss1 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: DELTA })
    .addSigner(walletAddr)
    .complete();

  if (!SUBMIT) { console.log("ℹ️ SUBMIT=false → build OK, không gửi."); return; }
  const mh = await (await mintTx.sign.withWallet().complete()).submit();
  console.log(`✅ mint TX: ${mh}\n   ${explorerTx(mh)}`);
  await lucid.awaitTx(mh);
  const khoLamp = (await lucid.utxosAt(treAddr)).reduce((s2, u) => s2 + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   ✓ KHO giữ ${khoLamp / 1_000_000n} tLAMP (mong đợi ${DELTA / 1_000_000n})`);
  if (khoLamp < DELTA) throw new Error("A-DEST FAIL");
  const state = { network: NETWORK, nPid, lampPid, lampUnit, treHash, treAddr, claimHash, committee, threshold: Number(threshold), msPerEpoch: MS_PER_EPOCH.toString(), delta: DELTA.toString(), genesisTx, mintTx: mh, treDatum, committeeHash: pkh };
  await writeFile(resolve(__dirname, "canonical-state.preview.json"), JSON.stringify(state, null, 2) + "\n");
  console.log(`\n✅ Preview canonical mint→kho xong. State → canonical-state.preview.json`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
