// LampDistribution/scripts/05_verify_solvency.ts — Verify SOLVENCY on-chain.
//
// Chạy: npx tsx 05_verify_solvency.ts   (sau genesis / bất kỳ lúc nào trước khi mở Claim)
//
// MAINNET-BLOCK (solvency): Committee cấp entitlement E qua Claim ĐỘC LẬP với số dư
// treasury. Nếu Σ(E − redeemed) > treasury LAMP → quỹ under-collateralized → người
// redeem sau bị kẹt vốn (first-come-first-served). On-chain ĐÃ ép bất biến này
// (treasury.ak C-SOLV-2): mỗi GrantEntitlement buộc cumulative_entitlement += amount và
// cumulative_entitlement ≤ treasury pool LAMP, qua sổ cái singleton NFT "TRSY". Vì
// redeemed ≤ entitlement luôn đúng → Σ(E − redeemed) ≤ cum ≤ pool. Script này KHÔNG
// còn là chốt duy nhất — nó là kiểm tra VẬN HÀNH độc lập (defense-in-depth):
// query treasury + MỌI ClaimAccount, assert treasury_lamp ≥ Σ(entitlement − redeemed).
//
// Dùng: (1) chạy + PASS trước khi mở Claim trên mainnet (sanity ngoài on-chain guard);
//        (2) monitor định kỳ; (3) sau mỗi đợt Claim/fund.
//
// Exit code 0 = solvent; 1 = under-collateralized hoặc lỗi.

import { Data } from "@lucid-evolution/lucid";
import { decodeClaimAccountDatum } from "../offchain/src/datum.js";
import { decodeTreasuryDatum } from "../offchain/src/datum.js";
import type { ClaimAccountDatum } from "../offchain/src/types.js";
import { NETWORK, makeLucid, loadDeployed, toUnit } from "./config.js";

async function main(): Promise<void> {
  console.log("=== LampDistribution: Verify Solvency (on-chain) ===\n");

  const state = await loadDeployed();
  if (!state.testLamp) throw new Error("thiếu testLamp trong deployed.json (lamp policy/name).");
  const lucid = await makeLucid();
  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);

  // ── Treasury LAMP pool ──────────────────────────────────────
  const treasuryUtxos = await lucid.utxosAt(state.treasury.address);
  let treasuryLamp = 0n;
  let treasuryCount = 0;
  for (const u of treasuryUtxos) {
    if (!u.datum) continue;
    try { decodeTreasuryDatum(Data.from(u.datum)); } catch { continue; }
    treasuryLamp += u.assets[lampUnit] ?? 0n;
    treasuryCount += 1;
  }

  // ── Σ(entitlement − redeemed) trên MỌI ClaimAccount ─────────
  const accountUtxos = await lucid.utxosAt(state.claimAccount.address);
  let outstanding = 0n;
  let accCount = 0;
  for (const u of accountUtxos) {
    if (!u.datum) continue;
    let d: ClaimAccountDatum;
    try { d = decodeClaimAccountDatum(Data.from(u.datum)); } catch { continue; }
    const acc = d.entitlement - d.redeemed;
    if (acc > 0n) outstanding += acc;
    accCount += 1;
  }

  console.log(`Network:            ${NETWORK}`);
  console.log(`Treasury UTxOs:     ${treasuryCount}  (LAMP pool ${treasuryLamp} oil = ${treasuryLamp / 1_000_000n} LAMP)`);
  console.log(`ClaimAccount UTxOs: ${accCount}`);
  console.log(`Σ(E − redeemed):    ${outstanding} oil = ${outstanding / 1_000_000n} LAMP`);
  console.log();

  const margin = treasuryLamp - outstanding;
  if (margin < 0n) {
    console.error(
      `❌ UNDER-COLLATERALIZED: thiếu ${-margin} oil (${-margin / 1_000_000n} LAMP). ` +
      `KHÔNG mở Claim / fund thêm treasury ≥ ${-margin} oil.`,
    );
    process.exit(1);
  }
  console.log(`✅ SOLVENT — dư ${margin} oil (${margin / 1_000_000n} LAMP). treasury ≥ Σ(E − redeemed).`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
