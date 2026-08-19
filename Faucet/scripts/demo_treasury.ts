// demo_treasury.ts — LUỒNG 2 Treasury (custody seed + collect) trên Preview.
//
// Các tx:
//   S1  seed custody: mint custody NFT one-shot (custody_seed SeedGenesis) → custody
//       UTxO {instance_id, accepted_assets=[tLAMP], ledger=[100 tLAMP @bucket0],
//       cut_bps, ...} value = 100 tLAMP + reserved_min_ada (ADA).
//   C1  collect: spend custody (Collect) + nạp cut tLAMP từ ví (provider) → custody'
//       value += cut; ledger += cut tại (category, tLAMP).
//
// tLAMP dùng: policy b1474a77... name 744c414d50 (genesis DistributionVest).

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
import { buildCollectTx } from "../../Treasury/offchain/src/collectBuilder.js";
import type { CustodyDatum, CollectItem } from "../../Treasury/offchain/src/types.js";
import { msPerEpoch, assertMsPerEpochMatchesNetwork } from "../offchain/src/constants.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const LAMP_POLICY = "b1474a77c8867762efda418adda90ecf7bb5ca35b0be13a7bfbf0ebd";
const LAMP_NAME = "744c414d50";
const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);

const PROPOSAL_POLICY = "00".repeat(28);   // placeholder (Collect KHÔNG đọc proposal_policy)
// ms/epoch theo mạng đích (Preview = 86_400_000, KHÔNG phải 432_000_000 của Preprod/Mainnet).
// Là param của custody ⇒ nướng vào script hash. Assert = tripwire cho lần ai đó hardcode lại.
const NETWORK = "Preview" as const;
const MS_PER_EPOCH = msPerEpoch(NETWORK);
assertMsPerEpochMatchesNetwork(MS_PER_EPOCH, NETWORK);
const INSTANCE_ID = "74726561737572792d6c616d70"; // "treasury-lamp" hex
const RESERVED_MIN_ADA = 3_000_000n;       // ADA giữ cho min-UTxO (không ghi sổ)
const SEED_LEDGER_OILDROP = 100_000_000n;      // 100 tLAMP seed vào bucket 0
const CUT_BPS = 1000n;                      // 10% cut

const lucid = await Lucid(
  new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(process.cwd(), "../../Treasury/onchain/plutus.json"), "utf8"));
const get = (t: string) => bp.validators.find((v: { title: string }) => v.title === t).compiledCode;

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

// ── custody validator (params: proposal_policy, ms_per_epoch) → script hash ──
const custodyScript: Validator = { type: "PlutusV3", script: applyParamsToScript(get("custody.custody.spend"), [PROPOSAL_POLICY, MS_PER_EPOCH]) };
const custodyHash = validatorToScriptHash(custodyScript);
const custodyAddr = credentialToAddress("Preview", scriptHashToCredential(custodyHash));
console.log(`custodyHash=${custodyHash}`);
console.log(`custodyAddr=${custodyAddr}`);

// ── S1: seed custody (one-shot NFT) ─────────────────────────────────────────
const utxos0 = await lucid.wallet().getUtxos();
const genesis = utxos0.reduce((a, b) => (b.assets.lovelace > a.assets.lovelace ? b : a));
const genesisRef = new Constr(0, [genesis.txHash, BigInt(genesis.outputIndex)]);
const custodySeedPolicy: MintingPolicy = { type: "PlutusV3", script: applyParamsToScript(get("custody_seed.custody_seed.mint"), [genesisRef, custodyHash]) };
const custodySeedPid = mintingPolicyToId(custodySeedPolicy);
const custodyNftUnit = toUnit(custodySeedPid, INSTANCE_ID); // NFT name == instance_id
console.log(`custodySeedPid=${custodySeedPid}`);
console.log(`custodyNftUnit=${custodyNftUnit}`);
Object.assign(out, { custodyHash, custodyAddr, custodySeedPid, custodyNftUnit, lampUnit, instanceId: INSTANCE_ID });

