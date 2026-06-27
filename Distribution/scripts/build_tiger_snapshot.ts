// LampDistribution/scripts/build_tiger_snapshot.ts — OPERATOR: dựng snapshot TIGER
// thô (công khai) từ Blockfrost để delegator tự kiểm bằng 06_tiger_check.ts.
//
// Nguồn dữ liệu (kiểm chứng được, công khai): với mỗi delegator,
//   GET /accounts/{stake_address}/history → [{active_epoch, amount, pool_id}]
// → lọc epoch < cutoff VÀ pool_id ∈ TIGER pools. Mỗi epoch một dòng stake.
//
// ── HAI INPUT VẬN HÀNH (policy operator/PhoenixKey — KHÔNG hardcode ở đây) ──
//   (1) TẬP DELEGATOR đầy đủ: Blockfrost /pools/{id}/delegators chỉ trả tập HIỆN
//       TẠI → BỎ SÓT người đã rời pool. Operator phải cấp danh sách stake address
//       đầy đủ (lịch sử) qua TIGER_STAKE_ADDRS (csv) hoặc file TIGER_STAKE_FILE
//       (mỗi dòng 1 stake addr). Nếu trống → fallback /pools/{id}/delegators (CẢNH
//       BÁO thiếu người đã rời).
//   (2) OWNER = pkh NHẬN LAMP: claim_account owner là payment-cred KÝ redeem. Map
//       stake_address → pkh nhận do operator/PhoenixKey quyết (TIGER_OWNER_MAP =
//       file json {stakeAddr: pkhHex}). Trống → owner = STAKE-KEY-HASH (CẢNH BÁO:
//       phải khớp địa chỉ nhận thực tế của delegator trước khi tạo account).
//
// Env: BLOCKFROST_KEY, NETWORK, TIGER_POOL_IDS (csv), TIGER_CUTOFF_EPOCH,
//      TIGER_BUDGET_LAMP (=12000000), TIGER_DRIP_EPOCHS (=36), TIGER_CLIFF_EPOCH,
//      TIGER_EXCLUDED (csv pkh), TIGER_OUT (đường dẫn ghi, mặc định ./tiger-snapshot.json).

import { readFileSync, writeFileSync } from "node:fs";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { NETWORK, BLOCKFROST_URL, BLOCKFROST_KEY, assertEnv } from "./config.js";
import { buildSnapshot } from "../ETD/offchain/src/index.js";

function reqEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`thiếu env ${name}`);
  return v;
}
function csv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function bf<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BLOCKFROST_URL}${path}`, {
      headers: { project_id: BLOCKFROST_KEY },
    });
    if (res.status === 429 && attempt < 5) { await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 404) return [] as unknown as T; // account chưa có history
    if (!res.ok) throw new Error(`Blockfrost ${res.status} ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}

/** Phân trang Blockfrost (count=100). */
async function bfAll<T>(base: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const chunk = await bf<T[]>(`${base}${base.includes("?") ? "&" : "?"}count=100&page=${page}`);
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

async function main(): Promise<void> {
  assertEnv();
  const poolIds = csv("TIGER_POOL_IDS");
  if (poolIds.length === 0) throw new Error("thiếu TIGER_POOL_IDS (csv pool TIGER)");
  const poolSet = new Set(poolIds);
  const cutoff = BigInt(reqEnv("TIGER_CUTOFF_EPOCH"));
  const budgetLamp = BigInt(process.env.TIGER_BUDGET_LAMP ?? "12000000");
  const dripEpochs = BigInt(process.env.TIGER_DRIP_EPOCHS ?? "36");
  const cliffEpoch = BigInt(process.env.TIGER_CLIFF_EPOCH ?? cutoff.toString());
  const excluded = csv("TIGER_EXCLUDED").map((h) => h.toLowerCase());
  const outPath = process.env.TIGER_OUT ?? "./tiger-snapshot.json";

  // (1) tập stake address.
  let stakeAddrs: string[];
  const stakeFile = process.env.TIGER_STAKE_FILE;
  if (stakeFile) {
    stakeAddrs = readFileSync(stakeFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  } else if (csv("TIGER_STAKE_ADDRS").length > 0) {
    stakeAddrs = csv("TIGER_STAKE_ADDRS");
  } else {
    console.warn("⚠ TIGER_STAKE_ADDRS/FILE trống — fallback /pools/{id}/delegators (HIỆN TẠI, bỏ sót người đã rời pool).");
    stakeAddrs = [];
    for (const pid of poolIds) {
      const dels = await bfAll<{ address: string }>(`/pools/${pid}/delegators`);
      stakeAddrs.push(...dels.map((d) => d.address));
    }
    stakeAddrs = [...new Set(stakeAddrs)];
  }
  console.log(`Delegator: ${stakeAddrs.length} stake address · pool ${poolIds.join(",")} · cutoff <${cutoff}`);

  // (2) owner map.
  let ownerMap: Record<string, string> = {};
  if (process.env.TIGER_OWNER_MAP) {
    ownerMap = JSON.parse(readFileSync(process.env.TIGER_OWNER_MAP, "utf8"));
  }
  const resolveOwner = (stakeAddr: string): string => {
    const m = ownerMap[stakeAddr];
    if (m) return (m.startsWith("0x") ? m.slice(2) : m).toLowerCase();
    const det = getAddressDetails(stakeAddr);
    if (!det.stakeCredential) throw new Error(`không lấy được stake cred từ ${stakeAddr}`);
    return det.stakeCredential.hash.toLowerCase(); // fallback = stake-key-hash
  };
  if (!process.env.TIGER_OWNER_MAP)
    console.warn("⚠ TIGER_OWNER_MAP trống — owner = STAKE-KEY-HASH (phải khớp địa chỉ nhận thực tế trước khi tạo account).");

  // gom stake theo epoch.
  const perEpoch = new Map<bigint, { owner: string; stake: bigint; stakeAddress: string }[]>();
  let i = 0;
  for (const sa of stakeAddrs) {
    i++;
    const owner = resolveOwner(sa);
    const hist = await bf<{ active_epoch: number; amount: string; pool_id: string | null }[]>(
      `/accounts/${sa}/history?count=100`,
    );
    for (const h of hist) {
      const e = BigInt(h.active_epoch);
      if (e >= cutoff) continue;
      if (!h.pool_id || !poolSet.has(h.pool_id)) continue;
      const amt = BigInt(h.amount);
      if (amt <= 0n) continue;
      if (!perEpoch.has(e)) perEpoch.set(e, []);
      perEpoch.get(e)!.push({ owner, stake: amt, stakeAddress: sa });
    }
    if (i % 25 === 0) console.log(`  …${i}/${stakeAddrs.length}`);
  }

  const epochs = [...perEpoch.keys()].sort((a, b) => (a < b ? -1 : 1)).map((epoch) => ({
    epoch,
    stakes: perEpoch.get(epoch)!,
  }));

  const snap = buildSnapshot({
    network: NETWORK,
    pot: process.env.TIGER_POT_NAME ?? "Early TIGER Deleg 12",
    budgetLamp,
    cutoffEpoch: cutoff,
    poolIds,
    excluded,
    dripEpochs,
    cliffEpoch,
    epochs,
  });

  writeFileSync(outPath, JSON.stringify(snap, null, 2));
  const totalRows = epochs.reduce((s, e) => s + e.stakes.length, 0);
  console.log(`\n✓ Ghi ${outPath}: ${epochs.length} epoch, ${totalRows} dòng stake.`);
  console.log(`  Delegator kiểm: npx tsx 06_tiger_check.ts <addr> --snapshot ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
