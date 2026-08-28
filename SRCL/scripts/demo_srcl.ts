// demo_srcl.ts — DEMO SRCL trên Preview (bản HARDENING slot spend-once).
//
// Tx I1 Deploy: mint POOL NFT one-shot (srcl_nft MintPool) + seed pool tLAMP,
//   datum epoch_roots=[], distributed_total=0, end_epoch=35.
// Tx I2 SetRoot epoch 0 (admin ký): append root_0 + mint bộ slot owners → registry.
// Tx I3 Claim (owner = ví mình, epoch 0): consume pool + consume+BURN slot + nhận tLAMP.
//
// AN TOÀN: chỉ Preview. Chặn cứng NETWORK==Preview + BLOCKFROST_KEY prefix preview.
// KHÔNG in seed/key.

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit,
  type MintingPolicy, type Validator,
} from "@lucid-evolution/lucid";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { buildTree } from "../offchain/src/merkle.js";
import { srclDatumToCbor, mintPoolRedeemerToCbor } from "../offchain/src/datum.js";
import { buildSetRootTx } from "../offchain/src/setRootBuilder.js";
import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import {
  POOL_NFT_NAME, END_EPOCH, msPerEpochFor, assertMsPerEpochMatchesNetwork,
  SRCL_CAMPAIGN_ID, ROLE_SPO,
} from "../offchain/src/constants.js";
import type { SrclDatum, ClaimProof } from "../offchain/src/types.js";
import type { Network } from "@magiclamp/utils";
import { assertSweepDest } from "../offchain/src/sweepDestGuard.js";

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
const out: Record<string, unknown> = { network: "Preview", demo: "SRCL", txs: [] as unknown[] };
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

console.log(`[srcl] ví: ${myAddr}`);
console.log(`[srcl] pkh (owner/admin): ${pkh}`);
console.log(`[srcl] tLAMP unit: ${lampUnit}`);

// ── Apply validators (genesis_ref one-shot) ────────────────────────────────
const walletUtxos0 = await lucid.wallet().getUtxos();
const pureAda0 = walletUtxos0.filter((u) => Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0);
if (pureAda0.length === 0) throw new Error("không có UTxO pure-ADA làm genesis");
const genesis = pureAda0.reduce((a, b) => (b.assets.lovelace > a.assets.lovelace ? b : a));
const genesisRef = new Constr(0, [genesis.txHash, BigInt(genesis.outputIndex)]);
console.log(`[srcl] genesis ref: ${genesis.txHash}#${genesis.outputIndex}`);

const srclNftPolicy: MintingPolicy = {
  type: "PlutusV3",
  script: applyParamsToScript(get("srcl_nft.srcl_nft.mint"), [genesisRef]),
};
const srclNftPolicyId = mintingPolicyToId(srclNftPolicy);

// marker (registry) — param chỉ policyId.
const markerScript: Validator = {
  type: "PlutusV3",
  script: applyParamsToScript(get("srcl_marker.srcl_marker.spend"), [srclNftPolicyId]),
};
const markerHash = validatorToScriptHash(markerScript);

// admin = ví mình; threshold = 1.
const ADMIN = [pkh];
const ADMIN_THRESHOLD = 1n;

// pool — 8 param. 6 = slot_registry_hash (markerHash); 7+8 = schema C
// (campaign_id, role) — BAKE cùng bộ mà buildTree dùng, lệch là claim hỏng.
const poolScript: Validator = {
  type: "PlutusV3",
  script: applyParamsToScript(get("srcl_pool.srcl_pool.spend"),
    [srclNftPolicyId, LAMP_POLICY, LAMP_NAME, ADMIN, ADMIN_THRESHOLD, markerHash,
     SRCL_CAMPAIGN_ID, BigInt(ROLE_SPO)]),
};

const poolAddress = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(poolScript)));
const markerAddress = credentialToAddress("Preview", scriptHashToCredential(markerHash));
const poolNftUnit = toUnit(srclNftPolicyId, POOL_NFT_NAME);

console.log(`[srcl] nftPolicyId: ${srclNftPolicyId}`);
console.log(`[srcl] poolAddr:    ${poolAddress}`);
console.log(`[srcl] markerAddr:  ${markerAddress}`);
console.log(`[srcl] markerHash:  ${markerHash}`);
Object.assign(out, { srclNftPolicyId, poolAddress, markerAddress, markerHash, lampUnit, poolNftUnit });

