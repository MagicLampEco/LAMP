// SRCL snapshotTool — snapshot stake mỗi epoch → entitlement → Merkle root.
//
// ─────────────────────────────────────────────────────────────────────────
// NGUỒN STAKE (điểm cấn — đọc kỹ)
//   stake[addr] của 1 epoch = số ADA delegator ủy thác vào pool SRCL TẠI snapshot
//   epoch đó. Lấy từ Blockfrost:
//     GET /pools/{pool_id}/delegators            (delegator hiện tại + live stake)
//     GET /epochs/{epoch}/stakes/{pool_id}       (active stake theo epoch lịch sử)
//   → map stake_address → controlled lovelace. Sau đó RESOLVE stake_address →
//   payment-credential hash (pkh) của ví nhận LAMP (owner trong leaf). Việc resolve
//   stake→payment cred do off-chain quyết (vd ví đăng ký nhận, hoặc dùng chính
//   payment cred của địa chỉ rút). KHÔNG nằm trong contract — đây là CHÍNH SÁCH
//   2 cty vận hành SPO. snapshotTool nhận sẵn list {owner(pkh), stake} của epoch.
//
// ENTITLEMENT (tất định, tỷ lệ stake):
//   budget_e = PER_EPOCH_OIL (chia đều 3,6e14 oil / 36 = 10M LAMP). epoch cuối có thể cộng dư lẻ.
//   entitlement_e[i] = floor(budget_e × stake_i / Σ stake)   (oil)
//   Dư do floor (budget − Σ entitlement) → dồn cho ví stake lớn nhất (xác định,
//   không mất oil). Tổng entitlement_e == budget_e CHÍNH XÁC.

import { PER_EPOCH_OIL, REMAINDER_OIL, EPOCHS } from "./constants.js";
import { buildTree, MerkleTree } from "./merkle.js";
import type { Entitlement, StakeEntry } from "./types.js";

/** Ngân sách oil của 1 epoch. epoch cuối (35) cộng dư lẻ REMAINDER_OIL. */
export function epochBudgetOil(epoch: number): bigint {
  const last = Number(EPOCHS) - 1;
  return epoch === last ? PER_EPOCH_OIL + REMAINDER_OIL : PER_EPOCH_OIL;
}

/** Tính entitlement (oil) cho 1 epoch theo tỷ lệ stake. Tổng == budget chính xác.
 *  Bỏ qua ví stake = 0. Dư floor dồn vào ví stake lớn nhất. */
export function computeEntitlements(
  epoch: number,
  stakes: StakeEntry[],
  budgetOil: bigint = epochBudgetOil(epoch),
): Entitlement[] {
  const active = stakes.filter((s) => s.stake > 0n);
  if (active.length === 0) return [];
  const total = active.reduce((a, s) => a + s.stake, 0n);
  if (total <= 0n) return [];

  const ents: Entitlement[] = active.map((s) => ({
    epoch,
    owner: s.owner,
    amount: (budgetOil * s.stake) / total, // floor
  }));

  // Dư do floor → ví stake lớn nhất (xác định: index stake max, tie → index nhỏ).
  const distributed = ents.reduce((a, e) => a + e.amount, 0n);
  const leftover = budgetOil - distributed;
  if (leftover > 0n) {
    let maxIdx = 0;
    for (let i = 1; i < active.length; i++) {
      if (active[i]!.stake > active[maxIdx]!.stake) maxIdx = i;
    }
    ents[maxIdx]!.amount += leftover;
  }
  // Loại entitlement 0 (ví quá nhỏ → 0 oil) để cây gọn.
  return ents.filter((e) => e.amount > 0n);
}

/** Kết quả snapshot 1 epoch: entitlement + cây + root. */
export interface EpochSnapshot {
  epoch: number;
  entitlements: Entitlement[];
  tree: MerkleTree;
  root: string;
  totalOil: bigint;
}

/** Snapshot 1 epoch: stake → entitlement → cây Merkle → root. */
export function snapshotEpoch(epoch: number, stakes: StakeEntry[]): EpochSnapshot {
  const entitlements = computeEntitlements(epoch, stakes);
  const tree = buildTree(
    entitlements.map((e) => ({ epoch: BigInt(e.epoch), owner: e.owner, amount: e.amount })),
  );
  const totalOil = entitlements.reduce((a, e) => a + e.amount, 0n);
  return { epoch, entitlements, tree, root: tree.root, totalOil };
}

/** Snapshot NHIỀU epoch (map epoch → stake list) → mảng root theo epoch.
 *  Trả roots[] (index = epoch) + snapshot từng epoch để dựng proof về sau. */
export function snapshotAll(
  stakesByEpoch: Map<number, StakeEntry[]>,
): { roots: string[]; snapshots: EpochSnapshot[] } {
  const epochs = [...stakesByEpoch.keys()].sort((a, b) => a - b);
  const snapshots = epochs.map((e) => snapshotEpoch(e, stakesByEpoch.get(e)!));
  const roots = snapshots.map((s) => s.root);
  return { roots, snapshots };
}
