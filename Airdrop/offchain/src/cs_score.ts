// cs_score.ts — phân phối 3 pot Airdrop theo TRỌNG SỐ STAKE (stake-weighted).
//
// Vai trò: SPO = Staking Pool Operator · CS = Community Supporter.
//
// ─────────────────────────────────────────────────────────────────────────
// MÔ HÌNH (thay hoàn toàn CS log-score cũ — xem spo-cs.md)
//
//   Mỗi pot chia ∝ trọng số stake của người nhận, bằng largest-remainder
//   (Hamilton) → BẢO TOÀN TUYỆT ĐỐI: Σ oildrop = potOildrop (khi cap=null).
//
//   • Pot SPO (5M)  — trọng số SPO(i) = Σ stake các delegator (đã đăng ký) ủy
//     thác VÀO POOL của SPO i (delegation chảy vào pool).
//   • Pot CS  (15M) — trọng số CS(j)  = Σ phiếu-stake các delegator đã PHÂN BỔ
//     cho j. Tự bỏ phiếu (j = d) HỢP LỆ và là chiến lược trội ⇒ điểm cân bằng
//     là weight_CS(j) = accStake(j), tức pot CS = đợt chia-theo-stake thứ hai.
//     LÀN NÀY LÀ STAKE-WEIGHTED, KHÔNG đo "đóng góp" (spo-cs.md §3.5).
//   • Pot Delegator (100M) — GIỮ nguyên `delegator_entitlement.ts`
//     (trọng số = stake của CHÍNH delegator).
//
//   Cả 3 đều neo STAKE (đại lượng tốn kém, không ngụy tạo được) → chống sybil.
//   Khác nhau ở NGUỒN trọng số: SPO = stake-vào-pool · CS = stake-bình-chọn.
//
// ─────────────────────────────────────────────────────────────────────────
// RANH GIỚI BIGINT (đọc kỹ trước khi sửa)
//
//   MỌI trọng số + khoản tiền là BigInt oildrop. KHÔNG float, KHÔNG Number.
//   Chia bằng largest-remainder → bảo toàn tuyệt đối. Cap tuỳ chọn mỗi-người
//   nhận (như ETD `capOildrop`) qua water-filling; mặc định null (không cap).
//
//   Đơn vị: 1 LAMP = 10^6 oildrop (OILDROP_PER_LAMP).
//   Pot SPO = 5.000.000 LAMP · Pot CS = 15.000.000 LAMP (constants.ts).
// ─────────────────────────────────────────────────────────────────────────

import { SPO_POT_OILDROP, CS_POT_OILDROP } from "./constants.js";
import { computeEntitlements } from "../../../TIGER/offchain/src/entitlement.js";
import { buildSnapshotSet } from "../../../TIGER/offchain/src/snapshot.js";

// ── Types ────────────────────────────────────────────────────────────────

/** 1 trọng số stake của người nhận.
 *  - Pot SPO: id = spo_id, stake = Σ stake delegator ủy thác vào pool đó.
 *  - Pot CS : id = supporter_id, stake = weight_stake (Σ stake người bình chọn). */
export interface StakeWeight {
  id: string;
  /** Trọng số stake (lovelace tích luỹ) — BigInt, không âm. */
  stake: bigint;
}

/** Reward 1 người nhận (oildrop). */
export interface StakeReward {
  id: string;
  oildrop: bigint;
}

// ── Lõi: chia 1 pot ∝ stake ────────────────────────────────────────────────

/** Chia `potOildrop` (oildrop) cho `weights` ∝ stake, bằng largest-remainder (Hamilton).
 *
 *  TÁI DÙNG thuật toán token-side đã chạy thật trên Preview (`computeEntitlements`
 *  của TIGER): cùng largest-remainder + water-filling cap + gom dư floor → KHÔNG
 *  copy-lệch, 1 nguồn thuật toán duy nhất.
 *
 *  Trả về 1 entry / id theo ĐÚNG thứ tự input (id trọng số 0 hoặc bị loại → oildrop=0).
 *
 *  Bất biến:
 *    • cap=null ⇒ Σ oildrop = potOildrop (bảo toàn tuyệt đối; dư floor gom về stake lớn nhất).
 *    • không id nào stake>0 (mảng rỗng / toàn 0) ⇒ Σ oildrop = 0, leftover = potOildrop.
 *    • cap>0 ⇒ mỗi oildrop ≤ cap; phần không chia được (do cap) là leftover về Treasury.
 *
 *  Ném lỗi nếu 2 weight trùng id (buildSnapshotSet bắt trùng owner — chống thổi phồng). */