// ── Snapshot epoch 0 (2 owner: ví mình + 1 pkh giả) ────────────────────────
const dummyOwner = "00112233445566778899aabbccddeeff00112233445566778899aabb";
const MY_OILDROP = 1_000_000n;     // 1 LAMP cho ví mình
const OTHER_OILDROP = 2_000_000n;  // 2 LAMP cho pkh giả
const owners = [pkh, dummyOwner];
const entries = [
  { epoch: 0n, owner: pkh, amount: MY_OILDROP },
  { epoch: 0n, owner: dummyOwner, amount: OTHER_OILDROP },
];
const tree = buildTree(SRCL_CAMPAIGN_ID, ROLE_SPO, entries);
const root0 = tree.root;
const poolSeedOildrop = MY_OILDROP + OTHER_OILDROP; // 3 LAMP
console.log(`[srcl] root0: ${root0}, pool seed: ${poolSeedOildrop} oildrop`);

// ── Datum khởi tạo ──────────────────────────────────────────────────────────
// `treasury_dest` là đích của `Sweep` — đường ra DUY NHẤT của pool, và nó ghi một lần vào datum
// rồi bị `srcl_pool.ak:125,179` ép bảo toàn ở mọi redeemer khác ⇒ không sửa được sau.
//
// Bản trước đặt `treasury_dest: pkh` — CÙNG giá trị với `ADMIN = [pkh]` ở trên. Hai chỗ hỏng
// chồng lên nhau, cả hai im lặng:
//   (1) đích trùng người gác ⇒ Sweep chuyển LAMP từ chỗ người giữ khoá admin với tới được sang
//       chỗ CŨNG với tới được. Không phải một đường ra.
//   (2) `pkh` là khoá VÍ, mà `srcl_pool.ak:210` → `util.is_at_script:23-27` đòi
//       `payment_credential == Script(h)` ⇒ Sweep đòi trả LAMP tới `Script(<khoá ví>)`, một địa
//       chỉ script KHÔNG CÓ TIỀN ẢNH. Tx vẫn lên chuỗi "thành công", LAMP thì không ai spend
//       được nữa — và LAMP không burn nên không có đường dọn sổ.
// Cùng họ với `meter_nft_policy = 28 byte 0` đã giết nhánh ReserveDraw của bản mồi mainnet:
// một giá trị đúng hình dạng, sai tiền ảnh, nướng vào chỗ không sửa được sau.
//
// Nay đòi khai tường minh qua env, và cổng ép hai điều kiện trước khi ghi.
const SWEEP_DEST = process.env.SRCL_TREASURY_DEST ?? "";
if (!SWEEP_DEST) {
  throw new Error(
    "SWEEP-000: thiếu SRCL_TREASURY_DEST — đích của Sweep, ghi một lần vào datum, không sửa " +
    "được sau. Phải là SCRIPT hash của kho nhận, nằm dưới tập khoá RỜI với ADMIN. Bản trước " +
    "mặc định lấy khoá ví đang chạy, vừa trùng admin vừa sai kiểu hash.",
  );
}
assertSweepDest(SWEEP_DEST, { admin: ADMIN, willWrite: true, isScriptHash: true });

const initDatum: SrclDatum = {
  epoch_roots: [],
  distributed_total: 0n,
  end_epoch: END_EPOCH,
  treasury_dest: SWEEP_DEST,
  // Lấy theo ĐÚNG mạng đang chạy. Bản trước nạp hằng MAINNET (432_000_000) trong khi script
  // khoá cứng NETWORK === "Preview" (86_400_000) ⇒ lệch 5 lần trên chính mạng nó chạy.
  ms_per_epoch: msPerEpochFor(NETWORK as Network),
};

// Cổng gác TRƯỚC khi ký: số sắp ghi vào datum phải khớp mạng đích. Sau khi ký thì nó
// nằm trong datum on-chain, và pool đọc mốc epoch bằng chính nó.
assertMsPerEpochMatchesNetwork(initDatum.ms_per_epoch, NETWORK as Network);
console.log(`[srcl] ms_per_epoch=${initDatum.ms_per_epoch} (mạng ${NETWORK}) — cổng SRCL-EPOCH-001 qua`);

// ─────────────────────────────────────────────────────────────────────────
// Tx I1 — Deploy: mint POOL NFT one-shot + seed pool tLAMP
// ─────────────────────────────────────────────────────────────────────────
let i1Hash: string;
{
  const tx = await lucid.newTx()
    .collectFrom([genesis])
    .mintAssets({ [poolNftUnit]: 1n }, mintPoolRedeemerToCbor())
    .attach.MintingPolicy(srclNftPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: srclDatumToCbor(initDatum) },
      { lovelace: 5_000_000n, [poolNftUnit]: 1n, [lampUnit]: poolSeedOildrop },
    )
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const signed = await tx.sign.withWallet().complete();
  i1Hash = await signed.submit();
  console.log(`[I1] DEPLOY submitted ${link(i1Hash)} (POOL NFT + ${poolSeedOildrop} oildrop tLAMP)`);
  rec({ step: "I1_deploy", hash: i1Hash, link: link(i1Hash), poolAddress, poolNftUnit, poolSeedOildrop: poolSeedOildrop.toString() });
  await lucid.awaitTx(i1Hash);
  await waitVisible(i1Hash, poolAddress);
  console.log(`[I1] confirmed + visible`);
}

