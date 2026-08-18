// ⚠️ DEPRECATED (2026-07-30) — KHÔNG dùng cho pot Delegator.
//   Bản v1 này dựng leaf từ stake_address (claim KHÔNG trả được — lỗ #1), chỉ 1 pool
//   (--pool — lỗ #2), và THIẾU ràng buộc giữ ≥N epoch liên tiếp (§1.5). Thay bằng:
//       build_delegator_snapshot.ts  (v2: join stake→payment, đa pool, §1.5)
//   Giữ lại chỉ để tham chiếu lịch sử. Không chạy cho phân phối thật.
//
// build_airdrop_snapshot.ts — Snapshot builder cho TIGER Airdrop.
//
// Lấy danh sách delegator TIGER pool tại epoch snapshot từ Blockfrost,
// tính phần LAMP tỉ lệ theo tổng stake-epoch tích lũy qua các epoch được
// chỉ định, xuất JSON cho snapshotTool.buildSnapshotTree().
//
// Dùng:
//   npx tsx build_airdrop_snapshot.ts --epoch <E> [--epoch <E2> ...]
//   npx tsx build_airdrop_snapshot.ts --epoch 580 --epoch 581 --epoch 582
//   npx tsx build_airdrop_snapshot.ts --epoch 580 --pool pool1abc... --out snapshot.json
//
// Mặc định: pool = TIGER_POOL_ID từ .env hoặc env.
// Output: snapshot.json với {address, amount_lamp, amount_oildrop, stake_epoch}[]
//
// THUẬT TOÁN:
//   1. Với mỗi epoch E: gọi /epochs/{E}/stakes?pool_id={pool} → danh sách
//      {stake_address, amount} (lovelace) cho tất cả delegator trong epoch đó.
//   2. Cộng dồn stake_epoch cho mỗi địa chỉ qua các epoch: S[addr] += amount
//   3. Tổng = Σ S[addr]. Phần LAMP = floor(S[addr] × BUDGET / TOTAL_STAKE_EPOCH).
//   4. Hamilton apportionment → đảm bảo tổng phân bổ = đúng BUDGET (không rò BigInt).
//   5. Loại địa chỉ nhận < MIN_LAMP_ALLOCATION (default 1 LAMP = 1 × 10⁶ oildrop).
//
// GHI CHÚ 100M vs 120M (model 3-pot, chốt 2026-07-11): tổng Airdrop 120M LAMP =
//   Delegator 100M + SPO 5M + CS 15M. Script này phân bổ phần DELEGATOR
//   (DEFAULT_BUDGET = 100_000_000) ∝stake. Hai pot còn lại CŨNG ∝ trọng số stake,
//   chỉ khác NGUỒN trọng số, tính riêng bằng cs_score.ts: SPO 5M ∝ stake chảy vào
//   pool; CS 15M ∝ phiếu-stake phân bổ cho người nhận (tự bỏ phiếu hợp lệ ⇒ cân
//   bằng = chia theo stake, spo-cs.md §3.5).
//   Xem spo-cs.md + CONTRACT.md.

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bf, bfAll, NETWORK, BLOCKFROST_KEY, currentEpoch } from "./config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Constants ──────────────────────────────────────────────────────────────

const OILDROP_PER_LAMP = 1_000_000n;

// Pool TIGER mặc định (Preview testnet). Override bằng --pool hoặc TIGER_POOL_ID env.
const DEFAULT_TIGER_POOL =
  process.env.TIGER_POOL_ID ?? "pool1xs2yx67vxuygadnjflj5u5dv6cqf6t0u6jke9z9jzj2svfuxmqq";

// Phần delegator (100M). Set --budget để thay.
const DEFAULT_BUDGET_LAMP = 100_000_000n;

// Bỏ qua địa chỉ nhận < 1 LAMP (tránh hàng trăm vi-lô tốn phí claim).
const MIN_LAMP = 1n;

// ── CLI args ───────────────────────────────────────────────────────────────

