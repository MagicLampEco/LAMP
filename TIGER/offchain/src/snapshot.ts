// TIGER/offchain/src/snapshot.ts — LÕI THUẦN dựng SnapshotSet (KHÔNG I/O, không mạng).
// CLI Blockfrost ở TIGER/scripts/build_tiger_snapshot.ts chỉ fetch rồi gọi vào đây.
// Đầu ra nạp thẳng vào entitlement.computeEntitlements().

import type { SnapshotSet, StakeEntry } from "./types.js";

/** 1 dòng stake thô từ Blockfrost /epochs/{E}/stakes. */
export interface RawStakeRow { stake_address: string; amount: string; }

/** Danh sách stake thô của 1 epoch. */
export interface EpochRows { epoch: bigint; rows: RawStakeRow[]; }

export interface BuildOpts {
  /** bảng đăng-ký stake_address → payment pkh (hex). Không có → owner = stake_address. */
  registry?: Map<string, string>;
  /** loại ví (self-dealing): so theo stake_address HOẶC owner đã resolve. */
  excluded?: Set<string>;
}

/**
 * Gộp per-epoch rows → SnapshotSet. THUẦN, tất định. Bỏ stake ≤ 0 + excluded.
 * Ném lỗi rõ nếu registry làm 2 stake_address rơi về CÙNG owner trong CÙNG epoch
 * (entitlement.accumulate sẽ ném TIGER-002; bắt sớm ở đây cho dễ chẩn đoán).
 */
export function buildSnapshotSet(perEpoch: EpochRows[], opts: BuildOpts = {}): SnapshotSet {
  const registry = opts.registry ?? new Map<string, string>();
  const excluded = opts.excluded ?? new Set<string>();

  return perEpoch.map(({ epoch, rows }) => {
    const seen = new Set<string>();
    const out: StakeEntry[] = [];
    for (const r of rows) {
      const owner = registry.get(r.stake_address) ?? r.stake_address;
      const stake = BigInt(r.amount);
      if (stake <= 0n) continue;
      if (excluded.has(r.stake_address) || excluded.has(owner)) continue;
      if (seen.has(owner)) {
        throw new Error(
          `TIGER-SNAP-DUP: owner ${owner} xuất hiện 2 lần trong epoch ${epoch} ` +
          `(registry gộp nhiều stake_address về 1 pkh) — cần gộp stake trước hoặc tách owner.`,
        );
      }
      seen.add(owner);
      out.push({ owner, stake });
    }
    return out;
  });
}

/** accStake per owner + tổng (cho meta + kiểm toán). */
export function summarize(snap: SnapshotSet): {
  accStake: Map<string, bigint>; totalStake: bigint; owners: number;
} {
  const accStake = new Map<string, bigint>();
  for (const epoch of snap) {
    for (const e of epoch) {
      accStake.set(e.owner, (accStake.get(e.owner) ?? 0n) + e.stake);
    }
  }
  let totalStake = 0n;
  for (const v of accStake.values()) totalStake += v;
  return { accStake, totalStake, owners: accStake.size };
}

// ── Serialize an toàn BigInt (stake → string) ───────────────────────────────
export interface SnapshotFile {
  meta: {
    network: string; pool_id: string; epochs: string[]; cutoff_epoch: string;
    owner_key: "stake_address" | "payment_pkh"; registry_applied: boolean;
    total_owners: number; total_stake_lovelace: string; generated_at_epoch: string;
    excluded: string[];
  };
  /** SnapshotSet với stake dạng string (JSON-safe). Dùng parseSnapshotFile để nạp lại. */
  snapshot: { owner: string; stake: string }[][];
}

/** SnapshotSet → object JSON-safe (stake → string). */
export function toSnapshotJson(snap: SnapshotSet): { owner: string; stake: string }[][] {
  return snap.map((ep) => ep.map((e) => ({ owner: e.owner, stake: e.stake.toString() })));
}

/** Nạp lại SnapshotFile → SnapshotSet (string → BigInt) cho consumer/redeem. */
export function parseSnapshotFile(json: SnapshotFile): SnapshotSet {
  return json.snapshot.map((ep) => ep.map((e) => ({ owner: e.owner, stake: BigInt(e.stake) })));
}
