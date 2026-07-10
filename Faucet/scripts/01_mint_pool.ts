// Faucet/scripts/01_mint_pool.ts — one-shot mint tLAMP + deploy Faucet pool.
//
// Flow:
//   1. Chọn 1 UTxO ví làm genesis (one-shot) → apply tlamp_policy(genesis_ref, total).
//   2. Tính policy id → apply faucet(tlamp_policy_id, tlamp_name).
//   3. buildMintPoolTx: mint TOÀN BỘ supply, consume genesis, gửi hết vào pool UTxO.
//   4. Ghi deployed-faucet.json. SUBMIT=true mới gửi live.
//
// Chạy: tsx 01_mint_pool.ts   (SUBMIT=true tsx 01_mint_pool.ts để gửi thật)

import { buildMintPoolTx, TLAMP_ASSET_NAME, TOTAL_SUPPLY_OIL, CLAIM_AMOUNT_OIL } from "@magiclamp/faucet-sdk";
import {
  NETWORK, makeLucid, rawValidator, applyPolicy, applyValidator, policyId,
  scriptHash, scriptAddress, saveDeployed, explorerTx, SUBMIT,
  type FaucetDeployed,
} from "./config.js";
import { Constr } from "@lucid-evolution/lucid";

async function main(): Promise<void> {
  console.log("=== Faucet Step 1: Mint tLAMP + deploy pool ===\n");

  const lucid = await makeLucid();

  // 1. genesis UTxO (one-shot). Lấy UTxO lớn nhất (đủ ADA cho mint + min-ADA pool).
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.length === 0) throw new Error("ví không có UTxO — chạy 00_preflight.ts trước.");
  const genesis = utxos.reduce((a, b) =>
    (b.assets.lovelace ?? 0n) > (a.assets.lovelace ?? 0n) ? b : a,
  );
  console.log(`Genesis UTxO: ${genesis.txHash}#${genesis.outputIndex} (${(genesis.assets.lovelace ?? 0n) / 1_000_000n} tADA)`);

  // 2. apply tlamp_policy(genesis_ref, total_supply).
  // OutputReference = Constr(0, [transaction_id: ByteArray, output_index: Int])
  // (xem plutus.json definitions — transaction_id là ByteArray TRẦN, không bọc Constr).
  const genesisRefData = new Constr(0, [
    genesis.txHash,                    // transaction_id: bare ByteArray hex
    BigInt(genesis.outputIndex),       // output_index: Int
  ]);
  const rawMint = await rawValidator("tlamp_policy.tlamp_policy.mint");
  const tlampPolicy = applyPolicy(rawMint.compiledCode, [genesisRefData, TOTAL_SUPPLY_OIL]);
  const tlampPolicyId = policyId(tlampPolicy);
  console.log(`tLAMP policy id: ${tlampPolicyId}`);

  // 3. apply faucet(tlamp_policy_id, tlamp_name).
  const rawSpend = await rawValidator("faucet.faucet.spend");
  const faucetScript = applyValidator(rawSpend.compiledCode, [tlampPolicyId, TLAMP_ASSET_NAME]);
  const faucetHash = scriptHash(faucetScript);
  const faucetAddr = scriptAddress(faucetScript);
  console.log(`Faucet hash:    ${faucetHash}`);
  console.log(`Faucet address: ${faucetAddr}\n`);

  // 4. build mint+pool tx.
  const res = await buildMintPoolTx({
    lucid, network: NETWORK,
    tlampPolicy, tlampPolicyId, faucetScript, genesisUtxo: genesis,
  });
  console.log(res.summary, "\n");

  const state: FaucetDeployed = {
    network: NETWORK,
    tlamp: {
      policyId: tlampPolicyId,
      assetName: TLAMP_ASSET_NAME,
      totalSupplyOil: TOTAL_SUPPLY_OIL.toString(),
      genesisRef: { txHash: genesis.txHash, outputIndex: genesis.outputIndex },
    },
    faucet: { hash: faucetHash, address: faucetAddr },
    claimAmountOil: CLAIM_AMOUNT_OIL.toString(),
  };

  if (!SUBMIT) {
    console.log("ℹ️ SUBMIT=false → KHÔNG gửi tx (chỉ build + tính địa chỉ). Ghi state khô.");
    await saveDeployed(state);
    console.log(`✅ Đã ghi deployed-faucet.json. Bật SUBMIT=true để mint thật.`);
    return;
  }

  const signed = await res.tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`✅ Minted + deployed pool! TX: ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await lucid.awaitTx(txHash);

  state.poolUtxo = { txHash, outputIndex: 0 };
  await saveDeployed(state);
  console.log("✅ Đã ghi deployed-faucet.json. Tiếp theo: tsx 02_claim.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
