// LampDistribution/scripts/05_verify_solvency.ts — Verify SOLVENCY on-chain.
//
// Chạy: npx tsx 05_verify_solvency.ts   (sau genesis / bất kỳ lúc nào trước khi mở Claim)
//
// MAINNET-BLOCK (solvency): Committee cấp entitlement E qua Claim ĐỘC LẬP với số dư
// treasury. Nếu Σ(E − redeemed) > treasury LAMP → quỹ under-collateralized → người
// redeem sau bị kẹt vốn (first-come-first-served). On-chain ĐÃ ép bất biến này
// (treasury.ak C-SOLV-2): sổ cái singleton `outstanding_entitlement` (NFT "TRSY") tăng
// += granted mỗi grant, giảm −= released mỗi redeem, và LUÔN bị ép ≤ treasury pool LAMP.
// Sổ cái ĐÚNG BẰNG Σ(E − redeemed) nên script này và on-chain nói CÙNG một con số —
// đó là điểm của bản vá 2026-08-12: trước đó on-chain đếm TỔNG CẤP lịch sử còn script
// này đếm CÒN NỢ, hai bên lệch nhau vĩnh viễn sau đợt redeem đầu tiên (builder dựng
// được tx mà validator từ chối). Script KHÔNG còn là chốt duy nhất — nó là kiểm tra
// VẬN HÀNH độc lập (defense-in-depth): query treasury + MỌI ClaimAccount, assert
// treasury_lamp ≥ Σ(entitlement − redeemed), VÀ đối chiếu với sổ cái on-chain.
//
// Dùng: (1) chạy + PASS trước khi mở Claim trên mainnet (sanity ngoài on-chain guard);
//        (2) monitor định kỳ; (3) sau mỗi đợt Claim/fund.
//
// Exit code 0 = solvent; 1 = under-collateralized hoặc lỗi.

import { Data } from "@lucid-evolution/lucid";
import { decodeClaimAccountDatum } from "../offchain/src/datum.js";
import { decodeTreasuryDatum } from "../offchain/src/datum.js";
import type { ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";
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
  let ledgerOutstanding: bigint | undefined;
  for (const u of treasuryUtxos) {
    if (!u.datum) continue;
    let td: TreasuryDatum;
    try { td = decodeTreasuryDatum(Data.from(u.datum)); } catch { continue; }
    treasuryLamp += u.assets[lampUnit] ?? 0n;
    treasuryCount += 1;
    // Sổ cái on-chain (treasury là singleton nên chỉ có 1 UTxO mang datum hợp lệ).
    ledgerOutstanding = (ledgerOutstanding ?? 0n) + td.outstanding_entitlement;
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
  console.log(`Treasury UTxOs:     ${treasuryCount}  (LAMP pool ${treasuryLamp} oildrop = ${treasuryLamp / 1_000_000n} LAMP)`);
  console.log(`ClaimAccount UTxOs: ${accCount}`);
  console.log(`Σ(E − redeemed):    ${outstanding} oildrop = ${outstanding / 1_000_000n} LAMP`);
  console.log();

  // ── ĐỐI CHIẾU sổ cái on-chain với tổng đếm được ─────────────
  // Chỉ có nghĩa từ bản vá 2026-08-12 (sổ cái = CÒN NỢ). Lệch ⇒ hoặc script này bỏ sót
  // ClaimAccount, hoặc một tx đã ghi sổ sai — cả hai đều phải dừng trước khi mở Claim.
  if (ledgerOutstanding === undefined) {
    console.error("❌ không tìm thấy treasury UTxO nào mang TreasuryDatum hợp lệ.");
    process.exit(1);
  }
  console.log(`Sổ cái on-chain:    ${ledgerOutstanding} oildrop`);
  if (ledgerOutstanding !== outstanding) {
    console.error(
      `❌ LỆCH SỔ: on-chain ${ledgerOutstanding} oildrop ≠ Σ(E − redeemed) ${outstanding} oildrop ` +
      `(chênh ${ledgerOutstanding - outstanding}). Sổ cái phải BẰNG tổng còn nợ.`,
    );
    process.exit(1);
  }

  const margin = treasuryLamp - outstanding;
  if (margin < 0n) {
    console.error(
      `❌ UNDER-COLLATERALIZED: thiếu ${-margin} oildrop (${-margin / 1_000_000n} LAMP). ` +
      `KHÔNG mở Claim / fund thêm treasury ≥ ${-margin} oildrop.`,
    );
    process.exit(1);
  }
  console.log(`✅ SOLVENT — dư ${margin} oildrop (${margin / 1_000_000n} LAMP). treasury ≥ Σ(E − redeemed).`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
