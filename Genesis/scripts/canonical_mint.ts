// canonical_mint.ts — Canonical tLAMP mint→KHO(treasury.ak) trên Preprod (mô phỏng mainnet).
// Registry-gate (token_tag 4c414d50 → SinglePkh ví) + A-DEST ép tLAMP vào treasury.ak (kho vesting).
// Output kho KÈM TreasuryDatum để bước redeem (Distribution) nhả được. Ghi state ra canonical-state.json.
import {
  Data, Constr, fromText, toUnit, scriptFromNative, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Validator,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, makeLucid, walletPkh, applyPolicy, policyId, rawValidator, explorerTx } from "./config.js";
import { supplyStateToCbor, mintRouteToCbor } from "../offchain/src/datum.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPPLY_NAME = "535550504c59";
const TLAMP_NAME  = "744c414d50";                // tLAMP
const TOKEN_TAG   = "4c414d50";                  // token_tag (đã chốt)
const DIST_CAP    = 26370000000000000n;
const RESERVE_CAP = 9630000000000000n;
const REG_NAME = fromText("REG");
const KHO_NAME = fromText("KHO");
const MET_NAME = fromText("MET");
const MS_PER_EPOCH = 432000000n;
const DELTA = 10_000n * 1_000_000n;              // 10k tLAMP mint vào kho

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function distCode(title: string): Promise<string> {
  const bp = JSON.parse(await readFile(resolve(__dirname, "../../Distribution/onchain/plutus.json"), "utf8"));
  const v = (bp.validators as { title: string; compiledCode: string }[]).find((x) => x.title === title);
  if (!v) throw new Error(`Distribution '${title}' not found`);
  return v.compiledCode;
}

async function main() {
  if (NETWORK !== "Preprod" && NETWORK !== "Preview") throw new Error(`CHẶN mạng: ${NETWORK}`);
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  console.log(`=== Canonical mint→kho (${NETWORK}) === pkh=${pkh}\n`);

  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);

  // lamp_mint 12-param → lamp_policy
  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    nPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP,
    nPid, REG_NAME, TOKEN_TAG, nPid, KHO_NAME, nPid, MET_NAME,
  ]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);

  // Distribution: claim_account → treasury(kho) — chia sẻ lampPid
  const committee = [pkh]; const threshold = 1n;
  const claimS: Validator = { type: "PlutusV3", script: applyParamsToScript(await distCode("claim_account.claim_account.spend"), [committee, threshold, MS_PER_EPOCH, lampPid, TLAMP_NAME, nPid] as never) };
  const claimHash = validatorToScriptHash(claimS);
  const treS: Validator = { type: "PlutusV3", script: applyParamsToScript(await distCode("treasury.treasury.spend"), [claimHash, lampPid, TLAMP_NAME] as never) };
  const treHash = validatorToScriptHash(treS);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(treHash));
  console.log(`lamp_policy: ${lampPid}\nKHO(treasury) addr: ${treAddr}\n`);

  const threadUnit = toUnit(nPid, SUPPLY_NAME);
  const regUnit = toUnit(nPid, REG_NAME);
  const khoUnit = toUnit(nPid, KHO_NAME);

  const ss0 = supplyStateToCbor({ dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const ss1 = supplyStateToCbor({ dist_minted: DELTA, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  // RegistryDatum Constr0[gov_did, [Entry Constr0[tag, Authority SinglePkh Constr0[pkh]]]]
  const regDatum = Data.to(new Constr(0, [fromText("did:phoenix:org:magiclamp"), [new Constr(0, [TOKEN_TAG, new Constr(0, [pkh])])]]));
  // TreasuryDatum Constr0[committee_hash]  (committee_hash = pkh, MVP self-committee)
  const treDatum = Data.to(new Constr(0, [pkh]));

  // ── Tx a: genesis — mint 3 marker + SupplyState/registry ở ví, kho-NFT tại treasury ──
  console.log("── a. genesis (markers + SupplyState + registry + kho-NFT@treasury) ──");
  const genTx = await lucid.newTx()
    .mintAssets({ [threadUnit]: 1n, [regUnit]: 1n, [khoUnit]: 1n })
    .attach.MintingPolicy(native)
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ss0 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: regDatum }, { lovelace: 2_000_000n, [regUnit]: 1n })
    .pay.ToAddress(treAddr, { lovelace: 2_000_000n, [khoUnit]: 1n })   // kho-NFT tại treasury (ref marker, no datum)
    .complete();
  const gh = await (await genTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${gh}\n   ${explorerTx(gh)}`); await lucid.awaitTx(gh); await sleep(20_000);

  const atWallet = await lucid.utxosAt(walletAddr);
  const ssU = atWallet.find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
  const regU = atWallet.find((u) => (u.assets[regUnit] ?? 0n) === 1n)!;
  const khoU = (await lucid.utxosAt(treAddr)).find((u) => (u.assets[khoUnit] ?? 0n) === 1n)!;
  if (!ssU || !regU || !khoU) throw new Error("không resolve genesis UTxO");

  // ── Tx b: mint DistributionVest → tLAMP vào kho (treasury) KÈM TreasuryDatum ──
  console.log("\n── b. mint DistributionVest → KHO ──");
  const mintTx = await lucid.newTx()
    .collectFrom([ssU])
    .mintAssets({ [lampUnit]: DELTA }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ss1 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: DELTA })
    .addSigner(walletAddr)
    .complete();
  const mh = await (await mintTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${mh}\n   ${explorerTx(mh)}`); await lucid.awaitTx(mh); await sleep(20_000);

  const khoLamp = (await lucid.utxosAt(treAddr)).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   ✓ KHO giữ ${khoLamp / 1_000_000n} tLAMP (mong đợi ${DELTA / 1_000_000n})`);
  if (khoLamp < DELTA) throw new Error("A-DEST FAIL: tLAMP không vào kho");

  const state = { network: NETWORK, nPid, lampPid, lampUnit, treHash, treAddr, claimHash, committee, threshold: Number(threshold), msPerEpoch: MS_PER_EPOCH.toString(), delta: DELTA.toString(), genesisTx: gh, mintTx: mh, treDatum, committeeHash: pkh };
  await writeFile(resolve(__dirname, "canonical-state.json"), JSON.stringify(state, null, 2) + "\n");
  console.log(`\n✅ Canonical mint→kho xong. State → canonical-state.json`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