function parseArgs(): {
  epochs: bigint[];
  pool: string;
  budgetLamp: bigint;
  outFile: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const epochs: bigint[] = [];
  let pool = DEFAULT_TIGER_POOL;
  let budgetLamp = DEFAULT_BUDGET_LAMP;
  let outFile = resolve(__dir, "snapshot.json");
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "--epoch" || a === "-e") && args[i + 1]) {
      epochs.push(BigInt(args[++i]!));
    } else if (a === "--pool" && args[i + 1]) {
      pool = args[++i]!;
    } else if (a === "--budget" && args[i + 1]) {
      budgetLamp = BigInt(args[++i]!);
    } else if ((a === "--out" || a === "-o") && args[i + 1]) {
      outFile = resolve(process.cwd(), args[++i]!);
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`
Dùng: npx tsx build_airdrop_snapshot.ts --epoch <E> [--epoch <E2> ...]

Options:
  --epoch, -e <N>     Epoch snapshot (có thể lặp nhiều lần). Bắt buộc.
  --pool <pool_id>    Pool ID (default: TIGER_POOL_ID env hoặc constant).
  --budget <lamp>     Tổng LAMP phân bổ delegator (default: 100000000).
  --out, -o <file>    File output (default: snapshot.json).
  --dry-run           In thống kê, KHÔNG ghi file.
  --help, -h          Hiển thị trợ giúp.

Ví dụ:
  npx tsx build_airdrop_snapshot.ts --epoch 580
  npx tsx build_airdrop_snapshot.ts --epoch 580 --epoch 581 --epoch 582
  npx tsx build_airdrop_snapshot.ts --epoch 580 --pool pool1abc... --budget 120000000
`);
      process.exit(0);
    } else {
      console.error(`Tham số không nhận ra: ${a}`);
      process.exit(1);
    }
  }

  if (epochs.length === 0) {
    console.error("Bắt buộc ít nhất 1 --epoch <N>. Chạy --help để xem hướng dẫn.");
    process.exit(1);
  }

  return { epochs, pool, budgetLamp, outFile, dryRun };
}

// ── Blockfrost types ───────────────────────────────────────────────────────

interface EpochStakeEntry {
  stake_address: string; // stake1...
  amount:        string; // lovelace string
}

interface PoolInfo {
  pool_id: string;
  hex: string;
  active_stake?: string;
  live_delegators?: number;
  active_epoch: number;
}

// ── Snapshot data types ─────────────────────────────────────────────────────

export interface SnapshotRow {
  address: string;
  amount_lamp: string;  // stringified bigint (để JSON serialize an toàn)
  amount_oildrop: string;
  cumulative_lovelace: string;
  stake_epochs: number;
}

export interface SnapshotOutput {
  meta: {
    network: string;
    pool_id: string;
    epochs: number[];
    budget_lamp: string;
    total_delegators: number;
    total_lovelace: string;
    generated_at_epoch: string;
    excluded_below_min: number;
    note_spo_share: string;
  };
  entries: SnapshotRow[];
}

// ── Core logic ──────────────────────────────────────────────────────────────

/** Lấy tất cả stake của một epoch từ Blockfrost với phân trang. */
async function fetchEpochStakes(
  pool: string,
  epoch: bigint,
): Promise<EpochStakeEntry[]> {
  // /epochs/{number}/stakes?pool_id={pool} — Blockfrost phân trang count=100
  const base = `/epochs/${epoch}/stakes?pool_id=${pool}`;
  const rows = await bfAll<EpochStakeEntry>(base);
  return rows;
}

/** Hamilton apportionment — phân bổ nguyên chính xác tổng = budget. */
function hamiltonApportionment(
  weights: bigint[],    // cumulative lovelace của mỗi addr
  total: bigint,        // tổng tất cả weights
  budget: bigint,       // tổng LAMP cần phân bổ
): bigint[] {
  if (total === 0n) return weights.map(() => 0n);

  // Phần nguyên
  const floors = weights.map((w) => (w * budget) / total);
  const allocated = floors.reduce((a, b) => a + b, 0n);
  const remainder = budget - allocated;

  if (remainder === 0n) return floors;

  // Tính phần lẻ thập phân × 10^18 để sort chính xác
  const SCALE = 10n ** 18n;
  const fracs = weights.map((w, i) => ({
    i,
    frac: (w * budget * SCALE) / total - floors[i]! * SCALE,
  }));
  fracs.sort((a, b) => (b.frac > a.frac ? 1 : b.frac < a.frac ? -1 : 0));

  const result = [...floors];
  for (let k = 0n; k < remainder; k++) {
    result[fracs[Number(k)]!.i]! += 1n;
  }
  return result;
}

