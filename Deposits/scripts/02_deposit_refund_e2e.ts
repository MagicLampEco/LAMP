// Deposits Step 2: E2E deposit → refund (Preview).
//
// Chạy: npx tsx 02_deposit_refund_e2e.ts   (sau 01_deploy_pot, SUBMIT=true)
//   SUBMIT=false (mặc định): plan deposit + refund (tự kiểm bất biến), KHÔNG submit.
//
// Flow:
//   1. Đọc deployed.json (pot UTxO genesis).
//   2. DEPOSIT: ví deploy cọc 1 LAMP cho entity demo → pot +1 LAMP, sổ +1 dòng.
//   3. REFUND: ví deploy (= depositor) rút lại cọc → pot −1 LAMP, sổ xóa dòng.
//   Mỗi bước builder tự kiểm bất biến onchain trước khi dựng tx (fail-fast).

import {
  NETWORK, SUBMIT, makeLucid, walletPkh, rawValidator, depositsValidator,
  loadDeployed, awaitTx, explorerTx,
} from "./config.js";
import { buildDepositTx, buildRefundTx } from "../offchain/src/builder.js";
import { potDatumFromCbor } from "../offchain/src/datum.js";
import type { UTxO } from "@lucid-evolution/lucid";

const ENTITY_ID = (process.env.ENTITY_ID ?? "e1deadbeef").trim();
const DEPOSIT_AMOUNT = BigInt(process.env.DEPOSIT_AMOUNT ?? "1000000"); // 1 LAMP = 10^6 oil

async function main(): Promise<void> {
  console.log("=== Deposits Step 2: deposit → refund E2E ===\n");

  const state = await loadDeployed().catch(() => null);
  if (!state) {
    console.log("ℹ️  chưa có deployed.json — chạy 01_deploy_pot.ts (SUBMIT=true) trước.");
    if (!SUBMIT) { console.log("    (build-mode SUBMIT=false: bỏ qua, không cần state)"); return; }
    return;
  }
  if (!state.lamp) { console.log("ℹ️  deployed.json không có LAMP policy — cấp LAMP_POLICY_ID để test bond LAMP."); }

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const raw = await rawValidator("deposits.deposits.spend");
  const potScript = depositsValidator(raw.compiledCode);

  const policy = state.lamp?.policyId ?? "";
  const name = state.lamp?.assetName ?? "";

  // pot UTxO hiện tại.
  let potUtxos = await lucid.utxosAt(state.pot.address);
  let potUtxo: UTxO | undefined = state.genesis
    ? potUtxos.find((u) => u.txHash === state.genesis!.potUtxo.txHash && u.outputIndex === state.genesis!.potUtxo.outputIndex)
    : potUtxos[0];
  if (!potUtxo) throw new Error("E2E-001: không tìm thấy pot UTxO — kiểm tra deployed.json");

  // ── 1. DEPOSIT ──
  console.log("── DEPOSIT ──");
  const dep = await buildDepositTx({
    lucid, network: NETWORK, potUtxo, potScript,
    entityId: ENTITY_ID, depositor: pkh, policy, name, amount: DEPOSIT_AMOUNT,
  });
  console.log(dep.summary);

  if (!SUBMIT) {
    console.log("\nℹ️  SUBMIT=false — deposit dựng tx + tự kiểm bất biến OK, KHÔNG submit.");
  } else {
    const sDep = await dep.tx.sign.withWallet().complete();
    const hDep = await sDep.submit();
    console.log(`   TX: ${hDep}  ${explorerTx(hDep)}`);
    await awaitTx(lucid, hDep, "deposit");
    potUtxos = await lucid.utxosAt(state.pot.address);
    potUtxo = potUtxos.find((u) => u.txHash === hDep);
    if (!potUtxo) throw new Error("E2E-002: không tìm thấy pot UTxO sau deposit");
  }

  // ── 2. REFUND (depositor tự rút) ──
  console.log("\n── REFUND ──");
  if (!SUBMIT) {
    // build-mode: dựng refund từ datum đã plan (mô phỏng pot sau deposit).
    console.log("ℹ️  SUBMIT=false — refund plan mô phỏng từ datum sau deposit:");
    console.log(`    sổ sau deposit: dòng (entity=${ENTITY_ID}, depositor=${pkh}, amount=${DEPOSIT_AMOUNT})`);
    console.log("    refund sẽ xóa dòng + trả về depositor (kiểm bất biến ở vitest).");
    return;
  }

  const ref = await buildRefundTx({
    lucid, network: NETWORK, potUtxo, potScript,
    entityId: ENTITY_ID, depositor: pkh, policy, name, signerPkh: pkh,
  });
  console.log(ref.summary);
  const sRef = await ref.tx.sign.withWallet().complete();
  const hRef = await sRef.submit();
  console.log(`   TX: ${hRef}  ${explorerTx(hRef)}`);
  await awaitTx(lucid, hRef, "refund");

  console.log("\n✅ E2E deposit → refund hoàn tất.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
