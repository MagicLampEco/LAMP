// build_delegator_snapshot.ts — Snapshot builder pot Delegator v2 (100M LAMP).
//
// THAY build_airdrop_snapshot.ts (v1, DEPRECATED). Vá 3 lỗ v1:
//   lỗ #1  v1 dựng leaf từ stake_address ⇒ claim KHÔNG trả được. v2 JOIN
//          stake_address → payment_address từ đăng ký ĐÃ VERIFY; owner = payment.
//          Đăng ký không hợp lệ → LOẠI (fail-closed).
//   lỗ #2  v1 chỉ 1 pool (--pool). v2 đọc /accounts/{stake}/history mỗi đăng ký,
//          cộng stake qua MỌI pool.
//   §1.5   chỉ cộng accStake các epoch nằm trong chuỗi giữ delegation ≥N liên tiếp
//          (N=2 mặc định). Ví giữ đúng 1 epoch → accStake 0 → loại.
//
// Dedupe FIRST-WINS trên stake_address (ký sớm nhất thắng), log xung đột TO.
// `excluded` FAIL-CLOSED: bắt buộc --excluded <file> hoặc --no-excluded tường minh.
// KHÔNG cap. In bảng tập trung TOP-10 trước SETUP merkle.
//
// Tái dùng (KHÔNG viết lại): computeEntitlements (qua buildDelegatorEntitlements),
// merkle.buildTree, snapshotTool.exportClaims, accStakeWithMinRun/dedupe/verify (offchain).
//
// Dùng:
//   npx tsx build_delegator_snapshot.ts --reg verified.json --no-excluded
//   npx tsx build_delegator_snapshot.ts --reg verified.json --excluded self.json \
//       --n 2 --e-open 620 --e-cut 637 --budget-lamp 100000000 --out snap.json

import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bfAll, BLOCKFROST_KEY, NETWORK, currentEpoch } from "./config.js";
import { verifyRegistration, dedupeFirstWins, accStakePerRegistration } from "../offchain/src/delegatorSnapshot.js";
import type { DelegatorRegistration, StakeHistoryRow, RegWithHistory } from "../offchain/src/delegatorSnapshot.js";
import { buildDelegatorEntitlements } from "../offchain/src/delegator_entitlement.js";
import { buildTree } from "../offchain/src/merkle.js";
import { exportClaims } from "../offchain/src/snapshotTool.js";
import {
  DELEGATOR_TOTAL_LAMP, OILDROP_PER_LAMP, oildropToLamp,
  DELEGATOR_CAMPAIGN, DELEGATOR_CAMPAIGN_ID, ROLE_DELEGATOR,
} from "../offchain/src/constants.js";
import type { MerkleParams } from "../offchain/src/types.js";
import { loadRegistrations, sortByEarliestSigned } from "./registrations_io.js";

interface Args {
  regPath: string;
  n: number;
  eOpen?: number;
  eCut?: number;
  budgetLamp: bigint;
  excludedFile: string | null;
  noExcluded: boolean;
  trustInput: boolean;
  outFile: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let regPath = "";
  let n = 2;
  let eOpen: number | undefined;
  let eCut: number | undefined;
  let budgetLamp = DELEGATOR_TOTAL_LAMP;
  let excludedFile: string | null = null;
  let noExcluded = false;
  let trustInput = false;
  let outFile = resolve(process.cwd(), "delegator_snapshot.json");

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--reg" && args[i + 1]) regPath = args[++i]!;
    else if (a === "--n" && args[i + 1]) n = Number(args[++i]!);
    else if (a === "--e-open" && args[i + 1]) eOpen = Number(args[++i]!);
    else if (a === "--e-cut" && args[i + 1]) eCut = Number(args[++i]!);
    else if (a === "--budget-lamp" && args[i + 1]) budgetLamp = BigInt(args[++i]!);
    else if (a === "--excluded" && args[i + 1]) excludedFile = args[++i]!;
    else if (a === "--no-excluded") noExcluded = true;
    else if (a === "--trust-input") trustInput = true;
    else if ((a === "--out" || a === "-o") && args[i + 1]) outFile = resolve(process.cwd(), args[++i]!);
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { console.error(`Tham số không nhận ra: ${a}`); process.exit(1); }
  }
  if (!regPath) { console.error("Bắt buộc: --reg <file|dir>. Chạy --help."); process.exit(1); }
  return { regPath, n, eOpen, eCut, budgetLamp, excludedFile, noExcluded, trustInput, outFile };
}

