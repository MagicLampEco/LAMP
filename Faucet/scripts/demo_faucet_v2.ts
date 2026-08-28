// demo_faucet_v2.ts — LUỒNG 1 Faucet V2 (DID-gated) trên Preview.
//
// Các tx:
//   T0  mint DID test NFT (native sig-policy) → ví (chứng minh DID cho claim/use).
//   T1  deploy pool: mint POOL NFT one-shot (faucet_nft MintPool) + seed pool UTxO
//       với tLAMP (lamp_policy/lamp_name) + FaucetConfig{drip,cooldown,reclaim}.
//   T2  claim: spend pool (Claim) + mint ACCT NFT (MintAccount) + drip 1001 tLAMP →
//       account UTxO {did_name, last_epoch=now}; mang DID NFT vào tx.
//   T3  use: spend account (Use) + mang DID NFT → cập last_epoch=now.
//
// tLAMP dùng: policy b1474a77... name 744c414d50 (genesis DistributionVest, đã mint thêm).

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, fromText, Data, scriptFromNative,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import {
  faucetConfigToCbor, faucetAccountToCbor,
  poolClaimRedeemerToCbor, mintPoolRedeemerToCbor, mintAccountRedeemerToCbor,
  accountUseRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  DRIP_OILDROP, COOLDOWN, RECLAIM, POOL_NFT_NAME, ACCT_NFT_NAME,
  msPerEpoch, assertMsPerEpochMatchesNetwork,
} from "../offchain/src/constants.js";

// Secret: MỘT nguồn duy nhất — $AGENT_SECRETS (/Users/ductiger/Projects/Agents/.env).
// .env trong repo con đã BỎ; không đọc, không tạo lại.
dotenv.config({
  path: process.env.AGENT_SECRETS ?? "/Users/ductiger/Projects/Agents/.env",
});

// tLAMP genesis DistributionVest.
const LAMP_POLICY = "b1474a77c8867762efda418adda90ecf7bb5ca35b0be13a7bfbf0ebd";
const LAMP_NAME = "744c414d50";
const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);

const POOL_SEED_OILDROP = BigInt(process.env.POOL_SEED_OILDROP ?? "2500000000"); // 2500 tLAMP
// ms/epoch lấy theo mạng đích, KHÔNG hardcode: số này vừa nướng vào script hash
// (poolParams) vừa quyết last_epoch trong datum. Assert = tripwire cho lần ai đó
// hardcode lại 432_000_000 (số của Preprod/Mainnet, lệch 5× trên Preview).
const NETWORK = "Preview" as const;
const MS_PER_EPOCH = msPerEpoch(NETWORK);
assertMsPerEpochMatchesNetwork(MS_PER_EPOCH, NETWORK);

const lucid = await Lucid(
  new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(process.cwd(), "../onchain/plutus.json"), "utf8"));
const get = (t: string) => bp.validators.find((v: { title: string }) => v.title === t).compiledCode;

const link = (h: string) => `https://preview.cexplorer.io/tx/${h}`;
const out: Record<string, unknown> = { network: "Preview", txs: [] as unknown[] };
const rec = (o: unknown) => (out.txs as unknown[]).push(o);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chờ Blockfrost index xong outputs của tx (UTxO của txHash xuất hiện ở 1 địa chỉ). */
async function waitVisible(txHash: string, addr: string, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const us = await lucid.utxosAt(addr);
    if (us.some((u) => u.txHash === txHash)) return;
    await sleep(5000);
  }
  throw new Error(`tx ${txHash} chưa visible ở ${addr} sau ${tries} lần thử`);
}

// ─────────────────────────────────────────────────────────────────────────
// T0 — mint DID test NFT (native sig-policy keyed bởi ví). asset name = "DIDalice".
// ─────────────────────────────────────────────────────────────────────────
const didPolicyScript = scriptFromNative({ type: "sig", keyHash: pkh });
const didPolicyId = validatorToScriptHash(didPolicyScript);
const DID_NAME = fromText("DIDalice");           // hex của "DIDalice"
const didUnit = toUnit(didPolicyId, DID_NAME);
console.log(`[T0] DID policy=${didPolicyId} name=${DID_NAME} unit=${didUnit}`);

