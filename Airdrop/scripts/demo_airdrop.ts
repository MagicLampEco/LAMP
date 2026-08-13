// demo_airdrop.ts — DEMO TIGER Airdrop trên Preview (bản HARDENING spend-once).
//
// Tx A1 Deploy (one-shot): mint POOL NFT + N claim-slot, seed pool tLAMP, slot →
//   registry (marker). pool datum claimed_count=0, merkle_root = root snapshot.
// Tx A2 Claim 1 leaf (ví mình): consume pool + consume+BURN slot leaf + nhận
//   tLAMP + pool datum claimed_count+1.
// Tx A3 (tuỳ chọn) claim LẠI cùng leaf → PHẢI fail (slot đã burn).
//
// AN TOÀN: chỉ Preview. Chặn cứng NETWORK==Preview + BLOCKFROST_KEY prefix preview.
// KHÔNG in seed/key.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import { resolve, dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildTree } from "../offchain/src/merkle.js";
import { buildDeployTx } from "../offchain/src/deployBuilder.js";
import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import type { AirdropPool, SnapshotEntry, MerkleParams } from "../offchain/src/types.js";
import {
  MS_PER_EPOCH_BY_NETWORK, DELEGATOR_CAMPAIGN_ID, ROLE_DELEGATOR,
} from "../offchain/src/constants.js";

// Tìm .env: ưu tiên scripts/.env, fallback repo root
const __dir = dirname(fileURLToPath(import.meta.url));
const ENV_CANDIDATES = [
  resolve(__dir, ".env"),
  resolve(__dir, "../../.env"),
  resolve(__dir, "../../../.env"),
];
let ENV_PATH = "";
for (const p of ENV_CANDIDATES) {
  try { readFileSync(p); ENV_PATH = p; break; } catch { /* thử tiếp */ }
}
if (!ENV_PATH) throw new Error("Không tìm thấy .env — tạo Airdrop/scripts/.env");
// loader .env tối giản (tránh phụ thuộc dotenv). KHÔNG in giá trị.
for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]!] === undefined) {
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

// ── AN TOÀN: chặn cứng Preview ────────────────────────────────────────────
const NETWORK = process.env.NETWORK ?? "";
const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
if (NETWORK !== "Preview") { console.error("ABORT: NETWORK != Preview"); process.exit(1); }
if (!BLOCKFROST_KEY.startsWith("preview")) { console.error("ABORT: BLOCKFROST_KEY không phải preview"); process.exit(1); }

const LAMP_POLICY = process.env.LAMP_POLICY_ID!;
const LAMP_NAME = process.env.LAMP_ASSET_NAME!;
const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);
const MS_PER_EPOCH = MS_PER_EPOCH_BY_NETWORK.Preview;

const lucid = await Lucid(
  new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", BLOCKFROST_KEY),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(import.meta.dirname, "../onchain/plutus.json"), "utf8"));
const get = (t: string) => bp.validators.find((v: { title: string }) => v.title === t).compiledCode;

const link = (h: string) => `https://preview.cexplorer.io/tx/${h}`;
const out: Record<string, unknown> = { network: "Preview", demo: "TIGER Airdrop", txs: [] as unknown[] };
const rec = (o: unknown) => (out.txs as unknown[]).push(o);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitVisible(txHash: string, addr: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const us = await lucid.utxosAt(addr);
    if (us.some((u) => u.txHash === txHash)) return;
    await sleep(5000);
  }
  throw new Error(`tx ${txHash} chưa visible ở ${addr} sau ${tries} lần`);
}

console.log(`[airdrop] ví: ${myAddr}`);
console.log(`[airdrop] tLAMP unit: ${lampUnit}`);

// ── Snapshot nhỏ (gồm ví mình + 1 địa chỉ phụ) ─────────────────────────────
// địa chỉ phụ: dựng từ 1 pkh giả (enterprise) để snapshot có 2 leaf.
const dummyPkh = "00112233445566778899aabbccddeeff00112233445566778899aabb";
const otherAddr = credentialToAddress("Preview", { type: "Key", hash: dummyPkh });