function printHelp(): void {
  console.log(`
Dùng: npx tsx build_delegator_snapshot.ts --reg <file|dir> (--excluded <f> | --no-excluded)

  --reg <path>       Đăng ký ĐÃ VERIFY (đầu ra verify_delegator.ts): file mảng/1-bản hoặc thư mục
  --n <N>            Chuỗi giữ liên tiếp tối thiểu (§1.5, mặc định 2)
  --e-open <E>       Đầu cửa sổ (bao gồm). Bỏ qua → không giới hạn
  --e-cut <E>        Cuối cửa sổ (KHÔNG bao gồm). Cần luật E_cut − E_open ≥ N+1
  --budget-lamp <L>  Budget pot Delegator (mặc định ${DELEGATOR_TOTAL_LAMP})
  --excluded <file>  JSON mảng địa chỉ (stake HOẶC payment) LOẠI — chống self-dealing
  --no-excluded      Tường minh CHẤP NHẬN không loại ai (fail-closed: phải chọn 1 trong 2)
  --trust-input      BỎ re-verify chữ ký (mặc định vẫn re-verify, drop bản hỏng)
  --out, -o <file>   File output (mặc định delegator_snapshot.json)
`);
}

/** excluded FAIL-CLOSED: --excluded <file> phải đọc được; hoặc --no-excluded tường minh. */
async function loadExcluded(a: Args): Promise<Set<string>> {
  if (a.excludedFile) {
    let raw: string;
    try {
      raw = await readFile(resolve(process.cwd(), a.excludedFile), "utf8");
    } catch (e) {
      throw new Error(
        `EXCLUDED-FAIL-CLOSED: không đọc được file --excluded ${a.excludedFile} ` +
        `(${e instanceof Error ? e.message : e}). Từ chối chạy với exclusions RỖNG. ` +
        `Sửa đường dẫn, hoặc dùng --no-excluded nếu THỰC SỰ không loại ai.`,
      );
    }
    let arr: unknown;
    try { arr = JSON.parse(raw); } catch { throw new Error(`EXCLUDED-FAIL-CLOSED: ${a.excludedFile} không phải JSON hợp lệ`); }
    if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
      throw new Error(`EXCLUDED-FAIL-CLOSED: ${a.excludedFile} phải là MẢNG chuỗi địa chỉ`);
    }
    return new Set(arr as string[]);
  }
  if (a.noExcluded) return new Set();
  throw new Error(
    "EXCLUDED-FAIL-CLOSED: phải chọn --excluded <file> (danh sách self-dealing) HOẶC " +
    "--no-excluded (tường minh không loại ai). Không mặc định im lặng.",
  );
}

async function fetchHistory(stakeAddr: string): Promise<StakeHistoryRow[]> {
  return bfAll<StakeHistoryRow>(`/accounts/${stakeAddr}/history`);
}

function fmtLamp(oildrop: bigint): string {
  return oildropToLamp(oildrop).toLocaleString("en");
}

