// Genesis/scripts/mint_release_plan.ts — SCAFFOLD DRY-RUN (KHÔNG dựng/submit tx thật).
//
// Vạch KẾ HOẠCH luồng mint-more → kho → release → pot cho 3 đợt launch (ETD/Airdrop/SRCL)
// trên MAINNET. Chạy: `npx tsx mint_release_plan.ts [deltaLAMP]` — CHỈ IN, không ký, không mint.
//
// ⚠️ ĐÂY LÀ SCAFFOLD để Tuân hoàn thiện + chạy VỚI KHOÁ. Script này CỐ TÌNH không import
//    ví/seed/Lucid — không thể mint thật kể cả khi chạy. Muốn mint: cần bổ sung (a→c) dưới.
//
// Đơn vị: 1 LAMP = 10⁶ oildrop, BigInt tuyệt đối.

import { encodeSupplyState, decodeSupplyState } from "../offchain/src/supply_state.js";
import type { SupplyState } from "../offchain/src/types.js";

// ── Hằng MAINNET (ĐÃ XÁC MINH — tx genesis db0610c2…, verify_mainnet_supply.ts) ──

const OILDROP = 1_000_000n; // 1 LAMP = 10⁶ oildrop

/** Policy LAMP canonical mainnet (cap-36B lazy-mint, PlutusV3). */
const LAMP_POLICY = "55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0";
const LAMP_NAME = "4c414d50"; // "LAMP"

/** supply_state script (giữ NFT "SUPPLY" + datum 4-field). */
const SUPPLY_STATE_ADDR = "addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3";
const SUPPLY_STATE_HASH = "84f6d84f64468d0b201171ec10c22fd1124ec3fd803e853697b34084";
const SUPPLY_NFT_NAME = "535550504c59"; // "SUPPLY"

/** KHO dist_treasury (A-DEST: Δ mint DistributionVest BẮT BUỘC chảy vào đây). */
const KHO_ADDR = "addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu";
const KHO_HASH = "d5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6";

/** Datum supply_state ĐÃ XÁC MINH trên mainnet (dùng làm điểm xuất phát kế hoạch). */
const MAINNET_SUPPLY_STATE_CBOR =
  "d8799f1b000000e8d4a51000001b005daf6012ba20001b0022366f192fe000ff";

const fmtLamp = (oildrop: bigint) => (oildrop / OILDROP).toLocaleString("en-US") + " LAMP";

// ── Kế hoạch DistributionVest ────────────────────────────────────────────

export interface VestPlan {
  route: "DistributionVest";
  deltaOildrop: bigint;
  prev: SupplyState;
  next: SupplyState;
  prevCbor: string;
  nextCbor: string;
}

/**
 * Tính datum supply_state MỚI sau khi mint `deltaLampOildrop` oildrop qua DistributionVest.
 * Kiểm dist_minted' ≤ dist_cap (fail-fast). CHỈ tính + trả kế hoạch — KHÔNG dựng tx.
 *
 * @param deltaLampOildrop Δ mint (oildrop). VD 12M LAMP = 12_000_000n * OILDROP.
 * @param fromCbor     datum supply_state hiện tại (mặc định: đã xác minh mainnet).
 */
export function planDistributionVest(
  deltaLampOildrop: bigint,
  fromCbor: string = MAINNET_SUPPLY_STATE_CBOR,
): VestPlan {
  if (deltaLampOildrop <= 0n) throw new Error("PLAN-001: Δ phải > 0 (lazy-mint không burn/no-op)");
  const prev = decodeSupplyState(fromCbor);
  const nextDist = prev.dist_minted + deltaLampOildrop;
  if (nextDist > prev.dist_cap) {
    throw new Error(
      `PLAN-010: vượt dist_cap — dist_minted' ${nextDist} > cap ${prev.dist_cap} ` +
      `(headroom ${fmtLamp(prev.dist_cap - prev.dist_minted)})`,
    );
  }
  const next: SupplyState = { ...prev, dist_minted: nextDist };
  return {
    route: "DistributionVest",
    deltaOildrop: deltaLampOildrop,
    prev, next,
    prevCbor: encodeSupplyState(prev),
    nextCbor: encodeSupplyState(next),
  };
}

/** In kế hoạch 1 bước vest (datum cũ→mới, Δ, A-DEST, redeemer, authority). */
export function printVestPlan(p: VestPlan, label: string): void {
  console.log(`\n── ${label} ─────────────────────────────────────────────`);
  console.log(`  route            : ${p.route}`);
  console.log(`  Δ mint           : ${fmtLamp(p.deltaOildrop)}  (${p.deltaOildrop} oildrop)`);
  console.log(`  supply_state IN  : dist_minted=${fmtLamp(p.prev.dist_minted)}`);
  console.log(`  supply_state OUT : dist_minted=${fmtLamp(p.next.dist_minted)}`);
  console.log(`  headroom sau     : ${fmtLamp(p.next.dist_cap - p.next.dist_minted)}`);
  console.log(`  datum CŨ  (cbor) : ${p.prevCbor}`);
  console.log(`  datum MỚI (cbor) : ${p.nextCbor}`);
  console.log(`  A-DEST           : Δ = ${fmtLamp(p.deltaOildrop)} PHẢI chảy vào KHO`);
  console.log(`                     ${KHO_ADDR}`);
  console.log(`                     (hash ${KHO_HASH}) — nếu ra ví ⇒ validator reject.`);
  console.log(`  redeemer mint    : DistributionVest = Constr(0, [])`);
  console.log(`  redeemer spend   : Advance          = Constr(0, [])  (spend supply_state)`);
  console.log(`  authority ký     : theo registry WHO-gate (token_tag) của lamp_mint — CẦN KHOÁ`);
}

