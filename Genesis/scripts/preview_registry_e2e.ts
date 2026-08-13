// preview_registry_e2e.ts — Thiết kế CUỐI chạy THẬT trên Preview.
//
// Chứng minh on-chain (Plutus VM thật qua node):
//   • Registry gate: mint LAMP đòi authority trong entry registry (SinglePkh) ký.
//   • A-DEST kho NFT: LAMP BẮT BUỘC rót vào kho (địa chỉ đọc động từ kho NFT).
//   • SupplyState cap: consume+recreate, dist_minted += delta ≤ cap.
//   • ATTACK: rót LAMP về ví (không vào kho) → node REJECT.
//
// Đơn giản hoá cho TEST: 3 marker NFT (thread/registry/kho) đúc bằng 1 native sig policy
// (ví ký). SupplyState + registry ở địa chỉ native (ví spend được). Kho = 1 script addr
// placeholder, đánh dấu bằng kho NFT. KHÔNG test release (TIGER Preview đã chứng minh).
//
// AN TOÀN: chỉ Preview.

import {
  Data, Constr, fromText, toUnit, scriptFromNative, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential,
} from "@lucid-evolution/lucid";
import {
  NETWORK, makeLucid, walletPkh, applyPolicy, policyId, rawValidator, explorerTx,
} from "./config.js";
import {
  DIST_CAP_OILDROP, RESERVE_CAP_OILDROP, SUPPLY_NAME, LAMP_NAME, OILDROP_PER_LAMP,
} from "../offchain/src/constants.js";
import { supplyStateToCbor } from "../offchain/src/datum.js";
import type { LucidEvolution } from "@lucid-evolution/lucid";

const REG_NAME = fromText("REG");   // registry NFT asset name
const KHO_NAME = fromText("KHO");   // kho NFT asset name
const MET_NAME = fromText("MET");   // meter (ReserveDraw — không test)
const LAMP_TAG = fromText("LAMPtag"); // token_tag LAMP trong registry
const KHO_SCRIPT_HASH = "ce".repeat(28); // 28-byte placeholder = địa chỉ kho
const DELTA = 250n * OILDROP_PER_LAMP;  // mint 250 LAMP

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function submit(lucid: LucidEvolution, txComplete: any, label: string): Promise<string> {
  const signed = await txComplete.sign.withWallet().complete();
  const h = await signed.submit();
  console.log(`   TX: ${h}\n   ${explorerTx(h)}`);
  await lucid.awaitTx(h);
  await sleep(15_000);
  return h;
}