// ─────────────────────────────────────────────────────────────────────────
// Tx I2 — SetRoot epoch 0 (admin ký) + mint bộ slot → registry
// ─────────────────────────────────────────────────────────────────────────
let i2Hash: string;
{
  const poolUtxos = await lucid.utxosAt(poolAddress);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n)!;

  const { tx, epoch, slotUnits, summary } = await buildSetRootTx({
    lucid, network: "Preview" as never,
    poolUtxo, srclPoolScript: poolScript, srclMarkerScript: markerScript,
    srclNftPolicy, srclNftPolicyId,
    root: root0, owners,
    adminSigners: ADMIN,
  });
  console.log("\n" + summary + "\n");
  const signed = await tx.sign.withWallet().complete();
  i2Hash = await signed.submit();
  console.log(`[I2] SETROOT submitted ${link(i2Hash)} (epoch ${epoch}, ${slotUnits.length} slot → registry)`);
  rec({ step: "I2_setroot", hash: i2Hash, link: link(i2Hash), epoch, slots: slotUnits.length, root: root0 });
  await lucid.awaitTx(i2Hash);
  await waitVisible(i2Hash, poolAddress);
  await waitVisible(i2Hash, markerAddress);
  console.log(`[I2] confirmed + visible (pool + registry)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Tx I3 — Claim epoch 0, owner = ví mình
// ─────────────────────────────────────────────────────────────────────────
const sName = (await import("../offchain/src/merkle.js")).markerName(0n, pkh);
const mySlotUnit = toUnit(srclNftPolicyId, sName);
let i3Hash: string;
let ownerAddrOut = "";
{
  const poolUtxos = await lucid.utxosAt(poolAddress);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n)!;
  const slotUtxos = await lucid.utxosAt(markerAddress);
  const slotUtxo = slotUtxos.find((u) => (u.assets[mySlotUnit] ?? 0n) === 1n)!;
  if (!slotUtxo) throw new Error("không tìm thấy slot UTxO (epoch0, ví mình) ở registry");

  const proof = tree.proofFor(0n, pkh);
  const claim: ClaimProof = { epoch: 0n, owner: pkh, amount: MY_OILDROP, proof };

  const { tx, amount, poolAfter, slotUnit, ownerAddress, summary } = await buildClaimTx({
    lucid, network: "Preview" as never,
    poolUtxo, slotUtxo, srclPoolScript: poolScript, srclMarkerScript: markerScript,
    srclNftPolicy, srclNftPolicyId,
    lampPolicyId: LAMP_POLICY, lampAssetName: LAMP_NAME,
    claim,
  });
  ownerAddrOut = ownerAddress;
  console.log("\n" + summary + "\n");
  const signed = await tx.sign.withWallet().complete();
  i3Hash = await signed.submit();
  console.log(`[I3] CLAIM submitted ${link(i3Hash)} (amount ${amount} oildrop → ${ownerAddress})`);
  rec({ step: "I3_claim", hash: i3Hash, link: link(i3Hash), epoch: 0, owner: pkh, amountOildrop: amount.toString(), poolAfterOildrop: poolAfter.toString(), slotUnit, ownerAddress });
  await lucid.awaitTx(i3Hash);
  await waitVisible(i3Hash, poolAddress);
  console.log(`[I3] confirmed`);
}

// ── Verify on-chain ────────────────────────────────────────────────────────
{
  await sleep(8000);
  const slotUtxos = await lucid.utxosAt(markerAddress);
  const slotStill = slotUtxos.some((u) => (u.assets[mySlotUnit] ?? 0n) > 0n);
  const poolUtxos = await lucid.utxosAt(poolAddress);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n);
  const poolLampAfter = poolUtxo ? (poolUtxo.assets[lampUnit] ?? 0n) : -1n;
  console.log(`[verify] slot (epoch0,ví mình) còn ở registry? ${slotStill} (kỳ vọng false = đã burn)`);
  console.log(`[verify] pool tLAMP sau claim: ${poolLampAfter} oildrop (kỳ vọng ${poolSeedOildrop - MY_OILDROP})`);
  rec({ step: "verify", slotBurned: !slotStill, poolLampAfterOildrop: poolLampAfter.toString(), expectedPoolLampOildrop: (poolSeedOildrop - MY_OILDROP).toString(), ownerReceived: ownerAddrOut });
}

await writeFile(resolve(import.meta.dirname, "demo-srcl-out.json"),
  JSON.stringify(out, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
console.log("\nDONE. wrote demo-srcl-out.json");
console.log(`I1 deploy:  ${link(i1Hash)}`);
console.log(`I2 setroot: ${link(i2Hash)}`);
console.log(`I3 claim:   ${link(i3Hash)}`);
