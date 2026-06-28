import { makeLucid } from "./config.js";
const lucid = await makeLucid();
const addr = await lucid.wallet().address();
const utxos = await lucid.wallet().getUtxos();
let lovelace = 0n; const assets: Record<string,bigint> = {};
for (const u of utxos) { lovelace += (u.assets["lovelace"] ?? 0n);
  for (const [k,v] of Object.entries(u.assets)) if (k!=="lovelace") assets[k]=(assets[k]??0n)+v; }
console.log("ADDR:", addr);
console.log("UTxOs:", utxos.length, "| tADA:", (lovelace/1_000_000n).toString());
console.log("native assets:", Object.keys(assets).length);
