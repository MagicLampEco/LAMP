// spo_stats.ts — Hiển thị thống kê stake pool trong 6 epoch snapshot gần nhất.
//
// DEPRECATED cho phần SPO: "Tổng stake × epoch" dưới đây CHỈ là thông tin tham
// khảo về pool, KHÔNG còn là cơ sở chia phần SPO. Model 3-pot (chốt 2026-07-11):
//   - SPO 5M LAMP: chia ĐỀU cho SPO qua cổng đủ-điều-kiện (không theo stake).
//   - SC 15M LAMP: theo Social/Community support đo qua AffiSo/ProofChat (cs_score.ts).
//   - Delegator 100M LAMP: ∝stake mọi pool (build_delegator_snapshot.ts / snapshot builder).
// Xem SPO-CS-SPEC-Vi.md + AIRDROP-V2-SPEC-Vi.md.
//
// Dùng:
//   npx tsx spo_stats.ts --pool pool1xs2yx...
//   npx tsx spo_stats.ts --pool pool1... --epochs 580,581,582   # epoch cụ thể
//   npx tsx spo_stats.ts --pool pool1... --count 6              # 6 epoch gần nhất (default)
//
// Không yêu cầu key, wallet, hay credential nào — chỉ pool ID + Blockfrost key.

import { bf, bfAll, BLOCKFROST_KEY, NETWORK } from "./config.js";

// ── Blockfrost types ────────────────────────────────────────────────────────

interface PoolInfo {
  pool_id: string;
  hex: string;
  active_stake: string | null;
  live_stake: string | null;
  live_delegators: number;
  live_saturation: number;
  active_epoch: number;
  retirement?: { retiring_epoch: number }[];
  reward_account: string;
  owners: string[];
  registration: string[];
  retirement_txs?: string[];
  metadata?: { name?: string; ticker?: string; homepage?: string };
}

interface PoolHistory {
  epoch: number;
  blocks: number;
  active_stake: string;
  active_size: number;
  delegators_count: number;
  rewards: string;
  fees: string;
}