{
  const have = (await lucid.wallet().getUtxos()).some((u) => (u.assets[didUnit] ?? 0n) >= 1n);
  if (have) {
    console.log(`[T0] DID NFT đã có sẵn trong ví — bỏ qua mint.`);
    rec({ step: "T0_mint_did_nft", reused: true, didPolicyId, didName: DID_NAME, didUnit });
  } else {
    const tx = await lucid.newTx()
      .mintAssets({ [didUnit]: 1n })
      .attach.MintingPolicy(didPolicyScript)
      .pay.ToAddress(myAddr, { [didUnit]: 1n, lovelace: 2_000_000n })
      .addSignerKey(pkh)
      .complete();
    const h = await (await tx.sign.withWallet().complete()).submit();
    console.log(`[T0] DID NFT minted ${link(h)}`);
    rec({ step: "T0_mint_did_nft", hash: h, link: link(h), didPolicyId, didName: DID_NAME, didUnit });
    await lucid.awaitTx(h);
    await waitVisible(h, myAddr);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Apply validators (genesis_ref = UTxO ví → one-shot POOL NFT).
// ─────────────────────────────────────────────────────────────────────────
const utxos0 = await lucid.wallet().getUtxos();
const genesis = utxos0.reduce((a, b) => (b.assets.lovelace > a.assets.lovelace ? b : a));
const genesisRef = new Constr(0, [genesis.txHash, BigInt(genesis.outputIndex)]);
console.log(`[deploy] genesis ref: ${genesis.txHash}#${genesis.outputIndex}`);

const faucetNftPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(get("faucet_nft.faucet_nft.mint"), [genesisRef]) };
const faucetNftPid = mintingPolicyToId(faucetNftPolicy);

const poolParams = [faucetNftPid, didPolicyId, LAMP_POLICY, LAMP_NAME, MS_PER_EPOCH];
const faucetPoolScript: Validator = { type: "PlutusV3", script: applyParamsToScript(get("faucet_pool.faucet_pool.spend"), poolParams) };
const faucetAccountScript: Validator = { type: "PlutusV3", script: applyParamsToScript(get("faucet_account.faucet_account.spend"), poolParams) };

const poolAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(faucetPoolScript)));
const accountAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(faucetAccountScript)));
const poolNftUnit = toUnit(faucetNftPid, POOL_NFT_NAME);
const acctNftUnit = toUnit(faucetNftPid, ACCT_NFT_NAME);

console.log(`[deploy] faucetNftPid=${faucetNftPid}`);
console.log(`[deploy] poolAddr=${poolAddr}`);
console.log(`[deploy] accountAddr=${accountAddr}`);
Object.assign(out, { faucetNftPid, didPolicyId, didName: DID_NAME, poolAddr, accountAddr, lampUnit });