// ── Main (dry-run) ────────────────────────────────────────────────────────

function main() {
  const argLamp = process.argv[2] ? BigInt(process.argv[2]) : null;

  console.log("═".repeat(66));
  console.log("KẾ HOẠCH MINT→KHO→RELEASE→POT — SCAFFOLD DRY-RUN (KHÔNG mint thật)");
  console.log("═".repeat(66));
  console.log(`\nLAMP policy       : ${LAMP_POLICY}`);
  console.log(`LAMP asset name   : ${LAMP_NAME} ("LAMP")`);
  console.log(`supply_state addr : ${SUPPLY_STATE_ADDR}`);
  console.log(`supply_state hash : ${SUPPLY_STATE_HASH}  (NFT ${SUPPLY_NFT_NAME} "SUPPLY")`);
  console.log(`KHO (A-DEST) addr : ${KHO_ADDR}`);
  console.log(`KHO hash          : ${KHO_HASH}`);

  const prev = decodeSupplyState(MAINNET_SUPPLY_STATE_CBOR);
  console.log(`\nsupply_state hiện tại (đã xác minh mainnet):`);
  console.log(`  dist_minted=${fmtLamp(prev.dist_minted)}  reserve_minted=${fmtLamp(prev.reserve_minted)}`);
  console.log(`  dist_cap=${fmtLamp(prev.dist_cap)}  reserve_cap=${fmtLamp(prev.reserve_cap)}`);
  console.log(`  headroom distribution = ${fmtLamp(prev.dist_cap - prev.dist_minted)}`);

  // 3 đợt launch — thứ tự mint 513M LAMP < headroom 26,369B.
  const tranches: Array<[string, bigint]> = [
    ["ETD (Early TIGER Delegator)", 12_000_000n * OILDROP],
    ["Airdrop-v2 (delegator+SPO+CS)", 120_000_000n * OILDROP],
    ["SRCL (staking-reward → LAMP)", 381_000_000n * OILDROP],
  ];

  if (argLamp !== null) {
    printVestPlan(planDistributionVest(argLamp * OILDROP), `Δ tuỳ chọn = ${argLamp} LAMP`);
  } else {
    // Kế hoạch tuần tự: mỗi đợt vest tiếp nối datum của đợt trước.
    let cursor = MAINNET_SUPPLY_STATE_CBOR;
    let totalOildrop = 0n;
    for (const [name, delta] of tranches) {
      const p = planDistributionVest(delta, cursor);
      printVestPlan(p, name);
      cursor = p.nextCbor;
      totalOildrop += delta;
    }
    console.log(`\n  TỔNG 3 đợt: ${fmtLamp(totalOildrop)} < headroom ${fmtLamp(prev.dist_cap - prev.dist_minted)}  ⇒ ĐỦ ✓`);
  }

  console.log("\n" + "─".repeat(66));
  console.log("ĐỂ MINT THẬT (Tuân hoàn thiện), builder cần bổ sung:");
  console.log("  (a) reference script CBOR:");
  console.log("      • lamp_mint (đã deploy mainnet) — lấy qua koios /script_info?_script_hashes");
  console.log(`        (policy ${LAMP_POLICY} = script hash lamp_mint apply-param).`);
  console.log("      • supply_state spend validator (giữ SupplyState) — koios /script_info.");
  console.log("  (b) KHOÁ authority WHO-gate registry — Tuân/anh giữ; script NÀY KHÔNG chứa khoá.");
  console.log("      Ký để mint = authority trong registry entry (controller OrgDID/MultiSig 2/3),");
  console.log("      KHÔNG phải khoá riêng của LAMP policy.");
  console.log("  (c) registry UTxO nếu WHO-gate qua registry NFT: tx genesis KHÔNG lộ registry NFT");
  console.log("      ⇒ cần Tuân xác nhận cơ chế WHO THẬT của lamp_mint đã deploy (bootstrap");
  console.log("      authority-sig [pkh]/[MultiSig] hay reference registry NFT). Xem HANDOFF §2.");
  console.log("\nLuồng tx mint thật (Tuân dựng, tham chiếu mintBuilder.ts + 03_mint_more.ts):");
  console.log("  spend supply_state(Advance) + mint Δ LAMP(DistributionVest) →");
  console.log("  recreate supply_state' (datum MỚI ở trên) + Δ LAMP vào KHO (A-DEST) + ký authority.");
  console.log("Release kho→pot: tx riêng SPEND kho (dist_treasury redeemer) rót LAMP vào pot từng đợt.");
  console.log("═".repeat(66));
  console.log("DRY-RUN xong. KHÔNG tx nào được dựng/submit.");
}

main();
