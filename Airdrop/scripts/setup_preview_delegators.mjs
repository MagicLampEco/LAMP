// setup_preview_delegators.mjs — BOOTSTRAP e2e delegator trên Preview.
// FOUNDATION (đã có tADA) tự delegate + cấp vốn GST_1/GST_2 → GST đăng ký+delegate.
// Đích: cùng pool CNODE đang dùng (pool1500euld…) để gom delegator về 1 pool.
// Chạy: node setup_preview_delegators.mjs   (env từ $AGENT_SECRETS)
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const KEY = process.env.Blockfrost_GreenSun_Preview;
const BASE = "https://cardano-preview.blockfrost.io/api/v0";
const POOL = "pool1500euld27dqfajdjmgv0j44e7sdxlt8uyu5k6takfc6mc5x9jlf";
const FUND = 25_000_000n; // 25 tADA mỗi GST (đủ 2 deposit + phí)

const lucid = await Lucid(new Blockfrost(BASE, KEY), "Preview");
const norm = (s) => s.trim().replace(/\s+/g, " ");

async function addrs(seed) {
  lucid.selectWallet.fromSeed(norm(seed));
  return { address: await lucid.wallet().address(), reward: await lucid.wallet().rewardAddress() };
}
async function isRegistered(reward) {
  const r = await fetch(`${BASE}/accounts/${reward}`, { headers: { project_id: KEY } });
  if (r.status === 404) return false;
  const d = await r.json();
  return d.active === true;
}

const FOUNDATION = await addrs(process.env.FOUNDATION_SEED);
const GST1 = await addrs(process.env.GST_POOL_PUBLICED_SEED_1);
const GST2 = await addrs(process.env.GST_POOL_PUBLICED_SEED_2);
console.log("FOUNDATION", FOUNDATION.address.slice(0, 24) + "…", "reg?", await isRegistered(FOUNDATION.reward));
console.log("GST1", GST1.address.slice(0, 24) + "…");
console.log("GST2", GST2.address.slice(0, 24) + "…");

// ── TX1: FOUNDATION delegate chính nó + cấp vốn GST1, GST2 ──
lucid.selectWallet.fromSeed(norm(process.env.FOUNDATION_SEED));
let tb = lucid.newTx()
  .pay.ToAddress(GST1.address, { lovelace: FUND })
  .pay.ToAddress(GST2.address, { lovelace: FUND });
if (!(await isRegistered(FOUNDATION.reward)))
  tb = tb.registerAndDelegate.ToPool(FOUNDATION.reward, POOL);
const t1 = await tb.complete();
const s1 = await t1.sign.withWallet().complete();
const h1 = await s1.submit();
console.log("\nTX1 (FOUNDATION delegate + fund GST1/GST2):", h1);
await lucid.awaitTx(h1);
console.log("  confirmed ✓");

// ── TX2: GST1 register+delegate ──
lucid.selectWallet.fromSeed(norm(process.env.GST_POOL_PUBLICED_SEED_1));
const t2 = await lucid.newTx().registerAndDelegate.ToPool(GST1.reward, POOL).complete();
const h2 = await (await t2.sign.withWallet().complete()).submit();
console.log("TX2 (GST1 register+delegate):", h2);
await lucid.awaitTx(h2);
console.log("  confirmed ✓");

// ── TX3: GST2 register+delegate ──
lucid.selectWallet.fromSeed(norm(process.env.GST_POOL_PUBLICED_SEED_2));
const t3 = await lucid.newTx().registerAndDelegate.ToPool(GST2.reward, POOL).complete();
const h3 = await (await t3.sign.withWallet().complete()).submit();
console.log("TX3 (GST2 register+delegate):", h3);
await lucid.awaitTx(h3);
console.log("  confirmed ✓");

console.log("\n=== XONG. Delegator vào", POOL, "===");
console.log("FOUNDATION:", FOUNDATION.reward);
console.log("GST1:", GST1.reward);
console.log("GST2:", GST2.reward);
console.log("→ Đủ chuỗi §1.5 (N=2) sau ~2 epoch (Preview ~1 ngày/epoch). CNODE đã đủ sẵn.");
