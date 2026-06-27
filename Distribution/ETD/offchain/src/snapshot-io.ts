// TIGER snapshot I/O — định dạng JSON snapshot THÔ (công khai, kiểm chứng được).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO (minh bạch để delegator tự kiểm)
//
//   Mẫu số entitlement = stake tích lũy của MỌI delegator qua MỌI epoch. Không ai
//   tự suy ra một mình → operator PHẢI công bố snapshot thô. File này định nghĩa
//   định dạng đó + nạp/ghi + kiểm toàn vẹn. Delegator tải file → chạy `ownerBreakdown`
//   tất định → ra ĐÚNG bảng operator công bố (không cần tin operator, chỉ cần dữ liệu).
//
//   Mỗi epoch một danh sách {owner (payment-cred pkh hex), stake (lovelace)}. Có thể
//   kèm `stakeAddress` (stake1…) để delegator ĐỘC LẬP đối chiếu stake của mình với
//   Blockfrost `/accounts/{stake}/history`. BigInt lưu dạng CHUỖI (JSON không có BigInt).

import type { EntitlementParams, SnapshotSet } from "./types.js";

/** 1 dòng stake công bố. stake/owner bắt buộc; stakeAddress tùy chọn (để tự-kiểm). */
export interface PublishedStakeEntry {
  owner: string; // payment-credential pkh hex (đích nhận LAMP)
  stake: string; // lovelace (chuỗi BigInt)
  stakeAddress?: string; // stake1… (tùy chọn, dùng đối chiếu Blockfrost)
}

/** 1 epoch trong snapshot công bố. */
export interface PublishedEpoch {
  epoch: string; // số epoch thật (chuỗi BigInt)
  stakes: PublishedStakeEntry[];
}

/** File snapshot công bố cho 1 pot TIGER. */
export interface PublishedSnapshot {
  version: number; // = 1
  network: string; // Preview | Preprod | Mainnet
  pot: string; // tên pot, vd "Early TIGER Deleg 12"
  budgetLamp: string; // ngân sách (LAMP, chuỗi BigInt)
  cutoffEpoch: string; // chỉ tính epoch < cutoff (đã lọc khi build; lưu để truy vết)
  poolIds: string[]; // pool TIGER tính vào (truy vết)
  excluded: string[]; // pkh hex bị loại (self-dealing)
  drip: { epochs: string; cliffEpoch: string }; // N, cliff cho drip kiểu B
  epochs: PublishedEpoch[];
}

const OIL_PER_LAMP = 1_000_000n;

function bi(s: string, ctx: string): bigint {
  try {
    return BigInt(s);
  } catch {
    throw new Error(`SNAP-001: "${s}" không phải số nguyên hợp lệ (${ctx})`);
  }
}

/** Kiểm toàn vẹn + chuẩn hoá → trả {snapshots, epochs, params}.
 *  - version == 1, các trường bắt buộc có mặt.
 *  - mỗi epoch KHÔNG owner trùng (TIGER-002).
 *  - epoch tăng dần nghiêm ngặt (chống lặp/đảo epoch).
 *  - stake ≥ 0; pkh hex 56 ký tự (28 byte). */
export function parseSnapshot(snap: PublishedSnapshot): {
  snapshots: SnapshotSet;
  epochs: bigint[];
  params: Partial<EntitlementParams>;
  budgetOil: bigint;
  cutoffEpoch: bigint;
  dripEpochs: bigint;
  cliffEpoch: bigint;
} {
  if (snap.version !== 1)
    throw new Error(`SNAP-000: version ${snap.version} không hỗ trợ (cần 1)`);
  if (!Array.isArray(snap.epochs) || snap.epochs.length === 0)
    throw new Error("SNAP-002: epochs rỗng");

  const cutoffEpoch = bi(snap.cutoffEpoch, "cutoffEpoch");
  const epochs: bigint[] = [];
  const snapshots: SnapshotSet = [];
  let prev: bigint | null = null;

  for (const pe of snap.epochs) {
    const e = bi(pe.epoch, "epoch");
    if (prev !== null && e <= prev)
      throw new Error(`SNAP-003: epoch ${e} không tăng dần sau ${prev}`);
    if (e >= cutoffEpoch)
      throw new Error(
        `SNAP-004: epoch ${e} ≥ cutoff ${cutoffEpoch} — phải lọc trước khi công bố`,
      );
    prev = e;
    const seen = new Set<string>();
    const row = pe.stakes.map((s) => {
      const owner = (s.owner.startsWith("0x") ? s.owner.slice(2) : s.owner).toLowerCase();
      if (!/^[0-9a-f]{56}$/.test(owner))
        throw new Error(`SNAP-005: owner "${s.owner}" không phải pkh 28-byte hex`);
      if (seen.has(owner))
        throw new Error(`TIGER-002: owner ${owner} trùng trong epoch ${e}`);
      seen.add(owner);
      const stake = bi(s.stake, `stake owner ${owner} epoch ${e}`);
      if (stake < 0n) throw new Error(`SNAP-006: stake âm owner ${owner} epoch ${e}`);
      return { owner, stake };
    });
    epochs.push(e);
    snapshots.push(row);
  }

  const excluded = new Set(
    (snap.excluded ?? []).map((h) =>
      (h.startsWith("0x") ? h.slice(2) : h).toLowerCase(),
    ),
  );
  const budgetOil = bi(snap.budgetLamp, "budgetLamp") * OIL_PER_LAMP;

  return {
    snapshots,
    epochs,
    params: { budgetOil, excluded },
    budgetOil,
    cutoffEpoch,
    dripEpochs: bi(snap.drip.epochs, "drip.epochs"),
    cliffEpoch: bi(snap.drip.cliffEpoch, "drip.cliffEpoch"),
  };
}

/** Dựng PublishedSnapshot từ dữ liệu BigInt (để operator ghi file). */
export function buildSnapshot(args: {
  network: string;
  pot: string;
  budgetLamp: bigint;
  cutoffEpoch: bigint;
  poolIds: string[];
  excluded: bigint[] | string[];
  dripEpochs: bigint;
  cliffEpoch: bigint;
  epochs: { epoch: bigint; stakes: { owner: string; stake: bigint; stakeAddress?: string }[] }[];
}): PublishedSnapshot {
  return {
    version: 1,
    network: args.network,
    pot: args.pot,
    budgetLamp: args.budgetLamp.toString(),
    cutoffEpoch: args.cutoffEpoch.toString(),
    poolIds: args.poolIds,
    excluded: args.excluded.map((x) => x.toString()),
    drip: { epochs: args.dripEpochs.toString(), cliffEpoch: args.cliffEpoch.toString() },
    epochs: args.epochs.map((e) => ({
      epoch: e.epoch.toString(),
      stakes: e.stakes.map((s) => ({
        owner: s.owner,
        stake: s.stake.toString(),
        ...(s.stakeAddress ? { stakeAddress: s.stakeAddress } : {}),
      })),
    })),
  };
}
