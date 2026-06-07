// Pre-flight: kiểm env load + ví select được + số dư tADA, TRƯỚC khi deploy custody.
// KHÔNG submit tx. Chạy: npx tsx 00_preflight.ts
//
// LƯU Ý: cần .env (BLOCKFROST_KEY + PRIVATE_KEY|WALLET_SEED). Nếu chưa có, script
// in lỗi rõ — đây là điểm kiểm tra TRƯỚC mọi bước live.

import { makeLucid, NETWORK, LAMP_TOTAL_SUPPLY } from "./config.js";

async function main(): Promise<void> {
  console.log("── Pre-flight Treasury ──");
  console.log("Network          :", NETWORK);
  console.log("LAMP total supply:", LAMP_TOTAL_SUPPLY, "oil (36 tỷ × 10^6 — fixed)");

  const lucid = await makeLucid();
  const addr = await lucid.wallet().address();
  const utxos = await lucid.wallet().getUtxos();
  let lovelace = 0n;
  for (const u of utxos) lovelace += u.assets["lovelace"] ?? 0n;

  console.log("Wallet address   :", addr);
  console.log("UTxO count       :", utxos.length);
  console.log("Balance          :", (Number(lovelace) / 1e6).toFixed(6), "tADA");

  if (lovelace < 30_000_000n) {
    console.log("\n⚠️  Số dư < 30 tADA — nạp thêm qua faucet Preview trước khi deploy:");
    console.log("   https://docs.cardano.org/cardano-testnets/tools/faucet");
  } else {
    console.log("\n✅ Đủ tADA để deploy custody + collect e2e.");
  }
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
