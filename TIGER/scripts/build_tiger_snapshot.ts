// TIGER/scripts/build_tiger_snapshot.ts
//
// CLI dựng SnapshotSet THẬT cho pot "Early TIGER Deleg 12" từ Blockfrost, thay cho
// snapshot mock trong 05_tiger_redeem.ts. Lõi thuần ở ../offchain/src/snapshot.ts
// (test-được); file này chỉ fetch + đọc/ghi file (chạy bằng tsx, KHÔNG qua tsc build).
//
// LUỒNG:
//   1. Mỗi epoch E < CUTOFF: /epochs/{E}/stakes?pool_id={pool} → {stake_address, amount}.
//   2. buildSnapshotSet → SnapshotSet = StakeEntry[][] (mỗi epoch một danh sách).
//   3. owner-key MẶC ĐỊNH = stake_address. Với --registry <file> (bảng đăng-ký
//      stake_address→payment_pkh, khớp mô hình Airdrop-đăng-ký), owner = payment pkh
//      — là cái claim_account.owner bắt ký khi redeem.
//
// LƯU Ý deploy thật (README §"Còn thiếu"): claim_account.owner = payment pkh ⇒ PHẢI
// --registry trước khi seed; CUTOFF + TIGER_POOL_ID là tham số bắt buộc.
//
// Chạy:  npx tsx build_tiger_snapshot.ts --pool pool1... --from 500 --to 511 \
//          [--cutoff 512] [--registry reg.json] [--exclude <sa|pkh> ...] [--out f.json] [--dry-run]

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bf, bfAll, currentEpoch, NETWORK, BLOCKFROST_KEY, TIGER_POOL_ID } from "./config.js";
import {
  buildSnapshotSet, summarize, toSnapshotJson,
  type RawStakeRow, type EpochRows, type SnapshotFile,
} from "../offchain/src/snapshot.js";

interface PoolInfo { pool_id: string; live_delegators?: number; }

function parseArgs(): {
  pool: string; epochs: bigint[]; cutoff: bigint | null;
  registryFile: string | null; excluded: Set<string>; outFile: string; dryRun: boolean;
} {
  const a = process.argv.slice(2);
  let pool = TIGER_POOL_ID;
  const epochs: bigint[] = [];
  let from: bigint | null = null, to: bigint | null = null, cutoff: bigint | null = null;
  let registryFile: string | null = null;
  const excluded = new Set<string>();
  let outFile = resolve(process.cwd(), "tiger_snapshot.json");
  let dryRun = false;
  for (let i = 0; i < a.length; i++) {
    const k = a[i]!;
    if (k === "--pool") pool = a[++i]!;
    else if (k === "--epoch") epochs.push(BigInt(a[++i]!));
    else if (k === "--from") from = BigInt(a[++i]!);
    else if (k === "--to") to = BigInt(a[++i]!);
    else if (k === "--cutoff") cutoff = BigInt(a[++i]!);
    else if (k === "--registry") registryFile = a[++i]!;
    else if (k === "--exclude") excluded.add(a[++i]!);
    else if (k === "--out") outFile = resolve(process.cwd(), a[++i]!);
    else if (k === "--dry-run") dryRun = true;
    else if (k === "--help") { printHelp(); process.exit(0); }
  }
  if (from !== null && to !== null) for (let e = from; e <= to; e++) epochs.push(e);
  const filtered = cutoff !== null ? epochs.filter((e) => e < cutoff) : epochs;
  const uniq = [...new Set(filtered.map(String))].map(BigInt).sort((x, y) => (x < y ? -1 : 1));
  if (uniq.length === 0) {
    console.error("Cần ít nhất 1 epoch (< cutoff). Dùng --epoch N hoặc --from A --to B. --help để xem.");
    process.exit(1);
  }
  return { pool, epochs: uniq, cutoff, registryFile, excluded, outFile, dryRun };
}

function printHelp(): void {
  console.log(`build_tiger_snapshot — dựng SnapshotSet TIGER từ Blockfrost

  --pool <id>         pool bech32/hex (mặc định env TIGER_POOL_ID)
  --epoch <N>         thêm 1 epoch (lặp nhiều lần)
  --from <A> --to <B> khoảng epoch [A..B]
  --cutoff <E>        chỉ giữ epoch < E (nửa mở, khớp CUTOFF_EPOCH)
  --registry <file>   JSON { "stake1...": "<payment_pkh_hex>", ... } → owner = pkh
  --exclude <id>      loại stake_address hoặc pkh (self-dealing); lặp nhiều lần
  --out <file>        file JSON đầu ra (mặc định ./tiger_snapshot.json)
  --dry-run           không ghi file, chỉ in tóm tắt`);
}

function loadRegistry(file: string): Map<string, string> {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return new Map(Object.entries(raw));
}

async function main(): Promise<void> {
  const { pool, epochs, cutoff, registryFile, excluded, outFile, dryRun } = parseArgs();
  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");
  if (!pool) throw new Error("thiếu pool — --pool <id> hoặc env TIGER_POOL_ID");

  const registry = registryFile ? loadRegistry(registryFile) : undefined;

  console.log(`Network:   ${NETWORK}`);
  console.log(`Pool:      ${pool}`);
  console.log(`Epochs:    [${epochs.join(", ")}]${cutoff !== null ? ` (cutoff < ${cutoff})` : ""}`);
  console.log(`Owner-key: ${registry ? "payment_pkh (registry)" : "stake_address"}`);
  console.log();

  const poolInfo = await bf<PoolInfo>(`/pools/${pool}`).catch(() => null);
  if (!poolInfo || !("pool_id" in poolInfo)) {
    throw new Error(`Pool ${pool} không thấy trên Blockfrost (${NETWORK}). Kiểm tra --pool/TIGER_POOL_ID.`);
  }
  console.log(`  Pool xác nhận: ${poolInfo.pool_id} (live delegators: ${poolInfo.live_delegators ?? "n/a"})\n`);

  const perEpoch: EpochRows[] = [];
  for (const epoch of epochs) {
    const rows = await bfAll<RawStakeRow>(`/epochs/${epoch}/stakes?pool_id=${pool}`);
    console.log(`  epoch ${epoch}: ${rows.length} delegator`);
    perEpoch.push({ epoch, rows });
  }

  const opts = registry ? { registry, excluded } : { excluded };
  const snap = buildSnapshotSet(perEpoch, opts);
  const { totalStake, owners } = summarize(snap);
  const genEpoch = await currentEpoch().catch(() => 0n);

  console.log(`\nTổng owner: ${owners}   Tổng accStake: ${totalStake.toLocaleString()} lovelace·epoch`);

  if (dryRun) { console.log("\n(dry-run — không ghi file)"); return; }

  const file: SnapshotFile = {
    meta: {
      network: NETWORK, pool_id: poolInfo.pool_id, epochs: epochs.map(String),
      cutoff_epoch: cutoff !== null ? String(cutoff) : "",
      owner_key: registry ? "payment_pkh" : "stake_address",
      registry_applied: !!registry, total_owners: owners,
      total_stake_lovelace: totalStake.toString(), generated_at_epoch: genEpoch.toString(),
      excluded: [...excluded],
    },
    snapshot: toSnapshotJson(snap),
  };
  writeFileSync(outFile, JSON.stringify(file, null, 2));
  console.log(`\n✓ Ghi ${outFile}`);
  if (!registry) {
    console.log("\n⚠ owner-key = stake_address. Trước khi seed ClaimAccount phải chạy lại với");
    console.log("  --registry <bảng đăng-ký> để owner = payment pkh (claim_account bắt ký).");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
