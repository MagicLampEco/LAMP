// check_airdrop.ts — CLI kiểm tra tư cách nhận LAMP Airdrop cho delegator/SPO.
//
// Dùng:
//   # Kiểm tra địa chỉ stake trong snapshot đã build:
//   npx tsx check_airdrop.ts --snapshot snapshot.json --addr stake1...
//
//   # Kiểm tra trực tiếp từ Blockfrost (không cần snapshot):
//   npx tsx check_airdrop.ts --live --epoch 580 --addr stake1...
//
//   # Liệt kê top N người nhận nhiều nhất:
//   npx tsx check_airdrop.ts --snapshot snapshot.json --top 20
//
//   # Tổng kết toàn bộ snapshot:
//   npx tsx check_airdrop.ts --snapshot snapshot.json --summary

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bf, bfAll, BLOCKFROST_KEY, NETWORK } from "./config.js";
import type { SnapshotOutput, SnapshotRow } from "./build_airdrop_snapshot.js";

const OILDROP_PER_LAMP = 1_000_000n;

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(): {
  snapshotFile: string | null;
  addr: string | null;
  top: number | null;
  summary: boolean;
  live: boolean;
  epoch: bigint | null;
  pool: string;
} {
  const args = process.argv.slice(2);
  let snapshotFile: string | null = null;
  let addr: string | null = null;
  let top: number | null = null;
  let summary = false;
  let live = false;
  let epoch: bigint | null = null;
  let pool = process.env.TIGER_POOL_ID ?? "pool1xs2yx67vxuygadnjflj5u5dv6cqf6t0u6jke9z9jzj2svfuxmqq";

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "--snapshot" || a === "-s") && args[i + 1])
      snapshotFile = resolve(process.cwd(), args[++i]!);
    else if ((a === "--addr" || a === "-a") && args[i + 1])
      addr = args[++i]!;
    else if (a === "--top" && args[i + 1])
      top = parseInt(args[++i]!, 10);
    else if (a === "--summary") summary = true;
    else if (a === "--live") live = true;
    else if ((a === "--epoch" || a === "-e") && args[i + 1])
      epoch = BigInt(args[++i]!);
    else if (a === "--pool" && args[i + 1])
      pool = args[++i]!;
    else if (a === "--help" || a === "-h") {
      console.log(`
Dùng:
  Kiểm tra trong snapshot:
    npx tsx check_airdrop.ts --snapshot snapshot.json --addr stake1...
    npx tsx check_airdrop.ts --snapshot snapshot.json --top 20
    npx tsx check_airdrop.ts --snapshot snapshot.json --summary

  Kiểm tra trực tiếp Blockfrost (không cần snapshot):
    npx tsx check_airdrop.ts --live --epoch 580 --addr stake1...
`);
      process.exit(0);
    }
  }

  return { snapshotFile, addr, top, summary, live, epoch, pool };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtLamp(lamp: bigint | string): string {
  const n = typeof lamp === "string" ? BigInt(lamp) : lamp;
  const whole = n / OILDROP_PER_LAMP;
  return `${whole.toLocaleString()} LAMP (${n.toLocaleString()} oildrop)`;
}

function fmtLovelace(lovelace: string): string {
  const n = BigInt(lovelace);
  const ada = n / 1_000_000n;
  return `${ada.toLocaleString()} ADA`;
}

// ── Snapshot mode ──────────────────────────────────────────────────────────

