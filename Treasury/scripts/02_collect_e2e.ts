// Treasury Step 2: Collect e2e — provider gửi LAMP → buildCollectTx → verify custody
// value + ledger tăng đúng cut + circulating GIẢM đúng cut (KHÔNG burn, total cố định).
//
// Chạy: npx tsx 02_collect_e2e.ts   (sau 01_deploy_custody)
//
// Flow (CONTRACT §3 collectToTreasury, custody.ak nhánh Collect):
//   a. Đo TRƯỚC: custody value(LAMP), Σ sổ, circulating = total − held.
//   b. buildCollectTx: provider trả `amount` LAMP; cut = amount × cut_bps/10000 vào
//      custody (đúng bucket=category); residual amount−cut do CALLER trả provider ngoài
//      custody (ở đây ví deploy đóng cả 2 vai → residual quay lại ví).
//   c. submit + await.
//   d. Đo SAU: verify custody value(LAMP) += cut, sổ(category,LAMP) += cut,
//      circulating −= cut, total BẤT BIẾN (Σout=Σin per-asset — không burn).
//
// KHÔNG submit ở chế độ build — chỉ import + tsc. Live khi có .env + LAMP token thật.

import { Data, type UTxO } from "@lucid-evolution/lucid";
import {
  NETWORK, MS_PER_EPOCH, LAMP_TOTAL_SUPPLY,
  makeLucid, walletPkh,
  rawValidator, applyValidator,
  loadDeployed, awaitTx, explorerTx, toUnit,
} from "./config.js";
import { decodeCustodyDatum } from "../offchain/src/datum.js";
import { buildCollectTx, assetsToMap } from "../offchain/src/collectBuilder.js";
import { ledgerGet } from "../offchain/src/collect.js";
import { treasuryHeld, circulatingSupply, type ValueUtxo } from "../offchain/src/circulating.js";
import type { CollectItem } from "../offchain/src/types.js";

// Lượng LAMP provider trả (oil) + bucket đích.
const COLLECT_AMOUNT = BigInt(process.env.COLLECT_AMOUNT ?? "1000000"); // 1 LAMP (oil)
const COLLECT_CATEGORY = BigInt(process.env.COLLECT_CATEGORY ?? "1");
const APP_ID = (process.env.APP_ID ?? "6170701").trim();   // hex app id