interface PoolMetadata {
  name?: string;
  ticker?: string;
  description?: string;
  homepage?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtAda(lovelace: string | null | undefined): string {
  if (!lovelace) return "—";
  const ada = BigInt(lovelace) / 1_000_000n;
  return `${ada.toLocaleString("en")} ADA`;
}

function fmtPct(size: number | null | undefined): string {
  if (size == null) return "—";
  return `${(size * 100).toFixed(2)}%`;
}

function fmtSat(sat: number | null | undefined): string {
  if (sat == null) return "—";
  const pct = (sat * 100).toFixed(1);
  const warn = sat > 0.95 ? " ⚠ oversaturated" : sat > 0.80 ? " (gần đầy)" : "";
  return `${pct}%${warn}`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(): {
  pool: string;
  epochCount: number;
  explicitEpochs: number[] | null;
} {
  const args = process.argv.slice(2);
  let pool = "";
  let epochCount = 6;
  let explicitEpochs: number[] | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "--pool" || a === "-p") && args[i + 1]) {
      pool = args[++i]!;
    } else if (a === "--epochs" && args[i + 1]) {
      explicitEpochs = args[++i]!.split(",").map(Number);
    } else if (a === "--count" && args[i + 1]) {
      epochCount = parseInt(args[++i]!, 10);
    } else if (a === "--help" || a === "-h") {
      console.log(`
Dùng: npx tsx spo_stats.ts --pool <pool_id> [options]

Options:
  --pool, -p <pool_id>       Pool ID (bech32, pool1...)  [bắt buộc]
  --epochs <e1,e2,...>       Danh sách epoch cụ thể (phân cách bằng dấu phẩy)
  --count <n>                Số epoch gần nhất hiển thị (mặc định: 6)
  --help, -h                 Hiển thị trợ giúp

Ví dụ:
  npx tsx spo_stats.ts --pool pool1xs2yx...
  npx tsx spo_stats.ts --pool pool1xs2yx... --epochs 580,581,582
`);
      process.exit(0);
    }
  }

  if (!pool) {
    console.error("Bắt buộc: --pool <pool_id>. Chạy --help để xem.");
    process.exit(1);
  }

  return { pool, epochCount, explicitEpochs };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { pool, epochCount, explicitEpochs } = parseArgs();

  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");
  }

  // 1. Fetch pool info
  console.log(`\nĐang tải thông tin pool ${pool.slice(0, 20)}...\n`);

  const info = await bf<PoolInfo>(`/pools/${pool}`);
  if (typeof info !== "object" || !info || !("pool_id" in info)) {
    throw new Error(
      `Pool không tìm thấy: ${pool}\n` +
      `Kiểm tra pool ID và NETWORK (hiện tại: ${NETWORK}).`,
    );
  }

  // Fetch metadata nếu có
  const meta = await bf<PoolMetadata>(`/pools/${pool}/metadata`).catch(() => ({}));
  const poolName = (meta as PoolMetadata).name ?? (meta as PoolMetadata).ticker ?? pool.slice(0, 20) + "...";
  const ticker = (meta as PoolMetadata).ticker ?? "";

  // 2. Fetch lịch sử epoch
  const history = await bfAll<PoolHistory>(`/pools/${pool}/history`);
  history.sort((a, b) => b.epoch - a.epoch); // mới → cũ

  // Lọc theo yêu cầu
  let epochs: PoolHistory[];
  if (explicitEpochs) {
    const eSet = new Set(explicitEpochs);
    epochs = history.filter((h) => eSet.has(h.epoch));
    // Sort theo epoch tăng dần để display
    epochs.sort((a, b) => a.epoch - b.epoch);
  } else {
    epochs = history.slice(0, epochCount).reverse(); // cũ → mới
  }

  if (epochs.length === 0) {
    throw new Error(
      explicitEpochs
        ? `Pool không có dữ liệu trong epoch [${explicitEpochs.join(", ")}].`
        : "Pool chưa có lịch sử hoạt động.",
    );
  }

  // Tính tổng stake × epoch
  const totalStakeLovelace = epochs.reduce(
    (s, h) => s + BigInt(h.active_stake),
    0n,
  );
  const firstActiveEpoch = history[history.length - 1]?.epoch ?? epochs[0]!.epoch;
  const lastEpoch = epochs[epochs.length - 1]!;

  // ── In header ───────────────────────────────────────────────────────────

  const line = "─".repeat(78);
  console.log(line);
  console.log(`TIGER AIRDROP — Thống kê Pool`);
  console.log(line);
  console.log(`Pool ID:     ${pool}`);
  if (poolName) console.log(`Tên pool:    ${poolName}${ticker ? ` [${ticker}]` : ""}`);
  console.log(`Reward acct: ${info.reward_account}`);
  console.log(`Chủ sở hữu:  ${info.owners.length} địa chỉ`);
  console.log(`Tham gia từ: Epoch ${firstActiveEpoch}`);
  console.log(`Network:     ${NETWORK}`);
  console.log();

  // ── Bảng theo epoch ─────────────────────────────────────────────────────

  console.log(
    `${"Epoch".padStart(7)}  ${"Active Stake".padStart(18)}  ${"Delegators".padStart(10)}  ${"Blocks".padStart(6)}  ${"Pool %".padStart(7)}  Ghi chú`,
  );
  console.log(
    `${"─".repeat(7)}  ${"─".repeat(18)}  ${"─".repeat(10)}  ${"─".repeat(6)}  ${"─".repeat(7)}  ${"─".repeat(15)}`,
  );

  for (const h of epochs) {
    const note =
      h.epoch === firstActiveEpoch
        ? "← lần đầu"
        : "";
    console.log(
      `${String(h.epoch).padStart(7)}  ` +
      `${fmtAda(h.active_stake).padStart(18)}  ` +
      `${String(h.delegators_count).padStart(10)}  ` +
      `${String(h.blocks).padStart(6)}  ` +
      `${fmtPct(h.active_size).padStart(7)}  ` +
      `${note}`,
    );
  }

  console.log(line);

  // ── Tổng kết ────────────────────────────────────────────────────────────

  console.log(
    `Tổng stake × epoch (${epochs.length} epoch):  ${fmtAda(totalStakeLovelace.toString())}`,
  );
  console.log(`Active stake hiện tại:                  ${fmtAda(info.active_stake)}`);
  console.log(`Live stake:                             ${fmtAda(info.live_stake)}`);
  console.log(`Saturation:                             ${fmtSat(info.live_saturation)}`);
  console.log(`Live delegators:                        ${info.live_delegators}`);

  // Phần SPO KHÔNG còn tính theo stake (model 3-pot). Số liệu trên chỉ tham khảo.
  console.log();
  console.log(
    "[Lưu ý] Model 3-pot: phần SPO 5M LAMP chia ĐỀU cho SPO qua cổng đủ-điều-kiện",
  );
  console.log(
    "        (không theo stake); phần SC 15M LAMP theo đóng góp cộng đồng (cần DID).",
  );
  console.log("        Chi tiết: SPO-CS-SPEC-Vi.md.");

  // ── Thông tin đăng ký ───────────────────────────────────────────────────

  console.log();
  console.log(line);
  console.log("Để đăng ký nhận phần LAMP SPO, chạy:");
  console.log(`  npx tsx spo_register.ts --pool ${pool}`);
  console.log();
  console.log("Không cần cold key / KES key / VRF key — chỉ cần reward stake key.");
  console.log(line);
  console.log();

  // Return structured data for piping
  const output = {
    pool_id: pool,
    pool_name: poolName,
    ticker,
    reward_account: info.reward_account,
    first_active_epoch: firstActiveEpoch,
    epochs: epochs.map((h) => ({
      epoch: h.epoch,
      active_stake: h.active_stake,
      delegators: h.delegators_count,
      blocks: h.blocks,
    })),
    total_stake_epoch_lovelace: totalStakeLovelace.toString(),
    network: NETWORK,
  };

  // Ghi JSON nếu có --json flag
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  }
}

main().catch((e) => {
  console.error("LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