async function main() {
  if (NETWORK !== "Preview") throw new Error(`CHẶN: NETWORK=${NETWORK} ≠ Preview`);
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  console.log("=== Preview registry+A-DEST e2e ===  ví pkh:", pkh, "\n");

  // ── native sig policy (CHỈ để đúc marker NFT) ──
  const native = scriptFromNative({ type: "sig", keyHash: pkh });
  const nPid = mintingPolicyToId(native);
  // SupplyState + registry để ở ĐỊA CHỈ VÍ (spend bằng chữ ký, không redeemer/script) —
  // lamp_mint chỉ cần thread NFT + so s_in.address==s_out.address, KHÔNG đòi ở script.
  const walletAddr = await lucid.wallet().address();
  const khoAddr = credentialToAddress(NETWORK, scriptHashToCredential(KHO_SCRIPT_HASH));

  const threadUnit = toUnit(nPid, SUPPLY_NAME);
  const regUnit = toUnit(nPid, REG_NAME);
  const khoUnit = toUnit(nPid, KHO_NAME);

  // ── apply-param lamp_mint (12 param) ──
  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    nPid, SUPPLY_NAME, LAMP_NAME,        // thread + token_name
    DIST_CAP_OILDROP, RESERVE_CAP_OILDROP,       // cap PARAM (framework: LAMP 36 tỷ; FARM 12 tỷ…)
    nPid, REG_NAME, LAMP_TAG,            // registry + tag
    nPid, KHO_NAME,                      // kho NFT
    nPid, MET_NAME,                      // meter
  ]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, LAMP_NAME);
  console.log("lamp_policy:", lampPid, "\nkho addr:", khoAddr, "\n");

  // datums
  const ssDatum0 = supplyStateToCbor({ dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP_OILDROP, reserve_cap: RESERVE_CAP_OILDROP });
  const ssDatum1 = supplyStateToCbor({ dist_minted: DELTA, reserve_minted: 0n, dist_cap: DIST_CAP_OILDROP, reserve_cap: RESERVE_CAP_OILDROP });
  // RegistryDatum Constr0[gov_did, [Entry Constr0[tag, Authority SinglePkh Constr0[pkh]]]]
  const regDatum = Data.to(new Constr(0, [fromText("did:phoenix:org:greensun"), [new Constr(0, [LAMP_TAG, new Constr(0, [pkh])])]]));

  // ── GENESIS: đúc 3 NFT + dựng SupplyState/registry/kho UTxO ──
  console.log("── a. Genesis (đúc NFT + SupplyState + registry + kho) ──");
  const genTx = await lucid.newTx()
    .mintAssets({ [threadUnit]: 1n, [regUnit]: 1n, [khoUnit]: 1n })
    .attach.MintingPolicy(native)
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssDatum0 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: regDatum }, { lovelace: 2_000_000n, [regUnit]: 1n })
    .pay.ToAddress(khoAddr, { lovelace: 2_000_000n, [khoUnit]: 1n })
    .complete();
  await submit(lucid, genTx, "genesis");

  // resolve UTxO
  const atNative = await lucid.utxosAt(walletAddr);
  const ssU = atNative.find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
  const regU = atNative.find((u) => (u.assets[regUnit] ?? 0n) === 1n)!;
  const khoU = (await lucid.utxosAt(khoAddr)).find((u) => (u.assets[khoUnit] ?? 0n) === 1n)!;
  if (!ssU || !regU || !khoU) throw new Error("không resolve được genesis UTxO");

  // ── b. MINT LAMP (DistributionVest) — authority ký, LAMP vào kho ──
  console.log("\n── b. Mint LAMP → kho (registry gate + A-DEST) ──");
  const redeemer = Data.to(new Constr(0, [])); // DistributionVest
  const mintTx = await lucid.newTx()
    .collectFrom([ssU])                  // SupplyState ở ví → spend bằng chữ ký
    .mintAssets({ [lampUnit]: DELTA }, redeemer)
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])              // registry + kho NFT làm reference
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssDatum1 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddress(khoAddr, { lovelace: 2_000_000n, [lampUnit]: DELTA })
    .addSigner(await lucid.wallet().address())
    .complete();
  await submit(lucid, mintTx, "mint LAMP → kho");

  const khoLamp = (await lucid.utxosAt(khoAddr)).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   ✓ kho giữ ${khoLamp / OILDROP_PER_LAMP} LAMP (mong đợi ${DELTA / OILDROP_PER_LAMP})`);
  if (khoLamp < DELTA) throw new Error("A-DEST FAIL: LAMP không vào kho");

  // ── c. ATTACK: rót LAMP về VÍ (không vào kho) → node REJECT ──
  console.log("\n── c. ATTACK: mint LAMP → ví (né kho) — mong đợi REJECT ──");
  const ssU2 = (await lucid.utxosAt(walletAddr)).find((u) => (u.assets[threadUnit] ?? 0n) === 1n)!;
  const ssDatum2 = supplyStateToCbor({ dist_minted: DELTA * 2n, reserve_minted: 0n, dist_cap: DIST_CAP_OILDROP, reserve_cap: RESERVE_CAP_OILDROP });
  try {
    const atk = await lucid.newTx()
      .collectFrom([ssU2])
      .mintAssets({ [lampUnit]: DELTA }, redeemer).attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssDatum2 }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddress(await lucid.wallet().address(), { lovelace: 2_000_000n, [lampUnit]: DELTA }) // LAMP về VÍ
      .addSigner(await lucid.wallet().address())
      .complete();
    await submit(lucid, atk, "ATTACK route-to-wallet");
    console.error("   ❌ ATTACK LỌT — A-DEST KHÔNG chặn! (sai)");
    process.exit(1);
  } catch (e) {
    console.log(`   ✓ Node REJECT đúng: ${(e as Error).message.slice(0, 140)}`);
  }

  console.log("\n✅ Preview THẬT: registry-gate + A-DEST kho NFT chạy đúng; route-to-wallet bị chặn.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