const MY_CLAIM_OILDROP = 1_000_000n;   // 1 LAMP cho ví mình (claim được)
const OTHER_OILDROP = 2_000_000n;      // 2 LAMP cho địa chỉ phụ (không claim)

const snapshot: SnapshotEntry[] = [
  { address: myAddr, amount: MY_CLAIM_OILDROP },
  { address: otherAddr, amount: OTHER_OILDROP },
];

// Schema C: bộ (campaign_id, snapshot_epoch, role) BAKE vào validator PARAM và
// đồng thời vào leaf. Off-chain và param dưới đây PHẢI đọc cùng 3 hằng này —
// lệch 1 byte thì leaf không khớp root và không claim được.
const SNAPSHOT_EPOCH = BigInt(Math.floor(Date.now() / Number(MS_PER_EPOCH)));
const merkleParams: MerkleParams = {
  campaignId: DELEGATOR_CAMPAIGN_ID,
  epoch: SNAPSHOT_EPOCH,
  role: ROLE_DELEGATOR,
};
const tree = buildTree(snapshot, merkleParams);
const poolSeedOildrop = snapshot.reduce((s, e) => s + e.amount, 0n); // tổng = 3 LAMP
console.log(`[airdrop] merkle_root: ${tree.root}`);
console.log(`[airdrop] leaves: ${tree.leaves.length}, pool seed: ${poolSeedOildrop} oildrop`);

// ── Apply validators (genesis_ref one-shot) ────────────────────────────────
const walletUtxos0 = await lucid.wallet().getUtxos();
// genesis: chọn UTxO pure-ADA nhiều ADA nhất (tránh tiêu UTxO mang asset cần giữ).
const pureAda0 = walletUtxos0.filter((u) => Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0);
if (pureAda0.length === 0) throw new Error("không có UTxO pure-ADA làm genesis");
const genesis = pureAda0.reduce((a, b) => (b.assets.lovelace > a.assets.lovelace ? b : a));
const genesisRef = new Constr(0, [genesis.txHash, BigInt(genesis.outputIndex)]);
console.log(`[airdrop] genesis ref: ${genesis.txHash}#${genesis.outputIndex}`);

const airdropNftPolicy: MintingPolicy = {
  type: "PlutusV3",
  script: applyParamsToScript(get("airdrop_nft.airdrop_nft.mint"), [genesisRef]),
};
const airdropNftPolicyId = mintingPolicyToId(airdropNftPolicy);

const poolScript: Validator = {
  type: "PlutusV3",
  script: applyParamsToScript(get("airdrop_pool.airdrop_pool.spend"), [
    airdropNftPolicyId, LAMP_POLICY, LAMP_NAME, MS_PER_EPOCH,
    merkleParams.campaignId, merkleParams.epoch, BigInt(merkleParams.role),
  ]),
};
const markerScript: Validator = {
  type: "PlutusV3",
  script: applyParamsToScript(get("airdrop_marker.airdrop_marker.spend"), [airdropNftPolicyId]),
};

const poolAddress = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(poolScript)));
const markerAddress = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(markerScript)));
const poolNftUnit = toUnit(airdropNftPolicyId, "41504f4f4c");

console.log(`[airdrop] nftPolicyId: ${airdropNftPolicyId}`);
console.log(`[airdrop] poolAddr:    ${poolAddress}`);
console.log(`[airdrop] markerAddr:  ${markerAddress}`);
Object.assign(out, { airdropNftPolicyId, poolAddress, markerAddress, merkleRoot: tree.root, lampUnit, poolNftUnit });

// deadline_epoch: rất xa trong tương lai để còn cửa sổ claim.
const deadlineEpoch = SNAPSHOT_EPOCH + 3650n; // ~10 năm
const pool: AirdropPool = {
  merkle_root: tree.root,
  deadline_epoch: deadlineEpoch,
  treasury_dest: myAddr,        // sweep (không dùng trong demo) → về ví mình
  marker_dest: markerAddress,   // registry GIỮ slot
  claimed_count: 0n,
};