// LƯU Ý onchain: seed_value_ok ÉP value == ledger_value ⊕ reserved_min_ada (lovelace),
// KHÔNG loại trừ custody NFT. Trên chain custody UTxO BẮT BUỘC mang NFT (authenticity)
// → để đẳng thức khớp, BOOK custody NFT thành 1 dòng sổ (bucket riêng) + đưa vào
// accepted_assets. (NFT qty 1; Collect bảo toàn dòng này.) Đây là cách dựng offchain
// hợp lệ DUY NHẤT cho seed hiện tại — xem báo cáo: seed_value_ok thiếu loại trừ NFT.
const seedDatum: CustodyDatum = {
  instance_id: INSTANCE_ID,
  accepted_assets: [
    { policy: LAMP_POLICY, name: LAMP_NAME },
    { policy: custodySeedPid, name: INSTANCE_ID },          // NFT key (để dòng sổ NFT hợp lệ)
  ],
  ledger: [
    { bucket_id: 0n, policy: LAMP_POLICY, name: LAMP_NAME, amount: SEED_LEDGER_OILDROP },
    { bucket_id: 9n, policy: custodySeedPid, name: INSTANCE_ID, amount: 1n }, // book NFT
  ],
  cut_bps: CUT_BPS,
  governance_ref: "",
  epoch: 0n,
  consumed_proposals: [],
};
// seed_value_ok: value == ledger_value ⊕ reserved_min_ada(lovelace).
// ledger_value = 100 tLAMP + 1 NFT; value = + reserved ADA. NFT thêm bên dưới (pay).
const seedAssets: Record<string, bigint> = { lovelace: RESERVED_MIN_ADA, [lampUnit]: SEED_LEDGER_OILDROP };

let custodyRef: { txHash: string; outputIndex: number };
{
  const seedRedeemer = Data.to(new Constr(0, [RESERVED_MIN_ADA]));  // SeedGenesis{reserved_min_ada}
  const tx = await lucid.newTx()
    .collectFrom([genesis])                                          // consume genesis (one-shot)
    .mintAssets({ [custodyNftUnit]: 1n }, seedRedeemer)
    .attach.MintingPolicy(custodySeedPolicy)
    .pay.ToAddressWithData(
      custodyAddr,
      { kind: "inline", value: custodyDatumToCbor(seedDatum) },
      { ...seedAssets, [custodyNftUnit]: 1n },
    )
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[S1] custody seeded (NFT + 100 tLAMP, ledger@bucket0) ${link(h)}`);
  rec({ step: "S1_seed", hash: h, link: link(h), custodyAddr, custodyNftUnit, seedLedgerOildrop: SEED_LEDGER_OILDROP.toString() });
  await lucid.awaitTx(h);
  await waitVisible(h, custodyAddr);
  await waitVisible(h, myAddr);
  const cs = await lucid.utxosAt(custodyAddr);
  const c = cs.find((u) => (u.assets[custodyNftUnit] ?? 0n) === 1n)!;
  custodyRef = { txHash: c.txHash, outputIndex: c.outputIndex };
}

// ── C1: collect (provider trả 200 tLAMP, cut 10% = 20 tLAMP về custody) ───────
{
  const cs = await lucid.utxosAt(custodyAddr);
  const custodyUtxo = cs.find((u) => u.txHash === custodyRef.txHash && u.outputIndex === custodyRef.outputIndex)!;

  // app_id = pkh ví (ai trả). amount = số app định giá. category = bucket đích cut.
  const items: CollectItem[] = [
    { app_id: pkh, policy: LAMP_POLICY, name: LAMP_NAME, amount: 200_000_000n, category: 0n },
  ];
  const res = await buildCollectTx({ lucid, network: "Preview" as Network, custodyUtxo, custodyScript, items, newEpoch: 1n });
  console.log(res.summary);
  const h = await (await res.tx.sign.withWallet().complete()).submit();
  console.log(`[C1] collect (cut về custody) ${link(h)}`);
  rec({ step: "C1_collect", hash: h, link: link(h), itemAmount: "200000000", cutBps: CUT_BPS.toString(), cut: res.cutValue });
  await lucid.awaitTx(h);
  await waitVisible(h, custodyAddr);
}

await writeFile(resolve(process.cwd(), "demo-treasury-out.json"), JSON.stringify(out, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
console.log("DONE. wrote demo-treasury-out.json");