export function splitByStake(
  weights: StakeWeight[],
  potOildrop: bigint,
  capOildrop: bigint | null = null,
): StakeReward[] {
  if (potOildrop < 0n) throw new Error("CS-POT: potOildrop phải ≥ 0");

  // 1 "epoch" tổng hợp: rows = id ↦ stake. buildSnapshotSet bỏ stake ≤ 0 và ném
  // lỗi nếu id trùng trong cùng epoch (chống 1 người xuất hiện 2 dòng).
  const rows = weights.map((w) => ({
    stake_address: w.id,
    amount: w.stake.toString(),
  }));
  const snap = buildSnapshotSet([{ epoch: 0n, rows }]);

  const res = computeEntitlements(snap, { budgetOildrop: potOildrop, capOildrop });
  const oildropById = new Map(res.entitlements.map((e) => [e.owner, e.amount]));

  return weights.map((w) => ({ id: w.id, oildrop: oildropById.get(w.id) ?? 0n }));
}

// ── Pot SPO — trọng số = stake chảy VÀO POOL ────────────────────────────────

/** Chia pot SPO ∝ tổng stake (đã đăng ký) ủy thác vào pool mỗi SPO.
 *  `spoWeights[i].stake` = Σ active_stake của các delegator đã đăng ký delegate
 *  vào pool của SPO i. Thưởng SPO hút/giữ được nhiều delegation. */
export function splitSpoPot(
  spoWeights: StakeWeight[],
  potOildrop: bigint = SPO_POT_OILDROP,
  capOildrop: bigint | null = null,
): StakeReward[] {
  // BẤT BIẾN: trần trên pot chia-theo-stake là TỰ MỞ CỬA TÁCH VÍ.
  // accStake là trục BẢO-TOÀN (tách ví không sinh thêm stake). Không trần ⇒ tách n ví giữ
  // tổng stake thì tổng nhận KHÔNG ĐỔI còn chi phí tăng theo n ⇒ tách bị trội tuyệt đối.
  // Có trần c ⇒ n ví nhận tới n·c ⇒ chính cái trần đặt ra để chặn cá voi trả tiền cho việc tách.
  // Trần chỉ an toàn trên trục GIẢ-ĐƯỢC, cần một-người-một-DID ép được on-chain (chưa có).
  // Đại số đầy đủ: Airdrop/spo-cs.md §5. Máy chia splitByStake vẫn nhận cap (dùng chung ETD);
  // cấm là ở TẦNG POT của Airdrop, nên chặn tại đây.
  if (capOildrop !== null) {
    throw new Error(
      "AIRDROP-CAP: pot SPO CẤM đặt trần — capOildrop phải là null. Xem Airdrop/spo-cs.md §5.",
    );
  }
  return splitByStake(spoWeights, potOildrop, capOildrop);
}

// ── Pot CS (Community Supporter) — trọng số = Σ phiếu-stake phân bổ cho người nhận ──

/** Chia pot CS ∝ tổng "phiếu-stake" đã phân bổ cho mỗi người nhận.
 *  `csWeights[j].stake` = Σ allocation_d(j) của các delegator d (mỗi delegator có
 *  phiếu-stake = stake của mình, tổng phân bổ ≤ stake của họ — quy tắc chống
 *  double-count, SPO-CS-SPEC §3.4). Ràng buộc đó là DUY NHẤT: KHÔNG có mệnh đề
 *  `j ≠ d`, nên TỰ BỎ PHIẾU hợp lệ và là chiến lược trội tuyệt đối ⇒ điểm cân bằng
 *  weight_CS(j) = accStake(j). Vì vậy pot CS được khai là STAKE-WEIGHTED, KHÔNG
 *  phải phần thưởng cho "đóng góp được công nhận" (SPO-CS-SPEC §3.5).
 *  Người nhận KHÔNG cần là SPO — chỉ cần có DID sinh trắc và stake/phiếu được phân bổ. */
export function splitCsPot(
  csWeights: StakeWeight[],
  potOildrop: bigint = CS_POT_OILDROP,
  capOildrop: bigint | null = null,
): StakeReward[] {
  // BẤT BIẾN: trần trên pot chia-theo-stake là TỰ MỞ CỬA TÁCH VÍ.
  // accStake là trục BẢO-TOÀN (tách ví không sinh thêm stake). Không trần ⇒ tách n ví giữ
  // tổng stake thì tổng nhận KHÔNG ĐỔI còn chi phí tăng theo n ⇒ tách bị trội tuyệt đối.
  // Có trần c ⇒ n ví nhận tới n·c ⇒ chính cái trần đặt ra để chặn cá voi trả tiền cho việc tách.
  // Trần chỉ an toàn trên trục GIẢ-ĐƯỢC, cần một-người-một-DID ép được on-chain (chưa có).
  // Đại số đầy đủ: Airdrop/spo-cs.md §5. Máy chia splitByStake vẫn nhận cap (dùng chung ETD);
  // cấm là ở TẦNG POT của Airdrop, nên chặn tại đây.
  if (capOildrop !== null) {
    throw new Error(
      "AIRDROP-CAP: pot CS CẤM đặt trần — capOildrop phải là null. Xem Airdrop/spo-cs.md §5.",
    );
  }
  return splitByStake(csWeights, potOildrop, capOildrop);
}
