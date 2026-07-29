// LaunchAPI/src/etd.ts — endpoint dữ liệu cho trang ETD (AffiSo frontend gọi).
//
// GET /v1/launch/etd/check?address=<addr|stake_addr>
//   → lịch sử stake mọi epoch + lọc epoch pool TIGER + accStake + LAMP sẽ nhận.
//
// Entitlement math CANONICAL LAMP-side (P8): tái dùng lõi ../../TIGER/offchain/src.
// AffiSo chỉ render JSON này — KHÔNG tự tính LAMP.
//
// Env: BLOCKFROST_KEY (bắt buộc), NETWORK (Preview mặc định), TIGER_POOL_ID (override),
//      ETD_CUTOFF_EPOCH (số; rỗng = không cắt), ETD_SNAPSHOT_PATH (file snapshot chốt
//      để tính LAMP; thiếu → lamp = null, provisional = true).

import { readFileSync } from "node:fs";
import {
  analyzeHistory, projectLampFromSnapshot, type HistoryEntry,
} from "../../TIGER/offchain/src/check.js";
import { parseSnapshotFile, type SnapshotFile } from "../../TIGER/offchain/src/snapshot.js";
import { TIGER_TOTAL_OILDROP, OILDROP_PER_LAMP, TIGER_POOL_ID_DEFAULT } from "../../TIGER/offchain/src/constants.js";

const NETWORK = process.env.NETWORK ?? "Preview";
const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
const TIGER_POOL_ID = process.env.TIGER_POOL_ID ?? TIGER_POOL_ID_DEFAULT;
const CUTOFF = process.env.ETD_CUTOFF_EPOCH ? BigInt(process.env.ETD_CUTOFF_EPOCH) : null;
const SNAPSHOT_PATH = process.env.ETD_SNAPSHOT_PATH ?? "";
const BF_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function bf<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BF_URL}${path}`, { headers: { project_id: BLOCKFROST_KEY } });
    if (res.status === 429 && attempt < 6) { await sleep(1200 * (attempt + 1)); continue; }
    if (res.status === 404) return [] as unknown as T;
    if (!res.ok) throw new Error(`Blockfrost ${res.status} ${path}`);
    return res.json() as Promise<T>;
  }
}

async function bfAll<T>(base: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = base.includes("?") ? "&" : "?";
    const chunk = await bf<T[]>(`${base}${sep}count=100&page=${page}`);
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

async function resolveStakeAddr(addr: string): Promise<string> {
  if (addr.startsWith("stake")) return addr;
  const info = await bf<{ stake_address: string | null }>(`/addresses/${addr}`);
  if (!info || !info.stake_address) throw new Error("địa chỉ không ủy thác / không có stake key");
  return info.stake_address;
}

export interface EtdCheckResult {
  address: string;
  stake_address: string;
  network: string;
  pool_tiger: string;
  cutoff_epoch: string | null;
  history: { epoch: string; pool_id: string | null; stake_lovelace: string; is_tiger: boolean }[];
  tiger: { epoch: string; stake_lovelace: string }[];
  tiger_acc_stake: string;
  lamp: { amount_lamp: string | null; capped: boolean; provisional: boolean };
}

/** Xử lý 1 địa chỉ → JSON cho trang ETD. Ném lỗi nếu thiếu env / địa chỉ sai. */
export async function etdCheck(address: string): Promise<EtdCheckResult> {
  if (!BLOCKFROST_KEY) throw new Error("server thiếu BLOCKFROST_KEY");
  if (!address) throw new Error("thiếu tham số address");

  const stakeAddr = await resolveStakeAddr(address);
  const history = await bfAll<HistoryEntry>(`/accounts/${stakeAddr}/history`);
  const { rows, tigerRows, tigerAccStake } = analyzeHistory(history, {
    tigerPoolId: TIGER_POOL_ID, cutoffEpoch: CUTOFF,
  });

  // LAMP: chỉ chính xác khi có snapshot chốt (cutoff + registration). Thiếu → provisional.
  let amount_lamp: string | null = null, capped = false, provisional = true;
  if (SNAPSHOT_PATH) {
    try {
      const file = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SnapshotFile;
      const snap = parseSnapshotFile(file);
      // owner khớp owner_key của snapshot (stake_address, hoặc payment pkh khi đã registry-map)
      const owner = file.meta.owner_key === "stake_address" ? stakeAddr : stakeAddr;
      const proj = projectLampFromSnapshot(snap, owner, TIGER_TOTAL_OILDROP);
      if (proj.amountOildrop !== null) {
        amount_lamp = (proj.amountOildrop / OILDROP_PER_LAMP).toString();
        capped = proj.capped;
      }
      provisional = false;
    } catch { /* snapshot lỗi → giữ provisional */ }
  }

  return {
    address, stake_address: stakeAddr, network: NETWORK, pool_tiger: TIGER_POOL_ID,
    cutoff_epoch: CUTOFF !== null ? CUTOFF.toString() : null,
    history: rows.map((r) => ({
      epoch: r.epoch.toString(), pool_id: r.pool_id,
      stake_lovelace: r.stake.toString(), is_tiger: r.is_tiger,
    })),
    tiger: tigerRows.map((r) => ({ epoch: r.epoch.toString(), stake_lovelace: r.stake.toString() })),
    tiger_acc_stake: tigerAccStake.toString(),
    lamp: { amount_lamp, capped, provisional },
  };
}