// ─────────────────────────────────────────────────────────────────────────
// T1 — deploy pool: mint POOL NFT one-shot + seed tLAMP + FaucetConfig.
// ─────────────────────────────────────────────────────────────────────────
const cfg = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, reclaim_epochs: RECLAIM };
{
  const tx = await lucid.newTx()
    .collectFrom([genesis])                                  // consume genesis (one-shot)
    .mintAssets({ [poolNftUnit]: 1n }, mintPoolRedeemerToCbor())
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(
      poolAddr,
      { kind: "inline", value: faucetConfigToCbor(cfg) },
      { lovelace: 5_000_000n, [poolNftUnit]: 1n, [lampUnit]: POOL_SEED_OILDROP },
    )
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[T1] pool deployed (POOL NFT + ${Number(POOL_SEED_OILDROP) / 1e6} tLAMP) ${link(h)}`);
  rec({ step: "T1_deploy_pool", hash: h, link: link(h), poolAddr, poolNftUnit, seedOildrop: POOL_SEED_OILDROP.toString() });
  await lucid.awaitTx(h);
  await waitVisible(h, poolAddr);
  await waitVisible(h, myAddr);
}

// ─────────────────────────────────────────────────────────────────────────
// T2 — claim: spend pool (Claim) + mint ACCT NFT + drip → account; mang DID NFT.
// ─────────────────────────────────────────────────────────────────────────
function epochOf(ms: number): bigint { return BigInt(Math.floor(ms / Number(MS_PER_EPOCH))); }

let accountRef: { txHash: string; outputIndex: number };
{
  const poolUtxos = await lucid.utxosAt(poolAddr);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n)!;
  const didUtxos = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[didUnit] ?? 0n) >= 1n);
  const didUtxo = didUtxos[0];

  const validFromMs = Date.now() - 60_000;                  // lùi 60s cho an toàn slot
  const now = epochOf(validFromMs);
  const poolAfter = (poolUtxo.assets[lampUnit] ?? 0n) - DRIP_OILDROP;

  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };
  if (poolAfter > 0n) poolOutAssets[lampUnit] = poolAfter; else delete poolOutAssets[lampUnit];

  const acctDatum = { did_name: DID_NAME, last_epoch: now };

  const tx = await lucid.newTx()
    .collectFrom([poolUtxo], poolClaimRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .collectFrom([didUtxo])
    .mintAssets({ [acctNftUnit]: 1n }, mintAccountRedeemerToCbor())
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(poolAddr, { kind: "inline", value: faucetConfigToCbor(cfg) }, poolOutAssets)
    .pay.ToAddressWithData(accountAddr, { kind: "inline", value: faucetAccountToCbor(acctDatum) },
      { lovelace: 2_000_000n, [acctNftUnit]: 1n, [lampUnit]: DRIP_OILDROP })
    .pay.ToAddress(myAddr, { [didUnit]: 1n, lovelace: 2_000_000n })  // trả DID NFT về ví
    .validFrom(validFromMs)
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[T2] claim 1001 tLAMP → account (epoch=${now}) ${link(h)}`);
  rec({ step: "T2_claim", hash: h, link: link(h), accountAddr, dripOildrop: DRIP_OILDROP.toString(), epoch: now.toString() });
  await lucid.awaitTx(h);
  await waitVisible(h, accountAddr);
  await waitVisible(h, myAddr);

  const accs = await lucid.utxosAt(accountAddr);
  const a = accs.find((u) => (u.assets[acctNftUnit] ?? 0n) === 1n)!;
  accountRef = { txHash: a.txHash, outputIndex: a.outputIndex };
}

// ─────────────────────────────────────────────────────────────────────────
// T3 — use: spend account (Use) + mang DID NFT → cập last_epoch=now.
// ─────────────────────────────────────────────────────────────────────────
{
  const accs = await lucid.utxosAt(accountAddr);
  const acctUtxo = accs.find((u) => u.txHash === accountRef.txHash && u.outputIndex === accountRef.outputIndex)!;
  const didUtxo = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[didUnit] ?? 0n) >= 1n)[0];

  const validFromMs = Date.now() - 60_000;
  const now = epochOf(validFromMs);
  const acctLamp = acctUtxo.assets[lampUnit] ?? 0n;
  const newDatum = { did_name: DID_NAME, last_epoch: now };
  const acctOut: Record<string, bigint> = { lovelace: acctUtxo.assets.lovelace, [acctNftUnit]: 1n };
  if (acctLamp > 0n) acctOut[lampUnit] = acctLamp;

  const tx = await lucid.newTx()
    .collectFrom([acctUtxo], accountUseRedeemerToCbor())
    .attach.SpendingValidator(faucetAccountScript)
    .collectFrom([didUtxo])
    .pay.ToAddressWithData(accountAddr, { kind: "inline", value: faucetAccountToCbor(newDatum) }, acctOut)
    .pay.ToAddress(myAddr, { [didUnit]: 1n, lovelace: 2_000_000n })
    .validFrom(validFromMs)
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[T3] account Use (last_epoch=${now}) ${link(h)}`);
  rec({ step: "T3_use", hash: h, link: link(h), epoch: now.toString() });
  await lucid.awaitTx(h);
}

await writeFile(resolve(process.cwd(), "demo-faucet-v2-out.json"), JSON.stringify(out, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
console.log("DONE. wrote demo-faucet-v2-out.json");