// ─────────────────────────────────────────────────────────────────────────
// Tx A1 — Deploy (one-shot)
// ─────────────────────────────────────────────────────────────────────────
let a1Hash: string;
{
  const { tx, slotUnits, summary } = await buildDeployTx({
    lucid, genesisUtxo: genesis,
    airdropNftPolicy, airdropNftPolicyId,
    poolAddress, pool, tree,
    lamp_policy: LAMP_POLICY, lamp_name: LAMP_NAME,
    poolLampAmount: poolSeedOildrop,
  });
  console.log("\n" + summary + "\n");
  const signed = await tx.sign.withWallet().complete();
  a1Hash = await signed.submit();
  console.log(`[A1] DEPLOY submitted ${link(a1Hash)}`);
  rec({ step: "A1_deploy", hash: a1Hash, link: link(a1Hash), poolAddress, markerAddress, slots: slotUnits.length, poolSeedOildrop: poolSeedOildrop.toString() });
  await lucid.awaitTx(a1Hash);
  await waitVisible(a1Hash, poolAddress);
  await waitVisible(a1Hash, markerAddress);
  console.log(`[A1] confirmed + visible (pool + registry)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Tx A2 — Claim leaf của ví mình
// ─────────────────────────────────────────────────────────────────────────
const myLeaf = tree.leaves[tree.entries.findIndex((e) => e.address === myAddr)];
const mySlotUnit = toUnit(airdropNftPolicyId, myLeaf!);
let a2Hash: string;
{
  const poolUtxos = await lucid.utxosAt(poolAddress);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n)!;
  const slotUtxos = await lucid.utxosAt(markerAddress);
  const slotUtxo = slotUtxos.find((u) => (u.assets[mySlotUnit] ?? 0n) === 1n)!;
  if (!slotUtxo) throw new Error("không tìm thấy slot UTxO của leaf ví mình ở registry");

  const validToMs = Date.now() + 30 * 60_000; // 30 phút, << deadline (10 năm)

  const { tx, amount, leaf, slotUnit, summary } = await buildClaimTx({
    lucid, poolUtxo, pool, airdropPoolScript: poolScript,
    slotUtxo, airdropMarkerScript: markerScript,
    airdropNftPolicy, airdropNftPolicyId,
    tree, claimerAddress: myAddr,
    lamp_policy: LAMP_POLICY, lamp_name: LAMP_NAME,
    validToMs,
  });
  console.log("\n" + summary + "\n");
  const signed = await tx.sign.withWallet().complete();
  a2Hash = await signed.submit();
  console.log(`[A2] CLAIM submitted ${link(a2Hash)} (amount ${amount} oildrop)`);
  rec({ step: "A2_claim", hash: a2Hash, link: link(a2Hash), claimer: myAddr, amountOildrop: amount.toString(), leaf, slotUnit });
  await lucid.awaitTx(a2Hash);
  await waitVisible(a2Hash, poolAddress);
  console.log(`[A2] confirmed`);
}

// ── Verify on-chain: slot đã burn (registry không còn slot), pool count+1 ───
{
  await sleep(8000);
  const slotUtxos = await lucid.utxosAt(markerAddress);
  const slotStill = slotUtxos.some((u) => (u.assets[mySlotUnit] ?? 0n) > 0n);
  const poolUtxos = await lucid.utxosAt(poolAddress);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n);
  const poolLampAfter = poolUtxo ? (poolUtxo.assets[lampUnit] ?? 0n) : -1n;
  console.log(`[verify] slot leaf ví mình còn ở registry? ${slotStill} (kỳ vọng false = đã burn)`);
  console.log(`[verify] pool tLAMP sau claim: ${poolLampAfter} oildrop (kỳ vọng ${poolSeedOildrop - MY_CLAIM_OILDROP})`);
  rec({ step: "verify", slotBurned: !slotStill, poolLampAfterOildrop: poolLampAfter.toString(), expectedPoolLampOildrop: (poolSeedOildrop - MY_CLAIM_OILDROP).toString() });
}

await writeFile(resolve(import.meta.dirname, "demo-airdrop-out.json"),
  JSON.stringify(out, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
console.log("\nDONE. wrote demo-airdrop-out.json");
console.log(`A1 deploy: ${link(a1Hash)}`);
console.log(`A2 claim:  ${link(a2Hash)}`);