async function checkInSnapshot(
  snapshotFile: string,
  addr: string | null,
  top: number | null,
  summary: boolean,
): Promise<void> {
  const raw = await readFile(snapshotFile, "utf8");
  const snap = JSON.parse(raw) as SnapshotOutput;

  if (summary || (!addr && !top)) {
    const m = snap.meta;
    const total = snap.entries.reduce((s, e) => s + BigInt(e.amount_lamp), 0n);
    console.log("=== Tóm tắt snapshot ===");
    console.log(`  Network:        ${m.network}`);
    console.log(`  Pool:           ${m.pool_id}`);
    console.log(`  Epochs:         [${m.epochs.join(", ")}]`);
    console.log(`  Delegators:     ${m.total_delegators}`);
    console.log(`  Budget:         ${BigInt(m.budget_lamp).toLocaleString()} LAMP`);
    console.log(`  Phân bổ thực:   ${total.toLocaleString()} LAMP`);
    console.log(`  Loại < 1 LAMP:  ${m.excluded_below_min}`);
    console.log(`  Tạo lúc epoch:  ${m.generated_at_epoch}`);
    console.log(`  Lưu ý:         ${m.note_spo_share}`);
    if (snap.entries.length > 0) {
      console.log();
      console.log("Top 5 người nhận:");
      for (const e of snap.entries.slice(0, 5)) {
        console.log(`  ${e.address.slice(0, 20)}… → ${BigInt(e.amount_lamp).toLocaleString()} LAMP`);
      }
    }
    return;
  }

  if (top !== null) {
    console.log(`Top ${top} người nhận LAMP:`);
    for (const e of snap.entries.slice(0, top)) {
      console.log(
        `  ${e.address}  ${BigInt(e.amount_lamp).toLocaleString().padStart(14)} LAMP  (${fmtLovelace(e.cumulative_lovelace)}, ${e.stake_epochs} epoch)`,
      );
    }
    return;
  }

  if (addr) {
    const entry = snap.entries.find(
      (e) => e.address === addr || e.address.toLowerCase() === addr.toLowerCase(),
    );
    if (!entry) {
      console.log(`Không tìm thấy "${addr}" trong snapshot.`);
      console.log(`Địa chỉ này có thể không delegate tới pool trong các epoch: [${snap.meta.epochs.join(", ")}]`);
      return;
    }
    console.log("=== Kết quả ===");
    console.log(`  Địa chỉ:          ${entry.address}`);
    console.log(`  Nhận:             ${fmtLamp(entry.amount_lamp)}`);
    console.log(`  Stake tích lũy:   ${fmtLovelace(entry.cumulative_lovelace)}`);
    console.log(`  Số epoch có mặt:  ${entry.stake_epochs} / ${snap.meta.epochs.length}`);
    console.log(`  Eligible:         CÓ`);
  }
}

// ── Live Blockfrost mode ───────────────────────────────────────────────────

interface EpochStakeEntry {
  stake_address: string;
  amount: string;
}

interface AccountInfo {
  stake_address: string;
  active: boolean;
  active_epoch?: number;
  controlled_amount?: string;
  pool_id?: string;
}

async function checkLive(addr: string, epoch: bigint | null, pool: string): Promise<void> {
  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY");

  console.log(`Network:  ${NETWORK}`);
  console.log(`Addr:     ${addr}`);
  console.log();

  // Lấy thông tin tài khoản stake
  const accInfo = await bf<AccountInfo>(`/accounts/${addr}`);
  if (!accInfo || typeof accInfo !== "object" || !("stake_address" in accInfo)) {
    console.log("Địa chỉ không tồn tại hoặc không phải stake address.");
    return;
  }

  console.log("=== Thông tin tài khoản ===");
  console.log(`  Active:        ${accInfo.active}`);
  console.log(`  Active epoch:  ${accInfo.active_epoch ?? "n/a"}`);
  console.log(`  Pool hiện tại: ${accInfo.pool_id ?? "không delegate"}`);
  console.log(`  Controlled:    ${fmtLovelace(accInfo.controlled_amount ?? "0")}`);
  console.log();

  if (epoch !== null) {
    // Kiểm tra tại epoch cụ thể
    console.log(`Kiểm tra tại epoch ${epoch}...`);
    const rows = await bfAll<EpochStakeEntry>(`/epochs/${epoch}/stakes?pool_id=${pool}`);
    const match = rows.find((r) => r.stake_address === addr);
    if (match) {
      console.log(`  CÓ trong epoch ${epoch}: ${fmtLovelace(match.amount)}`);
    } else {
      console.log(`  KHÔNG trong epoch ${epoch} tại pool ${pool.slice(0, 20)}...`);
    }
    console.log();
  }

  // Lịch sử epoch của tài khoản
  interface AccountHistory {
    active_epoch: number;
    amount: string;
    pool_id: string;
  }
  const history = await bfAll<AccountHistory>(`/accounts/${addr}/history`);
  const tigerEpochs = history.filter((h) => h.pool_id === pool);
  if (tigerEpochs.length > 0) {
    console.log(`=== Epoch delegate tới pool ${pool.slice(0, 20)}... ===`);
    for (const h of tigerEpochs.slice(-10)) {
      console.log(`  Epoch ${h.active_epoch}: ${fmtLovelace(h.amount)}`);
    }
    if (tigerEpochs.length > 10) console.log(`  ... (${tigerEpochs.length} epoch tổng)`);
  } else {
    console.log("Tài khoản này CHƯA từng delegate tới pool TIGER.");
    console.log("Không đủ điều kiện nhận LAMP Airdrop từ pool này.");
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { snapshotFile, addr, top, summary, live, epoch, pool } = parseArgs();

  if (live) {
    if (!addr) {
      console.error("--live yêu cầu --addr <stake_address>");
      process.exit(1);
    }
    await checkLive(addr, epoch, pool);
    return;
  }

  if (!snapshotFile) {
    console.error("Cần --snapshot <file> hoặc --live. Chạy --help để xem.");
    process.exit(1);
  }

  await checkInSnapshot(snapshotFile, addr, top, summary);
}

main().catch((e) => {
  console.error("LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
