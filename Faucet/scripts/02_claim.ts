// Faucet/scripts/02_claim.ts — dev claim 100 tLAMP từ pool (e2e).
//
// Đọc deployed-faucet.json, resolve pool UTxO, build claim tx (nhả 100 tLAMP cho
// ví đang chọn). SUBMIT=true mới gửi live. Chạy: tsx 02_claim.ts

import { buildClaimTx } from "@magiclamp/faucet-sdk";
import {
  NETWORK, makeLucid, applyValidator, rawValidator, scriptAddress, scriptHash,
  loadDeployed, explorerTx, SUBMIT,
} from "./config.js";

async function main(): Promise<void> {
  console.log("=== Faucet Step 2: Claim 100 tLAMP (e2e) ===\n");

  const state = await loadDeployed();
  const lucid = await makeLucid();

  // re-apply faucet validator từ state (deterministic) + verify hash khớp.
  const rawSpend = await rawValidator("faucet.faucet.spend");
  const faucetScript = applyValidator(rawSpend.compiledCode, [
    state.tlamp.policyId, state.tlamp.assetName,
  ]);
  if (scriptHash(faucetScript) !== state.faucet.hash) {
    throw new Error(`faucet hash desync: ${scriptHash(faucetScript)} ≠ ${state.faucet.hash}`);
  }
  const faucetAddr = scriptAddress(faucetScript);
  console.log(`Faucet address: ${faucetAddr}`);
  console.log(`tLAMP policy:   ${state.tlamp.policyId}\n`);

  // resolve pool UTxO: LUÔN quét địa chỉ faucet, KHÔNG đọc state.poolUtxo — faucet nhả theo
  // lượt nên UTxO đã lưu hết hạn ngay sau lượt claim đầu tiên.
  const poolUtxos = await lucid.utxosAt(faucetAddr);
  if (poolUtxos.length === 0) {
    throw new Error(`pool trống tại ${faucetAddr} — chạy 01_mint_pool.ts (SUBMIT=true) trước.`);
  }
  const tlampUnit = state.tlamp.policyId + state.tlamp.assetName;
  const pool = poolUtxos.reduce((a, b) =>
    (b.assets[tlampUnit] ?? 0n) > (a.assets[tlampUnit] ?? 0n) ? b : a,
  );
  console.log(`Pool UTxO: ${pool.txHash}#${pool.outputIndex} (${(pool.assets[tlampUnit] ?? 0n) / 1_000_000n} tLAMP)\n`);

  const res = await buildClaimTx({
    lucid, network: NETWORK, poolUtxo: pool, faucetScript,
    tlampPolicyId: state.tlamp.policyId, tlampAssetName: state.tlamp.assetName,
  });
  console.log(res.summary, "\n");

  if (!SUBMIT) {
    console.log("ℹ️ SUBMIT=false → KHÔNG gửi tx (chỉ build). Bật SUBMIT=true để claim thật.");
    return;
  }

  const signed = await res.tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`✅ Claimed 100 tLAMP! TX: ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await lucid.awaitTx(txHash);
  console.log("✅ Done. Pool đã giảm 100 tLAMP; ví nhận 100 tLAMP.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