async function main(): Promise<void> {
  const { epochs, pool, budgetLamp, outFile, dryRun } = parseArgs();

  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env hoặc biến môi trường");
  }

  console.log(`Network:  ${NETWORK}`);
  console.log(`Pool:     ${pool}`);
  console.log(`Epochs:   [${epochs.join(", ")}]`);
  console.log(`Budget:   ${budgetLamp.toLocaleString()} LAMP`);
  console.log();

  // Verify pool tồn tại
  console.log("Kiểm tra pool...");
  const poolInfo = await bf<PoolInfo>(`/pools/${pool}`).catch(() => null);
  if (!poolInfo || typeof poolInfo !== "object" || !("pool_id" in poolInfo)) {
    throw new Error(
      `Pool ${pool} không tìm thấy trên Blockfrost (${NETWORK}). ` +
      `Kiểm tra TIGER_POOL_ID hoặc tham số --pool.`,
    );
  }
  console.log(`  Pool xác nhận: ${poolInfo.pool_id}`);
  console.log(`  Live delegators: ${poolInfo.live_delegators ?? "n/a"}`);
  console.log();

  // Lấy dữ liệu từng epoch
  const cumulativeStake = new Map<string, bigint>(); // stake_addr → tổng lovelace
  const epochCountPerAddr = new Map<string, number>(); // stake_addr → số epoch có mặt

  for (const epoch of epochs) {
    console.log(`Lấy dữ liệu epoch ${epoch}...`);
    const rows = await fetchEpochStakes(pool, epoch);
    console.log(`  ${rows.length} delegator trong epoch ${epoch}`);

    for (const row of rows) {
      const amount = BigInt(row.amount);
      cumulativeStake.set(
        row.stake_address,
        (cumulativeStake.get(row.stake_address) ?? 0n) + amount,
      );
      epochCountPerAddr.set(
        row.stake_address,
        (epochCountPerAddr.get(row.stake_address) ?? 0) + 1,
      );
    }
  }

  const totalLovelace = [...cumulativeStake.values()].reduce((a, b) => a + b, 0n);
  console.log();
  console.log(`Tổng delegator duy nhất: ${cumulativeStake.size}`);
  console.log(`Tổng stake × epoch (lovelace): ${totalLovelace.toLocaleString()}`);
  console.log();

  if (totalLovelace === 0n) {
    throw new Error(
      "Tổng stake = 0. Có thể pool chưa active trong các epoch này, " +
      "hoặc pool ID sai. Kiểm tra lại.",
    );
  }

  // Phân bổ LAMP theo Hamilton apportionment
  const addrs = [...cumulativeStake.keys()];
  const stakes = addrs.map((a) => cumulativeStake.get(a)!);
  const allocatedLamp = hamiltonApportionment(stakes, totalLovelace, budgetLamp);

  // Xây output, lọc < MIN_LAMP
  let excludedCount = 0;
  const entries: SnapshotRow[] = [];

  for (let i = 0; i < addrs.length; i++) {
    const lamp = allocatedLamp[i]!;
    if (lamp < MIN_LAMP) {
      excludedCount++;
      continue;
    }
    entries.push({
      address: addrs[i]!,
      amount_lamp: lamp.toString(),
      amount_oildrop: (lamp * OILDROP_PER_LAMP).toString(),
      cumulative_lovelace: stakes[i]!.toString(),
      stake_epochs: epochCountPerAddr.get(addrs[i]!) ?? 0,
    });
  }

  // Sort: stake cao → thấp (dễ kiểm tra)
  entries.sort((a, b) => {
    const diff = BigInt(b.cumulative_lovelace) - BigInt(a.cumulative_lovelace);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });

  // Verify: tổng phân bổ = budget (sau khi lọc MIN)
  const allocated = entries.reduce((s, e) => s + BigInt(e.amount_lamp), 0n);
  const gap = budgetLamp - allocated;

  const epochCurrent = await currentEpoch();

  const output: SnapshotOutput = {
    meta: {
      network: NETWORK,
      pool_id: pool,
      epochs: epochs.map(Number),
      budget_lamp: budgetLamp.toString(),
      total_delegators: entries.length,
      total_lovelace: totalLovelace.toString(),
      generated_at_epoch: epochCurrent.toString(),
      excluded_below_min: excludedCount,
      note_spo_share:
        "Budget này = phần Delegator (100M LAMP, ∝stake). Model 3-pot: SPO 5M " +
        "(∝ stake chảy vào pool) + CS 15M (∝ phiếu-stake phân bổ cho người nhận; " +
        "tự bỏ phiếu hợp lệ ⇒ cân bằng = chia theo stake) — cả hai ĐỀU ∝ trọng số " +
        "stake, tính riêng (cs_score.ts). Xem spo-cs.md §3.5.",
    },
    entries,
  };

  // In thống kê
  console.log("=== Thống kê phân bổ ===");
  console.log(`  Delegator đủ điều kiện: ${entries.length}`);
  console.log(`  Loại < ${MIN_LAMP} LAMP:    ${excludedCount}`);
  console.log(`  LAMP phân bổ:         ${allocated.toLocaleString()}`);
  console.log(`  Gap (Hamilton lẻ):    ${gap.toLocaleString()}`);
  if (gap > 0n) {
    console.log(`  [INFO] ${gap} LAMP dư do lọc địa chỉ nhỏ → về Treasury.`);
  }
  if (entries.length > 0) {
    const top = entries[0]!;
    const bot = entries[entries.length - 1]!;
    console.log(`  Top 1:  ${top.address} → ${top.amount_lamp} LAMP`);
    console.log(`  Bot 1:  ${bot.address} → ${bot.amount_lamp} LAMP`);
  }
  console.log();

  if (dryRun) {
    console.log("[--dry-run] Không ghi file.");
    return;
  }

  await writeFile(outFile, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Đã ghi: ${outFile}`);
  console.log();
  console.log("Bước tiếp theo:");
  console.log("  1. Kiểm tra snapshot: npx tsx check_airdrop.ts --snapshot snapshot.json --addr <stake_addr>");
  console.log("  2. Deploy: npx tsx demo_airdrop.ts (xem operator-runbook.md để deploy thật)");
}

main().catch((e) => {
  console.error("LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
