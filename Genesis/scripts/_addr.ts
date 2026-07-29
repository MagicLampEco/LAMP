// Helper tạm: in địa chỉ + pkh của ví (WALLET_SEED từ env) trên NETWORK hiện tại.
// Chỉ in địa chỉ/pkh công khai — KHÔNG in seed.
import { makeLucid, walletPkh, NETWORK } from "./config.js";
const lucid = await makeLucid();
const addr = await lucid.wallet().address();
const pkh = await walletPkh(lucid);
console.log(`NETWORK=${NETWORK}`);
console.log(`ADDRESS=${addr}`);
console.log(`PKH=${pkh}`);
