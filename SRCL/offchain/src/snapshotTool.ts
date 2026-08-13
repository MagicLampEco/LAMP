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
//   budget_e = PER_EPOCH_OILDROP (chia đều 3,6e14 oildrop / 36 = 10M LAMP). epoch cuối có thể cộng dư lẻ.
//   entitlement_e[i] = floor(budget_e × stake_i / Σ stake)   (oildrop)
//   Dư do floor (budget − Σ entitlement) → dồn cho ví stake lớn nhất (xác định,
//   không mất oildrop). Tổng entitlement_e == budget_e CHÍNH XÁC.

import {
  PER_EPOCH_OILDROP, REMAINDER_OILDROP, EPOCHS, SRCL_CAMPAIGN_ID, ROLE_SPO,
} from "./constants.js";
import { buildTree, MerkleTree } from "./merkle.js";
import type { Entitlement, StakeEntry } from "./types.js";

/** Ngân sách oildrop của 1 epoch. epoch cuối (35) cộng dư lẻ REMAINDER_OILDROP. */
export function epochBudgetOildrop(epoch: number): bigint {
  const last = Number(EPOCHS) - 1;
  return epoch === last ? PER_EPOCH_OILDROP + REMAINDER_OILDROP : PER_EPOCH_OILDROP;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeSrclEntitlements — CỐ Ý KHÁC canonical TIGER/offchain computeEntitlements.
// ĐỔI TÊN (khỏi trùng "computeEntitlements") để bỏ bẫy import-nhầm: hai hàm là HAI
// thuật toán khác NGHIỆP VỤ, KHÔNG phải bản chép cũ.
//
//   TIGER (Delegator airdrop, 1 lần chốt):
//     • nhận SnapshotSet ĐA-epoch → TÍCH LŨY accStake = Σ stake mọi snapshot (thưởng
//       lòng trung thành) rồi chia MỘT LẦN theo cutoff.
//     • có cap + water-filling (chống cá voi) + excluded (loại self-dealing).
//     • trả {entitlements, leftover, distributed}.
//
//   SRCL (reward-redirect, streaming per-epoch):
//     • MỖI epoch là một pot ĐỘC LẬP 10 triệu LAMP, chia pro-rata theo stake CỦA
//       CHÍNH epoch đó (KHÔNG tích lũy) — vì on-chain là epoch_roots[] + SetRoot/Claim
//       theo từng epoch. Nhận 1 StakeEntry[] của 1 epoch, KHÔNG phải SnapshotSet.
//     • KHÔNG cap/water-filling: thiết kế SRCL chia đều 36 epoch, không trần ví.
//     • lọc stake>0 (bộ lọc tư cách — vd ngưỡng 1000 ADA — nằm ở tầng dựng StakeEntry,
//       spec §7 + README "Nguồn stake").
//
// ⇒ import TIGER.computeEntitlements vào SRCL sẽ SAI (khác signature + khác mô hình
//    phân phối). Giữ hàm riêng này.
//
// Dư floor → ví stake lớn nhất; tie-break = owner hex NHỎ NHẤT (tất định BẤT KỂ thứ tự
// input — khớp quy ước tie-break canonical TIGER, tránh 2 operator cùng dữ liệu khác
// thứ tự mảng lại ra root khác).
// ─────────────────────────────────────────────────────────────────────────────
/** Tính entitlement (oildrop) cho 1 epoch SRCL theo tỷ lệ stake. Tổng == budget chính xác.
 *  Bỏ qua ví stake = 0. Dư floor dồn vào ví stake lớn nhất (tie → owner hex nhỏ nhất). */
export function computeSrclEntitlements(
  epoch: number,
  stakes: StakeEntry[],
  budgetOildrop: bigint = epochBudgetOildrop(epoch),
): Entitlement[] {
  const active = stakes.filter((s) => s.stake > 0n);
  if (active.length === 0) return [];
  const total = active.reduce((a, s) => a + s.stake, 0n);
  if (total <= 0n) return [];

  const ents: Entitlement[] = active.map((s) => ({
    epoch,
    owner: s.owner,
    amount: (budgetOildrop * s.stake) / total, // floor
  }));

  // Dư do floor → ví stake lớn nhất (tất định: stake max, tie → owner hex nhỏ nhất).
  const distributed = ents.reduce((a, e) => a + e.amount, 0n);
  const leftover = budgetOildrop - distributed;
  if (leftover > 0n) {
    let maxIdx = 0;
    for (let i = 1; i < active.length; i++) {
      const si = active[i]!.stake, sm = active[maxIdx]!.stake;
      // stake lớn hơn thắng; bằng stake → owner hex nhỏ hơn thắng (tất định).
      if (si > sm || (si === sm && active[i]!.owner < active[maxIdx]!.owner)) {
        maxIdx = i;
      }
    }
    ents[maxIdx]!.amount += leftover;
  }
  // Loại entitlement 0 (ví quá nhỏ → 0 oildrop) để cây gọn.
  return ents.filter((e) => e.amount > 0n);
}

/** Kết quả snapshot 1 epoch: entitlement + cây + root. */
export interface EpochSnapshot {
  epoch: number;
  entitlements: Entitlement[];
  tree: MerkleTree;
  root: string;
  totalOildrop: bigint;
}

/** Snapshot 1 epoch: stake → entitlement → cây Merkle (schema C) → root.
 *  campaignId/role mặc định SRCL (LAMP-SRCL-1 / SPO); truyền khác để tái dùng engine. */
export function snapshotEpoch(
  epoch: number,
  stakes: StakeEntry[],
  campaignId: string = SRCL_CAMPAIGN_ID,
  role: number = ROLE_SPO,
): EpochSnapshot {
  const entitlements = computeSrclEntitlements(epoch, stakes);
  const tree = buildTree(
    campaignId,
    role,
    entitlements.map((e) => ({ epoch: BigInt(e.epoch), owner: e.owner, amount: e.amount })),
  );
  const totalOildrop = entitlements.reduce((a, e) => a + e.amount, 0n);
  return { epoch, entitlements, tree, root: tree.root, totalOildrop };
}

/** Snapshot NHIỀU epoch (map epoch → stake list) → mảng root theo epoch.
 *  Trả roots[] (index = epoch) + snapshot từng epoch để dựng proof về sau. */
export function snapshotAll(
  stakesByEpoch: Map<number, StakeEntry[]>,
  campaignId: string = SRCL_CAMPAIGN_ID,
  role: number = ROLE_SPO,
): { roots: string[]; snapshots: EpochSnapshot[] } {
  const epochs = [...stakesByEpoch.keys()].sort((a, b) => a - b);
  const snapshots = epochs.map((e) => snapshotEpoch(e, stakesByEpoch.get(e)!, campaignId, role));
  const roots = snapshots.map((s) => s.root);
  return { roots, snapshots };
}
