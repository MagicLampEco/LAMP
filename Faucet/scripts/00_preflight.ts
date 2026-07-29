// Faucet/scripts/00_preflight.ts — kiểm tra môi trường trước deploy.
//
// Verify: .env có key + seed, Lucid kết nối Blockfrost, ví đủ tADA, plutus.json
// có 2 validator. KHÔNG build/submit tx. Chạy: tsx 00_preflight.ts

import {
  NETWORK, BLOCKFROST_URL, makeLucid, walletPkh, rawValidator, SUBMIT,
} from "./config.js";

async function main(): Promise<void> {
  console.log("=== Faucet Step 0: Preflight ===\n");
  console.log(`Network:    ${NETWORK}`);
  console.log(`Blockfrost: ${BLOCKFROST_URL}`);
  console.log(`SUBMIT:     ${SUBMIT} (false = chỉ build, không gửi tx live)\n`);

  // blueprint có đủ validator?
  const mint = await rawValidator("tlamp_policy.tlamp_policy.mint");
  const spend = await rawValidator("faucet.faucet.spend");
  console.log(`✓ tlamp_policy.mint  hash=${mint.hash.slice(0, 16)}…`);
  console.log(`✓ faucet.spend       hash=${spend.hash.slice(0, 16)}…\n`);

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const addr = await lucid.wallet().address();
  const utxos = await lucid.wallet().getUtxos();
  const balance = utxos.reduce((s, u) => s + (u.assets.lovelace ?? 0n), 0n);

  console.log(`Wallet addr: ${addr}`);
  console.log(`Wallet PKH:  ${pkh}`);
  console.log(`UTxOs:       ${utxos.length}`);
  console.log(`Balance:     ${balance / 1_000_000n} tADA`);

  if (balance < 10_000_000n) {
    throw new Error("cần ≥ 10 tADA — lấy từ https://docs.cardano.org/cardano-testnet/tools/faucet");
  }
  if (utxos.length === 0) {
    throw new Error("ví không có UTxO nào để làm genesis one-shot.");
  }

  console.log("\n✅ Preflight OK. Tiếp theo: tsx 01_mint_pool.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
