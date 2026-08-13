// TIGER/scripts/tiger_check.ts
//
// CLI tra 1 địa chỉ: lịch sử stake mọi epoch → lọc epoch stake vào pool TIGER →
// stake mỗi epoch + accStake + (tùy chọn) số LAMP nhận. Mirror UX trang ETD của AffiSo.
// Lõi thuần ở ../offchain/src/check.ts (test-được); file này chỉ fetch Blockfrost.
//
// Chạy:  npx tsx tiger_check.ts <addr|stake_addr> [--cutoff <E>] [--snapshot tiger_snapshot.json]

import { readFileSync } from "node:fs";
import { bf, bfAll, NETWORK, BLOCKFROST_KEY, TIGER_POOL_ID } from "./config.js";
import { analyzeHistory, projectLampFromSnapshot, type HistoryEntry } from "../offchain/src/check.js";
import { parseSnapshotFile, type SnapshotFile } from "../offchain/src/snapshot.js";
import { TIGER_TOTAL_OILDROP, OILDROP_PER_LAMP } from "../offchain/src/constants.js";

function parseArgs(): { addr: string; cutoff: bigint | null; snapshotFile: string | null } {
  const a = process.argv.slice(2);
  let addr = "", cutoff: bigint | null = null, snapshotFile: string | null = null;
  for (let i = 0; i < a.length; i++) {
    const k = a[i]!;
    if (k === "--cutoff") cutoff = BigInt(a[++i]!);
    else if (k === "--snapshot") snapshotFile = a[++i]!;
    else if (!k.startsWith("--")) addr = k;
  }
  if (!addr) { console.error("Cần địa chỉ: tiger_check <addr|stake_addr> [--cutoff E] [--snapshot f]"); process.exit(1); }
  return { addr, cutoff, snapshotFile };
}

/** addr → stake_address (bech32). Nhận sẵn stake_addr, hoặc resolve từ payment addr. */
async function resolveStakeAddr(addr: string): Promise<string> {
  if (addr.startsWith("stake")) return addr;
  const info = await bf<{ stake_address: string | null }>(`/addresses/${addr}`);
  if (!info || !info.stake_address) {
    throw new Error(`Không lấy được stake_address từ ${addr} (địa chỉ không ủy thác?).`);
  }
  return info.stake_address;
}

const fmtLovelace = (n: bigint): string => `${(Number(n) / 1e6).toLocaleString()} ADA`;

async function main(): Promise<void> {
  const { addr, cutoff, snapshotFile } = parseArgs();
  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");

  const stakeAddr = await resolveStakeAddr(addr);
  const history = await bfAll<HistoryEntry>(`/accounts/${stakeAddr}/history`);

  console.log(`\nNetwork:  ${NETWORK}`);
  console.log(`Địa chỉ:  ${addr}`);
  console.log(`Stake:    ${stakeAddr}`);
  console.log(`Pool TIGER: ${TIGER_POOL_ID}`);
  console.log(`Cutoff:   ${cutoff !== null ? `< ${cutoff}` : "(không cắt)"}\n`);

  const { rows, tigerRows, tigerAccStake } = analyzeHistory(history, {
    tigerPoolId: TIGER_POOL_ID, cutoffEpoch: cutoff,
  });

  console.log(`Lịch sử stake (${rows.length} epoch):`);
  for (const r of rows) {
    const tag = r.is_tiger ? "★ TIGER" : "       ";
    console.log(`  epoch ${r.epoch}  ${tag}  ${fmtLovelace(r.stake).padStart(16)}  ${r.pool_id ?? "-"}`);
  }

  console.log(`\nChỉ epoch TIGER${cutoff !== null ? ` (< ${cutoff})` : ""} — ${tigerRows.length} epoch:`);
  for (const r of tigerRows) {
    console.log(`  epoch ${r.epoch}  ${fmtLovelace(r.stake).padStart(16)}`);
  }
  console.log(`  accStake TIGER: ${tigerAccStake.toLocaleString()} lovelace·epoch`);

  if (snapshotFile) {
    const file = JSON.parse(readFileSync(snapshotFile, "utf8")) as SnapshotFile;
    const snap = parseSnapshotFile(file);
    const owner = file.meta.owner_key === "stake_address" ? stakeAddr : stakeAddr; // registry-map ngoài phạm vi CLI
    const proj = projectLampFromSnapshot(snap, owner, TIGER_TOTAL_OILDROP);
    if (proj.amountOildrop !== null) {
      console.log(`\nLAMP sẽ nhận: ${(proj.amountOildrop / OILDROP_PER_LAMP).toLocaleString()} LAMP` +
        `${proj.capped ? " (chạm cap/ví)" : ""}`);
    } else {
      console.log(`\nLAMP sẽ nhận: (owner không có trong snapshot — kiểm tra owner_key/registry)`);
    }
  } else {
    console.log(`\n(Chưa --snapshot: chỉ hiển thị accStake. Số LAMP cần snapshot chốt + entitlements.)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