async function main(): Promise<void> {
  console.log("=== Treasury Step 2: Collect e2e ===\n");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const state = await loadDeployed();

  if (!state.genesis) throw new Error("deployed.json thiếu genesis — chạy 01_deploy_custody trước.");
  if (!state.lamp) {
    throw new Error(
      "deployed.json thiếu lamp (policyId/assetName) — cấp LAMP_POLICY_ID qua .env rồi chạy lại "
        + "01_deploy_custody. Collect e2e cần asset LAMP thật để provider trả.",
    );
  }

  const lampPolicy = state.lamp.policyId;
  const lampName = state.lamp.assetName;
  const lampUnit = toUnit(lampPolicy, lampName);

  // ── re-apply custody validator (deterministic từ params) ───────────────
  const rawCustody = await rawValidator("custody.custody.spend");
  const custodyScript = applyValidator(rawCustody.compiledCode, [
    state.proposalPolicy, MS_PER_EPOCH,
  ]);

  // ── resolve custody UTxO (mang NFT authenticity) ───────────────────────
  const seedNftUnit = toUnit(state.custodySeed!.policyId, state.custodySeed!.instanceId);
  const custodyUtxosAll: UTxO[] = await lucid.utxosAt(state.custody.address);
  // CHỈ custody THẬT = UTxO mang NFT authenticity (đúng policy). Loại UTxO lạ tại
  // cùng địa chỉ → không cộng nhầm held (đa shard: mọi shard mang NFT cùng policy).
  const custodyUtxos = custodyUtxosAll.filter((u) => (u.assets[seedNftUnit] ?? 0n) === 1n);
  const custodyUtxo = custodyUtxos[0];
  if (!custodyUtxo || !custodyUtxo.datum) {
    throw new Error("không tìm thấy custody UTxO mang NFT + inline datum.");
  }

  const datumBefore = decodeCustodyDatum(Data.from(custodyUtxo.datum));

  // ── a. Đo TRƯỚC ────────────────────────────────────────────────────────
  const heldBefore = treasuryHeld(custodyUtxos as ValueUtxo[], lampPolicy, lampName);
  const circBefore = circulatingSupply(
    LAMP_TOTAL_SUPPLY, custodyUtxos as ValueUtxo[], lampPolicy, lampName,
  );
  const ledgerBefore = ledgerGet(datumBefore.ledger, COLLECT_CATEGORY, lampPolicy, lampName);

  console.log("── Trước Collect ──");
  console.log(`custody LAMP value: ${heldBefore}`);
  console.log(`sổ bucket ${COLLECT_CATEGORY} LAMP: ${ledgerBefore}`);
  console.log(`circulating LAMP:   ${circBefore}  (= total ${LAMP_TOTAL_SUPPLY} − held ${heldBefore})`);
  console.log();

  // ── b. buildCollectTx ──────────────────────────────────────────────────
  const items: CollectItem[] = [
    { app_id: APP_ID, policy: lampPolicy, name: lampName, amount: COLLECT_AMOUNT, category: COLLECT_CATEGORY },
  ];
  const { tx, cutValue, custodyAfter, summary } = await buildCollectTx({
    lucid, network: NETWORK, custodyUtxo, custodyScript, items,
  });
  console.log(summary);
  console.log();

  const cutLamp = cutValue[`${lampPolicy.toLowerCase()}|${lampName.toLowerCase()}`] ?? 0n;

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, "collect");

  // ── d. Đo SAU + verify bất biến ────────────────────────────────────────
  const custodyUtxos2All: UTxO[] = await lucid.utxosAt(state.custody.address);
  const custodyUtxos2 = custodyUtxos2All.filter((u) => (u.assets[seedNftUnit] ?? 0n) === 1n);
  const custodyUtxo2 = custodyUtxos2[0];
  if (!custodyUtxo2 || !custodyUtxo2.datum) throw new Error("custody UTxO sau collect không tìm thấy.");

  const datumAfter = decodeCustodyDatum(Data.from(custodyUtxo2.datum));
  const heldAfter = treasuryHeld(custodyUtxos2 as ValueUtxo[], lampPolicy, lampName);
  const circAfter = circulatingSupply(
    LAMP_TOTAL_SUPPLY, custodyUtxos2 as ValueUtxo[], lampPolicy, lampName,
  );
  const ledgerAfter = ledgerGet(datumAfter.ledger, COLLECT_CATEGORY, lampPolicy, lampName);

  console.log("\n── Sau Collect ──");
  console.log(`custody LAMP value: ${heldAfter}  (Δ +${heldAfter - heldBefore})`);
  console.log(`sổ bucket ${COLLECT_CATEGORY} LAMP: ${ledgerAfter}  (Δ +${ledgerAfter - ledgerBefore})`);
  console.log(`circulating LAMP:   ${circAfter}  (Δ ${circAfter - circBefore})`);
  console.log();

  // Verify (đối chiếu off-chain ↔ on-chain thật):
  const valueOk = (heldAfter - heldBefore) === cutLamp;
  const ledgerOk = (ledgerAfter - ledgerBefore) === cutLamp;
  const circOk = (circBefore - circAfter) === cutLamp;
  // custodyAfter (plan) phải khớp held thật on-chain.
  const planMatch = (custodyAfter[`${lampPolicy.toLowerCase()}|${lampName.toLowerCase()}`] ?? 0n) === heldAfter;
  // total BẤT BIẾN: circ + held == total trước VÀ sau.
  const totalInvariant = (circAfter + heldAfter) === LAMP_TOTAL_SUPPLY
    && (circBefore + heldBefore) === LAMP_TOTAL_SUPPLY;

  console.log("── Bất biến ──");
  console.log(`value += cut (${cutLamp}):       ${valueOk ? "✅" : "❌"}`);
  console.log(`sổ bucket += cut:               ${ledgerOk ? "✅" : "❌"}`);
  console.log(`circulating −= cut:             ${circOk ? "✅" : "❌"}`);
  console.log(`plan custodyAfter == on-chain:  ${planMatch ? "✅" : "❌"}`);
  console.log(`total bất biến (circ+held):     ${totalInvariant ? "✅" : "❌"}`);

  if (!(valueOk && ledgerOk && circOk && planMatch && totalInvariant)) {
    throw new Error("E2E-001: collect vi phạm bất biến (value/sổ/circulating/total).");
  }
  console.log("\n✅ Collect e2e PASS — LAMP fixed-supply: chuyển circulating→accounting, KHÔNG burn.");
  void pkh;
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