async function main(): Promise<void> {
  const a = parseArgs();
  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY — cấu hình .env");
  if (a.n < 1) throw new Error("--n phải ≥ 1");
  if (a.eOpen !== undefined && a.eCut !== undefined) {
    if (a.eCut - a.eOpen < a.n + 1) {
      throw new Error(
        `Cửa sổ vi phạm luật §7: E_cut − E_open = ${a.eCut - a.eOpen} < N+1 = ${a.n + 1}. ` +
        `Không đủ chỗ cho chuỗi ≥N epoch.`,
      );
    }
  }

  // Schema C: leaf cần epoch snapshot CỐ ĐỊNH (Delegator = E_cut). Bắt buộc --e-cut.
  if (a.eCut === undefined) {
    throw new Error(
      "SCHEMA-C: bắt buộc --e-cut <E> — leaf Merkle v2 dùng epoch=E_cut làm HẰNG số " +
      "(bake vào validator). Không có E_cut thì không dựng được leaf khớp on-chain.",
    );
  }
  const merkleParams: MerkleParams = {
    campaignId: DELEGATOR_CAMPAIGN_ID,
    epoch: BigInt(a.eCut),
    role: ROLE_DELEGATOR,
  };

  const budgetOildrop = a.budgetLamp * OILDROP_PER_LAMP;
  const excluded = await loadExcluded(a);

  console.log(`Network:  ${NETWORK}`);
  console.log(`Budget:   ${a.budgetLamp.toLocaleString("en")} LAMP  (pot Delegator)`);
  console.log(`§1.5 N:   ${a.n} epoch liên tiếp tối thiểu`);
  console.log(`Cửa sổ:   ${a.eOpen ?? "-∞"} .. ${a.eCut ?? "+∞"} (nửa mở [E_open, E_cut))`);
  console.log(`Excluded: ${excluded.size} địa chỉ${a.noExcluded ? " (--no-excluded)" : ""}`);
  console.log();

  // ── Nạp + re-verify + dedupe first-wins ────────────────────────────────
  const loaded = sortByEarliestSigned(loadRegistrations(a.regPath));
  console.log(`Đã nạp ${loaded.length} đăng ký (đã sắp theo ký sớm nhất — first-wins).`);

  let regs: DelegatorRegistration[] = [];
  if (a.trustInput) {
    regs = loaded.map((x) => x.reg);
    console.log(`  [--trust-input] BỎ re-verify chữ ký.`);
  } else {
    for (const { reg, source } of loaded) {
      const v = await verifyRegistration(reg);
      if (v.ok) regs.push(reg);
      else console.log(`  ✗ LOẠI (chữ ký) ${reg.stake_address} [${source}]: ${v.reasons.join("; ")}`);
    }
    console.log(`  Re-verify: ${regs.length}/${loaded.length} qua chữ ký + khớp danh tính.`);
  }

  const { kept, conflicts } = dedupeFirstWins(regs);
  if (conflicts.length > 0) {
    console.log(`\n  ⚠ ${conflicts.length} XUNG ĐỘT dedupe (bản đến sau bị loại):`);
    for (const c of conflicts) {
      console.log(
        `    [${c.kind}] key=${c.key}\n` +
        `        GIỮ:  stake=${c.kept.stake_address} payment=${c.kept.payment_address} (ký ${c.kept.signed_at})\n` +
        `        LOẠI: stake=${c.dropped.stake_address} payment=${c.dropped.payment_address} (ký ${c.dropped.signed_at})`,
      );
    }
  }
  console.log(`  Sau dedupe: ${kept.length} đăng ký duy nhất.`);

  // ── Áp excluded (theo stake HOẶC payment) ──────────────────────────────
  const afterExcluded = kept.filter((r) => {
    const hit = excluded.has(r.stake_address) || excluded.has(r.payment_address);
    if (hit) console.log(`  ⊘ EXCLUDED: stake=${r.stake_address} payment=${r.payment_address}`);
    return !hit;
  });

  // ── Fetch history đa pool + §1.5 accStake (lõi thuần accStakePerRegistration) ──
  console.log(`\nLấy lịch sử stake (đa pool) + áp §1.5 cho ${afterExcluded.length} đăng ký...`);
  const withHistory: RegWithHistory[] = [];
  for (const r of afterExcluded) {
    withHistory.push({
      stake_address: r.stake_address,
      payment_address: r.payment_address,
      history: await fetchHistory(r.stake_address),
    });
  }
  const acc = accStakePerRegistration(withHistory, {
    n: a.n,
    ...(a.eOpen !== undefined ? { eOpen: a.eOpen } : {}),
    ...(a.eCut !== undefined ? { eCut: a.eCut } : {}),
  });
  const { eligible, zeroAcc, perReg } = acc;
  if (zeroAcc.length > 0) {
    console.log(`  ${zeroAcc.length} đăng ký accStake=0 (không có chuỗi ≥${a.n} epoch) → loại khỏi phân bổ.`);
  }
  if (eligible.length === 0) throw new Error("Không có đăng ký nào đủ điều kiện (accStake > 0). Dừng.");

  // ── computeEntitlements (không cap) → snapshot ─────────────────────────
  const ent = buildDelegatorEntitlements(eligible, { budgetOildrop, capOildrop: null });
  console.log(`\nĐã phân bổ: ${fmtLamp(ent.distributed)} LAMP cho ${ent.snapshot.length} địa chỉ.`);
  console.log(`Leftover (cap=null ⇒ 0): ${fmtLamp(ent.leftover)} LAMP.`);

  // ── BẢNG TẬP TRUNG TOP-10 (trước SETUP merkle) ─────────────────────────
  const sorted = [...ent.entitlements].sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : 0));
  const total = ent.distributed === 0n ? 1n : ent.distributed;
  console.log(`\n=== TẬP TRUNG — TOP 10 (trên ${ent.entitlements.length} địa chỉ) ===`);
  console.log(`  #   ${"payment".padEnd(24)} ${"LAMP".padStart(16)}  %pot   %tích luỹ`);
  let cum = 0n;
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const e = sorted[i]!;
    cum += e.amount;
    const pct = Number((e.amount * 10000n) / total) / 100;
    const cumPct = Number((cum * 10000n) / total) / 100;
    const p = e.owner.length > 24 ? `${e.owner.slice(0, 12)}…${e.owner.slice(-8)}` : e.owner;
    console.log(
      `  ${String(i + 1).padStart(2)}  ${p.padEnd(24)} ${fmtLamp(e.amount).padStart(16)}  ` +
      `${pct.toFixed(2).padStart(5)}  ${cumPct.toFixed(2).padStart(6)}`,
    );
  }
  const top10 = sorted.slice(0, 10).reduce((s, e) => s + e.amount, 0n);
  console.log(`  → Top 10 nắm ${(Number((top10 * 10000n) / total) / 100).toFixed(2)}% pot.`);

  // ── SETUP merkle ───────────────────────────────────────────────────────
  console.log(`\n=== SETUP merkle (schema C: campaign=${DELEGATOR_CAMPAIGN} role=${ROLE_DELEGATOR} epoch=${a.eCut}) ===`);
  const tree = buildTree(ent.snapshot, merkleParams);
  const claims = exportClaims(tree);
  console.log(`  campaign_id: ${merkleParams.campaignId}`);
  console.log(`  merkle_root: ${tree.root}`);
  console.log(`  leaves:      ${tree.leaves.length}`);

  const genEpoch = await currentEpoch().catch(() => -1n);
  const output = {
    meta: {
      network: NETWORK,
      pot: "Delegator",
      budget_lamp: a.budgetLamp.toString(),
      budget_oildrop: budgetOildrop.toString(),
      min_run_n: a.n,
      e_open: a.eOpen ?? null,
      e_cut: a.eCut ?? null,
      merkle_schema: "C",
      campaign: DELEGATOR_CAMPAIGN,
      campaign_id: merkleParams.campaignId,
      role: ROLE_DELEGATOR,
      leaf_epoch: a.eCut,
      merkle_root: tree.root,
      total_recipients: ent.snapshot.length,
      distributed_oildrop: ent.distributed.toString(),
      leftover_oildrop: ent.leftover.toString(),
      excluded_count: excluded.size,
      dedupe_conflicts: conflicts.length,
      zero_accstake_dropped: zeroAcc.length,
      generated_at_epoch: genEpoch.toString(),
      leaf_note: "schema C: leaf = blake2b(0x00 ‖ campaign_id[32] ‖ epoch_be8 ‖ role[1] ‖ owner[28] ‖ amount_be8). owner = PAYMENT key-hash (vá lỗ #1 v1). Khớp merkle.ak byte-perfect.",
    },
    merkle_root: tree.root,
    entitlements: ent.entitlements.map((e) => ({
      payment_address: e.owner,
      acc_stake_lovelace: e.accStake.toString(),
      amount_oildrop: e.amount.toString(),
      amount_lamp: oildropToLamp(e.amount).toString(),
    })),
    claims: claims.map((c) => ({
      address: c.address, amount_oildrop: c.amount.toString(), leaf: c.leaf, proof: c.proof,
    })),
    audit: {
      conflicts: conflicts.map((c) => ({ kind: c.kind, key: c.key, kept_stake: c.kept.stake_address, dropped_stake: c.dropped.stake_address })),
      zero_accstake: zeroAcc,
      per_registration: perReg.map((p) => ({
        stake_address: p.stake_address,
        payment_address: p.payment_address,
        acc_stake_lovelace: p.accStake.toString(),
        counted_epochs: p.counted,
        dropped_epochs: p.dropped,
        runs: p.runs,
      })),
    },
  };

  await writeFile(a.outFile, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nĐã ghi: ${a.outFile}`);
  console.log(`Kiểm nhanh 1 địa chỉ: npx tsx check_airdrop.ts --snapshot ${a.outFile} --addr <payment_addr>`);
}

main().catch((e) => { console.error("LỖI:", e instanceof Error ? e.message : e); process.exit(1); });
